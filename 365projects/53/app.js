// Day 53: Social Mobility Markov Chain. Interface.
import { $, $$, el, fmt, mount, slider, select, numberField, button, stat, note, table, chart, randomSeed } from "../kit/kit.js";
import { MOBILITY } from "./data.js";
import {
  N, FIFTHS, SHORT, MAX_GENERATIONS, FORGOTTEN, fromPublished, columnTotals, parseMatrix, rescaleRows, trajectory, simulateFamily, simulateMany,
  memory, eigenvalues, analyse, showShare,
} from "./logic.js";

mount();

const FAMILIES = 10000;
const pct = (x) => fmt.pct(x, 1);
const plural = (k, one, many = `${one}s`) => `${fmt.int(k)} ${k === 1 ? one : many}`;
const lower = (s) => s.toLowerCase();
/** "a 21.2% chance", "an 18.4% chance": the article depends on how the number is said aloud. */
const aPct = (x) => { const t = pct(x), n = parseFloat(t); return `${(n >= 8 && n < 9) || (n >= 80 && n < 90) || (n >= 11 && n < 12) || (n >= 18 && n < 19) ? "an" : "a"} ${t}`; };
const published = Object.fromEntries(MOBILITY.matrices.map((m) => [m.id, m]));
const toCells = (m) => m.P.map((row) => row.map((v) => (v / 10).toFixed(1)));
const descendants = (k) => (k === 1 ? "children" : k === 2 ? "grandchildren" : k === 3 ? "great-grandchildren" : `descendants ${k} generations on`);

// chosen: the visitor picked "Your own matrix" from the list, so the table stays theirs even before a cell is changed.
const state = { id: "us-children", base: "us-children", chosen: false, cells: toCells(published["us-children"]), P: null, start: 0, generations: 3, seed: 53 };
state.P = fromPublished(published[state.id].P);

/** Mark each cell with its column name so that a wide table can be shown as a list on a phone. */
function stacked(wrap) {
  const heads = [...wrap.querySelectorAll("thead th")].map((th) => th.textContent);
  for (const tr of wrap.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => td.setAttribute("data-label", heads[i] ?? ""));
  wrap.classList.add("stack");
  return wrap;
}

/* ---------- controls ---------- */
const matrixSel = select({
  label: "Transition matrix", value: state.id,
  options: [...MOBILITY.matrices.map((m) => ({ value: m.id, label: m.label })), { value: "own", label: "Your own matrix (edit the table)" }],
  hint: "Thirteen published tables from two studies. They measure different things, so read what each one is before comparing.",
  onChange: (v) => choose(v),
});
const startSel = select({
  label: "The family starts in the", value: "0",
  options: FIFTHS.map((f, i) => ({ value: String(i), label: lower(f) + (i === 0 ? " (lowest incomes)" : i === 4 ? " (highest incomes)" : "") })),
  onChange: (v) => { state.start = Number(v); update(); },
});
const genSlider = slider({
  label: "Generations", min: 1, max: MAX_GENERATIONS, step: 1, value: state.generations,
  format: (v) => (v <= 3 ? `${v}: ${descendants(v)}` : `${v} generations on`),
  onInput: (v) => { state.generations = v; update(); },
});
const seedField = numberField({ label: "Seed for the simulated family", min: 0, max: 999999, step: 1, value: state.seed, hint: "The same seed and matrix always give the same family history." });
const seedNote = el("div");
seedField.input.addEventListener("input", () => {
  if (!Number.isInteger(seedField.value)) { seedField.input.classList.add("invalid"); seedNote.replaceChildren(note("bad", `The seed must be a whole number from 0 to 999,999. The family shown still uses seed ${state.seed}.`)); return; }
  seedNote.replaceChildren();
  state.seed = seedField.value;
  update();
});
const anotherBtn = button("Another family", () => { state.seed = randomSeed() % 1000000; seedField.value = state.seed; seedNote.replaceChildren(); update(); }, { small: true });
const controls = el("div", { class: "controls" }, matrixSel.el, startSel.el, genSlider.el, seedField.el, seedNote, el("div", { class: "row" }, anotherBtn));

/* ---------- the matrix editor ---------- */
const sourceBox = el("div", { class: "panel source" });
const inputs = [];
const grid = el("table", { class: "grid" },
  el("caption", { text: "Chance, in per cent, that a child ends up in each fifth (the columns), by the parents' fifth (the rows). Every cell can be edited." }),
  el("thead", {}, el("tr", {}, el("th", { scope: "col" }, el("span", { class: "sr-only", text: "Parents' fifth" }), el("span", { "aria-hidden": "true", text: "Parents ↓ child →" })), SHORT.map((s, j) => el("th", { scope: "col" }, s, el("span", { class: "sr-only", text: " fifth" }))))),
  el("tbody", {}, FIFTHS.map((f, i) => {
    inputs.push([]);
    return el("tr", {}, el("th", { scope: "row" }, SHORT[i], el("span", { class: "sr-only", text: " fifth" })), FIFTHS.map((g, j) => {
      const input = el("input", { type: "text", inputmode: "decimal", maxlength: "8", autocomplete: "off", value: state.cells[i][j], "aria-label": `Parents in the ${lower(f)}, child in the ${lower(g)}: chance in per cent` });
      input.addEventListener("input", () => { state.cells[i][j] = input.value; edited(); });
      inputs[i].push(input);
      return el("td", {}, input);
    }), el("td", { class: "total" }));
  })));
grid.querySelector("thead tr").append(el("th", { scope: "col", text: "Row total" }));
const gridNote = el("div", { class: "stack-notes" });
const setCells = (cells) => { state.cells = cells.map((r) => [...r]); cells.forEach((row, i) => row.forEach((v, j) => { inputs[i][j].value = v; })); };
const preset = (label, rows) => button(label, () => { setCells(rows.map((r) => r.map(String))); matrixSel.value = "own"; state.id = "own"; state.chosen = true; edited(); }, { small: true });
// The button switches itself off once the table is back, so focus is handed to the matrix list rather than left on a dead button.
const resetBtn = button("Back to the published table", () => { choose(state.base); matrixSel.input.focus(); }, { small: true });
const rescaleBtn = button("Rescale each row to 100%", () => {
  const parsed = state.cells.map((row) => row.map((t) => (/^\s*(\d+)?(\.\d*)?\s*$/.test(t) && t.trim() !== "" && t.trim() !== "." ? Number(t) : NaN)));
  if (parsed.flat().some((v) => !(v >= 0 && v <= 100))) { edited("Rescaling needs a number from 0 to 100 in every cell first."); return; }
  const scaled = rescaleRows(parsed);
  if (scaled.some((r) => r == null)) { edited(`Row ${scaled.findIndex((r) => r == null) + 1} is all zeros, so it cannot be rescaled. Give at least one cell in it a value above zero.`); return; }
  setCells(scaled.map((row) => row.map((v) => String(Math.round(v * 100) / 100))));
  matrixSel.value = "own"; state.id = "own"; state.chosen = true;
  edited();
}, { small: true });
const editor = el("div", { class: "editor" },
  el("div", { class: "grid-wrap" }, grid), gridNote,
  el("div", { class: "row" }, rescaleBtn, resetBtn),
  el("p", { class: "small muted", text: "Or start from an invented matrix, to see what the chain does at the extremes:" }),
  el("div", { class: "row" },
    preset("Equal chances everywhere", Array.from({ length: N }, () => new Array(N).fill(20))),
    preset("Nobody moves", Array.from({ length: N }, (_, i) => Array.from({ length: N }, (__, j) => (i === j ? 100 : 0)))),
    preset("Two classes that never mix", [[60, 40, 0, 0, 0], [40, 60, 0, 0, 0], [0, 30, 40, 30, 0], [0, 0, 0, 60, 40], [0, 0, 0, 40, 60]])));

function choose(id) {
  // Picking "your own" from the list keeps the numbers on show as a starting point.
  if (id === "own") { state.id = "own"; state.chosen = true; matrixSel.value = "own"; edited(); return; }
  state.id = id; state.base = id; state.chosen = false;
  matrixSel.value = id;
  setCells(toCells(published[id]));
  edited();
}

/** The grid changed (or a control asked for a message): validate, then redraw everything. */
function edited(extra) {
  const base = published[state.base];
  const same = base && toCells(base).every((row, i) => row.every((v, j) => Number(v) === Number(state.cells[i][j]) && state.cells[i][j].trim() !== ""));
  if (same && state.id !== state.base && !state.chosen) { state.id = state.base; matrixSel.value = state.base; }
  if (!same && state.id !== "own") { state.id = "own"; matrixSel.value = "own"; }
  const out = parseMatrix(state.cells);
  $$(".total", grid).forEach((td, i) => { td.textContent = out.totals[i] == null ? "" : `${fmt.num(out.totals[i], 1)}%`; });
  inputs.flat().forEach((input) => input.classList.remove("invalid"));
  const notes = [];
  if (extra) notes.push(note("bad", extra));
  if (out.errors) {
    out.errors.forEach((e) => { const m = /^Row (\d)(?: \([^)]*\))?, column (\d)/.exec(e); if (m) inputs[m[1] - 1][m[2] - 1].classList.add("invalid"); });
    const shown = out.errors.slice(0, 3);
    notes.push(note("bad", el("ul", { class: "plain" }, shown.map((e) => el("li", { text: e }))), out.errors.length > 3 ? `And ${plural(out.errors.length - 3, "more cell")} to fix.` : "", " The results below still use the last matrix that was valid."));
  } else state.P = out.P;
  gridNote.replaceChildren(...notes);
  resetBtn.disabled = state.id !== "own";
  update();
}

/* ---------- outputs ---------- */
const tiles = {
  rags: stat("Bottom fifth to top fifth"), bottom: stat("Bottom fifth stays at the bottom"), top: stat("Top fifth stays at the top"),
  stay: stat("Children who end in their parents' fifth"), lambda: stat("Memory kept per generation"), forget: stat("Generations until origins are mostly forgotten"),
};
const verdictBox = el("div");
const status = el("p", { class: "sr-only", role: "status" });
const pathBox = el("div", { class: "panel family" });
const trajBox = el("div"), distBox = el("div"), memBox = el("div"), eigBox = el("div");
const trajChart = chart(trajBox, { series: [], height: 320 });
const memChart = chart(memBox, { series: [], height: 280 });

function update() {
  const P = state.P, own = state.id === "own";
  const m = published[state.id];
  const a = analyse(P);
  const k = state.generations, start = state.start;

  // What this matrix is.
  const cols = columnTotals(P);
  const colSpread = Math.max(...cols.map((c) => Math.abs(c - 1)));
  const unchanged = own && !!published[state.base] && toCells(published[state.base]).every((row, i) => row.every((v, j) => Number(v) === Number(state.cells[i][j]) && state.cells[i][j].trim() !== ""));
  if (own) {
    sourceBox.replaceChildren(
      el("h2", { text: "Your own matrix" }),
      el("p", { class: "small", text: unchanged
        ? `This is your own copy of the table for ${published[state.base].label}, with nothing changed yet. Edit any cell in the table below: from then on the results describe your numbers, not a real country.`
        : `These numbers are yours${published[state.base] ? `, edited from the table for ${published[state.base].label}` : ""}. Nothing below describes a real country.` }),
      el("p", { class: "small muted", text: "A row that adds up to within half a point of 100% is accepted and divided by its own total, as the published rows are." }));
  } else {
    const totals = m.P.map((row) => row.reduce((s, v) => s + v, 0) / 10);
    const src = MOBILITY.sources[m.study];
    sourceBox.replaceChildren(
      el("h2", { text: m.label }),
      el("p", { class: "small" }, el("strong", { text: "What it measures. " }), m.who),
      el("p", { class: "small" }, el("strong", { text: "Source. " }), `${src.cite.replace(/ Tables? .*$/, "")} ${m.table}. ${fmt.int(m.pairs)} parent-child pairs.`),
      el("p", { class: "small muted", text: Math.min(...totals) === Math.max(...totals)
        ? `As printed, every row adds up to ${fmt.num(totals[0], 1)}%.`
        : `As printed, the rows add up to between ${fmt.num(Math.min(...totals), 1)}% and ${fmt.num(Math.max(...totals), 1)}% because of rounding. Each row is divided by its own total before anything is calculated.` }));
  }

  // Headline numbers.
  tiles.rags.set(pct(a.ragsToRiches), "in one generation; 20% if origins did not matter");
  tiles.bottom.set(pct(a.bottomStays), "in one generation; 20% if origins did not matter");
  tiles.top.set(pct(a.topStays), "in one generation; 20% if origins did not matter");
  tiles.stay.set(pct(a.staysPut), `averaged over the five fifths; 20% if origins did not matter. Trace index ${showShare(a.traceIndex)}`);
  // Below 0.0005 the number is rounding error of the eigenvalue routine round a true zero.
  tiles.lambda.set(a.lambda < 0.0005 ? "0.00" : showShare(a.lambda), a.verdict === "forgets"
    ? (a.lambda < 0.0005 ? "the second eigenvalue: nothing survives one generation" : `the second eigenvalue: what is left of a head start is multiplied by about this each generation`)
    : "the second eigenvalue: at 1, nothing fades");
  const gens = (g) => (g == null ? "more than 1,000" : String(g));
  tiles.forget.set(a.verdict === "forgets" ? gens(a.forget[0]) : "never", a.verdict === "forgets"
    ? `every family within 5% of the long-run shares; within 1% after ${gens(a.forget[1])}`
    : a.verdict === "cycles" ? "the fifths rotate for ever" : "the fifths fall into separate groups");

  // The verdict on the long run, in words.
  const notes = [];
  const names = (cls) => cls.map((i) => lower(SHORT[i])).join(", ");
  if (a.verdict === "splits") {
    notes.push(note("warn", el("strong", { text: "This chain never forgets. " }), `The fifths fall into ${a.structure.closed.length} groups that families cannot leave (${a.structure.closed.map((c) => names(c)).join("; ")})${a.structure.transient.length ? `, and a family in the ${names(a.structure.transient)} ${a.structure.transient.length === 1 ? "fifth" : "fifths"} ends up in one of them` : ""}. Where a family is in the long run depends on where it started, so there are no long-run shares and no number of generations after which origins stop mattering.`));
  } else if (a.verdict === "cycles") {
    notes.push(note("warn", el("strong", { text: "This chain never settles. " }), `Families move round the fifths in a rhythm of ${a.structure.periods[0]} generations, so the chances keep swinging instead of converging. Over a whole cycle a family spends the long-run shares of its time in each fifth, but origins are never forgotten.`));
  } else {
    const pi = a.pi;
    const even = Math.max(...pi.map((v) => Math.abs(v - 0.2))) < 0.0005;
    notes.push(note("", el("strong", { text: "In the long run " }), even
      ? (colSpread < 1e-9
        ? "every family, wherever it started, has a 20% chance of each fifth. That is built in: every column of this table adds up to 100%, as every row does, and then equal fifths are the only shares that reproduce themselves."
        : `every family, wherever it started, has a 20.0% chance of each fifth, to one decimal place. That is close to built in: the columns of this table add up to between ${fmt.pct(Math.min(...cols), 1)} and ${fmt.pct(Math.max(...cols), 1)}, and when every column adds up to exactly 100%, as every row does, equal fifths are the only shares that reproduce themselves.`)
      : `the chances settle at ${pi.map((v, i) => `${pct(v)} ${lower(SHORT[i])}`).join(", ")}, wherever the family started.`,
      a.structure.transient.length ? ` Families leave the ${names(a.structure.transient)} ${a.structure.transient.length === 1 ? "fifth" : "fifths"} for good.` : ""));
    if (!even && colSpread > 0.004) notes.push(note("warn", `The columns of this table add up to between ${pct(Math.min(...cols))} and ${pct(Math.max(...cols))}, not 100%. Each fifth of children is a fifth of all children, so in a table of true fifths every column adds up to 100% too. ${own ? "With these numbers" : "As printed, with the fifths estimated from a sample,"} the long-run shares are not equal fifths. That is a property of the table, not a forecast that any fifth will grow.`));
  }
  verdictBox.replaceChildren(...notes);

  // Chances generation by generation.
  const traj = trajectory(P, start, MAX_GENERATIONS);
  const top = trajectory(P, N - 1, k)[k], bottom = trajectory(P, 0, k)[k];
  trajChart.update({
    title: `A family that starts in the ${lower(FIFTHS[start])}: its chances, generation by generation`,
    subtitle: "Generation 1, the starting family's children, is what the table records. Every later generation is the table multiplied by itself: what it implies if only the parents' fifth matters. Real families keep their advantages longer than that. The starting family itself, 100% in its own fifth, is left off.",
    label: "Line chart of the chance of being in each fifth after each generation",
    x: { label: "Generations after the starting family", domain: [1, MAX_GENERATIONS], ticks: MAX_GENERATIONS - 1, format: (v) => (Number.isInteger(v) ? String(v) : "") },
    y: { label: "Chance of being in the fifth", domain: [0, Math.max(0.4, Math.ceil(Math.max(...traj.slice(1).flat()) * 10 - 1e-9) / 10)], format: (v) => fmt.pct(v, 0) },
    series: FIFTHS.map((f, j) => ({ name: f, type: "line", color: j, data: traj.slice(1).map((d, g) => [g + 1, d[j]]) })),
    marks: [{ type: "vline", x: k, text: `the ${descendants(k)}` }],
  });
  const rows = FIFTHS.map((f, j) => ({ fifth: f, here: pct(traj[k][j]), top: pct(top[j]), bottom: pct(bottom[j]), long: a.pi ? pct(a.pi[j]) : "none" }));
  distBox.replaceChildren(stacked(table({
    caption: k === 1 ? "Where the children are likely to be, as the table records" : `Where the ${descendants(k)} would be if only the parents' fifth mattered at each step`,
    columns: [
      { key: "fifth", label: "Fifth they end up in" },
      { key: "here", label: `Family from the ${lower(FIFTHS[start])}`, num: true },
      ...(start === 0 ? [] : [{ key: "bottom", label: "Family from the bottom fifth", num: true }]),
      ...(start === N - 1 ? [] : [{ key: "top", label: "Family from the top fifth", num: true }]),
      { key: "long", label: "Long-run share", num: true },
    ],
    rows,
  })));
  const sentence = `${k === 1 ? "After" : "If only the parents' fifth matters at each step, after"} ${plural(k, "generation")}, a family that starts in the ${lower(FIFTHS[start])} has ${aPct(traj[k][0])} chance of being in the bottom fifth and ${aPct(traj[k][N - 1])} chance of being in the top fifth.`
    + (start === N - 1 ? ` A family that starts in the bottom fifth: ${pct(bottom[0])} and ${pct(bottom[N - 1])}.` : ` A family that starts in the top fifth: ${pct(top[0])} and ${pct(top[N - 1])}.`);
  status.textContent = `${own ? "Your own matrix" : m.label}. ${sentence}`;

  // One simulated family, and ten thousand of them as a check on the exact figures.
  const path = simulateFamily(P, start, k, state.seed);
  const counts = simulateMany(P, start, k, FAMILIES, state.seed);
  const end = path[k];
  pathBox.replaceChildren(
    el("h2", { text: `One simulated family (seed ${state.seed})` }),
    el("ol", { class: "path", "aria-label": "The family's fifth in each generation" }, path.map((s, g) => el("li", { class: `q${s}` }, el("span", { class: "g", text: g === 0 ? "Start" : `Gen. ${g}` }), el("b", { text: SHORT[s] })))),
    el("p", { class: "small", text: `This family's ${descendants(k)} are in the ${lower(FIFTHS[end])}. One family is one draw: press "Another family" for a different history from the same matrix.` }),
    el("p", { class: "small muted", text: `As a check on the exact figures, ${fmt.int(FAMILIES)} simulated families were started in the ${lower(FIFTHS[start])} with the same seed: after ${plural(k, "generation")}, ${fmt.int(counts[N - 1])} of them (${pct(counts[N - 1] / FAMILIES)}) are in the top fifth and ${fmt.int(counts[0])} (${pct(counts[0] / FAMILIES)}) in the bottom fifth. The exact chances are ${pct(traj[k][N - 1])} and ${pct(traj[k][0])}.` }));

  // How fast origins are forgotten.
  if (a.verdict === "splits") {
    memChart.update({ title: "How far the worst-placed family is from the long-run shares", subtitle: "", series: [], marks: [], empty: "No long-run shares: the fifths fall into separate groups", label: "Empty chart: this matrix has no long-run shares", x: { label: "Generations", domain: [0, MAX_GENERATIONS] }, y: { label: "Distance", type: "linear" } });
  } else {
    const d = memory(P, a.pi, MAX_GENERATIONS);
    const drawn = d.map((v, g) => [g, v]).filter(([, v]) => v >= 1e-4);
    const floor = Math.min(0.001, ...drawn.map(([, v]) => v));
    memChart.update({
      title: "How far the worst-placed family is from the long-run shares",
      subtitle: `The largest gap, over the five starting fifths, between a family's chances and the long-run shares: the share of probability that is still in the wrong fifth. On a log scale a constant rate of forgetting is a straight line.${drawn.length < d.length ? " Values below 0.01% are not drawn." : ""}`,
      label: "Line chart of the distance from the long-run shares after each generation",
      x: { label: "Generations", domain: [0, MAX_GENERATIONS], ticks: MAX_GENERATIONS, format: (v) => (Number.isInteger(v) ? String(v) : "") },
      y: { label: "Distance (log scale)", type: "log", domain: [10 ** Math.floor(Math.log10(floor)), 1], format: (v) => (v >= 0.01 ? fmt.pct(v, 0) : fmt.pct(v, v >= 0.001 ? 1 : 2)) },
      series: [{ name: "Distance from the long-run shares", type: "line", color: 0, data: drawn }, { name: "Each generation", type: "scatter", color: 0, r: 3.5, data: drawn, hover: false }],
      marks: [{ type: "hline", y: FORGOTTEN[0], text: "5%: mostly forgotten" }, { type: "hline", y: FORGOTTEN[1], text: "1%: all but forgotten" }],
      legend: false,
    });
  }
  // A real minus sign in front of a negative number, and never "−0.000".
  const real3 = (x) => { const t = fmt.num(Math.abs(x), 3); return x < 0 && Number(t) !== 0 ? `−${t}` : t; };
  const eig = eigenvalues(P).map((z) => (Math.abs(z.im) < 5e-4 ? real3(z.re) : `${real3(z.re)} ${z.im < 0 ? "−" : "+"} ${fmt.num(Math.abs(z.im), 3)}i`));
  // A half-life shorter than one generation is not something a family can live through, so it is put the other way.
  const pace = a.verdict !== "forgets" || !(a.lambda > 0.0005 && a.lambda < 1) ? ""
    : a.halfLife >= 1 ? `: at ${showShare(a.lambda)} a generation, what is left of an advantage halves about every ${fmt.num(a.halfLife, a.halfLife < 10 ? 1 : 0)} generations`
      : `: at ${showShare(a.lambda)} a generation, ${fmt.pct(a.lambda, 0)} of what is left of an advantage survives one generation and ${fmt.pct(a.lambda ** 2, 0)} survives two, in the long run`;
  eigBox.replaceChildren(el("p", { class: "small muted", text: `All five eigenvalues of this matrix, largest in size first: ${eig.join(", ")}. One of them is always 1, and none is larger in size. The size of the next sets the long-run rate of forgetting${pace}.` }));

  // Mark the row of the comparison table that is on show.
  for (const b of $$("button[data-id]", compareBox)) {
    const on = b.dataset.id === state.id;
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "Shown" : "Show";
    // The spoken name starts with the words on the button, as speech-control software expects.
    b.setAttribute("aria-label", on ? `Shown above: ${published[b.dataset.id].label}` : `Show the matrix for ${published[b.dataset.id].label}`);
    b.closest("tr").classList.toggle("on", on);
  }
}

/* ---------- every published matrix side by side (built once) ---------- */
const compareBox = el("div", { class: "compare" });
{
  const rows = MOBILITY.matrices.map((m) => ({ m, a: analyse(fromPublished(m.P)) }));
  compareBox.append(
    el("h2", { text: "Every published matrix, side by side" }),
    el("p", { class: "small", text: "Only the six father-son rows from Jäntti and co-authors, and their six father-daughter rows, were built to be compared with each other. The first row measures family income from tax records for a later generation, and should not be set against them as if it were the same thing. The first three columns of figures are read straight off each table. The last two come from treating the table as a Markov chain, and are not measurements." }),
    stacked(table({
      columns: [
        { key: "name", label: "Matrix" }, { key: "bb", label: "Bottom stays at the bottom", num: true }, { key: "bt", label: "Bottom to top", num: true },
        { key: "tt", label: "Top stays at the top", num: true }, { key: "lam", label: "Memory per generation", num: true }, { key: "forget", label: "Generations to forget (5%)", num: true }, { key: "show", label: "Show it above" },
      ],
      rows: rows.map(({ m, a }) => {
        const b = button("Show", () => { choose(m.id); }, { small: true });
        b.dataset.id = m.id;
        b.setAttribute("aria-label", `Show the matrix for ${m.label}`);
        return { name: m.label, bb: pct(a.bottomStays), bt: pct(a.ragsToRiches), tt: pct(a.topStays), lam: showShare(a.lambda), forget: String(a.forget[0]), show: b };
      }),
    })));
}

const out = el("div", { class: "out" },
  sourceBox, editor,
  el("div", { class: "stats" }, tiles.bottom.el, tiles.rags.el, tiles.top.el, tiles.stay.el, tiles.lambda.el, tiles.forget.el),
  status, verdictBox, trajBox, distBox, pathBox, memBox, eigBox);

editor.id = "m-table"; pathBox.id = "m-family"; compareBox.id = "m-compare";
$("#app").append(
  el("nav", { class: "jump", "aria-label": "Parts of the tool" }, el("a", { href: "#m-table", text: "The table" }), el("a", { href: "#m-family", text: "One family" }), el("a", { href: "#m-compare", text: "Every published matrix" })),
  el("div", { class: "tool-grid" }, controls, out), compareBox);
edited();
