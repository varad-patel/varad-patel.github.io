import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { LIMITS, EXAMPLES, ibeta, tCdf, tQuantile, toNumber, toDay, decodeBytes, parseTable, profile, guessRoles, prepare, fit, logCurve, linearCurve, verdict, constantAdvice, linearAdvice, bends, byGroup, analyse } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const example = (id) => EXAMPLES.find((e) => e.id === id);
const table = (rows) => rows.map((r) => r.join(",")).join("\n");
/** A table with an exact power law Q = A P^e and optional log noise e_i. */
const power = (prices, e, A = 100, noise = []) => table([["price", "quantity"], ...prices.map((p, i) => [p, A * p ** e * Math.exp(noise[i] || 0)])]);

test("Student's t: the printed table, and two cases with a closed form", () => {
  // Two-sided 5% points from any statistics table.
  for (const [df, t] of [[1, 12.7062], [2, 4.30265], [5, 2.57058], [10, 2.22814], [30, 2.04227], [120, 1.97993]]) close(tQuantile(0.975, df), t, 2e-5);
  close(tQuantile(0.95, 5), 2.01505, 2e-5);
  close(tQuantile(0.975, 1e7), 1.959964, 1e-4);          // the normal value
  close(tCdf(1, 1), 0.75, 1e-12);                        // Cauchy: 1/2 + atan(1)/pi
  close(tCdf(1, 2), 0.5 + 1 / (2 * Math.sqrt(3)), 1e-12); // df 2: 1/2 + t / (2 sqrt(2 + t^2))
  close(tCdf(-1, 2), 0.5 - 1 / (2 * Math.sqrt(3)), 1e-12);
  assert.equal(tCdf(0, 7), 0.5);
  assert.equal(tQuantile(0.5, 7), 0);
  close(tQuantile(0.025, 10), -2.22814, 2e-5);
  close(tCdf(tQuantile(0.9, 4), 4), 0.9, 1e-10);
  for (const bad of [[0, 5], [1, 5], [0.975, 0], [NaN, 5], [0.975, NaN]]) assert.ok(Number.isNaN(tQuantile(...bad)));
  close(ibeta(0.5, 2, 2), 0.5, 1e-12);
  close(ibeta(0.25, 1, 1), 0.25, 1e-12);
  assert.equal(ibeta(0, 2, 3), 0); assert.equal(ibeta(1, 2, 3), 1);
});

test("an exact power law gives back its elasticity, with no width to the interval", () => {
  const r = analyse(power([1, 2, 3, 4, 5, 6, 8, 10], -1.5));
  assert.ok(!r.error, r.error);
  close(r.fit.log.elasticity, -1.5, 1e-9);
  close(r.fit.log.se, 0, 1e-7);
  close(r.fit.log.r2, 1, 1e-9);
  assert.equal(r.fit.n, 8); assert.equal(r.fit.df, 6);
  assert.deepEqual(r.fit.range, [1, 10]);
  close(logCurve(r.fit, 4).q, 100 * 4 ** -1.5, 1e-7);
  assert.equal(verdict(r.fit), "elastic");
});

test("log-log fit by hand: slope, standard error and t interval", () => {
  // ln P = x, ln Q = 2 - 1.2 x + e, with e chosen to sum to zero and to be orthogonal to x, so the fit is exactly -1.2.
  const x = [-0.3, -0.2, -0.1, 0, 0, 0.1, 0.2, 0.3], e = [0.05, -0.05, 0, 0, 0, 0, -0.05, 0.05];
  const csv = table([["price", "quantity"], ...x.map((v, i) => [Math.exp(v), Math.exp(2 - 1.2 * v + e[i])])]);
  const f = analyse(csv).fit;
  close(f.log.elasticity, -1.2, 1e-9);
  // RSS = 4 x 0.05^2 = 0.01 on 6 degrees of freedom; Sxx = 0.28.
  const se = Math.sqrt(0.01 / 6 / 0.28);
  close(f.log.se, se, 1e-9);
  close(f.log.sigma, Math.sqrt(0.01 / 6), 1e-9);
  close(f.tq, 2.446912, 1e-5);
  close(f.log.low, -1.2 - 2.446912 * se, 1e-5);
  close(f.log.high, -1.2 + 2.446912 * se, 1e-5);
  close(f.log.lnP0, 0, 1e-12); close(f.log.lnQ0, 2, 1e-9);
  // The curve at P = 1 is exp(2); its band there is t sigma / sqrt(n) wide in logs, and wider away from the mean.
  const at1 = logCurve(f, 1);
  close(at1.q, Math.exp(2), 1e-8);
  close(Math.log(at1.high / at1.q), 2.446912 * Math.sqrt(0.01 / 6 / 8), 1e-6);
  const at2 = logCurve(f, 1.3);
  assert.ok(at2.high / at2.low > at1.high / at1.low);
  assert.equal(verdict(f), "elastic");   // -1.389 to -1.011: wholly below -1
});

test("straight-line fit by hand: slope, revenue peak and Fieller's interval", () => {
  // Q = 100 - 10 (P - 4) + e, e orthogonal to P and summing to zero.
  const p = [1, 2, 3, 4, 4, 5, 6, 7], e = [3, -3, 0, 0, 0, 0, -3, 3];
  const csv = table([["price", "quantity"], ...p.map((v, i) => [v, 100 - 10 * (v - 4) + e[i]])]);
  const f = analyse(csv).fit;
  close(f.linear.slope, -10, 1e-9);
  close(f.linear.p0, 4, 1e-12); close(f.linear.q0, 100, 1e-9);
  close(f.linear.se, Math.sqrt(36 / 6 / 28), 1e-9);
  close(linearCurve(f, 7), 70, 1e-9);
  const a = linearAdvice(f, 2);
  assert.ok(a.usable);
  // Revenue P (140 - 10 P) peaks at P = 7; profit (P - 2)(140 - 10 P) at P = 8.
  close(a.revenue.price, 7, 1e-9);
  close(a.profit.price, 8, 1e-9);
  // Fieller by hand: (b^2 - t^2 Vb) u^2 + 2 q0 b u + (q0^2 - t^2 Vq) <= 0 with u = 2P - p0.
  const t2 = 2.446912 ** 2, Vb = 6 / 28, Vq = 6 / 8;
  const A = 100 - t2 * Vb, B = -2000, C = 10000 - t2 * Vq, d = Math.sqrt(B * B - 4 * A * C);
  close(a.revenue.low, ((-B - d) / (2 * A) + 4) / 2, 1e-4);
  close(a.revenue.high, ((-B + d) / (2 * A) + 4) / 2, 1e-4);
  close(a.revenue.low, 6.48145, 1e-3);
  close(a.revenue.high, 7.64852, 1e-3);
  assert.ok(a.revenue.low < 7 && 7 < a.revenue.high);
  close(a.profit.low, a.revenue.low + 1, 1e-12);
  assert.equal(a.revenue.inside, true);    // 7 is the highest price tried
  assert.equal(a.profit.inside, false);    // 8 is beyond it
  assert.equal(linearAdvice(f).profit, null);
});

test("the verdict follows the interval, edge by edge", () => {
  const v = (low, high) => verdict({ log: { low, high } });
  assert.equal(v(-2, -1.2), "elastic");
  assert.equal(v(-2, -1), "unclear");       // the interval reaches -1
  assert.equal(v(-1.3, -0.7), "unclear");
  assert.equal(v(-1, -0.5), "unclear");
  assert.equal(v(-0.9, -0.1), "inelastic");
  assert.equal(v(-0.9, 0), "flat");         // the interval reaches 0
  assert.equal(v(-1.5, 0.2), "flat");
  assert.equal(v(0, 0.5), "flat");
  assert.equal(v(0.1, 0.5), "upward");
});

test("constant elasticity never yields a revenue-maximising price, and a profit price only when demand is elastic", () => {
  const f = (e, half, range = [2, 4]) => ({ log: { elasticity: e, low: e - half, high: e + half }, range });
  // Elastic: revenue falls as price rises, so the best observed price is the lowest. Profit price c e / (1 + e).
  const a = constantAdvice(f(-2, 0.5), 3);
  assert.deepEqual([a.verdict, a.revenue, a.best], ["elastic", "falls", 2]);
  close(a.profit.price, 6, 1e-12);                         // 3 x -2 / -1
  close(a.profit.low, 3 * -2.5 / -1.5, 1e-12);             // 5
  close(a.profit.high, 3 * -1.5 / -0.5, 1e-12);            // 9
  close(a.profit.markup, 2, 1e-12);
  assert.equal(a.profit.inside, false);
  assert.equal(constantAdvice(f(-2, 0.5, [5, 7]), 3).profit.inside, true);
  // Elastic estimate but the interval reaches -1: no upper limit.
  const u = constantAdvice(f(-1.2, 0.3), 3);
  assert.equal(u.verdict, "unclear"); assert.equal(u.revenue, null); assert.equal(u.best, null);
  close(u.profit.price, 18, 1e-9);
  assert.equal(u.profit.high, Infinity);
  // Inelastic: revenue rises with price; no profit-maximising price exists in the model.
  const i = constantAdvice(f(-0.4, 0.1), 3);
  assert.deepEqual([i.verdict, i.revenue, i.best], ["inelastic", "rises", 4]);
  assert.deepEqual(i.profit, { none: "inelastic" });
  assert.deepEqual(constantAdvice(f(-0.9, 0.3), 3).profit, { none: "inelastic" });   // unclear, estimate above -1
  assert.deepEqual(constantAdvice(f(-0.1, 0.3), 3).profit, { none: "flat" });
  assert.deepEqual(constantAdvice(f(0.8, 0.3), 3).profit, { none: "upward" });
  assert.deepEqual(constantAdvice(f(-2, 0.5), 0).profit, { none: "cost" });
  assert.equal(constantAdvice(f(-2, 0.5)).profit, null);
  // Exactly -1: unit elasticity, revenue flat, no finite profit price.
  assert.deepEqual(constantAdvice(f(-1, 0.2), 3).profit, { none: "inelastic" });
});

test("a straight line that slopes up, or whose slope might be zero, supports no price", () => {
  const up = analyse(table([["price", "quantity"], ...[1, 2, 3, 4, 5, 6, 7, 8].map((p, i) => [p, 10 + 3 * p + (i % 2 ? 1 : -1)])])).fit;
  assert.deepEqual(linearAdvice(up, 1), { usable: false, bends: false, supported: false, reason: "upward", revenue: null, profit: null });
  // Slope exactly -0.5 with a standard error of 0.77: downward, but zero is well inside the interval.
  const p = [1, 2, 3, 4, 4, 5, 6, 7], e = [5, -5, 0, 0, 0, 0, -5, 5];
  const noisy = analyse(table([["price", "quantity"], ...p.map((v, i) => [v, 50 - 0.5 * (v - 4) + e[i]])])).fit;
  close(noisy.linear.slope, -0.5, 1e-9);
  close(noisy.linear.se, Math.sqrt(100 / 6 / 28), 1e-9);
  assert.ok(noisy.linear.low < 0 && noisy.linear.high > 0);
  const a = linearAdvice(noisy, 1);
  assert.equal(a.usable, false); assert.equal(a.reason, "slope");
  // The formula still has an answer, (4 + 100) / 2 = 52, far beyond the data; it carries no interval and the page does not offer it.
  close(a.revenue.price, 52, 1e-9);
  assert.deepEqual([a.revenue.low, a.revenue.high, a.revenue.inside], [null, null, false]);
});

test("the examples are simulated, and the method recovers the truth only where it should", () => {
  assert.deepEqual(EXAMPLES.map((e) => e.id), ["cafe", "stall", "bus", "shops", "busy", "trend"]);
  for (const ex of EXAMPLES) { assert.match(ex.about, /^Simulated data, made by this page/); assert.ok(ex.about.includes(String(ex.truth ?? ex.peak).replace("-", "−"))); }
  // Five have a constant elasticity and so no revenue peak; the sixth has a straight-line demand curve and a peak at 4.5.
  assert.deepEqual(EXAMPLES.map((e) => [e.truth, e.peak ?? null]), [[-1.8, null], [null, 4.5], [-0.4, null], [-1.5, null], [-1.5, null], [-1.2, null]]);
  const fitOf = (id, o) => { const r = analyse(example(id).csv, o); assert.ok(!r.error, r.error); return r.fit; };
  const holds = (f, truth) => f.log.low <= truth && truth <= f.log.high;
  // Prices set by rota: recovered.
  const cafe = fitOf("cafe");
  assert.equal(cafe.n, 120);
  assert.equal(cafe.log.elasticity.toFixed(2), "-1.80");
  assert.deepEqual([cafe.log.low.toFixed(2), cafe.log.high.toFixed(2)], ["-1.92", "-1.69"]);
  assert.ok(holds(cafe, -1.8)); assert.equal(verdict(cafe), "elastic");
  const bus = fitOf("bus");
  assert.equal(bus.log.elasticity.toFixed(2), "-0.37");
  assert.ok(holds(bus, -0.4)); assert.equal(verdict(bus), "inelastic");
  // Two shops: pooled, the sign is wrong; with a level for each shop, recovered.
  const pooled = fitOf("shops");
  assert.equal(pooled.log.elasticity.toFixed(2), "1.87"); assert.equal(verdict(pooled), "upward"); assert.ok(!holds(pooled, -1.5));
  const levels = fitOf("shops", { levels: true });
  assert.equal(levels.log.elasticity.toFixed(2), "-1.46"); assert.ok(holds(levels, -1.5)); assert.equal(levels.df, 117);
  // Growing market: without the trend nothing; with it, recovered, and the growth rate too.
  const flat = fitOf("trend");
  assert.equal(verdict(flat), "flat"); assert.ok(!holds(flat, -1.2));
  const trend = fitOf("trend", { trend: true });
  assert.equal(trend.log.elasticity.toFixed(2), "-1.05"); assert.ok(holds(trend, -1.2));
  assert.equal(trend.log.trend.unit, "year");
  close(Math.exp(trend.log.trend.perUnit) - 1, 0.2, 0.005);
  // Prices raised on busy days: not recovered by any setting.
  for (const o of [{}, { trend: true }]) { const busy = fitOf("busy", o); assert.ok(!holds(busy, -1.5)); assert.equal(verdict(busy), "flat"); }
});

test("the finding on the page: -1.80 (interval -1.92 to -1.69) against a true -1.8, and -0.11 against a true -1.5", () => {
  const cafe = analyse(example("cafe").csv).fit, busy = analyse(example("busy").csv).fit;
  assert.equal(example("cafe").truth, -1.8); assert.equal(example("busy").truth, -1.5);
  assert.deepEqual([cafe.log.elasticity, cafe.log.low, cafe.log.high].map((v) => v.toFixed(2)), ["-1.80", "-1.92", "-1.69"]);
  assert.deepEqual([busy.log.elasticity, busy.log.low, busy.log.high].map((v) => v.toFixed(2)), ["-0.11", "-0.25", "0.03"]);
  assert.equal(busy.n, 150);
  // Checked against the textbook formula written out here: slope = Sxy / Sxx on logs.
  const rows = example("cafe").csv.split("\n").slice(1).map((l) => l.split(",").map(Number));
  const x = rows.map((r) => Math.log(r[1])), y = rows.map((r) => Math.log(r[2]));
  const mx = x.reduce((a, b) => a + b) / x.length, my = y.reduce((a, b) => a + b) / y.length;
  const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0), sxy = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0);
  close(cafe.log.elasticity, sxy / sxx, 1e-10);
  const rss = y.reduce((s, v, i) => s + (v - my - (sxy / sxx) * (x[i] - mx)) ** 2, 0);
  close(cafe.log.se, Math.sqrt(rss / 118 / sxx), 1e-10);
});

test("what each example supports as a price", () => {
  const f = (id, o) => analyse(example(id).csv, o).fit;
  // Café at a unit cost of 1: profit price 2.25 (2.09 to 2.45), inside the prices tried; the straight line puts the revenue peak at 2.32.
  const cafe = f("cafe");
  const c = constantAdvice(cafe, 1);
  assert.deepEqual([c.profit.price, c.profit.low, c.profit.high].map((v) => v.toFixed(2)), ["2.25", "2.09", "2.45"]);
  assert.ok(c.profit.inside);
  assert.equal(c.best, 2.2);
  const l = linearAdvice(cafe, 1);
  assert.deepEqual([l.revenue.price, l.revenue.low, l.revenue.high].map((v) => v.toFixed(2)), ["2.32", "2.25", "2.39"]);
  // Bus: inelastic, so revenue rises to the top fare tried; the line's peak, 3.59, is beyond every fare in the data.
  const bus = f("bus");
  assert.deepEqual([constantAdvice(bus, 1).revenue, constantAdvice(bus, 1).best], ["rises", 2.5]);
  assert.equal(linearAdvice(bus).revenue.price.toFixed(2), "3.59");
  assert.equal(linearAdvice(bus).revenue.inside, false);
  // Busy days and the pooled shops support nothing.
  assert.equal(linearAdvice(f("busy")).usable, false);
  assert.equal(constantAdvice(f("busy"), 1).revenue, null);
  assert.equal(linearAdvice(f("shops")).revenue, null);
  // Growing market with the trend: the elasticity interval holds -1, so the profit price has no upper limit.
  const t = constantAdvice(f("trend", { trend: true }), 1);
  assert.equal(t.verdict, "unclear"); assert.equal(t.profit.high, Infinity); assert.equal(t.profit.inside, false);
});

test("the bend, by hand: the coefficient on the squared log price, its standard error and its interval", () => {
  // ln P = x, ln Q = 2 - 1.2 x - 0.8 x^2 + e, with e orthogonal to 1, x and x^2, so the fit returns -1.2 and -0.8 exactly.
  const x = [-0.3, -0.2, -0.1, 0, 0, 0.1, 0.2, 0.3], e = [0.05, -0.05, -0.05, 0, 0, 0.05, 0.05, -0.05];
  assert.ok(Math.abs(e.reduce((s, v, i) => s + v * x[i], 0)) < 1e-15 && Math.abs(e.reduce((s, v, i) => s + v * x[i] ** 2, 0)) < 1e-15);
  const f = analyse(table([["price", "quantity"], ...x.map((v, i) => [Math.exp(v), Math.exp(2 - 1.2 * v - 0.8 * v * v + e[i])])])).fit;
  close(f.bend.coef, -0.8, 1e-9);
  // RSS = 6 x 0.05^2 = 0.015 on 5 degrees of freedom; the squared term's own sum of squares about its mean is 0.0196 - 0.28^2 / 8 = 0.0098.
  const se = Math.sqrt(0.015 / 5 / 0.0098);
  close(f.bend.se, se, 1e-9);
  close(f.bend.low, -0.8 - 2.570582 * se, 1e-5);
  close(f.bend.high, -0.8 + 2.570582 * se, 1e-5);
  // -2.22 to 0.62: zero is inside, so these eight rows do not show a bend, and no revenue peak is offered.
  assert.equal(bends(f), false);
  assert.equal(linearAdvice(f).supported, false);
  // The edges: wholly below zero bends; reaching zero, or no estimate at all, does not.
  assert.equal(bends({ bend: { high: -0.01 } }), true);
  assert.equal(bends({ bend: { high: 0 } }), false);
  assert.equal(bends({ bend: { high: -1e-12 } }), false);   // rounding noise on an exact fit is not a bend
  assert.equal(bends({ bend: null }), false);
});

test("a revenue-maximising price is offered only when the rows show the bend a peak needs", () => {
  const f = (id, o) => analyse(example(id).csv, o).fit;
  // Not one of the constant-elasticity examples supports a price, under any setting: their true curves have no peak.
  for (const [id, o] of [["cafe", {}], ["cafe", { trend: true }], ["bus", {}], ["shops", {}], ["shops", { levels: true }], ["busy", {}], ["busy", { trend: true }], ["trend", {}], ["trend", { trend: true }]]) {
    assert.equal(linearAdvice(f(id, o), 1).supported, false, `${id} ${JSON.stringify(o)}`);
  }
  // The café: the straight line would say 2.32 (2.25 to 2.39), and the bend is -0.09 (-0.81 to 0.63), so it is not offered.
  const cafe = f("cafe");
  assert.deepEqual([cafe.bend.coef, cafe.bend.low, cafe.bend.high].map((v) => v.toFixed(2)), ["-0.09", "-0.81", "0.63"]);
  assert.deepEqual([linearAdvice(cafe).usable, linearAdvice(cafe).bends, linearAdvice(cafe).revenue.inside], [true, false, true]);
  // On the true café curve, 900 P^-1.8, revenue at the straight line's "peak" is lower than at the lowest price tried.
  assert.ok(900 * 2.32 ** -0.8 < 900 * 2.2 ** -0.8);
  // Straight-line demand, Q = 180 - 20 P: the bend is -0.93 (-1.10 to -0.77) and the peak 4.52 (4.41 to 4.64) holds the true 4.5.
  const stall = f("stall");
  assert.equal(stall.n, 120);
  assert.deepEqual([stall.bend.coef, stall.bend.low, stall.bend.high].map((v) => v.toFixed(2)), ["-0.93", "-1.10", "-0.77"]);
  const s = linearAdvice(stall, 1);
  assert.deepEqual([s.usable, s.bends, s.supported], [true, true, true]);
  assert.deepEqual([s.revenue.price, s.revenue.low, s.revenue.high].map((v) => v.toFixed(2)), ["4.52", "4.41", "4.64"]);
  assert.ok(s.revenue.low <= 4.5 && 4.5 <= s.revenue.high);
  close(s.profit.price, s.revenue.price + 0.5, 1e-12);
  assert.equal(verdict(stall), "unclear");   // an average elasticity near -1 over a curve that runs from -0.29 to -3.5
  // An exact power law has no bend and no price, however good the straight line's own fit; an exact straight line has both.
  const exact = analyse(power([1, 2, 3, 4, 5, 6, 8, 10], -1.5)).fit;
  assert.ok(Math.abs(exact.bend.coef) < 1e-9);
  assert.deepEqual([linearAdvice(exact).usable, linearAdvice(exact).supported], [true, false]);
  const lineFit = analyse(table([["price", "quantity"], ...[1, 2, 3, 4, 5, 6, 7, 8].map((p) => [p, 100 - 10 * p])])).fit;
  assert.ok(linearAdvice(lineFit).supported);
  close(linearAdvice(lineFit).revenue.price, 5, 1e-9);
  // Too few rows for the extra term: no bend, no price.
  const few = analyse(power([1, 2, 3, 4, 5, 6, 8, 10], -1.5, 100, [0.1, -0.1, 0.05, 0, -0.05, 0.1, -0.1, 0]), { roles: {} }).fit;
  assert.ok(few.bend);                       // 8 rows, 3 coefficients: 5 degrees of freedom is enough
});

test("simulation check: with a constant elasticity a revenue price is offered in about 1 run in 40, not most of them", () => {
  let offered = 0, wouldHave = 0;
  const runs = 400;
  for (let s = 1; s <= runs; s++) {
    const r = rng(5000 + s);
    const prices = Array.from({ length: 60 }, () => 2 + 2 * r());
    const fitted = analyse(power(prices, -1.8, 900, prices.map(() => r.normal(0, 0.12)))).fit;
    const la = linearAdvice(fitted);
    if (la.supported) offered++;
    if (la.usable && la.revenue.inside) wouldHave++;   // what the page printed before the bend was asked for
  }
  assert.ok(offered <= 0.06 * runs, `offered ${offered} of ${runs}`);
  assert.ok(wouldHave >= 0.9 * runs, `the straight line alone has a peak in range in ${wouldHave} of ${runs}`);
});

test("separate fits for each group", () => {
  const r = analyse(example("shops").csv);
  const g = byGroup(r.prepared);
  assert.deepEqual(g.map((x) => [x.name, x.n, x.elasticity.toFixed(2)]), [["City", 60, "-1.41"], ["Village", 60, "-1.52"]]);
  for (const x of g) assert.ok(x.low <= -1.5 && -1.5 <= x.high);
  assert.deepEqual(byGroup(analyse(example("cafe").csv).prepared), []);
  // A group too small to fit says so.
  const small = table([["g", "price", "quantity"], ...[1, 2, 3, 4, 5, 6, 7, 8].map((p) => ["a", p, 100 / p]), ["b", 2, 40], ["b", 3, 30]]);
  const s = byGroup(analyse(small).prepared);
  assert.deepEqual(s.map((x) => [x.name, x.n, x.error || "ok"]), [["a", 8, "ok"], ["b", 2, "fewer than 5 usable rows"]]);
});

test("reading numbers and dates", () => {
  assert.deepEqual(["1,234.5", "3,5", "45%", "£12", "$ 1 000", "1e3", "-2", "€0,99"].map(toNumber), [1234.5, 3.5, 45, 12, 1000, 1000, -2, 0.99]);
  for (const bad of ["", "abc", "1,2,3", "12abc", "1e999", "--1"]) assert.ok(Number.isNaN(toNumber(bad)), bad);
  const day = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;
  assert.equal(toDay("2025-03-31"), day(2025, 3, 31));
  assert.equal(toDay("2025/3/1"), day(2025, 3, 1));
  assert.equal(toDay("2025-03"), day(2025, 3, 1));
  assert.equal(toDay("31/03/2025"), day(2025, 3, 31));
  assert.equal(toDay("03/31/2025"), day(2025, 3, 31));    // the middle number cannot be a month
  assert.equal(toDay("05/04/2025"), day(2025, 4, 5));     // ambiguous: read day first
  assert.equal(toDay("31.03.2025"), day(2025, 3, 31));
  assert.equal(toDay("2025-03-31T10:00:00"), day(2025, 3, 31));
  for (const bad of ["2025-02-30", "2025-13-01", "31/02/2025", "2025.5", "1200.5", "3.50", "12", "2025", "0999-01-01", "2500-01-01", "week 3", ""]) assert.ok(Number.isNaN(toDay(bad)), bad);
});

test("files in other encodings", () => {
  const text = "prix,quantité\n2,10\n";
  assert.deepEqual(decodeBytes(new TextEncoder().encode(text)), { text, encoding: "utf-8" });
  assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])).text.replace(/^﻿/, ""), text);
  const latin = new Uint8Array([...text].map((ch) => (ch === "é" ? 0xe9 : ch.charCodeAt(0))));
  assert.deepEqual(decodeBytes(latin), { text, encoding: "windows-1252" });
  const le = new Uint8Array([0xff, 0xfe, ...[...text].flatMap((ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8])]);
  assert.deepEqual(decodeBytes(le), { text, encoding: "utf-16le" });
  const bare = new Uint8Array([...text].flatMap((ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8]));
  assert.equal(decodeBytes(bare).encoding, "utf-16le");
  assert.equal(decodeBytes(bare).text, text);
});

test("separators, quotes, a byte-order mark, no header line, ragged lines", () => {
  const want = [-1.5, 1e-9];
  const base = [[1, 100], [2, 35.36], [3, 19.25], [4, 12.5], [5, 8.94], [6, 6.8], [8, 4.42], [10, 3.16]];
  const variants = {
    comma: `price,quantity\n${base.map((r) => r.join(",")).join("\n")}`,
    tab: `price\tquantity\n${base.map((r) => r.join("\t")).join("\n")}`,
    semicolonDecimalComma: `price;quantity\n${base.map((r) => r.map((v) => String(v).replace(".", ",")).join(";")).join("\n")}`,
    crlfBomQuotes: `﻿"price","quantity"\r\n${base.map((r) => `"${r[0]}","${r[1]}"`).join("\r\n")}\r\n`,
    currency: `price,quantity\n${base.map((r) => `£${r[0]}.00,${r[1]}`).join("\n")}`,
    noHeader: base.map((r) => r.join(",")).join("\n"),
  };
  for (const [name, text] of Object.entries(variants)) {
    const r = analyse(text);
    assert.ok(!r.error, `${name}: ${r.error}`);
    assert.equal(r.fit.n, 8, name);
    close(r.fit.log.elasticity, want[0], 0.01);
  }
  assert.match(parseTable(variants.noHeader).warnings[0], /first line holds only numbers/);
  assert.deepEqual(parseTable(variants.noHeader).names, ["Column 1", "Column 2"]);
  const ragged = parseTable("price,quantity\n1,2\n3\n4,5,6\n7,8");
  assert.match(ragged.warnings[0], /2 lines had more or fewer than 2 cells/);
  assert.equal(ragged.n, 4);
});

test("columns are guessed from their names, and can be told apart", () => {
  const roles = (head, rows) => { const t = parseTable(table([head, ...rows])); return guessRoles(profile(t)); };
  const rows = Array.from({ length: 10 }, (_, i) => [`2025-01-${String(i + 1).padStart(2, "0")}`, i % 2 ? "north" : "south", 2 + i / 10, 100 - 3 * i, 1.5]);
  assert.deepEqual(roles(["date", "region", "unit_price", "units_sold", "unit_cost"], rows), { price: 2, quantity: 3, group: 1, date: 0 });
  // Quantity first, price second.
  assert.deepEqual(roles(["sold", "price"], rows.map((r) => [r[3], r[2]])), { price: 1, quantity: 0, group: null, date: null });
  // Names that say nothing: the first number column is taken as the price, the second as the quantity.
  assert.deepEqual(roles(["a", "b"], rows.map((r) => [r[2], r[3]])), { price: 0, quantity: 1, group: null, date: null });
  // A number column with a few values can be a group; a column of 13 names cannot.
  const many = parseTable(table([["name", "price", "qty"], ...Array.from({ length: 13 }, (_, i) => [`n${i}`, i + 1, 50 - i])]));
  assert.equal(profile(many)[0].levels, null);
  assert.equal(guessRoles(profile(many)).group, null);
});

test("rows that cannot be used are counted and the rest are fitted", () => {
  const good = [1, 2, 3, 4, 5, 6, 8, 10].map((p) => [p, 100 * p ** -1.5]);
  const text = table([["price", "quantity"], ...good, [0, 50], [-2, 50], [3, 0], [3, -4], ["n/a", 5], ["", ""], ["cheap", 9], [4, "lots"]]);
  const t = parseTable(text), cols = profile(t);
  // "cheap" and "lots" leave each column 14 numbers in 15 or 14 filled cells: still number columns.
  const p = prepare(t, cols, guessRoles(cols));
  assert.ok(!p.error, p.error);
  assert.equal(p.rows.length, 8);
  assert.deepEqual(p.dropped, { blank: 2, notNumber: 2, priceNotPositive: 2, quantityNotPositive: 2, noGroup: 0, noDate: 0 });
  close(fit(p).log.elasticity, -1.5, 1e-9);
});

test("bad input gets a sentence that says what to fix", () => {
  const err = (text, o) => analyse(text, o).error;
  assert.match(err(""), /no data yet/);
  assert.match(err("   \n  "), /no data yet/);
  assert.match(err(undefined), /no data yet/);
  assert.match(err("price\n1\n2\n3"), /Only one column was found/);
  assert.match(err("a\u0000b,c\n1,2"), /binary file/);
  assert.match(err("a\u0001\u001fb,c\n1,2"), /binary file/);                      // binary with no zero byte
  assert.ok(!/binary/.test(err("price\tquantity\r\n1\t2\r\n") || ""));           // tabs and line ends are text
  assert.match(err(`price,quantity,note\n2.5,100,"never closed\n${Array.from({ length: 30 }, (_, i) => `${i + 1},${50 - i},x`).join("\n")}`), /^One cell, on line 2 of the table, holds more than five lines of text\. A quotation mark was probably opened/);
  assert.ok(!analyse(`price,quantity,note\n${[1, 2, 3, 4, 5, 6, 8, 10].map((p) => `${p},${100 / p},"two\nlines"`).join("\n")}`).error);   // a line break inside closed quotes is fine
  // The same mistake further down leaves enough rows to fit, so it is a warning: the rows after it are gone and the page says so.
  const good = (from) => Array.from({ length: 20 }, (_, i) => `${from + i},${(500 / (from + i)).toFixed(3)},x`).join("\n");
  const late = analyse(`price,quantity,note\n${good(1)}\n21,24,"never closed\n${good(22)}`);
  assert.ok(!late.error, late.error);
  assert.equal(late.fit.n, 21);
  assert.match(late.table.warnings[0], /^One cell, on line 22 of the table, holds more than five lines of text\..*the lines after it were not read as rows/);
  assert.match(err("price,quantity"), /Only one line of text/);
  assert.match(err("My sales\nprice,quantity\n1,2\n2,1"), /starts with a title or a note/);
  assert.match(err("price,quantity\n1,5\n2,4\n3,3"), /Only 3 rows can be used, and at least 8 are needed/);
  assert.match(err(table([["price", "quantity"], ...Array(9).fill([2, 5])])), /only one value/);
  assert.match(err(table([["price", "quantity"], ...Array.from({ length: 9 }, (_, i) => [i % 2 ? 2 : 3, 5 + i])])), /only 2 different values/);
  assert.match(err(table([["price", "quantity"], ...Array.from({ length: 9 }, (_, i) => [i + 1, "many"])])), /^Only one of the 2 columns holds numbers\. The lab needs two/);
  assert.match(err(table([["a", "b", "c"], ...Array.from({ length: 9 }, (_, i) => [`x${i}`, `y${i}`, "z"])])), /^None of the 3 columns holds numbers/);
  assert.match(err(table([["price", "quantity"], ...Array.from({ length: 9 }, (_, i) => [i + 1, i < 8 ? 5 : 1e308])])), /too large or too small/);
  assert.match(err(table([["price", "quantity"], ...Array.from({ length: 9 }, (_, i) => [i + 1, 1e13])])), /too large or too small/);
  assert.match(err(table([["price", "quantity"], ...Array.from({ length: 9 }, (_, i) => [-(i + 1), 5])])), /^No row can be used, and at least 8 are needed/);
  assert.match(err("price,quantity\n2,5\n0,5\n-1,5"), /^Only 1 row can be used/);
  // Columns chosen by hand that make no sense.
  const ok = power([1, 2, 3, 4, 5, 6, 8, 10], -1.5);
  assert.match(err(ok, { roles: { price: 0, quantity: 0 } }), /^"price" is set as both the price and the quantity/);
  assert.match(err(ok, { roles: { group: 1 } }), /^"quantity" is set as both the group and the quantity/);
  assert.match(err(ok, { roles: { date: 0 } }), /^"price" is set as both the date and the price/);
  const weekly = table([["week", "price", "quantity"], ...Array.from({ length: 9 }, (_, i) => [i % 3, i + 1, 50 - i])]);
  assert.match(err(weekly, { roles: { group: 0, date: 0 } }), /^"week" is set as both the group and the date/);
  // Three number columns, none chosen: the visitor is asked to choose.
  const three = table([["a", "b", "c"], ...Array.from({ length: 9 }, (_, i) => [i + 1, 50 - i, i * 2])]);
  assert.match(err(three, { roles: { price: null, quantity: null } }), /^Choose a price column and a quantity column/);
  assert.match(err(`name,price,quantity\n${Array.from({ length: 9 }, (_, i) => `x${i},${i + 1},${50 - i}`).join("\n")}`, { roles: { price: 0, quantity: 2 } }), /price column "name" does not hold numbers/);
  // Too many quantities for the rows: 8 rows, two groups and a trend is fine (4 to estimate), but a group for every pair of rows is not.
  const tight = table([["shop", "week", "price", "quantity"], ...[1, 2, 3, 4, 5, 6, 7, 8].map((p, i) => [`g${i >> 1}`, i, p, 100 / p + i])]);
  assert.deepEqual(analyse(tight).roles, { price: 2, quantity: 3, group: 0, date: 1 });
  assert.match(err(tight, { levels: true, trend: true }), /At least 9 rows are needed/);
  // Price that only varies between groups cannot be separated from them.
  const stuck = table([["shop", "price", "quantity"], ...Array.from({ length: 12 }, (_, i) => [`s${i % 3}`, 2 + (i % 3), 40 + i])]);
  assert.match(err(stuck, { levels: true }), /cannot be told apart from the groups/);
  // Every message is a sentence, never a bare number.
  for (const m of [err(""), err("price\n1"), err(ok, { roles: { price: 0, quantity: 0 } })]) assert.match(m, /^["A-Z].*\.$/);
});

test("limits: rows are capped with a warning, and long names are cut", () => {
  const r = rng(9);
  const big = `price,quantity\n${Array.from({ length: LIMITS.rows + 5 }, () => { const p = 1 + 4 * r(); return `${p.toFixed(3)},${(100 * p ** -1.3 * Math.exp(r.normal(0, 0.1))).toFixed(3)}`; }).join("\n")}`;
  const t = parseTable(big);
  assert.equal(t.n, LIMITS.rows);
  assert.equal(t.total, LIMITS.rows + 5);
  assert.match(t.warnings.at(-1), /20,005 rows. Only the first 20,000 were read/);
  const f = analyse(big).fit;
  close(f.log.elasticity, -1.3, 0.01);
  const long = parseTable(`${"p".repeat(300)},quantity\n1,2\n2,1`);
  assert.equal(long.names[0].length, LIMITS.name);
  assert.deepEqual(parseTable("x,x,x\n1,2,3\n4,5,6").names, ["x", "x (2)", "x (3)"]);
  assert.deepEqual([LIMITS.bytes, LIMITS.rows], [2e6, 20000]);   // the write-up says 2 MB and 20,000 rows
});

test("simulation check: the interval holds the truth about 95 times in 100 when prices are set at random", () => {
  let held = 0;
  const runs = 400;
  for (let s = 1; s <= runs; s++) {
    const r = rng(1000 + s);
    const prices = Array.from({ length: 25 }, () => 1 + 3 * r());
    const f = analyse(power(prices, -1.4, 50, prices.map(() => r.normal(0, 0.3)))).fit;
    if (f.log.low <= -1.4 && -1.4 <= f.log.high) held++;
  }
  assert.ok(held >= 0.925 * runs && held <= 0.975 * runs, `held ${held} of ${runs}`);
});
