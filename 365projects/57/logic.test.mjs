import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { MACRO } from "../data/macro.js";
import { MIN_YEARS, MAX_BREAKS, WINDOW, tCdf, t975, at, seriesFor, rowsFor, crossing, fitLine, parseBreaks, erasFrom, fitEras, rolling, describe, steadyWords, unboundedWords, unboundedCell, years, inSentence, s2, listOf, extremeYears, EXTREME } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const by = Object.fromEntries(MACRO.countries.map((c) => [c.iso3, c]));
const FIRST = MACRO.first, LAST = MACRO.last;
/** The eras of a country under a list of breaks, fitted. */
const eras = (iso, version, breaks) => { const rows = rowsFor(by[iso], version); return fitEras(rows, erasFrom(rows[0].year, rows.at(-1).year, breaks).eras); };

test("Student's t: the 97.5th percentile matches the printed tables", () => {
  for (const [df, value] of [[1, 12.706], [2, 4.303], [6, 2.447], [8, 2.306], [13, 2.16], [21, 2.08], [60, 2.0]]) close(t975(df), value, 6e-4);
  close(t975(1e6), 1.96, 1e-4);
  close(tCdf(0, 5), 0.5, 1e-12);
  close(tCdf(2.571, 5), 0.975, 1e-4);
  assert.ok(Number.isNaN(t975(0)));
});

test("rows: inflation, or its change from the year before, against unemployment", () => {
  const c = { iso3: "X", name: "X", p: [2000, [2, 5, 4, null, 3]], uOecd: [2001, [6, 7, 8, 9]], uIlo: [1991, [1]] };
  const simple = rowsFor(c, "simple");
  assert.deepEqual(simple.map((r) => [r.year, r.x, r.y]), [[2001, 6, 5], [2002, 7, 4], [2004, 9, 3]]);
  // The change needs the year before as well: 2004 has no 2003 figure, so it drops out and nothing is filled in.
  assert.deepEqual(rowsFor(c, "augmented").map((r) => [r.year, r.x, r.y]), [[2001, 6, 3], [2002, 7, -1]]);
  // One series per country: the OECD's where it exists, otherwise the modelled ILO series.
  assert.equal(seriesFor(c).key, "uOecd");
  assert.equal(seriesFor({ uOecd: null, uIlo: [1991, [1]] }).key, "uIlo");
  assert.equal(seriesFor({ uOecd: null, uIlo: null }), null);
  assert.deepEqual(rowsFor({ p: null, uOecd: [2000, [1]] }), []);
  assert.equal(seriesFor(by.USA).key, "uOecd");
  assert.equal(seriesFor(by.IND).key, "uIlo");
  assert.equal(rowsFor(by.IND)[0].year, 1991);
});

test("the fitted line: a case by hand, and agreement with the kit", () => {
  // (1, 1), (2, 3), (3, 2): slope 0.5, intercept 1, s2 = 1.5, se = sqrt(0.75), R2 = 0.25, one degree of freedom.
  const f = fitLine([{ year: 1, x: 1, y: 1 }, { year: 2, x: 2, y: 3 }, { year: 3, x: 3, y: 2 }]);
  close(f.b, 0.5); close(f.a, 1); close(f.s2, 1.5); close(f.se, Math.sqrt(0.75)); close(f.r2, 0.25);
  close(f.hi, 0.5 + 12.7062047 * Math.sqrt(0.75), 1e-5);
  assert.deepEqual(f.years, [1, 3]); assert.deepEqual(f.xRange, [1, 3]);
  const r = rng(4), rows = Array.from({ length: 25 }, (_, i) => { const x = r.uniform(3, 9); return { year: 1990 + i, x, y: 8 - 0.9 * x + r.normal(0, 0.7) }; });
  const mine = fitLine(rows), kit = stats.linreg(rows.map((p) => p.x), rows.map((p) => p.y));
  close(mine.b, kit.slope, 1e-12); close(mine.a, kit.intercept, 1e-12); close(mine.se, kit.seSlope, 1e-12); close(mine.r2, kit.r2, 1e-12);
  // Too few points, or the same unemployment rate every year: no line. Inflation that never moves: no R2.
  assert.equal(fitLine(rows.slice(0, 2)), null);
  assert.equal(fitLine([1, 2, 3, 4].map((y, i) => ({ year: i, x: 5, y }))), null);
  assert.equal(fitLine([1, 2, 3, 4].map((x, i) => ({ year: i, x, y: 2 }))).r2, null);
});

test("the steady-inflation rate: where the line crosses zero, with an interval that can be unbounded", () => {
  const r = rng(9), rows = Array.from({ length: 30 }, (_, i) => { const x = r.uniform(3, 10); return { year: i, x, y: 3 - 0.5 * x + r.normal(0, 0.5) }; });
  const f = fitLine(rows), st = f.steady;
  close(st.value, -f.a / f.b, 1e-12);
  close(st.value, 6, 0.5);
  assert.ok(st.bounded && st.lo < st.value && st.value < st.hi);
  // The ends are where the line's 95% band just touches zero.
  const band = (x) => Math.abs(f.a + f.b * x) - f.t * Math.sqrt(f.s2 * (1 / f.n + (x - f.xbar) ** 2 / f.sxx));
  close(band(st.lo), 0, 1e-9); close(band(st.hi), 0, 1e-9);
  assert.ok(band(st.value) < 0 && band(st.lo - 0.2) > 0 && band(st.hi + 0.2) > 0);
  // A zigzag with no slope to speak of: the interval does not exist.
  const flat = fitLine([0.3, -0.4, 0.5, -0.5, 0.4, -0.2, 0.1, -0.3].map((y, i) => ({ year: i, x: i + 3, y })));
  assert.ok(flat.lo < 0 && flat.hi > 0);
  assert.equal(flat.steady.bounded, false);
  assert.equal(crossing({ xbar: 5, ybar: 0, b: -1, s2: 0, n: 5, sxx: 10, t: 3 }).lo, 5);
});

test("era breaks typed by the visitor: accepted, or refused with what to fix", () => {
  assert.deepEqual(parseBreaks("1970, 1985 2008", FIRST, LAST), { breaks: [1970, 1985, 2008] });
  assert.deepEqual(parseBreaks("2008;1970,,1985", FIRST, LAST), { breaks: [1970, 1985, 2008] });
  assert.deepEqual(parseBreaks("", FIRST, LAST), { breaks: [] });
  assert.deepEqual(parseBreaks("   ", FIRST, LAST), { breaks: [] });
  assert.deepEqual(parseBreaks(null, FIRST, LAST), { breaks: [] });
  assert.match(parseBreaks("the seventies", FIRST, LAST).error, /"the" is not a year\. Type four-digit years/);
  assert.match(parseBreaks("1970.5", FIRST, LAST).error, /is not a year/);
  assert.match(parseBreaks("-1970", FIRST, LAST).error, /is not a year/);
  assert.match(parseBreaks("1e3", FIRST, LAST).error, /is not a year/);
  assert.match(parseBreaks("19700", FIRST, LAST).error, /is not a year/);
  assert.match(parseBreaks("1960", FIRST, LAST).error, /1960 is outside the data\. A break must be a year from 1961 to 2025\./);
  assert.match(parseBreaks("2026", FIRST, LAST).error, /2026 is outside the data/);
  assert.match(parseBreaks("1970, 1970", FIRST, LAST).error, /1970 is listed twice/);
  assert.match(parseBreaks("1965 1970 1975 1980 1985 1990 1995 2000", FIRST, LAST).error, /That is 8 breaks.*list 7 years or fewer/);
  assert.equal(parseBreaks("1965 1970 1975 1980 1985 1990 1995", FIRST, LAST).breaks.length, MAX_BREAKS);
  assert.match(parseBreaks("9".repeat(300), FIRST, LAST).error, /too long/);
  assert.match(parseBreaks("x".repeat(120), FIRST, LAST).error, /^"xxxxxxxxxxxxxxxxxxxx" is not a year/);
});

test("eras: the years split at the breaks, with breaks outside the country's data set aside", () => {
  assert.deepEqual(erasFrom(1960, 2024, [1970, 1985, 2008]), { eras: [[1960, 1969], [1970, 1984], [1985, 2007], [2008, 2024]], ignored: [] });
  assert.deepEqual(erasFrom(1960, 2024, []), { eras: [[1960, 2024]], ignored: [] });
  // Germany's data start in 1992: breaks in 1970 and 1985 would make empty eras.
  assert.deepEqual(erasFrom(1992, 2025, [1970, 1985, 2008]), { eras: [[1992, 2007], [2008, 2025]], ignored: [1970, 1985] });
  assert.deepEqual(erasFrom(1992, 2025, [1992, 2025]), { eras: [[1992, 2024], [2025, 2025]], ignored: [1992] });
  // An era shorter than the minimum gets no line, and the rows are still reported.
  const short = fitEras(rowsFor(by.USA, "simple"), [[2020, 2024], [1960, 1967]]);
  assert.equal(short[0].fit, null); assert.equal(short[0].rows.length, 5);
  assert.equal(short[1].fit.n, MIN_YEARS);
});

test("rolling regression: each window is the plain fit of its own years", () => {
  const rows = rowsFor(by.USA, "simple");
  const roll = rolling(rows, 15);
  assert.equal(roll.length, rows.length - 14);
  assert.deepEqual([roll[0].start, roll[0].end], [1960, 1974]);
  assert.equal(roll.at(-1).end, 2024);
  for (const w of [roll[0], roll[20], roll.at(-1)]) {
    const own = fitLine(rows.filter((r) => r.year >= w.start && r.year <= w.end));
    assert.equal(own.n, 15);
    close(w.fit.b, own.b, 1e-12); close(w.fit.lo, own.lo, 1e-12);
  }
  // A window that would span a missing year is skipped, not shortened.
  const gappy = rows.filter((r) => r.year !== 1990);
  const g = rolling(gappy, 10);
  assert.ok(g.every((w) => w.end < 1990 || w.start > 1990));
  assert.equal(g.length, rows.length - 9 - 10);
  assert.deepEqual(rolling(rows.slice(0, 5), 8), []);
  assert.deepEqual(rolling([], 8), []);
  assert.ok(WINDOW.min >= 3 && WINDOW.start >= WINDOW.min && WINDOW.start <= WINDOW.max);
});

test("the data: values against the sources' own figures", () => {
  // World Bank API, FP.CPI.TOTL.ZG (database last updated 2026-10-08).
  close(at(by.JPN.p, 1974), 23.2222458076842, 0.005);
  close(at(by.GBR.p, 1975), 24.2072876743291, 0.005);
  close(at(by.USA.p, 1965), 1.58516926383662, 0.005);
  close(at(by.USA.p, 2022), 8.00279982052121, 0.005);
  // The World Bank had no 2025 inflation figure for the United States on the day of retrieval.
  assert.equal(at(by.USA.p, 2025), null);
  assert.equal(rowsFor(by.USA).at(-1).year, 2024);
  // OECD Economic Outlook 119, UNR.
  close(at(by.USA.uOecd, 1969), 3.50680099663281, 0.0005);
  close(at(by.DEU.uOecd, 1992), 6.57709832644892, 0.0005);
  close(at(by.ESP.uOecd, 2013), 26.0935419709898, 0.0005);
  close(at(by.FRA.uOecd, 2025), 7.67983153004058, 0.0005);
  // World Bank API, SL.UEM.TOTL.ZS.
  assert.equal(at(by.IND.uIlo, 2019), 6.51);
  assert.equal(at(by.BRA.uIlo, 2015), 8.538);
  assert.equal(at(by.USA.uOecd, 2026), null);
});

test("the finding on the page: the United States, with breaks at 1970, 1985 and 2008", () => {
  const simple = eras("USA", "simple", [1970, 1985, 2008]);
  assert.deepEqual(simple.map((e) => [e.from, e.to, e.fit.n]), [[1960, 1969, 10], [1970, 1984, 15], [1985, 2007, 23], [2008, 2024, 17]]);
  const s60 = simple[0].fit, s70 = simple[1].fit;
  assert.equal(s60.b.toFixed(2), "-1.16"); assert.equal(s60.lo.toFixed(2), "-1.78"); assert.equal(s60.hi.toFixed(2), "-0.55");
  assert.equal(s60.r2.toFixed(2), "0.71");
  assert.equal(s70.b.toFixed(2), "-0.21"); assert.equal(s70.lo.toFixed(2), "-1.43"); assert.equal(s70.hi.toFixed(2), "1.02");
  assert.equal(s70.r2.toFixed(2), "0.01");
  const aug = eras("USA", "augmented", [1970, 1985, 2008]);
  const a70 = aug[1].fit, a08 = aug[3].fit;
  assert.equal(a70.b.toFixed(2), "-1.24"); assert.equal(a70.lo.toFixed(2), "-2.04"); assert.equal(a70.hi.toFixed(2), "-0.45");
  assert.equal(a70.steady.value.toFixed(1), "6.9"); assert.equal(a70.steady.lo.toFixed(1), "5.6"); assert.equal(a70.steady.hi.toFixed(1), "8.0");
  assert.equal(a08.b.toFixed(2), "-0.08"); assert.equal(a08.lo.toFixed(2), "-0.62"); assert.equal(a08.hi.toFixed(2), "0.46");
  assert.equal(a08.steady.bounded, false);
  // The moving window: the 15 years ending in 1987 against the 15 ending in 2019.
  const roll = rolling(rowsFor(by.USA, "augmented"), 15);
  assert.equal(roll.find((w) => w.end === 1987).fit.b.toFixed(2), "-1.71");
  assert.equal(roll.find((w) => w.end === 2019).fit.b.toFixed(2), "-0.10");
});

test("the interval for the steady-inflation rate against a search written separately: bounded, every rate, or all but one range", () => {
  // The reviewer's own check (Python, numpy least squares): scan unemployment rates from -200 to 200 and keep those at
  // which the fitted line's 95% band includes zero. United States, change in inflation, breaks at 1970, 1985 and 2008.
  const [a61, a70, a85, a08] = eras("USA", "augmented", [1970, 1985, 2008]).map((e) => e.fit);
  // Bounded: 1961 to 1969 is 4.758 to 9.921 around 5.614; 1970 to 1984 is 5.584 to 8.041 around 6.854.
  close(a61.steady.value, 5.614, 0.001); close(a61.steady.lo, 4.758, 0.002); close(a61.steady.hi, 9.921, 0.002);
  close(a70.steady.value, 6.854, 0.001); close(a70.steady.lo, 5.584, 0.002); close(a70.steady.hi, 8.041, 0.002);
  // 1985 to 2007: slope -0.36 (-0.72 to +0.0017). The band misses zero only between 8.40% and 40.93%.
  assert.deepEqual([a85.steady.bounded, a85.steady.all], [false, false]);
  close(a85.steady.gap[0], 8.4, 0.006); close(a85.steady.gap[1], 40.93, 0.006);
  assert.match(steadyWords(a85), /the 95% interval for that rate is unbounded in both directions and rules out only rates between 8\.4% and 40\.9%\.$/);
  assert.equal(unboundedCell(a85.steady), "cannot be pinned down: only 8.4% to 40.9% is ruled out");
  // 2008 to 2024: the band includes zero at every rate.
  assert.deepEqual([a08.steady.bounded, a08.steady.all, a08.steady.gap], [false, true, null]);
  assert.equal(unboundedCell(a08.steady), "cannot be pinned down: no rate is ruled out");
  const band = (f, x) => Math.abs(f.a + f.b * x) - f.t * Math.sqrt(f.s2 * (1 / f.n + (x - f.xbar) ** 2 / f.sxx));
  assert.ok(band(a85, 20) > 0 && band(a85, 8) < 0 && band(a85, 45) < 0 && band(a85, -1e6) < 0 && band(a85, 1e6) < 0);
  for (const x of [-1e6, 0, 6, 100, 1e6]) assert.ok(band(a08, x) < 0);
  // The United Kingdom, 1980 to 1992: bounded but very wide, -22.0% to 11.1% around 8.9%.
  const gbr = eras("GBR", "augmented", [1980, 1993])[1].fit.steady;
  assert.ok(gbr.bounded); close(gbr.value, 8.902, 0.001); close(gbr.lo, -22.003, 0.002); close(gbr.hi, 11.092, 0.002);
  assert.equal(unboundedWords({ bounded: false, all: false, gap: null }), "the 95% interval for that rate is unbounded");
});

test("the modelled ILO series stops in 2024: the ILO's projection for 2025 is not used", () => {
  assert.equal(MACRO.lastIlo, 2024);
  assert.equal(at(by.IND.uIlo, 2024), 4.173); assert.equal(at(by.IND.uIlo, 2025), null);
  // India has an inflation figure for 2025, but no estimate of unemployment, so its last year is 2024.
  assert.ok(at(by.IND.p, 2025) != null);
  assert.equal(rowsFor(by.IND).at(-1).year, 2024);
  assert.deepEqual([seriesFor(by.IND).label, seriesFor(by.IND).short], ["modelled ILO estimates (World Bank)", "modelled ILO estimates"]);
  assert.deepEqual([seriesFor(by.USA).label, seriesFor(by.USA).short], ["OECD Economic Outlook 119", "OECD series"]);
  // Recomputed separately: India 1991 to 2007 slope +5.04 (-41.07 to +51.15); 2008 to 2024 has 17 years.
  const [early, late] = eras("IND", "simple", [2008]);
  assert.equal(early.fit.b.toFixed(2), "5.04"); assert.equal(early.fit.lo.toFixed(2), "-41.07"); assert.equal(early.fit.hi.toFixed(2), "51.15");
  assert.deepEqual([late.from, late.to, late.fit.n], [2008, 2024, 17]);
  // Countries on the OECD series keep 2025 where both figures exist (Germany, Japan).
  assert.equal(rowsFor(by.DEU).at(-1).year, 2025);
});

test("the 1960s line for the United States recomputed with separately written code", () => {
  const xs = [], ys = [];
  for (let year = 1960; year <= 1969; year++) { xs.push(by.USA.uOecd[1][year - by.USA.uOecd[0]]); ys.push(by.USA.p[1][year - by.USA.p[0]]); }
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  const b = sxy / sxx, se = Math.sqrt((syy - b * sxy) / (n - 2) / sxx);
  const f = eras("USA", "simple", [1970])[0].fit;
  close(f.b, b, 1e-12);
  // Student's t with 8 degrees of freedom: 2.306 in the printed tables.
  close(f.lo, b - 2.306 * se, 2e-4); close(f.hi, b + 2.306 * se, 2e-4);
  close(f.r2, (sxy * sxy) / (sxx * syy), 1e-12);
});

test("every sentence the tool can write about an era", () => {
  const who = "the United States";
  const [s60, s70] = eras("USA", "simple", [1970, 1985, 2008]);
  const d60 = describe(s60, { who });
  assert.equal(d60, "In the United States over the 10 years with data from 1960 to 1969, the fitted slope is -1.16 points of inflation per point of unemployment (95% interval -1.78 to -0.55). Years with unemployment one point higher had inflation 1.16 points lower: the downward curve Phillips drew. Unemployment accounts for 71% of the year-to-year variation in inflation.");
  assert.match(describe(s70, { who }), /\(95% interval -1\.43 to \+1\.02\)\. The interval includes zero: these years show no reliable link in either direction\./);
  const [, a70, , a08] = eras("USA", "augmented", [1970, 1985, 2008]);
  const d70 = describe(a70, { who, version: "augmented" });
  assert.match(d70, /points of the change in inflation per point of unemployment/);
  assert.match(d70, /inflation fell by 1\.24 points more, or rose by that much less, than the year before\./);
  assert.match(d70, /The line crosses zero at an unemployment rate of 6\.9% \(95% interval 5\.6% to 8\.0%\): the rate at which, on this line, inflation neither rises nor falls\.$/);
  // No rate is quoted when the interval is unbounded: for Japan in 1985 to 2007 the crossing is at minus 1%.
  assert.match(describe(a08, { who, version: "augmented" }), /The slope is too uncertain for the line to imply an unemployment rate at which inflation is steady: the 95% interval for that rate is unbounded and takes in every rate\.$/);
  assert.doesNotMatch(describe(eras("JPN", "augmented", [1970, 1985, 2008])[2], { who: "Japan", version: "augmented" }), /crosses zero/);
  // An upward slope, in both versions.
  const up = { from: 2000, to: 2009, rows: Array.from({ length: 10 }, (_, i) => ({ year: 2000 + i, x: 4 + i, y: 1 + 0.5 * i + (i % 2 ? 0.1 : -0.1) })) };
  up.fit = fitLine(up.rows);
  assert.match(describe(up, { who: "Upland" }), /Years with higher unemployment had higher inflation: the opposite of the curve Phillips drew\./);
  assert.match(describe(up, { who: "Upland", version: "augmented" }), /inflation rose by more: the opposite of what the expectations-augmented curve predicts\..*Because the line does not slope downwards, it implies no unemployment rate at which inflation is steady\.$/);
  assert.match(steadyWords(up.fit), /does not slope downwards/);
  // Eras with too little data say how much there is and what to do.
  assert.equal(describe({ from: 2020, to: 2024, rows: [1, 2, 3, 4, 5], fit: null }, { who }), "2020 to 2024 has only 5 years of data for the United States, and a line needs at least 8. Move a break to make the era longer.");
  assert.match(describe({ from: 2024, to: 2024, rows: [1], fit: null }, { who }), /^2024 has only 1 year of data/);
  assert.equal(describe({ from: 1960, to: 1969, rows: [], fit: null }, { who: "Germany" }), "Germany has no year with both figures in 1960 to 1969.");
  assert.match(describe({ from: 1960, to: 1969, rows: Array(9).fill({}), fit: null }, { who: "Flatland" }), /^Unemployment was the same in every year of 1960 to 1969 in Flatland/);
  assert.equal(years(1999, 1999), "1999");
  assert.equal(listOf([1970]), "1970"); assert.equal(listOf([1970, 1985]), "1970 and 1985"); assert.equal(listOf([1970, 1985, 2008]), "1970, 1985 and 2008"); assert.equal(listOf([]), "");
  // Brazil: inflation fell from 2,076% in 1994 to 66% in 1995 and to 16% in 1996, which is the whole of the 1995 to 2007 line.
  assert.equal(EXTREME, 50);
  assert.deepEqual(extremeYears(rowsFor(by.BRA, "augmented")), [1995, 1996]);
  assert.deepEqual(extremeYears(rowsFor(by.BRA, "simple")), [1995]);
  assert.deepEqual(extremeYears(rowsFor(by.USA, "simple")), []);
  assert.equal(s2(-0.0011), "-0.0011"); assert.equal(s2(0), "0.00"); assert.equal(s2(0.25), "+0.25");
  assert.equal(inSentence("Netherlands"), "the Netherlands"); assert.equal(inSentence("Japan"), "Japan");
  assert.equal(describe({ from: 1960, to: 1969, rows: [], fit: null }, { who: "the Netherlands" }), "The Netherlands has no year with both figures in 1960 to 1969.");
  for (const s of [d60, d70, describe(up, { who: "Upland" })]) assert.doesNotMatch(s, /NaN|undefined|Infinity|null/);
});

test("every country offered has a line to draw", () => {
  const usable = MACRO.countries.filter((c) => rowsFor(c).length >= MIN_YEARS);
  assert.equal(usable.length, 173);
  for (const c of usable) {
    for (const version of ["simple", "augmented"]) {
      const rows = rowsFor(c, version);
      if (rows.length < MIN_YEARS) continue;
      const f = fitLine(rows);
      assert.ok(f && Number.isFinite(f.b) && Number.isFinite(f.lo) && Number.isFinite(f.hi), `${c.name} ${version}`);
      for (const w of rolling(rows, WINDOW.start)) assert.ok(Number.isFinite(w.fit.b) && Number.isFinite(w.fit.lo), `${c.name} rolling`);
    }
  }
});

test("claims in the write-up that rest on the data", () => {
  // "The simple curve fits the United States since 2008 no worse than the augmented one": 20% of the variation against 1%.
  const simple = eras("USA", "simple", [1970, 1985, 2008])[3].fit, aug = eras("USA", "augmented", [1970, 1985, 2008])[3].fit;
  assert.equal(simple.r2.toFixed(2), "0.20"); assert.equal(aug.r2.toFixed(2), "0.01");
  assert.ok(simple.r2 >= aug.r2);
  // "2.31 for a ten-year era": Student's t with 8 degrees of freedom.
  assert.equal(t975(8).toFixed(2), "2.31");
  // "In the United States and in 172 other countries."
  assert.equal(MACRO.countries.filter((c) => rowsFor(c).length >= MIN_YEARS).length, 173);
});
