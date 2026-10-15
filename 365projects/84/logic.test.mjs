import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { DATA } from "./data.js";
import {
  addMonths, monthDiff, monthLabel, addQuarters, quarterOf, hpTrend, outputGap, monthlyFromQuarterly, taylor, checkParams,
  compare, fitWeights, toCsv,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const N = monthDiff(DATA.first, DATA.last) + 1;
const MONTHS = Array.from({ length: N }, (_, i) => addMonths(DATA.first, i));
const at = (ym) => monthDiff(DATA.first, ym);

test("months and quarters", () => {
  assert.equal(addMonths("2001-12", 1), "2002-01");
  assert.equal(monthLabel("2026-06"), "Jun 2026");
  assert.equal(addQuarters("1947Q4", 1), "1948Q1");
  assert.equal(addQuarters("1996Q2", 119), "2026Q1");
  assert.equal(quarterOf("2026-03"), "2026Q1");
  assert.equal(quarterOf("2026-04"), "2026Q2");
  assert.deepEqual(monthlyFromQuarterly("2000Q1", [1, 2], "1999-12", 8), [null, 1, 1, 1, 2, 2, 2, null]);
});

test("the Hodrick-Prescott trend: a dense solve, statsmodels, and its exact properties", () => {
  // statsmodels 0.15.0, hpfilter([1, 3, 2, 5, 4, 6, 9], lamb=100), run during the build.
  const sm = [0.8848089171373067, 2.0049725119508857, 3.1262880175930925, 4.259857619773045, 5.4055206240239295, 6.570517759681199, 7.748034549840068];
  hpTrend([1, 3, 2, 5, 4, 6, 9], 100).forEach((v, i) => close(v, sm[i], 1e-12));
  [1.8196721311475395, 2.360655737704918, 2.819672131147543].forEach((v, i) => close(hpTrend([1, 4, 2], 10)[i], v, 1e-12));
  // A straight line is its own trend, and the cycle of any series sums to zero and is orthogonal to time.
  const line = Array.from({ length: 50 }, (_, i) => 3 + 0.7 * i);
  hpTrend(line, 1600).forEach((v, i) => close(v, line[i], 1e-8));
  const r = rng(4);
  const y = Array.from({ length: 120 }, (_, i) => 0.01 * i + r.normal(0, 0.02));
  const t = hpTrend(y, 1600);
  close(y.reduce((s, v, i) => s + v - t[i], 0), 0, 1e-9);
  close(y.reduce((s, v, i) => s + i * (v - t[i]), 0), 0, 1e-7);
  assert.deepEqual(hpTrend([5, 6], 1600), [5, 6]);
  assert.throws(() => outputGap([1, 2, 3], { method: "three-sided" }));
});

test("the output gap from real GDP agrees with statsmodels on the bundled data", () => {
  // statsmodels hpfilter(log GDP, 1600) times 100: first, 101st and last quarter; and the last quarter filtered on the first 61.
  const us = outputGap(DATA.us.gdp.values);
  close(us[0], 2.5310427691457527, 1e-8);
  close(us[100], -0.9762905747951578, 1e-8);
  close(us.at(-1), -0.44517968742834313, 1e-8);
  const ind = outputGap(DATA.in.gdp.values);
  close(ind[0], 1.130878931735424, 1e-8);
  close(ind[100], -8.716696418034076, 1e-8);
  close(ind.at(-1), 1.0653888777252263, 1e-8);
  const one = outputGap(DATA.us.gdp.values, { method: "one-sided", start: 40 });
  assert.equal(one[38], null);
  close(one[60], 2.197447296881805, 1e-8);
  close(outputGap(DATA.in.gdp.values, { method: "one-sided" })[60], 0.3546904899298653, 1e-8);
  // The last quarter is the same either way: the two-sided filter has nothing after it.
  close(one.at(-1), us.at(-1), 1e-9);
});

test("Taylor's rule by hand, and his own numbers", () => {
  // Taylor (1993): r = p + .5y + .5(p - 2) + 2. With 2% inflation and no gap the rate is 4%.
  close(taylor({ inflation: 2, gap: 0 }), 4);
  close(taylor({ inflation: 4, gap: -2 }), 2 + 4 + 0.5 * 2 - 1);
  close(taylor({ inflation: 4, gap: 1, rStar: 1.5, piStar: 4, a: 1, b: 0 }), 5.5);
  // A rise in inflation of 1 point raises the rate by 1 + a: the Taylor principle when a > 0.
  close(taylor({ inflation: 3, gap: 0 }) - taylor({ inflation: 2, gap: 0 }), 1.5);
  assert.equal(checkParams({ a: 0.5, b: 0.5, rStar: 2, piStar: 2 }), null);
  assert.match(checkParams({ a: -1, b: 0.5, rStar: 2, piStar: 2 }), /a must be/);
  assert.match(checkParams({ a: 0.5, b: NaN, rStar: 2, piStar: 2 }), /b must be/);
  assert.match(checkParams({ a: 0.5, b: 0.5, rStar: 1e308, piStar: 2 }), /rStar must be/);
});

test("comparison: means, root mean square, edges of the one-point band, missing months", () => {
  const r = compare({
    months: ["a", "b", "c", "d"], actual: [4, 3, null, 6], inflation: [2, 2, 2, 2], gap: [0, 0, 0, 0],
    params: { rStar: 2, piStar: 2, a: 0.5, b: 0.5 },
  });
  assert.equal(r.n, 3);
  assert.deepEqual(r.rows.map((x) => x.diff), [0, -1, 2]);
  close(r.mean, 1 / 3);
  close(r.rms, Math.sqrt(5 / 3));
  assert.equal(r.looser, 0); // exactly one point below is not more than one
  assert.equal(r.tighter, 1);
  assert.equal(compare({ months: [], actual: [], inflation: [], gap: [], params: {} }).n, 0);
  assert.equal(compare({ months: ["x"], actual: [1], inflation: [-10], gap: [0], params: { rStar: 2, piStar: 2, a: 0.5, b: 0.5 } }).belowZero, 1);
});

test("fitted weights recover a rule that generated the data, and refuse what cannot be fitted", () => {
  const r = rng(7);
  const months = Array.from({ length: 60 }, (_, i) => i), inflation = months.map(() => r.uniform(0, 6)), gap = months.map(() => r.normal(0, 2));
  const actual = months.map((_, i) => taylor({ inflation: inflation[i], gap: gap[i], rStar: 1, piStar: 3, a: 0.8, b: 0.3 }));
  const f = fitWeights({ months, actual, inflation, gap, rStar: 1, piStar: 3 });
  close(f.a, 0.8, 1e-9); close(f.b, 0.3, 1e-9); close(f.rms, 0, 1e-9);
  assert.match(fitWeights({ months: months.slice(0, 5), actual, inflation, gap, rStar: 1, piStar: 3 }).error, /at least 12/);
  // A gap that is an exact multiple of the inflation gap: the two weights cannot be told apart.
  assert.match(fitWeights({ months, actual, inflation, gap: inflation.map((v) => 2 * (v - 3)), rStar: 1, piStar: 3 }).error, /too closely/);
});

test("CSV export: one row a month, numbers only", () => {
  const csv = toCsv([{ month: "2020-01", actual: 1.625, rule: -0.5, diff: 2.125, inflation: 1.6, gap: null }], "US",
    { measure: "WPI to 2012 and CPI (Combined) from 2014", gap: "two-sided", a: 0.5, b: 1, rStar: 2, piStar: 4 });
  assert.equal(csv.split("\n")[1], "2020-01,1.625,-0.5,2.125,1.6,");
  // The headings say which measure, which gap and which rule; six cells, none a formula.
  const head = csv.split("\n")[0].split(",");
  assert.equal(head.length, 6);
  assert.equal(head[2], "Taylor rule (%) with a 0.5 b 1 r* 2 pi* 4");
  assert.equal(head[4], "inflation (%) WPI to 2012 and CPI (Combined) from 2014");
  assert.equal(head[5], "output gap (%) two-sided Hodrick-Prescott");
  assert.equal(toCsv([], "a,b=c").split(",").length, 6); // a comma in a name cannot add a column
  assert.ok(!/(^|,)[=+@]/m.test(csv));
});

test("the data: values checked against the sources", () => {
  assert.equal(DATA.first, "1986-01");
  // BIS WS_CBPOL: US target midpoint 0.125 in December 2008; 3.875 in September 2026. India's repo rate 4.0 in May 2020.
  assert.equal(DATA.us.policy[at("2008-12")], 0.125);
  assert.equal(DATA.us.policy[at("2026-09")], 3.875);
  assert.equal(DATA.in.policy[at("2020-05")], 4);
  assert.equal(DATA.in.policy[at("2001-03")], null); // before the repo rate became the policy rate (BIS note)
  // BLS CUUR0000SA0: 105.5 in January 1985 and 109.6 in January 1986; 324.800 in September 2025 and 336.940 in September 2026.
  close(DATA.us.inflation.cpi[at("1986-01")], 3.89, 1e-9);
  close(DATA.us.inflation.cpi[at("2026-09")], 3.74, 1e-9);
  assert.equal(DATA.us.inflation.cpi[at("2025-10")], null); // no CPI was published for October 2025
  // OECD's India CPI is the Labour Bureau's CPI for industrial workers: 1.08% for June 2017, 1.79% for July 2017 and 6.46%
  // for July 2016, as the Labour Bureau's July 2017 release reported them (Press Trust of India, 31 August 2017).
  assert.equal(DATA.in.inflation.cpiIw[at("2017-06")], 1.08);
  assert.equal(DATA.in.inflation.cpiIw[at("2017-07")], 1.79);
  assert.equal(DATA.in.inflation.cpiIw[at("2016-07")], 6.46);
  assert.equal(DATA.in.inflation.cpiIw[at("2020-10")], 5.9);
  // BIS (CPI Combined): 7.61 in October 2020, MoSPI's published figure; 2.31 for June 2025, where MoSPI's release of
  // July 2025 gave 2.10 on the old base (the BIS joins the 2012-based and 2024-based indexes).
  close(DATA.in.inflation.cpi[at("2020-10")], 7.61, 0.005);
  assert.equal(DATA.in.inflation.cpi[at("2025-06")], 2.31);
  for (let m = "2013-01"; m <= "2013-12"; m = addMonths(m, 1)) assert.equal(DATA.in.inflation.cpi[at(m)], null);
  assert.equal(DATA.us.gdp.first, "1947Q1");
  close(DATA.us.gdp.values.at(-1), 24408.0, 0.05); // BEA A191RX, 2026Q2: 24,408,011 million
  assert.equal(DATA.in.gdp.first, "1996Q2");
});

function country(code, measure, method, from, to, params) {
  const src = DATA[code];
  const gap = monthlyFromQuarterly(src.gdp.first, outputGap(src.gdp.values, { method }), DATA.first, N);
  const idx = MONTHS.map((m, i) => (m >= from && m <= to ? i : -1)).filter((i) => i >= 0);
  const pick = (a) => idx.map((i) => a[i]);
  return compare({ months: pick(MONTHS), actual: pick(src.policy), inflation: pick(src.inflation[measure]), gap: pick(gap), params });
}

test("the finding on the page", () => {
  const taylors = { rStar: 2, piStar: 2, a: 0.5, b: 0.5 };
  // Taylor's own years, 1987 to 1992, core PCE and a two-sided HP gap: the rule tracks the Fed.
  const early = country("us", "pceCore", "two-sided", "1987-01", "1992-12", taylors);
  assert.equal(early.n, 72);
  assert.equal(early.mean.toFixed(2), "0.07");
  assert.equal(early.rms.toFixed(1), "1.0");
  // 2001 to the last month with every input (June 2026).
  const us = country("us", "pceCore", "two-sided", "2001-01", "2026-12", taylors);
  assert.equal(us.n, 306);
  assert.equal(us.rows.at(-1).month, "2026-06");
  assert.equal(us.mean.toFixed(1), "-2.3");
  assert.equal(us.looser, 239);
  const widest = us.rows.reduce((a, b) => (b.diff < a.diff ? b : a));
  assert.equal(widest.month, "2022-02");
  assert.equal(widest.diff.toFixed(1), "-9.5");
  // India from 2014 (CPI Combined), target 4%.
  const ind = country("in", "cpi", "two-sided", "2014-01", "2026-12", { ...taylors, piStar: 4 });
  assert.equal(ind.n, 147);
  assert.equal(ind.mean.toFixed(1), "-1.3");
  assert.equal(ind.rows.at(-1).month, "2026-03");
  // The measure of inflation alone moves India's average gap: CPI for industrial workers over the same months.
  const iw = country("in", "cpiIw", "two-sided", "2014-01", "2026-12", { ...taylors, piStar: 4 });
  assert.equal(iw.mean.toFixed(1), "-1.6");
});

test("statements in the write-up, recomputed in the review from the sources", () => {
  const taylors = { rStar: 2, piStar: 2, a: 0.5, b: 0.5 };
  // After the financial crisis the default rule never went below 0.6% (July 2009); in 2020 it went below zero in three months.
  const crisis = country("us", "pceCore", "two-sided", "2008-01", "2015-12", taylors);
  const low = crisis.rows.reduce((p, q) => (q.rule < p.rule ? q : p));
  assert.equal(low.month, "2009-07"); assert.equal(low.rule.toFixed(1), "0.6"); assert.equal(crisis.belowZero, 0);
  const y2020 = country("us", "pceCore", "two-sided", "2020-01", "2020-12", taylors);
  assert.equal(y2020.belowZero, 3);
  assert.equal(y2020.rows.reduce((p, q) => (q.rule < p.rule ? q : p)).rule.toFixed(1), "-2.0");
  // Gap weight 1 and the one-sided gap: -2.1% in March 2009.
  const one = country("us", "pceCore", "one-sided", "2008-01", "2015-12", { ...taylors, b: 1 });
  const lowOne = one.rows.reduce((p, q) => (q.rule < p.rule ? q : p));
  assert.equal(lowOne.month, "2009-03"); assert.equal(lowOne.rule.toFixed(1), "-2.1");
  // 2021 and 2022: the rule 6.8 points above the Fed's target on average.
  assert.equal(country("us", "pceCore", "two-sided", "2021-01", "2022-12", taylors).mean.toFixed(1), "-6.8");
  // CPI inflation above PCE inflation since 2001: 0.34 points on average.
  const d = MONTHS.map((m, i) => (m >= "2001-01" && DATA.us.inflation.cpi[i] != null && DATA.us.inflation.pce[i] != null ? DATA.us.inflation.cpi[i] - DATA.us.inflation.pce[i] : null)).filter((v) => v != null);
  assert.equal((d.reduce((s, v) => s + v, 0) / d.length).toFixed(2), "0.34");
  // India: May 2019 and July 2009 as quoted; the largest gap between the two consumer indexes since 2014 is May 2019.
  assert.equal(DATA.in.inflation.cpiIw[at("2019-05")], 8.65); assert.equal(DATA.in.inflation.cpi[at("2019-05")], 3.03);
  assert.equal(DATA.in.inflation.cpi[at("2009-07")], -0.62); assert.equal(DATA.in.inflation.cpiIw[at("2009-07")], 11.89);
  let widest = null;
  for (let i = at("2014-01"); i < N; i++) {
    const a = DATA.in.inflation.cpiIw[i], b = DATA.in.inflation.cpi[i];
    if (a != null && b != null && (!widest || Math.abs(a - b) > widest.d)) widest = { m: MONTHS[i], d: Math.abs(a - b) };
  }
  assert.equal(widest.m, "2019-05"); assert.equal(widest.d.toFixed(1), "5.6");
  // Second quarter of 2020, two-sided gap: -8.9% for the US and -25% for India.
  const q = (g, first, yq) => g[(Number(yq.slice(0, 4)) - Number(first.slice(0, 4))) * 4 + Number(yq.slice(5)) - Number(first.slice(5))];
  assert.equal(q(outputGap(DATA.us.gdp.values), DATA.us.gdp.first, "2020Q2").toFixed(1), "-8.9");
  assert.equal(q(outputGap(DATA.in.gdp.values), DATA.in.gdp.first, "2020Q2").toFixed(0), "-25");
});
