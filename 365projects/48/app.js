// Day 48: Monopoly Pricing Simulator. Interface.
import { $, el, fmt, mount, slider, segmented, button, stat, note, chart, debounce } from "../kit/kit.js";
import { P0, DEFAULTS, solve, price, marginalRevenue, marginalCost, variableCost, demandAreaInView } from "./logic.js";

mount();

const EXAMPLES = [
  { label: "Textbook case", demand: { kind: "linear", a: 100, b: 1 }, cost: { c: 20, d: 0, F: 0 } },
  { label: "Rising marginal cost", demand: { kind: "linear", a: 100, b: 1 }, cost: { c: 20, d: 1, F: 0 } },
  { label: "No marginal cost", demand: { kind: "linear", a: 100, b: 1 }, cost: { c: 0, d: 0, F: 0 } },
  { label: "Fixed cost too high", demand: { kind: "linear", a: 100, b: 1 }, cost: { c: 20, d: 0, F: 1650 } },
  { label: "Demand below cost", demand: { kind: "linear", a: 20, b: 1 }, cost: { c: 50, d: 0, F: 0 } },
  { label: "Elasticity 2: price is twice cost", demand: { kind: "iso", e: 2, q0: 100 }, cost: { c: 20, d: 0, F: 0 } },
  { label: "Elasticity 0.8: no best price", demand: { kind: "iso", e: 0.8, q0: 100 }, cost: { c: 20, d: 0, F: 0 } },
];
const demand = { ...DEFAULTS.demand }, cost = { ...DEFAULTS.cost };

/** A quantity or an amount of money: two decimals, more for something tiny, none for something huge. Rounding dust is zero. */
function n(x) {
  if (x == null) return "–";
  if (!Number.isFinite(x)) return "unbounded";
  if (Math.abs(x) < 1e-9) return "0.00";
  if (Math.abs(x) >= 1e6) return fmt.int(x);
  return Math.abs(x) < 0.01 ? fmt.sig(x, 2) : fmt.num(x, 2);
}
/**
 * Two figures that are set side by side. When they differ but would print alike ("20.95 against 20.95" for 20.9545 and
 * 20.9524) both are given more decimals, as many as it takes to tell them apart.
 */
function pair(x, y) {
  let a = n(x), b = n(y);
  const numbers = typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y);
  if (a !== b || !numbers || Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) return [a, b];
  for (let d = 3; d <= 9 && a === b; d++) { a = fmt.num(x, d); b = fmt.num(y, d); }
  return [a, b];
}
const n1 = (x) => fmt.num(x, 1);
/** For the chart's axes and its tooltips: four significant figures and no trailing zeros. */
const axis = (x) => (Math.abs(x) < 1e-9 ? "0" : fmt.sig(x, 4));

/* ---------- controls ---------- */
const kindSeg = segmented({
  label: "Shape of demand", value: demand.kind,
  options: [{ value: "linear", label: "Straight line" }, { value: "iso", label: "Constant elasticity" }],
  onChange: (v) => { demand.kind = v; update(); },
});
const aS = slider({ label: "Price at which nobody buys", min: 10, max: 200, step: 1, value: demand.a, format: n, onInput: (v) => { demand.a = v; update(); } });
const bS = slider({ label: "Fall in price for each extra unit sold", min: 0.1, max: 5, step: 0.1, value: demand.b, format: n1, onInput: (v) => { demand.b = v; update(); } });
const eS = slider({
  label: "Elasticity of demand", min: 0.5, max: 5, step: 0.1, value: demand.e, format: n1,
  hint: "A price rise of 1% cuts the quantity bought by this many per cent, at every price.",
  onInput: (v) => { demand.e = v; update(); },
});
const qS = slider({ label: `Quantity bought at a price of ${P0}`, min: 10, max: 1000, step: 10, value: demand.q0, format: fmt.int, onInput: (v) => { demand.q0 = v; update(); } });
const cS = slider({ label: "Marginal cost of the first unit", min: 0, max: 100, step: 1, value: cost.c, format: n, onInput: (v) => { cost.c = v; update(); } });
const dS = slider({
  label: "Rise in marginal cost with each extra unit", min: 0, max: 2, step: 0.05, value: cost.d, format: n,
  hint: "At 0 every unit costs the same to make.",
  onInput: (v) => { cost.d = v; update(); },
});
const fS = slider({
  label: "Fixed cost", min: 0, max: 5000, step: 50, value: cost.F, format: fmt.int,
  hint: "Paid once if anything is produced, and not at all if the firm shuts down.",
  onInput: (v) => { cost.F = v; update(); },
});
const demandEq = el("p", { class: "eqn" }), costEq = el("p", { class: "eqn" });

function sync() {
  kindSeg.value = demand.kind;
  aS.value = demand.a; bS.value = demand.b; eS.value = demand.e; qS.value = demand.q0;
  cS.value = cost.c; dS.value = cost.d; fS.value = cost.F;
}
function load(example) {
  Object.assign(demand, DEFAULTS.demand, example.demand);
  Object.assign(cost, example.cost);
  sync();
  update();
}
const controls = el("div", { class: "controls" },
  el("h2", { text: "Demand" }),
  kindSeg.el, aS.el, bS.el, eS.el, qS.el, demandEq,
  el("h2", { text: "Costs" }),
  cS.el, dS.el, fS.el, costEq,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row" }, EXAMPLES.map((e) => button(e.label, () => load(e), { small: true })))),
  el("div", { class: "row" }, button("Reset", () => load({ demand: DEFAULTS.demand, cost: DEFAULTS.cost }), { small: true })));

/* ---------- outputs ---------- */
const verdict = el("div", { id: "d48-result" });
const status = el("p", { class: "sr-only", role: "status" });
const tiles = { price: stat("Monopoly price"), output: stat("Monopoly output"), profit: stat("Monopoly profit"), cs: stat("Buyers' surplus"), dwl: stat("Deadweight loss"), lerner: stat("Lerner index") };
const chartBox = el("div", { id: "d48-chart" }), tableBox = el("div", { id: "d48-table" });
const out = el("div", { class: "out" }, verdict, status, el("div", { class: "stats" }, Object.values(tiles).map((t) => t.el)), chartBox, tableBox);
$("#app").append(
  el("nav", { class: "jump", "aria-label": "Parts of this tool" }, el("a", { href: "#d48-result", text: "Result" }), el("a", { href: "#d48-chart", text: "Chart" }), el("a", { href: "#d48-table", text: "Table of figures" })),
  el("div", { class: "tool-grid wide-controls" }, controls, out));
const plot = chart(chartBox, { series: [], height: 400 });
const announce = debounce((text) => { status.textContent = text; }, 500);

/* ---------- the words ---------- */
function words(r) {
  const F = cost.F;
  if (r.state === "noTrade") return ["warn", `No buyer will pay more than ${n(demand.a)}, and the first unit costs ${n(cost.c)} to make, so nothing is sold with or without a monopoly. Raise the price at which nobody buys, or lower the marginal cost.`];
  if (r.state === "unbounded") {
    const seller = demand.e > 1 ? "a monopolist would keep cutting its price, because every cut brings in more revenue"
      : demand.e === 1 ? "a monopolist would have no reason to prefer one price to another, because its revenue is the same at every price"
        : "a monopolist would keep raising its price, because every rise brings in more revenue";
    return ["warn", `With no marginal cost at all and demand that keeps growing as the price falls, neither outcome is finite. At a price equal to marginal cost, which is zero, buyers would take an unlimited quantity, and ${seller}. Give the firm a marginal cost, or use straight-line demand.`];
  }
  const b = r.benchmark;
  if (r.state === "cannotCover") {
    // Elasticity of exactly 1: buyers spend the same whatever the price, and the fixed cost is at least that much.
    const dearer = F > r.revenue, variable = cost.c > 0 || cost.d > 0;
    const bench = b
      ? `Pricing at marginal cost would sell ${n(b.Q)} units at ${n(b.P)}. Under this curve the buyers' surplus is unbounded, so the loss from producing nothing cannot be stated.`
      : "At a price equal to marginal cost, which is zero, buyers would take an unlimited quantity, so there is no benchmark and no welfare loss can be stated.";
    return ["warn", `With an elasticity of 1.0 buyers spend the same amount, ${n(r.revenue)}, whatever the price, so that is the monopolist's revenue at every output. The fixed cost is ${n(F)}, which is ${dearer ? "more" : "the same"}${variable ? ", and every unit made adds to cost" : ""}. ${dearer || variable ? "Every output loses money" : "No output makes a profit"}, so the monopoly produces nothing. ${bench}`];
  }
  if (r.state === "noMaximum") {
    const grows = demand.e === 1
      ? `so profit keeps rising towards ${n(P0 * demand.q0 - F)}${F > 0 ? `, its revenue of ${n(P0 * demand.q0)} less the fixed cost,` : ", its revenue,"} as output shrinks towards nothing, and never reaches it`
      : "so profit grows without limit as output shrinks towards nothing";
    return ["warn", `With an elasticity of ${n1(demand.e)} the monopolist has no best price. ${demand.e === 1 ? "Its revenue is the same at every price" : "Every price rise brings in more revenue"}, and selling less costs less, ${grows}. The mark-up rule, price = marginal cost × e ÷ (e − 1), needs an elasticity above 1. No real demand stays this inelastic at every price, so it is the curve that fails here. Pricing at marginal cost would sell ${n(b.Q)} units at ${n(b.P)}. Under this curve the buyers' surplus is unbounded, so no welfare loss can be stated.`];
  }
  const m = r.monopoly, p = r.planned;
  if (r.state === "shutdown") {
    const tail = !r.worthProducing
      ? `Even at a price equal to marginal cost the surplus created, ${n(b.total + F)}, would be less than the fixed cost, so producing nothing is also the efficient outcome and no surplus is lost.`
      : r.dwl < 1e-9
        ? "At a price equal to marginal cost the surplus created would exactly equal the fixed cost, so nothing is lost by the shutdown."
        : `Pricing at marginal cost would sell ${n(b.Q)} units at ${n(b.P)} and create a surplus of ${n(b.total + F)} before the fixed cost, the area shaded in the chart, and ${n(b.total)} after it. All of that ${n(b.total)} is lost.`;
    return ["warn", `The monopoly shuts down. Its best option is to sell ${n(p.Q)} units at ${n(p.P)}, which earns ${n(p.operatingProfit)} before the fixed cost of ${n(F)}: a loss of ${n(-p.profit)}. Producing nothing loses nothing. ${tail}`];
  }
  const share = Number.isFinite(b.total) && b.total > 1e-9 ? ` That is ${fmt.pct(r.dwl / b.total, 1)} of the total surplus at the benchmark.` : "";
  const [mQ, bQ] = pair(m.Q, b.Q), [mP, bP] = pair(m.P, b.P), [mCS, bCS] = pair(m.cs, b.cs);
  const parts = [
    `The monopolist sells ${mQ} units at a price of ${mP}. Pricing at marginal cost would sell ${bQ} at ${bP}.`,
    `The monopoly earns ${n(m.profit)}${F > 0 ? ` after its fixed cost of ${n(F)}` : ""}. Buyers keep a surplus of ${mCS} where they would have had ${bCS}, and ${n(r.dwl)} of surplus is lost to everyone.${share}`,
  ];
  if (r.breaksEven) parts.push("The operating profit exactly equals the fixed cost, so the monopoly breaks even and stays open.");
  if (b.profit < -1e-9) parts.push(`A firm that priced at marginal cost would lose ${n(-b.profit)}, because that price ${cost.d > 0 ? "does not leave enough" : "leaves nothing"} to pay the fixed cost.`);
  return ["", parts.join(" ")];
}

/* ---------- drawing ---------- */
function draw(r) {
  const iso = demand.kind === "iso";
  const b = r.benchmark, p = r.planned;
  const bQ = b && b.Q > 0 ? b.Q : 0, pQ = p && p.Q > 0 ? p.Q : 0;
  const qMax = bQ ? (iso ? 1.3 * bQ : Math.min(demand.a / demand.b, 1.3 * bQ)) : iso ? 3 * demand.q0 : demand.a / demand.b;
  const yTop = iso ? (pQ ? 2.2 * p.P : bQ ? 3 * b.P : 3 * P0) : 1.05 * Math.max(demand.a, marginalCost(cost, qMax));
  // Sample the curves on an even grid, plus the two outputs themselves so that the marks sit on the lines.
  const grid = [...new Set([...Array.from({ length: 121 }, (_, i) => (qMax * i) / 120), pQ, bQ])].filter((q) => q <= qMax).sort((x, y) => x - y);
  if (iso) grid[0] = qMax / 6000;                       // the curve has no height at zero
  const P = (q) => price(demand, q), MC = (q) => marginalCost(cost, q);
  const showMR = !iso || demand.e > 1;
  const mrZero = iso ? Infinity : demand.a / (2 * demand.b);
  const mr = showMR ? [...grid.filter((q) => q < mrZero).map((q) => [q, marginalRevenue(demand, q)]), ...(mrZero <= qMax ? [[mrZero, 0]] : [])] : [];
  const band = (from, to, low, high) => grid.filter((q) => q >= from && q <= to).map((q) => [q, low(q), high(q)]);
  const operating = r.state === "ok";
  const areas = [];
  if (operating) {
    areas.push({ name: "Buyers' surplus under monopoly", type: "range", color: 2, opacity: 0.32, hover: false, data: band(0, pQ, () => p.P, P) });
    areas.push({ name: "Monopoly profit before fixed cost", type: "range", color: 3, opacity: 0.4, hover: false, data: band(0, pQ, MC, () => p.P) });
    areas.push({ name: "Deadweight loss", type: "range", color: 7, opacity: 0.38, hover: false, data: band(pQ, bQ, MC, P) });
  } else if (r.state === "shutdown" && r.worthProducing && r.dwl > 1e-9) {
    areas.push({ name: "Surplus lost by the shutdown, before fixed cost", type: "range", color: 7, opacity: 0.38, hover: false, data: band(0, bQ, MC, P) });
  }
  const marks = [];
  // The benchmark's label hangs from a dashed line at the top of the chart, where there is always room. Beside the point
  // it lay along the marginal-cost line whenever that line was flat.
  if (bQ) marks.push({ type: "vline", x: b.Q, text: "Price = marginal cost" }, { type: "point", x: b.Q, y: b.P });
  if (pQ) marks.push({ type: "point", x: p.Q, y: p.P, text: operating ? "Monopoly" : "Monopoly's best, not produced" });
  // Every shaded area is a figure printed on the page. A constant-elasticity curve climbs off the top of the chart, so
  // the part of an area that is in view is given too.
  let subtitle = "The curves as set. The message above says why there is no monopoly outcome to shade.";
  if (operating) {
    subtitle = "The monopolist stops where marginal revenue meets marginal cost and charges what demand will bear. The shaded areas are figures in the table: buyers' surplus, profit before the fixed cost and the deadweight loss.";
    if (iso) subtitle += ` Buyers' surplus runs on above the top of the chart: ${n(demandAreaInView(demand, pQ, yTop) - p.P * pQ)} of its ${n(p.cs)} is in view.`;
  } else if (areas.length) {
    subtitle = `The monopoly produces nothing. The shaded area is the surplus that pricing at marginal cost would create before the fixed cost, ${n(b.total + cost.F)}.`;
    if (iso) subtitle += ` It runs on above the top of the chart: ${n(demandAreaInView(demand, bQ, yTop) - variableCost(cost, bQ))} of it is in view.`;
  }
  plot.update({
    title: "Demand, marginal revenue and marginal cost",
    subtitle,
    label: "Chart of price against quantity with the demand, marginal revenue and marginal cost curves and the areas of surplus",
    x: { label: "Quantity", domain: [0, qMax], format: axis },
    y: { label: "Price and cost per unit", domain: [0, yTop], format: axis },
    legend: true,
    series: [
      ...areas,
      { name: "Demand", type: "line", color: 0, width: 2.5, data: grid.map((q) => [q, P(q)]) },
      ...(showMR ? [{ name: "Marginal revenue", type: "line", color: "#8a94a3", dash: true, data: mr }] : []),
      { name: "Marginal cost", type: "line", color: 1, width: 2.5, data: grid.map((q) => [q, MC(q)]) },
    ],
    marks,
  });
}

function table(r) {
  const m = r.monopoly, b = r.benchmark;
  const none = r.state === "noMaximum" ? "no best price" : "not finite";
  // Each row gives a number, or words where there is no number. Two numbers in one row go through pair(), so that a
  // monopoly figure and a benchmark figure that differ never print alike.
  const rows = [
    ["Price", (o) => (o.Q > 0 ? o.P : "nothing sold")],
    ["Output", (o) => o.Q],
    ["Marginal cost at that output", (o) => (o.Q > 0 ? o.mc : "–")],
    ["Revenue", (o) => o.revenue],
    ["Variable cost", (o) => o.variableCost],
    ["Profit before the fixed cost", (o) => o.operatingProfit],
    ["Fixed cost", (o) => (o.Q > 0 ? o.fixedCost : "0.00, not paid")],
    ["Profit", (o) => o.profit],
    ["Buyers' surplus", (o) => o.cs],
    ["Total surplus (buyers' surplus + profit)", (o) => o.total],
  ];
  const cells = (f) => {
    const vm = m ? f(m) : none, vb = b ? f(b) : none;
    return typeof vm === "number" && typeof vb === "number" ? pair(vm, vb) : [vm, vb].map((v) => (typeof v === "number" ? n(v) : v));
  };
  const lerner = r.state === "ok" ? n(r.lerner) : r.state === "shutdown" ? `${n(r.lerner)} at its best output` : "–";
  const elasticity = r.state === "ok" || r.state === "shutdown" ? n(r.elasticity) : "–";
  tableBox.replaceChildren(el("table", { class: "tbl res" },
    el("caption", { text: "The two outcomes in figures" }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Measure" }), el("th", { scope: "col", class: "num", text: "Monopoly" }), el("th", { scope: "col", class: "num", text: "Price = marginal cost" }))),
    el("tbody", {},
      rows.map(([label, f]) => el("tr", {}, el("th", { scope: "row", text: label }), cells(f).map((text) => el("td", { class: "num", text })))),
      el("tr", {}, el("th", { scope: "row", text: "Lerner index: (price − marginal cost) ÷ price" }), el("td", { class: "num", text: lerner }), el("td", { class: "num", text: b && b.Q > 0 ? "0.00" : "–" })),
      el("tr", {}, el("th", { scope: "row", text: "Elasticity of demand at the monopoly's price" }), el("td", { class: "num", text: elasticity }), el("td", { class: "num", text: "–" })),
      el("tr", {}, el("th", { scope: "row", text: "Deadweight loss" }), el("td", { class: "num", colspan: "2", text: r.dwl == null ? "cannot be stated" : n(r.dwl) })))));
}

function update() {
  const linear = demand.kind === "linear";
  aS.el.hidden = bS.el.hidden = !linear;
  eS.el.hidden = qS.el.hidden = linear;
  demandEq.textContent = linear ? `Price = ${n(demand.a)} − ${n1(demand.b)} × quantity` : `Quantity = ${fmt.int(demand.q0)} × (price ÷ ${P0}) to the power −${n1(demand.e)}`;
  costEq.textContent = `Marginal cost = ${n(cost.c)}${cost.d > 0 ? ` + ${n(cost.d)} × quantity` : ""}${cost.F > 0 ? `, plus ${fmt.int(cost.F)} once` : ""}`;
  const r = solve(demand, cost);
  if (r.error) { verdict.replaceChildren(note("bad", r.error)); return; }
  const [kind, text] = words(r);
  verdict.replaceChildren(note(kind, text));
  announce(text);

  const m = r.monopoly, b = r.benchmark, on = r.state === "ok";
  const versus = (v) => (b && b.Q > 0 ? `against ${v} at marginal cost` : "");
  const [mP, bP] = on ? pair(m.P, b.P) : ["–", ""];
  const [mQ, bQ] = m && b ? pair(m.Q, b.Q) : [m ? n(m.Q) : "–", ""];
  const [mCS, bCS] = m && b ? pair(m.cs, b.cs) : [m ? n(m.cs) : "–", ""];
  tiles.price.set(mP, on ? versus(bP) : r.state === "shutdown" ? "the monopoly shuts down" : r.state === "cannotCover" ? "the monopoly produces nothing" : r.state === "noTrade" ? "nothing is sold" : "no monopoly outcome");
  tiles.output.set(mQ, m && b ? (b.Q > 0 ? `against ${bQ} at marginal cost` : "nothing is sold either way") : "");
  tiles.profit.set(m ? n(m.profit) : "–", on ? (cost.F > 0 ? `after the fixed cost of ${n(cost.F)}` : "there is no fixed cost") : m ? "nothing is produced" : "");
  tiles.cs.set(mCS, m && b && b.Q > 0 ? `against ${bCS} at marginal cost` : "");
  tiles.dwl.set(r.dwl == null ? "–" : n(r.dwl), r.dwl == null ? "cannot be stated" : on && Number.isFinite(b.total) && b.total > 1e-9 ? `${fmt.pct(r.dwl / b.total, 1)} of the surplus at marginal cost` : "surplus lost to everyone");
  tiles.lerner.set(on ? n(r.lerner) : "–", on ? `mark-up as a share of price; elasticity ${n(r.elasticity)}` : "");
  draw(r);
  table(r);
}

update();
