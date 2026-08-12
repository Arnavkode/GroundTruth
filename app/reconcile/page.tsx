"use client";

import { useMemo, useState } from "react";
import { BudgetBadge, BudgetNotice } from "@/components/budget";
import {
  CheckRow,
  ConfidenceMeter,
  Running,
  SourcePip,
  STATUS_META,
  StatusChip,
  Timeline,
} from "@/components/ui";
import { useResolverStream } from "@/components/useResolverStream";
import { ArcCluster, ScatterField } from "@/components/decor";
import { UploadPanel } from "@/components/upload";
import { CalibrationPanel, ScoreBreakdown } from "@/components/scoring";
import type { IngestReport } from "@/lib/ingest";
import type { EvidenceDataset } from "@/lib/resolver/types";
import type { ResolvedStatus, Resolution } from "@/lib/resolver/types";

const BUCKETS: { status: ResolvedStatus; blurb: string }[] = [
  { status: "matched", blurb: "Sources agree. No action." },
  { status: "explained-difference", blurb: "Differs, and the difference has a named cause." },
  { status: "flagged", blurb: "Not resolved. A person needs to look." },
];

function usd(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ReconcilePage() {
  const { state, start, reset } = useResolverStream();
  const [open, setOpen] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ dataset: EvidenceDataset; report: IngestReport } | null>(null);

  const grouped = useMemo(() => {
    const g: Record<ResolvedStatus, Resolution[]> = {
      matched: [],
      "explained-difference": [],
      flagged: [],
    };
    for (const r of state.resolutions) g[r.status].push(r);
    return g;
  }, [state.resolutions]);

  const running = state.phase === "running";
  const selected = state.resolutions.find((r) => r.transactionRef === open) ?? null;

  return (
    <div className="py-10">
      <header className="decor-host grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <ArcCluster className="decor -left-20 -top-8 h-56 w-56 opacity-60" />
        <div className="above max-w-2xl">
          <p className="text-micro uppercase tracking-widest text-signal">Reconcile mode</p>
          <h1 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">
            Bank statement against settlement report
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Sixteen reconciliation units built from a Meridian Commercial statement (16 Feb – 12 Mar
            2026) and the Halyard Payments ledger export. Every unit runs through the resolver and
            lands in one of three buckets, with the evidence behind it.
          </p>
        </div>
        <div className="above hidden self-end lg:block">
          <ScatterField className="h-24 w-full opacity-90" />
          <dl className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded border border-rule bg-rule text-center">
            {[
              ["16 Feb", "period from"],
              ["12 Mar", "period to"],
              ["2.9% + 30c", "fee schedule"],
            ].map(([v, k]) => (
              <div key={k} className="bg-surface px-2 py-3">
                <dd className="tnum font-mono text-sm">{v}</dd>
                <dt className="mt-0.5 text-micro uppercase tracking-widest text-muted">{k}</dt>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          onClick={() => {
            setOpen(null);
            // Same endpoint, same resolver — only the evidence source differs.
            if (upload) start("/api/reconcile", { dataset: upload.dataset });
            else start("/api/reconcile");
          }}
          disabled={running}
        >
          {running ? "Resolving…" : state.phase === "done" ? "Run again" : "Run reconciliation"}
        </button>
        {state.phase !== "idle" && (
          <button className="btn-quiet" onClick={reset} disabled={running}>
            Clear
          </button>
        )}
        <BudgetBadge budget={state.budget} />
        <span
          className={`chip ${
            upload ? "border-signal/40 bg-signal/[0.07] text-signal" : "border-rule bg-surface text-muted"
          }`}
          title={upload ? upload.report.label : "Bundled fixture data"}
        >
          {upload
            ? `uploaded — ${upload.report.totalRows} rows`
            : "bundled fixtures — 16 units"}
        </span>
      </div>

      <BudgetNotice budget={state.budget} />

      {state.error && (
        <p className="mt-6 rounded border border-flagged/40 bg-flagged/[0.06] px-4 py-3 text-sm text-flagged">
          {state.error}
        </p>
      )}

      {/* Live trace — the resolver showing its work, source by source. */}
      {state.live && (
        <section className="card mt-8 overflow-hidden" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono text-sm">{state.live.ref}</span>
              <span className="text-sm text-muted">{state.live.label}</span>
            </div>
            <span className="tnum font-mono text-xs text-muted">
              {state.live.index + 1} / {state.live.total}
            </span>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {state.live.sources.map((s, i) => (
                <SourcePip key={i} {...s} />
              ))}
            </div>
            {state.live.checks.length > 0 && (
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
                      {c.outcome === "agree"
                        ? "✓"
                        : c.outcome === "explained"
                          ? "≈"
                          : c.outcome === "conflict"
                            ? "✕"
                            : "○"}
                    </span>
                    <span className="text-muted">
                      <span className="text-ink">{c.label}</span> — {c.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {state.live.reasoning && <Running label={state.live.reasoning} />}
          </div>
        </section>
      )}

      {/* Bucket summary */}
      {state.resolutions.length > 0 && (
        <section className="mt-10">
          <div className="grid gap-4 sm:grid-cols-3">
            {BUCKETS.map(({ status, blurb }) => {
              const m = STATUS_META[status];
              const n = grouped[status].length;
              return (
                <div key={status} className={`card border ${m.border} ${m.bg} px-5 py-4`}>
                  <div className="flex items-baseline justify-between">
                    <span className={`text-micro uppercase tracking-widest ${m.text}`}>
                      {m.label}
                    </span>
                    <span className={`tnum font-mono text-3xl ${m.text}`}>{n}</span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{blurb}</p>
                </div>
              );
            })}
          </div>

          {state.summary && (
            <p className="mt-4 text-sm text-muted">
              {state.summary.flagged} of {state.summary.total} units could not be resolved
              automatically and need a person.
            </p>
          )}
        </section>
      )}

      {/* Results, grouped */}
      {BUCKETS.map(({ status }) => {
        const rows = grouped[status];
        if (rows.length === 0) return null;
        const m = STATUS_META[status];
        return (
          <section key={status} className="mt-10">
            <h2 className="flex items-baseline gap-3 border-b border-rule pb-2">
              <span className={`font-display text-2xl ${m.text}`}>{m.label}</span>
              <span className="tnum font-mono text-sm text-muted">{rows.length}</span>
            </h2>
            <ul className="mt-1">
              {rows.map((r) => {
                const isOpen = open === r.transactionRef;
                return (
                  <li key={r.transactionRef} className="border-b border-rule">
                    <button
                      className="flex w-full flex-col gap-2 py-4 text-left transition-colors hover:bg-surface sm:flex-row sm:items-center sm:gap-5"
                      onClick={() => setOpen(isOpen ? null : r.transactionRef)}
                      aria-expanded={isOpen}
                    >
                      <span className="flex w-full items-center gap-3 sm:w-52 sm:shrink-0">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${m.dot}`} aria-hidden />
                        <span className="font-mono text-sm">{r.transactionRef}</span>
                      </span>
                      <span className="min-w-0 flex-1 text-sm leading-relaxed text-muted">
                        {r.headline}
                      </span>
                      <span className="flex items-center gap-4 sm:shrink-0">
                        {r.amounts.deltaCents !== null && r.amounts.deltaCents !== 0 && (
                          <span className="tnum font-mono text-xs text-flagged">
                            {usd(r.amounts.deltaCents)}
                          </span>
                        )}
                        <span className={`tnum font-mono text-sm ${m.text}`}>
                          {Math.round(r.confidence * 100)}%
                        </span>
                        <span className="text-muted" aria-hidden>
                          {isOpen ? "−" : "+"}
                        </span>
                      </span>
                    </button>
                    {isOpen && selected && <ResolutionDetail r={selected} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {state.phase === "idle" && (
        <>
          <div className="mt-8">
            <UploadPanel
              loaded={upload}
              disabled={running}
              onLoaded={(dataset, report) => setUpload({ dataset, report })}
              onCleared={() => setUpload(null)}
            />
          </div>
          <ReconcileIdle uploaded={upload} />
        </>
      )}
    </div>
  );
}

/** Pre-run state: shows what is about to happen rather than an empty page. */
function ReconcileIdle({
  uploaded,
}: {
  uploaded: { dataset: EvidenceDataset; report: IngestReport } | null;
}) {
  const sources = [
    ["settlement", "Halyard ledger export"],
    ["bank", "Meridian statement lines"],
    ["order", "storefront order records"],
    ["shipment", "carrier tracking scans"],
    ["chat", "support transcripts"],
    ["dispute", "filed chargebacks"],
  ];
  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="decor-host card self-start px-5 py-5">
        <div className="decor inset-0 grid-paper opacity-50" />
        <div className="above">
          <p className="text-micro uppercase tracking-widest text-muted">
            {uploaded
              ? `Queued — ${uploaded.report.totalRows} uploaded rows awaiting resolution`
              : "Queued — 16 units awaiting resolution"}
          </p>
          <ul className="mt-4 space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3" aria-hidden>
                <span className="h-2 w-2 shrink-0 rounded-full bg-rule" />
                <span className="skeleton h-2.5 w-20 shrink-0" />
                <span
                  className="skeleton h-2.5"
                  style={{ width: `${34 + ((i * 13) % 46)}%` }}
                />
                <span className="skeleton ml-auto h-2.5 w-9 shrink-0" />
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t border-rule pt-4 text-sm leading-relaxed text-muted">
            {uploaded ? (
              <>
                <span className="text-ink">{uploaded.report.label}</span> is loaded and validated.
                Press <span className="text-ink">Run reconciliation</span> — it goes through exactly
                the same resolver as the bundled fixtures, with no special-casing.
              </>
            ) : (
              <>
                Nothing has run yet. The reconciliation works entirely against bundled fixture data
                and needs no credentials — press <span className="text-ink">Run reconciliation</span>{" "}
                and the resolver will stream its work source by source.
              </>
            )}
          </p>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="card px-5 py-4">
          <p className="text-micro uppercase tracking-widest text-muted">Sources it reads</p>
          <ul className="mt-3 space-y-2">
            {sources.map(([name, desc]) => (
              <li key={name} className="flex items-baseline gap-2.5 text-xs">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal/60" aria-hidden />
                <span className="text-micro uppercase tracking-widest text-signal">{name}</span>
                <span className="text-muted">{desc}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card px-5 py-4">
          <p className="text-micro uppercase tracking-widest text-muted">Buckets it sorts into</p>
          <ul className="mt-3 space-y-3">
            {BUCKETS.map(({ status, blurb }) => {
              const m = STATUS_META[status];
              return (
                <li key={status} className="flex gap-2.5">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${m.dot}`} aria-hidden />
                  <span className="text-xs leading-relaxed">
                    <span className={m.text}>{m.label}</span>
                    <span className="text-muted"> — {blurb}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function ResolutionDetail({ r }: { r: Resolution }) {
  return (
    <div className="grid gap-8 pb-8 pt-2 lg:grid-cols-[1.35fr_1fr]">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusChip status={r.status} />
          <span className="text-micro uppercase tracking-widest text-muted">
            reasoning: {r.reasoningProvenance}
          </span>
        </div>
        <p className="mt-4 text-[0.95rem] leading-relaxed">{r.explanation}</p>

        {r.identifiabilityNote && (
          <p className="mt-4 border-l-2 border-flagged/50 bg-flagged/[0.04] px-4 py-3 text-sm leading-relaxed text-flagged">
            {r.identifiabilityNote}
          </p>
        )}

        <h3 className="mt-7 text-micro uppercase tracking-widest text-muted">
          Checks — {r.checks.length}
        </h3>
        <ul className="mt-1 divide-y divide-rule">
          {r.checks.map((c, i) => (
            <CheckRow key={i} check={c} />
          ))}
        </ul>
      </div>

      <aside className="space-y-7">
        <CalibrationPanel r={r} />
        <ScoreBreakdown r={r} />
        <div className="card px-5 py-4">
          <ConfidenceMeter value={r.confidence} status={r.status} />
          <dl className="mt-5 space-y-2 border-t border-rule pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Expected net</dt>
              <dd className="tnum font-mono">
                {r.amounts.expectedNetCents === null ? "—" : usd(r.amounts.expectedNetCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Observed</dt>
              <dd className="tnum font-mono">
                {r.amounts.observedNetCents === null ? "—" : usd(r.amounts.observedNetCents)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Delta</dt>
              <dd
                className={`tnum font-mono ${
                  r.amounts.deltaCents ? "text-flagged" : "text-matched"
                }`}
              >
                {r.amounts.deltaCents === null ? "—" : usd(r.amounts.deltaCents)}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <h3 className="text-micro uppercase tracking-widest text-muted">Timeline</h3>
          <div className="mt-3">
            <Timeline events={r.timeline} />
          </div>
        </div>
      </aside>
    </div>
  );
}
