import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { MOBILITY } from "./data.js";
import {
  N, FIFTHS, FORGOTTEN, fromPublished, rowTotals, columnTotals, parseMatrix, rescaleRows, step, trajectory, power, simulateFamily, simulateMany,
  structure, stationary, totalVariation, memory, generationsToForget, eigenvalues, secondEigenvalue, halfLife, measures, analyse, showShare,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const byId = Object.fromEntries(MOBILITY.matrices.map((m) => [m.id, m]));
const P_US = fromPublished(byId["us-children"].P);
const identity = (n = N) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
const equal = () => Array.from({ length: N }, () => new Array(N).fill(0.2));
const blend = (m) => identity().map((row) => row.map((v) => (1 - m) * v + m * 0.2)); // stay put with chance 1 - m, else reshuffle evenly
const cycle = () => Array.from({ length: N }, (_, i) => Array.from({ length: N }, (__, j) => (j === (i + 1) % N ? 1 : 0)));
function randomMatrix(seed) {
  const r = rng(seed);
  return Array.from({ length: N }, () => { const row = Array.from({ length: N }, () => r() ** 2); const t = row.reduce((s, v) => s + v, 0); return row.map((v) => v / t); });
}
/** Determinant of (M - lambda I) with complex lambda, by Gaussian elimination: an independent check on the eigenvalues. */
function charAbs(M, re, im) {
  const n = M.length;
  const A = M.map((row, i) => row.map((v, j) => [v - (i === j ? re : 0), i === j ? -im : 0]));
  const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const div = (a, b) => { const d = b[0] ** 2 + b[1] ** 2; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  let det = [1, 0];
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.hypot(...A[r][c]) > Math.hypot(...A[p][c])) p = r;
    if (Math.hypot(...A[p][c]) === 0) return 0;
    if (p !== c) { [A[c], A[p]] = [A[p], A[c]]; det = [-det[0], -det[1]]; }
    det = mul(det, A[c][c]);
    for (let r = c + 1; r < n; r++) {
      const f = div(A[r][c], A[c][c]);
      for (let k = c; k < n; k++) { const t = mul(f, A[c][k]); A[r][k] = [A[r][k][0] - t[0], A[r][k][1] - t[1]]; }
    }
  }
  return Math.hypot(...det);
}

/* ------------------------------------------------------------------------- the data */

test("the bundle holds thirteen five-by-five matrices whose rows add up to 1 within the sources' rounding", () => {
  assert.equal(MOBILITY.matrices.length, 13);
  assert.equal(new Set(MOBILITY.matrices.map((m) => m.id)).size, 13);
  assert.equal(MOBILITY.unit, 1000);
  for (const m of MOBILITY.matrices) {
    assert.equal(m.P.length, 5);
    for (const row of m.P) {
      assert.equal(row.length, 5);
      for (const v of row) assert.ok(Number.isInteger(v) && v > 0 && v < 1000);
      // Three printed decimals (or one decimal of a per cent): five cells can be out by 0.0005 each.
      assert.ok(Math.abs(row.reduce((s, v) => s + v, 0) - 1000) <= 2, `${m.id}: a row adds up to ${row.reduce((s, v) => s + v, 0)}`);
    }
    assert.ok(m.who.length > 60 && m.table.startsWith("Table") && m.pairs > 1000);
    for (const row of fromPublished(m.P)) close(row.reduce((s, v) => s + v, 0), 1, 1e-12);
  }
  assert.match(MOBILITY.retrieved, /^\d{4}-\d{2}-\d{2}$/);
});

test("cells match the figures printed in the two papers", () => {
  // Chetty, Hendren, Kline and Saez (2014), Table II. The paper prints children in rows and parents in columns:
  // "33.7% 24.2% 17.8% 13.4% 10.9%" is the first row (children in the bottom fifth, by parents' fifth).
  const us = byId["us-children"];
  assert.deepEqual(us.P.map((row) => row[0]), [337, 242, 178, 134, 109]);   // P(child in the bottom fifth | parents' fifth)
  assert.deepEqual(us.P[0], [337, 280, 184, 123, 75]);                        // children of the bottom fifth
  assert.deepEqual(us.P[4], [109, 119, 170, 236, 365]);                       // children of the top fifth
  assert.equal(us.P[0][4], 75);                                               // "This probability is 7.5% in the U.S."
  assert.equal(us.pairs, 9867736);                                            // "the 9,867,736 children in the core sample"
  // Jäntti et al. (2006), Table 12, fathers and sons.
  assert.deepEqual(byId["us-sons"].P[0], [422, 245, 153, 102, 79]);
  assert.deepEqual(byId["us-sons"].P[4], [95, 122, 189, 234, 360]);
  assert.deepEqual(byId["dk-sons"].P[0], [247, 226, 194, 189, 144]);
  assert.deepEqual(byId["uk-sons"].P[2], [188, 195, 227, 206, 184]);
  assert.deepEqual(byId["se-sons"].P[4], [163, 140, 134, 193, 371]);
  assert.deepEqual(byId["no-sons"].P[1], [202, 238, 223, 200, 137]);
  assert.deepEqual(byId["fi-sons"].P[3], [164, 195, 195, 229, 218]);
  assert.deepEqual([byId["dk-sons"].pairs, byId["fi-sons"].pairs, byId["no-sons"].pairs, byId["se-sons"].pairs, byId["uk-sons"].pairs, byId["us-sons"].pairs], [59213, 5458, 26656, 31996, 2205, 1798]);
  // Table 13, fathers and daughters.
  assert.deepEqual(byId["us-daughters"].P[4], [180, 114, 143, 225, 338]);
  assert.deepEqual(byId["dk-daughters"].P[0], [235, 213, 206, 185, 160]);
  assert.deepEqual(byId["uk-daughters"].P[3], [200, 209, 194, 226, 172]);
  assert.deepEqual([byId["dk-daughters"].pairs, byId["us-daughters"].pairs], [55178, 1607]);
});

test("every cell of every table: row and column totals from a second, independent reading of the two PDFs", () => {
  // Review of 12 October 2026: both papers were downloaded again and read with a different extractor (pypdf, by the
  // position of each number on the page, not pdftotext). All 325 cells agreed. These are that reading's totals, in
  // thousandths: rows are fathers' or parents' fifths, columns the children's.
  const read = {
    "us-children": [[999, 1000, 1000, 1001, 999], [1000, 999, 1001, 999, 1000]],   // printed the other way round: parents in columns
    "dk-sons": [[1000, 1000, 1001, 1000, 999], [961, 982, 998, 1016, 1043]],
    "fi-sons": [[1000, 1001, 999, 1001, 1000], [962, 999, 1006, 1014, 1020]],
    "no-sons": [[999, 1000, 999, 999, 999], [991, 999, 1002, 999, 1005]],
    "se-sons": [[1001, 999, 1000, 1000, 1001], [988, 996, 1001, 1005, 1011]],
    "uk-sons": [[999, 1000, 1000, 1000, 1000], [1000, 1000, 1000, 999, 1000]],
    "us-sons": [[1001, 999, 1000, 1000, 1000], [1030, 1018, 1004, 964, 984]],
    "dk-daughters": [[999, 1000, 1000, 1001, 1001], [988, 981, 993, 1009, 1030]],
    "fi-daughters": [[1000, 999, 1000, 999, 999], [1000, 988, 991, 1005, 1013]],
    "no-daughters": [[1000, 1001, 1000, 999, 999], [997, 996, 1003, 1001, 1002]],
    "se-daughters": [[1000, 1000, 1001, 1000, 1000], [990, 995, 1001, 1003, 1012]],
    "uk-daughters": [[1001, 1000, 1000, 1001, 1001], [1001, 1002, 999, 1002, 999]],
    "us-daughters": [[1000, 1000, 1000, 1000, 1000], [1006, 1022, 981, 993, 998]],
  };
  assert.equal(Object.keys(read).length, MOBILITY.matrices.length);
  for (const m of MOBILITY.matrices) {
    assert.deepEqual(m.P.map((row) => row.reduce((t, v) => t + v, 0)), read[m.id][0], `${m.id}: row totals`);
    assert.deepEqual(m.P[0].map((_, j) => m.P.reduce((t, row) => t + row[j], 0)), read[m.id][1], `${m.id}: column totals`);
  }
  // Every table is stored the same way round: it is the rows, the parents, that are complete distributions.
  // In the Jäntti tables the columns stray as far as 0.961 and 1.043, so the orientation cannot be mistaken.
  for (const m of MOBILITY.matrices) for (const row of m.P) assert.ok(Math.abs(row.reduce((t, v) => t + v, 0) - 1000) <= 1);
});

test("rescaling a published row never changes the figure printed to one decimal place", () => {
  for (const m of MOBILITY.matrices) fromPublished(m.P).forEach((row, i) => row.forEach((v, j) => assert.equal((v * 100).toFixed(1), (m.P[i][j] / 10).toFixed(1))));
});

/* ---------------------------------------------------------------------- the chain */

test("a two-state chain, by hand", () => {
  const P = [[0.9, 0.1], [0.5, 0.5]];
  assert.deepEqual(step(P, [1, 0]), [0.9, 0.1]);
  const t = trajectory(P, 0, 2);
  close(t[2][0], 0.9 * 0.9 + 0.1 * 0.5); // 0.86
  close(t[2][1], 0.14);
  const pi = stationary(P);
  close(pi[0], 5 / 6); close(pi[1], 1 / 6);
  const e = eigenvalues(P);
  close(e[0].re, 1, 1e-10); close(e[1].re, 0.4, 1e-10);
  close(secondEigenvalue(P), 0.4, 1e-10);
  // d(k) = 0.4^k * (largest starting distance): from state 1 the distance is 5/6.
  const d = memory(P, pi, 3);
  close(d[0], 5 / 6); close(d[1], (5 / 6) * 0.4); close(d[3], (5 / 6) * 0.4 ** 3);
});

test("the trajectory is a row of the matrix power, and each distribution adds up to 1", () => {
  for (const m of MOBILITY.matrices) {
    const P = fromPublished(m.P);
    for (const start of [0, 2, 4]) {
      const t = trajectory(P, start, 6);
      assert.equal(t.length, 7);
      assert.deepEqual(t[0], [0, 0, 0, 0, 0].map((_, i) => (i === start ? 1 : 0)));
      const P6 = power(P, 6);
      t[6].forEach((v, j) => close(v, P6[start][j], 1e-12));
      for (const d of t) close(d.reduce((s, v) => s + v, 0), 1, 1e-12);
    }
  }
  assert.deepEqual(power(P_US, 0), identity());
});

test("the United States matrix, two generations on, by hand", () => {
  // Grandchildren of the bottom fifth who reach the top: sum over the parents' fifth of P[0][k] P[k][4].
  const p = byId["us-children"].P.map((row) => { const t = row.reduce((s, v) => s + v, 0); return row.map((v) => v / t); });
  const byHand = p[0][0] * p[0][4] + p[0][1] * p[1][4] + p[0][2] * p[2][4] + p[0][3] * p[3][4] + p[0][4] * p[4][4];
  close(trajectory(P_US, 0, 2)[2][4], byHand, 1e-14);
  close(byHand, 0.1522, 0.0001);
});

test("one family's path is fixed by the seed and follows the matrix", () => {
  const a = simulateFamily(P_US, 0, 10, 53);
  assert.deepEqual(a, simulateFamily(P_US, 0, 10, 53));
  assert.equal(a.length, 11);
  assert.equal(a[0], 0);
  assert.ok(a.every((s) => Number.isInteger(s) && s >= 0 && s < 5));
  assert.notDeepEqual(a, simulateFamily(P_US, 0, 10, 54));
  assert.deepEqual(simulateFamily(identity(), 3, 5, 1), [3, 3, 3, 3, 3, 3]);
  assert.deepEqual(simulateFamily(cycle(), 0, 6, 9), [0, 1, 2, 3, 4, 0, 1]);
  assert.deepEqual(simulateFamily(P_US, 2, 0, 1), [2]);
  // A zero entry is never drawn.
  const never = [[0, 1, 0, 0, 0], [0.5, 0, 0.5, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, 0, 1], [0, 0, 0, 0, 1]];
  for (let seed = 1; seed <= 200; seed++) { const path = simulateFamily(never, 0, 8, seed); for (let k = 0; k < 8; k++) assert.ok(never[path[k]][path[k + 1]] > 0); }
});

test("many simulated families agree with the exact distribution", () => {
  const families = 200000;
  for (const [start, k] of [[0, 1], [0, 3], [4, 2]]) {
    const counts = simulateMany(P_US, start, k, families, 7);
    assert.equal(counts.reduce((s, v) => s + v, 0), families);
    const exact = trajectory(P_US, start, k)[k];
    counts.forEach((c, j) => close(c / families, exact[j], 0.004));
  }
  assert.deepEqual(simulateMany(P_US, 0, 3, 10000, 53), simulateMany(P_US, 0, 3, 10000, 53));
});

/* ------------------------------------------------------------- structure and the long run */

test("structure: closed classes, transient fifths and periods", () => {
  assert.deepEqual(structure(P_US), { closed: [[0, 1, 2, 3, 4]], transient: [], periods: [1] });
  assert.deepEqual(structure(identity()), { closed: [[0], [1], [2], [3], [4]], transient: [], periods: [1, 1, 1, 1, 1] });
  assert.deepEqual(structure(cycle()), { closed: [[0, 1, 2, 3, 4]], transient: [], periods: [5] });
  // The top fifth is a trap: everyone gets there in the end.
  const trap = [[0.5, 0.5, 0, 0, 0], [0, 0.5, 0.5, 0, 0], [0, 0, 0.5, 0.5, 0], [0, 0, 0, 0.5, 0.5], [0, 0, 0, 0, 1]];
  assert.deepEqual(structure(trap), { closed: [[4]], transient: [0, 1, 2, 3], periods: [1] });
  assert.deepEqual(stationary(trap), [0, 0, 0, 0, 1]);
  // Two castes that never mix, and a middle that falls into one or the other.
  const castes = [[0.5, 0.5, 0, 0, 0], [0.5, 0.5, 0, 0, 0], [0, 0.3, 0.4, 0.3, 0], [0, 0, 0, 0.5, 0.5], [0, 0, 0, 0.5, 0.5]];
  const s = structure(castes);
  assert.deepEqual(s.closed, [[0, 1], [3, 4]]);
  assert.deepEqual(s.transient, [2]);
  assert.equal(stationary(castes), null);
  // Swap bottom and top every generation: a rhythm of two.
  const swap = [[0, 0, 0, 0, 1], [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 0], [1, 0, 0, 0, 0]];
  assert.deepEqual(structure(swap).closed, [[0, 4], [1], [2], [3]]);
  assert.deepEqual(structure(swap).periods, [2, 1, 1, 1]);
});

test("the long-run shares: equal fifths when the columns add up to 1 too, and always a fixed point", () => {
  for (const v of stationary(equal())) close(v, 0.2, 1e-12);
  for (const v of stationary(blend(0.3))) close(v, 0.2, 1e-12);
  for (const v of stationary(cycle())) close(v, 0.2, 1e-12);
  for (const m of MOBILITY.matrices) {
    const P = fromPublished(m.P);
    const pi = stationary(P);
    close(pi.reduce((s, v) => s + v, 0), 1, 1e-12);
    step(P, pi).forEach((v, j) => close(v, pi[j], 1e-12));
    // Published columns do not add up to exactly 1, so the shares are near a fifth, not exactly a fifth.
    for (const v of pi) close(v, 0.2, 0.012);
  }
  // Chetty et al.: columns add up to within 0.001 of 1, and the long-run shares to within 0.03 points of a fifth.
  for (const c of columnTotals(P_US)) close(c, 1, 0.0015);
  for (const v of stationary(P_US)) close(v, 0.2, 0.0003);
  // Jäntti et al., Denmark, sons: the printed columns add up to 0.961 ... 1.043, which tilts the long run to the top.
  const dk = columnTotals(fromPublished(byId["dk-sons"].P));
  close(dk[0], 0.961, 0.001); close(dk[4], 1.043, 0.001);
  assert.ok(stationary(fromPublished(byId["dk-sons"].P))[4] > 0.21);
  for (const t of rowTotals(P_US)) close(t, 1, 1e-12);
});

test("total variation distance", () => {
  close(totalVariation([1, 0, 0, 0, 0], [0.2, 0.2, 0.2, 0.2, 0.2]), 0.8);
  close(totalVariation([0.2, 0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2, 0.2]), 0);
  close(totalVariation([0.5, 0.5], [0.25, 0.75]), 0.25);
});

test("memory of a blend of 'stay put' and 'reshuffle evenly' has a closed form", () => {
  // P^k = (1 - m)^k I + (1 - (1 - m)^k) J / 5, so d(k) = 0.8 (1 - m)^k and the second eigenvalue is 1 - m, four times over.
  for (const m of [0.1, 0.5, 0.9]) {
    const P = blend(m), pi = stationary(P);
    const d = memory(P, pi, 12);
    d.forEach((v, k) => close(v, 0.8 * (1 - m) ** k, 1e-12));
    const e = eigenvalues(P);
    close(e[0].abs, 1, 1e-10);
    for (let i = 1; i < 5; i++) { close(e[i].re, 1 - m, 1e-9); close(e[i].im, 0, 1e-9); }
    for (const eps of FORGOTTEN) assert.equal(generationsToForget(P, pi, eps), Math.ceil(Math.log(eps / 0.8) / Math.log(1 - m) - 1e-9));
  }
  assert.equal(generationsToForget(equal(), stationary(equal()), 0.05), 1);
  assert.equal(generationsToForget(cycle(), stationary(cycle()), 0.05, 200), null); // a rotation never forgets
});

test("eigenvalues: known spectra", () => {
  const abs = (M) => eigenvalues(M).map((z) => z.abs);
  abs(identity()).forEach((v) => close(v, 1, 1e-10));
  const eq = abs(equal());
  close(eq[0], 1, 1e-10); for (let i = 1; i < 5; i++) close(eq[i], 0, 1e-8);
  // A rotation of the fifths: the five fifth roots of unity.
  const roots = eigenvalues(cycle());
  for (const z of roots) close(z.abs, 1, 1e-10);
  const angles = roots.map((z) => Math.round((Math.atan2(z.im, z.re) / (2 * Math.PI)) * 5)).sort((a, b) => a - b);
  assert.deepEqual(angles, [-2, -1, 0, 1, 2]);
  // An upper-triangular matrix: the diagonal.
  const tri = [[0.5, 0.5, 0, 0, 0], [0, 0.4, 0.6, 0, 0], [0, 0, 0.3, 0.7, 0], [0, 0, 0, 0.2, 0.8], [0, 0, 0, 0, 1]];
  eigenvalues(tri).map((z) => z.re).forEach((v, i) => close(v, [1, 0.5, 0.4, 0.3, 0.2][i], 1e-9));
  // A defective one (a repeated eigenvalue with one eigenvector) still gives the right values, less precisely.
  const jordan = [[0.5, 0.5, 0, 0, 0], [0, 0.5, 0.5, 0, 0], [0, 0, 0.5, 0.5, 0], [0, 0, 0, 0.5, 0.5], [0, 0, 0, 0, 1]];
  const j = eigenvalues(jordan);
  close(j[0].abs, 1, 1e-6); for (let i = 1; i < 5; i++) close(j[i].abs, 0.5, 1e-3);
  assert.deepEqual(eigenvalues([[3]]).map((z) => z.re), [3]);
});

test("the eigenvalue 1 is always listed first, even when others are as large in size", () => {
  // A rotation of the fifths has five eigenvalues of modulus 1: the page says one of them is 1 and prints it first.
  const first = (M) => eigenvalues(M)[0];
  close(first(cycle()).re, 1, 1e-9); close(first(cycle()).im, 0, 1e-9);
  const swap = [[0, 1, 0, 0, 0], [1, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 1], [0, 0, 0, 1, 0]]; // eigenvalues 1, 1, 1, -1, -1
  assert.deepEqual(eigenvalues(swap).map((z) => Math.round(z.re)), [1, 1, 1, -1, -1]);
  for (const m of MOBILITY.matrices) { const z = first(fromPublished(m.P)); close(z.re, 1, 1e-9); close(z.im, 0, 1e-9); }
  for (let seed = 1; seed <= 30; seed++) { const z = first(randomMatrix(seed)); close(z.re, 1, 1e-9); close(z.im, 0, 1e-9); }
});

test("a share strictly between 0 and 1 is never printed as 0.00 or 1.00", () => {
  assert.equal(showShare(0.3224), "0.32");
  assert.equal(showShare(0.99962), "0.9996");   // a very sticky table: memory is not "1.00"
  assert.equal(showShare(0.996), "0.996");
  assert.equal(showShare(0.004), "0.004");
  assert.equal(showShare(1), "1.00");
  assert.equal(showShare(0), "0.00");
  assert.equal(showShare(0.9999999999), "over 0.999999");
  assert.equal(showShare(1e-9), "under 0.000001");
});

test("eigenvalues of random matrices satisfy the characteristic equation, the trace and the determinant", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const M = randomMatrix(seed);
    const e = eigenvalues(M);
    assert.equal(e.length, 5);
    close(e[0].re, 1, 1e-9); close(e[0].im, 0, 1e-9);
    close(e.reduce((s, z) => s + z.re, 0), M.reduce((s, row, i) => s + row[i], 0), 1e-9);
    close(e.reduce((s, z) => s + z.im, 0), 0, 1e-9);
    for (const z of e) assert.ok(charAbs(M, z.re, z.im) < 1e-9, `seed ${seed}: det(M - z I) = ${charAbs(M, z.re, z.im)}`);
    // The product of the eigenvalues is the determinant.
    let prod = [1, 0];
    for (const z of e) prod = [prod[0] * z.re - prod[1] * z.im, prod[0] * z.im + prod[1] * z.re];
    close(Math.hypot(...prod), charAbs(M, 0, 0), 1e-9);
    for (let i = 1; i < 5; i++) assert.ok(e[i].abs <= e[i - 1].abs + 1e-12);
  }
  for (const m of MOBILITY.matrices) { const P = fromPublished(m.P); for (const z of eigenvalues(P)) assert.ok(charAbs(P, z.re, z.im) < 1e-10); }
});

test("the second eigenvalue is the rate at which memory fades", () => {
  for (const m of MOBILITY.matrices) {
    const P = fromPublished(m.P), pi = stationary(P), lambda = secondEigenvalue(P);
    const d = memory(P, pi, 12);
    close(d[12] / d[11], lambda, 0.002);
    assert.ok(lambda > 0.1 && lambda < 0.4);
  }
  close(halfLife(0.5), 1);
  close(halfLife(0.25), 0.5);
  assert.equal(halfLife(0), 0);
  assert.equal(halfLife(1), Infinity);
});

/* ------------------------------------------------------------------------- summaries */

test("summary measures, by hand", () => {
  const m = measures(P_US);
  close(m.ragsToRiches, 75 / 999, 1e-12);
  close(m.bottomStays, 337 / 999, 1e-12);
  close(m.topStays, 365 / 999, 1e-12);
  close(m.richesToRags, 109 / 999, 1e-12);
  const trace = 337 / 999 + 242 / 1000 + 221 / 1000 + 244 / 1001 + 365 / 999;
  close(m.staysPut, trace / 5, 1e-12);
  close(m.traceIndex, (5 - trace) / 4, 1e-12);
  assert.deepEqual(measures(identity()), { ragsToRiches: 0, richesToRags: 0, bottomStays: 1, topStays: 1, staysPut: 1, traceIndex: 0 });
  close(measures(equal()).traceIndex, 1, 1e-12);
});

test("analyse: the three verdicts", () => {
  const us = analyse(P_US);
  assert.equal(us.verdict, "forgets");
  assert.deepEqual(us.forget, [3, 4]);
  const id = analyse(identity());
  assert.equal(id.verdict, "splits");
  assert.equal(id.pi, null);
  assert.deepEqual(id.forget, [null, null]);
  assert.equal(id.halfLife, Infinity);
  const cy = analyse(cycle());
  assert.equal(cy.verdict, "cycles");
  assert.deepEqual(cy.forget, [null, null]);
  close(cy.lambda, 1, 1e-9);
  const eq = analyse(equal());
  assert.equal(eq.verdict, "forgets");
  assert.deepEqual(eq.forget, [1, 1]);
  close(eq.lambda, 0, 1e-8);
});

test("the finding: the United States matrix of Chetty and co-authors", () => {
  const a = analyse(P_US);
  assert.equal((a.ragsToRiches * 100).toFixed(1), "7.5");
  assert.equal((a.bottomStays * 100).toFixed(1), "33.7");
  assert.equal(a.lambda.toFixed(2), "0.32");
  const three = trajectory(P_US, 0, 3)[3], top = trajectory(P_US, 4, 3)[3];
  assert.equal((three[4] * 100).toFixed(1), "18.4");   // great-grandchild of the bottom fifth reaches the top
  assert.equal((top[4] * 100).toFixed(1), "21.5");     // great-grandchild of the top fifth is at the top
  assert.equal((three[0] * 100).toFixed(1), "21.2");
  const d = memory(P_US, a.pi, 4);
  assert.equal((d[1] * 100).toFixed(1), "21.8");
  assert.equal((d[3] * 100).toFixed(1), "2.2");
  assert.deepEqual(a.forget, [3, 4]);
  // The same question in the father-son matrices of Jäntti et al.
  const us = analyse(fromPublished(byId["us-sons"].P)), dk = analyse(fromPublished(byId["dk-sons"].P));
  assert.equal((us.bottomStays * 100).toFixed(1), "42.2");
  assert.equal((dk.bottomStays * 100).toFixed(1), "24.7");
  assert.deepEqual(us.forget, [3, 5]);
  assert.deepEqual(dk.forget, [2, 3]);
  // "In every published table on this page, a family's starting point is mostly forgotten within two or three generations."
  for (const m of MOBILITY.matrices) assert.ok([2, 3].includes(analyse(fromPublished(m.P)).forget[0]), m.id);
});

/* ------------------------------------------------------------------- the visitor's matrix */

test("a typed matrix is checked cell by cell and row by row", () => {
  const good = byId["us-children"].P.map((row) => row.map((v) => String(v / 10)));
  const ok = parseMatrix(good);
  assert.equal(ok.errors, undefined);
  ok.P.forEach((row, i) => row.forEach((v, j) => close(v, P_US[i][j], 1e-12)));
  close(ok.totals[0], 99.9, 1e-9);
  // One bad cell.
  for (const bad of ["", "abc", "-1", "101", "1e2", "12,5", ".", "9".repeat(300), "NaN", "Infinity", " "]) {
    const cells = good.map((r) => [...r]); cells[1][3] = bad;
    const out = parseMatrix(cells);
    assert.equal(out.P, undefined);
    assert.equal(out.errors.length, 1);
    assert.match(out.errors[0], /Row 2 .*second fifth.*column 4: type a percentage from 0 to 100/);
  }
  // A row that does not add up.
  const cells = good.map((r) => [...r]); cells[2][2] = "30";
  const out = parseMatrix(cells);
  assert.match(out.errors[0], /Row 3 \(parents in the middle fifth\) adds up to 107\.9%, not 100%/);
  // Within the slack: 99.6 passes and is rescaled; 99.4 does not.
  const near = equal().map((r) => r.map(() => "20")); near[0] = ["19.6", "20", "20", "20", "20"];
  assert.ok(parseMatrix(near).P);
  close(parseMatrix(near).P[0].reduce((s, v) => s + v, 0), 1, 1e-12);
  near[0][0] = "19.4";
  assert.ok(parseMatrix(near).errors);
  // Wrong shapes.
  assert.ok(parseMatrix([["1"]]).errors);
  assert.ok(parseMatrix(null).errors);
  // Decimals and spaces are fine.
  const dec = equal().map((r) => r.map(() => " 20.000 "));
  assert.ok(parseMatrix(dec).P);
  // Zeros and hundreds are allowed.
  assert.deepEqual(parseMatrix(identity().map((r) => r.map((v) => String(v * 100)))).P, identity());
});

test("rescaling rows", () => {
  const out = rescaleRows([[10, 10, 10, 10, 10], [0, 0, 0, 0, 0], [20, 20, 20, 20, 20], [1, 2, 3, 4, 0], [50, 50, 50, 50, 0]]);
  assert.deepEqual(out[0], [20, 20, 20, 20, 20]);
  assert.equal(out[1], null);
  assert.deepEqual(out[2], [20, 20, 20, 20, 20]);
  assert.deepEqual(out[3], [10, 20, 30, 40, 0]);
  assert.deepEqual(out[4], [25, 25, 25, 25, 0]);
  assert.equal(FIFTHS.length, N);
});
