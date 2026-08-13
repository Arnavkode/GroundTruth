import { buildEvidenceBundles, FIXTURE_DATASET, getBundle, usd } from "./fixtures";
import { LIMITS } from "./ingest";
import { runDeterministicChecks } from "./resolver/checks";
import { QuotaExhaustedError, realJudgement } from "./resolver/llm";
import { mockJudgement } from "./resolver/mock-reasoning";
import { buildRebuttal } from "./resolver/rebuttal";
import { assembleResolution } from "./resolver/resolve";
import type { EvidenceBundle, EvidenceDataset, Resolution } from "./resolver/types";
import {
  checkRateLimit,
  clientIp,
  markQuotaExhausted,
  recordUsage,
  type Decision,
  perRunLimit,
} from "./ratelimit";
import { disputes } from "./fixtures";

/** Mock steps are paced like real ones so the demo feels identical either way. */
/**
 * Batch runs pace fast enough to feel responsive; a single Investigate case
 * keeps the slower cadence, because there the trace is the thing you read.
 */
const PACE_BATCH = { source: 14, check: 22, reason: 90, unit: 10 };
const PACE_SINGLE = { source: 70, check: 100, reason: 320, unit: 40 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type StreamEvent =
  | {
      type: "meta";
      mode: "real" | "mock";
      message: string;
      total: number;
      origin: "fixtures" | "upload";
      datasetLabel: string;
      budget: BudgetSnapshot;
    }
  | { type: "limit"; budget: BudgetSnapshot }
  | { type: "unit-start"; ref: string; index: number; total: number; label: string }
  | { type: "source"; ref: string; source: string; detail: string; found: boolean }
  | { type: "check"; ref: string; label: string; outcome: string; detail: string; kind: string }
  | { type: "reasoning"; ref: string; question: string }
  | { type: "resolution"; resolution: Resolution }
  | { type: "summary"; matched: number; explained: number; flagged: number; total: number }
  | { type: "rebuttal"; rebuttal: ReturnType<typeof buildRebuttal>; factors: ReturnType<typeof buildRebuttal>["factors"] }
  | { type: "error"; message: string }
  | { type: "done" };

/** Everything the UI needs to explain the current spend state, in one object. */
export interface BudgetSnapshot {
  mode: "real" | "mock";
  reason: Decision["reason"];
  message: string;
  ipRemaining: number;
  dailyRemaining: number;
  callsUsedToday: number;
  tokensUsedToday: number;
  store: "redis" | "memory";
  resetAt: number | null;
  limits: Decision["limits"];
  /** Live calls this run has made, and the ceiling for one run. */
  runUsed: number;
  runMax: number;
}

function snapshot(d: Decision, runUsed: number, runMax: number): BudgetSnapshot {
  return {
    mode: d.mode,
    reason: d.reason,
    message: d.message,
    ipRemaining: d.ipRemaining,
    dailyRemaining: d.dailyRemaining,
    callsUsedToday: d.callsUsedToday,
    tokensUsedToday: d.tokensUsedToday,
    store: d.store,
    resetAt: d.resetAt,
    limits: d.limits,
    runUsed,
    runMax,
  };
}

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
  PACE: typeof PACE_BATCH,
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

interface RunBudget {
  ip: string;
  callsUsed: number;
  maxCalls: number;
  /** The decision the UI was told about, refreshed as the run proceeds. */
  latest: Decision;
}

async function resolveOne(
  b: EvidenceBundle,
  budget: RunBudget,
  send: (e: StreamEvent) => void,
  paced: boolean,
  PACE: typeof PACE_BATCH,
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

  // Re-check per step, not per run: the spend cap, the global daily cap and
  // the per-upload cap can all trip midway through a batch, and when they do
  // the remaining units must fall back rather than keep spending.
  const decision = await checkRateLimit(budget.ip, {
    callsThisRun: budget.callsUsed,
    maxCallsPerRun: budget.maxCalls,
  });
  // A cap can trip midway through a batch. When the answer changes, say so —
  // silently degrading the rest of a run is exactly the behaviour that makes a
  // rate limit feel like a bug.
  if (decision.reason !== budget.latest.reason || decision.mode !== budget.latest.mode) {
    send({ type: "limit", budget: snapshot(decision, budget.callsUsed, budget.maxCalls) });
  }
  budget.latest = decision;

  let judgement;
  let rawWeight: number | undefined;
  if (decision.mode === "real") {
    budget.callsUsed += 1;
    try {
      const result = await realJudgement(b, checks);
      judgement = result.judgement;
      rawWeight = result.rawWeight;
      await recordUsage(result.usage.inputTokens, result.usage.outputTokens);
    } catch (err) {
      // Never let a live-API failure break the run. A quota 429 additionally
      // latches for the day so the rest of the batch stops trying.
      if (err instanceof QuotaExhaustedError) {
        await markQuotaExhausted(err.message);
        send({
          type: "limit",
          budget: snapshot(
            await checkRateLimit(budget.ip, {
              callsThisRun: budget.callsUsed,
              maxCallsPerRun: budget.maxCalls,
            }),
            budget.callsUsed,
            budget.maxCalls,
          ),
        });
      }
      judgement = mockJudgement(b, checks);
    }
  } else {
    if (paced) await sleep(PACE.reason);
    judgement = mockJudgement(b, checks);
  }

  const resolution = assembleResolution(b, judgement, rawWeight);
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
export function reconcileStream(
  request: Request,
  dataset: EvidenceDataset = FIXTURE_DATASET,
): ReadableStream<Uint8Array> {
  const paced = new URL(request.url).searchParams.get("paced") !== "0";
  const ip = clientIp(request.headers);
  const bundles = buildEvidenceBundles(dataset);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        const opening = await checkRateLimit(ip, {
          callsThisRun: 0,
          maxCallsPerRun: perRunLimit(),
        });
        const budget: RunBudget = {
          ip,
          callsUsed: 0,
          maxCalls: perRunLimit(),
          latest: opening,
        };
        send({
          type: "meta",
          mode: opening.mode,
          message: opening.message,
          total: bundles.length,
          origin: dataset.origin,
          datasetLabel: dataset.label,
          budget: snapshot(opening, 0, budget.maxCalls),
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
          if (paced) await sleep(PACE_BATCH.unit);
          await emitSources(send, b, paced, PACE_BATCH);
          const r = await resolveOne(b, budget, send, paced, PACE_BATCH);
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
export function investigateStream(
  request: Request,
  disputeId: string,
  dataset: EvidenceDataset = FIXTURE_DATASET,
): ReadableStream<Uint8Array> {
  const paced = new URL(request.url).searchParams.get("paced") !== "0";
  const ip = clientIp(request.headers);
  const dispute = dataset.disputes.find((d) => d.disputeId === disputeId);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encode(e));
      try {
        if (!dispute) {
          send({ type: "error", message: `Unknown dispute ${disputeId}` });
          send({ type: "done" });
          return;
        }
        const b = getBundle(dispute.transactionRef, dataset);
        if (!b) {
          send({ type: "error", message: `No evidence bundle for ${dispute.transactionRef}` });
          send({ type: "done" });
          return;
        }

        const opening = await checkRateLimit(ip, {
          callsThisRun: 0,
          maxCallsPerRun: perRunLimit(),
        });
        const budget: RunBudget = {
          ip,
          callsUsed: 0,
          maxCalls: perRunLimit(),
          latest: opening,
        };
        send({
          type: "meta",
          mode: opening.mode,
          message: opening.message,
          total: 1,
          origin: dataset.origin,
          datasetLabel: dataset.label,
          budget: snapshot(opening, 0, budget.maxCalls),
        });
        send({
          type: "unit-start",
          ref: b.transactionRef,
          index: 0,
          total: 1,
          label: `${dispute.reasonCode} ${dispute.reasonText} — ${usd(dispute.amountCents)}`,
        });

        await emitSources(send, b, paced, PACE_SINGLE);
        const resolution = await resolveOne(b, budget, send, paced, PACE_SINGLE);

        if (paced) await sleep(PACE_SINGLE.reason);
        const rebuttal = buildRebuttal(dispute, resolution, b);
        send({ type: "rebuttal", rebuttal, factors: rebuttal.factors });
        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : "unknown error" });
      } finally {
        controller.close();
      }
    },
  });
}
