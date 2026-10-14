// Day 69: Bubble Detector. The model, with no DOM code.
// Right-tailed ADF tests for explosive behaviour: the sup ADF (SADF) test of Phillips, Wu and Yu (2011) and the
// generalised sup ADF (GSADF) test and backward SADF date-stamping of Phillips, Shi and Yu (2015).
// Every ADF regression here has an intercept and k lagged differences (k = 0 by default):
// dy_t = a + b y_{t-1} + c_1 dy_{t-1} + ... + c_k dy_{t-k} + e_t, and the statistic is the t ratio of b.

import { rng } from "../kit/kit.js";

/** The smallest window, in observations: 36 months, the window Phillips, Shi and Yu used for the S&P 500. */
export const MIN_WINDOW = 36;

/**
 * Running sums that give any window's regression in constant time. Row t (t = 1..T-1) regresses
 * d_t = y_t - y_{t-1} on x_t = y_{t-1}. The series is shifted by its first value, which changes no t statistic
 * (the intercept absorbs it) and keeps the sums small.
 */
export function prefix(y) {
  const T = y.length;
  const c = y[0];
  const P = { T, x: new Float64Array(T), xx: new Float64Array(T), d: new Float64Array(T), xd: new Float64Array(T), dd: new Float64Array(T) };
  for (let t = 1; t < T; t++) {
    const x = y[t - 1] - c, d = y[t] - y[t - 1];
    P.x[t] = P.x[t - 1] + x;
    P.xx[t] = P.xx[t - 1] + x * x;
    P.d[t] = P.d[t - 1] + d;
    P.xd[t] = P.xd[t - 1] + x * d;
    P.dd[t] = P.dd[t - 1] + d * d;
  }
  return P;
}

/**
 * ADF t statistic for the observations a..b (inclusive), so b - a regression rows. NaN if the window is too short
 * or has no variation.
 */
export function adf(P, a, b) {
  const n = b - a;
  if (n < 3) return NaN;
  const sx = P.x[b] - P.x[a], sxx = P.xx[b] - P.xx[a], sd = P.d[b] - P.d[a], sxd = P.xd[b] - P.xd[a], sdd = P.dd[b] - P.dd[a];
  const vxx = sxx - (sx * sx) / n, vxd = sxd - (sx * sd) / n, vdd = sdd - (sd * sd) / n;
  if (!(vxx > 1e-14 * Math.max(1, sxx))) return NaN;
  const beta = vxd / vxx;
  const rss = vdd - beta * vxd;
  if (!(rss > 0)) return NaN;
  return beta / Math.sqrt(rss / (n - 2) / vxx);
}

/** The ADF coefficient b (the estimated rho - 1) for the observations a..b. */
export function adfSlope(P, a, b) {
  const n = b - a;
  const sx = P.x[b] - P.x[a], sxx = P.xx[b] - P.xx[a], sd = P.d[b] - P.d[a], sxd = P.xd[b] - P.xd[a];
  return (sxd - (sx * sd) / n) / (sxx - (sx * sx) / n);
}

/**
 * Running sums for the regression with k lagged differences, dy_t = a + b y_{t-1} + c_1 dy_{t-1} + ... + c_k dy_{t-k},
 * the augmentation of Said and Dickey that soaks up short-run correlation in the changes. Row t (t = k+1..T-1)
 * holds the variables v = [1, y_{t-1} - y_0, dy_{t-1}, ..., dy_{t-k}, dy_t]; S holds the running sums of every
 * product v_i v_j (i <= j), so a window's normal equations come from two lookups.
 */
export function prefixLag(y, k) {
  const T = y.length, q = k + 3, m = (q * (q + 1)) / 2;
  const S = new Float64Array(T * m);
  const v = new Float64Array(q);
  const c = y[0];
  for (let t = 1; t < T; t++) {
    const base = t * m;
    if (t > k) {
      v[0] = 1; v[1] = y[t - 1] - c;
      for (let j = 1; j <= k; j++) v[1 + j] = y[t - j] - y[t - j - 1];
      v[q - 1] = y[t] - y[t - 1];
    }
    let idx = 0;
    for (let i = 0; i < q; i++) for (let j = i; j < q; j++, idx++) S[base + idx] = S[base - m + idx] + (t > k ? v[i] * v[j] : 0);
  }
  const at = Array.from({ length: q }, (_, i) => Array.from({ length: q }, (_, j) => { const a = Math.min(i, j), b = Math.max(i, j); return a * q - (a * (a - 1)) / 2 + (b - a); }));
  const p = k + 1;
  const atF = Int32Array.from({ length: q * q }, (_, x) => at[Math.floor(x / q)][x % q]);
  return { T, k, q, m, S, at, atF, M: new Float64Array(p * p), g: new Float64Array(p), L: new Float64Array(p * p), w: new Float64Array(p), beta: new Float64Array(p), u: new Float64Array(p), e0: Float64Array.from({ length: p }, (_, i) => (i === 0 ? 1 : 0)) };
}

/**
 * ADF t statistic with k lags for the observations a..b: rows t = a+k+1..b, so b - a - k rows. The intercept is
 * removed by centring within the window; the slopes come from a Cholesky solve. Returns { t, rss, n } or null.
 */
export function adfLag(PL, a, b) {
  const { k, q, m, S, at, M, g, L, w, beta, u, e0 } = PL;
  const n = b - a - k, p = k + 1;
  if (n < k + 4) return null;
  const hi = b * m, lo = (a + k) * m;
  const sum = (i, j) => S[hi + at[i][j]] - S[lo + at[i][j]];
  const cen = (i, j) => sum(i, j) - (sum(0, i) * sum(0, j)) / n;
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) M[i * p + j] = M[j * p + i] = cen(1 + i, 1 + j);
    g[i] = cen(1 + i, q - 1);
  }
  // Cholesky M = L L'.
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i * p + j];
      for (let r = 0; r < j; r++) s -= L[i * p + r] * L[j * p + r];
      if (i === j) { if (!(s > 1e-14 * Math.max(1, M[i * p + i]))) return null; L[i * p + i] = Math.sqrt(s); }
      else L[i * p + j] = s / L[j * p + j];
    }
  }
  const solve = (rhs, out) => {
    for (let i = 0; i < p; i++) { let s = rhs[i]; for (let r = 0; r < i; r++) s -= L[i * p + r] * w[r]; w[i] = s / L[i * p + i]; }
    for (let i = p - 1; i >= 0; i--) { let s = w[i]; for (let r = i + 1; r < p; r++) s -= L[r * p + i] * out[r]; out[i] = s / L[i * p + i]; }
  };
  solve(g, beta);   // the slopes: b, c_1..c_k
  solve(e0, u);     // first column of M^-1, for the variance of b
  let rss = cen(q - 1, q - 1);
  for (let i = 0; i < p; i++) rss -= beta[i] * g[i];
  const df = n - (k + 2);
  if (!(rss > 0) || df < 1) return null;
  return { t: beta[0] / Math.sqrt((rss / df) * u[0]), rss, n, b: beta[0] };
}

/**
 * The same t statistic as adfLag(PL, a, b).t, without allocations or closures: the inner loop of bubbleTests calls
 * it T^2 / 2 times. Returns -Infinity when the window cannot be fitted.
 */
export function adfLagT(PL, a, b) {
  const { k, q, m, S, atF, M, g, L, w, beta, u } = PL;
  const n = b - a - k, p = k + 1, last = q - 1;
  if (n < k + 4) return -Infinity;
  const hi = b * m, lo = (a + k) * m;
  const s0d = S[hi + atF[last]] - S[lo + atF[last]];
  for (let i = 0; i < p; i++) {
    const ai = (1 + i) * q;
    const s0i = S[hi + atF[1 + i]] - S[lo + atF[1 + i]];
    for (let j = 0; j <= i; j++) {
      const s0j = S[hi + atF[1 + j]] - S[lo + atF[1 + j]];
      M[i * p + j] = S[hi + atF[ai + 1 + j]] - S[lo + atF[ai + 1 + j]] - (s0i * s0j) / n;
    }
    g[i] = S[hi + atF[ai + last]] - S[lo + atF[ai + last]] - (s0i * s0d) / n;
  }
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i * p + j];
      for (let r = 0; r < j; r++) s -= L[i * p + r] * L[j * p + r];
      if (i === j) { if (!(s > 1e-14 * Math.max(1, M[i * p + i]))) return -Infinity; L[i * p + i] = Math.sqrt(s); }
      else L[i * p + j] = s / L[j * p + j];
    }
  }
  // beta = M^-1 g and u = M^-1 e_0 (whose first entry gives the variance of b), by forward and back substitution.
  for (let i = 0; i < p; i++) { let s = g[i]; for (let r = 0; r < i; r++) s -= L[i * p + r] * w[r]; w[i] = s / L[i * p + i]; }
  for (let i = p - 1; i >= 0; i--) { let s = w[i]; for (let r = i + 1; r < p; r++) s -= L[r * p + i] * beta[r]; beta[i] = s / L[i * p + i]; }
  for (let i = 0; i < p; i++) { let s = i === 0 ? 1 : 0; for (let r = 0; r < i; r++) s -= L[i * p + r] * w[r]; w[i] = s / L[i * p + i]; }
  for (let i = p - 1; i >= 0; i--) { let s = w[i]; for (let r = i + 1; r < p; r++) s -= L[r * p + i] * u[r]; u[i] = s / L[i * p + i]; }
  const sdd = S[hi + atF[last * q + last]] - S[lo + atF[last * q + last]];
  let rss = sdd - (s0d * s0d) / n;
  for (let i = 0; i < p; i++) rss -= beta[i] * g[i];
  if (!(rss > 0)) return -Infinity;
  return beta[0] / Math.sqrt((rss / (n - k - 2)) * u[0]);
}

/**
 * Lag order by the Bayesian information criterion on the whole sample, comparing k = 0..kmax on the same rows
 * (t = kmax+1..T-1): BIC = n ln(RSS / n) + (k + 2) ln n.
 */
export function chooseLag(y, kmax = 6) {
  const T = y.length;
  const scores = [];
  for (let k = 0; k <= kmax; k++) {
    const r = adfLag(prefixLag(y, k), kmax - k, T - 1);
    scores.push(r ? r.n * Math.log(r.rss / r.n) + (k + 2) * Math.log(r.n) : Infinity);
  }
  let best = 0;
  scores.forEach((s, k) => { if (s < scores[best]) best = k; });
  return { k: best, bic: scores };
}

/**
 * The statistics for one series, minimum window w0 (observations) and lag order k:
 *   forward[b]  ADF on observations 0..b (the PWY sequence; SADF is its largest value),
 *   bsadf[b]    the largest ADF over windows that end at b and hold at least w0 observations (GSADF is its largest),
 *   start[b]    where the window that gives bsadf[b] starts.
 * Entries before b = w0 - 1 are NaN.
 */
function testsStart(y, w0, k) {
  const T = y.length;
  if (!(w0 >= 4) || T < w0) throw new Error(`need at least ${Math.max(4, w0)} observations, got ${T}`);
  if (!(Number.isInteger(k) && k >= 0 && w0 - 1 - k >= k + 4)) throw new Error(`lag order ${k} does not fit a window of ${w0}`);
  return {
    T, w0, k, forward: new Float64Array(T).fill(NaN), bsadf: new Float64Array(T).fill(NaN), start: new Int32Array(T).fill(-1),
    sadf: -Infinity, gsadf: -Infinity, sadfAt: -1, gsadfAt: -1, P: k === 0 ? prefix(y) : null, PL: k > 0 ? prefixLag(y, k) : null,
  };
}
/** All the windows that end at b. */
function testsAt(s, b) {
  const { w0, k, P, PL } = s;
  let best = -Infinity, at = -1;
  if (k === 0) {
    // The same arithmetic as adf(P, a, b), written out because this loop runs T^2 / 2 times.
    const { x: X, xx: XX, d: D, xd: XD, dd: DD } = P;
    const xb = X[b], xxb = XX[b], db = D[b], xdb = XD[b], ddb = DD[b];
    for (let a = 0; a <= b - w0 + 1; a++) {
      const n = b - a;
      const sx = xb - X[a], sxx = xxb - XX[a], sd = db - D[a], sxd = xdb - XD[a], sdd = ddb - DD[a];
      const vxx = sxx - (sx * sx) / n, vxd = sxd - (sx * sd) / n, vdd = sdd - (sd * sd) / n;
      if (!(vxx > 1e-14 * Math.max(1, sxx))) continue;
      const beta = vxd / vxx, rss = vdd - beta * vxd;
      if (!(rss > 0)) continue;
      const t = beta / Math.sqrt(rss / (n - 2) / vxx);
      if (t > best) { best = t; at = a; }
    }
  } else {
    for (let a = 0; a <= b - w0 + 1; a++) {
      const t = adfLagT(PL, a, b);
      if (t > best) { best = t; at = a; }
    }
  }
  s.forward[b] = k === 0 ? adf(P, 0, b) : adfLag(PL, 0, b)?.t ?? NaN;
  s.bsadf[b] = best;
  s.start[b] = at;
  if (s.forward[b] > s.sadf) { s.sadf = s.forward[b]; s.sadfAt = b; }
  if (best > s.gsadf) { s.gsadf = best; s.gsadfAt = b; }
}
const testsResult = ({ T, w0, k, forward, bsadf, start, sadf, gsadf, sadfAt, gsadfAt }) => ({ T, w0, k, forward, bsadf, start, sadf, gsadf, sadfAt, gsadfAt });

/** The statistics described above, for the whole series at once. */
export function bubbleTests(y, w0 = MIN_WINDOW, k = 0) {
  const s = testsStart(y, w0, k);
  for (let b = w0 - 1; b < s.T; b++) testsAt(s, b);
  return testsResult(s);
}

/** The same as bubbleTests, as a generator that yields every eight end points, so that a page can slice the work. */
export function* bubbleTestsSteps(y, w0 = MIN_WINDOW, k = 0) {
  const s = testsStart(y, w0, k);
  for (let b = w0 - 1; b < s.T; b++) { testsAt(s, b); if ((b & 7) === 7) yield; }
  return testsResult(s);
}

/** Run a generator to the end and return its value. */
export function finish(gen) {
  let r;
  do r = gen.next(); while (!r.done);
  return r.value;
}

/* ---------------------------------------------------------------- simulation */

/**
 * PSY's null: a random walk with an asymptotically negligible drift, y_t = d T^-eta + y_{t-1} + e_t, with
 * d = eta = 1 and e_t standard normal. The ADF t statistic does not depend on y_0 or on the scale of e.
 */
export function randomWalk(T, rand, { drift = 1 / T, sigma = 1, y0 = 0 } = {}) {
  const y = new Float64Array(T);
  y[0] = y0;
  for (let t = 1; t < T; t++) y[t] = y[t - 1] + drift + sigma * rand.normal();
  return y;
}

/**
 * The single-bubble process of Phillips, Wu and Yu (their equation used in PSY as (9)): a random walk until te,
 * a mildly explosive stretch y_t = delta y_{t-1} + e_t from te to tf, a collapse back to the level at te, then a
 * random walk again.
 */
export function bubblePath(T, rand, { y0 = 100, sigma = 1, delta, te, tf }) {
  const y = new Float64Array(T);
  y[0] = y0;
  for (let t = 1; t < T; t++) {
    const e = sigma * rand.normal();
    if (t < te || t > tf + 1) y[t] = y[t - 1] + e;
    else if (t <= tf) y[t] = delta * y[t - 1] + e;
    else y[t] = y[te] + e; // collapse at tf + 1 to the level where the bubble began
  }
  return y;
}

/** Percentiles 1..99 of a sample (linear interpolation). */
export function percentiles(values) {
  const s = Float64Array.from(values).sort();
  return Array.from({ length: 99 }, (_, k) => {
    const pos = (s.length - 1) * ((k + 1) / 100), lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  });
}

/**
 * Monte Carlo distribution under the null for sample size T and minimum window w0: percentiles of SADF, GSADF and
 * of BSADF at the last observation, and the 90%, 95% and 99% critical value of BSADF at every end point b.
 * Runs reps replications from the given seed with lag order k; onProgress(done) is called after each one.
 */
export function simulateNull(T, w0, reps, seed, { k = 0, onProgress } = {}) {
  const rand = rng(seed);
  const sadf = new Float64Array(reps), gsadf = new Float64Array(reps);
  const atB = Array.from({ length: T }, () => new Float64Array(reps));
  for (let rep = 0; rep < reps; rep++) {
    const r = bubbleTests(randomWalk(T, rand), w0, k);
    sadf[rep] = r.sadf;
    gsadf[rep] = r.gsadf;
    for (let b = w0 - 1; b < T; b++) atB[b][rep] = r.bsadf[b];
    onProgress?.(rep + 1);
  }
  const cv = (q) => Array.from({ length: T }, (_, b) => (b < w0 - 1 ? null : percentiles(atB[b])[q - 1]));
  return { T, w0, k, reps, seed, sadf: percentiles(sadf), gsadf: percentiles(gsadf), bsadfEnd: percentiles(atB[T - 1]), cv90: cv(90), cv95: cv(95), cv99: cv(99) };
}

/* ---------------------------------------------------------------- reading the statistics */

/** How many of the simulated percentiles 1..99 the statistic exceeds: 0 to 99 ("higher than k% of random walks"). */
export function rankAgainst(pcts, stat) {
  if (!Number.isFinite(stat)) return 0;
  let k = 0;
  while (k < pcts.length && stat > pcts[k]) k++;
  return k;
}

/** Critical value at a level (0.90, 0.95 or 0.99) from a list of percentiles 1..99. */
export const criticalValue = (pcts, level) => pcts[Math.round(level * 100) - 1];

/**
 * Monte Carlo standard error of a simulated critical value: sqrt(p (1 - p) / reps) divided by the density at the
 * quantile, the density estimated from the neighbouring percentiles.
 */
export function criticalError(pcts, level, reps) {
  const i = Math.round(level * 100) - 1;
  const lo = Math.max(0, i - 1), hi = Math.min(pcts.length - 1, i + 1);
  const density = (hi - lo) / 100 / (pcts[hi] - pcts[lo]);
  return Math.sqrt((level * (1 - level)) / reps) / density;
}

/**
 * The verdict on a statistic against a simulated critical value: "explosive" only when it is above the critical value
 * by more than twice the critical value's simulation error, "not explosive" when below by more than that, and
 * "on the edge" in between, where another simulation could reverse the call.
 */
export function verdict(stat, cv, error) {
  if (!Number.isFinite(stat)) return "not explosive";
  if (stat > cv + 2 * error) return "explosive";
  if (stat < cv - 2 * error) return "not explosive";
  return "on the edge";
}

/** Smallest duration of a dated episode, in observations: longer than log T (Phillips, Wu and Yu 2011). */
export const minDuration = (T) => Math.floor(Math.log(T)) + 1;

/**
 * Date-stamped episodes: runs of consecutive observations with bsadf[b] above the critical value cv[b], kept if they
 * last at least minLength observations. Shorter runs are returned separately as brief crossings.
 */
export function episodes(bsadf, cv, minLength) {
  const runs = [];
  let from = -1;
  for (let b = 0; b <= bsadf.length; b++) {
    const above = b < bsadf.length && cv[b] != null && bsadf[b] > cv[b];
    if (above && from < 0) from = b;
    if (!above && from >= 0) { runs.push({ from, to: b - 1, length: b - from }); from = -1; }
  }
  return { kept: runs.filter((r) => r.length >= minLength), brief: runs.filter((r) => r.length < minLength) };
}

/** "YYYY-MM" for month i after start. */
export function monthAt(start, i) {
  const [y, m] = start.split("-").map(Number);
  const k = y * 12 + (m - 1) + i;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

/**
 * A series' trend and noise: the mean and standard deviation of its monthly change in natural logs, and their ratio,
 * the trend in standard deviations a month. The ADF statistic ignores the scale of a series, so a random walk with
 * steps N(ratio, 1) has the same trend relative to its noise as the series.
 */
export function trendOf(values) {
  const d = [];
  for (let i = 1; i < values.length; i++) d.push(Math.log(values[i] / values[i - 1]));
  const mean = d.reduce((a, v) => a + v, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, v) => a + (v - mean) ** 2, 0) / (d.length - 1));
  return { mean, sd, ratio: mean / sd };
}

/** Monthly averages of a daily random walk with standard normal steps (21 trading days a month). */
export function averagedWalk(T, rand, days = 21) {
  const y = new Float64Array(T);
  let p = 0;
  for (let t = 0; t < T; t++) {
    let sum = 0;
    for (let d = 0; d < days; d++) { p += rand.normal(); sum += p; }
    y[t] = sum / days;
  }
  return y;
}

/**
 * Size and power on simulated paths for one sample size. Each call draws one path with no bubble (a random walk, or
 * monthly averages of a daily random walk) and one bubble path, tests both with lag order k, and adds to the tally.
 * The bubble starts 40% of the way in, as in Phillips, Shi and Yu's simulations, and lasts `length` months.
 */
export function* powerSteps(tally, { T, w0, k = 0, crit, level, delta, length, rand, averaged = false, drift = null }) {
  const te = Math.floor(0.4 * T), tf = Math.min(T - 2, te + length - 1);
  const cvG = criticalValue(crit.gsadf, level), cvS = criticalValue(crit.sadf, level);
  const cvB = level === 0.9 ? crit.cv90 : level === 0.99 ? crit.cv99 : crit.cv95;
  const minLen = minDuration(T);
  // drift: a steady trend in standard deviations of the step (driftRatio of a real series); null keeps PSY's 1/T.
  const nul = yield* bubbleTestsSteps(averaged ? averagedWalk(T, rand) : randomWalk(T, rand, drift == null ? undefined : { drift }), w0, k);
  const bubPath = bubblePath(T, rand, { delta, te, tf });
  const bub = yield* bubbleTestsSteps(bubPath, w0, k);
  tally.n++;
  if (nul.gsadf > cvG) tally.nullG++;
  if (nul.sadf > cvS) tally.nullS++;
  if (episodes(nul.bsadf, cvB, minLen).kept.length) tally.nullDated++;
  if (bub.gsadf > cvG) tally.bubG++;
  if (bub.sadf > cvS) tally.bubS++;
  if (episodes(bub.bsadf, cvB, minLen).kept.some((e) => e.from <= tf && e.to >= te)) tally.bubDated++;
  return { te, tf, nul, bub, bubPath };
}
/** One pair of paths at once (powerSteps run to the end). */
export const powerStep = (tally, opts) => finish(powerSteps(tally, opts));
export const emptyPower = () => ({ n: 0, nullG: 0, nullS: 0, nullDated: 0, bubG: 0, bubS: 0, bubDated: 0 });
