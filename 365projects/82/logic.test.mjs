import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { DEFAULTS, network, randomRegular, bankSystem, clear, clearingMap, failuresByShock } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const sums = (L) => ({ out: L.map((r) => r.reduce((s, x) => s + x, 0)), in: L[0].map((_, j) => L.reduce((s, r) => s + r[j], 0)) });
// Plain iteration of the clearing map from a starting point, to convergence: an independent way to the answer.
function iterate(sys, senior, start) {
  let X = [...start];
  for (let it = 0; it < 500000; it++) {
    const nx = clearingMap(X, sys, { senior });
    let d = 0;
    for (let i = 0; i < X.length; i++) d = Math.max(d, Math.abs(nx[i] - X[i]));
    X = nx;
    if (d < 1e-14) break;
  }
  return X;
}

test("every shape is regular: each bank owes y and is owed y, never to itself", () => {
  for (const shape of ["ring", "complete", "clusters", "random"]) {
    for (const n of [4, 10, 30]) {
      const L = network(shape, n, 100, { delta: 0.1, k: 3, seed: 4 });
      const s = sums(L);
      for (let i = 0; i < n; i++) { close(s.out[i], 100, 1e-9); close(s.in[i], 100, 1e-9); assert.equal(L[i][i], 0); }
    }
  }
  assert.equal(network("ring", 5, 7)[4][0], 7); // the last bank owes the first
  close(network("complete", 5, 8)[2][3], 2, 1e-15);
  const C = network("clusters", 6, 60, { delta: 0.1 });
  close(C[0][1], 27, 1e-12); // (1 - 0.1) 60 / 2 within the cluster
  close(C[0][4], 2, 1e-12); // 0.1 x 60 / 3 across
  assert.throws(() => network("clusters", 7, 10));
  // The random network: k creditors and k debtors each, the same for the same seed, different for another.
  const pairs = randomRegular(12, 4, 7);
  assert.equal(pairs.length, 48);
  assert.equal(new Set(pairs.map(([i, j]) => i * 12 + j)).size, 48);
  for (let i = 0; i < 12; i++) { assert.equal(pairs.filter((p) => p[0] === i).length, 4); assert.equal(pairs.filter((p) => p[1] === i).length, 4); }
  assert.deepEqual(randomRegular(12, 4, 7), pairs);
  assert.notDeepEqual(randomRegular(12, 4, 8), pairs);
  // k = n - 1 is the complete network's links.
  assert.equal(randomRegular(5, 4, 1).length, 20);
});

test("hand-worked chain: A owes B 10, B owes C 10, C owes 5 outside; A has 5, B 2, C 10", () => {
  const sys = { L: [[0, 10, 0], [0, 0, 10], [0, 0, 0]], e: [5, 2, 10], v: [0, 0, 5] };
  for (const senior of [true, false]) {
    const c = clear(sys, { senior });
    // A can pay only its 5; B then has 2 + 5 = 7 and pays that; C has 10 + 7 and pays its 5 in full.
    close(c.X[0], 5, 1e-12);
    close(c.X[1], 7, 1e-12);
    assert.deepEqual(c.failed, [true, true, false]);
    assert.deepEqual(c.wave, [1, 2, 0]); // A fails even if everyone pays; B only once A's shortfall arrives
    close(c.equity[2], 12, 1e-12); // 17 - 5
    close(c.outside[2], 5, 1e-12);
  }
});

test("hand-worked cycle: two banks owe each other 10 and 10 outside; they hold 4 and 6", () => {
  const sys = { L: [[0, 10], [10, 0]], e: [4, 6], v: [10, 10] };
  // Equal ranking (Eisenberg and Noe): each pays half its payment to the other bank and half outside.
  // p_A = 4 + p_B / 2 and p_B = 6 + p_A / 2, so p_A = 28/3 and p_B = 32/3; the interbank halves are 14/3 and 16/3.
  const en = clear(sys, { senior: false });
  close(en.X[0], 14 / 3, 1e-12);
  close(en.X[1], 16 / 3, 1e-12);
  close(en.outside[0], 14 / 3, 1e-12);
  close(en.outside[1], 16 / 3, 1e-12);
  assert.deepEqual(en.wave, [1, 1]);
  // Outside creditors first (Acemoglu et al.): A has 4 + X_B and must find 10 for outsiders before paying B, and B
  // likewise, so X_A = max(0, X_B - 6) and X_B = max(0, X_A - 4): only X_A = X_B = 0 solves both. The outsiders
  // receive 4 and 6. (A group that owes only itself: the case where the solver must step down to find who pays nothing.)
  const aot = clear(sys, { senior: true });
  assert.deepEqual(aot.X, [0, 0]);
  close(aot.outside[0], 4, 1e-12);
  close(aot.outside[1], 6, 1e-12);
  assert.deepEqual(aot.state, ["zero", "zero"]);
});

test("the solution clears: a fixed point of the payments, equal to plain iteration, on 300 random systems", () => {
  const g = rng(12);
  for (let t = 0; t < 150; t++) {
    const n = 2 * g.int(2, 12);
    const shape = g.pick(["ring", "complete", "clusters", "random"]);
    const L = network(shape, n, g.uniform(0, 250), { delta: g.uniform(0, 0.5), k: g.int(1, n - 1), seed: g.int(1, 999) });
    const sys = bankSystem({ L, a: 100, buffer: g.uniform(0.5, 50), hit: g.int(0, n - 1), shock: g.uniform(0, 100) });
    for (const senior of [true, false]) {
      const c = clear(sys, { senior });
      const again = clearingMap(c.X, sys, { senior });
      for (let i = 0; i < n; i++) close(again[i], c.X[i], 1e-9);
      const top = iterate(sys, senior, c.y);
      for (let i = 0; i < n; i++) close(c.X[i], top[i], 1e-8);
      // Limited liability and absolute priority: nobody pays more than it has, and a bank that falls short keeps nothing.
      for (let i = 0; i < n; i++) {
        assert.ok(c.X[i] + c.outside[i] <= c.h[i] + 1e-9);
        if (c.failed[i]) { assert.equal(c.equity[i], 0); close(c.X[i] + c.outside[i], Math.max(0, c.h[i]), 1e-8); }
      }
      assert.ok(c.rounds.length <= n);
    }
  }
});

test("Eisenberg and Noe: with outside assets everywhere the clearing vector is unique (least and greatest agree)", () => {
  const g = rng(3);
  for (let t = 0; t < 40; t++) {
    const n = 2 * g.int(2, 10);
    const L = network(g.pick(["ring", "complete", "clusters", "random"]), n, g.uniform(10, 200), { delta: 0.2, k: g.int(1, n - 1), seed: t + 1 });
    const sys = bankSystem({ L, a: 100, buffer: g.uniform(1, 30), hit: 0, shock: g.uniform(0, 99) });
    const fromTop = iterate(sys, false, L.map((r) => r.reduce((s, x) => s + x, 0)));
    const fromBottom = iterate(sys, false, new Array(n).fill(0));
    for (let i = 0; i < n; i++) close(fromTop[i], fromBottom[i], 1e-8);
  }
});

test("no default costs: shareholders and outside creditors together lose exactly the shock, whatever the shape", () => {
  for (const shape of ["ring", "complete", "clusters", "random"]) for (const senior of [true, false]) for (const shock of [0, 30, 70, 100]) {
    const sys = bankSystem({ L: network(shape, 10, 100, { delta: 0.05, k: 3, seed: 2 }), a: 100, buffer: 6, hit: 3, shock });
    const c = clear(sys, { senior });
    const kept = c.equity.reduce((s, x) => s + x, 0) + c.outside.reduce((s, x) => s + x, 0);
    close(kept, 10 * 100 - shock, 1e-8); // equity was 10 x 6 and outside claims 10 x 94 before the shock
  }
});

test("the ring at a shock of 40: six banks fail, one wave each, each absorbing its buffer of 6", () => {
  const c = clear(bankSystem({ L: network("ring", 10, 100), a: 100, buffer: 6, hit: 0, shock: 40 }), { senior: true });
  assert.deepEqual(c.wave, [1, 2, 3, 4, 5, 6, 0, 0, 0, 0]);
  // Bank 1 is short 40 - 6 = 34, bank 2 34 - 6 = 28, and so on down to 4; bank 7 absorbs the last 4 out of its 6.
  [66, 72, 78, 84, 90, 96].forEach((x, i) => close(c.X[i], x, 1e-9));
  close(c.equity[6], 2, 1e-9);
  assert.equal(c.rounds.length, 6);
});

test("Acemoglu, Ozdaglar and Tahbaz-Salehi: below the system's buffer the complete network loses only the shocked bank; above it, all", () => {
  const base = { n: 10, a: 100, buffer: 6, y: 100, delta: 0.05, k: 3, seed: 1, hit: 0, senior: true };
  const shocks = [10, 20, 30, 40, 50, 59, 61, 70, 80, 90, 100];
  const [ring, complete, clusters] = failuresByShock(base, shocks, ["ring", "complete", "clusters"]).map((r) => r.counts);
  // The threshold is n (a - v) = 10 x 6 = 60 for the complete network.
  assert.deepEqual(complete, [1, 1, 1, 1, 1, 1, 10, 10, 10, 10, 10]);
  // Small shocks: the ring is never better than the complete network, and the clusters lie between.
  for (let i = 0; i < 6; i++) { assert.ok(ring[i] >= complete[i]); assert.ok(clusters[i] >= complete[i]); }
  // Large shocks: ring and complete lose every bank; two weakly linked clusters lose only the shocked half.
  for (let i = 7; i < shocks.length; i++) { assert.equal(ring[i], 10); assert.equal(clusters[i], 5); }
  // With depositors ranking equally, depositors absorb part of every loss and the complete network never cascades.
  const en = failuresByShock({ ...base, senior: false }, [70, 100], ["complete"])[0].counts;
  assert.deepEqual(en, [1, 1]);
});

test("the finding: a shock of 40 fells 6 banks in a ring and 1 in the complete network; a shock of 70 fells all 10 in both and 5 in two clusters", () => {
  const base = { ...DEFAULTS, senior: true };
  const at = (shock) => Object.fromEntries(failuresByShock(base, [shock]).map((r) => [r.shape, r.counts[0]]));
  const small = at(40), large = at(70);
  assert.equal(small.ring, 6);
  assert.equal(small.complete, 1);
  assert.equal(large.ring, 10);
  assert.equal(large.complete, 10);
  assert.equal(large.clusters, 5);
  assert.equal(DEFAULTS.n * DEFAULTS.buffer, 60);
});

test("edge cases: no shock, no interbank debts, a shock of everything, a single wave", () => {
  const none = clear(bankSystem({ L: network("complete", 6, 50), a: 100, buffer: 6, hit: 0, shock: 0 }), { senior: true });
  assert.ok(none.failed.every((f) => !f));
  assert.equal(none.rounds.length, 0);
  // With no interbank debts the shock stays with the bank it hits.
  const alone = clear(bankSystem({ L: network("ring", 6, 0), a: 100, buffer: 6, hit: 2, shock: 100 }), { senior: true });
  assert.deepEqual(alone.failed, [false, false, true, false, false, false]);
  close(alone.outside[2], 0, 1e-12);
  // A shock smaller than the buffer topples nobody.
  const small = clear(bankSystem({ L: network("ring", 6, 100), a: 100, buffer: 6, hit: 0, shock: 5.9 }), { senior: true });
  assert.ok(small.failed.every((f) => !f));
  close(small.equity[0], 0.1, 1e-9);
});
