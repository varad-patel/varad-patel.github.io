// Day 77: Compound Interest Universe. Interface.
import { $, el, fmt, mount, segmented, select, button, stat, note, chart, debounce } from "../kit/kit.js";
import { LIMITS, readPlan, simulate, closedForm, netRate, realRate, doublingYears, ruleOf72, compare } from "./logic.js";

mount();

/* ---------- formatting ---------- */
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (n) => String(n).split("").map((c) => SUP[c] ?? c).join("");
let SYMBOL = "$";
/** Money: whole units, words for trillions, powers of ten beyond a thousand trillion, never NaN or Infinity. */
function money(v) {
  if (!Number.isFinite(v)) return "too large to show";
  const sign = v < 0 ? "−" : "", a = Math.abs(v);
  if (a >= 1e15) {
    let e = Math.floor(Math.log10(a)), m = Math.round((a / 10 ** e) * 100) / 100;
    if (m >= 10) { m /= 10; e += 1; }
    return `${sign}${SYMBOL}${fmt.num(m, 2)} × 10${sup(e)}`;
  }
  if (a >= 1e12) return `${sign}${SYMBOL}${fmt.sig(a / 1e12, 4)} trillion`;
  if (a >= 1e9) return `${sign}${SYMBOL}${fmt.sig(a / 1e9, 4)} billion`;
  if (a >= 1e6) return `${sign}${SYMBOL}${fmt.sig(a / 1e6, 4)} million`;
  if (a > 0 && a < 0.01) return `${sign}less than ${SYMBOL}0.01`;
  return `${sign}${SYMBOL}${fmt.num(a, a >= 100 ? 0 : 2)}`;
}
const axisMoney = (v) => (Math.abs(v) >= 1e15 ? money(v) : Math.abs(v) >= 1e6 ? `${SYMBOL}${fmt.compact(v)}` : Math.abs(v) >= 1 || v === 0 ? `${SYMBOL}${fmt.int(v)}` : `${SYMBOL}${fmt.sig(v, 2)}`);
const pct = (v, d = 2) => `${fmt.num(v * 100, d)}%`;
const signedPct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt.num(Math.abs(v) * 100, 1)}%`;
const yearsText = (y) => (!Number.isFinite(y) ? "never" : `${fmt.num(y, 1)} years`);
const prices = (i) => (i > 0 ? `prices rising ${pct(i, 1)} a year` : i < 0 ? `prices falling ${pct(-i, 1)} a year` : "prices steady");
/** A difference in money with its sign; a sliver below one cent says so in words. */
const moneyDiff = (v) => (v === 0 ? money(0) : Math.abs(v) < 0.01 ? `${v > 0 ? "up" : "down"} by less than ${SYMBOL}0.01` : `${v > 0 ? "+" : ""}${money(v)}`);

/* ---------- inputs ---------- */
const OPENING = { start: 0, pay: 200, perYear: 12, raise: 0, age: 25, end: 65, rate: 5, fee: 0.1, inflation: 2 };
const EXAMPLES = [
  { label: "$200 a month from 25", values: OPENING },
  { label: "$300 a month from 35", values: { ...OPENING, pay: 300, age: 35 } },
  { label: "The same as the first, fees of 1.1%", values: { ...OPENING, fee: 1.1 } },
  { label: "$10,000 once at 25, nothing more", values: { ...OPENING, start: 10000, pay: 0 } },
  { label: "Pay-ins rising 3% a year with pay", values: { ...OPENING, raise: 3 } },
];
const SPEC = {
  start: { label: "Starting amount", hint: "Already saved when the plan begins." },
  pay: { label: "Paid in each month", hint: "Added at the end of each period." },
  raise: { label: "Pay-ins rise by (% a year)", hint: "For example with pay. They step up once a year, from the plan's second year. 0 keeps them flat; a negative number shrinks them." },
  age: { label: "Age now", hint: "Whole years.", whole: true },
  end: { label: "Age at the end", hint: "The plan runs until this birthday, at most 100.", whole: true },
  rate: { label: "Return before fees (% a year)", hint: "Your assumption, held constant every year. Not a forecast of any market." },
  fee: { label: "Fees (% of the balance a year)", hint: "Taken from the balance as it grows, so what they take stops growing too." },
  inflation: { label: "Inflation (% a year)", hint: "Turns money of later years into today's money." },
};
const boxes = {};
const fieldFor = (key) => {
  const id = `d77-${key}`, lim = LIMITS[key], spec = SPEC[key];
  const input = el("input", { type: "number", id, value: OPENING[key], min: lim.min, max: lim.max, step: spec.whole ? 1 : "any", inputmode: lim.min >= 0 ? (spec.whole ? "numeric" : "decimal") : null, "aria-describedby": `${id}-hint ${id}-msg` });
  input.addEventListener("input", () => changed());
  boxes[key] = input;
  const label = el("label", { for: id, text: spec.label });
  return { label, el: el("div", { class: "field" }, el("div", { class: "lab" }, label), input, el("div", { class: "hint", id: `${id}-hint`, text: spec.hint }), el("div", { class: "d77-msg", id: `${id}-msg`, "aria-live": "polite" })) };
};
const fields = Object.fromEntries(Object.keys(SPEC).map((k) => [k, fieldFor(k)]));
const often = segmented({
  label: "Pay in", value: "12", options: [{ value: "12", label: "Every month" }, { value: "1", label: "Once a year" }],
  onChange: () => { fields.pay.label.textContent = often.value === "12" ? "Paid in each month" : "Paid in each year"; changed(); },
});
const currency = select({
  label: "Currency symbol", value: "$", hint: "Only the symbol changes: the arithmetic is the same in any currency.",
  options: [{ value: "$", label: "$" }, { value: "£", label: "£" }, { value: "€", label: "€" }, { value: "₹", label: "₹" }, { value: "", label: "None" }],
  onChange: (v) => { SYMBOL = v; changed(); },
});

function setValues(values) {
  for (const k of Object.keys(SPEC)) boxes[k].value = String(values[k]);
  often.value = String(values.perYear);
  fields.pay.label.textContent = values.perYear === 12 ? "Paid in each month" : "Paid in each year";
  changed();
}

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row d77-presets", role: "group", "aria-label": "Examples" }, EXAMPLES.map((x) => button(x.label, () => setValues(x.values), { small: true }))),
    el("div", { class: "hint", text: "Illustrative plans, not recommendations." })),
  fields.start.el, often.el, fields.pay.el, fields.raise.el,
  el("div", { class: "d77-pair" }, fields.age.el, fields.end.el),
  fields.rate.el, fields.fee.el, fields.inflation.el, currency.el,
  el("div", { class: "row" }, button("Back to the opening settings", () => { currency.value = "$"; SYMBOL = "$"; comparing = "fee+1"; viewSeg.value = "real"; scaleSeg.value = "linear"; setValues(OPENING); }, { small: true })));

/* ---------- outputs ---------- */
const sReal = stat("At the end, in today's money");
const sNominal = stat("In money of that year");
const sPaid = stat("You paid in");
const sFees = stat("Fees took");
const sRate = stat("Net return a year");
const sDouble = stat("Doubling time");
const paused = el("div");
const extreme = el("div");
const check = el("p", { class: "small muted" });
const status = el("p", { class: "sr-only", role: "status" });
let comparing = "fee+1";
const compareSel = select({ label: "Compare with", value: "", options: [], onChange: (v) => { comparing = v; drawChart(); } });
const viewSeg = segmented({ label: "Show amounts in", value: "real", options: [{ value: "real", label: "Today's money" }, { value: "nominal", label: "Money of each year" }], onChange: () => drawChart() });
const scaleSeg = segmented({ label: "Scale", value: "linear", options: [{ value: "linear", label: "Even steps" }, { value: "log", label: "Each step ×10" }], onChange: () => drawChart() });
const chartBox = el("div", { id: "d77-chart" });
const tableHead = el("h2", { id: "d77-table", text: "Small differences, one at a time" });
const tableNote = el("p", { class: "small muted" });
const tableBox = el("div", { class: "d77-rt-box" });
const out = el("div", { class: "out" },
  paused,
  el("div", { class: "stats", id: "d77-results" }, sReal.el, sNominal.el, sPaid.el, sFees.el, sRate.el, sDouble.el),
  extreme, check, status,
  el("div", { class: "row d77-views" }, compareSel.el, viewSeg.el, scaleSeg.el),
  chartBox,
  el("div", { class: "d77-stack" }, tableHead, tableNote, tableBox),
  note("", "An illustration of how compound growth works under assumptions you choose, not financial advice. Real returns change from year to year, can be negative for years at a time, and no one knows them in advance; a constant return is a simplification."));
const jump = el("nav", { class: "row d77-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d77-results", "the result"], ["#d77-chart", "the chart"], ["#d77-table", "small differences"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));
const plot = chart(chartBox, { series: [], height: 320 });

/* ---------- reading ---------- */
let current = null;
const read = (k) => (boxes[k].value.trim() === "" ? NaN : Number(boxes[k].value));
const say = debounce((text) => { if (status.textContent !== text) status.textContent = text; }, 500);
const changed = debounce(() => update(), 120);

function update() {
  const input = Object.fromEntries(Object.keys(SPEC).map((k) => [k, read(k)]));
  input.perYear = Number(often.value);
  const r = readPlan(input);
  for (const k of Object.keys(SPEC)) {
    const e = r.errors.find((x) => x.key === k);
    const msg = $(`#d77-${k}-msg`);
    if (msg.textContent !== (e ? e.message : "")) msg.textContent = e ? e.message : "";
    boxes[k].classList.toggle("invalid", Boolean(e));
    if (e) boxes[k].setAttribute("aria-invalid", "true"); else boxes[k].removeAttribute("aria-invalid");
  }
  if (!r.ok) {
    paused.replaceChildren(note("warn", current ? "Fix the box marked in red; the results below are from the last settings that worked." : "Fix the box marked in red."));
    return;
  }
  paused.replaceChildren();
  current = r.plan;
  draw();
}

function draw() {
  const p = current, s = simulate(p);
  const endAge = p.age + p.years;
  const noFee = simulate({ ...p, fee: 0 });
  sReal.set(money(s.real), `at ${endAge}, after ${p.years} ${p.years === 1 ? "year" : "years"}, with ${prices(p.inflation)}`);
  sNominal.set(money(s.balance), `prices by then are ${fmt.sig(s.deflator, 3)} times today's`);
  sPaid.set(money(s.paidIn), `in money of each year (${money(s.paidInReal)} in today's money); growth added ${money(s.balance - s.paidIn)} in money of each year`);
  sFees.set(money(s.fees), p.fee > 0 ? `in money of each year. With no fees the end balance would be ${money(noFee.real)} in today's money, ${money(noFee.real - s.real)} more` : "no fees in this plan");
  sRate.set(pct(netRate(p)), `after fees; ${pct(realRate(p))} after inflation as well (exact: (1 + r)(1 − f) / (1 + π) − 1)`);
  const d = doublingYears(netRate(p));
  sDouble.set(yearsText(d), Number.isFinite(d) ? `in money of each year, at the net return; the rule of 72 says ${fmt.num(ruleOf72(netRate(p)), 1)}` : "the net return is not above zero, so money never doubles");
  const cf = closedForm(p);
  const gap = Math.abs(cf - s.balance) / Math.max(1, Math.abs(s.balance));
  check.textContent = `Check: the closed form for a growing annuity gives ${money(cf)} in money of that year, ${gap < 1e-9 ? "the same as the period-by-period sum" : `a relative difference of ${gap.toExponential(1)}`}.`;
  extreme.replaceChildren(...(s.real >= 1e12 || s.balance >= 1e12
    ? [note("warn", `A constant ${pct(p.rate, 1)} a year for ${p.years} years makes numbers beyond any economy's size. The arithmetic is exact; the assumption is not believable for this long.`)]
    : []));
  say(`At ${endAge}: ${money(s.real)} in today's money, ${money(s.balance)} in money of that year, from ${money(s.paidIn)} paid in.`);

  // The comparison list follows the plan: changes that cannot apply are left out.
  const rows = compare(p);
  // The visitor's choice is kept; if it cannot apply to this plan, the first change that can stands in for it.
  compareSel.input.replaceChildren(...rows.filter((x) => x.plan).map((x) => el("option", { value: x.id, text: x.label })));
  compareSel.value = rows.some((x) => x.plan && x.id === comparing) ? comparing : rows.find((x) => x.plan)?.id ?? "";
  drawChart();
  drawTable(rows, s, endAge);
}

function drawChart() {
  if (!current) return;
  const p = current, s = simulate(p);
  const real = viewSeg.value === "real", log = scaleSeg.value === "log";
  const pick = compare(p).find((x) => x.id === compareSel.value && x.plan);
  const v = (row) => (real ? row.balance / row.deflator : row.balance);
  const series = [{ name: "Your plan", type: "line", data: s.path.map((row) => [p.age + row.t, v(row)]), color: 0 }];
  if (pick) {
    const c = simulate(pick.plan);
    series.push({ name: pick.label, type: "line", data: c.path.map((row) => [pick.plan.age + row.t, v(row)]), color: 1 });
  }
  series.push({ name: "Paid in so far", type: "line", data: s.path.map((row) => [p.age + row.t, real ? row.paidInReal : row.paidIn]), color: "#8a94a3", dash: true });
  // With nothing saved there is nothing to draw (and a log scale cannot show zero): say so instead of empty axes.
  const nothing = !s.path.some((row) => row.balance > 0);
  plot.update({
    series: nothing ? [] : series,
    title: `The balance year by year, ${real ? "in today's money" : "in money of each year"}`,
    subtitle: log ? "Each step up the scale is ten times more; a lump sum growing at a steady rate would draw a straight line." : "Each year's growth is a share of the balance, so a positive return makes the line steeper as the years pass.",
    label: `Line chart of the balance by age for your plan${pick ? ` and with ${pick.label.toLowerCase()}` : ""}, and the amount paid in`,
    x: { label: "Age", format: (a) => fmt.int(a) },
    y: { label: real ? "Today's money" : "Money of each year", type: log ? "log" : "linear", format: axisMoney },
    empty: "Nothing to draw: the balance stays at zero",
  });
}

function drawTable(rows, s, endAge) {
  tableNote.textContent = `What each change on its own does to the balance at ${endAge}, in today's money. Your plan ends with ${money(s.real)}. Starting later moves the starting amount and every pay-in later and keeps the end age, so the balance is still counted in money of now.`;
  const table = el("table", { class: "tbl d77-rt" },
    el("caption", { text: `Balance at ${endAge} in today's money` }),
    el("thead", {}, el("tr", {}, ["Change", "Balance at the end", "Difference", "Difference (%)"].map((h, k) => el("th", { scope: "col", class: k ? "num" : null, text: h })))),
    el("tbody", {}, rows.map((x) => el("tr", {},
      el("th", { scope: "row", text: x.label }),
      ...(x.plan
        ? [el("td", { class: "num", "data-label": "Balance", text: money(x.real) }),
           el("td", { class: "num", "data-label": "Difference", text: moneyDiff(x.diff) }),
           el("td", { class: "num", "data-label": "Difference (%)", text: x.share == null ? "–" : signedPct(x.share) })]
        : [el("td", { colspan: 3, class: "d77-na", text: `Does not apply: ${x.reason}.` })])))));
  tableBox.replaceChildren(table);
}

update();
