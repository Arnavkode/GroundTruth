/**
 * FIT 2 — calibrate the model's self-reported weight against known ground truth.
 *
 * A language model's stated confidence is a claim about itself. This runs the
 * live Gemini path over synthetic transactions whose correct answer is known by
 * construction, records what the model said against what was true, and fits an
 * isotonic map from "what it said" to "the log-odds lift that statement actually
 * justifies". After this, the raw number never reaches the score directly.
 *
 * Runs entirely inside the free tier — genuinely $0, because the key has no
 * billing account behind it. The binding constraint is wall-clock: requests are
 * paced under the free RPM rather than bursting into 429s.
 *
 *   GEMINI_API_KEY=... npm run fit:calibrate
 *   CAL_N=200 CAL_RPM=10 npm run fit:calibrate
 */
import { writeFileSync } from "fs";
import { buildEvidenceBundles } from "../lib/fixtures";
import { runDeterministicChecks } from "../lib/resolver/checks";
import { generate, type Archetype } from "../lib/fitting/synthetic";
import {
  applyIsotonic,
  brier,
  calibrationBins,
  expectedCalibrationError,
  fitIsotonic,
  type IsotonicPoint,
} from "../lib/fitting/logistic";
import { geminiModel, realJudgement } from "../lib/resolver/llm";
import { hasRealApiKey, FREE_TIER } from "../lib/ratelimit";

const N = Number(process.env.CAL_N ?? 200);
const RPM = Number(process.env.CAL_RPM ?? 10);
const SEED = Number(process.env.CAL_SEED ?? 7);
const GAP_MS = Math.ceil(60_000 / RPM);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const logit = (p: number) => Math.log(Math.max(1e-6, p) / Math.max(1e-6, 1 - p));

console.log("=".repeat(96));
console.log("GROUNDTRUTH — FIT 2: CALIBRATING THE MODEL'S STATED CONFIDENCE");
console.log(`model ${geminiModel()} · ${N} live calls · paced at ${RPM} RPM (free tier allows ${FREE_TIER.rpm})`);
console.log(`estimated wall clock: ${((N * GAP_MS) / 60_000).toFixed(1)} minutes`);
console.log("SYNTHETIC DATA — ground truth known by construction, no real payments data anywhere.");
console.log("=".repeat(96));

if (!hasRealApiKey()) {
  console.error(
    "\nNo usable GEMINI_API_KEY in the environment.\n\n" +
      "This is the one step that needs a live key. It has deliberately NOT been faked:\n" +
      "lib/resolver/calibration.ts still exports CALIBRATION = null, the raw weight passes\n" +
      "through unchanged, and every surface that shows it says 'uncalibrated' rather than\n" +
      "implying a correction that never happened.\n\n" +
      "Get a free key at https://aistudio.google.com/apikey (no billing account required),\n" +
      "then: GEMINI_API_KEY=... npm run fit:calibrate\n",
  );
  process.exit(2);
}

interface Sample {
  archetype: Archetype;
  label: 0 | 1;
  raw: number;
  verdict: string;
}

async function main() {
  const examples = generate(N, SEED);
  const samples: Sample[] = [];
  let failures = 0;
  const started = Date.now();

  for (let i = 0; i < examples.length; i += 1) {
    const ex = examples[i];
    const bundle = buildEvidenceBundles(ex.dataset).find((b) => b.transactionRef === ex.target);
    if (!bundle) continue;
    const checks = runDeterministicChecks(bundle);

    try {
      const res = await realJudgement(bundle, checks);
      samples.push({
        archetype: ex.archetype,
        label: ex.label,
        raw: res.rawWeight,
        verdict: res.judgement.verdict,
      });
    } catch (err) {
      failures += 1;
      console.error(`  [${i + 1}/${N}] ${ex.archetype} FAILED: ${(err as Error).message}`);
      if (failures > 10) {
        console.error("\nToo many failures — stopping rather than burning quota. Nothing was written.");
        process.exit(1);
      }
    }

    if ((i + 1) % 20 === 0) {
      const elapsed = (Date.now() - started) / 1000;
      console.log(
        `  ${String(i + 1).padStart(4)}/${N}  ${samples.length} usable  ${elapsed.toFixed(0)}s elapsed`,
      );
    }
    if (i < examples.length - 1) await sleep(GAP_MS);
  }

  if (samples.length < 40) {
    console.error(`\nOnly ${samples.length} usable samples — too few to fit. Nothing was written.`);
    process.exit(1);
  }

  // ── What the model said, per archetype ────────────────────────────────────
  console.log("\n" + "-".repeat(96));
  console.log("WHAT THE MODEL SAID vs WHAT WAS TRUE");
  console.log("-".repeat(96));
  const byArch = new Map<Archetype, Sample[]>();
  for (const s of samples) byArch.set(s.archetype, [...(byArch.get(s.archetype) ?? []), s]);

  const byArchetype: { archetype: string; n: number; meanRaw: number; observed: number }[] = [];
  console.log(`  ${"archetype".padEnd(22)} ${"n".padStart(4)} ${"mean raw".padStart(9)} ${"observed".padStart(9)}  reading`);
  for (const [a, ss] of [...byArch.entries()].sort()) {
    const meanRaw = ss.reduce((t, s) => t + s.raw, 0) / ss.length;
    const observed = ss.reduce((t, s) => t + s.label, 0) / ss.length;
    byArchetype.push({ archetype: a, n: ss.length, meanRaw, observed });
    // Raw weight is on [-1,1]; put it on the same 0..1 footing to compare.
    const impliedP = (meanRaw + 1) / 2;
    const gap = impliedP - observed;
    const reading =
      Math.abs(gap) < 0.1
        ? "well calibrated"
        : gap > 0
          ? `OVER-confident by ${(gap * 100).toFixed(0)}pts`
          : `UNDER-confident by ${(-gap * 100).toFixed(0)}pts`;
    console.log(
      `  ${a.padEnd(22)} ${String(ss.length).padStart(4)} ${meanRaw.toFixed(3).padStart(9)} ${observed.toFixed(3).padStart(9)}  ${reading}`,
    );
  }

  // ── Fit: raw weight → the log-odds lift it actually justifies ─────────────
  const baseRate = samples.reduce((t, s) => t + s.label, 0) / samples.length;
  const xs = samples.map((s) => s.raw);
  const ys = samples.map((s) => s.label as number);
  const probPoints = fitIsotonic(xs, ys);

  // Convert observed frequency into a bounded log-odds adjustment relative to
  // the base rate — that is the quantity the resolver actually adds.
  const points: IsotonicPoint[] = probPoints.map((p) => ({
    x: Number(p.x.toFixed(4)),
    y: Number(Math.max(-1, Math.min(1, logit(p.y) - logit(baseRate))).toFixed(4)),
  }));

  const rawAsProb = samples.map((s) => Math.max(0, Math.min(1, (s.raw + 1) / 2)));
  const calAsProb = samples.map((s) => {
    const lift = applyIsotonic(points, s.raw);
    return 1 / (1 + Math.exp(-(logit(baseRate) + lift)));
  });

  const rawBins = calibrationBins(rawAsProb, ys);
  const calBins = calibrationBins(calAsProb, ys);
  const metrics = {
    rawBrier: brier(rawAsProb, ys),
    calibratedBrier: brier(calAsProb, ys),
    rawEce: expectedCalibrationError(rawBins, ys.length),
    calibratedEce: expectedCalibrationError(calBins, ys.length),
    rawAccuracy: rawAsProb.filter((p, i) => (p >= 0.5 ? 1 : 0) === ys[i]).length / ys.length,
    calibratedAccuracy: calAsProb.filter((p, i) => (p >= 0.5 ? 1 : 0) === ys[i]).length / ys.length,
  };

  console.log("\n" + "-".repeat(96));
  console.log("CALIBRATION EFFECT");
  console.log("-".repeat(96));
  console.log(`  base rate ${(baseRate * 100).toFixed(1)}% of sampled transactions need no human`);
  console.log(`  Brier      raw ${metrics.rawBrier.toFixed(4)}  →  calibrated ${metrics.calibratedBrier.toFixed(4)}`);
  console.log(`  ECE        raw ${metrics.rawEce.toFixed(4)}  →  calibrated ${metrics.calibratedEce.toFixed(4)}`);
  console.log(`  accuracy   raw ${(metrics.rawAccuracy * 100).toFixed(1)}%  →  calibrated ${(metrics.calibratedAccuracy * 100).toFixed(1)}%`);

  const worst = [...byArchetype].sort(
    (a, b) => Math.abs((b.meanRaw + 1) / 2 - b.observed) - Math.abs((a.meanRaw + 1) / 2 - a.observed),
  )[0];
  const worstGap = (worst.meanRaw + 1) / 2 - worst.observed;
  const summary =
    `Fitted against ${samples.length} live ${geminiModel()} calls on synthetic transactions with ground ` +
    `truth known by construction. ECE moved from ${metrics.rawEce.toFixed(3)} to ` +
    `${metrics.calibratedEce.toFixed(3)}. The largest single miscalibration was on ` +
    `"${worst.archetype}", where the model was ${worstGap > 0 ? "over" : "under"}-confident by ` +
    `${Math.abs(worstGap * 100).toFixed(0)} points.`;
  console.log(`\n  ${summary}`);

  const out = `/**
 * GENERATED FILE — do not edit by hand. Regenerate with \`npm run fit:calibrate\`.
 *
 * Fit 2: isotonic calibration of the model's self-reported weight, fitted
 * against ${samples.length} live ${geminiModel()} calls over synthetic transactions
 * with ground truth known by construction.
 *
 * SYNTHETIC DATA. This measures how well the model's stated confidence tracks
 * truth on this distribution. It is a real measurement of a real model, not a
 * claim that the correction transfers to a different distribution.
 *
 * Generated ${new Date().toISOString()}
 */

export interface IsotonicPoint {
  x: number;
  y: number;
}

export interface CalibrationModel {
  generatedAt: string;
  model: string;
  n: number;
  points: IsotonicPoint[];
  metrics: {
    rawBrier: number;
    calibratedBrier: number;
    rawEce: number;
    calibratedEce: number;
    rawAccuracy: number;
    calibratedAccuracy: number;
  };
  summary: string;
  byArchetype: { archetype: string; n: number; meanRaw: number; observed: number }[];
}

export const CALIBRATION: CalibrationModel | null = ${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      model: geminiModel(),
      n: samples.length,
      points,
      metrics: {
        rawBrier: Number(metrics.rawBrier.toFixed(4)),
        calibratedBrier: Number(metrics.calibratedBrier.toFixed(4)),
        rawEce: Number(metrics.rawEce.toFixed(4)),
        calibratedEce: Number(metrics.calibratedEce.toFixed(4)),
        rawAccuracy: Number(metrics.rawAccuracy.toFixed(4)),
        calibratedAccuracy: Number(metrics.calibratedAccuracy.toFixed(4)),
      },
      summary,
      byArchetype: byArchetype.map((b) => ({
        archetype: b.archetype,
        n: b.n,
        meanRaw: Number(b.meanRaw.toFixed(4)),
        observed: Number(b.observed.toFixed(4)),
      })),
    },
    null,
    2,
  )};

function applyIsotonic(points: IsotonicPoint[], x: number): number {
  if (points.length === 0) return x;
  if (x <= points[0].x) return points[0].y;
  if (x >= points[points.length - 1].x) return points[points.length - 1].y;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.x && x <= b.x) {
      if (b.x === a.x) return b.y;
      return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    }
  }
  return points[points.length - 1].y;
}

export interface CalibrationOutcome {
  raw: number;
  calibrated: number;
  fitted: boolean;
  note: string;
}

export function calibrateWeight(raw: number): CalibrationOutcome {
  const bounded = Math.max(-1, Math.min(1, raw));
  if (!CALIBRATION) {
    return {
      raw: bounded,
      calibrated: bounded,
      fitted: false,
      note: "Uncalibrated — no fit has been run against a live model yet.",
    };
  }
  const calibrated = Math.max(-1, Math.min(1, applyIsotonic(CALIBRATION.points, bounded)));
  const delta = calibrated - bounded;
  const direction =
    Math.abs(delta) < 0.02
      ? "left effectively unchanged"
      : delta < 0
        ? \`pulled down by \${Math.abs(delta).toFixed(2)} — the model was over-confident at this level\`
        : \`raised by \${delta.toFixed(2)} — the model was under-confident at this level\`;
  return {
    raw: bounded,
    calibrated,
    fitted: true,
    note: \`Stated \${bounded.toFixed(2)}, \${direction}, against \${CALIBRATION.n} outcomes with known ground truth.\`,
  };
}
`;

  writeFileSync("lib/resolver/calibration.ts", out, "utf8");
  console.log("\nWrote lib/resolver/calibration.ts");
  console.log("=".repeat(96));
}

main().catch((e) => {
  console.error("CALIBRATION RUN FAILED:", e);
  process.exit(1);
});
