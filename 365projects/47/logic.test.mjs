import test from "node:test";
import assert from "node:assert/strict";
import { AGENT_CHOICES, LIMITS, DEFAULTS, problem, createSim, stepRound, giniSorted, measure, giniCeiling, poorerDrift, criticalChance, driftFigures, EXPONENTIAL } from "./logic.js";

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const FAIR = { kind: "yardsale", stake: 0.1, richerWins: 0.5, tax: 0 };
const POOLED = { kind: "pooled", saving: 0, tax: 0 };

/** Run a rule from an equal start and return the simulation. */
function run(rule, rounds, { agents = 500, seed = 47 } = {}) {
  const sim = createSim({ agents, seed });
  for (let r = 0; r < rounds; r++) stepRound(sim, rule);
  return sim;
}
/** The average of a measure over the rounds from `from` + 1 to `to`. */
function average(rule, from, to, key, opts) {
  const sim = run(rule, from, opts);
  let sum = 0;
  for (let r = from; r < to; r++) { stepRound(sim, rule); sum += measure(sim)[key]; }
  return sum / (to - from);
}
/** A simulation of two agents whose "random" numbers are a list written out by hand. */
function scripted(wealth, numbers) {
  let k = 0;
  return { w: Float64Array.from(wealth), round: 0, rand: () => { assert.ok(k < numbers.length, "more random numbers used than expected"); return numbers[k++]; }, used: () => k };
}

/* ---------- single trades, by hand ---------- */

test("a yard-sale trade moves the stake, a share of the poorer party's wealth, from loser to winner", () => {
  // Two agents with 1 and 3. Each trade uses three numbers: who goes first, who the partner is, and the coin.
  // Trade 1: 0.6 picks agent 1 (wealth 3), partner agent 0 (wealth 1). Stake 10% of 1 = 0.1. Agent 1 is the richer and
  //          wins with probability 0.5; the coin 0.2 is below that, so agent 1 wins: 3.1 and 0.9.
  // Trade 2: 0.1 picks agent 0 (0.9), partner agent 1 (3.1). Stake 0.09. Agent 0 is the poorer and wins with probability
  //          1 - 0.5; the coin 0.7 is not below that, so agent 0 loses: 0.81 and 3.19.
  const sim = scripted([1, 3], [0.6, 0.3, 0.2, 0.1, 0.9, 0.7]);
  stepRound(sim, FAIR);
  close(sim.w[0], 0.81, 1e-15);
  close(sim.w[1], 3.19, 1e-15);
  assert.equal(sim.round, 1);
  assert.equal(sim.used(), 6);
});

test("the richer party's chance of winning is the setting, and a fair coin decides between equals", () => {
  // Agent 1 (3) meets agent 0 (1) with the coin at 0.6. With the richer party winning 70% of the time agent 1 wins.
  let sim = scripted([1, 3], [0.6, 0.3, 0.6, 0.6, 0.3, 0.6]);
  stepRound(sim, { ...FAIR, richerWins: 0.7 });
  close(sim.w[1], 3.1 + 0.09, 1e-15);     // wins 0.1, then wins 10% of 0.9
  // With the richer party winning only 30% of the time the same coin makes it lose both trades.
  sim = scripted([1, 3], [0.6, 0.3, 0.6, 0.6, 0.3, 0.6]);
  stepRound(sim, { ...FAIR, richerWins: 0.3 });
  close(sim.w[1], 2.9 - 0.11, 1e-15);     // loses 0.1, then loses 10% of 1.1
  close(sim.w[0], 1.1 + 0.11, 1e-15);
  // Equal wealth: the coin is fair whatever the setting. 0.4 is below 0.5, so the first agent picked wins.
  sim = scripted([2, 2], [0.6, 0.3, 0.4, 0.6, 0.3, 0.9]);
  stepRound(sim, { ...FAIR, richerWins: 0.3 });
  // Trade 1: agent 1 wins 0.2 (2.2 and 1.8). Trade 2: agent 1 is now the richer, wins with probability 0.3, coin 0.9: loses 0.18.
  close(sim.w[1], 2.02, 1e-15);
  close(sim.w[0], 1.98, 1e-15);
});

test("a pooled trade splits what is not saved at a random point", () => {
  // Agent 1 (3) meets agent 0 (1). Each saves half: 1.5 and 0.5 stay put and the pool is 2. The split 0.25 gives agent 1
  // a quarter of the pool: 1.5 + 0.5 = 2, and agent 0 the rest, 2.
  // Second trade: agent 0 (2) meets agent 1 (2); the pool is 2 again and the split 0.75 gives agent 0 1 + 1.5 = 2.5.
  const sim = scripted([1, 3], [0.6, 0.3, 0.25, 0.1, 0.9, 0.75]);
  stepRound(sim, { kind: "pooled", saving: 0.5, tax: 0 });
  close(sim.w[0], 2.5, 1e-15);
  close(sim.w[1], 1.5, 1e-15);
  // With nothing saved the whole of both fortunes is split.
  const all = scripted([1, 3], [0.6, 0.3, 0.25, 0.6, 0.3, 0.5]);
  stepRound(all, POOLED);
  close(all.w[0], 2, 1e-15);    // trade 1: agent 1 gets 0.25 * 4 = 1, agent 0 gets 3. Trade 2: agent 1 gets half of 4.
  close(all.w[1], 2, 1e-15);
});

test("the tax moves every agent the same fraction of the way to the average", () => {
  // The two trades below leave 0.81 and 3.19 (see the first test). The average is 2. A 10% tax takes 0.081 and 0.319,
  // 0.4 in all, and hands back 0.2 each: 0.81 + 0.119 = 0.929 and 3.19 - 0.119 = 3.071.
  const sim = scripted([1, 3], [0.6, 0.3, 0.2, 0.1, 0.9, 0.7]);
  stepRound(sim, { ...FAIR, tax: 0.1 });
  close(sim.w[0], 0.929, 1e-15);
  close(sim.w[1], 3.071, 1e-15);
});

/* ---------- what must always hold ---------- */

test("total wealth is conserved to rounding and nobody goes below zero, under every rule", () => {
  const rules = [
    FAIR, { ...FAIR, stake: 0.5 }, { ...FAIR, richerWins: 0.7 }, { ...FAIR, richerWins: 0.3, tax: 0.1 }, { ...FAIR, stake: 0.01, tax: 0.001 },
    POOLED, { kind: "pooled", saving: 0.95, tax: 0 }, { kind: "pooled", saving: 0.5, tax: 0.05 },
  ];
  for (const rule of rules) {
    for (const agents of [100, 2000]) {
      const sim = run(rule, agents === 100 ? 5000 : 500, { agents });
      const m = measure(sim);
      assert.ok(Math.abs(m.total - agents) < 1e-9 * agents, `${JSON.stringify(rule)} with ${agents} agents drifted to ${m.total}`);
      assert.ok(m.min >= 0, `${JSON.stringify(rule)}: an agent went below zero (${m.min})`);
      assert.ok(Number.isFinite(m.gini) && m.gini >= 0 && m.gini <= giniCeiling(agents));
    }
  }
});

test("a run is fixed by its seed, however the rounds are sliced", () => {
  const a = run(FAIR, 300), b = run(FAIR, 300);
  assert.deepEqual([...a.w], [...b.w]);
  // 300 rounds in one go, or 120 then 180 with measurements in between, are the same run.
  const c = createSim({ agents: 500, seed: 47 });
  for (let r = 0; r < 120; r++) stepRound(c, FAIR);
  measure(c);
  for (let r = 0; r < 180; r++) { stepRound(c, FAIR); if (r % 7 === 0) measure(c); }
  assert.deepEqual([...c.w], [...a.w]);
  assert.equal(c.round, 300);
  assert.notDeepEqual([...run(FAIR, 300, { seed: 48 }).w], [...a.w]);
});

test("everyone starts with 1, and settings out of range are refused with a reason", () => {
  const sim = createSim({ agents: 200, seed: 1 });
  assert.equal(sim.w.length, 200);
  assert.ok(sim.w.every((v) => v === 1));
  assert.equal(sim.round, 0);
  assert.equal(problem(DEFAULTS), "");
  assert.equal(problem({ ...DEFAULTS, kind: "pooled", saving: 0.95, tax: 0.1 }), "");
  for (const edge of [LIMITS.stake, LIMITS.richerWins]) assert.equal(problem({ ...DEFAULTS, stake: LIMITS.stake[0], richerWins: edge === LIMITS.richerWins ? edge[1] : 0.5 }), "");
  const bad = [
    [null, /trading rules/], [{ ...DEFAULTS, kind: "barter" }, /trading rules/],
    [{ ...DEFAULTS, agents: 150 }, /number of agents/], [{ ...DEFAULTS, agents: 1e9 }, /number of agents/],
    [{ ...DEFAULTS, seed: 1.5 }, /whole number/], [{ ...DEFAULTS, seed: -1 }, /whole number/], [{ ...DEFAULTS, seed: 1e6 }, /whole number/], [{ ...DEFAULTS, seed: NaN }, /whole number/],
    [{ ...DEFAULTS, tax: 0.2 }, /tax/], [{ ...DEFAULTS, tax: -0.01 }, /tax/], [{ ...DEFAULTS, tax: "1" }, /tax/],
    [{ ...DEFAULTS, stake: 0 }, /stake/], [{ ...DEFAULTS, stake: 0.6 }, /stake/], [{ ...DEFAULTS, stake: Infinity }, /stake/],
    [{ ...DEFAULTS, richerWins: 0.8 }, /chance/], [{ ...DEFAULTS, richerWins: 0.2 }, /chance/],
    [{ ...DEFAULTS, kind: "pooled", saving: 1 }, /saved/], [{ ...DEFAULTS, kind: "pooled", saving: -0.1 }, /saved/],
  ];
  for (const [settings, pattern] of bad) assert.match(problem(settings), pattern);
  // Settings that belong to the other rule are not checked.
  assert.equal(problem({ ...DEFAULTS, kind: "pooled", stake: 99 }), "");
  assert.equal(problem({ ...DEFAULTS, saving: 99 }), "");
  assert.deepEqual(AGENT_CHOICES.filter((n) => n % 100), []);
});

/* ---------- the measures ---------- */

test("the measures match hand-worked distributions", () => {
  const of = (w) => measure({ w: Float64Array.from(w), round: 7 });
  // Everyone equal.
  let m = of(Array(100).fill(2));
  close(m.gini, 0); close(m.top1, 0.01); close(m.top10, 0.1); close(m.bottom50, 0.5); close(m.richest, 0.01);
  m.tenths.forEach((t) => close(t, 0.1));
  assert.equal(m.round, 7);
  assert.equal(m.total, 200);
  // One agent has everything: the Gini is (n - 1) / n, the most 100 agents can show.
  m = of([...Array(99).fill(0), 100]);
  close(m.gini, 0.99); assert.equal(giniCeiling(100), 0.99);
  close(m.top1, 1); close(m.top10, 1); close(m.bottom50, 0); close(m.richest, 1); assert.equal(m.median, 0);
  // Wealth of 1, 2, ..., 100 in a shuffled order: total 5,050. The Gini of 1..n is (n - 1) / (3n) = 0.33.
  const ramp = Array.from({ length: 100 }, (_, i) => ((i * 37) % 100) + 1);
  m = of(ramp);
  close(m.gini, 0.33);
  close(m.top1, 100 / 5050);
  close(m.top10, 955 / 5050);        // 91 + 92 + ... + 100
  close(m.bottom50, 1275 / 5050);    // 1 + 2 + ... + 50
  close(m.tenths[0], 55 / 5050);
  assert.equal(m.median, 50.5);
  assert.equal(m.max, 100);
  assert.equal(m.min, 1);
  close(giniSorted([1, 2, 3, 4]), 0.25);
  assert.ok(Number.isNaN(giniSorted([])));
  assert.ok(Number.isNaN(giniSorted([0, 0])));
});

/* ---------- theory ---------- */

test("pooled exchange with nothing saved settles on the exponential distribution: Gini 0.5", () => {
  const opts = { agents: 2000, seed: 3 };
  close(average(POOLED, 100, 400, "gini", opts), 0.5, 0.01);
  close(average(POOLED, 100, 400, "top10", opts), EXPONENTIAL.top10, 0.01);
  close(average(POOLED, 100, 400, "bottom50", opts), EXPONENTIAL.bottom50, 0.01);
  close(average(POOLED, 100, 400, "top1", opts), EXPONENTIAL.top1, 0.005);
  close(EXPONENTIAL.top10, 0.3303, 0.00005);
  close(EXPONENTIAL.bottom50, 0.1534, 0.00005);
  close(EXPONENTIAL.top1, 0.0561, 0.00005);
});

test("the more each party saves, the more equal the pooled economy stays", () => {
  const ginis = [0, 0.3, 0.6, 0.9].map((saving) => average({ kind: "pooled", saving, tax: 0 }, 100, 300, "gini", { agents: 1000, seed: 5 }));
  for (let i = 1; i < ginis.length; i++) assert.ok(ginis[i] < ginis[i - 1] - 0.05, `saving more must lower the Gini: ${ginis}`);
  // Saving half gives a Gini near 0.27 (a gamma distribution with shape 4 would give 0.2734).
  close(average({ kind: "pooled", saving: 0.5, tax: 0 }, 100, 300, "gini", { agents: 1000, seed: 5 }), 0.273, 0.012);
});

test("the poorer party's drift and the critical chance match the formulas", () => {
  close(poorerDrift(0.1, 0.5), Math.log(0.99) / 2, 1e-15);            // (ln 1.1 + ln 0.9) / 2 = ln(1 - 0.01) / 2
  close(poorerDrift(0.1, 0.5), -0.0050252, 5e-8);
  close(poorerDrift(0.5, 0.4), 0.6 * Math.log(1.5) + 0.4 * Math.log(0.5), 1e-15);
  close(poorerDrift(0.5, 0.4), -0.0339798, 5e-8);                     // 0.2432791 - 0.2772589
  close(criticalChance(0.1), 0.474958, 5e-7);                          // ln 1.1 / (ln 1.1 - ln 0.9) = 0.0953102 / 0.2006707
  for (const stake of [0.01, 0.05, 0.1, 0.2, 0.35, 0.5]) {
    const q = criticalChance(stake);
    close(poorerDrift(stake, q), 0, 1e-15);
    assert.ok(q < 0.5 && q > 0.36, `the critical chance for a stake of ${stake} is ${q}`);
    assert.ok(poorerDrift(stake, 0.5) < 0, "a fair coin always leaves the poorer party with negative drift");
    assert.ok(poorerDrift(stake, q - 0.02) > 0 && poorerDrift(stake, q + 0.02) < 0);
  }
});

test("the printed drift never contradicts its sign, at any stop of the two sliders", () => {
  assert.deepEqual(driftFigures(0.1, 0.5), { drift: poorerDrift(0.1, 0.5), change: "-0.501", critical: "47.5" });
  // A stake of 4% puts the critical chance at 48.9997%, a hair below the slider's stop at 49%.
  assert.deepEqual([driftFigures(0.04, 0.49).change, driftFigures(0.04, 0.49).critical], ["-0.000021", "48.9997"]);
  // Richer party wins 40%: 0.6 ln 1.1 + 0.4 ln 0.9 = 0.0571861 - 0.0421442 = 0.0150419, and exp of that is 1.015156.
  assert.equal(driftFigures(0.1, 0.4).change, "+1.516");
  for (let s = 1; s <= 50; s++) for (let q = 30; q <= 70; q += 0.5) {
    const f = driftFigures(s / 100, q / 100);
    assert.notEqual(f.drift, 0);
    assert.equal(Math.sign(Number(f.change)), Math.sign(f.drift), `stake ${s}%, chance ${q}%: prints ${f.change}`);
    // The drift is negative exactly when the setting is above the critical chance as printed.
    assert.equal(q > Number(f.critical), f.drift < 0, `stake ${s}%, chance ${q}%: critical prints as ${f.critical}`);
  }
});

test("fair bets concentrate wealth without limit; favouring the poorer party enough stops it", () => {
  const at = (rule, rounds) => measure(run(rule, rounds)).gini;
  const fair = [100, 500, 2000, 5000].map((r) => at(FAIR, r));
  for (let i = 1; i < fair.length; i++) assert.ok(fair[i] > fair[i - 1], `the Gini must keep rising: ${fair}`);
  assert.ok(fair[3] > 0.97);
  // Richer party wins 40%: below the critical 47.5% for a 10% stake, so the economy settles.
  const kind = { ...FAIR, richerWins: 0.4 };
  const early = average(kind, 500, 1000, "gini"), late = average(kind, 4500, 5000, "gini");
  close(early, late, 0.02);
  assert.ok(late < 0.3);
  // Richer party wins 55%: faster concentration than a fair coin.
  assert.ok(at({ ...FAIR, richerWins: 0.55 }, 500) > at(FAIR, 500) + 0.05);
});

test("a wealth tax holds the yard-sale economy at a steady spread", () => {
  const taxed = { ...FAIR, tax: 0.01 };
  const early = average(taxed, 500, 1000, "gini"), late = average(taxed, 4500, 5000, "gini");
  close(early, late, 0.02);
  assert.ok(late > 0.33 && late < 0.43, `Gini with a 1% tax settles at ${late}`);
  // A lighter tax leaves a wider spread.
  assert.ok(average({ ...FAIR, tax: 0.002 }, 4500, 5000, "gini") > late + 0.15);
});

/* ---------- the finding ---------- */

test("One finding: 500 equal agents, fair 10% bets, 1,000 rounds (seed 47)", () => {
  const m = measure(run(FAIR, 1000));
  assert.equal(m.round, 1000);
  assert.equal((100 * m.gini).toFixed(1), "87.9");
  assert.equal((100 * m.top10).toFixed(1), "79.9");
  assert.equal((100 * m.top1).toFixed(1), "21.4");
  assert.equal((100 * m.bottom50).toFixed(2), "0.04");
  close(m.total, 500, 1e-9);
  // The same economy with a 1% wealth tax each round.
  const taxed = measure(run({ ...FAIR, tax: 0.01 }, 1000));
  assert.equal((100 * taxed.gini).toFixed(1), "37.6");
  assert.equal((100 * taxed.top10).toFixed(1), "25.6");
  assert.equal((100 * taxed.bottom50).toFixed(1), "23.5");
  assert.deepEqual(DEFAULTS, { kind: "yardsale", stake: 0.1, richerWins: 0.5, saving: 0, tax: 0, agents: 500, seed: 47 });
});

/* ---------- added in review ---------- */

test("the finding is not an accident of seed 47: other seeds give the same shape", () => {
  // The write-up says other seeds give the same shape with different decimals. A separate program written from the
  // write-up, with another random-number generator, gave 87.8 to 89.6 without the tax and 37.4 to 39.0 with it over
  // twelve seeds. Here: eight other seeds of this generator.
  for (let seed = 1; seed <= 8; seed++) {
    const free = measure(run(FAIR, 1000, { seed })), taxed = measure(run({ ...FAIR, tax: 0.01 }, 1000, { seed }));
    assert.ok(free.gini > 0.865 && free.gini < 0.91, `seed ${seed}: Gini ${free.gini} without the tax`);
    assert.ok(free.bottom50 < 0.002, `seed ${seed}: the poorest half hold ${free.bottom50}`);
    assert.ok(taxed.gini > 0.36 && taxed.gini < 0.405, `seed ${seed}: Gini ${taxed.gini} with the tax`);
    assert.ok(taxed.bottom50 > 0.21 && taxed.bottom50 < 0.25, `seed ${seed}: the poorest half hold ${taxed.bottom50} with the tax`);
    close(free.total, 500, 1e-9); close(taxed.total, 500, 1e-9);
  }
});

test("the page's other examples after 1,000 rounds match a separate implementation of the two rules", () => {
  // Figures from a Python program written from "How it works" (same seed and order of draws: who, with whom, then the
  // coin or the split): 48.82, 24.48, 51.19 and 27.41.
  const gini = (rule) => (100 * measure(run(rule, 1000)).gini).toFixed(2);
  assert.equal(gini({ ...FAIR, richerWins: 0.55, tax: 0.01 }), "48.82");
  assert.equal(gini({ ...FAIR, richerWins: 0.4 }), "24.48");
  assert.equal(gini(POOLED), "51.19");
  assert.equal(gini({ kind: "pooled", saving: 0.5, tax: 0 }), "27.41");
});
