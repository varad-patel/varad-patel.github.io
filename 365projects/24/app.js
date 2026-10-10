// Day 24: Personal Forecast Log. Interface.
import { $, el, fmt, mount, slider, numberField, select, textField, textArea, button, stat, note, table, chart, store, download } from "../kit/kit.js";
import {
  COIN, LIMITS, localToday, addDays, daysBetween, dayNumber, brier, expectedBrier, scorecard, emptyLog,
  addForecast, editForecast, resolveForecast, reopenForecast, deleteForecast, statusOf, arrange, allTags,
  toJSON, toCSV, parseImport, mergeInto, restore, exampleLog,
} from "./logic.js";

mount();

const db = store("day24");
const state = {
  mine: restore(db.get("log"), { today: localToday() }), // the visitor's own log, or null until they start one
  example: exampleLog(localToday()),                     // a made-up log that is never saved
  view: "example",
  tag: "",
  editing: null,
  showAll: false,
  flash: null,
};
if (state.mine) state.view = "mine";

const pct = (p) => `${Number((p * 100).toFixed(1))}%`;
const pct0 = (p) => fmt.pct(p, 0);
const plural = (n, word) => `${fmt.int(n)} ${word}${n === 1 ? "" : "s"}`;
const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
const dayLabel = (d) => shortDate.format(new Date(Math.round(d) * 86400000));
const current = () => (state.view === "mine" ? state.mine : state.example);
const EXAMPLES = [
  "It rains here on Saturday",
  "I finish the book I am reading by the end of the month",
  "My team wins its next match",
  "The central bank cuts its interest rate at its next meeting",
  "I get a reply to my application within two weeks",
  "The government's bill passes its next vote",
];

/** Kit gap: there is no date control, so this one is built here in the same shape as the kit's fields. */
let uid = 0;
function dateField({ label, value, hint }) {
  const id = `fl-date-${++uid}`;
  const input = el("input", { type: "date", id, value });
  return {
    el: el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: id, text: label })), input, hint ? el("div", { class: "hint", text: hint }) : null),
    input, get value() { return input.value; }, set value(v) { input.value = v; },
  };
}

/* ---------- saving ---------- */
function setLog(log) {
  if (state.view === "mine") {
    state.mine = log;
    if (!db.set("log", log)) state.flash = { kind: "bad", text: "This browser would not save the change, perhaps because storage is full or switched off. Export your log now so that nothing is lost." };
  } else state.example = log;
}
/** Apply an edit to whichever log is on screen. */
function apply(result, flash = null) {
  if (result.error) { state.flash = { kind: "bad", text: result.error }; render(); return false; }
  state.flash = flash;
  setLog(result.log);
  render();
  return true;
}
function startOwn() {
  state.mine ??= emptyLog();
  state.view = "mine";
  state.tag = "";
  state.editing = null;
  db.set("log", state.mine);
}

/* ---------- the add form ---------- */
const form = {
  statement: textArea({ label: "Prediction", rows: 3, placeholder: "A statement that will turn out true or false, such as: It rains here on Saturday" }),
  percent: slider({ label: "Probability that it turns out true", min: 0, max: 100, step: 1, value: 70, format: (v) => `${v}%` }),
  due: dateField({ label: "Resolves on", value: addDays(localToday(), 30), hint: "The day you will know the answer." }),
  tags: textField({ label: "Tags (optional)", placeholder: "politics, weather" }),
  message: el("div"),
};
form.statement.input.maxLength = LIMITS.statement;
let exampleAt = 0;
const addBtn = button("Add prediction", () => {
  const today = localToday();
  const input = { statement: form.statement.value, percent: form.percent.value, due: form.due.value, tags: form.tags.value };
  const first = !state.mine;
  const base = state.mine ?? emptyLog();
  const res = addForecast(base, input, { today });
  if (res.error) { form.message.replaceChildren(note("bad", res.error)); return; }
  form.message.replaceChildren();
  startOwn();
  state.flash = { kind: "good", text: first
    ? "Your own log has started with this prediction, and the example has been put away. Come back on the day it resolves and say what happened."
    : `Added to your log. It resolves on ${fmt.date(input.due)}.` };
  setLog(res.log);
  form.statement.value = "";
  form.tags.value = "";
  render();
}, { primary: true });

const controls = el("div", { class: "controls" },
  el("h3", { text: "Add a prediction" }),
  form.statement.el,
  el("div", { class: "row" }, button("Fill in an example", () => { form.statement.value = EXAMPLES[exampleAt++ % EXAMPLES.length]; form.statement.input.focus(); }, { small: true })),
  form.percent.el,
  form.due.el,
  el("div", { class: "row" }, [["1 week", 7], ["1 month", 30], ["3 months", 91], ["1 year", 365]].map(([label, days]) => button(label, () => { form.due.value = addDays(localToday(), days); }, { small: true, title: `Set the date to ${label} from today` }))),
  form.tags.el,
  el("div", { class: "row" }, addBtn),
  form.message);

/* ---------- your data ---------- */
const fileInput = el("input", { type: "file", accept: ".json,.csv,application/json,text/csv", hidden: true, "aria-label": "Forecast log file" });
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  let text = "";
  try { text = await file.text(); } catch { /* reported as an empty file below */ }
  const res = parseImport(text, { today: localToday() });
  if (res.error) { state.flash = { kind: "bad", text: res.error }; render(); return; }
  startOwn();
  const merged = mergeInto(state.mine, res.forecasts);
  const parts = [`${plural(merged.added, "prediction")} added to your log from ${file.name}.`];
  if (merged.skipped) parts.push(`${plural(merged.skipped, "prediction")} already in the log ${merged.skipped === 1 ? "was" : "were"} left alone.`);
  if (res.problems.length) parts.push(`${plural(res.problems.length, "record")} could not be read. ${res.problems.slice(0, 3).join(" ")}${res.problems.length > 3 ? " And more." : ""}`);
  state.flash = { kind: res.problems.length ? "warn" : "good", text: parts.join(" ") };
  setLog(merged.log);
  render();
});
// Exports are for the visitor's own log only, so that made-up example rows can never be imported into a real one.
const fileName = () => `forecast-log-${localToday()}`;
const exportJson = button("Export JSON", () => state.mine && download(`${fileName()}.json`, toJSON(state.mine), "application/json"), { small: true });
const exportCsv = button("Export CSV", () => state.mine && download(`${fileName()}.csv`, toCSV(state.mine), "text/csv"), { small: true });
const eraseBtn = button("Erase my log", () => {
  if (!state.mine) return;
  if (!confirm(`Erase all ${plural(state.mine.forecasts.length, "prediction")} from this browser? Export a copy first if you want to keep them. This cannot be undone.`)) return;
  state.mine = null;
  db.remove("log");
  state.view = "example";
  state.tag = "";
  state.editing = null;
  state.flash = { kind: "", text: "Your log has been erased from this browser. What you see now is the example." };
  render();
}, { small: true });
const switchBtn = button("", () => {
  state.view = state.view === "mine" ? "example" : "mine";
  state.tag = "";
  state.editing = null;
  state.flash = null;
  render();
}, { small: true });
const storageNote = el("p", { class: "small" });
const dataPanel = el("div", { class: "panel fl-data" },
  el("h3", { text: "Your data" }),
  storageNote,
  el("div", { class: "row" },
    exportJson, exportCsv,
    button("Import a file", () => fileInput.click(), { small: true, title: "Add the predictions in an exported JSON or CSV file to your log" })),
  el("div", { class: "row" }, switchBtn, eraseBtn),
  fileInput);
controls.append(dataPanel);

/* ---------- outputs ---------- */
const banner = el("div", { role: "status", class: "fl-banner" });
const sBrier = stat("Mean Brier score");
const sSkill = stat("Against always saying 50%");
const sConf = stat("Confidence and results");
const sCount = stat("Resolved");
const filterBox = el("div");
const listsBox = el("div", { class: "fl-lists" });
const scoreBox = el("div", { class: "fl-score" });
const calBox = el("div");
const calTable = el("div");
const timeBox = el("div");
const partsBox = el("div");
const emptyScore = el("div");

/* The scoring rule, to play with. */
const tryP = slider({ label: "You say", min: 0, max: 100, step: 1, value: 90, format: (v) => `${v}%`, onInput: drawTry });
const tryRate = slider({ label: "It happens", min: 0, max: 100, step: 1, value: 70, format: (v) => `${v}% of the time`, onInput: drawTry });
const sTry = stat("Expected Brier score");
const sHonest = stat("If you had said the true rate");
const tryPanel = el("div", { class: "panel fl-try" },
  el("h3", { text: "Try the scoring rule" }),
  el("p", { class: "small muted", text: "Suppose you give the same probability every time, and the things you predict happen at some rate. This is the score you should expect." }),
  el("div", { class: "grid2" }, el("div", { class: "controls" }, tryP.el, tryRate.el), el("div", { class: "stats" }, sTry.el, sHonest.el)));
function drawTry() {
  const p = tryP.value / 100, rate = tryRate.value / 100;
  const score = expectedBrier(p, rate);
  const versus = Math.abs(score - COIN) < 5e-4 ? "the same as always saying 50%" : score < COIN ? `${pct0(1 - score / COIN)} better than always saying 50%` : `${pct0(score / COIN - 1)} worse than always saying 50%`;
  sTry.set(fmt.num(score, 3), versus);
  sHonest.set(fmt.num(expectedBrier(rate, rate), 3), `saying ${tryRate.value}% every time: the best a fixed answer can do`);
}

$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, el("div", { class: "out" },
  banner,
  el("div", { class: "stats" }, sBrier.el, sSkill.el, sConf.el, sCount.el),
  filterBox, listsBox,
  el("div", { class: "fl-scorecard" }, el("h3", { class: "fl-h", text: "Scorecard" }), emptyScore, scoreBox),
  tryPanel)));
scoreBox.append(el("div", { class: "grid2" }, el("div", {}, calBox, calTable), el("div", {}, timeBox, partsBox)));

const calChart = chart(calBox, {
  title: "Calibration",
  subtitle: "Each dot is a group of forecasts; bigger dots hold more. On the line, things you call 70% happen 70% of the time.",
  label: "Calibration chart: probability given against how often it happened",
  height: 320, hover: "point", legend: false,
  x: { label: "Probability you gave", domain: [0, 1], format: pct0 },
  y: { label: "How often it happened", domain: [0, 1], format: pct0 },
  series: [],
});
const timeChart = chart(timeBox, {
  title: "Score over time",
  subtitle: "Your mean Brier score after each day on which something resolved. Lower is better.",
  height: 320, legend: false,
  x: { label: "Date resolved", format: dayLabel },
  y: { label: "Mean Brier score", format: (v) => fmt.num(v, 2) },
  series: [],
});

/* ---------- the lists ---------- */
function editForm(f) {
  const fields = {
    statement: textArea({ label: "Prediction", rows: 3, value: f.statement }),
    percent: numberField({ label: "Probability that it turns out true (%)", min: 0, max: 100, value: Number((f.p * 100).toFixed(2)), hint: "If you change this, the log notes the date. The score uses the latest probability." }),
    due: dateField({ label: "Resolves on", value: f.due }),
    tags: textField({ label: "Tags (optional)", value: f.tags.join(", ") }),
  };
  const message = el("div");
  return el("li", { class: "fl-item editing" }, el("div", { class: "fl-edit controls" },
    fields.statement.el, fields.percent.el, fields.due.el, fields.tags.el, message,
    el("div", { class: "row" },
      button("Save changes", () => {
        const res = editForecast(current(), f.id, { statement: fields.statement.value, percent: fields.percent.value, due: fields.due.value, tags: fields.tags.value }, { today: localToday() });
        if (res.error) { message.replaceChildren(note("bad", res.error)); return; }
        state.editing = null;
        apply(res, { kind: "good", text: "Saved." });
      }, { small: true, primary: true }),
      button("Cancel", () => { state.editing = null; render(); }, { small: true }))));
}

function item(f, today) {
  if (state.editing === f.id) return editForm(f);
  const status = statusOf(f, today);
  const meta = [];
  if (status === "resolved") {
    meta.push(el("span", { class: `fl-pill ${f.outcome ? "yes" : "no"}`, text: f.outcome ? "Happened" : "Did not happen" }));
    meta.push(`Brier ${fmt.num(brier(f.p, f.outcome), 3)} · resolved ${fmt.date(f.resolved)}`);
  } else if (status === "overdue") {
    meta.push(el("span", { class: "fl-pill overdue", text: `overdue by ${plural(daysBetween(f.due, today), "day")}` }));
    meta.push(`was due ${fmt.date(f.due)}`);
  } else meta.push(status === "today" ? "Resolves today" : `Resolves ${fmt.date(f.due)}, in ${plural(daysBetween(today, f.due), "day")}`);
  meta.push(` · made ${fmt.date(f.created)}`);
  if (f.revised) meta.push(` · probability revised ${fmt.date(f.revised)}`);
  if (f.tags.length) meta.push(` · ${f.tags.join(", ")}`);
  const act = (label, fn, opts = {}) => { const b = button(label, fn, { small: true, ...opts }); b.setAttribute("aria-label", `${label}: ${f.statement}`); return b; };
  const actions = status === "resolved"
    ? [act("Undo", () => apply(reopenForecast(current(), f.id), { kind: "", text: "Reopened. It is back among the predictions waiting for an answer." }))]
    : [
      act("Happened", () => apply(resolveForecast(current(), f.id, true, { today: localToday() }), { kind: "good", text: `Resolved as happened. You said ${pct(f.p)}, so this one scores ${fmt.num(brier(f.p, 1), 3)}.` })),
      act("Did not happen", () => apply(resolveForecast(current(), f.id, false, { today: localToday() }), { kind: "good", text: `Resolved as did not happen. You said ${pct(f.p)}, so this one scores ${fmt.num(brier(f.p, 0), 3)}.` })),
      act("Edit", () => { state.editing = f.id; state.flash = null; render(); }),
    ];
  actions.push(act("Delete", () => {
    if (!confirm(`Delete this prediction?\n\n"${f.statement}"\n\nThis cannot be undone.`)) return;
    apply(deleteForecast(current(), f.id), { kind: "", text: "Deleted." });
  }));
  return el("li", { class: `fl-item ${status}` },
    el("div", { class: "fl-p", title: "The probability you gave", text: pct(f.p) }),
    el("div", {},
      el("p", { class: "fl-text", text: f.statement }),
      el("p", { class: "fl-meta small muted" }, meta),
      el("div", { class: "row fl-actions" }, actions)));
}

function section(title, list, today, emptyText, hint, count = list.length) {
  const tag = state.view === "example" ? el("span", { class: "fl-pill example", text: "example" }) : null;
  return el("section", { class: "fl-section" },
    el("h3", {}, `${title} (${count}) `, tag),
    hint && list.length ? el("p", { class: "small muted", text: hint }) : null,
    list.length ? el("ul", { class: "fl-list" }, list.map((f) => item(f, today))) : el("p", { class: "small muted", text: emptyText }));
}

/* ---------- render ---------- */
function render() {
  const today = localToday();
  const log = current();
  const tags = allTags(log.forecasts);
  if (state.tag && !tags.includes(state.tag)) state.tag = "";
  const shown = state.tag ? log.forecasts.filter((f) => f.tags.includes(state.tag)) : log.forecasts;
  const lists = arrange(shown, today);
  const card = scorecard(shown);
  const example = state.view === "example";
  $("#app").classList.toggle("fl-is-example", example);

  // Banner: which log this is, then anything that just happened.
  const top = [];
  if (example) {
    top.push(note("warn", el("strong", { text: "This is an example log, not yours. " }),
      "The predictions and their outcomes are made up so that the page has something to show. Nothing you do to them is saved. ",
      el("span", { class: "row fl-banner-row" }, state.mine
        ? button(`Back to my log (${state.mine.forecasts.length})`, () => switchBtn.click(), { small: true, primary: true })
        : button("Start my own log", () => { startOwn(); state.flash = { kind: "", text: "Your log is empty. Add your first prediction with the form; it is saved in this browser as soon as you add it." }; render(); form.statement.input.focus(); }, { small: true, primary: true }))));
  }
  if (state.flash) top.push(note(state.flash.kind, state.flash.text));
  if (!example && lists.overdue.length && !state.flash) top.push(note("warn", `${plural(lists.overdue.length, "prediction")} ${lists.overdue.length === 1 ? "has" : "have"} passed ${lists.overdue.length === 1 ? "its" : "their"} date. Say what happened so the scorecard can count ${lists.overdue.length === 1 ? "it" : "them"}.`));
  banner.replaceChildren(...top);

  storageNote.textContent = state.mine
    ? `Your log has ${plural(state.mine.forecasts.length, "prediction")}. It is kept in this browser on this device and is sent nowhere. Clearing the browser's site data deletes it, so export a copy from time to time.`
    : "When you add a prediction it is kept in this browser on this device and is sent nowhere. Clearing the browser's site data deletes it, so export a copy from time to time. Export and erase work on your own log, not on the example.";
  switchBtn.textContent = example ? "Back to my log" : "Show the example log";
  switchBtn.hidden = example && !state.mine;
  eraseBtn.disabled = !state.mine;
  exportJson.disabled = exportCsv.disabled = !state.mine;

  // Tiles.
  const scope = state.tag ? ` tagged ${state.tag}` : "";
  if (card.n) {
    sBrier.set(fmt.num(card.brier, 3), "0 is perfect; always saying 50% scores 0.25");
    const diff = Math.abs(card.skill) < 0.005 ? "The same" : card.skill > 0 ? `${pct0(card.skill)} better` : `${pct0(-card.skill)} worse`;
    sSkill.set(diff, `over ${plural(card.n, "resolved prediction")}${scope}`);
  } else {
    sBrier.set("–", "appears once a prediction is resolved");
    sSkill.set("–", "always saying 50% scores 0.25");
  }
  const c = card.confidence;
  if (c) {
    const points = Math.round(Math.abs(c.gap) * 100);
    const gap = points === 0 ? "confidence matches results" : `${points} ${points === 1 ? "point" : "points"} ${c.gap > 0 ? "more" : "less"} confident than right`;
    const verdict = {
      "too few": `${gap}; too few forecasts to say more`,
      "no clear sign": `${gap}, which luck alone could produce with ${c.n} forecasts`,
      overconfident: `overconfident: ${gap}, more than luck explains`,
      underconfident: `underconfident: ${gap}, more than luck explains`,
    }[c.verdict];
    sConf.set(`${pct0(c.said)} said, ${pct0(c.right)} right`, verdict);
  } else sConf.set("–", card.n ? "every resolved forecast was exactly 50%" : "how sure you were against how often you were right");
  sCount.set(`${card.n} of ${card.total}`, `${lists.overdue.length} overdue, ${lists.open.length} open${scope}`);

  // Tag filter.
  filterBox.replaceChildren(...(tags.length ? [select({
    label: "Show", value: state.tag,
    options: [{ value: "", label: `All predictions (${log.forecasts.length})` }, ...tags.map((t) => ({ value: t, label: `Tagged ${t} (${log.forecasts.filter((f) => f.tags.includes(t)).length})` }))],
    onChange: (v) => { state.tag = v; state.editing = null; render(); },
  }).el] : []));

  // Lists. The resolved list shows the latest few until asked for the rest.
  const few = 5;
  const resolved = state.showAll ? lists.resolved : lists.resolved.slice(0, few);
  listsBox.replaceChildren(...[
    lists.overdue.length ? section("Needs resolving", lists.overdue, today, "", "These have passed their date. Say what happened.") : null,
    section("Open", lists.open, today, log.forecasts.length ? "Nothing is waiting for an answer." : "No predictions yet. Add your first one with the form."),
    section("Resolved", resolved, today, "Nothing is resolved yet. When a prediction's day comes, say whether it happened.", null, lists.resolved.length),
    lists.resolved.length > few ? el("div", { class: "row" }, button(state.showAll ? "Show only the latest five" : `Show all ${lists.resolved.length} resolved`, () => { state.showAll = !state.showAll; render(); }, { small: true })) : null,
  ].filter(Boolean));

  // Scorecard.
  scoreBox.hidden = !card.n;
  emptyScore.replaceChildren(...(card.n ? [] : [note("", "The calibration chart and the score over time appear here once at least one prediction is resolved. Open the example log to see what they look like with a few months of forecasts.")]));
  if (card.n) drawScore(card);
}

function drawScore(card) {
  const range = (b) => `${Math.round(b.lo * 100)} to ${pct0(b.hi)}`;
  const filled = card.bins.filter((b) => b.n);
  calChart.update({
    series: [
      { name: "Perfect calibration", type: "line", data: [{ x: 0, y: 0, label: "Perfect calibration" }, { x: 1, y: 1, label: "Perfect calibration" }], color: "#16233b", width: 1.5, dash: true },
      { name: "Your forecasts", type: "scatter", color: 0, data: filled.map((b) => ({ x: b.meanP, y: b.rate, r: Math.min(14, 4 + 1.8 * Math.sqrt(b.n)), label: `Said ${range(b)}: ${b.happened} of ${b.n} came true` })) },
    ],
    marks: [
      { type: "text", x: 0.03, y: 0.95, text: "Happened more often than you said" },
      { type: "text", x: 0.97, y: 0.04, text: "Happened less often than you said", anchor: "end" },
    ],
  });
  calTable.replaceChildren(table({
    caption: "The same groups as a table",
    columns: [
      { key: "range", label: "You said" },
      { key: "said", label: "On average", num: true },
      { key: "rate", label: "Came true", num: true },
      { key: "gap", label: "Gap", num: true },
    ],
    rows: card.bins.map((b, i) => ({
      range: range(b, i === card.bins.length - 1),
      said: b.n ? pct0(b.meanP) : "–",
      rate: b.n ? `${b.happened} of ${b.n}, ${pct0(b.rate)}` : "0 forecasts",
      gap: b.n ? fmt.signed((b.rate - b.meanP) * 100, 0) : "–",
    })),
  }), el("p", { class: "small muted", text: "Each range includes its lower end. Gap is how often it came true minus what you said, in percentage points: negative means you were too sure it would happen." }));

  // One point per day on which something resolved.
  const byDay = new Map();
  for (const t of card.timeline) byDay.set(dayNumber(t.date), t.mean);
  const points = [...byDay.entries()];
  const first = points[0][0], last = points.at(-1)[0];
  const top = Math.max(0.5, ...points.map(([, v]) => v)) > 0.5 ? 1 : 0.5;
  timeChart.update({
    x: { label: "Date resolved", domain: [first - 1, Math.max(last, first + 13) + 1], format: dayLabel, ticks: timeBox.clientWidth < 480 ? 3 : 4 },
    y: { label: "Mean Brier score", domain: [0, top], format: (v) => fmt.num(v, 2) },
    series: [{ name: "Mean Brier score so far", type: "line", data: points, color: 0 }],
    marks: [{ type: "hline", y: COIN, text: "always saying 50%: 0.25" }, { type: "point", x: last, y: points.at(-1)[1], r: 4.5 }],
  });

  const { reliability, resolution, uncertainty } = card.parts;
  partsBox.replaceChildren(table({
    caption: "Where the score comes from",
    columns: [{ key: "part", label: "Part" }, { key: "value", label: "Value", num: true }, { key: "meaning", label: "What it means" }],
    rows: [
      { part: "Calibration error", value: fmt.num(reliability, 3), meaning: "How far each probability you used was from how often it came true. Lower is better." },
      { part: "Resolution", value: `− ${fmt.num(resolution, 3)}`, meaning: "How well your probabilities separated what happened from what did not. Higher is better." },
      { part: "Uncertainty", value: `+ ${fmt.num(uncertainty, 3)}`, meaning: `Fixed by the questions: ${pct0(card.baseRate)} of the statements came true.` },
      { part: "Mean Brier score", value: `= ${fmt.num(card.brier, 3)}`, meaning: "The three parts add up exactly." },
    ],
  }));
}

drawTry();
render();
