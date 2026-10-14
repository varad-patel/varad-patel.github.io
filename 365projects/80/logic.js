// Day 80: Currency Prediction Lab. The model, with no DOM code.
// Month-end exchange rates for any pair of 23 currencies, three simple forecasting models fitted by least squares at
// every past month on the rates known then, and a scorecard of each against the random walk (no change).

import { stats } from "../kit/kit.js";

export const MAX_H = 36;          // the longest horizon, in months
export const MIN_FIT = 120;       // the first forecast is made with ten years of month-end rates behind it
export const PHI_MAX = 0.99;      // the largest autoregressive coefficient allowed in a stationary fit
const TIE = 1e-12;

export const MODELS = [
  { key: "drift", name: "Drift", order: "ARIMA(0,1,0) with drift", what: "the average monthly change so far, carried forward" },
  { key: "momentum", name: "Momentum", order: "ARIMA(1,1,0) with drift", what: "next month's change predicted from this month's" },
  { key: "reversion", name: "Reversion", order: "ARIMA(1,0,0) with a constant", what: "the rate pulled back towards its average" },
];

/* ---------------------------------------------------------- the data */

export const USD = { code: "USD", name: "US dollar" };

/** Units of the currency per US dollar, month by month from cur.start (the release quotes four of them the other way). */
export function perUsd(cur) {
  return Float64Array.from(cur.values, (v) => (cur.usdPerUnit ? 1 / v : v));
}

const monthIndex = (key) => { const [y, m] = key.split("-").map(Number); return y * 12 + m - 1; };
export const keyOf = (k) => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;

/**
 * The log of the price of one unit of `base` in units of `quote`, ln S = ln(quote per USD) - ln(base per USD), for
 * every month both have. Returns { start, logs, mixed } where mixed counts the months whose two month-end rates come
 * from different days (one currency had no rate on the last business day).
 */
export function pairSeries(fx, base, quote) {
  if (base === quote) throw new Error("choose two different currencies");
  const find = (code) => {
    if (code === "USD") return null;
    const c = fx.currencies.find((x) => x.code === code);
    if (!c) throw new Error(`no currency with the code ${code}`);
    return c;
  };
  const b = find(base), q = find(quote);
  const last = monthIndex(fx.last);
  const first = Math.max(b ? monthIndex(b.start) : -Infinity, q ? monthIndex(q.start) : -Infinity);
  const n = last - first + 1;
  const logs = new Float64Array(n);
  let mixed = 0;
  const bu = b && perUsd(b), qu = q && perUsd(q);
  for (let i = 0; i < n; i++) {
    const ib = b ? first - monthIndex(b.start) + i : 0, iq = q ? first - monthIndex(q.start) + i : 0;
    logs[i] = (q ? Math.log(qu[iq]) : 0) - (b ? Math.log(bu[ib]) : 0);
    if (b && q && b.days[ib] !== q.days[iq]) mixed++;
  }
  return { start: keyOf(first), logs, mixed };
}

/* ---------------------------------------------------------- the models */

/**
 * Least squares of y on x with an intercept, with the slope kept inside [lo, hi]: { a, b }. For a fixed slope the
 * best intercept is mean(y) - b mean(x), and what is left of the sum of squares is a parabola in b, so the best
 * slope inside the interval is the unconstrained one moved to the nearer end. With no spread in x the slope is 0.
 */
export function line(x, y, lo = -Infinity, hi = Infinity) {
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); }
  const b = Math.min(hi, Math.max(lo, sxx > 1e-300 ? sxy / sxx : 0));
  return { a: my - b * mx, b };
}

/**
 * Forecasts of ln S at t + 1 ... t + H made at the end of month t from the months a..t only.
 *   random walk  s_t
 *   drift        s_t + h mu,  mu = (s_t - s_a) / (t - a), the average monthly change
 *   momentum     w_u = c + phi w_(u-1) + e_u on the changes w_u = s_u - s_(u-1), run forward from w_t, |phi| <= 0.99
 *   reversion    s_u = a + rho s_(u-1) + e_u, run forward from s_t; with rho < 1 that is m + rho^h (s_t - m), m = a / (1 - rho);
 *                -0.99 <= rho <= 1
 * Each model is fitted by least squares, which for these models is the conditional sum of squares.
 */
export function forecastAt(logs, t, a = 0, H = MAX_H) {
  if (t - a + 1 < 4) throw new Error("too few months to fit the models");
  const s = logs;
  const mu = (s[t] - s[a]) / (t - a);
  const wPrev = [], wNext = [];
  for (let u = a + 2; u <= t; u++) { wPrev.push(s[u - 1] - s[u - 2]); wNext.push(s[u] - s[u - 1]); }
  // Momentum is kept stationary (|phi| at most 0.99) and reversion at most a unit root (rho at most 1, where it
  // becomes the drift model), as an ARIMA fit would; otherwise one wild pair of months can make a forecast explode.
  const mom = line(wPrev, wNext, -PHI_MAX, PHI_MAX);
  const lev = line(Array.from(s.subarray(a, t)), Array.from(s.subarray(a + 1, t + 1)), -PHI_MAX, 1);
  const out = { rw: [], drift: [], momentum: [], reversion: [], fit: { mu, c: mom.a, phi: mom.b, alpha: lev.a, rho: lev.b } };
  let w = s[t] - s[t - 1], m = s[t], r = s[t];
  for (let h = 1; h <= H; h++) {
    w = mom.a + mom.b * w;
    m += w;
    r = lev.a + lev.b * r;
    out.rw.push(s[t]);
    out.drift.push(s[t] + h * mu);
    out.momentum.push(m);
    out.reversion.push(r);
  }
  return out;
}

/** Every forecast date with at least MIN_FIT months behind it, up to the last month (whose forecasts are the live ones). */
export function originsFor(n, minFit = MIN_FIT) {
  const out = [];
  for (let t = minFit - 1; t < n; t++) out.push(t);
  return out;
}

/** The forecasts made at every date; window: how many months each fit uses, ending at its date (Infinity: all). */
export function rollAll(logs, { window = Infinity, minFit = MIN_FIT, H = MAX_H } = {}) {
  return originsFor(logs.length, minFit).map((t) => ({ t, ...forecastAt(logs, t, Math.max(0, t - window + 1), H) }));
}

/* ---------------------------------------------------------- scoring (the same rules as day 61) */

/**
 * The Diebold and Mariano (1995) test of equal accuracy on a loss differential d_t (model loss minus random walk loss).
 * The long-run variance uses Newey and West's weights over h - 1 lags, because forecasts h months ahead made a
 * month apart overlap:  S = g_0 + 2 sum_(j = 1..h-1) (1 - j / h) g_j,   DM = mean(d) / sqrt(S / n),
 * two-sided p-value from the standard normal. When every d is the same the test has nothing to measure:
 * stat 0 and p 1 if they are all zero, and no p-value at all if one forecast is always better by the same amount.
 */
export function dieboldMariano(d, h) {
  const n = d.length;
  if (n < 2) return { n, mean: n ? d[0] : NaN, stat: NaN, p: NaN };
  let mean = 0;
  for (const v of d) mean += v;
  mean /= n;
  let lo = Infinity, hi = -Infinity;
  for (const v of d) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo <= 1e-14 * (1 + Math.abs(hi) + Math.abs(lo))) return { n, mean, stat: hi === 0 && lo === 0 ? 0 : NaN, p: hi === 0 && lo === 0 ? 1 : NaN };
  const gamma = (j) => { let s = 0; for (let t = j; t < n; t++) s += (d[t] - mean) * (d[t - j] - mean); return s / n; };
  let S = gamma(0);
  for (let j = 1; j < Math.min(h, n); j++) S += 2 * (1 - j / h) * gamma(j);
  const stat = mean / Math.sqrt(S / n);
  return { n, mean, stat, p: 2 * (1 - stats.normalCdf(Math.abs(stat))) };
}

/** A mean absolute log error as a typical percentage miss: e^m - 1. */
export const asPercent = (m) => Math.exp(m) - 1;

/**
 * Score one model's forecasts made h months ahead at dates t with from <= t <= to whose outcome is known, against
 * the random walk on the same dates. A miss is |ln forecast - ln outcome|. margin is 1 - (model's mean miss /
 * random walk's mean miss), rounded to three places: positive means the model's average miss was smaller, and a
 * difference of less than one part in 2,000 counts as level.
 */
export function scorecard(logs, records, h, key, { from = 0, to = Infinity } = {}) {
  const rows = [];
  for (const r of records) {
    if (r.t < from || r.t > to || r.t + h >= logs.length) continue;
    const actual = logs[r.t + h], mid = r[key][h - 1];
    rows.push({ t: r.t, target: r.t + h, mid, naive: logs[r.t], actual, model: Math.abs(mid - actual), naiveMiss: Math.abs(logs[r.t] - actual) });
  }
  const n = rows.length;
  if (!n) return { h, key, n: 0, rows };
  const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / n;
  const model = mean("model"), naive = mean("naiveMiss");
  const margin = naive > 0 ? Math.round((1 - model / naive) * 1000) / 1000 : 0;
  return {
    h, key, n, rows, model, naive, margin,
    closer: rows.filter((r) => r.model < r.naiveMiss - TIE).length / n,
    verdict: margin > 0 ? "ahead" : margin < 0 ? "behind" : "level",
    dm: dieboldMariano(rows.map((r) => r.model - r.naiveMiss), h),
  };
}

/** The running scorecard: after each forecast, the model's mean miss so far as a share of the random walk's. */
export function running(rows) {
  let a = 0, b = 0;
  return rows.map((r) => { a += r.model; b += r.naiveMiss; return { t: r.t, ratio: b > 0 ? a / b : 1 }; });
}

/** Every currency against the US dollar: the three scorecards for each, with the same settings. */
export function scanAgainstDollar(fx, h, { window = Infinity, fromYear = -Infinity, toYear = Infinity } = {}) {
  return fx.currencies.map((c) => {
    const p = pairSeries(fx, c.code, "USD");
    const records = rollAll(p.logs, { window });
    const k0 = monthIndex(p.start);
    const from = Number.isFinite(fromYear) ? fromYear * 12 - k0 : 0, to = Number.isFinite(toYear) ? (toYear + 1) * 12 - 1 - k0 : Infinity;
    return { code: c.code, name: c.name, scores: MODELS.map((m) => scorecard(p.logs, records, h, m.key, { from, to })) };
  });
}

/** Month labels. */
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (start, i, short = true) => { const k = monthIndex(start) + i; return `${short ? MONTHS[k % 12].slice(0, 3) : MONTHS[k % 12]} ${Math.floor(k / 12)}`; };
/** The 0-based month index of January of a year in a series starting at `start`. */
export const indexOfYear = (start, year) => year * 12 - monthIndex(start);
