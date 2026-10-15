// Day 82: Banking Contagion Network. The model, with no DOM code.
// Clearing payments in a network of banks (Eisenberg and Noe 2001), with outside debts that may rank ahead of
// interbank debts (Acemoglu, Ozdaglar and Tahbaz-Salehi 2015), solved exactly by the fictitious default algorithm.

import { rng, linalg } from "../kit/kit.js";

export const SHAPES = ["ring", "complete", "clusters", "random"];
export const LIMITS = {
  n: { min: 4, max: 30 },
  a: { min: 1, max: 1e6 },
  buffer: { min: 0.5, max: 50 }, // a - v, per bank
  y: { min: 0, max: 300 },
  shock: { min: 0, max: 100 }, // share of a, in %
  delta: { min: 0, max: 0.5 },
  k: { min: 1, max: 29 },
};
export const DEFAULTS = { n: 10, shape: "ring", a: 100, buffer: 6, y: 100, shock: 40, delta: 0.05, k: 3, seed: 1, senior: true, hit: 0 };

/**
 * Interbank liabilities L[i][j]: what bank i owes bank j. Every shape is regular: each bank owes y in all and is
 * owed y in all (two clusters need an even number of banks).
 *  ring      bank i owes y to bank i + 1 (the last owes the first);
 *  complete  bank i owes y/(n - 1) to every other bank;
 *  clusters  two halves; a bank owes (1 - delta) y spread over its own half and delta y over the other half;
 *  random    bank i owes y/k to each of k creditors, chosen as k random matchings with no bank owing itself or the
 *            same bank twice, so that every bank also has k debtors.
 */
export function network(shape, n, y, { delta = 0.05, k = 3, seed = 1 } = {}) {
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  if (shape === "ring") for (let i = 0; i < n; i++) L[i][(i + 1) % n] = y;
  else if (shape === "complete") for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i !== j) L[i][j] = y / (n - 1); }
  else if (shape === "clusters") {
    if (n % 2) throw new Error("two clusters need an even number of banks");
    const m = n / 2;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const same = (i < m) === (j < m);
      L[i][j] = same ? ((1 - delta) * y) / (m - 1) : (delta * y) / m;
    }
  } else if (shape === "random") {
    const kk = Math.min(k, n - 1);
    const pairs = randomRegular(n, kk, seed);
    for (const [i, j] of pairs) L[i][j] = y / kk;
  } else throw new Error(`unknown shape ${shape}`);
  return L;
}

/**
 * A random directed graph in which every node has k out-links and k in-links, none to itself and none repeated:
 * k random permutations drawn one after another, each redrawn until it adds only new links. After 2,000 failed
 * draws it falls back on the circulant graph (i owes i + 1, ..., i + k), which is always valid.
 */
export function randomRegular(n, k, seed) {
  const g = rng(seed);
  for (let attempt = 0; attempt < 50; attempt++) {
    const used = new Set();
    const pairs = [];
    let ok = true;
    for (let r = 0; r < k && ok; r++) {
      let placed = false;
      for (let tries = 0; tries < 40 && !placed; tries++) {
        const perm = g.shuffle([...Array(n).keys()]);
        if (perm.some((j, i) => j === i || used.has(i * n + j))) continue;
        perm.forEach((j, i) => { used.add(i * n + j); pairs.push([i, j]); });
        placed = true;
      }
      ok = placed;
    }
    if (ok) return pairs;
  }
  const pairs = [];
  for (let i = 0; i < n; i++) for (let s = 1; s <= k; s++) pairs.push([i, (i + s) % n]);
  return pairs;
}

/**
 * Balance sheets. Every bank holds outside assets a and owes v = a - buffer to depositors and other outside
 * creditors; its interbank claims and debts follow L. The shocked bank loses `shock` per cent of its outside assets.
 */
export function bankSystem({ L, a, buffer, hit, shock }) {
  const n = L.length;
  const e = new Array(n).fill(a);
  e[hit] = a * (1 - shock / 100);
  return { L, e, v: new Array(n).fill(a - buffer), a, buffer, hit, shock };
}

/**
 * Clear the system: the greatest clearing vector, by Eisenberg and Noe's fictitious default algorithm.
 *
 * Bank i has cash h_i = e_i + sum_j share_ji X_j, where X_j is what bank j pays the other banks in all and
 * share_ji = L_ji / y_j the part of it that goes to bank i. It owes v_i outside and y_i = sum_j L_ij to banks.
 *  senior = true  (Acemoglu, Ozdaglar and Tahbaz-Salehi): outside creditors are paid first, so
 *                 X_i = min(y_i, max(0, h_i - v_i));
 *  senior = false (Eisenberg and Noe): everyone is paid in proportion to their claim, so
 *                 X_i = (y_i / (v_i + y_i)) min(v_i + y_i, max(0, h_i)).
 *
 * Round 1 assumes every bank pays in full and finds the banks that still cannot: the first wave of defaults. Each
 * later round fixes the payments of the banks that have defaulted so far, with everyone else still paying in full,
 * and finds the banks those smaller payments bring down: the next wave. Payments only fall from round to round, so a
 * bank never recovers, and there are at most n rounds.
 *
 * Fixing the defaulters' payments means solving X_i = s_i (h_i - c_i) for the defaulters that pay part of their
 * debts, with s_i = 1, c_i = v_i (senior) or s_i = y_i / (v_i + y_i), c_i = 0 (equal ranking), while some pay
 * nothing and some, briefly, all. Which of the three applies is read from the current payments, and the linear
 * equations are then solved exactly. When outside creditors come first a closed group of defaulters that owe only
 * each other gives equations with no solution, and a guess of which bank pays nothing can be wrong; then the tool
 * follows rounds of "everyone pays what their cash allows" from the current payments, which only move down towards
 * the answer, jumping exactly to the last round before some bank's state changes, and guesses again. A test checks
 * the result against those rounds run to the end.
 */
export function clear(sys, { senior = true } = {}) {
  const { L, e, v } = sys;
  const n = L.length;
  const y = L.map((row) => row.reduce((s, x) => s + x, 0));
  const slope = y.map((yi, i) => (senior ? 1 : yi / (v[i] + yi)));
  const cut = y.map((_, i) => (senior ? v[i] : 0));
  const need = y.map((yi, i) => v[i] + yi); // cash needed to pay everyone in full
  const S = L.map((row, j) => row.map((x) => (y[j] > 0 ? x / y[j] : 0))); // share of j's interbank payment going to i
  const cash = (X) => e.map((ei, i) => { let s = ei; for (let j = 0; j < n; j++) if (j !== i) s += S[j][i] * X[j]; return s; });
  const pay = (i, h) => (y[i] > 0 ? slope[i] * Math.min(y[i] / slope[i], Math.max(0, h - cut[i])) : 0);

  const inD = new Array(n).fill(false);
  const wave = new Array(n).fill(0);
  let X = [...y];
  const rounds = [];
  let picard = 0;
  for (let round = 1; round <= n; round++) {
    const h = cash(X);
    const fresh = [];
    for (let i = 0; i < n; i++) if (!inD[i] && h[i] < need[i] - 1e-9 * Math.max(1, need[i])) fresh.push(i);
    if (!fresh.length) break;
    for (const i of fresh) { inD[i] = true; wave[i] = round; }
    const solved = settle(X);
    X = solved.X;
    picard += solved.steps;
    rounds.push({ X: [...X], failed: [...inD], fresh });
  }

  // The payments when the defaulters pay what their cash allows and everyone else pays in full.
  function settle(start) {
    let X = [...start];
    let steps = 0;
    const step = (Z) => { const h = cash(Z); return Z.map((_, i) => (inD[i] ? pay(i, h[i]) : y[i])); };
    for (let attempt = 0; attempt < 4 * n + 8; attempt++) {
      const h = cash(X);
      // full: pays everything; zero: pays the banks nothing; part: in between.
      const mode = h.map((hi, i) => (!inD[i] || hi >= need[i] ? "full" : hi <= cut[i] ? "zero" : "part"));
      const part = [];
      for (let i = 0; i < n; i++) if (mode[i] === "part" && y[i] > 0) part.push(i);
      // Within these states one round of payments is the affine map X_P -> A X_P + c on the banks paying part.
      const A = part.map((i) => part.map((j) => slope[i] * S[j][i]));
      const c = part.map((i) => {
        let known = e[i] - cut[i];
        for (let j = 0; j < n; j++) if (mode[j] === "full" && j !== i) known += S[j][i] * y[j];
        return slope[i] * known;
      });
      let guess = null;
      try {
        const base = mode.map((m, i) => (m === "full" ? y[i] : 0));
        if (part.length) {
          const sol = linalg.solve(A.map((row, r) => row.map((x, k) => (r === k ? 1 : 0) - x)), c);
          part.forEach((i, r) => { base[i] = sol[r]; });
        }
        guess = base;
      } catch { guess = null; }
      // Accept the guess only if it is a fixed point of the payments and lies at or below where we are.
      if (guess && guess.every((g, i) => Number.isFinite(g) && g <= X[i] + 1e-9 * Math.max(1, y[i]))) {
        const back = step(guess);
        if (back.every((g, i) => Math.abs(g - guess[i]) <= 1e-9 * Math.max(1, y[i]))) return { X: back, steps };
      }
      // Otherwise the answer lies in other states. Rounds of payment from here fall steadily and stay exact; while
      // the states do not change they follow the affine map, so its 2^k-fold powers, by repeated squaring, find the
      // last round before some bank's state changes in about fifty steps, however many rounds that is.
      if (part.length) {
        const pos = new Array(n).fill(-1);
        part.forEach((i, r) => { pos[i] = r; });
        const inside = (xp) => part.every((i) => {
          let hi = e[i];
          for (let j = 0; j < n; j++) if (j !== i) hi += S[j][i] * (mode[j] === "full" ? y[j] : pos[j] >= 0 ? xp[pos[j]] : 0);
          return hi > cut[i];
        });
        let xp = part.map((i) => X[i]);
        const apply = ({ A: Ak, c: ck }, x) => Ak.map((row, r) => row.reduce((s, a, q) => s + a * x[q], 0) + ck[r]);
        const ok = (next, x) => next.every((v, r) => v <= x[r] + 1e-12 * Math.max(1, y[part[r]])) && inside(next);
        // Square until 2^k rounds would leave the states, then add the powers below from the largest down.
        const powers = [{ A, c }];
        while (powers.length < 52 && ok(apply(powers[powers.length - 1], xp), xp)) {
          const { A: Ak, c: ck } = powers[powers.length - 1];
          powers.push({ A: square(Ak), c: apply({ A: Ak, c: ck }, ck) });
        }
        for (let k = powers.length - 1; k >= 0; k--) {
          const next = apply(powers[k], xp);
          if (ok(next, xp)) { xp = next; steps += 2 ** k; }
        }
        part.forEach((i, r) => { X[i] = xp[r]; });
      }
      X = step(X); // one more round crosses into the next states
      steps++;
    }
    // Not reached in any test; kept so that a pathological case returns its best bound rather than hanging.
    for (let s = 0; s < 100000; s++) { const nx = step(X); if (nx.every((v, i) => Math.abs(v - X[i]) < 1e-13)) return { X: nx, steps }; X = nx; steps++; }
    return { X, steps, approximate: true };
  }

  const h = cash(X);
  const outside = h.map((hi, i) => (senior ? Math.min(v[i], Math.max(0, hi)) : (v[i] / need[i]) * Math.min(need[i], Math.max(0, hi))));
  const equity = h.map((hi, i) => Math.max(0, hi - need[i]));
  const failed = [...inD];
  const state = X.map((x, i) => (!failed[i] ? "full" : x <= 1e-9 * Math.max(1, y[i]) ? "zero" : "part"));
  return { X, h, y, v, e, need, state, wave, rounds, outside, equity, failed, senior, picard };
}

/** A A, with plain loops: the kit's general matmul is several times slower, and squaring 30 x 30 matrices fifty
 * times inside one clearing kept the page busy for over 50 ms at the largest settings. */
function square(A) {
  const n = A.length;
  const C = A.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const Ai = A[i], Ci = C[i];
    for (let k = 0; k < n; k++) {
      const a = Ai[k];
      if (a === 0) continue;
      const Ak = A[k];
      for (let j = 0; j < n; j++) Ci[j] += a * Ak[j];
    }
  }
  return C;
}

/** The clearing map itself, for checking: one round of everyone paying what their cash allows. */
export function clearingMap(X, sys, { senior = true } = {}) {
  const { L, e, v } = sys;
  const n = L.length;
  const y = L.map((row) => row.reduce((s, x) => s + x, 0));
  return X.map((_, i) => {
    let h = e[i];
    for (let j = 0; j < n; j++) if (j !== i && L[j][i] && y[j] > 0) h += (L[j][i] / y[j]) * X[j];
    return senior ? Math.min(y[i], Math.max(0, h - v[i])) : (y[i] / (v[i] + y[i])) * Math.min(v[i] + y[i], Math.max(0, h));
  });
}

/** Failures in each shape for a row of shock sizes, with everything else held fixed. */
export function failuresByShock({ n, a, buffer, y, delta, k, seed, hit, senior }, shocks, shapes = SHAPES) {
  return shapes.map((shape) => {
    const L = network(shape, n, y, { delta, k, seed });
    return { shape, counts: shocks.map((shock) => clear(bankSystem({ L, a, buffer, hit, shock }), { senior }).failed.filter(Boolean).length) };
  });
}
