"use client";

import { useMemo, useRef, useState } from "react";
import { BudgetBadge, BudgetNotice } from "@/components/budget";
import {
  CheckRow,
  CitationTag,
  ConfidenceMeter,
  Running,
  SourcePip,
  StatusChip,
  Timeline,
} from "@/components/ui";
import { useResolverStream } from "@/components/useResolverStream";
import { disputes as fixtureDisputes } from "@/lib/fixtures";
import { UploadPanel } from "@/components/upload";
import { CalibrationPanel, ScoreBreakdown } from "@/components/scoring";
import { ArcCluster, ConfidenceDial, ScatterField } from "@/components/decor";
import type { EvidenceDataset, TimelineEvent } from "@/lib/resolver/types";
import type { IngestReport } from "@/lib/ingest";

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
  const [upload, setUpload] = useState<{ dataset: EvidenceDataset; report: IngestReport } | null>(
    null,
  );

  const resolution = state.resolutions[0] ?? null;
  const running = state.phase === "running";

  /**
   * Investigate runs on uploaded evidence exactly as Reconcile does — the
   * resolver takes a dataset and cannot tell the two apart. The only reason
   * this page used to be fixtures-only is that it never offered the upload,
   * which made "bring your own data" quietly true of one workflow and not the
   * other.
   */
  const disputes = upload ? upload.dataset.disputes : fixtureDisputes;
  /**
   * The dispute list is above the upload panel, so a successful upload left you
   * at the bottom of the page with nothing to click. Bring the list back into
   * view — the cards are the run control here.
   */
  const disputeList = useRef<HTMLElement>(null);
  const startDispute = (disputeId: string) => {
    setActive(disputeId);
    const url = `/api/investigate?dispute=${encodeURIComponent(disputeId)}`;
    if (upload) start(url, { dataset: upload.dataset });
    else start(url);
  };

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
      <header className="decor-host grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <ArcCluster className="decor -left-20 -top-8 h-56 w-56 opacity-60" tone="rgb(var(--c-flagged))" />
        <div className="above max-w-2xl">
          <p className="text-micro uppercase tracking-widest text-signal">Investigate mode</p>
          <h1 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">
            One disputed transaction, every fragment of evidence
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Pick a chargeback. The resolver assembles the order, shipment, settlement and support
            record into a single timeline, marks what supports and what contradicts the cardholder,
            then a second-stage agent drafts the representment with a win-likelihood score built
            from the same evidence.
          </p>
        </div>
        <div className="above hidden self-end lg:block">
          <ScatterField className="h-24 w-full opacity-90" />
          <dl className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded border border-rule bg-rule text-center">
            {(upload
              ? [
                  [String(disputes.length), "uploaded disputes"],
                  [String(upload.report.totalRows), "rows ingested"],
                  ["—", "not yet assessed"],
                ]
              : [
                  [String(disputes.length), "open disputes"],
                  ["2", "worth fighting"],
                  ["88%", "best case"],
                ]
            ).map(([v, k]) => (
              <div key={k} className="bg-surface px-2 py-3">
                <dd className="tnum font-mono text-sm">{v}</dd>
                <dt className="mt-0.5 text-micro uppercase tracking-widest text-muted">{k}</dt>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <section ref={disputeList} className="mt-8">
        <h2 className="text-micro uppercase tracking-widest text-muted">
          {upload
            ? `Disputes in your upload — ${disputes.length}`
            : `Open disputes — ${disputes.length}`}
        </h2>
        {upload && disputes.length > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Loaded and validated — pick one to investigate. Nothing has been resolved yet.
          </p>
        )}
        {disputes.length === 0 && (
          <p className="card mt-3 px-5 py-4 text-sm leading-relaxed text-muted">
            <span className="text-ink">Your upload has no disputes in it.</span> Investigate needs a{" "}
            <code className="font-mono text-xs">disputes</code> file — one row per chargeback, with a{" "}
            <code className="font-mono text-xs">transactionRef</code> pointing at a settlement in the
            same upload. Reconcile works on what you have uploaded without one.
          </p>
        )}
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {disputes.map((d, i) => {
            const isActive = active === d.disputeId;
            return (
              <li
                key={d.disputeId}
                className="animate-riseIn"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <button
                  className={`card flex h-full w-full flex-col gap-2 px-5 py-4 text-left transition-colors ${
                    isActive ? "border-signal bg-signal/[0.04]" : "hover:border-ink/25"
                  }`}
                  onClick={() => startDispute(d.disputeId)}
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

      {state.phase === "idle" && (
        <div className="mt-8">
          <UploadPanel
            loaded={upload}
            disabled={running}
            onLoaded={(dataset, report) => {
              setUpload({ dataset, report });
              setActive(null);
              disputeList.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onCleared={() => {
              setUpload(null);
              setActive(null);
            }}
          />
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <BudgetBadge budget={state.budget} />
        {state.phase !== "idle" && (
          <button className="btn-quiet" onClick={reset} disabled={running}>
            Clear
          </button>
        )}
      </div>

      <BudgetNotice budget={state.budget} />

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

            <CalibrationPanel r={resolution} />
            <ScoreBreakdown r={resolution} />

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
          <div
            className="mt-4 max-w-full rounded-lg border border-rule bg-surface p-5 font-mono text-[0.8rem] leading-relaxed"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {state.rebuttal.rebuttal.letter}
          </div>
          <div className="mt-5">
            <h4 className="text-micro uppercase tracking-widest text-muted">
              {state.rebuttal.rebuttal.basis === "derived"
                ? "Every claim above traces to these records"
                : "Records this case was written from"}
            </h4>
            {state.rebuttal.rebuttal.basis === "authored" && (
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                The prose here is hand-written for this fixture, so the wording is not machine-derived
                — but every factor below it carries the record it came from, and the win likelihood is
                computed from those weights, not written in.
              </p>
            )}
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

      {state.phase === "idle" && <InvestigateIdle uploaded={Boolean(upload)} />}
    </div>
  );
}

/** Pre-run state: the pipeline a dispute goes through, rather than blank space. */
function InvestigateIdle({ uploaded }: { uploaded: boolean }) {
  const stages = [
    ["01", "Assemble", "Pull every fragment that mentions the transaction — order, settlement, carrier scan, support transcript, the chargeback itself."],
    ["02", "Resolve", "Run the same deterministic checks Reconcile uses, then read the narrative evidence for corroboration or contradiction."],
    ["03", "Weigh", "Score each piece of evidence for or against the cardholder's claim, starting from the network's published win rate for that reason code."],
    ["04", "Draft", "Write the representment from those weighted factors. For an uploaded dispute the letter is assembled from them; the four bundled cases carry hand-written prose, labelled as such."],
  ];
  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="decor-host card self-start px-5 py-6">
        <div className="decor inset-0 grid-paper opacity-50" />
        <div className="above">
          <p className="text-micro uppercase tracking-widest text-muted">
            What happens when you pick one
          </p>
          <ol className="mt-5 space-y-5">
            {stages.map(([n, title, body], i) => (
              <li
                key={n}
                className="animate-riseIn flex gap-4"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="tnum mt-0.5 font-mono text-xs text-signal">{n}</span>
                <div className="border-l-2 border-rule pl-4">
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-6 border-t border-rule pt-4 text-sm leading-relaxed text-muted">
            {uploaded ? (
              <>
                These disputes came from your upload. They run through the same checks, the same
                fitted weights and the same rebuttal engine as the bundled cases — the resolver takes
                a dataset and cannot tell where it came from.
              </>
            ) : (
              <>
                Each dispute above is a pre-selected case from the bundled fixtures — two the merchant
                should fight, two it should not. The resolver will tell you which is which.
              </>
            )}
          </p>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="card px-5 py-5">
          <ConfidenceDial className="mx-auto h-auto w-36" value={0.44} tone="rgb(var(--c-explained))" />
          <p className="mt-2 text-center text-micro uppercase tracking-widest text-muted">
            win likelihood, scored not asserted
          </p>
          <ul className="mt-5 space-y-2.5 border-t border-rule pt-4 text-xs">
            {[
              ["Represent", "text-matched", "60% and above"],
              ["Represent with caution", "text-explained", "35 – 59%"],
              ["Accept liability", "text-flagged", "below 35%"],
            ].map(([label, tone, band]) => (
              <li key={label} className="flex items-baseline justify-between gap-3">
                <span className={tone}>{label}</span>
                <span className="tnum font-mono text-muted">{band}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card px-5 py-4">
          <p className="text-micro uppercase tracking-widest text-muted">Honest by construction</p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Capped at 88% and floored at 5% — issuers are unpredictable, and a 95% claim on a
            chargeback would be dishonest. Two of these four come back{" "}
            <span className="text-flagged">accept liability</span>; for one of them the decisive
            evidence against us is our own settlement export.
          </p>
        </div>
      </aside>
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className={`chip ${meta.text} ${meta.border} bg-surface`}>{meta.label}</p>
        {/*
          Where the case came from, said out loud. The percentage is computed
          from the factor weights either way — what differs is whether the
          factors and the letter prose were written by hand for this fixture or
          derived from the evidence at request time.
        */}
        <p
          className={`chip bg-surface ${
            rebuttal.basis === "derived"
              ? "border-signal/40 text-signal"
              : "border-rule text-muted"
          }`}
          title={
            rebuttal.basis === "derived"
              ? "Factors and letter assembled from the evidence at request time"
              : "Factors and letter hand-written for this bundled fixture; the score is still computed from them"
          }
        >
          {rebuttal.basis === "derived"
            ? `derived from ${factors.length} factors`
            : "hand-authored case"}
        </p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">{rebuttal.recommendationNote}</p>

      <h4 className="mt-6 border-t border-rule pt-4 text-micro uppercase tracking-widest text-muted">
        Weighted factors
      </h4>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        {rebuttal.basis === "derived"
          ? "Read from the evidence at request time."
          : "Hand-picked for this fixture. The win likelihood below is still the sigmoid of their sum over the published reason-code baseline — not a written-in number."}
      </p>
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
