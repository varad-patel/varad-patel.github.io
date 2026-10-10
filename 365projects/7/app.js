// Day 7: Utilitarian Calculator. Interface.
import { $, el, fmt, mount, numberField, textField, select, slider, segmented, button, stat, note, table, chart, palette } from "../kit/kit.js";
import { LIMITS, PRESETS, blankModel, addGroup, removeGroup, addOption, removeOption, addOutcome, removeOutcome, normalised, evaluate, withEqualWeights, sensitivity, mostFragile } from "./logic.js";

mount();

const state = { model: PRESETS[0].model(), preset: PRESETS[0].key, vary: "", view: "weighted", range: 2 };

const score = (x) => (Math.abs(x) >= 1e6 ? fmt.compact(x) : Math.abs(x) >= 1000 ? fmt.int(x) : fmt.sig(x, 3));
const signed = (x) => (x > 0 ? "+" : "") + score(x);
const weight = (w) => fmt.sig(w, 3);
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
function removeButton(what, fn) {
  const b = button("×", fn, { small: true, title: `Remove ${what}` });
  b.setAttribute("aria-label", `Remove ${what}`);
  b.classList.add("x");
  return b;
}
function addButton(label, fn, full, limit) {
  const b = button(label, fn, { small: true, title: full ? `This page allows up to ${limit}.` : undefined });
  b.disabled = full;
  return b;
}

function renderEditor() {
  const m = state.model;
  const unitField = textField({
    label: "Wellbeing is counted in", value: m.unit,
    hint: "Any one scale will do, as long as a point means the same for everybody.",
    onInput: (v) => { m.unit = v; refresh(); },
  });

  const groups = m.groups.map((g, i) => {
    const name = textField({
      label: "Group", value: g.name,
      onInput: (v) => { g.name = v; for (const lab of editor.querySelectorAll(`[data-g="${g.id}"] label`)) lab.textContent = groupName(g); refresh(); },
    });
    name.input.dataset.focus = g.id;
    const people = numField("People", g.people, { min: 0 }, (v) => { g.people = v; });
    const w = numField("Moral weight", g.weight, { min: 0 }, (v) => { g.weight = v; });
    w.input.dataset.weight = g.id;
    return el("div", { class: "g-row" }, name.el, people.el, w.el, removeButton(`group ${i + 1}`, () => { removeGroup(m, g.id); structural(); }));
  });

  const options = m.options.map((o, i) => {
    const name = textField({ label: `Option ${i + 1}`, value: o.name, onInput: (v) => { o.name = v; refresh(); } });
    name.input.dataset.focus = o.id;
    const outcomes = o.outcomes.map((k, j) => {
      const kname = textField({ label: "Outcome", value: k.name, onInput: (v) => { k.name = v; } });
      kname.input.dataset.focus = k.id;
      const p = numField("Probability", k.p, { min: 0, max: 1 }, (v) => { k.p = v; });
      const changes = m.groups.map((g) => {
        const f = numField(groupName(g), k.dw[g.id], { negative: true }, (v) => { k.dw[g.id] = v; });
        f.el.dataset.g = g.id;
        return f.el;
      });
      return el("div", { class: "k-row" },
        el("div", { class: "k-head" }, kname.el, p.el, removeButton(`outcome ${j + 1} of option ${i + 1}`, () => { removeOutcome(m, o.id, k.id); structural(); })),
        changes.length ? el("div", { class: "k-changes" }, changes) : null);
    });
    return el("div", { class: "panel opt", style: { borderLeftColor: palette[i] } },
      el("div", { class: "o-head" }, name.el, removeButton(`option ${i + 1}`, () => { removeOption(m, o.id); structural(); })),
      o.outcomes.length && m.groups.length ? el("p", { class: "hint", "data-unit-line": "" }) : null,
      outcomes,
      el("div", { class: "o-foot" },
        el("div", { "data-status": o.id }),
        addButton("Add an outcome", () => { const k = addOutcome(m, o.id); structural(k?.id); }, o.outcomes.length >= LIMITS.outcomes, `${LIMITS.outcomes} outcomes for each option`)));
  });

  fill(editor,
    el("h3", { text: "Who is affected" }),
    unitField.el,
    el("div", { class: "g-list" }, groups),
    el("div", { class: "row" },
      addButton("Add a group", () => { const g = addGroup(m); structural(g?.id); }, m.groups.length >= LIMITS.groups, `${LIMITS.groups} groups`),
      button("Set every weight to 1", () => { for (const g of m.groups) g.weight = 1; structural(); }, { small: true })),
    el("p", { class: "hint", text: "A moral weight of 2 means a point of this group's wellbeing counts twice as much as a point of a group weighted 1. A weight of 0 leaves the group out." }),
    el("h3", { text: "Options and their outcomes", style: { marginTop: "8px" } }),
    options,
    el("div", { class: "row" }, addButton("Add an option", () => { const o = addOption(m); structural(o?.id); }, m.options.length >= LIMITS.options, `${LIMITS.options} options`)));
}

// After anything that adds or removes a row: rebuild the editor, then put the cursor in the new row.
function structural(focusId) {
  renderEditor();
  refresh();
  const target = focusId && editor.querySelector(`[data-focus="${focusId}"]`);
  if (target) { target.focus(); target.select(); }
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
  label: "Weight", min: 0, max: 2, step: "any", value: 1, format: weight,
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

  for (const b of presetButtons) { const on = b.dataset.preset === state.preset; b.classList.toggle("primary", on); b.setAttribute("aria-pressed", on); }
  blurb.textContent = (PRESETS.find((p) => p.key === state.preset)?.blurb || "A blank model with two groups and two options. Rename them and fill in your own numbers.")
    + (state.preset === "blank" ? "" : " Every number is invented for illustration: change any of them.");
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
    series: ev.rows.map((r) => ({ name: optionName(r), type: "bars", color: r.index, data: r.groups.map((g) => [g.id, g[state.view]]) })),
    legend: true,
  });

  // Sensitivity table and headline.
  const fragile = mostFragile(sens);
  const cell = (f, w0) => (f
    ? el("span", {}, el("strong", { text: weight(f.at) }), f.at === w0 ? " (level now)" : "", `, then ${optionName(f)}`)
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
    const change = !(fragile.weight > 0) ? ""
      : ratio > 3 ? ` (${fmt.sig(ratio, 3)} times as much)`
      : ratio < 1 / 3 ? ` (one part in ${fmt.sig(1 / ratio, 3)} of what it is)`
      : ` (${fmt.pct(Math.abs(ratio - 1), 0)} ${up ? "more" : "less"})`;
    fill(flipNote, note("", "The choice is most sensitive to the weight on ", el("strong", { text: groupName(fragile) }),
      f.at === fragile.weight ? `: at ${weight(f.at)} it is level with ${optionName(f)}, and any ${up ? "higher" : "lower"} weight puts ${optionName(f)} in front.`
        : `: ${up ? "raise" : "lower"} it from ${weight(fragile.weight)} to ${weight(f.at)}${change} and ${optionName(f)} takes over.`));
    sFlip.set(weight(f.at), `weight on ${groupName(fragile)}, now ${weight(fragile.weight)}`);
  }
  fill(flipTable, table({
    columns: [
      { key: "name", label: "Weight on" },
      { key: "below", label: "Flips if lowered to" },
      { key: "above", label: "Flips if raised to" },
    ],
    rows: sens.map((s) => ({
      name: el("span", {}, groupName(s), el("span", { class: "muted small", text: ` (now ${weight(s.weight)})` })),
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
  // The y-axis is set by hand so that there is clear space above the lines for the labels of the vertical marks.
  const ends = row.lines.flatMap((l) => [l.intercept, l.intercept + l.slope * hi]);
  const yLo = Math.min(...ends), yHi = Math.max(...ends);
  const yPad = (yHi - yLo || Math.abs(yHi) || 1) * 0.05;
  const top = yHi + yPad * 6;
  const label = (x, text, side, rowNo) => ({ type: "text", x, y: top, text, anchor: side, dx: side === "end" ? -5 : 5, dy: 13 + 16 * rowNo });
  const marks = [{ type: "vline", x: row.weight }, label(row.weight, `now ${weight(row.weight)}`, row.weight > 0.7 * hi ? "end" : "start", 0)];
  const lead = row.lines.find((l) => l.id === row.leader);
  const shown = (f) => f && f.at <= hi && f.at !== row.weight;
  const lowSide = shown(row.below) && row.below.at > 0.25 * hi ? "end" : "start";
  const highSide = shown(row.above) && row.above.at < 0.7 * hi ? "start" : "end";
  [[row.below, lowSide, 1], [row.above, highSide, lowSide === "end" && highSide === "start" ? 1 : 2]].forEach(([f, side, rowNo]) => {
    if (!shown(f)) return;
    marks.push({ type: "vline", x: f.at }, label(f.at, `flips at ${weight(f.at)}`, side, rowNo));
    marks.push({ type: "point", x: f.at, y: lead.intercept + lead.slope * f.at, r: 4.5 });
  });
  lines.update({
    title: `Each option's score as the weight on ${groupName(row)} changes`,
    subtitle: "Every other number is held where it is. The highest line at any weight is the choice at that weight.",
    label: `Line chart of each option's expected utility against the moral weight on ${groupName(row)}`,
    x: { label: `Moral weight on ${groupName(row)}`, domain: [0, hi], format: weight },
    y: { label: `Expected utility (weighted ${u})`, format: score, domain: [yLo - yPad, top] },
    series: row.lines.map((l) => ({ name: optionName(l), type: "line", color: l.index, data: Array.from({ length: 41 }, (_, i) => [(hi * i) / 40, l.intercept + (l.slope * hi * i) / 40]) })),
    marks,
    legend: true,
  });
}

renderEditor();
refresh();
