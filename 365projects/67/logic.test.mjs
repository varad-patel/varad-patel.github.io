import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  TRADING_DAYS, LIMITS, normCdf, normPdf, normInv, eigenSym, checkCorrelation, nearestCorrelation, factor, readPortfolio,
  normalMoments, normalRisk, lognormalVar, lognormalRisk, createSimulation, sampleRisk, lossShare, fan, fanColumn, TAIL_MIN,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const simulate = (spec) => { const s = createSimulation(spec); while (s.done < s.n) s.run(5000); return s; };
const EXAMPLE = {
  holdings: [
    { name: "Shares", amount: 60000, mu: 0.07, sigma: 0.18 },
    { name: "Bonds", amount: 30000, mu: 0.035, sigma: 0.06 },
    { name: "Gold", amount: 10000, mu: 0.04, sigma: 0.15 },
  ],
  R: [[1, 0.1, 0.1], [0.1, 1, 0.3], [0.1, 0.3, 1]],
};

test("normal quantiles: 1.6449, 1.9600, 2.3263 and 3.0902, and the inverse undoes the distribution function", () => {
  assert.equal(normInv(0.95).toFixed(4), "1.6449");
  assert.equal(normInv(0.975).toFixed(4), "1.9600");
  assert.equal(normInv(0.99).toFixed(4), "2.3263");
  assert.equal(normInv(0.999).toFixed(4), "3.0902");
  for (const p of [1e-10, 0.001, 0.2, 0.5, 0.8, 0.9999]) close(normCdf(normInv(p)), p, 1e-14);
  close(normCdf(-1.96), 0.024997895148220435, 1e-15); // Python: 0.5 * erfc(1.96 / sqrt 2)
  assert.equal(normInv(0), -Infinity);
  assert.ok(Number.isNaN(normInv(1.5)));
  close(normPdf(0), 0.3989422804014327, 1e-16);
});

test("eigen-decomposition rebuilds the matrix and finds known eigenvalues", () => {
  // [[2, 1], [1, 2]] has eigenvalues 1 and 3; a 3x3 with eigenvalues 1 - rho (twice) and 1 + 2 rho for equal correlation rho.
  close(eigenSym([[2, 1], [1, 2]]).values[0], 1, 1e-12);
  close(eigenSym([[2, 1], [1, 2]]).values[1], 3, 1e-12);
  const rho = 0.4;
  const e = eigenSym([[1, rho, rho], [rho, 1, rho], [rho, rho, 1]]);
  close(e.values[0], 1 - rho, 1e-12); close(e.values[1], 1 - rho, 1e-12); close(e.values[2], 1 + 2 * rho, 1e-12);
  const A = [[4, 1, -2, 0.5], [1, 3, 0, 1], [-2, 0, 5, -1], [0.5, 1, -1, 2]];
  const { values, vectors } = eigenSym(A);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += vectors[i][k] * values[k] * vectors[j][k];
    close(s, A[i][j], 1e-12);
  }
  // A correlation of exactly 1 is singular but valid, and factor() still gives L L' = R.
  const R = [[1, 1], [1, 1]];
  const L = factor(R);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) close(L[i][0] * L[j][0] + L[i][1] * L[j][1], R[i][j], 1e-12);
});

test("a valid correlation matrix passes the check, and an impossible one says which single change would fix it", () => {
  assert.ok(checkCorrelation(EXAMPLE.R).ok);
  assert.ok(checkCorrelation([[1]]).ok);
  assert.ok(checkCorrelation([[1, 1, 1], [1, 1, 1], [1, 1, 1]]).ok); // all perfectly correlated: singular, valid
  assert.ok(checkCorrelation([[1, -0.5, -0.5], [-0.5, 1, -0.5], [-0.5, -0.5, 1]]).ok); // the most negative three can be
  // A with B 0.9, B with C 0.9, but A with C -0.5: impossible. With the other two fixed, A-C must lie between
  // 0.9 * 0.9 - sqrt(0.19 * 0.19) = 0.62 and 1; the bounds for a three-asset matrix are rho_ab rho_bc +- sqrt((1 - rho_ab^2)(1 - rho_bc^2)).
  const bad = [[1, 0.9, -0.5], [0.9, 1, 0.9], [-0.5, 0.9, 1]];
  const c = checkCorrelation(bad);
  assert.equal(c.ok, false);
  assert.equal(c.reason, "not-psd");
  assert.ok(c.minEigen < 0);
  const ac = c.fixes.find((f) => f.i === 0 && f.j === 2);
  close(ac.low, 0.62, 1e-6);
  close(ac.high, 1, 1e-6);
  // Holding A-C at -0.5, A-B must lie between -0.5 * 0.9 - sqrt(0.75 * 0.19) and -0.5 * 0.9 + sqrt(0.75 * 0.19).
  const ab = c.fixes.find((f) => f.i === 0 && f.j === 1);
  close(ab.low, -0.45 - Math.sqrt(0.75 * 0.19), 1e-6);
  close(ab.high, -0.45 + Math.sqrt(0.75 * 0.19), 1e-6);
  assert.equal(c.fixes.length, 3);
  // Four assets all at -0.5 with one another (smallest eigenvalue 1 + 3 x -0.5 = -0.5): the only single change that
  // works is to make one pair perfectly correlated, which leaves three at -0.5, the most negative three can be.
  const four = [[1, -0.5, -0.5, -0.5], [-0.5, 1, -0.5, -0.5], [-0.5, -0.5, 1, -0.5], [-0.5, -0.5, -0.5, 1]];
  const c4 = checkCorrelation(four);
  assert.equal(c4.ok, false);
  close(c4.minEigen, -0.5, 1e-12);
  assert.equal(c4.fixes.length, 6);
  for (const f of c4.fixes) { close(f.low, 1, 1e-6); close(f.high, 1, 1e-12); }
  // At -0.6 not even that works: three at -0.6 are already impossible. No single change fixes it.
  const c6 = checkCorrelation(four.map((row) => row.map((v) => (v === 1 ? 1 : -0.6))));
  close(c6.minEigen, -0.8, 1e-12);
  assert.equal(c6.fixes.length, 0);
  // Entries out of range or not symmetric.
  assert.equal(checkCorrelation([[1, 1.2], [1.2, 1]]).reason, "entries");
  assert.equal(checkCorrelation([[1, 0.2], [0.3, 1]]).reason, "entries");
});

test("the nearest correlation matrix reproduces Higham's (2002) example", () => {
  // Higham's simple example: ones, with the corner pair set to zero. The R Matrix package's nearPD documents the
  // answer's (1, 2) entry as 0.760689917 and its Frobenius distance from A as 0.52779033, to its tolerance of 1e-7.
  // Exactly: by symmetry the answer is [1 a b; a 1 a; b a 1] on the edge of validity, b = 2a^2 - 1, and minimising
  // 4(1 - a)^2 + 2b^2 gives 4a^3 - a - 1 = 0, so a = 0.76068985340228.
  const A = [[1, 1, 0], [1, 1, 1], [0, 1, 1]];
  const X = nearestCorrelation(A);
  let a = 0.76;
  for (let i = 0; i < 50; i++) a -= (4 * a ** 3 - a - 1) / (12 * a * a - 1);
  close(X[0][1], a, 1e-10);
  close(X[1][2], a, 1e-10);
  close(X[0][2], 2 * a * a - 1, 1e-10);
  close(X[0][1], 0.760689917, 1e-7);
  let f = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) f += (A[i][j] - X[i][j]) ** 2;
  close(Math.sqrt(f), 0.52779033, 2e-7);
  assert.ok(eigenSym(X).values[0] > -1e-10);
  // Rounded to two decimals for the input boxes, it is still a valid correlation matrix.
  const bad = [[1, 0.9, -0.5], [0.9, 1, 0.9], [-0.5, 0.9, 1]];
  const Y = nearestCorrelation(bad, { decimals: 2 });
  assert.ok(checkCorrelation(Y).ok);
  for (const row of Y) for (const v of row) close(Math.round(v * 100) / 100, v, 1e-12);
  const four = nearestCorrelation([[1, -0.5, -0.5, -0.5], [-0.5, 1, -0.5, -0.5], [-0.5, -0.5, 1, -0.5], [-0.5, -0.5, -0.5, 1]], { decimals: 2 });
  assert.ok(checkCorrelation(four).ok);
  // A valid matrix is its own nearest.
  const same = nearestCorrelation(EXAMPLE.R);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(same[i][j], EXAMPLE.R[i][j], 1e-9);
});

test("the closed form for normal returns, worked by hand", () => {
  // One holding of 100,000 with no drift and 20% volatility, ten trading days: s = 100,000 x 0.2 x sqrt(10/252) = 3,984.10.
  const one = normalMoments([{ amount: 100000, mu: 0, sigma: 0.2 }], [[1]], 10);
  close(one.mean, 0, 1e-12);
  close(one.sd, 100000 * 0.2 * Math.sqrt(10 / 252), 1e-9);
  assert.equal(one.sd.toFixed(1), "3984.1");
  const r = normalRisk(one, 0.99, 5000);
  close(r.var, 2.326348 * 3984.0954, 0.01); // z(99%) = 2.326348 by hand from a table
  close(r.es, one.sd * normPdf(normInv(0.99)) / 0.01, 1e-9);
  close(r.es, 2.665214 * 3984.0954, 0.01); // phi(2.326348) / 0.01 = 2.665214
  close(r.lossProb, normCdf(-5000 / one.sd), 1e-15);
  // Two holdings: 60,000 at 18% and 40,000 at 6%, correlation 0.25, a year: variance = 10800^2 + 2400^2 + 2 x 0.25 x 10800 x 2400.
  const two = normalMoments([{ amount: 60000, mu: 0.07, sigma: 0.18 }, { amount: 40000, mu: 0.03, sigma: 0.06 }], [[1, 0.25], [0.25, 1]], 252);
  close(two.mean, 60000 * 0.07 + 40000 * 0.03, 1e-9);
  close(two.sd, Math.sqrt(10800 ** 2 + 2400 ** 2 + 2 * 0.25 * 10800 * 2400), 1e-9);
  // With no volatility at all the loss is certain and VaR equals ES equals minus the expected gain.
  const flat = normalRisk({ mean: 500, sd: 0 }, 0.99, 100);
  assert.equal(flat.var, -500);
  assert.equal(flat.es, -500);
  assert.equal(flat.lossProb, 0);
  assert.equal(normalRisk({ mean: -500, sd: 0 }, 0.99, 100).lossProb, 1);
});

test("sample VaR and ES follow their definitions on small samples", () => {
  // Gains -1..-100: losses 1..100. At 95%: VaR is the 95th smallest loss (95) and ES the mean of the five worst (98).
  const gains = Array.from({ length: 100 }, (_, i) => -(i + 1));
  const s = sampleRisk(gains, 0.95);
  assert.equal(s.var, 95);
  close(s.es, 98, 1e-12);
  assert.equal(s.tailCount, 5);
  assert.equal(s.varLow, undefined); // fewer than 10 in the tail: no error estimate
  // n conf not a whole number: n = 30 at 95% gives rank ceil(28.5) = 29, and ES = ((29/30 - 0.95) x 29 + 30/30) / 0.05.
  const g30 = Array.from({ length: 30 }, (_, i) => -(i + 1));
  const s30 = sampleRisk(g30, 0.95);
  assert.equal(s30.var, 29);
  close(s30.es, ((29 / 30 - 0.95) * 29 + 30 / 30) / 0.05, 1e-12);
  // ES is never below VaR.
  assert.ok(s30.es >= s30.var);
  // A thousand losses 1..1000 at 99%: 10 in the tail, enough for the VaR interval but not for the ES one, which
  // covers the truth only about 90% of the time with so short a tail (see the coverage test below).
  const s1000 = sampleRisk(Array.from({ length: 1000 }, (_, i) => -(i + 1)), 0.99);
  assert.equal(s1000.var, 990);
  close(s1000.es, 995.5, 1e-12);
  assert.ok(s1000.varLow <= 990 && s1000.varHigh >= 990);
  assert.equal(s1000.esLow, undefined);
  assert.equal(TAIL_MIN.es, 50);
  // Five thousand at 99%: 50 in the tail, so the ES interval exists and contains the estimate.
  const s5000 = sampleRisk(Array.from({ length: 5000 }, (_, i) => -(i + 1)), 0.99);
  assert.equal(s5000.tailCount, 50);
  close(s5000.es, 4975.5, 1e-9);
  assert.ok(s5000.esLow < 4975.5 && s5000.esHigh > 4975.5);
  assert.equal(sampleRisk(Array.from({ length: 4999 }, (_, i) => -(i + 1)), 0.99).esLow, undefined);
  const share = lossShare(gains, 50);
  assert.equal(share.count, 51);
  assert.equal(share.share, 0.51);
  assert.ok(share.low < 0.51 && share.high > 0.51);
  assert.deepEqual([lossShare(gains, 1000).share, lossShare(gains, 1000).low], [0, 0]);
});

test("simulated normal returns agree with the closed form within their Monte Carlo error", () => {
  const sim = simulate({ ...EXAMPLE, days: 10, n: 100000, seed: 7, model: "normal" });
  const cf = normalRisk(normalMoments(EXAMPLE.holdings, EXAMPLE.R, 10), 0.99, 5000);
  const s = sampleRisk(sim.gain, 0.99);
  assert.ok(s.varLow <= cf.var && cf.var <= s.varHigh, `VaR ${cf.var} outside ${s.varLow}..${s.varHigh}`);
  assert.ok(s.esLow <= cf.es && cf.es <= s.esHigh, `ES ${cf.es} outside ${s.esLow}..${s.esHigh}`);
  const p = lossShare(sim.gain, 5000);
  assert.ok(p.low <= cf.lossProb && cf.lossProb <= p.high);
  // Mean and spread of the simulated gains.
  let m = 0;
  for (const g of sim.gain) m += g;
  m /= sim.n;
  const mom = normalMoments(EXAMPLE.holdings, EXAMPLE.R, 10);
  close(m, mom.mean, 4 * mom.sd / Math.sqrt(sim.n));
});

test("the 95% Monte Carlo intervals cover the true VaR and ES about 95% of the time", () => {
  const cf = normalRisk(normalMoments(EXAMPLE.holdings, EXAMPLE.R, 10), 0.95);
  let varHits = 0, esHits = 0;
  const runs = 300;
  for (let k = 0; k < runs; k++) {
    const s = sampleRisk(simulate({ ...EXAMPLE, days: 10, n: 2000, seed: 1000 + k, model: "normal" }).gain, 0.95);
    if (s.varLow <= cf.var && cf.var <= s.varHigh) varHits++;
    if (s.esLow <= cf.es && cf.es <= s.esHigh) esHits++;
  }
  // With 300 runs, a true 95% rate gives between 90% and 98% with near certainty.
  assert.ok(varHits / runs > 0.9 && varHits / runs < 0.99, `VaR coverage ${varHits / runs}`);
  assert.ok(esHits / runs > 0.9 && esHits / runs < 0.99, `ES coverage ${esHits / runs}`);
});

test("the large-sample ES interval covers too rarely with 10 futures beyond the VaR, which is why it waits for 50", () => {
  // Normal losses drawn directly; the interval is ES +- 1.96 se with se^2 = [Var(L | L > VaR) + c (ES - VaR)^2] / (n (1 - c)).
  const r = rng(2026);
  const c = 0.99, z = normInv(c), trueEs = normPdf(z) / (1 - c);
  const coverage = (n, runs) => {
    let hits = 0;
    for (let k = 0; k < runs; k++) {
      const L = Float64Array.from({ length: n }, () => r.normal()).sort();
      const j = Math.ceil(n * c - 1e-9), tail = L.subarray(j);
      const es = tail.reduce((s, x) => s + x, 0) / tail.length;
      const v = tail.reduce((s, x) => s + (x - es) ** 2, 0) / (tail.length - 1);
      const se = Math.sqrt((v + c * (es - L[j - 1]) ** 2) / (n * (1 - c)));
      if (Math.abs(es - trueEs) <= 1.959963984540054 * se) hits++;
    }
    return hits / runs;
  };
  const ten = coverage(1000, 1500), fifty = coverage(5000, 800);
  assert.ok(ten > 0.86 && ten < 0.93, `coverage with 10 in the tail ${ten}`);
  assert.ok(fifty > 0.91 && fifty < 0.97, `coverage with 50 in the tail ${fifty}`);
});

test("one holding under geometric Brownian motion matches its lognormal closed form", () => {
  const h = [{ name: "One", amount: 50000, mu: 0.08, sigma: 0.3 }];
  const sim = simulate({ holdings: h, R: [[1]], days: 60, n: 50000, seed: 3, model: "lognormal" });
  const s = sampleRisk(sim.gain, 0.99);
  const exact = lognormalVar(50000, 0.08, 0.3, 60, 0.99);
  assert.ok(s.varLow <= exact && exact <= s.varHigh, `${exact} outside ${s.varLow}..${s.varHigh}`);
  // By hand: m = (0.08 - 0.045) x 60/252 = 0.0083333, s = 0.3 x sqrt(60/252) = 0.146385, z = -2.326348:
  // VaR = 50,000 x (1 - e^(0.0083333 - 0.340542)) = 50,000 x 0.282660 = 14,133.
  close(exact, 50000 * (1 - Math.exp(0.035 * 60 / 252 - 0.3 * Math.sqrt(60 / 252) * 2.3263478740408408)), 1e-6);
  assert.equal(Math.round(exact), 14133);
  const cf = lognormalRisk(h[0], 60, 0.99, 10000);
  assert.ok(s.esLow <= cf.es && cf.es <= s.esHigh, `ES ${cf.es} outside ${s.esLow}..${s.esHigh}`);
  const p = lossShare(sim.gain, 10000);
  assert.ok(p.low <= cf.lossProb && cf.lossProb <= p.high, `${cf.lossProb} outside ${p.low}..${p.high}`);
  assert.equal(lognormalRisk(h[0], 60, 0.99, 50000).lossProb, 0); // cannot lose more than the whole holding
  assert.equal(lognormalRisk(h[0], 60, 0.99, 60000).lossProb, 0);
  // Never below zero under this model, and the expected value grows at mu: E = V e^(mu h).
  assert.equal(sim.negative, 0);
  let m = 0;
  for (const g of sim.gain) m += g;
  m /= sim.n;
  close(m, 50000 * (Math.exp(0.08 * 60 / TRADING_DAYS) - 1), 4 * 50000 * 0.3 * Math.sqrt(60 / 252) / Math.sqrt(sim.n));
});

test("the same seed gives the same futures; the first futures of a long run are those of a short one", () => {
  const a = simulate({ ...EXAMPLE, days: 20, n: 1000, seed: 42, model: "normal" });
  const b = simulate({ ...EXAMPLE, days: 20, n: 1000, seed: 42, model: "normal" });
  assert.deepEqual([...a.gain], [...b.gain]);
  const c = simulate({ ...EXAMPLE, days: 20, n: 5000, seed: 42, model: "normal" });
  assert.deepEqual([...c.gain.slice(0, 1000)], [...a.gain]);
  const d = simulate({ ...EXAMPLE, days: 20, n: 1000, seed: 43, model: "normal" });
  assert.notDeepEqual([...d.gain], [...a.gain]);
  // Slicing the run differently changes nothing.
  const e = createSimulation({ ...EXAMPLE, days: 20, n: 1000, seed: 42, model: "normal" });
  while (e.done < e.n) e.run(7);
  assert.deepEqual([...e.gain], [...a.gain]);
});

test("the fan starts at today's value and spreads out; quantiles are ordered", () => {
  const sim = simulate({ ...EXAMPLE, days: 100, n: 2000, seed: 5, model: "lognormal" });
  assert.equal(sim.steps, 25);
  const f = fan(sim);
  assert.equal(f.length, 26);
  for (const q of f[0].q) close(q, 100000, 1e-6);
  for (const p of f) for (let i = 1; i < p.q.length; i++) assert.ok(p.q[i] >= p.q[i - 1]);
  assert.ok(f[25].q[4] - f[25].q[0] > f[5].q[4] - f[5].q[0]);
  assert.equal(simulate({ ...EXAMPLE, days: 3, n: 10, seed: 1 }).steps, 3);
  // A partial run's fan uses only the futures done so far.
  const part = createSimulation({ ...EXAMPLE, days: 10, n: 1000, seed: 5 });
  part.run(300);
  const col = fanColumn(part, part.steps);
  assert.ok(Number.isFinite(col.q[0]) && col.q[0] > 0);
});

test("perfectly correlated holdings behave as one; a holding with no volatility adds none", () => {
  const two = [{ name: "A", amount: 50000, mu: 0.05, sigma: 0.2 }, { name: "B", amount: 50000, mu: 0.05, sigma: 0.2 }];
  const one = [{ name: "AB", amount: 100000, mu: 0.05, sigma: 0.2 }];
  const a = simulate({ holdings: two, R: [[1, 1], [1, 1]], days: 10, n: 20000, seed: 9, model: "normal" });
  const cfTwo = normalMoments(two, [[1, 1], [1, 1]], 10), cfOne = normalMoments(one, [[1]], 10);
  close(cfTwo.sd, cfOne.sd, 1e-9);
  const s = sampleRisk(a.gain, 0.99);
  const cf = normalRisk(cfOne, 0.99);
  assert.ok(s.varLow <= cf.var && cf.var <= s.varHigh);
  const cash = normalMoments([{ amount: 100000, mu: 0.04, sigma: 0 }], [[1]], 252);
  assert.equal(cash.sd, 0);
  close(cash.mean, 4000, 1e-9);
  const flat = simulate({ holdings: [{ name: "Cash", amount: 100000, mu: 0.04, sigma: 0 }], R: [[1]], days: 252, n: 100, seed: 1 });
  for (const g of flat.gain) close(g, 4000, 1e-6);
  const s0 = sampleRisk(flat.gain, 0.99);
  close(s0.var, -4000, 1e-6);
});

test("the normal model can push a holding below zero, which it counts; the lognormal model cannot", () => {
  const wild = [{ name: "Wild", amount: 1000, mu: 0, sigma: 2 }];
  const n = simulate({ holdings: wild, R: [[1]], days: 252, n: 5000, seed: 2, model: "normal" });
  // P(1 + 2 W(1) < 0) = P(Z < -0.5) = 30.9%.
  close(n.negative / 5000, normCdf(-0.5), 0.03);
  assert.equal(simulate({ holdings: wild, R: [[1]], days: 252, n: 5000, seed: 2, model: "lognormal" }).negative, 0);
});

test("inputs are checked, with messages that name the holding and say what to fix", () => {
  const rows = [{ name: "Shares", amount: 60000, mu: 7, sigma: 18 }, { name: "Bonds", amount: 40000, mu: 3, sigma: 6 }];
  const ok = readPortfolio(rows, [[1, 0.2], [0.2, 1]]);
  assert.ok(ok.ok);
  close(ok.holdings[0].mu, 0.07, 1e-15);
  const bad = readPortfolio([{ name: "Shares", amount: -5, mu: NaN, sigma: 300 }, { name: "x".repeat(41), amount: 1, mu: 1, sigma: 1 }], [[1, 2], [2, 1]]);
  assert.equal(bad.ok, false);
  const text = bad.errors.map((e) => e.message).join(" | ");
  assert.match(text, /The amount of Shares must be between 0 and 1,000,000,000,000/);
  assert.match(text, /Enter a number for the expected return of Shares/);
  assert.match(text, /The volatility of Shares must be between 0% and 200%/);
  assert.match(text, /Keep the name of holding 2 to 40 characters/);
  assert.match(text, /correlation of Shares with .* must be a number from -1 to 1/);
  assert.match(readPortfolio([{ name: "", amount: 0, mu: 1, sigma: 1 }], [[1]]).errors[0].message, /Every amount is zero/);
  assert.equal(readPortfolio([{ name: "", amount: 10, mu: 1, sigma: 1 }], [[1]]).holdings[0].name, "Holding 1");
  assert.match(readPortfolio([], []).errors[0].message, /Add at least one holding/);
  assert.equal(readPortfolio([{ name: "A", amount: 1e308, mu: 1, sigma: 1 }], [[1]]).ok, false);
  assert.equal(LIMITS.name, 40);
});

test("the finding: seed 1, the example portfolio, 10 days at 99%, and how the interval narrows with more futures", () => {
  const p = readPortfolio([{ name: "Shares", amount: 60000, mu: 7, sigma: 18 }, { name: "Bonds", amount: 30000, mu: 3.5, sigma: 6 }, { name: "Gold", amount: 10000, mu: 4, sigma: 15 }], EXAMPLE.R);
  const run = (n) => sampleRisk(simulate({ holdings: p.holdings, R: p.R, days: 10, n, seed: 1, model: "normal" }).gain, 0.99);
  const ten = run(10000);
  assert.equal(Math.round(ten.var), 5127);
  assert.equal(Math.round(ten.varLow), 4964);
  assert.equal(Math.round(ten.varHigh), 5341);
  const cf = normalRisk(normalMoments(p.holdings, p.R, 10), 0.99, 5000);
  assert.equal(Math.round(cf.var), 5077);
  assert.ok(ten.varLow <= cf.var && cf.var <= ten.varHigh);
  const small = run(1000), big = run(100000);
  assert.equal(Math.round(small.varHigh - small.varLow), 1026);
  assert.equal(Math.round(big.varHigh - big.varLow), 101);
  assert.ok(big.varLow <= cf.var && cf.var <= big.varHigh);
});
