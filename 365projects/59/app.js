// Day 59: Comparative Advantage Trader. Interface.
import { $, el, fmt, mount, slider, select, segmented, numberField, textField, button, note, table, chart } from "../kit/kit.js";
import { Q, LIMITS, validate, solve, respond, edgeOffer, num, isFraction } from "./logic.js";

mount();

const PRESETS = [
  { label: "Ricardo's cloth and wine", mode: "labour", share: 50, goods: ["cloth", "wine"],
    countries: [{ name: "England", labour: 220, x: 100, y: 120 }, { name: "Portugal", labour: 170, x: 90, y: 80 }],
    about: "Ricardo's numbers of 1817: the labour of 100 men for a year makes the cloth in England and 120 the wine; in Portugal 90 and 80. He gave no size for either country and said nothing of how much of each good they want. The 220 and 170 workers (enough for each to make one unit of both) and the equal split of spending are this page's additions. The market price and the percentages depend on them. The range of prices at which both gain does not." },
  { label: "No comparative advantage", mode: "labour", share: 50, goods: ["cloth", "wine"],
    countries: [{ name: "England", labour: 220, x: 100, y: 120 }, { name: "Portugal", labour: 170, x: 50, y: 60 }],
    about: "An invented case: Portugal needs exactly half the workers for both goods, so the two countries give up the same wine for a cloth." },
  { label: "A small country and a large one", mode: "labour", share: 50, goods: ["cloth", "wine"],
    countries: [{ name: "England", labour: 220, x: 100, y: 120 }, { name: "Portugal", labour: 17000, x: 90, y: 80 }],
    about: "Ricardo's four numbers with Portugal made a hundred times larger, an invented size." },
  { label: "A country that cannot make wine", mode: "output", share: 50, goods: ["cloth", "wine"],
    countries: [{ name: "Northland", labour: 10, x: 2, y: 0 }, { name: "Southland", labour: 10, x: 1, y: 3 }],
    about: "An invented case, written as units per worker so that a zero can be typed." },
];

/* ---------- controls ---------- */
let mode = PRESETS[0].mode;
const aboutPreset = el("p", { class: "small muted" });
const modeSeg = segmented({
  label: "The numbers below are", value: mode,
  options: [{ value: "labour", label: "Workers needed per unit" }, { value: "output", label: "Units one worker makes" }],
  onChange: (v) => { convert(v); update(); },
});
const goodFields = [0, 1].map((k) => textField({ label: k ? "Second good" : "First good", value: "", onInput: () => update() }));
const nameLimit = el("p", { class: "small muted", text: `Names of goods and countries: ${LIMITS.name} characters at most.` });
const share = slider({ label: "Share of spending on the first good", min: 5, max: 95, step: 5, value: 50, format: (v) => `${v}%`,
  hint: "An assumption of this page: both countries have the same tastes and spend this share of their income on the first good whatever its price. It sets what each would buy without trade and where the market price settles.", onInput: () => update() });
const countryFields = [0, 1].map((i) => ({
  name: textField({ label: "Name", value: "", onInput: () => update() }),
  labour: numberField({ label: "Workers", min: LIMITS.min, max: LIMITS.max, value: 1 }),
  x: numberField({ label: "x", min: 0, max: LIMITS.max, value: 1 }),
  y: numberField({ label: "y", min: 0, max: LIMITS.max, value: 1 }),
  legend: el("legend", { text: `Country ${i + 1}` }),
}));
for (const f of [...goodFields, ...countryFields.map((c) => c.name)]) f.input.maxLength = LIMITS.name;
// numberField only reports valid numbers; the page must also react when a box is emptied or goes out of range.
for (const c of countryFields) for (const key of ["labour", "x", "y"]) c[key].input.addEventListener("input", () => update());
const setLabel = (field, text) => { field.el.querySelector("label").textContent = text; };

/**
 * A box may show a number rounded to six figures while the sums use the exact fraction behind it: the reciprocal of
 * what was typed in the other mode, or the market's own amounts. The exact value holds for as long as the box still
 * shows that text; edit the box and what is typed is what is used.
 */
const behind = new Map(); // input element -> { shown, q, typed }
const setExact = (field, q, typed = null) => { field.value = Number(Q.num(q).toPrecision(6)); behind.set(field.input, { shown: field.input.value, q, typed }); };
const exactOf = (field) => { const e = behind.get(field.input); return e && e.shown === field.input.value ? e : null; };

function load(p) {
  behind.clear();
  mode = p.mode;
  modeSeg.value = mode;
  share.value = p.share;
  goodFields.forEach((f, k) => { f.value = p.goods[k]; });
  countryFields.forEach((c, i) => { c.name.value = p.countries[i].name; for (const key of ["labour", "x", "y"]) c[key].value = p.countries[i][key]; });
  aboutPreset.textContent = p.about;
  resetOffers();
}
/**
 * Switching between "workers per unit" and "units per worker" turns each number into its reciprocal. The box shows it
 * to six figures and the sums keep the exact reciprocal, so the switch never changes the economy: two countries with
 * the same costs still have the same costs afterwards. A box that has not been touched since it was converted goes
 * back to exactly what was typed, so that 90 does not come back as 90.0001; the others are converted afresh.
 */
function convert(next) {
  if (next === mode) return;
  mode = next;
  let restored = 0, converted = 0;
  for (const f of countryFields.flatMap((c) => [c.x, c.y])) {
    const kept = exactOf(f), text = f.input.value, v = f.value;
    behind.delete(f.input);
    if (kept && kept.typed !== null) { f.input.value = kept.typed; restored++; }
    else if (Number.isNaN(v)) continue;                                   // an empty or invalid box stays as it is
    else if (v > 0) { setExact(f, Q.div(Q.one, Q.of(v)), text); converted++; }
    else f.input.value = "";                                              // 0 units per worker has no "workers per unit"
  }
  aboutPreset.textContent = converted
    ? `${restored ? "Boxes that were not edited are back as they were typed; the others are" : "The same countries,"} converted from the other way of writing the numbers. A converted box shows six figures and the sums use the exact value behind it until that box is edited.`
    : "Back to the numbers as they were before the switch.";
}
const tech = (f) => exactOf(f)?.q ?? f.value;
const readInput = () => ({
  mode, share: share.value, goods: goodFields.map((f) => f.value),
  countries: countryFields.map((c) => ({ name: c.name.value, labour: c.labour.value, x: tech(c.x), y: tech(c.y) })),
});

const presetRow = el("div", { class: "row", role: "group", "aria-label": "Examples" }, el("span", { class: "small muted", text: "Examples:" }),
  PRESETS.map((p) => button(p.label, () => { load(p); update(); }, { small: true })));
const controls = el("div", { class: "controls" },
  modeSeg.el,
  el("div", { class: "pair" }, goodFields.map((f) => f.el)), nameLimit,
  countryFields.map((c) => el("fieldset", { class: "country" }, c.legend, c.name.el, c.labour.el, el("div", { class: "pair" }, c.x.el, c.y.el))),
  share.el);

/* ---------- outputs ---------- */
const problems = el("div");
const summary = el("div", { class: "stack" });
const status = el("p", { class: "sr-only", role: "status" });
const factsBox = el("div");
const chartBoxes = [el("div"), el("div")];
const charts = chartBoxes.map((box) => chart(box, { series: [], height: 300 }));
const results = el("div", { class: "stack", id: "results" }, summary, status, factsBox, el("div", { class: "grid2" }, chartBoxes));

/* ---------- negotiation ---------- */
const speaker = select({ label: "You speak for", options: [{ value: 0, label: "Country 1" }, { value: 1, label: "Country 2" }], value: 0, onChange: () => { hint(); drawCharts(); } });
const giveGood = select({ label: "The good you give", options: [{ value: "x", label: "x" }, { value: "y", label: "y" }], value: "x", onChange: () => hint() });
const giveAmount = numberField({ label: "You give", min: LIMITS.min, max: LIMITS.max, value: 1 });
const getAmount = numberField({ label: "You ask for", min: LIMITS.min, max: LIMITS.max, value: 1 });
for (const f of [giveAmount, getAmount]) {
  f.input.addEventListener("input", () => hint());
  f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); makeOffer(); } }); // Enter in a box makes the offer
}
const offerHint = el("p", { class: "small muted" });
const reply = el("div", { role: "status" });
const logList = el("ul", { class: "offers" });
const logBox = el("div", { class: "stack", hidden: true }, el("h3", { text: "Offers so far, latest first (the last eight are kept)" }), logList, el("div", {}, button("Clear the list", () => { resetOffers(); drawCharts(); offerButton.focus(); }, { small: true })));
const offerButton = button("Make the offer", () => makeOffer(), { primary: true });
const exampleButtons = [
  ["The market's terms", () => marketOffer(false)],
  ["The other side's limit", () => edgeOffer(model, Number(speaker.value))],
  ["One for one", () => ({ gives: model.exporterX === null || model.exporterX === Number(speaker.value) ? "x" : "y", give: 1, get: 1 })],
  ["The wrong way round", () => marketOffer(true)],
].map(([label, build]) => button(label, () => {
  const o = model && build();
  if (!o) { reply.replaceChildren(note("", noExample(label))); return; }
  giveGood.value = o.gives;
  for (const [f, v] of [[giveAmount, o.give], [getAmount, o.get]]) { behind.delete(f.input); if (isFraction(v)) setExact(f, v); else f.value = v; }
  hint();
  makeOffer();
}, { small: true }));
const negotiation = el("div", { class: "panel stack", id: "negotiate" },
  el("h2", { text: "Negotiate" }),
  el("p", { class: "small", text: "Propose a trade. The other country accepts only if the trade leaves it better off than no trade at all, and it then makes the best of whatever it has agreed to." }),
  el("div", { class: "offer" }, speaker.el, giveAmount.el, giveGood.el, getAmount.el),
  offerHint,
  el("div", { class: "row" }, offerButton, el("span", { class: "small muted", text: "or try:" }), exampleButtons),
  reply, logBox);

const jump = el("p", { class: "small jump" }, "Jump to ", el("a", { href: "#results", text: "the results" }), " or ", el("a", { href: "#negotiate", text: "the negotiation" }), ".");
$("#app").append(presetRow, aboutPreset, jump, el("div", { class: "tool-grid wide-controls" }, controls, el("div", { class: "out" }, problems, results, negotiation)));

/* ---------- words and numbers ---------- */
let model = null;
let offers = [];
let offerCount = 0;
let lastOffer = null;
const n4 = (q) => fmt.sig(typeof q === "number" ? q : num(q), 4);
const asNumber = (v) => (isFraction(v) ? num(v) : v);
/**
 * The two countries' costs are printed to four figures, or to as many more as it takes to tell them apart
 * (3 and 3.000005 must not both come out as "3"). Returns the number of figures to use for both.
 */
function figuresFor(a, b) {
  if (a === null || b === null || Q.cmp(a, b) === 0) return 4;
  for (let d = 4; d <= 15; d++) if (fmt.sig(num(a), d) !== fmt.sig(num(b), d)) return d;
  return 15;
}
const sigQ = (q, d) => fmt.sig(num(q), d);
/** Words for a price that prints like one of the two limits without being it, for example 0.8333 against 5/6. */
function nearLimit(price) {
  const r = model?.range;
  if (!r) return "";
  for (const b of [r.lo, r.hi]) {
    if (b === null || Q.sign(b) === 0 || Q.cmp(price, b) === 0 || n4(price) !== n4(b)) continue;
    const short = b.d !== 1n && b.n.toString().length <= 4 && b.d.toString().length <= 4;
    return ` To four figures this price looks the same as the limit of ${n4(b)}${short ? `, which is exactly ${b.n}/${b.d}` : ""}, but it is just ${Q.cmp(price, b) < 0 ? "below" : "above"} it.`;
  }
  return "";
}
const amount = (q, good) => `${n4(q)} ${good}`;
const pctText = (x) => fmt.pct(Math.abs(x), 1);
const otherGood = (g) => (g === "x" ? "y" : "x");

/** How a country fares, as the end of a sentence that starts with its name. */
function fares(o, c) {
  const [gx, gy] = model.goods;
  if (o.sign === 0) return "is exactly as well off as with no trade";
  // A gain of more than ten times is given as a multiple: "304,190.4% more" helps nobody.
  if (o.percent !== null && o.percent >= 10) return `is as well off as with ${fmt.sig(1 + o.percent, 3)} times as much of both goods as it has without trade`;
  if (o.percent === null) return `gains: without trade it has no ${Q.sign(c.autarky.x) === 0 ? gx : gy} at all, so the gain cannot be put as a percentage`;
  if (o.percent === -1) return `is left with no ${Q.sign(o.consumption.x) === 0 ? gx : gy} at all, the worst outcome this model has`;
  if (Math.abs(o.percent) < 0.0005) return o.sign > 0 ? "gains, by less than 0.1%" : "loses, by less than 0.1%";
  return o.sign > 0 ? `is as well off as with ${pctText(o.percent)} more of both goods than it has without trade` : `is as badly off as with ${pctText(o.percent)} less of both goods than it has without trade`;
}

function resetOffers() {
  offers = [];
  offerCount = 0;
  lastOffer = null;
  logList.replaceChildren();
  logBox.hidden = true;
  reply.replaceChildren();
}

/* ---------- the model ---------- */
function update() {
  const input = readInput();
  const [gx, gy] = input.goods.map((g, k) => g.trim() || `good ${k + 1}`);
  // Labels follow the names and the way the numbers are written.
  setLabel(share, `Share of spending on ${gx}`);
  countryFields.forEach((c, i) => {
    c.legend.textContent = input.countries[i].name.trim() || `Country ${i + 1}`;
    setLabel(c.x, mode === "labour" ? `Workers to make one ${gx}` : `Units of ${gx} one worker makes`);
    setLabel(c.y, mode === "labour" ? `Workers to make one ${gy}` : `Units of ${gy} one worker makes`);
    for (const key of ["x", "y"]) { c[key].input.min = mode === "labour" ? LIMITS.min : 0; c[key].input.classList.toggle("invalid", Number.isNaN(c[key].value) || (mode === "labour" && c[key].value === 0)); }
  });
  [...speaker.input.options].forEach((o, i) => { o.textContent = input.countries[i].name.trim() || `Country ${i + 1}`; });
  [...giveGood.input.options].forEach((o, k) => { o.textContent = k ? gy : gx; });

  const errors = validate(input);
  if (errors.length) {
    model = null;
    problems.replaceChildren(note("bad", el("strong", { text: errors.length === 1 ? "One thing to fix: " : `${errors.length} things to fix: ` }), el("ul", { class: "fixes" }, errors.map((e) => el("li", { text: e.message })))));
    results.hidden = true;
    negotiation.hidden = true;
    status.textContent = "";
    return;
  }
  problems.replaceChildren();
  results.hidden = false;
  negotiation.hidden = false;
  const key = JSON.stringify(input, (k, v) => (typeof v === "bigint" ? `${v}n` : v));
  if (model?.key !== key) resetOffers(); // earlier offers were made to different countries
  model = { ...solve(input), key };
  describe();
  hint();
  drawCharts();
}

function describe() {
  const m = model, [gx, gy] = m.goods, [c0, c1] = m.countries;
  const A = m.exporterX, parts = [];
  // Absolute advantage, good by good.
  const abs = m.absolute.map((who, k) => {
    const g = m.goods[k], key = k ? "y" : "x";
    return who === null ? `one worker makes the same ${g} in both countries (${n4(c0.a[key])})`
      : `${m.countries[who].name} makes more ${g} per worker (${n4(m.countries[who].a[key])} against ${n4(m.countries[1 - who].a[key])})`;
  });
  const both = m.absolute[0] !== null && m.absolute[0] === m.absolute[1];
  parts.push(el("p", {}, el("strong", { text: "Absolute advantage. " }), `${abs[0][0].toUpperCase()}${abs[0].slice(1)}, and ${abs[1]}.${both ? ` ${m.countries[m.absolute[0]].name} is better at both.` : ""}`));

  if (A === null) {
    parts.push(note("warn", el("strong", { text: "No comparative advantage. " }),
      `A unit of ${gx} costs both countries the same ${n4(c0.cost)} ${gy}, so there is nothing to gain from trade: any trade that helps one country hurts the other, and no price makes both better off.`));
    status.textContent = `No comparative advantage: a unit of ${gx} costs both countries ${n4(c0.cost)} ${gy}. No price makes both better off.`;
  } else {
    const a = m.countries[A], b = m.countries[1 - A], { lo, hi } = m.range;
    const d = figuresFor(lo, hi), loT = sigQ(lo, d), hiT = hi === null ? "" : sigQ(hi, d);
    const first = Q.sign(lo) === 0 ? `${a.name} cannot make ${gy}, so a unit of ${gx} costs it nothing,` : `${a.name} gives up ${loT} ${gy} for a unit of ${gx}`;
    const why = hi === null ? `${first} and ${b.name} cannot make ${gx} at all` : `${first} and ${b.name} gives up ${hiT}${Q.sign(lo) === 0 ? ` ${gy} for one` : ""}`;
    const range = hi === null ? (Q.sign(lo) === 0 ? `any price above zero` : `any price above ${loT} ${gy} per ${gx}`)
      : Q.sign(lo) === 0 ? `any price above zero and below ${hiT} ${gy} per ${gx}` : `any price strictly between ${loT} and ${hiT} ${gy} per ${gx}`;
    // The market price takes as many figures as it needs to be told from whichever limit it is strictly inside.
    const dp = Math.max(d, Q.cmp(m.price, lo) === 0 ? 4 : figuresFor(m.price, lo), hi === null || Q.cmp(m.price, hi) === 0 ? 4 : figuresFor(m.price, hi));
    parts.push(el("p", {}, el("strong", { text: "Comparative advantage. " }), `${why}, so ${a.name} should make ${gx} and ${b.name} ${gy}. Both gain at ${range}.`));
    const o = m.market.outcome;
    const deal = `${a.name} sells ${amount(m.market.x, gx)} for ${amount(m.market.y, gy)}`;
    const large = m.regime === "exporterLarge" ? a : m.regime === "importerLarge" ? b : null;
    const text = large
      ? `With ${m.share}% of spending on ${gx}, ${large.name} is too large for the other to supply all it wants: it goes on making both goods, and the market price is its own cost, ${sigQ(m.price, d)} ${gy} per ${gx}. ${deal}. ${c0.name} ${fares(o[0], c0)}; ${c1.name} ${fares(o[1], c1)}. Since ${large.name} gains nothing at that price, it refuses these terms in the negotiation below, where it says yes only to a strict gain.`
      : `With ${m.share}% of spending on ${gx}, the market settles at ${sigQ(m.price, dp)} ${gy} per ${gx}, each country makes only its own good, and ${deal}. ${c0.name} ${fares(o[0], c0)}; ${c1.name} ${fares(o[1], c1)}.`;
    parts.push(note("good", el("strong", { text: "The market price. " }), text));
    status.textContent = `${a.name} has the comparative advantage in ${gx}. Both gain at ${range}. Market price ${sigQ(m.price, dp)} ${gy} per ${gx}: ${c0.name} ${fares(o[0], c0)}; ${c1.name} ${fares(o[1], c1)}.`;
  }
  summary.replaceChildren(...parts);

  const cell = (c) => `${amount(c.x, gx)}, ${amount(c.y, gy)}`;
  const inverse = (c) => (c.cost === null ? Q.zero : Q.sign(c.cost) === 0 ? null : Q.div(Q.one, c.cost));
  const dx = figuresFor(c0.cost, c1.cost), dy = figuresFor(inverse(c0), inverse(c1));
  const costCell = (q, good, figures) => (q === null ? "cannot be made here" : `${sigQ(q, figures)} ${good}`);
  const rows = [
    { what: "One worker makes", v: m.countries.map((c) => `${n4(c.a.x)} ${gx} or ${n4(c.a.y)} ${gy}`) },
    { what: "All its workers can make", v: m.countries.map((c) => `${amount(c.cap.x, gx)} or ${amount(c.cap.y, gy)}`) },
    { what: `One ${gx} costs it`, v: m.countries.map((c) => costCell(c.cost, gy, dx)) },
    { what: `One ${gy} costs it`, v: m.countries.map((c) => costCell(inverse(c), gx, dy)) },
    { what: "Without trade it makes and has", v: m.countries.map((c) => cell(c.autarky)) },
    ...(A === null ? [] : [
      { what: "At the market price it makes", v: m.market.outcome.map((o) => cell(o.production)) },
      { what: "and has", v: m.market.outcome.map((o) => cell(o.consumption)) },
    ]),
  ];
  factsBox.replaceChildren(table({
    caption: "The two countries side by side",
    columns: [{ key: "what", label: "Measure" }, { key: "a", label: c0.name }, { key: "b", label: c1.name }],
    rows: rows.map((r) => ({ what: r.what, a: r.v[0], b: r.v[1] })),
  }));
}

function drawCharts() {
  if (!model) return;
  const m = model, [gx, gy] = m.goods, p = m.price === null ? null : num(m.price);
  m.countries.forEach((c, i) => {
    const capX = num(c.cap.x), capY = num(c.cap.y);
    const o = m.market.outcome[i];
    const series = [{ name: "What it can make", type: "line", data: [[0, capY], [capX, 0]], color: 0, width: 2.4 }];
    let tradeLine = false;
    if (p !== null && o.sign > 0) {
      const income = p * num(o.production.x) + num(o.production.y); // in units of the second good
      series.push({ name: "What it can have at the market price", type: "line", data: [[0, income], [income / p, 0]], color: 1, dash: true });
      tradeLine = true;
    }
    series.push({ name: "Without trade", type: "scatter", data: [{ x: num(c.autarky.x), y: num(c.autarky.y), label: "Without trade" }], color: "#16233b", r: 5.5 });
    if (tradeLine) series.push({ name: "At the market price", type: "scatter", data: [{ x: num(o.consumption.x), y: num(o.consumption.y), label: "At the market price" }], color: 1, r: 5.5 });
    const mine = lastOffer?.outcome?.[i];
    if (mine) series.push({ name: "After your last offer", type: "scatter", data: [{ x: num(mine.consumption.x), y: num(mine.consumption.y), label: "After your last offer" }], color: 2, r: 5.5 });
    const reach = Math.max(...series.flatMap((sr) => sr.data.map((d) => (Array.isArray(d) ? d[0] : d.x))));
    charts[i].update({
      title: `${c.name}: what it can make and what it can have`,
      subtitle: tradeLine ? "Every point on or under a line is within reach. Trade moves the line outwards."
        : m.exporterX === null ? "With no comparative advantage, trade cannot move the line."
          : "At the market price this country's reach is the same as without trade.",
      label: `Chart for ${c.name}: its production possibility frontier in ${gx} and ${gy}, its consumption possibilities with trade, and the bundles it ends up with`,
      x: { label: gx, format: (v) => fmt.sig(v, 3), domain: [0, (reach || 1) * 1.06] },
      y: { label: gy, format: (v) => fmt.sig(v, 3), zero: true },
      series,
    });
  });
}

/* ---------- offers ---------- */
// The boxes are read raw, so that a number outside the allowed range is reported as that and not as "missing".
const typed = (f) => exactOf(f)?.q ?? (f.input.value.trim() === "" ? NaN : Number(f.input.value));
const readOffer = () => ({ proposer: Number(speaker.value), gives: giveGood.value, give: typed(giveAmount), get: typed(getAmount) });

function marketOffer(reversed) {
  if (model.exporterX === null) return null;
  const me = Number(speaker.value), sellsX = model.exporterX === me;
  // The exact amounts: the boxes show them to six figures and the offer uses the fractions behind them, so that
  // rounding cannot turn "gains nothing" into a small loss.
  const { x, y } = model.market;
  if (![x, y].every((v) => num(v) >= LIMITS.min && num(v) <= LIMITS.max)) return null;
  return sellsX !== reversed ? { gives: "x", give: x, get: y } : { gives: "y", give: y, get: x };
}
const noExample = (label) => (model?.exporterX === null
  ? `There is no "${label.toLowerCase()}" here: with no comparative advantage the market makes no trade. Type an offer of your own.`
  : `There is no such offer here: the other side's own price is zero or has no upper limit. Type an offer of your own.`);

/** The line under the boxes: what price the typed amounts amount to. */
function hint() {
  if (!model) return;
  const [gx, gy] = model.goods, o = readOffer();
  setLabel(getAmount, `You ask for (${model.goods[o.gives === "x" ? 1 : 0]})`);
  if (![o.give, o.get].every((v) => asNumber(v) >= LIMITS.min && asNumber(v) <= LIMITS.max)) { offerHint.textContent = `Type two amounts between ${LIMITS.min} and ${LIMITS.max.toLocaleString("en-GB")}.`; return; }
  const priceQ = o.gives === "x" ? Q.div(Q.of(o.get), Q.of(o.give)) : Q.div(Q.of(o.give), Q.of(o.get));
  const price = num(priceQ);
  const r = model.range;
  const range = !r ? "No price makes both better off here."
    : `Both can gain only when ${model.countries[model.exporterX].name} sells ${gx} at a price ${Q.sign(r.lo) === 0 ? "above zero" : `above ${sigQ(r.lo, figuresFor(r.lo, r.hi))}`}${r.hi === null ? "" : ` and below ${sigQ(r.hi, figuresFor(r.lo, r.hi))}`}.`;
  offerHint.textContent = `That is ${fmt.sig(price, 4)} ${gy} per ${gx}. ${range}${nearLimit(priceQ)}`;
}

function makeOffer() {
  if (!model) return;
  const offer = readOffer();
  const r = respond(model, offer);
  const [gx, gy] = model.goods, me = model.countries[offer.proposer], them = model.countries[1 - offer.proposer];
  const given = model.goods[offer.gives === "x" ? 0 : 1], asked = model.goods[offer.gives === "x" ? 1 : 0];
  if (r.code === "invalid") { reply.replaceChildren(note("bad", r.message)); return; }
  const terms = `${amount(offer.give, given)} for ${amount(offer.get, asked)}`;
  const price = `${n4(r.price)} ${gy} per ${gx}`;
  const cap = (c, g) => n4(c.cap[g === gx ? "x" : "y"]);
  let kind = "warn", text;
  if (r.code === "proposerCannot") text = `${me.name} could not deliver: with every worker on ${given} it makes ${cap(me, given)} at most, and the offer promises ${n4(offer.give)}.`;
  else if (r.code === "counterpartCannot") text = `${them.name} could not deliver: with every worker on ${asked} it makes ${cap(them, asked)} at most, and the offer asks for ${n4(offer.get)}.`;
  else {
    const mine = r.outcome[offer.proposer], theirs = r.outcome[1 - offer.proposer];
    const buysX = r.from === offer.proposer; // the counterpart is buying the first good
    const home = them.cost === null ? `it cannot make ${gx} at all` : `a unit of ${gx} costs it ${n4(them.cost)} ${gy} at home`;
    if (r.code === "accept") {
      kind = mine.sign > 0 ? "good" : "warn";
      text = `${them.name} accepts ${terms}, a price of ${price}: ${home}, and it ${fares(theirs, them)}. ${me.name} ${fares(mine, me)}.`
        + (mine.sign < 0 ? ` You would not want this deal.` : mine.sign === 0 ? ` All of the gain goes to ${them.name}.` : "");
    } else if (r.code === "price") {
      text = `${them.name} refuses ${terms}. That is ${price}, and ${home}: ${buysX ? `it would be paying more for ${gx} than making it costs` : `it would be selling ${gx} for less than making it costs`}. `
        + (them.cost === null ? "" : `It can gain only at a price ${buysX ? "below" : "above"} ${n4(them.cost)}.`);
    } else if (r.code === "edge") {
      text = `${them.name} refuses ${terms}. That is ${price}, exactly what a unit of ${gx} costs it at home, so the trade ${theirs.sign === 0 ? "would leave it exactly as well off as no trade at all" : "could not help it and at this quantity would hurt it"}. It has no reason to say yes. ${me.name} ${fares(mine, me)}.`;
    } else {
      text = `${them.name} refuses ${terms}. The price of ${price} suits it, but this much trade does not: after handing over ${amount(offer.get, asked)} it ${fares(theirs, them)}. Offer less at the same price.`;
    }
  }
  if (r.outcome && r.code !== "edge") text += nearLimit(r.price);
  reply.replaceChildren(note(kind, text));
  lastOffer = r.outcome ? r : null;
  offerCount++;
  offers.unshift(`Offer ${offerCount}: ${me.name} proposes ${terms}. ${text}`);
  if (offers.length > 8) offers.pop(); // the list keeps the latest eight
  logList.replaceChildren(...offers.map((t) => el("li", { text: t })));
  logBox.hidden = false;
  drawCharts();
}

load(PRESETS[0]);
update();
