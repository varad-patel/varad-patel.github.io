// Day 36: House Price Predictor. Interface.
import { $, el, fmt, mount, numberField, select, segmented, button, stat, note, table, chart } from "../kit/kit.js";
import { MODEL, REFERENCE, PERIODS, LEVELS, LIMITS, ROOMS, ARRONDISSEMENTS, predict, breakdown, curve, unusual, heldOut, medianAbsError, ordinal, periodLabel } from "./logic.js";

mount();

const state = { ...REFERENCE, level: 0.9, explore: "area" };
const flat = () => ({ area: state.area, rooms: state.rooms, arr: state.arr, out: state.out, period: state.period });

/* ---------- formatting ---------- */
// An estimate that is typically 13% out is not printed to the euro: three significant figures.
const eur = (v) => `€${fmt.sig(Math.abs(v), 3)}`;
const eurSigned = (v) => (Math.abs(v) < 0.5 ? "€0" : `${v > 0 ? "+" : "−"}${eur(v)}`);
// A percentage effect to one decimal; a small one that would print as 0.0% gets the decimals it needs.
const pct = (v) => {
  if (v !== 0 && Math.abs(v) < 5e-6) return v > 0 ? "under +0.001%" : "under −0.001%";
  const d = v === 0 || Math.abs(v) >= 5e-4 ? 1 : Math.abs(v) >= 5e-5 ? 2 : 3;
  return `${fmt.signed(v * 100, d)}%`.replace("-", "−");
};
const shortPeriod = (p) => `${p.slice(0, 4)} ${p.slice(4)}`;
const month = (iso) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const describe = (f) => `${fmt.sig(f.area, 4)} m², ${f.rooms === 6 ? "6 or more rooms" : f.rooms === 1 ? "1 room" : `${f.rooms} rooms`}, ${ordinal(f.arr)} arrondissement, ${["no outbuilding", "one outbuilding", "two or more outbuildings"][f.out]}, sold ${periodLabel(f.period)}`;

/* ---------- controls ---------- */
const EXAMPLES = [
  { label: "Reference flat", flat: { ...REFERENCE } },
  { label: "Studio in the 18th", flat: { area: 18, rooms: 1, arr: 18, out: 0, period: "2025H2" } },
  { label: "Family flat in the 16th", flat: { area: 95, rooms: 4, arr: 16, out: 2, period: "2025H2" } },
  { label: "Three rooms in the 6th, 2022", flat: { area: 60, rooms: 3, arr: 6, out: 0, period: "2022H1" } },
];
const areaField = numberField({
  label: "Floor area (m²)", min: LIMITS.areaMin, max: LIMITS.areaMax, value: state.area,
  hint: `From ${LIMITS.areaMin} to ${LIMITS.areaMax} m². The land register's figure: floor space between the walls, rounded down, without cellars or parking.`,
});
const areaNote = el("div");
areaField.input.addEventListener("input", () => {
  const v = areaField.value;
  if (Number.isNaN(v)) {
    areaNote.replaceChildren(note("bad", `Floor area must be a number from ${LIMITS.areaMin} to ${LIMITS.areaMax} m². The estimate still uses ${fmt.sig(state.area, 4)} m².`));
    return;
  }
  areaNote.replaceChildren();
  state.area = v;
  update();
});
const roomsSel = select({
  label: "Main rooms", value: state.rooms, options: ROOMS.map((r) => ({ value: r, label: r === 6 ? "6 or more" : String(r) })),
  hint: "Living rooms and bedrooms. Kitchens and bathrooms are not counted.",
  onChange: (v) => { state.rooms = Number(v); update(); },
});
const arrSel = select({
  label: "Arrondissement", value: state.arr, options: ARRONDISSEMENTS.map((a) => ({ value: a, label: ordinal(a) })),
  onChange: (v) => { state.arr = Number(v); update(); },
});
const outSeg = segmented({
  label: "Outbuildings sold with it", value: state.out, options: [{ value: 0, label: "None" }, { value: 1, label: "One" }, { value: 2, label: "Two or more" }],
  hint: "A cellar, store room, garage or parking space recorded in the same sale. The data does not say which.",
  onChange: (v) => { state.out = Number(v); update(); },
});
const periodSel = select({
  label: "Sold in", value: state.period, options: PERIODS.map((p) => ({ value: p, label: periodLabel(p) })),
  onChange: (v) => { state.period = v; update(); },
});
const levelSeg = segmented({
  label: "Range to show", value: state.level, options: LEVELS.map((l) => ({ value: l, label: `${l * 100}%` })),
  hint: "The share of similar sales the range should hold.",
  onChange: (v) => { state.level = Number(v); update(); },
});
function load(f) {
  Object.assign(state, f);
  areaField.value = f.area; areaNote.replaceChildren();
  roomsSel.value = f.rooms; arrSel.value = f.arr; outSeg.value = f.out; periodSel.value = f.period;
  update();
}
// The same two figures as the first two tiles, kept in view on a phone (hidden from screen readers: the status line says it).
const mini = el("p", { class: "mini", "aria-hidden": "true" });
const controls = el("div", { class: "controls" }, mini,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row", role: "group", "aria-label": "Example flats" }, EXAMPLES.map((ex) => button(ex.label, () => load(ex.flat), { small: true })))),
  areaField.el, areaNote, roomsSel.el, arrSel.el, outSeg.el, periodSel.el, levelSeg.el);

/* ---------- outputs ---------- */
const C = MODEL.counts, T = MODEL.test, U = T.withPriceRuleUndone;
const about = note("", el("strong", { text: "Not a valuation. " }),
  `The model was fitted to ${fmt.int(C.train)} sales of flats in Paris registered between ${month(MODEL.firstSale)} and ${month(MODEL.lastSale)}, from the French tax authority's open data. It knows a flat's size, rooms, arrondissement and half-year of sale, and nothing about its floor, condition, view or street. It says nothing about property anywhere else.`);
const sPrice = stat("Estimate");
const sRange = stat("Range");
const sPerM2 = stat("Per square metre");
const sExtra = stat("One more m² adds");
const status = el("p", { class: "sr-only", role: "status" });
const warnBox = el("div");
const breakBox = el("div", { class: "breakdown" });
const chainBox = el("p", { class: "small chain" });
const out = el("div", { class: "out" }, about, el("div", { class: "stats" }, sPrice.el, sRange.el, sPerM2.el, sExtra.el), status, warnBox,
  el("div", { class: "part" }, el("h2", { text: "What each feature adds" }),
    el("p", { class: "small muted", text: "Each feature multiplies the price, so its effect is a percentage. The euro column turns that percentage into money at this flat's estimate: the estimate minus what the same flat would fetch with that one feature set back to the reference flat's." }),
    breakBox, chainBox));

const exploreSeg = segmented({
  label: "Change one feature, keep the rest", value: state.explore,
  options: [{ value: "area", label: "Floor area" }, { value: "rooms", label: "Rooms" }, { value: "arr", label: "Arrondissement" }, { value: "out", label: "Outbuildings" }, { value: "period", label: "Sale period" }],
  onChange: (v) => { state.explore = v; drawExplore(); },
});
const exploreBox = el("div");
const fitBox = el("div");
const errBox = el("div", { class: "part" });   // a grid with a gap, so the paragraphs and the table do not run together
const lower = el("div", { class: "grid2" },
  el("div", { class: "part" }, el("h2", { text: "How the estimate moves" }), exploreSeg.el, exploreBox),
  el("div", { class: "part" }, el("h2", { text: "How far out it is on sales it never saw" }), errBox, fitBox));

$("#app").append(el("div", { class: "tool-grid" }, controls, out), lower);
const exploreChart = chart(exploreBox, { series: [], height: 320 });

/* ---------- rendering ---------- */
function update() {
  const f = flat();
  const p = predict(f, state.level);
  if (p.error) { warnBox.replaceChildren(note("bad", p.error)); return; }   // cannot happen from the controls; kept so a bug shows as words
  const share = `${state.level * 100}%`;
  // Said where the number is: an average over many flats, not a figure for any one of them.
  sPrice.set(eur(p.price), `an average for flats like this sold in Paris in ${periodLabel(f.period)}; not a valuation of any one flat`);
  sRange.el.querySelector(".l").textContent = `${share} of similar sales`;
  sRange.set(`${eur(p.low)} to ${eur(p.high)}`, `where ${share} of held-out sales in the ${ordinal(f.arr)} fell`);
  sPerM2.set(eur(p.perM2), `${fmt.sig(f.area, 4)} m² in all`);
  sExtra.set(eur(p.perExtraM2), `at this size: ${fmt.num(p.elasticity, 2)}% more price for 1% more floor`);
  mini.replaceChildren("Estimate ", el("strong", { text: eur(p.price) }), `; ${share} of similar sales ${eur(p.low)} to ${eur(p.high)}`);
  status.textContent = `Estimate ${eur(p.price)} for ${describe(f)}. ${share} of similar held-out sales fell between ${eur(p.low)} and ${eur(p.high)}.`;
  const odd = unusual(f);
  warnBox.replaceChildren(...(odd ? [note("warn", odd)] : []));

  const b = breakdown(f);
  const total = b.price / b.referencePrice - 1;
  const rows = b.items.map((i) => ({
    feature: el("span", {}, el("strong", { text: i.label }), el("span", { class: "sub", text: i.same ? `${i.yours}, as in the reference flat` : `${i.yours}, against ${i.reference}` })),
    effect: i.same ? "no difference" : el("span", {}, pct(i.pct), Math.abs(i.pct) < 5e-6 ? null : el("span", { class: "sub", text: `95% interval ${pct(i.pctLow)} to ${pct(i.pctHigh)}` })),
    euros: i.same ? "€0" : eurSigned(i.euros),
  }));
  rows.push({
    feature: el("span", {}, el("strong", { text: "All five together" }), el("span", { class: "sub", text: "the percentages compound; the euros above are not meant to add up" })),
    effect: b.items.every((i) => i.same) ? "no difference" : pct(total),
    euros: eurSigned(b.price - b.referencePrice),
  });
  breakBox.replaceChildren(table({
    caption: `Against the reference flat (${describe(REFERENCE)}): ${eur(b.referencePrice)}`,
    columns: [{ key: "feature", label: "Feature" }, { key: "effect", label: "Effect on the price", num: true }, { key: "euros", label: "In euros, at this estimate", num: true }],
    rows,
  }));
  const changed = b.items.filter((i) => !i.same);
  chainBox.textContent = changed.length
    ? `${eur(b.referencePrice)} for the reference flat × ${changed.map((i) => `${fmt.num(i.factor, 3)} (${i.label.toLowerCase()})`).join(" × ")} = ${eur(b.price)}.`
    : "This is the reference flat, so nothing is added or taken away.";
  drawExplore();
}

function drawExplore() {
  const f = flat();
  const c = curve(f, state.explore, state.level);
  const share = `${state.level * 100}%`;
  const money = (v) => `€${fmt.compact(v)}`;
  if (state.explore === "area") {
    exploreChart.update({
      title: "Estimate by floor area", subtitle: `Everything else as chosen. The band is where ${share} of similar sales fell.`,
      label: `Line chart of the estimated price against floor area from ${LIMITS.areaMin} to ${LIMITS.areaMax} square metres, with the ${share} range`,
      x: { label: "Floor area (m²)", domain: [0, LIMITS.areaMax], format: (v) => fmt.sig(v, 3) }, y: { label: "Price", format: money, zero: true },
      series: [
        { name: `${share} of sales`, type: "range", data: c.points.map((q) => [q.value, q.low, q.high]), color: 0 },
        { name: "Estimate", type: "line", data: c.points.map((q) => [q.value, q.price]), color: 0 },
      ],
      marks: [{ type: "vline", x: f.area, text: "this flat" }],
    });
    return;
  }
  const names = c.points.map((q) => (state.explore === "period" ? shortPeriod(q.value) : state.explore === "arr" ? String(q.value) : q.label));
  const mine = c.points.findIndex((q) => q.current);
  exploreChart.update({
    title: { rooms: "Estimate by number of rooms", arr: "Estimate by arrondissement", out: "Estimate by outbuildings", period: "Estimate by half-year of sale" }[state.explore],
    subtitle: "Everything else as chosen. The dark bar, labelled, is this flat.",
    label: `Bar chart of the estimated price for each ${{ rooms: "number of rooms", arr: "arrondissement", out: "number of outbuildings", period: "half-year of sale" }[state.explore]}`,
    x: { type: "band", label: { rooms: "Main rooms", arr: "Arrondissement", out: "Outbuildings", period: "Half-year of sale" }[state.explore], categories: names }, y: { label: "Price", format: money, zero: true },
    series: [{ name: "Estimate", type: "bars", data: c.points.map((q, i) => ({ x: names[i], y: q.price, color: q.current ? "#16233b" : null })), color: 0 }],
    marks: mine >= 0 ? [{ type: "text", x: names[mine], y: c.points[mine].price, text: "this flat", anchor: mine > c.points.length / 2 ? "end" : "start", dx: mine > c.points.length / 2 ? 8 : -8, dy: -7 }] : [],
  });
}

/* ---------- held-out sales: drawn once ---------- */
const held = heldOut();
errBox.append(
  el("p", { class: "small", text: `${fmt.int(T.n)} sales, one in five chosen at random, were kept out of the fit. Half of the model's estimates for them were within ${fmt.pct(T.medianAbsPct, 1)} of the price paid, ${fmt.pct(T.within20, 0)} were within 20%, and ${fmt.pct(T.beyond30, 0)} missed by more than 30%. The 90% range held ${fmt.pct(T.coverage[LEVELS.indexOf(0.9)], 1)} of them.` }),
  // The price rule looks at the very thing being predicted, so the page says what the figures are with it undone.
  el("p", { class: "small", text: `These figures flatter the model in one way. Sales under €${fmt.int(MODEL.rules.perM2Min)} or over €${fmt.int(MODEL.rules.perM2Max)} per m² were removed before the fit, and that rule looks at the price itself. With one in five of the ${fmt.int(C.dropped.perM2Below + C.dropped.perM2Above)} removed sales put back beside the held-out ones, the median error is ${fmt.pct(U.medianAbsPct, 1)}, ${fmt.pct(U.beyond30, 0)} miss by more than 30%, and the 90% range holds ${fmt.pct(U.coverage90, 1)}.` }),
  table({
    caption: "Typical miss on the held-out sales (median error)",
    columns: [{ key: "rule", label: "Rule" }, { key: "err", label: "Median error", num: true, format: (v) => fmt.pct(v, 1) }],
    rows: [
      { rule: "This model", err: T.medianAbsPct },
      { rule: "Floor area × the median price per m² for the arrondissement and half-year", err: T.baselines.arrondissementAndPeriod },
      { rule: "Floor area × the median price per m² for the arrondissement", err: T.baselines.arrondissement },
      { rule: "Floor area × the median price per m² for Paris", err: T.baselines.paris },
    ],
  }),
  el("p", { class: "small muted", text: `A table of medians predicts a little better than the regression, and still does with the removed sales put back (${fmt.pct(U.arrondissementAndPeriod, 1)} against ${fmt.pct(U.medianAbsPct, 1)}). What the regression adds is the split into features above, not accuracy.` }));
const span = [Math.min(...held.map((s) => Math.min(s.paid, s.estimate))) * 0.9, Math.max(...held.map((s) => Math.max(s.paid, s.estimate))) * 1.1];
chart(fitBox, {
  title: `${fmt.int(held.length)} of the held-out sales`, subtitle: `Each dot is one sale. On the line the estimate equals the price paid. Half of these ${fmt.int(held.length)} are within ${fmt.pct(medianAbsError(held), 1)}.`,
  label: `Scatter plot of the price paid against the model's estimate for ${held.length} held-out sales, with a line where the two are equal`,
  height: 320, hover: "point", legend: true,
  x: { label: "Estimate", type: "log", domain: span, format: (v) => `€${fmt.compact(v)}` }, y: { label: "Price paid", type: "log", domain: span, format: (v) => `€${fmt.compact(v)}` },
  series: [
    { name: "Estimate equals price", type: "line", data: [[span[0], span[0]], [span[1], span[1]]], color: "#16233b", width: 1.5, hover: false },
    { name: "Held-out sales", type: "scatter", data: held.map((s) => ({ x: s.estimate, y: s.paid, label: `${s.flat.area} m², ${s.flat.rooms === 6 ? "6+" : s.flat.rooms} ${s.flat.rooms === 1 ? "room" : "rooms"}, ${ordinal(s.flat.arr)}, ${shortPeriod(s.flat.period)}` })), color: 0, r: 3, opacity: 0.7 },
  ],
});

update();
