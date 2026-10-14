// Day 72: Market Regime Detector. Interface.
import { $, el, fmt, mount, select, segmented, stat, note, chart, palette } from "../kit/kit.js";
import { MARKETS } from "./data.js";
import {
  monthAt, changes, fitHmmSteps, posteriors, forward, argmaxRows, runs, durations, stationary, disagreement,
  realTimeSteps,
} from "./logic.js";

mount();

const STARTS = 20, SEED = 72, RT_STARTS = 3; // RT_STARTS: fresh starts for each yearly refit, besides last year's fit
const REGIME_NAMES = { 1: ["only"], 2: ["calm", "turbulent"], 3: ["calm", "normal", "turbulent"], 4: ["calm", "normal", "unsettled", "turbulent"] };
const COLORS = ["#1baf7a", "#2a78d6", "#eda100", "#e34948"]; // kit palette entries, calm to turbulent
const shade = (K) => (K === 2 ? [COLORS[0], COLORS[3]] : K === 3 ? [COLORS[0], COLORS[1], COLORS[3]] : COLORS);
const marketOf = (id) => MARKETS.series.find((s) => s.id === id);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const shortMonth = (ym) => `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(0, 4)}`;
const yearOf = (ym) => Number(ym.slice(0, 4)) + (Number(ym.slice(5)) - 1) / 12;
const ymOf = (v) => { const k = Math.round(v * 12); return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; };
// Whole months (a run of labels) print as whole numbers; expected stays keep a decimal below 10.
const months = (n) => `${Number.isInteger(n) ? fmt.int(n) : fmt.num(n, n < 10 ? 1 : 0)} ${n === 1 ? "month" : "months"}`;

const state = { id: "ust10", K: null };
let ready = false; // true once the fits for 1 to 4 regimes exist for the market shown
// Fits are cached per market and number of regimes; they are deterministic, so a cache changes nothing but speed.
const cache = new Map();

/* ---------- controls ---------- */
const marketSelect = select({
  label: "Market", value: state.id,
  options: MARKETS.series.map((s) => ({ value: s.id, label: s.kind === "yield" ? `${s.name} (monthly change)` : `${s.name} (monthly return)` })),
  onChange: (v) => { state.id = v; state.K = null; update(); },
});
// One control for the number of regimes; its labels say which number BIC prefers for the market shown.
const kSeg = segmented({
  label: "Number of regimes", value: "2", options: ["2", "3", "4"], hint: "Opens on the number BIC prefers for this market.",
  // While the fits for this market are still running, the choice is kept and used when they finish.
  onChange: (v) => { state.K = Number(v); if (!ready) return; job++; const s = marketOf(state.id); show(s, changes(s), cache.get(fitKey(s.id, state.K))); },
});
const kHolder = kSeg.el;
const about = el("div", { class: "small muted source-note" });
const controls = el("div", { class: "controls" }, marketSelect.el, kHolder,
  note("", "A description of past prices, not investment advice. A regime label says what the recent months looked like, not what comes next."),
  about);

/* ---------- outputs ---------- */
const sNow = stat("Latest regime");
const sSince = stat("In it since");
const sStay = stat("Expected stay");
const sSwitch = stat("Switches");
const status = el("p", { class: "sr-only", role: "status" });
const levelLegend = el("div", { class: "chart-legend", "aria-hidden": "true" });
const levelBox = el("div"), probBox = el("div");
const regimeBox = el("div");
const bicHead = el("h2", { text: "How many regimes?" });
const bicIntro = el("p", { class: "small muted" });
const bicProgress = el("p", { class: "small muted" });
const bicBox = el("div");
const stabHead = el("h2", { text: "How stable are the labels?" });
const stabStarts = el("p", { class: "small" });
const stabProgress = el("p", { class: "small muted" });
const stabReal = el("div");
const stabStatus = el("p", { class: "sr-only", role: "status" });

const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sNow.el, sSince.el, sStay.el, sSwitch.el), status,
  el("div", {}, levelLegend, levelBox), probBox, regimeBox,
  el("div", { class: "panel stack" }, bicHead, bicIntro, bicProgress, bicBox),
  el("div", { class: "panel stack" }, stabHead, stabStarts, stabProgress, stabReal, stabStatus));
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const levelChart = chart(levelBox, { series: [], height: 300, empty: "Fitting the model…" });
const probChart = chart(probBox, { series: [], height: 240, empty: "Fitting the model…" });

function rtable({ caption, columns, rows }) {
  return el("div", { class: "rt-wrap" }, el("table", { class: "tbl rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, columns.map((c, k) => (k === 0
      ? el("th", { scope: "row", text: r[c.key] })
      : el("td", { class: c.num ? "num" : null, "data-label": c.label, text: r[c.key] }))))))));
}

/* ---------- work in slices ---------- */
// One job at a time: a new market or number of regimes abandons whatever is running.
let job = 0;
function run(gen, { onProgress, onDone, budget = 25 }) {
  const id = job;
  const tick = () => {
    if (id !== job) return;
    const t0 = performance.now();
    let r, count = null;
    do { r = gen.next(); if (typeof r.value === "number") count = r.value; } while (!r.done && performance.now() - t0 < budget);
    if (r.done) onDone(r.value); else { if (count != null) onProgress?.(count); setTimeout(tick, 0); }
  };
  setTimeout(tick, 0);
}
const fitKey = (id, K) => `${id}-${K}`;
function fitFor(s, x, K, done) {
  const key = fitKey(s.id, K);
  if (cache.has(key)) { done(cache.get(key)); return; }
  run(fitHmmSteps(x, K, { starts: STARTS, seed: SEED }), { onDone: (f) => { cache.set(key, f); done(f); } });
}

/* ---------- the main view ---------- */
function update() {
  job++;
  ready = false;
  const s = marketOf(state.id);
  const x = changes(s);
  const unit = s.kind === "yield" ? "percentage points" : "%";
  const first = monthAt(s.start, 1), last = monthAt(s.start, s.values.length - 1);
  const src = MARKETS.sources[s.source];
  about.replaceChildren(el("strong", { text: `${s.name}, ${monthName(first)} to ${monthName(last)}. ` }),
    `${s.detail} The model reads ${fmt.int(x.length)} monthly ${s.kind === "yield" ? "changes, in percentage points" : "log returns, in percent"}. Source: ${src.name}, ${src.licence}, retrieved ${fmt.date(MARKETS.retrieved)}.`);
  sNow.set("…", "fitting the model");
  // The number of regimes defaults to the one BIC prefers, which needs the fits for 1 to 4 regimes first.
  const bic = [];
  bicIntro.textContent = `The model is fitted with 1, 2, 3 and 4 regimes from ${STARTS} starting points each. BIC (the Bayesian information criterion, −2 ln L + p ln n) rewards fit and charges for every parameter; lower is better.`;
  bicBox.replaceChildren();
  // Two regimes are fitted first and shown at once, so the page is never empty; once 1, 3 and 4 are fitted too,
  // the view switches to the number BIC prefers if that is not two.
  const order = [2, 1, 3, 4];
  const next = (i) => {
    const K = order[i];
    bicProgress.textContent = `Fitting ${K} ${K === 1 ? "regime" : "regimes"} (${i + 1} of 4)…`;
    fitFor(s, x, K, (f) => {
      bic.push(f);
      if (K === 2 && (state.K == null || state.K === 2)) show(s, x, f, { provisional: true });
      if (i < order.length - 1) { next(i + 1); return; }
      bicProgress.textContent = "";
      bic.sort((a, b) => a.K - b.K);
      const best = bic.reduce((a, b) => (b.bic < a.bic ? b : a));
      showBic(bic, best.K, x.length);
      if (state.K == null) state.K = Math.max(2, best.K);
      ready = true;
      markBic(best.K);
      show(s, x, cache.get(fitKey(s.id, state.K)));
    });
  };
  next(0);
}

function markBic(bestK) {
  for (const input of kHolder.querySelectorAll("input")) input.nextElementSibling.textContent = Number(input.value) === bestK ? `${input.value} (BIC)` : input.value;
  kSeg.value = String(state.K);
}

function showBic(fits, bestK, n) {
  bicBox.replaceChildren(rtable({
    caption: `${fmt.int(n)} months`,
    columns: [{ key: "K", label: "Regimes" }, { key: "ll", label: "Log-likelihood", num: true }, { key: "p", label: "Parameters", num: true }, { key: "bic", label: "BIC", num: true }, { key: "starts", label: "Starts reaching the best fit", num: true }],
    rows: fits.map((f) => ({ K: f.K === bestK ? `${f.K}, lowest BIC` : String(f.K), ll: fmt.num(f.ll, 1), p: String(f.p), bic: fmt.num(f.bic, 1), starts: `${f.reached} of ${f.starts}` })),
  }));
}

function show(s, x, fit, { provisional = false } = {}) {
  kSeg.value = String(fit.K); // the control always shows the number of regimes on screen
  const K = fit.K, m = fit.model, names = REGIME_NAMES[K], colors = shade(K);
  const unit = s.kind === "yield" ? " pp" : "%";
  const { gamma } = posteriors(x, m);
  const { alpha } = forward(x, m);
  const hind = argmaxRows(gamma, K);
  const n = x.length;
  const monthOfObs = (t) => monthAt(s.start, t + 1); // observation t is the change into month t + 1
  const nowProbs = Array.from({ length: K }, (_, k) => alpha[(n - 1) * K + k]);
  const now = nowProbs.indexOf(Math.max(...nowProbs));
  const rs = runs(hind);
  const lastRun = rs[rs.length - 1];
  const dur = durations(m), share = stationary(m.A);

  sNow.set(names[now][0].toUpperCase() + names[now].slice(1), `${fmt.pct(nowProbs[now], 0)} probability in ${monthName(monthOfObs(n - 1))}, the last month of data, from data up to then`);
  sSince.set(shortMonth(monthOfObs(lastRun.from)), `most probable regime with hindsight: ${names[lastRun.label]} for ${months(lastRun.to - lastRun.from + 1)}`);
  sStay.set(months(dur[now]), `average stay in the ${names[now]} regime, 1 / (1 − p), with p the chance of staying`);
  sSwitch.set(fmt.int(rs.length - 1), `changes of the most probable regime in ${fmt.int(n)} months`);
  status.textContent = `${s.name}, ${K} regimes. In ${monthName(monthOfObs(n - 1))} the ${names[now]} regime is the most probable, at ${fmt.pct(nowProbs[now], 0)}. Expected stay ${months(dur[now])}. The most probable regime changed ${rs.length - 1} times.`;

  // The level with each month shaded by its most probable regime.
  const xs = (t) => yearOf(monthOfObs(t));
  const marks = rs.map((r) => ({ type: "span", x0: xs(r.from) - 1 / 24, x1: xs(r.to) + 1 / 24, color: colors[r.label], opacity: 0.16 }));
  levelLegend.replaceChildren(...names.map((nm, k) => el("span", {}, el("i", { style: { background: colors[k], opacity: 0.5 } }), `${nm} regime`)));
  levelChart.update({
    title: `${s.name}: ${s.kind === "yield" ? "yield" : "price"}, shaded by the most probable regime`,
    subtitle: s.kind === "yield" ? "Percent a year, monthly average. Each month is shaded by the regime the model thinks most probable, using all the data." : `${s.unit}, monthly average, on a log scale. Each month is shaded by the regime the model thinks most probable, using all the data.`,
    label: `Line chart of the ${s.kind === "yield" ? "yield" : "price"} of ${s.name} with each month shaded by its most probable regime`,
    x: { format: (v) => shortMonth(ymOf(v)), label: "Month" },
    y: s.kind === "yield" ? { label: "% a year", format: (v) => fmt.num(v, 0) } : { type: "log", label: s.unit, format: (v) => (v >= 1000 ? fmt.compact(v) : fmt.sig(v, 2)) },
    series: [{ name: s.name, type: "line", data: s.values.map((v, i) => [yearOf(monthAt(s.start, i)), v]), color: "#16233b", width: 1.4 }],
    marks,
  });

  const top = K - 1;
  probChart.update({
    title: `Probability of the ${names[top]} regime`,
    subtitle: "With hindsight: given all the data. Filtered: given the data up to that month only, but with the parameters fitted to the whole sample.",
    label: `Line chart of the probability of the ${names[top]} regime for ${s.name}, with hindsight and filtered`,
    x: { format: (v) => shortMonth(ymOf(v)), label: "Month" },
    y: { label: "Probability", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
    series: [
      { name: "With hindsight", type: "line", data: Array.from({ length: n }, (_, t) => [xs(t), gamma[t * K + top]]), color: 7, width: 1.4 },
      { name: "Filtered", type: "line", data: Array.from({ length: n }, (_, t) => [xs(t), alpha[t * K + top]]), color: 6, width: 1, opacity: 0.8 },
    ],
  });

  const counts = new Array(K).fill(0);
  for (const h of hind) counts[h]++;
  regimeBox.replaceChildren(rtable({
    caption: `The ${K} regimes for ${s.name}, monthly ${s.kind === "yield" ? "changes in percentage points" : "log returns in percent"}`,
    columns: [
      { key: "name", label: "Regime" }, { key: "mu", label: "Average change a month", num: true }, { key: "sd", label: "Volatility (standard deviation)", num: true },
      { key: "share", label: "Share of months", num: true }, { key: "stay", label: "Expected stay", num: true }, { key: "move", label: "Next month, chance of moving to" },
    ],
    rows: names.map((nm, k) => ({
      name: nm[0].toUpperCase() + nm.slice(1), mu: `${fmt.signed(m.mu[k], 2)}${unit}`, sd: `${fmt.num(m.sd[k], 2)}${unit}`,
      share: `${fmt.pct(counts[k] / n, 0)} (long run ${fmt.pct(share[k], 0)})`, stay: months(dur[k]),
      move: names.map((other, j) => (j === k ? null : `${other} ${fmt.pct(m.A[k][j], 1)}`)).filter(Boolean).join(", "),
    })),
  }));

  if (provisional) {
    stabStarts.textContent = "";
    stabReal.replaceChildren();
    stabProgress.textContent = "Showing two regimes while the fits with 1, 3 and 4 regimes finish; the stability checks follow.";
    return;
  }
  // Stability: starting points, then labels in real time.
  const others = fit.optima.slice(1);
  let startsText = `${fit.reached} of ${fit.starts} starting points reach the best fit (log-likelihood ${fmt.num(fit.ll, 1)}).`;
  if (others.length) {
    const gaps = others.map((o) => fit.ll - o.ll);
    const dis = others.map((o) => disagreement(argmaxRows(posteriors(x, o.model).gamma, K), hind));
    const lo = Math.min(...dis), hi = Math.max(...dis);
    startsText += others.length === 1
      ? ` The others stop at one other local optimum, ${fmt.num(gaps[0], 1)} lower, which labels ${fmt.pct(dis[0], 0)} of the months differently.`
      : ` The others stop at ${others.length} other local optima, ${fmt.num(Math.min(...gaps), 1)} to ${fmt.num(Math.max(...gaps), 1)} lower, which label ${fmt.pct(lo, 0) === fmt.pct(hi, 0) ? fmt.pct(lo, 0) : `${fmt.pct(lo, 0)} to ${fmt.pct(hi, 0)}`} of the months differently.`;
  } else startsText += " Every start ends at the same fit.";
  stabStarts.textContent = startsText;
  const first = Math.min(120, Math.floor(n / 3));
  stabReal.replaceChildren();
  stabStatus.textContent = "";
  const steps = Math.ceil((n - first) / 12);
  stabProgress.textContent = `Refitting in real time: 0 of ${steps} yearly refits done.`;
  run(realTimeSteps(x, K, { first, starts: RT_STARTS, seed: SEED }), {
    onProgress: (done) => { stabProgress.textContent = `Refitting in real time: ${done} of ${steps} yearly refits done.`; },
    onDone: (rt) => {
      stabProgress.textContent = "";
      const d = disagreement(rt.labels, hind, first);
      let topH = 0, topBoth = 0, topRt = 0;
      for (let t = first; t < n; t++) { if (hind[t] === top) { topH++; if (rt.labels[t] === top) topBoth++; } if (rt.labels[t] === top) topRt++; }
      const text = `From ${monthName(monthOfObs(first))} onwards, the model was refitted every 12 months on the data available then (from ${RT_STARTS} starting points and from the previous year's fit), and each month labelled by the regime most probable given data up to that month (${rt.fits} refits). Those real-time labels differ from the labels given with hindsight in ${fmt.pct(d, 0)} of the ${fmt.int(n - first)} months.`
        + (topH ? ` Of the ${fmt.int(topH)} ${topH === 1 ? "month" : "months"} labelled ${names[top]} with hindsight, ${fmt.int(topBoth)} (${fmt.pct(topBoth / topH, 0)}) ${topBoth === 1 ? "was" : "were"} labelled ${names[top]} at the time; ${fmt.int(topRt - topBoth)} other ${topRt - topBoth === 1 ? "month was" : "months were"} labelled ${names[top]} at the time and not with hindsight.` : ` No month is labelled ${names[top]} with hindsight in this stretch.`);
      stabReal.replaceChildren(el("p", { class: "small", text }));
      stabStatus.textContent = `Label stability: ${text}`;
    },
  });
}

update();
