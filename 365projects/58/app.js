// Day 58: Commodity Seasonality Decomposer. Interface.
import { $, el, fmt, mount, slider, select, checkbox, stat, note, table, bars, chart, debounce } from "../kit/kit.js";
import { PRICES } from "./data.js";
import { MONTHS, PERIOD, HORIZON, windowOf, decompose, monthAt, monthLabel, backtestOrigins, backtestAt, summarise, asPercent } from "./logic.js";

mount();

const SPANS = [7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35]; // the last slider stop, one past these, is the fixed season
const FIXED = SPANS.length;
const STARTS = { fpma: [2014], pink: [1980, 1990, 2000, 2010] };
const byId = (id) => PRICES.series.find((s) => s.id === id);
const short = (s) => s.name.split(",")[0];
const symbol = (s) => s.unit.split(" ")[0];
const perUnit = (s) => s.unit.split(" ").slice(1).join(" ");
// Published prices are shown as published: two decimal places where the source gives two anywhere in the series, else one.
// What the model produces is given to about three figures, with the same number of decimals down a whole column.
const sourceDecimals = (s) => (s.values.some((v) => Math.abs(v * 10 - Math.round(v * 10)) > 1e-6) ? 2 : 1);
const modelDecimals = (s) => { const v = s.values[s.values.length - 1]; return v >= 100 ? 0 : v >= 10 ? 1 : 2; };
const asPublished = (v, s) => `${symbol(s)}${fmt.num(v, sourceDecimals(s))}`;
const modelled = (v, s) => `${symbol(s)}${fmt.num(v, modelDecimals(s))}`;
const effect = (factor, d = 0) => `${fmt.num(Math.abs(factor - 1) * 100, d)}% ${factor >= 1 ? "above" : "below"}`;

const state = { id: "onion", fromPink: 2000, span: FIXED, robust: true };
const current = () => {
  const s = byId(state.id);
  return { s, w: windowOf(s, s.source === "fpma" ? STARTS.fpma[0] : state.fromPink) };
};
const options = () => (state.span === FIXED ? { periodic: true, robust: state.robust } : { seasonal: SPANS[state.span], robust: state.robust });

/* ---------- controls ---------- */
const commodity = select({
  label: "Commodity", value: state.id,
  options: PRICES.series.map((s) => ({ value: s.id, label: `${s.name} (${s.unit})` })),
  onChange: (v) => { state.id = v; fillStarts(); update(); },
});
const from = select({ label: "Use prices from", options: [], onChange: (v) => { state.fromPink = Number(v); update(); } });
const fromHint = el("div", { class: "hint" });
from.el.append(fromHint);
function fillStarts() {
  const s = byId(state.id);
  const years = STARTS[s.source];
  from.input.replaceChildren(...years.map((y) => el("option", { value: y, text: `January ${y}` })));
  from.value = s.source === "fpma" ? years[0] : state.fromPink;
  from.input.disabled = years.length < 2;
  fromHint.textContent = s.source === "fpma"
    ? "FAO's series for India begins in January 2014, so there is nothing earlier to choose."
    : "A later start fits the season to recent years only. The held-out test always covers the latest ten years it can.";
}
const spanSlider = slider({
  label: "Season", min: 0, max: FIXED, step: 1, value: state.span,
  format: (i) => (i === FIXED ? "the same every year" : `may drift, span ${SPANS[i]} years`),
  hint: "The span is how many years of one calendar month are smoothed together. A short span lets the season change quickly and can mistake noise for season.",
  onInput: debounce((i) => { state.span = i; update(); }, 120),
});
const robustBox = checkbox({ label: "Robust fit: months that fit badly count for less", checked: state.robust, onChange: (on) => { state.robust = on; update(); } });
const about = el("div", { class: "hint source-note" });
const controls = el("div", { class: "controls" }, commodity.el, from.el, spanSlider.el,
  el("div", { class: "field" }, robustBox.el, el("div", { class: "hint", text: "With it on, a price spike is left in the remainder instead of bending the season and the trend." })),
  about);

/* ---------- outputs ---------- */
const sLatest = stat("Latest price");
const sHigh = stat("Seasonal high");
const sLow = stat("Seasonal low");
const sStrength = stat("Strength of the season");
const status = el("p", { class: "sr-only", role: "status" });
const priceBox = el("div"), seasonBox = el("div"), noiseBox = el("div");
const forecastBox = el("div", { class: "forecast-table" });
const testHead = el("h2", { text: "Does the forecast beat a naive guess?" });
const progress = el("p", { class: "small muted" });
const verdict = el("div");
const testStatus = el("p", { class: "sr-only", role: "status" });
const missNote = el("p", { class: "small muted", text: "A miss is the ratio between forecast and outcome, measured in logs so that 25% too high and 20% too low count the same. The average is turned back into a percentage." });
const errorBox = el("div");
const rankHead = el("h2", { text: "Which of the ten have a season at all?" });
const rankNote = el("p", { class: "small muted" });
const rankBox = el("div");

const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sLatest.el, sHigh.el, sLow.el, sStrength.el), status,
  priceBox, seasonBox, noiseBox, forecastBox,
  el("div", { class: "panel stack" }, testHead, progress, verdict, testStatus, missNote, errorBox),
  el("div", { class: "panel stack" }, rankHead, rankNote, rankBox));
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const xOf = (start, i) => { const d = monthAt(start, i); return d.year + d.month / 12; };
const xLabel = (v) => { const k = Math.round(v * 12); return `${MONTHS[((k % 12) + 12) % 12].slice(0, 3)} ${Math.floor(k / 12)}`; };
const pctAxis = (v) => `${fmt.signed(v, 0)}%`;
const priceChart = chart(priceBox, { series: [], height: 340 });
const seasonChart = chart(seasonBox, { series: [], height: 260 });
const noiseChart = chart(noiseBox, { series: [], height: 240 });
const errorChart = chart(errorBox, { series: [], height: 260 });
const rank = bars(rankBox, { items: [], max: 1, format: (v) => fmt.num(v, 2) });

/* ---------- the decomposition and the forecast ---------- */
let job = 0;

function update() {
  const { s, w } = current();
  const opts = options();
  const d = decompose(w.values, opts);
  const n = w.values.length;
  const firstMonth = monthLabel(w.start, 0, false), lastMonth = monthLabel(w.start, n - 1, false);
  const src = PRICES.sources[s.source];
  about.replaceChildren(
    el("strong", { text: `${s.name}. ` }), `${s.detail} Monthly averages, not adjusted for inflation, ${firstMonth} to ${lastMonth}. `,
    `Source: ${src.name}, ${src.licence}, retrieved ${fmt.date(PRICES.retrieved)}.`);

  const high = d.latest[d.peak - (n - PERIOD)], low = d.latest[d.trough - (n - PERIOD)];
  const monthName = (i) => MONTHS[monthAt(w.start, i).month];
  sLatest.set(asPublished(w.values[n - 1], s), `${perUnit(s)}, ${lastMonth}`);
  const drifting = !opts.periodic; // a drifting season has a different shape each year: the tiles describe the latest one
  sHigh.set(monthName(d.peak), `${effect(high)} the trend${drifting ? ", latest twelve months" : ""}`);
  sLow.set(monthName(d.trough), `${effect(low)} the trend${drifting ? ", latest twelve months" : ""}`);
  sStrength.set(fmt.num(d.strength.seasonal, 2), "0 is all noise, 1 is all season");

  // Price, trend and forecast.
  const lastX = xOf(w.start, n - 1);
  const fx = d.forecast.map((p) => xOf(w.start, n - 1 + p.h));
  priceChart.update({
    title: `${s.name}: price, trend and forecast`,
    subtitle: `${s.unit}. The forecast is a median and the band is the range the model gives an 80% chance.`,
    label: `Line chart of the monthly price of ${s.name} with its trend and a twelve-month forecast`,
    x: { format: xLabel, label: "Month" },
    y: { label: s.unit, format: (v) => fmt.sig(v, 3) }, // tick marks and hover values: three figures
    series: [
      { name: "80% range", type: "range", data: [[lastX, w.values[n - 1], w.values[n - 1]], ...d.forecast.map((p, k) => [fx[k], p.low, p.high])], color: 1, opacity: 0.2 },
      { name: "Price", type: "line", data: w.values.map((v, i) => [xOf(w.start, i), v]), color: 0, width: 1.6 },
      { name: "Trend", type: "line", data: d.trendLevel.map((v, i) => [xOf(w.start, i), v]), color: "#16233b", width: 1.6 },
      { name: "Forecast", type: "line", data: [[lastX, w.values[n - 1]], ...d.forecast.map((p, k) => [fx[k], p.mid])], color: 1, dash: true },
    ],
    marks: [{ type: "span", x0: lastX, x1: fx[fx.length - 1] }],
  });

  // The season, month by month in calendar order.
  const calendar = (factors, firstIndex) => MONTHS.map((_, m) => {
    const k = (m - monthAt(w.start, firstIndex).month + PERIOD) % PERIOD;
    return [MONTHS[m].slice(0, 3), (factors[k] - 1) * 100];
  });
  const fixed = Boolean(opts.periodic);
  const years = Math.ceil(n / PERIOD); // the most values any one calendar month has
  const logsNote = "The price is split in logs, so the parts multiply: +25% is 1.25 times the trend.";
  seasonChart.update({
    title: "Season: how far each month sits above or below the trend",
    subtitle: fixed ? `One pattern is fitted to every year in the window. ${logsNote}`
      : `The pattern may drift. Latest twelve months (to ${lastMonth}) against the first twelve (from ${firstMonth}). ${logsNote}`
        + (opts.seasonal > years ? ` A span of ${opts.seasonal} is longer than the ${years} years here, so every year is used and the nearest count most.` : ""),
    label: `Bar chart of the seasonal effect on the price of ${s.name} in each month of the year`,
    x: { type: "band", categories: MONTHS.map((m) => m.slice(0, 3)), label: "Month of the year" },
    y: { format: pctAxis, label: "Percent above or below the trend", zero: true },
    series: fixed ? [{ name: "Seasonal effect", type: "bars", data: calendar(d.latest, n - PERIOD), color: 0 }]
      : [{ name: "Latest twelve months", type: "bars", data: calendar(d.latest, n - PERIOD), color: 0 },
         { name: "First twelve months", type: "bars", data: calendar(d.seasonFactor.slice(0, PERIOD), 0), color: "#8a94a3" }],
  });

  // The remainder, with its three largest months named.
  const noise = d.remainderFactor.map((v, i) => ({ i, pct: (v - 1) * 100 }));
  const biggest = [...noise].sort((a, b) => Math.abs(d.remainder[b.i]) - Math.abs(d.remainder[a.i])).slice(0, 3);
  noiseChart.update({
    title: "Remainder: what neither the trend nor the season accounts for",
    subtitle: "Percent above or below trend times season. The largest months are named.",
    label: `Line chart of the remainder of the price of ${s.name} after removing trend and season`,
    x: { format: xLabel, label: "Month" },
    y: { format: pctAxis, label: "Percent", zero: true },
    series: [{ name: "Remainder", type: "area", data: noise.map((p) => [xOf(w.start, p.i), p.pct]), color: 2, width: 1.4 }],
    marks: biggest.map((p) => ({ type: "text", x: xOf(w.start, p.i), y: p.pct, text: `${monthLabel(w.start, p.i)} ${pctAxis(p.pct)}`, dx: 6, dy: p.pct >= 0 ? 4 : 10, anchor: xOf(w.start, p.i) > lastX - (lastX - xOf(w.start, 0)) * 0.3 ? "end" : "start" })),
  });

  forecastBox.replaceChildren(table({
    caption: `Forecast for the next twelve months, ${s.unit}`,
    columns: [{ key: "month", label: "Month" }, { key: "mid", label: "Forecast", num: true }, { key: "range", label: "80% range", num: true }, { key: "ago", label: "A year earlier", num: true }],
    rows: d.forecast.map((p) => ({
      month: monthLabel(w.start, n - 1 + p.h), mid: fmt.num(p.mid, modelDecimals(s)), range: `${fmt.num(p.low, modelDecimals(s))} to ${fmt.num(p.high, modelDecimals(s))}`, ago: fmt.num(p.sameMonthLastYear, sourceDecimals(s)),
    })),
  }));

  const next = d.forecast[0];
  status.textContent = `${s.name}, ${firstMonth} to ${lastMonth}. The season is highest in ${monthName(d.peak)}, ${effect(high)} the trend, and lowest in ${monthName(d.trough)}, ${effect(low)}. `
    + `Strength of the season ${fmt.num(d.strength.seasonal, 2)} out of 1. Forecast for ${monthLabel(w.start, n, false)}: ${modelled(next.mid, s)} ${perUnit(s)}, 80% range ${modelled(next.low, s)} to ${modelled(next.high, s)}.`;

  runTest(s, w, opts);
}

/* ---------- the held-out test, in slices so the page stays live ---------- */
function runTest(s, w, opts) {
  const id = ++job;
  const n = w.values.length;
  const origins = backtestOrigins(n);
  verdict.replaceChildren();
  testStatus.textContent = "";
  errorBox.hidden = true;
  rankNote.textContent = "Waiting for the held-out test to finish.";
  if (!origins.length) {
    progress.textContent = "";
    verdict.replaceChildren(note("warn", "There are too few months here to hold any out: the test needs six years of prices behind each forecast and a year after it."));
    rankAll(id);
    return;
  }
  const logs = Float64Array.from(w.values, Math.log);
  const tests = [];
  const slice = () => {
    if (id !== job) return; // a control changed: this run is abandoned
    const t0 = performance.now();
    while (tests.length < origins.length && performance.now() - t0 < 25) tests.push(backtestAt(logs, origins[tests.length], opts));
    if (tests.length < origins.length) {
      progress.textContent = `Refitting on held-out months: ${tests.length} of ${origins.length} forecasts made.`;
      setTimeout(slice, 0);
      return;
    }
    showTest(s, w, summarise(tests), origins);
    rankAll(id);
  };
  progress.textContent = `Refitting on held-out months: 0 of ${origins.length} forecasts made.`;
  setTimeout(slice, 0);
}

function showTest(s, w, r, origins) {
  const names = { seasonal: "repeating the same month of the year before", last: "repeating the latest price" };
  const o = r.overall;
  // One decimal place, unless that would print the forecast and the rule it is compared with as the same number.
  const places = [1, 2, 3, 4].find((k) => fmt.pct(asPercent(o.stl), k) !== fmt.pct(asPercent(o[r.bestNaive]), k)) ?? 1;
  const pct = (x) => fmt.pct(asPercent(x), places);
  const closer = r.bestNaive === "last" ? o.closerThanLast : o.closerThanSeasonal;
  const firstMade = monthLabel(w.start, origins[0] - 1, false), lastMade = monthLabel(w.start, origins[origins.length - 1] - 1, false);
  // The gap is given in percentage points and worked out from the two figures as printed, so that it always agrees with them.
  const shown = (x) => Number(pct(x).split("%")[0].split(",").join("")); // the figure exactly as printed
  const gap = Math.abs(shown(o.stl) - shown(o[r.bestNaive])).toFixed(places);
  const points = `${gap} percentage ${Number(gap) === 1 ? "point" : "points"}`;
  const months = r.origins + HORIZON - 1; // forecasts made a month apart share all but one of their months
  const outcome = r.beatsNaive
    ? `On these months the forecast came out ahead of the better naive rule, ${names[r.bestNaive]}: its average miss was ${points} smaller.${r.margin < 0.05 ? " A gap this small could vanish or reverse with a few more years of prices." : ""}`
    : r.margin === 0
      ? `The forecast did no better than the better naive rule, ${names[r.bestNaive]}: the two average misses differ by less than one part in 2,000.`
      : `The forecast did no better than the better naive rule, ${names[r.bestNaive]}: its average miss was ${points} larger.`;
  const sentences = [
    r.origins === 1
      ? `One forecast was made, at the end of ${firstMade}, from the prices up to that month only, and scored on the twelve months that followed.`
      : `${fmt.int(r.origins)} forecasts were made, one at the end of each month from ${firstMade} to ${lastMade}, each from the prices up to that month only, and scored on the twelve months that followed (${fmt.int(o.n)} forecast months, which overlap and cover only ${fmt.int(months)} different months).`,
    `The decomposition forecast missed by ${pct(o.stl)} on average. Repeating the same month of the year before missed by ${pct(o.seasonal)}, and repeating the latest price by ${pct(o.last)}.`,
    outcome,
    `It was strictly closer than that rule in ${fmt.pct(closer, 0)} of the forecast months (twelve months ahead the two always tie). The 80% range held the outcome ${fmt.pct(o.coverage, 0)} of the time. No test of significance is made. Change the settings until this result improves and it is no longer a held-out test.`,
  ];
  progress.textContent = "";
  verdict.replaceChildren(note(r.margin >= 0.05 ? "good" : r.beatsNaive ? "" : "warn", `${sentences[0]} ${sentences[1]} `, el("strong", { text: sentences[2] }), ` ${sentences[3]}`));
  testStatus.textContent = `Held-out test for ${s.name}. ${sentences.slice(1).join(" ")}`;
  errorBox.hidden = false;
  errorChart.update({
    title: "Average miss by how far ahead the forecast looks",
    subtitle: "Lower is better. Twelve months ahead the forecast and both naive rules say the same thing.",
    label: `Line chart of the average forecast error for ${s.name} by months ahead, for the decomposition forecast and two naive rules`,
    x: { label: "Months ahead", domain: [1, 12], ticks: 6, format: (v) => fmt.int(v) }, // every second month: twelve labels run together on a phone
    y: { label: "Average miss", format: (v) => fmt.pct(v, 0), zero: true },
    series: [
      { name: "Decomposition forecast", type: "line", data: r.byHorizon.map((b, i) => [i + 1, asPercent(b.stl)]), color: 0 },
      { name: "Same month a year before", type: "line", data: r.byHorizon.map((b, i) => [i + 1, asPercent(b.seasonal)]), color: 1 },
      { name: "Latest price repeated", type: "line", data: r.byHorizon.map((b, i) => [i + 1, asPercent(b.last)]), color: 2 },
    ],
  });
}

/* ---------- the season's strength for all ten, one fit per tick ---------- */
function rankAll(id) {
  const opts = options();
  const done = [];
  const step = () => {
    if (id !== job) return;
    const s = PRICES.series[done.length];
    const w = windowOf(s, s.source === "fpma" ? STARTS.fpma[0] : state.fromPink);
    done.push({ s, value: decompose(w.values, opts).strength.seasonal });
    if (done.length < PRICES.series.length) { setTimeout(step, 0); return; }
    const sorted = [...done].sort((a, b) => b.value - a.value);
    const place = sorted.findIndex((x) => x.s.id === state.id) + 1;
    rank.update(sorted.map((x) => ({ label: short(x.s), value: x.value, highlight: x.s.id === state.id, title: x.s.name })));
    rankNote.textContent = `Strength of the season with the settings above (0 is all noise, 1 is all season), world prices from January ${state.fromPink} and Indian prices from January 2014. `
      + `${short(byId(state.id))} is number ${place} of ${sorted.length}, shown in bold.`;
  };
  setTimeout(step, 0);
}

fillStarts();
update();
