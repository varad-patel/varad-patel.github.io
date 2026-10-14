// Day 67: Monte Carlo Market and VaR. Interface.
import { $, el, fmt, mount, slider, select, segmented, button, stat, note, chart, debounce, randomSeed, stats } from "../kit/kit.js";
import {
  MAX_HOLDINGS, CONFIDENCES, COUNTS, LIMITS, normCdf, checkCorrelation, nearestCorrelation, readPortfolio, normalMoments,
  normalRisk, lognormalRisk, createSimulation, sampleRisk, lossShare, fanColumn, TAIL_MIN,
} from "./logic.js";

mount();

/* ---------- presets: made-up holdings, labelled as such ---------- */
const EXAMPLES = {
  three: {
    label: "Shares, bonds and gold",
    rows: [["Shares", 60000, 7, 18], ["Bonds", 30000, 3.5, 6], ["Gold", 10000, 4, 15]],
    corr: [[1, 0.1, 0.1], [0.1, 1, 0.3], [0.1, 0.3, 1]], loss: 5000,
  },
  one: { label: "One holding", rows: [["Shares", 100000, 7, 18]], corr: [[1]], loss: 5000 },
  same: { label: "Two that move as one", rows: [["Fund A", 50000, 7, 18], ["Fund B", 50000, 7, 18]], corr: [[1, 1], [1, 1]], loss: 5000 },
  bad: {
    label: "Impossible correlations",
    rows: [["Asset A", 40000, 6, 20], ["Asset B", 30000, 6, 20], ["Asset C", 30000, 6, 20]],
    corr: [[1, 0.9, -0.5], [0.9, 1, 0.9], [-0.5, 0.9, 1]], loss: 5000,
  },
};
const CURRENCIES = [{ value: "$", label: "$ (dollars)" }, { value: "₹", label: "₹ (rupees)" }, { value: "£", label: "£ (pounds)" }, { value: "€", label: "€ (euros)" }];
let cur = "$";
const money = (v) => { const t = fmt.int(Math.abs(v)); return v < 0 && t !== "0" ? `-${cur}${t}` : `${cur}${t}`; };
const pct = (p) => (p > 0 && p < 0.001 ? "under 0.1%" : fmt.pct(p, 1));

/* ---------- holdings editor ---------- */
let nextId = 1;
const rows = []; // { id, el, name, amount, mu, sigma, legend, msg }
const corr = new Map(); // "idA|idB" -> number typed (the input element holds the text)
const corrKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const rowsBox = el("div", { class: "d67-rows" });
const corrBox = el("div", { class: "d67-corr" });
const corrMsg = el("div", { id: "d67-corr-msg", "aria-live": "polite" });
const addBtn = button("Add a holding", () => { addRow(["", 10000, 5, 15]); rebuildCorr(); rows.at(-1).name.focus(); changed(); });
const holdingsMsg = el("div", { "aria-live": "polite" });

function numberBox(id, label, value, { min, max, step = "any" }, describedBy) {
  const input = el("input", { type: "number", id, min, max, step, value, inputmode: min >= 0 ? "decimal" : null, "aria-describedby": describedBy });
  input.addEventListener("input", changed);
  return { input, field: el("div", { class: "field" }, el("label", { for: id, text: label }), input) };
}

function addRow([name, amount, mu, sigma]) {
  const id = nextId++;
  const msgId = `d67-msg-${id}`; // each box in the row points at the row's message
  const nameInput = el("input", { type: "text", id: `d67-name-${id}`, value: name, maxlength: 60, autocomplete: "off", spellcheck: "false", "aria-describedby": msgId });
  const legend = el("legend", {});
  const a = numberBox(`d67-amount-${id}`, `Amount (${cur})`, amount, LIMITS.amount, msgId);
  const m = numberBox(`d67-mu-${id}`, "Expected return (% a year)", mu, LIMITS.mu, msgId);
  const s = numberBox(`d67-sigma-${id}`, "Volatility (% a year)", sigma, LIMITS.sigma, msgId);
  const msg = el("div", { class: "d67-msg", id: msgId, "aria-live": "polite" });
  const remove = button("Remove", () => removeRow(id), { small: true });
  const row = { id, name: nameInput, amount: a.input, mu: m.input, sigma: s.input, legend, msg, remove };
  row.el = el("fieldset", { class: "d67-row" }, legend,
    el("div", { class: "d67-grid" },
      el("div", { class: "field d67-name" }, el("label", { for: nameInput.id, text: "Name" }), nameInput), a.field, m.field, s.field,
      el("div", { class: "d67-remove" }, remove), msg));
  a.field.querySelector("label").classList.add("d67-amount-label");
  nameInput.addEventListener("input", () => { labelRows(); changed(); });
  rows.push(row);
  rowsBox.append(row.el);
  labelRows();
}

function removeRow(id) {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0 || rows.length <= 1) return;
  rows[i].el.remove();
  rows.splice(i, 1);
  rebuildCorr();
  labelRows();
  // Focus moves to the holding that took this one's place, or to "Add a holding".
  (rows[i]?.name || addBtn).focus();
  changed();
}

const nameOf = (r, i) => r.name.value.trim() || `Holding ${i + 1}`;
function labelRows() {
  rows.forEach((r, i) => {
    r.legend.textContent = `Holding ${i + 1}${r.name.value.trim() ? `: ${r.name.value.trim()}` : ""}`;
    r.remove.textContent = "Remove";
    r.remove.setAttribute("aria-label", `Remove holding ${i + 1}, ${nameOf(r, i)}`);
    r.remove.disabled = rows.length <= 1;
  });
  addBtn.disabled = rows.length >= MAX_HOLDINGS;
  for (const lab of corrBox.querySelectorAll("label[data-pair]")) {
    const [a, b] = lab.dataset.pair.split("|").map(Number);
    const ia = rows.findIndex((r) => r.id === a), ib = rows.findIndex((r) => r.id === b);
    if (ia >= 0 && ib >= 0) lab.textContent = `${nameOf(rows[ia], ia)} with ${nameOf(rows[ib], ib)}`;
  }
}

function rebuildCorr() {
  // Keep what was typed for pairs that still exist.
  for (const input of corrBox.querySelectorAll("input")) corr.set(input.dataset.pair, input.value);
  const items = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const key = corrKey(rows[i].id, rows[j].id);
    const id = `d67-corr-${key.replace("|", "-")}`;
    // step "any", or the browser would mark a valid 0.33 (or a fixed -0.26) as invalid; the arrow keys move 0.05.
    const input = el("input", { type: "number", id, min: -1, max: 1, step: "any", value: corr.get(key) ?? "0", "data-pair": key, "aria-describedby": "d67-corr-msg" });
    input.addEventListener("input", changed);
    input.addEventListener("keydown", (e) => {
      const move = { ArrowUp: 0.05, ArrowDown: -0.05 }[e.key];
      const v = Number(input.value);
      if (!move || input.value.trim() === "" || !Number.isFinite(v) || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      input.value = String(Math.round(Math.min(1, Math.max(-1, v + move)) * 100) / 100);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    items.push(el("div", { class: "field" }, el("label", { for: id, "data-pair": key }), input));
  }
  corrBox.replaceChildren(...(items.length ? items : [el("p", { class: "small muted", text: "With one holding there are no correlations to set." })]));
  labelRows();
}

function loadExample(key) {
  const ex = EXAMPLES[key];
  rows.splice(0).forEach((r) => r.el.remove());
  corr.clear();
  corrBox.replaceChildren();
  ex.rows.forEach((r) => addRow(r));
  ex.rows.forEach((_, i) => ex.rows.forEach((__, j) => { if (i < j) corr.set(corrKey(rows[i].id, rows[j].id), String(ex.corr[i][j])); }));
  rebuildCorr();
  lossBox.value = String(ex.loss);
  changed();
}

/* ---------- settings ---------- */
const modelSeg = segmented({
  label: "Return model", value: "normal",
  options: [{ value: "normal", label: "Normal returns" }, { value: "lognormal", label: "Lognormal prices" }],
  hint: "Normal: each holding gains or loses an amount that is normally distributed, so a closed form exists. Lognormal: each moves by a percentage, as prices do, and cannot fall below zero.",
  onChange: () => changed(),
});
const horizon = slider({ label: "Horizon", min: 1, max: LIMITS.horizon.max, step: 1, value: 10, format: (d) => `${d} trading ${d === 1 ? "day" : "days"}`, hint: "252 trading days make a year.", onInput: () => changed() });
const confSel = select({ label: "Confidence", value: "0.99", options: CONFIDENCES.map((c) => ({ value: String(c), label: fmt.pct(c, c * 1000 % 10 ? 1 : 0) })), onChange: () => changed() });
const countSel = select({ label: "Futures to simulate", value: "10000", options: COUNTS.map((n) => ({ value: String(n), label: fmt.int(n) })), onChange: () => changed() });
const seedInput = el("input", { type: "number", id: "d67-seed", min: 0, max: LIMITS.seed.max, step: 1, value: 1, inputmode: "numeric", "aria-describedby": "d67-seed-msg" });
seedInput.addEventListener("input", () => changed());
const seedMsg = el("div", { class: "d67-msg", id: "d67-seed-msg", "aria-live": "polite" });
const seedField = el("div", { class: "field" }, el("label", { for: "d67-seed", text: "Seed" }), seedInput,
  el("div", { class: "row" }, button("New seed", () => { seedInput.value = String(randomSeed()); changed(true); }, { small: true })),
  el("div", { class: "hint", text: "The same holdings, settings and seed always give the same futures." }), seedMsg);
const lossBox = el("input", { type: "number", id: "d67-loss", min: 0, max: LIMITS.amount.max, step: "any", value: 5000, inputmode: "decimal", "aria-describedby": "d67-loss-msg" });
lossBox.addEventListener("input", () => changed());
const lossMsg = el("div", { class: "d67-msg", id: "d67-loss-msg", "aria-live": "polite" });
const lossLabel = el("label", { for: "d67-loss", text: `Loss to watch (${cur})` });
const lossField = el("div", { class: "field" }, lossLabel, lossBox, el("div", { class: "hint", text: "The tool gives the chance of losing at least this much over the horizon." }), lossMsg);
const curSel = select({ label: "Currency symbol", value: "$", options: CURRENCIES, hint: "Changes only the symbol shown.", onChange: (v) => { cur = v; for (const lab of document.querySelectorAll(".d67-amount-label")) lab.textContent = `Amount (${cur})`; lossLabel.textContent = `Loss to watch (${cur})`; show(); } });

// The examples change only the holdings, their correlations and the loss to watch; this puts every setting back.
function resetAll() {
  modelSeg.value = "normal";
  horizon.value = 10;
  confSel.value = "0.99";
  countSel.value = "10000";
  seedInput.value = "1";
  curSel.value = "$";
  cur = "$";
  for (const lab of document.querySelectorAll(".d67-amount-label")) lab.textContent = `Amount (${cur})`;
  lossLabel.textContent = `Loss to watch (${cur})`;
  loadExample("three");
}

/* ---------- outputs ---------- */
// Not a live region: it changes with every slice of work. The finished result is announced by the status line.
const progress = el("p", { class: "small", tabindex: "-1" }); // takes the focus when the Stop button goes
// A live region is rewritten only when its words change, so a screen reader is not told the same thing twice.
function say(node, text) { if (node.textContent !== text) node.textContent = text; }
// The same for a message block: an alert is replaced only when its words change. A button inside keeps its focus,
// and its action reads the current inputs.
function swap(box, node) { if (box.textContent !== node.textContent) box.replaceChildren(node); }
const stopBtn = button("Stop", () => stop(), { small: true });
stopBtn.hidden = true;
// Hiding a focused button would drop the keyboard focus to the page, so it moves to the progress line first.
const hideStop = () => { if (document.activeElement === stopBtn) progress.focus(); stopBtn.hidden = true; };
const sVar = stat("Value at risk");
const sEs = stat("Expected shortfall");
const sLoss = stat("Chance of the loss to watch");
const compare = el("div");
const warnBox = el("div");
const fanBox = el("div", { id: "d67-fan" }), histBox = el("div", { id: "d67-hist" });
const repro = el("p", { class: "small muted" });
const status = el("p", { class: "sr-only", role: "status" });
const paused = el("div");

const portfolio = el("div", { class: "panel d67-portfolio" },
  el("h2", { text: "Your holdings" }),
  note("", "Every holding, return and volatility below is a made-up example of a plausible size, not an estimate or a forecast for any real asset. Replace them with your own assumptions."),
  el("div", { class: "row d67-examples", role: "group", "aria-label": "Examples" },
    el("span", { class: "small muted", text: "Examples:" }),
    Object.entries(EXAMPLES).map(([key, ex]) => button(ex.label, () => loadExample(key), { small: true })),
    button("Back to the opening settings", () => resetAll(), { small: true })),
  rowsBox, el("div", { class: "row" }, addBtn, el("span", { class: "small muted", text: `Up to ${MAX_HOLDINGS} holdings.` })), holdingsMsg,
  el("h3", { text: "Correlations" }),
  el("p", { class: "small muted", text: "From -1 (always move opposite ways) to 1 (always move together), for the holdings' random parts. Together they must form a valid correlation matrix; the tool checks." }),
  corrBox, corrMsg);

const controls = el("div", { class: "controls" }, modelSeg.el, horizon.el, confSel.el, countSel.el, seedField, lossField, curSel.el);
const out = el("div", { class: "out" },
  el("div", { class: "row" }, progress, stopBtn), paused,
  el("div", { class: "stats", id: "d67-results" }, sVar.el, sEs.el, sLoss.el), status, compare, warnBox, fanBox, histBox, repro,
  note("", "An illustration of the method, not investment advice. The answers are only as good as the assumptions typed above, and real returns have fatter tails than either model."));

// On a phone the holdings and settings fill several screens, so the results are a jump away.
const jump = el("nav", { class: "row d67-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d67-results", "value at risk"], ["#d67-fan", "simulated futures"], ["#d67-hist", "gains and losses"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, portfolio, el("div", { class: "tool-grid" }, controls, out));
const fanChart = chart(fanBox, { series: [], height: 320 });
const histChart = chart(histBox, { series: [], height: 280 });

/* ---------- validation ---------- */
function readAll() {
  const typed = rows.map((r) => ({ name: r.name.value, amount: r.amount.value.trim() === "" ? NaN : Number(r.amount.value), mu: r.mu.value.trim() === "" ? NaN : Number(r.mu.value), sigma: r.sigma.value.trim() === "" ? NaN : Number(r.sigma.value) }));
  const n = rows.length;
  const R = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    if (i === j) return 1;
    const input = corrBox.querySelector(`input[data-pair="${corrKey(rows[i].id, rows[j].id)}"]`);
    return !input || input.value.trim() === "" ? NaN : Number(input.value);
  }));
  return readPortfolio(typed, R);
}

function markErrors(p) {
  rows.forEach((r, i) => {
    const mine = p.errors.filter((e) => e.index === i);
    say(r.msg, mine.map((e) => e.message).join(" "));
    for (const key of ["name", "amount", "mu", "sigma"]) {
      const bad = mine.some((e) => e.where === key);
      r[key].classList.toggle("invalid", bad);
      if (bad) r[key].setAttribute("aria-invalid", "true"); else r[key].removeAttribute("aria-invalid");
    }
  });
  const general = p.errors.filter((e) => e.where === "holdings").map((e) => e.message).join(" ");
  if (holdingsMsg.textContent !== general) holdingsMsg.replaceChildren(...(general ? [note("bad", general)] : []));
  for (const input of corrBox.querySelectorAll("input")) {
    const [a, b] = input.dataset.pair.split("|").map(Number);
    const i = rows.findIndex((r) => r.id === a), j = rows.findIndex((r) => r.id === b);
    const bad = p.errors.some((e) => e.where === "corr" && ((e.i === i && e.j === j) || (e.i === j && e.j === i)));
    input.classList.toggle("invalid", bad);
    if (bad) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  }
}

function describeFix(c, holdings) {
  const name = (i) => holdings[i].name;
  const two = (x) => fmt.num(x, 2);
  const lines = c.fixes.map((f) => (f.high - f.low < 0.005
    ? `${name(f.i)} with ${name(f.j)}: only ${two(f.high)} would do (it is ${two(f.current)})`
    : `${name(f.i)} with ${name(f.j)}: anything from ${two(Math.ceil(f.low * 100 - 1e-6) / 100)} to ${two(Math.floor(f.high * 100 + 1e-6) / 100)} (it is ${two(f.current)})`));
  return lines;
}

/* ---------- the simulation, in slices ---------- */
let job = 0, sim = null, ctx = null, result = null;

function stop() {
  if (!sim || sim.done >= sim.n) return;
  job++;
  finish(true);
}

const changed = debounce(() => start(), 350);

function start() {
  job++;
  const id = job;
  const p = readAll();
  markErrors(p);
  const seed = Number(seedInput.value);
  const seedOk = seedInput.value.trim() !== "" && Number.isInteger(seed) && seed >= 0 && seed <= LIMITS.seed.max;
  say(seedMsg, seedOk ? "" : `Enter a whole number from 0 to ${fmt.int(LIMITS.seed.max)}.`);
  const mark = (box, ok) => { box.classList.toggle("invalid", !ok); if (ok) box.removeAttribute("aria-invalid"); else box.setAttribute("aria-invalid", "true"); };
  mark(seedInput, seedOk);
  const loss = Number(lossBox.value);
  const lossOk = lossBox.value.trim() !== "" && Number.isFinite(loss) && loss >= 0 && loss <= LIMITS.amount.max;
  say(lossMsg, lossOk ? "" : `Enter an amount from 0 to ${fmt.int(LIMITS.amount.max)}.`);
  mark(lossBox, lossOk);

  let check = { ok: true };
  if (p.ok) check = checkCorrelation(p.R);
  if (p.ok && !check.ok) {
    const lines = describeFix(check, p.holdings);
    swap(corrMsg, note("bad",
      el("p", { text: `These correlations cannot all hold at once: no set of holdings can be related this way (the matrix's smallest eigenvalue is ${fmt.num(check.minEigen, 3)}, and it must not be below zero).` }),
      lines.length
        ? [el("p", { text: "Changing any one of these alone would fix it, with the others left as they are:" }), el("ul", {}, lines.map((t) => el("li", { text: t })))]
        : el("p", { text: "No single correlation can be changed to fix it: several are too negative together. Bring two or more of them closer to zero." }),
      el("div", { class: "row" }, button("Use the nearest valid correlations", () => fixCorrelations(readAll().R), { small: true }))));
  } else if (!p.ok) {
    // A correlation box that is empty or out of range says so in words, not only with a red border.
    const bad = p.errors.filter((e) => e.where === "corr").map((e) => e.message).join(" ");
    if (bad) swap(corrMsg, note("bad", bad)); else corrMsg.replaceChildren();
  }
  else if (corrMsg.textContent !== "These correlations form a valid correlation matrix.") corrMsg.replaceChildren(el("p", { class: "small muted", text: "These correlations form a valid correlation matrix." }));

  if (!p.ok || !check.ok || !seedOk || !lossOk) {
    paused.replaceChildren(note("warn", !p.ok ? "Fix the boxes marked in red above; the results below are from the last settings that worked." : !check.ok ? "The simulation waits until the correlations are fixed; the results below are from the last settings that worked." : "Fix the box marked in red; the results below are from the last settings that worked."));
    progress.textContent = "";
    hideStop();
    return;
  }
  paused.replaceChildren();
  ctx = { holdings: p.holdings, R: p.R, days: horizon.value, n: Number(countSel.value), seed, model: modelSeg.value, conf: Number(confSel.value), loss };
  sim = createSimulation(ctx);
  stopBtn.hidden = false;
  const slice = () => {
    if (id !== job) return;
    const t0 = performance.now();
    while (sim.done < sim.n && performance.now() - t0 < 25) sim.run(500);
    if (sim.done < sim.n) {
      progress.textContent = `Simulating futures: ${fmt.int(sim.done)} of ${fmt.int(sim.n)}.`;
      setTimeout(slice, 0);
      return;
    }
    finish(false);
  };
  progress.textContent = `Simulating futures: 0 of ${fmt.int(sim.n)}.`;
  setTimeout(slice, 0);
}

function fixCorrelations(R) {
  const X = nearestCorrelation(R, { decimals: 2 });
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const input = corrBox.querySelector(`input[data-pair="${corrKey(rows[i].id, rows[j].id)}"]`);
    if (input) input.value = fmt.num(X[i][j], 2);
  }
  corrBox.querySelector("input")?.focus();
  start();
}

function finish(stopped) {
  const id = job;
  hideStop();
  const count = sim.done;
  if (count < 2) { progress.textContent = "Stopped before enough futures were simulated. Change a setting to start again."; return; }
  const gains = sim.gain.subarray(0, count);
  const risk = sampleRisk(gains, ctx.conf);
  const share = lossShare(gains, ctx.loss);
  let closed = null;
  if (ctx.model === "normal") closed = { ...normalRisk(normalMoments(ctx.holdings, ctx.R, ctx.days), ctx.conf, ctx.loss), what: "normal returns" };
  else if (ctx.holdings.filter((h) => h.amount > 0).length === 1) closed = { ...lognormalRisk(ctx.holdings.find((h) => h.amount > 0), ctx.days, ctx.conf, ctx.loss), what: "one lognormal holding" };
  // The fan: one time column per slice, so sorting 100,000 values 26 times never freezes the page.
  const columns = [];
  progress.textContent = stopped ? `Stopped at ${fmt.int(count)} of ${fmt.int(sim.n)} futures. Summarising.` : "Summarising the futures.";
  const step = () => {
    if (id !== job) return;
    columns.push(fanColumn(sim, columns.length, count));
    if (columns.length < sim.times.length) { setTimeout(step, 0); return; }
    result = { ctx, sim, count, gains, risk, share, closed, columns, stopped };
    progress.textContent = stopped ? `Stopped at ${fmt.int(count)} of ${fmt.int(sim.n)} futures; the results use those.` : `${fmt.int(count)} futures simulated.`;
    show();
  };
  setTimeout(step, 0);
}

/* ---------- drawing the results ---------- */
function show() {
  if (!result) return;
  const { ctx: c, sim: s, count, gains, risk, share, closed, columns, stopped } = result;
  const confText = fmt.pct(c.conf, c.conf * 1000 % 10 ? 1 : 0);
  const days = `${c.days} trading ${c.days === 1 ? "day" : "days"}`;
  const t = risk.tailCount;
  const few = (need) => `${t ? `Only ${fmt.int(t)} ${t === 1 ? "future lies" : "futures lie"}` : "No future lies"} beyond the VaR; an error estimate needs ${need}: simulate more.`;
  sVar.set(money(risk.var), `${confText}, ${days}. ${risk.varLow === undefined ? few(TAIL_MIN.var) : `Monte Carlo 95% interval ${money(risk.varLow)} to ${money(risk.varHigh)}`}`);
  sEs.set(money(risk.es), `Average loss in the worst ${fmt.pct(1 - c.conf, (1 - c.conf) * 1000 % 10 ? 1 : 0)} of futures. ${risk.esLow === undefined ? few(TAIL_MIN.es) : `Approximate Monte Carlo 95% interval ${money(risk.esLow)} to ${money(risk.esHigh)}`}`);
  sLoss.set(pct(share.share), `of losing ${money(c.loss)} or more: ${fmt.int(share.count)} of ${fmt.int(count)} futures, interval ${pct(share.low)} to ${pct(share.high)}`);

  const parts = [];
  if (risk.var < 0) parts.push(el("p", { text: `The VaR is below zero: at this confidence even the bad outcome is a gain of ${money(-risk.var)}, because the expected gain over the horizon outweighs the risk.` }));
  if (closed) {
    // Inside an interval, allowing for rounding: with no volatility every future is the same and the interval has no width.
    const tol = 1e-9 * Math.max(1, s.start);
    const inside = (v, lo, hi, t = tol) => (lo === undefined ? null : v >= lo - t && v <= hi + t);
    // true inside, false outside, null when the simulation has too few futures in the tail for an interval.
    const checks = [["VaR", inside(closed.var, risk.varLow, risk.varHigh)], ["expected shortfall", inside(closed.es, risk.esLow, risk.esHigh)],
      ["the chance of the loss", inside(closed.lossProb, share.low, share.high, 1e-12)]];
    const join = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
    const cap = (s) => `${s[0].toUpperCase()}${s.slice(1)}`;
    const missed = checks.filter(([, v]) => v === false).map(([w]) => w);
    const hit = checks.filter(([, v]) => v === true).map(([w]) => w);
    const skipped = checks.filter(([, v]) => v === null).map(([w]) => w);
    const flat = risk.varHigh !== undefined && risk.varHigh - risk.varLow <= tol;
    const verdict = [
      flat && !missed.length ? "With no volatility every future is the same, and the simulation matches the closed form exactly."
        : hit.length === 3 ? "All three closed-form values lie inside the simulation's 95% intervals."
        : hit.length ? `${cap(join(hit))} ${hit.length === 1 ? "lies" : "lie"} inside the simulation's 95% ${hit.length === 1 ? "interval" : "intervals"}.` : "",
      missed.length ? `${cap(join(missed))} ${missed.length === 1 ? "lies" : "lie"} outside the simulation's 95% ${missed.length === 1 ? "interval" : "intervals"}. Each interval misses the true value in about one run in twenty by chance; try another seed or more futures.` : "",
      skipped.length ? `There are too few futures beyond the VaR to give ${join(skipped)} an interval to compare with.` : "",
    ].filter(Boolean).join(" ");
    parts.push(el("p", {}, el("strong", { text: `Closed form for ${closed.what}: ` }), `VaR ${money(closed.var)}, expected shortfall ${money(closed.es)}, chance of losing ${money(c.loss)} or more ${pct(closed.lossProb)}. ${verdict}`));
  } else parts.push(el("p", { text: "There is no closed form for several lognormal holdings together (a sum of lognormal values has no neat distribution), which is when simulation earns its keep. Switch to normal returns, or keep one holding, to compare with one." }));
  compare.replaceChildren(el("div", { class: "panel d67-compare" }, parts));

  warnBox.replaceChildren(...(c.model === "normal" && s.negative > 0
    ? [note("warn", `In ${fmt.int(s.negative)} of the ${fmt.int(s.done)} futures (${pct(s.negative / s.done)}) a holding ended worth less than nothing, which normal returns allow and a real holding bought outright cannot do. The lognormal model rules it out.`)]
    : []));

  // Fan chart.
  const paths = Math.min(20, count);
  const pathSeries = Array.from({ length: paths }, (_, f) => ({ name: "", type: "line", color: 1, width: 1, opacity: 0.35, legend: false, hover: false, data: s.times.map((t, k) => [t, s.values[f * (s.steps + 1) + k]]) }));
  fanChart.update({
    title: `${fmt.int(count)} simulated futures of the portfolio`,
    subtitle: `Value over ${days}. The bands hold the middle 50% and 90% of futures at each point; the thin orange lines are ${paths} single futures.`,
    label: `Fan chart of simulated portfolio values over ${days}`,
    x: { label: "Trading days from now", format: (v) => fmt.int(v) },
    y: { label: `Portfolio value (${cur})`, format: (v) => money(v) },
    series: [
      { name: "5% to 95% of futures", type: "range", data: columns.map((col) => [col.t, col.q[0], col.q[4]]), color: "#8a94a3", opacity: 0.22 },
      { name: "25% to 75%", type: "range", data: columns.map((col) => [col.t, col.q[1], col.q[3]]), color: 0, opacity: 0.25 },
      ...pathSeries,
      { name: "Median", type: "line", data: columns.map((col) => [col.t, col.q[2]]), color: 0, width: 2.5 },
    ],
    marks: [{ type: "hline", y: s.start, text: `Today ${money(s.start)}` }],
  });

  // Histogram of the gain at the horizon, with the closed form where there is one.
  const lo = stats.min(gains), hi = stats.max(gains);
  const bins = hi > lo ? stats.histogram(gains, { bins: 50, min: lo, max: hi }) : [{ x0: lo - 1, x1: lo + 1, count: gains.length }];
  const series = [{ name: "Simulated futures", type: "hist", data: bins.map((b) => [b.x0, b.x1, (b.count / count) * 100]), color: 0, opacity: 0.75 }];
  if (closed && c.model === "normal") {
    const m = normalMoments(c.holdings, c.R, c.days);
    if (m.sd > 0) {
      const at = (x) => normCdf((x - m.mean) / m.sd);
      series.push({ name: "Closed form", type: "line", color: "#16233b", width: 1.6, data: bins.map((b) => [(b.x0 + b.x1) / 2, (at(b.x1) - at(b.x0)) * 100]) });
    }
  }
  histChart.update({
    title: `Gain or loss over ${days}`,
    subtitle: `Share of futures in each band. Losses are to the left of zero; the dashed lines mark the ${confText} VaR and expected shortfall as losses.`,
    label: `Histogram of simulated gains over ${days}, with the value at risk and expected shortfall marked`,
    x: { label: `Gain (${cur})`, format: (v) => money(v) },
    y: { label: "Share of futures (%)", format: (v) => `${fmt.sig(v, 3)}%`, zero: true },
    series,
    marks: [{ type: "vline", x: -risk.var, text: "VaR" }, { type: "vline", x: -risk.es, text: "ES" }, { type: "vline", x: 0 }],
  });

  repro.textContent = `Seed ${fmt.int(c.seed)}, ${fmt.int(count)} futures${stopped ? ` (stopped early, of ${fmt.int(s.n)})` : ""}, ${c.model === "normal" ? "normal returns" : "lognormal prices"}, ${s.steps} time steps. The same holdings, settings and seed give the same futures in the same order${stopped ? `, so a full run starts with these ${fmt.int(count)}` : ", and so the same results"}.`;
  say(status, `${confText} value at risk over ${days}: ${money(risk.var)}. Expected shortfall ${money(risk.es)}. Chance of losing ${money(c.loss)} or more: ${pct(share.share)}.${closed ? ` Closed form: VaR ${money(closed.var)}, expected shortfall ${money(closed.es)}.` : ""}`);
}

loadExample("three");
