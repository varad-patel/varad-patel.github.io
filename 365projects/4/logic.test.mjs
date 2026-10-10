import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { PRESETS, bayes, crowd, sequence, curve, priorFor, judgeGuess, randomScenario, probGrid } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("Bayes' theorem matches a hand-computed case", () => {
  // 1% base rate, 80% sensitivity, 9.6% false positives.
  // P(+) = 0.01*0.8 + 0.99*0.096 = 0.008 + 0.09504 = 0.10304. P(D|+) = 0.008 / 0.10304.
  const b = bayes(0.01, 0.8, 0.096);
  close(b.pPos, 0.10304);
  close(b.pNeg, 0.89696);
  close(b.afterPositive, 0.008 / 0.10304);
  close(b.afterPositive, 0.0776397515527950, 1e-12);
  // P(D|-) = 0.002 / (0.002 + 0.99*0.904) = 0.002 / 0.89696.
  close(b.afterNegative, 0.002 / 0.89696);
  close(b.lrPositive, 0.8 / 0.096);
  close(b.lrNegative, 0.2 / 0.904);
  close(b.joint.tp + b.joint.fn + b.joint.fp + b.joint.tn, 1);
});

test("the odds form gives the same answer: posterior odds = prior odds x likelihood ratio", () => {
  for (const [p, s, f] of [[0.01, 0.8, 0.096], [0.3, 0.9, 0.1], [0.001, 0.99, 0.01], [0.6, 0.55, 0.4]]) {
    const b = bayes(p, s, f);
    const odds = (x) => x / (1 - x);
    close(odds(b.afterPositive), odds(p) * b.lrPositive, 1e-9);
    close(odds(b.afterNegative), odds(p) * b.lrNegative, 1e-9);
  }
});

test("the Harvard Medical School question comes to about 2%, not 95%", () => {
  const b = bayes(0.001, 1, 0.05);
  close(b.afterPositive, 0.001 / (0.001 + 0.999 * 0.05));
  close(b.afterPositive, 0.0196, 0.0001);
  assert.equal(b.afterNegative, 0);
});

test("the crowd is whole people, adds up, and matches the textbook picture", () => {
  const c = crowd(0.01, 0.8, 0.096, 1000);
  assert.deepEqual([c.tp, c.fn, c.fp, c.tn], [8, 2, 95, 895]);
  assert.equal(c.positive, 103);
  assert.equal(c.sick, 10);
  close(c.afterPositive, 8 / 103);
  for (const n of [1, 7, 100, 1000, 10000]) {
    for (const p of PRESETS) {
      const k = crowd(p.prior, p.sens, p.fpr, n);
      assert.equal(k.tp + k.fn + k.fp + k.tn, n);
      for (const v of [k.tp, k.fn, k.fp, k.tn]) assert.ok(Number.isInteger(v) && v >= 0);
    }
  }
  // Rounding never moves a count by a whole person or more.
  const big = crowd(0.0123, 0.777, 0.0456, 10000);
  const b = bayes(0.0123, 0.777, 0.0456);
  for (const k of ["tp", "fn", "fp", "tn"]) assert.ok(Math.abs(big[k] - b.joint[k] * 10000) < 1);
  assert.ok(crowd(0.01, 0.8, 0.096, 0).error);
  assert.ok(crowd(0.01, 0.8, 0.096, 2.5).error);
});

test("a simulated crowd agrees with the formula", () => {
  const r = rng(4);
  const [prior, sens, fpr] = [0.05, 0.9, 0.08];
  let pos = 0, sickPos = 0, neg = 0, sickNeg = 0;
  for (let i = 0; i < 400000; i++) {
    const sick = r.bool(prior);
    const positive = r.bool(sick ? sens : fpr);
    if (positive) { pos++; if (sick) sickPos++; } else { neg++; if (sick) sickNeg++; }
  }
  const b = bayes(prior, sens, fpr);
  close(sickPos / pos, b.afterPositive, 0.01);
  close(sickNeg / neg, b.afterNegative, 0.002);
  close(pos / 400000, b.pPos, 0.003);
});

test("repeated tests: each result updates the last answer, and order does not matter", () => {
  const [p, s, f] = [0.01, 0.8, 0.096];
  close(sequence(p, s, f, ""), p);
  close(sequence(p, s, f, "+"), bayes(p, s, f).afterPositive);
  const twice = bayes(bayes(p, s, f).afterPositive, s, f).afterPositive;
  close(sequence(p, s, f, "++"), twice);
  // Two positives by hand: odds 1/99 x (0.8/0.096)^2.
  const odds = (1 / 99) * (0.8 / 0.096) ** 2;
  close(sequence(p, s, f, "++"), odds / (1 + odds), 1e-12);
  close(sequence(p, s, f, "+-"), sequence(p, s, f, "-+"), 1e-12);
  assert.ok(sequence(p, s, f, "+-") < sequence(p, s, f, "+"));
  assert.equal(sequence(p, s, f, "+x"), null);
  assert.equal(sequence(0.5, 0, 0, "+"), null);
});

test("edge cases: certain and impossible priors, useless and impossible results, bad input", () => {
  assert.equal(bayes(0, 0.9, 0.1).afterPositive, 0);
  assert.equal(bayes(1, 0.9, 0.1).afterPositive, 1);
  // A test that is positive equally often either way tells you nothing.
  close(bayes(0.2, 0.3, 0.3).afterPositive, 0.2);
  close(bayes(0.2, 0.3, 0.3).afterNegative, 0.2);
  // A positive result that can never happen has no posterior.
  const never = bayes(0.5, 0, 0);
  assert.equal(never.afterPositive, null);
  assert.equal(never.lrPositive, null);
  assert.equal(bayes(0.5, 1, 1).afterNegative, null);
  assert.equal(bayes(0.5, 0.9, 0).lrPositive, Infinity);
  assert.equal(bayes(0.5, 0.9, 0).afterPositive, 1);
  for (const bad of [[-0.1, 0.5, 0.5], [0.5, 1.2, 0.5], [0.5, 0.5, NaN], ["0.5", 0.5, 0.5], [undefined, 0.5, 0.5]]) {
    assert.ok(bayes(...bad).error, `accepted ${JSON.stringify(bad)}`);
    assert.ok(crowd(...bad, 1000).error);
  }
});

test("the curve rises with the base rate and always sits on the right side of it", () => {
  const c = curve(0.8, 0.096);
  assert.equal(c.length, 121);
  close(c[0].prior, 0.0001, 1e-12);
  assert.equal(c.at(-1).prior, 1);
  for (let i = 1; i < c.length; i++) {
    assert.ok(c[i].prior > c[i - 1].prior);
    assert.ok(c[i].afterPositive > c[i - 1].afterPositive);
  }
  for (const pt of c.slice(0, -1)) {
    assert.ok(pt.afterPositive > pt.prior && pt.afterNegative < pt.prior);
  }
});

test("priorFor inverts the theorem", () => {
  for (const [t, s, f] of [[0.5, 0.8, 0.096], [0.9, 0.99, 0.01], [0.1, 0.7, 0.2]]) {
    close(bayes(priorFor(t, s, f), s, f).afterPositive, t, 1e-12);
  }
  // At a 50% target the answer is fpr / (sens + fpr).
  close(priorFor(0.5, 0.8, 0.096), 0.096 / 0.896, 1e-12);
  assert.equal(priorFor(0.5, 0, 0.1), null);
  assert.equal(priorFor(2, 0.8, 0.1), null);
  assert.equal(priorFor(0.5, 0.9, 0), 0);
});

test("guesses are compared with the answer and the classic mistakes are named", () => {
  const args = [0.01, 0.8, 0.096];
  assert.equal(judgeGuess(0.08, ...args).verdict, "close");
  assert.equal(judgeGuess(0.12, ...args).verdict, "close");
  assert.equal(judgeGuess(0.8, ...args).verdict, "sensitivity");
  assert.equal(judgeGuess(0.75, ...args).verdict, "sensitivity");
  assert.equal(judgeGuess(0.9, ...args).verdict, "specificity");
  assert.equal(judgeGuess(0.5, ...args).verdict, "over");
  assert.equal(judgeGuess(0.2, 0.3, 0.9, 0.1).verdict, "under");
  close(judgeGuess(0.8, ...args).gap, 0.8 - 0.008 / 0.10304);
  assert.equal(judgeGuess(1.5, ...args), null);
  assert.equal(judgeGuess(NaN, ...args), null);
  assert.equal(judgeGuess(0.5, 0.5, 0, 0), null);
});

test("random scenarios are reproducible and valid", () => {
  const a = randomScenario(rng(5));
  assert.deepEqual(a, randomScenario(rng(5)));
  const r = rng(11);
  const grid = probGrid(0.0001, 1);
  for (let i = 0; i < 200; i++) {
    const s = randomScenario(r);
    assert.ok(!bayes(s.prior, s.sens, s.fpr).error);
    assert.ok(s.sens > s.fpr);
    for (const v of [s.prior, s.sens, s.fpr]) assert.ok(grid.includes(v), `${v} is not a slider position`);
  }
});

test("slider positions are tidy, ordered, and include every preset value", () => {
  const g = probGrid(0.0001, 0.99);
  assert.equal(g[0], 0.0001);
  assert.equal(g.at(-1), 0.99);
  for (let i = 1; i < g.length; i++) assert.ok(g[i] > g[i - 1]);
  for (const v of [0.0001, 0.001, 0.01, 0.096, 0.1, 0.3, 0.5, 0.8, 0.904, 0.95, 0.99]) assert.ok(g.includes(v), `${v} missing`);
  for (const p of g) {
    const q = Math.min(p, 1 - p);
    close(q, Number(q.toPrecision(2)), 1e-12);
  }
  const s = probGrid(0.01, 1);
  assert.equal(s.at(-1), 1);
  assert.ok(s.includes(0.9999));
  for (const p of PRESETS) {
    assert.ok(probGrid(0.0001, 0.99).includes(p.prior), `${p.key} prior`);
    assert.ok(s.includes(p.sens), `${p.key} sensitivity`);
    assert.ok(probGrid(0.0001, 0.99).includes(p.fpr), `${p.key} false-positive rate`);
  }
});

test("the finding on the page", () => {
  const b = bayes(0.01, 0.8, 0.096);
  assert.equal((b.afterPositive * 100).toFixed(1), "7.8");
  const c = crowd(0.01, 0.8, 0.096, 1000);
  assert.equal(c.positive, 103);
  assert.equal(c.tp, 8);
  assert.equal(c.fp, 95);
  assert.equal((priorFor(0.5, 0.8, 0.096) * 100).toFixed(1), "10.7");
  // Two independent positives: odds (1/99) x 8.333^2 = 0.7015, so 0.7015 / 1.7015 = 41.2%.
  assert.equal((sequence(0.01, 0.8, 0.096, "++") * 100).toFixed(1), "41.2");
});
