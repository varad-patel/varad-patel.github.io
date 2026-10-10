import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { LIMITS, PRESETS, validate, payoff, oneBoxValue, twoBoxValue, threshold, evidential, causal, payoffTable, simulate, predict, playRound, tally } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const M = 1000000, K = 1000;

test("payoffs: the four cells of the problem", () => {
  assert.equal(payoff("one", true, M, K), 1000000);
  assert.equal(payoff("one", false, M, K), 0);
  assert.equal(payoff("two", true, M, K), 1001000);
  assert.equal(payoff("two", false, M, K), 1000);
  assert.deepEqual(payoffTable(M, K), { one: { full: 1000000, empty: 0 }, two: { full: 1001000, empty: 1000 } });
});

test("evidential values match the hand calculation", () => {
  // 90% accuracy: one box 0.9 x 1,000,000; both 0.1 x 1,000,000 + 1,000.
  close(oneBoxValue(0.9, M), 900000);
  close(twoBoxValue(0.9, M, K), 101000, 1e-6);
  const e = evidential(0.9, M, K);
  assert.equal(e.best, "one");
  close(e.gap, 799000, 1e-6);
  // A coin: one box 500,000, both 501,000.
  assert.equal(evidential(0.5, M, K).best, "two");
  close(evidential(0.5, M, K).gap, -1000, 1e-6);
  // A predictor that is always wrong is as informative as one that is always right, in reverse.
  assert.deepEqual([oneBoxValue(0, M), twoBoxValue(0, M, K)], [0, 1001000]);
  assert.deepEqual([oneBoxValue(1, M), twoBoxValue(1, M, K)], [1000000, 1000]);
});

test("the threshold is (M + K) / 2M, and the two values really are level there", () => {
  close(threshold(M, K), 0.5005, 1e-12);
  close(threshold(2000, 1000), 0.75);
  assert.equal(threshold(1000, 1000), 1);
  assert.ok(threshold(500, 2000) > 1); // the clear box holds more than the prize: never
  assert.equal(threshold(1000, 0), 0.5);
  const r = rng(3);
  for (let i = 0; i < 200; i++) {
    const m = r.uniform(1, 1e6), k = r.uniform(0, 1e6);
    const t = threshold(m, k);
    close(oneBoxValue(t, m), twoBoxValue(t, m, k), 1e-6 * (m + k));
    close(t, 0.5 + k / (2 * m), 1e-12);
    if (t < 1) {
      assert.equal(evidential(Math.min(1, t + 1e-6), m, k).best, "one");
      assert.equal(evidential(t - 1e-6, m, k).best, "two");
    } else assert.notEqual(evidential(1, m, k).best, "one");
  }
  assert.equal(evidential(0.75, 2000, 1000).best, "tie");
  assert.deepEqual(PRESETS.map((p) => threshold(p.M, p.K)), [0.5005, 0.75, 1]);
});

test("causal values: both boxes lead by exactly K whatever you believe about the box", () => {
  for (const q of [0, 0.001, 0.25, 0.5, 0.9, 1]) {
    const c = causal(q, M, K);
    close(c.one, q * M);
    close(c.two - c.one, K, 1e-6);
    assert.equal(c.best, "two");
    assert.equal(c.gap, -K);
  }
  assert.equal(causal(0.5, M, 0).best, "tie");
  // Dominance, cell by cell.
  const t = payoffTable(M, K);
  assert.equal(t.two.full - t.one.full, K);
  assert.equal(t.two.empty - t.one.empty, K);
});

test("simulation: the crowd averages converge on the evidential values", () => {
  const s = simulate({ p: 0.9, M, K, plays: 200000, seed: 7 });
  assert.equal(s.plays, 200000);
  assert.equal(s.one.full + s.one.empty, 200000);
  assert.equal(s.two.full + s.two.empty, 200000);
  // Standard error of each mean is about 1,000,000 x sqrt(0.09 / 200,000) = 671, so 3,000 is a wide margin.
  close(s.one.mean, 900000, 3000);
  close(s.two.mean, 101000, 3000);
  close(s.one.accuracy, 0.9, 0.003);
  close(s.two.accuracy, 0.9, 0.003);
  // The means are exactly what the counts imply.
  close(s.one.mean, (s.one.full * M) / 200000, 1e-6);
  close(s.two.mean, (s.two.full * M) / 200000 + K, 1e-6);
});

test("simulation: with the same box in front of them, the other choice always differs by exactly K", () => {
  for (const p of [0.1, 0.5, 0.9]) {
    const s = simulate({ p, M, K, plays: 5000, seed: 11 });
    close(s.one.switched - s.one.mean, K, 1e-6); // every one-boxer left K behind
    close(s.two.mean - s.two.switched, K, 1e-6); // every two-boxer would have lost K by switching
  }
});

test("simulation: which crowd is richer flips at the threshold", () => {
  // Prize 2,000 and clear box 1,000: threshold 75%.
  const above = simulate({ p: 0.8, M: 2000, K: 1000, plays: 200000, seed: 1 });
  const below = simulate({ p: 0.7, M: 2000, K: 1000, plays: 200000, seed: 1 });
  assert.ok(above.one.mean > above.two.mean, `${above.one.mean} vs ${above.two.mean}`);
  assert.ok(below.one.mean < below.two.mean, `${below.one.mean} vs ${below.two.mean}`);
  close(above.one.mean - above.two.mean, 0.8 * 2000 - (0.2 * 2000 + 1000), 15); // +200
  close(below.one.mean - below.two.mean, 0.7 * 2000 - (0.3 * 2000 + 1000), 15); // -200
});

test("simulation: seeds, extremes and limits", () => {
  const a = simulate({ p: 0.6, M, K, plays: 3000, seed: 5 });
  assert.deepEqual(simulate({ p: 0.6, M, K, plays: 3000, seed: 5 }), a);
  assert.notDeepEqual(simulate({ p: 0.6, M, K, plays: 3000, seed: 6 }).one, a.one);
  // A perfect predictor and a perfectly wrong one.
  const perfect = simulate({ p: 1, M, K, plays: 500, seed: 2 });
  assert.deepEqual([perfect.one.mean, perfect.two.mean, perfect.one.empty, perfect.two.full], [M, K, 0, 0]);
  const wrong = simulate({ p: 0, M, K, plays: 500, seed: 2 });
  assert.deepEqual([wrong.one.mean, wrong.two.mean], [0, M + K]);
  // The trace runs from the first play to the last, in order.
  assert.equal(a.trace[0].n, 1);
  assert.equal(a.trace.at(-1).n, 3000);
  assert.ok(a.trace.every((t, i) => i === 0 || t.n > a.trace[i - 1].n));
  close(a.trace.at(-1).one, a.one.mean, 1e-6);
  // Play counts are whole, at least one and capped.
  assert.equal(simulate({ p: 0.5, M, K, plays: 0, seed: 1 }).plays, 1);
  assert.equal(simulate({ p: 0.5, M, K, plays: 12.9, seed: 1 }).plays, 12);
  assert.equal(LIMITS.plays, 1000000);
});

test("the learning predictor: first guess, habits, patterns and ties", () => {
  assert.equal(predict([]), "one");
  assert.equal(predict(["two"]), "two");
  assert.equal(predict(["one", "one", "one", "one"]), "one");
  // After "one, two" repeated, the last three choices have always been followed by the same thing.
  const alt = ["one", "two", "one", "two", "one", "two"];
  assert.equal(predict(alt), "one");
  assert.equal(predict([...alt, "one"]), "two");
  // A longer pattern: one, one, two.
  const tri = ["one", "one", "two", "one", "one", "two", "one", "one"];
  assert.equal(predict(tri), "two");
  assert.equal(predict([...tri, "two"]), "one");
  // No pattern and a level count: expect a repeat of the last choice.
  assert.equal(predict(["one", "two"]), "two");
  assert.equal(predict(["two", "one"]), "one");
  // With no context allowed it is the commonest choice so far.
  assert.equal(predict(["two", "one", "one"], 0), "one");
});

test("the learning predictor: accuracy against stock players", () => {
  const run = (pick, n = 300) => {
    const rounds = [];
    for (let i = 0; i < n; i++) rounds.push(playRound(rounds, pick(rounds, i), M, K));
    return tally(rounds);
  };
  assert.equal(run(() => "one").accuracy, 1);
  assert.ok(run(() => "two").accuracy > 0.99); // wrong only on the first round, where it guesses one box
  assert.ok(run((_, i) => (i % 2 ? "one" : "two")).accuracy > 0.97);
  assert.ok(run((_, i) => (i % 3 === 2 ? "two" : "one")).accuracy > 0.97);
  // A coin cannot be predicted: about half, give or take three standard errors of 0.5 / sqrt(2000).
  const r = rng(18);
  close(run(() => (r() < 0.5 ? "one" : "two"), 2000).accuracy, 0.5, 0.035);
  // Someone who can run the rule in their head and does the opposite is never predicted.
  assert.equal(run((rounds) => (predict(rounds.map((x) => x.choice)) === "one" ? "two" : "one")).accuracy, 0);
});

test("a round and the running tally, by hand", () => {
  const rounds = [];
  const go = (choice) => { rounds.push(playRound(rounds, choice, M, K)); return rounds.at(-1); };
  // Round 1: it guesses one box, so the box is full; taking both wins everything.
  assert.deepEqual(go("two"), { choice: "two", predicted: "one", full: true, correct: false, won: 1001000 });
  // Round 2: it now expects both, so the box is empty; taking both wins the clear box only.
  assert.deepEqual(go("two"), { choice: "two", predicted: "two", full: false, correct: true, won: 1000 });
  // Round 3: still expects both; taking one box wins nothing.
  assert.deepEqual(go("one"), { choice: "one", predicted: "two", full: false, correct: false, won: 0 });
  const t = tally(rounds);
  assert.deepEqual([t.rounds, t.hits, t.total], [3, 1, 1002000]);
  close(t.accuracy, 1 / 3);
  close(t.mean, 334000);
  assert.deepEqual(t.one, { rounds: 1, mean: 0 });
  assert.deepEqual(t.two, { rounds: 2, mean: 501000 });
  assert.deepEqual(t.running, [0, 0.5, 1 / 3]);
  const empty = tally([]);
  assert.equal(empty.rounds, 0);
  assert.ok(Number.isNaN(empty.accuracy) && Number.isNaN(empty.mean) && Number.isNaN(empty.one.mean));
  assert.deepEqual(empty.running, []);
});

test("validation refuses what the sums cannot use", () => {
  assert.deepEqual(validate({ p: 0.9, M, K }), []);
  assert.deepEqual(validate({ p: 0, M: 1, K: 0 }), []);
  assert.equal(validate({ p: 1.2, M, K }).length, 1);
  assert.equal(validate({ p: NaN, M: NaN, K: NaN }).length, 3);
  assert.match(validate({ p: 0.5, M: 0, K })[0], /more than 0/);
  assert.match(validate({ p: 0.5, M, K: -1 })[0], /0 or more/);
  assert.equal(validate({ p: 0.5, M: 2e12, K: 2e12 }).length, 2);
  assert.equal(validate({ p: 0.5, M: Infinity, K: 0 }).length, 1);
});

test("the finding: threshold 50.05%, and the 100,000-play run quoted on the page", () => {
  assert.equal((threshold(M, K) * 100).toFixed(2), "50.05");
  const s = simulate({ p: 0.9, M, K, plays: 100000, seed: 18 });
  assert.equal(s.one.mean, 900010);
  assert.equal(s.two.mean, 100250);
  // In every play, both boxes would have paid exactly 1,000 more than one box with the same contents.
  assert.equal(s.one.switched - s.one.mean, 1000);
  assert.equal(s.two.mean - s.two.switched, 1000);
});
