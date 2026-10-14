import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { rng, stats } from "../kit/kit.js";
import { CRYPTO } from "./data.js";
import {
  dateAt, indexOf, logReturns, meanSquare, filter, gradient, fitGarch, forecastVariance, normalQuantile, sortedQuantile,
  shockQuantile, varFromLog, cholesky, parameterDraws, simulatePaths, regimes, runs, percentileRank, backtestPlan,
  backtestBlock, ewmaStart, kupiec, scoreBacktest,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const rel = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} is not within ${tol} (relative) of ${b}`);
const coin = (id) => CRYPTO.coins.find((c) => c.id === id);
const returnsFrom = (id, date) => { const c = coin(id); return logReturns(c.prices.slice(indexOf(c.start, date))); };

/* ---------------------------------------------------------------- data */

test("data: six coins, daily with no gaps, ending on 23 May 2026, values as Coin Metrics publishes them", () => {
  assert.deepEqual(CRYPTO.coins.map((c) => c.id), ["btc", "eth", "ltc", "xrp", "doge", "ada"]);
  assert.equal(CRYPTO.source.licence, "CC BY-NC 4.0");
  // CC BY-NC 4.0, section 3(a): the licence's URI, the warranty notice and the changes travel with the data.
  assert.equal(CRYPTO.source.licenceUrl, "https://creativecommons.org/licenses/by-nc/4.0/");
  assert.match(CRYPTO.source.warranty, /without any warranty/);
  assert.match(CRYPTO.source.changes, /six significant figures/);
  for (const c of CRYPTO.coins) {
    assert.equal(dateAt(c.start, c.prices.length - 1), "2026-05-23", c.id);
    assert.ok(c.prices.every((p) => p > 0), c.id);
  }
  const btc = coin("btc");
  assert.equal(btc.start, "2010-07-18");
  // Values from csv/btc.csv in the archive (PriceUSD), to six significant figures.
  assert.equal(btc.prices[0], 0.08584);                                  // 2010-07-18
  assert.equal(btc.prices[indexOf(btc.start, "2026-05-23")], 76619.9);   // 76619.8666090415
  assert.equal(coin("eth").prices[0], 1.19999);                          // 2015-08-08
  assert.equal(coin("ada").prices.at(-1), 0.245818);                     // 0.245818490801265
});

test("dates and returns: hand cases", () => {
  assert.equal(dateAt("2024-02-28", 1), "2024-02-29");
  assert.equal(dateAt("2024-02-28", 2), "2024-03-01");
  assert.equal(indexOf("2010-07-18", "2018-01-01"), 2724);
  assert.equal(indexOf("2018-01-01", "2010-01-01"), 0);
  const r = logReturns([100, 110, 99]);
  close(r[0], 100 * Math.log(1.1));
  close(r[1], 100 * Math.log(0.9));
  assert.equal(r.length, 2);
});

/* ---------------------------------------------------------------- the filter and the likelihood */

test("filter: hand-computed variances and log-likelihood for three returns", () => {
  const r = Float64Array.of(1, -2, 0.5);
  const th = [0.1, 0.2, 0.1, 0.8];
  // e = 0.9, -2.1, 0.4; s2 = (0.81 + 4.41 + 0.16) / 3 = 1.7933...
  const s2 = (0.81 + 4.41 + 0.16) / 3;
  close(meanSquare(r, 0.1), s2, 1e-12);
  const h1 = 0.2 + 0.1 * s2 + 0.8 * s2;
  const h2 = 0.2 + 0.1 * 0.81 + 0.8 * h1;
  const h3 = 0.2 + 0.1 * 4.41 + 0.8 * h2;
  const f = filter(r, th);
  close(f.h[0], h1, 1e-12); close(f.h[1], h2, 1e-12); close(f.h[2], h3, 1e-12);
  const ll = [[0.9, h1], [-2.1, h2], [0.4, h3]].reduce((s, [e, h]) => s - 0.5 * (Math.log(2 * Math.PI) + Math.log(h) + (e * e) / h), 0);
  close(f.ll, ll, 1e-12);
  close(f.next, 0.2 + 0.1 * 0.16 + 0.8 * h3, 1e-12);
  close(gradient(r, th).ll, ll, 1e-12);
  // A fixed starting variance (as in the backtest) replaces s2.
  close(filter(r, th, 1).h[0], 0.2 + 0.9, 1e-12);
});

test("the analytic gradient matches finite differences of the log-likelihood", () => {
  const rand = rng(3);
  const r = Float64Array.from({ length: 400 }, () => rand.normal(0.05, 1.3));
  const th = [0.03, 0.15, 0.12, 0.8];
  const { g } = gradient(r, th);
  for (let j = 0; j < 4; j++) {
    const h = 1e-6;
    const up = [...th], dn = [...th];
    up[j] += h; dn[j] -= h;
    const fd = (filter(r, up).ll - filter(r, dn).ll) / (2 * h);
    close(g[j], fd, 1e-4 * Math.max(1, Math.abs(fd)));
  }
});

/* ---------------------------------------------------------------- estimation */

function simulateGarch(n, [mu, omega, alpha, beta], seed) {
  const rand = rng(seed);
  const r = new Float64Array(n);
  let h = omega / (1 - alpha - beta), e = 0;
  for (let t = 0; t < n + 500; t++) {
    h = omega + alpha * e * e + beta * h;
    e = Math.sqrt(h) * rand.normal();
    if (t >= 500) r[t - 500] = mu + e;
  }
  return r;
}

test("estimation recovers the parameters of a simulated GARCH(1,1) within their standard errors", () => {
  const truth = [0.05, 0.1, 0.1, 0.85];
  const f = fitGarch(simulateGarch(8000, truth, 11));
  truth.forEach((v, j) => assert.ok(Math.abs(f.theta[j] - v) < 3 * f.se[j], `parameter ${j}: ${f.theta[j]} against ${v} (se ${f.se[j]})`));
  // The gradient is zero at the optimum.
  f.gradient.forEach((g) => assert.ok(Math.abs(g) < 1e-5, `gradient ${g}`));
  // With normal shocks the robust and Hessian standard errors agree closely.
  f.se.forEach((s, j) => rel(s, f.seHessian[j], 0.25));
});

test("estimation refuses too few returns", () => {
  assert.throws(() => fitGarch(new Float64Array(50)), /at least 100/);
});

test("published benchmark (Bollerslev-Ghysels DEM/GBP, McCullough-Renfro values) when the data file is given", (t) => {
  // The benchmark data are not bundled (their licence is not stated). To run this check, save the 1,974 returns
  // (for example R's fGarch::dem2gbp) one per line after a header, and set GARCH_BENCHMARK to the file's path.
  const path = process.env.GARCH_BENCHMARK;
  if (!path || !existsSync(path)) { t.skip("set GARCH_BENCHMARK to the DEM/GBP returns to run this check"); return; }
  const r = Float64Array.from(readFileSync(path, "utf8").split(/\r?\n/).slice(1).filter((s) => s.trim()).map(Number));
  assert.equal(r.length, 1974);
  const f = fitGarch(r);
  // Three estimates agree to all six published figures; omega comes out 0.01076140, one unit away in the sixth.
  [-0.00619041, 0.0107613, 0.153134, 0.805974].forEach((v, j) => rel(f.theta[j], v, 1e-5));
  [0.00846212, 0.00285271, 0.0265228, 0.0335527].forEach((v, j) => rel(f.seHessian[j], v, 5e-6));
  [0.00873092, 0.00312364, 0.0273219, 0.0301509].forEach((v, j) => rel(f.se[j], v, 5e-6));
});

test("Bitcoin from 2018 agrees with a separate Python implementation (Nelder-Mead, finite-difference Hessian)", () => {
  // scratch script garch_check.py, run during the build: theta, log-likelihood and Hessian standard errors.
  const f = fitGarch(returnsFrom("btc", "2018-01-01"));
  assert.equal(f.n, 3064);
  [0.11639071, 0.53288825, 0.10161765, 0.85952506].forEach((v, j) => rel(f.theta[j], v, 2e-5));
  close(f.ll, -7903.3797412, 1e-6);
  [0.052886, 0.0917403, 0.0140991, 0.0176329].forEach((v, j) => rel(f.seHessian[j], v, 2e-4));
  close(Math.sqrt(f.next * 365), 44.5507, 1e-3);
  close(Math.sqrt((f.omega / (1 - f.persistence)) * 365), 70.7503, 1e-3);
});

/* ---------------------------------------------------------------- forecasts and quantiles */

test("the variance forecast decays to the long-run level at the rate alpha + beta", () => {
  const th = [0, 0.1, 0.1, 0.8];
  const v = forecastVariance(th, 3, 50);
  close(v[0], 3);
  const lr = 0.1 / 0.1;
  for (let k = 1; k < 50; k++) close(v[k], lr + 0.9 ** k * (3 - lr), 1e-12);
});

test("normal quantiles to ten digits", () => {
  close(normalQuantile(0.99), 2.3263478740408408, 1e-12);
  close(normalQuantile(0.01), -2.3263478740408408, 1e-12);
  close(normalQuantile(0.95), 1.6448536269514722, 1e-12);
  close(normalQuantile(0.025), -1.959963984540054, 1e-12);
  close(normalQuantile(0.5), 0, 1e-15);
  close(normalQuantile(1e-10), -6.361340902404056, 1e-9);
  assert.equal(normalQuantile(0), -Infinity);
  assert.ok(Number.isNaN(normalQuantile(1.5)));
});

test("shock quantile: normal, or the empirical quantile of past standardised surprises", () => {
  close(shockQuantile(0.99, "normal", []), -2.3263478740408408, 1e-12);
  // 101 values -50..50: the 1% quantile by linear interpolation is -49.
  close(shockQuantile(0.99, "past", Float64Array.from({ length: 101 }, (_, i) => i - 50)), -49, 1e-12);
  close(sortedQuantile([1, 2, 3, 4], 0.5), 2.5);
  // VaR as a price change: a log return of -5% is a fall of 4.877%.
  close(varFromLog(0, 5, -1), (1 - Math.exp(-0.05)) * 100, 1e-12);
});

test("Cholesky factor and parameter draws that respect the constraints", () => {
  const L = cholesky([[4, 2], [2, 3]]);
  close(L[0][0], 2); close(L[1][0], 1); close(L[1][1], Math.sqrt(2));
  assert.equal(cholesky([[1, 2], [2, 1]]), null);
  const r = returnsFrom("btc", "2018-01-01");
  const f = fitGarch(r);
  const d = parameterDraws(r, f, 200, 68);
  assert.equal(d.length, 200);
  for (const x of d) assert.ok(x.theta[1] > 0 && x.theta[2] >= 0 && x.theta[3] >= 0 && x.theta[2] + x.theta[3] < 1);
  // The draws centre on the estimates.
  close(stats.mean(d.map((x) => x.theta[3])), f.beta, 3 * f.se[3] / Math.sqrt(200) + 0.01);
});

test("simulated one-day returns match the normal quantiles of the model", () => {
  const f = { theta: [0.1, 0.2, 0.1, 0.8], next: 4, z: new Float64Array(0) };
  // 200,000 paths: the standard error of the 1% quantile is about 0.017.
  const q = simulatePaths(f, { horizon: 1, paths: 200000, seed: 1, shocks: "normal", draws: null, probs: [0.01, 0.5, 0.99] })[0];
  close(q[0], 0.1 + 2 * -2.3263, 0.05);
  close(q[1], 0.1, 0.02);
  close(q[2], 0.1 + 2 * 2.3263, 0.05);
  // Resampled shocks can never be worse than the worst past surprise.
  const g = { ...f, z: Float64Array.of(-1, 0, 1) };
  const q2 = simulatePaths(g, { horizon: 1, paths: 500, seed: 2, shocks: "past", draws: null, probs: [0, 1] })[0];
  close(q2[0], 0.1 - 2, 1e-12); close(q2[1], 0.1 + 2, 1e-12);
});

/* ---------------------------------------------------------------- regimes */

test("regimes: the quartiles of fitted volatility, runs and percentile ranks", () => {
  const h = Float64Array.from([1, 4, 9, 16, 25], (v) => v); // sigma 1..5
  const g = regimes(h);
  close(g.low, 2); close(g.high, 4);
  assert.deepEqual(g.labels, ["calm", "ordinary", "ordinary", "ordinary", "stormy"]);
  assert.deepEqual(runs(["a", "a", "b", "a"]), [{ label: "a", from: 0, to: 1 }, { label: "b", from: 2, to: 2 }, { label: "a", from: 3, to: 3 }]);
  close(percentileRank([1, 2, 3, 4], 3), 62.5);
  close(percentileRank([1, 2, 3, 4], 0), 0);
  close(percentileRank([1, 2, 3, 4], 9), 100);
});

/* ---------------------------------------------------------------- backtest */

test("Kupiec's test: hand-computed likelihood ratio, and no rejection at exactly the expected rate", () => {
  const { lr, pValue } = kupiec(23, 2064, 0.01);
  const want = -2 * (2041 * Math.log(0.99) + 23 * Math.log(0.01) - 2041 * Math.log(2041 / 2064) - 23 * Math.log(23 / 2064));
  close(lr, want, 1e-9);
  close(pValue, 0.608, 0.001);
  close(kupiec(10, 1000, 0.01).lr, 0, 1e-12);
  close(kupiec(10, 1000, 0.01).pValue, 1, 1e-6);
  // Zero exceedances: the log of zero is avoided.
  close(kupiec(0, 1000, 0.01).lr, -2 * 1000 * Math.log(0.99), 1e-9);
});

test("the backtest uses only earlier returns: changing a later return leaves every earlier forecast unchanged", () => {
  const r = returnsFrom("eth", "2022-01-01");
  const plan = backtestPlan(r.length, 1000, 250);
  assert.deepEqual(plan.slice(0, 2), [{ from: 1000, to: 1250 }, { from: 1250, to: 1500 }]);
  const run = (x) => { const ew = ewmaStart(x, 1000); return plan.flatMap((b) => backtestBlock(x, b, { level: 0.99, shocks: "normal", ewma: ew }).rows); };
  const a = run(r);
  const changed = Float64Array.from(r);
  changed[1300] = -40;
  const b = run(changed);
  for (let i = 0; i < a.length; i++) {
    if (a[i].t > 1300) break;
    close(a[i].garch, b[i].garch, 0); close(a[i].ewma, b[i].ewma, 0); close(a[i].hist, b[i].hist, 0);
  }
  // ... and does change a forecast after it.
  assert.notEqual(a.find((x) => x.t === 1301).ewma, b.find((x) => x.t === 1301).ewma);
});

test("the quantile loss and exceedance counts: hand case", () => {
  const rows = [{ r: -3, garch: 2, ewma: 4, hist: 2 }, { r: 1, garch: 2, ewma: 4, hist: 5 }];
  const s = scoreBacktest(rows, 0.9);
  assert.equal(s.garch.exceedances, 1);
  assert.equal(s.ewma.exceedances, 0);
  // garch: (0.1 - 1)(-3 + 2) = 0.9 and (0.1)(1 + 2) = 0.3, mean 0.6.
  close(s.garch.loss, 0.6, 1e-12);
  close(s.ewma.loss, (0.1 * 1 + 0.1 * 5) / 2, 1e-12);
});

/* ---------------------------------------------------------------- the finding */

test("the finding on the page: Bitcoin from 2018 with the opening settings", () => {
  const r = returnsFrom("btc", "2018-01-01");
  const f = fitGarch(r);
  assert.equal(f.persistence.toFixed(3), "0.961");
  assert.equal(f.halfLife.toFixed(1), "17.5");
  assert.equal(Math.sqrt(f.next * 365).toFixed(0), "45");
  const g = regimes(f.h);
  assert.ok(Math.sqrt(f.next) < g.low, "calm");
  assert.equal(percentileRank(g.sigma, Math.sqrt(f.next)).toFixed(0), "10"); // higher than on 10% of days, lower than on 90%
  const plan = backtestPlan(r.length, 1000, 250);
  const ew = ewmaStart(r, 1000);
  const rows = plan.flatMap((b) => backtestBlock(r, b, { level: 0.99, shocks: "normal", ewma: ew }).rows);
  const s = scoreBacktest(rows, 0.99);
  assert.equal(s.garch.n, 2064);
  assert.equal(s.garch.exceedances, 23);
  assert.equal(s.ewma.exceedances, 46);
  assert.equal(s.garch.pValue.toFixed(2), "0.61");
  assert.ok(s.ewma.pValue < 0.05);
  assert.equal(fmtPct(s.garch.rate), "1.11%");
  assert.equal(fmtPct(s.ewma.rate), "2.23%");
  // The first backtest day.
  assert.equal(dateAt(coin("btc").start, indexOf(coin("btc").start, "2018-01-01") + 1 + 1000), "2020-09-28");
});
const fmtPct = (x) => `${(x * 100).toFixed(2)}%`;

test("Dogecoin over its whole history sits at the edge of the parameter space, as the page says", () => {
  const f = fitGarch(returnsFrom("doge", "2014-01-23"));
  assert.ok(f.boundary);
  assert.ok(f.persistence > 0.9995, `persistence ${f.persistence}`);
});

test("every coin and every start date the page offers gives a finite fit", () => {
  for (const c of CRYPTO.coins) for (const from of [c.start, "2016-01-01", "2018-01-01", "2020-01-01", "2022-01-01"]) {
    if (from < c.start) continue;
    const r = returnsFrom(c.id, from);
    const f = fitGarch(r);
    assert.ok(Number.isFinite(f.ll) && f.theta.every(Number.isFinite) && Number.isFinite(f.next), `${c.id} ${from}`);
    assert.ok(f.persistence < 1);
  }
});
