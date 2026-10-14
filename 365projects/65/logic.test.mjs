import test from "node:test";
import assert from "node:assert/strict";
import { stats } from "../kit/kit.js";
import { ASSETS } from "../data/assets.js";
import { ALL, T, BILLS, monthLabel, startOfYear, endOfYear, parseAmount, weightsFrom, portfolioReturns, drawdown, measures, riskShares } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const amountsOf = (o) => ALL.map((a) => o[a.id] || 0);
const fake = (rows) => rows.map((returns, i) => ({ id: `a${i}`, returns }));

test("typed amounts: figures, separators and a currency sign; everything else refused with a reason", () => {
  assert.deepEqual(parseAmount("2500"), { value: 2500 });
  assert.deepEqual(parseAmount("2,500.50"), { value: 2500.5 });
  assert.deepEqual(parseAmount(" $ 1 000 "), { value: 1000 });
  assert.deepEqual(parseAmount("US$ 40,000"), { value: 40000 });
  // Every figure the page prints is in dollars, so another currency's sign is refused, not silently read as dollars.
  for (const s of ["₹40,000", "£500", "€ 1,000", "¥100"]) assert.match(parseAmount(s).error, /another currency/);
  // The Indian grouping is still accepted when the amount is in dollars.
  assert.deepEqual(parseAmount("$25,00,000"), { value: 2500000 });
  assert.deepEqual(parseAmount(""), { value: 0 });
  assert.deepEqual(parseAmount(".5"), { value: 0.5 });
  assert.match(parseAmount("-300").error, /negative/);
  assert.match(parseAmount("abc").error, /not a number/);
  assert.match(parseAmount("1e5").error, /not a number/);
  assert.match(parseAmount(".").error, /not a number/);
  // Separators only in real groupings: threes, or the Indian lakh and crore.
  assert.deepEqual(parseAmount("1,00,000"), { value: 100000 });
  assert.deepEqual(parseAmount("2,50,00,000"), { value: 25000000 });
  assert.deepEqual(parseAmount("12_500"), { value: 12500 });
  assert.match(parseAmount("1,2,3").error, /not a number/);
  assert.match(parseAmount("12,34").error, /not a number/);
  assert.match(parseAmount("1.2.3").error, /not a number/);
  assert.match(parseAmount("1,000.5.5").error, /not a number/);
  assert.match(parseAmount("2000000000000").error, /trillion/);
  assert.match(parseAmount("9".repeat(300)).error, /too long/);
  assert.equal(weightsFrom([0, 0]), null);
  assert.deepEqual(weightsFrom([1, 3]), [0.25, 0.75]);
});

test("portfolio returns: rebalanced is the weighted average; bought once drifts with each holding", () => {
  const A = fake([[0.1, 0.1], [0, -0.5]]);
  const reb = portfolioReturns([0.5, 0.5], 0, 1, "rebalanced", A);
  close(reb[0], 0.05);
  close(reb[1], -0.2);
  const drift = portfolioReturns([0.5, 0.5], 0, 1, "drift", A);
  close(drift[0], 0.05);
  close(drift[1], (0.55 * 1.1 + 0.5 * 0.5) / 1.05 - 1);
  // A single holding is the same either way and equals the asset.
  const one = amountsOf({ t10: 7 });
  const w = weightsFrom(one);
  const t10 = ALL.find((a) => a.id === "t10").returns;
  assert.deepEqual([...portfolioReturns(w, 0, T - 1)], t10);
  portfolioReturns(w, 0, T - 1, "drift").forEach((v, t) => close(v, t10[t], 1e-12));
});

test("drawdown by hand: peak, trough and recovery", () => {
  // Values 1.1, 0.88, 0.924, 0.8316, 1.2474: the worst is 0.8316 / 1.1 - 1, from month 0 to month 3, back above by month 4.
  const d = drawdown([0.1, -0.2, 0.05, -0.1, 0.5]);
  close(d.depth, 0.8316 / 1.1 - 1);
  assert.equal(d.peakAt, 0);
  assert.equal(d.troughAt, 3);
  assert.equal(d.recoveredAt, 4);
  // A fall from the very start counts from the starting value, and a fall that never recovers says so.
  const e = drawdown([-0.1, 0.05, -0.2]);
  close(e.depth, 0.9 * 1.05 * 0.8 - 1);
  assert.equal(e.peakAt, -1);
  assert.equal(e.recoveredAt, -1);
  // Only gains: no drawdown at all.
  const g = drawdown([0.01, 0.02]);
  assert.equal(g.depth, 0);
  assert.equal(g.troughAt, -1);
  // A tie with the old peak counts as getting back.
  const h = drawdown([0.25, -0.2, 0.25]);
  assert.equal(h.recoveredAt, 2);
});

test("the three measures by hand", () => {
  const r = [0.02, -0.01, 0.03, 0.0], rf = [0.001, 0.001, 0.002, 0.002];
  const m = measures(r, rf);
  const ex = r.map((v, i) => v - rf[i]);
  close(m.vol, Math.sqrt(12) * stats.sd(r));
  // sd with T - 1: the mean is 0.01, squared deviations 0.0001, 0.0004, 0.0004, 0.0001, sum 0.001, / 3.
  close(m.sdMonthly, Math.sqrt(0.001 / 3));
  close(m.sharpe, (Math.sqrt(12) * stats.mean(ex)) / stats.sd(ex));
  close(m.cagr, (1.02 * 0.99 * 1.03) ** 3 - 1);
  close(m.mean, 12 * 0.01);
  close(m.rfYear, 12 * 0.0015);
  assert.equal(m.worstMonth, 1);
  assert.equal(m.bestMonth, 2);
  // A portfolio of bills has no excess return to divide: the Sharpe ratio is undefined, not a number.
  assert.ok(Number.isNaN(measures([0.001, 0.002], [0.001, 0.002]).sharpe));
});

test("risk shares add up to one, and a single holding carries all of it", () => {
  const w = weightsFrom(amountsOf({ t10: 1, eur: 1, jpy: 2 }));
  const s = riskShares(w, 0, T - 1);
  close(stats.sum(s), 1, 1e-12);
  assert.equal(s[ALL.findIndex((a) => a.id === "t2")], 0);
  const one = riskShares(weightsFrom(amountsOf({ aud: 5 })), 0, T - 1);
  close(one[ALL.findIndex((a) => a.id === "aud")], 1, 1e-12);
  // By hand for two uncorrelated assets with variances 1 and 4 and weights 1/2: shares 1/5 and 4/5.
  const A = fake([[1, -1, 1, -1], [2, 2, -2, -2]]);
  const two = riskShares([0.5, 0.5], 0, 3, A);
  close(two[0], 0.2, 1e-12);
  close(two[1], 0.8, 1e-12);
});

test("months and windows", () => {
  assert.equal(monthLabel(-1), "Jan 1999");
  assert.equal(monthLabel(0), "Feb 1999");
  assert.equal(monthLabel(T - 1), "Sep 2026");
  assert.equal(monthLabel(startOfYear(2020)), "Jan 2020");
  assert.equal(monthLabel(endOfYear(2022)), "Dec 2022");
  assert.equal(BILLS.returns.length, T);
});

test("the source's own figures behind the 20-year bond's fall", () => {
  // US Treasury, Daily Treasury Par Yield Curve Rates (the source of H.15's constant-maturity yields): 20 Yr 0.98 on
  // 31 July 2020 and 5.21 on 31 October 2023.
  const Y = ASSETS.inputs.yields.t20; // month-ends from January 1999
  const at = (label) => Y[[...Array(Y.length).keys()].find((k) => monthLabel(k - 1) === label)];
  assert.equal(at("Jul 2020"), 0.98);
  assert.equal(at("Oct 2023"), 5.21);
});

test("the finding: the opening portfolio and the 20-year Treasury, February 1999 to September 2026", () => {
  const rf = BILLS.returns;
  const open = measures(portfolioReturns(weightsFrom(amountsOf({ t10: 4000, eur: 2000, jpy: 2000, aud: 2000 })), 0, T - 1), rf);
  assert.equal((open.vol * 100).toFixed(2), "6.27");
  assert.equal(open.sharpe.toFixed(2), "0.08");
  assert.equal((open.drawdown.depth * 100).toFixed(1), "-21.9");
  assert.equal(monthLabel(open.drawdown.peakAt), "Dec 2020");
  assert.equal(monthLabel(open.drawdown.troughAt), "Oct 2022");
  assert.equal(open.drawdown.recoveredAt, -1);
  const bond = measures(portfolioReturns(weightsFrom(amountsOf({ t20: 10000 })), 0, T - 1), rf);
  assert.equal((bond.vol * 100).toFixed(2), "11.54");
  assert.equal(bond.sharpe.toFixed(2), "0.18");
  assert.equal((bond.drawdown.depth * 100).toFixed(1), "-42.3");
  assert.equal(monthLabel(bond.drawdown.peakAt), "Jul 2020");
  assert.equal(monthLabel(bond.drawdown.troughAt), "Oct 2023");
  assert.equal(bond.drawdown.recoveredAt, -1);
  // Its worst single month.
  assert.equal(monthLabel(bond.worstMonth), "Jan 2009");
  // The 2-year note has about the same Sharpe ratio with a fall of under 6%.
  const short = measures(portfolioReturns(weightsFrom(amountsOf({ t2: 1 })), 0, T - 1), rf);
  assert.equal(short.sharpe.toFixed(2), "0.19");
  assert.equal((short.drawdown.depth * 100).toFixed(1), "-5.8");
});
