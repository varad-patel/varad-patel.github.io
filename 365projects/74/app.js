// Day 74: Central Bank Simulator. Interface.
import { $, el, fmt, mount, slider, segmented, numberField, button, stat, note, table, chart, randomSeed } from "../kit/kit.js";
import {
  GALI, slope, TARGET, neutralRate, welfareWeight, determinacy, impulse, sunspot, SHOCKS, QUARTERS, shockPath, quarter, rateEffect,
  loss, RATE, STRATEGIES, play, verdict,
} from "./logic.js";

mount();

const W = welfareWeight();
const NEUTRAL = neutralRate();
const EFFECT = rateEffect();
const pct = (v, d = 1) => `${fmt.num(v, d)}%`;
const signedPct = (v, d = 1) => `${fmt.signed(v, d)}%`;
const OPENING_SEED = 2026;

/* ======================================================= the game */

const game = { seed: OPENING_SEED, path: shockPath(OPENING_SEED), rows: [] };
const current = () => game.rows.length; // quarters played so far
const lastOutcome = () => game.rows.at(-1) ?? { rate: Math.round(NEUTRAL / RATE.step) * RATE.step, inflation: TARGET, gap: 0, start: true };

const rateSlider = slider({
  label: "Interest rate for this quarter", min: RATE.min, max: RATE.max, step: RATE.step, value: lastOutcome().rate,
  format: (v) => `${fmt.num(v, 2)}% a year`,
  hint: "Arrow keys move it a quarter point; Enter sets it.",
});
rateSlider.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
const setBtn = button("Set the rate", () => commit(), { primary: true });
const newBtn = button("New game", () => start(randomSeed() % 1000000), { small: true });
const replayBtn = button("Replay these shocks", () => start(game.seed), { small: true });
const seedField = numberField({
  label: "Shocks number", min: 0, max: 999999, step: 1, value: game.seed,
  hint: "The same number always brings the same shocks: share it to compare scores.",
});
const seedMsg = el("div");
const seedBtn = button("Play this number", () => {
  const v = seedField.value;
  if (!Number.isInteger(v)) { seedMsg.replaceChildren(note("bad", "Type a whole number from 0 to 999,999.")); seedField.input.focus(); return; }
  seedMsg.replaceChildren();
  start(v);
}, { small: true });
seedField.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); seedBtn.click(); } });

const qHead = el("h2");
const sInf = stat("Inflation last quarter"), sGap = stat("Output gap last quarter"), sRate = stat("Your rate last quarter"), sScore = stat("Your score so far");
const scoreRule = el("p", { class: "small muted" },
  "Each quarter's loss is (inflation − 2)² + ", el("span", { class: "nowrap", text: `${fmt.num(W, 3)} × (output gap)²` }),
  ", with inflation in percent a year and the gap in percent. Your score is the average loss over the quarters played; lower is better.");
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div");
const effect = el("p", { class: "hint", text: `In this model one point on the rate lowers this quarter's inflation by ${fmt.num(-EFFECT.inflation, 2)} points and the output gap by ${fmt.num(-EFFECT.gap, 2)} percentage points. The neutral rate, at which nothing moves when no shock hits, is ${fmt.num(NEUTRAL, 2)}%.` });

const gameControls = el("div", { class: "controls" }, qHead, rateSlider.el, el("div", { class: "row" }, setBtn), effect, message);
// Starting again sits under the rate on a wide screen and after the results on a narrow one (see the page's style).
const restart = el("div", { class: "controls restart", role: "group", "aria-label": "Start again" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Start again" })), el("div", { class: "row" }, newBtn, replayBtn)),
  seedField.el, el("div", { class: "row" }, seedBtn), seedMsg);

const infBox = el("div"), gapBox = el("div"), results = el("div");
const gameOut = el("div", { class: "out" },
  el("div", { class: "stats" }, sInf.el, sGap.el, sRate.el, sScore.el), scoreRule, status, infBox, gapBox, results);
const infChart = chart(infBox, { series: [], height: 280 });
const gapChart = chart(gapBox, { series: [], height: 220 });

function start(seed) {
  game.seed = seed;
  game.path = shockPath(seed);
  game.rows = [];
  seedField.value = seed;
  rateSlider.value = lastOutcome().rate;
  results.replaceChildren();
  message.replaceChildren();
  status.textContent = `New game, shocks number ${seed}. Quarter 1 of ${QUARTERS}: the economy starts at the 2% target with no output gap.`;
  draw();
  rateSlider.input.focus();
}

function commit() {
  if (current() >= QUARTERS) return;
  const rate = rateSlider.value;
  const s = game.path[current()];
  const o = quarter(rate, s);
  const row = { ...o, loss: loss(o, W) };
  game.rows.push(row);
  const q = current();
  const avg = game.rows.reduce((a, r) => a + r.loss, 0) / q;
  status.textContent = `Quarter ${q}: at ${fmt.num(rate, 2)}%, inflation was ${pct(o.inflation)} and the output gap ${signedPct(o.gap)}; loss ${fmt.num(row.loss, 2)}, score so far ${fmt.num(avg, 2)}.`
    + (q >= QUARTERS ? " The game is over: the results follow." : "");
  draw();
  if (q >= QUARTERS) finish(); else rateSlider.input.focus();
}

function draw() {
  const q = current(), done = q >= QUARTERS, L = lastOutcome();
  qHead.textContent = done ? `Game over: ${QUARTERS} quarters played` : `Quarter ${q + 1} of ${QUARTERS}`;
  rateSlider.input.disabled = done;
  setBtn.disabled = done;
  if (L.start) {
    sInf.set(pct(TARGET), "the economy starts at the target");
    sGap.set("0.0%", "output at its natural level");
    sRate.set(`${fmt.num(L.rate, 2)}%`, "the step nearest the neutral rate");
    sScore.set("–", "set a rate to begin");
  } else {
    sInf.set(pct(L.inflation), `target 2%; ${L.inflation > TARGET + 0.05 ? "above" : L.inflation < TARGET - 0.05 ? "below" : "on"} target`);
    sGap.set(signedPct(L.gap), L.gap > 0.05 ? "output above its natural level" : L.gap < -0.05 ? "output below its natural level" : "output at its natural level");
    sRate.set(`${fmt.num(L.rate, 2)}%`, `loss that quarter ${fmt.num(L.loss, 2)}`);
    sScore.set(fmt.num(game.rows.reduce((a, r) => a + r.loss, 0) / q, 2), `average loss over ${q} ${q === 1 ? "quarter" : "quarters"}`);
  }
  const xs = game.rows.map((_, i) => i + 1);
  const ghost = done ? play(game.path, "best") : null;
  // Axes that do not jump about as quarters arrive: rates and inflation in at least 0 to 8, the gap in at least -1.5 to 1.5.
  const levels = [...game.rows.flatMap((r) => [r.inflation, r.rate]), ...(ghost ? ghost.rows.map((r) => r.inflation) : [])];
  const gapsSeen = [...game.rows.map((r) => r.gap), ...(ghost ? ghost.rows.map((r) => r.gap) : [])];
  const yTop = Math.ceil(Math.max(8, ...levels)), yBottom = Math.floor(Math.min(0, ...levels));
  const gMax = Math.ceil(Math.max(1.5, ...gapsSeen.map(Math.abs)) * 2) / 2;
  infChart.update({
    title: "Inflation and your interest rate",
    subtitle: done ? "Grey dashes: inflation under the best possible rates given each quarter's previous figures." : `Shocks number ${game.seed}. Each quarter you see only what has already happened.`,
    label: "Line chart of inflation and the interest rate by quarter",
    x: { label: "Quarter", domain: [0.5, QUARTERS + 0.5], format: (v) => fmt.int(v) },
    y: { label: "Percent a year", domain: [yBottom, yTop], format: (v) => fmt.num(v, 0) },
    series: [
      { name: "Inflation", type: "line", data: xs.map((x, i) => [x, game.rows[i].inflation]), color: 1, width: 2 },
      { name: "Your rate", type: "step", data: xs.map((x, i) => [x, game.rows[i].rate]), color: 0, width: 2 },
      ...(ghost ? [{ name: "Inflation, best possible", type: "line", data: ghost.rows.map((r, i) => [i + 1, r.inflation]), color: "#8a94a3", width: 1.4, dash: true }] : []),
    ],
    marks: [{ type: "hline", y: TARGET, text: "Target 2%" }],
    empty: "Set the first quarter's rate to begin",
  });
  gapChart.update({
    title: "Output gap",
    subtitle: "Output against its natural level, the level it would reach if prices were flexible.",
    label: "Line chart of the output gap by quarter",
    x: { label: "Quarter", domain: [0.5, QUARTERS + 0.5], format: (v) => fmt.int(v) },
    y: { label: "Percent", domain: [-gMax, gMax], format: (v) => fmt.num(v, 1) },
    series: [
      { name: "Output gap", type: "line", data: xs.map((x, i) => [x, game.rows[i].gap]), color: 2, width: 2 },
      ...(ghost ? [{ name: "Output gap, best possible", type: "line", data: ghost.rows.map((r, i) => [i + 1, r.gap]), color: "#8a94a3", width: 1.4, dash: true }] : []),
    ],
    marks: game.rows.length ? [{ type: "hline", y: 0, text: "Natural level" }] : [],
    empty: "Set the first quarter's rate to begin",
  });
}

function finish() {
  const avg = game.rows.reduce((a, r) => a + r.loss, 0) / QUARTERS;
  const others = Object.fromEntries(Object.keys(STRATEGIES).map((k) => [k, play(game.path, k, W)]));
  const v = verdict(avg, others);
  const rows = [
    { who: "You", score: avg, infl: mean(game.rows.map((r) => Math.abs(r.inflation - TARGET))), gap: mean(game.rows.map((r) => Math.abs(r.gap))) },
    ...Object.entries(others).map(([k, g]) => ({ who: STRATEGIES[k].short, score: g.average, infl: mean(g.rows.map((r) => Math.abs(r.inflation - TARGET))), gap: mean(g.rows.map((r) => Math.abs(r.gap))) })),
  ];
  const word = (k) => (v.beaten.includes(k) ? "beat" : v.tied.includes(k) ? "tied with" : "did worse than");
  results.replaceChildren(el("div", { class: "panel stack" },
    el("h2", { text: "How you did, on the same shocks" }),
    table({
      caption: `Shocks number ${game.seed}, ${QUARTERS} quarters. Score: average of (inflation − 2)² + ${fmt.num(W, 3)} × (output gap)²; lower is better.`,
      columns: [
        { key: "who", label: "Who set the rate" },
        { key: "score", label: "Score", num: true, format: (x) => fmt.num(x, 2) },
        { key: "infl", label: "Average miss on inflation", num: true, format: (x) => `${fmt.num(x, 2)} points` },
        { key: "gap", label: "Average size of the gap", num: true, format: (x) => `${fmt.num(x, 2)}%` },
      ],
      rows,
    }),
    el("ul", { class: "small verdicts" },
      el("li", { text: `You ${word("neutral")} holding 6% throughout, the trivial strategy.` }),
      el("li", { text: `You ${word("best")} the best that anyone could expect to do with last quarter's figures and a perfect knowledge of the model. Beating it in one game is luck: on average over many games, nothing that sees only past figures can.` }),
      el("li", { text: `You ${word("rule")} the rule the public expects, applied to this quarter's figures, which no central bank has when it decides.` })),
    el("div", { class: "row" }, button("Play again with new shocks", () => start(randomSeed() % 1000000), { primary: true }), button("Replay these shocks", () => start(game.seed)))));
  status.textContent += ` Your score ${fmt.num(avg, 2)}; holding 6% scored ${fmt.num(others.neutral.average, 2)}, the best possible with last quarter's figures ${fmt.num(others.best.average, 2)}.`;
  results.querySelector("h2").setAttribute("tabindex", "-1");
  results.querySelector("h2").focus();
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

/* ======================================================= the model lab */

const lab = { phiPi: 1.5, phiX: 0.5, shock: "r", rho: SHOCKS.r.rho };
const RHO = { r: SHOCKS.r.rho, u: SHOCKS.u.rho, v: SHOCKS.v.rho };
const piSlider = slider({ label: "Response to inflation, φπ", min: 0, max: 3, step: 0.05, value: lab.phiPi, format: (v) => fmt.num(v, 2), hint: "Points on the rate per point of inflation (both a year).", onInput: (v) => { lab.phiPi = v; drawLab(); } });
const xSlider = slider({ label: "Response to the output gap, φx", min: 0, max: 2, step: 0.05, value: lab.phiX, format: (v) => fmt.num(v, 2), hint: "Points on the rate a year per percent of output gap. Galí's 0.125 a quarter is 0.5 here.", onInput: (v) => { lab.phiX = v; drawLab(); } });
const shockSeg = segmented({
  label: "Shock", value: lab.shock,
  options: [{ value: "r", label: "Demand" }, { value: "u", label: "Cost push" }, { value: "v", label: "Monetary policy" }],
  onChange: (v) => { lab.shock = v; lab.rho = RHO[v]; rhoSlider.value = lab.rho; drawLab(); },
});
const rhoSlider = slider({ label: "Persistence of the shock, ρ", min: 0, max: 0.95, step: 0.05, value: lab.rho, format: (v) => fmt.num(v, 2), hint: "The share of the shock left after each quarter.", onInput: (v) => { lab.rho = v; drawLab(); } });
const setRule = (pi, x) => { lab.phiPi = pi; lab.phiX = x; piSlider.value = pi; xSlider.value = x; drawLab(); };
const labPresets = el("div", { class: "row" },
  button("Taylor: 1.5 and 0.5", () => setRule(1.5, 0.5), { small: true }),
  button("Passive: 0.8 and 0", () => setRule(0.8, 0), { small: true }),
  button("Aggressive: 3 and 0", () => setRule(3, 0), { small: true }));
const labVerdict = el("div");
const labStatus = el("p", { class: "sr-only", role: "status" });
const irfBox = el("div"), sunBox = el("div");
const labControls = el("div", { class: "controls" }, el("h2", { text: "Inside the model" }),
  el("p", { class: "small", text: "Give the central bank a rule, hit the economy with one shock of a point a year, and watch the model's answer." }),
  piSlider.el, xSlider.el, labPresets, shockSeg.el, rhoSlider.el);
const labOut = el("div", { class: "out" }, labVerdict, labStatus, irfBox, sunBox);
const irfChart = chart(irfBox, { series: [], height: 280 });
const sunChart = chart(sunBox, { series: [], height: 240 });
const SHOCK_NAME = { r: "a rise in the natural rate of interest (demand)", u: "a cost-push shock", v: "a monetary policy shock" };

function drawLab() {
  const rule = { phiPi: lab.phiPi, phiY: lab.phiX / 4 };
  const d = determinacy(rule);
  const idxText = `κ(φπ − 1) + (1 − β)φx/4 = ${fmt.num(d.index, 4)}`;
  const mods = d.moduli.map((m) => fmt.num(m, 3)).join(" and ");
  const path = impulse(rule, lab.shock, lab.rho, 0.25, 16);
  const ss = sunspot(rule, 16);
  const biggest = path ? Math.max(...path.flatMap((p) => [Math.abs(p.y), Math.abs(p.pi), Math.abs(p.i)])) : Infinity;
  // With one root of A outside the unit circle, the simplest solution has no finite form when rho equals the decay
  // rate of the self-fulfilling path (rho times that root is 1), and grows without limit as rho approaches it.
  const resonance = !path
    ? ` With this persistence the shock fades at exactly the rate of the self-fulfilling path${ss ? ` (${fmt.num(ss.mu, 3)} a quarter)` : ""}, so not even the simplest solution exists: change ρ or the rule to see one.`
    : !d.unique && biggest > 5 ? ` The responses drawn are this large because the shock fades at nearly the rate of the self-fulfilling path (ρ = ${fmt.num(lab.rho, 2)} against ${ss ? fmt.num(ss.mu, 3) : "its rate"}); at equal rates the simplest solution does not exist.` : "";
  labVerdict.replaceChildren(d.unique
    ? note("good", el("strong", { text: "Unique equilibrium. " }), `${idxText}, above zero, so the rule obeys the Taylor principle in this model (both roots of A have modulus below 1: ${mods}).`)
    : note("warn", el("strong", { text: "No unique equilibrium. " }), `${idxText}, not above zero (roots of A: ${mods}). The rule does not pin inflation down: ${path ? "the path drawn is the simplest of infinitely many that satisfy the model, and " : ""}beliefs alone can move the economy, as the ${path ? "second " : ""}chart shows.${resonance}`));
  irfBox.hidden = !path;
  if (path) irfChart.update({
    title: `Response to ${SHOCK_NAME[lab.shock]}`,
    subtitle: `A shock of 1 point a year that keeps ${fmt.num(lab.rho, 2)} of its size each quarter. Deviations from the steady state.`,
    label: `Line chart of the output gap, inflation and the interest rate after ${SHOCK_NAME[lab.shock]}`,
    x: { label: "Quarters after the shock", format: (v) => fmt.int(v) },
    y: { label: "Points (percent for the gap)", format: (v) => fmt.num(v, 1) },
    series: [
      { name: "Output gap, %", type: "line", data: path.map((p) => [p.t, p.y]), color: 2, width: 2 },
      { name: "Inflation, points a year", type: "line", data: path.map((p) => [p.t, p.pi]), color: 1, width: 2 },
      { name: "Interest rate, points a year", type: "line", data: path.map((p) => [p.t, p.i]), color: 0, width: 2 },
    ],
    marks: [{ type: "hline", y: 0 }],
  });
  sunBox.hidden = !ss;
  if (ss) {
    sunChart.update({
      title: "A self-fulfilling path: no shock at all",
      subtitle: `If everyone comes to expect higher inflation, the rule's weak response lets it happen. Each quarter the path keeps ${fmt.num(ss.mu, 3)} of its size, and it satisfies every equation of the model.`,
      label: "Line chart of a sunspot equilibrium path of output gap, inflation and the interest rate",
      x: { label: "Quarters", format: (v) => fmt.int(v) },
      y: { label: "Points (percent for the gap)", format: (v) => fmt.num(v, 1) },
      series: [
        { name: "Output gap, %", type: "line", data: ss.path.map((p) => [p.t, p.y]), color: 2, width: 2 },
        { name: "Inflation, points a year", type: "line", data: ss.path.map((p) => [p.t, p.pi]), color: 1, width: 2 },
        { name: "Interest rate, points a year", type: "line", data: ss.path.map((p) => [p.t, p.i]), color: 0, width: 2 },
      ],
      marks: [{ type: "hline", y: 0 }],
    });
  }
  labStatus.textContent = path
    ? `${d.unique ? "Unique equilibrium" : "No unique equilibrium"}. On impact: output gap ${fmt.signed(path[0].y, 2)}%, inflation ${fmt.signed(path[0].pi, 2)} points, interest rate ${fmt.signed(path[0].i, 2)} points.`
    : "No unique equilibrium, and no simplest solution at this persistence of the shock.";
}

/* ======================================================= assemble */

const params = el("details", { class: "params small" },
  el("summary", { text: "The model's numbers" }),
  el("p", { text: `Galí's calibration: σ = ${GALI.sigma}, φ = ${GALI.phi}, β = ${GALI.beta}, ε = ${GALI.epsilon}, α = ${GALI.alpha}, θ = ${GALI.theta}, so κ = ${fmt.num(slope().kappa, 4)}. `
    + `The public expects φπ = ${GALI.phiPi} and φy = ${GALI.phiY} a quarter. Game shocks (this page's choice): natural rate ρ = ${SHOCKS.r.rho}, standard deviation ${fmt.num(4 * SHOCKS.r.sd, 2)} points a year; `
    + `cost push ρ = ${SHOCKS.u.rho}, ${fmt.num(4 * SHOCKS.u.sd, 2)} points a year; departures from the rule are read as policy shocks with ρ = ${SHOCKS.v.rho}.` }));
$("#app").append(
  el("div", { class: "tool-grid game-grid" }, gameControls, gameOut, restart),
  params,
  note("", "A simplified textbook economy for learning, not a model of any real country, and not a forecast."),
  el("div", { class: "tool-grid model-lab" }, labControls, labOut));

draw();
drawLab();
status.textContent = `Quarter 1 of ${QUARTERS}. The economy starts at the 2% target with no output gap. Set a rate.`;
