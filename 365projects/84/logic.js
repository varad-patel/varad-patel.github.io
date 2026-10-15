// Day 84: Taylor Rule versus the Central Bank. The model, with no DOM code.
// The Taylor (1993) rule, i = r* + pi + a (pi - pi*) + b gap, computed month by month for the US and India from
// inflation and an output gap estimated with the Hodrick-Prescott filter, against the policy rate each central bank set.

/* ---------- months and quarters ---------- */

export function addMonths(ym, k) {
  const [y, m] = ym.split("-").map(Number);
  const n = y * 12 + (m - 1) + k;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`;
}
export const monthDiff = (a, b) => {
  const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
};
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => `${NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** "1947Q1" plus k quarters. */
export function addQuarters(yq, k) {
  const n = Number(yq.slice(0, 4)) * 4 + Number(yq.slice(5)) - 1 + k;
  return `${Math.floor(n / 4)}Q${(n % 4) + 1}`;
}
export const quarterOf = (ym) => `${ym.slice(0, 4)}Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;

/* ---------- the Hodrick-Prescott filter ---------- */

/**
 * Hodrick-Prescott trend: the tau that minimises sum (y - tau)^2 + lambda sum (second difference of tau)^2, found by
 * solving (I + lambda K'K) tau = y, a symmetric five-band system, by Gaussian elimination without pivoting (the matrix
 * is positive definite). Needs at least three points; with fewer the trend is the data itself.
 */
export function hpTrend(y, lambda = 1600) {
  const n = y.length;
  if (n < 3) return [...y];
  // Bands of A = I + lambda K'K: diagonal d, first off-diagonal e, second off-diagonal f.
  const d = new Float64Array(n), e = new Float64Array(n), f = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = i === 0 || i === n - 1 ? 1 : i === 1 || i === n - 2 ? 5 : 6;
    d[i] = 1 + lambda * k;
    if (i < n - 1) e[i] = lambda * (i === 0 || i === n - 2 ? -2 : -4);
    if (i < n - 2) f[i] = lambda;
  }
  if (n === 3) { d[1] = 1 + 4 * lambda; e[0] = e[1] = -2 * lambda; }
  // Forward elimination on a full copy of the bands (rows i, below-diagonal entries e[i-1], f[i-2]).
  const A = Array.from({ length: n }, (_, i) => ({ c: [i >= 2 ? f[i - 2] : 0, i >= 1 ? e[i - 1] : 0, d[i], i < n - 1 ? e[i] : 0, i < n - 2 ? f[i] : 0] }));
  const b = Float64Array.from(y);
  for (let i = 0; i < n; i++) {
    const piv = A[i].c[2];
    for (const r of [i + 1, i + 2]) {
      if (r >= n) continue;
      const off = r - i; // the entry of row r in column i sits at position 2 - off
      const m = A[r].c[2 - off] / piv;
      if (m === 0) continue;
      // Row r, columns i..i+2 (positions shift by off).
      for (let c = 0; c <= 2; c++) A[r].c[2 - off + c] -= m * A[i].c[2 + c];
      b[r] -= m * b[i];
    }
  }
  const t = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    if (i + 1 < n) s -= A[i].c[3] * t[i + 1];
    if (i + 2 < n) s -= A[i].c[4] * t[i + 2];
    t[i] = s / A[i].c[2];
  }
  return Array.from(t);
}

/**
 * Output gap in percent of trend from quarterly real GDP: 100 (ln Y - HP trend of ln Y). "two-sided" filters the whole
 * series once, so each quarter's trend also uses later data. "one-sided" filters the data up to each quarter and keeps
 * the last value, so each quarter uses only GDP up to that quarter (as revised today); the first `start` quarters get
 * no estimate.
 */
export function outputGap(gdp, { method = "two-sided", lambda = 1600, start = 40 } = {}) {
  const ly = gdp.map((v) => Math.log(v));
  if (method === "two-sided") { const t = hpTrend(ly, lambda); return ly.map((v, i) => 100 * (v - t[i])); }
  if (method !== "one-sided") throw new Error(`unknown method ${method}`);
  return ly.map((v, i) => (i + 1 < start ? null : 100 * (v - hpTrend(ly.slice(0, i + 1), lambda)[i])));
}

/** Monthly values from quarterly ones: each month takes the value of its quarter. */
export function monthlyFromQuarterly(firstQuarter, values, firstMonth, nMonths) {
  return Array.from({ length: nMonths }, (_, i) => {
    const q = quarterOf(addMonths(firstMonth, i));
    const k = (Number(q.slice(0, 4)) - Number(firstQuarter.slice(0, 4))) * 4 + Number(q.slice(5)) - Number(firstQuarter.slice(5));
    return k >= 0 && k < values.length && values[k] != null ? values[k] : null;
  });
}

/* ---------- the rule ---------- */

/** Taylor (1993): i = r* + pi + a (pi - pi*) + b gap, all in percent. Taylor's own values: r* = 2, pi* = 2, a = b = 0.5. */
export const taylor = ({ inflation, gap, rStar = 2, piStar = 2, a = 0.5, b = 0.5 }) => rStar + inflation + a * (inflation - piStar) + b * gap;

/** Limits for the visitor's numbers; anything outside is refused with a message. */
export const LIMITS = { a: [0, 3], b: [0, 3], rStar: [-3, 6], piStar: [0, 10] };
export function checkParams(p) {
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (!Number.isFinite(p[k]) || p[k] < lo || p[k] > hi) return `${k} must be a number from ${lo} to ${hi}`;
  }
  return null;
}

/**
 * Month-by-month comparison over the months where the policy rate, inflation and the gap all exist.
 * Returns rows { month, actual, rule, inflation, gap, diff } and a summary: mean and root mean square of
 * actual - rule, months more than `band` points below the rule ("looser") and above it ("tighter"), and months
 * in which the rule asked for a rate below zero.
 */
export function compare({ months, actual, inflation, gap, params, band = 1 }) {
  const rows = [];
  for (let i = 0; i < months.length; i++) {
    if (actual[i] == null || inflation[i] == null || gap[i] == null) continue;
    const rule = taylor({ inflation: inflation[i], gap: gap[i], ...params });
    rows.push({ month: months[i], actual: actual[i], rule, inflation: inflation[i], gap: gap[i], diff: actual[i] - rule });
  }
  const n = rows.length;
  if (!n) return { rows, n: 0 };
  const mean = rows.reduce((s, r) => s + r.diff, 0) / n;
  const rms = Math.sqrt(rows.reduce((s, r) => s + r.diff * r.diff, 0) / n);
  return {
    rows, n, mean, rms,
    looser: rows.filter((r) => r.diff < -band).length,
    tighter: rows.filter((r) => r.diff > band).length,
    belowZero: rows.filter((r) => r.rule < 0).length,
  };
}

/**
 * The weights that would have matched the actual rate best over these months, by least squares with r* and pi* held
 * at the visitor's values: regress i - r* - pi on (pi - pi*) and the gap, with no constant. Returns { a, b, rms } or
 * { error } when the two regressors are too closely related or there are too few months.
 */
export function fitWeights({ months, actual, inflation, gap, rStar, piStar }) {
  let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0, n = 0;
  const obs = [];
  for (let i = 0; i < months.length; i++) {
    if (actual[i] == null || inflation[i] == null || gap[i] == null) continue;
    const z = actual[i] - rStar - inflation[i], x1 = inflation[i] - piStar, x2 = gap[i];
    s11 += x1 * x1; s12 += x1 * x2; s22 += x2 * x2; t1 += x1 * z; t2 += x2 * z; n++;
    obs.push([z, x1, x2]);
  }
  if (n < 12) return { error: `needs at least 12 months with every input (has ${n})` };
  const det = s11 * s22 - s12 * s12;
  if (!(det > 1e-9 * s11 * s22)) return { error: "inflation and the output gap move too closely together in these months to separate their weights" };
  const a = (s22 * t1 - s12 * t2) / det, b = (s11 * t2 - s12 * t1) / det;
  const rms = Math.sqrt(obs.reduce((s, [z, x1, x2]) => s + (z - a * x1 - b * x2) ** 2, 0) / n);
  return { a, b, rms, n };
}

/**
 * The visitor's numbers as a CSV, month by month. Every cell is a month label or a number, so none can be read as a
 * formula; the headings name the inflation measure, the output gap and the rule's numbers (no commas, nothing that
 * starts with =, +, - or @).
 */
export function toCsv(rows, country, { measure = "", gap = "", a = 0.5, b = 0.5, rStar = 2, piStar = 2 } = {}) {
  const clean = (t) => String(t).replace(/[,"\r\n]/g, " ").trim();
  const head = ["month", `${clean(country)} policy rate (%)`, clean(`Taylor rule (%) with a ${a} b ${b} r* ${rStar} pi* ${piStar}`), "actual minus rule (points)",
    clean(`inflation (%) ${measure}`), clean(`output gap (%) ${gap} Hodrick-Prescott`)];
  const num = (v) => (Number.isFinite(v) ? String(Number(v.toFixed(3))) : ""); // up to three decimals: 0.125 stays 0.125
  return [head.join(","), ...rows.map((r) => [r.month, num(r.actual), num(r.rule), num(r.diff), num(r.inflation), num(r.gap)].join(","))].join("\n");
}
