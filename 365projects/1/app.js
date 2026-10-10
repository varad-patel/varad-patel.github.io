// Day 1: Can Money Buy Happiness? Interface.
import { $, el, fmt, mount, slider, select, checkbox, segmented, button, stat, note, table, chart, stats, palette } from "../kit/kit.js";
import { WELLBEING } from "../data/wellbeing.js";
import { CONTROLS, rowsFor, availableControls, fit, outliers } from "./logic.js";

mount();

const years = WELLBEING.years;
const regions = [...new Set(WELLBEING.countries.map((c) => c.region))].sort();
const shortRegion = (r) => r.replace("Middle East, North Africa, Afghanistan & Pakistan", "Middle East, N. Africa, Afghanistan & Pakistan");
const money = (v) => (v >= 1000 ? `$${fmt.sig(v / 1000, 3)}k` : `$${fmt.int(v)}`);

const state = { year: years.at(-1), region: "", controls: new Set(), view: "raw", selected: "", excluded: new Set() };

/* ---------- controls ---------- */
const yearSlider = slider({
  label: "Survey years", min: 0, max: years.length - 1, step: 1, value: years.length - 1,
  format: (i) => `${years[i] - 2} to ${years[i]}`,
  hint: "Each point is a three-year average, as published by the World Happiness Report.",
  onInput: (i) => { state.year = years[i]; update(); },
});
const regionSelect = select({
  label: "Countries", value: "",
  options: [{ value: "", label: "All countries" }, ...regions.map((r) => ({ value: r, label: shortRegion(r) }))],
  onChange: (v) => { state.region = v; update(); },
});
const boxes = CONTROLS.map((c) => ({ def: c, box: checkbox({ label: c.label, onChange: (on) => { on ? state.controls.add(c.key) : state.controls.delete(c.key); update(); } }) }));
const controlHint = el("div", { class: "hint" });
const viewSeg = segmented({
  label: "Chart", value: "raw",
  options: [{ value: "raw", label: "Income alone" }, { value: "partial", label: "Controls held fixed" }],
  onChange: (v) => { state.view = v; update(); },
});
const pick = select({ label: "Find a country", options: [{ value: "", label: "None" }], value: "", onChange: (v) => { state.selected = v; update(); } });
const excludedBox = el("div", { class: "field" });

const controls = el("div", { class: "controls" },
  yearSlider.el, regionSelect.el,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Hold these fixed" })), boxes.map((b) => b.box.el), controlHint),
  viewSeg.el, pick.el, excludedBox);

/* ---------- outputs ---------- */
const sN = stat("Countries in the fit");
const sAlone = stat("A doubling of income goes with");
const sWith = stat("With the controls held fixed");
const sR2 = stat("Variation explained");
const message = el("div");
const splitBox = el("div", { class: "split" });
const chartBox = el("div");
const card = el("div");
const tableBox = el("div");
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sN.el, sAlone.el, sWith.el, sR2.el), message, splitBox, chartBox, card, tableBox);

$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const plot = chart(chartBox, { series: [], height: 380 });

/* ---------- rendering ---------- */
function drawSplit(split) {
  const parts = [
    { key: "income", label: "Only income", color: palette[0] },
    { key: "shared", label: "Income and controls together", color: "#8a94a3" },
    { key: "controls", label: "Only the controls", color: palette[1] },
    { key: "unexplained", label: "Unexplained", color: "#dfe5e1" },
  ].map((p) => ({ ...p, value: Math.max(0, split[p.key]) }));
  const total = stats.sum(parts.map((p) => p.value)) || 1;
  splitBox.replaceChildren(
    el("p", { class: "chart-title", text: "Where the variation in life evaluation goes" }),
    el("div", { class: "split-bar", role: "img", "aria-label": parts.map((p) => `${p.label}: ${fmt.pct(p.value, 1)}`).join(", ") },
      parts.filter((p) => p.value > 0).map((p) => el("span", { style: { width: `${(p.value / total) * 100}%`, background: p.color }, title: `${p.label}: ${fmt.pct(p.value, 1)}` }))),
    el("div", { class: "chart-legend" }, parts.map((p) => el("span", {}, el("i", { style: { background: p.color } }), `${p.label} `, el("strong", { text: fmt.pct(split[p.key], 1) })))));
}

function update() {
  const all = rowsFor(WELLBEING, state.year);
  const inRegion = all.filter((r) => !state.region || r.region === state.region);
  const rows = inRegion.filter((r) => !state.excluded.has(r.name));

  // Controls that do not exist for this year are switched off.
  const available = availableControls(all, 30);
  for (const { def, box } of boxes) {
    const ok = available.includes(def.key);
    box.input.disabled = !ok;
    box.el.title = def.detail;
    box.el.style.opacity = ok ? "" : "0.5";
    if (!ok && state.controls.has(def.key)) { state.controls.delete(def.key); box.checked = false; }
  }
  controlHint.textContent = available.length < CONTROLS.length
    ? "The report publishes its factor values from the 2017 to 2019 average onwards, so only health is available here."
    : "Tick a measure to compare countries that are alike on it.";

  // Country picker follows the current sample.
  const names = inRegion.map((r) => r.name).sort((a, b) => a.localeCompare(b));
  if (state.selected && !names.includes(state.selected)) state.selected = "";
  pick.input.replaceChildren(el("option", { value: "", text: "None" }), ...names.map((n) => el("option", { value: n, text: n })));
  pick.value = state.selected;

  excludedBox.replaceChildren(...(state.excluded.size
    ? [el("div", { class: "lab" }, el("span", { text: `Left out of the fit (${state.excluded.size})` })),
       el("div", { class: "hint", text: [...state.excluded].sort().join(", ") }),
       button("Put them back", () => { state.excluded.clear(); update(); }, { small: true })]
    : []));

  const keys = [...state.controls];
  const f = fit(rows, keys);
  if (f.error) {
    message.replaceChildren(note("warn", f.error));
    sN.set(fmt.int(f.n), "");
    for (const s of [sAlone, sWith, sR2]) s.set("–", "");
    splitBox.replaceChildren();
    tableBox.replaceChildren();
    card.replaceChildren();
    plot.update({ series: [], marks: [], empty: "Not enough countries to fit a line" });
    return;
  }
  message.replaceChildren();

  const dropped = rows.length - f.n;
  sN.set(fmt.int(f.n), dropped ? `${dropped} lack one of the chosen measures` : state.region ? shortRegion(state.region) : "every country with data");
  sAlone.set(`${fmt.signed(f.alone.perDoubling, 2)} points`, `on the 0 to 10 ladder, ± ${fmt.num(1.96 * f.alone.se, 2)}`);
  if (keys.length) {
    const kept = f.withControls.perDoubling / f.alone.perDoubling;
    sWith.set(`${fmt.signed(f.withControls.perDoubling, 2)} points`, `± ${fmt.num(1.96 * f.withControls.se, 2)}; ${fmt.pct(kept, 0)} of the raw link`);
    sR2.set(fmt.pct(f.withControls.r2, 0), `income alone: ${fmt.pct(f.alone.r2, 0)}`);
  } else {
    sWith.set("–", "tick a control to see");
    sR2.set(fmt.pct(f.alone.r2, 0), "by income alone");
  }
  drawSplit(f.split);

  const residualOf = new Map(f.residuals.map((r) => [r.name, r]));
  const out3 = outliers(f, 3);
  const flagged = [...out3.above, ...out3.below].map((r) => r.name);
  const partial = state.view === "partial";
  const pointOf = partial
    ? new Map(f.partial.map((p) => [p.name, { x: p.ex, y: p.ey }]))
    : new Map(f.sample.map((r) => [r.name, { x: r.gdp, y: r.ladder }]));
  const pts = f.sample.map((r) => ({ ...pointOf.get(r.name), label: r.name }));

  let line;
  if (partial) {
    const xs = f.partial.map((p) => p.ex);
    const lo = stats.min(xs), hi = stats.max(xs);
    line = [[lo, lo * f.withControls.perDoubling], [hi, hi * f.withControls.perDoubling]];
  } else {
    const xs = f.sample.map((r) => r.gdp);
    const lo = stats.min(xs), hi = stats.max(xs);
    line = Array.from({ length: 30 }, (_, i) => {
      const g = lo * (hi / lo) ** (i / 29);
      return [g, f.alone.intercept + f.alone.perDoubling * Math.log2(g)];
    });
  }

  const marks = flagged.filter((n) => n !== state.selected).map((n) => ({ type: "text", ...pointOf.get(n), text: n, dx: 7, dy: 4 }));
  if (state.selected && pointOf.has(state.selected)) marks.push({ type: "point", ...pointOf.get(state.selected), text: state.selected });

  plot.update({
    title: partial ? "Income and life evaluation, after removing what the controls explain" : "Income and life evaluation",
    subtitle: partial
      ? (keys.length ? "Each axis shows how far a country is from what its controls predict. The slope is income's own contribution." : "No controls are ticked, so this is the raw relationship centred on the average country.")
      : "Each dot is a country. Click one to inspect it. The six furthest from the fitted model are named.",
    label: "Scatter plot of life evaluation against income per person",
    hover: "point",
    x: partial
      ? { label: "Income, in doublings above or below expected", format: (v) => fmt.signed(v, 1) }
      : { label: "GDP per person (PPP, 2021 international $, log scale)", type: "log", format: money },
    y: partial
      ? { label: "Life evaluation above or below expected", format: (v) => fmt.signed(v, 1) }
      : { label: "Life evaluation (0 to 10)", format: (v) => fmt.num(v, 1) },
    series: [
      { name: "Fitted line", type: "line", data: line, color: "#16233b", width: 2, hover: false },
      { name: "Countries", type: "scatter", data: pts, color: 0, r: 4.5 },
    ],
    legend: false,
    marks,
    onClick: ({ point }) => { if (point) { state.selected = state.selected === point.label ? "" : point.label; update(); } },
  });

  // Selected country.
  const sel = f.sample.find((r) => r.name === state.selected);
  if (sel) {
    const res = residualOf.get(sel.name);
    const rank = [...f.residuals].sort((a, b) => b.residual - a.residual).findIndex((r) => r.name === sel.name) + 1;
    card.replaceChildren(el("div", { class: "panel" },
      el("div", { class: "row", style: { justifyContent: "space-between" } },
        el("h3", { text: `${sel.name}, ${state.year - 2} to ${state.year}` }),
        button("Leave out of the fit", () => { state.excluded.add(sel.name); state.selected = ""; update(); }, { small: true })),
      el("p", { class: "small", style: { marginTop: "8px" } },
        `Life evaluation ${fmt.num(sel.ladder, 2)}, income ${money(sel.gdp)} per person. The ${keys.length ? "model with controls" : "income-only line"} predicts ${fmt.num(res.predicted, 2)}, so ${sel.name} sits ${fmt.num(Math.abs(res.residual), 2)} points ${res.residual >= 0 ? "above" : "below"} it: number ${rank} of ${f.n} when countries are ordered from most above to most below.`)));
  } else if (state.selected) {
    card.replaceChildren(note("", `${state.selected} lacks one of the chosen measures for these years, so it is not in the fit.`));
  } else card.replaceChildren();

  tableBox.replaceChildren(table({
    caption: keys.length ? "The model with controls" : "The income-only model",
    columns: [
      { key: "label", label: "Measure" },
      { key: "perSd", label: "Effect of a typical gap (1 SD)", num: true, format: (v) => `${fmt.signed(v, 2)} points` },
      { key: "ci", label: "95% interval", num: true },
      { key: "plain", label: "In plain units" },
    ],
    rows: f.coefficients.map((c) => ({
      label: c.label,
      perSd: c.perSd,
      ci: `${fmt.signed(c.perSd - 1.96 * c.sePerSd, 2)} to ${fmt.signed(c.perSd + 1.96 * c.sePerSd, 2)}`,
      plain: c.unit ? `${fmt.signed(c.beta, c.key === "health" ? 3 : 2)} ${c.unit}` : "published only as a contribution, so shown per SD",
    })),
  }));
}

update();
