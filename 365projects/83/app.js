// Day 83: Credit Risk Model. Interface.
import { $, el, fmt, mount, slider, select, segmented, checkbox, button, stat, note, chart, rng } from "../kit/kit.js";
import { CREDIT } from "./data.js";
import {
  EDUCATION, MARRIAGE, STATUS, INPUTS, DEFAULT_INPUTS, PROTECTED, RULES, LIMITS, UTIL_RANGE,
  decode, splitTest, designRow, rowProfile, columnsOf, createFit, linear, sigmoid, predictWithInterval, createStore, fillStore,
  matrixFromStore, predictFromStore, scores, reliability, groupMeasures, cutoffs, chouldechovaFpr, columnMeans, contributions,
  readProfile, auc, statusGroup,
} from "./logic.js";

mount();

/* ---------- the data, split once ---------- */
const D = decode(CREDIT);
const isTest = splitTest(D.n);
const TRAIN = [], TEST = [];
for (let i = 0; i < D.n; i++) (isTest[i] ? TEST : TRAIN).push(i);
const yTrain = TRAIN.map((i) => D.y[i]), yTest = TEST.map((i) => D.y[i]);
const BASE = yTrain.reduce((a, b) => a + b, 0) / yTrain.length;

/* ---------- formatting ---------- */
const pct = (x, d = 1) => (Number.isFinite(x) ? fmt.pct(x, d) : "–");
const pts = (x, d = 1) => (Number.isFinite(x) ? `${fmt.signed(x * 100, d)} points` : "–");
const ntd = (x) => `NT$${fmt.int(x)}`;
const say = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const keyOf = (keys) => INPUTS.map((f) => f.key).filter((k) => keys.includes(k)).join(",") || "none";

/* ---------- state ---------- */
const state = { inputs: new Set(DEFAULT_INPUTS), protected: "sex", cut: 0.5, rule: "one", pickSeed: 0, picked: null };
const fits = new Map();      // inputs key -> { keys, fit, pTr, pTe, means, scores }
const proxies = new Map();   // attribute|inputs key -> AUC of predicting the attribute from those inputs

/* ---------- examples (made up, to show the tool; not real people) ---------- */
const EXAMPLES = [
  { label: "Up to date, average limit", profile: { limit: 140000, age: 34, edu: 1, mar: 1, sex: 2, status: 0, late: 0, bill: 22000, paid: 2100 } },
  { label: "Two months behind", profile: { limit: 50000, age: 27, edu: 1, mar: 1, sex: 1, status: 2, late: 2, bill: 48000, paid: 0 } },
  { label: "High limit, pays in full", profile: { limit: 500000, age: 45, edu: 0, mar: 0, sex: 1, status: -1, late: 0, bill: 8000, paid: 8000 } },
];

/* ---------- the profile form ---------- */
const mkNum = (id, lim, value) => el("input", { type: "number", id, min: lim.min, max: lim.max, step: "any", value, inputmode: lim.min >= 0 ? "decimal" : null, "aria-describedby": `${id}-msg` });
const mkSel = (id, options, value) => {
  const s = el("select", { id }, options.map((o) => el("option", { value: o.value, text: o.label })));
  s.value = String(value);
  return s;
};
const msg = (id) => el("div", { class: "d83-msg", id: `${id}-msg`, "aria-live": "polite" });
// "Not in the model" sits beside the label in a space kept for it whether shown or not, so that ticking an input never
// moves the rest of the page (on a phone the form is above the list of inputs, and a moving list makes taps miss).
const unused = (id, key) => el("span", { class: "d83-unused", id: `${id}-unused`, "data-unused": key });
const field = (id, key, label, control, hint) => {
  control.setAttribute("aria-describedby", `${id}-unused ${id}-msg`);
  return el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: id, text: label }), unused(id, key)), control, hint ? el("div", { class: "hint", text: hint }) : null, msg(id));
};

const P = EXAMPLES[0].profile;
const box = {
  limit: mkNum("d83-limit", LIMITS.limit, P.limit),
  age: mkNum("d83-age", LIMITS.age, P.age),
  edu: mkSel("d83-edu", EDUCATION.map((label, value) => ({ value, label })), P.edu),
  mar: mkSel("d83-mar", MARRIAGE.map((label, value) => ({ value, label })), P.mar),
  sex: mkSel("d83-sex", [{ value: 2, label: "Female" }, { value: 1, label: "Male" }], P.sex),
  status: mkSel("d83-status", STATUS.map((s) => ({ value: s.code, label: s.label })), P.status),
  late: mkSel("d83-late", [0, 1, 2, 3, 4, 5].map((v) => ({ value: v, label: v === 0 ? "None" : v === 1 ? "1 month" : `${v} months` })), P.late),
  bill: mkNum("d83-bill", LIMITS.bill, P.bill),
  paid: mkNum("d83-paid", LIMITS.paid, P.paid),
};
box.age.step = "1";
const formFields = [
  field("d83-limit", "limit", "Credit limit (NT$)", box.limit, "From NT$10,000 to NT$1,000,000, the range in the data."),
  field("d83-age", "age", "Age (years)", box.age, "21 to 79."),
  field("d83-sex", "sex", "Sex", box.sex),
  field("d83-edu", "edu", "Education", box.edu),
  field("d83-mar", "mar", "Marital status", box.mar),
  field("d83-status", "status", "Repayment status in September 2005", box.status, "The source defines -1 as paying duly and 1 to 9 as months of delay; the data also use -2 and 0, which it does not define."),
  field("d83-late", "late", "Months late from April to August 2005", box.late),
  field("d83-bill", "util", "Bill in September 2005 (NT$)", box.bill, `Divided by the limit; a bill below ${fmt.pct(UTIL_RANGE[0], 0)} or above ${fmt.pct(UTIL_RANGE[1], 0)} of it counts as that much. Negative means the card is in credit.`),
  field("d83-paid", "paid", "Amount paid in September 2005 (NT$)", box.paid),
];
for (const b of Object.values(box)) b.addEventListener(b.tagName === "SELECT" ? "change" : "input", () => { state.picked = null; drawProfile(); });

function setProfile(p) {
  for (const [k, b] of Object.entries(box)) b.value = String(p[k]);
  drawProfile();
}
const pickNote = el("p", { class: "small d83-picked", "aria-live": "polite" });
// On a narrow screen the forecast sits below the whole form, so a line under the examples repeats it.
const mini = el("p", { class: "small d83-mini" });
function pickHeldOut() {
  const r = rng(1000 + state.pickSeed++);
  const i = TEST[Math.floor(r() * TEST.length)];
  const p = rowProfile(D, i);
  p.status = statusGroup(p.status);
  state.picked = i;
  for (const [k, b] of Object.entries(box)) b.value = String(p[k]);
  drawProfile();
}

const examples = el("div", { class: "field" },
  el("div", { class: "lab" }, el("span", { text: "Example profiles" })),
  el("div", { class: "row d83-examples", role: "group", "aria-label": "Example profiles" },
    EXAMPLES.map((ex) => button(ex.label, () => { state.picked = null; setProfile(ex.profile); }, { small: true })),
    button("A held-out cardholder at random", () => pickHeldOut(), { small: true })),
  el("div", { class: "hint", text: "The first three are made up. The last loads a real cardholder from the third of the data the model never saw, and says what happened to them." }),
  mini);

/* ---------- profile output ---------- */
const sPd = stat("Predicted chance of default on the next payment");
const sBand = stat("Held-out cardholders with similar forecasts");
const profileMsg = el("div");
const contribBox = el("div", { class: "d83-contrib" });
const profileStatus = el("p", { class: "sr-only", role: "status" });

/* ---------- model inputs ---------- */
const inputBoxes = INPUTS.map((f) => {
  const c = checkbox({ label: f.label, checked: state.inputs.has(f.key), onChange: (on) => { if (on) state.inputs.add(f.key); else state.inputs.delete(f.key); refresh(); } });
  return { key: f.key, c };
});
const inputsReset = button("Back to the standard inputs", () => {
  state.inputs = new Set(DEFAULT_INPUTS);
  for (const { key, c } of inputBoxes) c.checked = state.inputs.has(key);
  refresh();
}, { small: true });
const progress = el("p", { class: "small muted d83-progress" });
const sAuc = stat("Ranking (AUC)");
const sBrier = stat("Brier score");
const sCal = stat("Average forecast");
const modelNote = el("div");
const coefBox = el("div", { class: "d83-coef-box" });
const coefDetails = el("details", { class: "d83-details" }, el("summary", { text: "Show the fitted coefficients" }), coefBox);

/* ---------- calibration ---------- */
const calBox = el("div");

/* ---------- fairness ---------- */
const protSel = select({ label: "Protected attribute", value: state.protected, options: PROTECTED.map((p) => ({ value: p.value, label: p.label })), onChange: (v) => { state.protected = v; refresh(); } });
const cutSlider = slider({
  label: "Flag a cardholder when the forecast is at least", min: 0.05, max: 0.95, step: 0.01, value: state.cut, format: (v) => fmt.pct(v, 0),
  hint: "\"Flagged\" stands in for a decision such as declining or reviewing a card. No real decision is made here.",
  onInput: (v) => { state.cut = v; drawFairness(); },
});
const ruleSeg = segmented({ label: "Cut-offs", value: state.rule, options: RULES, onChange: (v) => { state.rule = v; drawFairness(); } });
const fairTable = el("div", { class: "d83-rt-box" });
const fairStatus = el("p", { class: "sr-only", role: "status" });
const fairNotes = el("div", { class: "d83-stack" });
const groupCalBox = el("div");
const unawareBox = el("div", { class: "d83-stack" });

/* ---------- layout ---------- */
const jump = el("nav", { class: "row d83-jump", "aria-label": "Jump to a part of the tool" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d83-profile", "a forecast"], ["#d83-model", "the model"], ["#d83-calibration", "calibration"], ["#d83-fairness", "the fairness check"]].map(([href, text]) => el("a", { href, class: "small", text })));

const profilePart = el("section", { class: "d83-part", id: "d83-profile", "aria-labelledby": "d83-h-profile" },
  el("h2", { id: "d83-h-profile", text: "1. A borrower profile in, a chance of default out" }),
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" }, examples, formFields),
    el("div", { class: "out", id: "d83-result" }, pickNote, el("div", { class: "stats" }, sPd.el, sBand.el), profileStatus, profileMsg, contribBox,
      note("warn", "An illustration of the method on cardholders of one Taiwanese bank in 2005. It is not a lending decision, a credit score or advice, and it says nothing reliable about anyone today."))));

const modelPart = el("section", { class: "d83-part", id: "d83-model", "aria-labelledby": "d83-h-model" },
  el("h2", { id: "d83-h-model", text: "2. The model, fitted on 19,998 cardholders" }),
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" },
      el("div", { class: "field", role: "group", "aria-labelledby": "d83-inputs-lab" },
        el("div", { class: "lab" }, el("span", { id: "d83-inputs-lab", text: "Inputs the model uses" })),
        inputBoxes.map((b) => b.c.el),
        el("div", { class: "hint", text: "Untick an input and the model is fitted again without it. Sex is left out to begin with." }),
        el("div", { class: "row" }, inputsReset))),
    el("div", { class: "out" }, progress, el("div", { class: "stats" }, sAuc.el, sBrier.el, sCal.el), modelNote, coefDetails)));

const calPart = el("section", { class: "d83-part", id: "d83-calibration", "aria-labelledby": "d83-h-cal" },
  el("h2", { id: "d83-h-cal", text: "3. Calibration on the 10,002 cardholders held out" }),
  calBox);

const fairPart = el("section", { class: "d83-part", id: "d83-fairness", "aria-labelledby": "d83-h-fair" },
  el("h2", { id: "d83-h-fair", text: "4. The fairness check, on the same held-out cardholders" }),
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" }, protSel.el, cutSlider.el, ruleSeg.el,
      el("p", { class: "small muted", text: "Separate cut-offs are chosen on the training cardholders and then applied to the held-out ones, so the rates they equalise come out close, not exact." })),
    el("div", { class: "out" }, fairStatus, fairTable, fairNotes)),
  groupCalBox, unawareBox);

$("#app").append(jump, profilePart, modelPart, calPart, fairPart);
const calChart = chart(calBox, { series: [], height: 320 });
const groupChart = chart(groupCalBox, { series: [], height: 320 });

/* ---------- fitting, in slices ---------- */
const store = createStore(D);
let job = 0;
function fitInSlices(keys, y, onDone, onStep) {
  const id = job;
  const M = matrixFromStore(store, TRAIN, keys);
  const f = createFit(M.X, y, M.n, M.p);
  const tick = () => {
    if (id !== job) return;
    let done;
    try { done = f.step(); } catch (e) { onDone(null, e); return; }
    onStep?.(f.result.iterations);
    if (done) onDone(f.result, M); else setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
}

/** Make sure every model the current settings need is fitted, one slice at a time, then draw. */
let stored = 0;
function refresh() {
  job++;
  const id = job;
  syncUnused();
  const keys = [...state.inputs];
  const prot = PROTECTED.find((p) => p.value === state.protected);
  const attr = prot.label.split(":")[0].toLowerCase();
  const other = state.inputs.has(prot.input) ? keys.filter((k) => k !== prot.input) : [...keys, prot.input];
  const need = [keys, other].filter((k) => !fits.has(keyOf(k)));
  const proxyKeys = keys.filter((k) => k !== prot.input);
  const proxyKey = `${prot.value}|${keyOf(proxyKeys)}`;
  const steps = need.length + (proxies.has(proxyKey) ? 0 : 1);
  let doneSteps = 0;

  const next = () => {
    if (id !== job) return;
    // The inputs of all 30,000 cardholders are worked out once, 5,000 at a time.
    if (stored < D.n) {
      fillStore(store, D, stored, stored + 5000);
      stored += 5000;
      say(progress, `Reading the cardholders: ${fmt.int(Math.min(stored, D.n))} of ${fmt.int(D.n)}…`);
      setTimeout(next, 0);
      return;
    }
    if (need.length) {
      const k = need.shift();
      const what = k === keys ? "the model" : `the model ${state.inputs.has(prot.input) ? "without" : "with"} ${attr}, for comparison`;
      const show = (it) => say(progress, `Fitting ${what} (${doneSteps + 1} of ${steps}), Newton step ${it + 1}…`);
      show(0);
      fitInSlices(k, yTrain, (fit, M) => {
        if (id !== job) return;
        if (!fit || !fit.cov) { say(progress, ""); modelNote.replaceChildren(note("bad", "These inputs could not be fitted together. Put back the standard inputs.")); return; }
        fits.set(keyOf(k), { keys: k, fit, pTr: predictFromStore(store, TRAIN, k, fit.beta), pTe: predictFromStore(store, TEST, k, fit.beta), means: columnMeans(M) });
        doneSteps++;
        setTimeout(next, 0);
      }, show);
      return;
    }
    if (!proxies.has(proxyKey)) {
      say(progress, `Measuring how well the other inputs predict ${attr} (${doneSteps + 1} of ${steps})…`);
      if (!proxyKeys.length) { proxies.set(proxyKey, 0.5); doneSteps++; setTimeout(next, 0); return; }
      const gTrain = TRAIN.map((i) => prot.group(D, i));
      fitInSlices(proxyKeys, gTrain, (fit) => {
        if (id !== job) return;
        proxies.set(proxyKey, fit ? auc(predictFromStore(store, TEST, proxyKeys, fit.beta), TEST.map((i) => prot.group(D, i))) : NaN);
        doneSteps++;
        setTimeout(next, 0);
      });
      return;
    }
    say(progress, "");
    drawAll();
  };
  next();
}

function syncUnused() {
  for (const { key } of inputBoxes) say($(`[data-unused="${key}"]`), state.inputs.has(key) ? "" : "not in the model");
}

/* ---------- drawing ---------- */
const current = () => fits.get(keyOf([...state.inputs]));

function drawAll() {
  drawModel();
  drawProfile();
  drawCalibration();
  drawFairness();
}

function drawModel() {
  const m = current();
  if (!m) return;
  m.scores ||= scores(m.pTe, yTest, BASE);
  const s = m.scores;
  modelNote.replaceChildren();
  sAuc.set(fmt.num(s.auc, 3), s.auc > 0.5 ? `a random defaulter is ranked above a random repayer ${pct(s.auc, 1)} of the time; 0.5 is a coin toss` : "no better than a coin toss: with no inputs every forecast is the same");
  sBrier.set(fmt.num(s.brier, 4), `against ${fmt.num(s.baseBrier, 4)} for forecasting the training default rate, ${pct(BASE, 1)}, for everyone (${s.skill > 0 ? `${pct(s.skill, 1)} better` : "no better"})`);
  sCal.set(pct(s.meanPredicted, 1), `against ${pct(s.observed, 1)} of the held-out cardholders who defaulted`);
  syncUnused();

  const cols = columnsOf(m.keys);
  const rows = cols.map((c, j) => ({ input: c.input ? INPUTS.find((f) => f.key === c.input).label : "Intercept", col: c.name, b: m.fit.beta[j], se: Math.sqrt(m.fit.cov[j][j]) }));
  coefBox.replaceChildren(
    el("p", { class: "small muted", text: `Coefficients on the log-odds of default, with standard errors from the inverse information matrix. Reference groups: graduate school, married, male, paid duly (code -1). ${m.fit.iterations} Newton steps.` }),
    el("div", { class: "tbl-wrap" }, el("table", { class: "tbl d83-coef" },
      el("caption", { text: "Fitted coefficients" }),
      el("thead", {}, el("tr", {}, ["Input", "Column", "Coefficient", "Standard error", "Odds ratio"].map((h, i) => el("th", { scope: "col", class: i > 1 ? "num" : null, text: h })))),
      el("tbody", {}, rows.map((r) => el("tr", {},
        el("td", { "data-label": "Input", text: r.input }), el("td", { "data-label": "Column", text: r.col }), el("td", { class: "num", "data-label": "Coefficient", text: fmt.signed(r.b, 3) }), el("td", { class: "num", "data-label": "Standard error", text: fmt.num(r.se, 3) }),
        el("td", { class: "num", "data-label": "Odds ratio", text: r.input === "Intercept" ? "–" : fmt.num(Math.exp(r.b), 2) })))))));
}

function drawProfile() {
  const m = current();
  // Messages first: they do not need a model.
  const read = readProfile(Object.fromEntries(Object.entries(box).map(([k, b]) => [k, b.value])));
  for (const [k, b] of Object.entries(box)) {
    const e = read.errors?.find((x) => x.key === k);
    say($(`#${b.id}-msg`), e ? e.message : "");
    b.classList.toggle("invalid", Boolean(e));
    if (e) b.setAttribute("aria-invalid", "true"); else b.removeAttribute("aria-invalid");
  }
  if (state.picked != null) {
    const i = state.picked;
    say(pickNote, `Cardholder ${fmt.int(i + 1)} in the source file, held out from fitting. In October 2005 this cardholder ${D.y[i] ? "defaulted" : "did not default"}.`);
  } else say(pickNote, "");
  if (!m) return;
  if (read.errors) {
    profileMsg.replaceChildren(note("bad", "Fix the box marked in red to get a forecast."));
    sPd.set("–", ""); sBand.set("–", "");
    mini.textContent = "Fix the box marked in red to get a forecast.";
    contribBox.replaceChildren();
    say(profileStatus, "Fix the box marked in red to get a forecast.");
    return;
  }
  const prof = read.profile;
  const row = designRow(prof, m.keys);
  const f = predictWithInterval(m.fit, row);
  mini.replaceChildren("Forecast for this profile: ", el("strong", { text: pct(f.p, 1) }), " ", el("a", { href: "#d83-result", text: "details" }));
  sPd.set(pct(f.p, 1), `95% interval for the model's estimate: ${pct(f.low, 1)} to ${pct(f.high, 1)}`);
  m.bins ||= reliability(m.pTe, yTest, 10);
  const band = m.bins.find((b) => f.p <= b.to) || m.bins.at(-1);
  const range = pct(band.from, 1) === pct(band.to, 1) ? pct(band.from, 1) : `${pct(band.from, 1)} to ${pct(band.to, 1)}`;
  sBand.set(pct(band.observed, 0), `of the ${fmt.int(band.n)} held-out cardholders forecast ${range} defaulted`);
  const flagged = f.p >= state.cut;
  profileMsg.replaceChildren(note("", `At the ${fmt.pct(state.cut, 0)} line used in the fairness check below, this profile ${flagged ? "would be flagged" : "would not be flagged"}. The interval reflects only the uncertainty in the fitted coefficients; whether one person defaults is a single draw at this chance.`));

  const means = m.means;
  const parts = contributions(m.fit.beta, row, means, m.keys);
  const etaMean = linear(m.fit.beta, means);
  const top = Math.max(0.25, ...parts.map((x) => Math.abs(x.value)));
  contribBox.replaceChildren(
    el("p", { class: "chart-title", text: "What moves this forecast" }),
    el("p", { class: "small muted", text: parts.length ? `Each input's push on the log-odds of default, compared with a cardholder at the training average of every input (log-odds ${fmt.num(etaMean, 2)}, a chance of ${pct(sigmoid(etaMean), 1)}). Right raises the chance, left lowers it.` : "The model has no inputs, so every profile gets the training default rate." }),
    // Every input keeps its row, used or not, so that ticking an input never moves the page under the visitor's finger.
    el("ul", { class: "d83-bars", "aria-label": "Contribution of each input to the log-odds of default" },
      INPUTS.map((inp) => {
        const x = parts.find((q) => q.key === inp.key);
        return el("li", { class: x ? null : "d83-off" },
          el("span", { class: "d83-bar-name", text: inp.label }),
          el("span", { class: "d83-bar-track", "aria-hidden": "true" },
            x ? el("span", { class: `d83-bar-fill ${x.value >= 0 ? "up" : "down"}`, style: { width: `${(Math.abs(x.value) / top) * 50}%` } }) : null),
          el("span", { class: "d83-bar-val", text: x ? `${fmt.signed(x.value, 2)}${Math.abs(x.value) < 0.005 ? "" : x.value > 0 ? " (raises)" : " (lowers)"}` : "not used" }));
      })),
  );
  say(profileStatus, `Predicted chance of default ${pct(f.p, 1)}, interval ${pct(f.low, 1)} to ${pct(f.high, 1)}.`);
}

function drawCalibration() {
  const m = current();
  if (!m) return;
  m.bins ||= reliability(m.pTe, yTest, 10);
  const bins = m.bins;
  const top = Math.min(1, Math.max(0.2, ...bins.map((b) => Math.max(b.high, b.predicted))) * 1.05);
  const off = bins.filter((b) => b.predicted < b.low || b.predicted > b.high).length;
  const tenths = bins.length === 10;
  calChart.update({
    title: tenths ? "Forecast against outcome, ten equal groups of held-out cardholders" : "Forecast against outcome, held-out cardholders grouped by forecast",
    subtitle: `${tenths ? `Each point is a tenth of the ${fmt.int(yTest.length)} held-out cardholders, sorted by forecast: its average forecast across, the share that defaulted up.` : `These inputs give few distinct forecasts, and cardholders with the same forecast are kept together, so the ${fmt.int(yTest.length)} held-out cardholders fall into ${bins.length} group${bins.length === 1 ? "" : "s"}. Each point is a group's average forecast across and the share that defaulted up.`} On the dashed line the two agree. The band is a 95% interval for the share. ${bins.length === 1 ? `The forecast falls ${off ? "outside" : "inside"} it.` : `In ${off || "none"} of the ${bins.length} groups the forecast falls outside it.`}`,
    label: `Reliability diagram: share of held-out cardholders who defaulted against their average forecast, in ${bins.length} group${bins.length === 1 ? "" : "s"}`,
    x: { label: "Average forecast", domain: [0, top], format: (v) => fmt.pct(v, 0) },
    y: { label: "Share that defaulted", domain: [0, top], format: (v) => fmt.pct(v, 0) },
    series: [
      { name: "95% interval", type: "range", data: bins.map((b) => [b.predicted, b.low, b.high]), color: 0, opacity: 0.16 },
      { name: "Perfect calibration", type: "line", data: [[0, 0], [top, top]], color: "#16233b", dash: true, width: 1.5, hover: false },
      { name: "Held-out cardholders", type: "line", data: bins.map((b) => [b.predicted, b.observed]), color: 0 },
      { name: "Groups", type: "scatter", data: bins.map((b, k) => ({ x: b.predicted, y: b.observed, label: `Group ${k + 1}: ${fmt.int(b.n)} cardholders, ${fmt.int(b.defaults)} defaulted` })), color: 0, r: 4, legend: false },
    ],
  });
}

function drawFairness() {
  const m = current();
  if (!m) return;
  const prot = PROTECTED.find((p) => p.value === state.protected);
  const gTr = TRAIN.map((i) => prot.group(D, i)), gTe = TEST.map((i) => prot.group(D, i));
  const cuts = cutoffs(state.rule, state.cut, m.pTr, yTrain, gTr);
  const split = (arr, g) => arr.filter((_, k) => gTe[k] === g);
  const G = [0, 1].map((g) => groupMeasures(split(Array.from(m.pTe), g), split(yTest, g), cuts[g]));
  const [A, B] = prot.names;
  const cutText = (c) => (c === Infinity ? "none flagged" : fmt.pct(c, 1));
  const why = (r, what) => (r.n === 0 ? "no one in the group" : what === "ppv" && r.flaggedCount === 0 ? "no one flagged" : "");
  const cell = (r, key) => (Number.isFinite(r[key]) ? pct(r[key], 1) : why(r, key) || "–");
  const gap = (key) => (Number.isFinite(G[0][key]) && Number.isFinite(G[1][key]) ? pts(G[0][key] - G[1][key], 1) : "–");
  const rows = [
    { m: "Cardholders held out", a: fmt.int(G[0].n), b: fmt.int(G[1].n), g: "" },
    { m: "Share who defaulted (the base rate)", a: cell(G[0], "baseRate"), b: cell(G[1], "baseRate"), g: gap("baseRate") },
    { m: "Average forecast (calibration in the large)", a: cell(G[0], "meanP"), b: cell(G[1], "meanP"), g: gap("meanP") },
    { m: "Cut-off", a: cutText(cuts[0]), b: cutText(cuts[1]), g: "" },
    { m: "Share flagged (demographic parity)", a: cell(G[0], "flagged"), b: cell(G[1], "flagged"), g: gap("flagged") },
    { m: "Repayers flagged (equal opportunity)", a: cell(G[0], "fpr"), b: cell(G[1], "fpr"), g: gap("fpr") },
    { m: "Defaulters flagged (with the row above, equalised odds)", a: cell(G[0], "tpr"), b: cell(G[1], "tpr"), g: gap("tpr") },
    { m: "Flagged who defaulted (predictive parity)", a: cell(G[0], "ppv"), b: cell(G[1], "ppv"), g: gap("ppv") },
    { m: "Average forecast of those who defaulted (balance)", a: cell(G[0], "scoreIfDefault"), b: cell(G[1], "scoreIfDefault"), g: gap("scoreIfDefault") },
    { m: "Average forecast of those who repaid (balance)", a: cell(G[0], "scoreIfRepaid"), b: cell(G[1], "scoreIfRepaid"), g: gap("scoreIfRepaid") },
  ];
  const ruleLabel = RULES.find((r) => r.value === state.rule).label;
  fairTable.replaceChildren(el("table", { class: "tbl d83-rt" },
    el("caption", { text: `${prot.label}, ${ruleLabel.toLowerCase()}. Gap is ${A.toLowerCase()} minus ${B.toLowerCase()}.` }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Measure" }), [A, B, "Gap"].map((h) => el("th", { scope: "col", class: "num", text: h })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, el("th", { scope: "row", text: r.m }),
      el("td", { class: "num", "data-label": A, text: r.a }), el("td", { class: "num", "data-label": B, text: r.b }), el("td", { class: "num", "data-label": "Gap", text: r.g || "–" }))))));

  // The impossibility in these numbers.
  const notes = [];
  const usable = G.every((r) => r.flaggedCount > 0 && r.defaults > 0 && r.repaid > 0 && r.ppv < 1 && r.tp > 0);
  if (usable) {
    const implied = chouldechovaFpr(G[0].baseRate, G[1].ppv, G[1].fnr);
    notes.push(el("p", { class: "small" },
      el("strong", { text: "Why not every row can match. " }),
      `For each group, the share of repayers flagged equals b/(1 − b) × (1 − PPV)/PPV × (1 − FNR), where b is the base rate, PPV the share of flagged who defaulted and FNR the share of defaulters missed (Chouldechova 2017). Check it on the table: for ${A.toLowerCase()} it gives ${pct(chouldechovaFpr(G[0].baseRate, G[0].ppv, G[0].fnr), 2)}, the measured ${pct(G[0].fpr, 2)}. If ${A.toLowerCase()} had ${B.toLowerCase()}'s PPV (${pct(G[1].ppv, 1)}) and miss rate (${pct(G[1].fnr, 1)}), their base rate of ${pct(G[0].baseRate, 1)} would force a flag rate for repayers of ${pct(implied, 1)}, not ${B.toLowerCase()}'s ${pct(G[1].fpr, 1)}. With unequal base rates the three cannot all be equal unless the flag makes no mistakes at all.`));
  } else {
    notes.push(note("", "With this cut-off one group has no one flagged, or no flagged defaulter, so the shares that divide by those counts cannot be computed. Lower the cut-off to compare them."));
  }
  if (state.rule !== "one") notes.push(el("p", { class: "small muted", text: `Separate cut-offs equalise one row, as closely as the held-out sample allows, by treating the two groups differently, and the rows the theorems tie to it move apart. Using a protected attribute this way can itself be unlawful in lending.` }));
  fairNotes.replaceChildren(...notes);
  say(fairStatus, `${A}: ${cell(G[0], "flagged")} flagged, ${cell(G[0], "fpr")} of repayers flagged, ${cell(G[0], "ppv")} of flagged defaulted. ${B}: ${cell(G[1], "flagged")}, ${cell(G[1], "fpr")} and ${cell(G[1], "ppv")}.`);

  // Calibration within groups.
  const binsBy = [0, 1].map((g) => reliability(split(Array.from(m.pTe), g), split(yTest, g), 10));
  const top = Math.min(1, Math.max(0.2, ...binsBy.flat().map((b) => Math.max(b.observed, b.predicted))) * 1.05);
  groupChart.update({
    title: `Calibration within groups: ${A.toLowerCase()} and ${B.toLowerCase()}`,
    subtitle: "Each group's held-out cardholders in ten equal groups by forecast (fewer when many forecasts are equal). A model calibrated within groups puts both lines on the dashed one: a forecast of 30% means 30% for either group.",
    label: `Reliability diagram for ${A} and ${B}: share who defaulted against average forecast`,
    x: { label: "Average forecast", domain: [0, top], format: (v) => fmt.pct(v, 0) },
    y: { label: "Share that defaulted", domain: [0, top], format: (v) => fmt.pct(v, 0) },
    series: [
      { name: "Perfect calibration", type: "line", data: [[0, 0], [top, top]], color: "#16233b", dash: true, width: 1.5, hover: false },
      { name: A, type: "line", data: binsBy[0].map((b) => [b.predicted, b.observed]), color: 0 },
      { name: B, type: "line", data: binsBy[1].map((b) => [b.predicted, b.observed]), color: 1 },
    ],
  });

  // Leaving the attribute out, or putting it in.
  const prKey = `${prot.value}|${keyOf([...state.inputs].filter((k) => k !== prot.input))}`;
  const proxyAuc = proxies.get(prKey);
  const withKeys = [...state.inputs, prot.input].filter((k, i, a) => a.indexOf(k) === i);
  const withoutKeys = [...state.inputs].filter((k) => k !== prot.input);
  const mWith = fits.get(keyOf(withKeys)), mWithout = fits.get(keyOf(withoutKeys));
  if (!mWith || !mWithout || proxyAuc == null) { unawareBox.replaceChildren(); return; }
  const meanBy = (mm, g) => { const a = split(Array.from(mm.pTe), g); return a.reduce((s, v) => s + v, 0) / a.length; };
  const baseBy = (g) => G[g].baseRate;
  const attr = prot.label.split(":")[0].toLowerCase();
  const lines = [
    { m: `Average forecast, ${A.toLowerCase()} (actual ${pct(baseBy(0), 1)})`, wo: meanBy(mWithout, 0), w: meanBy(mWith, 0) },
    { m: `Average forecast, ${B.toLowerCase()} (actual ${pct(baseBy(1), 1)})`, wo: meanBy(mWithout, 1), w: meanBy(mWith, 1) },
  ];
  unawareBox.replaceChildren(
    el("h3", { text: `Leaving ${attr} out of the model` }),
    el("p", { class: "small", text: `A model that never sees ${attr} can still treat the groups differently, because other inputs travel with it: from the model's other inputs a second logistic regression tells ${A.toLowerCase()} from ${B.toLowerCase()} with an AUC of ${fmt.num(proxyAuc, 2)} on the held-out cardholders (0.5 would mean they carry no trace of it). And leaving it out does not make the forecasts fairer by every measure: compare how close each group's average forecast comes to what actually happened.` }),
    el("div", { class: "tbl-wrap" }, el("table", { class: "tbl d83-unaware" },
      el("caption", { text: `The current inputs, without and with ${attr}` }),
      el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Held-out cardholders" }), el("th", { scope: "col", class: "num", text: `Without ${attr}` }), el("th", { scope: "col", class: "num", text: `With ${attr}` }))),
      el("tbody", {}, lines.map((l) => el("tr", {}, el("th", { scope: "row", text: l.m }), el("td", { class: "num", text: pct(l.wo, 1) }), el("td", { class: "num", text: pct(l.w, 1) })))))),
    el("p", { class: "small muted", text: state.inputs.has(prot.input) ? `The model above uses ${attr} now. Untick it under "Inputs the model uses" to make the model above the one without it.` : `Tick "${INPUTS.find((f) => f.key === prot.input).label}" under "Inputs the model uses" to see the fairness table for the model with it.` }));
}

refresh();
