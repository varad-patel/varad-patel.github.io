import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { MARKET, GRID, DEFAULTS, LIMITS, exp, share, profit, benchmarks, bestReplyTo, grimThreshold, buildGame, profitGain, problem, defaultCap, createSession, summarise } from "./logic.js";

const close = (x, y, tol = 1e-9) => assert.ok(Math.abs(x - y) <= tol, `${x} is not within ${tol} of ${y}`);
const game = buildGame();
const range = (n, from = 1) => Array.from({ length: n }, (_, i) => from + i);

function finish(settings) {
  const s = createSession({ game, ...settings });
  while (!s.done) s.advance(250000);
  return s;
}
/** Run seeds to the end and collect what the page shows for each. */
function batch(settings, seeds) {
  const runs = seeds.map((seed) => { const s = finish({ ...settings, seed }); return { seed, s, lim: s.limit(), cut: s.deviate({ bot: 0 }) }; });
  const cuts = runs.filter((x) => x.cut.cut);
  return { runs, sum: summarise(runs.map((x) => x.lim)), cuts: cuts.length, answered: cuts.filter((x) => x.cut.punished).length, lost: cuts.filter((x) => x.cut.gain < 0).length, settled: runs.filter((x) => x.s.settled).length };
}

/* ---------------------------------------------------------------- the one-period game */

test("exp: the same as Math.exp to one part in 10^13, built from arithmetic only", () => {
  assert.equal(exp(0), 1);
  for (let x = -12; x <= 12; x += 0.137) close(exp(x) / Math.exp(x), 1, 1e-13);
  close(exp(1), Math.E, 1e-14);
  close(exp(-4e-6), 1 - 4e-6 + 8e-12, 1e-16);
});

test("logit demand: shares by hand, and they fall with the firm's own price", () => {
  // Both at 1.5 with a = 2, mu = 0.25: e^2 / (2 e^2 + 1) = 0.468.
  close(share(1.5, 1.5), Math.exp(2) / (2 * Math.exp(2) + 1), 1e-12);
  // 1.6 against 1.4: e^1.6 / (e^1.6 + e^2.4 + 1).
  close(share(1.6, 1.4), Math.exp(1.6) / (Math.exp(1.6) + Math.exp(2.4) + 1), 1e-12);
  close(profit(1.6, 1.4), 0.6 * share(1.6, 1.4), 1e-15);
  close(share(1.6, 1.4) + share(1.4, 1.6), 1 - 1 / (Math.exp(1.6) + Math.exp(2.4) + 1), 1e-12);
  for (let p = 1; p < 2.5; p += 0.05) assert.ok(share(p + 0.05, 1.7) < share(p, 1.7));
});

test("the one-shot Nash and joint-monopoly prices: first-order conditions, brute force, and the paper's figures", () => {
  const { pN, pM, piN, piM } = benchmarks();
  close(pN - MARKET.c, MARKET.mu / (1 - share(pN, pN)), 1e-12);
  close(pM - MARKET.c, MARKET.mu / (1 - 2 * share(pM, pM)), 1e-12);
  // Brute force over a fine grid: pN is the best reply to itself, and pM maximises the two firms' joint profit.
  let reply = 0, joint = 0;
  for (let p = 1; p <= 3; p += 1e-4) { if (profit(p, pN) > profit(reply, pN)) reply = p; if (profit(p, p) > profit(joint, joint)) joint = p; }
  close(reply, pN, 1e-4); close(joint, pM, 1e-4);
  close(bestReplyTo(pN), pN, 1e-10);
  assert.equal(pN.toFixed(4), "1.4729"); assert.equal(pM.toFixed(4), "1.9250");
  assert.equal(piN.toFixed(4), "0.2229"); assert.equal(piM.toFixed(4), "0.3375");
  // Calvano et al. (section 3.5): "the price-cost margin is about 47% in the static Bertrand equilibrium, and about
  // twice as large under perfect collusion". Cost is 1, so the margin is p - 1.
  assert.equal(Math.round((pN - 1) * 100), 47);
  close((pM - 1) / (pN - 1), 2, 0.05);
  // Their footnote 26: with grim-trigger strategies the critical discount factor "is about 40%".
  assert.equal(grimThreshold().toFixed(3), "0.393");
});

test("the price grid is the paper's: 15 points from 10% of the gap below Nash to 10% above monopoly", () => {
  const { grid, pN, pM } = game;
  assert.equal(grid.length, 15);
  close(grid[0], pN - 0.1 * (pM - pN), 1e-12); close(grid[14], pM + 0.1 * (pM - pN), 1e-12);
  for (let i = 1; i < 15; i++) close(grid[i] - grid[i - 1], (grid[14] - grid[0]) / 14, 1e-12);
  // The prices printed on the authors' slides for the FTC (November 2019), to two places.
  assert.deepEqual([...grid].map((p) => p.toFixed(2)), ["1.43", "1.47", "1.51", "1.54", "1.58", "1.62", "1.66", "1.70", "1.74", "1.78", "1.82", "1.85", "1.89", "1.93", "1.97"]);
  assert.ok(!grid.includes(pN) && !grid.includes(pM), "neither benchmark is exactly on the grid");
});

test("the profit table and the best replies on the grid, by brute force", () => {
  const { m, grid, bestReply, nash } = game;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) assert.equal(game.profit[i * m + j], profit(grid[i], grid[j]));
  for (let j = 0; j < m; j++) {
    const profits = [...grid].map((p) => profit(p, grid[j]));
    assert.equal(bestReply[j], profits.indexOf(Math.max(...profits)));
    // The grid's best reply is one of the two grid prices either side of the exact best reply.
    assert.ok(Math.abs(grid[bestReply[j]] - bestReplyTo(grid[j])) <= (grid[1] - grid[0]));
  }
  // Two symmetric equilibria of the game on the grid, the grid prices either side of 1.473 ... and one step up.
  assert.deepEqual(nash, [[1, 1], [2, 2]]);
  close(profitGain(game.piN, game), 0); close(profitGain(game.piM, game), 1);
});

/* ---------------------------------------------------------------- the learning rule */

/** Q-learning written the long way, with a full search for the best price every time. */
function reference({ bots, alpha, beta, delta, memory, seed, periods }) {
  const { m, profit: P, bestReply } = game;
  const r = rng(seed);
  const S = memory ? m * m : 1;
  const start = Array.from({ length: m }, (_, i) => { let s = 0; for (let j = 0; j < m; j++) s += P[i * m + j]; return s / m / (1 - delta); });
  const Q = bots.map((kind) => (kind === "q" ? Array.from({ length: S }, () => [...start]) : null));
  const argmax = (row) => row.indexOf(Math.max(...row));
  let a = [r.int(0, m - 1), r.int(0, m - 1)], eps = 1;
  const decay = exp(-beta);
  const history = [];
  for (let t = 0; t < periods; t++) {
    const s = memory ? a[0] * m + a[1] : 0;
    const b = [];
    for (let k = 0; k < 2; k++) b.push(bots[k] === "q" ? (r() < eps ? Math.floor(r() * m) : argmax(Q[k][s])) : bestReply[a[1 - k]]);
    const s2 = memory ? b[0] * m + b[1] : 0;
    for (let k = 0; k < 2; k++) {
      if (!Q[k]) continue;
      const old = Q[k][s][b[k]];
      Q[k][s][b[k]] = old + alpha * (P[b[k] * m + b[1 - k]] + delta * Math.max(...Q[k][s2]) - old);
    }
    a = b; eps *= decay; history.push(b);
  }
  return { Q, history, last: a, greedy: Q.map((q) => q && q.map(argmax)) };
}

test("the fast learning loop gives exactly the tables of Q-learning written the long way", () => {
  for (const settings of [
    { bots: ["q", "q"], alpha: 0.15, beta: 4e-6, delta: 0.95, memory: true, seed: 3 },
    { bots: ["q", "q"], alpha: 0.25, beta: 1e-4, delta: 0, memory: false, seed: 8 },
    { bots: ["q", "q"], alpha: 1, beta: 1e-3, delta: 0.5, memory: true, seed: 21 },
    { bots: ["q", "reply"], alpha: 0.1, beta: 2e-5, delta: 0.9, memory: true, seed: 5 },
    { bots: ["reply", "q"], alpha: 0.1, beta: 5e-4, delta: 0.99, memory: false, seed: 5 },
  ]) {
    const periods = 30000;
    const ref = reference({ ...settings, periods });
    const s = createSession({ game, ...settings, stableFor: 1e9, maxPeriods: 1e7 }).advance(periods);
    assert.equal(s.t, periods);
    for (let k = 0; k < 2; k++) {
      if (settings.bots[k] !== "q") { assert.equal(s.tables.Q[k], null); continue; }
      assert.deepEqual([...s.tables.Q[k]], ref.Q[k].flat());
      assert.deepEqual([...s.tables.greedy[k]], ref.greedy[k]);
    }
    close(s.exploring, Math.exp(-settings.beta * periods), 1e-9);
  }
});

test("the starting values are each price's average profit against a random rival, discounted for ever", () => {
  const s = createSession({ game, bots: ["q", "q"], seed: 1 });
  const { m } = game;
  for (const i of [0, 7, 14]) {
    let mean = 0;
    for (let j = 0; j < m; j++) mean += profit(game.grid[i], game.grid[j]) / m;
    for (const state of [0, 100, 224]) close(s.tables.Q[0][state * m + i], mean / (1 - 0.95), 1e-12);
  }
  assert.equal(s.exploring, 1);
  assert.equal(s.t, 0); assert.equal(s.done, false);
});

test("a run is fixed by its seed, and cutting it into slices of any size changes nothing", () => {
  const settings = { game, bots: ["q", "q"], beta: 2e-5, seed: 77 };
  const whole = createSession(settings).advance(120000);
  const sliced = createSession(settings);
  for (const step of [1, 7, 993, 10000, 50000, 58999]) sliced.advance(step);
  assert.equal(sliced.t, 120000);
  assert.deepEqual([...sliced.tables.Q[0]], [...whole.tables.Q[0]]);
  assert.deepEqual([...sliced.tables.Q[1]], [...whole.tables.Q[1]]);
  assert.deepEqual(sliced.trace, whole.trace);
  assert.deepEqual(sliced.early, whole.early);
  const again = createSession(settings).advance(120000);
  assert.deepEqual([...again.tables.Q[0]], [...whole.tables.Q[0]]);
  const other = createSession({ ...settings, seed: 78 }).advance(120000);
  assert.notDeepEqual([...other.tables.Q[0]], [...whole.tables.Q[0]]);
  // The trace is the average price over each block of 10,000 periods; early holds the first periods one by one.
  assert.deepEqual(whole.trace.t, range(12).map((k) => k * 10000));
  assert.equal(whole.early.p0.length, 41);
  assert.ok(whole.trace.p0.every((p) => p >= game.grid[0] && p <= game.grid[14]));
});

test("a run stops when the learned prices have not changed for the set number of periods, or at the cap", () => {
  const quick = finish({ bots: ["q", "q"], beta: 1e-3, stableFor: 2000, seed: 4 });
  assert.equal(quick.settled, true); assert.ok(quick.t >= 2000 && quick.t < 200000);
  const before = quick.t;
  quick.advance(5000);
  assert.equal(quick.t, before, "a finished run does not move");
  const capped = finish({ bots: ["q", "q"], beta: 1e-6, maxPeriods: 30000, seed: 4 });
  assert.equal(capped.settled, false); assert.equal(capped.done, true); assert.equal(capped.t, 30000);
  assert.equal(defaultCap(4e-6), 5200000); assert.equal(defaultCap(1e-4), 400000); assert.equal(defaultCap(1e-6), LIMITS.maxPeriods);
  // The cap is 20 / beta + 200,000 for every setting the page offers, however the page writes beta: 100 * 1e-6 is one
  // rounding error below 1e-4, and used to give 500,000.
  for (const perMillion of [2, 4, 10, 20, 100]) {
    assert.equal(defaultCap(perMillion / 1e6), 20e6 / perMillion + 200000);
    assert.equal(defaultCap(perMillion * 1e-6), 20e6 / perMillion + 200000);
  }
  // The page passes beta as a count per million divided by a million: exactly the numbers these tests use.
  assert.equal(4 / 1e6, 4e-6); assert.equal(100 / 1e6, 1e-4); assert.equal(20 / 1e6, 2e-5);
});

/* ---------------------------------------------------------------- where play ends, and the price cut */

test("limit: the settled pair or cycle really is a cycle of what the bots would do", () => {
  for (const seed of [1, 3, 10]) {
    const s = finish({ bots: ["q", "q"], beta: 1e-4, seed });
    const lim = s.limit();
    const { m } = game;
    const g = s.tables.greedy;
    const next = ([i, j]) => [g[0][i * m + j], g[1][i * m + j]];
    lim.cycle.forEach((w, k) => assert.deepEqual(next(w), lim.cycle[(k + 1) % lim.length]));
    assert.equal(new Set(lim.cycle.map(([i, j]) => i * m + j)).size, lim.length);
    close(lim.prices[0], lim.cycle.reduce((sum, [i]) => sum + game.grid[i], 0) / lim.length, 1e-12);
    close(lim.gain, (profitGain(lim.profits[0], game) + profitGain(lim.profits[1], game)) / 2, 1e-12);
    close(lim.price, (lim.prices[0] + lim.prices[1]) / 2, 1e-12);
  }
});

test("the price cut: the discounted gain is the sum of the differences between the two paths", () => {
  const s = finish({ bots: ["q", "q"], seed: 2 });
  const { m } = game;
  const g = s.tables.greedy;
  const next = ([i, j]) => [g[0][i * m + j], g[1][i * m + j]];
  for (const bot of [0, 1]) for (const to of ["reply", "step", "floor", 3]) {
    const d = s.deviate({ bot, to, horizon: 25 });
    assert.equal(d.cut, true);
    assert.equal(d.path.length, 26);
    const startAt = s.limit().cycle[0];                     // seed 2 settles on one pair of prices
    assert.equal(s.limit().length, 1);
    const would = next(startAt)[bot];
    assert.equal(d.would, would);
    assert.equal(d.forced, to === "reply" ? game.bestReply[startAt[1 - bot]] : to === "step" ? would - 1 : to === "floor" ? 0 : 3);
    // The long way: follow both paths for 4,000 periods.
    let base = startAt, dev = startAt, gain = 0, weight = 1;
    const earn = ([i, j]) => (bot === 0 ? game.profit[i * m + j] : game.profit[j * m + i]);
    for (let tau = 1; tau <= 4000; tau++) {
      base = next(base);
      dev = next(dev);
      if (tau === 1) dev[bot] = d.forced;
      gain += weight * (earn(dev) - earn(base));
      weight *= 0.95;
      if (tau <= 25) { close(d.path[tau].dev[0], game.grid[dev[0]], 0); close(d.path[tau].base[1], game.grid[base[1]], 0); }
      if (tau === 2) assert.equal(d.punished, dev[1 - bot] < base[1 - bot]);
    }
    close(d.gain, gain, 1e-9);
    if (to === "reply") assert.ok(d.firstGain > 0, "a cut to the best reply pays in the period it is made");
  }
  // A "cut" that is not below what the bot would charge anyway is refused.
  assert.equal(s.deviate({ bot: 0, to: 14 }).cut, false);
  assert.equal(s.deviate({ bot: 0, to: 99 }).cut, false);
  assert.equal(s.deviate({ bot: 0, to: -1 }).cut, false);
});

test("two undercutters fight down to the grid's one-shot equilibrium within a few periods, and there is no cut left to test", () => {
  const b = batch({ bots: ["reply", "reply"] }, range(10));
  assert.equal(b.settled, 10); assert.equal(b.cuts, 0);
  for (const x of b.runs) {
    assert.ok(x.s.t <= 6, `seed ${x.seed} took ${x.s.t} periods`);
    assert.equal(x.s.learning, false);
    // Either one of the two equilibria of the grid game, or the two-step swap between them.
    for (const [i, j] of x.lim.cycle) assert.ok((i === 1 || i === 2) && (j === 1 || j === 2));
    assert.ok(x.lim.length <= 2);
    assert.ok(x.lim.price < 1.51);
  }
  assert.equal(b.sum.mean.toFixed(2), "0.08"); assert.equal(b.sum.max.toFixed(2), "0.12"); assert.equal(b.sum.min.toFixed(2), "-0.02");
  assert.equal(b.sum.price.toFixed(2), "1.50");
  // From any of the 225 starting pairs they are inside the two equilibrium prices (1.47 and 1.51) within 4 periods.
  for (let i = 0; i < game.m; i++) for (let j = 0; j < game.m; j++) {
    let w = [i, j];
    for (let t = 0; t < 4; t++) w = [game.bestReply[w[1]], game.bestReply[w[0]]];
    assert.ok(w.every((x) => x === 1 || x === 2), `from ${i},${j}`);
  }
  assert.equal(game.grid[14].toFixed(2) + game.grid[6].toFixed(2) + game.grid[3].toFixed(2) + game.grid[2].toFixed(2), "1.971.661.541.51");
  // Starting high, they undercut step by step: from (14, 14) every period's prices are below the last.
  const path = [[14, 14]];
  while (path.length < 8) { const [i, j] = path.at(-1); path.push([game.bestReply[j], game.bestReply[i]]); }
  assert.deepEqual(path.map(([i]) => i), [14, 6, 3, 2, 2, 2, 2, 2]);
});

test("a learner against an undercutter learns to lead: every seed ends at the same pair of prices", () => {
  const b = batch({ bots: ["q", "reply"] }, range(3));
  for (const x of b.runs) {
    assert.equal(x.s.settled, true);
    assert.equal(x.lim.length, 1);
    assert.deepEqual(x.lim.cycle[0], [7, 4]);
    assert.equal(x.lim.prices.map((p) => p.toFixed(2)).join(" "), "1.70 1.58");
  }
  assert.equal(b.sum.mean.toFixed(2), "0.51");
  // The follower's price is its best reply to the leader's, and no fixed price would earn the leader more.
  assert.equal(game.bestReply[7], 4);
  const lead = (i) => game.profit[i * game.m + game.bestReply[i]];
  for (let i = 0; i < game.m; i++) assert.ok(lead(i) <= lead(7));
});

/* ---------------------------------------------------------------- the numbers on the page */

test("the finding: the paper's baseline, seeds 1 to 10 (and 1 to 20)", () => {
  const twenty = batch({ bots: ["q", "q"] }, range(20));
  const ten = { ...twenty, runs: twenty.runs.slice(0, 10) };
  ten.sum = summarise(ten.runs.map((x) => x.lim));
  const cuts = ten.runs.filter((x) => x.cut.cut);
  // Every run settled, every run ended above the one-shot Nash price and below the joint-monopoly price.
  assert.equal(ten.runs.filter((x) => x.s.settled).length, 10);
  for (const x of ten.runs) for (const p of x.lim.prices) assert.ok(p > game.pN && p < game.pM);
  assert.equal(ten.sum.price.toFixed(2), "1.80");
  assert.equal((ten.sum.mean * 100).toFixed(0), "87");
  assert.equal((ten.sum.min * 100).toFixed(0), "58"); assert.equal((ten.sum.max * 100).toFixed(0), "98");
  assert.equal(ten.sum.above, 10);
  // The forced price cut by bot 1: possible in all ten, answered with a lower price in nine, a loss in all ten.
  assert.equal(cuts.length, 10);
  assert.equal(cuts.filter((x) => x.cut.punished).length, 9);
  assert.equal(cuts.filter((x) => x.cut.gain < 0).length, 10);
  assert.equal(cuts.filter((x) => x.cut.sameCycle).length, 10);
  // Seed 1 in detail, as the page describes it: both bots at 1.74; bot 1 is cut to 1.58 and gains 0.024 that period;
  // next period bot 2 charges 1.51 and bot 1 1.54, then 1.47 and 1.54, and in period 4 both are back at 1.74.
  const one = ten.runs[0];
  assert.equal(one.s.t, 1789148);
  assert.equal(one.lim.prices.map((p) => p.toFixed(2)).join(" "), "1.74 1.74");
  assert.equal((one.lim.gain * 100).toFixed(0), "79");
  assert.equal(one.cut.merged, 4);
  assert.equal(game.grid[one.cut.forced].toFixed(2), "1.58");
  assert.equal(one.cut.rivalAfter.toFixed(2), "1.51"); assert.equal(one.cut.rivalBefore.toFixed(2), "1.74");
  assert.deepEqual(one.cut.path.slice(0, 6).map((x) => x.dev.map((v) => v.toFixed(2)).join("/")), ["1.74/1.74", "1.58/1.74", "1.54/1.51", "1.54/1.47", "1.74/1.74", "1.74/1.74"]);
  assert.equal(one.cut.firstGain.toFixed(3), "0.024");
  assert.equal(one.cut.gain.toFixed(3), "-0.141");
  // Twenty seeds: an average gain of 86%, close to the 85% the paper reports for 1,000 sessions at this setting.
  assert.equal((twenty.sum.mean * 100).toFixed(0), "86");
  assert.equal(twenty.settled, 20); assert.equal(twenty.cuts, 20); assert.equal(twenty.answered, 18); assert.equal(twenty.lost, 20);
  assert.equal(Math.round(twenty.runs.reduce((s, x) => s + x.s.t, 0) / 20 / 1e5) / 10, 1.8, "about 1.8 million periods a run");
});

test("with memory off and patient learners prices end even higher, but a price cut pays and goes unanswered", () => {
  const b = batch({ bots: ["q", "q"], memory: false }, range(10));
  assert.equal(b.settled, 10);
  assert.equal((b.sum.mean * 100).toFixed(0), "97"); assert.equal((b.sum.min * 100).toFixed(0), "87");
  assert.equal(b.sum.price.toFixed(2), "1.88");
  assert.equal(b.cuts, 10); assert.equal(b.answered, 0); assert.equal(b.lost, 0);
  for (const x of b.runs) { assert.ok(x.cut.gain > 0); assert.equal(x.cut.merged, 2); }
  // Why (the page's explanation): each bot's table values every other price below the one it charges, although the
  // one-shot best reply would earn more each period. The entry for the price charged is its profit / (1 - delta).
  const { m } = game;
  let entries = 0;
  for (const x of b.runs) {
    assert.equal(x.lim.length, 1);
    const [i, j] = x.lim.cycle[0];
    assert.equal(i, j, `seed ${x.seed}: both bots end at the same price`);
    for (const k of [0, 1]) {
      const Q = x.s.tables.Q[k];
      // Within 1%: a rival's last few random prices knock the entry by up to 0.02 and it takes a few hundred periods to recover.
      close(Q[i], game.profit[i * m + i] / (1 - 0.95), 0.05);
      for (let a = 0; a < m; a++) if (a !== i) { entries++; assert.ok(Q[a] < Q[i], `seed ${x.seed}, bot ${k + 1}: price ${a} is valued above the price charged`); }
      const reply = game.bestReply[i];
      assert.ok(game.profit[reply * m + i] > game.profit[i * m + i] + 0.03, "the best reply earns at least 0.03 more a period");
    }
  }
  assert.equal(entries, 280);
  // Seed 1 as the page quotes it: both at 1.78, valued at 6.446 = 0.3223 / 0.05; 1.62 would earn 0.031 more a period
  // but stands at 6.346 and 6.337.
  const one = b.runs[0], at = one.lim.cycle[0][0], reply = game.bestReply[at];
  assert.equal(game.grid[at].toFixed(2), "1.78"); assert.equal(game.grid[reply].toFixed(2), "1.62");
  assert.equal(game.profit[at * m + at].toFixed(4), "0.3223");
  assert.equal((game.profit[reply * m + at] - game.profit[at * m + at]).toFixed(3), "0.031");
  assert.deepEqual(one.s.tables.Q.map((Q) => Q[at].toFixed(3)), ["6.446", "6.446"]);
  assert.deepEqual(one.s.tables.Q.map((Q) => Q[reply].toFixed(3)), ["6.346", "6.337"]);
});

test("a no-memory learner that refreshed every entry each period would end at a one-shot equilibrium of the grid", () => {
  // The same rule, patience and exploring as the page's "No memory" example, except that each period every price's
  // entry is moved towards what that price would have earned against the rival's actual price (which needs the demand
  // curve). Written out here because the page's bots cannot do it.
  const { m, profit: P } = game, alpha = 0.15, beta = 4e-6, delta = 0.95;
  for (const seed of [1, 2]) {
    const r = rng(seed);
    const start = Array.from({ length: m }, (_, i) => { let s = 0; for (let j = 0; j < m; j++) s += P[i * m + j]; return s / m / (1 - delta); });
    const Q = [Float64Array.from(start), Float64Array.from(start)];
    const top = (q) => { let b = 0; for (let i = 1; i < m; i++) if (q[i] > q[b]) b = i; return b; };
    const g = [top(Q[0]), top(Q[1])];
    let eps = 1; const decay = Math.exp(-beta);
    for (let t = 0; t < 2400000; t++) {
      const a0 = r() < eps ? Math.floor(r() * m) : g[0], a1 = r() < eps ? Math.floor(r() * m) : g[1];
      const v0 = Q[0][g[0]], v1 = Q[1][g[1]];
      for (let a = 0; a < m; a++) { Q[0][a] += alpha * (P[a * m + a1] + delta * v0 - Q[0][a]); Q[1][a] += alpha * (P[a * m + a0] + delta * v1 - Q[1][a]); }
      g[0] = top(Q[0]); g[1] = top(Q[1]);
      eps *= decay;
    }
    assert.ok(game.nash.some(([i, j]) => i === g[0] && j === g[1]), `seed ${seed} ended at ${g}`);
    assert.equal(game.grid[g[0]].toFixed(2), "1.47"); assert.equal(game.grid[g[1]].toFixed(2), "1.47");
  }
});

test("the paper's own no-memory test (delta 0, alpha 0.25, exploring fading at 100 per million): prices near the one-shot level", () => {
  const b = batch({ bots: ["q", "q"], memory: false, delta: 0, alpha: 0.25, beta: 1e-4 }, range(40));
  // Table A1 of the paper's online appendix reports an average profit gain of 0.185 for 1,000 sessions.
  assert.equal(b.sum.mean.toFixed(2), "0.19");
  assert.equal(b.sum.price.toFixed(2), "1.53");
  assert.equal(b.answered, 0); assert.equal(b.lost, 0);
  const ten = summarise(b.runs.slice(0, 10).map((x) => x.lim));
  assert.equal((ten.mean * 100).toFixed(0), "23");
});

test("with no patience (delta 0) and memory on, prices end near the one-shot level", () => {
  const b = batch({ bots: ["q", "q"], delta: 0 }, range(10));
  assert.equal(b.settled, 10);
  assert.equal((b.sum.mean * 100).toFixed(0), "16"); assert.equal((b.sum.max * 100).toFixed(0), "25");
  assert.equal(b.sum.price.toFixed(2), "1.52");
  assert.equal(b.sum.above, 0);
});

/* ---------------------------------------------------------------- summaries and bad input */

test("summarise: mean, median, range and the count above half way", () => {
  const s = summarise([{ gain: 0.2, price: 1.5 }, { gain: 0.9, price: 1.9 }, { gain: 0.6, price: 1.7 }, { gain: 0.5, price: 1.7 }]);
  close(s.mean, 0.55); close(s.median, 0.55); assert.equal(s.min, 0.2); assert.equal(s.max, 0.9); assert.equal(s.above, 2); close(s.price, 1.7);
  assert.equal(summarise([{ gain: 0.3, price: 1.6 }]).median, 0.3);
  assert.deepEqual(summarise([]), { n: 0 });
});

test("bad settings are refused with a message that says what to fix", () => {
  const ok = { bots: ["q", "q"], alpha: 0.15, beta: 4e-6, delta: 0.95, seed: 1 };
  assert.equal(problem(ok), "");
  assert.match(problem({ ...ok, bots: ["q"] }), /kind for each/);
  assert.match(problem({ ...ok, bots: ["q", "human"] }), /kind for each/);
  assert.match(problem({ ...ok, alpha: 0 }), /learning rate/);
  assert.match(problem({ ...ok, alpha: 1.5 }), /learning rate/);
  assert.match(problem({ ...ok, beta: 0 }), /exploring fades/);
  assert.match(problem({ ...ok, beta: 1 }), /exploring fades/);
  assert.match(problem({ ...ok, delta: 1 }), /Patience/);
  assert.match(problem({ ...ok, delta: -0.1 }), /Patience/);
  assert.match(problem({ ...ok, seed: 1.5 }), /seed/);
  assert.match(problem({ ...ok, seed: -1 }), /seed/);
  assert.match(problem({ ...ok, seed: 1e308 }), /seed/);
  assert.match(problem({ ...ok, seed: NaN }), /seed/);
  assert.match(problem({ ...ok, maxPeriods: 0 }), /longest run/);
  assert.match(problem(), /kind for each/);
  assert.throws(() => createSession({ game, ...ok, delta: 1 }), RangeError);
  assert.equal(DEFAULTS.alpha, 0.15); assert.equal(DEFAULTS.beta, 4e-6); assert.equal(GRID.m, 15);
});
