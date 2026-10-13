// Day 53: Social Mobility Markov Chain. The model, with no DOM code.
// A transition matrix P has parents in rows and children in columns: P[i][j] is the chance that a child of parents
// in fifth i ends up in fifth j. Fifth 0 is the bottom, fifth 4 the top.

import { rng, linalg } from "../kit/kit.js";

export const N = 5;
export const FIFTHS = ["Bottom fifth", "Second fifth", "Middle fifth", "Fourth fifth", "Top fifth"];
export const SHORT = ["Bottom", "Second", "Middle", "Fourth", "Top"];
export const MAX_GENERATIONS = 10;
/** "Mostly forgotten" and "all but forgotten": the largest total variation distance from the long-run shares. */
export const FORGOTTEN = [0.05, 0.01];

/* ------------------------------------------------------------------- reading matrices */

/** A published matrix in thousandths becomes probabilities: each row is divided by its own total. */
export function fromPublished(rows) {
  return rows.map((row) => { const total = row.reduce((s, v) => s + v, 0); return row.map((v) => v / total); });
}
export const rowTotals = (P) => P.map((row) => row.reduce((s, v) => s + v, 0));
export const columnTotals = (P) => P[0].map((_, j) => P.reduce((s, row) => s + row[j], 0));

/**
 * Read a five-by-five grid of percentages typed by the visitor (strings). Each cell must be a number from 0 to 100,
 * and each row must add up to 100 within `tolerance` (published tables are rounded, so a little slack is allowed).
 * Returns { P, totals } with every row divided by its total, or { errors: [...], totals } saying what to fix.
 */
export function parseMatrix(cells, tolerance = 0.5) {
  const errors = [];
  if (!Array.isArray(cells) || cells.length !== N || cells.some((r) => !Array.isArray(r) || r.length !== N)) return { errors: ["The matrix must have five rows of five cells."], totals: [] };
  const values = cells.map((row, i) => row.map((text, j) => {
    const t = String(text ?? "").trim();
    const v = /^(\d+)?(\.\d*)?$/.test(t) && t !== "" && t !== "." && t.length <= 12 ? Number(t) : NaN;
    if (!(v >= 0 && v <= 100)) errors.push(`Row ${i + 1} (parents in the ${FIFTHS[i].toLowerCase()}), column ${j + 1}: type a percentage from 0 to 100, such as 20 or 12.5.`);
    return v;
  }));
  if (errors.length) return { errors, totals: values.map((row) => row.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0)) };
  const totals = values.map((row) => row.reduce((s, v) => s + v, 0));
  totals.forEach((total, i) => {
    if (Math.abs(total - 100) > tolerance + 1e-9) errors.push(`Row ${i + 1} (parents in the ${FIFTHS[i].toLowerCase()}) adds up to ${trim(total)}%, not 100%. The children of these parents must all end up somewhere.`);
  });
  if (errors.length) return { errors, totals };
  return { P: values.map((row, i) => row.map((v) => v / totals[i])), totals };
}
const trim = (x) => String(Math.round(x * 100) / 100);

/** Scale each row of a grid of percentages so that it adds up to 100. A row of zeros cannot be scaled (null). */
export function rescaleRows(values) {
  return values.map((row) => { const total = row.reduce((s, v) => s + v, 0); return total > 0 ? row.map((v) => (v / total) * 100) : null; });
}

/* ----------------------------------------------------------------------- the chain */

/** Distribution after one more generation: the row vector d times P. */
export function step(P, d) {
  const out = new Array(P.length).fill(0);
  for (let i = 0; i < P.length; i++) if (d[i]) for (let j = 0; j < P.length; j++) out[j] += d[i] * P[i][j];
  return out;
}
/** Distributions after 0, 1, ..., generations, for a family that starts in fifth `start`. Row `start` of P^k. */
export function trajectory(P, start, generations) {
  let d = P.map((_, i) => (i === start ? 1 : 0));
  const out = [d];
  for (let k = 0; k < generations; k++) { d = step(P, d); out.push(d); }
  return out;
}
export function power(P, k) {
  let R = P.map((_, i) => P.map((__, j) => (i === j ? 1 : 0)));
  for (let t = 0; t < k; t++) R = linalg.matmul(R, P);
  return R;
}

function draw(row, u) {
  let acc = 0;
  for (let j = 0; j < row.length; j++) { acc += row[j]; if (u < acc) return j; }
  for (let j = row.length - 1; j >= 0; j--) if (row[j] > 0) return j; // rounding left u just above the total
  return row.length - 1;
}
/** One family: the fifth it is in at generation 0 (the start), 1, ..., generations. Fixed by the seed. */
export function simulateFamily(P, start, generations, seed) {
  const r = rng(seed);
  const path = [start];
  for (let k = 0; k < generations; k++) path.push(draw(P[path[k]], r()));
  return path;
}
/** Many families from the same start: how many are in each fifth after `generations`. */
export function simulateMany(P, start, generations, families, seed) {
  const r = rng(seed);
  const counts = new Array(P.length).fill(0);
  for (let f = 0; f < families; f++) {
    let s = start;
    for (let k = 0; k < generations; k++) s = draw(P[s], r());
    counts[s]++;
  }
  return counts;
}

/* -------------------------------------------------------------------- structure and the long run */

/**
 * Which fifths can reach which. Returns the closed classes (sets of fifths that, once entered, are never left),
 * the transient fifths (left for good sooner or later), and the period of each closed class (1 means no rhythm).
 * This is exact: it looks only at which entries are above zero.
 */
export function structure(P) {
  const n = P.length;
  const reach = P.map((row, i) => row.map((v, j) => v > 0 || i === j));
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (reach[i][k]) for (let j = 0; j < n; j++) if (reach[k][j]) reach[i][j] = true;
  const seen = new Array(n).fill(false);
  const closed = [], transient = [];
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const cls = [];
    for (let j = 0; j < n; j++) if (reach[i][j] && reach[j][i]) { cls.push(j); seen[j] = true; }
    const leaves = cls.some((a) => P[a].some((v, b) => v > 0 && !cls.includes(b)));
    if (leaves) transient.push(...cls); else closed.push(cls);
  }
  const periods = closed.map((cls) => {
    // Breadth-first levels from the first member; every edge inside the class constrains the period.
    const level = new Map([[cls[0], 0]]);
    const queue = [cls[0]];
    let g = 0;
    const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
    while (queue.length) {
      const a = queue.shift();
      for (const b of cls) {
        if (!(P[a][b] > 0)) continue;
        if (!level.has(b)) { level.set(b, level.get(a) + 1); queue.push(b); }
        else g = gcd(g, level.get(a) + 1 - level.get(b));
      }
    }
    return g || 1;
  });
  return { closed, transient: transient.sort((a, b) => a - b), periods };
}

/**
 * The long-run shares: the distribution pi with pi P = pi. It exists and is unique when there is exactly one closed
 * class. Returns null otherwise (where a family ends up then depends on where it starts).
 */
export function stationary(P) {
  if (structure(P).closed.length !== 1) return null;
  const n = P.length;
  // (P' - I) pi = 0 with the last equation replaced by sum(pi) = 1.
  const A = P.map((_, i) => P.map((__, j) => P[j][i] - (i === j ? 1 : 0)));
  A[n - 1] = new Array(n).fill(1);
  const b = new Array(n).fill(0); b[n - 1] = 1;
  return linalg.solve(A, b).map((v) => (Math.abs(v) < 1e-14 ? 0 : v));
}

/** Total variation distance between two distributions: half the sum of the absolute differences. */
export const totalVariation = (p, q) => p.reduce((s, v, i) => s + Math.abs(v - q[i]), 0) / 2;

/**
 * How far the worst-placed family still is from the long-run shares after 0, 1, ..., maxK generations:
 * d(k) = the largest, over starting fifths, of the total variation distance between row i of P^k and pi.
 */
export function memory(P, pi, maxK) {
  let R = P.map((_, i) => P.map((__, j) => (i === j ? 1 : 0)));
  const out = [];
  for (let k = 0; k <= maxK; k++) {
    out.push(Math.max(...R.map((row) => totalVariation(row, pi))));
    if (k < maxK) R = linalg.matmul(R, P);
  }
  return out;
}
/** The first generation at which d(k) is at or below eps, or null if that has not happened by maxK. */
export function generationsToForget(P, pi, eps, maxK = 1000) {
  let R = P.map((_, i) => P.map((__, j) => (i === j ? 1 : 0)));
  for (let k = 0; k <= maxK; k++) {
    // The 1e-12 lets a distance that is exactly on the threshold in theory (0.8 * 0.5^4 = 0.05) count as reached.
    if (Math.max(...R.map((row) => totalVariation(row, pi))) <= eps + 1e-12) return k;
    R = linalg.matmul(R, P);
  }
  return null;
}

/* ----------------------------------------------------------------------------- eigenvalues */

// Complex numbers are [re, im] pairs.
const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cabs = (a) => Math.hypot(a[0], a[1]);
const conj = (a) => [a[0], -a[1]];
function csqrt(a) {
  const r = cabs(a);
  const re = Math.sqrt((r + a[0]) / 2), im = Math.sqrt(Math.max(0, (r - a[0]) / 2));
  return [re, a[1] < 0 ? -im : im];
}

/**
 * Every eigenvalue of a real square matrix, by the QR algorithm with shifts in complex arithmetic: subtract a shift,
 * factor into a unitary Q and an upper-triangular R with Householder reflections, form R Q, add the shift back, and
 * split off an eigenvalue whenever the last row of the working block has shrunk to nothing.
 * Returns [{ re, im, abs }] sorted from the largest modulus down.
 */
export function eigenvalues(M) {
  const n = M.length;
  let A = M.map((row) => row.map((v) => [v, 0]));
  const scale = Math.max(1e-300, ...M.flat().map(Math.abs));
  const found = [];
  let m = n, stalls = 0, total = 0;
  while (m > 0) {
    if (m === 1) { found.push(A[0][0]); break; }
    let off = 0;
    for (let j = 0; j < m - 1; j++) off += cabs(A[m - 1][j]);
    if (off <= 1e-13 * scale) { found.push(A[m - 1][m - 1]); m--; stalls = 0; continue; }
    if (++total > 20000) throw new Error("the eigenvalues did not converge");
    // Wilkinson shift: the eigenvalue of the trailing 2 by 2 block nearer to its last entry. Now and then an
    // arbitrary shift, which frees matrices (a pure rotation of the fifths, say) on which the usual one stalls.
    const a = A[m - 2][m - 2], b = A[m - 2][m - 1], c = A[m - 1][m - 2], d = A[m - 1][m - 1];
    let mu;
    if (++stalls % 7 === 0) mu = [d[0] + 0.618 * scale * Math.cos(stalls), 0.382 * scale * Math.sin(stalls) + 0.1 * scale];
    else {
      const half = [(a[0] - d[0]) / 2, (a[1] - d[1]) / 2];
      const root = csqrt(cadd(cmul(half, half), cmul(b, c)));
      const mid = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2];
      const e1 = cadd(mid, root), e2 = csub(mid, root);
      mu = cabs(csub(e1, d)) <= cabs(csub(e2, d)) ? e1 : e2;
    }
    for (let i = 0; i < m; i++) A[i][i] = csub(A[i][i], mu);
    // Householder QR of the leading m by m block: reflections are applied from the left, then from the right.
    const vs = [];
    for (let k = 0; k < m - 1; k++) {
      let norm = 0;
      for (let i = k; i < m; i++) norm += A[i][k][0] ** 2 + A[i][k][1] ** 2;
      norm = Math.sqrt(norm);
      if (norm === 0) { vs.push(null); continue; }
      const x0 = A[k][k], ax0 = cabs(x0);
      const phase = ax0 === 0 ? [1, 0] : [x0[0] / ax0, x0[1] / ax0];
      const v = [];
      for (let i = k; i < m; i++) v.push(A[i][k].slice());
      v[0] = cadd(v[0], [phase[0] * norm, phase[1] * norm]);
      let vn = 0;
      for (const z of v) vn += z[0] ** 2 + z[1] ** 2;
      if (vn === 0) { vs.push(null); continue; }
      vs.push({ v, vn });
      for (let j = 0; j < m; j++) {            // A <- (I - 2 v v* / vn) A, columns one at a time
        let s = [0, 0];
        for (let i = k; i < m; i++) s = cadd(s, cmul(conj(v[i - k]), A[i][j]));
        s = [(2 * s[0]) / vn, (2 * s[1]) / vn];
        for (let i = k; i < m; i++) A[i][j] = csub(A[i][j], cmul(v[i - k], s));
      }
    }
    for (let k = 0; k < m - 1; k++) {          // A <- A (I - 2 v v* / vn), for each reflection in turn
      if (!vs[k]) continue;
      const { v, vn } = vs[k];
      for (let i = 0; i < m; i++) {
        let s = [0, 0];
        for (let j = k; j < m; j++) s = cadd(s, cmul(A[i][j], v[j - k]));
        s = [(2 * s[0]) / vn, (2 * s[1]) / vn];
        for (let j = k; j < m; j++) A[i][j] = csub(A[i][j], cmul(s, conj(v[j - k])));
      }
    }
    for (let i = 0; i < m; i++) A[i][i] = cadd(A[i][i], mu);
  }
  const tidy = (x) => (Math.abs(x) < 1e-12 * scale ? 0 : x);
  // Moduli that differ only in the last few bits are the same size (the five roots of a rotation all have modulus 1):
  // they are ordered by real part, so that the eigenvalue 1 of a transition matrix always comes first.
  const size = (z) => Math.round(z.abs / (1e-9 * scale));
  return found.map(([re, im]) => ({ re: tidy(re), im: tidy(im), abs: Math.hypot(tidy(re), tidy(im)) })).sort((p, q) => size(q) - size(p) || q.re - p.re || q.im - p.im);
}

/**
 * The modulus of the second-largest eigenvalue: each generation, what is left of a family's head start (or
 * handicap) shrinks by about this factor in the long run.
 */
export function secondEigenvalue(P) {
  const e = eigenvalues(P);
  return e.length > 1 ? Math.min(1, e[1].abs) : 0;
}
/**
 * A number from 0 to 1 printed to two decimal places, or to as many more (up to six) as it takes not to print a
 * value strictly between 0 and 1 as "0.00" or "1.00": 0.99962 is "0.9996", not "1.00".
 */
export function showShare(x) {
  for (let d = 2; d <= 6; d++) {
    const t = x.toFixed(d);
    if (x <= 0 || x >= 1 || (Number(t) > 0 && Number(t) < 1)) return t;
  }
  return x < 0.5 ? "under 0.000001" : "over 0.999999";
}

/** Generations for the remaining advantage to halve at that rate: ln 2 / -ln(lambda). */
export function halfLife(lambda) {
  if (!(lambda > 0)) return 0;
  if (lambda >= 1) return Infinity;
  return Math.log(2) / -Math.log(lambda);
}

/* ----------------------------------------------------------------------------- summaries */

export function measures(P) {
  const n = P.length;
  const trace = P.reduce((s, row, i) => s + row[i], 0);
  return {
    ragsToRiches: P[0][n - 1],
    richesToRags: P[n - 1][0],
    bottomStays: P[0][0],
    topStays: P[n - 1][n - 1],
    staysPut: trace / n,                 // the average chance of ending in the parents' fifth
    traceIndex: (n - trace) / (n - 1),    // 0: nobody moves; 1: the parents' fifth tells you nothing
  };
}

/**
 * Everything the page shows about one matrix. `verdict` says, in exact structural terms, what the long run is:
 * "forgets" (one closed class, no rhythm), "cycles" (one closed class with a period above 1), or "splits" (several
 * closed classes, so the starting fifth matters for ever).
 */
export function analyse(P) {
  const s = structure(P);
  const m = measures(P);
  const lambda = secondEigenvalue(P);
  if (s.closed.length !== 1) return { ...m, structure: s, verdict: "splits", lambda, pi: null, forget: FORGOTTEN.map(() => null), halfLife: Infinity };
  const pi = stationary(P);
  if (s.periods[0] > 1) return { ...m, structure: s, verdict: "cycles", lambda, pi, forget: FORGOTTEN.map(() => null), halfLife: Infinity };
  return { ...m, structure: s, verdict: "forgets", lambda, pi, forget: FORGOTTEN.map((eps) => generationsToForget(P, pi, eps)), halfLife: halfLife(lambda) };
}
