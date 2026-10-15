import test from "node:test";
import assert from "node:assert/strict";
import {
  THETA_BAR, DEFAULTS, LIMITS, readSettings, util, sure, lateAmount, withdrawUtility, waitUtility, advantage, r2, lowerBound,
  tipping, integrate, thresholdLimit, withdrawShare, indifference, threshold, failurePoint, noisyOutcome,
  commonKnowledge, ddOptimal, simulateBank, sweep,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const P = { R: 2, r1: 1.05, lambda: 0.25, a: 1.1 }; // the page's opening bank

test("utility is zero at nothing, its relative risk aversion is a c, and sure() inverts it", () => {
  assert.equal(util(0, 1.1), 0);
  close(util(1, 2), 1 - Math.exp(-2), 1e-15);
  assert.equal(util(Infinity, 3), 1);
  for (const c of [0.5, 1, 1.7]) {
    close(sure(util(c, 1.3), 1.3), c, 1e-12);
    // -c u''/u' by finite differences.
    const h = 1e-4, a = 1.3;
    const d1 = (util(c + h, a) - util(c - h, a)) / (2 * h), d2 = (util(c + h, a) - 2 * util(c, a) + util(c - h, a)) / (h * h);
    close(-c * d2 / d1, a * c, 1e-5);
  }
  assert.equal(sure(1, 2), Infinity);
  assert.equal(sure(0, 2), 0);
});

test("payments by hand: what waiters get, and what a withdrawal is worth once the bank runs short", () => {
  close(lateAmount(0.25, P), (2 * (1 - 0.25 * 1.05)) / 0.75, 1e-15); // 1.9667
  close(r2(P), 1.9666666666666666, 1e-12);
  assert.equal(lateAmount(1 / 1.05, P), 0);
  assert.equal(lateAmount(0.99, P), 0);
  assert.equal(lateAmount(0.6, { ...P, r1: 1 }), 2); // r1 = 1: the bank never runs short, waiters get R
  close(withdrawUtility(0.5, 0.5, P), util(1.05, 1.1), 1e-15);
  close(withdrawUtility(0.5, 1, P), util(1.05, 1.1) / 1.05, 1e-15); // everyone withdraws: a 1/r1 chance of being paid
  close(waitUtility(0.9, 0.25, P), 0.9 * util(r2(P), 1.1), 1e-15);
  // In the top band the investment pays in full at once: waiting gets (R - n r1)/(1 - n) for sure, withdrawing r1.
  close(waitUtility(0.97, 0.5, P), util((2 - 0.525) / 0.5, 1.1), 1e-15);
  close(withdrawUtility(0.97, 1, P), util(1.05, 1.1), 1e-15);
});

test("Diamond and Dybvig's best contract: u'(r1) = R u'(r2), above 1 because risk aversion exceeds 1", () => {
  for (const q of [P, { R: 1.5, lambda: 0.4, a: 2 }, { R: 3, lambda: 0.1, a: 4 }]) {
    const c1 = ddOptimal(q);
    const c2 = (q.R * (1 - q.lambda * c1)) / (1 - q.lambda);
    // First-order condition, and the budget.
    close(q.a * Math.exp(-q.a * c1), q.R * q.a * Math.exp(-q.a * c2), 1e-12);
    close(q.lambda * c1 + ((1 - q.lambda) * c2) / q.R, 1, 1e-12);
    // A fine search over c1 finds nothing better.
    const W = (x) => q.lambda * util(x, q.a) + (1 - q.lambda) * util((q.R * (1 - q.lambda * x)) / (1 - q.lambda), q.a);
    let best = 0;
    for (let x = 1; x < 1 / q.lambda; x += 1e-4) if (W(x) > W(best || 1)) best = x;
    close(best, c1, 2e-4);
    assert.ok(c1 > 1);
  }
  close(ddOptimal(P), (2 - (0.75 * Math.LN2) / 1.1) / 1.25, 1e-15); // 1.2219
});

test("the lower bound and the tipping share, against their definitions", () => {
  // Below the lower bound waiting is worse even when only the impatient withdraw.
  const lb = lowerBound(P);
  close(lb * util(r2(P), 1.1), util(1.05, 1.1), 1e-12);
  assert.equal(lb.toFixed(3), "0.774");
  // The tipping share sets the advantage of waiting to zero; bisection on the definition agrees with the closed form.
  for (const theta of [0.8, 0.85, 0.9, 0.94]) {
    const nHat = tipping(theta, P);
    let lo = P.lambda, hi = 1 / P.r1;
    for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (advantage(theta, m, P) > 0) lo = m; else hi = m; }
    close(nHat, (lo + hi) / 2, 1e-10);
    assert.ok(advantage(theta, nHat - 1e-6, P) > 0 && advantage(theta, nHat + 1e-6, P) < 0);
  }
  assert.equal(tipping(0.7, P), P.lambda); // below the lower bound: a run is certain
  assert.equal(tipping(0.96, P), 1); // in the top band: no run is possible
  assert.equal(tipping(0.9, { ...P, r1: 1 }), 1); // promise only 1 and a run is never self-fulfilling above the bound
  assert.ok(tipping(0.85, P) > tipping(0.8, P)); // better fundamentals, a larger panic needed
});

test("Goldstein and Pauzner's limit threshold, computed from their expression independently", () => {
  // Their condition: integral over n in [lambda, 1] of the advantage at theta*, with n uniform, is zero.
  const gp = (q) => {
    const u = (c) => 1 - Math.exp(-q.a * c);
    const lhs = (u(q.r1) / q.r1) * (1 - q.lambda * q.r1 + Math.log(q.r1));
    // Simpson's rule on [lambda, 1/r1] with 200,000 intervals.
    const m = 200000, top = 1 / q.r1, h = (top - q.lambda) / m;
    let s = 0;
    for (let i = 0; i <= m; i++) {
      const n = q.lambda + i * h;
      const c = q.r1 === 1 ? q.R : (q.R * (1 - q.r1 * n)) / (1 - n);
      s += (i === 0 || i === m ? 1 : i % 2 ? 4 : 2) * u(Math.max(0, c));
    }
    return lhs / ((s * h) / 3);
  };
  for (const q of [P, { ...P, r1: 1.02 }, { ...P, R: 2.5, r1: 1.1 }, { R: 1.8, r1: 1.05, lambda: 0.4, a: 1.6 }]) close(thresholdLimit(q), Math.min(THETA_BAR, gp(q)), 1e-9);
  assert.equal(thresholdLimit(P).toFixed(3), "0.880");
  // Promise only what is stored (r1 = 1) and the threshold is the lower bound: no panic-based runs.
  close(thresholdLimit({ ...P, r1: 1 }), util(1, 1.1) / util(2, 1.1), 1e-12);
  close(thresholdLimit({ ...P, r1: 1 }), lowerBound({ ...P, r1: 1 }), 1e-12);
  // Their Theorem 2: the threshold rises with r1. Above r1 = 1 it is above the lower bound (panic-based runs).
  let prev = 0;
  for (const r1 of [1, 1.01, 1.03, 1.05, 1.07]) { const t = thresholdLimit({ ...P, r1 }); assert.ok(t > prev); prev = t; if (r1 > 1) assert.ok(t > lowerBound({ ...P, r1 })); }
  // Diamond and Dybvig's contract (1.22) runs into the top band: runs at every fundamental below it.
  assert.equal(thresholdLimit({ ...P, r1: ddOptimal(P) }), THETA_BAR);
});

test("the threshold with noise solves the indifference condition and tends to the limit", () => {
  for (const eps of [0.05, 0.02, 0.005]) {
    const k = threshold(P, eps);
    close(indifference(k, eps, P), 0, 1e-10);
    assert.ok(indifference(k - 0.01, eps, P) < 0 && indifference(k + 0.01, eps, P) > 0);
  }
  close(threshold(P, 0.002), thresholdLimit(P), 5e-4);
  // The indifference rises with the threshold: one crossing, one equilibrium.
  let prev = -Infinity;
  for (let k = 0.6; k <= 0.99; k += 0.01) { const f = indifference(k, 0.02, P); assert.ok(f >= prev - 1e-12); prev = f; }
  assert.equal(threshold(P, 0.02).toFixed(3), "0.877");
});

test("the share withdrawing and the failure point, by hand", () => {
  close(withdrawShare(0.5, 0.5, 0.02, 0.25), 0.625, 1e-15); // at the threshold half the patient run
  close(withdrawShare(0.4, 0.5, 0.02, 0.25), 1, 1e-15);
  close(withdrawShare(0.6, 0.5, 0.02, 0.25), 0.25, 1e-15);
  const k = 0.877;
  const f = failurePoint(k, 0.02, P);
  // At the failure point the share withdrawing is exactly 1/r1.
  close(withdrawShare(f, k, 0.02, P.lambda), 1 / 1.05, 1e-12);
  assert.equal(failurePoint(k, 0.02, { ...P, r1: 1 }), null);
  assert.ok(noisyOutcome(f - 0.001, P, 0.02, k).fails);
  assert.ok(!noisyOutcome(f + 0.001, P, 0.02, k).fails);
  assert.ok(!noisyOutcome(0.96, P, 0.02, 0.97).fails); // top band: the bank can pay everyone
});

test("common knowledge: two equilibria between the bounds, and beliefs choose", () => {
  const theta = 0.85;
  const nHat = tipping(theta, P);
  const calm = commonKnowledge(theta, P, 0.3, 0.1);
  assert.ok(calm.both);
  // Round one: the impatient plus the patient whose belief is above the tipping share.
  close(calm.firstRound, 0.25 + 0.75 * Math.min(1, Math.max(0, (0.4 - nHat) / 0.2)), 1e-12);
  assert.equal(calm.run, calm.firstRound > nHat);
  const scared = commonKnowledge(theta, P, 0.9, 0.05);
  assert.equal(scared.run, true);
  assert.equal(commonKnowledge(0.7, P, 0, 0).run, true); // below the lower bound
  assert.equal(commonKnowledge(0.96, P, 1, 0).run, false); // in the top band
  assert.equal(commonKnowledge(theta, P, nHat, 0).run, false); // exactly at the tipping share, depositors wait
});

test("sequential service by hand: when everyone withdraws, 952 of 1,000 are paid 1.05 and one gets the last 0.4", () => {
  const b = simulateBank({ p: P, theta: 0.5, N: 1000, seed: 3, mode: "common", belief: 1, spread: 0 });
  assert.equal(b.share, 1);
  assert.equal(b.served, 952);
  assert.ok(b.fails);
  const amounts = [...b.paid].sort((x, y) => y - x);
  close(amounts[951], 1.05, 1e-12);
  close(amounts[952], 1000 - 952 * 1.05, 1e-9); // 0.4
  assert.equal(amounts[953], 0);
});

test("the agent simulation agrees with the analytic share withdrawing, bank by bank", () => {
  const eps = 0.02, k = threshold(P, eps);
  const N = 200000;
  for (const theta of [0.86, 0.87, 0.877, 0.885, 0.9]) {
    const b = simulateBank({ p: P, theta, N, seed: 11, mode: "noisy", eps, k });
    const n = withdrawShare(theta, k, eps, P.lambda);
    const se = Math.sqrt((n * (1 - n)) / N);
    assert.ok(Math.abs(b.share - n) < 5 * se + 1e-9, `theta ${theta}: simulated ${b.share}, model ${n}`);
    assert.equal(b.fails, noisyOutcome(theta, P, eps, k).fails);
    // Those who wait are paid what the formula says, if the investment pays off.
    if (!b.fails) close(b.lateIfSuccess, (b.unitsLeft * P.R) / (N - b.queue.length), 1e-12);
    if (!b.fails) close(b.lateIfSuccess, lateAmount(b.share, P), 1e-9);
  }
  // A sweep of banks follows the analytic curve.
  const thetas = Array.from({ length: 41 }, (_, i) => 0.8 + i * 0.005);
  const rows = sweep({ p: P, eps, k, N: 20000, seed: 5, thetas });
  for (const r of rows) assert.ok(Math.abs(r.share - withdrawShare(r.theta, k, eps, P.lambda)) < 0.02);
});

test("the agent simulation agrees with the common-knowledge analysis: first round and final outcome", () => {
  for (const [theta, belief, spread] of [[0.85, 0.3, 0.1], [0.85, 0.5, 0.3], [0.85, 0.9, 0.05], [0.7, 0, 0], [0.96, 1, 0], [0.8, 0.45, 0.2]]) {
    const ck = commonKnowledge(theta, P, belief, spread);
    const N = 100000;
    const b = simulateBank({ p: P, theta, N, seed: 2, mode: "common", belief, spread });
    const se = Math.sqrt((ck.firstRound * (1 - ck.firstRound)) / N);
    assert.ok(Math.abs(b.rounds[0] - ck.firstRound) < 5 * se + 1e-9, `first round ${b.rounds[0]} against ${ck.firstRound}`);
    assert.equal(b.share === 1, ck.run, `theta ${theta}, belief ${belief}`);
  }
});

test("settings are checked", () => {
  assert.ok(readSettings({ ...DEFAULTS }).ok);
  assert.equal(readSettings({ ...DEFAULTS, r1: 2.1, R: 2 }).ok, false);
  assert.equal(readSettings({ ...DEFAULTS, lambda: 0.6, r1: 1.7, R: 2 }).ok, false); // 0.6 x 1.7 > 1
  assert.equal(readSettings({ ...DEFAULTS, a: 0.5 }).ok, false);
  assert.equal(readSettings({ ...DEFAULTS, eps: "" }).ok, false);
});

test("the noise is capped as Goldstein and Pauzner assume (THETA_BAR < 1 - 2 eps), so the threshold depositor's fundamentals stay inside [0, 1]", () => {
  assert.ok(THETA_BAR < 1 - 2 * LIMITS.eps.max);
  assert.equal(readSettings({ ...DEFAULTS, eps: 0.025 }).ok, false);
  assert.ok(readSettings({ ...DEFAULTS, eps: LIMITS.eps.max }).ok);
  // Even at the largest promise and the largest noise allowed, k + eps <= THETA_BAR + 2 eps < 1.
  for (const r1 of [1.05, 1.22, 1.5, 1.95]) {
    const k = threshold({ ...P, r1 }, LIMITS.eps.max);
    assert.ok(k + LIMITS.eps.max < 1, `r1 ${r1}: k ${k}`);
  }
});

test("the finding at the opening noise of 2 points: 87.7% for the bank on the opening screen, and Diamond and Dybvig's contract fails the bank at every chance below 95%", () => {
  assert.equal((threshold(P, 0.02) * 100).toFixed(1), "87.7");
  const dd = { ...P, r1: 1.22 };
  const k = threshold(dd, 0.02);
  for (let theta = 0.5; theta < THETA_BAR - 1e-9; theta += 0.0025) assert.ok(noisyOutcome(theta, dd, 0.02, k).fails, `theta ${theta}`);
  assert.ok(!noisyOutcome(THETA_BAR, dd, 0.02, k).fails);
});

test("the finding: runs below 88.0% although the bank is sound above 77.4%; 75.0% if it promises only 1", () => {
  assert.equal((lowerBound(P) * 100).toFixed(1), "77.4");
  assert.equal((thresholdLimit(P) * 100).toFixed(1), "88.0");
  assert.equal((thresholdLimit({ ...P, r1: 1 }) * 100).toFixed(1), "75.0");
  assert.equal(ddOptimal(P).toFixed(2), "1.22");
  assert.equal(thresholdLimit({ ...P, r1: 1.22 }), THETA_BAR);
  // integrate() is exact for polynomials of degree up to 15 on each panel.
  close(integrate((x) => x ** 7, 0, 2, 1), 2 ** 8 / 8, 1e-12);
});
