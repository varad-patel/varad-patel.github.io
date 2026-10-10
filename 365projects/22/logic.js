// Day 22: Gödel Numbering Encoder. The model, with no DOM code.
// A small language of arithmetic, a code for each symbol, and the map between strings of symbols and
// whole numbers: the string with codes c1, c2, c3, ... becomes 2^c1 × 3^c2 × 5^c3 × ...

/* ============================================================== the language */

/** Every symbol of the language with its code. `keys` are other ways to type it. */
export const SYMBOLS = [
  { code: 1, glyph: "0", name: "zero" },
  { code: 2, glyph: "S", name: "successor: the next number", keys: ["s"] },
  { code: 3, glyph: "+", name: "plus" },
  { code: 4, glyph: "×", name: "times", keys: ["*", "·"] },
  { code: 5, glyph: "=", name: "equals" },
  { code: 6, glyph: "(", name: "open bracket" },
  { code: 7, glyph: ")", name: "close bracket" },
  { code: 8, glyph: "¬", name: "not", keys: ["~", "!"] },
  { code: 9, glyph: "∧", name: "and", keys: ["&", "^"] },
  { code: 10, glyph: "∨", name: "or", keys: ["|"] },
  { code: 11, glyph: "→", name: "if … then", keys: ["->", "=>", "⊃"] },
  { code: 12, glyph: "∀", name: "for all", keys: ["A", "forall"] },
  { code: 13, glyph: "∃", name: "there exists", keys: ["E", "exists"] },
  { code: 14, glyph: "x", name: "variable" },
  { code: 15, glyph: "y", name: "variable" },
  { code: 16, glyph: "z", name: "variable" },
  { code: 17, glyph: "′", name: "prime: makes a new variable, as in x′", keys: ["'", "’"] },
];
export const MAX_CODE = SYMBOLS.length;
export const MAX_SYMBOLS = 200;
export const MAX_DIGITS = 10000; // every string of 200 symbols has a number shorter than this
export const MAX_NUMERAL = 60;

const [ZERO, SUCC, PLUS, TIMES, EQ, OPEN, CLOSE, NOT, AND, OR, IMP, ALL, SOME, X, Y, Z, PRIME] = SYMBOLS.map((s) => s.code);
const GLYPH = Object.fromEntries(SYMBOLS.map((s) => [s.code, s.glyph]));
// Longest spellings first, so that "->" is not read as a stray "-".
const SPELLINGS = SYMBOLS.flatMap((s) => [s.glyph, ...(s.keys || [])].map((k) => [k, s.code])).sort((a, b) => b[0].length - a[0].length);

/** The string of symbols with these codes. */
export const show = (codes) => codes.map((c) => GLYPH[c] ?? "?").join("");

/**
 * Read typed text as a string of symbols. Spaces are dropped, the alternative spellings are accepted,
 * and a decimal numeral is shorthand for that many S's and a 0 (the language has no other digits).
 * Returns { ok: true, codes, numerals } or { ok: false, error }.
 */
export function tokenise(text) {
  const src = String(text ?? "");
  const codes = [];
  const numerals = [];
  for (let i = 0; i < src.length;) {
    if (/\s/.test(src[i])) { i++; continue; }
    const digits = src.slice(i).match(/^\d+/);
    if (digits) {
      const n = Number(digits[0]);
      if (digits[0].length > 3 || n > MAX_NUMERAL) return { ok: false, error: `The numeral ${digits[0]} would need ${digits[0].length > 3 ? "too many" : n} S's. Numerals up to ${MAX_NUMERAL} can be typed as shorthand.` };
      for (let k = 0; k < n; k++) codes.push(SUCC);
      codes.push(ZERO);
      if (n > 0) numerals.push({ typed: digits[0], as: `${"S".repeat(n)}0` });
      i += digits[0].length;
      continue;
    }
    const hit = SPELLINGS.find(([k]) => src.startsWith(k, i));
    if (!hit) return { ok: false, error: `"${[...src.slice(i)][0]}" is not a symbol of this language. The symbols are ${SYMBOLS.map((s) => s.glyph).join(" ")}. Variables are x, y and z, with ′ for more (x′, x′′).` };
    codes.push(hit[1]);
    i += hit[0].length;
  }
  if (!codes.length) return { ok: false, error: "Type a formula, for example S0+S0=SS0." };
  if (codes.length > MAX_SYMBOLS) return { ok: false, error: `That is ${codes.length} symbols. The page stops at ${MAX_SYMBOLS}, because the numbers get very long.` };
  return { ok: true, codes, numerals };
}

/* ===================================================================== primes */

let cache = null;
/** Every prime below 110,000, in order (10,453 of them). */
export function primes() {
  if (cache) return cache;
  const limit = 110000;
  const composite = new Uint8Array(limit + 1);
  cache = [];
  for (let n = 2; n <= limit; n++) {
    if (composite[n]) continue;
    cache.push(n);
    for (let m = n * n; m <= limit; m += n) composite[m] = 1;
  }
  return cache;
}

/* ========================================================== encode and decode */

/** The Gödel number of a string of codes, as a BigInt: the k-th prime raised to the k-th code, multiplied together. */
export function encode(codes) {
  const P = primes();
  let n = 1n;
  codes.forEach((c, k) => { n *= BigInt(P[k]) ** BigInt(c); });
  return n;
}

/** One row per symbol: its position, the prime for that position, the symbol and its code. */
export const factors = (codes) => codes.map((code, k) => ({ position: k + 1, prime: primes()[k], code, glyph: GLYPH[code], name: SYMBOLS[code - 1]?.name }));

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;

const COUNT_LIMIT = 1000; // stop counting how often one prime divides a number after this many

/** The smallest prime factor of `rest`, which is known to have none among the first k + 1 primes. null if it lies above the table. */
function nextFactor(rest, k) {
  const P = primes();
  if (rest > BigInt(Number.MAX_SAFE_INTEGER)) return P.find((q, j) => j > k && rest % BigInt(q) === 0n) ?? null;
  const r = Number(rest);
  for (let j = k + 1; j < P.length; j++) {
    if (P[j] * P[j] > r) return r; // nothing up to its square root divides it, so it is prime itself
    if (r % P[j] === 0) return P[j];
  }
  return null;
}

/**
 * Turn a whole number back into a string of symbols by dividing out 2, 3, 5, ... in turn.
 * Accepts a BigInt or text (spaces and commas between digits are ignored).
 * Returns { ok: true, codes, n } or { ok: false, kind, error, ... } where kind is one of
 * "empty", "not-integer", "too-big", "zero", "one", "skipped", "unknown-code", "too-long".
 */
export function decode(input) {
  const bad = (kind, error, extra = {}) => ({ ok: false, kind, error, ...extra });
  let n;
  if (typeof input === "bigint") n = input;
  else {
    const s = String(input ?? "").replace(/[\s,_  ]/g, "");
    if (!s) return bad("empty", "Paste or type a whole number to decode.");
    const stray = s.match(/[^0-9]/);
    if (stray) return bad("not-integer", `"${stray[0]}" is not a digit. A Gödel number is a positive whole number written in digits only.`);
    if (s.length > MAX_DIGITS) return bad("too-big", `That number has ${s.length} digits. The page stops at ${MAX_DIGITS}.`);
    n = BigInt(s);
  }
  if (n <= 0n) return bad("zero", "0 has no prime factorisation, so it is not the code of anything.");
  if (n === 1n) return bad("one", "1 is the product of no primes at all, which makes it the code of the empty string. A formula has at least one symbol.");
  const P = primes();
  const codes = [];
  let rest = n;
  for (let k = 0; rest > 1n; k++) {
    const p = BigInt(P[k]);
    let e = 0;
    while (e <= COUNT_LIMIT && rest % p === 0n) { rest /= p; e++; }
    const where = { position: k + 1, prime: P[k], prefix: codes };
    if (e === 0) {
      const next = nextFactor(rest, k);
      return bad("skipped", `The ${ordinal(k + 1)} prime, ${P[k]}, does not divide this number, but ${next ? `the larger prime ${next} does` : "a larger prime does (one above 110,000)"}. A code uses consecutive primes with no gaps, so position ${k + 1} would have no symbol.`, { ...where, next });
    }
    if (e > MAX_CODE) return bad("unknown-code", `The prime ${P[k]} divides this number ${e > COUNT_LIMIT ? `more than ${COUNT_LIMIT}` : e} times, but the codes run from 1 to ${MAX_CODE}. Position ${k + 1} would hold a symbol that does not exist.`, { ...where, exponent: e });
    codes.push(e);
  }
  if (codes.length > MAX_SYMBOLS) return bad("too-long", `This is the code of a string of ${codes.length} symbols. The page stops at ${MAX_SYMBOLS}.`, { length: codes.length });
  return { ok: true, codes, n };
}

/**
 * How many of the whole numbers from `from` to `to` (inclusive) are the code of a string, of a term,
 * and of a well-formed formula. The formulas are listed.
 */
export function census(from, to) {
  const out = { strings: 0, terms: 0, formulas: [] };
  for (let n = Math.max(1, from); n <= to; n++) {
    const d = decode(BigInt(n));
    if (!d.ok) continue;
    out.strings++;
    const kind = classify(d.codes).kind;
    if (kind === "term") out.terms++;
    else if (kind === "formula") out.formulas.push(n);
  }
  return out;
}

/** Digit count, the full decimal text, a short form for display, and a power-of-ten approximation. */
export function describe(n) {
  const text = n.toString();
  const digits = text.length;
  return {
    text, digits,
    short: digits <= 40 ? text : `${text.slice(0, 18)}…${text.slice(-18)}`,
    approx: digits <= 6 ? null : { mantissa: `${text[0]}.${text.slice(1, 4)}`, exponent: digits - 1 }, // truncated, not rounded
  };
}

/* ============================================================ well-formedness */

/**
 * The grammar (binary operators associate to the left, except → which associates to the right):
 *
 *   variable ::= ( x | y | z ) { ′ }
 *   factor   ::= 0 | variable | S factor | "(" term ")"
 *   product  ::= factor { × factor }
 *   term     ::= product { + product }
 *   unit     ::= term = term | ¬ unit | ∀ variable unit | ∃ variable unit | "(" formula ")"
 *   conj     ::= unit { ∧ unit }
 *   disj     ::= conj { ∨ conj }
 *   formula  ::= disj [ → formula ]
 *
 * parse(codes, "formula" | "term") returns { ok: true, ast } or { ok: false, position, expected, error }.
 * position is the 0-based index of the symbol where reading had to stop (codes.length for "ran out").
 */
export function parse(codes, goal = "formula") {
  let i = 0;
  let far = { at: -1, expected: "" };
  const fail = (expected) => {
    if (i > far.at) far = { at: i, expected };
    else if (i === far.at && !far.expected.includes(expected)) far.expected += ` or ${expected}`;
    return null;
  };
  const isVariable = (c) => c === X || c === Y || c === Z;

  const variable = () => {
    if (!isVariable(codes[i])) return fail("a variable");
    let name = GLYPH[codes[i++]];
    while (codes[i] === PRIME) { name += GLYPH[PRIME]; i++; }
    return { t: "var", name };
  };
  const factor = () => {
    const c = codes[i];
    if (c === ZERO) { i++; return { t: "zero" }; }
    if (c === SUCC) { i++; const a = factor(); return a && { t: "succ", a }; }
    if (isVariable(c)) return variable();
    if (c === OPEN) {
      i++;
      const a = term();
      if (!a) return null;
      if (codes[i] !== CLOSE) return fail('")"');
      i++;
      return a;
    }
    return fail("a term (0, a variable, S or a bracket)");
  };
  const chain = (next, op, t) => () => {
    let a = next();
    while (a && codes[i] === op) { i++; const b = next(); a = b && { t, a, b }; }
    return a;
  };
  const product = chain(factor, TIMES, "mul");
  const term = chain(product, PLUS, "add");
  const unit = () => {
    const c = codes[i];
    if (c === NOT) { i++; const a = unit(); return a && { t: "not", a }; }
    if (c === ALL || c === SOME) {
      i++;
      const v = variable();
      const a = v && unit();
      return a && { t: c === ALL ? "all" : "some", v: v.name, a };
    }
    if (c === OPEN) {
      // A bracket can open a formula, as in (x=y∧y=z), or a term, as in (x+y)=z. Try the formula first.
      const start = i;
      i++;
      const a = formula();
      if (a && codes[i] === CLOSE) { i++; return a; }
      if (a) fail('")"');
      i = start;
    }
    const left = term();
    if (!left) return null;
    if (codes[i] !== EQ) return fail('"="');
    i++;
    const right = term();
    return right && { t: "eq", a: left, b: right };
  };
  const conj = chain(unit, AND, "and");
  const disj = chain(conj, OR, "or");
  function formula() {
    const a = disj();
    if (!a || codes[i] !== IMP) return a;
    i++;
    const b = formula();
    return b && { t: "imp", a, b };
  }

  if (!codes.length) return { ok: false, position: 0, expected: "a symbol", error: "The string is empty." };
  const ast = goal === "term" ? term() : formula();
  if (ast && i === codes.length) return { ok: true, ast };
  // Either reading failed part-way, or it finished early and symbols are left over.
  const position = ast ? Math.max(i, far.at) : far.at;
  const expected = ast && i >= far.at ? `the end of the ${goal} or an operator` : far.expected;
  const found = position < codes.length ? `"${GLYPH[codes[position]]}"` : "the end of the string";
  return { ok: false, position, expected, error: `${position < codes.length ? `At symbol ${position + 1}` : "After the last symbol"}: expected ${expected}, found ${found}.` };
}

/** Is the string a well-formed formula, a term (a name for a number), or neither? */
export function classify(codes) {
  const f = parse(codes, "formula");
  if (f.ok) return { kind: "formula", ast: f.ast };
  const t = parse(codes, "term");
  if (t.ok) return { kind: "term", ast: t.ast, error: f.error, position: f.position };
  return { kind: "neither", error: f.error, position: f.position };
}

/** The same formula or term with every bracket written out. It parses back to the same tree. */
export function bracketed(node) {
  switch (node.t) {
    case "zero": return "0";
    case "var": return node.name;
    case "succ": return `S${bracketed(node.a)}`;
    case "add": return `(${bracketed(node.a)}+${bracketed(node.b)})`;
    case "mul": return `(${bracketed(node.a)}×${bracketed(node.b)})`;
    case "eq": return `${bracketed(node.a)}=${bracketed(node.b)}`;
    case "not": return `¬${bracketed(node.a)}`;
    case "all": return `∀${node.v}${bracketed(node.a)}`;
    case "some": return `∃${node.v}${bracketed(node.a)}`;
    default: return `(${bracketed(node.a)}${{ and: "∧", or: "∨", imp: "→" }[node.t]}${bracketed(node.b)})`;
  }
}

/** Variables that occur outside the reach of any quantifier for them, in order of first appearance. */
export function freeVariables(node, bound = [], out = []) {
  if (node.t === "var") { if (!bound.includes(node.name) && !out.includes(node.name)) out.push(node.name); }
  else if (node.t === "all" || node.t === "some") freeVariables(node.a, [...bound, node.v], out);
  else { if (node.a) freeVariables(node.a, bound, out); if (node.b) freeVariables(node.b, bound, out); }
  return out;
}

/**
 * Truth in ordinary arithmetic, for the easy case only: a formula with no variables and no quantifiers,
 * such as S0+S0=SS0, can be settled by calculating. Anything else returns null.
 */
export function truth(node) {
  const value = (t) => (t.t === "zero" ? 0n : t.t === "succ" ? value(t.a) + 1n : t.t === "add" ? value(t.a) + value(t.b) : t.t === "mul" ? value(t.a) * value(t.b) : null);
  const closed = (t) => t.t !== "var" && t.t !== "all" && t.t !== "some" && (!t.a || closed(t.a)) && (!t.b || closed(t.b));
  if (!closed(node)) return null;
  const holds = (f) => (f.t === "eq" ? value(f.a) === value(f.b) : f.t === "not" ? !holds(f.a) : f.t === "and" ? holds(f.a) && holds(f.b) : f.t === "or" ? holds(f.a) || holds(f.b) : !holds(f.a) || holds(f.b));
  return ["zero", "succ", "add", "mul"].includes(node.t) ? null : holds(node);
}
