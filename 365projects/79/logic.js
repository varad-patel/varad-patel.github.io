// Day 79: Sovereign Default Simulator. The model, with no DOM code.
// The Eaton-Gersovitz (1981) model as quantified by Arellano (2008): a government borrows abroad with one-quarter
// bonds, cannot commit to repay, and defaults whenever repaying is worth less to its citizens than default.
// Solved by value-function iteration on a grid, updating the bond prices at every step.

import { rng, stats } from "../kit/kit.js";

/** Arellano's (2008) calibration for Argentina, quarterly. */
export const ARELLANO = { beta: 0.953, sigma: 2, r: 0.017, rho: 0.945, eta: 0.025, theta: 0.282, yhat: 0.969 };

/** What each parameter may be. Sliders keep to these; readParams refuses anything else. */
export const LIMITS = {
  beta: { min: 0.8, max: 0.99, label: "discount factor" },
  sigma: { min: 1, max: 5, label: "risk aversion" },
  r: { min: 0.002, max: 0.04, label: "risk-free rate" },
  rho: { min: 0, max: 0.98, label: "income persistence" },
  eta: { min: 0.005, max: 0.06, label: "income volatility" },
  theta: { min: 0, max: 1, label: "chance of regaining market access" },
  yhat: { min: 0.85, max: 1, label: "income ceiling in default" },
};

/** Grid: 21 income states (as Arellano) and debt points 0.0025 apart at the start, a quarter of them for saving. */
export const GRID = { ny: 21, nPos: 160, nNeg: 40, dMax: 0.4, m: 3, tol: 1e-7, maxIter: 3000, grow: 1.5, maxGrow: 4 };

/** Check a parameter set. Returns { ok, params, errors: [{ key, message }] }. */
export function readParams(raw) {
  const errors = [];
  const params = {};
  for (const [key, lim] of Object.entries(LIMITS)) {
    const v = Number(raw[key]);
    if (raw[key] === "" || raw[key] == null || !Number.isFinite(v) || v < lim.min || v > lim.max) errors.push({ key, message: `The ${lim.label} must be between ${lim.min} and ${lim.max}.` });
    else params[key] = v;
  }
  // A government as patient as its lenders would save without limit instead of borrowing (Arellano assumes beta (1 + r) < 1).
  if (!errors.length && params.beta * (1 + params.r) >= 1) errors.push({ key: "beta", message: `With a risk-free rate of ${(params.r * 100).toFixed(1)}% a quarter the discount factor must be below ${(Math.floor(1000 / (1 + params.r)) / 1000).toFixed(3)}: a government as patient as its lenders would save rather than borrow.` });
  return { ok: !errors.length, params, errors };
}

/**
 * Tauchen's (1986) discretisation of log y' = rho log y + eta e, e ~ N(0, 1): n states spread evenly over
 * m unconditional standard deviations either side of zero, and transition probabilities from the normal
 * distribution of the shock over the half-way points. Returns { z, P } with z the log incomes.
 */
export function tauchen(n, rho, eta, m = 3) {
  if (n === 1 || eta === 0) return { z: [0], P: [[1]] };
  const sz = eta / Math.sqrt(1 - rho * rho);
  const top = m * sz;
  const w = (2 * top) / (n - 1);
  const z = Array.from({ length: n }, (_, i) => -top + i * w);
  const P = z.map((zi) => {
    // Differences of one distribution function along the row, so each row adds up to exactly one.
    const cut = [0, ...z.slice(0, -1).map((zj) => stats.normalCdf((zj + w / 2 - rho * zi) / eta)), 1];
    return z.map((_, j) => Math.max(0, cut[j + 1] - cut[j]));
  });
  return { z, P };
}

/** Long-run distribution of a Markov chain, by repeated multiplication. */
export function stationary(P) {
  const n = P.length;
  let pi = new Array(n).fill(1 / n);
  for (let it = 0; it < 100000; it++) {
    const next = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) next[j] += pi[i] * P[i][j];
    let diff = 0;
    for (let j = 0; j < n; j++) diff = Math.max(diff, Math.abs(next[j] - pi[j]));
    pi = next;
    if (diff < 1e-15) break;
  }
  return pi;
}

/** Period utility, c^(1 - sigma) / (1 - sigma), or log c when sigma is 1. Minus infinity at or below zero. */
export function utility(sigma) {
  if (sigma === 1) return (c) => (c > 0 ? Math.log(c) : -Infinity);
  if (sigma === 2) return (c) => (c > 0 ? -1 / c : -Infinity);
  const a = 1 - sigma;
  // Half-integer risk aversion (the slider's values) by multiplication and a square root: the solver calls this
  // up to a million times an iteration, and exp(a log c) is about twenty times slower.
  if (Number.isInteger(2 * sigma)) {
    const k = Math.floor(sigma - 1), half = sigma - 1 - k === 0.5;
    return (c) => {
      if (!(c > 0)) return -Infinity;
      let p = 1;
      for (let n = 0; n < k; n++) p *= c;
      return (half ? 1 / (p * Math.sqrt(c)) : 1 / p) / a;
    };
  }
  return (c) => (c > 0 ? Math.exp(a * Math.log(c)) / a : -Infinity);
}

/** The steady consumption a quarter, for ever, that is worth the value v: u(c) / (1 - beta) = v. */
export function equivalent(v, sigma, beta) {
  if (!Number.isFinite(v)) return 0;
  const flow = v * (1 - beta);
  if (sigma === 1) return Math.exp(flow);
  const x = flow * (1 - sigma);
  return x > 0 ? x ** (1 / (1 - sigma)) : 0;
}

/** Debt grid: nNeg points of saving, zero, then nPos points of debt up to dMax. Debt is in quarters of trend income. */
export function debtGrid(dMax, nPos = GRID.nPos, nNeg = GRID.nNeg) {
  const step = dMax / nPos;
  return { d: Array.from({ length: nNeg + nPos + 1 }, (_, i) => (i - nNeg) * step), zero: nNeg, step };
}

/**
 * The solver. step(k) runs up to k iterations; done is true once the values have converged (largest change below
 * tol and no default decision changed) or maxIter is reached. When the debt grid turns out too short (in some state
 * the government would borrow as much as the grid allows) the solver widens it and starts again, up to maxGrow times.
 * The model can be given its own income chain { z, P } (used by the tests).
 */
export function createSolver(params, opts = {}) {
  const o = { ...GRID, ...opts };
  const { beta, sigma, r, rho, eta, theta, yhat } = params;
  const chain = o.chain || tauchen(o.ny, rho, eta, o.m);
  const ny = chain.z.length;
  const y = chain.z.map(Math.exp);
  const pi = stationary(chain.P);
  const meanY = pi.reduce((s, p, i) => s + p * y[i], 0);
  const h = y.map((v) => Math.min(yhat * meanY, v));
  const u = utility(sigma);
  const P = chain.P;
  const s = { params, ny, y, z: chain.z, P, pi, meanY, h, iter: 0, done: false, converged: false, grows: 0, change: Infinity, totalIter: 0 };

  function setup(dMax) {
    const g = debtGrid(dMax, o.nPos, o.nNeg);
    const nd = g.d.length;
    Object.assign(s, {
      d: g.d, zero: g.zero, gap: g.step, nd, dMax,
      vc: new Float64Array(ny * nd), vd: new Float64Array(ny), q: new Float64Array(ny * nd).fill(1 / (1 + r)),
      D: new Uint8Array(ny * nd), pol: new Int32Array(ny * nd), iter: 0, change: Infinity,
    });
    // Start from the value of consuming the income for ever: close to the answer, so fewer iterations.
    for (let i = 0; i < ny; i++) {
      s.vd[i] = u(h[i]) / (1 - beta);
      for (let j = 0; j < nd; j++) s.vc[i * nd + j] = u(Math.max(1e-6, y[i] - r * Math.max(0, g.d[j]))) / (1 - beta);
    }
  }
  setup(o.dMax);

  function iterate() {
    const { nd, d, vc, vd, q, D, pol } = s;
    // 1. Defaults and prices from the current values.
    let flips = 0;
    for (let i = 0; i < ny; i++) for (let j = 0; j < nd; j++) {
      const k = i * nd + j;
      const def = vd[i] > vc[k] ? 1 : 0;
      if (def !== D[k]) { flips++; D[k] = def; }
    }
    for (let i = 0; i < ny; i++) for (let j = 0; j < nd; j++) {
      let pd = 0;
      for (let k = 0; k < ny; k++) if (D[k * nd + j]) pd += P[i][k];
      q[i * nd + j] = Math.max(0, 1 - pd) / (1 + r);
    }
    // 2. Expected values next quarter.
    const ev = s.ev && s.ev.length === ny * nd ? s.ev : (s.ev = new Float64Array(ny * nd));
    for (let i = 0; i < ny; i++) for (let j = 0; j < nd; j++) {
      let e = 0;
      for (let k = 0; k < ny; k++) { const a = vc[k * nd + j], b = vd[k]; e += P[i][k] * (a > b ? a : b); }
      ev[i * nd + j] = e;
    }
    // 3. The value of default: autarky this quarter, then market access again with probability theta.
    const vdNew = new Float64Array(ny);
    for (let i = 0; i < ny; i++) {
      let e = 0;
      for (let k = 0; k < ny; k++) { const back = Math.max(vc[k * nd + s.zero], vd[k]); e += P[i][k] * (theta * back + (1 - theta) * vd[k]); }
      vdNew[i] = u(h[i]) + beta * e;
    }
    // 4. The value of repaying: the best new debt given what lenders pay for it.
    let change = 0;
    const rev = new Float64Array(nd), wv = new Float64Array(nd);
    for (let i = 0; i < ny; i++) {
      for (let jj = 0; jj < nd; jj++) { rev[jj] = q[i * nd + jj] * d[jj]; wv[jj] = beta * ev[i * nd + jj]; }
      // A debt lenders pay nothing for raises nothing now and is worth no more next quarter than no debt at all
      // (values fall with debt), so the search stops at the last debt with a positive price. The answer is the same.
      let last = s.zero;
      for (let jj = s.zero; jj < nd && q[i * nd + jj] > 0; jj++) last = jj;
      // The new debt chosen never falls as the debt carried in rises (the gain from raising more money is larger when
      // consumption is lower, since u is concave), and ties go to the smaller debt. So the debts carried in are
      // solved middle first, and each half searches only the choices on its side of the middle's choice: binary
      // monotonicity, which gives the same answer as searching every choice in about a tenth of the time.
      // A state where no choice is feasible takes the top of its range, which keeps the choices in order.
      const stack = [[0, nd - 1, 0, last]];
      while (stack.length) {
        const [jLo, jHi, kLo, kHi] = stack.pop();
        if (jLo > jHi) continue;
        const j = (jLo + jHi) >> 1;
        const base = y[i] - d[j];
        let best = -Infinity, arg = kHi;
        for (let jj = kLo; jj <= kHi; jj++) {
          const c = base + rev[jj];
          if (c <= 0) continue;
          const val = u(c) + wv[jj];
          if (val > best) { best = val; arg = jj; }
        }
        const k = i * nd + j;
        const old = vc[k];
        const diff = Number.isFinite(best) && Number.isFinite(old) ? Math.abs(best - old) : best === old ? 0 : Infinity;
        if (diff > change) change = diff;
        vc[k] = best;
        pol[k] = arg;
        stack.push([jLo, j - 1, kLo, arg], [j + 1, jHi, arg, kHi]);
      }
    }
    for (let i = 0; i < ny; i++) { change = Math.max(change, Math.abs(vdNew[i] - vd[i])); vd[i] = vdNew[i]; }
    s.iter++; s.totalIter++;
    s.change = change;
    s.flips = flips;
    return change < o.tol && flips === 0;
  }

  function finish() {
    // Refresh defaults and prices from the final values, so they belong to the values reported.
    const { nd, vc, vd, q, D } = s;
    for (let i = 0; i < ny; i++) for (let j = 0; j < nd; j++) D[i * nd + j] = vd[i] > vc[i * nd + j] ? 1 : 0;
    for (let i = 0; i < ny; i++) for (let j = 0; j < nd; j++) {
      let pd = 0;
      for (let k = 0; k < ny; k++) if (D[k * nd + j]) pd += P[i][k];
      q[i * nd + j] = Math.max(0, 1 - pd) / (1 + r);
    }
  }

  s.step = (k = 1) => {
    for (let n = 0; n < k && !s.done; n++) {
      const ok = iterate();
      if (ok || s.iter >= o.maxIter) {
        finish();
        // A grid that is too short: in some state the government would borrow as much as the grid allows.
        const top = s.nd - 1;
        let short = false;
        for (let k = 0; k < ny * s.nd; k++) if (!s.D[k] && s.pol[k] >= top - 1) short = true;
        if (ok && short && s.grows < o.maxGrow) { s.grows++; setup(s.dMax * o.grow); continue; }
        s.done = true;
        s.converged = ok;
        s.gridShort = short;
      }
    }
    return s;
  };
  return s;
}

/** Solve to the end (tests and small grids). */
export function solve(params, opts) {
  const s = createSolver(params, opts);
  while (!s.done) s.step(50);
  return s;
}

/** The decision at debt index j and income index i. */
export function decide(s, j, i) {
  const k = i * s.nd + j;
  const def = Boolean(s.D[k]);
  const r = s.params.r;
  const u = utility(s.params.sigma);
  const out = { def, vc: s.vc[k], vd: s.vd[i], debt: s.d[j], income: s.y[i] };
  if (def) return { ...out, c: s.h[i] };
  const jj = s.pol[k];
  const q = s.q[i * s.nd + jj];
  const next = s.d[jj];
  const c = s.y[i] - s.d[j] + q * next;
  return { ...out, next, q, c, repayChance: q * (1 + r), spread: spreadOf(q, r), util: u(c) };
}

/** Annual spread over the risk-free rate, in shares: (1/q)^4 - (1 + r)^4. Infinity when q is zero. */
export const spreadOf = (q, r) => (q > 0 ? (1 / q) ** 4 - (1 + r) ** 4 : Infinity);

/**
 * Smallest debt index at which the government defaults, for each income state (null if it repays everything on
 * the grid), and whether the default sets are monotone: default at some debt implies default at every larger debt.
 */
export function boundary(s) {
  const out = [];
  let monotone = true;
  for (let i = 0; i < s.ny; i++) {
    let first = null;
    for (let j = 0; j < s.nd; j++) {
      const def = s.D[i * s.nd + j];
      if (def && first === null) first = j;
      if (!def && first !== null) monotone = false;
    }
    out.push(first);
  }
  return { first: out, monotone };
}

/** Default sets shrink as income rises: if the government defaults at income i on debt j, it also does at every lower income. */
export function monotoneInIncome(s) {
  for (let j = 0; j < s.nd; j++) {
    let seenRepay = false;
    for (let i = 0; i < s.ny; i++) {
      const def = s.D[i * s.nd + j];
      if (!def) seenRepay = true;
      else if (seenRepay) return false;
    }
  }
  return true;
}

/** Bond prices never rise with the amount borrowed. */
export function pricesFallWithDebt(s) {
  for (let i = 0; i < s.ny; i++) for (let j = 1; j < s.nd; j++) if (s.q[i * s.nd + j] > s.q[i * s.nd + j - 1] + 1e-15) return false;
  return true;
}

/** Largest gap between the values and one more application of the Bellman operator (should be about tol). */
export function bellmanResidual(s) {
  const { beta, theta } = s.params;
  const u = utility(s.params.sigma);
  const { nd, ny, d, vc, vd, q, P, y, h } = s;
  const vo = (k, j) => Math.max(vc[k * nd + j], vd[k]);
  let worst = 0;
  for (let i = 0; i < ny; i++) {
    let e = 0;
    for (let k = 0; k < ny; k++) e += P[i][k] * (theta * vo(k, s.zero) + (1 - theta) * vd[k]);
    worst = Math.max(worst, Math.abs(u(h[i]) + beta * e - vd[i]));
    for (let j = 0; j < nd; j++) {
      let best = -Infinity;
      for (let jj = 0; jj < nd; jj++) {
        const c = y[i] - d[j] + q[i * nd + jj] * d[jj];
        if (c <= 0) continue;
        let ev = 0;
        for (let k = 0; k < ny; k++) ev += P[i][k] * vo(k, jj);
        best = Math.max(best, u(c) + beta * ev);
      }
      const a = vc[i * nd + j];
      if (Number.isFinite(a) || Number.isFinite(best)) worst = Math.max(worst, Math.abs(best - a));
    }
  }
  return worst;
}

/** Nearest income state to a log income. */
export const nearestState = (s, logy) => s.z.reduce((b, z, i) => (Math.abs(z - logy) < Math.abs(s.z[b] - logy) ? i : b), 0);

/** Draw the next income state from row i of the chain. */
function draw(P, i, u) {
  let c = 0;
  const row = P[i];
  for (let k = 0; k < row.length; k++) { c += row[k]; if (u < c) return k; }
  return row.length - 1;
}

/**
 * Follow the government for T quarters from debt index j0 and income index i0. Income follows the chain, or the
 * visitor's path of income states when `path` is given (its length sets T). Re-entry after default is drawn with
 * probability theta from the seeded generator. Each quarter records the income, the debt carried in, the decision,
 * the new debt, its price and consumption.
 */
export function simulate(s, { j0, i0, T, seed = 1, path = null }) {
  const R = rng(seed);
  const { theta, r } = s.params;
  const n = path ? path.length : T;
  const rows = [];
  let i = path ? path[0] : i0, j = j0, excluded = false;
  for (let t = 0; t < n; t++) {
    if (t > 0) i = path ? path[t] : draw(s.P, i, R());
    // Re-entry is decided at the start of the quarter, before the income is seen to matter.
    if (excluded && t > 0 && R() < theta) { excluded = false; j = s.zero; }
    if (excluded) { rows.push({ t, i, debt: 0, state: "excluded", c: s.h[i], next: 0 }); continue; }
    const k = i * s.nd + j;
    if (s.D[k]) {
      rows.push({ t, i, debt: s.d[j], state: "default", c: s.h[i], next: 0 });
      excluded = true;
      j = s.zero;
      continue;
    }
    const jj = s.pol[k];
    const q = s.q[i * s.nd + jj];
    rows.push({ t, i, debt: s.d[j], state: "repay", c: s.y[i] - s.d[j] + q * s.d[jj], next: s.d[jj], q, spread: s.d[jj] > 0 ? spreadOf(q, r) : 0 });
    j = jj;
  }
  return rows;
}

/**
 * Long-run statistics from one long simulation started at zero debt and trend income: defaults per 100 years,
 * the share of time excluded, mean debt and spread while in the market, and the income at each default.
 * Also checks the lenders' break-even condition: across the quarters with new debt, the share repaid the next
 * quarter is compared with the average of q(1 + r).
 */
export function longRun(s, { T = 200000, seed = 1, burn = 1000 } = {}) {
  // The same history as simulate() with the same draws in the same order, but kept as running totals rather than
  // 200,000 row objects: building the rows kept the page busy for about 100 ms after every solve.
  const R = rng(seed);
  const { theta, r } = s.params;
  const { nd, zero, d, D, pol, q: Q, P, y, z } = s;
  let i = nearestState(s, 0), j = zero, excluded = false;
  let defaults = 0, excl = 0, market = 0, debtSum = 0, spreadSum = 0, spreadN = 0;
  const atDefault = [];
  let issued = 0, repaidNext = 0, priced = 0, firstDefault = null;
  let pending = -1; // the price q (1 + r) of new debt issued last quarter, -1 when none
  for (let t = 0; t < T + burn; t++) {
    if (t > 0) i = draw(P, i, R());
    if (excluded && t > 0 && R() < theta) { excluded = false; j = zero; }
    const kept = t >= burn;
    let state;
    if (excluded) state = 0;
    else if (D[i * nd + j]) { state = 1; excluded = true; }
    else state = 2;
    // Lenders' check: new debt issued last quarter is repaid if this quarter is not a default.
    if (kept && pending >= 0) { issued++; priced += pending; if (state === 2) repaidNext++; }
    pending = -1;
    if (state === 0) { if (kept) excl++; continue; }
    if (state === 1) {
      if (kept) { defaults++; atDefault.push(z[i]); if (firstDefault === null) firstDefault = t - burn + 1; }
      j = zero;
      continue;
    }
    const jj = pol[i * nd + j];
    if (kept) {
      market++;
      debtSum += d[j] / y[i];
      if (d[jj] > 0) {
        const q = Q[i * nd + jj];
        spreadSum += spreadOf(q, r); spreadN++;
        pending = q * (1 + r);
      }
    }
    j = jj;
  }
  const quarters = T;
  return {
    quarters,
    defaults,
    firstDefault, // counted from 1, after the quarters left out
    per100: defaults / (quarters / 400),
    excludedShare: excl / quarters,
    meanDebt: market ? debtSum / market : 0, // in quarters of current income
    meanSpread: spreadN ? spreadSum / spreadN : 0,
    meanLogYAtDefault: atDefault.length ? stats.mean(atDefault) : null,
    shareBelowTrend: atDefault.length ? atDefault.filter((z) => z < -1e-12).length / atDefault.length : null,
    breakEven: issued ? { issued, repaid: repaidNext / issued, priced: priced / issued } : null,
  };
}
