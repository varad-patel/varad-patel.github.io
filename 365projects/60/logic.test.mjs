import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  LIMITS, EXAMPLES, parse, format, deferredAcceptance, hiresOf, checkMatching, explainPairs, summarise,
  compareHires, everyList, countLists, findManipulation, everyStableMatching,
} from "./logic.js";

const market = (i = 0) => parse(EXAMPLES[i].candidates, EXAMPLES[i].employers).market;
const names = (m, matching) => Object.fromEntries(matching.map((e, c) => [m.candidates[c].name, e === null ? null : m.employers[e].name]));

/* ------------------------------------------- an independent definition */

// Stability written a second time, straight from the definition and with none of logic.js's helpers, so that the
// tests below do not merely check the code against itself. Any employer index, listed or not, may be assigned.
function stableByDefinition(m, matching) {
  const at = (j) => matching.map((e, c) => (e === j ? c : -1)).filter((c) => c >= 0);
  for (let c = 0; c < matching.length; c++) {
    const e = matching[c];
    if (e !== null && (m.candidates[c].prefs.indexOf(e) < 0 || m.employers[e].prefs.indexOf(c) < 0)) return false; // someone would rather be alone
  }
  for (let j = 0; j < m.employers.length; j++) if (at(j).length > m.employers[j].capacity) return false;
  for (let c = 0; c < m.candidates.length; c++) for (let j = 0; j < m.employers.length; j++) {
    const cp = m.candidates[c].prefs, ep = m.employers[j].prefs;
    if (matching[c] === j || cp.indexOf(j) < 0 || ep.indexOf(c) < 0) continue;
    const candidateWants = matching[c] === null || cp.indexOf(j) < cp.indexOf(matching[c]);
    const employerWants = at(j).length < m.employers[j].capacity || at(j).some((other) => ep.indexOf(c) < ep.indexOf(other));
    if (candidateWants && employerWants) return false;
  }
  return true;
}
function everyMatching(m) {
  const out = [];
  const walk = (c, cur) => {
    if (c === m.candidates.length) { out.push([...cur]); return; }
    for (const e of [null, ...m.employers.keys()]) { cur.push(e); walk(c + 1, cur); cur.pop(); }
  };
  walk(0, []);
  return out;
}
// Half the markets have complete lists, which is where several stable matchings are most likely; the rest leave names off.
function randomMarket(r, { maxC = 5, maxE = 3, maxCap = 2 } = {}) {
  const nc = r.int(1, maxC), ne = r.int(1, maxE), full = r.bool(0.5);
  const some = (n) => r.shuffle([...Array(n).keys()]).slice(0, full ? n : r.int(1, n));
  return {
    candidates: Array.from({ length: nc }, (_, i) => ({ name: `c${i}`, prefs: some(ne) })),
    employers: Array.from({ length: ne }, (_, j) => ({ name: `e${j}`, capacity: r.int(1, maxCap), prefs: some(nc) })),
  };
}
const rankOf = (prefs, x) => (x === null || prefs.indexOf(x) < 0 ? Infinity : prefs.indexOf(x));

/* --------------------------------------------------------------- parsing */

test("the examples parse, and format writes back text that parses to the same market", () => {
  for (const ex of EXAMPLES) {
    const { market: m, errors } = parse(ex.candidates, ex.employers);
    assert.deepEqual(errors, []);
    const text = format(m);
    assert.equal(text.candidates, ex.candidates);
    assert.equal(text.employers, ex.employers);
    assert.deepEqual(parse(text.candidates, text.employers).market, m);
  }
  const m = market();
  assert.deepEqual(m.candidates[0], { name: "Asha", prefs: [2, 0] });
  assert.deepEqual(m.employers[0], { name: "Acme", capacity: 2, prefs: [4, 5, 0, 2, 3] });
  assert.equal(m.employers[2].capacity, 1);
});

test("names are matched without regard to capitals or spacing, and blank lines are ignored", () => {
  const { market: m, errors } = parse("\n  asha :  ACME ,birch\n\nBen:acme\n", "Acme  ( 2 ) : ben, ASHA\r\nBirch: Asha");
  assert.deepEqual(errors, []);
  assert.deepEqual(m.candidates, [{ name: "asha", prefs: [0, 1] }, { name: "Ben", prefs: [0] }]);
  assert.deepEqual(m.employers, [{ name: "Acme", capacity: 2, prefs: [1, 0] }, { name: "Birch", capacity: 1, prefs: [0] }]);
});

test("each kind of mistake gets a message that says what to fix", () => {
  const E = "Acme: Asha, Ben\nBirch: Ben";
  const C = "Asha: Acme\nBen: Acme, Birch";
  const err = (c, e) => parse(c, e).errors.join(" | ");
  assert.equal(err(C, E), "");
  assert.match(err("Asha: Acme, Cobalt\nBen: Acme", E), /Asha lists "Cobalt", which is not one of the employers\. The employers are Acme and Birch\./);
  assert.match(err("Asha: Acme, Ben\nBen: Acme", E), /Asha lists "Ben", which is not one of the employers \(it is one of the candidates\)/);
  assert.match(err("Asha: Acme, acme\nBen: Acme", E), /Asha lists Acme twice/);
  assert.match(err("Asha:\nBen: Acme", E), /Asha's list is empty\. Name at least one employer after the colon, or delete the line\./);
  assert.match(err("Asha: , ,\nBen: Acme", E), /Asha's list is empty/);
  assert.match(err("Asha: Acme,, Birch\nBen: Acme", E), /Asha's list has an empty entry\. Remove the extra comma\./);
  assert.match(err("Asha: Acme,\nBen: Acme", E), /empty entry/);
  assert.match(err("Asha Acme\nBen: Acme", E), /Line 1 of the candidates has no colon\. Write a name, a colon, then the list, like this: Asha: Acme, Bolt/);
  assert.match(err(": Acme\nBen: Acme", E), /Line 1 of the candidates has no name before the colon/);
  assert.match(err("Asha: Acme\nasha: Birch\nBen: Acme", E), /asha appears twice among the candidates \(line 2\)/);
  assert.match(err("Asha: Acme\nAcme: Birch\nBen: Acme", "Acme: Asha, Ben\nBirch: Ben, Acme"), /Acme is both a candidate and an employer/);
  assert.match(err("Asha (2): Acme\nBen: Acme", E), /a candidate fills one position, so "Asha \(2\)" cannot have a number in brackets/);
  assert.match(err(C, "Acme (0): Asha, Ben\nBirch: Ben"), /the number of positions at Acme must be a whole number from 1 to 20/);
  assert.match(err(C, "Acme (two): Asha, Ben\nBirch: Ben"), /positions at Acme must be a whole number/);
  assert.match(err(C, "Acme (2.5): Asha, Ben\nBirch: Ben"), /whole number/);
  assert.match(err(C, "Acme (21): Asha, Ben\nBirch: Ben"), /from 1 to 20/);
  assert.match(err(C, "Acme (-1): Asha, Ben\nBirch: Ben"), /whole number/);
  assert.match(err("", E), /There are no candidates\. Type at least one, like this: Asha: Acme, Bolt/);
  assert.match(err(C, "  \n "), /There are no employers\. Type at least one, like this: Acme \(2\): Asha, Ben/);
  assert.match(err(`${"A".repeat(31)}: Acme\nBen: Acme`, "Acme: Ben"), /is 31 characters long; the limit is 30/);
  assert.match(err("A(b)c: Acme\nBen: Acme", "Acme: Ben"), /the name "A\(b\)c" contains a comma, a semicolon or a bracket/);
  assert.match(err(`Asha: ${"x".repeat(300)}\nBen: Acme`, E), /Asha lists "x{40}…", which is not one of the employers/);
  assert.match(err("x".repeat(LIMITS.text + 1), E), /The candidates box holds 4001 characters; the limit is 4000/);
  const many = Array.from({ length: 21 }, (_, i) => `P${i}: Acme`).join("\n");
  assert.match(err(many, "Acme: P0"), /There are 21 candidates; the limit is 20/);
  assert.match(err(null, undefined), /There are no candidates/);
  // One mistake is one message: a bad number of positions or an empty box does not set off a complaint from every list.
  assert.equal(parse(C, "Acme (0): Asha, Ben\nBirch: Ben").errors.length, 1);
  assert.equal(parse("", E).errors.length, 1);
  assert.equal(parse(C, "").errors.length, 1);
  // Several mistakes are all reported, not just the first.
  assert.equal(parse("Asha: Nope\nBen:\nCy Acme", E).errors.length, 3);
  assert.equal(parse("Asha: Nope", E).market, null);
});

test("one-sided listings are pointed out but are not errors", () => {
  const { notes, errors } = parse(EXAMPLES[0].candidates, EXAMPLES[0].employers);
  assert.deepEqual(errors, []);
  assert.deepEqual(notes, ["Ben lists Birch, but Birch does not list Ben", "Ben lists Acme, but Acme does not list Ben", "Birch lists Asha, but Asha does not list Birch"]);
  assert.deepEqual(parse(EXAMPLES[1].candidates, EXAMPLES[1].employers).notes, []);
});

/* ---------------------------------------------------- deferred acceptance */

test("the opening market by hand: three rounds when candidates propose", () => {
  const m = market();
  const r = deferredAcceptance(m, "candidates");
  assert.deepEqual(names(m, r.matching), { Asha: "Acme", Ben: null, Chloe: "Acme", Dev: "Birch", Esme: "Birch", Farid: "Cobalt" });
  assert.equal(r.rounds.length, 3);
  const [C, E] = [m.candidates.map((c) => c.name), m.employers.map((e) => e.name)];
  const say = (x) => `${C[x.candidate]}>${E[x.employer]}`;
  // Round 1: everyone proposes to a first choice. Birch never listed Ben; Cobalt has one place and ranks Farid above Asha.
  assert.deepEqual(r.rounds[0].proposals.map(say), ["Asha>Cobalt", "Ben>Birch", "Chloe>Acme", "Dev>Acme", "Esme>Birch", "Farid>Cobalt"]);
  assert.deepEqual(r.rounds[0].rejections.map((x) => [say(x), x.reason, x.kept.map((c) => C[c])]), [["Ben>Birch", "unlisted", []], ["Asha>Cobalt", "outranked", ["Farid"]]]);
  // Round 2: Asha and Ben try Acme. Acme never listed Ben, and with two places it now prefers Asha and Chloe to Dev.
  assert.deepEqual(r.rounds[1].proposals.map(say), ["Asha>Acme", "Ben>Acme"]);
  assert.deepEqual(r.rounds[1].rejections.map((x) => [say(x), x.reason, x.kept.map((c) => C[c])]), [["Ben>Acme", "unlisted", []], ["Dev>Acme", "released", ["Asha", "Chloe"]]]);
  // Round 3: Dev tries Birch, which has a free place.
  assert.deepEqual(r.rounds[2].proposals.map(say), ["Dev>Birch"]);
  assert.deepEqual(r.rounds[2].rejections, []);
  assert.deepEqual(r.hires.map((h) => h.map((c) => C[c])), [["Asha", "Chloe"], ["Dev", "Esme"], ["Farid"]]);
});

test("the opening market when employers propose: four rounds and a different matching", () => {
  const m = market();
  const r = deferredAcceptance(m, "employers");
  assert.deepEqual(names(m, r.matching), { Asha: "Acme", Ben: null, Chloe: "Cobalt", Dev: "Birch", Esme: "Birch", Farid: "Acme" });
  assert.equal(r.rounds.length, 4);
  const [C, E] = [m.candidates.map((c) => c.name), m.employers.map((e) => e.name)];
  const say = (x) => `${E[x.employer]}>${C[x.candidate]}`;
  // Round 1: Acme asks Esme and Farid, Birch asks Asha and Farid, Cobalt asks Chloe.
  assert.deepEqual(r.rounds[0].proposals.map(say), ["Acme>Esme", "Acme>Farid", "Birch>Asha", "Birch>Farid", "Cobalt>Chloe"]);
  // Asha never listed Birch; Farid prefers Acme to Birch.
  assert.deepEqual(r.rounds[0].rejections.map((x) => [say(x), x.reason, x.kept.map((e) => E[e])]), [["Birch>Asha", "unlisted", []], ["Birch>Farid", "outranked", ["Acme"]]]);
  // Round 2: Birch, with both places still empty, asks Chloe and Dev. Chloe prefers Cobalt, Dev accepts.
  assert.deepEqual(r.rounds[1].proposals.map(say), ["Birch>Chloe", "Birch>Dev"]);
  assert.deepEqual(r.rounds[1].rejections.map((x) => [say(x), x.reason]), [["Birch>Chloe", "outranked"]]);
  // Round 3: Birch asks Esme, who leaves Acme for it. Round 4: Acme asks Asha, who accepts.
  assert.deepEqual(r.rounds[2].proposals.map(say), ["Birch>Esme"]);
  assert.deepEqual(r.rounds[2].rejections.map((x) => [say(x), x.reason, x.kept.map((e) => E[e])]), [["Acme>Esme", "released", ["Birch"]]]);
  assert.deepEqual(r.rounds[3].proposals.map(say), ["Acme>Asha"]);
  assert.deepEqual(r.rounds[3].rejections, []);
});

test("small cases: one of each, nobody acceptable, an employer with room for everyone", () => {
  const one = parse("Asha: Acme", "Acme: Asha").market;
  assert.deepEqual(deferredAcceptance(one, "candidates").matching, [0]);
  assert.deepEqual(deferredAcceptance(one, "employers").matching, [0]);
  // Asha lists Acme but Acme lists only Ben, who lists nobody that lists him back.
  const none = parse("Asha: Acme\nBen: Birch", "Acme: Ben\nBirch: Asha").market;
  for (const who of ["candidates", "employers"]) {
    const r = deferredAcceptance(none, who);
    assert.deepEqual(r.matching, [null, null]);
    assert.equal(checkMatching(none, r.matching).stable, true);
    assert.equal(checkMatching(none, r.matching).pairs, 0);
  }
  const roomy = parse("Asha: Acme\nBen: Acme\nChloe: Acme", "Acme (20): Chloe, Ben, Asha").market;
  assert.deepEqual(deferredAcceptance(roomy, "candidates").matching, [0, 0, 0]);
  assert.deepEqual(deferredAcceptance(roomy, "employers").hires, [[2, 1, 0]]);
  assert.deepEqual(summarise(roomy, [0, 0, 0]), { candidatesFirst: 3, employersFirst: 1, matched: 3, filled: 3, positions: 20 });
});

/* ------------------------------------------------------------- stability */

test("checkMatching agrees with the definition on every possible matching of 300 random markets", () => {
  const r = rng(60);
  let total = 0, stableCount = 0;
  for (let k = 0; k < 300; k++) {
    const m = randomMarket(r, { maxC: 4, maxE: 3 });
    for (const matching of everyMatching(m)) {
      const got = checkMatching(m, matching), want = stableByDefinition(m, matching);
      assert.equal(got.stable, want, JSON.stringify({ m, matching, got }));
      total++; if (want) stableCount++;
    }
  }
  assert.ok(total > 10000 && stableCount >= 300, `${total} matchings, ${stableCount} stable`);
});

test("deferred acceptance is stable, and optimal for the side that proposes, against every stable matching", () => {
  const r = rng(1962);
  let several = 0;
  for (let k = 0; k < 1500; k++) {
    const m = randomMarket(r, { maxC: 4, maxE: 4 });
    const all = everyMatching(m).filter((x) => stableByDefinition(m, x));
    const listed = everyStableMatching(m);
    assert.deepEqual(new Set(listed.map(String)), new Set(all.map(String)));  // the page's own enumeration finds the same set
    assert.ok(all.length >= 1);                                               // a stable matching always exists
    if (all.length > 1) several++;
    const byC = deferredAcceptance(m, "candidates"), byE = deferredAcceptance(m, "employers");
    assert.ok(all.some((x) => String(x) === String(byC.matching)) && all.some((x) => String(x) === String(byE.matching)));
    for (const other of all) {
      // Every candidate does at least as well when candidates propose as in any stable matching, and at least as badly when employers do.
      m.candidates.forEach((c, i) => {
        assert.ok(rankOf(c.prefs, byC.matching[i]) <= rankOf(c.prefs, other[i]));
        assert.ok(rankOf(c.prefs, byE.matching[i]) >= rankOf(c.prefs, other[i]));
      });
      // And the mirror image for employers, comparing groups of hires place by place.
      const theirs = hiresOf(m, other);
      m.employers.forEach((e, j) => {
        assert.ok([0, 1].includes(compareHires(e.prefs, e.capacity, byE.hires[j], theirs[j])), "employers proposing is not best for an employer");
        assert.ok([0, -1].includes(compareHires(e.prefs, e.capacity, byC.hires[j], theirs[j])), "candidates proposing is not worst for an employer");
      });
      // The same candidates are matched and every employer fills the same number of places in every stable matching.
      assert.deepEqual(other.map((e) => e === null), byC.matching.map((e) => e === null));
      assert.deepEqual(theirs.map((h) => h.length), byC.hires.map((h) => h.length));
      // An employer with a place left empty has exactly the same people in every stable matching.
      m.employers.forEach((e, j) => { if (theirs[j].length < e.capacity) assert.deepEqual(theirs[j], byC.hires[j]); });
    }
    if (String(byC.matching) === String(byE.matching)) assert.equal(all.length, 1); // equal extremes mean a single stable matching
  }
  assert.ok(several > 20, `${several} markets had more than one stable matching`);
});

test("larger random markets: both versions end in a stable matching", () => {
  const r = rng(8);
  for (let k = 0; k < 200; k++) {
    const m = randomMarket(r, { maxC: 20, maxE: 20, maxCap: 4 });
    for (const who of ["candidates", "employers"]) {
      const run = deferredAcceptance(m, who);
      assert.ok(stableByDefinition(m, run.matching));
      const c = checkMatching(m, run.matching);
      assert.ok(c.stable && c.blocking.length === 0 && c.faults.length === 0);
      assert.ok(explainPairs(m, run.matching).every((p) => p.verdict !== "blocks"));
      assert.equal(explainPairs(m, run.matching).length, c.pairs);
    }
  }
});

test("a matching the visitor proposes: faults and blocking pairs are listed with their reasons", () => {
  const m = market();
  const [C, E] = [m.candidates.map((c) => c.name), m.employers.map((e) => e.name)];
  const id = (list, name) => list.indexOf(name);
  const assign = (o) => C.map((c) => (o[c] ? id(E, o[c]) : null));
  // Swap Chloe and Farid in the stable matching: Farid at Acme, Chloe at Cobalt is the other stable matching.
  assert.equal(checkMatching(m, assign({ Asha: "Acme", Chloe: "Cobalt", Dev: "Birch", Esme: "Birch", Farid: "Acme" })).stable, true);
  // Give Dev Acme's second place instead of Chloe, and leave Chloe out.
  const bad = checkMatching(m, assign({ Asha: "Acme", Dev: "Acme", Esme: "Birch", Farid: "Cobalt" }));
  assert.equal(bad.stable, false);
  assert.deepEqual(bad.faults, []);
  assert.deepEqual(bad.blocking.map((b) => [C[b.candidate], E[b.employer], b.current === null ? null : E[b.current], b.room, b.displaced === null ? null : C[b.displaced]]),
    [["Chloe", "Acme", null, false, "Dev"], ["Chloe", "Cobalt", null, false, "Farid"], ["Chloe", "Birch", null, true, null]]);
  // Put Ben at Birch (which never listed him), Asha at Birch (which she never listed) and three people at Cobalt.
  const worse = checkMatching(m, assign({ Asha: "Birch", Ben: "Birch", Chloe: "Cobalt", Dev: "Cobalt", Esme: "Cobalt" }));
  assert.deepEqual(worse.faults.map((f) => [f.kind, f.candidate === undefined ? null : C[f.candidate], E[f.employer], f.count ?? null]), [
    ["candidateUnlisted", "Asha", "Birch", null], ["employerUnlisted", "Ben", "Birch", null], ["overCapacity", null, "Cobalt", 3],
  ]);
  assert.equal(worse.stable, false);
  // Nobody matched at all: every pair that lists each other blocks.
  const empty = checkMatching(m, C.map(() => null));
  assert.equal(empty.blocking.length, empty.pairs);
  assert.equal(empty.pairs, 14);
});

/* -------------------------------------------------------------- incentives */

test("comparing groups of hires: hand cases", () => {
  const prefs = [10, 11, 12, 13]; // best first
  assert.equal(compareHires(prefs, 2, [10, 12], [11, 12]), 1);
  assert.equal(compareHires(prefs, 2, [11, 12], [10, 12]), -1);
  assert.equal(compareHires(prefs, 2, [12, 10], [10, 12]), 0);
  assert.equal(compareHires(prefs, 2, [10], [10, 13]), -1);       // an empty place is worse than anyone listed
  assert.equal(compareHires(prefs, 2, [10, 13], [11, 12]), null); // better first place, worse second: no verdict
  assert.equal(compareHires(prefs, 2, [10], [10, 99]), 1);        // and better than someone never listed
  assert.equal(compareHires(prefs, 1, [], []), 0);
});

test("every list an agent could report", () => {
  assert.deepEqual([...everyList(2)], [[0], [0, 1], [1], [1, 0]]);
  assert.equal([...everyList(3)].length, 15);
  assert.equal(countLists(3), 15);
  assert.equal(countLists(6), 1956);
  assert.equal([...everyList(6)].length, 1956);
  assert.equal(countLists(1), 1);
  assert.equal(new Set([...everyList(4)].map(String)).size, 64);
});

test("the proposing side cannot gain by misreporting; the receiving side sometimes can", { timeout: 120000 }, () => {
  const r = rng(1982);
  let receiverGains = 0, tried = 0;
  for (let k = 0; k < 150; k++) {
    const m = randomMarket(r, { maxC: 4, maxE: 4 });
    // Candidates proposing: no candidate ever gains, whatever the employers' capacities.
    m.candidates.forEach((_, i) => { const f = findManipulation(m, "candidates", "candidates", i); tried += f.tried; assert.equal(f.best, null, JSON.stringify(m)); });
    m.employers.forEach((_, j) => { if (findManipulation(m, "candidates", "employers", j).best) receiverGains++; });
    // Employers proposing with one position each: no employer ever gains.
    const single = { ...m, employers: m.employers.map((e) => ({ ...e, capacity: 1 })) };
    single.employers.forEach((_, j) => assert.equal(findManipulation(single, "employers", "employers", j).best, null, JSON.stringify(single)));
    single.candidates.forEach((_, i) => { if (findManipulation(single, "employers", "candidates", i).best) receiverGains++; });
  }
  assert.ok(tried > 2000 && receiverGains > 5, `${tried} lies tried, ${receiverGains} receivers could gain`);
});

test("with several positions even a proposing employer can gain: the opening market shows it", () => {
  const m = market();
  const acme = findManipulation(m, "employers", "employers", 0);
  assert.equal(acme.tried, 1955);
  assert.equal(acme.gains, 130);
  // And the gain is real: check the best lie by hand.
  const C = m.candidates.map((c) => c.name);
  const lied = { ...m, employers: m.employers.map((e, j) => (j === 0 ? { ...e, prefs: acme.best.list } : e)) };
  const after = deferredAcceptance(lied, "employers").hires[0], before = deferredAcceptance(m, "employers").hires[0];
  assert.deepEqual(before.map((c) => C[c]), ["Farid", "Asha"]);
  assert.equal(compareHires(m.employers[0].prefs, 2, after, before), 1);
  assert.deepEqual(after.map((c) => C[c]), ["Esme", "Asha"]);   // Esme, its first choice, in place of Farid, its second
});

/* ------------------------------------------------------------ the finding */

test("One finding: first choices under each version, who is left out, and Acme's profitable omission", () => {
  const m = market();
  const [C, E] = [m.candidates.map((c) => c.name), m.employers.map((e) => e.name)];
  const byC = deferredAcceptance(m, "candidates"), byE = deferredAcceptance(m, "employers");
  assert.deepEqual(summarise(m, byC.matching), { candidatesFirst: 3, employersFirst: 0, matched: 5, filled: 5, positions: 5 });
  assert.deepEqual(summarise(m, byE.matching), { candidatesFirst: 1, employersFirst: 1, matched: 5, filled: 5, positions: 5 });
  assert.equal(byC.matching[1], null); assert.equal(byE.matching[1], null);   // Ben, either way
  // The one employer with its first choice when employers propose is Cobalt, which gets Chloe.
  assert.deepEqual(m.employers.map((e, j) => byE.hires[j].includes(e.prefs[0])), [false, false, true]);
  assert.deepEqual(byE.hires[2].map((c) => C[c]), ["Chloe"]);
  assert.equal(checkMatching(m, byC.matching).pairs, 14);
  assert.deepEqual(everyStableMatching(m).map(String).sort(), [String(byC.matching), String(byE.matching)].sort());
  // No candidate gains from any of the 14 false lists each could send: 84 in all.
  const cand = m.candidates.map((_, i) => findManipulation(m, "candidates", "candidates", i));
  assert.equal(cand.reduce((s, f) => s + f.tried, 0), 84);
  assert.ok(cand.every((f) => f.best === null));
  // Acme gains by leaving Chloe off: Farid and Asha instead of Asha and Chloe.
  const acme = findManipulation(m, "candidates", "employers", 0);
  assert.equal(acme.tried, 1955);
  assert.equal(acme.gains, 166);
  assert.equal(acme.best.dropped, 1);
  assert.deepEqual(acme.best.list.map((c) => C[c]), ["Esme", "Farid", "Asha", "Dev"]);
  assert.deepEqual(acme.best.truthful.map((c) => C[c]), ["Asha", "Chloe"]);
  assert.deepEqual(acme.best.lying.map((c) => C[c]), ["Farid", "Asha"]);
  assert.equal(findManipulation(m, "candidates", "employers", 1).best, null);       // Birch cannot
  assert.equal(findManipulation(m, "candidates", "employers", 2).gains, 49);        // Cobalt can
  assert.equal(E[0], "Acme");
});

test("the other examples: three stable matchings, one, and one", () => {
  const opposite = market(1);
  assert.equal(everyStableMatching(opposite).length, 3);
  assert.deepEqual(summarise(opposite, deferredAcceptance(opposite, "candidates").matching).candidatesFirst, 3);
  assert.deepEqual(summarise(opposite, deferredAcceptance(opposite, "employers").matching).employersFirst, 3);
  assert.deepEqual(summarise(opposite, deferredAcceptance(opposite, "employers").matching).candidatesFirst, 0);
  for (const i of [2, 3]) {
    const m = market(i);
    assert.equal(everyStableMatching(m).length, 1);
    assert.deepEqual(deferredAcceptance(m, "candidates").matching, deferredAcceptance(m, "employers").matching);
  }
  assert.deepEqual(names(market(3), deferredAcceptance(market(3), "candidates").matching), { Asha: "Birch", Ben: "Acme", Chloe: "Acme", Dev: null, Esme: null });
  // Too large to enumerate: the function says so instead of running for ever.
  const big = { candidates: Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, prefs: [...Array(20).keys()] })), employers: Array.from({ length: 20 }, (_, j) => ({ name: `e${j}`, capacity: 1, prefs: [...Array(20).keys()] })) };
  assert.equal(everyStableMatching(big), null);
});

/* ------------------------------------------------- added by the review */

test("lists pasted with other separators are read: semicolons, full-width punctuation, spreadsheet tabs", () => {
  const E = "Acme (2): Asha, Ben\nBirch: Ben, Asha";
  const want = parse("Asha: Acme, Birch\nBen: Birch, Acme", E).market;
  assert.ok(want);
  const same = (c, e = E) => { const p = parse(c, e); assert.deepEqual(p.errors, []); assert.deepEqual(p.market, want); };
  same("Asha: Acme; Birch\nBen: Birch; Acme");
  same("Asha\uFF1A Acme\uFF0C Birch\nBen\uFF1A Birch\u3001Acme");          // full-width colon and commas
  same("Asha\tAcme\tBirch\nBen\tBirch\tAcme");                             // rows pasted from a spreadsheet
  same("Asha:\tAcme, Birch\r\nBen:  Birch ;Acme  ");                        // a tab that is only spacing, Windows line ends
  same("Asha: Acme, Birch\nBen: Birch, Acme", "Acme (2)\tAsha\tBen\nBirch\tBen\tAsha");
  // A name may not contain a separator, and a trailing separator is still an empty entry.
  assert.match(parse("As;ha: Acme", E).errors.join(" "), /contains a comma, a semicolon or a bracket/);
  assert.match(parse("Asha: Acme; Birch;\nBen: Acme", E).errors.join(" "), /Asha's list has an empty entry/);
  // Other punctuation is not guessed at.
  assert.match(parse("Asha: Acme > Birch\nBen: Acme", E).errors.join(" "), /Asha lists "Acme > Birch", which is not one of the employers/);
});

test("a line that cannot be read is one message, not one from everybody who lists that name", () => {
  const E = "Acme: Asha, Ben\nBirch: Ben, Asha";
  for (const bad of ["Asha - Acme, Birch", ": Acme", "Asha (2): Acme", `${"A".repeat(31)}: Acme`, "As(h)a: Acme"]) {
    const p = parse(`${bad}\nBen: Birch, Acme`, E);
    assert.equal(p.errors.length, 1, `${bad}: ${p.errors.join(" | ")}`);
    assert.equal(p.market, null);
  }
  // With every line readable, an unknown name is still reported, once for each list it is on.
  assert.equal(parse("Asha: Acme\nBen: Birch", "Acme: Asha, Cy\nBirch: Ben, Cy").errors.length, 2);
});

test("when employers propose, only an employer with several positions of its own can gain by a false list", { timeout: 120000 }, () => {
  const r = rng(1985);
  let gainers = 0, tried = 0;
  for (let k = 0; k < 200; k++) {
    const m = randomMarket(r, { maxC: 4, maxE: 3 });
    m.employers.forEach((e, j) => {
      const f = findManipulation(m, "employers", "employers", j);
      tried += f.tried;
      if (f.best) { gainers++; assert.ok(e.capacity > 1, JSON.stringify(m)); }
    });
  }
  assert.ok(gainers >= 3 && tried > 5000, `${gainers} gainers in ${tried} false lists`);
});

test("small cases the interface has to put into words: no pair who list each other, and exactly one", () => {
  const none = parse("Asha: Acme\nBen: Birch", "Acme: Ben\nBirch: Asha").market;
  for (const p of ["candidates", "employers"]) assert.deepEqual(deferredAcceptance(none, p).matching, [null, null]);
  assert.equal(checkMatching(none, [null, null]).pairs, 0);
  assert.equal(checkMatching(none, [null, null]).stable, true);
  assert.equal(explainPairs(none, [null, null]).length, 0);
  const one = parse("Asha: Acme", "Acme: Asha").market;
  assert.equal(checkMatching(one, [0]).pairs, 1);
  assert.equal(findManipulation(one, "candidates", "candidates", 0).tried, 0); // one name to list: no false list exists
});

test("a pasted numbered list loses its numbers; a name that only starts with a number keeps it", () => {
  const E = "Acme (2): Asha, Ben\nBirch: Ben, Asha";
  const want = parse("Asha: Acme, Birch\nBen: Birch, Acme", E).market;
  assert.deepEqual(parse("1. Asha: Acme, Birch\n2. Ben: Birch, Acme", E).market, want);
  assert.deepEqual(parse("1) Asha: Acme, Birch\n\n 2) Ben: Birch, Acme", "1. Acme (2): Asha, Ben\n2. Birch: Ben, Asha").market, want);
  // Not in order, or only some lines numbered: nothing is stripped, and the names are what was typed.
  const odd = parse("2. Asha: Acme\n1. Ben: Acme", "Acme: 2. Asha, 1. Ben");
  assert.deepEqual(odd.errors, []);
  assert.deepEqual(odd.market.candidates.map((c) => c.name), ["2. Asha", "1. Ben"]);
  const single = parse("1. Asha: Acme", "Acme: 1. Asha");
  assert.deepEqual(single.market.candidates.map((c) => c.name), ["1. Asha"]);
});
