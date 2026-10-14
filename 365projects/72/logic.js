// Day 72: Market Regime Detector. The model, with no DOM code.
// A Gaussian hidden Markov model of monthly changes, fitted by the Baum-Welch (expectation-maximisation) algorithm
// with the scaled forward-backward recursions, and compared across numbers of regimes by BIC.

import { rng, stats } from "../kit/kit.js";

const LOG2PI = Math.log(2 * Math.PI);
const logDensity = (x, mu, sd) => -0.5 * (LOG2PI + 2 * Math.log(sd) + ((x - mu) / sd) ** 2);

/* ---------------------------------------------------------------- data */

/** "YYYY-MM" for month i after start. */
export function monthAt(start, i) {
  const [y, m] = start.split("-").map(Number);
  const k = y * 12 + (m - 1) + i;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

/**
 * The series the model reads: for a price, the monthly log change in percent, 100 ln(P_t / P_{t-1});
 * for a yield, the monthly change in percentage points. Observation i is the change into month i + 1.
 */
export function changes(series) {
  const v = series.values;
  return Float64Array.from({ length: v.length - 1 }, (_, i) => (series.kind === "yield" ? v[i + 1] - v[i] : 100 * Math.log(v[i + 1] / v[i])));
}

/* ---------------------------------------------------------------- the model */

// model = { K, pi: [K], A: [K][K] (rows sum to 1), mu: [K], sd: [K] }

/** Emission densities B[t][k] = N(x_t; mu_k, sd_k^2), returned as a flat Float64Array of length n K. */
function emissions(x, model) {
  const { K, mu, sd } = model;
  const B = new Float64Array(x.length * K);
  for (let t = 0; t < x.length; t++) for (let k = 0; k < K; k++) B[t * K + k] = Math.exp(logDensity(x[t], mu[k], sd[k]));
  return B;
}

/**
 * Scaled forward pass: alpha[t][k] = P(s_t = k | x_1..x_t) (the filtered probabilities), c[t] = P(x_t | x_1..x_{t-1}),
 * and the log-likelihood sum of ln c[t]. Rabiner (1989), section V.A.
 */
export function forward(x, model, B = emissions(x, model)) {
  const { K, pi, A } = model;
  const n = x.length;
  const alpha = new Float64Array(n * K), c = new Float64Array(n);
  let ll = 0;
  for (let t = 0; t < n; t++) {
    let s = 0;
    for (let j = 0; j < K; j++) {
      let p;
      if (t === 0) p = pi[j];
      else { p = 0; for (let i = 0; i < K; i++) p += alpha[(t - 1) * K + i] * A[i][j]; }
      const v = p * B[t * K + j];
      alpha[t * K + j] = v;
      s += v;
    }
    if (!(s > 0)) return { alpha, c, ll: -Infinity };
    for (let j = 0; j < K; j++) alpha[t * K + j] /= s;
    c[t] = s;
    ll += Math.log(s);
  }
  return { alpha, c, ll };
}

/** Scaled backward pass, using the forward pass's scale factors. */
export function backward(x, model, c, B = emissions(x, model)) {
  const { K, A } = model;
  const n = x.length;
  const beta = new Float64Array(n * K);
  for (let k = 0; k < K; k++) beta[(n - 1) * K + k] = 1;
  for (let t = n - 2; t >= 0; t--) {
    for (let i = 0; i < K; i++) {
      let s = 0;
      for (let j = 0; j < K; j++) s += A[i][j] * B[(t + 1) * K + j] * beta[(t + 1) * K + j];
      beta[t * K + i] = s / c[t + 1];
    }
  }
  return beta;
}

/** Smoothed probabilities gamma[t][k] = P(s_t = k | all data), and expected transition counts xi[i][j]. */
export function posteriors(x, model) {
  const { K, A } = model;
  const n = x.length;
  const B = emissions(x, model);
  const f = forward(x, model, B);
  const beta = backward(x, model, f.c, B);
  const gamma = new Float64Array(n * K);
  for (let t = 0; t < n; t++) for (let k = 0; k < K; k++) gamma[t * K + k] = f.alpha[t * K + k] * beta[t * K + k];
  const xi = Array.from({ length: K }, () => new Array(K).fill(0));
  for (let t = 0; t < n - 1; t++) {
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
      xi[i][j] += (f.alpha[t * K + i] * A[i][j] * B[(t + 1) * K + j] * beta[(t + 1) * K + j]) / f.c[t + 1];
    }
  }
  return { gamma, xi, alpha: f.alpha, ll: f.ll };
}

/**
 * One Baum-Welch step: new pi from gamma at t = 0, A from the expected transitions, and each regime's mean and
 * variance weighted by gamma. A regime's standard deviation is kept at least sdFloor, so that a regime cannot
 * collapse onto a single month and send the likelihood to infinity.
 */
export function baumWelchStep(x, model, sdFloor = 0) {
  const { K } = model;
  const n = x.length;
  const { gamma, xi, ll } = posteriors(x, model);
  const pi = Array.from({ length: K }, (_, k) => gamma[k]);
  const A = xi.map((row) => { const s = row.reduce((a, b) => a + b, 0); return s > 0 ? row.map((v) => v / s) : row.map(() => 1 / K); });
  const mu = new Array(K).fill(0), sd = new Array(K).fill(0), w = new Array(K).fill(0);
  for (let t = 0; t < n; t++) for (let k = 0; k < K; k++) { const g = gamma[t * K + k]; w[k] += g; mu[k] += g * x[t]; }
  for (let k = 0; k < K; k++) mu[k] = w[k] > 0 ? mu[k] / w[k] : model.mu[k];
  for (let t = 0; t < n; t++) for (let k = 0; k < K; k++) sd[k] += gamma[t * K + k] * (x[t] - mu[k]) ** 2;
  for (let k = 0; k < K; k++) sd[k] = Math.max(sdFloor, w[k] > 0 ? Math.sqrt(sd[k] / w[k]) : model.sd[k]);
  return { model: { K, pi, A, mu, sd }, ll };
}

/** Run a generator to the end and return its value. The page instead calls next() a few times per frame. */
export function finish(gen) {
  let r;
  do r = gen.next(); while (!r.done);
  return r.value;
}

/**
 * Iterate Baum-Welch from a starting model until the log-likelihood gains less than tol (relative). A generator that
 * yields after every iteration, so that the page can spread the work over frames.
 */
export function* baumWelchSteps(x, start, { maxIter = 500, tol = 1e-8, sdFloor = 0 } = {}) {
  let model = start, last = -Infinity;
  const history = [];
  let iter = 0;
  for (; iter < maxIter; iter++) {
    const step = baumWelchStep(x, model, sdFloor);
    history.push(step.ll);
    model = step.model;
    if (Math.abs(step.ll - last) < tol * Math.max(1, Math.abs(step.ll))) break;
    last = step.ll;
    yield;
  }
  return { model, ll: forward(x, model).ll, iterations: iter + 1, history };
}
export const baumWelch = (x, start, opts) => finish(baumWelchSteps(x, start, opts));

/** Order the regimes from the lowest standard deviation to the highest, so that labels are comparable across fits. */
export function sortByVolatility(model) {
  const order = model.sd.map((s, k) => k).sort((a, b) => model.sd[a] - model.sd[b] || model.mu[a] - model.mu[b]);
  return {
    K: model.K, order,
    pi: order.map((k) => model.pi[k]), mu: order.map((k) => model.mu[k]), sd: order.map((k) => model.sd[k]),
    A: order.map((i) => order.map((j) => model.A[i][j])),
  };
}

/**
 * Starting models (count in all): means at quantiles of the data with equal standard deviations; equal means with
 * spreads from half to twice the data's; one regime per group of months ranked by local volatility; then random
 * means and standard deviations. All have persistent transition matrices.
 */
export function startingModels(x, K, count, seed) {
  const rand = rng(seed);
  const s = stats.sd(x), sorted = Float64Array.from(x).sort();
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
  const persistent = (stay) => Array.from({ length: K }, (_, i) => Array.from({ length: K }, (_, j) => (i === j ? stay : (1 - stay) / (K - 1 || 1))));
  const out = [];
  out.push({ K, pi: new Array(K).fill(1 / K), A: K === 1 ? [[1]] : persistent(0.9), mu: Array.from({ length: K }, (_, k) => q((k + 0.5) / K)), sd: new Array(K).fill(s) });
  // Same mean, different spreads: the shape regimes in volatility usually take.
  out.push({ K, pi: new Array(K).fill(1 / K), A: K === 1 ? [[1]] : persistent(0.95), mu: new Array(K).fill(stats.mean(x)), sd: Array.from({ length: K }, (_, k) => s * (0.5 + (1.5 * k) / Math.max(1, K - 1))) });
  // Months grouped by their local volatility (the mean square of the changes within three months either side), one
  // group per regime: a start near the calm and turbulent stretches the data actually contain. Without it, twelve
  // starts missed the best three-regime fit of the Treasury yield and of Brent crude.
  if (out.length < count) {
    const n = x.length, loc = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const a = Math.max(0, t - 3), b = Math.min(n, t + 4);
      let q2 = 0;
      for (let i = a; i < b; i++) q2 += x[i] * x[i];
      loc[t] = q2 / (b - a);
    }
    const order = Array.from(loc.keys()).sort((i, j) => loc[i] - loc[j]);
    const groups = Array.from({ length: K }, (_, k) => order.slice(Math.floor((k * n) / K), Math.floor(((k + 1) * n) / K)).map((i) => x[i]));
    out.push({
      K, pi: new Array(K).fill(1 / K), A: K === 1 ? [[1]] : persistent(0.95),
      mu: groups.map((g) => stats.mean(g)), sd: groups.map((g) => Math.max(stats.sd(g), 0.05 * s)),
    });
  }
  while (out.length < count) {
    out.push({
      K, pi: new Array(K).fill(1 / K), A: K === 1 ? [[1]] : persistent(rand.uniform(0.7, 0.98)),
      mu: Array.from({ length: K }, () => q(rand.uniform(0.1, 0.9))), sd: Array.from({ length: K }, () => s * rand.uniform(0.3, 2)),
    });
  }
  return out;
}

/** Number of free parameters: K means, K standard deviations, K(K - 1) transitions and K - 1 starting probabilities. */
export const parameterCount = (K) => 2 * K + K * (K - 1) + (K - 1);

/**
 * Fit a K-regime model from several starts and keep the best. Reports how many starts reached (within 0.01 of the
 * log-likelihood) the best optimum, and the distinct local optima found, for the page's stability check.
 */
export function* fitHmmSteps(x, K, { starts = 20, seed = 72, sdFloorShare = 0.05, maxIter = 500 } = {}) {
  const sdFloor = sdFloorShare * stats.sd(x);
  const fits = [];
  for (const m of startingModels(x, K, starts, seed + K)) fits.push(yield* baumWelchSteps(x, m, { sdFloor, maxIter }));
  fits.sort((a, b) => b.ll - a.ll);
  const best = fits[0];
  const optima = [];
  for (const f of fits) if (!optima.some((o) => Math.abs(o.ll - f.ll) < 0.01)) optima.push(f);
  const model = sortByVolatility(best.model);
  const n = x.length, p = parameterCount(K);
  return {
    K, model, ll: best.ll, n, p, bic: -2 * best.ll + p * Math.log(n), aic: -2 * best.ll + 2 * p,
    reached: fits.filter((f) => best.ll - f.ll < 0.01).length, starts, optima: optima.map((o) => ({ ll: o.ll, model: sortByVolatility(o.model) })),
    iterations: best.iterations, history: best.history, sdFloor,
  };
}
export const fitHmm = (x, K, opts) => finish(fitHmmSteps(x, K, opts));

/* ---------------------------------------------------------------- reading the fit */

/** Expected length of a stay in each regime, 1 / (1 - a_kk) months. */
export const durations = (model) => model.A.map((row, k) => (row[k] < 1 ? 1 / (1 - row[k]) : Infinity));

/** Long-run share of time in each regime: the stationary distribution of A (by iterating the chain). */
export function stationary(A) {
  const K = A.length;
  let p = new Array(K).fill(1 / K);
  for (let it = 0; it < 10000; it++) {
    const q = new Array(K).fill(0);
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) q[j] += p[i] * A[i][j];
    const diff = q.reduce((s, v, j) => s + Math.abs(v - p[j]), 0);
    p = q;
    if (diff < 1e-14) break;
  }
  return p;
}

/** Most probable regime at each time from a flat probability array (n K). */
export function argmaxRows(probs, K) {
  const n = probs.length / K;
  const out = new Int32Array(n);
  for (let t = 0; t < n; t++) { let best = 0; for (let k = 1; k < K; k++) if (probs[t * K + k] > probs[t * K + best]) best = k; out[t] = best; }
  return out;
}

/** Runs of consecutive equal labels: [{ label, from, to }]. */
export function runs(labels) {
  const out = [];
  for (let i = 0; i < labels.length; i++) {
    if (out.length && out[out.length - 1].label === labels[i]) out[out.length - 1].to = i;
    else out.push({ label: labels[i], from: i, to: i });
  }
  return out;
}

/** Share of positions where two label paths differ. */
export function disagreement(a, b, from = 0) {
  let d = 0, n = 0;
  for (let t = from; t < a.length; t++) { n++; if (a[t] !== b[t]) d++; }
  return n ? d / n : 0;
}

/* ---------------------------------------------------------------- labels in real time */

/**
 * Real-time labels: refit the model every `every` months on data up to then (from fresh starts and warm-started from
 * the previous fit), and label each following month by its filtered probability, which uses data up to that month
 * only. A generator: yields while it works, and returns the labels (-1 before `first`) and the number of refits.
 */
export function* realTimeSteps(x, K, { first, every = 12, seed = 72, starts = 4 }) {
  const labels = new Int32Array(x.length).fill(-1);
  let prev = null, fits = 0;
  for (let at = first; at < x.length; at += every) {
    const est = x.subarray(0, at);
    let fit = yield* fitHmmSteps(est, K, { starts, seed: seed + at, maxIter: 300 });
    if (prev) {
      const warm = yield* baumWelchSteps(est, prev, { sdFloor: fit.sdFloor, maxIter: 300 });
      if (warm.ll > fit.ll + 1e-9) fit = { ...fit, model: sortByVolatility(warm.model), ll: warm.ll };
    }
    prev = fit.model;
    const to = Math.min(x.length, at + every);
    const { alpha } = forward(x.subarray(0, to), fit.model);
    for (let t = at; t < to; t++) { let best = 0; for (let k = 1; k < K; k++) if (alpha[t * K + k] > alpha[t * K + best]) best = k; labels[t] = best; }
    fits++;
    yield fits; // the number of refits done, for a progress message
  }
  return { labels, fits, first };
}
