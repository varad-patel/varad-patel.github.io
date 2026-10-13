// Day 45: Laffer Curve Explorer. Interface.
import { $, el, mount, slider, select, segmented, button, stat, note, chart, debounce } from "../kit/kit.js";
import { etiPeak, hours, base, revenue, peak, offset, side, curve, PARAMS, peakCurve, sensitivity, percent } from "./logic.js";

mount();

const state = {
  model: "eti",
  scope: "top",                                  // "top": income above a threshold; "all": one flat rate on everyone
  eti: { e: 0.25, a: 1.5, g: 0 },
  labour: { frisch: 1, gamma: 1, rebate: 1 },
  now: 0.4,
  sens: "e",
};
/** The parameters the model is run with: a flat tax on everyone is the top-bracket formula with a = 1. */
const params = () => (state.model === "eti" ? { e: state.eti.e, a: state.scope === "all" ? 1 : state.eti.a } : { ...state.labour });
const two = (v) => v.toFixed(2);
// Each parameter's name as it reads in the middle of a sentence (Frisch and Pareto keep their capitals).
const PHRASE = { e: "elasticity of taxable income", a: "Pareto parameter of top incomes", frisch: "Frisch elasticity of hours", gamma: "strength of the income effect", rebate: "share of revenue handed back" };

/* ---------- controls ---------- */
const modelSeg = segmented({
  label: "How people respond to the tax", value: "eti",
  options: [{ value: "eti", label: "Taxable income shrinks" }, { value: "labour", label: "A household chooses its hours" }],
  onChange: (v) => { state.model = v; state.sens = PARAMS[v][0].key; update({ controls: true }); },
});

const scopeSeg = segmented({
  label: "The rate applies to", value: "top",
  options: [{ value: "top", label: "Income above a high threshold" }, { value: "all", label: "All income of everyone" }],
  onChange: (v) => { state.scope = v; if (v === "all" && state.sens === "a") state.sens = "e"; update({ controls: true }); },
});
const eSlider = slider({
  label: "Elasticity of taxable income (e)", min: 0, max: 1.5, step: 0.01, value: 0.25, format: two,
  hint: "The percentage by which reported income falls when the share of an extra rupee that is kept falls by 1%. It includes work, avoidance and evasion alike.",
  onInput: (v) => { state.eti.e = v; update(); },
});
const aSlider = slider({
  label: "Pareto parameter of top incomes (a)", min: 1.1, max: 3, step: 0.05, value: 1.5, format: two,
  hint: "How thin the top of the income distribution is. Mean income above the threshold is a / (a − 1) times the threshold: three times at 1.5, twice at 2.",
  onInput: (v) => { state.eti.a = v; update(); },
});
const gSlider = slider({
  label: "Worth of ₹1 left with these taxpayers, in rupees of revenue (g)", min: 0, max: 0.9, step: 0.05, value: 0, format: two,
  hint: "0 treats revenue as the only aim, which is what the peak of the curve does. Anything above 0 gives a best rate below the peak.",
  onInput: (v) => { state.eti.g = v; update(); },
});
const setEti = (scope, e, a) => {
  state.scope = scope; scopeSeg.value = scope; state.eti.e = e; eSlider.value = e;
  if (a) { state.eti.a = a; aSlider.value = a; }
  if (scope === "all" && state.sens === "a") state.sens = "e";
  update({ controls: true });
};
const etiPresets = el("div", { class: "row", role: "group", "aria-label": "Examples from the literature" },
  button("Diamond and Saez: e 0.25, a 1.5", () => setEti("top", 0.25, 1.5), { small: true }),
  button("2012 review, low end: e 0.12", () => setEti("top", 0.12, 1.5), { small: true }),
  button("2012 review, high end: e 0.40", () => setEti("top", 0.4, 1.5), { small: true }),
  button("Gruber and Saez, taxable income: e 0.57", () => setEti("top", 0.57, 1.5), { small: true }),
  button("One flat rate on everyone: e 0.25", () => setEti("all", 0.25), { small: true }));
const etiBox = el("div", { class: "controls" }, scopeSeg.el, eSlider.el, aSlider.el, gSlider.el, etiPresets);

const fSlider = slider({
  label: "Frisch elasticity of hours", min: 0.1, max: 3, step: 0.05, value: 1, format: two,
  hint: "How strongly hours respond to the wage when the household is no richer or poorer for the change.",
  onInput: (v) => { state.labour.frisch = v; update(); },
});
const gammaSlider = slider({
  label: "Strength of the income effect", min: 0, max: 1, step: 0.05, value: 1, format: two,
  hint: "0: being poorer does not make the household work more. 1: it works exactly enough more to cancel the pull of a lower wage, so a tax that is not handed back leaves hours unchanged.",
  onInput: (v) => { state.labour.gamma = v; update(); },
});
const rebateSlider = slider({
  label: "Share of the revenue handed back as a lump sum", min: 0, max: 100, step: 5, value: 100, format: (v) => `${v}%`,
  hint: "0%: the revenue is spent on things that do not change how much people work. 100%: every household gets back what it paid, whatever it earns.",
  onInput: (v) => { state.labour.rebate = v / 100; update(); },
});
const setLabour = (frisch, gamma, rebate) => {
  Object.assign(state.labour, { frisch, gamma, rebate });
  fSlider.value = frisch; gammaSlider.value = gamma; rebateSlider.value = rebate * 100;
  update();
};
const labourPresets = el("div", { class: "row", role: "group", "aria-label": "Examples" },
  button("Full income effect, revenue handed back", () => setLabour(1, 1, 1), { small: true }),
  button("Full income effect, nothing handed back", () => setLabour(1, 1, 0), { small: true }),
  button("No income effect", () => setLabour(1, 0, 0), { small: true }));
const labourBox = el("div", { class: "controls" }, fSlider.el, gammaSlider.el, rebateSlider.el, labourPresets);

const nowSlider = slider({
  label: "A tax rate to compare with the peak", min: 0, max: 99, step: 1, value: 40, format: (v) => `${v}%`,
  hint: "Any rate you like: the tool says which side of the peak it is on.",
  onInput: (v) => { state.now = v / 100; update(); },
});
const sensSelect = select({ label: "Sensitivity chart: move this parameter", options: [{ value: "e", label: "e" }], value: "e", onChange: (v) => { state.sens = v; update(); } });

const controls = el("div", { class: "controls" }, modelSeg.el, etiBox, labourBox, nowSlider.el, sensSelect.el);

/* ---------- outputs ---------- */
const sPeak = stat("Revenue-maximising rate");
const sNow = stat("Revenue at the rate compared");
const sLost = stat("Lost to behaviour from a small rise");
const sFourth = stat("");
const status = el("p", { class: "sr-only", role: "status" });
const say = debounce((text) => { status.textContent = text; }, 700);
const verdict = el("div");
const curveBox = el("div"), sensBox = el("div"), tableBox = el("div");
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sPeak.el, sNow.el, sLost.el, sFourth.el), status, verdict, curveBox,
  el("h2", { text: "How the peak moves with each assumption" }), sensBox, tableBox,
  el("p", { class: "small muted", text: "Every number here follows from the settings on this page. None is an estimate for a particular country or year." }));
verdict.id = "r-peak"; curveBox.id = "r-curve"; sensBox.id = "r-sens";
const jump = el("nav", { class: "row small jump", "aria-label": "Parts of this tool" },
  el("span", { class: "muted", text: "Jump to:" }),
  el("a", { href: "#r-peak", text: "The peak" }), el("a", { href: "#r-curve", text: "Revenue curve" }), el("a", { href: "#r-sens", text: "Sensitivity" }));
$("#app").append(jump, el("div", { class: "tool-grid wide-controls" }, controls, out));
const curvePlot = chart(curveBox, { series: [], height: 330 });
const sensPlot = chart(sensBox, { series: [], height: 280 });

// A table that turns into a list of labelled lines on a narrow screen (see the page's <style>).
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl rt", role: "table" },
    el("caption", { text: caption }),
    el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c) => el("th", { role: "columnheader", scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row" },
      columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}
const peakText = (top) => (top.interior ? percent(top.tau) : "none below 100%");
const valueText = (key, v) => (key === "rebate" ? `${Math.round(v * 100)}%` : String(Number(v.toFixed(3)))); // 0.125 must not print as 0.13

function update({ controls: redrawControls = false } = {}) {
  const model = state.model, p = params(), tau = state.now;
  if (redrawControls) {
    etiBox.hidden = model !== "eti";
    labourBox.hidden = model !== "labour";
    aSlider.el.hidden = state.scope === "all";
    const options = PARAMS[model].filter((d) => !(model === "eti" && d.key === "a" && state.scope === "all"));
    sensSelect.input.replaceChildren(...options.map((d) => el("option", { value: d.key, text: d.label })));
    sensSelect.value = state.sens;
  }

  const top = peak(model, p);
  const best = top.interior ? revenue(model, top.tau, p) : revenue(model, 1, p);
  const here = revenue(model, tau, p);
  const lost = offset(model, tau, p);
  const where = side(model, tau, p);
  const rate = percent(tau, 0);

  sPeak.set(top.interior ? percent(top.tau) : "None below 100%", top.interior
    ? (model === "eti" ? `1 / (1 + ${state.scope === "all" ? "e" : "a × e"}) with ${state.scope === "all" ? "" : `a = ${two(p.a)}, `}e = ${two(p.e)}` : "found by solving the household's choice of hours")
    : "revenue keeps rising with the rate, because nothing here responds to it");
  // Rounded down, so that a rate just short of the peak does not read "100.0% of the most" beside "a higher rate would raise more".
  const share = best > 0 ? here / best : 0;
  const ofMost = where === "peak" || share >= 1 ? "100.0%" : `${(Math.floor(share * 1000) / 10).toFixed(1)}%`;
  sNow.set(`${ofMost} of the most`, `that can be raised, at a rate of ${rate}`);
  sLost.set(Number.isFinite(lost) ? percent(lost) : "All of it", top.interior && where === "peak" ? "all that the rise would bring in: at the peak a small change in the rate leaves revenue where it is"
    : lost >= 1 ? "more than the rise brings in: a small cut would raise revenue" : "of what it would bring in if nobody responded; a small cut pays for the same share of itself");
  if (model === "eti") {
    const chosen = etiPeak({ ...p, g: state.eti.g });
    sFourth.el.querySelector(".l").textContent = `Best rate when g = ${two(state.eti.g)}`;
    sFourth.set(percent(chosen), !top.interior ? "nothing responds, and a rupee of revenue counts for more than the g it costs these taxpayers"
      : state.eti.g === 0 ? "the same as the peak: only revenue counts" : `(1 − g) / (1 − g + ${state.scope === "all" ? "e" : "a × e"}), below the peak`);
  } else {
    sFourth.el.querySelector(".l").textContent = `Hours worked at ${rate}`;
    sFourth.set(percent(hours(tau, p)), "of the hours worked at a zero rate");
  }

  const sentence = !top.interior
    ? `With these settings there is no peak below 100%: ${model === "eti" ? "taxable income does not respond to the rate at all" : "the income effect exactly cancels the pull of the lower wage and none of the revenue comes back, so hours do not change"}. Every rise in the rate raises revenue.`
    : where === "peak" ? `${rate} is at the peak of this curve (${percent(top.tau)}): no other rate raises more.`
      : where === "left" ? `${rate} is to the left of the peak (${percent(top.tau)}): a higher rate would raise more revenue. A small rise loses ${percent(lost)} of its mechanical gain to the response, and keeps the rest.`
        : `${rate} is to the right of the peak (${percent(top.tau)}): a lower rate would raise more revenue. This is the range in which a tax cut pays for itself.`;
  verdict.replaceChildren(note(where === "right" ? "warn" : "", sentence));

  /* the revenue curve */
  const pts = curve(model, p);
  const yMax = Math.min(100, Math.max(5, Math.ceil((Math.max(...pts.map((q) => q.revenue)) * 115) / 5) * 5));
  curvePlot.update({
    title: model === "eti"
      ? `Revenue at each tax rate: ${state.scope === "all" ? "one flat rate on all income" : "a rate on income above a high threshold"}`
      : "Revenue at each tax rate: a tax on earnings",
    subtitle: `Rupees of revenue for every ₹100 that would be ${model === "eti" ? (state.scope === "all" ? "earned" : "earned above the threshold") : "earned"} at a zero rate. The dashed line is what the rate would raise if nobody changed what they did.`,
    label: "Line chart of tax revenue against the tax rate",
    x: { label: "Tax rate", domain: [0, 1], format: (v) => `${Math.round(v * 100)}%` },
    y: { label: "Revenue per ₹100 of zero-rate income", domain: [0, yMax], format: (v) => `₹${Number(v.toFixed(1))}` },
    series: [
      { name: "With the response", type: "line", color: 0, data: pts.map((q) => [q.tau, q.revenue * 100]) },
      { name: "If nobody responded", type: "line", color: "#8a94a3", dash: true, data: pts.map((q) => [q.tau, q.mechanical * 100]) },
    ],
    marks: [
      ...(top.interior ? [{ type: "vline", x: top.tau, text: `Peak ${percent(top.tau)}` }, { type: "point", x: top.tau, y: best * 100 }] : []),
      { type: "vline", x: tau, text: `Compared: ${rate}`, color: "#566478" },
    ],
  });

  /* sensitivity */
  const def = PARAMS[model].find((d) => d.key === state.sens);
  const line = peakCurve(model, p, def.key);
  const current = p[def.key];
  sensPlot.update({
    title: `Revenue-maximising rate against the ${PHRASE[def.key]}`,
    subtitle: `Everything else held at its current value. The dot is the current setting.${def.key === "e" ? " The shaded band, 0.12 to 0.40, is the range a 2012 review of the evidence called the best available estimates of the long-run elasticity in the United States." : ""}`
      + (line.some((q) => !q.interior) ? " Where the line reaches 100% there is no peak below 100%." : ""),
    label: `Line chart of the revenue-maximising rate against the ${PHRASE[def.key]}`,
    x: { label: def.label, domain: [def.min, def.max], format: (v) => valueText(def.key, v) },
    y: { label: "Revenue-maximising rate", domain: [0, 1], format: (v) => `${Math.round(v * 100)}%` },
    series: [{ name: "Revenue-maximising rate", type: "line", color: 0, data: line.map((q) => [q.value, q.tau]) }],
    marks: [
      ...(def.key === "e" ? [{ type: "span", x0: 0.12, x1: 0.4 }] : []),
      { type: "point", x: current, y: peak(model, p).tau, text: peakText(top) },
    ],
  });
  const rows = sensitivity(model, p);
  tableBox.replaceChildren(listTable({
    caption: "The peak if one setting changes and the rest stay as they are",
    columns: [
      { label: "Setting", get: (r) => r.label },
      { label: "Lower", num: true, get: (r) => `${valueText(r.key, r.low)} (${r.words[0]}): ${peakText(r.atLow)}` },
      { label: "Now", num: true, get: (r) => `${valueText(r.key, r.value)}: ${peakText(r.now)}` },
      { label: "Higher", num: true, get: (r) => `${valueText(r.key, r.high)} (${r.words[1]}): ${peakText(r.atHigh)}` },
    ],
    rows,
  }));

  say(`${top.interior ? `The revenue-maximising rate is ${percent(top.tau)}.` : "There is no revenue-maximising rate below 100%."} At ${rate}, revenue is ${ofMost} of the most that can be raised${top.interior ? `, on the ${where === "peak" ? "peak" : `${where} of the peak`}` : ""}.`);
}

update({ controls: true });
