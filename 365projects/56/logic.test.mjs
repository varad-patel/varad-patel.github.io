import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { LIMITS, EXAMPLES, check, demand, worth, profitAt, onePrice, isotonic, menu, compare, n2, price, verdict, groupWords, bundlesOf, menuWords } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const G = (...rows) => rows.map(([name, buyers, top]) => ({ name, buyers, top }));
const ex = (key) => EXAMPLES.find((e) => e.key === key);
/** Random markets: 2 to 4 groups with whole numbers of buyers. */
function randomMarket(r) {
  const k = r.int(2, 4);
  return { cost: Math.round(r.uniform(0, 6) * 4) / 4, groups: Array.from({ length: k }, (_, i) => ({ name: `G${i + 1}`, buyers: r.int(1, 200), top: Math.round(r.uniform(1, 20) * 4) / 4 })) };
}
/** Area under a buyer's demand curve between two quantities, by the midpoint rule: nothing from logic.js but the curve. */
function areaUnderDemand(top, from, to, steps = 20000) {
  const h = (to - from) / steps;
  let s = 0;
  for (let i = 0; i < steps; i++) s += Math.max(0, top - (from + (i + 0.5) * h)) * h;
  return s;
}

test("the example on load, worked by hand", () => {
  // Students: 100 buyers, top price 10. Professionals: 100 buyers, top price 14. Cost 2.
  const { groups, cost } = ex("both");
  const { one, group, menu: m, each } = compare(groups, cost).schemes;
  // One price: p = (average top price 12 + cost 2) / 2 = 7. Students buy 3 each, professionals 7.
  assert.equal(one.price, 7); assert.deepEqual(one.q, [3, 7]); assert.equal(one.output, 1000);
  assert.equal(one.profit, 5000); assert.deepEqual(one.cs, [450, 2450]); assert.equal(one.welfare, 7900);
  // A price for each group: (10 + 2) / 2 = 6 and (14 + 2) / 2 = 8.
  assert.deepEqual(group.unit, [6, 8]); assert.deepEqual(group.q, [4, 6]); assert.equal(group.output, 1000);
  assert.equal(group.profit, 5200); assert.deepEqual(group.cs, [800, 1800]); assert.equal(group.welfare, 7800);
  // The menu: students' virtual top price is 10 - (14 - 10) x 100 / 100 = 6, so 4 units, priced at their whole worth
  // 10 x 4 - 8 = 32. Professionals get 12 units and keep (14 - 10) x 4 = 16: they pay 14 x 12 - 72 - 16 = 80.
  assert.deepEqual(m.virtual, [6, 14]);
  assert.deepEqual(m.q, [4, 12]); assert.deepEqual(m.pay, [32, 80]); assert.deepEqual(m.surplus, [0, 16]);
  assert.equal(m.profit, 8000); assert.deepEqual(m.cs, [0, 1600]); assert.equal(m.welfare, 9600); assert.equal(m.output, 1600);
  // A price for each buyer: 8 and 12 units, everything they are worth: (10^2 - 2^2) / 2 = 48 and (14^2 - 2^2) / 2 = 96.
  assert.deepEqual(each.q, [8, 12]); assert.deepEqual(each.pay, [48, 96]); assert.equal(each.profit, 10400);
  assert.equal(each.csTotal, 0); assert.equal(each.welfare, 10400);
});

test("the finding on the page: both examples behind it", () => {
  const a = compare(ex("both").groups, ex("both").cost).schemes;
  assert.equal(a.one.output, a.group.output);
  assert.equal(a.group.profit - a.one.profit, 200);
  assert.equal(a.group.welfare - a.one.welfare, -100);
  const b = compare(ex("shut").groups, ex("shut").cost);
  assert.equal(b.schemes.one.price, 8);
  assert.deepEqual(b.schemes.one.served, [false, true]);
  assert.deepEqual(b.shutOut, [0]);
  assert.equal(b.schemes.one.welfare, 5400); assert.equal(b.schemes.group.welfare, 6000);
  assert.equal(b.schemes.group.profit - b.schemes.one.profit, 400);
  assert.deepEqual(b.schemes.group.cs, [200, 1800]); assert.deepEqual(b.schemes.one.cs, [0, 1800]);
  assert.deepEqual(b.schemes.group.unit, [4, 8]);
  // The menu shuts the students out as well, and takes everything from the professionals.
  assert.deepEqual(b.schemes.menu.q, [0, 12]); assert.equal(b.schemes.menu.profit, 7200); assert.equal(b.schemes.menu.csTotal, 0);
});

test("the best single price beats every price on a fine grid, in the examples and in 300 random markets", () => {
  const r = rng(56);
  const markets = [...EXAMPLES, ...Array.from({ length: 300 }, () => randomMarket(r))];
  for (const { groups, cost } of markets) {
    const best = onePrice(groups, cost);
    const hi = Math.max(...groups.map((g) => g.top));
    if (hi <= cost) { assert.equal(best.price, null); assert.equal(best.profit, 0); continue; }
    let top = -Infinity, at = null;
    for (let i = 0; i <= 20000; i++) { const p = cost + ((hi - cost) * i) / 20000; const v = profitAt(groups, cost, p); if (v > top) { top = v; at = p; } }
    assert.ok(best.profit >= top - 1e-9, `grid price ${at} earns ${top}, more than ${best.profit} at ${best.price}`);
    assert.ok(best.profit <= top * (1 + 1e-6) + 1e-9, `${best.profit} is more than any grid price earns (${top})`);
    close(best.profit, profitAt(groups, cost, best.price), 1e-9);
    assert.deepEqual(best.served, groups.map((g) => g.top > best.price));
  }
});

test("each group's own price beats a grid of prices for that group", () => {
  const r = rng(7);
  for (let k = 0; k < 100; k++) {
    const { groups, cost } = randomMarket(r);
    const s = compare(groups, cost).schemes.group;
    groups.forEach((g, i) => {
      if (g.top <= cost) { assert.equal(s.unit[i], null); assert.equal(s.q[i], 0); return; }
      let top = -Infinity;
      for (let j = 0; j <= 4000; j++) { const p = cost + ((g.top - cost) * j) / 4000; top = Math.max(top, (p - cost) * demand(g.top, p)); }
      close((s.unit[i] - cost) * s.q[i], top, 1e-6 * Math.max(1, top));
      assert.ok((s.unit[i] - cost) * s.q[i] >= top - 1e-12);
    });
  }
});

test("surplus figures equal the area under the demand curve, integrated numerically", () => {
  for (const { groups, cost } of EXAMPLES) {
    const s = compare(groups, cost).schemes;
    groups.forEach((g, i) => {
      for (const key of ["one", "group"]) {
        // Buyers' surplus at a price: the area under demand above the price, out to the quantity bought.
        const sc = s[key];
        const area = areaUnderDemand(g.top, 0, sc.q[i]) - (sc.unit[i] ?? 0) * sc.q[i];
        close(sc.cs[i], g.buyers * area, 1e-4 * Math.max(1, sc.cs[i]));
      }
      // Under the menu and under a price for each buyer: what the units are worth, less what is paid.
      for (const key of ["menu", "each"]) close(s[key].cs[i], g.buyers * (areaUnderDemand(g.top, 0, s[key].q[i]) - s[key].pay[i]), 1e-4 * Math.max(1, s[key].profit));
    });
    // Welfare is the area between demand and cost over the units sold, whoever keeps it.
    for (const sc of Object.values(s)) close(sc.welfare, groups.reduce((sum, g, i) => sum + g.buyers * (areaUnderDemand(g.top, 0, sc.q[i]) - cost * sc.q[i]), 0), 1e-4 * Math.max(1, sc.welfare));
  }
  close(worth(10, 4), areaUnderDemand(10, 0, 4), 1e-6);
});

test("when one price serves every group, a price for each group sells the same total and lowers welfare by N/2 times the variance of the prices", () => {
  const r = rng(1981);
  let tried = 0;
  while (tried < 200) {
    const { groups, cost } = randomMarket(r);
    const c = compare(groups, cost);
    if (c.shutOut.length || c.neverBuy.length || c.alike) continue;
    tried++;
    const { one, group } = c.schemes;
    close(one.output, group.output, 1e-9 * Math.max(1, one.output));
    const N = groups.reduce((s, g) => s + g.buyers, 0);
    const mean = groups.reduce((s, g, i) => s + g.buyers * group.unit[i], 0) / N;
    const variance = groups.reduce((s, g, i) => s + g.buyers * (group.unit[i] - mean) ** 2, 0) / N;
    close(mean, one.price, 1e-9);
    close(one.welfare - group.welfare, (N / 2) * variance, 1e-7 * Math.max(1, one.welfare));
    assert.ok(group.welfare < one.welfare && group.profit > one.profit && group.csTotal < one.csTotal);
  }
});

test("when one price shuts a group out of a two-group market, a price for each group makes nobody worse off", () => {
  const r = rng(1933);
  let tried = 0;
  while (tried < 100) {
    const m = randomMarket(r);
    const groups = m.groups.slice(0, 2), c = compare(groups, m.cost);
    if (!c.shutOut.length) continue;
    tried++;
    const { one, group } = c.schemes;
    groups.forEach((g, i) => assert.ok(group.cs[i] >= one.cs[i] - 1e-9));
    assert.ok(group.profit > one.profit && group.welfare > one.welfare && group.output > one.output);
  }
  // With three groups it can go the other way: opening a tiny market (one buyer, worth 0.375 of welfare) while splitting
  // the price between two large ones (which costs 100).
  const mixed = compare(G(["Tiny", 1, 3], ["Mid", 100, 10], ["High", 100, 14]), 2);
  assert.deepEqual(mixed.shutOut, [0]);
  assert.ok(mixed.schemes.group.welfare < mixed.schemes.one.welfare);
  assert.match(verdict(G(["Tiny", 1, 3], ["Mid", 100, 10], ["High", 100, 14]), 2, mixed).text, /total welfare still falls by 99\.63, because the groups that were already buying now pay different prices\./);
});

test("two single prices that earn the same: the lower is used and the tie is reported", () => {
  // 300 buyers with top price 4 and 100 with top price 12, no cost: 3 serves all and earns 3 x (300 + 900) = 3,600;
  // 6 serves only the second group and earns 6 x 600 = 3,600.
  const groups = G(["Many", 300, 4], ["Few", 100, 12]);
  const best = onePrice(groups, 0);
  assert.deepEqual(best.tie, [3, 6]);
  assert.equal(best.price, 3); assert.equal(best.profit, 3600);
  assert.deepEqual(best.served, [true, true]);
  assert.equal(profitAt(groups, 0, 6), 3600);
  assert.match(verdict(groups, 0, compare(groups, 0)).text, /^Two single prices, 3\.00 and 6\.00, earn the seller the same profit\. The lower one, which serves more buyers, is used here\./);
  // A hair either way and the tie is gone.
  assert.equal(onePrice(G(["Many", 301, 4], ["Few", 100, 12]), 0).tie, null);
  assert.equal(onePrice(G(["Many", 299, 4], ["Few", 100, 12]), 0).price, 6);
});

test("isotonic regression pools exactly the values that are out of order", () => {
  assert.deepEqual(isotonic([1, 2, 3], [1, 1, 1]), [1, 2, 3]);
  assert.deepEqual(isotonic([3, 1], [1, 1]), [2, 2]);
  assert.deepEqual(isotonic([3, 1], [3, 1]), [2.5, 2.5]);
  // (6.5 x 40 - 6 x 10) / 50 = 4.
  assert.deepEqual(isotonic([6.5, -6, 12], [40, 10, 50]), [4, 4, 12]);
  assert.deepEqual(isotonic([5, 4, 3], [1, 1, 1]), [4, 4, 4]);
  assert.deepEqual(isotonic([2, 2], [1, 5]), [2, 2]);
});

/** Every constraint of the menu problem, checked directly: taking part, and not preferring any other group's bundle. */
function feasible(groups, q, pay, tol = 1e-9) {
  for (let i = 0; i < groups.length; i++) {
    const own = worth(groups[i].top, Math.min(q[i], groups[i].top)) - pay[i];
    if (own < -tol) return false;
    for (let k = 0; k < groups.length; k++) if (worth(groups[i].top, Math.min(q[k], groups[i].top)) - pay[k] > own + tol) return false;
  }
  return true;
}
const menuProfit = (groups, cost, q, pay) => groups.reduce((s, g, i) => s + g.buyers * (pay[i] - cost * q[i]), 0);

test("the menu satisfies every constraint, in the examples and in 300 random markets", () => {
  const r = rng(1984);
  for (const { groups, cost } of [...EXAMPLES, ...Array.from({ length: 300 }, () => randomMarket(r))]) {
    const m = menu(groups, cost);
    assert.ok(feasible(groups, m.q, m.pay, 1e-7), JSON.stringify({ groups, cost, q: m.q, pay: m.pay }));
    // Quantities rise with the top price and never exceed what the buyer would take at cost.
    const order = groups.map((_, i) => i).sort((x, y) => groups[x].top - groups[y].top);
    for (let j = 1; j < order.length; j++) assert.ok(m.q[order[j]] >= m.q[order[j - 1]] - 1e-9);
    groups.forEach((g, i) => { assert.ok(m.q[i] <= demand(g.top, cost) + 1e-9); assert.ok(m.surplus[i] >= -1e-9); close(m.surplus[i], m.q[i] > 0 ? worth(g.top, m.q[i]) - m.pay[i] : 0, 1e-7); });
    // The highest group that buys gets the efficient quantity unless it is pooled with a lower one.
    const top = order.at(-1);
    if (groups[top].top > cost && !m.pooled[top].some((k) => groups[k].top < groups[top].top)) close(m.q[top], groups[top].top - cost, 1e-9);
    close(m.profit, menuProfit(groups, cost, m.q, m.pay), 1e-7 * Math.max(1, m.profit));
  }
});

test("no menu on a grid of two bundles and two payments beats the menu found, and the grid's best matches it", () => {
  // The example on load: every quantity from 0 to 13 in halves and every payment from 0 to 100 in steps of 2.
  const { groups, cost } = ex("both");
  const best = menu(groups, cost);
  let top = -Infinity, arg = null, count = 0;
  for (let q1 = 0; q1 <= 13; q1 += 0.5) for (let q2 = 0; q2 <= 13; q2 += 0.5) for (let t1 = 0; t1 <= 100; t1 += 2) for (let t2 = 0; t2 <= 100; t2 += 2) {
    if (!feasible(groups, [q1, q2], [t1, t2])) continue;
    count++;
    const v = menuProfit(groups, cost, [q1, q2], [t1, t2]);
    if (v > top) { top = v; arg = [q1, q2, t1, t2]; }
  }
  assert.ok(count > 1000);
  assert.equal(top, 8000);
  assert.deepEqual(arg, [4, 12, 32, 80]);
  assert.equal(best.profit, 8000);
  // The market where students are shut out: the grid agrees that selling them nothing is best.
  const shut = ex("shut");
  let top2 = -Infinity, arg2 = null;
  for (let q1 = 0; q1 <= 13; q1 += 0.5) for (let q2 = 0; q2 <= 13; q2 += 0.5) for (let t1 = 0; t1 <= 100; t1 += 2) for (let t2 = 0; t2 <= 100; t2 += 2) {
    if (!feasible(shut.groups, [q1, q2], [t1, t2])) continue;
    const v = menuProfit(shut.groups, shut.cost, [q1, q2], [t1, t2]);
    if (v > top2) { top2 = v; arg2 = [q1, q2, t1, t2]; }
  }
  assert.equal(top2, 7200);
  // Professionals get 12 units for 96, all they are worth; the first such menu on the grid offers students nothing.
  assert.deepEqual(arg2, [0, 12, 0, 96]);
});

test("three groups: no menu on a coarse grid of three bundles and three payments beats the menu found", () => {
  // Top prices 4, 6 and 8, one buyer each, no cost: virtual top prices 0, 4 and 8, so bundles of 0, 4 and 8 units.
  const groups = G(["Low", 1, 4], ["Mid", 1, 6], ["High", 1, 8]);
  const m = menu(groups, 0);
  assert.deepEqual(m.virtual, [0, 4, 8]);
  assert.deepEqual(m.q, [0, 4, 8]); assert.deepEqual(m.pay, [0, 16, 24]); assert.equal(m.profit, 40);
  let top = -Infinity;
  const qs = [0, 1, 2, 3, 4, 5, 6, 7, 8], ts = Array.from({ length: 17 }, (_, i) => 2 * i);
  for (const q1 of qs) for (const q2 of qs) for (const q3 of qs) for (const t1 of ts) for (const t2 of ts) for (const t3 of ts) {
    const v = t1 + t2 + t3;
    if (v > top && feasible(groups, [q1, q2, q3], [t1, t2, t3])) top = v;
  }
  assert.equal(top, 40);
});

test("random menus that satisfy every constraint never earn more than the menu found", () => {
  const r = rng(404);
  let checked = 0;
  for (let k = 0; k < 60; k++) {
    const { groups, cost } = randomMarket(r);
    const best = menu(groups, cost);
    const hi = Math.max(...groups.map((g) => g.top));
    for (let j = 0; j < 400; j++) {
      // Start from the menu found and from scratch, half and half.
      const q = groups.map((g, i) => Math.max(0, j % 2 ? best.q[i] + r.normal(0, 0.5) : r.uniform(0, hi)));
      const pay = groups.map((g, i) => Math.max(0, j % 2 ? best.pay[i] + r.normal(0, 2) : r.uniform(0, worth(g.top, Math.min(q[i], g.top)))));
      if (!feasible(groups, q, pay, 0)) continue;
      checked++;
      assert.ok(menuProfit(groups, cost, q, pay) <= best.profit + 1e-7, JSON.stringify({ groups, cost, q, pay }));
    }
  }
  assert.ok(checked > 200, `only ${checked} random menus were feasible`);
});

test("a menu pools groups whose ideal sizes are out of order, and groups with the same top price", () => {
  const { groups, cost } = ex("pool");
  const m = menu(groups, cost);
  // Virtual top prices: 8 - (9 - 8) x 60 / 40 = 6.5; 9 - (12 - 9) x 50 / 10 = -6; 12. Pooled: (6.5 x 40 - 6 x 10) / 50 = 4.
  assert.deepEqual(m.virtual, [6.5, -6, 12]);
  assert.deepEqual(m.ironed, [4, 4, 12]);
  assert.deepEqual(m.q, [3, 3, 11]);
  // Bundle of 3: worth 8 x 3 - 4.5 = 19.5 to the lowest group. The middle group keeps (9 - 8) x 3 = 3, the top 3 + (12 - 9) x 3 = 12.
  assert.deepEqual(m.pay, [19.5, 19.5, 59.5]);
  assert.deepEqual(m.surplus, [0, 3, 12]);
  assert.deepEqual(m.pooled, [[1], [0], []]);
  assert.deepEqual(bundlesOf(groups, m).map((b) => b.takers), [[0, 1], [2]]);
  assert.equal(m.profit, 40 * 16.5 + 10 * 16.5 + 50 * 48.5);
  const same = menu(ex("same").groups, ex("same").cost);
  assert.deepEqual(same.q, [10, 10]); assert.deepEqual(same.pay, [70, 70]); assert.deepEqual(same.pooled, [[1], [0]]);
  // The order in which groups are typed does not matter.
  const flipped = menu([...groups].reverse(), cost);
  assert.deepEqual(flipped.q, [11, 3, 3]); assert.deepEqual(flipped.pay, [59.5, 19.5, 19.5]);
  close(flipped.profit, m.profit);
});

test("the orderings that must hold in every market", () => {
  const r = rng(2010);
  for (let k = 0; k < 300; k++) {
    const { groups, cost } = randomMarket(r);
    const { one, group, menu: m, each } = compare(groups, cost).schemes;
    const tol = 1e-7 * Math.max(1, each.profit);
    // A price for each buyer takes the whole surplus, which is the most any scheme can create.
    for (const s of [one, group, m]) { assert.ok(s.welfare <= each.welfare + tol); assert.ok(s.profit <= each.profit + tol); assert.ok(s.profit >= -tol); }
    close(each.csTotal, 0); close(each.profit, each.welfare, tol);
    // A price for each group can always copy the single price; so can a menu, by offering what each group buys at it.
    assert.ok(group.profit >= one.profit - tol);
    assert.ok(m.profit >= one.profit - tol);
    for (const s of [one, group, m, each]) close(s.welfare, s.profit + s.csTotal, tol);
  }
});

test("groups that would not pay the cost, and a market where nothing can be sold", () => {
  const groups = G(["Cheap", 50, 2], ["Keen", 50, 10]);
  const c = compare(groups, 3);
  assert.deepEqual(c.neverBuy, [0]); assert.deepEqual(c.shutOut, []); assert.equal(c.alike, true);
  for (const s of Object.values(c.schemes)) { assert.equal(s.q[0], 0); assert.equal(s.cs[0], 0); assert.equal(s.unit[0], null); }
  assert.equal(c.schemes.one.price, 6.5);
  assert.match(verdict(groups, 3, c).text, /No buyer in Cheap would pay the cost of a unit, so that group buys nothing under any scheme\.$/);
  assert.equal(groupWords(groups, c)[0], "Buyers in Cheap buy nothing either way.");
  // A top price equal to the cost counts as not buying.
  assert.deepEqual(compare(G(["Edge", 10, 3], ["Keen", 50, 10]), 3).neverBuy, [0]);
  const dead = compare(groups, 10);
  assert.equal(dead.anyTrade, false);
  for (const s of Object.values(dead.schemes)) { assert.equal(s.profit, 0); assert.equal(s.output, 0); assert.equal(s.welfare, 0); }
  assert.equal(dead.schemes.one.price, null);
  assert.deepEqual(verdict(groups, 10, dead), { kind: "warn", text: "No group would pay more than the cost of 10.00 a unit, so nothing is sold however the seller prices. Raise a group's highest price or lower the cost." });
  assert.equal(menuWords(groups, 10, dead), "No bundle can be sold at a profit.");
});

test("inputs are checked, and each message says what to fix", () => {
  const ok = G(["A", 10, 5], ["B", 10, 8]);
  assert.equal(check(ok, 2), null);
  assert.equal(check(ok, 0), null);
  for (const e of EXAMPLES) assert.equal(check(e.groups, e.cost), null, e.label);
  assert.match(check(ok.slice(0, 1), 2), /compares 2 to 4 groups/);
  assert.match(check([...ok, ...ok, ...ok], 2), /compares 2 to 4 groups/);
  assert.match(check(ok, -1), /cost of a unit must be a number from 0 to 1,000/);
  assert.match(check(ok, 1e308), /cost of a unit/);
  assert.match(check(ok, NaN), /cost of a unit/);
  assert.match(check(G(["A", 10.5, 5], ["B", 10, 8]), 2), /Group 1: the number of buyers must be a whole number from 1 to 100,000/);
  assert.match(check(G(["A", 0, 5], ["B", 10, 8]), 2), /Group 1: the number of buyers/);
  assert.match(check(G(["A", 10, 5], ["B", 1e9, 8]), 2), /Group 2: the number of buyers/);
  assert.match(check(G(["A", 10, 0], ["B", 10, 8]), 2), /Group 1: the highest price a buyer would pay must be a number from 0\.01 to 1,000/);
  assert.match(check(G(["A", 10, 5], ["B", 10, Infinity]), 2), /Group 2: the highest price/);
  assert.match(check(G(["A", 10, 5], ["B", 10, NaN]), 2), /Group 2: the highest price/);
  assert.match(check(G(["  ", 10, 5], ["B", 10, 8]), 2), /Group 1 needs a name/);
  assert.match(check(G(["x".repeat(LIMITS.name + 1), 10, 5], ["B", 10, 8]), 2), /Group 1's name is longer than 24 characters/);
  assert.match(check(G(["Same", 10, 5], [" same ", 10, 8]), 2), /Two groups are both called "same"\. Give each group its own name\./);
  // The largest market the limits allow stays finite.
  const huge = compare(G(["A", 100000, 1000], ["B", 100000, 999], ["C", 100000, 0.01], ["D", 1, 500]), 0);
  for (const s of Object.values(huge.schemes)) assert.ok(Number.isFinite(s.profit) && Number.isFinite(s.welfare));
});

test("every sentence the tool can write", () => {
  const both = ex("both"), rb = compare(both.groups, both.cost);
  assert.equal(verdict(both.groups, both.cost, rb).text, "One price of 7.00 serves every group. A price for each group sells exactly the same total, 1,000.00 units, but moves some of them from buyers who value them more to buyers who value them less: profit rises by 200.00, buyers' surplus falls by 300.00 and total welfare falls by 100.00.");
  assert.deepEqual(groupWords(both.groups, rb), ["Buyers in Students pay 6.00 a unit instead of 7.00, which raises their surplus by 350.00.", "Buyers in Professionals pay 8.00 a unit instead of 7.00, which lowers their surplus by 650.00."]);
  assert.equal(menuWords(both.groups, both.cost, rb), "The menu has 2 bundles: 4.00 units for 32.00 (8.00 a unit), chosen by Students; 12.00 units for 80.00 (6.67 a unit), chosen by Professionals. Buyers in Students are charged all that their bundle is worth to them and keep no surplus. Each buyer in Professionals keeps 16.00. That is the least the seller can leave: charge more and they would switch to a smaller bundle, or the group below would stop buying. Only the largest bundle is the size its buyers would choose at a price equal to cost, 12.00 units. Every smaller bundle is cut below that.");
  const shut = ex("shut"), rs = compare(shut.groups, shut.cost);
  assert.equal(verdict(shut.groups, shut.cost, rs).text, "The best single price is 8.00. No buyer in Students would pay that much, so that group buys nothing. A price for each group opens that market: output goes from 600.00 to 800.00 units, profit rises by 400.00 and total welfare rises by 600.00. No group of buyers is worse off and the seller is better off, so here discrimination helps everyone.");
  assert.deepEqual(groupWords(shut.groups, rs), ["Buyers in Students were shut out by the single price and now pay 4.00 a unit, which raises their surplus by 200.00.", "Buyers in Professionals pay 8.00 a unit either way."]);
  assert.match(menuWords(shut.groups, shut.cost, rs), /^The menu has one bundle: 12\.00 units for 96\.00 \(8\.00 a unit\), chosen by Professionals\. Buyers in Students are offered nothing they would take/);
  assert.match(menuWords(shut.groups, shut.cost, rs), /Buyers in Professionals are charged all that their bundle is worth to them and keep no surplus\.$/);
  const three = ex("three"), r3 = compare(three.groups, three.cost);
  const m3 = menuWords(three.groups, three.cost, r3);
  assert.match(m3, /Each buyer in Families keeps 6\.00 and each buyer in Firms keeps 38\.00\./);
  // 16 units for 122 is 7.63 a unit; 2 units for 12 is 6.00: eight small bundles would be cheaper, and the tool says so.
  assert.match(m3, /A larger bundle here costs more per unit than a smaller one, so the menu only holds if each buyer can take one bundle and no more/);
  assert.doesNotMatch(menuWords(both.groups, both.cost, rb), /costs more per unit/);
  const pool = ex("pool"), rp = compare(pool.groups, pool.cost);
  assert.match(menuWords(pool.groups, pool.cost, rp), /Occasional and Regular share a bundle: the sizes the seller would like to sell them do not rise with their highest prices/);
  const same = ex("same"), rsame = compare(same.groups, same.cost);
  assert.equal(verdict(same.groups, same.cost, rsame).text, "Every group that buys has the same highest price, so the seller has nothing to tell them apart by: the best single price, 7.00, is also the best price for each group, and the two schemes are identical.");
  assert.match(menuWords(same.groups, same.cost, rsame), /North and South have the same highest price, so the seller cannot tell them apart by what they choose and they take the same bundle\. Buyers in North and South are charged all/);
  // Two groups shut out at once.
  const two = G(["A", 10, 3], ["B", 10, 4], ["C", 500, 30]);
  assert.match(verdict(two, 1, compare(two, 1)).text, /No buyer in A and B would pay that much, so those groups buy nothing\. A price for each group opens those markets/);
  assert.equal(n2(-1e-9), "0.00"); assert.equal(n2(1234.5), "1,234.50");
  // A price is never rounded on to a different price: with top prices 10 and 14 and a cost of 13.99 the best price is
  // 13.995, which two decimals would print as 14.00, the price at which nobody buys.
  assert.equal(price(13.995), "13.995"); assert.equal(price(7), "7.00"); assert.equal(price(5.916666666666667), "5.9167");
  assert.equal(price(7.00004), "7.00"); assert.equal(price(1234.5), "1,234.50"); assert.equal(price(0.125), "0.125");
  const edge = G(["Students", 100, 10], ["Professionals", 100, 14]);
  assert.match(verdict(edge, 13.99, compare(edge, 13.99)).text, /the best single price, 13\.995, is also the best price for each group/);
  assert.match(verdict(three.groups, three.cost, r3).text, /^One price of 5\.9167 serves every group\./);
  assert.equal(groupWords(three.groups, r3)[0], "Buyers in Students pay 4.50 a unit instead of 5.9167, which raises their surplus by 380.73.");
  for (const e of EXAMPLES) {
    const r = compare(e.groups, e.cost);
    for (const s of [verdict(e.groups, e.cost, r).text, ...groupWords(e.groups, r), menuWords(e.groups, e.cost, r)]) assert.doesNotMatch(s, /NaN|undefined|Infinity|null/);
  }
});

test("two markets of three groups against the reviewer's separate brute-force search", () => {
  // Solved without logic.js: a grid of single prices (step 0.0005), a grid of prices for each group, and for the menu every
  // allocation of quantities on a grid with the dearest payments that satisfy all participation and incentive
  // constraints, then the buyers choosing from the menu and a search of its neighbourhood for anything better.
  // Market 1: A 60 buyers up to 5, B 30 up to 9, C 10 up to 20, cost 1.
  const m1 = G(["A", 60, 5], ["B", 30, 9], ["C", 10, 20]), r1 = compare(m1, 1).schemes;
  close(r1.one.price, 6.375, 1e-9); assert.deepEqual(r1.one.served, [false, true, true]);
  close(r1.one.profit, 1155.625, 1e-6); close(r1.one.csTotal, 1031.5625, 1e-6); close(r1.one.output, 215, 1e-9);
  assert.deepEqual(r1.group.unit, [3, 5, 10.5]);
  close(r1.group.profit, 1622.5, 1e-9); close(r1.group.csTotal, 811.25, 1e-9); close(r1.group.welfare, 2433.75, 1e-9); close(r1.group.output, 335, 1e-9);
  [4 / 3, 13 / 3, 19].forEach((q, i) => close(r1.menu.q[i], q, 1e-9));
  [5.777777777777778, 24.27777777777778, 146.5].forEach((t, i) => close(r1.menu.pay[i], t, 1e-9));
  close(r1.menu.profit, 2140, 1e-9); assert.deepEqual(r1.menu.cs.map((v) => Math.round(v * 1e6) / 1e6), [0, 160, 530]);
  close(r1.menu.welfare, 2830, 1e-9); close(r1.menu.output, 400, 1e-9);
  close(r1.each.profit, 3245, 1e-9); close(r1.each.output, 670, 1e-9);
  // Market 2: A 50 up to 6, B 10 up to 7, C 40 up to 12, cost 1. The menu pools A and B on one unit each.
  const m2 = G(["A", 50, 6], ["B", 10, 7], ["C", 40, 12]), r2 = compare(m2, 1).schemes;
  close(r2.one.price, 4.75, 1e-9); close(r2.one.profit, 1406.25, 1e-9); close(r2.one.csTotal, 1115.625, 1e-9); close(r2.one.welfare, 2521.875, 1e-9);
  close(r2.group.profit, 1612.5, 1e-9); close(r2.group.welfare, 2418.75, 1e-9); close(r2.group.output, 375, 1e-9); close(r2.one.output, 375, 1e-9);
  assert.deepEqual(r2.menu.q.map((v) => Math.round(v * 1e9) / 1e9), [1, 1, 11]);
  assert.deepEqual(r2.menu.pay.map((v) => Math.round(v * 1e9) / 1e9), [5.5, 5.5, 65.5]);
  close(r2.menu.profit, 2450, 1e-9); assert.deepEqual(r2.menu.cs.map((v) => Math.round(v * 1e6) / 1e6), [0, 10, 240]);
  close(r2.menu.welfare, 2700, 1e-9); close(r2.menu.output, 500, 1e-9); close(r2.each.profit, 3225, 1e-9);
  // The standard results: the top group's bundle is the efficient size, lower bundles are smaller than efficient, the
  // lowest group served keeps nothing and every group above it keeps something.
  for (const [groups, r] of [[m1, r1], [m2, r2]]) {
    assert.equal(r.menu.q[2], groups[2].top - 1);
    assert.ok(r.menu.q[0] < groups[0].top - 1 && r.menu.q[1] < groups[1].top - 1);
    assert.ok(Math.abs(r.menu.surplus[0]) < 1e-9 && r.menu.surplus[1] > 0 && r.menu.surplus[2] > r.menu.surplus[1]);
  }
});

test("an amount too small to print is called less than 0.01, never 0.00", () => {
  assert.equal(n2(0), "0.00"); assert.equal(n2(1e-9), "0.00"); assert.equal(n2(0.0049), "less than 0.01"); assert.equal(n2(0.000001), "less than 0.01");
  assert.equal(n2(0.005), "0.01"); assert.equal(n2(0.01), "0.01");
  // A cost a hair below a group's top price: the group does buy at its own price, a sliver of a unit.
  const g = G(["A", 100, 6], ["C", 40, 12]), r = compare(g, 5.999999).schemes;
  assert.ok(r.group.q[0] > 0 && r.group.q[0] < 1e-6);
  assert.equal(n2(r.group.q[0]), "less than 0.01"); assert.equal(n2(r.group.pay[0]), "less than 0.01");
  // The verdict does not claim that a market was opened, that profit "rises by 0.00" or that everyone is helped.
  const rr = compare(g, 5.999999), v = verdict(g, 5.999999, rr).text;
  assert.equal(v, "The best single price is 9.00. No buyer in A would pay that much, so that group buys nothing. A price for each group would let that group buy, but its highest price is so close to the cost that output, profit and total welfare all change by less than 0.01.");
  assert.equal(groupWords(g, rr)[0], "Buyers in A were shut out by the single price and now pay 6.00 a unit, which raises their surplus by less than 0.01.");
  // A real opening is still described as one (the example on the page).
  const shut = ex("shut");
  assert.match(verdict(shut.groups, shut.cost, compare(shut.groups, shut.cost)).text, /opens that market: output goes from 600\.00 to 800\.00 units, profit rises by 400\.00 and total welfare rises by 600\.00\. No group of buyers is worse off/);
});
