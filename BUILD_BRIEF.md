# BUILD BRIEF: Groundtruth — Transaction Resolver
**Read this whole file before writing any code. This is an overnight, unattended run — no human will be available to answer questions, approve actions, or break ties until morning.**

*(Working name: Groundtruth. Rename freely if you land on something better — but keep it functional, not cute.)*

---

## 0. Mission

Build and deploy a live web app that solves one real, hard problem: **given multiple messy, independent, sometimes-conflicting data sources about a transaction, determine what actually happened — with an explicit confidence score and a plain-English explanation for every discrepancy.**

This is a genuine entity-resolution / reconciliation-under-uncertainty problem. It's not dressed up — it's the actual thing payments companies struggle with and pay to solve.

Build one shared core engine, the **Transaction Resolver**, and two real workflows on top of it:

1. **Reconcile mode** — ingest a bank statement + an internal settlement report (realistic mock data), run every transaction through the resolver, and output three buckets: cleanly matched, matched-with-an-explained-difference (timing lag, currency rounding, partial refund, fee deduction), and genuinely unmatched/flagged — each with a specific, evidence-based explanation, not a generic "mismatch."
2. **Investigate mode** — given one disputed transaction and a chargeback/dispute reason, the resolver pulls together every fragment of evidence about that transaction (order record, shipment tracking, support chat log, reconciliation status) into a single timeline, marks what supports vs. contradicts the customer's claim, and a second-stage agent drafts a rebuttal letter with a win-likelihood score that cites the specific evidence it's based on.

**The bar here is explicitly stated by the brief this is being built for: prioritize core logic over surface polish.** The reasoning has to actually be good — genuinely hard cases resolved correctly, explanations that hold up, confidence scores that mean something — more than the app needs to look impressive. Build accordingly: most of tonight's effort should go into the resolver's logic and the quality/variety of its test cases, not into UI chrome.

---

## 1. Non-negotiable rules for operating unattended

You will not have a human to ask questions tonight. Internalize this:

- **Never stop and wait for input.** If you hit a decision point (a library choice, a naming choice, an ambiguous requirement), make the most reasonable call yourself, write one line about it in `DECISIONS.md`, and keep moving. Do not pause the build to ask a question nobody will answer.
- **Checkpoint constantly.** `git commit` after every working milestone, with a real message. If you break something later, you can always roll back. Never let uncommitted work sit for more than ~20 minutes of active building.
- **Keep a running build log.** Append timestamped entries to `BUILD_LOG.md` as you go — what you just finished, what's next, anything you're unsure about. Assume the person reading this in the morning has zero context and needs to understand the state of the project in 60 seconds.
- **Never leave the critical path broken.** Both the Reconcile flow and the Investigate flow must fully work, end to end, at all times after each milestone commit — even if running on mock/canned reasoning (§6). Do not leave either half-wired overnight.
- **Fix your own errors.** If a build fails, a test fails, or a deploy fails, diagnose and fix it yourself before moving on. Don't leave broken code and move to the next task.
- **If genuinely blocked** on something only a human can unblock — build the mock/stub version so everything else keeps working, write exactly what's needed in `MORNING_CHECKLIST.md`, and continue with everything else. Never let one blocked piece stall the whole night.
- **Do not attempt a production deploy overnight.** Deploy to a Vercel **preview** URL only (`vercel deploy`, no `--prod`). Production deploys are more likely to get flagged by the safety classifier, and in unattended mode a repeated block aborts the whole session instead of waiting for approval. A preview URL is a completely valid, clickable live link for the submission. Leave the one-command promotion to production as the first line of `MORNING_CHECKLIST.md`.

---

## 2. Guardrails against real spend

**No real Anthropic API key exists in this environment tonight.** `ANTHROPIC_API_KEY` will either be unset or a placeholder value like `sk-ant-placeholder`. This is intentional. Build and fully verify the entire app in mock mode (§6). A human adds the real key themselves tomorrow morning, after reading the rate-limiter code, on their own terms.

**Rate limiting (required, not optional) for whenever a real key is added later:**
- Every route that calls the Anthropic API in real mode must be rate-limited, active from the first commit that adds real-mode calling.
- Limit by IP: default 10 real resolver runs per IP per hour, configurable via `RATE_LIMIT_PER_IP_PER_HOUR`.
- Global daily cap across all traffic (`DAILY_REAL_CALL_CAP`, default something conservative like 200). Once hit, the app falls back to mock mode automatically rather than erroring — failing safe, not failing open.
- An in-memory sliding-window limiter scoped to the serverless function is an acceptable baseline tonight (imperfect across cold starts, zero signup required). Note a persistent-store upgrade (e.g. Upstash Redis free tier) as optional in `MORNING_CHECKLIST.md` — don't block the night setting one up.
- Firm `max_tokens` on every Anthropic API call — no open-ended generations.
- Write an automated test that fires more requests than the configured limit and confirms the excess ones are correctly blocked or routed to mock mode. Capture that test's output in `BUILD_LOG.md`.

**General principle for the whole night:** if an action would provision paid infrastructure, upgrade a tier, register a new paid account, or spend real money in any way — don't do it. Build the mock/local/free equivalent, document what a human would need to do to enable the real version, and move on. This overrides speed or completeness anywhere they conflict.

*(No payment processor integration exists in this project — see §4 — so there's no live-vs-test-key risk to guard against beyond the Anthropic API spend above.)*

---

## 3. Hard scope (do not expand this)

- **One core engine, two workflows.** Don't add a third workflow, don't generalize the resolver into an unbounded general-purpose reasoning tool. Reconcile and Investigate only.
- **All data is realistic mock/synthetic data**, bundled as fixtures in the repo — no live bank, no live payment processor, no external data source. Design the fixtures to include genuinely hard cases: a duplicate charge, a partial refund not yet reflected, a timing lag across a day boundary, a currency-rounding difference, a case where evidence genuinely conflicts and the honest answer is "flagged, insufficient confidence" rather than a forced resolution.
- **No user accounts, no persistent multi-user state, no database.** Each run works against the bundled fixture data; keep everything in server memory / client state for the duration of a request.
- If you finish the core scope with time to spare, the only acceptable additions are: (a) more and harder test cases in the fixture data — this is the best use of extra time, directly serves "core logic over surface polish", (b) a couple of pre-selected example disputes as one-click demo entries so the live demo is reliable, (c) light UI polish per §5. Do not add new workflows, auth, or a payment processor integration.

---

## 4. Architecture & stack

- **Next.js 14+ (App Router), TypeScript, Tailwind CSS.** Single repo, single deploy target: Vercel. (Any stack was allowed by the brief this targets — this one is chosen for build speed and reliable one-command Vercel deploys, not because it's required.)
- **Anthropic SDK (`@anthropic-ai/sdk`)**, gated behind the rate limiter and mock-mode detection from §2/§6. Use `claude-sonnet-4-6`.
- **No database.** Fixture data lives as JSON files in the repo. The rate limiter's in-memory store is the one exception, and it's a safety mechanism, not app data.
- **No payment processor integration of any kind.** This project resolves and explains transactions; it never creates, captures, or charges anything. If you find yourself reaching for a payments SDK, stop — that's out of scope.
- **Streaming:** SSE from a route handler so the frontend can show the resolver's reasoning step by step as it runs, not after a delay — this is where the "trace" earns its keep, since here it's the actual logic being shown, not decoration.
- **Deployment:** Vercel CLI (`vercel deploy` for preview builds; do not run `vercel --prod` overnight — see §1).

---

## 5. Design direction: clean, confident, and well-crafted — not boring, not busy

The brief this is being built for explicitly says: prioritize core logic over surface polish. Take that seriously — this is not the place for a maximalist, heavily-animated treatment. **But restrained does not mean generic, default, or lazy.** A cheap-looking UI undermines trust in the logic sitting behind it just as much as an overdone one distracts from it. The target is disciplined and good, not plain.

Concretely:
- **No default-looking UI.** No unstyled system font stack, no untouched shadcn-default gray palette, no "Tailwind starter template" feel. Pick a real typeface pairing with actual character (a considered display face for headers, a clean workable body face) and a deliberate 4-6 color token system used with intention — this takes the same five minutes of decision-making as picking a boring default, so there's no excuse to skip it.
- **Clarity over spectacle, not clarity over craft.** Uncluttered layout, generous and consistent spacing rhythm, real attention to alignment and hierarchy. Quiet, not empty or thoughtless.
- **One well-executed detail beats zero.** Tasteful micro-interactions where they clarify a state change (a status settling from "checking" to "matched," a hover state with real intention behind it) are welcome — the constraint is that motion should justify itself functionally, not that there should be none.
- **The evidence trail is the one thing worth making genuinely good-looking.** Both workflows center on showing sources agreeing, conflicting, and a confidence score landing — invest your design effort there: a clear visual language for "these two sources agree," "this is a resolved discrepancy, here's why," "this is a genuine conflict, flagged." That visual clarity *is* the core logic made legible — it's not decoration on top of it, so it's worth doing well.
- **Motion, if any, should be functional** — a value settling into place, a status resolving from "checking" to "matched"/"flagged" — not ambient flourish. Skip elaborate page-load choreography; it's not what this brief is asking for.
- **Fully responsive still matters** — test real layouts at 375px, 768px, 1024px, 1440px+, no horizontal scroll, touch targets sized properly on mobile. This is a baseline quality bar regardless of how minimal or maximal the direction is.
- **Respect `prefers-reduced-motion` and keep visible keyboard focus states throughout.**
- **Copy:** plain, specific, exact. "3 transactions flagged — insufficient evidence to resolve automatically," not "Uh oh, some issues!" The tone should read like a serious ops tool, because that's genuinely what this is.

---

## 6. The Transaction Resolver — this is the actual project

This is where your build time should concentrate tonight.

**Core resolver logic**, callable from both workflows:
- Input: a transaction identifier plus whatever fragments of evidence exist for it across the fixture data sources (settlement record, order record, shipment tracking, support chat log — not every source will exist for every transaction; missing data is itself a signal).
- Process: reconcile the fragments into a single timeline of what happened, using a mix of deterministic checks (amount matching within known fee/rounding tolerances, timestamp windows, ID matching) and an LLM reasoning step for the genuinely ambiguous parts (does this chat log excerpt corroborate or contradict the claim; is this timing gap explainable or suspicious).
- Output: a resolved status (`matched` / `explained-difference` / `flagged`), a confidence score, and a plain-English explanation that cites which specific evidence it used. When evidence genuinely conflicts or is insufficient, the honest output is a flagged/low-confidence result — do not force a false resolution. That honesty is itself part of "core logic done well."

Behind the rate limiter and mock-mode fallback from §2/§7, stream the resolver's steps to the frontend as they happen (source-by-source, not just a final answer) so both workflows visibly show their work.

**Reconcile mode**: runs the resolver across every transaction in a bundled mock bank-statement + settlement-report pair, and renders the three-bucket output described in §0.

**Investigate mode**: runs the resolver against one selected disputed transaction plus its dispute reason, then a second-stage agent drafts a rebuttal letter and a win-likelihood score built directly from the resolver's output — every claim in the rebuttal should trace back to a specific piece of resolved evidence, not generic boilerplate.

---

## 7. Mock mode (this is what you're building and testing all night)

Auto-detect mock mode: if `ANTHROPIC_API_KEY` is missing or a placeholder, fall back automatically. Given §2, this means the entire night is built and proven in mock mode by design.

- Canned responses should be genuinely varied and well-reasoned across the different fixture cases — not one generic template reused everywhere. Write a distinct, well-argued mock resolution for each hard case in your fixture data (the duplicate charge, the partial refund, the currency rounding, the genuinely-flagged one), since the quality of these *is* most of tonight's actual deliverable.
- Stream mock steps with the same pacing/structure real mode would use, so the demo looks and feels identical either way.
- When a real key is added later, detection should be automatic with zero further code changes, still behind the rate limiter from §2.

---

## 8. Build milestones (rough order — commit after each)

1. Scaffold a brand-new Next.js project from scratch — do not copy, reference, or reuse code from any previous project in this environment (an earlier "App Factory" concept was scrapped; this is a clean start). Tailwind config, basic layout, deploy an empty "hello world" to a Vercel preview URL first — confirm the deploy pipeline works before building features on top of it.
2. Design and write the fixture data: a mock bank statement, mock settlement report, mock order records, mock shipment tracking, mock support chat logs — covering clean matches and every hard case listed in §3. This is foundational; do it carefully, it drives everything else.
3. Build the Transaction Resolver core logic (deterministic checks + LLM reasoning step) against the fixtures, in mock mode, with a script that runs it across every fixture case and prints the resolved output for manual review.
4. Build the rate limiter from §2, with an automated test proving it works, before building more real-mode calling code around it.
5. Build Reconcile mode: batch run + three-bucket output UI.
6. Build Investigate mode: single-transaction timeline + rebuttal draft + win-likelihood score.
7. Design pass per §5 — clean and legible, evidence trail as the one area of real visual investment.
8. Write the real-mode Anthropic code path behind mock-mode detection and the rate limiter — correctly wired but untested tonight since no real key exists; leave clear verification notes in `MORNING_CHECKLIST.md`.
9. Add 2-3 pre-selected example disputes / a pre-loaded reconciliation run as one-click demo entries so the live demo doesn't depend on live-typing something untested.
10. Full run-through verification (§9), then a Vercel preview deploy of the final state.
11. Write `README.md` and `MORNING_CHECKLIST.md`.

---

## 9. Verify before calling anything "done"

- `npm run build` completes with zero errors.
- Run the resolver against every fixture case (including the hard ones) and confirm, by reading the actual output, that the reasoning is sound and the honest cases are correctly flagged rather than force-resolved. Paste this output into `BUILD_LOG.md`.
- Run the rate-limiter test and confirm, with real output, that requests over the limit are blocked or mocked.
- Exercise both Reconcile mode and Investigate mode end to end via script/curl and confirm correct output at each stage; capture output in `BUILD_LOG.md`.
- Load the deployed Vercel preview URL and confirm HTTP 200 and correct rendering.
- Check the app at 375px, 768px, 1024px, and 1440px+ widths.

---

## 10. Deployment

- Use `vercel deploy` (preview) repeatedly as you go.
- Do **not** run `vercel --prod` overnight (see §1).
- `ANTHROPIC_API_KEY` stays a placeholder — a human adds the real one deliberately, later. Document exactly where in `MORNING_CHECKLIST.md`.

---

## 11. Files to maintain throughout the night

- **`BUILD_LOG.md`** — timestamped, running log, plain language. First thing read in the morning.
- **`DECISIONS.md`** — every unsupervised call you made, one line each: what and why.
- **`DESIGN_NOTES.md`** — the (deliberately restrained) token system from §5.
- **`MORNING_CHECKLIST.md`** — exact steps to go from preview-in-mock-mode to fully live, including reviewing the rate limiter in §2 before adding a real `ANTHROPIC_API_KEY`.
- **`README.md`** — a polished draft has been provided at the repo root as your starting point. Keep its structure, tone, and level of craft — refine it with real, accurate specifics as you build (exact run commands, the actual deployed URL, what's mocked vs real tonight). Do not replace it with a generic auto-generated README.

---

## 12. Definition of done for tonight

1. `npm run build` succeeds with zero errors.
2. The Transaction Resolver produces sound, evidence-cited reasoning across every fixture case, including correctly flagging genuinely ambiguous ones — verified by reading real output, captured in `BUILD_LOG.md`.
3. Both Reconcile mode and Investigate mode work end to end, verified the same way.
4. The rate limiter is implemented and proven by an automated test.
5. No real `ANTHROPIC_API_KEY` was used or required to reach a fully working demo tonight.
6. The UI is clean, legible, and responsive at 375px through 1440px+ — restrained per §5, not maximalist.
7. A live Vercel preview URL is up, returns HTTP 200, and renders correctly.
8. All work is committed to git with a clean, readable history.
9. `BUILD_LOG.md`, `DECISIONS.md`, `DESIGN_NOTES.md`, `MORNING_CHECKLIST.md`, `README.md` are all complete and accurate.

If you reach a natural stopping point before all of this is true, stop, write exactly what's blocking you at the top of `BUILD_LOG.md`, and leave everything else in its best working state rather than continuing to churn.
