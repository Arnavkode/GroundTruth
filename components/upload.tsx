"use client";

import { useRef, useState } from "react";
import { LIMITS, SOURCE_KINDS, type IngestReport, type SourceKind } from "@/lib/ingest";
import type { EvidenceDataset } from "@/lib/resolver/types";

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
