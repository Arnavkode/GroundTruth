# MORNING CHECKLIST

Ordered by what unblocks the most. Item 1 takes about 30 seconds.

---

## 1. ~~Make the preview URL publicly reachable~~ - done

You disabled SSO deployment protection yourself, so the preview URL returns 200 to anyone. Nothing
to do here. Re-check any time with a plain `curl -I <preview-url>`.

## 2. Promote to production (one command, deliberately not run overnight)

```bash
vercel deploy --prod
```

Nothing else changes — the same build, the same mock-mode behaviour.

## 3. Read the guardrails before you add a real API key

**Do this before step 4, not after.** Five independent triggers, all failing the same safe way -
when any of them says no, the request is served with canned reasoning rather than erroring.

The provider is now **Gemini, on the free tier, with no billing account attached** - so the thing
being guarded is quota, not money. There is no dollar cap because there are no dollars.

| Trigger | Env var | Default | Recommended for public |
|---|---|---|---|
| Kill switch | `DISABLE_REAL_MODE` | off | keep handy, see 7 |
| Per IP, per hour | `RATE_LIMIT_PER_IP_PER_HOUR` | **3** | 3 |
| Global calls per day | `DAILY_REAL_CALL_CAP` | **300** | 300 (free tier states ~1000) |
| Per upload | hard-coded `LIMITS.MAX_REAL_CALLS_PER_UPLOAD` | 10 | 10 |
| Provider 429 | - | latches off for the day | leave it |

Read these three files, in this order:

- **`lib/ratelimit.ts`** - the whole quota story, commented throughout. Note `markQuotaExhausted()`:
  one `RESOURCE_EXHAUSTED` from the provider latches live mode off until the daily reset, because
  retrying into an exhausted quota is waste and reads as abuse from the provider's side.
- **`lib/ingest/index.ts`** — the input caps (50 rows, 1MB, 2000 chars/field) and the sanitiser.
  These are cost controls first: rows bound how many live calls one upload triggers, characters
  bound how big any single prompt gets.
- **`lib/resolver/llm.ts`** - the only file that calls Gemini. Check `MAX_OUTPUT_TOKENS = 1200`, the
  `SECURITY` block at the top of the system prompt, and the evidence fence.

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

## 5. Only now, add the real `GEMINI_API_KEY` to the deployment

You supplied a key and it has already been used locally, for the two things that were blocked on it:

- **Fit 2 ran.** 200 live calls, 0 failures, 38 minutes, $0. `lib/resolver/calibration.ts` is now a
  real fitted map and the app no longer says "uncalibrated" anywhere. The 200 replies are committed
  to `lib/fitting/fit2-samples.json`, so re-fitting costs nothing:
  `CAL_SAMPLES=lib/fitting/fit2-samples.json npm run fit:calibrate`.
- **The injection defence was re-verified against Gemini itself.** 25 assertions, 4 real calls, 4
  payloads, all passing. Captured output is in `BUILD_LOG.md`.

**Where the key is now:** `.env.local`, which is gitignored. You had put it in `.env.example`, which
is a **committed** file — it was moved before any commit, and `git log -S` confirms it never reached
history. If that key was ever pushed anywhere else, rotate it at
https://aistudio.google.com/apikey; it costs nothing to replace.

**It is deliberately NOT on the Vercel deployment yet**, for the reason in §4 and nothing else:
without Upstash, every cap is counted per serverless instance, so the effective public limit is
(limit × instances). Do step 4 first. The preview serves mock reasoning until you do.

### On the deployment

In this order, and do not reorder them:

1. Confirm step 4 shows `"store":"redis"`. Without it the caps are per-instance.
2. Defaults are already conservative (300/day, 3/hour/IP, 10/upload) - no change needed.
3. Add `GEMINI_API_KEY` in the Vercel dashboard. Detection is automatic - **no code change**.
4. Exercise the cheapest possible path first - one dispute, one unit, one call:

```bash
curl -N "https://<your-deploy>/api/investigate?dispute=DSP-1009" | grep -o 'reasoningProvenance...real'
# expect a match
```

5. Watch for the failure mode that looks like success: if the model returns unparseable JSON,
   `realJudgement()` falls back to canned reasoning, so you would see `mock` and wrongly conclude
   the key was not detected. Add a `console.warn` in the `catch` in `llm.ts` while you check.
6. Confirm token accounting is live - the `meta` event should show a non-zero `tokensUsedToday`
   after a real call. The usage keys were confirmed against a live response
   (`total_input_tokens` / `total_output_tokens` / `total_thought_tokens`, thinking tokens counted
   as output), so a zero here means the key is not being picked up, not that accounting is broken.

**Worst case if you do add one:** someone finds a gap and burns the day's free quota. The provider
then refuses, the latch trips, the app serves canned reasoning, and it resets tomorrow. No card is
attached to this key - that is the entire reason the provider was switched.

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
step just goes back to canned. Then look at the Upstash keys (`gt:calls:<date>`, `gt:tokens:<date>`,
`gt:quota:<date>`, `gt:ip:*`) to see what happened.

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
- **Do not** expect the real reasoning path to have been exercised *on the deployment*. Locally it
  has: ~410 live calls across Fit 2, the injection suite and smoke checks, all clean.
- **Do not** hand-edit `lib/resolver/fitted.ts` or `lib/resolver/calibration.ts`. They are generated
  by `npm run fit:weights` / `npm run fit:calibrate`; edit the scripts and re-run.
- **Do not** let `calibration.ts` ship a fabricated fit to make the UI look finished. Its `null`
  state is load-bearing honesty - the app says "uncalibrated", and that is currently true.
