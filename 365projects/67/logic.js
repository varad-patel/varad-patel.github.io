// Day 67: Monte Carlo Market and VaR. The model, with no DOM code.
// Holdings driven by correlated Brownian motions, simulated from a seeded generator; value at risk and expected
// shortfall from the simulated futures, with their Monte Carlo error and, for normal returns, the closed form.

import { rng } from "../kit/kit.js";

export const TRADING_DAYS = 252;
export const MAX_HOLDINGS = 6;
export const MAX_STEPS = 25; // time points kept per simulated future for the fan chart; the end point is exact anyway
export const CONFIDENCES = [0.9, 0.95, 0.975, 0.99, 0.995, 0.999];
export const COUNTS = [1000, 5000, 10000, 50000, 100000];
export const LIMITS = {
  amount: { min: 0, max: 1e12 },
  mu: { min: -50, max: 50 }, // % a year
  sigma: { min: 0, max: 200 }, // % a year
  corr: { min: -1, max: 1 },
  horizon: { min: 1, max: 504 }, // trading days
  seed: { min: 0, max: 4294967295 },
  name: 40, // characters
};

/* ---------- the normal distribution ---------- */
const SQRT2PI = Math.sqrt(2 * Math.PI);
/** Standard normal distribution function to within 1e-15 (Hart's approximation as given by West 2005, with a continued fraction in the tails). */
export function normCdf(x) {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  let c = 0;
  if (a <= 37) {
    const e = Math.exp(-a * a / 2);
    if (a < 4) {
      let n = 3.52624965998911e-2 * a + 0.700383064443688;
      n = n * a + 6.37396220353165; n = n * a + 33.912866078383; n = n * a + 112.079291497871;
      n = n * a + 221.213596169931; n = n * a + 220.206867912376;
      let d = 8.83883476483184e-2 * a + 1.75566716318264;
      d = d * a + 16.064177579207; d = d * a + 86.7807322029461; d = d * a + 296.564248779674;
      d = d * a + 637.333633378831; d = d * a + 793.826512519948; d = d * a + 440.413735824752;
      c = (e * n) / d;
    } else {
      let b = a;
      for (let k = 40; k >= 1; k--) b = a + k / b;
      c = e / b / SQRT2PI;
    }
  }
  return x > 0 ? 1 - c : c;
}
export const normPdf = (x) => Math.exp(-x * x / 2) / SQRT2PI;
/** Inverse of normCdf by bisection: slow next to a rational approximation, and called rarely. Within 1e-14 of the
 * true quantile for the confidences offered here (up to 99.9%); beyond 99.99% the 1 - p of normCdf loses figures. */
export function normInv(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  let lo = -40, hi = 40;
  for (let i = 0; i < 200 && hi - lo > 1e-15; i++) { const m = (lo + hi) / 2; if (normCdf(m) < p) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/* ---------- symmetric matrices ---------- */
/** Eigenvalues (ascending) and eigenvectors (columns of vectors) of a symmetric matrix, by cyclic Jacobi rotations. */
export function eigenSym(A) {
  const n = A.length;
  const a = A.map((r) => [...r]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0, diag = 0;
    for (let p = 0; p < n; p++) { diag += a[p][p] ** 2; for (let q = p + 1; q < n; q++) off += a[p][q] ** 2; }
    if (off <= 1e-30 * Math.max(1, diag)) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (a[p][q] === 0) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < n; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = c * x - s * y; v[k][q] = s * x + c * y; }
    }
  }
  const order = a.map((_, i) => i).sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map((i) => a[i][i]), vectors: v.map((row) => order.map((i) => row[i])) };
}
const minEigen = (R) => eigenSym(R).values[0];
const EIG_TOL = 1e-10; // a matrix whose smallest eigenvalue is above -1e-10 counts as positive semidefinite

/** A copy of R with entries (i, j) and (j, i) set to x. */
const withEntry = (R, i, j, x) => R.map((row, a) => row.map((v, b) => ((a === i && b === j) || (a === j && b === i) ? x : v)));

/**
 * Is R a correlation matrix: symmetric, ones on the diagonal, entries in [-1, 1], positive semidefinite?
 * When it is not positive semidefinite, says for each pair how far that one correlation alone would have to move,
 * with all the others held as they are, for the matrix to become valid (the smallest eigenvalue is concave in each
 * entry, so the values that work form one interval, possibly empty).
 */
export function checkCorrelation(R) {
  const n = R.length;
  for (let i = 0; i < n; i++) {
    if (R[i].length !== n || R[i][i] !== 1) return { ok: false, reason: "shape" };
    for (let j = 0; j < n; j++) if (!(Math.abs(R[i][j]) <= 1) || R[i][j] !== R[j][i]) return { ok: false, reason: "entries" };
  }
  const lowest = minEigen(R);
  if (lowest >= -EIG_TOL) return { ok: true, minEigen: lowest };
  const fixes = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const f = (x) => minEigen(withEntry(R, i, j, x));
    // Golden-section search for the x in [-1, 1] that makes the smallest eigenvalue largest.
    let a = -1, b = 1;
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = b - g * (b - a), x2 = a + g * (b - a), f1 = f(x1), f2 = f(x2);
    for (let k = 0; k < 60; k++) {
      if (f1 < f2) { a = x1; x1 = x2; f1 = f2; x2 = a + g * (b - a); f2 = f(x2); }
      else { b = x2; x2 = x1; f2 = f1; x1 = b - g * (b - a); f1 = f(x1); }
    }
    const best = (a + b) / 2;
    if (f(best) < -EIG_TOL) continue; // no value of this one correlation makes the matrix valid
    const edge = (inside, outside) => { // the boundary between a value that works and one that does not
      if (f(outside) >= -EIG_TOL) return outside;
      for (let k = 0; k < 60; k++) { const m = (inside + outside) / 2; if (f(m) >= -EIG_TOL) inside = m; else outside = m; }
      return inside;
    };
    fixes.push({ i, j, current: R[i][j], low: edge(best, -1), high: edge(best, 1) });
  }
  return { ok: false, reason: "not-psd", minEigen: lowest, fixes };
}

/** Project a symmetric matrix onto the positive semidefinite cone (negative eigenvalues set to zero). */
function projectPsd(M) {
  const { values, vectors } = eigenSym(M);
  const n = M.length;
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    let s = 0;
    for (let k = 0; k < n; k++) s += vectors[i][k] * Math.max(values[k], 0) * vectors[j][k];
    return s;
  }));
}

/**
 * The nearest correlation matrix to R in the Frobenius norm: Higham's (2002) alternating projections with
 * Dykstra's correction. With `decimals`, the answer is also rounded and, if rounding broke it, pulled towards the
 * identity in small steps until the rounded matrix is valid.
 */
export function nearestCorrelation(R, { decimals = null, tol = 1e-12, maxIter = 5000 } = {}) {
  const n = R.length;
  let Y = R.map((r) => [...r]);
  let dS = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let it = 0; it < maxIter; it++) {
    const Rk = Y.map((row, i) => row.map((v, j) => v - dS[i][j]));
    const X = projectPsd(Rk);
    dS = X.map((row, i) => row.map((v, j) => v - Rk[i][j]));
    const next = X.map((row, i) => row.map((v, j) => (i === j ? 1 : (v + X[j][i]) / 2)));
    let diff = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) diff = Math.max(diff, Math.abs(next[i][j] - Y[i][j]));
    Y = next;
    if (diff < tol) break;
  }
  if (decimals == null) return Y;
  const f = 10 ** decimals;
  for (let k = 0; k <= 200; k++) {
    const w = k * 0.001;
    const C = Y.map((row, i) => row.map((v, j) => (i === j ? 1 : Math.round(((1 - w) * v) * f) / f)));
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) C[i][j] = C[j][i];
    if (checkCorrelation(C).ok) return C;
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/** A matrix L with L L' = R, from the eigenvalues (so it works for singular matrices, such as a correlation of 1). */
export function factor(R) {
  const { values, vectors } = eigenSym(R);
  return vectors.map((row) => row.map((v, k) => v * Math.sqrt(Math.max(values[k], 0))));
}

/* ---------- inputs ---------- */
/**
 * Check holdings typed by the visitor: [{ name, amount, mu, sigma }] with mu and sigma in % a year, and the
 * correlation matrix. Returns { ok, holdings (decimals), R, errors: [{ where, index, message }] }.
 */
export function readPortfolio(rows, R) {
  const errors = [];
  if (!rows.length) errors.push({ where: "holdings", message: "Add at least one holding." });
  if (rows.length > MAX_HOLDINGS) errors.push({ where: "holdings", message: `At most ${MAX_HOLDINGS} holdings.` });
  const holdings = rows.map((r, i) => {
    const name = String(r.name ?? "").trim() || `Holding ${i + 1}`;
    const num = (v) => (typeof v === "number" ? v : NaN);
    const check = (key, label, lim, unit) => {
      const v = num(r[key]);
      if (!Number.isFinite(v)) errors.push({ where: key, index: i, message: `Enter a number for the ${label} of ${name}.` });
      else if (v < lim.min || v > lim.max) errors.push({ where: key, index: i, message: `The ${label} of ${name} must be between ${lim.min.toLocaleString("en-GB")}${unit} and ${lim.max.toLocaleString("en-GB")}${unit}.` });
      return v;
    };
    if (String(r.name ?? "").length > LIMITS.name) errors.push({ where: "name", index: i, message: `Keep the name of holding ${i + 1} to ${LIMITS.name} characters.` });
    const amount = check("amount", "amount", LIMITS.amount, "");
    const mu = check("mu", "expected return", LIMITS.mu, "%");
    const sigma = check("sigma", "volatility", LIMITS.sigma, "%");
    return { name, amount, mu: mu / 100, sigma: sigma / 100 };
  });
  if (rows.length && !errors.length && holdings.every((h) => h.amount === 0)) errors.push({ where: "holdings", message: "Every amount is zero: put money in at least one holding." });
  const n = rows.length;
  if (!Array.isArray(R) || R.length !== n) errors.push({ where: "corr", message: "The correlations do not match the holdings." });
  else for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const v = R[i][j];
    if (typeof v !== "number" || !Number.isFinite(v) || v < -1 || v > 1) errors.push({ where: "corr", i, j, message: `The correlation of ${holdings[i].name} with ${holdings[j].name} must be a number from -1 to 1.` });
  }
  return { ok: !errors.length, holdings, R, errors };
}

/* ---------- the closed form for normal returns ---------- */
/**
 * Arithmetic Brownian motion: holding i is worth V_i (1 + mu_i t + sigma_i W_i(t)). The gain over h years is then
 * exactly normal, with mean m = h sum V_i mu_i and variance s^2 = h sum_ij V_i V_j sigma_i sigma_j rho_ij.
 */
export function normalMoments(holdings, R, days) {
  const h = days / TRADING_DAYS;
  let m = 0, v = 0;
  holdings.forEach((a, i) => {
    m += a.amount * a.mu * h;
    holdings.forEach((b, j) => { v += a.amount * b.amount * a.sigma * b.sigma * R[i][j] * h; });
  });
  return { mean: m, sd: Math.sqrt(Math.max(v, 0)) };
}

/** VaR, expected shortfall and the chance of losing at least `loss`, all for a normal gain with these moments. */
export function normalRisk({ mean, sd }, conf, loss = null) {
  const z = normInv(conf);
  const out = { var: -mean + sd * z, es: sd > 0 ? -mean + (sd * normPdf(z)) / (1 - conf) : -mean };
  if (loss != null) out.lossProb = sd > 0 ? normCdf((-loss - mean) / sd) : (-mean >= loss ? 1 : 0);
  return out;
}

/**
 * One holding under geometric Brownian motion has closed forms too. Its log return X over h years is normal with
 * mean (mu - sigma^2/2) h and standard deviation sigma sqrt(h), and the loss is V (1 - e^X), so
 * VaR = V (1 - e^(m + s z)) with z the (1 - conf) point, ES = V - V e^(mu h) N(z - s) / (1 - conf), and the chance
 * of losing at least L is N((ln(1 - L/V) - m) / s) for L below V (and zero from V up: a holding cannot lose more than itself).
 */
export function lognormalRisk({ amount, mu, sigma }, days, conf, loss = null) {
  const h = days / TRADING_DAYS, m = (mu - sigma * sigma / 2) * h, s = sigma * Math.sqrt(h);
  const z = normInv(1 - conf);
  const out = s > 0
    ? { var: amount * (1 - Math.exp(m + s * z)), es: amount - (amount * Math.exp(mu * h) * normCdf(z - s)) / (1 - conf) }
    : { var: amount * (1 - Math.exp(m)), es: amount * (1 - Math.exp(m)) };
  if (loss != null) {
    if (loss >= amount) out.lossProb = 0;
    else out.lossProb = s > 0 ? normCdf((Math.log(1 - loss / amount) - m) / s) : (amount * (1 - Math.exp(m)) >= loss ? 1 : 0);
  }
  return out;
}
export const lognormalVar = (amount, mu, sigma, days, conf) => lognormalRisk({ amount, mu, sigma }, days, conf).var;

/* ---------- the simulation ---------- */
/**
 * Simulate n futures of the portfolio over `days` trading days, from rng(seed).
 * model "normal": holding i is worth V_i (1 + mu_i t + sigma_i W_i(t)) (arithmetic Brownian motion);
 * model "lognormal": V_i exp((mu_i - sigma_i^2 / 2) t + sigma_i W_i(t)) (geometric Brownian motion, never below zero).
 * W is a correlated Brownian motion, W(t) = L B(t) with L L' = R. Each future is sampled at `steps` evenly spaced
 * times; the increments are exact, so the end point does not depend on how many steps are kept.
 * Returns { run(budget), done, n, steps, times, values (Float32Array, n x (steps+1)), gain (Float64Array), negative }.
 * run(k) simulates up to k more futures and returns how many are done; call it until done === n.
 */
export function createSimulation({ holdings, R, days, n, seed, model = "normal" }) {
  const A = holdings.length;
  const steps = Math.min(days, MAX_STEPS);
  const h = days / TRADING_DAYS, dt = h / steps, root = Math.sqrt(dt);
  const L = factor(R);
  const r = rng(seed);
  const values = new Float32Array(n * (steps + 1));
  const gain = new Float64Array(n);
  const start = holdings.reduce((s, x) => s + x.amount, 0);
  let spare = null;
  const normal = () => { // Box-Muller, both values used
    if (spare !== null) { const z = spare; spare = null; return z; }
    let u = 0;
    while (u === 0) u = r();
    const rad = Math.sqrt(-2 * Math.log(u)), ang = 2 * Math.PI * r();
    spare = rad * Math.sin(ang);
    return rad * Math.cos(ang);
  };
  const W = new Float64Array(A), e = new Float64Array(A);
  const sim = { n, steps, start, done: 0, negative: 0, times: Array.from({ length: steps + 1 }, (_, k) => (k * days) / steps), values, gain };
  sim.run = (budget) => {
    const end = Math.min(n, sim.done + budget);
    for (let f = sim.done; f < end; f++) {
      W.fill(0);
      values[f * (steps + 1)] = start;
      let total = start, below = false;
      for (let k = 1; k <= steps; k++) {
        for (let i = 0; i < A; i++) e[i] = normal();
        for (let i = 0; i < A; i++) { let s = 0; for (let j = 0; j < A; j++) s += L[i][j] * e[j]; W[i] += root * s; }
        const t = k * dt;
        total = 0;
        for (let i = 0; i < A; i++) {
          const x = holdings[i];
          const v = model === "lognormal" ? x.amount * Math.exp((x.mu - x.sigma * x.sigma / 2) * t + x.sigma * W[i]) : x.amount * (1 + x.mu * t + x.sigma * W[i]);
          if (k === steps && v < 0) below = true;
          total += v;
        }
        values[f * (steps + 1) + k] = total;
      }
      gain[f] = total - start;
      if (below) sim.negative++;
    }
    sim.done = end;
    return end;
  };
  return sim;
}

/* ---------- risk from a sample ---------- */
const Z95 = 1.959963984540054; // the 97.5% point of the normal distribution, for 95% intervals
/** Futures needed beyond the VaR before an interval is given: 10 for VaR, 50 for ES (see sampleRisk). */
export const TAIL_MIN = { var: 10, es: 50 };

/**
 * Value at risk and expected shortfall at confidence `conf` from simulated gains (losses are minus gains), with
 * 95% Monte Carlo intervals: for VaR from the order statistics (no assumption about the distribution), for ES
 * from its asymptotic standard error, [Var(L | L > VaR) + conf (ES - VaR)^2] / (n (1 - conf)).
 * VaR is the ceil(n conf)-th smallest loss; ES is the Acerbi-Tasche average of the worst (1 - conf) of outcomes.
 * The ES interval is a large-sample one: in a coverage experiment with normal and lognormal losses it held the true
 * ES about 90% of the time with 10 futures beyond the VaR, 93% with 20 to 25 and 94% with 50 to 100, so it is
 * given only from 50 on, and the interface calls it approximate.
 */
export function sampleRisk(gains, conf) {
  const n = gains.length;
  const L = Float64Array.from(gains, (g) => -g).sort();
  const k = Math.min(n, Math.max(1, Math.ceil(n * conf - 1e-9))); // 1-based rank of the VaR
  const VaR = L[k - 1];
  let tail = 0;
  for (let i = k; i < n; i++) tail += L[i];
  const p = 1 - conf;
  const es = ((k / n - conf) * VaR + tail / n) / p;
  const out = { n, var: VaR, es, tailCount: n - k };
  if (n * p >= TAIL_MIN.var - 1e-9) {
    const spread = Z95 * Math.sqrt(n * conf * p);
    const lo = Math.max(1, Math.floor(n * conf - spread)), hi = Math.min(n, Math.ceil(n * conf + spread));
    out.varLow = L[lo - 1];
    out.varHigh = L[hi - 1];
  }
  if (n * p >= TAIL_MIN.es - 1e-9) {
    let m = 0, c = 0;
    for (let i = k; i < n; i++) { m += L[i]; c++; }
    m = c ? m / c : VaR;
    let v = 0;
    for (let i = k; i < n; i++) v += (L[i] - m) ** 2;
    v = c > 1 ? v / (c - 1) : 0;
    const se = Math.sqrt((v + conf * (es - VaR) ** 2) / (n * p));
    out.esLow = es - Z95 * se;
    out.esHigh = es + Z95 * se;
    out.esSe = se;
  }
  return out;
}

/** Share of futures that lose at least `loss`, with a 95% Wilson interval. */
export function lossShare(gains, loss) {
  const n = gains.length;
  let k = 0;
  for (const g of gains) if (-g >= loss) k++;
  const p = k / n, z = Z95, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { count: k, n, share: p, low: k === 0 ? 0 : Math.max(0, centre - half), high: k === n ? 1 : Math.min(1, centre + half) };
}

/**
 * Quantiles of the portfolio value at kept time k across the first `count` futures (all of them by default),
 * for the fan chart. One column at a time, so the interface can spread the sorting over several slices.
 */
export function fanColumn(sim, k, count = sim.done, qs = [0.05, 0.25, 0.5, 0.75, 0.95]) {
  const { steps, values } = sim;
  const col = new Float32Array(count);
  for (let f = 0; f < count; f++) col[f] = values[f * (steps + 1) + k];
  col.sort();
  return { t: sim.times[k], q: qs.map((q) => { const pos = (count - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return col[lo] + (col[hi] - col[lo]) * (pos - lo); }) };
}
export const fan = (sim, count = sim.done) => sim.times.map((_, k) => fanColumn(sim, k, count));
