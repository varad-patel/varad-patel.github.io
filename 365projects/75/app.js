// Day 75: Yield Curve Recession Model. Interface.
import { $, el, fmt, mount, slider, select, segmented, stat, note, table, chart, button } from "../kit/kit.js";
import { DATA } from "./data.js";
import {
  addMonths, monthDiff, monthLabel, SPREADS, LINKS, spreadSeries, recessionSeries, realTimeSteps, countOrigins, hindsightFit,
  predict, auc, rocCurve, confusion, brier, episodes, recessionsCaught, latestAnnounced, LAG,
} from "./logic.js";

// Outcomes known today: up to the last announced turning point, or LAG months back, whichever is later.
const knownTo = [latestAnnounced(DATA, DATA.last), addMonths(DATA.last, -LAG)].filter(Boolean).sort().at(-1);

mount();

const N = monthDiff(DATA.first, DATA.last) + 1;
const monthAt = (i) => addMonths(DATA.first, i);
// A month sits at its middle on the time axis, so whole numbers are the starts of years: tick marks read "1980" and
// the charts' tables, one row a month, read "Mar 1980".
const monthStart = (ym) => { const [y, m] = ym.split("-").map(Number); return y + (m - 1) / 12; };
const xOf = (ym) => monthStart(ym) + 1 / 24;
const monthOfX = (v) => { const k = Math.floor(v * 12 + 1e-9); return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; };
const yearTick = (v) => (Math.abs(v - Math.round(v)) < 1e-6 ? String(Math.round(v)) : monthLabel(monthOfX(v)));
const pct = (p, d = 0) => fmt.pct(p, d);
const points = (v, d = 2) => `${fmt.signed(v, d)} points`;
const REC = recessionSeries(DATA);
// Recessions run from the start of the month after the peak to the end of the trough month.
const spans = DATA.cycles.map((c) => ({ type: "span", x0: monthStart(c.peak) + 1 / 12, x1: monthStart(c.trough) + 1 / 12 }));
const HORIZONS = [6, 12, 18, 24];
const STARTS = ["1975", "1980", "1985", "1990", "2000"];

const state = { spread: "10y3m", link: "probit", h: 12, from: "1980", threshold: 0.5, curve: N - 1 };

/* ---------- controls ---------- */
const spreadSel = select({
  label: "Slope of the curve", value: state.spread,
  options: Object.entries(SPREADS).map(([value, s]) => ({ value, label: s.label })),
  hint: "The New York Fed's model uses the 10-year less the 3-month bill. The 2-year yield starts in June 1976.",
  onChange: (v) => { state.spread = v; recompute(); },
});
const linkSeg = segmented({
  label: "Model", value: state.link,
  options: Object.entries(LINKS).map(([value, l]) => ({ value, label: l.label })),
  onChange: (v) => { state.link = v; recompute(); },
});
const horizonSel = select({
  label: "Forecast the state of the economy", value: String(state.h),
  options: HORIZONS.map((h) => ({ value: String(h), label: `${h} months ahead` })),
  onChange: (v) => { state.h = Number(v); recompute(); },
});
const fromSel = select({
  label: "Score forecasts made from", value: state.from,
  options: STARTS.map((y) => ({ value: y, label: `January ${y}` })),
  hint: "Each month's forecast comes from a model refitted on what was known that month. The opening choice, 1980, was fixed before any result was seen.",
  onChange: (v) => { state.from = v; recompute(); },
});
const thresholdSlider = slider({
  label: "Call a recession when the probability is at least", min: 0.01, max: 0.99, step: 0.01, value: state.threshold,
  format: (v) => pct(v, 0),
  hint: "Moves only the confusion table, the episodes and the point on the ROC curve. The AUC does not depend on it.",
  onInput: (v) => { state.threshold = v; drawThreshold(); },
});
const curveSlider = slider({
  label: "Show the yield curve for", min: 0, max: N - 1, step: 1, value: state.curve,
  format: (i) => monthLabel(monthAt(i), true),
  hint: "Or click a month on the spread chart.",
  onInput: (i) => { state.curve = i; drawCurve(); },
});
const latestBtn = button("Latest month", () => { state.curve = N - 1; curveSlider.value = N - 1; drawCurve(); }, { small: true });
const advice = note("", "An illustration of a forecasting method and of how to score it, not a forecast to act on and not investment advice.");
const about = el("p", { class: "hint small muted" },
  `Yields: Federal Reserve Board, H.15, monthly averages, ${monthLabel(DATA.first)} to ${monthLabel(DATA.last)}, public domain. `,
  `Recessions: NBER business-cycle dates and announcement dates, copied with attribution as the NBER permits; outcomes count as known to ${monthLabel(knownTo)}. Retrieved ${fmt.date(DATA.retrieved)}.`);

const controls = el("div", { class: "controls" },
  el("h2", { text: "The model" }), spreadSel.el, linkSeg.el, horizonSel.el, fromSel.el, advice, about);

/* ---------- outputs ---------- */
const sSpread = stat("Spread");
const sNow = stat("Recession probability");
const sAuc = stat("AUC, forecasts made at the time");
const sSkill = stat("Brier skill against the base rate");
const status = el("p", { class: "sr-only", role: "status" });
const progress = el("p", { class: "small muted", "aria-hidden": "true" });
const curveBox = el("div"), spreadBox = el("div"), probBox = el("div"), rocBox = el("div");
const tableHead = el("h2", { text: "Months flagged against what happened" });
const tableBox = el("div", { class: "cm-wrap" });
const ratesBox = el("div");
const skipBox = el("div");
const episodeBox = el("div");
const jump = el("nav", { class: "row jump small", "aria-label": "Parts of the tool" }, "Jump to:",
  [["yc-curve", "the curve"], ["yc-prob", "the probabilities"], ["yc-roc", "the ROC curve"], ["yc-table", "the threshold and table"]]
    .map(([id, text]) => el("a", { href: `#${id}`, text })));
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sSpread.el, sNow.el, sAuc.el, sSkill.el), status, progress, jump,
  el("div", { class: "stack", id: "yc-curve" }, el("div", { class: "row month-row" }, curveSlider.el, latestBtn), curveBox), spreadBox,
  el("div", { id: "yc-prob" }, probBox), el("div", { id: "yc-roc" }, rocBox),
  el("div", { class: "panel stack", id: "yc-table" }, tableHead, thresholdSlider.el, tableBox, ratesBox, episodeBox, skipBox));
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const curveChart = chart(curveBox, { series: [], height: 260 });
const spreadChart = chart(spreadBox, { series: [], height: 280 });
const probChart = chart(probBox, { series: [], height: 300 });
const rocChart = chart(rocBox, { series: [], height: 320 });

/* ---------- the yield curve in one month ---------- */
function curveAt(i) {
  return DATA.maturities.map((m) => [m.years, DATA.cmt[m.key][i]]).filter(([, v]) => v != null);
}
function drawCurve() {
  const i = state.curve, ym = monthAt(i), before = i - 12;
  const now = curveAt(i), then = before >= 0 ? curveAt(before) : [];
  const s = spreadSeries(DATA, state.spread)[i];
  const inverted = now.length > 1 && now.at(-1)[1] < now[0][1];
  curveChart.update({
    title: `The yield curve, ${monthLabel(ym, true)}`,
    subtitle: `Treasury yields at constant maturity, monthly average. ${SPREADS[state.spread].label}: ${s == null ? "not available this month" : points(s)}`
      + `${s != null && s < 0 ? " (inverted)" : ""}. ${REC[i] ? "The economy was in recession this month (NBER)." : ""}`,
    label: `Line chart of US Treasury yields against maturity in ${monthLabel(ym, true)}${inverted ? ", downward sloping" : ""}`,
    x: { label: "Maturity, years (log scale)", type: "log", domain: [0.22, 36], format: (v) => (v < 1 ? `${Math.round(v * 12)}m` : `${v}y`) },
    y: { label: "Yield, % a year", format: (v) => fmt.num(v, 1) },
    series: [
      { name: monthLabel(ym), type: "line", data: now, color: 0, width: 2.4 },
      { name: `${monthLabel(ym)} points`, type: "scatter", data: now.map(([x, y]) => ({ x, y, label: `${monthLabel(ym)}, ${x < 1 ? `${x * 12} months` : `${x} years`}` })), color: 0, r: 3.5, legend: false },
      ...(then.length ? [{ name: `${monthLabel(addMonths(ym, -12))}, a year earlier`, type: "line", data: then, color: "#8a94a3", width: 1.6, dash: true }] : []),
    ],
  });
  spreadChart.update({ marks: spreadMarks() });
}
function spreadMarks() {
  return [...spans, { type: "hline", y: 0, text: "Inverted below this line" }, { type: "vline", x: xOf(monthAt(state.curve)), text: monthLabel(monthAt(state.curve)) }];
}

/* ---------- the spread through time ---------- */
function drawSpread() {
  const s = spreadSeries(DATA, state.spread);
  spreadChart.update({
    title: `${SPREADS[state.spread].label}, every month since ${monthLabel(DATA.first)}`,
    subtitle: "Shaded: recessions, from the month after each NBER peak to the trough. Click a month to see its curve.",
    label: `Line chart of the ${SPREADS[state.spread].long} by month, with recessions shaded`,
    x: { format: yearTick, label: "Year" },
    y: { label: "Percentage points", format: (v) => fmt.num(v, 0) },
    series: [{ name: SPREADS[state.spread].label, type: "line", data: s.map((v, i) => [xOf(monthAt(i)), v]), color: 0, width: 1.5 }],
    marks: spreadMarks(),
    onClick: ({ x, inside }) => {
      if (!inside || x == null) return;
      const i = Math.max(0, Math.min(N - 1, monthDiff(DATA.first, monthOfX(x))));
      state.curve = i; curveSlider.value = i; drawCurve();
    },
  });
}

/* ---------- the model, refitted month by month in slices ---------- */
const cache = new Map();
let job = 0, result = null;

function recompute() {
  const key = `${state.spread}|${state.link}|${state.h}|${state.from}`;
  const id = ++job;
  drawSpread();
  drawCurve();
  // A run abandoned for a cached result must not leave its progress line behind.
  if (cache.has(key)) { result = cache.get(key); progress.textContent = ""; drawModel(); return; }
  const opts = { spread: state.spread, h: state.h, link: state.link, from: `${state.from}-01` };
  const total = countOrigins(DATA, opts);
  const steps = realTimeSteps(DATA, opts);
  const rows = [], skipped = [];
  progress.textContent = "Refitting the model month by month…";
  status.textContent = "Refitting the model.";
  const slice = () => {
    if (id !== job) return; // the visitor changed something: this run is abandoned
    const end = performance.now() + 25;
    let step;
    while (performance.now() < end && !(step = steps.next()).done) (step.value.skipped ? skipped : rows).push(step.value);
    if (step && step.done) {
      const hs = hindsightFit(DATA, opts);
      result = { opts, rows, skipped, hs };
      cache.set(key, result);
      progress.textContent = "";
      drawModel();
      return;
    }
    progress.textContent = `Refitting the model month by month: ${fmt.int(rows.length + skipped.length)} of ${fmt.int(total)} forecasts.`;
    setTimeout(slice, 0);
  };
  slice();
}

function drawModel() {
  const { opts, rows, skipped, hs } = result;
  const h = opts.h, link = opts.link;
  const x = spreadSeries(DATA, opts.spread);
  // The latest month with a spread: today's model, fitted on every outcome known now.
  let last = N - 1;
  while (last > 0 && x[last] == null) last--;
  const pNow = hs.error ? null : predict(hs, x[last], link);
  sSpread.set(points(x[last]), `${SPREADS[opts.spread].label}, ${monthLabel(monthAt(last))}`);
  sNow.set(pNow == null ? "–" : pct(pNow, 0), `of being in recession in ${monthLabel(addMonths(monthAt(last), h))}, by the model fitted on all outcomes known today`);

  if (!rows.length) {
    for (const s of [sAuc, sSkill]) s.set("–", "no forecasts could be scored");
    probChart.update({ series: [], marks: [], empty: "No forecasts to score" });
    rocChart.update({ series: [], marks: [], empty: "No forecasts to score" });
    tableBox.replaceChildren(note("warn", "No forecast could be made and scored with these settings."));
    ratesBox.replaceChildren(); episodeBox.replaceChildren(); skipBox.replaceChildren();
    status.textContent = "No forecasts could be scored with these settings.";
    return;
  }
  const p = rows.map((r) => r.p), y = rows.map((r) => r.y);
  const ph = rows.map((r) => predict(hs, r.spread, link));
  const A = auc(p, y), Ah = auc(ph, y);
  const B = brier(p, y, rows.map((r) => r.base));
  const first = rows[0], lastRow = rows.at(-1);
  const recMonths = y.reduce((s, v) => s + v, 0);
  sAuc.set(A == null ? "–" : fmt.num(A, 2), A == null ? "needs recession and expansion months" : `with hindsight: ${fmt.num(Ah, 2)}. 0.5 is a coin toss, 1 is perfect`);
  sSkill.set(fmt.num(B.skill, 2), `Brier score ${fmt.num(B.brier, 3)} against ${fmt.num(B.ref, 3)} for always forecasting the share of recession months known at the time`);

  const span = `forecasts made from ${monthLabel(first.origin)} to ${monthLabel(lastRow.origin)}, for ${monthLabel(first.target)} to ${monthLabel(lastRow.target)}`;
  probChart.update({
    title: `Probability of recession ${h} months ahead`,
    subtitle: `Plotted at the month forecast. Blue: each month's model, fitted only on outcomes known then. Grey: one model fitted with hindsight on everything known today. ${span[0].toUpperCase()}${span.slice(1)}.`,
    label: `Line chart of the forecast probability of recession ${h} months ahead, made in real time and with hindsight, with recessions shaded`,
    x: { format: yearTick, label: "Month forecast", domain: [xOf(first.target) - 0.5, xOf(lastRow.target) + 0.5] },
    y: { label: "Probability", domain: [0, 1], format: (v) => pct(v, 0) },
    series: [
      { name: "Fitted at the time", type: "line", data: rows.map((r) => [xOf(r.target), r.p]), color: 0, width: 1.8 },
      { name: "With hindsight", type: "line", data: rows.map((r, k) => [xOf(r.target), ph[k]]), color: "#8a94a3", width: 1.4, dash: true },
    ],
    marks: [...spans, { type: "hline", y: state.threshold, text: `Threshold ${pct(state.threshold, 0)}` }],
  });

  const roc = rocCurve(p, y), rocH = rocCurve(ph, y);
  rocChart.update({
    title: "ROC curve: every threshold at once",
    subtitle: `Each point is one threshold: the share of recession months flagged against the share of other months flagged. ${fmt.int(recMonths)} recession months and ${fmt.int(y.length - recMonths)} others.`,
    label: "ROC curve of the real-time forecasts and of the hindsight fit, with the diagonal of a forecast with no skill",
    x: { label: "False alarm rate (other months flagged)", domain: [0, 1], format: (v) => pct(v, 0) },
    y: { label: "Hit rate (recession months flagged)", domain: [0, 1], format: (v) => pct(v, 0) },
    hover: "point",
    series: [
      { name: `Fitted at the time, AUC ${fmt.num(A, 2)}`, type: "step", data: roc.map((q) => ({ x: q.fpr, y: q.tpr, label: `At ${Number.isFinite(q.threshold) ? pct(q.threshold, 1) : "more than 100%"}` })), color: 0, width: 2 },
      { name: `With hindsight, AUC ${fmt.num(Ah, 2)}`, type: "line", data: rocH.map((q) => [q.fpr, q.tpr]), color: "#8a94a3", width: 1.4, dash: true, hover: false },
      { name: "No skill", type: "line", data: [[0, 0], [1, 1]], color: "#16233b", width: 1, dash: true, hover: false },
    ],
  });
  drawThreshold();
  skipBox.replaceChildren(...(skipped.length ? [note("", `${fmt.int(skipped.length)} early ${skipped.length === 1 ? "forecast was" : "forecasts were"} skipped because the outcomes known then held too few recession months to fit a model.`)] : []));
}

// "8 months before the peak", "in the month of the peak", "3 months after the peak".
const lead = (made, peak) => {
  const k = monthDiff(made, peak);
  return k > 0 ? `${k} ${k === 1 ? "month" : "months"} before the peak` : k === 0 ? "in the month of the peak" : `${-k} ${k === -1 ? "month" : "months"} after the peak`;
};

function drawThreshold() {
  if (!result || !result.rows.length) return;
  const { rows, opts } = result;
  const t = state.threshold;
  const p = rows.map((r) => r.p), y = rows.map((r) => r.y);
  const c = confusion(p, y, t);
  probChart.update({ marks: [...spans, { type: "hline", y: t, text: `Threshold ${pct(t, 0)}` }] });
  rocChart.update({ marks: [{ type: "point", x: c.fpr ?? 0, y: c.tpr ?? 0, text: `${pct(t, 0)}: ${pct(c.tpr ?? 0, 0)} hit, ${pct(c.fpr ?? 0, 0)} false alarm` }] });

  const share = (v, of) => (v > 0 && v / of < 0.005 ? "under 1%" : v < of && v / of > 0.995 ? "over 99%" : pct(v / of, 0));
  const cell = (v, of) => `${fmt.int(v)} ${of ? `(${share(v, of)})` : ""}`.trim();
  tableBox.replaceChildren(table({
    caption: `Threshold ${pct(t, 0)}: ${fmt.int(c.n)} forecasts ${opts.h} months ahead, made from ${monthLabel(rows[0].origin)} to ${monthLabel(rows.at(-1).origin)}`,
    columns: [{ key: "what", label: `State ${opts.h} months later` }, { key: "yes", label: "Flagged", num: true }, { key: "no", label: "Not flagged", num: true }],
    rows: [
      { what: "Recession", yes: cell(c.tp, c.tp + c.fn), no: cell(c.fn, c.tp + c.fn) },
      { what: "No recession", yes: cell(c.fp, c.fp + c.tn), no: cell(c.tn, c.fp + c.tn) },
    ],
  }));
  const ratio = (v) => (v == null ? "not defined, nothing in that group" : pct(v, 1));
  const beats = c.accuracy > c.alwaysNo ? "better than" : c.accuracy === c.alwaysNo ? "the same as" : "worse than";
  ratesBox.replaceChildren(el("ul", { class: "small rates" },
    el("li", { text: `Hit rate: ${ratio(c.tpr)} of recession months were flagged.` }),
    el("li", { text: `False alarm rate: ${ratio(c.fpr)} of the other months were flagged.` }),
    el("li", { text: `When a month was flagged, a recession followed ${ratio(c.precision)} of the time.` }),
    el("li", { text: `Right in ${ratio(c.accuracy)} of months, ${beats} saying "no recession" every month (${ratio(c.alwaysNo)}). Recessions are rare, so accuracy flatters any forecast that rarely says yes.` })));

  const caught = recessionsCaught(DATA, rows, t);
  const runs = episodes(rows, t);
  const false_ = runs.filter((r) => !r.hit);
  episodeBox.replaceChildren(
    el("h3", { text: "Recession by recession" }),
    caught.length
      ? el("ul", { class: "small rates" }, caught.map((r) => el("li", {
        text: `${monthLabel(addMonths(r.peak, 1))} to ${monthLabel(r.trough)}: ${r.caught ? `flagged, first by the forecast made in ${monthLabel(r.firstFlag)}, ${lead(r.firstFlag, r.peak)}` : `missed; the highest forecast for any of its months was ${pct(r.maxP, 0)}`}.`,
      })))
      : el("p", { class: "small", text: "No whole recession falls inside the months scored." }),
    el("p", { class: "small", text: false_.length
      ? `${false_.length} ${false_.length === 1 ? "stretch" : "stretches"} of flagged months forecast no recession month: ${false_.map((r) => (r.from === r.to ? monthLabel(r.from) : `${monthLabel(r.from)} to ${monthLabel(r.to)}`)).join("; ")}.`
      : "No stretch of flagged months was a false alarm." }));

  const A = auc(p, y);
  status.textContent = `Forecasts ${opts.h} months ahead from ${monthLabel(rows[0].origin)} to ${monthLabel(rows.at(-1).origin)}: AUC ${fmt.num(A, 2)}. `
    + `At a ${pct(t, 0)} threshold, ${ratio(c.tpr)} of recession months and ${ratio(c.fpr)} of other months were flagged, `
    + `${caught.filter((r) => r.caught).length} of ${caught.length} recessions caught.`;
}

recompute();
