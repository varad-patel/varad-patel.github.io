// Day 42: Minimum Wage Simulator. Interface.
import { $, el, fmt, mount, slider, segmented, button, stat, note, table, chart } from "../kit/kit.js";
import { MODELS, RATIONING, LIMITS, equilibria, effect, thresholds, sweep, elasticities } from "./logic.js";

mount();

const START = { model: "competitive", floor: 160, rationing: "efficient", a: 300, b: 2, c: 60, d: 1 };
const CURVES = [
  { label: "Opening curves", a: 300, b: 2, c: 60, d: 1 },
  { label: "Employers barely respond to pay", a: 400, b: 4, c: 60, d: 1 },
  { label: "Workers have few other options", a: 300, b: 2, c: 0, d: 3 },
  { label: "Workers can easily go elsewhere", a: 300, b: 2, c: 120, d: 0.25 },
];
const state = { ...START };
const curves = () => ({ a: state.a, b: state.b, c: state.c, d: state.d });

/* ---------- words and numbers ---------- */
// Everything shown is rounded first and differences are taken between the rounded figures, so a row always adds up.
const people = (L) => Math.round(L * 1000);                       // L is in thousands of workers
const paise = (w) => Math.round(w * 100) / 100;
const millions = (x) => Math.round(x / 10) / 100;                 // thousands of rupees an hour, as millions to two places
const rupees = (w) => `₹${Number.isInteger(paise(w)) ? fmt.int(paise(w)) : fmt.num(paise(w), 2)}`;
const money = (m) => `₹${fmt.num(m, 2)} million`;
const count = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
const modelName = (id) => (id === "monopsony" ? "single employer" : "competitive market");

/* ---------- controls ---------- */
const modelSeg = segmented({
  label: "Who sets the wage", value: state.model,
  options: [{ value: "competitive", label: "Competitive: many employers" }, { value: "monopsony", label: "Monopsony: one employer" }],
  hint: "Many employers bid for workers and take the going wage. A single employer chooses the wage, knowing that hiring more means paying everyone more.",
  onChange: (v) => { state.model = v; update(); },
});
const floorSlider = slider({
  label: "Wage floor", min: LIMITS.floor[0], max: LIMITS.floor[1], step: 1, value: state.floor,
  format: (v) => (v === 0 ? "no floor" : `₹${fmt.int(v)} an hour`),
  onInput: (v) => { state.floor = v; update(); },
});
const floorHint = el("div", { class: "hint" });
floorSlider.el.append(floorHint);
const jump = (label, get) => button(label, () => { state.floor = Math.round(get()); floorSlider.value = state.floor; update(); }, { small: true });
const floorRow = el("div", { class: "row", role: "group", "aria-label": "Set the floor to" },
  jump("No floor", () => 0), jump("₹130", () => 130), jump("₹160", () => 160), jump("₹200", () => 200));

const rationSeg = segmented({
  label: "If jobs are short, who gets them", value: state.rationing,
  options: RATIONING.map((r) => ({ value: r.id, label: r.label })),
  hint: "This only changes workers' surplus, and only when the floor leaves people who want a job without one.",
  onChange: (v) => { state.rationing = v; update(); },
});

const curveSliders = {
  a: slider({ label: "Highest wage any employer would pay", min: LIMITS.a[0], max: LIMITS.a[1], step: 10, value: state.a, format: (v) => `₹${fmt.int(v)}`, onInput: (v) => { state.a = v; update(); } }),
  b: slider({ label: "Demand slope", min: LIMITS.b[0], max: LIMITS.b[1], step: 0.5, value: state.b, format: (v) => `₹${fmt.num(v, 1)} per 1,000`, hint: "How much less each extra thousand workers is worth to employers.", onInput: (v) => { state.b = v; update(); } }),
  c: slider({ label: "Lowest wage anyone would work for", min: LIMITS.c[0], max: LIMITS.c[1], step: 10, value: state.c, format: (v) => `₹${fmt.int(v)}`, onInput: (v) => { state.c = v; update(); } }),
  d: slider({ label: "Supply slope", min: LIMITS.d[0], max: LIMITS.d[1], step: 0.25, value: state.d, format: (v) => `₹${fmt.num(v, 2)} per 1,000`, hint: "How much more must be paid to attract each extra thousand workers. Steeper means workers have fewer alternatives.", onInput: (v) => { state.d = v; update(); } }),
};
function setCurves(p) {
  for (const k of ["a", "b", "c", "d"]) { state[k] = p[k]; curveSliders[k].value = p[k]; }
}
const curveButtons = CURVES.map((p) => button(p.label, () => { setCurves(p); update(); }, { small: true }));

// The four curve sliders are folded away on a phone, so that the results come straight after the floor.
const elasticNote = el("p", { class: "small muted" });
const curveNow = el("p", { class: "small" });
const curveBox = el("details", { class: "more", open: window.matchMedia("(min-width: 861px)").matches },
  el("summary", { text: "The curves" }),
  el("div", {},
    el("p", { class: "small muted", text: "Straight lines chosen for illustration, not estimates of any real labour market. Wages are rupees an hour." }),
    el("div", { class: "row", role: "group", "aria-label": "Example curves" }, curveButtons),
    curveSliders.a.el, curveSliders.b.el, curveSliders.c.el, curveSliders.d.el, curveNow, elasticNote));
const controls = el("div", { class: "controls" },
  modelSeg.el, floorSlider.el, floorRow, rationSeg.el,
  el("div", { class: "row" }, button("Reset everything", () => {
    Object.assign(state, START);
    modelSeg.value = state.model; rationSeg.value = state.rationing; floorSlider.value = state.floor; setCurves(START);
    update();
  }, { small: true })),
  curveBox);

/* ---------- outputs ---------- */
const sJobs = stat("Employment"), sWage = stat("Wage"), sBill = stat("Total pay"), sIdle = stat("Want a job, have none");
const verdict = el("div", { role: "status" });
const marketBox = el("div"), tablesBox = el("div", { class: "grid2" }), whoBox = el("div", { class: "who" });
const jobsBox = el("div"), payBox = el("div");
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sJobs.el, sWage.el, sBill.el, sIdle.el),
  verdict, marketBox,
  el("h2", { text: "Who gains and who loses" }), whoBox,
  el("h2", { text: "The same floor under both models" }), tablesBox,
  el("h2", { text: "Every floor at once" }),
  el("p", { class: "small muted", text: "The two models agree once the floor is above the competitive wage, where the dashed line runs along the solid one. They disagree about what happens on the way there." }),
  el("div", { class: "grid2" }, jobsBox, payBox));

$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out));

const marketChart = chart(marketBox, { series: [], height: 360 });
const jobsChart = chart(jobsBox, { series: [], height: 260 });
const payChart = chart(payBox, { series: [], height: 260 });

/* ---------- drawing ---------- */
// `n` is the difference of two rounded figures. `exact` is the unrounded change: a change too small to show is
// never called "no change".
const delta = (n, unit, exact = n) => (n === 0 ? (Math.abs(exact) < 1e-9 ? "no change" : `${exact > 0 ? "up" : "down"} by less than ${unit(0.01)}`) : `${n > 0 ? "up" : "down"} ${unit(Math.abs(n))}`);

function sentence(p, e, eq) {
  const { before, after } = e, floor = rupees(state.floor);
  const A = fmt.int(people(before.L)), B = fmt.int(people(after.L)), idle = people(after.jobless);
  if (state.floor === 0) return ["", `No floor is set. The ${modelName(state.model)} employs ${A} people at ${rupees(before.w)} an hour.`];
  if (!after.binding) return ["", `A floor of ${floor} is no higher than the ${rupees(before.w)} this market already pays, so it changes nothing: ${A} people work at ${rupees(before.w)} an hour.`];
  if (people(after.L) === 0) return ["bad", `A floor of ${floor} is at or above ${rupees(p.a)}, the most any employer would pay for a worker. Nobody is employed, and ${count(idle, "person who wants", "people who want")} a job at that wage cannot get one.`];
  const idleText = idle > 0 ? ` ${count(idle, "person wants", "people want")} a job at ${floor} and cannot get one.` : "";
  if (state.model === "competitive") {
    return ["warn", `The floor of ${floor} is above the going wage of ${rupees(before.w)}. Each worker now costs more than the last few were worth, so employers cut back from ${A} people to ${B}.${idleText}`];
  }
  if (after.regime === "supply") {
    const peak = Math.abs(state.floor - eq.competitive.w) < 1e-9 ? " This is the floor that creates the most jobs: any higher and the employer starts to cut back." : "";
    return ["good", `The floor of ${floor} is above the ${rupees(before.w)} the single employer chose to pay. It can no longer keep pay down by hiring fewer people, so it takes on everyone willing to work at ${floor}: employment rises from ${A} to ${B}, and nobody who wants a job at that wage is without one.${peak}`];
  }
  const jobs = people(after.L) - people(before.L);
  const versus = jobs > 0 ? `still above the ${A} it employed with no floor` : jobs === 0 ? `exactly the ${A} it employed with no floor` : `below the ${A} it employed with no floor`;
  return [jobs > 0 ? "good" : jobs === 0 ? "" : "warn", `The floor of ${floor} is above the competitive wage of ${rupees(eq.competitive.w)}, so the last workers hired would cost more than they are worth and the employer cuts back to ${B} people, ${versus}.${idleText}`];
}

function whoList(e, eq) {
  const { before, after } = e;
  if (!after.binding) return [el("p", { text: "Nobody: the floor does not bind, so wages, jobs and surpluses are what they were." })];
  // Counts are rounded once and the rest follow from them, so they always add up.
  const stay = people(e.stayers), hired = people(after.L) - stay, lost = people(before.L) - stay;
  const rise = Math.round((paise(after.w) - paise(before.w)) * 100) / 100;
  const drawn = state.rationing === "random" && people(after.jobless) > 0;
  const workers = millions(after.workers) - millions(before.workers), employers = millions(after.employers) - millions(before.employers);
  const total = Math.round((workers + employers) * 100) / 100;
  const items = [];
  const li = (who, text) => items.push(el("li", {}, el("strong", { text: who }), ` ${text}`));
  if (stay > 0) li("Workers who keep their jobs gain.", `${count(stay, "person is", "people are")} paid ${rupees(rise)} an hour more.`);
  if (hired > 0) li("New workers gain.", `${count(hired, "person is", "people are")} hired who had no job before.`);
  if (lost > 0) li("Workers who lose their jobs lose.", `${count(lost, "person is", "people are")} no longer employed${people(after.L) === 0 ? ": at this floor there are no jobs at all" : drawn ? `: the ${fmt.int(people(after.L))} jobs go to a random draw of the ${fmt.int(people(after.willing))} people willing to work at ${rupees(after.w)}, so some earlier workers are replaced by newcomers` : ". They are the ones who needed the highest wage to be willing to work"}.`);
  // Which way each side moves is read from the exact change (e.workers, e.employers, e.total); the amount is the
  // difference of the rounded figures in the table, and a change too small to show there is said to be small.
  const sign = (x) => (Math.abs(x) < 1e-9 ? 0 : x > 0 ? 1 : -1);
  const amount = (m) => (m === 0 ? "less than ₹0.01 million" : money(Math.abs(m)));
  const w = sign(e.workers), f = sign(e.employers), t = sign(e.total);
  li(w > 0 ? "Workers as a group gain." : w < 0 ? "Workers as a group lose." : "Workers as a group break even.", w === 0 ? "Their surplus is unchanged." : `Their surplus (pay above the least each would have worked for) ${w > 0 ? "rises" : "falls"} by ${amount(workers)} an hour.`);
  li(f < 0 ? "Employers lose." : f > 0 ? "Employers gain." : "Employers break even.", f === 0 ? "Their surplus is unchanged." : `Their surplus (what workers are worth to them above their pay) ${f > 0 ? "rises" : "falls"} by ${amount(employers)} an hour.`);
  // Why the total moves: employment is nearer to or further from the competitive level, where the total is largest.
  // The one exception is a random draw, which can lower the total even when employment moves nearer.
  const nearer = Math.abs(after.L - eq.competitive.L) < Math.abs(before.L - eq.competitive.L) - 1e-9;
  const why = t > 0 ? "better off: the floor brings employment nearer to the competitive level"
    : nearer ? "worse off, although employment is nearer to the competitive level: with jobs handed out by a draw, some go to people who would only work for more, and they gain less from them"
      : "worse off: the floor takes employment further from the competitive level";
  li("Taken together,", t === 0 ? "the two sides are no better or worse off." : `the two sides are ${amount(total)} an hour ${why}.`);
  return [el("ul", {}, items)];
}

function modelTable(p, id) {
  const e = effect(p, id, state.floor, state.rationing);
  const rows = [
    { what: "Employment", before: people(e.before.L), after: people(e.after.L), show: fmt.int },
    { what: "Wage, ₹ an hour", before: paise(e.before.w), after: paise(e.after.w), show: (v) => (Number.isInteger(v) ? fmt.int(v) : fmt.num(v, 2)) },
    { what: "Total pay, ₹m an hour", before: millions(e.before.wageBill), after: millions(e.after.wageBill), show: (v) => fmt.num(v, 2) },
    { what: "Workers' surplus, ₹m", before: millions(e.before.workers), after: millions(e.after.workers), show: (v) => fmt.num(v, 2) },
    { what: "Employers' surplus, ₹m", before: millions(e.before.employers), after: millions(e.after.employers), show: (v) => fmt.num(v, 2) },
    // The sum of the two rows above as they are shown, so the column adds up.
    { what: "Both together, ₹m", before: Math.round((millions(e.before.workers) + millions(e.before.employers)) * 100) / 100, after: Math.round((millions(e.after.workers) + millions(e.after.employers)) * 100) / 100, show: (v) => fmt.num(v, 2) },
    { what: "Want a job, have none", before: people(e.before.jobless), after: people(e.after.jobless), show: fmt.int },
  ];
  return table({
    caption: `${id === "monopsony" ? "Monopsony" : "Competitive"}${id === state.model ? " (shown above)" : ""}`,
    columns: [
      { key: "what", label: "Per hour" },
      { key: "before", label: "No floor", num: true, format: (v, r) => r.show(v) },
      { key: "after", label: "With floor", num: true, format: (v, r) => r.show(v) },
      { key: "change", label: "Change", num: true, format: (_, r) => { const d = Math.round((r.after - r.before) * 100) / 100; return d === 0 ? "none" : `${d > 0 ? "+" : "-"}${r.show(Math.abs(d))}`; } },
    ],
    rows,
  });
}

function update() {
  const p = curves();
  const eq = equilibria(p), e = effect(p, state.model, state.floor, state.rationing);
  if (eq.error || e.error) { verdict.replaceChildren(note("bad", eq.error || e.error)); return; }
  const { before, after } = e, th = thresholds(p, state.model);
  floorHint.textContent = state.model === "monopsony"
    ? `With these curves the single employer pays ${rupees(th.bites)}. Jobs rise with the floor up to ${rupees(th.peak)} and stay above their starting level until ${rupees(th.breakEven)}.`
    : `With these curves the going wage is ${rupees(th.bites)}. A floor at or below it changes nothing.`;
  curveButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(["a", "b", "c", "d"].every((k) => CURVES[i][k] === state[k]))));

  const jobs = people(after.L) - people(before.L), idle = people(after.jobless);
  sJobs.set(fmt.int(people(after.L)), delta(jobs, (n) => fmt.int(n)) + (jobs ? ` from ${fmt.int(people(before.L))}` : ""));
  const rise = Math.round((paise(after.w) - paise(before.w)) * 100) / 100;
  // With nobody employed the floor is a wage that no one is paid.
  sWage.set(rupees(after.w), people(after.L) === 0 ? "the floor, but nobody is paid it" : rise === 0 ? "an hour, no change" : `an hour, ${delta(rise, rupees)}`);
  const bill = Math.round((millions(after.wageBill) - millions(before.wageBill)) * 100) / 100;
  sBill.set(`₹${fmt.num(millions(after.wageBill), 2)}m`, `an hour, ${delta(bill, (n) => `₹${fmt.num(n, 2)}m`, e.wageBill)}`);
  sIdle.set(fmt.int(idle), idle ? `at ${rupees(after.w)} an hour` : "everyone willing has work");

  const [kind, text] = sentence(p, e, eq);
  verdict.replaceChildren(note(kind, text));
  whoBox.replaceChildren(...whoList(e, eq));
  tablesBox.replaceChildren(modelTable(p, state.model), modelTable(p, state.model === "monopsony" ? "competitive" : "monopsony"));

  // The market diagram. Both curves are drawn over the same employment levels so one hover reads them all.
  const xMax = Math.ceil((1.6 * eq.competitive.L) / 10) * 10;
  const xs = Array.from({ length: 41 }, (_, i) => (xMax * i) / 40);
  const within = (pts) => pts.filter(([, w]) => w >= 0 && w <= p.a);
  const series = [
    { name: "Demand: what one more worker is worth", type: "line", color: 0, data: within(xs.map((L) => [L, p.a - p.b * L])) },
    { name: "Supply: the wage needed to attract one more", type: "line", color: 1, data: within(xs.map((L) => [L, p.c + p.d * L])) },
    ...(state.model === "monopsony" ? [{ name: "What one more worker costs a single employer", type: "line", color: "#8a94a3", dash: true, data: within(xs.map((L) => [L, p.c + 2 * p.d * L])) }] : []),
  ];
  const marks = [];
  if (after.binding) {
    marks.push({ type: "hline", y: after.w, text: `Floor ${rupees(after.w)}` });
    marks.push({ type: "point", x: before.L, y: before.w, text: "No floor", color: "#8a94a3" });
    marks.push({ type: "point", x: after.L, y: after.w, text: "With the floor" });
  } else marks.push({ type: "point", x: before.L, y: before.w, text: state.floor > 0 ? "Floor does not bind" : "No floor" });
  marketChart.update({
    title: `The ${modelName(state.model)}${state.floor > 0 ? `, floor ${rupees(state.floor)}` : ", no floor"}`,
    subtitle: `Employment is ${fmt.int(people(after.L))} at ${rupees(after.w)} an hour.`,
    label: `Labour market diagram: demand and supply for labour${state.model === "monopsony" ? ", the cost of one more worker" : ""}, and the outcome with and without the floor`,
    x: { label: "Employment (thousands of workers)", domain: [0, xMax] },
    y: { label: "Wage (₹ an hour)", domain: [0, p.a], format: (v) => fmt.int(v) },
    series, marks,
  });

  // Every floor at once: the kinks are added to an even grid so the lines turn exactly where they should.
  const both = [thresholds(p, "competitive"), thresholds(p, "monopsony")];
  const floors = [...new Set([...Array.from({ length: 81 }, (_, i) => (p.a * i) / 80), ...both.flatMap((t) => [t.bites, t.peak, t.breakEven])])].sort((x, y) => x - y);
  const run = Object.fromEntries(MODELS.map((m) => [m.id, sweep(p, m.id, floors, state.rationing)]));
  const here = state.floor > 0 && state.floor <= p.a ? [{ type: "vline", x: state.floor, text: `Floor ${rupees(state.floor)}` }] : [];
  const x = { label: "Wage floor (₹ an hour)", domain: [0, p.a], format: (v) => fmt.int(v) };
  jobsChart.update({
    title: "Jobs at each floor", label: "Line chart of employment against the wage floor under the two models", x,
    y: { label: "Employment (thousands)", zero: true },
    series: [{ name: "Monopsony", type: "line", color: 1, width: 3, data: run.monopsony.map((r) => [r.floor, r.L]) }, { name: "Competitive", type: "line", color: 0, dash: true, data: run.competitive.map((r) => [r.floor, r.L]) }],
    marks: here,
  });
  payChart.update({
    title: "Total pay at each floor", label: "Line chart of the total wage bill against the wage floor under the two models", x,
    y: { label: "Total pay (₹ million an hour)", zero: true, format: (v) => fmt.num(v, v % 1 ? 1 : 0) },
    series: [{ name: "Monopsony", type: "line", color: 1, width: 3, data: run.monopsony.map((r) => [r.floor, r.wageBill / 1000]) }, { name: "Competitive", type: "line", color: 0, dash: true, data: run.competitive.map((r) => [r.floor, r.wageBill / 1000]) }],
    marks: here,
  });

  curveNow.textContent = `With these curves and this floor: ${fmt.int(people(after.L))} employed at ${rupees(after.w)} an hour.`;
  const el2 = elasticities(p);
  elasticNote.textContent = `At the competitive point these curves have a demand elasticity of ${fmt.num(el2.demand, 2)} and a supply elasticity of ${fmt.num(el2.supply, 2)}: a wage 1% higher means ${fmt.num(Math.abs(el2.demand), 2)}% fewer workers wanted and ${fmt.num(el2.supply, 2)}% more willing.`;
}

update();
