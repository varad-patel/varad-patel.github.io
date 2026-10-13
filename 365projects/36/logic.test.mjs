import test from "node:test";
import assert from "node:assert/strict";
import { MODEL, REFERENCE, PERIODS, LEVELS, LIMITS, check, design, predict, breakdown, curve, unusual, heldOut, medianAbsError, ordinal, roomsLabel, periodLabel } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const ref = { ...REFERENCE };

test("the module is what the write-up says it is: source, licence, dates, counts and rules", () => {
  assert.match(MODEL.source, /Demandes de valeurs foncières/);
  assert.equal(MODEL.licence, "Licence Ouverte / Open Licence 2.0");
  assert.equal(MODEL.retrieved, "2026-10-11");
  assert.equal(MODEL.firstSale, "2021-01-04");
  assert.equal(MODEL.lastSale, "2025-12-31");
  assert.deepEqual(MODEL.rules, { areaMin: 9, areaMax: 250, roomsMin: 1, roomsMax: 8, perM2Min: 3000, perM2Max: 30000 });
  const c = MODEL.counts;
  assert.equal(c.train + c.calibration + c.test, c.kept);
  assert.equal(c.kept + Object.values(c.dropped).reduce((a, b) => a + b, 0), c.sales);
  assert.deepEqual([c.kept, c.train, c.calibration, c.test], [142221, 85332, 28444, 28445]);
  assert.deepEqual(c.dropped, { notASale: 2904, noFlat: 44315, otherProperty: 3498, severalFlats: 6964, noSinglePrice: 54, notParis: 0, area: 1510, rooms: 232, perM2Below: 5268, perM2Above: 399 });
  assert.equal(c.under100PerM2, 1799);   // agrees with a separate count in Python
  // "About 5% of single-flat sales were left out" by the limits on area, rooms and price per m2.
  const limits = c.dropped.area + c.dropped.rooms + c.dropped.perM2Below + c.dropped.perM2Above;
  assert.equal((limits / (c.kept + limits) * 100).toFixed(1), "5.0");
  assert.deepEqual(ref, { area: 42, rooms: 2, arr: 15, out: 1, period: "2025H2" });
  assert.equal(PERIODS.length, 10);
});

test("source figures: the five yearly files, and three sales looked up in them by hand", () => {
  // Data rows in the files for 2021 to 2025 (line counts minus the header, counted with zcat | wc -l on 11 October 2026).
  assert.equal(MODEL.counts.rows, 81517 + 98308 + 80993 + 74800 + 84440);
  // Different id_mutation values in the same five files, counted by a separate script.
  assert.equal(MODEL.counts.sales, 43743 + 47240 + 39417 + 36154 + 40811);
  // The first three sales of the test set, as they stand in the source files (looked up again at review by the
  // identifiers the build script prints; neither those nor the dates are kept in any published file):
  //   first half of 2022   380,590 euros  27 m2  2 rooms  Paris 9e   one Dépendance row
  //   first half of 2024   457,220 euros  42 m2  2 rooms  Paris 11e  no Dépendance row
  //   second half of 2022  437,500 euros  37 m2  2 rooms  Paris 2e   one Dépendance row
  assert.deepEqual(MODEL.sample[0], [27, 2, 9, 1, PERIODS.indexOf("2022H1"), 380590]);
  assert.deepEqual(MODEL.sample[1], [42, 2, 11, 0, PERIODS.indexOf("2024H1"), 457220]);
  assert.deepEqual(MODEL.sample[2], [37, 2, 2, 1, PERIODS.indexOf("2022H2"), 437500]);
  assert.equal(MODEL.sample.length, 400);
  for (const [area, rooms, arr, out, pi, price] of MODEL.sample) {
    assert.ok(area >= 9 && area <= 250 && rooms >= 1 && rooms <= 6 && arr >= 1 && arr <= 20 && out >= 0 && out <= 2 && pi >= 0 && pi < 10);
    assert.ok(price / area >= 3000 && price / area <= 30000);
  }
});

test("the coefficients agree with a separate fit (normal equations in Python on the cached files, run during the build)", () => {
  // The Python fit differed from every stored coefficient by less than 5e-7, the rounding to six decimals.
  const b = Object.fromEntries(MODEL.terms.map((t, i) => [t, MODEL.beta[i]]));
  close(b.intercept, 12.893389, 1e-9);
  close(b.logArea, 0.977109, 1e-9);
  close(b.logArea2, 0.045861, 1e-9);
  close(b.arr6, 0.374654, 1e-9);
  close(b.arr19, -0.163856, 1e-9);
  close(b.out0, -0.026973, 1e-9);
  assert.equal(MODEL.terms.length, 38);
  // The reference flat's own levels have no column.
  for (const t of ["rooms2", "arr15", "out1", "period2025H2"]) assert.ok(!MODEL.terms.includes(t));
  assert.equal(MODEL.sigma, 0.2448);
  close(Math.sqrt(MODEL.cov[1][1]), 0.0032683, 1e-6);   // Python: 0.003268341
});

test("the reference flat's estimate is exp of the intercept, and every other part of the answer follows from it", () => {
  const p = predict(ref);
  close(p.log, 12.893389, 1e-12);
  assert.equal(Math.round(p.price), 397674);
  close(p.se, Math.sqrt(MODEL.cov[0][0]), 1e-12);
  close(p.ciLow, Math.exp(12.893389 - 1.959964 * p.se), 1e-6);
  close(p.perM2, 397674.456 / 42, 1e-3);
  close(p.elasticity, 0.977109, 1e-12);
  close(p.perExtraM2, 0.977109 * 397674.456 / 42, 1e-3);
  close(p.mean, p.price * 1.0288, 1e-6);
  // 15th arrondissement, 90%: log residual limits -0.3376 and 0.3077 in the module.
  assert.deepEqual(MODEL.intervals.byArr[14][2], [-0.3376, 0.3077]);
  close(p.low, p.price * Math.exp(-0.3376), 1e-6);
  close(p.high, p.price * Math.exp(0.3077), 1e-6);
});

test("a flat that differs in every feature, worked by hand from the coefficients", () => {
  const flat = { area: 60, rooms: 3, arr: 6, out: 0, period: "2022H1" };
  const d = Math.log(60 / 42);
  const log = 12.893389 + 0.977109 * d + 0.045861 * d * d + 0.016465 + 0.374654 - 0.026973 + 0.086348;
  close(log, 13.6982276, 1e-6);
  const p = predict(flat);
  close(p.log, log, 1e-12);
  assert.equal(Math.round(p.price), 889334);
  close(p.elasticity, 0.977109 + 2 * 0.045861 * d, 1e-12);
  assert.deepEqual(design(flat).filter((v) => v !== 0).length, 7);
});

test("what each feature adds: factors multiply back to the estimate, and the euro figure is the estimate minus the estimate without the feature", () => {
  const flat = { area: 60, rooms: 3, arr: 6, out: 0, period: "2022H1" };
  const b = breakdown(flat);
  assert.deepEqual(b.items.map((i) => i.key), ["area", "rooms", "arr", "out", "period"]);
  close(b.referencePrice * b.items.reduce((m, i) => m * i.factor, 1), b.price, 1e-6);
  close(b.price, predict(flat).price, 1e-9);
  const arr = b.items.find((i) => i.key === "arr");
  close(arr.pct, Math.exp(0.374654) - 1, 1e-12);
  close(arr.euros, predict(flat).price - predict({ ...flat, arr: 15 }).price, 1e-6);
  close(arr.se, 0.0069126, 1e-6);   // Python: 0.006912644
  assert.ok(arr.pctLow < arr.pct && arr.pct < arr.pctHigh);
  const area = b.items.find((i) => i.key === "area");
  close(area.euros, predict(flat).price - predict({ ...flat, area: 42 }).price, 1e-6);
  const out = b.items.find((i) => i.key === "out");
  assert.ok(out.pct < 0 && out.euros < 0);
  close(out.euros, predict(flat).price - predict({ ...flat, out: 1 }).price, 1e-6);
  // The euro figures do not add up to the gap between the two prices: the write-up says so.
  const sum = b.items.reduce((s, i) => s + i.euros, 0);
  assert.ok(Math.abs(sum - (b.price - b.referencePrice)) > 1000);
});

test("the reference flat adds nothing anywhere", () => {
  const b = breakdown(ref);
  for (const i of b.items) { assert.equal(i.pct, 0); assert.equal(i.euros, 0); assert.equal(i.se, 0); assert.ok(i.same); }
  close(b.price, b.referencePrice, 1e-9);
});

test("intervals: nested as the level rises, contain the estimate, and are wider where prices are more scattered", () => {
  for (const arr of [1, 6, 11, 15, 19, 20]) {
    const ps = LEVELS.map((l) => predict({ ...ref, arr }, l));
    for (let i = 1; i < ps.length; i++) { assert.ok(ps[i].low <= ps[i - 1].low); assert.ok(ps[i].high >= ps[i - 1].high); }
    for (const p of ps) assert.ok(p.low < p.price && p.price < p.high);
  }
  for (const row of MODEL.intervals.byArr) for (let i = 0; i < row.length; i++) {
    assert.ok(row[i][0] < 0 && row[i][1] > 0);
    if (i) { assert.ok(row[i][0] <= row[i - 1][0]); assert.ok(row[i][1] >= row[i - 1][1]); }
  }
  const width = (arr) => { const p = predict({ ...ref, arr }, 0.9); return p.high / p.low; };
  assert.ok(width(1) > width(15));
  // The interval for the geometric mean (coefficients only) is far narrower than the interval for one sale.
  const p = predict(ref);
  assert.ok(p.ciHigh / p.ciLow < 1.02 && p.high / p.low > 1.8);
});

test("held-out coverage is what each interval promises, and the limits are per arrondissement for a reason", () => {
  const t = MODEL.test;
  assert.equal(t.n, 28445);
  LEVELS.forEach((level, i) => close(t.coverage[i], level, 0.006));
  assert.deepEqual(t.coverage, [0.498471, 0.796731, 0.899455, 0.950114]);
  // 25,585 of the 28,445 test sales fall inside the 90% range: 89.9%, as the page and the write-up say.
  assert.equal(Math.round(t.coverage[2] * t.n), 25585);
  assert.equal((25585 / 28445 * 100).toFixed(1), "89.9");
  assert.deepEqual(t.coverage90ByArr, { lowest: [20, 0.8799], highest: [2, 0.9271] });
  // One pair of limits for the whole city would cover only 80% of sales in the 1st arrondissement.
  assert.deepEqual(t.pooledCoverage90ByArr.lowest, [1, 0.8049]);
  assert.deepEqual(t.coverage90ByRooms, [0.8822, 0.9062, 0.9154, 0.8934, 0.8889, 0.8873]);
  assert.equal(MODEL.calibrationByArr.reduce((a, b) => a + b, 0), MODEL.counts.calibration);
  assert.equal(Math.min(...MODEL.calibrationByArr), 284);
});

test("held-out error, and the honest comparison: a table of medians does as well", () => {
  const t = MODEL.test;
  assert.equal(t.medianAbsPct, 0.1284);
  assert.equal(t.within10, 0.4026);
  assert.equal(t.within20, 0.6965);
  assert.equal(t.beyond30, 0.1551);
  assert.equal(t.shareAboveEstimate, 0.5354);
  assert.deepEqual(t.baselines, { paris: 0.1593, arrondissement: 0.1342, arrondissementAndPeriod: 0.1267 });
  // The regression beats the city-wide and arrondissement medians but not the arrondissement-by-half-year table.
  assert.ok(t.medianAbsPct < t.baselines.arrondissement && t.medianAbsPct > t.baselines.arrondissementAndPeriod);
  // An independent refit at review (numpy least squares on the same files) gave the same four figures: 0.1284,
  // 0.1593, 0.1342, 0.1267; and on ten other random splits the table of medians was ahead every time.
  // Mean log error by floor-area band stays within 3%: the curve in area is not badly bent anywhere.
  for (const [, , n, e] of t.meanLogErrorByArea) { assert.ok(n > 1000); assert.ok(Math.abs(e) < 0.03, `band error ${e}`); }
});

test("the price rule looks at the outcome: what the error figures are with the removed sales put back", () => {
  const c = MODEL.counts, u = MODEL.test.withPriceRuleUndone;
  // One in five of the 5,667 sales removed for their price per m2, beside the 28,445 test sales.
  assert.equal(c.dropped.perM2Below + c.dropped.perM2Above, 5667);
  assert.equal(u.added, Math.floor(5667 / 5));
  assert.equal(u.added, 1133);
  assert.equal(u.n, 28445 + 1133);
  // The page prints 13.4% for the model, 13.3% for the table of medians, 19% beyond 30%, and 86.5% inside the 90% range.
  assert.deepEqual(u, { added: 1133, n: 29578, medianAbsPct: 0.134174, beyond30: 0.1875, coverage90: 0.865, arrondissementAndPeriod: 0.133487 });
  assert.deepEqual([(u.medianAbsPct * 100).toFixed(1), (u.arrondissementAndPeriod * 100).toFixed(1), Math.round(u.beyond30 * 100), (u.coverage90 * 100).toFixed(1)], ["13.4", "13.3", 19, "86.5"]);
  // Every one of these is worse than the figure for the kept sales alone, and the table of medians is still ahead.
  assert.ok(u.medianAbsPct > MODEL.test.medianAbsPct && u.beyond30 > MODEL.test.beyond30 && u.coverage90 < MODEL.test.coverage[2]);
  assert.ok(u.arrondissementAndPeriod < u.medianAbsPct);
  // Nearly every removed sale misses by more than 30%, so the count beyond 30% is close to the old count plus those added.
  const before = Math.round(MODEL.test.beyond30 * 28445);
  assert.ok(Math.abs(u.beyond30 * u.n - (before + u.added)) < 15);
});

test("the 400 bundled held-out sales: the page's scatter and its caption", () => {
  const h = heldOut();
  assert.equal(h.length, 400);
  close(h[0].estimate, predict({ area: 27, rooms: 2, arr: 9, out: 1, period: "2022H1" }).price, 1e-9);
  close(h[0].error, (h[0].estimate - 380590) / 380590, 1e-12);
  close(medianAbsError(h), 0.1338, 5e-5);
  assert.equal(h.filter((s) => Math.abs(s.error) <= 0.2).length, 276);
  // A sample of 400 should sit near the figure for all 28,445.
  close(medianAbsError(h), MODEL.test.medianAbsPct, 0.02);
  assert.ok(Number.isNaN(medianAbsError([])));
  close(medianAbsError([{ error: -0.3 }, { error: 0.1 }]), 0.2, 1e-12);
});

test("the finding on the page: the reference flat in the 6th and in the 19th", () => {
  const sixth = predict({ ...ref, arr: 6 }).price, nineteenth = predict({ ...ref, arr: 19 }).price;
  assert.equal(Math.round(sixth / 1000), 578);
  assert.equal(Math.round(nineteenth / 1000), 338);
  close(sixth / nineteenth, Math.exp(0.374654 + 0.163856), 1e-9);
  assert.equal((sixth / nineteenth - 1).toFixed(2), "0.71");
  assert.equal(Math.round(predict(ref).price / 1000), 398);
  assert.equal((MODEL.test.medianAbsPct * 100).toFixed(1), "12.8");
  assert.equal((MODEL.test.baselines.arrondissementAndPeriod * 100).toFixed(1), "12.7");
});

test("figures quoted in the write-up", () => {
  // The elasticity passes 1 at about 54 m2: above that the price per m2 rises with size, below it falls.
  const perM2 = (a) => predict({ ...ref, area: a }).perM2;
  assert.ok(predict({ ...ref, area: 53 }).elasticity < 1 && predict({ ...ref, area: 55 }).elasticity > 1);
  assert.ok(perM2(40) < perM2(30) && perM2(53.9) < perM2(53) && perM2(56) > perM2(55) && perM2(120) > perM2(100));
  // Elasticity of price to floor area at 20, 42, 100 and 250 m2.
  assert.deepEqual([20, 42, 100, 250].map((a) => predict({ ...ref, area: a }).elasticity.toFixed(2)), ["0.91", "0.98", "1.06", "1.14"]);
  // One more room in the same 42 m2: 2 to 3 rooms.
  assert.equal((breakdown({ ...ref, rooms: 3 }).items[1].pct * 100).toFixed(1), "1.7");
  assert.equal((breakdown({ ...ref, rooms: 1 }).items[1].pct * 100).toFixed(1), "-3.4");
  assert.equal((breakdown({ ...ref, out: 0 }).items[3].pct * 100).toFixed(1), "-2.7");
  assert.equal((breakdown({ ...ref, out: 2 }).items[3].pct * 100).toFixed(1), "1.4");
  // The same flat sold in the first half of 2021 against the second half of 2025.
  assert.equal((breakdown({ ...ref, period: "2021H1" }).items[4].pct * 100).toFixed(1), "10.6");
  assert.equal((breakdown({ ...ref, period: "2024H1" }).items[4].pct * 100).toFixed(1), "-2.0");
  assert.equal(MODEL.r2, 0.8845);
  assert.equal(MODEL.smear, 1.0288);
  assert.equal(Math.round(predict(ref).perExtraM2), 9252);
});

test("one feature at a time: the curve moves only that feature and marks the flat's own value", () => {
  const c = curve(ref, "arr");
  assert.equal(c.points.length, 20);
  assert.deepEqual(c.points.filter((p) => p.current).map((p) => p.value), [15]);
  close(c.points[5].price, predict({ ...ref, arr: 6 }).price, 1e-9);
  const a = curve(ref, "area");
  assert.equal(a.points[0].value, LIMITS.areaMin);
  close(a.points.at(-1).value, LIMITS.areaMax, 1e-9);
  for (let i = 1; i < a.points.length; i++) assert.ok(a.points[i].price > a.points[i - 1].price);
  assert.equal(curve(ref, "period").points.length, 10);
  assert.equal(curve(ref, "rooms").points.at(-1).label, "6 or more");
  assert.ok(curve(ref, "colour").error);
  for (const key of ["area", "rooms", "arr", "out", "period"]) for (const p of curve(ref, key, 0.5).points) assert.ok(p.low < p.price && p.price < p.high);
});

test("bad input gets a sentence, never a number", () => {
  for (const bad of [null, undefined, "flat", {}, { ...ref, area: NaN }, { ...ref, area: 8.99 }, { ...ref, area: 250.01 }, { ...ref, area: 1e308 }, { ...ref, area: -42 }, { ...ref, area: "42" },
    { ...ref, area: Infinity }, { ...ref, rooms: 0 }, { ...ref, rooms: 7 }, { ...ref, rooms: 2.5 }, { ...ref, arr: 0 }, { ...ref, arr: 21 }, { ...ref, arr: 1.5 }, { ...ref, out: 3 }, { ...ref, out: -1 },
    { ...ref, period: "2026H1" }, { ...ref, period: 9 }]) {
    assert.ok(check(bad).length > 20, JSON.stringify(bad));
    assert.ok(predict(bad).error);
    assert.equal(predict(bad).price, undefined);
    assert.ok(breakdown(bad).error);
    assert.ok(curve(bad, "area").error);
    assert.equal(unusual(bad), "");
  }
  assert.ok(predict(ref, 0.99).error);
  assert.equal(check(ref), "");
  assert.equal(check({ ...ref, area: 9 }), "");
  assert.equal(check({ ...ref, area: 250 }), "");
  assert.match(check({ ...ref, area: 300 }), /from 9 to 250 m²/);
});

test("the edges of the range give finite, ordered answers", () => {
  const small = predict({ area: 9, rooms: 1, arr: 19, out: 0, period: "2024H1" }), large = predict({ area: 250, rooms: 6, arr: 6, out: 2, period: "2021H1" });
  for (const p of [small, large]) for (const v of Object.values(p)) assert.ok(Number.isFinite(v));
  assert.ok(small.price < 120000 && large.price > 3000000);
});

test("a floor area that is rare for the number of rooms is flagged", () => {
  assert.equal(unusual(ref), "");
  assert.match(unusual({ ...ref, area: 100 }), /29,438 flats with 2 rooms in the data were larger than 82 m²/);
  assert.match(unusual({ ...ref, rooms: 6, area: 60 }), /1,571 flats with 6 or more rooms in the data were smaller than 88 m²/);
  assert.equal(unusual({ ...ref, area: 82 }), "");
  assert.equal(unusual({ ...ref, area: 18 }), "");
  assert.notEqual(unusual({ ...ref, area: 17.9 }), "");
});

test("labels", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 20].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "20th"]);
  assert.deepEqual([1, 2, 6].map(roomsLabel), ["1 room", "2 rooms", "6 or more rooms"]);
  assert.equal(periodLabel("2025H2"), "July to December 2025");
  assert.equal(periodLabel("2021H1"), "January to June 2021");
});
