// Day 15: Sorites and Fuzzy Logic. The model, with no DOM code.
// Three marks from the visitor (certainly not a heap, where a heap starts, certainly a heap) and three
// readings of them: a sharp cut-off, a fuzzy membership function and a supervaluationist gap. Then the
// sorites argument itself, step by step, in Lukasiewicz logic.

import { rng } from "../kit/kit.js";

export const MAX = 10000;
export const DEFAULT_MARKS = { lo: 10, mid: 100, hi: 1000 };
export const SHAPES = [
  { value: "log", label: "Line (log)" },
  { value: "s", label: "S-curve" },
  { value: "grains", label: "Line (grains)" },
];

/** The log-scaled slider: position 0 to 400 maps to 1 to 10,000 grains, and back. */
export const grainsAt = (position) => Math.min(MAX, Math.max(1, Math.round(10 ** (position / 100))));
export const positionOf = (n) => Math.round(100 * Math.log10(Math.min(MAX, Math.max(1, n))));

/** Marks are valid when 1 <= lo < mid <= hi <= MAX and all three are whole numbers. */
export function validMarks(m) {
  return Boolean(m) && [m.lo, m.mid, m.hi].every(Number.isInteger) && m.lo >= 1 && m.lo < m.mid && m.mid <= m.hi && m.hi <= MAX;
}

/**
 * Move one mark to n grains and push the others just far enough to keep lo < mid <= hi.
 * Returns { marks, moved } where moved lists the other marks that had to change.
 */
export function setMark(marks, which, n) {
  const v = Math.round(Number(n));
  if (!validMarks(marks) || !["lo", "mid", "hi"].includes(which) || !Number.isFinite(v)) return { marks, moved: [] };
  const next = { ...marks };
  if (which === "lo") {
    next.lo = Math.min(MAX - 1, Math.max(1, v));
    next.mid = Math.max(next.mid, next.lo + 1);
    next.hi = Math.max(next.hi, next.mid);
  } else if (which === "mid") {
    next.mid = Math.min(MAX, Math.max(2, v));
    next.lo = Math.min(next.lo, next.mid - 1);
    next.hi = Math.max(next.hi, next.mid);
  } else {
    next.hi = Math.min(MAX, Math.max(2, v));
    next.mid = Math.min(next.mid, next.hi);
    next.lo = Math.min(next.lo, next.mid - 1);
  }
  return { marks: next, moved: ["lo", "mid", "hi"].filter((k) => k !== which && next[k] !== marks[k]) };
}

/** Sharp cut-off: n grains make a heap exactly when n >= mid. */
export const crisp = (n, marks) => n >= marks.mid;

/**
 * Fuzzy membership: the degree to which n grains make a heap. 0 up to lo, 1/2 at mid, 1 from hi, and between
 * the marks a line that is straight in log n ("log"), straight in n ("grains") or eased into an S ("s").
 */
export function membership(n, marks, shape = "log") {
  const { lo, mid, hi } = marks;
  if (n <= lo) return 0;
  if (n >= hi) return 1;
  const p = shape === "grains" ? (x) => x : Math.log;
  if (n < mid) {
    const t = (p(n) - p(lo)) / (p(mid) - p(lo));
    return 0.5 * (shape === "s" ? t * t : t);
  }
  const t = (p(n) - p(mid)) / (p(hi) - p(mid));
  return shape === "s" ? 1 - 0.5 * (1 - t) ** 2 : 0.5 + 0.5 * t;
}

/**
 * Supervaluation. The admissible sharpenings are the cut-offs lo + 1, ..., hi. "n grains make a heap" is
 * "true" if it holds on all of them, "false" if on none, otherwise "gap". share is the fraction on which it holds.
 */
export function supervaluation(n, marks) {
  const { lo, hi } = marks;
  const share = Math.min(1, Math.max(0, (n - lo) / (hi - lo)));
  return { status: n >= hi ? "true" : n <= lo ? "false" : "gap", share, sharpenings: hi - lo };
}

/** Lukasiewicz implication and the strong conjunction that goes with it (which bounds modus ponens from below). */
export const implies = (a, b) => Math.min(1, 1 - a + b);
export const strongAnd = (a, b) => Math.max(0, a + b - 1);

/**
 * The sorites argument from hi grains (certainly a heap) down to lo (certainly not), one grain at a time.
 * Each step is the conditional "if n grains make a heap, so do n - 1", for n = hi, hi - 1, ..., lo + 1.
 *   truth  its degree of truth in Lukasiewicz logic
 *   loss   1 - truth
 *   left   the degree of truth that modus ponens still guarantees for "n - 1 grains make a heap"
 * weakest is the least true step. When several steps are equally untrue (every step on a straight piece of the
 * "grains" shape loses the same amount) it is the first of them, tied says how many there are, and tiedFrom and tiedTo
 * give the largest and smallest n among them.
 */
export function sorites(marks, shape = "log") {
  const { lo, mid, hi } = marks;
  const steps = [];
  let left = 1, lost = 0, weakest = null, perfect = 0;
  let above = membership(hi, marks, shape);
  for (let n = hi; n > lo; n--) {
    const below = membership(n - 1, marks, shape);
    const truth = implies(above, below);
    const loss = 1 - truth;
    left = strongAnd(left, truth);
    lost += loss;
    if (loss === 0) perfect++;
    const step = { n, truth, loss, left };
    if (!weakest || truth < weakest.truth) weakest = step;
    steps.push(step);
    above = below;
  }
  const strongest = steps.reduce((best, s) => (s.truth > best.truth ? s : best), steps[0]);
  // Steps within rounding error of the least true one count as equally untrue.
  const level = steps.filter((s) => s.truth - weakest.truth < 1e-9);
  return { steps, count: hi - lo, lost, left, weakest: level[0], tied: level.length, tiedFrom: level[0].n, tiedTo: level[level.length - 1].n, strongest, perfect, falseStep: mid };
}

/**
 * A pile of `count` grains for drawing. Each grain is dropped near the middle and rolls downhill to the first
 * column neither of whose neighbours is lower, so neighbouring columns never differ by more than one grain.
 * Returns [{ col, row }] in the order dropped: the first n entries are the pile of n grains.
 */
export function pile(count = MAX, seed = 15) {
  const n = Math.min(MAX, Math.max(0, Math.floor(Number(count) || 0)));
  const r = rng(seed);
  const half = 220;
  const height = new Int16Array(2 * half + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    let c = half + Math.round(r.normal(0, 1.5));
    for (;;) {
      const goLeft = height[c - 1] < height[c], goRight = height[c + 1] < height[c];
      if (!goLeft && !goRight) break;
      if (goLeft && goRight) c += height[c - 1] < height[c + 1] ? -1 : height[c + 1] < height[c - 1] ? 1 : r.bool() ? -1 : 1;
      else c += goLeft ? -1 : 1;
    }
    out.push({ col: c - half, row: height[c] });
    height[c]++;
  }
  return out;
}
