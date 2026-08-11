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
curl -s -o /dev/null -w "%{http_code}\n" https://groundtruth-htaceb2fc-arnav-guptas-projects-4ac946ea.vercel.app
# expect: 200
```

Or in the dashboard: **Project → Settings → Deployment Protection → Vercel Authentication → Off**.

## 2. Promote to production (one command, deliberately not run overnight)

```bash
vercel deploy --prod
```

Nothing else changes — the same build, the same mock-mode behaviour.

## 3. Read the rate limiter before you add a real API key

**Do this before step 4, not after.** The whole spend-guard story is one file:

- **`lib/ratelimit.ts`** — read it top to bottom, it is ~150 lines and commented.
  - Per IP: `RATE_LIMIT_PER_IP_PER_HOUR`, default **10**, sliding 1-hour window.
  - Global: `DAILY_REAL_CALL_CAP`, default **200**, rolling 24-hour window.
  - Both **fail safe**: on exhaustion the request is routed to mock reasoning, never errored. A user
    always gets a working resolution; only the reasoning provenance degrades.
  - `hasRealApiKey()` rejects placeholders (`sk-ant-placeholder`, `your-key-here`, empty, unset) —
    a placeholder can never accidentally enable spend.
  - `FORCE_MOCK_MODE=1` overrides everything, for demos.
- **`lib/resolver/llm.ts`** — the only file that calls Anthropic. Check `MAX_TOKENS = 1200` (firm,
  no open-ended generations) and that it never runs without a slot reserved by the limiter.
- Re-run the proof yourself: `npm run test:ratelimit`.

Known limitation: the store is in-memory, so the cap is per serverless instance and resets on cold
start. That was the deliberate zero-signup baseline. See item 8 for the upgrade.

## 4. Add a real `ANTHROPIC_API_KEY` — only when you're ready to spend

**Where:** Vercel dashboard → Project `groundtruth` → **Settings → Environment Variables** → add
`ANTHROPIC_API_KEY` for the Preview environment (and Production if you did step 2), then redeploy.

Locally: create `.env.local` with `ANTHROPIC_API_KEY=sk-ant-...` (see `.env.example`).

Detection is automatic — **no code change is needed**. The app flips the reasoning step to live and
keeps everything else identical.

Consider starting with a tighter cap for the first day:

```
RATE_LIMIT_PER_IP_PER_HOUR=3
DAILY_REAL_CALL_CAP=25
```

Note: one Reconcile run resolves **16 units**, so it makes up to 16 real calls if every unit takes
the live path. Size `DAILY_REAL_CALL_CAP` with that in mind — 200 is roughly 12 full reconciliations.

## 5. Verify the real path (it was never executed — no key existed)

`lib/resolver/llm.ts` is wired correctly but untested against the live API. Check these in order:

```bash
# Cheapest possible first exercise: one dispute, one unit, one call.
curl -N "http://localhost:3000/api/investigate?dispute=DSP-1009" | grep -o '"provenance":"[a-z]*"'
# expect: "real"
```

Then confirm:
1. The `meta` event says `mode: "real"` and the UI badge reads **live reasoning**.
2. Each resolution's `reasoningProvenance` is `"real"`, not `"mock"`.
3. The model returns parseable JSON. If it does not, `realJudgement()` silently falls back to canned
   reasoning — which is safe, but means you would see `"mock"` and think the key was not detected.
   That fallback is the single most likely thing to be wrong; add a `console.warn` in the `catch`
   block in `llm.ts` while you check.
4. Model id is `claude-sonnet-4-6` (override with `ANTHROPIC_MODEL`). Confirmed current.
5. Watch the first few responses for quality — the mock reasoning sets a deliberately high bar, and
   the prompt in `llm.ts` was tuned against it but never against the live model.

## 6. Fix the one warning in the responsive harness

`scripts/test-responsive.ts` reports `[WARN] investigate interaction not driven` at each width: the
locator for the dispute card stopped resolving after a reconciliation run in the same context. An
earlier version using `getByRole("button", { name: /Duplicate processing/i })` did work at all four
widths — that run is what caught the letter-overflow bug. Restore that locator, or give the dispute
buttons a stable `data-testid`. All hard overflow and touch-target assertions pass; this is the
automated re-check of one interaction, not a product defect.

## 7. Optional — more fixture cases

The best use of further time, per the brief. `lib/fixtures/*.json` plus a hand-written entry in
`lib/resolver/mock-reasoning.ts`. Cases the set does not yet cover: an interchange downgrade, a
split shipment settling in two payouts, a chargeback reversal landing after representment, and a
refund issued against the wrong original transaction.

## 8. Optional — persistent rate-limit store

Swap the in-memory `Map` in `lib/ratelimit.ts` for Upstash Redis (free tier) so the cap holds across
cold starts. The interface (`checkRateLimit(ip, now) → Decision`) is the only thing that needs to
stay the same; everything else in the app goes through it. Do not do this before item 4 — the
in-memory limiter is conservative per instance, so it errs toward less spend, not more.

---

## Do not

- **Do not** commit a real key. `.env` and `.env*.local` are gitignored; `.env.example` carries only
  placeholders.
- **Do not** assume the rate limiter is global until item 8 is done.
- **Do not** expect the real reasoning path to have been exercised. It has not been.
