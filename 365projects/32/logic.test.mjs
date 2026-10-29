import test from "node:test";
import assert from "node:assert/strict";
import { PRICES } from "../data/prices.js";
import { MAX_AMOUNT, REASON_MIN, SHARE_MIN, METHOD_WARN, HOUSEHOLDS, monthOf, monthLabel, categoriesOf, formCategories, oneDecimal, firstMonth, readAmount, toScheme, officialSpend, officialPoints, personal, benchmarkRate, series, peakMonth, mainReason, reading, categoryReading, methodWarning, flaggedSeries, flagNotes } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const country = (code) => PRICES.countries.find((c) => c.code === code);
const at = (year, month) => { for (let i = 0; i < PRICES.months; i++) { const m = monthOf(PRICES, i); if (m.year === year && m.month === month) return i; } throw new Error("no such month"); };
const household = (id) => HOUSEHOLDS.find((h) => h.id === id).spend;
// Tests that pin a count or a largest value stop at this month, so they stay true when newer months are added.
const END = at(2026, 8);

/* ---------- a three-category world worked out by hand ---------- */
// Months from December 2019; December links. Categories A, B, C with weights 500, 300, 200 in 2020 and 2021.
// A: Dec 2019 100, Jun 2020 100, Dec 2020 110, Jun 2021 121.   B: 100, 100, 100, 95.   C: 100, 100, 100, 100.
// All items: Dec 2019 100; Jun 2020 100; Dec 2020 100 × (0.5 × 1.1 + 0.3 + 0.2) = 105;
// Jun 2021 105 × (0.5 × 1.1 + 0.3 × 0.95 + 0.2) = 105 × 1.035 = 108.675.
function toy() {
  const months = 19, blank = () => new Array(months).fill(null);
  const all = blank(), a = blank(), b = blank(), c = blank(), rate = blank();
  const put = (i, v, x, y, z) => { all[i] = v; a[i] = x; b[i] = y; c[i] = z; };
  put(0, 100, 100, 100, 100); put(6, 100, 100, 100, 100); put(12, 105, 110, 100, 100); put(18, 108.675, 121, 95, 100);
  rate[18] = 8.7; rate[12] = 5.0;
  const cats = ["Apples", "Bread", "Coal"].map((name, k) => ({ code: `CP0${k + 1}`, name, short: name }));
  const data = { first: "2019-12", months, weightYears: [2020, 2021], schemes: { ecoicop2: { categories: cats }, three: { categories: cats } } };
  const land = { code: "ZZ", name: "Toyland", source: "eurostat", scheme: "three", links: [12], decimals: 2, last: 18, rate, index: [all, a, b, c], weights: [[500, 300, 200], [500, 300, 200]] };
  return { data, land };
}

test("a household's rate is its budget shares times each category's price change", () => {
  const { data, land } = toy();
  // June 2020 to June 2021: apples +21%, bread -5%, coal flat. Budget 60 / 30 / 10.
  const r = personal(data, land, [60, 30, 10], 18);
  close(r.rate, 0.6 * 21 + 0.3 * -5 + 0.1 * 0, 1e-12); // 11.1
  assert.equal(r.shown, 11.1);
  assert.equal(r.official, 8.7);
  assert.equal(r.gap, 2.4);
  close(r.categories[0].points, 12.6, 1e-12);
  close(r.categories[1].points, -1.5, 1e-12);
  assert.equal(r.categories[2].points, 0);
  close(r.categories[0].share, 0.6);
  close(r.categories[0].change, 21, 1e-12);
  close(r.categories[0].officialShare, 0.5);
  assert.equal(r.total, 100);
  assert.equal(r.before, 100);
  close(r.after, 111.1, 1e-12);
  assert.equal(r.year, 2021);
  // Only the shares matter: the same budget in another currency gives the same rate.
  close(personal(data, land, [6000, 3000, 1000], 18).rate, r.rate, 1e-12);
  // One category only: its own price change.
  close(personal(data, land, [0, 50, 0], 18).rate, -5, 1e-12);
});

test("the official split, by hand, and the gap category by category", () => {
  const { data, land } = toy();
  // Last-year part: w × (Dec - Jun) / Dec the year before, over all items a year ago (100).
  // This-year part: w × (Jun - Dec) / Dec × all-items Dec (105) over all items a year ago (100).
  const pts = officialPoints(data, land, 18);
  close(pts[0], 100 * (0.5 * (110 - 100) / 100 + 0.5 * (121 - 110) / 110 * 1.05), 1e-12); // 5 + 5.25
  close(pts[1], 100 * (0.3 * (95 - 100) / 100 * 1.05), 1e-12); // -1.575
  close(pts[2], 0, 1e-12);
  close(pts[0] + pts[1] + pts[2], 8.675, 1e-12); // the all-items change, 108.675 against 100
  const r = personal(data, land, [60, 30, 10], 18);
  const diff = r.categories.reduce((s, c) => s + (c.points - c.officialPoints), 0);
  close(diff, r.rate - 8.675, 1e-12);
  // The official basket priced as one fixed basket: 0.5 × 21 + 0.3 × -5 + 0.2 × 0 = 9.0, not the official 8.675.
  close(r.benchmark, 9, 1e-12);
  close(benchmarkRate(data, land, 18), 9, 1e-12);
  assert.equal(r.benchmarkShown, 9);
  assert.equal(r.method, 0.3); // 9.0 against the published 8.7
  assert.equal(r.spending, 2.1); // 11.1 against 9.0
  assert.equal(r.gap, oneDecimal(r.spending + r.method));
  // The reason is found like for like: (share here - official share) × price change, which adds up to 11.1 - 9.0.
  const terms = r.categories.map((c) => (c.share - c.officialShare) * c.change);
  close(terms.reduce((s, v) => s + v, 0), r.rate - r.benchmark, 1e-12);
  const why = mainReason(r);
  assert.equal(why.name, "Apples");
  close(why.difference, (0.6 - 0.5) * 21, 1e-12);
});

test("zero, missing and invalid input", () => {
  const { data, land } = toy();
  assert.match(personal(data, land, [0, 0, 0], 18).error, /at least one category/);
  assert.match(personal(data, land, [1, 2], 18).error, /zero or more/);
  assert.match(personal(data, land, [1, -2, 3], 18).error, /zero or more/);
  assert.match(personal(data, land, [1, NaN, 3], 18).error, /zero or more/);
  assert.match(personal(data, land, [1, Infinity, 3], 18).error, /zero or more/);
  assert.match(personal(data, land, "123", 18).error, /zero or more/);
  assert.match(personal(data, land, [1, 2, 3], 11).error, /December 2020 to June 2021/);
  assert.match(personal(data, land, [1, 2, 3], 19).error, /inside that range/);
  assert.match(personal(data, land, [1, 2, 3], 18.5).error, /inside that range/);
  // A category with no index: fine if the household does not buy it, refused if it does.
  land.index[3][18] = null;
  const r = personal(data, land, [60, 40, 0], 18);
  assert.equal(r.error, undefined);
  assert.equal(r.categories[2].change, null);
  assert.equal(r.categories[2].points, 0);
  assert.match(categoryReading(r.categories[2]), /^Not in this budget, 20\.0% of the official basket\. No price index was published/);
  assert.match(personal(data, land, [60, 30, 10], 18).error, /No price index was published for "Coal" in June 2021/);
  assert.equal(series(data, land, [60, 30, 10]).at(-1).rate, null);
});

test("one box of the form", () => {
  assert.deepEqual(readAmount(""), { value: 0 });
  assert.deepEqual(readAmount("   "), { value: 0 });
  assert.deepEqual(readAmount(null), { value: 0 });
  assert.deepEqual(readAmount("0"), { value: 0 });
  assert.deepEqual(readAmount("250.50"), { value: 250.5 });
  assert.deepEqual(readAmount("1e3"), { value: 1000 });
  assert.deepEqual(readAmount(String(MAX_AMOUNT)), { value: 1e9 });
  assert.match(readAmount("1000000001").error, /too large\. The limit is 1,000,000,000/);
  assert.match(readAmount("1e308").error, /too large/);
  assert.match(readAmount("-5").error, /cannot be negative/);
  assert.match(readAmount("abc").error, /not a number/);
  assert.match(readAmount("1e999").error, /not a number/);
  assert.match(readAmount("Infinity").error, /not a number/);
  assert.match(readAmount("", true).error, /not a number/);
});

/* ---------- the real data ---------- */
test("the form has 13 categories and maps onto the UK's 12", () => {
  assert.equal(formCategories(PRICES).length, 13);
  for (const h of HOUSEHOLDS) {
    assert.equal(h.spend.length, 13);
    assert.ok(h.spend.every((v) => Number.isFinite(v) && v >= 0));
  }
  const spend = household("family");
  assert.deepEqual(toScheme(PRICES, country("DE"), spend), spend);
  const uk = toScheme(PRICES, country("UK"), spend);
  assert.equal(uk.length, 12);
  assert.deepEqual(uk.slice(0, 11), spend.slice(0, 11));
  assert.equal(uk[11], spend[11] + spend[12]);
  assert.equal(uk.reduce((s, v) => s + v, 0), spend.reduce((s, v) => s + v, 0));
  assert.equal(categoriesOf(PRICES, country("UK"))[11].name, "Miscellaneous goods and services");
  // The official basket as form amounts.
  const ea = officialSpend(PRICES, country("EA"), at(2022, 10));
  assert.equal(ea.length, 13);
  assert.ok(Math.abs(ea[3] - 180.75 * 2) <= 0.5); // Eurostat's 2022 weight for housing, 180.75 per 1,000, on a total of 2,000
  const gb = officialSpend(PRICES, country("UK"), at(2022, 10));
  assert.equal(gb.length, 13);
  assert.equal(gb[11], 0);
  assert.equal(gb[3], 276); // the ONS's 2022 weight for housing, 138 per 1,000
});

test("the official split matches Eurostat's and the ONS's published contributions", () => {
  const ea = officialPoints(PRICES, country("EA"), at(2022, 10));
  [2.56, 0.18, 0.2, 4.13, 0.55, 0.08, 1.47, -0.03, 0.38, 0.04, 0.68, 0.07, 0.31].forEach((v, k) => close(ea[k], v, 0.0101));
  const uk = officialPoints(PRICES, country("UK"), at(2022, 10));
  [1.84, 0.29, 0.55, 3.7, 0.76, 0.09, 1.24, 0.08, 0.79, 0.11, 1.12, 0.48].forEach((v, k) => close(uk[k], v, 0.035));
});

test("One finding: two invented households at the euro area's peak, October 2022", () => {
  const ea = country("EA");
  const i = peakMonth(PRICES, ea);
  assert.equal(monthLabel(PRICES, i), "October 2022");
  const renter = personal(PRICES, ea, household("renter"), i);
  const retired = personal(PRICES, ea, household("retired"), i);
  assert.equal(renter.official, 10.6);
  assert.equal(renter.shown, 15.1);
  assert.equal(retired.shown, 10.4);
  assert.equal(renter.gap, 4.5);
  assert.equal(retired.gap, -0.2);
  assert.ok(renter.rate - retired.rate > 4);
  const housing = (r) => r.categories[3];
  assert.equal(housing(renter).code, "CP04");
  assert.equal((housing(renter).share * 100).toFixed(1), "45.8");
  assert.equal((housing(retired).share * 100).toFixed(1), "15.0");
  assert.equal(housing(renter).change.toFixed(1), "23.0");
  assert.equal((housing(renter).officialShare * 100).toFixed(1), "18.1");
  assert.equal(mainReason(renter).code, "CP04");
  // In this month the official basket priced as one fixed basket also comes to 10.6%, so the whole gap is spending.
  assert.equal(renter.benchmark.toFixed(2), "10.65");
  assert.equal(renter.benchmarkShown, 10.6);
  assert.equal(renter.method, 0);
  assert.equal(renter.spending, 4.5);
  assert.equal(retired.spending, -0.2);
  assert.equal(methodWarning(PRICES, ea, renter), "");
  assert.deepEqual(reading(PRICES, ea, renter), [
    "The price of this basket rose 15.1% over the 12 months to October 2022, against an official rate of 10.6% for the euro area: 4.5 points higher.",
    "What cost 2,400 a month at the start of those 12 months cost 2,762 at the end.",
    "In this month the method makes no difference: the official basket for 2022, priced the way this page prices a basket, also comes to 10.6%.",
    "The category that does most to set this basket apart from the official one is housing, water, electricity, gas and other fuels: it takes 45.8% of this budget and 18.1% of the official basket, and its prices rose 23.0%.",
  ]);
});

test("the contributions add up to the household's rate, and the official ones to the official rate", () => {
  for (const c of PRICES.countries) {
    for (const h of HOUSEHOLDS) {
      for (const i of [firstMonth(), at(2022, 10), c.last]) {
        const r = personal(PRICES, c, h.spend, i);
        close(r.categories.reduce((s, k) => s + k.points, 0), r.rate, 1e-9);
        close(r.categories.reduce((s, k) => s + k.share, 0), 1, 1e-12);
        close(r.categories.reduce((s, k) => s + k.officialShare, 0), 1, 1e-12);
        const off = r.categories.reduce((s, k) => s + k.officialPoints, 0);
        close(off, 100 * (c.index[0][i] / c.index[0][i - 12] - 1), c.decimals >= 2 ? 0.03 : 0.16);
        assert.equal(r.gap, oneDecimal(r.shown - c.rate[i]));
      }
    }
  }
});

test("a basket with the official weights comes close to the official rate, but not always", () => {
  // The check quoted in the write-up, for December 2014 to August 2026.
  let n = 0, within = 0, worst = { d: 0 };
  for (const c of PRICES.countries) {
    for (let i = firstMonth(); i <= Math.min(c.last, END); i++) {
      const r = personal(PRICES, c, officialSpend(PRICES, c, i, 1e7), i);
      const d = r.rate - 100 * (c.index[0][i] / c.index[0][i - 12] - 1);
      n++;
      if (Math.abs(d) <= 0.1) within++;
      if (Math.abs(d) > Math.abs(worst.d)) worst = { d, code: c.code, i };
    }
  }
  assert.equal(n, 2961);
  assert.equal(within, 2560);
  assert.equal((100 * within / n).toFixed(1), "86.5");
  assert.equal(worst.code, "NL");
  assert.equal(monthLabel(PRICES, worst.i), "September 2023");
  assert.equal(worst.d.toFixed(2), "1.25");
  assert.equal(country("NL").rate[worst.i], -0.3);
  // In the euro area the same check: 131 of 141 months within 0.1, the worst 0.19 in July 2023.
  const ea = country("EA");
  let eaWithin = 0, eaWorst = 0, eaAt = 0;
  for (let i = firstMonth(); i <= END; i++) {
    const d = personal(PRICES, ea, officialSpend(PRICES, ea, i, 1e7), i).rate - 100 * (ea.index[0][i] / ea.index[0][i - 12] - 1);
    if (Math.abs(d) <= 0.1) eaWithin++;
    if (Math.abs(d) > eaWorst) { eaWorst = Math.abs(d); eaAt = i; }
  }
  assert.equal(eaWithin, 131);
  assert.equal(eaWorst.toFixed(2), "0.19");
  assert.equal(monthLabel(PRICES, eaAt), "July 2023");
});

test("the series covers every month with a 12-month change, and the peak is found", () => {
  const ea = country("EA");
  const s = series(PRICES, ea, household("retired"));
  assert.equal(s.length, ea.last - 11);
  assert.equal(s[0].i, 12);
  assert.equal(monthLabel(PRICES, s[0].i), "December 2014");
  assert.equal(s.at(-1).i, ea.last);
  assert.ok(s.every((p) => Number.isFinite(p.rate) && Number.isFinite(p.official)));
  // The peak is looked for between January 2021 and December 2023, so newer months cannot move it.
  assert.equal(monthLabel(PRICES, peakMonth(PRICES, country("UK"))), "October 2022");
  assert.equal(monthLabel(PRICES, peakMonth(PRICES, country("HU"))), "January 2023");
  assert.equal(monthLabel(PRICES, peakMonth(PRICES, ea, [2015, 1], [2019, 12])), "October 2018");
  const { data, land } = toy();
  assert.equal(peakMonth(data, land, [2020, 1], [2021, 12]), 18); // 8.7 in June 2021 against 5.0 in December 2020
  assert.equal(peakMonth(data, land, [2020, 1], [2020, 12]), 12);
  assert.equal(peakMonth(data, land, [2030, 1], [2030, 12]), -1);
});

/* ---------- every kind of sentence ---------- */
test("the reading in its small and odd cases", () => {
  const { data, land } = toy();
  const r = personal(data, land, [60, 30, 10], 18);
  assert.deepEqual(reading(data, land, r), [
    "The price of this basket rose 11.1% over the 12 months to June 2021, against an official rate of 8.7% for Toyland: 2.4 points higher.",
    "What cost 100 a month at the start of those 12 months cost 111 at the end.",
    "The two figures are not worked out the same way: the official basket for 2021, priced the way this page prices a basket, comes to 9.0%, not 8.7%. Against 9.0% this basket is 2.1 points higher.",
    "The category that does most to set this basket apart from the official one is apples: it takes 60.0% of this budget and 50.0% of the official basket, and its prices rose 21.0%.",
  ]);
  // Lower than the official rate, falling prices, and a gap of exactly one point.
  const low = personal(data, land, [0, 100, 0], 18);
  assert.equal(low.shown, -5);
  assert.equal(low.spending, -14);
  assert.equal(reading(data, land, low)[0], "The price of this basket fell 5.0% over the 12 months to June 2021, against an official rate of 8.7% for Toyland: 13.7 points lower.");
  assert.equal(reading(data, land, { ...low, shown: 7.7, gap: -1 })[0], "The price of this basket rose 7.7% over the 12 months to June 2021, against an official rate of 8.7% for Toyland: 1.0 point lower.");
  assert.match(reading(data, land, { ...low, shown: 8, gap: -0.7, spending: -1 })[2], /Against 9\.0% this basket is 1\.0 point lower\.$/);
  // The same as the official rate to one decimal place, and still not the same as the official basket priced this
  // way: 0.45 × 21 + 0.15 × -5 = 8.7 against 9.0.
  const same = personal(data, land, [45, 15, 40], 18);
  assert.equal(same.shown, 8.7);
  assert.equal(same.gap, 0);
  assert.equal(same.spending, -0.3);
  assert.deepEqual(reading(data, land, same), [
    "The price of this basket rose 8.7% over the 12 months to June 2021, the same as the official rate for Toyland to one decimal place.",
    "What cost 100 a month at the start of those 12 months cost 109 at the end.",
    "The two figures are not worked out the same way: the official basket for 2021, priced the way this page prices a basket, comes to 9.0%, not 8.7%. Against 9.0% this basket is 0.3 points lower.",
    "The category that does most to set this basket apart from the official one is apples: it takes 45.0% of this budget and 50.0% of the official basket, and its prices rose 21.0%.",
  ]);
  // The official weights themselves: the whole gap is method, and no category is blamed for it.
  const weights = personal(data, land, [500, 300, 200], 18);
  assert.equal(weights.shown, 9);
  assert.equal(weights.gap, 0.3);
  assert.equal(weights.spending, 0);
  assert.equal(mainReason(weights), null);
  assert.deepEqual(reading(data, land, weights), [
    "The price of this basket rose 9.0% over the 12 months to June 2021, against an official rate of 8.7% for Toyland: 0.3 points higher.",
    "What cost 1,000 a month at the start of those 12 months cost 1,090 at the end.",
    "The two figures are not worked out the same way: the official basket for 2021, priced the way this page prices a basket, comes to 9.0%, not 8.7%. Against 9.0% this basket is the same to one decimal place.",
  ]);
  // Neither a gap nor a difference of method: nothing more to say.
  assert.equal(reading(data, land, { ...weights, shown: 8.7, gap: 0, benchmarkShown: 8.7, method: 0 }).length, 2);
  // A basket whose price did not move, and a reason that is not in the budget at all.
  const flat = personal(data, land, [0, 0, 5], 18);
  assert.equal(flat.shown, 0);
  assert.deepEqual(reading(data, land, flat), [
    "The price of this basket changed by less than 0.05% over the 12 months to June 2021, against an official rate of 8.7% for Toyland: 8.7 points lower.",
    "The two figures are not worked out the same way: the official basket for 2021, priced the way this page prices a basket, comes to 9.0%, not 8.7%. Against 9.0% this basket is 9.0 points lower.",
    "The category that does most to set this basket apart from the official one is apples: it is not in this budget and takes 50.0% of the official basket, and its prices rose 21.0%.",
  ]);
  // No official rate for the month: no gap and nothing said about method.
  assert.deepEqual(reading(data, land, { ...r, official: null, gap: null, method: null }).slice(0, 3), [
    "The price of this basket rose 11.1% over the 12 months to June 2021. No official rate was published for that month.",
    "What cost 100 a month at the start of those 12 months cost 111 at the end.",
    "The category that does most to set this basket apart from the official one is apples: it takes 60.0% of this budget and 50.0% of the official basket, and its prices rose 21.0%.",
  ]);
  // A difference that no category explains: every share within a point of the official one.
  const near = personal(data, land, [505, 297, 198], 18);
  assert.ok(Math.abs(near.categories[0].share - near.categories[0].officialShare) < SHARE_MIN);
  assert.equal(near.spending, 0.1);
  assert.equal(mainReason(near), null);
  assert.equal(reading(data, land, near).at(-1), "No single category sets this basket apart from the official one: the difference is spread thinly across the budget.");
  assert.equal(REASON_MIN, 0.05);
  // The warning in the tool: only when the method alone is worth 0.3 points or more.
  assert.equal(METHOD_WARN, 0.3);
  assert.equal(methodWarning(data, land, r), "In this month the method alone moves the figure by 0.3 points. The official index is re-weighted every December, and this page prices one fixed basket: the official basket for 2021 priced this way comes to 9.0%, where the official rate for Toyland is 8.7%. Compare this basket with 9.0%.");
  assert.equal(methodWarning(data, land, { ...r, method: 0.2 }), "");
  assert.equal(methodWarning(data, land, { ...r, method: -0.2 }), "");
  assert.equal(methodWarning(data, land, { ...r, method: null }), "");
  assert.match(methodWarning(data, land, { ...r, method: -1 }), /^In this month the method alone moves the figure by 1\.0 point\. /);
  // Small amounts keep their pennies.
  assert.equal(reading(data, land, personal(data, land, [6, 3, 1], 18))[1], "What cost 10.00 a month at the start of those 12 months cost 11.11 at the end.");
});

test("a category's sentence in each case", () => {
  const c = (over) => categoryReading({ share: 0.458, officialShare: 0.146, change: 4.32, points: 1.98, officialPoints: 0.63, ...over });
  assert.equal(c(), "45.8% of this budget, 14.6% of the official basket. Prices rose 4.3%: +1.98 points on this rate, +0.63 on the official one.");
  assert.equal(c({ change: -0.71, points: -0.03, officialPoints: -0.03 }), "45.8% of this budget, 14.6% of the official basket. Prices fell 0.7%: -0.03 points on this rate, -0.03 on the official one.");
  assert.equal(c({ share: 0, points: 0 }), "Not in this budget, 14.6% of the official basket. Prices rose 4.3%: nothing on this rate, +0.63 on the official one.");
  assert.equal(c({ change: 0.04, points: 0.001, officialPoints: 0.004 }), "45.8% of this budget, 14.6% of the official basket. Prices changed by less than 0.05%: 0.00 points on this rate, 0.00 on the official one.");
  assert.equal(c({ officialPoints: null, officialShare: null }), "45.8% of this budget. Prices rose 4.3%: +1.98 points on this rate.");
  assert.equal(c({ change: null }), "45.8% of this budget, 14.6% of the official basket. No price index was published for it in one of the two months.");
});

test("no sentence the real data can produce contains a broken number", () => {
  let count = 0;
  for (const c of PRICES.countries) {
    for (const spend of [...HOUSEHOLDS.map((h) => h.spend), officialSpend(PRICES, c, c.last), [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]]) {
      for (let i = firstMonth(); i <= c.last; i += 3) {
        const r = personal(PRICES, c, spend, i);
        const text = [...reading(PRICES, c, r), ...r.categories.map(categoryReading)].join(" ");
        assert.doesNotMatch(text, /NaN|undefined|Infinity|null|–|-0\.0%|rose 0\.0%|fell 0\.0%/, `${c.code} ${i}: ${text}`);
        count++;
      }
    }
  }
  assert.ok(count > 5000);
});

/* ---------- added by the independent review ---------- */
test("the gap is reported as spending plus method, and the method part is said out loud when it is large", () => {
  // The Netherlands, September 2023, worked out separately from a fresh download: the 2023 weights as one fixed
  // basket come to 0.944%, the official rate is -0.3%.
  const nl = country("NL"), i = at(2023, 9);
  assert.equal(benchmarkRate(PRICES, nl, i).toFixed(3), "0.944");
  const basket = personal(PRICES, nl, officialSpend(PRICES, nl, i), i);
  assert.equal(basket.shown, 0.9);
  assert.equal(basket.official, -0.3);
  assert.equal(basket.gap, 1.2);
  assert.equal(basket.method, 1.2);
  assert.equal(basket.spending, 0);
  assert.equal(mainReason(basket), null);
  assert.deepEqual(reading(PRICES, nl, basket), [
    "The price of this basket rose 0.9% over the 12 months to September 2023, against an official rate of -0.3% for the Netherlands: 1.2 points higher.",
    "What cost 2,000 a month at the start of those 12 months cost 2,019 at the end.",
    "The two figures are not worked out the same way: the official basket for 2023, priced the way this page prices a basket, comes to 0.9%, not -0.3%. Against 0.9% this basket is the same to one decimal place.",
  ]);
  assert.equal(methodWarning(PRICES, nl, basket), "In this month the method alone moves the figure by 1.2 points. The official index is re-weighted every December, and this page prices one fixed basket: the official basket for 2023 priced this way comes to 0.9%, where the official rate for the Netherlands is -0.3%. Compare this basket with 0.9%.");
  const renter = personal(PRICES, nl, household("renter"), i);
  assert.equal(renter.shown, -7.9);
  assert.equal(renter.gap, -7.6);
  assert.equal(renter.spending, -8.8);
  assert.equal(renter.method, 1.2);
  const retired = personal(PRICES, nl, household("retired"), i);
  assert.equal(retired.shown, 2);
  assert.equal(retired.gap, 2.3);
  assert.equal(retired.spending, 1.1);
  // Germany, March 2023: 10.0 against an official 7.7, of which 0.4 is method.
  const de = personal(PRICES, country("DE"), household("renter"), at(2023, 3));
  assert.deepEqual([de.shown, de.official, de.benchmarkShown, de.gap, de.spending, de.method], [10, 7.7, 8.1, 2.3, 1.9, 0.4]);
  // The euro area in its latest month of the snapshot of October 2026: nothing to warn about.
  const ea = personal(PRICES, country("EA"), household("renter"), at(2026, 8));
  assert.deepEqual([ea.shown, ea.official, ea.benchmarkShown, ea.method], [3.2, 3.2, 3.2, 0]);

  // Everywhere: the two parts add up to the gap as displayed, and the benchmark is the official-weights basket.
  let n = 0, far = 0, warned = 0, same = 0;
  const large = [];
  for (const c of PRICES.countries) {
    for (let k = firstMonth(); k <= Math.min(c.last, END); k++) {
      const r = personal(PRICES, c, household("family"), k);
      assert.equal(r.gap, oneDecimal(r.spending + r.method), `${c.code} ${k}`);
      assert.equal(r.benchmark, benchmarkRate(PRICES, c, k));
      close(personal(PRICES, c, officialSpend(PRICES, c, k, 1e7), k).rate, r.benchmark, 1e-5);
      const terms = r.categories.reduce((s, x) => s + (x.share - x.officialShare) * x.change, 0);
      close(terms, r.rate - r.benchmark, 1e-9);
      n++;
      if (Math.abs(r.benchmark - 100 * (c.index[0][k] / c.index[0][k - 12] - 1)) > 0.5) far++;
      if (methodWarning(PRICES, c, r)) warned++;
      if (r.method === 0) same++;
      if (Math.abs(r.method) >= 1) large.push(`${c.code} ${monthLabel(PRICES, k)} ${r.method}`);
    }
  }
  // The counts quoted in the write-up, for December 2014 to August 2026.
  assert.equal(n, 2961);
  assert.equal(far, 28); // more than half a point from the rate the index gives
  assert.equal(warned, 125); // 0.3 points or more as displayed: the tool then shows its warning
  // The same as the official rate to one decimal place: 1,890 in the snapshot of 11 October 2026, 1,889 after
  // Eurostat revised Austria's August figures. Not quoted on the page, so it is held to a range, not pinned: the
  // monthly refresh must not fail on a revision that changes nothing the page says.
  assert.ok(same > 1800 && same < 2000, `${same}`);
  assert.deepEqual(large, ["NL September 2023 1.2", "NL October 2023 1.1"]);
  // The series for the chart carries the benchmark for every month.
  const s = series(PRICES, country("NL"), household("renter"));
  assert.ok(s.every((p) => Number.isFinite(p.benchmark)));
  assert.equal(s.find((p) => p.i === i).benchmark.toFixed(3), "0.944");
  assert.equal(benchmarkRate(PRICES, nl, 11), null);
  assert.equal(benchmarkRate(PRICES, nl, nl.last + 1), null);
});

test("the official basket fills the form with the official shares themselves", () => {
  let months = 0;
  for (const c of PRICES.countries) {
    for (const y of PRICES.weightYears) {
      if (y < 2015) continue;
      const amounts = officialSpend(PRICES, c, at(y, 1));
      assert.equal(amounts.length, 13);
      // Each amount is the published weight (parts per 1,000) doubled, and the total is 2,000 to within the 0.03
      // parts by which published weights miss 1,000. (The UK's weights have up to four decimals from 2024.)
      const w = c.weights[PRICES.weightYears.indexOf(y)], mine = toScheme(PRICES, c, amounts);
      w.forEach((v, k) => close(mine[k], 2 * v, 1e-9));
      assert.ok(amounts.every((v) => v >= 0 && Math.abs(v * 1e4 - Math.round(v * 1e4)) < 1e-6), `${c.code} ${y}`);
      close(amounts.reduce((s, v) => s + v, 0), 2000, 0.07);
    }
    // So pressing "Official basket" always shows the same figure as the tile beside it, and no gap from spending.
    for (let i = firstMonth(); i <= c.last; i++) {
      const r = personal(PRICES, c, officialSpend(PRICES, c, i), i);
      close(r.rate, r.benchmark, 1e-9);
      assert.equal(r.shown, r.benchmarkShown, `${c.code} ${i}`);
      assert.equal(r.spending, 0);
      assert.equal(r.gap, r.method);
      assert.equal(mainReason(r), null);
      months++;
    }
  }
  assert.ok(months >= 2961);
  assert.deepEqual(officialSpend(PRICES, country("EA"), at(2022, 10)).slice(0, 4), [332.32, 85.4, 104.8, 361.5]);
  close(officialSpend(PRICES, country("EA"), at(2022, 10), 1000)[3], 180.75, 1e-9);
});

test("a result says when it rests on a figure the source marks as estimated or of low reliability", () => {
  // The 12 months to October 2022 in the euro area read the restaurants index of December 2020, marked "u".
  const ea = country("EA");
  const r = personal(PRICES, ea, household("renter"), at(2022, 10));
  assert.deepEqual(r.flagged, { u: ["restaurants and accommodation"] });
  assert.deepEqual(flagNotes(PRICES, r.flagged, ea.index.length), ["Eurostat marks the index for restaurants and accommodation in one or more of the months used here as of low reliability."]);
  assert.deepEqual(personal(PRICES, ea, household("renter"), at(2026, 8)).flagged, {});
  assert.deepEqual(flaggedSeries(PRICES, country("UK"), at(2022, 10)), {});
  // France: 13 of its 14 series up to December 2015, read by every month up to December 2016.
  const fr = country("FR");
  assert.deepEqual(flagNotes(PRICES, flaggedSeries(PRICES, fr, at(2015, 6)), fr.index.length), ["Eurostat marks 13 of the 14 indices in one or more of the months used here as estimated."]);
  assert.equal(flaggedSeries(PRICES, fr, at(2016, 12)).e.length, 13);
  assert.deepEqual(flaggedSeries(PRICES, fr, at(2018, 1)), {});
  assert.deepEqual(flagNotes(PRICES, {}, 14), []);
});

test("the Dutch figures quoted to explain the largest difference of method", () => {
  // Housing and household energy in the Netherlands: a 2023 weight of 16.9%; 23.7% of the 2022 basket at the
  // prices of September 2022 (weight 190.86 per 1,000, its index up from 89.36 to 125.52 since December 2021 while
  // all items went from 83.97 to 95.10); and a fall of 25.5% over the next twelve months (125.52 to 93.51).
  const nl = country("NL"), k = 3, sep22 = at(2022, 9), dec21 = at(2021, 12), sep23 = at(2023, 9);
  assert.equal(categoriesOf(PRICES, nl)[k].code, "CP04");
  const w = (y) => nl.weights[PRICES.weightYears.indexOf(y)][k] / nl.weights[PRICES.weightYears.indexOf(y)].reduce((s, v) => s + v, 0);
  assert.equal((100 * w(2023)).toFixed(1), "16.9");
  const s = nl.index[k + 1], all = nl.index[0];
  assert.deepEqual([s[dec21], s[sep22], s[sep23], all[dec21], all[sep22]], [89.36, 125.52, 93.51, 83.97, 95.1]);
  assert.equal((100 * w(2022) * (s[sep22] / s[dec21]) / (all[sep22] / all[dec21])).toFixed(1), "23.7");
  assert.equal((100 * (s[sep23] / s[sep22] - 1)).toFixed(1), "-25.5");
});
