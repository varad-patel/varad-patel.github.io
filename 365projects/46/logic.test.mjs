import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { PIP } from "./data.js";
import {
  MAX_PICKS, seriesList, lorenz, giniFromShares, giniSharesRounded, giniExact, bankGini, measures, surveyAt, runs, trend, compareCurves,
  gapStats, pairedStats, the, measureText, sharesText, giniText, trendText, compareText, mixedText, COMPARE_NOTE,
} from "./logic.js";

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const ALL = seriesList();
const get = (id) => ALL.find((s) => s.id === id);
const at = (id, year) => { const series = get(id); return { series, row: series.rows.find((r) => r.year === year) }; };

/* ---------- the formulas, by hand ---------- */

test("the Lorenz curve of equal shares is the diagonal and its Gini is zero", () => {
  const curve = lorenz(Array(10).fill(7));
  assert.equal(curve.length, 11);
  curve.forEach(([p, l], k) => { close(p, k / 10); close(l, k / 10); });
  close(giniFromShares(Array(10).fill(7)), 0);
});

test("shares of 1, 2, ..., 10 give cumulative shares k(k+1)/110 and a Gini of exactly 0.3", () => {
  const shares = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const curve = lorenz(shares);
  for (let k = 0; k <= 10; k++) close(curve[k][1], (k * (k + 1)) / 110);
  // Area under the curve: 0.05 * sum of (L_k + L_(k-1)) = 0.05 * sum of 2k^2/110 = 0.05 * 7 = 0.35. Gini = 1 - 0.7.
  close(giniFromShares(shares), 0.3);
});

test("with everything in the richest tenth the ten-share Gini is 0.9, the most ten groups can show", () => {
  close(giniFromShares([0, 0, 0, 0, 0, 0, 0, 0, 0, 5]), 0.9);
});

test("a uniform distribution has shares 1, 3, ..., 19: the ten-share Gini is 0.33 against the true 1/3", () => {
  close(giniFromShares([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]), 0.33);
});

test("the curve ends at exactly 1 whatever the shares add up to, and bad input is refused", () => {
  assert.equal(lorenz([99, 220, 334, 451, 565, 705, 882, 1134, 1594, 4017])[10][1], 1);
  for (const bad of [[], [1, 2, 3], Array(10).fill(0), [1, 2, 3, 4, 5, 6, 7, 8, 9, -1], [1, 2, 3, 4, 5, 6, 7, 8, 9, NaN], [1, 2, 3, 4, 5, 6, 7, 8, 9, Infinity], null, "text"]) {
    assert.equal(lorenz(bad), null);
    assert.ok(Number.isNaN(giniFromShares(bad)));
  }
});

test("the exact Gini of a list of amounts matches hand-worked cases", () => {
  close(giniExact([5, 5, 5, 5]), 0);
  close(giniExact([0, 0, 0, 12]), 0.75);           // one of n has everything: (n - 1) / n
  close(giniExact([1, 2, 3, 4]), 0.25);            // mean absolute difference 1.25 over twice the mean 2.5
  assert.ok(Number.isNaN(giniExact([])));
});

test("the ten-share Gini falls short of the exact one by one tenth of the share-weighted Gini inside each tenth", () => {
  // 20,000 incomes with a long right tail. The identity is exact when the tenths have equal numbers of people.
  const r = rng(46);
  const incomes = Array.from({ length: 20000 }, () => Math.exp(r.normal(0, 0.9))).sort((a, b) => a - b);
  const total = incomes.reduce((s, v) => s + v, 0);
  const groups = Array.from({ length: 10 }, (_, k) => incomes.slice(k * 2000, (k + 1) * 2000));
  const shares = groups.map((g) => g.reduce((s, v) => s + v, 0) / total);
  const within = groups.reduce((s, g, k) => s + 0.1 * shares[k] * giniExact(g), 0);
  const exact = giniExact(incomes), fromShares = giniFromShares(shares);
  close(exact, fromShares + within, 1e-12);
  assert.ok(fromShares < exact);
  assert.ok(within > 0.005 && within < 0.03, `the shortfall here is ${within}`);
  // The write-up says 71% of the shortfall in this simulation comes from the richest tenth.
  assert.equal(Math.round((100 * 0.1 * shares[9] * giniExact(groups[9])) / within), 71);
});

/* ---------- the data against the source ---------- */

test("the module holds the source's own figures (PIP API, release 20260922, 2021 PPPs)", () => {
  // From https://api.worldbank.org/pip/v1/pip, as fractions: gini, then decile1 to decile10.
  const source = [
    ["AGO:consumption", 2000, 0.5195, [0.0099, 0.022, 0.0334, 0.0451, 0.0565, 0.0705, 0.0882, 0.1134, 0.1594, 0.4017]],
    ["IND:consumption", 2023, 0.23, [0.0487, 0.062, 0.0703, 0.0778, 0.0853, 0.0936, 0.1036, 0.1166, 0.1369, 0.2052]],
    ["BRA:income", 2024, 0.5026, [0.0135, 0.0256, 0.0356, 0.0454, 0.057, 0.0708, 0.0864, 0.1119, 0.1606, 0.3933]],
    ["USA:income", 2024, 0.4176, [0.0174, 0.0334, 0.0444, 0.0559, 0.0684, 0.083, 0.1011, 0.1254, 0.1635, 0.3075]],
    ["SWE:income", 2023, 0.2928, [0.0276, 0.0509, 0.0642, 0.0738, 0.0838, 0.0942, 0.1079, 0.1255, 0.1487, 0.2233]],
    ["ARG:income", 2024, 0.4235, [0.0192, 0.032, 0.0428, 0.054, 0.0667, 0.0811, 0.0995, 0.1256, 0.1673, 0.3118]],
  ];
  for (const [id, year, gini, deciles] of source) {
    const { row } = at(id, year);
    assert.equal(row.gini, Math.round(gini * 10000), `${id} ${year} Gini`);
    assert.deepEqual(row.shares, deciles.map((d) => Math.round(d * 10000)), `${id} ${year} shares`);
  }
  assert.equal(PIP.version, "20260922_2021_01_02_PROD");
  assert.equal(PIP.licence, "CC BY 4.0");
  assert.equal(get("ARG:income").level, "urban");
  assert.equal(get("ARG:income").label, "Argentina (income, urban areas only)");
});

test("every survey is complete, and only one has shares out of order", () => {
  assert.equal(ALL.length, 205);
  assert.equal(new Set(ALL.map((s) => s.id)).size, 205);
  assert.equal(new Set(ALL.map((s) => s.code)).size, 172);
  let surveys = 0;
  const outOfOrder = [];
  for (const s of ALL) {
    assert.ok(["income", "consumption"].includes(s.welfare) && ["national", "urban"].includes(s.level));
    s.rows.forEach((row, i) => {
      surveys++;
      assert.equal(row.shares.length, 10);
      assert.ok(row.shares.every((v) => Number.isInteger(v) && v > 0));
      const total = row.shares.reduce((a, b) => a + b, 0);
      assert.ok(total >= 9990 && total <= 10010, `${s.id} ${row.year} adds up to ${total}`);
      assert.ok(Number.isInteger(row.gini) && row.gini > 1000 && row.gini < 8000);
      assert.ok([0, 1, 2, 3].includes(row.kind));
      if (i) assert.ok(row.year > s.rows[i - 1].year, `${s.id} years must rise`);
      if (!measures(row).ascending) outOfOrder.push(`${s.id} ${row.year}`);
    });
    assert.equal(s.first, s.rows[0].year);
    assert.equal(s.last, s.rows.at(-1).year);
  }
  assert.equal(surveys, 2515);
  assert.deepEqual(outOfOrder, ["CIV:consumption 2002"]);
  assert.equal(ALL.filter((s) => s.level === "urban").map((s) => s.code).join(), "ARG");
});

/* ---------- one survey ---------- */

test("the measures of one survey match a hand calculation (Angola 2000)", () => {
  const { row } = at("AGO:consumption", 2000);
  const m = measures(row);
  const total = 99 + 220 + 334 + 451 + 565 + 705 + 882 + 1134 + 1594 + 4017; // 10,001
  assert.equal(total, 10001);
  close(m.bottom10, 99 / total);
  close(m.bottom50, 1669 / total);
  close(m.top10, 4017 / total);
  close(m.topToBottom, 4017 / 99);
  assert.equal(m.giniBank, 52);              // 0.5195 to one decimal on the 0 to 100 scale
  // Cumulative shares 99, 319, 653, 1104, 1669, 2374, 3256, 4390, 5984, 10001. The first nine add up to 19,848, so the
  // sum of every neighbouring pair (0 + 99, 99 + 319, ...) is 2 * 19,848 + 10,001 = 49,697.
  close(giniFromShares(row.shares), 1 - (0.1 * 49697) / total, 1e-12);
  assert.equal(m.giniShares, 50.3);
  assert.equal(m.gap, 1.7);
  assert.equal(m.ascending, true);
});

test("the survey used for a year is the latest one in or before it", () => {
  const india = get("IND:consumption");
  assert.equal(surveyAt(india, 1976), null);
  assert.equal(surveyAt(india, 1977).year, 1977);
  assert.equal(surveyAt(india, 2010).year, 2009);
  assert.equal(surveyAt(india, 2021).year, 2011);
  assert.equal(surveyAt(india, 2023).year, 2023);
  assert.equal(surveyAt(india, 2100).year, 2023);
});

/* ---------- series over time ---------- */

test("comparable runs follow the Bank's codes, including runs that interleave", () => {
  const bel = runs(get("BEL:income"));
  assert.deepEqual(bel[0].rows.map((r) => r.year), [1985, 1988, 1992, 1997]);
  assert.deepEqual(bel[1].rows.map((r) => r.year), [1995, 2000]);
  assert.deepEqual(bel.map((r) => r.letter), ["A", "B", "C", "D", "E", "F"]);
  const bra = runs(get("BRA:income"));
  assert.equal(bra.length, 2);
  assert.equal(bra[0].rows.at(-1).year, 2011);
  assert.equal(bra[1].rows[0].year, 2012);
  for (const s of ALL) assert.equal(runs(s).reduce((n, r) => n + r.rows.length, 0), s.rows.length);
  assert.equal(Math.max(...ALL.map((s) => runs(s).length)), 7);
});

test("the trend is the change in the Bank's Gini across the run that holds the survey", () => {
  const { series, row } = at("IND:consumption", 2023);
  assert.deepEqual(trend(series, row), { letter: "F", runs: 6, surveys: 2, first: 2022, last: 2023, from: 25.5, to: 23, change: -2.5 });
  const us = at("USA:income", 2024);
  const t = trend(us.series, us.row);
  assert.deepEqual([t.first, t.last, t.from, t.to, t.change, t.surveys], [2002, 2024, 40.4, 41.8, 1.4, 23]);
  const lone = at("IND:consumption", 2011);
  assert.equal(trend(lone.series, lone.row).surveys, 1);
});

/* ---------- comparing curves ---------- */

test("curves are compared exactly at the nine points: above, below, level, crossing and the same", () => {
  const base = [5, 6, 7, 8, 9, 10, 11, 12, 13, 19];
  const flatter = [6, 7, 8, 9, 10, 10, 11, 12, 12, 15];
  assert.equal(compareCurves(flatter, base).relation, "above");
  assert.equal(compareCurves(base, flatter).relation, "below");
  assert.equal(compareCurves(base, base).relation, "same");
  // The same shares on another scale are the same curve: the comparison is of fractions, not of the stored numbers.
  assert.equal(compareCurves(base, base.map((v) => v * 3)).relation, "same");
  // Ahead for the poorest 10% to 50%, level at 60%, behind from 70%: the curves cross.
  const crossing = [6, 6, 7, 8, 9, 9, 10, 11, 12, 22];
  const c = compareCurves(crossing, base);
  assert.equal(c.relation, "cross");
  assert.deepEqual(c.signs, [1, 1, 1, 1, 1, 0, -1, -1, -1]);
  // Level at the first point and ahead afterwards.
  const level = [5, 7, 7, 8, 9, 10, 11, 12, 13, 18];
  assert.deepEqual(compareCurves(level, base), { relation: "atOrAbove", signs: [0, 1, 1, 1, 1, 1, 1, 1, 1], up: 8, down: 0 });
  assert.equal(compareCurves(base, level).relation, "atOrBelow");
});

test("swapping the two surveys mirrors the verdict for every pair of latest surveys", () => {
  const mirror = { above: "below", below: "above", atOrAbove: "atOrBelow", atOrBelow: "atOrAbove", cross: "cross", same: "same" };
  const latest = ALL.map((s) => s.rows.at(-1));
  let crossings = 0;
  for (let i = 0; i < latest.length; i++) for (let j = i + 1; j < latest.length; j++) {
    const ab = compareCurves(latest[i].shares, latest[j].shares), ba = compareCurves(latest[j].shares, latest[i].shares);
    assert.equal(ba.relation, mirror[ab.relation]);
    if (ab.relation === "cross") crossings++;
    // A curve that is above at all nine points must have the lower ten-share Gini.
    if (ab.relation === "above") assert.ok(giniFromShares(latest[i].shares) < giniFromShares(latest[j].shares));
  }
  assert.equal(crossings, 4576); // of 20,910 pairs
});

/* ---------- the whole snapshot, and the finding ---------- */

test("the ten-share Gini is below the Bank's in every survey, by 0.94 points on average before rounding", () => {
  const g = gapStats();
  assert.equal(g.n, 2515);
  assert.equal(g.below, 2515);
  close(g.mean, 0.935, 0.001);
  // The figures quoted on the page, to two decimals: 0.94, 0.37 and 4.74.
  assert.equal(g.mean.toFixed(2), "0.94");
  assert.deepEqual([g.min.name, g.min.year, g.min.gap.toFixed(2)], ["Sweden", 1981, "0.37"]);
  assert.deepEqual([g.max.name, g.max.year, g.max.gap.toFixed(2)], ["Malawi", 1997, "4.74"]);
  // By hand from the source's figures for Malawi 1997: Gini 0.6576, shares 155, 230, 277, 322, 375, 439, 525, 650, 878, 6148
  // (total 9,999). The running totals 155, 385, 662, 984, 1359, 1798, 2323, 2973, 3851 add up to 14,490, so the ten-share
  // index is 90 - 20 * 14,490 / 9,999 = 61.017 and the gap is 65.76 - 61.017 = 4.743. The page prints 65.8, 61.0 and 4.8.
  const mwi = at("MWI:consumption", 1997);
  assert.equal(mwi.row.gini, 6576);
  assert.deepEqual(mwi.row.shares, [155, 230, 277, 322, 375, 439, 525, 650, 878, 6148]);
  close(100 * giniFromShares(mwi.row.shares), 90 - (20 * 14490) / 9999, 1e-9);
  assert.deepEqual([measures(mwi.row).giniBank, measures(mwi.row).giniShares, measures(mwi.row).gap], [65.8, 61, 4.8]);
  // The sentence "the ten-share figure is X points lower" needs the rounded gap to be above zero too.
  for (const s of ALL) for (const row of s.rows) assert.ok(measures(row).gap >= 0.2, `${s.id} ${row.year}`);
});

test("One finding: where both kinds of survey exist, the income Gini is higher in 62 of 88 country-years, by 3.4 points on average", () => {
  const p = pairedStats();
  assert.equal(p.n, 88);
  assert.equal(p.countries, 19);
  assert.equal(p.incomeHigher, 62);
  assert.equal(p.equal, 0);
  close(p.mean, 3.363, 0.001);
  const poland = p.pairs.find((x) => x.code === "POL" && x.year === 2019);
  assert.deepEqual([poland.income, poland.consumption], [28.76, 30.24]);
  // The countries shown on load: India's index is the lowest of the four and the only one for consumption.
  const load = [["IND:consumption", 23], ["BRA:income", 50.3], ["USA:income", 41.8], ["SWE:income", 29.3]];
  for (const [id, gini] of load) assert.equal(bankGini(get(id).rows.at(-1)), gini);
  assert.equal(get("IND:consumption").last, 2023);
  assert.equal(get("SWE:income").last, 2023);
  assert.ok(load.length === MAX_PICKS);
  // India's latest index is the lowest latest index of any series in the snapshot.
  const lowest = ALL.map((s) => ({ s, g: s.rows.at(-1).gini })).sort((a, b) => a.g - b.g)[0];
  assert.equal(lowest.s.id, "IND:consumption");
});

/* ---------- every sentence the tool can write ---------- */

const JUNK = /NaN|undefined|Infinity|null|–|\s\s|\.\.| ,| \./;

test("every survey's sentences read properly", () => {
  let n = 0;
  for (const series of ALL) for (const row of series.rows) {
    for (const text of [measureText(series, row), sharesText(series, row), giniText(series, row), trendText(series, row)]) {
      n++;
      assert.ok(text.length > 40 && !JUNK.test(text), `${series.id} ${row.year}: ${text}`);
      assert.ok(!/from (\d+\.\d) to \1\b/.test(text), `no change described as a change: ${text}`);
      assert.ok(/[.]$/.test(text));
    }
    assert.ok(!/\b1\.0 points\b/.test(giniText(series, row) + trendText(series, row)));
    assert.ok(!/\b(?!1\.0)\d+\.\d point\b/.test(giniText(series, row) + trendText(series, row)));
  }
  assert.equal(n, 4 * 2515);
});

test("the sentences for one survey say what the numbers say (Brazil 2024)", () => {
  const { series, row } = at("BRA:income", 2024);
  assert.equal(sharesText(series, row), "The poorest half of the population held 17.7% of all income and the richest tenth held 39.3%, more than the poorest half. The poorest tenth held 1.3%, so a person in the richest tenth had on average 29 times the income of a person in the poorest tenth. With equal shares every tenth would hold 10.0%.");
  assert.equal(giniText(series, row), "The Gini index worked out here from the ten shares is 48.8, on a scale from 0 (everyone has the same) to 100 (one person has everything). The Bank's own figure, from the full distribution, is 50.3. The ten-share figure is 1.5 points lower because it treats everyone inside a tenth as having the same income.");
  assert.equal(trendText(series, row), "This survey belongs to a run of 13 surveys, 2012 to 2024, that the Bank treats as comparable with each other (run B of 2 in the table below). Over that run the Bank's Gini index fell from 53.5 to 50.3, a fall of 3.2 points. Surveys in different runs should not be compared, and the chart joins only surveys of one run.");
  assert.match(measureText(series, row), /^This is a survey of income\..*less taxes and contributions.*every person counts once, children included\.$/);
});

test("the special cases have their own sentences", () => {
  // A survey comparable with no other, in a series with several runs.
  const lone = at("IND:consumption", 2011);
  assert.match(trendText(lone.series, lone.row), /^The Bank treats this survey as comparable with no other \(it is run E of 6/);
  // The only survey of its kind for a country.
  const single = ALL.find((s) => s.rows.length === 1);
  assert.match(trendText(single, single.rows[0]), /^This is the only survey of this kind for this country/);
  // One run only: no letters are mentioned.
  const de = at("DEU:income", 2022);
  assert.doesNotMatch(trendText(de.series, de.row), /run [A-Z] of/);
  assert.match(trendText(de.series, de.row), /rose from 29\.3 to 33\.7, a rise of 4\.4 points\.$/);
  // No change to one decimal place between the ends of a run.
  const flat = ALL.flatMap((s) => s.rows.map((row) => ({ s, row }))).find(({ s, row }) => { const t = trend(s, row); return t.surveys > 1 && t.change === 0; });
  if (flat) assert.match(trendText(flat.s, flat.row), /was \d+\.\d at both ends of that run\./);
  // Consumption, urban only, grouped, synthetic, imputed, out of order.
  assert.match(measureText(lone.series, lone.row), /^This is a survey of consumption/);
  const arg = at("ARG:income", 1980);
  assert.match(measureText(arg.series, arg.row), /urban areas only\. The Bank had grouped figures/);
  const chn = at("CHN:consumption", 2022);
  assert.match(measureText(chn.series, chn.row), /labels this distribution synthetic/);
  const nga = at("NGA:consumption", 2015);
  assert.match(measureText(nga.series, nga.row), /labels this distribution imputed/);
  const civ = at("CIV:consumption", 2002);
  assert.match(sharesText(civ.series, civ.row), /not in ascending order/);
  // India's richest tenth holds less than its poorest half.
  const ind = at("IND:consumption", 2023);
  assert.match(sharesText(ind.series, ind.row), /held 34\.4% of all consumption and the richest tenth held 20\.5%, less than the poorest half\. The poorest tenth held 4\.9%, so a person in the richest tenth had on average 4\.2 times the consumption/);
});

test("names that need it take 'the' inside a sentence", () => {
  assert.equal(the("United States"), "the United States");
  assert.equal(the("Brazil"), "Brazil");
  for (const s of ALL) {
    const needs = /Republic|Islands|United|Federation|Kingdom|Emirates|Netherlands|Philippines|Maldives|Comoros|Seychelles|Gambia|Bank/.test(s.name);
    assert.equal(the(s.name).startsWith("the "), needs, s.name);
  }
});

test("comparisons in words: one curve above the other, crossing, mixed measures, one country twice", () => {
  const swe = at("SWE:income", 2023), bra = at("BRA:income", 2024), usa = at("USA:income", 2024), ind = at("IND:consumption", 2023);
  const a = compareText(swe, bra);
  assert.equal(a.relation, "above");
  assert.equal(a.mixed, false);
  assert.equal(a.text, "The curve for Sweden (income, 2023) lies above the curve for Brazil (income, 2024) at all nine points. The Bank's Gini index is 29.3 for Sweden (income, 2023) and 50.3 for Brazil (income, 2024).");
  const b = compareText(bra, usa);
  assert.equal(b.relation, "below");
  assert.equal(b.text, "The curve for the United States (income, 2024) lies above the curve for Brazil (income, 2024) at all nine points. The Bank's Gini index is 50.3 for Brazil (income, 2024) and 41.8 for the United States (income, 2024).");
  const m = compareText(ind, usa);
  assert.equal(m.mixed, true);
  assert.equal(m.text, "The curve for India (consumption, 2023) lies above the curve for the United States (income, 2024) at all nine points. The Bank's Gini index is 23.0 for India (consumption, 2023) and 41.8 for the United States (income, 2024). One is a survey of income and the other of consumption, so the caution about mixed measures applies.");
  assert.equal(mixedText([swe, bra, usa]), "");
  assert.equal(mixedText([ind]), "");
  assert.equal(mixedText([ind, bra, usa, swe]), "The surveys shown are of two kinds: income for Brazil, the United States and Sweden and consumption for India. Where the Bank has both kinds for one country and year, the income index is the higher in 62 of 88 cases, by 3.4 points on average over all 88. Part of any gap between a country measured one way and a country measured the other may therefore be the measure and not the country.");
  const pi = at("POL:income", 2019), pc = at("POL:consumption", 2019);
  const p = compareText(pi, pc);
  assert.equal(p.relation, "cross");
  // By hand: the poorest 20% hold 862 of 9,999 in the income survey (8.62%) and 876 of 10,001 in the consumption survey (8.76%);
  // the poorest 30% hold 1,499 of 9,999 (14.99%) against 1,479 of 10,001 (14.79%).
  assert.deepEqual(p.signs, [-1, -1, 1, 1, 1, 1, 1, 1, 1]);
  assert.match(mixedText([pi, pc]), /^The surveys shown are of two kinds: income for Poland and consumption for Poland\./);
  assert.ok(COMPARE_NOTE.length > 100 && !JUNK.test(COMPARE_NOTE));
  assert.match(p.text, /^In Poland, the curves for the income survey of 2019 and the consumption survey of 2019 cross: the poorest 30%, 40%, 50%, 60%, 70%, 80% and 90% of people each hold a larger share of the total in the income survey, and the poorest 10% and 20% of people each hold a larger share of the total in the consumption survey\. The Bank's Gini index is 28\.8 for the income survey of 2019 and 30\.2 for the consumption survey of 2019\. These are two surveys of one country in one year, one of income and one of consumption, so the gap between them shows what the choice of measure does\.$/);
  // The latest surveys of the two kinds are four years apart, and the sentence must not put the whole gap down to the measure.
  const late = compareText({ series: pi.series, row: pi.series.rows.at(-1) }, { series: pc.series, row: pc.series.rows.at(-1) });
  assert.match(late.text, /^In Poland, the .*the income survey of 2023 and the consumption survey of 2019.*taken in different years, so the gap between them mixes the choice of measure with the passage of time\.$/);
});

test("comparisons in words: ties, identical curves, and a Bank index that disagrees with the ten shares", () => {
  const mk = (name, code, shares, gini, welfare = "income") => ({ series: { name, code, welfare }, row: { year: 2020, gini, shares } });
  const base = [5, 6, 7, 8, 9, 10, 11, 12, 13, 19];
  const level = [5, 7, 7, 8, 9, 10, 11, 12, 13, 18];
  const tie = compareText(mk("Aland", "AAA", level, 2500), mk("Borduria", "BBB", base, 2700));
  assert.match(tie.text, /^The curve for Aland \(income, 2020\) is level with or above the curve for Borduria \(income, 2020\) at all nine points, and above it at 8 of them\. The Bank's Gini index is 25\.0 for Aland \(income, 2020\) and 27\.0 for Borduria \(income, 2020\)\.$/);
  const same = compareText(mk("Aland", "AAA", base, 2500), mk("Borduria", "BBB", base, 2500));
  assert.equal(same.text, "The curves for Aland (income, 2020) and Borduria (income, 2020) are the same at all nine points. The Bank's Gini index is 25.0 for both.");
  // Above at every point, yet the Bank's index is higher: the page must say so and not call it the more equal without comment.
  const odd = compareText(mk("Aland", "AAA", [6, 7, 8, 9, 10, 10, 11, 12, 12, 15], 3000), mk("Borduria", "BBB", base, 2900));
  assert.match(odd.text, /The Bank's Gini index does not show Aland as the more equal, because it also counts the inequality inside each tenth/);
  // No pair of surveys in the snapshot reads badly.
  const latest = ALL.map((series) => ({ series, row: series.rows.at(-1) }));
  for (let i = 0; i < latest.length; i += 3) for (let j = i + 1; j < latest.length; j += 5) {
    const t = compareText(latest[i], latest[j]).text;
    assert.ok(!JUNK.test(t) && /\.$/.test(t), t);
  }
});

/* ---------- found in review ---------- */

test("the ten-share Gini is rounded exactly: a figure of exactly 33.05 prints as 33.1, as the Bank's own index would", () => {
  // Canada 2007. Shares 273, 446, 563, 668, 772, 891, 1034, 1227, 1521, 2605 add up to 10,000. The first nine running
  // totals (273, 719, 1282, 1950, 2722, 3613, 4647, 5874, 7395) add up to 28,475, so 100 G = 90 - 20 * 28,475 / 10,000
  // = 90 - 56.95 = 33.05 exactly. Floating point makes it 33.04999..., which used to print as 33.0.
  const can = at("CAN:income", 2007).row;
  assert.deepEqual(can.shares, [273, 446, 563, 668, 772, 891, 1034, 1227, 1521, 2605]);
  assert.ok(100 * giniFromShares(can.shares) < 33.05, "the floating-point route lands a hair below the tie");
  assert.equal(giniSharesRounded(can.shares), 33.1);
  assert.equal(measures(can).giniShares, 33.1);
  assert.equal(measures(can).giniBank, 33.8);       // 0.3384
  assert.equal(measures(can).gap, 0.7);
  // Hand cases: shares 1 to 10 give exactly 30.0, the uniform case 33.0, equal shares 0.0; bad input is refused.
  assert.equal(giniSharesRounded([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 30);
  assert.equal(giniSharesRounded([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]), 33);
  assert.equal(giniSharesRounded(Array(10).fill(4)), 0);
  assert.equal(giniSharesRounded([0, 0, 0, 0, 0, 0, 0, 0, 0, 5]), 90);
  assert.ok(Number.isNaN(giniSharesRounded([1, 2, 3])));
  // Shares that are not whole numbers fall back to ordinary rounding.
  assert.equal(giniSharesRounded([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]), 30);
  // In every survey the printed figure is within 0.05 of the unrounded one. 25 surveys are exact ties and each goes up;
  // rounding the floating-point figure sent 11 of them down. No other survey's printed figure changes.
  let ties = 0, wasWrong = 0;
  for (const s of ALL) for (const row of s.rows) {
    const shown = giniSharesRounded(row.shares), raw = 100 * giniFromShares(row.shares);
    assert.ok(Math.abs(shown - raw) <= 0.05 + 1e-9, `${s.id} ${row.year}`);
    if (Math.round(raw * 10) / 10 !== shown) wasWrong++;
    const total = row.shares.reduce((a, b) => a + b, 0);
    let run = 0, runs = 0;
    row.shares.slice(0, 9).forEach((v) => { run += v; runs += run; });
    // 1000 G = (900 T - 200 S) / T: a tie is a remainder of exactly half of T.
    if ((2 * (900 * total - 200 * runs)) % (2 * total) === total) { ties++; assert.ok(shown > raw, `${s.id} ${row.year} is a tie and must round up`); }
  }
  assert.equal(ties, 25);
  assert.equal(wasWrong, 11);
});

test("a country on screen twice is never confused with itself, and a name with a comma is not read as two places", () => {
  // Poland and Romania, each surveyed both ways in 2019: four curves and six comparisons. Without the kind of survey the
  // list held "Poland (2019) lies above Romania (2019)" and "Romania (2019) lies above Poland (2019)" together.
  const four = [at("POL:income", 2019), at("POL:consumption", 2019), at("ROU:income", 2019), at("ROU:consumption", 2019)];
  const texts = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) texts.push(compareText(four[i], four[j]).text);
  assert.equal(new Set(texts.map((t) => t.split(". ")[0])).size, 6);
  assert.match(texts[0], /^In Poland, the curves for the income survey of 2019 and the consumption survey of 2019 cross/);
  assert.match(texts[5], /^In Romania, the curve for the consumption survey of 2019 lies above the curve for the income survey of 2019 at all nine points\./);
  assert.match(texts[1], /^The curve for Poland \(income, 2019\) lies above the curve for Romania \(income, 2019\)/);
  assert.match(texts[2], /^The curve for Romania \(consumption, 2019\) lies above the curve for Poland \(income, 2019\)/);
  for (const t of texts.slice(1, 5)) assert.match(t, /\((income|consumption), 2019\).*\((income|consumption), 2019\)/);
  // Argentina's surveys cover urban areas only, and the comparison says so.
  assert.match(compareText(at("ARG:income", 2024), at("BRA:income", 2024)).text, /Argentina \(income, urban, 2024\)/);
  // "Taiwan, China" in a list of names is set off with semicolons.
  const twn = { series: get("TWN:income"), row: get("TWN:income").rows.at(-1) };
  const usa = at("USA:income", 2024), ind = at("IND:consumption", 2023);
  assert.match(mixedText([twn, usa, ind]), /income for Taiwan, China; and the United States and consumption for India\./);
  assert.match(mixedText([usa, twn, at("SWE:income", 2023), ind]), /income for the United States; Taiwan, China; and Sweden and consumption for India\./);
  assert.match(mixedText([usa, ind]), /income for the United States and consumption for India\./);
});
