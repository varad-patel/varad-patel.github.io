// Day 54: The Education Premium. Interface.
import { $, el, fmt, mount, slider, select, segmented, button, stat, note, table, chart } from "../kit/kit.js";
import { MINCER } from "./data.js";
import { LEVELS, SEXES, AGE_MIN, AGE_MAX, compare, predict, profileCurve, histogram, returnPerYear, cellMean, groupMeans } from "./logic.js";

mount();

const PHRASE = { none: "no high school diploma", hs: "a high school diploma", some: "some college but no degree", assoc: "an associate's degree", bach: "a bachelor's degree", mast: "a master's degree", prof: "a professional degree", doct: "a doctorate" };
const phrase = (i) => PHRASE[LEVELS[i].key];
const dollars = (x) => `$${fmt.int(Math.round(x / 100) * 100)}`;        // to the nearest hundred: the data cannot support more
const axisDollars = (x) => `$${fmt.compact(x)}`;
const pct0 = (x) => fmt.pct(x, 0);
// A figure that rounds to nothing carries no sign: "0%", never "−0%".
const signedPct = (x, d = 0) => { const t = fmt.pct(Math.abs(x), d); return /^0(\.0+)?%$/.test(t) ? t : `${x >= 0 ? "+" : "−"}${t}`; };
// A 95% interval, with as many decimal places (from `digits` up to 2) as it takes for its two ends to read differently:
// never "+3.3% to +3.3%".
const interval = (ci, digits = 0) => {
  for (let d = digits; d <= 2; d++) { const a = signedPct(ci[0], d), b = signedPct(ci[1], d); if (a !== b) return `${a} to ${b}`; }
  return `within 0.01 of a point of ${signedPct((ci[0] + ci[1]) / 2, 2)}`;
};
const bandText = (b) => `${MINCER.bands[b][0]} to ${MINCER.bands[b][1]}`;
const who = (sex, many = true) => (sex === "women" ? (many ? "women" : "woman") : many ? "men" : "man");
// Who every figure is about, for titles and captions that may be read on their own.
const SAMPLE = "full-time, year-round employees";

const state = { sex: "women", age: 35, from: 1, to: 4 };

/** Mark each cell with its column name so that a wide table can be shown as a list on a phone. */
function stacked(wrap) {
  const heads = [...wrap.querySelectorAll("thead th")].map((th) => th.textContent);
  for (const tr of wrap.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => td.setAttribute("data-label", heads[i] ?? ""));
  wrap.classList.add("stack");
  return wrap;
}

/* ---------- controls ---------- */
const sexSeg = segmented({ label: "Sex", value: state.sex, options: SEXES.map((s) => ({ value: s.key, label: s.label })), hint: "The survey records sex as male or female, and the model is fitted separately for each.", onChange: (v) => { state.sex = v; update(); } });
const ageSlider = slider({ label: "Age", min: AGE_MIN, max: AGE_MAX, step: 1, value: state.age, format: (v) => String(v), onInput: (v) => { state.age = v; update(); } });
const levelOptions = LEVELS.map((l, i) => ({ value: String(i), label: l.label }));
const fromSel = select({ label: "Your highest level of education", value: String(state.from), options: levelOptions, onChange: (v) => { state.from = Number(v); update(); } });
const toSel = select({ label: "Compare with", value: String(state.to), options: levelOptions, hint: "A level you are thinking of studying for, or any other. The comparison is between the people who hold each level now: it is not a forecast of what studying would add to your own pay.", onChange: (v) => { state.to = Number(v); update(); } });
const swapBtn = button("Swap the two levels", () => { [state.from, state.to] = [state.to, state.from]; fromSel.value = state.from; toSel.value = state.to; update(); }, { small: true });
const resetBtn = button("Back to the opening example", () => { Object.assign(state, { sex: "women", age: 35, from: 1, to: 4 }); sexSeg.value = "women"; ageSlider.value = 35; fromSel.value = 1; toSel.value = 4; update(); }, { small: true });
const controls = el("div", { class: "controls" }, sexSeg.el, ageSlider.el, fromSel.el, toSel.el, el("div", { class: "row" }, swapBtn, resetBtn),
  el("p", { class: "small muted", text: `United States, ${MINCER.year}. Employees aged ${AGE_MIN} to ${AGE_MAX} who usually work 35 hours or more a week and worked at least 50 weeks of the year. Pay is wages and salary before tax, in ${MINCER.dollars} dollars a year.` }));

/* ---------- outputs ---------- */
const tiles = { from: stat("–"), to: stat("–"), gap: stat("Average gap"), upset: stat("How often the lower-paid level wins") };
const tileLabel = (t) => t.el.querySelector(".l");
const sentence = el("p", { class: "summary", role: "status" });
const flags = el("div", { class: "flags" });
const profileBox = el("div"), distBox = el("div"), gapBox = el("div"), levelsBox = el("div");
const profileChart = chart(profileBox, { series: [], height: 340 });
const distChart = chart(distBox, { series: [], height: 280 });

function update() {
  const { sex, age, from, to } = state;
  const c = compare({ sex, age, from, to });
  const band = c.band;
  const fromName = phrase(from), toName = phrase(to);

  tileLabel(tiles.from).textContent = `With ${fromName}`;
  tiles.from.set(dollars(c.from.central), `central estimate a year. The middle 80% of such people: ${dollars(c.from.p10)} to ${dollars(c.from.p90)}`);
  tileLabel(tiles.to).textContent = c.same ? "The level compared with it" : `With ${toName}`;
  tiles.to.set(c.same ? "–" : dollars(c.to.central), c.same ? "choose a different level to compare" : `central estimate a year. The middle 80% of such people: ${dollars(c.to.p10)} to ${dollars(c.to.p90)}`);
  // Small cases: two levels whose estimates round to the same figure, or differ by less than 1%, are not "0% more".
  const dir = c.gap.pct >= 0 ? "more" : "less";
  const level = dollars(c.from.central) === dollars(c.to.central), tiny = Math.abs(c.gap.pct) < 0.005;
  const apart = Math.round(Math.abs(c.gap.dollars) / 100) === 0 ? "less than $100 a year apart" : `${dollars(Math.abs(c.gap.dollars))} a year ${dir}`;
  // "More" or "less" is only a finding if the whole 95% interval is on one side of zero.
  const unsure = !c.same && c.gap.ci[0] < 0 && c.gap.ci[1] > 0;
  const ciText = interval(c.gap.ci, tiny || unsure ? 1 : 0);
  tiles.gap.set(c.same ? "–" : level || tiny ? "under 1%" : signedPct(c.gap.pct), c.same ? "" : unsure
    ? `${apart}, but the 95% interval, ${ciText}, includes no gap at all: the survey cannot say which level is paid more on average at this age`
    : `${apart}. The average is known closely: 95% interval ${ciText}`);
  tiles.upset.set(c.same ? "–" : pct0(c.upset), c.same ? "" : `of the time, one ${who(sex, false)} aged ${bandText(band)} with ${phrase(c.low)} is paid more than another with ${phrase(c.high)}`);

  const lead = `${sex === "women" ? "Women" : "Men"} of ${age} in the United States who work full time, all year, with ${fromName}: the model's central estimate of their pay is ${dollars(c.from.central)} a year (${MINCER.year}).`;
  sentence.textContent = c.same
    ? `${lead} The middle 80% of them are paid between ${dollars(c.from.p10)} and ${dollars(c.from.p90)}. Both levels are the same, so there is no gap to show: choose a different level to compare with.`
    : `${lead} With ${toName} it is ${level ? `about the same, ${dollars(c.to.central)}` : `${dollars(c.to.central)}, which is ${tiny ? "less than 1%" : pct0(Math.abs(c.gap.pct))} ${dir}`}.${unsure ? ` The 95% interval for that gap runs from ${ciText}, so the survey cannot say which of the two levels is paid more on average at this age.` : ""} That is a ${level || tiny ? "comparison of" : "gap between"} averages for two different groups of people, who differ in more than their education. It is not what the qualification would add to any one person's pay. For one person the ranges overlap: the middle 80% run from ${dollars(c.from.p10)} to ${dollars(c.from.p90)} and from ${dollars(c.to.p10)} to ${dollars(c.to.p90)}, and ${pct0(c.upset)} of the time a randomly chosen ${who(sex, false)} aged ${bandText(band)} with ${phrase(c.low)} is paid more than a randomly chosen one with ${phrase(c.high)}.`;

  const thin = [from, ...(c.same ? [] : [to])].filter((l) => cellMean(sex, l, age) == null);
  flags.replaceChildren(...thin.map((l) => note("warn", `Fewer than ${MINCER.minCell} ${who(sex)} in the sample have ${phrase(l)} at ${age}. The figure for that level here comes from the shape of the model and from people a few years older, so treat it with more caution than the rest.`)));

  // Pay over the working life: the model, the range for one person, and the data's own averages.
  const curves = (c.same ? [from] : [from, to]).map((l) => ({ l, pts: profileCurve(sex, l) }));
  profileChart.update({
    title: `Pay by age: ${who(sex)}, ${SAMPLE}, United States ${MINCER.year}`,
    subtitle: "Lines: the model's central estimate. Shading: where the middle 80% of people fall. Dots: the data's own average at each single year of age, with no model.",
    label: "Line chart of annual pay against age for the chosen levels of education",
    x: { label: "Age", domain: [AGE_MIN, AGE_MAX] },
    y: { label: `Annual pay, ${MINCER.dollars} dollars`, format: axisDollars, zero: true },
    series: [
      ...curves.map(({ l, pts }, i) => ({ name: `Middle 80%: ${LEVELS[l].label}`, legend: false, type: "range", color: i, data: pts.map((p) => [p.age, p.p10, p.p90]) })),
      ...curves.map(({ l, pts }, i) => ({ name: LEVELS[l].label, type: "line", color: i, data: pts.map((p) => [p.age, p.central]) })),
      ...curves.map(({ l, pts }, i) => ({ name: `Data: ${LEVELS[l].label}`, legend: false, hover: false, type: "scatter", color: i, r: 2.5, data: pts.filter((p) => p.dot != null).map((p) => [p.age, p.dot]) })),
    ],
    legend: true,
    marks: [{ type: "vline", x: age, text: `age ${age}` }],
  });

  // The two distributions for the age band, in bands of pay about 22% wide (four of the bundle's bins).
  const wide = (l) => {
    const h = histogram(sex, band, l), out = [];
    for (let i = 0; i < h.length; i += 4) out.push([h[i].x0, h.slice(i, i + 4).reduce((s, b) => s + b.share, 0)]);
    out.push([h.at(-1).x1, out.at(-1)[1]]);
    return out;
  };
  distChart.update({
    title: `How pay is spread: ${who(sex)} aged ${bandText(band)}, ${SAMPLE}`,
    subtitle: `The share of workers in each band of pay (each band is about 22% wide; the scale is logarithmic). These are counts from the survey, not the model.${c.same ? "" : " Where the two outlines overlap, education does not tell the two groups apart."}`,
    label: "Step chart of the distribution of annual pay for the chosen levels of education",
    x: { label: `Annual pay, ${MINCER.dollars} dollars (log scale)`, type: "log", domain: [6000, 1100000], format: axisDollars },
    y: { label: "Share of workers", format: (v) => fmt.pct(v, 0), zero: true },
    series: (c.same ? [from] : [from, to]).map((l, i) => ({ name: LEVELS[l].label, type: "step", color: i, data: wide(l) })),
    legend: true,
    marks: [],
  });

  // The same gap measured three ways.
  if (c.same) gapBox.replaceChildren();
  else {
    // Years of schooling and of experience are each group's own averages at this age (see groupMeans).
    const gf = groupMeans(sex, from, age), gt = groupMeans(sex, to, age);
    const years = gt.S - gf.S, dX = gt.X - gf.X;
    const yearsText = (x) => `${fmt.num(x, 1)} ${Math.abs(x - 1) < 0.05 ? "year" : "years"}`;
    const r = returnPerYear(sex);
    gapBox.replaceChildren(stacked(table({
      caption: `Three measures of the gap between ${fromName} and ${toName}: ${who(sex)} aged ${age}, ${SAMPLE}. None of the three is the effect of the qualification`,
      columns: [{ key: "how", label: "Measure" }, { key: "gap", label: "Gap in pay (95% interval)", num: true }, { key: "what", label: "What it is" }],
      rows: [
        { how: "By-level model (used above)", gap: `${signedPct(c.gap.pct, 1)} (${interval(c.gap.ci, 1)})`, what: "Each level of education has its own height, and pay follows one curve in experience." },
        { how: "Mincer's equation", gap: `${signedPct(c.mincer.pct, 1)} (${interval(c.mincer.ci, 1)})`, what: `One slope for every year of schooling: ${yearsText(Math.abs(years))} ${years >= 0 ? "more" : "less"} schooling on average at ${fmt.pct(r.pct, 1)} a year, ${Math.abs(dX) < 0.05 ? "with the same experience at this age" : `and ${yearsText(Math.abs(dX))} ${dX < 0 ? "less" : "more"} experience at the same age`}.` },
        { how: `The data's own averages at exactly ${age}`, gap: c.raw ? signedPct(c.raw.pct, 1) : "not shown", what: c.raw ? "No model: the two groups' average log pay at this one age. It jumps about from one age to the next." : `One of the two groups has fewer than ${MINCER.minCell} people in the sample at this age.` },
      ],
    })));
  }

  // Every level at this age.
  const mine = c.from.central;
  levelsBox.replaceChildren(stacked(table({
    caption: `Every level of education: ${who(sex)} aged ${age}, ${SAMPLE}, United States ${MINCER.year}`,
    columns: [
      { key: "level", label: "Highest level" }, { key: "central", label: "Central estimate", num: true }, { key: "range", label: "Middle 80% of people", num: true },
      { key: "vs", label: `Against ${fromName}`, num: true }, { key: "n", label: `People in the sample aged ${bandText(band)}`, num: true },
    ],
    rows: LEVELS.map((l, i) => {
      const p = predict({ sex, age, level: i });
      return { level: l.label + (i === from ? " (yours)" : i === to && !c.same ? " (compared)" : ""), central: dollars(p.central), range: `${dollars(p.p10)} to ${dollars(p.p90)}`, vs: i === from ? "–" : signedPct(p.central / mine - 1), n: fmt.int(MINCER.hist.people[sex === "men" ? 0 : 1][band][i]) };
    }),
  })));
}

/* ---------- the parts that do not change: how far to trust it, and the wider picture ---------- */
const RULES = {
  mean: "One figure for everybody", sex: "One figure for women and one for men", mincer: "Mincer's equation",
  levels: "By-level model (used on this page)", cells: "A separate average for every sex, level and age",
};
const rule = Object.fromEntries(MINCER.outOfSample.map((r) => [r.rule, r]));
const s = MINCER.sample;
const trust = el("section", { class: "e-block", "aria-labelledby": "h-trust" },
  el("h2", { id: "h-trust", text: "How far to trust the model" }),
  el("p", { class: "small", text: `The models were fitted on four fifths of the sample (${fmt.int(s.train)} people) and then asked to predict the pay of the other fifth (${fmt.int(s.test)} people), whom they had never seen.` }),
  stacked(table({
    caption: `Error on the held-out fifth (${SAMPLE} aged ${AGE_MIN} to ${AGE_MAX}, United States ${MINCER.year})`,
    columns: [{ key: "name", label: "Prediction rule" }, { key: "miss", label: "Average miss", num: true }, { key: "r2", label: "Variation explained", num: true }],
    rows: MINCER.outOfSample.map((r) => ({ name: RULES[r.rule], miss: `a factor of ${fmt.num(Math.exp(r.mae), 2)}`, r2: fmt.pct(r.r2, 1) })),
  })),
  el("p", { class: "small", text: `The by-level model explains ${fmt.pct(rule.levels.r2, 1)} of the variation in log pay and is out by a factor of ${fmt.num(Math.exp(rule.levels.mae), 2)} on average: if it says $60,000, a typical miss is someone paid about ${dollars(60000 * Math.exp(rule.levels.mae))} or ${dollars(60000 / Math.exp(rule.levels.mae))}. A separate average for each of the 640 combinations of sex, level and age, the most that these three facts could ever tell you, does hardly any better (${fmt.pct(rule.cells.r2, 1)}). Most of the difference in pay between people is not explained by education, age and sex at all.` }),
  el("p", { class: "small", text: `The ranges for one person were checked the same way: ${fmt.pct(MINCER.coverage.p10p90, 1)} of the held-out people fall inside the middle-80% range the model gives for them, and ${fmt.pct(MINCER.coverage.p25p75, 1)} inside the middle-50% range.` }));

const rw = returnPerYear("women"), rm = returnPerYear("men");
const wider = el("section", { class: "e-block", "aria-labelledby": "h-wider" },
  el("h2", { id: "h-wider", text: "Mincer's coefficient, here and elsewhere" }),
  el("p", { class: "small", text: `Fitted to this sample, Mincer's equation puts the coefficient on a year of schooling at ${fmt.num(rw.coef * 100, 1)} for women and ${fmt.num(rm.coef * 100, 1)} for men (log points times 100; standard errors ${fmt.num(rw.se * 100, 2)} and ${fmt.num(rm.se * 100, 2)}). In percentages that is ${fmt.pct(rw.pct, 1)} and ${fmt.pct(rm.pct, 1)} more pay for each extra year, among people with the same years of experience: ${SAMPLE} aged ${AGE_MIN} to ${AGE_MAX}, United States, ${MINCER.year}. Like every gap on this page it compares different people and is not the effect of a year of schooling.` }),
  stacked(table({
    caption: "Other people's estimates, not this page's: the same coefficient around the world",
    columns: [{ key: "region", label: "Group of economies" }, { key: "total", label: "Everyone", num: true }, { key: "women", label: "Women", num: true }, { key: "men", label: "Men", num: true }, { key: "economies", label: "Economies", num: true }],
    rows: MINCER.other.rows.map((r) => ({ region: r.region, total: fmt.num(r.total, 1), women: fmt.num(r.women, 1), men: fmt.num(r.men, 1), economies: fmt.int(r.economies) })),
  })),
  el("p", { class: "small muted", text: "Source: Montenegro and Patrinos (2014), World Bank Policy Research Working Paper 7020, Table 3a. Each figure is the average, over the economies in the group, of the return to another year of schooling in per cent, taken from the latest household survey for each economy (1970 to 2013). Their samples, years and pay measures differ from this page's, so the comparison is rough. Reproduced under the paper's licence, CC BY 3.0 IGO." }));

const sampleNote = el("p", { class: "small muted", text: `The sample: ${fmt.int(s.people)} people from the Census Bureau's American Community Survey for ${MINCER.year}, standing for ${fmt.num(s.represents / 1e6, 1)} million workers once weighted. The Bureau filled in the pay of ${fmt.pct(s.allocatedShare, 0)} of them (weighted) because they did not answer that question.` });

const out = el("div", { class: "out" },
  el("div", { class: "stats" }, tiles.from.el, tiles.to.el, tiles.gap.el, tiles.upset.el),
  sentence, flags, profileBox, distBox, gapBox, levelsBox, sampleNote);

out.id = "e-you"; trust.id = "e-trust"; wider.id = "e-wider";
$("#app").append(
  el("nav", { class: "jump", "aria-label": "Parts of the tool" }, el("a", { href: "#e-you", text: "Your comparison" }), el("a", { href: "#e-trust", text: "How far to trust the model" }), el("a", { href: "#e-wider", text: "Other countries" })),
  el("div", { class: "tool-grid" }, controls, out), trust, wider);
update();
