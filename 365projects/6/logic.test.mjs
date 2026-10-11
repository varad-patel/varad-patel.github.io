import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEATURES, CASES, THEORIES, THRESHOLD, PAIRS, TWINS, answersOf, score, closest, comparePairs, consistency, countCoherent, unanimous, caseById } from "./logic.js";

const pattern = (key) => CASES.map((c) => (answersOf(key)[c.id] ? "Y" : "N")).join("");
const pair = (easier, harder) => PAIRS.find((p) => p.easier === easier && p.harder === harder);

test("there are ten cases, each coded on every feature", () => {
  assert.equal(CASES.length, 10);
  assert.equal(new Set(CASES.map((c) => c.id)).size, 10);
  for (const c of CASES) {
    for (const x of FEATURES) assert.notEqual(c.f[x.key], undefined, `${c.id} lacks ${x.key}`);
    assert.equal(c.f.lost, 1);
    assert.ok(c.text.length > 40 && c.act && c.title && c.source && c.scene);
  }
});

test("each theory's verdicts, worked by hand from its rule", () => {
  // Order: driver, switch, loop, footbridge, trapdoor, volunteer, station, child, transplant, gas.
  assert.equal(pattern("util"), "YYYYYYYYYY");      // five or a thousand for one, every time
  assert.equal(pattern("kant"), "YYNNNYNYNY");      // forbids the five cases where an unwilling person is the means
  assert.equal(pattern("dde"), "YYNNNNNYNY");       // as Kant, but consent does not rescue the volunteer case
  assert.equal(pattern("rights"), "YYYNNYNYNN");    // permits the loop (a redirected threat), forbids the gas (a new one)
  assert.equal(pattern("kld"), "YNNNNYNNNN");       // only the driver, who kills either way, and the volunteer
  assert.equal(pattern("threshold"), "YYNNNYYYNY"); // Kant plus the station, where 1,000 >= 100
  assert.equal(new Set(THEORIES.map((t) => pattern(t.key))).size, THEORIES.length, "no two theories coincide");
});

test("the threshold rule flips exactly at the threshold", () => {
  const t = THEORIES.find((x) => x.key === "threshold");
  const f = { ...caseById("footbridge").f };
  assert.equal(t.permits({ ...f, saved: THRESHOLD - 1 }), false);
  assert.equal(t.permits({ ...f, saved: THRESHOLD }), true);
  assert.equal(t.permits({ ...f, saved: THRESHOLD, lost: 2 }), false);
});

test("utilitarianism and double effect respond to the numbers", () => {
  const util = THEORIES.find((x) => x.key === "util"), dde = THEORIES.find((x) => x.key === "dde");
  const f = caseById("switch").f;
  assert.equal(util.permits({ ...f, saved: 1 }), false);
  assert.equal(dde.permits({ ...f, saved: 1 }), false);
  assert.equal(util.permits({ ...f, saved: 2 }), true);
});

test("pairs differ in exactly one feature and are ordered easier first", () => {
  assert.equal(PAIRS.length, 11);
  for (const p of PAIRS) {
    const a = caseById(p.easier).f, b = caseById(p.harder).f;
    assert.deepEqual(FEATURES.filter((x) => a[x.key] !== b[x.key]).map((x) => x.key), [p.feature]);
  }
  assert.equal(pair("driver", "switch").feature, "agentThreat");
  assert.equal(pair("switch", "loop").feature, "means");
  assert.equal(pair("gas", "trapdoor").feature, "means");
  assert.equal(pair("switch", "gas").feature, "redirect");
  assert.equal(pair("loop", "trapdoor").feature, "redirect");
  assert.equal(pair("trapdoor", "footbridge").feature, "force");
  assert.equal(pair("station", "footbridge").feature, "saved");
  assert.equal(pair("volunteer", "trapdoor").feature, "consent");
  assert.equal(pair("switch", "child").feature, "duty");
  assert.deepEqual(TWINS, [{ a: "footbridge", b: "transplant" }]);
  // Every feature is tested by at least one pair.
  assert.deepEqual([...new Set(PAIRS.map((p) => p.feature))].sort(), FEATURES.map((x) => x.key).sort());
  assert.deepEqual(comparePairs([]), { pairs: [], twins: [] });
});

test("scores count matches over answered cases only", () => {
  assert.ok(score({}).every((s) => s.share === null && s.answered === 0));
  assert.deepEqual(closest({}), []);
  const s = score({ switch: true, footbridge: false });
  const by = Object.fromEntries(s.map((x) => [x.key, x]));
  assert.equal(by.util.matched, 1);
  assert.deepEqual(by.util.misses, ["footbridge"]);
  assert.equal(by.dde.share, 1);
  assert.equal(by.kld.matched, 1);
  assert.deepEqual(closest({ switch: true, footbridge: false }).map((x) => x.key), ["kant", "dde", "rights", "threshold"]);
  // Junk values are ignored, not counted as answers.
  assert.equal(score({ switch: "yes", loop: null, nonsense: true })[0].answered, 0);
});

test("each theory matches itself on ten of ten and is never flagged", () => {
  for (const t of THEORIES) {
    const a = answersOf(t.key);
    assert.equal(score(a).find((s) => s.key === t.key).matched, 10);
    assert.deepEqual(closest(a).map((s) => s.key), [t.key]);
    const c = consistency(a);
    assert.equal(c.reversals.length + c.twins.length + c.uneven.length, 0, t.key);
    assert.equal(c.checked, 12);
  }
  assert.deepEqual(answersOf("nothing"), {});
});

test("how far apart the theories are", () => {
  const agree = (a, b) => score(answersOf(a)).find((s) => s.key === b).matched;
  assert.equal(agree("util", "dde"), 4);
  assert.equal(agree("util", "kld"), 2);
  assert.equal(agree("kant", "dde"), 9);
  assert.equal(agree("dde", "rights"), 7);
});

test("lines, reversals, split twins and uneven lines are found", () => {
  // Turn the trolley, do not push: a line on means at the loop.
  let c = consistency({ switch: true, loop: false });
  assert.deepEqual(c.lines, [pair("switch", "loop")]);
  assert.deepEqual(c.features, ["means"]);
  assert.equal(c.checked, 1);
  // Push to save five but not to save a thousand: a reversal on the number saved.
  c = consistency({ footbridge: true, station: false });
  assert.deepEqual(c.reversals, [pair("station", "footbridge")]);
  assert.equal(c.lines.length, 0);
  // Footbridge and transplant are coded identically.
  c = consistency({ footbridge: true, transplant: false });
  assert.deepEqual(c.twins, [{ a: "footbridge", b: "transplant" }]);
  // Forbid only the trapdoor of these four. Means decides gas against trapdoor but is ignored between switch and loop,
  // and redirection decides loop against trapdoor but is ignored between switch and gas.
  c = consistency({ gas: true, trapdoor: false, switch: true, loop: true });
  assert.equal(c.uneven.length, 2);
  const means = c.uneven.find((u) => u.feature === "means"), redirect = c.uneven.find((u) => u.feature === "redirect");
  assert.deepEqual(means.decides, pair("gas", "trapdoor"));
  assert.deepEqual(means.ignored, pair("switch", "loop"));
  assert.deepEqual(redirect.decides, pair("loop", "trapdoor"));
  assert.deepEqual(redirect.ignored, pair("switch", "gas"));
  // Two cases forbidden for another reason are not an uneven line.
  c = consistency({ switch: true, gas: false, loop: false, trapdoor: false });
  assert.equal(c.uneven.length, 0);
  // Nothing answered, nothing found.
  c = consistency({});
  assert.equal(c.checked, 0);
  assert.equal(c.total, 12);
});

test("the finding: one unanimous case, and 46 of 1,024 answer sets pass both strict checks", () => {
  assert.deepEqual(unanimous(), ["driver"]);
  const n = countCoherent();
  assert.equal(n.total, 1024);
  assert.equal(n.reversalFree, 50);   // no answer against the grain, whatever is said about the identically coded pair
  assert.equal(n.noReversal, 46);     // and the footbridge and the transplant answered alike
  assert.equal(n.clean, 38);          // and no uneven line
  // The six theories are among the 38.
  assert.equal(THEORIES.length, 6);
});

test("the counts in the finding, recounted without consistency()", () => {
  // The eleven one-feature pairs written out by hand, easier case first, and the identically coded pair.
  const pairs = [["driver", "switch"], ["switch", "loop"], ["switch", "child"], ["switch", "gas"], ["loop", "trapdoor"], ["gas", "trapdoor"],
    ["trapdoor", "footbridge"], ["trapdoor", "transplant"], ["station", "footbridge"], ["station", "transplant"], ["volunteer", "trapdoor"]];
  assert.deepEqual(pairs.map((p) => p.join(">")).sort(), PAIRS.map((p) => `${p.easier}>${p.harder}`).sort());
  const ids = CASES.map((c) => c.id);
  let reversalFree = 0, strict = 0;
  for (let mask = 0; mask < 1024; mask++) {
    const a = Object.fromEntries(ids.map((id, i) => [id, Boolean(mask & (1 << i))]));
    if (pairs.some(([easier, harder]) => !a[easier] && a[harder])) continue;
    reversalFree++;
    if (a.footbridge === a.transplant) strict++;
  }
  assert.equal(reversalFree, 50);
  assert.equal(strict, 46);
});

test("three cases were written for this page and are attributed to nobody", () => {
  const own = CASES.filter((c) => c.own);
  assert.deepEqual(own.map((c) => c.id), ["volunteer", "station", "child"]);
  for (const c of own) {
    assert.match(c.source, /^Written for this page/);
    assert.doesNotMatch(c.source, /Foot|Thomson|Greene|Kamm|Singer|\d{4}/, `${c.id} names a source`);
  }
  // Each differs from a published case in exactly one feature.
  const published = (id) => !caseById(id).own;
  for (const c of own) assert.ok(PAIRS.some((p) => (p.easier === c.id && published(p.harder)) || (p.harder === c.id && published(p.easier))), c.id);
  // The other seven name an author and a year.
  for (const c of CASES.filter((x) => !x.own)) assert.match(c.source, /(Foot|Thomson|Greene).*(1967|1976|1985|2009)/, c.id);
});

test("theory names read correctly in the middle of a sentence", () => {
  for (const t of THEORIES) assert.ok(t.inText && !/thomson|foot,|kantian/.test(t.inText), t.key);   // proper nouns keep their capitals
  assert.equal(closest({ switch: true, footbridge: false }).map((x) => x.inText).join("; "), "the Kantian means constraint; the doctrine of double effect; the rights view; threshold deontology");
});

test("the coding printed in the write-up is the coding the tool uses", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const keys = ["saved", "means", "force", "redirect", "duty", "agentThreat", "consent"];
  // The table.
  const rows = [...html.matchAll(/<tr><td>([^<]+)<\/td>((?:<td>[^<]+<\/td>){7})<\/tr>/g)];
  assert.equal(rows.length, CASES.length);
  rows.forEach((m, i) => {
    const c = CASES[i];
    assert.equal(m[1], c.title);
    const cells = [...m[2].matchAll(/<td>([^<]+)<\/td>/g)].map((x) => x[1]);
    keys.forEach((k, j) => assert.equal(cells[j], k === "saved" ? c.f.saved.toLocaleString("en-GB") : c.f[k] ? "yes" : "no", `${c.id} ${k}`));
  });
  // The list that replaces the table on a narrow screen.
  const words = { means: "means", force: "force", redirect: "redirect", duty: "duty", agentThreat: "killer either way", consent: "consent" };
  const items = [...html.matchAll(/<li><strong>([^<]+)<\/strong>: ([^<]+)\.<\/li>/g)].filter((m) => / saved/.test(m[2]));
  assert.equal(items.length, CASES.length);
  items.forEach((m, i) => {
    const c = CASES[i];
    assert.equal(m[1], c.title);
    const yes = keys.slice(1).filter((k) => c.f[k]).map((k) => words[k]);
    assert.equal(m[2], [`${c.f.saved.toLocaleString("en-GB")} saved`, ...(yes.length ? yes : ["no other feature"])].join("; "), c.id);
  });
});
