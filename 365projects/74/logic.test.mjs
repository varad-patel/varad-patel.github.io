import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  GALI, slope, TARGET, neutralRate, welfareWeight, eig2, system, determinacyIndex, determinacy, msv, monetaryClosedForm, impulse,
  sunspot, msvDenominator, SHOCKS, EXPECTED_RULE, QUARTERS, shockPath, quarter, rateEffect, loss, RATE, toStep, bestRate, ruleRate, STRATEGIES,
  play, verdict, inferShocks,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("the Phillips curve slope from Galí's calibration, by hand", () => {
  // Theta = 0.75 / (0.75 + 0.25 x 9) = 0.25; lambda = 0.25 x 0.2575 / 0.75 x 0.25 = 0.021458...; kappa = lambda (1 + 5.25 / 0.75) = 8 lambda.
  const { lambda, kappa } = slope();
  close(lambda, (0.25 * (1 - 0.99 * 0.75)) / 0.75 * 0.25, 1e-15);
  close(kappa, 8 * lambda, 1e-15);
  close(kappa, 0.17166666666666666, 1e-12);
  close(neutralRate(), 2 - 400 * Math.log(0.99), 1e-12);
  close(neutralRate(), 6.0201, 1e-4);
  close(welfareWeight(), (16 * kappa) / 9, 1e-15);
  close(welfareWeight(), 0.30519, 1e-5);
});

test("the system matrices are Galí's A_T and B_T", () => {
  const { A, B, kappa } = system(EXPECTED_RULE);
  const O = 1 / (1 + 0.125 + kappa * 1.5);
  close(A[0][0], O); close(A[0][1], O * (1 - 0.99 * 1.5)); close(A[1][0], O * kappa); close(A[1][1], O * (kappa + 0.99 * 1.125));
  close(B.r[0], O); close(B.r[1], O * kappa);
  // A cost-push shock enters the Phillips curve; substituting the rule into the IS curve gives Omega (-phiPi, sigma + phiY).
  close(B.u[0], -O * 1.5); close(B.u[1], O * 1.125);
});

test("known result: the response to a monetary policy shock under a Taylor rule (Galí's closed form)", () => {
  const rule = { phiPi: 1.5, phiY: 0.125 };
  const cf = monetaryClosedForm(rule, 0.5);
  const [y, pi] = msv(rule, "v", 0.5);
  close(y, cf.y, 1e-12); close(pi, cf.pi, 1e-12);
  // Lambda_v = 1 / ((1 - 0.495)(0.5 + 0.125) + kappa (1.5 - 0.5)).
  const L = 1 / (0.505 * 0.625 + slope().kappa);
  close(cf.y, -0.505 * L, 1e-12);
  // A 25 basis point shock (1 point a year): the output gap falls 0.26%, annual inflation 0.35 points, and the rate rises only 0.34 points.
  const first = impulse(rule, "v", 0.5, 0.25)[0];
  close(first.y, -0.2591, 1e-4);
  close(first.pi, -0.3523, 1e-4);
  close(first.i, 0.3420, 1e-4);
  // Each quarter the response shrinks by rho.
  const path = impulse(rule, "v", 0.5, 0.25, 6);
  for (let t = 1; t < 6; t++) close(path[t].y / path[t - 1].y, 0.5, 1e-12);
});

test("the model's equations hold along every computed path", () => {
  const p = GALI, { kappa } = slope();
  for (const [shock, rho] of [["r", 0.8], ["u", 0.5], ["v", 0.5]]) {
    const path = impulse(EXPECTED_RULE, shock, rho, 0.25, 8);
    for (let t = 0; t < 7; t++) {
      const now = path[t], next = path[t + 1];
      const s = 0.25 * rho ** t;
      const y = now.y, pi = now.pi / 4, i = now.i / 4, Ey = next.y, Epi = next.pi / 4;
      const r = shock === "r" ? s : 0, u = shock === "u" ? s : 0;
      close(y, Ey - (i - Epi - r) / p.sigma, 1e-12); // dynamic IS
      close(pi, p.beta * Epi + kappa * y + u, 1e-12); // Phillips curve
    }
  }
});

test("known result: the Taylor principle; demand shocks raise the real rate, cost-push shocks force a trade-off", () => {
  const up = impulse(EXPECTED_RULE, "r", 0.8, 0.25)[0];
  assert.ok(up.y > 0 && up.pi > 0);
  assert.ok(up.i > up.pi, "the nominal rate rises by more than inflation"); // i = 1.5 pi + 0.5 y
  const cost = impulse(EXPECTED_RULE, "u", 0.5, 0.25)[0];
  assert.ok(cost.pi > 0 && cost.y < 0, "a cost-push shock raises inflation and lowers output");
});

test("determinacy: the eigenvalue test agrees with Bullard and Mitra's condition across a grid", () => {
  let checked = 0;
  for (let phiPi = 0; phiPi <= 3; phiPi += 0.05) for (let phiY = 0; phiY <= 1; phiY += 0.025) {
    const rule = { phiPi, phiY };
    const idx = determinacyIndex(rule);
    if (Math.abs(idx) < 1e-6) continue; // on the boundary an eigenvalue sits on the unit circle
    assert.equal(determinacy(rule).unique, idx > 0, `phiPi ${phiPi} phiY ${phiY}`);
    checked++;
  }
  assert.ok(checked > 2000);
  assert.equal(determinacy({ phiPi: 1.5, phiY: 0.125 }).unique, true);
  assert.equal(determinacy({ phiPi: 0.8, phiY: 0 }).unique, false);
  // With phiY = 0.125 the boundary is phiPi = 1 - 0.01 x 0.125 / kappa = 0.99272...
  const edge = 1 - (0.01 * 0.125) / slope().kappa;
  assert.equal(determinacy({ phiPi: edge + 1e-4, phiY: 0.125 }).unique, true);
  assert.equal(determinacy({ phiPi: edge - 1e-4, phiY: 0.125 }).unique, false);
});

test("known result: without the Taylor principle a belief alone is an equilibrium (a sunspot)", () => {
  const rule = { phiPi: 0.8, phiY: 0 };
  const ss = sunspot(rule, 20);
  assert.ok(ss && Math.abs(ss.mu) < 1);
  close(ss.path[0].pi, 1, 1e-12);
  const { A } = system(rule);
  // z_t = A z_{t+1}: the path satisfies the model with no shock at all, and fades away.
  for (let t = 0; t < 19; t++) {
    const z = [ss.path[t].y, ss.path[t].pi / 4], n = [ss.path[t + 1].y, ss.path[t + 1].pi / 4];
    close(z[0], A[0][0] * n[0] + A[0][1] * n[1], 1e-12);
    close(z[1], A[1][0] * n[0] + A[1][1] * n[1], 1e-12);
  }
  assert.ok(Math.abs(ss.path[19].pi) < Math.abs(ss.path[0].pi));
  assert.equal(sunspot(EXPECTED_RULE), null);
  // eig2 handles complex pairs.
  const ev = eig2([[0, -1], [1, 0]]);
  close(ev[0].re, 0); close(Math.abs(ev[0].im), 1);
});

test("the game's quarter: following the rule reproduces the equilibrium, and a higher rate cools the economy", () => {
  const s = { r: 0.2, u: -0.05 };
  const at = quarter(ruleRate(s), s);
  close(at.v, 0, 1e-12);
  const [yr, pir] = msv(EXPECTED_RULE, "r", SHOCKS.r.rho), [yu, piu] = msv(EXPECTED_RULE, "u", SHOCKS.u.rho);
  close(at.gap, yr * s.r + yu * s.u, 1e-12);
  close(at.inflation, TARGET + 4 * (pir * s.r + piu * s.u), 1e-12);
  const e = rateEffect();
  assert.ok(e.inflation < 0 && e.gap < 0);
  close(e.inflation, -1.03, 0.005);
  close(e.gap, -0.7575, 0.0005);
  // Linear: two points do twice what one does.
  const a = quarter(5, s), b = quarter(7, s);
  close(b.inflation - a.inflation, 2 * e.inflation, 1e-12);
  // In steady state at the neutral rate nothing moves.
  const calm = quarter(neutralRate(), { r: 0, u: 0 });
  close(calm.inflation, TARGET, 1e-12); close(calm.gap, 0, 1e-12);
});

test("last quarter's shocks can be read back from its figures", () => {
  const path = shockPath(5);
  for (const [k, s] of path.entries()) {
    const o = quarter(4 + k * 0.25, s);
    const back = inferShocks(o);
    close(back.r, s.r, 1e-10); close(back.u, s.u, 1e-10);
  }
});

test("loss and the score by hand", () => {
  close(loss({ inflation: 3, gap: 1 }), 1 + welfareWeight());
  close(loss({ inflation: 2, gap: 0 }), 0);
  close(loss({ inflation: 0, gap: -2 }, 0.5), 4 + 2);
  assert.equal(toStep(6.0201), 6);
  assert.equal(toStep(6.13), 6.25);
  assert.equal(toStep(-3), 0);
  assert.equal(toStep(99), 12);
  assert.equal(RATE.step, 0.25);
  const v = verdict(1.5, { a: { average: 2 }, b: { average: 1.5 }, c: { average: 1 } });
  assert.deepEqual(v.beaten, ["a"]);
  assert.deepEqual(v.tied, ["b"]);
});

test("the best rate minimises the expected loss, and beats nearby rates on average", () => {
  const prev = { r: 0.15, u: 0.08 };
  const exp = { r: SHOCKS.r.rho * prev.r, u: SHOCKS.u.rho * prev.u };
  const b = bestRate(prev);
  let best = Infinity, arg = null;
  for (let x = 0; x <= 12; x += 0.001) { const l = loss(quarter(x, exp)); if (l < best) { best = l; arg = x; } }
  close(arg, b, 0.001);
  // With this quarter's surprises drawn at random, the expected loss is lowest at bestRate (certainty equivalence).
  const g = rng(11);
  const draws = Array.from({ length: 20000 }, () => ({ r: exp.r + g.normal(0, SHOCKS.r.sd), u: exp.u + g.normal(0, SHOCKS.u.sd) }));
  const avg = (x) => draws.reduce((s, d) => s + loss(quarter(x, d)), 0) / draws.length;
  assert.ok(avg(b) < avg(b + 0.25) && avg(b) < avg(b - 0.25));
});

test("shocks are reproducible from the seed", () => {
  const a = shockPath(7), b = shockPath(7), c = shockPath(8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, QUARTERS);
});

test("play: a whole game with each strategy", () => {
  const path = shockPath(3);
  const n = play(path, "neutral");
  assert.equal(n.rows.length, 16);
  assert.ok(n.rows.every((r) => r.rate === 6));
  close(n.average, n.rows.reduce((s, r) => s + loss(r), 0) / 16, 1e-12);
  const r = play(path, "rule");
  assert.ok(r.rows.every((q) => Math.abs(q.v) < 1e-12));
  // A custom strategy: always 7%.
  const seven = play(path, () => 7);
  assert.ok(seven.rows.every((q) => q.rate === 7));
  assert.ok(Object.keys(STRATEGIES).length === 3);
});

test("the finding on the page: 2,000 games", () => {
  const sum = { neutral: 0, best: 0, rule: 0 };
  for (let seed = 1; seed <= 2000; seed++) {
    const path = shockPath(seed);
    for (const k of Object.keys(sum)) sum[k] += play(path, k).average / 2000;
  }
  assert.equal(sum.neutral.toFixed(2), "3.34");
  assert.equal(sum.best.toFixed(2), "1.62");
  assert.equal(sum.rule.toFixed(2), "0.47");
});

test("the finding on the page: the opening shocks, number 2026", () => {
  // Recomputed independently in the review with Galí's closed forms: 6.4698, 2.0692, 0.8837; holding 7% gives 3.3115.
  const path = shockPath(2026);
  assert.equal(play(path, "neutral").average.toFixed(2), "6.47");
  assert.equal(play(path, "best").average.toFixed(2), "2.07");
  assert.equal(play(path, "rule").average.toFixed(2), "0.88");
  assert.equal(play(path, () => 7).average.toFixed(2), "3.31");
});

test("the lab: no simplest solution when the shock fades at the rate of the self-fulfilling path", () => {
  // phiPi 0.3, phiX 0.2 (phiY 0.05), rho 0.75: (1 - 0.7425)(0.25 + 0.05) + kappa (0.3 - 0.75) = 0.07725 - 0.07725 = 0.
  const rule = { phiPi: 0.3, phiY: 0.05 };
  assert.ok(Math.abs(msvDenominator(rule, 0.75).value) < 1e-12);
  for (const shock of ["r", "u", "v"]) assert.equal(impulse(rule, shock, 0.75), null);
  // The self-fulfilling path decays at exactly that rate, the reciprocal of A's unstable root.
  close(sunspot(rule).mu, 0.75, 1e-12);
  // Nearby the solution exists and is finite, and det(I - rho A) = Omega x the denominator.
  const near = impulse(rule, "v", 0.7);
  assert.ok(near && near.every((q) => Number.isFinite(q.y) && Number.isFinite(q.pi)));
  const { A } = system(rule), rho = 0.7, O = 1 / (1 + 0.05 + slope().kappa * 0.3);
  const det = (1 - rho * A[0][0]) * (1 - rho * A[1][1]) - rho * rho * A[0][1] * A[1][0];
  close(det, O * msvDenominator(rule, rho).value, 1e-12);
  // Under a determinate rule the denominator never vanishes on the lab's grid.
  for (let a = 0; a <= 60; a++) for (let b = 0; b <= 40; b++) for (let c = 0; c <= 19; c++) {
    const r = { phiPi: a * 0.05, phiY: (b * 0.05) / 4 };
    if (determinacy(r).unique) assert.ok(msvDenominator(r, c * 0.05).value > 0);
  }
});
