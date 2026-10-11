// Day 2: Truth Table Playground. Interface.
import { $, el, fmt, mount, segmented, button, note } from "../kit/kit.js";
import { analyse, steps } from "./logic.js";

mount();

const EXAMPLES = [
  { label: "Modus ponens", text: "p → q, p ⊢ q" },
  { label: "Affirming the consequent", text: "p → q, q ⊢ p" },
  { label: "De Morgan's law", text: "¬(p ∧ q) ↔ (¬p ∨ ¬q)" },
  { label: "Excluded middle", text: "p ∨ ¬p" },
  { label: "A contradiction", text: "p ∧ ¬p" },
  { label: "Peirce's law", text: "((p → q) → p) → p" },
  { label: "Hypothetical syllogism", text: "p → q, q → r ⊢ p → r" },
  { label: "Are these the same?", text: "p → q, ¬p ∨ q, ¬q → ¬p" },
  { label: "Exclusive or", text: "(p ⊕ q) ↔ ((p ∨ q) ∧ ¬(p ∧ q))" },
];
const KEYS = ["¬", "∧", "∨", "→", "↔", "⊕", "(", ")", ",", "⊢"];
const VISIBLE_ROWS = 64;

const state = { text: EXAMPLES[1].text, marks: "TF", order: "true", row: -1, showAll: false };
const mark = (v) => (state.marks === "TF" ? (v ? "T" : "F") : v ? "1" : "0");

/* ---------- input ---------- */
const input = el("input", { type: "text", id: "formula", class: "mono formula-input", value: state.text, autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-describedby": "formula-help" });
input.addEventListener("input", () => { state.text = input.value; state.row = -1; state.showAll = false; update(); });

function insert(symbol) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start), after = input.value.slice(end);
  let pad = ["(", ")", "¬"].includes(symbol) ? symbol : symbol === "," ? ", " : ` ${symbol} `;
  if (pad.startsWith(" ") && (!before || before.endsWith(" "))) pad = pad.slice(1);
  if (pad.endsWith(" ") && after.startsWith(" ")) pad = pad.slice(0, -1);
  input.value = before + pad + after;
  const caret = start + pad.length;
  input.focus();
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input"));
}
function load(text) {
  input.value = text;
  input.dispatchEvent(new Event("input"));
}

const keyRow = el("div", { class: "row keys", role: "group", "aria-label": "Insert a symbol" },
  KEYS.map((k) => el("button", { type: "button", class: "btn small key", "aria-label": `Insert ${k}`, text: k, onclick: () => insert(k) })));
const exampleRow = el("div", { class: "row", role: "group", "aria-label": "Examples" },
  EXAMPLES.map((e) => button(e.label, () => load(e.text), { small: true })));

const marksSeg = segmented({ label: "Show values as", value: "TF", options: [{ value: "TF", label: "T and F" }, { value: "10", label: "1 and 0" }], onChange: (v) => { state.marks = v; update(); } });
const orderSeg = segmented({ label: "First row", value: "true", options: [{ value: "true", label: "All true" }, { value: "false", label: "All false" }], onChange: (v) => { state.order = v; update(); } });

const verdictBox = el("div", { role: "status", "aria-live": "polite" });
const tableBox = el("div");
const stepsBox = el("div");
// Spoken when another row is chosen: what that row works out to. (Typing already announces the verdict.)
const rowStatus = el("p", { class: "sr-only", role: "status" });
let rowSummary = "";
const extraBox = el("div");

$("#app").append(
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("label", { for: "formula", text: "Formula, list of formulas, or argument" })),
    input,
    el("div", { class: "hint", id: "formula-help" }, "Letters are propositions. Type the symbols or the words: not, and, or, xor, implies (->), iff (<->). Write true and false as 1 and 0. Separate formulas with commas. Put ⊢ (or |-) before a conclusion to test an argument.")),
  keyRow,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Try one" })), exampleRow),
  verdictBox,
  el("div", { class: "row", style: { gap: "20px 32px", alignItems: "flex-start" } }, marksSeg.el, orderSeg.el),
  tableBox, rowStatus, stepsBox, extraBox);

/* ---------- rendering ---------- */
const plural = (n, word) => `${fmt.int(n)} ${word}${n === 1 ? "" : "s"}`;
const ROLE_TITLE = { formula: "A formula you typed", premise: "This column is a premise", conclusion: "This column is the conclusion", "premise and conclusion": "This column is both a premise and the conclusion" };
const focusRow = () => tableBox.querySelector(`tr[data-row="${state.row}"]`)?.focus();
const describeRow = (r, vars) => (vars.length ? vars.map((v) => `${v} is ${r.env[v] ? "true" : "false"}`).join(", ") : "the only row");

function verdictNote(result) {
  const v = result.verdict;
  const n = result.rows.length;
  if (v.type === "formula") {
    const f = result.columns.find((c) => c.kind === "main").text;
    if (v.kind === "tautology") return note("good", el("strong", { text: "Tautology. " }), `${f} is true in all ${plural(n, "row")}: no assignment of truth values can make it false.`);
    if (v.kind === "contradiction") return note("bad", el("strong", { text: "Contradiction. " }), `${f} is false in all ${plural(n, "row")}: no assignment of truth values can make it true.`);
    return note("", el("strong", { text: "Contingent. " }), `${f} is true in ${fmt.int(v.trueRows)} of ${plural(n, "row")} and false in the other ${n - v.trueRows === 1 ? "one" : fmt.int(n - v.trueRows)}, so its truth depends on the facts.`);
  }
  if (v.type === "argument") {
    if (v.valid) {
      const vacuous = v.premisesTogetherTrue === 0 && result.premises.length;
      return note("good", el("strong", { text: "Valid. " }),
        vacuous ? "The premises are never all true together, so no row can have true premises and a false conclusion. The argument is valid, but only because its premises contradict each other."
          : result.premises.length ? `${v.premisesTogetherTrue === 1 ? "In the one row" : `In every one of the ${fmt.int(v.premisesTogetherTrue)} rows`} where ${result.premises.length === 1 ? "the premise is" : "all the premises are"} true, the conclusion is true as well.`
            : "With no premises, the conclusion has to be true in every row, and it is.");
    }
    const first = result.rows[v.counterexamples[0]];
    return note("bad", el("strong", { text: "Invalid. " }),
      `${plural(v.counterexamples.length, "row")} of ${fmt.int(n)} ${v.counterexamples.length === 1 ? "has" : "have"} ${result.premises.length ? `${result.premises.length === 1 ? "a true premise" : "true premises"} and ` : ""}a false conclusion (highlighted). For example: ${describeRow(first, result.vars)}.`);
  }
  const lines = v.pairs.map((p) => el("li", {}, el("span", { class: "mono", text: p.a }), " and ", el("span", { class: "mono", text: p.b }),
    p.equivalent ? " are equivalent: their columns match in every row." : ` are not equivalent: they differ in ${plural(p.differ.length, "row")}.`));
  return note(v.pairs.every((p) => p.equivalent) ? "good" : "", el("strong", { text: `${plural(v.each.length, "formula")} compared. ` }),
    `${v.each.length === 2 ? "Both" : "All of them"} are true together in ${plural(v.jointlyTrue, "row")} of ${fmt.int(n)}.`, el("ul", { class: "pairs" }, lines));
}

function update() {
  const result = analyse(state.text);
  if (result.error) {
    input.classList.add("invalid");
    // The box is already a polite live region. An alert on every keystroke of a half-typed formula would be too much.
    const problem = note("bad", result.error,
      result.pos != null && state.text.trim() ? el("div", { class: "mono caret-line" }, state.text, "\n", " ".repeat(Math.min(result.pos, state.text.length)), "^") : null);
    problem.removeAttribute("role");
    verdictBox.replaceChildren(problem);
    tableBox.replaceChildren();
    stepsBox.replaceChildren();
    extraBox.replaceChildren();
    return;
  }
  input.classList.remove("invalid");
  const verdict = verdictNote(result);
  verdict.removeAttribute("role"); // "Invalid" is an answer, not an alarm: the polite live region around it is enough
  verdictBox.replaceChildren(verdict);

  const order = result.rows.map((_, i) => i);
  if (state.order === "false") order.reverse();
  const counter = new Set(result.verdict.type === "argument" ? result.verdict.counterexamples : []);
  if (state.row >= result.rows.length) state.row = -1;
  // Open on the row that matters: the first counterexample, otherwise the first row.
  if (state.row < 0) state.row = counter.size ? result.verdict.counterexamples[0] : order[0];

  const limit = state.showAll ? order.length : VISIBLE_ROWS;
  const shown = order.slice(0, limit);
  if (!shown.includes(state.row)) shown[shown.length - 1] = state.row;

  const head = el("tr", {},
    result.vars.map((v) => el("th", { scope: "col", class: "var", text: v })),
    result.columns.map((c, i) => el("th", { scope: "col", class: `${c.kind}${i === 0 ? " first" : ""}`, title: ROLE_TITLE[c.role] || "A step on the way" },
      c.role && c.role !== "formula" ? el("span", { class: "role", text: c.role }) : null, c.text)));
  const body = shown.map((i) => {
    const r = result.rows[i];
    // One tab stop for the whole table: the selected row. The arrow keys move between rows.
    return el("tr", { class: `${i === state.row ? "sel" : ""}${counter.has(i) ? " counter" : ""}`, tabindex: i === state.row ? "0" : "-1", "aria-selected": String(i === state.row), dataset: { row: i },
      title: "Show how this row is worked out" },
      result.vars.map((v) => el("td", { class: `var ${r.env[v] ? "t" : "f"}`, text: mark(r.env[v]) })),
      r.values.map((val, j) => el("td", { class: `${result.columns[j].kind} ${val ? "t" : "f"}${j === 0 ? " first" : ""}`, text: mark(val) })));
  });
  const tbl = el("table", { class: "tbl truth" }, el("caption", { class: "sr-only", text: "Truth table. Select a row to see it evaluated step by step. The up and down arrow keys move between rows." }), el("thead", {}, head), el("tbody", {}, body));
  const pickRow = (row) => { state.row = row; update(); focusRow(); rowStatus.textContent = rowSummary; };
  tbl.addEventListener("click", (e) => { const tr = e.target.closest("tr[data-row]"); if (tr) pickRow(Number(tr.dataset.row)); });
  tbl.addEventListener("keydown", (e) => {
    const at = shown.indexOf(state.row);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: shown.length - 1 }[e.key];
    if (to == null || !e.target.closest("tr[data-row]")) return;
    e.preventDefault();
    if (to >= 0 && to < shown.length) pickRow(shown[to]);
  });

  tableBox.replaceChildren(el("div", { class: "tbl-wrap" }, tbl));
  if (order.length > limit) {
    tableBox.append(el("div", { class: "row", style: { marginTop: "10px" } },
      el("span", { class: "small muted", text: `Showing ${fmt.int(limit)} of ${fmt.int(order.length)} rows. The verdict above uses all of them.` }),
      button(`Show all ${fmt.int(order.length)}`, () => { state.showAll = true; update(); focusRow(); }, { small: true })));
  }

  const row = result.rows[state.row];
  const list = steps(result, state.row, mark);
  let rowVerdict = null;
  if (result.verdict.type === "argument") {
    const falsePremise = result.premises.find((_, k) => !result.verdict.premiseValues[k][state.row]);
    const conclusionTrue = result.verdict.conclusionValues[state.row];
    const allPremises = result.premises.length === 1 ? "The premise is" : "Every premise is";
    rowVerdict = falsePremise
      ? `The premise ${falsePremise} is false in this row, so the row cannot count against the argument, whatever the conclusion is.`
      : conclusionTrue
        ? `${result.premises.length ? `${allPremises} true in this row and the conclusion is true as well` : "The conclusion is true in this row"}, so the row is no threat to the argument.`
        : `${result.premises.length ? `${allPremises} true in this row and the conclusion is false` : "The conclusion is false in this row"}. This is a counterexample: it shows the argument is invalid.`;
  }
  rowSummary = [list.map((s) => `${s.formula} is ${s.value ? "true" : "false"}`).join(", "), rowVerdict].filter(Boolean).join(". ");
  stepsBox.replaceChildren(el("div", { class: "panel" },
    el("h3", { text: `Step by step: ${result.vars.length ? result.vars.map((v) => `${v} = ${mark(row.env[v])}`).join(", ") : "no letters to assign"}` }),
    list.length
      ? el("ol", { class: "steps" }, list.map((s) => el("li", {},
          el("span", { class: "mono", text: s.formula }), " becomes ", el("span", { class: "mono", text: s.working }), ", which is ", el("strong", { class: s.value ? "t" : "f", text: mark(s.value) }), ".")))
      : el("p", { class: "small muted", style: { marginTop: "8px" }, text: "Nothing to work out here: every formula is a single letter or constant, so its value is read straight from the row." }),
    rowVerdict ? el("p", { style: { marginTop: "10px" }, text: rowVerdict }) : "",
    el("p", { class: "small muted", style: { marginTop: "10px" }, text: "Each line replaces the parts of a subformula with the values already found, innermost first. Select another row of the table to follow it instead." })));

  if (result.normal && result.vars.length <= 4) {
    extraBox.replaceChildren(el("div", { class: "panel" },
      el("h3", { text: "The same truth function in normal form" }),
      el("dl", { class: "forms" },
        el("dt", { text: "Disjunctive (one term for each true row; ⊥ if there is none)" }), el("dd", { class: "mono", text: result.normal.dnf }),
        el("dt", { text: "Conjunctive (one term for each false row; ⊤ if there is none)" }), el("dd", { class: "mono", text: result.normal.cnf }))));
  } else if (result.normal) {
    extraBox.replaceChildren(el("p", { class: "small muted", text: `The normal forms are left out for formulas with more than 4 letters: this one could need ${fmt.int(result.rows.length)} terms.` }));
  } else extraBox.replaceChildren();
}

update();
