// Day 65: Risk Calculator. The model, with no DOM code.
// A portfolio typed as amounts in each asset, its monthly returns over a window, and three measures of risk:
// volatility, maximum drawdown and the Sharpe ratio, each with the numbers that go into it.

import { stats } from "../kit/kit.js";
import { ASSETS } from "../data/assets.js";

export const ALL = ASSETS.assets;
export const T = ASSETS.months;
export const BILLS = ALL.find((a) => a.id === "bills");
const [Y0, M0] = ASSETS.first.split("-").map(Number);
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Month label of return index i; index -1 is the month before the first return (the starting value's month-end). */
export const monthLabel = (i) => { const k = M0 - 1 + i; return `${NAMES[((k % 12) + 12) % 12]} ${Y0 + Math.floor(k / 12)}`; };
export const startOfYear = (year) => Math.max(0, (year - Y0) * 12 + (1 - M0));
export const endOfYear = (year) => Math.min(T - 1, (year - Y0) * 12 + (12 - M0));
export const MIN_MONTHS = 12;
export const MAX_AMOUNT = 1e12;

/**
 * Read one typed amount in US dollars. Accepts digits, an optional decimal point and an optional leading dollar sign,
 * with the whole-number part either plain (2500), grouped in threes by commas, spaces or underscores (2,500,000), or
 * grouped the Indian way (25,00,000); empty means 0. Another currency's sign is refused rather than read as dollars,
 * since every figure the page prints is in dollars. Returns { value } or { error }.
 */
export function parseAmount(text) {
  const typed = String(text ?? "").trim();
  if (/^[£€₹¥]/.test(typed)) return { error: "is in another currency: type the amount in US dollars, the currency of every return here" };
  const raw = typed.replace(/^(US)?\$\s*/i, "");
  if (raw === "") return { value: 0 };
  if (raw.length > 24) return { error: "is too long: type the amount in figures, at most a trillion" };
  if (raw.startsWith("-")) return { error: "is negative: this calculator takes holdings of zero or more, not short positions" };
  const [whole, ...rest] = raw.split(".");
  const grouped = /^\d+$/.test(whole) || /^\d{1,3}([,_ ]\d{3})+$/.test(whole) || /^\d{1,2}(,\d{2})*,\d{3}$/.test(whole) || (whole === "" && rest.length === 1);
  if (rest.length > 1 || !grouped || !/^\d*$/.test(rest[0] ?? "") || raw === ".") return { error: "is not a number: use figures, for example 2500 or 2,500" };
  const s = raw.replace(/[,_ ]/g, "");
  const v = Number(s);
  if (!Number.isFinite(v)) return { error: "is not a number" };
  if (v > MAX_AMOUNT) return { error: "is more than a trillion" };
  return { value: v };
}

/** Weights from amounts: amount / total. null when nothing is held. */
export function weightsFrom(amounts) {
  const total = stats.sum(amounts);
  return total > 0 ? amounts.map((a) => a / total) : null;
}

/**
 * Monthly portfolio returns over months from..to.
 * "rebalanced": back to the starting weights at the start of every month, so r_t = sum_i w_i r_it.
 * "drift": bought once at the starting weights and never traded, so each holding grows with its own returns and
 * r_t = (value at the end of t) / (value at the end of t - 1) - 1.
 */
export function portfolioReturns(weights, from, to, mode = "rebalanced", assets = ALL) {
  const len = to - from + 1;
  const r = new Float64Array(len);
  if (mode === "rebalanced") {
    for (let t = 0; t < len; t++) { let s = 0; weights.forEach((w, i) => { if (w) s += w * assets[i].returns[from + t]; }); r[t] = s; }
  } else {
    const v = [...weights];
    for (let t = 0; t < len; t++) {
      const before = stats.sum(v);
      v.forEach((x, i) => { if (x) v[i] = x * (1 + assets[i].returns[from + t]); });
      r[t] = stats.sum(v) / before - 1;
    }
  }
  return r;
}

/**
 * Value of 1 at each month-end, W_0 = 1 before the first month, the running peak, and the drawdown W_t / peak_t - 1.
 * The maximum drawdown is the lowest drawdown; its peak is the last month-end before the fall at which the running
 * peak was set (-1 for the starting value), and recovery is the first later month-end at or above that peak.
 */
export function drawdown(r) {
  const n = r.length;
  const wealth = new Float64Array(n), dd = new Float64Array(n);
  let w = 1, peak = 1, peakAt = -1, worst = 0, troughAt = -1, worstPeakAt = -1;
  for (let t = 0; t < n; t++) {
    w *= 1 + r[t];
    wealth[t] = w;
    if (w >= peak) { peak = w; peakAt = t; }
    dd[t] = w / peak - 1;
    if (dd[t] < worst) { worst = dd[t]; troughAt = t; worstPeakAt = peakAt; }
  }
  let recoveredAt = -1;
  if (troughAt >= 0) {
    const level = worstPeakAt < 0 ? 1 : wealth[worstPeakAt];
    for (let t = troughAt + 1; t < n; t++) if (wealth[t] >= level) { recoveredAt = t; break; }
  }
  return { wealth, dd, depth: worst, peakAt: worstPeakAt, troughAt, recoveredAt, peakValue: worstPeakAt < 0 ? 1 : wealth[worstPeakAt], troughValue: troughAt < 0 ? 1 : wealth[troughAt] };
}

/**
 * Every measure the page shows, with the parts of each formula.
 *   volatility = sqrt(12) x sd(r)                       sd divides by T - 1
 *   Sharpe     = sqrt(12) x mean(r - rf) / sd(r - rf)   rf = Treasury bills over the same months
 *   return a year = (prod (1 + r))^(12 / T) - 1
 */
export function measures(r, rf) {
  const n = r.length;
  const ex = Array.from(r, (v, t) => v - rf[t]);
  const sdMonthly = stats.sd(r), exMean = stats.mean(ex), exSd = stats.sd(ex);
  const d = drawdown(r);
  const growth = n ? d.wealth[n - 1] : 1;
  let worst = 0, best = 0;
  for (let t = 1; t < n; t++) { if (r[t] < r[worst]) worst = t; if (r[t] > r[best]) best = t; }
  return {
    months: n,
    meanMonthly: stats.mean(r), sdMonthly, exMean, exSd, rfMean: stats.mean(rf),
    vol: Math.sqrt(12) * sdMonthly,
    sharpe: exSd > 1e-12 ? (Math.sqrt(12) * exMean) / exSd : NaN,
    mean: 12 * stats.mean(r),
    rfYear: 12 * stats.mean(rf),
    growth,
    cagr: growth ** (12 / n) - 1,
    drawdown: d,
    worstMonth: worst, bestMonth: best,
  };
}

/** Each holding's share of the portfolio's variance: w_i (S w)_i / (w' S w), from the monthly covariances. Adds up to 1. */
export function riskShares(weights, from, to, assets = ALL) {
  const idx = weights.map((w, i) => i).filter((i) => weights[i] !== 0);
  const R = idx.map((i) => assets[i].returns.slice(from, to + 1));
  const S = R.map((a) => R.map((b) => stats.cov(a, b)));
  const w = idx.map((i) => weights[i]);
  const Sw = S.map((row) => row.reduce((s, v, j) => s + v * w[j], 0));
  const total = w.reduce((s, v, k) => s + v * Sw[k], 0);
  const out = new Array(weights.length).fill(0);
  idx.forEach((i, k) => { out[i] = total > 0 ? (w[k] * Sw[k]) / total : NaN; });
  return out;
}
