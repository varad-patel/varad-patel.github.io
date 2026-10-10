// Day 21: Liar Paradox Evaluator. Interface.
import { $, el, mount, debounce, textArea, slider, checkbox, button, stat } from "../kit/kit.js";
import { T, F, U, MAX_SENTENCES, parse, step, assignment, analyse, revision, ring } from "./logic.js";

mount();

const PRESETS = [
  { label: "A mixed page", text: "A: this sentence is false\nB: this sentence is true\nC: 2 + 2 = 4\nD: A is true or C is true\nE: C is false" },
  { label: "The Liar", text: "A: this sentence is false" },
  { label: "The Truth-teller", text: "A: this sentence is true" },
  { label: "Postcard", text: "A: B is true\nB: A is false" },
  { label: "Two accusers", text: "A: B is false\nB: A is false" },
  { label: "Curry", text: "C: if this sentence is true then 2 + 2 = 5" },
  { label: "Grounded chain", text: "A: 2 + 2 = 4\nB: A is true\nC: B is false\nD: C is false and A is true" },
  { label: "Contradicts itself", text: "A: A is true and A is false" },
];
const WORD = { true: "True", false: "False", looping: "Looping", unsettled: "Unsettled" };
const SHOWN_STAGES = 24;
const guess = new Map(); // sentence name -> guessed true?

/* ---------- controls ---------- */
const run = debounce(() => update(), 120);
const input = textArea({
  label: "Sentences", value: PRESETS[0].text, rows: 8, mono: true,
  hint: "One per line, as “Name: sentence”. A sentence can say that a named sentence, or “this sentence”, is true or false, joined with and, or, not, if … then, iff. Sums such as 2 + 2 = 4 are plain facts.",
  onInput: run,
});
const load = (text) => { input.value = text; update(); };
const ringSlider = slider({
  label: "Or build a ring of", min: 1, max: MAX_SENTENCES, step: 1, value: 3, format: (n) => `${n} sentence${n === 1 ? "" : "s"}`,
  hint: "Each sentence says the next one is false; the last points back to the first.",
  onInput: (n) => { input.value = ring(n); run(); },
});
const guessBox = el("div", { class: "field" });
const controls = el("div", { class: "controls" },
  input.el,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })), el("div", { class: "row" }, PRESETS.map((p) => button(p.label, () => load(p.text), { small: true })))),
  ringSlider.el, guessBox);

/* ---------- outputs ---------- */
const sClassical = stat("Classical");
const sKripke = stat("Kripke");
const sRevision = stat("Revision");
const message = el("div", { role: "status" });
const cards = el("div", { class: "cards" });
const details = el("div", { class: "out" });
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sClassical.el, sKripke.el, sRevision.el), message, cards, details);
$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out));

/* ---------- small pieces ---------- */
const letter = (x) => (x === T ? "T" : x === F ? "F" : "–");
const tv = (x, extra = "") => el("span", { class: `tv ${x === T ? "t" : x === F ? "f" : "u"} ${extra}`, title: x === T ? "true" : x === F ? "false" : "no value", text: letter(x) });
const list = (items) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** A grid of truth values: one row per entry of `rows` ({ head, values, cls, tail }), one column per sentence. */
function grid(sentences, rows, { corner = "", tailHead = "" } = {}) {
  return el("div", { class: "tbl-wrap" }, el("table", { class: "tbl grid" },
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: corner }), sentences.map((s) => el("th", { scope: "col", class: "c", text: s.name })), el("th", { scope: "col", text: tailHead }))),
    el("tbody", {}, rows.map((r) => el("tr", { class: r.cls || null },
      el("th", { scope: "row", text: r.head }), r.values.map((x, i) => el("td", { class: "c" }, tv(x, r.mark?.[i] ? "mark" : ""))), el("td", { class: "small" }, r.tail || ""))))));
}

/* ---------- the three verdicts in words ---------- */
function classicalWords(c) {
  const scope = c.group.length > 1 ? ` among the ${c.group.length} sentences it depends on` : "";
  if (c.status === "none") return `No assignment is consistent${scope}.`;
  if (c.status === "varies") return `True in ${c.trueIn} of the ${c.of} consistent assignments${scope}, so the definitions do not fix it.`;
  return `${c.status === "true" ? "True" : "False"} in ${c.of === 1 ? "the only consistent assignment" : `all ${c.of} consistent assignments`}${scope}.`;
}
function kripkeWords(k, i) {
  if (k.status[i] === "true" || k.status[i] === "false") return `Grounded ${k.status[i]}: it gets its value at stage ${k.groundedAt[i]}.`;
  if (k.status[i] === "paradoxical") return "Ungrounded, and no fixed point gives it a value.";
  const { true: t, false: f } = k.canBe[i];
  return `Ungrounded. ${t && f ? "Other fixed points make it true, or make it false." : `Another fixed point makes it ${t ? "true" : "false"}, none makes it ${t ? "false" : "true"}.`}`;
}
function revisionWords(r) {
  if (r.call === "looping") return `Never settles, from ${r.total === 2 ? "either" : `any of the ${r.total}`} starting guess${r.total === 2 ? "" : "es"}.`;
  if (r.call !== "unsettled") return `Settles at ${r.call} from ${r.total === 2 ? "both" : `all ${r.total}`} starting guesses.`;
  const parts = [r.settleTrue && `settles at true from ${r.settleTrue}`, r.settleFalse && `settles at false from ${r.settleFalse}`, r.loop && `loops from ${r.loop}`].filter(Boolean);
  return `Depends on the guess: ${list(parts)} of the ${r.total} starting guesses.`;
}

/* ---------- rendering ---------- */
function update() {
  const p = parse(input.value);
  input.input.classList.toggle("invalid", !p.ok);
  if (!p.ok) {
    for (const s of [sClassical, sKripke, sRevision]) s.set("–", "");
    message.replaceChildren(el("div", { class: "note bad" }, p.error));
    cards.replaceChildren();
    details.replaceChildren();
    guessBox.replaceChildren();
    return;
  }
  const S = p.sentences, n = S.length;
  const a = analyse(S);

  // Starting guess: one box per sentence, remembered by name.
  const start = S.map((s) => (guess.has(s.name) ? guess.get(s.name) : true));
  guessBox.replaceChildren(
    el("div", { class: "lab" }, el("span", { text: "Starting guess for the revision" })),
    el("div", { class: "row" }, S.map((s, i) => checkbox({ label: `${s.name} true`, checked: start[i], onChange: (on) => { guess.set(s.name, on); update(); } }).el)),
    el("div", { class: "hint", text: "Ticked sentences are guessed true, the rest false. The revision panel follows this one guess; the verdicts cover every guess." }));

  const grounded = a.kripke.least.filter((x) => x !== U).length;
  const settled = a.revision.filter((r) => r.call === "true" || r.call === "false").length;
  sClassical.set(`${a.classical.consistent.length} of ${a.classical.total}`, `assignment${a.classical.total === 1 ? "" : "s"} of true and false ${a.classical.consistent.length === 1 ? "is" : "are"} consistent`);
  sKripke.set(`${grounded} of ${n}`, `${n === 1 ? "sentence is" : "sentences are"} grounded`);
  sRevision.set(`${settled} of ${n}`, `${settled === 1 ? "settles" : "settle"} whatever the guess`);

  const byCall = ["true", "false", "looping", "unsettled"].map((c) => [c, S.filter((_, i) => a.revision[i].call === c).map((s) => s.name)]).filter(([, names]) => names.length);
  message.replaceChildren(el("div", { class: "note" }, el("strong", { text: "The evaluator's call. " }), byCall.map(([c, names]) => `${WORD[c]}: ${names.join(", ")}.`).join(" ")));

  cards.replaceChildren(...S.map((s, i) => el("div", { class: "panel card" },
    el("div", { class: "card-head" }, el("span", { class: "name", text: s.name }), el("span", { class: "says mono", text: s.text }), el("span", { class: `call ${a.revision[i].call}`, text: WORD[a.revision[i].call] })),
    el("dl", {},
      el("dt", { text: "Classical" }), el("dd", { text: classicalWords(a.classical.perSentence[i]) }),
      el("dt", { text: "Kripke" }), el("dd", { text: kripkeWords(a.kripke, i) }),
      el("dt", { text: "Revision" }), el("dd", { text: revisionWords(a.revision[i]) })))));

  /* 1. classical */
  const cl = a.classical;
  let classicalBody;
  if (n <= 3) {
    classicalBody = [
      el("p", { class: "small" }, "Each row is one assignment. “Comes out” is what each sentence says when the others have the guessed values; a row is consistent when nothing changes."),
      el("div", { class: "tbl-wrap" }, el("table", { class: "tbl grid" },
        el("thead", {}, el("tr", {}, S.map((s) => el("th", { scope: "col", class: "c", text: s.name })), el("th", { class: "c", text: "" }), S.map((s) => el("th", { scope: "col", class: "c", text: s.name })), el("th", { scope: "col", text: "" }))),
        el("tbody", {}, Array.from({ length: cl.total }, (_, k) => {
          const v = assignment(k, n), w = step(S, v);
          const changed = S.filter((_, i) => v[i] !== w[i]).map((s) => s.name);
          return el("tr", { class: changed.length ? null : "hit" }, v.map((x) => el("td", { class: "c" }, tv(x))), el("td", { class: "c muted", text: "comes out" }), w.map((x, i) => el("td", { class: "c" }, tv(x, x !== v[i] ? "mark" : ""))),
            el("td", { class: "small" }, changed.length ? `${list(changed)} ${changed.length === 1 ? "changes" : "change"}` : el("strong", { text: "consistent" })));
        })))),
    ];
  } else if (cl.consistent.length) {
    const shown = cl.consistent.slice(0, 12);
    classicalBody = [
      el("p", { class: "small" }, `Of the ${cl.total} assignments, ${cl.consistent.length === 1 ? "this one is" : `these ${cl.consistent.length} are`} consistent: every sentence comes out with the value it was given.${cl.consistent.length > shown.length ? ` The first ${shown.length} are shown.` : ""}`),
      grid(S, shown.map((v, k) => ({ head: `${k + 1}`, values: v }))),
    ];
  } else classicalBody = [el("p", { class: "small" }, `None of the ${cl.total} assignments is consistent: in every one, at least one sentence comes out with a different value from the one it was given.`)];
  const verdict = cl.consistent.length === 0 ? "Paradoxical: the definitions cannot all be satisfied." : cl.consistent.length === 1 ? "Determinate: exactly one assignment works." : `Underdetermined: ${cl.consistent.length} assignments work, and nothing chooses between them.`;

  /* 2. Kripke */
  const kr = a.kripke;
  const open = S.filter((_, i) => kr.least[i] === U).map((s) => s.name);
  const stageRows = kr.stages.map((v, k) => ({ head: `Stage ${k}`, values: v, mark: v.map((x, i) => k > 0 && x !== kr.stages[k - 1][i]), tail: k === 0 ? "nothing has a value" : `${list(S.filter((_, i) => v[i] !== kr.stages[k - 1][i]).map((s) => s.name))} settled` }));

  /* 3. revision from the chosen guess */
  const rv = revision(S, start);
  const total = rv.sequence.length;
  const seqRows = rv.sequence.slice(0, SHOWN_STAGES).map((v, k) => ({
    head: `Stage ${k}`, values: v, cls: k >= rv.loopStart ? "loop" : null, mark: v.map((x, i) => k > 0 && x !== rv.sequence[k - 1][i]),
    tail: k === 0 ? "the guess" : k === rv.loopStart ? (rv.period === 1 ? "stays here for ever" : "the loop starts") : "",
  }));
  // Sentences that share a fate are reported together.
  const fates = new Map();
  S.forEach((s, i) => {
    const r = rv.perSentence[i];
    const key = r.settles ? `${r.value === T ? "true" : "false"} from ${r.settledAt === 0 ? "the start" : `stage ${r.settledAt} on`}` : `${r.pattern.map(letter).join(" ")} for ever`;
    fates.set(key, [...(fates.get(key) || []), { name: s.name, settles: r.settles }]);
  });
  const fate = [...fates].map(([key, group]) => `${list(group.map((g) => g.name))} ${group[0].settles ? (group.length === 1 ? "is" : "are") : group.length === 1 ? "repeats" : "repeat"} ${key}`);

  details.replaceChildren(
    el("div", { class: "panel" }, el("h3", { text: "1. Classical: try every assignment" }), el("p", { class: "small lead" }, el("strong", { text: verdict })), classicalBody),
    el("div", { class: "panel" }, el("h3", { text: "2. Kripke: start with no values and build up" }),
      el("p", { class: "small lead" }, el("strong", { text: open.length ? `The least fixed point leaves ${list(open)} without a value.` : "Every sentence is grounded." }),
        ` Counting the least one, the definitions have ${plural(kr.fixedPoints, "fixed point")}.`),
      grid(S, stageRows),
      el("p", { class: "small muted" }, "A dash means no value; a ringed value is new at that stage. A sentence gets a value only when the values already fixed force it, whatever the rest turn out to be.")),
    el("div", { class: "panel" }, el("h3", { text: "3. Revision: guess, re-evaluate, repeat" }),
      el("p", { class: "small lead" }, el("strong", { text: rv.period === 1 ? `From this guess the sequence stops changing at stage ${rv.loopStart}.` : `From this guess the sequence falls into a loop of ${rv.period} stages${rv.loopStart ? ` at stage ${rv.loopStart}` : " straight away"}.` }),
        ` ${fate.join(". ")}.`),
      grid(S, seqRows),
      el("p", { class: "small muted" }, (total > SHOWN_STAGES ? `The first ${SHOWN_STAGES} of ${total} stages are shown. ` : "") + (rv.period === 1
        ? "Each stage re-evaluates every sentence against the stage before. Ringed values have just changed."
        : `Stage ${total} would repeat stage ${rv.loopStart}, so the marked rows recur for ever. Ringed values have just changed.`))));
}

update();
