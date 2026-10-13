// Day 49: Market Structure Lab. Interface.
import { $, el, fmt, mount, slider, select, numberField, checkbox, segmented, button, stat, note, chart, palette } from "../kit/kit.js";
import { STRUCTURES, structureOf, solve, solveAll, deviation, entryPath, choiceOf } from "./logic.js";

mount();

const MAX_SAME = 20, MAX_OWN = 8, COST_MAX = 1000;
const START = { key: "cournot", n: 2, cost: 20, own: false, costs: [20, 20], a: 100, b: 1, theta: 0.6, view: "price", firm: 0 };
const state = { ...START, costs: [...START.costs] };
const GREY = "#8a94a3", INK = "#16233b";
const LINE = { monopoly: GREY, stackelberg: 1, cournot: 0, bertrandDiff: 2, bertrand: 3, competition: INK };
const money = (x) => fmt.num(x, 2);
const units = (x) => fmt.num(x, 2);
const firmsWord = (k) => (k === 1 ? "1 firm" : `${k} firms`);
// A loss under 1% keeps a second decimal, so that 0.83% does not print as 0.8%.
const lossPct = (x) => (x == null ? "–" : fmt.pct(x, x > 0 && x < 0.01 ? 2 : 1));
const list = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const firmList = (idx) => (idx.length === 1 ? `Firm ${idx[0] + 1}` : `Firms ${list(idx.map((i) => String(i + 1)))}`);

/** The market as the model wants it: one cost per firm. */
const market = () => ({ a: state.a, b: state.b, theta: state.theta, costs: state.own ? state.costs.slice(0, state.n) : Array(state.n).fill(state.cost) });

/* ---------- controls ---------- */
const kindSel = select({
  label: "Kind of competition", value: state.key,
  options: STRUCTURES.map((s) => ({ value: s.key, label: s.label })),
  onChange: (v) => { state.key = v; update(); },
});
const nSlider = slider({
  label: "Number of firms", min: 1, max: MAX_SAME, step: 1, value: state.n, format: (v) => String(v),
  onInput: (v) => { state.n = v; while (state.costs.length < v) state.costs.push(state.costs.at(-1) ?? state.cost); drawCostFields(); update(); },
});
const costSlider = slider({
  label: "Cost of making one unit (every firm)", min: 0, max: 150, step: 1, value: state.cost, format: (v) => money(v),
  onInput: (v) => { state.cost = v; update(); },
});
const ownBox = checkbox({
  label: "Give each firm its own cost", checked: state.own,
  onChange: (on) => {
    state.own = on;
    if (on) { state.n = Math.min(state.n, MAX_OWN); state.costs = Array.from({ length: MAX_OWN }, (_, i) => state.costs[i] ?? state.cost); }
    syncControls(); update();
  },
});
const costBox = el("div", { class: "costs" });
const costNote = el("div");
const aSlider = slider({
  label: "Highest price any buyer will pay (a)", min: 20, max: 200, step: 1, value: state.a, format: (v) => money(v),
  onInput: (v) => { state.a = v; update(); },
});
const bSlider = slider({
  label: "Price falls by this for each extra unit sold (b)", min: 0.1, max: 5, step: 0.1, value: state.b, format: (v) => fmt.num(v, 1),
  onInput: (v) => { state.b = v; update(); },
});
const thetaSlider = slider({
  label: "How alike the goods are (θ)", min: 0, max: 0.95, step: 0.05, value: state.theta, format: (v) => fmt.num(v, 2),
  hint: "Used only by Bertrand with differentiated goods. 0: unrelated goods, each firm a monopolist. Close to 1: nearly identical.",
  onInput: (v) => { state.theta = v; update(); },
});

let costFields = [];
function drawCostFields() {
  costFields = [];
  if (!state.own) { costBox.replaceChildren(); costNote.replaceChildren(); return; }
  for (let i = 0; i < state.n; i++) {
    const f = numberField({ label: `Firm ${i + 1}${i === 0 ? " (the Stackelberg leader)" : ""}`, min: 0, max: COST_MAX, step: 1, value: state.costs[i] });
    f.input.addEventListener("input", readCosts);
    costFields.push(f);
  }
  costBox.replaceChildren(...costFields.map((f) => f.el));
  costNote.replaceChildren();
}
function readCosts() {
  const bad = costFields.findIndex((f) => Number.isNaN(f.value));
  costFields.forEach((f) => f.input.classList.toggle("invalid", Number.isNaN(f.value)));
  if (bad >= 0) {
    costNote.replaceChildren(note("bad", `Firm ${bad + 1}'s cost must be a number from 0 to ${fmt.int(COST_MAX)}. The results below still use the last costs that were valid.`));
    return;
  }
  costNote.replaceChildren();
  costFields.forEach((f, i) => { state.costs[i] = f.value; });
  update();
}

function syncControls() {
  kindSel.value = state.key;
  nSlider.input.max = state.own ? MAX_OWN : MAX_SAME;
  nSlider.value = state.n;
  costSlider.value = state.cost;
  costSlider.el.hidden = state.own;
  ownBox.checked = state.own;
  aSlider.value = state.a; bSlider.value = state.b; thetaSlider.value = state.theta;
  viewSeg.value = state.view;          // an example or Reset puts the chart back on price: the switch must say so too
  drawCostFields();
}

const EXAMPLES = [
  { label: "Two equal firms", set: { key: "cournot", n: 2, cost: 20, own: false } },
  { label: "Ten equal firms", set: { key: "cournot", n: 10, cost: 20, own: false } },
  { label: "A cost advantage", set: { key: "bertrand", n: 2, own: true, costs: [10, 40] } },
  { label: "A firm priced out", set: { key: "cournot", n: 3, own: true, costs: [10, 30, 70] } },
  { label: "A leader keeps a rival out", set: { key: "stackelberg", n: 2, own: true, costs: [20, 50] } },
  { label: "Limit pricing", set: { key: "bertrandDiff", n: 2, own: true, costs: [20, 78], theta: 0.5 } },
];
function apply(set) {
  Object.assign(state, { ...START, costs: [...START.costs] }, set, { costs: [...(set.costs || START.costs)] });
  if (state.own) state.costs = Array.from({ length: MAX_OWN }, (_, i) => state.costs[i] ?? state.costs.at(-1));
  syncControls(); update();
}

const controls = el("div", { class: "controls" },
  kindSel.el, nSlider.el, costSlider.el, ownBox.el, costBox, costNote, aSlider.el, bSlider.el, thetaSlider.el,
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row" }, EXAMPLES.map((x) => button(x.label, () => apply(x.set), { small: true })), button("Reset", () => apply({}), { small: true }))));

// Links to the parts of a long tool: on a phone the results start below the controls.
const jump = (pairs) => el("nav", { class: "jump", "aria-label": "Parts of the tool" }, el("span", { text: "Jump to" }), pairs.map(([id, text]) => el("a", { href: `#${id}`, text })));

/* ---------- outputs ---------- */
const marketLine = el("p", { class: "small market-line" });
const sPrice = stat("Price buyers pay"), sQ = stat("Total output"), sProfit = stat("Total profit"), sLoss = stat("Deadweight loss");
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div", { class: "stack" });
const firmBox = el("div");
const compareBars = el("div", { class: "split-rows" });
const compareBox = el("div", { class: "rt-box" });     // a container: its table turns into a list when the column is narrow
const viewSeg = segmented({
  label: "Show", value: state.view,
  options: [{ value: "price", label: "Price" }, { value: "loss", label: "Deadweight loss" }],
  onChange: (v) => { state.view = v; update(); },
});
const pathBox = el("div"), pathNote = el("div");
const firmSel = select({ label: "Firm to test", options: [{ value: 0, label: "Firm 1" }], value: 0, onChange: (v) => { state.firm = Number(v); update(); } });
const checkBox = el("div"), checkText = el("div");

const out = el("div", { class: "out" },
  marketLine,
  el("div", { class: "stats", id: "t-results" }, sPrice.el, sQ.el, sProfit.el, sLoss.el), status, message, firmBox,
  el("h2", { id: "t-compare", text: "The same market under each kind of competition" }),
  el("p", { class: "small muted", text: "Each bar is the surplus a competitive market would create, split into what buyers keep, what firms keep and what is lost. Differentiated goods are measured against their own benchmark: every variety sold at its cost." }),
  compareBars, compareBox,
  el("h2", { id: "t-path", text: "As firms are added" }), viewSeg.el, pathBox, pathNote,
  el("h2", { id: "t-check", text: "Is it an equilibrium? One firm's profit against its own choice" }), firmSel.el, checkBox, checkText);

$("#app").append(jump([["t-results", "Results"], ["t-compare", "All six compared"], ["t-path", "As firms are added"], ["t-check", "Equilibrium check"]]), el("div", { class: "tool-grid" }, controls, out));
const pathChart = chart(pathBox, { series: [], height: 330 });
const checkChart = chart(checkBox, { series: [], height: 280 });

// A table that turns into a list of labelled lines on a narrow screen (see the page's <style>).
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl rt", role: "table" },
    el("caption", { text: caption }),
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c) => el("th", { role: "columnheader", scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row", class: r.on ? "on" : null },
      columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/* ---------- what happened, in words ---------- */
function explain(o, m) {
  const idle = o.active.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
  const parts = [];
  const low = Math.min(...m.costs), cheapest = m.costs.indexOf(low);
  const makeNothing = (idx, why) => `${firmList(idx)} ${idx.length === 1 ? "makes" : "make"} nothing: ${why}`;
  if (o.key === "monopoly") {
    const tied = m.costs.filter((c) => c === low).length;       // plants that share the lowest cost
    const owner = `One owner runs ${m.costs.length === 2 ? "both" : `all ${m.costs.length}`} firms as plants.`;
    parts.push(m.costs.length === 1 ? "The one firm sets output where marginal revenue equals its cost."
      : tied > 1 ? `${owner} ${tied === m.costs.length ? (tied === 2 ? "Both plants make" : "Every plant makes") : `${tied} of the plants make`} a unit for ${money(low)}, the lowest cost, so it makes no difference how the output is split between them. The tool puts all of it in firm ${cheapest + 1}.`
        : `${owner} A plant's cost per unit does not rise with its output, so the owner uses only the cheapest (firm ${cheapest + 1}, at ${money(low)} a unit).`);
  } else if (o.key === "cournot") {
    parts.push(`Each firm chooses how much to make, taking the others' outputs as given. Price settles at ${money(o.price)}.`);
    if (idle.length) parts.push(makeNothing(idle, `${idle.length === 1 ? "its cost is" : "their costs are"} not below that price.`));
  } else if (o.key === "stackelberg") {
    if (m.costs.length === 1) parts.push("With no followers the leader is a monopolist.");
    else if (!o.active[0]) parts.push(`Firm 1 leads but makes nothing: its cost of ${money(m.costs[0])} is not below the price the followers reach on their own.`);
    else if (o.limit) parts.push(`Firm 1 commits to ${units(o.q[0])} units before the others choose: exactly enough to make it not worth ${idle.length === 1 ? `firm ${idle[0] + 1}'s` : "a higher-cost follower's"} while to produce. Making less would let that firm in; making more would only lower the price.`);
    else parts.push(`Firm 1 commits to ${units(o.q[0])} units before the others choose, and the followers then play Cournot for what is left of the market.`);
    const idleFollowers = idle.filter((i) => i > 0);
    if (idleFollowers.length && o.active[0]) parts.push(makeNothing(idleFollowers, "at the price that results, a unit would sell for no more than it costs to make."));
  } else if (o.key === "bertrand") {
    const second = [...m.costs].sort((x, y) => x - y)[1];
    if (o.regime === "alone") parts.push("With no rival to undercut it, the one firm charges the monopoly price.");
    else if (o.regime === "cost") parts.push(`${m.costs.filter((c) => c === low).length === m.costs.length ? "Every firm has" : "Two or more firms share"} the lowest cost, ${money(low)}. Any price above it would be undercut, so the price is the cost and nobody earns a profit.`);
    else if (o.regime === "rival") parts.push(`Firm ${o.seller + 1} has the lowest cost and serves the whole market at ${money(second)}, the cost of its closest rival. Any higher and that rival would undercut it. A tie in price is taken to go to the firm with the lower cost. This is one equilibrium of a range: any lower price down to firm ${o.seller + 1}'s own cost of ${money(low)} is one too, but only if a rival posts a price below its own cost. The tool shows the one in which no firm does.`);
    else parts.push(`Firm ${o.seller + 1}'s cost is so far below the others' that its monopoly price, ${money(o.price)}, is already under every rival's cost. It charges that and the rivals cannot respond.`);
  } else if (o.key === "bertrandDiff") {
    parts.push(m.theta === 0 ? "With unrelated goods (θ = 0) each firm is a monopolist in its own market." : "Each firm sets the price of its own variety, taking the others' prices as given.");
    if (o.regime === "limit") {
      const sellers = o.active.filter(Boolean).length;
      parts.push(`Firm ${o.edge + 1} is held exactly at the edge of the market: at a price equal to its cost of ${money(m.costs[o.edge])} it sells nothing, and it would find buyers if ${sellers === 1 ? "the seller" : "the sellers"} charged any more. This is limit pricing.${sellers > 1 ? " A range of prices are equilibria in this position; the tool shows the one that moves every seller the same share of the way between the lowest and highest price it could hold." : ""}`);
    }
    const out = idle.filter((i) => i !== o.edge);
    if (out.length) parts.push(makeNothing(out, `even at a price equal to ${out.length === 1 ? "its" : "their"} cost, buyers prefer the other varieties at their prices.`));
  } else {
    parts.push(`Many price-taking sellers with access to the cheapest technology drive the price down to its cost, ${money(low)}.${idle.length ? ` ${makeNothing(idle, `${idle.length === 1 ? "its cost is" : "their costs are"} above that.`)}` : ""}`);
  }
  return parts.join(" ");
}

/* ---------- rendering ---------- */
function update() {
  const m = market();
  const s = structureOf(state.key);
  const all = solveAll(m);
  const o = all.find((x) => x.key === state.key);
  const diff = state.key === "bertrandDiff";
  const costText = state.own ? `Costs per unit: ${m.costs.map((c, i) => `firm ${i + 1} ${money(c)}`).join(", ")}.` : `Every unit costs ${money(state.cost)} to make.`;
  marketLine.replaceChildren(
    el("strong", { text: "The market. " }),
    diff ? `Firm i's price: p = ${fmt.auto(m.a)} − ${fmt.auto(m.b)} × (its own output + ${fmt.num(m.theta, 2)} × the others' output). ` : `Demand: P = ${fmt.auto(m.a)} − ${fmt.auto(m.b)} × Q. `,
    costText, " No fixed costs.");

  nSlider.el.querySelector(".hint")?.remove();
  if (state.own) nSlider.el.append(el("div", { class: "hint", text: `Up to ${MAX_OWN} firms when each has its own cost.` }));

  if (!o.trade) {
    sPrice.set("–", "nothing is sold"); sQ.set(units(0), "units"); sProfit.set(money(0), ""); sLoss.set(money(0), "nothing to lose");
    const text = `Nothing is sold: the cheapest unit costs ${money(Math.min(...m.costs))} to make and no buyer will pay more than ${money(m.a)}. Lower a cost or raise the highest price.`;
    message.replaceChildren(note("warn", text));
    status.textContent = text;
  } else {
    sPrice.set(money(o.price), diff && new Set(o.p.filter((_, i) => o.active[i]).map((p) => p.toFixed(6))).size > 1 ? "average over units sold" : `competitive price ${money(Math.min(...m.costs))}`);
    sQ.set(units(o.Q), `${firmsWord(o.active.filter(Boolean).length)} producing${m.costs.length > 1 ? ` of ${m.costs.length}` : ""}`);
    sProfit.set(money(o.totalProfit), `buyers keep ${money(o.cs)}`);
    sLoss.set(money(o.dwl), `${lossPct(o.dwlShare)} of the competitive surplus`);
    message.replaceChildren(note("", el("strong", { text: `${s.label}. ` }), explain(o, m)));
    status.textContent = `${s.label}, ${firmsWord(m.costs.length)}: price ${money(o.price)}, total output ${units(o.Q)}, total profit ${money(o.totalProfit)}, deadweight loss ${money(o.dwl)}, which is ${lossPct(o.dwlShare)} of the competitive surplus.`;
  }

  // Firm by firm.
  firmBox.replaceChildren(listTable({
    caption: `Firm by firm: ${s.label.toLowerCase()}`,
    columns: [
      { label: "Firm", get: (r) => `Firm ${r.i + 1}${state.key === "stackelberg" && m.costs.length > 1 ? (r.i === 0 ? " (leader)" : "") : ""}` },
      { label: "Cost per unit", num: true, get: (r) => money(m.costs[r.i]) },
      { label: s.choice === "price" ? "Price it posts" : "Price", num: true, get: (r) => (o.trade ? money(o.p[r.i]) : "–") },
      { label: "Output", num: true, get: (r) => (o.active[r.i] ? units(o.q[r.i]) : "makes nothing") },
      { label: "Share of output", num: true, get: (r) => (o.trade ? fmt.pct(o.q[r.i] / o.Q, 1) : "–") },
      { label: "Profit", num: true, get: (r) => money(o.profits[r.i]) },
    ],
    rows: m.costs.map((_, i) => ({ i })),
  }));

  // Every structure side by side.
  const share = (x, total) => (total > 0 ? x / total : 0);
  compareBars.replaceChildren(
    el("div", { class: "chart-legend" },
      [["Buyers keep (consumer surplus)", palette[0]], ["Firms keep (profit)", palette[1]], ["Lost (deadweight loss)", GREY]].map(([name, color]) => el("span", {}, el("i", { style: { background: color } }), name))),
    ...all.map((x) => {
      const label = structureOf(x.key).short;
      const parts = [[x.cs, palette[0], "buyers"], [x.totalProfit, palette[1], "firms"], [x.dwl, GREY, "lost"]];
      const text = x.trade ? parts.map(([v, , name]) => `${name} ${lossPct(share(v, x.benchmark))}`).join(", ") : "nothing is sold";
      return el("div", { class: `split-row${x.key === state.key ? " on" : ""}` },
        el("span", { class: "name", text: label }),
        el("span", { class: "split-bar", role: "img", "aria-label": `${label}: ${text}` },
          x.trade ? parts.filter(([v]) => v > 0).map(([v, color]) => el("span", { style: { width: `${share(v, x.benchmark) * 100}%`, background: color } })) : null),
        el("span", { class: "small muted", text }));
    }));
  compareBox.replaceChildren(listTable({
    caption: `All six, for ${firmsWord(m.costs.length)}. The one chosen above is marked "(shown)".`,
    columns: [
      { label: "Kind of competition", get: (x) => `${structureOf(x.key).short}${x.key === state.key ? " (shown)" : ""}` },
      { label: "Price", num: true, get: (x) => (x.trade ? money(x.price) : "–") },
      { label: "Total output", num: true, get: (x) => units(x.Q) },
      { label: "Consumer surplus", num: true, get: (x) => money(x.cs) },
      { label: "Total profit", num: true, get: (x) => money(x.totalProfit) },
      { label: "Deadweight loss", num: true, get: (x) => money(x.dwl) },
      { label: "Loss, share of benchmark", num: true, get: (x) => lossPct(x.dwlShare) },
    ],
    rows: all.map((x) => ({ ...x, on: x.key === state.key })),
  }));

  // Adding firms one at a time.
  const upTo = state.own ? state.n : MAX_SAME;
  const longMarket = { ...m, costs: state.own ? m.costs : Array(upTo).fill(state.cost) };
  const lossView = state.view === "loss";
  const paths = STRUCTURES.map((x) => ({ x, path: entryPath(x.key, longMarket, upTo) }));
  const any = paths.some(({ path }) => path.some((p) => p.trade));
  pathChart.update({
    title: lossView ? "Deadweight loss as firms are added" : "Price as firms are added",
    subtitle: state.own ? "Firms join in the order listed: firm 1 alone, then firms 1 and 2, and so on." : `Every firm has the same cost, ${money(state.cost)}. The dashed line marks the number of firms chosen.`,
    label: lossView ? "Line chart of deadweight loss, as a share of the competitive surplus, against the number of firms, for each kind of competition" : "Line chart of price against the number of firms, for each kind of competition",
    x: { label: "Number of firms", domain: [1, Math.max(2, upTo)], ticks: Math.min(10, Math.max(1, upTo - 1)), format: (v) => (Number.isInteger(v) ? String(v) : "") },
    y: lossView ? { label: "Deadweight loss, share of the competitive surplus", format: (v) => fmt.pct(v, 0), zero: true } : { label: "Price buyers pay", format: (v) => fmt.num(v, 0) },
    series: any && upTo > 1 ? paths.map(({ x, path }) => ({
      name: x.short, type: "line", color: LINE[x.key], dash: x.key === "monopoly" || x.key === "competition", width: x.key === state.key ? 3 : 1.75,
      data: path.map((p, k) => [k + 1, lossView ? p.dwlShare ?? NaN : p.price ?? NaN]),
    })) : [],
    marks: any && upTo > 1 && !state.own ? [{ type: "vline", x: state.n }] : [],
    empty: !any ? "Nothing is sold at these costs" : "Add a second firm to see a path",
  });
  const cournotNow = paths.find(({ x }) => x.key === "cournot").path;
  const last = cournotNow.at(-1);
  pathNote.replaceChildren(el("p", { class: "small muted", text: !any || upTo < 2 ? "" : state.own
    ? `With these ${upTo} firms the Cournot price is ${money(last.price)} and the loss ${lossPct(last.dwlShare)} of the competitive surplus. A high-cost entrant can raise the loss, because it makes units that a cheaper firm could have made.`
    // The numbers for the number of firms chosen (the dashed line), then for the right-hand end of the chart.
    : `Cournot with the ${firmsWord(state.n)} chosen: price ${money(cournotNow[state.n - 1].price)} against a cost of ${money(state.cost)}, and a loss of ${lossPct(cournotNow[state.n - 1].dwlShare)} of the competitive surplus.${state.n < upTo ? ` With ${upTo} firms: ${money(last.price)} and ${lossPct(last.dwlShare)}.` : ""} With equal costs the loss is exactly 1 / (n + 1)² of the competitive surplus.` }));

  // The equilibrium check.
  state.firm = Math.min(state.firm, m.costs.length - 1);
  firmSel.input.replaceChildren(...m.costs.map((_, i) => el("option", { value: i, text: `Firm ${i + 1}` })));
  firmSel.value = state.firm;
  const i = state.firm;
  if (!o.trade) {
    checkChart.update({ title: "", subtitle: "", series: [], marks: [], empty: "Nothing is sold, so there is nothing to test" });
    checkText.replaceChildren();
    return;
  }
  const d = deviation(state.key, m, o, i);
  const byPrice = d.kind === "price";
  const who = state.key === "monopoly" ? "The owner's profit" : `Firm ${i + 1}'s profit`;
  const what = state.key === "monopoly" ? `the output of plant ${i + 1}` : byPrice ? "its own price" : "its own output";
  const held = state.key === "stackelberg" && i === 0 ? "the followers replying to whatever it makes" : state.key === "competition" ? `the price fixed at ${money(o.p[i])}` : state.key === "monopoly" ? "the other plants as they are" : `every other firm's ${byPrice ? "price" : "output"} held where it is`;
  const floor = Math.min(0, d.ownProfit) - 0.25 * Math.max(d.bestProfit, 1e-9);
  checkChart.update({
    title: `${who} against ${what}`,
    subtitle: `With ${held}. The dot is what it does in the outcome above.`,
    label: `Line chart of ${who.toLowerCase()} against ${what}`,
    x: { label: byPrice ? `Firm ${i + 1}'s price` : state.key === "monopoly" ? `Output of plant ${i + 1}` : `Firm ${i + 1}'s output`, format: (v) => fmt.auto(v) },
    y: { label: "Profit", domain: [floor, Math.max(d.bestProfit, 1e-9) * 1.12], format: (v) => fmt.compact(Math.round(v * 100) / 100) },
    series: [{ name: "Profit", type: "line", color: 0, data: d.xs.map((x, k) => [x, d.ys[k] < floor ? NaN : d.ys[k]]) }],
    marks: [{ type: "point", x: d.own, y: d.ownProfit, text: `${byPrice ? "price" : "output"} ${fmt.num(choiceOf(state.key, o, i), 2)}` }],
  });
  const scale = (m.a * m.a) / m.b;
  const holds = d.gain <= 1e-9 * scale;
  const tested = `${fmt.int(d.xs.length)} ${byPrice ? "prices from 0 to " + money(m.a) : "outputs from 0 to " + units(m.a / m.b)}`;
  checkText.replaceChildren(note(holds ? "good" : "bad",
    holds
      ? `Tried ${tested}: none earns ${state.key === "monopoly" ? "the owner" : `firm ${i + 1}`} more than the ${money(d.ownProfit)} it has now.${state.key === "competition" ? " A price taker cannot move the price, so at a price equal to cost every output earns the same nothing, and a firm with a higher cost loses on every unit." : " The same holds for every other firm, which is what makes this a Nash equilibrium."}`
      : `Trying ${tested} finds a better choice (${fmt.num(d.bestX, 2)}, worth ${money(d.bestProfit)} against ${money(d.ownProfit)}). That should not happen: please report it.`));
}

syncControls();
update();
