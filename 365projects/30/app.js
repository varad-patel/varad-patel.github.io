// Day 30: Sunrise and Induction Calculator. Interface.
import { $, el, fmt, mount, numberField, segmented, button, stat, note, table, chart, clamp, stats } from "../kit/kit.js";
import { PRIORS, EXAMPLES, MAX_COUNT, MAX_PRIOR, MAX_RUN, problem, betaQuantile, analyse, density } from "./logic.js";

mount();

/* ---------- formatting ---------- */
/** A chance with enough decimals to stay distinct from 0% and 100%. */
function pct(p) {
  if (p == null || !Number.isFinite(p)) return "–";
  if (p === 0 || p === 1) return p ? "100%" : "0%";
  const q = Math.min(p, 1 - p) * 100;
  if (q < 1e-8) return p < 0.5 ? "under 0.00000001%" : "over 99.99999999%";
  return `${fmt.num(p * 100, q >= 1 ? 1 : Math.ceil(-Math.log10(q)) + 1)}%`;
}
const big = (x) => (x >= 1e12 ? fmt.compact(x) : x >= 1000 ? fmt.int(Math.round(x)) : fmt.sig(x, 3));
function oddsText(o) {
  if (o == null) return "–";
  if (o === Infinity) return "certain";
  if (o === 0) return "impossible";
  if (o === 1) return "evens";
  return o > 1 ? `${big(o)} to 1` : `${big(1 / o)} to 1 against`;
}
const betaName = (p) => `Beta(${fmt.sig(p.a, 4)}, ${fmt.sig(p.b, 4)})`;
const times = (k) => (k === 1 ? "once" : `${fmt.int(k)} times`);
function intervalText(r) {
  if (r.interval) return `${pct(r.interval.lo)} to ${pct(r.interval.hi)}`;
  if (r.next == null) return "–";
  return r.B === 0 ? "none: all the weight is on 100%" : "none: all the weight is on 0%";
}

const first = EXAMPLES[0];
const state = { s: first.s, f: first.f, m: 365, example: first.key, prior: "uniform", a: 2, b: 2, view: "next" };
const priors = () => [...PRIORS, { key: "custom", label: "Your own", a: state.a, b: state.b, note: "Your own prior. a and b act like successes and failures seen before the record began." }];

/* ---------- the record ---------- */
const fields = {
  s: numberField({ label: "Times it happened", min: 0, max: MAX_COUNT, step: 1, value: state.s }),
  f: numberField({ label: "Times it did not", min: 0, max: MAX_COUNT, step: 1, value: state.f }),
  a: numberField({ label: "Your own prior: a", min: 0, max: MAX_PRIOR, value: state.a, hint: "Like successes seen beforehand." }),
  b: numberField({ label: "Your own prior: b", min: 0, max: MAX_PRIOR, value: state.b, hint: "Like failures seen beforehand." }),
  m: numberField({ label: "Length of a future run", min: 1, max: MAX_RUN, step: 1, value: state.m, hint: "The tool gives the chance that the event happens this many more times with no miss." }),
};
for (const [key, field] of Object.entries(fields)) {
  field.input.addEventListener("input", () => {
    state[key] = field.value;
    if (key === "s" || key === "f") state.example = "";
    update();
  });
}
const exampleNote = el("p", { class: "small muted" });
const examples = el("div", { class: "row" }, EXAMPLES.map((e) => button(e.label, () => {
  Object.assign(state, { s: e.s, f: e.f, example: e.key, m: e.key === "sunrise" ? 365 : 10 });
  for (const k of ["s", "f", "m"]) fields[k].value = state[k];
  update();
}, { small: true })));

/* ---------- the prior and the views ---------- */
const priorNote = el("div", { class: "hint" });
const priorSeg = segmented({
  label: "Prior to feature", value: state.prior,
  options: priors().map((p) => ({ value: p.key, label: p.label })),
  onChange: (v) => { state.prior = v; update(); },
});
priorSeg.el.append(priorNote);
const viewSeg = segmented({
  label: "Second chart shows", value: state.view,
  options: [{ value: "next", label: "Chance it happens" }, { value: "fail", label: "Chance it fails, log scale" }],
  onChange: (v) => { state.view = v; update(); },
});

/* ---------- outputs ---------- */
const message = el("div");
const verdict = el("p", { class: "verdict", role: "status" });
const tNext = stat("Chance it happens next time");
const tInterval = stat("95% credible interval");
const tRun = stat("Chance of a run");
const tEven = stat("An even bet that the run lasts");
const tiles = [tNext, tInterval, tRun, tEven];
const tableBox = el("div");
const densityBox = el("div");
const densityNote = el("p", { class: "small muted" });
const convBox = el("div");
const convNote = el("p", { class: "small muted" });

const top = el("div", { class: "out lab-top" },
  el("div", { class: "panel record" }, el("div", { class: "pair" }, fields.s.el, fields.f.el), el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })), examples, exampleNote)),
  message, verdict, el("div", { class: "stats" }, tiles.map((t) => t.el)), tableBox);
const controls = el("div", { class: "controls" }, priorSeg.el, el("div", { class: "pair" }, fields.a.el, fields.b.el), fields.m.el, viewSeg.el);
const rest = el("div", { class: "out lab-rest" }, el("div", {}, densityBox, densityNote), el("div", {}, convBox, convNote));
$("#app").append(el("div", { class: "lab-grid" }, top, controls, rest));

let densityChart = null;
let convChart = null;

function blank(text) {
  message.replaceChildren(note("bad", text));
  verdict.textContent = "";
  for (const t of tiles) t.set("–", "");
  tableBox.replaceChildren();
  rest.hidden = true;
}

function update() {
  const { s, f, m } = state;
  const bad = problem(state);
  if (bad) return blank(bad);
  message.replaceChildren();
  rest.hidden = false;

  const n = s + f;
  const list = priors();
  const results = list.map((p) => ({ prior: p, ...analyse(p, s, f, m) }));
  const featured = results.find((r) => r.prior.key === state.prior);
  const fp = featured.prior;
  const example = EXAMPLES.find((e) => e.key === state.example);
  exampleNote.textContent = example ? example.note : "Your own record.";
  priorNote.textContent = `${betaName(fp)}. ${fp.note}`;

  /* The sentence. */
  const record = n === 0 ? "Nothing has been observed yet." : f === 0 ? `It has happened ${times(s)} out of ${fmt.int(n)}, without a miss.` : s === 0 ? `It has had ${fmt.int(n)} ${n === 1 ? "chance" : "chances"} to happen and never has.` : `It has happened ${times(s)} out of ${fmt.int(n)}.`;
  const who = { uniform: "Laplace's rule (a uniform prior)", jeffreys: "Jeffreys' prior", haldane: "Haldane's prior", sceptical: "The sceptical prior", custom: `Your own prior, ${betaName(fp)},` }[fp.key];
  verdict.textContent = featured.next == null
    ? `${record} ${who} gives no answer here: the formula comes to 0 ÷ 0. It has nothing to say until there is data.`
    : !featured.proper
      ? `${record} ${who} puts the chance it happens next time at ${pct(featured.next)}. With no weight held back for the outcome that has not been seen, it treats the record as proof.`
      : `${record} ${who} puts the chance it happens next time at ${pct(featured.next)}${featured.odds >= 1000 || featured.odds <= 0.001 ? `: odds of ${oddsText(featured.odds)}` : ""}.`;

  /* Headline numbers for the featured prior. */
  tNext.set(pct(featured.next), featured.next == null ? "0 ÷ 0" : `(${fmt.int(s)} + ${fmt.sig(fp.a, 4)}) ÷ (${fmt.int(n)} + ${fmt.sig(fp.a + fp.b, 4)}); odds: ${oddsText(featured.odds)}`);
  tInterval.set(featured.interval ? intervalText(featured) : "–", featured.interval
    ? `for the underlying chance${featured.interval.kind === "central" ? "" : "; one-sided, because the most likely values are at the end"}`
    : featured.next == null ? "" : "this is not a proper distribution, so it has no interval");
  tRun.set(pct(featured.run), `that it happens ${times(m)} in a row from now`);
  tEven.set(featured.evenRun == null ? "–" : featured.evenRun === Infinity ? "for ever" : `${big(featured.evenRun)} more`,
    featured.evenRun == null ? "" : featured.evenRun === Infinity ? "no run is long enough to become an even bet" : featured.evenRun === 1 ? "the very next time is already no better than a coin flip" : "the shortest run that is no better than a coin flip");

  /* Every prior side by side. */
  const mark = (r, text) => (r === featured ? el("strong", { text }) : text);
  tableBox.replaceChildren(table({
    caption: "The same record under each prior",
    columns: [
      { key: "prior", label: "Prior" }, { key: "next", label: "Happens next", num: true }, { key: "odds", label: "Odds", num: true },
      { key: "interval", label: "95% interval for the chance", num: true }, { key: "run", label: `${fmt.int(m)} in a row`, num: true },
    ],
    rows: results.map((r) => ({
      prior: el("span", {}, mark(r, r.prior.label), el("br"), el("span", { class: "small muted", text: betaName(r.prior) })),
      next: mark(r, pct(r.next)), odds: oddsText(r.odds), interval: intervalText(r), run: pct(r.run),
    })),
  }));

  /* Posterior densities, zoomed to where the weight is. */
  const proper = results.filter((r) => r.proper);
  if (proper.length) {
    let lo = Math.min(...proper.map((r) => betaQuantile(0.001, r.A, r.B)));
    let hi = Math.max(...proper.map((r) => betaQuantile(0.999, r.A, r.B)));
    const pad = Math.max(1e-12, (hi - lo) * 0.06);
    lo = Math.max(0, lo - pad);
    hi = Math.min(1, hi + pad);
    const N = 240;
    const xs = Array.from({ length: N }, (_, i) => lo + ((i + 0.5) / N) * (hi - lo));
    const curves = proper.map((r) => ({ r, ys: xs.map((x) => density(x, r.A, r.B)) }));
    // A density that shoots up at an end of the range would flatten every other curve, so the axis stops short of it.
    const ceiling = 1.1 * Math.max(...curves.map(({ r, ys }) => (r.A < 1 || r.B < 1 ? 1.5 * stats.quantile(ys, 0.9) : stats.max(ys))));
    const width = (hi - lo) * 100;
    const decimals = width >= 20 ? 0 : clamp(Math.ceil(-Math.log10(width)) + 1, 0, 9);
    const spec = {
      title: n === 0 ? "The priors themselves" : "What the record says about the underlying chance",
      subtitle: `Each curve is one prior's belief about the event's true rate${n === 0 ? "" : ", after the record"}.${featured.interval ? " The band is the 95% credible interval for the featured prior." : ""}${lo > 0.01 || hi < 0.99 ? " The axis is zoomed in to where the weight lies." : ""}`,
      label: "Posterior density of the underlying chance under each prior",
      height: 300,
      x: { label: "Underlying chance of the event", domain: [lo, hi], format: (v) => `${fmt.num(v * 100, decimals)}%` },
      y: { label: "Density", domain: [0, ceiling], format: (v) => (v >= 10000 ? fmt.compact(v) : fmt.sig(v, 3)) },
      series: curves.map(({ r, ys }) => ({ name: r.prior.label, data: xs.map((x, i) => [x, ys[i]]), color: list.indexOf(r.prior), width: r === featured ? 3.2 : 1.6 })),
      legend: true,
      marks: featured.interval ? [{ type: "span", x0: Math.max(lo, featured.interval.lo), x1: Math.min(hi, featured.interval.hi) }] : [],
    };
    if (densityChart) densityChart.update(spec); else densityChart = chart(densityBox, spec);
    densityBox.hidden = false;
    const missing = results.filter((r) => !r.proper).map((r) => r.prior.label);
    densityNote.textContent = [
      missing.length ? `Not drawn: ${missing.join(" and ")}. For this record ${missing.length > 1 ? "they are" : "it is"} not a proper probability distribution, so there is no curve to draw.` : "",
      curves.some(({ r }) => r.A < 1 || r.B < 1) ? "A curve that leaves the top of the chart keeps rising without limit at that edge." : "",
    ].filter(Boolean).join(" ");
  } else {
    densityBox.hidden = true;
    densityNote.textContent = "No prior gives a proper distribution for this record, so there is nothing to draw.";
  }

  /* How the priors pull together as the record grows. */
  if (n > 0) {
    const rate = s / n;
    const xMax = clamp(10 ** Math.ceil(Math.log10(Math.max(100, n * 10))), 100, 1e10);
    const decades = Math.round(Math.log10(xMax));
    const steps = [...new Set(Array.from({ length: 81 }, (_, i) => Math.round(xMax ** (i / 80))))];
    const failView = state.view === "fail";
    const lines = list.map((p, i) => ({
      name: p.label, color: i, width: p.key === state.prior ? 3.2 : 1.6,
      // (a + successes) / (a + b + observations), or the same for failures.
      data: steps.map((k) => [Math.log10(k), (failView ? p.b + (1 - rate) * k : p.a + rate * k) / (p.a + p.b + k)]),
    }));
    const spec = {
      title: "How the priors pull together as the record grows",
      subtitle: `Each line is one prior's answer after that many observations, if ${rate === 1 ? "the event had never missed" : rate === 0 ? "the event had never happened" : `the event had kept happening ${fmt.sig(rate * 100, 3)}% of the time`}.`,
      label: failView ? "Chance of failure next time under each prior against the number of observations" : "Chance of success next time under each prior against the number of observations",
      height: 300,
      // The x values are log10 of the count on a linear axis: the kit's own log axis labels every decade, which collides on a phone.
      x: { label: "Observations so far (log scale)", domain: [0, decades], ticks: Math.min(decades, 5), format: (v) => fmt.compact(Math.round(10 ** v)) },
      y: failView
        ? { label: "Chance it fails next time (log scale)", type: "log", format: (v) => (v >= 0.9999 ? "certain" : `1 in ${fmt.compact(1 / v)}`) }
        : { label: "Chance it happens next time", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
      series: lines,
      legend: true,
      marks: [{ type: "vline", x: Math.log10(n), text: `your record: ${fmt.compact(n)}` }],
    };
    if (convChart) convChart.update(spec); else convChart = chart(convBox, spec);
    convBox.hidden = false;
    convNote.textContent = failView
      ? (f === 0 ? "On this scale the lines never meet. After an unbroken run the priors' chances of failure stay a fixed multiple apart however long the run gets, and Haldane's prior, which gives a failure no chance at all, cannot be drawn." : "With failures in the record, every prior settles on the observed failure rate.")
      : "Read as probabilities, the priors soon become hard to tell apart. Switch the chart to the chance of failure to see what is left of the disagreement.";
  } else {
    convBox.hidden = true;
    convNote.textContent = "Enter some observations to see how the priors pull together as a record grows.";
  }
}

update();
