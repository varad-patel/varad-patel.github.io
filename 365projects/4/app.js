// Day 4: Bayes Intuition Lab. Interface.
import { $, el, fmt, mount, slider, select, segmented, button, stat, note, table, chart, canvas, palette, rng } from "../kit/kit.js";
import { PRESETS, GRIDS as GRID, bayes, crowd, sequence, curve, priorFor, judgeGuess, randomScenario, pctIn, pct } from "./logic.js";

mount();

const HAS = palette[1];   // people who have the condition
const NOT = "#8a94a3";    // people who do not
const INK = "#16233b";

const people = (k) => (k === 1 ? "1 person" : `${fmt.int(k)} people`);
const nearest = (grid, p) => grid.reduce((best, v, i) => (Math.abs(v - p) < Math.abs(grid[best] - p) ? i : best), 0);

const state = { ...PRESETS[0], preset: PRESETS[0].key, n: 1000, revealed: false, verdict: null, log: [], seed: 4 };

/* ---------- controls ---------- */
const presetNote = el("div", { class: "hint" });
const presetSelect = select({
  label: "Scenario", value: state.preset,
  options: [...PRESETS.map((p) => ({ value: p.key, label: p.label })), { value: "random", label: "A random scenario to guess" }, { value: "custom", label: "Your own numbers" }],
  onChange: (key) => {
    const p = PRESETS.find((x) => x.key === key);
    if (p) setScenario(p, key); else if (key === "random") newRound(false); else { state.preset = "custom"; update(); }
  },
});
presetSelect.el.append(presetNote);

const sliders = {};
for (const [key, label, hint] of [
  ["prior", "Base rate", "How common the condition is among the people being tested."],
  ["sens", "Sensitivity", "Of those who have the condition, the share the test catches."],
  ["fpr", "False-positive rate", "Of those who do not have it, the share the test flags anyway."],
]) {
  sliders[key] = slider({
    label, hint, min: 0, max: GRID[key].length - 1, step: 1, value: nearest(GRID[key], state[key]),
    format: (i) => pctIn(GRID[key][i]),
    onInput: (i) => { state[key] = GRID[key][i]; state.preset = "custom"; presetSelect.value = "custom"; state.verdict = null; sayValue(key); update(); },
  });
  sayValue(key);
}
/** The slider's own value is a position in the list of steps, so assistive technology is told the percentage instead. */
function sayValue(key) { sliders[key].input.setAttribute("aria-valuetext", pctIn(GRID[key][sliders[key].value])); }
const crowdSeg = segmented({
  label: "People in the picture", value: state.n,
  options: [{ value: 100, label: "100" }, { value: 1000, label: "1,000" }, { value: 10000, label: "10,000" }],
  hint: "A bigger crowd shows rarer conditions and rounds less.",
  onChange: (v) => { state.n = Number(v); update(); },
});
const controls = el("div", { class: "controls" }, presetSelect.el, sliders.prior.el, sliders.sens.el, sliders.fpr.el, crowdSeg.el);

/* ---------- outputs ---------- */
const question = el("p", { class: "q" });
const guessSlider = slider({ label: "Your guess, before you look", min: 0, max: 100, step: 1, value: 50, format: (v) => `${v}%` });
const verdictBox = el("div", { class: "verdict", role: "status" });
const guessArea = el("div", { class: "guess" });
const questionPanel = el("div", { class: "panel ask" }, el("h2", { text: "The question" }), question, el("div", { class: "answer" }, verdictBox, guessArea));

const sPos = stat("After a positive result");
const sNeg = stat("After a negative result");
const sShare = stat("Share who test positive");
const sLr = stat("Odds multiplier");
const message = el("div");
const summary = el("p", { class: "summary", role: "status" });
const picTitle = el("p", { class: "chart-title" });
const picBox = el("div");
const picLegend = el("div", { class: "chart-legend" });
const picNote = el("div");
const barBox = el("div");
const chartBox = el("div");
const chartNote = el("p", { class: "small muted" });
const repeatBox = el("div");
const logBox = el("div");
// Reading order, tab order and phone order: the question, its answer, the controls, then the detail.
// On a wide screen the question runs across the top and the controls sit in a column on the left below it.
// Nothing in `top` takes keyboard focus, so Tab goes question, controls, detail at every width.
const top = el("div", { class: "out lab-top" },
  el("div", { class: "stats" }, sPos.el, sNeg.el, sShare.el, sLr.el), message,
  el("div", {}, picTitle, summary, picLegend, picBox, picNote), barBox);
const rest = el("div", { class: "out lab-rest" }, el("div", {}, chartBox, chartNote), repeatBox, logBox);

$("#app").append(el("div", { class: "lab-grid" }, questionPanel, top, controls, rest));

/* ---------- the picture: one dot per person ---------- */
// Colour says who has the condition. After the reveal, position says how they tested.
function layout(w) {
  const narrow = w < 480;
  const n = state.n;
  const cols = n === 100 ? (narrow ? 10 : 20) : n === 1000 ? (narrow ? 40 : 50) : narrow ? 100 : 200;
  const pad = 12;
  const cell = Math.max(1, Math.min(n === 100 ? 22 : 14, (w - 2 * pad) / cols));
  const c = crowd(state.prior, state.sens, state.fpr, n);
  const blocks = state.revealed
    ? [{ title: `Tested positive: ${people(c.positive)}`, more: `, ${fmt.int(c.tp)} with the condition`, has: c.tp, not: c.fp },
       { title: `Tested negative: ${people(c.negative)}`, more: `, ${fmt.int(c.fn)} with the condition`, has: c.fn, not: c.tn }]
    : [{ has: c.sick, not: c.well }];
  let y = pad;
  for (const blk of blocks) {
    blk.top = y + (blk.title ? 22 : 0);
    blk.rows = Math.ceil((blk.has + blk.not) / cols);
    y = blk.top + blk.rows * cell + 16;
  }
  return { cols, cell, pad, blocks, height: y - 16 + pad };
}

const picture = canvas(picBox, {
  height: (w) => layout(w).height,
  draw(ctx, w) {
    const { cols, cell, pad, blocks } = layout(w);
    const round = cell >= 6;
    ctx.textBaseline = "alphabetic";
    for (const blk of blocks) {
      if (blk.title) {
        ctx.fillStyle = INK;
        ctx.font = '600 13px "Hanken Grotesk", system-ui, sans-serif';
        const full = blk.title + blk.more;
        ctx.fillText(ctx.measureText(full).width <= w - 2 * pad ? full : blk.title, pad, blk.top - 8);
      }
      for (const [from, to, colour] of [[0, blk.has, HAS], [blk.has, blk.has + blk.not, NOT]]) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (let i = from; i < to; i++) {
          const x = pad + (i % cols) * cell;
          const y = blk.top + Math.floor(i / cols) * cell;
          if (round) { ctx.moveTo(x + cell * 0.9, y + cell / 2); ctx.arc(x + cell / 2, y + cell / 2, cell * 0.4, 0, 2 * Math.PI); }
          else ctx.rect(x + 0.5, y + 0.5, Math.max(1, cell - 1), Math.max(1, cell - 1));
        }
        ctx.fill();
      }
    }
  },
});
picture.el.setAttribute("role", "img");
document.fonts?.ready.then(() => picture.redraw());   // the block titles are drawn text

/* ---------- actions ---------- */
function setScenario(s, key = "custom") {
  for (const k of ["prior", "sens", "fpr"]) { state[k] = s[k]; sliders[k].value = nearest(GRID[k], s[k]); sayValue(k); }
  state.preset = key;
  presetSelect.value = key;
  state.verdict = null;
  update();
}
function reveal(withGuess) {
  state.verdict = withGuess ? judgeGuess(guessSlider.value / 100, state.prior, state.sens, state.fpr) : null;
  if (state.verdict) state.log.push({ prior: state.prior, sens: state.sens, fpr: state.fpr, ...state.verdict });
  state.revealed = true;
  update();
  guessArea.querySelector("button")?.focus();   // the button that was pressed has gone; keep the keyboard's place
}
function newRound(moveFocus = true) {
  let s;
  do { state.seed++; s = randomScenario(rng(state.seed)); } while (s.prior === state.prior && s.sens === state.sens && s.fpr === state.fpr);
  state.revealed = false;
  guessSlider.value = 50;
  setScenario(s, "random");
  if (moveFocus) guessSlider.input.focus();
}

function verdictNote(v) {
  const head = el("strong", { text: `You guessed ${fmt.int(v.guess * 100)}%. The answer is ${pct(v.truth)}.` });
  const points = `${fmt.sig(Math.abs(v.gap) * 100, 3)} percentage points`;
  if (v.verdict === "close") return note("good", head, ` That is within five points (off by ${points}). You gave the base rate its due.`);
  if (v.verdict === "sensitivity") return note("warn", head, ` Your guess matches the test's sensitivity (${pctIn(state.sens)}): the chance of a positive result for someone who has the condition. The question asked the reverse, the chance of the condition for someone with a positive result. Swapping the two is the usual mistake, and it leaves the base rate out entirely.`);
  if (v.verdict === "specificity") return note("warn", head, ` Your guess is close to the share of people without the condition whom the test correctly clears (${pctIn(1 - state.fpr)}). That describes how the test treats them. It does not say how many of the positive results are real.`);
  if (v.verdict === "over") {
    const times = v.truth > 0 && v.guess / v.truth >= 2 ? `, ${fmt.sig(v.guess / v.truth, 2)} times the right answer` : "";
    return note("warn", head, ` That is ${points} too high${times}. A base rate of ${pctIn(state.prior)} pulls the answer down further than it feels it should.`);
  }
  return note("warn", head, ` That is ${points} too low. Here the condition is common enough, or false alarms rare enough, that a positive result carries more weight than you allowed.`);
}

/* ---------- rendering ---------- */
let plot = null;

function update() {
  const { prior, sens, fpr, n, revealed } = state;
  const b = bayes(prior, sens, fpr);
  const c = crowd(prior, sens, fpr, n);
  if (b.error || c.error) { message.replaceChildren(note("bad", b.error || c.error)); return; }
  message.replaceChildren();

  const preset = PRESETS.find((p) => p.key === state.preset);
  presetNote.textContent = preset ? preset.note : state.preset === "random"
    ? "Round numbers drawn at random for you to guess at. Nothing here describes a real test."
    : "Your own numbers. Nothing here describes a real test.";

  question.textContent = `${pctIn(prior)} of the people being tested have a condition. The test comes back positive for ${pctIn(sens)} of those who have it, and for ${pctIn(fpr)} of those who do not. Someone tests positive. What is the chance that they have the condition?`;
  verdictBox.replaceChildren(...(revealed && state.verdict ? [verdictNote(state.verdict)] : []));
  guessArea.replaceChildren(...(revealed
    ? [el("div", { class: "row" }, button("Guess a new scenario", () => newRound(), { small: !state.verdict, primary: Boolean(state.verdict) })),
       el("p", { class: "small muted", text: "The answer is worked out below. Change the scenario or move a slider and everything updates as you go." })]
    : [guessSlider.el,
       el("div", { class: "row" }, button("Show the answer", () => reveal(true), { primary: true }), button("Skip the guess", () => reveal(false))),
       el("p", { class: "small muted", text: "Set the slider to your best guess, then show the answer. The four numbers below fill in, the crowd sorts itself by test result, and a chart and a repeat-test table appear." })]));

  // Headline numbers.
  if (revealed) {
    sPos.set(pct(b.afterPositive), "chance they have the condition");
    sNeg.set(pct(b.afterNegative), "chance the test missed it");
    sShare.set(pct(b.pPos), `${fmt.sig(b.pPos * n, 4)} in every ${fmt.int(n)}`);
    sLr.set(Number.isFinite(b.lrPositive) ? `× ${fmt.sig(b.lrPositive, 3)}` : "–", b.lrNegative === 0 ? "for a positive; a negative rules the condition out" : `for a positive; × ${fmt.sig(b.lrNegative, 3)} for a negative`);
  } else {
    for (const s of [sPos, sNeg, sShare, sLr]) s.set("?", "shown once you answer");
  }

  // The picture.
  picTitle.textContent = revealed ? `The same ${people(n)}, sorted by test result` : `${people(n)}, one dot each`;
  const frequency = c.afterPositive;
  summary.textContent = !revealed
    ? `${c.sick ? fmt.int(c.sick) : "None"} of them ${c.sick === 1 ? "has" : "have"} the condition and ${fmt.int(c.well)} ${c.well === 1 ? "does" : "do"} not. Now picture testing all of them.`
    : c.positive === 0
      ? `Of ${people(n)}, nobody tests positive at this scale.`
      : c.positive === 1
        ? `1 of the ${fmt.int(n)} tests positive, and that person ${c.tp ? "has" : "does not have"} the condition: ${pct(frequency)}.`
        : `${fmt.int(c.positive)} of the ${fmt.int(n)} test positive, and ${c.tp === c.positive ? "all" : c.tp ? fmt.int(c.tp) : "none"} of those ${fmt.int(c.positive)} ${c.tp === 1 ? "has" : "have"} the condition: ${pct(frequency)}.`;
  picLegend.replaceChildren(
    el("span", {}, el("i", { class: "dot", style: { background: HAS } }), `Has the condition (${fmt.int(c.sick)})`),
    el("span", {}, el("i", { class: "dot", style: { background: NOT } }), `Does not (${fmt.int(c.well)})`));
  picture.el.setAttribute("aria-label", revealed
    ? `${people(n)} as dots in two groups. Tested positive: ${fmt.int(c.tp)} with the condition and ${fmt.int(c.fp)} without. Tested negative: ${fmt.int(c.fn)} with the condition and ${fmt.int(c.tn)} without.`
    : `${people(n)} as dots: ${fmt.int(c.sick)} with the condition and ${fmt.int(c.well)} without.`);
  picture.redraw();

  const notes = [];
  if (c.sick === 0) notes.push(note("", `At a base rate of ${pctIn(prior)}, fewer than one person in ${fmt.int(n)} has the condition, so the picture cannot show them.${n < 10000 ? " Choose a bigger crowd." : ""}${revealed ? " The numbers above are exact." : ""}`));
  else if (revealed && frequency != null && Math.abs(frequency - b.afterPositive) > 0.005) {
    notes.push(note("", `Whole people cannot split, so the picture gives ${pct(frequency)} where the exact answer is ${pct(b.afterPositive)}.${n < 10000 ? " A bigger crowd rounds less." : ""}`));
  }
  picNote.replaceChildren(...notes);

  for (const box of [barBox, chartBox.parentNode, repeatBox]) box.hidden = !revealed;
  if (revealed) {
    // Who is in the positive group.
    barBox.replaceChildren(...(c.positive
      ? [el("p", { class: "chart-title", text: `Among the ${fmt.int(c.positive)} who test positive` }),
         el("div", { class: "split-bar", role: "img", "aria-label": `${fmt.int(c.tp)} have the condition, ${fmt.int(c.fp)} do not` },
           [[c.tp, HAS], [c.fp, NOT]].filter(([k]) => k > 0).map(([k, colour]) => el("span", { style: { width: `${(k / c.positive) * 100}%`, background: colour } }))),
         el("div", { class: "chart-legend" },
           el("span", {}, el("i", { style: { background: HAS } }), "Have the condition ", el("strong", { text: `${fmt.int(c.tp)} (${pct(c.tp / c.positive)})` })),
           el("span", {}, el("i", { style: { background: NOT } }), "False alarms ", el("strong", { text: `${fmt.int(c.fp)} (${pct(c.fp / c.positive)})` })))]
      : []));

    // Posterior against prior for this test.
    const pts = curve(sens, fpr);
    const spec = {
      title: "The same test at every base rate",
      subtitle: "The dot is the current setting. Read across to see what a positive result would mean in a rarer or commoner group.",
      label: "Chance of the condition after a positive and after a negative result, against the base rate",
      height: 320,
      x: { label: "Base rate (log scale)", type: "log", domain: [0.0001, 1], format: pctIn },
      y: { label: "Chance of the condition", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
      series: [
        { name: "Before the test", data: pts.map((p) => [p.prior, p.prior]), color: NOT, dash: true, width: 1.5 },
        { name: "After a positive result", data: pts.map((p) => [p.prior, p.afterPositive]), color: 0 },
        { name: "After a negative result", data: pts.map((p) => [p.prior, p.afterNegative]), color: 2 },
      ],
      marks: [{ type: "vline", x: prior, text: `base rate ${pctIn(prior)}` }, { type: "point", x: prior, y: b.afterPositive, text: pct(b.afterPositive) }],
    };
    if (plot) plot.update(spec); else plot = chart(chartBox, spec);
    const half = priorFor(0.5, sens, fpr);
    chartNote.textContent = half == null ? "" : sens <= fpr
      ? "This test is positive at least as often for people without the condition as for people with it, so a positive result never raises the chance."
      : `With this test, a positive result makes the condition more likely than not only where the base rate is above ${pct(half)}.`;

    // Repeating the test.
    repeatBox.replaceChildren(
      table({
        caption: "If the same person is tested again",
        columns: [{ key: "what", label: "Results" }, { key: "p", label: "Chance of the condition", num: true, format: pct }],
        rows: [["One positive", "+"], ["Two positives", "++"], ["Three positives", "+++"], ["One positive, then one negative", "+-"], ["One negative", "-"], ["Two negatives", "--"]]
          .map(([what, seq]) => ({ what, p: sequence(prior, sens, fpr, seq) })),
      }),
      el("p", { class: "small muted", style: { marginTop: "8px" }, text: "This assumes each run of the test makes its mistakes independently. A repeat that goes wrong for the same reason as the first adds much less than the table says." }));
  }

  // Guesses so far.
  if (state.log.length) {
    const meanGap = state.log.reduce((s, g) => s + Math.abs(g.gap), 0) / state.log.length;
    logBox.replaceChildren(
      el("div", { class: "log" }, table({
        caption: `Your guesses so far: off by ${fmt.sig(meanGap * 100, 3)} percentage points on average`,
        columns: [
          { key: "prior", label: "Base rate, sensitivity, false positives", format: (v, g) => `${pctIn(g.prior)}, ${pctIn(g.sens)}, ${pctIn(g.fpr)}` },
          { key: "guess", label: "Your guess", num: true, format: (v) => `${fmt.int(v * 100)}%` },
          { key: "truth", label: "Answer", num: true, format: pct },
          { key: "gap", label: "Gap (points)", num: true, format: (v) => fmt.signed(v * 100, 1) },
        ],
        rows: state.log,
      })),
      el("div", { class: "row", style: { marginTop: "10px" } }, button("Clear my guesses", () => { state.log = []; update(); }, { small: true })));
  } else logBox.replaceChildren();
}

update();
