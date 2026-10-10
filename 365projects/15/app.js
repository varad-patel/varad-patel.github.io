// Day 15: Sorites and Fuzzy Logic. Interface.
import { $, el, fmt, mount, slider, segmented, button, stat, note, chart, canvas, rng, palette } from "../kit/kit.js";
import { MAX, DEFAULT_MARKS, SHAPES, grainsAt, positionOf, setMark, crisp, membership, supervaluation, sorites, pile } from "./logic.js";

mount();

const START = 60;
const state = { n: START, marks: { ...DEFAULT_MARKS }, shape: "log", moved: [] };
const grains = (n) => `${fmt.int(n)} grain${n === 1 ? "" : "s"}`;
const MARK_NAMES = { lo: "certainly not a heap", mid: "where a heap starts", hi: "certainly a heap" };

/* ---------- the pile ---------- */
const GRAINS = pile(MAX, 15);
const look = rng(151);
const LOOK = GRAINS.map(() => ({ dx: look.uniform(-0.12, 0.12), dy: look.uniform(-0.08, 0.08), shade: look.int(0, 2) }));
// How far the pile of n grains reaches sideways and upwards, so that the drawing can zoom to fit it.
const reach = new Int16Array(MAX + 1), top = new Int16Array(MAX + 1);
GRAINS.forEach((g, i) => { reach[i + 1] = Math.max(reach[i], Math.abs(g.col) + 1); top[i + 1] = Math.max(top[i], g.row); });
const SHADES = [0.7, 0.85, 1];

function drawPile(ctx, w, h) {
  const n = state.n, pad = 16, ground = h - 30;
  const d = Math.min(18, (w - 2 * pad) / (2 * reach[n] + 1), (ground - pad) / ((top[n] + 1) * 0.78 + 0.3));
  ctx.strokeStyle = "#b9c5bd";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad, ground + 1); ctx.lineTo(w - pad, ground + 1); ctx.stroke();
  ctx.fillStyle = palette[3];
  SHADES.forEach((alpha, shade) => {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (LOOK[i].shade !== shade) continue;
      const g = GRAINS[i];
      const x = w / 2 + (g.col + (g.row % 2 ? 0.5 : 0) + LOOK[i].dx) * d;
      const y = ground - (g.row * 0.78 + 0.5 + LOOK[i].dy) * d;
      if (d < 3) ctx.rect(x - d / 2, y - d / 2, d, d);
      else { ctx.moveTo(x + d * 0.48, y); ctx.arc(x, y, d * 0.48, 0, Math.PI * 2); }
    }
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#16233b";
  ctx.font = '600 14px "Hanken Grotesk", system-ui, sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(grains(n), w / 2, h - 9);
}

/* ---------- controls ---------- */
const pileBox = el("div");
const summary = el("p", { class: "small", role: "status" });
const nSlider = slider({
  label: "Grains in the pile", min: 0, max: 400, step: 1, value: positionOf(START), format: (v) => fmt.int(grainsAt(v)),
  hint: "The scale is logarithmic, from 1 grain to 10,000. The drawing zooms out as the pile grows.",
  onInput: (v) => { state.n = grainsAt(v); state.moved = []; render(); },
});
const nReadout = $("output", nSlider.el);
const step = (by) => { state.n = Math.min(MAX, Math.max(1, state.n + by)); state.moved = []; render(); };
const lessBtn = button("Take one grain away", () => step(-1), { small: true });
const moreBtn = button("Add one grain", () => step(1), { small: true });

const mark = (which, n = state.n) => { const r = setMark(state.marks, which, n); state.marks = r.marks; state.moved = r.moved; render(); };
const markRows = [
  { key: "lo", btn: button("Certainly not a heap", () => mark("lo")), says: (m) => `${grains(m.lo)} or fewer` },
  { key: "mid", btn: button("A heap starts here", () => mark("mid"), { primary: true }), says: (m) => `at ${grains(m.mid)}` },
  { key: "hi", btn: button("Certainly a heap", () => mark("hi")), says: (m) => `${grains(m.hi)} or more` },
].map((r) => ({ ...r, value: el("span", { class: "mark-value" }) }));
const movedBox = el("div");
const shapeSeg = segmented({
  label: "Fuzzy curve between your marks", options: SHAPES, value: "log",
  hint: "Straight lines on the log scale, an S-curve, or straight lines in the grain count. All three pass through 0 at your lower mark, one half at your boundary and 1 at your upper mark.",
  onChange: (v) => { state.shape = v; render(); },
});
const resetBtn = button("Reset the marks", () => { state.marks = { ...DEFAULT_MARKS }; state.moved = []; render(); }, { small: true });

const controls = el("div", { class: "controls" },
  pileBox, summary, nSlider.el, el("div", { class: "row" }, lessBtn, moreBtn),
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("span", { text: "Mark the pile on screen as" })),
    el("div", { class: "marks" }, markRows.map((r) => [r.btn, r.value])),
    el("div", { class: "hint", text: "Move the slider to a pile, then press the button that fits. You can also click the first chart to put the boundary there." }),
    movedBox),
  shapeSeg.el, el("div", {}, resetBtn));

/* ---------- outputs ---------- */
const card = (title) => {
  const v = el("span", { class: "v" }), about = el("p"), argument = el("p");
  return { el: el("div", { class: "panel card" }, el("h3", { text: title }), v, about, argument), v, about, argument };
};
const cSharp = card("A sharp line (epistemicism)");
const cFuzzy = card("Degrees of truth (fuzzy logic)");
const cGap = card("A gap (supervaluationism)");
const modelBox = el("div");
const sSteps = stat("Steps in the argument");
const sWeak = stat("Least true step");
const sLost = stat("Truth lost over all steps");
const sFalse = stat("False steps on the sharp line");
const argumentText = el("div");
const chainBox = el("div");
const out = el("div", { class: "out" },
  el("div", { class: "cards" }, cSharp.el, cFuzzy.el, cGap.el), modelBox,
  el("div", {}, el("h3", { text: "The sorites argument, step by step" }), argumentText),
  el("div", { class: "stats" }, sSteps.el, sWeak.el, sLost.el, sFalse.el), chainBox);

$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out));

const pileCanvas = canvas(pileBox, { height: 250, draw: drawPile });
pileCanvas.el.setAttribute("role", "img");
const modelChart = chart(modelBox, { series: [], height: 300 });
const chainChart = chart(chainBox, { series: [], height: 280 });

// Pile sizes to plot: evenly spread on the log scale, plus the sizes next to each mark so that corners are exact.
function sampleSizes(m) {
  const set = new Set([1, MAX, m.lo, m.lo + 1, m.mid - 1, m.mid, m.hi - 1, m.hi, state.n]);
  for (let i = 0; i <= 240; i++) set.add(grainsAt(i * (400 / 240)));
  return [...set].filter((n) => n >= 1 && n <= MAX).sort((a, b) => a - b);
}

function render() {
  const { n, marks: m, shape } = state;
  const mu = membership(n, m, shape);
  const sv = supervaluation(n, m);
  const isHeap = crisp(n, m);
  const arg = sorites(m, shape);
  const claim = `"${grains(n)} make${n === 1 ? "s" : ""} a heap"`;
  const deg = (x) => fmt.num(x, 3);

  // Controls.
  nSlider.value = positionOf(n);
  nReadout.textContent = fmt.int(n);
  lessBtn.disabled = n <= 1;
  moreBtn.disabled = n >= MAX;
  markRows[0].btn.disabled = n >= MAX;
  markRows[1].btn.disabled = markRows[2].btn.disabled = n < 2;
  for (const r of markRows) r.value.textContent = r.says(m);
  movedBox.replaceChildren(...(state.moved.length ? [note("warn", `To keep the three marks in order, your mark for ${state.moved.map((k) => MARK_NAMES[k]).join(" and for ")} was moved too.`)] : []));
  pileCanvas.el.setAttribute("aria-label", `A pile of ${grains(n)}`);
  pileCanvas.redraw();
  summary.textContent = `${grains(n)}: ${isHeap ? "a heap" : "not a heap"} on the sharp line, a heap to degree ${fmt.num(mu, 2)} on the fuzzy curve, ${sv.status === "gap" ? "neither true nor false" : sv.status === "true" ? "certainly a heap" : "certainly not a heap"} on the gap view.`;

  // The three readings of this pile.
  cSharp.v.textContent = isHeap ? "True" : "False";
  cSharp.about.textContent = `There is an exact number at which a heap begins. If it is your ${fmt.int(m.mid)}, then ${claim} is ${isHeap ? "true" : "false"}. On this view nobody can find the number out, so your mark is a guess that is simply right or wrong.`;
  cSharp.argument.textContent = arg.count === 1
    ? `The argument has one step, from ${fmt.int(m.mid)} to ${fmt.int(m.mid - 1)}, and it is false.`
    : `The argument has one false step, from ${fmt.int(m.mid)} to ${fmt.int(m.mid - 1)}. The other ${fmt.int(arg.count - 1)} are true.`;
  cFuzzy.v.textContent = fmt.num(mu, 2);
  cFuzzy.about.textContent = `${claim} is true to this degree. Heapness rises from 0 at ${fmt.int(m.lo)} through one half at ${fmt.int(m.mid)} to 1 at ${fmt.int(m.hi)}, so there is no number at which a heap begins.`;
  cFuzzy.argument.textContent = arg.count === 1
    ? "With the marks this close the curve is a sharp line, and the one step is false."
    : `No step is false. The least true is true to degree ${deg(arg.weakest.truth)}, and the ${fmt.int(arg.count)} shortfalls add up to ${deg(arg.lost)}.`;
  cGap.v.textContent = sv.status === "gap" ? "Neither" : sv.status === "true" ? "True" : "False";
  cGap.about.textContent = `"Heap" could be made exact in ${fmt.int(sv.sharpenings)} acceptable way${sv.sharpenings === 1 ? "" : "s"}: a cut-off anywhere from ${fmt.int(m.lo + 1)} to ${fmt.int(m.hi)}. A sentence is true if it holds on all of them and false if on none. ${claim} holds on ${fmt.pct(sv.share, sv.share > 0 && sv.share < 0.1 ? 1 : 0)}.`;
  cGap.argument.textContent = sv.sharpenings === 1
    ? "With one acceptable cut-off there is no gap, and the one step is false."
    : `"Every step holds" fails on all ${fmt.int(sv.sharpenings)} cut-offs, so it is false, although each single step holds on ${fmt.int(sv.sharpenings - 1)} of them.`;

  // First chart: the three models over the whole scale.
  const sizes = sampleSizes(m);
  modelChart.update({
    title: `How true is "n grains make a heap"?`,
    subtitle: "Click the chart to put your boundary there.",
    label: "Line chart of the degree of truth of the claim that n grains make a heap, under three models",
    x: { label: "Grains (log scale)", type: "log", domain: [1, MAX], format: (v) => fmt.int(v) },
    y: { label: "Degree of truth", domain: [0, 1], format: (v) => fmt.num(v, 2) },
    series: [
      { name: "Gap view: no truth value in the shaded band", type: "range", data: [[m.lo, 0, 1], [m.hi, 0, 1]], color: 1 },
      { name: "Sharp line", type: "step", data: sizes.map((k) => [k, crisp(k, m) ? 1 : 0]), color: "#16233b", width: 1.6 },
      { name: "Fuzzy curve", data: sizes.map((k) => [k, membership(k, m, shape)]), color: 0, width: 2.4 },
    ],
    marks: [{ type: "vline", x: n }, { type: "point", x: n, y: mu, text: grains(n) }],
    onClick: ({ x, inside }) => { if (inside && Number.isFinite(x)) mark("mid", Math.round(x)); },
  });

  // The argument.
  argumentText.replaceChildren(
    el("ol", { class: "argument" },
      el("li", { text: `${grains(m.hi)} make a heap. (Your "certainly a heap" mark.)` }),
      el("li", { text: `If n grains make a heap, then n − 1 grains make a heap. (Asserted ${fmt.int(arg.count)} time${arg.count === 1 ? "" : "s"}, for n from ${fmt.int(m.hi)} down to ${fmt.int(m.lo + 1)}.)` }),
      el("li", { text: `So ${grains(m.lo)} make${m.lo === 1 ? "s" : ""} a heap. (Which you marked as certainly false.)` })),
    el("p", { class: "small muted", text: "In Łukasiewicz logic a step from n to n − 1 falls short of full truth by exactly the amount that heapness drops between the two piles. Each use of a step lets the conclusion's guaranteed truth fall by that much, and the drops must add up to the whole distance from 1 to 0." }));
  sSteps.set(fmt.int(arg.count), `from ${fmt.int(m.hi)} grains down to ${fmt.int(m.lo)}`);
  sWeak.set(deg(arg.weakest.truth), `from ${fmt.int(arg.weakest.n)} grains to ${fmt.int(arg.weakest.n - 1)}`);
  sLost.set(deg(arg.lost), `${fmt.int(arg.count - arg.perfect)} of ${fmt.int(arg.count)} steps lose something`);
  sFalse.set("1", `from ${fmt.int(m.mid)} grains to ${fmt.int(m.mid - 1)}`);

  // Second chart: the chain, thinned to a few hundred points when it is long, always keeping the least true step.
  const every = Math.max(1, Math.ceil(arg.count / 500));
  const kept = arg.steps.map((s, i) => ({ ...s, k: i + 1 })).filter((s) => s.k % every === 0 || s.k === 1 || s.k === arg.count || s.n === arg.weakest.n);
  const at = m.hi - n;
  chainChart.update({
    title: "What the argument does to the truth",
    subtitle: every > 1 ? `One step in ${fmt.int(every)} is drawn. The numbers above use all of them.` : "Every step is drawn.",
    label: "Line chart of the truth of each step of the sorites argument and the truth it leaves for the conclusion",
    x: { label: `Grains removed, starting from ${fmt.int(m.hi)}`, domain: [0, arg.count], format: (v) => fmt.int(v) },
    y: { label: "Degree of truth", domain: [0, 1], format: (v) => fmt.num(v, 2) },
    series: [
      { name: "Truth of each single step", data: kept.map((s) => [s.k, s.truth]), color: 1 },
      { name: "Truth still guaranteed for the conclusion", data: [[0, 1], ...kept.map((s) => [s.k, s.left])], color: 0, width: 2.4 },
    ],
    marks: at >= 0 && at <= arg.count ? [{ type: "vline", x: at, text: grains(n) }] : [],
  });
}

render();
