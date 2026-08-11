"use client";

import { useMemo, useState } from "react";
import {
  CheckRow,
  CitationTag,
  ConfidenceMeter,
  ModeBadge,
  Running,
  SourcePip,
  StatusChip,
  Timeline,
} from "@/components/ui";
import { useResolverStream } from "@/components/useResolverStream";
import { disputes } from "@/lib/fixtures";
import type { TimelineEvent } from "@/lib/resolver/types";

function usd(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const RECOMMENDATION_META: Record<
  string,
  { label: string; text: string; border: string; bg: string }
> = {
  represent: {
    label: "Represent",
    text: "text-matched",
    border: "border-matched/35",
    bg: "bg-matched/[0.06]",
  },
  "represent-with-caution": {
    label: "Represent with caution",
    text: "text-explained",
    border: "border-explained/35",
    bg: "bg-explained/[0.07]",
  },
  "accept-liability": {
    label: "Accept liability",
    text: "text-flagged",
    border: "border-flagged/35",
    bg: "bg-flagged/[0.06]",
  },
};

export default function InvestigatePage() {
  const { state, start, reset } = useResolverStream();
  const [active, setActive] = useState<string | null>(null);

  const resolution = state.resolutions[0] ?? null;
  const running = state.phase === "running";

  /** Mark timeline events by which side the rebuttal engine weighed them for. */
  const timeline: TimelineEvent[] = useMemo(() => {
    if (!resolution) return [];
    const factors = state.rebuttal?.factors ?? [];
    return resolution.timeline.map((e) => {
      const hit = factors.find(
        (f) => f.citation.ref === e.ref || f.citation.ref.includes(e.ref),
      );
      if (!hit) return e;
      return {
        ...e,
        stance: hit.weight >= 0 ? ("supports-merchant" as const) : ("supports-cardholder" as const),
      };
    });
  }, [resolution, state.rebuttal]);

  return (
    <div className="py-10">
      <header className="max-w-2xl">
        <p className="text-micro uppercase tracking-widest text-signal">Investigate mode</p>
        <h1 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">
          One disputed transaction, every fragment of evidence
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted">
          Pick a chargeback. The resolver assembles the order, shipment, settlement and support
          record into a single timeline, marks what supports and what contradicts the cardholder,
          then a second-stage agent drafts the representment with a win-likelihood score built from
          the same evidence.
        </p>
      </header>

      <section className="mt-8">
        <h2 className="text-micro uppercase tracking-widest text-muted">Open disputes — 4</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {disputes.map((d) => {
            const isActive = active === d.disputeId;
            return (
              <li key={d.disputeId}>
                <button
                  className={`card flex h-full w-full flex-col gap-2 px-5 py-4 text-left transition-colors ${
                    isActive ? "border-signal bg-signal/[0.04]" : "hover:border-ink/25"
                  }`}
                  onClick={() => {
                    setActive(d.disputeId);
                    start(`/api/investigate?dispute=${d.disputeId}`);
                  }}
                  disabled={running}
                  aria-pressed={isActive}
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-muted">{d.disputeId}</span>
                    <span className="tnum font-mono text-sm">{usd(d.amountCents)}</span>
                  </span>
                  <span className="text-sm font-medium leading-snug">{d.label}</span>
                  <span className="text-xs leading-relaxed text-muted">{d.blurb}</span>
                  <span className="mt-auto pt-2 text-micro uppercase tracking-widest text-signal">
                    {d.network} {d.reasonCode} · respond by {d.respondBy.slice(0, 10)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <ModeBadge mode={state.mode} message={state.modeMessage} />
        {state.phase !== "idle" && (
          <button className="btn-quiet" onClick={reset} disabled={running}>
            Clear
          </button>
        )}
      </div>

      {state.error && (
        <p className="mt-6 rounded border border-flagged/40 bg-flagged/[0.06] px-4 py-3 text-sm text-flagged">
          {state.error}
        </p>
      )}

      {state.live && (
        <section className="card mt-6 overflow-hidden" aria-live="polite">
          <div className="border-b border-rule px-5 py-3">
            <span className="font-mono text-sm">{state.live.ref}</span>
            <span className="ml-3 text-sm text-muted">{state.live.label}</span>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {state.live.sources.map((s, i) => (
                <SourcePip key={i} {...s} />
              ))}
            </div>
            <ul className="space-y-1.5">
              {state.live.checks.map((c, i) => (
                <li key={i} className="flex gap-2 text-sm animate-settle">
                  <span
                    className={`font-mono ${
                      c.outcome === "agree"
                        ? "text-matched"
                        : c.outcome === "explained"
                          ? "text-explained"
                          : c.outcome === "conflict"
                            ? "text-flagged"
                            : "text-muted"
                    }`}
                    aria-hidden
                  >
                    {c.outcome === "agree" ? "✓" : c.outcome === "explained" ? "≈" : c.outcome === "conflict" ? "✕" : "○"}
                  </span>
                  <span className="text-muted">
                    <span className="text-ink">{c.label}</span> — {c.detail}
                  </span>
                </li>
              ))}
            </ul>
            {state.live.reasoning && <Running label={state.live.reasoning} />}
          </div>
        </section>
      )}

      {resolution && (
        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip status={resolution.status} />
              <span className="font-mono text-sm text-muted">{resolution.transactionRef}</span>
              <span className="text-micro uppercase tracking-widest text-muted">
                reasoning: {resolution.reasoningProvenance}
              </span>
            </div>
            <h2 className="mt-4 font-display text-2xl leading-snug">{resolution.headline}</h2>
            <p className="mt-3 text-[0.95rem] leading-relaxed">{resolution.explanation}</p>

            <h3 className="mt-9 border-b border-rule pb-2 font-display text-xl">Evidence timeline</h3>
            <p className="mt-2 text-xs text-muted">
              Left edge marks which side the rebuttal engine weighed each record for.
            </p>
            <div className="mt-4">
              <Timeline events={timeline} />
            </div>

            <h3 className="mt-9 border-b border-rule pb-2 font-display text-xl">
              Checks — {resolution.checks.length}
            </h3>
            <ul className="divide-y divide-rule">
              {resolution.checks.map((c, i) => (
                <CheckRow key={i} check={c} />
              ))}
            </ul>
          </div>

          <aside className="space-y-7">
            <div className="card px-5 py-4">
              <ConfidenceMeter value={resolution.confidence} status={resolution.status} />
            </div>

            {state.rebuttal ? (
              <RebuttalPanel data={state.rebuttal} />
            ) : (
              running && (
                <div className="card px-5 py-4">
                  <Running label="Drafting representment…" />
                </div>
              )
            )}
          </aside>
        </div>
      )}

      {state.rebuttal && (
        <section className="mt-10">
          <h3 className="border-b border-rule pb-2 font-display text-xl">Draft representment</h3>
          <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg border border-rule bg-surface p-5 font-mono text-[0.8rem] leading-relaxed">
            {state.rebuttal.rebuttal.letter}
          </pre>
          <div className="mt-5">
            <h4 className="text-micro uppercase tracking-widest text-muted">
              Every claim above traces to these records
            </h4>
            <ul className="mt-3 flex flex-wrap gap-2">
              {state.rebuttal.rebuttal.evidenceCited.map((c, i) => (
                <li key={i}>
                  <CitationTag citation={c} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {state.phase === "idle" && (
        <p className="mt-10 max-w-xl text-sm leading-relaxed text-muted">
          Pick a dispute above. Each is a pre-selected case from the bundled fixtures — two the
          merchant should fight, two it should not.
        </p>
      )}
    </div>
  );
}

function RebuttalPanel({
  data,
}: {
  data: NonNullable<ReturnType<typeof useResolverStream>["state"]["rebuttal"]>;
}) {
  const { rebuttal, factors } = data;
  const meta = RECOMMENDATION_META[rebuttal.recommendation];
  const pct = Math.round(rebuttal.winLikelihood * 100);
  const maxAbs = Math.max(1, ...factors.map((f) => Math.abs(f.weight)));

  return (
    <div className={`card border ${meta.border} ${meta.bg} px-5 py-4`}>
      <p className="text-micro uppercase tracking-widest text-muted">Win likelihood</p>
      <p className={`tnum mt-1 font-mono text-4xl ${meta.text}`}>{pct}%</p>
      <p className={`chip mt-3 ${meta.text} ${meta.border} bg-surface`}>{meta.label}</p>
      <p className="mt-3 text-sm leading-relaxed text-muted">{rebuttal.recommendationNote}</p>

      <h4 className="mt-6 border-t border-rule pt-4 text-micro uppercase tracking-widest text-muted">
        Weighted factors
      </h4>
      <ul className="mt-3 space-y-2.5">
        {factors.map((f, i) => {
          const positive = f.weight >= 0;
          return (
            <li key={i}>
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs leading-snug">{f.label}</span>
                <span
                  className={`tnum shrink-0 font-mono text-xs ${
                    positive ? "text-matched" : "text-flagged"
                  }`}
                >
                  {positive ? "+" : ""}
                  {f.weight.toFixed(2)}
                </span>
              </div>
              <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-rule">
                <div className="flex w-1/2 justify-end">
                  {!positive && (
                    <div
                      className="h-full rounded-l-full bg-flagged"
                      style={{ width: `${(Math.abs(f.weight) / maxAbs) * 100}%` }}
                    />
                  )}
                </div>
                <div className="flex w-1/2 justify-start">
                  {positive && (
                    <div
                      className="h-full rounded-r-full bg-matched"
                      style={{ width: `${(f.weight / maxAbs) * 100}%` }}
                    />
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
