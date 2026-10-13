// Day 51: Cartel Stability Simulator. Interface.
import { $, el, fmt, mount, slider, segmented, button, stat, note, chart } from "../kit/kit.js";
import { MARKET, MODES, temptation, criticalDelta, verdict, values, simulate, bestSustainable } from "./logic.js";

mount();

const START = { mode: "bertrand", n: 2, delta: 0.6, grim: true, T: 5, L: 1 };
const state = { ...START };
const money = (x) => fmt.num(x, 2);
const periods = (k) => (k === 1 ? "1 period" : `${fmt.int(k)} periods`);
const modeName = (key) => (key === "bertrand" ? "Bertrand" : "Cournot");
const settings = () => ({ mode: state.mode, n: state.n, delta: state.delta, T: state.grim ? Infinity : state.T, L: state.L });

/* ---------- controls ---------- */
const modeSeg = segmented({
  label: "When the agreement breaks, firms compete on", value: state.mode,
  options: [{ value: "bertrand", label: "Price (Bertrand)" }, { value: "cournot", label: "Quantity (Cournot)" }],
  hint: "Price competition with identical goods drives profit to zero. Quantity competition leaves each firm a smaller profit.",
  onChange: (v) => { state.mode = v; update(); },
});
const nSlider = slider({ label: "Number of firms", min: 2, max: 20, step: 1, value: state.n, format: (v) => String(v), onInput: (v) => { state.n = v; update(); } });
const dSlider = slider({
  label: "Patience (discount factor δ)", min: 0, max: 0.99, step: 0.01, value: state.delta, format: (v) => fmt.num(v, 2),
  hint: "What a firm thinks 1.00 of profit next period is worth today. 0 is a firm that cares only about now.",
  onInput: (v) => { state.delta = v; update(); },
});
const punishSeg = segmented({
  label: "Punishment for cheating", value: "grim",
  options: [{ value: "grim", label: "For ever" }, { value: "war", label: "A price war" }],
  hint: "For ever is the grim trigger: one lapse ends the agreement for good. A price war lasts a set number of periods, after which the agreement resumes.",
  onChange: (v) => { state.grim = v === "grim"; sync(); update(); },
});
const tSlider = slider({ label: "Length of the price war", min: 1, max: 40, step: 1, value: state.T, format: periods, onInput: (v) => { state.T = v; update(); } });
const lSlider = slider({
  label: "Cheating is noticed after", min: 1, max: 12, step: 1, value: state.L, format: periods,
  hint: "The cheat collects its extra profit in every one of these periods before the others react.",
  onInput: (v) => { state.L = v; update(); },
});
function sync() {
  modeSeg.value = state.mode; nSlider.value = state.n; dSlider.value = state.delta;
  punishSeg.value = state.grim ? "grim" : "war"; tSlider.value = state.T; lSlider.value = state.L;
  tSlider.el.hidden = state.grim;
}
const EXAMPLES = [
  { label: "Two firms, grim trigger", set: {} },
  { label: "Ten firms", set: { n: 10, delta: 0.8 } },
  { label: "A two-period price war", set: { grim: false, T: 2 } },
  { label: "A one-period price war", set: { grim: false, T: 1, delta: 0.95 } },
  { label: "Slow detection", set: { L: 4, delta: 0.8 } },
  { label: "Cournot, impatient", set: { mode: "cournot", delta: 0.3 } },
];
const apply = (set) => { Object.assign(state, START, set); sync(); update(); };
const controls = el("div", { class: "controls" },
  modeSeg.el, nSlider.el, dSlider.el, punishSeg.el, tSlider.el, lSlider.el,
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row" }, EXAMPLES.map((x) => button(x.label, () => apply(x.set), { small: true })), button("Reset", () => apply({}), { small: true }))),
  el("p", { class: "small muted", text: `The market is fixed: demand P = ${MARKET.a} − Q and a cost of ${MARKET.c} a unit for every firm. The patience a cartel needs does not depend on those numbers, only the size of the profits does.` }));

// Links to the parts of a long tool: on a phone the results start below the controls.
const jump = (pairs) => el("nav", { class: "jump", "aria-label": "Parts of the tool" }, el("span", { text: "Jump to" }), pairs.map(([id, text]) => el("a", { href: `#${id}`, text })));

/* ---------- outputs ---------- */
const verdictBox = el("div", { class: "stack", id: "t-verdict" });
const status = el("p", { class: "sr-only", role: "status" });
const sNeed = stat("Patience needed"), sKeep = stat("Worth of keeping to it"), sCheat = stat("Worth of cheating"), sBest = stat("Best agreement that holds");
const streamBox = el("div"), tableBox = el("div", { class: "rt-box" }), sumBox = el("div");   // rt-box: the table turns into a list in a narrow column
const needBox = el("div"), needNote = el("div"), valueBox = el("div");
const out = el("div", { class: "out" },
  verdictBox, status, el("div", { class: "stats" }, sNeed.el, sKeep.el, sCheat.el, sBest.el),
  el("h2", { id: "t-stream", text: "One firm's profit, period by period" }), streamBox, tableBox, sumBox,
  el("h2", { id: "t-need", text: "How much patience a cartel needs" }), needBox, needNote,
  el("h2", { id: "t-value", text: "Keeping against cheating, at every level of patience" }), valueBox);
$("#app").append(jump([["t-verdict", "Verdict"], ["t-stream", "Period by period"], ["t-need", "Patience needed"], ["t-value", "Keeping against cheating"]]), el("div", { class: "tool-grid" }, controls, out));
const streamChart = chart(streamBox, { series: [], height: 280 });
const needChart = chart(needBox, { series: [], height: 300 });
const valueChart = chart(valueBox, { series: [], height: 280 });

// A table that turns into a list of labelled lines on a narrow screen (see the page's <style>).
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl rt", role: "table" },
    el("caption", { text: caption }),
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c) => el("th", { role: "columnheader", scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row" },
      columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/* ---------- rendering ---------- */
function update() {
  const s = settings();
  const { mode, n, delta, T, L } = s;
  const v = verdict(s), val = values(s), best = bestSustainable(s);
  const { num, den } = temptation(mode, n);
  const grim = T === Infinity;
  const punishment = grim ? "competition for ever" : `a price war of ${periods(T)}`;

  // The verdict in words.
  const numbers = `Keeping to the agreement is worth ${money(val.comply)} to a firm, counting every future period at its discounted value. Cheating is worth ${money(val.cheat)}: ${money(val.deviate)} a period for the ${periods(L)} before it is noticed, then ${money(val.punish)} a period during ${grim ? "the competition that follows" : `the war, then back to ${money(val.collude)}`}.`;
  // A threshold such as 9/17 is shown rounded to 0.529, which is a shade below it: say "about" unless three decimals are exact.
  const exact = v.critical != null && Math.abs(v.critical * 1000 - Math.round(v.critical * 1000)) < 1e-9;
  const need = v.critical == null ? "" : `${exact ? "" : "about "}${fmt.num(v.critical, 3)}`;
  let kind, head, tail;
  if (v.threshold) {
    kind = ""; head = "The cartel holds, but only just.";
    tail = `${numbers} At a patience of exactly ${fmt.num(delta, 2)} a firm gains nothing and loses nothing by cheating.`;
  } else if (v.holds) {
    kind = "good"; head = "The cartel holds.";
    tail = `${numbers} Any patience from ${need} up is enough here.`;
  } else if (v.critical == null) {
    const least = Math.floor((L * num) / den) + 1;
    kind = "bad"; head = "The cartel breaks down, and no amount of patience would save it.";
    tail = `${numbers} A war of ${periods(T)} takes back less than a cheat gains in the ${periods(L)} before it is noticed, however much the firm cares about the future. With these settings the war would have to last at least ${periods(least)}.`;
  } else {
    kind = "bad"; head = "The cartel breaks down.";
    tail = `${numbers} Every firm would rather cheat, so the agreement never gets started. It would need a patience of ${exact ? `at least ${need}` : `${need} or more`}.`;
  }
  verdictBox.replaceChildren(note(kind, el("strong", { text: `${head} ` }), tail));
  status.textContent = `${head} Keeping to the agreement is worth ${money(val.comply)}, cheating ${money(val.cheat)}. ${v.critical == null ? "No patience below 1 is enough." : `Patience needed: ${fmt.num(v.critical, 3)}.`}`;

  sNeed.set(v.critical == null ? "none is enough" : fmt.num(v.critical, 3), `this firm has ${fmt.num(delta, 2)}`);
  sKeep.set(money(val.comply), `${money(val.collude)} every period`);
  sCheat.set(money(val.cheat), v.threshold ? "the same as keeping to it" : `${money(Math.abs(val.gain))} ${val.gain > 0 ? "more" : "less"} than keeping to it`);
  // The agreement is short of the monopoly one here, so its share must never print as 100%, nor a positive share as 0%.
  const shareText = fmt.pct(best.share, best.share >= 0.995 || best.share < 0.005 ? 1 : 0);
  sBest.set(`price ${money(best.price)}`, best.full ? "the monopoly price" : best.share <= 1e-9 ? `no better than ${mode === "bertrand" ? "cost" : "Cournot competition"}`
    : shareText === "100.0%" ? "a shade under the monopoly profit" : shareText === "0.0%" ? "barely better than Cournot competition" : `${shareText} of the way from competing to monopoly profit`);

  // Period by period, from the simulation.
  const show = Math.min(40, L + (grim ? 6 : T) + 5);
  const cheat = simulate({ ...s, cheat: true, keep: show });
  const keep = simulate({ ...s, cheat: false, keep: show });
  streamChart.update({
    title: "Profit of the firm that cheats in period 0, and of a firm that never does",
    subtitle: `The cheat gains for ${periods(L)}, then comes ${punishment}${grim ? "" : " and a return to the agreement"}.`,
    label: "Step chart of one firm's profit in each period, if it keeps to the agreement and if it cheats in period 0",
    x: { label: "Period", domain: [0, show - 1], format: (x) => (Number.isInteger(x) ? String(x) : "") },
    y: { label: "Profit in the period", zero: true, format: (y) => fmt.int(y) },
    series: [
      { name: "Keeps to the agreement", type: "step", color: "#8a94a3", data: keep.rows.map((r) => [r.t, r.mine]) },
      { name: "Cheats in period 0", type: "step", color: 1, width: 2.5, data: cheat.rows.map((r) => [r.t, r.mine]) },
    ],
    marks: [],
  });
  const tableRows = cheat.rows.slice(0, Math.min(show, L + (grim ? 0 : Math.min(T, 6)) + 2));
  const phase = { cheating: "firm 1 cheats", war: grim ? "competition" : "price war", agreement: "agreement" };
  tableBox.replaceChildren(listTable({
    caption: `The first ${tableRows.length} periods when firm 1 cheats${grim ? ". Every later period is the same as the last one shown" : ""}`,
    columns: [
      { label: "Period", get: (r) => `Period ${r.t}` },
      { label: "What happens", get: (r) => phase[r.phase] },
      { label: "Price", num: true, get: (r) => (mode === "bertrand" && r.phase === "cheating" ? `just under ${money(r.price)}` : money(r.price)) },
      { label: "Firm 1's output", num: true, get: (r) => fmt.num(r.myOutput, 2) },
      { label: "Firm 1's profit", num: true, get: (r) => money(r.mine) },
      { label: "Each other firm's profit", num: true, get: (r) => money(r.theirs) },
    ],
    rows: tableRows,
  }));
  const agree = (x, y) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y));
  sumBox.replaceChildren(el("p", { class: "small muted", text:
    `${cheat.horizon === 1 ? "At a patience of 0 only the first period counts, so the simulation" : `Adding up ${fmt.int(cheat.horizon)} simulated periods, each multiplied by δ to the power of its period number,`} gives ${money(keep.cheater)} for keeping and ${money(cheat.cheater)} for cheating. The formulas give ${money(val.comply)} and ${money(val.cheat)}${agree(keep.cheater, val.comply) && agree(cheat.cheater, val.cheat) ? ", the same." : ". These should agree: please report it."}` }));

  // Patience needed, by number of firms, for both kinds of competition.
  const ns = Array.from({ length: 19 }, (_, k) => k + 2);
  const line = (key, color) => ({ name: `${modeName(key)}`, type: "line", color, width: key === mode ? 3 : 1.75, data: ns.map((k) => [k, criticalDelta(key, k, T, L) ?? NaN]) });
  const gaps = ns.filter((k) => criticalDelta(mode, k, T, L) == null);
  const anyLine = ns.some((k) => criticalDelta("bertrand", k, T, L) != null || criticalDelta("cournot", k, T, L) != null);
  needChart.update({
    title: `Patience needed with ${punishment}, noticed after ${periods(L)}`,
    subtitle: "A cartel holds when its firms' patience is on or above the line for its kind of competition. The dot is the cartel set on the left.",
    label: "Line chart of the critical discount factor against the number of firms, for Bertrand and Cournot competition",
    x: { label: "Number of firms", domain: [2, 20], ticks: 9, format: (x) => (Number.isInteger(x) ? String(x) : "") },
    y: { label: "Critical discount factor", domain: [0, 1], format: (y) => fmt.num(y, 1) },
    series: anyLine ? [line("bertrand", 0), line("cournot", 1)] : [],
    marks: anyLine ? [{ type: "point", x: n, y: delta, text: v.holds ? "holds" : "breaks" }] : [],
    empty: "No cartel of 2 to 20 firms holds at any patience with this punishment",
  });
  const lastOk = ns.filter((k) => criticalDelta(mode, k, T, L) != null).at(-1);
  const tooShort = `${punishment} is too short to deter cheating at any patience`;
  needNote.replaceChildren(...(!gaps.length ? [] : [note("", lastOk
    ? `Under ${modeName(mode)} competition the line stops after ${lastOk} firms: with ${gaps[0] === 20 ? "20 firms" : `${gaps[0]} or more firms`}, ${tooShort}.`
    : `Under ${modeName(mode)} competition there is no line to draw: for any number of firms from 2 to 20, ${tooShort}.`)]));

  // Average value per period, as patience varies.
  const ds = Array.from({ length: 100 }, (_, k) => k / 100);
  const per = (d, key) => { const x = values({ ...s, delta: d }); return (1 - d) * x[key]; };
  valueChart.update({
    title: "What a firm earns per period on average, weighting the future by its patience",
    subtitle: v.critical == null ? "Cheating stays ahead at every level of patience." : `The lines cross at ${fmt.num(v.critical, 3)}: to the right of it, keeping to the agreement pays more.`,
    label: "Line chart of the discounted average profit per period from keeping to the agreement and from cheating, against the discount factor",
    x: { label: "Patience (discount factor δ)", domain: [0, 1], format: (x) => fmt.num(x, 1) },
    // No forced zero: under quantity competition the two lines are a few per cent apart and the crossing would not show.
    y: { label: "Average profit per period", format: (y) => fmt.int(y) },
    series: [
      { name: "Keeps to the agreement", type: "line", color: "#8a94a3", data: ds.map((d) => [d, per(d, "comply")]) },
      { name: "Cheats now", type: "line", color: 1, data: ds.map((d) => [d, per(d, "cheat")]) },
    ],
    marks: [{ type: "vline", x: delta, text: `this firm: ${fmt.num(delta, 2)}` }],
  });
}

sync();
update();
