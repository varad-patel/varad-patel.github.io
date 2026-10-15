// Day 81: Bank Run Simulation. Interface.
import { $, el, fmt, debounce, mount, slider, segmented, select, numberField, button, stat, note, chart, randomSeed } from "../kit/kit.js";
import {
  THETA_BAR, DEFAULTS, LIMITS, readSettings, util, sure, withdrawUtility, waitUtility, r2, lowerBound, tipping, thresholdLimit,
  threshold, failurePoint, noisyOutcome, commonKnowledge, ddOptimal, simulateBank, sweep, withdrawShare,
} from "./logic.js";

mount();

/* ---------- formatting ---------- */
const pct = (x, d = 1) => fmt.pct(x, d);
const chance = (t) => `${fmt.num(t * 100, 1)}%`;
// "an 85.0% chance", "a 92.0% chance": the article follows the spoken number (eight, eleven, eighteen, eighty).
const aChance = (t) => { const s = chance(t); return `${/^(8|11\.|18\.)/.test(s) ? "an" : "a"} ${s}`; };
const money = (c) => (Number.isFinite(c) ? fmt.num(c, 3) : "unlimited");

/* ---------- examples ---------- */
const EXAMPLES = [
  { label: "Calm depositors", values: { ...DEFAULTS }, mode: "common" },
  { label: "Frightened depositors, same bank", values: { ...DEFAULTS, belief: 0.95, spread: 0.05 }, mode: "common" },
  { label: "Noisy news, same bank", values: { ...DEFAULTS }, mode: "noisy" },
  { label: "Investments too weak to save", values: { ...DEFAULTS, theta: 0.7 }, mode: "noisy" },
  { label: "Promise only what is stored", values: { ...DEFAULTS, r1: 1 }, mode: "noisy" },
  { label: "Strong investments", values: { ...DEFAULTS, theta: 0.92 }, mode: "noisy" },
];

/* ---------- controls ---------- */
const onChange = () => changed();
const sR = slider({ label: "Return on the bank's investment", min: 1.05, max: 3, step: 0.05, value: DEFAULTS.R, format: (v) => `${fmt.num(v, 2)} for each 1`, hint: "Paid at the end, date 2, if the investment pays off. Cashed in early, at date 1, it fetches only 1.", onInput: onChange });
const sR1 = slider({ label: "Promised to early withdrawers", min: 1, max: 3, step: 0.01, value: DEFAULTS.r1, format: (v) => `${fmt.num(v, 2)} for each 1`, hint: "The deposit contract: anyone may take this out at date 1 while the bank has it. Above 1, the bank insures depositors against needing their money early.", onInput: onChange });
const ddBtn = button("Use Diamond and Dybvig's best contract", () => { sR1.value = Math.round(ddOptimal(readAll().settings) * 100) / 100; changed(); }, { small: true });
const sLam = slider({ label: "Depositors who need their money early", min: 0.05, max: 0.6, step: 0.01, value: DEFAULTS.lambda, format: (v) => pct(v, 0), hint: "Impatient depositors always withdraw at date 1. The rest are patient: they can wait, and choose.", onInput: onChange });
const sTheta = slider({ label: "Chance the investment pays off", min: 0, max: 1, step: 0.005, value: DEFAULTS.theta, format: (v) => chance(v), hint: `The bank's fundamentals. Otherwise it returns nothing. From ${chance(THETA_BAR)} up it pays in full even if cashed in early.`, onInput: onChange });
const sA = slider({ label: "Depositors' risk aversion", min: 1.1, max: 5, step: 0.1, value: DEFAULTS.a, format: (v) => fmt.num(v, 1), hint: "a in u(c) = 1 − e^(−ac). Relative risk aversion is a × c.", onInput: onChange });
const modeSeg = segmented({ label: "What depositors know", value: "common", options: [{ value: "common", label: "Everyone knows the chance" }, { value: "noisy", label: "Each sees it with noise" }], onChange: () => { showMode(); changed(); } });
const sBelief = slider({ label: "Patient depositors expect", min: 0, max: 1, step: 0.01, value: DEFAULTS.belief, format: (v) => `${pct(v, 0)} to withdraw early`, hint: "Their average guess of the share of all depositors who will withdraw at date 1.", onInput: onChange });
const sSpread = slider({ label: "Disagreement", min: 0, max: 0.5, step: 0.01, value: DEFAULTS.spread, format: (v) => `± ${fmt.num(v * 100, 0)} points`, hint: "Each patient depositor's guess is drawn evenly from this range around the average.", onInput: onChange });
const sEps = slider({ label: "Noise in each depositor's signal", min: LIMITS.eps.min, max: LIMITS.eps.max, step: 0.001, value: DEFAULTS.eps, format: (v) => `± ${fmt.num(v * 100, 1)} points`, hint: "Each depositor sees the chance plus an error drawn evenly from this range, and knows that others see their own. Below 2.5 points, as Goldstein and Pauzner assume, so that the chances a depositor thinks possible stay between 0 and 100%.", onInput: onChange });
const nSel = select({ label: "Depositors simulated", value: "10000", options: [100, 1000, 10000, 100000].map((n) => ({ value: String(n), label: fmt.int(n) })), onChange: onChange });
const seedField = numberField({ label: "Seed", min: 0, max: 4294967295, step: 1, value: 1, hint: "Fixes who is impatient, the signals, the order in the queue and whether the investment pays off." });
seedField.input.addEventListener("input", onChange);
const seedMsg = el("div", { class: "d81-msg", "aria-live": "polite" });
const settingsMsg = el("div", { class: "d81-msg", "aria-live": "polite" });
const commonBox = el("div", { class: "d81-stack" }, sBelief.el, sSpread.el);
const noisyBox = el("div", { class: "d81-stack" }, sEps.el);
function showMode() { const c = modeSeg.value === "common"; commonBox.hidden = !c; noisyBox.hidden = c; }

function applyExample(ex) {
  sR.value = ex.values.R; sR1.value = ex.values.r1; sLam.value = ex.values.lambda; sTheta.value = ex.values.theta; sA.value = ex.values.a;
  sBelief.value = ex.values.belief; sSpread.value = ex.values.spread; sEps.value = ex.values.eps;
  modeSeg.value = ex.mode;
  showMode();
  changed();
}

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row d81-examples", role: "group", "aria-label": "Examples" }, EXAMPLES.map((ex) => button(ex.label, () => applyExample(ex), { small: true })))),
  el("h2", { text: "The bank" }),
  sR.el, sR1.el, el("div", { class: "row" }, ddBtn), sLam.el, sTheta.el,
  el("h2", { text: "The depositors" }),
  sA.el, modeSeg.el, commonBox, noisyBox, settingsMsg,
  el("h2", { text: "The simulation" }),
  nSel.el, el("div", { class: "field" }, seedField.el, el("div", { class: "row" }, button("New seed", () => { seedField.value = randomSeed(); changed(); }, { small: true })), seedMsg));

/* ---------- outputs ---------- */
const sOutcome = stat("Outcome");
const sShare = stat("Withdrawing early");
const sLine = stat("Runs happen below");
const sLate = stat("Each who waits gets");
const status = el("p", { class: "sr-only", role: "status" });
const story = el("div", { class: "small d81-story" });
const payBox = el("div", { id: "d81-payoffs" });
const mapBox = el("div", { id: "d81-map" });
const simHead = el("h2", { id: "d81-sim", text: "One bank, depositor by depositor" });
const simText = el("p", { class: "small" });
const barBox = el("div");
const simTable = el("div", { class: "d81-cmp-box" });
const paused = el("div");

const out = el("div", { class: "out" },
  paused,
  el("div", { class: "stats", id: "d81-verdict" }, sOutcome.el, sShare.el, sLine.el, sLate.el), status, story,
  payBox, mapBox,
  el("div", { class: "d81-stack" }, simHead, simText, barBox, simTable),
  note("", "A model of a bank's balance sheet and its depositors' choices, not a judgement about any real bank or advice about where to keep money."));
const jump = el("nav", { class: "row d81-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d81-verdict", "the outcome"], ["#d81-payoffs", "the coordination game"], ["#d81-map", "when runs happen"], ["#d81-sim", "the simulated bank"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));

const payChart = chart(payBox, { series: [], height: 280 });
const mapChart = chart(mapBox, { series: [], height: 300 });

/* ---------- reading ---------- */
function readAll() {
  const raw = { R: sR.value, r1: sR1.value, lambda: sLam.value, a: sA.value, theta: sTheta.value, eps: sEps.value, belief: sBelief.value, spread: sSpread.value };
  return readSettings(raw);
}

/* ---------- running ---------- */
const changed = debounce(() => update(), 120);
let simTimer = 0;

function update() {
  const read = readAll();
  settingsMsg.textContent = read.ok ? "" : read.errors.map((e) => e.message).join(" ");
  const seed = seedField.value;
  const seedOk = Number.isInteger(seed);
  seedMsg.textContent = seedOk ? "" : "Enter a whole-number seed from 0 to 4,294,967,295.";
  if (!read.ok || !seedOk) {
    paused.replaceChildren(note("warn", "Fix the setting described in red; the results below are from the last settings that worked."));
    return;
  }
  paused.replaceChildren();
  const s = read.settings;
  const p = { R: s.R, r1: s.r1, lambda: s.lambda, a: s.a };
  const mode = modeSeg.value;
  const theta = s.theta;
  const lb = lowerBound(p);
  const kLim = thresholdLimit(p);
  const k = mode === "noisy" ? threshold(p, s.eps) : null;
  const ck = commonKnowledge(theta, p, s.belief, s.spread);
  const no = mode === "noisy" ? noisyOutcome(theta, p, s.eps, k) : null;
  const n = mode === "noisy" ? no.n : ck.n;
  const fails = mode === "noisy" ? no.fails : ck.run && theta < THETA_BAR && p.r1 > 1;
  const nHat = tipping(theta, p);

  // The verdict.
  const runWord = mode === "noisy"
    ? (no.fails ? "A run: the bank fails" : no.patientRun > 0.999 ? "Everyone withdraws" : no.patientRun > 0.001 ? "A partial run: the bank survives" : "No run")
    : (ck.run ? (fails ? "A run: the bank fails" : "Everyone withdraws") : "No run");
  sOutcome.set(runWord, mode === "noisy" ? `${pct(no.patientRun, 0)} of patient depositors withdraw` : ck.run ? (ck.runOnly ? "the only equilibrium at these fundamentals" : "beliefs pick the run equilibrium") : ck.noRunOnly ? "the only equilibrium at these fundamentals" : "beliefs pick the no-run equilibrium");
  sShare.set(pct(n, 1), `of all depositors at date 1; the bank runs out at ${pct(Math.min(1, 1 / p.r1), 1)}`);
  sLine.el.querySelector(".l").textContent = mode === "noisy" ? "Runs happen below" : "Tipping share";
  if (mode === "noisy") {
    sLine.set(chance(k), `the threshold signal with this noise; ${chance(kLim)} as the noise vanishes`);
  } else {
    sLine.set(ck.both ? pct(nHat, 1) : ck.runOnly ? "None" : "None", ck.both ? "patient depositors who expect more than this share to withdraw early withdraw too" : ck.runOnly ? "everyone runs: waiting is worse even if only the impatient withdraw" : "nobody runs: waiting is better whatever others do");
  }
  const lateIf = mode === "noisy" ? no.late : ck.run ? 0 : r2(p);
  const nothingLeft = fails || lateIf <= 1e-9;
  sLate.set(nothingLeft ? "Nothing" : money(lateIf), nothingLeft ? "the bank has nothing left for date 2" : theta >= THETA_BAR ? "for sure: the investment pays in full" : `if the investment pays off, ${aChance(theta)} chance; against ${fmt.num(p.r1, 2)} for withdrawing`);

  const region = theta < lb ? `At ${aChance(theta)} chance of success the bank is unsound: waiting is worse than withdrawing even if only the impatient withdraw (that holds below ${chance(lb)}).`
    : theta >= THETA_BAR ? `At ${aChance(theta)} chance of success the investment pays in full at once, so waiting is better whatever others do.`
    : nHat >= 1 ? `At ${aChance(theta)} chance of success waiting is better whatever others do: a bank that promises only 1 can pay every withdrawal without selling what is owed to those who wait, so no run can feed on itself.`
    : `At ${aChance(theta)} chance of success the bank is sound if depositors stay calm: waiting is better as long as fewer than ${pct(nHat, 1)} of all depositors withdraw early, and worse once more do.`;
  const story2 = mode === "noisy"
    ? `With each depositor seeing the chance give or take ${fmt.num(s.eps * 100, 1)} points, there is one equilibrium: patient depositors withdraw on a signal below ${chance(k)} and wait above it. ${no.patientRun > 0.001 && theta >= lb && theta < THETA_BAR ? "So this run is panic-based: the bank would be sound if depositors stayed, but each fears the others will not." : ""}`
    : ck.both ? `Both outcomes are equilibria here. With beliefs averaging ${pct(s.belief, 0)} ± ${fmt.num(s.spread * 100, 0)} points, ${pct(ck.firstRound, 1)} withdraw in the first round, ${ck.firstRound > nHat ? "above" : "not above"} the tipping share, so ${ck.run ? "the run feeds on itself until every patient depositor has withdrawn" : "the rest see no reason to follow and only the impatient withdraw"}.`
      : "";
  story.replaceChildren(...[el("p", { text: region }), story2 ? el("p", { text: story2 }) : null].filter(Boolean), el("p", { class: "muted", text: `Below ${chance(lb)} a run is the only outcome. Goldstein and Pauzner's threshold for this bank, as the noise vanishes, is ${kLim > lb + 5e-4 ? `${chance(kLim)}: with private signals, runs happen below it, so between the two the runs are driven by fear of other depositors rather than by the bank's losses.` : "the same: with this promise every run is one the bank's prospects alone would cause, and none is driven by fear of other depositors."}` }));
  status.textContent = `${runWord}. ${pct(n, 1)} of depositors withdraw early.`;

  drawPayoffs(p, theta, nHat, mode === "common" ? s.belief : null);
  drawMap(p, s, mode, lb, kLim, k, theta, n, seed);
  // The depositor-by-depositor bank (up to 100,000 of them) runs in its own turn, after the charts are drawn.
  clearTimeout(simTimer);
  simTimer = setTimeout(() => simulateOne(p, s, mode, k, theta, seed, ck, no), 0);
}

function drawPayoffs(p, theta, nHat, belief) {
  const pts = [];
  for (let i = 0; i <= 200; i++) {
    const n = p.lambda + ((1 - p.lambda) * i) / 200;
    if (n >= 1) continue;
    pts.push({ n, wait: sure(waitUtility(theta, n, p), p.a), out: sure(withdrawUtility(theta, n, p), p.a) });
  }
  const capped = (v) => Math.min(v, 3 * p.R);
  const marks = [{ type: "vline", x: p.lambda * 100, text: "Only the impatient" }];
  if (nHat > p.lambda && nHat < 1) marks.push({ type: "vline", x: nHat * 100, text: "Tipping share" });
  if (p.r1 > 1 && theta < THETA_BAR) marks.push({ type: "vline", x: (100 / p.r1), text: "Bank runs out" });
  if (belief != null) marks.push({ type: "vline", x: belief * 100, text: "Expected" });
  payChart.update({
    title: "Wait or withdraw? The coordination game",
    subtitle: `What each choice is worth to a patient depositor, as the share of all depositors withdrawing early rises, at ${aChance(theta)} chance of success. Values are sure amounts worth the same as the risky payment.`,
    label: "Line chart of the value of waiting and of withdrawing early against the share of depositors withdrawing",
    x: { label: "Depositors withdrawing early (%)", format: (v) => `${fmt.int(v)}%`, domain: [p.lambda * 100, 100] },
    y: { label: "Worth, as a sure amount for each 1 deposited", format: (v) => fmt.num(v, 2), zero: true },
    series: [
      { name: "Wait until date 2", type: "line", data: pts.map((q) => [q.n * 100, capped(q.wait)]), color: 0 },
      { name: "Withdraw at date 1", type: "line", data: pts.map((q) => [q.n * 100, q.out]), color: 1 },
    ],
    marks,
  });
}

function drawMap(p, s, mode, lb, kLim, k, theta, n, seed) {
  const lo = Math.max(0, Math.floor((Math.min(lb, theta) - 0.08) * 20) / 20);
  const xs = Array.from({ length: 161 }, (_, i) => lo + ((1 - lo) * i) / 160);
  const series = [
    { name: "Common knowledge: run equilibrium", type: "line", data: xs.map((t) => [t * 100, t < THETA_BAR ? 100 : NaN]), color: 7, dash: true },
    { name: "Common knowledge: no-run equilibrium", type: "line", data: xs.map((t) => [t * 100, t >= lb ? p.lambda * 100 : NaN]), color: 2, dash: true },
  ];
  if (mode === "noisy") {
    series.push({ name: "Noisy signals: the one equilibrium", type: "line", data: xs.map((t) => [t * 100, withdrawShare(t, k, s.eps, p.lambda) * 100]), color: 0 });
    const thetas = Array.from({ length: 33 }, (_, i) => lo + ((1 - lo) * (i + 0.5)) / 33);
    const rows = sweep({ p, eps: s.eps, k, N: Math.min(Number(nSel.value), 4000), seed, thetas });
    series.push({ name: "Simulated banks", type: "scatter", data: rows.map((r) => ({ x: r.theta * 100, y: r.share * 100, label: r.fails ? "failed" : "survived" })), color: 3, r: 3 });
  }
  const marks = [{ type: "vline", x: lb * 100, text: "Lower bound" }];
  if (mode === "noisy") marks.push({ type: "vline", x: k * 100, text: "Threshold" });
  marks.push({ type: "point", x: theta * 100, y: n * 100, text: "This bank" });
  mapChart.update({
    title: "When runs happen",
    subtitle: mode === "noisy"
      ? `Share of depositors withdrawing early at each chance of success. Dashed: the two equilibria if everyone knew the chance. Solid: the single equilibrium when each sees it with noise, with patient depositors running below ${chance(k)}. Dots: banks simulated with ${fmt.int(Math.min(Number(nSel.value), 4000))} depositors each.`
      : `Share of depositors withdrawing early at each chance of success, when everyone knows it. Below ${chance(lb)} only a run is possible; from ${chance(THETA_BAR)} up only calm; in between, both, and beliefs decide. Switch to noisy signals to see one threshold instead.`,
    label: "Chart of the share of depositors withdrawing early against the chance the investment pays off",
    x: { label: "Chance the investment pays off (%)", format: (v) => `${fmt.int(v)}%`, domain: [lo * 100, 100] },
    y: { label: "Withdrawing early (%)", format: (v) => `${fmt.int(v)}%`, domain: [0, 100] },
    series,
    marks,
  });
}

function simulateOne(p, s, mode, k, theta, seed, ck, no) {
  const N = Number(nSel.value);
  const b = simulateBank({ p, theta, N, seed, mode, eps: s.eps, k, belief: s.belief, spread: s.spread });
  let paidFull = 0, short = 0, nothingEarly = 0, waitPaid = 0, waitLost = 0;
  for (let i = 0; i < N; i++) {
    if (b.withdraw[i]) { if (b.paid[i] >= p.r1 - 1e-12) paidFull++; else if (b.paid[i] > 0) short++; else nothingEarly++; }
    else if (b.paid[i] > 0) waitPaid++; else waitLost++;
  }
  const parts = [
    { label: "Withdrew and were paid in full", count: paidFull, color: "var(--c2)" },
    { label: "Withdrew, paid part", count: short, color: "var(--c4)" },
    { label: "Withdrew too late: nothing", count: nothingEarly, color: "var(--c8)" },
    { label: "Waited and were paid at date 2", count: waitPaid, color: "var(--c1)" },
    { label: "Waited and got nothing", count: waitLost, color: "#8a94a3" },
  ];
  barBox.replaceChildren(
    el("div", { class: "d81-bar", role: "img", "aria-label": parts.map((q) => `${q.label}: ${fmt.int(q.count)}`).join(", ") },
      parts.filter((q) => q.count > 0).map((q) => el("span", { style: { width: `${(q.count / N) * 100}%`, background: q.color }, title: `${q.label}: ${fmt.int(q.count)}` }))),
    el("div", { class: "chart-legend" }, parts.map((q) => el("span", {}, el("i", { style: { background: q.color } }), `${q.label} `, el("strong", { text: fmt.int(q.count) })))));

  const modelShare = mode === "noisy" ? no.n : ck.n;
  const roundsText = mode === "common" && b.rounds.length
    ? ` Rounds of responses: ${b.rounds.map((r, i) => `${i + 1}: ${pct(r, 1)}`).join("; ")}. In the first round each patient depositor acts on their own guess; afterwards everyone expects the share they last saw.`
    : "";
  simText.textContent = `${fmt.int(N)} depositors, ${fmt.int(Math.round(b.impatientShare * N))} of them impatient (seed ${fmt.int(seed)}). Those who withdraw arrive in a random order and are paid ${fmt.num(p.r1, 2)} each until the investment, cashed in, runs out; what is left earns ${fmt.num(p.R, 2)} a unit ${theta >= THETA_BAR ? "for sure" : `if it pays off, which here it ${b.success ? "did" : "did not"}`}.${roundsText}`;

  const modelRows = [
    ["Share withdrawing early", pct(b.share, 2), mode === "noisy" ? pct(modelShare, 2) : `${pct(ck.n, 2)}${ck.both ? " (beliefs pick this equilibrium)" : ""}`],
    ...(mode === "common" ? [["Share withdrawing in the first round", pct(b.rounds[0], 2), pct(ck.firstRound, 2)]] : []),
    ["Bank fails at date 1", b.fails ? "yes" : "no", (mode === "noisy" ? no.fails : ck.run && theta < THETA_BAR && p.r1 > 1) ? "yes" : "no"],
    ["Early withdrawers paid in full", pct(paidFull / Math.max(1, b.queue.length), 1), b.share * p.r1 <= (theta >= THETA_BAR ? p.R : 1) ? "100.0%" : pct(1 / (b.share * p.r1), 1)],
    ["Paid to each who waited, if the investment pays off", b.queue.length < N ? money(b.lateIfSuccess) : "nobody waited", modelShare != null && modelShare < 1 ? money(mode === "noisy" ? no.late : r2(p)) : "nobody waits"],
  ];
  simTable.replaceChildren(el("table", { class: "tbl d81-cmp" },
    el("caption", { text: "The simulated bank against the model" }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Measure" }), el("th", { scope: "col", class: "num", text: "Simulated" }), el("th", { scope: "col", class: "num", text: "Model" }))),
    el("tbody", {}, modelRows.map(([m, a, c]) => el("tr", {}, el("th", { scope: "row", text: m }), el("td", { class: "num", "data-label": "Simulated", text: a }), el("td", { class: "num", "data-label": "Model", text: c }))))),
    el("p", { class: "small muted", text: "The model's figures are for a very large bank; a simulated one differs by chance in who is impatient and, with noise, in who sees what. The model's share counts the impatient at exactly their expected share." }));
}

showMode();
update();
