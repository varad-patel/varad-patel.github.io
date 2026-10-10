// Day 17: Occam's Razor Lab. The model, with no DOM code.
// Least-squares polynomials of rising degree, and the criteria that choose between them.

import { rng } from "../kit/kit.js";

export const X_MIN = 0, X_MAX = 10, MAX_DEGREE = 8;
export const CRITERIA = [
  { key: "aic", label: "AIC" },
  { key: "aicc", label: "AICc" },
  { key: "bic", label: "BIC" },
  { key: "loo", label: "Leave-one-out" },
];

/** The curves the generator can draw from, all on 0 <= x <= 10 and roughly 1 <= y <= 9. `degree` is null when no polynomial is exactly right. */
export const TRUTHS = [
  { id: "line", label: "Straight line", degree: 1, formula: "y = 2 + 0.6x", f: (x) => 2 + 0.6 * x },
  { id: "quadratic", label: "Quadratic", degree: 2, formula: "y = 2 + 2x − 0.2x²", f: (x) => 2 + 2 * x - 0.2 * x * x },
  { id: "cubic", label: "Cubic", degree: 3, formula: "y = 5 + 8(u³ − 0.6u), u = (x − 5)/5", f: (x) => { const u = (x - 5) / 5; return 5 + 8 * (u ** 3 - 0.6 * u); } },
  { id: "sine", label: "Sine wave", degree: null, formula: "y = 5 + 3 sin(0.9x)", f: (x) => 5 + 3 * Math.sin(0.9 * x) },
];
export const truthOf = (id) => TRUTHS.find((t) => t.id === id) || null;

/** n points with x uniform on [0, 10] and y = truth(x) + normal noise. The same seed always gives the same points. */
export function generate({ truth = "quadratic", noise = 1, n = 30, seed = 17 } = {}) {
  const t = truthOf(truth);
  if (!t) return { error: `There is no curve called "${truth}".` };
  if (!Number.isInteger(n) || n < 3 || n > 1000) return { error: "The sample size must be a whole number from 3 to 1,000." };
  if (!Number.isFinite(noise) || noise < 0) return { error: "The noise level must be zero or more." };
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) return { error: "The seed must be a whole number from 0 to 4,294,967,295." };
  const r = rng(seed);
  const points = [];
  for (let i = 0; i < n; i++) {
    const x = r.uniform(X_MIN, X_MAX);
    points.push({ x, y: t.f(x) + r.normal(0, noise) });
  }
  return { points };
}

/** Legendre polynomials P0..Pm at t, by the three-term recurrence. They stay between -1 and 1 on [-1, 1]. */
export function legendre(t, m) {
  const p = [1];
  if (m >= 1) p.push(t);
  for (let j = 1; j < m; j++) p.push(((2 * j + 1) * t * p[j] - j * p[j - 1]) / (j + 1));
  return p;
}

/**
 * Fit polynomials of degree 0, 1, ... by least squares, all at once.
 *
 * x is mapped to t in [-1, 1] and the design matrix is built from Legendre polynomials in t, then made
 * orthonormal column by column (Gram-Schmidt, done twice for accuracy), giving A = QR. Because the columns
 * are nested, the degree-d fit is the projection of y on the first d + 1 columns of Q. No matrix of powers
 * of raw x is ever inverted.
 *
 * Returns { n, lo, hi, top, models: [{ degree, k, rss, mse, aic, aicc, bic, loo, exact, beta }] } or { error }.
 * The highest degree fitted is limited by the number of different x values and leaves at least one spare point.
 */
export function fitPolynomials(points, maxDegree = MAX_DEGREE) {
  const pts = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 3) return { error: `There ${n === 1 ? "is 1 point" : `are ${n} points`}. Add at least three to compare models.`, n };
  const x = pts.map((p) => p.x), y = pts.map((p) => p.y);
  const lo = Math.min(...x), hi = Math.max(...x);
  const scale = (v) => (hi > lo ? (2 * v - lo - hi) / (hi - lo) : 0);
  let top = Math.max(0, Math.min(maxDegree, new Set(x).size - 1, n - 2));

  const basis = x.map((v) => legendre(scale(v), top));
  const Q = [], R = Array.from({ length: top + 1 }, () => new Array(top + 1).fill(0));
  const dot = (a, b) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; };
  for (let j = 0; j <= top; j++) {
    const v = basis.map((row) => row[j]);
    const size = Math.sqrt(dot(v, v));
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < j; k++) {
      const r = dot(Q[k], v);
      R[k][j] += r;
      for (let i = 0; i < n; i++) v[i] -= r * Q[k][i];
    }
    const norm = Math.sqrt(dot(v, v));
    if (norm < 1e-9 * size) { top = j - 1; break; }   // this power adds nothing the lower ones do not already span
    R[j][j] = norm;
    Q.push(v.map((e) => e / norm));
  }

  const my = y.reduce((s, v) => s + v, 0) / n;
  const tss = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const c = Q.map((q) => dot(q, y));
  const fitted = new Array(n).fill(0), lever = new Array(n).fill(0);
  const models = [];
  for (let d = 0; d <= top; d++) {
    let rss = 0, press = 0, loo = true;
    for (let i = 0; i < n; i++) {
      fitted[i] += c[d] * Q[d][i];
      lever[i] += Q[d][i] ** 2;
      const e = y[i] - fitted[i];
      rss += e * e;
      if (1 - lever[i] > 1e-9) press += (e / (1 - lever[i])) ** 2; else loo = false;
    }
    // Coefficients on the Legendre basis: solve the leading (d + 1) block of R by back substitution.
    const beta = new Array(d + 1).fill(0);
    for (let j = d; j >= 0; j--) {
      let s = c[j];
      for (let k = j + 1; k <= d; k++) s -= R[j][k] * beta[k];
      beta[j] = s / R[j][j];
    }
    const k = d + 2;                                  // d + 1 coefficients and the noise variance
    const exact = rss <= 1e-18 * (tss || 1);          // a perfect fit has no finite log-likelihood
    const base = exact ? NaN : n * Math.log(rss / n);
    models.push({
      degree: d, k, rss, mse: rss / n, exact, beta,
      aic: base + 2 * k,
      aicc: n - k - 1 > 0 ? base + 2 * k + (2 * k * (k + 1)) / (n - k - 1) : NaN,
      bic: base + k * Math.log(n),
      loo: loo && !exact ? press / n : NaN,
    });
  }
  return { n, lo, hi, top, tss, models };
}

/** The degree-d fitted curve at x. */
export function predict(fit, degree, x) {
  const { lo, hi } = fit;
  const t = hi > lo ? (2 * x - lo - hi) / (hi - lo) : 0;
  const p = legendre(t, degree), beta = fit.models[degree].beta;
  let s = 0;
  for (let j = 0; j <= degree; j++) s += beta[j] * p[j];
  return s;
}

/** [[x, y]] along the degree-d curve. */
export const curve = (fit, degree, from = X_MIN, to = X_MAX, steps = 200) =>
  Array.from({ length: steps + 1 }, (_, i) => { const x = from + ((to - from) * i) / steps; return [x, predict(fit, degree, x)]; });

/** The degree each measure likes best: the lowest finite value, and the lower degree on a tie. null if it is never defined. */
export function picks(fit) {
  const out = {};
  for (const key of ["rss", "aic", "aicc", "bic", "loo"]) {
    let best = null;
    for (const m of fit.models) if (Number.isFinite(m[key]) && (best === null || m[key] < fit.models[best][key])) best = m.degree;
    out[key] = best;
  }
  return out;
}

/**
 * One simulated sample: what each criterion picks, and how far each pick's curve is from the truth.
 * `risk` is the mean squared distance between the chosen curve and the true curve at the sampled x values.
 */
export function trial({ truth = "quadratic", noise = 1, n = 30, seed = 1 } = {}) {
  const made = generate({ truth, noise, n, seed });
  if (made.error) return { error: made.error };
  const fit = fitPolynomials(made.points);
  const f = truthOf(truth).f;
  const riskOf = (d) => made.points.reduce((s, p) => s + (predict(fit, d, p.x) - f(p.x)) ** 2, 0) / n;
  const chosen = picks(fit);
  const byDegree = fit.models.map((m) => riskOf(m.degree));
  const risk = {};
  for (const key of ["rss", ...CRITERIA.map((c) => c.key)]) risk[key] = chosen[key] == null ? NaN : byDegree[chosen[key]];
  return { picks: chosen, risk, byDegree, top: fit.top };
}

/** Trials `from` to `to` of an experiment. Trial i always uses the same seed, so batches can be run in any order. */
export function experiment({ truth = "quadratic", noise = 1, n = 30, seed = 17 } = {}, from = 0, to = 1000) {
  const out = [];
  for (let i = from; i < to; i++) {
    const t = trial({ truth, noise, n, seed: ((seed + 1) * 100003 + i) % 4294967296 });
    if (t.error) return { error: t.error };
    out.push(t);
  }
  return out;
}

/** Tally an experiment: how often each criterion picked each degree, and the average risk of its picks. */
export function summarise(trials, trueDegree = null) {
  const runs = trials.length;
  const degrees = Math.max(0, ...trials.map((t) => t.top)) + 1;
  const out = { runs, degrees, trueDegree, criteria: {}, riskByDegree: Array.from({ length: degrees }, (_, d) => { const v = trials.filter((t) => t.byDegree[d] != null); return v.reduce((s, t) => s + t.byDegree[d], 0) / v.length; }) };
  for (const key of ["rss", ...CRITERIA.map((c) => c.key)]) {
    const counts = new Array(degrees).fill(0);
    let sum = 0, used = 0, risk = 0;
    for (const t of trials) {
      const d = t.picks[key];
      if (d == null) continue;
      counts[d]++; sum += d; used++;
      risk += t.risk[key];
    }
    out.criteria[key] = {
      counts, used, meanDegree: used ? sum / used : NaN, risk: used ? risk / used : NaN,
      right: trueDegree == null || !used ? NaN : counts[trueDegree] / used,
      low: trueDegree == null || !used ? NaN : counts.slice(0, trueDegree).reduce((s, v) => s + v, 0) / used,
      high: trueDegree == null || !used ? NaN : counts.slice(trueDegree + 1).reduce((s, v) => s + v, 0) / used,
    };
  }
  return out;
}
