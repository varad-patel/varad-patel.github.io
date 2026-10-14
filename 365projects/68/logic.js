// Day 68: Crypto Volatility Lab. The model, with no DOM code.
// GARCH(1,1) with a constant mean, fitted to daily log returns by Gaussian (quasi-) maximum likelihood,
// volatility regimes, a risk forecast with parameter uncertainty, and a backtest that uses only past data.

import { rng, stats, linalg } from "../kit/kit.js";

export const DAYS_PER_YEAR = 365; // crypto markets trade every day
const DAY_MS = 86400000;

/* ---------------------------------------------------------------- dates and returns */

/** "YYYY-MM-DD" for the day i days after start. */
export const dateAt = (start, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
/** Index of the first day on or after date (0 if date is before start). */
export const indexOf = (start, date) => Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS));

/** Daily log returns in percent: r[i] = 100 ln(p[i+1] / p[i]). */
export function logReturns(prices) {
  const r = new Float64Array(prices.length - 1);
  for (let i = 1; i < prices.length; i++) r[i - 1] = 100 * Math.log(prices[i] / prices[i - 1]);
  return r;
}

/* ---------------------------------------------------------------- the GARCH(1,1) filter */

// theta = [mu, omega, alpha, beta]. e_t = r_t - mu, h_t = omega + alpha e_{t-1}^2 + beta h_{t-1}.
// Before the first day, e_0^2 = h_0 = s2, the mean of e_t^2 over the sample (as in the McCullough-Renfro benchmark),
// so h_1 = omega + (alpha + beta) s2. A backtest passes s2 from the estimation window, so no later data leaks in.
const LOG2PI = Math.log(2 * Math.PI);

export function meanSquare(r, mu) {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += (r[i] - mu) ** 2;
  return s / r.length;
}

/** Conditional variances h (Float64Array) for every day, the log-likelihood, and the variance for the day after. */
export function filter(r, theta, s2 = meanSquare(r, theta[0])) {
  const [mu, omega, alpha, beta] = theta;
  const n = r.length;
  const h = new Float64Array(n);
  let prevE2 = s2, prevH = s2, ll = 0;
  for (let t = 0; t < n; t++) {
    const ht = omega + alpha * prevE2 + beta * prevH;
    const e = r[t] - mu;
    h[t] = ht;
    ll += -0.5 * (LOG2PI + Math.log(ht) + (e * e) / ht);
    prevE2 = e * e;
    prevH = ht;
  }
  return { h, ll, next: omega + alpha * prevE2 + beta * prevH };
}

/**
 * Log-likelihood, its gradient with respect to [mu, omega, alpha, beta], and optionally each day's score and the
 * information matrix A = sum over t of (dm_t)(dm_t)' / h_t + (1/2) (dh_t)(dh_t)' / h_t^2, with the blocks linking
 * the mean to the variance parameters set to zero, as in Bollerslev and Wooldridge (1992). This reproduces the
 * benchmark's robust standard errors exactly.
 * The derivatives of h_t follow the same recursion as h_t itself, including the dependence of s2 on mu.
 */
export function gradient(r, theta, { scores = false, info = false } = {}) {
  const [mu, omega, alpha, beta] = theta;
  const n = r.length;
  let s2 = 0, sumE = 0;
  for (let t = 0; t < n; t++) { const e = r[t] - mu; s2 += e * e; sumE += e; }
  s2 /= n;
  const ds2 = (-2 * sumE) / n; // d s2 / d mu
  // h_1 and its derivatives.
  let h = omega + (alpha + beta) * s2;
  let d = [(alpha + beta) * ds2, 1, s2, s2];
  let ll = 0;
  const g = [0, 0, 0, 0];
  const S = scores ? Array.from({ length: n }, () => new Float64Array(4)) : null;
  const A = info ? Array.from({ length: 4 }, () => [0, 0, 0, 0]) : null;
  for (let t = 0; t < n; t++) {
    const e = r[t] - mu;
    if (!(h > 0)) return { ll: -Infinity, g: [NaN, NaN, NaN, NaN], scores: S, info: A };
    ll += -0.5 * (LOG2PI + Math.log(h) + (e * e) / h);
    const a = (0.5 * ((e * e) / h - 1)) / h; // d ll_t / d h_t
    const st = [a * d[0] + e / h, a * d[1], a * d[2], a * d[3]];
    for (let k = 0; k < 4; k++) g[k] += st[k];
    if (S) S[t].set(st);
    if (A) {
      A[0][0] += 1 / h + (0.5 * d[0] * d[0]) / (h * h);
      for (let i = 1; i < 4; i++) for (let j = 1; j < 4; j++) A[i][j] += (0.5 * d[i] * d[j]) / (h * h);
    }
    // Step to h_{t+1} = omega + alpha e_t^2 + beta h_t.
    d = [-2 * alpha * e + beta * d[0], 1 + beta * d[1], e * e + beta * d[2], h + beta * d[3]];
    h = omega + alpha * e * e + beta * h;
  }
  return { ll, g, scores: S, info: A };
}

/* ---------------------------------------------------------------- estimation */

// The optimiser works on unconstrained numbers u, mapped so that omega > 0, alpha >= 0, beta >= 0 and
// alpha + beta < 1: omega = exp(u1), p = alpha + beta = logistic(u2), alpha = p logistic(u3), beta = p - alpha.
const logistic = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));
const toTheta = (u) => {
  const p = logistic(u[2]), s = logistic(u[3]);
  return [u[0], Math.exp(u[1]), p * s, p * (1 - s)];
};
const toU = (th) => {
  const p = th[2] + th[3];
  return [th[0], Math.log(th[1]), logit(p), logit(th[2] / p)];
};
function gradU(u, gTheta) {
  const p = logistic(u[2]), s = logistic(u[3]);
  const dp = p * (1 - p), ds = s * (1 - s);
  return [
    gTheta[0],
    gTheta[1] * Math.exp(u[1]),
    gTheta[2] * s * dp + gTheta[3] * (1 - s) * dp,
    gTheta[2] * p * ds - gTheta[3] * p * ds,
  ];
}

/** Maximise the log-likelihood by BFGS on u from one starting point. */
function bfgs(r, theta0, { maxIter = 400 } = {}) {
  const n = r.length;
  const f = (u) => {
    const th = toTheta(u);
    const { ll, g } = gradient(r, th);
    return { f: -ll / n, g: gradU(u, g).map((v) => -v / n), th, ll };
  };
  let u = toU(theta0);
  let cur = f(u);
  let H = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  let iter = 0;
  for (; iter < maxIter; iter++) {
    if (Math.max(...cur.g.map(Math.abs)) < 1e-10) break;
    const dir = H.map((row) => -row.reduce((s, v, j) => s + v * cur.g[j], 0));
    let slope = dir.reduce((s, v, j) => s + v * cur.g[j], 0);
    if (!(slope < 0)) { H = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; continue; }
    let step = 1, next = null;
    for (let k = 0; k < 60; k++) {
      const trial = u.map((v, j) => v + step * dir[j]);
      const res = f(trial);
      if (Number.isFinite(res.f) && res.f <= cur.f + 1e-4 * step * slope) { next = { u: trial, ...res }; break; }
      step /= 2;
    }
    if (!next) break;
    const s = next.u.map((v, j) => v - u[j]);
    const y = next.g.map((v, j) => v - cur.g[j]);
    const sy = s.reduce((a, v, j) => a + v * y[j], 0);
    const done = Math.abs(cur.f - next.f) < 1e-15 * Math.max(1, Math.abs(cur.f));
    u = next.u;
    cur = next;
    if (sy > 1e-18) {
      const Hy = H.map((row) => row.reduce((a, v, j) => a + v * y[j], 0));
      const yHy = y.reduce((a, v, j) => a + v * Hy[j], 0);
      H = H.map((row, i) => row.map((v, j) => v + ((sy + yHy) * s[i] * s[j]) / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy));
    }
    if (done) break;
  }
  return { theta: cur.th, ll: cur.ll, iterations: iter };
}

/** Hessian of the log-likelihood in theta, by central differences of the analytic gradient. */
export function hessian(r, theta) {
  const H = [];
  for (let j = 0; j < 4; j++) {
    const step = 1e-5 * Math.max(Math.abs(theta[j]), 1e-3);
    const up = [...theta], dn = [...theta];
    up[j] += step; dn[j] -= step;
    const gu = gradient(r, up).g, gd = gradient(r, dn).g;
    H.push(gu.map((v, i) => (v - gd[i]) / (2 * step)));
  }
  return H.map((row, i) => row.map((v, j) => (v + H[j][i]) / 2));
}

/**
 * Fit GARCH(1,1) by maximum likelihood. Returns the estimates, their standard errors (from the Hessian, and
 * the Bollerslev-Wooldridge robust "sandwich" errors that stay valid when the shocks are not normal), the
 * fitted conditional variances and the standardised residuals.
 */
export function fitGarch(r) {
  const n = r.length;
  if (n < 100) throw new Error(`need at least 100 returns, got ${n}`);
  const mu0 = stats.mean(r), v0 = stats.variance(r);
  const starts = [[mu0, v0 * 0.05, 0.1, 0.85], [mu0, v0 * 0.02, 0.05, 0.93], [mu0, v0 * 0.2, 0.2, 0.6]];
  let best = null;
  for (const s of starts) {
    const res = bfgs(r, s);
    if (!best || res.ll > best.ll) best = res;
  }
  let theta = best.theta;
  // Newton polish in theta, when the optimum is inside the parameter space.
  let H = hessian(r, theta);
  for (let k = 0; k < 6; k++) {
    let stepTheta;
    const { g, ll } = gradient(r, theta);
    try { stepTheta = linalg.solve(H, g).map((v) => -v); } catch { break; }
    const next = theta.map((v, j) => v + stepTheta[j]);
    if (!(next[1] > 0 && next[2] >= 0 && next[3] >= 0 && next[2] + next[3] < 1)) break;
    const nextLl = gradient(r, next).ll;
    if (!(nextLl >= ll - 1e-9)) break;
    theta = next;
    H = hessian(r, theta);
    if (Math.max(...stepTheta.map((v, j) => Math.abs(v) / Math.max(Math.abs(theta[j]), 1e-6))) < 1e-12) break;
  }
  const { ll, g, scores, info } = gradient(r, theta, { scores: true, info: true });
  const [mu, omega, alpha, beta] = theta;
  const persistence = alpha + beta;
  const boundary = alpha < 1e-4 || beta < 1e-4 || persistence > 0.9995;
  let cov = null, covHessian = null;
  try {
    // Robust covariance A^-1 G A^-1, with G the sum of outer products of the daily scores.
    const Ainv = linalg.inverse(info);
    const G = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => { let s = 0; for (const st of scores) s += st[i] * st[j]; return s; }));
    cov = linalg.matmul(linalg.matmul(Ainv, G), Ainv);
    covHessian = linalg.inverse(H).map((row) => row.map((v) => -v));
  } catch { /* singular: no standard errors */ }
  const se = (C) => (C ? C.map((row, i) => (row[i] > 0 ? Math.sqrt(row[i]) : NaN)) : [NaN, NaN, NaN, NaN]);
  const { h, next } = filter(r, theta);
  const z = new Float64Array(n);
  for (let t = 0; t < n; t++) z[t] = (r[t] - mu) / Math.sqrt(h[t]);
  return {
    theta, mu, omega, alpha, beta, ll, n, gradient: g, persistence, boundary,
    longRunVar: persistence < 1 ? omega / (1 - persistence) : Infinity,
    halfLife: persistence < 1 && persistence > 0 ? Math.log(0.5) / Math.log(persistence) : Infinity,
    cov, se: se(cov), seHessian: se(covHessian), h, next, z, s2: meanSquare(r, mu),
  };
}

/* ---------------------------------------------------------------- forecasts */

/** sigma^2 for 1..H days ahead: longRun + persistence^(k-1) (next - longRun). */
export function forecastVariance(theta, next, H) {
  const [, omega, alpha, beta] = theta;
  const p = alpha + beta;
  const out = new Float64Array(H);
  let v = next;
  for (let k = 0; k < H; k++) { out[k] = v; v = omega + p * v; }
  return out;
}

/** Inverse of the standard normal distribution function (Wichura's algorithm AS 241, about 16 digits). */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return q * (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r + 45921.953931549871457) * r + 13731.693765509461125) * r + 1971.5909503065514427) * r + 133.14166789178437745) * r + 3.387132872796366608)
      / (((((((5226.495278852545925 * r + 28729.085735721942674) * r + 39307.89580009271061) * r + 21213.794301586595867) * r + 5394.1960214247511077) * r + 687.1870074920579083) * r + 42.313330701600911252) * r + 1);
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let x;
  if (r <= 5) {
    r -= 1.6;
    x = (((((((7.7454501427834140764e-4 * r + 0.0227238449892691845833) * r + 0.24178072517745061177) * r + 1.27045825245236838258) * r + 3.64784832476320460504) * r + 5.7694972214606914055) * r + 4.6303378461565452959) * r + 1.42343711074968357734)
      / (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 0.0151986665636164571966) * r + 0.14810397642748007459) * r + 0.68976733498510000455) * r + 1.6763848301838038494) * r + 2.05319162663775882187) * r + 1);
  } else {
    r -= 5;
    x = (((((((2.01033439929228813265e-7 * r + 2.71155556874348757815e-5) * r + 0.0012426609473880784386) * r + 0.026532189526576123093) * r + 0.29656057182850489123) * r + 1.7848265399172913358) * r + 5.4637849111641143699) * r + 6.6579046435011037772)
      / (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r + 7.868691311456132591e-4) * r + 0.0148753612908506148525) * r + 0.13692988092273580531) * r + 0.59983220655588793769) * r + 1);
  }
  return q < 0 ? -x : x;
}

/** Linear-interpolated quantile of an already sorted array. */
export function sortedQuantile(sorted, q) {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** The shock quantile for a one-day value at risk: normal, or the empirical quantile of past standardised residuals. */
export function shockQuantile(level, shocks, z) {
  if (shocks === "normal") return normalQuantile(1 - level);
  const sorted = Float64Array.from(z).sort();
  return sortedQuantile(sorted, 1 - level);
}

/** One-day value at risk as a positive percentage loss: -(mu + sigma q), turned from log return to price change. */
export const varFromLog = (mu, sigma, q) => -(Math.exp((mu + sigma * q) / 100) - 1) * 100;

/** Lower Cholesky factor of a symmetric positive definite matrix, or null. */
export function cholesky(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (!(s > 0)) return null; L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
  }
  return L;
}

/**
 * Parameter draws from the estimates' approximate sampling distribution, N(theta, robust covariance), keeping
 * only draws inside the parameter space. Each draw carries its own variance for the day after the data.
 */
export function parameterDraws(r, fit, count, seed) {
  const L = fit.cov ? cholesky(fit.cov) : null;
  if (!L) return null;
  const rand = rng(seed);
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 20; tries++) {
    const zz = [0, 0, 0, 0].map(() => rand.normal());
    const th = fit.theta.map((v, i) => v + L[i].reduce((s, l, k) => s + l * zz[k], 0));
    if (!(th[1] > 0 && th[2] >= 0 && th[3] >= 0 && th[2] + th[3] < 1)) continue;
    out.push({ theta: th, next: filter(r, th).next });
  }
  return out.length >= count / 2 ? out : null;
}

/**
 * Simulated cumulative log returns (percent) over 1..horizon days. Each path uses one parameter draw (or the
 * estimates) and shocks that are normal or resampled from the standardised residuals (filtered historical simulation).
 * Returns, for each horizon, the requested quantiles.
 */
export function simulatePaths(fit, { horizon, paths, seed, shocks, draws, probs }) {
  const rand = rng(seed);
  const cum = Array.from({ length: horizon }, () => new Float64Array(paths));
  const z = fit.z;
  for (let m = 0; m < paths; m++) {
    const d = draws && draws.length ? draws[m % draws.length] : { theta: fit.theta, next: fit.next };
    const [mu, omega, alpha, beta] = d.theta;
    let h = d.next, c = 0;
    for (let k = 0; k < horizon; k++) {
      const shock = shocks === "normal" ? rand.normal() : z[Math.floor(rand() * z.length)];
      const e = Math.sqrt(h) * shock;
      c += mu + e;
      cum[k][m] = c;
      h = omega + alpha * e * e + beta * h;
    }
  }
  return cum.map((col) => {
    col.sort();
    return probs.map((p) => sortedQuantile(col, p));
  });
}

/* ---------------------------------------------------------------- regimes */

/**
 * Volatility regimes from the fitted daily volatility: "calm" in the lowest quarter of days, "stormy" in the
 * highest quarter, "ordinary" in between. Returns the two cut-offs and a label per day.
 */
export function regimes(h) {
  const sigma = Float64Array.from(h, Math.sqrt);
  const sorted = Float64Array.from(sigma).sort();
  const low = sortedQuantile(sorted, 0.25), high = sortedQuantile(sorted, 0.75);
  const labels = Array.from(sigma, (s) => (s > high ? "stormy" : s < low ? "calm" : "ordinary"));
  return { low, high, labels, sigma };
}

/** Runs of consecutive days with the same label: [{ label, from, to }] (inclusive indices). */
export function runs(labels) {
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    if (out.length && out[out.length - 1].label === labels[i]) out[out.length - 1].to = i;
    else out.push({ label: labels[i], from: i, to: i });
  }
  return out;
}

/** Percentile rank (0 to 100) of x among values: the share of values strictly below x plus half of the ties. */
export function percentileRank(values, x) {
  let below = 0, ties = 0;
  for (const v of values) { if (v < x) below++; else if (v === x) ties++; }
  return (100 * (below + ties / 2)) / values.length;
}

/* ---------------------------------------------------------------- backtest */

/**
 * Plan of a backtest: forecasts for days first..n-1, with the model re-estimated every `every` days on all
 * returns before the block (an expanding window). Each block is [from, to) in return indices.
 */
export function backtestPlan(n, first, every) {
  const blocks = [];
  for (let from = first; from < n; from += every) blocks.push({ from, to: Math.min(n, from + every) });
  return blocks;
}

/**
 * Value at risk for every day of one block, by three methods that each see only returns before that day:
 * GARCH (estimated on returns before the block, filtered day by day), RiskMetrics EWMA (lambda 0.94) and
 * historical simulation (the empirical quantile of the previous 250 returns). Values are positive percentage losses
 * of the log return (exceedance when r_t < -VaR_t).
 */
export function backtestBlock(r, block, { level, shocks, ewma }) {
  const est = r.subarray(0, block.from);
  const fit = fitGarch(est);
  const q = shockQuantile(level, shocks, fit.z);
  const qn = normalQuantile(1 - level);
  // Filter through the block with the block's estimates and the estimation window's s2.
  const { h } = filter(r.subarray(0, block.to), fit.theta, fit.s2);
  const rows = [];
  let ew = ewma.variance;
  for (let t = block.from; t < block.to; t++) {
    const hist = Float64Array.from(r.subarray(Math.max(0, t - 250), t)).sort();
    rows.push({
      t, r: r[t],
      garch: -(fit.mu + Math.sqrt(h[t]) * q),
      ewma: -Math.sqrt(ew) * qn,
      hist: -sortedQuantile(hist, 1 - level),
    });
    ew = 0.94 * ew + 0.06 * r[t] * r[t];
  }
  ewma.variance = ew;
  return { rows, fit };
}

/** Starting EWMA variance: the mean square of the returns before the first forecast. */
export const ewmaStart = (r, first) => ({ variance: meanSquare(r.subarray(0, first), 0) });

/** Kupiec's proportion-of-failures test: x exceedances in n days against a rate p. */
export function kupiec(x, n, p) {
  const xlogy = (a, b) => (a === 0 ? 0 : a * Math.log(b));
  const lr = -2 * (xlogy(n - x, 1 - p) + xlogy(x, p) - xlogy(n - x, 1 - x / n) - xlogy(x, x / n));
  const stat = Math.max(0, lr);
  return { lr: stat, pValue: 2 * (1 - stats.normalCdf(Math.sqrt(stat))) };
}

/** Exceedances, their rate, Kupiec's test and the average quantile ("tick") loss, for each method. */
export function scoreBacktest(rows, level) {
  const a = 1 - level;
  const out = {};
  for (const m of ["garch", "ewma", "hist"]) {
    let x = 0, loss = 0;
    for (const row of rows) {
      const hit = row.r < -row[m];
      if (hit) x++;
      loss += (a - (hit ? 1 : 0)) * (row.r + row[m]);
    }
    out[m] = { exceedances: x, n: rows.length, rate: x / rows.length, ...kupiec(x, rows.length, a), loss: loss / rows.length };
  }
  return out;
}
