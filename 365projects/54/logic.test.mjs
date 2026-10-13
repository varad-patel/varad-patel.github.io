import test from "node:test";
import assert from "node:assert/strict";
import { MINCER as M } from "./data.js";
import {
  LEVELS, SEXES, AGE_MIN, AGE_MAX, PROBS, profileProblem, experience, bandOf, blend, xMincer, xLevels, predictLog, gapLog, predict, histogram, outEarns,
  cellMean, compare, profileCurve, returnPerYear, peakExperience, groupMeans,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const LEVEL = Object.fromEntries(LEVELS.map((l, i) => [l.key, i]));
const sexIndex = { men: 0, women: 1 };
const dot = (x, b) => x.reduce((t, v, i) => t + v * b[i], 0);

/* ------------------------------------------------------------------------- the data */

test("the script's reading of the microdata reproduces the Census Bureau's published totals and standard errors", () => {
  // US Census Bureau, "PUMS estimates for user verification", 2024 (pums_estimates_24.csv), rows for the United States.
  const published = {
    total: [340110990, 4],        // Total population
    females: [171859335, 28762],  // Total females (SEX=2)
    age2534: [46117271, 33769],   // Age 25-34
    age3544: [46107741, 27990],   // Age 35-44
  };
  for (const [key, [estimate, se]] of Object.entries(published)) {
    assert.equal(M.checks[key].estimate, estimate, `${key}: estimate`);
    assert.equal(M.checks[key].se, se, `${key}: standard error from the 80 replicate weights`);
    assert.equal(M.checks[key].published, estimate);
    assert.equal(M.checks[key].publishedSe, se);
  }
});

test("the comparison table is Table 3a of Montenegro and Patrinos (2014) as printed", () => {
  const row = Object.fromEntries(M.other.rows.map((r) => [r.region, r]));
  assert.equal(M.other.rows.length, 8);
  assert.deepEqual(row["High-income economies"], { region: "High-income economies", total: 10.0, men: 9.5, women: 11.1, economies: 33 });
  assert.deepEqual(row["Sub-Saharan Africa"], { region: "Sub-Saharan Africa", total: 12.4, men: 11.3, women: 14.5, economies: 33 });
  assert.deepEqual(row["South Asia"], { region: "South Asia", total: 7.7, men: 6.9, women: 10.2, economies: 7 });
  assert.deepEqual(row["All economies"], { region: "All economies", total: 9.7, men: 9.1, women: 11.4, economies: 139 });
  assert.equal(M.other.rows.slice(0, 7).reduce((s, r) => s + r.economies, 0), 139);
});

test("the sample: who is in it, and how it was split", () => {
  const s = M.sample.steps;
  assert.deepEqual(s, { persons: 3422888, aged: 1687605, employees: 1310041, fullTime: 920491, paid: 920490, kept: 913079 });
  assert.ok(s.persons > s.aged && s.aged > s.employees && s.employees > s.fullTime && s.fullTime >= s.paid && s.paid > s.kept);
  assert.equal(M.sample.people, s.kept);
  assert.equal(M.sample.train + M.sample.test, M.sample.people);
  close(M.sample.test / M.sample.people, 0.2, 0.005);
  assert.equal(M.year, 2024);
  assert.equal(M.country, "United States");
  assert.equal(LEVELS.reduce((t, l) => t + l.people, 0), M.sample.people);
  close(LEVELS.reduce((t, l) => t + l.share, 0), 1, 0.001);
  assert.equal(M.hist.people.flat(2).reduce((t, v) => t + v, 0), M.sample.people);
  assert.deepEqual(LEVELS.map((l) => l.key), ["none", "hs", "some", "assoc", "bach", "mast", "prof", "doct"]);
  // Levels made of a single survey code have exactly its assigned years; the two mixed levels lie between their codes'.
  assert.deepEqual([LEVEL.hs, LEVEL.assoc, LEVEL.bach, LEVEL.mast, LEVEL.prof, LEVEL.doct].map((i) => LEVELS[i].years), [12, 14, 16, 18, 19, 20]);
  assert.ok(LEVELS[LEVEL.none].years > 0 && LEVELS[LEVEL.none].years < 12);
  assert.ok(LEVELS[LEVEL.some].years > 13 && LEVELS[LEVEL.some].years < 14);
  assert.deepEqual(M.yearsBySchl, [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 12, 13, 14, 14, 16, 18, 19, 20]);
});

test("the bundle is well formed", () => {
  for (const sex of ["men", "women"]) {
    for (const [name, p] of [["mincer", 4], ["levels", 12]]) {
      const m = M.models[name][sex];
      assert.equal(m.beta.length, p);
      assert.equal(m.cov.length, p);
      m.cov.forEach((row, i) => { assert.equal(row.length, p); assert.ok(row[i] > 0); row.forEach((v, j) => close(v, m.cov[j][i], 1e-15)); });
      assert.ok(m.beta.every(Number.isFinite));
    }
  }
  assert.deepEqual(PROBS, [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]);
  for (const s of [0, 1]) for (let b = 0; b < 4; b++) for (let l = 0; l < 8; l++) {
    const q = M.residualQuantiles[s][b][l];
    assert.equal(q.length, 7);
    for (let i = 1; i < 7; i++) assert.ok(q[i] >= q[i - 1]);
    assert.ok(q[0] < 0 && q[6] > 0);
    assert.ok(M.smear[s][b][l] > 1 && M.smear[s][b][l] < 2);
    assert.ok(M.groupPeople[s][b][l] >= 1000);
    const h = M.hist.shares[s][b][l];
    assert.equal(h.length, M.hist.bins);
    close(h.reduce((t, v) => t + v, 0), 100000, 60);
  }
  assert.equal(M.cellMeans[0][0].length, AGE_MAX - AGE_MIN + 1);
  assert.equal(SEXES.length, 2);
});

/* ------------------------------------------------------------------------ the model */

test("experience and the regressors, by hand", () => {
  assert.equal(experience(12, 35), 17);
  assert.equal(experience(16, 35), 13);
  assert.equal(experience(20, 25), 0);   // a doctorate at 25: 25 - 20 - 6 is below zero, so zero
  assert.deepEqual(xMincer(12, 35), [1, 12, 17, 289]);
  const x = xLevels(4, 16, 35);          // bachelor's at 35: z = (13 - 20) / 10
  assert.deepEqual(x.slice(0, 8), [0, 0, 0, 0, 1, 0, 0, 0]);
  close(x[8], -0.7); close(x[9], 0.49); close(x[10], -0.343); close(x[11], 0.2401);
  assert.deepEqual([25, 34, 35, 44, 45, 54, 55, 64].map(bandOf), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test("a prediction is the coefficients times the regressors, written out", () => {
  // Women, bachelor's degree, age 35, by-level model: a_bach + g1 z + g2 z^2 + g3 z^3 + g4 z^4 with z = -0.7.
  const b = M.models.levels.women.beta;
  const z = -0.7;
  const byHand = b[4] + b[8] * z + b[9] * z * z + b[10] * z ** 3 + b[11] * z ** 4;
  close(predictLog({ sex: "women", age: 35, level: 4 }).mean, byHand, 1e-12);
  // Men, high school, age 40, Mincer: a + r 12 + b1 22 + b2 22^2.
  const m = M.models.mincer.men.beta;
  close(predictLog({ sex: "men", age: 40, level: 1 }, "mincer").mean, m[0] + m[1] * 12 + m[2] * 22 + m[3] * 484, 1e-12);
  // The standard error is sqrt(x' V x): for the Mincer intercept alone it is the root of the first variance.
  const V = M.models.mincer.men.cov;
  const x = [1, 12, 22, 484];
  let q = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) q += x[i] * V[i][j] * x[j];
  close(predictLog({ sex: "men", age: 40, level: 1 }, "mincer").se, Math.sqrt(q), 1e-12);
});

test("the gap between two levels is the difference of their predictions, with its own standard error", () => {
  for (const sex of ["women", "men"]) for (const age of [25, 35, 50, 64]) for (const [from, to] of [[1, 4], [4, 5], [0, 7], [6, 7]]) {
    const g = gapLog({ sex, age }, from, to);
    close(g.diff, predictLog({ sex, age, level: to }).mean - predictLog({ sex, age, level: from }).mean, 1e-12);
    assert.ok(g.se > 0 && g.se < 0.05);
    const back = gapLog({ sex, age }, to, from);
    close(back.diff, -g.diff, 1e-12);
    close(back.se, g.se, 1e-12);
  }
  assert.deepEqual(gapLog({ sex: "women", age: 40 }, 3, 3), { diff: 0, se: 0 });
});

test("pay for one profile: centre, interval for the average, and range for one person", () => {
  for (const sex of ["women", "men"]) for (const age of [25, 40, 64]) for (let level = 0; level < 8; level++) {
    const p = predict({ sex, age, level });
    close(p.central, Math.exp(p.log), 1e-9);
    assert.ok(p.ci[0] < p.central && p.central < p.ci[1]);
    assert.ok(p.quantiles.length === 7 && p.quantiles.every((v, i, a) => i === 0 || v >= a[i - 1]));
    assert.ok(p.p10 < p.p25 && p.p25 < p.median && p.median < p.p75 && p.p75 < p.p90);
    assert.ok(p.mean > p.central);
    // The range for one person dwarfs the uncertainty about the average.
    assert.ok((p.p90 - p.p10) > 15 * (p.ci[1] - p.ci[0]));
    assert.ok(p.central > 20000 && p.central < 250000);
  }
  // At 35 the figures are 45% those of the 25-to-34 band and 55% those of the 35-to-44 band: (35 - 29.5) / 10 = 0.55.
  const p = predict({ sex: "women", age: 35, level: LEVEL.bach });
  const q0 = M.residualQuantiles[1][0][LEVEL.bach], q1 = M.residualQuantiles[1][1][LEVEL.bach];
  close(p.p10, p.central * Math.exp(0.45 * q0[1] + 0.55 * q1[1]), 1e-9);
  close(p.p90, p.central * Math.exp(0.45 * q0[5] + 0.55 * q1[5]), 1e-9);
  close(p.mean, p.central * (0.45 * M.smear[1][0][LEVEL.bach] + 0.55 * M.smear[1][1][LEVEL.bach]), 1e-9);
  // In the middle of a band, and beyond the outer middles, one band is used as it is.
  const mid = predict({ sex: "men", age: 64, level: LEVEL.hs });
  close(mid.p90, mid.central * Math.exp(M.residualQuantiles[0][3][LEVEL.hs][5]), 1e-9);
  const young = predict({ sex: "men", age: 26, level: LEVEL.hs });
  close(young.p10, young.central * Math.exp(M.residualQuantiles[0][0][LEVEL.hs][1]), 1e-9);
  assert.throws(() => predict({ sex: "women", age: 24, level: 1 }));
});

test("age bands are blended so that the range for one person never jumps from one birthday to the next", () => {
  assert.deepEqual(blend(25), [[0, 1]]);
  assert.deepEqual(blend(29), [[0, 1]]);
  assert.deepEqual(blend(64), [[3, 1]]);
  assert.deepEqual(blend(60), [[3, 1]]);
  const b35 = blend(35);
  assert.deepEqual(b35.map((x) => x[0]), [0, 1]);
  close(b35[0][1], 0.45); close(b35[1][1], 0.55);
  assert.deepEqual(M.bandMids, [29.5, 39.5, 49.5, 59.5]);
  for (let age = AGE_MIN; age <= AGE_MAX; age++) close(blend(age).reduce((s, x) => s + x[1], 0), 1, 1e-12);
  // The width of the range (its ends as multiples of the central estimate) moves by less than 5% from one age to the
  // next, for every sex and level. Read off the bands unblended, it would jump by up to 48% at 35, 45 and 55.
  let worst = 0, unblended = 0;
  for (const sex of ["women", "men"]) for (let level = 0; level < 8; level++) {
    for (let age = AGE_MIN + 1; age <= AGE_MAX; age++) {
      const a = predict({ sex, age: age - 1, level }), b = predict({ sex, age, level });
      for (const k of ["p10", "p90"]) worst = Math.max(worst, Math.abs(Math.log(b[k] / b.central) - Math.log(a[k] / a.central)));
    }
    const q = M.residualQuantiles[sex === "men" ? 0 : 1];
    for (let band = 1; band < 4; band++) for (const i of [1, 5]) unblended = Math.max(unblended, Math.abs(q[band][level][i] - q[band - 1][level][i]));
  }
  assert.ok(worst < 0.05, `the range steps by ${worst}`);
  assert.ok(unblended > 0.4 && unblended < 0.5);
  close(worst, unblended / 10, 1e-9); // ten years between band middles
});

test("the model stays close to the data's own averages in the large cells", () => {
  // High school and bachelor's, ages 30 to 60: fitted mean of log pay within 0.08 of the weighted cell mean.
  for (const sex of ["women", "men"]) for (const level of [LEVEL.hs, LEVEL.bach]) for (let age = 30; age <= 60; age++) {
    const c = cellMean(sex, level, age);
    assert.ok(c != null);
    close(predictLog({ sex, age, level }).mean, c, 0.08);
  }
  // Cells with fewer than 100 people are withheld, and they are where you would expect.
  assert.equal(cellMean("men", LEVEL.doct, 25), null);
  assert.equal(cellMean("women", LEVEL.prof, 25), null);
  assert.equal(M.cellMeans.flat(2).filter((v) => v == null).length, 8);
});

test("Mincer's equation: a year of schooling goes with about a tenth more pay, and pay is concave in experience", () => {
  const men = returnPerYear("men"), women = returnPerYear("women");
  assert.equal(men.coef.toFixed(4), "0.1024");
  assert.equal(women.coef.toFixed(4), "0.1054");
  assert.equal((men.pct * 100).toFixed(1), "10.8");
  assert.equal((women.pct * 100).toFixed(1), "11.1");
  assert.ok(men.se < 0.001 && women.se < 0.001);
  close(men.pct, Math.exp(men.coef) - 1, 1e-12);
  assert.ok(men.ci[0] < men.pct && men.pct < men.ci[1]);
  for (const sex of ["men", "women"]) {
    const [, , b1, b2] = M.models.mincer[sex].beta;
    assert.ok(b1 > 0 && b2 < 0);
    close(peakExperience(sex), -b1 / (2 * b2), 1e-12);
    assert.ok(peakExperience(sex) > 30 && peakExperience(sex) < 50);
  }
});

/* ------------------------------------------------------------- distributions and overlap */

test("histograms are whole distributions on a pay scale", () => {
  const h = histogram("women", 1, LEVEL.bach);
  assert.equal(h.length, 104);
  close(h.reduce((s, b) => s + b.share, 0), 1, 1e-12);
  close(h[0].x0, Math.exp(8.7), 1e-6);
  for (let i = 1; i < h.length; i++) close(h[i].x0, h[i - 1].x1, 1e-6);
  close(h[0].x1 / h[0].x0, Math.exp(0.05), 1e-9); // each bin is about 5% wide
});

test("the chance that one worker out-earns another", () => {
  for (const sex of ["women", "men"]) for (let band = 0; band < 4; band++) {
    for (let a = 0; a < 8; a++) {
      close(outEarns(sex, band, a, a), 0.5, 1e-12);
      for (let b = 0; b < 8; b++) close(outEarns(sex, band, a, b) + outEarns(sex, band, b, a), 1, 1e-12);
    }
    // High school against bachelor's: the graduate usually wins, but far from always.
    const p = outEarns(sex, band, LEVEL.hs, LEVEL.bach);
    assert.ok(p > 0.15 && p < 0.3, `${sex} band ${band}: ${p}`);
    // Each step up the main ladder makes winning likelier than not.
    for (const [lo, hi] of [[0, 1], [1, 2], [2, 4], [4, 5]]) assert.ok(outEarns(sex, band, hi, lo) > 0.5);
  }
  // By hand from the two histograms: sum over bins of share_a * (share of b below + half the share of b in the bin).
  const s = sexIndex.women, ha = M.hist.shares[s][1][LEVEL.hs], hb = M.hist.shares[s][1][LEVEL.bach];
  const ta = ha.reduce((x, v) => x + v, 0), tb = hb.reduce((x, v) => x + v, 0);
  let p = 0;
  for (let i = 0; i < ha.length; i++) { let below = 0; for (let j = 0; j < i; j++) below += hb[j]; p += (ha[i] / ta) * ((below + hb[i] / 2) / tb); }
  close(outEarns("women", 1, LEVEL.hs, LEVEL.bach), p, 1e-12);
});

/* ------------------------------------------------------------------------ comparing */

test("comparing two levels", () => {
  const c = compare({ sex: "women", age: 35, from: LEVEL.hs, to: LEVEL.bach });
  close(c.gap.pct, c.to.central / c.from.central - 1, 1e-9);
  close(c.gap.dollars, c.to.central - c.from.central, 1e-9);
  assert.ok(c.gap.ci[0] < c.gap.pct && c.gap.pct < c.gap.ci[1]);
  assert.equal(c.low, LEVEL.hs); assert.equal(c.high, LEVEL.bach); assert.equal(c.band, 1);
  close(c.upset, outEarns("women", 1, LEVEL.hs, LEVEL.bach), 1e-12);
  close(c.raw.pct, Math.exp(cellMean("women", LEVEL.bach, 35) - cellMean("women", LEVEL.hs, 35)) - 1, 1e-12);
  // Turned round, the gap is the reciprocal and the same pair is the upset.
  const r = compare({ sex: "women", age: 35, from: LEVEL.bach, to: LEVEL.hs });
  close((1 + r.gap.pct) * (1 + c.gap.pct), 1, 1e-9);
  assert.equal(r.low, LEVEL.hs);
  close(r.upset, c.upset, 1e-12);
  // The same level twice.
  const same = compare({ sex: "men", age: 50, from: 3, to: 3 });
  assert.equal(same.same, true);
  close(same.gap.pct, 0); close(same.gap.dollars, 0); close(same.upset, 0.5);
  assert.deepEqual(same.gap.ci, [0, 0]);
  // No raw figure where the data's own average is withheld.
  assert.equal(compare({ sex: "men", age: 25, from: LEVEL.bach, to: LEVEL.doct }).raw, null);
  // Mincer's straight line gives the same four-year gap from high school to bachelor's as from 12 to 16 years anywhere.
  const m = M.models.mincer.women.beta;
  const X0 = 17, X1 = 13;
  close(c.mincer.pct, Math.exp(m[1] * 4 + m[2] * (X1 - X0) + m[3] * (X1 * X1 - X0 * X0)) - 1, 1e-9);
  assert.throws(() => compare({ sex: "women", age: 35, from: 1, to: 8 }));
  assert.throws(() => compare({ sex: "x", age: 35, from: 1, to: 2 }));
});

test("the fitted curve over every age", () => {
  const curve = profileCurve("women", LEVEL.bach);
  assert.equal(curve.length, 40);
  assert.equal(curve[0].age, 25); assert.equal(curve[39].age, 64);
  for (const p of curve) { assert.ok(p.p10 < p.central && p.central < p.p90); assert.ok(p.dot == null || p.dot > 10000); }
  close(curve[10].central, predict({ sex: "women", age: 35, level: LEVEL.bach }).central, 1e-9);
  assert.equal(profileCurve("men", LEVEL.doct)[0].dot, null);
});

test("a profile is checked before it is used", () => {
  assert.equal(profileProblem({ sex: "women", age: 35, level: 4 }), "");
  assert.match(profileProblem({ sex: "other", age: 35, level: 4 }), /women or men/);
  for (const age of [24, 65, 35.5, NaN, Infinity, -1, 1e308, "35"]) assert.match(profileProblem({ sex: "men", age, level: 1 }), /whole number from 25 to 64/);
  for (const level of [-1, 8, 2.5, NaN, undefined]) assert.match(profileProblem({ sex: "men", age: 30, level }), /eight levels/);
});

/* ---------------------------------------------------------------- how good is the model */

test("out-of-sample error: each richer rule does better on the held-out fifth, and none does well", () => {
  const rule = Object.fromEntries(M.outOfSample.map((r) => [r.rule, r]));
  assert.deepEqual(M.outOfSample.map((r) => r.rule), ["mean", "sex", "mincer", "levels", "cells"]);
  assert.ok(rule.mean.rmse > rule.sex.rmse && rule.sex.rmse > rule.mincer.rmse && rule.mincer.rmse > rule.levels.rmse && rule.levels.rmse >= rule.cells.rmse);
  assert.equal(rule.mean.r2, 0);
  assert.deepEqual([rule.sex.r2, rule.mincer.r2, rule.levels.r2, rule.cells.r2], [0.0213, 0.2286, 0.2823, 0.2831]);
  assert.deepEqual([rule.mean.rmse, rule.mincer.rmse, rule.levels.rmse], [0.6764, 0.594, 0.573]);
  assert.equal(rule.levels.mae, 0.4325);
  // In-sample and held-out fit agree: with 730,000 people and 12 coefficients there is nothing to overfit.
  close(M.inSample.levels.r2, rule.levels.r2, 0.01);
  close(M.inSample.mincer.rmse, rule.mincer.rmse, 0.005);
  // The ranges for one person hold up on people the model never saw.
  assert.deepEqual(M.coverage, { p10p90: 0.8022, p25p75: 0.5019 });
});

test("the finding: a woman of 35, high school diploma against bachelor's degree", () => {
  const c = compare({ sex: "women", age: 35, from: LEVEL.hs, to: LEVEL.bach });
  const round100 = (x) => Math.round(x / 100) * 100;
  assert.equal(round100(c.from.central), 40900);
  assert.equal(round100(c.to.central), 72100);
  assert.equal((c.gap.pct * 100).toFixed(0), "76");
  assert.equal((c.gap.ci[0] * 100).toFixed(0), "75");
  assert.equal((c.gap.ci[1] * 100).toFixed(0), "77");
  assert.deepEqual([round100(c.from.p10), round100(c.from.p90)], [21900, 73700]);
  assert.deepEqual([round100(c.to.p10), round100(c.to.p90)], [38000, 142900]);
  assert.equal((c.upset * 100).toFixed(0), "21");
  assert.equal((c.mincer.pct * 100).toFixed(0), "46");
  assert.equal(M.sample.people, 913079);
  assert.equal(M.sample.train, 730583); // the people the model was fitted on
});

/* ------------------------------------------------- the independent review of 12 October 2026 */
// The person file was read again with separately written code (pandas in chunks, numpy normal equations on single
// records, not the script's cell sums), with the same sample rules, the person weights and the 80 replicate weights.
// The figures written out below are that refit's, not copies of the bundle.

test("review: a separate refit from the microdata gives the same coefficients and standard errors", () => {
  const refit = {
    mincer: {
      men: [[9.370129, 0.102403, 0.026575, -0.000323], [0.009851, 0.00052, 0.000553, 0.000011]],
      women: [[9.224556, 0.105376, 0.015233, -0.000174], [0.011561, 0.000667, 0.000446, 0.00001]],
    },
    levels: {
      men: [[10.703874, 10.917314, 11.117298, 11.171122, 11.554569, 11.756338, 12.067827, 11.882647, 0.116226, -0.070065, 0.018033, -0.001938],
        [0.004794, 0.002473, 0.003502, 0.003832, 0.003121, 0.004354, 0.010217, 0.008814, 0.002903, 0.00167, 0.001371, 0.000435]],
      women: [[10.464779, 10.642342, 10.807278, 10.884171, 11.256594, 11.429306, 11.782831, 11.661527, 0.062037, -0.041911, 0.017909, -0.002917],
        [0.0065, 0.002765, 0.003434, 0.003854, 0.002493, 0.00328, 0.007867, 0.007898, 0.002353, 0.001611, 0.001255, 0.000399]],
    },
  };
  for (const model of ["mincer", "levels"]) for (const sex of ["men", "women"]) {
    const [beta, se] = refit[model][sex], m = M.models[model][sex];
    beta.forEach((b, i) => close(m.beta[i], b, 1e-6));
    se.forEach((s, i) => close(Math.sqrt(m.cov[i][i]), s, 1e-6));
  }
  // Out-of-sample error and coverage on the held-out fifth, recomputed the same way.
  const rule = Object.fromEntries(M.outOfSample.map((r) => [r.rule, r]));
  assert.deepEqual([rule.mean.rmse, rule.sex.rmse, rule.mincer.rmse, rule.levels.rmse, rule.cells.rmse], [0.6764, 0.6691, 0.594, 0.573, 0.5727]);
  assert.deepEqual([rule.mincer.r2, rule.levels.r2, rule.cells.r2], [0.2286, 0.2823, 0.2831]);
  close(M.coverage.p10p90, 0.8023, 0.0003); close(M.coverage.p25p75, 0.5021, 0.0003);
  assert.deepEqual([M.sample.people, M.sample.train, M.sample.test, M.sample.represents, M.sample.allocatedShare], [913079, 730583, 182496, 97805132, 0.2334]);
});

test("review: the opening example and three other profiles, against the refit and the microdata themselves", () => {
  // [sex, age, from, to, central from, central to, gap, interval low, interval high, share of pairs the lower-paid level wins]
  // The last column is counted from every pair of people in the microdata (weighted, ties as a coin toss), not from bins.
  const profiles = [
    ["women", 35, LEVEL.hs, LEVEL.bach, 40923, 72099, 0.762, 0.752, 0.772, 0.2077],
    ["men", 50, LEVEL.bach, LEVEL.mast, 110321, 133852, 0.213, 0.202, 0.225, 0.421],
    ["men", 64, LEVEL.hs, LEVEL.prof, 58351, 186120, 2.19, 2.12, 2.261, 0.123],
    ["men", 25, LEVEL.bach, LEVEL.hs, 62926, 40242, -0.36, -0.368, -0.353, 0.242],
  ];
  for (const [sex, age, from, to, a, b, gap, lo, hi, upset] of profiles) {
    const c = compare({ sex, age, from, to });
    close(c.from.central, a, 1); close(c.to.central, b, 1);
    close(c.gap.pct, gap, 0.0006); close(c.gap.ci[0], lo, 0.0006); close(c.gap.ci[1], hi, 0.0006);
    close(c.upset, upset, 0.001);
  }
  // The ranges for one person in the opening example.
  const c = compare({ sex: "women", age: 35, from: LEVEL.hs, to: LEVEL.bach });
  close(c.from.p10, 21889, 5); close(c.from.p90, 73696, 5); close(c.to.p10, 37979, 5); close(c.to.p90, 142948, 8);
  // "The median is within 1% of the central estimate, and the average is 13% above it with a diploma and 20% with a degree."
  assert.ok(Math.abs(c.from.median / c.from.central - 1) < 0.01 && Math.abs(c.to.median / c.to.central - 1) < 0.01);
  assert.equal((c.from.mean / c.from.central - 1).toFixed(2), "0.13");
  assert.equal((c.to.mean / c.to.central - 1).toFixed(2), "0.20");
  // The central estimate is below the ordinary average in every group.
  assert.ok(M.smear.flat(2).every((v) => v > 1));
});

test("review: in the two levels that mix several lengths of schooling, the figure is the model's average for the people in the group", () => {
  assert.deepEqual(M.mixed.levels, [LEVEL.none, LEVEL.some]);
  assert.deepEqual(M.mixed.terms, ["S", "X", "X2", "z", "z2", "z3", "z4"]);
  // [sex, age, level, mean years of schooling, mean experience, mean fitted log pay (by level), the same (Mincer)]:
  // weighted averages of each person's own fitted value, taken straight from the microdata.
  const cells = [
    ["men", 25, LEVEL.none, 8.7548, 10.2452, 10.48615, 10.49996],
    ["women", 25, LEVEL.none, 8.366, 10.634, 10.33454, 10.24505],
    ["men", 45, LEVEL.none, 7.4997, 31.5003, 10.76491, 10.64898],
    ["women", 64, LEVEL.none, 7.5656, 50.4344, 10.5103, 10.34321],
    ["men", 30, LEVEL.some, 13.6962, 10.3038, 10.9203, 11.01217],
    ["women", 50, LEVEL.some, 13.6539, 30.3461, 10.84308, 10.96509],
  ];
  for (const [sex, age, level, S, X, byLevel, mincer] of cells) {
    const g = groupMeans(sex, level, age);
    close(g.S, S, 1e-4); close(g.X, X, 1e-4);
    close(predictLog({ sex, age, level }).mean, byLevel, 2e-5);
    close(predictLog({ sex, age, level }, "mincer").mean, mincer, 2e-5);
  }
  // Putting the level's average years (7.41) into the formula instead would say $37,982 for men of 25 with no diploma;
  // the model's average for those men is $35,816, 6% less. The gap to a high school diploma is 12.4%, not 6%.
  const b = M.models.levels.men.beta;
  const naive = dot(xLevels(LEVEL.none, LEVELS[LEVEL.none].years, 25), b);
  close(Math.exp(naive), 37982, 2);
  close(predict({ sex: "men", age: 25, level: LEVEL.none }).central, 35816, 2);
  const gap = compare({ sex: "men", age: 25, from: LEVEL.none, to: LEVEL.hs }).gap;
  close(gap.pct, 0.1236, 0.0003); close(gap.ci[0], 0.1121, 0.0003); close(gap.ci[1], 0.1351, 0.0003);
  const gw = compare({ sex: "women", age: 25, from: LEVEL.none, to: LEVEL.hs }).gap;
  close(gw.pct, 0.1148, 0.0003); close(gw.ci[0], 0.1007, 0.0003); close(gw.ci[1], 0.129, 0.0003);
  // Levels with one length of schooling use it as it is, and the mean terms of a mixed group are consistent.
  assert.deepEqual(groupMeans("women", LEVEL.bach, 35), { S: 16, X: 13, X2: 169, z: [-0.7, 0.48999999999999994, -0.3429999999999999, 0.24009999999999992] });
  for (const s of [0, 1]) for (const k of [0, 1]) M.mixed.means[s][k].forEach(([S, X, X2, z, z2], i) => {
    const age = AGE_MIN + i;
    assert.ok(S >= (k === 0 ? 0 : 13) && S <= (k === 0 ? 12 : 14));
    assert.ok(X >= age - S - 6 - 1e-6 && X2 >= X * X - 1e-6 && z2 >= z * z - 1e-6);   // a mean of max(0, .) and Jensen
    close(z, (X - M.expCentre) / M.expScale, 2e-6);
  });
});

test("review: no person's record is bundled", () => {
  // Everything in the module is a coefficient, a count, a weighted share or a mean. The smallest group behind a set of
  // residual percentiles or a histogram has more than a thousand people, and a mean for one year of age is withheld
  // below 100 people.
  assert.ok(Math.min(...M.groupPeople.flat(2)) >= 1000);
  assert.ok(Math.min(...M.hist.people.flat(2)) >= 1000);
  assert.equal(M.minCell, 100);
  let leaves = 0;
  const walk = (v) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") Object.values(v).forEach(walk); else leaves++; };
  walk(M);
  assert.ok(leaves < 12000, `${leaves} values`);   // against 913,079 people with a dozen fields each
  assert.equal(M.other.licence, "CC BY 3.0 IGO");
  assert.equal(M.other.record, "https://hdl.handle.net/10986/20340");   // the repository record that states the licence
});
