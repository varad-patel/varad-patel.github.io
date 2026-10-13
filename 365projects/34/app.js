// Day 34: Coffee Index and Big Mac Economics. Interface.
import { $, el, fmt, mount, select, numberField, textField, button, stat, note, table, chart } from "../kit/kit.js";
import { BIGMAC } from "./data.js";
import { snapshot, valuation, sharedDates, history, ranking, countries, ownIndex, verdict, gapSize, gapSide, figure, monthOf, joinsFit, OWN_LIMITS } from "./logic.js";

mount();

const LIST = countries(BIGMAC);
const NEEDS_THE = new Set(["United States", "Euro area", "United Arab Emirates", "Philippines", "Czech Republic"]);
const the = (name) => (NEEDS_THE.has(name) ? `the ${name}` : name);
const pct = (v) => (Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 ? fmt.pct(v, 0) : fmt.pct(v, 1));
// A date as a position along the axis: the middle of its month, so that no point sits on a whole-year tick.
const xOf = (iso) => Number(iso.slice(0, 4)) + (Number(iso.slice(5, 7)) - 0.5) / 12;
const DATE_AT = new Map(BIGMAC.dates.map((d) => [xOf(d), monthOf(d)]));
const state = { a: "IND", b: "USA", date: BIGMAC.dates.at(-1) };

/* ---------- controls ---------- */
const options = LIST.map((c) => ({ value: c.iso, label: `${c.name} (${c.currency})` }));
const aSel = select({ label: "Currency to judge", value: state.a, options, onChange: (v) => { state.a = v; update(); } });
const bSel = select({ label: "Against", value: state.b, options, hint: "The index asks whether the first currency buys too many or too few burgers when it is turned into the second.", onChange: (v) => { state.b = v; update(); } });
const dateSel = select({ label: "Prices as of", value: state.date, options: [state.date], hint: "Only the rounds in which The Economist priced a Big Mac in both places are listed.", onChange: (v) => { state.date = v; update(); } });
const swap = button("Swap the two", () => { [state.a, state.b] = [state.b, state.a]; aSel.value = state.a; bSel.value = state.b; update(); }, { small: true });
const controls = el("div", { class: "controls" }, aSel.el, bSel.el, el("div", { class: "row" }, swap), dateSel.el,
  el("p", { class: "small muted", text: `Big Mac prices, exchange rates and GDP per person as published by The Economist, ${monthOf(BIGMAC.dates[0])} to ${monthOf(BIGMAC.dates.at(-1))}. Both indices are recalculated on this page from those inputs.` }));

/* ---------- outputs ---------- */
const tiles = { a: stat("Big Mac"), b: stat("Big Mac"), raw: stat("Raw index: the first against the second"), adj: stat("GDP-adjusted index") };
const labelA = $(".l", tiles.a.el), labelB = $(".l", tiles.b.el);
const message = el("div");
const reading = el("div", { class: "reading", role: "status" });
const historyBox = el("div"), scatterBox = el("div"), scatterNote = el("div");
const allSummary = el("summary");
const allBox = el("div");
const allDetails = el("details", { class: "chart-table all" }, allSummary, allBox);
const out = el("div", { class: "out" }, el("div", { class: "stats" }, Object.values(tiles).map((t) => t.el)), message, reading, historyBox, scatterBox, scatterNote, allDetails);
const historyChart = chart(historyBox, { series: [], height: 320 });
const scatterChart = chart(scatterBox, { series: [], height: 340 });

/* ---------- your own index ---------- */
const typed = (field) => (field.input.value.trim() === "" ? NaN : Number(field.input.value));
const short = (field, fallback) => field.value.trim().replace(/\s+/g, " ").slice(0, field.input.maxLength) || fallback;
const own = {
  good: textField({ label: "The good", value: "a cappuccino", hint: `Anything sold in much the same form in both places. Up to ${OWN_LIMITS.nameMax} characters.` }),
  curA: textField({ label: "First currency", value: "rupees", hint: "Its name or code. Up to 12 characters." }),
  curB: textField({ label: "Second currency", value: "dollars", hint: "Its name or code. Up to 12 characters." }),
  priceA: numberField({ label: "Price in the first currency", min: 0, value: 250 }),
  priceB: numberField({ label: "Price in the second currency", min: 0, value: 5.5 }),
  rate: numberField({ label: "Exchange rate", min: 0, value: 96, hint: "Units of the first currency that one unit of the second buys." }),
};
own.good.input.maxLength = OWN_LIMITS.nameMax;
own.curA.input.maxLength = 12;
own.curB.input.maxLength = 12;
const ownOut = el("div", { class: "own-out", role: "status" });
const ownFlag = el("p", { class: "small muted" });
let ownIsExample = true;
function fillOwn(values, example) {
  own.good.value = values.good; own.curA.value = values.curA; own.curB.value = values.curB;
  own.priceA.value = values.priceA; own.priceB.value = values.priceB; own.rate.value = values.rate;
  ownIsExample = example;
  updateOwn();
}
const INVENTED = { good: "a cappuccino", curA: "rupees", curB: "dollars", priceA: 250, priceB: 5.5, rate: 96 };
const fromBurger = button("Use the Big Mac figures chosen above", () => {
  const v = valuation(snapshot(BIGMAC, state.date), state.a, state.b);
  if (!v) return;
  fillOwn({ good: "a Big Mac", curA: v.a.currency, curB: v.b.currency, priceA: v.a.localPrice, priceB: v.b.localPrice, rate: Number(v.market.toPrecision(10)) }, "burger");
}, { small: true });
const ownPanel = el("div", { class: "own" },
  el("h2", { text: "Your own index: any one good, your own prices" }),
  el("p", { class: "small", text: "Nobody publishes an open dataset of coffee prices around the world, so this half runs on figures you supply. Price one good in two places, give the exchange rate, and the page does the same sum as the raw Big Mac index." }),
  el("div", { class: "own-grid" }, own.good.el, own.curA.el, own.curB.el, own.priceA.el, own.priceB.el, own.rate.el),
  el("div", { class: "row" }, fromBurger, button("Put back the invented example", () => fillOwn(INVENTED, true), { small: true })),
  ownFlag, ownOut);
for (const f of Object.values(own)) f.input.addEventListener("input", () => { ownIsExample = false; updateOwn(); });

function updateOwn() {
  const r = ownIndex({ priceA: typed(own.priceA), priceB: typed(own.priceB), rate: typed(own.rate) });
  for (const key of ["priceA", "priceB", "rate"]) own[key].input.classList.toggle("invalid", !r.ok && r.field === key);
  ownFlag.textContent = ownIsExample === true ? "These starting figures are an invented example, not data. Replace them with prices you have seen yourself."
    : ownIsExample === "burger" ? "These are The Economist's Big Mac figures from the tool above, so the answer matches its raw index."
    : "These are your own figures. Nothing here comes from a dataset, and nothing you type leaves this page.";
  if (!r.ok) { ownOut.replaceChildren(note("bad", r.error)); return; }
  const good = short(own.good, "the good"), a = short(own.curA, ""), b = short(own.curB, "");
  const first = a ? `the first currency (${a})` : "the first currency", second = b ? `the second (${b})` : "the second";
  const gap = fmt.pct(Math.abs(r.value), 1) === "0.0%" ? "very slightly" : gapSize(r.value);
  // A price more than eleven times the other is said as a multiple: "more than 1,000% more" reads badly.
  const dearer = r.value > 10 ? "more than 11 times as much in the first place as" : `${gap} ${r.value > 0 ? "more" : "less"} in the first place than`;
  ownOut.replaceChildren(
    el("div", { class: "stats" },
      stat("Rate that would equalise the price", figure(r.implied), "units of the first currency per unit of the second").el,
      stat("Rate you entered", figure(r.market), "units of the first currency per unit of the second").el,
      stat(ownIsExample === true ? "The invented example says" : ownIsExample === "burger" ? "The Big Mac says" : "Your figures say", gapSize(r.value), `${gapSide(r.value)}: the first currency against the second`).el),
    el("p", { class: "own-line", text: r.value === 0
      ? `On these figures ${good} costs the same in both places once the money is exchanged, so neither currency looks over- or undervalued against the other.`
      : `On these figures ${good} costs ${dearer} in the second once the money is exchanged. By the logic of the index that makes ${first} ${verdict(r.value)} against ${second}. One good is thin evidence: see the limits below.` }));
}

/* ---------- rendering ---------- */
function update() {
  const dates = sharedDates(BIGMAC, state.a, state.b);
  if (!dates.includes(state.date)) state.date = dates.at(-1) || state.date;
  dateSel.input.replaceChildren(...[...dates].reverse().map((d) => el("option", { value: d, text: monthOf(d) })));
  dateSel.input.disabled = !dates.length;
  dateSel.value = state.date;

  const A = LIST.find((c) => c.iso === state.a), B = LIST.find((c) => c.iso === state.b);
  const snap = snapshot(BIGMAC, state.date);
  const v = dates.length ? valuation(snap, state.a, state.b) : null;
  labelA.textContent = `Big Mac in ${the(A.name)}`;
  labelB.textContent = `Big Mac in ${the(B.name)}`;
  if (!v) {
    message.replaceChildren(note("warn", `The Economist never priced a Big Mac in ${the(A.name)} and in ${the(B.name)} in the same round, so there is nothing to compare. Choose another pair.`));
    reading.replaceChildren();
    for (const t of Object.values(tiles)) t.set("–", "");
    for (const c of [historyChart, scatterChart]) c.update({ title: "", subtitle: "", series: [], marks: [], empty: "No round has both prices" });
    scatterNote.replaceChildren(); allDetails.hidden = true;
    return;
  }
  allDetails.hidden = false;
  const when = monthOf(state.date);
  const same = state.a === state.b;
  message.replaceChildren(...(same ? [note("warn", "The same currency is on both sides, and a currency is always at parity with itself. Choose two different ones.")] : []));

  tiles.a.set(`${figure(v.a.localPrice)} ${v.a.currency}`, v.a.currency === "USD" ? "the dollar is the yardstick" : `${figure(v.a.dollarPrice)} US dollars at the market rate`);
  tiles.b.set(`${figure(v.b.localPrice)} ${v.b.currency}`, v.b.currency === "USD" ? "the dollar is the yardstick" : `${figure(v.b.dollarPrice)} US dollars at the market rate`);
  tiles.raw.set(gapSize(v.raw), same ? gapSide(v.raw) : `${gapSide(v.raw)}: burger rate ${figure(v.implied)}, market rate ${figure(v.market)} ${v.a.currency} per ${v.b.currency}`);
  const lacking = [v.a, v.b].filter((r, i) => r.adjPrice == null && (i === 0 || !same));
  const why = lacking.map((r) => {
    if (r.left !== "list") return `The Economist's files give no GDP per person for ${the(r.name)} at this date`;
    const from = joinsFit(BIGMAC, r.iso);
    return from ? `${the(r.name)} joins the list The Economist fits its income line to only in ${monthOf(from)}` : `${the(r.name)} is not on the list The Economist fits its income line to`;
  }).join(", and ");
  tiles.adj.set(gapSize(v.adjusted), v.adjusted == null ? `none for ${lacking.map((r) => the(r.name)).join(" or ")}` : same ? gapSide(v.adjusted) : `${gapSide(v.adjusted)}, after allowing for income per person in each place`);

  const lines = [
    `In ${when} a Big Mac cost ${figure(v.a.localPrice)} ${v.a.currency} in ${the(v.a.name)}${same ? "" : ` and ${figure(v.b.localPrice)} ${v.b.currency} in ${the(v.b.name)}`}.`
      + (same ? "" : ` The two prices would be equal at ${figure(v.implied)} ${v.a.currency} per ${v.b.currency}; the market rate was ${figure(v.market)}. On the raw index the ${v.a.currency} is ${verdict(v.raw)} against the ${v.b.currency}${v.raw === 0 ? "" : `: the burger is ${v.raw > 0 ? "dearer" : "cheaper"} in ${the(v.a.name)} once the money is exchanged`}.`),
  ];
  if (!same) {
    lines.push(v.adjusted == null
      ? `There is no GDP-adjusted figure for this pair: ${why}.`
      : `Burgers are cheaper where incomes are lower. A line fitted across ${snap.fit.n} economies predicts a price of ${figure(v.a.adjPrice)} dollars for ${the(v.a.name)}, where it actually costs ${figure(v.a.dollarPrice)}, and ${figure(v.b.adjPrice)} dollars for ${the(v.b.name)}, where it costs ${figure(v.b.dollarPrice)}. Measured against those predictions, the ${v.a.currency} is ${verdict(v.adjusted)} against the ${v.b.currency}.`);
  }
  reading.replaceChildren(...lines.map((text) => el("p", { text })));

  // The pair through time.
  const h = history(BIGMAC, state.a, state.b);
  historyChart.update({
    title: `The ${v.a.currency} against the ${v.b.currency}, ${monthOf(h[0].date)} to ${monthOf(h.at(-1).date)}`,
    subtitle: "Above the line the first currency looks overvalued, below it undervalued. The dashed line marks the date chosen.",
    label: `Line chart of the raw and GDP-adjusted Big Mac index for the ${v.a.currency} against the ${v.b.currency} over time`,
    x: { label: "Date", format: (x) => DATE_AT.get(x) ?? String(Math.round(x)) },
    y: { label: "Over- or undervaluation", format: pct, zero: true },   // parity is always in view, whichever side the pair sits on
    series: [
      { name: "Raw index", type: "line", color: 0, data: h.map((p) => [xOf(p.date), p.raw]) },
      { name: "GDP-adjusted index", type: "line", color: 1, data: h.map((p) => [xOf(p.date), p.adjusted ?? NaN]) },
    ],
    marks: [{ type: "hline", y: 0, text: "parity" }, { type: "vline", x: xOf(state.date) }],
    empty: "",
  });

  // The adjustment: burger price against income, with the fitted line.
  const xs = snap.sample.map((r) => r.gdpBigmac);
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const picked = snap.sample.filter((r) => r.iso === state.a || r.iso === state.b);
  scatterChart.update({
    title: `Why adjust for income: ${when}`,
    subtitle: `Each dot is one of the ${snap.fit.n} economies the line is fitted to: countries, and the euro area as a whole. One above the line has a dearer burger than its income predicts.`,
    label: "Scatter plot of the dollar price of a Big Mac against GDP per person, with the fitted line",
    hover: "point", legend: false,
    x: { label: "GDP per person in dollars, at the burger rate", format: (x) => `$${fmt.compact(x)}` },
    y: { label: "Big Mac price in US dollars", format: (y) => fmt.num(y, 2) },
    series: [
      { name: "Fitted line", type: "line", color: "#16233b", width: 2, hover: false, data: [[lo, snap.fit.intercept + snap.fit.slope * lo], [hi, snap.fit.intercept + snap.fit.slope * hi]] },
      { name: "Countries", type: "scatter", color: "#8a94a3", r: 4, data: snap.sample.filter((r) => !picked.includes(r)).map((r) => ({ x: r.gdpBigmac, y: r.dollarPrice, label: r.name })) },
      { name: "Chosen", type: "scatter", color: 0, r: 5.5, data: picked.map((r) => ({ x: r.gdpBigmac, y: r.dollarPrice, label: r.name })) },
    ],
    // A label for a country on the right of the chart is set to the left of its dot, so it cannot run off the edge.
    marks: picked.map((r) => (r.gdpBigmac > lo + (hi - lo) * 0.55 ? { type: "text", x: r.gdpBigmac, y: r.dollarPrice, text: r.name, dx: -9, dy: -8, anchor: "end" } : { type: "text", x: r.gdpBigmac, y: r.dollarPrice, text: r.name, dx: 9, dy: 4 })),
    empty: "",
  });
  scatterNote.replaceChildren(el("p", { class: "small muted", text: `The line: price = ${fmt.num(snap.fit.intercept, 2)} + ${fmt.num(snap.fit.slope * 10000, 3)} for every $10,000 of GDP per person. It explains ${fmt.pct(snap.fit.r2, 0)} of the variation in price across the ${snap.fit.n} economies.` }));

  // Everything else on that date.
  const rawRank = ranking(snap, state.b, "raw");
  allSummary.textContent = `Every currency in the index against the ${v.b.currency}, ${when} (${rawRank.length})`;
  allBox.replaceChildren(table({
    caption: `Most overvalued first. A positive figure means overvalued against the ${v.b.currency}.`,
    columns: [
      { key: "name", label: "Country and currency", format: (name, row) => `${name} (${row.currency})` },
      { key: "value", label: "Raw", num: true, format: (x) => fmt.signed(x * 100, 1) + "%" },
      { key: "adjusted", label: "GDP-adjusted", num: true, format: (x) => (x == null ? "none" : fmt.signed(x * 100, 1) + "%") },
    ],
    rows: rawRank.map((r) => ({ ...r, adjusted: valuation(snap, r.iso, state.b).adjusted })),
  }));
}

$("#app").append(el("div", { class: "tool-grid" }, controls, out), ownPanel);
update();
updateOwn();
