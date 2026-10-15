// Day 75: Yield Curve Recession Model. The model, with no DOM code.
// The slope of the US Treasury yield curve, a probit or logit model of recession refitted each month on what was
// known at the time, and its out-of-sample accuracy: ROC curve, AUC, a confusion table, the Brier score.

/* ---------- months ---------- */

/** "1959-01" plus k months. */
export function addMonths(ym, k) {
  const [y, m] = ym.split("-").map(Number);
  const n = y * 12 + (m - 1) + k;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}
/** Months from a to b (b later gives a positive number). */
export const monthDiff = (a, b) => {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Sep 2026", or "September 2026" with long = true. */
export function monthLabel(ym, long = false) {
  const [y, m] = ym.split("-").map(Number);
  return `${(long ? LONG : NAMES)[m - 1]} ${y}`;
}

/* ---------- the normal distribution, to full double precision ---------- */

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const normalPdf = (z) => Math.exp(-0.5 * z * z) / SQRT2PI;

/**
 * Upper tail Q(z) = 1 - Phi(z) for z >= 0. A power series near zero and the continued fraction for the Mills ratio
 * further out; both are exact up to rounding (about 1e-15 relative), so a probability of 1e-20 keeps its digits.
 */
function upperTail(z) {
  if (z < 3) {
    // Phi(z) - 1/2 = pdf(z) * (z + z^3/3 + z^5/(3*5) + ...)
    let term = z, sum = z;
    for (let k = 1; k < 500 && Math.abs(term) > 1e-17 * Math.abs(sum); k++) { term *= (z * z) / (2 * k + 1); sum += term; }
    return 0.5 - normalPdf(z) * sum;
  }
  // Q(z) = pdf(z) / (z + 1/(z + 2/(z + 3/(z + ...)))), evaluated by the modified Lentz method.
  const tiny = 1e-300;
  let f = z, C = z, D = 0;
  for (let k = 1; k < 500; k++) {
    D = z + k * D; D = Math.abs(D) < tiny ? tiny : D; D = 1 / D;
    C = z + k / C; C = Math.abs(C) < tiny ? tiny : C;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return normalPdf(z) / f;
}
/** Standard normal distribution function. */
export const normalCdf = (z) => (z >= 0 ? 1 - upperTail(z) : upperTail(-z));

/* ---------- the data: spreads and recessions ---------- */

/** The 3-month bill rate on a discount basis turned into a bond-equivalent yield, as the New York Fed does (91-day bill). */
export const bondEquivalent = (discount, days = 91) => (100 * 365 * (discount / 100)) / (360 - days * (discount / 100));

export const SPREADS = {
  "10y3m": { label: "10-year less 3-month", long: "10-year Treasury yield less the 3-month bill rate (bond-equivalent)" },
  "10y2y": { label: "10-year less 2-year", long: "10-year Treasury yield less the 2-year Treasury yield" },
};

/** The spread in percentage points for every month of the data, null where a yield is missing. */
export function spreadSeries(data, kind = "10y3m") {
  const ten = data.cmt.y10;
  if (kind === "10y3m") return ten.map((v, i) => (v == null || data.bill3[i] == null ? null : v - bondEquivalent(data.bill3[i])));
  if (kind === "10y2y") return ten.map((v, i) => (v == null || data.cmt.y2[i] == null ? null : v - data.cmt.y2[i]));
  throw new Error(`unknown spread ${kind}`);
}

/** 1 for a month in recession (the month after a peak to the trough, inclusive, the NBER's convention), else 0. */
export function recessionSeries(data) {
  const n = monthDiff(data.first, data.last) + 1;
  const out = new Array(n).fill(0);
  for (const { peak, trough } of data.cycles) {
    for (let k = monthDiff(data.first, peak) + 1; k <= monthDiff(data.first, trough); k++) if (k >= 0 && k < n) out[k] = 1;
  }
  return out;
}

/** Longest gap between a turning point and its announcement since 1980 was 21 months; the rule allows 24. */
export const LAG = 24;

/**
 * Was the state of month m (recession or not) known at the end of month t? Yes if m is at least LAG months before t
 * (every turning point that old had been announced), or if m is no later than a turning point the NBER had
 * announced by the end of month t.
 */
export function knownAt(data, m, t) {
  if (monthDiff(m, t) >= LAG) return true;
  const latest = latestAnnounced(data, t);
  return latest != null && m <= latest;
}
/** The latest turning point the NBER had announced by the end of month t, or null. */
export function latestAnnounced(data, t) {
  let latest = null;
  for (const a of data.announced) if (a.date.slice(0, 7) <= t && (latest == null || a.month > latest)) latest = a.month;
  return latest;
}

/* ---------- fitting a probit or a logit ---------- */

export const LINKS = {
  probit: { label: "Probit", F: normalCdf, Fc: (z) => normalCdf(-z), f: normalPdf },
  logit: { label: "Logit", F: (z) => 1 / (1 + Math.exp(-z)), Fc: (z) => 1 / (1 + Math.exp(z)), f: (z) => { const e = Math.exp(-Math.abs(z)); return e / ((1 + e) * (1 + e)); } },
};

/** Log-likelihood, score and expected information at (a, b), in one pass over the data. */
function evaluate(x, y, a, b, L) {
  let ll = 0, g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
  for (let i = 0; i < x.length; i++) {
    const z = a + b * x[i];
    // The smaller of the two tail probabilities is computed directly and the other as 1 minus it, so neither loses digits.
    const P = z < 0 ? L.F(z) : 1 - L.Fc(z), Q = z < 0 ? 1 - P : L.Fc(z), d = L.f(z);
    ll += Math.log(y[i] ? P : Q);
    const score = y[i] ? d / P : -d / Q;
    const w = (d * d) / (P * Q);
    g0 += score; g1 += score * x[i];
    h00 += w; h01 += w * x[i]; h11 += w * x[i] * x[i];
  }
  return { ll, g0, g1, h00, h01, h11 };
}

/**
 * Maximum likelihood fit of P(y = 1) = F(a + b x) by Fisher scoring with step halving. Returns { a, b, loglik,
 * iterations, converged } or { error } when the fit cannot exist (fewer than 2 cases of either outcome).
 */
export function fitBinary(x, y, link = "probit", start = [0, 0]) {
  const L = LINKS[link];
  if (!L) throw new Error(`unknown link ${link}`);
  const n = x.length, ones = y.reduce((s, v) => s + v, 0);
  if (n < 10 || ones < 2 || n - ones < 2) return { error: `needs at least 10 months with both outcomes present (has ${n} months, ${ones} in recession)` };
  if (Math.min(...x) === Math.max(...x)) return { error: "the spread does not vary in these months, so no slope can be fitted" };
  const SEPARATED = "the spread separates recession months from the others perfectly here, so the fit has no finite answer";
  let a = start[0], b = start[1];
  let e = evaluate(x, y, a, b, L);
  if (!Number.isFinite(e.ll)) { a = 0; b = 0; e = evaluate(x, y, a, b, L); }
  for (let it = 1; it <= 100; it++) {
    const det = e.h00 * e.h11 - e.h01 * e.h01;
    if (!(det > 0)) return { error: SEPARATED }; // the information vanishes only as the fit runs off to infinity
    const da = (e.h11 * e.g0 - e.h01 * e.g1) / det, db = (e.h00 * e.g1 - e.h01 * e.g0) / det;
    let step = 1, next = null;
    for (let k = 0; k < 40; k++) {
      next = evaluate(x, y, a + step * da, b + step * db, L);
      if (Number.isFinite(next.ll) && next.ll >= e.ll - 1e-12) break;
      step /= 2;
    }
    a += step * da; b += step * db;
    e = next;
    if (Math.abs(step * da) + Math.abs(step * db) < 1e-10) return { a, b, loglik: e.ll, iterations: it, converged: true, n, ones };
  }
  // The likelihood keeps rising without limit only when the spread separates the two outcomes perfectly.
  return { error: SEPARATED };
}

export const predict = (fit, x, link) => LINKS[link].F(fit.a + fit.b * x);

/* ---------- forecasts made in real time, and with hindsight ---------- */

/**
 * For each forecast month t from `from` to `to`: fit the model on the pairs (spread in month s, recession state in
 * month s + h) whose state was known at the end of month t, and forecast the state in month t + h from the spread in
 * month t. Only months whose outcome is known today (`now`) are scored. Returns one row per forecast month.
 */
export function realTime(data, opts = {}) {
  return [...realTimeSteps(data, opts)].filter((r) => !r.skipped);
}
/**
 * The same, one forecast month at a time, so a page can do the work in slices. Yields a row per forecast month, or
 * { origin, skipped } when no model could be fitted on what was known then.
 */
export function* realTimeSteps(data, { spread, h = 12, link = "probit", from = "1980-01", to = null, now = data.last } = {}) {
  const x = spreadSeries(data, spread);
  const rec = recessionSeries(data);
  const n = x.length;
  let start = [0, 0];
  const lastOrigin = to ?? addMonths(data.last, -h);
  for (let t = Math.max(0, monthDiff(data.first, from)); t < n; t++) {
    const tm = addMonths(data.first, t);
    if (tm > lastOrigin || t + h >= n) break;
    if (!knownAt(data, addMonths(tm, h), now) || x[t] == null) continue;
    // Outcome months known at the end of month t: those at least LAG months back, and those up to the latest announced turning point.
    const latest = latestAnnounced(data, tm);
    const cut = Math.max(t - LAG, latest == null ? -1 : monthDiff(data.first, latest));
    const xs = [], ys = [];
    for (let s = 0; s + h <= Math.min(t, cut); s++) {
      if (x[s] == null) continue;
      xs.push(x[s]); ys.push(rec[s + h]);
    }
    const fit = fitBinary(xs, ys, link, start);
    if (fit.error) { yield { origin: tm, skipped: fit.error }; continue; }
    start = [fit.a, fit.b];
    yield { origin: tm, target: addMonths(tm, h), spread: x[t], p: predict(fit, x[t], link), base: fit.ones / fit.n, y: rec[t + h], a: fit.a, b: fit.b, trained: fit.n, lastOutcome: addMonths(data.first, Math.min(t, cut)) };
  }
}
/** How many forecast months realTimeSteps will visit (for a progress bar). */
export function countOrigins(data, { h = 12, from = "1980-01", now = data.last } = {}) {
  let k = 0;
  for (let tm = from; tm <= addMonths(data.last, -h); tm = addMonths(tm, 1)) if (knownAt(data, addMonths(tm, h), now)) k++;
  return k;
}

/** The model fitted on the forecast months from `from` to `to` (inclusive), with every outcome as known today. */
export function fitWindow(data, { spread, h = 12, link = "probit", from = data.first, to = data.last, now = data.last } = {}) {
  const x = spreadSeries(data, spread);
  const rec = recessionSeries(data);
  const xs = [], ys = [];
  for (let s = Math.max(0, monthDiff(data.first, from)); s + h < x.length && s <= monthDiff(data.first, to); s++) {
    if (x[s] == null || !knownAt(data, addMonths(data.first, s + h), now)) continue;
    xs.push(x[s]); ys.push(rec[s + h]);
  }
  return fitBinary(xs, ys, link);
}

/** The model fitted once on every pair whose outcome is known today: hindsight, for comparison. */
export function hindsightFit(data, { spread, h = 12, link = "probit", now = data.last } = {}) {
  const x = spreadSeries(data, spread);
  const rec = recessionSeries(data);
  const xs = [], ys = [];
  for (let s = 0; s + h < x.length; s++) {
    if (x[s] == null || !knownAt(data, addMonths(data.first, s + h), now)) continue;
    xs.push(x[s]); ys.push(rec[s + h]);
  }
  return { ...fitBinary(xs, ys, link), x, rec };
}

/* ---------- accuracy ---------- */

/** Area under the ROC curve as the Mann-Whitney statistic: P(p of a recession month > p of another month), ties count half. */
export function auc(p, y) {
  const pos = [], neg = [];
  p.forEach((v, i) => (y[i] ? pos : neg).push(v));
  if (!pos.length || !neg.length) return null;
  // Rank-based: sort everything once, give tied values their average rank.
  const all = p.map((v, i) => ({ v, y: y[i] })).sort((a, b) => a.v - b.v);
  let rankSum = 0;
  for (let i = 0; i < all.length;) {
    let j = i;
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (all[k].y) rankSum += avg;
    i = j + 1;
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length);
}

/** ROC curve: one point per distinct threshold, from (0, 0) (nothing flagged) to (1, 1) (everything flagged). */
export function rocCurve(p, y) {
  const P = y.reduce((s, v) => s + v, 0), N = y.length - P;
  if (!P || !N) return [];
  const order = p.map((v, i) => i).sort((i, j) => p[j] - p[i]);
  const pts = [{ fpr: 0, tpr: 0, threshold: Infinity }];
  let tp = 0, fp = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (y[i]) tp++; else fp++;
    if (k + 1 === order.length || p[order[k + 1]] !== p[i]) pts.push({ fpr: fp / N, tpr: tp / P, threshold: p[i] });
  }
  return pts;
}
/** Area under a list of ROC points by the trapezoid rule (equals auc() when the points are from rocCurve). */
export const trapezoid = (pts) => pts.slice(1).reduce((s, q, i) => s + ((q.fpr - pts[i].fpr) * (q.tpr + pts[i].tpr)) / 2, 0);

/** Months flagged when p >= threshold, against what happened. Rates are null when their denominator is zero. */
export function confusion(p, y, threshold) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  p.forEach((v, i) => { const flag = v >= threshold; if (y[i]) (flag ? tp++ : fn++); else (flag ? fp++ : tn++); });
  const ratio = (a, b) => (b ? a / b : null);
  const n = tp + fp + fn + tn;
  return { tp, fp, fn, tn, n, tpr: ratio(tp, tp + fn), fpr: ratio(fp, fp + tn), precision: ratio(tp, tp + fp), accuracy: ratio(tp + tn, n), alwaysNo: ratio(fp + tn, n) };
}

/** Mean squared error of the probabilities, and of a reference forecast, and the skill 1 - B / B_ref. */
export function brier(p, y, ref) {
  const sq = (q) => q.reduce((s, v, i) => s + (v - y[i]) ** 2, 0) / q.length;
  const B = sq(p), R = ref ? sq(ref) : null;
  return { brier: B, ref: R, skill: R ? 1 - B / R : null };
}

/**
 * Stretches of consecutive months flagged (p >= threshold) and whether each was followed by a recession: a run counts
 * as a signal if any month it forecast (its target months) was in recession. Recessions are counted as caught if any
 * forecast aimed at one of their months was flagged.
 */
export function episodes(rows, threshold) {
  const runs = [];
  for (const r of rows) {
    const flag = r.p >= threshold;
    const last = runs.at(-1);
    if (flag && last && last.open && monthDiff(last.to, r.origin) === 1) { last.to = r.origin; last.hit ||= r.y === 1; }
    else if (flag) runs.push({ from: r.origin, to: r.origin, hit: r.y === 1, open: true });
    if (!flag && last) last.open = false;
  }
  return runs.map(({ from, to, hit }) => ({ from, to, hit }));
}

/** For each NBER recession whose months fall in the scored target months: was any forecast aimed at it flagged? */
export function recessionsCaught(data, rows, threshold) {
  if (!rows.length) return [];
  const first = rows[0].target, last = rows.at(-1).target;
  return data.cycles
    .filter((c) => addMonths(c.peak, 1) >= first && c.trough <= last)
    .map((c) => {
      const aimed = rows.filter((r) => r.target > c.peak && r.target <= c.trough);
      const flagged = aimed.filter((r) => r.p >= threshold);
      return { peak: c.peak, trough: c.trough, caught: flagged.length > 0, firstFlag: flagged[0]?.origin ?? null, maxP: Math.max(...aimed.map((r) => r.p)) };
    });
}
