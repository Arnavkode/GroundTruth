"use client";

import { useRef, useState } from "react";
import { LIMITS, SOURCE_KINDS, type IngestReport, type SourceKind } from "@/lib/ingest";
import type { EvidenceDataset } from "@/lib/resolver/types";

/** Served from public/samples — downloadable, and loadable in one click. */
const SAMPLE_FILE: Record<SourceKind, string> = {
  bank: "bank.csv",
  settlement: "settlement.csv",
  orders: "orders.csv",
  shipments: "shipments.csv",
  chats: "chats.csv",
  disputes: "disputes.csv",
};

const SOURCE_HELP: Record<SourceKind, { label: string; columns: string }> = {
  bank: { label: "Bank statement", columns: "id, postedAt, descriptor, amountCents, direction, memoRef" },
  settlement: {
    label: "Settlement export",
    columns: "settlementId, transactionRef, orderId, type, occurredAt, grossCents, feeCents, currency, status",
  },
  orders: {
    label: "Orders",
    columns: "orderId, transactionRef, customerName, email, placedAt, totalCents, items, postal, avsResult, cvvResult",
  },
  shipments: {
    label: "Shipments",
    columns: "orderId, carrier, tracking, shippedAt, deliveredAt, status, signature, deliveryPostal",
  },
  chats: { label: "Support transcripts", columns: "chatId, orderId, ts, from, text  (one row per message)" },
  disputes: {
    label: "Disputes",
    columns: "disputeId, transactionRef, reasonCode, amountCents, filedAt, cardholderStatement",
  },
};

export function UploadPanel({
  onLoaded,
  onCleared,
  loaded,
  disabled,
}: {
  onLoaded: (dataset: EvidenceDataset, report: IngestReport) => void;
  onCleared: () => void;
  loaded: { dataset: EvidenceDataset; report: IngestReport } | null;
  disabled: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<IngestReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/ingest", { method: "POST", body: new FormData(formRef.current) });
      const json = await res.json();
      setReport(json.report);
      if (json.dataset) onLoaded(json.dataset, json.report);
    } catch {
      setError("Upload failed before it reached the server. Check the file sizes and try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * One click from "I have no data" to a resolved run.
   *
   * Fetches the six bundled sample files and posts them through the *same*
   * endpoint a manual upload uses — not a shortcut that bypasses validation,
   * because the point of offering them is to show the ingestion path working,
   * caps and per-row errors included.
   */
  async function loadSamples() {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const fd = new FormData();
      await Promise.all(
        SOURCE_KINDS.map(async (kind) => {
          const res = await fetch(`/samples/${SAMPLE_FILE[kind]}`);
          if (!res.ok) throw new Error(`${SAMPLE_FILE[kind]} (${res.status})`);
          fd.append(kind, new File([await res.blob()], SAMPLE_FILE[kind], { type: "text/csv" }));
        }),
      );
      fd.append("label", "Sample merchant book — July 2026");
      // The schedule these samples were written against. Get it wrong and every
      // row flags on fees, which would make the samples look broken.
      fd.append("feePercent", "2.9");
      fd.append("feeFixedCents", "30");

      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const json = await res.json();
      setReport(json.report);
      if (json.dataset) onLoaded(json.dataset, json.report);
    } catch (e) {
      setError(
        `Could not load the sample files: ${(e as Error).message}. They are also downloadable individually below.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const fatal = report?.fatal ?? [];
  const issues = report?.issues ?? [];
  const truncations = report?.truncations ?? [];

  return (
    <div className="card px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-lg">Use your own data</h3>
        <span className="tnum font-mono text-micro uppercase tracking-widest text-muted">
          max {LIMITS.MAX_ROWS} rows · {LIMITS.MAX_BYTES / 1024}KB · {LIMITS.MAX_TEXT_CHARS} chars/field
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        CSV or JSON per source, matching the bundled fixture shapes. Everything is validated
        server-side before it reaches the resolver — rows that fail are named individually rather
        than dropped. The caps are cost controls: they bound how many live model calls one upload can
        trigger and how much text can reach a prompt.
      </p>

      {/*
        The most common reason someone never tries an upload is not having a
        file in the right shape. Both routes out of that are here: take the
        files and inspect them, or load them in one click.
      */}
      <div className="mt-4 rounded-lg border border-signal/30 bg-signal/[0.04] px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            className="btn-quiet border-signal/40 text-signal"
            onClick={loadSamples}
            disabled={busy || disabled}
          >
            {busy ? "Fetching…" : "Use the sample data"}
          </button>
          <p className="text-sm leading-relaxed text-muted">
            32 rows, six files, no typing. Or take them and edit them:
          </p>
        </div>
        {/* Chips rather than inline links: a bare <a> was 16px tall, under the
            44px touch minimum, which the responsive suite caught. */}
        <ul className="mt-2.5 flex flex-wrap gap-2">
          {SOURCE_KINDS.map((kind) => (
            <li key={kind}>
              <a
                href={`/samples/${SAMPLE_FILE[kind]}`}
                download
                className="flex min-h-[44px] items-center gap-1.5 rounded border border-signal/30 bg-paper px-3 font-mono text-xs text-signal transition-colors hover:border-signal hover:bg-signal/[0.06]"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                  <path d="M6 1v7m0 0L3.5 5.5M6 8l2.5-2.5M2 10.5h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {SAMPLE_FILE[kind]}
              </a>
            </li>
          ))}
          <li>
            {/* In the chip row rather than inline in the prose below: an inline
                link renders at 16px, under the touch-target minimum. */}
            <a
              href="/samples/README.md"
              className="flex min-h-[44px] items-center rounded border border-rule bg-paper px-3 text-xs text-muted transition-colors hover:border-ink/30 hover:text-ink"
            >
              what each case is
            </a>
          </li>
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          They go through this same form and the same validation — nothing is bypassed. The set is
          built so the run is not all green: a duplicate capture that reconciles perfectly against the
          bank, a weekend posting lag, a refund authorised but not drawn, an orphan bank debit, and two
          disputes with opposite answers.
        </p>
      </div>

      <form ref={formRef} onSubmit={submit} className="mt-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <label className="block">
            <span className="text-micro uppercase tracking-widest text-muted">Label for this run</span>
            <input
              name="label"
              defaultValue="My reconciliation"
              maxLength={120}
              className="mt-1 block min-h-[44px] w-full rounded border border-rule bg-paper px-3 text-sm focus:border-signal"
            />
          </label>
          <label className="block">
            <span className="text-micro uppercase tracking-widest text-muted">Fee %</span>
            <input
              name="feePercent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              defaultValue="2.9"
              className="tnum mt-1 block min-h-[44px] w-24 rounded border border-rule bg-paper px-3 font-mono text-sm focus:border-signal"
            />
          </label>
          <label className="block">
            <span className="text-micro uppercase tracking-widest text-muted">Fixed (cents)</span>
            <input
              name="feeFixedCents"
              type="number"
              step="1"
              min="0"
              defaultValue="30"
              className="tnum mt-1 block min-h-[44px] w-28 rounded border border-rule bg-paper px-3 font-mono text-sm focus:border-signal"
            />
          </label>
        </div>
        <p className="text-xs text-muted">
          Your processor&apos;s schedule. The resolver checks every uploaded fee against it, so getting
          this right is the difference between &ldquo;fees correct&rdquo; and a flagged row.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {SOURCE_KINDS.map((kind) => (
            <label key={kind} className="block rounded border border-rule bg-paper px-3 py-2.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{SOURCE_HELP[kind].label}</span>
                <span className="font-mono text-micro uppercase tracking-widest text-signal">{kind}</span>
              </span>
              <input
                type="file"
                name={kind}
                accept=".csv,.json,.txt,text/csv,application/json,text/plain"
                className="mt-2 block w-full text-xs file:mr-3 file:min-h-[36px] file:rounded file:border file:border-rule file:bg-surface file:px-3 file:text-xs"
              />
              <span className="mt-1.5 block font-mono text-[0.65rem] leading-relaxed text-muted">
                {SOURCE_HELP[kind].columns}
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-quiet" disabled={busy || disabled}>
            {busy ? "Validating…" : "Validate and load"}
          </button>
          {loaded && (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                setReport(null);
                formRef.current?.reset();
                onCleared();
              }}
              disabled={disabled}
            >
              Back to fixtures
            </button>
          )}
        </div>
      </form>

      {error && (
        <p className="mt-4 rounded border border-flagged/40 bg-flagged/[0.06] px-4 py-3 text-sm text-flagged">
          {error}
        </p>
      )}

      {report && (
        <div className="mt-5 border-t border-rule pt-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={`chip ${report.ok ? "border-matched/35 bg-matched/[0.06] text-matched" : "border-flagged/35 bg-flagged/[0.06] text-flagged"}`}>
              {report.ok ? "accepted" : "rejected"}
            </span>
            <span className="tnum font-mono text-xs text-muted">
              {report.totalRows} rows · {(report.bytes / 1024).toFixed(1)}KB
            </span>
            {Object.entries(report.accepted).map(([k, n]) => (
              <span key={k} className="text-xs text-muted">
                <span className="text-matched">{n}</span> {k}
              </span>
            ))}
            {Object.entries(report.rejected).map(([k, n]) => (
              <span key={k} className="text-xs text-muted">
                <span className="text-flagged">{n}</span> {k} rejected
              </span>
            ))}
          </div>

          {fatal.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {fatal.map((f, i) => (
                <li key={i} className="flex gap-2 text-sm text-flagged">
                  <span aria-hidden>✕</span>
                  {f}
                </li>
              ))}
            </ul>
          )}

          {issues.length > 0 && (
            <div className="mt-4">
              <p className="text-micro uppercase tracking-widest text-muted">
                Rows not accepted — {issues.length}
              </p>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {issues.map((i, idx) => (
                  <li key={idx} className="flex flex-wrap gap-x-2 text-xs">
                    <span className="font-mono text-flagged">
                      {i.source} row {i.row}
                    </span>
                    <span className="font-mono text-muted">{i.field}</span>
                    <span className="text-muted">{i.problem}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {truncations.length > 0 && (
            <div className="mt-4">
              <p className="text-micro uppercase tracking-widest text-explained">
                Fields truncated to {LIMITS.MAX_TEXT_CHARS} characters — {truncations.length}
              </p>
              <ul className="mt-2 space-y-1">
                {truncations.map((t, idx) => (
                  <li key={idx} className="text-xs text-muted">
                    <span className="font-mono text-explained">
                      {t.source} row {t.row} · {t.field}
                    </span>{" "}
                    {t.fromChars} → {t.toChars} chars
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
