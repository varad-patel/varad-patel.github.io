import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { MACRO } from "../data/macro.js";
import { SERIES, MIN_YEARS, PERIODS, tCdf, t975, at, hpTrend, observations, inWindow, crossing, fitPanel, fitCountry, analyse, furthest, describe, steadyWords, unboundedWords, unboundedCell, span, inSentence, missWords, s2 } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const by = Object.fromEntries(MACRO.countries.map((c) => [c.iso3, c]));
const G7 = ["USA", "GBR", "FRA", "DEU", "ITA", "JPN", "CAN"].map((k) => by[k]);
/** A made-up country: [first year, values] series, as in the data module. */
const country = (name, g, u, first = 2000) => ({ iso3: name, name, g: [first + 1, g], uOecd: [first, u], uIlo: null });

test("Student's t: the 97.5th percentile matches the printed tables", () => {
  // Values from standard t tables (for example NIST/SEMATECH e-Handbook, table 1.3.6.7.2).
  for (const [df, value] of [[1, 12.706], [2, 4.303], [5, 2.571], [7, 2.365], [10, 2.228], [30, 2.042], [60, 2.0], [120, 1.98]]) close(t975(df), value, 6e-4);
  close(t975(1e6), 1.96, 1e-4);
  close(tCdf(0, 9), 0.5, 1e-12);
  close(tCdf(-2.262, 9) + tCdf(2.262, 9), 1, 1e-12);
  close(tCdf(2.262, 9), 0.975, 1e-4);
  assert.ok(Number.isNaN(t975(0)));
});

test("Hodrick-Prescott trend: a hand-computed case and the two limits", () => {
  // n = 3, lambda = 1: A = I + kk' with k = (1, -2, 1), so A^-1 = I - kk'/7 and the trend of (0, 1, 0) is (2/7, 3/7, 2/7).
  const t = hpTrend([0, 1, 0], 1);
  close(t[0], 2 / 7, 1e-12); close(t[1], 3 / 7, 1e-12); close(t[2], 2 / 7, 1e-12);
  // A straight line has no second differences, so it is its own trend whatever lambda is.
  const line = Array.from({ length: 20 }, (_, i) => 3 + 0.5 * i);
  hpTrend(line, 100).forEach((v, i) => close(v, line[i], 1e-8));
  // lambda = 0 returns the series; a very large lambda returns the least-squares line.
  const r = rng(3), y = Array.from({ length: 30 }, (_, i) => 0.2 * i + r.normal(0, 1));
  hpTrend(y, 0).forEach((v, i) => close(v, y[i], 1e-12));
  const ols = stats.linreg(y.map((_, i) => i), y);
  hpTrend(y, 1e9).forEach((v, i) => close(v, ols.intercept + ols.slope * i, 1e-4));
  // The gaps from an HP trend always add up to zero.
  close(stats.sum(hpTrend(y, 100).map((v, i) => y[i] - v)), 0, 1e-9);
  assert.deepEqual(hpTrend([1, 2], 100), [1, 2]);
});

test("the trend minimises the Hodrick-Prescott criterion: no nearby series does better", () => {
  const r = rng(11), y = Array.from({ length: 25 }, () => r.normal(5, 2)), lambda = 100;
  const cost = (t) => stats.sum(t.map((v, i) => (y[i] - v) ** 2)) + lambda * stats.sum(t.slice(2).map((v, i) => (v - 2 * t[i + 1] + t[i]) ** 2));
  const best = hpTrend(y, lambda), c0 = cost(best);
  for (let k = 0; k < 200; k++) assert.ok(cost(best.map((v) => v + r.normal(0, 0.05))) > c0);
});

test("observations, change version: growth against the change in the unemployment rate, by hand", () => {
  const c = country("X", [2, -1, 3], [5, 4.5, 6, 5.2]);
  const rows = observations(c, { series: "oecd", version: "change" });
  assert.deepEqual(rows.map((r) => r.year), [2001, 2002, 2003]);
  assert.deepEqual(rows.map((r) => r.x), [2, -1, 3]);
  close(rows[0].y, -0.5); close(rows[1].y, 1.5); close(rows[2].y, -0.8);
  // A gap in either series drops the years that need it, and nothing is filled in.
  const gappy = country("Y", [2, null, 3, 1], [5, 4.5, 6, null, 5]);
  assert.deepEqual(observations(gappy, { series: "oecd" }).map((r) => r.year), [2001]);
  // A country without the chosen series has no observations.
  assert.deepEqual(observations(c, { series: "ilo" }), []);
  assert.deepEqual(inWindow(rows, 2002, 2003, [2003]).map((r) => r.year), [2002]);
});

test("observations, gap version: steady growth and steady unemployment leave no gaps, and gaps add up to zero", () => {
  const flat = observations(country("X", Array(12).fill(3), Array(13).fill(6)), { version: "gap", lambda: 100 });
  assert.equal(flat.length, 13);
  for (const r of flat) { close(r.x, 0, 1e-8); close(r.y, 0, 1e-8); }
  const usa = observations(by.USA, { version: "gap", lambda: 100 });
  assert.deepEqual([usa[0].year, usa.at(-1).year], [1960, 2025]);
  close(stats.sum(usa.map((r) => r.x)), 0, 1e-6);
  close(stats.sum(usa.map((r) => r.y)), 0, 1e-6);
  // The output gap is in per cent: log points times 100. In 2009 United States output was below trend and unemployment above.
  const y09 = usa.find((r) => r.year === 2009);
  assert.ok(y09.x < -1 && y09.y > 1, `${y09.x}, ${y09.y}`);
  // Fewer than three years in a row: nothing to detrend.
  assert.deepEqual(observations(country("Z", [1], [5, 6]), { version: "gap" }), []);
});

test("one country: the fit is ordinary least squares, checked against the kit and against a case done by hand", () => {
  // (1, 1), (2, 3), (3, 2): slope 0.5, intercept 1, residuals -0.5, 1, -0.5, s2 = 1.5, se = sqrt(1.5 / 2).
  const f = fitCountry({ id: "h", name: "hand", rows: [{ year: 1, x: 1, y: 1 }, { year: 2, x: 2, y: 3 }, { year: 3, x: 3, y: 2 }] });
  close(f.b, 0.5); close(f.intercept, 1); close(f.s2, 1.5); close(f.se, Math.sqrt(0.75)); close(f.r2, 0.25);
  assert.equal(f.df, 1);
  close(f.lo, 0.5 - 12.7062047 * Math.sqrt(0.75), 1e-5);
  const r = rng(8), rows = Array.from({ length: 40 }, (_, i) => { const x = r.normal(2, 2); return { year: 1980 + i, x, y: 0.9 - 0.4 * x + r.normal(0, 0.5) }; });
  const mine = fitCountry({ id: "s", name: "s", rows }), kit = stats.linreg(rows.map((p) => p.x), rows.map((p) => p.y));
  close(mine.b, kit.slope, 1e-12); close(mine.intercept, kit.intercept, 1e-12); close(mine.se, kit.seSlope, 1e-12); close(mine.r2, kit.r2, 1e-12);
  close(mine.b, -0.4, 0.1);
  assert.deepEqual(mine.years, [1980, 2019]);
});

test("an exact fit has a zero-width interval and crosses zero where the line does", () => {
  const f = fitCountry({ id: "e", name: "e", rows: [1, 2, 3, 4, 5].map((x, i) => ({ year: i, x, y: 3 - x })) });
  close(f.b, -1); close(f.lo, -1, 1e-9); close(f.hi, -1, 1e-9); close(f.r2, 1);
  assert.equal(f.steady.bounded, true);
  close(f.steady.value, 3); close(f.steady.lo, 3, 1e-6); close(f.steady.hi, 3, 1e-6);
});

test("panel: a common slope with one intercept per country equals least squares with country dummies", () => {
  const r = rng(21), names = ["A", "B", "C"], a = [1, -0.5, 2.5];
  const groups = names.map((name, i) => ({ id: name, name, rows: Array.from({ length: 12 + 5 * i }, (_, t) => { const x = r.normal(2 + i, 1.5); return { year: 1990 + t, x, y: a[i] - 0.3 * x + r.normal(0, 0.4) }; }) }));
  const f = fitPanel(groups);
  // The same model fitted by brute force: y on x and a dummy for countries B and C.
  const flat = groups.flatMap((g, i) => g.rows.map((p) => ({ ...p, i })));
  const ols = stats.ols(flat.map((p) => [p.x, p.i === 1 ? 1 : 0, p.i === 2 ? 1 : 0]), flat.map((p) => p.y));
  close(f.b, ols.beta[1], 1e-10); close(f.se, ols.se[1], 1e-10); close(f.s2, ols.sigma2, 1e-10);
  close(f.intercepts[0].a, ols.beta[0], 1e-10); close(f.intercepts[1].a, ols.beta[0] + ols.beta[2], 1e-10); close(f.intercepts[2].a, ols.beta[0] + ols.beta[3], 1e-10);
  assert.equal(f.df, flat.length - 3 - 1);
  assert.equal(f.N, 51); assert.equal(f.G, 3);
  close(f.b, -0.3, 0.1);
  // Countries with different intercepts and the same slope: pooling them under one intercept gets the slope wrong.
  const exact = [0, 10].map((shift, i) => ({ id: `e${i}`, name: `e${i}`, rows: [1, 2, 3, 4].map((x, t) => ({ year: t, x: x + shift, y: 2 * i * 10 - 0.5 * (x + shift) })) }));
  close(fitPanel(exact).b, -0.5, 1e-9);
  assert.ok(fitPanel([{ id: "all", name: "all", rows: exact.flatMap((g) => g.rows) }]).b > 0);
  close(stats.sum(f.residuals.map((p) => p.residual)), 0, 1e-9);
});

test("the crossing interval is where the line's own 95% band includes zero, and is unbounded when the slope is unclear", () => {
  const r = rng(5), rows = Array.from({ length: 30 }, (_, i) => { const x = r.normal(2.5, 2); return { year: i, x, y: 1.2 - 0.4 * x + r.normal(0, 0.6) }; });
  const f = fitCountry({ id: "c", name: "c", rows });
  const st = f.steady;
  assert.ok(st.bounded && st.lo < st.value && st.value < st.hi);
  close(st.value, -f.intercept / f.b, 1e-12);
  // Recompute the band directly: |a + b x| - t * se(fitted value at x) changes sign at each end of the interval.
  const band = (x) => Math.abs(f.intercept + f.b * x) - f.t * Math.sqrt(f.s2 * (1 / f.N + (x - f.xbar) ** 2 / f.sxx));
  close(band(st.lo), 0, 1e-9); close(band(st.hi), 0, 1e-9);
  assert.ok(band((st.lo + st.hi) / 2) < 0 && band(st.lo - 0.1) > 0 && band(st.hi + 0.1) > 0);
  // A zigzag with no trend to speak of: the slope cannot be told from zero, so there is no interval.
  const noise = fitCountry({ id: "n", name: "n", rows: [0.3, -0.4, 0.5, -0.5, 0.4, -0.2].map((y, i) => ({ year: i, x: i + 1, y })) });
  assert.ok(noise.lo < 0 && noise.hi > 0);
  assert.equal(noise.steady.bounded, false);
  assert.equal(crossing({ xbar: 0, ybar: 1, b: 0, s2: 1, n: 10, sxx: 10, t: 2 }).bounded, false);
});

test("too little to fit is refused with a reason", () => {
  assert.match(fitPanel([]).error, /too few/);
  assert.match(fitPanel([{ id: "a", name: "a", rows: [{ year: 1, x: 1, y: 1 }, { year: 2, x: 2, y: 2 }] }]).error, /too few/);
  assert.match(fitCountry({ id: "a", name: "a", rows: [1, 2, 3, 4].map((t) => ({ year: t, x: 2, y: t })) }).error, /same in every year/);
  // Unemployment that never changes: slope zero, nothing to explain, and no number is invented for it.
  const flat = fitCountry({ id: "f", name: "f", rows: [1, 2, 3, 4, 5].map((t) => ({ year: t, x: t, y: 0 })) });
  assert.equal(flat.r2, null);
  close(flat.b, 0);
  assert.match(describe(flat, { who: "Flatland" }), /no variation to explain/);
  assert.doesNotMatch(describe(flat, { who: "Flatland" }), /NaN|undefined|Infinity/);
});

test("the data: three values of each series against the sources' own figures", () => {
  // World Bank API, NY.GDP.MKTP.KD.ZG, FP.CPI.TOTL.ZG and SL.UEM.TOTL.ZS (database last updated 2026-10-08).
  close(at(by.USA.g, 2009), -2.5765002366652, 0.005);
  close(at(by.USA.g, 2020), -2.081375977796, 0.005);
  close(at(by.USA.p, 1974), 11.0548048048048, 0.005);
  close(at(by.USA.p, 1980), 13.5492019749684, 0.005);
  assert.equal(at(by.USA.uIlo, 2009), 9.254);
  assert.equal(at(by.USA.uIlo, 2020), 8.055);
  assert.equal(at(by.USA.uIlo, 1991), 6.8);
  // OECD Economic Outlook 119, UNR (SDMX csv): USA 1960 5.56164344230914, GBR 1960 2.77225945606986, JPN 1960 1.60926760771565, CAN 2025 6.8340144068752.
  close(at(by.USA.uOecd, 1960), 5.56164344230914, 0.0005);
  close(at(by.GBR.uOecd, 1960), 2.77225945606986, 0.0005);
  close(at(by.JPN.uOecd, 1960), 1.60926760771565, 0.0005);
  close(at(by.CAN.uOecd, 2025), 6.8340144068752, 0.0005);
  // Outside a series, and for a country without one: null, never zero.
  assert.equal(at(by.USA.uIlo, 1990), null);
  assert.equal(at(by.DEU.uOecd, 1991), null);
  assert.equal(at(by.IND.uOecd, 2000), null);
  assert.equal(MACRO.source.retrieved, "2026-10-12");
  assert.equal(MACRO.countries.length, 181);
  assert.equal(MACRO.countries.filter((c) => c.uOecd).length, 45);
  // No OECD value after 2025: the Economic Outlook's projections are not in the module.
  for (const c of MACRO.countries) for (const k of ["g", "p", "uIlo", "uOecd"]) if (c[k]) assert.ok(c[k][0] >= 1960 && c[k][0] + c[k][1].length - 1 <= 2025, `${c.iso3} ${k}`);
});

test("the finding on the page: the seven countries on load, 1961 to 2025", () => {
  const r = analyse(G7, { series: "oecd", version: "change", from: 1961, to: 2025 });
  assert.equal(r.panel.G, 7); assert.equal(r.panel.N, 423);
  assert.equal(r.panel.b.toFixed(2), "-0.13");
  assert.equal(r.panel.lo.toFixed(2), "-0.15"); assert.equal(r.panel.hi.toFixed(2), "-0.10");
  const usa = r.byCountry.find((c) => c.id === "USA").fit, jpn = r.byCountry.find((c) => c.id === "JPN").fit;
  assert.equal(usa.N, 65);
  assert.equal(usa.b.toFixed(2), "-0.44"); assert.equal(usa.lo.toFixed(2), "-0.52"); assert.equal(usa.hi.toFixed(2), "-0.35");
  assert.equal(usa.r2.toFixed(2), "0.62");
  assert.equal(usa.steady.value.toFixed(1), "3.0"); assert.equal(usa.steady.lo.toFixed(1), "2.5"); assert.equal(usa.steady.hi.toFixed(1), "3.4");
  assert.equal(jpn.b.toFixed(2), "-0.02");
  // The year furthest from the panel's line: the United States in 2020.
  const top = furthest(r.panel, 3);
  assert.deepEqual([top[0].name, top[0].year], ["United States", 2020]);
  assert.equal(top[0].residual.toFixed(2), "3.75");
  assert.deepEqual([top[2].name, top[2].year], ["United States", 2009]);
  // Germany's OECD series starts in 1992, so it has 33 changes; the others have 65.
  assert.equal(r.byCountry.find((c) => c.id === "DEU").fit.N, 33);
  assert.deepEqual(r.skipped, []);
  // The three periods.
  assert.deepEqual(r.periods.map((p) => p.fit.b.toFixed(2)), ["-0.12", "-0.33", "-0.19"]);
  assert.deepEqual(r.periods.map((p) => p.fit.G), [6, 6, 7]);
});

test("the United States line recomputed with separately written code", () => {
  // Plain sums over the raw arrays, without logic.js.
  const u = by.USA.uOecd, g = by.USA.g, xs = [], ys = [];
  for (let year = 1961; year <= 2025; year++) { xs.push(g[1][year - g[0]]); ys.push(u[1][year - u[0]] - u[1][year - 1 - u[0]]); }
  const n = xs.length, mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const fit = analyse([by.USA], { from: 1961, to: 2025 }).panel;
  close(fit.b, sxy / sxx, 1e-12);
  close(fit.intercept, my - (sxy / sxx) * mx, 1e-12);
  close(fit.steady.value, mx - my / (sxy / sxx), 1e-12);
});

test("the gap version agrees with published estimates for 1980 to 2011", () => {
  // Ball, Leigh and Loungani (NBER Working Paper 18668, table of 20 countries, HP trend with lambda 100):
  // United States -0.454, Japan -0.152, Spain -0.852. A later data vintage and a longer run for the trend: within 0.1.
  for (const [iso, theirs] of [["USA", -0.454], ["JPN", -0.152], ["ESP", -0.852], ["CAN", -0.432], ["FRA", -0.367], ["AUT", -0.136]]) {
    const mine = analyse([by[iso]], { version: "gap", lambda: 100, from: 1980, to: 2011 }).panel;
    assert.equal(mine.N, 32);
    close(mine.b, theirs, 0.1);
  }
  // The three figures the write-up quotes from this tool.
  const own = (iso) => analyse([by[iso]], { version: "gap", lambda: 100, from: 1980, to: 2011 }).panel.b.toFixed(2);
  assert.deepEqual([own("USA"), own("JPN"), own("ESP")], ["-0.52", "-0.16", "-0.91"]);
});

test("leaving out 2020 and 2021 drops exactly those years", () => {
  const withAll = analyse(G7, {}), without = analyse(G7, { skipPandemic: true });
  assert.equal(withAll.panel.N - without.panel.N, 14);
  assert.ok(without.panel.residuals.every((r) => r.year !== 2020 && r.year !== 2021));
  assert.equal(without.panel.b.toFixed(2), "-0.13");
});

test("choices that cannot be fitted say what to change", () => {
  assert.match(analyse([], {}).error, /No country is ticked/);
  // One country: the message says how many years it has. Germany's OECD series starts in 1992; Peru's in 2015.
  assert.equal(analyse([by.DEU], { from: 1961, to: 1990 }).error, "Germany has no year with both series between 1961 and 1990, and a line needs 8. Widen the years or choose other countries.");
  assert.equal(analyse([by.PER], { from: 1961, to: 2018 }).error, "Peru has only 3 years with both series between 1961 and 2018, and a line needs 8. Widen the years or choose other countries.");
  assert.equal(analyse([by.PER], { from: 1961, to: 2016 }).error, "Peru has only 1 year with both series between 1961 and 2016, and a line needs 8. Widen the years or choose other countries.");
  assert.match(analyse([by.DEU, by.IRL], { from: 1961, to: 1985 }).error, /^Neither of the 2 countries ticked has 8 years of both series between 1961 and 1985\./);
  assert.match(analyse([by.DEU, by.IRL, by.PER], { from: 1961, to: 1985 }).error, /^None of the 3 countries ticked has 8 years/);
  // The ILO series chosen for years it does not reach: the message names the series, not the countries.
  assert.equal(analyse(G7, { series: "ilo", from: 1961, to: 1985 }).error, "The ILO's modelled estimates run from 1991 to 2024, so the first change is for 1992. The years 1961 to 1985 hold none of the years 1992 to 2024, and a line needs 8. Move the years, or switch to the OECD series.");
  assert.match(analyse(G7, { series: "ilo", from: 1961, to: 1995 }).error, /The years 1961 to 1995 hold only 4 of the years 1992 to 2024/);
  assert.match(analyse(G7, { series: "ilo", from: 2018, to: 2025 }).error, /The years 2018 to 2025 hold only 7 of the years 1992 to 2024/);
  assert.match(analyse(G7, { series: "ilo", version: "gap", from: 1961, to: 1997 }).error, /so the first gap is for 1991\. The years 1961 to 1997 hold only 7 of the years 1991 to 2024/);
  assert.equal(analyse(G7, { series: "ilo", from: 1961, to: 1999 }).panel.N, 56);
  assert.equal(analyse(G7, { series: "ilo", from: 2017, to: 2025 }).panel.N, 56);
  // India has no OECD series: it is reported as left out, with a count of zero years.
  const r = analyse([by.USA, by.IND], {});
  assert.equal(r.panel.G, 1);
  assert.deepEqual(r.skipped, [{ id: "IND", name: "India", years: 0 }]);
  // A window of exactly the minimum is fitted; one year fewer is not.
  assert.equal(analyse([by.USA], { from: 2000, to: 2000 + MIN_YEARS - 1 }).panel.N, MIN_YEARS);
  assert.ok(analyse([by.USA], { from: 2000, to: 2000 + MIN_YEARS - 2 }).error);
  assert.equal(analyse([by.USA], { from: 2015, to: 2023, skipPandemic: true }).error, "The United States has only 7 years with both series between 2015 and 2023 once 2020 and 2021 are left out, and a line needs 8. Widen the years or choose other countries.");
});

test("the interval for the steady growth rate against a search written separately: bounded, every rate, or all but one range", () => {
  // The reviewer's own check (Python, numpy least squares): scan growth rates from -200 to 200 and keep those at which
  // the fitted line's 95% band includes zero. G7 countries, OECD series, changes.
  const fit = (iso, from, to) => analyse([by[iso]], { from, to }).panel;
  // Bounded. Japan 1961 to 2025: -0.292 to 10.402. France: 2.018 to 87.73. Germany: -1.56 to 2.076.
  const jpn = fit("JPN", 1961, 2025).steady, fra = fit("FRA", 1961, 2025).steady, deu = fit("DEU", 1961, 2025).steady;
  assert.ok(jpn.bounded && fra.bounded && deu.bounded);
  close(jpn.lo, -0.292, 0.002); close(jpn.hi, 10.402, 0.002); close(jpn.value, 3.926, 0.001);
  close(fra.lo, 2.018, 0.002); close(fra.hi, 87.73, 0.01);
  close(deu.lo, -1.56, 0.002); close(deu.hi, 2.076, 0.002);
  // Every rate. Italy 1961 to 2025: the band includes zero at every growth rate.
  const ita = fit("ITA", 1961, 2025);
  assert.deepEqual([ita.steady.bounded, ita.steady.all, ita.steady.gap], [false, true, null]);
  assert.match(steadyWords(ita), /every rate is inside the 95% interval\.$/);
  assert.equal(unboundedCell(ita.steady), "cannot be pinned down: no rate is ruled out");
  // All but one range. Italy 1980 to 1999: slope -0.11 (-0.34 to +0.13), and only rates from 0.69% to 1.99% are ruled out.
  const ita80 = fit("ITA", 1980, 1999);
  assert.equal(ita80.steady.bounded, false); assert.equal(ita80.steady.all, false);
  close(ita80.steady.gap[0], 0.69, 0.006); close(ita80.steady.gap[1], 1.99, 0.006);
  assert.match(steadyWords(ita80), /the 95% interval has no end in either direction and rules out only rates between 0\.7% and 2\.0%\.$/);
  assert.equal(unboundedCell(ita80.steady), "cannot be pinned down: only 0.7% to 2.0% is ruled out");
  // The band itself, recomputed: inside the gap it misses zero, outside it (on both sides, however far) it includes zero.
  const band = (f, x) => Math.abs(f.intercept + f.b * x) - f.t * Math.sqrt(f.s2 * (1 / f.N + (x - f.xbar) ** 2 / f.sxx));
  assert.ok(band(ita80, 1.3) > 0 && band(ita80, 0.5) < 0 && band(ita80, 2.2) < 0 && band(ita80, -1e6) < 0 && band(ita80, 1e6) < 0);
  for (const x of [-1e6, -5, 0, 3, 50, 1e6]) assert.ok(band(ita, x) < 0);
  // Exactly on the edge (A = 0) nothing is claimed beyond "no end".
  assert.equal(unboundedWords({ bounded: false, all: false, gap: null }), "the 95% interval has no end");
});

test("the Hodrick-Prescott gaps against a filter written separately, and the end-point problem quoted on the page", () => {
  // The reviewer's own filter (numpy: solve (I + 100 K'K) trend = series) gives, for the United States in 2009 with the
  // years 1960 to 2025: output 2.90% below trend, unemployment 2.38 points above trend.
  const usa09 = observations(by.USA, { version: "gap", lambda: 100 }).find((r) => r.year === 2009);
  close(usa09.x, -2.9, 0.006); close(usa09.y, 2.38, 0.006);
  // Spain's output gap in 2009, first with the figures up to 2009 only, then with every year to 2025.
  const upTo = (c, year) => ({ ...c, g: [c.g[0], c.g[1].slice(0, year - c.g[0] + 1)], uOecd: [c.uOecd[0], c.uOecd[1].slice(0, year - c.uOecd[0] + 1)] });
  const early = observations(upTo(by.ESP, 2009), { version: "gap", lambda: 100 }), late = observations(by.ESP, { version: "gap", lambda: 100 });
  assert.equal(early.at(-1).year, 2009);
  close(early.at(-1).x, -5.67, 0.006); close(late.find((r) => r.year === 2009).x, 0.78, 0.006);
  assert.equal(early.at(-1).x.toFixed(1), "-5.7"); assert.equal(late.find((r) => r.year === 2009).x.toFixed(1), "0.8");
  // The gap version adds growth up from the first year: it relies on no country having a hole in its growth figures.
  for (const c of MACRO.countries) assert.ok(!c.g[1].includes(null), `${c.name} has a gap in its growth series`);
});

test("the ILO series fits every country that has it from 1992", () => {
  const ilo = MACRO.countries.filter((c) => c.uIlo);
  const r = analyse(ilo, { series: "ilo", from: 1992, to: 2025 });
  assert.equal(r.panel.G, 181);
  // Recomputed separately with country dummies: -0.0483 (-0.0526 to -0.0440) over 5,909 country-years.
  assert.equal(r.panel.N, 5909);
  assert.equal(r.panel.b.toFixed(4), "-0.0483");
  assert.equal(r.panel.b.toFixed(2), "-0.05");
  // The series stops at 2024 whatever the "To" slider says, and the result says so.
  assert.deepEqual(r.panel.years, [1992, 2024]);
  assert.deepEqual(PERIODS.ilo, [[1992, 2007], [2008, MACRO.lastIlo]]);
  assert.equal(SERIES.ilo.key, "uIlo");
  assert.deepEqual([SERIES.ilo.from, SERIES.ilo.to], [1991, MACRO.lastIlo]);
});

test("the modelled ILO series stops where the ILO's estimates stop: its projections are not in the module", () => {
  // In the ILO's own file (sdmx.ilo.org, ILO modelled estimates, Nov. 2025) no figure after 2024 is marked as a reported
  // value, and the World Bank's 2025 figures equal the ILO's projections (Brazil 5.97, Spain 10.376, United States 4.198).
  assert.equal(MACRO.lastIlo, 2024);
  for (const c of MACRO.countries) if (c.uIlo) assert.ok(c.uIlo[0] + c.uIlo[1].length - 1 <= 2024, c.name);
  assert.equal(at(by.BRA.uIlo, 2024), 6.801); assert.equal(at(by.ESP.uIlo, 2024), 11.4); assert.equal(at(by.USA.uIlo, 2024), 4.022);
  for (const iso of ["BRA", "ESP", "USA", "IND"]) assert.equal(at(by[iso].uIlo, 2025), null);
  // The OECD series keeps 2025, an outturn in Economic Outlook 119, and has nothing later (the source runs on to 2027).
  close(at(by.USA.uOecd, 2025), 4.28130992253843, 0.0005);
  assert.equal(at(by.USA.uOecd, 2026), null);
  assert.match(MACRO.source.oecdTerms, /Not a Creative Commons licence/);
  assert.match(MACRO.source.ilo, /estimates to 2024/);
});

test("every sentence the tool can write about a fit", () => {
  const r = analyse(G7, {});
  const panel = describe(r.panel, {});
  assert.match(panel, /^Across 7 countries and 423 country-years from 1961 to 2025, with a separate intercept for each country, the fitted Okun coefficient is -0\.13 points of unemployment per point of growth \(95% interval -0\.15 to -0\.10\)\./);
  assert.match(panel, /went with a change in the unemployment rate 0\.13 points lower\./);
  assert.match(panel, /Growth accounts for 20% of the variation in the change in unemployment within countries\./);
  assert.match(panel, /The line crosses zero at growth of 2\.8% a year \(95% interval 2\.2% to 3\.3%\): in the average country-year that is the growth at which unemployment neither rose nor fell\.$/);
  const usa = describe(r.byCountry[0].fit, { who: "the United States" });
  assert.match(usa, /^In the United States, over the 65 years from 1961 to 2025, the fitted Okun coefficient is -0\.44/);
  assert.match(usa, /\(95% interval 2\.5% to 3\.4%\): that is the growth/);
  // Italy: the interval includes zero, and no steady growth rate is claimed.
  const ita = describe(r.byCountry.find((c) => c.id === "ITA").fit, { who: "Italy" });
  assert.match(ita, /The interval includes zero, so these years do not show a link in either direction\./);
  assert.match(ita, /The slope is too uncertain to say what growth rate holds unemployment steady/);
  assert.doesNotMatch(ita, /went with a change/);
  // An upward slope is called what it is.
  const up = fitCountry({ id: "u", name: "u", rows: [1, 2, 3, 4, 5, 6].map((x, i) => ({ year: 2000 + i, x, y: 0.5 * x + (i % 2 ? 0.1 : -0.1) })) });
  assert.match(describe(up, { who: "Upland" }), /The sign is the opposite of Okun's law: more growth went with a larger rise in unemployment\./);
  assert.match(steadyWords(up), /does not slope downwards/);
  // The gap version has its own units and no steady growth rate.
  const gap = describe(analyse(G7, { version: "gap" }).panel, { version: "gap" });
  assert.match(gap, /points of unemployment per 1% of output above trend/);
  assert.match(gap, /The output gap accounts for 42% of the variation in the unemployment gap within countries\.$/);
  // The years furthest from the line. United States 2020: growth -2.08%, unemployment up from 3.67% to 8.06%.
  assert.equal(missWords(furthest(r.panel, 1)[0]), "United States 2020: growth of -2.1% and a rise in the unemployment rate of 4.39 points, 3.75 points above the line.");
  assert.equal(missWords({ name: "X", year: 2001, x: 3, y: 0, residual: -0.4 }), "X 2001: growth of 3.0% and no change in the unemployment rate, 0.40 points below the line.");
  assert.equal(missWords({ name: "X", year: 2001, x: 3, y: -1.25, residual: -0.4 }), "X 2001: growth of 3.0% and a fall in the unemployment rate of 1.25 points, 0.40 points below the line.");
  assert.equal(missWords({ name: "X", year: 2009, x: -4.2, y: 1.5, residual: 0.31 }, "gap"), "X 2009: output 4.2% below its trend and unemployment 1.50 points above its trend, 0.31 points above the line.");
  assert.equal(span({ years: [2001, 2001] }), "2001");
  // A bound that would round to zero keeps its sign: France's upper bound is -0.0012, not "0.00".
  const fra = r.byCountry.find((c) => c.id === "FRA").fit;
  assert.equal(s2(fra.hi), "-0.0012");
  assert.match(describe(fra, { who: "France" }), /\(95% interval -0\.11 to -0\.0012\)\. A year with one more point/);
  assert.equal(s2(0), "0.00"); assert.equal(s2(0.004), "+0.0040"); assert.equal(s2(-0.005), "-0.01"); assert.equal(s2(1.234), "+1.23"); assert.equal(s2(-1e-12), "0.000000");
  assert.equal(inSentence("United States"), "the United States"); assert.equal(inSentence("Japan"), "Japan");
  for (const s of [panel, usa, ita, gap]) assert.doesNotMatch(s, /NaN|undefined|Infinity|null/);
});
