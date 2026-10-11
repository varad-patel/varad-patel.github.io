import test from "node:test";
import assert from "node:assert/strict";
import { KINDS, PARTS, N, VIEWS, ORDERS, weights, makeOrder, isOrder, promote, trajectory, breaks, roughest, matchMark, hobbesTension, keelTippingGamma, describeParts } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const sum = (a) => a.reduce((s, x) => s + x, 0);

test("the ship has 46 parts and the keel is the last to wear out", () => {
  assert.equal(N, 46);
  assert.equal(sum(KINDS.map((k) => k.count)), 46);
  assert.deepEqual(PARTS.map((p) => p.id), [...Array(46).keys()]);
  assert.equal(PARTS[0].label, "oar 1");
  assert.equal(PARTS[45].label, "the keel");
  assert.equal(PARTS.filter((p) => p.kind === "plank").length, 24);
});

test("weights are base importance to the power gamma", () => {
  assert.ok(weights(0).every((w) => w === 1));
  close(sum(weights(1)), 15 * 0.5 + 5 + 2 + 2 + 24 + 8 + 5 + 5 + 20); // 78.5
  assert.equal(weights(2)[45], 400);
  assert.equal(weights(2)[0], 0.25);
  // Bad input falls back to gamma = 1; out-of-range values are clamped.
  assert.deepEqual(weights(NaN), weights(1));
  assert.deepEqual(weights(-5), weights(0));
  assert.deepEqual(weights(99), weights(3));
});

test("orders are permutations, and the random one is fixed by its seed", () => {
  for (const o of ORDERS) assert.ok(isOrder(makeOrder(o.value, 3)), o.value);
  assert.deepEqual(makeOrder("wear"), [...Array(46).keys()]);
  assert.equal(makeOrder("frame")[0], 45);
  assert.deepEqual(makeOrder("random", 11), makeOrder("random", 11));
  assert.notDeepEqual(makeOrder("random", 11), makeOrder("random", 12));
  assert.deepEqual(makeOrder("nonsense"), makeOrder("wear"));
  assert.equal(isOrder([1, 2, 3]), false);
  assert.equal(isOrder(Array(46).fill(0)), false);
  assert.equal(isOrder(null), false);
});

test("promote moves a part to the front of what is left and never touches what has gone", () => {
  const order = makeOrder("wear");
  const next = promote(order, 3, 45);
  assert.ok(isOrder(next));
  assert.deepEqual(next.slice(0, 5), [0, 1, 2, 45, 3]);
  assert.equal(promote(order, 3, 1), order);   // already replaced
  assert.equal(promote(order, 3, 99), order);  // no such part
  assert.deepEqual(promote(order, 3, 3), order);
});

test("trajectory: hand-computed shares with equal weights and with the base weights", () => {
  const flat = trajectory(makeOrder("wear"), weights(0));
  assert.equal(flat.length, 47);
  assert.deepEqual(flat[0], { t: 0, part: null, count: 1, weighted: 1, step: 0 });
  close(flat[23].count, 0.5);
  close(flat[23].weighted, 0.5);
  close(flat[1].step, 1 / 46);
  assert.equal(flat[46].count, 0);
  assert.equal(flat[46].weighted, 0);
  for (const r of flat) close(r.count, r.weighted, 1e-12);

  const t = trajectory(makeOrder("wear"), weights(1));
  close(t[15].weighted, 1 - 7.5 / 78.5);          // fifteen oars at 0.5 each
  close(t[16].weighted, 1 - 12.5 / 78.5);         // then the sail at 5
  close(t[45].weighted, 20 / 78.5);               // only the keel is left
  close(t[46].step, 20 / 78.5);
  assert.equal(t[46].part, 45);
  // Shares never rise, and the steps add up to the whole ship.
  for (let i = 1; i < t.length; i++) assert.ok(t[i].weighted <= t[i - 1].weighted && t[i].count < t[i - 1].count);
  close(sum(t.map((r) => r.step)), 1);
});

test("trajectory rejects a bad order or bad weights", () => {
  assert.throws(() => trajectory([0, 1, 2]), RangeError);
  assert.throws(() => trajectory(makeOrder("wear"), [1, 2, 3]), RangeError);
  assert.throws(() => trajectory(makeOrder("wear"), Array(46).fill(0)), RangeError);
});

test("breaks: where each view says the ship stops, for the default ship", () => {
  const b = breaks(trajectory(makeOrder("wear"), weights(1)));
  assert.deepEqual(b, { essentialism: 1, count: 23, weighted: 41, keel: 46, continuity: null, form: null });
  // By hand: oars, sail, steering oar and yard are 16.5 of 78.5. Half is 39.25, so 23 planks more: step 18 + 23.
  assert.equal(18 + 23, 41);
});

test("the finding: the order moves the weighted majority from step 41 to step 6, and a head count says 23 either way", () => {
  const worn = breaks(trajectory(makeOrder("wear"), weights(1)));
  const frame = breaks(trajectory(makeOrder("frame"), weights(1)));
  assert.equal(worn.weighted, 41);
  assert.equal(frame.weighted, 6);   // keel 20, stern 5, stem 5, mast 8, two planks: 40 of 78.5
  assert.equal(worn.count, 23);
  assert.equal(frame.count, 23);
  assert.equal(frame.keel, 1);
});

test("with equal weights the two majorities coincide whatever the order", () => {
  for (const seed of [1, 2, 3]) {
    const b = breaks(trajectory(makeOrder("random", seed), weights(0)));
    assert.equal(b.count, 23);
    assert.equal(b.weighted, 23);
  }
});

test("continuity breaks only when one part is half the ship", () => {
  assert.equal(keelTippingGamma(), 1.51);
  const smooth = trajectory(makeOrder("wear"), weights(1.5));
  assert.equal(breaks(smooth).continuity, null);
  assert.ok(roughest(smooth).step < 0.5);
  const rough = trajectory(makeOrder("wear"), weights(1.6));
  assert.equal(breaks(rough).continuity, 46);
  assert.equal(roughest(rough).part, 45);
  assert.equal(breaks(trajectory(makeOrder("frame"), weights(2))).continuity, 1);
  close(roughest(trajectory(makeOrder("wear"), weights(1))).step, 20 / 78.5);
});

test("matchMark: marks are mapped to the views that break nearby", () => {
  const b = breaks(trajectory(makeOrder("wear"), weights(1)));
  assert.deepEqual(matchMark(null, b), { kind: "none", views: [] });
  assert.deepEqual(matchMark(0, b).kind, "none");
  assert.deepEqual(matchMark(47, b).kind, "none");
  assert.deepEqual(matchMark(2.5, b).kind, "none");
  assert.deepEqual(matchMark(1, b), { kind: "match", views: [{ key: "essentialism", gap: 0 }] });
  assert.deepEqual(matchMark(2, b), { kind: "own", views: [] });   // essentialism means the very first change
  assert.deepEqual(matchMark(24, b), { kind: "match", views: [{ key: "count", gap: 1 }] });
  assert.deepEqual(matchMark(10, b), { kind: "own", views: [] });
  assert.deepEqual(matchMark(46, b), { kind: "match", views: [{ key: "keel", gap: 0 }] });
  assert.deepEqual(matchMark(42, b).views.map((v) => v.key), ["weighted"]);
  assert.deepEqual(matchMark("never", b).views.map((v) => v.key), ["form", "continuity"]);
  // When one change is too big for continuity, "never" is left to form and function alone, and nearest comes first.
  const heavy = breaks(trajectory(makeOrder("wear"), weights(2)));
  assert.deepEqual(matchMark("never", heavy).views.map((v) => v.key), ["form"]);
  assert.deepEqual(matchMark(46, heavy).views.map((v) => v.key), ["keel", "continuity", "weighted"]);
  // Views tied to one event match only on that step: marking the sail two steps after the keel is not a keel view.
  const frame = breaks(trajectory(makeOrder("frame"), weights(1)));
  assert.equal(frame.keel, 1);
  assert.deepEqual(matchMark(3, frame), { kind: "own", views: [] });
  assert.deepEqual(matchMark(1, frame).views.map((v) => v.key), ["essentialism", "keel"]);
  assert.deepEqual(matchMark(45, b), { kind: "own", views: [] });
  assert.deepEqual(matchMark(25, b, 0), { kind: "own", views: [] });
});

test("hobbesTension flags a mark and an answer that cannot both stand", () => {
  assert.equal(hobbesTension(30, "repaired"), true);
  assert.equal(hobbesTension("never", "repaired"), false);
  assert.equal(hobbesTension("never", "rebuilt"), true);
  assert.equal(hobbesTension("never", "neither"), true);
  assert.equal(hobbesTension(30, "rebuilt"), false);
  // "Both" says the repaired ship is the ship of Theseus too, so it clashes with a mark exactly as "repaired" does.
  assert.equal(hobbesTension(30, "both"), true);
  assert.equal(hobbesTension("never", "both"), false);
  assert.equal(hobbesTension(30, "neither"), false);
  assert.equal(hobbesTension(null, "repaired"), false);
  assert.equal(hobbesTension(30, undefined), false);
});

test("every threshold view has a break entry", () => {
  const b = breaks(trajectory(makeOrder("wear")));
  for (const v of VIEWS) if (v.key !== "fourD") assert.ok(v.key in b, v.key);
});

test("only essentialism and four-dimensionalism are presented as positions from the literature", () => {
  assert.deepEqual(VIEWS.filter((v) => !v.own).map((v) => v.key), ["essentialism", "fourD"]);
  assert.equal(VIEWS.filter((v) => v.own).length, 5);
});

test("just under half is not half: at gamma 1.5 the keel is 49.5% of the ship and continuity does not break", () => {
  // By hand: keel 20^1.5 = 89.443 of a total 180.571 (oars 5.303, sail and posts 33.541, yard and steering oar 5.657, planks 24, mast 22.627).
  const t = trajectory(makeOrder("wear"), weights(1.5));
  close(roughest(t).step, 89.4427191 / 180.5713, 1e-6);
  assert.equal(breaks(t).continuity, null);
  // With the frame first, half the weight has not quite gone after five replacements (39 of 78.5) and has after six (40 of 78.5).
  const f = trajectory(makeOrder("frame"), weights(1));
  close(f[5].weighted, 1 - 39 / 78.5);
  close(f[6].weighted, 1 - 40 / 78.5);
  assert.ok(f[5].weighted > 0.5 && f[6].weighted < 0.5);
});

test("describeParts puts the drawing into words", () => {
  assert.deepEqual(describeParts([]), []);
  assert.deepEqual(describeParts([0, 1, 15, 45]), ["2 of 15 oars", "the sail", "the keel"]);
  assert.deepEqual(describeParts(makeOrder("wear").slice(0, 21)), ["all 15 oars", "the sail", "the steering oar", "the yard", "3 of 24 planks"]);
  assert.equal(describeParts(makeOrder("random", 5)).length, KINDS.length);
});
