// Day 47: Wealth Distribution Simulator. Interface.
import { $, el, fmt, mount, slider, select, segmented, numberField, button, stat, note, chart, canvas, ticker, reducedMotion, randomSeed, debounce, palette, niceTicks } from "../kit/kit.js";
import { AGENT_CHOICES, LIMITS, DEFAULTS, problem, createSim, stepRound, measure, giniCeiling, driftFigures, EXPONENTIAL } from "./logic.js";

mount();

const INK = "#16233b", SLATE = "#566478", GRID = "#dbe4de";
const FONT = getComputedStyle(document.body).fontFamily;
const JUMP = 1000;
const EXAMPLES = [
  { label: "Fair bets, no tax", set: { kind: "yardsale", stake: 0.1, richerWins: 0.5, tax: 0 } },
  { label: "Fair bets, 1% wealth tax", set: { kind: "yardsale", stake: 0.1, richerWins: 0.5, tax: 0.01 } },
  { label: "Richer party wins 55%, 1% tax", set: { kind: "yardsale", stake: 0.1, richerWins: 0.55, tax: 0.01 } },
  { label: "Poorer party favoured, no tax", set: { kind: "yardsale", stake: 0.1, richerWins: 0.4, tax: 0 } },
  { label: "Pooled, nothing saved", set: { kind: "pooled", saving: 0, tax: 0 } },
  { label: "Pooled, half saved", set: { kind: "pooled", saving: 0.5, tax: 0 } },
];
const pct = (v, d = 1) => fmt.pct(v, d);
/** A share that may be tiny: "0.04%" and not "0.0%"; "less than 0.01%" below that. */
const share = (v) => (v >= 0.0995 ? pct(v, 1) : v >= 0.00005 ? pct(v, 2) : v > 0 ? "less than 0.01%" : "0%");
const still = reducedMotion();

const rule = { ...DEFAULTS };
let sim = createSim(rule);
let now = measure(sim);
let history = [];          // one point per recorded round: [round, gini, top10, top1, bottom50]
let stride = 1;            // rounds between recorded points, doubled whenever the history gets long
let jumpTo = 0;            // the round a jump is heading for, or 0
let acc = 0, drawnAt = 0, chartAt = 0;

/* ---------- controls ---------- */
const kindSeg = segmented({
  label: "How a trade works", value: rule.kind,
  options: [{ value: "yardsale", label: "Yard sale" }, { value: "pooled", label: "Pooled exchange" }],
  onChange: (v) => { rule.kind = v; ruleChanged(); },
});
const kindHint = el("div", { class: "hint" });
const stakeS = slider({
  label: "Stake, as a share of the poorer party's wealth", min: 1, max: 50, step: 1, value: rule.stake * 100, format: (v) => `${v}%`,
  onInput: (v) => { rule.stake = v / 100; ruleChanged(); },
});
const richerS = slider({
  label: "Chance that the richer party wins", min: 30, max: 70, step: 0.5, value: rule.richerWins * 100, format: (v) => `${fmt.num(v, 1)}%`,
  hint: "50% is a fair coin. Above it the richer party has the edge; below it the poorer party does.",
  onInput: (v) => { rule.richerWins = v / 100; ruleChanged(); },
});
const savingS = slider({
  label: "Share of its wealth each party saves", min: 0, max: 95, step: 5, value: rule.saving * 100, format: (v) => `${v}%`,
  hint: "What is saved stays out of the pool. The rest of both fortunes is split at random.",
  onInput: (v) => { rule.saving = v / 100; ruleChanged(); },
});
const taxS = slider({
  label: "Wealth tax each round, shared out equally", min: 0, max: 10, step: 0.1, value: rule.tax * 100, format: (v) => `${fmt.num(v, 1)}%`,
  hint: "Every agent pays this share of its wealth each round and everyone gets an equal part of the takings.",
  onInput: (v) => { rule.tax = v / 100; ruleChanged(); },
});
const theory = el("div", { class: "note theory", role: "status" });

const agentsSel = select({
  label: "Agents", value: rule.agents, options: AGENT_CHOICES.map((n) => ({ value: n, label: fmt.int(n) })),
  hint: "Changing this starts again from equal wealth.",
  onChange: (v) => { rule.agents = Number(v); restart("Started again"); },
});
const seedF = numberField({ label: "Seed", min: LIMITS.seed[0], max: LIMITS.seed[1], step: 1, value: rule.seed, hint: "The same seed and the same rule always give the same run." });
const seedNote = el("div");
seedF.input.addEventListener("input", () => {
  const v = seedF.value;
  if (!Number.isInteger(v)) {
    seedF.input.classList.add("invalid");
    seedNote.replaceChildren(note("bad", `The seed must be a whole number from 0 to 999,999. The run on screen still uses seed ${rule.seed}.`));
    return;
  }
  seedNote.replaceChildren();
  rule.seed = v;
  restart("Started again");
});
const newSeedBtn = button("New seed", () => { rule.seed = randomSeed() % 1000000; seedF.value = rule.seed; seedNote.replaceChildren(); restart("Started again"); }, { small: true });
const speedSel = select({
  label: "Speed", value: 10,
  options: [{ value: 2, label: "2 rounds a second" }, { value: 10, label: "10 rounds a second" }, { value: 50, label: "50 rounds a second" }, { value: 250, label: "250 rounds a second" }],
});

const runBtn = button("Run", () => (busy() ? pause() : play()), { primary: true });
const stepBtn = button("Step one round", () => { pause(); advance(1); refresh(true); tell(); });
const jumpBtn = button(`Jump ${fmt.int(JUMP)} rounds`, () => {
  if (jumpTo || problem(rule)) return;      // one jump at a time
  loop.stop();
  jumpTo = sim.round + JUMP;
  runBtn.textContent = "Pause";
  jumpSlice();
});
const resetBtn = button("Reset", () => restart("Reset"));

const controls = el("div", { class: "controls" },
  el("h2", { text: "Trading rule" }),
  kindSeg.el, kindHint, stakeS.el, richerS.el, savingS.el, taxS.el, theory,
  el("p", { class: "hint", text: "A change to the rule takes effect at once and the economy carries on from where it is. Reset starts again from equal wealth." }),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples (each starts again from equal wealth)" })),
    el("div", { class: "row" }, EXAMPLES.map((e) => button(e.label, () => {
      Object.assign(rule, e.set);
      syncControls();
      ruleChanged();
      restart("Started again");
      if (!still) play();
    }, { small: true })))),
  el("h2", { text: "Economy" }),
  agentsSel.el, el("div", { class: "seed" }, seedF.el, newSeedBtn), seedNote);

function syncControls() {
  kindSeg.value = rule.kind;
  stakeS.value = Math.round(rule.stake * 100);
  richerS.value = rule.richerWins * 100;
  savingS.value = Math.round(rule.saving * 100);
  taxS.value = Math.round(rule.tax * 1000) / 10;
}

/* ---------- outputs ---------- */
const tiles = {
  round: stat("Round"), gini: stat("Gini index"), top1: stat("Richest 1% hold"), top10: stat("Richest 10% hold"),
  bottom: stat("Poorest half hold"), total: stat("Total wealth"),
};
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div");
// Said once and left in place: it also explains why the picture steps twice a second while the economy runs.
const motionNote = el("div", {}, still ? note("", "Your device asks for reduced motion, so nothing moves until you press Run, Step or Jump. While it runs the picture is redrawn twice a second.") : null);
const summary = el("p", { class: "small", id: "d47-summary" });
const canvasBox = el("div");
const chartBox = el("div", { id: "d47-chart" });
const tenthsBox = el("div");
const tenthsDetails = el("details", { class: "chart-table" }, el("summary", { text: "Show the shares of each tenth of the agents as a table" }), tenthsBox);
tenthsDetails.addEventListener("toggle", () => drawTenths());
const out = el("div", { class: "out" },
  el("div", { class: "row buttons", id: "d47-run" }, runBtn, stepBtn, jumpBtn, resetBtn, speedSel.el),
  motionNote, message, status,
  el("div", { class: "stats" }, Object.values(tiles).map((t) => t.el)),
  el("div", {}, el("p", { class: "chart-title", id: "d47-title" }), el("p", { class: "chart-sub", text: "Simulated agents, not real people. Each is a bar, sorted from poorest to richest; the height is that agent's wealth as a multiple of the average, which is also what everyone started with." }), canvasBox, summary, tenthsDetails),
  chartBox);
$("#app").append(
  el("nav", { class: "jump", "aria-label": "Parts of this tool" }, el("a", { href: "#d47-run", text: "Skip the settings: run the economy" }), el("a", { href: "#d47-chart", text: "Chart over time" })),
  el("div", { class: "tool-grid wide-controls" }, controls, out));

const cv = canvas(canvasBox, { height: (w) => (w < 480 ? 230 : 300), draw: drawParade });
cv.el.setAttribute("role", "img");
cv.el.setAttribute("aria-labelledby", "d47-title");
cv.el.setAttribute("aria-describedby", "d47-summary");
const plot = chart(chartBox, { series: [], height: 300 });

/** The parade: one bar per agent, poorest on the left. Drawn as one outline so that 2,000 agents cost no more than 100. */
function drawParade(ctx, width, height) {
  if (!now) return;
  const left = 44, right = 10, top = 14, bottom = 26;
  const pw = Math.max(10, width - left - right), ph = Math.max(10, height - top - bottom);
  const { sorted, n } = now;
  const mean = now.total / n;
  const { ticks } = niceTicks(0, Math.max(2, now.max / mean), 4);
  const yMax = Math.max(ticks[ticks.length - 1], now.max / mean);
  const y = (v) => top + ph - (v / yMax) * ph;
  ctx.font = `12px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  for (const t of ticks) {
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(left, Math.round(y(t)) + 0.5); ctx.lineTo(left + pw, Math.round(y(t)) + 0.5); ctx.stroke();
    ctx.fillStyle = SLATE;
    ctx.textAlign = "right";
    ctx.fillText(`${fmt.sig(t, 3)}×`, left - 6, y(t));
  }
  ctx.fillStyle = palette[0];
  ctx.beginPath();
  ctx.moveTo(left, y(0));
  for (let i = 0; i < n; i++) {
    const h = y(sorted[i] / mean);
    ctx.lineTo(left + (i / n) * pw, h);
    ctx.lineTo(left + ((i + 1) / n) * pw, h);
  }
  ctx.lineTo(left + pw, y(0));
  ctx.closePath();
  ctx.fill();
  // The average, where everyone began.
  ctx.strokeStyle = INK;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(left, Math.round(y(1)) + 0.5); ctx.lineTo(left + pw, Math.round(y(1)) + 0.5); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("average", left + 4, y(1) - 3);
  ctx.fillStyle = SLATE;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("poorest", left, height - 6);
  ctx.textAlign = "right";
  ctx.fillText("richest", left + pw, height - 6);
  ctx.textAlign = "center";
  ctx.fillText(`${fmt.int(n)} agents in order of wealth`, left + pw / 2, height - 6);
}

function drawTenths() {
  if (!tenthsDetails.open) { tenthsBox.replaceChildren(); return; }
  const names = ["Poorest tenth", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "Richest tenth"];
  tenthsBox.replaceChildren(el("table", { class: "tbl" },
    el("caption", { text: `Share of all wealth held by each tenth of the agents after ${rounds(now.round)}` }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Tenth of the agents" }), el("th", { scope: "col", class: "num", text: "Share of wealth" }))),
    el("tbody", {}, now.tenths.map((t, i) => el("tr", {}, el("th", { scope: "row", text: names[i] }), el("td", { class: "num", text: share(t) }))))));
}

/* ---------- words ---------- */
const rounds = (r) => (r === 1 ? "1 round" : `${fmt.int(r)} rounds`);
function sentence() {
  const { n } = now;
  if (now.round === 0) return `Round 0: all ${fmt.int(n)} agents hold the same, so the Gini index is 0.0 and every tenth holds 10.0%.`;
  return `After ${rounds(now.round)} (${fmt.int(now.round * n)} trades) the Gini index is ${fmt.num(100 * now.gini, 1)}. The richest ${n === 100 ? "agent holds" : `${fmt.int(n / 100)} agents hold`} ${share(now.top1)} of all wealth, the richest ${fmt.int(n / 10)} hold ${share(now.top10)} and the poorest ${fmt.int(n / 2)} hold ${share(now.bottom50)}.`;
}
/** What theory says about the rule as it is set. Shown beside the sliders and read out once the sliders rest. */
function theoryText() {
  const taxed = rule.tax > 0;
  if (rule.kind === "pooled") {
    if (rule.saving === 0) {
      return taxed
        ? "With nothing saved and no tax, random sharing like this settles on an exponential spread with a Gini index of 50.0. The tax narrows that spread."
        : `With nothing saved and no tax, random sharing like this settles on the exponential spread that Drăgulescu and Yakovenko described: a Gini index of ${fmt.num(100 * EXPONENTIAL.gini, 1)}, with the richest 10% holding ${pct(EXPONENTIAL.top10)} and the poorest half ${pct(EXPONENTIAL.bottom50)}.`;
    }
    return `This is the saving rule of Chakraborti and Chakrabarti: the more each party saves, the narrower the spread the economy settles on.${taxed ? " The tax narrows it further." : ""}`;
  }
  const { drift, change, critical } = driftFigures(rule.stake, rule.richerWins);
  const lead = `In one trade the poorer party's wealth is multiplied by ${fmt.num(1 + rule.stake, 2)} if it wins and by ${fmt.num(1 - rule.stake, 2)} if it loses. Over many trades at these odds that is a typical change of ${change}% a trade.`;
  const edge = `At this stake the typical change is negative whenever the richer party wins more than ${critical}% of the time.`;
  const verdict = drift < 0
    ? (taxed ? "It is negative here, so wealth drifts upwards, and the tax hands some of it back every round: the economy settles where the two balance." : "It is negative here and there is no tax, so in theory wealth ends up with a single agent, however long that takes.")
    : drift > 0
      ? (taxed ? "It is positive here, so the poorer party tends to catch up, and the tax narrows the spread further." : "It is positive here, so the poorer party tends to catch up and the economy settles on a steady spread.")
      : "It is exactly zero here: the rule sits on the boundary between the two outcomes.";
  return `${lead} ${edge} ${verdict}`;
}
// The panel is a live region: it is written only when the words change, so nothing is read out a moment after the page loads.
const announceTheory = debounce(() => { const text = theoryText(); if (theory.textContent !== text) theory.textContent = text; }, 350);

function ruleChanged() {
  const yard = rule.kind === "yardsale";
  stakeS.el.hidden = !yard;
  richerS.el.hidden = !yard;
  savingS.el.hidden = yard;
  kindHint.textContent = yard
    ? "Two agents meet and bet a share of the poorer one's wealth, so nobody can lose more than they have. Winner takes the stake."
    : "Two agents meet, put everything they do not save into one pool, and split the pool at a random point.";
  announceTheory();
  const bad = problem(rule);
  message.replaceChildren(...(bad ? [note("bad", bad)] : []));
}

/* ---------- running ---------- */
function record() {
  now = measure(sim);
  if (now.round % stride === 0) history.push([now.round, 100 * now.gini, 100 * now.top10, 100 * now.top1, 100 * now.bottom50]);
  if (history.length > 800) { history = history.filter((_, i) => i % 2 === 0); stride *= 2; }
}
function advance(count) {
  if (problem(rule)) return;
  for (let k = 0; k < count; k++) { stepRound(sim, rule); record(); }
}
const busy = () => loop.running || jumpTo > 0;

function refresh(charts) {
  const t = performance.now();
  tiles.round.set(fmt.int(now.round), `${fmt.int(now.round * now.n)} trades`);
  tiles.gini.set(fmt.num(100 * now.gini, 1), `0 is equal; ${fmt.num(100 * giniCeiling(now.n), 1)} is one agent with everything`);
  tiles.top1.set(share(now.top1), `${fmt.int(now.n / 100)} of ${fmt.int(now.n)} agents; equal would be 1.0%`);
  tiles.top10.set(share(now.top10), `${fmt.int(now.n / 10)} agents; equal would be 10.0%`);
  tiles.bottom.set(share(now.bottom50), `${fmt.int(now.n / 2)} agents; equal would be 50.0%`);
  tiles.total.set(fmt.num(now.total, 6), `started at ${fmt.int(now.n)}; trades and tax only move it around`);
  $("#d47-title").textContent = `A simulated economy of ${fmt.int(now.n)} agents after ${rounds(now.round)}`;
  summary.textContent = sentence();
  cv.redraw();
  drawnAt = t;
  if (charts || t - chartAt > 300) {
    chartAt = t;
    const line = (i) => history.map((h) => [h[0], h[i]]);
    plot.update({
      title: "How concentrated wealth is, round by round",
      subtitle: "All four are on a scale from 0 to 100: the Gini index, and the percentage of all wealth held by three groups.",
      label: "Line chart of the Gini index and of the shares of wealth held by the richest 10%, the richest 1% and the poorest half, by round",
      x: { label: "Round", domain: [0, Math.max(10, now.round)], format: (v) => (Number.isInteger(v) ? fmt.int(v) : "") },
      y: { label: "Index or share of wealth (0 to 100)", domain: [0, 100], format: (v) => fmt.num(v, 1) },
      series: [
        { name: "Gini index", data: line(1), color: 0 },
        { name: "Richest 10%, share", data: line(2), color: 1 },
        { name: "Richest 1%, share", data: line(3), color: 2 },
        { name: "Poorest half, share", data: line(4), color: 3 },
      ],
    });
    drawTenths();
  }
}
/** Read the state out once, when the run stops or is stepped: never while it is moving. */
function tell(lead = "") { status.textContent = `${lead ? lead + ". " : ""}${sentence()}`; }

const loop = ticker((dt) => {
  acc += dt * Number(speedSel.value);
  const started = performance.now();
  let did = 0;
  while (acc >= 1) {
    advance(1); acc -= 1; did++;
    if (performance.now() - started > 12) { acc = 0; break; }   // never hold a frame for long
  }
  // With reduced motion asked for, the picture changes twice a second and not on every frame.
  if (did && (!still || performance.now() - drawnAt > 500)) refresh(false);
});
function play() {
  if (problem(rule)) return;
  jumpTo = 0;
  acc = 0;
  loop.start();
  runBtn.textContent = "Pause";
  message.replaceChildren();
}
function pause() {
  const was = busy();
  loop.stop();
  jumpTo = 0;
  runBtn.textContent = "Run";
  refresh(true);
  if (was) tell("Paused");
}
function jumpSlice() {
  if (!jumpTo) return;
  const started = performance.now();
  while (sim.round < jumpTo && performance.now() - started < 14) advance(1);
  if (sim.round < jumpTo) {
    if (performance.now() - drawnAt > 120) refresh(false);
    setTimeout(jumpSlice, 0);
    return;
  }
  jumpTo = 0;
  runBtn.textContent = "Run";
  refresh(true);
  tell(`Jumped ${fmt.int(JUMP)} rounds`);
}
function restart(lead) {
  loop.stop();
  jumpTo = 0;
  runBtn.textContent = "Run";
  sim = createSim(rule);
  history = [];
  stride = 1;
  record();
  refresh(true);
  tell(lead);
}

ruleChanged();
theory.textContent = theoryText();
record();
refresh(true);
if (!still) play();
