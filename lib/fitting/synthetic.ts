import type { EvidenceDataset } from "../resolver/types";

/**
 * Synthetic transaction generator.
 *
 * SYNTHETIC DATA, NOT REAL. Every example here is constructed by this file, so
 * the ground-truth label is known by construction rather than annotated: the
 * generator decides whether it is injecting a genuine anomaly, and that decision
 * *is* the label. No proprietary or real payments data is used anywhere in this
 * project.
 *
 * What that buys and what it does not: the fitted weights are a real, honest fit
 * to this distribution. They are not evidence that the model generalises to a
 * real acquirer's book, because the archetypes and their frequencies were chosen
 * by hand. It replaces "these constants felt right" with "these constants are
 * the maximum-likelihood fit to a stated distribution", which is a smaller claim
 * but a true one.
 */

export type Archetype =
  | "clean-match"
  | "fee-only-no-ref"
  | "weekend-lag"
  | "fx-rounding"
  | "refund-in-flight"
  | "partial-capture"
  | "clean-refund"
  | "duplicate-capture"
  | "contested-identity"
  | "unexplained-shortfall"
  | "bank-only-orphan"
  | "fee-mismatch"
  | "missing-bank-line";

/** y = 1 means "this needs no human"; y = 0 means "a person must look at this". */
export const ARCHETYPE_LABEL: Record<Archetype, 0 | 1> = {
  "clean-match": 1,
  "fee-only-no-ref": 1,
  "weekend-lag": 1,
  "fx-rounding": 1,
  "refund-in-flight": 1,
  "partial-capture": 1,
  "clean-refund": 1,
  "duplicate-capture": 0,
  "contested-identity": 0,
  "unexplained-shortfall": 0,
  "bank-only-orphan": 0,
  "fee-mismatch": 0,
  "missing-bank-line": 0,
};

/**
 * Mixture weights. Deliberately benign-heavy — in a real book most differences
 * are legitimate, and a fit against a 50/50 mixture would learn a prior that
 * does not exist in the wild.
 */
const MIX: [Archetype, number][] = [
  ["clean-match", 22],
  ["fee-only-no-ref", 12],
  ["weekend-lag", 10],
  ["fx-rounding", 8],
  ["refund-in-flight", 7],
  ["partial-capture", 6],
  ["clean-refund", 7],
  ["duplicate-capture", 6],
  ["contested-identity", 5],
  ["unexplained-shortfall", 6],
  ["bank-only-orphan", 4],
  ["fee-mismatch", 4],
  ["missing-bank-line", 3],
];

/** Deterministic PRNG so a fit is reproducible from its seed. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FEE = { percentBps: 290, fixedCents: 30 };
const feeFor = (gross: number) => Math.round((gross * FEE.percentBps) / 10_000) + FEE.fixedCents;

function isoAt(dayOffset: number, hour: number, minute = 0): string {
  const base = Date.UTC(2026, 3, 6, hour, minute, 0); // Mon 6 Apr 2026
  return new Date(base + dayOffset * 86_400_000).toISOString();
}

export interface SyntheticExample {
  archetype: Archetype;
  label: 0 | 1;
  dataset: EvidenceDataset;
  /** The transactionRef whose resolution is the labelled unit. */
  target: string;
}

function emptyDataset(): EvidenceDataset {
  return {
    origin: "fixtures",
    label: "synthetic",
    feeSchedule: FEE,
    bankLines: [],
    settlements: [],
    orders: [],
    shipments: [],
    chats: [],
    disputes: [],
  };
}

export function makeExample(archetype: Archetype, i: number, rand: () => number): SyntheticExample {
  const d = emptyDataset();
  const ref = `SYN-${String(i).padStart(5, "0")}`;
  const orderId = `ORD-${ref}`;
  const gross = 1000 + Math.floor(rand() * 40_000);
  const fee = feeFor(gross);
  const net = gross - fee;
  const day = Math.floor(rand() * 5);

  const order = (total: number, extra: Partial<EvidenceDataset["orders"][number]> = {}) => ({
    orderId,
    transactionRef: ref,
    customerName: `Customer ${i}`,
    email: `c${i}@example.com`,
    placedAt: isoAt(day, 9),
    totalCents: total,
    currency: "USD",
    items: [{ sku: "SKU-1", name: "Item", qty: 1, priceCents: total }],
    shippingAddress: { line1: "1 Test St", city: "Town", region: "ST", postal: "00000", country: "US" },
    avsResult: "Y" as const,
    cvvResult: "M" as const,
    ip: "10.0.0.1",
    deviceId: `dev_${i}`,
    ...extra,
  });

  const payment = (over: Partial<EvidenceDataset["settlements"][number]> = {}) => ({
    settlementId: `SET-${ref}`,
    transactionRef: ref,
    orderId,
    type: "payment" as const,
    occurredAt: isoAt(day, 10),
    grossCents: gross,
    feeCents: fee,
    netCents: net,
    currency: "USD",
    status: "settled" as const,
    ...over,
  });

  const bank = (over: Partial<EvidenceDataset["bankLines"][number]> = {}) => ({
    id: `BNK-${ref}`,
    postedAt: isoAt(day + 1, 0),
    descriptor: `ACME STLMT ${ref}`,
    amountCents: net,
    direction: "credit" as const,
    memoRef: ref,
    ...over,
  });

  const shipment = (over: Partial<EvidenceDataset["shipments"][number]> = {}) => ({
    orderId,
    carrier: "UPS",
    tracking: `TRK-${ref}`,
    shippedAt: isoAt(day + 1, 12),
    deliveredAt: isoAt(day + 3, 12),
    status: "delivered",
    signature: "SIG",
    deliveryPostal: "00000",
    deliveryMatchesOrderAddress: true,
    ...over,
  });

  switch (archetype) {
    case "clean-match":
      d.settlements.push(payment());
      d.bankLines.push(bank());
      d.orders.push(order(gross));
      d.shipments.push(shipment());
      break;

    case "fee-only-no-ref":
      // Reference missing from the descriptor; the link is inferred.
      d.settlements.push(payment());
      d.bankLines.push(bank({ memoRef: null, descriptor: "ACME STLMT BATCH" }));
      d.orders.push(order(gross));
      break;

    case "weekend-lag": {
      // Captured late Friday, posted Monday: 2.5 calendar days, 1 business day.
      d.settlements.push(payment({ occurredAt: isoAt(4, 21, 40) }));
      d.bankLines.push(bank({ postedAt: isoAt(7, 9, 12) }));
      d.orders.push(order(gross));
      break;
    }

    case "fx-rounding": {
      const drift = 1 + Math.floor(rand() * 3);
      d.settlements.push(
        payment({ presentmentCurrency: "EUR", presentmentAmountCents: Math.round(gross / 1.08), fxRate: 1.08 }),
      );
      d.bankLines.push(bank({ amountCents: net - drift }));
      d.orders.push(order(gross, { currency: "USD" }));
      break;
    }

    case "refund-in-flight": {
      const refund = Math.min(gross - 100, 1000 + Math.floor(rand() * 4000));
      d.settlements.push(payment());
      d.settlements.push({
        settlementId: `SET-${ref}R`,
        transactionRef: ref,
        orderId,
        type: "partial_refund",
        occurredAt: isoAt(day + 2, 17),
        grossCents: -refund,
        feeCents: 0,
        netCents: -refund,
        currency: "USD",
        status: "pending_settlement",
      });
      d.bankLines.push(bank());
      d.orders.push(order(gross));
      d.shipments.push(shipment());
      break;
    }

    case "partial-capture": {
      // Order carries a line item that was never captured or shipped.
      const dropped = 1000 + Math.floor(rand() * 3000);
      const total = gross + dropped;
      d.settlements.push(payment());
      d.bankLines.push(bank());
      d.orders.push({
        ...order(total),
        items: [
          { sku: "SKU-1", name: "Item", qty: 1, priceCents: gross },
          { sku: "SKU-2", name: "Backordered", qty: 1, priceCents: dropped },
        ],
      });
      d.shipments.push(shipment({ deliveredAt: null, status: "in_transit", signature: null, deliveryPostal: null, deliveryMatchesOrderAddress: null }));
      break;
    }

    case "clean-refund": {
      const amount = 1000 + Math.floor(rand() * 8000);
      d.settlements.push({
        settlementId: `SET-${ref}R`,
        transactionRef: ref,
        orderId,
        type: "refund",
        occurredAt: isoAt(day, 14),
        grossCents: -amount,
        feeCents: 0,
        netCents: -amount,
        currency: "USD",
        status: "settled",
      });
      d.bankLines.push(bank({ amountCents: amount, direction: "debit" }));
      d.orders.push(order(amount));
      break;
    }

    case "duplicate-capture": {
      const gap = 20 + Math.floor(rand() * 60);
      d.settlements.push(payment({ settlementId: `SET-${ref}A` }));
      d.settlements.push(
        payment({ settlementId: `SET-${ref}B`, occurredAt: new Date(Date.parse(isoAt(day, 10)) + gap * 1000).toISOString() }),
      );
      d.bankLines.push(bank({ id: `BNK-${ref}A` }));
      d.bankLines.push(bank({ id: `BNK-${ref}B` }));
      d.orders.push(order(gross));
      d.shipments.push(shipment());
      break;
    }

    case "contested-identity": {
      // Two transactions, identical nets, one unlabelled bank credit.
      const refB = `${ref}B`;
      d.settlements.push(payment({ transactionRef: ref }));
      d.settlements.push({
        ...payment(),
        settlementId: `SET-${refB}`,
        transactionRef: refB,
        orderId: `ORD-${refB}`,
        occurredAt: isoAt(day, 10, 13),
      });
      d.bankLines.push(bank({ memoRef: null, descriptor: "ACME STLMT BATCH" }));
      d.orders.push(order(gross));
      d.orders.push({ ...order(gross), orderId: `ORD-${refB}`, transactionRef: refB });
      break;
    }

    case "unexplained-shortfall": {
      const short = 500 + Math.floor(rand() * 2000);
      d.settlements.push(payment());
      d.bankLines.push(bank({ amountCents: net - short }));
      d.orders.push(order(gross));
      d.shipments.push(shipment());
      break;
    }

    case "bank-only-orphan":
      d.bankLines.push({
        id: `BNK-${ref}`,
        postedAt: isoAt(day, 0),
        descriptor: "ACME ADJ UNKNOWN",
        amountCents: 500 + Math.floor(rand() * 5000),
        direction: "debit",
        memoRef: null,
      });
      return { archetype, label: ARCHETYPE_LABEL[archetype], dataset: d, target: `BNK-${ref}` };

    case "fee-mismatch": {
      const wrongFee = fee + 300 + Math.floor(rand() * 900);
      d.settlements.push(payment({ feeCents: wrongFee, netCents: gross - wrongFee }));
      d.bankLines.push(bank({ amountCents: gross - wrongFee }));
      d.orders.push(order(gross));
      break;
    }

    case "missing-bank-line":
      d.settlements.push(payment());
      d.orders.push(order(gross));
      d.shipments.push(shipment());
      break;
  }

  return { archetype, label: ARCHETYPE_LABEL[archetype], dataset: d, target: ref };
}

export function generate(n: number, seed = 42): SyntheticExample[] {
  const rand = rng(seed);
  const total = MIX.reduce((s, [, w]) => s + w, 0);
  const out: SyntheticExample[] = [];
  let i = 0;
  while (out.length < n) {
    let pick = rand() * total;
    let chosen: Archetype = MIX[0][0];
    for (const [a, w] of MIX) {
      pick -= w;
      if (pick <= 0) {
        chosen = a;
        break;
      }
    }
    out.push(makeExample(chosen, i, rand));
    i += 1;
  }
  return out;
}
