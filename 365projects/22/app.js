// Day 22: Gödel Numbering Encoder. Interface.
import { $, el, fmt, mount, debounce, textField, textArea, select, button, stat, table } from "../kit/kit.js";
import { SYMBOLS, MAX_DIGITS, show, tokenise, encode, factors, decode, census, describe, classify, bracketed, freeVariables, truth } from "./logic.js";

mount();

const FORMULAS = [
  { label: "0 = 0", text: "0=0" },
  { label: "1 + 1 = 2", text: "S0+S0=SS0" },
  { label: "Zero follows nothing", text: "∀x¬Sx=0" },
  { label: "Successor is one-to-one", text: "∀x∀y(Sx=Sy→x=y)" },
  { label: "Adding", text: "∀x∀y x+Sy=S(x+y)" },
  { label: "x is even", text: "∃y y+y=x" },
  { label: "No square root of 2", text: "¬∃x x×x=SS0" },
  { label: "False but well formed", text: "S0+S0=SSS0" },
  { label: "Not a formula", text: ")=0x(" },
];
const NUMBERS = ["2430", "85050", "12", "7776", "10", "262144"];

/* ---------- controls ---------- */
const formula = textField({
  label: "Formula", value: FORMULAS[2].text, mono: true,
  hint: "Use the keys below, or type: A for ∀, E for ∃, ~ for ¬, & for ∧, | for ∨, -> for →, * for ×, ' for ′. A numeral such as 2 is shorthand for SS0.",
  onInput: () => fromFormula(),
});
const number = textArea({
  label: "Gödel number", rows: 5, mono: true,
  hint: `Edit this, or paste any whole number of up to ${fmt.int(MAX_DIGITS)} digits, to decode it.`,
  onInput: debounce(() => fromNumber(), 150),
});
const insert = (glyph) => {
  const box = formula.input;
  const at = box.selectionStart ?? box.value.length, end = box.selectionEnd ?? at;
  box.value = box.value.slice(0, at) + glyph + box.value.slice(end);
  box.focus();
  box.setSelectionRange(at + glyph.length, at + glyph.length);
  fromFormula();
};
const keys = el("div", { class: "keys", role: "group", "aria-label": "Symbols of the language with their codes" },
  SYMBOLS.map((s) => el("button", { type: "button", title: `${s.name}, code ${s.code}`, "aria-label": `Insert ${s.glyph}: ${s.name}, code ${s.code}`, onclick: () => insert(s.glyph) }, el("b", { text: s.glyph }), el("small", { text: s.code }))));
const copied = el("span", { class: "small muted", role: "status" });
const copy = () => {
  const done = (text) => { copied.textContent = text; setTimeout(() => { copied.textContent = ""; }, 2500); };
  const fallback = () => { number.input.focus(); number.input.select(); done("Selected. Press Ctrl+C to copy."); };
  if (!number.value) return done("Nothing to copy yet.");
  if (!navigator.clipboard?.writeText) return fallback();
  return navigator.clipboard.writeText(number.value).then(() => done("Copied."), fallback);
};
const upTo = select({ label: "How rare are formulas? Check every number up to", value: "1000000", options: [1000, 10000, 100000, 1000000].map((n) => ({ value: n, label: fmt.int(n) })) });
const censusOut = el("div", { class: "small", role: "status" });
const censusButton = button("Count the codes", () => runCensus(Number(upTo.value)), { small: true });

const controls = el("div", { class: "controls" },
  formula.el,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "The 17 symbols and their codes" })), keys),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Example formulas" })), el("div", { class: "row" }, FORMULAS.map((f) => button(f.label, () => { formula.value = f.text; fromFormula(); }, { small: true })))),
  number.el,
  el("div", { class: "row" }, button("Copy the number", copy, { small: true, primary: true }), copied),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Numbers to decode" })), el("div", { class: "row" }, NUMBERS.map((n) => button(fmt.int(Number(n)), () => { number.value = n; fromNumber(); }, { small: true })))),
  upTo.el, el("div", { class: "row" }, censusButton), censusOut);

/* ---------- outputs ---------- */
const sSymbols = stat("Symbols");
const sDigits = stat("Digits in the number");
const sKind = stat("Syntax check");
const message = el("div", { role: "status" });
const numberBox = el("div", { class: "panel" });
const syntaxBox = el("div", { class: "panel" });
const tableBox = el("div");
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sSymbols.el, sDigits.el, sKind.el), message, numberBox, syntaxBox, tableBox);
$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out));

const power = (p, c) => [String(p), el("sup", { text: c })];
const raised = (n) => [...String(n)].map((d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[d]).join(""); // for places that take plain text only
const KIND = { formula: ["Well formed", "a formula of the language"], term: ["A term", "a name for a number, not a formula"], neither: ["Malformed", "a string of symbols, but not a formula"] };

function fail(text, extra) {
  for (const s of [sSymbols, sDigits, sKind]) s.set("–", "");
  message.replaceChildren(el("div", { class: "note bad" }, text, extra ? el("div", { style: { marginTop: "6px" } }, extra) : null));
  for (const box of [numberBox, syntaxBox, tableBox]) { box.replaceChildren(); box.hidden = true; }
}

function fromFormula() {
  const t = tokenise(formula.value);
  formula.input.classList.toggle("invalid", !t.ok);
  number.input.classList.remove("invalid");
  if (!t.ok) { number.value = ""; return fail(t.error); }
  const n = encode(t.codes);
  number.value = n.toString();
  return render(t.codes, n, t.numerals.length ? `Numerals are shorthand: ${[...new Set(t.numerals.map((x) => `${x.typed} is ${x.as}`))].join(", ")}. ` : "");
}

function fromNumber() {
  const d = decode(number.value);
  number.input.classList.toggle("invalid", !d.ok);
  formula.input.classList.remove("invalid");
  if (!d.ok) {
    formula.value = "";
    return fail(d.error, d.prefix?.length ? `The primes before that do decode: the first ${d.prefix.length === 1 ? "symbol would be" : `${d.prefix.length} symbols would be`} ${show(d.prefix)}.` : null);
  }
  formula.value = show(d.codes);
  return render(d.codes, d.n, "");
}

function render(codes, n, lead) {
  const info = describe(n);
  const c = classify(codes);
  const text = show(codes);
  sSymbols.set(fmt.int(codes.length), `the largest prime used is ${fmt.int(factors(codes).at(-1).prime)}`);
  sDigits.set(fmt.int(info.digits), info.approx ? `about ${info.approx.mantissa} × 10${raised(info.approx.exponent)}` : "small enough to read");
  sKind.set(...KIND[c.kind]);
  message.replaceChildren(el("div", { class: "note" }, lead, "The string ", el("span", { class: "mono", text }), ` and the number ${info.digits > 40 ? `of ${fmt.int(info.digits)} digits` : info.text} are two ways of writing the same thing: each can be recovered from the other.`));
  for (const box of [numberBox, syntaxBox, tableBox]) box.hidden = false;

  const rows = factors(codes);
  numberBox.replaceChildren(...[
    el("h3", { text: "The number" }),
    el("p", { class: "bignum", text: info.short }),
    info.digits > 40 && el("p", { class: "small muted", text: `${fmt.int(info.digits)} digits; the first and last 18 are shown, and the whole number is in the box.` }),
    el("p", { class: "small", style: { marginTop: "10px" } }, "As a product of consecutive primes, each raised to the code of the symbol in that position:"),
    el("p", { class: "factors", "aria-label": `Factorisation: ${rows.map((r) => `${r.prime} to the power ${r.code}`).join(", times ")}` }, rows.flatMap((r, i) => [i ? " × " : "", el("span", {}, power(r.prime, r.code))])),
  ].filter(Boolean));

  const marked = (at) => el("p", { class: "string" }, codes.map((_, i) => el("span", { class: i === at ? "bad" : null, text: show([codes[i]]) })), at >= codes.length ? el("span", { class: "bad", text: " " }) : null);
  let body;
  if (c.kind === "formula") {
    const free = freeVariables(c.ast), full = bracketed(c.ast), verdict = truth(c.ast);
    body = [
      el("div", { class: "note good" }, el("strong", { text: "Well formed. " }), "The grammar of the language can build this string, so it is a formula."),
      full !== text ? el("p", { class: "small" }, "With every bracket written out it reads ", el("span", { class: "mono", text: full }), ". That is a different string, so it has a different number.") : null,
      el("p", { class: "small" }, free.length
        ? `${free.join(", ")} ${free.length === 1 ? "is a free variable" : "are free variables"}: the formula says something about ${free.length === 1 ? "it" : "them"} and is not true or false until ${free.length === 1 ? "a number is" : "numbers are"} put in.`
        : "It has no free variables, so it is a sentence: a claim that is either true or false."),
      el("p", { class: "small" }, verdict === true ? "Both sides can be worked out, and it is true in ordinary arithmetic."
        : verdict === false ? "Both sides can be worked out, and it is false in ordinary arithmetic. Being false does not stop it being a formula or having a number."
        : free.length ? "" : "The page does not judge whether it is true: with a quantifier that would mean checking every number."),
    ];
  } else if (c.kind === "term") {
    body = [el("div", { class: "note warn" }, el("strong", { text: "A term, not a formula. " }), "It names a number and asserts nothing. Put = and another term after it to make a formula."), marked(-1)];
  } else {
    body = [el("div", { class: "note warn" }, el("strong", { text: "Not well formed. " }), `It is a string of symbols with a Gödel number, but the grammar cannot build it. ${c.error}`), marked(c.position)];
  }
  syntaxBox.replaceChildren(el("h3", { text: "Syntax check" }), ...body.filter((b) => b && (typeof b === "string" || b.textContent)));

  const shown = rows.slice(0, 200);
  tableBox.replaceChildren(el("div", { class: "scroll" }, table({
    caption: "Symbol by symbol",
    columns: [
      { key: "position", label: "Position", num: true }, { key: "glyph", label: "Symbol", format: (v) => el("span", { class: "sym", text: v }) }, { key: "name", label: "Meaning" },
      { key: "code", label: "Code", num: true }, { key: "prime", label: "Prime", num: true, format: (v) => fmt.int(v) },
      { key: "factor", label: "Factor", num: true, format: (_, r) => el("span", {}, power(r.prime, r.code)) },
    ],
    rows: shown,
  })));
}

/* ---------- the census ---------- */
let censusRun = 0;
function runCensus(limit) {
  const run = ++censusRun;
  const total = { strings: 0, terms: 0, formulas: [] };
  const CHUNK = 25000;
  const stepFrom = (from) => {
    if (run !== censusRun) return; // a newer count has started
    const to = Math.min(limit, from + CHUNK - 1);
    const part = census(from, to);
    total.strings += part.strings; total.terms += part.terms; total.formulas.push(...part.formulas);
    if (to < limit) { censusOut.textContent = `Checked ${fmt.int(to)} of ${fmt.int(limit)} …`; setTimeout(() => stepFrom(to + 1), 0); return; }
    censusOut.replaceChildren(
      `From 1 to ${fmt.int(limit)}: ${fmt.int(total.strings)} ${total.strings === 1 ? "number is" : "numbers are"} the code of a string, ${fmt.int(total.terms)} of a term, and ${fmt.int(total.formulas.length)} of a well-formed formula${total.formulas.length ? ": " : "."}`,
      ...total.formulas.slice(0, 12).flatMap((n, i) => [i ? " " : "", button(fmt.int(n), () => { number.value = String(n); fromNumber(); }, { small: true })]));
  };
  stepFrom(1);
}

fromFormula();
