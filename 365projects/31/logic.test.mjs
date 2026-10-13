import test from "node:test";
import assert from "node:assert/strict";
import { PRICES } from "../data/prices.js";
import { SMALL, monthOf, monthLabel, placeName, categoriesOf, decompose, history, peakMonth, periodPhrase, categoryReading, summary, reconciliation, oneDecimal, flaggedSeries, flagNotes } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const country = (code) => PRICES.countries.find((c) => c.code === code);
const at = (year, month) => { for (let i = 0; i < PRICES.months; i++) { const m = monthOf(PRICES, i); if (m.year === year && m.month === month) return i; } throw new Error("no such month"); };
// Tests that pin a count or a largest value stop at this month, so they stay true when newer months are added.
const END = at(2026, 8);

/* ---------- a two-category world worked out by hand ---------- */
// Months run from December 2019. Weights: 2020 X 600, Y 400; 2021 and 2022 X 500, Y 500.
// X: Dec 2019 100, Jun 2020 110, Dec 2020 120, Jun 2021 126, Dec 2021 132.
// Y: Dec 2019 100, Jun 2020 100, Dec 2020  90, Jun 2021  99, Dec 2021  99.
// All items, chained through December: Dec 2019 100; Jun 2020 100 × (0.6 × 1.10 + 0.4 × 1.00) = 106;
// Dec 2020 100 × (0.6 × 1.20 + 0.4 × 0.90) = 108; Jun 2021 108 × (0.5 × 1.05 + 0.5 × 1.10) = 116.1;
// Dec 2021 108 × (0.5 × 1.10 + 0.5 × 1.10) = 118.8.
function toy(links = [12]) {
  const months = 26, blank = () => new Array(months).fill(null);
  const all = blank(), x = blank(), y = blank();
  const put = (i, a, b, c) => { all[i] = a; x[i] = b; y[i] = c; };
  put(0, 100, 100, 100); put(6, 106, 110, 100); put(12, 108, 120, 90); put(18, 116.1, 126, 99); put(24, 118.8, 132, 99);
  const data = {
    first: "2019-12", months, weightYears: [2020, 2021, 2022],
    schemes: { two: { categories: [{ code: "X", name: "Xylophones", short: "Xylophones" }, { code: "Y", name: "Yoghurt", short: "Yoghurt" }] } },
  };
  const c = { code: "ZZ", name: "Toyland", source: "eurostat", scheme: "two", links, decimals: 2, last: 24, rate: blank(), index: [all, x, y], weights: [[600, 400], [500, 500], [500, 500]] };
  return { data, c };
}

test("month positions and labels", () => {
  assert.deepEqual(monthOf(PRICES, 0), { year: 2013, month: 12 });
  assert.deepEqual(monthOf(PRICES, 1), { year: 2014, month: 1 });
  assert.deepEqual(monthOf(PRICES, 13), { year: 2015, month: 1 });
  assert.equal(monthLabel(PRICES, at(2022, 10)), "October 2022");
  assert.equal(monthLabel(PRICES, at(2022, 10), true), "Oct 2022");
  assert.equal(placeName(country("EA")), "the euro area");
  assert.equal(placeName(country("DE")), "Germany");
  assert.equal(placeName(country("UK")), "the United Kingdom");
});

test("the Ribe contribution, by hand: a 12-month period across one December link", () => {
  const { data, c } = toy();
  const r = decompose(data, c, 6, 18); // June 2020 to June 2021
  close(r.total, 100 * (116.1 / 106 - 1), 1e-12); // 9.5283%
  // Last year's part: weight × (Dec - Jun) / Dec the year before, over the all-items index a year ago.
  // This year's part: weight × (Jun - Dec) / Dec, times all-items Dec over all-items a year ago.
  const x = 100 * (0.6 * (120 - 110) / 100 * (100 / 106) + 0.5 * (126 - 120) / 120 * (108 / 106));
  const y = 100 * (0.4 * (90 - 100) / 100 * (100 / 106) + 0.5 * (99 - 90) / 90 * (108 / 106));
  close(x, 8.2075, 5e-5);
  close(y, 1.3208, 5e-5);
  close(r.categories[0].points, x, 1e-12);
  close(r.categories[1].points, y, 1e-12);
  close(r.sum, r.total, 1e-12);
  close(r.residual, 0, 1e-12);
  close(r.categories[1].change, -1, 1e-12); // yoghurt ended 1% cheaper and still added 1.32 points
  assert.equal(r.months, 12);
  assert.equal(r.endYear, 2021);
  close(r.categories[0].weight, 0.5);
});

test("a period inside one year is one step, and a long one is cut at every December", () => {
  const { data, c } = toy();
  const half = decompose(data, c, 0, 6);
  close(half.categories[0].points, 6, 1e-12); // 0.6 × 10%
  close(half.categories[1].points, 0, 1e-12);
  close(half.total, 6, 1e-12);
  const two = decompose(data, c, 0, 24); // December 2019 to December 2021
  close(two.total, 18.8, 1e-12);
  close(two.categories[0].points, 100 * (0.6 * 0.2 + 0.5 * (132 - 120) / 120 * 1.08), 1e-12); // 12 + 5.4
  close(two.categories[1].points, 100 * (0.4 * -0.1 + 0.5 * (99 - 90) / 90 * 1.08), 1e-12); // -4 + 5.4
  close(two.sum, 18.8, 1e-12);
  close(two.average, 100 * (Math.sqrt(1.188) - 1), 1e-12);
  assert.equal(decompose(data, c, 0, 6).average, null);
  assert.equal(decompose(data, c, 6, 18).average, null);
});

test("two links a year, as in the UK: December to January, then January onwards", () => {
  // 2021 weights 500 and 500. X: Dec 2020 120, Jan 2021 126, Jun 2021 138.6. Y: 90, 90, 108.
  // All items: Dec 108; Jan 108 × (0.5 × 1.05 + 0.5 × 1) = 110.7; Jun 110.7 × (0.5 × 1.1 + 0.5 × 1.2) = 127.305.
  const { data, c } = toy([12, 1]);
  c.index[0][13] = 110.7; c.index[1][13] = 126; c.index[2][13] = 90;
  c.index[0][18] = 127.305; c.index[1][18] = 138.6; c.index[2][18] = 108;
  const r = decompose(data, c, 12, 18);
  close(r.total, 17.875, 1e-10);
  close(r.categories[0].points, 100 * (0.5 * 6 / 120 + 0.5 * (138.6 - 126) / 126 * (110.7 / 108)), 1e-10); // 2.5 + 5.125
  close(r.categories[0].points, 7.625, 1e-10);
  close(r.categories[1].points, 10.25, 1e-10);
  close(r.sum, r.total, 1e-10);
});

test("bad periods and missing figures are refused with a reason", () => {
  const { data, c } = toy();
  assert.match(decompose(data, c, 6, 6).error, /after the start/);
  assert.match(decompose(data, c, 18, 6).error, /after the start/);
  assert.match(decompose(data, c, -1, 6).error, /December 2019 to December 2021/);
  assert.match(decompose(data, c, 0, 25).error, /inside that range/);
  assert.match(decompose(data, c, 0.5, 6).error, /start month and an end month/);
  assert.match(decompose(data, c, "0", 6).error, /start month and an end month/);
  assert.match(decompose(data, c, NaN, 6).error, /start month and an end month/);
  // A month with no category index.
  assert.match(decompose(data, c, 0, 3).error, /No index was published for "Xylophones" in March 2020/);
  // A category with no weight is left alone, even where its index is missing.
  c.weights[0] = [1000, 0];
  c.index[2][6] = null;
  const r = decompose(data, c, 0, 6);
  assert.equal(r.categories[1].points, 0);
  assert.equal(r.categories[1].change, null);
  assert.match(categoryReading(r.categories[1], r), /No price index was published/);
  // No link month before the period: nothing to chain from.
  const late = toy([6]);
  assert.match(decompose(late.data, late.c, 0, 6).error, /too late to work out a change/);
  // No weights for the year.
  const gap = toy();
  gap.c.weights[1] = [null, null];
  assert.match(decompose(gap.data, gap.c, 12, 18).error, /No basket weights were published for Toyland in 2021/);
});

/* ---------- the real data ---------- */
test("the data module holds the sources' own figures", () => {
  const ea = country("EA"), de = country("DE"), uk = country("UK"), fr = country("FR"), it = country("IT");
  const cats = categoriesOf(PRICES, ea).map((c) => c.code);
  assert.equal(cats.length, 13);
  assert.equal(categoriesOf(PRICES, uk).length, 12);
  // Eurostat prc_hicp_minr, index 2025 = 100 and annual rate, read from the download of 11 October 2026.
  assert.equal(ea.index[0][at(2022, 10)], 94.0);
  assert.equal(ea.index[0][at(2021, 10)], 84.98);
  assert.equal(ea.rate[at(2022, 10)], 10.6);
  assert.equal(ea.rate[at(2020, 12)], -0.3);
  assert.equal(de.index[1 + cats.indexOf("CP04")][at(2022, 10)], 98.73);
  assert.equal(de.rate[at(2022, 10)], 11.6);
  assert.equal(fr.index[1 + cats.indexOf("CP01")][at(2026, 8)], 101.81);
  assert.equal(it.index[1 + cats.indexOf("CP07")][at(2015, 1)], 79.5);
  assert.equal(country("HU").rate[at(2023, 1)], 26.2);
  // Eurostat prc_hicp_iw, parts per 1,000.
  assert.equal(ea.weights[PRICES.weightYears.indexOf(2022)][cats.indexOf("CP04")], 180.75);
  assert.equal(ea.weights[PRICES.weightYears.indexOf(2022)][cats.indexOf("CP01")], 166.16);
  assert.equal(de.weights[PRICES.weightYears.indexOf(2026)][cats.indexOf("CP04")], 165.59);
  // ONS MM23: D7BT (all items, 2015 = 100), D7G7 (annual rate), D7BX and CHZU (division 04).
  assert.equal(uk.index[0][at(2022, 10)], 126.2);
  assert.equal(uk.index[0][at(2021, 10)], 113.6);
  assert.equal(uk.rate[at(2022, 10)], 11.1);
  assert.equal(uk.index[4][at(2022, 10)], 141.6);
  assert.equal(uk.weights[PRICES.weightYears.indexOf(2022)][3], 138);
});

test("every series is complete up to its country's last month, and weights add up to 1,000", () => {
  for (const c of PRICES.countries) {
    const n = categoriesOf(PRICES, c).length;
    assert.equal(c.index.length, n + 1);
    for (const s of c.index) {
      assert.equal(s.length, PRICES.months);
      for (let i = 0; i <= c.last; i++) assert.ok(s[i] > 0, `${c.code} month ${i}`);
    }
    for (let y = 0; y < PRICES.weightYears.length; y++) {
      if (PRICES.weightYears[y] > monthOf(PRICES, c.last).year) continue;
      assert.equal(c.weights[y].length, n);
      close(c.weights[y].reduce((s, v) => s + v, 0), 1000, 0.5);
    }
    for (let i = 13; i <= c.last; i++) assert.equal(typeof c.rate[i], "number");
  }
});

test("euro area contributions match the ones Eurostat publishes (prc_hicp_ctr)", () => {
  const ea = country("EA");
  const published = {
    "2022-10": [2.56, 0.18, 0.2, 4.13, 0.55, 0.08, 1.47, -0.03, 0.38, 0.04, 0.68, 0.07, 0.31],
    "2020-12": [0.13, 0.12, -0.13, -0.1, 0.01, 0.04, -0.45, -0.08, 0.02, 0.0, 0.09, 0.03, 0.07],
    "2026-08": [0.12, 0.1, 0.02, 0.63, 0.04, 0.21, 1.19, 0.07, 0.12, 0.04, 0.43, 0.08, 0.2],
  };
  for (const [month, figures] of Object.entries(published)) {
    const [y, m] = month.split("-").map(Number);
    const r = decompose(PRICES, ea, at(y, m) - 12, at(y, m));
    r.categories.forEach((c, k) => close(c.points, figures[k], 0.0101));
  }
});

test("UK contributions match the ones the ONS publishes, to within rounding of a one-decimal index", () => {
  const uk = country("UK");
  const published = {
    "2022-10": [1.84, 0.29, 0.55, 3.7, 0.76, 0.09, 1.24, 0.08, 0.79, 0.11, 1.12, 0.48],
    "2026-08": [0.14, 0.1, 0.02, 0.63, 0.04, 0.1, 0.69, 0.13, 0.24, 0.16, 0.57, 0.27],
  };
  for (const [month, figures] of Object.entries(published)) {
    const [y, m] = month.split("-").map(Number);
    const r = decompose(PRICES, uk, at(y, m) - 12, at(y, m));
    r.categories.forEach((c, k) => close(c.points, figures[k], 0.035));
  }
});

test("contributions add up to the annual rate for every country and month, within rounding", () => {
  const worst = {};
  for (const c of PRICES.countries) {
    const limit = c.decimals >= 2 ? 0.03 : 0.16;
    let w = 0;
    for (let i = 13; i <= c.last; i++) {
      const r = decompose(PRICES, c, i - 12, i);
      assert.equal(r.error, undefined);
      close(r.total, 100 * (c.index[0][i] / c.index[0][i - 12] - 1), 1e-9);
      close(r.sum + r.residual, r.total, 1e-12);
      assert.ok(Math.abs(r.residual) <= limit, `${c.code} ${monthLabel(PRICES, i)}: ${r.residual}`);
      if (i <= END) w = Math.max(w, Math.abs(r.residual));
    }
    worst[c.code] = w;
  }
  // Where they do not add up exactly, and why: one-decimal indices (Italy and the UK) leave up to 0.12 points over.
  assert.ok(worst.IT > 0.05 && worst.IT < 0.13);
  assert.ok(worst.UK > 0.05 && worst.UK < 0.12);
  for (const [code, w] of Object.entries(worst)) if (code !== "IT" && code !== "UK") assert.ok(w < 0.02, `${code} ${w}`);
  assert.equal(country("IT").decimals, 1);
  assert.equal(country("UK").decimals, 1);
  assert.equal(PRICES.countries.filter((c) => c.decimals === 2).length, 19);
});

test("every other period adds up too: all 11,628 of them for every country, December 2013 to August 2026", () => {
  const worst = {};
  let periods = 0;
  for (const c of PRICES.countries) {
    let w = 0;
    for (let a = 0; a < END; a++) for (let b = a + 1; b <= END; b++) {
      const r = decompose(PRICES, c, a, b);
      w = Math.max(w, Math.abs(r.residual));
      if (c.code === "EA") periods++;
    }
    worst[c.code] = w;
  }
  assert.equal(periods, 11628);
  // Rounding adds up over a long period, most of all where indices have one decimal place.
  assert.equal(worst.IT.toFixed(2), "0.16");
  assert.equal(worst.UK.toFixed(2), "0.35");
  for (const [code, w] of Object.entries(worst)) if (code !== "IT" && code !== "UK") assert.ok(w < 0.03, `${code} ${w}`);
  for (const c of PRICES.countries) {
    const r = decompose(PRICES, c, 0, c.last);
    assert.ok(Math.abs(r.residual) <= (c.decimals >= 2 ? 0.05 : 0.6), `${c.code}: ${r.residual}`);
    assert.ok(r.average > 0 && r.average < 6);
  }
});

test("the official rate is the rounded index change for Eurostat's countries, and not always for the UK", () => {
  assert.equal(oneDecimal(1.25), 1.3);
  assert.equal(oneDecimal(1.2499999999999956), 1.3); // 81 / 80 - 1 in floating point
  assert.equal(oneDecimal(-0.25), -0.3);
  assert.equal(oneDecimal(0.04), 0);
  assert.equal(oneDecimal(10.614), 10.6);
  let ukDiffer = 0;
  for (const c of PRICES.countries) {
    for (let i = 13; i <= c.last; i++) {
      const same = Math.abs(oneDecimal(100 * (c.index[0][i] / c.index[0][i - 12] - 1)) - c.rate[i]) < 1e-9;
      if (c.source === "eurostat") assert.ok(same, `${c.code} ${monthLabel(PRICES, i)}`);
      else if (!same && i <= END) ukDiffer++;
    }
  }
  assert.equal(ukDiffer, 43);
  assert.equal(END - 12, 140); // the 140 months from January 2015 to August 2026
  // Sweden, February 2020: 81.0 against 80.0 is 1.25%, published as 1.3%.
  const se = country("SE"), i = at(2020, 2);
  assert.equal(se.rate[i], 1.3);
  assert.equal(reconciliation(PRICES, se, decompose(PRICES, se, i - 12, i)).length, 1);
  // UK, January 2017: 101.4 against 99.5 is 1.9%, published as 1.8%.
  const uk = country("UK"), j = at(2017, 1);
  const lines = reconciliation(PRICES, uk, decompose(PRICES, uk, j - 12, j));
  assert.match(lines[lines.length - 1], /^The official rate is 1\.8%, not 1\.9%/);
});

test("One finding: the euro area's peak, the 12 months to October 2022", () => {
  const ea = country("EA");
  const peak = peakMonth(PRICES, ea);
  assert.equal(monthLabel(PRICES, peak), "October 2022");
  const r = decompose(PRICES, ea, peak - 12, peak);
  assert.equal(r.official, 10.6);
  const sorted = [...r.categories].sort((a, b) => b.points - a.points);
  assert.deepEqual(sorted.slice(0, 2).map((c) => c.code), ["CP04", "CP01"]);
  assert.equal(sorted[0].points.toFixed(2), "4.13");
  assert.equal(sorted[1].points.toFixed(2), "2.56");
  assert.equal((sorted[0].weight * 100).toFixed(1), "18.1");
  assert.equal((sorted[1].weight * 100).toFixed(1), "16.6");
  assert.equal(((sorted[0].weight + sorted[1].weight) * 100).toFixed(1), "34.7");
  assert.equal(r.sum.toFixed(2), "10.62");
  assert.equal((100 * (sorted[0].points + sorted[1].points) / r.sum).toFixed(0), "63");
  assert.equal(sorted[0].change.toFixed(1), "23.0");
  assert.equal(sorted[1].change.toFixed(1), "15.5");
  assert.deepEqual(r.categories.filter((c) => c.points <= -SMALL).map((c) => c.code), ["CP08"]);
  assert.deepEqual(summary(PRICES, ea, r), [
    "In the euro area, prices rose 10.6% over the 12 months to October 2022. That is the official annual rate of inflation.",
    "Housing, water, electricity, gas and other fuels pushed up most, adding 4.13 points, followed by food and non-alcoholic beverages (2.56) and transport (1.47).",
    "Only information and communication pulled prices down, taking 0.03 points off.",
  ]);
  assert.equal(categoryReading(sorted[0], r), "Prices rose 23.0%. At 18.1% of the 2022 basket, that added 4.13 points.");
  assert.equal(categoryReading(r.categories[7], r), "Prices fell 0.7%. At 4.5% of the 2022 basket, that took 0.03 points off.");
});

test("history and the peak month", () => {
  const ea = country("EA");
  const h = history(PRICES, ea);
  assert.equal(h[0].i, 12);
  assert.equal(h.length, ea.last - 11);
  assert.equal(h.at(-1).i, ea.last);
  assert.equal(h.at(-1).rate, ea.rate[ea.last]);
  assert.equal(h.at(-1).points.length, 13);
  assert.equal(monthLabel(PRICES, peakMonth(PRICES, country("HU"))), "January 2023");
  assert.equal(country("HU").rate[peakMonth(PRICES, country("HU"))], 26.2);
  assert.equal(monthLabel(PRICES, peakMonth(PRICES, country("UK"))), "October 2022");
  // The peak is looked for in a fixed window, January 2021 to December 2023, so later months cannot move it.
  for (const c of PRICES.countries) {
    const m = monthOf(PRICES, peakMonth(PRICES, c));
    assert.ok(m.year >= 2021 && m.year <= 2023, c.code);
  }
  assert.equal(monthLabel(PRICES, peakMonth(PRICES, ea, [2015, 1], [2019, 12])), "October 2018");
  // A tie goes to the earlier month, and a window with no rates has no peak.
  const { data, c } = toy();
  c.rate[12] = 5; c.rate[18] = 5; c.rate[24] = 1;
  assert.equal(peakMonth(data, c, [2020, 1], [2021, 12]), 12);
  assert.equal(peakMonth(data, c, [2021, 1], [2021, 12]), 18);
  assert.equal(peakMonth(data, c, [2030, 1], [2031, 12]), -1);
  assert.equal(peakMonth(data, { ...c, rate: new Array(26).fill(null) }, [2020, 1], [2021, 12]), -1);
});

/* ---------- every kind of sentence ---------- */
const reading = (change, points, weight = 0.1) => categoryReading({ change, points, weight }, { endYear: 2021 });

test("a category's sentence in each case", () => {
  assert.equal(reading(5.04, 0.5), "Prices rose 5.0%. At 10.0% of the 2021 basket, that added 0.50 points.");
  assert.equal(reading(-5.04, -0.5), "Prices fell 5.0%. At 10.0% of the 2021 basket, that took 0.50 points off.");
  assert.equal(reading(1, 1), "Prices rose 1.0%. At 10.0% of the 2021 basket, that added 1.00 points.");
  // Too small to show.
  assert.equal(reading(0.3, 0.004, 0.012), "Prices rose 0.3%, but at 1.2% of the 2021 basket that moved the total by less than 0.01 points.");
  assert.equal(reading(-0.3, -0.004, 0.012), "Prices fell 0.3%, but at 1.2% of the 2021 basket that moved the total by less than 0.01 points.");
  assert.equal(reading(0, 0), "Prices changed by less than 0.05%, so this category did not move the total.");
  assert.equal(reading(0.04, -0.001), "Prices changed by less than 0.05%, so this category did not move the total.");
  // A price change that prints as 0.0% with a contribution that does not.
  assert.equal(reading(-0.04, -0.006, 0.152), "Prices fell by less than 0.05%. At 15.2% of the 2021 basket, that took 0.01 points off.");
  assert.equal(reading(0.04, 0.006, 0.152), "Prices rose by less than 0.05%. At 15.2% of the 2021 basket, that added 0.01 points.");
  // Price and contribution pointing opposite ways.
  assert.equal(reading(-1, 1.32, 0.5), "Prices ended 1.0% lower, yet the category added 1.32 points. The basket is re-weighted every year, and its rises came when it counted for more.");
  assert.equal(reading(0.4, -0.02), "Prices ended 0.4% higher, yet the category took 0.02 points off. The basket is re-weighted every year, and its falls came when it counted for more.");
  assert.equal(reading(0.01, -0.02), "Prices ended within 0.05% of where they began, yet the category took 0.02 points off. The basket is re-weighted every year, and its falls came when it counted for more.");
  assert.equal(reading(0, 0.02), "Prices ended within 0.05% of where they began, yet the category added 0.02 points. The basket is re-weighted every year, and its rises came when it counted for more.");
  assert.equal(reading(null, 0), "No price index was published for this category in one of the two months.");
  // The hand-worked case produces the opposite-ways sentence from real arithmetic.
  const { data, c } = toy();
  const r = decompose(data, c, 6, 18);
  assert.equal(categoryReading(r.categories[1], r), "Prices ended 1.0% lower, yet the category added 1.32 points. The basket is re-weighted every year, and its rises came when it counted for more.");
});

test("no sentence the real data can produce contains a broken number", () => {
  let count = 0;
  for (const c of PRICES.countries) {
    for (let i = 13; i <= c.last; i += 1) {
      const r = decompose(PRICES, c, i - 12, i);
      const text = [...summary(PRICES, c, r), ...reconciliation(PRICES, c, r), ...r.categories.map((k) => categoryReading(k, r))].join(" ");
      assert.doesNotMatch(text, /NaN|undefined|Infinity|null|–|(added|took|adding|taking) 0\.00 points|-0\.0%|[^0-9]0\.0% (over|between)/, `${c.code} ${i}: ${text}`);
      count++;
    }
    for (const [a, b] of [[0, c.last], [c.last - 1, c.last], [0, 1], [3, 10], [40, 100]]) {
      const r = decompose(PRICES, c, a, b);
      const text = [...summary(PRICES, c, r), ...reconciliation(PRICES, c, r), ...r.categories.map((k) => categoryReading(k, r))].join(" ");
      assert.doesNotMatch(text, /NaN|undefined|Infinity|null|–|(added|took|adding|taking) 0\.00 points|-0\.0%/, `${c.code} ${a} ${b}: ${text}`);
      count++;
    }
  }
  assert.ok(count > 3000);
});

test("the summary in its small and odd cases", () => {
  const { data, c } = toy();
  const base = (official, total, cats, months = 12, average = null) => ({ a: 6, b: 18, months, endYear: 2021, official, total, average, sum: total, residual: 0, categories: cats.map(([name, points]) => ({ name, points, change: points, weight: 0.5 })) });
  // Nothing fell.
  assert.deepEqual(summary(data, c, base(3, 3.04, [["Xylophones", 2], ["Yoghurt", 1]])), [
    "In Toyland, prices rose 3.0% over the 12 months to June 2021. That is the official annual rate of inflation.",
    "Xylophones pushed up most, adding 2.00 points, followed by yoghurt (1.00).",
    "No category pulled prices down.",
  ]);
  // One up, one down, total falling.
  assert.deepEqual(summary(data, c, base(-1, -1, [["Xylophones", 1], ["Yoghurt", -2]])), [
    "In Toyland, prices fell 1.0% over the 12 months to June 2021. That is the official annual rate of inflation.",
    "Xylophones was the only category to push prices up, adding 1.00 points.",
    "Only yoghurt pulled prices down, taking 2.00 points off.",
  ]);
  // Everything fell.
  assert.deepEqual(summary(data, c, base(-3, -3, [["Xylophones", -1], ["Yoghurt", -2]])).slice(1), [
    "No category pushed prices up.",
    "Every category pulled prices down, led by yoghurt, which took 2.00 points off.",
  ]);
  // Some fell, not all.
  assert.equal(summary(data, c, base(1, 1, [["Xylophones", 3], ["Yoghurt", -1], ["Zips", -1.5]]))[2], "Two categories pulled prices down, led by zips, which took 1.50 points off.");
  // A flat year, officially.
  assert.equal(summary(data, c, base(0, 0.04, [["Xylophones", 1], ["Yoghurt", -1]]))[0], "In Toyland, prices were unchanged over the 12 months to June 2021: the official annual rate of inflation was 0.0%.");
  // A flat period that is not a year, and nothing moving at all.
  assert.deepEqual(summary(data, c, base(null, 0.01, [["Xylophones", 0.001], ["Yoghurt", -0.001]], 7)), [
    "In Toyland, prices ended June 2021 within 0.05% of where they stood in June 2020.",
    "No category pushed prices up.",
    "No category pulled prices down.",
  ]);
  // Other lengths: one month, and several years with a yearly average.
  assert.equal(summary(data, c, { ...base(null, 0.5, [["Xylophones", 0.5], ["Yoghurt", 0]], 1), a: 17 })[0], "In Toyland, prices rose 0.5% between May 2021 and June 2021.");
  assert.equal(summary(data, c, { ...base(null, 18.8, [["Xylophones", 17.4], ["Yoghurt", 1.4]], 24, 8.995), a: 0, b: 24 })[0], "In Toyland, prices rose 18.8% between December 2019 and December 2021, which is +9.0% a year on average.");
  assert.equal(summary(data, c, { ...base(null, -4, [["Xylophones", -4], ["Yoghurt", 0]], 24, -2.02), a: 0, b: 24 })[0], "In Toyland, prices fell 4.0% between December 2019 and December 2021, which is -2.0% a year on average.");
  assert.equal(periodPhrase(data, { a: 6, b: 18, months: 12 }), "over the 12 months to June 2021");
  assert.equal(periodPhrase(data, { a: 6, b: 19, months: 13 }), "between June 2020 and July 2021");
});

test("the reconciliation says where the figures do not add up and why", () => {
  const { data, c } = toy();
  const r = decompose(data, c, 6, 18);
  assert.deepEqual(reconciliation(data, c, r), ["The 2 categories add up to +9.53 points, which is the change in the published all-items index."]);
  assert.deepEqual(reconciliation(data, c, { ...r, sum: 9.5, residual: 0.0283 }), ["The 2 categories add up to +9.50 points and the published all-items index changed by +9.53%. The 0.03 left over is rounding in the published indices, which have two decimal places."]);
  assert.deepEqual(reconciliation(data, { ...c, decimals: 1 }, { ...r, sum: 9.6, residual: -0.0717, official: 9.4 }), [
    "The 2 categories add up to +9.60 points and the published all-items index changed by +9.53%. The 0.07 left over is rounding in the published indices, which have one decimal place.",
    "The official rate is 9.4%, not 9.5%, because it is worked out from indices with more decimal places than are published.",
  ]);
});

/* ---------- added by the independent review ---------- */
const pos = (y, m) => (y - 2013) * 12 + (m - 12); // position of a month, counted from December 2013

test("values read again from Eurostat on 12 October 2026, by a different route (SDMX-CSV)", () => {
  assert.equal(pos(2013, 12), 0);
  assert.equal(pos(2022, 10), at(2022, 10));
  const cats = categoriesOf(PRICES, country("EA")).map((c) => c.code);
  const series = (code, cat) => country(code).index[1 + cats.indexOf(cat)];
  assert.equal(series("AT", "CP01")[pos(2013, 12)], 69.29);
  assert.equal(series("AT", "CP01")[pos(2014, 1)], 69.71);
  assert.equal(series("NL", "CP04")[pos(2022, 9)], 125.52);
  assert.equal(series("NL", "CP04")[pos(2023, 9)], 93.51);
  assert.equal(country("NL").rate[pos(2023, 9)], -0.3);
  assert.equal(country("FR").index[0][pos(2015, 12)], 80.44);
  assert.equal(series("EA", "CP11")[pos(2020, 12)], 78.02);
  assert.equal(country("AT").weights[PRICES.weightYears.indexOf(2014)][cats.indexOf("CP01")], 114.42);
  assert.equal(country("NL").weights[PRICES.weightYears.indexOf(2023)][cats.indexOf("CP04")], 169.1);
  // Eurostat's own contributions (prc_hicp_ctr) for three more cells: food in January 2015, housing in July 2023,
  // transport in August 2026.
  const ea = country("EA");
  const mine = (y, m, cat) => decompose(PRICES, ea, pos(y, m) - 12, pos(y, m)).categories[cats.indexOf(cat)].points;
  close(mine(2015, 1, "CP01"), -0.09, 0.0101);
  close(mine(2023, 7, "CP04"), 0.30, 0.0101);
  close(mine(2026, 8, "CP07"), 1.19, 0.0101);
});

test("contributions over any period are those of Schwind and Weinand (2026), formulas (5) to (7)", () => {
  // Written here from the paper, not from logic.js: a base-year term with the weight price-updated to the start
  // month, a mid-year term for each whole year in between, and a this-year term. Year y is priced from its
  // period 0, the December before it; a start month that is a December is period 0 of the following year.
  const paper = (c, k, A, B) => {
    const P = c.index[0], p = c.index[k + 1];
    const w = (y) => { const row = c.weights[PRICES.weightYears.indexOf(y)]; return row[k] / row.reduce((s, v) => s + v, 0); };
    const zero = (y) => pos(y - 1, 12);
    const a = pos(...A), e = pos(...B), b = A[1] === 12 ? A[0] + 1 : A[0], y = B[0];
    const updated = w(b) * (p[a] / p[zero(b)]) / (P[a] / P[zero(b)]); // formula (7)
    if (y === b) return 100 * updated * (p[e] / p[a] - 1); // (6d)
    let out = updated * (p[zero(b + 1)] / p[a] - 1); // (6a)
    for (let j = 1; j < y - b; j++) out += w(b + j) * (P[zero(b + j)] / P[a]) * (p[zero(b + j + 1)] / p[zero(b + j)] - 1); // (6b)
    return 100 * (out + w(y) * (P[zero(y)] / P[a]) * (p[e] / p[zero(y)] - 1)); // (6c)
  };
  for (const [code, A, B] of [["EA", [2021, 12], [2023, 12]], ["EA", [2013, 12], [2026, 8]], ["DE", [2019, 3], [2024, 9]], ["HU", [2022, 1], [2023, 1]], ["NL", [2020, 5], [2020, 11]], ["IT", [2022, 12], [2023, 1]], ["FR", [2016, 7], [2018, 2]]]) {
    const c = country(code);
    const r = decompose(PRICES, c, pos(...A), pos(...B));
    r.categories.forEach((cat, k) => close(cat.points, paper(c, k, A, B), 1e-9));
  }
  // The euro area from December 2021 to December 2023, as the page prints it.
  const two = decompose(PRICES, country("EA"), pos(2021, 12), pos(2023, 12));
  assert.deepEqual([...two.categories].sort((x, y) => y.points - x.points).map((c) => c.points.toFixed(2)), ["3.73", "2.47", "1.44", "1.30", "0.78", "0.77", "0.59", "0.48", "0.32", "0.32", "0.20", "0.08", "-0.07"]);
});

test("the three figures of the reconciliation agree with one another as printed", () => {
  // The euro area, December 2021 to December 2023: the categories give 12.396 and the index 12.401. Both print
  // as 12.40, so nothing is said to be left over.
  const ea = country("EA");
  const r = decompose(PRICES, ea, pos(2021, 12), pos(2023, 12));
  assert.equal(r.sum.toFixed(3), "12.396");
  assert.equal(r.total.toFixed(3), "12.401");
  assert.deepEqual(reconciliation(PRICES, ea, r), ["The 13 categories add up to +12.40 points, which is the change in the published all-items index."]);
  // In every sentence the real data can produce, total minus sum is the figure given as left over.
  let checked = 0;
  for (const c of PRICES.countries) {
    for (let i = 13; i <= c.last; i++) {
      for (const d of [decompose(PRICES, c, i - 12, i), decompose(PRICES, c, i - 1, i), decompose(PRICES, c, 0, i)]) {
        const line = reconciliation(PRICES, c, d)[0];
        const m = line.match(/add up to ([+-]?[0-9.]+) points and the published all-items index changed by ([+-]?[0-9.]+)%[.] The ([0-9.]+) left over/);
        if (m) { close(Math.abs(Number(m[2]) - Number(m[1])), Number(m[3]), 1e-9); assert.notEqual(m[1], m[2]); assert.notEqual(m[3], "0.00"); checked++; }
        else assert.match(line, /which is the change in the published all-items index[.]$/);
      }
    }
  }
  assert.ok(checked > 1000);
});

test("figures that Eurostat marks as estimated or of low reliability are reported with a result", () => {
  assert.deepEqual(PRICES.flagLabels, { e: "estimated", u: "low reliability" });
  const fr = country("FR"), es = country("ES"), ea = country("EA"), de = country("DE");
  // France: the all-items index and its first 12 divisions, December 2013 to December 2015.
  assert.equal(fr.flags.length, 13);
  assert.ok(fr.flags.every(([k, f, from, to]) => k <= 12 && f === "e" && from === 0 && to === pos(2015, 12)));
  // Spain: five divisions, December 2013 to December 2016.
  assert.deepEqual(es.flags.map(([k]) => categoriesOf(PRICES, es)[k - 1].code), ["CP07", "CP08", "CP09", "CP12", "CP13"]);
  assert.ok(es.flags.every(([, f, from, to]) => f === "e" && from === 0 && to === pos(2016, 12)));
  // Low reliability: April and May 2020 and November 2020 to May 2021 only, in five of the 21 economies.
  const low = PRICES.countries.filter((c) => c.flags.some(([, f]) => f === "u"));
  assert.deepEqual(low.map((c) => c.code).sort(), ["DE", "DK", "EA", "EU27_2020", "NL"]);
  for (const c of low) for (const [, f, from, to] of c.flags) assert.ok(f === "u" && ((from >= pos(2020, 4) && to <= pos(2020, 5)) || (from >= pos(2020, 11) && to <= pos(2021, 5))), c.code);
  assert.deepEqual(PRICES.countries.filter((c) => c.flags.some(([, f]) => f === "e")).map((c) => c.code).sort(), ["ES", "FR"]);
  // Restaurants in December 2020, a link month, in the euro area.
  assert.ok(ea.flags.some(([k, , from, to]) => k === 11 && from <= pos(2020, 12) && to >= pos(2020, 12)));
  assert.deepEqual(country("UK").flags, []);
  assert.deepEqual(country("IT").flags, []);
  // A period that reads none of the marked months says nothing.
  assert.deepEqual(decompose(PRICES, ea, pos(2022, 10), pos(2023, 10)).flagged, {});
  // The 12 months to October 2022 do read one: October to December 2021 is priced from December 2020.
  assert.deepEqual(decompose(PRICES, ea, pos(2021, 10), pos(2022, 10)).flagged, { u: ["restaurants and accommodation"] });
  assert.deepEqual(flagNotes(PRICES, {}, 14), []);
  // The 12 months to June 2021 are priced from December 2020, when the restaurants index is marked.
  const r = decompose(PRICES, ea, pos(2020, 6), pos(2021, 6));
  assert.deepEqual(r.flagged, { u: ["restaurants and accommodation"] });
  assert.deepEqual(flagNotes(PRICES, r.flagged, 14), ["Eurostat marks the index for restaurants and accommodation in one or more of the months used here as of low reliability."]);
  // The 12 months to April 2021 end in a month with nothing marked but start in April 2020, when four series are.
  assert.deepEqual(flagNotes(PRICES, decompose(PRICES, de, pos(2020, 4), pos(2021, 4)).flagged, 14), ["Eurostat marks 4 of the 14 indices in one or more of the months used here as of low reliability."]);
  // France in 2015: 13 of its 14 series.
  assert.deepEqual(flagNotes(PRICES, decompose(PRICES, fr, pos(2014, 6), pos(2015, 6)).flagged, 14), ["Eurostat marks 13 of the 14 indices in one or more of the months used here as estimated."]);
  // A period in 2016 still rests on December 2015, and one in 2017 no longer does.
  assert.equal(decompose(PRICES, fr, pos(2016, 2), pos(2016, 8)).flagged.e.length, 13);
  assert.deepEqual(decompose(PRICES, fr, pos(2017, 2), pos(2017, 8)).flagged, {});
  // Two and three names are written out; a flag the page does not know is quoted in the source's words.
  assert.deepEqual(flagNotes(PRICES, { e: ["health", "transport"] }, 14), ["Eurostat marks the indices for health and transport in one or more of the months used here as estimated."]);
  assert.deepEqual(flagNotes({ flagLabels: { p: "provisional" } }, { p: ["all items", "health", "transport"] }, 14), ['Eurostat marks the indices for all items, health and transport in one or more of the months used here as "provisional".']);
  assert.deepEqual(flaggedSeries(PRICES, country("UK"), new Set([0, 12, 24])), {});
});
