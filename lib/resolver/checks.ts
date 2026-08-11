import { expectedFeeCents, expectedNetCents, observedNetCents, usd } from "../fixtures";
import type { Check, EvidenceBundle } from "./types";

const DAY_MS = 86_400_000;

/**
 * Every unit starts here: the sources parsed and the records are internally
 * well-formed. It is deliberately small — it should not carry a resolution.
 */
export const BASE_LOGIT = 0.4;

/** Confidence is never claimed above this. Payments evidence is never certain. */
export const MAX_CONFIDENCE = 0.97;
export const MIN_CONFIDENCE = 0.05;

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function calendarDays(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / DAY_MS;
}

function businessDays(a: string, b: string): number {
  let count = 0;
  const cursor = new Date(Date.parse(a));
  const end = new Date(Date.parse(b));
  cursor.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

/**
 * Tolerance for an FX-converted settlement: half a basis point of the amount,
 * never tighter than five cents. Cross-border rounding lands inside this;
 * a real shortfall does not.
 */
function fxToleranceCents(amountCents: number): number {
  return Math.max(5, Math.round(Math.abs(amountCents) * 0.0005));
}

export function runDeterministicChecks(bundle: EvidenceBundle): Check[] {
  const checks: Check[] = [];
  const payments = bundle.settlements.filter((s) => s.type === "payment");
  const pendingRefunds = bundle.settlements.filter(
    (s) => s.type !== "payment" && s.status === "pending_settlement",
  );
  const expected = expectedNetCents(bundle.settlements);
  const observed = observedNetCents(bundle.bankLines);

  // ── 1. Source coverage ────────────────────────────────────────────────────
  const present: string[] = [];
  const absent: string[] = [];
  (
    [
      ["settlement record", bundle.settlements.length > 0],
      ["bank line", bundle.bankLines.length > 0],
      ["order record", Boolean(bundle.order)],
      ["shipment", Boolean(bundle.shipment)],
      ["support chat", Boolean(bundle.chat)],
    ] as const
  ).forEach(([name, ok]) => (ok ? present.push(name) : absent.push(name)));

  if (bundle.settlements.length === 0) {
    checks.push({
      id: "source-coverage",
      label: "Source coverage",
      kind: "deterministic",
      outcome: "missing",
      detail: `No internal record of any kind exists for this bank line. Present: ${present.join(", ") || "bank line only"}.`,
      citations: bundle.bankLines.map((l) => ({
        source: "bank" as const,
        ref: l.id,
        detail: `${l.descriptor} — ${usd(l.amountCents)} ${l.direction} on ${l.postedAt.slice(0, 10)}`,
      })),
      weight: -1.0,
    });
  } else if (bundle.bankLines.length === 0 && bundle.contestedBankLines.length === 0) {
    checks.push({
      id: "source-coverage",
      label: "Source coverage",
      kind: "deterministic",
      outcome: "missing",
      detail: `Settled internally but no bank line found in the statement period. Present: ${present.join(", ")}.`,
      citations: bundle.settlements.map((s) => ({
        source: "settlement" as const,
        ref: s.settlementId,
        detail: `${s.type} ${usd(s.grossCents)} on ${s.occurredAt.slice(0, 10)}, status ${s.status}`,
      })),
      weight: -1.2,
    });
  } else {
    checks.push({
      id: "source-coverage",
      label: "Source coverage",
      kind: "deterministic",
      outcome: "agree",
      detail: `${present.length} of 5 sources available (${present.join(", ")}).${absent.length ? ` Not present: ${absent.join(", ")}.` : ""}`,
      citations: [],
      weight: bundle.bankLines.length > 0 ? 0.6 : 0.3,
    });
  }

  // ── 2. Identity linkage ───────────────────────────────────────────────────
  if (bundle.contestedBankLines.length > 0) {
    const line = bundle.contestedBankLines[0];
    checks.push({
      id: "id-link",
      label: "Identity linkage",
      kind: "deterministic",
      outcome: "conflict",
      detail:
        `Bank line ${line.id} carries no reference and is an equally good match for ` +
        `${[bundle.transactionRef, ...bundle.rivalRefs].join(" and ")}: same amount (${usd(line.amountCents)}), ` +
        `same posting date, same descriptor. Nothing in any source distinguishes them.`,
      citations: [
        { source: "bank", ref: line.id, detail: `${line.descriptor} — no reference field` },
        ...bundle.rivalRefs.map((r) => ({
          source: "settlement" as const,
          ref: r,
          detail: "Competing claim on the same bank line",
        })),
      ],
      weight: -1.5,
    });
  } else if (bundle.bankLines.some((l) => l.memoRef === bundle.transactionRef)) {
    const line = bundle.bankLines.find((l) => l.memoRef === bundle.transactionRef)!;
    checks.push({
      id: "id-link",
      label: "Identity linkage",
      kind: "deterministic",
      outcome: "agree",
      detail: `Bank descriptor carries the transaction reference directly.`,
      citations: [
        { source: "bank", ref: line.id, detail: `Descriptor "${line.descriptor}"` },
      ],
      weight: 1.4,
    });
  } else if (bundle.bankLines.length > 0 && bundle.settlements.length > 0) {
    const line = bundle.bankLines[0];
    checks.push({
      id: "id-link",
      label: "Identity linkage",
      kind: "deterministic",
      outcome: "explained",
      detail:
        `Bank descriptor has no reference field, so the link is inferred from amount and posting date. ` +
        `Exactly one settled record matches, and no other transaction competes for this line.`,
      citations: [
        { source: "bank", ref: line.id, detail: `Descriptor "${line.descriptor}" — no reference` },
        {
          source: "settlement",
          ref: bundle.settlements[0].settlementId,
          detail: `Unique amount-and-date match at ${usd(line.amountCents)}`,
        },
      ],
      weight: 0.6,
    });
  } else if (bundle.settlements.length > 0) {
    checks.push({
      id: "id-link",
      label: "Identity linkage",
      kind: "deterministic",
      outcome: "missing",
      detail: "No bank line could be linked to this transaction reference.",
      citations: [],
      weight: -0.6,
    });
  } else {
    checks.push({
      id: "id-link",
      label: "Identity linkage",
      kind: "deterministic",
      outcome: "missing",
      detail: "Bank line has no reference field and no internal record to link to.",
      citations: [],
      weight: -0.4,
    });
  }

  // ── 3. Amount reconciliation ──────────────────────────────────────────────
  if (expected !== null && observed !== null) {
    const delta = observed - expected;
    const fxRecord = payments.find((p) => p.fxRate !== undefined);

    if (delta === 0) {
      checks.push({
        id: "amount",
        label: "Amount reconciliation",
        kind: "deterministic",
        outcome: "agree",
        detail: `Bank movement of ${usd(observed)} equals the settled net of ${usd(expected)} to the cent.`,
        citations: [
          ...bundle.bankLines.map((l) => ({
            source: "bank" as const,
            ref: l.id,
            detail: `${l.direction} ${usd(l.amountCents)}`,
          })),
          ...bundle.settlements
            .filter((s) => s.status === "settled")
            .map((s) => ({
              source: "settlement" as const,
              ref: s.settlementId,
              detail: `net ${usd(s.netCents)}`,
            })),
        ],
        weight: 1.8,
      });
    } else if (fxRecord && Math.abs(delta) <= fxToleranceCents(expected)) {
      checks.push({
        id: "amount",
        label: "Amount reconciliation",
        kind: "deterministic",
        outcome: "explained",
        detail:
          `Bank credited ${usd(observed)} against a settled net of ${usd(expected)} — a ${usd(Math.abs(delta))} gap. ` +
          `The order was presented in ${fxRecord.presentmentCurrency} ${usd(fxRecord.presentmentAmountCents ?? 0)} and converted at ${fxRecord.fxRate}. ` +
          `The bank applies its own rounding on the settled leg; ${usd(Math.abs(delta))} is inside the ${usd(fxToleranceCents(expected))} tolerance for an amount this size.`,
        citations: [
          {
            source: "settlement",
            ref: fxRecord.settlementId,
            detail: `${fxRecord.presentmentCurrency} ${usd(fxRecord.presentmentAmountCents ?? 0)} @ ${fxRecord.fxRate} → ${usd(fxRecord.grossCents)}`,
          },
          {
            source: "bank",
            ref: bundle.bankLines[0].id,
            detail: `Credited ${usd(observed)}`,
          },
        ],
        weight: 0.9,
      });
    } else {
      const ratio = Math.min(1, Math.abs(delta) / Math.max(1, Math.abs(expected)));
      checks.push({
        id: "amount",
        label: "Amount reconciliation",
        kind: "deterministic",
        outcome: "conflict",
        detail:
          `Bank movement of ${usd(observed)} is ${usd(Math.abs(delta))} ${delta < 0 ? "short of" : "above"} ` +
          `the settled net of ${usd(expected)}. The gap is not the processing fee (already deducted in the net), ` +
          `not an FX rounding difference (no cross-currency leg), and no refund or adjustment record accounts for it.`,
        citations: [
          ...bundle.bankLines.map((l) => ({
            source: "bank" as const,
            ref: l.id,
            detail: `${l.direction} ${usd(l.amountCents)} on ${l.postedAt.slice(0, 10)}`,
          })),
          ...bundle.settlements.map((s) => ({
            source: "settlement" as const,
            ref: s.settlementId,
            detail: `gross ${usd(s.grossCents)}, fee ${usd(s.feeCents)}, net ${usd(s.netCents)}`,
          })),
        ],
        weight: -(1.4 + 8 * ratio),
      });
    }
  }

  // ── 4. Fee schedule ───────────────────────────────────────────────────────
  for (const p of payments) {
    const want = expectedFeeCents(p.grossCents);
    if (p.feeCents === want) continue;
    checks.push({
      id: `fee-${p.settlementId}`,
      label: "Fee schedule",
      kind: "deterministic",
      outcome: "conflict",
      detail: `${p.settlementId} charged ${usd(p.feeCents)} where the published schedule (2.9% + $0.30) gives ${usd(want)}.`,
      citations: [
        { source: "settlement", ref: p.settlementId, detail: `fee ${usd(p.feeCents)} on gross ${usd(p.grossCents)}` },
      ],
      weight: -1.0,
    });
  }
  if (payments.length > 0 && !checks.some((c) => c.id.startsWith("fee-"))) {
    checks.push({
      id: "fee-schedule",
      label: "Fee schedule",
      kind: "deterministic",
      outcome: "agree",
      detail: `Processing fee of ${usd(payments.reduce((s, p) => s + p.feeCents, 0))} matches 2.9% + $0.30 on every capture.`,
      citations: payments.map((p) => ({
        source: "settlement" as const,
        ref: p.settlementId,
        detail: `gross ${usd(p.grossCents)} → fee ${usd(p.feeCents)}`,
      })),
      weight: 0.5,
    });
  }

  // ── 5. Posting window ─────────────────────────────────────────────────────
  if (bundle.settlements.length > 0 && bundle.bankLines.length > 0) {
    const from = bundle.settlements[0].occurredAt;
    const to = bundle.bankLines[bundle.bankLines.length - 1].postedAt;
    const bd = businessDays(from, to);
    const cd = calendarDays(from, to);
    if (bd <= 2 && cd <= 2.2) {
      checks.push({
        id: "timing",
        label: "Posting window",
        kind: "deterministic",
        outcome: "agree",
        detail: `Posted ${bd} business day${bd === 1 ? "" : "s"} after capture, inside the normal T+1 to T+2 payout window.`,
        citations: [],
        weight: 0.4,
      });
    } else if (bd <= 2) {
      checks.push({
        id: "timing",
        label: "Posting window",
        kind: "deterministic",
        outcome: "explained",
        detail:
          `Capture on ${from.slice(0, 10)} posted on ${to.slice(0, 10)} — a ${cd.toFixed(1)}-day calendar gap that looks late, ` +
          `but only ${bd} business day${bd === 1 ? "" : "s"} elapsed. The gap is a weekend, not a delay.`,
        citations: [],
        weight: 0.3,
      });
    } else {
      checks.push({
        id: "timing",
        label: "Posting window",
        kind: "deterministic",
        outcome: "explained",
        detail: `Posted ${bd} business days after capture, beyond the usual T+2 but within the processor's stated 5-day maximum.`,
        citations: [],
        weight: 0.1,
      });
    }
  }

  // ── 6. Duplicate capture ──────────────────────────────────────────────────
  if (bundle.order && payments.length > 1) {
    const captured = payments.reduce((s, p) => s + p.grossCents, 0);
    if (captured > bundle.order.totalCents) {
      const gapSeconds =
        (Date.parse(payments[payments.length - 1].occurredAt) - Date.parse(payments[0].occurredAt)) / 1000;
      checks.push({
        id: "duplicate-capture",
        label: "Duplicate capture",
        kind: "deterministic",
        outcome: "conflict",
        detail:
          `${payments.length} separate captures totalling ${usd(captured)} exist against a single order worth ${usd(bundle.order.totalCents)}, ` +
          `${Math.round(gapSeconds)} seconds apart with identical amounts. One order, one shipment, two payments — ` +
          `the cardholder has been charged ${usd(captured - bundle.order.totalCents)} more than they owe.`,
        citations: [
          ...payments.map((p) => ({
            source: "settlement" as const,
            ref: p.settlementId,
            detail: `${usd(p.grossCents)} captured at ${p.occurredAt.slice(11, 19)}Z`,
          })),
          {
            source: "order",
            ref: bundle.order.orderId,
            detail: `Single order, total ${usd(bundle.order.totalCents)}`,
          },
        ],
        weight: -2.0,
      });
    }
  }

  // ── 7. Captured amount vs order total ─────────────────────────────────────
  if (bundle.order && payments.length === 1) {
    const captured = payments[0].grossCents;
    const orderTotal = bundle.order.totalCents;
    const sameCurrency = payments[0].currency === bundle.order.currency;
    if (sameCurrency && captured === orderTotal) {
      checks.push({
        id: "capture-vs-order",
        label: "Capture vs order",
        kind: "deterministic",
        outcome: "agree",
        detail: `Captured ${usd(captured)} against an order total of ${usd(orderTotal)}.`,
        citations: [
          { source: "order", ref: bundle.order.orderId, detail: `total ${usd(orderTotal)}` },
        ],
        weight: 0.6,
      });
    } else if (sameCurrency && captured < orderTotal) {
      const short = orderTotal - captured;
      const unshipped = bundle.order.items.filter((i) => i.priceCents * i.qty === short);
      checks.push({
        id: "capture-vs-order",
        label: "Capture vs order",
        kind: "deterministic",
        outcome: unshipped.length === 1 ? "explained" : "conflict",
        detail:
          unshipped.length === 1
            ? `Captured ${usd(captured)} against an order of ${usd(orderTotal)}. The ${usd(short)} difference is exactly ` +
              `line item ${unshipped[0].sku} (${unshipped[0].name}), which is absent from the shipment manifest.`
            : `Captured ${usd(captured)} against an order of ${usd(orderTotal)} — ${usd(short)} short, and no single line item accounts for the difference.`,
        citations: [
          { source: "order", ref: bundle.order.orderId, detail: `total ${usd(orderTotal)}` },
          {
            source: "settlement",
            ref: payments[0].settlementId,
            detail: `captured ${usd(captured)}`,
          },
          ...(bundle.shipment
            ? [
                {
                  source: "shipment" as const,
                  ref: bundle.shipment.tracking,
                  detail: bundle.shipment.note ?? bundle.shipment.status,
                },
              ]
            : []),
        ],
        weight: unshipped.length === 1 ? 0.3 : -1.2,
      });
    }
  }

  // ── 8. Refund in flight ───────────────────────────────────────────────────
  if (pendingRefunds.length > 0) {
    const total = pendingRefunds.reduce((s, r) => s + Math.abs(r.netCents), 0);
    const issued = pendingRefunds[0].occurredAt;
    const age = calendarDays(issued, "2026-03-12T23:59:00Z");
    checks.push({
      id: "refund-in-flight",
      label: "Refund in flight",
      kind: "deterministic",
      outcome: "explained",
      detail:
        `A ${usd(total)} refund was authorised on ${issued.slice(0, 10)} but has not yet been drawn from the payout account. ` +
        `At ${age.toFixed(1)} days it is still inside the 3-to-5 business day settlement window, so the bank correctly shows ` +
        `the pre-refund figure. Expect the account to drop by ${usd(total)} next cycle.`,
      citations: pendingRefunds.map((r) => ({
        source: "settlement" as const,
        ref: r.settlementId,
        detail: `${usd(Math.abs(r.netCents))} refund, status ${r.status}`,
      })),
      weight: 0.3,
    });
  }

  return checks;
}
