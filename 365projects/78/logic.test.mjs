import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { DEBT } from "./data.js";
import {
  LIMITS, readScenario, factor, path, explicit, steadyState, stabilisingSurplus, firstYear, verdict, startingPoint, equationCheck,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const rel = (a, b, tol = 1e-10) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} is not within ${tol} (relative) of ${b}`);
const country = (iso) => DEBT.countries.find((c) => c.iso === iso);

test("hand-computed years of the difference equation", () => {
  // d0 = 100, r = 5%, g = 3%, p = 2: d1 = 100 x 1.05 / 1.03 + 2 = 103.94175, d2 = d1 x 1.05 / 1.03 + 2.
  const d = path(100, 0.05, 0.03, 2, 2);
  close(d[1], 100 * 1.05 / 1.03 + 2, 1e-12);
  close(d[1], 103.941747572815, 1e-9);
  close(d[2], d[1] * 1.05 / 1.03 + 2, 1e-12);
  close(factor(0.05, 0.03), 1.05 / 1.03, 1e-15);
  // The first year's change splits into the snowball and the deficit.
  const f = firstYear(100, 0.05, 0.03, 2);
  close(f.snowball, 100 * 0.02 / 1.03, 1e-12);
  close(f.change, d[1] - 100, 1e-12);
});

test("the explicit solution matches the iteration across random and extreme scenarios", () => {
  const r = rng(78);
  const cases = [[100, 0.04, 0.03, 2, 50], [60, 0.01, 0.04, 3, 100], [150, 0.03, 0.03, 2, 40], [80, 0.03, 0.03, 0, 10], [200, 0.5, -0.2, 30, 200], [0, -0.1, 0.5, -30, 200]];
  for (let k = 0; k < 300; k++) cases.push([r.uniform(0, 1000), r.uniform(-0.1, 0.5), r.uniform(-0.2, 0.5), r.uniform(-30, 30), r.int(1, 200)]);
  for (const [d0, rr, g, p, T] of cases) {
    const d = path(d0, rr, g, p, T);
    for (const t of [1, Math.floor(T / 2), T]) rel(explicit(d0, rr, g, p, t), d[t], 1e-8);
    assert.ok(d.every(Number.isFinite));
  }
  // The largest growth factor the boxes allow, for 200 years, stays finite: 1.5 / 0.8 = 1.875 a year.
  const big = path(1000, 0.5, -0.2, 30, 200);
  assert.ok(Number.isFinite(big[200]) && big[200] > 1e56 && big[200] < 1e58, String(big[200]));
});

test("r = g: debt changes by exactly the primary deficit each year", () => {
  assert.deepEqual(path(90, 0.03, 0.03, 2, 3).map((v) => Number(v.toFixed(9))), [90, 92, 94, 96]);
  assert.equal(explicit(90, 0.03, 0.03, 2, 10), 110);
  assert.equal(steadyState(0.03, 0.03, 2), null);
  assert.deepEqual(verdict(90, 0.03, 0.03, 0), { kind: "stays", target: 90 });
  assert.equal(verdict(90, 0.03, 0.03, 2).kind, "rises");
  assert.equal(verdict(90, 0.03, 0.03, -2).kind, "falls");
});

test("steady state: p (1 + g) / (g - r), and debt that starts there stays there", () => {
  close(steadyState(0.02, 0.04, 3), 3 * 1.04 / 0.02, 1e-12); // 156
  close(steadyState(0.02, 0.04, 3), 156, 1e-9);
  for (const [rr, g, p] of [[0.02, 0.04, 3], [0.05, 0.03, -2], [0.01, 0.06, -1]]) {
    const ds = steadyState(rr, g, p);
    path(ds, rr, g, p, 100).forEach((v) => rel(v, ds, 1e-9));
  }
  // With r < g every start converges to it; after many years the gap is tiny.
  close(path(20, 0.02, 0.04, 3, 3000)[3000], 156, 1e-6);
  close(path(400, 0.02, 0.04, 3, 3000)[3000], 156, 1e-6);
});

test("the stabilising primary surplus holds the ratio, and has the right sign", () => {
  for (const [d, rr, g] of [[120, 0.04, 0.03], [120, 0.02, 0.05], [0, 0.05, 0.01], [250, 0.03, 0.03]]) {
    const s = stabilisingSurplus(d, rr, g);
    path(d, rr, g, -s, 60).forEach((v) => rel(v, d, 1e-9));
  }
  close(stabilisingSurplus(100, 0.05, 0.03), 100 * 0.02 / 1.03, 1e-12); // a surplus of 1.94% of GDP
  assert.ok(stabilisingSurplus(100, 0.02, 0.05) < 0); // r < g: a deficit is affordable
  assert.equal(stabilisingSurplus(100, 0.03, 0.03), 0);
});

test("verdicts at and around every edge", () => {
  // r < g: settles at d*, with the gap halving every ln 2 / -ln a years.
  const v = verdict(100, 0.02, 0.04, 3);
  assert.equal(v.kind, "settles");
  close(v.target, 156, 1e-9);
  const gap = (t) => Math.abs(explicit(100, 0.02, 0.04, 3, t) - 156);
  close(gap(v.halfLife), gap(0) / 2, 1e-9);
  // r > g with a deficit: d* is negative, so any positive debt explodes.
  const e = verdict(100, 0.05, 0.03, 2);
  assert.equal(e.kind, "explodes");
  assert.ok(e.target < 0);
  close(Math.abs(explicit(100, 0.05, 0.03, 2, e.doubling) - e.target), 2 * Math.abs(100 - e.target), 1e-8);
  // r > g with a surplus: above d* it explodes, below it falls, at it stays.
  const ds = steadyState(0.05, 0.03, -2); // 2 x 1.03 / 0.02 = 103
  close(ds, 103, 1e-9);
  assert.equal(verdict(104, 0.05, 0.03, -2).kind, "explodes");
  assert.equal(verdict(102, 0.05, 0.03, -2).kind, "falls");
  assert.equal(verdict(103, 0.05, 0.03, -2).kind, "stays");
  assert.equal(verdict(103 + 1e-6, 0.05, 0.03, -2).kind, "explodes"); // a millionth of a point is a real difference
  assert.equal(verdict(156, 0.02, 0.04, 3).kind, "stays");
  assert.equal(verdict(0, 0.02, 0.04, 0).kind, "stays");
  // r < g with a surplus: settles below zero (a net lender).
  const neg = verdict(50, 0.02, 0.04, -1);
  assert.equal(neg.kind, "settles");
  assert.ok(neg.target < 0);
});

test("input checks", () => {
  const ok = { debt: 100, rate: 4, growth: 3, deficit: 2, years: 30 };
  const r = readScenario(ok);
  assert.equal(r.ok, true);
  close(r.s.r, 0.04, 1e-15);
  const bad = (change) => readScenario({ ...ok, ...change }).errors.map((e) => e.key);
  assert.deepEqual(bad({ debt: -1 }), ["debt"]);
  assert.deepEqual(bad({ debt: 1001 }), ["debt"]);
  assert.deepEqual(bad({ rate: NaN, growth: -21 }), ["rate", "growth"]);
  assert.deepEqual(bad({ deficit: 31 }), ["deficit"]);
  assert.deepEqual(bad({ years: 0.5 }), ["years"]);
  assert.deepEqual(bad({ years: 201 }), ["years"]);
  assert.deepEqual(bad({ rate: Infinity }), ["rate"]);
  assert.match(readScenario({ ...ok, years: 2.5 }).errors[0].message, /whole number/);
  assert.equal(LIMITS.years.max, 200);
});

test("the data module holds the OECD's own figures (Economic Outlook 119)", () => {
  assert.ok(DEBT.countries.length >= 30);
  const us = country("USA");
  assert.equal(us.first, 1995);
  assert.equal(us.last, 2025);
  // GGFLQ 2025 = 125.923654672619; NLGXQ 2025 = -3.23579921542251.
  assert.equal(us.debt.at(-1), 125.924);
  assert.equal(us.primary.at(-1), -3.236);
  // GGINTP 2025 / GGFL 2024 = 1,453,185,250,000 / 36,161,942,000,000; GDP 2025 / GDP 2024 = 30,762,098,750,000 / 29,298,012,750,000.
  close(us.rate.at(-1), Number((100 * 1453185250000 / 36161942000000).toFixed(4)), 1e-12);
  close(us.growth.at(-1), Number((100 * (30762098750000 / 29298012750000 - 1)).toFixed(4)), 1e-12);
  assert.equal(country("ITA").debt.at(-1), 148.745); // 148.745082646786
  const jp = country("JPN");
  assert.equal(jp.last, 2024); // later years are projections in this edition
  assert.equal(jp.debt.at(-1), 205.398); // 205.39755491639
  close(jp.rate.at(-1), Number((100 * 7780600000000 / 1343774675000000).toFixed(4)), 1e-12);
  for (const c of DEBT.countries) {
    const n = c.last - c.first + 1;
    assert.ok(c.debt.length === n && c.primary.length === n && c.rate.length === n && c.growth.length === n, c.iso);
    assert.equal(c.rate[0], null);
    assert.ok(c.last >= 2024 && c.last <= 2025, c.iso);
  }
  assert.equal(country("BGR").first, 1998);
  // The write-up names the countries whose last outturn is 2024, and Japan's run above 200% of GDP.
  assert.deepEqual(DEBT.countries.filter((c) => c.last === 2024).map((c) => c.iso).sort(), ["CHE", "IRL", "JPN", "KOR", "LTU"]);
  assert.equal(DEBT.countries.length, 32);
  assert.ok(jp.debt.slice(2012 - jp.first).every((v) => v > 200));
  assert.ok(jp.debt[2011 - jp.first] < 200);
});

test("starting points and the equation check, on a hand-made country", () => {
  const toy = { iso: "TOY", name: "Toy", first: 2020, last: 2022, debt: [100, 102, 103], primary: [-1, -2, 0.5], rate: [null, 3, 4], growth: [null, 5, 2] };
  const s = startingPoint(toy, 5);
  assert.deepEqual({ year: s.year, from: s.from, years: s.years, debt: s.debt, deficit: s.deficit }, { year: 2022, from: 2021, years: 2, debt: 103, deficit: -0.5 });
  close(s.rate, 3.5, 1e-12);
  close(s.growth, 3.5, 1e-12);
  const one = startingPoint(toy, 1);
  assert.equal(one.from, 2022);
  close(one.rate, 4, 1e-12);
  // Equation: 100 -> 100 x 1.03 / 1.05 + 2 -> that x 1.04 / 1.02 - 0.5.
  const e = equationCheck(toy, 5);
  const d1 = 100 * 1.03 / 1.05 + 2, d2 = d1 * 1.04 / 1.02 - 0.5;
  close(e.predicted, d2, 1e-12);
  assert.equal(e.from, 2020);
  close(e.gap, 103 - d2, 1e-12);
});

test("the finding on the page: the United States, 2025, at two windows for r and g", () => {
  const us = country("USA");
  const one = startingPoint(us, 1), five = startingPoint(us, 5);
  assert.equal(one.debt.toFixed(1), "125.9");
  assert.equal(one.deficit.toFixed(2), "3.24");
  assert.equal(one.rate.toFixed(2), "4.02");
  assert.equal(one.growth.toFixed(2), "5.00");
  assert.equal(five.from, 2021);
  assert.equal(five.rate.toFixed(2), "3.67");
  assert.equal(five.growth.toFixed(2), "7.58");
  const go = (s) => ({ v: verdict(s.debt, s.rate / 100, s.growth / 100, s.deficit), d20: explicit(s.debt, s.rate / 100, s.growth / 100, s.deficit, 20), hold: stabilisingSurplus(s.debt, s.rate / 100, s.growth / 100) });
  const a = go(one), b = go(five);
  assert.equal(a.v.kind, "settles");
  assert.equal(b.v.kind, "settles");
  assert.equal(Math.round(a.v.target), 347); // 347.15 straight from the OECD file, recomputed in review
  assert.equal(Math.round(b.v.target), 89);
  assert.equal(Math.round(a.d20), 164);
  assert.equal(Math.round(b.d20), 107);
  assert.equal(a.hold.toFixed(2), "-1.17");
  assert.equal(b.hold.toFixed(2), "-4.58");
});
