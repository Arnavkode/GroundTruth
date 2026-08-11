import { buildEvidenceBundles, getBundle, usd } from "./fixtures";
import { runDeterministicChecks } from "./resolver/checks";
import { realJudgement } from "./resolver/llm";
import { mockJudgement } from "./resolver/mock-reasoning";
import { buildRebuttal, rebuttalFactors } from "./resolver/rebuttal";
import { assembleResolution } from "./resolver/resolve";
import type { EvidenceBundle, Resolution } from "./resolver/types";
import { checkRateLimit, clientIp, type Decision } from "./ratelimit";
import { disputes } from "./fixtures";

/** Mock steps are paced like real ones so the demo feels identical either way. */
const PACE = { source: 90, check: 130, reason: 420, unit: 60 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type StreamEvent =
  | { type: "meta"; mode: "real" | "mock"; message: string; ipRemaining: number; dailyRemaining: number; total: number }
  | { type: "unit-start"; ref: string; index: number; total: number; label: string }
  | { type: "source"; ref: string; source: string; detail: string; found: boolean }
  | { type: "check"; ref: string; label: string; outcome: string; detail: string; kind: string }
  | { type: "reasoning"; ref: string; question: string }
  | { type: "resolution"; resolution: Resolution }
  | { type: "summary"; matched: number; explained: number; flagged: number; total: number }
  | { type: "rebuttal"; rebuttal: ReturnType<typeof buildRebuttal>; factors: ReturnType<typeof rebuttalFactors> }
  | { type: "error"; message: string }
  | { type: "done" };

function encode(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function unitLabel(b: EvidenceBundle): string {
  if (b.bankOnly) return `Bank line ${b.bankLines[0].id} — no internal record`;
  if (b.order) return `${b.order.customerName} — ${usd(b.order.totalCents)}`;
  return b.transactionRef;
}

/** Emit the source-by-source trace for one bundle. */
async function emitSources(
  send: (e: StreamEvent) => void,
  b: EvidenceBundle,
  paced: boolean,
) {
  const rows: [string, boolean, string][] = [
    [
      "settlement",
      b.settlements.length > 0,
      b.settlements.length ? `${b.settlements.length} record(s) loaded` : "no internal record",
    ],
    [
      "bank",
      b.bankLines.length > 0 || b.contestedBankLines.length > 0,
      b.contestedBankLines.length
        ? `${b.contestedBankLines[0].id} matches, but so does another transaction`
        : b.bankLines.length
          ? `${b.bankLines.length} line(s) linked`
          : "no bank line found",
    ],
    ["order", Boolean(b.order), b.order ? `${b.order.orderId} — ${b.order.customerName}` : "no order record"],
    [
      "shipment",
      Boolean(b.shipment),
      b.shipment ? `${b.shipment.carrier} ${b.shipment.status}` : "no shipment record",
    ],
    [
      "chat",
      Boolean(b.chat),
      b.chat ? `${b.chat.chatId} — ${b.chat.transcript.length} messages` : "no support contact",
    ],
  ];
  for (const [source, found, detail] of rows) {
    send({ type: "source", ref: b.transactionRef, source, detail, found });
    if (paced) await sleep(PACE.source);
  }
}

async function resolveOne(
  b: EvidenceBundle,
  decision: Decision,
  send: (e: StreamEvent) => void,
  paced: boolean,
): Promise<Resolution> {
  const checks = runDeterministicChecks(b);
  for (const c of checks) {
    send({
      type: "check",
      ref: b.transactionRef,
      label: c.label,
      outcome: c.outcome,
      detail: c.detail,
      kind: c.kind,
    });
    if (paced) await sleep(PACE.check);
  }

  send({
    type: "reasoning",
    ref: b.transactionRef,
    question: "Reading the unstructured evidence…",
  });

  let judgement;
  if (decision.mode === "real") {
    try {
      judgement = await realJudgement(b, checks);
    } catch {
      // Never let a live-API failure break the run.
      judgement = mockJudgement(b, checks);
    }
  } else {
    if (paced) await sleep(PACE.reason);
    judgement = mockJudgement(b, checks);
  }

  const resolution = assembleResolution(b, judgement);
  send({ type: "resolution", resolution });
  return resolution;
}

export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

/** Reconcile mode: every unit in the fixture set, three buckets. */
export function reconcileStream(request: Request): ReadableStream<Uint8Array> {
  const paced = new URL(request.url).searchParams.get("paced") !== "0";
  const decision = checkRateLimit(clientIp(request.headers));
  const bundles = buildEvidenceBundles();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        send({
          type: "meta",
          mode: decision.mode,
          message: decision.message,
          ipRemaining: decision.ipRemaining,
          dailyRemaining: decision.dailyRemaining,
          total: bundles.length,
        });

        const counts = { matched: 0, explained: 0, flagged: 0 };
        for (let i = 0; i < bundles.length; i += 1) {
          const b = bundles[i];
          send({
            type: "unit-start",
            ref: b.transactionRef,
            index: i,
            total: bundles.length,
            label: unitLabel(b),
          });
          if (paced) await sleep(PACE.unit);
          await emitSources(send, b, paced);
          const r = await resolveOne(b, decision, send, paced);
          if (r.status === "matched") counts.matched += 1;
          else if (r.status === "explained-difference") counts.explained += 1;
          else counts.flagged += 1;
        }

        send({ type: "summary", ...counts, total: bundles.length });
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "unknown error" });
      } finally {
        controller.close();
      }
    },
  });
}

/** Investigate mode: one disputed transaction, then the rebuttal agent. */
export function investigateStream(request: Request, disputeId: string): ReadableStream<Uint8Array> {
  const paced = new URL(request.url).searchParams.get("paced") !== "0";
  const decision = checkRateLimit(clientIp(request.headers));
  const dispute = disputes.find((d) => d.disputeId === disputeId);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        if (!dispute) {
          send({ type: "error", message: `Unknown dispute ${disputeId}` });
          send({ type: "done" });
          return;
        }
        const b = getBundle(dispute.transactionRef);
        if (!b) {
          send({ type: "error", message: `No evidence bundle for ${dispute.transactionRef}` });
          send({ type: "done" });
          return;
        }

        send({
          type: "meta",
          mode: decision.mode,
          message: decision.message,
          ipRemaining: decision.ipRemaining,
          dailyRemaining: decision.dailyRemaining,
          total: 1,
        });
        send({
          type: "unit-start",
          ref: b.transactionRef,
          index: 0,
          total: 1,
          label: `${dispute.reasonCode} ${dispute.reasonText} — ${usd(dispute.amountCents)}`,
        });

        await emitSources(send, b, paced);
        const resolution = await resolveOne(b, decision, send, paced);

        if (paced) await sleep(PACE.reason);
        send({
          type: "rebuttal",
          rebuttal: buildRebuttal(dispute, resolution),
          factors: rebuttalFactors(dispute.disputeId),
        });
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "unknown error" });
      } finally {
        controller.close();
      }
    },
  });
}
