// Day 55: Unemployment and Okun's Law Explorer. The model, with no DOM code.
// Okun's law in two forms, fitted by country and for a panel with one intercept per country.

import { stats, linalg, fmt } from "../kit/kit.js";

/** The two unemployment series in the data. They are never joined: a fit uses one of them for every country. */
export const SERIES = {
  oecd: { key: "uOecd", label: "OECD long series", short: "OECD Economic Outlook 119" },
  // The ILO's estimates run from 1991 to 2024. The World Bank's series also carries the ILO's projection for 2025, which
  // the data script leaves out.
  ilo: { key: "uIlo", label: "ILO modelled estimates", short: "modelled ILO estimates from the World Bank", from: 1991, to: 2024 },
};
/** A country needs this many years in the window to be fitted. */
export const MIN_YEARS = 8;
export const PANDEMIC = [2020, 2021];
export const LAMBDAS = [6.25, 100, 1000];
/** Periods compared in the table, by series. */
export const PERIODS = { oecd: [[1961, 1979], [1980, 1999], [2000, 2025]], ilo: [[1992, 2007], [2008, 2024]] };

/* ---------- Student's t ---------- */

// Continued fraction for the incomplete beta function (modified Lentz).
function betaCf(a, b, x) {
  const TINY = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}
/** Regularised incomplete beta function I_x(a, b). */
function betaInc(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(stats.logGamma(a + b) - stats.logGamma(a) - stats.logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(a, b, x)) / a : 1 - (front * betaCf(b, a, 1 - x)) / b;
}
/** P(T <= t) for Student's t with df degrees of freedom. */
export function tCdf(t, df) {
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}
const T975 = new Map();
/** The 97.5th percentile of Student's t: the multiplier for a two-sided 95% interval. */
export function t975(df) {
  if (!(df >= 1)) return NaN;
  if (!T975.has(df)) {
    let lo = 0, hi = 2;
    while (tCdf(hi, df) < 0.975) hi *= 2;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < 0.975) lo = mid; else hi = mid; }
    T975.set(df, (lo + hi) / 2);
  }
  return T975.get(df);
}

/* ---------- data ---------- */

/** Value of a [first year, values] series in a year, or null. */
export const at = (s, year) => (s && year >= s[0] && year < s[0] + s[1].length ? s[1][year - s[0]] ?? null : null);

const HP = new Map();
/**
 * Hodrick-Prescott trend: the series tau that minimises sum (y - tau)^2 + lambda * sum (second difference of tau)^2.
 * Solved exactly as tau = (I + lambda K'K)^-1 y, where K takes second differences. Fewer than 3 points: the series itself.
 */
export function hpTrend(y, lambda) {
  const n = y.length;
  if (n < 3) return [...y];
  const key = `${n}:${lambda}`;
  if (!HP.has(key)) {
    const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let r = 0; r < n - 2; r++) {
      const k = [1, -2, 1];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[r + i][r + j] += lambda * k[i] * k[j];
    }
    HP.set(key, linalg.inverse(A));
  }
  return HP.get(key).map((row) => row.reduce((s, v, j) => s + v * y[j], 0));
}

/**
 * One country's observations, one per year: { year, x, y, u, g }.
 *   version "change": x = real GDP growth in the year (%), y = change in the unemployment rate from the year before (points).
 *   version "gap":    x = output above its trend (%), y = the unemployment rate above its trend (points). Both trends are
 *                     Hodrick-Prescott trends over the country's longest unbroken run of years with both series.
 */
export function observations(country, { series = "oecd", version = "change", lambda = 100 } = {}) {
  const u = country[SERIES[series].key], g = country.g;
  if (!u || !g) return [];
  const first = Math.min(u[0], g[0]) - 1, last = Math.max(u[0] + u[1].length, g[0] + g[1].length);
  const rows = [];
  if (version === "change") {
    for (let year = first; year <= last; year++) {
      const now = at(u, year), before = at(u, year - 1), growth = at(g, year);
      if (now != null && before != null && growth != null) rows.push({ year, x: growth, y: now - before, u: now, g: growth });
    }
    return rows;
  }
  // The log of real GDP as an index: zero in the year before the first growth figure, then growth added up.
  const level = new Map([[g[0] - 1, 0]]);
  for (let year = g[0]; at(g, year) != null; year++) level.set(year, level.get(year - 1) + Math.log(1 + at(g, year) / 100));
  let best = [], run = [];
  for (let year = first; year <= last + 1; year++) {
    if (level.has(year) && at(u, year) != null) run.push(year);
    else { if (run.length > best.length) best = run; run = []; }
  }
  if (best.length < 3) return [];
  const ys = best.map((year) => level.get(year)), us = best.map((year) => at(u, year));
  const ty = hpTrend(ys, lambda), tu = hpTrend(us, lambda);
  return best.map((year, i) => ({ year, x: 100 * (ys[i] - ty[i]), y: us[i] - tu[i], u: us[i], g: at(g, year) }));
}

/** Keep the years inside [from, to] that are not in `skip`. */
export const inWindow = (rows, from, to, skip = []) => rows.filter((r) => r.year >= from && r.year <= to && !skip.includes(r.year));

/* ---------- fitting ---------- */

/**
 * Where a fitted line crosses zero, with Fieller's 95% interval: the values of x at which the line's own 95% band
 * includes zero. Needs the means, the slope b, the residual variance s2, the count behind the mean n, the sum of
 * squares of x about its mean sxx, and the t multiplier. With d = x - xbar the band includes zero where
 * A d^2 + B d + C <= 0. `bounded` is false when the slope cannot be told from zero (A <= 0). The set then has no end:
 * it is every x (`all`), or every x outside one range (`gap`: [low, high], the only values ruled out).
 */
export function crossing({ xbar, ybar, b, s2, n, sxx, t }) {
  const A = b * b - (t * t * s2) / sxx, B = 2 * b * ybar, C = ybar * ybar - (t * t * s2) / n;
  const value = b === 0 ? NaN : xbar - ybar / b;
  const disc = B * B - 4 * A * C;
  if (A > 0) {
    const root = Math.sqrt(Math.max(0, disc));
    return { value, bounded: true, lo: xbar + (-B - root) / (2 * A), hi: xbar + (-B + root) / (2 * A) };
  }
  if (A < 0 && disc > 0) {
    const root = Math.sqrt(disc), r1 = xbar + (-B + root) / (2 * A), r2 = xbar + (-B - root) / (2 * A);
    return { value, bounded: false, all: false, gap: [Math.min(r1, r2), Math.max(r1, r2)] };
  }
  return { value, bounded: false, all: A < 0 || (B === 0 && C <= 0), gap: null };
}

/**
 * Least squares with one intercept per group and a common slope (the "within" estimator). groups: [{ id, name, rows }].
 * With one group this is ordinary least squares. Standard errors are the classical ones, with N - G - 1 degrees of freedom.
 * Returns { error } when there is too little to fit.
 */
export function fitPanel(groups) {
  const used = groups.filter((g) => g.rows.length >= 3);
  const N = stats.sum(used.map((g) => g.rows.length)), G = used.length;
  if (!G || N - G - 1 < 1) return { error: "too few years to fit a line", N, G };
  let sxx = 0, sxy = 0, syy = 0;
  const means = used.map((g) => ({ x: stats.mean(g.rows.map((r) => r.x)), y: stats.mean(g.rows.map((r) => r.y)) }));
  used.forEach((g, i) => { for (const r of g.rows) { const dx = r.x - means[i].x, dy = r.y - means[i].y; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; } });
  if (!(sxx > 0)) return { error: "growth is the same in every year, so no slope can be fitted", N, G };
  const b = sxy / sxx, df = N - G - 1;
  const rss = Math.max(0, syy - b * sxy), s2 = rss / df, se = Math.sqrt(s2 / sxx), t = t975(df);
  const intercepts = means.map((m) => m.y - b * m.x);
  const residuals = used.flatMap((g, i) => g.rows.map((r) => ({ id: g.id, name: g.name, year: r.year, x: r.x, y: r.y, fitted: intercepts[i] + b * r.x, residual: r.y - intercepts[i] - b * r.x })));
  const xbar = stats.mean(residuals.map((r) => r.x)), ybar = stats.mean(residuals.map((r) => r.y));
  return {
    N, G, b, se, df, t, lo: b - t * se, hi: b + t * se, s2, sxx, xbar, ybar,
    // Undefined when the outcome never varies: there is nothing to explain.
    r2: syy > 0 ? 1 - rss / syy : null,
    intercept: ybar - b * xbar, intercepts: used.map((g, i) => ({ id: g.id, name: g.name, a: intercepts[i] })),
    steady: crossing({ xbar, ybar, b, s2, n: N, sxx, t }),
    residuals, years: [Math.min(...residuals.map((r) => r.year)), Math.max(...residuals.map((r) => r.year))],
  };
}

/** One country's own line. */
export const fitCountry = (group) => fitPanel([group]);

/**
 * Everything the page shows for one choice. countries: the data's country objects. Returns
 * { groups, skipped, panel, pooled, byCountry, periods } or { error }.
 */
export function analyse(countries, { series = "oecd", version = "change", lambda = 100, from = 1961, to = 2025, skipPandemic = false } = {}) {
  const skip = skipPandemic ? PANDEMIC : [];
  const all = countries.map((c) => ({ id: c.iso3, name: c.name, all: observations(c, { series, version, lambda }) }));
  const cut = (a, b) => all.map((g) => ({ id: g.id, name: g.name, rows: inWindow(g.all, a, b, skip) }));
  const windowed = cut(from, to);
  const groups = windowed.filter((g) => g.rows.length >= MIN_YEARS);
  const skipped = windowed.filter((g) => g.rows.length < MIN_YEARS).map((g) => ({ id: g.id, name: g.name, years: g.rows.length }));
  if (!countries.length) return { error: "No country is ticked. Tick at least one country, or press one of the group buttons.", groups, skipped };
  if (!groups.length) {
    // A series that does not reach these years: say so, instead of blaming the countries.
    const s = SERIES[series], start = s.from == null ? null : s.from + (version === "change" ? 1 : 0);
    if (start != null) {
      const held = Math.max(0, Math.min(to, s.to) - Math.max(from, start) + 1);
      if (held < MIN_YEARS) {
        return { error: `The ILO's modelled estimates run from ${s.from} to ${s.to}, so the first ${version === "change" ? "change" : "gap"} is for ${start}. The years ${from} to ${to} hold ${held === 0 ? "none" : `only ${held}`} of the years ${start} to ${s.to}, and a line needs ${MIN_YEARS}. Move the years, or switch to the OECD series.`, groups, skipped };
      }
    }
    const without = skipPandemic ? " once 2020 and 2021 are left out" : "";
    if (countries.length === 1) {
      const k = skipped[0].years;
      return { error: `${capital(inSentence(countries[0].name))} has ${k === 0 ? "no year" : k === 1 ? "only 1 year" : `only ${k} years`} with both series between ${from} and ${to}${without}, and a line needs ${MIN_YEARS}. Widen the years or choose other countries.`, groups, skipped };
    }
    return { error: `${countries.length === 2 ? "Neither of the 2 countries ticked has" : `None of the ${countries.length} countries ticked has`} ${MIN_YEARS} years of both series between ${from} and ${to}${without}. Widen the years or choose other countries.`, groups, skipped };
  }
  const panel = fitPanel(groups);
  if (panel.error) return { error: `These years cannot be fitted: ${panel.error}. Widen the years or choose other countries.`, groups, skipped };
  const one = fitPanel([{ id: "all", name: "all", rows: groups.flatMap((g) => g.rows) }]);
  const periods = PERIODS[series].map(([a, b]) => {
    const gs = cut(a, b).filter((g) => g.rows.length >= MIN_YEARS);
    const fit = gs.length ? fitPanel(gs) : { error: "none" };
    return { from: a, to: b, fit: fit.error ? null : fit };
  });
  return {
    groups, skipped, panel, pooled: one.error ? null : one, periods,
    byCountry: groups.map((g) => ({ id: g.id, name: g.name, fit: fitCountry(g) })),
  };
}

/** The k observations furthest from the line, largest miss first. */
export const furthest = (fit, k = 5) => [...fit.residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, k);

/* ---------- words ---------- */

const ARTICLE = new Set(["Bahamas", "Central African Republic", "Comoros", "Dominican Republic", "Gambia", "Maldives", "Netherlands", "Philippines", "Solomon Islands", "United Arab Emirates", "United Kingdom", "United States", "Virgin Islands (U.S.)", "West Bank and Gaza"]);
/** A country's name as it reads inside a sentence: "the United States", "France". */
export const inSentence = (name) => (ARTICLE.has(name) ? `the ${name}` : name);
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** A signed figure to two decimals. One that would round to zero keeps two significant digits, so its sign is never lost. */
export const s2 = (x) => fmt.signed(x, x !== 0 && Math.abs(x) < 0.005 ? Math.min(6, 1 - Math.floor(Math.log10(Math.abs(x)))) : 2);
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
export const span = (fit) => (fit.years[0] === fit.years[1] ? `${fit.years[0]}` : `${fit.years[0]} to ${fit.years[1]}`);

/** One or two sentences on a fit. `who` is a country's name, or "" for a panel of several countries. */
export function describe(fit, { version = "change", who = "" } = {}) {
  const change = version === "change";
  const where = who
    ? `In ${who}, over the ${plural(fit.N, "year", "years")} from ${span(fit)}`
    : `Across ${plural(fit.G, "country", "countries")} and ${plural(fit.N, "country-year", "country-years")} from ${span(fit)}, with a separate intercept for each country`;
  const unit = change ? "points of unemployment per point of growth" : "points of unemployment per 1% of output above trend";
  const out = [`${where}, the fitted Okun coefficient is ${s2(fit.b)} ${unit} (95% interval ${s2(fit.lo)} to ${s2(fit.hi)}).`];
  const zero = fit.lo <= 0 && fit.hi >= 0;
  if (zero) out.push(`The interval includes zero, so these years do not show a link in either direction.`);
  else if (fit.b < 0) {
    out.push(change
      ? `A year with one more point of real GDP growth went with a change in the unemployment rate ${fmt.num(-fit.b, 2)} points lower.`
      : `A year in which output stood 1% further above its trend went with an unemployment rate ${fmt.num(-fit.b, 2)} points further below its own trend.`);
  } else out.push(`The sign is the opposite of Okun's law: more ${change ? "growth" : "output"} went with ${change ? "a larger rise in unemployment" : "higher unemployment"}.`);
  if (fit.r2 == null) out.push(`The ${change ? "change in unemployment" : "unemployment gap"} is the same in every year here, so there is no variation to explain.`);
  else out.push(`${change ? "Growth" : "The output gap"} accounts for ${fmt.pct(fit.r2, 0)} of the variation in ${change ? "the change in unemployment" : "the unemployment gap"}${who ? "" : " within countries"}.`);
  if (change) out.push(steadyWords(fit, who));
  return out.join(" ");
}

/** The growth rate at which the fitted line says unemployment does not change, in words. */
export function steadyWords(fit, who = "") {
  const st = fit.steady;
  if (!(fit.b < 0)) return "Because the line does not slope downwards, it gives no growth rate that holds unemployment steady.";
  if (!st.bounded) return `The slope is too uncertain to say what growth rate holds unemployment steady: ${unboundedWords(st)}.`;
  return `The line crosses zero at growth of ${fmt.num(st.value, 1)}% a year (95% interval ${fmt.num(st.lo, 1)}% to ${fmt.num(st.hi, 1)}%): ${who ? "" : "in the average country-year "}that is the growth at which unemployment neither rose nor fell.`;
}

/** A 95% interval with no end, in words: every rate, or every rate outside the one range that is ruled out. */
export function unboundedWords(st) {
  if (st.all) return "every rate is inside the 95% interval";
  if (st.gap) return `the 95% interval has no end in either direction and rules out only rates between ${fmt.num(st.gap[0], 1)}% and ${fmt.num(st.gap[1], 1)}%`;
  return "the 95% interval has no end";
}
/** The same for a table cell. */
export const unboundedCell = (st) => (st.gap ? `cannot be pinned down: only ${fmt.num(st.gap[0], 1)}% to ${fmt.num(st.gap[1], 1)}% is ruled out` : st.all ? "cannot be pinned down: no rate is ruled out" : "cannot be pinned down");

/** One observation that sits far from the line, in a sentence. */
export function missWords(r, version = "change") {
  const side = r.residual >= 0 ? "above" : "below";
  const miss = `${fmt.num(Math.abs(r.residual), 2)} points ${side} the line`;
  if (version === "change") {
    const move = Math.abs(r.y) < 0.005 ? "no change in the unemployment rate" : `a ${r.y > 0 ? "rise" : "fall"} in the unemployment rate of ${fmt.num(Math.abs(r.y), 2)} points`;
    return `${r.name} ${r.year}: growth of ${fmt.num(r.x, 1)}% and ${move}, ${miss}.`;
  }
  return `${r.name} ${r.year}: output ${fmt.num(Math.abs(r.x), 1)}% ${r.x >= 0 ? "above" : "below"} its trend and unemployment ${fmt.num(Math.abs(r.y), 2)} points ${r.y >= 0 ? "above" : "below"} its trend, ${miss}.`;
}
