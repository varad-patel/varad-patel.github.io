// Day 12: Syllogism Validator. Interface.
import { $, el, svgEl, mount, textField, segmented, button, stat, table } from "../kit/kit.js";
import { TERMS, FORMS, RULES, MODERN, TRADITIONAL, inTerm, regionsOf, parseSyllogism, verdict, readOff, bestCounterexample, explain, faults, census, formOf, wording } from "./logic.js";

mount();

const EXAMPLES = [
  { label: "Barbara", lines: ["All humans are mortal", "All Greeks are humans", "All Greeks are mortal"] },
  { label: "Socrates", lines: ["All men are mortal", "Socrates is a man", "Socrates is mortal"] },
  { label: "Undistributed middle", lines: ["All cats are animals", "All dogs are animals", "All dogs are cats"] },
  { label: "Illicit major", lines: ["All cats are animals", "No dogs are cats", "No dogs are animals"] },
  { label: "Unicorns", lines: ["All unicorns are horned animals", "All unicorns are horses", "Some horses are horned animals"] },
  { label: "Two negatives", lines: ["No fish are mammals", "Some pets are not fish", "Some pets are not mammals"] },
  { label: "Bocardo", lines: ["Some cats are not pets", "All cats are mammals", "Some mammals are not pets"] },
  { label: "Some and some", lines: ["Some students are athletes", "Some athletes are musicians", "Some students are musicians"] },
];
const TYPE = { A: "A, universal affirmative", E: "E, universal negative", I: "I, particular affirmative", O: "O, particular negative" };
const ROLE = { S: "minor term", M: "middle term", P: "major term" };
const state = { reading: "modern" };

/* ---------- controls ---------- */
const fields = [
  textField({ label: "First premise", value: EXAMPLES[0].lines[0], onInput: () => update() }),
  textField({ label: "Second premise", value: EXAMPLES[0].lines[1], onInput: () => update() }),
  textField({ label: "Conclusion", value: EXAMPLES[0].lines[2], hint: "All, no, some, some … are not. Articles, plurals and “therefore” are understood; a bare name such as “Socrates is a man” is read as one individual.", onInput: () => update() }),
];
const load = (lines) => { fields.forEach((f, i) => { f.value = lines[i]; }); update(); };
const readingSeg = segmented({
  label: "Reading shown in the diagram", value: "modern",
  options: [{ value: "modern", label: "Modern" }, { value: "traditional", label: "Traditional" }],
  hint: "Modern: “All S are P” is true when there are no S. Traditional: every term is assumed to have at least one member.",
  onChange: (v) => { state.reading = v; update(); },
});
const controls = el("div", { class: "controls" },
  fields.map((f) => f.el),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })), el("div", { class: "row" }, EXAMPLES.map((x) => button(x.label, () => load(x.lines), { small: true })))),
  readingSeg.el);

/* ---------- outputs ---------- */
const sModern = stat("Modern reading");
const sTraditional = stat("Traditional reading");
const sForm = stat("Mood and figure");
const verdictBox = el("div", { role: "status" });
const readBox = el("div");
const diagramBox = el("div", { class: "pair" });
const keyBox = el("p", { class: "small muted", text: "Shaded: nothing is there. Cross: something is there. Cross on a line: something is on one side or the other. Blue: what the conclusion is about. A lettered dot is one thing." });
const worldBox = el("div");
const faultBox = el("div");
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sModern.el, sTraditional.el, sForm.el), verdictBox, diagramBox, keyBox, worldBox, faultBox, readBox);
const mapBox = el("div", { class: "panel" });
$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out), mapBox);

/* ---------- the Venn diagram ---------- */
const CENTRE = { S: [130, 125], P: [230, 125], M: [180, 212] };
const RADIUS = 95;
// A point inside each region (bit 1 = S, bit 2 = M, bit 4 = P), and a point on the arc between each pair of regions a "some" statement can straddle.
const SPOT = { 1: [92, 106], 2: [180, 266], 3: [124, 194], 4: [268, 106], 5: [180, 82], 6: [236, 194], 7: [180, 150] };
const ON_LINE = { "1,3": [119, 139], "1,5": [138, 102], "4,6": [241, 139], "4,5": [222, 102], "2,6": [220.5, 219.5], "2,3": [139.5, 219.5], "3,7": [148, 173], "6,7": [212, 173], "5,7": [180, 117] };
const INK = "#16233b";
let vennCount = 0;
const short = (s) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);

function venn({ label, names, shaded = [], tint = [], crosses = [], floating = [], dots = [] }) {
  const id = `venn${++vennCount}`;
  const ring = (t, attrs) => svgEl("circle", { cx: CENTRE[t][0], cy: CENTRE[t][1], r: RADIUS, ...attrs });
  const full = { width: 360, height: 332 };
  // A region is the circles it is inside (nested clips) minus the circles it is outside (a mask).
  const fill = (r, paint, opacity) => TERMS.filter((t) => inTerm(r, t)).reduce(
    (node, t) => svgEl("g", { "clip-path": `url(#${id}c${t})` }, node),
    svgEl("rect", { ...full, fill: paint, opacity, mask: `url(#${id}m${r})` }));
  const cross = ([x, y]) => [5.5, 2.6].map((w, i) => svgEl("path", { d: `M${x - 6},${y - 6}L${x + 6},${y + 6}M${x - 6},${y + 6}L${x + 6},${y - 6}`, stroke: i ? INK : "#f9fbf9", "stroke-width": w, "stroke-linecap": "round", fill: "none" }));
  const name = (t, x, y, anchor) => svgEl("text", { x, y, "text-anchor": anchor }, short(names[t]));
  return svgEl("svg", { class: "venn", viewBox: "0 0 360 332", role: "img", "aria-label": label },
    svgEl("defs", {},
      svgEl("pattern", { id: `${id}h`, width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
        svgEl("rect", { width: 7, height: 7, fill: INK, opacity: 0.1 }),
        svgEl("line", { x1: 1, y1: 0, x2: 1, y2: 7, stroke: INK, "stroke-width": 2, opacity: 0.5 })),
      TERMS.map((t) => svgEl("clipPath", { id: `${id}c${t}` }, ring(t))),
      [1, 2, 3, 4, 5, 6, 7].map((r) => svgEl("mask", { id: `${id}m${r}`, maskUnits: "userSpaceOnUse", x: 0, y: 0, ...full },
        svgEl("rect", { ...full, fill: "#fff" }), TERMS.filter((t) => !inTerm(r, t)).map((t) => ring(t, { fill: "#000" }))))),
    tint.map((r) => fill(r, "#2a78d6", 0.22)),
    shaded.map((r) => fill(r, `url(#${id}h)`, 1)),
    TERMS.map((t) => ring(t, { fill: "none", stroke: INK, "stroke-width": 1.75 })),
    crosses.map((r) => cross(SPOT[r])),
    floating.map((pair) => cross(ON_LINE[pair.join(",")])),
    dots.map(({ region, letter }) => [
      svgEl("circle", { cx: SPOT[region][0], cy: SPOT[region][1], r: 12, fill: INK, stroke: "#f9fbf9", "stroke-width": 2 }),
      svgEl("text", { class: "on-dot", x: SPOT[region][0], y: SPOT[region][1], dy: "0.34em", "text-anchor": "middle" }, letter)]),
    name("S", 34, 20, "start"), name("P", 326, 20, "end"), name("M", 180, 327, "middle"));
}

/* ---------- words ---------- */
// The text speaks in the visitor's own terms; the letters S, M and P are kept for the table of forms.
const q = (name) => `“${name}”`;
const zone = (st, n) => (st.form === "A" || st.form === "O" ? `the part of ${q(n[st.subject])} outside ${q(n[st.predicate])}` : `the overlap of ${q(n[st.subject])} and ${q(n[st.predicate])}`);
const within = (r, n) => TERMS.filter((t) => inTerm(r, t)).map((t) => n[t]).join(" and ");

function whyText(p, v, d, reading) {
  const c = p.syl.conclusion, n = p.terms;
  const valid = v[reading].valid;
  if (d.wants === "empty") {
    return `The conclusion says ${zone(c, n)} is empty (tinted blue). ` + (valid
      ? "The premises shade all of it, so the conclusion cannot fail while they hold."
      : "The premises leave some of it unshaded, so something could be there.");
  }
  const start = `The conclusion says there is something in ${zone(c, n)} (tinted blue). `;
  if (valid) return start + (d.target.some((r) => d.inhabited.includes(r)) ? "The premises put a cross there, so the conclusion is guaranteed." : "The premises guarantee something there, though not in which part.");
  const straddles = d.floating.some((pair) => pair.some((r) => d.target.includes(r)) && !pair.every((r) => d.target.includes(r)));
  const shut = d.target.every((r) => d.empty.includes(r));
  return start + (shut ? "The premises shade it, so there cannot be."
    : straddles ? "The cross on the line may fall outside it, so nothing guarantees that."
    : `The premises put no cross there${reading === "modern" && v.needs ? `: nothing they say requires ${q(n[v.needs])} to have any members` : ""}.`);
}

function becauseText(st, model, letterOf, n) {
  const e = explain(st, model);
  const s = q(n[st.subject]), o = q(n[st.predicate]), who = e.witness == null ? "" : letterOf.get(e.witness);
  if (st.form === "A") return e.holds ? (e.vacuous ? `nothing is in ${s}, so nothing breaks it` : `everything in ${s} is in ${o}`) : `${who} is in ${s} but not in ${o}`;
  if (st.form === "E") return e.holds ? `nothing is in both ${s} and ${o}` : `${who} is in both ${s} and ${o}`;
  if (st.form === "I") return e.holds ? `${who} is in both ${s} and ${o}` : `nothing is in both ${s} and ${o}`;
  return e.holds ? `${who} is in ${s} but not in ${o}` : `nothing is in ${s} without being in ${o}`;
}

const FAULT_TEXT = {
  "undistributed-middle": (n) => `Neither premise says anything about every member of the middle term, ${q(n.M)}. The part of it that ${q(n.S)} is tied to and the part that ${q(n.P)} is tied to need not overlap, so the middle term never joins them.`,
  "illicit-major": (n) => `The conclusion says something about every member of ${q(n.P)}, but the premise that mentions ${q(n.P)} does not.`,
  "illicit-minor": (n) => `The conclusion says something about every member of ${q(n.S)}, but the premise that mentions ${q(n.S)} does not.`,
  "exclusive-premises": (n) => `Both premises only say what is kept apart. Two exclusions give no link from ${q(n.S)} to ${q(n.P)} through ${q(n.M)}.`,
  "affirmative-from-negative": (n) => `One premise keeps two terms apart, yet the conclusion joins ${q(n.S)} and ${q(n.P)}. An affirmative conclusion needs two affirmative premises.`,
  "negative-from-affirmatives": (n) => `Both premises join terms together, yet the conclusion keeps ${q(n.S)} and ${q(n.P)} apart. A negative conclusion needs a negative premise.`,
  "existential": (n, v) => `Both premises are universal, and on the modern reading a universal statement does not say that anything exists. The conclusion does. It follows only if ${q(n[v.needs])} has at least one member.`,
};

/* ---------- the map of all 256 forms ---------- */
const all = census();
const cells = new Map();
const LAYOUT = { 1: "M–P, S–M", 2: "P–M, S–M", 3: "M–P, M–S", 4: "P–M, M–S" };
function buildMap() {
  const describe = (r) => `${r.key}${r.name ? `, ${r.name}` : ""}: ${r.modern ? "valid on both readings" : r.traditional ? `valid only if there is at least one ${r.needs}` : "invalid"}`;
  const cell = (r) => {
    const b = el("button", { type: "button", class: r.modern ? "both" : r.traditional ? "trad" : "", title: describe(r), "aria-label": describe(r), "aria-pressed": "false", text: r.modern ? "✓" : r.traditional ? "+" : "·",
      onclick: () => { const f = formOf(r.mood, r.figure); load([wording(f.major), wording(f.minor), wording(f.conclusion)]); } });
    cells.set(r.key, b);
    return el("td", {}, b);
  };
  const count = (test) => all.filter(test).length;
  mapBox.append(
    el("h3", { text: "All 256 forms" }),
    el("p", { class: "small", style: { margin: "6px 0 12px" } },
      el("strong", { text: `${count((r) => r.modern)} are valid on both readings` }), ` (✓), ${count((r) => r.traditional && !r.modern)} more are valid only on the traditional reading (+), and ${count((r) => !r.traditional)} are invalid on both (·). `,
      "Rows are the two premises, columns the conclusion. Pick a square to load that form."),
    el("div", { class: "forms" }, [1, 2, 3, 4].map((figure) => el("table", {},
      el("caption", {}, `Figure ${figure} `, el("span", { class: "muted", text: LAYOUT[figure] })),
      el("thead", {}, el("tr", {}, el("td", {}), FORMS.map((c) => el("th", { scope: "col", text: c })))),
      el("tbody", {}, FORMS.flatMap((a) => FORMS.map((b) => el("tr", {}, el("th", { scope: "row", text: a + b }),
        FORMS.map((c) => cell(all.find((r) => r.key === `${a}${b}${c}-${figure}`)))))))))));
}
buildMap();

/* ---------- rendering ---------- */
function update() {
  const p = parseSyllogism(...fields.map((f) => f.value));
  fields.forEach((f, i) => f.input.classList.toggle("invalid", !p.ok && p.field === i));
  for (const [key, b] of cells) b.setAttribute("aria-pressed", String(p.ok && !p.singular.length && key === p.key));
  if (!p.ok) {
    for (const s of [sModern, sTraditional, sForm]) s.set("–", "");
    verdictBox.replaceChildren(el("div", { class: "note bad" }, p.error));
    for (const box of [diagramBox, worldBox, faultBox, readBox]) { box.replaceChildren(); box.hidden = true; }
    keyBox.hidden = true;
    return;
  }

  const v = verdict(p.syl, p.singular);
  const reading = state.reading;
  const opts = reading === "modern" ? MODERN : TRADITIONAL;
  sModern.set(v.modern.valid ? "Valid" : "Invalid", "a term may be empty");
  sTraditional.set(v.traditional.valid ? "Valid" : "Invalid", "every term has a member");
  sForm.set(p.key, p.name || `figure ${p.figure}, no traditional name`);

  const cls = v.modern.valid ? "good" : v.traditional.valid ? "warn" : "bad";
  verdictBox.replaceChildren(el("div", { class: `note ${cls}` },
    v.modern.valid ? el("span", {}, el("strong", { text: "Valid. " }), "If both premises are true the conclusion must be true, on either reading. Whether the premises are true is a separate question.")
      : v.traditional.valid ? el("span", {}, el("strong", { text: "The two readings disagree. " }), `The conclusion follows only if ${q(p.terms[v.needs])} has at least one member. The traditional reading takes that for granted; the modern reading does not.`)
      : el("span", {}, el("strong", { text: "Invalid. " }), "The premises can both be true while the conclusion is false, on either reading. A world where that happens is drawn below.")));

  // What the premises say, and what the conclusion needs.
  const d = readOff(p.syl, opts, p.singular);
  const names = p.terms;
  const first = el("div", {},
    el("h3", { text: `What the premises say, ${reading} reading` }),
    venn({ label: `Venn diagram of the two premises. Empty regions: ${d.empty.map((r) => within(r, names)).join("; ") || "none"}. Inhabited regions: ${d.inhabited.map((r) => within(r, names)).join("; ") || "none"}.`, names, shaded: d.empty, tint: d.target, crosses: d.inhabited, floating: d.floating }),
    el("p", { class: "small" }, whyText(p, v, d, reading)));

  let second = null;
  const model = bestCounterexample(v[reading].counterexamples);
  if (model != null) {
    const letterOf = new Map(regionsOf(model).map((r, i) => [r, "abcdefg"[i]]));
    const things = [...letterOf].map(([region, letter]) => ({ region, letter }));
    second = el("div", {},
      el("h3", { text: "A world where it fails" }),
      venn({ label: `Counterexample with ${things.length} thing${things.length === 1 ? "" : "s"}: ${things.map((t) => `${t.letter} in ${within(t.region, names)}`).join("; ")}.`, names, shaded: [1, 2, 3, 4, 5, 6, 7].filter((r) => !letterOf.has(r)), tint: d.target, dots: things }),
      el("p", { class: "small" }, things.length
        ? `This world holds ${things.length === 1 ? "one thing" : `${things.length} things`}: ${things.map((t) => `${t.letter} is ${TERMS.map((x) => `${inTerm(t.region, x) ? "in" : "not in"} ${q(names[x])}`).join(", ")}`).join("; ")}. Everything else is empty.`
        : "This world holds nothing at all."));
    worldBox.replaceChildren(table({
      caption: "The three statements in that world",
      columns: [{ key: "text", label: "Statement" }, { key: "truth", label: "Here" }, { key: "why", label: "Because" }],
      rows: p.statements.map((st) => ({ text: st.text, truth: explain(st, model).holds ? "true" : "false", why: becauseText(st, model, letterOf, names) })),
    }));
  } else {
    worldBox.replaceChildren(...(v.modern.valid !== v.traditional.valid ? [el("div", { class: "note" }, "On the traditional reading the form is valid, so there is no failing world to show. Switch to the modern reading to see one.")] : []));
  }
  diagramBox.replaceChildren(...[first, second].filter(Boolean));
  for (const box of [diagramBox, keyBox, readBox]) box.hidden = false;

  const found = faults(p.syl, p.singular)[reading];
  faultBox.replaceChildren(...(found.length ? [el("div", { class: "panel" },
    el("h3", { text: found.length === 1 ? "The classical name for this mistake" : "The classical names for these mistakes" }),
    el("ul", { class: "faults" }, found.map((k) => el("li", {}, el("strong", { text: `${RULES[k]}. ` }), FAULT_TEXT[k](names, v)))))] : []));

  // How the three statements were read.
  const shape = (st) => (st.singular ? `${st.subject} is ${st.form === "E" ? "not " : ""}${st.predicate} (one thing)` : wording(st));
  const [p1, p2, c] = p.statements;
  const ordered = p.majorFirst ? [p1, p2] : [p2, p1];
  const notes = [
    !p.majorFirst && "The premises are listed in the standard order, major premise first. The order you type them in makes no difference.",
    p.singular.length && `${p.singular.map((t) => p.terms[t]).join(" and ")} is read as naming exactly one thing. Traditional logic files such statements under A and E; here the name also guarantees that the thing exists, on both readings.`,
    p.statements.some((s) => s.swapped) && "“Only X are Y” is read as “All Y are X”.",
  ].filter(Boolean);
  readBox.replaceChildren(
    table({
      caption: "How the tool read it",
      columns: [{ key: "role", label: "Role" }, { key: "text", label: "As typed" }, { key: "shape", label: "Form" }, { key: "type", label: "Type" }],
      rows: [["Major premise", ordered[0]], ["Minor premise", ordered[1]], ["Conclusion", c]].map(([role, st]) => ({ role, text: st.text, shape: shape(st), type: TYPE[st.form] })),
    }),
    el("p", { class: "small", style: { marginTop: "8px" } }, TERMS.flatMap((t, i) => [i ? " · " : "", el("strong", { text: t }), p.terms[t] === t ? ` (${ROLE[t]})` : ` is ${q(p.terms[t])} (${ROLE[t]})`])),
    ...notes.map((n) => el("p", { class: "small muted", style: { marginTop: "6px" } }, n)));
  for (const box of [worldBox, faultBox]) box.hidden = !box.childNodes.length; // an empty box would still take a grid gap
}

update();
