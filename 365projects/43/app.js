// Day 43: Basic Income Microsimulation. Interface.
import { $, el, fmt, mount, slider, segmented, numberField, button, stat, note, table, chart, debounce, randomSeed } from "../kit/kit.js";
import { POPULATION, PRESENT, GINI_RANGE, SEED_MAX, POVERTY_SHARE, begin, extend, finish, prepare, taxOn, childAmount, simulate, netCost, balance } from "./logic.js";

mount();

const NO_ALLOWANCE = { allowance: 0, basicRate: PRESENT.basicRate, threshold: PRESENT.threshold, higherRate: PRESENT.higherRate };
const state = { seed: 43, gini: 0.45, reform: null, pop: null, base: null };

/* ---------- words and numbers ---------- */
const rupees = (n) => `${n < 0 ? "-" : ""}₹${fmt.int(Math.abs(n))}`;
const signedRupees = (n) => (Math.round(n) === 0 ? "₹0" : `${n > 0 ? "+" : "-"}₹${fmt.int(Math.abs(n))}`);
const rate = (v) => `${fmt.num(v, 1)}%`;
const one = (x) => Math.round(x * 10) / 10;
const schedule = (s) => (s.allowance >= s.threshold
  ? `nothing on the first ${rupees(s.allowance)} a month and ${rate(s.higherRate)} on the rest`
  : `${s.allowance ? `nothing on the first ${rupees(s.allowance)} a month, then ` : ""}${rate(s.basicRate)} up to ${rupees(s.threshold)} and ${rate(s.higherRate)} above`);

/* ---------- the reform ---------- */
const amountSlider = slider({ label: "Basic income for each adult", min: 0, max: 20000, step: 100, value: 6000, format: (v) => `${rupees(v)} a month`, onInput: (v) => change({ amount: v }) });
const childSeg = segmented({ label: "For each child", value: "0.5", options: [{ value: "0", label: "Nothing" }, { value: "0.5", label: "Half" }, { value: "1", label: "The same" }], onChange: (v) => change({ childShare: Number(v) }) });
const allowanceSlider = slider({ label: "Tax-free allowance", min: 0, max: 30000, step: 500, value: 0, format: (v) => (v ? `${rupees(v)} a month` : "none"), onInput: (v) => change({ allowance: v }) });
const basicSlider = slider({ label: "Basic rate of income tax", min: 0, max: 100, step: 0.1, value: 20, format: rate, onInput: (v) => change({ basicRate: one(v) }) });
const thresholdSlider = slider({ label: "Higher rate starts at", min: 20000, max: 300000, step: 5000, value: 80000, format: (v) => `${rupees(v)} a month`, onInput: (v) => change({ threshold: v }) });
const higherSlider = slider({ label: "Higher rate", min: 0, max: 100, step: 0.1, value: 40, format: rate, onInput: (v) => change({ higherRate: one(v) }) });
const balanceNote = el("div", { role: "status" });

function setReform(reform) {
  state.reform = { ...reform };
  amountSlider.value = reform.amount; childSeg.value = String(reform.childShare); allowanceSlider.value = reform.allowance;
  basicSlider.value = reform.basicRate; thresholdSlider.value = reform.threshold; higherSlider.value = reform.higherRate;
}
function change(part) {
  Object.assign(state.reform, part);
  balanceNote.replaceChildren();
  later();
}
/**
 * Move both rates by the same amount until the reform just pays for itself, and say what was done.
 * `then` runs the redraw: at once when a button is pressed, as a separate step while the page is loading.
 */
function payForIt(then = (f) => f()) {
  if (!state.base) return;
  const b = balance(state.pop, state.base, state.reform);
  if (b.error) { balanceNote.replaceChildren(note("bad", b.error)); return; }
  if (!b.possible) {
    balanceNote.replaceChildren(note("bad", `No pair of rates can pay for this. Even with both at 100%, the basic income would cost ${rupees(Math.round(b.netCostAtMost / state.pop.people))} a person a month more than the extra tax. Lower the basic income, or the allowance.`));
    return;
  }
  const { basicRate, higherRate } = b.reform, was = state.reform;
  // The two rates move together unless one of them runs into 0% or 100% on the way.
  const together = Math.abs((basicRate - was.basicRate) - (higherRate - was.higherRate)) < 1e-9;
  const moved = (name, from, to) => (from === to ? `the ${name} stays at ${rate(to)}` : `the ${name} goes from ${rate(from)} to ${rate(to)}`);
  const text = b.shift === 0 ? `The rates already just pay for it: ${rate(basicRate)} and ${rate(higherRate)}.`
    : together ? `Both rates ${b.shift > 0 ? "raised" : "lowered"} by ${fmt.num(Math.abs(b.shift), 1)} ${Math.abs(b.shift) === 1 ? "point" : "points"}, to ${rate(basicRate)} and ${rate(higherRate)}.`
      : `Rates ${b.shift > 0 ? "raised" : "lowered"}: ${moved("basic rate", was.basicRate, basicRate)} and ${moved("higher rate", was.higherRate, higherRate)}. A rate that reaches 0% or 100% stops there.`;
  setReform(b.reform);
  then(() => { compute(); balanceNote.replaceChildren(note("good", text)); });
}

const PRESETS = [
  { label: "Present system", make: () => ({ amount: 0, childShare: 0.5, ...PRESENT }) },
  { label: "₹6,000, paid for", make: () => ({ amount: 6000, childShare: 0.5, ...NO_ALLOWANCE }), pay: true },
  { label: "₹6,000, taxes unchanged", make: () => ({ amount: 6000, childShare: 0.5, ...PRESENT }) },
  { label: "Allowance turned into a payment", make: () => ({ amount: 2000, childShare: 0.5, ...NO_ALLOWANCE }), pay: true },
  { label: "Poverty-line income, one tax rate", make: () => ({ amount: Math.ceil(state.base.line / 100) * 100, childShare: 0.5, ...NO_ALLOWANCE, higherRate: PRESENT.basicRate }), pay: true },
];
function usePreset(p, then) {
  if (!state.base) return;
  setReform(p.make());
  balanceNote.replaceChildren();
  if (p.pay) payForIt(then); else compute();
}
const presetRow = el("div", { class: "row", role: "group", "aria-label": "Example reforms" }, PRESETS.map((p) => button(p.label, () => usePreset(p), { small: true })));

/* ---------- the population ---------- */
const seedField = numberField({ label: "Seed", min: 0, max: SEED_MAX, step: 1, value: state.seed, hint: "The same seed always draws the same households." });
const seedNote = el("div");
const giniSlider = slider({
  label: "Inequality of market incomes (Gini)", min: GINI_RANGE[0], max: GINI_RANGE[1], step: 0.01, value: state.gini, format: (v) => fmt.num(v, 2),
  hint: "Of adults who have an income. 0 is everyone the same; higher is more unequal.",
  onInput: (v) => { state.gini = Math.round(v * 100) / 100; redraw(); },
});
const popText = el("p", { class: "small" });
// What the box holds may not be a seed. The message names the seed of the population on screen, and is written
// again whenever a new population lands: typing "1.5" passes through "1", which is a seed and gets drawn.
function seedProblem() {
  const bad = !Number.isInteger(seedField.value);
  seedField.input.classList.toggle("invalid", bad);
  seedNote.replaceChildren(...(bad ? [note("bad", `The seed must be a whole number from 0 to ${fmt.int(SEED_MAX)}. The population shown still uses seed ${state.pop ? state.pop.settings.seed : state.seed}.`)] : []));
  return bad;
}
seedField.input.addEventListener("input", () => {
  if (seedProblem()) return;
  state.seed = seedField.value;
  redraw();
});
const popBox = el("details", { class: "more", open: window.matchMedia("(min-width: 861px)").matches },
  el("summary", { text: "The simulated population" }),
  el("div", {},
    popText, seedField.el, seedNote,
    el("div", { class: "row" }, button("Draw a new population", () => {
      state.seed = randomSeed() % (SEED_MAX + 1);
      seedField.value = state.seed;
      seedProblem();
      population();
    }, { small: true })),
    giniSlider.el));

const controls = el("div", { class: "controls" },
  presetRow, amountSlider.el, childSeg.el, allowanceSlider.el, basicSlider.el, thresholdSlider.el, higherSlider.el,
  el("div", { class: "row" },
    button("Make it pay for itself", () => payForIt(), { primary: true }),
    button("Reset", () => { state.seed = 43; state.gini = 0.45; seedField.value = 43; giniSlider.value = 0.45; seedProblem(); population(true); }, { small: true })),
  el("p", { class: "small muted", text: "The button moves both tax rates by the same number of points until the extra tax just covers the basic income." }),
  balanceNote, popBox);

/* ---------- outputs ---------- */
const sGross = stat("Basic income paid"), sNet = stat("Left unpaid"), sPoor = stat("Poverty rate"), sGini = stat("Inequality (Gini)"), sWin = stat("People who gain");
const status = el("p", { class: "sr-only", role: "status" });
const working = el("p", { class: "small muted", hidden: true });      // progress while a population is drawn; the result is what gets read out
const budget = el("div"), accounts = el("div"), tenthsChartBox = el("div"), tenthsTable = el("div"), examples = el("div"), schedules = el("p", { class: "small" });
const out = el("div", { class: "out" },
  note("warn", el("strong", { text: "These people are simulated. " }), `${fmt.int(POPULATION.households)} households are drawn from stated distributions, described under "The simulated population". They are not survey data and not any country. Nobody changes how much they work or earn when taxes change.`),
  working,
  el("div", { class: "stats" }, sGross.el, sNet.el, sPoor.el, sGini.el, sWin.el),
  status, budget,
  el("h2", { text: "Winners and losers by tenth of the population" }),
  el("p", { class: "small muted", text: "People are ranked by their household's income per equivalent adult under the present system and cut into ten groups of equal size, poorest first." }),
  tenthsChartBox, tenthsTable,
  el("h2", { text: "The accounts" }), accounts,
  el("h2", { text: "The two tax schedules" }), schedules, examples);

$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out));
const tenthsChart = chart(tenthsChartBox, { series: [], height: 300 });

/* ---------- drawing ---------- */
/**
 * Work out the reform and show it. Running the model takes a few milliseconds; redrawing the chart and the three
 * tables takes several times longer. So the five headline figures and the verdict are written at once, and
 * while a slider is moving (`resting` false) the chart and tables wait until it has been still for a quarter of
 * a second. They are then redrawn one at a time, so that no single step holds the page up, and a newer
 * request abandons an older one.
 */
const DETAIL_WAIT = 250;
let drawing = 0;
function compute(resting = true) {
  const { pop, base } = state;
  if (!base || !state.reform) return;              // the first population is still being drawn
  const reform = { ...state.reform };              // a copy: the tables are drawn a moment later, for this reform
  const r = simulate(pop, base, reform);
  if (r.error) { budget.replaceChildren(note("bad", r.error)); return; }
  const P = pop.people, perHead = (x) => Math.round(x / P);
  const share = (x) => fmt.pct(x / pop.marketIncome, 1);

  // Is it paid for? Just, if rates a tenth of a point lower would leave a cost.
  const lower = { ...reform, basicRate: Math.max(0, one(reform.basicRate - 0.1)), higherRate: Math.max(0, one(reform.higherRate - 0.1)) };
  const just = r.netCost <= 0 && (r.netCost === 0 || netCost(pop, base, lower) > 0);
  const nothing = r.gainers === 0 && r.losers === 0;
  let kind, text;
  if (nothing) { kind = ""; text = "Nobody's income changes: there is no basic income and this schedule takes the same tax from everyone as the present one."; }
  else if (r.netCost > 0) { kind = "warn"; text = `Not paid for. The basic income costs ${rupees(perHead(r.gross))} a person a month and the tax changes ${r.extraTax >= 0 ? "raise" : "lose"} ${rupees(perHead(Math.abs(r.extraTax)))}, leaving ${rupees(perHead(r.netCost))} a person a month (${share(r.netCost)} of all market income) to come from borrowing or from cuts elsewhere. Press "Make it pay for itself" to find the rates that cover it.`; }
  else if (just) { kind = "good"; text = `Paid for. The extra income tax covers the basic income${r.netCost < 0 ? `, with ${rupees(Math.round(-r.netCost / P))} a person a month to spare; rates a tenth of a point lower would leave a shortfall` : " exactly"}.`; }
  else { kind = ""; text = `More than paid for. The tax changes raise ${rupees(perHead(-r.netCost))} a person a month more than the basic income costs. Press "Make it pay for itself" to lower both rates until it just covers the cost.`; }
  budget.replaceChildren(note(kind, text));

  const gain = one((100 * r.gainers) / P), same = one((100 * r.unchanged) / P), lose = one(100 - gain - same);
  sGross.set(rupees(perHead(r.gross)), `a person a month, ${share(r.gross)} of all market income`);
  sNet.set(r.netCost > 0 ? rupees(perHead(r.netCost)) : "nothing", r.netCost > 0 ? `a person a month, ${share(r.netCost)} of market income` : nothing ? "there is nothing to pay for" : `the tax changes raise ${rupees(perHead(r.extraTax))} a person`);
  sPoor.set(fmt.pct(r.poverty.after, 1), `${fmt.pct(r.poverty.before, 1)} under the present system`);
  sGini.set(fmt.num(r.gini.after, 3), `${fmt.num(r.gini.before, 3)} under the present system`);
  sWin.set(`${fmt.num(gain, 1)}%`, `${fmt.num(lose, 1)}% lose${same >= 0.05 ? `, ${fmt.num(same, 1)}% see no change` : ""}`);
  status.textContent = nothing ? "Nobody's income changes: no basic income and no change in anyone's tax."
    : `A basic income of ${rupees(reform.amount)} a month costs ${rupees(perHead(r.gross))} a person. ${r.netCost > 0 ? `${rupees(perHead(r.netCost))} a person is not paid for.` : "It is paid for."} Poverty goes from ${fmt.pct(r.poverty.before, 1)} to ${fmt.pct(r.poverty.after, 1)}, the Gini from ${fmt.num(r.gini.before, 3)} to ${fmt.num(r.gini.after, 3)}. ${fmt.num(gain, 1)}% of people gain and ${fmt.num(lose, 1)}% lose.`;

  // By tenth.
  const tenths = r.deciles.map((d, i) => ({ tenth: i + 1, people: d.people, income: Math.round(d.baseIncome / d.people), change: Math.round(d.change / d.people), gain: d.gainers / d.people, lose: d.losers / d.people }));
  function drawTenthsChart() {
    tenthsChart.update({
      title: "Average change in income per person", subtitle: "Rupees a month, tax and basic income together. Tenth 1 is the poorest.",
      label: "Bar chart of the average change in monthly income per person in each tenth of the population, poorest to richest",
      x: { type: "band", label: "Tenth of the population", categories: tenths.map((t) => String(t.tenth)) },
      y: { label: "Change (₹ a month)", format: (v) => fmt.int(v) },
      series: [{ name: "Average change per person", type: "bars", color: 0, data: tenths.map((t) => [String(t.tenth), t.change]) }],
    });
  }
  function drawTenthsTable() {
    tenthsTable.replaceChildren(table({
      caption: "Each tenth, per person per month",
      columns: [
        { key: "tenth", label: "Tenth", format: (v) => (v === 1 ? "1 (poorest)" : v === 10 ? "10 (richest)" : String(v)) },
        { key: "income", label: "Income now", num: true, format: rupees },
        { key: "change", label: "Change", num: true, format: signedRupees },
        { key: "gain", label: "Gain", num: true, format: (v) => fmt.pct(v, 0) },
        { key: "lose", label: "Lose", num: true, format: (v) => fmt.pct(v, 0) },
      ],
      rows: tenths,
    }));
  }

  // The accounts, in whole rupees for the whole simulated population.
  function drawAccounts() {
    const rows = [
      { what: `Basic income paid to ${fmt.int(pop.nAdults)} adults and ${fmt.int(pop.nChildren)} children`, amount: rupees(r.gross) },
      { what: "Income tax under the present system", amount: rupees(r.taxPresent) },
      { what: "Income tax under the reform", amount: rupees(r.taxReform) },
      { what: "Extra tax raised (reform less present)", amount: rupees(r.extraTax) },
      { what: "Net cost (basic income less extra tax)", amount: rupees(r.netCost) },
      { what: "Check: every household's change in income, added up", amount: rupees(r.changeSum) },
    ];
    accounts.replaceChildren(
      table({ caption: `Rupees a month, all ${fmt.int(P)} simulated people`, columns: [{ key: "what", label: "Item" }, { key: "amount", label: "Rupees a month", num: true }], rows }),
      el("p", { class: "small muted", text: r.changeSum === r.netCost ? "The last two lines agree to the rupee: what the reform costs is what households gain, and a negative figure is a surplus." : "The last two lines should agree and do not: please report this." }));
  }

  // One adult living alone, at five incomes.
  function drawExamples() {
    const Bc = childAmount(reform);
    schedules.replaceChildren(
      el("strong", { text: "Present: " }), `${schedule(PRESENT)}, and no basic income. `,
      el("strong", { text: "Reform: " }), `${schedule(reform)}, with ${rupees(reform.amount)} a month for each adult and ${Bc ? rupees(Bc) : "nothing"} for each child.`);
    examples.replaceChildren(table({
      caption: "An adult living alone, per month",
      columns: [
        { key: "y", label: "Market income", num: true, format: rupees },
        { key: "now", label: "Tax now", num: true, format: rupees },
        { key: "then", label: "Tax after", num: true, format: rupees },
        { key: "net", label: "Change in income", num: true, format: signedRupees },
      ],
      rows: [0, 15000, 30000, 60000, 150000].map((y) => { const now = taxOn(y, PRESENT), then = taxOn(y, reform); return { y, now, then, net: reform.amount - (then - now) }; }),
    }));
  }

  // The chart and the tables, now or once the slider rests.
  const details = [tenthsChartBox, tenthsTable, accounts, schedules, examples];
  const steps = [drawTenthsChart, drawTenthsTable, drawAccounts, drawExamples];
  const token = ++drawing;
  for (const d of details) d.setAttribute("aria-busy", "true");
  const run = (i) => {
    if (token !== drawing) return;
    if (i === steps.length) { for (const d of details) d.removeAttribute("aria-busy"); return; }
    steps[i]();
    setTimeout(() => run(i + 1), 0);
  };
  if (resting) run(0); else setTimeout(() => run(0), DETAIL_WAIT);
}
const later = debounce(() => compute(false), 60);

/**
 * Draw the population for the current seed and Gini, then show the reform on it. The work is cut into steps
 * (households in slices, then the present system, then the reform) so the page never stops answering, and a
 * newer request abandons an older one.
 */
let job = 0;
function population(reset = false) {
  const token = ++job;
  const draft = begin({ seed: state.seed, gini: state.gini });
  if (draft.error) { seedNote.replaceChildren(note("bad", draft.error)); return; }
  const next = (step) => setTimeout(() => { if (token === job) step(); }, 0);
  const say = (text) => { working.textContent = text; working.hidden = !text; };
  const draw = () => {
    const t0 = performance.now();
    let done = false;
    while (!done && performance.now() - t0 < 20) done = extend(draft, 500);
    if (!done) { say(`Drawing households: ${fmt.int(draft.done)} of ${fmt.int(draft.H)}…`); next(draw); return; }
    say("Working out the present system…");
    next(() => {
      const pop = finish(draft);
      state.pop = pop;
      state.base = prepare(pop);
      describe(pop);
      say("Applying the reform…");
      next(() => {
        if (reset || !state.reform) usePreset(PRESETS[1], next); else { balanceNote.replaceChildren(); compute(); }
        next(() => say(""));
      });
    });
  };
  draw();
}
function describe(pop) {
  seedProblem();
  const earned = Array.from(pop.income).filter((y) => y > 0).sort((a, b) => a - b);
  const share = (table) => table.map(([n, p]) => `${fmt.pct(p, 0)} ${n === 0 ? "none" : n === 1 ? "one" : n === 2 ? "two" : "three"}`).join(", ");
  popText.textContent = `${fmt.int(pop.H)} households, drawn from seed ${pop.settings.seed}. Adults: ${share(POPULATION.adults)}. Children: ${share(POPULATION.children)}. ${fmt.pct(POPULATION.noIncome, 0)} of adults have no market income; the rest draw one from a lognormal distribution with a median of ${rupees(POPULATION.median)} a month and a Gini coefficient of ${fmt.num(pop.settings.gini, 2)}. This draw: ${fmt.int(pop.people)} people, of whom ${fmt.int(pop.nChildren)} are children; the median income of adults who have one is ${rupees(earned[Math.floor(earned.length / 2)])}. The poverty line is ${fmt.pct(POVERTY_SHARE, 0)} of the median income per equivalent adult under the present system, ${rupees(Math.round(state.base.line))} a month.`;
}
const redraw = debounce(() => population(), 150);

population(true);
