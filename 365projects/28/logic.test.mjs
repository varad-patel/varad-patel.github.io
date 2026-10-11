import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { MAX_N, problem, weight, range, meanSmaller, finiteVariance, seen, seenTable, partialGain, strategyExact, bestThreshold, drawSmaller, deal, simulate } from "./logic.js";

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const FIXED = { kind: "fixed", n: 6 };          // 64 and 128
const UNIFORM = { kind: "uniform", count: 10 }; // 1, 2, 4, ..., 512
const THIRD = { kind: "doubling", q: 1 / 3 };   // finite mean
const HALF = { kind: "doubling", q: 1 / 2 };    // borderline: infinite mean, zero conditional gain
const BROOME = { kind: "doubling", q: 2 / 3 };  // infinite mean, switching favoured whatever you see

/** Expected value of f(deal) by listing every case, for a prior with finite support (or a truncated one). */
function enumerate(prior, f, upTo) {
  let total = 0;
  for (let n = 0; n <= upTo; n++) {
    const w = weight(prior, n);
    if (!w) continue;
    total += (w / 2) * f({ n, holdsSmaller: true, j: n, mine: 2 ** n, other: 2 ** (n + 1) });
    total += (w / 2) * f({ n, holdsSmaller: false, j: n + 1, mine: 2 ** (n + 1), other: 2 ** n });
  }
  return total;
}

test("every prior's probabilities add up to one", () => {
  for (const prior of [FIXED, UNIFORM, { kind: "uniform", count: 1 }]) {
    let total = 0;
    for (let n = 0; n < 40; n++) total += weight(prior, n);
    close(total, 1);
  }
  for (const prior of [THIRD, HALF, BROOME]) {
    let total = 0;
    for (let n = 0; n < 200; n++) total += weight(prior, n);
    close(total, 1, 1e-9);
  }
  assert.equal(weight(UNIFORM, -1), 0);
  assert.equal(weight(UNIFORM, 10), 0);
  assert.equal(weight(UNIFORM, 2.5), 0);
  assert.equal(weight(FIXED, 5), 0);
});

test("the mean of the smaller amount: finite cases by hand, infinite from q = 1/2 upwards", () => {
  assert.equal(meanSmaller(FIXED), 64);
  close(meanSmaller(UNIFORM), 102.3); // (1 + 2 + ... + 512) / 10 = 1023 / 10
  close(meanSmaller(THIRD), 2);       // (2/3) × sum of (2/3)^n = (2/3) × 3
  let partial = 0;
  for (let n = 0; n < 200; n++) partial += weight(THIRD, n) * 2 ** n;
  close(partial, 2, 1e-9);
  assert.equal(meanSmaller(HALF), Infinity);
  assert.equal(meanSmaller(BROOME), Infinity);
  assert.deepEqual(range(UNIFORM), { first: 0, last: 9 });
  assert.deepEqual(range(FIXED), { first: 6, last: 6 });
  assert.equal(range(BROOME).last, Infinity);
});

test("the variance of the smaller amount is finite only below q = 1/4", () => {
  // E[X²] = (1 − q) Σ (4q)^n. At q = 0.2 it is 0.8 / (1 − 0.8) = 4; at q = 1/4 every term is 0.75, so it grows for ever.
  const secondMoment = (q, terms) => { let s = 0; for (let n = 0; n < terms; n++) s += (1 - q) * (4 * q) ** n; return s; };
  close(secondMoment(0.2, 400), 4, 1e-9);
  close(secondMoment(0.25, 400), 300, 1e-9);
  close(secondMoment(0.25, 800), 600, 1e-9);
  assert.equal(finiteVariance({ kind: "doubling", q: 0.2 }), true);
  assert.equal(finiteVariance({ kind: "doubling", q: 0.25 }), false);
  assert.equal(finiteVariance(THIRD), false); // finite mean, infinite variance
  assert.equal(finiteVariance(BROOME), false);
  assert.equal(finiteVariance(UNIFORM), true);
  assert.equal(finiteVariance(FIXED), true);
  assert.throws(() => finiteVariance({ kind: "doubling", q: 2 }), RangeError);
});

test("a uniform prior over 1, 2, 4 worked by hand", () => {
  const { rows, complete } = seenTable({ kind: "uniform", count: 3 });
  assert.equal(complete, true);
  assert.deepEqual(rows.map((r) => r.amount), [1, 2, 4, 8]);
  const expected = [
    // chance, P(other larger), expected gain from switching
    [1 / 6, 1, 1],      // 1 can only be the smaller amount
    [1 / 3, 1 / 2, 0.5], // 2: other is 4 or 1, so +2 or −1
    [1 / 3, 1 / 2, 1],   // 4: other is 8 or 2, so +4 or −2
    [1 / 6, 0, -4],      // 8 can only be the larger amount
  ];
  rows.forEach((r, i) => {
    close(r.chance, expected[i][0]);
    close(r.otherLarger, expected[i][1]);
    close(r.gain, expected[i][2]);
    close(r.share, expected[i][2] / r.amount);
    close(r.contribution, expected[i][0] * expected[i][2]);
  });
  // The loss at the top cancels every gain below it.
  close(rows.reduce((s, r) => s + r.contribution, 0), 0);
  close(rows.reduce((s, r) => s + r.chance, 0), 1);
});

test("a fixed pair: each amount settles the question", () => {
  const { rows } = seenTable(FIXED);
  assert.deepEqual(rows.map((r) => [r.amount, r.chance, r.otherLarger, r.gain]), [[64, 0.5, 1, 64], [128, 0.5, 0, -64]]);
  assert.equal(seen(FIXED, 5), null);
  assert.equal(seen(FIXED, 8), null);
  assert.equal(seen(UNIFORM, 11), null);
  assert.equal(seen(UNIFORM, -1), null);
});

test("with a uniform prior the tempting argument is exactly right except at the two ends", () => {
  const { rows } = seenTable(UNIFORM);
  assert.equal(rows.length, 11);
  assert.equal(rows[0].otherLarger, 1);
  assert.equal(rows[10].otherLarger, 0);
  close(rows[10].gain, -512);
  for (const r of rows.slice(1, 10)) { close(r.otherLarger, 0.5); close(r.share, 0.25); }
});

test("the doubling prior: chance q / (1 + q) that the other holds more, and gain a(2q − 1) / (2(1 + q))", () => {
  // Broome's example, q = 2/3: chance 2/5, and switching gains a tenth of what you hold.
  for (const j of [1, 2, 7, 40, 900]) { close(seen(BROOME, j).otherLarger, 2 / 5); close(seen(BROOME, j).share, 1 / 10); }
  // q = 1/3: chance 1/4, and switching loses an eighth of what you hold.
  for (const j of [1, 5, 30]) { close(seen(THIRD, j).otherLarger, 1 / 4); close(seen(THIRD, j).share, -1 / 8); }
  // q = 1/2: chance 1/3, and switching neither gains nor loses on average. The gain is exactly zero, not a rounding
  // error that the page would print as "-0.00".
  for (const j of [1, 5, 30]) { close(seen(HALF, j).otherLarger, 1 / 3); assert.equal(seen(HALF, j).share, 0); assert.equal(seen(HALF, j).gain, 0); }
  // The lowest amount is always the smaller one.
  for (const prior of [THIRD, HALF, BROOME]) { assert.equal(seen(prior, 0).otherLarger, 1); assert.equal(seen(prior, 0).gain, 1); }
  // Switching is favoured at every amount exactly when q > 1/2.
  for (const q of [0.51, 0.6, 0.9]) for (let j = 0; j < 30; j++) assert.ok(seen({ kind: "doubling", q }, j).gain > 0);
  for (const q of [0.1, 0.3, 0.49]) for (let j = 1; j < 30; j++) assert.ok(seen({ kind: "doubling", q }, j).gain < 0);
  const t = seenTable(BROOME, 12);
  assert.equal(t.rows.length, 12);
  assert.equal(t.complete, false);
});

test("the conditional probabilities agree with Bayes' rule applied case by case", () => {
  for (const prior of [UNIFORM, { kind: "uniform", count: 4 }, THIRD, BROOME, { kind: "doubling", q: 0.83 }]) {
    for (let j = 0; j <= 12; j++) {
      const s = seen(prior, j);
      if (!s) continue;
      const pSee = enumerate(prior, (d) => (d.j === j ? 1 : 0), 60);
      const pSeeAndLarger = enumerate(prior, (d) => (d.j === j && d.holdsSmaller ? 1 : 0), 60);
      const gain = enumerate(prior, (d) => (d.j === j ? d.other - d.mine : 0), 60);
      close(s.chance, pSee, 1e-12);
      close(s.otherLarger, pSeeAndLarger / pSee, 1e-12);
      close(s.gain, gain / pSee, 1e-9);
      close(s.contribution, gain, 1e-12);
    }
  }
});

test("always-switching's gain, summed over amounts, telescopes: zero for finite means, not for infinite ones", () => {
  for (const prior of [UNIFORM, THIRD, HALF, BROOME]) {
    let sum = 0;
    for (let j = 0; j <= 30; j++) {
      const s = seen(prior, j);
      if (s) sum += s.contribution;
      close(partialGain(prior, j), sum, 1e-6 * Math.max(1, Math.abs(sum)));
    }
  }
  assert.equal(partialGain(UNIFORM, 10), 0);          // past the top amount: everything has cancelled
  assert.ok(partialGain(THIRD, 60) < 1e-9);           // q < 1/2: tends to zero
  close(partialGain(HALF, 3), 0.25);                  // q = 1/2: stuck at 1/4 for ever
  close(partialGain(HALF, 300), 0.25);
  assert.ok(partialGain(BROOME, 60) > 1e6);           // q > 1/2: grows without limit
  assert.ok(partialGain(BROOME, 61) > partialGain(BROOME, 60));
});

test("strategies: keeping and switching tie, and a threshold inside the prior's range beats both", () => {
  const s = strategyExact(UNIFORM, 9); // switch if you see 512 or less
  close(s.keep, 153.45);
  close(s.switch, 153.45);
  close(s.threshold, 179.05);
  close(s.edge, 25.6);
  // A threshold outside the range is the same as always keeping (too low) or always switching (too high).
  assert.equal(strategyExact(UNIFORM, -1).edge, 0);
  assert.equal(strategyExact(UNIFORM, 10).edge, 0);
  assert.equal(strategyExact(UNIFORM, 15).edge, 0);
  // Fixed pair 64 / 128: switch only on 64 and you always walk away with 128.
  assert.deepEqual(strategyExact(FIXED, 6), { keep: 96, switch: 96, threshold: 128, edge: 32 });
  assert.equal(strategyExact(FIXED, 7).edge, 0);
  // q = 1/3, switch only on 1: mean 2, so 3 + (2/3 × 1) / 2.
  close(strategyExact(THIRD, 0).threshold, 3 + 1 / 3);
  // Infinite mean: every strategy's expectation is infinite, but the edge over keeping is still a finite number.
  const b = strategyExact(BROOME, 5);
  assert.equal(b.keep, Infinity);
  assert.equal(b.threshold, Infinity);
  close(b.edge, ((1 / 3) * (2 / 3) ** 5 * 32) / 2);
});

test("the threshold formula agrees with listing every case", () => {
  for (const prior of [{ kind: "uniform", count: 6 }, FIXED, THIRD]) {
    const upTo = prior.kind === "doubling" ? 400 : 20;
    for (let t = -1; t <= 9; t++) {
      const s = strategyExact(prior, t);
      close(enumerate(prior, (d) => d.mine, upTo), s.keep, 1e-9);
      close(enumerate(prior, (d) => d.other, upTo), s.switch, 1e-9);
      close(enumerate(prior, (d) => (d.j <= t ? d.other : d.mine), upTo), s.threshold, 1e-9);
    }
  }
});

test("the best threshold is the top of a bounded prior, and there is none when the mean is infinite", () => {
  assert.equal(bestThreshold(FIXED), 6);
  assert.equal(bestThreshold(UNIFORM), 9);
  assert.equal(bestThreshold(THIRD), 0);
  assert.equal(bestThreshold(HALF), null);
  assert.equal(bestThreshold(BROOME), null);
  for (const prior of [FIXED, UNIFORM, THIRD]) {
    const best = strategyExact(prior, bestThreshold(prior)).edge;
    for (let t = -2; t < 30; t++) assert.ok(strategyExact(prior, t).edge <= best + 1e-12);
  }
});

test("invalid priors and arguments are refused with a message", () => {
  for (const prior of [FIXED, UNIFORM, THIRD, HALF, BROOME]) assert.equal(problem(prior), null);
  const bad = [null, {}, { kind: "normal" }, { kind: "fixed", n: -1 }, { kind: "fixed", n: 1.5 }, { kind: "fixed", n: MAX_N + 1 }, { kind: "uniform", count: 0 }, { kind: "uniform", count: 2.5 },
    { kind: "doubling", q: 0 }, { kind: "doubling", q: 1 }, { kind: "doubling", q: NaN }, { kind: "doubling", q: "0.5" }];
  for (const prior of bad) {
    assert.equal(typeof problem(prior), "string", JSON.stringify(prior));
    assert.throws(() => meanSmaller(prior), RangeError);
    assert.throws(() => seenTable(prior), RangeError);
    assert.throws(() => simulate(rng(1), prior, 10, 3), RangeError);
  }
  assert.throws(() => simulate(rng(1), UNIFORM, 0, 3), RangeError);
  assert.throws(() => simulate(rng(1), UNIFORM, 10.5, 3), RangeError);
  assert.throws(() => simulate(rng(1), UNIFORM, 10, 2.5), RangeError);
  assert.throws(() => strategyExact(UNIFORM, NaN), RangeError);
});

test("the sampler draws from the stated prior (fixed seed)", () => {
  const N = 200000;
  for (const prior of [UNIFORM, THIRD, BROOME, { kind: "doubling", q: 0.9 }]) {
    const r = rng(4);
    const counts = new Map();
    for (let i = 0; i < N; i++) { const n = drawSmaller(r, prior); counts.set(n, (counts.get(n) || 0) + 1); }
    for (let n = 0; n < 12; n++) close((counts.get(n) || 0) / N, weight(prior, n), 0.004);
    assert.ok([...counts.keys()].every((n) => Number.isInteger(n) && n >= 0 && weight(prior, n) > 0));
  }
  assert.equal(drawSmaller(rng(1), FIXED), 6);
  // The generator returns multiples of 2^-32, which caps the doubling prior: at q = 2/3 the largest n is 54.
  assert.equal(drawSmaller(() => 1 - 2 ** -32, BROOME), 54);
  assert.equal(drawSmaller(() => 0, BROOME), 0);
  // One of the two envelopes always holds exactly twice the other, and every amount is finite.
  const r = rng(9);
  for (let i = 0; i < 5000; i++) {
    const d = deal(r, { kind: "doubling", q: 0.9 });
    assert.equal(d.holdsSmaller ? d.other : d.mine, 2 * (d.holdsSmaller ? d.mine : d.other));
    assert.ok(Number.isFinite(d.mine) && Number.isFinite(d.other) && d.mine === 2 ** d.j);
  }
});

test("simulation agrees with the exact values for a finite-mean prior (fixed seed)", () => {
  const sim = simulate(rng(5), UNIFORM, 400000, 9);
  const x = strategyExact(UNIFORM, 9);
  close(sim.keep, x.keep, 1.5);
  close(sim.switch, x.switch, 1.5);
  close(sim.threshold, x.threshold, 1.5);
  close(sim.edge, x.edge, 0.5);
  close(sim.threshold - sim.keep, sim.edge, 1e-6);
  for (const row of seenTable(UNIFORM).rows) {
    const a = sim.amounts.get(row.j);
    close(a.count / sim.rounds, row.chance, 0.003);
    close(a.otherLarger / a.count, row.otherLarger, row.otherLarger === 0.5 ? 0.01 : 0);
  }
  // The simulation scores exactly the deals that deal() hands out to the hand-played game.
  const r = rng(77);
  let keep = 0, swap = 0, thr = 0;
  for (let i = 0; i < 5000; i++) { const d = deal(r, BROOME); keep += d.mine; swap += d.other; thr += d.j <= 4 ? d.other : d.mine; }
  const replay = simulate(rng(77), BROOME, 5000, 4);
  assert.deepEqual([replay.keep, replay.switch, replay.threshold], [keep / 5000, swap / 5000, thr / 5000]);
  // Standard errors, by hand for the fixed pair 64 / 128: switching gains +64 or −64 (sd 64), and the rule
  // "switch on 64 or less" gains +64 or 0 (sd 32), each with chance one half.
  const f = simulate(rng(3), FIXED, 40000, 6);
  close(f.switchGainSe, 64 / Math.sqrt(40000), 1e-3);
  close(f.edgeSe, 32 / Math.sqrt(40000), 1e-3);
  close(f.switchGain, f.switch - f.keep, 1e-9);
  assert.ok(Math.abs(f.edge - 32) < 3 * f.edgeSe && Math.abs(f.switchGain) < 3 * f.switchGainSe);
  assert.ok(Math.abs(sim.edge - x.edge) < 3 * sim.edgeSe && Math.abs(sim.switchGain) < 3 * sim.switchGainSe);
  // Same seed, same answer; the history ends on the final averages.
  const again = simulate(rng(5), UNIFORM, 400000, 9);
  assert.equal(again.keep, sim.keep);
  assert.deepEqual(sim.history.at(-1), [400000, sim.keep, sim.switch, sim.threshold]);
  assert.ok(sim.history.length < 350);
});

test("simulation with an infinite mean: the conditional chance and the threshold's edge still match", () => {
  const sim = simulate(rng(6), BROOME, 400000, 5);
  for (let j = 1; j <= 8; j++) { const a = sim.amounts.get(j); close(a.otherLarger / a.count, 2 / 5, 0.015); }
  assert.equal(sim.amounts.get(0).otherLarger, sim.amounts.get(0).count);
  close(sim.edge, strategyExact(BROOME, 5).edge, 0.03);
  // The averages themselves are dominated by the largest deal and are far above any typical amount.
  assert.ok(sim.keep > 1000 && sim.switch > 1000);
});

test("the numbers quoted under 'One finding' (uniform over 1 to 512, seed 28, 100,000 rounds)", () => {
  const x = strategyExact(UNIFORM, 9);
  const sim = simulate(rng(28), UNIFORM, 100000, 9);
  assert.equal(x.keep.toFixed(2), "153.45");
  assert.equal(x.switch.toFixed(2), "153.45");
  assert.equal(x.threshold.toFixed(2), "179.05");
  assert.equal((100 * (x.threshold / x.keep - 1)).toFixed(1), "16.7");
  assert.equal(sim.keep.toFixed(2), "154.02");
  assert.equal(sim.switch.toFixed(2), "153.43");
  assert.equal(sim.threshold.toFixed(2), "179.16");
  // "True for nine of the eleven amounts you can see. It is false at the two ends: at 1, where the other envelope
  // always holds 2, and at 1,024, where switching always loses 512."
  const { rows } = seenTable(UNIFORM);
  assert.equal(rows.length, 11);
  assert.equal(rows.filter((r) => r.otherLarger === 0.5).length, 9);
  assert.deepEqual([rows[0].amount, rows[0].otherLarger, rows[0].gain], [1, 1, 1]);
  assert.deepEqual([rows.at(-1).amount, rows.at(-1).otherLarger, rows.at(-1).gain], [1024, 0, -512]);
});
