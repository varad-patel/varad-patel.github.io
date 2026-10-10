// Day 8: Hedonic Treadmill Simulator. Interface.
import { $, el, fmt, mount, slider, select, button, stat, note, chart, stats } from "../kit/kit.js";
import { WELLBEING } from "../data/wellbeing.js";
import { incomePath, simulate, halfLife, countrySeries, countriesWithSeries, crossSection, predict, fitCountry, changes } from "./logic.js";

mount();

const LAST = WELLBEING.years.at(-1);
const cross = crossSection(WELLBEING, LAST);
const B = cross.b; // happiness points per unit of log income, from the cross-section of countries
const names = countriesWithSeries(WELLBEING, 8);
const GREY = "#8a94a3";
const INK = "#16233b";
const year = (v) => String(Math.round(v));
const money = (v) => `$${fmt.int(v)}`;

const PATHS = {
  raise: { label: "A one-off raise that lasts", change: 50, changeYear: 5, lasts: 0, growth: 0 },
  windfall: { label: "A windfall for three years", change: 50, changeYear: 5, lasts: 3, growth: 0 },
  growth: { label: "Steady growth, no jumps", change: 0, changeYear: 5, lasts: 0, growth: 3 },
  cut: { label: "A pay cut that lasts", change: -30, changeYear: 5, lasts: 0, growth: 0 },
  stall: { label: "Growth, then a lasting fall", change: -25, changeYear: 15, lasts: 0, growth: 4 },
};
const state = { path: "raise", change: 50, changeYear: 5, lasts: 0, growth: 0, alpha: 0.3, k: 0.8, country: "India", from: 2011 };

/* ---------- controls ---------- */
const pathSelect = select({
  label: "Income path", value: "raise", options: Object.entries(PATHS).map(([value, p]) => ({ value, label: p.label })),
  onChange: (v) => {
    const p = PATHS[v];
    Object.assign(state, { path: v, change: p.change, changeYear: p.changeYear, lasts: p.lasts, growth: p.growth });
    changeSlider.value = p.change; yearSlider.value = p.changeYear; lastsSlider.value = p.lasts; growthSlider.value = p.growth;
    update();
  },
});
const changeSlider = slider({ label: "Size of the jump", min: -60, max: 100, step: 5, value: 50, format: (v) => `${fmt.signed(v, 0)}%`, onInput: (v) => { state.change = v; update(); } });
const yearSlider = slider({ label: "It happens in year", min: 1, max: 25, step: 1, value: 5, format: fmt.int, onInput: (v) => { state.changeYear = v; update(); } });
const lastsSlider = slider({ label: "It lasts", min: 0, max: 15, step: 1, value: 0, format: (v) => (v === 0 ? "for good" : `${v} year${v === 1 ? "" : "s"}`), onInput: (v) => { state.lasts = v; update(); } });
const growthSlider = slider({ label: "Steady yearly growth", min: -2, max: 8, step: 0.5, value: 0, format: (v) => `${fmt.signed(v, 1)}%`, onInput: (v) => { state.growth = v; update(); } });
const kSlider = slider({
  label: "How much of a gain you get used to", min: 0, max: 100, step: 5, value: 80, format: (v) => `${v}%`,
  hint: "0%: money keeps its effect for ever. 100%: a complete treadmill, where only changes are felt.",
  onInput: (v) => { state.k = v / 100; update(); },
});
const alphaSlider = slider({
  label: "How fast you get used to it", min: 0.05, max: 1, step: 0.05, value: 0.3,
  format: (v) => `half in ${fmt.num(halfLife(v), 1)} yr`,
  hint: "The share of the gap between your income and what you are used to that closes each year.",
  onInput: (v) => { state.alpha = v; update(); },
});
const countrySelect = select({ label: "Country to test against", value: state.country, options: names, onChange: (v) => { state.country = v; update(); } });
const fromSelect = select({
  label: "Compare all countries since", value: "2011",
  options: [2011, 2015, 2019].map((y) => ({ value: y, label: `${y - 2} to ${y}` })),
  onChange: (v) => { state.from = Number(v); update(); },
});

/* ---------- outputs ---------- */
const sFirst = stat("Lift when the change arrives");
const sLater = stat("Lift ten years later");
const sKept = stat("Kept in the long run");
const incomeBox = el("div");
const happyBox = el("div");
const fitNote = el("div");
const countryBox = el("div");
const panelNote = el("div");
const panelBox = el("div");
const incomeChart = chart(incomeBox, { series: [], height: 190, table: false });
const happyChart = chart(happyBox, { series: [], height: 260 });
const countryChart = chart(countryBox, { series: [], height: 300 });
const panelChart = chart(panelBox, { series: [], height: 340 });

const fitButton = button("Find the best-fitting settings", () => {
  const f = fitCountry(countrySeries(WELLBEING, state.country), B);
  state.k = f.k; state.alpha = f.alpha;
  kSlider.value = Math.round(f.k * 100); alphaSlider.value = f.alpha;
  update();
});

$("#app").append(
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" },
      pathSelect.el, changeSlider.el, yearSlider.el, lastsSlider.el, growthSlider.el,
      el("hr", { style: { border: 0, borderTop: "1px solid var(--rule)", width: "100%", margin: "4px 0" } }),
      kSlider.el, alphaSlider.el),
    el("div", { class: "out" },
      el("h2", { text: "1. What the treadmill predicts" }),
      el("div", { class: "stats" }, sFirst.el, sLater.el, sKept.el),
      incomeBox, happyBox)),
  el("div", { class: "out block2" },
    el("h2", { text: "2. Test your settings on a real country" }),
    el("p", { class: "small muted", text: "The model is fed the country's actual income per person and uses the two adaptation settings above. The grey line is the same model with no adaptation at all." }),
    el("div", { class: "row", style: { alignItems: "flex-end" } }, el("div", { style: { flex: "1 1 220px", maxWidth: "320px" } }, countrySelect.el), fitButton),
    countryBox, fitNote),
  el("div", { class: "out block2" },
    el("h2", { text: "3. Does the treadmill show up across countries?" }),
    el("p", { class: "small muted", text: "If people fully adapted to national income, countries that grew faster would not end up any more satisfied. Each dot is a country: how much its income changed, and how much its life evaluation changed." }),
    el("div", { style: { maxWidth: "320px" } }, fromSelect.el),
    panelBox, panelNote));

function update() {
  /* ----- 1: simulation ----- */
  const incomes = incomePath({ years: 31, start: 20000, growth: state.growth / 100, change: state.change / 100, changeYear: state.changeYear, lasts: state.lasts });
  const sim = simulate(incomes, { alpha: state.alpha, k: state.k, b: B, base: 5.5 });
  const t0 = state.changeYear;
  const before = sim.happiness[t0 - 1];
  const later = Math.min(30, t0 + 10);
  const hasJump = state.change !== 0;
  sFirst.set(hasJump ? `${fmt.signed(sim.happiness[t0] - before, 2)} points` : "–", hasJump ? `in year ${t0}, on a 0 to 10 scale` : "no jump in this path");
  sLater.set(hasJump ? `${fmt.signed(sim.happiness[later] - before, 2)} points` : `${fmt.signed(sim.happiness[30] - sim.happiness[0], 2)} points`,
    hasJump ? `in year ${later}; without adaptation ${fmt.signed(sim.noAdaptation[later] - sim.noAdaptation[t0 - 1], 2)}` : `after 30 years of growth; without adaptation ${fmt.signed(sim.noAdaptation[30] - 5.5, 2)}`);
  sKept.set(fmt.pct(1 - state.k, 0), `of any lasting gain. Half the adjustment takes ${fmt.num(halfLife(state.alpha), 1)} years`);

  incomeChart.update({
    title: "Income, and the income you have got used to",
    x: { label: "Year", format: year }, y: { format: (v) => fmt.compact(v), zero: true },
    series: [
      { name: "Income", data: incomes.map((v, i) => [i, v]), color: INK },
      { name: "What you are used to", data: sim.reference.map((v, i) => [i, v]), color: GREY, dash: true },
    ],
  });
  happyChart.update({
    title: "Predicted happiness",
    subtitle: "The gap between the lines is what adaptation takes away.",
    x: { label: "Year", format: year },
    y: { label: "Life evaluation (0 to 10)", format: (v) => fmt.num(v, 1) },
    series: [
      { name: "With adaptation", data: sim.happiness.map((v, i) => [i, v]), color: 0, endLabel: "With adaptation" },
      { name: "No adaptation", data: sim.noAdaptation.map((v, i) => [i, v]), color: GREY, dash: true, endLabel: "No adaptation" },
    ],
  });

  /* ----- 2: one country ----- */
  const series = countrySeries(WELLBEING, state.country);
  const mine = predict(series, { alpha: state.alpha, k: state.k, b: B });
  const none = predict(series, { alpha: 0.5, k: 0, b: B });
  const best = fitCountry(series, B);
  countryChart.update({
    title: `${state.country}: reported life evaluation and the model`,
    subtitle: `Income per person went from ${money(series[0].gdp)} to ${money(series.at(-1).gdp)}. Years are the last of each three-year survey average.`,
    x: { label: "Year", format: year },
    y: { label: "Life evaluation (0 to 10)", format: (v) => fmt.num(v, 1) },
    series: [
      { name: "Survey's 95% interval", type: "range", data: series.filter((p) => p.lo != null).map((p) => [p.year, p.lo, p.hi]), color: INK, opacity: 0.1 },
      { name: "Reported", data: series.map((p) => [p.year, p.ladder]), color: INK, width: 2.5 },
      { name: "Model with your settings", data: series.map((p, i) => [p.year, mine.fitted[i]]), color: 0 },
      { name: "Model with no adaptation", data: series.map((p, i) => [p.year, none.fitted[i]]), color: GREY, dash: true },
    ],
  });
  const beatsFlat = best.rmse < best.rmseFlat * 0.9;
  fitNote.replaceChildren(note(beatsFlat ? "" : "warn",
    el("strong", { text: `Typical miss with your settings: ${fmt.num(mine.rmse, 2)} points. ` }),
    `No adaptation misses by ${fmt.num(none.rmse, 2)}, the best-fitting settings (${fmt.pct(best.k, 0)} adaptation, half in ${fmt.num(halfLife(best.alpha), 1)} years) by ${fmt.num(best.rmse, 2)}, and a flat line through the average by ${fmt.num(best.rmseFlat, 2)}. `,
    beatsFlat
      ? `${fmt.pct(best.nearlyAsGood, 0)} of all the settings tried fit within a tenth of the best, so the data only loosely pins them down.`
      : `Here no setting does clearly better than a flat line: income, with or without adaptation, does not explain how ${state.country}'s life evaluation moved over these years.`));

  /* ----- 3: all countries ----- */
  const ch = changes(WELLBEING, state.from, LAST);
  const xs = ch.rows.map((r) => r.dIncome);
  const lo = stats.min(xs), hi = stats.max(xs);
  const sel = ch.rows.find((r) => r.name === state.country);
  panelChart.update({
    title: `Change in income and in life evaluation, ${state.from - 2}-${state.from} to ${LAST - 2}-${LAST}`,
    hover: "point",
    x: { label: "Change in income per person (doublings; +1 is a doubling)", format: (v) => fmt.signed(v, 1) },
    y: { label: "Change in life evaluation (points)", format: (v) => fmt.signed(v, 1) },
    series: [
      { name: "Fitted across countries", type: "line", data: [[lo, ch.intercept + ch.slope * lo], [hi, ch.intercept + ch.slope * hi]], color: INK, hover: false },
      { name: "A complete treadmill would look like this", type: "line", data: [[lo, ch.intercept], [hi, ch.intercept]], color: GREY, dash: true, hover: false },
      { name: "Countries", type: "scatter", data: ch.rows.map((r) => ({ x: r.dIncome, y: r.dLadder, label: r.name })), color: 0, r: 4 },
    ],
    marks: sel ? [{ type: "point", x: sel.dIncome, y: sel.dLadder, text: sel.name }] : [],
    onClick: ({ point }) => { if (point && names.includes(point.label)) { state.country = point.label; countrySelect.value = point.label; update(); } },
  });
  const ci = 1.96 * ch.se;
  panelNote.replaceChildren(note(ch.slope - ci > 0 ? "" : "warn",
    el("strong", { text: `${fmt.signed(ch.slope, 2)} points per doubling of income (± ${fmt.num(ci, 2)}), across ${ch.n} countries. ` }),
    ch.slope - ci > 0
      ? `Countries that grew faster did end up more satisfied, which is not what a complete treadmill predicts. For comparison, rich and poor countries at one moment differ by ${fmt.num(cross.perDoubling, 2)} points per doubling. `
      : `Over this period the link between growth and rising life evaluation is too weak to tell from zero. `,
    `But growth explains only ${fmt.pct(ch.r2, 0)} of the differences between countries' changes${sel ? `, and ${sel.name} ${sel.dLadder >= 0 ? "gained" : "lost"} ${fmt.num(Math.abs(sel.dLadder), 2)} points while its income ${sel.dIncome >= 0 ? "rose" : "fell"} by ${fmt.pct(Math.abs(2 ** sel.dIncome - 1), 0)}` : ""}.`));
}

update();
