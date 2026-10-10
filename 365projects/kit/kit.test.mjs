import test from "node:test";
import assert from "node:assert/strict";
import { fmt, rng, stats, linalg, csv, niceTicks } from "./kit.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("fmt formats numbers, shares and missing values", () => {
  assert.equal(fmt.num(1234.5), "1,234.50");
  assert.equal(fmt.int(1234.5), "1,235");
  assert.equal(fmt.pct(0.1234), "12.3%");
  assert.equal(fmt.sig(0.0012349, 3), "0.00123");
  assert.equal(fmt.num(-0.0001), "0.00");
  assert.equal(fmt.signed(1.5, 1), "+1.5");
  assert.equal(fmt.num(NaN), "–");
  assert.equal(fmt.date("2026-10-10"), "10 Oct 2026");
});

test("rng is reproducible and roughly uniform and normal", () => {
  const a = rng(7), b = rng(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const r = rng(1);
  const u = Array.from({ length: 20000 }, () => r());
  assert.ok(u.every((v) => v >= 0 && v < 1));
  close(stats.mean(u), 0.5, 0.01);
  const z = Array.from({ length: 20000 }, () => r.normal(3, 2));
  close(stats.mean(z), 3, 0.05);
  close(stats.sd(z), 2, 0.05);
  const dice = Array.from({ length: 6000 }, () => r.int(1, 6));
  assert.equal(stats.min(dice), 1);
  assert.equal(stats.max(dice), 6);
  assert.deepEqual([...r.shuffle([1, 2, 3, 4, 5])].sort(), [1, 2, 3, 4, 5]);
});

test("descriptive statistics match hand calculations", () => {
  const a = [2, 4, 4, 4, 5, 5, 7, 9];
  assert.equal(stats.mean(a), 5);
  close(stats.sd(a, false), 2);
  close(stats.variance(a), 32 / 7);
  assert.equal(stats.median(a), 4.5);
  assert.equal(stats.quantile([1, 2, 3, 4, 5], 0.25), 2);
  close(stats.corr([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  close(stats.corr([1, 2, 3, 4], [8, 6, 4, 2]), -1);
});

test("linreg and ols recover known coefficients", () => {
  const x = [0, 1, 2, 3, 4];
  const lr = stats.linreg(x, x.map((v) => 3 + 2 * v));
  close(lr.slope, 2); close(lr.intercept, 3); close(lr.r2, 1);
  const r = rng(3);
  const X = Array.from({ length: 400 }, () => [r.normal(), r.normal()]);
  const y = X.map(([a, b]) => 1 + 2 * a - 3 * b + r.normal(0, 0.5));
  const fit = stats.ols(X, y);
  close(fit.beta[0], 1, 0.1); close(fit.beta[1], 2, 0.1); close(fit.beta[2], -3, 0.1);
  assert.ok(fit.r2 > 0.95 && fit.r2 < 1);
  assert.ok(fit.se.every((s) => s > 0 && s < 0.1));
  // One predictor: ols must agree with linreg.
  const one = stats.ols(x.map((v) => [v]), [1, 3, 2, 5, 4]);
  const ref = stats.linreg(x, [1, 3, 2, 5, 4]);
  close(one.beta[1], ref.slope); close(one.beta[0], ref.intercept); close(one.r2, ref.r2); close(one.se[1], ref.seSlope);
  assert.throws(() => stats.ols([[1], [2]], [1, 2]));
});

test("linalg inverts and solves", () => {
  const inv = linalg.inverse([[4, 7], [2, 6]]);
  close(inv[0][0], 0.6); close(inv[0][1], -0.7); close(inv[1][0], -0.2); close(inv[1][1], 0.4);
  const x = linalg.solve([[2, 1], [1, 3]], [3, 5]);
  close(x[0], 0.8); close(x[1], 1.4);
  assert.throws(() => linalg.inverse([[1, 2], [2, 4]]));
});

test("distributions", () => {
  close(stats.logGamma(5), Math.log(24), 1e-10);
  close(stats.binomPmf(2, 4, 0.5), 0.375, 1e-12);
  close(stats.binomPmf(0, 3, 0), 1);
  close(stats.betaPdf(0.5, 2, 2), 1.5, 1e-10);
  close(stats.normalCdf(0), 0.5, 1e-7);
  close(stats.normalCdf(1.96), 0.975, 1e-4);
  close(stats.normalPdf(0), 0.3989422804, 1e-9);
  close(stats.entropy([0.5, 0.5]), 1);
  close(stats.entropy([1, 0]), 0);
});

test("histogram counts every value once", () => {
  const h = stats.histogram([0, 0.1, 0.5, 0.9, 1], { bins: 2 });
  assert.deepEqual(h.map((b) => b.count), [2, 3]);
  assert.equal(h[0].x0, 0);
  assert.equal(h[1].x1, 1);
});

test("csv parses quotes, delimiters and line endings", () => {
  assert.deepEqual(csv.parse('a,b\r\n1,"x, y"\r\n2,"he said ""hi"""\n'), [["a", "b"], ["1", "x, y"], ["2", 'he said "hi"']]);
  assert.deepEqual(csv.parse("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(csv.parse("﻿a\tb\n1\t2\n\n"), [["a", "b"], ["1", "2"]]);
  const t = csv.toObjects("name, score\nAda, 9\n");
  assert.deepEqual(t.columns, ["name", "score"]);
  assert.deepEqual(t.rows, [{ name: "Ada", score: "9" }]);
  assert.equal(csv.stringify([["a", "b,c"], [1, 'q"q']]), 'a,"b,c"\n1,"q""q"');
});

test("niceTicks gives round steps that cover the range", () => {
  assert.deepEqual(niceTicks(0, 100, 5).ticks, [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0, 1, 5).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
  const t = niceTicks(3.2, 7.9, 4);
  assert.ok(t.ticks[0] >= 3.2 && t.ticks.at(-1) <= 7.9 && t.ticks.length >= 3);
  assert.equal(niceTicks(5, 5).ticks.length > 0, true);
});
