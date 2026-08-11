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

## Status

This build runs in **mock mode** by default — no real Anthropic API key is present. All resolver reasoning shown is realistic, well-constructed canned output tied to the bundled fixture data, streamed with the same pacing real mode uses. Dropping a real `ANTHROPIC_API_KEY` into the environment flips it to live reasoning with zero code changes, behind the rate limiter described below.

See `MORNING_CHECKLIST.md` for exactly what to do to go live.

## Tech stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Anthropic API (`@anthropic-ai/sdk`) for the resolver's reasoning step
- Server-Sent Events for live streaming of resolver output
- No database — evidence fixtures are bundled JSON; nothing here needs to persist across requests

## Guardrails

- **Rate limited** by IP and by a global daily cap before any real API call is made (see `DECISIONS.md` / source for current limits) — falls back to mock mode automatically if exceeded, rather than erroring.
- **Fixed token budget** per resolver call — no open-ended generations.
- No payment processor is integrated anywhere in this project. Groundtruth resolves evidence about transactions; it never creates, captures, moves, or charges anything.

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Works fully in mock mode with no environment variables set.

## Project structure

```
/app              routes and pages (Reconcile, Investigate)
/lib/resolver     the Transaction Resolver core logic
/lib/fixtures     mock evidence data (settlement, orders, shipments, chat logs)
/lib/ratelimit    the rate limiter guarding real API calls
```

*(Exact paths and commands get finalized during the build — this is the intended shape.)*

## What's next

See `MORNING_CHECKLIST.md` for the concrete steps to move from mock mode to a fully live deployment.
