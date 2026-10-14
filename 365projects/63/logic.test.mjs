import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { ASSETS } from "../data/assets.js";
import {
  BILLS, RISKY, T, WARMUP, RULES, monthLabel, indexOfYear, cumLog, prepare, trailing, weights, backtest, buyAndHold,
  sharpe, maxDrawdown, summary, grid, describe, normalQuantile, expectedMaxSharpe, pbo, evaluateRule, scoreGrid,
  overfitting, shuffled, bestInSample, shuffleVerdict,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const asset = (id) => ASSETS.assets.find((a) => a.id === id);

// A small hand-made world: two assets and bills over six months.
function toy(R, B) {
  const data = { ids: R.map((_, i) => `a${i}`), assets: [], R: R.map((r) => Float64Array.from(r)), B: Float64Array.from(B), n: R.length, T: B.length };
  data.cums = data.R.map(cumLog);
  data.cumB = cumLog(data.B);
  return data;
}

/* ------------------------------------------------------------------ the data */

test("the shared data: eleven assets, 332 months from February 1999 to September 2026", () => {
  assert.equal(ASSETS.first, "1999-02");
  assert.equal(ASSETS.last, "2026-09");
  assert.equal(T, 332);
  assert.equal(ASSETS.assets.length, 11);
  assert.equal(RISKY.length, 10);
  for (const a of ASSETS.assets) assert.equal(a.returns.length, 332, a.id);
  assert.equal(monthLabel(0), "Feb 1999");
  assert.equal(monthLabel(T - 1), "Sep 2026");
  assert.equal(indexOfYear(2013), 167);
  assert.equal(monthLabel(indexOfYear(2013)), "Jan 2013");
});

test("month-end inputs agree with the sources' own figures", () => {
  const last = ASSETS.inputs.yields.t10.length - 1; // the end of September 2026
  // US Treasury, Daily Treasury Par Yield Curve Rates, 30 September 2026: 3 Mo 4.20, 2 Yr 4.88, 10 Yr 5.29, 20 Yr 5.68.
  assert.equal(ASSETS.inputs.yields.bills[last], 4.2);
  assert.equal(ASSETS.inputs.yields.t2[last], 4.88);
  assert.equal(ASSETS.inputs.yields.t10[last], 5.29);
  assert.equal(ASSETS.inputs.yields.t20[last], 5.68);
  // The same table for 29 January 1999, the base month: 10 Yr 4.66, 20 Yr 5.35.
  assert.equal(ASSETS.inputs.yields.t10[0], 4.66);
  assert.equal(ASSETS.inputs.yields.t20[0], 5.35);
  // Federal Reserve H.10, 30 September 2026: 1.1345 dollars per euro, 157.25 yen per dollar, 0.8348 francs per dollar.
  assert.equal(ASSETS.inputs.fx.eur[last], 1.1345);
  assert.equal(ASSETS.inputs.fx.jpy[last], 157.25);
  assert.equal(ASSETS.inputs.fx.chf[last], 0.8348);
  // BIS policy rates at the end of August 2026 (earned in September): Bank Rate 3.75, cash rate target 4.35.
  assert.equal(ASSETS.inputs.policy.gbp.at(-1), 3.75);
  assert.equal(ASSETS.inputs.policy.aud.at(-1), 4.35);
});

test("returns rebuilt from the inputs by separately written code match the bundled ones", () => {
  // Par bond of maturity m bought at y0, a month later priced at y1 with m - 1/12 years left, plus a month's coupon.
  const bond = (y0, y1, m) => {
    const c = y0 / 100, y = y1 / 100, periods = 2 * (m - 1 / 12);
    let pv = 0;
    // Present value of a 1/2-yearly coupon stream and the principal, summing an annuity whose last period is fractional.
    const v = 1 / (1 + y / 2);
    pv = (c / 2) * (1 - v ** periods) / (y / 2) + v ** periods;
    return pv - 1 + c / 12;
  };
  const Y = ASSETS.inputs.yields;
  for (const [id, m] of [["t2", 2], ["t5", 5], ["t10", 10], ["t20", 20]]) {
    for (const t of [0, 115, 331]) close(asset(id).returns[t], bond(Y[id][t], Y[id][t + 1], m), 5e-7);
  }
  // February 1999, 10-year: 4.66% to 5.29%.
  close(asset("t10").returns[0], -0.044248, 1e-6);
  for (const t of [0, 200, 331]) close(BILLS.returns[t], Y.bills[t] / 1200, 5e-7);
  // A yen deposit in September 2026: 159.74 to 157.25 yen per dollar, with 1% a year for a month.
  close(asset("jpy").returns[331], (159.74 / 157.25) * (1 + 1 / 1200) - 1, 5e-7);
  // A sterling deposit in September 2026: 1.3550 to 1.3267 dollars per pound, with 3.75% a year for a month.
  close(asset("gbp").returns[331], (1.3267 / 1.355) * (1 + 3.75 / 1200) - 1, 5e-7);
  // The three spells in which the Bank of Japan set no rate are filled with zero, and nothing else is.
  const P = ASSETS.inputs.policy.jpy; // P[t] is the rate at the end of month t of BASE.., earned the month after
  assert.equal(P[1], 0.25); // end of February 1999, from the BIS
  assert.equal(P[2], 0); // end of March 1999, inside the first blank spell
  const spells = ASSETS.japanZero;
  assert.deepEqual(spells, [["1999-03", "2000-07"], ["2001-04", "2006-02"], ["2013-05", "2016-08"]]);
  // 17 + 59 + 40 filled months, and four more (March to June 2006) in which the BIS itself gives 0%.
  assert.equal(P.filter((v) => v === 0).length, 17 + 59 + 40 + 4);
});

test("the modelled 10-year Treasury against a separately published series", () => {
  // Damodaran, "Historical Returns on Stocks, Bonds and Bills" (histretSP.xls, read 14 October 2026), US T. Bond
  // (10-year), calendar years, from a once-a-year repricing of a par bond: 20.10% in 2008, -9.10% in 2013,
  // -17.83% in 2022. Monthly repricing compounds a little differently, so agreement within 1.5 points is the test.
  const t10 = asset("t10").returns;
  const year = (y) => t10.reduce((g, r, i) => (monthLabel(i).endsWith(String(y)) ? g * (1 + r) : g), 1) - 1;
  for (const [y, published] of [[2008, 20.1], [2013, -9.1], [2022, -17.83]]) close(year(y) * 100, published, 1.5);
});

/* ------------------------------------------------------------------ the rules */

test("trailing return: compounding over the window that ends `skip` months before t", () => {
  const c = cumLog([0.1, -0.05, 0.2, 0.01]);
  close(trailing(c, 3, 2, 0), 0.95 * 1.2 - 1);   // months 1 and 2
  close(trailing(c, 3, 2, 1), 1.1 * 0.95 - 1);   // months 0 and 1
  close(trailing(c, 4, 4, 0), 1.1 * 0.95 * 1.2 * 1.01 - 1);
  assert.ok(Number.isNaN(trailing(c, 2, 3, 0)));  // not enough history
});

test("time-series rules hold an asset after it beat bills (momentum) or lagged them (reversal), with 1/n each", () => {
  const data = toy([[0.05, 0.05, 0], [-0.02, -0.01, 0], [0.004, 0.006, 0]], [0.005, 0.005, 0]);
  // Two months of history at t = 2: asset 0 earned 10.25%, asset 1 -2.98%, asset 2 1.0024%, bills 1.0025%.
  assert.deepEqual(weights(data, { rule: "tsmom", lookback: 2, skip: 0, k: 0 }, 2), [1 / 3, 0, 0]);
  assert.deepEqual(weights(data, { rule: "tsrev", lookback: 2, skip: 0, k: 0 }, 2), [0, 1 / 3, 1 / 3]);
  // A tie with bills holds bills under both rules.
  const tie = toy([[0.01, 0.01]], [0.01, 0.01]);
  assert.deepEqual(weights(tie, { rule: "tsmom", lookback: 1, skip: 0, k: 0 }, 1), [0]);
  assert.deepEqual(weights(tie, { rule: "tsrev", lookback: 1, skip: 0, k: 0 }, 1), [0]);
});

test("cross-sectional rules hold the k best or worst, 1/k each, ties to the asset listed first", () => {
  const data = toy([[0.03, 0], [0.01, 0], [0.03, 0], [-0.02, 0]], [0, 0]);
  assert.deepEqual(weights(data, { rule: "csmom", lookback: 1, skip: 0, k: 2 }, 1), [0.5, 0, 0.5, 0]);
  assert.deepEqual(weights(data, { rule: "csmom", lookback: 1, skip: 0, k: 1 }, 1), [1, 0, 0, 0]);
  assert.deepEqual(weights(data, { rule: "csrev", lookback: 1, skip: 0, k: 1 }, 1), [0, 0, 0, 1]);
  assert.deepEqual(weights(data, { rule: "csrev", lookback: 1, skip: 0, k: 2 }, 1), [0, 0.5, 0, 0.5]);
});

test("backtest by hand: turnover from the drifted weights, costs paid before investing", () => {
  // One asset: +10%, +10%, -20%; bills 0. Momentum with a one-month look-back from month 1.
  const data = toy([[0.1, 0.1, -0.2]], [0, 0, 0]);
  const v = { rule: "tsmom", lookback: 1, skip: 0, k: 0 };
  const b = backtest(data, v, 1, 2, 0.01);
  // Month 1: buy from cash, turnover 1, return (1 - 0.01)(1.1) - 1. Month 2: still in (month 1 beat bills), no trade.
  close(b.turnover[0], 1);
  close(b.net[0], 0.99 * 1.1 - 1);
  close(b.turnover[1], 0);
  close(b.net[1], -0.2);
  // Reversal is in bills both months and never trades.
  const r = backtest(data, { ...v, rule: "tsrev" }, 1, 2, 0.01);
  assert.deepEqual([...r.net], [0, 0]);
  assert.deepEqual([...r.turnover], [0, 0]);
});

test("a held position drifts, so even an unchanged target trades a little", () => {
  // Two assets held half and half: after +20% and 0% the weights are 0.6/1.2... = 0.545 and 0.455, so rebalancing trades 0.0909.
  const data = toy([[0.1, 0.2, 0], [0.1, 0, 0]], [0, 0, 0]);
  const b = backtest(data, { rule: "tsmom", lookback: 1, skip: 0, k: 0 }, 1, 2, 0);
  close(b.turnover[0], 1);
  // Month 2 targets: asset 0 earned 20% (in), asset 1 earned 0% = bills (out). Drifted weights 0.6/1.1 and 0.5/1.1.
  close(b.turnover[1], Math.abs(0.5 - 0.6 / 1.1) + Math.abs(0 - 0.5 / 1.1));
});

test("buy-and-hold: equal amounts, never rebalanced, one entry cost", () => {
  const data = toy([[0.1, 0.1], [0, -0.5]], [0, 0]);
  const b = buyAndHold(data, 0, 1, 0.002);
  close(b.net[0], 0.998 * 1.05 - 1);
  close(b.net[1], (0.5 * 1.21 + 0.5 * 0.5) / (0.5 * 1.1 + 0.5 * 1) - 1);
});

test("no look-ahead: changing later returns never changes earlier positions or results", () => {
  const data = prepare(RISKY.map((a) => a.id));
  const cut = 200;
  const altered = prepare(RISKY.map((a) => a.id));
  for (const r of altered.R) for (let t = cut; t < r.length; t++) r[t] = (t % 2 ? 0.3 : -0.25);
  altered.cums = altered.R.map(cumLog);
  for (const v of [{ rule: "tsmom", lookback: 12, skip: 0, k: 0 }, { rule: "csrev", lookback: 3, skip: 1, k: 4 }]) {
    const a = backtest(data, v, WARMUP, cut - 1, 0.001), b = backtest(altered, v, WARMUP, cut - 1, 0.001);
    assert.deepEqual([...a.net], [...b.net]);
    // The position for month `cut` is decided before month `cut` is known.
    assert.deepEqual(weights(data, v, cut), weights(altered, v, cut));
  }
});

/* ------------------------------------------------------------------ measures */

test("Sharpe ratio, drawdown and the annualised summary by hand", () => {
  const r = [0.02, -0.01, 0.03, 0.0], b = [0.01, 0.01, 0.01, 0.01];
  const e = [0.01, -0.02, 0.02, -0.01];
  close(sharpe(r, b), stats.mean(e) / stats.sd(e));
  assert.equal(sharpe([0.01, 0.01], [0.01, 0.01]), 0);
  const d = maxDrawdown([0.1, -0.2, 0.05, -0.1, 0.5]);
  // Wealth 1.1, 0.88, 0.924, 0.8316, 1.2474: the worst is 0.8316 / 1.1 - 1 = -24.4%, from month 0 to month 3.
  close(d.depth, 0.8316 / 1.1 - 1);
  assert.equal(d.peak, 0);
  assert.equal(d.trough, 3);
  assert.equal(maxDrawdown([0.01, 0.02]).depth, 0);
  // A fall in the first month counts from the starting 1.
  close(maxDrawdown([-0.1, 0.05]).depth, -0.1);
  const s = summary(r, b);
  close(s.mean, 12 * stats.mean(r));
  close(s.vol, Math.sqrt(12) * stats.sd(r));
  close(s.sharpe, Math.sqrt(12) * sharpe(r, b));
  close(s.cagr, (1.02 * 0.99 * 1.03) ** 3 - 1);
});

test("the grid: 48 rules per asset, and no cross-sectional rules for one asset", () => {
  assert.equal(grid(10).length, 480);
  assert.equal(grid(4).length, 192);
  assert.equal(grid(1).length, 48);
  assert.ok(grid(1).every((v) => v.rule.startsWith("ts")));
  assert.equal(new Set(grid(6).map((v) => JSON.stringify(v))).size, 288);
  assert.equal(describe({ rule: "csmom", lookback: 3, skip: 1, k: 2 }), "Cross-sectional momentum, 3-month look-back, skipping the latest month, 2 held");
  assert.equal(RULES.length, 4);
});

test("normal quantile against published values", () => {
  close(normalQuantile(0.975), 1.959963985, 1e-8);
  close(normalQuantile(0.5), 0, 1e-12);
  close(normalQuantile(0.001), -3.090232306, 1e-8);
  close(normalQuantile(0.99), 2.326347874, 1e-8);
  assert.equal(normalQuantile(0), -Infinity);
  assert.ok(Number.isNaN(normalQuantile(1.5)));
});

test("expected best of N zero-skill trials: the formula against simulation", () => {
  const r = rng(11);
  for (const N of [10, 100, 1000]) {
    let total = 0;
    const reps = N === 10 ? 20000 : 3000;
    for (let k = 0; k < reps; k++) { let m = -Infinity; for (let i = 0; i < N; i++) m = Math.max(m, r.normal()); total += m; }
    // The approximation is within 3% of the simulated mean of the largest of N standard normals (it runs high for small N).
    close(expectedMaxSharpe(N, 1), total / reps, 0.03 * (total / reps));
  }
  // Exact expected maxima (Tippett 1925): 1.5388 for 10 and 2.5076 for 100. The formula gives 1.5746 and 2.5306.
  close(expectedMaxSharpe(10, 1), 1.5746, 1e-4);
  close(expectedMaxSharpe(100, 1), 2.5306, 1e-4);
  close(expectedMaxSharpe(100, 4), 2 * expectedMaxSharpe(100, 1), 1e-12);
  assert.ok(Number.isNaN(expectedMaxSharpe(1, 1)));
});

test("probability of backtest overfitting: 1 when the training winner always loses, 0 when one rule is best everywhere", () => {
  // Two blocks of three months. Rule A is good in block 0 and bad in block 1; rule B is the opposite.
  const A = [0.01, 0.02, 0.015, -0.01, -0.02, -0.015], B = [-0.01, -0.02, -0.015, 0.01, 0.02, 0.015];
  const swap = pbo([A, B], 2);
  assert.equal(swap.splits, 2);
  assert.equal(swap.pbo, 1);
  // Rule C beats D in both blocks.
  const C = [0.02, 0.03, 0.01, 0.02, 0.03, 0.01], D = [0.0, 0.01, -0.01, 0.0, 0.01, -0.01];
  assert.equal(pbo([C, D], 2).pbo, 0);
  // Ten blocks give C(10, 5) = 252 splits, and months that do not fill a block are dropped from the start.
  const r = rng(3);
  const noise = () => Array.from({ length: 20 }, () => Array.from({ length: 153 }, () => r.normal(0, 0.01)));
  const p = pbo(noise());
  assert.equal(p.splits, 252);
  assert.equal(p.blockMonths, 15);
  assert.equal(p.droppedMonths, 3);
  // For rules with no skill the training winner lands below the median about half the time. One data set can be far
  // from a half (its 252 splits share the same months), so the test averages forty.
  const mean = stats.mean(Array.from({ length: 40 }, () => pbo(noise()).pbo));
  assert.ok(mean > 0.4 && mean < 0.6, `mean pbo ${mean}`);
});

test("reshuffling keeps every month's returns together and leaves the held-out months alone", () => {
  const data = prepare(["t10", "eur"]);
  const split = indexOfYear(2013);
  const s = shuffled(data, split, rng(5));
  const key = (d, t) => `${d.R[0][t]}|${d.R[1][t]}|${d.B[t]}`;
  const before = Array.from({ length: split }, (_, t) => key(data, t)).sort();
  const after = Array.from({ length: split }, (_, t) => key(s, t)).sort();
  assert.deepEqual(after, before);
  for (let t = split; t < data.T; t++) assert.equal(key(s, t), key(data, t));
  assert.notDeepEqual(Array.from({ length: 20 }, (_, t) => key(s, t)), Array.from({ length: 20 }, (_, t) => key(data, t)));
  const v = shuffleVerdict(0.2, [0.1, 0.2, 0.3, 0.15]);
  assert.equal(v.atLeast, 2);
  close(v.share, 0.5);
});

/* ------------------------------------------------------------------ the page's numbers */

test("the finding: all ten assets, test from January 2013, 0.1% trading cost", () => {
  const data = prepare(RISKY.map((a) => a.id));
  const split = indexOfYear(2013);
  const scored = scoreGrid(data, split, 0.001);
  const o = overfitting(scored);
  const ann = Math.sqrt(12);
  assert.equal(o.N, 480);
  assert.equal(o.T, split - WARMUP);
  assert.equal(describe(o.winner.v), "Cross-sectional momentum, 3-month look-back, 6 held");
  assert.equal((o.winner.srIn * ann).toFixed(2), "0.78");
  assert.equal((o.winner.srOut * ann).toFixed(2), "-0.51");
  assert.equal(o.outRank, 426);
  assert.equal(Math.round(o.pbo.pbo * 100), 81);
  // Twenty reshufflings of the training months, seed 63, the page's own.
  const r = rng(63);
  const rules = scored.map((s) => s.v);
  const bests = Array.from({ length: 20 }, () => bestInSample(shuffled(data, split, r), split, 0.001, rules));
  const sv = shuffleVerdict(o.winner.srIn, bests);
  assert.equal((sv.mean * ann).toFixed(2), "0.79");
  assert.equal(sv.atLeast, 9);
  // Buy-and-hold and the opening rule over the held-out months.
  const bh = summary(buyAndHold(data, split, T - 1, 0.001).net, data.B.subarray(split));
  assert.equal(bh.sharpe.toFixed(2), "-0.38");
  const e = evaluateRule(data, { rule: "tsmom", lookback: 12, skip: 0, k: 3 }, split, 0.001);
  assert.equal(e.outSample.sharpe.toFixed(2), "-0.32");
  assert.equal(e.inSample.sharpe.toFixed(2), "0.72");
});

test("one asset still works, with only the time-series rules", () => {
  const data = prepare(["jpy"]);
  const split = indexOfYear(2010);
  const o = overfitting(scoreGrid(data, split, 0));
  assert.equal(o.N, 48);
  assert.ok(o.winner.v.rule.startsWith("ts"));
  assert.ok(Number.isFinite(o.winner.srOut));
  assert.ok(o.pbo.pbo >= 0 && o.pbo.pbo <= 1);
});

test("a higher trading cost never raises a rule's return", () => {
  const data = prepare(["t5", "aud", "chf"]);
  const split = indexOfYear(2015);
  const v = { rule: "csmom", lookback: 1, skip: 0, k: 1 };
  const cheap = evaluateRule(data, v, split, 0), dear = evaluateRule(data, v, split, 0.02);
  assert.ok(dear.outSample.cagr < cheap.outSample.cagr);
  assert.ok(cheap.outSample.turnover > 0);
});
