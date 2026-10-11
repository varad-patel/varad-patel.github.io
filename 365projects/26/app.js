// Day 26: Nature versus Nurture Simulator. Interface.
import { $, el, fmt, mount, slider, numberField, button, stat, note, table, chart, palette, stats, randomSeed } from "../kit/kit.js";
import { MEAN, RGE_MAX, DEFAULTS, theory, simulate, twinStudy, heritabilityCurve, twoSoils } from "./logic.js";

mount();

const PARTS = [
  { key: "genes", label: "Genes", color: palette[0] },
  { key: "shared", label: "Shared environment", color: palette[1] },
  { key: "unique", label: "Non-shared environment", color: palette[3] },
  { key: "interaction", label: "Genes and environment interacting", color: palette[6] },
  { key: "covariance", label: "Genes and environment moving together", color: "#8a94a3" },
];
const PRESETS = [
  { label: "Textbook mix", set: { va: 50, vc: 20, ve: 30, vi: 0, rge: 0 } },
  { label: "Nearly equal environments", set: { va: 50, vc: 0, ve: 5, vi: 0, rge: 0 } },
  { label: "Very unequal environments", set: { va: 50, vc: 100, ve: 100, vi: 0, rge: 0 } },
  { label: "Genes and environment interact", set: { va: 50, vc: 20, ve: 30, vi: 30, rge: 0 } },
  { label: "Family environment follows genes", set: { va: 50, vc: 20, ve: 30, vi: 0, rge: 0.5 } },
];
const state = { ...DEFAULTS };
const soil = { h2: 0.9, gap: 15, share: 0 };
const two = (v) => fmt.num(v, 2);

/* ---------- controls ---------- */
const vary = (key, label, max, hint, step = 1, format = fmt.int) =>
  slider({ label, min: 0, max, step, value: state[key], format, hint, onInput: (v) => { state[key] = v; update(); } });
const sliders = {
  va: vary("va", "Genetic variance", 100, "How much people differ in the genetic push on the trait."),
  vc: vary("vc", "Shared environment", 100, "What a family has in common: home, neighbourhood, schooling."),
  ve: vary("ve", "Non-shared environment", 200, "Everything that differs even between twins raised together, including chance."),
  vi: vary("vi", "Gene-environment interaction", 100, "How much the effect of someone's genes depends on the family environment."),
  rge: vary("rge", "Gene-environment correlation", RGE_MAX, "How closely the family environment follows the parents' genes.", 0.05, two),
  pairs: vary("pairs", "Twin pairs of each kind", 5000, null, 50),
};
sliders.pairs.input.min = 50;
const seedField = numberField({ label: "Seed", min: 0, max: 999999, step: 1, value: state.seed, hint: "The same seed always gives the same population." });
const seedNote = el("div");
seedField.input.addEventListener("input", () => {
  const v = seedField.value;
  if (!Number.isInteger(v)) { seedNote.replaceChildren(note("bad", "The seed must be a whole number from 0 to 999,999.")); return; }
  seedNote.replaceChildren();
  state.seed = v;
  update();
});

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Start from" })),
    el("div", { class: "row" }, PRESETS.map((p) => button(p.label, () => {
      Object.assign(state, p.set);
      for (const key of Object.keys(p.set)) sliders[key].value = p.set[key];
      update();
    }, { small: true })))),
  Object.values(sliders).map((s) => s.el), seedField.el, seedNote,
  el("div", { class: "row" }, button("New population", () => { state.seed = randomSeed() % 1000000; seedField.value = state.seed; seedNote.replaceChildren(); update(); }, { primary: true, small: true })));

/* ---------- outputs ---------- */
const sTrue = stat("True heritability");
const sEst = stat("Twin-study estimate");
const sMZ = stat("Identical twins");
const sDZ = stat("Fraternal twins");
const message = el("div", { class: "stack", role: "status" });
const splitBox = el("div");
const histBox = el("div"), mzBox = el("div"), dzBox = el("div"), curveBox = el("div"), peopleBox = el("div", { class: "stack" });
const body = el("div", { class: "out" }, splitBox, histBox, el("div", { class: "grid2" }, mzBox, dzBox), curveBox, peopleBox);
const caveat = el("p", { class: "small muted" }, el("strong", { text: "Everything here is simulated. " }),
  "Each variance is a setting you choose, not a measurement. Nothing on this page describes a real trait, a real person or a real group of people.");
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sTrue.el, sEst.el, sMZ.el, sDZ.el), caveat, message, body);

const soilSliders = [
  slider({ label: "Heritability inside each field", min: 0.1, max: 1, step: 0.05, value: soil.h2, format: two, hint: "The share of the differences in height inside one field that goes with differences in the seed.", onInput: (v) => { soil.h2 = v; drawSoil(); } }),
  slider({ label: "Gap between the field averages", min: 0, max: 30, step: 1, value: soil.gap, format: (v) => `${v} units`, onInput: (v) => { soil.gap = v; drawSoil(); } }),
  slider({ label: "Share of the gap that comes from the seed", min: 0, max: 1, step: 0.05, value: soil.share, format: (v) => fmt.pct(v, 0), hint: "0% is Lewontin's case: the same seed in both fields, and the whole gap is soil.", onInput: (v) => { soil.share = v; drawSoil(); } }),
];
const soilTiles = [stat("Heritability, rich soil"), stat("Heritability, poor soil"), stat("Gap between the averages"), stat("Of that gap, from the seed")];
const soilBox = el("div"), soilNote = el("div", { role: "status" });
const soilPanel = el("div", { class: "soil" },
  el("h3", { text: "Two fields: a gap between groups is a separate question" }),
  el("p", { class: "small", text: "Seed is sown in two fields, one with rich soil and one with poor. Inside each field every plant gets the same soil, so nearly all the differences in height between neighbours come from their seed, and heritability inside each field is high. What does that say about why one field is taller than the other?" }),
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" }, soilSliders.map((s) => s.el)),
    el("div", { class: "out" }, el("div", { class: "stats" }, soilTiles.map((t) => t.el)), soilBox, soilNote)));

$("#app").append(el("div", { class: "tool-grid" }, controls, out), soilPanel);

const hist = chart(histBox, { series: [], height: 220 });
const mzChart = chart(mzBox, { series: [], height: 260 });
const dzChart = chart(dzBox, { series: [], height: 260 });
const curveChart = chart(curveBox, { series: [], height: 240 });
const soilChart = chart(soilBox, { series: [], height: 250 });

/* ---------- the population and its twin study ---------- */
function drawSplit(t) {
  const parts = PARTS.map((p) => ({ ...p, value: t.components[p.key] })).filter((p) => p.value > 1e-9);
  const text = (p) => `${p.label}: ${fmt.pct(p.value / t.vp, 0)}`;
  splitBox.replaceChildren(
    el("p", { class: "chart-title", text: "Where the variation in the trait comes from" }),
    el("div", { class: "split-bar", role: "img", "aria-label": parts.map(text).join(", ") },
      parts.map((p) => el("span", { style: { width: `${(p.value / t.vp) * 100}%`, background: p.color }, title: text(p) }))),
    el("div", { class: "chart-legend" }, parts.map((p) => el("span", {}, el("i", { style: { background: p.color } }), `${p.label} `, el("strong", { text: fmt.pct(p.value / t.vp, 0) })))),
    el("p", { class: "small muted", text: `Total variance ${fmt.num(t.vp, 1)}, worked out from the settings. Heritability is the share labelled Genes and nothing else.` }));
}

function update() {
  const sim = simulate(state);
  if (sim.error) {
    message.replaceChildren(note("bad", sim.error));
    for (const s of [sTrue, sEst, sMZ, sDZ]) s.set("–", "");
    body.hidden = true;
    return;
  }
  body.hidden = false;
  const t = theory(state), est = twinStudy(sim);
  const n = state.pairs;

  sTrue.set(two(t.h2), `genetic variance ${fmt.int(state.va)} out of ${fmt.num(t.vp, 1)}`);
  sEst.set(two(est.h2), `95% interval ${two(est.lo)} to ${two(est.hi)}`);
  sMZ.set(`r = ${two(est.rMZ)}`, `expected ${two(t.rMZ)}`);
  sDZ.set(`r = ${two(est.rDZ)}`, `expected ${two(t.rDZ)}`);

  const lines = [`In this simulated population, differences in genes account for ${fmt.pct(t.h2, 0)} of the variation. A study of ${fmt.int(n)} identical and ${fmt.int(n)} fraternal pairs, seeing only the trait, estimates 2 × (${two(est.rMZ)} − ${two(est.rDZ)}) = ${two(est.h2)}.`];
  if (est.h2 < 0 || est.h2 > 1) lines.push("An estimate outside 0 to 1 is sampling error, which is common in small twin studies. Add more pairs.");
  else if (est.lo < 0 || est.hi > 1) lines.push("The interval is a rough one, the estimate plus or minus 1.96 standard errors, so it can run below 0 or above 1 although a share of variance cannot.");
  const notes = [note("", lines.join(" "))];
  // Of the interaction variance vi (1 + rge^2), fraternal twins share vi (1/2 + rge^2): half of it when rge is 0.
  const dzShare = (0.5 + state.rge ** 2) / (1 + state.rge ** 2);
  if (Math.abs(t.falconer - t.h2) > 0.005) notes.push(note("warn", `With unlimited twins the estimate would settle on ${two(t.falconer)}, not the true ${two(t.h2)}. Identical twins share the interaction in full and fraternal twins share ${state.rge > 0 ? fmt.pct(dzShare, 0) : "half"} of it, ${state.rge > 0 ? "close to" : "which is"} the pattern genes show, so the twin method counts ${state.rge > 0 ? "most of it" : "it"} as genetic.`));
  if (state.rge > 0 && state.va > 0 && state.vc > 0) notes.push(note("warn", `${fmt.pct(t.components.covariance / t.vp, 0)} of the variation comes from genes and family environment moving together. It is neither one nor the other. Both kinds of twin share it equally, so the twin method files it under shared environment${state.vi > 0 ? `, along with the part of the interaction that both kinds of twin share equally (${fmt.pct((state.vi * state.rge ** 2) / t.vp, 0)} of the variation)` : ""}. With unlimited twins its estimate of the shared-environment share would settle on ${two(t.c2)}, against a true ${two(state.vc / t.vp)}. This study's estimate is ${two(est.c2)}.`));
  message.replaceChildren(...notes);
  drawSplit(t);

  // The trait.
  const sd = Math.sqrt(t.vp), lo = MEAN - 4 * sd, hi = MEAN + 4 * sd;
  const everyone = [sim.mz.a, sim.mz.b, sim.dz.a, sim.dz.b].flatMap((a) => [...a]);
  hist.update({
    title: "The trait in the simulated population", subtitle: `${fmt.int(everyone.length)} people. Mean ${fmt.num(sim.realised.mean, 1)}, standard deviation ${fmt.num(Math.sqrt(sim.realised.vp), 1)}.`,
    label: "Histogram of trait values", x: { label: "Trait value", domain: [lo, hi] }, y: { label: "People" }, marks: [],
    series: [{ name: "People", type: "hist", color: "#8a94a3", data: stats.histogram(everyone, { bins: 40, min: lo, max: hi }).map((b) => [b.x0, b.x1, b.count]) }],
  });

  // The twins.
  const shown = Math.min(n, 400);
  const pairs = (kind) => Array.from({ length: shown }, (_, i) => [kind.a[i], kind.b[i]]);
  const twins = (c, kind, name, r, color, sub) => c.update({
    title: `${name} twins: r = ${two(r)}`, subtitle: `${sub}${shown < n ? ` The first ${shown} of ${fmt.int(n)} pairs are drawn.` : ""}`,
    label: `Scatter plot of ${name.toLowerCase()} twin pairs`, hover: "point", legend: false,
    x: { label: "First twin", domain: [lo, hi], ticks: 4 }, y: { label: "Second twin", domain: [lo, hi], ticks: 4 }, marks: [],
    series: [
      { name: "Equal values", type: "line", data: [[lo, lo], [hi, hi]], color: "#16233b", dash: true, width: 1 },
      { name: `${name} pairs`, type: "scatter", data: pairs(kind), color, r: 2.6, opacity: 0.7 },
    ],
  });
  twins(mzChart, sim.mz, "Identical", est.rMZ, 2, "The same genes and the same family.");
  twins(dzChart, sim.dz, "Fraternal", est.rDZ, 4, "Half the genetic differences, the same family.");

  // Same genes, different environments.
  const max = sliders.ve.input.max;
  curveChart.update({
    title: "The same genes in a more or less varied environment",
    subtitle: `Genetic variance stays at ${fmt.int(state.va)} along the whole line. Only the non-shared environment changes.`,
    label: "Line chart of heritability against non-shared environmental variance",
    x: { label: "Non-shared environmental variance", domain: [0, Number(max)] }, y: { label: "Heritability", domain: [0, 1], format: (v) => fmt.num(v, 1) },
    series: [{ name: "Heritability", type: "line", data: heritabilityCurve(state, Number(max), 100), color: 0, width: 2.5 }],
    marks: [{ type: "point", x: state.ve, y: t.h2 }, { type: "text", x: state.ve, y: t.h2, text: `this population: ${two(t.h2)}`, dx: 9, dy: -9 }],
  });

  // A few individuals.
  const dev = (v) => fmt.signed(v, 1);
  const parts = [["G", "Genes", dev], ["C", "Shared environment", dev], ["E", "Non-shared environment", dev],
    ...(state.vi > 0 ? [["I", "Interaction", dev]] : []), ["P", "Trait value", (v) => fmt.num(v, 1)]];
  const people = table({
    caption: "Five simulated people from this population",
    columns: [{ key: "part", label: "Person" }, ...sim.people.map((_, i) => ({ key: `p${i}`, label: `${i + 1}`, num: true }))],
    rows: parts.map(([key, label, format]) => ({ part: label, ...Object.fromEntries(sim.people.map((p, i) => [`p${i}`, format(p[key])])) })),
  });
  people.classList.add("people");
  peopleBox.replaceChildren(people,
    el("p", { class: "small muted", text: `Each column shows one simulated person's pushes above or below the average of 100, and the trait value they add up to. Heritability is ${two(t.h2)} for the population, but no column is "${fmt.pct(t.h2, 0)} genetic". In one person the pushes can point opposite ways, or the genetic push can be larger than the whole gap from the average${state.vi > 0 ? ", and the interaction row belongs to neither side" : ""}. The figure describes the spread across people, not the make-up of anyone.` }));
  drawSoil();
}

/* ---------- two fields ---------- */
function drawSoil() {
  const s = twoSoils({ ...soil, seed: state.seed });
  if (s.error) { soilNote.replaceChildren(note("bad", s.error)); return; }
  soilTiles[0].set(two(s.rich.h2), "from the plants in that field");
  soilTiles[1].set(two(s.poor.h2), "from the plants in that field");
  soilTiles[2].set(`${fmt.num(s.gap, 1)} units`, `rich ${fmt.num(s.rich.mean, 1)}, poor ${fmt.num(s.poor.mean, 1)}`);
  soilTiles[3].set(fmt.pct(soil.share, 0), `set by the slider; ${fmt.pct(1 - soil.share, 0)} from the soil`);
  const all = [...s.rich.values, ...s.poor.values];
  const lo = Math.floor(stats.min(all) / 5) * 5, hi = Math.ceil(stats.max(all) / 5) * 5;
  const bars = (values) => stats.histogram([...values], { bins: 40, min: lo, max: hi }).map((b) => [b.x0, b.x1, b.count]);
  soilChart.update({
    title: "Plant heights in the two fields", subtitle: `${fmt.int(s.rich.values.length)} plants in each. Dashed lines mark the field averages.`,
    label: "Overlapping histograms of plant height in rich and poor soil", x: { label: "Height", domain: [lo, hi] }, y: { label: "Plants" },
    series: [
      { name: "Rich soil", type: "hist", color: 5, opacity: 0.6, data: bars(s.rich.values) },
      { name: "Poor soil", type: "hist", color: 3, opacity: 0.6, data: bars(s.poor.values) },
    ],
    marks: [{ type: "vline", x: s.rich.mean, text: "rich" }, { type: "vline", x: s.poor.mean, text: "poor", dy: 14 }],
  });
  soilNote.replaceChildren(note("", el("strong", { text: "Move the last slider. " }),
    `The chart and the first three numbers do not change at all, because the plants are exactly the same plants: with the slider at ${fmt.pct(soil.share, 0)}, ${fmt.num(s.geneticGap, 1)} units of the gap are in the seed and ${fmt.num(s.gap - s.geneticGap, 1)} in the soil, and nothing measured inside either field shows it. Heritability of ${two(s.rich.h2)} inside the fields is equally at home with a gap that is all soil, all seed or anything between. Telling them apart takes a different experiment, such as sowing each field's seed in the other's soil. The panel is about plants in a model: it shows what heritability inside groups cannot settle, and it is not evidence about a difference between any real groups.`));
}

update();
