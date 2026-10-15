// Day 87: Polling Error and House Effects. Interface.
import { $, el, fmt, mount, slider, segmented, select, checkbox, button, stat, note, chart, stats, debounce, randomSeed, clamp } from "../kit/kit.js";
import { ELECTIONS as E } from "../data/elections.js";
import {
  YEARS, ERROR_YEARS, DEFAULTS, twoParty, nationalShare, pollRows, pollsterCounts, sampler, summary, lean, unitEstimates, simulate,
  fakeRows, recovery, stateErrors, errorStructure, persistence,
} from "./logic.js";

mount();

const surname = (name) => name.split(" ").at(-1);
const nameOf = (p) => E.polls.pollsters[p][1];
const SWEEP_SLICE = 150, MIN_POLLS = DEFAULTS.minPolls, RHOS = Array.from({ length: 11 }, (_, k) => k / 10);
const pct = (p) => (p < 0.001 ? "under 0.1%" : p > 0.999 ? "over 99.9%" : fmt.pct(p, 1));
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
/** A lean in words: +1.6 is "D +1.6", -1.9 is "R +1.9" (points of the Democrat's two-party share). Values that would
 *  round to 0.0 get two decimals, so an interval that ends at -0.04 never reads "to 0.0" beside "leans Republican". */
const leanText = (v) => {
  const d = Math.abs(v) < 0.05 ? 2 : 1;
  if (v === 0) return "0.00";
  if (Math.abs(v) < 0.005) return v > 0 ? "D, under 0.01" : "R, under 0.01"; // still on the side the verdict says
  return v > 0 ? `D +${fmt.num(v, d)}` : `R +${fmt.num(-v, d)}`;
};

const state = { year: 2020, maxDays: 61, adjust: true, total: DEFAULTS.total, rho: DEFAULTS.rho, fakeTau: 1.5, fakeSigma: 1.5, fakeSeed: 7 };
let chosen = new Set();      // pollster indices left in the fit
let smallOn = true;          // pollsters with fewer than MIN_POLLS polls, as one group
let baseline = null;         // the fit with every pollster, for the order of the list and the presets
let current = null;          // the latest fit

/* ---------- controls ---------- */
const yearSeg = segmented({
  label: "Election", value: "2020", options: YEARS.map((y) => ({ value: String(y), label: `${y}: ${surname(E.results[y].dem)} v ${surname(E.results[y].rep)}` })),
  onChange: (v) => { state.year = Number(v); newCycle(); },
});
const windowSel = select({
  label: "Polls whose fieldwork's middle day was in the final", value: "61",
  options: [14, 21, 35, 61].map((d) => ({ value: String(d), label: `${d} days` })),
  hint: "The model lets opinion move week by week, so older polls still say something about each pollster's lean.",
  onChange: (v) => { state.maxDays = Number(v); newCycle(); },
});
const adjustBox = checkbox({ label: "Estimate and remove each pollster's lean", checked: true, onChange: (on) => { state.adjust = on; refit(); } });
const totalSlider = slider({ label: "Polling error in each state", min: 0, max: 6, step: 0.1, value: state.total, format: (v) => `${fmt.num(v, 1)} points`, hint: "One standard deviation of how far the polls' estimate in a state can miss, all sources together.", onInput: (v) => { state.total = v; forecastSoon(); } });
const rhoSlider = slider({ label: "Share of that error all states have in common", min: 0, max: 1, step: 0.05, value: state.rho, format: (v) => `${fmt.int(v * 100)}%`, hint: "0%: each state misses on its own. 100%: every state misses by the same amount in the same direction.", onInput: (v) => { state.rho = v; forecastSoon(); } });
const useRho = button("Use the estimate from five elections", () => { rhoSlider.value = state.rho = Math.round(structure.rho * 20) / 20; forecast(); }, { small: true });
const resetBtn = button("Reset", () => {
  Object.assign(state, { maxDays: 61, adjust: true, total: DEFAULTS.total, rho: DEFAULTS.rho });
  windowSel.value = "61"; adjustBox.checked = true; totalSlider.value = state.total; rhoSlider.value = state.rho;
  newCycle();
}, { small: true });

const src = E.sources;
const about = el("div", { class: "small muted d87-source" },
  el("strong", { text: "Data. " }),
  "Polls: FiveThirtyEight's raw_polls.csv, the presidential polls it used to rate pollsters, final 61 days of each campaign (",
  el("a", { href: src.polls.url, text: "538 on GitHub" }), ", ", el("a", { href: src.polls.licenceUrl, text: "CC BY 4.0" }),
  `, retrieved ${fmt.date(src.polls.retrieved)}). Changes: only presidential general-election polls kept, Maine and Nebraska districts renamed, every poll turned into the Democrat's share of the two-party vote. Results: Federal Election Commission certified totals 2004 to 2020 (public domain) and the certificates of ascertainment of Maine and Nebraska held by the National Archives. The forecast here rebuilds 2016 or 2020 from their own polls to show the method; it is not a forecast of any future election.`);

const controls = el("div", { class: "controls" }, yearSeg.el, windowSel.el, adjustBox.el,
  el("div", { class: "field d87-group", role: "group", "aria-labelledby": "d87-fc" }, el("p", { class: "d87-grouphead", id: "d87-fc", text: "Correlated errors in the forecast" }), totalSlider.el, rhoSlider.el, el("div", { class: "row" }, useRho)),
  el("div", { class: "row" }, resetBtn), about);

/* ---------- outputs ---------- */
const sFit = stat("In the fit");
const sTau = stat("Typical lean of a pollster");
const sSigma = stat("Noise beyond sampling");
const sMiss = stat("Average poll against the result");
const progress = el("p", { class: "small muted d87-progress" });
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div");

const presets = el("div", { class: "row d87-presets", role: "group", "aria-label": "Choose pollsters" });
const leanList = el("div", { class: "d87-leans", role: "group", "aria-label": "Pollsters in the fit and their estimated leans" });
const smallBox = checkbox({ label: "", checked: true, onChange: (on) => { smallOn = on; refitSoon(); } });
const leanPanel = el("div", { class: "panel d87-stack", id: "d87-leans" },
  el("h2", { text: "How much each pollster leans" }),
  el("p", { class: "small", text: "Each pollster's house effect: how much higher (D) or lower (R) it put the Democrat's share of the two-party vote than the average poll in the fit, after allowing for where and in which week each poll was taken. The average weights each pollster by its number of polls, so it moves when pollsters are left out. The bar is the 90% interval; a pollster is said to lean only when the whole interval is on one side of zero. Untick a pollster to leave its polls out of the fit." }),
  presets, el("div", { class: "d87-axis", "aria-hidden": "true" }, el("span", { text: "" }), el("span", { class: "d87-scale" }, el("span", { text: "R +4" }), el("span", { text: "0" }), el("span", { text: "D +4" })), el("span", { text: "" })),
  leanList, el("div", { class: "d87-small" }, smallBox.el), el("details", { class: "chart-table" }, el("summary", { text: "Show every pollster in the fit as a table, with its polls against the result" }), el("div", { class: "d87-tbl", id: "d87-alltable" })));

const fcStats = el("div", { class: "stats" });
const fcStatus = el("p", { class: "sr-only", role: "status" });
const fcText = el("div");
const rhoBox = el("div");
const fcPanel = el("div", { class: "panel d87-stack", id: "d87-forecast" }, el("h2", { text: "The forecast with these pollsters and correlated errors" }), fcStats, fcStatus, fcText, rhoBox);
const errText = el("div");
const errBox = el("div");
const errTable = el("div", { class: "d87-tbl" });
const errPanel = el("div", { class: "panel d87-stack", id: "d87-five" }, el("h2", { text: "How correlated are polling errors? Five elections" }), errText, errBox, errTable);
const fakeTau = slider({ label: "True spread of leans", min: 0, max: 4, step: 0.1, value: state.fakeTau, format: (v) => `${fmt.num(v, 1)} points`, onInput: (v) => { state.fakeTau = v; } });
const fakeSigma = slider({ label: "True noise beyond sampling", min: 0, max: 4, step: 0.1, value: state.fakeSigma, format: (v) => `${fmt.num(v, 1)} points`, onInput: (v) => { state.fakeSigma = v; } });
const fakeRun = button("Run the check", () => runFake(), { primary: true, small: true });
const fakeNew = button("Run with a new seed", () => { state.fakeSeed = randomSeed(); runFake(); }, { small: true });
const fakeProgress = el("p", { class: "small muted d87-progress", tabindex: "-1" });
const fakeOut = el("div", { class: "d87-stack" });
const fakeStatus = el("p", { class: "sr-only", role: "status" });
const fakeChartBox = el("div");
const fakePanel = el("div", { class: "panel d87-stack", id: "d87-check" }, el("h2", { text: "Check the method on pollsters whose leans are known" }),
  el("p", { class: "small", text: "The check makes fake polls with the same places, weeks, pollsters and sample sizes as the real ones, gives each pollster a lean drawn at random, fits the same model and compares what it finds with the truth." }),
  el("div", { class: "grid2" }, fakeTau.el, fakeSigma.el), el("div", { class: "row" }, fakeRun, fakeNew), fakeProgress, fakeStatus, fakeOut, fakeChartBox);

const out = el("div", { class: "out" }, el("div", { class: "stats", id: "d87-results" }, sFit.el, sTau.el, sSigma.el, sMiss.el), progress, status, message, leanPanel, fcPanel);
const jump = el("nav", { class: "row d87-jump", "aria-label": "Jump to the results" }, el("span", { class: "small muted", text: "Jump to:" }),
  [["#d87-leans", "pollsters"], ["#d87-forecast", "forecast"], ["#d87-five", "five elections"], ["#d87-check", "the check"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out), errPanel, fakePanel);

const rhoChart = chart(rhoBox, { series: [], height: 260 });
const errChart = chart(errBox, { series: [], height: 300 });
const fakeChart = chart(fakeChartBox, { series: [], height: 300 });

/* ---------- a table that becomes labelled lines when its box is narrow ---------- */
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl d87-rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {},
      columns.map((c, k) => el(k === 0 ? "th" : "td", { scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/* ---------- the pollster list: built once per cycle, then updated in place so focus is never lost ---------- */
let rows = new Map(); // pollster -> { box, bar, dot, text }
let counts = new Map(), big = [], small = [];

function buildList() {
  counts = pollsterCounts(E, state.year, state.maxDays);
  big = [...counts].filter(([, n]) => n >= MIN_POLLS).map(([p]) => p);
  small = [...counts].filter(([, n]) => n < MIN_POLLS).map(([p]) => p);
  chosen = new Set(counts.keys());
  smallOn = true; smallBox.checked = true;
  smallBox.el.querySelector("span").textContent = `${plural(small.length, "pollster", "pollsters")} with fewer than ${MIN_POLLS} polls each (${plural(small.reduce((s, p) => s + counts.get(p), 0), "poll", "polls")}), kept or dropped together`;
  rows = new Map();
  for (const p of big) {
    const box = checkbox({ label: `${nameOf(p)} (${counts.get(p)})`, checked: true, onChange: (on) => { if (on) chosen.add(p); else chosen.delete(p); refitSoon(); } });
    box.input.setAttribute("aria-describedby", `d87-lean-${p}`);
    const bar = el("span", { class: "d87-bar" }), dot = el("span", { class: "d87-dot" });
    const text = el("span", { class: "d87-val", id: `d87-lean-${p}` });
    rows.set(p, { row: el("div", { class: "d87-row" }, box.el, el("span", { class: "d87-track" }, el("span", { class: "d87-zero" }), bar, dot), text), box, bar, dot, text });
  }
  leanList.replaceChildren(...big.map((p) => rows.get(p).row));
  presets.replaceChildren(
    button("All pollsters", () => setChoice(() => true, true), { small: true }),
    button("Leave out partisan polls", () => setChoice(() => true, true, true), { small: true }),
    ...dropButtons(),
    button("Only the ten with most polls", () => setChoice((p) => [...big].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, 10).includes(p), false), { small: true }));
}
/** The two presets that need the fit with every pollster and its leans: disabled until that fit is done. */
let dropBtns = [];
function dropButtons() {
  dropBtns = [
    button("Drop the five leaning most to R", () => setChoice((p) => !mostLean(-1).includes(p), true), { small: true }),
    button("Drop the five leaning most to D", () => setChoice((p) => !mostLean(1).includes(p), true), { small: true }),
  ];
  for (const x of dropBtns) { x.disabled = !baseline; x.title = "Uses the fit with every pollster and every lean estimated"; }
  return dropBtns;
}
let noPartisan = false;
function setChoice(keep, keepSmall, dropPartisan = false) {
  noPartisan = dropPartisan;
  chosen = new Set([...counts.keys()].filter((p) => (big.includes(p) ? keep(p) : keepSmall)));
  for (const [p, r] of rows) r.box.checked = chosen.has(p);
  smallOn = keepSmall; smallBox.checked = keepSmall;
  refit();
}
/** The five pollsters leaning furthest one way in the fit with every pollster. */
function mostLean(sign) {
  if (!baseline) return [];
  return baseline.sum.house.filter((h) => big.includes(h.pollster)).sort((a, b) => sign * (b.mean - a.mean)).slice(0, 5).map((h) => h.pollster);
}

/* ---------- fitting, in slices ---------- */
let job = 0;
const refitSoon = debounce(() => refit(), 350);
function newCycle() { baseline = null; bjob++; baselineRunning = false; noPartisan = false; buildList(); refit(); }

/* The fit with every pollster and leans estimated orders the list and picks "the five leaning most". It is the first fit
   of a cycle unless the visitor has already changed something, in which case it runs on its own in the background. */
let bjob = 0, baselineRunning = false;
const isBaselineChoice = () => state.adjust && chosen.size === counts.size && smallOn && !noPartisan;
function setBaseline(b) {
  baseline = b; baselineRunning = false;
  orderList();
  for (const x of dropBtns) x.disabled = false;
}
function fitBaseline() {
  const id = ++bjob;
  baselineRunning = true;
  const s = sampler(pollRows(E, state.year, { maxDays: state.maxDays }), { sweeps: DEFAULTS.sweeps, burn: DEFAULTS.burn, seed: DEFAULTS.seed, adjust: true });
  const step = () => {
    if (id !== bjob || baseline) return;
    s.step(SWEEP_SLICE);
    if (s.done < s.sweeps) { setTimeout(step, 0); return; }
    setBaseline({ s, sum: summary(s) });
  };
  setTimeout(step, 0);
}

function refit() {
  const id = ++job;
  const keep = (p, part) => (big.includes(p) ? chosen.has(p) : smallOn) && !(noPartisan && part !== 0);
  const data = pollRows(E, state.year, { maxDays: state.maxDays, keep });
  const asBaseline = isBaselineChoice();
  if (!baseline && !asBaseline && !baselineRunning) fitBaseline();
  if (!data.length) {
    progress.textContent = "";
    message.replaceChildren(note("bad", "No polls are left in the fit. Tick at least one pollster, or press All pollsters."));
    current = null; clearResults(); return;
  }
  message.replaceChildren(...(data.length < 30 ? [note("warn", `Only ${plural(data.length, "poll is", "polls are")} left in the fit, so the estimates below rest on very little.`)] : []));
  const s = sampler(data, { sweeps: DEFAULTS.sweeps, burn: DEFAULTS.burn, seed: DEFAULTS.seed, adjust: state.adjust });
  const step = () => {
    if (id !== job) return;
    s.step(SWEEP_SLICE);
    if (s.done < s.sweeps) { progress.textContent = `Fitting the model: ${fmt.int(s.done)} of ${fmt.int(s.sweeps)} sweeps of the Gibbs sampler.`; setTimeout(step, 0); return; }
    progress.textContent = "";
    current = { s, sum: summary(s), data };
    if (!baseline && asBaseline) setBaseline(current);
    showFit();
    forecast();
    if (!fakeStarted) { fakeStarted = true; runFake(); } // the check runs once on load, after the first fit
  };
  progress.textContent = `Fitting the model: 0 of ${fmt.int(DEFAULTS.sweeps)} sweeps of the Gibbs sampler.`;
  setTimeout(step, 0);
}

function orderList() {
  const m = new Map(baseline.sum.house.map((h) => [h.pollster, h.mean]));
  big.sort((a, b) => (m.get(a) ?? 0) - (m.get(b) ?? 0) || a - b);
  // Moving the rows takes focus away from a tick box inside them: give it back.
  const had = leanList.contains(document.activeElement) ? document.activeElement : null;
  leanList.replaceChildren(...big.map((p) => rows.get(p).row));
  if (had) had.focus();
}

const toPct = (v) => `${clamp((v + 4) / 8, 0, 1) * 100}%`;
function clearResults() {
  for (const [, r] of rows) { r.bar.style.display = "none"; r.dot.style.display = "none"; r.text.textContent = "left out"; }
  for (const s of [sFit, sTau, sSigma, sMiss]) s.set("–", "");
  fcStats.replaceChildren(); fcText.replaceChildren(); fcStatus.textContent = "";
  rhoChart.update({ series: [], marks: [], title: "", subtitle: "", empty: "No polls in the fit" });
  $("#d87-alltable").replaceChildren();
  status.textContent = "No polls are left in the fit.";
}

function showFit() {
  const { sum, data } = current;
  const res = E.results[String(state.year)];
  const D = surname(res.dem);
  const house = new Map(sum.house.map((h) => [h.pollster, h]));
  for (const [p, r] of rows) {
    const h = house.get(p);
    if (!h || !state.adjust) {
      r.bar.style.display = "none"; r.dot.style.display = "none";
      r.text.textContent = !h ? "left out" : "not estimated";
      continue;
    }
    r.bar.style.display = ""; r.dot.style.display = "";
    r.bar.style.left = toPct(h.lo); r.bar.style.width = `calc(${toPct(h.hi)} - ${toPct(h.lo)})`;
    r.dot.style.left = toPct(h.mean);
    r.text.textContent = `${leanText(h.mean)} (${leanText(h.lo)} to ${leanText(h.hi)}), ${lean(h)}`;
  }
  const nPoll = new Set(data.map((d) => d.p)).size;
  sFit.set(plural(data.length, "poll", "polls"), `from ${plural(nPoll, "pollster", "pollsters")}`);
  if (state.adjust) sTau.set(`${fmt.num(sum.tau, 1)} points`, "standard deviation of the house effects (τ)"); else sTau.set("–", "house effects switched off");
  sSigma.set(`${fmt.num(sum.sigma, 1)} points`, "standard deviation of a poll's error on top of sampling (σ)");
  // The fitted levels against the results, over the polled states.
  const misses = sum.level.filter((l) => l.place < 51).map((l) => l.mean - twoParty(res.d[l.place], res.r[l.place]));
  const avgMiss = stats.mean(misses);
  sMiss.set(`${leanText(avgMiss)}`, `the fitted level minus the result, averaged over ${plural(misses.length, "polled state", "polled states")}${sum.level.some((l) => E.units[l.place] === "DC") ? " (Washington DC counted as one)" : ""}`);
  status.textContent = `Fitted ${plural(data.length, "poll", "polls")} from ${plural(nPoll, "pollster", "pollsters")}. ${state.adjust ? `Typical lean ${fmt.num(sum.tau, 1)} points. ` : ""}On average the polls ${avgMiss > 0 ? `overstated ${D}` : `understated ${D}`} by ${fmt.num(Math.abs(avgMiss), 1)} points of the two-party vote.`;

  // Every pollster in the fit against the result.
  const byP = new Map();
  for (const d of data) {
    const r = d.u < E.units.length ? twoParty(res.d[d.u], res.r[d.u]) : nationalShare(res);
    if (!byP.has(d.p)) byP.set(d.p, []);
    byP.get(d.p).push(d.y - r);
  }
  const list = [...byP].map(([p, errs]) => ({ p, n: errs.length, err: stats.mean(errs), h: house.get(p) })).sort((a, b) => b.n - a.n || a.p - b.p);
  $("#d87-alltable").replaceChildren(listTable({
    caption: `Every pollster in the fit, most polls first. Error: the pollster's polls minus the result in the same place, averaged (D: overstated ${D}).`,
    columns: [
      { label: "Pollster", get: (r) => nameOf(r.p) },
      { label: "Polls", get: (r) => fmt.int(r.n), num: true },
      { label: "House effect (90% interval)", get: (r) => (state.adjust ? `${leanText(r.h.mean)} (${leanText(r.h.lo)} to ${leanText(r.h.hi)})` : "not estimated"), num: true },
      { label: "Average error against the result", get: (r) => leanText(r.err), num: true },
    ],
    rows: list,
  }));
}

/* ---------- the forecast under correlated errors ---------- */
const forecastSoon = debounce(() => forecast(), 150);
let fjob = 0;
function forecast() {
  if (!current) return;
  const id = ++fjob;
  const year = state.year, res = E.results[String(year)], D = surname(res.dem), R = surname(res.rep);
  const est = unitEstimates(E, year, current.sum);
  const f = simulate(E, year, est, { total: state.total, rho: state.rho, sims: DEFAULTS.sims, seed: 1 });
  let actualD = 0;
  res.d.forEach((d, i) => { if (d > res.r[i]) actualD += res.ev[i]; });
  fcStats.replaceChildren(stat("Chance of winning", `${D} ${pct(f.winD)}`, `${R} ${pct(f.winR)}`).el, stat("Electoral votes, median", `${D} ${f.median}`, `80% between ${f.lo} and ${f.hi}; actual ${actualD}`).el);
  fcStatus.textContent = `Forecast with ${fmt.int(state.rho * 100)}% of the error shared: ${D} ${pct(f.winD)}, ${R} ${pct(f.winR)}, median ${f.median} electoral votes for ${D}.`;
  const unpolled = est.filter((e) => !e.polled).length;
  fcText.replaceChildren(el("p", { class: "small", text: `Each state starts from the fitted level of its polls${state.adjust ? ", with every pollster's lean removed," : ""} and ${plural(unpolled, "contest", "contests")} with no polls in the fit move with the average swing of the polled states. ${fmt.int(DEFAULTS.sims)} simulated elections with an error of ${fmt.num(state.total, 1)} points in each state, ${fmt.int(state.rho * 100)}% of it shared by every state.` }));
  // The chance of winning as the shared share rises, with the same random numbers at each point.
  const curve = [];
  let k = 0;
  const next = () => {
    if (id !== fjob) return;
    const g = simulate(E, year, est, { total: state.total, rho: RHOS[k], sims: 3000, seed: 1 });
    curve.push([RHOS[k] * 100, g.winD * 100]);
    k++;
    if (k < RHOS.length) { setTimeout(next, 0); return; }
    rhoChart.update({
      title: `${D}'s chance of winning as more of the error is shared`,
      subtitle: `The same total error (${fmt.num(state.total, 1)} points), split differently between a part every state shares and a part each state draws alone. 3,000 simulations per point.`,
      label: `Line chart of ${D}'s chance of winning against the share of the error that is common to all states`,
      x: { label: "Share of the error common to all states (%)", domain: [0, 100], format: (v) => `${fmt.int(v)}%` },
      y: { label: `Chance ${D} wins (%)`, domain: [0, 100], format: (v) => `${fmt.int(v)}%` },
      series: [{ name: `${D}'s chance`, type: "line", data: curve, color: 0 }, { name: "Points", type: "scatter", data: curve, color: 0, r: 3, hover: false }],
      legend: false,
      marks: [{ type: "vline", x: state.rho * 100, text: "Setting" }, ...(structure ? [{ type: "span", x0: structure.rhoLo * 100, x1: structure.rhoHi * 100, opacity: 0.08 }] : [])],
    });
  };
  setTimeout(next, 0);
}

/* ---------- five elections ---------- */
const cycles = ERROR_YEARS.map((y) => stateErrors(E, y));
const structure = errorStructure(cycles);
function showErrors() {
  const pts = cycles.flatMap((c) => c.states.map((s) => ({ x: c.year, y: s.error, label: `${E.names[s.unit]}, ${c.year}` })));
  errChart.update({
    title: "Average poll minus result, state by state, in five elections",
    subtitle: "Each grey dot is a state (or Washington DC) with at least 3 polls in the final 21 days; the line joins each election's average over its states. Above zero, the polls overstated the Democrat.",
    label: "Scatter plot of state polling errors in five presidential elections with each election's average",
    hover: "point",
    x: { label: "Election", domain: [2002, 2022], format: (v) => String(Math.round(v)) },
    y: { label: "Poll minus result (points of the Democrat's two-party share)", format: (v) => fmt.signed(v, 0) },
    series: [{ name: "States", type: "scatter", data: pts, color: "#8a94a3", r: 3 }, { name: "Average over states", type: "line", data: cycles.map((c) => ({ x: c.year, y: c.common, label: `Average, ${c.year}` })), color: 0, width: 2.5 }, { name: "Election averages", type: "scatter", data: cycles.map((c) => ({ x: c.year, y: c.common, label: `Average, ${c.year}` })), color: 0, r: 5, legend: false }],
    marks: [{ type: "hline", y: 0 }],
  });
  const s = structure;
  errText.replaceChildren(
    el("p", { class: "small", text: `In each election the polls' errors share a common part: their average over the states. Over five elections that part has a root mean square of ${fmt.num(s.sNat, 2)} points, but five numbers pin it down poorly: a 90% interval runs from ${fmt.num(s.natLo, 2)} to ${fmt.num(s.natHi, 2)} points. Around each election's average the states scatter with a standard deviation of ${fmt.num(s.sState, 2)} points (from ${fmt.int(s.df + cycles.length)} state errors, so this part is well measured). The shared share of the error is therefore about ${fmt.int(s.rho * 100)}%, with a 90% interval from ${fmt.int(s.rhoLo * 100)}% to ${fmt.int(s.rhoHi * 100)}%: the shaded band in the chart above.` }),
    el("p", { class: "small", text: "Whether a state's error repeats from one election to the next is measured by the correlation, across the states polled in both, of each state's error minus that election's average. A positive correlation means some states are missed in the same direction election after election." }));
  errTable.replaceChildren(listTable({
    caption: "The five elections. Errors in points of the Democrat's two-party share; correlation with the election before, with a 90% interval.",
    columns: [
      { label: "Election", get: (r) => String(r.c.year) },
      { label: "States and DC with 3 or more polls", get: (r) => fmt.int(r.c.states.length), num: true },
      { label: "Average error", get: (r) => leanText(r.c.common), num: true },
      { label: "Spread around it", get: (r) => fmt.num(r.c.spread, 2), num: true },
      { label: "Correlation with the election before", get: (r) => (r.p ? `${fmt.num(r.p.r, 2)} (${fmt.num(r.p.lo, 2)} to ${fmt.num(r.p.hi, 2)}), ${r.p.n} states` : "–"), num: true },
    ],
    rows: cycles.map((c, k) => ({ c, p: k ? persistence(cycles[k - 1], c) : null })),
  }));
}

/* ---------- the check on simulated pollsters ---------- */
let fakeJob = 0, fakeStarted = false;
function runFake() {
  const id = ++fakeJob;
  const data = pollRows(E, state.year, { maxDays: state.maxDays });
  const fk = fakeRows(E, state.year, data, { tau: state.fakeTau, sigma: state.fakeSigma, seed: state.fakeSeed });
  const s = sampler(fk.rows, { sweeps: DEFAULTS.sweeps, burn: DEFAULTS.burn, seed: state.fakeSeed + 1 });
  fakeOut.replaceChildren();
  const step = () => {
    if (id !== fakeJob) return;
    s.step(SWEEP_SLICE);
    if (s.done < s.sweeps) { fakeProgress.textContent = `Fitting the fake polls: ${fmt.int(s.done)} of ${fmt.int(s.sweeps)} sweeps.`; setTimeout(step, 0); return; }
    fakeProgress.textContent = "";
    const sum = summary(s);
    const c = new Map(); for (const d of fk.rows) c.set(d.p, (c.get(d.p) || 0) + 1);
    const all = recovery(sum, fk.hTrue, c, 1), many = recovery(sum, fk.hTrue, c, MIN_POLLS);
    const text = `Seed ${state.fakeSeed}: ${fmt.int(fk.rows.length)} fake polls from ${plural(all.n, "pollster", "pollsters")}. The model put the spread of leans at ${fmt.num(sum.tau, 2)} points (truth ${fmt.num(state.fakeTau, 1)}) and the noise beyond sampling at ${fmt.num(sum.sigma, 2)} (truth ${fmt.num(state.fakeSigma, 1)}). For the ${plural(many.n, "pollster", "pollsters")} with at least ${MIN_POLLS} polls, the estimated leans missed the true ones by ${fmt.num(many.rmse, 2)} points (root mean square), and the 90% intervals held the truth for ${fmt.pct(many.coverage, 0)} of them; over all pollsters, ${fmt.pct(all.coverage, 0)}. ${Number.isFinite(many.slope) ? `The slope of estimate on truth is ${fmt.num(many.slope, 2)}${many.slope < 1 ? ": below 1 because the model pulls leans it is unsure of towards zero." : "; the model pulls leans it is unsure of towards zero, which usually keeps it below 1."}` : "Every true lean is zero, so there is no slope to measure; the inverse-gamma prior on the spread keeps the estimated spread away from zero."}`;
    fakeOut.replaceChildren(note("", text));
    fakeStatus.textContent = text;
    const lim = Math.max(1, ...many.items.flatMap((i) => [Math.abs(i.truth), Math.abs(i.mean)])) * 1.1;
    fakeChart.update({
      title: "Estimated against true lean, fake pollsters with at least 5 polls",
      subtitle: "On the diagonal the model found the true lean exactly. Hover a dot for its interval.",
      label: "Scatter plot of estimated house effects against the true ones for simulated pollsters",
      hover: "point",
      x: { label: "True lean (points, D positive)", domain: [-lim, lim], format: (v) => fmt.signed(v, 1) },
      y: { label: "Estimated lean (points, D positive)", domain: [-lim, lim], format: (v) => fmt.signed(v, 1) },
      series: [{ name: "Exact", type: "line", data: [[-lim, -lim], [lim, lim]], color: "#16233b", width: 1, hover: false }, { name: "Fake pollsters", type: "scatter", data: many.items.map((i) => ({ x: i.truth, y: i.mean, label: `${nameOf(i.pollster)} (fake): 90% interval ${fmt.signed(i.lo, 1)} to ${fmt.signed(i.hi, 1)}` })), color: 6 }],
      legend: false,
    });
  };
  fakeProgress.textContent = `Fitting the fake polls: 0 of ${fmt.int(DEFAULTS.sweeps)} sweeps.`;
  setTimeout(step, 0);
}

showErrors();
newCycle();
