// Day 61: Gold Price Forecaster. Interface.
import { $, el, fmt, mount, slider, select, stat, note, chart, button, download } from "../kit/kit.js";
import { GOLD } from "./data.js";
import {
  MAX_H, Z80, Z95, MODELS, orderName, toLogs, selectArima, forecastArima, roller, originsFor, scorecard, running,
  orderShares, asPercent, monthAt, monthLabel, indexOfYear,
} from "./logic.js";

mount();

const LOGS = toLogs(GOLD.values);
const N = LOGS.length;
const ORIGINS = originsFor(N);
const firstYear = monthAt(GOLD.start, ORIGINS[0]).year;
const lastYear = monthAt(GOLD.start, N - 1).year;
const YEARS = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i);
const WINDOWS = { all: { label: "Every month since January 1975", months: Infinity }, w20: { label: "The latest 20 years", months: 240 }, w10: { label: "The latest 10 years", months: 120 } };
const dollars = (v) => `$${fmt.int(v)}`;
const xOf = (i) => { const d = monthAt(GOLD.start, i); return d.year + d.month / 12; };
const xLabel = (v) => { const k = Math.round(v * 12); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][((k % 12) + 12) % 12]} ${Math.floor(k / 12)}`; };
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
const months = (h) => plural(h, "month", "months");

const state = { h: 12, model: "auto", window: "all", from: firstYear, to: lastYear };

/* ---------- controls ---------- */
const horizon = slider({
  label: "Horizon", min: 1, max: MAX_H, step: 1, value: state.h,
  format: (h) => `${months(h)} ahead`,
  hint: "How far ahead to forecast. The scorecard below scores past forecasts made this far ahead.",
  onInput: (h) => { state.h = h; showForecast(); showScore(); },
});
const modelSel = select({
  label: "Model", value: state.model,
  options: Object.entries(MODELS).map(([value, m]) => ({ value, label: m.label })),
  hint: "The AICc choice tries twelve ARIMA models at every date and keeps the one with the lowest AICc.",
  onChange: (v) => { state.model = v; refresh(); },
});
const windowSel = select({
  label: "Fit each forecast on", value: state.window,
  options: Object.entries(WINDOWS).map(([value, w]) => ({ value, label: w.label })),
  hint: "Every forecast, past or present, uses only the prices up to its own date.",
  onChange: (v) => { state.window = v; refresh(); },
});
const yearOptions = YEARS.map((y) => ({ value: y, label: String(y) }));
const fromSel = select({ label: "Score forecasts made from", value: state.from, options: yearOptions, onChange: (v) => { state.from = Number(v); showScore(); } });
const toSel = select({ label: "to", value: state.to, options: yearOptions, onChange: (v) => { state.to = Number(v); showScore(); } });
const yearsHint = el("div", { class: "hint", text: `The first forecast was made at the end of January ${firstYear}, with ten years of prices behind it.` });
const about = el("div", { class: "hint source-note" },
  el("strong", { text: "Gold, US$ per troy ounce. " }),
  `Monthly averages of daily prices, ${monthLabel(GOLD.start, 0, false)} to ${monthLabel(GOLD.start, N - 1, false)}, not adjusted for inflation. The World Bank's definition: "${GOLD.definition}". `,
  `Source: ${GOLD.source.name}, ${GOLD.vintage.replace("Updated on", "updated")}, ${GOLD.source.licence}, retrieved ${fmt.date(GOLD.retrieved)}.`);
const controls = el("div", { class: "controls" }, horizon.el, modelSel.el, windowSel.el, el("div", { class: "field" }, el("div", { class: "g61-years" }, fromSel.el, toSel.el), yearsHint), about);

/* ---------- outputs ---------- */
const sLatest = stat("Latest price");
const sForecast = stat("Forecast");
const sRange = stat("80% band");
const sModel = stat("Model now");
const status = el("p", { class: "sr-only", role: "status" });
const advice = el("p", { class: "small muted", text: "An illustration of a forecasting method, not investment advice: no forecast here should be read as a reason to buy or sell gold." });
const forecastBox = el("div");
const scoreHead = el("h2", { text: "Scorecard: past forecasts against the latest price" });
const progress = el("p", { class: "small muted" });
const scoreStatus = el("p", { class: "sr-only", role: "status" });
const verdict = el("div");
const scoreStats = el("div", { class: "stats" });
const runBox = el("div");
const ordersNote = el("p", { class: "small muted" });
const recentBox = el("div", { class: "g61-recent" });
const csvButton = button("Download every scored forecast (CSV)", () => exportCsv(), { small: true });
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sLatest.el, sForecast.el, sRange.el, sModel.el), status, advice, forecastBox,
  el("div", { class: "panel g61-stack" }, scoreHead, progress, scoreStatus, verdict, scoreStats, runBox, ordersNote, recentBox, el("div", { class: "row" }, csvButton)));
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const priceChart = chart(forecastBox, { series: [], height: 340 });
const runChart = chart(runBox, { series: [], height: 260 });

/* ---------- the live forecast: one fit on the latest prices ---------- */
let live = null;
function fitLive() {
  const months = WINDOWS[state.window].months;
  const y = LOGS.subarray(Math.max(0, N - months), N);
  const { best } = selectArima(y, MODELS[state.model].candidates);
  live = { fit: best, f: forecastArima(best, MAX_H) };
}

function describeFit(fit) {
  const parts = [];
  fit.phi.forEach((v, i) => parts.push(`φ${fit.phi.length > 1 ? i + 1 : ""} = ${fmt.num(v, 2)}`));
  fit.theta.forEach((v, i) => parts.push(`θ${fit.theta.length > 1 ? i + 1 : ""} = ${fmt.num(v, 2)}`));
  if (fit.drift) parts.push(`drift ${fmt.signed(fit.mu * 100, 2)}% a month`);
  parts.push(`σ = ${fmt.num(Math.sqrt(fit.sigma2) * 100, 1)}% a month`);
  return parts.join(", ");
}

function showForecast() {
  const { fit, f } = live;
  const h = state.h;
  const last = GOLD.values[N - 1];
  const target = monthLabel(GOLD.start, N - 1 + h, false);
  const mid = Math.exp(f.mid[h - 1]), sd = f.sd[h - 1];
  const lo80 = Math.exp(f.mid[h - 1] - Z80 * sd), hi80 = Math.exp(f.mid[h - 1] + Z80 * sd);
  const lo95 = Math.exp(f.mid[h - 1] - Z95 * sd), hi95 = Math.exp(f.mid[h - 1] + Z95 * sd);
  sLatest.set(dollars(last), `US$ per troy ounce, average for ${monthLabel(GOLD.start, N - 1, false)}`);
  sForecast.set(dollars(mid), `median for ${target}, ${fmt.signed((mid / last - 1) * 100, 1)}% on the latest`);
  sRange.set(`${dollars(lo80)} to ${dollars(hi80)}`, `95% band ${dollars(lo95)} to ${dollars(hi95)}`);
  sModel.set(orderName(fit).replace(" with drift", " + drift"), describeFit(fit));
  status.textContent = `Forecast for ${target}, ${months(h)} ahead: ${dollars(mid)} per troy ounce, 80% band ${dollars(lo80)} to ${dollars(hi80)}, 95% band ${dollars(lo95)} to ${dollars(hi95)}. Model ${orderName(fit)}.`;

  const first = Math.max(0, N - 120);
  const lastX = xOf(N - 1);
  const ahead = Array.from({ length: h }, (_, k) => k + 1);
  const band = (z) => [[lastX, last, last], ...ahead.map((k) => [xOf(N - 1 + k), Math.exp(f.mid[k - 1] - z * f.sd[k - 1]), Math.exp(f.mid[k - 1] + z * f.sd[k - 1])])];
  priceChart.update({
    title: `Gold: the latest ten years and the forecast ${months(h)} ahead`,
    subtitle: "US$ per troy ounce, monthly average. The forecast line is a median; the bands are the model's 80% and 95% ranges.",
    label: `Line chart of the monthly gold price from ${monthLabel(GOLD.start, first, false)} with a ${h}-month forecast and its bands`,
    x: { format: xLabel, label: "Month" },
    y: { label: "US$ per troy ounce", format: (v) => fmt.int(v) },
    series: [
      { name: "95% band", type: "range", data: band(Z95), color: "#8a94a3", opacity: 0.22 },
      { name: "80% band", type: "range", data: band(Z80), color: 1, opacity: 0.3 },
      { name: "Price", type: "line", data: GOLD.values.slice(first).map((v, i) => [xOf(first + i), v]), color: 0, width: 1.8 },
      { name: "Forecast (median)", type: "line", data: [[lastX, last], ...ahead.map((k) => [xOf(N - 1 + k), Math.exp(f.mid[k - 1])])], color: 1, dash: true },
    ],
    marks: [{ type: "span", x0: lastX, x1: xOf(N - 1 + h) }],
  });
}

/* ---------- the scorecard: one fit at every past date, in slices ---------- */
const cache = new Map();
let job = 0;
let scored = null;

function refresh() {
  fitLive();
  showForecast();
  const key = `${state.model}|${state.window}`;
  if (cache.has(key)) { showScore(); return; }
  const id = ++job;
  const run = roller(LOGS, state.model, ORIGINS, { window: WINDOWS[state.window].months });
  verdict.replaceChildren();
  scoreStats.replaceChildren();
  runBox.hidden = true; recentBox.replaceChildren(); ordersNote.textContent = ""; csvButton.disabled = true;
  const slice = () => {
    if (id !== job) return; // a control changed: this run is abandoned
    const t0 = performance.now();
    while (!run.done && performance.now() - t0 < 30) run.next();
    if (!run.done) {
      progress.textContent = `Refitting the model at every past date: ${fmt.int(run.records.length)} of ${fmt.int(ORIGINS.length)} done.`;
      setTimeout(slice, 0);
      return;
    }
    cache.set(key, run.records);
    showScore();
  };
  progress.textContent = `Refitting the model at every past date: 0 of ${fmt.int(ORIGINS.length)} done.`;
  setTimeout(slice, 0);
}

function showScore() {
  const records = cache.get(`${state.model}|${state.window}`);
  if (!records) return; // still running; it calls back when done
  progress.textContent = "";
  csvButton.disabled = true;
  if (state.from > state.to) {
    scored = null;
    verdict.replaceChildren(note("bad", `The first year (${state.from}) is after the last (${state.to}). Choose a first year no later than the last.`));
    scoreStats.replaceChildren(); runBox.hidden = true; recentBox.replaceChildren(); ordersNote.textContent = "";
    return;
  }
  const h = state.h;
  const from = Math.max(ORIGINS[0], indexOfYear(GOLD.start, state.from)), to = indexOfYear(GOLD.start, state.to + 1) - 1;
  const s = scorecard(LOGS, records, h, { from, to });
  scored = s;
  if (!s.n) {
    verdict.replaceChildren(note("warn", `No forecast made ${months(h)} ahead in ${state.from === state.to ? state.from : `${state.from} to ${state.to}`} has an outcome yet: the latest price is for ${monthLabel(GOLD.start, N - 1, false)}. Choose earlier years or a shorter horizon.`));
    scoreStats.replaceChildren(); runBox.hidden = true; recentBox.replaceChildren(); ordersNote.textContent = "";
    return;
  }
  const name = state.model === "auto" ? "The ARIMA forecast" : state.model === "ma1" ? "The ARIMA(0,1,1) forecast" : "The random walk with drift";
  // One decimal place, unless that would print the two misses as the same number.
  const places = [1, 2, 3, 4].find((k) => fmt.pct(asPercent(s.model), k) !== fmt.pct(asPercent(s.naive), k)) ?? 1;
  const pct = (m) => fmt.pct(asPercent(m), places);
  const shown = (m) => Number(pct(m).replace("%", "").split(",").join(""));
  const gap = Math.abs(shown(s.model) - shown(s.naive)).toFixed(places);
  const points = `${gap} percentage ${Number(gap) === 1 ? "point" : "points"}`;
  const firstMade = monthLabel(GOLD.start, s.rows[0].t, false), lastMade = monthLabel(GOLD.start, s.rows[s.n - 1].t, false);
  const outcome = s.verdict === "ahead" ? `${name} came out ahead: its average miss was ${points} smaller.`
    : s.verdict === "behind" ? `${name} did worse: its average miss was ${points} larger.`
      : `The two did equally well: their average misses differ by less than one part in 2,000.`;
  const p = s.dm.p;
  const dmText = Number.isNaN(p) ? "The Diebold–Mariano test cannot be computed here, because the difference between the two misses never varies."
    : s.dm.stat === 0 && p === 1 ? "The two forecasts were the same every time, so there is nothing to test."
      : p < 0.05 ? `The Diebold–Mariano test gives p = ${p < 0.001 ? "below 0.001" : fmt.num(p, 3)}: a gap this size would rarely arise by chance if the two were equally accurate (5% level).`
        : `The Diebold–Mariano test gives p = ${fmt.num(p, 3)}: a gap this size could easily arise by chance if the two were equally accurate (5% level).`;
  const sentences = [
    s.n === 1 ? `One forecast was made ${months(h)} ahead, at the end of ${firstMade}, from the prices known then, and scored on the outcome.`
      : `${fmt.int(s.n)} forecasts were made ${months(h)} ahead, one at the end of each month from ${firstMade} to ${lastMade}, each from the prices known that month, and scored on the outcome.`,
    `${name} missed by ${pct(s.model)} on average; the naive forecast, the latest price unchanged, missed by ${pct(s.naive)}.`,
    outcome,
    dmText,
  ];
  verdict.replaceChildren(note(s.verdict === "ahead" && p < 0.05 ? "good" : s.verdict === "ahead" ? "" : "warn", `${sentences[0]} ${sentences[1]} `, el("strong", { text: sentences[2] }), ` ${sentences[3]}`));
  scoreStatus.textContent = `Scorecard, ${months(h)} ahead. ${sentences.slice(1).join(" ")}`;

  const tiles = [
    stat("Forecasts scored", fmt.int(s.n), `${months(h)} ahead, ${state.from === state.to ? `made in ${state.from}` : `made ${state.from} to ${state.to}`}`),
    stat("Closer than naive", fmt.pct(s.closer, 0), "of forecasts, strictly"),
    stat("80% band held", fmt.pct(s.coverage80, 0), `the outcome; 95% band: ${fmt.pct(s.coverage95, 0)}`),
  ];
  scoreStats.replaceChildren(...tiles.map((t) => t.el));

  const run = running(s.rows);
  runBox.hidden = false;
  // The first few averages rest on a handful of forecasts and swing widely, so the line starts at the twelfth.
  const skip = run.length >= 24 ? 11 : 0;
  const shownRun = run.slice(skip);
  const ratios = shownRun.map((r) => r.ratio * 100);
  const lo = Math.min(100, ...ratios), hi = Math.max(100, ...ratios), pad = Math.max(1, (hi - lo) * 0.08);
  runChart.update({
    title: "Running scorecard: the model's average miss so far, against the naive forecast's",
    subtitle: `After each forecast date, the average miss of the model's forecasts made ${months(h)} ahead since ${firstMade}, as a percentage of the naive forecast's average miss over the same dates. Below 100% the model is ahead so far.${skip ? " The line starts at the twelfth forecast, before which a handful of forecasts swing it widely." : ""}`,
    label: `Line chart of the model's running average miss as a percentage of the naive forecast's, ${months(h)} ahead`,
    x: { format: xLabel, label: "Forecast made at the end of" },
    y: { label: "Model's miss as % of naive's", format: (v) => `${fmt.num(v, hi - lo < 4 ? 1 : 0)}%`, domain: [lo - pad, hi + pad] },
    series: [{ name: "Model's average miss so far", type: "line", data: shownRun.map((r, i) => [xOf(r.t), ratios[i]]), color: 0 }],
    marks: [{ type: "hline", y: 100, text: "Level with the naive forecast" }],
  });

  const chosen = records.filter((r) => r.t >= from && r.t <= to && r.t + h < N);
  const shares = orderShares(chosen);
  ordersNote.textContent = state.model === "auto"
    ? `Orders chosen at these dates: ${shares.slice(0, 4).map((o) => `${o.name} ${fmt.pct(o.share, 0)}`).join(", ")}${shares.length > 4 ? `, and ${plural(shares.length - 4, "other", "others")}` : ""}.`
    : "";

  const recent = s.rows.slice(-6).reverse(); // the rest are in the download
  recentBox.replaceChildren(listTable({
    caption: `The latest ${plural(recent.length, "scored forecast", "scored forecasts")}, ${months(h)} ahead (US$ per troy ounce)`,
    columns: [
      { label: "Made at the end of", get: (r) => monthLabel(GOLD.start, r.t) },
      { label: "For", get: (r) => monthLabel(GOLD.start, r.target) },
      { label: "Model", get: (r) => dollars(Math.exp(r.mid)), num: true },
      { label: "Naive", get: (r) => dollars(Math.exp(r.naive)), num: true },
      { label: "Outcome", get: (r) => dollars(Math.exp(r.actual)), num: true },
      { label: "Closer", get: (r) => (r.model < r.naiveMiss - 1e-12 ? "Model" : r.naiveMiss < r.model - 1e-12 ? "Naive" : "Tie") },
    ],
    rows: recent,
  }));
  csvButton.disabled = false;
}

// A table that turns into a list of labelled lines when its box is narrow (see the page's <style>).
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl g61-rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {},
      columns.map((c, k) => el(k === 0 ? "th" : "td", { scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

function exportCsv() {
  if (!scored || !scored.n) return;
  const h = state.h;
  const key = (i) => { const d = monthAt(GOLD.start, i); return `${d.year}-${String(d.month + 1).padStart(2, "0")}`; };
  const lines = [["made_end_of", "for_month", "horizon_months", "model", "order_chosen", "forecast_usd", "band80_low_usd", "band80_high_usd", "naive_usd", "outcome_usd", "model_miss_log", "naive_miss_log"].join(",")];
  const records = new Map(cache.get(`${state.model}|${state.window}`).map((r) => [r.t, r]));
  for (const r of scored.rows) {
    const sd = records.get(r.t).sd[h - 1];
    lines.push([key(r.t), key(r.target), h, state.model, orderName(r.order), Math.exp(r.mid).toFixed(2), Math.exp(r.mid - Z80 * sd).toFixed(2), Math.exp(r.mid + Z80 * sd).toFixed(2),
      Math.exp(r.naive).toFixed(0), Math.exp(r.actual).toFixed(0), r.model.toFixed(6), r.naiveMiss.toFixed(6)].join(","));
  }
  download(`gold-scorecard-${h}m-${state.model}-${state.from}-${state.to}.csv`, lines.join("\n") + "\n", "text/csv");
}

refresh();
