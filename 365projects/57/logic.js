// Day 57: Phillips Curve Fitter. The model, with no DOM code.
// Straight lines fitted to yearly inflation and unemployment: by era, and over a moving window.

import { stats, fmt } from "../kit/kit.js";

/** An era needs this many years to be given a line. */
export const MIN_YEARS = 8;
export const MAX_BREAKS = 7;
export const WINDOW = { min: 8, max: 30, start: 15 };

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

/**
 * The unemployment series used for a country: the OECD's long series where there is one, otherwise the modelled ILO
 * series. One series per country, never a join of the two.
 */
export function seriesFor(country) {
  if (country.uOecd) return { key: "uOecd", label: "OECD Economic Outlook 119", short: "OECD series" };
  if (country.uIlo) return { key: "uIlo", label: "modelled ILO estimates (World Bank)", short: "modelled ILO estimates" };
  return null;
}

/**
 * One row per year with what the chosen version needs.
 *   "simple":    x = unemployment rate (%), y = consumer price inflation (%)
 *   "augmented": x = unemployment rate (%), y = inflation minus the year before's inflation (points)
 */
export function rowsFor(country, version = "simple") {
  const s = seriesFor(country);
  if (!s || !country.p) return [];
  const u = country[s.key], p = country.p, out = [];
  for (let year = Math.min(u[0], p[0]); year < Math.max(u[0] + u[1].length, p[0] + p[1].length); year++) {
    const un = at(u, year), inf = at(p, year), before = at(p, year - 1);
    if (un == null || inf == null) continue;
    if (version === "augmented") { if (before != null) out.push({ year, u: un, p: inf, x: un, y: inf - before }); }
    else out.push({ year, u: un, p: inf, x: un, y: inf });
  }
  return out;
}

/* ---------- fitting ---------- */

/**
 * Where a fitted line crosses zero, with Fieller's 95% interval: the values of x at which the line's own 95% band
 * includes zero. With d = x - xbar that is where A d^2 + B d + C <= 0. `bounded` is false when the slope cannot be told
 * from zero (A <= 0). The set then has no end: it is every x (`all`), or every x outside one range (`gap`: [low, high],
 * the only values ruled out).
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

/** Least-squares line through rows of { year, x, y }, with classical standard errors and a t interval. Null if it cannot be fitted. */
export function fitLine(rows) {
  const n = rows.length;
  if (n < 3) return null;
  const xbar = stats.mean(rows.map((r) => r.x)), ybar = stats.mean(rows.map((r) => r.y));
  let sxx = 0, sxy = 0, syy = 0;
  for (const r of rows) { sxx += (r.x - xbar) ** 2; sxy += (r.x - xbar) * (r.y - ybar); syy += (r.y - ybar) ** 2; }
  if (!(sxx > 0)) return null;
  const b = sxy / sxx, a = ybar - b * xbar, df = n - 2;
  const rss = Math.max(0, syy - b * sxy), s2 = rss / df, se = Math.sqrt(s2 / sxx), t = t975(df);
  return {
    n, a, b, se, df, t, lo: b - t * se, hi: b + t * se, s2, sxx, xbar, ybar, r2: syy > 0 ? 1 - rss / syy : null,
    years: [rows[0].year, rows[n - 1].year], xRange: [stats.min(rows.map((r) => r.x)), stats.max(rows.map((r) => r.x))],
    steady: crossing({ xbar, ybar, b, s2, n, sxx, t }),
  };
}

/**
 * Read the era breaks a visitor typed: years separated by commas or spaces. Each break is the first year of a new era.
 * first and last are the first and last years of the whole data set. Returns { breaks } (sorted) or { error } saying
 * what to fix.
 */
export function parseBreaks(text, first, last) {
  const raw = String(text ?? "").trim();
  if (raw.length > 200) return { error: "That is too long to be a list of years. Type up to seven years separated by commas, such as 1970, 1985, 2008." };
  if (!raw) return { breaks: [] };
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const breaks = [];
  for (const part of parts) {
    if (!/^\d{4}$/.test(part)) return { error: `"${part.slice(0, 20)}" is not a year. Type four-digit years separated by commas, such as 1970, 1985, 2008.` };
    const year = Number(part);
    if (year <= first || year > last) return { error: `${year} is outside the data. A break must be a year from ${first + 1} to ${last}.` };
    if (breaks.includes(year)) return { error: `${year} is listed twice. List each break once.` };
    breaks.push(year);
  }
  if (breaks.length > MAX_BREAKS) return { error: `That is ${breaks.length} breaks. The chart can tell at most ${MAX_BREAKS + 1} eras apart, so list ${MAX_BREAKS} years or fewer.` };
  return { breaks: breaks.sort((a, b) => a - b) };
}

/**
 * [first, last] split at the breaks that fall inside it: { eras: [[first, b1 - 1], [b1, b2 - 1], ..., [bk, last]], ignored }.
 * A break at or before `first`, or after `last`, would make an empty era, so it is set aside and listed in `ignored`.
 */
export function erasFrom(first, last, breaks) {
  const inside = breaks.filter((b) => b > first && b <= last);
  const starts = [first, ...inside];
  return { eras: starts.map((start, i) => [start, i + 1 < starts.length ? starts[i + 1] - 1 : last]), ignored: breaks.filter((b) => !inside.includes(b)) };
}

/** A line for each era: [{ from, to, rows, fit }]. fit is null when the era has fewer than MIN_YEARS years of data. */
export function fitEras(rows, eras) {
  return eras.map(([from, to]) => {
    const inside = rows.filter((r) => r.year >= from && r.year <= to);
    return { from, to, rows: inside, fit: inside.length >= MIN_YEARS ? fitLine(inside) : null };
  });
}

/**
 * Rolling regression: for every run of `width` calendar years in a row that all have data, the line fitted to those
 * years. Returns [{ start, end, fit }], labelled by the window's last year.
 */
export function rolling(rows, width) {
  const byYear = new Map(rows.map((r) => [r.year, r]));
  const out = [];
  if (!rows.length) return out;
  for (let end = rows[0].year + width - 1; end <= rows.at(-1).year; end++) {
    const w = [];
    for (let year = end - width + 1; year <= end; year++) if (byYear.has(year)) w.push(byYear.get(year));
    if (w.length !== width) continue;
    const fit = fitLine(w);
    if (fit) out.push({ start: end - width + 1, end, fit });
  }
  return out;
}

/* ---------- words ---------- */

const ARTICLE = new Set(["Bahamas", "Central African Republic", "Comoros", "Dominican Republic", "Gambia", "Maldives", "Netherlands", "Philippines", "Solomon Islands", "United Arab Emirates", "United Kingdom", "United States", "Virgin Islands (U.S.)", "West Bank and Gaza"]);
/** A country's name as it reads inside a sentence: "the United States", "France". */
export const inSentence = (name) => (ARTICLE.has(name) ? `the ${name}` : name);
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** A signed figure to two decimals. One that would round to zero keeps two significant digits, so its sign is never lost. */
export const s2 = (x) => fmt.signed(x, x !== 0 && Math.abs(x) < 0.005 ? Math.min(6, 1 - Math.floor(Math.log10(Math.abs(x)))) : 2);
export const years = (a, b) => (a === b ? `${a}` : `${a} to ${b}`);
/** "1970", "1970 and 1985", "1970, 1985 and 2008". */
export const listOf = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
/** A year in which the vertical axis moves this far swamps everything else in its era. */
export const EXTREME = 50;
/** The years whose inflation (or change in inflation) is beyond EXTREME in either direction. */
export const extremeYears = (rows) => rows.filter((r) => Math.abs(r.y) > EXTREME).map((r) => r.year);

/** One era's line in a sentence. `who` is the country's name as it reads after "In". */
export function describe(era, { version = "simple", who = "" } = {}) {
  const when = years(era.from, era.to), n = era.rows.length;
  if (!era.fit) {
    if (!n) return `${capital(who)} has no year with both figures in ${when}.`;
    if (n < MIN_YEARS) return `${when} has ${n === 1 ? "only 1 year" : `only ${n} years`} of data for ${who}, and a line needs at least ${MIN_YEARS}. Move a break to make the era longer.`;
    return `Unemployment was the same in every year of ${when} in ${who}, so no line can be fitted.`;
  }
  const f = era.fit, simple = version === "simple";
  const outcome = simple ? "inflation" : "the change in inflation";
  const out = [`In ${who} over the ${n} years with data from ${years(...f.years)}, the fitted slope is ${s2(f.b)} points of ${outcome} per point of unemployment (95% interval ${s2(f.lo)} to ${s2(f.hi)}).`];
  const zero = f.lo <= 0 && f.hi >= 0;
  if (zero) out.push("The interval includes zero: these years show no reliable link in either direction.");
  else if (f.b < 0) {
    out.push(simple
      ? `Years with unemployment one point higher had inflation ${fmt.num(-f.b, 2)} points lower: the downward curve Phillips drew.`
      : `In years with unemployment one point higher, inflation fell by ${fmt.num(-f.b, 2)} points more, or rose by that much less, than the year before.`);
  } else {
    out.push(simple
      ? "Years with higher unemployment had higher inflation: the opposite of the curve Phillips drew."
      : "In years with higher unemployment, inflation rose by more: the opposite of what the expectations-augmented curve predicts.");
  }
  if (f.r2 != null) out.push(`Unemployment accounts for ${fmt.pct(f.r2, 0)} of the year-to-year variation in ${outcome}.`);
  if (!simple) out.push(steadyWords(f));
  return out.join(" ");
}

/** A 95% interval with no end, in words: every rate, or every rate outside the one range that is ruled out. */
export function unboundedWords(st) {
  if (st.all) return "the 95% interval for that rate is unbounded and takes in every rate";
  if (st.gap) return `the 95% interval for that rate is unbounded in both directions and rules out only rates between ${fmt.num(st.gap[0], 1)}% and ${fmt.num(st.gap[1], 1)}%`;
  return "the 95% interval for that rate is unbounded";
}
/** The same for a table cell. */
export const unboundedCell = (st) => (st.gap ? `cannot be pinned down: only ${fmt.num(st.gap[0], 1)}% to ${fmt.num(st.gap[1], 1)}% is ruled out` : st.all ? "cannot be pinned down: no rate is ruled out" : "cannot be pinned down: the interval is unbounded");

/** The unemployment rate at which the fitted line says inflation is steady, in words. */
export function steadyWords(f) {
  if (!(f.b < 0)) return "Because the line does not slope downwards, it implies no unemployment rate at which inflation is steady.";
  if (!f.steady.bounded) return `The slope is too uncertain for the line to imply an unemployment rate at which inflation is steady: ${unboundedWords(f.steady)}.`;
  return `The line crosses zero at an unemployment rate of ${fmt.num(f.steady.value, 1)}% (95% interval ${fmt.num(f.steady.lo, 1)}% to ${fmt.num(f.steady.hi, 1)}%): the rate at which, on this line, inflation neither rises nor falls.`;
}
