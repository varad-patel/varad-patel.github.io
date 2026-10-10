// Day 17: Occam's Razor Lab. Interface.
import { $, el, fmt, mount, slider, select, numberField, checkbox, button, stat, note, table, chart, debounce, palette, randomSeed } from "../kit/kit.js";
import { X_MIN, X_MAX, CRITERIA, TRUTHS, truthOf, generate, fitPolynomials, curve, picks, experiment, summarise } from "./logic.js";

mount();

const RUNS = 1000;
const COLOR = { aic: 0, bic: 1, loo: 2, aicc: 3 };
const LABEL = Object.fromEntries(CRITERIA.map((c) => [c.key, c.label]));
const state = { truth: "quadratic", noise: 1, n: 30, seed: 17, points: [], custom: false, sampled: false, degree: 2, showTruth: true, showAll: false, fit: null, timer: 0, run: 0 };
const deg = (d) => (d == null ? "–" : `degree ${d}`);

/* ---------- controls ---------- */
const degSlider = slider({
  label: "Degree shown", min: 0, max: 8, step: 1, value: state.degree, format: (v) => String(v),
  hint: "0 is a flat line, 1 a straight line, 2 a parabola. Each step adds one more coefficient to fit.",
  onInput: (v) => { stopPlay(); state.degree = v; draw(); },
});
const playBtn = button("Play through the degrees", () => {
  if (state.timer) return stopPlay();
  if (!state.fit) return;
  state.degree = 0;
  draw();
  playBtn.textContent = "Stop";
  state.timer = setInterval(() => {
    if (!state.fit || state.degree >= state.fit.top) return stopPlay();
    state.degree++;
    draw();
  }, 800);
}, { small: true });
function stopPlay() {
  clearInterval(state.timer);
  state.timer = 0;
  playBtn.textContent = "Play through the degrees";
}
const truthBox = checkbox({ label: "Show the curve the sample came from", checked: true, onChange: (on) => { state.showTruth = on; draw(); } });
const allBox = checkbox({ label: "Show every degree faintly", checked: false, onChange: (on) => { state.showAll = on; draw(); } });

const truthSel = select({
  label: "True curve", value: state.truth,
  options: TRUTHS.map((t) => ({ value: t.id, label: `${t.label} (${t.degree ? `degree ${t.degree}` : "not a polynomial"})` })),
  onChange: (v) => { state.truth = v; regenerate(); },
});
const noiseSlider = slider({
  label: "Noise", min: 0.1, max: 3, step: 0.1, value: state.noise, format: (v) => `sd ${fmt.num(v, 1)}`,
  hint: "The standard deviation of the random error added to each point. The curves span about 6 units.",
  onInput: (v) => { state.noise = v; regenerate(); },
});
const nSlider = slider({ label: "Points in the sample", min: 5, max: 200, step: 1, value: state.n, format: fmt.int, onInput: (v) => { state.n = v; regenerate(); } });
const seedField = numberField({ label: "Seed", min: 0, max: 999999, step: 1, value: state.seed, hint: "The same seed always draws the same sample." });
const seedNote = el("div");
seedField.input.addEventListener("input", () => {
  const v = seedField.value;
  if (!Number.isInteger(v)) { seedNote.replaceChildren(note("bad", "The seed must be a whole number from 0 to 999,999.")); return; }
  state.seed = v;
  regenerate();
});

// Typing a point in does the same as clicking the chart, for anyone not using a pointer.
const xField = numberField({ label: "x", min: X_MIN, max: X_MAX, value: 5 });
const yField = numberField({ label: "y", min: -1000, max: 1000, value: 5 });
const pointNote = el("div");
function addTyped() {
  const x = xField.value, y = yField.value;
  if (Number.isNaN(x) || Number.isNaN(y)) { pointNote.replaceChildren(note("bad", `A point needs x between ${X_MIN} and ${X_MAX} and y between -1,000 and 1,000.`)); return; }
  pointNote.replaceChildren();
  state.points.push({ x, y });
  state.custom = true;
  refit();
}

const controls = el("div", { class: "controls" },
  el("h3", { text: "Add points" }),
  el("p", { class: "small muted", text: "Click anywhere on the chart to place a point of your own, or type one in." }),
  el("div", { class: "xy" }, xField.el, yField.el, button("Add", addTyped, { small: true })),
  pointNote,
  el("div", { class: "row" },
    button("Undo last point", () => { state.points.pop(); state.custom = true; refit(); }, { small: true }),
    button("Clear all points", () => { state.points = []; state.custom = true; state.sampled = false; refit(); }, { small: true })),
  el("h3", { text: "Or draw a sample" }),
  truthSel.el, noiseSlider.el, nSlider.el, seedField.el, seedNote,
  el("div", { class: "row" }, button("New sample", () => { state.seed = randomSeed() % 1000000; seedField.value = state.seed; regenerate(); }, { primary: true, small: true })));
const modelBar = el("div", { class: "modelbar" }, degSlider.el, playBtn, el("div", { class: "row" }, truthBox.el, allBox.el));

/* ---------- outputs ---------- */
const tiles = { aic: stat("AIC picks"), bic: stat("BIC picks"), loo: stat("Leave-one-out picks"), rss: stat("Lowest RSS") };
const verdict = el("div", { class: "stack", role: "status" });
const mainBox = el("div"), tableBox = el("div"), critBox = el("div"), errBox = el("div");
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, Object.values(tiles).map((t) => t.el)), verdict, modelBar, mainBox, tableBox, el("div", { class: "grid2" }, errBox, critBox));

const expStatus = el("p", { class: "small muted", role: "status" });
const expChartBox = el("div"), expTableBox = el("div");
const expPanel = el("div", { class: "exp" },
  el("h3", { text: `One sample is one roll of the dice: the same test on ${fmt.int(RUNS)} samples` }),
  el("p", { class: "small", text: `Every time the settings under "Or draw a sample" change, this draws ${fmt.int(RUNS)} new samples with them and records which degree each rule picks. Points added by hand are not used here.` }),
  expStatus, el("div", { class: "exp-grid" }, expChartBox, expTableBox));

$("#app").append(el("div", { class: "tool-grid" }, controls, out), expPanel);

const main = chart(mainBox, { series: [], height: 380 });
const errChart = chart(errBox, { series: [], height: 260 });
const critChart = chart(critBox, { series: [], height: 260 });
const expChart = chart(expChartBox, { series: [], height: 300 });

/* ---------- the sample ---------- */
function regenerate() {
  const made = generate({ truth: state.truth, noise: state.noise, n: state.n, seed: state.seed });
  if (made.error) { seedNote.replaceChildren(note("bad", made.error)); return; }
  seedNote.replaceChildren();
  state.points = made.points;
  state.custom = false;
  state.sampled = true;
  refit();
  runExperiment();
}

function refit() {
  const fit = fitPolynomials(state.points);
  state.fit = fit.error ? null : fit;
  state.fitError = fit.error || "";
  if (!state.fit) stopPlay();
  draw();
}

/* ---------- drawing ---------- */
const low = (text) => el("strong", { class: "low" }, text, el("span", { class: "sr-only", text: " (lowest)" }));

function draw() {
  const { fit, points } = state;
  const t = truthOf(state.truth);
  const ys = points.map((p) => p.y);
  const yDomain = [Math.floor(Math.min(0, ...ys) - 0.5), Math.ceil(Math.max(10, ...ys) + 0.5)];
  truthBox.input.disabled = !state.sampled;
  const truthLine = state.showTruth && state.sampled ? [{ name: state.custom ? `${t.label} used by the generator` : `True curve: ${t.label.toLowerCase()}`, type: "line", data: Array.from({ length: 201 }, (_, i) => { const x = X_MIN + ((X_MAX - X_MIN) * i) / 200; return [x, t.f(x)]; }), color: "#16233b", dash: true, width: 1.5 }] : [];
  const dots = { name: "Points", type: "scatter", data: points.map((p) => [p.x, p.y]), color: 1, r: points.length > 120 ? 3 : 4 };
  const axes = { x: { label: "x", domain: [X_MIN, X_MAX] }, y: { label: "y", domain: yDomain } };
  const onClick = ({ x, y, inside }) => { if (inside) { state.points.push({ x, y }); state.custom = true; refit(); } };

  degSlider.input.disabled = !fit;
  playBtn.disabled = !fit;
  if (!fit) {
    for (const s of Object.values(tiles)) s.set("–", "");
    verdict.replaceChildren(note("warn", `${state.fitError} Click the chart to place points, or draw a fresh sample.`));
    main.update({ title: "Click the chart to add points", subtitle: "", label: "Empty chart for placing points", ...axes, series: [...truthLine, dots], marks: [], onClick, empty: "Click here to add a point" });
    tableBox.replaceChildren();
    for (const c of [errChart, critChart]) c.update({ title: "", subtitle: "", series: [], marks: [], empty: "Needs at least three points" });
    return;
  }

  state.degree = Math.min(state.degree, fit.top);
  degSlider.input.max = fit.top;
  degSlider.value = state.degree;
  const d = state.degree, m = fit.models[d], best = picks(fit);

  tiles.aic.set(deg(best.aic), `AICc picks ${deg(best.aicc)}`);
  tiles.bic.set(deg(best.bic), "the heavier penalty");
  tiles.loo.set(deg(best.loo), "predicting each point from the rest");
  tiles.rss.set(deg(best.rss), best.rss === fit.top ? "the most complex model, as always" : "an exact fit");

  // Verdict in words.
  const chosen = CRITERIA.map((c) => best[c.key]);
  const parts = [];
  if (chosen.some((v) => v == null)) parts.push("At least one model fits these points exactly, so the criteria have no noise to weigh and are not all defined.");
  else if (new Set(chosen).size === 1) parts.push(`AIC, AICc, BIC and leave-one-out all choose degree ${chosen[0]}.`);
  else parts.push(`The rules disagree: ${CRITERIA.map((c) => `${c.label} chooses degree ${best[c.key]}`).join(", ")}.`);
  if (!state.custom) parts.push(t.degree ? `The sample came from a ${t.label.toLowerCase()}, degree ${t.degree}.` : "The sample came from a sine wave, which no polynomial matches exactly.");
  parts.push(`The residual sum of squares falls from ${fmt.num(fit.models[0].rss, 1)} at degree 0 to ${fmt.num(fit.models[fit.top].rss, 1)} at degree ${fit.top}, and would keep falling.`);
  const limited = fit.top < 8 ? note("", `Only degrees 0 to ${fit.top} are fitted to these ${fit.n} points. A polynomial needs more separate x positions than its degree, and at least one point to spare, before its fit can be judged.`) : null;
  verdict.replaceChildren(...[note(new Set(chosen).size === 1 && chosen[0] != null ? "good" : "", parts.join(" ")), limited].filter(Boolean));

  main.update({
    title: `A degree ${d} polynomial through ${fmt.int(fit.n)} points`,
    subtitle: `${m.k - 1} ${m.k - 1 === 1 ? "coefficient" : "coefficients"}, RSS ${fmt.num(m.rss, 2)}. Click the chart to add a point.`,
    label: `Scatter plot of the points with the fitted degree ${d} polynomial`, ...axes, onClick, marks: [],
    series: [
      ...(state.showAll ? fit.models.filter((k) => k.degree !== d).map((k) => ({ name: `Degree ${k.degree}`, legend: false, hover: false, type: "line", data: curve(fit, k.degree), color: "#8a94a3", width: 1, opacity: 0.7 })) : []),
      ...truthLine,
      { name: `Degree ${d} fit`, type: "line", data: curve(fit, d), color: 0, width: 2.5 },
      dots,
    ],
  });

  // The table of criteria.
  const cell = (key, digits) => (v, row) => {
    if (!Number.isFinite(v)) return "–";
    const text = digits != null ? fmt.num(v, digits) : v < 100 ? fmt.num(v, 2) : fmt.sig(v, 3);
    return best[key] === row.degree ? low(text) : text;
  };
  const t2 = table({
    caption: "Every degree, lowest values marked",
    columns: [
      { key: "degree", label: "Degree", format: (v) => {
        const b = button(String(v), () => { stopPlay(); state.degree = v; draw(); }, { small: true });
        b.setAttribute("aria-pressed", String(v === d));
        b.setAttribute("aria-label", `Show degree ${v}`);
        return b;
      } },
      { key: "k", label: "Parameters k", num: true },
      { key: "rss", label: "RSS", num: true, format: cell("rss", 2) },
      { key: "aic", label: "AIC", num: true, format: cell("aic", 1) },
      { key: "aicc", label: "AICc", num: true, format: cell("aicc", 1) },
      { key: "bic", label: "BIC", num: true, format: cell("bic", 1) },
      { key: "loo", label: "Leave-one-out error", num: true, format: cell("loo") },
    ],
    rows: fit.models,
  });
  t2.classList.add("crit");
  t2.querySelectorAll("tbody tr")[d]?.classList.add("on");
  tableBox.replaceChildren(t2);

  // Two small charts: error on the sample against error on held-out points, and the criteria.
  const x = { label: "Degree of the polynomial", domain: [0, Math.max(1, fit.top)], ticks: Math.max(1, fit.top), format: (v) => (Number.isInteger(v) ? String(v) : "") };
  const line = (key, name, color) => ({ name, type: "line", color, data: fit.models.filter((k) => Number.isFinite(k[key])).map((k) => [k.degree, k[key]]) });
  const dot = (key) => (best[key] == null ? [] : [{ type: "point", x: best[key], y: fit.models[best[key]][key], color: palette[COLOR[key]], r: 5 }]);
  const here = { type: "vline", x: d };
  const errs = fit.models.flatMap((k) => [k.mse, k.loo]).filter((v) => Number.isFinite(v) && v > 0);
  errChart.update({
    title: "Error on the sample, and on points left out", subtitle: "Fitting error only falls. The error on a point the model has not seen turns back up.",
    label: "Line chart of mean squared error by degree, on the sample and leave-one-out", x,
    y: { label: "Mean squared error (log scale)", type: "log", domain: errs.length ? [Math.min(...errs) / 1.25, Math.max(...errs) * 1.25] : undefined, format: (v) => fmt.sig(v, 2) },
    series: [line("mse", "On the sample (RSS / n)", "#8a94a3"), line("loo", "Leave-one-out", COLOR.loo)],
    marks: [here, ...dot("loo")],
  });
  critChart.update({
    title: "The information criteria", subtitle: "Fit plus a charge for each parameter. Lower is better; the dot is each one's choice.",
    label: "Line chart of AIC, AICc and BIC by degree", x, y: { label: "Criterion value" },
    series: ["aic", "aicc", "bic"].map((key) => line(key, LABEL[key], COLOR[key])),
    marks: [here, ...["aic", "aicc", "bic"].flatMap(dot)],
  });
}

/* ---------- the repeated experiment, in slices ---------- */
function experimentNow() {
  const token = ++state.run;
  const settings = { truth: state.truth, noise: state.noise, n: state.n, seed: state.seed };
  const trials = [];
  const step = () => {
    if (token !== state.run) return;
    const t0 = performance.now();
    while (trials.length < RUNS && performance.now() - t0 < 25) trials.push(...experiment(settings, trials.length, Math.min(RUNS, trials.length + 20)));
    if (trials.length < RUNS) { expStatus.textContent = `Drawing samples: ${fmt.int(trials.length)} of ${fmt.int(RUNS)}…`; setTimeout(step, 0); return; }
    drawExperiment(summarise(trials, truthOf(settings.truth).degree), settings);
  };
  step();
}
const runExperiment = debounce(experimentNow, 250);

function drawExperiment(s, settings) {
  const t = truthOf(settings.truth);
  expStatus.textContent = `${fmt.int(s.runs)} samples of ${settings.n} points from the ${t.label.toLowerCase()}, noise sd ${fmt.num(settings.noise, 1)}, starting from seed ${settings.seed}.`;
  const cats = Array.from({ length: s.degrees }, (_, d) => String(d));
  expChart.update({
    title: "Which degree each rule picked", subtitle: t.degree ? `Share of samples. The true degree is ${t.degree}.` : "Share of samples. No polynomial is exactly right for a sine wave.",
    label: "Grouped bar chart of the share of samples in which each rule picked each degree",
    x: { type: "band", label: "Degree picked", categories: cats }, y: { label: "Share of samples", format: (v) => fmt.pct(v, 0) },
    series: CRITERIA.map((c) => ({ name: c.label, type: "bars", color: COLOR[c.key], data: cats.map((d, i) => [d, s.criteria[c.key].used ? s.criteria[c.key].counts[i] / s.criteria[c.key].used : 0]) })),
    marks: t.degree != null && t.degree < s.degrees ? [{ type: "vline", x: String(t.degree), text: "true degree" }] : [],
  });
  const bestFixed = s.riskByDegree.indexOf(Math.min(...s.riskByDegree));
  const share = (v) => (Number.isFinite(v) ? fmt.pct(v, 1) : "–");
  const rows = [
    ...CRITERIA.map((c) => ({ name: c.label, ...s.criteria[c.key] })),
    { name: "Lowest RSS", ...s.criteria.rss },
    { name: `Degree ${bestFixed} every time (hindsight)`, right: t.degree == null ? NaN : bestFixed === t.degree ? 1 : 0, low: t.degree == null ? NaN : bestFixed < t.degree ? 1 : 0, high: t.degree == null ? NaN : bestFixed > t.degree ? 1 : 0, meanDegree: bestFixed, risk: s.riskByDegree[bestFixed] },
  ];
  expTableBox.replaceChildren(
    table({
      caption: "How each rule did",
      columns: [
        { key: "name", label: "Rule" },
        { key: "right", label: "True degree", num: true, format: share },
        { key: "low", label: "Too simple", num: true, format: share },
        { key: "high", label: "Too complex", num: true, format: share },
        { key: "meanDegree", label: "Average degree", num: true, format: (v) => fmt.num(v, 2) },
        { key: "risk", label: "Error of its picks", num: true, format: (v) => fmt.num(v, 3) },
      ],
      rows,
    }),
    el("p", { class: "small muted", text: "Error of its picks is the mean squared distance between the chosen curve and the true curve, at the sampled x values, averaged over the samples. It is what a rule would cost you if the job were prediction." }));
}

regenerate();
experimentNow();
