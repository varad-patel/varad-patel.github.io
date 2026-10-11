// Day 2: Truth Table Playground. Parser and evaluator for propositional logic, with no DOM code.

export const MAX_VARS = 10;
export const MAX_LENGTH = 1000;
const MAX_DEPTH = 100;

const WORDS = {
  not: "not", and: "and", or: "or", xor: "xor", nand: "nand", nor: "nor",
  implies: "imp", iff: "iff", therefore: "turnstile", true: "true", false: "false",
};
// Longest spellings first so "<->" is not read as "<" followed by "->".
const SYMBOLS = [
  ["<->", "iff"], ["<=>", "iff"], ["->", "imp"], ["=>", "imp"], ["&&", "and"], ["||", "or"], ["|-", "turnstile"], ["==", "iff"], ["!=", "xor"],
  ["¬", "not"], ["~", "not"], ["!", "not"], ["∧", "and"], ["&", "and"], ["·", "and"], ["∨", "or"], ["|", "or"],
  ["⊕", "xor"], ["^", "xor"], ["→", "imp"], ["⇒", "imp"], ["↔", "iff"], ["⇔", "iff"], ["=", "iff"],
  ["↑", "nand"], ["↓", "nor"], ["⊢", "turnstile"], ["∴", "turnstile"], ["⊤", "true"], ["⊥", "false"],
  ["(", "("], [")", ")"], ["[", "("], ["]", ")"], [",", "sep"], [";", "sep"],
];
export const GLYPH = { not: "¬", and: "∧", or: "∨", xor: "⊕", imp: "→", iff: "↔", nand: "↑", nor: "↓" };
const PREC = { iff: 1, imp: 2, or: 3, nor: 3, xor: 4, and: 5, nand: 5, not: 6 };
const NAME = { not: "¬", and: "∧", or: "∨", xor: "⊕", imp: "→", iff: "↔", nand: "↑", nor: "↓", turnstile: "⊢", sep: "a comma", "(": "(", ")": ")", true: "⊤", false: "⊥" };

class ParseError extends Error {
  constructor(message, pos) { super(message); this.pos = pos; }
}

export function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    // Any alphabet will do for a letter, so φ → ψ works as well as p → q.
    const word = /^[\p{L}_][\p{L}\p{N}_']*/u.exec(text.slice(i));
    if (word) {
      const w = word[0];
      const key = WORDS[w.toLowerCase()];
      tokens.push(key ? { type: key, pos: i, raw: w } : { type: "var", name: w, pos: i, raw: w });
      i += w.length;
      continue;
    }
    if (ch === "1" || ch === "0") { tokens.push({ type: ch === "1" ? "true" : "false", pos: i, raw: ch }); i++; continue; }
    const sym = SYMBOLS.find(([s]) => text.startsWith(s, i));
    if (!sym) throw new ParseError(`"${ch}" is not a symbol this page understands.`, i);
    tokens.push({ type: sym[1], pos: i, raw: sym[0] });
    i += sym[0].length;
  }
  return tokens;
}

function parseTokens(tokens, textLength) {
  let k = 0;
  const peek = () => tokens[k];
  const at = (...types) => peek() && types.includes(peek().type);
  const describe = (t) => (t ? `"${t.raw}"` : "the end of the formula");
  const where = (t) => (t ? t.pos : textLength);
  const startsFormula = (t) => t && ["var", "(", "not", "true", "false"].includes(t.type);
  const meet = (t) => new ParseError(`Two formulas meet at position ${t.pos + 1} with no connective between them. Add ∧, ∨, → or a comma.`, t.pos);
  const open = []; // the brackets currently open, innermost last

  const binary = (next, ops, rightAssoc = false) => function level() {
    let left = next();
    while (at(...ops)) {
      const op = tokens[k++].type;
      if (rightAssoc) return { op, a: left, b: level() };
      left = { op, a: left, b: next() };
    }
    return left;
  };
  function unary() {
    if (at("not")) { k++; return { op: "not", a: unary() }; }
    return atom();
  }
  function atom() {
    const t = peek();
    if (!t) throw new ParseError(k === 0 ? "Type a formula, for example p → q." : `The formula stops after ${describe(tokens[k - 1])}. Something is missing at the end.`, textLength);
    if (t.type === "var") { k++; return { op: "var", name: t.name }; }
    if (t.type === "true" || t.type === "false") { k++; return { op: "const", value: t.type === "true" }; }
    if (t.type === "(") {
      if (open.length >= MAX_DEPTH) throw new ParseError(`Brackets are nested more than ${MAX_DEPTH} deep at position ${t.pos + 1}. That is as far as this page goes.`, t.pos);
      k++;
      if (at(")")) throw new ParseError(`The brackets at position ${t.pos + 1} are empty. Put a formula inside them or remove them.`, t.pos);
      open.push(t);
      const inner = formula();
      const next = peek();
      if (!at(")")) {
        if (startsFormula(next)) throw meet(next);
        if (next && (next.type === "sep" || next.type === "turnstile")) throw new ParseError(`${next.type === "sep" ? "A comma" : "⊢"} cannot go inside brackets (position ${next.pos + 1}). It separates whole formulas.`, next.pos);
        throw new ParseError(`A bracket opened at position ${t.pos + 1} is never closed.`, where(next));
      }
      // Round and square brackets both work, but a pair must be of one kind.
      if ((t.raw === "(") !== (next.raw === ")")) throw new ParseError(`The bracket opened with ${t.raw} at position ${t.pos + 1} is closed with ${next.raw} at position ${next.pos + 1}. Use the same kind for both.`, next.pos);
      open.pop();
      k++;
      return inner;
    }
    if (t.type === ")") {
      throw open.length
        ? new ParseError(`Something is missing before the closing bracket at position ${t.pos + 1}.`, t.pos)
        : new ParseError(`There is a closing bracket at position ${t.pos + 1} with nothing to close.`, t.pos);
    }
    throw new ParseError(`Expected a letter, a bracket or ¬ at position ${t.pos + 1}, but found ${describe(t)}.`, t.pos);
  }
  const and = binary(unary, ["and", "nand"]);
  const xor = binary(and, ["xor"]);
  const or = binary(xor, ["or", "nor"]);
  const imp = binary(or, ["imp"], true);
  const iff = binary(imp, ["iff"]);
  function formula() { return iff(); }

  const premises = [];
  let conclusion = null;
  let sawTurnstile = false;
  if (!tokens.length) throw new ParseError("Type a formula, for example p → q.", 0);
  if (at("turnstile")) { k++; sawTurnstile = true; conclusion = formula(); }
  else {
    premises.push(formula());
    while (at("sep")) { k++; premises.push(formula()); }
    if (at("turnstile")) { k++; sawTurnstile = true; conclusion = formula(); }
  }
  if (k < tokens.length) {
    const t = peek();
    if (startsFormula(t)) throw meet(t);
    if (t.type === "turnstile") throw new ParseError("Use only one ⊢. Everything before it is a premise and the one formula after it is the conclusion.", t.pos);
    if (t.type === "sep") throw new ParseError("After ⊢ there can be only one conclusion.", t.pos);
    if (t.type === ")") throw new ParseError(`There is a closing bracket at position ${t.pos + 1} with nothing to close.`, t.pos);
    throw new ParseError(`Unexpected ${describe(t)} at position ${t.pos + 1}.`, t.pos);
  }
  return { premises, conclusion, isArgument: sawTurnstile };
}

/** Parse text into { premises: [ast], conclusion: ast | null, isArgument }. Throws an Error with .pos on bad input (pos is null when no one place is at fault). */
export function parse(text) {
  if (text.length > MAX_LENGTH) throw new ParseError(`This is ${text.length.toLocaleString("en-GB")} characters long. The limit is ${MAX_LENGTH.toLocaleString("en-GB")}.`, null);
  return parseTokens(tokenize(text), text.length);
}

/** Print a formula with standard symbols and only the brackets it needs. */
export function show(node, parent = 0, side = "") {
  if (node.op === "var") return node.name;
  if (node.op === "const") return node.value ? "⊤" : "⊥";
  if (node.op === "not") return `¬${show(node.a, PREC.not, "a")}`;
  const p = PREC[node.op];
  const text = `${show(node.a, p, "L")} ${GLYPH[node.op]} ${show(node.b, p, "R")}`;
  // Left-associative connectives need brackets on a right child of equal rank; → is right-associative, so the reverse.
  const needs = p < parent || (p === parent && (node.op === "imp" ? side === "L" : side === "R")) || (p === parent && parent === PREC.imp && side === "L");
  return needs ? `(${text})` : text;
}

export function evaluate(node, env) {
  switch (node.op) {
    case "var": return env[node.name];
    case "const": return node.value;
    case "not": return !evaluate(node.a, env);
    case "and": return evaluate(node.a, env) && evaluate(node.b, env);
    case "or": return evaluate(node.a, env) || evaluate(node.b, env);
    case "xor": return evaluate(node.a, env) !== evaluate(node.b, env);
    case "imp": return !evaluate(node.a, env) || evaluate(node.b, env);
    case "iff": return evaluate(node.a, env) === evaluate(node.b, env);
    case "nand": return !(evaluate(node.a, env) && evaluate(node.b, env));
    case "nor": return !(evaluate(node.a, env) || evaluate(node.b, env));
    default: throw new Error(`unknown connective ${node.op}`);
  }
}

/** Variables in order of first appearance. */
export function variables(nodes) {
  const seen = [];
  const walk = (n) => {
    if (n.op === "var") { if (!seen.includes(n.name)) seen.push(n.name); }
    else if (n.op !== "const") { walk(n.a); if (n.b) walk(n.b); }
  };
  nodes.forEach(walk);
  return seen;
}

/** Every compound subformula once, innermost first. */
export function subformulas(nodes) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (n.op === "var" || n.op === "const") return;
    walk(n.a);
    if (n.b) walk(n.b);
    const text = show(n);
    if (!seen.has(text)) { seen.add(text); out.push({ text, ast: n }); }
  };
  nodes.forEach(walk);
  return out;
}

/** Assignment number i of 2^n, with the all-true row first, as textbooks print them. */
export function assignment(vars, i) {
  const n = vars.length;
  return Object.fromEntries(vars.map((v, j) => [v, !((i >> (n - 1 - j)) & 1)]));
}

const classify = (values) => {
  const t = values.filter(Boolean).length;
  return { kind: t === values.length ? "tautology" : t === 0 ? "contradiction" : "contingent", trueRows: t, rows: values.length };
};

/** Canonical disjunctive and conjunctive normal forms read off the table. */
export function normalForms(vars, rows, values) {
  if (!vars.length) return { dnf: values[0] ? "⊤" : "⊥", cnf: values[0] ? "⊤" : "⊥" };
  const term = (env, positive, join) => vars.map((v) => (env[v] === positive ? v : `¬${v}`)).join(join);
  const minterms = rows.filter((_, i) => values[i]).map((r) => term(r.env, true, " ∧ "));
  const maxterms = rows.filter((_, i) => !values[i]).map((r) => term(r.env, false, " ∨ "));
  const wrap = (list, join) => (list.length === 1 ? list[0] : list.map((t) => (vars.length > 1 ? `(${t})` : t)).join(join));
  return { dnf: minterms.length ? wrap(minterms, " ∨ ") : "⊥", cnf: maxterms.length ? wrap(maxterms, " ∧ ") : "⊤" };
}

/**
 * Full analysis of an input line. Returns { error, pos } on bad input, otherwise:
 * vars, columns [{ text, kind: "sub" | "main", role }], rows [{ env, values }], and a verdict.
 */
export function analyse(text) {
  let parsed;
  try { parsed = parse(text); } catch (e) {
    // Anything but a ParseError here is the JavaScript engine running out of stack on a very long formula.
    return e instanceof ParseError ? { error: e.message, pos: e.pos } : { error: "This formula is too long for the page to work through. Try a shorter one.", pos: null };
  }
  const mains = [...parsed.premises, ...(parsed.conclusion ? [parsed.conclusion] : [])];
  const vars = variables(mains);
  if (vars.length > MAX_VARS) {
    return { error: `This uses ${vars.length} letters, which would need ${(2 ** vars.length).toLocaleString("en-GB")} rows. The limit is ${MAX_VARS} letters.`, pos: null };
  }
  const mainText = mains.map((m) => show(m));
  // A formula can be typed more than once, so a column can be a premise and the conclusion at the same time.
  const roleOf = (text) => {
    if (!mainText.includes(text)) return null;
    if (!parsed.isArgument) return "formula";
    const premise = parsed.premises.some((_, i) => mainText[i] === text);
    const conclusion = mainText[mainText.length - 1] === text;
    return premise && conclusion ? "premise and conclusion" : premise ? "premise" : "conclusion";
  };
  const subs = subformulas(mains);
  const columns = subs.map((s) => ({ text: s.text, ast: s.ast, kind: mainText.includes(s.text) ? "main" : "sub", role: roleOf(s.text) }));
  // A main formula that is a bare letter or constant has no column of its own yet.
  mains.forEach((m, i) => {
    if ((m.op === "var" || m.op === "const") && !columns.some((c) => c.text === mainText[i])) columns.push({ text: mainText[i], ast: m, kind: "main", role: roleOf(mainText[i]) });
  });

  const rows = [];
  for (let i = 0; i < 2 ** vars.length; i++) {
    const env = assignment(vars, i);
    rows.push({ env, values: columns.map((c) => evaluate(c.ast, env)) });
  }
  const column = (ast) => rows.map((r) => evaluate(ast, r.env));
  const result = { vars, columns, rows, premises: parsed.premises.map((p) => show(p)), conclusion: parsed.conclusion ? show(parsed.conclusion) : null, isArgument: parsed.isArgument };

  if (parsed.isArgument) {
    const prem = parsed.premises.map(column);
    const concl = column(parsed.conclusion);
    const counter = rows.map((_, i) => i).filter((i) => prem.every((p) => p[i]) && !concl[i]);
    const allTrue = rows.map((_, i) => i).filter((i) => prem.every((p) => p[i]));
    result.verdict = { type: "argument", valid: counter.length === 0, counterexamples: counter, premisesTogetherTrue: allTrue.length, premiseValues: prem, conclusionValues: concl };
  } else if (mains.length === 1) {
    const values = column(mains[0]);
    result.verdict = { type: "formula", ...classify(values) };
    result.normal = normalForms(vars, rows, values);
  } else {
    const cols = mains.map(column);
    const same = (a, b) => a.every((v, i) => v === b[i]);
    const pairs = [];
    for (let a = 0; a < mains.length; a++) for (let b = a + 1; b < mains.length; b++) pairs.push({ a: mainText[a], b: mainText[b], equivalent: same(cols[a], cols[b]), differ: cols[a].map((v, i) => (v !== cols[b][i] ? i : -1)).filter((i) => i >= 0) });
    result.verdict = { type: "set", pairs, each: mains.map((m, i) => ({ text: mainText[i], ...classify(cols[i]) })), jointlyTrue: rows.map((_, i) => i).filter((i) => cols.every((c) => c[i])).length };
  }
  return result;
}

/** Step-by-step evaluation of one row: each compound subformula with its parts replaced by their values. */
export function steps(result, rowIndex, mark = (v) => (v ? "T" : "F")) {
  const env = result.rows[rowIndex].env;
  const valueOf = (n) => mark(evaluate(n, env));
  return result.columns.filter((c) => c.ast.op !== "var" && c.ast.op !== "const").map((c) => {
    const n = c.ast;
    const working = n.op === "not" ? `¬${valueOf(n.a)}` : `${valueOf(n.a)} ${GLYPH[n.op]} ${valueOf(n.b)}`;
    return { formula: c.text, working, value: evaluate(n, env) };
  });
}
