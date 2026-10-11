import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  BIG, LIMITS, PRESETS, makeModel, blankModel, clone, addGroup, removeGroup, addOption, removeOption, addOutcome, removeOutcome,
  probabilitySum, normalised, validate, expectedChange, evaluate, withEqualWeights, linesFor, flips, distance, sensitivity, mostFragile,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const preset = (key) => PRESETS.find((p) => p.key === key).model();

// Two groups, two options, small enough to do by hand.
//   Safe:  certain. A +2 each, B -1 each.
//   Risky: 0.25 -> A +10, B 0;  0.75 -> A 0, B +1.
// With A = 10 people (weight 1) and B = 30 people (weight 2):
//   Safe  = 1*10*2 + 2*30*(-1)   = 20 - 60  = -40
//   Risky = 1*10*2.5 + 2*30*0.75 = 25 + 45  = 70
const hand = () => makeModel({
  groups: [["A", 10, 1], ["B", 30, 2]],
  options: [["Safe", [["Certain", 1, [2, -1]]]], ["Risky", [["Win", 0.25, [10, 0]], ["Lose", 0.75, [0, 1]]]]],
});

test("expected utility matches a hand-computed case, step by step", () => {
  const m = hand();
  const [safe, risky] = m.options;
  close(expectedChange(risky, m.groups[0].id), 2.5);
  close(expectedChange(risky, m.groups[1].id), 0.75);
  const ev = evaluate(m);
  assert.deepEqual(ev.general, []);
  assert.deepEqual(ev.byOption, {});
  const r = ev.rows.find((x) => x.id === risky.id);
  assert.deepEqual(r.groups.map((g) => [g.perPerson, g.total, g.weighted]), [[2.5, 25, 25], [0.75, 22.5, 45]]);
  close(r.eu, 70);
  close(ev.rows.find((x) => x.id === safe.id).eu, -40);
  assert.equal(ev.best.name, "Risky");
  assert.equal(ev.runnerUp.name, "Safe");
  assert.equal(ev.tie, false);
});

test("each flip point is the exact crossing of two lines, and the choice really does change there", () => {
  const m = hand();
  const ev = evaluate(m);
  // In B's weight: Safe = 20 - 30w, Risky = 25 + 22.5w. Risky leads at w = 2; they cross at w = -5/52.5 < 0, so no flip.
  const [sa, sb] = sensitivity(m, ev);
  assert.deepEqual(linesFor(ev.rows, m.groups[1].id).map((l) => [l.intercept, l.slope]), [[20, -30], [25, 22.5]]);
  assert.equal(sb.below, null);
  assert.equal(sb.above, null);
  // In A's weight: Safe = -60 + 20w, Risky = 45 + 25w. Risky is steeper and ahead, so nothing overtakes above; they cross at w = -21.
  assert.equal(sa.above, null);
  assert.equal(sa.below, null);
  assert.equal(mostFragile([sa, sb]), null);

  // Cut A's gain under Risky so that Safe can catch up: Risky now gives A 0.5 each, so in B's weight
  // Risky = 5 + 22.5w and Safe = 20 - 30w, which are level at w = 15 / 52.5.
  m.options[1].outcomes[0].dw[m.groups[0].id] = 2;
  const s = sensitivity(m).find((x) => x.name === "B");
  close(s.below.at, 15 / 52.5);
  assert.equal(s.below.name, "Safe");
  // Just either side of the flip the top option differs.
  for (const [w, top] of [[s.below.at + 1e-6, "Risky"], [s.below.at - 1e-6, "Safe"]]) {
    m.groups[1].weight = w;
    assert.equal(evaluate(m).best.name, top);
  }
});

test("flips: the nearest crossing on each side, ties, parallel lines and the zero floor", () => {
  const L = (id, intercept, slope) => ({ id, name: id, index: 0, intercept, slope });
  // Leader at w0 = 1 is P (10). Q overtakes above at 3, R above at 2 (nearer). S overtakes below at 0.5, T below at 0.25.
  const lines = [L("P", 10, 0), L("Q", 4, 2), L("R", 6, 2), L("S", 11, -2), L("T", 10.5, -2)];
  const f = flips(lines, 1);
  assert.equal(f.leader, "P");
  assert.deepEqual([f.above.to, f.above.at], ["R", 2]);
  assert.deepEqual([f.below.to, f.below.at], ["S", 0.5]);
  // A parallel rival never crosses; a crossing at or below zero is not reported.
  assert.deepEqual(flips([L("P", 10, 1), L("Q", 3, 1)], 1), { leader: "P", above: null, below: null });
  assert.equal(flips([L("P", 10, 1), L("Q", 10, 0)], 1).below, null); // level only at w = 0
  assert.equal(flips([L("P", 10, 1), L("Q", 12, 0)], 5).below.at, 2);
  // A tie at the current weight: the earlier option leads, and the steeper one takes over at once.
  const tie = flips([L("P", 5, 0), L("Q", 3, 2)], 1);
  assert.equal(tie.leader, "P");
  assert.equal(tie.above.at, 1);
  assert.equal(flips([], 1), null);
});

test("random models: the reported flip is where the leader changes, and nothing changes before it", () => {
  const r = rng(7);
  let checked = 0;
  for (let trial = 0; trial < 200; trial++) {
    const groups = Array.from({ length: r.int(1, 4) }, (_, i) => [`G${i}`, r.int(1, 1000), Number(r.uniform(0.2, 3).toFixed(2))]);
    const options = Array.from({ length: r.int(2, 5) }, (_, i) => {
      const p = Number(r.uniform(0.1, 0.9).toFixed(2));
      return [`O${i}`, [["a", p, groups.map(() => r.int(-10, 10))], ["b", 1 - p, groups.map(() => r.int(-10, 10))]]];
    });
    const m = makeModel({ groups, options });
    for (const s of sensitivity(m)) {
      const g = m.groups.find((x) => x.id === s.id);
      const topAt = (w) => { const c = clone(m); c.groups.find((x) => x.id === s.id).weight = w; return evaluate(c).best.id; };
      for (const [f, dir] of [[s.above, 1], [s.below, -1]]) {
        if (!f || Math.abs(f.at - g.weight) < 1e-4) continue;
        const step = Math.abs(f.at - g.weight) * 1e-3;
        assert.equal(topAt(f.at - dir * step), s.leader, "the leader holds right up to the flip");
        assert.equal(topAt(f.at + dir * step), f.to, "the named option leads just past it");
        assert.equal(topAt((g.weight + f.at) / 2), s.leader, "and nothing changes on the way there");
        checked++;
      }
      if (!s.above) assert.equal(topAt(g.weight * 1000 + 1000), s.leader, "no flip above means the leader holds at a huge weight");
      if (!s.below) assert.equal(topAt(1e-9), topAt(g.weight) , "no flip below means the leader holds down to zero");
    }
  }
  assert.ok(checked > 200, `only ${checked} flips were checked`);
});

test("probabilities: sums, validation and rescaling", () => {
  const m = hand();
  const risky = m.options[1];
  close(probabilitySum(risky), 1);
  risky.outcomes[0].p = 0.15;
  const v = validate(m);
  assert.deepEqual(v.general, []);
  assert.equal(v.byOption[risky.id].canNormalise, true);
  close(v.byOption[risky.id].sum, 0.9);
  assert.match(v.byOption[risky.id].messages[0], /sum to 0\.9, not 1/);
  // The invalid option is left out; the other is still scored.
  const ev = evaluate(m);
  assert.deepEqual(ev.ranked.map((x) => x.name), ["Safe"]);
  assert.equal(ev.runnerUp, null);
  // Rescaling keeps the ratio 0.15 : 0.75 = 1 : 5.
  const p = normalised(risky);
  close(p[0], 1 / 6); close(p[1], 5 / 6); close(p[0] + p[1], 1);
  p.forEach((x, i) => { risky.outcomes[i].p = x; });
  assert.deepEqual(validate(m).byOption, {});
  // All zeros (or junk) rescale to equal shares.
  risky.outcomes.forEach((k) => { k.p = 0; });
  assert.deepEqual(normalised(risky), [0.5, 0.5]);
  risky.outcomes[0].p = NaN;
  risky.outcomes[1].p = -1;
  assert.deepEqual(normalised(risky), [0.5, 0.5]);
  assert.match(validate(m).byOption[risky.id].messages[0], /from 0 to 1/);
  assert.equal(validate(m).byOption[risky.id].canNormalise, false);
});

test("invalid and empty models give messages, never NaN", () => {
  const empty = makeModel();
  const ev = evaluate(empty);
  assert.equal(ev.general.length, 2);
  assert.equal(ev.best, null);
  assert.deepEqual(sensitivity(empty), []);
  assert.equal(mostFragile([]), null);

  const m = hand();
  m.groups[0].people = NaN;
  m.groups[1].weight = -1;
  const bad = evaluate(m);
  assert.equal(bad.general.length, 2);
  assert.match(bad.general[0], /^A: the number of people/);
  assert.match(bad.general[1], /^B: the moral weight/);
  assert.deepEqual(bad.rows, []);
  assert.deepEqual(sensitivity(m, bad), []);

  const n = hand();
  n.options[0].outcomes[0].dw[n.groups[0].id] = NaN;
  n.options[1].outcomes = [];
  const v = validate(n);
  assert.match(v.byOption[n.options[0].id].messages[0], /wellbeing change/);
  assert.match(v.byOption[n.options[1].id].messages[0], /no outcomes/);
  assert.equal(evaluate(n).best, null);

  // A group with nobody in it, or with zero weight, is allowed and contributes nothing.
  const z = hand();
  z.groups[1].weight = 0;
  close(evaluate(z).rows[0].eu, 20);
  for (const row of evaluate(z).rows) for (const g of row.groups) assert.ok(Number.isFinite(g.weighted));
});

test("editing keeps every outcome in step with the list of groups, and respects the limits", () => {
  const m = blankModel();
  assert.equal(evaluate(m).tie, true);
  assert.equal(evaluate(m).best.name, "Option 1");
  const g = addGroup(m);
  for (const o of m.options) for (const k of o.outcomes) assert.equal(k.dw[g.id], 0);
  removeGroup(m, m.groups[0].id);
  for (const o of m.options) for (const k of o.outcomes) assert.deepEqual(Object.keys(k.dw).sort(), m.groups.map((x) => x.id).sort());
  const o = addOption(m);
  assert.equal(o.outcomes.length, 1);
  assert.equal(o.outcomes[0].p, 1);
  const k = addOutcome(m, o.id); // nothing left to assign, so the new outcome starts at 0 and the option stays valid
  assert.equal(k.p, 0);
  assert.deepEqual(validate(m).byOption, {});
  removeOutcome(m, o.id, o.outcomes[0].id);
  assert.equal(validate(m).byOption[o.id].canNormalise, true);
  removeOption(m, o.id);
  assert.equal(m.options.length, 2);
  while (addGroup(m)) { /* fill */ }
  while (addOption(m)) { /* fill */ }
  while (addOutcome(m, m.options[0].id)) { /* fill */ }
  assert.deepEqual([m.groups.length, m.options.length, m.options[0].outcomes.length], [LIMITS.groups, LIMITS.options, LIMITS.outcomes]);
  assert.equal(new Set([...m.groups, ...m.options, ...m.options.flatMap((x) => x.outcomes)].map((x) => x.id)).size, LIMITS.groups + LIMITS.options + LIMITS.options + LIMITS.outcomes - 1);
  assert.equal(addOutcome(m, "no such option"), null);
});

test("a rival level with the leader now flips at exactly the current weight, whatever rounding does to the crossing", () => {
  // A = 0.1 x 3 x 1 = 0.30000000000000004 and B = 0.3 x 1 x 1 = 0.3: a tie. In the first group's weight the lines are
  // A = 3w and B = 0.3, which cross at 0.3 / 3 = 0.09999999999999999 in floating point, not at 0.1.
  const m = makeModel({ groups: [["G1", 3, 0.1], ["G2", 1, 0.3]], options: [["A", [["x", 1, [1, 0]]]], ["B", [["x", 1, [0, 1]]]]] });
  const ev = evaluate(m);
  assert.equal(ev.tie, true);
  assert.notEqual(0.3 / 3, 0.1);
  const [g1, g2] = sensitivity(m, ev);
  assert.equal(g1.leader, m.options[0].id);
  assert.equal(g1.below.at, 0.1);
  assert.equal(g1.below.name, "B");
  assert.equal(g1.distance, 0);
  assert.equal(g2.above.at, 0.3);
});

test("a three-way tie is reported as three options, and a clear winner as one", () => {
  const m = makeModel({ groups: [["G", 5, 1]], options: [["A", [["x", 1, [2]]]], ["B", [["x", 1, [2]]]], ["C", [["x", 0.5, [4]], ["y", 0.5, [0]]]], ["D", [["x", 1, [1]]]]] });
  const ev = evaluate(m);
  assert.deepEqual(ev.tied.map((r) => r.name), ["A", "B", "C"]);
  assert.equal(ev.tie, true);
  assert.deepEqual(evaluate(preset("vaccine")).tied.map((r) => r.name), ["Split the doses"]);
  assert.deepEqual(evaluate(makeModel()).tied, []);
});

test("numbers beyond a trillion are refused, so no score can overflow", () => {
  const m = hand();
  m.groups[0].people = BIG;
  m.groups[1].weight = BIG;
  m.options[0].outcomes[0].dw[m.groups[1].id] = -BIG;
  const ok = evaluate(m);
  assert.deepEqual([ok.general, ok.byOption], [[], {}]);
  assert.ok(ok.rows.every((r) => Number.isFinite(r.eu)));
  close(ok.rows[0].eu, 2 * BIG - 30 * BIG * BIG, 1e12);
  m.groups[0].people = BIG * 10;
  assert.match(evaluate(m).general[0], /^A: the number of people must be a number from 0 to a trillion/);
  m.groups[0].people = 10;
  m.groups[1].weight = 1e300;
  assert.match(evaluate(m).general[0], /^B: the moral weight must be a number from 0 to a trillion/);
  m.groups[1].weight = 2;
  m.options[1].outcomes[0].dw[m.groups[0].id] = 1e300;
  const bad = evaluate(m);
  assert.match(bad.byOption[m.options[1].id].messages[0], /between minus a trillion and a trillion/);
  assert.deepEqual(bad.ranked.map((r) => r.name), ["Safe"]);
});

test("distance treats a halving and a doubling alike", () => {
  close(distance(1, 2), 0.5);
  close(distance(1, 0.5), 0.5);
  assert.equal(distance(1, 1), 0);
  assert.equal(distance(0, 3), 1);
  assert.equal(distance(0, 0), 0);
});

test("the finding: in the vaccine example the split wins, and flips at 1.45 and 0.58 on the over-80s' weight", () => {
  const m = preset("vaccine");
  const ev = evaluate(m);
  assert.deepEqual(ev.ranked.map((r) => r.name), ["Split the doses", "Oldest first", "Care workers first"]);
  close(ev.ranked[0].eu, 183000, 1e-6);
  close(ev.ranked[1].eu, 168000, 1e-6);
  close(ev.ranked[2].eu, 160000, 1e-6);
  const sens = sensitivity(m, ev);
  const old = sens.find((s) => s.name === "Over-80s");
  close(old.above.at, 48000 / 33000, 1e-9);
  assert.equal(old.above.name, "Oldest first");
  close(old.below.at, 32000 / 55000, 1e-9);
  assert.equal(old.below.name, "Care workers first");
  assert.equal(old.above.at.toFixed(2), "1.45");
  assert.equal(old.below.at.toFixed(2), "0.58");
  assert.equal(mostFragile(sens).name, "Over-80s");
  // The lines quoted in the write-up.
  const lines = Object.fromEntries(old.lines.map((l) => [l.name, [Math.round(l.intercept), Math.round(l.slope)]]));
  assert.deepEqual(lines, { "Oldest first": [0, 168000], "Care workers first": [80000, 80000], "Split the doses": [48000, 135000] });
});

test("the other examples behave as their descriptions say", () => {
  // Bus lane: a bus passenger counted 12% more than a driver is enough to make the all-day lane win.
  const bus = sensitivity(preset("buslane"));
  const riders = bus.find((s) => s.name === "Bus passengers");
  close(riders.above.at, 668 / 594, 1e-9);
  assert.equal(riders.above.name, "Bus lane all day");
  assert.equal(riders.below.name, "Leave the road as it is");
  // Future generations: fast cuts win unless people in 2100 count for less than about 0.27 of people today.
  const fut = preset("future");
  assert.equal(evaluate(fut).best.name, "Cut emissions fast");
  close(sensitivity(fut).find((s) => s.name === "People alive in 2100").below.at, 6.4 / 23.4, 1e-9);
  // Transmitter room: Jones loses 10 points, a billion viewers lose 0.0001 each (100,000 in all). The sum says
  // wait, unless Jones's wellbeing counts 10,000 times as much as a viewer's.
  const tr = preset("transmitter");
  const ev = evaluate(tr);
  assert.equal(ev.best.name, "Wait until the match ends");
  close(ev.best.eu, -10); close(ev.runnerUp.eu, -100000, 1e-6);
  const [jones, viewers] = sensitivity(tr, ev);
  close(jones.above.at, 10000, 1e-6);
  assert.equal(jones.below, null);
  close(viewers.below.at, 0.0001, 1e-12);
  assert.equal(viewers.above, null);
  // Every example is valid as shipped and already has equal weights.
  for (const p of PRESETS) {
    const m = p.model();
    const e = evaluate(m);
    assert.deepEqual([e.general, e.byOption], [[], {}], p.key);
    assert.equal(evaluate(withEqualWeights(m)).best.id, e.best.id);
  }
});
