// Day 50: Price War Simulator. Interface.
import { $, el, fmt, mount, slider, select, numberField, checkbox, segmented, button, stat, note, chart, reducedMotion } from "../kit/kit.js";
import { buildGame, createSession, summarise, problem } from "./logic.js";

mount();

const game = buildGame();
const MAX_SEED = 999960;                      // the last run of 40 must still have a seed of at most 999,999
const START = { bots: ["q", "q"], alpha: 0.15, beta: 4, delta: 0.95, memory: true, runs: 10, seed: 1 };
const state = { ...START, bots: [...START.bots], cutBot: 0, cutTo: "reply", inspect: null };
let done = [];                                // finished runs: { seed, session, lim }
let shown = null;                             // the settings the results on screen came from
let job = 0, running = false, live = null;    // live: the run in progress
const price = (x) => fmt.num(x, 2);
const pct = (x) => fmt.pct(x, 0);
const pairName = ([x, y]) => (x === y ? (x === "q" ? "two Q-learners" : "two undercutters") : x === "q" ? "a Q-learner (bot 1) against an undercutter (bot 2)" : "an undercutter (bot 1) against a Q-learner (bot 2)");
const CUT_WORDS = { reply: "to its one-shot best reply", step: "by one grid step", floor: "to the lowest price on the grid" };
const plural = (k, word) => `${fmt.int(k)} ${word}${k === 1 ? "" : "s"}`;
const botName = (k) => `bot ${k + 1}`;
const tiny = (g) => Math.abs(g) < 0.0005;   // a discounted gain or loss that rounds to 0.000

/* ---------- controls ---------- */
const KIND_OPTIONS = [
  { value: "q", label: "Q-learner" },
  { value: "reply", label: "Undercutter" },
];
const KIND_HINT = "A Q-learner starts knowing nothing and learns prices by trial and error. An undercutter learns nothing: it always charges the best reply to its rival's last price.";
const botSel = [0, 1].map((k) => select({ label: `Bot ${k + 1}`, value: state.bots[k], options: KIND_OPTIONS, hint: k === 1 ? KIND_HINT : null, onChange: (v) => { state.bots[k] = v; changed(); } }));
const alphaSlider = slider({
  label: "Learning rate (α)", min: 0.025, max: 0.25, step: 0.025, value: state.alpha, format: (v) => fmt.num(v, 3),
  hint: "How far one period's result moves a learner's estimate. The paper tried 0.025 to 0.25.",
  onInput: (v) => { state.alpha = v; changed(); },
});
const betaSel = select({
  label: "How fast exploring fades (β)", value: state.beta,
  options: [
    { value: 2, label: "2 per million periods: slowest, most thorough" },
    { value: 4, label: "4 per million: the paper's main setting" },
    { value: 10, label: "10 per million" },
    { value: 20, label: "20 per million: about three times quicker" },
    { value: 100, label: "100 per million: quickest, little exploring" },
  ],
  hint: "A learner picks a price at random with probability e^(−βt) in period t. At 4 per million that is still 2% after a million periods.",
  onChange: (v) => { state.beta = Number(v); changed(); },
});
const deltaSlider = slider({
  label: "Patience (discount factor δ)", min: 0, max: 0.99, step: 0.01, value: state.delta, format: (v) => fmt.num(v, 2),
  hint: "What a learner counts next period's profit as worth today. At 0 it cares only about this period.",
  onInput: (v) => { state.delta = v; changed(); },
});
const memoryBox = checkbox({ label: "Learners remember last period's two prices", checked: state.memory, onChange: (on) => { state.memory = on; changed(); } });
const runsSel = select({ label: "Number of runs", value: state.runs, options: [5, 10, 20, 40].map((n) => ({ value: n, label: `${n} runs` })), hint: "Runs differ only in their seed. One run alone can mislead.", onChange: (v) => { state.runs = Number(v); changed(); } });
const seedField = numberField({ label: "First seed", min: 0, max: MAX_SEED, step: 1, value: state.seed, hint: "Each run uses the next seed along. The same seeds give the same runs." });
seedField.input.addEventListener("input", () => { if (!seedProblem()) state.seed = seedField.value; changed(); });
const seedProblem = () => (Number.isInteger(seedField.value) ? "" : `The first seed must be a whole number from 0 to ${fmt.int(MAX_SEED)}.`);
const settingsNote = el("div");
const bar = el("progress", { max: 1, value: 0, "aria-label": "Progress of the runs" });
const barText = el("p", { class: "small muted" });
const progBox = el("div", { class: "prog" }, bar, barText);
const runBtn = button("Run the bots", () => (running ? stop("Stopped") : start()), { primary: true });

const EXAMPLES = [
  { label: "The paper's baseline", set: {} },
  { label: "Two undercutters", set: { bots: ["reply", "reply"] } },
  { label: "Learner against undercutter", set: { bots: ["q", "reply"] } },
  { label: "No memory", set: { memory: false } },
  { label: "No patience", set: { delta: 0 } },
  { label: "The paper's no-memory test", set: { memory: false, delta: 0, alpha: 0.25, beta: 100, runs: 40 } },
];
function apply(set) {
  Object.assign(state, START, set, { bots: [...(set.bots || START.bots)] });
  botSel.forEach((s, k) => { s.value = state.bots[k]; });
  alphaSlider.value = state.alpha; betaSel.value = state.beta; deltaSlider.value = state.delta;
  memoryBox.checked = state.memory; runsSel.value = state.runs; seedField.value = state.seed;
  start();
}

const controls = el("div", { class: "controls" },
  botSel[0].el, botSel[1].el, alphaSlider.el, betaSel.el, deltaSlider.el, memoryBox.el, runsSel.el, seedField.el, settingsNote,
  el("div", { class: "row" }, runBtn),
  progBox,
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("span", { text: "Examples (each one runs straight away)" })),
    el("div", { class: "row" }, EXAMPLES.map((x) => button(x.label, () => apply(x.set), { small: true })))));

// Links to the parts of a long tool: on a phone the results start below the controls.
const jump = (pairs) => el("nav", { class: "jump", "aria-label": "Parts of the tool" }, el("span", { text: "Jump to" }), pairs.map(([id, text]) => el("a", { href: `#${id}`, text })));

/* ---------- outputs ---------- */

const status = el("p", { class: "sr-only", role: "status" });
const sNash = stat("One-shot Nash price", fmt.num(game.pN, 3), `each bot earns ${fmt.num(game.piN, 3)} a period`);
const sMono = stat("Joint-monopoly price", fmt.num(game.pM, 3), `each bot earns ${fmt.num(game.piM, 3)} a period`);
const sPrice = stat("Long-run price"), sGain = stat("Profit gain");
const verdictBox = el("div", { class: "stack" });
const learnBox = el("div");
const runsBox = el("div", { class: "rt-box" });        // a container: its table turns into a list when the column is narrow
const cutBotSeg = segmented({ label: "Which bot is made to cut its price", value: 0, options: [{ value: 0, label: "Bot 1" }, { value: 1, label: "Bot 2" }], onChange: (v) => { state.cutBot = Number(v); drawSummary(); drawCut(); drawRuns(); } });
const cutToSel = select({
  label: "It is made to charge, for one period", value: "reply",
  options: [
    { value: "reply", label: "its one-shot best reply to the rival" },
    { value: "step", label: "one grid step below its usual price" },
    { value: "floor", label: `the lowest price on the grid, ${price(game.grid[0])}` },
  ],
  hint: "The best reply is the most tempting cut, and the one the paper tests.",
  onChange: (v) => { state.cutTo = v; drawSummary(); drawCut(); drawRuns(); },
});
const inspectSel = select({ label: "Run to look at", options: [{ value: "", label: "No run has finished yet" }], value: "", onChange: (v) => { state.inspect = v === "" ? null : Number(v); drawLearning(); drawCut(); } });
const cutBox = el("div"), cutText = el("div", { class: "stack" });

const out = el("div", { class: "out" },
  el("p", { class: "small sim-line" }, el("strong", { text: "Simulated. " }), "Two computer programs sell in an invented market (the demand is set out under \"How it works\"). No real firms or prices are involved, and every number below comes from the runs on this page."),
  status,
  el("div", { class: "stats", id: "t-results" }, sNash.el, sMono.el, sPrice.el, sGain.el),
  verdictBox,
  el("h2", { id: "t-learn", text: "Prices while the bots learn" }), learnBox,
  el("h2", { id: "t-cut", text: "Test a price cut" }),
  el("p", { class: "small muted", text: "High prices are collusion only if they are held in place by the threat of retaliation. So take a finished run, stop the exploring, force one bot to undercut for a single period and watch what the other does." }),
  el("div", { class: "cut-controls" }, inspectSel.el, cutBotSeg.el, cutToSel.el),
  cutBox, cutText,
  el("h2", { id: "t-runs", text: "Every run" }), runsBox);
$("#app").append(jump([["t-results", "Results"], ["t-learn", "Prices while learning"], ["t-cut", "Price-cut test"], ["t-runs", "Every run"]]), el("div", { class: "tool-grid wide-controls" }, controls, out));
const learnChart = chart(learnBox, { series: [], height: 320 });
const cutChart = chart(cutBox, { series: [], height: 280 });

// A table that turns into a list of labelled lines on a narrow screen (see the page's <style>). Cells may be nodes.
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl rt", role: "table" },
    el("caption", { text: caption }),
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c) => el("th", { role: "columnheader", scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row", class: r.seed === state.inspect ? "on" : null },
      columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label }, c.get(r)))))));
}

/* ---------- running ---------- */
const describe = (s) => `${pairName(s.bots)}${s.bots.includes("q") ? `, learning rate ${fmt.num(s.alpha, 3)}, exploring fading at ${s.beta} per million, patience ${fmt.num(s.delta, 2)}, memory ${s.memory ? "on" : "off"}` : ""}, seeds ${s.seed} to ${s.seed + s.runs - 1}`;

function changed() {
  if (running) stop("Stopped because a setting changed");
  const why = seedProblem();
  seedField.input.classList.toggle("invalid", Boolean(why));
  settingsNote.replaceChildren(...(why ? [note("bad", why)] : shown ? [note("warn", "The settings have changed. The results on the right are still from the earlier ones: press \"Run the bots\" to use the new settings.")] : []));
}

function start() {
  // beta is held as a count per million periods. Dividing gives exactly the number the tests use (4e-6, 1e-4);
  // multiplying by 1e-6 is one rounding error away from it for 10, 20 and 100 per million.
  const why = seedProblem() || problem({ bots: state.bots, alpha: state.alpha, beta: state.beta / 1e6, delta: state.delta, seed: state.seed });
  if (why) { settingsNote.replaceChildren(note("bad", `${why} Nothing was run.`)); seedField.input.classList.add("invalid"); return; }
  settingsNote.replaceChildren();
  const my = ++job;
  const cfg = { bots: [...state.bots], alpha: state.alpha, beta: state.beta, delta: state.delta, memory: state.memory, runs: state.runs, seed: state.seed };
  shown = cfg; done = []; state.inspect = null; chosenByVisitor = false; running = true;
  runBtn.textContent = "Stop";
  status.textContent = "";
  const make = (i) => createSession({ game, bots: cfg.bots, alpha: cfg.alpha, beta: cfg.beta / 1e6, delta: cfg.delta, memory: cfg.memory, seed: cfg.seed + i });
  let i = 0, lastDraw = 0;
  live = make(0);
  drawAll();
  const tick = () => {
    if (my !== job) return;
    const t0 = performance.now();
    let finished = false;
    while (performance.now() - t0 < 25 && i < cfg.runs) {
      live.advance(20000);
      if (live.done) {
        done.push({ seed: live.seed, session: live, lim: live.limit() });
        finished = true;
        i++;
        live = i < cfg.runs ? make(i) : null;
      }
    }
    bar.value = (i + (live ? Math.min(0.99, live.t / (live.learning ? 2e6 * (4 / cfg.beta) ** 0.9 : 10)) : 0)) / cfg.runs;
    barText.textContent = live ? `Run ${i + 1} of ${cfg.runs}: ${fmt.int(Math.floor(live.t / 20000) * 20000)} periods so far${live.learning ? `, exploring ${fmt.pct(live.exploring, live.exploring < 0.01 ? 2 : 0)} of the time` : ""}.` : "";
    if (finished) { pickInspect(); drawSummary(); drawRuns(); drawCut(); }
    if (finished || (!reducedMotion() && t0 - lastDraw > 400)) { lastDraw = t0; drawLearning(); }
    if (i < cfg.runs) setTimeout(tick, 0); else finish("Finished");
  };
  setTimeout(tick, 0);
}

function stop(why) { job++; finish(why); }

function finish(why) {
  running = false; live = null;
  runBtn.textContent = "Run the bots";
  bar.value = shown && done.length === shown.runs ? 1 : bar.value;
  barText.textContent = !shown ? "" : done.length === shown.runs ? `${why}: all ${plural(shown.runs, "run")} done.` : `${why} after ${done.length} of ${plural(shown.runs, "run")}. The results below cover only the runs that finished.`;
  pickInspect();
  drawAll();
  status.textContent = `${barText.textContent} ${verdictBox.textContent}`;
}

// Until the visitor chooses one, the run shown is the one with the middle profit gain, not the best or the worst.
let chosenByVisitor = false;
inspectSel.input.addEventListener("change", () => { chosenByVisitor = true; });
function pickInspect() {
  if (!done.length) { state.inspect = null; chosenByVisitor = false; return; }
  if (chosenByVisitor && done.some((x) => x.seed === state.inspect)) return;
  chosenByVisitor = false;
  const sorted = [...done].sort((a, b) => a.lim.gain - b.lim.gain || a.seed - b.seed);
  state.inspect = sorted[Math.floor((sorted.length - 1) / 2)].seed;
}
const inspected = () => done.find((x) => x.seed === state.inspect) || null;
const cutOf = (x) => x.session.deviate({ bot: state.cutBot, to: state.cutTo, horizon: 20 });

/* ---------- drawing ---------- */
function drawAll() { drawSummary(); drawLearning(); drawCut(); drawRuns(); }

function cutCounts() {
  const cuts = done.map(cutOf).filter((d) => d.cut);
  return { possible: cuts.length, answered: cuts.filter((d) => d.punished).length, lost: cuts.filter((d) => d.gain < 0 && !tiny(d.gain)).length, paid: cuts.filter((d) => d.gain > 0 && !tiny(d.gain)).length };
}

function drawSummary() {
  if (!done.length) {
    sPrice.set("–", running ? "waiting for the first run" : "no run has finished");
    sGain.set("–", "0% is the Nash profit, 100% the monopoly profit");
    verdictBox.replaceChildren(note("", running ? "The first run is still learning. Results appear here run by run." : "No run has finished. Press \"Run the bots\"."));
    return;
  }
  const lims = done.map((x) => x.lim);
  const sum = summarise(lims);
  const lo = Math.min(...lims.map((l) => l.price)), hi = Math.max(...lims.map((l) => l.price));
  const of = `${plural(sum.n, "run")}`;
  sPrice.set(price(sum.price), sum.n === 1 ? "one run only" : lo.toFixed(2) === hi.toFixed(2) ? `the same in all ${of}` : `average of ${of}; from ${price(lo)} to ${price(hi)}`);
  sGain.set(pct(sum.mean), sum.n === 1 ? "0% is the Nash profit, 100% the monopoly profit" : pct(sum.min) === pct(sum.max) ? `the same in all ${of}` : `average; from ${pct(sum.min)} to ${pct(sum.max)} across runs`);

  const settled = done.filter((x) => x.session.settled).length;
  const c = cutCounts();
  const nash = `the one-shot Nash price (${fmt.num(game.pN, 3)})`, mono = `the joint-monopoly price (${fmt.num(game.pM, 3)})`;
  const along = (sum.price - game.pN) / (game.pM - game.pN);
  const where = along > 0.5 ? `nearer to ${mono} than to ${nash}` : along > 0.15 ? `above ${nash} but nearer to it than to ${mono}` : `close to ${nash} and far from ${mono}`;
  const parts = [`Results for ${describe(shown)}${done.length < shown.runs ? ` (only ${done.length} of ${shown.runs} finished)` : ""}.`];
  parts.push(`${shown.bots.includes("q") ? "Once the bots stop exploring" : "After the first few periods"}, prices average ${price(sum.price)}: ${where}. That is a profit gain of ${pct(sum.mean)}${sum.n > 1 && pct(sum.min) !== pct(sum.max) ? `, anywhere from ${pct(sum.min)} to ${pct(sum.max)} depending on the seed` : ""}.`);
  if (settled < done.length) parts.push(`${plural(done.length - settled, "run")} had not settled when the period limit was reached, and ${done.length - settled === 1 ? "is" : "are"} judged on what the bots had learned by then.`);
  const who = botName(state.cutBot);
  if (!c.possible) parts.push(`A price cut ${CUT_WORDS[state.cutTo]} cannot be tested: in every run ${who} already charges no more than the price it would be cut to.`);
  else parts.push(`Forcing ${who} to cut its price ${CUT_WORDS[state.cutTo]} for one period was possible in ${c.possible} of ${of}. The other bot answered with a lower price in ${c.answered} of ${c.possible}, and the cut lost ${who} money over time in ${c.lost} of ${c.possible}${c.paid ? ` and paid in ${c.paid}` : ""}${c.possible - c.lost - c.paid ? ` (in ${c.possible - c.lost - c.paid} it made no difference to three decimal places)` : ""}.`);
  const bothLearn = shown.bots.every((k) => k === "q");
  const judged = c.possible && sum.mean > 0.25 && state.cutTo === "reply";      // only the most tempting cut is a fair test
  if (judged) parts.push(!bothLearn
    ? "This is price leadership, not collusion: the learner has found that when it holds a high price the undercutter follows it up, and when it cuts the undercutter follows it down."
    : c.lost === c.possible ? "High prices that a price cut does not pay to break: this is what economists mean by tacit collusion."
      // "Not answered" is said only when no run answered: with little patience a cut can pay even though it is answered.
      : c.paid === c.possible ? `High prices that nothing defends: a cut pays${c.answered === 0 ? " and is not answered" : `, even though the other bot answered it in ${c.answered} of ${c.possible} ${c.possible === 1 ? "run" : "runs"}`}, so ${who} has not learned its best reply. That is not collusion.`
        : "The picture is mixed: in some runs a cut loses money and in others it pays.");
  verdictBox.replaceChildren(note(judged && bothLearn && c.lost === c.possible ? "warn" : "", parts.join(" ")));
}

function drawLearning() {
  const all = [...done.map((x) => x.session), ...(live ? [live] : [])];
  const marks = [{ type: "hline", y: game.pM, text: `joint monopoly ${fmt.num(game.pM, 3)}` }, { type: "hline", y: game.pN, text: `one-shot Nash ${fmt.num(game.pN, 3)}` }];
  const y = { label: "Price", domain: [1.4, 2], format: (v) => fmt.num(v, 1) };
  if (!all.length) { learnChart.update({ title: "", subtitle: "", series: [], marks: [], empty: "No run yet" }); return; }
  const focus = inspected()?.session ?? all[0];
  if (!focus.learning) {
    // Nothing is learned: show the price war itself, period by period.
    const steps = focus.early.p0.length;
    learnChart.update({
      title: `Seed ${focus.seed}: every period from the start`,
      subtitle: "Neither bot learns. Period 0 is a random pair of prices; after that each charges its best reply to the other's last price.",
      label: "Line chart of each bot's price in each period of the chosen run",
      x: { label: "Period", domain: [0, Math.max(6, steps - 1)], format: (v) => (Number.isInteger(v) ? String(v) : "") }, y,
      series: [0, 1].map((k) => ({ name: `Bot ${k + 1}`, type: "line", color: k, data: focus.early[k ? "p1" : "p0"].map((p, t) => [t, p]) })),
      marks,
    });
    return;
  }
  const line = (s) => s.trace.t.map((t, k) => [t / 1e6, (s.trace.p0[k] + s.trace.p1[k]) / 2]);
  const longest = Math.max(0.2, ...all.map((s) => s.t / 1e6));
  learnChart.update({
    title: "Average of the two bots' prices over each 10,000 periods",
    subtitle: `One thin line for each run; the heavy line is seed ${focus.seed}, the run chosen below. Early prices are mostly random exploring.`,
    label: "Line chart of the average price over time for every run, with the one-shot Nash and joint-monopoly prices marked",
    x: { label: "Periods played (millions)", domain: [0, longest], format: (v) => fmt.num(v, longest < 1 ? 2 : 1) }, y,
    series: [
      ...all.filter((s) => s !== focus && s.learning).map((s) => ({ name: `Seed ${s.seed}`, type: "line", color: "#8a94a3", width: 1, opacity: 0.75, legend: false, hover: false, data: line(s) })),
      { name: `Seed ${focus.seed}`, type: "line", color: 0, width: 2.5, data: line(focus) },
    ],
    legend: false,
    marks,
  });
}

function drawCut() {
  const options = done.map((x) => ({ value: x.seed, label: `Seed ${x.seed}: ${x.lim.length === 1 ? `${price(x.lim.prices[0])} and ${price(x.lim.prices[1])}` : `cycle of ${x.lim.length}`}, gain ${pct(x.lim.gain)}` }));
  inspectSel.input.replaceChildren(...(options.length ? options : [{ value: "", label: "No run has finished yet" }]).map((o) => el("option", { value: o.value, text: o.label })));
  inspectSel.value = state.inspect ?? "";
  const x = inspected();
  if (!x) { cutChart.update({ title: "", subtitle: "", series: [], marks: [], empty: "Waiting for a run to finish" }); cutText.replaceChildren(); return; }
  const d = cutOf(x);
  const me = state.cutBot, rival = 1 - me;
  if (!d.cut) {
    cutChart.update({ title: "", subtitle: "", series: [], marks: [], empty: "No price cut to test in this run" });
    cutText.replaceChildren(note("", `In the run with seed ${x.seed}, ${botName(me)} would charge ${price(game.grid[d.would])} next period. ${d.forced == null ? "There is no lower price on the grid" : `The price it would be forced to, ${price(game.grid[d.forced])}, is not below that`}, so there is no cut to test. ${x.session.learning ? "Try another run, the other bot or another kind of cut." : "An undercutter is already at its best reply."}`));
    return;
  }
  const series = (key, k) => d.path.map((p) => [p.tau, p[key][k]]);
  cutChart.update({
    title: `Seed ${x.seed}: ${botName(me)} is made to charge ${price(game.grid[d.forced])} in period 1`,
    subtitle: "Solid lines: prices after the cut. Dashed lines: the same periods had there been no cut.",
    label: "Line chart of both bots' prices in the periods after a forced price cut, against their prices without it",
    x: { label: "Period (the cut is in period 1)", domain: [0, 20], ticks: 10, format: (v) => (Number.isInteger(v) ? String(v) : "") },
    y: { label: "Price", domain: [1.4, 2], format: (v) => fmt.num(v, 1) },
    series: [
      { name: `Bot ${me + 1} without the cut`, type: "line", color: "#8a94a3", dash: true, width: 1.5, data: series("base", me) },
      { name: `Bot ${rival + 1} without the cut`, type: "line", color: "#16233b", dash: true, width: 1.5, data: series("base", rival) },
      { name: `Bot ${me + 1}, cut in period 1`, type: "line", color: 1, width: 2.5, data: series("dev", me) },
      { name: `Bot ${rival + 1}`, type: "line", color: 0, width: 2.5, data: series("dev", rival) },
    ],
    marks: [{ type: "hline", y: game.pN, text: `one-shot Nash ${fmt.num(game.pN, 3)}` }],
  });
  const back = d.merged != null ? `Both bots were back on their old path of prices in period ${d.merged}.` : d.sameCycle ? "Prices went back to the same cycle as before, though out of step with it." : "Prices did not return: the cut moved the bots to a different pattern for good.";
  const first = `${botName(me)[0].toUpperCase()}${botName(me).slice(1)} would have charged ${price(game.grid[d.would])} and was made to charge ${price(game.grid[d.forced])}. In that period it earned ${Math.abs(d.firstGain) < 0.0005 ? "the same as it would have, to three decimal places" : `${fmt.num(Math.abs(d.firstGain), 3)} ${d.firstGain > 0 ? "more" : "less"} than it would have`}.`;
  const answer = d.punished ? `Next period ${botName(rival)} charged ${price(d.rivalAfter)} where it would have charged ${price(d.rivalBefore)}: it answered the cut with a cut of its own.` : `Next period ${botName(rival)} charged ${price(d.rivalAfter)}, ${d.rivalAfter === d.rivalBefore ? "exactly what it would have charged anyway" : "which is not below what it would have charged anyway"}: it did not retaliate.`;
  const total = tiny(d.gain) ? `Counting every later period at its discounted value, the cut made no difference to ${botName(me)}'s profit, to three decimal places.` : d.gain < 0 ? `Counting every later period at its discounted value, the cut cost ${botName(me)} ${fmt.num(-d.gain, 3)}. It did not pay.` : d.gain > 0 ? `Counting every later period at its discounted value, the cut earned ${botName(me)} ${fmt.num(d.gain, 3)}. It paid.` : `Over the whole episode the cut made no difference to ${botName(me)}'s discounted profit.`;
  cutText.replaceChildren(note(d.gain < 0 && !tiny(d.gain) ? "warn" : "", [first, answer, back, total].join(" ")));
}

function drawRuns() {
  // The table is rebuilt whenever a run finishes. If the keyboard is on one of its buttons, put it back afterwards.
  const held = runsBox.contains(document.activeElement) ? document.activeElement.dataset.seed : null;
  drawRunsTable();
  if (held != null) (runsBox.querySelector(`button[data-seed="${held}"]`) ?? runBtn).focus();
}
function drawRunsTable() {
  if (!done.length) { runsBox.replaceChildren(el("p", { class: "small muted", text: "No run has finished yet." })); return; }
  const who = botName(state.cutBot);
  runsBox.replaceChildren(listTable({
    caption: `${plural(done.length, "run")}${shown && done.length < shown.runs ? ` of ${shown.runs}` : ""}. Prices are long-run averages once exploring has stopped. "Show" puts a run in the two charts above.`,
    columns: [
      { label: "Run", get: (x) => `Seed ${x.seed}` },
      { label: "Periods played", num: true, get: (x) => `${fmt.int(x.session.t)}${x.session.settled ? "" : " (not settled)"}` },
      { label: "Bot 1 price", num: true, get: (x) => price(x.lim.prices[0]) },
      { label: "Bot 2 price", num: true, get: (x) => price(x.lim.prices[1]) },
      { label: "Pattern", get: (x) => (x.lim.length === 1 ? "steady" : `cycle of ${x.lim.length}`) },
      { label: "Profit gain", num: true, get: (x) => pct(x.lim.gain) },
      { label: `Price cut by ${who}`, get: (x) => { const d = cutOf(x); return !d.cut ? "no cut to test" : `${d.punished ? "answered" : "not answered"}; ${tiny(d.gain) ? "no difference" : d.gain < 0 ? `lost ${fmt.num(-d.gain, 3)}` : `gained ${fmt.num(d.gain, 3)}`}`; } },
      // The visible word is short so that the table fits its column; the name read out says which run.
      { label: "Charts", get: (x) => { const b = button("Show", () => { state.inspect = x.seed; chosenByVisitor = true; drawLearning(); drawCut(); drawRuns(); }, { small: true }); b.dataset.seed = x.seed; b.setAttribute("aria-label", `Show seed ${x.seed} in the charts`); b.setAttribute("aria-pressed", String(x.seed === state.inspect)); return b; } },
    ],
    rows: done,
  }));
}

drawAll();
start();
