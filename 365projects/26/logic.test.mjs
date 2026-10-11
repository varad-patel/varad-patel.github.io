import test from "node:test";
import assert from "node:assert/strict";
import { stats } from "../kit/kit.js";
import { MEAN, DEFAULTS, check, theory, intraclass, simulate, twinStudy, heritabilityCurve, twoSoils } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("theory, hand-computed: the plain genes, shared and non-shared model", () => {
  const t = theory({ va: 50, vc: 20, ve: 30, vi: 0, rge: 0 });
  close(t.vp, 100);
  close(t.h2, 0.5);
  close(t.rMZ, 0.7);             // (50 + 20) / 100
  close(t.rDZ, 0.45);            // (25 + 20) / 100
  close(t.falconer, 0.5);        // 2 (0.70 - 0.45)
  close(t.c2, 0.2);
  close(t.e2, 0.3);
  close(t.h2 + t.c2 + t.e2, 1);
});

test("theory: the twin method counts interaction as genes and the gene-environment covariance as shared environment", () => {
  // Interaction only: Falconer aims at (va + vi) / vp, not va / vp.
  const i = theory({ va: 50, vc: 20, ve: 30, vi: 30, rge: 0 });
  close(i.vp, 130);
  close(i.h2, 50 / 130);
  close(i.falconer, 80 / 130);
  close(i.c2, 20 / 130);
  // Correlation only: the covariance 2 r sqrt(va vc) lands in c2 and Falconer stays on va / vp.
  const r = theory({ va: 50, vc: 20, ve: 30, vi: 0, rge: 0.5 });
  const cov = 2 * 0.5 * Math.sqrt(1000);
  close(r.components.covariance, cov);
  close(r.vp, 100 + cov);
  close(r.falconer, 50 / (100 + cov));
  close(r.h2, r.falconer);
  close(r.c2, (20 + cov) / (100 + cov));
  // Both at once, for any settings: Falconer = (va + vi) / vp.
  for (const p of [{ va: 10, vc: 80, ve: 5, vi: 60, rge: 0.7 }, { va: 90, vc: 0, ve: 40, vi: 15, rge: 0.3 }]) {
    const t = theory(p);
    close(t.falconer, (p.va + p.vi) / t.vp, 1e-12);
    close(t.components.interaction, p.vi * (1 + p.rge ** 2));
    // The shared-environment estimate takes the covariance and the rge^2 part of the interaction.
    close(t.c2, (p.vc + t.components.covariance + p.rge ** 2 * p.vi) / t.vp, 1e-12);
    close(t.falconer + t.c2 + t.e2, 1, 1e-12);
  }
  // Written out from the covariances, not from the code's own shortcut: va 10, vc 80, ve 5, vi 60, rge 0.7.
  // cov = 2 (0.7) sqrt(800) = 39.598, interaction = 60 (1.49) = 89.4, vp = 95 + 89.4 + 39.598 = 223.998.
  const t = theory({ va: 10, vc: 80, ve: 5, vi: 60, rge: 0.7 });
  close(t.vp, 223.998, 0.001);
  close(t.rMZ, 218.998 / 223.998, 1e-5);                            // everything but ve
  close(t.rDZ, (5 + 80 + 39.598 + 60 * 0.99) / 223.998, 1e-5);      // half of va, all of vc and cov, vi (1/2 + rge^2)
  close(t.falconer, 70 / 223.998, 1e-5);
});

test("simulated populations have the variances the theory says, including with interaction and correlation", () => {
  for (const p of [{ va: 50, vc: 20, ve: 30, vi: 0, rge: 0 }, { va: 50, vc: 20, ve: 30, vi: 40, rge: 0.6 }, { va: 20, vc: 60, ve: 10, vi: 25, rge: 0.7 }]) {
    const t = theory(p), s = simulate({ ...p, pairs: 50000, seed: 11 });
    assert.equal(s.realised.n, 200000);
    close(s.realised.mean, MEAN, 0.15);
    for (const key of ["genes", "shared", "unique", "interaction", "covariance"]) close(s.realised[key], t.components[key], 0.02 * t.vp);
    close(s.realised.vp, t.vp, 0.02 * t.vp);
    close(s.realised.h2, t.h2, 0.01);
  }
});

test("simulated twin correlations match the theory, so Falconer's estimate lands where the algebra says", () => {
  for (const p of [{ va: 50, vc: 20, ve: 30, vi: 0, rge: 0 }, { va: 50, vc: 20, ve: 30, vi: 30, rge: 0 }, { va: 50, vc: 20, ve: 30, vi: 0, rge: 0.5 }, { va: 50, vc: 20, ve: 30, vi: 40, rge: 0.6 }]) {
    const t = theory(p);
    // Average over a few large studies to keep the tolerance tight.
    const runs = [1, 2, 3, 4].map((seed) => twinStudy(simulate({ ...p, pairs: 50000, seed })));
    const avg = (key) => stats.mean(runs.map((r) => r[key]));
    close(avg("rMZ"), t.rMZ, 0.006);
    close(avg("rDZ"), t.rDZ, 0.006);
    close(avg("h2"), t.falconer, 0.012);
    close(avg("c2"), t.c2, 0.012);
  }
  // With interaction the estimate is far from the true share of variance due to genes.
  const t = theory({ va: 50, vc: 20, ve: 30, vi: 30 });
  assert.ok(t.falconer - t.h2 > 0.2);
});

test("heritability moves with the environment while the genes stay put", () => {
  const at = (ve) => theory({ va: 50, vc: 0, ve }).h2;
  close(at(5), 50 / 55);
  close(at(50), 0.5);
  close(at(200), 0.2);
  const curve = heritabilityCurve({ va: 50, vc: 20, ve: 30 }, 200, 100);
  assert.equal(curve.length, 101);
  close(curve[0][1], 50 / 70);
  close(curve[100][1], 50 / 270);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i][1] < curve[i - 1][1]);
  // No genetic variance, no heritability, whatever the environment does.
  assert.ok(heritabilityCurve({ va: 0, vc: 10, ve: 10 }).every(([, h]) => h === 0));
});

test("intraclass correlation: hand-computed, and blind to which twin comes first", () => {
  // Pairs (1,2), (2,1), (4,5), (5,4): grand mean 3.
  const a = [1, 2, 4, 5], b = [2, 1, 5, 4];
  // Cross products: (-2)(-1) + (-1)(-2) + (1)(2) + (2)(1) = 8. Squares: 2 (4 + 1 + 1 + 4) = 20, halved is 10.
  close(intraclass(a, b), 8 / 10);
  close(intraclass(b, a), intraclass(a, b));
  close(intraclass([1, 2, 3], [1, 2, 3]), 1);
  assert.ok(Number.isNaN(intraclass([5, 5], [5, 5])));
  assert.ok(Number.isNaN(intraclass([1], [2])));
});

test("the standard error of Falconer's estimate matches the spread across repeated studies", () => {
  const estimates = [], ses = [];
  for (let seed = 1; seed <= 400; seed++) { const e = twinStudy(simulate({ ...DEFAULTS, pairs: 200, seed })); estimates.push(e.h2); ses.push(e.se); }
  close(stats.mean(estimates), 0.5, 0.02);
  const spread = stats.sd(estimates);
  close(stats.mean(ses) / spread, 1, 0.12);
  // More pairs, tighter estimate: the error falls with the square root of the sample.
  const big = twinStudy(simulate({ ...DEFAULTS, pairs: 5000, seed: 1 }));
  close(big.se / stats.mean(ses), Math.sqrt(200 / 5000), 0.02);
  close(big.hi - big.lo, 2 * 1.96 * big.se);
});

test("the numbers quoted under One finding", () => {
  assert.equal(theory(DEFAULTS).h2.toFixed(2), "0.50");
  assert.equal(theory({ ...DEFAULTS, vc: 0, ve: 5 }).h2.toFixed(2), "0.91");
  assert.equal(theory({ ...DEFAULTS, vc: 100, ve: 100 }).h2.toFixed(2), "0.20");
  const e = twinStudy(simulate(DEFAULTS));
  assert.equal(e.pairs, 500);
  assert.equal(e.h2.toFixed(2), "0.57");
  assert.equal(e.lo.toFixed(2), "0.40");
  assert.equal(e.hi.toFixed(2), "0.73");
  assert.equal(e.rMZ.toFixed(2), "0.71");
  assert.equal(e.rDZ.toFixed(2), "0.42");
});

test("two soils: the plants are identical whatever share of the gap is put down to the seed", () => {
  const none = twoSoils({ share: 0 }), half = twoSoils({ share: 0.5 }), all = twoSoils({ share: 1 });
  assert.deepEqual(none.poor.values, all.poor.values);
  assert.deepEqual(none.rich.values, half.rich.values);
  close(none.gap, 15, 0.5);
  close(none.gap, all.gap, 1e-9);
  // Heritability inside each field is the same too, and close to the 0.9 that was set.
  for (const s of [none, half, all]) { close(s.rich.h2, 0.9, 0.02); close(s.poor.h2, 0.9, 0.02); close(s.poor.h2, none.poor.h2, 1e-9); }
  // Only the hidden cause differs.
  close(none.geneticGap, 0, 1e-9);
  close(half.geneticGap, 7.5, 1e-9);
  close(all.geneticGap, 15, 1e-9);
});

test("simulation is reproducible and bad settings are refused with a reason", () => {
  assert.deepEqual(simulate(DEFAULTS).mz.a, simulate(DEFAULTS).mz.a);
  assert.notDeepEqual(simulate(DEFAULTS).mz.a, simulate({ ...DEFAULTS, seed: 27 }).mz.a);
  assert.equal(simulate(DEFAULTS).people.length, 5);
  assert.equal(check(DEFAULTS), null);
  assert.match(simulate({ va: 0, vc: 0, ve: 0, vi: 0 }).error, /no variation/);
  assert.match(simulate({ va: -1 }).error, /genetic variance/);
  assert.match(simulate({ ve: NaN }).error, /non-shared/);
  assert.match(simulate({ rge: 0.9 }).error, /correlation/);
  assert.match(simulate({ pairs: 5 }).error, /twin pairs/);
  assert.match(simulate({ pairs: 100.5 }).error, /twin pairs/);
  assert.match(simulate({ seed: -3 }).error, /seed/);
  assert.match(twoSoils({ h2: 1.2 }).error, /between 0 and 1/);
  assert.match(twoSoils({ gap: -1 }).error, /gap/);
  assert.match(twoSoils({ share: 2 }).error, /share/);
  assert.match(twoSoils({ n: 3 }).error, /plants/);
});

test("edge cases: no genes, no unique environment, and the largest allowed correlation", () => {
  // No genetic variance: identical and fraternal twins are equally alike and Falconer is near zero.
  const flat = twinStudy(simulate({ va: 0, vc: 50, ve: 50, pairs: 20000, seed: 2 }));
  close(flat.h2, 0, 0.04);
  close(flat.rMZ, 0.5, 0.02);
  // No unique environment: identical twins match exactly.
  const same = twinStudy(simulate({ va: 60, vc: 40, ve: 0, pairs: 300, seed: 2 }));
  close(same.rMZ, 1, 1e-12);
  close(same.e2, 0, 1e-12);
  // The top of the correlation range still gives a valid population.
  const top = simulate({ va: 50, vc: 50, ve: 10, rge: 0.7, pairs: 20000, seed: 5 });
  close(top.realised.covariance, 2 * 0.7 * 50, 2);
  assert.ok(Number.isFinite(twinStudy(top).h2));
});
