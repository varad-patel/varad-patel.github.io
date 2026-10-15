// Day 84: Taylor Rule versus the Central Bank. Interface.
import { $, el, fmt, mount, slider, select, segmented, numberField, stat, note, chart, button, download } from "../kit/kit.js";
import { DATA } from "./data.js";
import { addMonths, monthDiff, monthLabel, outputGap, monthlyFromQuarterly, compare, fitWeights, checkParams, LIMITS, toCsv } from "./logic.js";

mount();

const N = monthDiff(DATA.first, DATA.last) + 1;
const MONTHS = Array.from({ length: N }, (_, i) => addMonths(DATA.first, i));
// A month sits at its middle on the time axis, so whole numbers are the starts of years: tick marks read "2005" and
// the charts' tables, one row a month, read "Mar 2005".
const xOf = (ym) => Number(ym.slice(0, 4)) + (Number(ym.slice(5, 7)) - 1) / 12 + 1 / 24;
const timeLabel = (v) => {
  if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v));
  const k = Math.floor(v * 12 + 1e-9);
  return monthLabel(`${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`);
};
const YEARS = Array.from({ length: Number(DATA.last.slice(0, 4)) - 1986 + 1 }, (_, i) => 1986 + i);
const pts = (v, d = 1) => `${fmt.signed(v, d)} points`;
// Policy rates as published: 0.125 and 3.625 keep their third decimal, 5.25 keeps two.
const rateText = (v) => `${fmt.num(v, Math.abs(v * 100 - Math.round(v * 100)) > 1e-9 ? 3 : 2)}%`;
const cap = (t) => t[0].toUpperCase() + t.slice(1);
// India's first measure is the wholesale price index to 2012 and the CPI (Combined) from 2014 (nothing for 2013).
const measureName = (code, measure, first, last) => {
  const m = COUNTRIES[code].measures.find((x) => x.value === measure);
  if (code !== "in" || measure !== "cpi") return m.short;
  return last < "2013-01" ? "wholesale price (WPI)" : first >= "2013-01" ? "CPI (Combined)" : "WPI to 2012 and CPI (Combined) from 2014";
};

const COUNTRIES = {
  us: {
    name: "United States", bank: "the Federal Reserve", rateName: "the FOMC's target rate (midpoint of the range since December 2008)",
    measures: [
      { value: "pceCore", label: "Core PCE, BEA", short: "core PCE" },
      { value: "pce", label: "PCE, all items, BEA", short: "PCE" },
      { value: "cpi", label: "CPI-U, all items, BLS", short: "CPI" },
      { value: "deflator", label: "GDP deflator, BEA", short: "GDP deflator" },
    ],
    why: "Core PCE is the price index for personal consumption expenditures without food and energy; the Fed's 2% target, set in 2012, is for PCE prices, and it watches the core index, which is less volatile, as a guide to where inflation is going. Taylor's 1993 paper used the GDP deflator over four quarters, given here to each month of its quarter. CPI inflation has run about a third of a point above PCE inflation since 2001, so the same rule asks for a higher rate on the CPI.",
    gdpNote: "Real GDP (BEA), from 1947.",
    defaults: { rStar: 2, piStar: 2, measure: "pceCore" },
  },
  in: {
    name: "India", bank: "the Reserve Bank of India", rateName: "the repo rate (the BIS gives no single policy rate before April 2001)",
    measures: [
      { value: "cpi", label: "WPI to 2012, then CPI (Combined), BIS", short: "CPI (Combined)" },
      { value: "cpiIw", label: "CPI-IW, Labour Bureau via OECD", short: "CPI for industrial workers" },
    ],
    why: "Since 2016 the RBI's target has been 4% for the all-India CPI (Combined), published from 2011. Before 2014 the RBI's headline gauge was the wholesale price index, so the first measure follows wholesale prices to 2012 and the CPI from 2014, with no rate for 2013. The CPI for industrial workers (CPI-IW) is the Labour Bureau's older consumer index for workers' households; the two have differed by as much as 5.6 points (May 2019).",
    gdpNote: "Real GDP (World Bank Global Economic Monitor, seasonally adjusted), from 1996.",
    defaults: { rStar: 2, piStar: 4, measure: "cpi" },
  },
};

const state = {
  a: 0.5, b: 0.5, method: "two-sided", from: 2001, to: YEARS.at(-1),
  us: { ...COUNTRIES.us.defaults }, in: { ...COUNTRIES.in.defaults },
};

/* ---------- the output gaps (computed once per method) ---------- */
const gaps = new Map();
function gapOf(code, method) {
  const key = `${code}|${method}`;
  if (!gaps.has(key)) {
    const g = DATA[code].gdp;
    gaps.set(key, monthlyFromQuarterly(g.first, outputGap(g.values, { method }), DATA.first, N));
  }
  return gaps.get(key);
}

/* ---------- controls ---------- */
const aSlider = slider({
  label: "Weight on inflation above target, a", min: 0, max: 3, step: 0.05, value: state.a, format: (v) => fmt.num(v, 2),
  hint: "Each point of inflation raises the rate by 1 + a: by more than a point whenever a is above zero.",
  onInput: (v) => { state.a = v; update(); },
});
const bSlider = slider({
  label: "Weight on the output gap, b", min: 0, max: 3, step: 0.05, value: state.b, format: (v) => fmt.num(v, 2),
  hint: "How much the rate rises for each percent that output is above its trend.",
  onInput: (v) => { state.b = v; update(); },
});
const setWeights = (a, b) => { state.a = a; state.b = b; aSlider.value = a; bSlider.value = b; update(); };
const presets = el("div", { class: "row" },
  button("Taylor (1993): 0.5 and 0.5", () => setWeights(0.5, 0.5), { small: true }),
  button("Inflation only: 0.5 and 0", () => setWeights(0.5, 0), { small: true }),
  button("Gap weight 1: 0.5 and 1", () => setWeights(0.5, 1), { small: true }));
const methodSeg = segmented({
  label: "Output gap", value: state.method,
  options: [{ value: "two-sided", label: "Hindsight (two-sided)" }, { value: "one-sided", label: "Data to date (one-sided)" }],
  hint: "Both take real GDP as revised today and remove a Hodrick-Prescott trend (λ = 1600). The one-sided filter uses only the quarters up to each date, as a forecaster at the time would have had to.",
  onChange: (v) => { state.method = v; update(); },
});
const fromSel = select({ label: "From", value: String(state.from), options: YEARS.map(String), onChange: (v) => { state.from = Number(v); update(); } });
const toSel = select({ label: "To", value: String(state.to), options: YEARS.map(String), onChange: (v) => { state.to = Number(v); update(); } });
const setYears = (a, b) => { state.from = a; state.to = b; fromSel.value = String(a); toSel.value = String(b); update(); };
const windowPresets = el("div", { class: "row" },
  button("Taylor's years, 1987 to 1992", () => setYears(1987, 1992), { small: true }),
  button("2001 on", () => setYears(2001, YEARS.at(-1)), { small: true }),
  button("India's target, 2016 on", () => setYears(2016, YEARS.at(-1)), { small: true }));
const windowNote = el("div", { class: "hint" });
const formula = el("p", { class: "rule-eq mono" });
const controls = el("div", { class: "controls" },
  el("h2", { text: "The rule" }), formula, aSlider.el, bSlider.el, presets, methodSeg.el,
  el("div", { class: "field", role: "group", "aria-label": "Months compared" },
    el("div", { class: "lab" }, el("span", { text: "Months compared" })), el("div", { class: "row years" }, fromSel.el, toSel.el), windowPresets, windowNote),
  note("", "A description of what a rule would have prescribed, not a forecast and not investment advice."),
  el("p", { class: "hint small muted" }, `Policy rates and India's prices: Bank for International Settlements (free use with the BIS cited). US prices and output: BEA and BLS (public domain). `,
    `India's CPI for industrial workers: Labour Bureau, Government of India, as published by the OECD. India's output: World Bank Global Economic Monitor (CC BY 4.0; the page derives an output gap from it). Retrieved ${fmt.date(DATA.retrieved)}.`));

/* ---------- one panel per country ---------- */
function panel(code) {
  const C = COUNTRIES[code], s = state[code];
  const measureSel = select({ label: "Inflation measure", value: s.measure, options: C.measures.map(({ value, label }) => ({ value, label })), onChange: (v) => { s.measure = v; update(); } });
  // The two panels have the same visible labels; screen readers hear which country each belongs to.
  measureSel.input.setAttribute("aria-label", `Inflation measure, ${C.name}`);
  const message = el("div");
  const field = (key, label, hint) => {
    const f = numberField({ label, min: LIMITS[key][0], max: LIMITS[key][1], step: "any", value: s[key], hint, onInput: (v) => { s[key] = v; update(); } });
    f.input.addEventListener("input", () => {
      message.replaceChildren(...(Number.isNaN(f.value) ? [note("bad", `${label}: type a number from ${LIMITS[key][0]} to ${LIMITS[key][1]}. The charts keep the last valid value, ${fmt.num(s[key], 2)}%.`)] : []));
    });
    f.input.setAttribute("aria-label", `${label}, ${C.name}`);
    return f;
  };
  const rField = field("rStar", "Neutral real rate r*, %", code === "us" ? "Taylor's value: 2." : "A placeholder: estimates differ.");
  const piField = field("piStar", "Inflation target π*, %", code === "us" ? "The Fed's target since 2012: 2." : "The RBI's target since 2016: 4.");
  const sN = stat("Months compared"), sMean = stat("Actual minus rule, on average"), sRms = stat("Typical gap (root mean square)"), sLast = stat("Latest month");
  const status = el("p", { class: "sr-only", role: "status" });
  const rateBox = el("div"), inputBox = el("div"), fitBox = el("p", { class: "small" }), zeroBox = el("p", { class: "small" }), why = el("p", { class: "small muted", text: C.why });
  const csvBtn = button(`Download the months as CSV (${C.name})`, () => {
    if (P.last) download(`taylor-rule-${code}-${Math.min(state.from, state.to)}-${Math.max(state.from, state.to)}.csv`, toCsv(P.last.rows, C.name, P.lastLabels), "text/csv");
  }, { small: true });
  const head = el("h2", { id: `tr-${code}`, text: `${C.name}: ${C.bank}` });
  const root = el("section", { class: "panel stack country", "aria-labelledby": `tr-${code}` },
    head, el("div", { class: "grid3" }, measureSel.el, rField.el, piField.el), message, why,
    el("div", { class: "stats" }, sN.el, sMean.el, sRms.el, sLast.el), status, rateBox, zeroBox, inputBox, fitBox, el("div", { class: "row" }, csvBtn));
  const rateChart = chart(rateBox, { series: [], height: 300 });
  const inputChart = chart(inputBox, { series: [], height: 220 });
  const P = { root, rateChart, inputChart, sN, sMean, sRms, sLast, status, fitBox, zeroBox, csvBtn, last: null };
  return P;
}
const panels = { us: panel("us"), in: panel("in") };
const jump = el("nav", { class: "row jump small", "aria-label": "The two countries" }, "Jump to:",
  el("a", { href: "#tr-us", text: "the United States" }), el("a", { href: "#tr-in", text: "India" }));
const out = el("div", { class: "out" }, jump, panels.us.root, panels.in.root);
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

/* ---------- drawing ---------- */
// One point a month from first to last, null where a month has no row, so a line breaks over a gap (India's 2013).
function gapped(rows, first, last, value) {
  const byMonth = new Map(rows.map((x) => [x.month, x]));
  const out = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push([xOf(m), byMonth.has(m) ? value(byMonth.get(m)) : null]);
  return out;
}
function update() {
  const a = state.a, b = state.b;
  formula.textContent = `i = r* + π + ${fmt.num(a, 2)} (π − π*) + ${fmt.num(b, 2)} × gap`;
  const from = `${Math.min(state.from, state.to)}-01`, to = `${Math.max(state.from, state.to)}-12`;
  windowNote.textContent = state.from > state.to ? `"From" is after "To", so the two are swapped: ${from.slice(0, 4)} to ${to.slice(0, 4)}.` : "Each chart shows the months in this span for which that country has every input.";
  for (const code of ["us", "in"]) draw(code, from, to);
}

function draw(code, from, to) {
  const C = COUNTRIES[code], s = state[code], P = panels[code];
  const params = { rStar: s.rStar, piStar: s.piStar, a: state.a, b: state.b };
  const bad = checkParams(params);
  if (bad) { P.status.textContent = bad; return; }
  const idx = MONTHS.map((m, i) => (m >= from && m <= to ? i : -1)).filter((i) => i >= 0);
  const pick = (arr) => idx.map((i) => arr[i]);
  const months = pick(MONTHS), actual = pick(DATA[code].policy), inflation = pick(DATA[code].inflation[s.measure]), gap = pick(gapOf(code, state.method));
  const r = compare({ months, actual, inflation, gap, params });
  P.last = r;
  const measure = C.measures.find((m) => m.value === s.measure);
  const rateMonths = months.filter((m, k) => actual[k] != null);
  if (!r.n) {
    for (const st of [P.sN, P.sMean, P.sRms, P.sLast]) st.set("–", "");
    P.sN.set("0", "no month in this span has every input");
    const why = rateMonths.length ? `${C.name}'s ${code === "in" && s.measure === "cpi" ? "inflation (WPI to 2012, CPI from 2014)" : measure.short} or output gap is missing for every month from ${monthLabel(from)} to ${monthLabel(to)}.` : `${cap(C.bank)} has no policy rate in this span in the data used here.`;
    // An empty chart still shows the chosen years on its axis, and no stale title or subtitle.
    const blank = (title) => ({
      title, subtitle: why, label: `${title}: no data for ${monthLabel(from)} to ${monthLabel(to)}`, series: [], marks: [], empty: "Nothing to compare in these years",
      x: { format: timeLabel, label: "Year", domain: [xOf(from) - 1 / 24, xOf(to) + 1 / 24] }, y: { label: "Percent a year", domain: [0, 10], format: (v) => fmt.num(v, 0) },
    });
    P.rateChart.update(blank(`${C.name}: the policy rate and the rule, month by month`));
    P.inputChart.update(blank(`What the rule responds to in ${code === "us" ? "the United States" : C.name}`));
    P.fitBox.textContent = why;
    P.zeroBox.textContent = "";
    P.status.textContent = `${C.name}: nothing to compare. ${why}`;
    P.csvBtn.disabled = true;
    return;
  }
  P.csvBtn.disabled = false;
  const first = r.rows[0].month, last = r.rows.at(-1).month;
  const mname = measureName(code, s.measure, first, last);
  P.lastLabels = { measure: mname, gap: state.method, ...params };
  const share = (k) => fmt.pct(k / r.n, 0);
  P.sN.set(fmt.int(r.n), `${monthLabel(first)} to ${monthLabel(last)}`);
  P.sMean.set(pts(r.mean, 2), r.mean < 0 ? "the bank's rate was below the rule on average" : r.mean > 0 ? "the bank's rate was above the rule on average" : "no difference on average");
  P.sRms.set(`${fmt.num(r.rms, 1)} points`, `more than 1 point below the rule in ${fmt.int(r.looser)} months (${share(r.looser)}), above it in ${fmt.int(r.tighter)} (${share(r.tighter)})`);
  const L = r.rows.at(-1);
  P.sLast.set(`${rateText(L.actual)} vs ${fmt.num(L.rule, 1)}%`, `${monthLabel(L.month)}: actual against the rule, with ${measureName(code, s.measure, L.month, L.month)} at ${fmt.num(L.inflation, 1)}% and a gap of ${fmt.signed(L.gap, 1)}%`);

  const spanStart = xOf(first) - 1 / 24, spanEnd = xOf(last) + 1 / 24;
  const inSpan = (m) => m >= first && m <= last;
  const marks = [{ type: "hline", y: 0, text: "Zero" }];
  if (code === "in" && s.measure === "cpi" && first < "2014-01" && last >= "2014-01") marks.push({ type: "vline", x: 2014, text: "CPI from here" });
  P.rateChart.update({
    title: `${C.name}: the policy rate and the rule, month by month`,
    subtitle: `Policy rate: ${C.rateName}, end of month. Rule: Taylor's formula with ${mname} inflation and ${state.method === "two-sided" ? "a two-sided output gap, a hindsight estimate that no one had at the time" : "a one-sided output gap from GDP as revised today"}.`,
    label: `Line chart comparing ${C.bank}'s policy rate with the Taylor rule's prescription, ${monthLabel(first)} to ${monthLabel(last)}`,
    x: { format: timeLabel, label: "Year", domain: [spanStart, spanEnd] },
    y: { label: "Percent a year", format: (v) => fmt.num(v, 0) },
    series: [
      { name: "Policy rate", type: "step", data: months.map((m, k) => [xOf(m), inSpan(m) ? actual[k] : null]).filter(([, v]) => v != null), color: 0, width: 2 },
      { name: "Taylor rule", type: "line", data: gapped(r.rows, first, last, (x) => x.rule), color: 1, width: 1.8 },
    ],
    marks,
  });
  P.inputChart.update({
    title: `What the rule responds to in ${code === "us" ? "the United States" : C.name}`,
    subtitle: `12-month inflation (${mname}) and the output gap: real GDP against its Hodrick-Prescott trend, ${state.method === "two-sided" ? "fitted to all quarters" : "fitted to the quarters up to each date"}. ${C.gdpNote}`,
    label: `Line chart of inflation and the output gap for ${C.name}, ${monthLabel(first)} to ${monthLabel(last)}`,
    x: { format: timeLabel, label: "Year", domain: [spanStart, spanEnd] },
    y: { label: "Percent", format: (v) => fmt.num(v, 0) },
    series: [
      { name: `Inflation, ${mname}`, type: "line", data: gapped(r.rows, first, last, (x) => x.inflation), color: 2, width: 1.6 },
      { name: "Output gap", type: "line", data: gapped(r.rows, first, last, (x) => x.gap), color: 6, width: 1.6 },
    ],
    marks: [{ type: "hline", y: s.piStar, text: `Target ${fmt.num(s.piStar, 1)}%` }],
  });

  P.zeroBox.textContent = r.belowZero
    ? `The rule asked for a rate below zero in ${fmt.int(r.belowZero)} ${r.belowZero === 1 ? "month" : "months"} (lowest ${fmt.num(Math.min(...r.rows.map((x) => x.rule)), 1)}%, ${monthLabel(r.rows.reduce((p, q) => (q.rule < p.rule ? q : p)).month)}). ${C.bank[0].toUpperCase()}${C.bank.slice(1)} has never set its rate below zero, so in those months the gap measures what the rule wanted rather than a choice the bank made.`
    : "";
  const f = fitWeights({ months: r.rows.map((x) => x.month), actual: r.rows.map((x) => x.actual), inflation: r.rows.map((x) => x.inflation), gap: r.rows.map((x) => x.gap), rStar: s.rStar, piStar: s.piStar });
  P.fitBox.textContent = f.error
    ? `Best-fitting weights: none, because the fit ${f.error}.`
    : `The weights that would have matched ${C.bank}'s rate best over these months, with r* and π* as set: a = ${fmt.num(f.a, 2)}, b = ${fmt.num(f.b, 2)}, leaving a typical gap of ${fmt.num(f.rms, 1)} points.`
      + (f.a < 0 ? " A negative a means the rate rose by less than inflation: no rule of this shape describes these years well." : "");
  P.status.textContent = `${C.name}, ${monthLabel(first)} to ${monthLabel(last)}: the policy rate was on average ${fmt.num(Math.abs(r.mean), 1)} points ${r.mean < 0 ? "below" : "above"} the rule, `
    + `and more than a point below it in ${r.looser} of ${r.n} months.`;
}

update();
