import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { SIDE, METHODS, midpointCdf, chord, sample, standardError, createRun, crossing, innerTest, innerExact, keepsAnswer } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const KEYS = METHODS.map((m) => m.key);
/** A stand-in generator that returns the given numbers in turn. */
const fixed = (...values) => { let i = 0; return () => values[i++]; };

test("a chord is built correctly from its midpoint", () => {
  const c = chord(0.6, 0);
  close(c.mx, 0.6); close(c.my, 0);
  close(c.x1, 0.6); close(c.y1, 0.8); close(c.x2, 0.6); close(c.y2, -0.8);   // the 3-4-5 triangle
  close(c.length, 1.6);
  assert.equal(c.long, false);
  for (const [m, phi] of [[0, 0], [0.3, 1], [0.5, 2], [0.77, 4], [1, 5.5]]) {
    const k = chord(m, phi);
    close(Math.hypot(k.x1, k.y1), 1, 1e-12);
    close(Math.hypot(k.x2, k.y2), 1, 1e-12);
    close((k.x1 + k.x2) / 2, k.mx, 1e-12);
    close((k.y1 + k.y2) / 2, k.my, 1e-12);
    close(Math.hypot(k.x1 - k.x2, k.y1 - k.y2), k.length, 1e-12);
    close(k.length, 2 * Math.sqrt(1 - m * m), 1e-12);
  }
});

test("longer than the triangle's side means a midpoint less than half a radius from the centre", () => {
  close(SIDE, Math.sqrt(3));
  // The inscribed triangle with a vertex at angle 90 degrees has its other vertices at 210 and 330 degrees.
  const at = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const [a, b] = [at(210), at(330)];
  close(Math.hypot(a[0] - b[0], a[1] - b[1]), SIDE, 1e-12);
  close(Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), 0.5, 1e-12);   // each side is half a radius from the centre
  assert.equal(chord(0.499, 1).long, true);
  assert.equal(chord(0.501, 1).long, false);
  assert.equal(chord(0.5, 0).long, false);   // exactly the side is not longer than the side
  assert.equal(chord(0, 0).length, 2);
  assert.equal(chord(1, 0).length, 0);
});

test("each recipe does what it says", () => {
  // Endpoints at 90 and 180 degrees: the chord from (0, 1) to (-1, 0).
  const e = sample("endpoints", fixed(0.25, 0.5));
  const ends = [[e.x1, e.y1], [e.x2, e.y2]].sort((p, q) => p[0] - q[0]);
  close(ends[0][0], -1, 1e-12); close(ends[0][1], 0, 1e-12);
  close(ends[1][0], 0, 1e-12); close(ends[1][1], 1, 1e-12);
  close(e.length, Math.SQRT2, 1e-12);
  // Endpoints at 0 and 180 degrees: a diameter.
  close(sample("endpoints", fixed(0, 0.5)).length, 2, 1e-12);
  // Endpoints either side of the angle 0 (350 and 10 degrees): the midpoint lies on the positive x axis.
  const w = sample("endpoints", fixed(350 / 360, 10 / 360));
  close(w.mx, Math.cos((10 * Math.PI) / 180), 1e-12); close(w.my, 0, 1e-12);
  // Radius: direction 90 degrees, 0.3 of the way out.
  const r = sample("radius", fixed(0.25, 0.3));
  close(r.mx, 0, 1e-12); close(r.my, 0.3, 1e-12); close(r.y1, 0.3, 1e-12); close(r.y2, 0.3, 1e-12);
  // Midpoint: the distance is the square root of the uniform draw.
  const m = sample("midpoint", fixed(0, 0.25));
  close(m.mx, 0.5, 1e-12); close(m.my, 0, 1e-12);
  assert.throws(() => sample("nope", rng(1)), /unknown method/);
});

test("the three theoretical answers are 1/3, 1/2 and 1/4", () => {
  close(midpointCdf.endpoints(0.5), 1 / 3, 1e-12);
  close(midpointCdf.radius(0.5), 1 / 2);
  close(midpointCdf.midpoint(0.5), 1 / 4);
  assert.deepEqual(METHODS.map((m) => m.theory), [1 / 3, 1 / 2, 1 / 4]);
  for (const key of KEYS) { close(midpointCdf[key](0), 0); close(midpointCdf[key](1), 1, 1e-12); }
});

test("simulated chords have the midpoint distribution derived for each method", () => {
  for (const [i, key] of KEYS.entries()) {
    const r = rng(100 + i);
    const n = 200000;
    const below = { 0.2: 0, 0.5: 0, 0.8: 0 };
    let sumAngle = 0;
    for (let j = 0; j < n; j++) {
      const c = sample(key, r);
      for (const x of [0.2, 0.5, 0.8]) if (c.m <= x) below[x]++;
      sumAngle += Math.cos(c.phi);
    }
    for (const x of [0.2, 0.5, 0.8]) close(below[x] / n, midpointCdf[key](x), 0.005);
    close(sumAngle / n, 0, 0.01);   // no preferred direction
  }
});

test("a run converges on each method's own answer and is reproducible", () => {
  const run = createRun(7).add(200000);
  for (const m of METHODS) {
    assert.equal(run.data[m.key].n, 200000);
    close(run.share(m.key), m.theory, 4 * standardError(m.theory, 200000));
  }
  const a = createRun(7).add(500), b = createRun(7).add(200).add(300), c = createRun(8).add(500);
  for (const key of KEYS) {
    assert.equal(a.data[key].long, b.data[key].long);   // the same seed gives the same chords however they are batched
    assert.deepEqual(a.data[key].track, b.data[key].track);
  }
  assert.notDeepEqual(KEYS.map((k) => a.data[k].long), KEYS.map((k) => c.data[k].long));
});

test("a run keeps a bounded tail of chords and a thinned track", () => {
  const run = createRun(3, { keep: 100 });
  assert.equal(run.share("radius"), null);
  assert.deepEqual(run.data.radius.track, []);
  run.add(1);
  assert.equal(run.data.radius.n, 1);
  assert.deepEqual(run.data.radius.track[0][0], 1);
  run.add(5000);
  const d = run.data.endpoints;
  assert.equal(d.n, 5001);
  assert.equal(d.recent.length, 100);
  assert.ok(d.track.length < 300 && d.track.length > 50);
  for (let i = 1; i < d.track.length; i++) assert.ok(d.track[i][0] > d.track[i - 1][0]);
  assert.ok(d.track.every(([, share]) => share >= 0 && share <= 1));
});

test("standard error", () => {
  close(standardError(0.5, 100), 0.05);
  close(standardError(0.25, 10000), Math.sqrt(0.1875) / 100);
  assert.ok(Number.isNaN(standardError(0.5, 0)));
});

test("crossing a smaller circle: hand-computed cases", () => {
  const inner = { x: 0.5, y: 0, r: 0.4 };
  // A vertical chord at x = 0.5 passes through the small centre: a diameter of the small circle.
  assert.deepEqual(crossing(chord(0.5, 0), inner), { hits: true, long: true });
  // At x = 0.75 it is 0.25 from the small centre: inside, but further than half the small radius.
  assert.deepEqual(crossing(chord(0.75, 0), inner), { hits: true, long: false });
  // At x = 0.05 it is 0.45 away and misses.
  assert.deepEqual(crossing(chord(0.05, 0), inner), { hits: false, long: false });
  // A horizontal chord through the origin passes through the small centre too.
  assert.deepEqual(crossing(chord(0, Math.PI / 2), inner), { hits: true, long: true });
  assert.throws(() => innerTest("radius", { x: 0.8, y: 0, r: 0.4 }, 10), /inside/);
  assert.throws(() => innerTest("radius", { x: 0, y: 0, r: 0 }, 10), /inside/);
  assert.equal(innerTest("radius", inner, 0).share, null);
});

test("Jaynes's test: only the random-radius method gives a small circle the answer it gives the big one", () => {
  const n = 200000;
  for (const inner of [{ x: 0.5, y: 0, r: 0.4 }, { x: 0, y: 0, r: 0.4 }, { x: -0.2, y: 0.3, r: 0.6 }, { x: 0.1, y: -0.7, r: 0.15 }]) {
    const t = innerTest("radius", inner, n, 11);
    close(t.share, 0.5, 4 * standardError(0.5, t.hits));
    close(t.hits / n, inner.r, 0.005);   // the chance of crossing a convex shape is proportional to its perimeter
  }
  const inner = { x: 0.5, y: 0, r: 0.4 };
  const e = innerTest("endpoints", inner, n, 11), m = innerTest("midpoint", inner, n, 11);
  assert.ok(Math.abs(e.share - 1 / 3) > 0.1, `endpoints ${e.share}`);
  assert.ok(Math.abs(m.share - 1 / 4) > 0.1, `midpoint ${m.share}`);
  // The midpoint method survives a change of size alone (a concentric circle) but not a change of position.
  close(innerTest("midpoint", { x: 0, y: 0, r: 0.4 }, n, 11).share, 0.25, 0.01);
  assert.ok(Math.abs(innerTest("endpoints", { x: 0, y: 0, r: 0.4 }, n, 11).share - 1 / 3) > 0.1);
});

test("the exact small-circle answer agrees with closed forms worked out by hand", () => {
  // Random radius: every circle sees uniform distances, so the answer is 1/2 and the chance of crossing is the radius.
  for (const inner of [{ x: 0.5, y: 0, r: 0.4 }, { x: 0, y: 0, r: 0.4 }, { x: -0.2, y: 0.3, r: 0.6 }, { x: 0.1, y: -0.7, r: 0.15 }, { x: 0.8, y: 0, r: 0.15 }]) {
    const e = innerExact("radius", inner);
    close(e.share, 0.5, 1e-12);
    close(e.crossing, inner.r, 1e-12);
  }
  // A shared centre: P(m < r/2) / P(m < r), which is arcsin(r/2) / arcsin(r) for endpoints and (r/2)^2 / r^2 = 1/4 for midpoints.
  close(innerExact("endpoints", { x: 0, y: 0, r: 0.4 }).share, Math.asin(0.2) / Math.asin(0.4), 1e-12);
  close(innerExact("midpoint", { x: 0, y: 0, r: 0.4 }).share, 0.25, 1e-12);
  close(innerExact("midpoint", { x: 0, y: 0, r: 0.4 }).crossing, 0.16, 1e-12);
  // Midpoints, centre moved by a < r/2: averaging (c + h)^2 over the direction gives a^2/2 + h^2, so the answer is
  // (a^2/2 + r^2/4) / (a^2/2 + r^2). With a = 0.05 and r = 0.6 that is 0.09125 / 0.36125.
  close(innerExact("midpoint", { x: 0.05, y: 0, r: 0.6 }).share, 0.09125 / 0.36125, 1e-9);
  close(innerExact("midpoint", { x: 0, y: -0.05, r: 0.6 }).share, 0.09125 / 0.36125, 1e-9);   // the direction of the move does not matter
  assert.throws(() => innerExact("radius", { x: 0.8, y: 0, r: 0.4 }), /inside/);
  assert.throws(() => innerExact("nope", { x: 0, y: 0, r: 0.4 }), /unknown method/);
});

test("the exact small-circle answer agrees with simulation", () => {
  for (const inner of [{ x: 0.5, y: 0, r: 0.4 }, { x: -0.2, y: 0.3, r: 0.6 }, { x: 0.05, y: 0, r: 0.2 }]) {
    for (const key of KEYS) {
      const e = innerExact(key, inner), t = innerTest(key, inner, 200000, 5);
      close(t.share, e.share, 4 * standardError(e.share, t.hits));
      close(t.hits / 200000, e.crossing, 4 * standardError(e.crossing, 200000));
    }
  }
});

test("the verdict comes from the exact answer, so sampling error cannot mislabel a method", () => {
  // Every position of the page's two sliders: radius 0.15 to 0.6 and distance 0 to 0.8 in steps of 0.05, kept inside the big circle.
  for (let ri = 3; ri <= 12; ri++) for (let oi = 0; oi <= 16; oi++) {
    if (oi + ri > 19) continue;
    const inner = { x: oi / 20, y: 0, r: ri / 20 };
    assert.equal(keepsAnswer("radius", inner), true, JSON.stringify(inner));
    assert.equal(keepsAnswer("midpoint", inner), oi === 0, JSON.stringify(inner));
    assert.equal(keepsAnswer("endpoints", inner), false, JSON.stringify(inner));
  }
  // The case a three-standard-error rule got wrong: 0.05 off centre the midpoint answer has moved (to 25.6%),
  // but a sample of 50,000 chords cannot tell it from 25%.
  const near = { x: 0.05, y: 0, r: 0.4 };
  const t = innerTest("midpoint", near, 50000, 20);
  assert.ok(Math.abs(t.share - 0.25) < 3 * standardError(0.25, t.hits));
  assert.equal((innerExact("midpoint", near).share * 100).toFixed(1), "25.6");
  assert.equal(keepsAnswer("midpoint", near), false);
});

test("the finding: 100,000 chords per method with seed 20, and the small-circle test", () => {
  const run = createRun(20).add(100000);
  assert.equal((run.share("endpoints") * 100).toFixed(1), "33.1");
  assert.equal((run.share("radius") * 100).toFixed(1), "50.1");
  assert.equal((run.share("midpoint") * 100).toFixed(1), "25.2");
  // Pressing "Draw 100,000" without "Start again" first adds to the 300 chords drawn on load; the rounded shares are the same.
  const loaded = createRun(20).add(300).add(100000);
  assert.deepEqual(KEYS.map((k) => (loaded.share(k) * 100).toFixed(1)), ["33.1", "50.1", "25.2"]);
  const inner = { x: 0.5, y: 0, r: 0.4 };   // the small circle the page opens with
  assert.deepEqual(KEYS.map((k) => (innerExact(k, inner).share * 100).toFixed(1)), ["47.7", "50.0", "46.2"]);
  assert.deepEqual(KEYS.map((k) => keepsAnswer(k, inner)), [false, true, false]);
  // The page's sample uses 50,000 chords per method and the same seed.
  const shares = KEYS.map((k) => (innerTest(k, inner, 50000, 20).share * 100).toFixed(1));
  assert.deepEqual(shares, ["47.3", "50.3", "46.6"]);
});
