import test from "node:test";
import assert from "node:assert/strict";
import {
  TERMS, FORMS, NAMES, MODERN, TRADITIONAL, targetMask, regionsOf, holds, check, verdict, bestCounterexample, explain, readOff,
  formOf, moodOf, figureOf, distributed, brokenRules, faults, census, sameTerm, parseStatement, parseSyllogism, wording, asKind, fullName, ALSO,
} from "./logic.js";

const parse = (...lines) => parseSyllogism(...lines);
const all = census();

test("of the 256 forms, 15 are valid on the modern reading and 24 with existential import (the finding)", () => {
  assert.equal(all.length, 256);
  assert.equal(all.filter((r) => r.modern).length, 15);
  assert.equal(all.filter((r) => r.traditional).length, 24);
  assert.equal(all.filter((r) => !r.traditional).length, 232);
  // Nothing is valid on the modern reading and invalid on the traditional one.
  assert.ok(all.every((r) => !r.modern || r.traditional));
  // The 24 are exactly the forms with a medieval name.
  assert.deepEqual(all.filter((r) => r.traditional).map((r) => r.key).sort(), Object.keys(NAMES).sort());
});

test("the nine forms that need existential import, and the term each one needs", () => {
  const nine = Object.fromEntries(all.filter((r) => r.traditional && !r.modern).map((r) => [r.name, r.needs]));
  assert.deepEqual(nine, { Barbari: "S", Celaront: "S", Cesaro: "S", Camestros: "S", Camenop: "S", Darapti: "M", Felapton: "M", Fesapo: "M", Bramantip: "P" });
  // Every one of them draws a particular conclusion from two universal premises.
  for (const r of all.filter((x) => x.traditional && !x.modern)) assert.match(r.mood, /^[AE][AE][IO]$/);
});

test("the classical rules agree with the model checker on every form", () => {
  for (const r of all) {
    const syl = formOf(r.mood, r.figure);
    assert.equal(brokenRules(syl).length === 0, r.modern, `${r.key} on the modern reading`);
    assert.equal(brokenRules(syl, { existential: false }).length === 0, r.traditional, `${r.key} on the traditional reading`);
  }
  assert.equal(all.filter((r) => r.broken.length === 1 && r.broken[0] === "existential").length, 9);
});

test("with singular terms, the first four rules still agree with the model checker", () => {
  const subsets = [[], ["S"], ["M"], ["P"], ["S", "M"], ["S", "P"], ["M", "P"], ["S", "M", "P"]];
  for (const singular of subsets) for (const r of all) {
    const syl = formOf(r.mood, r.figure);
    const valid = check(syl, { nonEmpty: TERMS, singular }).valid;
    assert.equal(brokenRules(syl, { existential: false, singular }).length === 0, valid, `${r.key} with singular ${singular}`);
    // Whenever a reading rejects a form, at least one fault is named.
    const f = faults(syl, singular), v = verdict(syl, singular);
    assert.equal(f.modern.length > 0, !v.modern.valid);
    assert.equal(f.traditional.length > 0, !v.traditional.valid);
  }
});

test("truth of a statement in a world, by hand", () => {
  const allSP = { form: "A", subject: "S", predicate: "P" };
  // S outside P is region 1 (S only) and region 3 (S and M).
  assert.deepEqual(regionsOf(targetMask(allSP)), [1, 3]);
  assert.deepEqual(regionsOf(targetMask({ form: "E", subject: "S", predicate: "P" })), [5, 7]);
  assert.equal(holds(allSP, 0), true); // an empty world: vacuously true
  assert.equal(holds(allSP, 1 << 7), true); // one thing that is S, M and P
  assert.equal(holds(allSP, 1 << 3), false); // one thing that is S and M but not P
  assert.equal(holds({ form: "I", subject: "S", predicate: "P" }, 0), false);
  assert.equal(holds({ form: "I", subject: "S", predicate: "P" }, 1 << 5), true);
  assert.equal(holds({ form: "O", subject: "S", predicate: "P" }, 1 << 5), false);
  assert.equal(holds({ form: "O", subject: "S", predicate: "P" }, 1 << 1), true);
  assert.deepEqual(explain(allSP, 0), { holds: true, witness: null, vacuous: true });
  assert.deepEqual(explain(allSP, 1 << 3), { holds: false, witness: 3, vacuous: false });
});

test("Barbara: the premises shade everything the conclusion needs empty", () => {
  const barbara = formOf("AAA", 1);
  const d = readOff(barbara, MODERN);
  // All M are P shades M outside P (2, 3); All S are M shades S outside M (1, 5).
  assert.deepEqual(d.empty, [1, 2, 3, 5]);
  assert.deepEqual(d.inhabited, []);
  assert.deepEqual(d.target, [1, 3]);
  assert.equal(d.wants, "empty");
  assert.ok(d.target.every((r) => d.empty.includes(r)));
});

test("crosses: Darii pins one down, two particular premises leave it on a line, Barbari needs import", () => {
  const darii = readOff(formOf("AII", 1), MODERN);
  assert.deepEqual(darii.inhabited, [7]);
  assert.deepEqual(darii.floating, []);
  const iii = readOff(formOf("III", 1), MODERN);
  assert.deepEqual(iii.inhabited, []);
  assert.deepEqual(iii.floating, [[6, 7], [3, 7]]);
  const barbari = formOf("AAI", 1);
  assert.deepEqual(readOff(barbari, MODERN).inhabited, []);
  assert.deepEqual(readOff(barbari, TRADITIONAL).inhabited, [7]);
});

test("every invalid form has a counterexample that really is one", () => {
  for (const r of all) {
    const syl = formOf(r.mood, r.figure);
    for (const [opts, valid] of [[MODERN, r.modern], [TRADITIONAL, r.traditional]]) {
      const c = check(syl, opts);
      assert.equal(c.valid, valid);
      assert.ok(c.consistent, `${r.key}: the premises can always be made true together`);
      const m = bestCounterexample(c.counterexamples);
      if (valid) { assert.equal(m, null); continue; }
      assert.ok(holds(syl.major, m) && holds(syl.minor, m) && !holds(syl.conclusion, m), r.key);
      assert.equal(m & 1, 0, "nothing needs to live outside all three circles");
    }
  }
  // Undistributed middle (AAA-2): one thing that is S and M, another that is P and M.
  assert.deepEqual(regionsOf(bestCounterexample(check(formOf("AAA", 2)).counterexamples)), [3, 6]);
  // Darapti on the modern reading fails only when there are no M.
  const m = bestCounterexample(check(formOf("AAI", 3)).counterexamples);
  assert.deepEqual(regionsOf(m), [1, 4]);
});

test("mood and figure survive a round trip through English for all 256 forms", () => {
  for (const figure of [1, 2, 3, 4]) for (const a of FORMS) for (const b of FORMS) for (const c of FORMS) {
    const syl = formOf(a + b + c, figure);
    assert.equal(moodOf(syl), a + b + c);
    assert.equal(figureOf(syl), figure);
    const p = parse(wording(syl.major), wording(syl.minor), wording(syl.conclusion));
    assert.ok(p.ok, p.error);
    assert.equal(p.key, `${a}${b}${c}-${figure}`);
    assert.deepEqual(p.syl, syl);
    // The order of the premises does not matter.
    assert.equal(parse(wording(syl.minor), wording(syl.major), wording(syl.conclusion)).key, p.key);
  }
});

test("ordinary English: articles, plurals, is and are, therefore, contractions", () => {
  const p = parse("All humans are mortal.", "Every Greek is a human.", "Therefore, all Greeks are mortals.");
  assert.ok(p.ok, p.error);
  assert.equal(p.key, "AAA-1");
  assert.equal(p.name, "Barbara");
  assert.deepEqual(p.terms, { S: "Greek", M: "humans", P: "mortal" }); // the first spelling that is not sentence-initial
  assert.equal(parse("No fish are mammals", "Some pets aren't fish", "So some pets are not mammals").key, "EOO-1");
  assert.equal(parse("Not all pets are cats", "all cats are animals", "some animals are pets").key, "OAI-4"); // the major premise is the one about pets
  assert.equal(parse("Whales are mammals", "No mammals are fish", "No whales are fish").key, "EAE-1");
  assert.equal(parse("All A are B", "All B are C", "All A are C").key, "AAA-1");
  assert.equal(parse("Only citizens are voters", "All senators are voters", "All senators are citizens").key, "AAA-1");
  assert.ok(sameTerm("a man", "Men") && sameTerm("the Greeks", "greek") && sameTerm("cities", "city") && sameTerm("boxes", "a box"));
  assert.ok(!sameTerm("planes", "plan") && !sameTerm("cats", "dogs") && !sameTerm("red cats", "black cats"));
});

test("a sentence with two copulas is split where the terms line up", () => {
  const p = parse("All people who are tall are basketball players", "No basketball players are jockeys", "No jockeys are people who are tall");
  assert.ok(p.ok, p.error);
  assert.equal(p.key, "AEE-4");
  assert.equal(p.terms.P, "people who are tall");
  assert.ok(verdict(p.syl).modern.valid);
});

test("singular statements: Socrates, and names that carry their own existence", () => {
  const socrates = parse("All men are mortal.", "Socrates is a man.", "Therefore Socrates is mortal.");
  assert.ok(socrates.ok, socrates.error);
  assert.equal(socrates.key, "AAA-1");
  assert.deepEqual(socrates.singular, ["S"]);
  assert.ok(verdict(socrates.syl, socrates.singular).modern.valid);
  // Darapti is invalid on the modern reading, but not when the middle term is a named individual.
  const named = parse("Socrates is a Greek", "Socrates is a philosopher", "Some philosophers are Greeks");
  assert.equal(named.key, "AAI-3");
  assert.deepEqual(named.singular, ["M"]);
  assert.equal(verdict(named.syl).modern.valid, false);
  assert.equal(verdict(named.syl, named.singular).modern.valid, true);
  // The cross for "Socrates is a philosopher and a Greek" is pinned in the middle region.
  assert.deepEqual(readOff(named.syl, MODERN, named.singular).inhabited, [7]);
  // Identity between two names: valid, though the same shape with general terms is an illicit minor.
  const tully = parse("Tully is Cicero", "Tully is a Roman", "Cicero is a Roman");
  assert.equal(tully.key, "AAA-3");
  assert.ok(verdict(tully.syl, tully.singular).modern.valid);
  assert.deepEqual(brokenRules(tully.syl), ["illicit-minor"]);
  assert.deepEqual(faults(tully.syl, tully.singular), { modern: [], traditional: [] });
  // Affirming the consequent with a name is still invalid.
  const bad = parse("All philosophers are mortal", "Socrates is mortal", "Socrates is a philosopher");
  assert.equal(bad.key, "AAA-2");
  assert.deepEqual(faults(bad.syl, bad.singular).modern, ["undistributed-middle"]);
});

test("named faults for the usual suspects", () => {
  const f = (mood, figure) => faults(formOf(mood, figure));
  assert.deepEqual(f("AAA", 2).modern, ["undistributed-middle"]);
  assert.deepEqual(f("AEE", 1).modern, ["illicit-major"]);
  assert.deepEqual(f("AAA", 3).modern, ["illicit-minor"]);
  assert.deepEqual(f("EEE", 1).modern, ["exclusive-premises"]);
  assert.deepEqual(f("AAI", 3), { modern: ["existential"], traditional: [] });
  assert.deepEqual(f("AAA", 1), { modern: [], traditional: [] });
  assert.equal(distributed({ form: "O", subject: "S", predicate: "P" }, "P"), true);
  assert.equal(distributed({ form: "A", subject: "S", predicate: "P" }, "P"), false);
});

test("unreadable input gets a specific message", () => {
  const err = (...lines) => { const p = parse(...lines); assert.equal(p.ok, false); return p; };
  assert.match(err("", "a is b", "c is d").error, /first premise is empty/);
  assert.equal(err("All birds fly", "x is y", "y is z").field, 0);
  assert.match(err("All birds fly", "x is y", "y is z").error, /no "is" or "are"/);
  assert.match(err("All a are b", "Most b are c", "All a are c").error, /second premise starts with "most"/);
  assert.match(err("All men are not mortal", "x is y", "y is z").error, /ambiguous/);
  assert.match(err("All men are mortal", "All dogs are animals", "All men are animals").error, /has 4: "men", "mortal", "dogs", "animals"/);
  assert.match(err("All men are mortal", "All mortals are men", "All men are mortal").error, /has 2/);
  assert.match(err("All men are men", "All men are mortal", "All mortals are men").error, /uses "men" on both sides/);
  assert.match(err("All a are b", "All a are c", "All a are d").error, /has 4/);
  assert.match(err("All a are b", "All a are c", "All a are b").error, /"a" appears 3 times and "c" appears once/);
  assert.ok(parseStatement("is").error && parseStatement("   ").error && parseStatement(null).error);
});

test("the valid forms are the ones the textbooks list, form by form", () => {
  // Typed in from the standard table, not derived from the code: the 15 forms valid on the modern reading...
  const fifteen = ["AAA-1", "EAE-1", "AII-1", "EIO-1", "EAE-2", "AEE-2", "EIO-2", "AOO-2", "AII-3", "IAI-3", "EIO-3", "OAO-3", "AEE-4", "IAI-4", "EIO-4"];
  assert.deepEqual(all.filter((r) => r.modern).map((r) => r.key).sort(), [...fifteen].sort());
  // ...and the nine more that need a term to have a member, with the term each needs.
  const nine = { "AAI-1": "S", "EAO-1": "S", "AEO-2": "S", "EAO-2": "S", "AEO-4": "S", "AAI-3": "M", "EAO-3": "M", "EAO-4": "M", "AAI-4": "P" };
  assert.deepEqual(Object.fromEntries(all.filter((r) => r.traditional && !r.modern).map((r) => [r.key, r.needs])), nine);
  // A spot check by hand. EIO-4 (Fresison): no P are M, some M are S, so some S are not P. The M that is S cannot be P.
  assert.ok(check(formOf("EIO", 4)).valid);
  // IEO-1: some M are P, no S are M, so some S are not P. Fails in a world with one thing that is M and P and nothing else: there are no S at all.
  const ieo = formOf("IEO", 1), world = 1 << 6;
  assert.ok(holds(ieo.major, world) && holds(ieo.minor, world) && !holds(ieo.conclusion, world));
});

test("the fifth rule: 32 forms break it, 9 of them break nothing else", () => {
  const fifth = all.filter((r) => r.broken.includes("existential"));
  assert.equal(fifth.length, 32);
  assert.equal(fifth.filter((r) => r.broken.length === 1).length, 9);
  assert.equal(fifth.filter((r) => r.broken.length > 1 && !r.traditional).length, 23);
  // The name is reported only for the nine; the others get their other faults.
  for (const r of fifth) assert.equal(faults(formOf(r.mood, r.figure)).modern.includes("existential"), r.broken.length === 1, r.key);
  // AAO-1: the conclusion distributes P, the major premise does not, and a negative conclusion is drawn from two affirmatives.
  assert.deepEqual(faults(formOf("AAO", 1)).modern, ["illicit-major", "negative-from-affirmatives"]);
});

test("names: the vowels spell the mood, and the variants are recorded", () => {
  for (const [key, name] of [...Object.entries(NAMES), ...Object.entries(ALSO)]) assert.equal(name.toUpperCase().replace(/[^AEIO]/g, "").slice(0, 3), key.slice(0, 3), name);
  assert.ok(Object.keys(ALSO).every((key) => NAMES[key]));
  assert.equal(fullName("AAI-4"), "Bramantip (also Bamalip)");
  assert.equal(fullName("AAA-1"), "Barbara");
  assert.equal(fullName("AAA-2"), null);
});

test("openings that are not categorical statements are refused, not misread as names", () => {
  for (const line of ["Nobody is perfect", "Everyone is mortal", "Something is rotten", "Anything is possible"]) assert.match(parseStatement(line).error, /hides the class/, line);
  for (const line of ["Two cats are pets", "At least two cats are pets", "At most one cat is a pet", "Both cats are pets", "Neither cat is a pet", "Not any cats are pets", "If it is a cat it is a pet", "There are no unicorns", "3 cats are pets"]) {
    assert.match(parseStatement(line).error, /not one of the four categorical forms/, line);
  }
  // Still read: "at least one" is "some", "no one" is a statement about "one", and a number can be a name.
  assert.equal(parseStatement("At least one cat is a pet").candidates[0].form, "I");
  assert.equal(parseStatement("No one is perfect").candidates[0].form, "E");
  assert.deepEqual(parseStatement("Two is a prime").candidates.map((c) => [c.form, c.subject, c.singular]), [["A", "Two", true]]);
  // "So" is dropped as a lead-in only when it is a word by itself.
  assert.equal(parseStatement("So-called experts are frauds").candidates[0].subject, "So-called experts");
  assert.equal(parseStatement("So, some experts are frauds").candidates[0].subject, "experts");
  assert.equal(parseStatement('All "good" things are rare').candidates[0].subject, "good things");
});

test("plurals in -ves", () => {
  assert.ok(sameTerm("wives", "a wife") && sameTerm("wolves", "wolf") && sameTerm("knives", "knife") && sameTerm("leaves", "leaf") && sameTerm("lives", "life"));
  assert.equal(parse("All wives are spouses", "Mary is a wife", "Mary is a spouse").key, "AAA-1");
});

test("a name or a kind: the two readings of 'Gold is a metal'", () => {
  // Read as an individual, Gold exists, so the argument is valid on the modern reading.
  const one = parse("Gold is a metal", "Gold is yellow", "Some metals are yellow");
  assert.deepEqual(one.singular, ["M"]);
  assert.ok(verdict(one.syl, one.singular).modern.valid);
  // The reworded lines read as a kind: Darapti, which needs there to be some gold.
  const lines = one.statements.map((st) => (st.singular ? asKind(st) : st.text));
  assert.deepEqual(lines, ["All Gold is a metal", "All Gold is yellow", "Some metals are yellow"]);
  const kind = parse(...lines);
  assert.deepEqual(kind.singular, []);
  assert.equal(kind.key, "AAI-3");
  assert.deepEqual(faults(kind.syl), { modern: ["existential"], traditional: [] });
  assert.equal(asKind({ text: "Gold is not a gas", form: "E" }), "No Gold is a gas");
  assert.equal(asKind({ text: "The whale is a mammal", form: "A" }), "All whale is a mammal");
  assert.equal(parseStatement(asKind({ text: "The whale is not a fish", form: "E" })).candidates[0].form, "E");
  // A term that is quantified anywhere in the argument is a kind, not an individual.
  const mixed = parse("Gold is a metal", "Some gold is jewellery", "Some jewellery is a metal");
  assert.deepEqual(mixed.singular, []);
  assert.ok(mixed.statements.every((st) => !st.singular));
});

test("with names, a form the readings disagree on always has one term whose existence rescues it", () => {
  // The parser can only mark a term as an individual when it is the subject of an A or E statement.
  const subsets = [[], ["S"], ["M"], ["P"], ["S", "M"], ["S", "P"], ["M", "P"], ["S", "M", "P"]];
  for (const r of all) {
    const syl = formOf(r.mood, r.figure);
    const canBeNamed = (t) => [syl.major, syl.minor, syl.conclusion].some((st) => st.subject === t && (st.form === "A" || st.form === "E"));
    for (const singular of subsets.filter((set) => set.every(canBeNamed))) {
      const v = verdict(syl, singular);
      assert.ok(v.modern.consistent && v.traditional.consistent, `${r.key} with ${singular}: the premises can be true together`);
      if (v.traditional.valid && !v.modern.valid) assert.ok(v.needs, `${r.key} with ${singular}`);
    }
  }
});
