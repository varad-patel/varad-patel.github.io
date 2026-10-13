import test from "node:test";
import assert from "node:assert/strict";
import { SHAPES } from "./shapes.js";
import { AFFORD, AREAS, REGIONS, YEARS, LATEST, NATIONAL, DEFAULTS, LIMITS, EDGES, CLASS_LABELS, check, annuity, loanPerPound, scaleFor, budget, classOf, incomeNeeded, evaluate, overTime, areaOverTime, reachSummary, step, countPhrase } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const area = (name) => AREAS.find((a) => a.name === name);
const indexOf = (name) => AREAS.findIndex((a) => a.name === name);

test("the data module: source, licence, shape", () => {
  assert.match(AFFORD.source, /Office for National Statistics, House price to workplace-based earnings ratio/);
  assert.equal(AFFORD.licence, "Open Government Licence v3.0");
  assert.equal(AFFORD.retrieved, "2026-10-11");
  assert.deepEqual([YEARS[0], YEARS[LATEST], YEARS.length], [1997, 2025, 29]);
  assert.equal(AREAS.length, 318);
  assert.equal(REGIONS.length, 10);
  // Districts by kind, from the codes in Table 5a: unitary, non-metropolitan, metropolitan, London borough, Welsh.
  const kinds = (p) => AREAS.filter((a) => a.code.startsWith(p)).length;
  assert.deepEqual(["E06", "E07", "E08", "E09", "W06"].map(kinds), [63, 164, 36, 33, 22]);
  for (const a of AREAS) {
    assert.equal(a.median.length, 29); assert.equal(a.lower.length, 29); assert.equal(a.earnings.length, 29);
    for (let i = 0; i < 29; i++) { assert.ok(a.median[i] > 0 && a.lower[i] > 0 && a.lower[i] <= a.median[i]); assert.ok(a.earnings[i] === null || a.earnings[i] > 5000); }
    assert.ok(a.region >= 0 && a.region < 10);
  }
  assert.equal(new Set(AREAS.map((a) => a.code)).size, 318);
});

test("source figures, as printed in the ONS workbook released 26 March 2026", () => {
  // Table 5a (median price, year ending September).
  assert.equal(area("Hartlepool").median[0], 41500);
  assert.equal(area("Hartlepool").median[LATEST], 155000);
  assert.equal(area("Newport").median[0], 47950);
  assert.equal(area("Newport").median[LATEST], 232000);
  assert.equal(area("Merthyr Tydfil").median[LATEST], 140000);
  // Table 5b (median earnings): Hartlepool 15,747 in 1997 and 32,302 in 2025; County Durham has "[x]" for 1997 to 2002.
  assert.equal(area("Hartlepool").earnings[0], 15747);
  assert.equal(area("Hartlepool").earnings[LATEST], 32302);
  assert.deepEqual(area("County Durham").earnings.slice(0, 7).map((v) => v === null), [true, true, true, true, true, true, false]);
  assert.equal(AREAS.reduce((n, a) => n + a.earnings.filter((v) => v === null).length, 0), 170);
  // Tables 1a, 1b and 2a (England and Wales).
  assert.deepEqual([NATIONAL.median[0], NATIONAL.median[LATEST]], [59950, 295000]);
  assert.deepEqual([NATIONAL.earnings[0], NATIONAL.earnings[LATEST]], [16885, 39059]);
  assert.equal(NATIONAL.lower[LATEST], 200000);
  // Tables 1c and 5c publish the ratios: 7.55 for England and Wales in 2025, 3.55 in 1997, 4.8 for Hartlepool in 2025.
  assert.equal((NATIONAL.median[LATEST] / NATIONAL.earnings[LATEST]).toFixed(2), "7.55");
  assert.equal((NATIONAL.median[0] / NATIONAL.earnings[0]).toFixed(2), "3.55");
  assert.equal((area("Hartlepool").median[LATEST] / area("Hartlepool").earnings[LATEST]).toFixed(2), "4.80");
});

test("the boundaries: one shape for every district, drawn inside the grid", () => {
  assert.equal(Object.keys(SHAPES.areas).length, 318);
  assert.equal(SHAPES.licence, "Open Government Licence v3.0");
  assert.match(SHAPES.source, /Local Authority Districts \(December 2025\) Boundaries UK BUC/);
  for (const a of AREAS) {
    const s = SHAPES.areas[a.code];
    assert.ok(s, a.code);
    assert.match(s.d, /^M\d+,\d+l[-\d, ]+z/);
    const [x0, y0, x1, y1] = s.box;
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= SHAPES.width && y1 <= SHAPES.height && x1 > x0 && y1 > y0);
    assert.ok(s.at[0] >= x0 && s.at[0] <= x1 && s.at[1] >= y0 && s.at[1] <= y1, `${a.name} marker outside its box`);
  }
  // Rough geography in British National Grid: Newcastle is north of Cornwall, Norwich east of Cardiff, and the grid is 200 m.
  const at = (name) => SHAPES.areas[area(name).code].at;
  assert.ok(at("Newcastle upon Tyne")[1] < at("Cornwall")[1]);
  assert.ok(at("Norwich")[0] > at("Cardiff")[0]);
  assert.equal(SHAPES.grid, 200);
  // Westminster's marker in metres: easting about 528 km, northing about 180 km.
  const [x, y] = at("Westminster");
  close(SHAPES.west + x * 200, 528000, 3000);
  close(SHAPES.north - y * 200, 180500, 3000);
});

test("the starting values are the national median income and a tenth of the national median price", () => {
  assert.equal(DEFAULTS.income, 39059);
  assert.equal(DEFAULTS.deposit, 29500);
  assert.equal(check(DEFAULTS), "");
});

test("the loan: a multiple of income, or what a share of income repays", () => {
  assert.equal(loanPerPound({ ...DEFAULTS, multiple: 4.5 }), 4.5);
  // Annuity factor by hand: 5% a year over 25 years is 0.416667% a month for 300 months.
  const i = 0.05 / 12;
  close(annuity(5, 25), (1 - (1 + i) ** -300) / i, 1e-9);
  close(annuity(5, 25), 171.06, 0.005);        // a loan of £1,000 costs £5.85 a month: 1000 / 171.06
  assert.equal(annuity(0, 25), 300);            // no interest: the months themselves
  assert.equal(annuity(0, 5), 60);
  close(annuity(12, 10), (1 - 1.01 ** -120) / 0.01, 1e-9);
  // 30% of £39,059 is £976.475 a month, which repays £167,035.86.
  const s = { ...DEFAULTS, rule: "repayment" };
  close(loanPerPound(s) * 39059, 976.475 * annuity(5, 25), 1e-6);
  close(loanPerPound(s) * 39059, 167035.86, 0.01);
  // A longer term or a lower rate lends more.
  assert.ok(annuity(5, 30) > annuity(5, 25) && annuity(3, 25) > annuity(5, 25));
});

test("the budget, by hand, in 2025 and in 1997", () => {
  const b = budget(DEFAULTS);
  assert.deepEqual([b.income, b.deposit, b.loan, b.budget, b.scale], [39059, 29500, 175765.5, 205265.5, 1]);
  // 1997, same place in the pay ladder: everything times 16,885 / 39,059.
  const k = 16885 / 39059;
  const old = budget(DEFAULTS, 0);
  close(old.scale, k, 1e-12);
  close(old.income, 16885, 1e-9);
  close(old.deposit, 29500 * k, 1e-9);
  close(old.budget, 4.5 * 16885 + 29500 * k, 1e-9);
  assert.equal(scaleFor({ ...DEFAULTS, scale: "fixed" }, 0), 1);
  assert.equal(budget({ ...DEFAULTS, scale: "fixed" }, 0).budget, 205265.5);
});

test("classes: a price equal to an edge is in the lower class, and a price equal to the budget is within it", () => {
  assert.deepEqual(EDGES, [0.75, 1, 1.25, 1.5, 2]);
  assert.equal(CLASS_LABELS.length, EDGES.length + 1);
  assert.deepEqual([1, 75000, 75001, 100000, 100001, 125000, 125001, 150000, 150001, 200000, 200001, 1e9].map((p) => classOf(p, 100000)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  // Exactly at the budget: income 40,000 at 4.5 times plus 20,000 is 200,000.
  const s = { ...DEFAULTS, income: 40000, deposit: 20000 };
  assert.equal(budget(s).budget, 200000);
  const e = evaluate(s);
  for (const r of e.rows) { assert.equal(r.within, r.price <= 200000); assert.equal(r.within, r.klass <= 1); }
  assert.ok(e.rows.some((r) => r.price === 200000 && r.within), "a district priced exactly at the budget counts as within it");
});

test("income needed is the income at which the budget just reaches the price", () => {
  // Newport, 2025: (232,000 - 29,500) / 4.5 = 45,000.
  close(incomeNeeded(232000, DEFAULTS), 45000, 1e-9);
  const s = { ...DEFAULTS, income: incomeNeeded(232000, DEFAULTS) };
  close(budget(s).budget, 232000, 1e-6);
  // The deposit alone covers a cheap home.
  assert.equal(incomeNeeded(20000, DEFAULTS), 0);
  // Under the repayment rule the same identity holds.
  const r = { ...DEFAULTS, rule: "repayment" };
  close(budget({ ...r, income: incomeNeeded(232000, r) }).budget, 232000, 1e-6);
  // In 1997 pounds the deposit is the scaled one.
  close(incomeNeeded(47950, DEFAULTS, 0), (47950 - 29500 * 16885 / 39059) / 4.5, 1e-9);
});

test("the finding on the page: 57 of 318 districts in 2025, 285 in 1997, none in the south", () => {
  const now = evaluate(DEFAULTS), then = evaluate(DEFAULTS, 0);
  assert.equal(now.year, 2025);
  assert.equal(now.within, 57);
  assert.equal(then.within, 285);
  assert.equal(Math.round(now.budget), 205266);
  assert.equal(Math.round(then.budget), 88735);
  const by = Object.fromEntries(now.regions.map((r) => [r.name, `${r.within}/${r.total}`]));
  assert.deepEqual(by, { "North East": "10/12", "North West": "17/35", "Yorkshire and The Humber": "9/15", "East Midlands": "8/35", "West Midlands": "2/30",
    "East of England": "0/45", London: "0/33", "South East": "0/64", "South West": "0/27", Wales: "11/22" });
  assert.deepEqual(now.classes, [10, 47, 62, 52, 73, 74]);
  assert.equal(now.classes.reduce((a, b) => a + b, 0), 318);
  assert.equal(now.classes[0] + now.classes[1], now.within);
  // The finding gives the 1997 salary and deposit in 1997 pounds: £16,885 and £12,753.
  assert.deepEqual([Math.round(then.income), Math.round(then.deposit)], [16885, 12753]);
  // Scaled by pay, the deposit is the same months of pay in both years (about nine) but a larger share of the price
  // in 1997: 21% of the national median against 10%. With a tenth of the 1997 price, £6,000, the count is 267.
  assert.equal((12 * DEFAULTS.deposit / DEFAULTS.income).toFixed(1), "9.1");
  assert.equal(Math.round(100 * then.deposit / NATIONAL.median[0]), 21);
  assert.equal(Math.round(100 * now.deposit / NATIONAL.median[LATEST]), 10);
  const tenth = evaluate({ ...DEFAULTS, deposit: 13879 }, 0);
  assert.equal(Math.round(tenth.deposit), 6000);
  assert.equal(tenth.within, 267);
  assert.equal(AREAS.filter((a) => a.median[0] <= 4.5 * 16885 + 6000).length, 267);   // the same from the workbook's own figures
  // Counted again without evaluate(): prices at or under the budget.
  assert.equal(AREAS.filter((a) => a.median[LATEST] <= 4.5 * 39059 + 29500).length, 57);
  assert.equal(AREAS.filter((a) => a.median[0] <= (4.5 * 39059 + 29500) * 16885 / 39059).length, 285);
});

test("figures quoted in the write-up", () => {
  const t = overTime(DEFAULTS);
  assert.equal(t.length, 29);
  const count = (y) => t.find((r) => r.year === y).within;
  assert.deepEqual([1997, 2007, 2013, 2021, 2025].map(count), [285, 56, 102, 32, 57]);
  assert.equal(Math.min(...t.map((r) => r.within)), 32);
  // The same pounds in every year flatter the past: 317 of 318 in 1997.
  assert.equal(overTime({ ...DEFAULTS, scale: "fixed" })[0].within, 317);
  // The cheaper home, two incomes, and the repayment rule in 2025.
  assert.equal(evaluate({ ...DEFAULTS, price: "lower" }).within, 135);
  assert.equal(evaluate({ ...DEFAULTS, income: 2 * 39059 }).within, 234);
  assert.equal(evaluate({ ...DEFAULTS, rule: "repayment" }).within, 45);
  // Kensington and Chelsea: the dearest district in 2025, and the income its median home needs.
  const dearest = [...evaluate(DEFAULTS).rows].sort((a, b) => b.price - a.price)[0];
  assert.equal(AREAS[dearest.index].name, "Kensington and Chelsea");
  assert.equal(dearest.price, 1150000);
  close(incomeNeeded(1150000, DEFAULTS), 249000, 1e-6);
  const cheapest = [...evaluate(DEFAULTS).rows].sort((a, b) => a.price - b.price)[0];
  assert.deepEqual([AREAS[cheapest.index].name, cheapest.price], ["Burnley", 130000]);
});

test("one district through the years", () => {
  const i = indexOf("Manchester");
  const t = areaOverTime(i, DEFAULTS);
  assert.equal(t.length, 29);
  assert.equal(t[0].price, 39000);
  assert.equal(t[LATEST].price, 247500);
  close(t[LATEST].localRatio, 247500 / 40479, 1e-12);
  assert.deepEqual(reachSummary(i, DEFAULTS), { years: 17, first: 1997, last: 2016, now: false, always: false, never: false });
  assert.deepEqual(reachSummary(indexOf("Hartlepool"), DEFAULTS), { years: 29, first: 1997, last: 2025, now: true, always: true, never: false });
  assert.deepEqual(reachSummary(indexOf("Camden"), DEFAULTS), { years: 0, first: null, last: null, now: false, always: false, never: true });
  // A district with no earnings figure has no local ratio, not a zero or NaN.
  const scilly = areaOverTime(indexOf("Isles of Scilly"), DEFAULTS);
  assert.equal(scilly[0].localRatio, null);
  assert.ok(areaOverTime(999, DEFAULTS).error);
  assert.ok(reachSummary(-1, DEFAULTS).error);
});

test("extremes: everything in reach, nothing in reach, and the totals still add up", () => {
  const rich = evaluate({ ...DEFAULTS, income: 10000000 });
  assert.equal(rich.within, 318);
  assert.deepEqual(rich.classes, [318, 0, 0, 0, 0, 0]);
  const poor = evaluate({ ...DEFAULTS, income: 1000, deposit: 0, multiple: 1 });
  assert.equal(poor.within, 0);
  assert.equal(poor.classes[5], 318);
  for (const r of poor.rows) assert.ok(Number.isFinite(r.ratio) && r.ratio > 2);
  for (const e of [rich, poor]) assert.equal(e.regions.reduce((n, g) => n + g.total, 0), 318);
  // Rate zero and the longest term.
  const free = evaluate({ ...DEFAULTS, rule: "repayment", rate: 0, term: 40, share: 60 });
  close(free.loan, 39059 * 0.6 / 12 * 480, 1e-6);
});

test("bad settings get a sentence, never a number", () => {
  for (const bad of [null, undefined, 5, {}, { ...DEFAULTS, income: NaN }, { ...DEFAULTS, income: 999 }, { ...DEFAULTS, income: 1e308 }, { ...DEFAULTS, income: -40000 }, { ...DEFAULTS, income: "40000" },
    { ...DEFAULTS, deposit: -1 }, { ...DEFAULTS, deposit: Infinity }, { ...DEFAULTS, rule: "magic" }, { ...DEFAULTS, multiple: 0 }, { ...DEFAULTS, multiple: 9 }, { ...DEFAULTS, share: 0 }, { ...DEFAULTS, share: 61 },
    { ...DEFAULTS, rate: -1 }, { ...DEFAULTS, rate: 16 }, { ...DEFAULTS, term: 4 }, { ...DEFAULTS, term: 41 }, { ...DEFAULTS, price: "mean" }, { ...DEFAULTS, scale: "cpi" }]) {
    assert.ok(check(bad).length > 15, JSON.stringify(bad));
    assert.ok(evaluate(bad).error);
    assert.ok(overTime(bad).error);
    assert.ok(areaOverTime(0, bad).error);
  }
  for (const yi of [-1, 29, 1.5, NaN, "3"]) assert.ok(evaluate(DEFAULTS, yi).error);
  assert.match(check({ ...DEFAULTS, income: 500 }), /from £1,000 to £10,000,000 a year/);
  assert.equal(check({ ...DEFAULTS, income: LIMITS.income[0], deposit: 0 }), "");
  assert.equal(check({ ...DEFAULTS, income: LIMITS.income[1], deposit: LIMITS.deposit[1] }), "");
});

test("arrow keys: the nearest district in that quarter of the compass, or stay put", () => {
  //   3
  // 1 0 2      and 5 far to the right, 6 up and to the right at exactly 45 degrees
  //   4
  const pts = [[0, 0], [-10, 0], [10, 1], [0, -10], [1, 10], [50, 0], [7, -7]];
  assert.equal(step(pts, 0, "left"), 1);
  assert.equal(step(pts, 0, "right"), 6);     // (7, -7) is 9.9 away, nearer than (10, 1) at 10.05, and on the edge of the quarter
  assert.equal(step(pts, 0, "up"), 6);
  assert.equal(step(pts, 0, "down"), 4);
  assert.equal(step(pts, 2, "right"), 5);
  assert.equal(step(pts, 5, "right"), 5);     // nothing further right: stay
  assert.equal(step(pts, 1, "left"), 1);
  assert.equal(step(pts, 0, "right", [0, 2, 5]), 2);   // only among the districts on show
  assert.equal(step(pts, 0, "left", [0, 2, 5]), 0);
  assert.equal(step([[3, 3]], 0, "up"), 0);
  // On the real map every district can be left by at least one arrow, and London's boroughs lead to each other.
  const real = AREAS.map((a) => SHAPES.areas[a.code].at);
  for (let i = 0; i < real.length; i++) assert.ok(["left", "right", "up", "down"].some((d) => step(real, i, d) !== i));
  const london = AREAS.map((a, i) => i).filter((i) => AREAS[i].region === REGIONS.indexOf("London"));
  const seen = new Set([london[0]]);
  for (let grew = true; grew;) { grew = false; for (const i of [...seen]) for (const d of ["left", "right", "up", "down"]) { const j = step(real, i, d, london); if (!seen.has(j)) { seen.add(j); grew = true; } } }
  assert.equal(seen.size, 33, "every London borough can be reached with the arrow keys");
});

test("every district in every region can be reached with the arrow keys from any other", () => {
  const real = AREAS.map((a) => SHAPES.areas[a.code].at);
  const reach = (allowed) => {
    const seen = new Set([allowed[0]]);
    for (let grew = true; grew;) { grew = false; for (const i of [...seen]) for (const d of ["left", "right", "up", "down"]) { const j = step(real, i, d, allowed); if (!seen.has(j)) { seen.add(j); grew = true; } } }
    return seen.size;
  };
  assert.equal(reach(AREAS.map((_, i) => i)), 318);
  REGIONS.forEach((name, k) => { const allowed = AREAS.map((_, i) => i).filter((i) => AREAS[i].region === k); assert.equal(reach(allowed), allowed.length, name); });
});

test("counts in words", () => {
  assert.equal(countPhrase(0, 318), "in none of the 318 districts");
  assert.equal(countPhrase(318, 318), "in all 318 districts");
  assert.equal(countPhrase(57, 318), "in 57 of the 318 districts");
  assert.equal(countPhrase(1, 318), "in 1 of the 318 districts");
  assert.equal(countPhrase(2, 2), "in both districts");
  assert.equal(countPhrase(1, 1), "in the only one");
  assert.equal(countPhrase(0, 1), "not in the only one");
  assert.equal(countPhrase(0, 12), "in none of the 12 districts");
});
