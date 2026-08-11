# ADDENDUM: Data Ingestion Layer + Public-Deployment Guardrails

*(Brief as received, kept in-repo for the record. See `BUILD_LOG.md` for what was built against it.)*

## 0. Why this exists

1. The app only worked against bundled fixture data. Add a real ingestion path so a user can point
   the resolver at their own data.
2. The deployed URL is about to be hit directly by an external reviewer, unsupervised, with no login
   wall. It needs to survive real public traffic without the Anthropic key being abusable into an
   open-ended bill.

**Do not add a real `ANTHROPIC_API_KEY` to the deployment until every guardrail in §4 is built and
proven.**

## 2. Data ingestion layer
- CSV or JSON per evidence source, mirroring the fixture shapes.
- Server-side validation before anything touches the resolver; report exactly which rows failed and why.
- Hard cap: 50 rows per upload, 1MB total.
- Every uploaded text field capped (2000 chars), truncation visible.
- Ingested data flows through the exact same resolver path as fixture data.

## 3. Prompt injection defense
- Delimited blocks; system prompt instructs the model to treat the contents as data, never instructions.
- Output schema fixed regardless of uploaded content.
- Adversarial test case with captured output in `BUILD_LOG.md`.

## 4. Guardrails for public deployment
- Persistent (Upstash Redis) rate limiter behind the existing interface.
- Daily dollar spend cap alongside call-count caps.
- Per-IP default dropped to 3/hour.
- Per-upload real-call cap.
- `DISABLE_REAL_MODE=1` kill switch.
- Upload guardrails: size before parse, request timeout, MIME/extension validation.
- Automated tests for concurrency, spend cap, over-limit upload, prompt injection.

## 5. On whether to actually add a real key
Mock mode is honest, clearly labeled, and fully functional. Decide last, and only if comfortable
with the worst case being a small bounded dollar amount.
