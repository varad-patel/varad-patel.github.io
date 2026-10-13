// Day 40: Supply Shock Simulator. Interface.
import { $, el, fmt, mount, select, segmented, numberField, checkbox, button, stat, note, table, chart, palette } from "../kit/kit.js";
import { SHOCKS, LIMITS, shockOf, simulate, curvePoints, bandPoints, reading, equations, amount, show, change, share, groupName } from "./logic.js";

mount();

const START = { family: "ce", p0: 10, q0: 100, ed: 0.3, es: 0.5, shock: "drought", size: 20, world: 7 };
// Made-up markets that show one mechanism each. None is an estimate of a real market.
const EXAMPLES = [
  { name: "Drought, buyers who cannot cut back", m: START },
  { name: "Drought, buyers who can switch", m: { ...START, ed: 1.5 } },
  { name: "Strike", m: { family: "linear", p0: 10, q0: 100, ed: 0.5, es: 1, shock: "strike", size: 40, world: 7 } },
  { name: "Tax on a necessity", m: { family: "linear", p0: 10, q0: 100, ed: 0.2, es: 2, shock: "tax", size: 3, world: 7 } },
  { name: "Subsidy", m: { family: "linear", p0: 10, q0: 100, ed: 1, es: 1, shock: "subsidy", size: 2, world: 7 } },
  { name: "Rent ceiling", m: { family: "linear", p0: 10, q0: 100, ed: 0.5, es: 0.5, shock: "ceiling", size: 8, world: 7 } },
  { name: "Minimum price", m: { family: "linear", p0: 10, q0: 100, ed: 0.5, es: 1, shock: "floor", size: 12, world: 7 } },
  { name: "Import ban", m: { family: "linear", p0: 10, q0: 100, ed: 0.5, es: 1, shock: "ban", size: 0, world: 7 } },
  { name: "Tariff", m: { family: "linear", p0: 10, q0: 100, ed: 0.5, es: 1, shock: "tariff", size: 2, world: 7 } },
];
// One colour per kind of area, from the kit's palette: transfers in green, purple and yellow, losses in red and pink.
const AREA_COLOR = { toSellers: 2, toBuyers: 2, taxBuyers: 6, taxSellers: 3, subBuyers: 6, subSellers: 3, tariff: 3, lostBuyers: 7, lostSellers: 4, dwlBuyers: 7, dwlSellers: 4, dwl: 7, dwlMaking: 4, dwlBuying: 7 };
const SIZE_HINT = {
  drought: "Every producer plants and spends as before but harvests this much less. From 0 to 90.",
  strike: "This share of producers stops altogether. The rest carry on with the same costs. From 0 to 90.",
  cost: "Added to the cost of making each unit, in the same units as the price. Nobody collects it.",
  tax: "Collected by the government on each unit sold, in the same units as the price.",
  subsidy: "Paid by the government on each unit sold, in the same units as the price.",
  ceiling: "Selling above this price is against the law. It only matters if it is below the price before.",
  floor: "Selling below this price is against the law. It only matters if it is above the price before.",
  tariff: "Collected by the government on each imported unit, in the same units as the price.",
};

/* ---------- controls ---------- */
const typed = (field) => (field.input.value.trim() === "" ? NaN : Number(field.input.value));
// A fresh shock starts at a size that shows something: a fifth of the harvest, a fifth of the price, a ceiling a fifth below it.
function startingSize(key) {
  const kind = shockOf(key).size, p0 = typed(p0Field) > 0 ? typed(p0Field) : START.p0;
  return kind === "share" ? 20 : Number((p0 * (key === "ceiling" ? 0.8 : key === "floor" ? 1.2 : 0.2)).toPrecision(6));
}
const shockSel = select({
  label: "Shock", value: START.shock, options: SHOCKS.map((s) => ({ value: s.key, label: s.label })),
  onChange: (key) => { if (shockOf(key).size !== "none") sizeField.value = startingSize(key); update(); },
});
const sizeField = numberField({ label: "Size", min: 0, value: START.size, hint: " " });
const worldField = numberField({ label: "World price", min: 0, value: START.world, hint: "What an imported unit costs. Imports arrive only if this is below the price before the shock, which is the price the home market reaches when it is closed to trade." });
const familySeg = segmented({
  label: "Shape of the curves", value: START.family,
  options: [{ value: "linear", label: "Straight lines" }, { value: "ce", label: "Constant elasticity" }],
  hint: "Both pass through the price and quantity below with the elasticities given. Straight lines get more elastic as the price rises; the other kind keep one elasticity all the way along.",
  onChange: () => update(),
});
const p0Field = numberField({ label: "Price before the shock", min: 0, value: START.p0 });
const q0Field = numberField({ label: "Quantity before the shock", min: 0, value: START.q0 });
const edField = numberField({ label: "Elasticity of demand", min: 0, step: 0.1, value: START.ed, hint: "The percentage fall in the quantity bought when the price rises 1%, as a positive number from 0 to 20. 0 is a vertical line." });
const esField = numberField({ label: "Elasticity of supply", min: 0, step: 0.1, value: START.es, hint: "The percentage rise in the quantity offered when the price rises 1%, from 0 to 20. 0 is a vertical line." });
const edFlat = checkbox({ label: "Perfectly elastic demand (a flat line)", onChange: () => update() });
const esFlat = checkbox({ label: "Perfectly elastic supply (a flat line)", onChange: () => update() });
const fields = { size: sizeField, world: worldField, p0: p0Field, q0: q0Field, ed: edField, es: esField };
for (const f of Object.values(fields)) f.input.addEventListener("input", () => update());
const sizeLabel = $("label", sizeField.el), sizeHint = $(".hint", sizeField.el);

function load(m) {
  shockSel.value = m.shock;
  familySeg.value = m.family;
  sizeField.value = m.size; worldField.value = m.world; p0Field.value = m.p0; q0Field.value = m.q0;
  edFlat.checked = m.ed === Infinity; esFlat.checked = m.es === Infinity;
  if (m.ed !== Infinity) edField.value = m.ed;
  if (m.es !== Infinity) esField.value = m.es;
  update();
}
const examples = el("div", { class: "field", role: "group", "aria-label": "Examples" },
  el("div", { class: "lab" }, el("span", { text: "Examples" })),
  el("div", { class: "row" }, EXAMPLES.map((x) => button(x.name, () => load(x.m), { small: true }))),
  el("div", { class: "hint", text: "The numbers in the examples are made up to show each mechanism. They are not estimates of any real market." }));

// On a narrow screen the result sits below a long column of controls, so the first thing offered is a way down to it.
const controls = el("div", { class: "controls" },
  el("a", { class: "jump", href: "#result", text: "Jump down to the result" }),
  examples, shockSel.el, sizeField.el, worldField.el, familySeg.el,
  el("div", { class: "pair" }, p0Field.el, q0Field.el),
  el("div", { class: "field" }, edField.el, edFlat.el),
  el("div", { class: "field" }, esField.el, esFlat.el),
  el("div", { class: "row" }, button("Reset", () => load(START), { small: true })));

/* ---------- outputs ---------- */
const tiles = { pb: stat("Price buyers pay"), ps: stat("Price sellers keep"), q: stat("Quantity traded"), loss: stat("Net loss") };
const lossLabel = $(".l", tiles.loss.el), quantityLabel = $(".l", tiles.q.el);
const message = el("div");
const readingBox = el("div", { class: "reading", role: "status" });
const chartBox = el("div");
const curvesBox = el("p", { class: "small curves" });
const whoBox = el("div"), areaBox = el("div");
const out = el("div", { class: "out", id: "result", tabindex: "-1" }, el("div", { class: "stats" }, Object.values(tiles).map((t) => t.el)), message, readingBox, chartBox, curvesBox, whoBox, areaBox);
$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out));
const plot = chart(chartBox, { series: [], height: 400, table: false });

/* ---------- rendering ---------- */
const withPowers = (text) => text.split(/(\^−?\d+(?:\.\d+)?)/).map((bit) => (bit.startsWith("^") ? el("sup", { text: bit.slice(1) }) : bit));
const signedAmount = (x) => (x === 0 ? "0.00" : Math.abs(x) < 1e-9 ? `a ${x > 0 ? "gain" : "loss"} of ${amount(Math.abs(x))}` : x > 0 ? `+${amount(x)}` : `-${amount(-x)}`);

function model() {
  const shock = shockOf(shockSel.value);
  return {
    family: familySeg.value, p0: typed(p0Field), q0: typed(q0Field),
    ed: edFlat.checked ? Infinity : typed(edField), es: esFlat.checked ? Infinity : typed(esField),
    shock: shock.key, size: shock.size === "none" ? 0 : typed(sizeField), world: shock.world ? typed(worldField) : START.world,
  };
}

function update() {
  const shock = shockOf(shockSel.value);
  sizeField.el.hidden = shock.size === "none";
  worldField.el.hidden = !shock.world;
  sizeLabel.textContent = shock.size === "share" ? `${shock.sizeLabel} (%)` : shock.sizeLabel || "Size";
  sizeHint.textContent = SIZE_HINT[shock.key] || "";
  sizeField.input.max = shock.size === "share" ? LIMITS.shareMax : LIMITS.priceMax;
  sizeField.input.step = shock.size === "share" ? 1 : "any";
  edField.input.disabled = edFlat.checked;
  esField.input.disabled = esFlat.checked;

  const m = model();
  const r = simulate(m);
  for (const [key, f] of Object.entries(fields)) f.input.classList.toggle("invalid", !r.ok && r.field === key);
  lossLabel.textContent = shock.loss === "deadweight" ? "Deadweight loss" : "Net loss";
  quantityLabel.textContent = shock.world ? "Quantity bought at home" : "Quantity traded";

  if (!r.ok) {
    message.replaceChildren(note("bad", r.error));
    readingBox.replaceChildren();
    for (const t of Object.values(tiles)) t.set("–", "");
    plot.update({ title: "", subtitle: "", series: [], marks: [], legend: false, empty: "Nothing to draw until the input is put right" });
    curvesBox.replaceChildren(); whoBox.replaceChildren(); areaBox.replaceChildren();
    return;
  }

  const { before, after, welfare: w } = r;
  const closed = r.status === "closed";
  const quiet = r.status === "none" || r.status === "slack";
  message.replaceChildren(...(quiet ? [note("warn", reading(r)[0])] : []));
  readingBox.replaceChildren(...(quiet ? [] : reading(r).map((line) => el("p", { text: line }))));

  // Headline figures stay short: beyond a million they are written as 1.52m, 882m and so on.
  const short = (x, digits) => (Math.abs(x) >= 1e6 ? fmt.compact(x) : show(x, digits));
  // "was 10.00 (+52.0%)", or words where the two figures are equal, or print alike without being equal.
  const was = (old, now, digits, tag = "") => {
    if (now === old) return `unchanged${tag}`;
    if (short(old, digits) === short(now, digits)) return `${now > old ? "up" : "down"} very slightly`;
    const by = change(old, now);
    return `was ${short(old, digits)}${tag}${by ? ` (${by})` : ""}`;
  };
  const price = (now, old) => (now == null ? ["no trade", `was ${short(old, 2)}`] : [short(now, 2), was(old, now, 2, r.trade ? ", the world price" : "")]);
  tiles.pb.set(...price(after.pb, before.pb));
  tiles.ps.set(...price(after.ps, before.ps));
  tiles.q.set(short(after.q, 1), was(before.q, after.q, 1));
  const spent = before.pb * before.q;
  const lost = share(w.loss / spent).replace("+", "");
  tiles.loss.set(amount(w.loss), w.loss > 0 ? `${lost}${lost.endsWith("times") ? "" : " of"} what buyers spent before` : "nothing is lost");

  // The diagram.
  const c = curvePoints(r);
  const marks = [];
  if (r.trade) marks.push({ type: "hline", y: r.trade.world, text: `world price ${fmt.num(r.trade.world, 2)}` });
  if (shock.size === "price") marks.push({ type: "hline", y: m.size, text: `${shock.key} ${fmt.num(m.size, 2)}` });
  marks.push({ type: "point", x: before.q, y: before.pb, text: quiet ? "the market" : "before" });
  if (!quiet && !closed) {
    marks.push({ type: "point", x: after.q, y: after.pb, text: after.pb !== after.ps ? "after: buyers pay" : "after", color: palette[1] });
    if (after.pb !== after.ps) marks.push({ type: "point", x: after.q, y: after.ps, text: "after: sellers keep", color: palette[1] });
  }
  plot.update({
    title: "The market before and after",
    subtitle: quiet ? "Quantity runs across and price runs up. Nothing has moved." : (closed ? "Quantity runs across and price runs up. The shaded areas are the surplus lost when trade stops." : "Quantity runs across and price runs up. Each shaded area is surplus that changes hands or is lost; their sizes are in the second table.") + (c.clipped ? " One of them runs off the top of the diagram, so less of it is drawn than the table counts." : ""),
    label: `Supply and demand diagram: ${shock.label.toLowerCase()}. The same prices, quantities and areas are given in the text and tables around it.`,
    x: { label: "Quantity", domain: [0, c.xMax], format: (v) => fmt.sig(v, 4) },
    y: { label: "Price", domain: [0, c.yMax], format: (v) => fmt.sig(v, 4) },
    legend: true, empty: "",
    series: [
      ...r.regions.map((reg) => ({ name: reg.label, type: "range", data: bandPoints(reg, c.yMax), color: AREA_COLOR[reg.key], opacity: 0.5, hover: false })),
      { name: "Demand", type: "line", data: c.demand, color: 0, width: 2.5 },
      { name: c.supplyAfter ? "Supply before" : "Supply", type: "line", data: c.supply, color: 1, width: 2.5 },
      ...(c.supplyAfter ? [{ name: "Supply after", type: "line", data: c.supplyAfter, color: 1, width: 2.5, dash: true }] : []),
    ],
    marks,
  });

  const eq = equations(r);
  curvesBox.replaceChildren(
    el("strong", { text: "The curves. " }), "Demand: ", ...withPowers(eq.demand), ". Supply: ", ...withPowers(eq.supply),
    ...(eq.supplyAfter ? [". Supply after the shock: ", ...withPowers(eq.supplyAfter)] : []), ".");

  // Who gains and who loses.
  const lossName = shock.loss === "deadweight" ? "deadweight loss" : "net loss";
  const rows = [
    { who: "Buyers", change: w.consumers },
    { who: "Sellers", change: w.producers },
    { who: "Government", change: w.government },
    { who: `All three together (the ${lossName})`, change: w.total },
  ];
  whoBox.replaceChildren(table({
    caption: quiet ? "Who gains and who loses: nobody, because nothing changes" : "Who gains and who loses: change in each group's surplus",
    columns: [
      { key: "who", label: "Group" },
      { key: "change", label: "Change in surplus", num: true, format: signedAmount },
      { key: "share", label: "As a share of spending before", num: true, format: (_, row) => share(row.change / spent) },
    ],
    rows,
  }));

  const flow = (reg) => (reg.to === "nobody" ? `${groupName(reg.from)} lose it and nobody gains it` : `${groupName(reg.from)} to ${groupName(reg.to).toLowerCase()}`).replace("to government", "to the government").replace("Government lose", "The government loses");
  areaBox.replaceChildren(...(r.regions.length ? [table({
    caption: "The shaded areas",
    columns: [
      { key: "label", label: "Area", format: (v, reg) => el("span", { class: "swatch-name" }, el("i", { class: "swatch", style: { background: palette[AREA_COLOR[reg.key]] } }), v) },
      { key: "from", label: "Whose it was and whose it is now", format: (_, reg) => flow(reg) },
      { key: "area", label: "Size", num: true, format: amount },
    ],
    rows: r.regions,
  })] : []));
}

load(START);
