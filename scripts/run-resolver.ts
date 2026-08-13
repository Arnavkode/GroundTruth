/**
 * Runs the Transaction Resolver across every fixture case and prints the full
 * resolved output for manual review. This is the script whose output is pasted
 * into BUILD_LOG.md.
 *
 *   npm run resolver            all cases
 *   npm run resolver TXN-1006   one case
 */
import { buildEvidenceBundles, usd } from "../lib/fixtures";
import { resolveMock } from "../lib/resolver/resolve";
import type { Resolution, ResolvedStatus } from "../lib/resolver/types";

const only = process.argv[2];
const bundles = buildEvidenceBundles().filter((b) => !only || b.transactionRef === only);

const BUCKET: Record<ResolvedStatus, string> = {
  matched: "MATCHED",
  "explained-difference": "EXPLAINED DIFFERENCE",
  flagged: "FLAGGED",
};

const counts: Record<ResolvedStatus, number> = {
  matched: 0,
  "explained-difference": 0,
  flagged: 0,
};

function wrap(text: string, width = 96, indent = "  "): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line.trim());
      line = w;
    } else {
      line += " " + w;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.map((l) => indent + l).join("\n");
}

console.log("=".repeat(100));
console.log("GROUNDTRUTH — TRANSACTION RESOLVER, FULL FIXTURE RUN (mock reasoning)");
console.log(`${bundles.length} reconciliation units\n`);

/** Kept so the run can be asserted against, not just read. */
const resolved: Resolution[] = [];

for (const bundle of bundles) {
  const r = resolveMock(bundle);
  counts[r.status] += 1;
  resolved.push(r);

  console.log("=".repeat(100));
  console.log(
    `${r.transactionRef}   ${BUCKET[r.status]}   confidence ${(r.confidence * 100).toFixed(0)}%   [reasoning: ${r.reasoningProvenance}]`,
  );
  console.log("-".repeat(100));
  console.log(`  ${r.headline}`);
  if (r.amounts.expectedNetCents !== null || r.amounts.observedNetCents !== null) {
    const e = r.amounts.expectedNetCents;
    const o = r.amounts.observedNetCents;
    const d = r.amounts.deltaCents;
    console.log(
      `  expected net ${e === null ? "n/a" : usd(e)}   observed ${o === null ? "n/a (no bank line assigned)" : usd(o)}` +
        `${d !== null ? `   delta ${usd(d)}` : ""}`,
    );
  }
  if (r.identifiabilityNote) {
    console.log("\n  ! " + r.identifiabilityNote);
  }

  console.log("\n  EXPLANATION");
  console.log(wrap(r.explanation, 94, "    "));

  console.log("\n  CHECKS");
  for (const c of r.checks) {
    const mark =
      c.outcome === "agree" ? "+" : c.outcome === "explained" ? "~" : c.outcome === "conflict" ? "!" : "?";
    console.log(
      `   ${mark} [${c.kind === "llm" ? "llm " : "det "}] ${c.label} (${c.outcome}, w=${c.weight >= 0 ? "+" : ""}${c.weight.toFixed(2)})`,
    );
    console.log(wrap(c.detail, 90, "        "));
  }

  console.log("\n  EVIDENCE CITED");
  for (const c of r.citations) {
    console.log(`   · [${c.source}] ${c.ref} — ${c.detail}`);
  }
  console.log();
}

console.log("=".repeat(100));
console.log("BUCKET SUMMARY");
console.log(`  matched ................ ${counts.matched}`);
console.log(`  explained difference ... ${counts["explained-difference"]}`);
console.log(`  flagged ................ ${counts.flagged}`);
console.log(`  total .................. ${bundles.length}`);
console.log("=".repeat(100));

/* ─────────────────────────── regression assertions ───────────────────────── */

/**
 * Until now this file printed 16 resolutions and asserted nothing, so
 * "16 hand-verified cases" meant 16 outputs a human read once. These pin the
 * verdict for every bundled unit: the status, and the confidence to the nearest
 * whole percent.
 *
 * Confidence is pinned deliberately, not just the bucket. Both fits feed it, so
 * an accidental change to a weight, the intercept, a cap or the calibration map
 * moves a number here and fails loudly — which is exactly what happened when
 * Fit 1 landed and TXN-1006 went from 92% to 37%. That change was correct and
 * intended; the point is that it should never be able to happen silently.
 *
 * When a fit legitimately changes these numbers, update the table in the same
 * commit as the fit, and say why in DECISIONS.md.
 */
const EXPECTED: [string, ResolvedStatus, number][] = [
  ["BNK-009", "flagged", 5],
  ["TXN-1001", "matched", 92],
  ["TXN-1002", "explained-difference", 92],
  ["TXN-1003", "explained-difference", 92],
  ["TXN-1004", "explained-difference", 85],
  ["TXN-1005", "explained-difference", 96],
  ["TXN-1006", "flagged", 37],
  ["TXN-1007A", "flagged", 17],
  ["TXN-1007B", "flagged", 17],
  ["TXN-1009", "matched", 94],
  ["TXN-1010", "matched", 86],
  ["TXN-1011", "matched", 85],
  ["TXN-1012", "flagged", 26],
  ["TXN-1013", "explained-difference", 95],
  ["TXN-1014", "matched", 91],
  ["TXN-1015", "matched", 84],
];

if (!only) {
  console.log("REGRESSION ASSERTIONS — every bundled unit, status and confidence");
  console.log("=".repeat(100));
  let failures = 0;
  const check = (label: string, cond: boolean, detail = "") => {
    if (!cond) failures += 1;
    console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  };

  check(`all ${EXPECTED.length} units resolved`, resolved.length === EXPECTED.length, `got ${resolved.length}`);

  for (const [ref, status, confPct] of EXPECTED) {
    const r = resolved.find((x) => x.transactionRef === ref);
    if (!r) {
      check(`${ref} present`, false, "missing from the run");
      continue;
    }
    const got = Math.round(r.confidence * 100);
    const ok = r.status === status && got === confPct;
    check(
      `${ref.padEnd(9)} ${status.padEnd(20)} ${String(confPct).padStart(3)}%`,
      ok,
      ok ? "" : r.status === status ? `confidence is ${got}%, expected ${confPct}%` : `status is ${r.status}, expected ${status}`,
    );
  }

  // The buckets are the headline claim in the README, so pin them too.
  check("6 matched / 5 explained / 5 flagged", counts.matched === 6 && counts["explained-difference"] === 5 && counts.flagged === 5,
    `${counts.matched}/${counts["explained-difference"]}/${counts.flagged}`);

  // Every flagged unit must be flagged *because* something is unresolved, not
  // because the score drifted under the threshold with all checks agreeing.
  for (const r of resolved.filter((x) => x.status === "flagged")) {
    const unresolved = r.checks.some((c) => c.outcome === "conflict" || c.outcome === "missing");
    check(`${r.transactionRef} is flagged for a reason, not just a low score`, unresolved);
  }

  // The ambiguous pair must never be silently resolved to one claimant.
  const a = resolved.find((x) => x.transactionRef === "TXN-1007A");
  const b = resolved.find((x) => x.transactionRef === "TXN-1007B");
  check("the two identical claimants score identically", a!.confidence === b!.confidence,
    `${a!.confidence} vs ${b!.confidence}`);
  check("neither identical claimant is resolved", a!.status === "flagged" && b!.status === "flagged");

  console.log("=".repeat(100));
  console.log(failures === 0 ? "ALL RESOLVER ASSERTIONS PASSED" : `${failures} ASSERTION(S) FAILED`);
  console.log("=".repeat(100));
  if (failures > 0) process.exit(1);
}
