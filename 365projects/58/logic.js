// Day 58: Commodity Seasonality Decomposer. Model: STL (Cleveland, Cleveland, McRae and Terpenning 1990),
// written from the paper's algorithm and its published Fortran, plus the forecast and its test on held-out months.
// Pure functions, no DOM.

export const PERIOD = 12;
export const HORIZON = 12;
export const Z80 = 1.2815515655446004; // the 90th percentile of the standard normal: an 80% interval is ± this many sd
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ------------------------------------------------------------------ loess */

/**
 * One loess value at position xs. Positions are 1, 2, ..., n as in the paper, and xs may be 0 or n + 1 (one step
 * outside the data). The q = len nearest points get tricube weights, times the robustness weights rw if given;
 * a straight line (deg 1) or a constant (deg 0) is fitted by weighted least squares and read off at xs.
 * Returns NaN when every weight is zero. w is scratch space of length n.
 */
function est(y, n, len, deg, xs, nleft, nright, w, rw) {
  let h = Math.max(xs - nleft, nright - xs);
  if (len > n) h += Math.floor((len - n) / 2);
  const h9 = 0.999 * h, h1 = 0.001 * h;
  let a = 0;
  for (let j = nleft; j <= nright; j++) {
    const r = Math.abs(j - xs);
    let v = 0;
    if (r <= h9) {
      if (r <= h1) v = 1; else { const q = r / h, u = 1 - q * q * q; v = u * u * u; }   // tricube
      if (rw) v *= rw[j - 1];
      a += v;
    }
    w[j - 1] = v;
  }
  if (!(a > 0)) return NaN;
  for (let j = nleft; j <= nright; j++) w[j - 1] /= a;
  if (h > 0 && deg > 0) {
    let mean = 0;
    for (let j = nleft; j <= nright; j++) mean += w[j - 1] * j;
    let c = 0;
    for (let j = nleft; j <= nright; j++) c += w[j - 1] * (j - mean) ** 2;
    // A slope is fitted only if the weighted points are spread out enough to pin one down.
    if (Math.sqrt(c) > 0.001 * (n - 1)) {
      const b = (xs - mean) / c;
      for (let j = nleft; j <= nright; j++) w[j - 1] *= b * (j - mean) + 1;
    }
  }
  let ys = 0;
  for (let j = nleft; j <= nright; j++) ys += w[j - 1] * y[j - 1];
  return ys;
}

/** Loess at every position 1..n with span len. Where no value can be computed the data point itself is kept. */
export function loess(y, len, deg = 1, rw = null) {
  const n = y.length;
  const out = new Float64Array(n);
  if (n < 2) { if (n) out[0] = y[0]; return out; }
  const w = new Float64Array(n);
  let nleft = 1, nright = Math.min(len, n);
  const half = Math.floor((len + 1) / 2);
  for (let i = 1; i <= n; i++) {
    if (len < n && i > half && nright !== n) { nleft++; nright++; }
    const v = est(y, n, len, deg, i, nleft, nright, w, rw);
    out[i - 1] = Number.isNaN(v) ? y[i - 1] : v;
  }
  return out;
}

/** Running mean of length len: n - len + 1 values. */
export function movingAverage(x, len) {
  const out = new Float64Array(x.length - len + 1);
  let s = 0;
  for (let i = 0; i < len; i++) s += x[i];
  out[0] = s / len;
  for (let i = len; i < x.length; i++) { s += x[i] - x[i - len]; out[i - len + 1] = s / len; }
  return out;
}

/* -------------------------------------------------------------------- STL */

const nextOdd = (x) => { const k = Math.ceil(x); return k % 2 ? k : k + 1; };
/** Cleveland's rule for the trend span: the smallest odd whole number at least 1.5 p / (1 - 1.5 / n_s). */
export const trendSpan = (period, seasonal) => nextOdd(1.5 * period / (1 - 1.5 / seasonal));
/** The low-pass span: the smallest odd whole number greater than the period. */
export const lowPassSpan = (period) => nextOdd(period + 1);

/** Step 2 of the inner loop: smooth each cycle-subseries (every January, every February, ...) and extend it one step each way. */
function cycleSubseries(x, period, span, deg, rw) {
  const n = x.length;
  const out = new Float64Array(n + 2 * period);
  for (let j = 0; j < period; j++) {
    const k = Math.floor((n - 1 - j) / period) + 1;
    const sub = new Float64Array(k);
    const subw = rw ? new Float64Array(k) : null;
    for (let i = 0; i < k; i++) { sub[i] = x[i * period + j]; if (rw) subw[i] = rw[i * period + j]; }
    const sm = loess(sub, span, deg, subw);
    const w = new Float64Array(k);
    let before = est(sub, k, span, deg, 0, 1, Math.min(span, k), w, subw);
    if (Number.isNaN(before)) before = sm[0];
    let after = est(sub, k, span, deg, k + 1, Math.max(1, k - span + 1), k, w, subw);
    if (Number.isNaN(after)) after = sm[k - 1];
    out[j] = before;
    for (let i = 0; i < k; i++) out[(i + 1) * period + j] = sm[i];
    out[(k + 1) * period + j] = after;
  }
  return out;
}

/** The robustness weights of the outer loop: bisquare of |residual| / (6 x the median absolute residual). */
export function robustnessWeights(y, fit) {
  const n = y.length;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = Math.abs(y[i] - fit[i]);
  const sorted = Float64Array.from(r).sort();
  const h = 3 * (sorted[Math.floor(n / 2)] + sorted[n - Math.floor(n / 2) - 1]); // six times the median
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = r[i] <= 0.001 * h ? 1 : r[i] <= 0.999 * h ? (1 - (r[i] / h) ** 2) ** 2 : 0;
  return out;
}

/**
 * Seasonal-trend decomposition by loess: y = trend + seasonal + remainder.
 *   period     n_p, observations per cycle (12 for monthly data)
 *   seasonal   n_s, the span of the loess that smooths each cycle-subseries: odd, 7 or more. Larger means a steadier season.
 *   periodic   true for a season that repeats exactly: the cycle-subseries are smoothed with a constant over a span
 *              that takes in every cycle (n_s = 10 n + 1, degree 0), and the seasonal component is then replaced by
 *              its average for each position in the cycle. This is what R's stl does for s.window = "periodic".
 *   trend      n_t, the span of the trend loess: odd, above the period. Default: Cleveland's rule.
 *   lowPass    n_l, the span of the low-pass loess: odd, above the period.
 *   robust     true for 15 passes of the outer loop with 2 inner passes each, false for 5 inner passes and none outer
 *              (the settings the paper recommends, and the defaults of the statsmodels implementation this is tested against).
 * All three loess fits are locally linear. Returns Float64Arrays plus the settings actually used.
 */
export function stl(y, { period = PERIOD, seasonal = 13, periodic = false, trend, lowPass, robust = true, inner, outer } = {}) {
  const n = y.length;
  if (!Number.isInteger(period) || period < 2) throw new Error("the period must be a whole number of 2 or more");
  if (n < 2 * period) throw new Error(`STL needs at least two full cycles (${2 * period} values), got ${n}`);
  for (let i = 0; i < n; i++) if (!Number.isFinite(y[i])) throw new Error(`value ${i + 1} is not a finite number`);
  if (periodic) seasonal = 10 * n + 1;
  const seasonalDeg = periodic ? 0 : 1;
  trend ??= trendSpan(period, seasonal);
  lowPass ??= lowPassSpan(period);
  const odd = (v) => Number.isInteger(v) && v % 2 === 1;
  if (!odd(seasonal) || seasonal < 3) throw new Error("the seasonal span must be an odd whole number of 3 or more");
  if (!odd(trend) || trend <= period) throw new Error("the trend span must be an odd whole number above the period");
  if (!odd(lowPass) || lowPass <= period) throw new Error("the low-pass span must be an odd whole number above the period");
  inner ??= robust ? 2 : 5;
  outer ??= robust ? 15 : 0;

  let T = new Float64Array(n);
  const S = new Float64Array(n);
  let rw = null;
  const work = new Float64Array(n);
  for (let pass = 0; pass <= outer; pass++) {
    for (let it = 0; it < inner; it++) {
      for (let i = 0; i < n; i++) work[i] = y[i] - T[i];                         // 1. detrend
      const C = cycleSubseries(work, period, seasonal, seasonalDeg, rw);         // 2. smooth the cycle-subseries
      const L = loess(movingAverage(movingAverage(movingAverage(C, period), period), 3), lowPass, 1); // 3. low-pass filter
      for (let i = 0; i < n; i++) S[i] = C[period + i] - L[i];                   // 4. the seasonal component
      for (let i = 0; i < n; i++) work[i] = y[i] - S[i];                         // 5. deseasonalise
      T = loess(work, trend, 1, rw);                                            // 6. smooth the trend
    }
    if (pass < outer) {
      for (let i = 0; i < n; i++) work[i] = T[i] + S[i];
      rw = robustnessWeights(y, work);
    }
  }
  if (periodic) {
    const mean = new Float64Array(period), count = new Float64Array(period);
    for (let i = 0; i < n; i++) { mean[i % period] += S[i]; count[i % period]++; }
    for (let i = 0; i < n; i++) S[i] = mean[i % period] / count[i % period];
  }
  const R = new Float64Array(n);
  for (let i = 0; i < n; i++) R[i] = y[i] - T[i] - S[i];
  return { trend: T, seasonal: S, remainder: R, weights: rw ?? new Float64Array(n).fill(1), settings: { period, seasonal, periodic, trend, lowPass, robust, inner, outer } };
}

/* ------------------------------------------------------------- summaries */

const variance = (a) => {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return s / (a.length - 1);
};

/**
 * Strength of seasonality and of trend (Wang, Smith and Hyndman 2006): 1 - Var(R) / Var(S + R), and the same with T,
 * floored at 0. Near 1 the season (or trend) dwarfs the remainder, near 0 it is lost in it.
 * A component whose variation is no more than rounding error (a constant series, say) scores 0.
 */
export function strength({ trend, seasonal, remainder }) {
  const vr = variance(remainder);
  const plus = (a) => Array.from(a, (v, i) => v + remainder[i]);
  const one = (comp) => { const v = variance(plus(comp)); return v > 1e-18 ? Math.max(0, 1 - vr / v) : 0; };
  return { seasonal: one(seasonal), trend: one(trend) };
}

/** "2014-01" plus i months, as { year, month (0-11), key }. */
export function monthAt(start, i) {
  const [y, m] = start.split("-").map(Number);
  const k = y * 12 + (m - 1) + i;
  const year = Math.floor(k / 12), month = k % 12;
  return { year, month, key: `${year}-${String(month + 1).padStart(2, "0")}` };
}
export const monthLabel = (start, i, short = true) => { const d = monthAt(start, i); return `${short ? MONTHS[d.month].slice(0, 3) : MONTHS[d.month]} ${d.year}`; };

/** The part of a series from January of fromYear (or from its own start if that is later). */
export function windowOf(series, fromYear) {
  const [y, m] = series.start.split("-").map(Number);
  const skip = Math.max(0, (fromYear - y) * 12 - (m - 1));
  return { start: monthAt(series.start, skip).key, values: series.values.slice(skip) };
}

const toLogs = (values) => {
  for (let i = 0; i < values.length; i++) if (!(values[i] > 0) || !Number.isFinite(values[i])) throw new Error(`price ${i + 1} is not a positive number`);
  return Float64Array.from(values, Math.log);
};

/* --------------------------------------------------------------- forecast */

/**
 * Forecast the twelve months after the end of a log series y from its STL fit.
 * The seasonally adjusted series a = y - S is carried forward unchanged and each month gets back the seasonal
 * value of the same month one year earlier: f(h) = a(last) + S(last - 12 + h).
 * The spread at h months ahead is the root mean square h-month change in a over the data so far, and the
 * 80% range is the forecast plus and minus 1.2816 spreads.
 */
export function forecastLog(y, fit) {
  const n = y.length, last = n - 1;
  const adj = (i) => y[i] - fit.seasonal[i];
  const out = [];
  for (let h = 1; h <= HORIZON; h++) {
    let ss = 0;
    for (let i = h; i < n; i++) ss += (adj(i) - adj(i - h)) ** 2;
    const spread = Math.sqrt(ss / (n - h));
    const mid = adj(last) + fit.seasonal[n - PERIOD + ((h - 1) % PERIOD)];
    out.push({ h, mid, spread, low: mid - Z80 * spread, high: mid + Z80 * spread });
  }
  return out;
}

/**
 * Decompose a price series in logs, ln(price) = trend + season + remainder, so that
 * price = trend x season x remainder, and forecast the next twelve months.
 * Returns the log components, the same three as multipliers, the seasonal multipliers of the latest twelve
 * months with their high and low, the two strengths, and the forecast in price units (its centre is a median).
 */
export function decompose(values, options = {}) {
  const logs = toLogs(values);
  const fit = stl(logs, options);
  const n = values.length;
  const latest = Array.from(fit.seasonal.slice(n - PERIOD), Math.exp); // multipliers for the last twelve months, oldest first
  let peak = 0, trough = 0;
  latest.forEach((v, i) => { if (v > latest[peak]) peak = i; if (v < latest[trough]) trough = i; });
  return {
    logs, ...fit,
    trendLevel: Array.from(fit.trend, Math.exp),
    seasonFactor: Array.from(fit.seasonal, Math.exp),
    remainderFactor: Array.from(fit.remainder, Math.exp),
    latest, peak: n - PERIOD + peak, trough: n - PERIOD + trough,
    swing: latest[peak] / latest[trough] - 1,
    strength: strength(fit),
    forecast: forecastLog(logs, fit).map((p) => ({ h: p.h, mid: Math.exp(p.mid), low: Math.exp(p.low), high: Math.exp(p.high), sameMonthLastYear: values[n - PERIOD + p.h - 1] })),
  };
}

/* ------------------------------------------------------- held-out testing */

export const MIN_TRAIN = 72;     // the first held-out forecast is made with six years of data
export const MAX_ORIGINS = 120;  // and at most the latest ten years of months are used as forecast origins

/** The numbers of months of data behind each held-out forecast: enough history behind, twelve known months ahead. */
export function backtestOrigins(n, { minTrain = MIN_TRAIN, maxOrigins = MAX_ORIGINS } = {}) {
  const lastOrigin = n - HORIZON;
  const out = [];
  for (let used = Math.max(minTrain, lastOrigin - maxOrigins + 1); used <= lastOrigin; used++) out.push(used);
  return out;
}

/**
 * One held-out test: using only the first `used` values, forecast the next twelve three ways and score each against
 * what happened. Errors are absolute differences of logs. "stl" is the forecast above, "seasonal" repeats the
 * same month of the last year, "last" repeats the latest month. "covered" says whether the 80% range held the outcome.
 */
export function backtestAt(logs, used, options = {}) {
  const y = logs.subarray(0, used);
  return forecastLog(y, stl(y, options)).map((p) => {
    const actual = logs[used + p.h - 1];
    return {
      h: p.h,
      stl: Math.abs(p.mid - actual),
      seasonal: Math.abs(logs[used - PERIOD + p.h - 1] - actual),
      last: Math.abs(logs[used - 1] - actual),
      covered: actual >= p.low && actual <= p.high,
    };
  });
}

/**
 * Add up held-out tests: mean absolute log error by method and by months ahead, how often the forecast was strictly
 * the closer one (ties, which is every twelfth-month forecast, count for neither), and how often the 80% range held
 * the outcome.
 * margin is how far the mean error of the forecast is below that of the better naive rule, as a share rounded to
 * three places (0.041 is 4.1% lower, negative is higher). beatsNaive is true only when that rounded margin is
 * above zero, so a forecast is never said to beat a rule by "0.0%".
 */
const TIE = 1e-9;
export function summarise(tests) {
  const methods = ["stl", "seasonal", "last"];
  const blank = () => ({ n: 0, stl: 0, seasonal: 0, last: 0, covered: 0, closerThanLast: 0, closerThanSeasonal: 0 });
  const byH = Array.from({ length: HORIZON }, blank);
  const all = blank();
  for (const test of tests) for (const e of test) {
    for (const b of [byH[e.h - 1], all]) {
      b.n++;
      for (const m of methods) b[m] += e[m];
      if (e.covered) b.covered++;
      // "Closer" needs a real difference: twelve months ahead all three forecasts are the same number, and a
      // difference in the sixteenth decimal place must not be counted as a win for either.
      if (e.stl < e.last - TIE) b.closerThanLast++;
      if (e.stl < e.seasonal - TIE) b.closerThanSeasonal++;
    }
  }
  const mean = (b) => ({ n: b.n, stl: b.stl / b.n, seasonal: b.seasonal / b.n, last: b.last / b.n, coverage: b.covered / b.n, closerThanLast: b.closerThanLast / b.n, closerThanSeasonal: b.closerThanSeasonal / b.n });
  const overall = mean(all);
  const bestNaive = overall.last <= overall.seasonal ? "last" : "seasonal";
  const margin = Math.round((1 - overall.stl / overall[bestNaive]) * 1000) / 1000;
  return { origins: tests.length, overall, byHorizon: byH.map(mean), bestNaive, margin, beatsNaive: margin > 0 };
}

/** A mean absolute log error as a typical percentage miss: e^m - 1. */
export const asPercent = (meanAbsLog) => Math.exp(meanAbsLog) - 1;

/** The whole held-out test in one call (the page runs it in slices instead). */
export function backtest(values, options = {}, limits = {}) {
  const logs = toLogs(values);
  return summarise(backtestOrigins(values.length, limits).map((used) => backtestAt(logs, used, options)));
}
