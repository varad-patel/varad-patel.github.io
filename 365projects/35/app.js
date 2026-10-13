// Day 35: Where Your Tax Rupee Goes. Interface.
// The kit has no treemap, so one is built here: squarify() from logic.js gives the rectangles, this file draws them in
// SVG with one tab stop, arrow keys between tiles, and tables that carry the same numbers.
import { $, el, svgEl, mount, select, checkbox, segmented, button, textField, stat, note, bars, chart, debounce } from "../kit/kit.js";
import { BUDGET } from "./data.js";
import { rupees, crore, percent, parseAmount, STATUS_WORDS, yearView, funding, splitTax, changeTable, shareSeries, squarify } from "./logic.js";

mount();

const LAST = BUDGET.years.length - 1;
const yearLabel = (i) => `${BUDGET.years[i]} (${STATUS_WORDS[BUDGET.status[i]]})`;
const state = { amount: 100000, year: LAST, states: false, ministry: "Ministry of Finance", demand: null, level: "all" };

/* ---------- controls ---------- */
const amountBox = textField({
  label: "Tax you pay in a year, in rupees", value: "1,00,000",
  hint: "The ₹1,00,000 is a placeholder. Type your own figure: income tax, GST, any tax that goes to the Union.",
  onInput: () => readAmount(),
});
amountBox.input.setAttribute("inputmode", "decimal");
amountBox.input.setAttribute("maxlength", "24");
const amountError = el("div");
const presets = el("div", { class: "row", role: "group", "aria-label": "Example amounts" },
  [10000, 100000, 500000, 2500000].map((v) => button(rupees(v), () => { amountBox.value = rupees(v).slice(1); readAmount(); }, { small: true })));
const yearSelect = select({
  label: "Financial year", value: LAST,
  options: BUDGET.years.map((_, i) => ({ value: i, label: yearLabel(i) })).reverse(),
  hint: "April to March. Each year uses the best figure published: an actual, a revised estimate or a budget estimate.",
  onChange: (v) => { state.year = Number(v); update(); },
});
const statesBox = checkbox({ label: "Set aside the States' share of central taxes first", onChange: (on) => { state.states = on; update(); } });
const statesHint = el("div", { class: "hint" });
const ministrySelect = select({
  label: "Ministry to look inside and follow over ten years", value: state.ministry,
  options: BUDGET.ministries.map((m) => ({ value: m.name, label: m.name.replace(/^(Ministry|Department) of /, "") })).sort((a, b) => a.label.localeCompare(b.label)),
  onChange: (v) => { state.ministry = v; state.demand = null; update(); },
});
const levelSeg = segmented({
  label: "The treemap shows", value: "all",
  options: [{ value: "all", label: "All ministries" }, { value: "inside", label: "Inside the chosen ministry" }],
  onChange: (v) => { state.level = v; state.demand = null; update(); },
});
const controls = el("div", { class: "controls" },
  amountBox.el, amountError, presets, yearSelect.el,
  el("div", { class: "field" }, statesBox.el, statesHint),
  ministrySelect.el, levelSeg.el);

/* ---------- outputs ---------- */
const sTotal = stat("Union spending");
const sInterest = stat("Largest single demand");
const sBorrow = stat("Paid for by borrowing");
const sYours = stat("Of your tax");
const status = el("p", { class: "sr-only", role: "status" });
const say = debounce((text) => { status.textContent = text; }, 700); // one announcement once typing stops
const assume = el("div");
const mapTitle = el("p", { class: "chart-title" });
const mapSub = el("p", { class: "chart-sub" });
// tabindex -1: Chromium otherwise makes the <svg> itself a tab stop in front of the tile that holds the real one.
const mapSvg = svgEl("svg", { class: "tm", role: "group", tabindex: -1 });
const mapBox = el("div", { class: "tm-box" }, mapSvg);
const HOVER_HINT = "Point at a rectangle, tap it or move to it with the arrow keys to read its figures here.";
const mapHover = el("p", { class: "small muted tm-hover", "aria-hidden": "true", text: HOVER_HINT });
const mapNote = el("div");
const panel = el("div", { class: "panel" });
const chartBox = el("div");
const changeBox = el("div", { class: "stack" });
const allBox = el("details", { class: "chart-table" });
const jump = el("nav", { class: "row small jump", "aria-label": "Parts of this tool" },
  el("span", { class: "muted", text: "Jump to:" }),
  el("a", { href: "#t-map", text: "Treemap" }), el("a", { href: "#t-ministry", text: "One ministry" }),
  el("a", { href: "#t-years", text: "Its ten years" }), el("a", { href: "#t-change", text: "Every ministry's change" }));
panel.id = "t-ministry"; chartBox.id = "t-years"; changeBox.id = "t-change";
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sTotal.el, sInterest.el, sBorrow.el, sYours.el), status, assume,
  el("div", { id: "t-map" }, mapTitle, mapSub, mapBox, mapHover, mapNote), allBox, panel, chartBox, changeBox);

$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));
const plot = chart(chartBox, { series: [], height: 280 });

/* ---------- small helpers ---------- */
function readAmount() {
  const r = parseAmount(amountBox.value);
  amountBox.input.classList.toggle("invalid", Boolean(r.error));
  if (r.error) {
    amountBox.input.setAttribute("aria-invalid", "true");
    amountError.replaceChildren(note("bad", `${r.error} The split below still uses ${rupees(state.amount)}.`));
    return;
  }
  amountBox.input.removeAttribute("aria-invalid");
  amountError.replaceChildren();
  state.amount = r.value;
  update();
}

// A table that turns into a list of labelled lines on a narrow screen (see the page's <style>).
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl rt", role: "table" },
    el("caption", { text: caption }),
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c) => el("th", { role: "columnheader", scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row" },
      columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/* ---------- treemap ---------- */
let tiles = [];
let active = 0; // the tile that holds the tab stop
const keyOf = (t) => t.name;

function drawTreemap(items, split, describe) {
  const hadFocus = mapSvg.contains(document.activeElement);
  // The rectangle the keyboard is on keeps the tab stop through a redraw (a resize, say), where it still exists.
  const held = hadFocus ? tiles[Number(document.activeElement.closest(".tm-tile")?.dataset.i)]?.name : null;
  const W = Math.max(260, mapBox.clientWidth || 640);
  const H = W < 520 ? 440 : 420;
  tiles = squarify(items, 0, 0, W, H);
  mapSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  mapSvg.setAttribute("height", H);
  const chosen = state.level === "all" ? state.ministry : state.demand;
  const at = (name) => tiles.findIndex((t) => keyOf(t) === name);
  active = Math.max(0, held != null && at(held) >= 0 ? at(held) : at(chosen));
  // Buttons first, then one layer of drawn labels. The labels are hidden from screen readers (a cut-off name must not
  // stand in for the full one in aria-label) and sit outside the buttons, whose names are their aria-labels.
  const labels = svgEl("g", { "aria-hidden": "true" });
  mapSvg.replaceChildren(...tiles.map((t, i) => {
    t.label = `${t.short || t.name}: ${percent(t.share)} of spending, ${crore(t.value)}, ${rupees(split.get(t.name))} of your ${rupees(state.amount)}`;
    // A one-pixel gap on each side, less for a rectangle under four pixels: a rectangle of no size is not drawn at all,
    // and then nothing shows where the keyboard's focus is.
    const gx = Math.min(1, t.w / 4), gy = Math.min(1, t.h / 4);
    return svgEl("g", { class: `tm-tile${keyOf(t) === chosen ? " sel" : ""}`, role: "button", tabindex: i === active ? 0 : -1, "aria-label": t.label, "aria-pressed": keyOf(t) === chosen ? "true" : "false", "data-i": i },
      svgEl("rect", { x: t.x + gx, y: t.y + gy, width: t.w - 2 * gx, height: t.h - 2 * gy, rx: Math.min(2, t.w / 4, t.h / 4) }));
  }), labels);
  // A label is drawn only if it fits its rectangle, measured in the browser: the name first, cut short with an ellipsis
  // if need be, then the share and the amount on a second line where there is height for one.
  const fit = (node, options, room) => {
    labels.append(node);
    for (const text of options) { node.textContent = text; if (node.getComputedTextLength() <= room) return true; }
    node.remove();
    return false;
  };
  for (const t of tiles) {
    const room = t.w - 13, name = t.short || t.name;
    if (room < 24 || t.h < 22) continue;
    const cuts = [name];
    for (let n = Math.min(name.length - 1, 40); n >= 3; n--) cuts.push(`${name.slice(0, n).trimEnd()}…`);
    if (!fit(svgEl("text", { x: t.x + 7, y: t.y + 17, class: "tm-name" }), cuts, room)) continue;
    if (t.h >= 40) fit(svgEl("text", { x: t.x + 7, y: t.y + 33 }), [`${percent(t.share)} · ${rupees(split.get(t.name))}`, percent(t.share)], room);
  }
  mapHover.textContent = HOVER_HINT;
  mapSvg.setAttribute("aria-label", `${describe}. ${tiles.length} ${tiles.length === 1 ? "rectangle" : "rectangles"}, largest first. Arrow keys move between them, Enter or Space chooses one.`);
  if (hadFocus) mapSvg.querySelector(`[data-i="${active}"]`)?.focus();
}

function choose(i) {
  const t = tiles[i];
  if (!t) return;
  if (state.level === "all") { state.ministry = t.name; state.demand = null; ministrySelect.value = t.name; }
  else state.demand = state.demand === t.name ? null : t.name;
  update();
  mapSvg.querySelector(`[data-i="${Math.max(0, tiles.findIndex((x) => keyOf(x) === t.name))}"]`)?.focus();
}
// A small rectangle has no room for a label, so pointing at it (or moving to it with the keys) prints its figures under the map.
const showHover = (e) => { const g = e.target.closest?.(".tm-tile"); mapHover.textContent = g ? tiles[Number(g.dataset.i)]?.label || HOVER_HINT : HOVER_HINT; };
mapSvg.addEventListener("pointermove", showHover);
mapSvg.addEventListener("focusin", showHover);
mapSvg.addEventListener("pointerleave", () => { mapHover.textContent = HOVER_HINT; });
mapSvg.addEventListener("click", (e) => { const g = e.target.closest?.(".tm-tile"); if (g) choose(Number(g.dataset.i)); });
mapSvg.addEventListener("keydown", (e) => {
  const g = e.target.closest?.(".tm-tile");
  if (!g) return;
  const i = Number(g.dataset.i);
  const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tiles.length - 1 }[e.key];
  if (to != null) {
    e.preventDefault();
    const next = Math.min(tiles.length - 1, Math.max(0, to));
    g.setAttribute("tabindex", -1);
    const target = mapSvg.querySelector(`[data-i="${next}"]`);
    target.setAttribute("tabindex", 0);
    target.focus();
    active = next;
  } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(i); }
});
// The layout depends on the shape of the frame, so the map alone is laid out again when its width changes.
let lastMap = null;
if (typeof ResizeObserver !== "undefined") {
  let width = 0;
  // The redraw waits for the next frame: inside the observer's own callback it can change the size again, which
  // browsers report as an error.
  new ResizeObserver(() => requestAnimationFrame(() => {
    if (mapBox.clientWidth === width || !mapBox.clientWidth) return;
    width = mapBox.clientWidth;
    if (lastMap) drawTreemap(...lastMap);
  })).observe(mapBox);
}

// The panel's button is rebuilt when it is pressed, so focus moves to the map's chosen rectangle, or to the new button
// when the map has nothing to draw. It must never be left on <body>.
const focusMap = () => (mapSvg.querySelector('[tabindex="0"]') || panel.querySelector("button"))?.focus();

/* ---------- rendering ---------- */
function update() {
  const i = state.year;
  const view = yearView(BUDGET, i);
  const f = funding(BUDGET, i);
  const kind = STATUS_WORDS[view.status];
  const opts = { statesShare: state.states ? f.statesShare : 0 };
  const byMinistry = splitTax(state.amount, view.ministries, opts);
  const ministry = view.ministries.find((m) => m.name === state.ministry);
  const inside = splitTax(state.amount, ministry.demands, opts);
  const yours = rupees(state.amount);
  const all = view.ministries.flatMap((m) => m.demands.map((d) => ({ ...d, ministry: m })));
  const top = all.reduce((a, b) => (b.value > a.value ? b : a));
  const topAmount = byMinistry.toUnion * top.share;

  statesHint.textContent = `In ${view.year} the States' share is ${percent(f.statesShare)} of gross central taxes (${kind}). It is passed on before the Union spends anything, so it is not in the Union Budget's spending.`;

  sTotal.set(crore(view.total), `${view.year}, ${kind}, read from Budget ${view.budget}`);
  sInterest.set(top.name, `${percent(top.share)} of spending: ${rupees(topAmount)} of your ${yours}`);
  sBorrow.set(percent(f.borrowing), `of ${view.year} spending. Net tax revenue covers ${percent(f.netTax)}.`);
  const biggest = byMinistry.rows[0];
  sYours.set(`${rupees(biggest.amount)} to ${biggest.short}`, state.states ? `after ${rupees(byMinistry.toStates)} is set aside for the States` : `the largest ministry, with ${percent(biggest.share)} of spending`);

  assume.replaceChildren(note("",
    el("strong", { text: "What this split assumes. " }),
    `Taxes are not earmarked, so the tool divides ${state.states ? `the ${rupees(byMinistry.toUnion)} left after the States' share` : `your ${yours}`} in the same proportions as all Union spending in ${view.year}. `
    + `Taxes do not pay for all of that spending: borrowing covers ${percent(f.borrowing)} of it, non-tax revenue ${percent(f.nonTax)} and sales of assets and loans repaid ${percent(f.assets)}. `
    + "Interest on past borrowing and transfers to States are inside the total, under the Ministry of Finance."));

  /* treemap */
  const showAll = state.level === "all";
  const source = showAll ? byMinistry.rows.filter((m) => m.value != null) : inside.rows.map((d) => ({ ...d, short: d.name }));
  const split = new Map(source.map((r) => [r.name, r.amount]));
  const drawn = source.filter((r) => r.value > 0);
  const left = source.filter((r) => !(r.value > 0));
  mapTitle.textContent = showAll
    ? `How ${yours} of tax splits across the Union Budget, ${view.year} (${kind})`
    : ministry.demands.length === 0 ? `Inside ${ministry.name}: no demand for grants in the ${view.year} documents`
      : `Inside ${ministry.name}: its ${ministry.demands.length === 1 ? "one demand" : `${ministry.demands.length} demands`} for grants, ${view.year} (${kind})`;
  mapSub.textContent = showAll
    ? "Each rectangle's area is a ministry's share of spending. Click or tap one to look at it, or move with the arrow keys and press Enter."
    : "Each rectangle's area is one demand's share of the ministry. Choose one to follow it in the chart below; choose it again to go back to the whole ministry.";
  mapSub.hidden = !drawn.length; // with nothing drawn there is no rectangle to choose
  if (drawn.length) {
    mapBox.hidden = false;
    mapHover.hidden = false;
    lastMap = [drawn, split, showAll ? `Treemap of Union spending by ministry, ${view.year}` : `Treemap of the demands of ${ministry.name}, ${view.year}`];
    drawTreemap(...lastMap);
  } else {
    lastMap = null;
    mapBox.hidden = true;
    mapHover.hidden = true;
    mapSvg.replaceChildren();
    tiles = [];
  }
  const notes = [];
  if (!drawn.length) notes.push(note("warn", `${ministry.name} has no spending to draw for ${view.year}${ministry.value == null ? ": it does not appear in that year's budget documents" : ": the documents show nil"}. Choose another year or another ministry.`));
  if (left.length) notes.push(el("p", { class: "small muted", text: `Not drawn, because a rectangle cannot show nil or a negative figure: ${left.map((r) => `${r.short || r.name} (${r.value < 0 ? `${crore(r.value)}, its receipts and recoveries were larger than its spending` : "nil"})`).join("; ")}.` }));
  if (showAll) {
    const absent = view.ministries.filter((m) => m.value == null);
    if (absent.length) notes.push(el("p", { class: "small muted", text: `Not in the ${view.year} documents: ${absent.map((m) => m.name).join(", ")}.` }));
  }
  mapNote.replaceChildren(...notes);

  /* every ministry as a table */
  const wasOpen = allBox.open;
  allBox.replaceChildren(
    el("summary", { text: `Show the split as a table (${view.ministries.length} ministries)` }),
    el("div", { class: "rt-wrap" }, listTable({
      caption: `Union spending by ministry, ${view.year} (${kind}), and the share of ${yours} each receives`,
      columns: [
        { label: "Ministry", get: (m) => m.name },
        { label: "Spending", num: true, get: (m) => (m.value == null ? "not in this year's documents" : crore(m.value)) },
        { label: "Share of spending", num: true, get: (m) => (m.share == null ? "–" : percent(m.share)) },
        { label: `Of your ${yours}`, num: true, get: (m) => (m.amount == null ? "–" : rupees(m.amount)) },
      ],
      rows: byMinistry.rows,
    })));
  allBox.open = wasOpen;

  /* the chosen ministry */
  const mine = byMinistry.rows.find((m) => m.name === ministry.name);
  // replaceChildren would print the word "null" for the table of a ministry with no demand that year, so it is filtered out.
  panel.replaceChildren(...[
    el("h2", { text: ministry.value == null ? ministry.name : `${ministry.name}: ${rupees(mine.amount)} of your ${yours}` }),
    el("p", { class: "small", style: { margin: "6px 0 10px" }, text: ministry.value == null
      ? `No demand of this ministry appears in the ${view.year} documents.`
      : `${crore(ministry.value)} in ${view.year} (${kind}), which is ${percent(ministry.share)} of Union spending.`
        + (ministry.missing.length ? ` Not in that year's documents: ${ministry.missing.join(", ")}.` : "") }),
    ministry.demands.length ? el("div", { class: "rt-wrap" }, listTable({
      caption: ministry.demands.length === 1 ? "Its one demand for grants" : `Its ${ministry.demands.length} demands for grants, largest first`,
      columns: [
        { label: "Demand", get: (d) => d.name },
        { label: "Spending", num: true, get: (d) => crore(d.value) },
        { label: "Share of all spending", num: true, get: (d) => percent(d.share) },
        { label: `Of your ${yours}`, num: true, get: (d) => rupees(d.amount) },
      ],
      rows: inside.rows,
    })) : null,
    showAll ? button(`Show the inside of ${ministry.short} in the treemap`, () => { state.level = "inside"; levelSeg.value = "inside"; update(); focusMap(); }, { small: true })
      : button("Back to all ministries in the treemap", () => { state.level = "all"; levelSeg.value = "all"; state.demand = null; update(); focusMap(); }, { small: true }),
  ].filter(Boolean));

  /* ten years of one ministry or demand */
  const demandName = !showAll && state.demand && ministry.demands.some((d) => d.name === state.demand) ? state.demand : null;
  const series = shareSeries(BUDGET, ministry.name, demandName);
  const who = demandName ? `${demandName} (${ministry.short})` : ministry.name;
  const known = series.filter((p) => p.share != null);
  const firstKnown = known[0], lastKnown = known.at(-1);
  plot.update({
    title: `${who}: share of Union spending, ${BUDGET.years[0]} to ${BUDGET.years[LAST]}`,
    subtitle: `${BUDGET.years[0]} to 2024-25 are actuals. 2025-26 is a revised estimate and 2026-27 a budget estimate, drawn as a separate dashed line because they are plans, not accounts.`
      + (known.length < series.length ? ` No figure before ${firstKnown.year}: it is not in those years' documents.` : ""),
    label: `Line chart of the share of Union spending going to ${who} in each of ten years`,
    x: { type: "band", categories: BUDGET.years, label: "Financial year" },
    // Plotted in per cent so that the axis can print round ticks; three significant figures cover 37% and 0.0002% alike.
    y: { label: "Share of Union spending", zero: true, format: (v) => `${String(Number(v.toPrecision(3))).replace("-", "−")}%` },
    series: [
      { name: "Actual", type: "line", color: 0, data: series.filter((p) => p.status === "Actuals" && p.share != null).map((p) => [p.year, p.share * 100]) },
      { name: "Estimate", type: "line", color: "#8a94a3", dash: true, endLabel: percent(lastKnown.share), data: series.filter((p) => p.status !== "Actuals" && p.share != null).map((p) => [p.year, p.share * 100]) },
    ],
    // The first figure is written above its point; the last is the label at the end of the dashed line.
    marks: [{ type: "text", x: firstKnown.year, y: firstKnown.share * 100, text: percent(firstKnown.share), dy: -9, anchor: "middle" }],
  });

  /* ten years of every ministry */
  const table = changeTable(BUDGET, 0, LAST);
  const moved = table.filter((r) => r.points != null);
  const fromTo = `${BUDGET.years[0]} (${STATUS_WORDS[BUDGET.status[0]]}) to ${BUDGET.years[LAST]} (${STATUS_WORDS[BUDGET.status[LAST]]})`;
  const gainers = el("div"), losers = el("div");
  const points = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} points`;
  bars(gainers, { items: moved.slice(0, 6).map((r) => ({ label: r.short, value: r.points, title: `${r.name}: ${percent(r.from)} of spending in ${BUDGET.years[0]}, ${percent(r.to)} in ${BUDGET.years[LAST]}` })), format: points });
  bars(losers, { items: moved.slice(-6).reverse().map((r) => ({ label: r.short, value: r.points, color: "#eb6834", title: `${r.name}: ${percent(r.from)} of spending in ${BUDGET.years[0]}, ${percent(r.to)} in ${BUDGET.years[LAST]}` })), format: points });
  const wasOpen2 = changeBox.querySelector("details")?.open;
  const more = el("details", { class: "chart-table" },
    el("summary", { text: `Show ten years of change for all ${table.length} ministries` }),
    el("div", { class: "rt-wrap" }, listTable({
      caption: `Share of Union spending, ${fromTo}. Rupee figures are not adjusted for inflation.`,
      columns: [
        { label: "Ministry", get: (r) => r.name },
        { label: `Share in ${BUDGET.years[0]}`, num: true, get: (r) => (r.from == null ? "not in the documents" : percent(r.from)) },
        { label: `Share in ${BUDGET.years[LAST]}`, num: true, get: (r) => percent(r.to) },
        { label: "Change in share", num: true, get: (r) => (r.points == null ? "–" : points(r.points)) },
        { label: "Spending in rupees", num: true, get: (r) => (r.multiple == null ? "–" : `${r.multiple.toFixed(2)} times ${BUDGET.years[0]}`) },
      ],
      rows: table,
    })));
  more.open = Boolean(wasOpen2);
  changeBox.replaceChildren(
    el("h2", { text: `Ten years of change, ${fromTo}` }),
    el("p", { class: "small muted", text: `Total spending in rupees is ${(BUDGET.total[LAST] / BUDGET.total[0]).toFixed(2)} times what it was, before allowing for inflation, so the fair comparison is each ministry's share of the total. A point is one percentage point of all Union spending. This comparison sets an actual against a budget estimate, and it does not change with the year chosen above.` }),
    el("div", { class: "grid2" },
      el("div", {}, el("h3", { text: "Gained most share" }), gainers),
      el("div", {}, el("h3", { text: "Lost most share" }), losers)),
    more);

  say(`${yours} of tax, ${view.year}, ${kind}. ${state.states ? `${rupees(byMinistry.toStates)} is set aside as the States' share. ` : ""}`
    + `${byMinistry.rows.slice(0, 3).map((m) => `${m.short} ${rupees(m.amount)}`).join(", ")}. The largest single demand is ${top.name} at ${rupees(topAmount)}. Borrowing pays for ${percent(f.borrowing)} of the year's spending.`);
}

update();
