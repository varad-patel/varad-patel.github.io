import test from "node:test";
import assert from "node:assert/strict";
import { BIGMAC } from "./data.js";
import { snapshot, valuation, sharedDates, history, ranking, countries, regressionSet, joinsFit, ownIndex, verdict, gapSize, gapSide, figure, monthOf, OWN_LIMITS } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
// The Economist rounds its index to five places. A recalculated value can sit a hair either side of a rounding
// boundary, so "the same" means within half a unit in the fifth place plus a little for floating point.
const ROUNDED = 5.1e-6;
const LATEST = "2026-07-01";

/* -------------------------------------------- against The Economist's own figures */

test("the raw index against the dollar reproduces every figure The Economist publishes", () => {
  let n = 0;
  BIGMAC.dates.forEach((date, i) => {
    const snap = snapshot(BIGMAC, date);
    assert.equal(snap.rows.length, BIGMAC.published[i].length, `${date}: the same countries as the published index`);
    for (const [iso, raw] of BIGMAC.published[i]) { close(valuation(snap, iso, "USA").raw, raw, ROUNDED); n++; }
  });
  assert.equal(n, 2056);
});

test("the GDP-adjusted index against the dollar reproduces every published figure, and is missing exactly where theirs is", () => {
  let n = 0, missing = 0;
  BIGMAC.dates.forEach((date, i) => {
    const snap = snapshot(BIGMAC, date);
    for (const [iso, , adjusted] of BIGMAC.published[i]) {
      const mine = valuation(snap, iso, "USA").adjusted;
      if (adjusted == null) { assert.equal(mine, null, `${date} ${iso} should have no adjusted index`); missing++; } else { close(mine, adjusted, ROUNDED); n++; }
    }
  });
  assert.equal(n, 1802);
  assert.equal(missing, 254);
});

test("the other four base currencies match the published columns (figures copied from big-mac-full-index.csv)", () => {
  // date, country, then raw against USD, EUR, GBP, JPY, CNY and adjusted against the same five.
  const rows = [
    ["2000-04-01", "ARG", [0.11607, 0.05007, -0.16722, -0.09864, 1.09091], [0.40126, 0.16629, -0.06179, 0.11141, 0.96754]],
    ["2011-07-01", "BRA", [0.69297, 0.25039, 0.58351, 0.50912, 1.71105], [1.47452, 0.57702, 1.14714, 1.15292, 1.71276]],
    ["2011-07-01", "CHN", [-0.37553, -0.53878, -0.41591, -0.44334, 0], [-0.08782, -0.41867, -0.20851, -0.20638, 0]],
    ["2016-01-01", "RUS", [-0.64405, -0.61815, -0.63831, -0.51034, -0.43099], [-0.51776, -0.56073, -0.555, -0.37205, -0.48258]],
    ["2016-01-01", "NOR", [0.21554, 0.304, 0.23516, 0.67215, 0.94312], [0.19287, 0.08659, 0.10075, 0.55332, 0.27989]],
    ["2021-01-01", "ARE", [-0.17881, -0.22237, -0.09511, 0.07387, 0.16079], [-0.13282, -0.28671, -0.1218, 0.08148, -0.09833]],
    ["2026-07-01", "CHE", [0.45369, 0.27725, 0.22185, 1.93203, 1.31023], [0.48516, 0.15003, 0.11598, 1.81488, 0.94862]],
    ["2026-07-01", "IND", [-0.60543, -0.65332, -0.66836, -0.20418, -0.37295], [-0.49452, -0.60858, -0.62017, -0.04194, -0.33678]],
    ["2026-07-01", "VNM", [-0.53463, -0.59111, -0.60885, -0.06136, -0.26042], [-0.41179, -0.54452, -0.55801, 0.11485, -0.22824]],
    ["2026-07-01", "USA", [0, -0.12137, -0.15948, 1.01696, 0.58922], [0, -0.22565, -0.24858, 0.89533, 0.31206]],
  ];
  const bases = ["USA", "EUZ", "GBR", "JPN", "CHN"];
  for (const [date, iso, raw, adjusted] of rows) {
    const snap = snapshot(BIGMAC, date);
    bases.forEach((base, k) => {
      const v = valuation(snap, iso, base);
      close(v.raw, raw[k], ROUNDED);
      close(v.adjusted, adjusted[k], ROUNDED);
    });
  }
});

test("the published inputs to the adjustment match too: burger-rate GDP and the price the line predicts", () => {
  const snap = snapshot(BIGMAC, LATEST);
  const row = (iso) => snap.rows.find((r) => r.iso === iso);
  close(row("USA").dollarPrice, 6.22, 1e-12);
  close(row("CHE").dollarPrice, 9.0419272929956, 1e-9);
  close(row("CHE").gdpBigmac, 81900.755109589, 1e-6);
  close(row("CHE").adjPrice, 6.1024299581046, 1e-9);
  close(row("USA").adjPrice, 6.23457003834235, 1e-9);
  close(row("IND").gdpBigmac, 6232.10976736508, 1e-6);
  close(row("IND").adjPrice, 4.86653745462882, 1e-9);
  close(snapshot(BIGMAC, "2000-04-01").rows.find((r) => r.iso === "ARG").adjPrice, 1.92552946969834, 1e-9);
});

/* ------------------------------------------------------------------ by hand */

const TOY = {
  dates: ["2030-01-01"],
  names: { USA: "United States", AAA: "Aland", BBB: "Bland", CCC: "Cland" },
  indexCountries: ["USA", "AAA", "BBB", "CCC"],
  regression: { always: ["USA", "AAA", "BBB"], from: { "2031-01-01": ["CCC"] } },
  // The burger costs 5 dollars in America, 20 alas (4 to the dollar, so 5 dollars), 30 blas (10 to the dollar, so 3 dollars).
  prices: [[["USA", "USD", 5, 1, 50000], ["AAA", "ALA", 20, 4, 120000], ["BBB", "BLA", 30, 10, 60000], ["CCC", "CLA", 8, 2, null]]],
};

test("a three-country world worked by hand", () => {
  const snap = snapshot(TOY, "2030-01-01");
  // Raw: Bland's burger costs 3 dollars against 5, so the bla is 40% undervalued against the dollar.
  const b = valuation(snap, "BBB", "USA");
  close(b.implied, 6); close(b.market, 10); close(b.raw, -0.4);
  // Against the ala: implied 30/20 = 1.5 blas per ala, market 10/4 = 2.5, so 1.5 / 2.5 - 1 = -40%.
  const ba = valuation(snap, "BBB", "AAA");
  close(ba.implied, 1.5); close(ba.market, 2.5); close(ba.raw, -0.4);
  // The other way round is not the mirror image: 2.5 / 1.5 - 1 = +66.7%.
  close(valuation(snap, "AAA", "BBB").raw, 2 / 3);
  // Burger-rate GDP: local GDP divided by (local price / US price). USA 50,000; Aland 120,000 / 4 = 30,000; Bland 60,000 / 6 = 10,000.
  const g = Object.fromEntries(snap.sample.map((r) => [r.iso, r.gdpBigmac]));
  close(g.USA, 50000); close(g.AAA, 30000); close(g.BBB, 10000);
  // Least squares through (50000, 5), (30000, 5), (10000, 3): slope 0.00005, intercept 17/6.
  close(snap.fit.slope, 0.00005, 1e-15); close(snap.fit.intercept, 17 / 6, 1e-12);
  assert.equal(snap.fit.n, 3);
  // Predicted prices: USA 16/3, Aland 13/3, Bland 10/3. Adjusted bla against the dollar: (3 / (10/3)) / (5 / (16/3)) - 1 = -4%.
  close(b.adjusted, 0.9 / 0.9375 - 1, 1e-12);
  // Cland is not on the list for the fit until 2031: a raw index, no adjusted one, and the reason is the list.
  const c = valuation(snap, "CCC", "USA");
  close(c.raw, -0.2); assert.equal(c.adjusted, null);
  assert.equal(c.a.left, "list"); assert.equal(c.b.left, null);
  // On the list but with no GDP figure, the reason is the GDP.
  const later = snapshot({ ...TOY, dates: ["2031-06-01"] }, "2031-06-01");
  assert.equal(later.rows.find((r) => r.iso === "CCC").left, "gdp");
  assert.equal(later.fit.n, 3);
  assert.equal(valuation(snap, "USA", "CCC").adjusted, null);
});

test("how well the income line fits: 8% of the variation in July 2026, never more than 34%", () => {
  const fits = BIGMAC.dates.map((date) => ({ date, r2: snapshot(BIGMAC, date).fit.r2 }));
  const best = fits.reduce((a, b) => (b.r2 > a.r2 ? b : a));
  assert.equal(best.date, "2016-01-01");
  assert.equal(best.r2.toFixed(2), "0.34");
  assert.equal(fits.at(-1).r2.toFixed(2), "0.08");
  assert.ok(fits.every((f) => f.r2 > 0 && f.r2 < 0.345));
});

test("countries join the regression from the dates the generator script gives", () => {
  assert.ok(!regressionSet(BIGMAC, "2020-07-01").has("ARE"));
  assert.ok(regressionSet(BIGMAC, "2021-01-01").has("ARE"));
  assert.ok(!regressionSet(BIGMAC, "2026-01-01").has("BGR"));
  assert.ok(regressionSet(BIGMAC, "2026-07-01").has("BGR"));
  assert.ok(regressionSet(BIGMAC, "2000-04-01").has("DEU"), "euro-area members are in the regression");
  assert.ok(!BIGMAC.indexCountries.includes("DEU"), "but the index reports them only as the euro area");
  assert.equal(snapshot(BIGMAC, LATEST).fit.n, 70);
  // 49 on the list throughout, 22 more from January 2021 and Bulgaria from July 2026: 72, of which Russia and Sri Lanka
  // have no price in July 2026 (their last rounds are January 2022 and January 2024).
  assert.equal(BIGMAC.regression.always.length, 49);
  assert.equal(BIGMAC.regression.from["2021-01-01"].length, 22);
  assert.deepEqual(BIGMAC.regression.from["2026-07-01"], ["BGR"]);
  assert.equal(regressionSet(BIGMAC, LATEST).size, 72);
  const priced = new Set(BIGMAC.prices.at(-1).map((r) => r[0]));
  assert.deepEqual([...regressionSet(BIGMAC, LATEST)].filter((iso) => !priced.has(iso)).sort(), ["LKA", "RUS"]);
  assert.equal(sharedDates(BIGMAC, "RUS", "USA").at(-1), "2022-01-01");
  assert.equal(sharedDates(BIGMAC, "LKA", "USA").at(-1), "2024-01-01");
  // The euro area is on the list as a whole and so are members of it, so the line is fitted to economies, not only countries.
  for (const iso of ["EUZ", "DEU", "FRA", "ITA"]) assert.equal(joinsFit(BIGMAC, iso), "always");
  // When a country joins, for the sentence that explains a missing adjusted index.
  assert.equal(joinsFit(BIGMAC, "ARE"), "2021-01-01");
  assert.equal(joinsFit(BIGMAC, "BGR"), "2026-07-01");
  assert.equal(joinsFit(BIGMAC, "VEN"), null);
  assert.equal(joinsFit(BIGMAC, "LBN"), null);
});

test("an independent calculation: the July 2026 line and India's two figures by hand-written least squares", () => {
  // Written apart from logic.js: sums over the rows of the data file, nothing from the kit.
  const day = BIGMAC.prices.at(-1), us = day.find((r) => r[0] === "USA")[2];
  const list = new Set([...BIGMAC.regression.always, ...BIGMAC.regression.from["2021-01-01"], ...BIGMAC.regression.from["2026-07-01"]]);
  const pts = day.filter((r) => list.has(r[0]) && r[4] > 0).map(([iso, , price, rate, gdp]) => ({ iso, x: gdp / (price / us), y: price / rate }));
  const n = pts.length, mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const slope = sxy / sxx, intercept = my - slope * mx;
  assert.equal(n, 70);
  const at = (iso) => pts.find((p) => p.iso === iso);
  const adjusted = (at("IND").y / (intercept + slope * at("IND").x)) / (at("USA").y / (intercept + slope * at("USA").x)) - 1;
  close(adjusted, -0.49452, ROUNDED);                 // USD_adjusted for India in big-mac-full-index.csv
  close(at("IND").y / at("USA").y - 1, -0.60543, ROUNDED);   // USD_raw
  const v = valuation(snapshot(BIGMAC, LATEST), "IND", "USA");
  close(v.adjusted, adjusted, 1e-12); close(snapshot(BIGMAC, LATEST).fit.slope, slope, 1e-15);
});

/* ---------------------------------------------------------------- the edges */

test("the same currency on both sides is at parity, and a missing country or date gives nothing", () => {
  const snap = snapshot(BIGMAC, LATEST);
  const same = valuation(snap, "IND", "IND");
  assert.equal(same.raw, 0); assert.equal(same.adjusted, 0); assert.equal(same.implied, 1);
  assert.equal(valuation(snap, "IND", "XXX"), null);
  assert.equal(valuation(snap, "DEU", "USA"), null, "a country outside the index cannot be picked");
  assert.equal(snapshot(BIGMAC, "1999-01-01"), null);
  assert.equal(valuation(null, "IND", "USA"), null);
  assert.deepEqual(sharedDates(BIGMAC, "IND", "XXX"), []);
});

test("shared dates, history and ranking", () => {
  assert.equal(sharedDates(BIGMAC, "USA", "GBR").length, 45);
  const india = sharedDates(BIGMAC, "IND", "USA");
  assert.equal(india[0], "2011-07-01");           // India joins the index in July 2011
  assert.equal(india.at(-1), LATEST);
  const h = history(BIGMAC, "IND", "USA");
  assert.equal(h.length, india.length);
  close(h.at(-1).raw, -0.60543, ROUNDED);
  assert.ok(h.every((p) => Number.isFinite(p.raw) && (p.adjusted == null || Number.isFinite(p.adjusted))));
  const snap = snapshot(BIGMAC, LATEST);
  const raw = ranking(snap, "USA", "raw");
  assert.equal(raw.length, 54);
  assert.deepEqual([raw[0].name, raw.at(-1).name], ["Switzerland", "Indonesia"]);
  assert.equal(ranking(snap, "USA", "adjusted").length, 52);
  // Lebanon and Venezuela are priced but are not on The Economist's list of countries for the fit.
  assert.deepEqual(snap.rows.filter((r) => r.left).map((r) => [r.iso, r.left]), [["LBN", "list"], ["VEN", "list"]]);
  assert.ok(raw.every((r, i) => i === 0 || r.value <= raw[i - 1].value));
  const list = countries(BIGMAC);
  assert.equal(list.length, 56);
  assert.equal(list.find((c) => c.iso === "VEN").currency, "VES");  // the latest code a country has carried
  assert.equal(list.find((c) => c.iso === "ARE").name, "United Arab Emirates");
});

test("your own index: the sum, and what is refused", () => {
  // A coffee at 4.50 in A-money and 3.00 in B-money implies 1.5 A per B. At a market rate of 1.25, A is 20% overvalued.
  const r = ownIndex({ priceA: 4.5, priceB: 3, rate: 1.25 });
  assert.equal(r.ok, true); close(r.implied, 1.5); close(r.value, 0.2);
  close(ownIndex({ priceA: 3, priceB: 3, rate: 1 }).value, 0);
  // Fed the Big Mac's own figures it returns the Big Mac index.
  const v = valuation(snapshot(BIGMAC, LATEST), "IND", "USA");
  close(ownIndex({ priceA: v.a.localPrice, priceB: v.b.localPrice, rate: v.market }).value, v.raw, 1e-12);
  for (const [bad, field] of [[{ priceA: 0 }, "priceA"], [{ priceA: -4 }, "priceA"], [{ priceA: NaN }, "priceA"], [{ priceB: 1e308 }, "priceB"], [{ priceB: Infinity }, "priceB"], [{ rate: 0 }, "rate"], [{ rate: "1.2" }, "rate"], [{ rate: 1e-9 }, "rate"]]) {
    const out = ownIndex({ priceA: 4.5, priceB: 3, rate: 1.25, ...bad });
    assert.equal(out.ok, false);
    assert.equal(out.field, field);
    assert.match(out.error, /must be a number above zero/);
  }
  assert.equal(ownIndex({ priceA: OWN_LIMITS.max, priceB: OWN_LIMITS.min, rate: 1 }).ok, true);
});

test("the wording in the small cases", () => {
  assert.equal(verdict(0), "at parity");
  assert.equal(verdict(0.342), "34.2% overvalued");
  assert.equal(verdict(-0.05), "5.0% undervalued");
  assert.equal(verdict(0.0001), "less than 0.05% overvalued");
  assert.equal(verdict(-0.0004), "less than 0.05% undervalued");
  assert.equal(verdict(null), "not available");
  assert.equal(verdict(NaN), "not available");
  assert.deepEqual([gapSize(-0.605), gapSide(-0.605)], ["60.5%", "undervalued"]);
  assert.deepEqual([gapSize(0), gapSide(0)], ["0%", "at parity"]);
  assert.deepEqual([gapSize(0.0002), gapSide(0.0002)], ["under 0.05%", "overvalued"]);
  assert.deepEqual([gapSize(null), gapSide(null)], ["–", ""]);
  // The edges: a good that is nearly free is not "100.0% undervalued", and an absurd ratio is not printed digit by digit.
  assert.equal(gapSize(-0.9994), "99.9%"); assert.equal(gapSize(-0.99996), "more than 99.9%");
  assert.equal(verdict(-0.999999), "more than 99.9% undervalued");
  assert.equal(gapSize(9.99), "999.0%"); assert.equal(gapSize(10), "1,000.0%"); assert.equal(gapSize(10.01), "more than 1,000%");
  assert.equal(verdict(1e24), "more than 1,000% overvalued");
  assert.equal(verdict(ownIndex({ priceA: OWN_LIMITS.max, priceB: OWN_LIMITS.min, rate: OWN_LIMITS.min }).value), "more than 1,000% overvalued");
  assert.equal(verdict(ownIndex({ priceA: OWN_LIMITS.min, priceB: OWN_LIMITS.max, rate: OWN_LIMITS.max }).value), "more than 99.9% undervalued");
  assert.equal(figure(1e18), "1,000,000tn"); assert.equal(figure(333333333333.3), "333bn"); assert.equal(figure(999999999), "999,999,999");
  assert.equal(figure(76000), "76,000"); assert.equal(figure(236.25), "236.25"); assert.equal(figure(6.22), "6.22");
  assert.equal(figure(0.80735), "0.8074"); assert.equal(figure(null), "–"); assert.equal(figure(0.00012345), "0.0001235");
  assert.equal(monthOf("2026-07-01"), "July 2026"); assert.equal(monthOf("2019-07-09"), "July 2019");
});

/* --------------------------------------------------------------- the finding */

test("the finding on the page: the rupee against the dollar in July 2026", () => {
  const snap = snapshot(BIGMAC, LATEST);
  const v = valuation(snap, "IND", "USA");
  assert.equal(v.a.localPrice, 236.25);
  assert.equal(v.b.localPrice, 6.22);
  assert.equal(v.market.toFixed(2), "96.26");
  assert.equal(v.implied.toFixed(2), "37.98");
  assert.equal(v.a.dollarPrice.toFixed(2), "2.45");
  assert.equal(verdict(v.raw), "60.5% undervalued");
  assert.equal(v.a.adjPrice.toFixed(2), "4.87");
  assert.equal(v.b.adjPrice.toFixed(2), "6.23");
  assert.equal(verdict(v.adjusted), "49.5% undervalued");
  assert.equal(snap.fit.n, 70);
  // The line through 70 countries is a loose fit: it explains 8% of the variation in burger prices.
  assert.equal(snap.fit.r2.toFixed(2), "0.08");
  // Only the Indonesian rupiah and the Taiwan dollar look cheaper on the raw index.
  assert.deepEqual(ranking(snap, "USA", "raw").slice(-3).map((r) => r.name), ["India", "Taiwan", "Indonesia"]);
});
