// Day 8: Hedonic Treadmill Simulator. Adaptation model and panel comparisons, with no DOM code.

import { stats } from "../kit/kit.js";

/**
 * An income path, one value per year.
 * growth: steady yearly growth (0.02 = 2%). change: a one-off jump in `changeYear` (0.5 = +50%, -0.3 = -30%).
 * lasts: how many years the jump stays (0 = for good).
 */
export function incomePath({ years = 30, start = 20000, growth = 0, change = 0.5, changeYear = 5, lasts = 0 } = {}) {
  const out = [];
  for (let t = 0; t < years; t++) {
    const on = t >= changeYear && (lasts === 0 || t < changeYear + lasts);
    out.push(start * (1 + growth) ** t * (on ? 1 + change : 1));
  }
  return out;
}

/**
 * Happiness with adaptation.
 *   reference:  r_t = y_s + (r_s - y_s) (1 - alpha)^(t - s)      (s is the previous observation; y is log income)
 *   happiness:  H_t = base + b [ (y_t - y_0) - k (r_t - r_0) ],  r_0 = y_0
 * alpha: share of the gap between income and the reference level that closes each year (0 to 1).
 * k: how much of a lasting income gain people get used to (0 = none, 1 = all of it).
 * b: happiness points per unit of log income. times: the year of each observation (default 0, 1, 2, ...).
 */
export function simulate(incomes, { alpha = 0.3, k = 1, b = 0.8, base = 5.5, times } = {}) {
  const t = times || incomes.map((_, i) => i);
  const y = incomes.map(Math.log);
  const reference = [y[0]];
  for (let i = 1; i < y.length; i++) {
    reference.push(y[i - 1] + (reference[i - 1] - y[i - 1]) * (1 - alpha) ** (t[i] - t[i - 1]));
  }
  return {
    times: t,
    reference: reference.map(Math.exp),
    happiness: y.map((v, i) => base + b * ((v - y[0]) - k * (reference[i] - y[0]))),
    noAdaptation: y.map((v) => base + b * (v - y[0])),
  };
}

/**
 * Years for half of a gap between income and the reference level to close: (1 - alpha)^n = 0.5.
 * Infinity when alpha is 0, and 0 when alpha is 1 (the whole gap closes in the first year).
 */
export const halfLife = (alpha) => (alpha <= 0 ? Infinity : alpha >= 1 ? 0 : Math.log(0.5) / Math.log(1 - alpha));

/**
 * The first survey period the page uses. The report's earliest point, 2011, comes from the first World
 * Happiness Report, which pooled every survey from 2005 to mid-2011. It is not a three-year average, so the
 * data module (scripts/data/wellbeing.py) leaves it out.
 */
export const FIRST_YEAR = 2012;

/** A country's observed years from FIRST_YEAR on: [{ year, gdp, ladder, lo, hi }] where both income and life evaluation exist. */
export function countrySeries(data, name) {
  const c = data.countries.find((x) => x.name === name);
  if (!c) return [];
  return data.years.map((year, i) => ({ year, gdp: c.gdp[i], ladder: c.ladder[i], lo: c.lo[i], hi: c.hi[i] })).filter((p) => p.year >= FIRST_YEAR && p.gdp && p.ladder != null);
}

/** Countries with at least `min` observed years from FIRST_YEAR on. */
export function countriesWithSeries(data, min = 8) {
  return data.countries.filter((c) => c.ladder.filter((v, i) => data.years[i] >= FIRST_YEAR && v != null && c.gdp[i]).length >= min).map((c) => c.name).sort((a, b) => a.localeCompare(b));
}

/** Cross-country slope of life evaluation on log income in one year: { b, perDoubling, r2, n }. */
export function crossSection(data, year) {
  const i = data.years.indexOf(year);
  const rows = data.countries.filter((c) => c.ladder[i] != null && c.gdp[i]);
  const fit = stats.linreg(rows.map((c) => Math.log(c.gdp[i])), rows.map((c) => c.ladder[i]));
  return { b: fit.slope, perDoubling: fit.slope * Math.LN2, r2: fit.r2, n: fit.n };
}

const rmse = (a, b) => Math.sqrt(stats.mean(a.map((v, i) => (v - b[i]) ** 2)));

/** Predicted life evaluation for an observed series under given parameters, with the level set to fit best. */
export function predict(series, { alpha, k, b }) {
  const sim = simulate(series.map((p) => p.gdp), { alpha, k, b, base: 0, times: series.map((p) => p.year) });
  const level = stats.mean(series.map((p, i) => p.ladder - sim.happiness[i]));
  const fitted = sim.happiness.map((h) => h + level);
  return { fitted, rmse: rmse(fitted, series.map((p) => p.ladder)), reference: sim.reference };
}

/**
 * Grid search for the adaptation share k and speed alpha that best reproduce a country's series, with b fixed.
 * Also reports how well "no adaptation" does, and what share of the grid fits nearly as well as the best point.
 */
export function fitCountry(series, b) {
  let best = null;
  const all = [];
  for (let ki = 0; ki <= 20; ki++) {
    for (let ai = 1; ai <= 20; ai++) {
      const p = { k: ki / 20, alpha: ai / 20 };
      const r = predict(series, { ...p, b }).rmse;
      all.push(r);
      if (!best || r < best.rmse - 1e-12) best = { ...p, rmse: r };
    }
  }
  const none = predict(series, { alpha: 0.5, k: 0, b }).rmse;
  const flat = rmse(series.map(() => stats.mean(series.map((p) => p.ladder))), series.map((p) => p.ladder));
  return { ...best, rmseNone: none, rmseFlat: flat, nearlyAsGood: all.filter((r) => r <= best.rmse * 1.1 + 1e-12).length / all.length };
}

/**
 * The Easterlin test on the panel: for every country observed in both years, the change in life evaluation
 * against the change in income (in doublings), and the slope across countries of one on the other.
 */
export function changes(data, from, to) {
  const a = data.years.indexOf(from), z = data.years.indexOf(to);
  const rows = data.countries
    .filter((c) => c.ladder[a] != null && c.ladder[z] != null && c.gdp[a] && c.gdp[z])
    .map((c) => ({ name: c.name, dIncome: Math.log2(c.gdp[z] / c.gdp[a]), dLadder: c.ladder[z] - c.ladder[a] }));
  const fit = rows.length > 2 ? stats.linreg(rows.map((r) => r.dIncome), rows.map((r) => r.dLadder)) : { slope: NaN, intercept: NaN, r2: NaN, seSlope: NaN, n: rows.length };
  return { rows, slope: fit.slope, intercept: fit.intercept, r2: fit.r2, se: fit.seSlope, n: rows.length };
}
