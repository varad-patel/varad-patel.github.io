// Day 38: Price Elasticity Lab. Interface.
import { $, el, fmt, mount, select, checkbox, textArea, numberField, button, stat, note, table, chart } from "../kit/kit.js";
import { LIMITS, EXAMPLES, decodeBytes, parseTable, profile, guessRoles, prepare, fit, logCurve, linearCurve, verdict, constantAdvice, linearAdvice, byGroup } from "./logic.js";

mount();

const state = { source: "", about: "", truth: null, peak: null, example: null, notice: "", table: null, cols: null, roles: null, levels: false, trend: false, cost: null, prepared: null, fit: null, load: 0 };

/* ---------- formatting ---------- */
// Prices and quantities come in any unit, so numbers are printed bare, to three significant figures; very large or very
// small ones in the form 3.05e12, so that they stay readable and never stretch the page.
const num = (v) => (!Number.isFinite(v) ? "–" : v !== 0 && (Math.abs(v) >= 1e7 || Math.abs(v) < 1e-3) ? v.toExponential(2).replace("e+", "e") : fmt.sig(v, 3)).replace("-", "−");
const el2 = (v, d = 2) => fmt.num(v, d).replace("-", "−");                 // an elasticity: −1.80
// An interval for an elasticity. With many rows it can be narrower than two decimals show, so decimals are added until
// its two ends print differently; only an interval with no width at all is called exact.
// The same is done when an end would print as −1.00 or 0.00 without being it, since the reading turns on those two values.
function span(lo, hi) {
  if (Math.abs(hi - lo) < 1e-9) return `exactly ${el2((lo + hi) / 2)}`;
  const landsOn = (v, d) => [-1, 0].some((c) => v !== c && Number(v.toFixed(d)) === c);
  let d = 2;
  while (d < 8 && (el2(lo, d) === el2(hi, d) || landsOn(lo, d) || landsOn(hi, d))) d++;
  return `${el2(lo, d)} to ${el2(hi, d)}`;
}
// A range of prices or quantities: more figures are shown when three do not tell its two ends apart.
function range(lo, hi) {
  if (Number.isFinite(lo) && Number.isFinite(hi) && lo !== hi && Math.abs(hi - lo) <= 1e-6 * Math.max(Math.abs(lo), Math.abs(hi))) return `${num((lo + hi) / 2)}, with no width to speak of`;
  if (lo === hi || !Number.isFinite(lo) || !Number.isFinite(hi) || num(lo).includes("e") || num(hi).includes("e")) return num(lo) === num(hi) ? num(lo) : `${num(lo)} to ${num(hi)}`;
  let n = 3;
  while (n < 9 && fmt.sig(lo, n) === fmt.sig(hi, n)) n++;
  return `${fmt.sig(lo, n)} to ${fmt.sig(hi, n)}`.replaceAll("-", "−");
}
const count = (n, word) => `${fmt.int(n)} ${word}${n === 1 ? "" : "s"}`;
const clip = (s, n = 28) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/* ---------- controls ---------- */
const exampleButtons = EXAMPLES.map((ex) => button(ex.label, () => loadExample(ex), { small: true }));
const fileInput = el("input", { type: "file", id: "sales-file", accept: ".csv,.tsv,.txt,text/csv,text/plain" });
const drop = el("label", { class: "drop", for: "sales-file" }, el("strong", { text: "Drop a CSV file here" }), ` or choose one. Up to ${LIMITS.bytes / 1e6} MB and ${fmt.int(LIMITS.rows)} rows.`, fileInput);
const paste = textArea({
  label: "Or paste a table", rows: 6, mono: true, placeholder: "price,quantity\n2.50,140\n3.00,112",
  hint: "The first line holds the column names. Commas, tabs or semicolons all work, so cells copied from a spreadsheet can be pasted straight in. A row needs a price and a quantity; a date and a group are optional.",
});
paste.input.wrap = "off";
const roleSel = (label, key, hint) => select({ label, options: [{ value: "", label: "–" }], value: "", hint, onChange: (v) => { state.roles[key] = v === "" ? null : Number(v); if (key === "group" && v === "") state.levels = false; if (key === "date" && v === "") state.trend = false; analyse(); } });
const sel = {
  price: roleSel("Price column", "price"),
  quantity: roleSel("Quantity column", "quantity", "Units sold at that price. Rows with a price or a quantity of zero or less cannot be used: a logarithm has no value there."),
  group: roleSel("Group column (optional)", "group", "A shop, product or region, for data that mixes several."),
  date: roleSel("Date column (optional)", "date", "Dates such as 2025-03-31 or 31/03/2025, or a plain count of days or weeks."),
};
const levelsBox = checkbox({ label: "Give each group its own level of demand", onChange: (on) => { state.levels = on; analyse(); } });
const trendBox = checkbox({ label: "Allow for a steady trend over time", onChange: (on) => { state.trend = on; analyse(); } });
const costField = numberField({ label: "Unit cost (optional)", min: 0, value: "", hint: "What one more unit costs you to supply, in the same money as the price. Leave it empty for advice on revenue only." });
const costNote = el("div");
costField.input.addEventListener("input", () => {
  const raw = costField.input.value.trim(), v = Number(raw);
  costField.input.classList.remove("invalid");
  if (raw === "" && !costField.input.validity.badInput) { state.cost = null; costNote.replaceChildren(); }
  else if (raw !== "" && Number.isFinite(v) && v > 0 && v <= LIMITS.cost) { state.cost = v; costNote.replaceChildren(); }
  else {
    costField.input.classList.add("invalid");
    costNote.replaceChildren(note("bad", `The unit cost must be a number above 0 and no more than ${fmt.int(LIMITS.cost)}, or left empty. The advice still uses ${state.cost == null ? "no cost" : `a cost of ${num(state.cost)}`}.`));
    return;
  }
  render();
});

// The result in one line, kept in view on a phone, where the controls are two screens tall and the results sit below
// them (hidden from screen readers: the status line says the same).
const mini = el("p", { class: "mini", "aria-hidden": "true" });
const controls = el("div", { class: "controls" }, mini,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Simulated examples" })), el("div", { class: "row", role: "group", "aria-label": "Simulated examples" }, exampleButtons),
    el("div", { class: "hint", text: "Made-up sales in which the truth is known, to show what the method recovers and what it cannot." })),
  drop, paste.el,
  el("div", { class: "row" }, button("Fit this text", () => load(paste.value, "Pasted text"), { primary: true, small: true })),
  el("p", { class: "small muted", text: "Your data is read by this page inside your browser. Nothing is uploaded, sent anywhere or stored." }),
  sel.price.el, sel.quantity.el, sel.group.el, levelsBox.el, sel.date.el, trendBox.el, costField.el, costNote);

/* ---------- outputs ---------- */
const sRows = stat("Rows used");
const sElast = stat("Price elasticity");
const sRead = stat("Reading");
const sPeak = stat("Revenue-maximising price");
const status = el("p", { class: "small muted", role: "status" });
const messages = el("div", { class: "stack" });
const truthBox = el("div", { class: "stack" });
const demandBox = el("div"), revenueBox = el("div");
const adviceBox = el("div", { class: "stack advice" });
const modelBox = el("div"), groupBox = el("div"), colsBox = el("div");
const colsDetails = el("details", { class: "chart-table" }, el("summary", { text: "How each column was read" }), colsBox);
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sRows.el, sElast.el, sRead.el, sPeak.el), status, messages, truthBox,
  el("div", { class: "part" }, el("h2", { text: "What the data supports" }), adviceBox));
const lower = el("div", { class: "lower" }, el("div", { class: "grid2" }, demandBox, revenueBox), modelBox, groupBox, colsDetails);
$("#app").append(el("div", { class: "tool-grid" }, controls, out), lower);
const demandChart = chart(demandBox, { series: [], height: 340 });
const revenueChart = chart(revenueBox, { series: [], height: 340 });

/* ---------- loading ---------- */
function blank(message, reason = message) {
  for (const s of [sRows, sElast, sRead, sPeak]) s.set("–", "");
  truthBox.replaceChildren(); adviceBox.replaceChildren(note("", "Nothing is fitted yet.")); modelBox.replaceChildren(); groupBox.replaceChildren();
  for (const c of [demandChart, revenueChart]) c.update({ title: "", subtitle: "", series: [], marks: [], empty: "No fit to draw" });
  status.textContent = message;
  mini.textContent = reason;   // on a phone the notes are below the fold, so the line at the top says what went wrong
}
/** The text could not be read as a table at all. */
function fail(message) {
  state.load++;
  Object.assign(state, { table: null, cols: null, roles: null, prepared: null, fit: null, example: null, truth: null, peak: null });
  for (const b of exampleButtons) b.setAttribute("aria-pressed", "false");   // no example is on show any more
  for (const s of Object.values(sel)) { s.input.replaceChildren(el("option", { value: "", text: "–" })); s.input.disabled = true; }
  levelsBox.input.disabled = trendBox.input.disabled = true;
  colsDetails.hidden = true;
  messages.replaceChildren(note("bad", message));
  blank("No table has been read.", message);
}

function loadExample(ex) {
  paste.value = ex.csv;
  load(ex.csv, `${ex.label} (simulated)`, ex.about, ex);
}

function load(text, source, about = "", example = null, notice = "") {
  // The same limit as for a file, checked before anything is read.
  if (text.length > LIMITS.bytes) return fail(`${source} is ${fmt.num(text.length / 1e6, 1)} million characters long. This page reads up to ${LIMITS.bytes / 1e6} million: keep only the price and quantity columns, or take a sample of the rows.`);
  Object.assign(state, { source, about, notice, example: example ? example.id : null, truth: example ? example.truth : null, peak: example ? example.peak ?? null : null, levels: false, trend: false });
  exampleButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(EXAMPLES[i].id === state.example)));
  const token = ++state.load;
  status.textContent = `Reading ${source}…`;
  // Parsing a large file takes a moment: let the line above be drawn first.
  setTimeout(() => {
    if (token !== state.load) return;
    const t = parseTable(text);
    if (t.error) return fail(t.error);
    state.table = t;
    state.cols = profile(t);
    state.roles = guessRoles(state.cols);
    const options = (none) => [el("option", { value: "", text: none }), ...state.cols.map((c) => el("option", { value: c.index, text: clip(c.name, 40) }))];
    for (const [key, s] of Object.entries(sel)) {
      s.input.disabled = false;
      s.input.replaceChildren(...options(key === "group" || key === "date" ? "None" : "Choose a column"));
      s.value = state.roles[key] ?? "";
    }
    // The fit is a second slice of work, so the page can breathe between reading and fitting.
    status.textContent = `Fitting ${source}…`;
    setTimeout(() => { if (token === state.load) analyse(); }, 0);
  }, 0);
}

async function readFile(file) {
  if (!file) return;
  const name = clip(file.name, 60);
  if (/\.(xlsx?|xlsm|ods|numbers)$/i.test(file.name)) return fail(`"${name}" is a spreadsheet workbook. Open it and save or export the sheet as CSV, then drop that file here.`);
  if (file.size > LIMITS.bytes) return fail(`"${name}" is ${fmt.num(file.size / 1e6, 1)} MB. This page reads files up to ${LIMITS.bytes / 1e6} MB: keep only the price and quantity columns, or take a sample of the rows.`);
  if (file.size === 0) return fail(`"${name}" is empty.`);
  status.textContent = `Reading ${name}…`;
  let decoded;
  try { decoded = decodeBytes(new Uint8Array(await file.arrayBuffer())); } catch { return fail(`"${name}" could not be read.`); }
  const { text, encoding } = decoded;
  if (!text.trim()) return fail(`"${name}" holds no text.`);
  // Only readable text goes into the paste box: never the contents of a binary file.
  paste.value = text.length <= 20000 && !text.includes("\u0000") ? text : "";
  const notice = encoding === "windows-1252" ? "This file is not saved as UTF-8, so it was read as Windows-1252, the usual encoding of older spreadsheet exports. If accented letters or symbols look wrong, save the file as \"CSV UTF-8\" and load it again." : "";
  load(text, name, "", null, notice);
}
fileInput.addEventListener("change", () => { readFile(fileInput.files[0]); fileInput.value = ""; });
const app = $("#app");
app.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
app.addEventListener("dragleave", () => drop.classList.remove("over"));
app.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer?.files?.[0]); });

/* ---------- fitting ---------- */
function analyse() {
  if (!state.table) return;
  const hasGroup = state.roles.group != null, hasDate = state.roles.date != null;
  levelsBox.input.disabled = !hasGroup; trendBox.input.disabled = !hasDate;
  if (!hasGroup) state.levels = false;
  if (!hasDate) state.trend = false;
  levelsBox.checked = state.levels; trendBox.checked = state.trend;
  state.prepared = prepare(state.table, state.cols, state.roles);
  state.fit = state.prepared.error ? null : fit(state.prepared, { levels: state.levels, trend: state.trend });
  render();
}

function describeColumns() {
  const { cols, roles } = state;
  const role = (c) => Object.entries(roles).filter(([, i]) => i === c.index).map(([k]) => k).join(", ") || "not used";
  colsBox.replaceChildren(table({
    columns: [{ key: "name", label: "Column" }, { key: "read", label: "Read as" }, { key: "role", label: "Used as" }],
    rows: cols.map((c) => ({
      name: clip(c.name, 30), role: role(c),
      read: c.filled === 0 ? "empty" : c.date ? `dates (${count(c.dates, "cell")} of ${fmt.int(c.filled)}; a date such as 05/04/2025 is read day first)`
        : c.numeric ? `numbers (${count(c.numbers, "cell")} of ${fmt.int(c.filled)}${c.numbers < c.filled ? "; the rest could not be read" : ""})`
        : c.levels ? `text with ${count(c.distinct, "different value")}: ${c.levels.map((l) => clip(l, 16)).join(", ")}` : `text with more than ${LIMITS.groups} different values`,
    })),
  }));
  colsDetails.hidden = false;
}

function render() {
  if (!state.table) return;
  describeColumns();
  const t = state.table, p = state.prepared, f = state.fit;
  const notes = [note("", el("strong", { text: `${state.source}. ` }), state.about || `${count(t.n, "row")} and ${count(t.names.length, "column")} read.`)];
  if (state.notice) notes.push(note("warn", state.notice));
  for (const w of t.warnings) notes.push(note("warn", w));
  const problem = p.error || f?.error;
  if (problem) {
    messages.replaceChildren(...notes, note("bad", problem));
    blank("The table was read, but no curve could be fitted.", problem);
    return;
  }
  const d = p.dropped, lost = Object.values(d).reduce((a, b) => a + b, 0);
  if (lost) {
    const why = [[d.blank, "had no price or no quantity"], [d.notNumber, "held something that is not a number"], [d.priceNotPositive, "had a price of zero or less"], [d.quantityNotPositive, "had a quantity of zero or less"], [d.noGroup, "had no group"], [d.noDate, "had a date that could not be read"]]
      .filter(([n]) => n).map(([n, text]) => `${fmt.int(n)} ${text}`);
    notes.push(note("warn", `${count(lost, "row")} left out: ${why.join(", ")}.${d.quantityNotPositive ? " Leaving out days with no sales makes demand look steadier than it was." : ""}`));
  }
  if (p.groups && !state.levels && p.groups.length > 1) notes.push(note("", `"${p.names.group}" is chosen as the group column but every row is fitted together. Tick "Give each group its own level of demand" to compare prices within each group instead of between them.`));
  if (p.time && !state.trend) notes.push(note("", `"${p.names.date}" is chosen as the date column but is not used yet. Tick "Allow for a steady trend over time" if demand grew or shrank over the period.`));
  messages.replaceChildren(...notes);

  const v = verdict(f), L = f.log, e = L.elasticity;
  const ca = constantAdvice(f, state.cost), la = linearAdvice(f, state.cost);
  // "Exact" only when the points really do lie on the curve: a standard error of nothing, not merely a narrow interval.
  const exact = L.se <= 1e-9 * Math.max(1, Math.abs(e));
  sRows.set(fmt.int(f.n), lost ? `of ${fmt.int(t.n)} read` : t.total > t.n ? `the first ${fmt.int(t.n)} of ${fmt.int(t.total)} in the table` : "every row in the table");
  sElast.set(el2(e), exact ? "the points lie exactly on the curve" : `95% interval ${span(L.low, L.high)}`);
  const reading = { elastic: ["Elastic", "a 1% price rise costs more than 1% of sales"], inelastic: ["Inelastic", "a 1% price rise costs less than 1% of sales"], unclear: ["Unclear", "the interval includes −1, so elastic or not cannot be told"], flat: ["No clear response", "the interval includes 0"], upward: ["Slopes upward", "quantity rises with price in this data"] }[v];
  sRead.set(...reading);
  // A revenue-maximising price is offered only when the rows themselves show what a peak needs: quantity clearly
  // falling with price, demand clearly growing more elastic as the price rises, and the peak among the prices tried.
  // A straight line has a peak whatever the data, so its peak alone is an assumption, not a finding.
  const priced = la.supported;
  const pooled = f.levels || f.trend ? `one price for ${[f.levels ? "every group" : "", f.trend ? "the whole period" : ""].filter(Boolean).join(" and ")}; ` : "";
  sPeak.set(priced ? num(la.revenue.price) : la.usable && la.bends ? "None in range" : "None supported",
    priced ? `on the straight-line fit; ${pooled}95% interval ${range(la.revenue.low, la.revenue.high)}`
      : la.usable && la.bends ? `the straight line peaks at ${num(la.revenue.price)}, outside the prices tried`
      : !la.usable ? "quantity does not clearly fall as price rises"
      : "the rows do not show demand growing more elastic as the price rises, which a revenue peak needs");
  status.textContent = `Fitted ${count(f.n, "row")} from ${state.source}. Elasticity ${el2(e)}${exact ? "" : `, 95% interval ${span(L.low, L.high)}`}: ${reading[0].toLowerCase()}. ${priced ? `Revenue-maximising price on the straight-line fit: ${num(la.revenue.price)}.` : "No revenue-maximising price is supported."}`;

  mini.textContent = `Elasticity ${el2(e)}: ${reading[0].toLowerCase()}. ${priced ? `Revenue-maximising price ${num(la.revenue.price)}.` : "No revenue-maximising price supported."}`;

  // For a simulated example, say whether the method got the right answer.
  if (state.truth != null) {
    const held = L.low <= state.truth && state.truth <= L.high;
    truthBox.replaceChildren(note(held ? "good" : "warn", el("strong", { text: `The true elasticity here is ${el2(state.truth)}. ` }),
      held ? `The interval ${span(L.low, L.high)} contains it.`
        : `The interval ${span(L.low, L.high)} does not contain it. ${state.example === "shops" ? "The dearer shop is also the busier one, so comparing across shops reads location as price. Tick \"Give each group its own level of demand\"."
          : state.example === "trend" ? "Demand and price both rose over the three years, so the price looks harmless. Tick \"Allow for a steady trend over time\"."
          : state.example === "busy" ? "Here the price was raised on days when demand was already high, so high prices sit beside high sales. Nothing on this page can undo that: it takes prices set without regard to demand." : ""}`));
    // The curve behind every one of these examples has no revenue peak at all: say so beside the result.
    truthBox.append(note("", `On the curve behind this example revenue ${state.truth < -1 ? "falls" : "rises"} whenever the price rises, at every price, so it has no revenue-maximising price. A tool that printed one here would be wrong.`));
  } else if (state.peak != null) {
    const held = priced && la.revenue.low <= state.peak && state.peak <= la.revenue.high;
    truthBox.replaceChildren(note(held ? "good" : "warn", el("strong", { text: `The true revenue-maximising price here is ${num(state.peak)}. ` }),
      held ? `The interval ${range(la.revenue.low, la.revenue.high)} contains it. The elasticity above is an average over a curve whose elasticity is not constant.`
        : priced ? `The interval ${range(la.revenue.low, la.revenue.high)} does not contain it.` : "With these settings the page does not find it."));
  } else truthBox.replaceChildren();

  /* ----- advice ----- */
  const [lo, hi] = f.range;
  const tried = `the prices in this data (${range(lo, hi)})`;
  const advice = [];
  const para = (head, text) => el("p", {}, el("strong", { text: `${head} ` }), text);
  advice.push(para("Constant elasticity.", {
    elastic: `The whole interval for the elasticity (${span(L.low, L.high)}) is below −1, so demand is elastic. On this curve revenue falls whenever the price rises, at every price, so the curve has no revenue-maximising price: its only advice is "charge less". Among ${tried}, its revenue is highest at the lowest, ${num(lo)}.`,
    inelastic: `The whole interval for the elasticity (${span(L.low, L.high)}) lies between −1 and 0, so demand is inelastic. On this curve revenue rises whenever the price rises, at every price, so the curve has no revenue-maximising price: its only advice is "charge more". Among ${tried}, its revenue is highest at the highest, ${num(hi)}. No demand stays inelastic for ever, so this says nothing about prices above ${num(hi)}.`,
    unclear: `The interval for the elasticity (${span(L.low, L.high)}) includes −1, the value at which a change of price leaves revenue where it was. This data cannot say whether a higher price would raise revenue or lower it.`,
    flat: `The interval for the elasticity (${span(L.low, L.high)}) includes 0. The data does not show that quantity responds to price at all, so this curve supports no advice on price.`,
    upward: `Quantity rises with price in this data (elasticity ${span(L.low, L.high)}). Buyers do not buy more of something because it costs more: either the price was set in response to demand, or something else moved both. No advice on price can be read from this fit.`,
  }[v] + (la.bends ? " But these rows show the elasticity changing with the price, which this curve cannot follow, so its advice on price is not to be relied on here: see the straight line." : "")));
  const where = (x) => (x > hi ? "above" : "below");
  const guess = (x) => `That is ${where(x)} every price in the data (${range(lo, hi)}), where the line is a guess about prices nobody has tried: read it as a direction, not a figure.`;
  if (la.reason === "upward") advice.push(para("Straight line.", "The straight line through the same points slopes upward, so it has no revenue peak either."));
  else if (!la.usable) advice.push(para("Straight line.", `The slope of the straight line (${num(f.linear.slope)} units per unit of price, 95% interval ${range(f.linear.low, f.linear.high)}) is not clearly below zero, so it supports no revenue peak.`));
  else {
    const bendText = f.bend ? `the bend in the logarithmic fit is estimated at ${el2(f.bend.coef)}, with a 95% interval of ${span(f.bend.low, f.bend.high)}` : "there are too few rows to measure the bend in the logarithmic fit";
    if (!la.bends) advice.push(para("Straight line.", `A straight line through any downward-sloping demand has a revenue peak, where its own elasticity passes −1; through these rows it would be at ${num(la.revenue.price)}. That figure comes from assuming a straight line. A real peak needs demand to grow more elastic as the price rises, and these rows do not show that (${bendText}, which would have to be wholly below zero). The page therefore offers no revenue-maximising price.`));
    else advice.push(para("Straight line.", `These rows show demand growing more elastic as the price rises (${bendText}, wholly below zero), which is what a revenue peak needs and what a straight line assumes. On the straight line the peak, where its elasticity passes −1, is at a price of ${num(la.revenue.price)} (95% interval ${range(la.revenue.low, la.revenue.high)}). ${la.revenue.inside ? "That is inside the prices in the data." : guess(la.revenue.price)}${f.levels ? " With a level for each group this is the one price that would bring in most over all the rows together: each group has its own peak, higher where it sells more, which the page does not work out." : ""}${f.trend ? " It is worked out at the average date: with a trend the peak moves over time." : ""}`));
  }
  if (state.cost != null) {
    const c = state.cost;
    let text;
    if (ca.profit.price != null) {
      const open = ca.profit.high === Infinity;
      // When the interval for the elasticity reaches −1 the formula has no finite answer at that end, and the figure at
      // the estimate itself can be any size: only the lower limit is offered.
      text = open
        ? `With a unit cost of ${num(c)}, the constant-elasticity curve's profit-maximising price is cost × e / (1 + e). The interval for the elasticity reaches −1, where that formula has no finite answer, so the data supports only a lower limit: a price of at least ${num(ca.profit.low)}, with no upper limit. (At the estimate itself the formula gives ${num(ca.profit.price)}, a figure that means little this close to −1.)`
        : `With a unit cost of ${num(c)}, the constant-elasticity curve puts the profit-maximising price at cost × e / (1 + e) = ${num(ca.profit.price)}, which is ${num(ca.profit.markup)} times cost (95% interval ${range(ca.profit.low, ca.profit.high)}). ${ca.profit.inside ? "That is inside the prices in the data." : guess(ca.profit.price).replace("the line", "the curve")}`;
    } else if (ca.profit.none === "inelastic") text = `With a unit cost of ${num(c)}, the constant-elasticity curve has no profit-maximising price: at an elasticity of −1 or closer to zero, its profit keeps rising with the price.`;
    else text = `With a unit cost of ${num(c)}, the constant-elasticity curve still supports no price, for the reason above.`;
    if (la.usable && la.bends) text += ` On the straight line, profit peaks at ${num(la.profit.price)} (95% interval ${range(la.profit.low, la.profit.high)}), half the unit cost above the revenue peak. ${la.profit.inside ? "That is inside the prices in the data." : guess(la.profit.price)}`;
    else if (la.usable) text += " The straight line has a profit peak too, but it rests on the same unconfirmed shape as its revenue peak and is not offered.";
    advice.push(para("Profit.", text));
  }
  advice.push(note("warn", el("strong", { text: "This is a pattern in past sales, not an experiment. " }), "If prices were put up when demand was strong, or cut when it was weak, the slope mixes the buyers' response with the seller's, and no setting here can separate them. The \"Prices raised on busy days\" example shows how wrong the answer can then be."));
  adviceBox.replaceChildren(...advice);

  /* ----- charts ----- */
  const rows = p.rows, stride = Math.ceil(rows.length / 1500);
  const pts = rows.filter((_, i) => i % stride === 0);
  const grid = Array.from({ length: 50 }, (_, i) => lo + ((hi - lo) * i) / 49);
  const adjusted = f.levels || f.trend ? ` Curves are drawn at the average ${[f.levels ? "group" : "", f.trend ? "date" : ""].filter(Boolean).join(" and ")}.` : "";
  const sampled = stride > 1 ? ` ${fmt.int(pts.length)} of the ${fmt.int(rows.length)} rows are drawn.` : "";
  const axis = (label) => ({ label: clip(label, 40), format: num });
  demandChart.update({
    title: "Demand: quantity against price", subtitle: `Each dot is a row. The band is the 95% interval for the constant-elasticity curve.${adjusted}${sampled}`,
    label: `Scatter plot of ${p.names.quantity} against ${p.names.price} with a constant-elasticity curve and a straight line fitted`, empty: null, legend: true,
    x: axis(p.names.price), y: axis(p.names.quantity),
    series: [
      { name: "95% interval", type: "range", data: grid.map((x) => { const c = logCurve(f, x); return [x, c.low, c.high]; }), color: 0 },
      { name: "Constant elasticity", type: "line", data: grid.map((x) => [x, logCurve(f, x).q]), color: 0 },
      { name: "Straight line", type: "line", data: grid.map((x) => [x, Math.max(0, linearCurve(f, x))]), color: 1, dash: true },
      { name: "Rows", type: "scatter", data: pts.map((r) => [r.p, r.q]), color: "#8a94a3", r: 3, opacity: 0.75 },
    ],
    marks: [],
  });
  revenueChart.update({
    title: "Revenue: price times quantity", subtitle: `The constant-elasticity curve only ever rises or falls. The straight line can peak.${adjusted}`,
    label: `Scatter plot of revenue against ${p.names.price}, with the revenue each fitted curve implies`, empty: null, legend: true,
    x: axis(p.names.price), y: { label: "Revenue", format: num },
    series: [
      { name: "Constant elasticity", type: "line", data: grid.map((x) => [x, x * logCurve(f, x).q]), color: 0 },
      { name: "Straight line", type: "line", data: grid.map((x) => [x, x * Math.max(0, linearCurve(f, x))]), color: 1, dash: true },
      { name: "Rows", type: "scatter", data: pts.map((r) => [r.p, r.p * r.q]), color: "#8a94a3", r: 3, opacity: 0.75 },
    ],
    marks: priced ? [{ type: "vline", x: la.revenue.price, text: `straight-line peak ${num(la.revenue.price)}` }] : [],
  });

  /* ----- tables ----- */
  const better = f.log.rmse < f.linear.rmse ? "constant-elasticity curve" : f.log.rmse > f.linear.rmse ? "straight line" : null;
  modelBox.replaceChildren(table({
    caption: `The two fits, on ${count(f.n, "row")}${f.levels ? `, with a level for each of ${f.groupsUsed} groups` : ""}${f.trend ? ", with a trend" : ""}`,
    // One column for each curve, so that the table is three columns wide and fits a phone.
    columns: [{ key: "what", label: "Measure" }, { key: "log", label: "Constant elasticity: ln Q on ln P", num: true }, { key: "lin", label: "Straight line: Q on P", num: true }],
    rows: [
      { what: "Slope", log: `${el2(e)} (the elasticity)`, lin: `${num(f.linear.slope)} per unit of price` },
      { what: "95% interval", log: span(L.low, L.high), lin: range(f.linear.low, f.linear.high) },
      { what: "R²", log: fmt.num(L.r2, 2), lin: fmt.num(f.linear.r2, 2) },
      { what: "Typical miss", log: num(L.rmse), lin: num(f.linear.rmse) },
    ],
  }), el("p", { class: "small muted", text: `Typical miss is the root mean squared error, in the units of the quantity column ("${clip(p.names.quantity, 30)}"). ${better ? `The ${better} is closer on these rows.` : "The two are equally close on these rows."} The two R² values describe different things (logs and units) and cannot be compared.${f.log.trend ? ` Trend: ${fmt.signed((Math.exp(f.log.trend.perUnit) - 1) * 100, 1).replace("-", "−")}% a ${f.log.trend.unit === "year" ? "year" : `step of ${clip(p.names.date, 20)}`} at a fixed price (95% interval ${fmt.signed((Math.exp(f.log.trend.low) - 1) * 100, 1).replace("-", "−")}% to ${fmt.signed((Math.exp(f.log.trend.high) - 1) * 100, 1).replace("-", "−")}%).` : ""}` }));
  const groups = byGroup(p);
  groupBox.replaceChildren(...(groups.length > 1 ? [table({
    caption: `Each group of ${clip(p.names.group, 30)} fitted on its own`,
    columns: [{ key: "name", label: "Group" }, { key: "n", label: "Rows", num: true, format: fmt.int }, { key: "e", label: "Elasticity", num: true }, { key: "ci", label: "95% interval", num: true }],
    rows: groups.map((g) => ({ name: clip(g.name, 30), n: g.n, e: g.error ? "–" : el2(g.elasticity), ci: g.error ? `not fitted: ${g.error}` : span(g.low, g.high) })),
  })] : []));
}

for (const s of Object.values(sel)) s.input.disabled = true;
levelsBox.input.disabled = trendBox.input.disabled = true;
loadExample(EXAMPLES[0]);
