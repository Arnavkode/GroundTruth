/**
 * GENERATED FILE — do not edit by hand. Regenerate with `npm run fit:calibrate`.
 *
 * Fit 2: isotonic calibration of the model's self-reported weight, fitted
 * against 200 live gemini-3.5-flash-lite calls over synthetic transactions
 * with ground truth known by construction.
 *
 * SYNTHETIC DATA. This measures how well the model's stated confidence tracks
 * truth on this distribution. It is a real measurement of a real model, not a
 * claim that the correction transfers to a different distribution.
 *
 * Generated 2026-08-12T22:49:46.155Z
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
    /** The same isotonic map with the ±1 log-odds safety clamp removed. Not shipped — measured so the clamp's cost is visible. */
    unclampedBrier: number;
    unclampedEce: number;
  };
  summary: string;
  byArchetype: { archetype: string; n: number; meanRaw: number; observed: number }[];
}

export const CALIBRATION: CalibrationModel | null = {
  "generatedAt": "2026-08-12T22:49:46.157Z",
  "model": "gemini-3.5-flash-lite",
  "n": 200,
  "points": [
    {
      "x": -1,
      "y": -1
    },
    {
      "x": -0.9,
      "y": -1
    },
    {
      "x": -0.85,
      "y": -1
    },
    {
      "x": -0.8,
      "y": -1
    },
    {
      "x": -0.5,
      "y": -1
    },
    {
      "x": -0.4,
      "y": -1
    },
    {
      "x": -0.2,
      "y": -1
    },
    {
      "x": 0,
      "y": -1
    },
    {
      "x": 0.4,
      "y": -1
    },
    {
      "x": 0.5,
      "y": -1
    },
    {
      "x": 0.6,
      "y": -1
    },
    {
      "x": 0.8,
      "y": 1
    },
    {
      "x": 0.85,
      "y": 1
    },
    {
      "x": 0.9,
      "y": 1
    },
    {
      "x": 0.95,
      "y": 1
    },
    {
      "x": 1,
      "y": 1
    }
  ],
  "metrics": {
    "rawBrier": 0.0438,
    "calibratedBrier": 0.1001,
    "rawEce": 0.132,
    "calibratedEce": 0.2679,
    "rawAccuracy": 0.86,
    "calibratedAccuracy": 1,
    "unclampedBrier": 0,
    "unclampedEce": 0
  },
  "summary": "Fitted against 200 live gemini-3.5-flash-lite calls on synthetic transactions with ground truth known by construction, measured on 50 held-out calls the map never saw. Correcting the model's stated weight moves accuracy from 86.0% to 100.0%. The largest single miscalibration was on \"fee-mismatch\", where the model was over-confident by 62 points. Stand-alone ECE looks worse after correction (0.132 → 0.268) purely because the shipped lift is clamped to ±1 log-odds, confining it to [0.47, 0.87]; with the clamp removed the same map scores 0.000. The clamp is kept deliberately — it is what stops the model outvoting deterministic evidence. Worth stating plainly: every step of the fitted map saturates that clamp, so what ships is effectively a sign function on the model's stated weight rather than a graded curve.",
  "byArchetype": [
    {
      "archetype": "bank-only-orphan",
      "n": 8,
      "meanRaw": -0.0625,
      "observed": 0
    },
    {
      "archetype": "clean-match",
      "n": 38,
      "meanRaw": 0.9342,
      "observed": 1
    },
    {
      "archetype": "clean-refund",
      "n": 15,
      "meanRaw": 0.8,
      "observed": 1
    },
    {
      "archetype": "contested-identity",
      "n": 10,
      "meanRaw": 0,
      "observed": 0
    },
    {
      "archetype": "duplicate-capture",
      "n": 13,
      "meanRaw": -0.9923,
      "observed": 0
    },
    {
      "archetype": "fee-mismatch",
      "n": 5,
      "meanRaw": 0.24,
      "observed": 0
    },
    {
      "archetype": "fee-only-no-ref",
      "n": 27,
      "meanRaw": 0.8,
      "observed": 1
    },
    {
      "archetype": "fx-rounding",
      "n": 16,
      "meanRaw": 0.8063,
      "observed": 1
    },
    {
      "archetype": "missing-bank-line",
      "n": 7,
      "meanRaw": 0,
      "observed": 0
    },
    {
      "archetype": "partial-capture",
      "n": 7,
      "meanRaw": 0.8714,
      "observed": 1
    },
    {
      "archetype": "refund-in-flight",
      "n": 19,
      "meanRaw": 0.8447,
      "observed": 1
    },
    {
      "archetype": "unexplained-shortfall",
      "n": 15,
      "meanRaw": -0.8233,
      "observed": 0
    },
    {
      "archetype": "weekend-lag",
      "n": 20,
      "meanRaw": 0.82,
      "observed": 1
    }
  ]
};

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
        ? `pulled down by ${Math.abs(delta).toFixed(2)} — the model was over-confident at this level`
        : `raised by ${delta.toFixed(2)} — the model was under-confident at this level`;
  return {
    raw: bounded,
    calibrated,
    fitted: true,
    note: `Stated ${bounded.toFixed(2)}, ${direction}, against ${CALIBRATION.n} outcomes with known ground truth.`,
  };
}
