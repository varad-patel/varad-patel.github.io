import test from "node:test";
import assert from "node:assert/strict";
import { MAX, DEFAULT_MARKS, SHAPES, grainsAt, positionOf, validMarks, setMark, crisp, membership, supervaluation, implies, strongAnd, sorites, pile } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const M = DEFAULT_MARKS; // 10, 100, 1000

test("the log slider covers 1 to 10,000 grains and round-trips at the powers of ten", () => {
  assert.equal(grainsAt(0), 1);
  assert.equal(grainsAt(100), 10);
  assert.equal(grainsAt(250), 316);
  assert.equal(grainsAt(400), MAX);
  assert.equal(grainsAt(-50), 1);
  assert.equal(grainsAt(999), MAX);
  for (const n of [1, 10, 100, 1000, 10000]) assert.equal(grainsAt(positionOf(n)), n);
  assert.equal(positionOf(0), 0);
  assert.equal(positionOf(1e9), 400);
});

test("marks must be whole numbers with 1 <= lo < mid <= hi <= 10,000", () => {
  assert.ok(validMarks(M));
  assert.ok(validMarks({ lo: 1, mid: 2, hi: 2 }));
  for (const bad of [null, {}, { lo: 0, mid: 5, hi: 9 }, { lo: 5, mid: 5, hi: 9 }, { lo: 5, mid: 10, hi: 9 }, { lo: 1, mid: 2, hi: 10001 }, { lo: 1.5, mid: 2, hi: 3 }, { lo: 1, mid: NaN, hi: 3 }]) {
    assert.equal(validMarks(bad), false, JSON.stringify(bad));
  }
});

test("setMark moves one mark and pushes the others only as far as the order needs", () => {
  assert.deepEqual(setMark(M, "mid", 50), { marks: { lo: 10, mid: 50, hi: 1000 }, moved: [] });
  assert.deepEqual(setMark(M, "lo", 5000), { marks: { lo: 5000, mid: 5001, hi: 5001 }, moved: ["mid", "hi"] });
  assert.deepEqual(setMark(M, "hi", 40), { marks: { lo: 10, mid: 40, hi: 40 }, moved: ["mid"] });
  assert.deepEqual(setMark(M, "hi", 5), { marks: { lo: 4, mid: 5, hi: 5 }, moved: ["lo", "mid"] });
  assert.deepEqual(setMark(M, "mid", 3), { marks: { lo: 2, mid: 3, hi: 1000 }, moved: ["lo"] });
  // The ends of the scale: one grain is never where a heap starts, and the lower bound leaves room above it.
  assert.deepEqual(setMark(M, "mid", 1).marks, { lo: 1, mid: 2, hi: 1000 });
  assert.deepEqual(setMark(M, "hi", 1).marks, { lo: 1, mid: 2, hi: 2 });
  assert.deepEqual(setMark(M, "lo", MAX).marks, { lo: 9999, mid: 10000, hi: 10000 });
  assert.deepEqual(setMark(M, "mid", 1e9).marks, { lo: 10, mid: 10000, hi: 10000 });
  // Whatever is asked for, the result is valid.
  for (const which of ["lo", "mid", "hi"]) for (const n of [-5, 0, 1, 2, 17, 9999, 10000, 123456, 12.6]) assert.ok(validMarks(setMark(M, which, n).marks), `${which} ${n}`);
  // Nonsense leaves the marks alone.
  assert.equal(setMark(M, "mid", NaN).marks, M);
  assert.equal(setMark(M, "other", 5).marks, M);
  assert.equal(setMark({ lo: 9, mid: 3, hi: 1 }, "mid", 5).moved.length, 0);
});

test("crisp: a heap from the boundary upwards", () => {
  assert.equal(crisp(99, M), false);
  assert.equal(crisp(100, M), true);
  assert.equal(crisp(10000, M), true);
});

test("membership: hand-computed values for each shape", () => {
  for (const s of SHAPES) {
    assert.equal(membership(1, M, s.value), 0);
    assert.equal(membership(10, M, s.value), 0);
    close(membership(100, M, s.value), 0.5);
    assert.equal(membership(1000, M, s.value), 1);
    assert.equal(membership(10000, M, s.value), 1);
    // Never falls as grains are added.
    let last = 0;
    for (let n = 1; n <= 1200; n++) { const m = membership(n, M, s.value); assert.ok(m >= last - 1e-12 && m >= 0 && m <= 1, `${s.value} at ${n}`); last = m; }
  }
  // Log scale: 10^1.5 is halfway from 10 to 100, so a quarter; 10^2.5 is three quarters.
  close(membership(10 ** 1.5, M, "log"), 0.25);
  close(membership(10 ** 2.5, M, "log"), 0.75);
  close(membership(60, M, "log"), 0.5 * Math.log10(6));
  // Grains: 55 is halfway from 10 to 100, 550 halfway from 100 to 1,000.
  close(membership(55, M, "grains"), 0.25);
  close(membership(550, M, "grains"), 0.75);
  // S-curve: halfway along each piece on the log scale gives 1/8 and 7/8.
  close(membership(10 ** 1.5, M, "s"), 0.125);
  close(membership(10 ** 2.5, M, "s"), 0.875);
  // A boundary that coincides with the upper bound: half is approached from below and 1 is reached at the mark.
  const tight = { lo: 10, mid: 20, hi: 20 };
  assert.equal(membership(20, tight), 1);
  assert.ok(membership(19, tight) < 0.5);
});

test("supervaluation: true on all sharpenings, on none, or on some", () => {
  assert.deepEqual(supervaluation(1000, M), { status: "true", share: 1, sharpenings: 990 });
  assert.deepEqual(supervaluation(10, M), { status: "false", share: 0, sharpenings: 990 });
  assert.equal(supervaluation(5, M).share, 0);
  const s = supervaluation(60, M);
  assert.equal(s.status, "gap");
  close(s.share, 50 / 990);
  // Count the sharpenings directly: cut-offs 11..1000, of which 11..60 make 60 grains a heap.
  let holds = 0;
  for (let c = M.lo + 1; c <= M.hi; c++) if (60 >= c) holds++;
  assert.equal(holds, 50);
  assert.equal(supervaluation(999, M).status, "gap");
  assert.equal(supervaluation(11, M).status, "gap");
});

test("Lukasiewicz connectives", () => {
  assert.equal(implies(1, 1), 1);
  assert.equal(implies(1, 0), 0);
  assert.equal(implies(0, 1), 1);
  assert.equal(implies(0.3, 0.9), 1);
  close(implies(0.9, 0.3), 0.4);
  close(strongAnd(0.9, 0.4), 0.3);
  assert.equal(strongAnd(0.4, 0.5), 0);
  // Modus ponens loses nothing beyond what the bound says: with v(A) = a and v(A -> B) from a and b, the bound returns b.
  for (const [a, b] of [[1, 0.8], [0.7, 0.2], [0.5, 0.5]]) close(strongAnd(a, implies(a, b)), Math.min(a, b));
});

test("the finding: 990 steps, the weakest 97.9% true, the strongest 99.98%, and the losses add up to exactly 1", () => {
  const s = sorites(M, "log");
  assert.equal(s.count, 990);
  assert.equal(s.steps.length, 990);
  assert.equal(s.weakest.n, 11);
  close(s.weakest.truth, 1 - 0.5 * Math.log10(11 / 10));
  assert.equal(s.weakest.truth.toFixed(3), "0.979");
  assert.equal(s.strongest.n, 1000);
  assert.equal(s.strongest.truth.toFixed(4), "0.9998");
  close(s.lost, 1, 1e-12);
  close(s.left, 0, 1e-12);
  assert.equal(s.perfect, 0);
  // Classically the same chain has exactly one false step, at the boundary.
  assert.equal(s.falseStep, 100);
  const falseSteps = s.steps.filter((st) => crisp(st.n, M) && !crisp(st.n - 1, M));
  assert.deepEqual(falseSteps.map((st) => st.n), [100]);
});

test("the total lost is 1 whatever the shape and wherever the marks are", () => {
  for (const marks of [M, { lo: 1, mid: 2, hi: 2 }, { lo: 3, mid: 40, hi: 9000 }, { lo: 1, mid: 5000, hi: 10000 }, { lo: 99, mid: 100, hi: 101 }]) {
    for (const sh of SHAPES) {
      const s = sorites(marks, sh.value);
      close(s.lost, 1, 1e-9);
      close(s.left, 0, 1e-9);
      assert.equal(s.count, marks.hi - marks.lo);
      // What modus ponens guarantees after each step is exactly the membership of the pile reached.
      for (const st of s.steps) close(st.left, membership(st.n - 1, marks, sh.value), 1e-9);
      for (const st of s.steps) assert.ok(st.truth >= 0 && st.truth <= 1);
    }
  }
});

test("straight in grains: every step on a piece loses the same amount", () => {
  const s = sorites(M, "grains");
  close(s.steps.find((st) => st.n === 500).loss, 0.5 / 900);
  close(s.steps.find((st) => st.n === 50).loss, 0.5 / 90);
  close(s.weakest.truth, 1 - 0.5 / 90);
});

test("when the three marks collapse, fuzzy logic agrees with the sharp line: one step loses everything", () => {
  const s = sorites({ lo: 10, mid: 11, hi: 11 });
  assert.equal(s.count, 1);
  assert.equal(s.weakest.truth, 0);
  assert.equal(s.lost, 1);
});

test("the pile: seeded, one grain per cell, every grain supported, slopes of at most one", () => {
  const a = pile(2000, 15), b = pile(2000, 15);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, pile(2000, 16));
  assert.equal(a.length, 2000);
  assert.deepEqual(pile(500, 15), a.slice(0, 500)); // adding grains never moves the earlier ones
  const cells = new Set(a.map((g) => `${g.col},${g.row}`));
  assert.equal(cells.size, 2000);
  for (const g of a) assert.ok(g.row === 0 || cells.has(`${g.col},${g.row - 1}`));
  const height = new Map();
  for (const g of a) height.set(g.col, Math.max(height.get(g.col) || 0, g.row + 1));
  for (const [col, h] of height) assert.ok(Math.abs(h - (height.get(col + 1) || 0)) <= 1 || !height.has(col + 1) && h <= 1, `column ${col}`);
  assert.equal(pile(0).length, 0);
  assert.equal(pile(-3).length, 0);
  assert.equal(pile(NaN).length, 0);
  assert.equal(pile(1).length, 1);
  assert.equal(pile(1e9).length, MAX);
});

test("equally untrue steps are reported as a tie, not as one arbitrary step", () => {
  // Straight in grains, marks 3 / 40 / 9,000: each of the 37 steps from 40 down to 4 loses 0.5/37.
  const g = sorites({ lo: 3, mid: 40, hi: 9000 }, "grains");
  close(g.weakest.truth, 1 - 0.5 / 37);
  assert.deepEqual([g.tied, g.tiedFrom, g.tiedTo, g.weakest.n], [37, 40, 4, 40]);
  // Marks 99 / 100 / 101: two steps, each true to degree one half, whatever the shape.
  for (const sh of SHAPES) {
    const two = sorites({ lo: 99, mid: 100, hi: 101 }, sh.value);
    assert.deepEqual([two.count, two.tied, two.tiedFrom, two.tiedTo], [2, 2, 101, 100]);
    close(two.weakest.truth, 0.5);
  }
  // The default marks on the log scale have a single least true step.
  const d = sorites(M, "log");
  assert.deepEqual([d.tied, d.tiedFrom, d.tiedTo], [1, 11, 11]);
});

test("hand-computed chains for two other sets of marks", () => {
  // 3 / 40 / 9,000 on the log scale: the largest drop is from 4 grains to 3, one half of ln(4/3) / ln(40/3).
  const a = sorites({ lo: 3, mid: 40, hi: 9000 }, "log");
  assert.equal(a.count, 8997);
  assert.equal(a.weakest.n, 4);
  close(a.weakest.truth, 1 - 0.5 * Math.log(4 / 3) / Math.log(40 / 3));
  assert.equal(a.weakest.truth.toFixed(3), "0.944");
  close(a.lost, 1, 1e-9);
  // The same marks on the S-curve: the least true step is from 9 grains to 8.
  const s = sorites({ lo: 3, mid: 40, hi: 9000 }, "s");
  const t = (n) => Math.log(n / 3) / Math.log(40 / 3);
  assert.equal(s.weakest.n, 9);
  close(s.weakest.truth, 1 - 0.5 * (t(9) ** 2 - t(8) ** 2));
  assert.equal(s.weakest.truth.toFixed(3), "0.982");
});

test("a boundary on the upper mark: the curve stays under one half below it and jumps to 1 at it", () => {
  const marks = { lo: 1, mid: 5001, hi: 5001 };
  for (const sh of SHAPES) {
    assert.equal(membership(5001, marks, sh.value), 1);
    assert.ok(membership(5000, marks, sh.value) < 0.5);
    const s = sorites(marks, sh.value);
    assert.equal(s.count, 5000);
    assert.equal(s.weakest.n, 5001);
    close(s.weakest.truth, membership(5000, marks, sh.value));
    close(s.lost, 1, 1e-9);
  }
  assert.equal(supervaluation(5001, marks).status, "true");
  assert.equal(supervaluation(5000, marks).status, "gap");
});
