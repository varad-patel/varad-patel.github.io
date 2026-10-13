import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { STRUCTURES, problem, solve, solveAll, demandDiff, utility, cournotQuantities, payoff, deviation, largestGain, choiceOf, entryPath } from "./logic.js";

const close = (x, y, tol = 1e-9) => assert.ok(Math.abs(x - y) <= tol, `${x} is not within ${tol} of ${y}`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const same = (n, c, extra = {}) => ({ a: 100, b: 1, costs: Array(n).fill(c), theta: 0.5, ...extra });

/* ---------------------------------------------------------------- closed forms, equal costs */

test("monopoly: Q = (a - c) / 2b, P = (a + c) / 2, a quarter of the competitive surplus is lost", () => {
  const m = solve("monopoly", same(1, 20));
  close(m.Q, 40); close(m.price, 60); close(m.totalProfit, 1600); close(m.cs, 800); close(m.dwl, 800);
  close(m.benchmark, 3200); close(m.dwlShare, 0.25);
  // Other numbers: P = 50 - 2Q, cost 10: Q = 10, P = 30, profit 200.
  const other = solve("monopoly", { a: 50, b: 2, costs: [10], theta: 0 });
  close(other.Q, 10); close(other.price, 30); close(other.totalProfit, 200);
});

test("Cournot with n equal firms: q = (a - c) / b(n + 1), P = (a + n c) / (n + 1), loss share 1 / (n + 1)^2", () => {
  for (let n = 1; n <= 20; n++) {
    const o = solve("cournot", same(n, 20));
    for (const q of o.q) close(q, 80 / (n + 1));
    close(o.price, (100 + n * 20) / (n + 1));
    for (const pi of o.profits) close(pi, 6400 / (n + 1) ** 2, 1e-8);
    close(o.cs, (n * n * 6400) / (2 * (n + 1) ** 2), 1e-8);
    close(o.dwlShare, 1 / (n + 1) ** 2, 1e-12);
  }
  // By hand, two firms: each sells 26.67 at 46.67 and earns 711.11.
  const two = solve("cournot", same(2, 20));
  assert.equal(two.price.toFixed(2), "46.67"); assert.equal(two.q[0].toFixed(2), "26.67"); assert.equal(two.profits[0].toFixed(2), "711.11");
});

test("Stackelberg with one leader and n - 1 equal followers: qL = (a - c) / 2b, each follower (a - c) / 2bn, P = c + (a - c) / 2n", () => {
  for (let n = 1; n <= 12; n++) {
    const o = solve("stackelberg", same(n, 20));
    close(o.q[0], 40);
    for (const q of o.q.slice(1)) close(q, 80 / (2 * n));
    close(o.price, 20 + 80 / (2 * n));
    close(o.dwlShare, 1 / (4 * n * n), 1e-12);
    assert.equal(o.limit, false);
  }
  // The classic duopoly: leader 40, follower 20, price 40; the leader earns 800 against a Cournot firm's 711.11.
  const two = solve("stackelberg", same(2, 20));
  close(two.q[1], 20); close(two.price, 40); close(two.profits[0], 800); close(two.profits[1], 400);
});

test("Bertrand with identical goods and equal costs: price equals cost with two or more firms, monopoly with one", () => {
  for (let n = 2; n <= 8; n++) {
    const o = solve("bertrand", same(n, 20));
    close(o.price, 20); close(o.Q, 80); close(o.totalProfit, 0); close(o.dwl, 0); assert.equal(o.regime, "cost");
    for (const q of o.q) close(q, 80 / n);
  }
  const one = solve("bertrand", same(1, 20));
  close(one.price, 60); assert.equal(one.regime, "alone");
});

test("Bertrand with differentiated goods and equal costs: p = ((1 - t) a + (1 + (n - 2) t) c) / (2 + (n - 3) t)", () => {
  for (const theta of [0, 0.2, 0.5, 0.8, 0.95]) {
    for (let n = 1; n <= 10; n++) {
      const o = solve("bertrandDiff", same(n, 20, { theta }));
      const p = ((1 - theta) * 100 + (1 + (n - 2) * theta) * 20) / (2 + (n - 3) * theta);
      for (const x of o.p) close(x, p, 1e-9);
      // Each firm's output from the demand system: q = (a - p) / (b (1 + (n - 1) theta)).
      for (const q of o.q) close(q, (100 - p) / (1 + (n - 1) * theta), 1e-9);
      assert.equal(o.regime, "interior");
    }
  }
  // The symmetric duopoly price p = (a (1 - t) + c) / (2 - t). At t = 0.5: 70 / 1.5 = 46.67; at t = 0.6: 60 / 1.4 = 42.86.
  close(solve("bertrandDiff", same(2, 20)).p[0], 70 / 1.5);
  assert.equal(solve("bertrandDiff", same(2, 20, { theta: 0.6 })).p[0].toFixed(2), "42.86");
  // Unrelated goods (t = 0): every firm is a monopolist at 60.
  for (const p of solve("bertrandDiff", same(4, 20, { theta: 0 })).p) close(p, 60);
});

test("perfect competition: price equals the lowest cost and nothing is lost", () => {
  const o = solve("competition", same(5, 20));
  close(o.price, 20); close(o.Q, 80); close(o.cs, 3200); close(o.totalProfit, 0); close(o.dwl, 0);
  const mixed = solve("competition", { a: 100, b: 1, costs: [30, 20, 20, 45], theta: 0 });
  assert.deepEqual(mixed.q, [0, 40, 40, 0]); close(mixed.price, 20);
});

/* ---------------------------------------------------------------- unequal costs, worked by hand */

test("Cournot with unequal costs: P = (a + sum of active costs) / (k + 1), and a firm whose cost is above that price makes nothing", () => {
  const o = solve("cournot", { a: 100, b: 1, costs: [10, 40], theta: 0 });
  close(o.price, 50); assert.deepEqual(o.q.map((x) => +x.toFixed(9)), [40, 10]); close(o.profits[0], 1600); close(o.profits[1], 100);
  // Firm 2 at 70: the price with firm 1 alone is 55, below 70, so firm 2 stays out and firm 1 is a monopolist.
  const out = solve("cournot", { a: 100, b: 1, costs: [10, 70], theta: 0 });
  close(out.price, 55); assert.deepEqual(out.active, [true, false]); close(out.q[0], 45);
  // Exactly at the edge (cost 55): still nothing.
  assert.deepEqual(solve("cournot", { a: 100, b: 1, costs: [10, 55], theta: 0 }).active, [true, false]);
  // Three firms, the order of the list does not matter: costs 30, 10, 20 give P = 40 and outputs 10, 30, 20.
  const three = solve("cournot", { a: 100, b: 1, costs: [30, 10, 20], theta: 0 });
  close(three.price, 40); assert.deepEqual(three.q.map((x) => +x.toFixed(9)), [10, 30, 20]);
  assert.deepEqual(cournotQuantities([30, 10, 20], 100, 1).map((x) => +x.toFixed(9)), [10, 30, 20]);
});

test("a high-cost Cournot firm adds to the deadweight loss by producing: the loss counts costly output as well as missing output", () => {
  const o = solve("cournot", { a: 100, b: 1, costs: [10, 40], theta: 0 });
  // Benchmark: price 10, surplus 90^2 / 2 = 4050. Here CS = 50^2 / 2 = 1250, profit 1700: loss 1100.
  close(o.benchmark, 4050); close(o.cs, 1250); close(o.totalProfit, 1700); close(o.dwl, 1100);
  // Of that, 800 is output that is not made (40^2 / 2) and 300 is ten units made at 40 instead of 10.
  close(o.dwl, (40 * 40) / 2 + 10 * 30);
});

test("Bertrand with identical goods and unequal costs: the cheapest firm sells to everyone at the second-lowest cost, or at its monopoly price if that is lower", () => {
  const rival = solve("bertrand", { a: 100, b: 1, costs: [10, 40], theta: 0 });
  close(rival.price, 40); close(rival.q[0], 60); close(rival.q[1], 0); close(rival.profits[0], 1800); assert.equal(rival.regime, "rival");
  const drastic = solve("bertrand", { a: 100, b: 1, costs: [10, 70], theta: 0 });
  close(drastic.price, 55); close(drastic.profits[0], 2025); assert.equal(drastic.regime, "drastic");
  // The seller need not be firm 1.
  const swapped = solve("bertrand", { a: 100, b: 1, costs: [40, 25, 10], theta: 0 });
  close(swapped.price, 25); assert.deepEqual(swapped.active, [false, false, true]); assert.equal(swapped.seller, 2);
});

test("Bertrand with identical goods and unequal costs: the outcome shown is one of a range of equilibria, the one in which no firm prices below its own cost", () => {
  const market = { a: 100, b: 1, costs: [10, 40, 70], theta: 0 };
  const eq = solve("bertrand", market);
  // What the tool shows: the seller at the second-lowest cost, every idle firm at its own cost, and nobody can gain.
  assert.deepEqual(eq.p, [40, 40, 70]);
  eq.p.forEach((p, i) => assert.ok(p >= market.costs[i], "no firm posts a price below its own cost"));
  close(largestGain("bertrand", market, eq, 4001), 0);
  // The tie-breaking rule: at equal prices the firm with the lower cost sells, so firm 2 earns nothing at 40.
  close(payoff("bertrand", market, eq, 0, 40), 30 * 60); close(payoff("bertrand", market, eq, 1, 40), 0);
  // Without it firm 1 would have to go just under 40, and can always get closer: 39.9 earns less than 39.99.
  assert.ok(payoff("bertrand", market, eq, 0, 39.99) > payoff("bertrand", market, eq, 0, 39.9));
  assert.ok(payoff("bertrand", market, eq, 0, 39.99) < payoff("bertrand", market, eq, 0, 40));
  // The range: firms 1 and 2 both at any price from firm 1's cost (10) up to 40 is an equilibrium under the same rule.
  // Firm 2 then posts a price below its cost of 40 but sells nothing, and firm 1 loses every buyer if it asks more.
  for (const p of [10, 17.5, 25, 39]) {
    const other = { ...eq, p: [p, p, 70] };
    close(largestGain("bertrand", market, other, 4001), 0);
    close(payoff("bertrand", market, other, 0, p), (p - 10) * (100 - p)); close(payoff("bertrand", market, other, 1, p), 0);
    assert.equal(payoff("bertrand", market, other, 0, p + 0.01), 0, "firm 1 cannot raise its price");
    assert.ok(payoff("bertrand", market, other, 1, p - 0.01) < 0, "firm 2 would lose money by undercutting");
  }
  // Above 40 it is not: firm 2 would undercut and earn a margin. Below 10 firm 1 would lose money.
  assert.ok(largestGain("bertrand", market, { ...eq, p: [45, 45, 70] }, 4001) > 1);
  assert.ok(payoff("bertrand", market, { ...eq, p: [9, 9, 70] }, 0, 9) < 0);
});

test("Stackelberg with a weak follower: the leader makes exactly enough to keep it out", () => {
  // Leader cost 20, follower cost 50. With the follower in, P = 75 - q/2 and the leader would want 55 units, but the
  // follower leaves at 50. Alone the leader would want 40 units, which lets the follower in. So it makes 50.
  const o = solve("stackelberg", { a: 100, b: 1, costs: [20, 50], theta: 0 });
  close(o.q[0], 50); close(o.q[1], 0); close(o.price, 50); close(o.profits[0], 1500); assert.equal(o.limit, true);
  // Brute force agrees: no leader output does better.
  const d = deviation("stackelberg", { a: 100, b: 1, costs: [20, 50], theta: 0 }, o, 0, 10001);
  close(d.bestProfit, 1500, 1e-9);
  // A follower too weak to matter (cost 70 is above the monopoly price 60) is simply ignored.
  const blocked = solve("stackelberg", { a: 100, b: 1, costs: [20, 70], theta: 0 });
  close(blocked.q[0], 40); assert.equal(blocked.limit, false);
  // A leader whose cost is above the followers' Cournot price makes nothing.
  const weak = solve("stackelberg", { a: 100, b: 1, costs: [80, 20, 20], theta: 0 });
  close(weak.q[0], 0); close(weak.price, (100 + 40) / 3);
});

test("differentiated Bertrand with unequal costs: the interior formula, a firm priced out, and limit pricing", () => {
  const m = (costs, theta = 0.5) => ({ a: 100, b: 1, costs, theta });
  // Both sell (costs 20 and 40, t = 0.5): v_i = (w_i + t V) / (2 + t) with V = W / (2 - t) = 140 / 1.5.
  const both = solve("bertrandDiff", m([20, 40]));
  const V = 140 / 1.5;
  close(both.p[0], 100 - (80 + 0.5 * V) / 2.5); close(both.p[1], 100 - (60 + 0.5 * V) / 2.5); assert.equal(both.regime, "interior");
  // Firm 2 at 95: firm 1's monopoly price 60 already leaves it no buyers (it needs 100 - p2 > 0.5 * 40). Firm 1 is a monopolist.
  const out = solve("bertrandDiff", m([20, 95]));
  close(out.p[0], 60); close(out.q[0], 40); close(out.q[1], 0); assert.equal(out.regime, "interior");
  // Firm 2 at 78 sits in between: at 60 it would find buyers, so firm 1 cuts to 100 - 22 / 0.5 = 56 and keeps it out.
  const limit = solve("bertrandDiff", m([20, 78]));
  close(limit.p[0], 56); close(limit.q[0], 44); close(limit.q[1], 0); close(limit.profits[0], 36 * 44);
  assert.equal(limit.regime, "limit"); assert.equal(limit.edge, 1); close(limit.p[1], 78);
  // The three regions meet where they should: w2 = t w1 / 2 = 20 and w2 = t w1 / (2 - t^2) = 22.857.
  assert.equal(solve("bertrandDiff", m([20, 80.5])).regime, "interior");
  assert.equal(solve("bertrandDiff", m([20, 79.5])).regime, "limit");
  assert.equal(solve("bertrandDiff", m([20, 77.5])).regime, "limit");
  assert.equal(solve("bertrandDiff", m([20, 77])).regime, "interior");
  assert.ok(solve("bertrandDiff", m([20, 77])).q[1] > 0);
});

test("differentiated demand: one good is (a - p) / b, the buyer's first-order conditions hold, nothing is negative", () => {
  close(demandDiff([60], { a: 100, b: 1, theta: 0.7 })[0], 40);
  const r = rng(11);
  for (let trial = 0; trial < 300; trial++) {
    const n = r.int(1, 7), theta = r.uniform(0, 0.97), a = r.uniform(20, 200), b = r.uniform(0.2, 4);
    const prices = Array.from({ length: n }, () => r.uniform(0, a * 1.2));
    const q = demandDiff(prices, { a, b, theta });
    const Q = sum(q);
    q.forEach((x, i) => {
      assert.ok(x >= 0);
      const marginal = a - b * ((1 - theta) * x + theta * Q);      // dU/dq_i
      if (x > 0) close(marginal, prices[i], 1e-8 * a); else assert.ok(marginal <= prices[i] + 1e-8 * a, "an unbought good must not be worth its price");
    });
  }
  // Identical goods are the limit: utility with theta = 1 depends only on the total.
  close(utility([10, 30], { a: 100, b: 1 }, 1), 100 * 40 - 800);
});

/* ---------------------------------------------------------------- the equilibrium property, by brute force */

test("no firm can gain by changing its own choice: every structure, 400 random markets, a search over 2,001 choices per firm", () => {
  const r = rng(49);
  let limitCases = 0, idleFirms = 0, leaderKinks = 0;
  for (let trial = 0; trial < 400; trial++) {
    const n = r.int(1, 6);
    const a = r.uniform(40, 200), b = r.uniform(0.25, 4);
    // Costs spread widely, with ties and firms too costly to sell on purpose.
    const base = r.uniform(0, a * 0.6);
    const costs = Array.from({ length: n }, () => (r.bool(0.2) ? base : r.bool(0.15) ? r.uniform(a * 0.8, a * 1.3) : r.uniform(0, a * 0.95)));
    const market = { a, b, costs, theta: r.pick([0, 0.1, 0.3, 0.5, 0.7, 0.9, 0.97]) };
    for (const s of STRUCTURES) {
      const eq = solve(s.key, market);
      const scale = (a * a) / b;
      const gain = largestGain(s.key, market, eq, 2001);
      assert.ok(gain <= 1e-9 * scale, `${s.key}: a firm can gain ${gain} in ${JSON.stringify(market)}`);
      // Sanity of the outcome itself.
      eq.q.forEach((x, i) => { assert.ok(x >= 0); assert.ok(eq.profits[i] >= -1e-9 * scale, `${s.key}: negative profit`); });
      assert.ok(eq.dwl >= 0 && eq.cs >= -1e-9 * scale);
      close(eq.cs + eq.totalProfit + eq.dwl, eq.benchmark, 1e-8 * scale);
      if (s.key === "bertrandDiff" && eq.regime === "limit") limitCases++;
      if (s.key === "stackelberg" && eq.limit) leaderKinks++;
      if (s.key === "cournot") idleFirms += eq.active.filter((x) => !x).length;
    }
  }
  // The hard cases really were among the 400.
  assert.ok(limitCases >= 10, `only ${limitCases} limit-pricing cases`);
  assert.ok(leaderKinks >= 10, `only ${leaderKinks} leader kinks`);
  assert.ok(idleFirms >= 50, `only ${idleFirms} idle firms`);
});

test("the search has teeth: at prices or outputs that are not an equilibrium it finds the gain", () => {
  const market = same(2, 20);
  // Each firm making half the monopoly output (20): a firm gains by making 30 instead, 900 against 800.
  const fake = { ...solve("cournot", market), q: [20, 20], Q: 40 };
  const d = deviation("cournot", market, fake, 0, 2001);
  close(d.bestX, 30, 0.05); close(d.bestProfit, 900, 0.01); close(d.ownProfit, 800); close(d.gain, 100, 0.01);
  // Both charging the monopoly price 60 with identical goods: undercutting pays (nearly the whole 1,600 against 800).
  const cartel = { ...solve("bertrand", market), p: [60, 60] };
  close(payoff("bertrand", market, cartel, 0, 60), 800);
  assert.ok(deviation("bertrand", market, cartel, 0, 2001).gain > 790);
  // Differentiated goods at the monopoly price: a small cut pays.
  const diff = { ...solve("bertrandDiff", market), p: [60, 60] };
  assert.ok(deviation("bertrandDiff", market, diff, 0, 2001).gain > 10);
});

test("choiceOf and the deviation curve: the firm's own choice is on the curve and is its peak", () => {
  const market = { a: 100, b: 1, costs: [20, 30, 45], theta: 0.6 };
  for (const s of STRUCTURES) {
    const eq = solve(s.key, market);
    for (let i = 0; i < 3; i++) {
      const d = deviation(s.key, market, eq, i);
      assert.equal(d.kind, s.choice);
      assert.ok(d.xs.includes(choiceOf(s.key, eq, i)));
      assert.equal(d.xs.length, d.ys.length);
      close(d.ownProfit, s.key === "monopoly" ? eq.totalProfit : eq.profits[i], 1e-9);
      assert.ok(d.gain <= 1e-9);
    }
  }
});

/* ---------------------------------------------------------------- welfare, limits and edges */

test("welfare adds up, and the differentiated benchmark is every variety sold at cost", () => {
  for (const market of [same(3, 20), { a: 100, b: 1, costs: [10, 40, 25], theta: 0.3 }, { a: 80, b: 0.5, costs: [5, 5, 60, 79], theta: 0.9 }]) {
    for (const o of solveAll(market)) {
      close(o.cs + o.totalProfit + o.dwl, o.benchmark, 1e-8);
      close(o.welfare, o.cs + o.totalProfit, 1e-9);
      assert.ok(o.dwlShare >= 0 && o.dwlShare <= 1);
    }
  }
  // Two varieties, t = 0.5, cost 20 each: at cost each sells (a - c) / (b (1 + t)) = 53.33 and surplus is 80 * 53.33 = 4266.67.
  const d = solve("bertrandDiff", same(2, 20));
  close(d.benchmark, (80 * 80) / 1.5, 1e-8);
  // Consumer surplus by the formula U - spending, checked against identical goods: b Q^2 / 2.
  const c = solve("cournot", same(3, 20));
  close(c.cs, (c.Q * c.Q) / 2, 1e-9);
});

test("Cournot approaches the competitive outcome as firms are added, and Bertrand with nearly identical goods approaches Bertrand", () => {
  const path = entryPath("cournot", same(50, 20));
  assert.equal(path.length, 50);
  for (let k = 1; k < path.length; k++) assert.ok(path[k].price < path[k - 1].price && path[k].dwl < path[k - 1].dwl);
  close(path[49].price, 20 + 80 / 51, 1e-9);
  assert.ok(path[49].dwlShare < 0.0004);
  for (const costs of [[20, 20], [10, 40], [10, 70], [30, 10, 20]]) {
    const near = solve("bertrandDiff", { a: 100, b: 1, costs, theta: 0.9999 });
    const exact = solve("bertrand", { a: 100, b: 1, costs, theta: 0 });
    close(near.price, exact.price, 0.02);
    close(near.Q, exact.Q, 0.02);
  }
});

test("a firm that makes nothing is reported as inactive, in every structure", () => {
  const market = { a: 100, b: 1, costs: [20, 99, 150], theta: 0.5 };
  for (const o of solveAll(market)) {
    assert.equal(o.active[2], false, o.key);
    assert.equal(o.q[2], 0);
    assert.equal(o.profits[2], 0);
  }
  assert.deepEqual(solve("cournot", market).active, [true, false, false]);
});

test("no trade when even the cheapest firm's cost is at or above the highest price buyers will pay", () => {
  for (const costs of [[100], [120, 100], [150, 150, 200]]) {
    for (const o of solveAll({ a: 100, b: 1, costs, theta: 0.5 })) {
      assert.equal(o.trade, false, o.key);
      assert.equal(o.Q, 0); assert.equal(o.price, null); assert.equal(o.dwlShare, null);
      assert.equal(o.cs, 0); assert.equal(o.totalProfit, 0); assert.equal(o.dwl, 0);
      assert.ok(o.q.every((x) => x === 0));
    }
  }
});

test("zero cost, one firm and large numbers are handled", () => {
  const free = solve("cournot", { a: 100, b: 1, costs: [0, 0], theta: 0 });
  close(free.price, 100 / 3); close(free.Q, 200 / 3);
  for (const o of solveAll({ a: 100, b: 1, costs: [20], theta: 0.5 })) {
    if (o.key === "competition") close(o.price, 20); else close(o.price, 60);          // one firm is a monopolist under every game
  }
  const big = solveAll({ a: 1e6, b: 1e6, costs: Array(50).fill(1e5), theta: 0.99 });
  for (const o of big) { assert.ok(Number.isFinite(o.price) && Number.isFinite(o.dwl) && Number.isFinite(o.cs)); }
  close(solve("cournot", { a: 1e6, b: 1e6, costs: Array(50).fill(1e5), theta: 0 }).price, (1e6 + 50 * 1e5) / 51, 1e-6);
});

test("bad input is refused with a message that says what to fix", () => {
  assert.equal(problem(same(3, 20)), "");
  assert.match(problem({ a: 0, b: 1, costs: [1], theta: 0 }), /highest price/);
  assert.match(problem({ a: 1e308, b: 1, costs: [1], theta: 0 }), /highest price/);
  assert.match(problem({ a: 100, b: 0, costs: [1], theta: 0 }), /slope/);
  assert.match(problem({ a: 100, b: -1, costs: [1], theta: 0 }), /slope/);
  assert.match(problem({ a: 100, b: 1, costs: [], theta: 0 }), /between 1 and 50 firms/);
  assert.match(problem({ a: 100, b: 1, costs: Array(51).fill(1), theta: 0 }), /between 1 and 50 firms/);
  assert.match(problem({ a: 100, b: 1, costs: [1, -2], theta: 0 }), /Firm 2's cost/);
  assert.match(problem({ a: 100, b: 1, costs: [1, NaN], theta: 0 }), /Firm 2's cost/);
  assert.match(problem({ a: 100, b: 1, costs: [1, "7"], theta: 0 }), /Firm 2's cost/);
  assert.match(problem({ a: 100, b: 1, costs: [1], theta: 1 }), /similarity/);
  assert.match(problem(null), /highest price/);
  assert.throws(() => solve("cournot", { a: 100, b: 1, costs: [1], theta: 1 }), RangeError);
  assert.throws(() => solve("oligopoly", same(2, 20)), /Unknown market structure/);
});

/* ---------------------------------------------------------------- the finding on the page */

test("the finding: P = 100 - Q, cost 20: prices 60, 46.67 and 20; loss 25%, 11.1%, 0.83% with ten firms, falling as 1 / (n + 1)^2", () => {
  const price = (key, n) => solve(key, same(n, 20)).price;
  assert.equal(price("monopoly", 1).toFixed(2), "60.00");
  assert.equal(price("cournot", 2).toFixed(2), "46.67");
  assert.equal(price("competition", 2).toFixed(2), "20.00");
  assert.equal(price("bertrand", 2).toFixed(2), "20.00");
  assert.equal(price("stackelberg", 2).toFixed(2), "40.00");
  assert.equal(solve("bertrandDiff", same(2, 20, { theta: 0.6 })).price.toFixed(2), "42.86");
  const share = (n) => solve("cournot", same(n, 20)).dwlShare;
  assert.equal((share(1) * 100).toFixed(1), "25.0");
  assert.equal((share(2) * 100).toFixed(1), "11.1");
  assert.equal((share(10) * 100).toFixed(2), "0.83");
  assert.equal(price("cournot", 10).toFixed(2), "27.27");
  for (let n = 1; n <= 30; n++) close(share(n) * (n + 1) ** 2, 1, 1e-12);
});
