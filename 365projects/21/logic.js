// Day 21: Liar Paradox Evaluator. The model, with no DOM code.
// A small language of sentences that talk about each other's truth, evaluated three ways:
// classical consistency, Kripke's least fixed point (strong Kleene), and revision sequences.

/** Truth values. Classical evaluation uses only T and F; U is "no value (yet)". */
export const T = 1, F = 0, U = 0.5;
export const MAX_SENTENCES = 10;

/* =================================================================== parsing */

const KEYWORDS = new Set(["and", "or", "not", "if", "then", "is", "are", "true", "false", "this", "sentence", "statement", "iff", "implies", "only", "it", "the", "case", "that"]);
const SCOPE = "A sentence here can only say that a named sentence is true or false, or state a sum such as 2 + 2 = 4.";
const TOKEN = /\s*(?:(\d+)|([A-Za-z][A-Za-z0-9_]*)|(<->|->|<=|>=|!=|&&|\|\||[()+\-*×=≠<>≤≥~¬!&∧|∨→↔]))/y;

function tokenise(src) {
  const tokens = [];
  const text = src.replace(/,/g, " ");
  let pos = 0;
  while (text.slice(pos).trim()) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) throw new Error(`cannot read the character "${text.slice(pos).trim()[0]}"`);
    if (m[1] != null) {
      if (m[1].length > 12) throw new Error(`the number ${m[1]} is too long; keep sums small`);
      tokens.push({ kind: "num", value: Number(m[1]), text: m[1] });
    } else if (m[2] != null) tokens.push({ kind: "word", value: m[2].toLowerCase(), text: m[2] });
    else tokens.push({ kind: "sym", value: m[3], text: m[3] });
    pos = TOKEN.lastIndex;
  }
  return tokens;
}

/**
 * Recursive descent, loosest binding first:  iff  <  if/then, implies  <  or  <  and  <  not  <  atom.
 * An atom is "X is true", "X is false", a bare name (meaning "X is true"), "this sentence ...",
 * a sum compared with a sum, the constants true and false, or a bracketed formula.
 */
function parseBody(src, self) {
  const tokens = tokenise(src);
  let i = 0;
  const peek = (o = 0) => tokens[i + o];
  const word = (w, o = 0) => peek(o)?.kind === "word" && peek(o).value === w;
  const sym = (...list) => peek()?.kind === "sym" && list.includes(peek().value);
  const found = () => (peek() ? `"${peek().text}"` : "the end of the sentence");
  const fail = (expected) => { throw new Error(`expected ${expected} but found ${found()}`); };

  const sum = () => {
    const product = () => {
      if (peek()?.kind !== "num") fail("a number");
      let value = tokens[i++].value;
      while (sym("*", "×")) { i++; if (peek()?.kind !== "num") fail("a number"); value *= tokens[i++].value; }
      return value;
    };
    let value = product();
    while (sym("+", "-")) value = tokens[i++].value === "+" ? value + product() : value - product();
    return value;
  };
  const atom = () => {
    if (sym("(")) {
      i++;
      const inner = iff();
      if (!sym(")")) fail('")"');
      i++;
      return inner;
    }
    if (peek()?.kind === "num") {
      const a = sum();
      if (!sym("=", "≠", "!=", "<", ">", "<=", ">=", "≤", "≥")) fail("a comparison such as = or <");
      const op = tokens[i++].value;
      const b = sum();
      const value = op === "=" ? a === b : op === "≠" || op === "!=" ? a !== b : op === "<" ? a < b : op === ">" ? a > b : op === "<=" || op === "≤" ? a <= b : a >= b;
      return { t: "const", v: value ? T : F };
    }
    if (word("true") || word("false")) return { t: "const", v: tokens[i++].value === "true" ? T : F };
    let name;
    if (word("this")) {
      i++;
      if (word("sentence") || word("statement")) i++;
      name = self;
    } else if (peek()?.kind === "word" && !KEYWORDS.has(peek().value)) name = tokens[i++].text;
    else fail('a sentence name, "this sentence", a number or "("');
    const ref = { t: "ref", name };
    if (!word("is")) return ref;
    i++;
    const negated = word("not");
    if (negated) i++;
    if (!word("true") && !word("false")) fail(`"true" or "false" after "${name} is${negated ? " not" : ""}"`);
    const positive = (tokens[i++].value === "true") !== negated;
    return positive ? ref : { t: "not", a: ref };
  };
  const not = () => {
    if (word("not") || sym("~", "¬", "!")) { i++; return { t: "not", a: not() }; }
    if (word("it") && word("is", 1) && word("not", 2) && word("the", 3) && word("case", 4) && word("that", 5)) { i += 6; return { t: "not", a: not() }; }
    return atom();
  };
  const and = () => { let left = not(); while (word("and") || sym("&", "&&", "∧")) { i++; left = { t: "and", a: left, b: not() }; } return left; };
  const or = () => { let left = and(); while (word("or") || sym("|", "||", "∨")) { i++; left = { t: "or", a: left, b: and() }; } return left; };
  const imp = () => {
    if (word("if")) {
      i++;
      const a = iff();
      if (!word("then")) fail('"then"');
      i++;
      return { t: "imp", a, b: imp() };
    }
    const left = or();
    if (word("implies") || sym("->", "→")) { i++; return { t: "imp", a: left, b: imp() }; }
    return left;
  };
  function iff() {
    let left = imp();
    for (;;) {
      if (word("iff") || sym("<->", "↔")) i++;
      else if (word("if") && word("and", 1) && word("only", 2) && word("if", 3)) i += 4;
      else return left;
      left = { t: "iff", a: left, b: imp() };
    }
  }

  if (!tokens.length) throw new Error("there is nothing after the name");
  const ast = iff();
  if (word("are")) throw new Error('"are" is not understood; make each claim on its own, as in "A is false and B is false"');
  if (i < tokens.length) fail('"and", "or" or the end of the sentence');
  return ast;
}

const refsOf = (node, out = new Set()) => {
  if (node.t === "ref") out.add(node.i);
  else if (node.a) { refsOf(node.a, out); if (node.b) refsOf(node.b, out); }
  return out;
};

/**
 * Read the definitions, one per line, as "Name: formula". A line with no name is given the next free letter.
 * Returns { ok: true, sentences: [{ name, text, ast, refs, line }] } or { ok: false, error, line }.
 */
export function parse(text) {
  const rows = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, k) => {
    const s = raw.trim();
    if (!s) return;
    const m = s.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:(.*)$/);
    rows.push(m ? { line: k + 1, name: m[1], body: m[2].trim() } : { line: k + 1, name: null, body: s });
  });
  const bad = (line, message) => ({ ok: false, line, error: line ? `Line ${line}: ${message}` : message });
  if (!rows.length) return bad(null, 'Type at least one sentence, for example "this sentence is false".');
  if (rows.length > MAX_SENTENCES) return bad(null, `There are ${rows.length} sentences. The evaluator tries every combination of values, so it stops at ${MAX_SENTENCES}.`);

  const index = new Map(); // upper-case name -> position
  for (const [k, r] of rows.entries()) {
    if (!r.name) continue;
    if (KEYWORDS.has(r.name.toLowerCase())) return bad(r.line, `"${r.name}" is a word of the language and cannot be used as a name.`);
    if (index.has(r.name.toUpperCase())) return bad(r.line, `${r.name} is defined twice. Give each sentence its own name.`);
    index.set(r.name.toUpperCase(), k);
  }
  for (const [k, r] of rows.entries()) {
    if (r.name) continue;
    r.name = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => !index.has(c));
    index.set(r.name, k);
  }

  const sentences = [];
  for (const r of rows) {
    let ast;
    try { ast = parseBody(r.body, r.name); } catch (e) { return bad(r.line, `${e.message}. ${SCOPE}`); }
    let unknown = null;
    const resolve = (node) => {
      if (node.t === "ref") { node.i = index.get(node.name.toUpperCase()); if (node.i == null) unknown ??= node.name; }
      else if (node.a) { resolve(node.a); if (node.b) resolve(node.b); }
    };
    resolve(ast);
    if (unknown) return bad(r.line, `"${unknown}" is not the name of a sentence here. The names are ${rows.map((x) => x.name).join(", ")}. ${SCOPE}`);
    sentences.push({ name: r.name, text: r.body, ast, refs: [...refsOf(ast)].sort((a, b) => a - b), line: r.line });
  }
  return { ok: true, sentences };
}

/* ================================================================ evaluation */

/**
 * The value of a formula given a value for every sentence. With T = 1, F = 0 and U = 0.5, strong Kleene
 * logic is: not x = 1 - x, and = min, or = max, and "if a then b" = (not a) or b. On T and F alone this is classical logic.
 */
export function evaluate(node, v) {
  switch (node.t) {
    case "const": return node.v;
    case "ref": return v[node.i];
    case "not": return 1 - evaluate(node.a, v);
    case "and": return Math.min(evaluate(node.a, v), evaluate(node.b, v));
    case "or": return Math.max(evaluate(node.a, v), evaluate(node.b, v));
    case "imp": return Math.max(1 - evaluate(node.a, v), evaluate(node.b, v));
    default: { // iff
      const a = evaluate(node.a, v), b = evaluate(node.b, v);
      return Math.min(Math.max(1 - a, b), Math.max(1 - b, a));
    }
  }
}

/** One pass: what each sentence comes out as if the sentences it mentions have the values in v. */
export const step = (sentences, v) => sentences.map((s) => evaluate(s.ast, v));
const same = (a, b) => a.every((x, i) => x === b[i]);

/** Assignment number k of 2^n, ordered so that the first sentence varies slowest and true comes first: TT, TF, FT, FF. */
export const assignment = (k, n) => Array.from({ length: n }, (_, i) => 1 - ((k >> (n - 1 - i)) & 1));

/** Every sentence that sentence i depends on, directly or through others, itself included. */
export function closure(sentences, i) {
  const seen = new Set([i]);
  const queue = [i];
  while (queue.length) for (const j of sentences[queue.pop()].refs) if (!seen.has(j)) { seen.add(j); queue.push(j); }
  return [...seen].sort((a, b) => a - b);
}

/* ---------- 1. classical consistency ---------- */

/**
 * Try every assignment of true and false. An assignment is consistent when every sentence comes out with the
 * value it was given. Each sentence is also judged on its own part of the system (the sentences it depends on),
 * so that a Liar elsewhere on the page does not spoil a sentence that never mentions it.
 */
export function classical(sentences) {
  const n = sentences.length;
  const consistent = [];
  for (let k = 0; k < 1 << n; k++) { const v = assignment(k, n); if (same(step(sentences, v), v)) consistent.push(v); }
  const perSentence = sentences.map((_, i) => {
    const group = closure(sentences, i);
    let of = 0, trueIn = 0;
    const v = new Array(n).fill(F);
    for (let k = 0; k < 1 << group.length; k++) {
      group.forEach((j, b) => { v[j] = (k >> b) & 1; });
      if (group.every((j) => evaluate(sentences[j].ast, v) === v[j])) { of++; trueIn += v[i]; }
    }
    return { of, trueIn, group, status: of === 0 ? "none" : trueIn === of ? "true" : trueIn === 0 ? "false" : "varies" };
  });
  return { total: 1 << n, consistent, perSentence };
}

/* ---------- 2. Kripke's least fixed point ---------- */

/**
 * Start with no sentence having a value and re-evaluate with strong Kleene logic until nothing changes.
 * Values are only ever added, so this stops within n passes at the least fixed point. Then every other
 * fixed point is found by trying all values for the sentences left over: a sentence that gets true or
 * false in none of them is paradoxical in Kripke's sense.
 */
export function kripke(sentences) {
  const n = sentences.length;
  const stages = [new Array(n).fill(U)];
  for (;;) {
    const next = step(sentences, stages.at(-1));
    if (same(next, stages.at(-1))) break;
    stages.push(next);
  }
  const least = stages.at(-1);
  const groundedAt = least.map((x, i) => (x === U ? null : stages.findIndex((st) => st[i] !== U)));
  const open = least.flatMap((x, i) => (x === U ? [i] : []));
  const canBe = sentences.map((_, i) => ({ true: least[i] === T, false: least[i] === F }));
  let fixedPoints = 0;
  const v = [...least];
  for (let code = 0; code < 3 ** open.length; code++) {
    let c = code;
    for (const i of open) { v[i] = (c % 3) / 2; c = Math.floor(c / 3); }
    if (!same(step(sentences, v), v)) continue;
    fixedPoints++;
    for (const i of open) { if (v[i] === T) canBe[i].true = true; if (v[i] === F) canBe[i].false = true; }
  }
  const status = least.map((x, i) => (x === T ? "true" : x === F ? "false" : canBe[i].true || canBe[i].false ? "ungrounded" : "paradoxical"));
  return { stages, least, groundedAt, fixedPoints, canBe, status };
}

/* ---------- 3. revision sequences ---------- */

/**
 * Start from a guess (an array of T and F), re-evaluate every sentence classically against the previous
 * stage, and repeat. There are finitely many assignments, so the sequence must return to one it has
 * visited: loopStart is the first stage of the repeating part and period its length.
 */
export function revision(sentences, start) {
  const sequence = [start.map((x) => (x ? T : F))];
  const seen = new Map([[sequence[0].join(""), 0]]);
  let loopStart;
  for (;;) {
    const next = step(sentences, sequence.at(-1));
    const key = next.join("");
    if (seen.has(key)) { loopStart = seen.get(key); break; }
    seen.set(key, sequence.length);
    sequence.push(next);
  }
  const loop = sequence.slice(loopStart);
  const perSentence = sentences.map((_, i) => {
    const pattern = loop.map((v) => v[i]);
    const settles = pattern.every((x) => x === pattern[0]);
    let settledAt = null;
    if (settles) { settledAt = loopStart; while (settledAt > 0 && sequence[settledAt - 1][i] === pattern[0]) settledAt--; }
    return { settles, value: settles ? pattern[0] : null, settledAt, pattern };
  });
  return { sequence, loopStart, period: loop.length, perSentence };
}

/**
 * Run the revision from every one of the 2^n starting guesses. The call for each sentence:
 * "true" or "false" if it settles on that value whatever the guess, "looping" if it never settles,
 * and "unsettled" if the outcome depends on the guess.
 */
export function revisionAll(sentences) {
  const n = sentences.length, N = 1 << n;
  // The revision rule as a map on assignment numbers. In a number, a set bit means "false" (see assignment()).
  const next = new Int32Array(N);
  for (let k = 0; k < N; k++) next[k] = step(sentences, assignment(k, n)).reduce((code, x) => (code << 1) | (1 - x), 0);
  // For every start, the AND and OR of the assignments on the loop it falls into. A bit that is 0 in the OR
  // is a sentence true all round the loop; a bit that is 1 in the AND is one false all round it.
  const all = new Int32Array(N), any = new Int32Array(N), done = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    const path = [];
    let x = s;
    while (!done[x]) { done[x] = 1; path.push(x); x = next[x]; }
    if (done[x] === 1) { // closed a new loop at x
      let a = x, o = x;
      for (let y = next[x]; y !== x; y = next[y]) { a &= y; o |= y; }
      let y = x;
      do { all[y] = a; any[y] = o; done[y] = 2; y = next[y]; } while (y !== x);
    }
    for (let i = path.length - 1; i >= 0; i--) { const p = path[i]; if (done[p] !== 2) { all[p] = all[next[p]]; any[p] = any[next[p]]; done[p] = 2; } }
  }
  const tally = sentences.map(() => ({ settleTrue: 0, settleFalse: 0, loop: 0, total: N }));
  for (let k = 0; k < N; k++) for (let i = 0; i < n; i++) {
    const bit = 1 << (n - 1 - i);
    tally[i][!(any[k] & bit) ? "settleTrue" : all[k] & bit ? "settleFalse" : "loop"]++;
  }
  for (const t of tally) t.call = t.settleTrue === t.total ? "true" : t.settleFalse === t.total ? "false" : t.loop === t.total ? "looping" : "unsettled";
  return tally;
}

/** All three evaluations of a parsed system. */
export const analyse = (sentences) => ({ classical: classical(sentences), kripke: kripke(sentences), revision: revisionAll(sentences) });

/** A ring of n sentences, each saying that the next one is false (the last points back to the first). */
export const ring = (n) => Array.from({ length: n }, (_, i) => `${"ABCDEFGHIJ"[i]}: ${"ABCDEFGHIJ"[(i + 1) % n]} is false`).join("\n");
