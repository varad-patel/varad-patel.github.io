// Day 63: Momentum versus Mean Reversion. The model, with no DOM code.
// Monthly rules that hold an asset or not according to its own past return (time-series rules) or its rank among
// the chosen assets (cross-sectional rules), scored out of sample against buy-and-hold, with measures of how much
// of the best rule's record could come from trying many rules.

import { stats } from "../kit/kit.js";
import { ASSETS } from "../data/assets.js";

export const BILLS = ASSETS.assets.find((a) => a.id === "bills");
export const RISKY = ASSETS.assets.filter((a) => a.group !== "cash");
export const T = ASSETS.months;
export const MAX_LOOKBACK = 12;
/** First month index at which every rule in the grid can trade: a 12-month window that skips a month needs 13 months. */
export const WARMUP = MAX_LOOKBACK + 1;
const EULER = 0.5772156649015329;

export const RULES = [
  { id: "tsmom", kind: "ts", sign: 1, label: "Time-series momentum", short: "hold each asset after it beat bills" },
  { id: "tsrev", kind: "ts", sign: -1, label: "Time-series mean reversion", short: "hold each asset after it lagged bills" },
  { id: "csmom", kind: "cs", sign: 1, label: "Cross-sectional momentum", short: "hold the past winners" },
  { id: "csrev", kind: "cs", sign: -1, label: "Cross-sectional reversal", short: "hold the past losers" },
];
export const ruleOf = (id) => RULES.find((r) => r.id === id);

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const [Y0, M0] = ASSETS.first.split("-").map(Number);
/** { year, month (0-11) } of return index i. */
export const monthAt = (i) => { const k = (M0 - 1) + i; return { year: Y0 + Math.floor(k / 12), month: ((k % 12) + 12) % 12 }; };
export const monthLabel = (i) => { const d = monthAt(i); return `${MONTH_NAMES[d.month]} ${d.year}`; };
/** Return index of January of a year. */
export const indexOfYear = (year) => (year - Y0) * 12 + (1 - M0);

/** cum[0] = 0 and cum[t + 1] = cum[t] + ln(1 + r[t]), so months a..b compound to exp(cum[b + 1] - cum[a]) - 1. */
export function cumLog(r) {
  const c = new Float64Array(r.length + 1);
  for (let t = 0; t < r.length; t++) c[t + 1] = c[t] + Math.log1p(r[t]);
  return c;
}

/** The chosen assets' returns, the bills, and their running log sums. */
export function prepare(ids) {
  const chosen = ids.map((id) => RISKY.find((a) => a.id === id)).filter(Boolean);
  const R = chosen.map((a) => Float64Array.from(a.returns));
  const B = Float64Array.from(BILLS.returns);
  return { ids: chosen.map((a) => a.id), assets: chosen, R, B, cums: R.map(cumLog), cumB: cumLog(B), n: R.length, T: B.length };
}

/** Return over the `lookback` months that end `skip` months before month t (information available at the end of t - 1). */
export function trailing(cum, t, lookback, skip) {
  const end = t - skip, start = end - lookback;
  if (start < 0 || end > cum.length - 1) return NaN;
  return Math.exp(cum[end] - cum[start]) - 1;
}

/**
 * Target weights for month t, decided at the end of month t - 1. Returns an array of n weights; what is left is in bills.
 * Time-series: each asset has a 1/n slot, filled with the asset when its trailing return beat bills (momentum) or fell
 * short of them (reversal) by any amount, and with bills otherwise. Cross-sectional: the k assets with the highest
 * (momentum) or lowest (reversal) trailing return get 1/k each; ties go to the asset listed first.
 */
export function weights(data, v, t) {
  const { n, cums, cumB } = data;
  const rule = ruleOf(v.rule);
  const w = new Array(n).fill(0);
  if (rule.kind === "ts") {
    const cash = trailing(cumB, t, v.lookback, v.skip);
    for (let i = 0; i < n; i++) {
      const excess = trailing(cums[i], t, v.lookback, v.skip) - cash;
      if (rule.sign * excess > 0) w[i] = 1 / n;
    }
  } else {
    const k = Math.min(v.k, n);
    const order = cums.map((c, i) => ({ i, s: rule.sign * trailing(c, t, v.lookback, v.skip) }))
      .sort((a, b) => b.s - a.s || a.i - b.i);
    for (let j = 0; j < k; j++) w[order[j].i] = 1 / k;
  }
  return w;
}

/**
 * Run a rule over months from..to (inclusive), starting from cash. cost is the charge per unit of value traded, one way
 * (0.001 is 0.1%). Turnover is the sum over assets of |target weight - weight after last month's drift|, and the
 * month's return is (1 - cost x turnover)(1 + gross return) - 1: the cost is paid before the money is invested.
 */
export function backtest(data, v, from, to, cost) {
  const { n, R, B } = data;
  const len = to - from + 1;
  const net = new Float64Array(len), turnover = new Float64Array(len), invested = new Float64Array(len);
  const held = new Float64Array(n);
  let drift = new Array(n).fill(0);
  for (let t = from; t <= to; t++) {
    const w = weights(data, v, t);
    let turn = 0, gross = 0, inRisky = 0;
    for (let i = 0; i < n; i++) {
      turn += Math.abs(w[i] - drift[i]);
      gross += w[i] * R[i][t];
      inRisky += w[i];
      if (w[i] > 0) held[i]++;
    }
    gross += (1 - inRisky) * B[t];
    net[t - from] = (1 - cost * turn) * (1 + gross) - 1;
    turnover[t - from] = turn;
    invested[t - from] = inRisky;
    drift = w.map((wi, i) => (wi * (1 + R[i][t])) / (1 + gross));
  }
  return { net, turnover, invested, held: Array.from(held, (h) => h / len) };
}

/** Equal amounts in every chosen asset at the start of month `from`, never traded again; one entry cost. */
export function buyAndHold(data, from, to, cost) {
  const { n, R } = data;
  const len = to - from + 1;
  const net = new Float64Array(len);
  const value = new Array(n).fill(1 / n);
  for (let t = from; t <= to; t++) {
    const before = stats.sum(value);
    for (let i = 0; i < n; i++) value[i] *= 1 + R[i][t];
    const r = stats.sum(value) / before - 1;
    net[t - from] = t === from ? (1 - cost) * (1 + r) - 1 : r;
  }
  return { net };
}

/* ------------------------------------------------------------------ measures */

/** Sharpe ratio per month of returns r over bills b: mean of (r - b) over its standard deviation (n - 1). 0 when flat. */
export function sharpe(r, b) {
  const e = Array.from(r, (v, i) => v - b[i]);
  const sd = stats.sd(e);
  return sd > 1e-12 ? stats.mean(e) / sd : 0;
}

export function maxDrawdown(r) {
  let wealth = 1, peak = 1, worst = 0, at = -1, peakAt = -1, runPeak = -1;
  for (let t = 0; t < r.length; t++) {
    wealth *= 1 + r[t];
    if (wealth > peak) { peak = wealth; runPeak = t; }
    const dd = wealth / peak - 1;
    if (dd < worst) { worst = dd; at = t; peakAt = runPeak; }
  }
  return { depth: worst, trough: at, peak: peakAt };
}

/** Annualised summary of a monthly series r against bills b: x 12 for means, x sqrt 12 for spreads and Sharpe ratios. */
export function summary(r, b, turnover) {
  const growth = Array.from(r).reduce((g, v) => g * (1 + v), 1);
  return {
    months: r.length,
    growth,
    cagr: growth ** (12 / r.length) - 1,
    mean: 12 * stats.mean(r),
    vol: Math.sqrt(12) * stats.sd(r),
    sharpe: Math.sqrt(12) * sharpe(r, b),
    drawdown: maxDrawdown(r).depth,
    turnover: turnover ? 12 * stats.mean(turnover) : 0,
  };
}

/** Every rule the grid tries for n assets: 4 rules x lookbacks 1-12 x skip 0 or 1, and every k from 1 to n - 1. */
export function grid(n) {
  const out = [];
  for (const rule of RULES) {
    if (rule.kind === "cs" && n < 2) continue;
    for (let lookback = 1; lookback <= MAX_LOOKBACK; lookback++) for (const skip of [0, 1]) {
      if (rule.kind === "ts") out.push({ rule: rule.id, lookback, skip, k: 0 });
      else for (let k = 1; k < n; k++) out.push({ rule: rule.id, lookback, skip, k });
    }
  }
  return out;
}

export const variantKey = (v) => `${v.rule}|${v.lookback}|${v.skip}|${ruleOf(v.rule).kind === "cs" ? v.k : 0}`;
export function describe(v) {
  const rule = ruleOf(v.rule);
  const window = `${v.lookback}-month look-back${v.skip ? ", skipping the latest month" : ""}`;
  return rule.kind === "cs" ? `${rule.label}, ${window}, ${v.k} held` : `${rule.label}, ${window}`;
}

/* ------------------------------------------------------- selection and overfitting */

/** Inverse of the standard normal distribution function (Acklam's rational approximation, relative error below 1.2e-9). */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normalQuantile(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Expected largest Sharpe ratio among N independent trials whose true Sharpe ratio is zero and whose estimates spread
 * with variance V (Bailey and Lopez de Prado 2014): sqrt(V) ((1 - g) z(1 - 1/N) + g z(1 - 1/(N e))), g Euler's constant.
 */
export function expectedMaxSharpe(N, V) {
  if (!(N >= 2) || !(V >= 0)) return NaN;
  return Math.sqrt(V) * ((1 - EULER) * normalQuantile(1 - 1 / N) + EULER * normalQuantile(1 - 1 / (N * Math.E)));
}

/**
 * The same data with months 0..split-1 put in a random order (one permutation for every asset and the bills, so each
 * month's returns stay together). Any pattern over time in the training months is destroyed; what each month paid is
 * kept. The held-out months are left alone. `rand` is a seeded generator from the kit.
 */
export function shuffled(data, split, rand) {
  const order = rand.shuffle(Array.from({ length: split }, (_, i) => i));
  const mix = (x) => Float64Array.from(x, (v, t) => (t < split ? x[order[t]] : v));
  const R = data.R.map(mix), B = mix(data.B);
  return { ...data, R, B, cums: R.map(cumLog), cumB: cumLog(B) };
}

/** Best in-sample Sharpe ratio (per month) of the whole grid on one data set: the reshuffling benchmark's unit of work. */
export function bestInSample(data, split, cost, rules) {
  const bIn = data.B.subarray(WARMUP, split);
  let best = -Infinity;
  for (const v of rules) best = Math.max(best, sharpe(backtest(data, v, WARMUP, split - 1, cost).net, bIn));
  return best;
}

/**
 * Probability of backtest overfitting by combinatorially symmetric cross-validation (Bailey, Borwein, Lopez de Prado
 * and Zhu 2017). `excess` holds one array of monthly excess returns per rule over the same months. The months are cut
 * into S equal blocks (the earliest months that do not fill a block are dropped); for every way of choosing half the
 * blocks, the rule with the best Sharpe ratio on that half is ranked on the other half. omega is its rank divided by
 * (N + 1), the logit is ln(omega / (1 - omega)), and PBO is the share of splits with a logit of zero or below: the
 * in-sample winner landed in the bottom half out of sample.
 */
export function pbo(excess, S = 10) {
  const N = excess.length, len = excess[0].length;
  const size = Math.floor(len / S), skipped = len - size * S;
  if (N < 2 || size < 2) return null;
  // Per rule and block: sum and sum of squares.
  const s1 = excess.map((x) => Array.from({ length: S }, (_, b) => { let s = 0; for (let t = 0; t < size; t++) s += x[skipped + b * size + t]; return s; }));
  const s2 = excess.map((x) => Array.from({ length: S }, (_, b) => { let s = 0; for (let t = 0; t < size; t++) s += x[skipped + b * size + t] ** 2; return s; }));
  const sr = (i, blocks) => {
    let a = 0, q = 0;
    for (const b of blocks) { a += s1[i][b]; q += s2[i][b]; }
    const m = blocks.length * size, mean = a / m, v = (q - m * mean * mean) / (m - 1);
    return v > 1e-24 ? mean / Math.sqrt(v) : 0;
  };
  const logits = [];
  const half = S / 2;
  const choose = (start, picked) => {
    if (picked.length === half) {
      const train = picked, test = [];
      for (let b = 0; b < S; b++) if (!train.includes(b)) test.push(b);
      let best = 0, bestSr = -Infinity;
      for (let i = 0; i < N; i++) { const v = sr(i, train); if (v > bestSr) { bestSr = v; best = i; } }
      const testSr = Array.from({ length: N }, (_, i) => sr(i, test));
      // Rank 1 is the worst; ties share the average rank.
      const mine = testSr[best];
      let below = 0, equal = 0;
      for (const v of testSr) { if (v < mine) below++; else if (v === mine) equal++; }
      const rank = below + (equal + 1) / 2;
      const omega = rank / (N + 1);
      logits.push(Math.log(omega / (1 - omega)));
      return;
    }
    for (let b = start; b < S; b++) choose(b + 1, [...picked, b]);
  };
  choose(0, []);
  return { pbo: logits.filter((l) => l <= 0).length / logits.length, splits: logits.length, logits, blockMonths: size, droppedMonths: skipped };
}

/**
 * Everything the page reports for one set of assets: the visitor's rule and the whole grid, fitted on months
 * WARMUP..split-1 and scored on split..T-1. Pure and deterministic; the page runs the grid part in slices.
 */
export function evaluateRule(data, v, split, cost) {
  const inS = backtest(data, v, WARMUP, split - 1, cost);
  const outS = backtest(data, v, split, data.T - 1, cost);
  const bIn = data.B.subarray(WARMUP, split), bOut = data.B.subarray(split);
  return {
    rule: v,
    inSample: { ...summary(inS.net, bIn, inS.turnover), invested: stats.mean(Array.from(inS.invested)), held: inS.held },
    outSample: { ...summary(outS.net, bOut, outS.turnover), invested: stats.mean(Array.from(outS.invested)), held: outS.held },
    netOut: outS.net, netIn: inS.net,
  };
}

/** Score every rule of the grid (the page does the same in slices). */
export function scoreGrid(data, split, cost, rules = grid(data.n)) {
  const bIn = data.B.subarray(WARMUP, split), bOut = data.B.subarray(split);
  return rules.map((v) => {
    const a = backtest(data, v, WARMUP, split - 1, cost).net, b = backtest(data, v, split, data.T - 1, cost).net;
    return { v, srIn: sharpe(a, bIn), srOut: sharpe(b, bOut), excessIn: Float64Array.from(a, (x, i) => x - bIn[i]) };
  });
}

/**
 * The overfitting measures for a scored grid. All Sharpe ratios here are per month; the page multiplies by sqrt 12.
 * The in-sample winner is the first rule in grid order with the highest in-sample Sharpe ratio.
 */
export function overfitting(scored) {
  const N = scored.length;
  const srIn = scored.map((s) => s.srIn), srOut = scored.map((s) => s.srOut);
  let best = 0;
  for (let i = 1; i < N; i++) if (srIn[i] > srIn[best]) best = i;
  const T = scored[best].excessIn.length;
  // Rank of the in-sample winner among all rules on the held-out months: 1 is the best, ties share the better place.
  const outRank = 1 + srOut.filter((v) => v > srOut[best]).length;
  return {
    N, best, winner: scored[best], T,
    // The luck of the best of N unrelated rules with no skill, each Sharpe estimate having variance 1 / T.
    independentMax: expectedMaxSharpe(N, 1 / T),
    outRank, outMedian: stats.median(srOut), outBetter: srOut.filter((v) => v > srOut[best]).length,
    corr: N > 2 ? stats.corr(srIn, srOut) : NaN,
    pbo: pbo(scored.map((s) => s.excessIn)),
  };
}

/** Where the real best stands among the reshuffled bests: the share of reshufflings whose best was at least as high. */
export function shuffleVerdict(realBest, shuffledBests) {
  const n = shuffledBests.length;
  const atLeast = shuffledBests.filter((v) => v >= realBest).length;
  return { n, atLeast, share: n ? atLeast / n : NaN, mean: stats.mean(shuffledBests), lo: stats.min(shuffledBests), hi: stats.max(shuffledBests) };
}
