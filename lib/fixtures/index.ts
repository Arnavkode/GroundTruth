import bankStatement from "./bank-statement.json";
import settlementReport from "./settlement-report.json";
import ordersFile from "./orders.json";
import shipmentsFile from "./shipments.json";
import chatsFile from "./support-chats.json";
import disputesFile from "./disputes.json";

import type {
  BankLine,
  ChatRecord,
  DisputeRecord,
  EvidenceBundle,
  OrderRecord,
  SettlementRecord,
  ShipmentRecord,
} from "../resolver/types";

export const bank = bankStatement as {
  account: string;
  bank: string;
  statementPeriod: { from: string; to: string };
  currency: string;
  lines: BankLine[];
};

export const settlement = settlementReport as unknown as {
  processor: string;
  exportedAt: string;
  feeSchedule: { percentBps: number; fixedCents: number; note: string };
  records: SettlementRecord[];
};

export const orders = (ordersFile as unknown as { orders: OrderRecord[] }).orders;
export const shipments = (shipmentsFile as unknown as { shipments: ShipmentRecord[] }).shipments;
export const chats = (chatsFile as unknown as { chats: ChatRecord[] }).chats;
export const disputes = (disputesFile as unknown as { disputes: DisputeRecord[] }).disputes;

export const FEE_BPS = settlement.feeSchedule.percentBps;
export const FEE_FIXED_CENTS = settlement.feeSchedule.fixedCents;

/** The processor's published fee for a captured payment. */
export function expectedFeeCents(grossCents: number): number {
  return Math.round((grossCents * FEE_BPS) / 10_000) + FEE_FIXED_CENTS;
}

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / DAY_MS;
}

/**
 * Assemble every reconciliation unit from the fixture sources.
 *
 * A unit is normally keyed by transactionRef. Bank lines attach by memo
 * reference first; anything left over is matched on amount within a posting
 * window. A bank line that two units can both claim is recorded as *contested*
 * on both rather than silently assigned to one — that contest is what makes
 * TXN-1007A/B honestly unresolvable.
 */
export function buildEvidenceBundles(): EvidenceBundle[] {
  const byRef = new Map<string, SettlementRecord[]>();
  for (const rec of settlement.records) {
    const list = byRef.get(rec.transactionRef) ?? [];
    list.push(rec);
    byRef.set(rec.transactionRef, list);
  }

  const claimedBankIds = new Set<string>();
  const bundles: EvidenceBundle[] = [];

  // Pass 1 — attach bank lines that carry an explicit reference.
  for (const [ref, settlements] of byRef) {
    const matched = bank.lines.filter((l) => l.memoRef === ref);
    matched.forEach((l) => claimedBankIds.add(l.id));

    const orderId = settlements[0].orderId;
    bundles.push({
      transactionRef: ref,
      settlements: settlements
        .slice()
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
      bankLines: matched.slice().sort((a, b) => a.postedAt.localeCompare(b.postedAt)),
      contestedBankLines: [],
      rivalRefs: [],
      order: orders.find((o) => o.orderId === orderId),
      shipment: shipments.find((s) => s.orderId === orderId),
      chat: chats.find((c) => c.orderId === orderId),
      dispute: disputes.find((d) => d.transactionRef === ref),
      bankOnly: false,
    });
  }

  // Pass 2 — amount-and-window matching for units the memo did not cover.
  const claimants = new Map<string, string[]>();
  for (const b of bundles) {
    if (b.bankLines.length > 0) continue;
    const expected = expectedNetCents(b.settlements);
    if (expected === null) continue;
    const lastActivity = b.settlements[b.settlements.length - 1].occurredAt;

    for (const line of bank.lines) {
      if (line.memoRef !== null || claimedBankIds.has(line.id)) continue;
      const signed = line.direction === "credit" ? line.amountCents : -line.amountCents;
      if (signed !== expected) continue;
      const lag = daysBetween(lastActivity, line.postedAt);
      if (lag < -0.5 || lag > 4) continue;
      claimants.set(line.id, [...(claimants.get(line.id) ?? []), b.transactionRef]);
    }
  }

  for (const [lineId, refs] of claimants) {
    const line = bank.lines.find((l) => l.id === lineId)!;
    if (refs.length === 1) {
      const b = bundles.find((x) => x.transactionRef === refs[0])!;
      b.bankLines.push(line);
      claimedBankIds.add(lineId);
    } else {
      // Contested: record on every claimant, assign to none.
      for (const ref of refs) {
        const b = bundles.find((x) => x.transactionRef === ref)!;
        b.contestedBankLines.push(line);
        b.rivalRefs.push(...refs.filter((r) => r !== ref));
      }
      claimedBankIds.add(lineId);
    }
  }

  // Pass 3 — bank lines with no internal counterpart at all.
  for (const line of bank.lines) {
    if (claimedBankIds.has(line.id)) continue;
    bundles.push({
      transactionRef: line.id,
      settlements: [],
      bankLines: [line],
      contestedBankLines: [],
      rivalRefs: [],
      bankOnly: true,
    });
  }

  return bundles.sort((a, b) => a.transactionRef.localeCompare(b.transactionRef));
}

/** Net movement the payout account should show, excluding unsettled items. */
export function expectedNetCents(settlements: SettlementRecord[]): number | null {
  const settled = settlements.filter((s) => s.status === "settled");
  if (settled.length === 0) return null;
  return settled.reduce((sum, s) => sum + s.netCents, 0);
}

export function observedNetCents(lines: BankLine[]): number | null {
  if (lines.length === 0) return null;
  return lines.reduce(
    (sum, l) => sum + (l.direction === "credit" ? l.amountCents : -l.amountCents),
    0,
  );
}

export function getBundle(transactionRef: string): EvidenceBundle | undefined {
  return buildEvidenceBundles().find((b) => b.transactionRef === transactionRef);
}

export function usd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const v = Math.abs(cents);
  return `${sign}$${(v / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
