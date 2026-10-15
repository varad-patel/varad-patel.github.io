// Day 70: Fear and Greed Index. Interface.
import { $, el, fmt, mount, slider, segmented, button, stat, note, table, chart, debounce } from "../kit/kit.js";
import { TSX } from "./data.js";
import { BANDS, COMPONENTS, monthOf, indexOf, monthName, band, signals, buildIndex, oosTest, byBand } from "./logic.js";

mount();

const sig = signals(TSX);
const WEIGHT_DEFAULT = { momentum: 1, volatility: 1, breadth: 1 };
const state = { month: sig.n - 1, window: 120, h: 12, weights: { ...WEIGHT_DEFAULT } };
const xOf = (i) => { const m = monthOf(sig.start, i); return Number(m.slice(0, 4)) + (Number(m.slice(5)) - 1) / 12; };
const short = (i) => { const m = monthOf(sig.start, i); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`; };
const xLabel = (v) => String(Math.floor(v + 1e-9));
const pct = (v, d = 1) => `${fmt.signed(100 * v, d)}%`;
let current = null;

/* ---------- controls ---------- */
const monthSlider = slider({
  label: "Month", min: 0, max: sig.n - 1, step: 1, value: state.month,
  format: (i) => monthName(monthOf(sig.start, i)),
  hint: "Month-end values. The data end in September 2023, when Statistics Canada stopped updating the table.",
  onInput: (i) => { state.month = i; showMonth(); },
});
const jumps = [["1987-10", "Oct 1987"], ["2000-08", "Aug 2000"], ["2008-10", "Oct 2008"], ["2020-03", "Mar 2020"], ["2021-06", "Jun 2021"], ["2023-09", "Sep 2023"]];
const jumpRow = el("div", { class: "row jumps", role: "group", "aria-label": "Go to a month" },
  jumps.map(([m, label]) => button(label, () => { state.month = indexOf(sig.start, m); monthSlider.value = state.month; showMonth(); monthSlider.input.focus(); }, { small: true })));
const weightSliders = COMPONENTS.map((c) => slider({
  label: `Weight of ${c.label.toLowerCase()}`, min: 0, max: 3, step: 0.5, value: state.weights[c.key],
  format: (v) => fmt.num(v, 1),
  onInput: (v) => { state.weights[c.key] = v; later(); },
}));
const resetW = button("Equal weights", () => { state.weights = { ...WEIGHT_DEFAULT }; weightSliders.forEach((s, k) => { s.value = WEIGHT_DEFAULT[COMPONENTS[k].key]; }); rebuild(); resetW.focus(); }, { small: true });
const windowSeg = segmented({
  label: "Rank each signal against the last",
  value: "120",
  options: [{ value: "60", label: "5 years" }, { value: "120", label: "10 years" }, { value: "240", label: "20 years" }],
  onChange: (v) => { state.window = Number(v); rebuild(); },
});
const controls = el("div", { class: "controls" },
  monthSlider.el, jumpRow,
  el("div", { class: "field", role: "group", "aria-label": "Weights" }, el("div", { class: "lab" }, el("span", { text: "Weights" })), ...weightSliders.map((s) => s.el),
    el("div", { class: "hint", text: "The index is the weighted average of the three scores. A weight of 0 leaves a signal out." }), el("div", {}, resetW)),
  windowSeg.el,
  note("", "This page builds its own index from open data on Canadian shares. It is not the Fear & Greed Index that CNN Business publishes, and it is an illustration of a method, not investment advice."));

/* ---------- outputs ---------- */
const sIndex = stat("Index");
const sMom = stat("Momentum");
const sVol = stat("Volatility");
const sBreadth = stat("Breadth");
const gauge = el("div", { class: "gauge", role: "img" });
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div");
const compBox = el("div");
const aboveBox = el("p", { class: "small muted" });
const indexBox = el("div"), priceBox = el("div");
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sIndex.el, sMom.el, sVol.el, sBreadth.el), gauge, status, message, compBox, aboveBox, indexBox, priceBox);

const testHead = el("h2", { text: "Does the index say anything about the months ahead?" });
const hSeg = segmented({
  label: "Forecast the change over the next",
  value: "12",
  options: [{ value: "1", label: "1 month" }, { value: "3", label: "3 months" }, { value: "12", label: "12 months" }],
  onChange: (v) => { state.h = Number(v); drawTest(); },
});
const testStatus = el("p", { class: "sr-only", role: "status" });
const testOut = el("div", { class: "stack" });
const cumBox = el("div");
const bandBox = el("div");
const testPanel = el("div", { class: "panel stack" }, testHead, hSeg.el, testStatus, testOut, cumBox, bandBox);

const sourceNote = el("p", { class: "small muted source-note" });
$("#app").append(el("div", { class: "tool-grid" }, controls, out), testPanel, sourceNote);
sourceNote.textContent = `${TSX.source.notice} ${TSX.source.adapted} ${TSX.source.origin} Retrieved ${fmt.date(TSX.retrieved)}.`;

const indexChart = chart(indexBox, { series: [], height: 300 });
const priceChart = chart(priceBox, { series: [], height: 240 });
const cumChart = chart(cumBox, { series: [], height: 240 });

/** A kit table whose rows become labelled lists when its box is narrow (see the CSS in index.html). */
function stackable(wrap) {
  const t = wrap.querySelector("table");
  t.classList.add("rt");
  const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent);
  for (const tr of t.querySelectorAll("tbody tr")) [...tr.children].forEach((td, k) => td.setAttribute("data-label", heads[k]));
  return wrap;
}

/* ---------- the index ---------- */
const later = debounce(() => rebuild(), 150);

function rebuild() {
  current = buildIndex(sig, { window: state.window, weights: state.weights });
  if (current.error) {
    message.replaceChildren(note("bad", current.error));
    status.textContent = current.error;
    for (const s of [sIndex, sMom, sVol, sBreadth]) s.set("–", "");
    gauge.replaceChildren();
    compBox.replaceChildren();
    indexChart.update({ series: [], marks: [], empty: "Give at least one component a weight above zero" });
    testOut.replaceChildren(note("warn", "The test needs an index: give at least one component a weight above zero."));
    testStatus.textContent = "";
    cumChart.update({ series: [], marks: [], empty: "No index to test" });
    bandBox.replaceChildren();
    return;
  }
  message.replaceChildren();
  const pts = current.index.map((v, i) => [xOf(i), v]).filter((p) => p[1] != null);
  indexChart.update({
    title: "The index, month by month",
    subtitle: `0 is the most fearful reading, 100 the most greedy; the grey lines divide the five bands. First value ${monthName(monthOf(sig.start, current.first))}, when every signal used has ${state.window / 12} years of history to be ranked against.`,
    label: "Line chart of the fear and greed index from its first month to September 2023",
    x: { label: "Month", format: xLabel, domain: [xOf(0), xOf(sig.n - 1)] },
    y: { label: "Index (0 to 100)", domain: [0, 100], format: (v) => fmt.int(v) },
    series: [{ name: "Index", type: "line", data: pts, color: 0, width: 1.4 }],
    marks: [],
  });
  showMonth();
  drawTest();
}

function showMonth() {
  if (!current || current.error) return;
  const i = state.month;
  const m = monthOf(sig.start, i);
  const v = current.index[i];
  const b = band(v);
  const sc = current.scores;
  const shown = (k, d) => (sc[k][i] == null ? "–" : fmt.int(sc[k][i]));
  sMom.set(shown("momentum"), sig.momentum[i] == null ? "not yet measured" : `composite ${pct(sig.momentum[i])} against its 10-month average`);
  sVol.set(shown("volatility"), sig.volatility[i] == null ? "not yet measured" : `${fmt.num(100 * sig.volatility[i], 1)}% a year over 6 months`);
  sBreadth.set(shown("breadth"), sig.breadth[i] == null ? "not yet measured" : `${sig.above[i].up.length} of ${sig.above[i].of} sectors above their average`);
  if (v == null) {
    sIndex.set("–", "no value yet");
    const need = monthName(monthOf(sig.start, current.first));
    message.replaceChildren(note("warn", `${monthName(m)} is too early: the index starts in ${need}, once each signal it uses has ${state.window / 12} years of its own history to be ranked against. Move the slider later or choose a shorter ranking window.`));
    status.textContent = `${monthName(m)}: no index value yet. It starts in ${need}.`;
    gauge.replaceChildren();
  } else {
    sIndex.set(fmt.int(v), b.label);
    message.replaceChildren();
    status.textContent = `${monthName(m)}: index ${fmt.int(v)}, ${b.label.toLowerCase()}. Momentum ${shown("momentum")}, volatility ${shown("volatility")}, breadth ${shown("breadth")}.`;
    gauge.setAttribute("aria-label", `Index ${fmt.int(v)} of 100: ${b.label}`);
    gauge.replaceChildren(
      el("div", { class: "gauge-bar" }, BANDS.map((x, k) => el("span", { class: `g${k}`, text: x.label })), el("i", { style: { left: `${v}%` } })),
      el("div", { class: "gauge-ticks", "aria-hidden": "true" }, [0, 20, 40, 60, 80, 100].map((t) => el("span", { text: String(t) }))));
  }
  compBox.replaceChildren(stackable(table({
    caption: `How the index is made up, ${monthName(m)}`,
    columns: [
      { key: "c", label: "Signal" },
      { key: "raw", label: "Reading", num: true },
      { key: "s", label: "Score", num: true },
      { key: "w", label: "Weight", num: true },
      { key: "part", label: "Adds to index", num: true },
    ],
    rows: COMPONENTS.map((c) => {
      const s = sc[c.key][i], w = state.weights[c.key];
      const raw = c.key === "momentum" ? (sig.momentum[i] == null ? "–" : pct(sig.momentum[i]))
        : c.key === "volatility" ? (sig.volatility[i] == null ? "–" : `${fmt.num(100 * sig.volatility[i], 1)}%`)
        : sig.breadth[i] == null ? "–" : `${sig.above[i].up.length} of ${sig.above[i].of}`;
      return { c: c.label, raw, s: s == null ? "–" : fmt.num(s, 1), w: fmt.num(w, 1), part: s == null || !w ? "–" : fmt.num((w * s) / current.total, 1) };
    }),
  })));
  aboveBox.textContent = sig.above[i]
    ? `Sectors above their 10-month average in ${monthName(m)} (${sig.above[i].set === "old" ? "the seven TSE 300 sector indices, used before 2000" : "the ten S&P/TSX sector indices, used from 2000"}): ${sig.above[i].up.length ? sig.above[i].up.join(", ") : "none"}.`
    : "";
  const marks = [{ type: "vline", x: xOf(i), text: short(i) }];
  indexChart.update({ marks: [...[20, 40, 60, 80].map((y) => ({ type: "hline", y, color: "#8a94a3" })), ...marks] });
  priceChart.update({
    title: "The S&P/TSX Composite",
    subtitle: "Month-end close, log scale. A price index: dividends are not included.",
    label: "Line chart of the S&P/TSX Composite index, monthly, January 1956 to September 2023, log scale",
    x: { label: "Month", format: xLabel, domain: [xOf(0), xOf(sig.n - 1)] },
    y: { label: "Index points", type: "log", format: (v) => fmt.int(v) },
    series: [{ name: "Composite", type: "line", data: sig.price.map((p, k) => [xOf(k), p]), color: "#16233b", width: 1.3 }],
    marks,
  });
}

/* ---------- the forecast test ---------- */
function drawTest() {
  if (!current || current.error) return;
  const h = state.h;
  const t = oosTest(current.index, sig.price, h);
  const span = `${h} ${h === 1 ? "month" : "months"}`;
  if (t.error) {
    testOut.replaceChildren(note("warn", t.error));
    testStatus.textContent = t.error;
    cumChart.update({ series: [], marks: [], empty: "Too few months to test" });
    bandBox.replaceChildren();
    return;
  }
  const better = t.r2 > 0;
  const sig5 = t.p < 0.05;
  const pText = t.p < 0.001 ? "p below 0.001" : t.p > 0.99 ? "p above 0.99" : `p = ${fmt.num(t.p, t.p < 0.01 ? 3 : 2)}`;
  const verdict = better && sig5
    ? `The index forecast better than the historical average, and by more than chance would easily give (Clark-West ${pText}).`
    : better
      ? `The index forecast slightly better than the historical average, but not by more than chance would easily give (Clark-West ${pText}).`
      : `The index forecast worse than the historical average: knowing it would have made the forecasts less accurate (Clark-West ${pText}).`;
  const text = `${fmt.int(t.n)} forecasts, one at the end of each month from ${monthName(monthOf(sig.start, t.from))} to ${monthName(monthOf(sig.start, t.to))}, of the change in the composite over the next ${span}. Each was fitted only on index readings whose outcome was already known. Out-of-sample R² against the historical average: ${fmt.signed(100 * t.r2, 1)}%.`;
  testOut.replaceChildren(note(better && sig5 ? "good" : better ? "" : "warn", text, " ", el("strong", { text: verdict })),
    el("p", { class: "small muted", text: h > 1 ? `Forecasts a month apart share ${h - 1} of their ${h} months, so these are far fewer than ${fmt.int(t.n)} independent tries; the p-value allows for the overlap.` : "One month ahead the forecasts do not overlap." }));
  testStatus.textContent = `${span} ahead: out-of-sample R² ${fmt.signed(100 * t.r2, 1)}%. ${verdict}`;

  let cum = 0;
  const pts = t.rows.map((r) => { cum += (r.actual - r.mean) ** 2 - (r.actual - r.model) ** 2; return [xOf(r.t), cum]; });
  cumChart.update({
    title: "Running score of the index against the historical average",
    subtitle: "Rises when the index forecast was closer, falls when the average was. Ends above zero only if the index won overall.",
    label: `Line chart of the cumulative difference in squared forecast errors, ${span} ahead`,
    x: { label: "Month of the forecast", format: xLabel },
    y: { label: "Squared errors saved", format: (v) => fmt.sig(v, 2) },
    series: [{ name: "Cumulative gain", type: "line", data: pts, color: 2, width: 1.6 }],
    marks: [{ type: "hline", y: 0 }],
  });

  const bb = byBand(current.index, sig.price, h);
  bandBox.replaceChildren(stackable(table({
    caption: `Looking back: the change in the composite over the next ${span}, by the index's band. Every month whose next ${span} are in the data, overlapping; a description, not a test. A spell is a run of months in one band; the last column counts each spell once, from its first month`,
    columns: [
      { key: "b", label: "Band" },
      { key: "share", label: "Months", num: true },
      { key: "runs", label: "Spells", num: true },
      { key: "mean", label: "Average change", num: true },
      { key: "up", label: "Share rising", num: true },
      { key: "first", label: "Average from each spell's first month", num: true },
    ],
    rows: [...bb.groups.map((g) => ({ b: g.label, share: `${fmt.int(g.n)} (${fmt.pct(g.n / bb.all.n, 0)})`, runs: fmt.int(g.runs), mean: g.n ? pct(g.mean) : "–", up: g.n ? fmt.pct(g.up, 0) : "–", first: g.n ? pct(g.firstMean) : "–" })),
      { b: "All months", share: fmt.int(bb.all.n), runs: "–", mean: pct(bb.all.mean), up: fmt.pct(bb.all.up, 0), first: "–" }],
  })));
}

rebuild();
