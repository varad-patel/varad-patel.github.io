import test from "node:test";
import assert from "node:assert/strict";
import { stats } from "../kit/kit.js";
import { ELECTIONS as E } from "../data/elections.js";
import { BASE_YEARS, DEFAULTS, base, swung, tally, popular, winner, tippingPoint, uniformThresholds, simulator, shares, evQuantiles, checkSwing } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const ix = (u) => E.units.indexOf(u);
const run = (year, swings = {}, o = {}) => {
  const b = base(E, year), opts = { ...DEFAULTS, ...o };
  const sim = simulator(b, swings, opts);
  sim.run(opts.sims);
  return { b, sim, s: shares(sim) };
};

test("source figures: the base maps reproduce the certified results", () => {
  // FEC: 2024 Harris 75,017,613, Trump 77,302,580 and 226 to 312 electoral votes; 2012 Obama 332, Romney 206.
  const b24 = base(E, 2024);
  close(popular(b24, swung(b24)), (100 * 75017613) / (75017613 + 77302580), 1e-9);
  assert.deepEqual(tally(b24, swung(b24)), { evD: 226, evR: 312, open: 0 });
  assert.deepEqual(tally(base(E, 2012), swung(base(E, 2012))), { evD: 332, evR: 206, open: 0 });
  assert.deepEqual(tally(base(E, 2020), swung(base(E, 2020))), { evD: 306, evR: 232, open: 0 });
  // 2016 counts pledged electors: 232 to 306 (the FEC's 227 to 304 as cast plus seven faithless votes).
  assert.deepEqual(tally(base(E, 2016), swung(base(E, 2016))), { evD: 232, evR: 306, open: 0 });
  assert.deepEqual(E.results["2016"].evWon, [227, 304]);
  // Census apportionment: Texas 40 and California 54 electoral votes in 2024, 38 and 55 before.
  assert.equal(b24.ev[ix("TX")], 40);
  assert.equal(base(E, 2020).ev[ix("CA")], 55);
  for (const y of BASE_YEARS) assert.equal(base(E, y).ev.reduce((a, c) => a + c, 0), 538);
  assert.throws(() => base(E, 2008), /no full results/);
});

test("Maine and Nebraska: the district rule against winner-take-all", () => {
  for (const [y, on, off] of [[2016, [232, 306], [233, 305]], [2020, [306, 232], [306, 232]], [2024, [226, 312], [226, 312]], [2012, [332, 206], [332, 206]]]) {
    const b = base(E, y), s = swung(b);
    const a = tally(b, s, true), c = tally(b, s, false);
    assert.deepEqual([a.evD, a.evR], on, `${y} with districts`);
    assert.deepEqual([c.evD, c.evR], off, `${y} winner-take-all`);
  }
  // In 2020 Biden won NE-2 and Trump ME-2; in 2024 Harris NE-2 and Trump ME-2.
  const s20 = swung(base(E, 2020));
  assert.ok(s20[ix("NE-2")] > 50 && s20[ix("ME-2")] < 50);
});

test("swings: national, regional, a state with its districts, a district alone, and the limits", () => {
  const b = base(E, 2024);
  const s = swung(b, { national: 1 });
  b.share.forEach((v, i) => close(s[i], v + 1, 1e-12));
  const r = swung(b, { regions: [0, 2, 0, 0] }); // Midwest: Nebraska and its districts move, Maine does not
  close(r[ix("NE-2")] - b.share[ix("NE-2")], 2, 1e-12);
  close(r[ix("WI")] - b.share[ix("WI")], 2, 1e-12);
  close(r[ix("ME-2")] - b.share[ix("ME-2")], 0, 1e-12);
  const o = swung(b, { overrides: new Map([[ix("NE"), -1], [ix("NE-2"), 3]]) });
  close(o[ix("NE")] - b.share[ix("NE")], -1, 1e-12);
  close(o[ix("NE-1")] - b.share[ix("NE-1")], -1, 1e-12);
  close(o[ix("NE-2")] - b.share[ix("NE-2")], 2, 1e-12);
  const big = swung(b, { national: 15, regions: [10, 0, 10, 0], overrides: new Map([[ix("DC"), 15]]) });
  assert.equal(big[ix("DC")], 100);
  assert.ok(big.every((v) => v >= 0 && v <= 100));
  assert.ok(checkSwing(3) && checkSwing(-15) && !checkSwing(15.1) && !checkSwing(NaN) && !checkSwing(Infinity));
});

test("a contest at exactly 50% goes to neither side", () => {
  const b = base(E, 2024), s = swung(b);
  s[ix("PA")] = 50;
  const t = tally(b, s);
  assert.equal(t.open, 19);
  assert.equal(t.evD + t.evR + t.open, 538);
  assert.equal(winner({ evD: 269, evR: 269, open: 0 }), "none");
  assert.equal(winner({ evD: 270, evR: 268, open: 0 }), "D");
  assert.equal(winner({ evD: 250, evR: 270, open: 18 }), "R");
});

test("tipping point and uniform-swing thresholds, checked by swinging", () => {
  const b = base(E, 2020), s = swung(b);
  const tp = tippingPoint(b, s);
  assert.equal(E.units[tp.unit], "WI");
  close(tp.bias, tp.share - popular(b, s), 1e-12);
  // Separate count: rank by share, add electoral votes until 270.
  const order = E.units.map((_, i) => i).sort((x, y) => s[y] - s[x]);
  let c = 0, k = 0;
  while (c < 270) c += b.ev[order[k++]];
  assert.equal(order[k - 1], tp.unit);
  const th = uniformThresholds(b, s);
  assert.equal(th.tie, true);
  const at = (nat) => tally(b, swung(b, { national: nat - th.national }));
  assert.equal(at(th.demAt + 0.001).evD >= 270, true);
  assert.equal(at(th.demAt - 0.001).evD, 269);
  assert.equal(at((th.demAt + th.repAt) / 2).evD, 269);
  assert.equal(at(th.repAt - 0.001).evR >= 270, true);
  // 2024: no tie range; 2012 runs the other way.
  const t24 = uniformThresholds(base(E, 2024), swung(base(E, 2024)));
  assert.equal(t24.tie, false);
  const t12 = uniformThresholds(base(E, 2012), swung(base(E, 2012)));
  assert.ok(t12.demAt < 50);
  assert.equal(E.units[tippingPoint(base(E, 2024), swung(base(E, 2024))).unit], "PA");
});

test("with no randomness the simulation is the single election", () => {
  const { sim, s } = run(2016, {}, { natSd: 0, stateSd: 0, sims: 10 });
  assert.equal(s.winR, 1);
  assert.equal(s.popD, 1);
  assert.equal(s.invDR, 1);
  assert.equal(s.inversion, 1);
  assert.deepEqual(evQuantiles(sim), { lo: 232, median: 232, hi: 232 });
  const t = run(2024, {}, { natSd: 0, stateSd: 0, sims: 5 }).s;
  assert.equal(t.inversion, 0);
  assert.equal(t.winR, 1);
});

test("a unit's simulated chance matches the normal formula", () => {
  const { b, sim } = run(2024, { national: 0.5 }, { natSd: 2, stateSd: 2, sims: 40000, seed: 3 });
  const center = swung(b, { national: 0.5 });
  for (const u of ["PA", "GA", "MN", "TX"]) {
    const i = ix(u);
    close(sim.unitD[i] / sim.done, stats.normalCdf((center[i] - 50) / Math.sqrt(8)), 0.01);
  }
  const i = ix("NE-2");
  close(sim.unitD[i] / sim.done, stats.normalCdf((center[i] - 50) / Math.sqrt(8 + 1)), 0.01);
});

test("counts add up, and inversions are counted only against the electoral winner", () => {
  const { sim, s } = run(2020, {}, { sims: 20000 });
  assert.equal(sim.winD + sim.winR + sim.none, sim.done);
  assert.equal(sim.evHist.reduce((a, c) => a + c, 0), sim.done);
  assert.ok(sim.invDR + sim.invRD + sim.noneAfterPopD + sim.noneAfterPopR <= sim.done);
  close(s.inversion, s.invDR + s.invRD, 1e-12);
  const inBins = sim.marginBins.reduce((a, b) => a + b.inv, 0);
  assert.ok(inBins <= sim.invDR + sim.invRD);
  // Close popular votes are where inversions happen: within a point of a tie they are far more common than beyond 5.
  const near = sim.marginBins.filter((b) => b.lo >= -1 && b.hi <= 1), far = sim.marginBins.filter((b) => b.lo >= 5 || b.hi <= -5);
  const rate = (bs) => bs.reduce((a, b) => a + b.inv, 0) / Math.max(1, bs.reduce((a, b) => a + b.n, 0));
  assert.ok(rate(near) > 10 * rate(far));
});

test("the finding: the inversion window under uniform swing, and the default simulation", () => {
  const t20 = uniformThresholds(base(E, 2020), swung(base(E, 2020)));
  assert.equal(t20.demAt.toFixed(2), "51.95");
  assert.equal(t20.repAt.toFixed(2), "51.68");
  assert.equal((2 * (t20.demAt - 50)).toFixed(1), "3.9");
  const t24 = uniformThresholds(base(E, 2024), swung(base(E, 2024)));
  assert.equal(t24.demAt.toFixed(2), "50.11");
  const t16 = uniformThresholds(base(E, 2016), swung(base(E, 2016)));
  assert.equal(t16.demAt.toFixed(2), "51.52");
  assert.equal(popular(base(E, 2016), swung(base(E, 2016))).toFixed(2), "51.11");
  const t12 = uniformThresholds(base(E, 2012), swung(base(E, 2012)));
  assert.equal(t12.demAt.toFixed(2), "49.23");
  // Default settings, 20,000 elections, seed 1.
  assert.equal(run(2024).s.inversion.toFixed(3), "0.122");
  assert.equal(run(2020).s.inversion.toFixed(3), "0.219");
});

test("the uniform-swing windows agree with a recomputation outside the page (review)", () => {
  // Recomputed with numpy from the FEC tables and the certificates' district counts, not with this code:
  // 2020 Biden wins above 51.9508 and Trump has 270 below 51.6806 (the same with winner-take-all in Maine and
  // Nebraska); 2016 51.5213; 2012 49.2319; 2024 50.1131.
  const at = (y, rule = true) => uniformThresholds(base(E, y), swung(base(E, y)), rule);
  close(at(2020).demAt, 51.9508, 1e-4);
  close(at(2020).repAt, 51.6806, 1e-4);
  close(at(2020, false).demAt, 51.9508, 1e-4);
  close(at(2020, false).repAt, 51.6806, 1e-4);
  close(at(2016).demAt, 51.5213, 1e-4);
  close(at(2012).demAt, 49.2319, 1e-4);
  close(at(2024).demAt, 50.1131, 1e-4);
  // 200,000 numpy simulations with the default uncertainty: inversions in 21.8% (2020) and 12.3% (2024).
  close(run(2020).s.inversion, 0.218, 0.006);
  close(run(2024).s.inversion, 0.1226, 0.005);
});
