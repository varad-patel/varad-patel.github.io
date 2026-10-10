import test from "node:test";
import assert from "node:assert/strict";
import { parse, show, evaluate, analyse, steps, variables, subformulas, assignment, normalForms, MAX_VARS } from "./logic.js";

const one = (text) => parse(text).premises[0];
const kind = (text) => analyse(text).verdict.kind;
const column = (text) => { const r = analyse(text); const i = r.columns.findIndex((c) => c.kind === "main"); return r.rows.map((row) => row.values[i]); };

test("connectives bind in the standard order: ¬, ∧, ⊕, ∨, →, ↔", () => {
  assert.equal(show(one("¬p ∧ q")), "¬p ∧ q");
  assert.deepEqual(one("p ∨ q ∧ r"), { op: "or", a: { op: "var", name: "p" }, b: { op: "and", a: { op: "var", name: "q" }, b: { op: "var", name: "r" } } });
  assert.equal(one("p ∧ q → r ∨ s").op, "imp");
  assert.equal(one("p → q ↔ r").op, "iff");
  assert.equal(one("p ⊕ q ∨ r").op, "or");
});

test("→ groups to the right, the others to the left", () => {
  const imp = one("p → q → r");
  assert.equal(imp.b.op, "imp");
  assert.equal(show(imp), "p → q → r");
  assert.equal(show(one("(p → q) → r")), "(p → q) → r");
  assert.equal(one("p ∧ q ∧ r").a.op, "and");
  assert.equal(show(one("p ∧ (q ∧ r)")), "p ∧ (q ∧ r)");
});

test("printing keeps exactly the brackets that matter", () => {
  for (const text of ["¬(p ∧ q)", "(p ∨ q) ∧ r", "p ∨ q ∧ r", "¬¬p", "(p → q) ∧ (q → p)", "((p → q) → p) → p", "p ↔ (q ↔ r)", "¬(p → q) ∨ r"]) {
    assert.equal(show(one(text)), text);
    assert.deepEqual(one(show(one(text))), one(text), `round trip of ${text}`);
  }
});

test("every spelling of a connective parses to the same tree", () => {
  assert.deepEqual(one("p and q"), one("p ∧ q"));
  assert.deepEqual(one("p && q"), one("p & q"));
  assert.deepEqual(one("not p or q"), one("~p | q"));
  assert.deepEqual(one("p -> q"), one("p implies q"));
  assert.deepEqual(one("p <-> q"), one("p iff q"));
  assert.deepEqual(one("p <=> q"), one("p = q"));
  assert.deepEqual(one("[p xor q]"), one("(p ^ q)"));
  assert.deepEqual(one("p ∧ 1"), one("p ∧ true"));
  assert.deepEqual(one("P ∧ p").b, { op: "var", name: "p" });
  assert.notDeepEqual(one("P"), one("p"));
});

test("each connective has the right truth table", () => {
  assert.deepEqual(column("p ∧ q"), [true, false, false, false]);
  assert.deepEqual(column("p ∨ q"), [true, true, true, false]);
  assert.deepEqual(column("p → q"), [true, false, true, true]);
  assert.deepEqual(column("p ↔ q"), [true, false, false, true]);
  assert.deepEqual(column("p ⊕ q"), [false, true, true, false]);
  assert.deepEqual(column("p ↑ q"), [false, true, true, true]);
  assert.deepEqual(column("p ↓ q"), [false, false, false, true]);
  assert.deepEqual(column("¬p"), [false, true]);
});

test("tautologies, contradictions and contingent formulas are told apart", () => {
  for (const t of ["p ∨ ¬p", "((p → q) → p) → p", "¬(p ∧ q) ↔ (¬p ∨ ¬q)", "(p → q) ↔ (¬q → ¬p)", "p → (q → p)", "⊤", "(p ⊕ q) ↔ ¬(p ↔ q)"]) assert.equal(kind(t), "tautology", t);
  for (const t of ["p ∧ ¬p", "⊥", "(p ↔ q) ∧ (p ⊕ q)"]) assert.equal(kind(t), "contradiction", t);
  for (const t of ["p", "p → q", "(p → q) → (q → p)"]) assert.equal(kind(t), "contingent", t);
  const r = analyse("p → q");
  assert.equal(r.verdict.trueRows, 3);
  assert.equal(r.verdict.rows, 4);
});

test("arguments: valid forms have no counterexample row, invalid forms name theirs", () => {
  for (const a of ["p → q, p ⊢ q", "p → q, ¬q ⊢ ¬p", "p → q, q → r ⊢ p → r", "p ∨ q, ¬p ⊢ q", "p ∧ ¬p ⊢ q", "⊢ p ∨ ¬p", "p -> q, p |- q", "p → q, p therefore q"]) {
    assert.equal(analyse(a).verdict.valid, true, a);
  }
  const bad = analyse("p → q, q ⊢ p");
  assert.equal(bad.verdict.valid, false);
  // The finding on the page: exactly one of four rows breaks it, p false and q true.
  assert.equal(bad.rows.length, 4);
  assert.deepEqual(bad.verdict.counterexamples.map((i) => bad.rows[i].env), [{ p: false, q: true }]);
  assert.equal(analyse("p → q, ¬p ⊢ ¬q").verdict.valid, false);
  assert.equal(analyse("p ∧ ¬p ⊢ q").verdict.premisesTogetherTrue, 0);
});

test("several formulas without ⊢ are compared for equivalence", () => {
  const r = analyse("p → q, ¬p ∨ q, q → p");
  assert.equal(r.verdict.type, "set");
  const pair = (a, b) => r.verdict.pairs.find((x) => x.a === a && x.b === b);
  assert.equal(pair("p → q", "¬p ∨ q").equivalent, true);
  assert.equal(pair("p → q", "q → p").equivalent, false);
  assert.equal(pair("p → q", "q → p").differ.length, 2);
});

test("rows run from all true to all false, and columns include each subformula once", () => {
  assert.deepEqual(assignment(["p", "q"], 0), { p: true, q: true });
  assert.deepEqual(assignment(["p", "q"], 1), { p: true, q: false });
  assert.deepEqual(assignment(["p", "q"], 3), { p: false, q: false });
  const r = analyse("(p → q) ∧ ¬q → ¬p");
  assert.deepEqual(r.vars, ["p", "q"]);
  assert.deepEqual(r.columns.map((c) => c.text), ["p → q", "¬q", "(p → q) ∧ ¬q", "¬p", "(p → q) ∧ ¬q → ¬p"]);
  assert.equal(r.columns.at(-1).kind, "main");
  assert.equal(subformulas([one("(p ∧ q) ∨ (p ∧ q)")]).length, 2);
  assert.deepEqual(variables([one("q ∧ p ∧ q")]), ["q", "p"]);
});

test("step-by-step evaluation substitutes values innermost first", () => {
  const r = analyse("(p → q) ∧ ¬q");
  const s = steps(r, 1); // p true, q false
  assert.deepEqual(s, [
    { formula: "p → q", working: "T → F", value: false },
    { formula: "¬q", working: "¬F", value: true },
    { formula: "(p → q) ∧ ¬q", working: "F ∧ T", value: false },
  ]);
});

test("normal forms read off the table are equivalent to the formula", () => {
  for (const text of ["p → q", "p ⊕ q ⊕ r", "(p ∨ q) ∧ ¬r", "p ↔ q", "p"]) {
    const r = analyse(text);
    assert.deepEqual(column(r.normal.dnf), column(text), `DNF of ${text}: ${r.normal.dnf}`);
    assert.deepEqual(column(r.normal.cnf), column(text), `CNF of ${text}: ${r.normal.cnf}`);
  }
  assert.equal(analyse("p ∧ ¬p").normal.dnf, "⊥");
  assert.equal(analyse("p ∨ ¬p").normal.cnf, "⊤");
  assert.equal(analyse("p → q").normal.cnf, "¬p ∨ q");
  assert.deepEqual(normalForms([], [{ env: {} }], [true]), { dnf: "⊤", cnf: "⊤" });
});

test("bad input gets a specific message and a position", () => {
  const err = (t) => analyse(t).error;
  assert.match(err(""), /Type a formula/);
  assert.match(err("   "), /Type a formula/);
  assert.match(err("p ∧"), /Something is missing at the end/);
  assert.match(err("(p ∧ q"), /never closed/);
  assert.match(err("p ∧ q)"), /nothing to close/);
  assert.match(err("p q"), /no connective between them/);
  assert.match(err("p ∧ ∨ q"), /Expected a letter/);
  assert.match(err("p # q"), /not a symbol/);
  assert.match(err("p ⊢ q ⊢ r"), /only one ⊢/);
  assert.match(err("p ⊢ q, r"), /only one conclusion/);
  assert.equal(analyse("p ∧ $").pos, 4);
  const many = Array.from({ length: MAX_VARS + 1 }, (_, i) => `x${i}`).join(" ∧ ");
  assert.match(err(many), /limit is 10 letters/);
  assert.equal(analyse(Array.from({ length: MAX_VARS }, (_, i) => `x${i}`).join(" ∧ ")).rows.length, 1024);
});

test("evaluate agrees with JavaScript on a nested formula", () => {
  const f = one("(a → b) ∧ (¬c ∨ a) ↔ b ⊕ c");
  for (let i = 0; i < 8; i++) {
    const env = assignment(["a", "b", "c"], i);
    const { a, b, c } = env;
    assert.equal(evaluate(f, env), (((!a || b) && (!c || a)) === (b !== c)));
  }
});
