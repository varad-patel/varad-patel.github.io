import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { MARKETS } from "./data.js";
import {
  monthAt, changes, forward, backward, posteriors, baumWelchStep, baumWelch, finish, fitHmm, sortByVolatility, startingModels,
  parameterCount, durations, stationary, argmaxRows, runs, disagreement, realTimeSteps,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const market = (id) => MARKETS.series.find((s) => s.id === id);
const npdf = (x, m, s) => Math.exp(-0.5 * ((x - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI));

/* ---------------------------------------------------------------- data */

test("data: five monthly series, values as the sources publish them", () => {
  assert.deepEqual(MARKETS.series.map((s) => s.id), ["ust10", "gold", "brent", "copper", "btc"]);
  const ust = market("ust10");
  assert.equal(ust.start, "1953-04");
  assert.equal(ust.values[0], 2.83);                                   // H.15, April 1953
  assert.equal(ust.values.at(-1), 4.99);                               // September 2026
  assert.equal(monthAt(ust.start, ust.values.length - 1), "2026-09");
  assert.equal(market("gold").values[0], 176);                         // Pink Sheet, January 1975
  assert.equal(market("brent").values.at(-1), 116.8);                  // Pink Sheet, September 2026
  assert.equal(market("copper").values[0], 1626);                      // Pink Sheet, January 1970
  assert.equal(monthAt(market("btc").start, market("btc").values.length - 1), "2026-04");
  for (const s of MARKETS.series) assert.ok(s.values.every((v) => Number.isFinite(v) && (s.kind === "yield" || v > 0)), s.id);
});

test("changes: percentage-point changes for the yield, log returns in percent for prices", () => {
  close(changes({ kind: "yield", values: [2, 2.5, 2.25] })[1], -0.25);
  const r = changes({ kind: "price", values: [100, 110] });
  close(r[0], 100 * Math.log(1.1));
  assert.equal(monthAt("1999-11", 3), "2000-02");
});

/* ---------------------------------------------------------------- hand-computed small case */

// Two regimes, three months. Every quantity is checked against brute-force enumeration of the 8 regime paths.
const tiny = { K: 2, pi: [0.6, 0.4], A: [[0.7, 0.3], [0.2, 0.8]], mu: [0, 2], sd: [1, 1.5] };
const tx = Float64Array.of(0.1, 1.8, -0.5);
function enumerate(model, x) {
  const paths = [];
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    const s = [a, b, c];
    let p = model.pi[a];
    for (let t = 0; t < 3; t++) { if (t) p *= model.A[s[t - 1]][s[t]]; p *= npdf(x[t], model.mu[s[t]], model.sd[s[t]]); }
    paths.push({ s, p });
  }
  return paths;
}

test("hand case: the forward recursion's likelihood equals the sum over all eight paths", () => {
  const paths = enumerate(tiny, tx);
  const L = paths.reduce((a, q) => a + q.p, 0);
  const f = forward(tx, tiny);
  close(f.ll, Math.log(L), 1e-12);
  // The first filtered probability by hand: pi_k b_k(x_1) normalised.
  const a0 = 0.6 * npdf(0.1, 0, 1), a1 = 0.4 * npdf(0.1, 2, 1.5);
  close(f.alpha[0], a0 / (a0 + a1), 1e-12);
  // Filtered probability at the last month equals the smoothed one there.
  const g = posteriors(tx, tiny).gamma;
  close(f.alpha[2 * 2 + 1], g[2 * 2 + 1], 1e-12);
});

test("hand case: smoothed probabilities and expected transitions equal the enumerated ones", () => {
  const paths = enumerate(tiny, tx);
  const L = paths.reduce((a, q) => a + q.p, 0);
  const { gamma, xi } = posteriors(tx, tiny);
  for (let t = 0; t < 3; t++) for (let k = 0; k < 2; k++) {
    close(gamma[t * 2 + k], paths.filter((q) => q.s[t] === k).reduce((a, q) => a + q.p, 0) / L, 1e-12);
  }
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    let e = 0;
    for (const q of paths) for (let t = 0; t < 2; t++) if (q.s[t] === i && q.s[t + 1] === j) e += q.p / L;
    close(xi[i][j], e, 1e-12);
  }
  // The scaled backward variable at the last month is 1.
  const f = forward(tx, tiny);
  const beta = backward(tx, tiny, f.c);
  close(beta[4], 1); close(beta[5], 1);
});

test("hand case: one Baum-Welch step gives the textbook re-estimates", () => {
  const paths = enumerate(tiny, tx);
  const L = paths.reduce((a, q) => a + q.p, 0);
  const g = (t, k) => paths.filter((q) => q.s[t] === k).reduce((a, q) => a + q.p, 0) / L;
  const { model } = baumWelchStep(tx, tiny);
  for (let k = 0; k < 2; k++) {
    const w = [0, 1, 2].reduce((a, t) => a + g(t, k), 0);
    const mu = [0, 1, 2].reduce((a, t) => a + g(t, k) * tx[t], 0) / w;
    const v = [0, 1, 2].reduce((a, t) => a + g(t, k) * (tx[t] - mu) ** 2, 0) / w;
    close(model.mu[k], mu, 1e-12);
    close(model.sd[k], Math.sqrt(v), 1e-12);
    close(model.pi[k], g(0, k), 1e-12);
    const out = g(0, k) + g(1, k);
    for (let j = 0; j < 2; j++) {
      let e = 0;
      for (const q of paths) for (let t = 0; t < 2; t++) if (q.s[t] === k && q.s[t + 1] === j) e += q.p / L;
      close(model.A[k][j], e / out, 1e-12);
    }
  }
});

test("Baum-Welch never lowers the likelihood", () => {
  const rand = rng(4);
  const x = Float64Array.from({ length: 300 }, (_, t) => rand.normal(0, t % 50 < 25 ? 1 : 3));
  const fit = baumWelch(x, { K: 2, pi: [0.5, 0.5], A: [[0.9, 0.1], [0.1, 0.9]], mu: [0, 0.1], sd: [1, 2] }, { maxIter: 200 });
  for (let i = 1; i < fit.history.length; i++) assert.ok(fit.history[i] >= fit.history[i - 1] - 1e-9, `step ${i}`);
});

/* ---------------------------------------------------------------- a simulated series with known regimes */

function simulate(n, model, seed) {
  const rand = rng(seed);
  const x = new Float64Array(n), s = new Int32Array(n);
  let k = 0;
  for (let t = 0; t < n; t++) {
    if (t) k = rand() < model.A[k][k] ? k : 1 - k;
    s[t] = k;
    x[t] = rand.normal(model.mu[k], model.sd[k]);
  }
  return { x, s };
}

test("a simulated two-regime series: parameters recovered and more than 90% of months labelled correctly", () => {
  const truth = { K: 2, pi: [1, 0], A: [[0.97, 0.03], [0.06, 0.94]], mu: [0.8, -1.5], sd: [2, 6] };
  const { x, s } = simulate(3000, truth, 21);
  const f = fitHmm(x, 2);
  const m = f.model; // ordered calm first, as the truth is
  close(m.mu[0], 0.8, 0.25); close(m.mu[1], -1.5, 0.8);
  close(m.sd[0], 2, 0.15); close(m.sd[1], 6, 0.5);
  close(m.A[0][0], 0.97, 0.015); close(m.A[1][1], 0.94, 0.03);
  const labels = argmaxRows(posteriors(x, m).gamma, 2);
  const right = labels.reduce((a, l, t) => a + (l === s[t] ? 1 : 0), 0) / x.length;
  assert.ok(right > 0.9, `labelled correctly: ${right}`);
  // BIC prefers two regimes to one and to three.
  const b = [1, 2, 3].map((K) => fitHmm(x, K, { starts: 6 }).bic);
  assert.ok(b[1] < b[0] && b[1] < b[2], `BIC ${b}`);
});

/* ---------------------------------------------------------------- pieces */

test("regimes are ordered from the lowest standard deviation, with the transition matrix permuted to match", () => {
  const m = sortByVolatility({ K: 2, pi: [0.3, 0.7], A: [[0.9, 0.1], [0.4, 0.6]], mu: [1, 2], sd: [5, 1] });
  assert.deepEqual(m.sd, [1, 5]);
  assert.deepEqual(m.mu, [2, 1]);
  assert.deepEqual(m.pi, [0.7, 0.3]);
  assert.deepEqual(m.A, [[0.6, 0.4], [0.1, 0.9]]);
});

test("parameter count, durations, stationary distribution, runs and disagreement: hand cases", () => {
  assert.equal(parameterCount(1), 2);
  assert.equal(parameterCount(2), 7);  // 2 means, 2 sds, 2 transitions, 1 starting probability
  assert.equal(parameterCount(3), 14);
  const A = [[0.9, 0.1], [0.3, 0.7]];
  const d = durations({ A });
  close(d[0], 10); close(d[1], 1 / 0.3);
  const p = stationary(A);
  close(p[0], 0.75, 1e-12); close(p[1], 0.25, 1e-12); // 0.1 p0 = 0.3 p1
  assert.deepEqual(runs([0, 0, 1, 1, 1, 0]), [{ label: 0, from: 0, to: 1 }, { label: 1, from: 2, to: 4 }, { label: 0, from: 5, to: 5 }]);
  close(disagreement([0, 1, 1, 0], [0, 1, 0, 1]), 0.5);
  close(disagreement([0, 1, 1, 0], [0, 0, 1, 0], 1), 1 / 3);
  assert.deepEqual([...argmaxRows(Float64Array.of(0.2, 0.8, 0.6, 0.4), 2)], [1, 0]);
});

test("the volatility start groups months by their local volatility, calm group first", () => {
  // 40 calm months (+-0.1) then 40 wild ones (+-3): the two groups are the two halves.
  const x = Float64Array.from({ length: 80 }, (_, t) => (t % 2 ? 1 : -1) * (t < 40 ? 0.1 : 3));
  const starts = startingModels(x, 2, 3, 1);
  assert.equal(starts.length, 3);
  const v = starts[2];
  // Months 37..42 straddle the switch: the window of three months either side ranks them by how much of each half they see.
  assert.ok(v.sd[0] < 0.2 && v.sd[1] > 2.5, `sd ${v.sd}`);
  close(v.mu[0], 0, 0.05);
  // With room for only two starts, the volatility start is left out.
  assert.equal(startingModels(x, 2, 2, 1).length, 2);
});

test("monthly averages of a random walk have changes correlated at about 0.25 (Working 1960)", () => {
  const rand = rng(8);
  let p = 0;
  const avg = Float64Array.from({ length: 6000 }, () => { let s = 0; for (let d = 0; d < 21; d++) { p += rand.normal(); s += p; } return s / 21; });
  const dx = Float64Array.from({ length: avg.length - 1 }, (_, i) => avg[i + 1] - avg[i]);
  const r = stats.corr(dx.slice(1), dx.slice(0, -1));
  close(r, (21 * 21 - 1) / (2 * (2 * 21 * 21 + 1)), 0.03); // Working's formula for 21 points: 0.249
});

/* ---------------------------------------------------------------- the real data and the finding */

const bicChoice = (x) => { const f = [1, 2, 3, 4].map((K) => fitHmm(x, K)); return { fits: f, best: f.reduce((a, b) => (b.bic < a.bic ? b : a)).K }; };

test("BIC prefers three regimes for the Treasury yield and two for the other four markets", () => {
  for (const s of MARKETS.series) assert.equal(bicChoice(changes(s)).best, s.id === "ust10" ? 3 : 2, s.id);
});

test("the finding on the page: the Treasury yield with three regimes", () => {
  const s = market("ust10");
  const x = changes(s);
  const f = fitHmm(x, 3);
  const m = f.model;
  // The best fit, found independently (numpy Baum-Welch from 24 random starts: ln L = 120.76, standard deviations
  // 0.058, 0.205 and 0.536). Twelve starts without the volatility start stopped at 117.18.
  assert.equal(f.ll.toFixed(2), "120.76");
  assert.equal(f.reached, 3);
  assert.equal(f.starts, 20);
  assert.equal(m.sd[0].toFixed(3), "0.058");
  assert.equal(m.sd[2].toFixed(2), "0.54");
  assert.equal(m.sd[1].toFixed(2), "0.20");
  const { gamma } = posteriors(x, m);
  const hind = argmaxRows(gamma, 3);
  const turbulent = runs(hind).filter((r) => r.label === 2).sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
  assert.equal(monthAt(s.start, turbulent.from + 1), "1979-09");
  assert.equal(monthAt(s.start, turbulent.to + 1), "1988-03");
  const { alpha } = forward(x, m);
  const n = x.length;
  assert.equal(alpha[(n - 1) * 3 + 1].toFixed(2), "0.99");
  const last = runs(hind).at(-1);
  assert.equal(last.label, 1);
  assert.equal(monthAt(s.start, last.from + 1), "2009-02");
  // The other local optima the starts stop at: 3.6 to 30.3 lower, labelling 1% to 58% of months differently.
  const others = f.optima.slice(1);
  assert.equal(others.length, 3);
  assert.equal((f.ll - others[0].ll).toFixed(1), "3.6");
  assert.equal((f.ll - others.at(-1).ll).toFixed(1), "30.3");
  const dis = others.map((o) => Math.round(100 * disagreement(argmaxRows(posteriors(x, o.model).gamma, 3), hind)));
  assert.equal(Math.min(...dis), 1);
  assert.equal(Math.max(...dis), 58);
  // Real time, refitting every 12 months from month 120 (May 1963), from the three non-random starts and last year's fit.
  const rt = finish(realTimeSteps(x, 3, { first: 120, starts: 3, seed: 72 }));
  assert.equal(monthAt(s.start, 121), "1963-05");
  assert.equal(Math.round(100 * disagreement(rt.labels, hind, 120)), 14);
  // An independent implementation (own starts, own refits) found 16%: the share depends on the optimiser, not by much.
  assert.equal(runs(hind).length - 1, 8);
});

test("every market and every number of regimes fits without failing", () => {
  for (const s of MARKETS.series) for (const K of [1, 2, 3, 4]) {
    const f = fitHmm(changes(s), K, { starts: 2 });
    assert.ok(Number.isFinite(f.ll) && f.model.sd.every((v) => v > 0) && f.model.A.every((row) => Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9), `${s.id} ${K}`);
  }
});
