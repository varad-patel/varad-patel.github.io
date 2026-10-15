// Day 70: Fear and Greed Index. The model, with no DOM code.
// A monthly market mood index for Canadian shares built from three signals (momentum, volatility, breadth), each
// ranked against its own trailing history, then averaged with weights the visitor sets. Plus an out-of-sample test of
// whether the index forecasts the next months' change in the S&P/TSX Composite.

import { stats } from "../kit/kit.js";

export const MA_MONTHS = 10;      // moving average for momentum and breadth (about 200 trading days)
export const VOL_MONTHS = 6;      // months of returns in the volatility estimate
export const SWITCH = "2000-01";  // breadth uses the old TSE sector indices before this month and the S&P/TSX ones from it
export const BANDS = [
  { key: "xfear", label: "Extreme fear", lo: 0, hi: 20 },
  { key: "fear", label: "Fear", lo: 20, hi: 40 },
  { key: "neutral", label: "Neutral", lo: 40, hi: 60 },
  { key: "greed", label: "Greed", lo: 60, hi: 80 },
  { key: "xgreed", label: "Extreme greed", lo: 80, hi: 100 },
];
export const COMPONENTS = [
  { key: "momentum", label: "Momentum", what: "how far the composite stands above or below its 10-month average", greedy: "higher" },
  { key: "volatility", label: "Volatility", what: "the annualised standard deviation of the last 6 monthly returns", greedy: "lower" },
  { key: "breadth", label: "Breadth", what: "the share of sector indices above their own 10-month average", greedy: "higher" },
];

/* ------------------------------------------------------------------ months */

export function monthOf(start, i) {
  const [y, m] = start.split("-").map(Number);
  const k = y * 12 + (m - 1) + i;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}
export function indexOf(start, month) {
  const [y0, m0] = start.split("-").map(Number), [y, m] = month.split("-").map(Number);
  return (y - y0) * 12 + (m - m0);
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;

/** The band a score falls in. 20 is fear, 40 and 60 are neutral, 80 is greed: each edge goes to the band nearer the middle. */
export function band(score) {
  if (!Number.isFinite(score)) return null;
  if (score < 20) return BANDS[0];
  if (score < 40) return BANDS[1];
  if (score <= 60) return BANDS[2];
  if (score <= 80) return BANDS[3];
  return BANDS[4];
}

/* ------------------------------------------------------------------ the three raw signals */

/** Moving average of the last k values ending at each index (null until k values exist). */
export function movingAverage(values, k) {
  const out = new Array(values.length).fill(null);
  let s = 0;
  for (let i = 0; i < values.length; i++) {
    s += values[i];
    if (i >= k) s -= values[i - k];
    if (i >= k - 1) out[i] = s / k;
  }
  return out;
}

/** Raw signals for every month of the composite: momentum (ratio to the moving average, minus 1), volatility, breadth. */
export function signals(TSX) {
  const P = TSX.composite.values;
  const n = P.length;
  const start = TSX.composite.start;
  const ma = movingAverage(P, MA_MONTHS);
  const r = P.map((p, i) => (i ? Math.log(p / P[i - 1]) : null));
  const momentum = P.map((p, i) => (ma[i] == null ? null : p / ma[i] - 1));
  const volatility = P.map((_, i) => (i < VOL_MONTHS ? null : stats.sd(r.slice(i - VOL_MONTHS + 1, i + 1)) * Math.sqrt(12)));
  const groups = ["old", "new"].map((g) => ({ start: TSX[g].start, sectors: TSX[g].sectors.map((s) => ({ ...s, ma: movingAverage(s.values, MA_MONTHS) })) }));
  const breadth = new Array(n).fill(null), above = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const month = monthOf(start, i);
    const g = month < SWITCH ? groups[0] : groups[1];
    const j = indexOf(g.start, month);
    if (j < MA_MONTHS - 1 || j >= g.sectors[0].values.length) continue;
    const up = g.sectors.filter((s) => s.values[j] > s.ma[j]);
    breadth[i] = up.length / g.sectors.length;
    above[i] = { up: up.map((s) => s.short), of: g.sectors.length, set: month < SWITCH ? "old" : "new" };
  }
  return { start, n, price: P, momentum, volatility, breadth, above };
}

/* ------------------------------------------------------------------ scores and the index */

/**
 * Percentile of x[i] among the w values ending at i (itself included), from 0 (lowest) to 100 (highest), ties counted
 * as half. Uses no value after i. Null until w values exist.
 */
export function trailingPercentile(x, w) {
  const out = new Array(x.length).fill(null);
  for (let i = 0; i < x.length; i++) {
    if (x[i] == null || i - w + 1 < 0 || x[i - w + 1] == null) continue;
    let below = 0, equal = 0;
    for (let j = i - w + 1; j <= i; j++) { if (x[j] < x[i]) below++; else if (x[j] === x[i]) equal++; }
    out[i] = (100 * (below + (equal - 1) / 2)) / (w - 1);
  }
  return out;
}

/** Component scores (0 fear to 100 greed) and the weighted index. weights: { momentum, volatility, breadth }. */
export function buildIndex(sig, { window = 120, weights = { momentum: 1, volatility: 1, breadth: 1 } } = {}) {
  const total = COMPONENTS.reduce((s, c) => s + (weights[c.key] || 0), 0);
  if (!(total > 0)) return { error: "Give at least one component a weight above zero." };
  const scores = {
    momentum: trailingPercentile(sig.momentum, window),
    volatility: trailingPercentile(sig.volatility, window).map((v) => (v == null ? null : 100 - v)),
    breadth: trailingPercentile(sig.breadth, window),
  };
  const used = COMPONENTS.filter((c) => (weights[c.key] || 0) > 0);
  const index = sig.price.map((_, i) => {
    if (used.some((c) => scores[c.key][i] == null)) return null;
    return used.reduce((s, c) => s + weights[c.key] * scores[c.key][i], 0) / total;
  });
  const first = index.findIndex((v) => v != null);
  return { scores, index, first, weights, window, total };
}

/** Share of months in each band, over the months the index exists. */
export function bandShares(index) {
  const vals = index.filter((v) => v != null);
  return BANDS.map((b) => ({ ...b, n: vals.filter((v) => band(v) === b).length, share: vals.filter((v) => band(v) === b).length / vals.length }));
}

/* ------------------------------------------------------------------ does it forecast? */

/** Log change in the composite over the h months after each month (null where unknown). */
export function forward(price, h) {
  return price.map((p, i) => (i + h < price.length ? Math.log(price[i + h] / p) : null));
}

/** Upper tail of the standard normal. */
const upper = (z) => 1 - stats.normalCdf(z);

/** Mean and its Newey-West standard error with L lags (Bartlett weights). */
export function neweyWest(f, L) {
  const n = f.length;
  const m = stats.mean(f);
  const e = f.map((v) => v - m);
  let s = e.reduce((a, v) => a + v * v, 0) / n;
  for (let l = 1; l <= L; l++) {
    let c = 0;
    for (let t = l; t < n; t++) c += e[t] * e[t - l];
    s += 2 * (1 - l / (L + 1)) * (c / n);
  }
  return { mean: m, se: Math.sqrt(Math.max(s, 0) / n) };
}

/**
 * Recursive out-of-sample test. At each month t from `testFrom` on, fit y = a + b * index on every pair whose outcome
 * was known by t (index month s with s + h <= t), forecast y at t, and compare with the mean of the same outcomes
 * (the prevailing mean). Returns R2_OS (Campbell and Thompson), the Clark-West statistic and one-sided p-value, and
 * the forecasts. testFrom defaults to ten years after the index begins.
 */
export function oosTest(index, price, h, { testFrom } = {}) {
  const y = forward(price, h);
  const first = index.findIndex((v) => v != null);
  if (first < 0) return { error: "The index has no values." };
  const t0 = testFrom ?? first + 120;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0;
  let next = first; // next index month to add to the fitting sample
  const rows = [];
  for (let t = t0; t < price.length; t++) {
    if (index[t] == null || y[t] == null) continue;
    while (next + h <= t) {
      if (index[next] != null && y[next] != null) { const x = index[next], v = y[next]; sx += x; sy += v; sxx += x * x; sxy += x * v; k++; }
      next++;
    }
    if (k < 24) continue;
    const mx = sx / k, my = sy / k;
    const vx = sxx / k - mx * mx;
    const b = vx > 1e-12 ? (sxy / k - mx * my) / vx : 0;
    const fc = my + b * (index[t] - mx);
    rows.push({ t, actual: y[t], model: fc, mean: my, slope: b, n: k });
  }
  if (rows.length < 24) return { error: "Too few months to test: choose a shorter horizon or a shorter ranking window." };
  const sse = (key) => rows.reduce((s, r) => s + (r.actual - r[key]) ** 2, 0);
  const sseModel = sse("model"), sseMean = sse("mean");
  const r2 = 1 - sseModel / sseMean;
  const f = rows.map((r) => (r.actual - r.mean) ** 2 - ((r.actual - r.model) ** 2 - (r.mean - r.model) ** 2));
  const nw = neweyWest(f, h - 1);
  const cw = nw.se > 0 ? nw.mean / nw.se : 0;
  const lastSlope = rows.at(-1).slope;
  const hits = rows.filter((r) => Math.sign(r.model - r.mean) === Math.sign(r.actual - r.mean)).length;
  return { h, rows, n: rows.length, from: rows[0].t, to: rows.at(-1).t, r2, sseModel, sseMean, cw, p: upper(cw), slope: lastSlope, hits };
}

/**
 * Average percentage change in the composite over the next h months after the index sat in each band (all months,
 * overlapping; a description, not a test). Only months whose next h months are in the data count. A spell is a run of
 * such months in the same band; `runs` counts them and `firstMean` averages the change after each spell's first
 * month, so that a long spell counts once.
 */
export function byBand(index, price, h) {
  const y = forward(price, h);
  const all = [];
  const groups = BANDS.map((b) => ({ ...b, values: [], firsts: [], runs: 0 }));
  let last = null;
  index.forEach((v, i) => {
    if (v == null || y[i] == null) { last = null; return; }
    const g = groups.find((x) => x.key === band(v).key);
    const change = Math.expm1(y[i]);
    if (g !== last) { g.runs++; g.firsts.push(change); }
    last = g;
    all.push(change);
    g.values.push(change);
  });
  const mean = (a) => (a.length ? stats.mean(a) : NaN);
  return { h, all: { n: all.length, mean: stats.mean(all), up: all.filter((v) => v > 0).length / all.length }, groups: groups.map((g) => ({ ...g, n: g.values.length, mean: mean(g.values), firstMean: mean(g.firsts), up: g.values.length ? g.values.filter((v) => v > 0).length / g.values.length : NaN })) };
}

/** Correlation of the old and new breadth measures over the months both exist. */
export function overlap(TSX) {
  const series = ["old", "new"].map((g) => {
    const s = TSX[g];
    const mas = s.sectors.map((x) => movingAverage(x.values, MA_MONTHS));
    return { start: s.start, n: s.sectors[0].values.length, at: (j) => (j < MA_MONTHS - 1 ? null : s.sectors.filter((x, k) => x.values[j] > mas[k][j]).length / s.sectors.length) };
  });
  const a = [], b = [], months = [];
  for (let i = 0; i < 1000; i++) {
    const month = monthOf(series[1].start, i);
    const jo = indexOf(series[0].start, month), jn = i;
    if (jn >= series[1].n || jo >= series[0].n) break;
    const va = series[0].at(jo), vb = series[1].at(jn);
    if (va == null || vb == null) continue;
    a.push(va); b.push(vb); months.push(month);
  }
  return { n: a.length, from: months[0], to: months.at(-1), corr: stats.corr(a, b) };
}
