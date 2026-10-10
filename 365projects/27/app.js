// Day 27: Raven Paradox Evidence Meter. Interface.
import { $, el, fmt, mount, slider, select, segmented, numberField, stat, note, table, chart, clamp, palette } from "../kit/kit.js";
import { KINDS, PROCEDURES, RIVALS, PRESETS, MAX_COUNT, worlds, evidence, allEvidence, afterN, needed, worth, fractionGrid } from "./logic.js";

mount();

const FR = fractionGrid();
const kindOf = (k) => KINDS.find((x) => x.key === k);
const procOf = (k) => PROCEDURES.find((x) => x.key === k);
const firstProc = (kind) => PROCEDURES.find((p) => p.pool.includes(kind)).key;
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/* ---------- number formatting: most of the interest is in the sixth decimal place ---------- */
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sci = (x) => { const [m, e] = x.toExponential(1).split("e"); return `${m} × 10${[...String(Number(e))].map((c) => SUP[c]).join("")}`; };
const trim = (s) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
/** 1 + x with enough decimals to show a small x: 1.00001, 0.99996. */
function nearOne(x) {
  const a = Math.abs(x);
  if (a === 0) return "1";
  if (a >= 0.001) return fmt.sig(1 + x, 4);
  if (a < 1e-9) return `1 ${x > 0 ? "+" : "−"} ${sci(a)}`;
  return trim((1 + x).toFixed(Math.ceil(-Math.log10(a)) + 1));
}
const mag = (x) => (x === 0 ? "0" : Math.abs(x) < 1e-6 ? sci(Math.abs(x)) : fmt.sig(Math.abs(x), 3));
const signed = (x) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${mag(x)}`;
const lrText = (e) => (e.lnLR === Infinity ? "infinite" : e.lnLR === -Infinity ? "0" : nearOne(e.excess));
const bitsText = (e) => (Number.isFinite(e.bits) ? `${signed(e.bits)} bits` : "no finite value");
const count = (v) => (Number.isInteger(v) ? fmt.int(v) : fmt.sig(v, 4));
const big = (x) => (x >= 1e9 ? fmt.compact(x) : x >= 100 ? fmt.int(Math.round(x)) : fmt.sig(x, 3));
/** A chance as a percentage, with enough decimals to stay distinct from 0% and 100%. */
function share(p) {
  if (p === 0 || p === 1) return p ? "100%" : "0%";
  const q = Math.min(p, 1 - p) * 100;
  return `${trim((p * 100).toFixed(q >= 1 ? 2 : Math.min(12, Math.ceil(-Math.log10(q)) + 2)))}%`;
}
/** A confidence with enough decimals to tell it apart from where it started. */
function confidence(e) {
  const gap = Math.abs(e.difference) * 100;
  if (gap > 0 && gap < 1e-8) return `${fmt.sig(e.prior * 100, 3)}% ${e.difference > 0 ? "+" : "−"} ${sci(gap)}`;
  if (gap === 0 || e.posterior === 0 || e.posterior === 1) return `${fmt.sig(e.posterior * 100, 3)}%`;
  return `${fmt.num(e.posterior * 100, clamp(Math.ceil(-Math.log10(gap)) + 1, 1, 10))}%`;
}
function reading(e) {
  if (e.impossible) return "cannot happen";
  if (e.lnLR === Infinity) return "proves";
  if (e.lnLR === -Infinity) return "refutes";
  if (e.lnLR === 0) return "no evidence";
  const minute = Math.abs(e.excess) < 0.001 ? ", minutely" : "";
  return e.lnLR > 0 ? `confirms${minute}` : `counts against${minute}`;
}

const state = { ...PRESETS[0], preset: PRESETS[0].key, prior: 0.5 };

/* ---------- the observation ---------- */
const kindSeg = segmented({
  label: "What turned up", value: state.kind,
  options: KINDS.map((k) => ({ value: k.key, label: k.label })),
  hint: "\"White\" stands for any colour but black, and \"shoe\" for anything that is not a raven.",
  onChange: (k) => {
    state.kind = k;
    if (!procOf(state.proc).pool.includes(k)) state.proc = firstProc(k);
    update();
  },
});
// One group holds all five pools; the two that cannot produce the chosen object are hidden.
const procSeg = segmented({
  label: "Picked at random from", value: state.proc,
  options: PROCEDURES.map((p) => ({ value: p.key, label: p.from })),
  hint: "The object was drawn from this group, and then its other property was looked at.",
  onChange: (p) => { if (procOf(p).pool.includes(state.kind)) state.proc = p; update(); },
});
const procLabels = [...procSeg.el.querySelectorAll(".seg label")];

const verdict = el("p", { class: "verdict", role: "status" });
const meter = el("div", { class: "meter" });
const message = el("div");
const tLr = stat("Likelihood ratio");
const tPost = stat("Your confidence after");
const tWorth = stat("One black raven is worth");
const tNeed = stat("To reach 99% confidence");
const tiles = [tLr, tPost, tWorth, tNeed];

/* ---------- the two worlds ---------- */
const presetNote = el("div", { class: "hint" });
const presetSelect = select({
  label: "Example world", value: state.preset,
  options: [...PRESETS.map((p) => ({ value: p.key, label: p.label })), { value: "custom", label: "Your own world" }],
  onChange: (key) => {
    const p = PRESETS.find((x) => x.key === key);
    state.preset = key;
    if (p) { Object.assign(state, p, { preset: key }); syncControls(); }
    update();
  },
});
presetSelect.el.append(presetNote);
const custom = () => { state.preset = "custom"; presetSelect.value = "custom"; };
const WHAT = { ravens: "The number of ravens", black: "The number of black things that are not ravens", nonblack: "The number of non-black things that are not ravens", rivalRavens: "The rival world's number of ravens" };
const fields = {
  ravens: numberField({ label: "Ravens", min: 1, max: MAX_COUNT, step: 1, value: state.ravens }),
  black: numberField({ label: "Black things that are not ravens", min: 0, max: MAX_COUNT, step: 1, value: state.black }),
  nonblack: numberField({ label: "Non-black things that are not ravens", min: 0, max: MAX_COUNT, step: 1, value: state.nonblack, hint: "White shoes, green leaves, red buses." }),
  rivalRavens: numberField({ label: "Ravens in the rival world", min: 1, max: MAX_COUNT, step: 1, value: state.rivalRavens }),
};
for (const [key, f] of Object.entries(fields)) f.input.addEventListener("input", () => { state[key] = f.value; custom(); update(); });

const fractionSlider = slider({
  label: "Rival: share of ravens that are not black", min: 0, max: FR.length - 1, step: 1, value: FR.indexOf(state.fraction),
  format: (i) => share(FR[i]),
  hint: "\"All ravens are black\" is weighed against this one alternative.",
  onInput: (i) => { state.fraction = FR[i]; custom(); update(); },
});
const rivalHint = el("div", { class: "hint" });
const rivalSelect = select({
  label: "What else differs in the rival world", value: state.rival,
  options: RIVALS.map((r) => ({ value: r.key, label: r.label })),
  onChange: (v) => { state.rival = v; custom(); update(); },
});
rivalSelect.el.append(rivalHint);
const priorSlider = slider({
  label: "Your confidence before looking", min: 1, max: 99, step: 1, value: state.prior * 100, format: (v) => `${v}%`,
  hint: "How sure you are that all ravens are black, as against the rival.",
  onInput: (v) => { state.prior = v / 100; update(); },
});

function syncControls() {
  for (const [key, f] of Object.entries(fields)) f.value = state[key];
  fractionSlider.value = FR.indexOf(state.fraction);
  rivalSelect.value = state.rival;
  kindSeg.value = state.kind;
}

/* ---------- layout: the observation and its reading first, then the world, then the detail ---------- */
const worldsBox = el("div", { class: "grid2" });
const measuresBox = el("div");
const chartBox = el("div");
const allBox = el("div");
const top = el("div", { class: "out lab-top" },
  el("div", { class: "panel pick" }, kindSeg.el, procSeg.el),
  message, verdict, meter, el("div", { class: "stats" }, tiles.map((t) => t.el)));
const controls = el("div", { class: "controls" },
  presetSelect.el, fields.ravens.el, fields.black.el, fields.nonblack.el, fractionSlider.el, rivalSelect.el, fields.rivalRavens.el, priorSlider.el);
const rest = el("div", { class: "out lab-rest" }, measuresBox, worldsBox, chartBox, allBox);
$("#app").append(el("div", { class: "lab-grid" }, top, controls, rest));

let plot = null;

function blank(text) {
  message.replaceChildren(note("bad", text));
  verdict.textContent = "";
  meter.replaceChildren();
  for (const t of tiles) t.set("–", "");
  rest.hidden = true;
}

function drawMeter(e) {
  const pos = e.impossible ? 50 : (e.ko + 1) * 50;
  meter.replaceChildren(
    el("div", { class: "meter-track", role: "img", "aria-label": `Evidence meter from minus 1, refutes, through 0, no evidence, to plus 1, proves. It reads ${e.impossible ? "nothing" : signed(e.ko)}.` },
      el("span", { class: "meter-fill", style: { left: `${Math.min(50, pos)}%`, width: `${Math.abs(pos - 50)}%`, background: pos >= 50 ? palette[0] : palette[1] } }),
      el("span", { class: "meter-zero" }),
      el("span", { class: "meter-needle", style: { left: `${pos}%` } })),
    el("div", { class: "meter-scale" }, el("span", { text: "−1 refutes" }), el("span", { text: "0 no evidence" }), el("span", { text: "+1 proves" })),
    el("p", { class: "small muted", text: e.impossible ? "The meter has nothing to read." : `The meter reads ${signed(e.ko)} on a scale from −1 to +1 (the Kemeny-Oppenheim measure).` }));
}

function worldTable(world, caption) {
  return el("div", { class: "panel" }, table({
    caption,
    columns: [{ key: "row", label: "" }, { key: "b", label: "Black", num: true, format: count }, { key: "n", label: "Not black", num: true, format: count }],
    rows: [{ row: "Ravens", b: world.br, n: world.nr }, { row: "Other things", b: world.bn, n: world.nn }],
  }));
}

function update() {
  // Show only the pools that can produce the chosen object.
  procLabels.forEach((lab, i) => { lab.hidden = !PROCEDURES[i].pool.includes(state.kind); });
  procSeg.value = state.proc;
  fields.rivalRavens.el.hidden = state.rival !== "more";
  rivalHint.textContent = RIVALS.find((r) => r.key === state.rival).hint;
  presetNote.textContent = `${PRESETS.find((p) => p.key === state.preset)?.note || "Your own numbers."} The counts are illustrative: only the proportions matter.`;

  const inUse = ["ravens", "black", "nonblack", ...(state.rival === "more" ? ["rivalRavens"] : [])];
  const badField = inUse.find((k) => !Number.isInteger(state[k]));
  if (badField) return blank(`${WHAT[badField]} must be a whole number from ${badField === "ravens" || badField === "rivalRavens" ? 1 : 0} to ${fmt.int(MAX_COUNT)}.`);
  const w = worlds(state);
  if (w.error) return blank(w.error);
  const e = evidence(w, state.proc, state.kind, state.prior);
  if (e.error) return blank(e.error);
  message.replaceChildren();
  rest.hidden = false;

  const kind = kindOf(state.kind);
  const proc = procOf(state.proc);
  const raven = evidence(w, "raven", "br", state.prior);
  const shoe = evidence(w, "nonblack", "nn", state.prior);
  const isYardstick = state.kind === "br" && state.proc === "raven";
  const what = `${cap(kind.name)} ${proc.phrase}`;
  const tiny = !e.impossible && Number.isFinite(e.lnLR) && e.lnLR !== 0 && Math.abs(e.excess) < 0.001;

  verdict.textContent = e.impossible ? `${what} cannot happen in either world, so there is nothing to learn from it.`
    : e.lnLR === Infinity ? `${what} proves that all ravens are black, as far as these two worlds go: it could not have turned up in the rival one.`
    : e.lnLR === -Infinity ? `${what} refutes "all ravens are black" outright. One is enough, however it was found.`
    : e.lnLR === 0 ? `${what} is no evidence either way. It is exactly as likely in one world as in the other.`
    : e.lnLR > 0 ? `${what} confirms "all ravens are black"${tiny ? ", but only just" : ""}. It is ${lrText(e)} times as likely to turn up if all ravens are black as if the rival is true.`
    : `${what} counts against "all ravens are black"${tiny ? ", but only just" : ""}. It is ${lrText(e)} times as likely to turn up if all ravens are black as if the rival is true, and that is less than 1.`;
  drawMeter(e);

  if (e.impossible) {
    for (const t of tiles) t.set("–", "");
    tLr.set("–", "0 ÷ 0: it has no chance in either world");
  } else {
    tLr.set(lrText(e), "its chance if all ravens are black ÷ its chance if the rival is true");
    tPost.set(confidence(e), `${e.difference > 0 ? "up" : e.difference < 0 ? "down" : "unchanged"} from ${fmt.int(state.prior * 100)}%`);
    const k = worth(raven.lnLR, e.lnLR);
    if (isYardstick) tWorth.set("1", "this is the yardstick: a black raven picked from the ravens");
    else if (k == null) tWorth.set("–", e.lnLR > 0 ? "this observation is conclusive, so no number of ravens matches it" : "this observation does not confirm, so no number of them adds up to a raven");
    else tWorth.set(big(k), "observations like this one, the raven being picked from the ravens");
    const n = needed(state.prior, e.lnLR);
    if (n === 0) tNeed.set("there", "you started at 99% or more");
    else if (n == null) tNeed.set("never", "this observation does not raise your confidence");
    else tNeed.set(big(n), n === 1 ? "one is enough" : "independent observations like this one");
  }

  // Five scores.
  measuresBox.replaceChildren(e.impossible ? "" : table({
    caption: "The same observation on five confirmation measures",
    columns: [{ key: "m", label: "Measure" }, { key: "f", label: "Definition" }, { key: "v", label: "Value", num: true }],
    rows: [
      { m: "Difference", f: "P(H | E) − P(H)", v: `${signed(e.difference * 100)} points` },
      { m: "Ratio", f: "P(H | E) ÷ P(H)", v: nearOne(e.ratioExcess) },
      { m: "Likelihood ratio", f: "P(E | H) ÷ P(E | rival)", v: lrText(e) },
      { m: "Log-likelihood ratio", f: "log₂ of the likelihood ratio", v: bitsText(e) },
      { m: "Kemeny-Oppenheim", f: "(P(E | H) − P(E | rival)) ÷ (P(E | H) + P(E | rival))", v: signed(e.ko) },
    ],
  }));

  worldsBox.replaceChildren(worldTable(w.h, "The world if all ravens are black (H)"), worldTable(w.r, "The world if the rival is true"));

  // Repeating one kind of observation.
  const lines = [];
  if (!isYardstick && !(state.kind === "nn" && state.proc === "nonblack") && !e.impossible) lines.push({ name: "This observation", ln: e.lnLR });
  lines.push({ name: "Black raven from the ravens", ln: raven.lnLR });
  if (!shoe.impossible) lines.push({ name: "White shoe from the non-black things", ln: shoe.lnLR });
  const slowest = Math.max(100, ...lines.map((l) => needed(state.prior, l.ln) || 0).filter(Number.isFinite));
  const xMax = clamp(10 ** Math.ceil(Math.log10(slowest * 2)), 100, 1e13);
  const decades = Math.round(Math.log10(xMax));
  const steps = [...new Set(Array.from({ length: 97 }, (_, i) => Math.round(xMax ** (i / 96))))];
  const spec = {
    title: "Your confidence after many observations of one kind",
    subtitle: "Each line repeats a single kind of observation, drawn afresh each time. The axis is a log scale: every step is ten times as many.",
    label: "Confidence that all ravens are black against the number of repeated observations",
    height: 300,
    // The x values are log10 of the count on a linear axis: the kit's own log axis labels every decade, which collides on a phone.
    x: { label: "Number of observations (log scale)", domain: [0, decades], ticks: Math.min(decades, 5), format: (v) => fmt.compact(Math.round(10 ** v)) },
    y: { label: "Confidence that all ravens are black", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
    series: lines.map((l, i) => ({ name: l.name, data: steps.map((n) => [Math.log10(n), afterN(state.prior, l.ln, n)]), color: i })),
    legend: true,
    marks: [{ type: "hline", y: state.prior, text: "where you start" }],
  };
  if (plot) plot.update(spec); else plot = chart(chartBox, spec);

  // Everything each way of picking can turn up.
  const strong = (text, on) => el(on ? "strong" : "span", { style: { whiteSpace: "nowrap" }, text });
  allBox.replaceChildren(el("p", { class: "chart-title", text: "Every object each way of picking can turn up, with its chance in each world" }), table({
    columns: [
      { key: "from", label: "Picked from" }, { key: "what", label: "It was" },
      { key: "pH", label: "If all black", num: true }, { key: "pR", label: "If rival", num: true },
      { key: "lr", label: "Likelihood ratio", num: true }, { key: "says", label: "Reading" },
    ],
    rows: allEvidence(w, state.prior).map((r) => {
      const on = r.proc === state.proc && r.kind === state.kind;
      return { from: strong(cap(procOf(r.proc).from.replace(/^the /, "")), on), what: strong(kindOf(r.kind).label, on), pH: share(r.pH), pR: share(r.pR), lr: r.impossible ? "–" : lrText(r), says: strong(reading(r), on) };
    }),
  }));
}

update();
