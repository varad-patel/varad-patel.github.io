import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { FX } from "./data.js";
import {
  MAX_H, MIN_FIT, PHI_MAX, MODELS, perUsd, pairSeries, line, forecastAt, originsFor, rollAll, dieboldMariano, asPercent,
  scorecard, running, scanAgainstDollar, monthLabel, indexOfYear, keyOf,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const cur = (code) => FX.currencies.find((c) => c.code === code);
const valueAt = (code, key) => { const c = cur(code); const [y, m] = key.split("-").map(Number), [y0, m0] = c.start.split("-").map(Number); return c.values[(y - y0) * 12 + (m - m0)]; };

/* ------------------------------------------------------------- data */

test("the bundled month-end rates match the Federal Reserve's H.10 release", () => {
  // Release prepared 13 October 2026: the last daily rate of each month, as the release quotes it.
  assert.equal(valueAt("EUR", "2008-07"), 1.5589);   // US dollars per euro, 31 July 2008
  assert.equal(valueAt("JPY", "1985-09"), 216.5);    // yen per dollar, 30 September 1985
  assert.equal(valueAt("GBP", "1992-09"), 1.779);    // dollars per pound, 30 September 1992
  assert.equal(valueAt("CHF", "2015-01"), 0.921);    // francs per dollar, 30 January 2015
  assert.equal(valueAt("INR", "2026-09"), 95.83);
  assert.equal(FX.currencies.length, 22);
  assert.equal(FX.last, "2026-09");
  assert.deepEqual(FX.currencies.filter((c) => c.usdPerUnit).map((c) => c.code).sort(), ["AUD", "EUR", "GBP", "NZD"]);
  for (const c of FX.currencies) {
    assert.ok(c.values.every((v) => v > 0 && Number.isFinite(v)));
    assert.equal(c.values.length, c.days.length);
    assert.ok(c.days.every((d) => d >= 1 && d <= 31));
  }
  assert.equal(cur("EUR").start, "1999-01");
  assert.equal(cur("GBP").start, "1971-01");
  assert.match(FX.source.terms, /public domain/);
});

test("rates per dollar and pairs, by hand", () => {
  close(perUsd(cur("GBP"))[0], 1 / cur("GBP").values[0], 1e-15);
  assert.equal(perUsd(cur("JPY"))[0], cur("JPY").values[0]);
  // GBP/USD is dollars per pound; USD/GBP is its reciprocal.
  const gu = pairSeries(FX, "GBP", "USD"), ug = pairSeries(FX, "USD", "GBP");
  assert.equal(gu.start, "1971-01");
  close(Math.exp(gu.logs[0]), cur("GBP").values[0], 1e-12);
  gu.logs.forEach((v, i) => close(v, -ug.logs[i], 1e-15));
  // EUR/JPY is yen per euro: yen per dollar times dollars per euro, from the euro's first month.
  const ej = pairSeries(FX, "EUR", "JPY");
  assert.equal(ej.start, "1999-01");
  const i = 114; // July 2008
  assert.equal(monthLabel(ej.start, i), "Jul 2008");
  close(Math.exp(ej.logs[i]), valueAt("JPY", "2008-07") * valueAt("EUR", "2008-07"), 1e-9);
  assert.equal(ej.logs.length, 333);
  assert.throws(() => pairSeries(FX, "GBP", "GBP"), /two different currencies/);
  assert.throws(() => pairSeries(FX, "GBP", "XYZ"), /no currency/);
  // A pair against the dollar never mixes days; a cross rate does now and then.
  assert.equal(gu.mixed, 0);
  let worst = 0;
  for (const a of FX.currencies) for (const b of FX.currencies) if (a.code < b.code) worst = Math.max(worst, pairSeries(FX, a.code, b.code).mixed);
  assert.equal(worst, 39); // LKR/TWD: 39 of its 516 months
});

/* ------------------------------------------------------------- the models */

test("least squares line, with and without a bound on the slope", () => {
  // y = 1 + 2x exactly.
  const f = line([0, 1, 2, 3], [1, 3, 5, 7]);
  close(f.a, 1, 1e-15); close(f.b, 2, 1e-15);
  // Bounded at 0.99: the intercept is re-estimated for that slope, mean(y) - 0.99 mean(x) = 4 - 1.485.
  const g = line([0, 1, 2, 3], [1, 3, 5, 7], -0.99, 0.99);
  close(g.b, 0.99, 1e-15); close(g.a, 4 - 0.99 * 1.5, 1e-15);
  // No spread in x: slope 0 and the mean of y.
  assert.deepEqual(line([2, 2, 2], [1, 2, 6]), { a: 3, b: 0 });
});

test("the four forecasts by hand on a short series", () => {
  const s = Float64Array.of(0, 0.1, 0.3, 0.6, 1.0);
  const f = forecastAt(s, 4, 0, 3);
  assert.deepEqual(f.rw, [1, 1, 1]);
  // Drift: (1.0 - 0) / 4 = 0.25 a month.
  f.drift.forEach((v, k) => close(v, 1 + 0.25 * (k + 1), 1e-15));
  // Momentum: the changes 0.1, 0.2, 0.3, 0.4 lie on w_u = 0.1 + 1 x w_(u-1), so phi is held at 0.99 and
  // c = 0.3 - 0.99 x 0.2 = 0.102. Next changes: 0.102 + 0.99 x 0.4 = 0.498, then 0.102 + 0.99 x 0.498.
  close(f.fit.phi, PHI_MAX, 1e-15); close(f.fit.c, 0.102, 1e-15);
  close(f.momentum[0], 1 + 0.498, 1e-12);
  close(f.momentum[1], 1 + 0.498 + (0.102 + 0.99 * 0.498), 1e-12);
  // Reversion: the levels give a slope above 1, held at 1 with alpha = 0.5 - 0.25 = 0.25: a drift of 0.25 a month.
  close(f.fit.rho, 1, 1e-15); close(f.fit.alpha, 0.25, 1e-15);
  f.reversion.forEach((v, k) => close(v, 1 + 0.25 * (k + 1), 1e-12));
  assert.throws(() => forecastAt(s, 2, 0), /too few months/);
});

test("reversion with rho below 1 follows m + rho^h (s_t - m), and a forecast uses nothing after its date", () => {
  const r = rng(80);
  let x = 0.2;
  const s = Float64Array.from({ length: 400 }, () => (x = 0.05 + 0.9 * (x - 0.05) + r.normal(0, 0.02)));
  const f = forecastAt(s, 399);
  const m = f.fit.alpha / (1 - f.fit.rho);
  for (const h of [1, 12, 36]) close(f.reversion[h - 1], m + f.fit.rho ** h * (s[399] - m), 1e-12);
  close(f.fit.rho, 0.9, 0.04);
  const altered = Float64Array.from(s);
  for (let i = 300; i < 400; i++) altered[i] += 1;
  assert.deepEqual(forecastAt(altered, 299), forecastAt(s, 299));
  // A window of 120 months is the same as fitting on those months alone.
  const w = rollAll(s, { window: 120 }).find((q) => q.t === 250);
  const direct = forecastAt(s.subarray(131, 251), 119);
  w.reversion.forEach((v, k) => close(v, direct.reversion[k], 1e-12));
});

test("on a simulated random walk no model beats it, and on a mean-reverting series reversion does", () => {
  const r = rng(1983);
  let v = 0;
  const walk = Float64Array.from({ length: 600 }, () => (v += r.normal(0, 0.03)));
  const recs = rollAll(walk);
  for (const m of MODELS) {
    const s = scorecard(walk, recs, 12, m.key);
    assert.ok(!(s.verdict === "ahead" && s.dm.p < 0.05), `${m.key} beat a pure random walk`);
  }
  let x = 0;
  const rev = Float64Array.from({ length: 600 }, () => (x = 0.95 * x + r.normal(0, 0.03)));
  const s = scorecard(rev, rollAll(rev), 12, "reversion");
  // Theory for rho = 0.95 twelve months ahead: about 12% less miss than the random walk (here 12.2%). With 469 forecasts
  // that overlap by eleven months the Diebold-Mariano test cannot quite call it (p = 0.052): a real edge can go unconfirmed.
  assert.equal(s.verdict, "ahead"); close(s.margin, 0.122, 1e-12); close(s.dm.p, 0.052, 0.0005);
});

test("the misses do not depend on which way round the pair is quoted", () => {
  const a = pairSeries(FX, "GBP", "USD"), b = pairSeries(FX, "USD", "GBP");
  const ra = rollAll(a.logs), rb = rollAll(b.logs);
  for (const m of MODELS) {
    const sa = scorecard(a.logs, ra, 6, m.key), sb = scorecard(b.logs, rb, 6, m.key);
    close(sa.model, sb.model, 1e-12); close(sa.naive, sb.naive, 1e-12);
  }
});

test("forecast dates start with ten years behind them", () => {
  assert.equal(originsFor(500)[0], MIN_FIT - 1);
  assert.equal(originsFor(500).at(-1), 499);
  assert.deepEqual(originsFor(100), []);
  const recs = rollAll(pairSeries(FX, "EUR", "USD").logs);
  assert.equal(recs[0].t, 119);
  assert.equal(recs[0].drift.length, MAX_H);
  assert.equal(monthLabel("1999-01", 119, false), "December 2008");
  assert.equal(keyOf(2026 * 12 + 8), "2026-09");
  assert.equal(indexOfYear("1971-01", 1990), 228);
});

/* ------------------------------------------------------------- scoring: the same rules as day 61 */

test("Diebold-Mariano: hand cases with one lag and with two", () => {
  const one = dieboldMariano([1, -1, 2, 0], 1);
  close(one.stat, 0.5 / Math.sqrt(1.25 / 4), 1e-12);
  close(one.p, 0.371093, 2e-6);
  close(dieboldMariano([1, -1, 2, 0], 2).stat, 0.5 / Math.sqrt(0.3125 / 4), 1e-12);
  assert.deepEqual(dieboldMariano([0, 0, 0], 3), { n: 3, mean: 0, stat: 0, p: 1 });
  assert.ok(Number.isNaN(dieboldMariano([0.1, 0.1], 1).p));
  assert.ok(Number.isNaN(dieboldMariano([0.1], 1).p));
});

test("the scorecard by hand, with its edges", () => {
  const logs = Float64Array.of(0, 0.1, 0.2, 0.1, 0.3);
  const rec = (t, mid) => ({ t, rw: [logs[t]], drift: [mid] });
  const s = scorecard(logs, [rec(1, 0.15), rec(2, 0.2), rec(4, 0.3)], 1, "drift");
  assert.equal(s.n, 2);
  close(s.model, 0.075, 1e-12); close(s.naive, 0.1, 1e-12);
  assert.equal(s.margin, 0.25); assert.equal(s.verdict, "ahead"); close(s.closer, 0.5, 1e-12);
  const same = scorecard(logs, [rec(1, 0.1), rec(2, 0.2)], 1, "drift");
  assert.equal(same.verdict, "level"); assert.equal(same.dm.p, 1);
  assert.equal(scorecard(Float64Array.of(0, 1), [rec(0, 0.0004)], 1, "drift").verdict, "level");
  assert.equal(scorecard(Float64Array.of(0, 1), [rec(0, 0.001)], 1, "drift").verdict, "ahead");
  assert.equal(scorecard(Float64Array.of(0, 1), [rec(0, -0.1)], 1, "drift").verdict, "behind");
  assert.equal(scorecard(logs, [rec(4, 0.3)], 1, "drift").n, 0);
  const run = running([{ t: 0, model: 0.1, naiveMiss: 0.2 }, { t: 1, model: 0.3, naiveMiss: 0.2 }]);
  close(run[0].ratio, 0.5); close(run[1].ratio, 1);
  close(asPercent(Math.log(1.25)), 0.25);
});

/* ------------------------------------------------------------- the finding */

test("One finding: 66 comparisons against the dollar, 12 months ahead, forecasts made from 1990", { timeout: 120000 }, () => {
  const scan = scanAgainstDollar(FX, 12, { fromYear: 1990, toYear: 2026 });
  const all = scan.flatMap((r) => r.scores.map((s) => ({ code: r.code, ...s })));
  assert.equal(all.length, 66);
  assert.ok(all.every((s) => s.n > 0));
  assert.equal(all.filter((s) => s.verdict === "ahead").length, 13);
  const sig = all.filter((s) => s.verdict === "ahead" && s.dm.p < 0.05);
  assert.deepEqual(sig.map((s) => `${s.code} ${s.key}`), ["LKR reversion"]);
  assert.equal(all.filter((s) => s.verdict === "behind" && s.dm.p < 0.05).length, 18);
  close(66 * 0.025, 1.65, 1e-12);
  // The pound in dollars, the pair the page opens on.
  const p = pairSeries(FX, "GBP", "USD");
  const recs = rollAll(p.logs);
  const from = indexOfYear(p.start, 1990), to = indexOfYear(p.start, 2027) - 1;
  const [drift, momentum, reversion] = MODELS.map((m) => scorecard(p.logs, recs, 12, m.key, { from, to }));
  assert.equal(drift.n, 429);
  assert.equal(fmtPct(drift.naive), "6.87%");
  assert.equal(fmtPct(drift.model), "7.07%"); assert.equal(drift.verdict, "behind");
  assert.equal(fmtPct(momentum.model), "7.07%"); assert.equal(momentum.verdict, "behind");
  assert.equal(fmtPct(reversion.model), "6.75%"); assert.equal(reversion.verdict, "ahead");
  close(reversion.dm.p, 0.586, 0.0005);
});

const fmtPct = (m) => `${(Math.round(asPercent(m) * 10000) / 100).toFixed(2)}%`;
