// Day 18: Newcomb's Problem Calculator. Interface.
import { $, el, fmt, debounce, mount, slider, numberField, select, button, stat, note, table, chart } from "../kit/kit.js";
import { PRESETS, validate, evidential, payoffTable, simulator, playRound, tally } from "./logic.js";

mount();

const state = { p: 0.9, M: PRESETS[0].M, K: PRESETS[0].K, preset: PRESETS[0].key, plays: 100000, seed: 18, rounds: [], notice: "" };

// Whole dollars where the amount is whole or large, cents otherwise: $1.80 against $2.20 must not both read "$2".
const cents = (x) => { const c = Math.round(x * 100) / 100; return Number.isInteger(c) || Math.abs(c) >= 1000 ? fmt.int(c) : fmt.num(c, 2); };
const money = (x) => `$${Math.abs(x) >= 1e9 ? fmt.compact(x) : cents(x)}`;
const axisMoney = (x) => `$${Math.abs(x) >= 1e6 ? fmt.compact(x) : cents(x)}`; // short enough for a tick label
const plain = (x) => (Number.isInteger(x) ? fmt.int(x) : fmt.sig(x, 8));         // an amount inside a written-out sum
const pct = (x, d = 0) => fmt.pct(x, d);
const pct2 = (x) => fmt.pct(x, Number.isInteger(Math.round(x * 1e4) / 100) ? 0 : 2); // 50.05%, but 75% and not 75.00%
const words = { one: "one box", two: "both boxes" };
// replaceChildren that, like el(), accepts arrays and skips empty values.
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

/* -------------------------------------------------------------------- controls */
const accuracy = slider({
  label: "Predictor's accuracy", min: 0, max: 1, step: 0.01, value: state.p, format: (v) => pct(v),
  hint: "How often the predictor is right about a chooser, whichever way they choose. 50% is a coin toss; Nozick's predictor is almost never wrong.",
  onInput: (v) => { state.p = v; refresh(); },
});
const prize = numberField({ label: "In the opaque box, if one box was predicted (M)", min: 0, value: state.M });
const clear = numberField({ label: "Always in the clear box (K)", min: 0, value: state.K });
const CHANGED = "The amounts changed, so the game has started again. ";
prize.input.addEventListener("input", () => { state.M = prize.value; state.preset = ""; restart(CHANGED); refresh(); });
clear.input.addEventListener("input", () => { state.K = clear.value; state.preset = ""; restart(CHANGED); refresh(); });
const presetButtons = PRESETS.map((p) => {
  const b = button(p.label, () => { state.M = p.M; state.K = p.K; state.preset = p.key; prize.value = p.M; clear.value = p.K; restart(CHANGED); refresh(); }, { small: true });
  b.dataset.preset = p.key;
  return b;
});
const blurb = el("div", { class: "hint" });
const controls = el("div", { class: "controls" }, accuracy.el, prize.el, clear.el,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Try these amounts" })), el("div", { class: "row" }, presetButtons), blurb));

/* --------------------------------------------------------------------- outputs */
const verdict = el("p", { class: "verdict", role: "status" });
const problems = el("div", { class: "stack" });
const sOne = stat("One box, evidential value");
const sTwo = stat("Both boxes, evidential value");
const sLine = stat("One box wins above");
const sCausal = stat("Both boxes, causal gain");
const valueBox = el("div");
const mapBox = el("div");
const evidentialBox = el("div", { class: "panel stack" });
const causalBox = el("div", { class: "panel stack" });

// Simulation.
const playsPick = select({
  label: "Plays for each strategy", value: state.plays,
  options: [1000, 10000, 100000, 1000000].map((n) => ({ value: n, label: fmt.int(n) })),
  onChange: (v) => { state.plays = Number(v); simAsked = true; runSimulation(); },
});
let simAsked = false; // the visitor used one of the simulation's own controls, so the result is worth announcing
const simStatus = el("p", { class: "sr-only", role: "status" });
const seedText = el("span", { class: "small muted" });
const simTable = el("div", { class: "sim-table" });
const simNote = el("div");
const simChartBox = el("div");

// Play it yourself.
const takeOne = button("Take only the opaque box", () => play("one"), { primary: true });
const takeTwo = button("Take both boxes", () => play("two"), { primary: true });
const reveal = el("p", { class: "reveal", role: "status" });
const gOne = stat("Rounds played");
const gAcc = stat("Predictor's accuracy");
const gMean = stat("Your average winnings");
const gWithOne = stat("When you took one box");
const gWithTwo = stat("When you took both");
const gameNote = el("div");
const gameChartBox = el("div");
const gameTable = el("div");

const results = el("div", { class: "stack-wide" },
  el("div", { class: "tool-grid" }, controls,
    el("div", { class: "out" }, verdict, el("div", { class: "stats" }, sOne.el, sTwo.el, sLine.el, sCausal.el), valueBox)),
  el("div", { class: "block" },
    el("h3", { text: "Two ways to do the sum" }),
    el("p", { class: "small muted", text: "Both sums are correct arithmetic. They differ in one place: whether your choice tells you anything about what is already in the box." }),
    el("div", { class: "grid2" }, evidentialBox, causalBox)),
  el("div", { class: "block" },
    el("h3", { text: "Where one box wins, for any pair of amounts" }),
    mapBox),
  el("div", { class: "block" },
    el("h3", { text: "Many plays against this predictor" }),
    el("p", { class: "small muted", text: "Two crowds face the predictor: one of people who always take one box, one of people who always take both. It is right about each person with the accuracy set above." }),
    el("div", { class: "row sim-row" }, playsPick.el, button("Run again with a new seed", () => { state.seed += 1; simAsked = true; runSimulation(); }), seedText, simStatus),
    simTable, simNote, simChartBox),
  el("div", { class: "block" },
    el("h3", { text: "Play it yourself against a predictor that learns you" }),
    el("p", { class: "small muted", text: "This predictor has no special powers. Before each round it looks at your earlier choices, guesses your next one from the patterns in them, and fills or empties the opaque box. Then you choose. It follows a fixed rule with no chance in it, set out under “How it works”, so it can be beaten: work out what it will guess, do the opposite every round, and it will never be right." }),
    el("div", { class: "row" }, takeOne, takeTwo, button("Start again", () => { restart(); refresh(); })),
    reveal,
    el("div", { class: "stats" }, gOne.el, gAcc.el, gMean.el, gWithOne.el, gWithTwo.el),
    gameNote, gameChartBox, gameTable));

$("#app").append(problems, results);

const valueChart = chart(valueBox, { series: [], height: 320 });
const mapChart = chart(mapBox, { series: [], height: 300 });
const simChart = chart(simChartBox, { series: [], height: 280 });
const gameChart = chart(gameChartBox, { series: [], height: 240 });

/* ------------------------------------------------------------------ simulation */
let lastRun = "", simToken = 0;
function runSimulation() {
  if (validate(state).length) return;
  const { p, M, K, plays, seed } = state;
  const key = [p, M, K, plays, seed].join();
  if (key === lastRun) return; // nothing it depends on has changed
  lastRun = key;
  // Run in slices of about 25 ms so that a million plays never freeze the page; a newer run cancels this one.
  const token = ++simToken;
  const sim = simulator({ p, M, K, plays, seed });
  const slice = () => {
    if (token !== simToken) return;
    const t0 = performance.now();
    while (!sim.run(20000) && performance.now() - t0 < 25);
    if (sim.done < sim.plays) { seedText.textContent = `Simulating: ${fmt.int(sim.done)} of ${fmt.int(sim.plays)} plays…`; setTimeout(slice, 0); return; }
    showSimulation(sim.result(), { p, M, K, seed });
  };
  slice();
}
function showSimulation(s, { p, M, K, seed }) {
  const ev = evidential(p, M, K);
  seedText.textContent = `Seed ${seed}. The same seed and settings always give the same plays.`;
  // One column for each crowd, so the table still fits on a phone.
  const share = (count, r) => `${fmt.int(count)} (${pct(count / r.plays, 1)})`;
  fill(simTable, table({
    caption: `${fmt.int(s.plays)} plays for each strategy`,
    columns: [{ key: "what", label: "Across the plays" }, { key: "one", label: "Always one box", num: true }, { key: "two", label: "Always both boxes", num: true }],
    rows: [
      { what: "Box was full", one: share(s.one.full, s.one), two: share(s.two.full, s.two) },
      { what: "Box was empty", one: share(s.one.empty, s.one), two: share(s.two.empty, s.two) },
      { what: el("strong", { text: "Average winnings" }), one: el("strong", { text: money(s.one.mean) }), two: el("strong", { text: money(s.two.mean) }) },
      { what: "What the evidential formula says", one: money(ev.one), two: money(ev.two) },
      { what: "Average had each switched, with the same box", one: money(s.one.switched), two: money(s.two.switched) },
    ],
  }));
  simStatus.textContent = simAsked ? `${fmt.int(s.plays)} plays run with seed ${seed}: one-boxers averaged ${money(s.one.mean)}, two-boxers ${money(s.two.mean)}.` : "";
  simAsked = false;
  const richer = s.one.mean > s.two.mean ? "the one-boxers went home richer" : s.two.mean > s.one.mean ? "the two-boxers went home richer" : "the two crowds finished level";
  fill(simNote, note("",
    el("strong", { text: "Two true readings of one table. " }),
    `Across the plays, ${richer}: ${money(s.one.mean)} a head for one box against ${money(s.two.mean)} for both. That comparison between the crowds is what the evidential reasoner goes by. `,
    `Now look at the last row. Every one-boxer left exactly ${money(K)} on the table, and every two-boxer who had switched would have won ${money(K)} less, because switching could not have changed what was in the box. That comparison within each box is what the causal reasoner goes by. The simulation agrees with both.`));
  simChart.update({
    title: "Average winnings as the plays accumulate",
    subtitle: "The running averages settle on the two evidential values. Dashed lines mark them.",
    label: "Line chart of the running average winnings of one-boxers and two-boxers",
    x: { label: "Plays so far (log scale)", type: "log", format: fmt.compact },
    y: { label: "Average winnings", format: axisMoney, zero: true },
    series: [
      { name: "Always one box", type: "line", color: 0, data: s.trace.map((t) => [t.n, t.one]) },
      { name: "Always both boxes", type: "line", color: 1, data: s.trace.map((t) => [t.n, t.two]) },
    ],
    marks: [{ type: "hline", y: ev.one }, { type: "hline", y: ev.two }],
  });
}
const simulateSoon = debounce(runSimulation, 160);

/* ------------------------------------------------------------ play it yourself */
function restart(notice = "") { state.notice = state.rounds.length ? notice : state.notice; state.rounds = []; reveal.textContent = ""; }
function play(choice) {
  if (validate(state).length) return;
  const round = playRound(state.rounds, choice, state.M, state.K);
  state.rounds.push(round);
  state.notice = "";
  reveal.textContent = `Round ${state.rounds.length}. It predicted ${words[round.predicted]}, so the opaque box was ${round.full ? "full" : "empty"}. You took ${words[choice]} and won ${money(round.won)}. `
    + (round.correct ? "It read you correctly." : "It got you wrong.");
  drawGame();
}
function drawGame() {
  const { M, K } = state;
  const t = tally(state.rounds);
  const line = evidential(0.5, M, K).threshold;
  if (!t.rounds) reveal.textContent = state.notice + "No rounds yet. The boxes are in front of you: the clear one shows " + money(K) + ", and the opaque one holds " + money(M) + " or nothing.";
  gOne.set(fmt.int(t.rounds), t.rounds ? `${t.one.rounds} with one box, ${t.two.rounds} with both` : "choose a box to begin");
  gAcc.set(t.rounds ? pct(t.accuracy) : "–", t.rounds ? `right ${t.hits} times out of ${t.rounds}` : "nothing to go on yet");
  gMean.set(t.rounds ? money(t.mean) : "–", t.rounds ? `${money(t.total)} in all` : "");
  gWithOne.set(t.one.rounds ? money(t.one.mean) : "–", t.one.rounds ? `average over ${t.one.rounds} ${t.one.rounds === 1 ? "round" : "rounds"}` : "not tried yet");
  gWithTwo.set(t.two.rounds ? money(t.two.mean) : "–", t.two.rounds ? `average over ${t.two.rounds} ${t.two.rounds === 1 ? "round" : "rounds"}` : "not tried yet");
  fill(gameNote, t.rounds < 5
    ? note("", "Play a few rounds. Try to win as much as you can, then try to be unpredictable, and watch what happens to its accuracy.")
    : [note(t.accuracy > line ? "good" : "warn",
      `It has been right ${pct(t.accuracy)} of the time. On the evidential sum, one box needs more than ${pct2(line)}${line > 1 ? ", which no predictor can reach" : ""}: at this accuracy it favours ${t.accuracy > line ? "one box" : "both boxes"}. `,
      "One caution. This is a repeated game, and what you do now changes its later guesses, so here even a causal reasoner has a reason to build a one-box record. The real problem is played once, and that reason is gone."),
    t.rounds >= 8 && t.accuracy <= 0.3 ? note("", el("strong", { text: "You have beaten it. " }),
      "A score this far below a coin toss is itself a pattern: you are doing the opposite of what your record suggests, and this simple rule never checks its own score. A predictor that did would reverse its guesses and be right most of the time. So the low score shows the limits of this particular predictor. It is not a way round Newcomb's problem, in which the predictor's accuracy is given.") : null]);
  gameChartBox.hidden = !t.rounds;
  gameChart.update({
    title: "The predictor's running accuracy",
    label: "Line chart of the share of rounds the learning predictor has got right",
    x: { label: "Round", domain: [1, Math.max(10, t.rounds)], format: (v) => (Number.isInteger(v) ? fmt.int(v) : "") },
    y: { label: "Share of rounds predicted correctly", domain: [0, 1], format: (v) => pct(v) },
    series: t.rounds ? [{ name: "Running accuracy", type: "line", color: 0, data: t.running.map((a, i) => [i + 1, a]) }] : [],
    marks: line <= 1 ? [{ type: "hline", y: line, text: `one box wins above ${pct2(line)}` }] : [],
    legend: false,
  });
  fill(gameTable, t.rounds ? table({
    caption: t.rounds > 8 ? "The last 8 rounds, newest first" : "Rounds so far, newest first",
    columns: [{ key: "n", label: "Round", num: true }, { key: "pred", label: "It predicted" }, { key: "box", label: "Opaque box" }, { key: "you", label: "You took" }, { key: "won", label: "You won", num: true }],
    rows: state.rounds.map((r, i) => ({ n: i + 1, pred: words[r.predicted], box: r.full ? "full" : "empty", you: words[r.choice], won: money(r.won) })).reverse().slice(0, 8),
  }) : null);
}

/* --------------------------------------------------------------------- refresh */
function refresh() {
  const { p, M, K } = state;
  const bad = validate(state);
  for (const b of presetButtons) { const on = b.dataset.preset === state.preset; b.classList.toggle("primary", on); b.setAttribute("aria-pressed", on); }
  blurb.textContent = PRESETS.find((x) => x.key === state.preset)?.blurb || "Your own amounts.";
  fill(problems, bad.map((text) => note("bad", text)));
  takeOne.disabled = takeTwo.disabled = bad.length > 0;
  for (const block of results.querySelectorAll(".block, .out")) block.hidden = bad.length > 0;
  if (bad.length) return;

  const ev = evidential(p, M, K);
  const never = ev.threshold > 1;
  verdict.textContent = `With a predictor that is right ${pct(p)} of the time, the evidential sum says take ${ev.best === "tie" ? "either: the two are level" : words[ev.best]} (${money(ev.one)} for one box against ${money(ev.two)} for both). `
    + (K > 0 ? `The causal sum says take both, as it does at every accuracy: whatever is already in the opaque box, taking both leaves you ${money(K)} better off.` : "With nothing in the clear box, the causal sum is indifferent.");
  sOne.set(money(ev.one), `${pct(p)} × ${money(M)}`);
  sTwo.set(money(ev.two), `${pct(1 - p)} × ${money(M)} + ${money(K)}`);
  sLine.set(never ? "Never" : pct2(ev.threshold), never ? "the clear box holds more than the prize" : ev.threshold === 1 ? "only a perfect predictor makes them level" : "accuracy at which the two are level");
  sCausal.set(`+${money(K)}`, "whatever is in the opaque box");

  // Expected value against accuracy, with the crossover.
  const top = Math.max(M, M + K);
  const yTop = top * 1.22;
  const label = (x, text, rowNo) => ({ type: "text", x, y: yTop, text, anchor: x > 0.6 ? "end" : "start", dx: x > 0.6 ? -5 : 5, dy: 13 + 16 * rowNo });
  const marks = [{ type: "vline", x: p }, label(p, `this predictor: ${pct(p)}`, 0)];
  if (!never) marks.push({ type: "vline", x: ev.threshold }, label(ev.threshold, `level at ${pct2(ev.threshold)}`, 1), { type: "point", x: ev.threshold, y: ev.threshold * M, r: 4.5 });
  const xs = Array.from({ length: 101 }, (_, i) => i / 100);
  valueChart.update({
    title: "Evidential expected value of each choice, by the predictor's accuracy",
    subtitle: never ? "The lines never cross: one box cannot catch up at any accuracy."
      : ev.threshold === 1 ? "The lines meet only at a perfect predictor, so one box never has the higher evidential value."
      : "To the right of the crossing, one box has the higher evidential value. The causal sum prefers both boxes everywhere on this chart.",
    label: "Line chart of the evidential expected value of one-boxing and two-boxing against predictor accuracy",
    x: { label: "Predictor's accuracy", domain: [0, 1], format: (v) => pct(v) },
    y: { label: "Expected winnings", format: axisMoney, domain: [0, yTop] },
    series: [
      { name: "Take one box: p × M", type: "line", color: 0, data: xs.map((x) => [x, x * M]) },
      { name: "Take both: (1 − p) × M + K", type: "line", color: 1, data: xs.map((x) => [x, (1 - x) * M + K]) },
    ],
    marks,
  });

  // The two sums, written out with the numbers.
  fill(evidentialBox,
    el("h3", { text: "The evidential sum" }),
    el("p", { class: "small", text: "Treat your choice as evidence. People who take one box nearly always find it full, so if you take one box, yours probably is." }),
    el("p", { class: "sum" }, "One box: ", el("span", { class: "mono", text: `${fmt.num(p, 2)} × ${plain(M)} = ` }), el("strong", { text: money(ev.one) })),
    el("p", { class: "sum" }, "Both: ", el("span", { class: "mono", text: `${fmt.num(1 - p, 2)} × ${plain(M)} + ${plain(K)} = ` }), el("strong", { text: money(ev.two) })),
    el("p", { class: "small" }, "Level when ", el("span", { class: "mono", text: "p = (M + K) / 2M" }), never ? `, which is ${pct2(ev.threshold) === "100%" ? "just over 100%" : pct2(ev.threshold)} here: out of reach.` : ` = ${pct2(ev.threshold)}.`));
  const pt = payoffTable(M, K);
  fill(causalBox,
    el("h3", { text: "The causal sum" }),
    el("p", { class: "small", text: "Treat the box as already filled or already empty. Your choice comes after the prediction and cannot reach back to change it." }),
    table({
      columns: [{ key: "you", label: "You take" }, { key: "full", label: "Box is full", num: true }, { key: "empty", label: "Box is empty", num: true }],
      rows: [
        { you: "One box", full: money(pt.one.full), empty: money(pt.one.empty) },
        { you: "Both boxes", full: money(pt.two.full), empty: money(pt.two.empty) },
        { you: el("strong", { text: "Gain from taking both" }), full: el("strong", { text: `+${money(K)}` }), empty: el("strong", { text: `+${money(K)}` }) },
      ],
    }),
    el("p", { class: "small" }, "If you think the box is full with probability ", el("span", { class: "mono", text: "q" }), ", one box is worth ", el("span", { class: "mono", text: "q × M" }), " and both are worth ", el("span", { class: "mono", text: "q × M + K" }), `. The gap is ${money(K)} for every q.`));

  // The map: accuracy needed against the ratio of the two amounts.
  const ratio = K / M;
  const xMax = Math.max(1.2, ratio * 1.15);
  const rs = Array.from({ length: 61 }, (_, i) => (xMax * i) / 60);
  const need = (r) => Math.min(1, 0.5 + r / 2);
  mapChart.update({
    subtitle: "The line is the accuracy at which the two evidential values are level: one half, plus half the ratio of the clear box to the prize. Above it one box wins; below it, both.",
    label: "Chart of the predictor accuracy needed for one-boxing to win, against the ratio of the clear box to the prize",
    x: { label: "Clear box as a share of the prize (K ÷ M)", domain: [0, xMax], format: (v) => fmt.num(v, 1) },
    y: { label: "Predictor's accuracy", domain: [0, 1], format: (v) => pct(v) },
    series: [
      { name: "One box has the higher evidential value", type: "range", color: 0, data: rs.map((r) => [r, need(r), 1]) },
      { name: "Accuracy needed", type: "line", color: "#16233b", data: rs.map((r) => [r, need(r)]) },
      { name: "These settings", type: "scatter", color: 1, r: 6, data: [{ x: ratio, y: p, label: `K ÷ M = ${fmt.sig(ratio, 3)}, accuracy ${pct(p)}` }] },
    ],
    marks: [
      { type: "text", x: xMax * 0.12, y: 0.93, text: "one box wins (evidential)" },
      { type: "text", x: xMax * 0.3, y: 0.25, text: "both boxes win on either sum" },
    ],
    legend: false,
  });

  drawGame();
  simulateSoon();
}

refresh();
runSimulation();
