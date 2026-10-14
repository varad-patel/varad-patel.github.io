// Day 62: Random Walk versus Reality. The model, with no DOM code.
// Lo and MacKinlay's (1988) variance-ratio test on month-end index closes, combined across horizons by Chow and
// Denning's (1993) multiple variance-ratio test, plus a simulation that checks the test on true random walks.

import { stats } from "../kit/kit.js";

export const QS = [2, 4, 8, 16];      // the horizons tested, in months, as in Lo and MacKinlay's paper (in weeks there)
export const ALPHA = 0.05;
export const MIN_RETURNS = 64;        // four times the longest horizon

/* ---------------------------------------------------------- the normal distribution */

/**
 * The standard normal quantile: algorithm AS 241 (PPND16) of Wichura (1988), accurate to about 1e-16.
 */
export function invNorm(p) {
  if (!(p > 0 && p < 1)) throw new Error("the probability must be strictly between 0 and 1");
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

/** Two-sided p-value of a standard normal statistic. */
export const pNormal = (z) => 2 * (1 - stats.normalCdf(Math.abs(z)));

/**
 * The studentised maximum modulus with infinite degrees of freedom: the largest |Z| among m independent standard
 * normals. P(max |Z| <= c) = (2 Phi(c) - 1)^m, so the critical value at level alpha is
 * Phi^-1((1 + (1 - alpha)^(1/m)) / 2), which is 2.4909 for m = 4 and alpha = 0.05.
 */
export const smmCritical = (alpha = ALPHA, m = QS.length) => invNorm((1 + (1 - alpha) ** (1 / m)) / 2);
export const smmP = (x, m = QS.length) => 1 - (2 * stats.normalCdf(Math.abs(x)) - 1) ** m;

/* ---------------------------------------------------------- the variance ratio */

/**
 * Lo and MacKinlay's variance ratio for horizon q on log prices p_0 ... p_N (N changes r_k = p_k - p_(k-1)):
 *   mu = (p_N - p_0) / N
 *   sa2 = sum (r_k - mu)^2 / (N - 1)
 *   sc2(q) = sum_(k = q..N) (p_k - p_(k-q) - q mu)^2 / m,   m = q (N - q + 1)(1 - q / N)
 *   VR(q) = sc2(q) / sa2
 * Under a random walk with independent, identically distributed changes,
 *   z(q) = (VR(q) - 1) / sqrt(2(2q - 1)(q - 1) / (3qN))  is approximately standard normal.
 * Allowing the variance of the changes to vary (heteroskedasticity), with
 *   delta(j) = N sum_(k = j+1..N) (r_k - mu)^2 (r_(k-j) - mu)^2 / (sum (r_k - mu)^2)^2
 *   theta(q) = sum_(j = 1..q-1) (2(q - j) / q)^2 delta(j)
 *   z*(q) = (VR(q) - 1) / sqrt(theta(q) / N)  is approximately standard normal.
 */
export function varianceRatio(p, q) {
  const N = p.length - 1;
  if (!Number.isInteger(q) || q < 2) throw new Error("q must be a whole number of 2 or more");
  if (N < 2 * q) throw new Error(`a variance ratio at ${q} months needs at least ${2 * q} monthly changes`);
  const mu = (p[N] - p[0]) / N;
  let ss = 0;
  const dev = new Float64Array(N + 1);
  for (let k = 1; k <= N; k++) { dev[k] = p[k] - p[k - 1] - mu; ss += dev[k] * dev[k]; }
  if (!(ss > 0)) throw new Error("the monthly changes never vary, so there is no variance to compare");
  const sa2 = ss / (N - 1);
  let sq = 0;
  for (let k = q; k <= N; k++) sq += (p[k] - p[k - q] - q * mu) ** 2;
  const m = q * (N - q + 1) * (1 - q / N);
  const vr = sq / m / sa2;
  const seIid = Math.sqrt((2 * (2 * q - 1) * (q - 1)) / (3 * q * N));
  let theta = 0;
  for (let j = 1; j < q; j++) {
    let num = 0;
    for (let k = j + 1; k <= N; k++) num += dev[k] * dev[k] * dev[k - j] * dev[k - j];
    theta += ((2 * (q - j)) / q) ** 2 * (N * num) / (ss * ss);
  }
  const seRobust = Math.sqrt(theta / N);
  const z = (vr - 1) / seIid, zStar = (vr - 1) / seRobust;
  return { q, N, vr, z, zStar, seIid, seRobust, pZ: pNormal(z), pZStar: pNormal(zStar) };
}

/**
 * Chow and Denning's multiple variance-ratio test: the largest |z*| over the horizons tested, compared with the
 * studentised maximum modulus. A random walk is rejected only when that largest |z*| is strictly above the critical
 * value. The direction comes from the horizon where |z*| is largest: VR above 1 means changes tend to continue,
 * below 1 that they tend to reverse.
 */
export function chowDenning(ratios, { alpha = ALPHA, robust = true } = {}) {
  const key = robust ? "zStar" : "z";
  let at = ratios[0];
  for (const r of ratios) if (Math.abs(r[key]) > Math.abs(at[key])) at = r;
  const maxAbs = Math.abs(at[key]);
  const critical = smmCritical(alpha, ratios.length);
  return { maxAbs, at: at.q, vrAt: at.vr, critical, p: smmP(maxAbs, ratios.length), reject: maxAbs > critical, direction: at.vr > 1 ? "continue" : "reverse" };
}

/** Natural logs of positive prices. */
export function toLogs(values) {
  for (let i = 0; i < values.length; i++) if (!(values[i] > 0) || !Number.isFinite(values[i])) throw new Error(`price ${i + 1} is not a positive number`);
  return Float64Array.from(values, Math.log);
}

/** The whole test on a run of log prices: one variance ratio per horizon and the joint verdict (on z*, and on z for comparison). */
export function testWalk(p, qs = QS) {
  const N = p.length - 1;
  if (N < MIN_RETURNS) return { N, error: `The test needs at least ${MIN_RETURNS} monthly changes (four times the longest horizon, ${qs[qs.length - 1]} months); these years give ${N}. Choose a longer span.` };
  let ratios;
  try { ratios = qs.map((q) => varianceRatio(p, q)); } catch (e) { return { N, error: `${e.message[0].toUpperCase()}${e.message.slice(1)}.` }; }
  return { N, ratios, joint: chowDenning(ratios), jointIid: chowDenning(ratios, { robust: false }) };
}

/** VR(q) for q = 1..qMax with a pointwise 95% range under the heteroskedasticity-robust standard error. */
export function vrCurve(p, qMax = 24) {
  const out = [{ q: 1, vr: 1, lo: 1, hi: 1 }];
  const z = invNorm(0.975);
  for (let q = 2; q <= Math.min(qMax, Math.floor((p.length - 1) / 2)); q++) {
    const r = varianceRatio(p, q);
    out.push({ q, vr: r.vr, lo: 1 - z * r.seRobust, hi: 1 + z * r.seRobust });
  }
  return out;
}

/** First-order autocorrelation of the monthly changes. */
export function autocorr1(p) {
  const r = [];
  for (let k = 1; k < p.length; k++) r.push(p[k] - p[k - 1]);
  const m = stats.mean(r);
  let num = 0, den = 0;
  for (let k = 0; k < r.length; k++) { den += (r[k] - m) ** 2; if (k) num += (r[k] - m) * (r[k - 1] - m); }
  return num / den;
}

/* ---------------------------------------------------------- testing the test */

/**
 * A simulated random walk of N monthly changes with standard deviation sd. With spells, the changes have the same
 * long-run variance but come in calm and stormy spells, GARCH(1,1): v_t = w + 0.10 e_(t-1)^2 + 0.85 v_(t-1).
 */
export function simulateWalk(N, sd, rand, { spells = false } = {}) {
  const p = new Float64Array(N + 1);
  const a = 0.1, b = 0.85, w = sd * sd * (1 - a - b);
  let v = sd * sd, e = 0;
  for (let k = 1; k <= N; k++) {
    if (spells) v = w + a * e * e + b * v;
    e = rand.normal(0, spells ? Math.sqrt(v) : sd);
    p[k] = p[k - 1] + e;
  }
  return p;
}

/** Count how often the joint test rejects on `reps` simulated random walks: { reps, robust, iid }. */
export function sizeCheck(N, sd, reps, rand, options = {}) {
  let robust = 0, iid = 0;
  for (let i = 0; i < reps; i++) {
    const t = testWalk(simulateWalk(N, sd, rand, options));
    if (t.joint.reject) robust++;
    if (t.jointIid.reject) iid++;
  }
  return { reps, robust, iid };
}

/**
 * The most rejections in `reps` simulated random walks that a test of true size alpha would reach by chance:
 * the smallest k with P(X <= k) >= 0.975 for X ~ Binomial(reps, alpha). More than that says the test rejects too often.
 */
export function chanceLimit(reps, alpha = ALPHA) {
  let cum = 0;
  for (let k = 0; k <= reps; k++) { cum += stats.binomPmf(k, reps, alpha); if (cum >= 0.975) return k; }
  return reps;
}

/* ---------------------------------------------------------- months */

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthIndex = (key) => { const [y, m] = key.split("-").map(Number); return y * 12 + m - 1; };
export const monthLabel = (start, i, short = true) => { const k = monthIndex(start) + i; return `${short ? MONTHS[k % 12].slice(0, 3) : MONTHS[k % 12]} ${Math.floor(k / 12)}`; };
export const lastKey = (s) => { const k = monthIndex(s.start) + s.values.length - 1; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; };

/**
 * The month-end closes of a series from January of fromYear to December of toYear (clipped to the series), as logs.
 * The first close in the span is the starting point, so N changes need N + 1 closes.
 */
export function span(series, fromYear, toYear) {
  const k0 = monthIndex(series.start);
  const a = Math.max(0, fromYear * 12 - k0), b = Math.min(series.values.length - 1, toYear * 12 + 11 - k0);
  if (b < a) return { first: a, last: b, p: new Float64Array(0) };
  return { first: a, last: b, p: toLogs(series.values.slice(a, b + 1)) };
}
