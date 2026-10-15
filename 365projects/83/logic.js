// Day 83: Credit Risk Model. The model, with no DOM code.
// A logistic regression of default on a cardholder's profile, fitted by iteratively reweighted least squares on two
// thirds of the 30,000 cardholders and checked on the other third: calibration, discrimination and group fairness.

import { rng, linalg } from "../kit/kit.js";

/* ------------------------------------------------------------------ the data */

export const EDUCATION = ["Graduate school", "University", "High school", "Others, or a code the source does not define"];
export const MARRIAGE = ["Married", "Single", "Others, or a code the source does not define"];
// September 2005 repayment status, as coded in the data (-2 to 8). The source's codebook defines -1 and 1 to 9 only.
export const STATUS = [
  { code: -1, label: "Paid duly (code -1)" },
  { code: -2, label: "Code -2 (not defined by the source)" },
  { code: 0, label: "Code 0 (not defined by the source)" },
  { code: 1, label: "One month late" },
  { code: 2, label: "Two months late" },
  { code: 3, label: "Three or more months late" },
];
export const statusGroup = (code) => (code >= 3 ? 3 : code);

/** Decode the bundled columns (see scripts/data/credit_default.py) into typed arrays. */
export function decode(D) {
  const n = D.n;
  const val = new Map([...D.alphabet].map((c, i) => [c, i]));
  const read = (s, i, w) => { let v = 0; for (let k = 0; k < w; k++) v = v * 64 + val.get(s[i * w + k]); return v; };
  const out = {
    n,
    limit: new Float64Array(n), sex: new Uint8Array(n), edu: new Uint8Array(n), mar: new Uint8Array(n), age: new Uint8Array(n),
    status: new Int8Array(n), late: new Uint8Array(n), bill: new Float64Array(n), paid: new Float64Array(n), y: new Uint8Array(n),
  };
  const c = D.cols;
  for (let i = 0; i < n; i++) {
    out.limit[i] = read(c.limit, i, 2) * 1000;
    let g = read(c.group, i, 1);
    out.y[i] = g % 2; g = (g - out.y[i]) / 2;
    out.mar[i] = g % 3; g = (g - out.mar[i]) / 3;
    out.edu[i] = g % 4; g = (g - out.edu[i]) / 4;
    out.sex[i] = g + 1;
    out.age[i] = read(c.age, i, 1) + 21;
    out.status[i] = read(c.status, i, 1) - 2;
    out.late[i] = read(c.late, i, 1);
    out.bill[i] = (read(c.bill, i, 3) - D.billOffset) * 10;
    out.paid[i] = read(c.paid, i, 3) * 10;
  }
  return out;
}

/** The split, fixed before any model was fitted: each cardholder goes to the test third with probability 1/3, seed 83. */
export const SPLIT_SEED = 83;
export function splitTest(n, seed = SPLIT_SEED) {
  const r = rng(seed);
  const test = new Uint8Array(n);
  for (let i = 0; i < n; i++) test[i] = r() < 1 / 3 ? 1 : 0;
  return test;
}

/* ------------------------------------------------------------------ the inputs */

export const UTIL_RANGE = [-0.5, 1.5];
export const utilisation = (bill, limit) => Math.min(UTIL_RANGE[1], Math.max(UTIL_RANGE[0], bill / limit));

/**
 * Each input becomes one or more columns of the design matrix. A profile is
 * { limit, age, edu, mar, sex, status, late, bill, paid } in the data's own units and codes.
 */
export const INPUTS = [
  { key: "limit", label: "Credit limit", cols: ["log of the limit over NT$100,000"], x: (p) => [Math.log(p.limit / 100000)] },
  { key: "age", label: "Age", cols: ["age, per 10 years over 35"], x: (p) => [(p.age - 35) / 10] },
  { key: "edu", label: "Education", cols: ["university", "high school", "others, or a code not in the codebook"], x: (p) => [p.edu === 1 ? 1 : 0, p.edu === 2 ? 1 : 0, p.edu === 3 ? 1 : 0] },
  { key: "mar", label: "Marital status", cols: ["single", "others, or a code not in the codebook"], x: (p) => [p.mar === 1 ? 1 : 0, p.mar === 2 ? 1 : 0] },
  { key: "sex", label: "Sex", cols: ["female"], x: (p) => [p.sex === 2 ? 1 : 0] },
  {
    key: "status", label: "Repayment status, September 2005", cols: ["code -2", "code 0", "one month late", "two months late", "three or more months late"],
    x: (p) => { const s = statusGroup(p.status); return [s === -2 ? 1 : 0, s === 0 ? 1 : 0, s === 1 ? 1 : 0, s === 2 ? 1 : 0, s === 3 ? 1 : 0]; },
  },
  { key: "late", label: "Months late, April to August", cols: ["months late, April to August"], x: (p) => [p.late] },
  { key: "util", label: "September bill as a share of the limit", cols: ["bill over limit"], x: (p) => [utilisation(p.bill, p.limit)] },
  { key: "paid", label: "Amount paid in September", cols: ["ln(1 + amount paid)"], x: (p) => [Math.log1p(p.paid)] },
];
export const DEFAULT_INPUTS = INPUTS.map((f) => f.key).filter((k) => k !== "sex");
const byKey = new Map(INPUTS.map((f) => [f.key, f]));
const ordered = (keys) => INPUTS.filter((f) => keys.includes(f.key));

export const rowProfile = (d, i) => ({ limit: d.limit[i], age: d.age[i], edu: d.edu[i], mar: d.mar[i], sex: d.sex[i], status: d.status[i], late: d.late[i], bill: d.bill[i], paid: d.paid[i] });

/** Column names of the design matrix for a set of inputs (the first is the intercept). */
export function columnsOf(keys) {
  const names = [{ input: null, name: "intercept" }];
  for (const f of ordered(keys)) for (const c of f.cols) names.push({ input: f.key, name: c });
  return names;
}

/** One design row: [1, ...inputs]. */
export function designRow(profile, keys) {
  const row = [1];
  for (const f of ordered(keys)) row.push(...f.x(profile));
  return row;
}

/** The design matrix for the rows in `idx`, flat and row-major. */
export function designMatrix(d, idx, keys) {
  const p = columnsOf(keys).length;
  const X = new Float64Array(idx.length * p);
  idx.forEach((i, r) => { const row = designRow(rowProfile(d, i), keys); for (let j = 0; j < p; j++) X[r * p + j] = row[j]; });
  return { X, p, n: idx.length };
}

/**
 * Every input's design columns for every row, worked out once so that refitting with other inputs is only copying.
 * Fill it in slices with fillStore(store, d, from, to).
 */
export function createStore(d) {
  return new Map(INPUTS.map((f) => [f.key, f.cols.map(() => new Float64Array(d.n))]));
}
export function fillStore(store, d, from, to) {
  for (let i = from; i < Math.min(to, d.n); i++) {
    const prof = rowProfile(d, i);
    for (const f of INPUTS) { const v = f.x(prof), cols = store.get(f.key); for (let j = 0; j < v.length; j++) cols[j][i] = v[j]; }
  }
}
/** The same matrix as designMatrix, read from a filled store. */
export function matrixFromStore(store, idx, keys) {
  const cols = ordered(keys).flatMap((f) => store.get(f.key));
  const p = cols.length + 1, n = idx.length;
  const X = new Float64Array(n * p);
  for (let r = 0; r < n; r++) { const i = idx[r], o = r * p; X[o] = 1; for (let j = 0; j < cols.length; j++) X[o + j + 1] = cols[j][i]; }
  return { X, p, n };
}
/** Predicted probabilities for the rows in idx. */
export function predictFromStore(store, idx, keys, beta) {
  const cols = ordered(keys).flatMap((f) => store.get(f.key));
  const out = new Float64Array(idx.length);
  for (let r = 0; r < idx.length; r++) { const i = idx[r]; let eta = beta[0]; for (let j = 0; j < cols.length; j++) eta += beta[j + 1] * cols[j][i]; out[r] = sigmoid(eta); }
  return out;
}

/* ------------------------------------------------------------------ fitting */

const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export const logit = (p) => Math.log(p / (1 - p));
export { sigmoid };

function devianceOf(X, y, n, p, beta) {
  let dev = 0;
  for (let i = 0; i < n; i++) {
    let eta = 0;
    for (let j = 0; j < p; j++) eta += X[i * p + j] * beta[j];
    // -2 log-likelihood, computed stably: log(1 + e^eta) - y * eta.
    dev += 2 * ((eta > 0 ? eta + Math.log1p(Math.exp(-eta)) : Math.log1p(Math.exp(eta))) - y[i] * eta);
  }
  return dev;
}

/**
 * Maximum-likelihood logistic regression by Newton's method (the same steps as iteratively reweighted least squares),
 * one iteration per call to step(), with step halving if the deviance would rise. y holds 0s and 1s.
 * fit.result: { beta, cov (inverse information), deviance, iterations, converged }.
 */
export function createFit(X, y, n, p, { maxIter = 30, tol = 1e-10 } = {}) {
  let beta = new Array(p).fill(0);
  // Start the intercept at the log-odds of the mean, so an intercept-only model is right at once.
  const mean = y.reduce((s, v) => s + v, 0) / n;
  if (mean > 0 && mean < 1) beta[0] = logit(mean);
  let dev = devianceOf(X, y, n, p, beta);
  let iterations = 0, converged = false, info = null;
  const step = () => {
    if (converged || iterations >= maxIter) return true;
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    const g = new Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      let eta = 0;
      const o = i * p;
      for (let j = 0; j < p; j++) eta += X[o + j] * beta[j];
      const mu = sigmoid(eta), w = mu * (1 - mu), r = y[i] - mu;
      for (let j = 0; j < p; j++) {
        const xj = X[o + j];
        if (xj === 0) continue;
        g[j] += r * xj;
        const a = w * xj;
        for (let k = j; k < p; k++) H[j][k] += a * X[o + k];
      }
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) H[j][k] = H[k][j];
    let inv;
    try { inv = linalg.inverse(H); } catch { throw new Error("The inputs are too closely related to separate: the information matrix is singular."); }
    info = inv;
    const delta = inv.map((row) => row.reduce((s, v, j) => s + v * g[j], 0));
    let scale = 1, next, nextDev;
    for (let half = 0; half < 30; half++) {
      next = beta.map((b, j) => b + scale * delta[j]);
      nextDev = devianceOf(X, y, n, p, next);
      if (nextDev <= dev + 1e-9 * Math.abs(dev)) break;
      scale /= 2;
    }
    const moved = Math.max(...delta.map((v) => Math.abs(scale * v)));
    beta = next; const drop = dev - nextDev; dev = nextDev; iterations++;
    if (moved < tol || Math.abs(drop) < tol * (1 + Math.abs(dev))) converged = true;
    if (converged || iterations >= maxIter) {
      // The covariance is the inverse of the information at the final estimate, so one more pass works it out there.
      const F = Array.from({ length: p }, () => new Array(p).fill(0));
      for (let i = 0; i < n; i++) {
        let eta = 0; const o = i * p;
        for (let j = 0; j < p; j++) eta += X[o + j] * beta[j];
        const mu = sigmoid(eta), w = mu * (1 - mu);
        for (let j = 0; j < p; j++) { const a = w * X[o + j]; if (a === 0) continue; for (let k = j; k < p; k++) F[j][k] += a * X[o + k]; }
      }
      for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) F[j][k] = F[k][j];
      try { info = linalg.inverse(F); } catch { /* separated data: keep the last invertible information */ }
      return true;
    }
    return false;
  };
  return {
    step,
    get result() { return { beta: [...beta], cov: info, deviance: dev, iterations, converged }; },
  };
}

/** Fit at once (for tests and small data). */
export function fitLogistic(X, y, n, p, opts) {
  const f = createFit(X, y, n, p, opts);
  while (!f.step());
  return f.result;
}

export const linear = (beta, row) => row.reduce((s, v, j) => s + v * beta[j], 0);

/** Predicted probability and a 95% interval for it from the coefficients' covariance (delta method on the log-odds). */
export function predictWithInterval(fit, row) {
  const eta = linear(fit.beta, row);
  let v = 0;
  for (let j = 0; j < row.length; j++) for (let k = 0; k < row.length; k++) v += row[j] * fit.cov[j][k] * row[k];
  const se = Math.sqrt(Math.max(0, v));
  return { p: sigmoid(eta), eta, se, low: sigmoid(eta - 1.959963984540054 * se), high: sigmoid(eta + 1.959963984540054 * se) };
}

/* ------------------------------------------------------------------ scores */

/** Mean squared difference between forecast and outcome. */
export function brier(p, y) {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += (p[i] - y[i]) ** 2;
  return s / p.length;
}

/** Area under the ROC curve: the chance a random defaulter is scored above a random non-defaulter (ties count half). */
export function auc(p, y) {
  const idx = Array.from(p, (_, i) => i).sort((a, b) => p[a] - p[b]);
  let pos = 0, rankSum = 0;
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && p[idx[j + 1]] === p[idx[i]]) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (y[idx[k]]) { pos++; rankSum += mid; }
    i = j + 1;
  }
  const neg = idx.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}

export function wilson(k, n) {
  if (!n) return { share: NaN, low: NaN, high: NaN };
  const z = 1.959963984540054, p = k / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { share: p, low: k === 0 ? 0 : Math.max(0, centre - half), high: k === n ? 1 : Math.min(1, centre + half) };
}

/**
 * Reliability table: the forecasts sorted and cut into `bins` groups of (nearly) equal size, each with its average
 * forecast, the share that defaulted and a 95% Wilson interval for that share. Equal forecasts are never split
 * between groups (a boundary moves up past them), so a model with few distinct forecasts gives fewer groups.
 */
export function reliability(p, y, bins = 10) {
  const idx = Array.from(p, (_, i) => i).sort((a, b) => p[a] - p[b]);
  const n = idx.length, out = [];
  const k = Math.min(bins, n);
  let lo = 0;
  for (let b = 0; b < k && lo < n; b++) {
    let hi = Math.max(lo + 1, Math.round(((b + 1) * n) / k));
    while (hi < n && p[idx[hi]] === p[idx[hi - 1]]) hi++;
    let sp = 0, sy = 0;
    for (let i = lo; i < hi; i++) { sp += p[idx[i]]; sy += y[idx[i]]; }
    const w = wilson(sy, hi - lo);
    out.push({ n: hi - lo, from: p[idx[lo]], to: p[idx[hi - 1]], predicted: sp / (hi - lo), observed: w.share, low: w.low, high: w.high, defaults: sy });
    lo = hi;
  }
  return out;
}

/** Headline scores on held-out data, against the base-rate forecast (the training default rate for everyone). */
export function scores(p, y, baseRate) {
  const b = brier(p, y);
  const b0 = brier(Array.from(y, () => baseRate), y);
  let mp = 0, my = 0;
  for (let i = 0; i < p.length; i++) { mp += p[i]; my += y[i]; }
  return { n: p.length, brier: b, baseBrier: b0, skill: 1 - b / b0, auc: auc(p, y), meanPredicted: mp / p.length, observed: my / p.length };
}

/* ------------------------------------------------------------------ fairness */

/**
 * Confusion-matrix measures for one group, given forecasts p, outcomes y (1 = defaulted) and a cut-off: a cardholder
 * is "flagged" when p >= cut. Shares whose denominator is zero are NaN, and the interface says why.
 */
export function groupMeasures(p, y, cut) {
  let n = 0, def = 0, flagged = 0, tp = 0, fp = 0, sumP = 0, sumPdef = 0, sumPrep = 0;
  for (let i = 0; i < p.length; i++) {
    n++; sumP += p[i];
    const f = p[i] >= cut;
    if (y[i]) { def++; sumPdef += p[i]; if (f) tp++; } else { sumPrep += p[i]; if (f) fp++; }
    if (f) flagged++;
  }
  const rep = n - def;
  const div = (a, b) => (b ? a / b : NaN);
  return {
    n, defaults: def, repaid: rep, flaggedCount: flagged, tp, fp,
    baseRate: div(def, n), meanP: div(sumP, n),
    flagged: div(flagged, n),                // demographic parity compares this
    tpr: div(tp, def), fnr: div(def - tp, def),
    fpr: div(fp, rep),                        // equal opportunity for repayers compares this (1 - fpr is their approval rate)
    ppv: div(tp, flagged),                    // predictive parity compares this
    scoreIfDefault: div(sumPdef, def),        // balance for the positive class
    scoreIfRepaid: div(sumPrep, rep),         // balance for the negative class
  };
}

/** Chouldechova (2017): FPR = p / (1 - p) * (1 - PPV) / PPV * (1 - FNR), where p is the base rate. */
export const chouldechovaFpr = (baseRate, ppv, fnr) => (baseRate / (1 - baseRate)) * ((1 - ppv) / ppv) * (1 - fnr);

/** The cut-off that flags (as nearly as ties allow) a share `share` of the forecasts in p. */
export function cutForShare(p, share) {
  const s = Array.from(p).sort((a, b) => b - a);
  const k = Math.round(share * s.length);
  if (k <= 0) return Infinity;
  return s[Math.min(k, s.length) - 1];
}

export const RULES = [
  { value: "one", label: "One cut-off for everyone" },
  { value: "parity", label: "Equal flag rates (demographic parity)" },
  { value: "opportunity", label: "Equal flag rates among those who repaid (equal opportunity)" },
];

/**
 * Cut-offs for groups 0 and 1. "one": the same cut for both. "parity": each group's cut flags the share of the group
 * that the single cut flags overall. "opportunity": each group's cut flags the share of its repayers that the single
 * cut flags among all repayers. Chosen on the training forecasts (pTrain, yTrain, gTrain), never the test ones.
 */
export function cutoffs(rule, cut, pTrain, yTrain, gTrain) {
  if (rule === "one") return [cut, cut];
  const pick = (keep) => Array.from(pTrain).filter((_, i) => keep(i));
  const flagShare = (arr) => (arr.length ? arr.filter((v) => v >= cut).length / arr.length : 0);
  if (rule === "parity") {
    const target = flagShare(Array.from(pTrain));
    return [0, 1].map((g) => cutForShare(pick((i) => gTrain[i] === g), target));
  }
  if (rule === "opportunity") {
    const target = flagShare(pick((i) => !yTrain[i]));
    return [0, 1].map((g) => cutForShare(pick((i) => gTrain[i] === g && !yTrain[i]), target));
  }
  throw new Error(`unknown rule ${rule}`);
}

/** Protected attributes the fairness check can split by. group(d, i) is 0 or 1; `input` is the model input it is. */
export const PROTECTED = [
  { value: "sex", label: "Sex", input: "sex", names: ["Women", "Men"], group: (d, i) => (d.sex[i] === 2 ? 0 : 1) },
  { value: "age", label: "Age: under 30 or 30 and over", input: "age", names: ["Under 30", "30 and over"], group: (d, i) => (d.age[i] < 30 ? 0 : 1) },
];

/* ------------------------------------------------------------------ explaining one forecast */

/** Mean of every column of a flat design matrix: the "average cardholder" the contributions are measured from. */
export function columnMeans({ X, p, n }) {
  const m = new Array(p).fill(0);
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) m[j] += X[i * p + j];
  return m.map((v) => v / n);
}

/** Each input's share of the profile's log-odds, measured from the column means. They add up to eta(profile) - eta(means). */
export function contributions(beta, row, means, keys) {
  const cols = columnsOf(keys);
  const out = new Map();
  cols.forEach((c, j) => { if (c.input) out.set(c.input, (out.get(c.input) || 0) + beta[j] * (row[j] - means[j])); });
  return ordered(keys).map((f) => ({ key: f.key, label: f.label, value: out.get(f.key) || 0 }));
}

/* ------------------------------------------------------------------ the visitor's profile */

export const LIMITS = {
  limit: { min: 10000, max: 1000000 },
  age: { min: 21, max: 79 },
  bill: { min: -170000, max: 1000000 },
  paid: { min: 0, max: 1000000 },
};

/** Check a profile typed by a visitor. Numbers arrive as strings or numbers. Returns { profile } or { errors: [{ key, message }] }. */
export function readProfile(input) {
  const errors = [];
  const num = (key, what, whole) => {
    const raw = input[key];
    const v = typeof raw === "string" ? (raw.trim() === "" ? NaN : Number(raw)) : raw;
    const lim = LIMITS[key];
    if (!Number.isFinite(v)) { errors.push({ key, message: `Enter ${what} as a number.` }); return NaN; }
    if (v < lim.min || v > lim.max) { errors.push({ key, message: `Enter ${what} from ${lim.min.toLocaleString("en-GB")} to ${lim.max.toLocaleString("en-GB")}: the cardholders in the data fall in that range.` }); return NaN; }
    if (whole && !Number.isInteger(v)) { errors.push({ key, message: `Enter ${what} as a whole number.` }); return NaN; }
    return v;
  };
  const choice = (key, allowed) => { const v = Number(input[key]); if (!allowed.includes(v)) { errors.push({ key, message: "Choose one of the options." }); return NaN; } return v; };
  const profile = {
    limit: num("limit", "a credit limit in NT$", false),
    age: num("age", "an age in years", true),
    edu: choice("edu", [0, 1, 2, 3]),
    mar: choice("mar", [0, 1, 2]),
    sex: choice("sex", [1, 2]),
    status: choice("status", [-2, -1, 0, 1, 2, 3]),
    late: choice("late", [0, 1, 2, 3, 4, 5]),
    bill: num("bill", "the September bill in NT$", false),
    paid: num("paid", "the amount paid in NT$", false),
  };
  return errors.length ? { errors } : { profile };
}
