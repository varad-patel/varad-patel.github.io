import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  PRESETS, LIMITS, premisesOf, restsOn, findCycle, problems, evaluate, minimalSets, analyse,
  blankMap, addClaim, editClaim, deleteClaim, setConclusion, setReason, deleteReason, fromLines, toJSON, fromJSON, wrapText, layout,
} from "./logic.js";

const get = (key) => structuredClone(PRESETS.find((p) => p.key === key).map);
const roles = (a) => Object.fromEntries(a.premises.map((p) => [p.id, p.role]));
const sorted = (sets) => sets.map((s) => [...s].sort().join("+")).sort();

// A hand-built map: c1 <- {c2, c3} (linked), c1 <- {c4} (a second, independent reason), c2 <- {c5}.
const small = () => ({
  title: "t", conclusion: "c1",
  claims: ["C", "Sub", "A", "B", "D", "Loose"].map((text, i) => ({ id: `c${i + 1}`, text, unstated: false })),
  reasons: [{ id: "r1", claim: "c1", premises: ["c2", "c3"] }, { id: "r2", claim: "c1", premises: ["c4"] }, { id: "r3", claim: "c2", premises: ["c5"] }],
});

test("every preset is a sound map", () => {
  for (const p of PRESETS) assert.deepEqual(problems(p.map), [], p.key);
});

test("a claim stands if it is a premise in play or one of its reasons has every member standing", () => {
  const m = small();
  assert.deepEqual(premisesOf(m), ["c3", "c4", "c5", "c6"]);
  const all = evaluate(m);
  assert.ok([...all.values()].every(Boolean));
  // Remove the lone premise of the second reason: the linked reason still carries the conclusion.
  assert.equal(evaluate(m, new Set(["c4"])).get("c1"), true);
  // Remove one member of the linked reason as well: nothing is left.
  const both = evaluate(m, new Set(["c4", "c3"]));
  assert.equal(both.get("c1"), false);
  assert.equal(both.get("c2"), true, "the sub-conclusion still stands on c5");
  // Removing c5 knocks out the sub-conclusion, and with it the linked reason, but not the conclusion.
  const deep = evaluate(m, new Set(["c5"]));
  assert.equal(deep.get("c2"), false);
  assert.equal(deep.get("c1"), true);
  // A claim that has reasons cannot be removed directly: it is not a premise.
  assert.equal(evaluate(m, new Set(["c2"])).get("c2"), true);
});

test("smallest sufficient sets and smallest objections, by hand", () => {
  const m = small();
  assert.deepEqual(sorted(minimalSets(m, "support")), ["c3+c5", "c4"]);
  // To defeat C: c4 must go, and so must c3 or c5.
  assert.deepEqual(sorted(minimalSets(m, "cut")), ["c3+c4", "c4+c5"]);
  assert.deepEqual(sorted(minimalSets(m, "support", "c2")), ["c5"]);
});

test("a reason that only repeats a smaller one adds no new way to support the conclusion", () => {
  const m = small();
  m.reasons.push({ id: "r4", claim: "c1", premises: ["c4", "c6"] }); // c4 alone is already enough
  assert.deepEqual(sorted(minimalSets(m, "support")), ["c3+c5", "c4"]);
  assert.equal(roles(analyse(m)).c6, "idle");
});

test("minimal sets agree with brute force on random maps", () => {
  const r = rng(16);
  for (let trial = 0; trial < 40; trial++) {
    // Random layered DAG: claim i may only rest on claims with a larger index, so there can be no cycle.
    const n = r.int(4, 9);
    const m = { title: "", conclusion: "c1", claims: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, text: `claim ${i + 1}` })), reasons: [] };
    for (let i = 1; i <= n - 2; i++) {
      if (i > 1 && r.bool(0.45)) continue;
      for (let k = r.int(1, 2); k > 0; k--) {
        const pool = r.shuffle(Array.from({ length: n - i }, (_, j) => `c${i + 1 + j}`));
        m.reasons.push({ id: `r${m.reasons.length + 1}`, claim: `c${i}`, premises: pool.slice(0, r.int(1, Math.min(3, pool.length))) });
      }
    }
    assert.deepEqual(problems(m), []);
    const leaves = premisesOf(m);
    const support = minimalSets(m, "support");
    const cut = minimalSets(m, "cut");
    for (let mask = 0; mask < 1 << leaves.length; mask++) {
      const off = new Set(leaves.filter((_, i) => mask & (1 << i)));
      const stands = evaluate(m, off).get("c1");
      assert.equal(support.some((s) => s.every((id) => !off.has(id))), stands, "a sufficient set is intact exactly when the conclusion stands");
      assert.equal(cut.some((s) => s.every((id) => off.has(id))), !stands, "an objection is complete exactly when the conclusion falls");
    }
    // A premise is critical exactly when it is in every sufficient set, which is when it is an objection on its own.
    const a = analyse(m);
    for (const p of a.premises) {
      const everywhere = support.every((s) => s.includes(p.id));
      assert.equal(p.role === "critical", everywhere);
      assert.equal(cut.some((s) => s.length === 1 && s[0] === p.id), everywhere);
    }
  }
});

test("the syllogism: both premises are critical", () => {
  const a = analyse(get("syllogism"));
  assert.equal(a.conclusionStands, true);
  assert.deepEqual(roles(a), { c2: "critical", c3: "critical" });
  assert.deepEqual(a.objections, [["c2"], ["c3"]]);
  const without = analyse(get("syllogism"), new Set(["c3"]));
  assert.equal(without.conclusionStands, false);
  assert.deepEqual(roles(without), { c2: "inplay", c3: "restores" });
  assert.deepEqual(without.repairs, [["c3"]]);
  assert.deepEqual(without.objections, []);
});

test("the hidden premise is critical, and it is marked as unstated", () => {
  const m = get("hidden");
  assert.equal(m.claims.find((c) => c.id === "c3").unstated, true);
  assert.equal(roles(analyse(m)).c3, "critical");
  assert.equal(analyse(m, new Set(["c3"])).conclusionStands, false);
});

test("the finding: in the congestion-charge map one premise of seven is critical, and it is the shared one", () => {
  const m = get("charge");
  const a = analyse(m);
  assert.equal(a.counts.premises, 7);
  assert.equal(a.supports.length, 2, "two lines of support");
  assert.equal(a.counts.critical, 1);
  assert.equal(a.counts.redundant, 6);
  const critical = a.premises.find((p) => p.role === "critical").id;
  assert.equal(m.claims.find((c) => c.id === critical).text, "The charge can be enforced cheaply and reliably.");
  assert.ok(a.supports.every((s) => s.premises.includes(critical)), "both lines use it");
  // Every other objection needs two premises, one from each line: 3 x 3 = 9 pairs.
  assert.equal(a.objections.filter((s) => s.length === 1).length, 1);
  assert.equal(a.objections.filter((s) => s.length === 2).length, 9);
  assert.equal(a.objections.length, 10);
  // Each of the six redundant premises can go alone without the conclusion falling.
  for (const p of a.premises.filter((q) => q.role === "redundant")) assert.equal(analyse(m, new Set([p.id])).conclusionStands, true);
  assert.equal(analyse(m, new Set([critical])).conclusionStands, false);
});

test("roles follow the premises that have been removed", () => {
  const m = get("charge");
  // Break the health line (remove c3): the transport line now carries everything, so all four of its premises are critical.
  const a = analyse(m, new Set(["c3"]));
  assert.equal(a.conclusionStands, true);
  assert.deepEqual(a.supports.map((s) => s.intact), [false, true]);
  assert.deepEqual(a.premises.filter((p) => p.role === "critical").map((p) => p.id).sort(), ["c10", "c6", "c8", "c9"]);
  assert.equal(roles(a).c3, "removed");
  assert.equal(a.holds.get("r1"), false);
  assert.equal(a.holds.get("r2"), true);
  // Remove one from the other line too: the conclusion falls and either premise alone would restore it.
  const b = analyse(m, new Set(["c3", "c6"]));
  assert.equal(b.conclusionStands, false);
  assert.equal(roles(b).c3, "restores");
  assert.equal(roles(b).c6, "restores");
  assert.deepEqual(sorted(b.repairs), ["c3", "c6"]);
});

test("unconnected claims and a bare conclusion are handled", () => {
  const m = small();
  assert.equal(roles(analyse(m)).c6, "unused");
  assert.ok(!restsOn(m).has("c6"));
  const bare = analyse(blankMap());
  assert.equal(bare.argued, false);
  assert.deepEqual(bare.premises, []);
  assert.deepEqual(bare.supports, []);
  assert.deepEqual(bare.objections, []);
});

test("circular support is found and refused with the chain spelled out", () => {
  const m = small();
  assert.equal(findCycle(m), null);
  // c5 supports c2 supports c1. Making c1 a reason for c5 closes the loop.
  const res = setReason(m, "c5", ["c1"]);
  assert.match(res.error, /circular/);
  assert.match(res.error, /rests on/);
  assert.equal(m.reasons.length, 3, "the original map is untouched");
  assert.match(setReason(m, "c1", ["c1"]).error, /reason for itself/);
  const looped = { ...m, reasons: [...m.reasons, { id: "r9", claim: "c5", premises: ["c1"] }] };
  const cycle = findCycle(looped);
  assert.equal(cycle[0], cycle.at(-1));
  assert.match(problems(looped)[0], /circular/);
  assert.equal(evaluate(looped).get("c1"), true, "evaluation does not hang on a loop");
});

test("editing: add, rename, mark, delete, reasons, conclusion", () => {
  let m = blankMap();
  assert.match(addClaim(m, "   ").error, /Type the claim/);
  let res = addClaim(m, "  First   premise ");
  assert.equal(res.id, "c2");
  m = res.map;
  assert.equal(m.claims[1].text, "First premise");
  m = addClaim(m, "Second premise").map;
  assert.match(setReason(m, "c1", []).error, /at least one/);
  m = setReason(m, "c1", ["c2", "c3"]).map;
  assert.equal(m.reasons.length, 1);
  assert.match(setReason(m, "c1", ["c3", "c2"]).error, /already has a reason/);
  m = setReason(m, "c1", ["c2"], "r1").map; // edit the reason in place
  assert.deepEqual(m.reasons[0].premises, ["c2"]);
  assert.match(editClaim(m, "c2", { text: "" }).error, /needs some text/);
  m = editClaim(m, "c2", { text: "Renamed", unstated: true }).map;
  assert.deepEqual(m.claims[1], { id: "c2", text: "Renamed", unstated: true });
  assert.match(deleteClaim(m, "c1").error, /main conclusion/);
  m = deleteClaim(m, "c2").map; // its reason is left empty and goes with it
  assert.equal(m.reasons.length, 0);
  assert.deepEqual(problems(m), []);
  m = setConclusion(m, "c3").map;
  assert.equal(m.conclusion, "c3");
  m = deleteClaim(m, "c1").map;
  assert.deepEqual(m.claims.map((c) => c.id), ["c3"]);
  assert.match(deleteReason(m, "r1").error, /no longer/);
  assert.equal(addClaim(m, "x".repeat(500)).map.claims[1].text.length, LIMITS.text);
  let full = blankMap();
  for (let i = 1; i < LIMITS.claims; i++) full = addClaim(full, `p${i}`).map;
  assert.match(addClaim(full, "one too many").error, /Delete one/);
});

test("typed lines become a linked or a convergent argument", () => {
  const linked = fromLines("All humans are mortal.\n\n  Socrates is a human.  \nSocrates is a human.", "Socrates is mortal.").map;
  assert.equal(linked.claims.length, 3, "blank and repeated lines are dropped");
  assert.deepEqual(linked.reasons, [{ id: "r1", claim: "c1", premises: ["c2", "c3"] }]);
  assert.equal(analyse(linked).counts.critical, 2);
  const convergent = fromLines("It is cheap.\nIt is popular.", "We should do it.", "convergent").map;
  assert.equal(convergent.reasons.length, 2);
  assert.equal(analyse(convergent).counts.critical, 0);
  assert.equal(analyse(convergent).objections[0].length, 2);
  assert.match(fromLines("", "C").error, /at least one premise/);
  assert.match(fromLines("P", " ").error, /conclusion/);
  assert.match(fromLines("C\nP", "C").error, /assume/);
});

test("export and import round-trip, and unsound files are refused", () => {
  for (const p of PRESETS) assert.deepEqual(fromJSON(toJSON(p.map)).map, p.map);
  assert.match(fromJSON("{not json").error, /not valid JSON/);
  assert.match(fromJSON("[1,2]").error, /not an argument map/);
  assert.match(fromJSON({ claims: [{ id: 1, text: "a" }], reasons: [{}] }).error, /malformed/);
  assert.match(fromJSON({ conclusion: 1, claims: [{ id: 1, text: { not: "text" } }], reasons: [] }).error, /malformed/);
  assert.match(fromJSON({ conclusion: 1, claims: [{ id: 1, text: 7 }], reasons: [] }).error, /malformed/);
  assert.match(fromJSON({ conclusion: 1, claims: [{ id: 1 }], reasons: [] }).error, /no text/);
  assert.match(fromJSON({ conclusion: "x", claims: [{ id: "x", text: "a" }, { id: "x", text: "b" }], reasons: [] }).error, /share an id/);
  assert.match(fromJSON({ claims: [{ id: "x", text: "a" }], reasons: [] }).error, /main conclusion/);
  assert.match(fromJSON({ conclusion: "x", claims: [{ id: "x", text: "a" }], reasons: [{ claim: "x", premises: ["nope"] }] }).error, /not in the map/);
  assert.match(fromJSON({ conclusion: "a", claims: [{ id: "a", text: "A" }, { id: "b", text: "B" }], reasons: [{ claim: "a", premises: ["b"] }, { claim: "b", premises: ["a"] }] }).error, /circular/);
  // Foreign ids are renumbered.
  const m = fromJSON({ conclusion: 7, claims: [{ id: 7, text: "C" }, { id: "p", text: "P" }], reasons: [{ claim: 7, premises: ["p"] }] }).map;
  assert.deepEqual(m.reasons, [{ id: "r1", claim: "c1", premises: ["c2"] }]);
});

test("too many sets is reported as null rather than freezing", () => {
  // 12 linked sub-claims, each with 2 independent premises: 2^12 = 4,096 smallest sufficient sets.
  const m = { title: "", conclusion: "c1", claims: [{ id: "c1", text: "C" }], reasons: [{ id: "r0", claim: "c1", premises: [] }] };
  for (let i = 0; i < 12; i++) {
    const [s, a, b] = [`s${i}`, `a${i}`, `b${i}`];
    m.claims.push({ id: s, text: s }, { id: a, text: a }, { id: b, text: b });
    m.reasons[0].premises.push(s);
    m.reasons.push({ id: `ra${i}`, claim: s, premises: [a] }, { id: `rb${i}`, claim: s, premises: [b] });
  }
  assert.equal(minimalSets(m, "support"), null);
  assert.equal(minimalSets(m, "cut").length, 12);
  const a = analyse(m);
  assert.equal(a.supports, null);
  assert.equal(a.conclusionStands, true);
  assert.equal(a.counts.critical, 0);
  assert.equal(a.counts.redundant, 24);
});

test("text wrapping respects the width, splits long words and cuts extra lines", () => {
  const measure = (s) => s.length * 10;
  assert.deepEqual(wrapText("aa bb cc", 50, measure), ["aa bb", "cc"]);
  assert.deepEqual(wrapText("", 50, measure), [""]);
  const long = wrapText("abcdefghijkl", 50, measure);
  assert.ok(long.length > 1 && long.every((l) => measure(l) <= 50), long.join("|"));
  assert.equal(long.join("").replaceAll("-", ""), "abcdefghijkl");
  const cut = wrapText("one two three four five six seven eight", 50, measure, 3);
  assert.equal(cut.length, 3);
  assert.ok(cut[2].endsWith("…") && measure(cut[2]) <= 50);
});

test("layout: premises sit below what they support and nothing overlaps", () => {
  for (const m of [...PRESETS.map((p) => p.map), small(), blankMap()]) {
    const L = layout(m, { nodeWidth: 172, gapX: 20 });
    const at = new Map(L.nodes.map((n) => [n.id, n]));
    assert.equal(L.nodes.length, m.claims.length);
    for (const r of m.reasons) for (const p of r.premises) assert.ok(at.get(p).layer > at.get(r.claim).layer && at.get(p).y > at.get(r.claim).y + at.get(r.claim).h);
    for (const a of L.nodes) {
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= L.width && a.y + a.h <= L.height);
      for (const b of L.nodes) if (a !== b && a.layer === b.layer) assert.ok(Math.abs(a.x - b.x) >= 172 + 20 - 1e-6, "nodes in a layer keep their gap");
    }
    assert.equal(L.links.length, m.reasons.length);
    for (const l of L.links) {
      const claim = at.get(l.claim);
      assert.ok(l.tip.x > claim.x && l.tip.x < claim.x + claim.w && l.tip.y === claim.y + claim.h);
      for (const mem of l.members) assert.ok(Number.isFinite(mem.x) && mem.y === at.get(mem.id).y && mem.y > l.y);
    }
  }
  // The main conclusion of the policy map is on the top layer, with five claims under it and four under those.
  const L = layout(PRESETS[0].map);
  assert.deepEqual([0, 1, 2].map((k) => L.nodes.filter((n) => n.layer === k).length), [1, 5, 4]);
});

// Every point where a drawn line or arrow shaft is strictly inside a box, found by sampling the curves the page draws.
function hiddenLines(L) {
  const bez = (a, b, c, d, t) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;
  const hits = new Set();
  const check = (x, y, what) => { for (const n of L.nodes) if (x > n.x + 0.01 && x < n.x + n.w - 0.01 && y > n.y + 0.01 && y < n.y + n.h - 0.01) hits.add(`${what} crosses box ${n.id}`); };
  for (const l of L.links) {
    for (const m of l.members) for (let s = 0; s + 1 < m.route.length; s++) {
      const [x0, y0] = m.route[s], [x1, y1] = m.route[s + 1], mid = (y0 + y1) / 2;
      for (let i = 0; i <= 40; i++) check(bez(x0, x0, x1, x1, i / 40), bez(y0, mid, mid, y1, i / 40), `line ${m.id} to ${l.claim}`);
    }
    for (let i = 0; i <= 20; i++) check(l.x, l.y + ((l.tip.y - l.y) * i) / 20, `arrow into ${l.claim}`);
  }
  return [...hits];
}

test("layout: no line or arrow runs behind a box, however many layers it spans", () => {
  // Premise c3 supports the top claim directly and a claim two layers down, so its line to the top spans three layers.
  const deep = {
    title: "", conclusion: "c1",
    claims: ["Top", "A sub-conclusion with a long text that wraps over several lines in its box, making its row tall", "Shared premise", "Middle", "Leaf"].map((text, i) => ({ id: `c${i + 1}`, text })),
    reasons: [{ id: "r1", claim: "c1", premises: ["c2", "c3"] }, { id: "r2", claim: "c2", premises: ["c4"] }, { id: "r3", claim: "c4", premises: ["c3", "c5"] }],
  };
  const D = layout(deep);
  const at = new Map(D.nodes.map((n) => [n.id, n]));
  assert.equal(at.get("c3").layer, 3);
  const long = D.links.find((l) => l.id === "r1").members.find((m) => m.id === "c3");
  assert.equal(long.route.length, 6, "start, bottom and top of a lane in each of two layers, meeting point");
  assert.deepEqual(long.route[0], [long.x, long.y]);
  for (const k of [1, 3]) {
    assert.equal(long.route[k][0], long.route[k + 1][0], "a lane is vertical");
    for (const n of D.nodes) if (n.y < long.route[k][1] && n.y + n.h > long.route[k + 1][1]) assert.ok(long.route[k][0] < n.x - 10 || long.route[k][0] > n.x + n.w + 10, "a lane keeps clear of the boxes in its layer");
  }
  assert.deepEqual(hiddenLines(D), []);
  // A short box beside a tall one: the meeting point is below the tall one, so lines to the short one do not cut across it.
  for (const l of D.links) for (const n of D.nodes) if (n.layer === at.get(l.claim).layer) assert.ok(l.y > n.y + n.h);

  for (const m of [...PRESETS.map((p) => p.map), small()]) assert.deepEqual(hiddenLines(layout(m)), []);
  // Random maps, with reasons that reach any number of layers down and texts of very different lengths.
  const r = rng(61);
  for (let trial = 0; trial < 150; trial++) {
    const n = r.int(3, 14);
    const m = { title: "", conclusion: "c1", claims: Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, text: "word ".repeat(r.int(1, 30)).trim() })), reasons: [] };
    for (let i = 1; i < n; i++) for (let k = r.int(0, 2); k > 0; k--) {
      const pool = r.shuffle(Array.from({ length: n - i }, (_, j) => `c${i + 1 + j}`));
      m.reasons.push({ id: `r${m.reasons.length + 1}`, claim: `c${i}`, premises: pool.slice(0, r.int(1, Math.min(3, pool.length))) });
    }
    for (const opts of [{}, { nodeWidth: 156, gapX: 14 }]) {
      const L = layout(m, opts);
      assert.deepEqual(hiddenLines(L), [], `trial ${trial}`);
      const w = opts.nodeWidth ?? 172, gap = opts.gapX ?? 20;
      for (const a of L.nodes) {
        assert.ok(a.x >= 0 && a.x + a.w <= L.width && a.y + a.h <= L.height);
        for (const b of L.nodes) if (a !== b && a.layer === b.layer) assert.ok(Math.abs(a.x - b.x) >= w + gap - 1e-6, "boxes in a layer keep their gap");
      }
      for (const l of L.links) for (const mem of l.members) for (const [x, y] of mem.route) assert.ok(Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= L.width && y >= 0 && y <= L.height);
    }
  }
});
