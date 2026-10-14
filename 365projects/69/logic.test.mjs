import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { SERIES } from "./data.js";
import { CRITICAL } from "./critical.js";
import {
  MIN_WINDOW, prefix, adf, prefixLag, adfLag, adfLagT, chooseLag, bubbleTests, randomWalk, bubblePath, averagedWalk, trendOf,
  percentiles, simulateNull, rankAgainst, criticalValue, criticalError, verdict, minDuration, episodes, monthAt, powerStep, emptyPower,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const series = (id) => SERIES.series.find((s) => s.id === id);
const setup = (id) => { const c = CRITICAL.series[id]; return { ...c, dist: CRITICAL.dist[`${c.T}-${c.k}`] }; };

/* ---------------------------------------------------------------- data */

test("data: six monthly series with values as the sources publish them", () => {
  assert.deepEqual(SERIES.series.map((s) => s.id), ["btc", "house", "gold", "silver", "brent", "nickel"]);
  const house = series("house");
  assert.equal(house.start, "1991-01");
  assert.equal(house.hpi[0], 100);          // FHFA purchase-only index, USA, seasonally adjusted, January 1991
  assert.equal(house.rent[0], 141.2);       // BLS CUSR0000SEHA, January 1991
  assert.equal(house.values[0], 100);
  assert.deepEqual(house.filled, ["2025-10"]);
  close(house.values.at(-1), 100 * (house.hpi.at(-1) / 100) / (house.rent.at(-1) / 141.2), 1e-3);
  assert.equal(series("gold").start, "1975-01");
  assert.equal(series("gold").values[0], 176);       // Pink Sheet, gold, January 1975
  assert.equal(series("silver").values.at(-1), 64.6); // Pink Sheet, silver, September 2026
  assert.equal(series("btc").start, "2010-08");
  assert.equal(monthAt("2010-08", series("btc").values.length - 1), "2026-04");
  for (const s of SERIES.series) assert.ok(s.values.every((v) => v > 0), s.id);
});

/* ---------------------------------------------------------------- the ADF regression */

test("the ADF t statistic from running sums equals a direct regression, with and without lags", () => {
  const r = rng(1);
  const y = randomWalk(120, r, { y0: 5 });
  const P = prefix(y);
  for (const [a, b] of [[0, 119], [10, 60], [37, 100]]) {
    const X = [], d = [];
    for (let t = a + 1; t <= b; t++) { X.push([y[t - 1]]); d.push(y[t] - y[t - 1]); }
    close(adf(P, a, b), stats.ols(X, d).t[1], 1e-9);
  }
  for (const k of [1, 2, 3]) {
    const PL = prefixLag(y, k);
    const [a, b] = [7, 110];
    const X = [], d = [];
    for (let t = a + k + 1; t <= b; t++) { X.push([y[t - 1], ...Array.from({ length: k }, (_, j) => y[t - 1 - j] - y[t - 2 - j])]); d.push(y[t] - y[t - 1]); }
    const o = stats.ols(X, d);
    close(adfLag(PL, a, b).t, o.t[1], 1e-8);
    close(adfLagT(PL, a, b), o.t[1], 1e-8);
    close(adfLag(PL, a, b).rss, o.rss, 1e-8);
  }
});

test("the ADF statistic is unchanged by the units of the series (adding a constant or rescaling)", () => {
  const y = randomWalk(80, rng(2));
  const z = Float64Array.from(y, (v) => 3 * v + 1000);
  close(adf(prefix(y), 0, 79), adf(prefix(z), 0, 79), 1e-7);
  close(adfLag(prefixLag(y, 2), 0, 79).t, adfLag(prefixLag(z, 2), 0, 79).t, 1e-7);
});

test("edge cases: a perfect fit or a window too short gives no statistic", () => {
  const y = Float64Array.of(1, 2, 4, 8, 16, 32); // dy_t = y_{t-1} exactly
  assert.ok(Number.isNaN(adf(prefix(y), 0, 5)));
  assert.ok(Number.isNaN(adf(prefix(y), 0, 2)));
  assert.equal(adfLag(prefixLag(y, 1), 0, 4), null);
  assert.throws(() => bubbleTests(new Float64Array(10), 36), /at least 36/);
  assert.throws(() => bubbleTests(new Float64Array(100), 10, 4), /lag order 4/);
});

test("SADF, BSADF and GSADF equal brute-force maxima over windows", () => {
  const y = bubblePath(90, rng(3), { delta: 1.03, te: 40, tf: 60 });
  for (const k of [0, 2]) {
    const r = bubbleTests(y, 20, k);
    const t = k === 0 ? ((a, b) => adf(prefix(y), a, b)) : ((a, b) => adfLag(prefixLag(y, k), a, b)?.t ?? -Infinity);
    let g = -Infinity, s = -Infinity;
    for (let b = 19; b < 90; b++) {
      let best = -Infinity;
      for (let a = 0; a <= b - 19; a++) best = Math.max(best, t(a, b));
      close(r.bsadf[b], best, 1e-9);
      close(r.forward[b], t(0, b), 1e-9);
      g = Math.max(g, best); s = Math.max(s, t(0, b));
    }
    close(r.gsadf, g, 1e-12); close(r.sadf, s, 1e-12);
    assert.ok(Number.isNaN(r.bsadf[18]));
  }
});

/* ---------------------------------------------------------------- critical values */

test("simulated critical values match Phillips, Shi and Yu's Table 1(c) (no lags, smallest window 40)", () => {
  // Published finite-sample values from 5,000 replications; here 10,000 with a fixed seed. Allowed gap: 0.06 at 90%
  // and 95%, 0.12 at 99%, a little over twice the combined Monte Carlo error of the two simulations.
  const table = { 100: { sadf: [0.72, 1.05, 1.66], gsadf: [1.16, 1.48, 2.08] }, 200: { sadf: [0.97, 1.30, 1.86], gsadf: [1.64, 1.88, 2.46] } };
  for (const T of [100, 200]) {
    const s = simulateNull(T, 40, 10000, 1914 + T);
    [0.9, 0.95, 0.99].forEach((l, j) => {
      const tol = l === 0.99 ? 0.12 : 0.06;
      close(criticalValue(s.sadf, l), table[T].sadf[j], tol);
      close(criticalValue(s.gsadf, l), table[T].gsadf[j], tol);
    });
  }
});

test("the bundled critical values are the ones the script's design gives, and the check at T = 400 agrees with the paper", () => {
  assert.equal(CRITICAL.w0, MIN_WINDOW);
  assert.equal(CRITICAL.reps, 10000);
  for (const s of SERIES.series) {
    const { T, k, dist } = setup(s.id);
    assert.equal(T, s.values.length);
    assert.equal(k, chooseLag(s.values.map(Math.log), CRITICAL.kmax).k, s.id);
    assert.equal(dist.cv95.length, T);
    assert.equal(dist.cv95[MIN_WINDOW - 2], null);
    assert.ok(dist.gsadf.every((v, i) => i === 0 || v >= dist.gsadf[i - 1]));
  }
  const psy = CRITICAL.psyCheck;
  [1.19, 1.50, 1.98].forEach((v, j) => close(psy.sadf[j], v, j === 2 ? 0.12 : 0.06));
  [1.97, 2.21, 2.71].forEach((v, j) => close(psy.gsadf[j], v, j === 2 ? 0.12 : 0.06));
});

test("a re-simulation with another seed gives the bundled critical values for Bitcoin's design", () => {
  const { T, k, dist } = setup("btc");
  const s = simulateNull(T, MIN_WINDOW, 2000, 12345, { k });
  close(criticalValue(s.gsadf, 0.95), criticalValue(dist.gsadf, 0.95), 0.08);
  close(criticalValue(s.sadf, 0.95), criticalValue(dist.sadf, 0.95), 0.08);
  close(s.cv95[T - 1], dist.cv95[T - 1], 0.08);
});

/* ---------------------------------------------------------------- false alarms and power */

test("false alarms: about 5% on random walks with the bundled critical values; about one in five on monthly averages without lags", () => {
  const { T, k, dist } = setup("btc");
  const crit = dist;
  const tally = emptyPower();
  const rand = rng(77);
  for (let i = 0; i < 400; i++) powerStep(tally, { T, w0: MIN_WINDOW, k, crit, level: 0.95, delta: 1.02, length: 24, rand });
  const fa = tally.nullG / tally.n;
  assert.ok(fa > 0.025 && fa < 0.085, `false-alarm rate ${fa}`);
  // Power against a bubble growing 2% a month for 24 months.
  assert.ok(tally.bubG / tally.n > 0.8, `power ${tally.bubG / tally.n}`);
  // Monthly averages of daily walks tested with no lags, against no-lag critical values for the same design.
  const k0 = simulateNull(T, MIN_WINDOW, 2000, 4242);
  const r2 = rng(78);
  let hits = 0;
  for (let i = 0; i < 300; i++) if (bubbleTests(averagedWalk(T, r2), MIN_WINDOW, 0).gsadf > criticalValue(k0.gsadf, 0.95)) hits++;
  assert.ok(hits / 300 > 0.12 && hits / 300 < 0.25, `false alarms without lags: ${hits / 300}`); // 0.153 here; 0.18 on 1,000
  // With the lag order BIC chose for Bitcoin, the same averaged walks are flagged far less often.
  const t3 = emptyPower();
  const r3 = rng(79);
  for (let i = 0; i < 300; i++) powerStep(t3, { T, w0: MIN_WINDOW, k, crit, level: 0.95, delta: 1.02, length: 24, rand: r3, averaged: true });
  assert.ok(t3.nullG / t3.n < 0.12, `false alarms with lags: ${t3.nullG / t3.n}`);
});

/* ---------------------------------------------------------------- pieces */

test("lag choice by BIC: none for a random walk, one for a walk whose changes are AR(1)", () => {
  const r = rng(5);
  assert.equal(chooseLag(randomWalk(600, r)).k, 0);
  const y = new Float64Array(600);
  let d = 0;
  for (let t = 1; t < 600; t++) { d = 0.5 * d + r.normal(); y[t] = y[t - 1] + d; }
  assert.equal(chooseLag(y).k, 1);
});

test("percentiles, ranks, minimum duration and episodes: hand cases", () => {
  const p = percentiles(Float64Array.from({ length: 101 }, (_, i) => i));
  close(p[0], 1); close(p[94], 95); close(p[98], 99);
  assert.equal(rankAgainst(p, 95), 94);      // strictly above 94 of the 99 percentiles
  assert.equal(rankAgainst(p, 95.5), 95);
  assert.equal(rankAgainst(p, 1000), 99);
  assert.equal(rankAgainst(p, NaN), 0);
  assert.equal(criticalValue(p, 0.95), 95);
  assert.equal(minDuration(189), 6);         // log 189 = 5.24
  assert.equal(minDuration(427), 7);         // log 427 = 6.06
  const b = Float64Array.of(NaN, 0, 3, 3, 3, 0, 3, 3, 0);
  const cv = [null, 1, 1, 1, 1, 1, 1, 1, 1];
  const e = episodes(b, cv, 3);
  assert.deepEqual(e.kept, [{ from: 2, to: 4, length: 3 }]);
  assert.deepEqual(e.brief, [{ from: 6, to: 7, length: 2 }]);
  // A run that reaches the last month is closed there.
  assert.deepEqual(episodes(Float64Array.of(0, 2, 2), [1, 1, 1], 2).kept, [{ from: 1, to: 2, length: 2 }]);
  // Equal to the critical value is not above it.
  assert.deepEqual(episodes(Float64Array.of(1, 1), [1, 1], 1).kept, []);
  assert.equal(monthAt("2010-08", 5), "2011-01");
});

test("the bubble path: explosive between te and tf, then back to where it began", () => {
  const r = rng(6);
  const y = bubblePath(100, r, { delta: 1.05, te: 40, tf: 59, sigma: 0 });
  close(y[39], 100); close(y[40], 105); close(y[59], 100 * 1.05 ** 20, 1e-9); close(y[60], y[40], 1e-9); close(y[99], y[40], 1e-9);
});

/* ---------------------------------------------------------------- verdicts and the finding */

test("verdicts allow for the simulation error of the critical value, and the edges are exact", () => {
  assert.equal(verdict(2.5, 2.33, 0.02), "explosive");
  assert.equal(verdict(2.37, 2.33, 0.02), "on the edge");   // exactly two errors above: not beyond
  assert.equal(verdict(2.29, 2.33, 0.02), "on the edge");
  assert.equal(verdict(2.2, 2.33, 0.02), "not explosive");
  assert.equal(verdict(NaN, 2.33, 0.02), "not explosive");
  // The error from percentiles of a standard normal sample: sqrt(.05 * .95 / n) / phi(1.645) = 0.0211 for n = 1000.
  const pcts = percentiles(Float64Array.from({ length: 200001 }, (_, i) => quantileNormal((i + 0.5) / 200001)));
  // The density from the 94th and 96th percentiles is a finite difference, so it is about 1% off.
  close(criticalError(pcts, 0.95, 1000), Math.sqrt(0.05 * 0.95 / 1000) / 0.10314, 0.002);
});
// Standard normal quantile by bisection on the kit's distribution function (for the test above only).
function quantileNormal(p) { let lo = -9, hi = 9; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (stats.normalCdf(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }

test("lag orders chosen by BIC, as the page says", () => {
  const k = Object.fromEntries(SERIES.series.map((s) => [s.id, CRITICAL.series[s.id].k]));
  assert.deepEqual(k, { btc: 2, house: 3, gold: 2, silver: 2, brent: 2, nickel: 1 });
});

test("the finding on the page: Bitcoin, and gold now", () => {
  const run = (id) => { const s = series(id); const { T, k, dist } = setup(id); return { s, T, dist, r: bubbleTests(s.values.map(Math.log), MIN_WINDOW, k) }; };
  const b = run("btc");
  assert.equal(b.r.gsadf.toFixed(2), "3.90");
  assert.equal(criticalValue(b.dist.gsadf, 0.95).toFixed(2), "2.33");
  assert.equal(verdict(b.r.gsadf, criticalValue(b.dist.gsadf, 0.95), criticalError(b.dist.gsadf, 0.95, CRITICAL.reps)), "explosive");
  const e = episodes(b.r.bsadf, b.dist.cv95, minDuration(b.T)).kept;
  assert.equal(e.length, 1);
  assert.equal(monthAt(b.s.start, e[0].from), "2017-05");
  assert.equal(monthAt(b.s.start, e[0].to), "2018-03");
  const P = b.s.values;
  assert.equal(Math.round(100 * (P[e[0].to] / P[e[0].from - 1] - 1)), 637);
  assert.equal(Math.round(100 * (P[e[0].to + 12] / P[e[0].to] - 1)), -56);
  assert.equal(rankAgainst(b.dist.bsadfEnd, b.r.bsadf[b.T - 1]), 55);
  const g = run("gold");
  assert.equal(rankAgainst(g.dist.bsadfEnd, g.r.bsadf[g.T - 1]), 99);
  const ge = episodes(g.r.bsadf, g.dist.cv95, minDuration(g.T)).kept.at(-1);
  assert.equal(monthAt(g.s.start, ge.from), "2024-04");
  assert.equal(ge.to, g.T - 1);
  // Brent's GSADF is the one statistic on the edge at 5%.
  const br = run("brent");
  assert.equal(br.r.gsadf.toFixed(2), "2.84");
  assert.equal(criticalValue(br.dist.gsadf, 0.95).toFixed(2), "2.86");
  assert.equal(verdict(br.r.gsadf, criticalValue(br.dist.gsadf, 0.95), criticalError(br.dist.gsadf, 0.95, CRITICAL.reps)), "on the edge");
  // The simulation panel as it opens for Bitcoin: 100 pairs, 2% a month for 24 months, random walks, 5%.
  const { T, k, dist } = setup("btc");
  const tally = emptyPower();
  const rand = rng(6900 + T + k);
  for (let i = 0; i < 100; i++) powerStep(tally, { T, w0: MIN_WINDOW, k, crit: dist, level: 0.95, delta: 1.02, length: 24, rand });
  assert.equal(tally.nullG, 6);
  assert.equal(tally.bubG, 93);
  assert.equal(tally.nullDated, 30); // random walks with at least one dated episode, quoted under the limits
});

test("a trend inflates false alarms: Bitcoin's own trend, the panel's count and the percentiles quoted on the page", () => {
  // Hand case: log changes a, a, -a with a = ln 2 have mean a / 3, deviations 2a/3, 2a/3, -4a/3, so the standard
  // deviation is sqrt((24/9) a^2 / 2) = 2a / sqrt(3) and the ratio sqrt(3) / 6.
  const h = trendOf([1, 2, 4, 2]);
  close(h.mean, Math.LN2 / 3, 1e-12);
  close(h.sd, (2 * Math.LN2) / Math.sqrt(3), 1e-12);
  close(h.ratio, Math.sqrt(3) / 6, 1e-12);
  const ratios = Object.fromEntries(SERIES.series.map((s) => [s.id, trendOf(s.values)]));
  assert.equal(ratios.btc.ratio.toFixed(2), "0.27");
  assert.equal((100 * ratios.btc.mean).toFixed(2), "7.42");
  assert.equal((100 * ratios.btc.sd).toFixed(0), "28");
  assert.equal(ratios.house.ratio.toFixed(2), "0.16");
  assert.equal(ratios.gold.ratio.toFixed(2), "0.11");
  for (const id of ["silver", "brent", "nickel"]) assert.ok(ratios[id].ratio <= 0.06, id);
  // The panel as the visitor runs it for Bitcoin with "Random walks with this series' trend": 28 of 100.
  const { T, k, dist } = setup("btc");
  const tally = emptyPower();
  const rand = rng(6900 + T + k);
  for (let i = 0; i < 100; i++) powerStep(tally, { T, w0: MIN_WINDOW, k, crit: dist, level: 0.95, delta: 1.02, length: 24, rand, drift: ratios.btc.ratio });
  assert.equal(tally.nullG, 28);
  // 1,000 walks with the trend: percentiles of GSADF, and Bitcoin's statistic above the 99th.
  const r = rng(4269), g = [];
  for (let i = 0; i < 1000; i++) g.push(bubbleTests(randomWalk(T, r, { drift: ratios.btc.ratio }), MIN_WINDOW, k).gsadf);
  g.sort((a, b) => a - b);
  assert.equal(g[949].toFixed(2), "3.22");
  assert.equal(g[989].toFixed(2), "3.79");
  const btc = bubbleTests(series("btc").values.map(Math.log), MIN_WINDOW, k).gsadf;
  assert.ok(btc > g[989]);
});
