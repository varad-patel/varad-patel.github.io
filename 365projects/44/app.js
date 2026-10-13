// Day 44: Tax Systems Compared. Interface.
import { $, el, fmt, mount, slider, select, checkbox, segmented, button, textField, textArea, stat, note, chart, debounce } from "../kit/kit.js";
import { INDIA, MAX_INCOME, STEP, SYSTEMS, indiaTax, rupees, rupeesShort, parseRupees, parseSlabs, slabsText, compare, rateCurves, oldOrNew } from "./logic.js";

mount();

const OWN_EXAMPLE = "0: 0\n500000: 10\n1500000: 25\n5000000: 40";
const state = {
  profile: { gross: 1500000, salaried: true, age: "under60", deductions: 200000, spendShare: 0.7 },
  settings: { flatRate: 0.15, flatAllowance: 400000, ownSlabs: parseSlabs(OWN_EXAMPLE).slabs, consRate: 0.18, consExempt: 0, fallPerDoubling: 0.05 },
  view: "average",
};
const pct = (x, d = 1) => fmt.pct(x, d);

/* ---------- a rupee box that keeps the last good value and says what is wrong ---------- */
function rupeeBox({ label, value, hint, what, max, onValue }) {
  const box = textField({ label, value: rupees(value).slice(1), hint, onInput: () => read() });
  box.input.setAttribute("inputmode", "decimal");
  box.input.setAttribute("maxlength", "24");
  const error = el("div");
  let good = value;
  function read() {
    const r = parseRupees(box.value, { what, max: max ? max() : MAX_INCOME });
    box.input.classList.toggle("invalid", Boolean(r.error));
    if (r.error) {
      box.input.setAttribute("aria-invalid", "true");
      error.replaceChildren(note("bad", `${r.error} The results still use ${rupees(good)}.`));
      return;
    }
    box.input.removeAttribute("aria-invalid");
    error.replaceChildren();
    good = r.value;
    onValue(r.value);
  }
  return { el: el("div", { class: "stack-s" }, box.el, error), set(v) { box.value = rupees(v).slice(1); read(); }, read };
}

/* ---------- controls: the household ---------- */
const income = rupeeBox({
  label: "Household income in a year, in rupees", value: state.profile.gross, what: "the income",
  hint: "The ₹15,00,000 is a placeholder: type your own. The page treats the household as one taxpayer with ordinary income only.",
  onValue: (v) => { state.profile.gross = v; update(); },
});
const incomePresets = el("div", { class: "row", role: "group", "aria-label": "Example incomes" },
  [600000, 1275000, 1300000, 1500000, 3000000, 7500000, 30000000].map((v) => button(rupeesShort(v), () => income.set(v), { small: true })));
const salaried = checkbox({ label: "The income is salary, so the standard deduction applies", checked: true, onChange: (on) => { state.profile.salaried = on; update(); } });
const age = select({
  label: "Age of the earner (changes the old regime only)", value: "under60",
  options: [{ value: "under60", label: "Under 60" }, { value: "60to79", label: "60 to 79" }, { value: "80plus", label: "80 or over" }],
  onChange: (v) => { state.profile.age = v; update(); },
});
const deductions = rupeeBox({
  label: "Deductions claimed under the old regime, in rupees", value: state.profile.deductions, what: "the deductions",
  hint: "Your own total of section 80C investments, health insurance, home-loan interest, house rent allowance and the like, not counting the standard deduction. The page does not check each section's limit.",
  onValue: (v) => { state.profile.deductions = v; update(); },
});
const spend = slider({
  label: "Share of income the household spends", min: 20, max: 100, step: 1, value: 70, format: (v) => `${v}%`,
  hint: "Only the consumption tax uses this. The rest of income is saved and not taxed by it.",
  onInput: (v) => { state.profile.spendShare = v / 100; update(); },
});

/* ---------- controls: the three kinds of tax ---------- */
const flatRate = slider({ label: "Flat tax: rate", min: 1, max: 50, step: 1, value: 15, format: (v) => `${v}%`, onInput: (v) => { state.settings.flatRate = v / 100; update(); } });
const flatAllowance = rupeeBox({
  label: "Flat tax: income free of tax, in rupees", value: state.settings.flatAllowance, what: "the tax-free amount",
  hint: "Everything above this is taxed at the one rate. Type 0 for a tax on every rupee.",
  onValue: (v) => { state.settings.flatAllowance = v; update(); },
});
const own = textArea({
  label: "Progressive tax: your own slabs", value: OWN_EXAMPLE, rows: 5, mono: true,
  hint: "One band to a line: the income it starts at, a colon, the rate in per cent on income inside the band. Plain slabs only: no rebate, surcharge or cess. India's two regimes are always worked out in full beside it.",
  onInput: () => readOwn(),
});
own.input.setAttribute("maxlength", "600");
const ownError = el("div");
const ownPresets = el("div", { class: "row", role: "group", "aria-label": "Slabs to start from" },
  button("India's new-regime slabs", () => { own.value = slabsText(INDIA.regimes.new.slabs()); readOwn(); }, { small: true }),
  button("India's old-regime slabs", () => { own.value = slabsText(INDIA.regimes.old.slabs("under60")); readOwn(); }, { small: true }),
  button("Example with four bands", () => { own.value = OWN_EXAMPLE; readOwn(); }, { small: true }));
function readOwn() {
  const r = parseSlabs(own.value);
  own.input.classList.toggle("invalid", Boolean(r.error));
  if (r.error) {
    own.input.setAttribute("aria-invalid", "true");
    ownError.replaceChildren(note("bad", `${r.error} The results still use the last slabs that could be read.`));
    return;
  }
  own.input.removeAttribute("aria-invalid");
  ownError.replaceChildren();
  state.settings.ownSlabs = r.slabs;
  update();
}
const consRate = slider({
  label: "Consumption tax: rate added to prices", min: 1, max: 40, step: 1, value: 18, format: (v) => `${v}%`,
  onInput: (v) => { state.settings.consRate = v / 100; update(); },
});
const consExempt = rupeeBox({
  label: "Consumption tax: yearly spending on untaxed goods, in rupees", value: 0, what: "the untaxed spending",
  hint: "Food staples, rent and anything else the tax leaves out. Type 0 if everything is taxed.",
  onValue: (v) => { state.settings.consExempt = v; update(); },
});
const fall = slider({
  label: "In the chart: fall in the share spent for each doubling of income", min: 0, max: 10, step: 1, value: 5,
  format: (v) => (v === 1 ? "1 point" : `${v} points`),
  hint: "The chart needs a share spent at every income, not only yours. It uses yours at your income and lowers it by this much for each doubling (raises it for each halving), between 20% and 100%. This is your assumption, not data.",
  onInput: (v) => { state.settings.fallPerDoubling = v / 100; update(); },
});
const viewSeg = segmented({
  label: "The chart shows", value: "average",
  options: [{ value: "average", label: "Average rate" }, { value: "marginal", label: "Marginal rate" }],
  onChange: (v) => { state.view = v; update(); },
});

const controls = el("div", { class: "controls" },
  el("h2", { text: "The household" }), income.el, incomePresets, salaried.el, age.el, deductions.el, spend.el,
  el("h2", { text: "The taxes" }), flatRate.el, flatAllowance.el, own.el, ownError, ownPresets, consRate.el, consExempt.el, fall.el);

/* ---------- outputs ---------- */
const sLow = stat("Lowest tax");
const sHigh = stat("Highest tax");
const sRegime = stat("Old regime or new");
const sCross = stat("Old regime costs no more once deductions reach");
const status = el("p", { class: "sr-only", role: "status" });
const say = debounce((text) => { status.textContent = text; }, 700);
const tableBox = el("div");
const workBox = el("div", { class: "panel" });
const chartBox = el("div");
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sLow.el, sHigh.el, sRegime.el, sCross.el), status, tableBox, workBox, viewSeg.el, chartBox,
  el("p", { class: "small muted", text: `India's figures are for tax year ${INDIA.year} (1 April 2026 to 31 March 2027) and a resident individual with no capital gains or other income taxed at special rates. The flat tax, your own slabs and the consumption tax are whatever you set: they are not designed to raise the same revenue as each other or as India's income tax.` }));
tableBox.id = "r-table"; workBox.id = "r-work"; chartBox.id = "r-chart";
const jump = el("nav", { class: "row small jump", "aria-label": "Parts of this tool" },
  el("span", { class: "muted", text: "Jump to:" }),
  el("a", { href: "#r-table", text: "The five taxes" }), el("a", { href: "#r-work", text: "India's working" }), el("a", { href: "#r-chart", text: "Rates across incomes" }));
$("#app").append(jump, el("div", { class: "tool-grid wide-controls" }, controls, out));
const plot = chart(chartBox, { series: [], height: 340 });

// A table that turns into a list of labelled lines on a narrow screen (see the page's <style>).
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl rt", role: "table" },
    el("caption", { text: caption }),
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c) => el("th", { role: "columnheader", scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row" },
      columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

function update() {
  const { profile, settings } = state;
  const rows = compare(profile, settings);
  const paid = rupees(profile.gross);

  /* headline */
  const sorted = [...rows].sort((a, b) => a.tax - b.tax);
  const lowest = sorted.filter((r) => Math.abs(r.tax - sorted[0].tax) < 0.5), highest = sorted.filter((r) => Math.abs(r.tax - sorted.at(-1).tax) < 0.5);
  const names = (list) => (list.length === rows.length ? "All five the same" : list.map((r) => r.label).join("; ")); // the labels hold commas
  sLow.set(rupees(sorted[0].tax), names(lowest));
  sHigh.set(rupees(sorted.at(-1).tax), names(highest));
  const o = oldOrNew(profile);
  if (o.cheaper === "same") sRegime.set("Same tax", `both charge ${rupees(o.newTax)} on ${paid}, to the nearest rupee`);
  else sRegime.set(`${o.cheaper === "new" ? "New" : "Old"}, by ${rupees(o.saving)}`, `new ${rupees(o.newTax)}, old ${rupees(o.oldTax)} with ${rupees(Math.min(profile.deductions, o.room))} of deductions`);
  sCross.set(rupees(o.breakEven), o.breakEven === 0
    ? "at this income the old regime costs no more than the new even with none"
    : `${pct(o.breakEven / profile.gross, 0)} of income${profile.salaried ? ", on top of the standard deduction" : ""}`);

  /* the five systems */
  tableBox.replaceChildren(listTable({
    caption: `What a household with ${paid} a year pays under each tax. The average rate is tax as a share of income; the marginal rate, in brackets, is the tax on the next ${rupees(STEP)} as a share of it.`,
    columns: [
      { label: "Tax", get: (r) => r.label },
      { label: "Tax in a year", num: true, get: (r) => rupees(r.tax) },
      { label: "Average rate", num: true, get: (r) => pct(r.average, 2) },
      { label: `On the next ${rupees(STEP)}`, num: true, get: (r) => `${rupees(r.next)} (${pct(r.marginal, 1)})` },
      { label: "Left after tax", num: true, get: (r) => rupees(r.left) },
    ],
    rows,
  }));

  /* India: the working */
  const n = indiaTax(profile, "new"), d = indiaTax(profile, "old");
  const minus = (v) => (v > 0 ? `−${rupees(v)}` : rupees(0));
  const steps = [
    ["Income", (t) => rupees(t.gross)],
    ["Standard deduction (salary only)", (t) => minus(t.standard)],
    ["Other deductions (old regime only)", (t) => minus(t.claimed)],
    ["Taxable income", (t) => rupees(t.taxable)],
    ["Tax on the slabs", (t) => rupees(t.slabTax)],
    ["Rebate (section 156)", (t) => minus(t.rebate)],
    ["Surcharge", (t) => (t.surchargeRate ? `${rupees(t.surcharge)} (${pct(t.surchargeRate, 0)}${t.surchargeRelief > 0.005 ? `, less marginal relief of ${rupees(t.surchargeRelief)}` : ""})` : rupees(0))],
    ["Health and education cess (4%)", (t) => rupees(t.cess)],
    ["Income tax payable", (t) => rupees(t.total)],
  ];
  // replaceChildren would print the word "null" for a note that is not needed, so the empty ones are filtered out.
  workBox.replaceChildren(...[
    el("h2", { text: `India's income tax for tax year ${INDIA.year}: the working` }),
    el("div", { class: "rt-wrap" }, listTable({
      caption: `Resident individual, ${profile.salaried ? "salary" : "income other than salary"} of ${paid}`,
      columns: [{ label: "Step", get: (s) => s[0] }, { label: "New regime", num: true, get: (s) => s[1](n) }, { label: "Old regime", num: true, get: (s) => s[1](d) }],
      rows: steps,
    })),
    n.rebate > 0 && n.taxable > INDIA.regimes.new.rebate.limit
      ? note("warn", `This income is inside the new regime's marginal-relief zone: taxable income is ${rupees(n.taxable - 1200000)} above ₹12,00,000, so the tax before cess is that excess and each further rupee of income is taken in full, plus 4% cess.`) : null,
    d.rebate === 0 && d.taxable > 500000 && d.taxable <= 500000 + STEP
      ? note("warn", "Taxable income under the old regime is just above ₹5,00,000, where its rebate stops all at once.") : null,
  ].filter(Boolean));

  /* rates across incomes */
  const curves = rateCurves(profile, settings);
  const marginal = state.view === "marginal";
  const inRange = profile.gross >= 200000 && profile.gross <= 1e9;
  plot.update({
    title: marginal ? `Marginal rate: tax on the next ${rupees(STEP)} of income, as a share of it` : "Average rate: tax as a share of income",
    subtitle: marginal
      ? "A line at 104% means every extra rupee is taken in tax, and 4% cess on top. The new regime is there between taxable incomes of ₹12,00,000 and ₹12,70,588, and both regimes for a stretch above each surcharge threshold. Where the old regime's line leaves the top of the chart, its rebate has ended in a single step at a taxable income of ₹5,00,000 and the next ₹1,000 costs many times ₹1,000: the table under the chart has the figure."
      : "Each line is one tax applied to every income from ₹2 lakh to ₹100 crore, keeping the rest of the household's profile as entered.",
    label: `${marginal ? "Marginal" : "Average"} tax rate by income under five taxes`,
    x: { label: "Household income in a year (log scale)", type: "log", domain: [200000, 1e9], format: rupeesShort },
    y: { label: marginal ? "Marginal rate" : "Average rate", domain: marginal ? [0, 1.2] : null, zero: true, format: (v) => `${Math.round(v * 1000) / 10}%` },
    series: curves.map((c, k) => ({ name: c.label, type: "line", color: k, data: c.points.map((q) => [q.income, marginal ? q.marginal : q.average]) })),
    marks: inRange ? [{ type: "vline", x: profile.gross, text: `This household: ${rupeesShort(profile.gross)}` }] : [],
  });

  say(`Household income ${paid}. ${rows.map((r) => `${r.label} ${rupees(r.tax)}`).join(", ")}. `
    + (o.cheaper === "same" ? "The old and new regimes charge the same." : `The ${o.cheaper} regime is cheaper by ${rupees(o.saving)}.`));
}

update();
