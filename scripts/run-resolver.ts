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
import type { ResolvedStatus } from "../lib/resolver/types";

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

for (const bundle of bundles) {
  const r = resolveMock(bundle);
  counts[r.status] += 1;

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
