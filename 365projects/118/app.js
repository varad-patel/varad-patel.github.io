// Day 118: Regression to the Mean Simulator. Interface.
import { $, el, fmt, mount, slider, numberField, select, segmented, checkbox, button, stat, note, chart, randomSeed } from "../kit/kit.js";
import { GALTON } from "./data.js";
import {
  LIMITS, SCENARIOS, scenarioById, maxR, checkParams, simulateSteps, sweepSteps, covers,
  PAIRINGS, galtonPairs, galtonSelect,
} from "./logic.js";

mount();

const GALTON_ID = "galton";
const GALTON_DEFAULTS = { pick: "top", share: 0.1, pairing: "midparent", direction: "parents" };
const state = { id: SCENARIOS[0].id, ...defaults(SCENARIOS[0]), pairing: "midparent", direction: "parents" };
function defaults(s) {
  return { r: s.r, pick: s.pick, share: s.share, n: s.n, seed: 20261029, control: false, effect: 0 };
}
const isGalton = () => state.id === GALTON_ID;
const sc = () => scenarioById(state.id);

/* ---------- formatting ---------- */
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
const dp = (s) => (s.kind === "counts" ? 2 : 1);
const val = (s, v) => `${fmt.num(v, dp(s))} ${s.unit}`;
const signed = (s, v) => `${fmt.signed(v, dp(s))} ${s.unit}`;
const shareText = (v) => `${Math.round(v * 100)}%`;
const lowHigh = (pick) => (pick === "top" ? "highest" : "lowest");
const effectText = (s, v) => (v === 0 ? "none" : s.kind === "counts" ? `${fmt.signed(v * 100, 0)}% crashes` : signed(s, v));
const moved = (s, change) => (Math.abs(change) < 0.5 * 10 ** -dp(s) ? `stayed at the same average` : `${change > 0 ? "rose" : "fell"} by ${val(s, Math.abs(change))}`);

/* ---------- controls ---------- */
const scenarioSelect = select({
  label: "Scenario", value: state.id,
  options: [...SCENARIOS.map((s) => ({ value: s.id, label: s.title })), { value: GALTON_ID, label: "Galton's families: real heights, 1880s" }],
  onChange: (v) => { state.id = v; Object.assign(state, v === GALTON_ID ? GALTON_DEFAULTS : defaults(sc())); inputMsg.replaceChildren(); syncControls(); setMode(); run(); },
});
const story = el("p", { class: "small rm-story" });
const rSlider = slider({
  label: "Correlation between the two measurements, r", min: 0, max: 1, step: 0.01, value: state.r,
  format: (v) => fmt.num(v, 2),
  hint: "The share of the spread that is lasting rather than luck. 1: no luck at all. 0: nothing but luck.",
  onInput: (v) => { state.r = v; run(); },
});
const pickSeg = segmented({
  label: "Pick the", value: state.pick,
  options: [{ value: "bottom", label: "Lowest" }, { value: "top", label: "Highest" }],
  onChange: (v) => { state.pick = v; run(); },
});
const shareSlider = slider({
  label: "Share picked", min: 1, max: 50, step: 1, value: state.share * 100, format: (v) => `${v}%`,
  onInput: (v) => { state.share = v / 100; run(); },
});
// The kit's number box reports only valid numbers, so the raw input event is read here to explain invalid ones too.
const nField = numberField({ label: "Number of units", min: LIMITS.nMin, max: LIMITS.nMax, step: 1, value: state.n, hint: `A whole number from ${LIMITS.nMin} to ${fmt.int(LIMITS.nMax)}.` });
nField.input.addEventListener("input", () => readNumbers());
const seedField = numberField({ label: "Random seed", min: 0, max: 4294967295, step: 1, value: state.seed, hint: "The same seed gives the same draw." });
seedField.input.addEventListener("input", () => readNumbers());
const newDraw = button("New random draw", () => { state.seed = randomSeed(); seedField.value = state.seed; inputMsg.replaceChildren(); run(); }, { small: true });
const controlBox = checkbox({ label: "Hold back a random half of the picked group as a control", onChange: (on) => { state.control = on; run(); } });
const effectSlider = slider({
  label: "Real effect", min: -15, max: 15, step: 0.5, value: 0,
  format: (v) => { const s = sc() || SCENARIOS[0]; return effectText(s, s.kind === "counts" ? v / 100 : v); },
  onInput: (v) => { state.effect = sc().kind === "counts" ? v / 100 : v; run(); },
});
const pairingSelect = select({
  label: "Who is compared with whom", value: state.pairing,
  options: Object.entries(PAIRINGS).map(([value, p]) => ({ value, label: p.label })),
  onChange: (v) => { state.pairing = v; run(); },
});
const pairingNote = el("div", { class: "hint" });
pairingSelect.el.append(pairingNote); // inside the field, so it is styled as the field's hint
const directionSeg = segmented({
  label: "Pick on", value: state.direction,
  options: [{ value: "parents", label: "The parents" }, { value: "children", label: "The children" }],
  onChange: (v) => { state.direction = v; run(); },
});
const inputMsg = el("div");
const resetBtn = button("Restore this scenario's settings", () => {
  Object.assign(state, isGalton() ? GALTON_DEFAULTS : defaults(sc()));
  inputMsg.replaceChildren();
  syncControls();
  run();
  resetBtn.focus();
}, { small: true });

const simOnly = el("div", { class: "controls" }, rSlider.el, nField.el, el("div", { class: "field" }, seedField.el, el("div", { class: "row" }, newDraw)));
const controlPart = el("div", { class: "controls rm-control", role: "group", "aria-label": "Control group" }, controlBox.el, effectSlider.el);
const galtonOnly = el("div", { class: "controls" }, pairingSelect.el, directionSeg.el);
const jump = el("a", { class: "rm-jump small", href: "#rm-results" }, "Go to the results");
const controls = el("div", { class: "controls" },
  scenarioSelect.el, story, simOnly, galtonOnly, pickSeg.el, shareSlider.el, controlPart, inputMsg, el("div", { class: "row" }, resetBtn), jump);

/* ---------- outputs ---------- */
const s1 = stat("Picked group, first measurement");
const s2 = stat("Same group, second measurement");
const s3 = stat("Change");
const s4 = stat("Regression alone predicts");
const verdict = el("div");
const status = el("p", { class: "sr-only", role: "status" });
const progress = el("p", { class: "small muted rm-progress", "aria-live": "off" });
const scatterBox = el("div");
const controlOut = el("div", { class: "panel rm-panel" });
const sweepBox = el("div", { class: "rm-sweep" });
const sweepVerdict = el("p", { class: "small" });
const results = el("div", { class: "out", id: "rm-results", tabindex: "-1" },
  el("div", { class: "stats" }, s1.el, s2.el, s3.el, s4.el), verdict, status, scatterBox, controlOut,
  el("div", { class: "rm-sweepwrap" }, el("h2", { class: "rm-h", text: "Testing the formula at every r" }), sweepBox, progress, sweepVerdict));
$("#app").append(el("div", { class: "tool-grid" }, controls, results));

const scatter = chart(scatterBox, { height: 360, series: [], hover: "point" });
const sweepChart = chart(sweepBox, { height: 280, series: [] });

/* ---------- reading the number boxes ---------- */
function readNumbers() {
  const n = Number(nField.input.value), seed = Number(seedField.input.value);
  const problems = [];
  if (nField.input.value.trim() === "" || !Number.isInteger(n) || n < LIMITS.nMin || n > LIMITS.nMax) problems.push(`Number of ${sc().who}: give a whole number from ${LIMITS.nMin} to ${fmt.int(LIMITS.nMax)}.`);
  if (seedField.input.value.trim() === "" || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) problems.push("Random seed: give a whole number from 0 to 4,294,967,295.");
  nField.input.classList.toggle("invalid", problems.some((p) => p.startsWith("Number")));
  seedField.input.classList.toggle("invalid", problems.some((p) => p.startsWith("Random")));
  if (problems.length) { inputMsg.replaceChildren(note("bad", problems.join(" "), " The results below are for the last valid settings.")); return; }
  inputMsg.replaceChildren();
  if (n !== state.n || seed !== state.seed) { state.n = n; state.seed = seed; run(); }
}

function syncControls() {
  const g = isGalton();
  simOnly.hidden = g;
  controlPart.hidden = g;
  galtonOnly.hidden = !g;
  scenarioSelect.value = state.id;
  pickSeg.value = state.pick;
  shareSlider.value = Math.round(state.share * 100);
  if (g) {
    story.textContent = "The family records behind Francis Galton's paper of 1886, as James Hanley transcribed them from Galton's notebook: the heights of parents and their grown-up children. Nothing is simulated.";
    pairingSelect.value = state.pairing;
    directionSeg.value = state.direction;
    return;
  }
  const s = sc();
  story.textContent = `${s.story} In this simulation ${s.treatment} does nothing unless you give it a real effect below. The numbers are illustrations.`;
  rSlider.input.max = maxR(s.kind);
  rSlider.value = state.r;
  nField.el.querySelector("label").textContent = `Number of ${s.who}`;
  nField.value = state.n;
  seedField.value = state.seed;
  controlBox.checked = state.control;
  controlBox.el.querySelector("span").textContent = `Give ${s.treatment} to a random half of the picked ${s.who} only, and hold the rest back as a control`;
  const counts = s.kind === "counts";
  effectSlider.input.min = counts ? -50 : -s.effectMax;
  effectSlider.input.max = counts ? 50 : s.effectMax;
  effectSlider.input.step = counts ? 5 : 0.5;
  effectSlider.el.querySelector("label").textContent = `Real effect of ${s.treatment}`;
  effectSlider.value = counts ? state.effect * 100 : state.effect;
}

/* ---------- running the simulation in slices ---------- */
let job = 0;
function runSliced(gen, id, done) {
  const step = () => {
    if (id !== job) return;
    const start = performance.now();
    for (;;) {
      const s = gen.next();
      if (s.done) { setTimeout(() => { if (id === job) done(s.value); }, 0); return; }
      if (performance.now() - start > 12) break;
    }
    setTimeout(step, 0);
  };
  step();
}

let announceTimer = 0;
const announce = (text) => { clearTimeout(announceTimer); announceTimer = setTimeout(() => { status.textContent = text; }, 700); };

function run() {
  const id = ++job;
  if (isGalton()) { drawGalton(); return; }
  const s = sc();
  const params = { ...s, r: state.r, n: state.n, seed: state.seed, pick: state.pick, share: state.share, control: state.control, effect: state.effect };
  const check = checkParams(params);
  if (check.error) {
    verdict.replaceChildren(note("bad", check.error));
    status.textContent = check.error;
    for (const t of [s1, s2, s3, s4]) t.set("–", "");
    scatter.update({ series: [], marks: [], empty: "Nothing to show: see the message above" });
    sweepChart.update({ series: [], marks: [], empty: "Nothing to show: see the message above" });
    sweepVerdict.textContent = "";
    progress.textContent = "";
    controlOut.hidden = true;
    return;
  }
  progress.textContent = "Simulating.";
  runSliced(simulateSteps(params, 4000), id, (res) => {
    drawSim(s, params, res);
    progress.textContent = "Testing the formula at every r: running.";
    runSliced(sweepSteps({ ...params, n: Math.min(params.n, 20000) }, 4000), id, (sw) => drawSweep(s, params, sw));
  });
}

/* ---------- drawing ---------- */
function dots(points, labelOf) {
  // Equal points are drawn once, larger, so that counts and heights recorded to the half inch do not hide each other.
  const groups = new Map();
  for (const p of points) {
    const k = `${p[0]}|${p[1]}|${p[2]}`;
    const g = groups.get(k);
    if (g) g.count++; else groups.set(k, { x: p[0], y: p[1], g: p[2], count: 1 });
  }
  return [...groups.values()].map((g) => ({ x: g.x, y: g.y, g: g.g, r: Math.min(11, 2.6 + 1.5 * Math.sqrt(g.count - 1)), label: labelOf(g) }));
}

function drawSim(s, params, res) {
  const t = res.treated, c = res.control;
  const who = s.who, n = res.n;
  const pickedText = `the ${lowHigh(params.pick)} ${shareText(params.share)}: ${fmt.int(res.m)} of ${fmt.int(n)} ${who}`;
  // With a control group the tiles describe the treated half; the control half has its own panel.
  const g = t;
  s1.set(val(s, g.xbar), `${s.first}; ${c ? `the treated half (${fmt.int(g.m)}) of ${pickedText}` : pickedText}`);
  s2.set(val(s, g.ybar), s.second);
  s3.set(signed(s, g.change), params.effect ? `real effect set: ${effectText(s, params.effect)}` : `with ${s.treatment} doing nothing`);
  s4.set(signed(s, -g.regression), `(1 − ${fmt.num(params.r, 2)}) × ${fmt.num(Math.abs(g.distance), dp(s))} from the mean of ${fmt.num(s.mean, 0)}`);

  const parts = [];
  const within = g.within
    ? `The simulation is within two standard errors (${fmt.num(2 * g.se, 2)} ${s.unit}) of that.`
    : Number.isFinite(g.z)
      ? `The simulation is ${fmt.num(Math.abs(g.z), 1)} standard errors from that, which chance alone does about 1 time in 20 or less often. Try a new random draw.`
      : "";
  if (!params.effect) {
    parts.push(`The ${c ? "treated half of the " : ""}${who} picked as the ${lowHigh(params.pick)} ${shareText(params.share)} ${s.firstAt} ${moved(s, g.change)} ${s.secondAt}, although ${s.treatment} does nothing here. `);
    parts.push(params.r === 1 ? "With r = 1 there is no luck in either measurement, so nothing moves." : `Regression to the mean alone predicts ${signed(s, -g.regression)}: (1 − r) times the group's distance from the mean. ${within}`);
  } else {
    // predictedChange is the whole expected change; adding back the regression leaves the part the effect accounts for.
    parts.push(`The ${c ? "treated half of the " : ""}${who} picked as the ${lowHigh(params.pick)} ${shareText(params.share)} ${s.firstAt} ${moved(s, g.change)} ${s.secondAt}. Regression to the mean predicts ${signed(s, -g.regression)} and the real effect you set ${signed(s, g.predictedChange + g.regression)}, so ${signed(s, g.predictedChange)} is expected in all. ${within}`);
  }
  verdict.replaceChildren(note(g.within ? "" : "warn", ...parts));
  announce(`${s3.el.querySelector(".l").textContent}: ${signed(s, g.change)}. Regression alone predicts ${signed(s, -g.regression)}.`);

  // Scatter of a random sample of the population.
  const name = (grp) => (grp === 2 ? "held back" : grp === 1 ? (c ? s.treated : "picked") : "not picked");
  const pd = s.kind === "counts" ? 0 : 1;
  const pts = dots(res.plot, (d) => `${d.count > 1 ? `${d.count} ${who}, ${name(d.g)}` : `One ${s.one}, ${name(d.g)}`}: ${fmt.num(d.x, pd)} then ${fmt.num(d.y, pd)}`);
  const xs = res.plot.map((p) => p[0]), ys = res.plot.map((p) => p[1]);
  const lo = Math.min(...xs, ...ys), hi = Math.max(...xs, ...ys);
  const pad = (hi - lo) * 0.03 || 1;
  const domain = s.kind === "counts" ? [Math.max(0, lo - 0.5), hi + 0.5] : [lo - pad, hi + pad];
  const series = [
    { name: "Not picked", type: "scatter", color: "#8a94a3", data: pts.filter((p) => p.g === 0), r: 2.4, opacity: 0.55 },
    { name: c ? `Picked, ${s.treated}` : "Picked", type: "scatter", color: 0, data: pts.filter((p) => p.g === 1), r: 3 },
  ];
  if (c) series.push({ name: "Picked, held back", type: "scatter", color: 1, data: pts.filter((p) => p.g === 2), r: 3 });
  series.push(
    { name: "No change", type: "line", color: "#16233b", dash: true, width: 1.2, hover: false, data: [[domain[0], domain[0]], [domain[1], domain[1]]] },
    { name: "Expected second measurement", type: "line", color: "#16233b", width: 2, hover: false, data: [[domain[0], s.mean + params.r * (domain[0] - s.mean)], [domain[1], s.mean + params.r * (domain[1] - s.mean)]] },
  );
  scatter.update({
    title: `${s.first} against ${s.second.toLowerCase()}`,
    subtitle: `A random sample of ${fmt.int(res.plot.length)} of the ${fmt.int(n)} ${who}. Above the dashed line, the second measurement is higher than the first. The solid line is μ + r (x − μ), the expected second measurement.`,
    label: `Scatter plot of ${s.measure.toLowerCase()} at the ${s.first.toLowerCase()} against the ${s.second.toLowerCase()}`,
    x: { label: `${s.first} (${s.unit})`, domain, format: (v) => fmt.num(v, 0) },
    y: { label: `${s.second} (${s.unit})`, domain, format: (v) => fmt.num(v, 0) },
    series,
    marks: [{ type: "point", x: g.xbar, y: g.ybar, text: c ? "treated half's average" : "picked group's average" }],
  });

  // The randomised comparison.
  controlOut.hidden = !c;
  if (c) {
    const e = res.effect;
    const counts = s.kind === "counts";
    const fmtE = (v) => (counts ? `${fmt.signed(v * 100, 0)}%` : signed(s, v));
    const truth = params.effect;
    let text;
    if (e.error) text = e.error;
    else if (!truth) text = covers(e, 0)
      ? `The interval includes 0: no sign of an effect, which is right, because ${s.treatment} does nothing in this simulation. Both halves ${g.change < 0 ? "fell" : "rose"} because both were picked for being extreme.`
      : `The interval leaves out 0 although ${s.treatment} does nothing here: a false alarm, which a 95% interval gives about 1 time in 20. Try a new random draw.`;
    else text = `${covers(e, truth) ? `The interval includes the real effect you set (${fmtE(truth)})` : `The interval misses the real effect you set (${fmtE(truth)}), which happens about 1 time in 20`}${covers(e, 0) ? ", but it also includes 0: too few units to tell the effect from none." : ", and leaves out 0, so the comparison detects it."} The before-and-after change of the treated half, ${signed(s, g.change)}, mixes the effect with regression to the mean.`;
    controlOut.replaceChildren(
      el("h2", { class: "rm-h", text: "With a control group" }),
      el("div", { class: "stats" },
        stat(`Treated half (${fmt.int(g.m)})`, signed(s, g.change), `${s.first} to ${s.second.toLowerCase()}`).el,
        stat(`Held-back half (${fmt.int(res.control.m)})`, signed(s, res.control.change), `given nothing`).el,
        stat(counts ? `Treated against held back, ${s.second.toLowerCase()}` : `Difference at the ${s.second.toLowerCase()}`, e.error ? "–" : fmtE(e.estimate), e.error ? "" : `95% interval ${fmtE(e.low)} to ${fmtE(e.high)}`).el),
      el("p", { class: "small" }, text));
  }
}

function drawSweep(s, params, sw) {
  const rows = sw.rows;
  sweepChart.update({
    title: "Share of the distance to the mean won back, against r",
    subtitle: `Each dot is a separate simulation of ${fmt.int(Math.min(params.n, 20000))} ${s.who} with nothing done to them; the band is two standard errors either side. The line is 1 − r.`,
    label: "Chart of the simulated share of the distance won back against r, with the line 1 minus r",
    x: { label: "r", domain: [0, 1], format: (v) => fmt.num(v, 1) },
    y: { label: "Share won back", format: (v) => fmt.num(v, 1) },
    series: [
      { name: "Two standard errors", type: "range", color: 0, hover: false, data: rows.map((row) => [row.r, row.share - 2 * row.se, row.share + 2 * row.se]) },
      { name: "Formula, 1 − r", type: "line", color: "#16233b", data: rows.map((row) => [row.r, row.expected]) },
      { name: "Simulated", type: "scatter", color: 0, data: rows.map((row) => [row.r, row.share]), r: 3.5 },
    ],
    marks: [{ type: "vline", x: params.r, text: `your r, ${fmt.num(params.r, 2)}` }],
  });
  progress.textContent = "";
  // The verdict on the formula is the binomial chance of that many checks falling outside by luck alone.
  const odds = sw.outside
    ? ` Chance alone puts ${sw.outside === 1 ? "at least one" : `${sw.outside} or more`} of ${sw.checks} checks outside ${fmt.pct(sw.chance, sw.chance < 0.01 ? 2 : 0)} of the time${sw.chance < 0.01 ? ", so the formula looks wrong for this model" : ""}.`
    : "";
  sweepVerdict.textContent = `At ${rows.length} values of r from 0 to ${fmt.num(rows.at(-1).r, 2)}, the simulated share is within two standard errors of 1 − r at ${sw.within} of them. About 1 check in 20 falls outside by chance alone.${odds}`;
}

function drawGalton() {
  const pairs = galtonPairs(GALTON, state.pairing);
  const p = PAIRINGS[state.pairing];
  pairingNote.textContent = p.note;
  const g = galtonSelect(pairs, { direction: state.direction, pick: state.pick, share: state.share });
  const byParents = state.direction === "parents";
  const [selName, othName] = byParents ? [p.parent, p.child] : [p.child, p.parent];
  const inch = (v) => `${fmt.num(v, 1)} in`;
  const tallShort = state.pick === "top" ? "tallest" : "shortest";
  const tiedNote = g.m !== g.want ? ` (${g.m} rather than ${g.want}, because heights tied at ${fmt.num(g.cut, 2)} in are all included)` : "";
  s1.set(inch(g.sbar), `${selName}, the ${tallShort} ${shareText(state.share)}: ${plural(g.m, "pair", "pairs")}${tiedNote}; mean of all ${inch(g.muS)}`);
  s2.set(inch(g.obar), `${othName}; mean of all ${inch(g.muO)}`);
  s3.set(`${fmt.num(g.share, 2)}`, "of the distance from the mean won back, in standard units");
  s4.set(`${fmt.num(1 - g.r, 2)}`, `1 − r, with r = ${fmt.num(g.r, 2)} in these ${fmt.int(g.n)} pairs`);
  const dist = g.sbar - g.muS, other = g.obar - g.muO;
  const side = (d) => `${fmt.num(Math.abs(d), 1)} in ${d >= 0 ? "above" : "below"} the mean`;
  const within = Math.abs(g.z) <= 2;
  const [selPl, othPl] = byParents ? [p.parents, p.children] : [p.children, p.parents];
  verdict.replaceChildren(note(within ? "" : "warn",
    `Picked as the ${tallShort} ${shareText(state.share)} of ${selPl}, ${plural(g.m, "pair", "pairs")}: the ${selPl} average ${inch(g.sbar)}, ${side(dist)}, and their ${othPl} average ${inch(g.obar)}, ${side(other)}. `,
    `The regression line predicts ${inch(g.predicted)}; the data are ${within ? "within" : "outside"} two standard errors of it (${fmt.num(2 * g.se, 2)} in, allowing for brothers and sisters sharing parents). `,
    byParents ? "Now pick on the children: their parents are nearer the mean too, and children cannot make their parents shorter." : "Picked on the children, the pull runs backwards in time, which no cause can do."));
  announce(`${selName}: ${inch(g.sbar)}. ${othName}: ${inch(g.obar)}. Share won back ${fmt.num(g.share, 2)} against 1 minus r of ${fmt.num(1 - g.r, 2)}.`);

  const picked = new Set(g.idx);
  const pts = dots(pairs.x.map((x, i) => [x, pairs.y[i], picked.has(i) ? 1 : 0]), (d) => `${d.count > 1 ? `${d.count} pairs` : "One pair"}${d.g ? ", picked" : ""}: ${p.parent.toLowerCase()} ${fmt.num(d.x, 1)}, ${p.child.toLowerCase()} ${fmt.num(d.y, 1)}`);
  const xs = pairs.x, ys = pairs.y;
  const xd = [Math.min(...xs) - 0.5, Math.max(...xs) + 0.5], yd = [Math.min(...ys) - 0.5, Math.max(...ys) + 0.5];
  const fit = (x) => g.muO + g.slope * (x - g.muS);
  // The regression line of the other side on the picked side, drawn in the chart's own axes (parents across, children up).
  const line = byParents
    ? [[xd[0], fit(xd[0])], [xd[1], fit(xd[1])]]
    : [[fit(yd[0]), yd[0]], [fit(yd[1]), yd[1]]];
  scatter.update({
    title: `${p.parent} and ${p.child.toLowerCase()}`,
    subtitle: `Each dot is a child in Galton's records; larger dots hold several with the same heights. The line is the average ${othName.toLowerCase()} for each ${selName.toLowerCase()}.`,
    label: `Scatter plot of ${p.child.toLowerCase()} against ${p.parent.toLowerCase()} in Galton's family records`,
    x: { label: `${p.parent} (inches)`, domain: xd, format: (v) => fmt.num(v, 0) },
    y: { label: `${p.child} (inches)`, domain: yd, format: (v) => fmt.num(v, 0) },
    series: [
      { name: "Not picked", type: "scatter", color: "#8a94a3", data: pts.filter((d) => !d.g), r: 2.6, opacity: 0.6 },
      { name: "Picked", type: "scatter", color: 0, data: pts.filter((d) => d.g), r: 3 },
      { name: `Regression of ${othName.toLowerCase()} on ${selName.toLowerCase()}`, type: "line", color: "#16233b", width: 2, hover: false, data: line },
    ],
    marks: [{ type: "point", x: byParents ? g.sbar : g.obar, y: byParents ? g.obar : g.sbar, text: "picked group's average" }],
  });
  controlOut.hidden = true;
}

function setMode() {
  const g = isGalton();
  $(".rm-sweepwrap").hidden = g;
  const labels = g
    ? ["Picked side, average", "Other side, average", "Share won back", "Formula: 1 − r"]
    : ["Picked group, first measurement", "Same group, second measurement", "Change", "Regression alone predicts"];
  [s1, s2, s3, s4].forEach((t, i) => { t.el.querySelector(".l").textContent = labels[i]; });
}

syncControls();
setMode();
run();
