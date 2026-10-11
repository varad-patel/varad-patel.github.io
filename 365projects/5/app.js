// Day 5: Zeno's Series Calculator. Interface.
import { $, el, fmt, mount, slider, segmented, button, stat, note, table, chart, canvas, ticker, reducedMotion, palette, niceTicks } from "../kit/kit.js";
import { chase, stage, stages, positions, stagesCompleted, stagesUntilGap, lastStep } from "./logic.js";

mount();

const INK = "#16233b", SLATE = "#566478", GREY = "#8a94a3", GRID = "#dbe4de";
const BLUE = palette[0], ORANGE = palette[1];
const PLAY_SECONDS = 8;   // wall-clock seconds the animation takes to reach the catch-up point
const STEP_CAP = 300;     // the Step button stops counting here even when the arithmetic could go on
const TABLE_MIN = 600;    // px: below this width of its own box the stage table is laid out in four columns
const FONT = getComputedStyle(document.body).fontFamily;

const PRESETS = [
  { label: "Twice as fast", d: 100, vA: 10, vT: 5 },
  { label: "Ten times as fast", d: 100, vA: 10, vT: 1 },
  { label: "Barely faster", d: 100, vA: 10, vT: 9 },
  { label: "Equal speeds", d: 100, vA: 10, vT: 10 },
  { label: "Tortoise faster", d: 100, vA: 5, vT: 6 },
];

/* ---------- number formatting ---------- */
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const sup = (n) => [...String(n)].map((ch) => SUP[ch]).join("");
function sci(x) {
  let e = Math.floor(Math.log10(Math.abs(x)));
  let m = x / 10 ** e;
  if (Math.abs(m) >= 9.995) { m /= 10; e++; }
  return `${fmt.num(m, 2)} × 10${sup(e)}`;
}
const plain = (x, digits = 4) => (!Number.isFinite(x) ? "no limit" : x === 0 ? "0" : Math.abs(x) >= 1e7 || Math.abs(x) < 1e-4 ? sci(x) : fmt.sig(x, digits));
const UNITS = { m: [[1, "m"], [1e-2, "cm"], [1e-3, "mm"], [1e-6, "µm"], [1e-9, "nm"]], s: [[1, "s"], [1e-3, "ms"], [1e-6, "µs"], [1e-9, "ns"]] };
/** 0.0977 m becomes "9.77 cm": small lengths and times are easier to read in a smaller unit. */
function withUnit(x, unit, digits = 4) {
  const a = Math.abs(x);
  if (!Number.isFinite(a)) return "no limit";
  if (a === 0) return `0 ${unit}`;
  if (a >= 1e7) return `${sci(x)} ${unit}`;
  for (const [size, name] of UNITS[unit]) if (a >= size) return `${fmt.sig(x / size, digits)} ${name}`;
  return `${sci(x)} ${unit}`;
}
/** The decimal places it takes to show that a partial sum is still short of its limit, or null once they pass the 15 digits a 64-bit float can show. */
function decimalsFor(short, limit) {
  const whole = Math.max(1, Math.floor(Math.log10(limit)) + 1);
  const need = Math.max(2, Math.ceil(-Math.log10(short)) + 1);
  return need <= 15 - whole ? need : null;
}
/** A partial sum for the table: written out while its digits can show the shortfall, then as the limit minus the shortfall. */
function partial(value, short, limit, unit) {
  if (!Number.isFinite(limit)) return `${plain(value, 6)} ${unit}`;
  if (short === 0) return withUnit(value, unit);
  const places = decimalsFor(short, limit);
  return places == null ? `limit − ${withUnit(short, unit, 3)}` : `${fmt.num(value, places)} ${unit}`;
}
/** A limit to as many digits as any partial sum above it, so that a row never appears to have passed it. */
const exact = (x, unit) => `${fmt.sig(x, 15)} ${unit}`;

/* ---------- state ---------- */
const state = { d: 100, vA: 10, vT: 5, n: 12, zoom: 0, view: "distance", t: 0, stepK: null };
let c = chase({ headStart: state.d, achilles: state.vA, tortoise: state.vT });
let lastShown = -1;

const horizon = () => (c.catches ? c.catchTime : (4 * c.d) / c.vA);   // what PLAY_SECONDS of animation covers
const tEnd = () => (c.catches ? 1.15 * c.catchTime : horizon());
const listed = () => (c.r === 0 ? 1 : state.n);
const stepCap = () => lastStep(c, STEP_CAP);

/** The moment on screen. After a Step the numbers come from the stage formulas, which stay exact when the lead is tiny. */
function now() {
  if (state.stepK != null) {
    const s = stage(c, state.stepK);
    return { t: s.time, achilles: s.distance, tortoise: s.tortoise, gap: s.gap, done: state.stepK };
  }
  return { t: state.t, ...positions(c, state.t), done: stagesCompleted(c, state.t) };
}

/* ---------- controls ---------- */
const dS = slider({ label: "Tortoise's head start", min: 1, max: 500, step: 1, value: state.d, format: (v) => `${fmt.int(v)} m`, onInput: (v) => { state.d = v; changed(); } });
const aS = slider({ label: "Achilles' speed", min: 1, max: 12, step: 0.1, value: state.vA, format: (v) => `${fmt.num(v, 1)} m/s`, onInput: (v) => { state.vA = v; changed(); } });
const tS = slider({
  label: "Tortoise's speed", min: 0, max: 12, step: 0.1, value: state.vT, format: (v) => `${fmt.num(v, 1)} m/s`,
  hint: "Set it at or above Achilles' speed to see a chase with no catch-up point.",
  onInput: (v) => { state.vT = v; changed(); },
});
const nS = slider({ label: "Stages to list", min: 5, max: 60, step: 1, value: state.n, format: fmt.int, onInput: (v) => { state.n = v; rebuild(); render(); } });
const zS = slider({
  label: "Zoom in on the catch-up point", min: 0, max: 9, step: 1, value: 0, format: (k) => `× ${fmt.int(10 ** k)}`,
  hint: "Each stage is r times the one before, so the track near the catch-up point looks the same at every scale. Use Step to walk the runners into view.",
  onInput: (k) => { state.zoom = k; scene.redraw(); },
});
const viewSeg = segmented({
  label: "Chart shows", value: state.view,
  options: [{ value: "distance", label: "Distance" }, { value: "time", label: "Time" }, { value: "gap", label: "Tortoise's lead" }],
  onChange: (v) => { state.view = v; drawChart(); },
});
// A range input announces its bare number. Give assistive technology the same text as the readout beside the label.
const voiced = [dS, aS, tS, nS, zS];
function sayValues() { for (const s of voiced) s.input.setAttribute("aria-valuetext", s.el.querySelector("output").textContent.replace("×", "times")); }
for (const s of voiced) s.input.addEventListener("input", sayValues);
sayValues();

const presetRow = el("div", { class: "field" },
  el("div", { class: "lab" }, el("span", { text: "Examples" })),
  el("div", { class: "row" }, PRESETS.map((p) => button(p.label, () => {
    Object.assign(state, { d: p.d, vA: p.vA, vT: p.vT });
    dS.value = p.d; aS.value = p.vA; tS.value = p.vT;
    sayValues();
    changed();
  }, { small: true }))));

const controls = el("div", { class: "controls" }, presetRow, dS.el, aS.el, tS.el, zS.el, nS.el, viewSeg.el);

/* ---------- outputs ---------- */
const sRatio = stat("Ratio r, tortoise ÷ Achilles");
const sPoint = stat("Catch-up point");
const sTime = stat("Catch-up time");
const sMm = stat("Stages until the lead is under 1 mm");
const message = el("div");
const legend = el("div", { class: "chart-legend" },
  el("span", {}, el("i", { class: "dot", style: { background: BLUE } }), "Achilles"),
  el("span", {}, el("i", { style: { background: ORANGE, borderRadius: "7px 7px 0 0" } }), "Tortoise"),
  el("span", {}, el("i", { class: "line", style: { borderTopColor: BLUE } }), "Stage completed"),
  el("span", {}, el("i", { class: "line", style: { borderTopColor: GREY } }), "Stage still to run"));
const sceneBox = el("div");
const readout = el("p", { class: "small zeno-readout" });
const caption = el("p", { class: "small muted", role: "status", style: { marginTop: "8px" } });
const playBtn = button("Play", toggle, { primary: true });
const stepBtn = button("Step to the next stage", step);
const resetBtn = button("Reset", () => { loop.stop(); state.t = 0; state.stepK = null; render(); say("start"); });
const seriesBox = el("div", { class: "panel zeno-series" });
const TRACK = "Achilles chasing the tortoise along a straight track.";
const chartBox = el("div");
const tableBox = el("div", { class: "zeno-table" });
let narrowTable = false;
const tableIsNarrow = () => tableBox.clientWidth > 0 && tableBox.clientWidth < TABLE_MIN;

const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sRatio.el, sPoint.el, sTime.el, sMm.el),
  message,
  el("div", {}, el("p", { class: "chart-title", text: "The chase" }), legend, sceneBox, readout, el("div", { class: "row", style: { marginTop: "8px" } }, playBtn, stepBtn, resetBtn), caption),
  seriesBox, chartBox, tableBox);

$("#app").append(el("div", { class: "tool-grid" }, controls, out));

/* ---------- the animated track ---------- */
function viewRange() {
  if (c.catches) {
    const z = 10 ** state.zoom;
    return [c.catchPoint * (1 - 1 / z), c.catchPoint * (1 + 0.15 / z)];
  }
  return [0, 1.05 * Math.max(c.d * (1 + 4 * c.r), now().tortoise)];
}

function drawScene(ctx, W, H) {
  const [x0, x1] = viewRange();
  const L = 14, R = W - 14;
  const sx = (v) => L + ((v - x0) / (x1 - x0)) * (R - L);
  const yA = 44, yT = 92, yGap = 68, yStage = 124, yAxis = 152;
  const p = now();
  const zoomed = c.catches && state.zoom > 0;
  ctx.font = `12px ${FONT}`;
  ctx.textBaseline = "middle";
  ctx.lineCap = "butt";

  // Lanes.
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  for (const y of [yA, yT]) { ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(R, y); ctx.stroke(); }

  // Zeno's stages: stage k runs from the end of stage k - 1 to where the tortoise was when it began.
  const first = stagesCompleted(c, x0 / c.vA);          // stages that end left of the view
  let from = first > 0 ? stage(c, first).distance : 0;
  for (let k = first + 1; k <= first + 400; k++) {
    const s = stage(c, k);
    const a = sx(from), b = sx(s.distance);
    if (a > R || b - a < 0.75) break;
    if (b >= L) {
      const done = p.done >= k;
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      if (b <= R) { ctx.beginPath(); ctx.moveTo(b, 26); ctx.lineTo(b, yStage); ctx.stroke(); }
      ctx.strokeStyle = done ? BLUE : GREY; ctx.lineWidth = done ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(Math.max(a, L), yStage); ctx.lineTo(Math.min(b, R), yStage); ctx.stroke();
      ctx.lineWidth = 1.5;
      if (b <= R) { ctx.beginPath(); ctx.moveTo(b, yStage - 5); ctx.lineTo(b, yStage + 5); ctx.stroke(); }
      const left = Math.max(a, L), right = Math.min(b, R);
      if (right - left >= 18) { ctx.fillStyle = done ? INK : SLATE; ctx.textAlign = "center"; ctx.fillText(String(k), (left + right) / 2, yStage - 11); }
    }
    from = s.distance;
  }

  // Axis.
  ctx.strokeStyle = "#b9c5bd"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(L, yAxis); ctx.lineTo(R, yAxis); ctx.stroke();
  const base = zoomed ? c.catchPoint : 0;
  ctx.fillStyle = SLATE;
  for (const v of niceTicks(x0 - base, x1 - base, Math.max(2, Math.floor(W / 120))).ticks) {
    const x = sx(v + base);
    if (x < L - 0.5 || x > R + 0.5) continue;
    ctx.beginPath(); ctx.moveTo(x, yAxis); ctx.lineTo(x, yAxis + 5); ctx.stroke();
    ctx.textAlign = x < L + 24 ? "left" : x > R - 24 ? "right" : "center";
    ctx.fillText(zoomed ? (v === 0 ? "0" : withUnit(v, "m", 3)) : plain(v, 6), x, yAxis + 16);
  }
  ctx.textAlign = "center";
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText(zoomed ? `Distance from the catch-up point (${fmt.sig(c.catchPoint, 6)} m from the start)` : "Distance from Achilles' starting line (m)", W / 2, H - 10);
  ctx.font = `12px ${FONT}`;

  // The catch-up point.
  if (c.catches) {
    const x = sx(c.catchPoint);
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, yAxis); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = INK; ctx.textAlign = "right"; ctx.font = `600 12px ${FONT}`;
    ctx.fillText("catch-up point", x - 6, 12);
    ctx.font = `12px ${FONT}`;
  }

  // The tortoise's lead, when there is room to write it.
  const xa = sx(p.achilles), xt = sx(p.tortoise);
  if (p.gap > 0 && xa >= L && xt <= R && xt - xa >= 84) {
    ctx.strokeStyle = SLATE; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xa, yGap + 9); ctx.lineTo(xt, yGap + 9); ctx.moveTo(xa, yGap + 5); ctx.lineTo(xa, yGap + 13); ctx.moveTo(xt, yGap + 5); ctx.lineTo(xt, yGap + 13); ctx.stroke();
    ctx.fillStyle = SLATE; ctx.textAlign = "center";
    ctx.fillText(`lead ${withUnit(p.gap, "m", 3)}`, (xa + xt) / 2, yGap - 2);
  }

  // Runners: a trail from the start, then the marker, or an arrow at the edge when the runner is out of view.
  const runner = (pos, start, y, color, shape) => {
    const x = sx(pos);
    const a = Math.max(L, sx(start)), b = Math.min(R, x);
    if (b > a) { ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(a, y); ctx.lineTo(b, y); ctx.stroke(); }
    ctx.fillStyle = color;
    ctx.beginPath();
    if (x < L - 1) { ctx.moveTo(L - 8, y); ctx.lineTo(L + 2, y - 7); ctx.lineTo(L + 2, y + 7); }
    else if (x > R + 1) { ctx.moveTo(R + 8, y); ctx.lineTo(R - 2, y - 7); ctx.lineTo(R - 2, y + 7); }
    else if (shape === "dome") { ctx.arc(x, y + 1, 10, Math.PI, 2 * Math.PI); }
    else ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
  };
  runner(p.tortoise, c.d, yT, ORANGE, "dome");
  runner(p.achilles, 0, yA, BLUE, "dot");
}

const scene = canvas(sceneBox, { height: 196, draw: drawScene });
scene.el.setAttribute("role", "img");

/* ---------- words ---------- */
function describe(p) {
  // While the clock runs one decimal is plenty; after a Step the positions are partial sums and need their digits.
  // Once those digits run out, the sentence says how far short of the catch-up point each runner is instead.
  const stepped = state.stepK != null && c.catches && p.gap > 0;
  const s = stepped ? stage(c, state.stepK) : null;
  const fine = (x, short, limit, unit, what) => {
    const places = decimalsFor(short, limit);
    return places == null ? `${withUnit(short, unit, 3)} short of the catch-up ${what}` : `${what === "time" ? "" : "at "}${fmt.num(x, places)} ${unit}`;
  };
  const coarse = (x, unit, places) => `${Math.abs(x) >= 1e7 ? sci(x) : fmt.num(x, places)} ${unit}`;
  const where = stepped
    ? `Time ${fine(p.t, s.shortTime, c.catchTime, "s", "time")}. Achilles ${fine(p.achilles, s.short, c.catchPoint, "m", "point")}, tortoise ${fine(p.tortoise, s.short * c.r, c.catchPoint, "m", "point")}.`
    : `Time ${coarse(p.t, "s", 2)}. Achilles at ${coarse(p.achilles, "m", 1)}, tortoise at ${coarse(p.tortoise, "m", 1)}.`;
  if (p.gap > 0) return `${where} Tortoise ahead by ${withUnit(p.gap, "m")}. Stages completed: ${fmt.int(p.done)}.`;
  if (p.gap === 0) return `${where} They are level.`;
  return `${where} Achilles ahead by ${withUnit(-p.gap, "m")}. All of Zeno's stages are behind him.`;
}

function say(event) {
  const p = now();
  let text = "";
  if (event === "step") {
    if (p.gap === 0) text = "One stage is all there is: the tortoise never moved, so Achilles has reached it.";
    else if (!c.catches) text = `Stage ${p.done} is done and the tortoise is ${c.r === 1 ? "exactly as far ahead as at the start" : "further ahead than before"}. The stages go on for ever and so does the chase.${p.done >= stepCap() ? " The Step button stops counting here; the stages do not." : ""}`;
    else if (p.done >= stepCap()) text = p.done >= STEP_CAP
      ? `Stage ${p.done} is done. The Step button stops counting here; the stages do not.`
      : `Stage ${p.done} is done and the tortoise leads by ${withUnit(p.gap, "m", 3)}. One stage further on, this page's arithmetic can no longer tell Achilles' position from the catch-up point, so the Step button stops here. The mathematics has infinitely many stages left.`;
    else text = `Stage ${p.done} is done: Achilles is where the tortoise was, and the tortoise has moved on by ${withUnit(p.gap, "m", 3)}. However often you step there is a next stage, and every one of them ends before the catch-up time, ${fmt.sig(c.catchTime, 6)} s.`;
  } else if (event === "end") {
    text = c.catches
      ? `Achilles drew level at ${fmt.sig(c.catchTime, 6)} s, ${fmt.sig(c.catchPoint, 6)} m from his start, and ran on. Every one of the infinitely many stages was over before that moment.`
      : `The tortoise is still ahead and its lead is ${c.r === 1 ? "unchanged" : "growing"}. Here the stages do not fit inside any finite time.`;
  } else if (event === "start") {
    text = "Press Play to run the chase, or Step to take it one of Zeno's stages at a time.";
  }
  caption.textContent = text;
  scene.el.setAttribute("aria-label", `${TRACK} ${describe(p)}`);
}

/* ---------- chart and table ---------- */
const plot = chart(chartBox, { series: [], height: 300 });

function drawChart() {
  const list = stages(c, listed());
  const done = Math.min(now().done, list.length);
  const spec = { marks: [], legend: false, x: { label: "Stage", domain: [0, list.length], format: fmt.int, ticks: Math.min(list.length, 6) } };
  let pts;
  if (state.view === "gap") {
    pts = [[0, c.d], ...list.map((s) => [s.k, s.gap])].filter((q) => q[1] > 0);
    // The kit's log axis labels every decade, which is right for a few decades and unreadable for sixty.
    // Past ten decades the chart plots the exponent on a linear axis and labels it as a power of ten.
    const wide = Math.abs(Math.log10(pts.at(-1)[1] / pts[0][1])) > 10;
    if (wide) pts = pts.map(([k, g]) => [k, Math.log10(g)]);
    spec.title = "The tortoise's lead after each stage";
    spec.subtitle = c.catches
      ? "On a log scale the lead falls in a straight line: every stage multiplies it by the same r. It gets as small as you like and is never zero."
      : c.r === 1 ? "The lead is the same after every stage." : "Every stage multiplies the lead by r, which is more than 1, so it grows without limit.";
    spec.y = wide
      ? { label: "Tortoise's lead (m, log scale)", format: (v) => (Number.isInteger(v) && (v < -3 || v > 6) ? `10${sup(v)}` : plain(10 ** v, 4)) }
      : { label: "Tortoise's lead (m, log scale)", type: "log", format: (v) => plain(v, 4) };
  } else {
    const time = state.view === "time";
    const limit = time ? c.catchTime : c.catchPoint;
    const unit = time ? "s" : "m";
    pts = [[0, 0], ...list.map((s) => [s.k, time ? s.time : s.distance])];
    spec.title = time ? "Time used after each stage" : "Distance Achilles has run after each stage";
    spec.subtitle = c.r === 0
      ? "The tortoise stands still, so the first stage is the whole chase and the sum has one term."
      : c.catches
      ? `Each dot adds one more stage to the sum. The dashed line is the limit, ${fmt.sig(limit, 6)} ${unit}: the sums get as close as you like and none of them reaches it.`
      : "The stages do not shrink, so the sum passes every level you care to name. There is no limit to draw.";
    spec.y = { label: time ? "Time so far (s)" : "Distance so far (m)", format: (v) => plain(v, 7), zero: true, domain: c.catches ? [0, limit * 1.1] : undefined };
    if (c.catches) spec.marks.push({ type: "hline", y: limit, text: `${time ? "catch-up time" : "catch-up point"} ${fmt.sig(limit, 6)} ${unit}` });
  }
  spec.label = `${spec.title}, for the first ${list.length} stages`;
  spec.series = [
    { name: state.view === "gap" ? "Lead" : "Partial sum", type: "line", data: pts, color: GREY, width: 1.5 },
    { type: "scatter", data: pts.filter((q) => q[0] > done), color: GREY, r: 3 },
    { type: "scatter", data: pts.filter((q) => q[0] >= 1 && q[0] <= done), color: 0, r: 4 },
  ];
  plot.update(spec);
}

function markRows() {
  const done = Math.min(now().done, listed());
  [...tableBox.querySelectorAll("tbody tr")].forEach((tr, i) => tr.classList.toggle("reached", i < done && !tr.classList.contains("limit")));
}

/** Everything that depends on the inputs but not on the clock. */
function rebuild() {
  const { d, vA, vT, r } = c;
  sRatio.set(fmt.sig(r, 4), r < 1 ? `${fmt.num(vT, 1)} ÷ ${fmt.num(vA, 1)}: each stage is r times the one before` : `${fmt.num(vT, 1)} ÷ ${fmt.num(vA, 1)}: the stages do not shrink`);
  if (c.catches) {
    sPoint.set(`${fmt.sig(c.catchPoint, 6)} m`, `d ÷ (1 − r) = ${fmt.int(d)} ÷ ${fmt.sig(1 - r, 4)}`);
    sTime.set(`${fmt.sig(c.catchTime, 6)} s`, `d ÷ (vA − vT) = ${fmt.int(d)} ÷ ${fmt.sig(vA - vT, 3)}`);
    sMm.set(fmt.int(stagesUntilGap(c, 1e-3)), r === 0 ? "the tortoise is not moving" : "with infinitely many still to come");
  } else {
    sPoint.set("None", "the distances add up without limit");
    sTime.set("Never", "the times add up without limit");
    sMm.set("Never", r === 1 ? `the lead stays at ${fmt.int(d)} m` : "the lead grows");
  }
  message.replaceChildren(...(!c.catches
    ? [note("warn", el("strong", { text: "No catch-up point. " }), r === 1
        ? `Both run at ${fmt.num(vA, 1)} m/s, so r = 1. Every stage is ${fmt.int(d)} m long and takes ${withUnit(d / vA, "s")}, the partial sums are ${fmt.int(d)}, ${fmt.int(2 * d)}, ${fmt.int(3 * d)} … and they never settle. Zeno's conclusion is correct here, and for an ordinary reason.`
        : `The tortoise is faster, so r = ${fmt.sig(r, 4)} is more than 1. Each stage is longer than the one before, the partial sums grow without limit, and the lead widens for ever. The formula d ÷ (vA − vT) gives a negative time, which is not a meeting in this race.`)]
    : r === 0
      ? [note("", "The tortoise is standing still, so r = 0. There is one stage and nothing left over: no infinite series, no paradox.")]
      : []));

  zS.el.hidden = !c.catches;   // there is nothing to zoom in on when the runners never meet

  const legs = stages(c, 5);
  const terms = (key) => legs.map((s) => plain(s[key], 4)).join(" + ");
  seriesBox.replaceChildren(
    el("h2", { text: "The two series" }),
    ...(r === 0
      ? [el("p", {}, `Distance: ${fmt.int(d)} m. Time: ${withUnit(d / vA, "s")}. One term each.`)]
      : [
        el("p", {}, el("strong", { text: "Distance (m): " }), `${terms("leg")} + … `, c.catches ? `has the limit ${fmt.sig(c.catchPoint, 6)}` : "has no limit"),
        el("p", {}, el("strong", { text: "Time (s): " }), `${terms("legTime")} + … `, c.catches ? `has the limit ${fmt.sig(c.catchTime, 6)}` : "has no limit"),
        el("p", { class: "muted small" }, `Each term is the one before multiplied by r = ${fmt.sig(r, 4)}.`),
      ]));

  const rows = stages(c, listed()).map((s) => ({
    k: fmt.int(s.k), leg: withUnit(s.leg, "m"), distance: partial(s.distance, s.short, c.catchPoint, "m"),
    legTime: withUnit(s.legTime, "s"), time: partial(s.time, s.shortTime, c.catchTime, "s"), gap: withUnit(s.gap, "m"),
  }));
  if (r > 0) rows.push(c.catches
    ? { k: "Limit", leg: "0 m", distance: exact(c.catchPoint, "m"), legTime: "0 s", time: exact(c.catchTime, "s"), gap: "0 m" }
    : { k: "Limit", leg: r === 1 ? `${fmt.int(d)} m` : "none", distance: "none", legTime: r === 1 ? withUnit(d / vA, "s") : "none", time: "none", gap: r === 1 ? `${fmt.int(d)} m` : "none" });
  // Six columns do not fit a phone. On a narrow screen each distance shares a cell with its time, one above the other.
  const pair = (a, b) => el("span", {}, a, el("br"), b);
  narrowTable = tableIsNarrow();
  tableBox.classList.toggle("narrow", narrowTable);
  const t = narrowTable
    ? table({
      caption: "Zeno's stages, one row each",
      columns: [
        { key: "k", label: "Stage" },
        { key: "leg", label: "This stage: length, time", num: true },
        { key: "sofar", label: "So far: distance, time", num: true },
        { key: "gap", label: "Tortoise's lead after it", num: true },
      ],
      rows: rows.map((x) => ({ k: x.k, leg: pair(x.leg, x.legTime), sofar: pair(x.distance, x.time), gap: x.gap })),
    })
    : table({
      caption: "Zeno's stages, one row each",
      columns: [
        { key: "k", label: "Stage" },
        { key: "leg", label: "This stage", num: true },
        { key: "distance", label: "Distance so far", num: true },
        { key: "legTime", label: "It takes", num: true },
        { key: "time", label: "Time so far", num: true },
        { key: "gap", label: "Tortoise's lead after it", num: true },
      ],
      rows,
    });
  if (r > 0) t.querySelector("tbody tr:last-child").classList.add("limit");
  tableBox.replaceChildren(t);
  lastShown = -1;
}

/** Everything that depends on the clock. */
function render() {
  scene.redraw();
  const p = now();
  readout.textContent = describe(p);
  const shown = Math.min(p.done, listed());
  if (shown !== lastShown) { lastShown = shown; drawChart(); markRows(); }
  stepBtn.disabled = !(p.done < stepCap());
  playBtn.textContent = loop.running ? "Pause" : "Play";
}

/* ---------- transport ---------- */
const loop = ticker((dt) => {
  state.t += (dt * horizon()) / PLAY_SECONDS;
  if (state.t >= tEnd()) { state.t = tEnd(); loop.stop(); render(); say("end"); return; }
  render();
});

function toggle() {
  if (loop.running) { loop.stop(); render(); say(""); return; }
  if (state.stepK != null) { state.t = stage(c, state.stepK).time; state.stepK = null; }
  if (state.t >= tEnd()) state.t = 0;
  caption.textContent = "";
  scene.el.setAttribute("aria-label", `${TRACK} The chase is running: the line below the picture gives the time and both positions.`);
  loop.start();
  render();
}

function step() {
  loop.stop();
  const p = now();
  if (!(p.done < stepCap())) return;
  state.stepK = p.done + 1;
  state.t = stage(c, state.stepK).time;
  render();
  say("step");
}

function changed() {
  c = chase({ headStart: state.d, achilles: state.vA, tortoise: state.vT });
  if (c.error) { loop.stop(); message.replaceChildren(note("bad", c.error)); return; }
  state.t = 0;
  state.stepK = null;
  rebuild();
  render();
  say(loop.running ? "" : "start");
}

rebuild();
render();
say("start");
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { if (tableIsNarrow() !== narrowTable) { rebuild(); render(); } }).observe(tableBox);
// The chase starts by itself the first time the track is on screen (on a phone it sits below the controls),
// unless the visitor has asked for reduced motion or has already started it.
if (!reducedMotion()) {
  const begin = () => { if (!loop.running && state.t === 0 && state.stepK == null) toggle(); };
  if (typeof IntersectionObserver === "undefined") begin();
  else {
    const seen = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { seen.disconnect(); begin(); } }, { threshold: 0.5 });
    seen.observe(scene.el);
  }
}
