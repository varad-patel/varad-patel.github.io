// Day 37: Housing Affordability Map. Interface.
// The kit has no map, so the choropleth (drawing, zoom by region, hover, touch and arrow keys) is built here.
import { $, el, svgEl, fmt, mount, numberField, slider, select, segmented, button, stat, note, table, chart, reducedMotion } from "../kit/kit.js";
import { SHAPES } from "./shapes.js";
import { AREAS, REGIONS, YEARS, LATEST, NATIONAL, DEFAULTS, LIMITS, EDGES, CLASS_LABELS, evaluate, overTime, areaOverTime, reachSummary, incomeNeeded, step, countPhrase } from "./logic.js";

mount();

// One hue, light to dark: the darker the district, the further its price is above the budget.
const RAMP = ["#e8f0fb", "#bfd6f2", "#8fb5e6", "#5b8fd4", "#2f66b3", "#173b73"];
const INK = "#16233b";
const PAGE = 20;
const state = { ...DEFAULTS, yi: LATEST, view: "all", selected: -1, hot: -1, sort: "share", show: "all", shown: PAGE, playing: 0 };
const settings = () => ({ income: state.income, deposit: state.deposit, rule: state.rule, multiple: state.multiple, share: state.share, rate: state.rate, term: state.term, price: state.price, scale: state.scale });

const gbp = (v) => `£${fmt.int(v)}`;
const times = (r) => (r >= 10 ? fmt.num(r, 0) : fmt.num(r, 2));
const plain = (v) => String(Number(v.toFixed(2)));   // 4.5, 4.25, 5: no trailing zeros
const priceWord = () => (state.price === "median" ? "median" : "lower quartile");
// A price as a share of the budget. "100%" is kept for a price exactly equal to the budget: anything else that would
// round to it is given decimals, so that the page never says "100%: out of reach".
function share(ratio) {
  if (ratio > 0 && ratio < 0.005) return "under 1%";
  for (let d = 0; d < 4; d++) { const s = fmt.pct(ratio, d); if (ratio === 1 || !/^100(\.0+)?%$/.test(s)) return s; }
  return ratio > 1 ? "just over 100%" : "just under 100%";
}
const POINTS = AREAS.map((a) => SHAPES.areas[a.code].at);
const byName = AREAS.map((a, i) => i).sort((p, q) => AREAS[p].name.localeCompare(AREAS[q].name));

/* ---------- controls ---------- */
function moneyField(key, label, hint) {
  const f = numberField({ label, min: LIMITS[key][0], max: LIMITS[key][1], value: state[key], hint });
  const msg = el("div");
  f.input.addEventListener("input", () => {
    const v = f.value;
    if (Number.isNaN(v)) {
      msg.replaceChildren(note("bad", `${key === "income" ? "Income" : "The deposit"} must be a number from ${gbp(LIMITS[key][0])} to ${gbp(LIMITS[key][1])}, without commas or a pound sign. The map still uses ${gbp(state[key])}.`));
      return;
    }
    msg.replaceChildren();
    state[key] = v;
    update();
  });
  return { ...f, msg, set(v) { f.value = v; msg.replaceChildren(); } };
}
const incomeField = moneyField("income", "Your income (£ a year, before tax)",
  `Starts at ${gbp(DEFAULTS.income)}, the median for a full-time employee in England and Wales in ${YEARS[LATEST]}: a placeholder, so replace it with yours. For a joint purchase, add the two incomes.`);
const depositField = moneyField("deposit", "Your deposit (£)",
  `Starts at ${gbp(DEFAULTS.deposit)}, a tenth of the median price in England and Wales: also a placeholder.`);
const ruleSeg = segmented({
  label: "How much a lender will lend", value: state.rule,
  options: [{ value: "multiple", label: "A multiple of income" }, { value: "repayment", label: "What repayments allow" }],
  onChange: (v) => { state.rule = v; showRule(); update(); },
});
const multipleSlider = slider({
  label: "Loan", min: LIMITS.multiple[0], max: LIMITS.multiple[1], step: 0.25, value: state.multiple, format: (v) => `${plain(v)} times income`,
  onInput: (v) => { state.multiple = v; update(); },
});
const shareSlider = slider({
  label: "Repayments may take", min: LIMITS.share[0], max: LIMITS.share[1], step: 1, value: state.share, format: (v) => `${v}% of income`,
  hint: "Of income before tax. An assumption to change, not a lender's rule.",
  onInput: (v) => { state.share = v; update(); },
});
const rateSlider = slider({
  label: "Interest rate", min: LIMITS.rate[0], max: LIMITS.rate[1], step: 0.25, value: state.rate, format: (v) => `${plain(v)}% a year`,
  hint: "The same rate is used for every year on the map.",
  onInput: (v) => { state.rate = v; update(); },
});
const termSlider = slider({
  label: "Repaid over", min: LIMITS.term[0], max: LIMITS.term[1], step: 1, value: state.term, format: (v) => `${v} years`,
  onInput: (v) => { state.term = v; update(); },
});
function showRule() {
  multipleSlider.el.hidden = state.rule !== "multiple";
  for (const s of [shareSlider, rateSlider, termSlider]) s.el.hidden = state.rule !== "repayment";
}
const priceSeg = segmented({
  label: "Which home", value: state.price,
  options: [{ value: "median", label: "The median home" }, { value: "lower", label: "A cheaper home" }],
  hint: "The median is the middle price of all homes sold in the district that year. The cheaper home is the lower quartile: three in four sold for more.",
  onChange: (v) => { state.price = v; update(); },
});
const scaleSeg = segmented({
  label: "In earlier years", value: state.scale,
  options: [{ value: "ladder", label: "Same place in the pay ladder" }, { value: "fixed", label: "Same pounds" }],
  hint: "The first scales your income and deposit by median full-time earnings in each year, so you are compared with someone as well paid then as you are now. The second keeps the cash figures, with no allowance for inflation.",
  onChange: (v) => { state.scale = v; update(); },
});
const resetBtn = button("Back to the starting values", () => {
  stopPlay();
  Object.assign(state, DEFAULTS, { yi: LATEST });   // the year is a starting value too: the page loads on the latest
  yearSlider.value = state.yi;
  incomeField.set(state.income); depositField.set(state.deposit);
  ruleSeg.value = state.rule; multipleSlider.value = state.multiple; shareSlider.value = state.share; rateSlider.value = state.rate; termSlider.value = state.term;
  priceSeg.value = state.price; scaleSeg.value = state.scale;
  showRule(); update();
}, { small: true });
// The headline, kept in view on a phone while the controls are on screen (the status line says the same to a screen reader).
const mini = el("p", { class: "mini", "aria-hidden": "true" });
const controls = el("div", { class: "controls" }, mini, incomeField.el, incomeField.msg, depositField.el, depositField.msg, ruleSeg.el,
  multipleSlider.el, shareSlider.el, rateSlider.el, termSlider.el, priceSeg.el, scaleSeg.el, el("div", { class: "row" }, resetBtn));

/* ---------- year ---------- */
const yearSlider = slider({
  label: "Year", min: 0, max: LATEST, step: 1, value: state.yi, format: (i) => `year to September ${YEARS[i]}`,
  onInput: (i) => { stopPlay(); state.yi = i; update(); },
});
const playBtn = button(`Play from ${YEARS[0]}`, () => {
  if (state.playing) { stopPlay(); update(); return; }
  if (state.yi === LATEST) state.yi = 0;
  yearSlider.value = state.yi;
  state.playing = setInterval(() => {
    if (state.yi >= LATEST) { stopPlay(); update(); return; }
    state.yi++;
    yearSlider.value = state.yi;
    update();
  }, reducedMotion() ? 1200 : 650);
  update();
}, { small: true });
function stopPlay() {
  clearInterval(state.playing);
  state.playing = 0;
}

/* ---------- outputs ---------- */
const sBudget = stat("Your budget");
const sWithin = stat("Within your budget");
const sNational = stat("England and Wales");
const status = el("p", { class: "sr-only", role: "status" });
const formula = el("p", { class: "small formula" });

// The map.
const W = SHAPES.width, H = SHAPES.height;
const svg = svgEl("svg", { class: "map", viewBox: `0 0 ${W} ${H}`, role: "application", "aria-roledescription": "map", tabindex: "0", preserveAspectRatio: "xMidYMid meet" });
const gAreas = svgEl("g"), gDots = svgEl("g", { "pointer-events": "none" }), gRings = svgEl("g", { "pointer-events": "none" });
svg.append(gAreas, gDots, gRings);
const paths = AREAS.map((a, i) => {
  const p = svgEl("path", { d: SHAPES.areas[a.code].d, "data-i": i, "vector-effect": "non-scaling-stroke", stroke: "#8a94a3", "stroke-width": 0.5, "stroke-linejoin": "round" });
  gAreas.append(p);
  return p;
});
// A marker of fixed size on screen whatever the zoom: a very short line with round ends and a stroke that does not scale.
const dotAt = ([x, y], width, colour) => svgEl("path", { d: `M${x},${y}l0.01,0`, fill: "none", stroke: colour, "stroke-width": width, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" });
const ring = (i, width, dash) => svgEl("path", { d: SHAPES.areas[AREAS[i].code].d, fill: "none", stroke: INK, "stroke-width": width, "stroke-linejoin": "round", "stroke-dasharray": dash || null, "vector-effect": "non-scaling-stroke" });
const tip = el("div", { class: "map-tip", hidden: true });
const mapStatus = el("p", { class: "sr-only", role: "status" });
const mapBox = el("div", { class: "map-box" }, svg, tip);
const legend = el("div", { class: "map-legend" });
const viewSel = select({
  label: "Show", value: "all", options: [{ value: "all", label: "England and Wales" }, ...REGIONS.map((r, k) => ({ value: k, label: r }))],
  onChange: (v) => { state.view = v === "all" ? "all" : Number(v); state.hot = -1; state.shown = PAGE; drawView(); drawLegend(); drawTable(); drawSummary(); },
});
const findSel = select({
  label: "Find a district", value: "", options: [{ value: "", label: "None chosen" }, ...byName.map((i) => ({ value: i, label: AREAS[i].name }))],
  onChange: (v) => choose(v === "" ? -1 : Number(v)),
});
const panel = el("div", { class: "panel area-panel" });
const areaChartBox = el("div");
// The two statements the ONS's geography licence asks for are given word for word, and so is the accreditation its
// statistics ask for.
const credit = el("p", { class: "small muted", text: "Prices and earnings. Source: Office for National Statistics, which adapted the prices from Land Registry data licensed under the Open Government Licence v.3.0. Boundaries. Source: Office for National Statistics licensed under the Open Government Licence v.3.0. Contains OS data © Crown copyright and database right 2026. Districts as at December 2025; Scotland and Northern Ireland are not in the data." });

const timeBox = el("div");
const sortSel = select({
  label: "Order", value: state.sort,
  options: [{ value: "share", label: "Easiest to afford first" }, { value: "dear", label: "Hardest to afford first" }, { value: "name", label: "By name" }],
  onChange: (v) => { state.sort = v; state.shown = PAGE; drawTable(); },
});
const showSeg = segmented({
  label: "List", value: state.show, options: [{ value: "all", label: "All" }, { value: "in", label: "Within budget" }, { value: "out", label: "Out of reach" }],
  onChange: (v) => { state.show = v; state.shown = PAGE; drawTable(); },
});
const tableBox = el("div", { class: "list-box" });
const tableNote = el("p", { class: "small muted" });

const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sBudget.el, sWithin.el, sNational.el), status, formula,
  el("div", { class: "year-row" }, yearSlider.el, playBtn),
  el("div", { class: "map-row" },
    el("div", { class: "part" }, el("div", { class: "pickers" }, viewSel.el, findSel.el), mapBox, mapStatus,
      el("p", { class: "small muted", text: "Hover over a district or tap it. With the keyboard: Tab to the map, arrow keys to move between districts, Enter to choose one." })),
    el("div", { class: "part" }, legend, panel, credit)));
const lower = el("div", { class: "grid2" },
  el("div", { class: "part" }, el("h2", { text: "Over time" }), timeBox),
  el("div", { class: "part" }, el("h2", { text: "Every district" }), el("div", { class: "pickers" }, sortSel.el, showSeg.el), tableNote, tableBox));
$("#app").append(el("div", { class: "tool-grid" }, controls, out), lower);

const timeChart = chart(timeBox, { series: [], height: 300 });
const areaChart = chart(areaChartBox, { series: [], height: 240 });
let result = null;

/* ---------- words ---------- */
const inView = (i) => state.view === "all" || AREAS[i].region === state.view;
const viewName = () => (state.view === "all" ? "England and Wales" : REGIONS[state.view]);
// The same, as it reads after "in": "the North East", "London", "Wales".
const place = () => (state.view === "all" || /^(London|Wales|Yorkshire)/.test(viewName()) ? viewName() : `the ${viewName()}`);
function sentence(i) {
  const r = result.rows[i], a = AREAS[i];
  const gap = Math.abs(r.price - result.budget);
  return `${a.name}, ${REGIONS[a.region]}. ${state.price === "median" ? "Median" : "Lower quartile"} price ${gbp(r.price)} in the year to September ${result.year}: ${share(r.ratio)} of your budget. ${r.within ? `Within budget, with ${gbp(gap)} to spare` : `Out of reach by ${gbp(gap)}`}.`;
}

/* ---------- drawing ---------- */
// A redraw replaces what is inside a box. If the keyboard was in there (the years can be playing while someone tabs
// through the table), put it back on the control with the same name, or on the nearest thing left, never on nothing.
function keepFocus(box, redraw, fallback) {
  const held = box.contains(document.activeElement) ? document.activeElement : null;
  const name = held && (held.getAttribute("aria-label") || held.textContent);
  redraw();
  if (!held || box.contains(document.activeElement)) return;
  if (held.isConnected) { held.focus(); return; }
  ([...box.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.textContent) === name) || box.querySelector("button") || fallback).focus();
}

function update() {
  result = evaluate(settings(), state.yi);
  if (result.error) { formula.replaceChildren(note("bad", result.error)); return; }   // the controls cannot produce this; a bug would show as words
  const s = settings(), year = result.year, total = AREAS.length;
  const nat = NATIONAL[state.price][state.yi];
  sBudget.set(gbp(result.budget), `in ${year}${result.scale !== 1 ? ` pounds: income ${gbp(result.income)}, deposit ${gbp(result.deposit)}` : `: income ${gbp(result.income)}, deposit ${gbp(result.deposit)}`}`);
  sWithin.set(`${fmt.int(result.within)} of ${total}`, `districts where the ${priceWord()} home costs ${gbp(result.budget)} or less`);
  sNational.set(gbp(nat), `the ${priceWord()} price in ${year}: ${share(nat / result.budget)} of your budget`);
  const lend = state.rule === "multiple"
    ? `${plain(state.multiple)} × ${gbp(result.income)} = ${gbp(result.loan)}`
    : `${state.share}% of ${gbp(result.income)} is ${gbp((result.income * state.share) / 1200)} a month, which repays ${gbp(result.loan)} over ${state.term} years at ${plain(state.rate)}%`;
  formula.textContent = `Loan: ${lend}. Budget: loan + deposit of ${gbp(result.deposit)} = ${gbp(result.budget)}.`
    + (result.scale !== 1 ? ` For ${year} your income and deposit are multiplied by ${fmt.num(result.scale, 3)}, median full-time earnings in ${year} (${gbp(NATIONAL.earnings[state.yi])}) over those in ${YEARS[LATEST]} (${gbp(NATIONAL.earnings[LATEST])}).` : state.yi !== LATEST ? ` The same pounds are used for ${year} as for ${YEARS[LATEST]}.` : "");
  const headline = `In the year to September ${year} the ${priceWord()} home is within a budget of ${gbp(result.budget)} ${countPhrase(result.within, total)} of England and Wales.`;
  mini.textContent = `${year}: budget ${gbp(result.budget)}, enough ${countPhrase(result.within, total)}`;
  // While the years are playing, the line a screen reader hears is left alone: it is updated once, when the play stops.
  if (!state.playing && status.textContent !== headline) status.textContent = headline;

  // The button says what a press will do from the year now showing.
  const label = state.playing ? "Stop" : state.yi === LATEST ? `Play from ${YEARS[0]}` : `Play on from ${year}`;
  if (playBtn.textContent !== label) playBtn.textContent = label;

  result.rows.forEach((r, i) => paths[i].setAttribute("fill", RAMP[r.klass]));
  gDots.replaceChildren(...result.rows.filter((r) => r.within).flatMap((r) => [dotAt(POINTS[r.index], 7, INK), dotAt(POINTS[r.index], 4, "#fff")]));
  svg.setAttribute("aria-label", `Map of the ${total} local authority districts of England and Wales. ${headline} Arrow keys move between districts and Enter chooses one. The same figures are in the table of every district.`);
  drawLegend();
  drawRings();
  drawSummary();
  keepFocus(panel, drawPanel, findSel.input);
  drawTime(s);
  keepFocus(tableBox, drawTable, sortSel.input);
  if (state.hot >= 0 && !tip.hidden) showTip(state.hot);
}

function drawLegend() {
  const edge = (k) => fmt.pct(EDGES[k], 0);
  const range = [`up to ${edge(0)}`, `${edge(0)} to ${edge(1)}`, `${edge(1)} to ${edge(2)}`, `${edge(2)} to ${edge(3)}`, `${edge(3)} to ${edge(4)}`, `over ${edge(4)}`];
  // The counts are for the districts on show: all of them, or the region chosen under "Show".
  const counts = RAMP.map((_, k) => result.rows.filter((r) => r.klass === k && inView(r.index)).length);
  legend.replaceChildren(
    el("h2", { text: `Price of the ${priceWord()} home as a share of your budget${state.view === "all" ? "" : `: ${viewName()}`}` }),
    el("ul", {}, RAMP.map((c, k) => el("li", {}, el("i", { style: { background: c } }), el("span", { text: `${range[k]}: ${fmt.int(counts[k])} ${counts[k] === 1 ? "district" : "districts"}` })))),
    el("p", { class: "small" }, el("span", { class: "dot-key", "aria-hidden": "true" }), " A white dot marks every district within your budget (100% or less). Darker means further out of reach."));
  for (const li of legend.querySelectorAll("li")) li.title = CLASS_LABELS[[...li.parentNode.children].indexOf(li)];
}

function drawRings() {
  const rings = [];
  if (state.selected >= 0) rings.push(ring(state.selected, 3));
  if (state.hot >= 0 && state.hot !== state.selected) rings.push(ring(state.hot, 2, "5 3"));
  gRings.replaceChildren(...rings);
}

function drawView() {
  let box = [0, 0, W, H];
  if (state.view !== "all") {
    const boxes = AREAS.filter((a) => a.region === state.view).map((a) => SHAPES.areas[a.code].box);
    box = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  }
  const pad = Math.max(box[2] - box[0], box[3] - box[1]) * 0.04;
  svg.setAttribute("viewBox", `${box[0] - pad} ${box[1] - pad} ${box[2] - box[0] + 2 * pad} ${box[3] - box[1] + 2 * pad}`);
  paths.forEach((p, i) => p.setAttribute("opacity", inView(i) ? 1 : 0.35));
  tip.hidden = true;
  drawRings();
}

function drawSummary() {
  const g = state.view === "all" ? { name: "England and Wales", within: result.within, total: AREAS.length } : result.regions[state.view];
  tableNote.textContent = `${g.name}: the ${priceWord()} home is within your budget ${countPhrase(g.within, g.total)}.`;
}

function showTip(i) {
  const r = result.rows[i];
  tip.replaceChildren(el("b", { text: AREAS[i].name }), el("span", { text: `${gbp(r.price)}, ${share(r.ratio)} of your budget` }), el("span", { text: r.within ? "Within budget" : "Out of reach" }));
  tip.hidden = false;
  // Place it beside the district's marker, inside the map.
  const pt = svg.createSVGPoint();
  [pt.x, pt.y] = POINTS[i];
  const at = pt.matrixTransform(svg.getScreenCTM()), frame = mapBox.getBoundingClientRect();
  const x = at.x - frame.left, y = at.y - frame.top;
  const left = x + 14 + tip.offsetWidth > frame.width ? x - 14 - tip.offsetWidth : x + 14;
  tip.style.left = `${Math.max(0, Math.min(left, frame.width - tip.offsetWidth))}px`;
  tip.style.top = `${Math.max(0, Math.min(y - tip.offsetHeight / 2, frame.height - tip.offsetHeight))}px`;
}
function heat(i, speak = false) {
  state.hot = i;
  drawRings();
  if (i < 0) { tip.hidden = true; return; }
  showTip(i);
  if (speak) mapStatus.textContent = sentence(i);
}

/** Choose a district (or none, with -1). `from` says which control did it, so focus can be put somewhere sensible. */
function choose(i, from = "") {
  state.selected = i;
  if (i >= 0 && !inView(i)) { state.view = "all"; viewSel.value = "all"; state.shown = PAGE; drawView(); drawLegend(); drawTable(); drawSummary(); }
  findSel.value = i < 0 ? "" : i;
  drawRings();
  drawPanel();
  if (from === "clear") findSel.input.focus();
}

function drawPanel() {
  const i = state.selected;
  if (i < 0) {
    panel.replaceChildren(el("h2", { text: "No district chosen" }), el("p", { class: "small", text: "Choose one on the map, in the list of districts or in the table to see its price against your budget in every year." }));
    return;
  }
  const a = AREAS[i], r = result.rows[i], s = settings();
  const need = incomeNeeded(r.price, s, state.yi);
  const local = a.earnings[state.yi];
  const sum = reachSummary(i, s);
  const span = sum.never ? `It has not been within this budget in any year from ${YEARS[0]} to ${YEARS[LATEST]}.`
    : sum.always ? `It has been within this budget in every year from ${YEARS[0]} to ${YEARS[LATEST]}.`
    : `It was within this budget in ${sum.years} of the ${YEARS.length} years, ${sum.years === 1 ? `only in ${sum.first}` : `the first ${sum.first} and the last ${sum.last}`}.`;
  const facts = [
    need === 0 ? "The deposit alone covers the price." : `Income needed under this rule: ${gbp(need)} a year${result.scale !== 1 ? ` in ${result.year} pounds, which is ${gbp(need / result.scale)} at ${YEARS[LATEST]} pay levels` : ""}.`,
    local ? `Local pay: full-time employees working here earned a median of ${gbp(local)} in ${result.year}, so the ${priceWord()} home cost ${times(r.price / local)} times local pay.` : `The ONS publishes no earnings figure for this district in ${result.year}.`,
    span,
  ];
  const clear = button("Clear", () => choose(-1, "clear"), { small: true });
  clear.setAttribute("aria-label", `Clear the choice of ${a.name}`);
  areaChart.update({
    title: `${a.name}: price against your budget`, subtitle: state.scale === "ladder" ? "The budget follows median full-time earnings." : "The budget is the same pounds in every year.",
    label: `Line chart of the ${priceWord()} house price in ${a.name} and your budget, ${YEARS[0]} to ${YEARS[LATEST]}`,
    x: { label: "Year to September", domain: [YEARS[0], YEARS[LATEST]], format: (v) => String(Math.round(v)) }, y: { label: "Pounds", format: (v) => `£${fmt.compact(v)}`, zero: true },
    series: [
      { name: `${state.price === "median" ? "Median" : "Lower quartile"} price`, type: "line", data: areaOverTime(i, s).map((t) => [t.year, t.price]), color: 0 },
      { name: "Your budget", type: "line", data: areaOverTime(i, s).map((t) => [t.year, t.budget]), color: INK, dash: true },
    ],
    marks: [{ type: "vline", x: result.year, text: String(result.year) }],
  });
  panel.replaceChildren(
    el("div", { class: "row", style: { justifyContent: "space-between" } }, el("h2", { text: a.name }), clear),
    el("p", { class: "verdict", role: state.playing ? null : "status", text: sentence(i).replace(`${a.name}, `, "") }),
    el("ul", { class: "small facts" }, facts.map((f) => el("li", { text: f }))),
    areaChartBox);
}

function drawTime(s) {
  const t = overTime(s);
  timeChart.update({
    title: "Districts within your budget, by year", subtitle: `Out of ${AREAS.length}. Click a year, or use the arrow keys and Enter, to show it on the map.`,
    label: `Line chart of the number of districts where the ${priceWord()} home is within your budget, ${YEARS[0]} to ${YEARS[LATEST]}`,
    x: { label: "Year to September", domain: [YEARS[0], YEARS[LATEST]], format: (v) => String(Math.round(v)) }, y: { label: "Districts", domain: [0, 320], format: fmt.int },
    series: [{ name: "Districts within budget", type: "area", data: t.map((r) => [r.year, r.within]), color: 0 }],
    marks: [{ type: "vline", x: result.year, text: `${result.year}: ${result.within}` }],
    onClick: ({ x, inside }) => {
      if (!inside || x == null) return;
      stopPlay();
      state.yi = Math.max(0, Math.min(LATEST, Math.round(x) - YEARS[0]));
      yearSlider.value = state.yi;
      update();
    },
  });
}

function drawTable() {
  let rows = result.rows.filter((r) => inView(r.index) && (state.show === "all" || (state.show === "in") === r.within));
  const name = (r) => AREAS[r.index].name;
  rows = [...rows].sort(state.sort === "name" ? (p, q) => name(p).localeCompare(name(q)) : state.sort === "dear" ? (p, q) => q.price - p.price || name(p).localeCompare(name(q)) : (p, q) => p.price - q.price || name(p).localeCompare(name(q)));
  if (!rows.length) {
    tableBox.replaceChildren(note("", state.show === "in" ? `No district in ${place()} is within this budget in ${result.year}. Raise the income, the deposit or the loan, or choose the cheaper home.` : `Every district in ${place()} is within this budget in ${result.year}.`));
    return;
  }
  // Twenty rows at a time: every row is a button, and 318 of them in a row would be 318 presses of Tab to get past.
  const shown = Math.min(rows.length, state.shown);
  const more = (label, to) => button(label, () => {
    state.shown = to;
    drawTable();
    (tableBox.querySelectorAll("tbody button")[shown] ?? tableBox.querySelector("tbody button"))?.focus();
  }, { small: true });
  tableBox.replaceChildren(table({
    caption: `${rows.length === 1 ? "1 district" : `${fmt.int(rows.length)} districts`} in ${place()}, year to September ${result.year}${shown < rows.length ? `: the first ${shown}` : ""}`,
    columns: [
      { key: "name", label: "District", format: (_, r) => {
        const b = el("button", { type: "button", class: "linkish", text: name(r), onclick: () => choose(r.index) });
        b.setAttribute("aria-label", `Choose ${name(r)}`);
        return b;
      } },
      { key: "price", label: `${state.price === "median" ? "Median" : "Lower quartile"} price`, num: true, format: gbp },
      { key: "ratio", label: "Against your budget", format: (v, r) => `${share(v)}: ${r.within ? "within budget" : "out of reach"}` },
    ],
    rows: rows.slice(0, shown),
  }), ...(shown < rows.length ? [el("div", { class: "row" },
    more(`Show ${Math.min(PAGE, rows.length - shown)} more`, shown + PAGE),
    rows.length - shown > PAGE ? more(`Show all ${fmt.int(rows.length)}`, rows.length) : null)] : []));
}

/* ---------- map events ---------- */
const indexOf = (target) => { const p = target instanceof Element ? target.closest("path[data-i]") : null; return p ? Number(p.dataset.i) : -1; };
svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { const i = indexOf(e.target); if (i !== state.hot) heat(i); } });
svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && document.activeElement !== svg) heat(-1); });
svg.addEventListener("click", (e) => { const i = indexOf(e.target); if (i >= 0) { heat(i); choose(i); } });
svg.addEventListener("focus", () => {
  if (state.hot >= 0) return;
  // Start from the chosen district, or from the one nearest the middle of what is shown.
  const allowed = AREAS.map((_, i) => i).filter(inView);
  const [vx, vy, vw, vh] = svg.getAttribute("viewBox").split(" ").map(Number);
  const mid = [vx + vw / 2, vy + vh / 2];
  const start = state.selected >= 0 && inView(state.selected) ? state.selected : allowed.reduce((b, i) => ((POINTS[i][0] - mid[0]) ** 2 + (POINTS[i][1] - mid[1]) ** 2 < (POINTS[b][0] - mid[0]) ** 2 + (POINTS[b][1] - mid[1]) ** 2 ? i : b));
  if (svg.matches(":focus-visible")) heat(start, true);
});
svg.addEventListener("blur", () => heat(-1));
svg.addEventListener("keydown", (e) => {
  const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key];
  if (dir) {
    const allowed = AREAS.map((_, i) => i).filter(inView);
    const from = state.hot >= 0 ? state.hot : state.selected >= 0 && inView(state.selected) ? state.selected : allowed[0];
    heat(state.hot >= 0 ? step(POINTS, from, dir, allowed) : from, true);
  } else if ((e.key === "Enter" || e.key === " ") && state.hot >= 0) choose(state.hot);
  else if (e.key === "Escape") heat(-1);
  else return;
  e.preventDefault();
});

showRule();
drawView();
update();
