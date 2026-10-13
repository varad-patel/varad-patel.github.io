import test from "node:test";
import assert from "node:assert/strict";
import { MODELS, RATIONING, LIMITS, curveProblem, demandAt, supplyAt, equilibria, outcome, effect, thresholds, sweep, elasticities } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
// The page's opening curves: demand w = 300 - 2L, supply w = 60 + L.
const P = { a: 300, b: 2, c: 60, d: 1 };

test("the two markets with no floor, by hand", () => {
  const eq = equilibria(P);
  // Competitive: 300 - 2L = 60 + L, so L = 80 and w = 140.
  assert.deepEqual(eq.competitive, { L: 80, w: 140 });
  // Monopsony: 300 - 2L = 60 + 2L, so L = 60, w = 60 + 60 = 120, and the last worker is worth 300 - 120 = 180.
  assert.deepEqual(eq.monopsony, { L: 60, w: 120, worth: 180 });
  assert.equal(demandAt(P, 160), 70);
  assert.equal(supplyAt(P, 160), 100);
  assert.equal(demandAt(P, 500), 0);
  assert.equal(supplyAt(P, 10), 0);
});

test("the monopsony point is where the employer's profit is highest", () => {
  // Checked without the formula: profit = worth of L workers - pay, over a fine grid of L.
  for (const p of [P, { a: 240, b: 1, c: 60, d: 1 }, { a: 400, b: 8, c: 0, d: 0.25 }, { a: 150, b: 0.5, c: 120, d: 4 }]) {
    let best = 0, bestProfit = -Infinity;
    for (let L = 0; L <= 400; L += 0.001) { const profit = p.a * L - (p.b * L * L) / 2 - (p.c + p.d * L) * L; if (profit > bestProfit) { bestProfit = profit; best = L; } }
    close(equilibria(p).monopsony.L, best, 0.002);
  }
});

test("a floor in the competitive market, by hand", () => {
  // At or below the going wage of 140 nothing changes.
  for (const floor of [0, 100, 140]) {
    const o = outcome(P, "competitive", floor);
    assert.deepEqual([o.L, o.w, o.binding, o.regime, o.jobless], [80, 140, false, "free", 0]);
  }
  // Baseline surpluses: workers 140x80 - 60x80 - 80^2/2 = 3,200; employers 300x80 - 80^2 - 140x80 = 6,400.
  const base = outcome(P, "competitive", 0);
  assert.deepEqual([base.wageBill, base.workers, base.employers, base.total], [11200, 3200, 6400, 9600]);
  // Floor 160: employers want 70, 100 are willing, 30 are left without work.
  const o = outcome(P, "competitive", 160);
  assert.deepEqual([o.L, o.w, o.willing, o.jobless, o.binding, o.regime], [70, 160, 100, 30, true, "demand"]);
  // Wage bill 160x70 = 11,200. Workers 11,200 - 60x70 - 70^2/2 = 4,550. Employers 300x70 - 70^2 - 11,200 = 4,900.
  assert.deepEqual([o.wageBill, o.workers, o.employers, o.total], [11200, 4550, 4900, 9450]);
  // If the 70 jobs go to a random draw of the 100 willing, the average job-holder would have worked for
  // (60 + 160) / 2 = 110, so workers' surplus is 70 x 50 = 3,500.
  const random = outcome(P, "competitive", 160, "random");
  assert.deepEqual([random.L, random.workers, random.employers, random.total], [70, 3500, 4900, 8400]);
});

test("a floor under monopsony, by hand", () => {
  for (const floor of [0, 90, 120]) {
    const o = outcome(P, "monopsony", floor);
    assert.deepEqual([o.L, o.w, o.binding, o.jobless], [60, 120, false, 0]);
  }
  const base = outcome(P, "monopsony", 0);
  // Workers 120x60 - 60x60 - 60^2/2 = 1,800. Employers 300x60 - 60^2 - 7,200 = 7,200.
  assert.deepEqual([base.wageBill, base.workers, base.employers, base.total], [7200, 1800, 7200, 9000]);
  // Floor 130, between the monopsony wage and the competitive wage: everyone willing is hired, 70.
  const mid = outcome(P, "monopsony", 130);
  assert.deepEqual([mid.L, mid.w, mid.regime, mid.jobless, mid.wageBill, mid.workers, mid.employers], [70, 130, "supply", 0, 9100, 2450, 7000]);
  // Floor 140, the competitive wage: employment peaks at 80, the competitive outcome.
  const peak = outcome(P, "monopsony", 140);
  assert.deepEqual([peak.L, peak.jobless, peak.workers, peak.employers, peak.total], [80, 0, 3200, 6400, 9600]);
  // Floor 160, above it: the employer wants 70, as in the competitive market, and 30 willing workers are left out.
  const high = outcome(P, "monopsony", 160);
  assert.deepEqual([high.L, high.regime, high.jobless, high.workers, high.employers], [70, "demand", 30, 4550, 4900]);
  // Floor 180, what the monopsonist's last worker was worth: employment is back to 60.
  assert.equal(outcome(P, "monopsony", 180).L, 60);
  assert.equal(outcome(P, "monopsony", 200).L, 50);
});

test("under a floor the employer's choice is the profit-maximising one", () => {
  // Checked without the piecewise rule: a single employer facing pay of max(floor, 60 + L) picks L on a grid.
  for (const floor of [100, 125, 130, 140, 155, 160, 180, 250]) {
    let best = 0, bestProfit = -Infinity;
    for (let L = 0; L <= 150; L += 0.001) { const profit = P.a * L - (P.b * L * L) / 2 - Math.max(floor, P.c + P.d * L) * L; if (profit > bestProfit + 1e-9) { bestProfit = profit; best = L; } }
    close(outcome(P, "monopsony", floor).L, best, 0.002);
  }
});

test("the textbook results hold along the whole range of floors", () => {
  const eq = equilibria(P), th = thresholds(P, "monopsony");
  assert.deepEqual(th, { bites: 120, peak: 140, breakEven: 180, zero: 300 });
  assert.deepEqual(thresholds(P, "competitive"), { bites: 140, peak: 140, breakEven: 140, zero: 300 });
  let last = Infinity;
  for (let floor = 0; floor <= 400; floor += 0.5) {
    const c = outcome(P, "competitive", floor), m = outcome(P, "monopsony", floor);
    // Competitive: a floor never adds a job, and employment never rises with the floor.
    assert.ok(c.L <= eq.competitive.L + 1e-9 && c.L <= last + 1e-9);
    last = c.L;
    // Monopsony: more jobs than with no floor exactly when the floor is strictly between 120 and 180.
    assert.equal(m.L > eq.monopsony.L + 1e-9, floor > th.bites && floor < th.breakEven, `floor ${floor}`);
    assert.ok(m.L <= eq.competitive.L + 1e-9);
    // Above the competitive wage the two models give the same market.
    if (floor >= eq.competitive.w) { close(m.L, c.L); close(m.workers, c.workers); close(m.employers, c.employers); }
    // Total surplus is (a - c)L - (b + d)L^2/2 whatever the wage, and is never above the competitive level of 9,600.
    for (const o of [c, m]) { close(o.total, 240 * o.L - 1.5 * o.L * o.L, 1e-6); assert.ok(o.total <= 9600 + 1e-9); assert.ok(o.jobless >= -1e-12 && o.L >= 0); }
    // A random draw of the willing never leaves workers better off than giving jobs to those who would work for least.
    assert.ok(outcome(P, "competitive", floor, "random").workers <= c.workers + 1e-9);
  }
});

test("who gains and who loses, by hand", () => {
  const c = effect(P, "competitive", 160);
  // 10 thousand jobs go; the 70 thousand who stay get 20 more an hour, 1,400 in all.
  assert.deepEqual([c.jobs, c.lost, c.hired, c.wage, c.stayers, c.stayersGain, c.wageBill], [-10, 10, 0, 20, 70, 1400, 0]);
  assert.deepEqual([c.workers, c.employers, c.total], [1350, -1500, -150]);
  const m = effect(P, "monopsony", 160);
  // 10 thousand jobs are created; the 60 thousand already employed get 40 more an hour, 2,400 in all.
  assert.deepEqual([m.jobs, m.lost, m.hired, m.wage, m.stayers, m.stayersGain, m.wageBill], [10, 0, 10, 40, 60, 2400, 4000]);
  assert.deepEqual([m.workers, m.employers, m.total], [2750, -2300, 450]);
  // The same floor with the 70 jobs drawn at random from the 100 willing: each of the 80 earlier workers keeps a
  // job with probability 0.7, so 56 stay, 24 lose their jobs and 14 people who were not working are hired.
  const r = effect(P, "competitive", 160, "random");
  assert.deepEqual([r.jobs, r.stayers, r.lost, r.hired].map((v) => +v.toFixed(9)), [-10, 56, 24, 14]);
  assert.deepEqual([r.workers, r.employers, r.total].map((v) => +v.toFixed(9)), [300, -1500, -1200]);
  const rm = effect(P, "monopsony", 160, "random");
  assert.deepEqual([rm.jobs, rm.stayers, rm.lost, rm.hired].map((v) => +v.toFixed(9)), [10, 42, 18, 28]);
  // No shortage, no draw: under monopsony at 130 everyone willing is hired, whichever rule is chosen.
  const mid = effect(P, "monopsony", 130, "random");
  assert.deepEqual([mid.jobs, mid.stayers, mid.lost, mid.hired], [10, 60, 0, 10]);
  // A floor that does not bind changes nothing.
  const none = effect(P, "monopsony", 100);
  assert.deepEqual([none.jobs, none.wage, none.workers, none.employers, none.total, none.stayersGain], [0, 0, 0, 0, 0, 0]);
});

test("small and awkward cases behind the sentences", () => {
  // Demand w = 400 - 4L, supply w = 60 + L, one employer. With no floor L = 340/6 and the last worker is worth
  // 400 - 4 x 340/6 = 173.33. A floor of 173 leaves L = 227/4 = 56.75, a shade more than 56.667, so both sides
  // together gain, but by 4.7 thousand an hour, which is 0.00 in millions to two places. The page must not call
  // that "no better or worse off".
  const p = { a: 400, b: 4, c: 60, d: 1 };
  const small = effect(p, "monopsony", 173);
  close(small.after.L, 56.75, 1e-12);
  close(small.total, 340 * 56.75 - 2.5 * 56.75 ** 2 - (340 * (340 / 6) - 2.5 * (340 / 6) ** 2), 1e-9);
  assert.ok(small.total > 4.6 && small.total < 4.8);
  assert.ok(effect(p, "monopsony", 174).total < 0);
  // A random draw can lower the total even when the floor brings employment nearer to the competitive level:
  // opening curves, one employer, floor 160. Jobs go from 60 to 70 (competitive: 80), yet the total falls by 600.
  const draw = effect(P, "monopsony", 160, "random");
  assert.deepEqual([draw.before.L, draw.after.L, draw.total], [60, 70, -600]);
  assert.equal(effect(P, "monopsony", 160, "efficient").total, 450);
  // Rounded to millions, workers' and employers' surplus need not add up to the rounded total: with supply
  // w = 3L and no floor the single employer leaves 2,109.375 and 5,625, total 7,734.375 (2.11 + 5.63 against 7.73).
  const few = outcome({ a: 300, b: 2, c: 0, d: 3 }, "monopsony", 0);
  assert.deepEqual([few.L, few.w, few.workers, few.employers, few.total], [37.5, 112.5, 2109.375, 5625, 7734.375]);
});

test("extremes", () => {
  // A floor at or above the highest wage any employer would pay ends all employment.
  for (const model of ["competitive", "monopsony"]) for (const floor of [300, 400]) {
    const o = outcome(P, model, floor);
    assert.deepEqual([o.L, o.wageBill, o.workers, o.employers, o.total], [0, 0, 0, 0, 0]);
    assert.equal(o.jobless, floor - 60);
  }
  // Nearly flat supply: the single employer has almost no power, and the two models nearly agree.
  const flat = equilibria({ a: 300, b: 2, c: 60, d: 0.25 });
  assert.ok(flat.competitive.L - flat.monopsony.L < 11 && flat.competitive.w - flat.monopsony.w < 4);
  // The corners of the ranges the interface allows all solve to finite, positive numbers.
  for (const a of LIMITS.a) for (const b of LIMITS.b) for (const c of LIMITS.c) for (const d of LIMITS.d) for (const floor of LIMITS.floor) for (const m of MODELS) for (const r of RATIONING) {
    const o = outcome({ a, b, c, d }, m.id, floor, r.id);
    assert.ok(!o.error && [o.L, o.w, o.wageBill, o.workers, o.employers, o.total, o.jobless, o.willing].every((v) => Number.isFinite(v) && v >= 0), JSON.stringify({ a, b, c, d, floor, o }));
  }
  const s = sweep(P, "monopsony", [0, 130, 160]);
  assert.deepEqual(s.map((x) => x.L), [60, 70, 70]);
  assert.deepEqual(s.map((x) => x.wageBill), [7200, 9100, 11200]);
});

test("elasticities at the competitive point", () => {
  // Demand: dL/dw = -1/2, times w/L = 140/80. Supply: dL/dw = 1, times 140/80.
  const e = elasticities(P);
  close(e.demand, -0.875);
  close(e.supply, 1.75);
});

test("bad input is refused with a reason", () => {
  assert.equal(curveProblem(P), "");
  assert.match(curveProblem({ ...P, b: 0 }), /demand slope/);
  assert.match(curveProblem({ ...P, d: 0 }), /supply slope/);
  assert.match(curveProblem({ ...P, d: -1 }), /supply slope/);
  assert.match(curveProblem({ ...P, c: -5 }), /below zero/);
  assert.match(curveProblem({ ...P, a: 60 }), /no market/);
  assert.match(curveProblem({ ...P, a: NaN }), /numbers/);
  assert.match(curveProblem({ ...P, b: Infinity }), /numbers/);
  assert.match(curveProblem({ a: "300", b: 2, c: 60, d: 1 }), /numbers/);
  assert.match(curveProblem(), /numbers/);
  assert.match(equilibria({ ...P, a: 10 }).error, /no market/);
  assert.match(outcome(P, "cartel", 100).error, /no model/);
  assert.match(outcome(P, "competitive", -1).error, /zero or more/);
  assert.match(outcome(P, "competitive", NaN).error, /zero or more/);
  assert.match(outcome(P, "competitive", 100, "lottery").error, /rationing/);
  assert.match(effect({ ...P, b: 0 }, "competitive", 100).error, /demand slope/);
  assert.match(thresholds({ ...P, d: 0 }, "monopsony").error, /supply slope/);
  assert.match(elasticities({ ...P, a: 0 }).error, /no market/);
});

test("the numbers on the page", () => {
  // One finding: a floor of 160 leaves 70 thousand in work under both models, 10 thousand fewer than the
  // competitive market had and 10 thousand more than the monopsony had.
  const c = effect(P, "competitive", 160), m = effect(P, "monopsony", 160);
  assert.equal(c.after.L, 70);
  assert.equal(m.after.L, 70);
  assert.equal(c.jobs, -10);
  assert.equal(m.jobs, 10);
  assert.equal(c.before.L, 80);
  assert.equal(m.before.L, 60);
  // The same floor and the same market afterwards: total surplus 9,450 either way, down 150 or up 450.
  assert.deepEqual([c.after.total, m.after.total, c.total, m.total], [9450, 9450, -150, 450]);
  // Wage bill: unchanged at 11,200 in the competitive market, up from 7,200 under monopsony.
  assert.deepEqual([c.before.wageBill, c.after.wageBill, m.before.wageBill, m.after.wageBill], [11200, 11200, 7200, 11200]);
});
