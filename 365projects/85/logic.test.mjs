import test from "node:test";
import assert from "node:assert/strict";
import {
  LIMITS, chanceFromEdge, edgeOf, maxEdge, kelly, growth, growthZero, kellyGrowth, logVariance, readBet, strategies,
  finalExact, ruinExact, ruinLongRun, createSimulation, wealthQuantile, wilson,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const simulate = (spec) => { const s = createSimulation(spec); while (s.done < s.bettors) s.run(300); return s; };

test("Kelly's stake is edge over odds, worked by hand, and nothing when the edge is not positive", () => {
  close(kelly(0.55, 1), 0.1, 1e-15); // 0.55 - 0.45 / 1
  close(kelly(0.6, 2), 0.4, 1e-15); // 0.6 - 0.4 / 2
  close(kelly(0.12, 9), 0.12 - 0.88 / 9, 1e-15); // a long shot: 2.2%
  for (const [p, b] of [[0.55, 1], [0.6, 2], [0.12, 9], [0.3, 4]]) close(kelly(p, b), edgeOf(p, b) / b, 1e-15);
  assert.equal(kelly(0.5, 1), 0); // a fair coin: no edge
  assert.equal(kelly(18 / 37, 1), 0); // red at single-zero roulette: edge -1/37
  close(edgeOf(18 / 37, 1), -1 / 37, 1e-15);
  assert.equal(kelly(0, 5), 0);
  close(chanceFromEdge(0.1, 1), 0.55, 1e-15);
  close(chanceFromEdge(edgeOf(0.3, 4), 4), 0.3, 1e-15);
  close(maxEdge(1), 0.998, 1e-12);
});

test("the Kelly stake maximises the growth rate, which has a closed form", () => {
  for (const [p, b] of [[0.55, 1], [0.6, 2], [0.12, 9], [0.3, 4], [0.9, 0.5]]) {
    const k = kelly(p, b);
    // A fine search over stakes finds no higher growth rate.
    let best = -Infinity, at = 0;
    for (let f = 0; f < 0.999; f += 1e-4) { const g = growth(f, p, b); if (g > best) { best = g; at = f; } }
    close(at, k, 1e-4);
    close(growth(k, p, b), kellyGrowth(p, b), 1e-14);
    // The slope is zero there: p b / (1 + b f) = (1 - p) / (1 - f).
    close((p * b) / (1 + b * k), (1 - p) / (1 - k), 1e-12);
  }
  // At even money the growth rate is ln 2 times one minus the entropy of the coin in bits: Kelly's information rate.
  for (const p of [0.51, 0.55, 0.7, 0.9]) {
    const H = -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
    close(kellyGrowth(p, 1), Math.LN2 * (1 - H), 1e-14);
  }
  close(growth(0.1, 0.55, 1), 0.55 * Math.log(1.1) + 0.45 * Math.log(0.9), 1e-15);
  assert.equal(growth(0, 0.3, 2), 0);
  close(growth(0.2, 0, 2), Math.log(0.8), 1e-15); // never wins
});

test("half Kelly keeps about three quarters of the growth; twice Kelly keeps about none (small edges)", () => {
  for (const [p, b, tol] of [[0.51, 1, 0.01], [0.505, 1, 0.01], [0.21, 4, 0.05]]) {
    const k = kelly(p, b), g = growth(k, p, b);
    close(growth(k / 2, p, b) / g, 0.75, tol);
    close(growth(2 * k, p, b) / g, 0, tol);
  }
  // Beyond twice Kelly the growth rate is negative even though every bet has a positive edge.
  assert.ok(growth(2.5 * kelly(0.55, 1), 0.55, 1) < 0);
});

test("where growth falls back to zero: near twice Kelly only for small edges (the figures quoted on the page)", () => {
  const ratio = (p, b) => growthZero(p, b) / kelly(p, b);
  assert.equal(ratio(0.55, 1).toFixed(2), "1.99");
  assert.equal(ratio(0.12, 9).toFixed(2), "2.11");
  assert.equal(ratio(0.8, 1).toFixed(2), "1.55");
  assert.equal(ratio(0.999, 0.01).toFixed(2), "1.11");
  close(growth(growthZero(0.55, 1), 0.55, 1), 0, 1e-14);
  assert.ok(Math.abs(ratio(0.501, 1) - 2) < 0.01);
  assert.equal(growthZero(0.5, 1), null); // no edge
  assert.equal(growthZero(0.999, 1000), null); // growth stays positive for every stake below the whole bankroll
});

test("the bankroll after M bets, worked by hand for two bets", () => {
  // p = 0.6, b = 1, stake 50%: WW 2.25 (0.36), one of each 0.75 (0.48), LL 0.25 (0.16).
  const r = finalExact(0.5, 0.6, 1, 2);
  close(r.median, 0.75, 1e-12);
  close(r.below, 0.64, 1e-12);
  close(r.mean, 1.21, 1e-12); // 0.36 x 2.25 + 0.48 x 0.75 + 0.16 x 0.25 = (1 + 0.5 x 0.2)^2
  const zero = finalExact(0, 0.6, 1, 50);
  assert.equal(zero.median, 1);
  assert.equal(zero.below, 0);
  // A stake of exactly break-even size can end exactly at the start: that is not "below".
  close(finalExact(0.5, 0.5, 2, 2).below, 0.25, 1e-15); // W L ends at 2 x 0.5 = 1, only L L (0.25) is below
});

test("the chance of falling to the line at some point, worked by hand, matches the dynamic program", () => {
  // p = 0.6, b = 1, stake 50%, two bets. Line 0.5: a first loss lands on it (0.4). Line 0.3: only L L (0.25) gets there.
  close(ruinExact(0.5, 0.6, 1, 2, 0.5), 0.4, 1e-15);
  close(ruinExact(0.5, 0.6, 1, 2, 0.3), 0.16, 1e-15);
  // Three bets, line 0.3: L L (0.16), W L L ends at 0.375 and L W L at 0.375: still only paths through L L.
  close(ruinExact(0.5, 0.6, 1, 3, 0.3), 0.16, 1e-15);
  assert.equal(ruinExact(0, 0.6, 1, 100, 0.5), 0);
  // More bets can only add chances to fall.
  assert.ok(ruinExact(0.1, 0.55, 1, 500, 0.5) <= ruinExact(0.1, 0.55, 1, 1000, 0.5));
  // Brute force over every one of the 2^12 sequences for a 12-bet game agrees with the program.
  const p = 0.58, b = 1.3, f = 0.3, line = 0.4, M = 12;
  let brute = 0;
  for (let mask = 0; mask < 1 << M; mask++) {
    let w = 1, pr = 1, fell = false;
    for (let t = 0; t < M; t++) {
      const win = (mask >> t) & 1;
      pr *= win ? p : 1 - p;
      w *= win ? 1 + b * f : 1 - f;
      if (w <= line + 1e-12) fell = true;
    }
    if (fell) brute += pr;
  }
  close(ruinExact(f, p, b, M, line), brute, 1e-12);
});

test("the long-run Brownian approximation gives line^(2/c - 1) at c times Kelly: one half for halving at Kelly", () => {
  const p = 0.501, b = 1, k = kelly(p, b);
  for (const c of [0.25, 0.5, 1, 1.5]) close(ruinLongRun(c * k, p, b, 0.5), 0.5 ** (2 / c - 1), 0.01);
  close(ruinLongRun(k, p, b, 0.1), 0.1, 0.005);
  assert.equal(ruinLongRun(2.2 * k, p, b, 0.5), 1); // no growth: certain in the long run
  assert.equal(ruinLongRun(0, p, b, 0.5), 0);
  assert.equal(ruinLongRun(0.1, 18 / 37, 1, 0.5), 1); // a negative edge
  close(logVariance(0.1, 0.55, 1), 0.55 * 0.45 * (Math.log(1.1) - Math.log(0.9)) ** 2, 1e-15);
});

test("simulated bettors agree with the exact chances, and their log growth with g(f)", () => {
  const p = 0.55, b = 1, M = 1000, line = 0.5;
  const st = strategies(p, b, 0.25);
  const sim = simulate({ p, b, M, bettors: 5000, seed: 11, stakes: st.map((s) => s.f), line });
  st.forEach((s, i) => {
    const w = wilson(sim.ruined[i], sim.bettors);
    const exact = ruinExact(s.f, p, b, M, line);
    assert.ok(w.low <= exact && exact <= w.high, `${s.label}: ruin ${exact} outside ${w.low}..${w.high}`);
    const below = wilson(sim.below[i], sim.bettors), ex = finalExact(s.f, p, b, M).below;
    assert.ok(below.low <= ex && ex <= below.high, `${s.label}: below ${ex} outside ${below.low}..${below.high}`);
  });
  // Mean log growth per bet across bettors, against g(f) = p ln(1 + bf) + (1 - p) ln(1 - f).
  const f = 0.1, A = Math.log1p(b * f), B = Math.log1p(-f);
  let sum = 0;
  for (const w of sim.finalWins) sum += (w * A + (M - w) * B) / M;
  const sd = Math.sqrt(p * (1 - p)) * (A - B) / Math.sqrt(M * sim.bettors);
  close(sum / sim.bettors, growth(f, p, b), 4 * sd);
  // The simulated median bankroll at the end is the exact one, or one win either side.
  const med = wealthQuantile(sim, sim.marks.length - 1, f, b, 0.5);
  const exact = finalExact(f, p, b, M).median;
  assert.ok(Math.abs(Math.log(med / exact)) <= A - B + 1e-9, `${med} against ${exact}`);
});

test("the same seed gives the same bettors, however the work is sliced", () => {
  const spec = { p: 0.55, b: 1, M: 200, bettors: 300, seed: 5, stakes: [0.05, 0.1, 0.2], line: 0.5 };
  const a = simulate(spec);
  const c = createSimulation(spec);
  while (c.done < c.bettors) c.run(7);
  assert.deepEqual([...a.finalWins], [...c.finalWins]);
  assert.deepEqual(a.ruined, c.ruined);
  assert.notDeepEqual([...simulate({ ...spec, seed: 6 }).finalWins], [...a.finalWins]);
  assert.equal(a.marks[0], 0);
  assert.equal(a.marks.at(-1), 200);
  assert.equal(wealthQuantile(a, 0, 0.1, 1, 0.5), 1);
});

test("a negative edge stakes nothing, and stakes of the whole bankroll or more are flagged", () => {
  const st = strategies(18 / 37, 1, 0.05);
  assert.deepEqual(st.map((s) => s.f), [0, 0, 0, 0.05]);
  assert.ok(st.every((s) => s.possible));
  assert.ok(growth(0.05, 18 / 37, 1) < 0);
  const big = strategies(0.8, 1, 0.1); // Kelly 60%, so twice Kelly is 120%
  close(big[1].f, 0.6, 1e-15);
  assert.equal(big[2].possible, false);
  assert.equal(strategies(0.75, 1, 0)[2].possible, false); // exactly 100%
});

test("inputs are checked, with messages that say what to fix", () => {
  const r = readBet({ mode: "edge", odds: 1, edge: 10 });
  assert.ok(r.ok);
  close(r.p, 0.55, 1e-15);
  close(r.edge, 0.1, 1e-15);
  const c = readBet({ mode: "chance", odds: 1, chance: 55 });
  close(c.edge, 0.1, 1e-15);
  assert.match(readBet({ mode: "edge", odds: 1, edge: 150 }).errors[0].message, /At odds of 1 to 1 the edge can be at most 99\.80%/);
  assert.match(readBet({ mode: "edge", odds: 1, edge: -120 }).errors[0].message, /cannot be below -100%/);
  assert.match(readBet({ mode: "chance", odds: 1, chance: 100 }).errors[0].message, /a sure thing is not a bet/);
  assert.match(readBet({ mode: "chance", odds: 1, chance: -1 }).errors[0].message, /cannot be below 0%/);
  assert.match(readBet({ mode: "chance", odds: 0, chance: 50 }).errors[0].message, /odds must be from 0\.01 to 1,000/);
  assert.match(readBet({ mode: "edge", odds: NaN, edge: 5 }).errors[0].message, /Enter the odds/);
  assert.match(readBet({ mode: "edge", odds: 2, edge: NaN }).errors[0].message, /Enter the edge/);
  assert.equal(readBet({ mode: "edge", odds: 1e308, edge: 5 }).ok, false);
  // The extremes that are allowed give finite answers.
  for (const [mode, odds, v] of [["chance", 0.01, 99.9], ["chance", 1000, 0], ["edge", 1000, -100], ["chance", 1000, 99.9], ["edge", 0.01, maxEdge(0.01) * 100]]) {
    const x = readBet({ mode, odds, edge: v, chance: v });
    assert.ok(x.ok, `${mode} ${odds} ${v}`);
    for (const s of strategies(x.p, x.b, 0.99).filter((s) => s.possible)) {
      assert.ok(Number.isFinite(growth(s.f, x.p, x.b)));
      const fe = finalExact(s.f, x.p, x.b, LIMITS.bets.max);
      // The multiples themselves can overflow (a 1000-to-1 shot won 99.9% of the time); their logs cannot.
      assert.ok(Number.isFinite(fe.logMedian) && Number.isFinite(fe.logMean) && fe.below >= 0 && fe.below <= 1, `${mode} ${odds} ${v} ${s.label}`);
      const ru = ruinExact(s.f, x.p, x.b, 200, 0.5);
      assert.ok(ru >= 0 && ru <= 1);
    }
  }
});

test("Wilson intervals", () => {
  const w = wilson(50, 100);
  close(w.low, 0.40383153, 1e-6); // the standard Wilson score interval for 50 of 100
  close(w.high, 0.59616847, 1e-6);
  assert.deepEqual([wilson(0, 10).low, wilson(10, 10).high], [0, 1]);
});

test("the finding: a 10% edge at even money, 1,000 bets, the line at half the bankroll", () => {
  const p = 0.55, b = 1, M = 1000, line = 0.5;
  const at = (f) => ({ g: growth(f, p, b), end: finalExact(f, p, b, M), ruin: ruinExact(f, p, b, M, line) });
  const k = at(0.1), half = at(0.05), dbl = at(0.2);
  assert.equal(Math.round(k.end.median), 150);
  assert.equal(Math.round(k.ruin * 100), 47);
  assert.equal(Math.round(half.end.median), 43);
  assert.equal((half.ruin * 100).toFixed(1), "11.5");
  assert.equal((half.g / k.g).toFixed(2), "0.75");
  assert.equal(dbl.end.median.toFixed(2), "0.87");
  assert.equal(Math.round(dbl.ruin * 100), 90);
  assert.equal(Math.round(dbl.end.mean / 1e6), 398); // the average bankroll: 398 million times the start
  // The long-run chances of ever halving: about one half at Kelly and one eighth at half Kelly.
  assert.equal(ruinLongRun(0.1, p, b, line).toFixed(2), "0.50");
  assert.equal(ruinLongRun(0.05, p, b, line).toFixed(2), "0.12");
});
