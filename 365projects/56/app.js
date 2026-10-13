// Day 56: Price Discrimination Lab. Interface.
import { $, el, fmt, mount, numberField, textField, button, note, chart, debounce } from "../kit/kit.js";
import { LIMITS, EXAMPLES, check, profitAt, compare, n2, price, verdict, groupWords, menuWords } from "./logic.js";

mount();

const SCHEMES = [
  { key: "one", title: "One price for everyone", short: "One", axis: "One price" },
  { key: "group", title: "A price for each group", short: "Group", axis: "Price per group" },
  { key: "menu", title: "A menu of bundles", short: "Menu", axis: "Menu of bundles" },
  { key: "each", title: "A price for each buyer", short: "Buyer", axis: "Price per buyer" },
];
const clone = (example) => ({ cost: example.cost, groups: example.groups.map((g) => ({ ...g })) });
let state = clone(EXAMPLES[0]);

/* ---------- controls ---------- */
const costField = numberField({
  label: "Cost of making one unit", min: LIMITS.cost[0], max: LIMITS.cost[1], value: state.cost,
  hint: "The same for every unit. There is no fixed cost.",
});
costField.input.addEventListener("input", () => { state.cost = costField.input.value.trim() === "" ? NaN : Number(costField.input.value); update(); });

const groupsBox = el("div", { class: "d56-groups" });
const addButton = button("Add a group", () => {
  if (state.groups.length >= LIMITS.groups[1]) return;
  // A name that cannot be mistaken for the numbered slots ("Group 3"), which renumber when a group is removed.
  const taken = (name) => state.groups.some((g) => g.name.trim().toLowerCase() === name.toLowerCase());
  let k = 1, name = "New group";
  while (taken(name)) name = `New group ${++k}`;
  state.groups.push({ name, buyers: 100, top: 8 });
  buildGroups();
  update();
  $(`#d56-g${state.groups.length - 1} input[type="text"]`)?.focus();
}, { small: true });
const addHint = el("div", { class: "hint" });

/** The editor for the groups. Rebuilt only when a group is added or removed or an example is loaded, never while typing. */
function buildGroups() {
  groupsBox.replaceChildren(...state.groups.map((g, i) => {
    const num = i + 1;
    const name = textField({ label: `Name of group ${num}`, value: g.name });
    name.input.maxLength = LIMITS.name;
    name.input.addEventListener("input", () => { g.name = name.input.value; update(); });
    const read = (input) => (input.value.trim() === "" ? NaN : Number(input.value));
    const buyers = numberField({ label: `Buyers in group ${num}`, min: LIMITS.buyers[0], max: LIMITS.buyers[1], step: 1, value: g.buyers });
    buyers.input.addEventListener("input", () => { g.buyers = read(buyers.input); update(); });
    const top = numberField({ label: `Highest price a buyer in group ${num} would pay`, min: LIMITS.top[0], max: LIMITS.top[1], value: g.top });
    top.input.addEventListener("input", () => { g.top = read(top.input); update(); });
    const remove = state.groups.length > LIMITS.groups[0]
      ? button(`Remove group ${num}`, () => {
        state.groups.splice(i, 1);
        buildGroups();
        update();
        // The button that was pressed is gone: go to the one that took its place, or to "Add a group".
        ($(`#d56-g${Math.min(i, state.groups.length - 1)} button`) || addButton).focus();
      }, { small: true })
      : null;
    return el("fieldset", { class: "d56-group", id: `d56-g${i}` }, el("legend", { text: `Group ${num}` }), name.el, el("div", { class: "d56-pair" }, buyers.el, top.el), remove);
  }));
  const full = state.groups.length >= LIMITS.groups[1];
  addButton.disabled = full;
  addHint.textContent = full ? `The lab compares at most ${LIMITS.groups[1]} groups.` : "Each buyer in a group buys one unit fewer for every 1 the price rises, down to nothing at the group's highest price.";
}

function load(example) {
  state = clone(example);
  costField.value = state.cost;
  buildGroups();
  update();
}

const controls = el("div", { class: "controls" },
  el("h2", { text: "The seller" }), costField.el,
  el("h2", { text: "The buyers" }), groupsBox, el("div", { class: "field" }, el("div", { class: "row" }, addButton), addHint),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row" }, EXAMPLES.map((e) => button(e.label, () => load(e), { small: true }))),
    el("div", { class: "hint", text: "The groups and their numbers are made up to show each case. They are not figures from a real market." })),
  el("div", { class: "row" }, button("Reset", () => load(EXAMPLES[0]), { small: true })));

/* ---------- outputs ---------- */
const message = el("div", { id: "d56-result" });
const status = el("p", { class: "sr-only", role: "status" });
const groupList = el("ul", { class: "d56-list" });
const cards = el("div", { class: "d56-cards", id: "d56-schemes" });
const barsBox = el("div", { id: "d56-compare" }), curveBox = el("div", { id: "d56-curve" });
const results = el("div", { class: "out" }, groupList, cards, barsBox, curveBox);
$("#app").append(
  el("nav", { class: "jump", "aria-label": "Parts of this tool" }, el("a", { href: "#d56-result", text: "Result" }), el("a", { href: "#d56-schemes", text: "The four schemes" }), el("a", { href: "#d56-compare", text: "Charts" })),
  el("div", { class: "tool-grid wide-controls" }, controls, el("div", { class: "out" }, message, status, results)));

const narrow = () => window.innerWidth < 700;
const barChart = chart(barsBox, { series: [], height: 300 });
const curveChart = chart(curveBox, { series: [], height: 300 });
const announce = debounce((text) => { status.textContent = text; }, 700);
const axis = (v) => (Math.abs(v) < 1e-9 ? "0" : fmt.sig(v, 4));
/** A label short enough to sit beside a line on a narrow chart. */
const clip = (text) => (text.length > 16 ? `${text.slice(0, 15)}…` : text);

/* ---------- drawing ---------- */
function card(scheme, groups, cost, r) {
  const s = r.schemes[scheme.key];
  const name = (i) => groups[i].name.trim();
  let how;
  if (!r.anyTrade) how = "Nothing is sold.";
  else if (scheme.key === "one") how = `The price that earns the seller most is ${price(s.price)} a unit.`;
  else if (scheme.key === "group") how = `The seller knows each buyer's group and stops them reselling. Prices: ${groups.map((g, i) => `${name(i)} ${s.unit[i] == null ? "none" : price(s.unit[i])}`).join(", ")}.`;
  else if (scheme.key === "menu") how = "The seller cannot tell the groups apart. It offers a menu of quantity tiers: bundles, each a fixed quantity for a fixed payment. Every buyer takes the one they like best, or none.";
  else how = `The seller knows what every unit is worth to every buyer and charges exactly that, down to the cost of ${n2(cost)}. Buyers keep nothing, and every unit worth more than it costs is sold.`;
  const rows = groups.map((g, i) => el("tr", {},
    el("th", { scope: "row", text: name(i) }),
    el("td", { class: "num", "data-label": "Units each", text: s.q[i] > 0 ? n2(s.q[i]) : "none" }),
    el("td", { class: "num", "data-label": "Pays each", text: s.q[i] > 0 ? n2(s.pay[i]) : "–" }),
    el("td", { class: "num", "data-label": "Group's surplus", text: n2(s.cs[i]) })));
  const totals = [["Seller's profit", s.profit], ["Buyers' surplus", s.csTotal], ["Total welfare", s.welfare], ["Units sold", s.output]];
  return el("div", { class: "panel d56-card" },
    el("h3", { text: scheme.title }),
    el("p", { class: "small", text: how }),
    scheme.key === "menu" && r.anyTrade ? el("p", { class: "small", text: menuWords(groups, cost, r) }) : null,
    el("table", { class: "tbl d56-tbl" },
      el("caption", { class: "sr-only", text: `${scheme.title}: each group` }),
      el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Group" }), el("th", { scope: "col", class: "num", text: "Units each" }), el("th", { scope: "col", class: "num", text: "Pays each" }), el("th", { scope: "col", class: "num", text: "Group's surplus" }))),
      el("tbody", {}, rows)),
    el("dl", { class: "d56-tot" }, totals.map(([label, value]) => [el("dt", { text: label }), el("dd", { text: n2(value) })])));
}

function draw(groups, cost, r) {
  const s = r.schemes;
  barChart.update({
    title: "The four schemes compared",
    subtitle: "Total welfare is the seller's profit plus the buyers' surplus.",
    label: "Bar chart of the seller's profit, the buyers' surplus and total welfare under each of the four pricing schemes",
    x: { type: "band", categories: SCHEMES.map((x) => x.axis), format: (c) => (narrow() ? SCHEMES.find((x) => x.axis === c).short : c) },
    y: { label: "Money", format: axis, zero: true },
    series: [
      { name: "Seller's profit", type: "bars", color: 0, data: SCHEMES.map((x) => [x.axis, s[x.key].profit]) },
      { name: "Buyers' surplus", type: "bars", color: 1, data: SCHEMES.map((x) => [x.axis, s[x.key].csTotal]) },
      { name: "Total welfare", type: "bars", color: "#8a94a3", data: SCHEMES.map((x) => [x.axis, s[x.key].welfare]) },
    ],
  });

  const hi = Math.max(...groups.map((g) => g.top));
  if (!r.anyTrade) {
    curveChart.update({ title: "Profit from a single price", subtitle: "", series: [], marks: [], x: { label: "Price charged to everyone" }, y: { label: "Seller's profit" }, empty: "Nothing can be sold above cost" });
    return;
  }
  const tops = [...new Set(groups.filter((g) => g.top > cost).map((g) => g.top))];
  const xs = [...new Set([...Array.from({ length: 161 }, (_, i) => cost + ((hi - cost) * i) / 160), ...tops, ...s.one.rivals.map((x) => x.price)])].sort((a, b) => a - b);
  const marks = tops.filter((t) => t < hi).map((t) => ({ type: "vline", x: t, text: clip(groups.filter((g) => g.top === t).map((g) => g.name.trim()).join(", ")) }));
  const best = s.one.tie || [s.one.price];
  best.forEach((p) => marks.push({ type: "point", x: p, y: profitAt(groups, cost, p), text: `${price(p)} earns ${n2(profitAt(groups, cost, p))}` }));
  curveChart.update({
    title: "Profit from a single price",
    subtitle: s.one.tie
      ? "Each dashed line marks a group's highest price, where that group stops buying and the curve has a kink. Two prices tie for the highest profit here, one on each side of a kink: the higher one is too high for the group or groups that stop buying in between. The lower one is the price compared above."
      : r.shutOut.length
      ? "Each dashed line marks a group's highest price, where that group stops buying and the curve has a kink. The best price is to the right of a kink, so it is too high for the group or groups that stop there."
      : tops.length > 1
        ? "Each dashed line marks a group's highest price, where that group stops buying and the curve has a kink. The best price is to the left of every kink, so every group buys."
        : "Every group that buys has the same highest price, so the curve is a single arch with no kink.",
    label: "Line chart of the seller's profit against a single price charged to everyone",
    x: { label: "Price charged to everyone", domain: [cost, hi], format: axis },
    y: { label: "Seller's profit", format: axis, zero: true },
    series: [{ name: "Seller's profit", type: "line", color: 0, width: 2.5, data: xs.map((p) => [p, profitAt(groups, cost, p)]) }],
    marks, empty: null,
  });
}

function update() {
  const groups = state.groups, cost = state.cost;
  const problem = check(groups, cost);
  if (problem) {
    message.replaceChildren(note("bad", problem));
    results.hidden = true;
    return;
  }
  results.hidden = false;
  const r = compare(groups, cost);
  const v = verdict(groups, cost, r);
  message.replaceChildren(note(v.kind, v.text));
  announce(v.text);
  groupList.replaceChildren(...(r.anyTrade ? groupWords(groups, r).map((text) => el("li", { text })) : []));
  groupList.hidden = !r.anyTrade;
  cards.replaceChildren(...SCHEMES.map((scheme) => card(scheme, groups, cost, r)));
  draw(groups, cost, r);
}

buildGroups();
update();
// The bar chart's labels are shorter on a narrow screen.
window.addEventListener("resize", debounce(() => { if (!results.hidden) update(); }, 200));
