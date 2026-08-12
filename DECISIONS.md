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
- **Confidence originally meant "the stated account of this transaction is correct"** — which is why
  TXN-1012 was flagged at 84%. **Superseded by Fit 1**, which retargeted the score onto
  *P(this needs no human)*. See the addendum below; the buckets did not move but the numbers now mean
  something different, and more consistent.
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
- **In-memory store, per serverless instance.** Accepted as the overnight baseline: no signup, no
  cost, and conservative per instance. **Superseded** — see the addendum below; it is now Upstash
  Redis when configured, with the in-memory store as the unconfigured fallback.

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

- **Instrument Serif + IBM Plex Sans + IBM Plex Mono** originally. **Superseded by Geist Sans +
  Geist Mono** after the site was reported laggy: two self-hosted variable fonts instead of six
  Google-hosted files. Details and the display-type tuning in `DESIGN_NOTES.md`.
- **Light-only, no dark mode.** A deliberate commitment rather than an omission — one palette done
  properly beats two done at 2am.
- **The confidence meter draws the 60% threshold**, so you can see how close a call was rather than
  only which side it landed on.
- **Motion limited to state changes** — rows settling as they stream, a pulse while reasoning runs,
  and (added in the design pass) route transitions and staggered card reveals. `prefers-reduced-motion`
  disables all of it. The blurred animated backdrop from that pass was removed again for performance.

## Process

- **`README (1).md` renamed to `README.md`** and refined in place — the brief said keep its
  structure and craft, so it was edited, not replaced.
- **Playwright driving installed Edge (`channel: "msedge"`)** rather than downloading Chromium —
  same verification, no 150MB download.
- **Deployment protection left enabled.** Disabling it was blocked by the environment's safety
  classifier. Documented as step 1 of `MORNING_CHECKLIST.md` rather than worked around.

---

## Addendum — ingestion layer and public-deployment guardrails

### Schema and architecture

- **`buildEvidenceBundles(dataset)` takes a dataset instead of reading fixtures.** The brief's
  requirement that the resolver "should not know or care" where evidence came from is only true if
  there is one code path, so the fixtures were re-expressed as an ordinary `EvidenceDataset` and pass
  through the same function as an upload. `origin` is carried for display only and never branches logic.
- **The fee schedule moved onto the bundle.** It used to be module-level state read from the fixture
  JSON. With uploads that becomes wrong — one merchant's rate is not another's — and worse, it would
  be shared mutable state under concurrency. It now travels with the evidence, and is a form field on
  the upload.
- **`checkRateLimit` is now `async`.** Unavoidable: Redis is a network call. The brief asked for the
  interface to stay put, and it did in shape (`(ip, opts) → Decision`), but the signature had to gain
  a Promise. Two call sites in `lib/stream.ts` changed; nothing else in the app did.
- **A dependency-free CSV parser** rather than a library. The upload endpoint accepts public input,
  and a ~90-line parser I can read end to end is a smaller attack surface than a transitive dep tree.

### Security posture

- **The resolve endpoints re-validate the dataset.** `/api/ingest` is a convenience, not the boundary.
  A client can POST a hand-made dataset straight to `/api/reconcile`, so `clampDataset()` re-applies
  the row cap and re-sanitises every string there too. The e2e suite proves an 80-row hand-made
  dataset is still refused.
- **Prompt-injection defence is structural first, prompt second.** The system-prompt instruction is
  worth having, but it depends on the model complying. The load-bearing defence is that the model
  *cannot* set status or confidence — those are computed from deterministic checks, and its only
  output that touches the score is a weight clamped to [-1, 1]. The test asserts this by feeding in a
  reply with `weight: 9999` and confirming nothing moves.
- **The sanitiser neutralises delimiters visibly** (`[redacted-delimiter]`) rather than stripping them
  silently, so a reviewer reading the evidence can see an injection was attempted. That is a finding,
  not noise to hide.
- **Spend uses a headroom reservation, not a post-hoc check.** A call is permitted only if the
  remaining budget covers `WORST_CASE_CALL_USD`. Checking spend *after* the fact would let concurrent
  in-flight calls overshoot the ceiling.
- **Per-IP default dropped 10 → 3/hour**, per the brief's recommendation for public exposure.

### Judgement calls

- **Row cap counts chat messages as rows.** They are the cheapest way to inflate a prompt, so they
  count toward the 50 like anything else.
- **Text truncation is reported per field with before/after lengths**, not a generic "some fields were
  truncated". The brief asked for a visible notice; a count without locations is not actionable.
- **A bad row fails the whole row, not the whole file.** Good rows are still accepted, and every
  rejected row is named with its number, field and reason — matching the brief's "not just a generic
  invalid file".
- **Recommended against adding a real API key.** Not because the guardrails are incomplete — they are
  built and proven — but because the persistent limiter has only ever run against a fake Redis. Until
  a live deployment reports `store: "redis"`, the caps are per-instance and the guardrail that matters
  most isn't actually running. Reasoning is in `BUILD_LOG.md`; the safe sequence is in
  `MORNING_CHECKLIST.md`.

---

## Addendum 2 — Gemini, fitted weights, and showing the math

### Provider

- **Anthropic → Gemini, for one reason: a free tier with no billing account behind it.** This is a
  public, unauthenticated demo. Under Anthropic the worst case was a bounded dollar loss; under
  Gemini's free tier there is no card attached, so past the quota the provider simply refuses and we
  fall back to canned reasoning. That converts the whole spend-guardrail problem into a quota
  problem, which is strictly safer for something anyone can hit.
- **Model IDs and SDK surface confirmed 2026-08-13 against Google's live docs, not recalled** — and
  then cross-checked against `node_modules/@google/genai/dist/genai.d.ts`, which is the only source
  that cannot be out of date relative to the installed code. `@google/genai` v2.16.0,
  `ai.interactions.create({ model, input, system_instruction, generation_config, response_format })`,
  `gemini-3.5-flash-lite`, `generation_config.max_output_tokens`, `thinking_level: "low"`.
  Full table in `BUILD_LOG.md` Addendum 3.
- **Free-tier figures (15 RPM / 1000 RPD / 250k TPM) are the one number I could not read off Google's
  own page** — it now defers to the AI Studio dashboard. They are used only to *size our caps
  conservatively downward* (300/day against a stated 1000), never as a target, so staleness cannot
  hurt us. Recorded here with the date so the next person knows to re-check rather than trust it.
- **The injection defence did not need re-designing for a new provider, and that is the point.** The
  load-bearing guarantee is structural: the model cannot set status or confidence, and its only lever
  is a weight clamped to [-1, 1]. That holds for any provider. Gemini's own behavioural resistance is
  a *second* layer and is not yet re-verified — see the honesty note at the end.

### The two fits

- **Fit 1 replaces hand-chosen check weights with logistic-regression coefficients.** The old weights
  were defensible but arbitrary. Fitted weights are at least *derived from something*, and the
  something is stated: 1,500 synthetic examples over 13 archetypes, ground truth known by
  construction because the generator assigns it.
- **The target changed, deliberately, and the score's meaning changed with it.** Old score: "is the
  stated account of this transaction correct?" New score: "how likely is it that this needs no
  human?" Under the new target a proven duplicate capture scores 37% rather than 92% — correct, since
  it definitely needs a person. The gain is that "flag below 60%" now falls out of the target instead
  of being a bolted-on rule. Every doc, comment and UI string that described the old meaning was
  changed, and one e2e assertion was inverted rather than deleted.
- **AUC 1.0000 is reported alongside the reason not to be impressed by it.** The features were built
  to detect these archetypes, so perfect separation is close to circular. The informative numbers are
  the Brier score (0.0516 against a 74.3% base rate) and the calibration error (0.1744, which is
  poor — L2 shrinkage keeps probabilities off the extremes). Both are on `/how-it-works`, not hidden
  in a log. A metric you only publish when it flatters you is not a metric.
- **Fit 2 (calibrating the model's stated confidence) is isotonic, not another logistic.** The
  raw→true relationship only needs to be monotone, there is no reason to assume it is a logistic in
  the raw weight, and the sample from a free tier is small. Isotonic makes the weaker assumption.
- **Fit 2 refuses to run without a live key rather than fabricating a fit.** `calibration.ts` ships
  as `null`, `calibrateWeight` is an explicit pass-through, and every surface that would show a
  correction says "uncalibrated" instead. A fake calibration would be the single most dishonest thing
  this codebase could contain.
- **Generated files are committed, not gitignored.** `fitted.ts` and `calibration.ts` are build
  inputs; a deploy must not depend on a fitting run having happened on the deploying machine.

### Guardrails, re-framed

- **The dollar cap is gone because there are no dollars.** `DAILY_SPEND_CAP_USD` and the worst-case
  headroom reservation were replaced by a call cap (300/day), a token counter for observability, and
  a **latch**: a single provider 429 turns live mode off for the rest of the day and logs loudly.
  Retrying into an exhausted quota is pure waste and looks like abuse from the provider's side.
- **Every limit still degrades to mock rather than erroring.** Unchanged from the original design and
  worth restating: hitting a cap is not a failure state, and the UI says so explicitly, because every
  number on the page came from the deterministic model either way.

### Making it visible

- **The score breakdown is the primary view, not a debug drawer.** The brief was right that a
  confidence number you cannot interrogate is a vibe with a decimal point. Every contribution, the
  log-odds sum, the logistic, each cap and the final figure are on the resolution itself; the
  diverging-bar treatment that was previously only on the rebuttal now carries the resolver too.
- **`/how-it-works` leads with the caveat.** The synthetic-data disclosure is the first section, above
  the metrics, because a reader who stops after the impressive number should have already read the
  reason it is less impressive than it looks.

### Fit 2, once the key arrived

- **Metrics are computed on a held-out quarter, and the shipped map is fitted on everything.**
  Isotonic regression fits its own training data perfectly by construction — a step per observation
  is always available to it — so in-sample numbers would have been a tautology in exactly the way
  Fit 1's AUC of 1.0 is. Standard practice, but worth stating because it is the only reason the
  reported numbers mean anything.
- **Every live reply is committed to `lib/fitting/fit2-samples.json`.** Re-fitting or changing how
  the fit is *reported* now costs zero quota and zero wall clock
  (`CAL_SAMPLES=… npm run fit:calibrate`). It also turns the fit from a claim into something a
  reader can re-check. This was added after the first 38-minute run had to be repeated purely to
  improve the reporting — a cost worth never paying twice.
- **The correction makes stand-alone ECE worse, and it ships anyway, with both numbers published.**
  The lift is clamped to ±1 log-odds so the model cannot outvote deterministic evidence; against a
  71% base rate that bound alone confines the stand-alone probability to [0.474, 0.869], which any
  metric rewarding confident extremes will punish. The script measures the counterfactual rather
  than arguing it: the same map with the clamp removed scores 0.0000. Publishing only the flattering
  number would have been the easy option and the dishonest one.
- **The fitted map is reported as what it actually is — a sign function.** All 16 steps saturate the
  clamp, cutting at a stated weight of 0.80. Calling that "an isotonic calibration curve" would
  oversell a much simpler object, so the app says "one threshold" and shows it.
- **The generated file is deduplicated to one row per distinct x** (400 rows → 16). Identical
  behaviour, from a file a person can actually read and audit.

### Honesty note — what is and is not done

Both blocked items ran once the key was supplied: **Fit 2 is fitted** (200 live calls, 0 failures)
and the **Gemini-specific injection re-verification passed** (25 assertions, 4 real calls, captured
in `BUILD_LOG.md`).

**The key is deliberately not on the deployment.** `MORNING_CHECKLIST.md` §4 is explicit that a real
key does not go on a public deployment until Upstash is configured and a live response reports
`"store":"redis"` — without it, caps are counted per serverless instance and the effective public
limit is (limit × instances). Upstash is not configured, so the preview still serves mock reasoning.
Following that sequence was the whole point of writing it down.

**The key was found in `.env.example`, which is committed.** It was moved to `.env.local` (gitignored)
before any commit, and `git log -S` confirms it never entered history. `.env.example` carries an
empty placeholder again.
