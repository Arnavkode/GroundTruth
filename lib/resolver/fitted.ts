/**
 * GENERATED FILE — do not edit by hand. Regenerate with `npm run fit:weights`.
 *
 * Fit 1: logistic-regression coefficients for the deterministic checks, fitted
 * against 1500 synthetic examples whose ground truth is known by
 * construction (see lib/fitting/synthetic.ts).
 *
 * SYNTHETIC DATA. These weights are an honest maximum-likelihood fit to a stated
 * distribution, not evidence of generalisation to a real acquirer's book. What
 * they replace is a set of constants chosen by hand, which is the point.
 *
 * Generated 2026-08-12T10:09:31.079Z · seed 42
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

export const FIT1: FittedModel = {
  "generatedAt": "2026-08-12T10:09:31.079Z",
  "seed": 42,
  "n": 1500,
  "intercept": -1.7028,
  "weights": {
    "amount:agree": 1.5368,
    "amount:conflict": -1.2978,
    "amount:explained": 0.9451,
    "capture-vs-order:agree": 0.3918,
    "capture-vs-order:explained": 0.4436,
    "duplicate-capture:conflict": -1.7291,
    "fee-schedule:agree": 0.4378,
    "fee-schedule:conflict": -1.3315,
    "id-link:agree": 0.4837,
    "id-link:conflict": -0.7006,
    "id-link:explained": 0.7005,
    "id-link:missing": -0.4835,
    "refund-in-flight:explained": 0.3502,
    "source-coverage:agree": 0.4835,
    "source-coverage:missing": -0.4835,
    "timing:agree": 0.5743,
    "timing:explained": 0.6098
  },
  "metrics": {
    "trainAccuracy": 0.9173,
    "testAccuracy": 0.8987,
    "trainAuc": 1,
    "testAuc": 1,
    "testBrier": 0.0516,
    "testEce": 0.1744,
    "n": 1500,
    "nTrain": 1125,
    "nTest": 375,
    "positiveRate": 0.7433
  }
};

/** Fitted log-odds for a check outcome, or undefined if the fit never saw it. */
export function fittedWeight(checkId: string, outcome: string): number | undefined {
  const key = `${checkId.startsWith("fee-") ? "fee-schedule" : checkId}:${outcome}`;
  return FIT1.weights[key];
}
