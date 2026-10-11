// Day 6: Trolley Problem Lab. Interface.
import { $, el, svgEl, mount, button, stat, note, table, palette } from "../kit/kit.js";
import { FEATURES, CASES, THEORIES, PAIRS, TWINS, answersOf, score, closest, consistency, countCoherent, caseById, featureByKey } from "./logic.js";

mount();

// `mine` holds the visitor's own answers while a theory's verdicts are on show, so that they can be brought back.
const state = { at: 0, answers: {}, mine: null, showing: null };
const COUNTS = countCoherent();
const answered = () => CASES.filter((c) => typeof state.answers[c.id] === "boolean").length;
const strong = (text) => el("strong", { text });
const title = (id) => strong(caseById(id).title);
const list = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/* ---------- diagrams ---------- */
const INK = "#16233b", RULE = "#b9c5bd", MANY = palette[0], ONE = palette[1];
const track = (d) => [svgEl("path", { d, fill: "none", stroke: RULE, "stroke-width": 7, "stroke-linecap": "round" }), svgEl("path", { d, fill: "none", stroke: INK, "stroke-width": 1.4, "stroke-dasharray": "2 5" })];
const person = (x, y, fill, k = 1) => svgEl("g", { transform: `translate(${x} ${y}) scale(${k})` },
  svgEl("circle", { cx: 0, cy: -9.5, r: 3.8, fill }), svgEl("rect", { x: -4.8, y: -4.6, width: 9.6, height: 13, rx: 3.2, fill }));
const label = (x, y, text, anchor = "middle") => svgEl("text", { x, y, "text-anchor": anchor }, text);
const trolley = (x, y) => [svgEl("rect", { x: x - 17, y: y - 10, width: 34, height: 20, rx: 3, fill: INK }),
  svgEl("path", { d: `M${x + 23},${y} h13 m-5,-4.5 l5,4.5 l-5,4.5`, fill: "none", stroke: INK, "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" })];
const lever = (x, y) => [svgEl("path", { d: `M${x},${y} l7,-17`, stroke: INK, "stroke-width": 2.2, "stroke-linecap": "round" }), svgEl("circle", { cx: x + 7, cy: y - 17, r: 3, fill: INK })];
const five = (x, y) => [0, 1, 2, 3, 4].map((i) => person(x + i * 14, y, MANY));
const room = (x, w) => svgEl("rect", { x, y: 34, width: w, height: 112, fill: "#fff", stroke: RULE, "stroke-width": 1.5 });

const SCENES = {
  fork: (c) => [
    track("M10,116 H350"), track("M138,116 C196,116 204,50 262,50 H350"), trolley(30, 116),
    five(276, 114), label(304, 147, "five people"),
    person(318, 48, ONE), label(318, 26, c.id === "child" ? "your child" : "one person"),
    c.id === "driver" ? label(13, 96, "you, driving", "start") : [lever(138, 150), person(120, 146, INK), label(108, 149, "you", "end")],
  ],
  loop: () => [
    track("M10,120 H286"), track("M96,120 C142,120 136,44 190,44 H262 C334,44 338,120 286,120"), trolley(30, 120),
    five(176, 118), label(204, 151, "five people"),
    person(228, 42, ONE), label(228, 20, "one person"),
    lever(98, 154), person(80, 150, INK), label(68, 153, "you", "end"),
  ],
  bridge: (c) => [
    track("M10,116 H350"),
    svgEl("rect", { x: 160, y: 10, width: 36, height: 138, fill: "#fff", stroke: RULE, "stroke-width": 1.5 }), label(178, 164, "footbridge"),
    trolley(30, 116),
    c.id === "station"
      ? [svgEl("rect", { x: 262, y: 88, width: 88, height: 56, fill: "#fff", stroke: INK, "stroke-width": 1.4 }),
         [0, 1, 2, 3, 4, 5].map((i) => [person(274 + i * 13, 108, MANY, 0.72), person(274 + i * 13, 132, MANY, 0.72)]), label(306, 80, "1,000 people")]
      : [five(276, 114), label(304, 147, "five people")],
    person(178, 46, INK), label(152, 49, "you", "end"),
    person(178, 84, ONE, 1.3), label(204, 87, "stranger", "start"),
  ],
  trapdoor: (c) => [
    track("M10,116 H350"),
    svgEl("rect", { x: 160, y: 10, width: 36, height: 138, fill: "#fff", stroke: RULE, "stroke-width": 1.5 }), label(178, 164, "footbridge"),
    svgEl("rect", { x: 164, y: 96, width: 28, height: 36, fill: "none", stroke: INK, "stroke-width": 1.4, "stroke-dasharray": "4 3" }),
    svgEl("path", { d: "M88,52 L164,100", fill: "none", stroke: "#8a94a3", "stroke-width": 1.2, "stroke-dasharray": "3 4" }),
    trolley(30, 116), five(276, 114), label(304, 147, "five people"),
    person(178, 116, ONE, 1.3), label(204, 92, c.id === "volunteer" ? "stranger: “Pull it.”" : "stranger on a trapdoor", "start"),
    lever(80, 64), person(62, 58, INK), label(62, 84, "you"),
  ],
  transplant: () => [
    room(14, 198), room(232, 114), label(113, 24, "five patients"), label(289, 24, "one healthy visitor"),
    [0, 1, 2, 3, 4].map((i) => person(45 + i * 34, 96, MANY)),
    person(308, 96, ONE), person(268, 96, INK), label(268, 124, "you"),
  ],
  gas: () => [
    room(14, 198), room(232, 114), label(113, 24, "five patients"), label(289, 24, "one patient"),
    [0, 1, 2, 3, 4].map((i) => person(45 + i * 34, 68, MANY)),
    svgEl("rect", { x: 52, y: 94, width: 26, height: 24, rx: 2, fill: INK }), person(34, 110, INK), label(34, 134, "you"),
    svgEl("path", { d: "M80,106 H274 m-6,-5 l6,5 l-6,5", fill: "none", stroke: "#8a94a3", "stroke-width": 1.6, "stroke-dasharray": "5 4" }), label(160, 98, "fumes"),
    person(296, 104, ONE),
  ],
};
const diagram = (c) => svgEl("svg", { viewBox: "0 0 360 172", role: "img", "aria-label": `Diagram of ${c.title.toLowerCase()}` }, SCENES[c.scene](c));

/* ---------- the case ---------- */
const dots = CASES.map((c, i) => el("button", { type: "button", class: "dot", onclick: () => go(i) }, String(i + 1)));
const counter = el("span");
const caseTitle = el("h2", { tabindex: "-1" });
const caseSource = el("p", { class: "small muted" });
const figure = el("div", { class: "dg" });
const caseText = el("p", { class: "case-text" });
const question = el("p", { class: "case-q" });
const yes = button("Permissible", () => answer(true));
const no = button("Not permissible", () => answer(false));
const reveal = el("div", { "aria-live": "polite" });
const prev = button("Previous", () => go(state.at - 1), { small: true });
const next = button("Next case", () => go(state.at + 1), { small: true });
const reset = button("Start again", () => { state.answers = {}; state.mine = null; state.showing = null; state.at = 0; render(); }, { small: true });

const casePanel = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "The ten cases" }), counter), el("div", { class: "dots" }, dots)),
  el("div", {}, caseTitle, caseSource), figure, caseText, question,
  el("div", { class: "row" }, yes, no), reveal,
  el("div", { class: "row", style: { justifyContent: "space-between" } }, el("div", { class: "row" }, prev, next), reset));

/* ---------- the results ---------- */
const sAnswered = stat("Answered");
const sBest = stat("Closest theory");
const sLines = stat("Lines you draw");
const sAgainst = stat("Answers against the grain");
const status = el("p", { class: "small", role: "status" });
const intro = note("", strong("What happens. "), "Read the case and choose Permissible or Not permissible. Each answer is checked at once against the six theories listed below, and you are shown how the case is coded. As your answers build up, the bars show how many of them each theory reproduces, and the last section names the feature behind every line you draw between two cases. The page does not say which answers are right, and nothing you click leaves it.");
const theoryRows = THEORIES.map((t) => {
  const value = el("span", { class: "th-val" });
  const fill = el("span", { class: "th-fill" });
  const row = el("div", { class: "th" },
    el("div", { class: "th-head" }, el("span", { class: "th-name", text: t.name }), value),
    el("div", { class: "th-track" }, fill), el("p", { class: "th-rule", text: t.rule }));
  return { key: t.key, row, value, fill };
});
const checks = el("div", { class: "checks" });
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sAnswered.el, sBest.el, sLines.el, sAgainst.el), intro, status,
  el("div", {}, el("h2", { text: "Your answers against six theories" }), el("p", { class: "small muted", text: "Each theory is a rule over the coded features of a case. The bar is the share of your answers so far that the rule reproduces." }), el("div", { class: "ths" }, theoryRows.map((r) => r.row))),
  el("div", {}, el("h2", { text: "Where you draw lines" }), checks));

const tableBox = el("div");
const restore = button("Back to my own answers", () => {
  state.answers = state.mine || {}; state.mine = null; state.showing = null;
  render();
  caseTitle.focus();   // this button has just hidden itself
}, { small: true, primary: true });
const presets = el("div", { class: "field" },
  el("div", { class: "lab" }, el("span", { text: "See how a theory answers all ten" })),
  el("div", { class: "row" }, THEORIES.map((t) => button(t.name, () => {
    if (!state.mine) state.mine = { ...state.answers };
    state.answers = answersOf(t.key); state.showing = t;
    render();
  }, { small: true })), restore),
  el("div", { class: "hint", text: "This puts the theory's ten verdicts in place of your answers, which are kept: \"Back to my own answers\" returns them. Every theory scores ten of ten against itself and draws only the lines its rule mentions." }));

$("#app").append(el("div", { class: "tool-grid wide-controls" }, casePanel, out), tableBox, presets);

/* ---------- behaviour ---------- */
function go(i) { state.at = Math.min(CASES.length - 1, Math.max(0, i)); render(); caseTitle.focus(); }
function answer(value) { state.answers[CASES[state.at].id] = value; state.showing = null; render(); }

function renderCase() {
  const c = CASES[state.at];
  const a = state.answers[c.id];
  const n = answered();
  counter.textContent = `${n} of ${CASES.length} answered`;
  dots.forEach((d, i) => {
    const v = state.answers[CASES[i].id];
    d.className = `dot${typeof v === "boolean" ? " done" : ""}`;
    d.setAttribute("aria-label", `Case ${i + 1}, ${CASES[i].title}: ${v === true ? "answered permissible" : v === false ? "answered not permissible" : "not answered"}`);
    i === state.at ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current");
  });
  caseTitle.textContent = `${state.at + 1}. ${c.title}`;
  caseSource.textContent = c.source;
  figure.replaceChildren(diagram(c));
  caseText.textContent = c.text;
  question.textContent = `Is it morally permissible to ${c.act}?`;
  yes.setAttribute("aria-pressed", String(a === true));
  no.setAttribute("aria-pressed", String(a === false));
  prev.disabled = state.at === 0;
  next.disabled = state.at === CASES.length - 1;
  next.classList.toggle("primary", typeof a === "boolean" && !next.disabled);

  if (typeof a !== "boolean") { reveal.replaceChildren(); return; }
  const agree = THEORIES.filter((t) => t.permits(c.f) === a).map((t) => t.name);
  const differ = THEORIES.filter((t) => t.permits(c.f) !== a).map((t) => t.name);
  reveal.replaceChildren(el("div", { class: "panel small" },
    // While a theory's verdicts are on show, the answer is the theory's and not the visitor's.
    el("p", {}, strong(`${state.showing ? `${state.showing.name} says` : "You said"}: ${a ? "permissible" : "not permissible"}. `), agree.length ? `${state.showing ? "The theories that say so" : "Agreeing with you"}: ${list(agree)}. ` : "None of the six theories agrees. ", differ.length ? `Disagreeing: ${list(differ)}.` : "None disagrees."),
    el("p", { class: "muted", style: { marginTop: "8px" }, text: "How this case is coded:" }),
    el("ul", { class: "coding" }, FEATURES.map((x) => el("li", { text: x.says(c.f[x.key]) })), el("li", { text: "one life is lost" }))));
}

function renderChecks(k) {
  const blocks = [];
  const differs = (x, p) => `In the first, ${x.says(caseById(p.easier).f[x.key])}; in the second, ${x.says(caseById(p.harder).f[x.key])}.`;
  for (const p of k.reversals) {
    const x = featureByKey(p.feature);
    blocks.push(note("bad", strong("Against the grain. "), "You forbid ", title(p.easier), " but permit ", title(p.harder), `. The only coded difference is ${x.name}. ${differs(x, p)} Every rule on this page finds the first at least as easy to justify as the second, so no theory here can give this pair of answers.`));
  }
  for (const t of k.twins) {
    blocks.push(note("bad", strong("Same coding, different answers. "), title(t.a), " and ", title(t.b), " are coded identically on all seven features, yet you permit one and forbid the other. Either the two answers conflict, or something this page does not code is doing the work: perhaps the trust people must be able to place in doctors."));
  }
  for (const u of k.uneven) {
    const x = featureByKey(u.feature);
    blocks.push(note("warn", strong("An uneven line. "), `You let ${x.name} decide between `, title(u.decides.easier), " and ", title(u.decides.harder), ", but you permit both ", title(u.ignored.easier), " and ", title(u.ignored.harder), ", which differ in the same way. A principle that fits your answers has to say why the feature matters in one place and not the other."));
  }
  for (const key of k.features) {
    const x = featureByKey(key);
    const mine = k.lines.filter((l) => l.feature === key);
    blocks.push(note("", strong(`A line at ${x.name}. `), state.showing ? "This theory permits " : "You permit ", mine.map((l, i) => [i ? ", and " : "", title(l.easier), " but not ", title(l.harder)]), `. Nothing else in the coding differs. ${differs(x, mine[0])} ${state.showing ? "Its verdicts commit it" : "Your answers commit you"} to the claim ${x.claim}`));
  }
  const full = answered() === CASES.length;
  if (!k.checked) {
    blocks.push(note("", `Among the ten cases there are ${PAIRS.length} pairs that differ in exactly one coded feature and ${TWINS.length} pair coded identically. Once you have answered both cases of a pair, the comparison appears here.`));
  } else if (!blocks.length) {
    blocks.push(note(full ? "good" : "", full
      ? `You treat the two cases alike in every one of the ${k.total} pairs, so none of the coded features changes your answer.`
      : `You have treated alike every pair compared so far (${k.checked} of ${k.total}), so no feature has yet changed your answer.`));
  }
  if (full && !k.reversals.length && !k.twins.length) {
    blocks.unshift(note("good", k.uneven.length
      ? `No answer goes against the grain. ${COUNTS.noReversal} of the ${COUNTS.total.toLocaleString("en-GB")} possible sets of answers can say that.`
      : `No answer goes against the grain and no line is uneven. ${COUNTS.clean} of the ${COUNTS.total.toLocaleString("en-GB")} possible sets of answers pass every check here, and ${THEORIES.length} of those are the theories above.`));
  }
  checks.replaceChildren(...blocks);
}

function render() {
  renderCase();
  const n = answered();
  const s = score(state.answers);
  const best = closest(state.answers);
  const k = consistency(state.answers);

  sAnswered.set(`${n} of ${CASES.length}`, n === CASES.length ? "all ten" : n ? "the results update as you go" : "answer the first case to start");
  sBest.set(best.length ? `${best[0].matched} of ${n}` : "–", best.length ? list(best.map((b) => b.short)) : "no answers yet");
  sLines.set(String(k.features.length), k.features.length === 1 ? "feature changes your answer" : "features change your answer");
  sAgainst.set(String(k.reversals.length + k.twins.length), `of ${k.checked} pair${k.checked === 1 ? "" : "s"} compared so far`);
  intro.hidden = n > 0;
  restore.hidden = !state.mine;
  status.textContent = !n
    ? "Nothing answered yet. Start with case 1."
    : state.showing
      ? `These are the ten verdicts of ${state.showing.inText}, shown in place of your answers. "Back to my own answers", below the table, returns yours.`
      : `After ${n} of ${CASES.length} cases your answers are closest to ${list(best.map((b) => b.inText))}, which ${best.length > 1 ? "each reproduce" : "reproduces"} ${best[0].matched} of them.`;

  for (const r of theoryRows) {
    const t = s.find((x) => x.key === r.key);
    r.value.textContent = n ? `${t.matched} of ${n}` : "–";
    r.fill.style.width = `${(t.share ?? 0) * 100}%`;
    r.row.classList.toggle("best", best.some((b) => b.key === r.key));
  }
  renderChecks(k);

  const word = (v) => (v ? "yes" : "no");
  tableBox.hidden = !n;
  tableBox.replaceChildren(
    el("div", { class: "verdict-wide" }, table({
      caption: "All ten cases: is the act permissible?",
      columns: [
        { key: "i", label: "No." }, { key: "title", label: "Case" }, { key: "you", label: "You" },
        ...THEORIES.map((t) => ({ key: t.key, label: t.short })),
      ],
      rows: CASES.map((c, i) => {
        const a = state.answers[c.id];
        const done = typeof a === "boolean";
        const row = { i: String(i + 1), title: c.title, you: done ? strong(word(a)) : "–" };
        for (const t of THEORIES) {
          const v = t.permits(c.f);
          row[t.key] = done ? el("span", {}, el("span", { class: v === a ? "agree" : "differ", text: word(v) }), v === a ? null : el("span", { class: "sr-only", text: " (differs from you)" })) : "·";
        }
        return row;
      }),
    }), el("p", { class: "small muted", style: { marginTop: "6px" }, text: "A theory's verdict on a case appears once you have answered it. Verdicts that differ from yours are struck through." })),
    // Nine columns cannot fit a phone, so a narrow screen gets the same information as a list.
    el("div", { class: "verdict-narrow" },
      el("h2", { text: "All ten cases: your answer and the theories that differ" }),
      el("ol", {}, CASES.map((c) => {
        const a = state.answers[c.id];
        if (typeof a !== "boolean") return el("li", {}, strong(c.title), ": not answered yet.");
        const differ = THEORIES.filter((t) => t.permits(c.f) !== a).map((t) => t.short);
        return el("li", {}, strong(c.title), `: ${a ? "permissible" : "not permissible"}. `,
          !differ.length ? "All six theories agree." : differ.length === THEORIES.length ? "All six theories say otherwise." : `Saying otherwise: ${list(differ)}.`);
      }))));
}

render();
