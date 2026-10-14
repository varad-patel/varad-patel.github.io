import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats, linalg } from "../kit/kit.js";
import { ASSETS } from "../data/assets.js";
import {
  ALL, T, monthLabel, startOfYear, endOfYear, estimate, solveQP, optimum, ends, atVolatility, frontier, sensitivity,
  closedForm, distance, feasible, portVol,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const closeAll = (a, b, tol = 1e-9) => a.forEach((v, i) => close(v, b[i], tol));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

/** A random positive definite matrix and means. */
function problem(n, seed) {
  const r = rng(seed);
  const A = Array.from({ length: n }, () => Array.from({ length: n }, () => r.normal(0, 0.1)));
  const S = A.map((row, i) => A.map((_, j) => dot(row, A[j]) + (i === j ? 0.002 : 0)));
  const mu = Array.from({ length: n }, () => r.uniform(-0.02, 0.08));
  return { S, mu, r };
}

/**
 * An independent exact solver: try every assignment of each weight to its lower bound, its upper bound or free, solve
 * the KKT equations for the free ones, and keep the assignment whose solution is feasible and whose multipliers all
 * have the right sign. 3^n systems, so only for small n.
 */
function bruteForce(S, c, lo, hi) {
  const n = c.length;
  let found = null;
  const states = new Array(n).fill(0);
  const total = 3 ** n;
  for (let code = 0; code < total; code++) {
    let x = code;
    for (let i = 0; i < n; i++) { states[i] = (x % 3) - 1; x = Math.floor(x / 3); }
    const F = states.map((s, i) => (s === 0 ? i : -1)).filter((i) => i >= 0);
    if (!F.length) continue;
    const w = states.map((s, i) => (s < 0 ? lo[i] : s > 0 ? hi[i] : 0));
    const k = F.length;
    const M = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
    const b = new Array(k + 1).fill(0);
    let fixed = 0;
    for (let i = 0; i < n; i++) if (states[i]) fixed += w[i];
    F.forEach((i, a) => {
      F.forEach((j, q) => { M[a][q] = S[i][j]; });
      M[a][k] = -1; M[k][a] = 1;
      b[a] = c[i] - states.reduce((s, st, j) => s + (st ? S[i][j] * w[j] : 0), 0);
    });
    b[k] = 1 - fixed;
    let sol;
    try { sol = linalg.solve(M, b); } catch { continue; }
    F.forEach((i, a) => { w[i] = sol[a]; });
    const nu = sol[k];
    if (F.some((i) => w[i] < lo[i] - 1e-11 || w[i] > hi[i] + 1e-11)) continue;
    const g = S.map((row, i) => dot(row, w) - c[i] - nu);
    if (states.some((s, i) => (s < 0 && g[i] < -1e-11) || (s > 0 && g[i] > 1e-11))) continue;
    found = w;
    break;
  }
  return found;
}

/* ------------------------------------------------------------------ estimates */

test("estimates: 12 x the monthly mean, 12 x the sample covariance, and the standard error of the mean", () => {
  const e = estimate(["t10", "eur"], 0, T - 1);
  const a = ALL.find((x) => x.id === "t10").returns, b = ALL.find((x) => x.id === "eur").returns;
  let ma = 0, mb = 0;
  for (let t = 0; t < T; t++) { ma += a[t]; mb += b[t]; }
  ma /= T; mb /= T;
  let sab = 0, saa = 0;
  for (let t = 0; t < T; t++) { sab += (a[t] - ma) * (b[t] - mb); saa += (a[t] - ma) ** 2; }
  close(e.mu[0], 12 * ma, 1e-12);
  close(e.mu[1], 12 * mb, 1e-12);
  close(e.S[0][1], (12 * sab) / (T - 1), 1e-12);
  close(e.S[1][0], e.S[0][1], 0);
  close(e.sd[0], Math.sqrt((12 * saa) / (T - 1)), 1e-12);
  close(e.se[0], e.sd[0] / Math.sqrt(T / 12), 1e-12);
  assert.equal(e.months, 332);
  // The page's printed estimates for the full window.
  assert.equal((e.mu[0] * 100).toFixed(2), "3.40");
  assert.equal((e.sd[0] * 100).toFixed(2), "7.50");
  assert.equal((e.se[0] * 100).toFixed(2), "1.43");
});

test("month helpers", () => {
  assert.equal(monthLabel(0), "Feb 1999");
  assert.equal(monthLabel(T - 1), "Sep 2026");
  assert.equal(startOfYear(1999), 0);
  assert.equal(monthLabel(startOfYear(2010)), "Jan 2010");
  assert.equal(monthLabel(endOfYear(2010)), "Dec 2010");
  assert.equal(endOfYear(2026), T - 1);
});

/* ------------------------------------------------------------------ the solver */

test("with loose bounds the solver matches the closed form, for every risk tolerance", () => {
  const { S, mu } = problem(6, 1);
  const lo = new Array(6).fill(-1e6), hi = new Array(6).fill(1e6);
  for (const tau of [0, 0.01, 0.1, 1, 5]) {
    const r = solveQP(S, mu.map((m) => tau * m), lo, hi);
    closeAll(r.w, closedForm(S, mu, tau), 1e-10);
  }
  // tau = 0 is the minimum-variance portfolio, S^-1 1 / (1' S^-1 1).
  const inv = linalg.inverse(S);
  const ones = inv.map((row) => stats.sum(row));
  closeAll(solveQP(S, new Array(6).fill(0), lo, hi).w, ones.map((v) => v / stats.sum(ones)), 1e-10);
});

test("two assets, long only: the clamped closed form", () => {
  const S = [[0.04, 0.006], [0.006, 0.01]], mu = [0.08, 0.03];
  for (const tau of [0, 0.05, 0.2, 0.5, 3]) {
    const free = (S[1][1] - S[0][1] + tau * (mu[0] - mu[1])) / (S[0][0] + S[1][1] - 2 * S[0][1]);
    const w1 = Math.min(1, Math.max(0, free));
    closeAll(solveQP(S, mu.map((m) => tau * m), [0, 0], [1, 1]).w, [w1, 1 - w1], 1e-12);
  }
  // At tau = 0: (0.01 - 0.006) / (0.04 + 0.01 - 0.012) = 0.10526...
  close(optimum(S, mu, [0, 0], [1, 1], 0).w[0], 0.004 / 0.038, 1e-12);
});

test("against an independent brute-force KKT solver on random problems with bounds", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const n = 3 + (seed % 4);
    const { S, mu, r } = problem(n, seed);
    const lo = Array.from({ length: n }, () => (r.bool(0.5) ? 0 : -r.uniform(0, 0.5)));
    const hi = Array.from({ length: n }, () => r.uniform(0.3, 1));
    if (!feasible(lo, hi)) continue;
    const tau = [0, 0.01, 0.1, 1, 10][seed % 5];
    const c = mu.map((m) => tau * m);
    const mine = solveQP(S, c, lo, hi), theirs = bruteForce(S, c, lo, hi);
    assert.ok(theirs, `brute force found nothing for seed ${seed}`);
    closeAll(mine.w, theirs, 1e-10);
  }
});

test("on the real data the solver agrees with the brute-force solver to 1e-10", () => {
  const ids = ["bills", "t5", "t20", "eur", "jpy", "chf", "aud"];
  const e = estimate(ids, 0, T - 1);
  const lo = new Array(7).fill(0), hi = new Array(7).fill(0.6);
  for (const tau of [0, 0.05, 0.2, 1]) {
    const c = e.mu.map((m) => tau * m);
    closeAll(solveQP(e.S, c, lo, hi).w, bruteForce(e.S, c, lo, hi), 1e-10);
  }
  // With short positions down to -50%.
  const lo2 = new Array(7).fill(-0.5), hi2 = new Array(7).fill(1);
  const c = e.mu.map((m) => 0.3 * m);
  closeAll(solveQP(e.S, c, lo2, hi2).w, bruteForce(e.S, c, lo2, hi2), 1e-10);
});

test("bounds that cannot add up to 1 are refused", () => {
  assert.equal(feasible([0, 0, 0], [0.3, 0.3, 0.3]), false);
  assert.equal(solveQP([[1, 0, 0], [0, 1, 0], [0, 0, 1]], [0, 0, 0], [0, 0, 0], [0.3, 0.3, 0.3]).infeasible, true);
  assert.equal(feasible([0.5, 0.6], [1, 1]), false);
  assert.equal(feasible([0, 0, 0], [1 / 3, 1 / 3, 1 / 3]), true);
  // Exactly enough room: every weight at its maximum.
  closeAll(solveQP([[1, 0.2], [0.2, 2]], [0, 0], [0, 0], [0.5, 0.5]).w, [0.5, 0.5], 1e-12);
});

/* ------------------------------------------------------------------ the frontier */

test("the portfolio at a target volatility hits it, and no feasible portfolio at that risk earns more", () => {
  const ids = ["bills", "t2", "t10", "gbp", "chf", "aud"];
  const e = estimate(ids, 0, T - 1);
  const lo = new Array(6).fill(0), hi = new Array(6).fill(1);
  const end = ends(e.S, e.mu, lo, hi);
  const target = 0.05;
  const p = atVolatility(e.S, e.mu, lo, hi, target, end);
  close(p.vol, target, 1e-10);
  // Random long-only portfolios (Dirichlet draws): none with volatility at most 5% earns more.
  const r = rng(9);
  for (let k = 0; k < 20000; k++) {
    const x = ids.map(() => r.exponential());
    const s = stats.sum(x);
    const w = x.map((v) => v / s);
    if (portVol(e.S, w) <= target) assert.ok(dot(w, e.mu) <= p.ret + 1e-12, `portfolio ${w} beats the frontier`);
  }
  // Below the minimum-variance end and above the highest-return end the ends are returned and flagged.
  assert.equal(atVolatility(e.S, e.mu, lo, hi, 0.001, end).flag, "below");
  assert.equal(atVolatility(e.S, e.mu, lo, hi, 0.5, end).flag, "above");
  // Long only, the highest-return end is all in the asset with the highest estimated return.
  const best = e.mu.indexOf(Math.max(...e.mu));
  close(end.high.w[best], 1, 1e-12);
});

test("along the frontier both volatility and expected return rise", () => {
  const e = estimate(ALL.map((a) => a.id), 0, T - 1);
  const n = e.mu.length;
  const f = frontier(e.S, e.mu, new Array(n).fill(0), new Array(n).fill(1));
  assert.ok(f.length > 20);
  for (let i = 1; i < f.length; i++) {
    assert.ok(f[i].vol >= f[i - 1].vol - 1e-12);
    assert.ok(f[i].ret >= f[i - 1].ret - 1e-12);
  }
});

test("distance between portfolios is half the sum of absolute differences", () => {
  close(distance([0.5, 0.5, 0], [0, 0.5, 0.5]), 0.5);
  close(distance([1, 0], [1, 0]), 0);
});

/* ------------------------------------------------------------------ the page's numbers */

test("the finding: all eleven assets, long only, 4% volatility, 1999 to 2026", () => {
  const e = estimate(ALL.map((a) => a.id), 0, T - 1);
  const n = e.mu.length;
  const lo = new Array(n).fill(0), hi = new Array(n).fill(1);
  const p = atVolatility(e.S, e.mu, lo, hi, 0.04);
  const pct = (x) => (x * 100).toFixed(1);
  const at = (id) => p.w[e.ids.indexOf(id)];
  assert.equal(pct(at("t2")), "59.2");
  assert.equal(pct(at("t20")), "15.3");
  assert.equal(pct(at("aud")), "25.5");
  assert.equal((p.ret * 100).toFixed(2), "3.25");
  // Raise the 5-year Treasury's expected return by one standard error (0.82 points a year).
  const s = sensitivity(e, lo, hi, 0.04);
  const i5 = e.ids.indexOf("t5");
  assert.equal((e.se[i5] * 100).toFixed(2), "0.82");
  assert.equal(pct(s[i5][1].w[i5]), "79.1");
  assert.equal(pct(distance(p.w, s[i5][1].w)), "84.1");
  // The largest change any one-standard-error move makes.
  let worst = 0;
  s.forEach((pair) => pair.forEach((q) => { worst = Math.max(worst, distance(p.w, q.w)); }));
  assert.equal(pct(worst), "84.1");
});
