import { ArcCluster, ConfidenceDial } from "@/components/decor";
import { CALIBRATION } from "@/lib/resolver/calibration";
import { FIT1 } from "@/lib/resolver/fitted";
import { FREE_TIER, dailyCap, perIpLimit } from "@/lib/ratelimit";
import { geminiModel } from "@/lib/resolver/llm";

export const metadata = {
  title: "How the scoring works — Groundtruth",
  description:
    "The two fits behind the confidence score, the synthetic-data caveat, the validation metrics, and why the reasoning step runs on Gemini.",
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function HowItWorks() {
  const m = FIT1.metrics;
  const weights = Object.entries(FIT1.weights).sort((a, b) => b[1] - a[1]);
  const maxAbs = Math.max(...weights.map(([, w]) => Math.abs(w)), 1);

  return (
    <div className="py-12">
      <header className="decor-host max-w-3xl">
        <ArcCluster className="decor -left-20 -top-10 h-56 w-56 opacity-60" />
        <div className="above">
          <p className="text-micro uppercase tracking-widest text-signal">How this works</p>
          <h1 className="mt-3 font-display text-4xl leading-tight sm:text-5xl">
            Where the confidence number comes from
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted">
            Two things are fitted rather than guessed: the weight of each deterministic check, and
            how much to believe the language model when it states its own confidence. Neither is a
            hand-tuned constant any more, and both report their validation numbers here — including
            the ones that are not flattering.
          </p>
        </div>
      </header>

      {/* ── The caveat, first, not buried ─────────────────────────────────── */}
      <section className="card mt-10 border-explained/35 bg-explained/[0.06] px-6 py-5">
        <h2 className="font-display text-xl text-explained">Read this before the numbers</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          <span className="text-ink">Spend limits are enforced so I don't lose money. Every example used to fit this model is synthetic.</span> There
          is no proprietary dataset here and no real payments data anywhere in the project. Examples
          are constructed by{" "}
          <code className="font-mono text-xs">lib/fitting/synthetic.ts</code>, which means the ground
          truth is known by construction — the generator decides whether it is injecting a genuine
          anomaly, and that decision <em>is</em> the label.
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          What that buys: the weights are a real maximum-likelihood fit to a stated distribution
          instead of constants that felt about right. What it does not buy: any evidence that these
          numbers generalise to a real acquirer&apos;s book. The archetypes and their frequencies were
          chosen by hand. That is a smaller claim than &ldquo;we trained a model&rdquo;, and it is a
          true one.
        </p>
      </section>

      {/* ── Fit 1 ─────────────────────────────────────────────────────────── */}
      <section className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-3">
          <div>
            <p className="text-micro uppercase tracking-widest text-signal">Fit 1</p>
            <h2 className="mt-1 font-display text-3xl">Deterministic check weights</h2>
          </div>
          <span className="tnum font-mono text-xs text-muted">
            {FIT1.n.toLocaleString("en-US")} examples · seed {FIT1.seed} ·{" "}
            {new Date(FIT1.generatedAt).toISOString().slice(0, 10)}
          </span>
        </div>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
          A logistic regression over the outcomes of the real check code. Features are produced by
          running the same functions the app runs at request time, so the coefficients apply to
          exactly the signals it computes. The target is a single question:{" "}
          <span className="text-ink">how likely is it that this transaction needs no human?</span>{" "}
          Every confidence figure in the app is that probability.
        </p>

        <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Test accuracy" value={pct(m.testAccuracy)} note={`train ${pct(m.trainAccuracy)}`} />
          <Metric label="Test AUC" value={m.testAuc.toFixed(4)} note={`train ${m.trainAuc.toFixed(4)}`} />
          <Metric label="Brier score" value={m.testBrier.toFixed(4)} note="0.25 = guessing the base rate" />
          <Metric label="Calibration error" value={m.testEce.toFixed(4)} note="mean stated-vs-observed gap" />
        </div>

        <div className="card mt-4 px-5 py-4">
          <h3 className="text-micro uppercase tracking-widest text-muted">
            Reading these honestly
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            <span className="text-ink">AUC {m.testAuc.toFixed(4)} is not the impressive number it
            looks like.</span>{" "}
            The checks were designed to detect these archetypes, so perfect ranking is close to a
            tautology — it says the features separate the classes, which they were built to do. The
            informative figures are the two on the right. A Brier of {m.testBrier.toFixed(4)} against
            a {pct(m.positiveRate)} base rate is a genuine improvement over guessing, and the
            calibration error of {m.testEce.toFixed(4)} is <em>not</em> good: L2 shrinkage keeps the
            fitted probabilities away from 0 and 1, so the model is systematically under-confident at
            the extremes. That is a deliberate trade — a resolver that never claims certainty is the
            behaviour we want — but it is a real cost and it belongs on this page.
          </p>
        </div>

        <div className="card mt-4 border-explained/35 bg-explained/[0.06] px-5 py-4">
          <h3 className="text-micro uppercase tracking-widest text-explained">
            What fitting these weights cost
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Fit 1&apos;s features are binary — each check either fired with a given outcome or it did
            not — so a fitted coefficient <span className="text-ink">structurally cannot express
            magnitude</span>. The hand-picked weight it replaced could: a shortfall scored
            <span className="tnum font-mono text-xs"> −1.41</span> at a penny and
            <span className="tnum font-mono text-xs"> −9.40</span> when the whole payment was missing.
            The fitted replacement is a flat <span className="tnum font-mono text-xs">−1.2978</span>
            either way.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            The verdict is unaffected — a shortfall of any size still flags — but the confidence
            behind it is no longer severity-sensitive, so a missing cent and a missing payout now read
            the same on this one axis. That is a real regression against the thing being replaced, and
            the honest trade is: an arbitrary weight that encoded a genuine intuition, versus a fitted
            one that encodes only what the data could express. Recovering it means giving the model a
            continuous severity feature, which is the obvious next fit and has not been done.
          </p>
        </div>

        <h3 className="mt-8 text-micro uppercase tracking-widest text-muted">
          Fitted coefficients — log-odds toward &ldquo;needs no human&rdquo;
        </h3>
        <ul className="mt-3 space-y-2">
          <li>
            <Coefficient name="intercept (prior)" weight={FIT1.intercept} max={maxAbs} />
          </li>
          {weights.map(([name, w]) => (
            <li key={name}>
              <Coefficient name={name} weight={w} max={maxAbs} />
            </li>
          ))}
        </ul>
      </section>

      {/* ── Fit 2 ─────────────────────────────────────────────────────────── */}
      <section className="mt-16">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-3">
          <div>
            <p className="text-micro uppercase tracking-widest text-signal">Fit 2</p>
            <h2 className="mt-1 font-display text-3xl">Calibrating what the model claims</h2>
          </div>
          <span
            className={`chip ${
              CALIBRATION
                ? "border-matched/35 bg-matched/[0.06] text-matched"
                : "border-explained/35 bg-explained/[0.07] text-explained"
            }`}
          >
            {CALIBRATION ? "fitted" : "not yet fitted"}
          </span>
        </div>

        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
          A language model&apos;s stated confidence is a claim about itself, and there is no reason to
          take it at face value. Fit 2 runs the live path over synthetic transactions whose answer is
          known, records what the model said against what was true, and fits an isotonic map from
          &ldquo;what it said&rdquo; to &ldquo;the log-odds lift that statement actually justifies&rdquo;.
        </p>

        {CALIBRATION ? (
          <>
            <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-3">
              <Metric
                label="Accuracy, held out"
                value={`${pct(CALIBRATION.metrics.rawAccuracy)} → ${pct(CALIBRATION.metrics.calibratedAccuracy)}`}
                note="stated weight → corrected"
              />
              <Metric
                label="Calibration error"
                value={`${CALIBRATION.metrics.rawEce.toFixed(3)} → ${CALIBRATION.metrics.calibratedEce.toFixed(3)}`}
                note="worse, and deliberately so — see below"
              />
              <Metric
                label="Live calls"
                value={String(CALIBRATION.n)}
                note={`${CALIBRATION.model}, free tier, $0`}
              />
            </div>

            <div className="card mt-4 border-explained/35 bg-explained/[0.06] px-5 py-4">
              <p className="text-micro uppercase tracking-widest text-explained">
                Read the middle number carefully
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                Correcting the model makes its stand-alone calibration error{" "}
                <span className="text-ink">worse</span>, and that is not a bug being glossed over. The
                correction the resolver adds is clamped to ±1 log-odds so the model can never outvote
                deterministic evidence. That clamp alone confines the resulting stand-alone
                probability to roughly{" "}
                <span className="tnum font-mono text-xs text-ink">[0.47, 0.87]</span> around the base
                rate — so a map that ranks <em>perfectly</em> still cannot score well on a metric that
                rewards confident extremes. Remove the clamp and the same map scores{" "}
                <span className="tnum font-mono text-xs text-ink">
                  {CALIBRATION.metrics.unclampedEce.toFixed(4)}
                </span>{" "}
                ECE on the same held-out data. The clamp stays. It is the cost of the guarantee.
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
                And the unclamped{" "}
                <span className="tnum font-mono text-xs">
                  {CALIBRATION.metrics.unclampedEce.toFixed(4)}
                </span>{" "}
                is not a triumph either. It says the synthetic distribution is cleanly separable by
                the model&apos;s own stated weight — a fact about this data, not a promise about
                production. The same caveat as Fit 1&apos;s AUC.
              </p>
            </div>

            {(() => {
              const cross = CALIBRATION.points.find((p) => p.y > 0);
              if (!cross) return null;
              return (
                <div className="card mt-4 border-signal/35 bg-signal/[0.05] px-5 py-4">
                  <p className="text-micro uppercase tracking-widest text-signal">
                    What the correction actually learned
                  </p>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                    One threshold, at a stated weight of{" "}
                    <span className="tnum font-mono text-ink">{cross.x.toFixed(2)}</span>. At or above
                    it, the model&apos;s reading is worth{" "}
                    <span className="tnum font-mono text-matched">+1.00</span> log-odds; anywhere
                    below — including a{" "}
                    <span className="tnum font-mono text-xs">0.00</span> shrug —{" "}
                    <span className="tnum font-mono text-flagged">−1.00</span>. The model is
                    trustworthy when it is emphatic and not otherwise, which is a more useful thing to
                    know than a smooth curve would have been.
                  </p>
                </div>
              );
            })()}
            <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">{CALIBRATION.summary}</p>
            <h3 className="mt-6 text-micro uppercase tracking-widest text-muted">
              Where the model was wrong about itself
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
              The interesting rows are the ones where it stated{" "}
              <span className="tnum font-mono text-xs">0.00</span> — a shrug, which taken at face
              value reads as a coin flip — on archetypes that in truth <em>never</em> resolve
              themselves. That is the systematic error the correction exists to remove.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-rule text-left text-micro uppercase tracking-widest text-muted">
                    <th className="py-2 font-normal">Archetype</th>
                    <th className="py-2 text-right font-normal">n</th>
                    <th className="py-2 text-right font-normal">mean stated</th>
                    <th className="py-2 text-right font-normal">actually true</th>
                  </tr>
                </thead>
                <tbody>
                  {CALIBRATION.byArchetype.map((b) => (
                    <tr key={b.archetype} className="border-b border-rule/60">
                      <td className="py-2 font-mono text-xs">{b.archetype}</td>
                      <td className="tnum py-2 text-right font-mono text-xs">{b.n}</td>
                      <td className="tnum py-2 text-right font-mono text-xs">{b.meanRaw.toFixed(2)}</td>
                      <td className="tnum py-2 text-right font-mono text-xs">{pct(b.observed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="card mt-6 border-explained/35 bg-explained/[0.06] px-5 py-4">
            <p className="text-sm leading-relaxed text-muted">
              <span className="text-ink">This fit has not been run.</span> It is the one step that
              needs a live API key, and it has deliberately not been faked: the raw stated weight
              passes through unchanged and every surface that shows it says{" "}
              <span className="text-explained">uncalibrated</span> rather than implying a correction
              that never happened.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              To run it:{" "}
              <code className="font-mono text-xs">GEMINI_API_KEY=… npm run fit:calibrate</code> —
              roughly {200} live calls paced under the free rate limit, about twenty minutes, and
              genuinely $0.
            </p>
          </div>
        )}
      </section>

      {/* ── Why Gemini ────────────────────────────────────────────────────── */}
      <section className="decor-host mt-16 rounded-lg border border-rule bg-surface px-6 py-6">
        <ConfidenceDial className="decor -right-6 -top-4 h-24 w-40 opacity-40" value={0.78} />
        <div className="above max-w-3xl">
          <h2 className="font-display text-2xl">Why the reasoning step runs on Gemini</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Not a capability argument — it is a spend guarantee. This app is deployed publicly with
            no login wall, so the question that matters is not &ldquo;how do we keep the bill
            small?&rdquo; but &ldquo;what makes a bill structurally impossible?&rdquo;
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            A Gemini free-tier key has <span className="text-ink">no billing account behind it</span>.
            Past the free quota, a request returns 429 and stops. There is no code path, no bug and
            no abuse case that can turn into a charge, because there is nothing to charge. A rate
            limiter on a metered provider is a promise; this is an absence of the thing being
            promised about — which is strictly stronger.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            The app is still rate limited, because burning the quota would degrade the demo for the
            next visitor: {perIpLimit()} live runs per IP per hour, {dailyCap()} calls a day against
            the provider&apos;s {FREE_TIER.rpd}/day free allowance, and a hard stop for the rest of
            the day the first time the provider returns a quota error. Every one of those falls back
            to canned reasoning rather than erroring. Model in use:{" "}
            <code className="font-mono text-xs">{geminiModel()}</code>.
          </p>
        </div>
      </section>

      <section className="mt-12 border-t border-rule pt-8">
        <h2 className="font-display text-2xl">What is fitted and what is not</h2>
        <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule md:grid-cols-2">
          <div className="bg-surface px-5 py-4">
            <p className="text-micro uppercase tracking-widest text-matched">Fitted</p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              <li>Every deterministic check weight, and the prior intercept</li>
              <li>
                The correction applied to the model&apos;s stated confidence
                {CALIBRATION ? "" : " (once Fit 2 is run)"}
              </li>
            </ul>
          </div>
          <div className="bg-paper px-5 py-4">
            <p className="text-micro uppercase tracking-widest text-muted">Still chosen by hand</p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted">
              <li>The 60% flag threshold and the 97% ceiling</li>
              <li>The evidence-coverage and ambiguity caps</li>
              <li>The rebuttal engine&apos;s per-reason-code baselines</li>
              <li>The archetype mixture the synthetic data is drawn from</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-surface px-5 py-4">
      <p className="text-micro uppercase tracking-widest text-muted">{label}</p>
      <p className="tnum mt-1 font-mono text-2xl text-signal">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{note}</p>
    </div>
  );
}

function Coefficient({ name, weight, max }: { name: string; weight: number; max: number }) {
  const positive = weight >= 0;
  const pctWidth = Math.min(100, (Math.abs(weight) / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs">{name}</span>
        <span className={`tnum font-mono text-xs ${positive ? "text-matched" : "text-flagged"}`}>
          {positive ? "+" : ""}
          {weight.toFixed(3)}
        </span>
      </div>
      <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-rule" aria-hidden>
        <div className="flex w-1/2 justify-end">
          {!positive && (
            <div className="h-full rounded-l-full bg-flagged" style={{ width: `${pctWidth}%` }} />
          )}
        </div>
        <div className="flex w-1/2 justify-start">
          {positive && (
            <div className="h-full rounded-r-full bg-matched" style={{ width: `${pctWidth}%` }} />
          )}
        </div>
      </div>
    </div>
  );
}
