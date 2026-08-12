"use client";

import { memo } from "react";
import type { Check, Citation, ResolvedStatus, TimelineEvent } from "@/lib/resolver/types";

export const STATUS_META: Record<
  ResolvedStatus,
  { label: string; text: string; border: string; bg: string; bar: string; dot: string }
> = {
  matched: {
    label: "Matched",
    text: "text-matched",
    border: "border-matched/35",
    bg: "bg-matched/[0.06]",
    bar: "bg-matched",
    dot: "bg-matched",
  },
  "explained-difference": {
    label: "Explained difference",
    text: "text-explained",
    border: "border-explained/35",
    bg: "bg-explained/[0.07]",
    bar: "bg-explained",
    dot: "bg-explained",
  },
  flagged: {
    label: "Flagged",
    text: "text-flagged",
    border: "border-flagged/35",
    bg: "bg-flagged/[0.06]",
    bar: "bg-flagged",
    dot: "bg-flagged",
  },
};

export function StatusChip({ status }: { status: ResolvedStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`chip ${m.text} ${m.border} ${m.bg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
}

/**
 * The confidence figure is the most load-bearing number in the app, so it gets
 * a scale rather than a bare percentage: the 60% flag threshold is drawn in, so
 * you can see how close a call was, not just which side it fell on.
 */
export function ConfidenceMeter({
  value,
  status,
  size = "md",
}: {
  value: number;
  status: ResolvedStatus;
  size?: "sm" | "md";
}) {
  const pct = Math.round(value * 100);
  const m = STATUS_META[status];
  return (
    <div className={size === "sm" ? "w-full" : "w-full"}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-micro uppercase tracking-widest text-muted">Confidence</span>
        <span className={`tnum font-mono ${size === "sm" ? "text-base" : "text-2xl"} ${m.text}`}>
          {pct}%
        </span>
      </div>
      <div
        className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-rule"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Resolution confidence ${pct} percent`}
      >
        <div
          className={`h-full rounded-full ${m.bar} transition-[width] duration-700 ease-out`}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-ink/25"
          style={{ left: "60%" }}
          aria-hidden
          title="Flag threshold"
        />
      </div>
      <p className="mt-1 text-micro text-muted">
        Below 60% the resolver flags rather than resolves
      </p>
    </div>
  );
}

const OUTCOME_MARK: Record<string, { glyph: string; cls: string; label: string }> = {
  agree: { glyph: "✓", cls: "text-matched border-matched/40 bg-matched/[0.08]", label: "Sources agree" },
  explained: { glyph: "≈", cls: "text-explained border-explained/40 bg-explained/[0.08]", label: "Difference explained" },
  conflict: { glyph: "✕", cls: "text-flagged border-flagged/40 bg-flagged/[0.08]", label: "Conflict" },
  missing: { glyph: "○", cls: "text-muted border-rule bg-paper", label: "Evidence missing" },
};

function CheckRowBase({ check }: { check: Check }) {
  const m = OUTCOME_MARK[check.outcome] ?? OUTCOME_MARK.missing;
  return (
    <li className="flex gap-3 py-3 animate-settle">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs ${m.cls}`}
        title={m.label}
      >
        <span aria-hidden>{m.glyph}</span>
        <span className="sr-only">{m.label}</span>
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{check.label}</span>
          <span className="text-micro uppercase tracking-widest text-muted">
            {check.kind === "llm" ? "evidence reading" : "deterministic"}
          </span>
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{check.detail}</p>
        {check.citations.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {check.citations.map((c, i) => (
              <li key={i}>
                <CitationTag citation={c} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  bank: "bank",
  settlement: "settlement",
  order: "order",
  shipment: "shipment",
  chat: "chat",
  dispute: "dispute",
};

function CitationTagBase({ citation }: { citation: Citation }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded border border-rule bg-paper px-2 py-1 text-xs"
      title={citation.detail}
    >
      <span className="text-micro uppercase tracking-widest text-signal">
        {SOURCE_LABEL[citation.source] ?? citation.source}
      </span>
      <span className="font-mono text-[0.7rem] text-ink">{citation.ref}</span>
      <span className="hidden truncate text-muted sm:inline">{citation.detail}</span>
    </span>
  );
}

function SourcePipBase({
  source,
  found,
  detail,
}: {
  source: string;
  found: boolean;
  detail: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs animate-settle ${
        found ? "border-rule bg-surface" : "border-dashed border-rule bg-paper text-muted"
      }`}
      title={detail}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${found ? "bg-signal" : "bg-muted/40"}`}
        aria-hidden
      />
      <span className="text-micro uppercase tracking-widest">{source}</span>
      <span className="hidden truncate text-muted md:inline">{detail}</span>
    </div>
  );
}

const STANCE: Record<string, { cls: string; label: string }> = {
  "supports-merchant": { cls: "border-l-matched", label: "Supports merchant" },
  "supports-cardholder": { cls: "border-l-flagged", label: "Supports cardholder" },
  neutral: { cls: "border-l-rule", label: "" },
};

function TimelineBase({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="relative">
      {events.map((e, i) => {
        const stance = STANCE[e.stance ?? "neutral"];
        return (
          <li key={i} className={`relative border-l-2 ${stance.cls} pb-5 pl-5 last:pb-0`}>
            <span
              className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full border-2 border-paper bg-ink"
              aria-hidden
            />
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <time className="tnum font-mono text-xs text-muted">
                {e.at.slice(0, 10)} {e.at.slice(11, 16)}
              </time>
              <span className="text-sm font-medium">{e.label}</span>
              <span className="text-micro uppercase tracking-widest text-signal">{e.source}</span>
              <span className="font-mono text-[0.7rem] text-muted">{e.ref}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted">{e.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}

export function Running({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="flex gap-0.5" aria-hidden>
        <span className="h-1 w-1 animate-pulseDot rounded-full bg-signal" />
        <span className="h-1 w-1 animate-pulseDot rounded-full bg-signal [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulseDot rounded-full bg-signal [animation-delay:300ms]" />
      </span>
      {label}
    </span>
  );
}

/* These render once per streamed event across long lists; memoising them keeps
   a 16-unit reconcile run from re-rendering every row on every tick. */
export const CheckRow = memo(CheckRowBase);
export const CitationTag = memo(CitationTagBase);
export const SourcePip = memo(SourcePipBase);
export const Timeline = memo(TimelineBase);
