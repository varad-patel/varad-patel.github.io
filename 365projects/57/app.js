// Day 57: Phillips Curve Fitter. Interface.
import { $, el, fmt, mount, slider, select, segmented, textField, button, note, chart, debounce } from "../kit/kit.js";
import { MACRO } from "../data/macro.js";
import { MIN_YEARS, WINDOW, EXTREME, seriesFor, rowsFor, parseBreaks, erasFrom, fitEras, rolling, describe, years, listOf, extremeYears, inSentence, s2, unboundedCell } from "./logic.js";

mount();

const DEFAULTS = { country: "USA", other: "", version: "simple", breaks: "1970, 1985, 2008", width: WINDOW.start };
const PRESETS = [
  { label: "Textbook eras", breaks: "1970, 1985, 2008" },
  { label: "Decades", breaks: "1970, 1980, 1990, 2000, 2010" },
  { label: "Before and after 2000", breaks: "2000" },
  { label: "One era", breaks: "" },
];
const usable = MACRO.countries.filter((c) => rowsFor(c).length >= MIN_YEARS).sort((a, b) => a.name.localeCompare(b.name, "en"));
const byIso = new Map(usable.map((c) => [c.iso3, c]));
const state = { ...DEFAULTS };
const n1 = (x) => fmt.num(x, 1);

/* ---------- controls ---------- */
const options = usable.map((c) => ({ value: c.iso3, label: c.name }));
const countrySel = select({ label: "Country", value: state.country, options, onChange: (v) => { state.country = v; update(); } });
const otherSel = select({
  label: "Compare with", value: "", options: [{ value: "", label: "No second country" }, ...options],
  hint: "A second country gets its own chart and table, and a second line in the moving-window chart.",
  onChange: (v) => { state.other = v; update(); },
});
const versionSeg = segmented({
  label: "Fit unemployment against", value: state.version,
  options: [{ value: "simple", label: "Inflation" }, { value: "augmented", label: "The change in inflation" }],
  hint: "The change in inflation is the expectations-augmented curve, with last year's inflation standing in for what people expected.",
  onChange: (v) => { state.version = v; update(); },
});
const breaksField = textField({
  label: "First year of each new era", value: state.breaks, placeholder: "for example 1970, 1985, 2008",
  hint: `Up to seven years from ${MACRO.first + 1} to ${MACRO.last}, separated by commas. Each era gets its own line.`,
});
breaksField.input.maxLength = 120;
// The message about the breaks sits under the field and is tied to it for screen readers.
const breaksNote = el("div", { id: "d57-breaks-note" });
breaksField.input.setAttribute("aria-describedby", [breaksField.input.getAttribute("aria-describedby"), "d57-breaks-note"].filter(Boolean).join(" "));
const later = debounce(() => update(), 350);
breaksField.input.addEventListener("input", () => { state.breaks = breaksField.input.value; later(); });
const widthSlider = slider({
  label: "Years in the moving window", min: WINDOW.min, max: WINDOW.max, step: 1, value: state.width, format: (v) => `${v} years`,
  hint: "The last chart fits a line to every run of this many years.",
  onInput: (v) => { state.width = v; update(); },
});
function setBreaks(text) { state.breaks = text; breaksField.value = text; update(); }
function reset() {
  Object.assign(state, DEFAULTS);
  countrySel.value = state.country; otherSel.value = ""; versionSeg.value = state.version; breaksField.value = state.breaks; widthSlider.value = state.width;
  update();
}
const dataLine = el("p", { class: "small muted d57-data" });
const controls = el("div", { class: "controls" },
  countrySel.el, otherSel.el, versionSeg.el,
  el("div", { class: "field" }, breaksField.el, breaksNote,
    el("div", { class: "row", role: "group", "aria-label": "Example eras" }, PRESETS.map((p) => button(p.label, () => setBreaks(p.breaks), { small: true })))),
  widthSlider.el,
  el("div", { class: "row" }, button("Reset", reset, { small: true })),
  dataLine);

/* ---------- outputs ---------- */
const status = el("p", { class: "sr-only", role: "status" });
const extremeNote = el("div");
const caveat = note("", "Every line here is a least-squares fit to yearly figures. It shows how inflation and unemployment moved together in those years, not what would happen if a government chose a different unemployment rate. Intervals are 95% intervals from Student's t and treat the years as independent.");
const slots = [0, 1].map((i) => {
  const box = el("div", { class: "d57-country", id: `d57-c${i}` });
  const plotBox = el("div"), tableBox = el("div"), words = el("ul", { class: "d57-words" });
  box.append(plotBox, tableBox, words);
  return { box, plot: chart(plotBox, { series: [], height: 380 }), tableBox, words };
});
const rollBox = el("div", { id: "d57-roll" });
const results = el("div", { class: "out" }, caveat, extremeNote, slots[0].box, slots[1].box, rollBox);
$("#app").append(
  el("nav", { class: "jump", "aria-label": "Parts of this tool" }, el("a", { href: "#d57-c0", text: "Curve by era" }), el("a", { href: "#d57-roll", text: "Slope over time" })),
  el("div", { class: "tool-grid" }, controls, el("div", { class: "out" }, status, results)));
const rollPlot = chart(rollBox, { series: [], height: 320 });
const announce = debounce((text) => { status.textContent = text; }, 700);

/* ---------- drawing ---------- */
const outcome = () => (state.version === "simple" ? "Inflation" : "Change in inflation");
const interval = (f) => `${s2(f.lo)} to ${s2(f.hi)}`;
const steady = (f) => (!(f.b < 0) ? "none: the line does not slope down" : f.steady.bounded ? `${n1(f.steady.value)}% (${n1(f.steady.lo)}% to ${n1(f.steady.hi)}%)` : unboundedCell(f.steady));

function eraTable(country, fitted) {
  const aug = state.version === "augmented";
  const cols = ["Era", "Years with data", `Slope: points of ${aug ? "the change in inflation" : "inflation"} per point of unemployment`, "95% interval for the slope", "Variation explained", ...(aug ? ["Unemployment rate at which inflation is steady (95% interval)"] : [])];
  const cell = (i, text, head) => el(head ? "th" : "td", { scope: head ? "row" : null, "data-label": cols[i], class: i > 0 ? `num${text.length > 16 ? " d57-wrap" : ""}` : null, text });
  return el("table", { class: "tbl d57-tbl" },
    el("caption", { text: `${country.name}: the fitted line in each era. Unemployment: ${seriesFor(country).label}.` }),
    el("thead", {}, el("tr", {}, cols.map((c, i) => el("th", { scope: "col", class: i > 0 ? "num" : null, text: c })))),
    el("tbody", {}, fitted.map((e) => {
      const f = e.fit;
      const cells = f
        ? [String(f.n), s2(f.b), interval(f), f.r2 == null ? "–" : fmt.pct(f.r2, 0), ...(aug ? [steady(f)] : [])]
        : [String(e.rows.length), "no line", e.rows.length < MIN_YEARS ? `needs ${MIN_YEARS} years` : "unemployment did not vary", "–", ...(aug ? ["–"] : [])];
      return el("tr", {}, cell(0, years(e.from, e.to), true), cells.map((text, i) => cell(i + 1, text)));
    })));
}

function drawCountry(slot, country, breaks) {
  const rows = rowsFor(country, state.version);
  const { eras, ignored } = erasFrom(rows[0].year, rows.at(-1).year, breaks);
  const fitted = fitEras(rows, eras);
  const aug = state.version === "augmented";
  const lo = Math.min(...rows.map((r) => r.x)), hi = Math.max(...rows.map((r) => r.x));
  const path = [];
  rows.forEach((r, i) => { if (i && r.year !== rows[i - 1].year + 1) path.push([NaN, NaN]); path.push([r.x, r.y]); });
  const series = [{ name: "Year to year", type: "line", data: path, color: "#8a94a3", width: 1, opacity: 0.55, hover: false, legend: false }];
  const marks = aug ? [{ type: "hline", y: 0, text: "Inflation unchanged" }] : [];
  fitted.forEach((e, i) => {
    if (e.fit) series.push({ name: `${years(e.from, e.to)} line`, type: "line", color: i, width: 2.5, hover: false, legend: false, data: e.fit.xRange.map((x) => [x, e.fit.a + e.fit.b * x]) });
    series.push({ name: years(e.from, e.to), type: "scatter", color: i, r: 4.5, data: e.rows.map((r) => ({ x: r.x, y: r.y, label: `${country.name} ${r.year}` })) });
    // A year beside a dot near the right-hand edge is written to the left of it, so that it is not cut off.
    for (const r of new Set([e.rows[0], e.rows.at(-1)])) if (r) { const right = r.x > lo + 0.85 * (hi - lo); marks.push({ type: "text", x: r.x, y: r.y, text: String(r.year), dx: right ? -7 : 7, dy: -6, anchor: right ? "end" : "start" }); }
  });
  slot.plot.update({
    title: `${outcome()} against unemployment, ${country.name}`,
    subtitle: `Each dot is a year, joined in order by the thin grey line. Each era has its own colour and its own fitted line. The first and last year of each era are named. Unemployment: ${seriesFor(country).label}.`,
    label: `Scatter plot of ${outcome().toLowerCase()} against the unemployment rate for ${country.name}, one dot for each year, coloured by era`,
    hover: "point",
    x: { label: "Unemployment rate (%)", format: n1 },
    y: { label: aug ? "Change in inflation from the year before (points)" : "Consumer price inflation (%)", format: n1 },
    series, marks, legend: fitted.length > 1,
  });
  slot.tableBox.replaceChildren(eraTable(country, fitted));
  const who = inSentence(country.name);
  slot.words.replaceChildren(...fitted.map((e) => el("li", { text: describe(e, { version: state.version, who }) })));
  return { rows, fitted, ignored };
}

function dataNote(country, rows) {
  const s = seriesFor(country);
  const first = rows[0].year, last = rows.at(-1).year, missing = last - first + 1 - rows.length;
  const parts = [`${country.name}: unemployment from the ${s.label}; inflation from the World Bank. ${rows.length} years, ${first} to ${last}.`];
  if (missing) parts.push(`${missing === 1 ? "1 year in between has" : `${missing} years in between have`} a figure missing and ${missing === 1 ? "is" : "are"} left out.`);
  if (last < MACRO.last) parts.push(`${last + 1 === MACRO.last ? MACRO.last : `${last + 1} to ${MACRO.last}`} ${last + 1 === MACRO.last ? "is" : "are"} left out for lack of one of the two figures${s.key === "uIlo" && last === MACRO.lastIlo ? ": the ILO's figures after " + MACRO.lastIlo + " are projections" : ""}.`);
  return parts.join(" ");
}

function update() {
  const parsed = parseBreaks(state.breaks, MACRO.first, MACRO.last);
  breaksField.input.classList.toggle("invalid", Boolean(parsed.error));
  breaksField.input.setAttribute("aria-invalid", parsed.error ? "true" : "false");
  if (parsed.error) {
    breaksNote.replaceChildren(note("bad", parsed.error));
    results.hidden = true;
    return;
  }
  results.hidden = false;
  const country = byIso.get(state.country), other = byIso.get(state.other) && state.other !== state.country ? byIso.get(state.other) : null;
  const main = drawCountry(slots[0], country, parsed.breaks);
  slots[1].box.hidden = !other;
  const second = other ? drawCountry(slots[1], other, parsed.breaks) : null;

  // Breaks that fall outside a country's own years make no era there: say so instead of drawing an empty one.
  const outside = [[country, main], ...(other ? [[other, second]] : [])].filter(([, d]) => d.ignored.length)
    .map(([c, d]) => `${listOf(d.ignored)} ${d.ignored.length === 1 ? "does" : "do"} not split the years with data for ${inSentence(c.name)} (${years(d.rows[0].year, d.rows.at(-1).year)}), so ${d.ignored.length === 1 ? "it is" : "they are"} not used there.`);
  breaksNote.replaceChildren(...(outside.length ? [note("warn", outside.join(" "))] : []));
  // Hyperinflation: one year can decide a whole era's line, and the visitor should know which.
  const wild = [[country, main], ...(other ? [[other, second]] : [])].map(([c, d]) => [c, extremeYears(d.rows)]).filter(([, ys]) => ys.length)
    .map(([c, ys]) => `In ${inSentence(c.name)} ${state.version === "simple" ? `inflation was above ${EXTREME}%` : `inflation moved by more than ${EXTREME} points`} in ${ys.length === 1 ? ys[0] : `${ys.length} years (${ys.length > 6 ? `${ys.slice(0, 6).join(", ")} and ${ys.length - 6} more` : listOf(ys)})`}. A line through an era that contains ${ys.length === 1 ? "that year mostly measures it" : "years like these mostly measures them"}.`);
  extremeNote.replaceChildren(...(wild.length ? [note("warn", wild.join(" "))] : []));
  extremeNote.hidden = !wild.length;
  if (state.other && state.other === state.country) breaksNote.append(note("", "The second country is the same as the first, so it is not drawn twice."));
  dataLine.textContent = [dataNote(country, main.rows), other ? dataNote(other, second.rows) : ""].join(" ").trim();

  const width = state.width;
  const lines = [[country, main, 0], ...(other ? [[other, second, 1]] : [])].map(([c, d, color]) => ({ c, color, roll: rolling(d.rows, width) }));
  const series = lines.flatMap(({ c, color, roll }) => [
    { name: `${c.name}: 95% interval`, type: "range", color, data: roll.map((w) => [w.end, w.fit.lo, w.fit.hi]), legend: false },
    { name: c.name, type: "line", color, width: 2.5, data: roll.map((w) => [w.end, w.fit.b]) },
  ]);
  const any = lines.some((l) => l.roll.length);
  rollPlot.update({
    title: `Slope over a moving window of ${width} years`,
    subtitle: `Each point is the slope of ${outcome().toLowerCase()} on unemployment fitted to the ${width} years ending in that year. The shaded band is its 95% interval. A band that includes zero means no reliable slope. Unemployment: ${lines.map(({ c }) => `${lines.length > 1 ? `${c.name}, ` : ""}${seriesFor(c).label}`).join("; ")}.`,
    label: `Line chart of the fitted slope over a moving window of ${width} years, with its 95% interval`,
    // Whole years only: on a short span the ticks fall between years, and those get no label.
    x: { label: "Last year of the window", format: (v) => (Number.isInteger(v) ? String(v) : ""), ticks: 6 },
    y: { label: "Points per point of unemployment", format: (v) => fmt.signed(v, 2) },
    series: any ? series : [], marks: any ? [{ type: "hline", y: 0, text: "No slope" }] : [],
    legend: lines.length > 1,
    empty: `No run of ${width} years in a row has data. Shorten the window.`,
  });

  const head = main.fitted.filter((e) => e.fit).map((e) => `${years(e.from, e.to)} ${s2(e.fit.b)}`).join("; ");
  announce(`${country.name}, ${outcome().toLowerCase()} against unemployment (${seriesFor(country).short}). Slope by era: ${head || "no era has enough years for a line"}.`);
}

update();
