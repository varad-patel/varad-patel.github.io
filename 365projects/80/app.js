// Day 80: Currency Prediction Lab. Interface.
import { $, el, fmt, mount, slider, select, chart, note, button, download, debounce } from "../kit/kit.js";
import { FX } from "./data.js";
import {
  MAX_H, MIN_FIT, MODELS, USD, pairSeries, forecastAt, rollAll, scorecard, running, scanAgainstDollar, asPercent,
  monthLabel, indexOfYear, keyOf,
} from "./logic.js";

mount();

const CURRENCIES = [USD, ...FX.currencies].sort((a, b) => a.code.localeCompare(b.code));
const nameOf = (code) => CURRENCIES.find((c) => c.code === code).name;
const WINDOWS = { all: { label: "Every month since the pair's first", months: Infinity }, w20: { label: "The latest 20 years", months: 240 }, w10: { label: "The latest 10 years", months: 120 } };
const LAST_YEAR = Number(FX.last.slice(0, 4));
const rate = (v) => fmt.sig(v, 5);
const months = (h) => `${fmt.int(h)} ${h === 1 ? "month" : "months"}`;
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
const pFmt = (p) => (Number.isNaN(p) ? "–" : p < 0.001 ? "below 0.001" : fmt.num(p, 3));
const ALL = [{ key: "rw", name: "Random walk", order: "no change", what: "the latest month-end rate, unchanged" }, ...MODELS];

const state = { base: "GBP", quote: "USD", h: 12, window: "all", from: 1990, to: LAST_YEAR };

/* ---------- controls ---------- */
const options = CURRENCIES.map((c) => ({ value: c.code, label: `${c.code}, ${c.name}` }));
const baseSel = select({ label: "Price of one", value: state.base, options, onChange: (v) => { state.base = v; update(); } });
const quoteSel = select({ label: "in", value: state.quote, options, onChange: (v) => { state.quote = v; update(); } });
const swap = button("Swap the two", () => { [state.base, state.quote] = [state.quote, state.base]; baseSel.value = state.base; quoteSel.value = state.quote; update(); swap.focus(); }, { small: true });
const pairError = el("div");
const horizon = slider({
  label: "Horizon", min: 1, max: MAX_H, step: 1, value: state.h, format: (h) => `${months(h)} ahead`,
  hint: "How far ahead each model forecasts. The scorecards score past forecasts made this far ahead.",
  onInput: debounce((h) => { state.h = h; update(); }, 120),
});
const windowSel = select({
  label: "Fit each forecast on", value: state.window, options: Object.entries(WINDOWS).map(([value, w]) => ({ value, label: w.label })),
  hint: "Every forecast, past or present, uses only the month-end rates up to its own date.", onChange: (v) => { state.window = v; update(); },
});
const years = Array.from({ length: LAST_YEAR - 1980 + 1 }, (_, i) => 1980 + i).map((y) => ({ value: y, label: String(y) }));
const fromSel = select({ label: "Score forecasts made from", value: state.from, options: years, onChange: (v) => { state.from = Number(v); update(); } });
const toSel = select({ label: "to", value: state.to, options: years, onChange: (v) => { state.to = Number(v); update(); } });
const yearsHint = el("div", { class: "hint", text: "A pair's first forecast is made once it has ten years of month-end rates; earlier years have nothing to score." });
const about = el("div", { class: "hint source-note" },
  el("strong", { text: "Month-end exchange rates. " }),
  `The last daily rate of each month from the Federal Reserve Board's H.10 release: ${FX.source.what} Cross rates such as EUR/GBP are worked out from the two dollar rates. `,
  `Public domain, retrieved ${fmt.date(FX.retrieved)}, to ${monthLabel(FX.last, 0, false)}.`);
const controls = el("div", { class: "controls" }, baseSel.el, quoteSel.el, el("div", { class: "row" }, swap), pairError, horizon.el, windowSel.el,
  el("div", { class: "field" }, el("div", { class: "fx80-years" }, fromSel.el, toSel.el), yearsHint), about);

/* ---------- outputs ---------- */
const head = el("p", { class: "fx80-rate" });
const status = el("p", { class: "sr-only", role: "status" });
const advice = el("p", { class: "small muted", text: "An illustration of forecasting methods, not investment advice: no forecast here should be read as a reason to buy or sell a currency." });
const forecastBox = el("div", { class: "fx80-tbl" });
const chartBox = el("div");
const scoreHead = el("h2", { text: "Scorecard: each model against the random walk" });
const verdict = el("div");
const scoreBox = el("div", { class: "fx80-tbl" });
const runBox = el("div");
const recentBox = el("div", { class: "fx80-tbl" });
const csvButton = button("Download every scored forecast (CSV)", () => exportCsv(), { small: true });
const scanHead = el("h2", { text: "Every currency against the US dollar" });
const scanProgress = el("p", { class: "small muted" });
const scanStatus = el("p", { class: "sr-only", role: "status" });
const scanSummary = el("div");
const scanBox = el("div", { class: "fx80-tbl" });
const out = el("div", { class: "out" }, head, status, advice, forecastBox, chartBox,
  el("div", { class: "panel fx80-stack" }, scoreHead, verdict, scoreBox, runBox, recentBox, el("div", { class: "row" }, csvButton)),
  el("div", { class: "panel fx80-stack" }, scanHead, scanProgress, scanStatus, scanSummary, el("details", { class: "chart-table" }, el("summary", { text: `Show the table for all ${FX.currencies.length} currencies` }), scanBox)));
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const priceChart = chart(chartBox, { series: [], height: 320 });
const runChart = chart(runBox, { series: [], height: 260 });

/* ---------- helpers ---------- */
const xOf = (start, i) => { const [y, m] = start.split("-").map(Number); return y + (m - 1 + i) / 12; };
const xLabel = (v) => { const k = Math.round(v * 12); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][((k % 12) + 12) % 12]} ${Math.floor(k / 12)}`; };

// A table that turns into a list of labelled lines when its box is narrow (see the page's <style>).
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl fx80-rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {},
      columns.map((c, k) => el(k === 0 ? "th" : "td", { scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/* ---------- the pair ---------- */
let current = null;

function update() {
  if (state.base === state.quote) {
    pairError.replaceChildren(note("bad", `Both boxes say ${state.base}. Choose two different currencies.`));
    current = null; scored = [];
    head.textContent = "Choose two different currencies to see a rate and its forecasts.";
    status.textContent = "";
    forecastBox.replaceChildren(); verdict.replaceChildren(); scoreBox.replaceChildren(); recentBox.replaceChildren();
    runBox.hidden = true; csvButton.disabled = true;
    priceChart.update({ series: [], marks: [], title: "", subtitle: "", label: "Empty chart: choose two different currencies", empty: "Choose two different currencies" });
    runScan();
    return;
  }
  pairError.replaceChildren();
  const p = pairSeries(FX, state.base, state.quote);
  const n = p.logs.length;
  const window = WINDOWS[state.window].months;
  const records = rollAll(p.logs, { window });
  current = { p, records };
  const h = state.h;
  const last = Math.exp(p.logs[n - 1]);
  const lastLabel = monthLabel(p.start, n - 1, false);
  const target = monthLabel(p.start, n - 1 + h, false);
  head.replaceChildren(el("strong", { text: `1 ${state.base} = ${rate(last)} ${state.quote}` }), ` at the end of ${lastLabel}: the price of one ${nameOf(state.base)}, in ${nameOf(state.quote)} units. Rates from ${monthLabel(p.start, 0, false)}.`);

  // The live forecasts, from every month the window allows.
  const live = forecastAt(p.logs, n - 1, Math.max(0, n - window));
  forecastBox.replaceChildren(listTable({
    caption: `Forecasts for the end of ${target}, ${months(h)} ahead (${state.quote} per ${state.base})`,
    columns: [
      { label: "Model", get: (m) => m.name },
      { label: "What it assumes", get: (m) => m.what },
      { label: "Forecast", get: (m) => rate(Math.exp(live[m.key][h - 1])), num: true },
      { label: "Change", get: (m) => `${fmt.signed((Math.exp(live[m.key][h - 1] - p.logs[n - 1]) - 1) * 100, 1)}%`, num: true },
    ],
    rows: ALL,
  }));
  status.textContent = `${state.base} in ${state.quote}: ${rate(last)} at the end of ${lastLabel}. Forecasts for ${target}: ${ALL.map((m) => `${m.name} ${rate(Math.exp(live[m.key][h - 1]))}`).join(", ")}.`;

  const first = Math.max(0, n - 120), lastX = xOf(p.start, n - 1);
  const path = (key) => [[lastX, last], ...Array.from({ length: h }, (_, k) => [xOf(p.start, n + k), Math.exp(live[key][k])])];
  priceChart.update({
    title: `${state.base}/${state.quote}: the latest ten years and each model's forecast`,
    subtitle: `${state.quote} per ${state.base}, month-end. The flat line is the random walk.`,
    label: `Line chart of the month-end exchange rate of ${state.base} in ${state.quote} with four forecasts ${months(h)} ahead`,
    x: { format: xLabel, label: "Month" },
    y: { label: `${state.quote} per ${state.base}`, format: (v) => fmt.sig(v, 4) },
    series: [
      { name: "Rate", type: "line", data: Array.from(p.logs.subarray(first), (v, i) => [xOf(p.start, first + i), Math.exp(v)]), color: 0, width: 1.6 },
      { name: "Random walk", type: "line", data: path("rw"), color: "#16233b", dash: true },
      { name: "Drift", type: "line", data: path("drift"), color: 1 },
      { name: "Momentum", type: "line", data: path("momentum"), color: 2 },
      { name: "Reversion", type: "line", data: path("reversion"), color: 6 },
    ],
    marks: [{ type: "span", x0: lastX, x1: xOf(p.start, n - 1 + h) }],
  });

  showScore();
  runScan();
}

/* ---------- the scorecard for the pair ---------- */
let scored = [];
function showScore() {
  const { p, records } = current;
  const h = state.h, n = p.logs.length;
  scored = [];
  csvButton.disabled = true;
  runBox.hidden = true;
  scoreBox.replaceChildren(); recentBox.replaceChildren();
  if (state.from > state.to) {
    verdict.replaceChildren(note("bad", `The first year (${state.from}) is after the last (${state.to}). Choose a first year no later than the last.`));
    return;
  }
  const from = indexOfYear(p.start, state.from), to = indexOfYear(p.start, state.to + 1) - 1;
  const scores = MODELS.map((m) => scorecard(p.logs, records, h, m.key, { from, to }));
  const s0 = scores[0];
  if (!s0.n) {
    const firstOrigin = monthLabel(p.start, MIN_FIT - 1, false);
    const tooEarly = indexOfYear(p.start, state.to + 1) - 1 < MIN_FIT - 1;
    verdict.replaceChildren(note("warn", `No forecast made ${months(h)} ahead in ${state.from === state.to ? state.from : `${state.from} to ${state.to}`} has an outcome to score. This pair's first forecast is made at the end of ${firstOrigin} and its latest rate is for ${monthLabel(p.start, n - 1, false)}. ${tooEarly ? `Choose years from ${monthLabel(p.start, MIN_FIT - 1).slice(-4)} on.` : "Choose earlier years or a shorter horizon."}`));
    return;
  }
  scored = scores;
  const firstMade = monthLabel(p.start, s0.rows[0].t, false), lastMade = monthLabel(p.start, s0.rows[s0.n - 1].t, false);
  const rwMiss = asPercent(s0.naive);
  const line = (s, m) => {
    // Two decimal places, as in the table below, unless that would print the two misses as the same number.
    const places = [2, 3, 4].find((k) => fmt.pct(asPercent(s.model), k) !== fmt.pct(rwMiss, k)) ?? 2;
    const shown = (x) => Number(fmt.pct(x, places).replace("%", "").split(",").join(""));
    const gap = Math.abs(shown(asPercent(s.model)) - shown(rwMiss)).toFixed(places);
    const points = `${gap} percentage ${Number(gap) === 1 ? "point" : "points"}`;
    const how = s.verdict === "ahead" ? `ahead by ${points}` : s.verdict === "behind" ? `behind by ${points}` : "level (the two differ by less than one part in 2,000)";
    const sig = Number.isNaN(s.dm.p) ? "the test cannot be computed" : s.dm.p < 0.05 ? `Diebold–Mariano p = ${pFmt(s.dm.p)}, unlikely to be chance alone at the 5% level` : `Diebold–Mariano p = ${pFmt(s.dm.p)}, which chance could easily produce`;
    return `${m.name} missed by ${fmt.pct(asPercent(s.model), places)} against ${fmt.pct(rwMiss, places)} for the random walk: ${how} (${sig}).`;
  };
  const wins = scores.filter((s) => s.verdict === "ahead" && s.dm.p < 0.05);
  const summary = wins.length
    ? `${wins.map((s) => MODELS.find((m) => m.key === s.key).name).join(" and ")} beat the random walk by more than chance would usually allow. But three models were tested: if none had any skill, each would still do this about 2.5% of the time, so the chance that at least one of the three does lies between 2.5% and 7.5%, depending on how alike their forecasts are.`
    : "No model beat the random walk by more than chance would easily produce.";
  verdict.replaceChildren(note(wins.length ? "" : "warn",
    `${plural(s0.n, "forecast was", "forecasts were")} made ${months(h)} ahead${s0.n > 1 ? `, one at the end of each month from ${firstMade} to ${lastMade}, each from the rates known then` : `, at the end of ${firstMade}, from the rates known then`}. `,
    el("strong", { text: summary }), " ", scores.map((s, j) => line(s, MODELS[j])).join(" ")));

  scoreBox.replaceChildren(listTable({
    caption: `Average miss ${months(h)} ahead, forecasts made ${state.from === state.to ? `in ${state.from}` : `${state.from} to ${state.to}`} (${plural(s0.n, "forecast", "forecasts")})`,
    columns: [
      { label: "Model", get: (r) => r.name },
      { label: "Average miss", get: (r) => fmt.pct(asPercent(r.s ? r.s.model : s0.naive), 2), num: true },
      { label: "As % of random walk's", get: (r) => (r.s ? `${fmt.num((r.s.model / s0.naive) * 100, 1)}%` : "100%"), num: true },
      { label: "Closer than random walk", get: (r) => (r.s ? fmt.pct(r.s.closer, 0) : "–"), num: true },
      { label: "Diebold–Mariano p", get: (r) => (r.s ? pFmt(r.s.dm.p) : "–"), num: true },
    ],
    rows: [{ name: "Random walk", s: null }, ...MODELS.map((m, j) => ({ name: m.name, s: scores[j] }))],
  }));

  const skip = s0.n >= 24 ? 11 : 0;
  const runs = scores.map((s) => running(s.rows).slice(skip));
  const all = runs.flat().map((r) => r.ratio * 100);
  const lo = Math.min(100, ...all), hi = Math.max(100, ...all), pad = Math.max(1, (hi - lo) * 0.08);
  runBox.hidden = false;
  runChart.update({
    title: "Running scorecard: each model's average miss so far, against the random walk's",
    subtitle: `After each forecast date, a model's average miss since ${firstMade} as a percentage of the random walk's over the same dates. Below 100% the model is ahead so far.${skip ? " The lines start at the twelfth forecast." : ""}`,
    label: `Line chart of each model's running average miss as a percentage of the random walk's, ${months(h)} ahead`,
    x: { format: xLabel, label: "Forecast made at the end of" },
    y: { label: "Miss as % of the random walk's", format: (v) => `${fmt.num(v, hi - lo < 4 ? 1 : 0)}%`, domain: [lo - pad, hi + pad] },
    series: MODELS.map((m, j) => ({ name: m.name, type: "line", data: runs[j].map((r) => [xOf(p.start, r.t), r.ratio * 100]), color: [1, 2, 6][j] })),
    marks: [{ type: "hline", y: 100, text: "Level with the random walk" }],
  });

  const rows = s0.rows.slice(-6).reverse();
  const byT = new Map(records.map((r) => [r.t, r]));
  recentBox.replaceChildren(listTable({
    caption: `The latest ${plural(rows.length, "scored forecast", "scored forecasts")}, ${months(h)} ahead (${state.quote} per ${state.base})`,
    columns: [
      { label: "Made at the end of", get: (r) => monthLabel(p.start, r.t) },
      { label: "For", get: (r) => monthLabel(p.start, r.target) },
      { label: "Outcome", get: (r) => rate(Math.exp(r.actual)), num: true },
      ...ALL.map((m) => ({ label: m.name, get: (r) => rate(Math.exp(byT.get(r.t)[m.key][h - 1])), num: true })),
    ],
    rows,
  }));
  csvButton.disabled = false;
}

function exportCsv() {
  if (!scored.length || !current) return;
  const { p, records } = current;
  const h = state.h;
  const byT = new Map(records.map((r) => [r.t, r]));
  const k0 = (() => { const [y, m] = p.start.split("-").map(Number); return y * 12 + m - 1; })();
  const lines = [["made_end_of", "for_month", "horizon_months", "pair", "outcome", ...ALL.map((m) => `${m.key}_forecast`)].join(",")];
  for (const r of scored[0].rows) {
    const rec = byT.get(r.t);
    lines.push([keyOf(k0 + r.t), keyOf(k0 + r.target), h, `${state.base}/${state.quote}`, Math.exp(r.actual).toPrecision(8), ...ALL.map((m) => Math.exp(rec[m.key][h - 1]).toPrecision(8))].join(","));
  }
  download(`fx-scorecard-${state.base}${state.quote}-${h}m-${state.from}-${state.to}.csv`, lines.join("\n") + "\n", "text/csv");
}

/* ---------- every currency against the dollar, one currency per slice ---------- */
let scanJob = 0, scanKey = "";
function runScan() {
  const key = `${state.h}|${state.window}|${state.from}|${state.to}`;
  if (key === scanKey) return; // the scan does not depend on the pair
  scanKey = key;
  const id = ++scanJob;
  scanSummary.replaceChildren(); scanBox.replaceChildren(); scanStatus.textContent = "";
  if (state.from > state.to) { scanProgress.textContent = "Choose a first year no later than the last to score every currency."; return; }
  const done = [];
  const step = () => {
    if (id !== scanJob) return;
    const c = FX.currencies[done.length];
    const one = scanAgainstDollar({ ...FX, currencies: [c] }, state.h, { window: WINDOWS[state.window].months, fromYear: state.from, toYear: state.to })[0];
    done.push(one);
    if (done.length < FX.currencies.length) { scanProgress.textContent = `Scoring every currency against the dollar: ${done.length} of ${FX.currencies.length}.`; setTimeout(step, 0); return; }
    scanProgress.textContent = "";
    showScan(done);
  };
  scanProgress.textContent = `Scoring every currency against the dollar: 0 of ${FX.currencies.length}.`;
  setTimeout(step, 0);
}

function showScan(scan) {
  const rows = scan.filter((r) => r.scores[0].n > 0);
  const tests = rows.length * MODELS.length;
  const count = (f) => rows.reduce((k, r) => k + r.scores.filter(f).length, 0);
  const ahead = count((s) => s.verdict === "ahead"), sigAhead = count((s) => s.verdict === "ahead" && s.dm.p < 0.05), sigBehind = count((s) => s.verdict === "behind" && s.dm.p < 0.05);
  const span = state.from === state.to ? `made in ${state.from}` : `made ${state.from} to ${state.to}`;
  const text = rows.length
    ? `${months(state.h)} ahead, forecasts ${span}: of ${plural(tests, "comparison", "comparisons")} (${plural(rows.length, "currency", "currencies")}, three models each), a model came out ahead of the random walk in ${fmt.int(ahead)} and was ahead by more than chance would usually allow (Diebold–Mariano, 5% level) in ${fmt.int(sigAhead)}. The random walk was ahead by that much in ${fmt.int(sigBehind)}. If no model had any skill, about ${fmt.num(tests * 0.025, 1)} of the ${fmt.int(tests)} would still come out "significantly ahead" by luck.`
    : `No currency has a forecast ${months(state.h)} ahead to score in these years.`;
  scanSummary.replaceChildren(note("", text));
  scanStatus.textContent = text;
  const cell = (s) => (s.n ? `${fmt.num((s.model / s.naive) * 100, 1)}%${s.dm.p < 0.05 ? (s.verdict === "ahead" ? " (better)" : s.verdict === "behind" ? " (worse)" : "") : ""}` : "–");
  scanBox.replaceChildren(listTable({
    caption: "Each model's average miss as a percentage of the random walk's: below 100% is better. \"Better\" or \"worse\" marks a gap the Diebold–Mariano test finds unlikely to be chance at the 5% level.",
    columns: [
      { label: "Currency", get: (r) => `${r.code}, ${r.name}` },
      { label: "Forecasts", get: (r) => fmt.int(r.scores[0].n), num: true },
      ...MODELS.map((m, j) => ({ label: m.name, get: (r) => cell(r.scores[j]), num: true })),
    ],
    rows: scan,
  }));
}

update();
