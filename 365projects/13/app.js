// Day 13: Fallacy Detector. Interface.
import { $, el, fmt, mount, slider, button, stat, note, table, bars, chart, debounce } from "../kit/kit.js";
import { FALLACY_MODEL } from "./model.js";
import { prepare, predict, sentences, selective, reading } from "./logic.js";

mount();

const model = prepare(FALLACY_MODEL.model);
const EVAL = FALLACY_MODEL.evaluation;
const NONE = "No Fallacy";

const ABOUT = {
  "Ad Hominem": { name: "Ad hominem", what: "Attacking the person who makes a claim instead of the claim. Whether the speaker is unpleasant, biased or hypocritical does not settle whether what they said is true.", ask: "Would the argument be any weaker if someone else had made it?" },
  "Appeal to Emotion": { name: "Appeal to emotion", what: "Using fear, pity, pride or outrage in place of a reason. Feelings can be appropriate, but they are not evidence that a claim is true.", ask: "Take the feeling away. Is there a reason left?" },
  "Hasty Generalization": { name: "Hasty generalisation", what: "Drawing a general conclusion from one case, or from too few or unrepresentative cases.", ask: "How many cases is this based on, and how were they chosen?" },
  "Irrelevant Authority": { name: "Irrelevant authority", what: "Citing someone as an authority on a question outside their expertise, or treating popularity or fame as proof.", ask: "Is this person an expert on this particular question, and do the experts agree?" },
  "Red Herring": { name: "Red herring", what: "Changing the subject to something that sounds related but does not bear on the question being argued.", ask: "If the new point were granted, would the original question be any closer to an answer?" },
  [NONE]: { name: "No fallacy flagged", what: "The wording does not look like any of the five fallacies this detector knows. That is not a certificate of good reasoning: it cannot see whether the premises are true or whether the conclusion follows." },
};
const nameOf = (label) => ABOUT[label].name;
const lower = (label) => (label === NONE ? "no fallacy" : nameOf(label).toLowerCase());
const conf = (r) => fmt.pct(r.p, 0);
const TESTED = FALLACY_MODEL.rows;
const HALF = `its first choice is right about ${fmt.pct(EVAL.accuracy, 0)} of the time`;
const MAX_SENTENCES = 30, LONG_TEXT = 100;

// Written for this page, not taken from the training data. "written" is what a person would call each one,
// so the page can say honestly whether the detector agrees.
const EXAMPLES = [
  { label: "Attack on the person", written: "Ad Hominem", text: "Why would anyone listen to him about the budget? He is a failed businessman who cannot even manage his own life." },
  { label: "Emotion", written: "Appeal to Emotion", text: "Just imagine how terrified those poor children must feel. If you have any heart at all you will support this ban." },
  { label: "One case", written: "Hasty Generalization", text: "My uncle smoked every day and lived to ninety, so smoking is clearly not that dangerous for people." },
  { label: "Borrowed authority", written: "Irrelevant Authority", text: "A famous actor said in an interview that this diet cures diabetes, and he is a very smart person, so it must be true." },
  { label: "Changing the subject", written: "Red Herring", text: "You say we should cut emissions, but what about all the crime in our cities? That is the real problem we should talk about." },
  { label: "A plain argument", written: "No Fallacy", text: "School uniforms cost families money every year, and studies of schools that introduced them found no improvement in results, so the policy is hard to justify." },
  { label: "Several sentences", text: "The minister says the new rail line will cut journey times. But she has never held a real job, so her opinion is worthless. Besides, my train was late once last week, which shows that railways never work. We should think of the families who will lose their homes and cry over this." },
];

const state = { text: EXAMPLES[1].text, threshold: 0.4, example: 1 };

/* ---------- input ---------- */
const input = el("textarea", { id: "argument", rows: 5, spellcheck: "true", "aria-describedby": "argument-help" });
input.value = state.text;
input.addEventListener("input", debounce(() => { state.text = input.value; state.example = null; update(); }, 120));
const exampleRow = el("div", { class: "row", role: "group", "aria-label": "Examples" },
  EXAMPLES.map((e, i) => button(e.label, () => { input.value = e.text; state.text = e.text; state.example = i; update(); }, { small: true })),
  button("Clear", () => { input.value = ""; state.text = ""; state.example = null; update(); input.focus(); }, { small: true }));
const thresholdSlider = slider({
  label: "Only flag a fallacy when the detector is at least this confident", min: 0.2, max: 0.9, step: 0.05, value: state.threshold, format: (v) => fmt.pct(v, 0),
  hint: "Confidence is the probability the detector gives a reading, rounded to a whole per cent.",
  onInput: (v) => { state.threshold = Math.round(v * 100) / 100; update(); },
});

/* ---------- outputs ---------- */
const verdict = el("div", { role: "status", "aria-live": "polite" });
const exampleNote = el("div");
const barsBox = el("div");
const probBars = bars(barsBox, { items: [], max: 1, format: (v) => fmt.pct(v, 0) });
const whyBox = el("div");
const explainBox = el("div", { class: "grid2" });
const sentenceBox = el("div");
const reliabilityNote = el("div", { role: "status" });
const chartBox = el("div");
const plot = chart(chartBox, { series: [], height: 280 });

const sAcc = stat("Right about the label", fmt.pct(EVAL.accuracy, 0), `on ${fmt.int(FALLACY_MODEL.rows)} arguments it had not seen. Always guessing the commonest label: ${fmt.pct(EVAL.majorityBaseline, 0)}`);
const sBin = stat("Right about fallacy or not", fmt.pct(EVAL.fallacyOrNot, 0), `ignoring which fallacy. Always answering "fallacy" would get ${fmt.pct((TESTED - FALLACY_MODEL.counts[NONE]) / TESTED, 0)}`);
const sWrong = stat("Wrong about the label", fmt.pct(1 - EVAL.accuracy, 0), "about one answer in two");

function matrixTable() {
  const labels = FALLACY_MODEL.model.labels;
  const head = el("tr", {}, el("th", { scope: "col", text: "Written as" }), labels.map((l) => el("th", { scope: "col", class: "num", text: nameOf(l).replace("No fallacy flagged", "None") })));
  const body = EVAL.matrix.map((row, i) => {
    const total = row.reduce((a, b) => a + b, 0) || 1;
    return el("tr", {}, el("th", { scope: "row", text: nameOf(labels[i]).replace("No fallacy flagged", "No fallacy") }),
      row.map((n, j) => el("td", { class: `num${i === j ? " diag" : ""}`, style: { background: `color-mix(in srgb, var(--c1) ${Math.round((n / total) * 70)}%, transparent)` }, title: `${fmt.pct(n / total, 0)} of arguments written as ${nameOf(labels[i])}`, text: String(n) })));
  });
  return el("div", { class: "tbl-wrap" }, el("table", { class: "tbl matrix" },
    el("caption", { text: "What the detector said (columns) for arguments written as each type (rows)" }), el("thead", {}, head), el("tbody", {}, body)));
}

$("#app").append(
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("label", { for: "argument", text: "Paste an argument" })),
    input,
    el("div", { class: "hint", id: "argument-help", text: "A sentence or a short paragraph in English. Nothing you type leaves this page." })),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Or try one" })), exampleRow),
  verdict, exampleNote,
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" }, el("h2", { text: "Confidence in each reading" }), barsBox, whyBox, thresholdSlider.el),
    el("div", { class: "out" }, explainBox, sentenceBox)),
  el("div", { class: "out block2" },
    el("h2", { text: "How far to trust it" }),
    el("p", { class: "small muted", text: `Tested by 5-fold cross-validation: the detector is trained on four fifths of the ${fmt.int(FALLACY_MODEL.rows)} labelled arguments and scored on the fifth it has not seen, five times over.` }),
    el("div", { class: "stats" }, sAcc.el, sBin.el, sWrong.el),
    reliabilityNote, chartBox,
    table({
      caption: "By type of fallacy",
      columns: [
        { key: "name", label: "Type" }, { key: "n", label: "Examples", num: true },
        { key: "precision", label: "When it says this, it is right", num: true, format: (v) => fmt.pct(v, 0) },
        { key: "recall", label: "Share of real cases it finds", num: true, format: (v) => fmt.pct(v, 0) },
      ],
      rows: EVAL.perLabel.map((l) => ({ ...l, name: l.label === NONE ? "No fallacy" : nameOf(l.label) })),
    }),
    matrixTable()));

// How reliable the detector was in testing at the chosen bar. Redrawn only when the bar moves, so that typing does not re-announce it.
let shownBar = null;
function updateReliability() {
  if (shownBar === state.threshold) return;
  shownBar = state.threshold;
  const grid = Array.from({ length: 15 }, (_, i) => (20 + i * 5) / 100);
  const curve = selective(EVAL.pairs, grid);
  const here = selective(EVAL.pairs, [state.threshold])[0];
  const bar = fmt.pct(state.threshold, 0);
  const share = `${fmt.int(here.n)} of the ${fmt.int(TESTED)} test arguments (${fmt.pct(here.coverage, here.coverage < 0.095 || (here.coverage > 0.995 && here.coverage < 1) ? 1 : 0)})`;
  reliabilityNote.replaceChildren(
    here.n === 0 ? note("", el("strong", { text: `In testing the detector was never as much as ${bar} confident. ` }),
      `Its highest confidence in any of the ${fmt.int(TESTED)} test arguments was ${fmt.pct(Math.max(...EVAL.pairs.map(([c]) => c)), 0)}, so there is no measured accuracy for a bar this high.`)
    : here.n < 10 ? note("", el("strong", { text: `At ${bar} confidence or more there is too little to measure. ` }),
      `The detector was that confident about only ${share}, and its first choice was right in ${fmt.int(Math.round(here.accuracy * here.n))} of them. That is too few to give a rate.`)
    : note("", el("strong", { text: `At ${bar} confidence or more, the detector's first choice was right ${fmt.pct(here.accuracy, 0)} of the time` }),
      `, and it was that confident about ${share}. Raising the bar makes it more accurate and more often silent.`));
  plot.update({
    title: "Being choosier makes it more accurate, and quieter",
    subtitle: "The accuracy line stops where fewer than 10 test arguments are left.",
    label: "Line chart: as the confidence required rises from 20% to 90%, the share of the detector's answers that are right rises and the share of arguments it still answers falls",
    x: { label: "Confidence required before it gives an answer", format: (v) => fmt.pct(v, 0) },
    y: { domain: [0, 1], format: (v) => fmt.pct(v, 0) },
    series: [
      { name: "Share of its answers that are right", data: curve.filter((c) => c.n >= 10).map((c) => [c.threshold, c.accuracy]), color: 0 },
      { name: "Share of arguments it still answers", data: curve.map((c) => [c.threshold, c.coverage]), color: "#8a94a3" },
    ],
    marks: [{ type: "vline", x: state.threshold, text: "your setting" }],
  });
}

function update() {
  const text = state.text.trim();
  const words = text ? text.split(/\s+/).length : 0;
  updateReliability();

  exampleNote.replaceChildren();
  if (!text) {
    verdict.replaceChildren(note("", "Paste or type an argument above, or choose one of the examples."));
    probBars.update([]); whyBox.replaceChildren(); explainBox.replaceChildren(); sentenceBox.replaceChildren();
    return;
  }
  const result = predict(model, text);
  const read = reading(result, state.threshold, NONE);
  const { top, nearest, flagged } = read;
  const thin = read.kind === "thin";

  if (thin) {
    verdict.replaceChildren(note("warn", el("strong", { text: "Too little to go on. " }),
      result.words >= 8 && result.knownWords * 3 < result.words
        ? `The detector knows ${result.knownWords === 0 ? "none" : `only ${fmt.int(result.knownWords)}`} of the ${fmt.int(result.words)} words in this text. It was trained on everyday English and cannot read other languages or specialist vocabulary.`
        : `The detector recognises ${result.known === 0 ? "none" : `only ${result.known}`} of the words and word pairs in this text. Write a full sentence or two of everyday English.`));
  } else if (read.kind === "flag") {
    verdict.replaceChildren(note("warn", el("strong", { text: `Possible ${lower(flagged[0].label)} (${conf(flagged[0])} confident). ` }),
      top.label === NONE ? `Its first choice, though, is "no fallacy" at ${conf(top)}. ` : "",
      `Treat this as a prompt to look again, not a verdict: on arguments it has not seen, ${HALF}.`));
  } else if (read.kind === "none") {
    verdict.replaceChildren(note("good", el("strong", { text: `No fallacy flagged (${conf(top)} confident that it is none of the five). ` }),
      `This only means the wording does not resemble the fallacies in the training data. It says nothing about whether the argument is sound, and when "no fallacy" was its answer in testing it was right ${fmt.pct(EVAL.perLabel.find((l) => l.label === NONE).precision, 0)} of the time.`));
  } else {
    verdict.replaceChildren(note("", el("strong", { text: "Nothing clears your confidence bar. " }),
      `The nearest match is ${lower(nearest.label)} at ${conf(nearest)}, below the ${fmt.pct(state.threshold, 0)} you asked for. On arguments it has not seen, ${HALF}.`));
  }
  if (!thin && result.words > LONG_TEXT) {
    verdict.append(note("", `This text is ${fmt.int(result.words)} words long. The detector was trained and tested on arguments of a sentence or two, so its reading of a long text as a whole is untested. The sentence table is the better guide.`));
  }

  const example = state.example != null ? EXAMPLES[state.example] : null;
  if (example && example.written) {
    const hit = top.label === example.written;
    exampleNote.replaceChildren(el("p", { class: "small" },
      el("strong", { text: "Checking the detector: " }),
      `this example was written as ${example.written === NONE ? "a plain argument with no fallacy" : lower(example.written)}. The detector's first choice is ${lower(top.label)} at ${conf(top)}: ${hit ? "a hit" : "a miss"}. ${hit ? "" : "Misses like this are about half of what it does, which is why the numbers below matter more than any single answer."}`));
  }

  probBars.update(result.ranked.map((r) => ({ label: r.label === NONE ? "No fallacy" : nameOf(r.label), value: r.p, highlight: r === top })));
  const because = result.because[top.label];
  whyBox.replaceChildren(...(because.length && !thin ? [
    el("p", { class: "small muted", text: `Words that pushed it towards "${lower(top.label)}":` }),
    el("div", { class: "chips" }, because.map((f) => el("span", { class: "chip", text: f.feature, title: `weight ${fmt.num(f.push, 2)}` })))] : []));

  const shown = thin ? [] : (flagged.length ? flagged : top.label === NONE ? [top] : [nearest]).slice(0, 2);
  explainBox.replaceChildren(...shown.map((r) => el("div", { class: "panel" },
    el("h3", { text: `${nameOf(r.label)}${r.label === NONE ? "" : `: ${fmt.pct(r.p, 0)}`}` }),
    el("p", { class: "small", style: { marginTop: "8px" }, text: ABOUT[r.label].what }),
    ABOUT[r.label].ask ? el("p", { class: "small", style: { marginTop: "8px" } }, el("strong", { text: "Ask: " }), ABOUT[r.label].ask) : "")));

  const parts = sentences(text);
  if (parts.length > 1 && words >= 12) {
    const rowsOut = parts.slice(0, MAX_SENTENCES).map((sentence) => {
      const r = reading(predict(model, sentence), state.threshold, NONE);
      return r.kind === "thin" ? { sentence, reading: "Too little to judge", confidence: "" }
        : r.kind === "flag" ? { sentence, reading: `Possible ${lower(r.flagged[0].label)}`, confidence: conf(r.flagged[0]) }
        : r.kind === "none" ? { sentence, reading: "No fallacy flagged", confidence: conf(r.top) }
        : { sentence, reading: `Below your bar (nearest: ${lower(r.nearest.label)})`, confidence: conf(r.nearest) };
    });
    const sentenceTable = table({
      caption: parts.length > MAX_SENTENCES ? `Sentence by sentence: the first ${MAX_SENTENCES} of ${fmt.int(parts.length)}` : "Sentence by sentence",
      columns: [{ key: "sentence", label: "Sentence" }, { key: "reading", label: "Reading" }, { key: "confidence", label: "Confidence", num: true }],
      rows: rowsOut,
    });
    sentenceTable.classList.add("sentences");
    sentenceBox.replaceChildren(sentenceTable, el("p", { class: "small muted", style: { marginTop: "8px" }, text: `Each sentence is read on its own, out of context, against the same bar, and the confidence is for the reading shown. The error rates below were measured on whole arguments, not on sentences lifted out of a longer text, so these readings deserve at least as much doubt.` }));
  } else sentenceBox.replaceChildren();
}

update();
