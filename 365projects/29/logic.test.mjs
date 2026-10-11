import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  LIMITS, PRESETS, blankTree, sanitise, plain, walk, find, size, addChild, removeNode, setType, normalise,
  validate, worth, rollback, planSteps, parameters, spread, thresholds, sensitivity, curve,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const preset = (key) => PRESETS.find((p) => p.key === key).tree();
const byName = (root, name) => { let hit = null; walk(root, (n) => { if (n.name === name && !hit) hit = n; }); return hit; };
const D = (name, ...children) => ({ type: "decision", name, children });
const C = (name, ...children) => ({ type: "chance", name, children });
const E = (name, value, p) => ({ type: "end", name, value, p });

test("rollback matches the job example worked by hand", () => {
  const t = preset("job");
  const r = rollback(t);
  const v = (name) => r.values.get(byName(t, name).id);
  close(v("Hold the shares"), 0.5 * 100 + 0.5 * 55); // 77.5
  close(v("The start-up takes off"), 80); // selling (80) beats holding (77.5)
  close(v("Accept the offer"), 0.3 * 80 + 0.7 * 30); // 45
  close(v("Stay where you are"), 0.6 * 65 + 0.4 * 40); // 55
  close(r.value, 55);
  assert.equal(r.best.get(t.id), byName(t, "Stay where you are").id);
  assert.equal(r.best.get(byName(t, "The start-up takes off").id), byName(t, "Sell the shares early").id);
  // The plan is the root, the chosen option and everything chance can then do. The rejected option is not on it.
  const onPlan = [...r.plan].map((id) => find(t, id).node.name).sort();
  assert.deepEqual(onPlan, ["Passed over", "Promoted within two years", "Stay where you are", "Take the start-up job?"]);
  assert.deepEqual(planSteps(t, r).map((s) => [s.at.name, s.choose.name]), [["Take the start-up job?", "Stay where you are"]]);
});

test("a later decision on the plan is reported as a step, and a tie goes to the earlier branch", () => {
  const t = preset("insurance");
  byName(t, "Buy the policy").value = 90; // now going without wins, and its later decision is on the plan
  const r = rollback(t);
  assert.deepEqual(planSteps(t, r).map((s) => [s.at.name, s.choose.name]),
    [["Insure the house against flooding?", "Go without"], ["A flood, and no cover", "Borrow to rebuild"]]);
  close(r.value, 0.03 * 25 + 0.97 * 100);
  const tie = sanitise(D("?", E("First", 5), E("Second", 5)));
  assert.equal(rollback(tie).best.get(tie.id), tie.children[0].id);
});

test("each flip point matches the algebra for the job example", () => {
  const t = preset("job");
  const rows = Object.fromEntries(sensitivity(t).map((s) => [`${s.kind}:${s.name}`, s]));
  const accept = byName(t, "Accept the offer").id;
  // Chance x of taking off: 80x + 30(1 - x) = 55  ->  x = 0.5
  close(rows["p:The start-up takes off"].above.at, 0.5);
  assert.equal(rows["p:The start-up takes off"].above.to, accept);
  assert.equal(rows["p:The start-up takes off"].below, null);
  // Utility x of folding: 0.3*80 + 0.7x = 55  ->  x = 31/0.7
  close(rows["value:The start-up folds"].above.at, 31 / 0.7);
  // Utility x of promotion: 0.6x + 16 = 45  ->  x = 29/0.6. Staying leads, so it flips as x falls.
  close(rows["value:Promoted within two years"].below.at, 29 / 0.6);
  assert.equal(rows["value:Promoted within two years"].above, null);
  close(rows["value:Passed over"].below.at, 15);
  close(rows["p:Promoted within two years"].below.at, 0.2); // 40 + 25x = 45
  // Selling at x: 0.3*max(x, 77.5) + 21 = 55  ->  x = 34/0.3
  close(rows["value:Sell the shares early"].above.at, 34 / 0.3);
  // Floating at x only matters once holding beats selling: 0.3*(0.5x + 27.5) + 21 = 55  ->  x = 2*(34/0.3 - 27.5)
  close(rows["value:It floats on the stock market"].above.at, 2 * (34 / 0.3 - 27.5), 1e-8);
  close(rows["value:Growth stalls"].above.at, 2 * (34 / 0.3 - 50), 1e-8);
  // The chance of floating cannot flip it: even at 1, holding is worth 100 and accepting 0.3*100 + 21 = 51 < 55.
  assert.equal(rows["p:It floats on the stock market"].nearest, null);
  assert.equal(rows["p:It floats on the stock market"].distance, Infinity);
  // A two-branch chance node is listed once, by its first branch.
  assert.equal(rows["p:The start-up folds"], undefined);
  assert.equal(sensitivity(t).length, 9);
});

test("a probability with two siblings rescales them in proportion", () => {
  const t = preset("medical");
  const death = byName(t, "Death in surgery"); // under "Operate now": 0.85 / 0.10 / 0.05
  const op = byName(t, "Operate now");
  // At x the others become 0.85(1-x)/0.95 and 0.10(1-x)/0.95, so operating is worth (1-x) * 86.25/0.95.
  close(worth(op, { kind: "p", id: death.id, x: 0.2 }), (0.8 * 86.25) / 0.95);
  close(worth(op, { kind: "p", id: death.id, x: 0.05 }), 86.25);
  const row = sensitivity(t).find((s) => s.kind === "p" && s.id === death.id);
  close(row.above.at, 1 - (78.75 * 0.95) / 86.25); // 0.1326...
  assert.equal(row.above.to, byName(t, "Wait and monitor").id);
  // A sibling that holds all the probability shares what is left equally among the rest.
  const one = sanitise(D("?", C("A", E("x", 10, 1), E("y", 4, 0), E("z", 0, 0)), E("B", 5)));
  close(worth(one.children[0], { kind: "p", id: one.children[0].children[0].id, x: 0.5 }), 0.5 * 10 + 0.25 * 4 + 0.25 * 0);
});

test("ties, single options and numbers that cannot matter", () => {
  // Level now: the flip is reported at exactly the current value, not a hair away from it.
  const tie = blankTree();
  const rows = sensitivity(tie);
  assert.deepEqual(rows.map((r) => r.nearest.at), [0, 0]);
  assert.deepEqual(rows.map((r) => r.distance), [0, 0]);
  assert.equal(rows[0].nearest.to, tie.children[1].id); // lowering option 1, or raising option 2, puts option 2 ahead
  // One option: nothing to flip.
  const solo = sanitise(D("?", C("Only", E("a", 1, 0.5), E("b", 2, 0.5))));
  assert.ok(sensitivity(solo).every((r) => r.nearest === null));
  // An end point reached with probability zero can never matter, however large its utility.
  const dead = sanitise(D("?", C("A", E("never happens", 0, 0), E("always", 1, 1)), E("B", 2)));
  const never = sensitivity(dead).find((r) => r.name === "never happens" && r.kind === "value");
  assert.equal(never.nearest, null);
  // A leading option's unused ending can fall for ever without changing anything.
  const unused = sanitise(D("?", D("A", E("good", 10), E("bad", 1)), E("B", 5)));
  assert.equal(sensitivity(unused).find((r) => r.name === "bad").nearest, null);
  close(sensitivity(unused).find((r) => r.name === "good").below.at, 5);
  // A dead heat goes to the earlier option. If A cannot fall below an earlier rival's value but can fall to it, that
  // is a flip; against a later rival it is not.
  const floorAfter = sanitise(D("?", E("B", 5), D("A", E("good", 10), E("floor", 5))));
  assert.equal(sensitivity(floorAfter).find((r) => r.name === "good").below.at, 5);
  const floorBefore = sanitise(D("?", D("A", E("good", 10), E("floor", 5)), E("B", 5)));
  assert.equal(sensitivity(floorBefore).find((r) => r.name === "good").nearest, null);
});

// Random trees with a decision at the root.
function randomTree(r) {
  const grow = (depth) => {
    const roll = r();
    if (depth >= 3 || roll < 0.35) return { type: "end", name: "e", value: r.int(0, 100) };
    const n = r.int(2, 3);
    if (roll < 0.7) {
      const cuts = Array.from({ length: n }, () => r.int(1, 9));
      const sum = cuts.reduce((s, c) => s + c, 0);
      return { type: "chance", name: "c", children: cuts.map((c) => ({ ...grow(depth + 1), p: c / sum })) };
    }
    return { type: "decision", name: "d", children: Array.from({ length: n }, () => grow(depth + 1)) };
  };
  return sanitise({ type: "decision", name: "root", children: Array.from({ length: r.int(2, 3) }, () => grow(1)) });
}

test("random trees: the first choice changes exactly at the reported flip, and nowhere before it", () => {
  const r = rng(29);
  let flips = 0, nevers = 0;
  for (let trial = 0; trial < 150; trial++) {
    const t = randomTree(r);
    assert.deepEqual(validate(t), []);
    const choiceAt = (row, x) => {
      const vals = t.children.map((o) => worth(o, { kind: row.kind, id: row.id, x }));
      let top = 0;
      vals.forEach((v, i) => { if (v > vals[top]) top = i; });
      return t.children[top].id;
    };
    for (const row of sensitivity(t)) {
      assert.equal(choiceAt(row, row.now), row.leader);
      const set = [row.below, row.above].filter(Boolean);
      assert.ok(set.length <= 1, "at most one flip for each number");
      if (!set.length) {
        // No flip: scan the whole range (a wide one for utilities) and check the choice never changes.
        const [lo, hi] = row.kind === "p" ? [0, 1] : [row.now - 1e6, row.now + 1e6];
        for (let i = 0; i <= 400; i++) assert.equal(choiceAt(row, lo + ((hi - lo) * i) / 400), row.leader, `trial ${trial}: ${row.key} changes the choice but no flip was reported`);
        nevers++;
        continue;
      }
      const f = set[0];
      if (f.at === row.now) continue; // level now: covered by its own test
      const gap = f.at - row.now;
      assert.equal(choiceAt(row, row.now + gap * (1 - 1e-6)), row.leader, "unchanged just short of the flip");
      assert.equal(choiceAt(row, row.now + gap * (1 + 1e-6) + Math.sign(gap) * 1e-9), f.to, "changed just past it");
      for (let i = 1; i < 60; i++) assert.equal(choiceAt(row, row.now + (gap * i) / 60), row.leader, "and unchanged all the way there");
      if (row.kind === "p") assert.ok(f.at >= 0 && f.at <= 1);
      flips++;
    }
  }
  assert.ok(flips > 300 && nevers > 100, `checked ${flips} flips and ${nevers} numbers with none`);
});

test("sensitivity is sorted from most to least fragile, with distance as a share of the scale", () => {
  const t = preset("job");
  const rows = sensitivity(t);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].distance <= rows[i].distance);
  assert.deepEqual(spread(t), { lo: 30, hi: 100, range: 70 });
  close(rows[0].distance, 0.2); // probability: 0.3 -> 0.5
  close(rows[1].distance, (31 / 0.7 - 30) / 70); // utility: 30 -> 44.29 on a scale 70 wide
  assert.equal(rows[0].name, "The start-up takes off");
  // Rescaling every utility leaves the order and the distances alone.
  const scaled = preset("job");
  walk(scaled, (n) => { if (n.type === "end") n.value = n.value * 12 - 500; });
  const again = sensitivity(scaled);
  assert.deepEqual(again.map((s) => s.key), rows.map((s) => s.key));
  again.forEach((s, i) => { if (Number.isFinite(s.distance)) close(s.distance, rows[i].distance, 1e-9); });
});

test("curve: the varied option moves, the others are flat, and the lines cross at the flip", () => {
  const t = preset("job");
  const row = sensitivity(t)[0];
  const c = curve(t, row, 0, 1, 100);
  assert.equal(c.xs.length, 101);
  const [accept, stay] = c.series;
  assert.ok(stay.ys.every((y) => y === 55));
  close(accept.ys[0], 30); close(accept.ys[50], 55); close(accept.ys[100], 80);
});

test("validation: what stops a rollback, and rescaling", () => {
  const t = preset("job");
  assert.deepEqual(validate(t), []);
  const off = byName(t, "The start-up takes off");
  const accept = byName(t, "Accept the offer");
  off.p = 0.2;
  let v = validate(t);
  assert.equal(v.length, 1);
  assert.equal(v[0].id, accept.id);
  close(v[0].sum, 0.9);
  assert.match(v[0].message, /“Accept the offer”: the probabilities sum to 0\.9, not 1/);
  assert.equal(normalise(t, accept.id), true);
  close(off.p, 2 / 9); close(byName(t, "The start-up folds").p, 7 / 9);
  assert.deepEqual(validate(t), []);
  off.p = NaN;
  v = validate(t);
  assert.match(v[0].message, /every probability must be a number from 0 to 1/);
  assert.equal(v[0].sum, undefined);
  normalise(t, accept.id); // junk counts as zero, so the other branch takes everything
  assert.deepEqual([off.p, byName(t, "The start-up folds").p], [0, 1]);
  byName(t, "Passed over").value = NaN;
  byName(t, "Hold the shares").children = [];
  const messages = validate(t).map((p) => p.message);
  assert.equal(messages.length, 2);
  assert.ok(messages.some((m) => /“Hold the shares” has no branches/.test(m)));
  assert.ok(messages.some((m) => /“Passed over”: the utility must be a number/.test(m)));
  assert.equal(normalise(t, "nope"), false);
  assert.equal(normalise(t, byName(t, "Passed over").id), false);
});

test("editing: adding, removing and changing the type of nodes", () => {
  const t = preset("job");
  const before = rollback(t).value;
  const stay = byName(t, "Stay where you are");
  // A new outcome takes the unassigned probability (none here), so the node stays valid and worth the same.
  const extra = addChild(t, stay.id);
  assert.deepEqual([extra.type, extra.p, extra.value, extra.name], ["end", 0, 0, "Outcome 3"]);
  assert.deepEqual(validate(t), []);
  close(rollback(t).value, before);
  assert.equal(removeNode(t, extra.id), true);
  assert.equal(removeNode(t, t.id), false);
  assert.equal(removeNode(t, "nope"), false);
  assert.equal(addChild(t, byName(t, "Passed over").id), null);

  // End point -> chance or decision keeps the value; back to an end point keeps it too.
  const folds = byName(t, "The start-up folds");
  assert.equal(setType(t, folds.id, "chance"), true);
  assert.deepEqual(folds.children.map((c) => [c.p, c.value]), [[0.5, 30], [0.5, 30]]);
  close(rollback(t).values.get(folds.id), 30);
  assert.equal(setType(t, folds.id, "decision"), true);
  close(rollback(t).values.get(folds.id), 30);
  folds.children[0].value = 50;
  assert.equal(setType(t, folds.id, "end"), true);
  assert.deepEqual([folds.children.length, folds.value], [0, 50]);
  // Decision -> chance shares probability equally.
  const off = byName(t, "The start-up takes off");
  setType(t, off.id, "chance");
  assert.deepEqual(off.children.map((c) => c.p), [0.5, 0.5]);
  assert.deepEqual(validate(t), []);
  // The root stays a decision; unknown ids and types do nothing.
  assert.equal(setType(t, t.id, "chance"), false);
  assert.equal(setType(t, "nope", "end"), false);
  assert.equal(setType(t, off.id, "banana"), false);
  // Turning an invalid branch into an end point gives it a utility of 0 and no NaN.
  off.children[0].children[0].value = NaN;
  setType(t, off.id, "end");
  assert.equal(off.value, 0);
  assert.deepEqual(validate(t), []);
});

test("limits: branches, depth and total nodes", () => {
  const t = blankTree();
  while (addChild(t, t.id)) { /* fill */ }
  assert.equal(t.children.length, LIMITS.children);
  // Grow a chain to the depth limit.
  let node = t.children[0], depth = 1;
  while (setType(t, node.id, "decision")) { node = node.children[0]; depth++; }
  assert.equal(depth, LIMITS.depth);
  assert.equal(size(t).depth, LIMITS.depth);
  // Fill the tree to the node limit: keep adding branches, and turning end points into decisions, until nothing more fits.
  let grew = true;
  while (grew) {
    grew = false;
    const nodes = [];
    walk(t, (n) => nodes.push(n));
    for (const n of nodes) if (n.type === "end" ? setType(t, n.id, "decision") : addChild(t, n.id)) grew = true;
  }
  assert.deepEqual(size(t), { nodes: LIMITS.nodes, depth: LIMITS.depth, ends: size(t).ends });
  assert.deepEqual(validate(t), []);
  const ids = [];
  walk(t, (n) => ids.push(n.id));
  assert.equal(new Set(ids).size, LIMITS.nodes);
  assert.doesNotThrow(() => sanitise(JSON.parse(JSON.stringify(plain(t)))));
});

test("sanitise: files round-trip, and bad files are refused with a reason", () => {
  for (const p of PRESETS) {
    const t = p.tree();
    assert.deepEqual(validate(t), [], p.key);
    const back = sanitise(JSON.parse(JSON.stringify(plain(t))));
    assert.deepEqual(plain(back), plain(t));
    close(rollback(back).value, rollback(t).value);
    assert.ok(size(t).depth >= 2, `${p.key} is at least two levels deep`);
  }
  // A blank number survives a save as "not a number", not as zero.
  const t = preset("job");
  byName(t, "Passed over").value = NaN;
  const back = sanitise(JSON.parse(JSON.stringify(plain(t))));
  assert.ok(Number.isNaN(byName(back, "Passed over").value));
  assert.equal(validate(back).length, 1);

  for (const junk of [null, 7, "tree", [], {}, { type: "end", name: "x", value: 1 }, { type: "decision" }]) assert.throws(() => sanitise(junk), /not a decision tree/);
  assert.throws(() => sanitise(D("?", { type: "banana", name: "x" })), /type "banana"/);
  assert.throws(() => sanitise(D("?", { type: "chance", name: "x", children: "many" })), /must be a list/);
  assert.throws(() => sanitise(D("?", ...Array.from({ length: 7 }, (_, i) => E(`o${i}`, i)))), /more than 6 branches/);
  let deep = E("leaf", 1);
  for (let i = 0; i < 8; i++) deep = D(`d${i}`, deep);
  assert.throws(() => sanitise(deep), /levels deep/);
  const wide = D("?", ...Array.from({ length: 6 }, (_, i) => D(`a${i}`, ...Array.from({ length: 6 }, (_, j) => D(`b${j}`, E("x", 1), E("y", 2))))));
  assert.throws(() => sanitise(wide), /more than 60 nodes/);
  // Names are text, and long ones are cut.
  const odd = sanitise(D("?", { type: "end", name: 42, value: "5" }, { type: "end", name: "n".repeat(200), value: 1 }));
  assert.equal(odd.children[0].name, "42");
  assert.ok(Number.isNaN(odd.children[0].value)); // a string is not a number
  assert.equal(odd.children[1].name.length, LIMITS.name);
  assert.deepEqual(parameters(odd).map((p) => p.kind), ["value", "value"]);
});

test("a lead of exactly one is not mistaken for a number that cannot matter", () => {
  // Found by an independent brute-force check in review. With options worth 2 and 1 the search for the leader's flip
  // took its first stride to x = 1, a dead heat, where the "has anything changed?" signal happened to equal its
  // starting value, and the page reported "never". The leader's utility flips the choice below 1.
  for (const [a, b] of [[2, 1], [1, 0], [6, 5], [-3, -4], [2.5, 1.5]]) {
    const t = sanitise(D("?", E("First", a), E("Second", b)));
    const rows = Object.fromEntries(sensitivity(t).map((s) => [s.name, s]));
    close(rows.First.below.at, b, 1e-9);
    assert.equal(rows.First.below.to, t.children[1].id);
    assert.equal(rows.First.above, null);
    close(rows.Second.above.at, a, 1e-9);
    assert.equal(rows.Second.below, null);
  }
  // The same with the leader second in the list, and with a lead of one inside a later decision.
  const t = sanitise(D("?", E("First", 1), D("Second", E("good", 2), E("spare", 0))));
  close(sensitivity(t).find((s) => s.name === "good").below.at, 1, 1e-9);
});

test("an end point reached with a tiny probability still has its flip found, and one with none has none", () => {
  // A leads 10 to 5. Its rare ending, reached with probability e, must fall to 10 - 5/e to pull A down to 5.
  // At e = 1e-17 a step in that ending moves A by less than rounding error, which once read as "never".
  for (const e of [1e-3, 1e-9, 1e-17]) {
    const t = sanitise(D("?", C("A", E("always", 10, 1 - e), E("rare", 0, e)), E("B", 5)));
    assert.deepEqual(validate(t), []);
    const row = sensitivity(t).find((r) => r.name === "rare" && r.kind === "value");
    assert.ok(Math.abs(row.below.at / (10 - 5 / e) - 1) < 1e-9, `${e}: ${row.below.at}`);
    // B trails 5 to 10 here, with the same rare ending under the trailing option: it must rise to 3 + 7/e.
    const u = sanitise(D("?", E("B", 10), C("A", E("always", 3, 1 - e), E("rare", 0, e))));
    const up = sensitivity(u).find((r) => r.name === "rare" && r.kind === "value");
    assert.ok(Math.abs(up.above.at / (3 + 7 / e) - 1) < 1e-9, `${e}: ${up.above.at}`);
  }
  const none = sanitise(D("?", C("A", E("always", 10, 1), E("rare", 0, 0)), E("B", 5)));
  assert.equal(sensitivity(none).find((r) => r.name === "rare" && r.kind === "value").nearest, null);
});

test("utilities have a size limit, probabilities a tolerance, and the first decision its own message", () => {
  const t = preset("job");
  byName(t, "Passed over").value = LIMITS.utility;
  assert.deepEqual(validate(t), []);
  byName(t, "Passed over").value = -LIMITS.utility * 1.0001;
  assert.match(validate(t)[0].message, /“Passed over”: the utility must be a number from -1,000,000,000 to 1,000,000,000\./);
  byName(t, "Passed over").value = 1e308;
  assert.equal(validate(t).length, 1);
  byName(t, "Passed over").value = 40;
  // Three probabilities typed as the page shows them, to six figures, are accepted; to three figures they are not.
  const thirds = (p) => sanitise(D("?", C("A", E("x", 1, p), E("y", 2, p), E("z", 3, p)), E("B", 0)));
  assert.deepEqual(validate(thirds(0.333333)), []);
  assert.equal(validate(thirds(0.333)).length, 1);
  // The first decision cannot be turned into an end point, so it is not told to be.
  const empty = sanitise(D("What now?"));
  assert.deepEqual(validate(empty).map((p) => p.message), ["“What now?” has no options. Add at least one."]);
  const hollow = sanitise(D("?", D("inner"), E("B", 1)));
  assert.match(validate(hollow)[0].message, /“inner” has no branches\. Add one, or turn it into an end point\./);
});

test("the finding: staying wins 55 to 45, flips at 0.5 or 44.3, and the top prize would need to be worth about 172", () => {
  const t = preset("job");
  const r = rollback(t);
  close(r.value, 55);
  close(r.values.get(byName(t, "Accept the offer").id), 45);
  assert.equal(find(t, r.best.get(t.id)).node.name, "Stay where you are");
  const rows = sensitivity(t);
  assert.deepEqual(rows.slice(0, 2).map((s) => [s.kind, s.name, Number(s.nearest.at.toFixed(2))]),
    [["p", "The start-up takes off", 0.5], ["value", "The start-up folds", 44.29]]);
  assert.equal(rows[1].nearest.at.toFixed(1), "44.3");
  assert.equal(Math.round(rows.find((s) => s.name === "It floats on the stock market" && s.kind === "value").nearest.at), 172);
  // "Most sensitive to two numbers": they are the two smallest distances, and the third is further off.
  assert.ok(rows[1].distance < rows[2].distance);
  assert.equal(spread(t).hi, 100);
});

test("the other examples say what their descriptions say", () => {
  // Insurance: buying wins by a quarter of a point, and a flood chance of 2.67% and not 3% flips it.
  const ins = preset("insurance");
  const r = rollback(ins);
  close(r.value, 98); close(r.values.get(byName(ins, "Go without").id), 97.75);
  const flood = sensitivity(ins).find((s) => s.kind === "p" && s.name === "A flood, and no cover");
  close(flood.below.at, 2 / 75); // 100 - 75x = 98
  // Medical: operating now wins 86.25 to 78.75.
  const med = preset("medical");
  const m = rollback(med);
  close(m.value, 86.25); close(m.values.get(byName(med, "Wait and monitor").id), 78.75);
  close(m.values.get(byName(med, "The condition gets worse").id), 52.5);
});
