import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { ELECTIONS as E } from "../data/elections.js";
import {
  YEARS, LAG, POLL_NOISE, DEFAULTS, twoParty, samplingVar, parentIndex, nationalShare, usablePolls, weight, aggregate,
  drawError, simulator, actual, brier, calibration, summarise, forecastDate, check,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const ix = (u) => E.units.indexOf(u);
const run = (year, o = {}) => {
  const opts = { ...DEFAULTS, ...o };
  const agg = aggregate(E, year, opts), pri = aggregate(E, year, { ...opts, statePolls: false });
  const sim = simulator(E, agg, pri, opts);
  sim.run(opts.sims);
  return { agg, pri, sim, s: summarise(E, sim, year) };
};

test("the data module holds the sources' own figures", () => {
  // FEC, Federal Elections 2020, Table 2: California, Biden 11,110,639 and Trump 6,006,518; national 81,283,501 and 74,223,975.
  const r20 = E.results["2020"];
  assert.equal(r20.d[ix("CA")], 11110639);
  assert.equal(r20.r[ix("CA")], 6006518);
  assert.equal(r20.d.slice(0, 51).reduce((a, b) => a + b, 0), 81283501);
  assert.equal(r20.r.slice(0, 51).reduce((a, b) => a + b, 0), 74223975);
  // FEC, Official 2024 results: Pennsylvania, Harris 3,423,042 and Trump 3,543,308; 312 electoral votes for Trump.
  assert.equal(E.results["2024"].d[ix("PA")], 3423042);
  assert.equal(E.results["2024"].r[ix("PA")], 3543308);
  assert.deepEqual(E.results["2024"].evWon, [226, 312]);
  // Maine's certificate of ascertainment 2016: second district, Clinton 144,817 and Trump 181,177.
  assert.equal(E.results["2016"].d[ix("ME-2")], 144817);
  assert.equal(E.results["2016"].r[ix("ME-2")], 181177);
  // Nebraska's certificate 2020: second district, Biden 176,468 and Trump 154,377.
  assert.equal(E.results["2020"].d[ix("NE-2")], 176468);
  assert.equal(E.results["2020"].r[ix("NE-2")], 154377);
  // 538's raw_polls.csv: SurveyMonkey's national poll with median date 5 September 2020 (59 days out), n 10,478, Biden 52.16, Trump 46.24.
  const sm = E.polls.pollsters.findIndex((p) => p[1] === "SurveyMonkey");
  assert.ok(E.polls.cycles["2020"].rows.some((r) => E.polls.places[r[0]] === "US" && r[1] === sm && r[2] === 59 && r[3] === 10478 && r[4] === 52.16 && r[5] === 46.24));
  // Every year's electoral votes add up to 538, with 2 at-large votes for Maine and Nebraska.
  for (const y of ["2012", "2016", "2020", "2024"]) {
    assert.equal(E.results[y].ev.reduce((a, b) => a + b, 0), 538);
    assert.equal(E.results[y].ev[ix("ME")], 2);
    assert.equal(E.results[y].ev[ix("NE")], 2);
  }
  assert.equal(E.results["2024"].ev[ix("CA")], 54);
  assert.equal(E.results["2020"].ev[ix("CA")], 55);
});

test("two-party share and sampling variance by hand", () => {
  close(twoParty(52, 48), 52);
  close(twoParty(45, 45), 50);
  close(twoParty(3, 1), 75);
  // 50/50 among 1,000: p(1 - p)/n = 0.00025, times 100^2 = 2.5 points squared.
  close(samplingVar(50, 50, 1000), 2.5);
  // 45/45 among 1,000 leaves 900 who chose one of the two.
  close(samplingVar(45, 45, 1000), 2500 / 900);
  close(weight(0, 14), 1);
  close(weight(14, 14), 0.5);
  close(weight(28, 14), 0.25);
});

test("districts point at their states", () => {
  const p = parentIndex(E);
  assert.equal(p[ix("ME-1")], ix("ME"));
  assert.equal(p[ix("NE-3")], ix("NE"));
  assert.equal(p[ix("PA")], ix("PA"));
});

test("a poll counts only from two days after the middle of its fieldwork", () => {
  for (const d of [0, 10, 30]) {
    const ps = usablePolls(E, 2020, d);
    assert.ok(ps.every((p) => p.age >= LAG));
    const want = E.polls.cycles["2020"].rows.filter((r) => r[2] >= d + LAG).length;
    assert.equal(ps.length, want);
  }
  // Nothing is known 60 days out: the national swing falls back to zero and every unit keeps its prior.
  const a = aggregate(E, 2020, { daysBefore: 60 });
  assert.equal(a.polls, 0);
  assert.equal(a.swing, 0);
  for (const u of a.units) { close(u.mean, u.prior); close(u.sd, DEFAULTS.tau); }
});

test("the aggregation is the normal-normal update, recomputed separately for Pennsylvania 2020", () => {
  const day = 0, tau = 3, half = 14;
  const a = aggregate(E, 2020, { daysBefore: day, tau, halfLife: half });
  const c = E.polls.cycles["2020"];
  const US = E.polls.places.indexOf("US"), PA = ix("PA");
  // Separate code: national swing from the raw rows.
  let w = 0, s = 0;
  const prev = E.results["2016"];
  for (const [u, , days, n, d, r] of c.rows) {
    if (u !== US || days < day + 2) continue;
    const y = (100 * d) / (d + r), p = d / (d + r), v = (1e4 * p * (1 - p)) / ((n * (d + r)) / 100) + 1.5 ** 2;
    const wt = 2 ** (-(days - day) / half) / v;
    w += wt; s += wt * y;
  }
  let D = 0, R = 0;
  for (let i = 0; i < 51; i++) { D += prev.d[i]; R += prev.r[i]; }
  const swing = s / w - (100 * D) / (D + R);
  close(a.swing, swing, 1e-9);
  const prior = (100 * prev.d[PA]) / (prev.d[PA] + prev.r[PA]) + swing;
  let prec = 1 / tau ** 2, sum = prior / tau ** 2, k = 0;
  for (const [u, , days, n, d, r] of c.rows) {
    if (u !== PA || days < day + 2) continue;
    const y = (100 * d) / (d + r), p = d / (d + r), v = (1e4 * p * (1 - p)) / ((n * (d + r)) / 100) + 1.5 ** 2;
    const wt = 2 ** (-(days - day) / half);
    prec += wt / v; sum += (wt * y) / v; k++;
  }
  const u = a.units[PA];
  assert.equal(u.polls, k);
  close(u.prior, prior, 1e-9);
  close(u.mean, sum / prec, 1e-9);
  close(u.sd, Math.sqrt(1 / prec), 1e-12);
  assert.ok(k > 50, `${k} Pennsylvania polls`);
  // The posterior lies between the prior and the poll average and is tighter than the prior.
  assert.ok(u.sd < tau);
});

test("errors have unit variance with normal and with fat tails", () => {
  for (const tails of ["normal", "fat"]) {
    const r = rng(11);
    const xs = Array.from({ length: 200000 }, () => drawError(r, tails));
    close(stats.mean(xs), 0, 0.01);
    close(stats.variance(xs), 1, 0.03);
  }
  // Fat tails put more weight beyond 3 standard deviations: about 1.0% for t(5) scaled, 0.27% for the normal.
  const r = rng(12);
  const far = (tails) => Array.from({ length: 200000 }, () => drawError(r, tails)).filter((x) => Math.abs(x) > 3).length / 200000;
  assert.ok(far("fat") > 2.5 * far("normal"));
});

test("with no error at all the simulation is the deterministic count", () => {
  const o = { ...DEFAULTS, natSd: 0, stateSd: 0, drift: 0, tau: 1e-4, sims: 50 };
  const { s, agg } = run(2020, { ...o, statePolls: false });
  // Every probability is 0 or 1, and the electoral votes are the sum over units above 50.
  assert.ok(s.p.every((p) => p === 0 || p === 1));
  const ev = E.results["2020"].ev;
  const want = agg.units.reduce((t, u, i) => t + (u.mean > 50 ? ev[i] : 0), 0);
  assert.ok(agg.units.every((u) => Math.abs(u.mean - 50) > 0.01));
  assert.deepEqual([s.lo, s.median, s.hi], [want, want, want]);
});

test("a unit's simulated probability matches the normal formula", () => {
  const o = { ...DEFAULTS, sims: 40000, seed: 3 };
  const { agg, s } = run(2020, o);
  for (const u of ["PA", "GA", "TX", "ME"]) {
    const i = ix(u), a = agg.units[i];
    const sd = Math.sqrt(a.sd ** 2 + o.natSd ** 2 + o.stateSd ** 2);
    const p = stats.normalCdf((a.mean - 50) / sd);
    close(s.p[i], p, 0.01);
  }
  // A district adds half a state error of its own.
  const i = ix("NE-2"), a = agg.units[i];
  const sd = Math.sqrt(a.sd ** 2 + o.natSd ** 2 + o.stateSd ** 2 + (0.5 * o.stateSd) ** 2);
  close(s.p[i], stats.normalCdf((a.mean - 50) / sd), 0.01);
});

test("Brier score and calibration by hand", () => {
  close(brier([1, 0, 0.5], [1, 1, 0]), (0 + 1 + 0.25) / 3);
  close(brier([0.5, 0.5], [1, 0]), 0.25);
  assert.ok(Number.isNaN(brier([], [])));
  assert.ok(Number.isNaN(brier([0.2], [1, 0])));
  const c = calibration([0.01, 0.2, 0.6, 0.6, 0.99, 1], [0, 1, 1, 0, 1, 1]);
  assert.deepEqual(c.map((b) => b.n), [1, 1, 0, 2, 0, 2]);
  close(c[3].rate, 0.5);
  close(c[5].meanP, 0.995);
  assert.ok(Number.isNaN(c[2].rate));
});

test("the actual results: 306 to 232 in 2020 and 232 to 306 in 2016 (pledged electors)", () => {
  const a20 = actual(E, 2020), a16 = actual(E, 2016);
  assert.deepEqual([a20.evD, a20.evR], [306, 232]);
  assert.deepEqual([a16.evD, a16.evR], [232, 306]);
  assert.equal(a20.won[ix("NE-2")], 1);
  assert.equal(a20.won[ix("ME-2")], 0);
  close(a20.national, (100 * 81283501) / (81283501 + 74223975), 1e-9);
  close(nationalShare(E.results["2016"]), (100 * 65853514) / (65853514 + 62984828), 1e-9);
});

test("dates and validation", () => {
  assert.equal(forecastDate("2020-11-03", 0), "2020-11-03");
  assert.equal(forecastDate("2020-11-03", 30), "2020-10-04");
  assert.equal(forecastDate("2016-11-08", 8), "2016-10-31");
  assert.deepEqual(check({ ...DEFAULTS, year: 2020 }), []);
  assert.match(check({ ...DEFAULTS, year: 2020, natSd: -1 }).join(" "), /national polling error must be between 0 and 6/);
  assert.match(check({ ...DEFAULTS, year: 2020, daysBefore: 2.5 }).join(" "), /whole number/);
  assert.match(check({ ...DEFAULTS, year: 2012 }).join(" "), /2016 or 2020/);
  assert.match(check({ ...DEFAULTS, year: 2020, tau: NaN }).join(" "), /spread/);
});

test("the finding: election morning, default settings, 20,000 simulations with seed 1", () => {
  const a = run(2020).s, b = run(2016).s;
  assert.equal(a.winD.toFixed(3), "0.939");
  assert.equal(a.median, 350);
  assert.equal(a.atOrBelow.toFixed(2), "0.22");
  assert.equal(a.brier.toFixed(3), "0.037");
  assert.equal(a.brierPrior.toFixed(3), "0.037");
  assert.equal(Math.round(a.worse * 100), 60);
  assert.equal(b.winD.toFixed(3), "0.829");
  assert.equal(b.median, 317);
  assert.equal(Math.round(b.atOrBelow * 100), 4);
  assert.equal(b.brier.toFixed(3), "0.075");
  assert.equal(b.brierPrior.toFixed(3), "0.089");
  assert.equal(Math.round(b.worse * 100), 11);
  // Both beat repeating the previous winner and a coin flip.
  for (const s of [a, b]) assert.ok(s.brier < s.brierPrev && s.brier < 0.25);
  // The states called wrongly in 2016 include Michigan, Pennsylvania and Wisconsin.
  assert.ok(["MI", "PA", "WI"].every((u) => b.misses.includes(ix(u))));
});

test("more error means less certainty, and fat tails move probability into the tails", () => {
  const lo = run(2020, { natSd: 0.5, stateSd: 0.5, sims: 8000 }).s, hi = run(2020, { natSd: 4, stateSd: 4, sims: 8000 }).s;
  assert.ok(hi.winD < lo.winD);
  assert.ok(hi.hi - hi.lo > lo.hi - lo.lo);
  const n = run(2020, { sims: 8000 }).s, f = run(2020, { tails: "fat", sims: 8000 }).s;
  assert.ok(Math.abs(f.winD - n.winD) < 0.05);
  assert.deepEqual(YEARS, [2020, 2016]);
  assert.equal(POLL_NOISE, 1.5);
});

test("the Brier score from exact normal probabilities, against the simulated one (review)", () => {
  // With normal errors a unit's chance is Phi((m - 50) / sqrt(sd^2 + natSd^2 + stateSd^2 [+ (stateSd / 2)^2])).
  // Recomputed outside the page with numpy and scipy from the raw files: 0.03699 (2020) and 0.07446 (2016).
  const exact = (year) => {
    const agg = aggregate(E, year, DEFAULTS), a = actual(E, year), par = parentIndex(E);
    return brier(agg.units.map((u, i) => stats.normalCdf((u.mean - 50) / Math.sqrt(u.sd ** 2 + 1.5 ** 2 + 1.5 ** 2 + (par[i] !== i ? 0.75 ** 2 : 0)))), a.won);
  };
  close(exact(2020), 0.03699, 5e-5);
  close(exact(2016), 0.07446, 5e-5);
  assert.equal(exact(2016).toFixed(4), "0.0745");
  // 20,000 simulations with seed 1 land within 0.0003 of the exact scores.
  close(run(2016).s.brier, exact(2016), 3e-4);
  close(run(2020).s.brier, exact(2020), 3e-4);
  // 59 days out no national poll is usable yet, so the swing is zero.
  const early = aggregate(E, 2020, { daysBefore: 59 });
  assert.equal(early.nationalPolls, 0);
  assert.equal(early.swing, 0);
});
