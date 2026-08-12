"use client";

import { FIT1 } from "@/lib/resolver/fitted";
import type { Resolution } from "@/lib/resolver/types";

/**
 * The arithmetic behind a confidence score, shown rather than asserted.
 *
 * This is the diverging-bar treatment that used to be reserved for the rebuttal
 * engine's win-likelihood, applied to the resolver itself: every contribution to
 * the log-odds sum, signed and scaled, then the caps that were applied on top.
 * It is the primary view, not a debug panel — the number at the end of it is the
 * one thing the whole product is asking you to trust.
 */

function Bar({ weight, max }: { weight: number; max: number }) {
  const positive = weight >= 0;
  const pct = Math.min(100, (Math.abs(weight) / max) * 100);
  return (
    <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-rule" aria-hidden>
      <div className="flex w-1/2 justify-end">
        {!positive && (
          <div className="h-full rounded-l-full bg-flagged" style={{ width: `${pct}%` }} />
        )}
      </div>
      <div className="flex w-1/2 justify-start">
        {positive && <div className="h-full rounded-r-full bg-matched" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  intercept: "fitted prior",
  deterministic: "fitted weight",
  llm: "evidence reading",
};

export function ScoreBreakdown({ r }: { r: Resolution }) {
  const { scoring } = r;
  if (!scoring) return null;
  const max = Math.max(1, ...scoring.contributions.map((c) => Math.abs(c.weight)));
  const capped =
    scoring.uncapped > r.confidence + 0.005 ? scoring.uncapped : null;

  return (
    <section className="card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-micro uppercase tracking-widest text-muted">How this score was built</h3>
        <span className="tnum font-mono text-micro text-muted">
          fit {FIT1.n.toLocaleString("en-US")} examples · AUC {FIT1.metrics.testAuc.toFixed(3)}
        </span>
      </div>

      <ul className="mt-4 space-y-3">
        {scoring.contributions.map((c, i) => (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs leading-snug">
                {c.label}
                <span className="ml-2 text-micro uppercase tracking-widest text-muted">
                  {KIND_LABEL[c.kind]}
                </span>
              </span>
              <span
                className={`tnum shrink-0 font-mono text-xs ${
                  c.weight >= 0 ? "text-matched" : "text-flagged"
                }`}
              >
                {c.weight >= 0 ? "+" : ""}
                {c.weight.toFixed(3)}
              </span>
            </div>
            <Bar weight={c.weight} max={max} />
          </li>
        ))}
      </ul>

      <dl className="mt-5 space-y-1.5 border-t border-rule pt-4 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Sum of log-odds</dt>
          <dd className="tnum font-mono">{scoring.logit.toFixed(3)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Through the logistic</dt>
          <dd className="tnum font-mono">{Math.round(scoring.uncapped * 100)}%</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Evidence-coverage cap</dt>
          <dd className="tnum font-mono">{Math.round(scoring.coverageCap * 100)}%</dd>
        </div>
        {scoring.ambiguityCap !== null && (
          <div className="flex justify-between gap-3">
            <dt className="text-flagged">Ambiguity cap</dt>
            <dd className="tnum font-mono text-flagged">
              {Math.round(scoring.ambiguityCap * 100)}%
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-rule pt-1.5">
          <dt className="text-ink">Final confidence</dt>
          <dd className="tnum font-mono text-ink">{Math.round(r.confidence * 100)}%</dd>
        </div>
      </dl>

      {capped && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          The raw arithmetic gave {Math.round(scoring.uncapped * 100)}%; the caps pulled it to{" "}
          {Math.round(r.confidence * 100)}% because the evidence does not support more.
        </p>
      )}
    </section>
  );
}

/**
 * Raw vs calibrated — the single most load-bearing "we did real math" moment,
 * so it is a panel rather than a tooltip. Only appears in real mode, and says
 * plainly when no calibration has been fitted yet rather than implying one.
 */
export function CalibrationPanel({ r }: { r: Resolution }) {
  const c = r.calibration;
  if (!c) return null;
  const delta = c.calibrated - c.raw;
  const moved = Math.abs(delta) >= 0.02;

  return (
    <section
      className={`card px-5 py-4 ${
        c.fitted ? "border-signal/35 bg-signal/[0.04]" : "border-explained/35 bg-explained/[0.05]"
      }`}
    >
      <h3 className="text-micro uppercase tracking-widest text-muted">
        The model&apos;s confidence, corrected
      </h3>

      <div className="mt-3 flex items-end gap-4">
        <div>
          <p className="text-micro uppercase tracking-widest text-muted">it said</p>
          <p className="tnum font-mono text-2xl text-muted">
            {c.raw >= 0 ? "+" : ""}
            {c.raw.toFixed(2)}
          </p>
        </div>
        <span className="pb-2 text-muted" aria-hidden>
          →
        </span>
        <div>
          <p className="text-micro uppercase tracking-widest text-muted">we used</p>
          <p
            className={`tnum font-mono text-2xl ${
              !c.fitted ? "text-explained" : moved ? "text-signal" : "text-ink"
            }`}
          >
            {c.calibrated >= 0 ? "+" : ""}
            {c.calibrated.toFixed(2)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">{c.note}</p>

      {!c.fitted && (
        <p className="mt-2 text-xs leading-relaxed text-explained">
          Run <code className="font-mono">npm run fit:calibrate</code> against a live key to replace
          this pass-through with a fitted correction.
        </p>
      )}
    </section>
  );
}
