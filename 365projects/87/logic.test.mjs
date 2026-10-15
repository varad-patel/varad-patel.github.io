import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { ELECTIONS as E } from "../data/elections.js";
import {
  ERROR_YEARS, WEEKS, DEFAULTS, twoParty, samplingVar, nationalShare, pollRows, pollsterCounts, sampler, invGamma, gammaDraw, summary,
  lean, unitEstimates, simulate, fakeRows, recovery, stateErrors, gammaP, chiSquareQuantile, errorStructure, persistence,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const fit = (year, o = {}) => {
  const data = pollRows(E, year, o);
  const s = sampler(data, { sweeps: DEFAULTS.sweeps, burn: DEFAULTS.burn, seed: DEFAULTS.seed, ...o });
  s.step(s.sweeps);
  return { data, s, sum: summary(s) };
};
const byName = (name) => E.polls.pollsters.findIndex((p) => p[1] === name);
const polledMiss = (year, sum) => {
  const res = E.results[String(year)];
  return stats.mean(sum.level.filter((l) => l.place < 51).map((l) => l.mean - twoParty(res.d[l.place], res.r[l.place])));
};

test("source figures: FEC 2004 and 2008 state results, and a 538 poll", () => {
  const ix = (u) => E.units.indexOf(u);
  // FEC, Federal Elections 2004, Table 2: California, Kerry 6,745,485 and Bush 5,509,826; national 59,028,444 and 62,040,610.
  assert.equal(E.results["2004"].d[ix("CA")], 6745485);
  assert.equal(E.results["2004"].r[ix("CA")], 5509826);
  assert.equal(E.results["2004"].d.reduce((a, b) => a + b, 0), 59028444);
  assert.equal(E.results["2004"].r.reduce((a, b) => a + b, 0), 62040610);
  // FEC, Federal Elections 2008, Table 2: Obama 69,498,516 and McCain 59,948,323 nationally.
  assert.equal(E.results["2008"].d.reduce((a, b) => a + b, 0), 69498516);
  assert.equal(E.results["2008"].r.reduce((a, b) => a + b, 0), 59948323);
  assert.equal(E.results["2008"].statesOnly, true);
  // 538's raw_polls.csv, 2020: Trafalgar Group has 32 polls in the final 61 days.
  assert.equal(pollsterCounts(E, 2020).get(byName("Trafalgar Group")), 32);
  assert.equal(E.polls.cycles["2016"].rows.length, 1151);
  assert.equal(E.polls.cycles["2020"].rows.length, 1183);
});

test("poll rows: two-party share, sampling variance, week, and the choice of pollsters", () => {
  close(twoParty(48, 46), (100 * 48) / 94);
  close(samplingVar(50, 50, 1000), 2.5);
  const rows = pollRows(E, 2020);
  assert.equal(rows.length, 1183);
  assert.ok(rows.every((r) => r.w >= 0 && r.w < WEEKS));
  const r21 = pollRows(E, 2020, { maxDays: 21 });
  assert.equal(r21.length, E.polls.cycles["2020"].rows.filter((r) => r[2] <= 21).length);
  const t = byName("Trafalgar Group");
  assert.equal(pollRows(E, 2020, { keep: (p) => p !== t }).length, 1183 - 32);
  assert.equal(pollRows(E, 2020, { keep: (p, part) => part === 0 }).length, E.polls.cycles["2020"].rows.filter((r) => r[6] === 0).length);
  assert.equal(pollRows(E, 2020, { keep: () => false }).length, 0);
});

test("gamma and inverse-gamma draws have the right mean", () => {
  const r = rng(4);
  for (const a of [0.5, 2, 7.5]) close(stats.mean(Array.from({ length: 100000 }, () => gammaDraw(r, a))), a, 0.03 * a + 0.01);
  // InvGamma(a, b) has mean b / (a - 1).
  close(stats.mean(Array.from({ length: 100000 }, () => invGamma(r, 5, 8))), 2, 0.03);
});

test("the sampler recovers a known toy truth", () => {
  // Three places, four pollsters with leans -2, 0, 0, +2, no weekly movement, no extra noise; many polls each.
  const r = rng(9);
  const lean0 = [-2, 0, 0, 2], level = [45, 50, 60];
  const rows = [];
  for (let k = 0; k < 600; k++) {
    const u = k % 3, p = Math.floor(k / 3) % 4, s2 = 1;
    rows.push({ u, p, w: k % 2, y: level[u] + lean0[p] + Math.sqrt(s2) * r.normal(), s2 });
  }
  const s = sampler(rows, { sweeps: 2500, burn: 500, seed: 3 });
  s.step(2500);
  const sum = summary(s);
  // Relative to the average poll (equal numbers of polls, so the mean lean 0): -2, 0, 0, 2.
  sum.house.forEach((h, j) => close(h.mean, lean0[j], 0.25));
  sum.level.forEach((l, j) => close(l.mean, level[j], 0.25));
  assert.ok(sum.sigma < 0.5, `sigma ${sum.sigma}`);
  assert.equal(lean(sum.house[0]), "leans Republican");
  assert.equal(lean(sum.house[3]), "leans Democratic");
  assert.equal(lean({ lo: -0.1, hi: 0.2 }), "no clear lean");
  assert.equal(lean({ lo: 0, hi: 0.2 }), "no clear lean");
  // Leans and levels trade off one for one: every alpha + h is unchanged by reporting relative to the average poll.
  for (let k = 0; k < 20; k++) {
    const d = s.draws.h[k], a = s.draws.alpha[k];
    close(d.reduce((t, v, j) => t + v * 150, 0) / 600, 0, 1e-9);
    assert.ok(Number.isFinite(a[0]));
  }
  // With adjust off the leans stay at zero.
  const off = sampler(rows, { sweeps: 600, burn: 100, seed: 3, adjust: false });
  off.step(600);
  assert.ok(summary(off).house.every((h) => h.mean === 0));
});

test("the check on fake pollsters: the method finds known leans", () => {
  const data = pollRows(E, 2020);
  const fk = fakeRows(E, 2020, data, { tau: 1.5, sigma: 1.5, seed: 7 });
  assert.equal(fk.rows.length, data.length);
  const s = sampler(fk.rows, { sweeps: 3000, burn: 500, seed: 8 });
  s.step(3000);
  const sum = summary(s);
  const c = new Map(); for (const d of fk.rows) c.set(d.p, (c.get(d.p) || 0) + 1);
  const many = recovery(sum, fk.hTrue, c, 5);
  close(sum.tau, 1.5, 0.35);
  close(sum.sigma, 1.5, 0.3);
  assert.ok(many.rmse < 0.9, `rmse ${many.rmse}`);
  assert.ok(many.coverage > 0.75 && many.coverage <= 1, `coverage ${many.coverage}`);
  assert.ok(many.slope > 0.5 && many.slope < 1.1, `slope ${many.slope}`);
  // With no leans at all the model says so: the spread comes out small.
  const flat = fakeRows(E, 2020, data, { tau: 0, sigma: 1.5, seed: 5 });
  const s0 = sampler(flat.rows, { sweeps: 2000, burn: 500, seed: 6 });
  s0.step(2000);
  assert.ok(summary(s0).tau < 0.6, `tau ${summary(s0).tau}`);
});

test("regularised gamma and chi-square quantiles match published tables", () => {
  // P(1, x) = 1 - e^-x; P(0.5, x) = erf(sqrt x).
  close(gammaP(1, 2), 1 - Math.exp(-2), 1e-12);
  close(gammaP(0.5, 0.5), 2 * stats.normalCdf(1) - 1, 1e-6);
  close(gammaP(3, 50), 1, 1e-12);
  assert.equal(gammaP(2, 0), 0);
  // Chi-square table: df 5, 5% point 1.145, 95% point 11.070; df 1, 95% point 3.841; df 10, 50% point 9.342.
  close(chiSquareQuantile(0.05, 5), 1.1455, 5e-4);
  close(chiSquareQuantile(0.95, 5), 11.0705, 5e-4);
  close(chiSquareQuantile(0.95, 1), 3.8415, 5e-4);
  close(chiSquareQuantile(0.5, 10), 9.3418, 5e-4);
});

test("state errors are polls minus results, recomputed by hand for Wisconsin 2016", () => {
  const c = stateErrors(E, 2016);
  const WI = E.units.indexOf("WI");
  const ys = E.polls.cycles["2016"].rows.filter((r) => r[0] === WI && r[2] <= 21).map((r) => (100 * r[4]) / (r[4] + r[5]));
  const res = E.results["2016"];
  const want = stats.mean(ys) - (100 * res.d[WI]) / (res.d[WI] + res.r[WI]);
  close(c.states.find((s) => s.unit === WI).error, want, 1e-9);
  assert.ok(want > 2, `Wisconsin 2016 polls overstated Clinton by ${want}`);
  close(c.common, stats.mean(c.states.map((s) => s.error)), 1e-12);
  assert.ok(c.states.every((s) => s.polls >= 3 && s.unit < 51));
});

test("the five elections: error structure with chi-square intervals", () => {
  const cycles = ERROR_YEARS.map((y) => stateErrors(E, y));
  const s = errorStructure(cycles);
  assert.equal(s.k, 5);
  close(s.sNat, Math.sqrt(stats.mean(cycles.map((c) => c.common ** 2))), 1e-12);
  close(s.natLo, s.sNat * Math.sqrt(5 / 11.0705), 1e-3);
  close(s.natHi, s.sNat * Math.sqrt(5 / 1.1455), 2e-3);
  assert.equal(s.sNat.toFixed(2), "1.45");
  assert.equal(s.natLo.toFixed(2), "0.98");
  assert.equal(s.natHi.toFixed(2), "3.04");
  assert.equal(s.sState.toFixed(2), "1.80");
  assert.equal(Math.round(s.rho * 100), 39);
  assert.equal(Math.round(s.rhoLo * 100), 23);
  assert.equal(Math.round(s.rhoHi * 100), 74);
  assert.deepEqual(cycles.map((c) => c.common.toFixed(1)), ["0.6", "0.4", "-1.0", "2.2", "2.1"]);
  const p = persistence(cycles[3], cycles[4]);
  assert.ok(p.n > 30 && p.r > 0 && p.lo < p.r && p.r < p.hi);
});

test("correlated errors: more shared error, less certainty for the leader", () => {
  const { sum } = fit(2020);
  const est = unitEstimates(E, 2020, sum);
  assert.equal(est.length, 56);
  const a = simulate(E, 2020, est, { total: 2.5, rho: 0, sims: 5000, seed: 1 });
  const b = simulate(E, 2020, est, { total: 2.5, rho: 1, sims: 5000, seed: 1 });
  assert.ok(a.winD > b.winD);
  assert.ok(b.hi - b.lo > a.hi - a.lo);
  // With no error and no uncertainty the count is the deterministic one.
  const sure = est.map((e) => ({ ...e, sd: 0 }));
  const z = simulate(E, 2020, sure, { total: 0, rho: 0.5, sims: 10, seed: 1 });
  const ev = E.results["2020"].ev;
  assert.equal(z.median, sure.reduce((t, e, i) => t + (e.mean > 50 ? ev[i] : 0), 0));
  close(nationalShare(E.results["2020"]), (100 * 81283501) / (81283501 + 74223975), 1e-9);
});

test("the finding: 2020, every pollster, 61 days, 3,000 sweeps with seed 1", () => {
  const { sum } = fit(2020);
  const t = sum.house.find((h) => h.pollster === byName("Trafalgar Group"));
  const q = sum.house.find((h) => h.pollster === byName("Quinnipiac University"));
  assert.equal(t.mean.toFixed(1), "-2.7");
  assert.equal(t.lo.toFixed(1), "-3.2");
  assert.equal(t.hi.toFixed(1), "-2.2");
  assert.equal(q.mean.toFixed(1), "1.8");
  // Among pollsters with at least 15 polls these are the two extremes.
  const counts = pollsterCounts(E, 2020);
  const big = sum.house.filter((h) => counts.get(h.pollster) >= 15).sort((a, b) => a.mean - b.mean);
  assert.equal(big.length, 18);
  assert.equal(big[0].pollster, byName("Trafalgar Group"));
  assert.equal(big.at(-1).pollster, byName("Quinnipiac University"));
  // Removing the leans makes the polled states miss by more: 2.6 points against 2.2.
  assert.equal(polledMiss(2020, sum).toFixed(1), "2.6");
  const off = fit(2020, { adjust: false });
  assert.equal(polledMiss(2020, off.sum).toFixed(1), "2.2");
  // Noise beyond sampling, quoted on day 86: 1.1 (2020) and 1.4 (2016) when leans are ignored.
  assert.equal(off.sum.sigma.toFixed(1), "1.1");
  assert.equal(fit(2016, { adjust: false }).sum.sigma.toFixed(1), "1.4");
});

test("coverage of the 90% intervals on fake polls over eight seeds, as quoted on the page", () => {
  const out = {};
  for (const year of [2020, 2016]) {
    const data = pollRows(E, year);
    const c = new Map(); for (const d of data) c.set(d.p, (c.get(d.p) || 0) + 1);
    const cov = [];
    for (let seed = 1; seed <= 8; seed++) {
      const fk = fakeRows(E, year, data, { tau: 1.5, sigma: 1.5, seed });
      const s = sampler(fk.rows, { sweeps: 2500, burn: 500, seed: seed + 100 });
      s.step(2500);
      cov.push(recovery(summary(s), fk.hTrue, c, 5).coverage);
    }
    out[year] = stats.mean(cov);
  }
  assert.equal(Math.round(out[2020] * 100), 87);
  assert.equal(Math.round(out[2016] * 100), 84);
});

test("the Gibbs fit agrees with an exact posterior computed outside the page (review)", () => {
  // Given sigma^2 and tau^2 the model is Gaussian and linear, so the posterior of (alpha, gamma, h) and the marginal
  // likelihood are exact; integrating them over a 36 x 36 grid of (sigma^2, tau^2) with numpy, from raw_polls.csv,
  // gives for 2020: tau 1.445, sigma 0.617, Trafalgar Group -2.721 (90%: -3.218 to -2.223), Quinnipiac +1.766,
  // average miss over polled states 2.574, and with leans switched off sigma 1.099 and miss 2.221.
  const { sum } = fit(2020);
  const t = sum.house.find((h) => h.pollster === byName("Trafalgar Group"));
  const q = sum.house.find((h) => h.pollster === byName("Quinnipiac University"));
  close(sum.tau, 1.445, 0.02);
  close(sum.sigma, 0.617, 0.02);
  close(t.mean, -2.721, 0.02);
  close(t.lo, -3.218, 0.04);
  close(t.hi, -2.223, 0.04);
  close(q.mean, 1.766, 0.02);
  close(polledMiss(2020, sum), 2.574, 0.02);
  const off = fit(2020, { adjust: false });
  close(off.sum.sigma, 1.099, 0.02);
  close(polledMiss(2020, off.sum), 2.221, 0.02);
});
