import Anthropic from "@anthropic-ai/sdk";
import { usd } from "../fixtures";
import { mockJudgement } from "./mock-reasoning";
import type { Check, EvidenceBundle, LlmJudgement } from "./types";

/**
 * Real-mode reasoning step.
 *
 * NOT EXERCISED TONIGHT — no real ANTHROPIC_API_KEY exists in this environment
 * by design, so every run took the mock path. This code is wired correctly but
 * unverified against the live API; see MORNING_CHECKLIST.md for the exact
 * verification steps before trusting it.
 *
 * Callers must have already cleared lib/ratelimit.ts. This function does not
 * check limits itself — it assumes a slot was reserved.
 */

/** Firm ceiling. No open-ended generations, ever. */
const MAX_TOKENS = 1200;

function model(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
}

const SYSTEM = `You are the reasoning step inside a payments reconciliation engine.

Deterministic checks have already compared amounts, fees, timestamps and IDs. Your job is the part they cannot do: read the unstructured evidence — support transcripts, carrier notes, order metadata — and say whether it corroborates or contradicts the mechanical picture.

Rules:
- Cite specific records by their ID (BNK-004, SET-1006A, CHT-1013, ORD-1010). Never make a claim you cannot attach to a record in the bundle.
- If the evidence genuinely does not settle the question, say "inconclusive". A flagged low-confidence result is a correct answer. Do not manufacture a resolution to look decisive.
- Do not restate the deterministic checks. Add what only a reader of the narrative evidence can add.
- Plain, exact, unhedged prose. This is an ops tool, not a chat assistant.

Reply with a single JSON object and nothing else:
{
  "verdict": "corroborates" | "contradicts" | "inconclusive" | "not-applicable",
  "rationale": "why the narrative evidence points that way, citing record IDs",
  "citations": [{"source":"bank|settlement|order|shipment|chat|dispute","ref":"RECORD-ID","detail":"what that record says"}],
  "weight": <number between -1 and 1: how much your reading should move confidence>,
  "headline": "one sentence, under 120 characters, stating what happened",
  "explanation": "3-6 sentences a payments ops lead could act on"
}`;

function renderBundle(bundle: EvidenceBundle, checks: Check[]): string {
  const parts: string[] = [`TRANSACTION ${bundle.transactionRef}`];

  parts.push(
    "\nSETTLEMENT RECORDS:\n" +
      (bundle.settlements.length
        ? bundle.settlements
            .map(
              (s) =>
                `  ${s.settlementId} | ${s.type} | ${s.occurredAt} | gross ${usd(s.grossCents)} fee ${usd(s.feeCents)} net ${usd(s.netCents)} ${s.currency} | ${s.status}` +
                (s.presentmentCurrency
                  ? ` | presented ${s.presentmentCurrency} ${usd(s.presentmentAmountCents ?? 0)} @ ${s.fxRate}`
                  : "") +
                (s.note ? ` | ${s.note}` : ""),
            )
            .join("\n")
        : "  (none — this bank line has no internal counterpart)"),
  );

  parts.push(
    "\nBANK LINES:\n" +
      ([...bundle.bankLines, ...bundle.contestedBankLines]
        .map(
          (l) =>
            `  ${l.id} | ${l.postedAt} | ${l.direction} ${usd(l.amountCents)} | "${l.descriptor}" | ref ${l.memoRef ?? "NONE"}` +
            (bundle.contestedBankLines.includes(l)
              ? `  <-- CONTESTED: also matches ${bundle.rivalRefs.join(", ")}`
              : ""),
        )
        .join("\n") || "  (none)"),
  );

  if (bundle.order) {
    const o = bundle.order;
    parts.push(
      `\nORDER ${o.orderId}:\n  ${o.customerName} <${o.email}> placed ${o.placedAt}, total ${usd(o.totalCents)} ${o.currency}\n` +
        `  ship to ${o.shippingAddress.line1}, ${o.shippingAddress.city} ${o.shippingAddress.region} ${o.shippingAddress.postal}\n` +
        `  AVS ${o.avsResult} | CVV ${o.cvvResult} | ip ${o.ip} | device ${o.deviceId}\n` +
        `  items: ${o.items.map((i) => `${i.sku} ${i.name} x${i.qty} @ ${usd(i.priceCents)}`).join("; ")}` +
        (o.note ? `\n  note: ${o.note}` : ""),
    );
  }

  if (bundle.shipment) {
    const s = bundle.shipment;
    parts.push(
      `\nSHIPMENT:\n  ${s.carrier} ${s.tracking} | shipped ${s.shippedAt} | ${s.status}` +
        ` | delivered ${s.deliveredAt ?? "not yet"} | signature ${s.signature ?? "none"}` +
        ` | delivery ZIP ${s.deliveryPostal ?? "n/a"} | matches order address: ${s.deliveryMatchesOrderAddress}` +
        (s.note ? `\n  note: ${s.note}` : ""),
    );
  }

  if (bundle.chat) {
    parts.push(
      `\nSUPPORT CHAT ${bundle.chat.chatId} (outcome: ${bundle.chat.outcome}):\n` +
        bundle.chat.transcript.map((m) => `  [${m.ts}] ${m.from}: ${m.text}`).join("\n") +
        (bundle.chat.note ? `\n  note: ${bundle.chat.note}` : ""),
    );
  }

  if (bundle.dispute) {
    const d = bundle.dispute;
    parts.push(
      `\nDISPUTE ${d.disputeId}:\n  ${d.network} ${d.reasonCode} ${d.reasonText} | ${usd(d.amountCents)} | filed ${d.filedAt} | respond by ${d.respondBy}\n` +
        `  cardholder says: "${d.cardholderStatement}"`,
    );
  }

  parts.push(
    "\nDETERMINISTIC CHECKS ALREADY RUN:\n" +
      checks.map((c) => `  [${c.outcome}] ${c.label}: ${c.detail}`).join("\n"),
  );

  return parts.join("\n");
}

export async function realJudgement(
  bundle: EvidenceBundle,
  checks: Check[],
): Promise<LlmJudgement> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: model(),
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [{ role: "user", content: renderBundle(bundle, checks) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Defensive parse: any malformed reply degrades to canned reasoning rather
  // than taking the whole run down.
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("no JSON object in reply");
    const parsed = JSON.parse(text.slice(start, end + 1));
    return {
      question: "What does the narrative evidence establish?",
      verdict: parsed.verdict ?? "inconclusive",
      rationale: String(parsed.rationale ?? "").trim(),
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
      weight: Math.max(-1, Math.min(1, Number(parsed.weight) || 0)),
      headline: String(parsed.headline ?? "").trim(),
      explanation: String(parsed.explanation ?? "").trim(),
      provenance: "real",
    };
  } catch {
    return mockJudgement(bundle, checks);
  }
}
