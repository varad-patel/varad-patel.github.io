import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { SYMBOLS, MAX_CODE, MAX_SYMBOLS, MAX_DIGITS, show, tokenise, primes, encode, factors, decode, census, describe, parse, classify, bracketed, freeVariables, truth } from "./logic.js";

const codesOf = (text) => { const t = tokenise(text); assert.ok(t.ok, t.error); return t.codes; };
const number = (text) => encode(codesOf(text));

test("the code table: seventeen symbols, codes 1 to 17, no glyph or spelling used twice", () => {
  assert.equal(SYMBOLS.length, 17);
  assert.deepEqual(SYMBOLS.map((s) => s.code), Array.from({ length: 17 }, (_, i) => i + 1));
  const spellings = SYMBOLS.flatMap((s) => [s.glyph, ...(s.keys || [])]);
  assert.equal(new Set(spellings).size, spellings.length);
  assert.equal(MAX_CODE, 17);
});

test("primes", () => {
  const P = primes();
  assert.deepEqual(P.slice(0, 12), [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]);
  assert.equal(P[99], 541); // the hundredth prime
  assert.equal(P[199], 1223);
  assert.equal(P.length, 10453); // primes below 110,000
});

test("encoding by hand", () => {
  // 0=0 has codes 1, 5, 1: 2^1 × 3^5 × 5^1.
  assert.deepEqual(codesOf("0=0"), [1, 5, 1]);
  assert.equal(number("0=0"), 2430n);
  // S0=0 has codes 2, 1, 5, 1: 4 × 3 × 3125 × 7.
  assert.equal(number("S0=0"), 262500n);
  assert.equal(number("0=S0"), 85050n);
  assert.equal(number("S0"), 12n);
  // ∀x¬Sx=0 has codes 12, 14, 8, 2, 14, 5, 1.
  assert.deepEqual(codesOf("∀x¬Sx=0"), [12, 14, 8, 2, 14, 5, 1]);
  const n = 2n ** 12n * 3n ** 14n * 5n ** 8n * 7n ** 2n * 11n ** 14n * 13n ** 5n * 17n;
  assert.equal(number("∀x¬Sx=0"), n);
  assert.equal(n.toString(), "898828643505203817955791644001600000000");
  assert.equal(describe(n).digits, 39);
  // Swapping ∀ (code 12) for ∃ (code 13) in first place multiplies the number by 2.
  assert.equal(number("∃x¬Sx=0"), 2n * n);
  assert.deepEqual(factors(codesOf("0=0")), [
    { position: 1, prime: 2, code: 1, glyph: "0", name: "zero" },
    { position: 2, prime: 3, code: 5, glyph: "=", name: "equals" },
    { position: 3, prime: 5, code: 1, glyph: "0", name: "zero" },
  ]);
});

test("typing: spaces, other spellings and numerals", () => {
  assert.equal(show(codesOf("Ax ~Sx = 0")), "∀x¬Sx=0");
  assert.equal(show(codesOf("forall x exists y (y = Sx & ~ y=0) -> x*x' = 0 | 0=0")), "∀x∃y(y=Sx∧¬y=0)→x×x′=0∨0=0");
  const t = tokenise("2+2=4");
  assert.equal(show(t.codes), "SS0+SS0=SSSS0");
  assert.deepEqual(t.numerals, [{ typed: "2", as: "SS0" }, { typed: "2", as: "SS0" }, { typed: "4", as: "SSSS0" }]);
  assert.match(tokenise("q=0").error, /"q" is not a symbol/);
  assert.match(tokenise("x=99").error, /numeral 99/);
  assert.match(tokenise("x=9999").error, /too many/);
  assert.match(tokenise("   ").error, /Type a formula/);
  assert.match(tokenise("0".repeat(0) + "x".repeat(MAX_SYMBOLS + 1)).error, /201 symbols/);
  assert.ok(tokenise(null).ok === false);
});

test("decoding undoes encoding, for formulas and for arbitrary strings", () => {
  for (const f of ["0=0", "S0+S0=SS0", "∀x¬Sx=0", "∀x∀y(Sx=Sy→x=y)", "∀x∀y x×Sy=x×y+x", "¬∃x x×x=SS0", ")=0x(", "′′′"]) {
    const codes = codesOf(f);
    const back = decode(encode(codes));
    assert.ok(back.ok);
    assert.deepEqual(back.codes, codes);
    assert.deepEqual(decode(encode(codes).toString()).codes, codes); // from pasted text too
  }
  const r = rng(22);
  for (let trial = 0; trial < 200; trial++) {
    const codes = Array.from({ length: r.int(1, 40) }, () => r.int(1, MAX_CODE));
    assert.deepEqual(decode(encode(codes)).codes, codes);
  }
  // The longest string allowed still fits under the digit limit.
  const longest = new Array(MAX_SYMBOLS).fill(MAX_CODE);
  assert.ok(describe(encode(longest)).digits < MAX_DIGITS);
  assert.deepEqual(decode(encode(longest).toString()).codes, longest);
  assert.deepEqual(decode(" 2,430 ").codes, [1, 5, 1]);
});

test("numbers that are not the code of a string get the exact reason", () => {
  const d = (x) => { const out = decode(x); assert.equal(out.ok, false); return out; };
  // 10 = 2 × 5 skips 3.
  assert.deepEqual([d("10").kind, d("10").position, d("10").prime, d("10").next], ["skipped", 2, 3, 5]);
  assert.match(d("10").error, /2nd prime, 3, does not divide this number, but the larger prime 5 does/);
  // 2431 = 11 × 13 × 17 is odd.
  assert.deepEqual([d("2431").kind, d("2431").position, d("2431").next], ["skipped", 1, 11]);
  // 2^12 × 3^14 × 7 decodes two symbols and then skips 5.
  const partial = d(2n ** 12n * 3n ** 14n * 7n);
  assert.deepEqual([partial.kind, partial.position, partial.prime, partial.next, show(partial.prefix)], ["skipped", 3, 5, 7, "∀x"]);
  // 2^18: there is no symbol with code 18.
  assert.deepEqual([d("262144").kind, d("262144").exponent, d("262144").position], ["unknown-code", 18, 1]);
  assert.match(d("262144").error, /divides this number 18 times, but the codes run from 1 to 17/);
  assert.equal(d(2n * 3n ** 40n).position, 2);
  assert.match(d((2n ** 5000n).toString()).error, /more than 1000 times/);
  // A large prime factor outside the table is still reported honestly.
  assert.equal(d(2n * 1000003n * 1000033n).next, null);
  assert.equal(d("2000006").next, 1000003);
  assert.equal(d("0").kind, "zero");
  assert.equal(d("1").kind, "one");
  assert.equal(d("").kind, "empty");
  assert.equal(d("12a4").kind, "not-integer");
  assert.equal(d("-5").kind, "not-integer");
  assert.equal(d("3.5").kind, "not-integer");
  assert.equal(d("9".repeat(MAX_DIGITS + 1)).kind, "too-big");
  assert.equal(d(0n).kind, "zero");
  // A string of 201 zeros is a code, but longer than the page handles.
  assert.equal(d(encode(new Array(MAX_SYMBOLS + 1).fill(1))).kind, "too-long");
});

test("well-formed formulas, terms and neither", () => {
  const kind = (text) => classify(codesOf(text)).kind;
  for (const f of ["0=0", "S0+S0=SS0", "∀x¬Sx=0", "∀x∀y(Sx=Sy→x=y)", "(x+y)×z=0→x=0∨y=0∨z=0", "x′=x′′", "¬¬0=0", "(0=0)", "((x))=x", "∃x′∀y x′×y=0", "∀x(x=x∧∃y y=Sx)"]) assert.equal(kind(f), "formula", f);
  for (const t of ["0", "SSS0", "x", "x′′", "(x+y)×z", "S(x+0)", "x+y×z"]) assert.equal(kind(t), "term", t);
  for (const junk of [")=0x(", "==", "0=", "=0", "∀0=0", "∀x", "x=y)", "(x=y", "(x=y)=z", "0=0∧", "¬", "S", "x′y=0", "′x=0", "x=y=z", "0=0 0=0", "∀x′′′", "+"]) assert.equal(kind(junk), "neither", junk);
  // The message says where reading stopped and what was needed.
  const why = (text) => parse(codesOf(text));
  assert.deepEqual([why("∀0=0").position, why("∀0=0").expected], [1, "a variable"]);
  assert.match(why("∀0=0").error, /^At symbol 2: expected a variable, found "0"\.$/);
  assert.match(why("(x+y").error, /^After the last symbol: expected "=" or "\)", found the end of the string\.$/);
  assert.match(why("x=y)").error, /^At symbol 4: expected the end of the formula or an operator, found "\)"\.$/);
  assert.match(why("0=0∧").error, /After the last symbol: expected a term/);
  assert.equal(parse([]).ok, false);
  // 7776 = 2^5 × 3^5 is the code of a string, "==", that is not a formula; 12 is the code of the term S0.
  assert.equal(classify(decode("7776").codes).kind, "neither");
  assert.equal(classify(decode("12").codes).kind, "term");
});

test("how a formula is read: precedence, association and brackets", () => {
  const read = (text) => bracketed(classify(codesOf(text)).ast);
  assert.equal(read("x+y×z=0"), "(x+(y×z))=0"); // × before +
  assert.equal(read("x+y+z=0"), "((x+y)+z)=0"); // + associates to the left
  assert.equal(read("Sx+y=0"), "(Sx+y)=0"); // S applies to the nearest factor only
  assert.equal(read("S(x+y)=0"), "S(x+y)=0");
  assert.equal(read("¬x=y∧y=z∨z=x→0=0"), "(((¬x=y∧y=z)∨z=x)→0=0)"); // ¬, then ∧, then ∨, then →
  assert.equal(read("x=y→y=z→z=x"), "(x=y→(y=z→z=x))"); // → associates to the right
  assert.equal(read("∀x x=x∧y=y"), "(∀xx=x∧y=y)"); // a quantifier reaches only the next unit
  assert.equal(read("∀x(x=x∧y=y)"), "∀x(x=x∧y=y)");
  // Writing out every bracket does not change the tree, though it changes the string and so the number.
  const r = rng(7);
  const v = () => r.pick(["x", "y", "z", "x′"]);
  const term = (d) => (d === 0 || r.bool(0.35) ? r.pick(["0", v(), v()]) : r.bool(0.3) ? `S${term(d - 1)}` : `(${term(d - 1)}${r.pick(["+", "×"])}${term(d - 1)})`);
  const formula = (d) => (d === 0 || r.bool(0.3) ? `${term(2)}=${term(2)}` : r.bool(0.25) ? `¬${formula(d - 1)}` : r.bool(0.3) ? `${r.pick(["∀", "∃"])}${v()}${formula(d - 1)}` : `(${formula(d - 1)}${r.pick(["∧", "∨", "→"])}${formula(d - 1)})`);
  for (let trial = 0; trial < 300; trial++) {
    const text = formula(3);
    const c = classify(codesOf(text));
    assert.equal(c.kind, "formula", text);
    assert.equal(bracketed(c.ast), text); // already fully bracketed, so it comes back unchanged
    assert.deepEqual(decode(number(text)).codes, codesOf(text));
  }
  assert.notEqual(number("x+y×z=0"), number("(x+(y×z))=0"));
});

test("free variables and the truth of closed, quantifier-free formulas", () => {
  const ast = (text) => classify(codesOf(text)).ast;
  assert.deepEqual(freeVariables(ast("∀x¬Sx=0")), []);
  assert.deepEqual(freeVariables(ast("∃y y+y=x")), ["x"]);
  assert.deepEqual(freeVariables(ast("∀x x=y∧x=z′")), ["y", "x", "z′"]); // the second x is outside the quantifier
  assert.deepEqual(freeVariables(ast("x′=x′′")), ["x′", "x′′"]);
  assert.equal(truth(ast("S0+S0=SS0")), true);
  assert.equal(truth(ast("2+2=5")), false);
  assert.equal(truth(ast("3×4=12∧¬0=1")), true);
  assert.equal(truth(ast("0=1→0=2")), true);
  assert.equal(truth(ast("0=1∨2×3=7")), false);
  assert.equal(truth(ast("∀x¬Sx=0")), null); // quantified: not settled by calculating
  assert.equal(truth(ast("x=x")), null);
  assert.equal(truth(classify(codesOf("S0")).ast), null); // a term is not true or false
});

test("almost no number is a formula (the finding)", () => {
  const c = census(1, 1000000);
  assert.equal(c.strings, 781);
  assert.equal(c.terms, 17);
  assert.deepEqual(c.formulas, [2430, 85050, 262500]);
  assert.deepEqual(c.formulas.map((n) => show(decode(BigInt(n)).codes)), ["0=0", "0=S0", "S0=0"]);
  // Counting in pieces gives the same totals.
  const parts = [census(1, 2429), census(2430, 2430), census(2431, 100000)];
  assert.equal(parts[0].formulas.length, 0);
  assert.deepEqual(parts[1], { strings: 1, terms: 0, formulas: [2430] });
  assert.equal(parts.reduce((s, p) => s + p.strings, 0), census(1, 100000).strings);
  assert.deepEqual(describe(2430n), { text: "2430", digits: 4, short: "2430", approx: null });
  const big = describe(encode([12, 14, 12, 15, 6, 2, 14, 5, 2, 15, 11, 14, 5, 15, 7])); // ∀x∀y(Sx=Sy→x=y)
  assert.equal(big.digits, 171);
  assert.equal(big.short.length, 37);
  assert.deepEqual(big.approx, { mantissa: "5.524", exponent: 170 });
});
