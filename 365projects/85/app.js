// Day 85: Kelly Criterion Lab. Interface.
import { $, el, fmt, clamp, mount, segmented, select, button, stat, note, chart, debounce, randomSeed } from "../kit/kit.js";
import {
  LIMITS, BETTORS, kelly, growth, growthZero, readBet, strategies, finalExact, ruinExact, ruinLongRun, createSimulation, wilson,
} from "./logic.js";

mount();

/* ---------- formatting ---------- */
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (n) => String(n).split("").map((c) => SUP[c] ?? c).join("");
/** A multiple of the starting bankroll, from its natural log: x150, x0.87, x3.98 million, x2.1 x 10^15. */
function multiple(logX) {
  if (!Number.isFinite(logX)) return logX > 0 ? "more than ×10³⁰⁰" : "×0";
  const l10 = logX / Math.LN10;
  if (l10 >= 9 || l10 < -3) {
    // Round the mantissa first, so 9.97 × 10^9 reads 1.0 × 10^10 rather than 10.0 × 10^9.
    let e = Math.floor(l10), m = Math.round(10 ** (l10 - e) * 10) / 10;
    if (m >= 10) { m /= 10; e += 1; }
    return `×${fmt.num(m, 1)} × 10${sup(e)}`;
  }
  const x = Math.exp(logX);
  if (x >= 1e6) return `×${fmt.sig(x / 1e6, 3)} million`;
  return `×${fmt.sig(x, x >= 100 ? 4 : 3)}`;
}
const pct = (p, d = 1) => (p > 0 && p < 0.0005 && d <= 1 ? "under 0.1%" : p < 1 && p > 0.9995 && d <= 1 ? "over 99.9%" : fmt.pct(p, d));
const stakePct = (f) => `${fmt.num(f * 100, f * 100 >= 10 || f === 0 ? 1 : 2)}%`;
// e^g - 1 as a percentage; past ten times a bet it reads better as a multiple.
const typical = (g) => (!Number.isFinite(g) ? "-100%" : g > Math.log(11) ? `×${fmt.sig(Math.exp(g), 4)}` : `${fmt.signed((Math.exp(g) - 1) * 100, 3)}%`);

/* ---------- examples ---------- */
const EXAMPLES = [
  { label: "55% at even money", mode: "chance", odds: 1, chance: 55, stake: 25 },
  { label: "A long shot: 12% at 9 to 1", mode: "chance", odds: 9, chance: 12, stake: 5 },
  { label: "Red at single-zero roulette", mode: "chance", odds: 1, chance: 18 / 37 * 100, stake: 5 }, // 18 red of 37 pockets
  { label: "A big edge: 80% at even money", mode: "chance", odds: 1, chance: 80, stake: 30 },
];

/* ---------- controls ---------- */
const mk = (id, value, lim, step = "any") => el("input", { type: "number", id, value, min: lim.min, max: lim.max, step, inputmode: lim.min >= 0 ? "decimal" : null, "aria-describedby": `${id}-msg` });
const msgFor = (id) => el("div", { class: "d85-msg", id: `${id}-msg`, "aria-live": "polite" });
const field = (id, label, input, hint) => el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: id, text: label })), input, hint ? el("div", { class: "hint", text: hint }) : null, msgFor(id));

// Switching between the two descriptions carries the bet across, so the other box never shows a stale number.
const modeSeg = segmented({ label: "Describe the bet by", value: "chance", options: [{ value: "chance", label: "Chance of winning" }, { value: "edge", label: "Edge" }], onChange: (mode) => {
  const was = readBet({ mode: mode === "edge" ? "chance" : "edge", odds: num(oddsBox), edge: num(edgeBox), chance: num(chanceBox) });
  if (was.ok) { if (mode === "edge") edgeBox.value = String(Number((was.edge * 100).toFixed(4))); else chanceBox.value = String(Number((was.p * 100).toFixed(4))); }
  showMode(); changed();
} });
const oddsBox = mk("d85-odds", 1, LIMITS.odds);
const chanceBox = mk("d85-chance", 55, LIMITS.chance);
const edgeBox = mk("d85-edge", 10, { min: -100 });
const oddsField = field("d85-odds", "Odds: profit on a winning stake of 1", oddsBox, "Even money is 1. Decimal odds are this plus 1, so decimal 2.50 is 1.5.");
const chanceField = field("d85-chance", "Chance of winning (%)", chanceBox, "Your own estimate. Kelly is only as good as this number.");
const edgeField = field("d85-edge", "Edge (% of the stake)", edgeBox, "The expected profit on each stake: 10 means you expect to make 10 for every 100 staked, on average.");
const derived = el("p", { class: "small d85-derived", "aria-live": "polite" });
function showMode() { const chance = modeSeg.value === "chance"; chanceField.hidden = !chance; edgeField.hidden = chance; }

// Your stake: a number box and a slider together.
const stakeBox = mk("d85-stake", 25, LIMITS.stake);
const stakeRange = el("input", { type: "range", min: 0, max: 99, step: 0.1, value: 25, "aria-label": "Your stake, slider" });
stakeBox.addEventListener("input", () => { const v = Number(stakeBox.value); if (stakeBox.value.trim() !== "" && Number.isFinite(v)) stakeRange.value = clamp(v, 0, 99); stakeText(); changed(); });
stakeRange.addEventListener("input", () => { stakeBox.value = String(Number(stakeRange.value)); stakeText(); changed(); });
const stakeText = () => stakeRange.setAttribute("aria-valuetext", `${fmt.num(Number(stakeRange.value), 1)}% of the bankroll`);
stakeText();
const stakeField = el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: "d85-stake", text: "Your stake (% of the bankroll each bet)" })), stakeBox, stakeRange,
  el("div", { class: "hint", text: "Compared with half Kelly, Kelly and twice Kelly below." }), msgFor("d85-stake"));

const betsBox = mk("d85-bets", 1000, LIMITS.bets, 1);
const lineBox = mk("d85-line", 50, LIMITS.line); // any value from 1 to 99 is accepted, so no step that would mark 33.5 invalid
const betsField = field("d85-bets", "Bets in a row", betsBox, `From ${LIMITS.bets.min} to ${fmt.int(LIMITS.bets.max)}.`);
const lineField = field("d85-line", "Ruin line (% of the starting bankroll)", lineBox, "A bettor who never stakes everything never reaches zero, so \"ruin\" here means falling to this share of the start, or below, at any point.");
const bettorsSel = select({ label: "Simulated bettors", value: "2000", options: BETTORS.map((n) => ({ value: String(n), label: fmt.int(n) })), onChange: () => changed() });
const seedBox = mk("d85-seed", 1, LIMITS.seed, 1);
const seedField = el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: "d85-seed", text: "Seed" })), seedBox,
  el("div", { class: "row" }, button("New seed", () => { seedBox.value = String(randomSeed()); changed(); }, { small: true })),
  el("div", { class: "hint", text: "The same bet, settings and seed always give the same bettors." }), msgFor("d85-seed"));
for (const b of [oddsBox, chanceBox, edgeBox, betsBox, lineBox, seedBox]) b.addEventListener("input", () => changed());

function applyExample(ex) {
  modeSeg.value = ex.mode;
  oddsBox.value = String(ex.odds);
  chanceBox.value = String(Number(ex.chance.toFixed(4)));
  stakeBox.value = String(ex.stake);
  stakeRange.value = ex.stake;
  stakeText();
  showMode();
  changed();
}

// Every setting back to where the page opens: the examples change only the bet.
function resetAll() {
  applyExample(EXAMPLES[0]);
  betsBox.value = "1000"; lineBox.value = "50"; seedBox.value = "1"; bettorsSel.value = "2000";
  changed();
}

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row d85-examples", role: "group", "aria-label": "Examples" }, EXAMPLES.map((ex) => button(ex.label, () => applyExample(ex), { small: true }))),
    el("div", { class: "hint", text: "The examples set the bet and your stake; the other settings stay as they are." }),
    el("div", { class: "row" }, button("Back to the opening settings", () => resetAll(), { small: true }))),
  modeSeg.el, oddsField, chanceField, edgeField, derived, stakeField, betsField, lineField, bettorsSel.el, seedField);

/* ---------- outputs ---------- */
const sKelly = stat("Kelly stake");
const sGrowth = stat("Typical growth a bet at Kelly");
const sYours = stat("Your stake");
const edgeNote = el("div");
const status = el("p", { class: "sr-only", role: "status" });
const curveBox = el("div");
const tableHead = el("h2", { text: "Four ways to bet the same edge" });
const tableNote = el("p", { class: "small muted" });
const tableBox = el("div", { class: "d85-rt-box" });
// Not a live region: it changes with every slice of work. The finished result is announced by the status line.
const progress = el("p", { class: "small", tabindex: "-1" }); // takes the focus when the Stop button goes
// A live region is rewritten only when its words change, so a screen reader is not told the same thing twice.
function say(node, text) { if (node.textContent !== text) node.textContent = text; }
const stopBtn = button("Stop", () => stop(), { small: true });
stopBtn.hidden = true;
// Hiding a focused button would drop the keyboard focus to the page, so it moves to the progress line first.
const hideStop = () => { if (document.activeElement === stopBtn) progress.focus(); stopBtn.hidden = true; };
const pathsBox = el("div", { id: "d85-paths" });
const repro = el("p", { class: "small muted" });
const paused = el("div");

const out = el("div", { class: "out" },
  paused,
  el("div", { class: "stats", id: "d85-results" }, sKelly.el, sGrowth.el, sYours.el), status, edgeNote, curveBox,
  el("div", { class: "d85-stack", id: "d85-table" }, tableHead, tableNote, el("div", { class: "row" }, progress, stopBtn), tableBox),
  pathsBox, repro,
  note("", "An illustration of the mathematics, not betting or investment advice. In real life the chance of winning is an estimate, and staking the full Kelly amount on an edge that is smaller than you think is the same as staking more than Kelly."));
const jump = el("nav", { class: "row d85-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d85-results", "Kelly stake"], ["#d85-table", "the four stakes compared"], ["#d85-paths", "simulated bankrolls"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));

const curveChart = chart(curveBox, { series: [], height: 280 });
const bandPick = select({ label: "Show the middle 80% of bettors for", value: "kelly", options: [{ value: "half", label: "Half Kelly" }, { value: "kelly", label: "Kelly" }, { value: "double", label: "Twice Kelly" }, { value: "yours", label: "Your stake" }], onChange: () => drawPaths() });
const pathsChart = chart(pathsBox, { series: [], height: 340 });
pathsBox.prepend(bandPick.el);

/* ---------- reading and checking ---------- */
const num = (box) => (box.value.trim() === "" ? NaN : Number(box.value));
function readAll() {
  const bet = readBet({ mode: modeSeg.value, odds: num(oddsBox), edge: num(edgeBox), chance: num(chanceBox) });
  const errors = [...bet.errors];
  const check = (key, box, lim, whole, what) => {
    const v = num(box);
    if (!Number.isFinite(v) || v < lim.min || v > lim.max || (whole && !Number.isInteger(v))) errors.push({ key, message: `Enter ${what} from ${fmt.int(lim.min)} to ${fmt.int(lim.max)}${whole ? ", a whole number" : ""}.` });
    return v;
  };
  const stake = check("stake", stakeBox, LIMITS.stake, false, "a stake in % of the bankroll");
  const M = check("bets", betsBox, LIMITS.bets, true, "the number of bets");
  const line = check("line", lineBox, LIMITS.line, false, "the ruin line in %");
  const seed = check("seed", seedBox, LIMITS.seed, true, "a seed");
  return { ok: !errors.length, errors, bet, stake: stake / 100, M, line: line / 100, seed, bettors: Number(bettorsSel.value) };
}

function markErrors(errors) {
  const boxes = { odds: oddsBox, chance: chanceBox, edge: edgeBox, stake: stakeBox, bets: betsBox, line: lineBox, seed: seedBox };
  for (const [key, box] of Object.entries(boxes)) {
    const e = errors.find((x) => x.key === key);
    say($(`#${box.id}-msg`), e ? e.message : "");
    box.classList.toggle("invalid", Boolean(e));
    if (e) box.setAttribute("aria-invalid", "true"); else box.removeAttribute("aria-invalid");
  }
}

/* ---------- running ---------- */
let job = 0, run = null;
const changed = debounce(() => start(), 300);

function start() {
  job++;
  const id = job;
  const s = readAll();
  markErrors(s.errors);
  if (!s.ok) {
    paused.replaceChildren(note("warn", "Fix the box marked in red; the results below are from the last settings that worked."));
    progress.textContent = "";
    hideStop();
    return;
  }
  paused.replaceChildren();
  const { p, b, edge } = s.bet;
  say(derived, `That is a ${fmt.num(p * 100, 2)}% chance of winning and an edge of ${fmt.signed(edge * 100, 2)}% of each stake: a stake of 1 returns ${fmt.num(1 + edge, 4)} on average.`);
  const strat = strategies(p, b, s.stake);
  run = { s, p, b, edge, strat, exact: [], sim: null, simStrat: strat.filter((x) => x.possible) };
  drawHeadline();
  // Exact numbers first (one strategy per slice: the dynamic program is M^2 / 2 steps), then the simulation.
  let i = 0;
  const exactStep = () => {
    if (id !== job) return;
    const x = strat[i];
    run.exact[i] = x.possible ? { g: growth(x.f, p, b), end: finalExact(x.f, p, b, s.M), ruin: ruinExact(x.f, p, b, s.M, s.line), longRun: ruinLongRun(x.f, p, b, s.line) } : null;
    i++;
    if (i < strat.length) { setTimeout(exactStep, 0); return; }
    drawTable();
    simulate(id);
  };
  progress.textContent = "Working out the exact chances.";
  setTimeout(exactStep, 0);
}

function simulate(id) {
  const { s, p, b, simStrat } = run;
  const sim = createSimulation({ p, b, M: s.M, bettors: s.bettors, seed: s.seed, stakes: simStrat.map((x) => x.f), line: s.line });
  run.sim = sim;
  stopBtn.hidden = false;
  const slice = () => {
    if (id !== job) return;
    const t0 = performance.now();
    while (sim.done < sim.bettors && performance.now() - t0 < 25) sim.run(20);
    if (sim.done < sim.bettors) {
      progress.textContent = `Simulating bettors: ${fmt.int(sim.done)} of ${fmt.int(sim.bettors)}.`;
      setTimeout(slice, 0);
      return;
    }
    finished(false);
  };
  progress.textContent = `Simulating bettors: 0 of ${fmt.int(sim.bettors)}.`;
  setTimeout(slice, 0);
}

function stop() {
  if (!run?.sim || run.sim.done >= run.sim.bettors) return;
  job++;
  finished(true);
}

function finished(stopped) {
  hideStop();
  const sim = run.sim;
  run.stopped = stopped;
  progress.textContent = sim.done === 0 ? "Stopped before any bettor was simulated. Change a setting to start again."
    : stopped ? `Stopped at ${fmt.int(sim.done)} of ${fmt.int(sim.bettors)} bettors; the simulated figures use those.` : `${fmt.int(sim.done)} bettors simulated, ${fmt.int(run.s.M)} bets each.`;
  drawTable();
  drawPaths();
  const { s } = run;
  repro.textContent = sim.done ? `Seed ${fmt.int(s.seed)}, ${fmt.int(sim.done)} bettors${stopped ? ` (stopped early, of ${fmt.int(sim.bettors)})` : ""}, ${fmt.int(s.M)} bets each. Every stake sees the same wins and losses, so the differences come from the stake alone.` : "";
}

/* ---------- drawing ---------- */
function drawHeadline() {
  const { p, b, edge, s } = run;
  const k = kelly(p, b);
  if (k > 0) {
    sKelly.set(stakePct(k), `of the bankroll each bet: edge ${fmt.num(edge * 100, 2)}% ÷ odds ${fmt.sig(b, 4)}`);
    const g = growth(k, p, b);
    const doubling = g >= Math.LN2 ? "; the typical bankroll more than doubles with every bet" : g > 0 ? `; the typical bankroll doubles in about ${fmt.int(Math.LN2 / g)} ${Math.round(Math.LN2 / g) === 1 ? "bet" : "bets"}` : "";
    sGrowth.set(typical(g), `log growth ${fmt.num(g, 6)} a bet${doubling}`);
  } else {
    sKelly.set("0%", `stake nothing: the edge is ${edge === 0 ? "zero" : `${fmt.signed(edge * 100, 2)}%`}`);
    sGrowth.set("0%", "nothing staked, nothing grows");
  }
  const gy = growth(s.stake, p, b);
  sYours.set(stakePct(s.stake), s.stake === 0 ? "nothing staked, so nothing changes" : `${k > 0 ? `${fmt.sig(s.stake / k, 3)} × Kelly; ` : ""}typical growth ${typical(gy)} a bet${gy < 0 ? ", so it shrinks" : ""}`);
  edgeNote.replaceChildren(...(k > 0 ? [] : [note("warn", `${edge === 0 ? "There is no edge" : `The edge is negative, ${fmt.signed(edge * 100, 2)}% of each stake`}, so Kelly says to stake nothing, and so do half and twice Kelly. Any positive stake shrinks the bankroll in the long run; the comparison below shows what your stake of ${stakePct(s.stake)} would do.`)]));
  drawCurve();
}

function drawCurve() {
  const { p, b, s } = run;
  const k = kelly(p, b);
  const top = clamp(Math.max(3 * k, 1.25 * s.stake, 0.02), 0.02, 0.99);
  const pts = Array.from({ length: 241 }, (_, i) => (top * i) / 240).map((f) => [f * 100, (Math.exp(growth(f, p, b)) - 1) * 100]);
  const gy = (Math.exp(growth(s.stake, p, b)) - 1) * 100;
  // Where growth returns to zero is computed for this bet: about twice Kelly for a small edge, not in general.
  const zero = growthZero(p, b);
  const subtitle = !(k > 0) ? "With no positive edge every stake shrinks the bankroll; the best stake is zero."
    : zero === null ? `Growth peaks at the Kelly stake, ${stakePct(k)}, and stays above zero for any stake short of the whole bankroll.`
    : `Growth peaks at the Kelly stake, ${stakePct(k)}, and falls back to zero at ${stakePct(zero)}, ${fmt.num(zero / k, 2)} times Kelly. Beyond that the typical bankroll shrinks, although every bet is favourable.`;
  curveChart.update({
    title: "Typical growth a bet against the stake",
    subtitle,
    label: "Line chart of the typical growth of the bankroll per bet against the stake as a share of the bankroll",
    x: { label: "Stake (% of the bankroll)", format: (v) => `${fmt.sig(v, 3)}%`, domain: [0, top * 100] },
    y: { label: "Typical growth a bet (%)", format: (v) => `${fmt.sig(v, 3)}%` },
    series: [{ name: "Typical growth a bet", type: "line", data: pts, color: 0 }],
    marks: [
      { type: "hline", y: 0 },
      ...(k > 0 ? [{ type: "vline", x: k * 100, text: "Kelly" }, { type: "vline", x: 2 * k * 100, text: "Twice Kelly" }] : []),
      ...(s.stake <= top ? [{ type: "point", x: s.stake * 100, y: gy, text: "Your stake" }] : []),
    ],
  });
}

function drawTable() {
  const { strat, exact, sim, s } = run;
  const lineText = `${fmt.num(s.line * 100, s.line * 100 % 1 ? 1 : 0)}%`;
  const simIndex = (x) => run.simStrat.indexOf(x);
  const simShare = (x, field) => {
    if (!sim || !sim.done || !x.possible) return "–";
    const w = wilson(sim[field][simIndex(x)], sim.done);
    return `${pct(w.share)} (${pct(w.low)} to ${pct(w.high)})`;
  };
  const cell = (x, i, fn) => (x.possible ? fn(exact[i], x) : "–");
  const rows = [
    { m: "Stake each bet", get: (x) => (x.possible ? stakePct(x.f) : `${stakePct(x.f)}: ${x.f > 1 ? "more than the whole bankroll" : "the whole bankroll"}`) },
    { m: "Typical growth a bet", get: (x, i) => cell(x, i, (e) => typical(e.g)) },
    { m: `Median bankroll after ${fmt.int(s.M)} bets`, get: (x, i) => cell(x, i, (e) => multiple(e.end.logMedian)) },
    { m: `Average bankroll after ${fmt.int(s.M)} bets`, get: (x, i) => cell(x, i, (e) => multiple(e.end.logMean)) },
    { m: "Ends below the start: exact", get: (x, i) => cell(x, i, (e) => pct(e.end.below)) },
    { m: "Ends below the start: simulated (95% interval)", get: (x) => simShare(x, "below") },
    { m: `Falls to ${lineText} at some point: exact`, get: (x, i) => cell(x, i, (e) => pct(e.ruin)) },
    { m: `Falls to ${lineText} at some point: simulated (95% interval)`, get: (x) => simShare(x, "ruined") },
    { m: `Ever falls to ${lineText}, betting for ever (about)`, get: (x, i) => cell(x, i, (e) => pct(e.longRun)) },
  ];
  const table = el("table", { class: "tbl d85-rt" },
    el("caption", { text: `Starting bankroll ×1. Exact figures from the binomial distribution and a dynamic program; simulated ones from ${sim?.done ? fmt.int(sim.done) : "the"} bettors.` }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Measure" }), strat.map((x) => el("th", { scope: "col", class: "num", text: x.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, el("th", { scope: "row", text: r.m }), strat.map((x, i) => el("td", { class: "num", "data-label": x.label, text: r.get(x, i) }))))));
  tableBox.replaceChildren(table);
  const k = kelly(run.p, run.b);
  const impossible = strat.filter((x) => !x.possible);
  tableNote.textContent = [
    "The median is the bankroll half the bettors beat; the average is pulled up by a lucky few and can be enormous while most bettors lose.",
    k === 0 ? "With no positive edge, half, full and twice Kelly are all a stake of zero." : "",
    impossible.length ? `${impossible.map((x) => x.label).join(" and ")} would stake the whole bankroll or more, which one loss would wipe out, so ${impossible.length === 1 ? "it is" : "they are"} left out.` : "",
    "\"Betting for ever\" treats the bankroll's log as a Brownian motion with the bet's drift and spread: a long-run approximation, not a count.",
  ].filter(Boolean).join(" ");
  const ex = exact[1];
  if (ex) say(status, `Kelly stake ${stakePct(strat[1].f)}. ${strat.map((x, i) => (x.possible && exact[i] ? `${x.label} ${stakePct(x.f)}: median bankroll ${multiple(exact[i].end.logMedian)}, chance of falling to ${lineText} ${pct(exact[i].ruin)}.` : "")).join(" ")}`);
}

function drawPaths() {
  if (!run?.sim?.done) return;
  const { sim, b, s } = run;
  const n = sim.done;
  const list = run.simStrat;
  // A band is offered only for a stake that is possible and not zero (with no edge, all three Kelly stakes are zero).
  const usable = (key) => list.some((x) => x.key === key && (x.f > 0 || key === "yours"));
  bandPick.input.querySelectorAll("option").forEach((o) => { o.disabled = !usable(o.value); });
  if (!usable(bandPick.value)) bandPick.value = usable("kelly") ? "kelly" : "yours";
  const pickKey = bandPick.value;
  const L10 = Math.LN10;
  // The bankroll rises with the number of wins, so its quantiles are the bankroll at the wins' quantiles.
  const logAt = (k, f, q) => {
    const t = sim.marks[k];
    if (f <= 0 || t === 0) return 0;
    const col = sim.winsAt[k].slice(0, n).sort();
    const w = col[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
    return (w * Math.log1p(b * f) + (t - w) * Math.log1p(-f)) / L10;
  };
  const order = ["half", "kelly", "double", "yours"];
  const series = [];
  const picked = list.find((x) => x.key === pickKey);
  if (picked) series.push({ name: `Middle 80%: ${picked.label}`, type: "range", color: order.indexOf(picked.key), opacity: 0.16, data: sim.marks.map((t, k) => [t, logAt(k, picked.f, 0.1), logAt(k, picked.f, 0.9)]) });
  for (const x of list) series.push({ name: `${x.label} (${stakePct(x.f)})`, type: "line", color: order.indexOf(x.key), data: sim.marks.map((t, k) => [t, logAt(k, x.f, 0.5)]) });
  const tick = (v) => {
    const x = 10 ** v;
    if (Math.abs(v) >= 6) return `×10${sup(Math.round(v))}`;
    return `×${fmt.sig(x, 2)}`;
  };
  pathsChart.update({
    title: `Median bankroll of ${fmt.int(n)} simulated bettors`,
    subtitle: `As a multiple of the start, on a log scale: each step up is ten times more. The band shows where the middle 80% of bettors are with the chosen stake. Dashed: the start and the ruin line at ${fmt.num(s.line * 100, s.line * 100 % 1 ? 1 : 0)}%.`,
    label: "Line chart of the median simulated bankroll over the bets for each stake, on a log scale",
    x: { label: "Bets", format: (v) => fmt.int(v) },
    y: { label: "Bankroll (multiple of the start)", format: tick },
    series,
    marks: [{ type: "hline", y: 0, text: "Start" }, { type: "hline", y: Math.log10(s.line), text: "Ruin line" }],
    empty: "No bettors simulated",
  });
}

showMode();
start();
