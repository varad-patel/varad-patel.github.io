// Day 61: Gold Price Forecaster. The model, with no DOM code.
// ARIMA(p, 1, q) on the log price, fitted by conditional sum of squares, its order chosen by AICc at every
// forecast date, scored month by month against the naive forecast (no change) on forecasts made with only the
// prices known at the time.

import { stats } from "../kit/kit.js";

export const MAX_H = 24;                      // the longest horizon, in months
export const FIRST_ORIGIN = 120;              // the first forecast is made at the end of January 1985, ten years in
export const Z80 = 1.2815515655446004;        // 90th percentile of the standard normal: an 80% band is ± this many sd
export const Z95 = 1.959963984540054;         // 97.5th percentile: a 95% band
const START = 2;                              // every model's sum of squares starts at the third monthly change
const TIE = 1e-12;

/** The candidate orders: p + q at most 2, each with and without drift (twelve models). */
export const CANDIDATES = [];
for (const drift of [false, true]) for (let p = 0; p <= 2; p++) for (let q = 0; p + q <= 2; q++) CANDIDATES.push({ p, q, drift });

/** The models a visitor can choose. "auto" picks among CANDIDATES by AICc at every forecast date. */
export const MODELS = {
  auto: { label: "ARIMA, chosen by AICc each month", candidates: CANDIDATES },
  ma1: { label: "ARIMA(0,1,1), no drift", candidates: [{ p: 0, q: 1, drift: false }] },
  drift: { label: "Random walk with drift", candidates: [{ p: 0, q: 0, drift: true }] },
};

export const orderName = (m) => `ARIMA(${m.p},1,${m.q})${m.drift ? " with drift" : ""}`;

export function toLogs(values) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) throw new Error("the prices must be a list of numbers");
  for (let i = 0; i < values.length; i++) if (!(values[i] > 0) || !Number.isFinite(values[i])) throw new Error(`price ${i + 1} is not a positive number`);
  return Float64Array.from(values, Math.log);
}

/* ---------------------------------------------------------- parameters */

/**
 * Partial autocorrelations in (-1, 1) to the coefficients of a stationary AR polynomial, by the Durbin-Levinson
 * recursion: phi(k)_k = r_k, phi(k)_j = phi(k-1)_j - r_k phi(k-1)_(k-j). Every r in (-1, 1) gives a stationary
 * polynomial and every stationary polynomial has such r (Barndorff-Nielsen and Schou 1973), so an optimiser can
 * search freely over atanh(r).
 */
export function fromPacf(r) {
  let phi = [];
  for (let k = 0; k < r.length; k++) {
    const next = phi.map((v, j) => v - r[k] * phi[k - 1 - j]);
    next.push(r[k]);
    phi = next;
  }
  return phi;
}

/** Unconstrained vector -> { phi, theta, mu }. MA: theta = -fromPacf(r), so 1 + theta_1 B + ... is invertible. */
function unpack(x, p, q, drift, muCentre, muScale) {
  return {
    phi: fromPacf(x.slice(0, p).map(Math.tanh)),
    theta: fromPacf(x.slice(p, p + q).map(Math.tanh)).map((v) => -v),
    mu: drift ? muCentre + muScale * x[p + q] : 0,
  };
}

/* ---------------------------------------------------------- fitting */

/**
 * Conditional sum of squares of an ARMA(p, q) with mean mu on the changes w, starting at index `start`:
 *   e_t = (w_t - mu) - sum phi_i (w_(t-i) - mu) - sum theta_j e_(t-j),   with e_t = 0 before start.
 * Returns { sse, e }.
 */
export function css(w, phi, theta, mu, start = START, e = new Float64Array(w.length)) {
  const n = w.length, p = phi.length, q = theta.length;
  let sse = 0;
  for (let t = start; t < n; t++) {
    let v = w[t] - mu;
    for (let i = 0; i < p; i++) v -= phi[i] * (w[t - 1 - i] - mu);
    for (let j = 0; j < q; j++) if (t - 1 - j >= start) v -= theta[j] * e[t - 1 - j];
    e[t] = v;
    sse += v * v;
  }
  return { sse, e };
}

/** Nelder and Mead's simplex minimiser. Returns { x, f, evals }. */
export function nelderMead(f, x0, { step = 0.1, tol = 1e-10, xtol = 1e-6, maxEvals = 4000 } = {}) {
  const n = x0.length;
  if (n === 0) return { x: [], f: f([]), evals: 1 };
  let evals = 0;
  const F = (x) => { evals++; return f(x); };
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; pts.push(x); }
  let vals = pts.map(F);
  while (evals < maxEvals) {
    const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = order.map((i) => pts[i]); vals = order.map((i) => vals[i]);
    const spread = Math.max(...pts.slice(1).map((x) => Math.max(...x.map((v, j) => Math.abs(v - pts[0][j])))));
    if (vals[n] - vals[0] <= tol * (Math.abs(vals[0]) + tol) && spread < xtol) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const along = (t) => c.map((v, j) => v + t * (pts[n][j] - v));
    const xr = along(-1), fr = F(xr);
    if (fr < vals[0]) {
      const xe = along(-2), fe = F(xe);
      if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      pts[n] = xr; vals[n] = fr;
    } else {
      const xc = fr < vals[n] ? along(-0.5) : along(0.5), fc = F(xc);
      if (fc < Math.min(fr, vals[n])) { pts[n] = xc; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); vals[i] = F(pts[i]); }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: pts[best], f: vals[best], evals };
}

/**
 * Fit ARIMA(p, 1, q), with a drift mu or without, to the log prices y by conditional sum of squares.
 * Every model starts its sum of squares at the same month, so their AICc values can be compared.
 *   sigma2 = SSE / N,   log L = -N/2 (ln(2 pi sigma2) + 1),   k = p + q + (drift ? 1 : 0) + 1
 *   AICc = -2 log L + 2k + 2k(k + 1) / (N - k - 1)
 * init: an earlier fit of the same order to start the search from (the previous month's, say).
 */
export function fitArima(y, { p, q, drift }, init = null) {
  const w = new Float64Array(y.length - 1);
  for (let i = 1; i < y.length; i++) w[i - 1] = y[i] - y[i - 1];
  const N = w.length - START;
  const k = p + q + (drift ? 1 : 0) + 1;
  if (N - k - 1 < 10) throw new Error(`too few months to fit ${orderName({ p, q, drift })}`);
  let mean = 0;
  for (let t = START; t < w.length; t++) mean += w[t];
  mean /= N;
  let ss = 0;
  for (let t = START; t < w.length; t++) ss += (w[t] - mean) ** 2;
  const scale = Math.sqrt(ss / (N - 1) / N) || 1e-6; // the standard error of the mean change: the search moves mu in these steps
  const dim = p + q + (drift ? 1 : 0);
  let x0 = new Array(dim).fill(0);
  if (init && init.p === p && init.q === q && init.drift === drift) {
    x0 = init.x.slice();
    if (drift) x0[p + q] = (init.mu - mean) / scale;
  }
  // With no moving-average part the sum of squares is that of a linear regression of w_t on its own p lags (and a
  // constant with drift), so least squares gives the minimum directly whenever it lands on a stationary model.
  let opt = q === 0 ? leastSquaresAr(w, p, drift, mean, scale) : null;
  if (!opt) {
    const scratch = new Float64Array(w.length);
    const objective = (x) => { const m = unpack(x, p, q, drift, mean, scale); return css(w, m.phi, m.theta, m.mu, START, scratch).sse; };
    // With both an AR and an MA term the sum of squares can have a second valley along phi = -theta, where the two
    // nearly cancel, and a start carried over from last month can sit in the wrong one (a ten-year window found sums
    // of squares up to 26 times too large that way). So start also in each valley and at the best point of a coarse grid,
    // keep the lowest, and restart the simplex once from there, since a simplex can stall before the bottom.
    const starts = [x0];
    if (p && q) {
      for (const a of [0.7, -0.7]) starts.push([...new Array(p + q).fill(Math.atanh(a)), ...(drift ? [0] : [])]);
      // and from the best point of a coarse grid of partial autocorrelations, -0.9 to 0.9 in steps of 0.2
      let g = null;
      for (let a = -0.9; a < 0.95; a += 0.2) for (let b = -0.9; b < 0.95; b += 0.2) {
        const x = [Math.atanh(a), Math.atanh(b), ...(drift ? [0] : [])], f = objective(x);
        if (!g || f < g.f) g = { x, f };
      }
      starts.push(g.x);
    }
    for (const s of starts) {
      const o = nelderMead(objective, s, { step: s === x0 && init ? 0.02 : 0.1 });
      if (!opt || o.f < opt.f) opt = o;
    }
    opt = nelderMead(objective, opt.x, { step: 0.02 });
  }
  const m = unpack(opt.x, p, q, drift, mean, scale);
  const { sse, e } = css(w, m.phi, m.theta, m.mu);
  const sigma2 = sse / N;
  const logL = -N / 2 * (Math.log(2 * Math.PI * sigma2) + 1);
  const aicc = -2 * logL + 2 * k + 2 * k * (k + 1) / (N - k - 1);
  return { p, q, drift, phi: m.phi, theta: m.theta, mu: m.mu, sigma2, sse, N, k, logL, aicc, x: opt.x, w, e, last: y[y.length - 1] };
}

/** AR polynomial coefficients back to partial autocorrelations (the Durbin-Levinson recursion run backwards). */
export function toPacf(phi) {
  let a = phi.slice();
  const r = new Array(a.length);
  for (let k = a.length - 1; k >= 0; k--) {
    r[k] = a[k];
    if (!(Math.abs(r[k]) < 1)) return null;
    a = a.slice(0, k).map((v, j) => (v + r[k] * a[k - 1 - j]) / (1 - r[k] * r[k]));
  }
  return r;
}

/** Least squares for ARIMA(p, 1, 0): the unconstrained vector of the optimum, or null if it is not stationary. */
function leastSquaresAr(w, p, drift, mean, scale) {
  if (p === 0) return { x: drift ? [0] : [] }; // mu = the mean change, or no parameter at all
  const X = [], Y = [];
  for (let t = START; t < w.length; t++) { const row = []; for (let i = 1; i <= p; i++) row.push(w[t - i]); X.push(row); Y.push(w[t]); }
  const fit = stats.ols(X, Y, { intercept: drift });
  const phi = drift ? fit.beta.slice(1) : fit.beta;
  const r = toPacf(phi);
  if (!r || r.some((v) => Math.abs(v) > 0.999999)) return null;
  const x = r.map(Math.atanh);
  if (drift) x.push((fit.beta[0] / (1 - phi.reduce((s, v) => s + v, 0)) - mean) / scale);
  return { x };
}

/** Fit every candidate and keep the lowest AICc. prev: the fits from the previous date, by order, to start from. */
export function selectArima(y, candidates = CANDIDATES, prev = null) {
  let best = null;
  const fits = {};
  for (const c of candidates) {
    const key = orderName(c);
    const f = fitArima(y, c, prev ? prev[key] : null);
    fits[key] = f;
    if (!best || f.aicc < best.aicc - TIE) best = f;
  }
  return { best, fits };
}

/* ---------------------------------------------------------- forecasting */

/**
 * psi weights of the ARMA part: psi_0 = 1, psi_j = theta_j + sum_(i = 1..min(j, p)) phi_i psi_(j - i).
 * For the integrated series the weights add up: Psi_j = psi_0 + ... + psi_j, and the h-month forecast error has
 * variance sigma2 (Psi_0^2 + ... + Psi_(h-1)^2).
 */
export function psiWeights(phi, theta, H) {
  const psi = [1];
  for (let j = 1; j < H; j++) {
    let v = j <= theta.length ? theta[j - 1] : 0;
    for (let i = 1; i <= Math.min(j, phi.length); i++) v += phi[i - 1] * psi[j - i];
    psi.push(v);
  }
  return psi;
}

/**
 * Forecasts of the log price 1 to H months after the last month of the fit: the median mid, and the sd of the
 * forecast error. The changes are forecast by the ARMA recursion with future shocks set to zero and added up.
 */
export function forecastArima(fit, H = MAX_H) {
  const { phi, theta, mu, w, e, sigma2, last } = fit;
  const n = w.length;
  const W = Array.from(w), E = Array.from(e);
  const mid = [], sd = [];
  let level = last;
  const psi = psiWeights(phi, theta, H);
  let cum = 0, v = 0;
  for (let h = 1; h <= H; h++) {
    const t = n + h - 1;
    let x = mu;
    for (let i = 0; i < phi.length; i++) x += phi[i] * (W[t - 1 - i] - mu);
    for (let j = 0; j < theta.length; j++) x += theta[j] * (t - 1 - j < n ? E[t - 1 - j] : 0);
    W.push(x);
    level += x;
    cum += psi[h - 1];
    v += cum * cum;
    mid.push(level);
    sd.push(Math.sqrt(sigma2 * v));
  }
  return { mid, sd };
}

/* ---------------------------------------------------------- rolling origin */

/**
 * Forecasts made at the end of month t (0-based) from the prices up to and including t, for every t in origins.
 * Returns a stepper so the page can run it in slices: next() fits one more date and returns false when done.
 * Each record: { t, order (the chosen model), mid[h - 1], sd[h - 1] } for h = 1..H.
 * window: how many months of prices each fit uses, ending at t (Infinity: every month from the start).
 */
export function roller(logs, modelKey, origins, { H = MAX_H, window = Infinity } = {}) {
  const candidates = MODELS[modelKey].candidates;
  const records = [];
  let prev = null, i = 0;
  return {
    records,
    get done() { return i >= origins.length; },
    get progress() { return i / origins.length; },
    next() {
      if (i >= origins.length) return false;
      const t = origins[i++];
      const { best, fits } = selectArima(logs.subarray(Math.max(0, t + 1 - window), t + 1), candidates, prev);
      prev = fits;
      const f = forecastArima(best, H);
      records.push({ t, order: { p: best.p, q: best.q, drift: best.drift }, mid: f.mid, sd: f.sd, fit: i === origins.length ? best : null });
      return i < origins.length;
    },
  };
}

/** Every forecast date from FIRST_ORIGIN on, up to and including the last month (whose forecasts are the live ones). */
export function originsFor(n, first = FIRST_ORIGIN) {
  const out = [];
  for (let t = first; t < n; t++) out.push(t);
  return out;
}

/* ---------------------------------------------------------- scoring */

/**
 * The Diebold and Mariano (1995) test of equal accuracy on a loss differential d_t (model loss minus naive loss).
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
 * Score the forecasts made h months ahead at dates t with from <= t <= to (0-based months) whose outcome is known.
 * A miss is |ln forecast - ln outcome|; the naive forecast is the latest price, unchanged.
 * margin is 1 - (model's mean miss / naive mean miss), rounded to three places: positive means the model's average
 * miss was smaller, and a difference of less than one part in 2,000 counts as level.
 */
export function scorecard(logs, records, h, { from = 0, to = Infinity } = {}) {
  const rows = [];
  for (const r of records) {
    if (r.t < from || r.t > to || r.t + h >= logs.length) continue;
    const actual = logs[r.t + h], mid = r.mid[h - 1], sd = r.sd[h - 1];
    rows.push({
      t: r.t, target: r.t + h, order: r.order, mid, naive: logs[r.t], actual,
      model: Math.abs(mid - actual), naiveMiss: Math.abs(logs[r.t] - actual),
      in80: Math.abs(actual - mid) <= Z80 * sd, in95: Math.abs(actual - mid) <= Z95 * sd,
    });
  }
  const n = rows.length;
  if (!n) return { h, n: 0, rows };
  const mean = (k) => rows.reduce((s, r) => s + r[k], 0) / n;
  const model = mean("model"), naive = mean("naiveMiss");
  const d = rows.map((r) => r.model - r.naiveMiss);
  const closer = rows.filter((r) => r.model < r.naiveMiss - TIE).length / n;
  const margin = naive > 0 ? Math.round((1 - model / naive) * 1000) / 1000 : 0;
  return {
    h, n, rows, model, naive, margin, closer,
    verdict: margin > 0 ? "ahead" : margin < 0 ? "behind" : "level",
    dm: dieboldMariano(d, h),
    coverage80: rows.filter((r) => r.in80).length / n,
    coverage95: rows.filter((r) => r.in95).length / n,
  };
}

/**
 * The running scorecard: after each forecast, the mean miss so far of each as a percentage, and the model's mean miss
 * so far as a share of the naive forecast's (below 1: the model is ahead so far). The last ratio is 1 - margin, unrounded.
 */
export function running(rows) {
  let a = 0, b = 0;
  return rows.map((r, i) => { a += r.model; b += r.naiveMiss; return { t: r.t, model: asPercent(a / (i + 1)), naive: asPercent(b / (i + 1)), ratio: b > 0 ? a / b : 1 }; });
}

/** How often each order was chosen among the records, most often first. */
export function orderShares(records) {
  const count = new Map();
  for (const r of records) { const k = orderName(r.order); count.set(k, (count.get(k) || 0) + 1); }
  return [...count].map(([name, k]) => ({ name, share: k / records.length })).sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------- months */

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "1975-01" plus i months, as { year, month (0-11) }. */
export function monthAt(start, i) {
  const [y, m] = start.split("-").map(Number);
  const k = y * 12 + (m - 1) + i;
  return { year: Math.floor(k / 12), month: ((k % 12) + 12) % 12 };
}
export const monthLabel = (start, i, short = true) => { const d = monthAt(start, i); return `${short ? MONTHS[d.month].slice(0, 3) : MONTHS[d.month]} ${d.year}`; };
/** The 0-based month index of January of a year (may be negative or past the end). */
export const indexOfYear = (start, year) => { const [y, m] = start.split("-").map(Number); return (year - y) * 12 - (m - 1); };
