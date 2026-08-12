/**
 * Logistic regression with L2 regularisation, fitted by batch gradient descent.
 *
 * Written out rather than pulled in: it is forty lines, it keeps the fit
 * auditable in the same repo as the thing it fits, and it avoids a dependency
 * on the upload/serving path.
 */

export interface FitResult {
  intercept: number;
  weights: number[];
  featureNames: string[];
  iterations: number;
  finalLoss: number;
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function fitLogistic(
  X: number[][],
  y: number[],
  featureNames: string[],
  opts: { lr?: number; l2?: number; iterations?: number } = {},
): FitResult {
  const lr = opts.lr ?? 0.35;
  const l2 = opts.l2 ?? 0.02;
  const iterations = opts.iterations ?? 4000;
  const n = X.length;
  const d = featureNames.length;

  let intercept = 0;
  const w = new Array<number>(d).fill(0);
  let finalLoss = 0;

  for (let it = 0; it < iterations; it += 1) {
    const gradW = new Array<number>(d).fill(0);
    let gradB = 0;
    let loss = 0;

    for (let i = 0; i < n; i += 1) {
      const xi = X[i];
      let z = intercept;
      for (let j = 0; j < d; j += 1) z += w[j] * xi[j];
      const p = sigmoid(z);
      const err = p - y[i];
      gradB += err;
      for (let j = 0; j < d; j += 1) gradW[j] += err * xi[j];
      const eps = 1e-12;
      loss -= y[i] * Math.log(p + eps) + (1 - y[i]) * Math.log(1 - p + eps);
    }

    intercept -= lr * (gradB / n);
    for (let j = 0; j < d; j += 1) {
      w[j] -= lr * (gradW[j] / n + l2 * w[j]);
    }
    finalLoss = loss / n;
  }

  return { intercept, weights: w, featureNames, iterations, finalLoss };
}

export function predict(fit: FitResult, x: number[]): number {
  let z = fit.intercept;
  for (let j = 0; j < fit.weights.length; j += 1) z += fit.weights[j] * x[j];
  return sigmoid(z);
}

/* ───────────────────────────── metrics ────────────────────────────────────*/

export function accuracy(probs: number[], y: number[], threshold = 0.5): number {
  let ok = 0;
  for (let i = 0; i < y.length; i += 1) if ((probs[i] >= threshold ? 1 : 0) === y[i]) ok += 1;
  return ok / y.length;
}

/** AUC via the rank-sum identity — exact, no sampling. */
export function auc(probs: number[], y: number[]): number {
  const pairs = probs.map((p, i) => ({ p, y: y[i] })).sort((a, b) => a.p - b.p);
  let rank = 1;
  let i = 0;
  const ranks = new Array<number>(pairs.length);
  while (i < pairs.length) {
    let j = i;
    while (j + 1 < pairs.length && pairs[j + 1].p === pairs[i].p) j += 1;
    const avg = (rank + (rank + (j - i))) / 2;
    for (let k = i; k <= j; k += 1) ranks[k] = avg;
    rank += j - i + 1;
    i = j + 1;
  }
  const pos = pairs.filter((p) => p.y === 1).length;
  const neg = pairs.length - pos;
  if (pos === 0 || neg === 0) return NaN;
  let sumPos = 0;
  pairs.forEach((p, idx) => {
    if (p.y === 1) sumPos += ranks[idx];
  });
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function brier(probs: number[], y: number[]): number {
  return probs.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / y.length;
}

export interface CalibrationBin {
  from: number;
  to: number;
  count: number;
  meanPredicted: number;
  observed: number;
}

/** Reliability table: does "70% confident" actually mean right 70% of the time? */
export function calibrationBins(probs: number[], y: number[], bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let b = 0; b < bins; b += 1) {
    const from = b / bins;
    const to = (b + 1) / bins;
    const idx = probs
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => (b === bins - 1 ? p >= from && p <= to : p >= from && p < to))
      .map(({ i }) => i);
    if (idx.length === 0) continue;
    out.push({
      from,
      to,
      count: idx.length,
      meanPredicted: idx.reduce((s, i) => s + probs[i], 0) / idx.length,
      observed: idx.reduce((s, i) => s + y[i], 0) / idx.length,
    });
  }
  return out;
}

/** Mean absolute gap between stated confidence and observed frequency. */
export function expectedCalibrationError(bins: CalibrationBin[], n: number): number {
  return bins.reduce((s, b) => s + (b.count / n) * Math.abs(b.meanPredicted - b.observed), 0);
}

/* ───────────────────── isotonic regression (Fit 2) ────────────────────────*/

export interface IsotonicPoint {
  x: number;
  y: number;
}

/**
 * Pool-adjacent-violators. Produces a monotone step function mapping a raw
 * stated score onto an observed frequency — the standard way to correct a
 * model that is confident in the wrong proportion.
 */
export function fitIsotonic(xs: number[], ys: number[]): IsotonicPoint[] {
  const order = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b]);
  const x = order.map((i) => xs[i]);
  const y = order.map((i) => ys[i]);

  const values = [...y];
  const weights = new Array<number>(y.length).fill(1);
  const starts = y.map((_, i) => i);
  let i = 0;
  while (i < values.length - 1) {
    if (values[i] <= values[i + 1]) {
      i += 1;
      continue;
    }
    const w = weights[i] + weights[i + 1];
    const v = (values[i] * weights[i] + values[i + 1] * weights[i + 1]) / w;
    values.splice(i, 2, v);
    weights.splice(i, 2, w);
    starts.splice(i + 1, 1);
    if (i > 0) i -= 1;
  }

  const points: IsotonicPoint[] = [];
  let cursor = 0;
  for (let b = 0; b < values.length; b += 1) {
    const end = cursor + weights[b];
    points.push({ x: x[cursor], y: values[b] });
    if (end - 1 < x.length) points.push({ x: x[Math.min(end - 1, x.length - 1)], y: values[b] });
    cursor = end;
  }
  return points;
}

/** Linear interpolation over the isotonic step points, clamped at the ends. */
export function applyIsotonic(points: IsotonicPoint[], x: number): number {
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
