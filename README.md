# Groundtruth

**What actually happened to this transaction?**

Groundtruth resolves what really occurred across messy, conflicting records of a payment — a settlement feed, an order record, a shipment tracker, a support chat log — and says so with an explicit confidence score and a plain-English explanation. No forced answers: when the evidence genuinely conflicts, it says that too.

Built on top of that one resolver are two real workflows:

- **Reconcile** — batch-check a settlement report against a bank statement. Every transaction lands in one of three buckets: cleanly matched, matched with an explained difference (timing lag, partial refund, currency rounding, fee deduction), or genuinely flagged.
- **Investigate** — point it at a single disputed transaction and a chargeback reason. It assembles every fragment of evidence into a timeline, marks what supports and what contradicts the claim, and drafts a rebuttal with a win-likelihood score that cites the specific evidence behind it.

## Why this exists

Reconciliation and dispute defense are two of the least glamorous, most expensive problems in payments — usually solved with brittle rule engines or hours of manual cross-referencing. Groundtruth treats them as one underlying problem: resolving the truth about a transaction from incomplete, sometimes-contradictory sources. Solve that well once, and both workflows fall out of it.

## How it works

```
Evidence sources (settlement, order, shipment, chat log)
              │
              ▼
     ┌─────────────────┐
     │ Transaction      │   deterministic checks (amounts, timestamps, IDs)
     │ Resolver         │ + LLM reasoning for ambiguous evidence
     └─────────────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
 Reconcile          Investigate
 (batch, 3 buckets) (single case, rebuttal + score)
```

Every resolver run streams its reasoning step by step to the UI as it happens — you watch the evidence get weighed, not just a spinner followed by an answer.

### What the confidence score actually is

Not a vibe. Each deterministic check — amount against the published fee schedule, posting window in *business* days, FX rounding tolerance, ID linkage, captures against the order total — contributes a signed log-odds weight. The reasoning step contributes one more. Confidence is the sigmoid of the sum, then capped twice:

- by **evidence coverage**, so a unit with two sources can't score like one with five;
- hard at **40%** when a transaction isn't uniquely identifiable — two settlements matching one unlabelled bank credit equally well.

Below **60%** the resolver flags instead of resolving. It never claims more than **97%**. The score means *"the stated account of this transaction is correct"* — so a real, unexplained shortfall can be flagged at high confidence, because we're confident about the finding.

The reasoning step can move the score. It cannot override the arithmetic that produced it.

## The hard cases

The bundled fixtures are built so each difficult case is difficult for a *different* reason:

| Case | What makes it hard |
|---|---|
| Duplicate capture (TXN-1006) | Reconciles perfectly against the bank — $145.04 in, $145.04 settled. Only visible by comparing captures to the order total. |
| Two identical claimants (TXN-1007A/B) | One unlabelled credit, two customers who bought the same bench 13 minutes apart. **Correctly refused at 40%** rather than coin-flipped. |
| Weekend posting lag (TXN-1003) | A 2.5-day calendar gap that is one business day. |
| Currency rounding (TXN-1004) | Two cents on a EUR→USD settlement — inside tolerance, not a shortfall. |
| Partial refund in flight (TXN-1005) | Authorised, not yet drawn. The bank is right; the ledger is ahead. |
| Partial capture (TXN-1013) | $20 short, explained only by a support transcript. |
| Unexplained shortfall (TXN-1012) | $12.40 gone, and every ordinary explanation ruled out rather than merely doubted. |
| Orphan bank debit (BNK-009) | No internal record of any kind. Flagged at 20%. |

Result: **6 matched, 5 explained differences, 5 flagged.**

Investigate carries four disputes — and recommends **not** fighting two of them. For the duplicate-charge chargeback, the evidence that defeats us is our own settlement export.

## Status

This build runs in **mock mode** by default — no real Anthropic API key is present. All resolver reasoning shown is realistic, well-constructed canned output tied to the bundled fixture data, streamed with the same pacing real mode uses. Every deterministic check, confidence score and bucket assignment is computed live from the fixtures either way. Dropping a real `ANTHROPIC_API_KEY` into the environment flips it to live reasoning with zero code changes, behind the rate limiter described below.

Every resolution shows its provenance (`mock` / `real`) in the UI, so live and canned reasoning are never confused.

See `MORNING_CHECKLIST.md` for exactly what to do to go live, and `BUILD_LOG.md` for verification output.

## Tech stack

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Anthropic API (`@anthropic-ai/sdk`, `claude-sonnet-4-6`) for the resolver's reasoning step
- Server-Sent Events for live streaming of resolver output
- No database — evidence fixtures are bundled JSON; nothing here needs to persist across requests

## Guardrails

- **Rate limited** by IP (10 real runs/hour, `RATE_LIMIT_PER_IP_PER_HOUR`) and by a global daily cap (200, `DAILY_REAL_CALL_CAP`) before any real API call — both **fall back to mock mode rather than erroring**. Placeholder keys never enable spend.
- **Fixed token budget** per resolver call (`max_tokens: 1200`) — no open-ended generations.
- No payment processor is integrated anywhere in this project. Groundtruth resolves evidence about transactions; it never creates, captures, moves, or charges anything.
- All data is synthetic.

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Works fully in mock mode with no environment variables set.

```bash
npm run build            # zero errors
npm run resolver         # every fixture case, full reasoning + citations
npm run resolver TXN-1006
npm run test:ratelimit   # spend-guard proof
npm run test:e2e         # both workflows over HTTP (needs `npm run start` running)
npx tsx scripts/test-responsive.ts   # 375 / 768 / 1024 / 1440px
```

## Live demo

https://groundtruth-lkzoy2i66-arnav-guptas-projects-4ac946ea.vercel.app

Currently behind Vercel SSO deployment protection (302 unless you're logged into the team) — one command in `MORNING_CHECKLIST.md` makes it public.

## Project structure

```
/app                    routes, pages, and the two SSE endpoints
  /api/reconcile        batch stream
  /api/investigate      single-case stream + rebuttal
/components             evidence-trail UI and the SSE hook
/lib/fixtures           mock evidence (bank, settlement, orders, shipments, chats, disputes)
/lib/resolver           checks.ts · resolve.ts · mock-reasoning.ts · llm.ts · rebuttal.ts
/lib/ratelimit.ts       the spend guard
/scripts                resolver runner + rate-limit, e2e and responsive tests
```

## What's next

See `MORNING_CHECKLIST.md` for the concrete steps to move from mock mode to a fully live deployment.
