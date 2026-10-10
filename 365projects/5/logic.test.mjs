import test from "node:test";
import assert from "node:assert/strict";
import { problem, chase, geometricSum, stage, stages, positions, stagesCompleted, stagesUntilGap, resolvableStages } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const run = (headStart, achilles, tortoise) => chase({ headStart, achilles, tortoise });

test("hand-computed case: 100 m head start, 10 m/s against 5 m/s", () => {
  const c = run(100, 10, 5);
  assert.equal(c.r, 0.5);
  assert.equal(c.catches, true);
  assert.equal(c.catchTime, 20);
  assert.equal(c.catchPoint, 200);
  assert.deepEqual(stage(c, 1), { k: 1, leg: 100, legTime: 10, distance: 100, time: 10, tortoise: 150, gap: 50, short: 100, shortTime: 10 });
  const s3 = stage(c, 3);
  assert.equal(s3.leg, 25);
  assert.equal(s3.distance, 175);
  assert.equal(s3.time, 17.5);
  assert.equal(s3.tortoise, 187.5);
  assert.equal(s3.gap, 12.5);
  assert.equal(s3.short, 25);
});

test("the classic case adds one digit per stage: 100, 110, 111, 111.1 towards 111.11...", () => {
  const c = run(100, 10, 1);
  close(c.r, 0.1, 1e-15);
  close(c.catchPoint, 1000 / 9, 1e-12);
  close(c.catchTime, 100 / 9, 1e-12);
  [100, 110, 111, 111.1, 111.11].forEach((v, i) => close(stage(c, i + 1).distance, v, 1e-10));
});

test("the closed form equals adding the legs one at a time", () => {
  for (const [d, vA, vT] of [[100, 10, 5], [37, 9.3, 2.1], [250, 4, 3.9], [10, 5, 6], [10, 5, 5]]) {
    const c = run(d, vA, vT);
    let dist = 0, time = 0;
    for (let k = 1; k <= 25; k++) {
      const s = stage(c, k);
      dist += s.leg;
      time += s.legTime;
      close(s.distance / dist, 1, 1e-12);
      close(s.time / time, 1, 1e-12);
      // The next leg is exactly the lead the tortoise has built up.
      close(stage(c, k + 1).leg / s.gap, 1, 1e-12);
      close(s.tortoise - s.distance, s.gap, 1e-12 * s.tortoise);   // a subtraction of near-equal numbers, so an absolute tolerance
    }
  }
  assert.equal(geometricSum(0.5, 0), 0);
  assert.equal(geometricSum(1, 7), 7);
  assert.equal(geometricSum(2, 4), 15);
});

test("partial sums rise towards the catch-up point and never reach it", () => {
  const c = run(100, 10, 5);
  let last = 0;
  for (const s of stages(c, 40)) {
    assert.ok(s.distance > last && s.distance < c.catchPoint, `stage ${s.k}`);
    assert.ok(s.time < c.catchTime);
    close(c.catchPoint - s.distance, s.short, 1e-9);
    close(c.catchTime - s.time, s.shortTime, 1e-9);
    last = s.distance;
  }
  close(stage(c, 40).distance, 200, 1e-9);
  close(stage(c, 40).time, 20, 1e-9);
});

test("the limit of the series agrees with plain kinematics", () => {
  for (const [d, vA, vT] of [[100, 10, 5], [100, 10, 1], [42, 11.9, 0.3], [500, 12, 11.9]]) {
    const c = run(d, vA, vT);
    const p = positions(c, c.catchTime);
    close(p.achilles / p.tortoise, 1, 1e-12);
    close(p.achilles / c.catchPoint, 1, 1e-12);
    close(c.catchPoint / (d / (1 - c.r)), 1, 1e-12);
    assert.ok(positions(c, c.catchTime * 1.1).gap < 0, "Achilles is ahead after the catch-up time");
    assert.ok(positions(c, c.catchTime * 0.9).gap > 0);
  }
});

test("stage counting: a stage is complete from the moment Achilles reaches its end", () => {
  const c = run(100, 10, 5);
  assert.equal(stagesCompleted(c, 0), 0);
  assert.equal(stagesCompleted(c, 9.99), 0);
  assert.equal(stagesCompleted(c, 10), 1);
  assert.equal(stagesCompleted(c, 14.99), 1);
  assert.equal(stagesCompleted(c, 15), 2);
  for (let k = 1; k <= 45; k++) assert.equal(stagesCompleted(c, stage(c, k).time), k);
  assert.equal(stagesCompleted(c, 20), Infinity);
  assert.equal(stagesCompleted(c, 25), Infinity);
});

test("equal speeds: every stage is as long as the first and the lead never changes", () => {
  const c = run(100, 10, 10);
  assert.equal(c.r, 1);
  assert.equal(c.catches, false);
  assert.equal(c.catchTime, Infinity);
  assert.equal(c.catchPoint, Infinity);
  for (const s of stages(c, 30)) {
    assert.equal(s.leg, 100);
    assert.equal(s.distance, 100 * s.k);
    assert.equal(s.gap, 100);
    assert.equal(s.short, Infinity);
  }
  assert.equal(stagesCompleted(c, 35), 3);
  assert.equal(stagesUntilGap(c, 1), Infinity);
  assert.equal(resolvableStages(c), Infinity);
});

test("a faster tortoise: the stages grow and the sums diverge", () => {
  const c = run(100, 5, 6);
  close(c.r, 1.2, 1e-15);
  assert.equal(c.catches, false);
  const list = stages(c, 30);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].leg > list[i - 1].leg);
    assert.ok(list[i].gap > list[i - 1].gap);
  }
  assert.ok(list[29].distance > 100000);
  close(stage(c, 2).distance, 220, 1e-9);
  for (let k = 1; k <= 20; k++) assert.equal(stagesCompleted(c, stage(c, k).time), k);
  assert.equal(stagesCompleted(c, 1e9) < Infinity, true);
});

test("a tortoise that stands still is caught in one stage", () => {
  const c = run(100, 10, 0);
  assert.equal(c.r, 0);
  assert.equal(c.catchPoint, 100);
  assert.equal(c.catchTime, 10);
  assert.equal(stage(c, 1).gap, 0);
  assert.equal(stage(c, 2).leg, 0);
  assert.equal(stage(c, 5).distance, 100);
  assert.equal(stagesCompleted(c, 5), 0);
  assert.equal(stagesCompleted(c, 10), Infinity);
  assert.equal(stagesUntilGap(c, 0.001), 1);
  assert.equal(resolvableStages(c), 1);
});

test("how many stages until the lead is below a threshold", () => {
  const c = run(100, 10, 5);
  assert.equal(stagesUntilGap(c, 200), 0);
  assert.equal(stagesUntilGap(c, 100), 1);   // "below" is strict: the lead is exactly 100 before stage 1
  assert.equal(stagesUntilGap(c, 50), 2);
  assert.equal(stagesUntilGap(c, 1e-3), 17);
  assert.equal(stagesUntilGap(c, 1e-6), 27);
  assert.equal(stagesUntilGap(c, 0), Infinity);
  const classic = run(100, 10, 1);
  assert.equal(stagesUntilGap(classic, 1e-3), 6);
  for (const eps of [1, 0.01, 1e-7]) {
    const k = stagesUntilGap(classic, eps);
    assert.ok(stage(classic, k).gap < eps && (k === 0 || classic.d * classic.r ** (k - 1) >= eps));
  }
});

test("double precision runs out after a finite number of stages", () => {
  const c = run(100, 10, 5);
  const k = resolvableStages(c);
  assert.equal(k, 53);
  assert.ok(stage(c, k).distance < c.catchPoint);
  assert.equal(stage(c, k + 1).distance, c.catchPoint);   // the float has arrived; the series has not
  assert.ok(stage(c, k + 1).short > 0);
});

test("invalid input is refused with a reason", () => {
  assert.match(problem({ headStart: 0, achilles: 10, tortoise: 5 }), /head start/);
  assert.match(problem({ headStart: 100, achilles: 0, tortoise: 5 }), /Achilles/);
  assert.match(problem({ headStart: 100, achilles: 10, tortoise: -1 }), /tortoise/);
  assert.match(problem({ headStart: NaN, achilles: 10, tortoise: 5 }), /numbers/);
  assert.match(problem({}), /numbers/);
  assert.match(problem(), /numbers/);
  assert.ok(chase({ headStart: "100", achilles: 10, tortoise: 5 }).error);
  assert.equal(problem({ headStart: 100, achilles: 10, tortoise: 0 }), null);
});

test("the finding: 9.8 cm after 10 stages, under a millimetre after 17, all over in 20 seconds", () => {
  const c = run(100, 10, 5);
  assert.equal(c.catchPoint, 200);
  assert.equal(c.catchTime, 20);
  assert.equal(stage(c, 10).gap, 0.09765625);
  close(stage(c, 10).distance, 199.8046875, 1e-12);
  assert.equal(stagesUntilGap(c, 1e-3), 17);
  close(stage(c, 17).gap, 0.000762939453125, 1e-15);
  assert.ok(stages(c, 53).every((s) => s.gap > 0 && s.time < 20));
});
