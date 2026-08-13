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

## 4. ~~Set up Upstash~~ - done, and it caught a real bug

You connected Upstash through Vercel's integration. Confirming it (rather than trusting the
dashboard) is what surfaced the problem: the integration provisions `KV_REST_API_URL` /
`KV_REST_API_TOKEN`, and the code only read `UPSTASH_REDIS_REST_URL` / `_TOKEN`. Database live,
dashboard green, limiter silently still per-instance. Both namings are now accepted.

Confirmed on the deployment:

```bash
curl -sN "https://<your-deploy>/api/reconcile?paced=0" | head -c 400
# contains: "store":"redis"        <- global caps, not per-instance
```

Re-run that check after any change to the integration. `"store":"memory"` means the caps are not
real, whatever the dashboard says.

## 5. ~~Add the real `GEMINI_API_KEY`~~ - done and verified live

The key is on Production and Preview, added only after step 4 reported `"store":"redis"`. Verified
end to end on the deployment:

```
meta         mode=real   reason=allowed   store=redis
resolution   reasoningProvenance=real   confidence=0.96
calibration  fitted, applied to a live reply
```

Fit 2 and the Gemini injection re-verification both ran locally beforehand - 200 live calls and 25
assertions respectively, details in `BUILD_LOG.md`.

**The key lives in `.env.local` locally** (gitignored). You had put it in `.env.example`, which is a
**committed** file; it was moved before any commit and `git log -S` confirms it never reached
history. If it was pasted anywhere else, rotate it at https://aistudio.google.com/apikey - free.

**A bug this step found:** the per-IP cap was bypassable with one `x-forwarded-for` header, because
Vercel appends to that header rather than replacing it. Now fixed to use the platform-set
`x-vercel-forwarded-for` / `x-real-ip`, re-tested with five spoofed addresses sharing one bucket.
The daily cap was global throughout, so the exposure was always bounded at 300 free calls a day.

### If you want to watch it

```bash
curl -N "https://<your-deploy>/api/investigate?dispute=DSP-1009" | grep -o 'reasoningProvenance...real'
```

Three live runs per hour per IP. The fourth degrades to canned reasoning mid-stream with a `limit`
event and an in-theme notice - that path has now been seen working on the real deployment, not just
in tests.

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

## 9. ~~Harden the ingestion path~~ - done

`/api/ingest` used to have no rate limiting at all: a bot could loop 1MB uploads and make the server
parse them forever. It now has its own per-IP hourly window, `RATE_LIMIT_INGEST_PER_HOUR` (default
20), checked before the body is read.

Kept deliberately separate from the reasoning limiter, because they answer different questions.
`checkRateLimit` answers "may this spend a live model call?", and answering it consumes a visitor's
whole live-reasoning allowance for the hour. Ingestion makes zero model calls, so charging it there
would mean three CSV uploads silently burn someone's ability to see real reasoning - and would make
`callsUsedToday` stop being a true count of calls made.

It also refuses instead of degrading. The resolver can fall back to canned prose and still be
correct; there is no canned validation of somebody's file, so this returns a real `429` with
`Retry-After`. The message flows into `report.fatal`, which the upload panel already renders.

**One thing to remember:** `npm run test:e2e` posts several uploads per run, so start its server with
the limit raised - `RATE_LIMIT_INGEST_PER_HOUR=1000 npm run start`. The suite detects a 429 and tells
you this rather than failing every ingest assertion.

Still not done, and still optional: a virus/content scan. Only worth it if uploads are ever
persisted - today nothing is written to disk or a database.

---

## Do not

- **Do not** commit a real key. `.env` and `.env*.local` are gitignored; `.env.example` carries only
  placeholders.
- **Do not** assume the rate limiter is global until step 4 shows `"store":"redis"`. It said
  `"memory"` for a while with Upstash fully connected.
- **Do not** add a key and tighten the caps afterwards. Tighten first.
- **Do not** trust `x-forwarded-for` for anything that gates cost. Vercel appends to it; the caller
  controls the left-most entry.
- **Do not** expect the real reasoning path to have been exercised *on the deployment*. Locally it
  has: ~410 live calls across Fit 2, the injection suite and smoke checks, all clean.
- **Do not** hand-edit `lib/resolver/fitted.ts` or `lib/resolver/calibration.ts`. They are generated
  by `npm run fit:weights` / `npm run fit:calibrate`; edit the scripts and re-run.
- **Do not** let `calibration.ts` ship a fabricated fit to make the UI look finished. Its `null`
  state is load-bearing honesty - the app says "uncalibrated", and that is currently true.
