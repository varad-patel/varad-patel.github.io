import test from "node:test";
import assert from "node:assert/strict";
import { linalg } from "../kit/kit.js";
import {
  ARELLANO, LIMITS, readParams, tauchen, stationary, utility, equivalent, debtGrid, createSolver, solve, decide,
  spreadOf, boundary, monotoneInIncome, pricesFallWithDebt, bellmanResidual, nearestState, simulate, longRun,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// The benchmark solution is used by several tests: solve it once.
const base = solve(ARELLANO);

test("Tauchen's chain: rows add to one, the grid spans three deviations, and the chain keeps the AR(1)'s moments", () => {
  const { z, P } = tauchen(21, 0.945, 0.025);
  const sz = 0.025 / Math.sqrt(1 - 0.945 ** 2);
  close(z[0], -3 * sz, 1e-12);
  close(z[20], 3 * sz, 1e-12);
  close(z[10], 0, 1e-12);
  for (const row of P) close(row.reduce((a, b) => a + b, 0), 1, 1e-12);
  // Symmetric: the chance of moving from i to j equals that of moving from -i to -j.
  for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) close(P[i][j], P[20 - i][20 - j], 1e-7);
  const pi = stationary(P);
  close(pi.reduce((a, b) => a + b, 0), 1, 1e-12);
  // Mean zero, and an unconditional spread and autocorrelation close to the process's own (a coarse grid widens them a little).
  const mean = pi.reduce((s, p, i) => s + p * z[i], 0);
  const v = pi.reduce((s, p, i) => s + p * z[i] ** 2, 0);
  const ac = pi.reduce((s, p, i) => s + p * z[i] * P[i].reduce((t, pij, j) => t + pij * z[j], 0), 0) / v;
  close(mean, 0, 1e-10);
  close(Math.sqrt(v) / sz, 1, 0.1);
  close(ac, 0.945, 0.01);
  // Hand case: rho 0 and two states one deviation apart: each row is the normal split at zero, half and half.
  const two = tauchen(2, 0, 0.1, 1);
  close(two.P[0][0], 0.5, 1e-7);
  close(two.P[1][1], 0.5, 1e-7);
  assert.deepEqual(tauchen(5, 0.9, 0).P, [[1]]);
});

test("utility, its inverse for a steady stream, and the annual spread, by hand", () => {
  close(utility(2)(0.5), -2, 1e-15);
  close(utility(1)(Math.E), 1, 1e-15);
  close(utility(3)(2), 2 ** -2 / -2, 1e-15);
  assert.equal(utility(2)(0), -Infinity);
  assert.equal(utility(3)(-1), -Infinity);
  // A steady 0.9 a quarter for ever is worth u(0.9) / (1 - beta); the inverse gives 0.9 back.
  for (const sigma of [1, 2, 3.5]) close(equivalent(utility(sigma)(0.9) / (1 - 0.953), sigma, 0.953), 0.9, 1e-12);
  // q = 0.97 a quarter: (1/0.97)^4 - 1.017^4.
  close(spreadOf(0.97, 0.017), 1 / 0.97 ** 4 - 1.017 ** 4, 1e-15);
  close(spreadOf(1 / 1.017, 0.017), 0, 1e-14);
  assert.equal(spreadOf(0, 0.017), Infinity);
});

test("the debt grid has zero on it and even steps", () => {
  const g = debtGrid(0.4, 160, 40);
  assert.equal(g.d.length, 201);
  assert.equal(g.d[g.zero], 0);
  close(g.d[200], 0.4, 1e-12);
  close(g.d[0], -0.1, 1e-12);
  close(g.step, 0.0025, 1e-15);
});

test("parameters are checked against their limits", () => {
  assert.ok(readParams(ARELLANO).ok);
  const bad = readParams({ ...ARELLANO, beta: 1.2, eta: "x", theta: "" });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.key).sort(), ["beta", "eta", "theta"]);
  for (const [key, lim] of Object.entries(LIMITS)) {
    const at = key === "beta" ? { ...ARELLANO, r: 0.002 } : ARELLANO; // the largest discount factor needs a low rate
    assert.ok(readParams({ ...at, [key]: lim.min }).ok, `${key} at its minimum`);
    assert.ok(readParams({ ...at, [key]: lim.max }).ok, `${key} at its maximum`);
    assert.equal(readParams({ ...at, [key]: lim.max + 1e-9 }).ok, false);
    assert.equal(readParams({ ...at, [key]: lim.min - 1e-9 }).ok, false);
  }
  // A government as patient as its lenders, beta (1 + r) >= 1, is refused with a message that names the bound.
  const patient = readParams({ ...ARELLANO, beta: 0.99 });
  assert.equal(patient.ok, false);
  assert.match(patient.errors[0].message, /below 0\.983/);
  assert.ok(readParams({ ...ARELLANO, beta: 0.983 }).ok);
});

test("the benchmark converges, satisfies the Bellman equations, and needs no wider grid", () => {
  assert.ok(base.converged);
  assert.equal(base.grows, 0);
  assert.equal(base.gridShort, false);
  assert.ok(base.change < 1e-7);
  assert.ok(base.iter < 400, `took ${base.iter} iterations`);
  // One more application of the Bellman operator moves the values by no more than the stopping tolerance allows.
  assert.ok(bellmanResidual(base) < 1e-6, `residual ${bellmanResidual(base)}`);
});

test("default sets grow with debt and shrink with income, and prices fall with debt (Arellano's properties)", () => {
  const b = boundary(base);
  assert.ok(b.monotone);
  assert.ok(monotoneInIncome(base));
  assert.ok(pricesFallWithDebt(base));
  // Never a default with savings or no debt, and saving is priced at the risk-free rate.
  for (let i = 0; i < base.ny; i++) for (let j = 0; j <= base.zero; j++) {
    assert.equal(base.D[i * base.nd + j], 0);
    close(base.q[i * base.nd + j], 1 / 1.017, 1e-15);
  }
  // The boundary rises with income.
  const firsts = b.first.map((j) => (j === null ? Infinity : j));
  for (let i = 1; i < firsts.length; i++) assert.ok(firsts[i] >= firsts[i - 1]);
});

test("with independent shocks, no output cost and permanent exclusion, default is likelier the lower the income", () => {
  // The case of Arellano's proposition: rho 0, h(y) = y (a ceiling above every income), theta 0.
  const s = solve({ ...ARELLANO, rho: 0, theta: 0, yhat: 2 }, { ny: 11 });
  assert.ok(s.converged);
  assert.ok(monotoneInIncome(s));
  assert.ok(boundary(s).monotone);
  assert.ok(boundary(s).first.some((j) => j !== null), "some debt is defaulted on");
});

test("permanent exclusion: the value of default is the autarky value (I - beta P)^-1 u(h), solved directly", () => {
  const p = { ...ARELLANO, theta: 0 };
  const s = solve(p, { ny: 7 });
  assert.ok(s.converged);
  const u = utility(2);
  const A = s.P.map((row, i) => row.map((x, j) => (i === j ? 1 : 0) - p.beta * x));
  const vd = linalg.solve(A, s.h.map(u));
  for (let i = 0; i < s.ny; i++) close(s.vd[i], vd[i], 1e-6);
});

test("known answer: with no income risk and permanent exclusion the debt limit is (1 + r)(y - h)/r, to one grid step", () => {
  // Income is 1 for ever and default leaves 0.969 for ever. Rolling over debt b costs r b / (1 + r) a quarter,
  // so repaying beats default exactly while 1 - r b / (1 + r) >= 0.969.
  const p = { ...ARELLANO, theta: 0 };
  const s = solve(p, { chain: { z: [0], P: [[1]] }, dMax: 2.5, nPos: 500, nNeg: 20 });
  assert.ok(s.converged);
  const limit = ((1 + p.r) * (1 - p.yhat)) / p.r; // 1.8545...
  close(limit, 1.854529411764706, 1e-12);
  const first = boundary(s).first[0];
  assert.ok(Math.abs(s.d[first] - limit) <= s.gap + 1e-12, `first default at ${s.d[first]}`);
  // Below the limit lenders are always repaid; at and above it never.
  for (let j = 0; j < s.nd; j++) close(s.q[j], j < first ? 1 / (1 + p.r) : 0, 1e-15);
  // The largest debt repaid can be rolled over for ever with consumption at or above what default leaves.
  assert.ok(1 - (p.r * s.d[first - 1]) / (1 + p.r) >= p.yhat - 1e-12);
});

test("no output cost and quick re-entry: almost no debt can be sustained", () => {
  const s = solve({ ...ARELLANO, yhat: 1 });
  const mid = nearestState(s, 0);
  const firstMid = boundary(s).first[mid];
  // Without an output cost the only penalty is a few quarters out of the market: the limit at trend income falls
  // from a tenth of a quarter's income to under a third of that.
  assert.ok(firstMid !== null);
  assert.ok(s.d[firstMid] < base.d[boundary(base).first[mid]] / 3, `limit ${s.d[firstMid]}`);
});

test("decisions read from the solution: repay small debts at trend income, default on large ones", () => {
  const mid = nearestState(base, 0);
  const small = decide(base, base.zero + 20, mid); // 0.05 of a quarter's income
  assert.equal(small.def, false);
  close(small.c, base.y[mid] - small.debt + small.q * small.next, 1e-15);
  assert.ok(small.vc >= small.vd);
  const big = decide(base, base.zero + 80, mid); // 0.2
  assert.equal(big.def, true);
  assert.ok(big.vd > big.vc);
  close(big.c, base.h[mid], 1e-15);
});

test("simulation follows the policy, and a designed recession can trigger default", () => {
  const mid = nearestState(base, 0);
  const rows = simulate(base, { j0: base.zero + 20, i0: mid, T: 40, seed: 3 });
  assert.equal(rows.length, 40);
  for (let t = 0; t + 1 < rows.length; t++) {
    if (rows[t].state === "repay" && rows[t + 1].state !== "excluded") close(rows[t + 1].debt, rows[t].next, 1e-15);
  }
  // A recession that pushes income about 9% below trend for four quarters, starting with the same debt.
  const low = nearestState(base, Math.log(0.91));
  const path = [mid, mid, low, low, low, low, mid, mid];
  const r2 = simulate(base, { j0: base.zero + 20, i0: mid, path, seed: 1 });
  assert.equal(r2[0].state, "repay");
  assert.ok(r2.some((r) => r.state === "default"));
  assert.equal(r2.find((r) => r.state === "default").t, 2);
});

test("lenders break even in the long run, and defaults happen mostly in recessions (the figures on the page)", () => {
  const lr = longRun(base, { T: 200000, seed: 1 });
  // Lenders price the chance of being repaid: the share actually repaid matches it.
  close(lr.breakEven.repaid, lr.breakEven.priced, 1e-3);
  assert.equal(lr.per100.toFixed(1), "3.4");
  assert.equal((lr.shareBelowTrend * 100).toFixed(0), "98");
  assert.equal(((Math.exp(lr.meanLogYAtDefault) - 1) * 100).toFixed(1), "-8.2");
  assert.equal((lr.meanSpread * 100).toFixed(1), "4.8");
});

test("other histories (seeds 1 to 6) give 3.4 to 3.6 defaults a century and spreads of 4.7 to 4.8 points, as the page says", () => {
  for (let seed = 1; seed <= 6; seed++) {
    const lr = longRun(base, { T: 200000, seed });
    assert.ok(lr.per100 >= 3.35 && lr.per100 < 3.65, `seed ${seed}: ${lr.per100}`);
    assert.ok(lr.meanSpread >= 0.0465 && lr.meanSpread < 0.0485, `seed ${seed}: ${lr.meanSpread}`);
  }
});

test("the long run counts the same history as simulate(), quarter by quarter", () => {
  // longRun keeps running totals instead of rows; recount from simulate() with the same seed.
  for (const params of [ARELLANO, { ...ARELLANO, theta: 0 }]) {
    const s = params === ARELLANO ? base : solve(params, { ny: 11 });
    const lr = longRun(s, { T: 20000, seed: 9, burn: 500 });
    const rows = simulate(s, { j0: s.zero, i0: nearestState(s, 0), T: 20500, seed: 9 }).slice(500);
    assert.equal(lr.defaults, rows.filter((r) => r.state === "default").length);
    close(lr.excludedShare, rows.filter((r) => r.state === "excluded").length / 20000, 1e-15);
    const repay = rows.filter((r) => r.state === "repay");
    close(lr.meanDebt, repay.reduce((a, r) => a + r.debt / s.y[r.i], 0) / repay.length, 1e-12);
    const issued = repay.filter((r) => r.next > 0);
    close(lr.meanSpread, issued.reduce((a, r) => a + r.spread, 0) / issued.length, 1e-12);
  }
});

test("a debt grid too short for the settings is flagged rather than passed off as the model's answer", () => {
  // Impatient, almost riskless and shut out for good after a default: the government would borrow far beyond the grid.
  const s = solve({ ...ARELLANO, beta: 0.8, sigma: 1, r: 0.002, rho: 0, eta: 0.005, yhat: 0.85, theta: 0 });
  assert.equal(s.gridShort, true);
  assert.equal(base.gridShort, false);
});

test("the finding: at trend income the government repays debts below 2.5% of a year's income and defaults from there up", () => {
  const mid = nearestState(base, 0);
  const b = boundary(base);
  // Debt in quarters of trend income; a year's income at trend is 4.
  assert.equal(((base.d[b.first[mid]] / 4) * 100).toFixed(2), "2.50");
  assert.equal(((base.d[b.first[mid] - 1] / 4) * 100).toFixed(2), "2.44"); // the largest debt repaid
  assert.equal(decide(base, b.first[mid] - 1, mid).def, false);
  assert.equal(decide(base, b.first[mid], mid).def, true);
  const below = nearestState(base, base.z[mid - 1]);
  assert.equal(((base.d[b.first[below]] / 4) * 100).toFixed(2), "1.25");
  assert.equal(((Math.exp(base.z[below]) - 1) * 100).toFixed(1), "-2.3"); // as the page shows it
});

test("a solver can be stepped in slices and gives the same answer", () => {
  const s = createSolver(ARELLANO);
  while (!s.done) s.step(7);
  assert.equal(s.iter, base.iter);
  for (let k = 0; k < s.vc.length; k += 97) assert.equal(s.vc[k], base.vc[k]);
});
