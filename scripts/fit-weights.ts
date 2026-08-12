/**
 * FIT 1 — deterministic check weights.
 *
 * Replaces the hand-picked log-odds constants in checks.ts with a logistic
 * regression fitted against synthetic data whose ground truth is known by
 * construction. Features are produced by running the *real* check code over
 * generated datasets, so the coefficients apply to exactly the signals the app
 * computes at runtime.
 *
 * Costs nothing and calls nothing — no API key involved.
 *
 *   npm run fit:weights
 */
import { writeFileSync } from "fs";
import { buildEvidenceBundles } from "../lib/fixtures";
import { runDeterministicChecks } from "../lib/resolver/checks";
import { generate, ARCHETYPE_LABEL, type Archetype } from "../lib/fitting/synthetic";
import {
  accuracy,
  auc,
  brier,
  calibrationBins,
  expectedCalibrationError,
  fitLogistic,
  predict,
} from "../lib/fitting/logistic";

const N = Number(process.env.FIT_N ?? 1500);
const SEED = Number(process.env.FIT_SEED ?? 42);
const OUTCOMES = ["agree", "explained", "conflict", "missing"] as const;

/** Fee checks carry a per-settlement id at runtime; collapse to one feature. */
function featureKey(checkId: string): string {
  return checkId.startsWith("fee-") ? "fee-schedule" : checkId;
}

function bar(v: number, width = 26): string {
  const n = Math.max(0, Math.min(width, Math.round(Math.abs(v) * 6)));
  return (v < 0 ? "-" : "+").padEnd(1) + "█".repeat(n);
}

console.log("=".repeat(96));
console.log("GROUNDTRUTH — FIT 1: DETERMINISTIC CHECK WEIGHTS");
console.log(`${N} synthetic examples, seed ${SEED}. Ground truth known by construction.`);
console.log("SYNTHETIC DATA — no real or proprietary payments data is used anywhere in this project.");
console.log("=".repeat(96));

// ── 1. Generate, and derive features from the real check code ───────────────
const examples = generate(N, SEED);
const rows: { features: Set<string>; label: 0 | 1; archetype: Archetype }[] = [];

for (const ex of examples) {
  const bundle = buildEvidenceBundles(ex.dataset).find((b) => b.transactionRef === ex.target);
  if (!bundle) continue;
  const checks = runDeterministicChecks(bundle);
  const features = new Set(checks.map((c) => `${featureKey(c.id)}:${c.outcome}`));
  rows.push({ features, label: ex.label, archetype: ex.archetype });
}

const featureNames = [...new Set(rows.flatMap((r) => [...r.features]))].sort();
console.log(`\n${rows.length} usable examples, ${featureNames.length} distinct check/outcome features.`);

const counts = new Map<Archetype, number>();
for (const r of rows) counts.set(r.archetype, (counts.get(r.archetype) ?? 0) + 1);
console.log("\nArchetype mix (label 1 = needs no human):");
for (const [a, c] of [...counts.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${a.padEnd(22)} ${String(c).padStart(4)}  label=${ARCHETYPE_LABEL[a]}`);
}

const X = rows.map((r) => featureNames.map((f) => (r.features.has(f) ? 1 : 0)));
const y = rows.map((r) => r.label);

// ── 2. Split, fit, evaluate on held-out data ────────────────────────────────
const cut = Math.floor(rows.length * 0.75);
const Xtr = X.slice(0, cut);
const ytr = y.slice(0, cut);
const Xte = X.slice(cut);
const yte = y.slice(cut);
console.log(`\nTrain ${Xtr.length} · held-out test ${Xte.length}`);

const fit = fitLogistic(Xtr, ytr, featureNames, { lr: 0.4, l2: 0.015, iterations: 6000 });

const trainProbs = Xtr.map((x) => predict(fit, x));
const testProbs = Xte.map((x) => predict(fit, x));

const metrics = {
  trainAccuracy: accuracy(trainProbs, ytr),
  testAccuracy: accuracy(testProbs, yte),
  trainAuc: auc(trainProbs, ytr),
  testAuc: auc(testProbs, yte),
  testBrier: brier(testProbs, yte),
  testEce: 0,
  n: rows.length,
  nTrain: Xtr.length,
  nTest: Xte.length,
  positiveRate: (y as number[]).reduce((s, v) => s + v, 0) / y.length,
  finalLoss: fit.finalLoss,
};
const bins = calibrationBins(testProbs, yte);
metrics.testEce = expectedCalibrationError(bins, yte.length);

console.log("\n" + "-".repeat(96));
console.log("FITTED WEIGHTS (log-odds toward 'this needs no human')");
console.log("-".repeat(96));
console.log(`  ${"intercept".padEnd(34)} ${fit.intercept.toFixed(3).padStart(7)}  ${bar(fit.intercept)}`);
featureNames
  .map((f, i) => ({ f, w: fit.weights[i] }))
  .sort((a, b) => b.w - a.w)
  .forEach(({ f, w }) => {
    console.log(`  ${f.padEnd(34)} ${w.toFixed(3).padStart(7)}  ${bar(w)}`);
  });

console.log("\n" + "-".repeat(96));
console.log("VALIDATION (held-out 25%)");
console.log("-".repeat(96));
console.log(`  accuracy      train ${(metrics.trainAccuracy * 100).toFixed(1)}%   test ${(metrics.testAccuracy * 100).toFixed(1)}%`);
console.log(`  AUC           train ${metrics.trainAuc.toFixed(4)}    test ${metrics.testAuc.toFixed(4)}`);
console.log(`  Brier (test)  ${metrics.testBrier.toFixed(4)}   (lower is better; 0.25 = always guessing the base rate)`);
console.log(`  ECE  (test)   ${metrics.testEce.toFixed(4)}   mean gap between stated confidence and observed frequency`);
console.log(`  base rate     ${(metrics.positiveRate * 100).toFixed(1)}% of examples need no human`);

console.log("\n  Reliability — does a stated confidence mean what it says?");
console.log(`  ${"bucket".padEnd(14)} ${"n".padStart(5)}  ${"predicted".padStart(10)}  ${"observed".padStart(9)}`);
for (const b of bins) {
  console.log(
    `  ${`${(b.from * 100).toFixed(0)}-${(b.to * 100).toFixed(0)}%`.padEnd(14)} ${String(b.count).padStart(5)}  ${(b.meanPredicted * 100).toFixed(1).padStart(9)}%  ${(b.observed * 100).toFixed(1).padStart(8)}%`,
  );
}

// ── 3. Per-archetype behaviour, which is where a fit is actually judged ─────
console.log("\n  Mean fitted confidence by archetype:");
const byArch = new Map<Archetype, number[]>();
rows.forEach((r, i) => {
  const p = predict(fit, X[i]);
  byArch.set(r.archetype, [...(byArch.get(r.archetype) ?? []), p]);
});
[...byArch.entries()]
  .sort((a, b) => b[1].reduce((s, v) => s + v, 0) / b[1].length - a[1].reduce((s, v) => s + v, 0) / a[1].length)
  .forEach(([a, ps]) => {
    const mean = ps.reduce((s, v) => s + v, 0) / ps.length;
    console.log(
      `    ${a.padEnd(22)} ${(mean * 100).toFixed(1).padStart(5)}%  (label ${ARCHETYPE_LABEL[a]}, n=${ps.length})`,
    );
  });

// ── 4. Emit the generated module ────────────────────────────────────────────
const weights: Record<string, number> = {};
featureNames.forEach((f, i) => {
  weights[f] = Number(fit.weights[i].toFixed(4));
});

const out = `/**
 * GENERATED FILE — do not edit by hand. Regenerate with \`npm run fit:weights\`.
 *
 * Fit 1: logistic-regression coefficients for the deterministic checks, fitted
 * against ${metrics.n} synthetic examples whose ground truth is known by
 * construction (see lib/fitting/synthetic.ts).
 *
 * SYNTHETIC DATA. These weights are an honest maximum-likelihood fit to a stated
 * distribution, not evidence of generalisation to a real acquirer's book. What
 * they replace is a set of constants chosen by hand, which is the point.
 *
 * Generated ${new Date().toISOString()} · seed ${SEED}
 */

export interface FittedModel {
  generatedAt: string;
  seed: number;
  n: number;
  intercept: number;
  weights: Record<string, number>;
  metrics: {
    trainAccuracy: number;
    testAccuracy: number;
    trainAuc: number;
    testAuc: number;
    testBrier: number;
    testEce: number;
    n: number;
    nTrain: number;
    nTest: number;
    positiveRate: number;
  };
}

export const FIT1: FittedModel = ${JSON.stringify(
  {
    generatedAt: new Date().toISOString(),
    seed: SEED,
    n: metrics.n,
    intercept: Number(fit.intercept.toFixed(4)),
    weights,
    metrics: {
      trainAccuracy: Number(metrics.trainAccuracy.toFixed(4)),
      testAccuracy: Number(metrics.testAccuracy.toFixed(4)),
      trainAuc: Number(metrics.trainAuc.toFixed(4)),
      testAuc: Number(metrics.testAuc.toFixed(4)),
      testBrier: Number(metrics.testBrier.toFixed(4)),
      testEce: Number(metrics.testEce.toFixed(4)),
      n: metrics.n,
      nTrain: metrics.nTrain,
      nTest: metrics.nTest,
      positiveRate: Number(metrics.positiveRate.toFixed(4)),
    },
  },
  null,
  2,
)};

/** Fitted log-odds for a check outcome, or undefined if the fit never saw it. */
export function fittedWeight(checkId: string, outcome: string): number | undefined {
  const key = \`\${checkId.startsWith("fee-") ? "fee-schedule" : checkId}:\${outcome}\`;
  return FIT1.weights[key];
}
`;

writeFileSync("lib/resolver/fitted.ts", out, "utf8");
console.log("\nWrote lib/resolver/fitted.ts");
console.log("=".repeat(96));
