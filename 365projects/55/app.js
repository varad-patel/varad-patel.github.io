// Day 55: Unemployment and Okun's Law Explorer. Interface.
import { $, $$, el, fmt, mount, slider, select, segmented, checkbox, textField, button, stat, note, chart, debounce } from "../kit/kit.js";
import { MACRO } from "../data/macro.js";
import { SERIES, MIN_YEARS, LAMBDAS, analyse, furthest, describe, missWords, span, inSentence, s2, unboundedCell } from "./logic.js";

mount();

const FIRST = MACRO.first + 1, LAST = MACRO.last;
const GAP = MIN_YEARS - 1; // the two year sliders are kept at least this far apart
const GROUPS = [
  { label: "G7", ids: ["CAN", "FRA", "DEU", "ITA", "JPN", "GBR", "USA"] },
  { label: "Nordic countries", ids: ["DNK", "FIN", "ISL", "NOR", "SWE"] },
  { label: "Southern Europe", ids: ["GRC", "ITA", "PRT", "ESP"] },
  { label: "English-speaking", ids: ["AUS", "CAN", "IRL", "NZL", "GBR", "USA"] },
];
const DEFAULTS = { series: "oecd", version: "change", lambda: 100, from: FIRST, to: LAST, skip: false, focus: "USA", find: "" };
const sorted = [...MACRO.countries].sort((a, b) => a.name.localeCompare(b.name, "en"));
const state = { ...DEFAULTS, picked: new Set(GROUPS[0].ids) };
const n1 = (x) => fmt.num(x, 1);
const available = () => sorted.filter((c) => c[SERIES[state.series].key]);

/* ---------- controls ---------- */
const seriesSeg = segmented({
  label: "Unemployment figures", value: state.series,
  options: [{ value: "oecd", label: "OECD long series" }, { value: "ilo", label: "ILO modelled" }],
  onChange: (v) => { state.series = v; drawList(); update(); },
});
const seriesHint = el("div", { class: "hint" });
seriesSeg.el.append(seriesHint);
const versionSeg = segmented({
  label: "Okun's law as", value: state.version,
  options: [{ value: "change", label: "Changes" }, { value: "gap", label: "Gaps from trend" }],
  onChange: (v) => { state.version = v; update(); },
});
const versionHint = el("div", { class: "hint" });
versionSeg.el.append(versionHint);
const lambdaSeg = segmented({
  label: "Smoothness of the trend", value: state.lambda, options: LAMBDAS.map((l) => ({ value: l, label: fmt.auto(l) })),
  hint: "The Hodrick-Prescott smoothing number. A larger one gives a straighter trend and so larger gaps. 100 is the usual choice for yearly data.",
  onChange: (v) => { state.lambda = Number(v); update(); },
});
const years = (v) => String(v);
const fromSlider = slider({ label: "From", min: FIRST, max: LAST - GAP, step: 1, value: state.from, format: years, onInput: (v) => { state.from = v; if (state.to < v + GAP) { state.to = v + GAP; toSlider.value = state.to; } later(); } });
const toSlider = slider({
  label: "To", min: FIRST + GAP, max: LAST, step: 1, value: state.to, format: years,
  onInput: (v) => { state.to = v; if (state.from > v - GAP) { state.from = v - GAP; fromSlider.value = state.from; } later(); },
});
const yearsHint = el("div", { class: "hint" });
const skipBox = checkbox({ label: "Leave out 2020 and 2021", onChange: (on) => { state.skip = on; update(); } });

const findField = textField({ label: "Find a country in the list", value: "", placeholder: "for example Spain" });
findField.input.maxLength = 40;
findField.input.addEventListener("input", () => { state.find = findField.input.value; drawList(); });
const listBox = el("div", { class: "d55-list", role: "group", "aria-label": "Countries in the fit" });
const listHint = el("div", { class: "hint" });
const pickedCount = el("span", { class: "muted" });
/** The list is one stop for the Tab key: the arrow keys move through it and Space ticks. */
function drawList() {
  const term = state.find.trim().toLowerCase();
  const shown = available().filter((c) => !term || c.name.toLowerCase().includes(term));
  listBox.replaceChildren(...shown.map((c, i) => {
    const box = checkbox({ label: c.name, checked: state.picked.has(c.iso3), onChange: (on) => { on ? state.picked.add(c.iso3) : state.picked.delete(c.iso3); later(); } });
    box.input.tabIndex = i ? -1 : 0;
    return box.el;
  }));
  if (!shown.length) listBox.append(el("p", { class: "small muted", text: `No country with this series has "${state.find.trim().slice(0, 40)}" in its name.` }));
  listHint.textContent = `${shown.length === available().length ? `${shown.length} countries have this series` : `${shown.length} of ${available().length} shown`}. Arrow keys move through the list and Space ticks.`;
}
listBox.addEventListener("keydown", (e) => {
  const boxes = $$("input", listBox), at = boxes.indexOf(document.activeElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: boxes.length - 1 }[e.key];
  if (at < 0 || to == null || !boxes[to]) return;
  e.preventDefault();
  boxes.forEach((b, i) => { b.tabIndex = i === to ? 0 : -1; });
  boxes[to].focus();
});
function pick(ids) { state.picked = new Set(ids); drawList(); update(); }
function reset() {
  Object.assign(state, DEFAULTS, { picked: new Set(GROUPS[0].ids) });
  seriesSeg.value = state.series; versionSeg.value = state.version; lambdaSeg.value = state.lambda;
  fromSlider.value = state.from; toSlider.value = state.to; skipBox.checked = false; findField.value = "";
  drawList(); update();
}
const controls = el("div", { class: "controls" },
  seriesSeg.el, versionSeg.el, lambdaSeg.el,
  el("div", { class: "field", role: "group", "aria-label": "Years in the fit" }, el("div", { class: "lab" }, el("span", { text: "Years" })), fromSlider.el, toSlider.el, yearsHint, skipBox.el),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Countries" }), pickedCount),
    el("div", { class: "row", role: "group", "aria-label": "Groups of countries" },
      GROUPS.map((g) => button(g.label, () => pick(g.ids), { small: true })),
      button("All", () => pick(available().map((c) => c.iso3)), { small: true, title: "Tick every country that has the chosen series" }),
      button("None", () => pick([]), { small: true, title: "Untick every country" })),
    findField.el, listBox, listHint),
  el("div", { class: "row" }, button("Reset", reset, { small: true })));

/* ---------- outputs ---------- */
const message = el("div", { id: "d55-result" });
const status = el("p", { class: "sr-only", role: "status" });
const tiles = { b: stat("Okun coefficient"), steady: stat("Growth that holds unemployment steady"), r2: stat("Variation explained"), n: stat("In the fit") };
const scatterBox = el("div", { id: "d55-scatter" });
const missBox = el("div");
const focusSel = select({ label: "Look at one country", options: [{ value: "", label: "None" }], value: "", onChange: (v) => { state.focus = v; update(); } });
const focusWords = el("p", { class: "small d55-words" });
const timeBox = el("div");
const focusBox = el("div", { class: "panel d55-focus", id: "d55-country" }, focusSel.el, focusWords, timeBox);
const countryBox = el("div", { id: "d55-countries" }), periodBox = el("div", { id: "d55-periods" });
const results = el("div", { class: "out" }, el("div", { class: "stats" }, Object.values(tiles).map((t) => t.el)), scatterBox, missBox, focusBox, countryBox, periodBox);
$("#app").append(
  el("nav", { class: "jump", "aria-label": "Parts of this tool" }, el("a", { href: "#d55-result", text: "Result" }), el("a", { href: "#d55-country", text: "One country over time" }), el("a", { href: "#d55-countries", text: "Country by country" }), el("a", { href: "#d55-periods", text: "Period by period" })),
  el("div", { class: "tool-grid wide-controls" }, controls, el("div", { class: "out" }, message, status, results)));
const scatter = chart(scatterBox, { series: [], height: 380 });
const timeline = chart(timeBox, { series: [], height: 300 });
const announce = debounce((text) => { status.textContent = text; }, 700);
const later = debounce(() => update(), 120);

/* ---------- tables ---------- */
/** A dot and a line for an estimate and its interval, on a scale shared by every row of the table. */
function whisker(fit, [lo, hi]) {
  const pos = (v) => `${(((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100).toFixed(1)}%`;
  return el("div", { class: "d55-whisk", "aria-hidden": "true" },
    // The scale always takes in zero (see scaleOf), so the tick is always drawn, at an end when every interval is on one side.
    el("i", { class: "zero", style: { left: pos(0) } }),
    el("i", { class: "span", style: { left: pos(fit.lo), width: `${(((fit.hi - fit.lo) / (hi - lo)) * 100).toFixed(1)}%` } }),
    el("i", { class: "dot", style: { left: pos(fit.b) } }));
}
const scaleOf = (fits) => { const lo = Math.min(0, ...fits.map((f) => f.lo)), hi = Math.max(0, ...fits.map((f) => f.hi)); return hi > lo ? [lo, hi] : [lo - 1, hi + 1]; };
const steadyCell = (f) => (!(f.b < 0) ? "none: the line does not slope down" : f.steady.bounded ? `${n1(f.steady.value)}% (${n1(f.steady.lo)}% to ${n1(f.steady.hi)}%)` : unboundedCell(f.steady));

function fitTable({ caption, firstLabel, rows, change, extra = [] }) {
  const scale = scaleOf(rows.filter((r) => r.fit).map((r) => r.fit));
  const cols = [firstLabel, ...extra.map((x) => x.label), "Okun coefficient", "95% interval", "Interval drawn, with a tick at zero", "Variation explained", ...(change ? ["Growth that holds unemployment steady (95% interval)"] : [])];
  const td = (i, kids, cls = "num") => el("td", { "data-label": cols[i], class: cls }, kids);
  return el("table", { class: "tbl d55-tbl" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, cols.map((c, i) => el("th", { scope: "col", class: i > 0 ? "num" : null, text: c })))),
    el("tbody", {}, rows.map((r) => {
      const f = r.fit, k = extra.length;
      const cells = f
        ? [td(k + 1, s2(f.b)), td(k + 2, `${s2(f.lo)} to ${s2(f.hi)}`, "num d55-wrap"), td(k + 3, whisker(f, scale), "d55-bar"), td(k + 4, f.r2 == null ? "–" : fmt.pct(f.r2, 0)), ...(change ? [td(k + 5, steadyCell(f), "num d55-wrap")] : [])]
        : [td(k + 1, "no fit"), td(k + 2, `fewer than ${MIN_YEARS} years`, "num d55-wrap"), td(k + 3, "", "d55-bar"), td(k + 4, "–"), ...(change ? [td(k + 5, "–")] : [])];
      return el("tr", {}, el("th", { scope: "row", "data-label": cols[0], class: r.label.length <= 14 ? "d55-short" : null, text: r.label }), extra.map((x, i) => td(i + 1, x.value(r))), cells);
    })));
}

/* ---------- drawing ---------- */
function drawScatter(r, focus, change) {
  const p = r.panel, many = p.N > 1500;
  const dots = (rows) => rows.map((o) => ({ x: o.x, y: o.y, label: `${o.name} ${o.year}` }));
  const xs = p.residuals.map((o) => o.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const rest = p.residuals.filter((o) => !focus || o.id !== focus.id), own = focus ? p.residuals.filter((o) => o.id === focus.id) : [];
  const series = [{ name: p.G > 1 ? "Common slope, average intercept" : "Fitted line", type: "line", color: "#16233b", width: 2, hover: false, data: [x0, x1].map((x) => [x, p.intercept + p.b * x]) }];
  if (rest.length) series.push({ name: focus ? "Other countries" : "Country-years", type: "scatter", color: 0, r: many ? 3 : 4.5, opacity: many ? 0.55 : 1, data: dots(rest) });
  if (focus && p.G > 1) {
    const fx = own.map((o) => o.x);
    series.push({ name: `${focus.name}: its own line`, type: "line", color: 1, width: 2, hover: false, data: [Math.min(...fx), Math.max(...fx)].map((x) => [x, focus.fit.intercept + focus.fit.b * x]) });
  }
  if (own.length) series.push({ name: focus.name, type: "scatter", color: 1, r: 4.5, data: dots(own) });
  scatter.update({
    title: change ? "Growth and the change in unemployment" : "The output gap and the unemployment gap",
    subtitle: `Each dot is one country in one year. The years furthest from the line are named where there is room, and listed under the chart. Unemployment: ${SERIES[state.series].short}.`,
    label: change ? "Scatter plot of the change in the unemployment rate against real GDP growth, one dot for each country and year" : "Scatter plot of the unemployment gap against the output gap, one dot for each country and year",
    hover: "point",
    x: { label: change ? "Real GDP growth (%)" : "Output above its trend (%)", format: n1 },
    y: { label: change ? "Change in the unemployment rate (points)" : "Unemployment above its trend (points)", format: (v) => fmt.signed(v, 1) },
    series, legend: true,
    // A name beside a dot near the right-hand edge is written to the left of it, so that it is not cut off.
    marks: furthest(p, 5).map((o) => { const right = o.x > x0 + 0.55 * (x1 - x0); return { type: "text", x: o.x, y: o.y, text: `${o.name} ${o.year}`, dx: right ? -7 : 7, dy: 4, anchor: right ? "end" : "start" }; }),
  });
}

function drawTime(focus, change) {
  const rows = focus.fit.residuals, byYear = new Map(rows.map((o) => [o.year, o]));
  const line = (get) => { const out = []; for (let y = focus.fit.years[0]; y <= focus.fit.years[1]; y++) out.push([y, byYear.has(y) ? get(byYear.get(y)) : NaN]); return out; };
  timeline.update({
    title: change ? `Growth and the change in unemployment, ${focus.name}` : `Output and unemployment against their trends, ${focus.name}`,
    subtitle: `${change ? "The dashed line is the change in unemployment that the country's own Okun line predicts from that year's growth." : "The dashed line is the unemployment gap that the country's own Okun line predicts from that year's output gap."} Unemployment: ${SERIES[state.series].short}.`,
    label: change
      ? `Line chart by year for ${focus.name}: real GDP growth, the change in the unemployment rate, and the change its fitted line predicts`
      : `Line chart by year for ${focus.name}: output above trend, unemployment above trend, and the unemployment gap its fitted line predicts`,
    x: { label: "Year", format: (v) => (Number.isInteger(v) ? String(v) : ""), ticks: 6 },
    y: { label: change ? "Per cent a year, and percentage points" : "Per cent of trend, and percentage points", format: (v) => fmt.signed(v, 1) },
    series: [
      { name: change ? "Real GDP growth" : "Output above trend", type: "line", color: 0, data: line((o) => o.x) },
      { name: change ? "Change in unemployment" : "Unemployment above trend", type: "line", color: 1, width: 2.5, data: line((o) => o.y) },
      { name: "Predicted by the line", type: "line", color: "#16233b", dash: true, width: 1.5, data: line((o) => o.fitted) },
    ],
    marks: [{ type: "hline", y: 0 }],
  });
}

function update() {
  const change = state.version === "change";
  lambdaSeg.el.hidden = change;
  seriesHint.textContent = state.series === "oecd"
    ? "OECD Economic Outlook 119: national definitions, from 1960 for the longest series to 2025, 45 countries."
    : `World Bank series of the ILO's modelled estimates: one method for 181 countries, ${SERIES.ilo.from} to ${SERIES.ilo.to}. Figures for countries with few surveys are imputed. The ILO's projections for later years are left out.`;
  yearsHint.textContent = change
    ? `At least ${MIN_YEARS} years. Each year pairs that year's growth with the change in unemployment since the year before.`
    : `At least ${MIN_YEARS} years. Each year pairs that year's output gap with its unemployment gap. The trends behind the gaps use all of a country's years, not only these.`;
  versionHint.textContent = change
    ? "The change in the unemployment rate against real GDP growth in the same year."
    : "Unemployment above or below its trend against output above or below its trend. Both trends are smoothed from the data, not observed.";
  const pool = available();
  const chosen = pool.filter((c) => state.picked.has(c.iso3));
  pickedCount.textContent = `${chosen.length} ticked`;
  const r = analyse(chosen, { series: state.series, version: state.version, lambda: state.lambda, from: state.from, to: state.to, skipPandemic: state.skip });
  if (r.error) {
    message.replaceChildren(note("warn", r.error));
    announce(r.error);
    results.hidden = true;
    return;
  }
  results.hidden = false;
  const p = r.panel, single = p.G === 1;
  const text = `${describe(p, { version: state.version, who: single ? inSentence(r.groups[0].name) : "" })} Unemployment figures: ${SERIES[state.series].short}.`;
  const notes = [note("", text)];
  if (!single && r.pooled) notes.push(el("p", { class: "small muted d55-words", text: `With one intercept for all ${p.G} countries in place of one each, the slope is ${s2(r.pooled.b)}.` }));
  if (r.skipped.length) {
    const names = r.skipped.slice(0, 6).map((c) => `${c.name} (${c.years})`).join(", ");
    notes.push(note("warn", `${r.skipped.length === 1 ? "1 ticked country is" : `${r.skipped.length} ticked countries are`} left out for having fewer than ${MIN_YEARS} years of both figures in these years: ${names}${r.skipped.length > 6 ? ` and ${r.skipped.length - 6} more` : ""}. The number after each name is the years it has.`));
  }
  notes.push(el("p", { class: "small muted d55-words", text: "Every line here is a least-squares fit to yearly figures. It shows how growth and unemployment have moved together, not what a policy that added growth would do to jobs. The 95% intervals come from Student's t and treat each country-year as independent." }));
  message.replaceChildren(...notes);
  announce(text);

  tiles.b.set(s2(p.b), `95% interval ${s2(p.lo)} to ${s2(p.hi)}`);
  tiles.steady.el.hidden = !change;
  if (change) tiles.steady.set(p.b < 0 && p.steady.bounded ? `${n1(p.steady.value)}%` : "–", p.b < 0 && p.steady.bounded ? `95% interval ${n1(p.steady.lo)}% to ${n1(p.steady.hi)}%` : !(p.b < 0) ? "the line does not slope down" : "the slope is too uncertain: the 95% interval has no end");
  tiles.r2.set(p.r2 == null ? "–" : fmt.pct(p.r2, 0), single ? "of the year-to-year variation" : "of the variation within countries");
  tiles.n.set(fmt.int(p.N), single ? `years of ${inSentence(r.groups[0].name)}, ${span(p)}` : `country-years from ${p.G} countries, ${span(p)}`);

  // The country to look at: the one chosen if it is in the fit, otherwise the first that is.
  const fitted = r.byCountry;
  if (!fitted.some((c) => c.id === state.focus)) state.focus = (fitted.find((c) => c.id === DEFAULTS.focus) || fitted[0]).id;
  focusSel.input.replaceChildren(...fitted.map((c) => el("option", { value: c.id, text: c.name })));
  focusSel.value = state.focus;
  const focus = fitted.find((c) => c.id === state.focus);
  drawScatter(r, focus, change);
  missBox.replaceChildren(el("p", { class: "chart-title", text: "The years furthest from the line" }), el("ol", { class: "d55-miss" }, furthest(p, 5).map((o) => el("li", { text: missWords(o, state.version) }))));
  focusWords.textContent = describe(focus.fit, { version: state.version, who: inSentence(focus.name) });
  drawTime(focus, change);

  const order = [...fitted].sort((a, b) => a.fit.b - b.fit.b);
  countryBox.replaceChildren(el("div", { class: "d55-scroll" }, fitTable({
    caption: `Each country's own line, ${span(p)}, strongest link first. Unemployment: ${SERIES[state.series].short}.`, firstLabel: "Country", change,
    extra: [{ label: "Years", value: (row) => String(row.fit.N) }],
    rows: order.map((c) => ({ label: c.name, fit: c.fit })),
  })));
  periodBox.replaceChildren(fitTable({
    caption: `The ticked countries, period by period${state.skip ? ", without 2020 and 2021" : ""}. These periods are fixed and do not follow the year sliders. Unemployment: ${SERIES[state.series].short}.`, firstLabel: "Period", change,
    extra: [{ label: "Countries with enough years", value: (row) => (row.fit ? String(row.fit.G) : "0") }],
    rows: r.periods.map((q) => ({ label: `${q.from} to ${q.to}`, fit: q.fit })),
  }));
}

drawList();
update();
