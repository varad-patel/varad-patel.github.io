import test from "node:test";
import assert from "node:assert/strict";
import {
  INDIA, AGES, MAX_INCOME, STEP, SYSTEMS, slabTax, indiaTax, flatTax, consumptionTax, spendShareAt,
  groupIndian, rupees, rupeesShort, parseRupees, parseSlabs, slabsText, taxAt, compare, rateCurves, oldOrNew,
} from "./logic.js";

const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const NEW = INDIA.regimes.new.slabs(), OLD = INDIA.regimes.old.slabs("under60");
const person = (gross, extra = {}) => ({ gross, salaried: false, age: "under60", deductions: 0, ...extra });
const SETTINGS = { flatRate: 0.15, flatAllowance: 400000, ownSlabs: [[500000, 0], [2000000, 0.2], [Infinity, 0.4]], consRate: 0.18, consExempt: 0, fallPerDoubling: 0.05 };

/* ---------- the law, against official figures ---------- */

test("new-regime slabs reproduce the table in the Budget Speech 2025-26 (Part B annexure), unchanged for 2026-27", () => {
  // Columns "Tax on slabs and rates: proposed" and "Tax after rebate". The Finance Bill 2026 memorandum says the
  // section 202 rates for tax year 2026-27 "would be same as already enacted".
  const official = [[800000, 20000, 0], [900000, 30000, 0], [1000000, 40000, 0], [1100000, 50000, 0], [1200000, 60000, 0],
    [1600000, 120000, 120000], [2000000, 200000, 200000], [2400000, 300000, 300000], [5000000, 1080000, 1080000]];
  for (const [income, onSlabs, afterRebate] of official) {
    close(slabTax(income, NEW), onSlabs);
    const t = indiaTax(person(income), "new");
    close(t.slabTax, onSlabs);
    close(t.afterRebate, afterRebate);
    close(t.total, afterRebate * 1.04); // 4% health and education cess on tax and surcharge; no surcharge up to ₹50 lakh
  }
});

test("a salaried person pays nothing up to ₹12.75 lakh under the new regime (Budget Speech 2025-26, paragraph 156)", () => {
  assert.equal(indiaTax(person(1275000, { salaried: true }), "new").total, 0);
  assert.equal(indiaTax(person(1275000, { salaried: true }), "new").taxable, 1200000);
  assert.equal(indiaTax(person(1200000), "new").total, 0);
  assert.ok(indiaTax(person(1275001, { salaried: true }), "new").total > 0);
});

test("the cumulative amounts on the Income Tax Department's slab tables", () => {
  // e-filing portal, "Salaried Individuals", tax slab tables: "₹20,000 + 10% above ₹8,00,000" and so on.
  close(slabTax(800000, NEW), 20000);
  close(slabTax(1200000, NEW), 60000);
  close(slabTax(1600000, NEW), 120000);
  close(slabTax(2000000, NEW), 200000);
  close(slabTax(2400000, NEW), 300000);
  // Old regime: "₹12,500 + 20% above ₹5,00,000", "₹1,12,500 + 30% above ₹10,00,000".
  close(slabTax(500000, OLD), 12500);
  close(slabTax(1000000, OLD), 112500);
  // 60 to under 80: "₹10,000 + 20%", "₹1,10,000 + 30%". 80 and over: "₹1,00,000 + 30% above ₹10,00,000".
  close(slabTax(500000, INDIA.regimes.old.slabs("60to79")), 10000);
  close(slabTax(1000000, INDIA.regimes.old.slabs("60to79")), 110000);
  close(slabTax(500000, INDIA.regimes.old.slabs("80plus")), 0);
  close(slabTax(1000000, INDIA.regimes.old.slabs("80plus")), 100000);
});

test("the constants are the ones in the Act: standard deduction (s. 19), rebate (s. 156), surcharge and cess", () => {
  assert.equal(INDIA.year, "2026-27");
  assert.equal(INDIA.cess, 0.04);
  assert.equal(INDIA.regimes.new.standardDeduction, 75000);
  assert.equal(INDIA.regimes.old.standardDeduction, 50000);
  assert.deepEqual(INDIA.regimes.new.rebate, { limit: 1200000, max: 60000, marginalRelief: true });
  assert.deepEqual(INDIA.regimes.old.rebate, { limit: 500000, max: 12500, marginalRelief: false });
  assert.deepEqual(INDIA.regimes.new.surcharge, [[5000000, 0.10], [10000000, 0.15], [20000000, 0.25]]);
  assert.deepEqual(INDIA.regimes.old.surcharge, [[5000000, 0.10], [10000000, 0.15], [20000000, 0.25], [50000000, 0.37]]);
  assert.deepEqual(NEW.map((s) => s[0]), [400000, 800000, 1200000, 1600000, 2000000, 2400000, Infinity]);
  assert.deepEqual(NEW.map((s) => s[1]), [0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]);
});

test("marginal relief on the rebate, worked from section 156(2)(b): above ₹12 lakh the tax is at most the excess", () => {
  // income, tax on slabs, tax payable
  for (const [income, onSlabs, payable] of [[1210000, 61500, 10000], [1250000, 67500, 50000], [1270000, 70500, 70000], [1275000, 71250, 71250], [1300000, 75000, 75000]]) {
    const t = indiaTax(person(income), "new");
    close(t.slabTax, onSlabs);
    close(t.afterRebate, payable);
    close(t.rebate, onSlabs - payable);
    close(t.total, payable * 1.04);
  }
  // The relief ends where 60,000 + 15% of the excess equals the excess: 60,000 / 0.85 above ₹12 lakh.
  const end = 1200000 + 60000 / 0.85;
  close(indiaTax(person(end), "new").rebate, 0, 1e-6);
  assert.ok(indiaTax(person(end - 100), "new").rebate > 0);
  assert.equal(indiaTax(person(end + 100), "new").rebate, 0);
});

test("the finding: a ₹25,000 raise from ₹12.75 lakh of salary costs ₹26,000 in tax, a marginal rate of 104%", () => {
  const before = indiaTax(person(1275000, { salaried: true }), "new");
  const after = indiaTax(person(1300000, { salaried: true }), "new");
  assert.equal(before.total, 0);
  close(after.afterRebate, 25000);
  close(after.cess, 1000);
  close(after.total, 26000);
  const row = compare(person(1300000, { salaried: true, deductions: 200000 }), SETTINGS).find((r) => r.key === "new");
  close(row.tax, 26000);
  close(row.next, 1040);
  close(row.marginal, 1.04);
  assert.equal(rupees(row.tax), "₹26,000");
  // The zone runs from ₹12,75,000 to ₹13,45,588 of salary.
  close(1275000 + 60000 / 0.85, 1345588.24, 0.01);
  // The zone ends inside the next ₹1,000 here: taxable ₹12,70,000 pays 70,000 and ₹12,71,000 pays 60,000 + 15% of 71,000 = 70,650.
  close(compare(person(1345000, { salaried: true }), SETTINGS)[0].next, (70650 - 70000) * 1.04);
  close(compare(person(1346000, { salaried: true }), SETTINGS)[0].marginal, 0.156); // 15% plus cess, once past it
  // Take-home falls across the zone: ₹13,45,588 of salary leaves less than ₹12,75,000 does.
  assert.ok(1345588 - indiaTax(person(1345588, { salaried: true }), "new").total < 1275000);
});

test("the old regime has no such relief: one rupee over ₹5 lakh of taxable income brings back the whole tax", () => {
  assert.equal(indiaTax(person(500000), "old").total, 0);
  close(indiaTax(person(500000), "old").rebate, 12500);
  close(indiaTax(person(500010), "old").total, 12502 * 1.04);
  assert.equal(indiaTax(person(500010), "old").rebate, 0);
  // Standard deduction and other deductions come off first.
  const t = indiaTax(person(1000000, { salaried: true, deductions: 250000 }), "old");
  assert.deepEqual([t.standard, t.claimed, t.taxable], [50000, 250000, 700000]);
  close(t.slabTax, 12500 + 0.2 * 200000);
  close(t.total, 52500 * 1.04);
  // Deductions are ignored by the new regime and cannot push income below zero in the old.
  assert.equal(indiaTax(person(1000000, { deductions: 250000 }), "new").claimed, 0);
  assert.deepEqual([indiaTax(person(300000, { salaried: true, deductions: 900000 }), "old").claimed, indiaTax(person(300000, { salaried: true, deductions: 900000 }), "old").taxable], [250000, 0]);
  assert.deepEqual([indiaTax(person(30000, { salaried: true }), "new").standard, indiaTax(person(30000, { salaried: true }), "new").taxable], [30000, 0]);
});

test("surcharge and its marginal relief, by hand", () => {
  // New regime, ₹51 lakh: tax 3,00,000 + 30% of 27,00,000 = 11,10,000; with 10% surcharge 12,21,000. At ₹50 lakh the
  // tax is 10,80,000, so the cap is 10,80,000 + 1,00,000 = 11,80,000. Cess 4%: 47,200.
  const a = indiaTax(person(5100000), "new");
  close(a.slabTax, 1110000);
  assert.equal(a.surchargeRate, 0.10);
  close(a.surcharge, 70000);
  close(a.surchargeRelief, 41000);
  close(a.total, 1180000 * 1.04);
  // The relief ends where 11,88,000 + 0.33x = 10,80,000 + x, at x = 1,08,000 / 0.67.
  const x = 108000 / 0.67;
  close(indiaTax(person(5000000 + x), "new").surchargeRelief, 0, 1e-6);
  assert.equal(indiaTax(person(5000000 + x + 1000), "new").surchargeRelief, 0);
  assert.equal(indiaTax(person(5000000), "new").surcharge, 0);
  // Well clear of any threshold: ₹75 lakh, 10%; ₹1.5 crore, 15%; ₹3 crore, 25%.
  close(indiaTax(person(7500000), "new").total, (300000 + 0.3 * 5100000) * 1.10 * 1.04);
  close(indiaTax(person(15000000), "new").total, (300000 + 0.3 * 12600000) * 1.15 * 1.04);
  close(indiaTax(person(30000000), "new").total, (300000 + 0.3 * 27600000) * 1.25 * 1.04);
  // Above ₹5 crore the old regime charges 37% and the new stays at 25%.
  close(indiaTax(person(80000000), "new").total, (300000 + 0.3 * 77600000) * 1.25 * 1.04);
  close(indiaTax(person(80000000), "old").total, (112500 + 0.3 * 79000000) * 1.37 * 1.04);
  assert.equal(indiaTax(person(80000000), "old").surchargeRate, 0.37);
  // Just over ₹1 crore the cap is tax and 10% surcharge at ₹1 crore plus the excess.
  const b = indiaTax(person(10010000), "new");
  close(b.afterRebate + b.surcharge, (300000 + 0.3 * 7600000) * 1.10 + 10000);
  assert.ok(b.surchargeRelief > 0);
});

test("tax never falls when income rises by more than the relief zones allow, and is never negative", () => {
  for (const which of ["new", "old"]) for (const age of AGES) {
    let last = -1;
    for (let y = 0; y <= 7e7; y += 49999) {
      const t = indiaTax(person(y, { age }), which);
      assert.ok(t.total >= 0 && t.rebate >= 0 && t.surcharge >= -1e-9 && t.cess >= 0 && t.taxable >= 0);
      assert.ok(t.total >= last - 1e-6, `${which} ${age} falls at ${y}`);
      close(t.total, (t.afterRebate + t.surcharge) * 1.04);
      last = t.total;
    }
  }
  assert.equal(indiaTax(person(0), "new").total, 0);
  assert.equal(indiaTax(person(0, { salaried: true }), "old").total, 0);
  assert.throws(() => indiaTax(person(-1), "new"), RangeError);
  assert.throws(() => indiaTax(person(NaN), "new"), RangeError);
  assert.throws(() => indiaTax(person(Infinity), "old"), RangeError);
  assert.throws(() => indiaTax(person(1000, { deductions: -5 }), "old"), RangeError);
  assert.throws(() => indiaTax(person(1000, { age: "teen" }), "old"), RangeError);
  assert.throws(() => indiaTax(person(1000), "medium"), RangeError);
});

/* ---------- the other systems ---------- */

test("slab tax by hand, at the edges, and with a single band", () => {
  const s = [[100, 0], [300, 0.1], [Infinity, 0.5]];
  assert.equal(slabTax(0, s), 0);
  assert.equal(slabTax(100, s), 0);
  close(slabTax(200, s), 10);
  close(slabTax(300, s), 20);
  close(slabTax(500, s), 20 + 100);
  close(slabTax(1000, [[Infinity, 0.25]]), 250);
  assert.equal(slabTax(1000, []), 0);
});

test("flat tax and consumption tax by hand", () => {
  close(flatTax({ gross: 1500000, rate: 0.15, allowance: 400000 }), 165000);
  assert.equal(flatTax({ gross: 300000, rate: 0.15, allowance: 400000 }), 0);
  close(flatTax({ gross: 1000, rate: 0.2 }), 200);
  // ₹10,00,000 of income, 70% spent, 18% tax on top of prices: 7,00,000 × 0.18 / 1.18.
  close(consumptionTax({ gross: 1000000, spendShare: 0.7, rate: 0.18 }), 700000 * 0.18 / 1.18);
  close(consumptionTax({ gross: 1000000, spendShare: 0.7, rate: 0.18, exempt: 200000 }), 500000 * 0.18 / 1.18);
  assert.equal(consumptionTax({ gross: 1000000, spendShare: 0.1, rate: 0.18, exempt: 200000 }), 0);
  assert.equal(consumptionTax({ gross: 1000000, spendShare: 0.7, rate: 0 }), 0);
  // A price of 118 that includes 18% tax holds 18 of tax.
  close(consumptionTax({ gross: 118, spendShare: 1, rate: 0.18 }), 18);
});

test("the share spent at other incomes: the household's own at its own income, falling per doubling, within 20% to 100%", () => {
  const p = { gross: 1000000, spendShare: 0.7, fallPerDoubling: 0.05 };
  close(spendShareAt(1000000, p), 0.7);
  close(spendShareAt(2000000, p), 0.65);
  close(spendShareAt(500000, p), 0.75);
  close(spendShareAt(8000000, p), 0.55);
  assert.equal(spendShareAt(1e12, p), 0.2);
  assert.equal(spendShareAt(1, p), 1);
  close(spendShareAt(4000000, { ...p, fallPerDoubling: 0 }), 0.7);
  close(spendShareAt(0, p), 0.7);
  close(spendShareAt(500000, { gross: 0, spendShare: 0.7 }), 0.7);
});

/* ---------- text input ---------- */

test("rupee formatting", () => {
  assert.equal(groupIndian(1234567), "12,34,567");
  assert.equal(groupIndian(100000), "1,00,000");
  assert.equal(groupIndian(999), "999");
  assert.equal(rupees(26000), "₹26,000");
  assert.equal(rupees(-1500.4), "−₹1,500");
  assert.equal(rupees(-0.3), "₹0");
  assert.equal(rupees(NaN), "–");
  assert.equal(rupeesShort(75000), "₹75,000");
  assert.equal(rupeesShort(1275000), "₹12.75 lakh");
  assert.equal(rupeesShort(100000), "₹1 lakh");
  assert.equal(rupeesShort(30000000), "₹3 crore");
  assert.equal(rupeesShort(1e9), "₹100 crore");
  assert.equal(rupeesShort(Infinity), "–");
});

test("rupee boxes accept digits and say what is wrong otherwise", () => {
  assert.deepEqual(parseRupees("1500000"), { value: 1500000 });
  assert.deepEqual(parseRupees("₹15,00,000"), { value: 1500000 });
  assert.deepEqual(parseRupees("0"), { value: 0 });
  assert.deepEqual(parseRupees(String(MAX_INCOME)), { value: MAX_INCOME });
  for (const bad of ["", "abc", "-5", "1e7", "15 lakh", "100000000001", "1e308", "9".repeat(400), "1.2.3", null]) {
    const r = parseRupees(bad, { what: "the income" });
    assert.ok(r.error && r.value === undefined, `"${bad}" should be refused`);
    assert.ok(r.error.includes("income") || r.error.includes("₹"));
  }
  assert.ok(parseRupees("5", { min: 10 }).error.includes("at least ₹10"));
  assert.ok(parseRupees("50", { max: 10 }).error.includes("at most ₹10"));
});

test("typed slabs are read, written back and refused with a reason", () => {
  assert.deepEqual(parseSlabs("0: 0\n400000: 5\n800000: 10").slabs, [[400000, 0], [800000, 0.05], [Infinity, 0.10]]);
  assert.deepEqual(parseSlabs("0:10").slabs, [[Infinity, 0.10]]);
  assert.deepEqual(parseSlabs("from ₹0: 0%; from 5,00,000 = 20%;").slabs, [[500000, 0], [Infinity, 0.2]]);
  assert.deepEqual(parseSlabs(slabsText(NEW)).slabs, NEW);
  assert.deepEqual(parseSlabs(slabsText(OLD)).slabs, OLD);
  assert.equal(slabsText([[500000, 0], [Infinity, 0.2]]), "0: 0\n500000: 20");
  const bad = [["", "at least one"], ["   \n ;", "at least one"], ["hello", "Band 1"], ["0: 0\n400000", "Band 2"], ["400000: 5", "start at 0"],
    ["0: 0\n400000: 5\n400000: 10", "not above"], ["0: 0\n800000: 5\n400000: 10", "not above"], ["0: 101", "0 to 100"], ["0: -5", "Band 1"],
    ["0: 0\n" + "9".repeat(400) + ": 5", "above"], [Array.from({ length: 13 }, (_, k) => `${k * 1000}: ${k}`).join("\n"), "at most 12"],
    ["0: 0\n" + "x".repeat(300) + ": 5", "…"], ["0: 1e2", "Band 1"], [null, "at least one"]];
  for (const [text, hint] of bad) {
    const r = parseSlabs(text);
    assert.ok(r.error && !r.slabs, `"${String(text).slice(0, 30)}" should be refused`);
    assert.ok(r.error.includes(hint), `"${r.error}" should mention "${hint}"`);
    assert.ok(r.error.length < 260);
  }
  assert.ok(parseSlabs(Array.from({ length: 12 }, (_, k) => `${k * 1000}: ${k}`).join("\n")).slabs.length === 12);
});

/* ---------- comparison ---------- */

test("the household under all five systems, by hand", () => {
  const p = person(1500000, { salaried: true, deductions: 200000, spendShare: 0.7 });
  const rows = compare(p, SETTINGS);
  assert.deepEqual(rows.map((r) => r.key), SYSTEMS.map((s) => s.key));
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  // New: taxable 14,25,000; 60,000 + 15% of 2,25,000 = 93,750; cess 3,750.
  close(by.new.tax, 97500);
  close(by.new.next, 156);
  // Old: taxable 12,50,000; 1,12,500 + 30% of 2,50,000 = 1,87,500; cess 7,500.
  close(by.old.tax, 195000);
  close(by.old.marginal, 0.312);
  // Own slabs: 20% of 10,00,000.
  close(by.own.tax, 200000);
  close(by.own.marginal, 0.2);
  // Flat: 15% of 11,00,000.
  close(by.flat.tax, 165000);
  close(by.flat.average, 0.11);
  // Consumption: 18/118 of 10,50,000. On the next ₹1,000 the share spent is very slightly lower.
  close(by.consumption.tax, 1050000 * 0.18 / 1.18);
  close(by.consumption.next, 0.18 / 1.18 * (1501000 * spendShareAt(1501000, { ...p, fallPerDoubling: 0.05 }) - 1050000), 1e-6);
  for (const r of rows) { close(r.left, 1500000 - r.tax); close(r.average, r.tax / 1500000); }
  // Zero income: nothing divides by zero.
  for (const r of compare(person(0, { spendShare: 0.7 }), SETTINGS)) { assert.equal(r.tax, 0); assert.equal(r.average, 0); assert.ok(Number.isFinite(r.marginal)); }
  assert.throws(() => taxAt("poll", 1, p, SETTINGS), RangeError);
});

test("rate curves cover the range, include every threshold, and hold only finite numbers", () => {
  const p = person(1500000, { salaried: true, deductions: 200000, spendShare: 0.7 });
  const curves = rateCurves(p, SETTINGS);
  assert.equal(curves.length, 5);
  const incomes = curves[0].points.map((q) => q.income);
  assert.equal(incomes[0], 200000);
  assert.equal(incomes.at(-1), 1e9);
  for (let k = 1; k < incomes.length; k++) assert.ok(incomes[k] > incomes[k - 1]);
  for (const y of [1275000, 1274999, 1345588, 5075000, 750000, 749999]) assert.ok(incomes.includes(y), `${y} missing`); // new: 12L + 75k; relief end; 50L + 75k. old: 5L + 50k + 2L
  for (const c of curves) for (const q of c.points) assert.ok([q.tax, q.average, q.marginal].every(Number.isFinite) && q.tax >= 0);
  const at = (key, y) => curves.find((c) => c.key === key).points.find((q) => q.income === y);
  close(at("new", 1275000).marginal, 1.04);          // the start of the relief zone
  assert.ok(at("old", 749999).marginal > 13);        // the old regime's cliff: ₹13,000 and more on the next ₹1,000
  close(at("flat", 1e9).average, 0.15 * (1 - 400000 / 1e9));
  // A flat tax with an allowance has an average rate that rises towards the rate; without one it is level.
  const level = rateCurves(p, { ...SETTINGS, flatAllowance: 0 }).find((c) => c.key === "flat").points;
  for (const q of level) close(q.average, 0.15, 1e-12);
  // The consumption tax takes a falling share of income when the share spent falls with income.
  const cons = curves.find((c) => c.key === "consumption").points;
  assert.ok(cons[0].average > cons.at(-1).average);
  const steady = rateCurves(p, { ...SETTINGS, fallPerDoubling: 0 }).find((c) => c.key === "consumption").points;
  for (const q of steady) close(q.average, 0.7 * 0.18 / 1.18, 1e-12);
});

test("old regime or new: totals, saving, and the deductions at which they cross", () => {
  // ₹15 lakh salary with ₹2 lakh of deductions: new 97,500, old 1,95,000.
  const a = oldOrNew(person(1500000, { salaried: true, deductions: 200000 }));
  close(a.newTax, 97500);
  close(a.oldTax, 195000);
  assert.equal(a.cheaper, "new");
  close(a.saving, 97500);
  // Break-even by hand: old tax on slabs must fall to 93,750. Below ₹10 lakh of taxable income that is 12,500 + 20% of
  // (T − 5,00,000), so T = 9,06,250 and deductions = 15,00,000 − 50,000 − 9,06,250 = 5,43,750.
  assert.equal(a.breakEven, 543750);
  close(indiaTax(person(1500000, { salaried: true, deductions: 543750 }), "old").total, 97500);
  assert.ok(indiaTax(person(1500000, { salaried: true, deductions: 543749 }), "old").total > 97500);
  // One rupee of deductions short of the crossing the old regime costs 21 paise more (20% of ₹1, plus cess): the same to the
  // nearest rupee, which is how every amount is shown, so the verdict is "same" and never "New, by ₹0".
  const near = oldOrNew(person(1500000, { salaried: true, deductions: 543749 }));
  close(near.saving, 0.208, 1e-6);
  assert.equal(near.cheaper, "same");
  assert.equal(oldOrNew(person(1500000, { salaried: true, deductions: 543747 })).cheaper, "new"); // 62 paise: rounds to ₹1
  assert.equal(oldOrNew(person(1500000, { salaried: true, deductions: 543750 })).cheaper, "same");
  // Low income: both regimes charge nothing, so no deductions are needed.
  const b = oldOrNew(person(400000, { salaried: true }));
  assert.deepEqual([b.newTax, b.oldTax, b.cheaper, b.breakEven], [0, 0, "same", 0]);
  // ₹12.75 lakh of salary: the new regime charges nothing, so the old regime only matches it by reaching its own rebate.
  const c = oldOrNew(person(1275000, { salaried: true, deductions: 0 }));
  assert.equal(c.newTax, 0);
  assert.equal(c.breakEven, 1275000 - 50000 - 500000);
  // Enough deductions make the old regime cheaper.
  const d = oldOrNew(person(1500000, { salaried: true, deductions: 700000 }));
  assert.equal(d.cheaper, "old");
  assert.ok(d.saving > 0);
  assert.equal(oldOrNew(person(0)).breakEven, 0);
});
