import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  LIMITS, readPlan, netFactor, netRate, realRate, simulate, fvLump, fvAnnuity, fvAnnuityDue, fvGrowingAnnuity, closedForm,
  doublingYears, ruleOf72, variants, compare,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const rel = (a, b, tol = 1e-10) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} is not within ${tol} (relative) of ${b}`);
const OPENING = { start: 0, pay: 200, perYear: 12, raise: 0, age: 25, end: 65, rate: 5, fee: 0.1, inflation: 2 };
const plan = (change = {}) => { const r = readPlan({ ...OPENING, ...change }); assert.ok(r.ok, JSON.stringify(r.errors)); return r.plan; };

test("closed forms against hand-computed and textbook values", () => {
  close(fvLump(1000, 0.05, 10), 1628.894626777442, 1e-9);
  // Future value of an ordinary annuity of 1 at 10% for 10 periods: 15.9374 in the standard tables.
  close(fvAnnuity(1, 0.1, 10), 15.937424601, 1e-9);
  close(fvAnnuityDue(1, 0.1, 10), 17.5311670611, 1e-9);
  close(fvAnnuity(250, 0, 8), 2000, 1e-12);
  // Growing annuity: (1.1^10 - 1.05^10) / 0.05.
  close(fvGrowingAnnuity(1, 0.1, 0.05, 10), (1.1 ** 10 - 1.05 ** 10) / 0.05, 1e-10);
  close(fvGrowingAnnuity(1, 0.1, 0.05, 10), 19.296956666, 1e-8); // (2.5937424601 - 1.6288946268) / 0.05
  // Equal rates: n (1 + i)^(n - 1); and the formula is continuous on both sides of the equal case.
  close(fvGrowingAnnuity(1, 0.05, 0.05, 20), 20 * 1.05 ** 19, 1e-12);
  rel(fvGrowingAnnuity(1, 0.05, 0.05 + 1e-9, 20), 20 * 1.05 ** 19, 1e-7);
  // Either side of the switch to adding up the terms, both branches agree with a direct sum.
  const direct = (i, g, n) => { let s = 0; for (let k = 0; k < n; k++) s += (1 + g) ** k * (1 + i) ** (n - 1 - k); return s; };
  for (const d of [2e-6, 1.01e-6, 9.9e-7, 3e-7, -5e-7]) rel(fvGrowingAnnuity(1, 0.05, 0.05 + d, 20), direct(0.05, 0.05 + d, 20), 1e-10);
  // With no growth it is the ordinary annuity; a tiny rate loses no digits.
  rel(fvGrowingAnnuity(3, 0.07, 0, 30), fvAnnuity(3, 0.07, 30), 1e-13);
  rel(fvAnnuity(1, 1e-12, 100), 100 + 1e-12 * 4950, 1e-13);
});

test("yearly pay-ins with no fees: the simulation is the lump sum plus the annuity", () => {
  const p = plan({ perYear: 1, start: 5000, pay: 1000, fee: 0, rate: 8, age: 30, end: 60 });
  const s = simulate(p);
  rel(s.balance, fvLump(5000, 0.08, 30) + fvAnnuity(1000, 0.08, 30), 1e-12);
  assert.equal(s.paidIn, 5000 + 30 * 1000);
  assert.equal(s.path.length, 31);
  assert.equal(s.path[0].balance, 5000);
  close(s.path[1].balance, 5000 * 1.08 + 1000, 1e-9);
});

test("monthly pay-ins rising each year match the closed form across random and extreme plans", () => {
  const r = rng(77);
  const cases = [
    {}, { raise: 3 }, { fee: 1, raise: 2.5, start: 20000 }, { rate: 0, fee: 0 }, { rate: -50, fee: 10, raise: -10 },
    { rate: 50, raise: 20, age: 0, end: 100, start: 1e9, pay: 1e7 }, { rate: 5, fee: 0, raise: 5 }, { perYear: 1, raise: 4 },
  ];
  for (let k = 0; k < 200; k++) {
    const age = r.int(0, 98);
    cases.push({
      start: r.uniform(0, 1e6), pay: r.uniform(0, 5000), perYear: r.bool() ? 12 : 1, raise: r.uniform(-10, 20), age,
      end: r.int(age + 1, 100), rate: r.uniform(-50, 50), fee: r.uniform(0, 10), inflation: r.uniform(-10, 30),
    });
  }
  for (const c of cases) {
    const p = plan(c);
    const s = simulate(p);
    assert.ok(Number.isFinite(s.balance) && s.balance >= 0, JSON.stringify(c));
    rel(s.balance, closedForm(p), 1e-10);
    rel(s.real, s.balance / (1 + p.inflation) ** p.years, 1e-12);
  }
});

test("fees: charged on the grown balance, and what they cost includes the growth they remove", () => {
  // One year, yearly: 1000 grows 10% to 1100, a 1% fee takes 11, leaving 1089.
  const p = plan({ perYear: 1, start: 1000, pay: 0, rate: 10, fee: 1, age: 40, end: 41 });
  const s = simulate(p);
  close(s.balance, 1089, 1e-9);
  close(s.fees, 11, 1e-9);
  close(netFactor(p), 1.089, 1e-12);
  // Over forty years the fees cost more than the sum charged, because what they take no longer grows.
  const withFee = simulate(plan({ fee: 1 })), noFee = simulate(plan({ fee: 0 }));
  assert.ok(noFee.balance - withFee.balance > withFee.fees);
  assert.equal(noFee.fees, 0);
});

test("real values and the real rate use Fisher's exact relation", () => {
  const p = plan({ rate: 7, fee: 0, inflation: 3 });
  close(realRate(p), 1.07 / 1.03 - 1, 1e-15);
  assert.equal((100 * realRate(p)).toFixed(2), "3.88"); // not r - pi = 4
  assert.equal((1.02 ** 40).toFixed(3), "2.208"); // forty years at 2% more than doubles prices
  close(netRate(plan({ rate: 5, fee: 0.5 })), 1.05 * 0.995 - 1, 1e-15);
  const s = simulate(p);
  s.path.forEach((row) => close(row.deflator, 1.03 ** row.t, 1e-12));
});

test("doubling time: exact against the rule of 72", () => {
  close(doublingYears(0.08), Math.log(2) / Math.log(1.08), 1e-12);
  assert.equal(doublingYears(0.08).toFixed(2), "9.01");
  assert.equal(ruleOf72(0.08), 9);
  assert.equal(doublingYears(0), Infinity);
  assert.equal(doublingYears(-0.02), Infinity);
  assert.equal(ruleOf72(-0.02), Infinity);
  // At 1% the rule says 72 years; the exact answer is 69.66.
  assert.equal(doublingYears(0.01).toFixed(2), "69.66");
});

test("input checks: every box has a range and a message", () => {
  assert.equal(readPlan(OPENING).ok, true);
  const bad = (change) => readPlan({ ...OPENING, ...change }).errors;
  assert.deepEqual(bad({ age: 65, end: 65 }).map((e) => e.key), ["end"]);
  assert.match(bad({ age: 70, end: 65 })[0].message, /later than the age now/);
  assert.match(bad({ age: 25.5 })[0].message, /whole number/);
  assert.deepEqual(bad({ pay: -1 }).map((e) => e.key), ["pay"]);
  assert.deepEqual(bad({ start: 1e308 }).map((e) => e.key), ["start"]);
  assert.deepEqual(bad({ rate: NaN }).map((e) => e.key), ["rate"]);
  assert.deepEqual(bad({ rate: 51 }).map((e) => e.key), ["rate"]);
  assert.deepEqual(bad({ fee: 10.5, inflation: -11 }).map((e) => e.key), ["fee", "inflation"]);
  assert.deepEqual(bad({ end: 101 }).map((e) => e.key), ["end"]);
  assert.deepEqual(bad({ perYear: 4 }).map((e) => e.key), ["perYear"]);
  assert.match(bad({ start: -5 })[0].message, /from 0 to 1,000,000,000/);
  assert.equal(LIMITS.end.max, 100);
});

test("the largest plan the boxes allow stays finite", () => {
  const p = plan({ start: 1e9, pay: 1e7, raise: 20, rate: 50, fee: 0, age: 0, end: 100, inflation: -10 });
  const s = simulate(p);
  assert.ok(Number.isFinite(s.balance) && Number.isFinite(s.real));
  assert.equal(s.balance.toExponential(1), "6.0e+26"); // the write-up quotes these two
  assert.equal(s.real.toExponential(0), "2e+31");
  const tiny = simulate(plan({ start: 1, pay: 0, rate: -50, fee: 10, age: 0, end: 100, inflation: 30 }));
  assert.ok(tiny.real > 0 && tiny.real < 1e-40);
});

test("small differences: each variant changes one thing, and says when it cannot apply", () => {
  const v = variants(plan());
  assert.equal(v.length, 8);
  assert.ok(v.every((x) => x.plan));
  const late = v.find((x) => x.id === "late10").plan;
  assert.equal(late.years, 30);
  assert.equal(late.age, 35);
  const short = variants(plan({ age: 60, end: 65, fee: 0, pay: 0, rate: 50 }));
  assert.match(short.find((x) => x.id === "late5").reason, /5 years or shorter/);
  assert.match(short.find((x) => x.id === "fee0").reason, /no fees already/);
  assert.match(short.find((x) => x.id === "pay+10").reason, /pays nothing in/);
  assert.match(short.find((x) => x.id === "rate+1").reason, /pass 50%/);
  const c = compare(plan());
  for (const x of c) close(x.diff, x.real - simulate(plan()).real, 1e-6);
});

test("the finding on the page", () => {
  // $200 a month from 25 to 65 at 5% before fees of 0.1%, with 2% inflation.
  const base = simulate(plan());
  assert.equal(Math.round(base.real), 130832);
  assert.equal(base.paidIn, 96000);
  // One more point of fees: 22.5% less in today's money, more than starting 5 years later costs.
  const c = Object.fromEntries(compare(plan()).map((x) => [x.id, x]));
  assert.equal(Math.round(c["fee+1"].real), 101333);
  assert.equal((100 * c["fee+1"].share).toFixed(1), "-22.5");
  // Starting 5 years later ends on the same birthday, so it is deflated over 40 years, not 35 (review fix: the page
  // once deflated over 35 and showed -17.1%). Independent figure from a month-by-month sum written in Python: 98,200.12.
  assert.equal((100 * c.late5.share).toFixed(1), "-24.9");
  close(c.late5.real, 98200.12, 0.01);
  assert.equal((100 * c.late10.share).toFixed(1), "-44.6");
  assert.ok(c.late5.share < c["fee+1"].share); // the delay costs a little more than the fees
  // A saver who is 35 today, with $300 a month, pays in $12,000 more and ends with about the same.
  const late = simulate(plan({ age: 35, pay: 300 }));
  assert.equal(late.paidIn, 108000);
  assert.equal(Math.round(late.real), 132572);
});

test("a later start is counted in money of now, and paid-in sums deflate each payment when it is made", () => {
  // Delay 2 years, then 1 year of yearly pay-ins of 100 at 0% with 10% inflation: worth 100 / 1.1^3 today.
  const p = { ...plan({ perYear: 1, pay: 100, rate: 0, fee: 0, inflation: 10, age: 40, end: 41 }), delay: 2 };
  const s = simulate(p);
  close(s.balance, 100, 1e-12);
  close(s.real, 100 / 1.1 ** 3, 1e-12);
  close(s.paidInReal, 100 / 1.1 ** 3, 1e-12);
  assert.equal(s.path[0].deflator, 1.1 ** 2);
  // Monthly: 12 pay-ins of 1 at 0% return and 12% inflation, each deflated at its own month-end.
  const m = simulate(plan({ pay: 1, rate: 0, fee: 0, inflation: 12, age: 40, end: 41 }));
  let want = 0;
  for (let k = 1; k <= 12; k++) want += 1 / 1.12 ** (k / 12);
  close(m.paidInReal, want, 1e-12);
  // The opening plan: $96,000 paid in is worth less than that in today's money, more than $96,000 / 1.02^40.
  const base = simulate(plan());
  assert.ok(base.paidInReal < 96000 && base.paidInReal > 96000 / 1.02 ** 40);
  // The variants move the start and keep the end age.
  const v = Object.fromEntries(variants(plan()).map((x) => [x.id, x.plan]));
  assert.deepEqual([v.late5.age + v.late5.years, v.late5.delay, v.late10.delay], [65, 5, 10]);
  assert.equal(v["fee+1"].delay, undefined);
});
