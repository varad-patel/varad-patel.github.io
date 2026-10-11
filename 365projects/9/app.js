// Day 9: What Makes a Good Life? Index. Interface.
import { $, el, fmt, mount, slider, select, segmented, button, stat, note, table, bars, chart } from "../kit/kit.js";
import { WELLBEING } from "../data/wellbeing.js";
import { DIMENSIONS, KEYS, countryRows, normalise, shares, rank, rankBy, rankRange, movers, spearman } from "./logic.js";

mount();

const YEAR = WELLBEING.years.at(-1);
const rows = countryRows(WELLBEING, YEAR);
const byIncome = rankBy(rows, (r) => r.gdp);
const byLadder = rankBy(rows, (r) => r.ladder);
const incomeLadderRho = spearman(rows.map((r) => r.gdp), rows.map((r) => r.ladder));
const MAIN = ["health", "freedom", "income", "community"];
const PRESETS = [
  { label: "Four equal parts", w: { health: 5, freedom: 5, income: 5, community: 5, generosity: 0, integrity: 0 } },
  { label: "Income only", w: { health: 0, freedom: 0, income: 10, community: 0, generosity: 0, integrity: 0 } },
  { label: "Health and income", w: { health: 5, freedom: 0, income: 5, community: 0, generosity: 0, integrity: 0 } },
  { label: "Freedom and community", w: { health: 0, freedom: 5, income: 0, community: 5, generosity: 0, integrity: 0 } },
  { label: "All six equal", w: { health: 5, freedom: 5, income: 5, community: 5, generosity: 5, integrity: 5 } },
];

const state = { weights: { ...PRESETS[0].w }, method: "minmax", aggregate: "arithmetic", selected: "India", showAll: false };
let scored = normalise(rows, state.method);
let ranges = null; // computed lazily: it does not depend on the visitor's weights

/* ---------- controls ---------- */
const sliders = DIMENSIONS.map((d) => slider({
  label: d.label, min: 0, max: 10, step: 1, value: state.weights[d.key], hint: d.measure,
  format: () => "", onInput: (v) => { state.weights[d.key] = v; update(); },
}));
// Moving one slider changes all six shares. Each readout is spoken as its own slider's value (aria-valuetext, set in
// update), so the readouts themselves stay quiet: six announcements for one key press help nobody.
for (const s of sliders) s.el.querySelector("output").setAttribute("aria-live", "off");
const presetRow = el("div", { class: "row" }, PRESETS.map((p) => button(p.label, () => {
  state.weights = { ...p.w };
  sliders.forEach((s, i) => { s.value = state.weights[KEYS[i]]; });
  update();
}, { small: true })));
const methodSeg = segmented({
  label: "Put the measures on one scale by", value: "minmax",
  options: [{ value: "minmax", label: "Distance" }, { value: "rank", label: "Rank" }],
  hint: "Distance: worst country 0, best 100, the rest in proportion. Rank: only the order counts.",
  onChange: (v) => { state.method = v; scored = normalise(rows, v); ranges = null; update(); },
});
const aggSeg = segmented({
  label: "Combine them by", value: "arithmetic",
  options: [{ value: "arithmetic", label: "Averaging" }, { value: "geometric", label: "Multiplying" }],
  hint: "Averaging lets strength in one area make up for weakness in another. Multiplying (a geometric mean) punishes any weak area.",
  onChange: (v) => { state.aggregate = v; ranges = null; update(); },
});
const pick = select({
  label: "Look at one country", value: state.selected,
  options: rows.map((r) => r.name).sort((a, b) => a.localeCompare(b)),
  onChange: (v) => { state.selected = v; update(); },
});

/* ---------- outputs ---------- */
const sTop = stat("Best place to live, on your terms");
const sRho = stat("Agreement with how people rate their own lives");
const sMoved = stat("Countries 10 or more places from their income rank");
const message = el("div", { role: "status" });
const rankBox = el("div");
const tableBox = el("div");
const moreBtn = button("Show every country", () => { state.showAll = !state.showAll; update(); }, { small: true });
const moversBox = el("div", { class: "grid2" });
// The card for the selected country is built once and its parts updated, so that its opening line can be a live
// region that is announced when the country or its rank changes.
const cardTitle = el("h3");
const cardLead = el("p", { class: "small", role: "status", style: { margin: "8px 0 12px" } });
const profile = el("div");
const cardRange = el("p", { class: "small", style: { marginTop: "12px" } });
const cardBox = el("div", { class: "panel" }, cardTitle, cardLead, el("p", { class: "small muted", style: { marginBottom: "6px" }, text: "Score out of 100 on each measure:" }), profile, cardRange);
const profileBars = bars(profile, { items: [], max: 100, format: fmt.int });
const chartBox = el("div");
const rankBars = bars(rankBox, { items: [], max: 100, format: (v) => fmt.num(v, 1) });
const plot = chart(chartBox, { series: [], height: 320 });

$("#app").append(el("div", { class: "tool-grid wide-controls" },
  el("div", { class: "controls" },
    el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "How much does each matter to you?" })), el("div", { class: "hint", text: "Slide from 0 (does not count) to 10. Only the proportions matter." })),
    sliders.map((s) => s.el),
    el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Or start from" })), presetRow),
    methodSeg.el, aggSeg.el, pick.el),
  el("div", { class: "out" },
    el("div", { class: "stats", role: "status" }, sTop.el, sRho.el, sMoved.el),
    message,
    el("div", {}, el("p", { class: "chart-title", text: `Your ranking of ${rows.length} countries, ${YEAR - 2} to ${YEAR}` }), rankBox, el("div", { class: "row", style: { marginTop: "12px" } }, moreBtn), tableBox),
    cardBox, moversBox, chartBox)));

// Results sit in live regions, so they are only rewritten when they change.
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setStat = (s, value, text) => { if (s.el.textContent !== s.el.firstChild.textContent + value + text) s.set(value, text); };
const ordinal = (n) => `${fmt.int(n)}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

function update() {
  const w = shares(state.weights);
  // Each slider shows its share of the total.
  sliders.forEach((s, i) => {
    const share = w ? fmt.pct(w[KEYS[i]], 0) : "0%";
    s.el.querySelector("output").textContent = share;
    s.input.setAttribute("aria-valuetext", `${s.value} out of 10, ${share} of the total weight`);
  });

  if (!w) {
    message.replaceChildren(note("warn", "Every weight is zero, so there is nothing to rank by. Give at least one measure some weight."));
    for (const s of [sTop, sRho, sMoved]) setStat(s, "–", "");
    rankBars.update([]);
    tableBox.replaceChildren(); moversBox.replaceChildren();
    moreBtn.hidden = cardBox.hidden = true;
    plot.update({ series: [], marks: [], empty: "Nothing to plot yet" });
    return;
  }
  message.replaceChildren();
  moreBtn.hidden = cardBox.hidden = false;

  const ranking = rank(scored, state.weights, state.aggregate);
  const rho = spearman(ranking.map((r) => r.index), ranking.map((r) => r.ladder));
  const moved = ranking.filter((r) => Math.abs(byIncome[r.name] - r.rank) >= 10).length;
  setStat(sTop, ranking[0].name, `then ${ranking[1].name} and ${ranking[2].name}`);
  setStat(sRho, fmt.num(rho, 2), `rank correlation; income alone scores ${fmt.num(incomeLadderRho, 2)}`);
  setStat(sMoved, `${moved} of ${rows.length}`, moved === 0 ? "none has moved that far from the income ranking" : "your values reorder the world this much");

  const sel = ranking.find((r) => r.name === state.selected);
  const top = ranking.slice(0, 12);
  const list = top.some((r) => r.name === sel.name) ? top : [...top.slice(0, 11), sel];
  rankBars.update(list.map((r) => ({ label: `${r.rank}. ${r.name}`, value: r.index, highlight: r.name === sel.name })));

  moreBtn.textContent = state.showAll ? "Hide the full table" : "Show every country";
  const all = state.showAll ? table({
    caption: `All ${rows.length} countries by your index`,
    columns: [
      { key: "rank", label: "Rank", num: true }, { key: "name", label: "Country" },
      { key: "index", label: "Index", num: true, format: (v) => fmt.num(v, 1) },
      ...DIMENSIONS.filter((d) => w[d.key] > 0).map((d) => ({ key: d.key, label: d.label, num: true, format: (_, r) => fmt.int(r.scores[d.key]) })),
      { key: "inc", label: "By income", num: true, format: (_, r) => byIncome[r.name] },
      { key: "own", label: "By own rating", num: true, format: (_, r) => byLadder[r.name] },
    ],
    rows: ranking,
  }) : null;
  all?.classList.add("all");
  tableBox.replaceChildren(...(all ? [el("p", { class: "small muted", style: { margin: "12px 0 0" }, text: "Each measure you count is shown as its score out of 100. The last two columns are the country's rank by income and by how its people rate their own lives." }), all] : []));

  // The selected country.
  if (!ranges) ranges = rankRange(scored, MAIN, { samples: 1000, seed: 9, aggregate: state.aggregate });
  const range = ranges.get(sel.name);
  setText(cardTitle, sel.name);
  setText(cardLead, `${sel.name}: ${ordinal(sel.rank)} of ${rows.length} on your index. ${ordinal(byIncome[sel.name])} by income per person ($${fmt.int(sel.gdp)}) and ${ordinal(byLadder[sel.name])} by how its own people rate their lives (${fmt.num(sel.ladder, 2)} out of 10).`);
  profileBars.update(DIMENSIONS.map((d) => ({ label: `${d.label}${w[d.key] > 0 ? "" : " (not counted)"}`, value: sel.scores[d.key], highlight: w[d.key] > 0 })));
  // No country name as the subject, so the sentence reads correctly for "United States" and "Netherlands" too.
  setText(cardRange, range.best === range.worst
    ? `However health, freedom, income and community are weighted, its rank stays ${ordinal(range.best)}.`
    : `Its rank runs from ${ordinal(range.best)} to ${ordinal(range.worst)} across 1,000 random ways of weighting health, freedom, income and community, together with the four that count one of them alone. In nine of every ten random weightings it lies between ${ordinal(range.lo)} and ${ordinal(range.hi)}.${range.worst - range.best > 60 ? " Its place depends heavily on what you think matters." : range.worst - range.best < 20 ? " Its place hardly depends on the weights." : ""}`);

  // Movers against the income ranking.
  const m = movers(ranking, byIncome, 5);
  const moverTable = (caption, list) => table({
    caption,
    columns: [{ key: "name", label: "Country" }, { key: "was", label: "By income", num: true }, { key: "rank", label: "Yours", num: true }, { key: "change", label: "Places", num: true, format: (v) => fmt.signed(v, 0) }],
    rows: list,
  });
  // Only countries that actually moved: with all the weight on income nobody does.
  const up = m.up.filter((r) => r.change > 0), down = m.down.filter((r) => r.change < 0);
  moversBox.replaceChildren(...(up.length || down.length
    ? [up.length ? moverTable("Rise most when your values replace income", up) : null, down.length ? moverTable("Fall most", down) : null].filter(Boolean)
    : [note("", "No country changes place: with these weights your ranking is the income ranking.")]));

  plot.update({
    title: "Does your index match how people rate their own lives?",
    subtitle: "Each dot is a country. A tight diagonal cloud means your values predict reported life satisfaction.",
    hover: "point",
    x: { label: "Your index (0 to 100)", format: (v) => fmt.num(v, 0) },
    y: { label: "Life evaluation, people's own rating (0 to 10)", format: (v) => fmt.num(v, 1) },
    series: [{ name: "Countries", type: "scatter", data: ranking.map((r) => ({ x: r.index, y: r.ladder, label: r.name })), color: 0, r: 4 }],
    marks: [{ type: "point", x: sel.index, y: sel.ladder, text: sel.name }],
    onClick: ({ point }) => { if (point) { state.selected = point.label; pick.value = point.label; update(); } },
  });
}

update();
