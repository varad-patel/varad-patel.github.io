import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { T, F, U, MAX_SENTENCES, MAX_TOKENS, parse, evaluate, step, assignment, closure, classical, kripke, revision, revisionAll, analyse, ring } from "./logic.js";

const sys = (text) => { const p = parse(text); assert.ok(p.ok, p.error); return p.sentences; };
const run = (text) => analyse(sys(text));
const letters = (v) => v.map((x) => (x === T ? "T" : x === F ? "F" : "U")).join("");

test("strong Kleene tables, by hand", () => {
  const f = (text, a, b) => evaluate(sys(`A: ${text}\nB: 1 = 1\nC: 1 = 1`)[0].ast, [U, a, b]);
  // and: false wins, then unknown.
  assert.deepEqual([f("B and C", T, T), f("B and C", T, U), f("B and C", F, U), f("B and C", U, U)], [T, U, F, U]);
  // or: true wins, then unknown.
  assert.deepEqual([f("B or C", F, F), f("B or C", T, U), f("B or C", F, U), f("B or C", U, U)], [F, T, U, U]);
  assert.deepEqual([f("not B", T), f("not B", F), f("not B", U)], [F, T, U]);
  // if B then C is (not B) or C.
  assert.deepEqual([f("if B then C", T, F), f("if B then C", F, U), f("if B then C", U, T), f("if B then C", U, F), f("if B then C", T, U)], [F, T, T, U, U]);
  assert.deepEqual([f("B iff C", T, T), f("B iff C", T, F), f("B iff C", F, F), f("B iff C", T, U), f("B iff C", U, U)], [T, F, T, U, U]);
  // "is false" and "is not true" are the same claim; so are "is true" and "is not false".
  assert.deepEqual([f("B is false", T), f("B is not true", T), f("B is not false", T), f("B is true", U)], [F, F, T, U]);
});

test("the Liar: no consistent assignment, no value in any fixed point, loops for ever", () => {
  const a = run("A: this sentence is false");
  assert.equal(a.classical.consistent.length, 0);
  assert.equal(a.classical.perSentence[0].status, "none");
  assert.deepEqual(a.kripke.least, [U]);
  assert.equal(a.kripke.fixedPoints, 1);
  assert.equal(a.kripke.status[0], "paradoxical");
  assert.deepEqual(a.revision[0], { settleTrue: 0, settleFalse: 0, loop: 2, total: 2, call: "looping" });
  const r = revision(sys("A: A is false"), [T]);
  assert.deepEqual(r.sequence, [[T], [F]]);
  assert.equal(r.loopStart, 0);
  assert.equal(r.period, 2);
  assert.deepEqual(r.perSentence[0], { settles: false, value: null, settledAt: null, pattern: [T, F] });
});

test("the Truth-teller: two consistent assignments, three fixed points, keeps whatever it is given", () => {
  const a = run("A: this sentence is true");
  assert.deepEqual(a.classical.consistent, [[T], [F]]);
  assert.equal(a.classical.perSentence[0].status, "varies");
  assert.deepEqual(a.kripke.least, [U]);
  assert.equal(a.kripke.fixedPoints, 3);
  assert.equal(a.kripke.status[0], "ungrounded");
  assert.deepEqual(a.kripke.canBe[0], { true: true, false: true });
  assert.deepEqual(a.revision[0], { settleTrue: 1, settleFalse: 1, loop: 0, total: 2, call: "unsettled" });
  assert.equal(revision(sys("A: A is true"), [F]).perSentence[0].value, F);
});

test("the postcard: a loop of period four from every guess", () => {
  const s = sys("A: B is true\nB: A is false");
  const a = analyse(s);
  assert.equal(a.classical.consistent.length, 0);
  assert.deepEqual(a.kripke.status, ["paradoxical", "paradoxical"]);
  assert.deepEqual(a.revision.map((t) => t.call), ["looping", "looping"]);
  const r = revision(s, [T, T]);
  assert.deepEqual(r.sequence.map(letters), ["TT", "TF", "FF", "FT"]);
  assert.equal(r.period, 4);
});

test("rings: paradoxical exactly when the ring is odd (the finding)", () => {
  for (let n = 1; n <= MAX_SENTENCES; n++) {   // every position of the page's ring slider
    const a = run(ring(n));
    const odd = n % 2 === 1;
    assert.equal(a.classical.consistent.length, odd ? 0 : 2, `ring of ${n}`);
    assert.equal(a.kripke.fixedPoints, odd ? 1 : 3);
    assert.ok(a.kripke.status.every((s) => s === (odd ? "paradoxical" : "ungrounded")));
    assert.ok(a.revision.every((t) => t.call === (odd ? "looping" : "unsettled")));
    // An even ring settles only from its two consistent assignments; every other guess loops.
    if (!odd) for (const t of a.revision) assert.deepEqual([t.settleTrue, t.settleFalse, t.loop], [1, 1, 2 ** n - 2]);
  }
  assert.deepEqual(run(ring(8)).classical.consistent.map(letters), ["TFTFTFTF", "FTFTFTFT"]);
  assert.equal(run(ring(8)).revision[0].total, 256);
});

test("Curry's sentence is a Liar when the consequent is false and grounded when it is true", () => {
  const curry = run("C: if this sentence is true then 2 + 2 = 5");
  assert.equal(curry.classical.consistent.length, 0);
  assert.equal(curry.kripke.status[0], "paradoxical");
  assert.equal(curry.revision[0].call, "looping");
  const tame = run("C: if this sentence is true then 2 + 2 = 4");
  assert.deepEqual(tame.classical.consistent, [[T]]);
  assert.deepEqual(tame.kripke.least, [T]);
  assert.equal(tame.revision[0].call, "true");
});

test("a grounded chain gets its values one stage at a time, and all three methods agree", () => {
  const s = sys("A: 2 + 2 = 4\nB: A is true\nC: B is false\nD: C is false and A is true");
  const a = analyse(s);
  assert.deepEqual(a.kripke.stages.map(letters), ["UUUU", "TUUU", "TTUU", "TTFU", "TTFT"]);
  assert.deepEqual(a.kripke.groundedAt, [1, 2, 3, 4]);
  assert.equal(a.kripke.fixedPoints, 1);
  assert.deepEqual(a.classical.consistent.map(letters), ["TTFT"]);
  assert.deepEqual(a.classical.perSentence.map((x) => x.status), ["true", "true", "false", "true"]);
  assert.deepEqual(a.revision.map((t) => t.call), ["true", "true", "false", "true"]);
  const r = revision(s, [F, F, T, F]);
  assert.equal(letters(r.sequence.at(-1)), "TTFT");
  assert.equal(r.period, 1);
  assert.deepEqual(r.perSentence.map((x) => x.settledAt), [1, 2, 3, 4]);
});

test("where the methods part company", () => {
  // A truth that mentions a Liar: grounded and stable, but classically its part of the page has no consistent assignment.
  const a = run("L: L is false\nG: 2 + 2 = 4\nM: L is true or G is true");
  assert.deepEqual(a.kripke.status, ["paradoxical", "true", "true"]);
  assert.deepEqual(a.revision.map((t) => t.call), ["looping", "true", "true"]);
  assert.deepEqual(a.classical.perSentence.map((x) => x.status), ["none", "true", "none"]);
  assert.equal(a.classical.consistent.length, 0);
  // G never mentions the Liar, so the Liar does not spoil it.
  assert.deepEqual(closure(sys("L: L is false\nG: 2 + 2 = 4\nM: L is true or G is true"), 1), [1]);
  // A sentence that contradicts itself: ungrounded for Kripke, plainly false for the other two.
  const b = run("A: A is true and A is false");
  assert.equal(b.kripke.status[0], "ungrounded");
  assert.deepEqual(b.kripke.canBe[0], { true: false, false: true });
  assert.equal(b.classical.perSentence[0].status, "false");
  assert.equal(b.revision[0].call, "false");
  // Two sentences that each call the other false: fine classically, yet revision loops from two of the four guesses.
  const c = run(ring(2));
  assert.deepEqual(c.classical.consistent.map(letters), ["TF", "FT"]);
  assert.deepEqual(c.revision[0], { settleTrue: 1, settleFalse: 1, loop: 2, total: 4, call: "unsettled" });
});

test("a sentence that settles at every finite stage although it is built on a Liar", () => {
  // S says that A and B disagree. After two passes they always do, so S is true from then on, whatever the guess.
  const s = sys("A: A is false\nB: A is true\nS: A is true iff B is false");
  assert.deepEqual(revisionAll(s).map((t) => t.call), ["looping", "looping", "true"]);
  assert.equal(kripke(s).status[2], "paradoxical");
  for (let k = 0; k < 8; k++) {
    const r = revision(s, assignment(k, 3));
    assert.ok(r.perSentence[2].settledAt <= 2);
    // The write-up's remark about the full theory. Herzberger's limit rule: at the first infinite stage a sentence that
    // has settled keeps its value and every other sentence is false. That makes A and B agree, so S is false one stage
    // later and true again the stage after: carried through the limit, S does not settle.
    const omega = r.perSentence.map((p) => (p.settles ? p.value : F));
    assert.deepEqual(omega, [F, F, T]);
    const next = step(s, omega);
    assert.deepEqual(next, [T, F, F]);
    assert.deepEqual(step(s, next), [F, T, T]);
  }
});

test("every example on the page is what its description says", () => {
  const liar = run("A: this sentence is false");
  assert.deepEqual([liar.classical.consistent.length, liar.kripke.status[0], liar.revision[0].call], [0, "paradoxical", "looping"]);
  const teller = run("A: this sentence is true");
  assert.deepEqual([teller.classical.consistent.length, teller.kripke.status[0], teller.revision[0].call], [2, "ungrounded", "unsettled"]);
  // Jourdain's card is paradoxical; two sentences that each call the other false are not.
  const card = run("A: B is true\nB: A is false");
  assert.deepEqual([card.classical.consistent.length, ...card.kripke.status, ...card.revision.map((t) => t.call)], [0, "paradoxical", "paradoxical", "looping", "looping"]);
  for (let k = 0; k < 4; k++) assert.equal(revision(sys("A: B is true\nB: A is false"), assignment(k, 2)).period, 4);
  const accusers = run("A: B is false\nB: A is false");
  assert.deepEqual(accusers.classical.consistent.map(letters), ["TF", "FT"]);
  assert.deepEqual([...accusers.kripke.status, ...accusers.revision.map((t) => t.call)], ["ungrounded", "ungrounded", "unsettled", "unsettled"]);
  // The mixed page gets all four calls.
  const mixed = run("A: this sentence is false\nB: this sentence is true\nC: 2 + 2 = 4\nD: A is true or C is true\nE: C is false");
  assert.deepEqual(mixed.revision.map((t) => t.call), ["looping", "unsettled", "true", "true", "false"]);
  assert.deepEqual(letters(mixed.kripke.least), "UUTTF");
  assert.equal(mixed.kripke.fixedPoints, 3);
  // Contradicts itself: false classically and under revision, no value in the least fixed point.
  const both = run("A: A is true and A is false");
  assert.deepEqual([both.classical.consistent.map(letters).join(), both.revision[0].call, letters(both.kripke.least)], ["F", "false", "U"]);
});

test("Kripke's example (12), either this sentence or its negation is true: ungrounded, true in some fixed points, false in none", () => {
  const a = run("A: A is true or A is not true");
  assert.equal(a.kripke.status[0], "ungrounded");
  assert.deepEqual(a.kripke.canBe[0], { true: true, false: false });
  assert.equal(a.kripke.fixedPoints, 2);
  assert.deepEqual(a.classical.consistent, [[T]]);
  assert.equal(a.revision[0].call, "true");
});

test("awkward input: a real minus sign, a full stop, sums too large to be exact, and sentences too long to nest safely", () => {
  assert.deepEqual(sys("A: 5 \u2212 3 = 2\nB: 7 \u2212 2 \u2212 1 = 4").map((q) => q.ast.v), [T, T]);
  assert.deepEqual(sys("This sentence is false.")[0].ast, { t: "not", a: { t: "ref", name: "A", i: 0 } });
  assert.equal(sys("A: 2 + 2 = 5.")[0].ast.v, F);
  // 99999999 squared is 9999999800000001, beyond 2^53, where adding 1 changes nothing in floating point. It must not be called a truth.
  assert.equal(99999999 * 99999999 + 1 === 99999999 * 99999999, true);
  assert.match(parse("A: 99999999 * 99999999 + 1 = 99999999 * 99999999").error, /too large to work out exactly/);
  assert.equal(sys("A: 94906265 * 94906265 > 1")[0].ast.v, T);   // 9007199136250225, just inside the exact range
  assert.match(parse("A: 94906267 * 94906267 > 1").error, /too large/);
  // Deep nesting used to end in "Maximum call stack size exceeded", or in an uncaught error after parsing.
  for (const long of [`A: ${"not ".repeat(20000)}A is true`, `A: ${"A is true and ".repeat(14000)}A is true`, `A: ${"(".repeat(3000)}A${")".repeat(3000)}`]) {
    assert.match(parse(long).error, /too long; keep it to 200 words and symbols/);
  }
  const deepest = sys(`A: ${"not ".repeat(MAX_TOKENS - 1)}A`);   // exactly at the limit
  assert.equal(evaluate(deepest[0].ast, [T]), F);                 // an odd number of nots
  assert.equal(analyse(deepest).revision[0].call, "looping");
  assert.match(parse("1: this sentence is false").error, /Line 1: The name before the colon must be one word that starts with a letter/);
  assert.match(parse("My liar: this sentence is false").error, /name before the colon/);
  // A very long name would push the page sideways.
  assert.equal(sys(`${"N".repeat(20)}: this sentence is false`)[0].name.length, 20);
  assert.match(parse(`${"N".repeat(21)}: this sentence is false`).error, /Line 1: The name N{20}\.\.\. is too long\. A name can have at most 20 characters\./);
});

test("on random systems the three methods are related as the theory says", () => {
  const r = rng(21);
  const names = "ABCDE";
  const atom = () => (r.bool(0.15) ? r.pick(["1 = 1", "1 = 2"]) : `${r.pick([...names])} is ${r.pick(["true", "false"])}`);
  const formula = (depth) => (depth === 0 || r.bool(0.3) ? atom() : r.bool(0.2) ? `not (${formula(depth - 1)})` : `(${formula(depth - 1)}) ${r.pick(["and", "or", "iff"])} (${formula(depth - 1)})`);
  for (let trial = 0; trial < 300; trial++) {
    const s = sys([...names].map((n) => `${n}: ${formula(2)}`).join("\n"));
    const a = analyse(s);
    // Consistent assignments are exactly the guesses that revision leaves alone.
    for (let k = 0; k < 32; k++) {
      const v = assignment(k, 5);
      const fixed = step(s, v).every((x, i) => x === v[i]);
      assert.equal(fixed, a.classical.consistent.some((c) => c.every((x, i) => x === v[i])));
    }
    // The fast count over all guesses agrees with running every sequence one by one.
    const slow = s.map(() => ({ settleTrue: 0, settleFalse: 0, loop: 0 }));
    for (let k = 0; k < 32; k++) revision(s, assignment(k, 5)).perSentence.forEach((p, i) => { slow[i][!p.settles ? "loop" : p.value === T ? "settleTrue" : "settleFalse"]++; });
    a.revision.forEach((t, i) => assert.deepEqual([t.settleTrue, t.settleFalse, t.loop], [slow[i].settleTrue, slow[i].settleFalse, slow[i].loop]));
    s.forEach((_, i) => {
      const g = a.kripke.least[i];
      if (g === U) return;
      // Grounded: every consistent assignment agrees, and revision settles there from every guess within n passes.
      assert.ok(a.classical.consistent.every((c) => c[i] === g));
      assert.equal(a.revision[i].call, g === T ? "true" : "false");
      assert.ok(a.kripke.groundedAt[i] >= 1 && a.kripke.groundedAt[i] <= 5);
      for (let k = 0; k < 32; k++) assert.ok(revision(s, assignment(k, 5)).perSentence[i].settledAt <= a.kripke.groundedAt[i]);
    });
    // Every consistent classical assignment is one of the three-valued fixed points.
    assert.ok(a.kripke.fixedPoints >= a.classical.consistent.length + (a.kripke.least.includes(U) ? 1 : 0));
    // Paradoxical in Kripke's sense: no consistent classical value either.
    a.kripke.status.forEach((st, i) => { if (st === "paradoxical") assert.equal(a.classical.perSentence[i].status, "none"); });
  }
});

test("the language: names, this sentence, symbols, sums, and lines without a name", () => {
  const s = sys("this sentence is false\nB: ~A & (C | !B) -> A <-> C\nc: 3 * 4 - 2 >= 10\nit is not the case that this statement is not false");
  assert.deepEqual(s.map((x) => x.name), ["A", "B", "c", "D"]);
  assert.deepEqual(s.map((x) => x.refs), [[0], [0, 1, 2], [], [3]]);
  assert.deepEqual(s[2].ast, { t: "const", v: T });
  assert.equal(evaluate(s[3].ast, [U, U, U, T]), F); // D says D is false
  // Names are matched without regard to case; "if ... then" and "implies" agree; commas are ignored.
  const [x, y] = sys("x: if X is true, then Y is false\ny: X is true implies y is false").map((q) => q.ast);
  for (const v of [[T, T], [T, F], [F, T], [F, F], [U, U]]) assert.equal(evaluate(x, v), evaluate(y, v));
  assert.deepEqual(sys("A: 2 + 3 * 4 = 14\nB: 7 - 2 - 1 = 4\nC: 5 ≠ 5\nD: 2 < 3").map((q) => q.ast.v), [T, T, F, T]);
  assert.equal(sys("A: A is true if and only if B is false\nB: 1 = 1")[0].ast.t, "iff");
});

test("unreadable input is refused with the line and the reason", () => {
  const err = (text) => { const p = parse(text); assert.equal(p.ok, false, text); return p; };
  assert.match(err("").error, /at least one sentence/);
  assert.match(err("   \n  ").error, /at least one sentence/);
  assert.equal(err("A: A is false\nB: C is true").line, 2);
  assert.match(err("A: A is false\nB: C is true").error, /Line 2: "C" is not the name of a sentence here\. The names are A, B/);
  assert.match(err("A: snow is white").error, /expected "true" or "false" after "snow is" but found "white"/);
  assert.match(err("A: A and B are false\nB: 1 = 1").error, /"are" is not understood/);
  assert.match(err("A: if A is true B is false\nB: 1 = 1").error, /expected "then" but found "B"/);
  assert.match(err("A: A is false\na: A is true").error, /Line 2: a is defined twice/);
  assert.match(err("A: (A is false").error, /expected "\)" but found the end of the sentence/);
  assert.match(err("A: A is false ?").error, /cannot read the character "\?"/);
  assert.match(err("A:").error, /nothing after the name/);
  assert.match(err("then: A is true").error, /cannot be used as a name/);
  assert.match(err("A: 2 +").error, /expected a number/);
  assert.match(err("A: 2 + 2").error, /expected a comparison/);
  assert.match(err("A: A is true B is false").error, /expected "and", "or" or the end/);
  assert.match(err("A: 12345678901234567890 = 1").error, /too long/);
  assert.match(err(Array.from({ length: MAX_SENTENCES + 1 }, () => "1 = 1").join("\n")).error, /stops at 10/);
  assert.ok(parse(null).ok === false && parse(undefined).ok === false);
});
