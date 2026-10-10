import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { problem, exact, newRun, runExperiment, commit, simulate, shares, betExact, betTally, brier, brierExact, brierTally } from "./logic.js";

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const STANDARD = { p: 0.5, k: 2 };

test("the standard problem: one half by experiment, one third by awakening, 1.5 awakenings each", () => {
  const e = exact(STANDARD);
  close(e.byExperiment, 1 / 2);
  close(e.byAwakening, 1 / 3);
  close(e.awakenings, 1.5);
});

test("the general formulas match hand-computed cases", () => {
  // p = 1/4, k = 3: awakenings 0.25 + 2.25 = 2.5, heads share of awakenings 0.25 / 2.5 = 0.1.
  const e = exact({ p: 0.25, k: 3 });
  close(e.awakenings, 2.5);
  close(e.byAwakening, 0.1);
  // k = 1 is an ordinary coin toss: the two counts agree.
  close(exact({ p: 0.3, k: 1 }).byAwakening, 0.3);
  // A coin that always lands one way.
  close(exact({ p: 1, k: 5 }).byAwakening, 1);
  close(exact({ p: 0, k: 5 }).byAwakening, 0);
  close(exact({ p: 0, k: 5 }).awakenings, 5);
});

test("what each position says: Elga gives 1/3 then 1/2 on Monday, Lewis gives 1/2 then 2/3 on Monday", () => {
  const e = exact(STANDARD);
  close(e.thirder.waking, 1 / 3);
  close(e.thirder.monday, 1 / 2);
  close(e.halfer.waking, 1 / 2);
  close(e.halfer.monday, 2 / 3);
  // Lewis with three tails awakenings: P(heads | first day) = 0.5 / (0.5 + 0.5 / 3) = 3/4.
  close(exact({ p: 0.5, k: 3 }).halfer.monday, 3 / 4);
});

test("invalid set-ups are refused with a message", () => {
  assert.equal(problem(STANDARD), null);
  for (const bad of [{ p: -0.1, k: 2 }, { p: 1.1, k: 2 }, { p: NaN, k: 2 }, { p: "0.5", k: 2 }, { p: 0.5, k: 0 }, { p: 0.5, k: 2.5 }, { p: 0.5 }, {}]) {
    assert.equal(typeof problem(bad), "string", JSON.stringify(bad));
    assert.throws(() => exact(bad), RangeError);
    assert.throws(() => simulate(rng(1), bad, 10), RangeError);
  }
  assert.throws(() => simulate(rng(1), STANDARD, -1), RangeError);
  assert.throws(() => simulate(rng(1), STANDARD, 2.5), RangeError);
  assert.throws(() => betExact(STANDARD, 1.2), RangeError);
  assert.throws(() => betTally(newRun().tally, NaN), RangeError);
  assert.throws(() => brierExact(STANDARD, -0.1), RangeError);
});

test("an empty run has no shares, and running zero experiments changes nothing", () => {
  const run = simulate(rng(1), STANDARD, 0);
  assert.deepEqual(run.tally, { experiments: 0, heads: 0, awakenings: 0, headsAwakenings: 0 });
  assert.deepEqual(shares(run.tally), { byExperiment: null, byAwakening: null });
  assert.deepEqual(brierTally(run.tally, 0.5), { perExperiment: null, perAwakening: null });
  assert.deepEqual(betTally(run.tally, 0.4), { once: 0, every: 0 });
  assert.equal(run.history.length, 0);
});

test("the counts are consistent: heads wakes once, tails wakes k times", () => {
  const setup = { p: 0.4, k: 3 };
  const run = simulate(rng(7), setup, 5000);
  const t = run.tally;
  assert.equal(t.experiments, 5000);
  assert.equal(t.headsAwakenings, t.heads);
  assert.equal(t.awakenings, t.heads + 3 * (t.experiments - t.heads));
  assert.equal(run.recent.length, 40);
  assert.ok(run.recent.every((e) => e.awakenings === (e.heads ? 1 : 3)));
});

test("simulation converges on the exact values (fixed seed)", () => {
  for (const setup of [STANDARD, { p: 0.25, k: 3 }, { p: 0.8, k: 10 }]) {
    const run = simulate(rng(11), setup, 200000);
    const s = shares(run.tally);
    const e = exact(setup);
    close(s.byExperiment, e.byExperiment, 0.005);
    close(s.byAwakening, e.byAwakening, 0.005);
    close(run.tally.awakenings / run.tally.experiments, e.awakenings, 0.02);
  }
});

test("the same seed gives the same run, and batches add up to one long run", () => {
  const a = simulate(rng(3), STANDARD, 1500);
  const r = rng(3);
  const b = simulate(r, STANDARD, 1000);
  simulate(r, STANDARD, 499, b);
  commit(b, runExperiment(r, STANDARD));
  assert.deepEqual(b.tally, a.tally);
  assert.deepEqual(b.recent, a.recent);
});

test("history is short, ordered, and ends on the current tally", () => {
  const run = simulate(rng(5), STANDARD, 100000);
  assert.ok(run.history.length < 300, `history has ${run.history.length} points`);
  assert.deepEqual(run.history.slice(0, 100).map((h) => h[0]), Array.from({ length: 100 }, (_, i) => i + 1));
  for (let i = 1; i < run.history.length; i++) assert.ok(run.history[i][0] > run.history[i - 1][0]);
  const s = shares(run.tally);
  assert.deepEqual(run.history.at(-1), [100000, s.byExperiment, s.byAwakening]);
});

test("bets: each way of selling the ticket breaks even at its own count", () => {
  const b = betExact(STANDARD, 0.4);
  // One ticket per experiment: 0.5 × 0.6 − 0.5 × 0.4 = +0.10. One per awakening: 0.5 × 0.6 − 0.5 × 2 × 0.4 = −0.10.
  close(b.once, 0.1);
  close(b.every, -0.1);
  close(b.breakEven.once, 1 / 2);
  close(b.breakEven.every, 1 / 3);
  for (const setup of [STANDARD, { p: 0.25, k: 3 }, { p: 0.8, k: 10 }]) {
    const e = exact(setup);
    close(betExact(setup, e.byExperiment).once, 0);
    close(betExact(setup, e.byAwakening).every, 0);
    assert.ok(betExact(setup, e.byExperiment).every < 0 || setup.k === 1);
    assert.ok(betExact(setup, e.byAwakening).once > 0 || setup.k === 1);
  }
});

test("bets: profit worked out from the tally equals profit added up one ticket at a time", () => {
  const setup = { p: 0.35, k: 4 };
  const r = rng(21);
  const run = newRun();
  let once = 0, every = 0;
  const price = 0.27;
  for (let i = 0; i < 3000; i++) {
    const e = runExperiment(r, setup);
    commit(run, e);
    once += (e.heads ? 1 : 0) - price;
    for (let a = 0; a < e.awakenings; a++) every += (e.heads ? 1 : 0) - price;
  }
  const b = betTally(run.tally, price);
  close(b.once, once, 1e-6);
  close(b.every, every, 1e-6);
  // And the simulated profit per experiment is near the exact expectation.
  const x = betExact(setup, price);
  close(b.once / 3000, x.once, 0.03);
  close(b.every / 3000, x.every, 0.06);
});

test("scoring: the expected Brier penalty is lowest at 1/2 counted by experiment and at 1/3 counted by awakening", () => {
  close(brier(0.4, true), 0.36);
  close(brier(0.4, false), 0.16);
  // Answering 0.4 in the standard problem: 0.5 × 0.36 + 0.5 × 0.16 = 0.26; and (0.5 × 0.36 + 2 × 0.5 × 0.16) / 1.5 = 0.34 / 1.5.
  close(brierExact(STANDARD, 0.4).perExperiment, 0.26);
  close(brierExact(STANDARD, 0.4).perAwakening, 0.34 / 1.5);
  for (const setup of [STANDARD, { p: 0.25, k: 3 }, { p: 0.8, k: 10 }]) {
    let bestE = 0, bestA = 0;
    for (let i = 0; i <= 10000; i++) {
      const c = i / 10000;
      if (brierExact(setup, c).perExperiment < brierExact(setup, bestE).perExperiment) bestE = c;
      if (brierExact(setup, c).perAwakening < brierExact(setup, bestA).perAwakening) bestA = c;
    }
    close(bestE, exact(setup).byExperiment, 1e-4);
    close(bestA, exact(setup).byAwakening, 1e-4);
  }
});

test("scoring: penalties worked out from the tally equal penalties added up one awakening at a time", () => {
  const r = rng(8);
  const run = newRun();
  let perExperiment = 0, perAwakening = 0;
  for (let i = 0; i < 2000; i++) {
    const e = runExperiment(r, STANDARD);
    commit(run, e);
    perExperiment += brier(0.42, e.heads);
    perAwakening += e.awakenings * brier(0.42, e.heads);
  }
  const s = brierTally(run.tally, 0.42);
  close(s.perExperiment, perExperiment / 2000, 1e-9);
  close(s.perAwakening, perAwakening / run.tally.awakenings, 1e-9);
  // On this run the halfer's answer wins one count and the thirder's wins the other.
  assert.ok(brierTally(run.tally, 1 / 2).perExperiment < brierTally(run.tally, 1 / 3).perExperiment);
  assert.ok(brierTally(run.tally, 1 / 3).perAwakening < brierTally(run.tally, 1 / 2).perAwakening);
});

test("the numbers quoted under 'One finding' (seed 19: the 1,000 experiments run on load, then 100,000 more)", () => {
  const r = rng(19);
  const run = simulate(r, STANDARD, 1000);
  assert.deepEqual(run.tally, { experiments: 1000, heads: 487, awakenings: 1513, headsAwakenings: 487 });
  simulate(r, STANDARD, 100000, run);
  assert.deepEqual(run.tally, { experiments: 101000, heads: 50527, awakenings: 151473, headsAwakenings: 50527 });
  const s = shares(run.tally);
  assert.equal((100 * s.byExperiment).toFixed(2), "50.03");
  assert.equal((100 * s.byAwakening).toFixed(2), "33.36");
  // The same ticket at 0.40: about +0.10 per experiment sold once, about −0.10 per experiment sold at every awakening.
  const b = betTally(run.tally, 0.4);
  assert.equal((b.once / 101000).toFixed(2), "0.10");
  assert.equal((b.every / 101000).toFixed(2), "-0.10");
  assert.equal(Math.round(b.once), 10127);
  assert.equal(Math.round(b.every), -10062);
});
