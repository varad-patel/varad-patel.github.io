import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { POPULATION, PRESENT, CHILD_SHARES, LIMITS, POVERTY_SHARE, erf, sigmaFromGini, generate, begin, extend, finish, scheduleProblem, taxOn, taxTotal, giniSorted, prepare, reformProblem, childAmount, simulate, netCost, balance } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/** A population written out by hand: [{ incomes: [one per adult], children }]. */
function households(list) {
  const H = list.length;
  const adults = Uint8Array.from(list.map((h) => h.incomes.length)), children = Uint8Array.from(list.map((h) => h.children));
  const size = adults.map((a, h) => a + children[h]);
  const income = Float64Array.from(list.flatMap((h) => h.incomes));
  const start = new Uint32Array(H + 1);
  for (let h = 0; h < H; h++) start[h + 1] = start[h] + adults[h];
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  return { H, people: sum(size), nAdults: income.length, nChildren: sum(children), adults, children, size, start, income, marketIncome: sum(income) };
}
/** Gini by its definition, half the mean absolute difference over the mean: a separate route from giniSorted. */
function giniByPairs(x) {
  let diff = 0, sum = 0;
  for (const a of x) { sum += a; for (const b of x) diff += Math.abs(a - b); }
  return diff / (2 * x.length * sum);
}
const FOUR = households([{ incomes: [0], children: 0 }, { incomes: [30000], children: 1 }, { incomes: [50000, 0], children: 2 }, { incomes: [100000, 100000], children: 0 }]);
const REFORM = { amount: 6000, childShare: 0.5, allowance: 0, basicRate: 30, threshold: 80000, higherRate: 50 };
const POP = generate({ seed: 43, gini: 0.45 });
const BASE = prepare(POP);
// The page's opening reform before its rates are set: 6,000 a month, half for a child, no allowance.
const OPENING = { amount: 6000, childShare: 0.5, allowance: 0, basicRate: 20, threshold: 80000, higherRate: 40 };

test("the error function and the lognormal's Gini", () => {
  close(erf(0), 0);
  close(erf(0.5), 0.5204998778130465, 1e-14);      // tabulated values
  close(erf(1), 0.8427007929497149, 1e-14);
  close(erf(-1), -0.8427007929497149, 1e-14);
  // Gini = erf(sigma / 2): sigma = 1 gives 0.5205, and the search undoes it.
  close(sigmaFromGini(0.5204998778130465), 1, 1e-12);
  for (const g of [0.25, 0.45, 0.65]) close(erf(sigmaFromGini(g) / 2), g, 1e-12);
  assert.ok(Number.isNaN(sigmaFromGini(0)) && Number.isNaN(sigmaFromGini(1)) && Number.isNaN(sigmaFromGini(NaN)));
});

test("the population is reproducible and is what the page says it is", () => {
  const again = generate({ seed: 43, gini: 0.45 });
  assert.deepEqual(Array.from(again.income), Array.from(POP.income));
  assert.deepEqual(Array.from(again.children), Array.from(POP.children));
  assert.notDeepEqual(Array.from(generate({ seed: 44, gini: 0.45 }).income.slice(0, 50)), Array.from(POP.income.slice(0, 50)));
  // Pinned, so that a change to the generator cannot pass unnoticed.
  assert.deepEqual(Array.from(POP.income.slice(0, 8)), [191442, 212454, 46455, 0, 23965, 114421, 47821, 68333]);
  assert.deepEqual([POP.H, POP.people, POP.nAdults, POP.nChildren, POP.marketIncome], [20000, 49957, 31973, 17984, 1165720004]);
  assert.equal(POP.nAdults + POP.nChildren, POP.people);
  assert.ok(POP.income.every((y) => Number.isInteger(y) && y >= 0));

  // The stated make-up, within sampling error for 20,000 households.
  const share = (arr, v) => arr.filter((x) => x === v).length / arr.length;
  for (const [n, p] of POPULATION.adults) close(share(Array.from(POP.adults), n), p, 0.01);
  for (const [n, p] of POPULATION.children) close(share(Array.from(POP.children), n), p, 0.01);
  const earned = Array.from(POP.income).filter((y) => y > 0).sort((a, b) => a - b);
  close(1 - earned.length / POP.nAdults, POPULATION.noIncome, 0.01);
  close(earned[Math.floor(earned.length / 2)] / POPULATION.median, 1, 0.02);       // median of those with an income
  close(giniSorted(earned), 0.45, 0.01);                                           // their Gini
  // The same seed with a different Gini is the same people with their incomes stretched.
  const wide = generate({ seed: 43, gini: 0.6 });
  assert.deepEqual(Array.from(wide.adults), Array.from(POP.adults));
  assert.deepEqual(Array.from(wide.income).map((y) => y > 0), Array.from(POP.income).map((y) => y > 0));
  close(giniSorted(Array.from(wide.income).filter((y) => y > 0).sort((a, b) => a - b)), 0.6, 0.012);
});

test("the population can be rebuilt from the write-up alone", () => {
  // Written from "How it works" without the kit or logic.js: mulberry32 from the seed; per household one number for
  // the adults, one for the children, then per adult one for "no income" and, if there is one, a Box-Muller normal.
  let a = 43;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const sigma = sigmaFromGini(0.45);
  close(sigma, 0.845, 0.0005);                                    // the value the page quotes
  const adults = [], children = [], incomes = [];
  for (let h = 0; h < 20000; h++) {
    const n = u() < 0.4 ? 1 : 2;
    const c = u();
    adults.push(n); children.push(c < 0.5 ? 0 : c < 0.7 ? 1 : c < 0.9 ? 2 : 3);
    for (let j = 0; j < n; j++) {
      if (u() < 0.15) { incomes.push(0); continue; }
      let u1 = 0;
      while (u1 === 0) u1 = u();
      incomes.push(Math.round(30000 * Math.exp(sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u()))));
    }
  }
  assert.deepEqual(adults, Array.from(POP.adults));
  assert.deepEqual(children, Array.from(POP.children));
  assert.deepEqual(incomes, Array.from(POP.income));
  // The write-up's example: with seed 43 the first household has two adults, on 191,442 and 212,454 a month.
  assert.deepEqual([adults[0], incomes[0], incomes[1]], [2, 191442, 212454]);
});

test("the generator refuses bad settings", () => {
  assert.match(generate({ seed: 1.5 }).error, /seed/);
  assert.match(generate({ seed: -1 }).error, /seed/);
  assert.match(generate({ seed: 1e6 }).error, /seed/);
  assert.match(generate({ seed: NaN }).error, /seed/);
  assert.match(generate({ seed: "43" }).error, /seed/);
  assert.match(generate({ gini: 0.1 }).error, /Gini/);
  assert.match(generate({ gini: 0.9 }).error, /Gini/);
  assert.match(generate({ gini: NaN }).error, /Gini/);
  assert.match(generate({ households: 5 }).error, /households/);
  assert.match(generate({ households: 1e7 }).error, /households/);
  assert.equal(generate({ seed: 0, gini: 0.25, households: 10 }).H, 10);
  assert.match(begin({ seed: 2.5 }).error, /seed/);
  // Drawn in pieces, the population is the same as drawn in one go.
  const draft = begin({ seed: 43, gini: 0.45 });
  let pieces = 1;
  while (!extend(draft, 1777)) pieces++;
  const drawn = finish(draft);
  assert.equal(pieces, 12);
  assert.deepEqual(Array.from(drawn.income), Array.from(POP.income));
  assert.deepEqual([Array.from(drawn.start), Array.from(drawn.size), drawn.people, drawn.marketIncome], [Array.from(POP.start), Array.from(POP.size), POP.people, POP.marketIncome]);
});

test("income tax, by hand", () => {
  // Present system: nothing on the first 10,000, 20% up to 80,000, 40% above.
  assert.equal(taxOn(0, PRESENT), 0);
  assert.equal(taxOn(10000, PRESENT), 0);
  assert.equal(taxOn(30000, PRESENT), 4000);                 // 20% of 20,000
  assert.equal(taxOn(80000, PRESENT), 14000);                // 20% of 70,000
  assert.equal(taxOn(100000, PRESENT), 22000);               // 14,000 + 40% of 20,000
  // To the nearest rupee, halves upward: 12.5% of 3 is 0.375, of 4 is 0.5.
  const odd = { allowance: 10000, basicRate: 12.5, threshold: 80000, higherRate: 40 };
  assert.equal(taxOn(10003, odd), 0);
  assert.equal(taxOn(10004, odd), 1);
  // An allowance above the threshold: everything taxed is taxed at the higher rate.
  assert.equal(taxOn(60000, { allowance: 50000, basicRate: 20, threshold: 20000, higherRate: 40 }), 4000);
  assert.equal(taxOn(40000, { allowance: 50000, basicRate: 20, threshold: 20000, higherRate: 40 }), 0);
  // No allowance, one rate.
  assert.equal(taxOn(123456, { allowance: 0, basicRate: 33.3, threshold: 80000, higherRate: 33.3 }), 41111);   // 41,110.848
  assert.equal(taxTotal(FOUR, PRESENT), 0 + 4000 + 8000 + 0 + 22000 + 22000);
  // Tax never falls as income rises, and never exceeds income.
  for (const s of [PRESENT, odd, { allowance: 0, basicRate: 100, threshold: 20000, higherRate: 100 }]) {
    let last = 0;
    for (let y = 0; y <= 300000; y += 137) { const t = taxOn(y, s); assert.ok(t >= last && t <= y); last = t; }
  }
});

test("Gini coefficient, by hand and by its definition", () => {
  assert.equal(giniSorted([5, 5, 5, 5]), 0);
  close(giniSorted([0, 0, 0, 1]), 0.75);                      // one person has everything: 1 - 1/n
  close(giniSorted([1, 2, 3]), 2 / 9);
  assert.ok(Number.isNaN(giniSorted([0, 0])) && Number.isNaN(giniSorted([])));
  const x = [0, 3, 3, 7, 20, 20, 41];
  close(giniSorted(x), giniByPairs(x), 1e-12);
});

test("four households, worked by hand", () => {
  const base = prepare(FOUR);
  // Net incomes under the present system: 0; 30,000 - 4,000; 50,000 - 8,000; 2 x (100,000 - 22,000).
  assert.deepEqual(Array.from(base.net), [0, 26000, 42000, 156000]);
  assert.equal(base.tax, 56000);
  // Per equivalent adult: 0, 26,000/sqrt 2, 42,000/2, 156,000/sqrt 2. Nine people; the fifth is in the third household.
  close(base.eq[1], 18384.776310850235, 1e-9);
  assert.equal(base.median, 21000);
  assert.equal(base.line, POVERTY_SHARE * 21000);
  close(base.poverty, 1 / 9, 1e-15);                          // the single adult with nothing
  const people = [0, base.eq[1], base.eq[1], 21000, 21000, 21000, 21000, base.eq[3], base.eq[3]];
  close(base.gini, giniByPairs(people), 1e-12);
  // With nine people the cut points are simply each person's income in turn, bar the last:
  // 0, e, e, 21,000 four times, E. Strictly below each household's income lie 0, 1, 3 and 7 of them.
  assert.deepEqual(Array.from(base.decile), [0, 1, 3, 7]);
  // People with exactly the same income stay in one tenth, the one their first member falls in: twenty single
  // adults, ten on 20,000 and ten on 50,000, fill the first tenth and the sixth.
  const tied = prepare(households([...Array(10).fill({ incomes: [20000], children: 0 }), ...Array(10).fill({ incomes: [50000], children: 0 })]));
  assert.deepEqual(tied.decilePeople, [10, 0, 0, 0, 0, 10, 0, 0, 0, 0]);
  assert.deepEqual(base.decilePeople, [1, 2, 0, 4, 0, 0, 0, 2, 0, 0]);

  const r = simulate(FOUR, base, REFORM);
  // Basic income: 6 adults x 6,000 + 3 children x 3,000.
  assert.equal(r.gross, 45000);
  // Reform tax (30% to 80,000, 50% above, no allowance): 0, 9,000, 15,000 + 0, 2 x 34,000.
  assert.equal(r.taxReform, 92000);
  assert.equal(r.extraTax, 36000);
  assert.equal(r.netCost, 9000);
  // Household changes: +6,000, +4,000, +11,000, -12,000.
  assert.equal(r.changeSum, 9000);
  assert.deepEqual(r.deciles.map((d) => d.change), [6000, 4000, 0, 11000, 0, 0, 0, -12000, 0, 0]);
  assert.deepEqual(r.deciles.map((d) => d.people), base.decilePeople);
  assert.deepEqual([r.gainers, r.losers, r.unchanged], [7, 2, 0]);
  // The single adult now has 6,000, still under the line of 10,500.
  close(r.poverty.after, 1 / 9, 1e-15);
  const after = [6000, 30000 / Math.SQRT2, 30000 / Math.SQRT2, 26500, 26500, 26500, 26500, 144000 / Math.SQRT2, 144000 / Math.SQRT2];
  close(r.gini.after, giniByPairs(after), 1e-12);
  assert.ok(r.gini.after < r.gini.before);
  // A basic income at the line lifts that adult out.
  close(simulate(FOUR, base, { ...REFORM, amount: 10500 }).poverty.after, 0, 1e-15);
  close(simulate(FOUR, base, { ...REFORM, amount: 10499 }).poverty.after, 1 / 9, 1e-15);
});

test("the accounts add up to the rupee", () => {
  const r0 = rng(7);
  for (let i = 0; i < 40; i++) {
    const reform = {
      amount: r0.int(0, LIMITS.amount), childShare: r0.pick(CHILD_SHARES), allowance: r0.int(0, LIMITS.allowance),
      basicRate: r0.int(0, 1000) / 10, threshold: r0.int(...LIMITS.threshold), higherRate: r0.int(0, 1000) / 10,
    };
    const r = simulate(POP, BASE, reform);
    assert.equal(r.error, undefined);
    // Basic income paid, less extra tax raised, is the net cost, and it is the sum of every household's change.
    assert.equal(r.gross, POP.nAdults * reform.amount + POP.nChildren * childAmount(reform));
    assert.equal(r.taxReform, taxTotal(POP, reform));
    assert.equal(r.netCost, r.gross - (r.taxReform - r.taxPresent));
    assert.equal(r.changeSum, r.netCost);
    assert.equal(netCost(POP, BASE, reform), r.netCost);
    assert.equal(r.deciles.reduce((s, d) => s + d.change, 0), r.netCost);
    assert.equal(r.deciles.reduce((s, d) => s + d.people, 0), POP.people);
    assert.equal(r.gainers + r.losers + r.unchanged, POP.people);
    for (const d of r.deciles) assert.equal(d.gainers + d.losers + d.unchanged, d.people);
    assert.ok(r.poverty.after >= 0 && r.poverty.after <= 1 && r.gini.after > -1e-12 && r.gini.after < 1);
  }
});

test("known results", () => {
  // The present system as the "reform": nothing changes.
  const same = simulate(POP, BASE, { amount: 0, childShare: 0.5, ...PRESENT });
  assert.deepEqual([same.gross, same.extraTax, same.netCost, same.gainers, same.losers, same.unchanged], [0, 0, 0, 0, 0, POP.people]);
  assert.equal(same.poverty.after, same.poverty.before);
  assert.equal(same.gini.after, same.gini.before);
  // A basic income with taxes untouched: every household gains exactly what it is paid, the net cost is the
  // gross cost, poverty cannot rise and incomes become more equal.
  const free = simulate(POP, BASE, { amount: 6000, childShare: 0.5, ...PRESENT });
  assert.equal(free.netCost, free.gross);
  assert.equal(free.gross, 31973 * 6000 + 17984 * 3000);
  assert.deepEqual([free.gainers, free.losers], [POP.people, 0]);
  assert.ok(free.poverty.after < free.poverty.before && free.gini.after < free.gini.before);
  // Tenths of people are tenths: no household is split, so sizes differ by a few people at most.
  for (const n of BASE.decilePeople) assert.ok(Math.abs(n - POP.people / 10) <= 5, String(n));
  // The poorest tenth is poorer than the richest.
  assert.ok(free.deciles[0].baseIncome / free.deciles[0].people < free.deciles[9].baseIncome / free.deciles[9].people);
  // Children's share: none, half, all.
  assert.deepEqual(CHILD_SHARES.map((childShare) => childAmount({ amount: 5001, childShare })), [0, 2501, 5001]);
});

test("making the reform pay for itself", () => {
  const b = balance(POP, BASE, OPENING);
  assert.equal(b.possible, true);
  assert.equal(b.shift, 16.6);
  assert.deepEqual([b.reform.basicRate, b.reform.higherRate], [36.6, 56.6]);
  // The smallest move that works: it leaves a small surplus, and a tenth of a point less leaves a cost.
  assert.equal(b.netCost, -664862);
  assert.equal(simulate(POP, BASE, b.reform).netCost, -664862);
  assert.equal(netCost(POP, BASE, { ...b.reform, basicRate: 36.5, higherRate: 56.5 }), 500838);
  // The net cost never rises as the rates rise.
  let last = Infinity;
  for (let s = -200; s <= 800; s += 25) {
    const cost = netCost(POP, BASE, { ...OPENING, basicRate: Math.max(0, (200 + s) / 10), higherRate: Math.min(100, (400 + s) / 10) });
    assert.ok(cost <= last);
    last = cost;
  }
  // The present system is already in balance: no move.
  const none = balance(POP, BASE, { amount: 0, childShare: 0.5, ...PRESENT });
  assert.deepEqual([none.possible, none.shift, none.netCost], [true, 0, 0]);
  // A reform in surplus gets a cut. Here: no basic income, no allowance and rates of 30% and 50%.
  const cut = balance(POP, BASE, { amount: 0, childShare: 0, allowance: 0, basicRate: 30, threshold: 80000, higherRate: 50 });
  assert.equal(cut.shift, -14.5);
  assert.ok(cut.netCost <= 0 && netCost(POP, BASE, { ...cut.reform, basicRate: 15.4, higherRate: 35.4 }) > 0);
  // Too much to pay for even at 100%.
  const big = balance(POP, BASE, { ...OPENING, amount: 40000, childShare: 1 });
  assert.equal(big.possible, false);
  assert.ok(big.netCostAtMost > 0);
  // A rate that reaches 100% stops there while the other keeps moving.
  const steep = balance(POP, BASE, { ...OPENING, amount: 14000, higherRate: 90 });
  assert.equal(steep.possible, true);
  assert.equal(steep.reform.higherRate, 100);
  assert.ok(steep.reform.basicRate < 100 && steep.netCost <= 0);
});

test("bad reforms are refused with a reason", () => {
  assert.equal(reformProblem(REFORM), "");
  assert.equal(scheduleProblem(PRESENT), "");
  assert.match(reformProblem({ ...REFORM, amount: -1 }), /basic income/);
  assert.match(reformProblem({ ...REFORM, amount: 1e9 }), /basic income/);
  assert.match(reformProblem({ ...REFORM, amount: 100.5 }), /basic income/);
  assert.match(reformProblem({ ...REFORM, amount: NaN }), /basic income/);
  assert.match(reformProblem({ ...REFORM, childShare: 0.3 }), /child/);
  assert.match(reformProblem({ ...REFORM, allowance: -5 }), /allowance/);
  assert.match(reformProblem({ ...REFORM, allowance: 1e7 }), /allowance/);
  assert.match(reformProblem({ ...REFORM, threshold: 100 }), /threshold/);
  assert.match(reformProblem({ ...REFORM, basicRate: 101 }), /basic rate/);
  assert.match(reformProblem({ ...REFORM, basicRate: -1 }), /basic rate/);
  assert.match(reformProblem({ ...REFORM, basicRate: 20.05 }), /basic rate/);
  assert.match(reformProblem({ ...REFORM, higherRate: Infinity }), /higher rate/);
  assert.match(reformProblem(null), /reform/);
  assert.match(simulate(POP, BASE, { ...REFORM, amount: -1 }).error, /basic income/);
  assert.match(balance(POP, BASE, { ...REFORM, higherRate: 200 }).error, /higher rate/);
  assert.match(prepare(POP, { ...PRESENT, basicRate: 120 }).error, /basic rate/);
});

test("the numbers on the page", () => {
  // The present system for seed 43.
  assert.equal((100 * BASE.poverty).toFixed(1), "23.4");
  assert.equal(BASE.gini.toFixed(3), "0.431");
  assert.equal(Math.round(BASE.line), 12011);
  assert.equal((100 * BASE.tax / POP.marketIncome).toFixed(1), "18.4");
  // One finding: 6,000 a month, half for a child, no allowance, rates moved to balance.
  const b = balance(POP, BASE, OPENING);
  const r = simulate(POP, BASE, b.reform);
  assert.equal(Math.round(r.gross / POP.people), 4920);
  assert.equal((100 * r.gross / POP.marketIncome).toFixed(1), "21.1");
  assert.deepEqual([b.shift, b.reform.basicRate, b.reform.higherRate], [16.6, 36.6, 56.6]);
  assert.equal((100 * r.poverty.after).toFixed(1), "11.2");
  assert.equal(r.gini.after.toFixed(3), "0.329");
  assert.equal((100 * r.gainers / POP.people).toFixed(1), "63.7");
  assert.equal((100 * r.losers / POP.people).toFixed(1), "36.3");
  assert.equal(r.unchanged, 2);
  const perPerson = r.deciles.map((d) => Math.round(d.change / d.people));
  assert.deepEqual(perPerson, [4270, 2985, 2413, 1858, 1311, 605, -170, -1246, -2994, -9171]);
  // The same basic income with taxes left alone: everyone gains and nothing pays for it.
  const free = simulate(POP, BASE, { ...OPENING, allowance: PRESENT.allowance });
  assert.equal((100 * free.netCost / POP.marketIncome).toFixed(1), "21.1");
  assert.equal((100 * free.poverty.after).toFixed(1), "7.7");
  // A basic income at the poverty line with one rate of tax.
  const atLine = Math.ceil(BASE.line / 100) * 100;
  assert.equal(atLine, 12100);
  const flat = balance(POP, BASE, { amount: atLine, childShare: 0.5, allowance: 0, basicRate: 40, threshold: 80000, higherRate: 40 });
  const f = simulate(POP, BASE, flat.reform);
  assert.equal(f.poverty.after, 0);
  assert.equal(flat.reform.basicRate, flat.reform.higherRate);
  assert.equal(flat.reform.basicRate, 60.9);
  // Turning the allowance into a payment: 2,000 a month is what the allowance is worth to a basic-rate taxpayer.
  const swap = balance(POP, BASE, { ...OPENING, amount: 2000 });
  assert.equal(swap.shift, 2.5);
});
