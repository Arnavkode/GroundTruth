import { expectedNetCents, observedNetCents, usd } from "../fixtures";
import { BASE_LOGIT, MAX_CONFIDENCE, MIN_CONFIDENCE, runDeterministicChecks, sigmoid } from "./checks";
import { calibrateWeight } from "./calibration";
import { mockJudgement } from "./mock-reasoning";
import type {
  Check,
  Citation,
  EvidenceBundle,
  LlmJudgement,
  ResolvedStatus,
  Resolution,
  TimelineEvent,
} from "./types";

/** A conflict at or beyond this magnitude forces a flag regardless of score. */
const HARD_CONFLICT_WEIGHT = -1.0;

/** Below this, the resolver will not claim a resolution. */
const FLAG_THRESHOLD = 0.6;

/** A transaction that cannot be uniquely identified is capped here, hard. */
const AMBIGUITY_CAP = 0.4;

/**
 * Confidence cannot exceed what the available evidence supports, however well
 * the present sources agree. Five sources → no cap; one source → 0.84.
 */
function coverageCap(bundle: EvidenceBundle): number {
  const count = [
    bundle.settlements.length > 0,
    bundle.bankLines.length > 0 || bundle.contestedBankLines.length > 0,
    Boolean(bundle.order),
    Boolean(bundle.shipment),
    Boolean(bundle.chat),
  ].filter(Boolean).length;
  return Math.min(MAX_CONFIDENCE, 0.8 + 0.04 * count);
}

function buildTimeline(bundle: EvidenceBundle): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  if (bundle.order) {
    events.push({
      at: bundle.order.placedAt,
      source: "order",
      ref: bundle.order.orderId,
      label: "Order placed",
      detail: `${bundle.order.customerName} — ${usd(bundle.order.totalCents)} ${bundle.order.currency}, ${bundle.order.items.length} line item(s). AVS ${bundle.order.avsResult}, CVV ${bundle.order.cvvResult}.`,
    });
  }

  for (const s of bundle.settlements) {
    const verb =
      s.type === "payment" ? "Payment captured" : s.type === "refund" ? "Refund issued" : "Partial refund issued";
    events.push({
      at: s.occurredAt,
      source: "settlement",
      ref: s.settlementId,
      label: verb,
      detail: `${usd(Math.abs(s.grossCents))} gross, ${usd(s.feeCents)} fee, ${usd(s.netCents)} net — ${s.status.replace("_", " ")}.`,
    });
  }

  if (bundle.shipment) {
    events.push({
      at: bundle.shipment.shippedAt,
      source: "shipment",
      ref: bundle.shipment.tracking,
      label: "Shipped",
      detail: `${bundle.shipment.carrier} ${bundle.shipment.tracking}.`,
    });
    if (bundle.shipment.deliveredAt) {
      events.push({
        at: bundle.shipment.deliveredAt,
        source: "shipment",
        ref: bundle.shipment.tracking,
        label: bundle.shipment.deliveryMatchesOrderAddress === false ? "Delivered — address mismatch" : "Delivered",
        detail:
          `${bundle.shipment.signature ? `Signed "${bundle.shipment.signature}"` : "No signature"}` +
          `${bundle.shipment.deliveryPostal ? `, ZIP ${bundle.shipment.deliveryPostal}` : ""}.` +
          `${bundle.shipment.note ? ` ${bundle.shipment.note}` : ""}`,
      });
    }
  }

  for (const line of [...bundle.bankLines, ...bundle.contestedBankLines]) {
    events.push({
      at: line.postedAt,
      source: "bank",
      ref: line.id,
      label: line.direction === "credit" ? "Bank credit posted" : "Bank debit posted",
      detail: `${usd(line.amountCents)} — "${line.descriptor}".`,
    });
  }

  if (bundle.chat) {
    for (const msg of bundle.chat.transcript) {
      events.push({
        at: msg.ts,
        source: "chat",
        ref: bundle.chat.chatId,
        label: msg.from === "customer" ? "Customer message" : "Support reply",
        detail: msg.text,
      });
    }
  }

  if (bundle.dispute) {
    events.push({
      at: bundle.dispute.filedAt,
      source: "dispute",
      ref: bundle.dispute.disputeId,
      label: `Chargeback filed — ${bundle.dispute.reasonCode} ${bundle.dispute.reasonText}`,
      detail: `"${bundle.dispute.cardholderStatement}"`,
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = `${c.source}:${c.ref}:${c.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function scoreAndClassify(
  bundle: EvidenceBundle,
  checks: Check[],
  judgement: LlmJudgement,
  llmWeight: number = judgement.weight,
): {
  status: ResolvedStatus;
  confidence: number;
  identifiabilityNote?: string;
  scoring: Resolution["scoring"];
} {
  const logit = BASE_LOGIT + checks.reduce((sum, c) => sum + c.weight, 0) + llmWeight;
  const uncapped = sigmoid(logit);

  let confidence = uncapped;
  const cap = coverageCap(bundle);
  confidence = Math.min(confidence, cap);

  let identifiabilityNote: string | undefined;
  if (bundle.contestedBankLines.length > 0) {
    confidence = Math.min(confidence, AMBIGUITY_CAP);
    identifiabilityNote =
      `Confidence is capped at ${Math.round(AMBIGUITY_CAP * 100)}% because this transaction is not uniquely ` +
      `identifiable: bank line ${bundle.contestedBankLines[0].id} matches ${bundle.rivalRefs.length + 1} transactions equally well.`;
  }

  confidence = Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, confidence));

  const scoring: Resolution["scoring"] = {
    intercept: Number(BASE_LOGIT.toFixed(4)),
    contributions: [
      { label: "Prior (fitted intercept)", weight: Number(BASE_LOGIT.toFixed(4)), kind: "intercept" as const },
      ...checks.map((c) => ({
        label: c.label,
        weight: Number(c.weight.toFixed(4)),
        kind: "deterministic" as const,
      })),
      { label: "Evidence reading", weight: Number(llmWeight.toFixed(4)), kind: "llm" as const },
    ],
    logit: Number(logit.toFixed(4)),
    uncapped: Math.round(uncapped * 100) / 100,
    coverageCap: Math.round(cap * 100) / 100,
    ambiguityCap: bundle.contestedBankLines.length > 0 ? AMBIGUITY_CAP : null,
  };

  const hardConflict = checks.some(
    (c) => c.outcome === "conflict" && c.weight <= HARD_CONFLICT_WEIGHT,
  );
  const hasExplained = checks.some((c) => c.outcome === "explained");

  let status: ResolvedStatus;
  if (hardConflict || confidence < FLAG_THRESHOLD) {
    status = "flagged";
  } else if (hasExplained) {
    status = "explained-difference";
  } else {
    status = "matched";
  }

  return { status, confidence: Math.round(confidence * 100) / 100, identifiabilityNote, scoring };
}

/**
 * Resolve one transaction. `judgement` is injected so mock and real share this
 * path. `rawWeight` is the model's own stated figure before calibration — only
 * present in real mode, and kept so the UI can show both numbers.
 */
export function assembleResolution(
  bundle: EvidenceBundle,
  judgement: LlmJudgement,
  rawWeight?: number,
): Resolution {
  const checks = runDeterministicChecks(bundle);

  // A live model's stated weight is a claim about itself. Fit 2 turns it into a
  // measurement; until that fit exists the raw value passes through, labelled.
  const calibration =
    judgement.provenance === "real"
      ? calibrateWeight(rawWeight ?? judgement.weight)
      : undefined;
  const effectiveLlmWeight = calibration ? calibration.calibrated : judgement.weight;
  const llmCheck: Check = {
    id: "llm-reasoning",
    label: "Evidence reading",
    kind: "llm",
    outcome:
      judgement.verdict === "corroborates"
        ? "agree"
        : judgement.verdict === "contradicts"
          ? "conflict"
          : judgement.verdict === "inconclusive"
            ? "conflict"
            : "missing",
    detail: judgement.rationale,
    citations: judgement.citations,
    weight: effectiveLlmWeight,
  };
  const allChecks = [...checks, llmCheck];

  const { status, confidence, identifiabilityNote, scoring } = scoreAndClassify(
    bundle,
    checks,
    judgement,
    effectiveLlmWeight,
  );

  const expected = expectedNetCents(bundle.settlements);
  const observed = observedNetCents(bundle.bankLines);

  return {
    transactionRef: bundle.transactionRef,
    status,
    confidence,
    headline: judgement.headline,
    explanation: judgement.explanation,
    checks: allChecks,
    timeline: buildTimeline(bundle),
    citations: dedupeCitations(allChecks.flatMap((c) => c.citations)),
    amounts: {
      expectedNetCents: expected,
      observedNetCents: observed,
      deltaCents: expected !== null && observed !== null ? observed - expected : null,
    },
    identifiabilityNote,
    reasoningProvenance: judgement.provenance,
    scoring,
    calibration,
  };
}

/** Mock-mode resolution. The default path, and the one verified tonight. */
export function resolveMock(bundle: EvidenceBundle): Resolution {
  const checks = runDeterministicChecks(bundle);
  return assembleResolution(bundle, mockJudgement(bundle, checks));
}
