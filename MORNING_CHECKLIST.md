# MORNING CHECKLIST

Ordered by what unblocks the most. Item 1 takes about 30 seconds.

---

## 1. Make the preview URL publicly reachable (required for the link to work for anyone else)

The deploy is live but sits behind Vercel's SSO deployment protection, so it returns **302** to
anyone not logged into the team. I tried to turn that off and the environment's safety classifier
blocked the command — correctly, since making a deployment public is not an unattended-agent
decision.

```bash
vercel project protection disable groundtruth --sso
curl -s -o /dev/null -w "%{http_code}\n" https://groundtruth-549uwbq9q-arnav-guptas-projects-4ac946ea.vercel.app
# expect: 200
```

Or in the dashboard: **Project → Settings → Deployment Protection → Vercel Authentication → Off**.

## 2. Promote to production (one command, deliberately not run overnight)

```bash
vercel deploy --prod
```

Nothing else changes — the same build, the same mock-mode behaviour.

## 3. Read the guardrails before you add a real API key

**Do this before step 4, not after.** Five independent triggers, all failing the same safe way —
when any of them says no, the request is served with canned reasoning rather than erroring.

| Trigger | Env var | Default | Recommended for public |
|---|---|---|---|
| Kill switch | `DISABLE_REAL_MODE` | off | keep handy, see §7 |
| Per IP, per hour | `RATE_LIMIT_PER_IP_PER_HOUR` | **3** | 3 |
| Global calls per day | `DAILY_REAL_CALL_CAP` | **50** | 50 |
| Global dollars per day | `DAILY_SPEND_CAP_USD` | **$2** | $2 |
| Per upload | hard-coded `LIMITS.MAX_REAL_CALLS_PER_UPLOAD` | 10 | 10 |

Read these three files, in this order:

- **`lib/ratelimit.ts`** — the whole spend story, ~330 lines and commented. Note `WORST_CASE_CALL_USD`:
  a call is only permitted if the remaining budget covers the worst case it could cost, so an
  in-flight call can never push spend past the ceiling.
- **`lib/ingest/index.ts`** — the input caps (50 rows, 1MB, 2000 chars/field) and the sanitiser.
  These are cost controls first: rows bound how many live calls one upload triggers, characters
  bound how big any single prompt gets.
- **`lib/resolver/llm.ts`** — the only file that calls Anthropic. Check `MAX_TOKENS = 1200` and the
  `SECURITY` block at the top of the system prompt.

Re-run the proofs yourself: `npm run test:guardrails && npm run test:ingest`.

## 4. Set up Upstash — this is the actual gate on adding a key

**The limiter is only global if Redis is configured.** Without it, each serverless instance keeps its
own counters, so the effective public limit is (configured limit × concurrent instances). The
guardrails test demonstrates this directly: six instances against a limit of three let all six
through.

1. Create a free Upstash Redis database (no card required).
2. Copy the REST URL and token into Vercel → Project `groundtruth` → Settings → Environment Variables:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Redeploy, then **confirm it is actually being used** — this is the step that matters:

```bash
curl -N "https://<your-deploy>/api/reconcile?paced=0" | head -c 400
# The first event must contain: "store":"redis"
# If it says "store":"memory", Redis is NOT wired and the cap is per-instance.
```

Do not skip the confirmation. A typo in the URL leaves you with a silent fallback to the exact
behaviour the cap is meant to prevent.

## 5. Only now, decide about a real `ANTHROPIC_API_KEY`

**My recommendation: leave it off.** Mock mode is honest, clearly labelled (`provenance: mock` on
every resolution), and the whole app works end to end without it. "Deployed and working" is already
true.

If you do want live reasoning, in this order:

1. Confirm step 4 shows `"store":"redis"`.
2. The defaults are already the conservative ones ($2/day, 50 calls/day, 3/hour/IP) — no change needed
   unless you want them tighter still.
3. Add `ANTHROPIC_API_KEY` in the Vercel dashboard. Detection is automatic — **no code change**.
4. Exercise the cheapest possible path first, one dispute, one unit, one call:

```bash
curl -N "https://<your-deploy>/api/investigate?dispute=DSP-1009" | grep -o '"reasoningProvenance":"[a-z]*"'
# expect: "real"
```

5. Watch for the failure mode that looks like success: if the model returns unparseable JSON,
   `realJudgement()` silently falls back to canned reasoning, so you would see `"mock"` and conclude
   the key was not detected. Add a `console.warn` in the `catch` block in `llm.ts` while you check.
6. Verify spend is being recorded — a second run should show a lower remaining budget in the `meta`
   event. `recordSpend()` reads `response.usage` and has never been exercised.

**Worst case if you do add one:** someone finds a gap and burns `DAILY_SPEND_CAP_USD`. At $2 that is
a bounded, uninteresting loss. That is the only version of this worth accepting.

## 6. Nothing outstanding in the test harness

The responsive suite passes cleanly at 375 / 768 / 1024 / 1440 — both workflows driven to
completion, no horizontal scroll, no touch target under 44px. If it ever hangs on a locator, the
cause is a stale `next start` holding port 3000 against a rebuilt `.next`: kill the listening PID,
then `rm -rf .next && npm run build && npm run start`.

`npx tsx scripts/shot.ts` writes screenshots to `shots/` if you want to eyeball it quickly.

## 7. If something looks like abuse

```bash
# Instant, no redeploy: Vercel dashboard -> Settings -> Environment Variables
DISABLE_REAL_MODE=1
```

Vercel applies env changes to new invocations immediately. Everything keeps working; the reasoning
step just goes back to canned. Then look at the Upstash keys (`gt:spend:<date>`, `gt:calls:<date>`,
`gt:ip:*`) to see what happened.

## 8. Optional — more fixture cases

The best use of further time, per the brief. `lib/fixtures/*.json` plus a hand-written entry in
`lib/resolver/mock-reasoning.ts`. Cases the set does not yet cover: an interchange downgrade, a
split shipment settling in two payouts, a chargeback reversal landing after representment, and a
refund issued against the wrong original transaction.

## 9. Optional — harden the ingestion path further

Currently good enough for a reviewer hitting it directly. If it ever faces sustained traffic:
per-IP rate limiting on `/api/ingest` itself (today only the *resolver* is limited, so a bot could
validate files cheaply in a loop), and a virus/content scan if uploads are ever persisted — they are
not today, nothing is written to disk or a database.

---

## Do not

- **Do not** commit a real key. `.env` and `.env*.local` are gitignored; `.env.example` carries only
  placeholders.
- **Do not** assume the rate limiter is global until step 4 shows `"store":"redis"`.
- **Do not** add a key and tighten the caps afterwards. Tighten first.
- **Do not** expect the real reasoning path to have been exercised. It has not been.
