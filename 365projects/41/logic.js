// Day 41: Oil Price Shock Economy. The model, with no DOM code.
// The Leontief price model with one price set from outside: the price of one sector's output jumps, every
// other sector passes its higher costs on in full, and input proportions stay fixed.

import { linalg } from "../kit/kit.js";

/** The slider's range for the jump, as fractions: a fall of 50% to a rise of 200%. */
export const JUMP_MIN = -0.5;
export const JUMP_MAX = 2;

/** "" if the jump can be used, otherwise what is wrong with it. */
export function jumpProblem(jump) {
  if (typeof jump !== "number" || !Number.isFinite(jump)) return "The price jump must be a number.";
  if (jump < JUMP_MIN - 1e-12 || jump > JUMP_MAX + 1e-12) return `The price jump must be between ${JUMP_MIN * 100}% and +${JUMP_MAX * 100}%.`;
  return "";
}

/**
 * Direct input coefficients. A[i][j] is what sector j buys from sector i per dollar of its own output:
 * the cost share of input i in product j.
 */
export function coefficients(table) {
  return table.flows.map((row) => row.map((v, j) => v / table.output[j]));
}

/**
 * How a rise in one sector's price passes through to all the others, per unit of that rise.
 *
 * With k the sector whose price is set from outside and E the rest, the other prices solve
 *     dp_j = a_kj + sum over i in E of a_ij dp_i        for every j in E,
 * which is (I - A_EE') dp_E = a_kE. Everything returned is linear in the size of the jump, so the
 * caller multiplies by it.
 *
 * Returns { error } if the table cannot be solved, otherwise:
 *   k          index of the sector whose price jumps
 *   perUnit    rise in each sector's price per unit rise in sector k's (1 for k itself)
 *   direct     the part that arrives with sector k's product bought directly: a_kj (1 for k itself)
 *   indirect   perUnit - direct: the part embedded in everything else the sector buys (0 for k itself)
 *   weights    each sector's share of household consumption
 *   basket     rise in the price of the household basket per unit rise: sum of weights x perUnit
 *   rounds(T)  T arrays: the rise counted up to round 1, 2, ... T (round 1 is the direct part)
 *   inputsOf(j)   where sector j's rise comes from: one entry per supplier, adding up to perUnit[j]
 *   basketParts() where the basket's rise comes from: one entry per product, adding up to basket
 */
export function passThrough(table, source = "oil") {
  const n = table.sectors.length;
  const k = table.sectors.findIndex((s) => s.id === source);
  if (k < 0) return { error: `There is no sector called "${source}" in the table.` };
  if (n < 2) return { error: "The table needs at least two sectors." };
  const A = coefficients(table);
  if (A.some((row) => row.some((v) => !Number.isFinite(v) || v < 0))) return { error: "Every flow must be zero or more and every sector must have some output." };
  const E = [];
  for (let j = 0; j < n; j++) if (j !== k) E.push(j);

  let x;
  try {
    // Row j of the system: sum over i of (1 if i = j, less a_ij) dp_i = a_kj.
    x = linalg.solve(E.map((j) => E.map((i) => (i === j ? 1 : 0) - A[i][j])), E.map((j) => A[k][j]));
  } catch {
    return { error: "These input shares leave no room for value added, so prices have no solution." };
  }
  if (x.some((v) => !Number.isFinite(v) || v < -1e-9)) return { error: "These input shares leave no room for value added, so prices have no solution." };

  const perUnit = new Array(n).fill(1);
  const direct = new Array(n).fill(1);
  E.forEach((j, e) => { perUnit[j] = x[e]; direct[j] = A[k][j]; });
  const indirect = perUnit.map((v, j) => (j === k ? 0 : v - direct[j]));

  const spending = table.consumption.reduce((s, v) => s + v, 0);
  const weights = table.consumption.map((v) => v / spending);
  const basket = weights.reduce((s, w, i) => s + w * perUnit[i], 0);

  function rounds(T) {
    const out = [];
    let wave = perUnit.map((_, j) => (j === k ? 0 : A[k][j]));      // round 1: the product bought directly
    let sum = wave.map((v, j) => (j === k ? 1 : v));
    for (let t = 1; t <= T; t++) {
      out.push(sum);
      const next = new Array(n).fill(0);
      for (const j of E) { let s = 0; for (const i of E) s += A[i][j] * wave[i]; next[j] = s; }
      wave = next;
      sum = sum.map((v, j) => v + wave[j]);
    }
    return out;
  }

  const inputsOf = (j) => {
    if (j === k) return [];
    return table.sectors.map((s, i) => ({ i, id: s.id, name: s.name, share: A[i][j], carries: A[i][j] * perUnit[i] }))
      .sort((a, b) => b.carries - a.carries);
  };
  const basketParts = () => table.sectors.map((s, i) => ({ i, id: s.id, name: s.name, share: weights[i], carries: weights[i] * perUnit[i] }))
    .sort((a, b) => b.carries - a.carries);

  return { k, n, A, perUnit, direct, indirect, weights, basket, rounds, inputsOf, basketParts };
}

/** The basket's rise when only the first T rounds are counted, per unit rise in the source's price. */
export function basketAfter(result, cumulative) {
  return result.weights.reduce((s, w, i) => s + w * cumulative[i], 0);
}

/**
 * The "Look inside" table for sector j, or for the household basket when j is null, for a jump given as a
 * fraction: the `top` largest contributions, everything else, and (for a sector) the two kinds of input whose
 * price is held fixed, value added and inputs from outside the table.
 * Shares are percentages to one decimal and points are percentage points to two. Each row is rounded first and
 * the "rest" row is what is left, so both columns add up to the totals shown.
 *
 * Returns { total, parts: [{ id, name, share, rise, points }], rest: { share, points }, fixed: [{ id, share }] }.
 */
export function breakdown(result, table, j, jump, top = 6) {
  const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
  const basket = j === null;
  const total = r2(100 * jump * (basket ? result.basket : result.perUnit[j]));
  const parts = (basket ? result.basketParts() : result.inputsOf(j)).slice(0, top)
    .map((p) => ({ id: p.id, name: p.name, share: r1(100 * p.share), rise: r2(100 * jump * result.perUnit[p.i]), points: r2(100 * jump * p.carries) }));
  const fixed = basket ? [] : [
    { id: "valueAdded", share: r1((100 * table.valueAdded[j]) / table.output[j]) },
    { id: "outside", share: r1((100 * (table.outside ? table.outside[j] : 0)) / table.output[j]) },
  ];
  const rest = {
    share: r1(100 - parts.reduce((s, p) => s + p.share, 0) - fixed.reduce((s, f) => s + f.share, 0)),
    points: r2(total - parts.reduce((s, p) => s + p.points, 0)),
  };
  return { total, parts, rest, fixed };
}

/** The full Leontief inverse (I - A)^-1, used to check the result: dp_j = L[k][j] / L[k][k]. */
export function leontiefInverse(table) {
  const A = coefficients(table);
  return linalg.inverse(A.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - v)));
}
