// Day 120: Bayesian Event Forecaster. Interface.
import { $, $$, el, fmt, mount, select, segmented, numberField, textField, textArea, button, stat, note, table, chart, store, download } from "../kit/kit.js";
import {
  FORMAT, VERSION, LIMITS, localToday, isDate, logit, sigmoid, CLASSES, classByKey, WINDOWS, classCounts, laplace, DATA_END, DATA_START,
  parseRatio, parsePercent, checkCounts, path, brier, logScore, COIN, scorecard, checkNews, checkForecast, resolve, toJSON,
  parseImport, mergeInto, restore, firstFlight, PRESETS, ILLUSTRATION, outsideView, newId,
} from "./logic.js";

mount();

const app = $("#app");
const db = store("day120");
const KEY = "365:day120:log";
const FEW = 8;
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const date = (iso) => DATE.format(new Date(`${iso}T00:00:00Z`));
// A forecast held as log-odds L, written without rounding to 0% or 100% however extreme it is.
const pctL = (L) => {
  const small = sigmoid(-Math.abs(L));
  if (small >= 0.001) return pct(sigmoid(L));
  if (small < 1e-6) return L > 0 ? "more than 99.9999%" : "less than 0.0001%";
  return pct(L > 0 ? 1 - small : small);
};
// A percentage that never reads 0% or 100% unless it is: past 99.9% it keeps the decimals that show how near it is.
const pct = (p) => {
  if (p === 0 || p === 1) return `${p * 100}%`;
  if (p >= 0.001 && p <= 0.999) return `${fmt.num(p * 100, 1)}%`;
  const small = Math.min(p, 1 - p);
  if (small < 1e-6) return p > 0.5 ? "more than 99.9999%" : "less than 0.0001%";
  const digits = Math.min(8, 1 - Math.floor(Math.log10(small * 100)));
  const near = Number((small * 100).toPrecision(2));
  return `${String(Number((p > 0.5 ? 100 - near : near).toFixed(digits)))}%`;
};
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
const short = (s, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ratioText = (r) => {
  const big = (v) => (v >= 1e12 ? "more than a trillion" : v >= 1e6 ? `${Number((v / 1e6).toPrecision(3))} million` : v >= 1000 ? fmt.int(v) : String(Number(v.toPrecision(3))));
  return r >= 0.001 ? `×${big(r)}` : `÷${big(1 / r)}`;
};

const state = {
  mine: null, example: outsideView(), view: "example", shown: FEW, flash: null, unsaved: false, newer: null,
  draft: null,
};

/* ---------- loading what is saved ---------- */
// Can this browser keep anything at all? (Storage switched off, or full.)
const storageOff = !db.set("probe", 1);
db.remove("probe");
const newerText = (v) => `The forecasts saved in this browser were written by a newer version of this page (format version ${v}; this one reads version ${VERSION}), so this page will not read or change them. Reload the page to get the latest version.`;
{
  const restored = restore(db.get("log"), localToday());
  let raw = null, had = null;
  try { raw = localStorage.getItem(KEY); had = JSON.parse(raw)?.forecasts?.length ?? null; } catch { /* storage off, or not JSON */ }
  if (restored?.length) { state.mine = restored; state.view = "mine"; }
  const kept = restored ? restored.length : null;
  if (restored?.newer) { state.newer = restored.newer; state.unsaved = true; }
  else if (raw != null && (kept === null || kept !== had)) {
    try { localStorage.setItem(`${KEY}-unread`, raw); } catch { /* nothing more to do */ }
    state.flash = { kind: "bad", text: `${!kept ? "The forecasts saved in this browser could not be read, so the example is shown." : `Only ${kept} of the ${had} forecasts saved in this browser could be read.`} The saved data has not been deleted: a copy is under the storage key ${KEY}-unread.` };
  }
}
const shown = () => (state.view === "mine" ? state.mine ?? [] : state.example);

// The one place that writes. It never overwrites forecasts written by a newer version of the page. A failure is
// shown by renderLog() for as long as it lasts, so a success message cannot hide it.
function save() {
  const stored = db.get("log");
  state.newer = typeof stored?.version === "number" && stored.version > VERSION ? stored.version : null;
  state.unsaved = Boolean(state.newer) || !db.set("log", { format: FORMAT, version: VERSION, forecasts: state.mine });
}
function syncFromStorage() {
  if (state.unsaved) return;
  const theirs = restore(db.get("log"), localToday());
  if (theirs?.newer) { state.newer = theirs.newer; state.unsaved = true; renderLog(); return; }
  if (JSON.stringify(theirs) === JSON.stringify(state.mine)) return;
  state.mine = theirs;
  if (state.view === "mine") {
    state.flash = { kind: "warn", text: theirs ? "Your forecasts were changed in another tab or window. This one now shows the latest version." : "Your forecasts were erased in another tab or window. What you see now is the example." };
    if (!theirs) state.view = "example";
  }
  renderLog();
}
window.addEventListener("storage", (e) => { if (e.key === null || e.key === KEY) syncFromStorage(); });
window.addEventListener("pageshow", (e) => { if (e.persisted) syncFromStorage(); });

let focusNext = null;
const keyed = (node, key) => { node.dataset.fk = key; return node; };

/* ---------- the forecast being made ---------- */
const presetOptions = [
  { value: "illustration", label: "Illustration: a made-up rocket" },
  ...PRESETS.map((p) => { const f = firstFlight(p.type); return { value: p.key, label: `${p.event.replace(" reaches orbit on its first flight", "")}, first flight, ${date(f.date)}` }; }),
  { value: "blank", label: "A blank forecast of my own" },
];
const presetSelect = select({ label: "Start from", options: presetOptions, value: "illustration", hint: "The named rockets are past launches with known outcomes. The outcome stays hidden until you save your forecast.", onChange: (v) => loadPreset(v) });
const eventText = textArea({ label: "The event", rows: 2, placeholder: "Something that will or will not happen, such as: The new rocket reaches orbit on its first flight" });
const eventMsg = el("div");
const dateField = (() => {
  const id = "ef-date";
  const input = el("input", { type: "date", id, min: "1900-01-01", max: "2100-12-31" });
  return { el: el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: id, text: "Date of the event" })), input, el("div", { class: "hint", text: "Launch data count only launches before this day, so a past event is forecast with what was known then." })), input };
})();
const classSelect = select({
  label: "Reference class", value: "family",
  options: [...CLASSES.map((c) => ({ value: c.key, label: c.label })), { value: "counts", label: "My own: k of n similar cases happened" }, { value: "percent", label: "My own: a percentage" }],
  onChange: () => { state.draft.refKey = classSelect.value; refresh(); },
});
const windowSeg = segmented({ label: "Count launches from", value: "all", options: Object.entries(WINDOWS).map(([value, label]) => ({ value, label })), onChange: (v) => { state.draft.window = v; refresh(); } });
const kField = numberField({ label: "How many similar cases happened (k)", min: 0, max: LIMITS.countMax, step: 1, value: 3 });
const nField = numberField({ label: "Out of how many similar cases (n)", min: 1, max: LIMITS.countMax, step: 1, value: 10 });
const ownLabel = textField({ label: "What the cases are (optional)", placeholder: "My train home over the last 10 weekdays" });
const pctField = textField({ label: "Base rate", placeholder: "25%", hint: "Between 0.1% and 99.9%." });
const refMsg = el("div");
const baseLine = el("p", { class: "small ef-base" });
const compareBox = el("div");
const ownCounts = el("div", { class: "controls" }, kField.el, nField.el, ownLabel.el);
for (const f of [kField, nField]) f.input.addEventListener("input", () => refresh());
pctField.input.addEventListener("input", () => refresh());
ownLabel.input.addEventListener("input", () => refresh());
dateField.input.addEventListener("input", () => refresh());
dateField.input.addEventListener("change", () => refresh());
eventText.input.addEventListener("input", () => refresh());

// News for the forecast being made.
const newsText = textField({ label: "News", placeholder: "The final rehearsal went without a fault" });
const newsRatio = textField({ label: "How many times more likely is this news if the event will happen?", placeholder: "1.5, or 1/2 if half as likely", hint: "A likelihood ratio: 2 means the news is twice as likely if the event is going to happen. 1 means it tells you nothing." });
const newsMsg = el("div");
const newsList = el("ol", { class: "ef-news" });
const addNewsBtn = button("Add news", () => addNews(), { small: true });
for (const f of [newsText, newsRatio]) f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addNews(); } });
function addNews() {
  for (const f of [newsText, newsRatio]) f.input.classList.remove("invalid");
  if (state.draft.news.length >= LIMITS.newsItems) { newsMsg.replaceChildren(note("bad", `A forecast holds up to ${LIMITS.newsItems} news items.`)); return; }
  const c = checkNews({ text: newsText.value, ratio: newsRatio.value });
  if (c.error) {
    newsMsg.replaceChildren(note("bad", c.error));
    const f = c.field === "text" ? newsText : newsRatio;
    f.input.classList.add("invalid");
    f.input.focus();
    return;
  }
  state.draft.news.push({ id: newId("n"), ...c.item, added: localToday() });
  newsText.value = newsRatio.value = "";
  newsMsg.replaceChildren();
  refresh();
  newsText.input.focus();
}

const saveBtn = button("Save to my forecasts", () => saveDraft(), { primary: true });
const saveMsg = el("div");

/* ---------- your data ---------- */
const fileInput = el("input", { type: "file", accept: ".json,application/json", hidden: true, "aria-label": "Forecast file" });
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  const refuse = (text) => { state.flash = { kind: "bad", text }; renderLog(); };
  if (file.size > LIMITS.fileBytes) return refuse(`${short(file.name, 60)} is ${fmt.num(file.size / 1e6, 1)} MB. A full list of ${fmt.int(LIMITS.forecasts)} forecasts is smaller than ${LIMITS.fileBytes / 1e6} MB, so this is not one, and it was not read.`);
  let text = "";
  try { text = await file.text(); } catch { /* reported as empty */ }
  const res = parseImport(text, localToday());
  if (res.error) return refuse(res.error);
  const merged = mergeInto(state.mine ?? [], res.forecasts);
  const parts = [`${plural(merged.added, "forecast", "forecasts")} added from ${short(file.name, 60)}.`];
  if (merged.duplicates) parts.push(`${plural(merged.duplicates, "forecast", "forecasts")} already in your list ${merged.duplicates === 1 ? "was" : "were"} left alone.`);
  if (merged.overLimit) parts.push(`${plural(merged.overLimit, "forecast", "forecasts")} left out because the list holds ${fmt.int(LIMITS.forecasts)}.`);
  if (res.problems.length) parts.push(`${plural(res.problems.length, "record", "records")} could not be read. ${res.problems.slice(0, 3).join(" ")}${res.problems.length > 3 ? " And more." : ""}`);
  state.mine = merged.list;
  state.view = "mine";
  state.shown = FEW;
  save();
  state.flash = { kind: res.problems.length || merged.overLimit ? "warn" : "good", text: parts.join(" ") };
  renderLog();
});
const exportBtn = keyed(button("Export JSON", () => {
  if (!state.mine) return;
  download(`event-forecasts-${localToday()}.json`, toJSON(state.mine), "application/json");
  db.set("exported", localToday());
  renderLog();
}, { small: true }), "export");
const importBtn = keyed(button("Import a file", () => fileInput.click(), { small: true, title: "Add the forecasts in a JSON file exported from this page" }), "import");
const eraseBtn = button("Erase my forecasts", () => {
  if (!state.mine || state.newer) return;
  if (!confirm(`Erase all ${plural(state.mine.length, "forecast", "forecasts")} from this browser? Export a copy first if you want to keep them. This cannot be undone.`)) return;
  state.mine = null; state.unsaved = false; state.view = "example"; state.shown = FEW;
  db.remove("log"); db.remove("exported");
  state.flash = { kind: "", text: "Your forecasts have been erased from this browser. What you see now is the example." };
  focusNext = "import"; // Export and Erase are now switched off, and the switch button is hidden
  renderLog();
}, { small: true });
const storageNote = el("p", { class: "small" });
const dataPanel = el("div", { class: "panel ef-data" }, el("h2", { text: "Your data" }), storageNote, el("div", { class: "row" }, exportBtn, importBtn, eraseBtn), fileInput);

const jump = el("a", { class: "ef-jump small", href: "#ef-out" }, "Go to the forecast and the scorecard");
const controls = el("div", { class: "controls" },
  el("h2", { text: "Make a forecast" }), presetSelect.el, eventText.el, eventMsg, dateField.el,
  el("div", { class: "controls ef-ref", role: "group", "aria-label": "Reference class" }, classSelect.el, windowSeg.el, ownCounts, pctField.el, refMsg, baseLine, compareBox),
  el("div", { class: "controls ef-newsform", role: "group", "aria-labelledby": "ef-news-title" },
    el("h2", { id: "ef-news-title", text: "News since the base rate" }), newsList, newsText.el, newsRatio.el, newsMsg, el("div", { class: "row" }, addNewsBtn)),
  el("div", { class: "row" }, saveBtn), saveMsg, jump, dataPanel);

/* ---------- outputs ---------- */
const sBase = stat("Base rate");
const sNow = stat("Forecast now");
const sNews = stat("The news together");
const draftNote = el("div");
const pathBox = el("div");
const banner = el("div", { class: "ef-banner", role: "status" });
const switchBtn = keyed(button("", () => { state.view = state.view === "mine" ? "example" : "mine"; state.shown = FEW; state.flash = null; renderLog(); }, { small: true }), "switch");
const logHead = el("div", { class: "row ef-loghead" });
const logList = el("div", { class: "ef-log", id: "ef-log", tabindex: "-1" });
const sBrier = stat("Mean Brier score");
const sLog = stat("Mean log score");
const sVsBase = stat("Against the base rate alone");
const sCount = stat("Resolved");
const calBox = el("div");
const calTable = el("div");
const scoreEmpty = el("div");
const scoreBody = el("div", { class: "grid2 ef-cal" }, calBox, calTable);
const out = el("div", { class: "out", id: "ef-out", tabindex: "-1" },
  el("h2", { class: "ef-h", text: "This forecast" }), el("div", { class: "stats" }, sBase.el, sNow.el, sNews.el), draftNote, pathBox,
  el("h2", { class: "ef-h ef-sep", text: "Saved forecasts" }), banner, logHead, logList,
  el("h2", { class: "ef-h ef-sep", text: "Scorecard" }), el("div", { class: "stats" }, sBrier.el, sLog.el, sVsBase.el, sCount.el), scoreEmpty, scoreBody);
app.append(el("div", { class: "tool-grid wide-controls" }, controls, out));
const pathChart = chart(pathBox, { height: 240, series: [] });
const calChart = chart(calBox, {
  title: "Calibration",
  subtitle: "Forecasts grouped by the probability given; a bigger dot holds more. On the line, events given 70% happen 70% of the time.",
  label: "Calibration chart: probability given against how often the event happened",
  hover: "point", legend: false,
  x: { label: "Probability given", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
  y: { label: "How often it happened", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
  series: [],
});

/* ---------- the draft ---------- */
function loadPreset(key) {
  const today = localToday();
  const p = PRESETS.find((x) => x.key === key);
  if (p) {
    const f = firstFlight(p.type);
    state.draft = { preset: key, event: p.event, date: f.date, refKey: f.newFamily ? "family" : "version", window: "all", news: [] };
  } else if (key === "illustration") {
    state.draft = { preset: "illustration", event: ILLUSTRATION.event, date: today, refKey: "family", window: "all", news: ILLUSTRATION.news.map((n) => ({ id: newId("n"), ...n, added: today })) };
  } else {
    state.draft = { preset: null, event: "", date: today, refKey: "counts", window: "all", news: [] };
  }
  presetSelect.value = key;
  eventText.value = state.draft.event;
  dateField.input.value = state.draft.date;
  classSelect.value = state.draft.refKey;
  windowSeg.value = state.draft.window;
  for (const f of [newsText, newsRatio]) { f.value = ""; f.input.classList.remove("invalid"); }
  newsMsg.replaceChildren(); saveMsg.replaceChildren(); eventMsg.replaceChildren();
  refresh();
}

/** Work out the base rate from the form. Returns { base, ref, text } or { error }. */
function readReference() {
  const d = state.draft;
  const day = dateField.input.value;
  if (!isDate(day)) return { error: "Pick the date of the event." };
  if (d.refKey === "counts") {
    const k = Number(kField.input.value), n = Number(nField.input.value);
    const bad = kField.input.value.trim() === "" || nField.input.value.trim() === "";
    const c = bad ? { error: "Fill in both numbers: how many similar cases happened, out of how many." } : checkCounts(k, n);
    if (c.error) return c;
    const label = ownLabel.value.replace(/\s+/g, " ").trim().slice(0, 120) || "A reference class of my own";
    return { base: laplace(k, n), ref: { key: "counts", label, k, n, window: "all" }, text: `${fmt.int(k)} of ${fmt.int(n)} similar cases happened: ${pct(k / n)}. By Laplace's rule the base rate is (${fmt.int(k)} + 1) / (${fmt.int(n)} + 2) = ${pct(laplace(k, n))}.` };
  }
  if (d.refKey === "percent") {
    const r = parsePercent(pctField.value);
    if (r.error) return r;
    return { base: r.value, ref: { key: "percent", label: "A percentage of my own", k: null, n: null, window: "all" }, text: `Base rate as you gave it: ${pct(r.value)}.` };
  }
  const cls = classByKey(d.refKey);
  const c = classCounts(d.refKey, day, d.window);
  const base = laplace(c.k, c.n);
  const span = c.n ? `from ${date(c.from)} to ${date(c.to)}` : "";
  const late = day > DATA_END ? ` The data end on ${date(DATA_END)}; launches after that are not counted.` : "";
  const text = c.n
    ? `${fmt.int(c.k)} of ${fmt.int(c.n)} ${cls.short} ${span} reached orbit: ${pct(c.k / c.n)}. By Laplace's rule the base rate is (${fmt.int(c.k)} + 1) / (${fmt.int(c.n)} + 2) = ${pct(base)}.${late}`
    : `No ${cls.short} are recorded before ${date(day)}${d.window === "last20" ? " in the 20 years before it" : ""} (the records start on ${date(DATA_START)}), so Laplace's rule gives 50%.`;
  return { base, ref: { key: d.refKey, label: cls.label, k: c.k, n: c.n, window: d.window }, text };
}

let current = null; // { base, ref, path } for the draft as it stands
function refresh() {
  const d = state.draft;
  d.event = eventText.value;
  d.date = dateField.input.value;
  // A preset is a particular event on a particular day. Change either and it is a forecast of your own, so saving
  // must not reveal (and record) the preset's outcome, and an edited illustration is no longer the illustration.
  const was = PRESETS.find((p) => p.key === d.preset);
  if ((was && (d.event !== was.event || d.date !== firstFlight(was.type).date)) || (d.preset === "illustration" && d.event !== ILLUSTRATION.event)) {
    d.preset = null;
    presetSelect.value = "blank";
  }
  const own = d.refKey === "counts" || d.refKey === "percent";
  windowSeg.el.hidden = own;
  ownCounts.hidden = d.refKey !== "counts";
  pctField.el.hidden = d.refKey !== "percent";
  kField.input.classList.remove("invalid"); nField.input.classList.remove("invalid"); pctField.input.classList.remove("invalid");
  const ev = d.event.replace(/\s+/g, " ").trim();
  eventMsg.replaceChildren(...(ev.length > LIMITS.event ? [note("bad", `Keep the event to ${LIMITS.event} characters; it has ${fmt.int(ev.length)}.`)] : []));

  const ref = readReference();
  if (ref.error) {
    refMsg.replaceChildren(note("bad", ref.error));
    if (d.refKey === "counts") { kField.input.classList.add("invalid"); nField.input.classList.add("invalid"); }
    if (d.refKey === "percent") pctField.input.classList.add("invalid");
    baseLine.textContent = "";
    current = null;
  } else {
    refMsg.replaceChildren();
    baseLine.textContent = ref.text;
    current = { ...ref, path: path(ref.base, d.news) };
  }

  // Every launch class for this date, side by side: the reference class problem in one table.
  if (isDate(d.date) && !own) {
    compareBox.replaceChildren(table({
      caption: `The four launch classes before ${date(d.date)}${d.window === "last20" ? ", last 20 years" : ""}`,
      columns: [{ key: "label", label: "Class" }, { key: "counts", label: "Reached orbit", num: true }, { key: "rate", label: "Base rate", num: true }],
      rows: CLASSES.map((c) => { const n = classCounts(c.key, d.date, d.window); return { label: c.tiny + (c.key === d.refKey ? " (chosen)" : ""), counts: `${fmt.int(n.k)} of ${fmt.int(n.n)}`, rate: pct(laplace(n.k, n.n)) }; }),
    }));
  } else compareBox.replaceChildren();

  // News list.
  newsList.replaceChildren(...d.news.map((n, i) => {
    const del = keyed(button("Remove", () => {
      d.news.splice(i, 1);
      newsMsg.replaceChildren(); // a message about the list being full no longer applies
      focusNext = d.news[i] ? `news:${d.news[i].id}` : d.news[i - 1] ? `news:${d.news[i - 1].id}` : "newsText";
      refresh();
    }, { small: true }), `news:${n.id}`);
    del.setAttribute("aria-label", `Remove news ${i + 1}: ${short(n.text, 60)}`);
    return el("li", {}, el("span", { class: "ef-newstext", text: `${n.text} ` }), el("strong", { text: ratioText(n.ratio) }), " ", del);
  }));
  newsList.hidden = !d.news.length;
  addNewsBtn.disabled = d.news.length >= LIMITS.newsItems;

  const preset = PRESETS.find((p) => p.key === d.preset);
  saveBtn.textContent = preset ? "Save and see what happened" : "Save to my forecasts";

  // Tiles and the path chart.
  if (!current) {
    sBase.set("–", "fix the reference class"); sNow.set("–", ""); sNews.set("–", "");
    pathChart.update({ series: [], marks: [], empty: "No base rate yet: see the message beside the reference class" });
    draftNote.replaceChildren();
  } else {
    const fp = current.path;
    sBase.set(pct(current.base), current.ref.n != null ? `${fmt.int(current.ref.k)} of ${fmt.int(current.ref.n)}, by Laplace's rule` : "as you gave it");
    sNow.set(pctL(fp.L), d.news.length ? `after ${plural(d.news.length, "news item", "news items")}` : "no news yet: the base rate alone");
    sNews.set(d.news.length ? ratioText(fp.ratio) : "×1", d.news.length ? "the odds are multiplied by this" : "add news to move the forecast");
    const notes = [];
    if (d.preset === "illustration") notes.push(note("warn", "This is an illustration: the rocket and the two news items are made up, and so are the news items' strengths. The base rate is real: it comes from the launch records up to the date shown."));
    if (preset) notes.push(note("", `A real launch on ${date(d.date)}. The base rate counts only launches before that day. Add any news you think was known then, and save to see what happened.`));
    draftNote.replaceChildren(...notes);
    pathChart.update({
      title: "From base rate to forecast",
      subtitle: "The base rate, then the forecast after each news item.",
      label: "Line chart of the forecast probability after each news item",
      x: { label: "News", domain: [0, Math.max(1, d.news.length)], format: (v) => (v === 0 ? "base" : Number.isInteger(v) ? String(v) : ""), ticks: Math.min(8, Math.max(1, d.news.length)) },
      y: { label: "Probability (%)", domain: [0, 100], format: (v) => `${fmt.num(v, 0)}%` },
      series: [{ name: "Forecast", type: "line", color: 0, data: fp.steps.map((s, i) => [i, s.p * 100]) }],
      marks: [{ type: "hline", y: 50, text: "50%" }],
      empty: "",
    });
  }
  const want = focusNext;
  focusNext = null;
  if (want === "newsText") newsText.input.focus();
  else if (want) $$("[data-fk]", controls).find((n) => n.dataset.fk === want)?.focus();
}

function saveDraft() {
  saveMsg.replaceChildren();
  if (!current) { saveMsg.replaceChildren(note("bad", "The base rate is not set. Fix the reference class first.")); return; }
  const d = state.draft;
  const preset = PRESETS.find((p) => p.key === d.preset);
  const today = localToday();
  let outcome = null, resolved = null;
  if (preset) { outcome = firstFlight(preset.type).ok ? 1 : 0; resolved = today; }
  const f = { id: newId("f"), event: d.event, date: d.date, made: today, ref: current.ref, base: current.base, news: d.news.map((n) => ({ ...n })), outcome, resolved, preset: d.preset };
  const c = checkForecast(f);
  if (c.error) { saveMsg.replaceChildren(note("bad", c.error)); return; }
  if ((state.mine?.length ?? 0) >= LIMITS.forecasts) { saveMsg.replaceChildren(note("bad", `The list holds ${fmt.int(LIMITS.forecasts)} forecasts. Export it and erase old ones to add more.`)); return; }
  const first = !state.mine;
  state.mine = [...(state.mine ?? []), c.forecast];
  state.view = "mine";
  state.shown = FEW;
  save();
  const fp = path(f.base, f.news);
  if (preset) {
    const happened = outcome === 1;
    const verdict = `${happened ? "It happened" : "It did not happen"}: GCAT records the launch as ${happened ? "reaching orbit" : "a failure"}. Your forecast of ${pctL(fp.L)} scores ${fmt.num(brier(fp.p, outcome), 3)} on the Brier score and ${fmt.num(logScore(fp.L, outcome), 2)} on the log score; the base rate alone, ${pct(f.base)}, would have scored ${fmt.num(brier(f.base, outcome), 3)} and ${fmt.num(logScore(logit(f.base), outcome), 2)}.`;
    saveMsg.replaceChildren(note(happened === fp.p > 0.5 ? "good" : "warn", verdict));
    state.flash = { kind: "good", text: `Saved and resolved. ${verdict}` };
  } else {
    saveMsg.replaceChildren(note("good", "Saved to your forecasts. When the day comes, say what happened in the list."));
    state.flash = { kind: "good", text: first ? "Your own list has started with this forecast, and the example has been put away. When the event is decided, say what happened." : "Saved. When the event is decided, say what happened." };
  }
  renderLog();
}

/* ---------- the saved list and the scorecard ---------- */
function logItem(f, mine) {
  const fp = path(f.base, f.news);
  const act = (label, fn) => { const b = keyed(button(label, fn, { small: true }), `${f.id}:${label}`); b.setAttribute("aria-label", `${label}: ${short(f.event, 60)}`); return b; };
  const meta = [`${date(f.date)} · ${f.ref.label}${f.ref.n != null ? ` (${fmt.int(f.ref.k)} of ${fmt.int(f.ref.n)})` : ""}: base ${pct(f.base)}`];
  if (f.news.length) meta.push(`, ${plural(f.news.length, "news item", "news items")} ${ratioText(fp.ratio)}`);
  const scores = f.outcome === null ? [] : [el("p", { class: "small" },
    el("span", { class: `ef-pill ${f.outcome ? "yes" : "no"}`, text: f.outcome ? "Happened" : "Did not happen" }),
    ` Brier ${fmt.num(brier(fp.p, f.outcome), 3)}, log ${fmt.num(logScore(fp.L, f.outcome), 2)}`,
    f.news.length ? ` (base rate alone: ${fmt.num(brier(f.base, f.outcome), 3)}, ${fmt.num(logScore(logit(f.base), f.outcome), 2)})` : "")];
  const actions = !mine ? [] : f.outcome === null
    ? [act("Happened", () => setOutcome(f.id, true)), act("Did not happen", () => setOutcome(f.id, false))]
    : f.preset && PRESETS.some((p) => p.key === f.preset) ? [] : [act("Undo", () => setOutcome(f.id, null))];
  if (mine) actions.push(act("Delete", (e) => {
    if (!confirm(`Delete this forecast?\n\n"${short(f.event, 120)}"\n\nThis cannot be undone.`)) return;
    const li = e.currentTarget.closest("li");
    focusNext = (li.nextElementSibling ?? li.previousElementSibling)?.querySelector("[data-fk]")?.dataset.fk ?? "switch";
    state.mine = state.mine.filter((x) => x.id !== f.id);
    if (!state.mine.length) { state.mine = null; if (!state.newer) db.remove("log"); state.view = "example"; state.flash = { kind: "", text: "That was your last forecast, so nothing is saved now. The example is back." }; }
    else { save(); state.flash = { kind: "", text: "Deleted." }; }
    renderLog();
  }));
  return el("li", { class: "ef-item" },
    el("div", { class: "ef-p", text: pctL(fp.L) }),
    el("div", {}, el("p", { class: "ef-event", text: f.event }), el("p", { class: "small muted" }, meta), ...scores,
      actions.length ? el("div", { class: "row ef-actions" }, actions) : null));
}
function setOutcome(id, happened) {
  const res = resolve(state.mine, id, happened, localToday());
  if (res.error) { state.flash = { kind: "bad", text: res.error }; renderLog(); return; }
  state.mine = res.list;
  save();
  focusNext = happened === null ? `${id}:Happened` : `${id}:Undo`;
  state.flash = { kind: "good", text: happened === null ? "Reopened." : `Recorded as ${happened ? "happened" : "did not happen"}.` };
  renderLog();
}

function renderLog({ scores = true } = {}) {
  const had = document.activeElement?.dataset?.fk ?? null;
  const example = state.view === "example";
  const list = shown();
  const top = [];
  if (example) top.push(note("warn", el("strong", { text: "This is an example, not your list. " }),
    `It is the outside view tested on the past: each of the ${list.length} first orbital attempts of a new rocket type, as GCAT names types, from 2000 to 2025, forecast with only the base rate of its class known the day before (a new family or a new version of an existing rocket). Nothing here is saved. `,
    state.mine ? "" : "Save a forecast to start your own list."));
  if (state.unsaved) top.push(note("bad", state.newer ? newerText(state.newer) : "This browser would not save the change, perhaps because storage is full or switched off. Export your forecasts now so that nothing is lost."));
  if (state.flash) top.push(note(state.flash.kind, state.flash.text));
  const said = top.map((n) => n.textContent).join("|");
  if (said !== banner.dataset.said) { banner.replaceChildren(...top); banner.dataset.said = said; }
  state.flash = null;

  switchBtn.textContent = example ? `Show my forecasts (${state.mine?.length ?? 0})` : "Show the example";
  switchBtn.hidden = example && !state.mine;
  logHead.replaceChildren(el("p", { class: "small muted", text: example ? "Newest first." : `${plural(list.length, "forecast", "forecasts")}, newest first.` }), switchBtn);

  const ordered = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const hidden = Math.max(0, ordered.length - state.shown);
  logList.replaceChildren(...[
    ordered.length ? el("ol", { class: "ef-list" }, ordered.slice(0, state.shown).map((f) => logItem(f, !example))) : el("p", { class: "small muted", text: "No forecasts yet." }),
    ordered.length > FEW ? el("div", { class: "row" },
      hidden ? keyed(button(hidden <= 50 ? `Show all ${ordered.length}` : "Show 50 more", () => { state.shown += 50; focusNext = "more"; renderLog({ scores: false }); }, { small: true }), "more") : null,
      state.shown > FEW ? keyed(button(`Show only the newest ${FEW}`, () => { state.shown = FEW; focusNext = "switch"; renderLog({ scores: false }); }, { small: true }), "fewer") : null) : null,
  ].filter(Boolean)); // replaceChildren would print the word "null" for an empty slot

  // Scorecard. Showing more or fewer of the list leaves it as it is.
  const card = scores ? scorecard(list) : null;
  if (!card) { /* unchanged */ } else if (card.n) {
    sBrier.set(fmt.num(card.final.brier, 3), `0 is perfect; always saying 50% scores ${fmt.num(COIN.brier, 2)}`);
    sLog.set(fmt.num(card.final.log, 2), `0 is perfect; always saying 50% scores ${fmt.num(COIN.log, 2)}`);
    const gain = card.base.brier - card.final.brier;
    sVsBase.set(Math.abs(gain) < 0.0005 ? "The same" : `${fmt.num(Math.abs(gain), 3)} ${gain > 0 ? "better" : "worse"}`,
      Math.abs(gain) < 0.0005 ? (list.every((f) => !f.news.length) ? "no news was added, so the forecasts are the base rates" : "the news changed the Brier score by less than 0.001") : `Brier score with the news, against ${fmt.num(card.base.brier, 3)} with the base rate alone`);
    sCount.set(`${fmt.int(card.n)} of ${fmt.int(card.total)}`, `${pct(card.rate)} of them happened`);
    scoreEmpty.replaceChildren(...(example ? [note("", `With one base rate for every first orbital attempt of a new type, instead of one for new families and one for new versions, the same ${list.length} forecasts score ${fmt.num(exampleSingle.final.brier, 3)}: the finer reference class separates likelier launches from less likely ones.`)] : []));
    scoreBody.hidden = false;
    drawCalibration(card);
  } else {
    for (const s of [sBrier, sLog, sVsBase]) s.set("–", "appears once a forecast is resolved");
    sCount.set(`0 of ${fmt.int(card.total)}`, "say what happened to see your scores");
    scoreEmpty.replaceChildren(note("", "The scores and the calibration chart appear once at least one of your forecasts is resolved. Press \"Show the example\" to see them for the outside view on real launches."));
    scoreBody.hidden = true;
  }

  const exported = db.get("exported");
  const risks = "Clearing the browser's site data deletes it, and Safari deletes it after seven days of use in which this page is not visited, so export a copy now and then.";
  storageNote.textContent = state.unsaved || storageOff
    ? `${state.mine ? `Your ${plural(state.mine.length, "forecast is", "forecasts are")} not being saved` : "Nothing you save will be kept"}: ${state.newer ? "a newer version of this page has saved forecasts in this browser, so reload the page" : "this browser's storage is full or switched off"}. Export a copy before you close the page.`
    : state.mine
      ? `${plural(state.mine.length, "forecast is", "forecasts are")} kept in this browser only and sent nowhere. ${risks} ${typeof exported === "string" && /^\d{4}-\d\d-\d\d$/.test(exported) ? `Last exported on ${date(exported)}.` : "Not exported yet."}`
      : `A forecast you save is kept in this browser only and sent nowhere. ${risks}`;
  exportBtn.disabled = !state.mine;
  eraseBtn.disabled = !state.mine || Boolean(state.newer);

  const want = focusNext ?? had;
  focusNext = null;
  if (want) ($$("[data-fk]", app).find((n) => n.dataset.fk === want && !n.disabled && !n.hidden) ?? logList)?.focus();
}
const exampleSingle = scorecard(outsideView({ single: true }));

function drawCalibration(card) {
  const range = (b) => `${Math.round(b.lo * 100)} to ${fmt.pct(b.hi, 0)}`;
  const filled = card.bins.filter((b) => b.n);
  calChart.update({
    series: [
      { name: "Perfect calibration", type: "line", hover: false, data: [[0, 0], [1, 1]], color: "#16233b", width: 1.5, dash: true },
      { name: "Forecasts", type: "scatter", color: 0, data: filled.map((b) => ({ x: b.meanP, y: b.freq, r: Math.min(14, 4 + 1.6 * Math.sqrt(b.n)), label: `Given ${range(b)}: ${b.happened} of ${b.n} happened` })) },
    ],
  });
  calTable.replaceChildren(table({
    caption: "The same groups as a table",
    columns: [{ key: "range", label: "Given" }, { key: "said", label: "On average", num: true }, { key: "freq", label: "Happened", num: true }],
    rows: card.bins.map((b) => ({ range: range(b), said: b.n ? pct(b.meanP) : "–", freq: b.n ? `${b.happened} of ${b.n}, ${pct(b.freq)}` : "none" })),
  }), el("p", { class: "small muted", text: `Each group includes its lower end. The groups are ${card.bins.length === 10 ? "10 points wide, because at least 60 forecasts are resolved" : "20 points wide; they become 10 points wide once 60 forecasts are resolved"}.` }));
}

loadPreset("illustration");
renderLog();
