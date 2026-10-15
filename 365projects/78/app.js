// Day 78: Government Debt Dynamics. Interface.
import { $, el, fmt, mount, segmented, select, button, stat, note, chart, debounce } from "../kit/kit.js";
import { DEBT } from "./data.js";
import { LIMITS, readScenario, path, steadyState, stabilisingSurplus, firstYear, verdict, startingPoint, equationCheck } from "./logic.js";

mount();

/* ---------- formatting ---------- */
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (n) => String(n).split("").map((c) => SUP[c] ?? c).join("");
/** A share of GDP in percent; past a million percent (10,000 times GDP) as a power of ten. */
function share(v, d = 1) {
  if (!Number.isFinite(v)) return "beyond any number";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 1e6) {
    let e = Math.floor(Math.log10(a)), m = Math.round((a / 10 ** e) * 10) / 10;
    if (m >= 10) { m /= 10; e += 1; }
    return `${sign}${fmt.num(m, 1)} × 10${sup(e)}%`;
  }
  return `${sign}${fmt.num(a, d)}%`;
}
const pts = (v, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt.num(Math.abs(v), d)} points`;
const yrs = (y) => `${fmt.num(y, y < 10 ? 1 : 0)} ${y === 1 ? "year" : "years"}`;

/* ---------- inputs ---------- */
const countries = [...DEBT.countries].sort((a, b) => a.name.localeCompare(b.name));
const OPENING = { country: "USA", window: "10", years: 30 };
const EXAMPLES = [
  { label: "r below g, primary deficit 3%", values: { debt: 100, rate: 2, growth: 4, deficit: 3 } },
  { label: "r above g, primary deficit 2%", values: { debt: 100, rate: 5, growth: 3, deficit: 2 } },
  { label: "r above g, primary surplus 2%", values: { debt: 100, rate: 5, growth: 3, deficit: -2 } },
  { label: "r equal to g, primary deficit 2%", values: { debt: 100, rate: 3, growth: 3, deficit: 2 } },
];
const SPEC = {
  debt: { label: "Debt now (% of GDP)", hint: "General government gross debt. 0 to 1,000." },
  rate: { label: "Interest rate on the debt (% a year)", hint: "The average rate paid on all the debt, old and new, not today's market rate. −10 to 50." },
  growth: { label: "Growth of nominal GDP (% a year)", hint: "Real growth plus inflation, since debt is in money. −20 to 50." },
  deficit: { label: "Primary deficit (% of GDP)", hint: "Spending minus revenue, leaving out interest. Negative for a surplus. −30 to 30." },
  years: { label: "Years ahead", hint: "1 to 200, whole years.", whole: true },
};
const boxes = {};
const fieldEl = (key) => {
  const id = `d78-${key}`, lim = LIMITS[key], spec = SPEC[key];
  const input = el("input", { type: "number", id, min: lim.min, max: lim.max, step: spec.whole ? 1 : "any", inputmode: lim.min >= 0 ? (spec.whole ? "numeric" : "decimal") : null, "aria-describedby": `${id}-hint ${id}-msg` });
  input.addEventListener("input", () => { if (key !== "years") edited = true; changed(); });
  boxes[key] = input;
  return el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: id, text: spec.label })), input,
    el("div", { class: "hint", id: `${id}-hint`, text: spec.hint }), el("div", { class: "d78-msg", id: `${id}-msg`, "aria-live": "polite" }));
};
let loaded = null; // the country whose numbers are in the boxes
let edited = false; // true once a box has been changed by hand after loading a country

const pick = select({
  label: "Start from", value: OPENING.country,
  options: [{ value: "", label: "Your own numbers" }, ...countries.map((c) => ({ value: c.iso, label: `${c.name} (${c.last})` }))],
  hint: "A country fills the boxes with its last outturn year from the OECD Economic Outlook. You can change any of them.",
  onChange: (v) => loadCountry(v),
});
const windowSeg = segmented({
  label: "Interest and growth averaged over", value: OPENING.window,
  options: [{ value: "1", label: "Last year" }, { value: "5", label: "5 years" }, { value: "10", label: "10 years" }],
  onChange: () => { if (pick.value) loadCountry(pick.value); },
});
const windowHint = el("div", { class: "hint" });
const editedNote = el("p", { class: "small d78-edited", "aria-live": "polite" });

function loadCountry(iso) {
  const c = DEBT.countries.find((x) => x.iso === iso);
  loaded = c || null;
  edited = false;
  if (c) {
    const s = startingPoint(c, Number(windowSeg.value));
    for (const k of ["debt", "deficit", "rate", "growth"]) boxes[k].value = String(s[k]);
  }
  changed();
}
function setValues(v) {
  pick.value = ""; loaded = null; edited = false;
  for (const k of ["debt", "rate", "growth", "deficit"]) boxes[k].value = String(v[k]);
  changed();
}

const controls = el("div", { class: "controls" },
  pick.el,
  el("div", { class: "field" }, windowSeg.el, windowHint),
  editedNote,
  fieldEl("debt"), fieldEl("rate"), fieldEl("growth"), fieldEl("deficit"), fieldEl("years"),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples with round numbers" })),
    el("div", { class: "row d78-presets", role: "group", "aria-label": "Examples with round numbers" }, EXAMPLES.map((x) => button(x.label, () => setValues(x.values), { small: true })))),
  el("div", { class: "row" }, button("Back to the opening settings", () => { windowSeg.value = OPENING.window; boxes.years.value = String(OPENING.years); pick.value = OPENING.country; loadCountry(OPENING.country); }, { small: true })));

/* ---------- outputs ---------- */
const sEnd = stat("Debt at the end");
const sWhere = stat("Where it heads");
const sGap = stat("r − g");
const sHold = stat("Primary balance that holds debt steady");
const paused = el("div");
const words = el("p", { class: "d78-words" });
const status = el("p", { class: "sr-only", role: "status" });
const chartBox = el("div", { id: "d78-chart" });
const countryBox = el("div", { id: "d78-country", class: "d78-stack" });
const rgBox = el("div");
const out = el("div", { class: "out" },
  paused,
  el("div", { class: "stats", id: "d78-results" }, sEnd.el, sWhere.el, sGap.el, sHold.el),
  words, status, chartBox, countryBox, rgBox,
  note("", "A projection under constant assumptions, not a forecast: real interest rates, growth and budgets change every year, and governments respond to their debt. Data: OECD Economic Outlook No 119 (Edition 2026/1), outturns only, retrieved 14 October 2026."));
const jump = el("nav", { class: "row d78-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d78-results", "the result"], ["#d78-chart", "the path"], ["#d78-country", "the country's data"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));
const plot = chart(chartBox, { series: [], height: 330 });
const rgPlot = chart(rgBox, { series: [], height: 260 });

/* ---------- reading ---------- */
let current = null;
const read = (k) => (boxes[k].value.trim() === "" ? NaN : Number(boxes[k].value));
const say = debounce((text) => { if (status.textContent !== text) status.textContent = text; }, 500);
const changed = debounce(() => update(), 120);

function update() {
  const r = readScenario(Object.fromEntries(Object.keys(SPEC).map((k) => [k, read(k)])));
  for (const k of Object.keys(SPEC)) {
    const e = r.errors.find((x) => x.key === k);
    const msg = $(`#d78-${k}-msg`);
    if (msg.textContent !== (e ? e.message : "")) msg.textContent = e ? e.message : "";
    boxes[k].classList.toggle("invalid", Boolean(e));
    if (e) boxes[k].setAttribute("aria-invalid", "true"); else boxes[k].removeAttribute("aria-invalid");
  }
  if (loaded) {
    const s = startingPoint(loaded, Number(windowSeg.value));
    // Say how much growth varied inside the window, from the data, so an average is not taken for a typical year.
    const gs = loaded.growth.map((v, i) => [loaded.first + i, v]).filter(([y, v]) => v != null && y >= s.from);
    const lo = gs.reduce((m, x) => (x[1] < m[1] ? x : m)), hi = gs.reduce((m, x) => (x[1] > m[1] ? x : m));
    windowHint.textContent = s.years === 1
      ? `Interest and growth from ${s.year} alone; debt and the primary balance are ${s.year}'s.`
      : `Interest and growth averaged over ${s.from} to ${s.year}; nominal growth ran from ${fmt.num(lo[1], 1)}% (${lo[0]}) to ${fmt.num(hi[1], 1)}% (${hi[0]}) in those years. Debt and the primary balance are ${s.year}'s.`;
  } else windowHint.textContent = "Used when a country is chosen.";
  editedNote.textContent = loaded && edited ? `You have changed ${loaded.name}'s numbers: the results are for your own scenario.` : "";
  if (!r.ok) {
    paused.replaceChildren(note("warn", current ? "Fix the box marked in red; the results below are from the last numbers that worked." : "Fix the box marked in red."));
    return;
  }
  paused.replaceChildren();
  current = r.s;
  draw();
}

function verdictText(v, s) {
  if (v.kind === "settles") return { value: `settles at ${share(v.target)}`, note: `of GDP, whatever the start; half the remaining distance is covered every ${yrs(v.halfLife)}` };
  if (v.kind === "explodes") return { value: "rises without limit", note: `its distance from ${share(v.target)}, the level that would stand still, doubles every ${yrs(v.doubling)}` };
  if (v.kind === "falls" && v.target != null) return { value: "falls without limit", note: `below ${share(v.target)} the gap widens, doubling every ${yrs(v.doubling)}` };
  if (v.kind === "rises") return { value: "rises without limit", note: `by exactly ${fmt.num(s.p, 2)} points a year, since r = g` };
  if (v.kind === "falls") return { value: "falls without limit", note: `by exactly ${fmt.num(-s.p, 2)} points a year, since r = g` };
  return { value: `stays at ${share(v.target)}`, note: "the primary balance exactly offsets the effect of r − g" };
}

function draw() {
  const s = current, T = s.years;
  const d = path(s.d0, s.r, s.g, s.p, T);
  const v = verdict(s.d0, s.r, s.g, s.p);
  const f = firstYear(s.d0, s.r, s.g, s.p);
  const hold = stabilisingSurplus(s.d0, s.r, s.g);
  const startYear = loaded && !edited ? loaded.last : null;
  const when = (t) => (startYear ? String(startYear + t) : `year ${t}`);
  const vt = verdictText(v, s);

  sEnd.set(`${share(d[T])}`, `of GDP after ${T} ${T === 1 ? "year" : "years"} (${when(T)}), from ${share(s.d0)}`);
  sWhere.set(vt.value, vt.note);
  sGap.set(pts((s.r - s.g) * 100), `interest ${fmt.num(s.r * 100, 2)}% minus growth ${fmt.num(s.g * 100, 2)}%`);
  // Exactly this balance holds the ratio; a better one makes it fall every year, a worse one makes it rise.
  const flat = Math.abs(hold) < 0.005;
  sHold.set(flat ? "balanced, 0.00%" : hold > 0 ? `surplus ${fmt.num(hold, 2)}%` : `deficit ${fmt.num(-hold, 2)}%`,
    `of GDP holds debt at exactly ${share(s.d0)}; ${flat ? "a surplus makes it fall, a deficit makes it rise" : hold > 0 ? "a larger surplus makes it fall, a smaller one (or a deficit) makes it rise" : "a smaller deficit (or a surplus) makes it fall, a larger one makes it rise"}. The scenario has a primary ${s.p > 0 ? `deficit of ${fmt.num(s.p, 2)}%` : s.p < 0 ? `surplus of ${fmt.num(-s.p, 2)}%` : "balance of zero"}`);

  const sentences = [
    `In the first year the gap between interest and growth changes the ratio by ${pts(f.snowball)} of GDP (${share(s.d0)} × (r − g) / (1 + g)), and the primary ${s.p >= 0 ? "deficit adds" : "surplus takes off"} ${fmt.num(Math.abs(s.p), 2)}, so debt ${f.change >= 0 ? "rises" : "falls"} by ${fmt.num(Math.abs(f.change), 2)} points.`,
  ];
  if (v.kind === "settles") sentences.push(`Because r is below g, the ratio moves towards ${share(v.target)} of GDP, the level at which the shrinking effect of growth exactly offsets the ${s.p >= 0 ? "deficit" : "surplus"}.${v.target < 0 ? " Below zero means the government would end up lending more than it owes, which a model of gross debt describes only loosely." : ""}`);
  else if (v.kind === "explodes") sentences.push(`Because r is above g, ${v.target < 0 ? "and there is a primary deficit, debt" : `debt above ${share(v.target)} of GDP`} feeds on itself: interest grows faster than the economy, and the ratio rises ever faster unless the primary balance changes.`);
  else if (v.kind === "falls" && v.target != null) sentences.push(`Because r is above g but debt starts below ${share(v.target)}, the surplus wins and the ratio falls ever faster; past zero the government would be a net lender, which a model of gross debt describes only loosely.`);
  else if (v.kind === "rises" || v.kind === "falls") sentences.push("With r equal to g the snowball is zero, so the ratio changes by exactly the primary deficit each year and never settles.");
  else sentences.push("The primary balance exactly offsets the snowball, so the ratio stands still.");
  if (Math.abs(d[T]) >= 1e6) sentences.push("Numbers this large only show where the assumptions lead: long before then lenders, voters or the central bank would change them.");
  words.textContent = sentences.join(" ");
  say(`Debt ${share(d[T])} of GDP after ${T} years; it ${vt.value}. ${sentences[0]}`);

  // The path, with the country's history before it when its numbers are unchanged.
  const x = (t) => (startYear ? startYear + t : t);
  const series = [];
  if (startYear) series.push({ name: `${loaded.name}, outturns`, type: "line", data: loaded.debt.map((v2, i) => [loaded.first + i, v2]), color: "#8a94a3" });
  series.push({ name: "Projection", type: "line", data: d.map((v2, t) => [x(t), v2]), color: 0 });
  series.push({ name: "Interest 1 point higher", type: "line", data: path(s.d0, s.r + 0.01, s.g, s.p, T).map((v2, t) => [x(t), v2]), color: 1, dash: true });
  series.push({ name: "Primary balance 1 point better", type: "line", data: path(s.d0, s.r, s.g, s.p - 1, T).map((v2, t) => [x(t), v2]), color: 2, dash: true });
  const ds = steadyState(s.r, s.g, s.p);
  const marks = [{ type: "hline", y: 0 }];
  if (ds != null && v.kind === "settles") marks.push({ type: "hline", y: ds, text: `Settles at ${share(ds)}` });
  if (startYear) marks.push({ type: "vline", x: startYear, text: String(startYear) });
  plot.update({
    title: `Debt as a share of GDP${startYear ? `, ${loaded.name}` : ""}`,
    subtitle: `d(t + 1) = d(t) (1 + r) / (1 + g) + p, with r, g and p held at the values in the boxes.${startYear ? " Grey: the OECD's outturns." : ""} Dashed: one thing changed at a time.`,
    label: `Line chart of debt as a share of GDP over ${T} years${startYear ? `, after ${loaded.name}'s outturns since ${loaded.first}` : ""}, with two variations`,
    x: { label: startYear ? "Year" : "Years ahead", format: (y) => (startYear ? String(Math.round(y)) : fmt.int(y)) },
    y: { label: "% of GDP", format: (y) => (Math.abs(y) >= 1e6 ? share(y, 0) : `${fmt.int(y)}%`) },
    series, marks,
  });
  drawCountry();
}

function drawCountry() {
  if (!loaded) {
    countryBox.replaceChildren(note("", "Choose a country under \"Start from\" to see its data and how well the equation tracks its recent past."));
    rgPlot.el.hidden = true;
    return;
  }
  const c = loaded, s = startingPoint(c, Number(windowSeg.value)), e = equationCheck(c, 5);
  const span = s.years === 1 ? String(s.year) : `${s.from} to ${s.year}, average`;
  const rows = [
    ["Gross debt", `${share(s.debt, 2)} of GDP`, String(s.year)],
    ["Primary balance", `${s.deficit <= 0 ? "surplus" : "deficit"} ${fmt.num(Math.abs(s.deficit), 2)}% of GDP`, String(s.year)],
    ["Effective interest rate", `${fmt.num(s.rate, 2)}% a year`, span],
    ["Growth of nominal GDP", `${fmt.num(s.growth, 2)}% a year`, span],
    [`Debt predicted by the equation for ${e.to}`, `${share(e.predicted, 2)} of GDP`, `from ${share(e.start, 2)} in ${e.from}, with each year's actual r, g and primary balance`],
    ["Gap to the published figure", pts(e.gap), "stock-flow adjustment: assets bought or sold, valuation changes, interest received"],
  ];
  countryBox.replaceChildren(
    el("h2", { text: `${c.name}: the starting point and a check` }),
    el("div", { class: "d78-rt-box" }, el("table", { class: "tbl d78-rt" },
      el("caption", { text: "From the OECD Economic Outlook No 119, outturns only" }),
      el("thead", {}, el("tr", {}, ["Measure", "Value", "Years"].map((h) => el("th", { scope: "col", text: h })))),
      el("tbody", {}, rows.map(([m, val, yrsText]) => el("tr", {},
        el("th", { scope: "row", text: m }), el("td", { "data-label": "Value", text: val }), el("td", { "data-label": "Years", text: yrsText })))))),
    el("p", { class: "small muted", text: `The effective rate is gross interest paid in a year divided by gross debt at the end of the year before. Over ${e.from} to ${e.to} the equation ${Math.abs(e.gap) < 2 ? "comes within 2 points of" : "misses"} the published ratio by ${fmt.num(Math.abs(e.gap), 2)} points: the difference equation is an identity only once every other change in debt is added.` }));
  rgPlot.el.hidden = false;
  const yrsAll = c.rate.map((_, i) => c.first + i);
  rgPlot.update({
    title: `${c.name}: interest rate on the debt and nominal growth`,
    subtitle: "In years when growth (g) is above the interest rate (r), the debt ratio shrinks before the primary balance is counted.",
    label: `Line chart of ${c.name}'s effective interest rate and nominal GDP growth each year from ${c.first + 1} to ${c.last}`,
    x: { label: "Year", format: (y) => String(Math.round(y)) },
    y: { label: "% a year", format: (y) => `${fmt.num(y, 0)}%` },
    series: [
      { name: "Effective interest rate (r)", type: "line", data: yrsAll.map((y, i) => [y, c.rate[i]]).filter((p) => p[1] != null), color: 0 },
      { name: "Nominal GDP growth (g)", type: "line", data: yrsAll.map((y, i) => [y, c.growth[i]]).filter((p) => p[1] != null), color: 1 },
    ],
    marks: [{ type: "hline", y: 0 }],
  });
}

boxes.years.value = String(OPENING.years);
loadCountry(OPENING.country);
