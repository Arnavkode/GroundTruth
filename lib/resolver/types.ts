export type SourceId = "bank" | "settlement" | "order" | "shipment" | "chat" | "dispute";

/** What a single check concluded about the evidence it looked at. */
export type CheckOutcome = "agree" | "explained" | "conflict" | "missing";

/** The resolver's three possible verdicts. */
export type ResolvedStatus = "matched" | "explained-difference" | "flagged";

export interface Citation {
  source: SourceId;
  /** The specific record this cites — BNK-004, SET-1006A, CHT-1013, … */
  ref: string;
  /** What that record actually says, quoted or stated as a value. */
  detail: string;
}

export interface Check {
  id: string;
  label: string;
  kind: "deterministic" | "llm";
  outcome: CheckOutcome;
  detail: string;
  citations: Citation[];
  /**
   * Log-odds contribution toward "this resolution is correct".
   * Positive corroborates, negative undermines. See confidence.ts.
   */
  weight: number;
}

export interface TimelineEvent {
  at: string;
  source: SourceId;
  ref: string;
  label: string;
  detail: string;
  /** Only set in Investigate mode, relative to the cardholder's claim. */
  stance?: "supports-merchant" | "supports-cardholder" | "neutral";
}

export interface BankLine {
  id: string;
  postedAt: string;
  descriptor: string;
  amountCents: number;
  direction: "credit" | "debit";
  memoRef: string | null;
}

export interface SettlementRecord {
  settlementId: string;
  transactionRef: string;
  orderId: string;
  type: "payment" | "refund" | "partial_refund";
  occurredAt: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  currency: string;
  status: "settled" | "pending_settlement";
  note?: string;
  presentmentCurrency?: string;
  presentmentAmountCents?: number;
  fxRate?: number;
}

export interface OrderRecord {
  orderId: string;
  transactionRef: string;
  customerName: string;
  email: string;
  placedAt: string;
  totalCents: number;
  currency: string;
  items: { sku: string; name: string; qty: number; priceCents: number }[];
  shippingAddress: {
    line1: string;
    city: string;
    region: string;
    postal: string;
    country: string;
  };
  avsResult: "Y" | "Z" | "N" | "U";
  cvvResult: "M" | "N" | "U";
  ip: string;
  deviceId: string;
  note?: string;
}

export interface ShipmentRecord {
  orderId: string;
  carrier: string;
  tracking: string;
  shippedAt: string;
  deliveredAt: string | null;
  status: string;
  signature: string | null;
  deliveryPostal: string | null;
  deliveryMatchesOrderAddress: boolean | null;
  note?: string;
}

export interface ChatRecord {
  chatId: string;
  orderId: string;
  openedAt: string;
  transcript: { ts: string; from: "customer" | "agent"; text: string }[];
  outcome: string;
  note?: string;
}

export interface DisputeRecord {
  disputeId: string;
  transactionRef: string;
  orderId: string;
  reasonCode: string;
  reasonText: string;
  network: string;
  amountCents: number;
  filedAt: string;
  respondBy: string;
  cardholderStatement: string;
  label: string;
  blurb: string;
}

/**
 * Everything known about one transaction, assembled before any reasoning runs.
 * Missing pieces stay undefined on purpose — absence is evidence.
 */
export interface FeeSchedule {
  percentBps: number;
  fixedCents: number;
  note?: string;
}

/**
 * A complete evidence set. Bundled fixtures and a validated upload produce the
 * identical shape, so the resolver cannot tell them apart — and must not.
 */
export interface EvidenceDataset {
  origin: "fixtures" | "upload";
  label: string;
  feeSchedule: FeeSchedule;
  bankLines: BankLine[];
  settlements: SettlementRecord[];
  orders: OrderRecord[];
  shipments: ShipmentRecord[];
  chats: ChatRecord[];
  disputes: DisputeRecord[];
}

export interface EvidenceBundle {
  transactionRef: string;
  /** Carried on the bundle so checks never reach for module-level fixture state. */
  feeSchedule: FeeSchedule;
  /** Where this evidence came from. Surfaced in the UI; never changes the logic. */
  origin: "fixtures" | "upload";
  settlements: SettlementRecord[];
  bankLines: BankLine[];
  /** Bank lines that could belong here but are also claimed by another unit. */
  contestedBankLines: BankLine[];
  /** Other transaction refs competing for the same contested bank line. */
  rivalRefs: string[];
  order?: OrderRecord;
  shipment?: ShipmentRecord;
  chat?: ChatRecord;
  dispute?: DisputeRecord;
  /** True when this unit exists only because a bank line had no internal record. */
  bankOnly: boolean;
}

export interface LlmJudgement {
  question: string;
  verdict: "corroborates" | "contradicts" | "inconclusive" | "not-applicable";
  rationale: string;
  citations: Citation[];
  weight: number;
  headline: string;
  explanation: string;
  /** "mock" tonight; "real" once a key is present. Always surfaced in the UI. */
  provenance: "mock" | "real";
}

export interface Resolution {
  transactionRef: string;
  status: ResolvedStatus;
  confidence: number;
  headline: string;
  explanation: string;
  checks: Check[];
  timeline: TimelineEvent[];
  citations: Citation[];
  amounts: {
    expectedNetCents: number | null;
    observedNetCents: number | null;
    deltaCents: number | null;
  };
  /** Set when confidence was capped because the transaction is not uniquely identifiable. */
  identifiabilityNote?: string;
  reasoningProvenance: "mock" | "real";
}

export interface Rebuttal {
  disputeId: string;
  transactionRef: string;
  winLikelihood: number;
  recommendation: "represent" | "accept-liability" | "represent-with-caution";
  recommendationNote: string;
  letter: string;
  /** Every claim in the letter traces back to one of these. */
  evidenceCited: Citation[];
  provenance: "mock" | "real";
}
