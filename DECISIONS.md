# DECISIONS

Every unsupervised call made during the build, and why.

## Stack and scaffolding

- **Hand-scaffolded Next.js instead of `create-next-app`** — wanted full control over the type
  system and Tailwind token config from the first commit rather than deleting boilerplate.
- **Tailwind v3.4, not v4** — v3's config file is where the design tokens live; v4's CSS-first
  config buys nothing here and is a compatibility risk overnight.
- **Bumped Next 14.2.33 → 14.2.35** — npm flagged a security advisory on the version I first pinned.
- **`target: es2019` in tsconfig** — the default target rejected `for...of` over a `Map`, which the
  evidence-bundling code uses. Lowest target that compiles cleanly.
- **Vercel project named `groundtruth`** — the directory `GroundTruth` is not a valid project name
  (uppercase), so the first `vercel deploy` failed. Linked explicitly with `--project groundtruth`.

## Resolver design

- **Log-odds weights instead of pass/fail checks.** A confidence score has to come from somewhere
  defensible. Each check contributes a signed weight; confidence is the sigmoid of the sum. This
  makes the number auditable — you can point at which check moved it and by how much.
- **Confidence means "the stated account of this transaction is correct"**, not "this transaction is
  fine". That is why TXN-1012 is flagged at 84%: we are confident the $12.40 shortfall is real and
  unexplained. Stated in the UI so the number is not misread.
- **Two hard caps on top of the score.** A *coverage cap* (0.80 + 0.04 × sources present) stops the
  resolver being maximally confident on partial evidence. An *identifiability cap* of 40% applies
  when a bank line has more than one equally good claimant. Without the second cap, TXN-1007A/B
  would have scored ~0.45 on their internally-consistent evidence and been resolved — which would be
  wrong.
- **Ceiling of 97%, floor of 5%.** Payments evidence is never certain; a 100% claim would be a lie.
- **Flag threshold at 60%**, plus an unconditional flag on any conflict weighing ≤ −1.0. The second
  rule is what catches TXN-1006, which scores 92% — high confidence in a bad finding still needs a
  human.
- **The LLM step can move the score but cannot override it.** It contributes one weighted check like
  any other. This keeps a hallucinated narrative from turning a conflict into a match.
- **Contested bank lines are assigned to nobody.** The matcher records the contest on every claimant
  rather than picking one. This is the mechanism that makes the ambiguous case honest rather than
  a coin flip.
- **Business days, not calendar days, for posting windows** — otherwise every Friday capture looks
  like a three-day delay. TXN-1003 exists specifically to exercise this.
- **FX tolerance = max(5 cents, 0.5 bp)** — wide enough for independent rounding on both legs,
  far too tight to swallow a real shortfall.

## Mock mode

- **Hand-written reasoning per case, not a template.** Sixteen distinct arguments in
  `lib/resolver/mock-reasoning.ts`, each citing the specific records involved. The brief says the
  quality of these *is* most of the deliverable, so they were written as the argument a careful
  analyst would actually make, including the cases where the honest answer is "I cannot tell".
- **A derived fallback exists** for any transaction without a hand-written entry, so adding fixture
  data never breaks the app — it just produces less interesting prose.
- **Mock steps are paced (90–420 ms)** to match real-mode latency, so the demo looks identical
  either way.
- **`provenance: "mock" | "real"` is surfaced in the UI on every resolution.** Never let someone
  think they are looking at live reasoning when they are not.

## Real mode

- **`claude-sonnet-4-6`**, as the brief specifies, made overridable via `ANTHROPIC_MODEL`. Confirmed
  current and correctly formatted (no date suffix).
- **`max_tokens: 1200`, firm.** No open-ended generations.
- **No `thinking` parameter.** A bounded, well-scoped reasoning step does not need it, and it would
  add latency and tokens to a call that is already rate-limited for cost.
- **JSON asked for in the prompt and parsed defensively**, rather than structured outputs — Sonnet
  4.6 is not in the structured-outputs support list, and a defensive parse degrades to mock instead
  of failing the run.
- **A live-API failure falls back to mock rather than surfacing an error.** Fail safe, not open.

## Rate limiting

- **Two independent limits** (per-IP hourly, global daily) because they fail for different reasons:
  one person hammering it, versus aggregate traffic. Either alone leaves a hole.
- **Exhaustion routes to mock, never errors.** The brief calls for failing safe; this also means the
  demo cannot be broken by hitting the limit.
- **Placeholder keys are treated as no key.** `sk-ant-placeholder` must never enable spend.
- **In-memory store, per serverless instance.** Accepted as the tonight-baseline: no signup, no cost,
  and errs conservatively per instance. Upgrade documented, not built.

## Rebuttal engine

- **Win likelihood is computed, not asserted** — a published per-reason-code baseline plus signed,
  cited evidence factors, through the same sigmoid. The factor bars in the UI are the score's
  derivation, not decoration.
- **Capped at 88%, floored at 5%.** Issuers are unpredictable; a 95% claim on a chargeback would be
  dishonest.
- **Two of the four disputes return "do not represent".** DSP-1010 and DSP-1006 come back
  `accept-liability` — for DSP-1006 the decisive evidence against us is our own settlement export.
  Building an app that only ever tells you to fight would have been easier and worthless.

## Design

- **Instrument Serif + IBM Plex Sans + IBM Plex Mono.** A display serif with real character against
  a workhorse humanist sans, plus a mono for every identifier and figure. Details in
  `DESIGN_NOTES.md`.
- **Light-only, no dark mode.** A deliberate commitment rather than an omission — one palette done
  properly beats two done at 2am.
- **The confidence meter draws the 60% threshold**, so you can see how close a call was rather than
  only which side it landed on.
- **Motion limited to two things**: rows settling in as they stream (220 ms) and a three-dot pulse
  while reasoning runs. Both report state changes. `prefers-reduced-motion` disables them.

## Process

- **`README (1).md` renamed to `README.md`** and refined in place — the brief said keep its
  structure and craft, so it was edited, not replaced.
- **Playwright driving installed Edge (`channel: "msedge"`)** rather than downloading Chromium —
  same verification, no 150MB download.
- **Deployment protection left enabled.** Disabling it was blocked by the environment's safety
  classifier. Documented as step 1 of `MORNING_CHECKLIST.md` rather than worked around.
