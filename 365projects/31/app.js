// Day 31: What Is Driving Inflation? Interface.
import { $, el, fmt, mount, slider, select, button, stat, note, chart, clamp, debounce, palette } from "../kit/kit.js";
import { PRICES } from "../data/prices.js";
import { SMALL, monthOf, monthLabel, placeName, decompose, history, peakMonth, periodPhrase, categoryReading, summary, reconciliation, flagNotes } from "./logic.js";

mount();

const UP = palette[1], DOWN = palette[0];
const first = PRICES.countries[0];
// On load: the latest 12 months of the first country in the list. Nothing here names a month: it all comes from the data.
const state = { code: first.code, a: first.last - 12, b: first.last };
const country = () => PRICES.countries.find((c) => c.code === state.code);
const short = (i) => monthLabel(PRICES, i, true);
const points = (x) => `${fmt.signed(x, 2)} points`;

/* ---------- controls ---------- */
const countrySel = select({
  label: "Country", value: state.code,
  hint: "18 European countries, the euro area, the European Union and the United Kingdom. India is not included: the last limit below the tool says why.",
  options: PRICES.countries.map((c) => ({ value: c.code, label: c.name })),
  onChange: (v) => {
    const length = state.b - state.a;
    state.code = v;
    const last = country().last;
    // Keep the same months where the new country has them.
    const b = Math.min(state.b, last);
    setPeriod(Math.max(0, b - length), b);
  },
});
const fromSlider = slider({ label: "From", min: 0, max: first.last - 1, step: 1, value: state.a, format: short, onInput: (v) => setPeriod(v, Math.max(state.b, v + 1)) });
const toSlider = slider({ label: "To", min: 1, max: first.last, step: 1, value: state.b, format: short, onInput: (v) => setPeriod(Math.min(state.a, v - 1), v) });

function stepButton(which, delta) {
  const b = button(delta < 0 ? "1 month earlier" : "1 month later", () => {
    const last = country().last;
    if (which === "a") { const a = clamp(state.a + delta, 0, last - 1); setPeriod(a, Math.max(state.b, a + 1)); }
    else { const e = clamp(state.b + delta, 1, last); setPeriod(Math.min(state.a, e - 1), e); }
  }, { small: true });
  b.setAttribute("aria-label", `${which === "a" ? "From" : "To"}: ${b.textContent}`);
  return b;
}
const steps = { aDown: stepButton("a", -1), aUp: stepButton("a", 1), bDown: stepButton("b", -1), bUp: stepButton("b", 1) };

const presets = el("div", { class: "field", role: "group", "aria-label": "Ready-made periods" },
  el("div", { class: "lab" }, el("span", { text: "Ready-made periods" })),
  el("div", { class: "row" },
    button("Latest 12 months", () => setPeriod(country().last - 12, country().last), { small: true }),
    button("Peak of the surge", () => { const p = peakMonth(PRICES, country()); if (p >= 12) setPeriod(p - 12, p); }, { small: true }),
    button("Whole record", () => setPeriod(0, country().last), { small: true })),
  el("div", { class: "hint", text: "The peak of the surge is the 12 months to the highest official annual rate between January 2021 and December 2023." }));
const vintage = el("p", { class: "small muted vintage" });

const controls = el("div", { class: "controls" },
  countrySel.el,
  fromSlider.el, el("div", { class: "row steps" }, steps.aDown, steps.aUp),
  toSlider.el, el("div", { class: "row steps" }, steps.bDown, steps.bUp),
  presets);

/* ---------- outputs ---------- */
const sTotal = stat("Change in prices");
const sUp = stat("Pushed up most");
const sDown = stat("Pulled down most");
const message = el("div");
const reading = el("p", { class: "reading" });
// Read out once the sliders have come to rest, not on every step of a drag.
const live = el("p", { class: "sr-only", role: "status" });
const announce = debounce((text) => { live.textContent = text; }, 600);
const listHead = el("h2", { text: "Each category's part" });
const list = el("ol", { class: "drivers", role: "list" });
const fine = el("div", { class: "small muted fine" });
const chartBox = el("div");
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sTotal.el, sUp.el, sDown.el), message, reading, live, listHead, list, fine, chartBox, vintage);

$("#app").append(el("div", { class: "tool-grid" }, controls, out));
const plot = chart(chartBox, { series: [], height: 340 });

/* ---------- state ---------- */
function setPeriod(a, b) {
  const last = country().last;
  state.b = clamp(Math.round(b), 1, last);
  state.a = clamp(Math.round(a), 0, state.b - 1);
  update();
}

// The chart's x axis is in years: a month sits at its middle, so ticks on whole years fall between December and January.
const xOf = (i) => { const { year, month } = monthOf(PRICES, i); return year + (month - 0.5) / 12; };
const xLabel = (v) => {
  if (Number.isInteger(v)) return String(v);
  const year = Math.floor(v), month = clamp(Math.round((v - year) * 12 + 0.5), 1, 12);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${year}`;
};

let historyOf = { code: "", rows: [] };

function update() {
  const c = country();
  // Controls follow the state: the two sliders can never cross, and each country has its own latest month.
  fromSlider.input.max = c.last - 1;
  toSlider.input.max = c.last;
  fromSlider.value = state.a;
  toSlider.value = state.b;
  const off = { aDown: state.a <= 0, aUp: state.a >= c.last - 1, bDown: state.b <= 1, bUp: state.b >= c.last };
  for (const [key, b] of Object.entries(steps)) b.setAttribute("aria-disabled", String(off[key]));
  const src = PRICES.sources[c.source];
  vintage.textContent = `Prices for ${placeName(c)} run to ${monthLabel(PRICES, c.last)}. Source: ${src.name}, as updated on ${fmt.date(src.updated)} and retrieved on ${fmt.date(PRICES.retrieved)}. ${src.licence}.`;

  const r = decompose(PRICES, c, state.a, state.b);
  if (r.error) {
    message.replaceChildren(note("bad", r.error));
    for (const s of [sTotal, sUp, sDown]) s.set("–", "");
    reading.textContent = "";
    list.replaceChildren();
    fine.replaceChildren();
    listHead.hidden = true;
    announce(r.error);
    return;
  }
  message.replaceChildren();
  listHead.hidden = false;

  const span = `${short(r.a)} to ${short(r.b)}`;
  if (r.official != null) sTotal.set(`${fmt.signed(r.official, 1)}%`, `${span}: the official annual rate`);
  else sTotal.set(`${fmt.signed(r.total, 1)}%`, `${span}, ${r.months} ${r.months === 1 ? "month" : "months"}${r.average == null ? "" : `: ${fmt.signed(r.average, 1)}% a year`}`);
  const sorted = [...r.categories].sort((x, y) => y.points - x.points);
  const top = sorted[0], bottom = sorted[sorted.length - 1];
  if (top.points >= SMALL) sUp.set(points(top.points), top.short); else sUp.set("–", "no category pushed prices up");
  if (bottom.points <= -SMALL) sDown.set(points(bottom.points), bottom.short); else sDown.set("–", "no category pulled prices down");

  const sentences = summary(PRICES, c, r);
  reading.textContent = sentences.join(" ");
  announce(sentences.join(" "));

  // One row per category, largest push up first: a bar either side of zero, the figure, and a sentence.
  const lo = Math.min(0, bottom.points), hi = Math.max(0, top.points), width = hi - lo || 1;
  listHead.textContent = `Each category's part, ${periodPhrase(PRICES, r)}`;
  list.replaceChildren(...sorted.map((k) => el("li", {},
    el("div", { class: "drv-top" }, el("span", { class: "drv-name", text: k.name }), el("strong", { class: "drv-pts", text: points(k.points) })),
    el("div", { class: "drv-track", "aria-hidden": "true" },
      el("span", { class: "drv-fill", style: { left: `${((Math.min(k.points, 0) - lo) / width) * 100}%`, width: `${(Math.abs(k.points) / width) * 100}%`, background: k.points >= 0 ? UP : DOWN } }),
      el("i", { style: { left: `${(-lo / width) * 100}%` } })),
    el("p", { class: "small muted", text: categoryReading(k, r) }))));
  fine.replaceChildren(...[...reconciliation(PRICES, c, r), ...flagNotes(PRICES, r.flagged, r.categories.length + 1)].map((line) => el("p", { text: line })),
    el("p", { text: "Each figure is rounded to two decimal places, so a column of them can differ from its total by a hundredth or two." }));

  // The 12-month rate over the whole record, with the four categories that matter most in the chosen period.
  if (historyOf.code !== c.code) historyOf = { code: c.code, rows: history(PRICES, c) };
  const rows = historyOf.rows;
  const order = r.categories.map((k, i) => i).sort((x, y) => Math.abs(r.categories[y].points) - Math.abs(r.categories[x].points));
  const named = order.slice(0, 4), rest = order.slice(4);
  plot.update({
    title: `Annual inflation in ${placeName(c)}, and the categories behind it`,
    subtitle: "Each coloured line is one category's contribution to the 12-month rate in that month: the four largest in the period you chose, which is shaded. The grey line is all the other categories together.",
    label: `Line chart of the official annual rate of inflation in ${placeName(c)} and the contributions of the largest categories, by month`,
    x: { label: "Month", format: xLabel },
    y: { label: "Per cent, and percentage points", format: (v) => fmt.num(v, Number.isInteger(v) ? 0 : 2) },
    series: [
      { name: "Official annual rate", type: "line", color: "#16233b", width: 2.5, data: rows.map((h) => [xOf(h.i), h.rate]) },
      ...named.map((k, n) => ({ name: r.categories[k].short, type: "line", color: n, width: 1.8, data: rows.map((h) => [xOf(h.i), h.points[k]]) })),
      { name: "All other categories", type: "line", color: "#8a94a3", width: 1.8, data: rows.map((h) => [xOf(h.i), rest.reduce((s, k) => s + h.points[k], 0)]) },
    ],
    marks: [{ type: "span", x0: xOf(r.a), x1: xOf(r.b) }],
  });
}

update();
