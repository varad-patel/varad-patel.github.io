import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { P0, LIMITS, DEFAULTS, problem, price, marginalRevenue, marginalCost, variableCost, consumerSurplus, demandAreaInView, solve, curves } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} is not within ${tol} of ${b}`);
const lin = (a, b) => ({ kind: "linear", a, b });
const iso = (e, q0) => ({ kind: "iso", e, q0 });
const cost = (c, d = 0, F = 0) => ({ c, d, F });

/** Simpson's rule on [a, b] with n (even) strips. */
function simpson(f, a, b, n = 20000) {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}
/** The area under a demand curve from 0 to Q. A constant-elasticity curve shoots up at 0, so x = t^8 is substituted to tame it. */
function areaUnderDemand(demand, Q) {
  if (demand.kind === "linear") return simpson((x) => price(demand, x), 0, Q);
  const m = 8, T = Q ** (1 / m);
  return simpson((t) => (t === 0 ? 0 : price(demand, t ** m) * m * t ** (m - 1)), 0, T, 400000);
}
/** The best output on a fine grid, by trying every point: no calculus. */
function bruteForce(demand, c, top, n = 400000) {
  let best = { Q: 0, profit: 0 };
  for (let i = 1; i <= n; i++) {
    const Q = (top * i) / n, profit = price(demand, Q) * Q - variableCost(c, Q);
    if (profit > best.profit) best = { Q, profit };
  }
  return { ...best, step: top / n };
}

/* ---------- hand-worked cases ---------- */

test("One finding: P = 100 - Q with a marginal cost of 20 (the page on load)", () => {
  const r = solve(DEFAULTS.demand, DEFAULTS.cost);
  assert.equal(r.state, "ok");
  // MR = 100 - 2Q = 20 gives Q = 40 and P = 60. Price = marginal cost gives Q = 80 and P = 20.
  assert.deepEqual([r.monopoly.Q, r.monopoly.P, r.benchmark.Q, r.benchmark.P], [40, 60, 80, 20]);
  assert.equal(r.monopoly.revenue, 2400);
  assert.equal(r.monopoly.variableCost, 800);
  assert.equal(r.monopoly.profit, 1600);           // (60 - 20) * 40
  assert.equal(r.monopoly.cs, 800);                // half of (100 - 60) * 40
  assert.equal(r.monopoly.total, 2400);
  assert.equal(r.benchmark.cs, 3200);              // half of (100 - 20) * 80
  assert.equal(r.benchmark.profit, 0);
  assert.equal(r.benchmark.total, 3200);
  assert.equal(r.dwl, 800);                        // half of (60 - 20) * (80 - 40): a quarter of 3,200
  close(r.dwl / r.benchmark.total, 0.25);
  close(r.lerner, 2 / 3);
  close(r.elasticity, -1.5);
  assert.deepEqual(DEFAULTS, { demand: { kind: "linear", a: 100, b: 1, e: 2, q0: 100 }, cost: { c: 20, d: 0, F: 0 } });
});

test("linear demand with rising marginal cost", () => {
  // P = 100 - Q, MC = 20 + Q. MR = MC: 100 - 2Q = 20 + Q, Q = 80/3. P = MC: 100 - Q = 20 + Q, Q = 40, P = 60.
  const r = solve(lin(100, 1), cost(20, 1));
  close(r.monopoly.Q, 80 / 3); close(r.monopoly.P, 220 / 3); close(r.monopoly.mc, 140 / 3);
  close(r.benchmark.Q, 40); close(r.benchmark.P, 60);
  close(r.monopoly.cs, 3200 / 9);                         // half of Q squared
  close(r.monopoly.profit, (220 / 3) * (80 / 3) - 20 * (80 / 3) - (80 / 3) ** 2 / 2);
  close(r.monopoly.profit, 9600 / 9);
  close(r.benchmark.cs, 800);
  close(r.benchmark.profit, 800);                         // 60 * 40 - 20 * 40 - 40 * 40 / 2: the rent on the rising cost curve
  close(r.dwl, 1600 / 9);                                 // half of (220/3 - 140/3) * (40 - 80/3)
  close(r.lerner, (80 / 3) / (220 / 3));
});

test("constant-elasticity demand: the mark-up rule p = c e / (e - 1)", () => {
  // Q = 100 (p / 10)^-2 and a marginal cost of 20. The rule gives p = 40, so Q = 100 / 16 = 6.25.
  const r = solve(iso(2, 100), cost(20));
  assert.equal(r.state, "ok");
  close(r.monopoly.P, 40); close(r.monopoly.Q, 6.25);
  close(r.monopoly.revenue, 250); close(r.monopoly.profit, 125);
  close(r.monopoly.cs, 250);                              // P Q / (e - 1)
  close(r.benchmark.P, 20); close(r.benchmark.Q, 25);     // 100 * 2^-2
  close(r.benchmark.cs, 500); close(r.benchmark.profit, 0);
  close(r.dwl, 125);                                      // 500 - (250 + 125)
  close(r.lerner, 0.5);                                   // 1 / e
  assert.equal(r.elasticity, -2);
  for (const [e, c] of [[1.1, 5], [1.5, 20], [3, 7], [5, 100], [10, 1]]) {
    const s = solve(iso(e, 250), cost(c));
    close(s.monopoly.P, (c * e) / (e - 1));
    close(s.lerner, 1 / e);
    close(s.benchmark.P, c);
  }
  assert.equal(price(iso(2, 100), 100), P0);
});

test("zero marginal cost: with linear demand the monopolist maximises revenue and the Lerner index is 1", () => {
  const r = solve(lin(100, 1), cost(0));
  assert.deepEqual([r.monopoly.Q, r.monopoly.P, r.benchmark.Q, r.benchmark.P], [50, 50, 100, 0]);
  assert.equal(r.lerner, 1);
  assert.equal(r.elasticity, -1);
  assert.equal(r.monopoly.profit, 2500);
  assert.equal(r.dwl, 1250);
  assert.equal(r.benchmark.revenue, 0);
});

/* ---------- the edges ---------- */

test("demand that never covers cost: nothing is sold under either regime", () => {
  for (const [a, c] of [[20, 20], [20, 50], [10, 100]]) {
    const r = solve(lin(a, 1), cost(c, 0.5, 300));
    assert.equal(r.state, "noTrade");
    assert.equal(r.monopoly.Q, 0); assert.equal(r.benchmark.Q, 0);
    assert.equal(r.monopoly.profit, 0);         // the fixed cost is not paid when nothing is made
    assert.equal(r.dwl, 0);
    assert.equal(r.monopoly.P, null);
  }
  assert.equal(solve(lin(21, 1), cost(20)).state, "ok");
});

test("constant elasticity at or below 1 has no monopoly outcome, and the benchmark's consumer surplus is unbounded", () => {
  for (const e of [0.1, 0.5, 0.9, 1]) {
    const r = solve(iso(e, 100), cost(20));
    assert.equal(r.state, "noMaximum");
    assert.equal(r.monopoly, null);
    assert.equal(r.dwl, null);
    close(r.benchmark.P, 20);
    close(r.benchmark.Q, 100 * 2 ** -e);
    assert.equal(r.benchmark.cs, Infinity);
    // Selling less always earns more: revenue rises (or holds, at e = 1) as output falls, while cost falls.
    const profit = (Q) => price(iso(e, 100), Q) * Q - 20 * Q;
    assert.ok(profit(0.001) > profit(0.01) && profit(0.01) > profit(0.1) && profit(0.1) > profit(1));
    assert.ok(marginalRevenue(iso(e, 100), 3) <= 0);
  }
  assert.equal(solve(iso(1.1, 100), cost(20)).state, "ok");
});

test("constant elasticity with no marginal cost at all has no finite outcome; a rising cost from zero does", () => {
  const r = solve(iso(2, 100), cost(0, 0));
  assert.equal(r.state, "unbounded");
  assert.equal(r.monopoly, null); assert.equal(r.benchmark, null); assert.equal(r.dwl, null);
  assert.equal(solve(iso(0.8, 100), cost(0, 0, 500)).state, "unbounded");
  // MC = 0.5 Q. Monopoly: 0.5 * 10 * (Q / 100)^-0.5 = 0.5 Q, so Q^1.5 = 100 and Q = 100^(2/3).
  const s = solve(iso(2, 100), cost(0, 0.5));
  assert.equal(s.state, "ok");
  close(s.monopoly.Q, 100 ** (2 / 3));
  close(s.benchmark.Q, 200 ** (2 / 3));         // 10 * (Q / 100)^-0.5 = 0.5 Q
  close(marginalRevenue(iso(2, 100), s.monopoly.Q), marginalCost(cost(0, 0.5), s.monopoly.Q));
  // Inelastic demand still has a benchmark when cost rises from zero.
  const t = solve(iso(0.5, 100), cost(0, 0.5));
  assert.equal(t.state, "noMaximum");
  close(price(iso(0.5, 100), t.benchmark.Q), 0.5 * t.benchmark.Q);
});

test("a fixed cost above the monopoly's operating profit shuts it down; an equal one leaves it breaking even", () => {
  // Operating profit is 1,600 and the surplus at price = marginal cost is 3,200.
  let r = solve(lin(100, 1), cost(20, 0, 1000));
  assert.equal(r.state, "ok"); assert.equal(r.monopoly.profit, 600); assert.equal(r.breaksEven, false);
  assert.equal(r.dwl, 800);                         // the fixed cost is paid either way, so the loss is unchanged
  assert.equal(r.benchmark.profit, -1000);          // price = marginal cost cannot pay a fixed cost
  assert.equal(r.benchmark.total, 2200);
  r = solve(lin(100, 1), cost(20, 0, 1600));
  assert.equal(r.state, "ok"); assert.equal(r.breaksEven, true); assert.equal(r.monopoly.profit, 0); assert.equal(r.monopoly.Q, 40);
  r = solve(lin(100, 1), cost(20, 0, 1650));
  assert.equal(r.state, "shutdown");
  assert.equal(r.monopoly.Q, 0); assert.equal(r.monopoly.profit, 0); assert.equal(r.monopoly.cs, 0);
  assert.equal(r.planned.Q, 40); assert.equal(r.planned.profit, -50);
  assert.equal(r.worthProducing, true);
  assert.equal(r.dwl, 1550);                        // everything marginal-cost pricing would have yielded: 3,200 - 1,650
  r = solve(lin(100, 1), cost(20, 0, 3200));
  assert.equal(r.state, "shutdown"); assert.equal(r.worthProducing, true); assert.equal(r.dwl, 0);
  r = solve(lin(100, 1), cost(20, 0, 3250));
  assert.equal(r.state, "shutdown"); assert.equal(r.worthProducing, false); assert.equal(r.dwl, 0);
  // A tie that is not exact in floating point still counts: P = 100 - 0.35 Q gives 1600 / 0.35.
  const tie = solve(lin(100, 0.35), cost(20)).monopoly.profit;
  assert.equal(solve(lin(100, 0.35), cost(20, 0, tie)).breaksEven, true);
});

test("settings out of range are refused with a reason", () => {
  assert.equal(problem(DEFAULTS.demand, DEFAULTS.cost), "");
  const bad = [
    [null, cost(1), /linear or constant-elasticity/], [{ kind: "cubic" }, cost(1), /linear or constant-elasticity/], [lin(100, 1), null, /cost settings/],
    [lin(0, 1), cost(1), /nobody buys/], [lin(1e9, 1), cost(1), /nobody buys/], [lin(NaN, 1), cost(1), /nobody buys/], [lin("100", 1), cost(1), /nobody buys/],
    [lin(100, 0), cost(1), /fall in price/], [lin(100, -1), cost(1), /fall in price/], [lin(100, Infinity), cost(1), /fall in price/],
    [iso(0, 100), cost(1), /elasticity/], [iso(11, 100), cost(1), /elasticity/], [iso(2, 0), cost(1), /quantity bought/], [iso(2, 1e308), cost(1), /quantity bought/],
    [lin(100, 1), cost(-1), /Marginal cost/], [lin(100, 1), cost(1, -0.5), /rise in marginal cost/], [lin(100, 1), cost(1, 0, -5), /fixed cost/], [lin(100, 1), cost(1, 0, 1e9), /fixed cost/],
  ];
  for (const [demand, c, pattern] of bad) {
    assert.match(problem(demand, c), pattern);
    assert.match(solve(demand, c).error, pattern);
  }
  // Settings of the other demand curve are ignored.
  assert.equal(problem({ kind: "linear", a: 100, b: 1, e: -5, q0: NaN }, cost(1)), "");
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) assert.ok(lo < hi, k);
});

/* ---------- checked against brute force and numerical integration ---------- */

test("the optimum matches a brute-force search, and every area matches numerical integration", () => {
  const r = rng(48);
  const cases = [
    [lin(100, 1), cost(20)], [lin(100, 1), cost(20, 1)], [lin(57, 0.3), cost(0, 0.05)], [lin(200, 5), cost(100, 2)],
    [iso(2, 100), cost(20)], [iso(1.3, 400), cost(8, 0.02)], [iso(3.5, 50), cost(3, 0.4)], [iso(2, 100), cost(0, 0.5)],
  ];
  for (let i = 0; i < 12; i++) {
    cases.push([lin(r.uniform(30, 200), r.uniform(0.1, 5)), cost(r.uniform(0, 25), r.bool(0.5) ? r.uniform(0, 2) : 0)]);
    cases.push([iso(r.uniform(1.2, 5), r.uniform(10, 1000)), cost(r.uniform(1, 30), r.bool(0.5) ? r.uniform(0, 1) : 0)]);
  }
  for (const [demand, c] of cases) {
    const s = solve(demand, c), label = JSON.stringify([demand, c]);
    assert.equal(s.state, "ok", label);
    const m = s.monopoly, b = s.benchmark;
    // First-order conditions.
    close(marginalRevenue(demand, m.Q), marginalCost(c, m.Q), 1e-9);
    close(price(demand, b.Q), marginalCost(c, b.Q), 1e-9);
    assert.ok(m.Q < b.Q && m.P > b.P, label);
    // Brute force: no point on a grid of 400,000 outputs beats the solved optimum, and the best grid point is next to it.
    const brute = bruteForce(demand, c, b.Q * 1.5);
    assert.ok(brute.profit <= m.operatingProfit * (1 + 1e-12), label);
    close(brute.profit, m.operatingProfit, 1e-7);
    assert.ok(Math.abs(brute.Q - m.Q) <= 1500 * brute.step, `${label}: brute force found ${brute.Q}, solved ${m.Q}`);
    // Areas. Consumer surplus is the area under demand above the price; operating profit is the area between price and marginal cost.
    close(m.cs, areaUnderDemand(demand, m.Q) - m.P * m.Q, 2e-6);
    close(b.cs, areaUnderDemand(demand, b.Q) - b.P * b.Q, 2e-6);
    close(m.operatingProfit, simpson((x) => m.P - marginalCost(c, x), 0, m.Q), 1e-9);
    close(b.operatingProfit, simpson((x) => b.P - marginalCost(c, x), 0, b.Q), 1e-9);
    // The deadweight loss is the area between demand and marginal cost from the monopoly's output to the benchmark's.
    close(s.dwl, simpson((x) => price(demand, x) - marginalCost(c, x), m.Q, b.Q), 1e-8);
    close(s.dwl, b.total - m.total, 1e-9);
    // Lerner index equals minus one over the elasticity of demand at the monopoly's price.
    close(s.lerner, -1 / s.elasticity, 1e-9);
    const h = 1e-6 * m.Q;
    const slope = (price(demand, m.Q + h) - price(demand, m.Q - h)) / (2 * h);
    close(s.elasticity, m.P / (m.Q * slope), 1e-5);
    assert.ok(s.lerner > 0 && s.lerner <= 1);
  }
});

test("two claims in the write-up: the quarter rule, and how much of a cost rise is passed on", () => {
  const r = rng(7);
  // Straight-line demand, constant marginal cost, no fixed cost: the loss is a quarter of the benchmark surplus.
  for (let i = 0; i < 50; i++) {
    const a = r.uniform(20, 200), b = r.uniform(0.1, 5), c = r.uniform(0, a - 1);
    const s = solve(lin(a, b), cost(c));
    close(s.dwl / s.benchmark.total, 0.25, 1e-9);
    close(s.monopoly.Q, s.benchmark.Q / 2, 1e-12);
    close(s.dwl, s.monopoly.profit / 2, 1e-9);
  }
  // It is not a quarter once marginal cost rises: P = 100 - Q with MC = 20 + Q loses a ninth (1600/9 of 1600).
  close(solve(lin(100, 1), cost(20, 1)).dwl / solve(lin(100, 1), cost(20, 1)).benchmark.total, 1 / 9, 1e-9);
  // Pass-through of a rise of 1 in a constant marginal cost: half on a straight line, e / (e - 1) with constant elasticity.
  close(solve(lin(100, 1), cost(21)).monopoly.P - solve(lin(100, 1), cost(20)).monopoly.P, 0.5, 1e-9);
  close(solve(iso(2, 100), cost(21)).monopoly.P - solve(iso(2, 100), cost(20)).monopoly.P, 2, 1e-9);
  close(solve(iso(4, 100), cost(21)).monopoly.P - solve(iso(4, 100), cost(20)).monopoly.P, 4 / 3, 1e-9);
});

test("the curve helpers agree with their definitions", () => {
  const d = lin(100, 2), c = cost(10, 0.5, 70);
  assert.equal(price(d, 10), 80);
  assert.equal(marginalRevenue(d, 10), 60);
  assert.equal(marginalCost(c, 10), 15);
  assert.equal(variableCost(c, 10), 125);                  // 10 * 10 + 0.5 * 100 / 2
  assert.equal(consumerSurplus(d, 10), 100);
  assert.equal(consumerSurplus(d, 0), 0);
  // Marginal revenue is the slope of revenue, for both curves.
  for (const demand of [d, iso(2.5, 300)]) for (const Q of [3, 17]) {
    const h = 1e-5;
    close(marginalRevenue(demand, Q), (price(demand, Q + h) * (Q + h) - price(demand, Q - h) * (Q - h)) / (2 * h), 1e-7);
  }
  const pts = curves(iso(2, 100), cost(20), 50, 100);
  assert.equal(pts.length, 101);
  assert.ok(pts[0].q > 0 && Number.isFinite(pts[0].p));
  assert.equal(pts[100].q, 50);
  assert.equal(curves(d, c, 40, 4)[0].p, 100);
});

/* ---------- found in review ---------- */

test("elasticity of exactly 1 with a fixed cost no revenue can cover: the monopoly produces nothing", () => {
  // Q = 100 (p / 10)^-1, so p Q = 1,000 at every output. With a marginal cost of 20 the profit at output Q is
  // 1,000 - 20 Q - F: below 1,000 - F for every Q above zero. The tool used to say "no best price" here whatever F was.
  const d = iso(1, 100);
  for (const Q of [0.001, 1, 50, 5000]) close(price(d, Q) * Q, 1000);
  for (const F of [1000, 1050, 2000, 5000]) {
    const r = solve(d, cost(20, 0, F));
    assert.equal(r.state, "cannotCover", `F = ${F}`);
    assert.equal(r.revenue, 1000);
    assert.equal(r.monopoly.Q, 0); assert.equal(r.monopoly.profit, 0);
    assert.equal(r.planned, null); assert.equal(r.dwl, null);
    close(r.benchmark.Q, 50); close(r.benchmark.P, 20);
    assert.equal(r.benchmark.cs, Infinity);
    // No calculus: on a grid from a billionth of a unit to a million units, no output makes a profit.
    let best = -Infinity;
    for (let k = -90; k <= 60; k++) { const Q = 10 ** (k / 10); best = Math.max(best, price(d, Q) * Q - variableCost(cost(20), Q) - F); }
    assert.ok(best < 0, `F = ${F}: the best profit on the grid is ${best}`);
    assert.ok(best > 1000 - F - 1e-6 && best < 1000 - F);     // and it creeps up to 1,000 - F from below
  }
  // One unit of fixed cost less and profit is positive for small outputs, with no best one: the old verdict is right.
  const open = solve(d, cost(20, 0, 950));
  assert.equal(open.state, "noMaximum");
  const profit = (Q) => price(d, Q) * Q - 20 * Q - 950;
  assert.ok(profit(0.001) > profit(0.01) && profit(0.01) > profit(1) && profit(1) > 0 && profit(0.001) < 50);
  // Rising cost from zero, and no marginal cost at all.
  assert.equal(solve(d, cost(0, 0.5, 1000)).state, "cannotCover");
  const free = solve(d, cost(0, 0, 5000));
  assert.equal(free.state, "cannotCover"); assert.equal(free.benchmark, null); assert.equal(free.monopoly.Q, 0);
  assert.equal(solve(d, cost(0, 0, 999)).state, "unbounded");
  // Below 1 revenue has no ceiling, so no fixed cost changes the verdict; above 1 the ordinary shutdown test applies.
  assert.equal(solve(iso(0.9, 100), cost(20, 0, 1e6)).state, "noMaximum");
  assert.equal(solve(iso(1.1, 100), cost(20, 0, 1e6)).state, "shutdown");
  assert.equal(solve(iso(1, 10), cost(20, 0, 100)).state, "cannotCover");   // the smallest revenue the sliders allow
  assert.equal(solve(iso(1, 10), cost(20, 0, 50)).state, "noMaximum");
});

test("the part of a constant-elasticity area that a chart can show matches numerical integration", () => {
  // Elasticity 2, q0 = 100, marginal cost 20: the monopolist sells 6.25 at 40 and buyers' surplus is 250. A chart whose
  // price axis stops at 88 shows the demand curve only from q* = 100 * 8.8^-2 = 1.2913: the area under min(P, 88) is
  // 88 * 1.2913 + 2 * (250 - 88 * 1.2913) = 386.36, so 386.36 - 250 = 136.36 of the surplus is in view.
  const d = iso(2, 100);
  close(demandAreaInView(d, 6.25, 88), 500 - 88 * 100 * 8.8 ** -2, 1e-12);
  close(demandAreaInView(d, 6.25, 88) - 40 * 6.25, 136.3636, 1e-6);
  for (const [dem, Q, top] of [[d, 6.25, 88], [d, 25, 88], [iso(1.1, 1000), 80.2, 218], [iso(3.5, 50), 4, 30], [iso(5, 10), 0.00003, 275]]) {
    const cut = dem.q0 * (top / P0) ** -dem.e;
    const numeric = top * Math.min(cut, Q) + (cut < Q ? simpson((x) => price(dem, x), cut, Q, 200000) : 0);
    close(demandAreaInView(dem, Q, top), numeric, 1e-8);
    // What is in view is less than the whole area under the curve and grows as the top rises. It tends to the whole
    // area, quickly when demand is elastic (with an elasticity of 1.1 a top of a trillion still hides 6% of it).
    const whole = consumerSurplus(dem, Q) + price(dem, Q) * Q;
    assert.ok(demandAreaInView(dem, Q, top) < demandAreaInView(dem, Q, 10 * top) && demandAreaInView(dem, Q, 10 * top) < whole);
    if (dem.e >= 2) close(demandAreaInView(dem, Q, 1e12), whole, 1e-4);
  }
  // A top below the price at Q hides the whole curve: the area is a rectangle. A straight line is never cut off.
  close(demandAreaInView(d, 6.25, 30), 30 * 6.25);
  assert.equal(demandAreaInView(lin(100, 1), 40, 105), 100 * 40 - 800);
  assert.equal(demandAreaInView(d, 0, 88), 0);
});
