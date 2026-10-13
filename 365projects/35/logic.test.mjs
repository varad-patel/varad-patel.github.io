import test from "node:test";
import assert from "node:assert/strict";
import { BUDGET } from "./data.js";
import { groupIndian, rupees, crore, percent, parseAmount, MAX_TAX, shortName, yearView, funding, splitTax, changeTable, shareSeries, squarify } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const Y = (year) => BUDGET.years.indexOf(year);
const demand = (ministry, name, year) => BUDGET.ministries.find((m) => m.name === ministry).demands.find((d) => d.name === name).v[Y(year)];
const ministry = (view, name) => view.ministries.find((m) => m.name === name);

/* ---------- the data against the source's own figures ---------- */

test("grand totals match Expenditure Profile Statement 3 and Budget at a Glance", () => {
  // Statement 3, "Grand Total", Total column. Budget at a Glance prints the same figures rounded to the crore.
  assert.equal(BUDGET.total[Y("2026-27")], 5347314.81); // Budget Estimates 2026-2027 (Budget 2026-27): BAG says 5347315
  assert.equal(BUDGET.total[Y("2025-26")], 4964841.74); // Revised Estimates 2025-2026 (Budget 2026-27): BAG says 4964842
  assert.equal(BUDGET.total[Y("2024-25")], 4652867.4);  // Actuals 2024-2025 (Budget 2026-27): BAG says 4652867
  assert.equal(BUDGET.total[Y("2020-21")], 3509836.38); // Actuals 2020-2021 (Budget 2022-23)
  assert.equal(BUDGET.total[Y("2017-18")], 2141973.06); // Actuals 2017-2018 (Budget 2019-20): BAG says 2141973
});

test("individual demands match the source", () => {
  // Summary of Demands for Grants 2026-27 and Statement 3 of the Expenditure Profile 2026-27.
  assert.equal(demand("Ministry of Finance", "Interest Payments", "2026-27"), 1403971.79);
  assert.equal(demand("Ministry of Defence", "Defence Pensions", "2026-27"), 171338.22);
  assert.equal(demand("Ministry of Railways", "Ministry of Railways", "2026-27"), 281377.32);
  assert.equal(demand("Ministry of Agriculture and Farmers Welfare", "Department of Agriculture and Farmers Welfare", "2024-25"), 129933.47); // Actuals 2024-2025
  assert.equal(demand("Ministry of Agriculture and Farmers Welfare", "Department of Agriculture and Farmers Welfare", "2025-26"), 123089.3);  // Revised Estimates 2025-2026
  // Statement 3A of the Expenditure Profile 2019-20, Actuals 2017-2018.
  assert.equal(demand("Ministry of Finance", "Department of Economic Affairs", "2017-18"), -23.11);
  assert.equal(demand("Ministry of Road Transport and Highways", "Ministry of Road Transport and Highways", "2017-18"), 61014.76);
});

test("ministry totals match the Summary of Demands for Grants 2026-27", () => {
  const v = yearView(BUDGET, Y("2026-27"));
  close(ministry(v, "Ministry of Finance").value, 1972509.48, 0.01);
  close(ministry(v, "Ministry of Defence").value, 784678.28, 0.01);
  close(ministry(v, "Ministry of Home Affairs").value, 255233.53, 0.01);
  close(ministry(v, "Ministry of Education").value, 139289.48, 0.01);
});

test("receipts match Budget at a Glance and add up to spending in every year", () => {
  const r = BUDGET.receipts, i = Y("2026-27");
  assert.deepEqual([r.netTax[i], r.nonTax[i], r.loans[i], r.other[i], r.borrowing[i]], [2866922, 666228, 38397, 80000, 1695768]);
  assert.deepEqual([r.grossTax[i], r.statesShare[i]], [4404086, 1526255]);
  assert.equal(r.borrowing[Y("2020-21")], 1818291); // Actuals 2020-2021, Budget at a Glance 2022-23
  assert.equal(r.borrowing[Y("2022-23")], 1737755); // Actuals 2022-2023, Budget at a Glance 2024-25
  // Where a spreadsheet and the printed PDF differ, the site treats the PDF as final, so these are the PDF's figures.
  assert.equal(r.nonTax[Y("2021-22")], 365112);      // Budget at a Glance 2023-24, PDF; its spreadsheet has 3651132 and 365113
  assert.equal(r.statesShare[Y("2021-22")], 898392); // the same PDF; the spreadsheet has 898393
  assert.equal(r.nonTax[Y("2019-20")], 327157);      // Budget at a Glance 2021-22, PDF; the spreadsheet's "Receipts" has 327158
  assert.deepEqual([r.grossTax[Y("2017-18")], r.statesShare[Y("2017-18")], r.netTax[Y("2017-18")]], [1919009, 673006, 1242488]); // Budget at a Glance 2019-20
  BUDGET.years.forEach((_, k) => close(r.netTax[k] + r.nonTax[k] + r.loans[k] + r.other[k] + r.borrowing[k], BUDGET.total[k], 2));
  assert.equal(BUDGET.retrieved, "2026-10-12");
});

test("every year's demands add up to its grand total, and each year says what kind of figure it is", () => {
  BUDGET.years.forEach((_, i) => {
    const total = BUDGET.ministries.reduce((s, m) => s + m.demands.reduce((t, d) => t + (d.v[i] ?? 0), 0), 0);
    close(total, BUDGET.total[i], 0.06);
  });
  assert.deepEqual(BUDGET.years, ["2017-18", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]);
  assert.deepEqual(BUDGET.status, [...Array(8).fill("Actuals"), "Revised Estimates", "Budget Estimates"]);
  assert.deepEqual(BUDGET.budget, ["2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27", "2026-27", "2026-27"]);
  assert.equal(BUDGET.ministries.length, 56);
  assert.equal(BUDGET.ministries.reduce((s, m) => s + m.demands.length, 0), 102);
});

/* ---------- formatting ---------- */

test("Indian grouping, rupees, crore and percentages", () => {
  assert.equal(groupIndian(0), "0");
  assert.equal(groupIndian(999), "999");
  assert.equal(groupIndian(1000), "1,000");
  assert.equal(groupIndian(100000), "1,00,000");
  assert.equal(groupIndian(1234567), "12,34,567");
  assert.equal(groupIndian(123456789012), "1,23,45,67,89,012");
  assert.equal(groupIndian(-1234567.4), "−12,34,567");
  assert.equal(groupIndian(-0.2), "0");
  assert.equal(groupIndian(NaN), "–");
  assert.equal(rupees(26255.5), "₹26,256");
  assert.equal(rupees(0.368), "₹0.37");
  assert.equal(rupees(9.994), "₹9.99");
  assert.equal(rupees(9.996), "₹10");
  assert.equal(rupees(0), "₹0");
  assert.equal(rupees(-4.3), "−₹4.30");
  assert.equal(rupees(-43210), "−₹43,210");
  assert.equal(rupees(Infinity), "–");
  assert.equal(crore(5347314.81), "₹53.47 lakh crore");
  assert.equal(crore(100000), "₹1.00 lakh crore");
  assert.equal(crore(99999.4), "₹99,999 crore");
  assert.equal(crore(99999.6), "₹1.00 lakh crore");
  assert.equal(crore(1744.74), "₹1,745 crore");
  assert.equal(crore(68.45), "₹68.5 crore");
  assert.equal(crore(11.7), "₹11.7 crore");
  assert.equal(crore(0), "₹0 crore");
  assert.equal(crore(-23.11), "−₹23.1 crore");
  assert.equal(percent(0.36888), "36.9%");
  assert.equal(percent(0.0263), "2.63%");
  assert.equal(percent(0.00033), "0.033%");
  assert.equal(percent(0), "0.000%");
  assert.equal(percent(-0.0001), "−0.010%");
  assert.equal(percent(NaN), "–");
});

test("the amount box accepts rupees and says what is wrong otherwise", () => {
  assert.deepEqual(parseAmount("100000"), { value: 100000 });
  assert.deepEqual(parseAmount(" ₹1,00,000 "), { value: 100000 });
  assert.deepEqual(parseAmount("2500.50"), { value: 2500.5 });
  assert.deepEqual(parseAmount(String(MAX_TAX)), { value: MAX_TAX });
  assert.deepEqual(parseAmount("1"), { value: 1 });
  assert.ok(parseAmount("0.99").error.includes("at least ₹1")); // below one rupee every line of the split would read ₹0.00
  for (const bad of ["", "   ", "abc", "-5", "1e5", "1 lakh", "12..5", "0", "0.00", "0.004", "0.99", "100000000001", "1e308", "9".repeat(400), "<b>1</b>", null, undefined]) {
    const r = parseAmount(bad);
    assert.ok(r.error && r.value === undefined, `"${bad}" should be refused`);
    assert.ok(r.error.length > 20);
  }
});

/* ---------- the split ---------- */

test("a year's view: shares add to one, ministries are in order, missing demands are named", () => {
  BUDGET.years.forEach((_, i) => {
    const v = yearView(BUDGET, i);
    close(v.ministries.reduce((s, m) => s + (m.share ?? 0), 0), 1, 1e-7);
    for (let k = 1; k < v.ministries.length; k++) assert.ok((v.ministries[k - 1].value ?? -Infinity) >= (v.ministries[k].value ?? -Infinity));
    for (const m of v.ministries) if (m.value != null) close(m.demands.reduce((s, d) => s + d.share, 0), m.share, 1e-9);
  });
  const first = yearView(BUDGET, 0);
  assert.equal(ministry(first, "Ministry of Cooperation").value, null);
  assert.equal(ministry(first, "Ministry of Cooperation").share, null);
  assert.deepEqual(ministry(first, "Ministry of Home Affairs").missing, ["Ladakh", "Transfers to Jammu and Kashmir"]);
  assert.equal(first.ministries.at(-1).name, "Ministry of Cooperation");
  assert.equal(first.status, "Actuals");
  assert.equal(first.budget, "2019-20");
  assert.throws(() => yearView(BUDGET, 10), RangeError);
  assert.throws(() => yearView(BUDGET, -1), RangeError);
  assert.throws(() => yearView(BUDGET, 1.5), RangeError);
});

test("splitting a tax bill by hand: three made-up ministries", () => {
  const rows = [{ name: "A", share: 0.5 }, { name: "B", share: 0.3 }, { name: "C", share: 0.2 }, { name: "D", share: null }];
  const s = splitTax(1000, rows);
  assert.deepEqual(s.rows.map((r) => r.amount), [500, 300, 200, null]);
  assert.equal(s.toStates, 0);
  assert.equal(s.toUnion, 1000);
  const t = splitTax(1000, rows, { statesShare: 0.25 });
  assert.equal(t.toStates, 250);
  assert.deepEqual(t.rows.map((r) => r.amount), [375, 225, 150, null]);
  assert.deepEqual(splitTax(0, rows).rows.map((r) => r.amount), [0, 0, 0, null]);
  assert.throws(() => splitTax(-1, rows), RangeError);
  assert.throws(() => splitTax(NaN, rows), RangeError);
  assert.throws(() => splitTax(Infinity, rows), RangeError);
  assert.throws(() => splitTax(100, rows, { statesShare: 1 }), RangeError);
  assert.throws(() => splitTax(100, rows, { statesShare: -0.1 }), RangeError);
});

test("the split of a real year adds back up to the amount, with and without the States' share", () => {
  const v = yearView(BUDGET, Y("2026-27")), f = funding(BUDGET, Y("2026-27"));
  const s = splitTax(100000, v.ministries);
  close(s.rows.reduce((a, r) => a + (r.amount ?? 0), 0), 100000, 1e-6);
  const t = splitTax(100000, v.ministries, { statesShare: f.statesShare });
  close(t.toStates + t.rows.reduce((a, r) => a + (r.amount ?? 0), 0), 100000, 1e-6);
  close(t.toStates, 100000 * 1526255 / 4404086, 1e-9);
});

test("the finding: interest takes 26.26 paise of each rupee in 2026-27, up from 24.69 in 2017-18", () => {
  const now = yearView(BUDGET, Y("2026-27")), then = yearView(BUDGET, Y("2017-18"));
  const finance = ministry(now, "Ministry of Finance");
  const s = splitTax(100000, finance.demands);
  const interest = s.rows.find((r) => r.name === "Interest Payments");
  assert.equal(rupees(interest.amount), "₹26,256");
  close(interest.share, 1403971.79 / 5347314.81, 1e-12);
  assert.equal(percent(interest.share), "26.3%");
  assert.equal(finance.demands[0].name, "Interest Payments"); // the largest demand in the budget
  assert.ok(now.ministries.every((m) => m.demands.every((d) => d.value <= interest.value)));
  const ministries = splitTax(100000, now.ministries).rows;
  assert.deepEqual(ministries.slice(0, 3).map((m) => [m.short, rupees(m.amount)]), [["Finance", "₹36,888"], ["Defence", "₹14,674"], ["Road Transport and Highways", "₹5,795"]]);
  // More goes to interest than to the next two ministries, Defence and Road Transport and Highways, put together.
  assert.ok(interest.amount > ministries[1].amount + ministries[2].amount);
  const before = ministry(then, "Ministry of Finance").demands.find((d) => d.name === "Interest Payments");
  assert.equal((before.share * 100).toFixed(2), "24.69");
  assert.equal((interest.share * 100).toFixed(2), "26.26");
  assert.equal(percent(funding(BUDGET, Y("2026-27")).borrowing), "31.7%");
  assert.equal(percent(funding(BUDGET, Y("2020-21")).borrowing), "51.8%");
  assert.equal(percent(funding(BUDGET, Y("2017-18")).borrowing), "27.6%");
});

test("funding shares add up to one and the States' share is the budget's own ratio", () => {
  BUDGET.years.forEach((_, i) => {
    const f = funding(BUDGET, i);
    close(f.netTax + f.nonTax + f.assets + f.borrowing, 1, 2e-6);
    assert.ok(f.statesShare > 0.28 && f.statesShare < 0.38);
  });
  close(funding(BUDGET, Y("2026-27")).statesShare, 1526255 / 4404086, 1e-12);
  assert.equal(percent(funding(BUDGET, Y("2026-27")).statesShare), "34.7%");
  assert.equal(percent(funding(BUDGET, Y("2026-27")).netTax), "53.6%"); // quoted in the write-up
  // What is left of gross tax revenue after the States' share and the Centre's net revenue is the duty passed to the disaster
  // response funds: ₹10,909 crore here (the document prints 10910), the 0.25% of gross tax revenue quoted in the write-up.
  const r = BUDGET.receipts, i = Y("2026-27");
  assert.equal(r.grossTax[i] - r.statesShare[i] - r.netTax[i], 10909);
  assert.equal(((r.grossTax[i] - r.statesShare[i] - r.netTax[i]) / r.grossTax[i] * 100).toFixed(2), "0.25");
});

test("ten years of change: points and multiples by hand, ordering, and ministries without a first figure", () => {
  const t = changeTable(BUDGET, 0, 9);
  assert.equal(t.length, 56);
  const defence = t.find((r) => r.short === "Defence");
  // Defence in 2017-18 is the sum of its four demands (civil, services revenue, capital outlay, pensions) as bundled.
  const then = BUDGET.ministries.find((m) => m.name === "Ministry of Defence").demands.reduce((s, d) => s + d.v[0], 0);
  close(defence.from, then / 2141973.06, 1e-12);
  close(defence.to, 784678.28 / 5347314.81, 1e-9);
  close(defence.points, (784678.28 / 5347314.81 - then / 2141973.06) * 100, 1e-7);
  close(defence.multiple, 784678.28 / then, 1e-9);
  for (let k = 1; k < t.length; k++) assert.ok((t[k - 1].points ?? -Infinity) >= (t[k].points ?? -Infinity));
  const coop = t.find((r) => r.short === "Cooperation");
  assert.equal(coop.points, null);
  assert.equal(coop.multiple, null);
  assert.equal(coop.from, null);
  assert.equal(t.at(-1).short, "Cooperation");
  // Same year against itself: nothing changes.
  for (const r of changeTable(BUDGET, 9, 9)) { assert.equal(r.points, 0); assert.equal(r.multiple, 1); }
  // The points gained and lost cancel out among ministries that have both figures, apart from the newcomer's share.
  const net = t.reduce((s, r) => s + (r.points ?? 0), 0);
  close(net, -coop.to * 100, 1e-6);
});

test("share over time for a ministry and for one demand", () => {
  const s = shareSeries(BUDGET, "Ministry of Finance", "Interest Payments");
  assert.equal(s.length, 10);
  close(s[9].share, 1403971.79 / 5347314.81, 1e-12);
  assert.equal(s[8].status, "Revised Estimates");
  const c = shareSeries(BUDGET, "Ministry of Cooperation");
  assert.deepEqual(c.slice(0, 3).map((p) => p.share), [null, null, null]);
  assert.equal(c[3].share, 0);
  const home = shareSeries(BUDGET, "Ministry of Home Affairs");
  assert.ok(home.every((p) => p.share > 0.03 && p.share < 0.08));
  assert.throws(() => shareSeries(BUDGET, "Ministry of Magic"), RangeError);
  assert.throws(() => shareSeries(BUDGET, "Ministry of Finance", "Owls"), RangeError);
});

test("short names", () => {
  assert.equal(shortName("Ministry of Finance"), "Finance");
  assert.equal(shortName("Department of Space"), "Space");
  assert.equal(shortName("Ministry of Development of North Eastern Region"), "Development of North Eastern Region");
  assert.ok(shortName(BUDGET.ministries.find((m) => m.name.startsWith("The President")).name).length < 62);
});

/* ---------- treemap ---------- */

const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-7 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-7;
function checkTiling(items, W, H) {
  const tiles = squarify(items, 0, 0, W, H);
  const positive = items.filter((it) => it.value > 0);
  assert.equal(tiles.length, positive.length);
  const total = positive.reduce((s, it) => s + it.value, 0);
  for (const t of tiles) {
    assert.ok(t.x >= -1e-9 && t.y >= -1e-9 && t.x + t.w <= W + 1e-7 && t.y + t.h <= H + 1e-7, "tile inside the frame");
    assert.ok(t.w > 0 && t.h > 0);
    close(t.w * t.h, (t.value / total) * W * H, 1e-6 * W * H);
  }
  close(tiles.reduce((s, t) => s + t.w * t.h, 0), W * H, 1e-6 * W * H);
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) assert.ok(!overlap(tiles[i], tiles[j]), `tiles ${i} and ${j} overlap`);
  return tiles;
}

test("squarify reproduces the worked example of Bruls, Huizing and van Wijk", () => {
  // Their figure: areas 6, 6, 4, 3, 2, 2, 1 in a 6 by 4 rectangle. First column 6 and 6 (each 3 wide, 2 high),
  // then a strip of 4 and 3 across the top of what is left, then 2, then 2 and 1.
  const tiles = checkTiling([6, 6, 4, 3, 2, 2, 1].map((value, id) => ({ id, value })), 6, 4);
  const box = (t) => [t.x, t.y, t.w, t.h].map((v) => Number(v.toFixed(6)));
  assert.deepEqual(box(tiles[0]), [0, 0, 3, 2]);
  assert.deepEqual(box(tiles[1]), [0, 2, 3, 2]);
  assert.deepEqual(box(tiles[2]), [3, 0, 1.714286, 2.333333]);
  assert.deepEqual(box(tiles[3]), [4.714286, 0, 1.285714, 2.333333]);
  assert.deepEqual(box(tiles[4]), [3, 2.333333, 1.2, 1.666667]);
});

test("squarify tiles the frame exactly for the real budget at desktop and phone shapes", () => {
  for (const i of [0, 3, 9]) {
    const v = yearView(BUDGET, i);
    for (const [W, H] of [[760, 440], [358, 460], [300, 300]]) {
      const tiles = checkTiling(v.ministries.filter((m) => m.value != null), W, H);
      assert.equal(tiles[0].short, "Finance");
      // The point of squarifying: the big tiles are not slivers.
      for (const t of tiles.slice(0, 8)) assert.ok(Math.max(t.w / t.h, t.h / t.w) < 4, `${t.short} is a sliver`);
    }
    checkTiling(ministry(v, "Ministry of Finance").demands, 760, 440);
  }
});

test("squarify edges: one item, equal items, zero and negative values, nothing to draw", () => {
  assert.deepEqual(squarify([{ value: 5 }], 10, 20, 30, 40), [{ value: 5, x: 10, y: 20, w: 30, h: 40 }]);
  const four = checkTiling([1, 1, 1, 1].map((value) => ({ value })), 2, 2);
  for (const t of four) { close(t.w, 1, 1e-9); close(t.h, 1, 1e-9); }
  const mixed = squarify([{ value: -23.11, n: "neg" }, { value: 0, n: "zero" }, { value: 3, n: "a" }, { value: NaN, n: "nan" }, { value: 1, n: "b" }], 0, 0, 4, 1);
  assert.deepEqual(mixed.map((t) => t.n), ["a", "b"]);
  close(mixed[0].w * mixed[0].h, 3, 1e-9);
  assert.deepEqual(squarify([], 0, 0, 1, 1), []);
  assert.deepEqual(squarify([{ value: 0 }], 0, 0, 1, 1), []);
  assert.deepEqual(squarify([{ value: 1 }], 0, 0, 0, 1), []);
  // A thousand tiles of very different sizes still tile exactly.
  checkTiling(Array.from({ length: 1000 }, (_, k) => ({ value: 1 + (k * 7919) % 997 })), 800, 500);
  // Extreme ratios do not produce NaN.
  for (const t of squarify([{ value: 1e12 }, { value: 1e-6 }], 0, 0, 100, 50)) assert.ok([t.x, t.y, t.w, t.h].every(Number.isFinite));
});
