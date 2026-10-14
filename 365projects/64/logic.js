// Day 64: Portfolio Optimiser. The model, with no DOM code.
// Mean-variance optimisation over the shared monthly returns: the quadratic programme
//   minimise 1/2 w'Sw - tau mu'w  subject to  sum w = 1  and  lo <= w <= hi
// solved exactly by a primal active-set method, the efficient frontier traced by tau, and the weights' sensitivity
// to the estimated means.

import { stats, linalg } from "../kit/kit.js";
import { ASSETS } from "../data/assets.js";

export const ALL = ASSETS.assets;
export const T = ASSETS.months;
export const BILLS = ALL.find((a) => a.id === "bills");
const [Y0, M0] = ASSETS.first.split("-").map(Number);
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (i) => { const k = M0 - 1 + i; return `${NAMES[((k % 12) + 12) % 12]} ${Y0 + Math.floor(k / 12)}`; };
/** Index of January of `year` in the return arrays, clamped to the data. */
export const startOfYear = (year) => Math.max(0, (year - Y0) * 12 + (1 - M0));
/** Index of December of `year`, clamped to the data. */
export const endOfYear = (year) => Math.min(T - 1, (year - Y0) * 12 + (12 - M0));
export const MIN_MONTHS = 36;

/**
 * Annualised estimates over months from..to: mu = 12 x mean monthly return, S = 12 x the sample covariance of monthly
 * returns (dividing by T - 1), and the standard error of each mean, sd / sqrt(years).
 */
export function estimate(ids, from, to) {
  const assets = ids.map((id) => ALL.find((a) => a.id === id));
  const R = assets.map((a) => a.returns.slice(from, to + 1));
  const months = to - from + 1;
  const mu = R.map((r) => 12 * stats.mean(r));
  const S = R.map((a) => R.map((b) => 12 * stats.cov(a, b)));
  const sd = S.map((row, i) => Math.sqrt(row[i]));
  const se = sd.map((s) => s / Math.sqrt(months / 12));
  const rf = 12 * stats.mean(BILLS.returns.slice(from, to + 1));
  return { ids, assets, R, months, mu, S, sd, se, rf };
}

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const mul = (S, w) => S.map((row) => dot(row, w));
export const portVar = (S, w) => dot(w, mul(S, w));
export const portVol = (S, w) => Math.sqrt(Math.max(0, portVar(S, w)));

/** Can weights between lo and hi add up to 1? */
export function feasible(lo, hi) {
  const a = stats.sum(lo), b = stats.sum(hi);
  return lo.every((l, i) => l <= hi[i]) && a <= 1 + 1e-12 && b >= 1 - 1e-12;
}

/**
 * Exact solution of  min 1/2 w'Sw - c'w  s.t.  sum w = 1, lo <= w <= hi, for S positive definite, by the primal
 * active-set method (Nocedal and Wright, Numerical Optimization, algorithm 16.3). Each step solves the equality-
 * constrained problem on the variables not held at a bound; a step that would cross a bound stops at it and holds that
 * variable there; when no step is needed, a held variable whose multiplier has the wrong sign is released. The problem
 * is strictly convex, so the point where every multiplier has the right sign is the unique optimum.
 * Returns { w, nu, iterations } or { infeasible: true }.
 */
export function solveQP(S, c, lo, hi) {
  const n = c.length;
  if (!feasible(lo, hi)) return { infeasible: true };
  // A feasible start: everything at its lower bound, then fill up to 1 in order.
  const w = [...lo];
  let rest = 1 - stats.sum(lo);
  for (let i = 0; i < n && rest > 0; i++) { const add = Math.min(hi[i] - lo[i], rest); w[i] += add; rest -= add; }
  const held = new Array(n).fill(0); // 0 free, -1 held at lo, +1 held at hi
  for (let iter = 1; iter <= 50 * n + 100; iter++) {
    const F = [], W = [];
    for (let i = 0; i < n; i++) (held[i] ? W : F).push(i);
    // Equality-constrained minimiser over the free variables: [S_FF -1; 1' 0] [x; nu] = [c_F - S_FW w_W; 1 - sum w_W].
    const k = F.length;
    const A = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
    const rhs = new Array(k + 1).fill(0);
    let fixed = 0;
    for (const j of W) fixed += w[j];
    F.forEach((i, a) => {
      F.forEach((j, b) => { A[a][b] = S[i][j]; });
      A[a][k] = -1;
      A[k][a] = 1;
      let r = c[i];
      for (const j of W) r -= S[i][j] * w[j];
      rhs[a] = r;
    });
    rhs[k] = 1 - fixed;
    const sol = linalg.solve(A, rhs);
    const nu = sol[k];
    let step = 0;
    for (let a = 0; a < k; a++) step = Math.max(step, Math.abs(sol[a] - w[F[a]]));
    if (step < 1e-15) {
      // Stationary on this working set: check the multipliers of the held bounds.
      const g = mul(S, w).map((v, i) => v - c[i] - nu);
      let worst = -1e-13, release = -1;
      for (const j of W) {
        const lambda = held[j] < 0 ? g[j] : -g[j];
        if (lambda < worst) { worst = lambda; release = j; }
      }
      if (release < 0) return { w, nu, iterations: iter };
      held[release] = 0;
      continue;
    }
    // Move towards the minimiser, stopping at the first bound in the way.
    let alpha = 1, block = -1, side = 0;
    for (let a = 0; a < k; a++) {
      const i = F[a], p = sol[a] - w[i];
      if (p < 0 && w[i] + p < lo[i]) { const s = (lo[i] - w[i]) / p; if (s < alpha) { alpha = s; block = i; side = -1; } }
      if (p > 0 && w[i] + p > hi[i]) { const s = (hi[i] - w[i]) / p; if (s < alpha) { alpha = s; block = i; side = 1; } }
    }
    for (let a = 0; a < k; a++) w[F[a]] += alpha * (sol[a] - w[F[a]]);
    if (block >= 0 && k > 1) { held[block] = side; w[block] = side < 0 ? lo[block] : hi[block]; }
  }
  throw new Error("the quadratic programme did not converge");
}

/** The optimum for risk tolerance tau (tau = 0 is the minimum-variance portfolio). */
export function optimum(S, mu, lo, hi, tau) {
  const r = solveQP(S, mu.map((m) => tau * m), lo, hi);
  if (r.infeasible) return r;
  return { ...r, tau, ret: dot(r.w, mu), vol: portVol(S, r.w) };
}

const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);

/**
 * The two ends of the efficient frontier under the constraints: the minimum-variance portfolio (tau = 0) and the
 * highest-return portfolio, reached when doubling tau no longer changes the weights.
 */
export function ends(S, mu, lo, hi) {
  const low = optimum(S, mu, lo, hi, 0);
  if (low.infeasible) return low;
  let tau = 1e-3, a = optimum(S, mu, lo, hi, tau), b = optimum(S, mu, lo, hi, 2 * tau);
  while (!same(a.w, b.w) && tau < 2 ** 40) { tau *= 2; a = b; b = optimum(S, mu, lo, hi, 2 * tau); }
  return { low, high: b, tauMax: 2 * tau, bounded: tau < 2 ** 40 };
}

/**
 * The efficient portfolio with volatility `target` (the highest expected return at that volatility), found by
 * bisection on tau: volatility rises with tau, so the bracket halves until volatility matches to 1e-12.
 * Below the minimum-variance portfolio's volatility the minimum-variance portfolio is returned (flag "below"); above
 * the highest-return portfolio's, that portfolio (flag "above").
 */
export function atVolatility(S, mu, lo, hi, target, end = ends(S, mu, lo, hi)) {
  if (end.infeasible) return end;
  if (target <= end.low.vol) return { ...end.low, flag: "below" };
  if (target >= end.high.vol) return { ...end.high, flag: "above" };
  let a = 0, b = end.tauMax, best = end.high;
  for (let k = 0; k < 200 && b - a > 1e-15 * Math.max(1, b); k++) {
    const m = (a + b) / 2, p = optimum(S, mu, lo, hi, m);
    if (p.vol < target) a = m; else { b = m; best = p; }
    if (Math.abs(p.vol - target) < 1e-12) { best = p; break; }
  }
  return { ...best, flag: "" };
}

/** Points along the frontier from the minimum-variance end to the highest-return end. */
export function frontier(S, mu, lo, hi, end = ends(S, mu, lo, hi), count = 60) {
  if (end.infeasible) return [];
  const pts = [end.low];
  const lo10 = Math.log(1e-4), hi10 = Math.log(end.tauMax);
  for (let k = 0; k < count; k++) pts.push(optimum(S, mu, lo, hi, Math.exp(lo10 + ((hi10 - lo10) * k) / (count - 1))));
  pts.push(end.high);
  pts.sort((p, q) => p.vol - q.vol);
  return pts.filter((p, i) => i === 0 || p.vol - pts[i - 1].vol > 1e-9 || p.ret - pts[i - 1].ret > 1e-9);
}

/** Half the sum of absolute weight differences: the share of the portfolio that would have to change hands. */
export const distance = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / 2;

/**
 * How the portfolio at volatility `target` changes when one asset's expected return moves by `shifts` standard errors.
 * Returns, for each asset i, the weights at each shift.
 */
export function sensitivity(est, lo, hi, target, shifts = [-1, 1]) {
  return est.mu.map((_, i) => shifts.map((s) => {
    const mu = est.mu.map((m, j) => (j === i ? m + s * est.se[j] : m));
    return { shift: s, ...atVolatility(est.S, mu, lo, hi, target) };
  }));
}

/** Closed form with only the budget constraint: w = tau S^-1 mu + ((1 - tau 1'S^-1 mu) / (1'S^-1 1)) S^-1 1. */
export function closedForm(S, mu, tau) {
  const inv = linalg.inverse(S);
  const a = mul(inv, mu), b = mul(inv, mu.map(() => 1));
  const sa = stats.sum(a), sb = stats.sum(b);
  return a.map((v, i) => tau * v + ((1 - tau * sa) / sb) * b[i]);
}
