import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { PRICES } from "./data.js";
import {
  PERIOD, HORIZON, Z80, MONTHS, loess, movingAverage, trendSpan, lowPassSpan, robustnessWeights, stl, strength,
  monthAt, monthLabel, windowOf, decompose, forecastLog, backtestOrigins, backtestAt, summarise, asPercent, backtest,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const series = (id) => PRICES.series.find((s) => s.id === id);
const FIXED = { periodic: true, robust: true }; // the settings the page opens with

// The series the reference values were computed for: a line, two harmonics, a deterministic wobble and two spikes.
const synthetic = (n) => Float64Array.from({ length: n }, (_, i) =>
  5 + 0.01 * i + 0.3 * Math.sin(2 * Math.PI * i / 12) + 0.1 * Math.cos(2 * Math.PI * i / 6) + 0.05 * Math.sin(i * i * 0.37) + (i === 40 ? 1 : 0) - (i === 77 ? 0.8 : 0));

/* ---------------------------------------------------------------- loess */

test("loess reproduces a straight line and a constant exactly, whatever the span", () => {
  const line = Float64Array.from({ length: 40 }, (_, i) => 3 - 0.25 * i);
  for (const span of [5, 13, 39, 41, 401]) loess(line, span).forEach((v, i) => close(v, line[i], 1e-10));
  loess(new Float64Array(20).fill(7), 9).forEach((v) => close(v, 7, 1e-12));
  assert.deepEqual([...loess(Float64Array.of(4), 7)], [4]);
});

test("loess with a span of three is a tricube-weighted local line: hand-computed middle value", () => {
  // At position 2 of [0, 0, 3] with span 3 the half-width is 1, so the two neighbours sit at the edge of the
  // window where the tricube weight is zero: the fit is the point itself.
  close(loess(Float64Array.of(0, 0, 3), 3)[1], 0, 1e-12);
  // With span 5 over five points the half-width at the middle is 2: neighbours at distance 1 get (1 - 1/8)^3 and the
  // ends get 0. The points are symmetric about the middle, so the local line there is the weighted mean.
  const w = (1 - 1 / 8) ** 3;
  close(loess(Float64Array.of(1, 2, 9, 4, 5), 5)[2], (w * 2 + 9 + w * 4) / (1 + 2 * w), 1e-12);
});

test("moving average: hand case", () => {
  assert.deepEqual([...movingAverage(Float64Array.of(1, 2, 3, 4, 5, 6), 3)], [2, 3, 4, 5]);
  assert.equal(movingAverage(new Float64Array(36), 12).length, 25);
});

test("the default spans follow Cleveland's rule", () => {
  assert.equal(trendSpan(12, 7), 23);   // 18 / (1 - 1.5/7) = 22.9
  assert.equal(trendSpan(12, 13), 21);  // 18 / (1 - 1.5/13) = 20.3
  assert.equal(trendSpan(12, 35), 19);  // 18 / (1 - 1.5/35) = 18.8
  // The paper's own three examples (page 20): monthly CO2 with n_s = 35 gives 19, daily CO2 gives 573, and the
  // unemployed-males series with n_s = 17 gives 21.
  assert.equal(trendSpan(365, 35), 573);
  assert.equal(trendSpan(12, 17), 21);
  assert.equal(lowPassSpan(12), 13);    // and its n_l for monthly data (page 14)
  assert.equal(lowPassSpan(7), 9);
});

test("robustness weights: bisquare of the residual over six median absolute residuals", () => {
  // Residuals 0, 1, 2, 3, 12: the median is 2, so h = 12. Weights: 1, (1 - 1/144)^2, (1 - 4/144)^2, (1 - 9/144)^2, 0.
  const w = robustnessWeights(Float64Array.of(0, 1, 2, 3, 12), new Float64Array(5));
  close(w[0], 1); close(w[1], (1 - 1 / 144) ** 2); close(w[2], (1 - 4 / 144) ** 2); close(w[3], (1 - 9 / 144) ** 2); close(w[4], 0);
  // A perfect fit leaves every weight at 1 and divides nothing by zero.
  assert.deepEqual([...robustnessWeights(Float64Array.of(1, 2, 3), Float64Array.of(1, 2, 3))], [1, 1, 1]);
});

/* ------------------------------------------------------------------ STL */

test("STL matches the reference implementation (statsmodels 0.15.0, a port of the authors' Fortran)", () => {
  // Each row: index, trend, seasonal, remainder, robustness weight, as printed by statsmodels for the same series.
  const robust13 = [
    [0, 5.0099176739408735, 0.09747915690027599, -0.007396830841149615, 0.9933373292079154],
    [40, 5.401365066430644, 0.22796037044595885, 1.0295803627401137, 0],
    [77, 5.778143817416886, 0.1925306006944647, -0.761560100351466, 0],
    [149, 6.495663317841313, 0.2311470928530666, 0.0021934475678655474, 0.9994132222898054],
  ];
  const plain7 = [
    [0, 5.0025549383589425, 0.10908577478188576, -0.011640713140828929, 1],
    [40, 5.484543710325741, 0.510627499174739, 0.6637345901162366, 1],
    [77, 5.716126864996196, -0.014655908345997507, -0.4923566388903131, 1],
    [149, 6.488483254829767, 0.24781864546480833, -0.007298042032330088, 1],
  ];
  const short = [ // 30 values with a seasonal span of 13: every loess window is wider than its data
    [0, 4.97859009582065, 0.12218452515389357, -0.0007746209745436161, 0.9474789878408217],
    [15, 5.153559882097388, 0.24439554822943899, 0.0020444480873020865, 0],
    [29, 5.28991218794688, 0.19345301590626116, -0.0009521482179541962, 0.8062806685533048],
  ];
  for (const [rows, n, options] of [[robust13, 150, { seasonal: 13, robust: true }], [plain7, 150, { seasonal: 7, robust: false }], [short, 30, { seasonal: 13, robust: true }]]) {
    const f = stl(synthetic(n), options);
    for (const [i, t, s, r, w] of rows) { close(f.trend[i], t); close(f.seasonal[i], s); close(f.remainder[i], r); close(f.weights[i], w); }
  }
});

test("the fixed season matches the reference run the way R does it (n_s = 10n + 1, degree 0, then averaged)", () => {
  const f = stl(synthetic(150), FIXED);
  assert.equal(f.settings.seasonal, 1501);
  assert.equal(f.settings.trend, 19);
  for (const [i, t, s, r] of [
    [0, 5.013220241014562, 0.0943860834226372, -0.007606324437198886],
    [40, 5.399448180614615, 0.21891883819544009, 1.0405387808066617],
    [77, 5.782444992000523, 0.2021329190349594, -0.7754635932755978],
    [149, 6.509976347526459, 0.2021329190349594, 0.016894591700826744],
  ]) { close(f.trend[i], t); close(f.seasonal[i], s); close(f.remainder[i], r); }
  for (let i = 12; i < 150; i++) assert.equal(f.seasonal[i], f.seasonal[i - 12]);
});

test("a straight line plus an exactly repeating season is recovered exactly", () => {
  const pattern = [3, 1, -2, -4, -1, 0, 2, 5, 1, -3, -2, 0]; // sums to zero
  const y = Float64Array.from({ length: 96 }, (_, i) => 10 + 0.5 * i + pattern[i % 12]);
  for (const options of [{ seasonal: 7, robust: false }, { seasonal: 13, robust: true }, FIXED]) {
    const f = stl(y, options);
    for (let i = 0; i < 96; i++) { close(f.trend[i], 10 + 0.5 * i, 1e-8); close(f.seasonal[i], pattern[i % 12], 1e-8); close(f.remainder[i], 0, 1e-8); }
  }
});

test("the three components always add back to the data", () => {
  for (const s of PRICES.series) {
    const y = Float64Array.from(s.values, Math.log);
    for (const options of [FIXED, { seasonal: 7, robust: false }]) {
      const f = stl(y, options);
      for (let i = 0; i < y.length; i++) close(f.trend[i] + f.seasonal[i] + f.remainder[i], y[i], 1e-12);
    }
  }
});

test("the robust fit sends a one-month spike to the remainder; the plain fit lets it bend the season", () => {
  const y = synthetic(150);
  const robust = stl(y, { seasonal: 7, robust: true }), plain = stl(y, { seasonal: 7, robust: false });
  assert.equal(robust.weights[40], 0);
  assert.ok(robust.remainder[40] > 0.95 && plain.remainder[40] < 0.7);
  assert.ok(plain.seasonal[40] - robust.seasonal[40] > 0.2);
  assert.ok(plain.weights.every((w) => w === 1));
});

test("STL recovers a known season from simulated data", () => {
  const r = rng(58);
  const pattern = MONTHS.map((_, m) => 0.3 * Math.sin(2 * Math.PI * m / 12));
  let level = 3;
  const y = Float64Array.from({ length: 240 }, (_, i) => { level += r.normal(0.002, 0.03); return level + pattern[i % 12] + r.normal(0, 0.05); });
  const f = stl(y, FIXED);
  for (let m = 0; m < 12; m++) close(f.seasonal[228 + m], pattern[m], 0.04);
  assert.ok(strength(f).seasonal > 0.9);
});

test("bad input is refused with a reason", () => {
  assert.throws(() => stl(new Float64Array(23)), /two full cycles/);
  assert.throws(() => stl(Float64Array.from({ length: 30 }, (_, i) => (i === 7 ? NaN : i))), /value 8 is not a finite number/);
  assert.throws(() => stl(new Float64Array(48), { seasonal: 8 }), /seasonal span must be an odd/);
  assert.throws(() => stl(new Float64Array(48), { seasonal: 1 }), /seasonal span must be an odd/);
  assert.throws(() => stl(new Float64Array(48), { trend: 11 }), /trend span/);
  assert.throws(() => stl(new Float64Array(48), { lowPass: 12 }), /low-pass span/);
  assert.throws(() => stl(new Float64Array(48), { period: 1 }), /period/);
  assert.throws(() => decompose([1, 2, 0, 4]), /price 3 is not a positive number/);
  assert.throws(() => decompose(Array(40).fill(1).concat([Infinity])), /not a positive number/);
  // A constant series has nothing to decompose and must not produce NaN.
  const flat = decompose(Array(48).fill(5), FIXED);
  assert.deepEqual(flat.strength, { seasonal: 0, trend: 0 });
  for (const p of flat.forecast) { close(p.mid, 5); close(p.low, 5); close(p.high, 5); }
});

/* -------------------------------------------------------------- summaries */

test("strength: hand-computed", () => {
  // S + R = [2, -2, 2, -2] has variance 16/3 and R = [1, -1, 1, -1] has 4/3, so the seasonal strength is 1 - 1/4.
  const s = strength({ seasonal: [1, -1, 1, -1], remainder: [1, -1, 1, -1], trend: [0, 0, 0, 0] });
  close(s.seasonal, 0.75);
  close(s.trend, 0); // T + R = R
  // A remainder larger than the sum is floored at zero rather than going negative.
  assert.equal(strength({ seasonal: [1, -1, 1, -1], remainder: [-1, 1, -1, 1], trend: [0, 0, 0, 0] }).seasonal, 0);
});

test("months and windows", () => {
  assert.deepEqual(monthAt("2014-01", 0), { year: 2014, month: 0, key: "2014-01" });
  assert.deepEqual(monthAt("2014-01", 152), { year: 2026, month: 8, key: "2026-09" });
  assert.deepEqual(monthAt("1980-11", 2), { year: 1981, month: 0, key: "1981-01" });
  assert.equal(monthLabel("2014-01", 164), "Sep 2027");
  assert.equal(monthLabel("2014-01", 11, false), "December 2014");
  const w = windowOf(series("wheat"), 2000);
  assert.equal(w.start, "2000-01");
  assert.equal(w.values.length, 321);
  assert.equal(w.values[0], series("wheat").values[240]);
  // Asking for an earlier year than the series has gives the whole series.
  assert.equal(windowOf(series("onion"), 1980).values.length, 153);
  assert.equal(windowOf(series("onion"), 1980).start, "2014-01");
});

/* ------------------------------------------------------------------ data */

test("the bundled prices match the sources' own figures", () => {
  const at = (id, key) => { const s = series(id); const [y, m] = key.split("-").map(Number), [y0, m0] = s.start.split("-").map(Number); return s.values[(y - y0) * 12 + (m - m0)]; };
  // FAO FPMA Tool, India, national average retail, rupees per kg (read from the FpmaSeriePrice response).
  assert.equal(at("onion", "2014-01"), 22.45);
  assert.equal(at("onion", "2019-12"), 94.95);
  assert.equal(at("onion", "2026-09"), 52.95);
  assert.equal(at("potato", "2020-11"), 44.59);
  assert.equal(at("potato", "2026-09"), 22.66);
  // World Bank Pink Sheet, workbook "Updated on October 02, 2026", sheet "Monthly Prices".
  assert.equal(at("wheat", "1980-01"), 175.6);
  assert.equal(at("wheat", "2008-03"), 439.7);
  assert.equal(at("wheat", "2026-09"), 347);
  assert.equal(at("tea", "2020-04"), 1.3);
  assert.equal(at("gas", "2005-10"), 13.52);
  assert.equal(at("maize", "2012-07"), 333.1);
  assert.equal(at("rice", "2008-05"), 901.8);
  assert.equal(at("sugar", "1980-11"), 0.83);
  assert.equal(at("orange", "2025-01"), 2.57);
  assert.equal(at("banana", "2000-01"), 0.48);
});

test("every series is complete, positive and ends in September 2026", () => {
  assert.deepEqual(PRICES.series.map((s) => s.id), ["onion", "potato", "wheat", "maize", "rice", "sugar", "tea", "orange", "banana", "gas"]);
  for (const s of PRICES.series) {
    assert.equal(s.start, s.source === "fpma" ? "2014-01" : "1980-01");
    assert.equal(s.values.length, s.source === "fpma" ? 153 : 561);
    assert.equal(monthAt(s.start, s.values.length - 1).key, "2026-09");
    assert.ok(s.values.every((v) => typeof v === "number" && v > 0 && Number.isFinite(v)));
    assert.ok(s.unit && s.detail && s.name);
  }
  assert.equal(PRICES.retrieved, "2026-10-12");
  assert.equal(PRICES.sources.pink.vintage, "Updated on October 02, 2026");
});

/* -------------------------------------------------------------- forecast */

test("forecast: the adjusted level is carried forward and last year's season put back", () => {
  // An exactly repeating series: the forecast repeats it and the range has no width.
  const pattern = [1.2, 1.1, 0.9, 0.8, 0.9, 1.0, 1.1, 1.3, 1.0, 0.9, 0.8, 1.0];
  const values = Array.from({ length: 60 }, (_, i) => 50 * pattern[i % 12]);
  const d = decompose(values, FIXED);
  d.forecast.forEach((p, k) => { close(p.mid, 50 * pattern[k], 1e-6); close(p.low, p.mid, 1e-6); close(p.high, p.mid, 1e-6); assert.equal(p.sameMonthLastYear, values[48 + k]); });
  assert.equal(d.forecast.length, HORIZON);

  // By hand from the definition, on real data.
  const w = windowOf(series("onion"), 2014);
  const o = decompose(w.values, FIXED);
  const n = w.values.length;
  const adj = (i) => o.logs[i] - o.seasonal[i];
  for (const h of [1, 5, 12]) {
    let ss = 0;
    for (let i = h; i < n; i++) ss += (adj(i) - adj(i - h)) ** 2;
    const mid = adj(n - 1) + o.seasonal[n - 12 + h - 1], spread = Math.sqrt(ss / (n - h));
    const p = o.forecast[h - 1];
    close(Math.log(p.mid), mid, 1e-12); close(Math.log(p.low), mid - Z80 * spread, 1e-12); close(Math.log(p.high), mid + Z80 * spread, 1e-12);
  }
  // Twelve months ahead the season has come full circle, so the centre is the latest price itself.
  close(o.forecast[11].mid, 52.95, 1e-9);
  close(Z80, 1.2815515655446004, 0);
});

test("on a simulated seasonal random walk the 80% range holds about 80% of outcomes and the forecast beats both naive rules", () => {
  const r = rng(7);
  const pattern = MONTHS.map((_, m) => 0.25 * Math.cos(2 * Math.PI * m / 12));
  let level = 4;
  const logs = Float64Array.from({ length: 360 }, (_, i) => { level += r.normal(0, 0.04); return level + pattern[i % 12]; });
  const s = summarise(backtestOrigins(360).map((used) => backtestAt(logs, used, FIXED)));
  assert.equal(s.origins, 120);
  assert.equal(s.overall.n, 1440);
  close(s.overall.coverage, 0.8, 0.08);
  assert.ok(s.beatsNaive && s.overall.stl < s.overall.last && s.overall.stl < s.overall.seasonal);
});

test("held-out origins: six years behind, twelve known months ahead, at most the latest 120", () => {
  const onion = backtestOrigins(153);
  assert.equal(onion.length, 70);
  assert.equal(onion[0], 72);
  assert.equal(onion.at(-1), 141);
  const wheat = backtestOrigins(321);
  assert.equal(wheat.length, 120);
  assert.deepEqual([wheat[0], wheat.at(-1)], [190, 309]);
  assert.deepEqual(backtestOrigins(83), []);   // 72 + 12 months are needed for a single test
  assert.deepEqual(backtestOrigins(84), [72]);
});

test("one held-out test uses nothing after its origin and scores the three rules by hand", () => {
  const logs = Float64Array.from(windowOf(series("onion"), 2014).values, Math.log);
  const t = backtestAt(logs, 100, FIXED);
  const f = forecastLog(logs.subarray(0, 100), stl(logs.subarray(0, 100), FIXED));
  for (const h of [1, 7, 12]) {
    const e = t[h - 1], actual = logs[100 + h - 1];
    close(e.stl, Math.abs(f[h - 1].mid - actual), 1e-12);
    close(e.last, Math.abs(logs[99] - actual), 1e-12);
    close(e.seasonal, Math.abs(logs[100 - 12 + h - 1] - actual), 1e-12);
    assert.equal(e.covered, actual >= f[h - 1].low && actual <= f[h - 1].high);
  }
  // Changing the future leaves the forecast alone: only the scores move.
  const altered = Float64Array.from(logs);
  for (let i = 100; i < altered.length; i++) altered[i] += 1;
  const f2 = forecastLog(altered.subarray(0, 100), stl(altered.subarray(0, 100), FIXED));
  assert.deepEqual(f2, f);
});

test("summarise: hand case, and a forecast level with the naive rule is not said to beat it", () => {
  const one = (stlErr, seasonal, last, covered) => Array.from({ length: 12 }, (_, i) => ({ h: i + 1, stl: stlErr, seasonal, last, covered }));
  const s = summarise([one(0.125, 0.375, 0.25, true), one(0.375, 0.375, 0.5, false)]);
  close(s.overall.stl, 0.25); close(s.overall.seasonal, 0.375); close(s.overall.last, 0.375);
  assert.equal(s.overall.n, 24);
  assert.equal(s.bestNaive, "last"); // a tie between the naive rules goes to "last"
  close(s.margin, 0.333);
  assert.equal(s.beatsNaive, true);
  close(s.overall.coverage, 0.5);
  close(s.overall.closerThanLast, 1); close(s.overall.closerThanSeasonal, 0.5);
  close(s.byHorizon[4].stl, 0.25);
  assert.equal(summarise([one(0.2, 0.3, 0.2, true)]).beatsNaive, false);          // exactly level
  assert.equal(summarise([one(0.19996, 0.3, 0.2, true)]).beatsNaive, false);      // lower by 0.02%: rounds to 0.0%
  assert.equal(summarise([one(0.1998, 0.3, 0.2, true)]).beatsNaive, true);        // lower by 0.1%
  assert.equal(summarise([one(0.25, 0.3, 0.2, true)]).margin, -0.25);
  close(asPercent(Math.log(1.25)), 0.25);
});

/* ------------------------------------------------------------ the finding */

test("One finding: onions have a season and the forecast edges out the naive rules; wheat has none and it does not", { timeout: 120000 }, () => {
  const w = windowOf(series("onion"), 2014);
  const d = decompose(w.values, FIXED);
  assert.equal(monthLabel(w.start, d.peak), "Nov 2025");
  assert.equal(monthLabel(w.start, d.trough), "May 2026");
  close(d.latest[d.peak - 141] - 1, 0.3498, 0.0005);
  close(d.latest[d.trough - 141] - 1, -0.2018, 0.0005);
  close(d.strength.seasonal, 0.402, 0.001);
  const b = backtest(w.values, FIXED);
  assert.equal(b.origins, 70);
  assert.equal(b.overall.n, 840);
  close(asPercent(b.overall.stl), 0.2877, 0.0005);
  close(asPercent(b.overall.seasonal), 0.3018, 0.0005);
  close(asPercent(b.overall.last), 0.3302, 0.0005);
  assert.equal(b.bestNaive, "seasonal");
  assert.equal(b.margin, 0.041);
  assert.equal(b.beatsNaive, true);
  close(b.overall.coverage, 0.906, 0.001);

  const ww = windowOf(series("wheat"), 2000);
  const dw = decompose(ww.values, FIXED);
  assert.ok(Math.max(...dw.latest) - 1 < 0.02 && Math.min(...dw.latest) - 1 > -0.03);
  close(dw.latest[dw.peak - 309] - 1, 0.0174, 0.0005);
  close(dw.latest[dw.trough - 309] - 1, -0.0289, 0.0005);
  close(dw.strength.seasonal, 0.006, 0.001);
  const bw = backtest(ww.values, FIXED);
  assert.equal(bw.overall.n, 1440);
  close(asPercent(bw.overall.stl), 0.1354, 0.0005);
  close(asPercent(bw.overall.last), 0.1343, 0.0005);
  assert.equal(bw.bestNaive, "last");
  assert.equal(bw.beatsNaive, false);
  assert.equal(PERIOD, 12);
});

test("other numbers the write-up quotes: the largest onion remainder, the first forecast and how often the range held", { timeout: 120000 }, () => {
  const w = windowOf(series("onion"), 2014);
  const d = decompose(w.values, FIXED);
  let big = 0;
  d.remainder.forEach((v, i) => { if (Math.abs(v) > Math.abs(d.remainder[big])) big = i; });
  assert.equal(monthLabel(w.start, big, false), "December 2019");
  close(d.remainderFactor[big] - 1, 1.97, 0.01);
  // October 2026, as shown in the forecast table: 58.6, from 48.6 to 70.8 (statsmodels gives 58.65, 48.60, 70.77).
  close(d.forecast[0].mid, 58.65, 0.01); close(d.forecast[0].low, 48.60, 0.01); close(d.forecast[0].high, 70.77, 0.01);
  // "91% of the time for onions and 71% for oranges with the opening settings."
  close(backtest(w.values, FIXED).overall.coverage, 0.906, 0.001);
  close(backtest(windowOf(series("orange"), 2000).values, FIXED).overall.coverage, 0.707, 0.001);
  // Twelve months ahead every forecast and both naive rules are the same number, so none is "closer".
  const tests = backtestOrigins(w.values.length).map((used) => backtestAt(Float64Array.from(w.values, Math.log), used, FIXED));
  const s = summarise(tests);
  assert.equal(s.byHorizon[11].closerThanLast, 0);
  assert.equal(s.byHorizon[11].closerThanSeasonal, 0);
  close(s.byHorizon[11].stl, s.byHorizon[11].last, 1e-12);
  close(s.overall.closerThanSeasonal, 0.513, 0.001);
});

/* ------------------------------------------------- added by the review */

test("the 840 onion forecast months are 81 different months, and the gap printed on the page is 1.4 percentage points", { timeout: 120000 }, () => {
  const w = windowOf(series("onion"), 2014);
  const origins = backtestOrigins(w.values.length);
  const targets = new Set();
  for (const used of origins) for (let h = 1; h <= HORIZON; h++) targets.add(used + h - 1);
  assert.equal(origins.length * HORIZON, 840);
  assert.equal(targets.size, 81);
  assert.equal(targets.size, origins.length + HORIZON - 1); // the rule the page uses for every series
  const b = backtest(w.values, FIXED);
  const shown = (m) => Math.round(asPercent(m) * 1000) / 10; // one decimal place, as printed
  assert.deepEqual([shown(b.overall.stl), shown(b.overall.seasonal), shown(b.overall.last)], [28.8, 30.2, 33]);
  close(shown(b.overall.seasonal) - shown(b.overall.stl), 1.4, 1e-9);
});

test("the settings decide the onion verdict: ahead in 11 of the 32 combinations, by more than 3% only with a fixed season", { timeout: 300000 }, () => {
  const w = windowOf(series("onion"), 2014);
  const rows = [];
  for (const robust of [true, false]) {
    rows.push({ name: `fixed ${robust}`, ...backtest(w.values, { periodic: true, robust }) });
    for (let span = 7; span <= 35; span += 2) rows.push({ name: `${span} ${robust}`, ...backtest(w.values, { seasonal: span, robust }) });
  }
  assert.equal(rows.length, 32);
  assert.equal(rows.filter((r) => r.beatsNaive).length, 11);
  assert.deepEqual(rows.filter((r) => r.margin > 0.03).map((r) => r.name).sort(), ["fixed false", "fixed true"]);
  // The settings the page opens with are the second best of the 32, which is a reason for caution.
  const sorted = [...rows].sort((a, b) => b.margin - a.margin);
  assert.equal(sorted[1].name, "fixed true");
  assert.ok(rows.every((r) => r.bestNaive === "seasonal"));
});

test("prices printed to the nearest cent: how often sugar, bananas and oranges do not move from one month to the next", () => {
  const unchanged = (id) => { const v = series(id).values; let k = 0; for (let i = 1; i < v.length; i++) if (v[i] === v[i - 1]) k++; return k; };
  assert.equal(series("sugar").values.length - 1, 560);
  assert.equal(unchanged("sugar"), 129);
  assert.equal(unchanged("banana"), 70);
  assert.equal(unchanged("orange"), 41);
  for (const id of ["sugar", "banana", "orange"]) assert.ok(series(id).values.every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9));
  assert.ok(series("sugar").values.some((v) => v === 0.2)); // "when sugar costs 20 cents"
  assert.ok(unchanged("onion") === 0 && unchanged("wheat") < 10);
});

test("a miss in logs treats 25% too high and 20% too low alike", () => {
  close(Math.abs(Math.log(1.25)), Math.abs(Math.log(0.8)), 1e-12);
  close(asPercent(Math.abs(Math.log(0.8))), 0.25, 1e-12);
});
