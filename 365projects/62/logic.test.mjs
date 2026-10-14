import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { TSX } from "./data.js";
import {
  QS, MIN_RETURNS, invNorm, pNormal, smmCritical, smmP, varianceRatio, chowDenning, toLogs, testWalk, vrCurve,
  autocorr1, simulateWalk, sizeCheck, chanceLimit, monthLabel, lastKey, span,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const series = (id) => TSX.series.find((s) => s.id === id);
const at = (id, key) => { const s = series(id); const [y, m] = key.split("-").map(Number), [y0, m0] = s.start.split("-").map(Number); return s.values[(y - y0) * 12 + (m - m0)]; };

/* ------------------------------------------------------------- the normal distribution */

test("the normal quantile (AS 241) matches published values", () => {
  close(invNorm(0.975), 1.959963984540054, 1e-15);
  close(invNorm(0.9), 1.2815515655446004, 1e-15);
  close(invNorm(0.999), 3.090232306167813, 1e-15);
  close(invNorm(1e-10), -6.361340902404056, 1e-13);
  close(invNorm(0.3), -0.5244005127080407, 1e-15);
  assert.equal(invNorm(0.5), 0);
  close(invNorm(0.025), -invNorm(0.975), 1e-15);
  assert.throws(() => invNorm(0), /strictly between/);
  assert.throws(() => invNorm(1), /strictly between/);
  close(pNormal(1.959963984540054), 0.05, 2e-7);
});

test("the studentised maximum modulus for four horizons: 2.49 at 5%, and P(max |Z| <= c) = (2 Phi(c) - 1)^4 by simulation", () => {
  close(smmCritical(0.05, 4), 2.4909, 0.0001);
  close(smmCritical(0.05, 1), 1.959963984540054, 1e-12); // one horizon: the ordinary two-sided test
  close(smmP(smmCritical(0.05, 4), 4), 0.05, 1e-6);
  assert.ok(smmCritical(0.01, 4) > smmCritical(0.05, 4));
  // The largest |Z| of four independent standard normals passes 2.4909 about 5% of the time.
  const r = rng(1993);
  let over = 0;
  for (let i = 0; i < 200000; i++) if (Math.max(Math.abs(r.normal()), Math.abs(r.normal()), Math.abs(r.normal()), Math.abs(r.normal())) > smmCritical(0.05, 4)) over++;
  close(over / 200000, 0.05, 0.002);
});

/* ------------------------------------------------------------- the variance ratio */

test("the variance ratio by hand: a zigzag and a step", () => {
  // p = 0, 1, 1, 2, 2: changes 1, 0, 1, 0, mean 0.5, deviations +-0.5. Every 2-month change equals 2 x 0.5, so VR(2) = 0.
  const a = varianceRatio(Float64Array.of(0, 1, 1, 2, 2), 2);
  assert.equal(a.vr, 0);
  close(a.z, -2, 1e-12);                     // sqrt(2 x 3 x 1 / (3 x 2 x 4)) = 0.5
  close(a.zStar, -1 / Math.sqrt(0.75 / 4), 1e-12); // delta(1) = 4 x 3 x 0.0625 = 0.75, theta(2) = 0.75
  // p = 0, 1, 2, 2, 2: 2-month changes less 1 are 1, 0, -1, so sc2 = 2 / 3 and sa2 = 1 / 3: VR(2) = 2.
  const b = varianceRatio(Float64Array.of(0, 1, 2, 2, 2), 2);
  close(b.vr, 2, 1e-12); close(b.z, 2, 1e-12); close(b.zStar, 1 / Math.sqrt(0.75 / 4), 1e-12);
  assert.throws(() => varianceRatio(Float64Array.of(0, 1, 2), 2), /at least 4 monthly changes/);
  assert.throws(() => varianceRatio(Float64Array.of(0, 1, 2, 3, 4), 2), /never vary/);
  assert.throws(() => varianceRatio(Float64Array.of(0, 1, 2, 3, 4), 1), /q must be/);
});

test("on simulated random walks the joint test rejects about 5% of the time; with volatility spells only z* keeps to 5%", () => {
  const plain = sizeCheck(812, 0.045, 1000, rng(62));
  assert.deepEqual(plain, { reps: 1000, robust: 46, iid: 45 });
  const spells = sizeCheck(812, 0.045, 1000, rng(62), { spells: true });
  assert.deepEqual(spells, { reps: 1000, robust: 44, iid: 90 });
  // The yardstick the panel uses: Binomial(1000, 0.05) has P(X <= 64) = 0.9793 >= 0.975 > P(X <= 63) = 0.9716 (scipy).
  assert.equal(chanceLimit(1000), 64);
  // At the shortest span the tool accepts, z* itself rejects too often, and the panel must say so, not praise it.
  const short = sizeCheck(64, 0.045, 1000, rng(62));
  assert.deepEqual(short, { reps: 1000, robust: 76, iid: 63 });
  assert.ok(short.robust > chanceLimit(1000));
});

test("the test finds changes that continue, and VR(2) is about 1 + rho for autocorrelation rho", () => {
  const r = rng(3);
  let e = 0;
  const p = new Float64Array(2001);
  for (let k = 1; k <= 2000; k++) { e = 0.3 * e + r.normal(0, 0.04); p[k] = p[k - 1] + e; }
  const t = testWalk(p);
  assert.ok(t.joint.reject); assert.equal(t.joint.direction, "continue");
  close(t.ratios[0].vr, 1.3, 0.06);
  close(autocorr1(p), 0.3, 0.05);
});

test("Chow-Denning: the largest |z*| decides, and a value exactly at the critical value does not reject", () => {
  const c = smmCritical(0.05, 4);
  const fake = (zs) => zs.map((z, i) => ({ q: QS[i], vr: 1 + z / 10, z, zStar: z }));
  const edge = chowDenning(fake([0.5, -c, 1, 0]));
  assert.equal(edge.maxAbs, c); assert.equal(edge.at, 4); assert.equal(edge.reject, false); assert.equal(edge.direction, "reverse");
  const over = chowDenning(fake([0.5, -(c + 1e-9), 1, 0]));
  assert.equal(over.reject, true);
  assert.equal(chowDenning(fake([2.6, 0, 0, 0])).direction, "continue");
});

test("too short a span is refused with a reason, and the VR curve has its pointwise band", () => {
  const t = testWalk(new Float64Array(50).map((_, i) => Math.sin(i)));
  assert.match(t.error, /at least 64 monthly changes/);
  assert.equal(MIN_RETURNS, 64);
  assert.match(testWalk(Float64Array.from({ length: 80 }, (_, i) => i / 2)).error, /^The monthly changes never vary/);
  const curve = vrCurve(span(series("composite"), 1900, 2100).p);
  assert.equal(curve.length, 24);
  assert.deepEqual(curve[0], { q: 1, vr: 1, lo: 1, hi: 1 });
  assert.ok(curve.every((c) => c.lo <= 1 && c.hi >= 1));
  assert.throws(() => toLogs([1, -2]), /price 2/);
});

/* ------------------------------------------------------------- data */

test("the bundled closes match Statistics Canada's table", () => {
  // Table 10-10-0125-01, downloaded 14 October 2026.
  assert.equal(at("composite", "1956-01"), 525.63);
  assert.equal(at("composite", "2000-08"), 11247.91);
  assert.equal(at("composite", "2022-12"), 19384.92);
  assert.equal(at("composite", "2023-09"), 19541.27);
  assert.equal(TSX.series.length, 21);
  assert.equal(lastKey(series("composite")), "2023-09");
  assert.equal(series("t35").start, "1987-05");
  assert.equal(lastKey(series("t35")), "2003-08");
  assert.equal(lastKey(series("mining")), "2016-07");
  assert.ok(TSX.series.every((s) => s.values.every((v) => v > 0)));
  assert.equal(TSX.source.licence, "Statistics Canada Open Licence");
  // Month-end closes, not monthly averages: averaging a random walk would put the first autocorrelation near 0.25.
  assert.ok(Math.abs(autocorr1(span(series("composite"), 1900, 2100).p)) < 0.15);
});

test("spans of years and month labels", () => {
  const s = span(series("composite"), 2000, 2009);
  assert.equal(s.p.length, 120);
  assert.equal(monthLabel(series("composite").start, s.first), "Jan 2000");
  assert.equal(monthLabel(series("composite").start, s.last), "Dec 2009");
  const clip = span(series("composite"), 1900, 2100);
  assert.equal(clip.p.length, 813);
  assert.equal(span(series("t35"), 2010, 2020).p.length, 0);
});

/* ------------------------------------------------------------- the finding */

test("One finding: the S&P/TSX Composite, 1956 to 2023", () => {
  const t = testWalk(span(series("composite"), 1900, 2100).p);
  assert.equal(t.N, 812);
  const two = t.ratios[0];
  assert.equal(two.vr.toFixed(3), "1.095");
  assert.equal(two.zStar.toFixed(2), "2.15");
  close(two.pZStar, 0.031, 0.0005);
  assert.equal(two.z.toFixed(2), "2.71");
  assert.equal(t.joint.at, 2);
  assert.equal(t.joint.reject, false);
  close(t.joint.p, 0.120, 0.0005);
  assert.equal(t.jointIid.reject, true);
});

test("every index in the list: four of 21 reject at 5%, none after allowing for 21 tests", () => {
  const all = TSX.series.map((s) => ({ id: s.id, t: testWalk(span(s, 1900, 2100).p) }));
  const rejected = all.filter((x) => x.t.joint.reject).map((x) => x.id);
  assert.deepEqual(rejected, ["utilities_old", "merch", "finance_old", "telecom"]);
  assert.ok(all.filter((x) => x.t.joint.reject).every((x) => x.t.joint.direction === "continue"));
  assert.equal(all.filter((x) => x.t.joint.p < 0.05 / 21).length, 0);
  close(Math.min(...all.map((x) => x.t.joint.p)), 0.004, 0.0005);
  close(21 * 0.05, 1.05, 1e-12);
});
