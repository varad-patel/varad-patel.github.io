// Day 28: Two Envelopes Paradox. Interface.
import { $, el, fmt, debounce, mount, slider, select, segmented, checkbox, numberField, button, stat, note, table, chart, rng, randomSeed } from "../kit/kit.js";
import { meanSmaller, range, weight, seenTable, partialGain, strategyExact, bestThreshold, deal, simulate } from "./logic.js";

mount();

const MAX_SEED = 4294967295;
const ROWS = 13; // amounts listed for the unbounded prior
const state = { kind: "uniform", fixedN: 6, count: 10, q: 2 / 3, t: 9, rounds: 100000, seed: 28, look: true };
const prior = () => (state.kind === "fixed" ? { kind: "fixed", n: state.fixedN } : state.kind === "uniform" ? { kind: "uniform", count: state.count } : { kind: "doubling", q: state.q });

/* ---------- number formats: amounts run from 1 to far beyond a billion ---------- */
const SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sci = (v) => { const [m, e] = Math.abs(v).toExponential(1).split("e"); return `${v < 0 ? "-" : ""}${m} × 10${[...String(Number(e))].map((c) => SUP[c]).join("")}`; };
const big = (v) => Math.abs(v) >= 1e9;
const money = (v) => (typeof v !== "number" || Number.isNaN(v) ? "–" : !Number.isFinite(v) ? "infinite" : big(v) ? sci(v) : Number.isInteger(v) ? fmt.int(v) : fmt.num(v, 2));
const avg = (v) => (typeof v !== "number" || Number.isNaN(v) ? "–" : !Number.isFinite(v) ? "infinite" : big(v) ? sci(v) : Math.abs(v) >= 1e6 ? fmt.int(v) : fmt.num(v, 2));
const gainFmt = (v) => (v === 0 ? "0" : big(v) ? `${v > 0 ? "+" : ""}${sci(v)}` : fmt.signed(v, Number.isInteger(v) ? 0 : Math.abs(v) >= 100 ? 1 : 2));
const small = (v) => (v !== 0 && Math.abs(v) < 0.01 ? `${v > 0 ? "+" : ""}${fmt.sig(v, 2)}` : gainFmt(Number(v.toPrecision(3))));
const pm = (v, se) => `${v === 0 ? "0" : gainFmt(Number(v.toPrecision(4)))} ± ${fmt.sig(2 * se, 2)}`;
const pct = (v) => (v > 0 && v < 0.001 ? `${fmt.sig(v * 100, 2)}%` : fmt.pct(v, 1));
const frac = (q) => (Math.abs(q - 1 / 3) < 1e-12 ? "1/3" : Math.abs(q - 1 / 2) < 1e-12 ? "1/2" : Math.abs(q - 2 / 3) < 1e-12 ? "2/3" : fmt.num(q, 3));
const sub = (main, small) => el("span", {}, main, el("span", { class: "te-sub", text: small }));

let sim;   // the latest simulation of the three strategies
let game;  // the hand-played game: { r, d, phase, pick, final, tally }

const head = (title, text) => el("div", { class: "te-head" }, el("h3", { text: title }), el("p", { class: "small muted", text }));

/* ============================================ 1. the prior and the game */

const kindSeg = segmented({
  label: "Prior for the smaller amount", value: state.kind,
  options: [{ value: "fixed", label: "Fixed pair" }, { value: "uniform", label: "Uniform" }, { value: "doubling", label: "Doubling" }],
  hint: "A fixed pair, a uniform range of amounts, or an unbounded prior in which each doubling is less likely than the last.",
  onChange: (v) => { state.kind = v; state.t = bestThreshold(prior()) ?? 5; tSlider.value = state.t; newPrior(); },
});
const fixedSlider = slider({
  label: "Smaller amount", min: 0, max: 10, step: 1, value: state.fixedN, format: (v) => money(2 ** v),
  onInput: (v) => { state.fixedN = v; newPrior(); },
});
const countSlider = slider({
  label: "Largest value the smaller amount can take", min: 1, max: 14, step: 1, value: state.count - 1, format: (v) => money(2 ** v),
  onInput: (v) => { state.count = v + 1; newPrior(); },
});
const qSlider = slider({
  label: "Ratio q", min: 0.05, max: 0.9, step: "any", value: state.q, format: (v) => fmt.num(v, 3),
  hint: "Each amount is q times as likely as the one half its size. The mean is finite only when q is below 1/2.",
  onInput: (v) => { state.q = v; newPrior(); },
});
const setQ = (q) => { state.q = q; qSlider.value = q; newPrior(); };
const qBox = el("div", { class: "controls" }, qSlider.el,
  el("div", { class: "row" }, button("q = 1/3", () => setQ(1 / 3), { small: true }), button("q = 1/2", () => setQ(1 / 2), { small: true }), button("q = 2/3", () => setQ(2 / 3), { small: true })));
const priorText = el("p", { class: "small", role: "status" });

const lookBox = checkbox({ label: "Look inside my envelope before deciding", checked: state.look, onChange: (on) => { state.look = on; renderGame(); } });
const gameBox = el("div", { class: "panel te-game" });
const sRounds = stat("Rounds played");
const sYou = stat("Your average winnings");
const sKeep = stat("Had you always kept");
const sSwap = stat("Had you always switched");

const part1 = el("div", { class: "tool-grid te-part" },
  el("div", { class: "controls" },
    head("1. Choose a prior and play", "One envelope holds twice as much as the other. The prior says how the smaller amount is chosen before the envelopes are sealed."),
    kindSeg.el, fixedSlider.el, countSlider.el, qBox, priorText),
  el("div", { class: "out" }, gameBox, el("div", { class: "stats" }, sRounds.el, sYou.el, sKeep.el, sSwap.el)));

function describePrior() {
  const p = prior(), mean = meanSmaller(p);
  if (p.kind === "fixed") return `The envelopes always hold ${money(2 ** p.n)} and ${money(2 ** (p.n + 1))}. Only which is which is left to chance.`;
  if (p.kind === "uniform") {
    const list = p.count <= 4 ? Array.from({ length: p.count }, (_, n) => money(2 ** n)).join(", ") : `1, 2, 4, …, ${money(2 ** (p.count - 1))}`;
    return `The smaller amount is equally likely to be any of ${list}: ${p.count} values, each with chance ${pct(1 / p.count)}. Its mean is ${avg(mean)}.`;
  }
  return `The smaller amount is 1 with chance ${pct(weight(p, 0))}, 2 with chance ${pct(weight(p, 1))}, 4 with chance ${pct(weight(p, 2))}, and so on without limit. Its mean is ${Number.isFinite(mean) ? avg(mean) : "infinite, because q is not below 1/2"}.`;
}

function dealRound() { game.d = deal(game.r, prior()); game.phase = "pick"; game.pick = null; game.final = null; }
function newGame() {
  game = { r: rng((state.seed + 1) >>> 0), tally: { rounds: 0, kept: 0, switched: 0, won: 0, keep: 0, swap: 0 } };
  dealRound();
}
// The deal's coin decides which side the smaller amount is on: the left envelope holds d.mine, the right d.other.
const amountOn = (side) => (side === "left" ? game.d.mine : game.d.other);
const otherSide = (side) => (side === "left" ? "right" : "left");

function choose(side) {
  if (game.phase !== "pick") return;
  game.pick = side;
  game.phase = "decide";
  renderGame("keep");
}
function decide(switching) {
  if (game.phase !== "decide") return;
  const t = game.tally;
  game.final = switching ? otherSide(game.pick) : game.pick;
  game.phase = "done";
  t.rounds += 1;
  t[switching ? "switched" : "kept"] += 1;
  t.won += amountOn(game.final);
  t.keep += amountOn(game.pick);
  t.swap += amountOn(otherSide(game.pick));
  renderGame("again");
}

function renderGame(focus) {
  const g = game, t = g.tally;
  const envelope = (side) => {
    const open = g.phase === "done" || (g.phase === "decide" && side === g.pick && state.look);
    const held = g.phase !== "pick" && side === (g.phase === "done" ? g.final : g.pick);
    const tag = held ? "yours" : side;
    return el("button", {
      type: "button", class: `env${open ? " open" : ""}${held ? " held" : ""}`, disabled: g.phase !== "pick", dataset: { side },
      "aria-label": `${side === "left" ? "Left" : "Right"} envelope${held ? ", yours" : ""}: ${open ? money(amountOn(side)) : "sealed"}`, onclick: () => choose(side),
    }, el("span", { class: "env-amt", text: open ? money(amountOn(side)) : "?" }), el("span", { class: "env-tag", text: tag }));
  };
  let message, actions;
  if (g.phase === "pick") {
    message = "Two sealed envelopes. One holds twice as much as the other. Pick one.";
    actions = [];
  } else if (g.phase === "decide") {
    message = state.look
      ? `Your envelope holds ${money(amountOn(g.pick))}. Keep it, or switch to the other one?`
      : `You picked the ${g.pick} envelope and have not opened it. Keep it, or switch to the other one?`;
    actions = [button("Keep", () => decide(false), { primary: true }), button("Switch", () => decide(true), { primary: true })];
    actions[0].dataset.act = "keep";
  } else {
    const switched = g.final !== g.pick;
    const got = amountOn(g.final), missed = amountOn(otherSide(g.final));
    message = `You ${switched ? "switched" : "kept your envelope"} and end with ${money(got)}. The other envelope held ${money(missed)}, so ${switched ? "switching" : "keeping"} ${got > missed ? "gained" : "cost"} you ${money(Math.abs(got - missed))}.`;
    actions = [button("Deal again", () => { dealRound(); renderGame("left"); }, { primary: true })];
    actions[0].dataset.act = "again";
  }
  gameBox.replaceChildren(
    el("div", { class: "te-envs" }, envelope("left"), envelope("right")),
    el("p", { class: "te-msg", role: "status", text: message }),
    el("div", { class: "row" }, actions, lookBox.el),
    el("div", { class: "row" }, button("Reset the tally", () => { newGame(); renderGame(); }, { small: true })));
  const n = t.rounds;
  sRounds.set(fmt.int(n), n ? `kept ${fmt.int(t.kept)}, switched ${fmt.int(t.switched)}` : "pick an envelope to start");
  sYou.set(n ? avg(t.won / n) : "–", n ? `${money(t.won)} in all` : "");
  sKeep.set(n ? avg(t.keep / n) : "–", n ? `${money(t.keep)} in all` : "");
  sSwap.set(n ? avg(t.swap / n) : "–", n ? `${money(t.swap)} in all` : "");
  const target = focus === "left" ? gameBox.querySelector('[data-side="left"]') : focus ? gameBox.querySelector(`[data-act="${focus}"]`) : null;
  target?.focus({ preventScroll: true });
}

/* ================================== 2. what each amount tells you */

const STEPS = [
  "Call the amount in my envelope A.",
  "The other envelope holds either 2A or A/2.",
  "Whatever A is, the two are equally likely.",
  "So the other envelope is worth ½ × 2A + ½ × A/2 = 5/4 of A on average.",
  "That is more than A whatever A is, so I should switch. (Then the same argument says switch back.)",
];
const stepList = el("ol", { class: "te-steps" });
const verdictBox = el("div", { role: "status" });
const exactBox = el("div", { class: "te-tbl" });
const partsBox = el("div");

const part2 = el("div", { class: "tool-grid te-part" },
  el("div", { class: "controls" },
    head("2. Check the tempting argument", "The argument for switching, step by step. The table works out what is actually true for the prior you chose, for every amount you might see."),
    stepList),
  el("div", { class: "out" }, verdictBox, exactBox, partsBox));

const partsChart = chart(partsBox, {
  title: "Where always-switching's gains and losses come from",
  label: "Bar chart of each amount's contribution to the expected gain from always switching",
  height: 260,
  x: { label: "Amount you see", type: "band" },
  y: { label: "Chance of seeing it × expected gain from switching", format: (v) => gainFmt(Number(v.toPrecision(3))), zero: true },
  series: [],
});

function renderExact() {
  const p = prior(), mean = meanSmaller(p), finite = Number.isFinite(mean);
  const { rows, complete } = seenTable(p, p.kind === "doubling" ? ROWS : 100);
  const { last } = range(p);
  const simulated = (j) => { const a = sim.amounts.get(j); return a ? `simulated ${pct(a.otherLarger / a.count)} (${fmt.int(a.count)} ${a.count === 1 ? "deal" : "deals"})` : "not dealt in part 3"; };
  const body = rows.map((r) => ({
    amount: sub(el("strong", { text: money(r.amount) }), `seen ${pct(r.chance)} of the time`),
    odds: sub(el("strong", { text: pct(r.otherLarger) }), simulated(r.j)),
    gain: sub(el("strong", { text: gainFmt(r.gain) }), `${fmt.signed(r.share * 100, 1)}% of it`),
  }));
  if (!complete) {
    const r = rows.at(-1);
    body.push({
      amount: sub(el("strong", { text: "Anything larger" }), `seen ${pct(1 - rows.reduce((s, x) => s + x.chance, 0))} of the time`),
      odds: el("strong", { text: pct(r.otherLarger) }), gain: el("strong", { text: `${fmt.signed(r.share * 100, 1)}% of it` }),
    });
  }
  exactBox.replaceChildren(table({
    caption: "What each amount tells you: exact values, with the simulation from part 3 beneath",
    columns: [{ key: "amount", label: "You see", num: true }, { key: "odds", label: "Chance the other holds more", num: true }, { key: "gain", label: "Expected gain from switching", num: true }],
    rows: body,
  }));

  // Which step of the argument fails for this prior.
  let fails, text;
  const half = rows.filter((r) => r.otherLarger === 0.5);
  if (p.kind === "fixed") {
    fails = [2];
    text = `Step 3 fails. With a fixed pair the amount settles everything: see ${money(2 ** p.n)} and the other envelope certainly holds more, see ${money(2 ** (p.n + 1))} and it certainly holds less. The chance is never one half. Before you look, the two cases are equally likely, one gains ${money(2 ** p.n)} and the other loses ${money(2 ** p.n)}, and switching is worth exactly nothing.`;
  } else if (p.kind === "uniform") {
    const topSeen = 2 ** (last + 1);
    fails = [2];
    text = half.length
      ? `Step 3 fails, but only at the ends. It is true for ${half.length} of the ${rows.length} amounts you can see (${money(half[0].amount)}${half.length > 1 ? ` to ${money(half.at(-1).amount)}` : ""}), and there switching really is worth a quarter of what you hold. But ${money(topSeen)} can only be the larger amount, and that one case, a certain loss of ${money(topSeen / 2)} with chance ${pct(rows.at(-1).chance)}, cancels every gain below it. The total is exactly zero.`
      : `Step 3 fails. Seeing 1 means the other envelope holds 2, and seeing 2 means it holds 1. The chance is never one half.`;
  } else if (finite) {
    const r = rows[1];
    fails = [2];
    text = `Step 3 fails. Small amounts are more common than large ones, so after any amount above 1 the chance that the other envelope holds more is q / (1 + q) = ${pct(r.otherLarger)}, not 50%, and switching loses ${fmt.num(-r.share * 100, 1)}% of what you hold on average. Only at 1 does it gain. Added over every amount, the gain and the losses cancel exactly.`;
  } else if (state.q > 0.5) {
    const r = rows[1];
    fails = [2, 4];
    text = `Step 3 is still wrong (the chance is q / (1 + q) = ${pct(r.otherLarger)}, not 50%), but that no longer rescues you: switching gains ${fmt.num(r.share * 100, 1)}% of what you hold on average, whatever amount you see. The step that fails is 5. Going from “switching gains whatever I see” to “I should switch without looking” averages those gains over all amounts, and that average does not exist: the expected amount in each envelope is infinite, so there is nothing for always-switching to be better than.`;
  } else {
    fails = [2, 4];
    text = `The borderline case. After any amount above 1 the chance that the other holds more is ${pct(rows[1].otherLarger)} and switching gains exactly nothing on average; at 1 it gains 1. So switching never hurts and sometimes helps, yet always-switching cannot beat always-keeping, since the two are the same game. Step 5's move from each amount to all amounts fails because the expected amount in each envelope is infinite.`;
  }
  stepList.replaceChildren(...STEPS.map((s, i) => el("li", { class: fails.includes(i) ? "fails" : null }, s, fails.includes(i) ? el("span", { class: "te-tag", text: i === 2 && fails.length > 1 ? "wrong, but not fatal" : "fails here" }) : null)));
  verdictBox.replaceChildren(note(finite ? "good" : "warn", text));

  const running = partialGain(p, rows.at(-1).j);
  partsChart.update({
    subtitle: complete
      ? "Each bar is the chance of seeing that amount times the expected gain from switching then. The bars add up to exactly zero."
      : state.q < 0.5
        ? `The first ${rows.length} amounts. Their total is ${small(running)}, and it shrinks to zero as more amounts are added.`
        : state.q > 0.5
          ? `The first ${rows.length} amounts. Their total is ${small(running)} and it grows without limit as more are added: nothing ever cancels.`
          : `The first ${rows.length} amounts. Their total is ${gainFmt(running)} however many are added: nothing cancels the gain at 1.`,
    x: { label: "Amount you see", type: "band", categories: rows.map((r) => money(r.amount)) },
    series: [{ name: "Contribution", type: "bars", data: rows.map((r) => [money(r.amount), r.contribution]), color: 0 }],
  });
}

/* ====================================== 3. strategies over many rounds */

const tSlider = slider({
  label: "Switch only if I see this or less", min: 0, max: 20, step: 1, value: state.t, format: (v) => money(2 ** v),
  onInput: (v) => { state.t = v; rerun(); },
});
const bestBtn = button("Use the best threshold", () => { const b = bestThreshold(prior()); if (b != null) { state.t = b; tSlider.value = b; rerun(); } }, { small: true });
const roundsSel = select({
  label: "Rounds to simulate", value: String(state.rounds),
  options: [1000, 10000, 100000, 1000000].map((n) => ({ value: String(n), label: fmt.int(n) })),
  onChange: (v) => { state.rounds = Number(v); rerun(); },
});
const seedField = numberField({ label: "Seed", min: 0, max: MAX_SEED, step: 1, value: state.seed, hint: "The same seed deals the same envelopes." });
const seedMsg = el("div");
seedField.input.addEventListener("input", () => {
  const v = seedField.value;
  if (!Number.isInteger(v)) { seedMsg.replaceChildren(note("bad", `The seed must be a whole number from 0 to ${fmt.int(MAX_SEED)}.`)); return; }
  seedMsg.replaceChildren();
  state.seed = v;
  rerun();
});
const stratBox = el("div", { class: "te-tbl" });
const stratMsg = el("div", { role: "status" });
const runBox = el("div");

const part3 = el("div", { class: "tool-grid te-part" },
  el("div", { class: "controls" },
    head("3. Play it many times", "Three strategies face the same deals: always keep, always switch, and switch only when the amount you see is at or below a threshold."),
    tSlider.el, el("div", { class: "row" }, bestBtn),
    roundsSel.el, seedField.el, seedMsg,
    el("div", { class: "row" }, button("New seed", () => { state.seed = randomSeed(); seedField.value = state.seed; seedMsg.replaceChildren(); rerun(); }, { small: true }))),
  el("div", { class: "out" }, stratBox, stratMsg, runBox));

const runChart = chart(runBox, {
  title: "Average winnings so far, round by round",
  label: "Line chart of the running average winnings of the three strategies against the number of rounds played",
  height: 300,
  x: { label: "Rounds played (log scale)", type: "log", format: (v) => fmt.compact(v) },
  y: { label: "Average winnings per round" },
  series: [],
});

function renderStrategies() {
  const p = prior(), x = strategyExact(p, state.t), finite = Number.isFinite(x.keep);
  const { first, last } = range(p);
  const T = money(2 ** state.t), best = bestThreshold(p);
  bestBtn.disabled = best == null || best === state.t;

  stratBox.replaceChildren(table({
    caption: `${fmt.int(sim.rounds)} simulated rounds, with the exact values`,
    columns: [{ key: "q", label: "Per round" }, { key: "keep", label: "Always keep", num: true }, { key: "swap", label: "Always switch", num: true }, { key: "thr", label: `Switch on ${T} or less`, num: true }],
    rows: [
      { q: "Average winnings, simulated", keep: avg(sim.keep), swap: avg(sim.switch), thr: avg(sim.threshold) },
      { q: "Expected winnings, exact", keep: avg(x.keep), swap: avg(x.switch), thr: avg(x.threshold) },
      { q: "Gain over always keeping, simulated (± 2 standard errors)", keep: "0", swap: finite ? pm(sim.switchGain, sim.switchGainSe) : gainFmt(Number(sim.switchGain.toPrecision(4))), thr: pm(sim.edge, sim.edgeSe) },
      { q: "Gain over always keeping, exact", keep: "0", swap: finite ? "0" : "not defined", thr: gainFmt(Number(x.edge.toPrecision(4))) },
    ],
  }));

  let text;
  const inside = state.t >= first && state.t <= last;
  const noisy = x.edge > 0 && 2 * sim.edgeSe > x.edge ? ` The simulated gain is ${pm(sim.edge, sim.edgeSe)}: at this threshold it rests on rare, large deals, and ${fmt.int(sim.rounds)} rounds are too few to pin it down.` : "";
  const where = state.t < first
    ? `You never see ${T} or less under this prior, so the rule never switches: it is always-keep under another name.`
    : `You never see more than ${T} under this prior, so the rule always switches.`;
  if (finite) {
    text = inside
      ? `Keeping and switching tie exactly. The threshold of ${T} lies inside the prior's range, so it beats both by ${gainFmt(Number(x.edge.toPrecision(4)))} a round: whenever the smaller amount is exactly ${T}, you end up with the larger envelope whichever one you were handed.${best !== state.t ? ` The best threshold for this prior is ${money(2 ** best)}.` : " No threshold does better for this prior."}${noisy}`
      : `Keeping and switching tie exactly. ${where} A threshold only helps when it falls inside the prior's range; the best one here is ${money(2 ** best)}.`;
  } else {
    const largest = 2 ** Math.max(...sim.amounts.keys());
    text = `Every strategy's expected winnings are infinite, so the simulated averages are not estimates of anything: they are set by the few largest deals (the largest amount seen here was ${money(largest)}) and jump when the seed changes. One comparison is still well defined: the threshold rule's expected gain over always keeping is exactly ${gainFmt(Number(x.edge.toPrecision(4)))} a round, a finite number because that gain can never exceed ${T}.${noisy} ${state.q > 0.5 ? "There is no best threshold: a higher one always gains more." : "Every threshold gains the same."}`;
  }
  stratMsg.replaceChildren(note(finite ? (inside ? "good" : "") : "warn", text));

  const line = (i) => sim.history.map((h) => [h[0], h[i]]);
  runChart.update({
    subtitle: finite ? "The dashed lines are the exact expected winnings." : "Log scale. With an infinite mean the averages keep jumping and never settle.",
    y: finite
      ? { label: "Average winnings per round", domain: [0, 2 * x.threshold], format: (v) => fmt.compact(v) }
      : { label: "Average winnings per round (log scale)", type: "log", format: (v) => (v >= 1e6 ? sci(v) : fmt.int(v)) },
    series: [
      { name: "Always keep", data: line(1), color: 0 },
      { name: "Always switch", data: line(2), color: 1 },
      { name: `Switch on ${T} or less`, data: line(3), color: 2 },
    ],
    marks: !finite ? [] : x.edge === 0
      ? [{ type: "hline", y: x.keep, text: `all three ${avg(x.keep)}` }]
      : x.edge / (2 * x.threshold) < 0.07 // the two lines are too close for two labels
        ? [{ type: "hline", y: x.threshold, text: `threshold ${avg(x.threshold)}, keep or switch ${avg(x.keep)}` }, { type: "hline", y: x.keep }]
        : [{ type: "hline", y: x.threshold, text: `threshold ${avg(x.threshold)}` }, { type: "hline", y: x.keep, text: `keep or switch ${avg(x.keep)}` }],
  });
}

/* ============================================================== start */

/** Seed, rounds or threshold changed: deal the simulation again. The hand-played game is left alone. */
function runNow() {
  sim = simulate(rng(state.seed), prior(), state.rounds, state.t);
  renderExact();
  renderStrategies();
}
// A million rounds take a noticeable fraction of a second, so wait for a slider to stop moving before running them.
const runSoon = debounce(runNow, 150);
function rerun() { if (state.rounds > 100000) runSoon(); else runNow(); }
/** The prior changed: show its controls, start the hand-played game again and re-run the simulation. */
function newPrior() {
  fixedSlider.el.hidden = state.kind !== "fixed";
  countSlider.el.hidden = state.kind !== "uniform";
  qBox.hidden = state.kind !== "doubling";
  priorText.textContent = describePrior();
  newGame();
  renderGame();
  rerun();
}

$("#app").append(part1, part2, part3);
newPrior();
