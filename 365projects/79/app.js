// Day 79: Sovereign Default Simulator. Interface.
import { $, el, fmt, clamp, debounce, mount, slider, segmented, numberField, button, stat, note, chart, randomSeed } from "../kit/kit.js";
import {
  ARELLANO, LIMITS, GRID, readParams, createSolver, decide, boundary, monotoneInIncome, pricesFallWithDebt,
  equivalent, nearestState, simulate, longRun,
} from "./logic.js";

mount();

let sol = null; // the solution on show
let job = 0; // the current solving job; older ones stop at their next slice
let solver = null;

/* ---------- units ----------
   In the model income is 1 a quarter at trend and debt is measured in quarters of trend income.
   The page shows debt as a share of a year's income at trend (4 quarters), and income as % above or below trend. */
const annual = (d) => (d / 4) * 100; // % of a year's trend income
const debtText = (d) => `${fmt.num(annual(d), 2)}%`;
const devOf = (z) => (Math.exp(z) - 1) * 100;
const incomeText = (z) => {
  const v = devOf(z);
  return Math.abs(v) < 0.005 ? "at trend" : `${fmt.num(Math.abs(v), 1)}% ${v < 0 ? "below" : "above"} trend`;
};
const pctText = (x, d = 1) => fmt.pct(x, d);
const spreadText = (sp) => (Number.isFinite(sp) ? `${fmt.num(sp * 100, 2)} points` : "no lender pays anything");

/* ---------- presets ---------- */
const PRESETS = [
  { label: "Arellano (2008), Argentina", values: ARELLANO, note: "Arellano's calibration for Argentina." },
  { label: "No output cost", values: { ...ARELLANO, yhat: 1 }, note: "Default costs only a spell out of the market." },
  { label: "Permanent exclusion", values: { ...ARELLANO, theta: 0 }, note: "A defaulter never borrows again." },
  { label: "A more patient government", values: { ...ARELLANO, beta: 0.98 }, note: "Discount factor 0.98 instead of 0.953." },
  { label: "A calmer economy", values: { ...ARELLANO, eta: 0.0125 }, note: "Income shocks half as large." },
];

/* ---------- parameter sliders ---------- */
const SPEC = {
  beta: { label: "Patience: discount factor a quarter", step: 0.001, show: (v) => fmt.num(v, 3), hint: "How much the government values next quarter against this one. Below 1 / (1 + r): it is less patient than its lenders." },
  sigma: { label: "Risk aversion", step: 0.5, show: (v) => fmt.num(v, 1), hint: "Curvature of utility, c^(1 - σ)/(1 - σ). Higher means bad quarters hurt more." },
  r: { label: "Risk-free interest rate", step: 0.001, show: (v) => `${fmt.num(v * 100, 1)}% a quarter`, hint: "What lenders earn elsewhere. 1.7% a quarter is about 7% a year." },
  rho: { label: "Persistence of income", step: 0.005, show: (v) => fmt.num(v, 3), hint: "How much of this quarter's gap from trend is left next quarter, in logs." },
  eta: { label: "Size of income shocks", step: 0.0005, show: (v) => `${fmt.num(v * 100, 2)}%`, hint: "Standard deviation of each quarter's shock to log income." },
  yhat: { label: "Income in default is at most", step: 0.001, show: (v) => `${fmt.num(v * 100, 1)}% of average`, hint: "The output cost of default: while in default, income above this level is lost. 100% means no output cost." },
  theta: { label: "Chance of borrowing again each quarter", step: 0.001, show: (v) => (v === 0 ? "never" : `${fmt.num(v * 100, 0)}%: about ${fmt.sig(1 / v, 2)} ${1 / v < 1.05 ? "quarter" : "quarters"} out`), hint: "After a default the government is shut out of the market until it is let back in, with this chance each quarter, with no debt." },
};
const sliders = {};
for (const [key, spec] of Object.entries(SPEC)) {
  const lim = LIMITS[key];
  sliders[key] = slider({ label: spec.label, min: lim.min, max: lim.max, step: spec.step, value: ARELLANO[key], format: spec.show, hint: spec.hint, onInput: () => paramsChanged() });
}
const paramMsg = el("div", { class: "d79-msg", "aria-live": "polite" });
const presetNote = el("p", { class: "hint", text: PRESETS[0].note });

function applyPreset(p) {
  for (const key of Object.keys(SPEC)) sliders[key].value = p.values[key];
  presetNote.textContent = p.note;
  paramsChanged();
}
// The folded summary says which settings are in use.
function describeSettings() {
  const v = Object.fromEntries(Object.keys(SPEC).map((k) => [k, sliders[k].value]));
  const match = PRESETS.find((p) => Object.keys(SPEC).every((k) => Math.abs(p.values[k] - v[k]) < 1e-9));
  sumNote.textContent = match ? `: ${match.label}` : ": your own settings";
}

/* ---------- the situation: debt and income now ---------- */
// Both sliders run over the solution's own grid points, so every position is a state the model solved.
const debtSlider = slider({ label: "Debt due this quarter", min: 0, max: GRID.nPos, step: 1, value: 20, format: (k) => (sol ? `${debtText(sol.d[sol.zero + k])} of a year's income` : ""), hint: "Measured against a year's income at trend. The grid steps are the model's own.", onInput: () => { situation.debt = situation.want = sol.d[sol.zero + debtSlider.value]; showSituation(); } });
const incomeSlider = slider({ label: "Income this quarter", min: 0, max: GRID.ny - 1, step: 1, value: (GRID.ny - 1) / 2, format: (i) => (sol ? incomeText(sol.z[i]) : ""), hint: "One of the model's 21 income levels, from three standard deviations below trend to three above.", onInput: () => { situation.i = incomeSlider.value; showSituation(); } });
// want: the debt the visitor last chose; debt: the nearest point to it on the grid solved.
const situation = { debt: 0.05, want: 0.05, i: (GRID.ny - 1) / 2 };

/* ---------- shocks to try ---------- */
const modeSeg = segmented({ label: "Shocks", value: "recession", options: [{ value: "recession", label: "A recession you design" }, { value: "random", label: "Random shocks" }], onChange: () => { showMode(); runScenario(); } });
const depthSlider = slider({ label: "Depth of the recession", min: 1, max: 20, step: 0.5, value: 9, format: (v) => `income ${fmt.num(v, 1)}% below trend`, onInput: () => scenarioChanged() });
const lengthSlider = slider({ label: "Length", min: 1, max: 12, step: 1, value: 4, format: (v) => `${v} ${v === 1 ? "quarter" : "quarters"}, then recovery`, onInput: () => scenarioChanged() });
const yearsSlider = slider({ label: "Simulated years", min: 5, max: 100, step: 5, value: 30, format: (v) => `${v} years`, onInput: () => scenarioChanged() });
const seedField = numberField({ label: "Seed", min: 0, max: 4294967295, step: 1, value: 1, hint: "Fixes the random draws: income shocks, and the quarters in which a defaulter is let back in.", onInput: () => scenarioChanged() });
const seedMsg = el("div", { class: "d79-msg", "aria-live": "polite" });
seedField.input.addEventListener("input", () => scenarioChanged());
const recessionBox = el("div", { class: "d79-stack" }, depthSlider.el, lengthSlider.el);
const randomBox = el("div", { class: "d79-stack" }, yearsSlider.el);
function showMode() { const rec = modeSeg.value === "recession"; recessionBox.hidden = !rec; randomBox.hidden = rec; }

// The economy's settings fold away, open on a wide screen and shut on a phone, so the situation sliders sit next to
// the verdict they change.
const economy = el("details", { class: "d79-economy" },
  el("summary", {}, el("span", { class: "d79-sum", text: "The economy and the penalty" }), el("span", { class: "small muted d79-sumnote", text: "" })),
  el("div", { class: "d79-stack" },
    el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
      el("div", { class: "row d79-examples", role: "group", "aria-label": "Examples" }, PRESETS.map((p) => button(p.label, () => applyPreset(p), { small: true }))),
      presetNote),
    ...Object.values(sliders).map((s) => s.el), paramMsg));
if (typeof matchMedia !== "undefined" && matchMedia("(min-width: 861px)").matches) economy.open = true;
const sumNote = economy.querySelector(".d79-sumnote");

const controls = el("div", { class: "controls" },
  el("h2", { id: "d79-situation", text: "The situation" }),
  debtSlider.el, incomeSlider.el, economy);
const shockControls = el("div", { class: "controls" },
  el("h2", { text: "Shocks to try" }),
  modeSeg.el, recessionBox, randomBox,
  el("div", { class: "field" }, seedField.el, el("div", { class: "row" }, button("New seed", () => { seedField.value = randomSeed(); scenarioChanged(); }, { small: true })), seedMsg));

/* ---------- outputs ---------- */
const progress = el("p", { class: "small", tabindex: "-1" });
const stopBtn = button("Stop", () => stopSolve(), { small: true });
stopBtn.hidden = true;
const solveAgain = button("Solve again", () => { if (document.activeElement === solveAgain) progress.focus(); startSolve(); }, { small: true });
solveAgain.hidden = true;
const hideStop = () => { if (document.activeElement === stopBtn) progress.focus(); stopBtn.hidden = true; };
const staleNote = el("div");

const sDecision = stat("The government");
const sWorth = stat("Repaying against defaulting");
const sBorrow = stat("New borrowing");
const sLine = stat("It would default on this debt");
const status = el("p", { class: "sr-only", role: "status" });
const verdictText = el("p", { class: "small" });
const mapBox = el("div", { id: "d79-map" });
const priceBox = el("div");
const pathHead = el("h2", { id: "d79-path", text: "What the shocks do" });
const pathText = el("div", { class: "small d79-events" });
const incomeBox = el("div");
const debtBox = el("div");
const longHead = el("h2", { id: "d79-long", text: "Over 50,000 simulated years" });
const longBox = el("div");
const checkBox = el("div", { class: "small muted" });

const out = el("div", { class: "out" },
  el("div", { class: "row" }, progress, stopBtn, solveAgain), staleNote,
  el("div", { class: "stats", id: "d79-verdict" }, sDecision.el, sWorth.el, sBorrow.el, sLine.el), status, verdictText,
  mapBox, priceBox);
const shockOut = el("div", { class: "out" }, el("div", { class: "d79-stack" }, pathHead, pathText, incomeBox, debtBox));
const longOut = el("div", { class: "d79-stack d79-wide" }, longHead, longBox, checkBox,
  note("", "An illustration of a textbook model with Arellano's numbers for Argentina: not a forecast for any country, and not investment advice."));
const jump = el("nav", { class: "row d79-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d79-verdict", "the verdict"], ["#d79-map", "where it defaults"], ["#d79-shocks", "shocks"], ["#d79-long", "the long run"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out),
  el("div", { class: "tool-grid d79-second", id: "d79-shocks" }, shockControls, shockOut), longOut);

const mapChart = chart(mapBox, { series: [], height: 320 });
const priceChart = chart(priceBox, { series: [], height: 260 });
const incomeChart = chart(incomeBox, { series: [], height: 220 });
const debtChart = chart(debtBox, { series: [], height: 240 });

/* ---------- solving ---------- */

const solveSoon = debounce(() => startSolve(), 250);
const paramsChanged = () => { describeSettings(); solveSoon(); };

function readSliders() {
  const raw = {};
  for (const key of Object.keys(SPEC)) raw[key] = sliders[key].value;
  return readParams(raw);
}

function startSolve() {
  job++;
  const id = job;
  const read = readSliders();
  paramMsg.textContent = read.ok ? "" : read.errors.map((e) => e.message).join(" ");
  if (!read.ok) {
    staleNote.replaceChildren(note("warn", "Change the setting described in red to solve again. The results below are for the last settings solved."));
    hideStop();
    solveAgain.hidden = true;
    progress.textContent = "";
    return;
  }
  solveAgain.hidden = true;
  solver = createSolver(read.params);
  stopBtn.hidden = false;
  if (sol) staleNote.replaceChildren(note("", "Solving the new settings. The results below are still those of the last settings solved."));
  const slice = () => {
    if (id !== job) return;
    const t0 = performance.now();
    while (!solver.done && performance.now() - t0 < 20) solver.step(1);
    if (!solver.done) {
      progress.textContent = `Solving: iteration ${fmt.int(solver.totalIter)}, largest change in the values ${solver.change < 1e9 ? solver.change.toExponential(1) : "large"}${solver.grows ? `, debt grid widened ${solver.grows} ${solver.grows === 1 ? "time" : "times"}` : ""}.`;
      setTimeout(slice, 0);
      return;
    }
    hideStop();
    sol = solver;
    staleNote.replaceChildren(...(sol.gridShort ? [note("warn", `In some states the government would borrow as much as the debt grid allows, up to ${debtText(sol.d[sol.nd - 1])} of a year's income, even after the grid was widened. Results near the top of the grid are cut off by the grid, not by the model: treat the borrowing, the debt limits and the long-run debt with care.`)] : []));
    progress.textContent = sol.converged
      ? `Solved in ${fmt.int(sol.iter)} iterations${sol.grows ? ` (after widening the debt grid ${sol.grows} ${sol.grows === 1 ? "time" : "times"}, ${fmt.int(sol.totalIter)} in all)` : ""}.`
      : `Stopped after ${fmt.int(sol.iter)} iterations without converging: treat these results with care.`;
    adoptGrid();
    // Drawing waits for the next turn, and the long run for the one after, so that neither adds to the last slice.
    setTimeout(showAll, 0);
  };
  progress.textContent = "Solving.";
  setTimeout(slice, 0);
}

function stopSolve() {
  if (!solver || solver.done) return;
  job++;
  hideStop();
  solveAgain.hidden = false;
  progress.textContent = `Stopped at iteration ${fmt.int(solver.totalIter)}.`;
  staleNote.replaceChildren(note("warn", sol ? "The new settings were not solved. The results below are for the last settings solved." : "Nothing has been solved yet. Press Solve again."));
}

// The debt slider runs over the new grid, keeping the debt chosen as close as the grid allows.
function adoptGrid() {
  const k = clamp(Math.round(situation.want / sol.gap), 0, sol.nd - 1 - sol.zero);
  debtSlider.input.max = sol.nd - 1 - sol.zero;
  debtSlider.value = k;
  situation.debt = sol.d[sol.zero + k];
  incomeSlider.input.max = sol.ny - 1;
  incomeSlider.value = situation.i;
}

/* ---------- drawing ---------- */
function showAll() {
  showSituation();
  showChecks();
  runScenario();
  setTimeout(showLongRun, 0);
}

function showSituation() {
  if (!sol) return;
  const j = sol.zero + debtSlider.value;
  const i = incomeSlider.value;
  const r = decide(sol, j, i);
  const { sigma, beta } = sol.params;
  const ce = (v) => equivalent(v, sigma, beta);
  const b = boundary(sol);
  // The best income at which this debt is still defaulted on (default sets shrink as income rises).
  let worst = -1;
  for (let k = 0; k < sol.ny; k++) if (sol.D[k * sol.nd + j]) worst = k;
  const limitHere = b.first[i];

  if (r.def) {
    sDecision.set("Defaults", `on debt of ${debtText(r.debt)} of a year's income, with income ${incomeText(sol.z[i])}`);
    sBorrow.set("None", "shut out of the market; consumes its income, capped by the output cost");
  } else {
    sDecision.set("Repays", sol.d[j] > 0 ? `debt of ${debtText(r.debt)} of a year's income, with income ${incomeText(sol.z[i])}` : `it has no debt, with income ${incomeText(sol.z[i])}`);
    sBorrow.set(r.next > 0 ? `${debtText(r.next)}` : r.next < 0 ? "Saves" : "None",
      r.next > 0 ? `of a year's income, at a spread of ${spreadText(r.spread)} a year; lenders expect to be repaid with a ${pctText(r.repayChance, 1)} chance` : r.next < 0 ? `${debtText(-r.next)} of a year's income, at the risk-free rate` : "it neither borrows nor saves");
  }
  const cR = ce(r.vc), cD = ce(r.vd);
  const gap = cR > 0 ? (cR / cD - 1) * 100 : -Infinity;
  // The gap is often tiny near the boundary: say which way it goes rather than print 0.00%.
  const gapText = !Number.isFinite(gap) ? "Impossible" : Math.abs(gap) < 0.005 ? (gap >= 0 ? "Under +0.01%" : "Under −0.01%") : `${fmt.signed(gap, 2)}%`;
  sWorth.set(gapText,
    Number.isFinite(gap) ? `in steady consumption for ever: what repaying is worth ${gap >= 0 ? "over" : "against"} defaulting` : "this debt cannot be repaid out of this quarter's income and borrowing");
  sLine.set(worst < 0 ? "Never" : worst === sol.ny - 1 ? "Always" : `If income is ${incomeText(sol.z[worst])}`,
    worst < 0 ? "at any income on the grid" : worst === sol.ny - 1 ? "even at the highest income on the grid" : "or lower");
  const limitText = limitHere === null ? `At this income it repays every debt on the grid, up to ${debtText(sol.d[sol.nd - 1])} of a year's income.`
    : limitHere === sol.zero + 1 ? "At this income it defaults on any debt at all."
    : `At this income it repays debts up to ${debtText(sol.d[limitHere - 1])} of a year's income and defaults on ${debtText(sol.d[limitHere])} or more.`;
  verdictText.textContent = `${limitText} Consumption this quarter: ${fmt.num(r.c * 100, 1)}% of trend income.`;
  status.textContent = `${r.def ? "Defaults" : "Repays"}. ${limitText}`;

  drawMap(j, i, b);
  drawPrices(i, r);
}

function drawMap(j, i, b) {
  const top = annual(sol.d[sol.nd - 1]);
  const pts = sol.z.map((z, k) => [devOf(z), b.first[k] === null ? NaN : annual(sol.d[b.first[k]])]);
  const region = pts.filter((p) => Number.isFinite(p[1])).map(([x, y]) => [x, y, top]);
  const repaysAll = b.first.findIndex((f) => f === null);
  let noDebt = -1;
  b.first.forEach((f, k) => { if (f === sol.zero + 1) noDebt = k; });
  const yTop = Math.min(top, Math.max(annual(sol.d[j]) * 1.3, ...pts.map((p) => (Number.isFinite(p[1]) ? p[1] : 0)).filter((v) => v < top), 1));
  mapChart.update({
    title: "Where the government defaults",
    subtitle: `Shaded: the debts it would default on at each income. ${b.monotone ? "Every debt on or above the line is defaulted on and every debt below it repaid." : "Warning: on this grid some default sets are not one block; the line marks where defaults begin."}${repaysAll >= 0 ? ` From ${incomeText(sol.z[repaysAll])} up it repays every debt on the grid, up to ${debtText(sol.d[sol.nd - 1])} of a year's income.` : ""}${noDebt >= 0 ? ` Up to ${incomeText(sol.z[noDebt])} it defaults on any debt at all.` : ""} The dot is the situation chosen; click the chart to move it.`,
    label: "Chart of the smallest debt the government defaults on at each income level",
    x: { label: "Income this quarter (% from trend)", format: (v) => `${fmt.signed(v, 0)}%` },
    y: { label: "Debt (% of a year's income)", format: (v) => `${fmt.sig(v, 3)}%`, domain: [0, Math.ceil(yTop)] },
    series: [
      { name: "Defaults", type: "range", data: region, color: 7, opacity: 0.18 },
      { name: "Smallest debt defaulted on", type: "line", data: pts, color: 7 },
    ],
    marks: [{ type: "point", x: devOf(sol.z[i]), y: annual(sol.d[j]), text: sol.D[i * sol.nd + j] ? "Defaults" : "Repays" }],
    onClick: ({ x, y, inside }) => {
      if (!inside || !Number.isFinite(x) || !Number.isFinite(y)) return;
      incomeSlider.value = nearestState(sol, Math.log1p(x / 100));
      situation.i = incomeSlider.value;
      const k = clamp(Math.round(((y / 100) * 4) / sol.gap), 0, sol.nd - 1 - sol.zero);
      debtSlider.value = k;
      situation.debt = situation.want = sol.d[sol.zero + k];
      showSituation();
    },
  });
}

function drawPrices(i, r) {
  const n = sol.nd;
  let last = sol.zero;
  for (let j = sol.zero; j < n; j++) if (sol.q[i * n + j] > 0) last = j;
  const end = Math.min(n - 1, last + Math.max(4, Math.round((last - sol.zero) * 0.15)));
  const data = [];
  for (let j = sol.zero; j <= end; j++) data.push([annual(sol.d[j]), sol.q[i * n + j] * (1 + sol.params.r) * 100]);
  const marks = !r.def && r.next > 0 ? [{ type: "point", x: annual(r.next), y: r.repayChance * 100, text: "Chosen" }] : [];
  priceChart.update({
    title: "What lenders pay for new debt",
    subtitle: `With income ${incomeText(sol.z[i])}: the chance of repayment that the bond price builds in, q × (1 + r), for each amount borrowed. Lenders charge exactly for the risk of default next quarter.`,
    label: "Line chart of the chance of repayment priced by lenders against the new debt",
    x: { label: "New debt (% of a year's income)", format: (v) => `${fmt.sig(v, 3)}%` },
    y: { label: "Repayment chance priced in (%)", format: (v) => `${fmt.sig(v, 3)}%`, domain: [0, 100] },
    series: [{ name: "Repayment chance priced in", type: "step", data, color: 0 }],
    marks,
  });
}

function showLongRun() {
  const lr = longRun(sol, { T: 200000, seed: 1 });
  sol.long = lr;
  const rows = [
    ["Defaults in the history", `${fmt.int(lr.defaults)}: ${lr.per100 >= 0.1 || lr.defaults === 0 ? fmt.num(lr.per100, 1) : fmt.sig(lr.per100, 2)} per 100 years`],
    ["Share of quarters shut out of the market", pctText(lr.excludedShare, 1)],
    ["Debt while in the market (average)", lr.meanDebt < 0 ? `none: on average it saves ${fmt.num(-lr.meanDebt * 25, 2)}% of a year's income` : `${fmt.num(lr.meanDebt * 25, 2)}% of a year's income`],
    ["Annual spread on new debt (average)", lr.meanSpread > 10 ? "over 1,000 points: a few loans priced near zero dominate the average" : `${fmt.num(lr.meanSpread * 100, 2)} points`],
    ["Defaults with income below trend", lr.shareBelowTrend == null ? "no defaults" : pctText(lr.shareBelowTrend, 0)],
    ["Income at default (average)", lr.meanLogYAtDefault == null ? "no defaults" : incomeText(lr.meanLogYAtDefault)],
    ["Lenders: repayment chance priced in, against repaid", lr.breakEven ? `${pctText(lr.breakEven.priced, 2)} against ${pctText(lr.breakEven.repaid, 2)}` : "no new debt issued"],
  ];
  longBox.replaceChildren(...[el("table", { class: "tbl d79-long" },
    el("caption", { text: "One simulated history of 200,000 quarters from trend income and no debt (seed 1, after 1,000 quarters left out to forget the start)." }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Measure" }), el("th", { scope: "col", class: "num", text: "Value" }))),
    el("tbody", {}, rows.map(([m, v]) => el("tr", {}, el("th", { scope: "row", text: m }), el("td", { class: "num", text: v }))))),
    sol.params.theta === 0 && lr.excludedShare > 0 ? el("p", { class: "small", text: `With no way back into the market the first default${lr.firstDefault ? `, in quarter ${fmt.int(lr.firstDefault)} of the history,` : ""} ends borrowing for good, so the history is spent mostly shut out, and the averages "in the market" cover only the quarters before it.` }) : null,
    el("p", { class: "small muted", text: "One history of many: with Arellano's numbers, seeds 1 to 6 give 3.4 to 3.6 defaults per 100 years. Arellano reports 3 defaults per 100 years and an average spread of 3.58 points for the same parameters, solved her way; her income chain, her debt grid and her computation differ from the tool's, and Hatchondo, Martinez and Sapriza show that such choices move the results." })].filter(Boolean));
}

function showChecks() {
  const b = boundary(sol);
  const inc = monotoneInIncome(sol);
  const pr = pricesFallWithDebt(sol);
  checkBox.textContent = `Checks on this solution: ${sol.ny} income levels (Tauchen's method, three standard deviations either side) and ${sol.nd} debt levels from ${debtText(sol.d[0])} (saving) to ${debtText(sol.d[sol.nd - 1])} of a year's income. `
    + `Largest change in the values at the last iteration: ${sol.change.toExponential(1)}. ${sol.gridShort ? "The grid is too short for these settings (see the warning above). " : ""}`
    + `Default sets ${b.monotone ? "grow with debt at every income" : "do not all grow with debt (a grid effect)"}; they ${inc ? "shrink as income rises at every debt" : "do not all shrink as income rises"}; bond prices ${pr ? "never rise with the amount borrowed" : "rise with debt somewhere (a grid effect)"}.`;
}

/* ---------- the scenario ---------- */
const scenarioChanged = debounce(() => runScenario(), 120);

function scenarioPath() {
  // Two quarters at the chosen income, the recession at its depth, then income returns towards trend at the model's
  // persistence. Every quarter is snapped to the nearest of the model's income levels.
  const i0 = incomeSlider.value;
  const low = Math.log(1 - depthSlider.value / 100);
  const path = [i0, i0];
  for (let t = 0; t < lengthSlider.value; t++) path.push(nearestState(sol, low));
  let z = low;
  while (path.length < 40) { z *= sol.params.rho; path.push(nearestState(sol, z)); }
  return path;
}

function runScenario() {
  if (!sol) return;
  const seed = seedField.value;
  if (!Number.isInteger(seed)) { seedMsg.textContent = "Enter a whole-number seed from 0 to 4,294,967,295."; seedField.input.classList.add("invalid"); return; }
  seedMsg.textContent = "";
  const j0 = sol.zero + debtSlider.value;
  const rec = modeSeg.value === "recession";
  const rows = rec ? simulate(sol, { j0, i0: incomeSlider.value, path: scenarioPath(), seed }) : simulate(sol, { j0, i0: incomeSlider.value, T: yearsSlider.value * 4, seed });
  const spans = [];
  for (let t = 0; t < rows.length; t++) {
    if (rows[t].state === "repay") continue;
    let e = t;
    while (e + 1 < rows.length && rows[e + 1].state === "excluded") e++;
    spans.push({ type: "span", x0: t - 0.5, x1: e + 0.5, opacity: 0.1 });
    t = e;
  }
  const events = [];
  for (let t = 0; t < rows.length; t++) {
    const row = rows[t];
    if (row.state === "default") events.push(`Quarter ${t}: defaults on debt of ${debtText(row.debt)} of a year's income, with income ${incomeText(sol.z[row.i])}.`);
    else if (row.state === "repay" && t > 0 && rows[t - 1].state === "excluded") events.push(`Quarter ${t}: let back into the market, with no debt.`);
  }
  const defaults = rows.filter((r) => r.state === "default").length;
  const lead = rec
    ? `A recession of ${fmt.num(depthSlider.value, 1)}% below trend for ${lengthSlider.value} ${lengthSlider.value === 1 ? "quarter" : "quarters"}, starting in quarter 2 with debt of ${debtText(sol.d[j0])} of a year's income.`
    : `${yearsSlider.value} years of random income shocks (seed ${fmt.int(seed)}), starting with debt of ${debtText(sol.d[j0])} of a year's income and income ${incomeText(sol.z[incomeSlider.value])}.`;
  const shown = events.slice(0, 8);
  pathText.replaceChildren(...[
    el("p", { text: `${lead} ${defaults ? `${defaults === 1 ? "One default" : `${defaults} defaults`}.` : "No default: the government repays throughout."}` }),
    shown.length ? el("ul", {}, shown.map((e) => el("li", { text: e }))) : null,
    events.length > shown.length ? el("p", { class: "muted", text: `And ${events.length - shown.length} more events; the charts show them all.` }) : null,
  ].filter(Boolean));
  const T = rows.length;
  incomeChart.update({
    title: "Income",
    subtitle: "Shaded: quarters in default or shut out of the market.",
    label: "Line chart of income relative to trend in each quarter of the scenario",
    x: { label: "Quarter", format: (v) => fmt.int(v), domain: [0, T - 1] },
    y: { label: "Income (% from trend)", format: (v) => `${fmt.signed(v, 0)}%` },
    series: [{ name: "Income", type: "line", data: rows.map((r) => [r.t, devOf(sol.z[r.i])]), color: 0 }],
    marks: [{ type: "hline", y: 0, text: "Trend" }, ...spans],
  });
  debtChart.update({
    title: "Debt due each quarter",
    subtitle: "Default wipes the debt out; a government let back in starts again from none.",
    label: "Step chart of the debt due in each quarter of the scenario",
    x: { label: "Quarter", format: (v) => fmt.int(v), domain: [0, T - 1] },
    y: { label: "Debt (% of a year's income)", format: (v) => `${fmt.sig(v, 3)}%` },
    series: [{ name: "Debt due", type: "step", data: rows.map((r) => [r.t, annual(r.debt)]), color: 1 }],
    marks: spans,
  });
}

showMode();
describeSettings();
startSolve();
