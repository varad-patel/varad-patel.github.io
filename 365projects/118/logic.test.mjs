import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { GALTON } from "./data.js";
import {
  LIMITS, SCENARIOS, scenarioById, maxR, gammaDraw, poissonDraw, expectedSecond, expectedRegression, checkParams,
  simulateSteps, simulate, finish, sweep, sweepGrid, covers, galtonPairs, galtonSelect, FEMALE_FACTOR, OUTSIDE2, chanceOutside,
} from "./logic.js";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const scenario = (id, extra = {}) => ({ ...scenarioById(id), seed: 1, ...extra });

test("the formula: a hand-computed case", () => {
  // Mean 100, r = 0.7: a pupil who scored 70 is expected to score 100 + 0.7 * (70 - 100) = 79 next time.
  assert.equal(expectedSecond(70, 100, 0.7), 79);
  close(expectedRegression(70, 100, 0.7), -9, 1e-12); // 0.3 of the 30 points back towards the mean
  assert.equal(expectedRegression(130, 100, 1), 0);
  assert.equal(expectedRegression(130, 100, 0), 30);
});

test("gamma draws have mean and variance equal to the shape", () => {
  for (const shape of [0.2, 0.9, 1, 3.5, 20]) {
    const r = rng(11);
    const xs = Array.from({ length: 60000 }, () => gammaDraw(r, shape));
    close(stats.mean(xs), shape, 0.03 * Math.max(1, Math.sqrt(shape)));
    close(stats.variance(xs), shape, 0.08 * Math.max(1, shape));
    assert.ok(xs.every((v) => v >= 0 && Number.isFinite(v)));
  }
});

test("Poisson draws have mean and variance equal to the rate, in both branches of the sampler", () => {
  for (const lam of [0.4, 3, 9.9, 10, 37, 400]) {
    const r = rng(5);
    const xs = Array.from({ length: 60000 }, () => poissonDraw(r, lam));
    close(stats.mean(xs), lam, 0.02 * Math.sqrt(lam) + 0.01);
    close(stats.variance(xs) / lam, 1, 0.04);
    assert.ok(xs.every((v) => Number.isInteger(v) && v >= 0));
  }
  // P(X = 0) for rate 3 is e^-3 = 0.0498.
  const r = rng(9);
  const zeros = Array.from({ length: 100000 }, () => poissonDraw(r, 3)).filter((v) => v === 0).length / 100000;
  close(zeros, Math.exp(-3), 0.003);
  assert.equal(poissonDraw(rng(1), 0), 0);
});

test("the stated models: both measurements have the same mean and spread, and correlation r", () => {
  for (const r of [0, 0.3, 0.7, 1]) {
    const res = simulate(scenario("pupils", { r, n: 40000, seed: 2 }));
    close(res.population.xbar, 100, 0.3);
    close(res.population.ybar, 100, 0.3);
    close(res.population.corr, r, 0.015);
  }
  // Counts: rate ~ Gamma(mu beta, beta), beta = 1/r - 1. Mean mu, variance mu / (1 - r), correlation r.
  for (const r of [0, 0.25, 0.5, 0.9]) {
    const s = { ...scenario("camera", { r, n: 60000, seed: 3 }) };
    const res = simulate(s);
    close(res.population.xbar, 3, 0.05);
    close(res.population.corr, r, 0.02);
  }
  const big = (() => {
    const gen = simulateSteps({ kind: "counts", mean: 3, r: 0.5, n: 60000, seed: 4, pick: "top", share: 0.05 });
    return finish(gen);
  })();
  assert.equal(big.m, 3000);
});

test("theory: picking the bottom tenth of a normal population, the group gets back (1 - r) of a distance of 1.755 SD", () => {
  // E[Z | Z below the 10th percentile] = -phi(1.2816) / 0.1 = -1.7550.
  const res = simulate(scenario("pupils", { r: 0.7, n: 100000, seed: 8 }));
  const g = res.treated;
  assert.equal(g.m, 10000);
  close(g.distance / 15, -1.755, 0.03);
  close(g.change, 0.3 * 1.755 * 15, 0.35);  // about 7.9 points better with no cause at all
  close(g.change, -expectedRegression(g.xbar, 100, 0.7), 4 * g.se);
});

test("the simulation agrees with the formula: z-scores over many seeds look like draws from a standard normal", () => {
  for (const id of ["pupils", "camera"]) {
    for (const r of [0, 0.5, 0.9]) {
      const zs = [];
      for (let seed = 1; seed <= 150; seed++) zs.push(simulate(scenario(id, { n: 1500, r, seed })).treated.z);
      close(stats.mean(zs), 0, 0.3);
      close(stats.sd(zs), 1, 0.2);
      const within = zs.filter((z) => Math.abs(z) <= 2).length / zs.length;
      assert.ok(within > 0.88 && within < 0.995, `${id} r=${r}: ${within}`);
    }
  }
});

test("r = 1 gives no regression at all, r = 0 gives it all back", () => {
  const one = simulate(scenario("pupils", { r: 1, seed: 3 }));
  close(one.treated.change, 0, 1e-9);
  assert.equal(one.treated.se, 0);
  assert.equal(one.treated.within, true);
  const zero = simulate(scenario("pupils", { r: 0, n: 50000, seed: 3 }));
  close(zero.treated.ybar, 100, 0.6); // the picked group's second score is just the population mean
  close(zero.treated.change / -zero.treated.distance, 1, 0.03);
});

test("the picked group is the most extreme on the first measurement, and ties between counts are broken at random", () => {
  const res = simulate(scenario("pupils", { seed: 5 }));
  const picked = res.plot.filter((p) => p[2]).map((p) => p[0]);
  const rest = res.plot.filter((p) => !p[2]).map((p) => p[0]);
  assert.ok(stats.max(picked) <= stats.min(rest), "bottom pick: every picked score is below every other");
  const cam = simulate(scenario("camera", { seed: 5 }));
  assert.equal(cam.m, 250);
  const cp = cam.plot.filter((p) => p[2]).map((p) => p[0]), cr = cam.plot.filter((p) => !p[2]).map((p) => p[0]);
  assert.ok(stats.min(cp) >= stats.max(cr), "top pick: no junction left out had more crashes than one picked");
});

test("the same seed gives the same result, however the work is sliced", () => {
  const a = finish(simulateSteps(scenario("camera", { seed: 77 }), 20000));
  const b = finish(simulateSteps(scenario("camera", { seed: 77 }), 137));
  assert.deepEqual(a.treated, b.treated);
  assert.deepEqual(a.plot, b.plot);
  const c = simulate(scenario("camera", { seed: 78 }));
  assert.notDeepEqual(a.treated, c.treated);
});

test("a control group removes the illusion: both halves move alike, and their difference estimates the real effect", () => {
  let covered = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const res = simulate(scenario("patients", { n: 2000, seed, control: true, effect: 0 }));
    if (covers(res.effect, 0)) covered++;
  }
  close(covered / 200, 0.95, 0.04);
  const res = simulate(scenario("patients", { n: 100000, seed: 4, control: true, effect: 0 }));
  assert.equal(res.treated.m + res.control.m, res.m);
  assert.ok(res.treated.change < -8 && res.control.change < -8, "both halves fall by about 9 mmHg with a pill that does nothing");
  close(res.effect.estimate, 0, 0.5);
  // A real effect of -5 mmHg: the before-and-after change mixes it with regression, the comparison recovers it.
  const real = simulate(scenario("patients", { n: 100000, seed: 4, control: true, effect: -5 }));
  close(real.effect.estimate, -5, 0.5);
  assert.ok(real.treated.change < -12);
  close(real.treated.ybar, real.treated.predicted, 3 * real.treated.se);
  // The verdict splits the expected change: regression -(1 - r)(xbar - mu), plus the effect, makes predictedChange.
  close(real.treated.predictedChange, -real.treated.regression - 5, 1e-9);
});

test("counts: a camera that cuts crashes by 30% is measured as about -30% by the comparison, and 0% when it does nothing", () => {
  const none = simulate(scenario("camera", { n: 100000, seed: 2, control: true, effect: 0 }));
  close(none.effect.estimate, 0, 0.05);
  assert.ok(none.treated.change < -2, "the camera junctions still have fewer crashes the next year");
  const cut = simulate(scenario("camera", { n: 100000, seed: 2, control: true, effect: -0.3 }));
  close(cut.effect.estimate, -0.3, 0.05);
  assert.ok(cut.effect.low < cut.effect.estimate && cut.effect.estimate < cut.effect.high);
});

test("testing the formula at every r: the sweep's checks are within two standard errors about 19 times in 20", () => {
  assert.deepEqual(sweepGrid("normal").slice(0, 3), [0, 0.05, 0.1]);
  assert.equal(sweepGrid("normal").at(-1), 1);
  assert.equal(sweepGrid("counts").at(-1), 0.95);
  let within = 0, total = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = sweep(scenario("pupils", { n: 3000, seed }));
    within += s.within; total += s.rows.length;
    for (const row of s.rows) close(row.share, row.expected, 5 * row.se + 1e-9);
  }
  assert.ok(within / total > 0.88, `${within} of ${total}`);
  const cams = sweep(scenario("camera", { n: 3000, seed: 1 }));
  assert.equal(cams.rows.length, 20);
  assert.ok(cams.rows.every((row) => Number.isFinite(row.share) && Number.isFinite(row.z)));
  assert.equal(cams.checks, 20);
  // The normal model's check at r = 1 has no luck in it and is not counted as a check.
  const pupils = sweep(scenario("pupils", { n: 3000, seed: 1 }));
  assert.equal(pupils.checks, 20);
  assert.equal(pupils.outside, 20 - (pupils.within - 1));
});

test("the sweep's verdict: the binomial chance of so many checks falling outside two standard errors", () => {
  close(OUTSIDE2, 0.0455, 5e-5);                                  // P(|Z| > 2)
  close(chanceOutside(0, 21), 1, 1e-12);
  close(chanceOutside(1, 21), 1 - (1 - OUTSIDE2) ** 21, 1e-12);    // 0.62: one miss in 21 is the usual case
  // Three or more of 21: 1 - P(0) - P(1) - P(2), by hand 0.068. Not enough to call the formula wrong.
  const q = 1 - OUTSIDE2, p = OUTSIDE2;
  close(chanceOutside(3, 21), 1 - q ** 21 - 21 * p * q ** 20 - 210 * p * p * q ** 19, 1e-12);
  close(chanceOutside(3, 21), 0.068, 0.002);
  assert.ok(chanceOutside(5, 21) < 0.01);
});

test("bad settings get a message that says what to fix", () => {
  const base = { kind: "normal", n: 1000, share: 0.1, r: 0.5, control: false };
  assert.ok(checkParams(base).ok);
  assert.match(checkParams({ ...base, n: 100.5 }).error, /whole number/);
  assert.match(checkParams({ ...base, n: 1e6 }).error, /100,000/);
  assert.match(checkParams({ ...base, n: 199 }).error, /between 200/);
  assert.match(checkParams({ ...base, share: 0.6 }).error, /50%/);
  assert.match(checkParams({ ...base, share: NaN }).error, /1% and 50%/);
  assert.match(checkParams({ ...base, r: 1.2 }).error, /between 0 and 1/);
  assert.match(checkParams({ ...base, kind: "counts", r: 0.99 }).error, /between 0 and 0.95/);
  assert.equal(maxR("counts"), 0.95);
  assert.ok(checkParams({ ...base, n: 200, share: 0.01 }).ok);          // 2 picked
  assert.match(checkParams({ ...base, n: 200, share: 0.01, control: true }).error, /picks 2 units; at least 4/);
  assert.equal(LIMITS.nMax, 100000);
  for (const s of SCENARIOS) assert.ok(checkParams({ ...s, control: true }).ok, s.id);
});

test("Galton's data: 898 children in 197 families, with the erratum applied", () => {
  assert.equal(GALTON.rows.length, 898);
  assert.equal(GALTON.families.length, 197);
  assert.equal(GALTON.rows.filter((r) => r[3] === 1).length, 465);
  // The source's own figures: family 1 is father 78.5, mother 67.0, a son of 73.2 and daughters of 69.2, 69.0 and 69.0.
  const f1 = GALTON.rows.filter((r) => GALTON.families[r[0]] === "1");
  assert.deepEqual(f1.map((r) => r.slice(1)), [[78.5, 67, 1, 73.2], [78.5, 67, 0, 69.2], [78.5, 67, 0, 69], [78.5, 67, 0, 69]]);
  const f103 = GALTON.rows.filter((r) => GALTON.families[r[0]] === "103");
  assert.equal(f103.filter((r) => r[3] === 1).length, 6);
  assert.ok(f103.some((r) => r[4] === 67 && r[1] === 69 && r[2] === 66.5));
  assert.equal(GALTON.rows.filter((r) => GALTON.families[r[0]] === "101").length, 4);
  assert.equal(GALTON.source.licence, "CC0 1.0");
});

test("Galton's pairs: mid-parent as Galton defined it, and the correlations a separate Python check found", () => {
  assert.equal(FEMALE_FACTOR, 1.08);
  const mid = galtonPairs(GALTON, "midparent");
  assert.equal(mid.x.length, 898);
  close(mid.x[0], (78.5 + 1.08 * 67) / 2, 1e-12);
  close(mid.y[1], 69.2 * 1.08, 1e-12);
  // Recomputed in Python (statistics module, normal equations) from the same rows.
  close(stats.corr(mid.x, mid.y), 0.5107, 5e-4);
  const fs = galtonPairs(GALTON, "fatherSon");
  assert.equal(fs.x.length, 465);
  close(stats.corr(fs.x, fs.y), 0.3913, 5e-4);
  const md = galtonPairs(GALTON, "motherDaughter");
  assert.equal(md.x.length, 433);
  close(stats.corr(md.x, md.y), 0.3137, 5e-4);
  assert.throws(() => galtonPairs(GALTON, "cousins"));
});

test("Galton's selection: ties at the cut are all included, and the standard units obey the same rule", () => {
  const pairs = galtonPairs(GALTON, "fatherSon");
  const g = galtonSelect(pairs, { direction: "parents", pick: "top", share: 0.1 });
  assert.equal(g.want, 47);
  assert.ok(g.m >= g.want);
  assert.equal(g.cut, 72);
  assert.ok(g.idx.every((i) => pairs.x[i] >= 72));
  assert.equal(pairs.x.filter((v) => v >= 72).length, g.m);
  close(g.predicted, g.muO + g.slope * (g.sbar - g.muS), 1e-12);
  close(g.expectedShare, 1 - g.r, 1e-12);
  assert.ok(Math.abs(g.z) < 2);
  const low = galtonSelect(pairs, { direction: "children", pick: "bottom", share: 0.05 });
  assert.ok(low.sbar < low.muS && low.obar > low.sbar && low.obar < low.muO);
});

test("the finding: the tallest tenth on either side is followed by a group nearer the average on the other", () => {
  const pairs = galtonPairs(GALTON, "midparent");
  const down = galtonSelect(pairs, { direction: "parents", pick: "top", share: 0.1 });
  assert.equal(down.m, 94);
  assert.equal(down.sbar.toFixed(1), "72.5");
  assert.equal((down.sbar - down.muS).toFixed(1), "3.3");
  assert.equal(down.obar.toFixed(1), "71.7");
  assert.equal((down.obar - down.muO).toFixed(1), "2.5");
  assert.equal(down.muS.toFixed(1), "69.2");
  const up = galtonSelect(pairs, { direction: "children", pick: "top", share: 0.1 });
  assert.equal(up.m, 104);
  assert.equal(up.sbar.toFixed(1), "73.6");
  assert.equal((up.sbar - up.muS).toFixed(1), "4.3");
  assert.equal(up.obar.toFixed(1), "71.2");
  assert.equal((up.obar - up.muO).toFixed(1), "2.0");
  assert.equal(down.r.toFixed(2), "0.51");
  // Both are within two standard errors of the regression line.
  assert.ok(Math.abs(down.z) < 2 && Math.abs(up.z) < 2);
});
