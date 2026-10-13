import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { KINDS, EPS, SIGMA_RANGE, prefsProblem, utility, demand, expenditure, curveY, split, demandCurve, indifferenceCurve, axisMax, basketWords, reading } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const COBB = { kind: "cobb", a: 0.5 }, SUBS = { kind: "subs", a: 0.5 }, COMP = { kind: "comp", a: 0.5 }, QUASI = { kind: "quasi", b: 3 };

// Random preferences, prices and income inside the ranges of the page's sliders, from a fixed seed.
function draws(kind, n, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, () => ({
    prefs: { kind, a: r.uniform(0.05, 0.95), b: r.uniform(0.5, 10), sigma: r.uniform(0.2, 5) },
    px: r.uniform(1, 10), px1: r.uniform(1, 10), py: r.uniform(1, 10), m: r.uniform(20, 200),
  }));
}

// The best basket by trying 20,001 points along the budget line. No calculus, no formulas.
function bruteBest(prefs, px, py, m, n = 20000) {
  let best = { u: -Infinity, x: 0 };
  for (let i = 0; i <= n; i++) {
    const x = (m / px) * (i / n);
    const u = utility(prefs, x, Math.max(0, (m - px * x) / py));
    if (u > best.u) best = { u, x };
  }
  return { ...best, step: m / px / n };
}

// The cheapest basket on an indifference curve by trying 40,001 values of x. xTop is a quantity of x that
// certainly costs more than the cheapest basket.
function bruteCheapest(prefs, px, py, u, xTop, n = 40000) {
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    const x = xTop * (i / n);
    const y = curveY(prefs, u, x);
    if (y != null) best = Math.min(best, px * x + py * y);
  }
  return best;
}

/* ---------- hand-computed cases ---------- */
test("Cobb-Douglas: budget shares equal the weights", () => {
  const d = demand(COBB, 2, 2, 100);
  assert.deepEqual([d.x, d.y, d.where], [25, 25, "inside"]);
  close(d.u, 25);
  const e = demand({ kind: "cobb", a: 0.3 }, 4, 5, 200);
  close(e.x, 0.3 * 200 / 4); // 15
  close(e.y, 0.7 * 200 / 5); // 28
  close(4 * e.x / 200, 0.3);
  // Spending on x does not depend on its price: a price elasticity of exactly -1.
  for (const p of [1, 2.5, 7, 10]) close(p * demand(COBB, p, 2, 100).x, 50);
});

test("perfect substitutes: a corner, and a tie at exactly one price", () => {
  // Utility per unit of money is 0.5 / px against 0.5 / 2.
  assert.deepEqual(demand(SUBS, 1.5, 2, 100), { x: 100 / 1.5, y: 0, u: 0.5 * 100 / 1.5, where: "all x", range: null });
  assert.deepEqual(demand(SUBS, 4, 2, 100), { x: 0, y: 50, u: 25, where: "all y", range: null });
  const tie = demand(SUBS, 2, 2, 100);
  assert.equal(tie.where, "tie");
  assert.deepEqual(tie.range, [0, 50]);
  assert.deepEqual([tie.x, tie.y], [25, 25]);
  // Every basket on the line really is equally good.
  for (const x of [0, 10, 25, 50]) close(utility(SUBS, x, (100 - 2 * x) / 2), tie.u);
  // A tie where the arithmetic is not exact in floating point: 0.4 × 3 against 0.6 × 2.
  assert.notEqual(0.4 * 3, 0.6 * 2);
  assert.equal(demand({ kind: "subs", a: 0.4 }, 2, 3, 100).where, "tie");
  // A hair either side of the tie is a corner.
  assert.equal(demand(SUBS, 2.000001, 2, 100).where, "all y");
  assert.equal(demand(SUBS, 1.999999, 2, 100).where, "all x");
});

test("perfect complements: fixed proportions at the kink", () => {
  const d = demand({ kind: "comp", a: 0.25 }, 2, 6, 100);
  // One of x with three of y: a bundle costs 0.25 × 2 + 0.75 × 6 = 5, so 20 bundles.
  close(d.x, 5);
  close(d.y, 15);
  close(d.u, 20);
  assert.equal(d.where, "kink");
  close(d.x / d.y, 0.25 / 0.75);
});

test("quasi-linear: demand for x ignores income until the whole income is spent on it", () => {
  // Tangency at √x = b × py / px = 3, so x = 9, whatever the income.
  for (const m of [40, 100, 200]) close(demand(QUASI, 2, 2, m).x, 9);
  close(demand(QUASI, 2, 2, 100).y, 41);
  close(demand(QUASI, 2, 2, 100).u, 2 * 3 * 3 + 41);
  assert.equal(demand(QUASI, 2, 2, 100).where, "inside");
  // Income of 10 cannot buy 9 of x at a price of 2: a corner.
  assert.deepEqual(demand(QUASI, 2, 2, 10), { x: 5, y: 0, u: 6 * Math.sqrt(5), where: "all x", range: null });
  // Exactly enough for the tangency amount and nothing else.
  const edge = demand(QUASI, 2, 2, 18);
  assert.deepEqual([edge.x, edge.y], [9, 0]);
});

test("CES: the elasticity of substitution is what it says, and the limits are the other families", () => {
  for (const sigma of [0.3, 2, 4]) {
    const p = { kind: "ces", a: 0.4, sigma };
    const d1 = demand(p, 2, 2, 100), d2 = demand(p, 2, 3, 100);
    // d ln(x / y) = sigma × d ln(py / px)
    close(Math.log((d2.x / d2.y) / (d1.x / d1.y)), sigma * Math.log(3 / 2), 1e-12);
    close(2 * d2.x + 3 * d2.y, 100, 1e-10);
  }
  // sigma = 1 is Cobb-Douglas exactly, and sigma near 1 is near it.
  assert.deepEqual(demand({ kind: "ces", a: 0.3, sigma: 1 }, 4, 5, 200), demand({ kind: "cobb", a: 0.3 }, 4, 5, 200));
  close(demand({ kind: "ces", a: 0.3, sigma: 1.0001 }, 4, 5, 200).x, 15, 0.01);
  close(utility({ kind: "ces", a: 0.3, sigma: 1 }, 7, 9), 7 ** 0.3 * 9 ** 0.7);
  // Very easy substitution: nearly everything goes on the better buy.
  assert.ok(demand({ kind: "ces", a: 0.5, sigma: 60 }, 2, 2.4, 100).x > 49.9);
  // Very hard substitution: nearly fixed proportions of one to one (x / y = 3 to the power 0.01).
  const stiff = demand({ kind: "ces", a: 0.5, sigma: 0.01 }, 2, 6, 100);
  close(stiff.x / stiff.y, 3 ** 0.01, 1e-12);
  close(stiff.x / stiff.y, 1, 0.02);
  // With sigma below 1, a basket with none of one good is worth nothing.
  assert.equal(utility({ kind: "ces", a: 0.5, sigma: 0.5 }, 0, 10), 0);
});

test("a price rise from 2 to 4, split by hand for Cobb-Douglas", () => {
  const h = split(COBB, 2, 4, 2, 100, "hicks");
  // Old utility 25. At prices 4 and 2 the cheapest way to 25 is x = 25 / √2, y = 25√2, costing 100√2.
  close(h.compensatedIncome, 100 * Math.SQRT2);
  close(h.B.x, 25 / Math.SQRT2);
  close(h.B.y, 25 * Math.SQRT2);
  close(h.B.u, 25);
  close(h.substitution, 25 / Math.SQRT2 - 25); // -7.32
  close(h.income, 12.5 - 25 / Math.SQRT2); // -5.18
  close(h.total, -12.5);
  assert.equal(h.undetermined, false);
  const s = split(COBB, 2, 4, 2, 100, "slutsky");
  // The old basket (25, 25) costs 150 at the new prices; half of 150 on x at a price of 4 is 18.75.
  close(s.compensatedIncome, 150);
  close(s.B.x, 18.75);
  close(s.substitution, -6.25);
  close(s.income, -6.25);
  // A price fall, the other way round.
  const f = split(COBB, 4, 2, 2, 100, "hicks");
  close(f.total, 12.5);
  close(f.substitution, 25 / Math.SQRT2 - 12.5);
  assert.ok(f.substitution > 0 && f.income > 0);
});

/* ---------- every solution against a brute-force search ---------- */
for (const kind of KINDS) {
  test(`${kind.label}: the best basket beats every one of 20,001 baskets on the budget line`, () => {
    for (const { prefs, px, py, m } of draws(kind.id, 300, 39)) {
      const d = demand(prefs, px, py, m);
      assert.ok(d.x >= 0 && d.y >= 0, "quantities cannot be negative");
      close(px * d.x + py * d.y, m, 1e-9 * m); // the whole income is spent
      close(d.u, utility(prefs, d.x, d.y), 1e-12);
      const brute = bruteBest(prefs, px, py, m);
      assert.ok(d.u >= brute.u - 1e-9 * Math.max(1, brute.u), `${JSON.stringify(prefs)}: formula ${d.u}, search ${brute.u}`);
      // No tie comes up in random draws, so the best basket is unique and the search must land beside it.
      assert.notEqual(d.where, "tie");
      close(d.x, brute.x, 1.5 * brute.step);
    }
  });

  test(`${kind.label}: the compensated basket is the cheapest way to the old utility, by search`, () => {
    for (const { prefs, px, px1, py, m } of draws(kind.id, 120, 3900)) {
      const r = split(prefs, px, px1, py, m, "hicks");
      // B reaches the old level of utility and costs exactly the compensated income.
      close(r.B.u, r.A.u, 1e-9 * Math.max(1, r.A.u));
      close(px1 * r.B.x + py * r.B.y, r.compensatedIncome, 1e-9 * r.compensatedIncome);
      close(r.compensatedIncome, expenditure(prefs, px1, py, r.A.u), 1e-12);
      // The old basket is one way to reach the old utility, so nothing cheaper can hold more x than this.
      const xTop = (px1 * r.A.x + py * r.A.y) / px1;
      const cheapest = bruteCheapest(prefs, px1, py, r.A.u, xTop);
      assert.ok(r.compensatedIncome <= cheapest + 1e-9 * cheapest, `${JSON.stringify(prefs)}: formula ${r.compensatedIncome}, search ${cheapest}`);
      close(r.compensatedIncome, cheapest, 2e-3 * cheapest);
      // The substitution effect never goes the same way as the price.
      assert.ok(r.substitution * (px1 - px) <= 1e-9);
      close(r.substitution + r.income, r.total, 1e-9);
      // Slutsky: the old basket is exactly affordable, so the consumer is at least as well off.
      const s = split(prefs, px, px1, py, m, "slutsky");
      close(px1 * s.A.x + py * s.A.y, s.compensatedIncome, 1e-9 * s.compensatedIncome);
      assert.ok(s.B.u >= s.A.u - 1e-9 * Math.max(1, s.A.u));
      assert.ok(s.substitution * (px1 - px) <= 1e-9);
    }
  });
}

test("the quasi-linear expenditure formula on both sides of its corner", () => {
  // At prices 2 and 2 with b = 3 the tangency has √x = 3 and utility 18 from x alone.
  close(expenditure(QUASI, 2, 2, 59), 2 * 9 + 2 * 41); // inside: 100
  close(expenditure(QUASI, 2, 2, 12), 2 * (12 / 6) ** 2); // corner: x = 4, y = 0, costing 8
  close(expenditure(QUASI, 2, 2, 18), 18); // exactly at the join
  close(bruteCheapest(QUASI, 2, 2, 12, 10), 8, 1e-6);
  assert.ok(Number.isNaN(expenditure(QUASI, 2, 2, -1)));
  assert.ok(Number.isNaN(expenditure(QUASI, 0, 2, 5)));
  assert.ok(Number.isNaN(expenditure({ kind: "nope" }, 1, 2, 5)));
});

/* ---------- the finding and the theory behind it ---------- */
test("One finding: the same price rise, three different splits", () => {
  const cobb = split(COBB, 2, 4, 2, 100, "hicks");
  assert.equal(cobb.A.x.toFixed(2), "25.00");
  assert.equal(cobb.C.x.toFixed(2), "12.50");
  assert.equal(cobb.substitution.toFixed(2), "-7.32");
  assert.equal(cobb.income.toFixed(2), "-5.18");
  const quasi = split(QUASI, 2, 4, 2, 100, "hicks");
  assert.equal(quasi.A.x.toFixed(2), "9.00");
  assert.equal(quasi.C.x.toFixed(2), "2.25");
  assert.equal(quasi.substitution.toFixed(2), "-6.75");
  assert.equal(quasi.income, 0); // exactly
  const comp = split(COMP, 2, 4, 2, 100, "hicks");
  assert.equal(comp.A.x.toFixed(2), "25.00");
  assert.equal(comp.C.x.toFixed(2), "16.67");
  assert.ok(Math.abs(comp.substitution) < EPS);
  assert.equal(comp.income.toFixed(2), "-8.33");
  assert.equal(reading(quasi, 2, 4, 2, 100).at(-1), "All of the change is substitution: the income effect on x is exactly zero.");
  assert.equal(reading(comp, 2, 4, 2, 100).at(-1), "All of the change is income effect: the substitution effect on x is exactly zero.");
});

test("quasi-linear has no income effect while some y is bought, and complements have no substitution effect", () => {
  for (const { prefs, px, px1, py } of draws("quasi", 200, 7)) {
    // An income large enough for an interior solution at both prices, with or without compensation.
    const m = 4 * Math.max(px, px1) * ((prefs.b * py) / Math.min(px, px1)) ** 2 + 10;
    for (const method of ["hicks", "slutsky"]) assert.equal(split(prefs, px, px1, py, m, method).income, 0);
  }
  for (const { prefs, px, px1, py, m } of draws("comp", 200, 7)) {
    for (const method of ["hicks", "slutsky"]) assert.ok(Math.abs(split(prefs, px, px1, py, m, method).substitution) < EPS);
  }
});

test("ties make the split undetermined, and identical prices leave nothing to split", () => {
  assert.equal(split(SUBS, 2, 4, 2, 100).undetermined, true);
  assert.equal(split(SUBS, 4, 2, 2, 100).undetermined, true);
  assert.equal(split(SUBS, 1.5, 4, 2, 100).undetermined, false);
  const same = split(COBB, 3, 3, 2, 100);
  close(same.total, 0);
  close(same.substitution, 0, 1e-12);
});

/* ---------- bad input ---------- */
test("invalid preferences, prices and incomes are refused with a reason", () => {
  assert.match(demand({ kind: "nope" }, 1, 1, 1).error, /five kinds/);
  assert.match(demand(null, 1, 1, 1).error, /five kinds/);
  for (const a of [0, 1, -0.2, 1.5, NaN, "0.5", undefined]) assert.match(demand({ kind: "cobb", a }, 1, 1, 1).error, /weight on x/);
  for (const b of [0, -1, NaN, Infinity]) assert.match(demand({ kind: "quasi", b }, 1, 1, 1).error, /taste for x/);
  for (const sigma of [0, -1, NaN, Infinity, 0.009, 100.5, 1e-4, 1e4]) assert.match(demand({ kind: "ces", a: 0.5, sigma }, 1, 1, 1).error, /elasticity of substitution must be between 0\.01 and 100/);
  for (const p of [0, -1, NaN, Infinity, "2"]) {
    assert.match(demand(COBB, p, 1, 1).error, /prices must be above 0/);
    assert.match(demand(COBB, 1, p, 1).error, /prices must be above 0/);
    assert.match(demand(COBB, 1, 1, p).error, /Income must be above 0/);
  }
  assert.match(split(COBB, 2, 0, 2, 100).error, /prices/);
  assert.match(split(COBB, 0, 2, 2, 100).error, /prices/);
  assert.match(split(COBB, 2, 4, 2, 100, "other").error, /Hicks or the Slutsky/);
  assert.equal(prefsProblem(COBB), "");
  assert.deepEqual(demandCurve({ kind: "nope" }, 2, 100, 1, 10), []);
  assert.deepEqual(demandCurve(COBB, 2, 100, 5, 5), []);
  assert.deepEqual(indifferenceCurve(COBB, 0, 100), []);
  assert.deepEqual(indifferenceCurve(COBB, 25, 0), []);
  // The extremes of every slider on the page give finite baskets.
  for (const kind of KINDS) for (const a of [0.05, 0.95]) for (const b of [0.5, 10]) for (const sigma of [0.2, 1, 5]) for (const px of [1, 10]) for (const px1 of [1, 10]) for (const py of [1, 10]) for (const m of [20, 200]) for (const method of ["hicks", "slutsky"]) {
    const r = split({ kind: kind.id, a, b, sigma }, px, px1, py, m, method);
    for (const v of [r.A.x, r.A.y, r.B.x, r.B.y, r.C.x, r.C.y, r.compensatedIncome, r.substitution, r.income, r.total]) assert.ok(Number.isFinite(v), `${kind.id} ${a} ${b} ${sigma} ${px} ${px1} ${py} ${m}`);
  }
});

/* ---------- the curves ---------- */
test("the demand curve slopes down, passes through the best basket, and has a flat stretch for substitutes", () => {
  for (const kind of KINDS) {
    for (const { prefs, py, m } of draws(kind.id, 40, 11)) {
      const curve = demandCurve(prefs, py, m, 1, 10, 90);
      assert.ok(curve.length >= 91);
      for (let i = 1; i < curve.length; i++) {
        assert.ok(curve[i].p <= curve[i - 1].p + 1e-12, "prices run from high to low");
        assert.ok(curve[i].x >= curve[i - 1].x - 1e-9, `${kind.id}: a lower price never means less x`);
      }
      close(curve[0].p, 10);
      close(curve.at(-1).p, 1);
      close(curve.at(-1).x, demand(prefs, 1, py, m).x, 1e-9);
    }
  }
  // Substitutes with equal weights and py = 2 switch at a price of 2: nothing above, everything below.
  const subs = demandCurve(SUBS, 2, 100, 1, 10, 9);
  assert.deepEqual(subs.filter((d) => d.p === 2), [{ p: 2, x: 0 }, { p: 2, x: 50 }]);
  assert.ok(subs.filter((d) => d.p > 2).every((d) => d.x === 0));
  assert.deepEqual(subs.at(-1), { p: 1, x: 100 });
  // A switching price that falls between two steps of the grid is put in.
  const off = demandCurve({ kind: "subs", a: 0.45 }, 2, 100, 1, 10, 9);
  const at = (0.45 * 2) / 0.55;
  assert.equal(off.filter((d) => Math.abs(d.p - at) < 1e-12).length, 2);
  close(off.find((d) => Math.abs(d.p - at) < 1e-12 && d.x > 0).x, 100 / at);
});

test("the compensated demand curve keeps utility fixed and crosses the ordinary one at the starting price", () => {
  for (const kind of KINDS) {
    const prefs = { kind: kind.id, a: 0.35, b: 3, sigma: 2.5 };
    const A = demand(prefs, 3, 2, 100);
    const comp = demandCurve(prefs, 2, 100, 1, 10, 90, { u: A.u });
    const plain = demandCurve(prefs, 2, 100, 1, 10, 90);
    const i = plain.findIndex((d) => Math.abs(d.p - 3) < 1e-9);
    close(plain[i].x, A.x, 1e-9);
    close(comp.find((d) => Math.abs(d.p - 3) < 1e-9).x, A.x, 1e-9);
    for (const d of comp) {
      const e = expenditure(prefs, d.p, 2, A.u);
      const basket = demand(prefs, d.p, 2, e);
      if (basket.where !== "tie") close(basket.u, A.u, 1e-9 * A.u);
    }
    // Above the starting price the compensated consumer buys at least as much x as the uncompensated one.
    for (let k = 0; k < plain.length; k++) if (plain[k].p > 3 + 1e-9 && kind.id !== "subs") assert.ok(comp[k].x >= plain[k].x - 1e-9);
    // The Slutsky version: income that just buys the old basket at each price. It also passes through A,
    // and matches split() at every price.
    const slutsky = demandCurve(prefs, 2, 100, 1, 10, 90, { x: A.x, y: A.y });
    close(slutsky.find((d) => Math.abs(d.p - 3) < 1e-9).x, A.x, 1e-9);
    for (const d of slutsky) {
      const r = split(prefs, 3, d.p, 2, 100, "slutsky");
      if (!r.undetermined && r.B.where !== "tie") close(d.x, r.B.x, 1e-9);
    }
    for (const d of comp) {
      const r = split(prefs, 3, d.p, 2, 100, "hicks");
      if (!r.undetermined && r.B.where !== "tie") close(d.x, r.B.x, 1e-9);
    }
  }
});

test("indifference curves: every point has the stated utility", () => {
  for (const kind of KINDS) {
    for (const { prefs, px, py, m } of draws(kind.id, 30, 5)) {
      const u = demand(prefs, px, py, m).u;
      const curve = indifferenceCurve(prefs, u, 200, 100, Infinity);
      assert.ok(curve.length >= 2, kind.id);
      for (const [x, y] of curve) {
        assert.ok(x >= 0 && y >= 0);
        if (kind.id === "comp") assert.ok(utility(prefs, x, y) >= u - 1e-9);
        else close(utility(prefs, x, y), u, 1e-7 * Math.max(1, u));
      }
      for (let i = 1; i < curve.length; i++) assert.ok(curve[i][0] >= curve[i - 1][0] && curve[i][1] <= curve[i - 1][1] + 1e-9, "curves slope down");
    }
  }
  // Complements: an L with its corner at the basket in fixed proportions.
  assert.deepEqual(indifferenceCurve(COMP, 50, 100)[1], [25, 25]);
  // Curves that reach the x axis end on it: 2b√x = u at x = (u / 2b)².
  assert.deepEqual(indifferenceCurve(QUASI, 59, 200, 10).at(-1), [(59 / 6) ** 2, 0]);
  assert.deepEqual(indifferenceCurve(SUBS, 25, 200, 10).at(-1), [50, 0]);
  const ces = indifferenceCurve({ kind: "ces", a: 0.5, sigma: 2 }, 25, 200, 10).at(-1);
  close(ces[0], 100); // 0.5 × √x = √25
  assert.equal(ces[1], 0);
  // A curve that would leave the page is capped, not dropped.
  const steep = indifferenceCurve({ kind: "cobb", a: 0.9 }, 50, 100, 100, 800); // y = (50 / x^0.9)^10: about 10^17 at x = 1
  assert.ok(steep.some(([, y]) => y === 800));
  assert.ok(steep.every(([, y]) => y <= 800));
  // A curve that never reaches the y axis starts off the top of the frame, not in mid-air between two steps:
  // with s = 0.5, a = 0.3 and u = 7.7 the curve only exists to the right of x = 0.3 × 7.7 = 2.31.
  const stiff = indifferenceCurve({ kind: "ces", a: 0.3, sigma: 0.5 }, 7.7, 100, 200, 800);
  assert.ok(stiff[0][0] > 2.31 && stiff[0][0] < 2.5, `starts at x = ${stiff[0][0]}`);
  close(stiff[0][1], 800, 1e-6);
  assert.equal(stiff[1][0], 2.5);
  const low = indifferenceCurve({ kind: "cobb", a: 0.5 }, 5, 100, 10, 800); // y = 25 / x: 2.5 at the first step of 10
  close(low[0][0], 25 / 800, 1e-9);
  close(low[0][1], 800, 1e-6);
  assert.equal(low[1][0], 10);
  close(low[1][1], 2.5, 1e-12);
  assert.equal(curveY(COBB, 25, 0), null);
  assert.equal(curveY(COMP, 50, 10), null);
  assert.equal(curveY(SUBS, 25, 60), null);
  assert.equal(curveY(COBB, 25, -1), null);
});

test("chart axes move in doublings", () => {
  assert.equal(axisMax([25, 50]), 100);
  assert.equal(axisMax([100]), 100);
  assert.equal(axisMax([100.01]), 200);
  assert.equal(axisMax([316]), 400);
  assert.equal(axisMax([]), 100);
  assert.equal(axisMax([NaN, Infinity, 30]), 100);
  assert.equal(axisMax([1e12]), 102400);
});

/* ---------- every kind of sentence ---------- */
test("the reading in each case", () => {
  assert.deepEqual(reading(split(COBB, 2, 4, 2, 100, "hicks"), 2, 4, 2, 100), [
    "With an income of 100.00 and prices of 2.00 for x and 2.00 for y, the best basket is 25.00 of x and 25.00 of y.",
    "When the price of x rises from 2.00 to 4.00, the best basket becomes 12.50 of x and 25.00 of y.",
    "Given enough income to reach the old level of utility at the new price, 141.42, the consumer would choose 17.68 of x.",
    "So the substitution effect on x is -7.32 and the income effect is -5.18. The whole change is -12.50.",
  ]);
  assert.deepEqual(reading(split(COBB, 4, 2, 2, 100, "slutsky"), 4, 2, 2, 100).slice(1), [
    "When the price of x falls from 4.00 to 2.00, the best basket becomes 25.00 of x and 25.00 of y.",
    "Given enough income to buy the old basket at the new price, 75.00, the consumer would choose 18.75 of x.",
    "So the substitution effect on x is +6.25 and the income effect is +6.25. The whole change is +12.50.",
  ]);
  assert.deepEqual(reading(split(COBB, 3, 3, 2, 100), 3, 3, 2, 100), [
    "With an income of 100.00 and prices of 3.00 for x and 2.00 for y, the best basket is 16.67 of x and 25.00 of y.",
    "The two prices of x are the same, so there is no price change to split.",
  ]);
  // A tie before, a corner after.
  assert.deepEqual(reading(split(SUBS, 2, 4, 2, 100), 2, 4, 2, 100), [
    "With an income of 100.00 and prices of 2.00 for x and 2.00 for y, no single basket is best: every basket on the budget line is equally good, from none of x to 50.00 of it.",
    "When the price of x rises from 2.00 to 4.00, the best basket becomes 0.00 of x and 50.00 of y: x is not bought at all.",
    "At one of these prices the quantity of x is not pinned down, so the change cannot be split into substitution and income effects.",
  ]);
  // A corner before, a tie after.
  assert.equal(reading(split(SUBS, 1, 2, 2, 100), 1, 2, 2, 100)[1], "When the price of x rises from 1.00 to 2.00, no single basket is best: every basket on the budget line is equally good, from none of x to 50.00 of it.");
  // x never bought: nothing changes.
  assert.deepEqual(reading(split(SUBS, 4, 5, 2, 100), 4, 5, 2, 100).slice(-2), [
    "So the substitution effect on x is 0.00 and the income effect is 0.00. The whole change is 0.00.",
    "Neither effect moves the quantity of x here.",
  ]);
  assert.equal(basketWords(demand(SUBS, 1.5, 2, 100)), "66.67 of x and 0.00 of y: the whole income goes on x");
  // No sentence carries a broken number, whatever the sliders say.
  for (const kind of KINDS) for (const { prefs, px, px1, py, m } of draws(kind.id, 60, 21)) for (const method of ["hicks", "slutsky"]) {
    assert.doesNotMatch(reading(split(prefs, px, px1, py, m, method), px, px1, py, m).join(" "), /NaN|undefined|Infinity|null|–|-0\.00/);
  }
});

/* ---------- added by the independent review ---------- */
test("perfect substitutes: the verdict is right at every setting the sliders can reach", () => {
  // a = k / 20, px = i / 10, py = j / 10. In whole numbers the two goods tie exactly when k × j = (20 - k) × i,
  // x is the better buy when k × j is larger, and y when it is smaller. No rounding is involved in that test.
  let ties = 0, combos = 0;
  for (let k = 1; k <= 19; k++) for (let i = 10; i <= 100; i++) for (let j = 10; j <= 100; j++) {
    const a = Number((k * 0.05).toFixed(2)), px = Number((i / 10).toFixed(1)), py = Number((j / 10).toFixed(1));
    const want = k * j === (20 - k) * i ? "tie" : k * j > (20 - k) * i ? "all x" : "all y";
    const d = demand({ kind: "subs", a }, px, py, 100);
    if (d.where !== want) assert.fail(`a ${a}, px ${px}, py ${py}: ${d.where}, not ${want}`);
    if (want === "tie") { ties++; assert.deepEqual(d.range, [0, 100 / px]); }
    combos++;
  }
  assert.equal(combos, 19 * 91 * 91);
  assert.equal(ties, 287);
  // One that needs care in floating point: 0.3 × 7 and 0.7 × 3 are both 2.1 on paper.
  assert.notEqual(0.3 * 7, (1 - 0.3) * 3);
  assert.equal(demand({ kind: "subs", a: 0.3 }, 3, 7, 100).where, "tie");
});

test("quasi-linear at a corner, and both ways of making up income, by hand", () => {
  // b = 10, py = 10, income 20, px from 1 to 2. The tangency wants (10 × 10 / 1)² = 10,000 of x, far more than 20
  // buys, so all 20 goes on x before and after: 20 of x, then 10. Utility before is 2 × 10 × √20. To reach it at the
  // new price takes 20 of x again, which costs 40, and that is also what buying the old basket costs.
  const corner = { kind: "quasi", b: 10 };
  for (const method of ["hicks", "slutsky"]) {
    const r = split(corner, 1, 2, 10, 20, method);
    assert.deepEqual([r.A.where, r.B.where, r.C.where], ["all x", "all x", "all x"]);
    close(r.A.x, 20, 1e-12); close(r.C.x, 10, 1e-12); close(r.B.x, 20, 1e-9);
    close(r.compensatedIncome, 40, 1e-9);
    close(r.substitution, 0, 1e-9); close(r.income, -10, 1e-9);
  }
  // b = 3, py = 2, income 20, px from 1 to 4. Before: the tangency wants (3 × 2 / 1)² = 36 of x, which costs 36, so
  // the corner: 20 of x and utility 6√20. After: (3 × 2 / 4)² = 2.25 of x and (20 - 9) / 2 = 5.5 of y.
  // Hicks: 6√20 is above 2b²py / px = 9, so the least income is py × u - (b × py)² / px = 12√20 - 9.
  // Slutsky: 20 + (4 - 1) × 20 = 80. Either way the consumer is inside at the new price and buys 2.25 of x.
  const mixed = { kind: "quasi", b: 3 };
  const h = split(mixed, 1, 4, 2, 20, "hicks"), s = split(mixed, 1, 4, 2, 20, "slutsky");
  assert.equal(h.A.where, "all x"); assert.equal(h.C.where, "inside");
  close(h.A.x, 20, 1e-12); close(h.C.x, 2.25, 1e-12); close(h.C.y, 5.5, 1e-12);
  close(h.compensatedIncome, 12 * Math.sqrt(20) - 9, 1e-9);
  close(s.compensatedIncome, 80, 1e-12);
  for (const r of [h, s]) { close(r.B.x, 2.25, 1e-12); close(r.substitution, -17.75, 1e-12); close(r.income, 0, 1e-12); }
  // Cobb-Douglas with a = 0.5, income 100, py = 2, px from 2 to 4, by Slutsky: income 100 + 2 × 25 = 150, of which
  // half goes on x at 4: 18.75. Substitution -6.25 and income -6.25.
  const c = split({ kind: "cobb", a: 0.5 }, 2, 4, 2, 100, "slutsky");
  close(c.compensatedIncome, 150, 1e-12); close(c.B.x, 18.75, 1e-12); close(c.substitution, -6.25, 1e-12); close(c.income, -6.25, 1e-12);
  // Perfect substitutes with x the better buy before and after (px from 1.5 to 1.8 against py = 2, a = 0.5): the
  // made-up income buys the old amount of x again, so the whole change is income effect.
  const p = split({ kind: "subs", a: 0.5 }, 1.5, 1.8, 2, 100, "hicks");
  close(p.compensatedIncome, 120, 1e-9); close(p.substitution, 0, 1e-9); close(p.income, 100 / 1.8 - 100 / 1.5, 1e-9);
});

test("CES stays finite across the range it accepts, and is refused outside it", () => {
  assert.deepEqual(SIGMA_RANGE, [0.01, 100]);
  for (const sigma of [0.01, 0.2, 0.999999, 1, 1.000001, 5, 100]) for (const a of [0.05, 0.5, 0.95]) for (const px of [1, 10]) for (const px1 of [1, 10]) for (const py of [1, 10]) for (const m of [20, 200]) for (const method of ["hicks", "slutsky"]) {
    const r = split({ kind: "ces", a, sigma }, px, px1, py, m, method);
    for (const v of [r.A.x, r.A.y, r.A.u, r.B.x, r.B.y, r.B.u, r.C.x, r.C.y, r.C.u, r.compensatedIncome, r.substitution, r.income]) assert.ok(Number.isFinite(v), `${sigma} ${a} ${px} ${px1} ${py} ${m} ${method}`);
    close(px * r.A.x + py * r.A.y, m, 1e-9 * m);
    if (method === "hicks") close(r.B.u, r.A.u, 1e-8 * Math.max(1, r.A.u));
  }
  // Outside the range the powers overflow (at an elasticity of 0.0001 utility came out as Infinity), so it is refused.
  for (const sigma of [0.0001, 0.001, 1000, 10000]) assert.match(prefsProblem({ kind: "ces", a: 0.5, sigma }), /between 0\.01 and 100/);
  // Within a millionth of 1 the limit, Cobb-Douglas, is used: the result does not jump.
  const near = demand({ kind: "ces", a: 0.3, sigma: 1 + 1e-9 }, 3, 2, 100), cobb = demand({ kind: "cobb", a: 0.3 }, 3, 2, 100);
  assert.deepEqual([near.x, near.y, near.u], [cobb.x, cobb.y, cobb.u]);
  const just = demand({ kind: "ces", a: 0.3, sigma: 1.00001 }, 3, 2, 100);
  close(just.x, cobb.x, 1e-3); close(just.u, cobb.u, 1e-3);
});
