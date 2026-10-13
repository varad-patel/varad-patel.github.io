import test from "node:test";
import assert from "node:assert/strict";
import { IO } from "./data.js";
import { JUMP_MIN, JUMP_MAX, jumpProblem, coefficients, passThrough, basketAfter, breakdown, leontiefInverse } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const sum = (a) => a.reduce((s, v) => s + v, 0);
const at = (id) => IO.sectors.findIndex((s) => s.id === id);
const table = (ids, flows, output, consumption) => ({ sectors: ids.map((id) => ({ id, name: id })), flows, output, consumption });

test("the table holds BEA's own figures for 2023", () => {
  // Read from the 2023 sheets of BEA's make and use tables after redefinitions, summary level, millions of dollars.
  assert.equal(IO.year, 2023);
  assert.equal(IO.output[at("oil")], 448428);          // Total Industry Output, 211 Oil and gas extraction
  assert.equal(IO.valueAdded[at("oil")], 230667);      // Total Value Added, 211
  assert.equal(IO.output[at("petroleum")], 744115);    // Total Industry Output, 324 Petroleum and coal products
  // The table's own totals: GDP 27,720,708, personal consumption 18,822,770, industry output 48,386,809.
  // Each sector is rounded to a whole million here and BEA's own cells are rounded too, so allow a few million.
  close(sum(IO.valueAdded), 27720708, 25);
  close(sum(IO.output), 48386809, 25);
  // The page leaves out the two rows that no industry produces. Personal consumption of "Used" is 93,132 and
  // of "Other" -33,227, so 18,822,770 - 93,132 + 33,227 = 18,762,865 is spread over the sectors.
  close(sum(IO.consumption), 18762865, 25);
  // The same two rows as inputs: industries bought 99,421 of "Used" and 167,498 of "Other".
  close(sum(IO.outside), 99421 + 167498, 25);
  // The use table's own row for the commodity oil and gas: what each industry bought of it.
  assert.equal(IO.oilGasCommodity[at("petroleum")], 384735);   // 324 Petroleum and coal products
  assert.equal(IO.oilGasCommodity[at("utilities")], 17076);    // 22 Utilities
  assert.equal(IO.oilGasCommodity[at("chemicals")], 7625);     // 325 Chemical products
  assert.equal(IO.oilGasCommodity[at("air")], 0);              // 481 Air transportation: none
  assert.equal(IO.detail.householdOilGas, 0);                  // personal consumption expenditures: none
  // The make table's row for oil and gas extraction, and the total made of petroleum and coal products.
  assert.deepEqual(IO.detail.oilIndustryMakes, { oilAndGas: 404488, petroleumProducts: 43242 });
  assert.equal(IO.detail.petroleumProductsMade, 765774);
});

test("the table is complete and balanced", () => {
  const n = IO.sectors.length;
  assert.equal(n, 21);
  assert.equal(IO.sectors[0].id, "oil");
  assert.equal(new Set(IO.sectors.map((s) => s.id)).size, n);
  assert.equal(sum(IO.sectors.map((s) => s.bea.length)), 71);                 // every BEA summary industry, once
  assert.equal(new Set(IO.sectors.flatMap((s) => s.bea)).size, 71);
  assert.ok(IO.flows.length === n && IO.flows.every((row) => row.length === n && row.every((v) => Number.isInteger(v) && v >= 0)));
  assert.ok(IO.consumption.every((v) => v >= 0));
  assert.ok(IO.outside.length === n && IO.outside.every((v) => Number.isInteger(v) && v >= 0));
  assert.ok(IO.oilGasCommodity.length === n && IO.oilGasCommodity.every((v) => Number.isInteger(v) && v >= 0));
  // What a sector buys from the other sectors and from outside the table, plus the value it adds, is what it
  // sells (to within rounding of the cells in a column).
  for (let j = 0; j < n; j++) close(sum(IO.flows.map((row) => row[j])) + IO.outside[j] + IO.valueAdded[j], IO.output[j], 30);
  // The oil and gas industry never sells a sector less than the crude oil and gas the use table has it buying
  // from that industry (99.9% of the commodity is made there).
  for (let j = 0; j < n; j++) assert.ok(IO.flows[0][j] >= 0.998 * IO.oilGasCommodity[j] - 1, IO.sectors[j].id);
});

test("two sectors, by hand", () => {
  // Sector x spends 20 cents of each dollar of output on oil and 50 cents on its own product.
  // Its price rises by r = 0.2 + 0.5 r for a unit rise in oil, so r = 0.4.
  const r = passThrough(table(["oil", "x"], [[10, 20], [30, 50]], [100, 100], [10, 90]));
  close(r.perUnit[1], 0.4, 1e-12);
  close(r.direct[1], 0.2, 1e-12);
  close(r.indirect[1], 0.2, 1e-12);
  assert.deepEqual([r.perUnit[0], r.direct[0], r.indirect[0]], [1, 1, 0]);
  close(r.basket, 0.1 * 1 + 0.9 * 0.4, 1e-12);
});

test("three sectors, by hand, round by round", () => {
  // x buys 10 cents of oil and 20 cents of y per dollar; y buys 50 cents of x and no oil.
  // x = 0.1 + 0.2 y and y = 0.5 x give x = 1/9 and y = 1/18.
  const t = table(["oil", "x", "y"], [[0, 10, 0], [0, 0, 50], [0, 20, 0]], [100, 100, 100], [0, 50, 50]);
  const r = passThrough(t);
  close(r.perUnit[1], 1 / 9, 1e-12);
  close(r.perUnit[2], 1 / 18, 1e-12);
  close(r.indirect[2], 1 / 18, 1e-12);          // y buys no oil: everything it feels is indirect
  const rounds = r.rounds(4);
  // Round 1 reaches x only (0.1). Round 2 reaches y through x (0.05). Round 3 comes back to x through y (0.01).
  assert.deepEqual(rounds[0].map((v) => +v.toFixed(12)), [1, 0.1, 0]);
  assert.deepEqual(rounds[1].map((v) => +v.toFixed(12)), [1, 0.1, 0.05]);
  assert.deepEqual(rounds[2].map((v) => +v.toFixed(12)), [1, 0.11, 0.05]);
  assert.deepEqual(rounds[3].map((v) => +v.toFixed(12)), [1, 0.11, 0.055]);
  // Where x's rise comes from: oil directly 0.1, and y's product 0.2 x 1/18.
  const parts = r.inputsOf(1);
  assert.equal(parts[0].id, "oil");
  close(parts[0].carries, 0.1, 1e-12);
  close(parts.find((p) => p.id === "y").carries, 0.2 / 18, 1e-12);
  close(sum(parts.map((p) => p.carries)), 1 / 9, 1e-12);
});

test("the solved prices are the limit of the rounds", () => {
  const r = passThrough(IO);
  const rounds = r.rounds(80);
  for (let j = 0; j < r.n; j++) close(rounds[79][j], r.perUnit[j], 1e-12);
  // Each round adds something and never overshoots.
  for (let t = 1; t < 20; t++) for (let j = 0; j < r.n; j++) assert.ok(rounds[t][j] >= rounds[t - 1][j] && rounds[t][j] <= r.perUnit[j] + 1e-12);
  for (let j = 1; j < r.n; j++) close(rounds[0][j], r.direct[j], 1e-15);
});

test("the result agrees with the full Leontief inverse", () => {
  // A known identity: with sector k's price set from outside, dp_j = L[k][j] / L[k][k], L = (I - A)^-1.
  const r = passThrough(IO), L = leontiefInverse(IO), k = r.k;
  for (let j = 0; j < r.n; j++) close(r.perUnit[j], L[k][j] / L[k][k], 1e-12);
  // And the price model reproduces the prices it starts from: (I - A')^-1 v = 1 when v is the part of each
  // dollar that is not bought from another sector: value added and inputs from outside the table.
  const v = IO.valueAdded.map((x, j) => (x + IO.outside[j]) / IO.output[j]);
  for (let j = 0; j < r.n; j++) close(sum(L.map((row, i) => v[i] * row[j])), 1, 2e-4);
});

test("every sector's rise is the sum of what its inputs carry, and the basket's of what its products carry", () => {
  const r = passThrough(IO);
  for (let j = 1; j < r.n; j++) {
    close(sum(r.inputsOf(j).map((p) => p.carries)), r.perUnit[j], 1e-12);
    close(r.direct[j] + r.indirect[j], r.perUnit[j], 1e-15);
    assert.ok(r.indirect[j] >= 0 && r.direct[j] >= 0);
  }
  assert.deepEqual(r.inputsOf(0), []);
  close(sum(r.basketParts().map((p) => p.carries)), r.basket, 1e-12);
  close(sum(r.weights), 1, 1e-12);
  close(basketAfter(r, r.perUnit), r.basket, 1e-15);
  // A coefficient is a flow over the buyer's output: 30 of y bought by x, whose output is 200.
  assert.deepEqual(coefficients(table(["x", "y"], [[10, 0], [30, 5]], [200, 50], [1, 1])), [[0.05, 0], [0.15, 0.1]]);
  close(coefficients(IO)[0][1], 0.51784, 5e-6);                // refineries spend 52 cents of each dollar of output on oil and gas
});

test("the look-inside table adds up, by hand and for every sector", () => {
  // x buys 10 cents of oil and 20 cents of y per dollar and adds 70 cents of value; y's price rises by 1/18.
  const t = { ...table(["oil", "x", "y"], [[0, 10, 0], [0, 0, 50], [0, 20, 0]], [100, 100, 100], [0, 50, 50]), valueAdded: [100, 70, 50], outside: [0, 0, 0] };
  const b = breakdown(passThrough(t), t, 1, 1, 2);
  assert.equal(b.total, 11.11);                                   // 100 / 9
  assert.deepEqual(b.parts.map((p) => [p.id, p.share, p.rise, p.points]), [["oil", 10, 100, 10], ["y", 20, 5.56, 1.11]]);
  assert.deepEqual(b.fixed, [{ id: "valueAdded", share: 70 }, { id: "outside", share: 0 }]);
  assert.deepEqual(b.rest, { share: 0, points: 0 });
  // The basket: half x and half y, so 50 x 1/9 + 50 x 1/18 = 8.33 points.
  const basket = breakdown(passThrough(t), t, null, 1, 1);
  assert.deepEqual([basket.total, basket.parts[0].id, basket.parts[0].share, basket.parts[0].points, basket.rest.share, basket.rest.points, basket.fixed.length], [8.33, "x", 50, 5.56, 50, 2.77, 0]);
  // On the page's table, for every sector and the basket and several jumps, both columns add up to the totals.
  const r = passThrough(IO);
  for (const jump of [-0.5, -0.3, 0.05, 0.5, 1, 2]) for (let j = 1; j <= r.n; j++) {
    const x = breakdown(r, IO, j === r.n ? null : j, jump);
    close(x.parts.reduce((s, p) => s + p.share, 0) + x.rest.share + x.fixed.reduce((s, f) => s + f.share, 0), 100, 1e-9);
    close(x.parts.reduce((s, p) => s + p.points, 0) + x.rest.points, x.total, 1e-9);
    assert.ok(x.rest.share >= 0 && x.parts.length === 6);
  }
});

test("another sector can be the one whose price is set", () => {
  const r = passThrough(IO, "petroleum");
  assert.equal(r.k, 1);
  assert.equal(r.perUnit[1], 1);
  assert.ok(r.perUnit[at("air")] > 0.1);                        // jet fuel
  assert.match(passThrough(IO, "unicorns").error, /no sector/);
});

test("bad input is refused", () => {
  assert.equal(jumpProblem(0.5), "");
  assert.equal(jumpProblem(JUMP_MIN), "");
  assert.equal(jumpProblem(JUMP_MAX), "");
  assert.match(jumpProblem(NaN), /number/);
  assert.match(jumpProblem("0.5"), /number/);
  assert.match(jumpProblem(Infinity), /number/);
  assert.match(jumpProblem(2.01), /between/);
  assert.match(jumpProblem(-0.6), /between/);
  assert.match(passThrough(table(["oil"], [[1]], [10], [1])).error, /two sectors/);
  assert.match(passThrough(table(["oil", "x"], [[0, 1], [0, 1]], [10, 0], [1, 1])).error, /output/);
  // A sector that spends its whole revenue on its own product leaves no room for value added.
  assert.match(passThrough(table(["oil", "x"], [[0, 10], [0, 100]], [100, 100], [1, 1])).error, /value added/);
});

test("the numbers on the page", () => {
  const r = passThrough(IO), jump = 0.5;
  const pct = (v, d = 2) => (100 * jump * v).toFixed(d);
  // One finding: a 50% jump.
  assert.equal(pct(r.perUnit[at("petroleum")]), "26.70");
  assert.equal(pct(r.perUnit[at("air")]), "3.77");
  assert.equal(pct(r.direct[at("air")]), "0.37");
  assert.equal(pct(r.inputsOf(at("air")).find((p) => p.id === "petroleum").carries), "3.23");
  assert.equal(pct(r.perUnit[at("utilities")]), "2.33");
  assert.equal(pct(r.basket), "0.78");
  // The same figures as the "Look inside" table shows them for air transport.
  const air = breakdown(r, IO, at("air"), jump);
  assert.deepEqual([air.total, air.parts[0].id, air.parts[0].points, air.parts[1].id, air.parts[1].points], [3.77, "petroleum", 3.23, "oil", 0.37]);
  // How it works: what the oil and gas industry sold in 2023, in billions of dollars, and its share of petroleum products.
  const made = IO.detail.oilIndustryMakes;
  assert.deepEqual([made.oilAndGas, made.petroleumProducts, IO.output[at("oil")]].map((v) => Math.round(v / 1000)), [404, 43, 448]);
  assert.equal((100 * made.petroleumProducts / IO.detail.petroleumProductsMade).toFixed(1), "5.6");
  assert.equal((100 * made.petroleumProducts / IO.output[at("oil")]).toFixed(0), "10");          // "the tenth of its output"
  assert.equal((100 * (1 - sum(IO.consumption) / 18822770)).toFixed(1), "0.3");                  // household spending left out of the basket
  // The recipes quoted in "How it works": cents per dollar of output.
  assert.equal((100 * r.A[r.k][at("petroleum")]).toFixed(0), "52");
  assert.equal((100 * r.A[r.k][at("air")]).toFixed(1), "0.7");
  assert.equal((100 * r.A[at("petroleum")][at("air")]).toFixed(0), "12");
  assert.equal(IO.sectors.filter((_, j) => j !== r.k && jump * r.perUnit[j] < 0.01).length, 14);
  // Ranking: refineries, then air transport, then utilities.
  const order = IO.sectors.map((s, j) => [s.id, r.perUnit[j]]).filter(([id]) => id !== "oil").sort((a, b) => b[1] - a[1]).map(([id]) => id);
  assert.deepEqual(order.slice(0, 3), ["petroleum", "air", "utilities"]);
  // How it spreads: the share of the basket's rise that has arrived by rounds 1 and 3.
  const rounds = r.rounds(3);
  assert.equal((100 * basketAfter(r, rounds[0]) / r.basket).toFixed(0), "58");
  assert.equal((100 * basketAfter(r, rounds[2]) / r.basket).toFixed(0), "92");
  assert.equal((100 * rounds[0][at("air")] / r.perUnit[at("air")]).toFixed(0), "10");
  // The note on aggregation: the same basket figure with all 71 industries, from the data script.
  assert.equal((100 * IO.detail.basketPerUnit).toFixed(2), "1.63");
  assert.equal((100 * r.basket).toFixed(2), "1.56");
  assert.ok(IO.detail.maxGapToBeaTotalRequirements < 1e-4);
});
