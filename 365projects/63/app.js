// Day 63: Momentum versus Mean Reversion. Interface.
import { $, el, fmt, mount, rng, slider, select, checkbox, numberField, button, stat, note, chart, debounce } from "../kit/kit.js";
import { ASSETS } from "../data/assets.js";
import {
  RISKY, RULES, ruleOf, T, WARMUP, MAX_LOOKBACK, monthAt, monthLabel, indexOfYear, prepare, backtest, sharpe, buyAndHold,
  summary, grid, describe, variantKey, evaluateRule, overfitting, shuffled, shuffleVerdict, expectedMaxSharpe,
} from "./logic.js";

mount();

const SEED = 63, RESHUFFLES = 20;
const ANN = Math.sqrt(12);
const YEARS = Array.from({ length: 16 }, (_, i) => 2005 + i); // the held-out test may start in January of these years
const DEFAULT = { ids: RISKY.map((a) => a.id), rule: "tsmom", lookback: 12, skip: 0, k: 3, from: 2013, cost: 0.1 };
const state = { ...DEFAULT, ids: [...DEFAULT.ids] };
const tries = new Set();

const pct = (x, d = 1) => fmt.pct(x, d);
const costText = () => `${+state.cost.toFixed(4)}%`; // the cost in use, not rounded to fewer places than were typed
const sr = (x) => fmt.num(x, 2);
const span = (a, b) => `${monthLabel(a)} to ${monthLabel(b)}`;
const months = (n) => `${fmt.int(n)} ${n === 1 ? "month" : "months"}`;

/* ---------- controls ---------- */
const boxes = new Map();
const assetGroup = (title, group) => el("div", { class: "mm-group" },
  el("p", { class: "mm-sub", text: title }),
  RISKY.filter((a) => a.group === group).map((a) => {
    const box = checkbox({ label: a.short, checked: state.ids.includes(a.id), onChange: () => readAssets() });
    box.el.title = a.detail;
    boxes.set(a.id, box);
    return box.el;
  }));
const presets = el("div", { class: "row mm-presets" },
  button("All ten", () => setAssets(RISKY.map((a) => a.id)), { small: true }),
  button("Treasuries", () => setAssets(RISKY.filter((a) => a.group === "treasury").map((a) => a.id)), { small: true }),
  button("Currencies", () => setAssets(RISKY.filter((a) => a.group === "deposit").map((a) => a.id)), { small: true }));
const assetMsg = el("div", { role: "status" });
const assetField = el("div", { class: "field", role: "group", "aria-label": "Assets" },
  el("div", { class: "lab" }, el("span", { text: "Assets" })),
  assetGroup("US Treasuries", "treasury"), assetGroup("Cash in another currency", "deposit"), presets, assetMsg);

const ruleSelect = select({
  label: "Rule", value: state.rule,
  options: RULES.map((r) => ({ value: r.id, label: r.label })),
  onChange: (v) => { state.rule = v; syncRule(); update(); },
});
const ruleHint = el("div", { class: "hint" });
ruleSelect.el.append(ruleHint);
const lookSlider = slider({
  label: "Look-back", min: 1, max: MAX_LOOKBACK, step: 1, value: state.lookback,
  format: (v) => `${v} ${v === 1 ? "month" : "months"}`,
  hint: "How many past months the rule compounds before it decides.",
  onInput: (v) => { state.lookback = v; update(); },
});
const skipBox = checkbox({ label: "Skip the latest month", checked: Boolean(state.skip), onChange: (on) => { state.skip = on ? 1 : 0; update(); } });
const kSlider = slider({
  label: "Assets held", min: 1, max: Math.max(2, state.ids.length - 1), step: 1, value: state.k,
  format: (v) => `${v}`,
  hint: "Cross-sectional rules hold this many of the chosen assets, in equal parts.",
  onInput: (v) => { state.k = v; update(); },
});
const fromSelect = select({
  label: "Held-out test starts", value: state.from,
  options: YEARS.map((y) => ({ value: y, label: `January ${y}` })),
  hint: "Months before this train the rules; months from it on are only used to score them.",
  onChange: (v) => { state.from = Number(v); update(); },
});
const costField = numberField({
  label: "Trading cost, % of the amount traded", min: 0, max: 2, step: 0.01, value: state.cost,
  hint: "Charged on every purchase and sale. 0.1% is 10 basis points.",
  onInput: debounce((v) => { state.cost = v; update(); }, 250),
});
const costMsg = el("div");
costField.input.addEventListener("input", () => {
  costMsg.replaceChildren(Number.isNaN(costField.value) ? note("bad", `Enter a trading cost from 0 to 2 (per cent of the amount traded), for example 0.1. Until then the results use the last valid cost, ${costText()}.`) : "");
});
costField.el.append(costMsg);
const resetBtn = button("Back to the opening settings", () => { Object.assign(state, DEFAULT, { ids: [...DEFAULT.ids] }); syncControls(); update(); resetBtn.focus(); }, { small: true });
const about = el("div", { class: "hint mm-about" },
  `Monthly returns in US dollars, ${monthLabel(0)} to ${monthLabel(T - 1)}, nominal, before tax. The Treasuries are bonds kept at a constant maturity, modelled from Federal Reserve yields, not a fund; the currencies are cash deposits earning their central bank's policy rate, from Federal Reserve exchange rates and BIS rates. Each series is described under "How it works" below.`);

const controls = el("div", { class: "controls" }, assetField, ruleSelect.el, lookSlider.el,
  el("div", { class: "field" }, skipBox.el, el("div", { class: "hint", text: "Leaves out the month just ended, as many momentum studies do." })),
  kSlider.el, fromSelect.el, costField.el, resetBtn, about);

/* ---------- outputs ---------- */
const sSharpe = stat("Held-out Sharpe ratio");
const sReturn = stat("Held-out return a year");
const sFall = stat("Held-out worst fall");
const sTrade = stat("Traded a year");
const status = el("p", { class: "sr-only", role: "status" });
const verdict = el("div");
const growthBox = el("div");
const tableBox = el("div", { class: "mm-tbl" });
const advice = note("", "An illustration of how rules are tested on past data, not investment advice. Nothing here says what anyone should buy, sell or hold.");

const luckHead = el("h2", { text: "How much of this could be luck?" });
const progress = el("p", { class: "small muted" });
const luck = el("div", { class: "mm-luck" });
const luckStatus = el("p", { class: "sr-only", role: "status" });
const scatterBox = el("div");
const winnerBtn = button("Show the training winner's own record", () => useWinner(), { small: true });
winnerBtn.disabled = true;
const triesText = el("p", { class: "small" });
const triesReset = button("Start the count again", () => { tries.clear(); tries.add(currentKey()); showTries(); triesReset.focus(); }, { small: true });

const jump = el("nav", { class: "row small jump", "aria-label": "Parts of this tool" },
  el("span", { class: "muted", text: "Jump to:" }), el("a", { href: "#mm-results", text: "Held-out results" }), el("a", { href: "#mm-luck", text: "How much is luck" }));
const out = el("div", { class: "out" },
  el("div", { class: "stats", id: "mm-results" }, sSharpe.el, sReturn.el, sFall.el, sTrade.el), status, verdict, growthBox, tableBox, advice,
  el("div", { class: "panel mm-stack", id: "mm-luck" }, luckHead, progress, luck, luckStatus, scatterBox, el("div", { class: "row" }, winnerBtn),
    el("h3", { text: "Your own search" }), triesText, el("div", { class: "row" }, triesReset)));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));

const xOf = (i) => { const d = monthAt(i); return d.year + d.month / 12; };
const xLabel = (v) => { const k = Math.round(v * 12); return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][((k % 12) + 12) % 12]} ${Math.floor(k / 12)}`; };
const growthChart = chart(growthBox, { series: [], height: 320 });
const scatter = chart(scatterBox, { series: [], height: 320 });

/* ---------- control helpers ---------- */
function setAssets(ids) {
  state.ids = ids;
  for (const [id, box] of boxes) box.checked = ids.includes(id);
  syncRule();
  update();
}
function readAssets() {
  state.ids = RISKY.map((a) => a.id).filter((id) => boxes.get(id).checked);
  syncRule();
  update();
}
function syncRule() {
  const rule = ruleOf(state.rule);
  ruleHint.textContent = `${rule.label}: ${rule.short}. ` + (rule.kind === "ts"
    ? "Each chosen asset has an equal slot, filled with the asset or with Treasury bills."
    : "Always fully invested in the chosen assets.");
  const n = state.ids.length;
  const cs = rule.kind === "cs";
  kSlider.input.max = Math.max(1, n - 1);
  if (state.k > Math.max(1, n - 1)) state.k = Math.max(1, n - 1);
  kSlider.value = state.k;
  kSlider.input.disabled = !cs || n < 2;
  kSlider.el.classList.toggle("mm-off", !cs || n < 2);
}
function syncControls() {
  for (const [id, box] of boxes) box.checked = state.ids.includes(id);
  ruleSelect.value = state.rule;
  lookSlider.value = state.lookback;
  skipBox.checked = Boolean(state.skip);
  fromSelect.value = state.from;
  costField.value = state.cost;
  costMsg.replaceChildren();
  syncRule();
}
const currentRule = () => ({ rule: state.rule, lookback: state.lookback, skip: state.skip, k: state.k });
const currentKey = () => `${state.ids.join(",")}|${variantKey(currentRule())}|${state.from}|${state.cost}`;

/* ---------- the visitor's rule ---------- */
let gridKey = "", job = 0, lastLuck = null;

function update() {
  const n = state.ids.length;
  const rule = ruleOf(state.rule);
  if (!n) {
    assetMsg.replaceChildren(note("bad", "Choose at least one asset."));
    return blank("Choose at least one asset to test a rule.");
  }
  if (rule.kind === "cs" && n < 2) {
    assetMsg.replaceChildren(note("bad", "Cross-sectional rules rank assets against each other, so they need at least two. Choose another asset or a time-series rule."));
    return blank("A cross-sectional rule needs at least two assets.");
  }
  assetMsg.replaceChildren();
  if (Number.isNaN(costField.value)) return;

  const data = prepare(state.ids);
  const split = indexOfYear(state.from);
  const cost = state.cost / 100;
  const v = currentRule();
  const e = evaluateRule(data, v, split, cost);
  const bhIn = summary(buyAndHold(data, WARMUP, split - 1, cost).net, data.B.subarray(WARMUP, split));
  const bhOutRun = buyAndHold(data, split, T - 1, cost);
  const bhOut = summary(bhOutRun.net, data.B.subarray(split));
  const billsOut = summary(data.B.subarray(split), data.B.subarray(split));
  const o = e.outSample;

  tries.add(currentKey());
  showTries();

  sSharpe.set(sr(o.sharpe), `buy-and-hold ${sr(bhOut.sharpe)}`);
  sReturn.set(pct(o.cagr), `buy-and-hold ${pct(bhOut.cagr)}, bills ${pct(billsOut.cagr)}`);
  sFall.set(pct(o.drawdown), `buy-and-hold ${pct(bhOut.drawdown)}`);
  sTrade.set(`${fmt.num(o.turnover, 1)} times`, `the portfolio's value; ${pct(o.invested, 0)} invested on average`);

  // Verdict, compared as printed so that equal-looking numbers are never called higher or lower.
  const a = sr(o.sharpe), b = sr(bhOut.sharpe);
  const word = a === b ? "the same as" : o.sharpe > bhOut.sharpe ? "higher than" : "lower than";
  const firstOut = split, lastOut = T - 1;
  const both = o.sharpe < 0 && bhOut.sharpe < 0 ? " Both earned less than Treasury bills, which is what a negative Sharpe ratio means." : "";
  // Lo (2002): over T months an annualised Sharpe ratio near zero has a standard error of about sqrt(12 / T).
  const se = Math.sqrt(12 / (T - split)), gap = Math.abs(o.sharpe - bhOut.sharpe);
  const chance = a === b ? "" : gap < se
    ? ` Over ${months(T - split)} a Sharpe ratio is uncertain by about ${sr(se)} either way (one standard error), so a gap of ${sr(gap)} is well within chance.`
    : ` Over ${months(T - split)} a Sharpe ratio is uncertain by about ${sr(se)} either way (one standard error); the gap of ${sr(gap)} is larger than that, though the page makes no formal test of it.`;
  const sentences = [
    `Held out, ${span(firstOut, lastOut)} (${months(T - split)}), the rule's Sharpe ratio was ${a}, ${word} buy-and-hold's ${b}.${both}`,
    `It returned ${pct(o.cagr)} a year after costs against ${pct(bhOut.cagr)} for buying the same assets in equal parts and holding them.${chance}`,
    `In the training months (${span(WARMUP, split - 1)}) the same rule scored ${sr(e.inSample.sharpe)}.`,
  ];
  verdict.replaceChildren(note(a === b || gap < se ? "" : o.sharpe > bhOut.sharpe ? "good" : "warn", el("strong", { text: sentences[0] }), ` ${sentences[1]} ${sentences[2]}`));
  status.textContent = `${describe(v)}. ${sentences.join(" ")}`;

  // Growth of $1 over the held-out months.
  const path = (r) => { let g = 1; return [[xOf(split) - 1 / 12, 1], ...Array.from(r, (x, i) => [xOf(split + i), (g *= 1 + x)])]; };
  growthChart.update({
    title: `Growth of $1 in the held-out months, ${span(firstOut, lastOut)}`,
    subtitle: `After a trading cost of ${costText()} on every trade. Starts from cash, so both pay to buy in.`,
    label: `Line chart of the value of one dollar under the rule, buy-and-hold and Treasury bills from ${monthLabel(firstOut)}`,
    x: { format: xLabel, label: "Month" },
    y: { label: "Value of $1", format: (x) => `$${fmt.num(x, 2)}` },
    series: [
      { name: "The rule", type: "line", data: path(e.netOut), color: 0 },
      { name: "Buy-and-hold", type: "line", data: path(bhOutRun.net), color: 1 },
      { name: "Treasury bills", type: "line", data: path(data.B.subarray(split)), color: "#8a94a3", width: 1.6 },
    ],
  });

  tableBox.replaceChildren(listTable({
    caption: "Training and held-out months compared (returns after the trading cost)",
    columns: [
      { label: "Portfolio", get: (r) => r.name },
      { label: "Return a year", get: (r) => pct(r.s.cagr) },
      { label: "Volatility", get: (r) => pct(r.s.vol) },
      { label: "Sharpe ratio", get: (r) => sr(r.s.sharpe) },
      { label: "Worst fall", get: (r) => pct(r.s.drawdown) },
      { label: "Traded a year", get: (r) => (r.bh ? "once, to buy in" : `${fmt.num(r.s.turnover, 1)} times`) },
    ],
    rows: [
      { name: `The rule, training (${months(split - WARMUP)})`, s: e.inSample },
      { name: `The rule, held out (${months(T - split)})`, s: o },
      { name: "Buy-and-hold, training", s: bhIn, bh: true },
      { name: "Buy-and-hold, held out", s: bhOut, bh: true },
    ],
  }));

  const key = `${state.ids.join(",")}|${state.from}|${state.cost}`;
  if (key !== gridKey) { gridKey = key; runGrid(data, split, cost); }
  else if (lastLuck) drawScatter(lastLuck);
}

function blank(why) {
  for (const s of [sSharpe, sReturn, sFall, sTrade]) s.set("–", "");
  verdict.replaceChildren(note("warn", why));
  status.textContent = why;
  growthChart.update({ series: [], empty: why });
  tableBox.replaceChildren();
  job++;
  gridKey = "";
  lastLuck = null;
  progress.textContent = "";
  luck.replaceChildren(note("warn", why));
  scatter.update({ series: [], marks: [], empty: why });
  winnerBtn.disabled = true;
}

function showTries() {
  const n = tries.size;
  if (n < 2) {
    triesText.textContent = "You have looked at 1 setting on this visit. Every setting you try and compare by its held-out result adds to the search, and the held-out months stop being a test.";
    return;
  }
  const Tout = T - indexOfYear(state.from);
  const luckOnly = expectedMaxSharpe(n, 1 / Tout) * ANN;
  triesText.textContent = `You have looked at ${fmt.int(n)} settings on this visit. Picking the best of them by its held-out result makes the held-out months part of the search: `
    + `if ${fmt.int(n)} unrelated rules with no skill were scored on these ${months(Tout)}, the best would show a Sharpe ratio of about ${fmt.signed(luckOnly, 2)} by luck alone.`;
}

/* ---------- the whole grid and the reshuffling test, in slices ---------- */
function runGrid(data, split, cost) {
  const id = ++job;
  const rules = grid(data.n);
  const bIn = data.B.subarray(WARMUP, split), bOut = data.B.subarray(split);
  const scored = [];
  const bests = [];
  let shuffleData = null, shuffleBest = -Infinity, ruleAt = 0;
  const rand = rng(SEED);
  lastLuck = null;
  winnerBtn.disabled = true;
  luck.replaceChildren();
  luckStatus.textContent = "";
  scatter.update({ series: [], marks: [], empty: "Working: scoring every rule" });
  const step = () => {
    if (id !== job) return; // a control changed: this run is abandoned
    const t0 = performance.now();
    while (performance.now() - t0 < 25) {
      if (scored.length < rules.length) {
        const v = rules[scored.length];
        const a = backtest(data, v, WARMUP, split - 1, cost).net, b = backtest(data, v, split, T - 1, cost).net;
        scored.push({ v, srIn: sharpe(a, bIn), srOut: sharpe(b, bOut), excessIn: Float64Array.from(a, (x, i) => x - bIn[i]) });
        continue;
      }
      if (bests.length >= RESHUFFLES) break;
      if (!shuffleData) { shuffleData = shuffled(data, split, rand); shuffleBest = -Infinity; ruleAt = 0; }
      const sb = shuffleData.B.subarray(WARMUP, split);
      shuffleBest = Math.max(shuffleBest, sharpe(backtest(shuffleData, rules[ruleAt], WARMUP, split - 1, cost).net, sb));
      if (++ruleAt === rules.length) { bests.push(shuffleBest); shuffleData = null; }
    }
    if (scored.length < rules.length) {
      progress.textContent = `Scoring every rule on these assets: ${fmt.int(scored.length)} of ${fmt.int(rules.length)}.`;
      setTimeout(step, 0);
      return;
    }
    if (!lastLuck) { lastLuck = { o: overfitting(scored), scored, split, data }; drawScatter(lastLuck); showLuck(lastLuck, null); }
    if (bests.length < RESHUFFLES) {
      progress.textContent = `Reshuffling the training months: ${bests.length} of ${RESHUFFLES} done.`;
      setTimeout(step, 0);
      return;
    }
    progress.textContent = "";
    showLuck(lastLuck, shuffleVerdict(lastLuck.o.winner.srIn, bests));
  };
  progress.textContent = `Scoring every rule on these assets: 0 of ${fmt.int(rules.length)}.`;
  setTimeout(step, 0);
}

function showLuck({ o, split }, sv) {
  const w = o.winner;
  const trainMonths = split - WARMUP, block = o.pbo?.blockMonths;
  const parts = [
    el("p", {}, `The tool ran all ${fmt.int(o.N)} rules on the training months (${span(WARMUP, split - 1)}, ${months(trainMonths)}) after costs: 4 rules, look-backs of 1 to 12 months, with and without the skipped month, and for the cross-sectional rules every number of assets held. `,
      el("strong", { text: `The best was ${describe(w.v).toLowerCase()}, with a Sharpe ratio of ${sr(w.srIn * ANN)}.` }),
      ` On the held-out months it scored ${sr(w.srOut * ANN)}, number ${fmt.int(o.outRank)} of the ${fmt.int(o.N)} rules${o.outRank === 1 ? ", the best of them" : ""}.`),
  ];
  if (o.pbo) {
    const bad = Math.round(o.pbo.pbo * o.pbo.splits);
    parts.push(el("p", {}, el("strong", { text: `Probability of backtest overfitting: ${pct(o.pbo.pbo, 0)}.` }),
      ` The training months were cut into ten blocks of ${months(block)}${o.pbo.droppedMonths ? ` (the first ${months(o.pbo.droppedMonths)} left over)` : ""}. In ${fmt.int(bad)} of the ${fmt.int(o.pbo.splits)} ways of choosing five blocks to pick the winner, it finished in the bottom half on the other five.`));
  }
  if (sv) {
    const none = sv.atLeast === 0;
    parts.push(el("p", {}, el("strong", { text: `Reshuffled months: ${none ? "no" : `${sv.atLeast} of ${sv.n}`} reshufflings matched or beat it.` }),
      ` Putting the training months in a random order keeps what each month paid and destroys any pattern over time. On ${sv.n} such orders the best of the same ${fmt.int(o.N)} rules scored ${sr(sv.mean * ANN)} on average (${sr(sv.lo * ANN)} to ${sr(sv.hi * ANN)}), against the real winner's ${sr(w.srIn * ANN)}. `
        + (none ? "A search this wide did not find a record this good in months with no order to them." : "A search this wide finds a record this good in months with no order to them, so the winner's record is not evidence of a pattern.")));
  } else parts.push(el("p", { class: "muted" }, "The reshuffling test is still running."));
  parts.push(el("p", { class: "small" },
    `For scale: if the ${fmt.int(o.N)} rules were unrelated and had no skill, the best of them would show about ${sr(o.independentMax * ANN)} over ${months(trainMonths)} by luck alone (Bailey and López de Prado's formula). They share assets and look-backs, so they are far from unrelated, which is why the reshuffling test is the better guide here. `
    + (Number.isFinite(o.corr) ? `Across all the rules, the training and held-out Sharpe ratios have a correlation of ${fmt.signed(o.corr, 2)}.` : "")));
  luck.replaceChildren(...parts);
  winnerBtn.disabled = false;
  if (sv) luckStatus.textContent = `Luck check done. The training winner, ${describe(w.v).toLowerCase()}, scored ${sr(w.srIn * ANN)} in training and ${sr(w.srOut * ANN)} held out, number ${o.outRank} of ${o.N}. `
    + (o.pbo ? `Probability of backtest overfitting ${pct(o.pbo.pbo, 0)}. ` : "") + `Reshuffled months matched or beat it ${sv.atLeast} times in ${sv.n}.`;
}

function drawScatter({ o, scored }) {
  const mine = scored.find((s) => variantKey(s.v) === variantKey(currentRule()));
  const marks = [{ type: "point", x: o.winner.srIn * ANN, y: o.winner.srOut * ANN, text: "Training winner" }];
  if (mine && mine !== o.winner) marks.push({ type: "point", x: mine.srIn * ANN, y: mine.srOut * ANN, text: "Your rule", color: "#eb6834" });
  scatter.update({
    title: "Every rule: training Sharpe ratio against held-out Sharpe ratio",
    subtitle: "If the past picked out rules that keep working, the dots would rise to the right.",
    label: `Scatter plot of ${o.N} rules, their Sharpe ratio in the training months against the held-out months`,
    hover: "point",
    x: { label: "Training Sharpe ratio", format: (x) => fmt.num(x, 2) },
    y: { label: "Held-out Sharpe ratio", format: (x) => fmt.num(x, 2) },
    series: [{ name: "Rules", type: "scatter", data: scored.map((s) => ({ x: s.srIn * ANN, y: s.srOut * ANN, label: describe(s.v) })), color: 0, r: 2.6, opacity: 0.55 }],
    legend: false,
    marks,
  });
}

function useWinner() {
  if (!lastLuck) return;
  const v = lastLuck.o.winner.v;
  Object.assign(state, { rule: v.rule, lookback: v.lookback, skip: v.skip, k: v.k || state.k });
  syncControls();
  update();
  winnerBtn.focus();
}

/* ---------- a table that becomes a list of labelled lines in a narrow box ---------- */
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl rt", role: "table" },
    el("caption", { text: caption }),
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c, k) => el("th", { role: "columnheader", scope: "col", class: k ? "num" : null, text: c.label })))),
    el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row" },
      columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: k ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

syncRule();
update();
