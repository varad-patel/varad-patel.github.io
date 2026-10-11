// Day 7: Utilitarian Calculator. Interface.
import { $, el, fmt, mount, numberField, textField, select, slider, segmented, button, stat, note, table, chart, palette } from "../kit/kit.js";
import { BIG, LIMITS, PRESETS, blankModel, addGroup, removeGroup, addOption, removeOption, addOutcome, removeOutcome, normalised, evaluate, withEqualWeights, sensitivity, mostFragile } from "./logic.js";

mount();

const state = { model: PRESETS[0].model(), preset: PRESETS[0].key, vary: "", view: "weighted", range: 2 };
state.pristine = JSON.stringify(state.model); // the example as loaded, to tell when the visitor has changed it

// Numbers too long to print in full are written as 5.5 × 10¹⁰, so no input can push a 300-digit number onto the page.
const sci = (x) => { const [m, e] = x.toExponential(2).split("e"); return `${Number(m)} × 10${e.replace("+", "").replace("-", "⁻").replace(/\d/g, (d) => "⁰¹²³⁴⁵⁶⁷⁸⁹"[d])}`; };
const extreme = (x, hi) => Number.isFinite(x) && x !== 0 && (Math.abs(x) >= hi || Math.abs(x) < 1e-6);
const score = (x) => (extreme(x, 1e15) ? sci(x) : Math.abs(x) >= 1e6 ? fmt.compact(x) : Math.abs(x) >= 1000 ? fmt.int(x) : fmt.sig(x, 3));
const signed = (x) => (x > 0 ? "+" : "") + score(x);
// A weight to d significant figures, and never fewer than its whole-number part needs (6,667, not 6,670).
const weight = (w, d = 3) => (extreme(w, 1e9) ? sci(w) : fmt.sig(w, w >= 1000 ? Math.max(d, Math.floor(Math.log10(w)) + 1) : d));
const now = (w) => weight(w, 6);
// A flip point, with enough figures to show which side of the current weight it lies on (1.455 against 1.45, not 1.45 against 1.45).
function flipAt(at, w0) {
  for (let d = 3; d < 12; d++) { const r = Number(at.toPrecision(d)); if (r !== w0 && r > w0 === at > w0) return weight(at, d); }
  return weight(at, 12);
}
const short = (text, n = 26) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const groupName = (g) => g.name.trim() || "Unnamed group";
const optionName = (o) => o.name.trim() || "Unnamed option";
const unit = () => state.model.unit.trim() || "wellbeing";
// replaceChildren that, like el(), accepts arrays and skips empty values.
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

/* ------------------------------------------------------------------ presets */
const presetButtons = [...PRESETS.map((p) => [p.key, p.label]), ["blank", "Blank"]].map(([key, label]) => {
  const b = button(label, () => load(key), { small: true });
  b.dataset.preset = key;
  return b;
});
const blurb = el("p", { class: "small muted" });

function load(key) {
  const preset = PRESETS.find((p) => p.key === key);
  state.preset = key;
  state.model = preset ? preset.model() : blankModel();
  state.pristine = JSON.stringify(state.model);
  state.vary = "";
  structural();
}

/* ------------------------------------------------------------------- editor */
const editor = el("div", { class: "controls ed" });

// A number box that writes NaN to the model while it is blank or out of range, so validate() can say what is wrong.
function numField(label, value, opts, set) {
  const f = numberField({ label, value: Number.isFinite(value) ? Number(value.toPrecision(6)) : "", ...opts });
  if (opts.negative) f.input.removeAttribute("inputmode"); // the decimal keypad on phones has no minus key
  f.input.addEventListener("input", () => { set(f.value); refresh(); });
  return f;
}
// Names are labels on charts and in tables, so they are kept to a length that fits there.
const limit = (field, n) => { field.input.maxLength = n; return field; };
function removeButton(what, fn) {
  const b = button("×", fn, { small: true, title: `Remove ${what}` });
  b.setAttribute("aria-label", `Remove ${what}`);
  b.classList.add("x");
  return b;
}
function addButton(label, fn, full, limit, key) {
  const b = button(label, fn, { small: true, title: full ? `This page allows up to ${limit}.` : undefined });
  b.disabled = full;
  b.dataset.add = key;
  return b;
}
// Where keyboard focus goes after a row is removed: the name of the row that moved into the gap (or of the one
// before it), and the list's "Add" button once the list is empty. Never another "remove" button.
const after = (list, j, addKey) => (list.length ? `[data-focus="${list[Math.min(j, list.length - 1)].id}"]` : `[data-add="${addKey}"]`);
const added = (item) => item && `[data-focus="${item.id}"]`;

function renderEditor() {
  const m = state.model;
  const unitField = limit(textField({
    label: "Wellbeing is counted in", value: m.unit,
    hint: "Any one scale will do, as long as a point means the same for everybody.",
    onInput: (v) => { m.unit = v; refresh(); },
  }), 30);

  const groups = m.groups.map((g, i) => {
    const name = limit(textField({
      label: "Group", value: g.name,
      onInput: (v) => { g.name = v; for (const lab of editor.querySelectorAll(`[data-g="${g.id}"] label`)) lab.textContent = groupName(g); refresh(); },
    }), 40);
    name.input.dataset.focus = g.id;
    const people = numField("People", g.people, { min: 0, max: BIG }, (v) => { g.people = v; });
    const w = numField("Moral weight", g.weight, { min: 0, max: BIG }, (v) => { g.weight = v; });
    w.input.dataset.weight = g.id;
    // Each row is a named group for screen readers, so that "People" is announced as the people of "Group 2".
    return el("div", { class: "g-row", role: "group", "aria-label": `Group ${i + 1}` }, name.el, people.el, w.el, removeButton(`group ${i + 1}`, () => { removeGroup(m, g.id); structural(after(m.groups, i, "group")); }));
  });

  const options = m.options.map((o, i) => {
    const name = limit(textField({ label: `Option ${i + 1}`, value: o.name, onInput: (v) => { o.name = v; refresh(); } }), 40);
    name.input.dataset.focus = o.id;
    const outcomes = o.outcomes.map((k, j) => {
      const kname = limit(textField({ label: "Outcome", value: k.name, onInput: (v) => { k.name = v; } }), 60);
      kname.input.dataset.focus = k.id;
      const p = numField("Probability", k.p, { min: 0, max: 1 }, (v) => { k.p = v; });
      const changes = m.groups.map((g) => {
        const f = numField(groupName(g), k.dw[g.id], { min: -BIG, max: BIG }, (v) => { k.dw[g.id] = v; });
        f.el.dataset.g = g.id;
        return f.el;
      });
      return el("div", { class: "k-row", role: "group", "aria-label": `Outcome ${j + 1}` },
        el("div", { class: "k-head" }, kname.el, p.el, removeButton(`outcome ${j + 1} of option ${i + 1}`, () => { removeOutcome(m, o.id, k.id); structural(after(o.outcomes, j, o.id)); })),
        changes.length ? el("div", { class: "k-changes" }, changes) : null);
    });
    return el("div", { class: "panel opt", role: "group", "aria-label": `Option ${i + 1}`, style: { borderLeftColor: palette[i] } },
      el("div", { class: "o-head" }, name.el, removeButton(`option ${i + 1}`, () => { removeOption(m, o.id); structural(after(m.options, i, "option")); })),
      o.outcomes.length && m.groups.length ? el("p", { class: "hint", "data-unit-line": "" }) : null,
      outcomes,
      el("div", { class: "o-foot" },
        el("div", { "data-status": o.id }),
        addButton("Add an outcome", () => { structural(added(addOutcome(m, o.id)), true); }, o.outcomes.length >= LIMITS.outcomes, `${LIMITS.outcomes} outcomes for each option`, o.id)));
  });

  fill(editor,
    el("h3", { text: "Who is affected" }),
    unitField.el,
    el("div", { class: "g-list" }, groups),
    el("div", { class: "row" },
      addButton("Add a group", () => { structural(added(addGroup(m)), true); }, m.groups.length >= LIMITS.groups, `${LIMITS.groups} groups`, "group"),
      button("Set every weight to 1", () => { for (const g of m.groups) g.weight = 1; structural(); }, { small: true })),
    el("p", { class: "hint", text: "A moral weight of 2 means a point of this group's wellbeing counts twice as much as a point of a group weighted 1. A weight of 0 leaves the group out." }),
    el("h3", { text: "Options and their outcomes", style: { marginTop: "8px" } }),
    options,
    el("div", { class: "row" }, addButton("Add an option", () => { structural(added(addOption(m)), true); }, m.options.length >= LIMITS.options, `${LIMITS.options} options`, "option")));
}

// After anything that adds or removes a row: rebuild the editor, then put keyboard focus on `selector` (the new
// row's name, selected so that typing replaces it, or the neighbour of a removed row). With no selector, focus
// goes back to the control that stands where the one just used stood. Without this, rebuilding the editor would
// throw a keyboard user back to the top of the page.
function structural(selector, select = false) {
  const controls = () => [...editor.querySelectorAll("input, button:not(:disabled)")];
  const was = controls().indexOf(document.activeElement);
  renderEditor();
  refresh();
  const target = selector ? editor.querySelector(selector) : was >= 0 ? controls()[Math.min(was, controls().length - 1)] : null;
  if (!target) return;
  target.focus();
  if (select) target.select?.();
}

/* ------------------------------------------------------------------ outputs */
const verdict = el("p", { class: "verdict", role: "status" });
const problems = el("div", { class: "stack" });
const sTop = stat("Top score");
const sLead = stat("Lead over second");
const sFlip = stat("Nearest flip");
const sEqual = stat("With equal weights");
const rankBox = el("div");
const viewSeg = segmented({
  label: "Count the change", value: state.view,
  options: [{ value: "perPerson", label: "Per person" }, { value: "total", label: "Whole group" }, { value: "weighted", label: "Weighted" }],
  onChange: (v) => { state.view = v; refresh(); },
});
const gainsBox = el("div");
const flipNote = el("div");
const flipTable = el("div", { class: "flips" });
const pick = select({ label: "Weight to vary", options: [], onChange: (v) => { state.vary = v; refresh(); } });
const drag = slider({
  label: "Weight", min: 0, max: 2, step: "any", value: 1, format: now,
  onInput: (v) => {
    const g = state.model.groups.find((x) => x.id === state.vary);
    if (!g) return;
    g.weight = Number(v.toPrecision(3));
    const box = editor.querySelector(`[data-weight="${g.id}"]`);
    if (box) { box.value = g.weight; box.classList.remove("invalid"); }
    refresh({ keepRange: true });
  },
});
const lineBox = el("div");

// Everything that needs at least one scored option. Hidden, not left blank, while there is none.
const scored = el("div", { class: "out" },
  el("div", { class: "stats" }, sTop.el, sLead.el, sFlip.el, sEqual.el),
  rankBox,
  el("div", { class: "stack" }, el("h3", { text: "Who gains and who loses" }), viewSeg.el, gainsBox),
  el("div", { class: "stack" }, el("h3", { text: "Which weight would flip the choice" }), flipNote, flipTable),
  el("div", { class: "stack" }, el("div", { class: "grid2" }, pick.el, drag.el), lineBox));
const out = el("div", { class: "out" }, verdict, problems, scored);

$("#app").append(
  el("div", { class: "stack" }, el("div", { class: "row" }, el("span", { class: "small", style: { fontWeight: "600" }, text: "Start from an example" }), presetButtons), blurb),
  el("div", { class: "tool-grid wide-controls" }, editor, out));

const gains = chart(gainsBox, { series: [], height: 300, x: { type: "band", categories: [] } });
const lines = chart(lineBox, { series: [], height: 320 });

// Group names on the bar chart are cut to the width of their band so that none is dropped.
function fitNames(groups) {
  const band = Math.max(40, (gainsBox.clientWidth || 600) - 80) / Math.max(1, groups.length);
  const max = Math.max(3, Math.floor((band - 10) / 6.6));
  return (id) => { const n = groupName(groups.find((g) => g.id === id) || { name: "" }); return n.length > max ? `${n.slice(0, max - 1)}…` : n; };
}

function drawRanking(ev) {
  const lo = Math.min(0, ...ev.ranked.map((r) => r.eu));
  const hi = Math.max(0, ...ev.ranked.map((r) => r.eu));
  const span = hi - lo || 1;
  fill(rankBox,
    el("h3", { text: `Expected utility of each option, in weighted ${unit()}` }),
    el("ol", { class: "rank" }, ev.ranked.map((r, i) => el("li", { class: i === 0 ? "top" : null },
      el("span", { class: "name" }, el("i", { class: "sw", style: { background: palette[r.index] } }), `${i + 1}. ${optionName(r)}`),
      el("span", { class: "track" },
        el("i", { class: "fill", style: { left: `${((Math.min(r.eu, 0) - lo) / span) * 100}%`, width: `${(Math.abs(r.eu) / span) * 100}%`, background: palette[r.index] } }),
        lo < 0 ? el("i", { class: "zero", style: { left: `${(-lo / span) * 100}%` } }) : null),
      el("span", { class: "val", text: score(r.eu) })))));
}

function refresh({ keepRange = false } = {}) {
  const m = state.model;
  const ev = evaluate(m);
  const sens = sensitivity(m, ev);
  const u = unit();

  // Once anything has been changed the model is the visitor's own, and no example is marked as the one on show.
  const edited = JSON.stringify(state.model) !== state.pristine;
  for (const b of presetButtons) { const on = !edited && b.dataset.preset === state.preset; b.classList.toggle("primary", on); b.setAttribute("aria-pressed", on); }
  blurb.textContent = edited ? "Your own version: something has been changed since the example was loaded. Pick an example to start again from it."
    : (PRESETS.find((p) => p.key === state.preset)?.blurb || "A blank model with two groups and two options. Rename them and fill in your own numbers.")
    + (state.preset === "blank" ? "" : " Every number is invented for illustration: change any of them.")
    + " Nothing you enter is saved: reloading the page brings back the vaccine example.";
  for (const line of editor.querySelectorAll("[data-unit-line]")) line.textContent = `For each outcome: how likely it is, then the change in one person's wellbeing in each group (${u}).`;

  // Each option's own line: do its probabilities add up?
  for (const o of m.options) {
    const box = editor.querySelector(`[data-status="${o.id}"]`);
    if (!box) continue;
    const bad = ev.byOption[o.id];
    if (!bad) box.replaceChildren(el("span", { class: "small muted", text: "Probabilities sum to 1." }));
    else if (bad.canNormalise && bad.messages.length === 1) {
      box.replaceChildren(note("warn", `The probabilities sum to ${fmt.sig(bad.sum, 6)}, not 1, so this option is not ranked. `,
        button("Rescale them to sum to 1", () => { normalised(o).forEach((p, j) => { o.outcomes[j].p = p; }); structural(); }, { small: true })));
    } else box.replaceChildren(note("bad", `Not ranked: ${bad.messages.join("; ")}.`));
  }

  const unranked = m.options.filter((o) => ev.byOption[o.id]).map(optionName);
  fill(problems, ev.general.map((text) => note("bad", text)),
    !ev.general.length && unranked.length ? note("warn", `Left out of the ranking until fixed: ${unranked.join(", ")}. The note under each option says what is wrong.`) : null);
  scored.hidden = !ev.best;
  if (!ev.best) {
    verdict.textContent = ev.general.length ? "No ranking yet. Fix what is listed here." : "No ranking yet. Every option has a problem.";
    return;
  }
  drawRanking(ev);

  // Headline numbers.
  const best = ev.best, second = ev.runnerUp;
  verdict.textContent = !second ? `${optionName(best)} is the only option that can be scored: ${score(best.eu)} weighted ${u}.`
    : ev.tied.length > 2 ? `${ev.tied.length} options are tied on ${score(best.eu)} weighted ${u}: ${ev.tied.map(optionName).join(", ")}.`
    : ev.tie ? `${optionName(best)} and ${optionName(second)} are tied on ${score(best.eu)} weighted ${u}.`
    : `${optionName(best)} comes top with ${score(best.eu)} weighted ${u}, ${score(best.eu - second.eu)} ahead of ${optionName(second)}.`;
  sTop.set(score(best.eu), optionName(best));
  sLead.set(second ? score(best.eu - second.eu) : "–", second ? `over ${optionName(second)}` : "there is no second option");
  const eq = evaluate(withEqualWeights(m)).best;
  const allOne = m.groups.every((g) => g.weight === 1);
  sEqual.set(allOne ? "As now" : eq.id === best.id ? "Same" : "Differs",
    allOne ? "every group already counts equally" : `${optionName(eq)} wins when everyone counts equally`);

  // Bars: one cluster for each group, one bar for each option.
  const viewText = {
    perPerson: `Expected change for one person in each group, in ${u}.`,
    total: `Change per person multiplied by the number of people, in ${u}.`,
    weighted: `Whole-group change multiplied by the moral weight. An option's score is the sum of its bars.`,
  }[state.view];
  gains.update({
    subtitle: viewText,
    label: "Bar chart of each option's expected effect on each group",
    x: { type: "band", categories: m.groups.map((g) => g.id), format: fitNames(m.groups) },
    y: { format: signed, zero: true },
    series: ev.rows.map((r) => ({ name: short(optionName(r)), type: "bars", color: r.index, data: r.groups.map((g) => [g.id, g[state.view]]) })),
    legend: true,
  });

  // Sensitivity table and headline.
  const fragile = mostFragile(sens);
  const cell = (f, w0) => (f
    ? el("span", {}, el("strong", { text: f.at === w0 ? now(w0) : flipAt(f.at, w0) }), f.at === w0 ? " (level now)" : "", `, then ${optionName(f)}`)
    : el("span", { class: "muted", text: "never" }));
  if (!fragile) {
    fill(flipNote, note(ev.tie ? "" : "good", !second ? "With one option scored there is nothing for a weight to flip."
      : ev.tie ? "The top options are tied, and no single weight separates them."
      : `No single weight flips it. ${optionName(best)} stays on top whatever value any one group's weight takes, from zero upwards.`));
    sFlip.set("None", "no single weight changes the choice");
  } else {
    const up = fragile.above && (!fragile.below || fragile.above.at / fragile.weight <= fragile.weight / fragile.below.at);
    const f = up ? fragile.above : fragile.below;
    const ratio = f.at / fragile.weight;
    const share = Math.abs(ratio - 1);
    const change = !(fragile.weight > 0) ? ""
      : ratio > 3 ? ` (multiplying it by ${weight(ratio)})`
      : ratio < 1 / 3 ? ` (dividing it by ${weight(1 / ratio)})`
      : ` (${share < 0.005 ? "under 1%" : fmt.pct(share, 0)} ${up ? "more" : "less"})`;
    const level = f.at === fragile.weight;
    fill(flipNote, note("", "The choice is most sensitive to the weight on ", el("strong", { text: groupName(fragile) }),
      level ? `: at ${now(f.at)} it is level with ${optionName(f)}, and any ${up ? "higher" : "lower"} weight puts ${optionName(f)} in front.`
        : `: ${up ? "raise" : "lower"} it from ${now(fragile.weight)} to ${flipAt(f.at, fragile.weight)}${change} and ${optionName(f)} takes over.`));
    sFlip.set(level ? now(f.at) : flipAt(f.at, fragile.weight), `weight on ${groupName(fragile)}, now ${now(fragile.weight)}`);
  }
  fill(flipTable, table({
    columns: [
      { key: "name", label: "Weight on" },
      { key: "below", label: "Flips if lowered to" },
      { key: "above", label: "Flips if raised to" },
    ],
    rows: sens.map((s) => ({
      name: el("span", {}, groupName(s), el("span", { class: "muted small", text: ` (now ${now(s.weight)})` })),
      below: cell(s.below, s.weight), above: cell(s.above, s.weight),
    })),
  }));

  // One weight varied, everything else held where it is.
  if (!sens.some((s) => s.id === state.vary)) state.vary = (fragile || sens[0]).id;
  fill(pick.input, sens.map((s) => el("option", { value: s.id, text: groupName(s) })));
  pick.value = state.vary;
  const row = sens.find((s) => s.id === state.vary);
  if (!keepRange) state.range = Math.max(2, 2 * row.weight, row.above ? row.above.at * 1.25 : 0);
  const hi = state.range;
  drag.input.max = hi;
  drag.value = row.weight;
  drag.el.querySelector("label").textContent = `Weight on ${groupName(row)}`;
  // Text inside the chart cannot wrap, so the axis label carries only as much of the name as the chart is wide.
  const room = Math.max(10, Math.floor(((lineBox.clientWidth || 600) - 60) / 8) - 16);
  // The y-axis is set by hand so that there is clear space above the lines for the labels of the vertical marks.
  const ends = row.lines.flatMap((l) => [l.intercept, l.intercept + l.slope * hi]);
  const yLo = Math.min(...ends), yHi = Math.max(...ends);
  const yPad = (yHi - yLo || Math.abs(yHi) || 1) * 0.05;
  const top = yHi + yPad * 6;
  const label = (x, text, side, rowNo) => ({ type: "text", x, y: top, text, anchor: side, dx: side === "end" ? -5 : 5, dy: 13 + 16 * rowNo });
  const marks = [{ type: "vline", x: row.weight }, label(row.weight, `now ${now(row.weight)}`, row.weight > 0.7 * hi ? "end" : "start", 0)];
  const lead = row.lines.find((l) => l.id === row.leader);
  const shown = (f) => f && f.at <= hi && f.at !== row.weight;
  const lowSide = shown(row.below) && row.below.at > 0.25 * hi ? "end" : "start";
  const highSide = shown(row.above) && row.above.at < 0.7 * hi ? "start" : "end";
  [[row.below, lowSide, 1], [row.above, highSide, lowSide === "end" && highSide === "start" ? 1 : 2]].forEach(([f, side, rowNo]) => {
    if (!shown(f)) return;
    marks.push({ type: "vline", x: f.at }, label(f.at, `flips at ${flipAt(f.at, row.weight)}`, side, rowNo));
    marks.push({ type: "point", x: f.at, y: lead.intercept + lead.slope * f.at, r: 4.5 });
  });
  lines.update({
    title: `Each option's score as the weight on ${groupName(row)} changes`,
    subtitle: `Scores are in weighted ${u}. Every other number is held where it is. The highest line at any weight is the choice at that weight.`,
    label: `Line chart of each option's expected utility against the moral weight on ${groupName(row)}`,
    x: { label: `Moral weight on ${short(groupName(row), room)}`, domain: [0, hi], format: weight },
    y: { label: "Expected utility", format: score, domain: [yLo - yPad, top] },
    series: row.lines.map((l) => ({ name: short(optionName(l)), type: "line", color: l.index, data: Array.from({ length: 41 }, (_, i) => [(hi * i) / 40, l.intercept + (l.slope * hi * i) / 40]) })),
    marks,
    legend: true,
  });
}

renderEditor();
refresh();
