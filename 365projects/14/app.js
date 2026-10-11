// Day 14: Simpson's Paradox Finder. Interface.
import { $, el, fmt, clamp, mount, slider, select, checkbox, segmented, textArea, button, stat, note, table, chart, debounce, niceTicks } from "../kit/kit.js";
import { EXAMPLES, LIMITS, decodeBytes, parseTable, profileColumn, guessWeight, weightable, unusableCounts, context, plan, runJob, rank, groupsOf } from "./logic.js";

mount();

const PAGE = 20;
const state = { source: "", about: "", notice: "", example: null, table: null, cols: null, ctx: null, weight: null, minCell: 5, thirds: true, show: "reversals", results: [], jobs: 0, skipped: 0, selected: null, shown: PAGE, run: 0, load: 0 };

/* ---------- formatting ---------- */
// Numbers too large or too small to print in full are written like 3.05e12, so they stay readable and never stretch the page.
const extreme = (...vals) => { const m = Math.max(0, ...vals.filter(Number.isFinite).map(Math.abs)); return m !== 0 && (m >= 1e9 || m < 1e-4); };
const sci = (v, sign = false) => (Number.isFinite(v) ? `${sign && v > 0 ? "+" : ""}${v.toExponential(2).replace("e+", "e")}` : "–");
const num = (v) => (extreme(v) ? sci(v) : fmt.sig(v, 3));
const signed = (v) => (v > 0 ? "+" : "") + num(v);
const count = (n, word) => `${fmt.int(n)} ${word}${n === 1 ? "" : "s"}`;
const clip = (s, n = 26) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const zName = (c) => (c.binned ? `${c.z} (cut into thirds)` : c.z);
// Fixed decimals that suit the size of the numbers, so a column of figures lines up.
const places = (...vals) => clamp(2 - Math.floor(Math.log10(Math.max(...vals.map(Math.abs)) || 1)), 0, 6);
// Enough decimals for the two overall figures to differ on the page when the gap between them is small.
const dp = (c) => clamp(Math.max(places(c.overall.a, c.overall.b), c.overall.effect ? 1 - Math.floor(Math.log10(Math.abs(c.overall.effect))) : 0), 0, 6);
const wild = (c) => extreme(c.overall.a, c.overall.b);
const value = (c, v) => (c.binary ? fmt.pct(v, 1) : wild(c) ? sci(v) : fmt.num(v, dp(c)));
const gap = (c, v) => (c.kind === "slope" ? signed(v) : c.binary ? fmt.signed(v * 100, 1) : wild(c) ? sci(v, true) : fmt.signed(v, dp(c) + 1));
const effect = (c, v) => gap(c, v) + (c.kind === "slope" ? " per unit" : c.binary ? " points" : "");
const brief = (c, v) => gap(c, v) + (c.binary ? " pts" : "");
const strength = (c) => (c.strength > 100 ? "over 100" : fmt.num(c.strength, 1));
const measure = (c) => (c.binary ? `Share with ${clip(c.y, 16)} = ${clip(c.positive, 14)}` : `Mean ${clip(c.y)}`);

/* ---------- controls ---------- */
const exampleButtons = EXAMPLES.map((ex) => button(ex.label, () => loadExample(ex), { small: true }));
const fileInput = el("input", { type: "file", id: "csv-file", accept: ".csv,.tsv,.txt,text/csv,text/plain" });
const drop = el("label", { class: "drop", for: "csv-file" },
  el("strong", { text: "Drop a CSV file here" }), ` or choose one. Up to ${fmt.int(LIMITS.rows)} rows.`, fileInput);
const paste = textArea({
  label: "Or paste a table", rows: 6, mono: true, placeholder: "group,treatment,recovered\nward 1,new,yes\nward 1,old,no",
  hint: "The first line holds the column names. Commas, tabs or semicolons all work, so cells copied from a spreadsheet can be pasted straight in.",
});
paste.input.wrap = "off";
const weightSel = select({
  label: "Count column", options: [{ value: "", label: "None: one row per observation" }], value: "",
  hint: "For a table that is already counted up, where each row stands for many identical observations.",
  onChange: (v) => { state.weight = v === "" ? null : Number(v); analyse(); },
});
const minSlider = slider({
  label: "Smallest group to keep", min: 1, max: 50, step: 1, value: state.minCell, format: (v) => `${v} ${v === 1 ? "row" : "rows"}`,
  hint: "A group is compared only when both sides have at least this many observations in it.",
  onInput: debounce((v) => { state.minCell = v; analyse(); }, 120),
});
const thirdsBox = checkbox({ label: "Also split by number columns, cut into thirds", checked: true, onChange: (on) => { state.thirds = on; analyse(); } });
const showSeg = segmented({
  label: "List", value: "reversals", options: [{ value: "reversals", label: "Reversals" }, { value: "all", label: "All comparisons" }],
  onChange: (v) => { state.show = v; state.shown = PAGE; render(); },
});

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Example data" })), el("div", { class: "row", role: "group", "aria-label": "Example data" }, exampleButtons)),
  drop, paste.el,
  el("div", { class: "row" }, button("Search this text", () => load(paste.value, "Pasted text"), { primary: true, small: true })),
  el("p", { class: "small muted", text: "Your data is read by this page inside your browser. Nothing is uploaded, sent anywhere or stored." }),
  weightSel.el, minSlider.el, thirdsBox.el);

/* ---------- outputs ---------- */
const sRows = stat("Observations");
const sCols = stat("Columns used");
const sChecked = stat("Comparisons checked");
const sFound = stat("Reversals found");
const status = el("div", { class: "small muted", role: "status" });
const messages = el("div", { class: "stack" });
const listBox = el("div", { class: "stack" });
const colsBox = el("div");
const colsDetails = el("details", { class: "chart-table" }, el("summary", { text: "How each column was read" }), colsBox);
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sRows.el, sCols.el, sChecked.el, sFound.el), status, messages, showSeg.el, listBox, colsDetails);

const detailTitle = el("h3");
const headlineEl = el("p", { class: "verdict", role: "status" });
const verdictBox = el("div", { class: "stack" });
const tiles = [stat("All rows together"), stat("Inside the groups"), stat(""), stat("Groups pointing the other way")];
const leftBox = el("div"), rightBox = el("div");
const pair = el("div", { class: "pair" }, leftBox, rightBox);
const groupTable = el("div", { class: "stack" });
const detail = el("div", { class: "detail", hidden: true }, el("div", { class: "stack" }, detailTitle, headlineEl, verdictBox), el("div", { class: "stats" }, tiles.map((t) => t.el)), pair, groupTable);

$("#app").append(el("div", { class: "tool-grid" }, controls, out), detail);
const left = chart(leftBox, { series: [], height: 300 });
const right = chart(rightBox, { series: [], height: 300 });

/* ---------- loading ---------- */
function fail(message) {
  state.run++;
  state.load++;
  state.table = null;
  status.textContent = "";
  messages.replaceChildren(note("bad", message));
  for (const s of [sRows, sCols, sChecked, sFound]) s.set("–", "");
  weightSel.input.replaceChildren(el("option", { value: "", text: "None: one row per observation" }));
  showSeg.el.hidden = true;
  listBox.replaceChildren();
  colsDetails.hidden = true;
  detail.hidden = true;
}

function loadExample(ex) {
  paste.value = ex.csv;
  load(ex.csv, ex.label, ex.about, ex.id);
}

function load(text, source, about = "", example = null, notice = "") {
  Object.assign(state, { source, about, notice, example, selected: null, shown: PAGE });
  exampleButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(EXAMPLES[i].id === example)));
  const t = parseTable(text);
  if (t.error) return fail(t.error);
  // Columns are read in slices of about 30 milliseconds, so a wide file with many rows does not freeze the page.
  const token = ++state.load;
  const cols = [];
  const step = () => {
    if (token !== state.load) return;
    const t0 = performance.now();
    while (cols.length < t.names.length && performance.now() - t0 < 30) cols.push(profileColumn(t, cols.length));
    if (cols.length < t.names.length) {
      state.table = null;
      status.textContent = `Reading ${source}: column ${fmt.int(cols.length)} of ${fmt.int(t.names.length)}…`;
      setTimeout(step, 0);
      return;
    }
    state.table = t;
    state.cols = cols;
    state.weight = guessWeight(cols, t.n);
    weightSel.input.replaceChildren(
      el("option", { value: "", text: "None: one row per observation" }),
      ...weightable(cols).map((c) => el("option", { value: c.index, text: c.name })));
    weightSel.value = state.weight ?? "";
    analyse();
  };
  step();
}

async function readFile(file) {
  if (!file) return;
  if (/\.(xlsx?|ods|numbers)$/i.test(file.name)) return fail(`"${file.name}" is a spreadsheet workbook. Open it and save or export the sheet as CSV, then drop that file here.`);
  if (file.size > LIMITS.bytes) return fail(`"${file.name}" is ${fmt.num(file.size / 1e6, 1)} MB. This page reads files up to ${LIMITS.bytes / 1e6} MB; remove the columns you do not need or take a sample of the rows.`);
  if (file.size === 0) return fail(`"${file.name}" is empty.`);
  status.textContent = `Reading ${file.name}…`;
  let decoded;
  try { decoded = decodeBytes(new Uint8Array(await file.arrayBuffer())); } catch { return fail(`"${file.name}" could not be read.`); }
  const { text, encoding } = decoded;
  if (!text.trim()) return fail(`"${file.name}" holds no text.`);
  // Only readable text goes into the paste box: never the contents of a binary file.
  paste.value = text.length <= 20000 && !text.includes("\u0000") ? text : "";
  const notice = encoding === "windows-1252" ? "This file is not saved as UTF-8, so it was read as Windows-1252, the usual encoding of older spreadsheet exports. If accented letters or symbols look wrong, save the file as \"CSV UTF-8\" and load it again." : "";
  setTimeout(() => load(text, file.name, "", null, notice), 0);
}
fileInput.addEventListener("change", () => { readFile(fileInput.files[0]); fileInput.value = ""; });
const app = $("#app");
app.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
app.addEventListener("dragleave", () => drop.classList.remove("over"));
app.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer?.files?.[0]); });

/* ---------- the search, in slices so a large file never freezes the page ---------- */
function analyse() {
  const token = ++state.run;
  if (!state.table) return;
  const ctx = context(state.table, state.cols, { weight: state.weight, minCell: state.minCell });
  if (ctx.error) { const t = state.table; fail(ctx.error); state.table = t; return; }
  const { jobs, skipped } = plan(state.cols, { weight: state.weight, thirds: state.thirds });
  const found = [];
  let i = 0;
  const step = () => {
    if (token !== state.run) return;
    const t0 = performance.now();
    while (i < jobs.length && performance.now() - t0 < 30) found.push(...runJob(jobs[i++], ctx));
    if (i < jobs.length) { status.textContent = `Checking column combinations: ${fmt.int(i)} of ${fmt.int(jobs.length)}…`; setTimeout(step, 0); return; }
    Object.assign(state, { ctx, results: rank(found), jobs: jobs.length, skipped });
    render();
  };
  step();
}

/* ---------- rendering ---------- */
function describe(c) {
  const what = c.kind === "slope" ? `${c.y} against ${c.x}` : `${c.binary ? `${c.y} = ${c.positive}` : `mean ${c.y}`}: ${c.a} against ${c.b}`;
  return el("span", {}, el("strong", { text: what }), `, split by ${zName(c)}`);
}

function render() {
  if (!state.table) return;   // a file is still being read
  const { table: t, cols, ctx, results } = state;
  const reversals = results.filter((c) => c.reversal);
  const list = state.show === "all" ? results : reversals;
  if (!list.some((c) => c.key === state.selected)) state.selected = list[0]?.key ?? null;
  const selected = list.find((c) => c.key === state.selected) || null;

  const used = cols.filter((c) => c.kind !== "ignored" && c.index !== state.weight);
  const full = reversals.filter((c) => c.reversal === "full").length;
  const firm = reversals.filter((c) => c.strength >= 2).length;
  showSeg.el.hidden = false;
  sRows.set(fmt.int(ctx.total), ctx.w ? `from ${fmt.int(t.n)} rows of counts` : "one per row");
  const ignored = cols.filter((c) => c.kind === "ignored" && c.index !== state.weight).length;
  sCols.set(`${used.length} of ${cols.length}`, [state.weight != null ? "1 holds the counts" : "", ignored ? `${ignored} ignored` : ""].filter(Boolean).join(", ") || "every column");
  sChecked.set(fmt.int(results.length), `from ${fmt.int(state.jobs)} ${state.jobs === 1 ? "combination" : "combinations"} of columns`);
  sFound.set(fmt.int(reversals.length), reversals.length ? `${full} in every group, ${reversals.length - full} on average; ${firm} at strength 2 or more` : "none in this table");
  status.textContent = `Searched ${state.source}: ${count(results.length, "comparison")}, ${count(reversals.length, "reversal")}.`;

  const notes = [note("", el("strong", { text: `${state.source}. ` }), state.about || `${fmt.int(t.n)} rows and ${cols.length} columns read.`,
    ctx.w ? ` The column "${cols[state.weight].name}" is read as a count, so ${fmt.int(t.n)} rows stand for ${fmt.int(ctx.total)} observations.` : "")];
  if (state.notice) notes.push(note("warn", state.notice));
  for (const w of t.warnings) notes.push(note("warn", w));
  if (state.weight == null) for (const c of unusableCounts(cols)) notes.push(note("warn", `"${c.name}" is named like a count of rows, but it cannot be used as one: a count column must hold numbers, none blank or negative and at least one above zero. Every row is counted once.`));
  for (const c of cols) if (c.unparsed) notes.push(note("warn", `"${c.name}" is read as a number column, but ${c.unparsed} of its values are not numbers. Those were treated as missing.`));
  if (state.skipped) notes.push(note("warn", `This table has more column combinations than the page will search. The first ${fmt.int(state.jobs)} were checked and ${fmt.int(state.skipped)} were not. Remove columns you do not care about to cover the rest.`));
  messages.replaceChildren(...notes);

  if (!results.length) {
    listBox.replaceChildren(note("warn", `Nothing here can be compared. A comparison needs an outcome (a number column, or a column with two values), a second column to compare it across, and a third with 2 to 12 values to split by, leaving at least two groups with ${state.minCell} or more observations on each side. Check how each column was read, or lower the smallest group.`));
  } else if (!list.length) {
    listBox.replaceChildren(note("good", `No reversal in this table. ${results.length === 1 ? "One comparison was checked, and in it" : `${fmt.int(results.length)} comparisons were checked, and in every one`} the groups point the same way as the whole table once their sizes are evened out. Choose "All comparisons" to look at ${results.length === 1 ? "it" : "any of them"}.`));
  } else {
    const rows = list.slice(0, state.shown).map((c, i) => ({ c, i: i + 1 }));
    const finds = table({
      caption: state.show === "all" ? "Every comparison, reversals first, then by strength" : "Reversals, strongest first",
      columns: [
        { key: "b", label: "", format: (_, r) => {
          const on = r.c.key === state.selected;
          const b = button(on ? "Shown" : "Show", () => { state.selected = r.c.key; render(); detail.scrollIntoView({ block: "nearest" }); listBox.querySelector('.finds button[aria-pressed="true"]')?.focus({ preventScroll: true }); }, { small: true });
          b.setAttribute("aria-pressed", String(on));
          b.setAttribute("aria-label", `${on ? "Shown" : "Show"}: comparison ${r.i}`);
          return b;
        } },
        { key: "c", label: "What is compared", format: describe },
        { key: "o", label: "All rows", num: true, format: (_, r) => brief(r.c, r.c.overall.effect) },
        { key: "w", label: "Inside groups", num: true, format: (_, r) => brief(r.c, r.c.within.effect) },
        { key: "g", label: "Groups reversed", num: true, format: (_, r) => `${r.c.opposed} of ${r.c.kept}` },
        { key: "m", label: "Smallest group", num: true, format: (_, r) => fmt.int(r.c.minCell) },
        { key: "s", label: "Strength", num: true, format: (_, r) => (r.c.reversal && r.c.strength < 2 ? `${strength(r.c)} (weak)` : strength(r.c)) },
      ],
      rows,
    });
    finds.classList.add("finds");
    listBox.replaceChildren(...[
      finds,
      el("p", { class: "small muted", text: "Effects are gaps in percentage points for rates, gaps in the column's own units for means, and change per unit for slopes. Strength is how many standard errors the weaker of the two effects is from zero: below 2, one side of the reversal could be chance." }),
      list.length > state.shown ? button(`Show ${Math.min(PAGE, list.length - state.shown)} more of ${fmt.int(list.length)}`, () => { const first = state.shown; state.shown += PAGE; render(); listBox.querySelectorAll(".finds button")[first]?.focus(); }, { small: true }) : null,
    ].filter(Boolean));
  }

  colsDetails.hidden = false;
  colsBox.replaceChildren(table({
    columns: [{ key: "name", label: "Column" }, { key: "read", label: "Read as" }, { key: "distinct", label: "Different values", num: true }, { key: "missing", label: "Missing", num: true }],
    rows: cols.map((c) => ({
      name: c.name,
      read: c.index === state.weight ? "the count of observations in each row"
        : c.kind === "numeric" ? `a number${c.codes ? ", also usable as groups" : state.thirds ? ", split into thirds when used as groups" : ""}${c.sequence ? ". It counts up by one on every row, so it may be a row number" : ""}`
        : c.kind === "binary" ? `two values: ${c.levels.join(" and ")} (rates count "${c.levels[c.positive]}")`
        : c.kind === "category" ? `a category: ${c.levels.join(", ")}`
        : `ignored: ${c.reason}`,
      distinct: c.many ? `over ${LIMITS.levels}` : fmt.int(c.distinct),
      missing: fmt.int(c.missing),
    })),
  }));

  renderDetail(selected);
}

function renderDetail(c) {
  detail.hidden = !c;
  if (!c) return;
  const kept = c.groups.filter((g) => g.kept);
  const z = zName(c);
  const every = c.opposed === c.kept;
  const all = c.kept === 2 ? "both groups" : `every one of the ${c.kept} groups`;
  let headline;
  if (c.kind === "slope") {
    const dir = c.overall.effect > 0 ? "rises" : "falls";
    headline = c.reversal
      ? `Across all rows, ${c.y} ${dir} with ${c.x}: ${effect(c, c.overall.effect)}. Inside the groups the trend runs the other way: ${effect(c, c.within.effect)} once ${z} is held fixed, and ${every ? `${all} slope${c.kept === 2 ? "" : "s"}` : `${c.opposed} of the ${c.kept} groups slope`} against the overall line.`
      : c.overall.effect === 0 ? `No reversal. Across all rows, ${c.y} neither rises nor falls with ${c.x}: the fitted line is flat.`
      : `No reversal. Across all rows, ${c.y} ${dir} with ${c.x} (${effect(c, c.overall.effect)}), and ${c.within.effect === 0 ? "the trend is flat" : `it still ${dir}`} once ${z} is held fixed (${effect(c, c.within.effect)}).`;
  } else {
    const what = c.binary ? `the share with ${c.y} = ${c.positive}` : `mean ${c.y}`;
    headline = c.reversal
      ? `Across all rows, ${what} is higher for ${c.a}: ${value(c, c.overall.a)} against ${value(c, c.overall.b)} for ${c.b}. Inside the groups it turns round. Give both sides the same mix of ${z} and it is higher for ${c.b}, by ${effect(c, -c.within.effect).replace("+", "")}; it is higher for ${c.b} in ${every ? all : `${c.opposed} of the ${c.kept} groups`}.`
      : `No reversal. Across all rows, ${what} is higher for ${c.a} (${value(c, c.overall.a)} against ${value(c, c.overall.b)} for ${c.b}), and ${c.within.effect > 0 ? "it is still higher" : "the two are level"} when both sides are given the same mix of ${z} (${value(c, c.within.a)} against ${value(c, c.within.b)}).`;
  }
  const cautions = [];
  if (c.reversal && c.strength < 2) cautions.push(`Strength ${strength(c)}: the overall effect is ${fmt.num(Math.abs(c.overall.z), 1)} standard errors from zero and the effect inside groups is ${fmt.num(Math.abs(c.within.z), 1)}. Under 2, a gap this size could come from chance alone, so at least one side of this reversal is not firmly established.`);
  for (const i of [c.yi, c.xi]) if (state.cols[i].sequence) cautions.push(`"${state.cols[i].name}" counts up by one on every row. If it is a row number or an identifier and not a measurement, this comparison means nothing.`);
  if (c.minCell < 30) cautions.push(`The smallest group compared holds ${fmt.int(c.minCell)} observations, so its own figure is rough.`);
  if (c.dropped) cautions.push(`${fmt.int(c.dropped)} observations sit in groups too small to compare. They are left out of both charts.`);
  detailTitle.replaceChildren(describe(c));
  if (headlineEl.textContent !== headline) headlineEl.textContent = headline;
  verdictBox.replaceChildren(...[
    cautions.length ? note("warn", cautions.join(" ")) : null,
    c.reversal ? note("", el("strong", { text: "Which chart to believe? " }), `The numbers cannot say. If ${c.z} comes before ${c.x} and affects both columns, the split chart compares like with like. If ${c.z} is partly a result of ${c.x}, the split chart leaves that route out: it shows what is left of the link once ${c.z} is held fixed, and the whole table shows the total.`) : null,
  ].filter(Boolean));

  tiles[0].set(effect(c, c.overall.effect), c.kind === "slope" ? `slope of ${clip(c.y, 18)} on ${clip(c.x, 18)}` : `${clip(c.a, 18)} minus ${clip(c.b, 18)}`);
  tiles[1].set(effect(c, c.within.effect), c.kind === "slope" ? "one slope fitted through every group" : "with the same group mix for both");
  tiles[2].el.querySelector(".l").textContent = c.kind === "slope" ? "Between the groups" : "Due to the mix";
  if (c.kind === "slope") tiles[2].set(Number.isFinite(c.between.effect) ? effect(c, c.between.effect) : "–", "slope through the group averages");
  else tiles[2].set(effect(c, c.mix), "the overall gap minus the like-for-like gap");
  tiles[3].set(`${c.opposed} of ${c.kept}`, c.reversal === "full" ? "a reversal in every group" : c.reversal ? "a reversal on average" : "no reversal");

  pair.className = `pair ${c.kind}`;
  if (c.kind === "slope") drawSlope(c, kept, z);
  else drawDiff(c, kept, z);
}

function drawDiff(c, kept, z) {
  const all = [c.overall.a, c.overall.b, ...kept.flatMap((g) => [g.a, g.b])];
  const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const step = niceTicks(lo, hi, 5).step;
  const y = { label: measure(c), domain: [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step], format: c.binary ? (v) => fmt.pct(v, 0) : wild(c) ? (v) => (v === 0 ? "0" : sci(v)) : undefined };
  const series = (data) => [{ name: clip(c.a), type: "bars", data: data(0), color: 0 }, { name: clip(c.b), type: "bars", data: data(1), color: 1 }];
  left.update({
    title: "All rows together", subtitle: `${fmt.int(c.overall.na)} against ${fmt.int(c.overall.nb)} observations`,
    label: `Bar chart: ${c.a} ${value(c, c.overall.a)}, ${c.b} ${value(c, c.overall.b)}`, hover: null,
    x: { type: "band", label: " ", categories: ["All rows"] }, y,
    series: series((i) => [["All rows", i ? c.overall.b : c.overall.a]]),
    marks: [
      { type: "text", x: "All rows", y: Math.max(0, c.overall.a), text: value(c, c.overall.a), dx: -4, dy: -6, anchor: "end" },
      { type: "text", x: "All rows", y: Math.max(0, c.overall.b), text: value(c, c.overall.b), dx: 4, dy: -6, anchor: "start" },
    ],
  });
  right.update({
    title: `The same rows, split by ${z}`, subtitle: c.reversal ? `Higher for ${clip(c.b)} in ${c.opposed} of ${c.kept} groups` : "Each pair of bars is one group",
    label: `Bar chart of ${measure(c)} for ${c.a} and ${c.b} in each group of ${z}`, hover: null,
    x: { type: "band", label: clip(z, 40), categories: kept.map((g) => g.level), format: (v) => clip(v, 14) }, y,
    series: series((i) => kept.map((g) => [g.level, i ? g.b : g.a])),
    marks: [],
  });

  const share = (n, of) => `${fmt.int(n)} (${fmt.pct(n / of, 0)})`;
  const rows = c.groups.map((g) => ({
    level: g.kept ? g.level : `${g.level} (left out: too few)`, na: share(g.na, c.overall.na), a: g.na ? value(c, g.a) : "–", nb: share(g.nb, c.overall.nb), b: g.nb ? value(c, g.b) : "–",
    gap: g.kept ? effect(c, g.effect) : "–", ahead: !g.kept ? "" : g.effect > 0 ? c.a : g.effect < 0 ? c.b : "level",
  }));
  rows.push(
    { level: "All rows together", na: fmt.int(c.overall.na), a: value(c, c.overall.a), nb: fmt.int(c.overall.nb), b: value(c, c.overall.b), gap: effect(c, c.overall.effect), ahead: c.a },
    { level: "Same mix for both", na: "", a: value(c, c.within.a), nb: "", b: value(c, c.within.b), gap: effect(c, c.within.effect), ahead: c.within.effect > 0 ? c.a : c.within.effect < 0 ? c.b : "level" });
  groupTable.replaceChildren(el("p", { class: "small", text: "The share in brackets is how much of each side's total sits in that group. Where the two shares differ, the whole table is not comparing like with like." }), table({
    caption: "Group by group",
    columns: [
      { key: "level", label: clip(z, 30) },
      { key: "na", label: `${clip(c.a, 18)}: rows`, num: true }, { key: "a", label: c.binary ? "rate" : "mean", num: true },
      { key: "nb", label: `${clip(c.b, 18)}: rows`, num: true }, { key: "b", label: c.binary ? "rate" : "mean", num: true },
      { key: "gap", label: "Gap", num: true }, { key: "ahead", label: "Higher for" },
    ],
    rows,
  }));
}

function drawSlope(c, kept, z) {
  const { cols, n, w } = state.ctx;
  const X = cols[c.xi].num, Y = cols[c.yi].num, g = groupsOf({ z: c.zi, binned: c.binned }, state.ctx);
  const slot = new Map(kept.map((k, i) => [g.levels.indexOf(k.level), i]));
  const rows = [];
  for (let i = 0; i < n; i++) if (X[i] === X[i] && Y[i] === Y[i] && slot.has(g.codes[i]) && (!w || w[i] > 0)) rows.push(i);
  const stride = Math.ceil(rows.length / 1200);
  const pts = rows.filter((_, j) => j % stride === 0).map((i) => ({ x: X[i], y: Y[i], k: slot.get(g.codes[i]) }));
  const span = (vals) => { const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.04 || 1; return [lo - pad, hi + pad]; };
  const axis = (label, domain) => ({ label: clip(label, 40), domain, format: extreme(...domain) ? (v) => (v === 0 ? "0" : sci(v)) : undefined });
  const x = axis(c.x, span(pts.map((p) => p.x)));
  const y = axis(c.y, span(pts.map((p) => p.y)));
  const xs = [Math.min(...kept.map((k) => k.lo)), Math.max(...kept.map((k) => k.hi))];
  const sampled = stride > 1 ? ` A sample of ${fmt.int(pts.length)} of ${fmt.int(rows.length)} rows is drawn.` : "";
  left.update({
    title: "All rows together", subtitle: `One line through every point: ${effect(c, c.overall.effect)}.${sampled}`,
    label: `Scatter plot of ${c.y} against ${c.x} with one fitted line`, hover: "point", legend: true, x, y, marks: [],
    series: [
      { name: "All rows", type: "scatter", data: pts, color: "#8a94a3", r: 3, opacity: 0.75 },
      { name: "Line through all rows", type: "line", data: xs.map((v) => [v, c.overall.intercept + c.overall.effect * v]), color: "#16233b", width: 2.5 },
    ],
  });
  right.update({
    title: `The same rows, split by ${z}`, subtitle: `A line through each group. ${c.opposed} of ${c.kept} slope against the overall line.`,
    label: `Scatter plot of ${c.y} against ${c.x}, coloured by ${z}, with a fitted line for each group`, hover: "point", legend: true, x, y, marks: [],
    series: [
      ...kept.map((k, i) => ({ name: clip(k.level, 18), type: "scatter", data: pts.filter((p) => p.k === i), color: i, r: 3, opacity: 0.75 })),
      ...kept.map((k, i) => ({ name: `Line: ${k.level}`, legend: false, type: "line", data: [[k.lo, k.intercept + k.effect * k.lo], [k.hi, k.intercept + k.effect * k.hi]], color: i, width: 2.5 })),
    ],
  });
  const dx = places(...kept.map((k) => k.mx)), dy = places(...kept.map((k) => k.my));
  const ds = places(c.overall.effect, c.within.effect, ...kept.map((k) => k.effect));
  const wildSlope = extreme(c.overall.effect, c.within.effect, ...kept.map((k) => k.effect));
  const slope = (v) => (!Number.isFinite(v) ? "–" : wildSlope ? sci(v, true) : fmt.signed(v, ds));
  const mean = (v, d, all) => (extreme(...all) ? sci(v) : fmt.num(v, d));
  const rowsOut = c.groups.map((k) => ({ level: k.kept ? k.level : `${k.level} (left out: too few)`, n: fmt.int(k.n), mx: mean(k.mx, dx, kept.map((g) => g.mx)), my: mean(k.my, dy, kept.map((g) => g.my)), slope: slope(k.effect), r: k.kept ? fmt.signed(k.r, 2) : "–" }));
  rowsOut.push(
    { level: "All rows together", n: fmt.int(c.n), mx: "", my: "", slope: slope(c.overall.effect), r: fmt.signed(c.overall.r, 2) },
    { level: "Inside groups, pooled", n: "", mx: "", my: "", slope: slope(c.within.effect), r: fmt.signed(c.within.r, 2) },
    { level: "Between group averages", n: "", mx: "", my: "", slope: slope(c.between.effect), r: "" });
  groupTable.replaceChildren(el("p", { class: "small", text: "Where the groups sit at different averages, the line through all rows mostly follows the gaps between the groups, not the trend inside them." }), table({
    caption: "Group by group",
    columns: [
      { key: "level", label: clip(z, 30) }, { key: "n", label: "Rows", num: true },
      { key: "mx", label: `Mean ${clip(c.x, 16)}`, num: true }, { key: "my", label: `Mean ${clip(c.y, 16)}`, num: true },
      { key: "slope", label: "Slope", num: true }, { key: "r", label: "Correlation", num: true },
    ],
    rows: rowsOut,
  }));
}

loadExample(EXAMPLES[0]);
