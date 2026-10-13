// Day 33: The Real Cost of Living. Interface.
import { $, el, fmt, mount, select, segmented, numberField, button, stat, note, table, chart, stats } from "../kit/kit.js";
import { COST } from "./data.js";
import { KINDS, PARTS, places, place, compare, reading, levelNote, inWords, coverage, currencyOf, dollars, units, asTyped, against, moreOrLess } from "./logic.js";

mount();

const START = { salary: 100000, unit: "usd", a: "metro:San Francisco-Oakland-Fremont, CA", b: "metro:Monroe, LA" };
const EXAMPLES = [
  { name: "Dearest and cheapest US metropolitan areas", ...START },
  { name: "New York to Austin", salary: 120000, unit: "usd", a: "metro:New York-Newark-Jersey City, NY-NJ", b: "metro:Austin-Round Rock-San Marcos, TX" },
  { name: "California to Texas", salary: 80000, unit: "usd", a: "state:California", b: "state:Texas" },
  { name: "India to the United States", salary: 2000000, unit: "local", a: "country:IND", b: "country:USA" },
  { name: "United Kingdom to Germany", salary: 40000, unit: "local", a: "country:GBR", b: "country:DEU" },
  { name: "Seattle to Japan", salary: 150000, unit: "usd", a: "metro:Seattle-Tacoma-Bellevue, WA", b: "country:JPN" },
];
const LISTS = Object.fromEntries(KINDS.map((k) => [k.key, places(COST, k.key)]));
const kindOf = (id) => id.split(":")[0];
const state = { ...START };

/* ---------- controls ---------- */
const typed = (field) => (field.input.value.trim() === "" ? NaN : Number(field.input.value));
const salaryField = numberField({ label: "Salary a year", min: 0, value: START.salary, hint: "Before tax. From 1 to 1,000,000,000,000." });
salaryField.input.addEventListener("input", () => update());
const unitSeg = segmented({
  label: "The salary is in", value: "usd",
  options: [{ value: "usd", label: "US dollars" }, { value: "local", label: "The first place's own currency" }],
  onChange: (v) => { state.unit = v; update(); },
});

// A salary typed in the first place's currency is turned into dollars when that place stops taking it (a swap, or a new
// first place with no usable exchange rate), so that the number in the box never silently comes to mean different money.
const takesLocal = (p) => Boolean(p && !p.usa && p.rate != null);
let converted = "";
function keepWorth(nextId) {
  const A = place(COST, state.a), s = typed(salaryField);
  if (state.unit !== "local" || !takesLocal(A) || takesLocal(place(COST, nextId))) return;
  if (Number.isFinite(s) && s > 0) {
    const usd = s / A.rate;
    salaryField.value = usd >= 100 ? Math.round(usd) : Number(usd.toFixed(2));
    converted = `The salary was in ${currencyOf(A)}. It has been turned into US dollars at the ${COST.year} average exchange rate, so that it is still the same money.`;
  }
  state.unit = "usd";
}

function picker(which, title) {
  const choose = (id) => { if (which === "a") keepWorth(id); state[which] = id; };
  const kind = select({
    label: `${title}: kind of place`, value: kindOf(state[which]), options: KINDS.map((k) => ({ value: k.key, label: k.label })),
    onChange: (k) => {
      // A sensible first choice for each kind: the largest metropolitan area, the largest state, the visitor's likely comparison.
      choose({ metro: "metro:New York-Newark-Jersey City, NY-NJ", state: "state:California", country: which === "a" ? "country:USA" : "country:IND" }[k]);
      fill(); update();
    },
  });
  const where = select({ label: `${title}: where`, value: "", options: [""], onChange: (id) => { choose(id); update(); } });
  const fill = () => {
    where.input.replaceChildren(...LISTS[kindOf(state[which])].map((p) => el("option", { value: p.id, text: p.name })));
    where.value = state[which];
    kind.value = kindOf(state[which]);
  };
  fill();
  return { kind, where, fill, el: el("div", { class: "place", role: "group", "aria-label": title }, kind.el, where.el) };
}
const pickA = picker("a", "First place"), pickB = picker("b", "Second place");

function load(x) {
  Object.assign(state, { salary: x.salary, unit: x.unit, a: x.a, b: x.b });
  salaryField.value = x.salary;
  pickA.fill(); pickB.fill();
  update();
}
const swap = button("Swap the two places", () => {
  keepWorth(null);
  [state.a, state.b] = [state.b, state.a];
  state.unit = "usd";
  pickA.fill(); pickB.fill();
  update();
}, { small: true });
// On a narrow screen the result sits below a long column of controls, so the first thing offered is a way down to it.
const controls = el("div", { class: "controls" },
  el("a", { class: "jump", href: "#result", text: "Jump down to the result" }),
  el("div", { class: "field", role: "group", "aria-label": "Examples" },
    el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row" }, EXAMPLES.map((x) => button(x.name, () => load(x), { small: true })))),
  salaryField.el, unitSeg.el, pickA.el, pickB.el,
  el("div", { class: "row" }, swap, button("Reset", () => load(START), { small: true })),
  el("p", { class: "small muted", text: `The page opens on an example: change the salary and the two places to your own. Price levels are for ${COST.year}: ${COST.metros.length} US metropolitan areas, the 50 states and the District of Columbia from the Bureau of Economic Analysis, and ${COST.countries.length} countries and territories from the World Bank. Nothing you type leaves this page.` }));

/* ---------- outputs ---------- */
const tiles = { need: stat("Salary needed in the second place"), stretch: stat("The same pay in the second place buys"), a: stat("Prices in the first place"), b: stat("Prices in the second place") };
const message = el("div");
const readingBox = el("div", { class: "reading", role: "status" });
const levelsBox = el("div", { class: "levels" });
const partsBox = el("div"), partsTable = el("div"), spreadBox = el("div");
const out = el("div", { class: "out", id: "result", tabindex: "-1" }, el("div", { class: "stats" }, Object.values(tiles).map((t) => t.el)), message, readingBox, levelsBox, partsBox, partsTable, spreadBox);
$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out));
const partsChart = chart(partsBox, { series: [], height: 300 });
const spreadChart = chart(spreadBox, { series: [], height: 260 });

// BEA sets the United States to 100 for all items only: its national figures for the four kinds are close to 100, not equal to it.
const US_PARTS = COST.us.slice(1);
const US_NOTE = `The United States as a whole is 100 for all items and from ${fmt.num(Math.min(...US_PARTS), 1)} to ${fmt.num(Math.max(...US_PARTS), 1)} for the four kinds.`;
const US_LINE = `The dashed line marks 100, the United States as a whole for all items; for the four kinds its own figures run from ${fmt.num(Math.min(...US_PARTS), 1)} to ${fmt.num(Math.max(...US_PARTS), 1)}.`;
const TAG = (p) => (p.kind === "metro" ? "" : p.rural ? " (non-metropolitan)" : ` (${coverage(p).replace(/^(a whole|the) /, "")})`);
const METRO_LEVELS = COST.metros.map((m) => m[1]);
const BINS = stats.histogram(METRO_LEVELS, { bins: 20, min: 80, max: 120 }).map((b) => [b.x0, b.x1, b.count]);

/* ---------- rendering ---------- */
function update() {
  const A = place(COST, state.a), B = place(COST, state.b);
  // The salary can be typed in the first place's own money only where that is a country with a usable exchange rate.
  const localOk = takesLocal(A);
  if (!localOk) state.unit = "usd";
  const notice = converted ? [el("div", { role: "status" }, note("", converted))] : [];
  converted = "";
  unitSeg.el.hidden = !localOk;
  unitSeg.value = state.unit;
  $("label", salaryField.el).textContent = state.unit === "local" && A ? `Salary a year, in the currency of ${inWords(A)}` : "Salary a year, in US dollars";

  const r = compare(COST, { salary: typed(salaryField), unit: state.unit, a: state.a, b: state.b });
  salaryField.input.classList.toggle("invalid", !r.ok && r.field === "salary");
  const source = (p) => `the US average: ${coverage(p)}, ${p.kind === "country" ? "World Bank" : "BEA"} ${COST.year}`;
  const tile = (p) => (p.kind === "country" && p.usa ? ["US average", "the yardstick: every other figure is measured against it"] : [against(p.level), source(p)]);
  if (A) tiles.a.set(...tile(A));
  if (B) tiles.b.set(...tile(B));
  levelsBox.replaceChildren(el("h2", { text: "What each figure covers" }), ...[A, B].filter((p, i) => p && (i === 0 || p.id !== A?.id)).map((p) => el("p", { class: "small", text: levelNote(COST, p) })));

  if (!r.ok) {
    message.replaceChildren(...notice, note("bad", r.error));
    readingBox.replaceChildren();
    tiles.need.set("–", ""); tiles.stretch.set("–", "");
    for (const c of [partsChart, spreadChart]) c.update({ title: "", subtitle: "", series: [], marks: [], empty: "Nothing to draw until the salary is put right" });
    partsTable.replaceChildren();
    return;
  }
  message.replaceChildren(...notice, ...(r.same ? [note("warn", "The same place is chosen twice. Pick a different second place to see a comparison.")] : []));
  readingBox.replaceChildren(...reading(COST, r).map((text) => el("p", { text })));

  const pay = state.unit === "local" ? `${asTyped(r.salary)} in ${currencyOf(r.a)}` : `$${asTyped(r.salary)}`;
  tiles.need.set(dollars(r.needed), `a year, to buy what ${pay} buys ${state.unit === "local" ? "there" : "in the first"}${r.neededLocal == null ? "" : `; about ${units(r.neededLocal)} in ${currencyOf(r.b)}`}`);
  tiles.stretch.set(r.stretch >= 1 ? `${fmt.num(1 + r.stretch, 1)} times as much` : moreOrLess(r.stretch), r.same ? "it is the same place" : r.stretch >= 1 ? "as it does in the first" : r.stretch === 0 ? "as in the first" : "than it does in the first");

  // The parts of the basket, where the source separates them.
  const withParts = [r.a, r.b].filter((p, i) => p.parts && (i === 0 || !r.same));
  partsBox.hidden = !withParts.length;
  if (withParts.length) {
    const cats = ["All items", ...PARTS.map((p) => p.label)];
    partsChart.update({
      title: "Where the gap comes from: price levels by kind of spending",
      subtitle: `${US_LINE} ${withParts.length === 2 ? "Rents are BEA's housing figure." : `Only ${inWords(withParts[0])} has a breakdown: the World Bank's figure for a country is a single number.`}`,
      label: "Bar chart of regional price parities for all items, goods, housing, utilities and other services",
      x: { type: "band", categories: cats },
      y: { label: "Regional price parity", format: (v) => (Number.isInteger(v) ? fmt.int(v) : fmt.num(v, 1)) },
      series: withParts.map((p, i) => ({ name: p.name, type: "bars", color: r.a === p ? 0 : 1, data: [["All items", p.index], ...PARTS.map((part) => [part.label, p.parts[part.key]])] })),
      marks: [{ type: "hline", y: 100 }],
      legend: true, empty: "",
    });
  }
  partsTable.replaceChildren(...(r.parts && !r.same ? [table({
    caption: `Price level for each kind of spending: ${r.a.name}, then ${r.b.name}. ${US_NOTE}`,
    columns: [
      { key: "label", label: "Kind of spending" },
      { key: "a", label: "First place", num: true, format: (v) => fmt.num(v, 1) },
      { key: "b", label: "Second place", num: true, format: (v) => fmt.num(v, 1) },
      { key: "gap", label: "Second against first", num: true, format: (v) => (v === 0 ? "the same" : fmt.signed(v * 100, 1) + "%") },
    ],
    rows: [{ label: "All items", a: r.a.index, b: r.b.index, gap: r.ratio - 1 }, ...r.parts],
  })] : []));

  // Where the two sit among all US metropolitan areas.
  const inView = (p) => p.index >= 80 && p.index <= 120;
  const off = [r.a, r.b].filter((p, i) => !inView(p) && (i === 0 || !r.same));
  spreadChart.update({
    title: "Where they sit among the 387 US metropolitan areas",
    subtitle: "How many metropolitan areas fall in each band of price level, two points wide. " + (off.length
      ? off.map((p) => `${inWords(p)[0].toUpperCase()}${inWords(p).slice(1)}, at ${fmt.num(p.index, 1)}, is off the ${p.index < 80 ? "left" : "right"} of this chart`).join(". ") + "."
      : "The dashed lines mark the two places chosen."),
    label: "Histogram of regional price parities across US metropolitan areas, with the two chosen places marked",
    x: { label: "Price level (US average = 100)", domain: [80, 120], format: (v) => fmt.num(v, 0) },
    y: { label: "Metropolitan areas", format: (v) => fmt.int(v) },
    series: [{ name: "Metropolitan areas", type: "hist", color: "#8a94a3", data: BINS }],
    marks: [r.a, r.b].map((p, i) => ({ p, text: (r.same ? "both places" : i === 0 ? "first place" : "second place") + TAG(p) })).filter(({ p }, i) => inView(p) && (i === 0 || !r.same)).map(({ p, text }) => ({ type: "vline", x: p.index, text })),
    empty: "",
  });
}

load(START);
