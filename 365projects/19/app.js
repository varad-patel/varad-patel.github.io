// Day 19: Sleeping Beauty Simulator. Interface.
import { $, el, fmt, mount, slider, numberField, button, stat, note, table, chart, rng, randomSeed, reducedMotion } from "../kit/kit.js";
import { exact, newRun, runExperiment, add, commit, simulate, shares, betExact, betTally, brier, brierExact, brierTally } from "./logic.js";

mount();

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const START = 1000; // experiments run on load and whenever the set-up changes
const MAX_SEED = 4294967295;
const state = { p: 0.5, k: 2, seed: 19, price: 0.4, credence: 0.5 };
const setup = () => ({ p: state.p, k: state.k });
const dayName = (i) => (state.k <= 7 ? WEEK[i] : `Day ${i + 1}`);
const price3 = (v) => fmt.num(v, 3);
const pct1 = (v) => fmt.pct(v, 1);
const same = (a, b) => Math.abs(a - b) < 1e-9;

let r;          // the seeded generator for part 1
let run;        // { tally, history, recent } for part 1
let last = null; // the latest finished experiment
let anim = null; // a single experiment being played out: { timers, finish }
let me;         // part 3: { r, tally, text }

// Each part starts with a heading that the jump links at the top of the tool point to.
const PARTS = [["sb-run", "1. Run the experiment"], ["sb-bets", "2. Attach a bet to each count"], ["sb-beauty", "3. Be Beauty"]];
const head = (i, text) => el("div", { class: "sb-head" }, el("h2", { id: PARTS[i][0], text: PARTS[i][1] }), el("p", { class: "small muted", text }));

/* ================================================= 1. the experiment */

const pSlider = slider({
  label: "Chance the coin lands heads", min: 0.05, max: 0.95, step: 0.05, value: state.p, format: (v) => fmt.pct(v, 0),
  onInput: (v) => { state.p = v; restart(); },
});
const kSlider = slider({
  label: "Awakenings if it lands tails", min: 1, max: 10, step: 1, value: state.k, format: (v) => fmt.int(v),
  hint: "Heads always means one awakening. Changing the set-up starts again with 1,000 fresh experiments.",
  onInput: (v) => { state.k = v; restart(); },
});
const preset = (label, p, k) => button(label, () => { state.p = p; state.k = k; pSlider.value = p; kSlider.value = k; restart(); }, { small: true });
const seedField = numberField({ label: "Seed", min: 0, max: MAX_SEED, step: 1, value: state.seed, hint: "The same seed replays the same coin tosses." });
const seedMsg = el("div");
seedField.input.addEventListener("input", () => {
  const v = seedField.value;
  if (!Number.isInteger(v)) { seedMsg.replaceChildren(note("bad", `The seed must be a whole number from 0 to ${fmt.int(MAX_SEED)}.`)); return; }
  seedMsg.replaceChildren();
  state.seed = v;
  restart();
});

const coin = el("div", { class: "sb-coin", "aria-hidden": "true", text: "?" });
const days = el("div", { class: "sb-days" });
const caption = el("p", { class: "sb-cap small" });
// Announced to screen readers once per run. The caption changes at every step of the animation, which is too often.
const said = el("p", { class: "sr-only", role: "status" });
const tape = el("div", { class: "sb-tape", role: "img" });
const tapeCap = el("p", { class: "small muted" });
const sN = stat("Experiments run");
const sE = stat("Heads, counting experiments");
const sA = stat("Heads, counting awakenings");
const formulaBox = el("div", { class: "sb-tbl" });
const convBox = el("div");

const part1 = el("div", { class: "tool-grid sb-part" },
  el("div", { class: "controls" },
    head(0, "On Sunday Beauty is put to sleep and a coin is tossed. Each time she is woken she is asked how likely it is that the coin landed heads, then her memory of the waking is erased."),
    pSlider.el, kSlider.el,
    el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
      el("div", { class: "row" }, preset("Standard problem", 0.5, 2), preset("Ten wakings", 0.5, 10), preset("One waking", 0.5, 1), preset("Coin favours heads", 0.8, 2))),
    el("div", { class: "row" },
      button("Run 1, animated", runOne, { primary: true }),
      button("Run 1,000", () => runMany(1000)),
      button("Run 100,000", () => runMany(100000)),
      button("Reset to zero", reset)),
    seedField.el, seedMsg,
    el("div", { class: "row" }, button("New seed", () => { state.seed = randomSeed(); seedField.value = state.seed; seedMsg.replaceChildren(); restart(); }, { small: true }))),
  el("div", { class: "out" },
    el("div", { class: "panel sb-stage" }, coin, days, caption), said,
    el("div", {}, el("p", { class: "chart-title", text: "Two ways to count the same experiments" }), tape,
      el("div", { class: "chart-legend sb-key" },
        el("span", {}, el("i", { class: "sb-box" }), "one experiment"),
        el("span", {}, el("i", { style: { background: "var(--ink)" } }), "an awakening after heads"),
        el("span", {}, el("i", { style: { background: "var(--rule)" } }), "an awakening after tails")),
      tapeCap),
    el("div", { class: "stats" }, sN.el, sE.el, sA.el),
    formulaBox, convBox));

const conv = chart(convBox, {
  title: "The two tallies as experiments accumulate",
  subtitle: "Same coin tosses, counted two ways. The dashed lines are the exact long-run values.",
  label: "Line chart of the share of heads, counted by experiment and by awakening, against the number of experiments",
  height: 300,
  x: { label: "Experiments run (log scale)", type: "log", format: (v) => fmt.compact(v) },
  y: { label: "Share that are heads", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
  series: [],
  empty: "No experiments yet. Run one.",
});

function drawStage(e, step) {
  const tossing = step === "toss";
  coin.textContent = !e || tossing ? "?" : e.heads ? "H" : "T";
  coin.classList.toggle("spin", tossing);
  days.replaceChildren(...Array.from({ length: state.k }, (_, i) => {
    let cls = "", text = "–";
    if (e && !tossing) {
      if (i >= e.awakenings) { cls = " slept"; text = "sleeps through"; }
      else if (step === "end" || i < step) { cls = " past"; text = "woken"; }
      else if (i === step) { cls = " awake"; text = "awake now"; }
    }
    return el("div", { class: `sb-day${cls}` }, el("b", { text: dayName(i) }), el("span", { text }));
  }));
  if (!e) caption.textContent = "Nothing has been run yet. Press “Run 1, animated” to toss the coin.";
  else if (tossing) caption.textContent = "Sunday night: Beauty is put to sleep and the coin is tossed.";
  else if (step === "end") {
    caption.textContent = e.heads
      ? "Heads. This experiment adds 1 to the experiments and 1 to the awakenings, and both count as heads."
      : e.awakenings === 1
        ? "Tails. This experiment adds 1 to the experiments and 1 to the awakenings, and neither counts as heads."
        : `Tails. This experiment adds 1 to the experiments but ${e.awakenings} to the awakenings, and none of them counts as heads.`;
  } else caption.textContent = `${dayName(step)}: Beauty is woken and asked how likely it is that the coin landed heads. She cannot tell this waking from any other.`;
}

function finishAnimation() { if (anim) { anim.timers.forEach(clearTimeout); anim.finish(); } }
function dropAnimation() { if (anim) { anim.timers.forEach(clearTimeout); anim = null; } }

function runOne() {
  finishAnimation();
  const e = runExperiment(r, setup());
  const finish = () => { anim = null; last = e; commit(run, e); drawStage(e, "end"); renderRun(); };
  if (reducedMotion()) { finish(); return; }
  drawStage(e, "toss");
  const gap = e.awakenings <= 3 ? 650 : 300;
  const timers = [];
  for (let i = 0; i < e.awakenings; i++) timers.push(setTimeout(() => drawStage(e, i), 700 + i * gap));
  timers.push(setTimeout(finish, 700 + e.awakenings * gap));
  anim = { timers, finish };
}
function runMany(n) {
  finishAnimation();
  simulate(r, setup(), n, run);
  last = run.recent.at(-1);
  drawStage(last, "end");
  renderRun();
}
function reset() {
  dropAnimation();
  r = rng(state.seed);
  run = newRun();
  last = null;
  drawStage(null);
  renderRun();
}
/** New set-up or seed: start both the main run and the "be Beauty" scores again. */
function restart() {
  dropAnimation();
  r = rng(state.seed);
  run = simulate(r, setup(), START);
  last = run.recent.at(-1);
  me = { r: rng((state.seed + 1) >>> 0), tally: newRun().tally, text: "" };
  drawStage(last, "end");
  renderRun();
  renderBeauty();
}

function renderRun() {
  const t = run.tally, s = shares(t), x = exact(setup());
  const n = t.experiments;
  sN.set(fmt.int(n), n ? `${fmt.int(t.awakenings)} awakenings, ${fmt.num(t.awakenings / n, 3)} each` : "run one to begin");
  sE.set(pct1(s.byExperiment), n ? `${fmt.int(t.heads)} of ${fmt.int(n)}; exact ${pct1(x.byExperiment)}` : `exact ${pct1(x.byExperiment)}`);
  sA.set(pct1(s.byAwakening), n ? `${fmt.int(t.headsAwakenings)} of ${fmt.int(t.awakenings)}; exact ${pct1(x.byAwakening)}` : `exact ${pct1(x.byAwakening)}`);
  said.textContent = n
    ? `${fmt.int(n)} ${n === 1 ? "experiment" : "experiments"} run, the latest ${last.heads ? "heads" : "tails"}. Heads in ${pct1(s.byExperiment)} of experiments and ${pct1(s.byAwakening)} of awakenings.`
    : "No experiments yet.";

  // The tape: one outlined box per experiment, one square per awakening.
  const rec = run.recent;
  const heads = rec.filter((e) => e.heads).length;
  const squares = rec.reduce((sum, e) => sum + e.awakenings, 0);
  tape.replaceChildren(...rec.map((e) => el("span", { class: e.heads ? "h" : "t" }, Array.from({ length: e.awakenings }, () => el("i")))));
  tape.setAttribute("aria-label", rec.length ? `The latest ${rec.length} experiments: ${heads} heads, ${squares} awakenings in all` : "No experiments yet");
  tapeCap.textContent = rec.length
    ? `The latest ${rec.length} ${rec.length === 1 ? "experiment" : "experiments"}. Count boxes: ${heads} of ${rec.length} are heads (${fmt.pct(heads / rec.length, 0)}). Count squares: ${heads} of ${squares} are heads (${fmt.pct(heads / squares, 0)}).`
    : "Each experiment will appear here as a box holding one square per awakening.";

  const what = (text, formula, who) => el("span", {}, text, el("span", { class: "sb-f" }, el("span", { class: "mono", text: formula }), who ? `, ${who}` : ""));
  formulaBox.replaceChildren(table({
    caption: `Exact values with p = ${fmt.sig(state.p, 2)} (chance of heads) and k = ${state.k} (awakenings after tails)`,
    columns: [{ key: "q", label: "What is counted" }, { key: "x", label: "Exact", num: true }, { key: "s", label: "This run", num: true }],
    rows: [
      { q: what("Share of experiments in which the coin landed heads", "p", "the halfer's number"), x: pct1(x.byExperiment), s: pct1(s.byExperiment) },
      { q: what("Share of awakenings that come after heads", "p / (p + k(1 − p))", "the thirder's number"), x: pct1(x.byAwakening), s: pct1(s.byAwakening) },
      { q: what("Awakenings per experiment", "p + k(1 − p)"), x: fmt.num(x.awakenings, 3), s: n ? fmt.num(t.awakenings / n, 3) : "–" },
    ],
  }));

  conv.update({
    series: [
      { name: "Counting experiments", data: run.history.map((h) => [h[0], h[1]]), color: 0 },
      { name: "Counting awakenings", data: run.history.map((h) => [h[0], h[2]]), color: 1 },
    ],
    marks: !n ? [] : same(x.byExperiment, x.byAwakening)
      ? [{ type: "hline", y: x.byExperiment, text: `both ${pct1(x.byExperiment)}` }]
      : [{ type: "hline", y: x.byExperiment, text: pct1(x.byExperiment) }, { type: "hline", y: x.byAwakening, text: pct1(x.byAwakening) }],
  });
  renderBets();
}

/* ======================================================== 2. the bets */

const priceSlider = slider({
  label: "Price of the ticket", min: 0.01, max: 0.99, step: 0.001, value: state.price, format: price3,
  hint: "The ticket pays 1 if the coin landed heads and nothing if it landed tails.",
  onInput: (v) => { state.price = v; renderBets(); },
});
const setPrice = (v) => { state.price = v; priceSlider.value = v; renderBets(); };
const betTableBox = el("div", { class: "sb-tbl" });
const betMsg = el("div", { role: "status" });
const betChartBox = el("div");

const part2 = el("div", { class: "tool-grid sb-part" },
  el("div", { class: "controls" },
    head(1, "Beauty is offered a ticket on heads. Sell it to her once per experiment, or at every awakening: the experiments above are the same, only the number of tickets changes."),
    priceSlider.el,
    el("div", { class: "row" },
      button("Halfer's price", () => setPrice(exact(setup()).byExperiment), { small: true }),
      button("Thirder's price", () => setPrice(exact(setup()).byAwakening), { small: true }),
      button("0.400", () => setPrice(0.4), { small: true }))),
  el("div", { class: "out" }, betTableBox, betMsg, betChartBox));

const betChart = chart(betChartBox, {
  title: "Expected profit per experiment at each ticket price",
  subtitle: "Exact. The dot on each line marks the price where that bet breaks even.",
  label: "Line chart of Beauty's expected profit per experiment against the ticket price, for each way of selling the ticket",
  height: 280,
  x: { label: "Ticket price", domain: [0, 1], format: (v) => fmt.num(v, 2) },
  y: { label: "Expected profit per experiment", format: (v) => fmt.signed(v, 2) },
  series: [],
});

function renderBets() {
  const x = betExact(setup(), state.price), b = betTally(run.tally, state.price), t = run.tally, n = t.experiments;
  const per = (v) => (n ? fmt.signed(v / n, 3) : "–");
  betTableBox.replaceChildren(table({
    caption: `Beauty buys the ticket at ${price3(state.price)}, which is odds of ${fmt.num((1 - state.price) / state.price, 2)} to 1 against heads`,
    columns: [{ key: "q", label: "How the ticket is sold" }, { key: "once", label: "Once per experiment", num: true }, { key: "every", label: "At every awakening", num: true }],
    rows: [
      { q: "Tickets bought in this run", once: fmt.int(n), every: fmt.int(t.awakenings) },
      { q: "Profit in this run", once: n ? fmt.signed(b.once, 1) : "–", every: n ? fmt.signed(b.every, 1) : "–" },
      { q: "Profit per experiment, this run", once: per(b.once), every: per(b.every) },
      { q: "Profit per experiment, long run (exact)", once: fmt.signed(x.once, 3), every: fmt.signed(x.every, 3) },
      { q: "Price at which it breaks even", once: price3(x.breakEven.once), every: price3(x.breakEven.every) },
    ],
  }));

  const lo = x.breakEven.every, hi = x.breakEven.once;
  let verdict;
  if (same(lo, hi)) verdict = `With one awakening either way the two bets are the same bet. It breaks even at ${price3(hi)}.`;
  else if (same(state.price, hi)) verdict = `At ${price3(hi)}, the halfer's number, the once-per-experiment ticket breaks even exactly and the every-awakening ticket loses.`;
  else if (same(state.price, lo)) verdict = `At ${price3(lo)}, the thirder's number, the every-awakening ticket breaks even exactly and the once-per-experiment ticket makes money.`;
  else if (state.price < lo) verdict = `Below ${price3(lo)} the ticket is cheap enough to make money either way.`;
  else if (state.price > hi) verdict = `Above ${price3(hi)} the ticket loses money either way.`;
  else verdict = `Between ${price3(lo)} and ${price3(hi)} the same ticket makes money sold once per experiment and loses money sold at every awakening, because tails sells it ${state.k} times.`;
  betMsg.replaceChildren(note("", verdict));

  const A = exact(setup()).awakenings;
  const xs = Array.from({ length: 101 }, (_, i) => i / 100);
  betChart.update({
    series: [
      { name: `One ticket per experiment: breaks even at ${price3(hi)}`, data: xs.map((c) => [c, state.p - c]), color: 0 },
      { name: `One ticket at every awakening: breaks even at ${price3(lo)}`, data: xs.map((c) => [c, state.p - c * A]), color: 1 },
    ],
    marks: [
      { type: "vline", x: state.price, text: `price ${price3(state.price)}` },
      { type: "point", x: hi, y: 0 },
      ...(same(lo, hi) ? [] : [{ type: "point", x: lo, y: 0 }]),
    ],
  });
}

/* ==================================================== 3. be Beauty */

const credSlider = slider({
  label: "Your credence that the coin landed heads", min: 0, max: 1, step: 0.01, value: state.credence, format: (v) => fmt.pct(v, 0),
  hint: "You are penalised (answer − outcome)² each time you are scored, where the outcome is 1 for heads and 0 for tails. Lower is better.",
  onInput: (v) => { state.credence = v; renderBeauty(); },
});
const meMsg = el("div", { role: "status" });
const scoreBox = el("div", { class: "sb-tbl" });
const scoreMsg = el("div");
const scoreChartBox = el("div");

const part3 = el("div", { class: "tool-grid sb-part" },
  el("div", { class: "controls" },
    head(2, "You have just been woken. You do not know what day it is, or whether you have been woken before. Give your answer, then see how it scores when each experiment is scored once and when every awakening is scored."),
    credSlider.el,
    el("div", { class: "row" },
      button("Lock in and reveal", () => lockIn(1), { primary: true }),
      button("Same answer, 1,000 times", () => lockIn(1000)),
      button("Clear the scores", () => { me.tally = newRun().tally; me.text = ""; renderBeauty(); }, { small: true }))),
  el("div", { class: "out" }, meMsg, scoreBox, scoreMsg, scoreChartBox));

const scoreChart = chart(scoreChartBox, {
  title: "Expected penalty for each possible answer",
  subtitle: "Exact. The dot on each curve marks its lowest point: the best answer under that scoring.",
  label: "Line chart of the expected Brier penalty against the stated credence, scored once per experiment and at every awakening",
  height: 280,
  x: { label: "Credence in heads", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
  y: { label: "Expected penalty (lower is better)", format: (v) => fmt.num(v, 2), zero: true },
  series: [],
});

function lockIn(times) {
  const c = state.credence;
  let e;
  for (let i = 0; i < times; i++) { e = runExperiment(me.r, setup()); add(me.tally, e); }
  const pen = brier(c, e.heads);
  const sum = `(${fmt.num(c, 2)} − ${e.heads ? 1 : 0})² = ${fmt.num(pen, 3)}`;
  if (times > 1) me.text = `${fmt.int(times)} more experiments played. Move the slider to see how any other answer would have scored on the same coin tosses.`;
  else if (e.heads) me.text = `The coin landed heads, so that was your only awakening. Your penalty is ${sum}, and it counts once whichever way the scoring is done.`;
  else if (e.awakenings === 1) me.text = `The coin landed tails, and with this set-up tails also means one awakening. Your penalty is ${sum}, counted once either way.`;
  else me.text = `The coin landed tails. You were woken ${e.awakenings} times and, remembering nothing, gave the same answer each time. Each answer costs ${sum}. Scored once for the experiment, that is one penalty of ${fmt.num(pen, 3)}; scored at every awakening, it is ${e.awakenings} penalties of ${fmt.num(pen, 3)}.`;
  renderBeauty();
}

function renderBeauty() {
  const x = exact(setup()), t = me.tally, n = t.experiments;
  meMsg.replaceChildren(note(n ? "good" : "", me.text || "Set your credence and lock it in. The coin has already been tossed."));

  // One row per way of scoring; the lowest penalty in each row is in bold.
  const answers = [state.credence, x.halfer.waking, x.thirder.waking];
  const row = (q, values) => {
    const best = Math.min(...values);
    const [you, half, third] = values.map((v) => (v == null ? "–" : (v - best < 1e-12 ? el("strong", {}, fmt.num(v, 3), el("span", { class: "sr-only", text: " (lowest)" })) : fmt.num(v, 3))));
    return { q, you, half, third };
  };
  const sim = answers.map((a) => brierTally(t, a)), long = answers.map((a) => brierExact(setup(), a));
  scoreBox.replaceChildren(table({
    caption: n ? `Average penalty over ${fmt.int(n)} ${n === 1 ? "experiment" : "experiments"} and ${fmt.int(t.awakenings)} ${t.awakenings === 1 ? "awakening" : "awakenings"} (lowest in bold)` : "Average penalty (nothing played yet, lowest in bold)",
    columns: [{ key: "q", label: "How the answer is scored" }, { key: "you", label: `You: ${fmt.pct(state.credence, 0)}`, num: true }, { key: "half", label: `Halfer: ${pct1(x.halfer.waking)}`, num: true }, { key: "third", label: `Thirder: ${pct1(x.thirder.waking)}`, num: true }],
    rows: [
      row("Once per experiment, this run", sim.map((v) => v.perExperiment)),
      row("Once per experiment, long run (exact)", long.map((v) => v.perExperiment)),
      row("At every awakening, this run", sim.map((v) => v.perAwakening)),
      row("At every awakening, long run (exact)", long.map((v) => v.perAwakening)),
    ],
  }));
  scoreMsg.replaceChildren(note("", same(x.halfer.waking, x.thirder.waking)
    ? `With one awakening either way there is nothing to disagree about: the best answer is ${pct1(x.halfer.waking)} under both scorings.`
    : `Because you cannot tell one waking from another, your answer is the same every time, so each column is one fixed answer scored on every experiment played so far, and moving the slider rescores your column on the same coin tosses. Each figure is an average: over experiments in the first two rows, over awakenings in the last two. In the long run the lowest penalty goes to ${pct1(x.halfer.waking)} when each experiment is scored once, and to ${pct1(x.thirder.waking)} when every awakening is scored.`));

  const cs = Array.from({ length: 101 }, (_, i) => i / 100);
  const curve = cs.map((c) => [c, brierExact(setup(), c)]);
  scoreChart.update({
    series: [
      { name: `Scored once per experiment: lowest at ${pct1(x.halfer.waking)}`, data: curve.map(([c, s]) => [c, s.perExperiment]), color: 0 },
      { name: `Scored at every awakening: lowest at ${pct1(x.thirder.waking)}`, data: curve.map(([c, s]) => [c, s.perAwakening]), color: 1 },
    ],
    marks: [
      { type: "vline", x: state.credence, text: `your answer ${fmt.pct(state.credence, 0)}` },
      { type: "point", x: x.halfer.waking, y: brierExact(setup(), x.halfer.waking).perExperiment },
      ...(same(x.halfer.waking, x.thirder.waking) ? [] : [{ type: "point", x: x.thirder.waking, y: brierExact(setup(), x.thirder.waking).perAwakening }]),
    ],
  });
}

/* ============================================================== start */

// The tool is three screens long on a phone, so it opens with links to its parts.
$("#app").append(
  el("nav", { class: "sb-jump small", "aria-label": "Parts of the tool" }, el("span", { class: "muted", text: "Jump to" }), PARTS.map(([id, title]) => el("a", { href: `#${id}`, text: title }))),
  part1, part2, part3);
restart();
