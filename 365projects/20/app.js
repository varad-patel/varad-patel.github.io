// Day 20: Bertrand's Paradox Simulator. Interface.
import { $, el, fmt, mount, slider, segmented, button, stat, note, table, chart, canvas, ticker, palette } from "../kit/kit.js";
import { SIDE, METHODS, standardError, createRun, crossing, innerTest } from "./logic.js";

mount();

const INK = "#16233b", SLATE = "#566478", FAINT = "#c3ccc7";
const LONG = palette[0], SHORT = palette[1];
const METHOD_COLOR = { endpoints: 2, radius: 3, midpoint: 6 };   // palette indices, kept apart from the long and short colours
const FONT = getComputedStyle(document.body).fontFamily;
const CHORDS_SHOWN = 300;      // chords drawn in the big picture
const START = 300;             // chords drawn on load
const CAP = 2000000;           // chords per method at which the Draw buttons stop
const JAYNES_N = 50000;        // chords per method in the small-circle test

const state = { method: "endpoints", seed: 20, innerR: 0.4, innerOffset: 0.5 };
let run = createRun(state.seed).add(START);
const method = () => METHODS.find((m) => m.key === state.method);
const inner = () => ({ x: state.innerOffset, y: 0, r: state.innerR });

/* ---------- controls ---------- */
const methodSeg = segmented({
  label: "How to pick a chord at random", value: state.method,
  options: METHODS.map((m) => ({ value: m.key, label: m.label })),
  onChange: (v) => { state.method = v; render(); },
});
const recipe = el("div", { class: "hint" });
methodSeg.el.append(recipe);

const drawButtons = [1, 100, 100000].map((count) => button(`Draw ${fmt.int(count)}`, () => { add(count); }, { small: true }));
const streamBtn = button("Keep drawing", () => { stream.running ? stream.stop() : stream.start(); render(); }, { primary: true });
const restartBtn = button("Start again", () => { stream.stop(); run = createRun(state.seed); render(); });
const seedS = slider({
  label: "Seed", min: 1, max: 99, step: 1, value: state.seed, format: fmt.int,
  hint: "The same seed always draws the same chords. Changing it starts a new run.",
  onInput: (v) => { state.seed = v; stream.stop(); run = createRun(v).add(START); render(); drawJaynes(); },
});
const capNote = el("div", { class: "hint" });

const controls = el("div", { class: "controls" },
  methodSeg.el,
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("span", { text: "Draw chords by all three methods" })),
    el("div", { class: "row" }, drawButtons),
    el("div", { class: "row" }, streamBtn, restartBtn),
    capNote),
  seedS.el);

/* ---------- outputs ---------- */
const sN = stat("Chords drawn");
const sShare = stat("Longer than the triangle's side");
const sTheory = stat("This method's exact answer");
const sGap = stat("Estimate minus exact");
const message = el("div");
const legend = el("div", { class: "chart-legend" },
  el("span", {}, el("i", { class: "line", style: { borderTopColor: LONG } }), "Longer than the side of the triangle"),
  el("span", {}, el("i", { class: "line", style: { borderTopColor: SHORT } }), "Shorter"),
  el("span", {}, el("i", { class: "line", style: { borderTopColor: INK, borderTopStyle: "dashed" } }), "Half the radius: a chord is long when its midpoint is inside"));
const mainBox = el("div");
const latest = el("p", { class: "small", role: "status" });
const cardsBox = el("div", { class: "b-cards" });
const chartBox = el("div");

/* ---------- drawing helpers ---------- */
function circle(ctx, cx, cy, R, { color = INK, width = 1.5, dash = null } = {}) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
  ctx.setLineDash([]);
}
function triangle(ctx, cx, cy, R) {
  ctx.strokeStyle = INK; ctx.lineWidth = 1.25; ctx.globalAlpha = 0.75;
  ctx.beginPath();
  [90, 210, 330].forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const x = cx + R * Math.cos(a), y = cy - R * Math.sin(a);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.closePath(); ctx.stroke();
  ctx.globalAlpha = 1;
}
function chordLine(ctx, cx, cy, R, c, color, width, alpha) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(cx + c.x1 * R, cy - c.y1 * R); ctx.lineTo(cx + c.x2 * R, cy - c.y2 * R); ctx.stroke();
  ctx.globalAlpha = 1;
}
function title(ctx, text, x, y) {
  ctx.fillStyle = SLATE; ctx.font = `600 12px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

/* ---------- the big picture: chords on the left, their midpoints on the right ---------- */
const TOP = 26;
function drawMain(ctx, W, H) {
  const wide = W >= 520;
  const cellW = wide ? W / 2 : W, cellH = wide ? H : H / 2;
  const R = Math.min(cellW, cellH - TOP) / 2 - 10;
  const cells = wide ? [[W / 4, TOP + (H - TOP) / 2], [(3 * W) / 4, TOP + (H - TOP) / 2]] : [[W / 2, TOP + (cellH - TOP) / 2], [W / 2, cellH + TOP + (cellH - TOP) / 2]];
  const d = run.data[state.method];

  // Chords.
  let [cx, cy] = cells[0];
  const chords = d.recent.slice(-CHORDS_SHOWN);
  title(ctx, chords.length ? `The latest ${fmt.int(chords.length)} chord${chords.length === 1 ? "" : "s"}` : "Chords", cx, cy - R - 14);
  for (const c of chords) chordLine(ctx, cx, cy, R, c, c.long ? LONG : SHORT, 1, 0.3);
  triangle(ctx, cx, cy, R);
  circle(ctx, cx, cy, R);
  const last = chords.at(-1);
  if (last) {
    chordLine(ctx, cx, cy, R, last, last.long ? LONG : SHORT, 3, 1);
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(cx + last.mx * R, cy - last.my * R, 3.5, 0, 2 * Math.PI); ctx.fill();
  }

  // Midpoints.
  [cx, cy] = cells[1];
  title(ctx, d.recent.length ? `The midpoints of the latest ${fmt.int(d.recent.length)}` : "Midpoints", cx, cy - R - 14);
  ctx.globalAlpha = 0.6;
  for (const c of d.recent) {
    ctx.fillStyle = c.long ? LONG : SHORT;
    ctx.beginPath(); ctx.arc(cx + c.mx * R, cy - c.my * R, 1.6, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.globalAlpha = 1;
  circle(ctx, cx, cy, R / 2, { width: 1.25, dash: [5, 4] });
  circle(ctx, cx, cy, R);
}
const mainCanvas = canvas(mainBox, { height: (w) => (w >= 520 ? Math.min(380, Math.round(w / 2)) : 2 * Math.min(w, 320)), draw: drawMain });
mainCanvas.el.setAttribute("role", "img");

/* ---------- the three methods side by side ---------- */
const cards = METHODS.map((m) => {
  const box = el("div", { class: "b-card" });
  const cvBox = el("div");
  const big = el("div", { class: "b-share" });
  const small = el("div", { class: "small muted" });
  box.append(el("h3", {}, el("i", { class: "sw", style: { background: palette[METHOD_COLOR[m.key]] } }), m.label), cvBox, big, small);
  cardsBox.append(box);
  const cv = canvas(cvBox, {
    height: 140,
    draw(ctx, W, H) {
      // The kit's canvas never reports a width under 200 px, and on a phone these cards are narrower than that.
      // Scaling by reported over real width lets the drawing use real CSS pixels, so the circle stays round.
      const real = ctx.canvas.clientWidth || W;
      ctx.save();
      ctx.scale(W / real, 1);
      const R = Math.min(real, H) / 2 - 6;
      for (const c of run.data[m.key].recent.slice(-150)) chordLine(ctx, real / 2, H / 2, R, c, c.long ? LONG : SHORT, 1, 0.35);
      circle(ctx, real / 2, H / 2, R, { width: 1.25 });
      ctx.restore();
    },
  });
  cv.el.setAttribute("role", "img");
  return { m, box, big, small, cv };
});

/* ---------- Jaynes's test ---------- */
const rS = slider({
  label: "Size of the small circle", min: 0.15, max: 0.6, step: 0.05, value: state.innerR, format: (v) => `${fmt.num(v, 2)} of the big radius`,
  onInput: (v) => { state.innerR = v; fitInner(); drawJaynes(); },
});
const oS = slider({
  label: "Its distance from the centre", min: 0, max: 0.8, step: 0.05, value: state.innerOffset, format: (v) => `${fmt.num(v, 2)} of the big radius`,
  hint: "At 0 the two circles share a centre, which tests a change of size alone.",
  onInput: (v) => { state.innerOffset = v; fitInner(); drawJaynes(); },
});
/** Keep the small circle inside the big one. */
function fitInner() {
  const most = Math.round((0.95 - state.innerR) * 20) / 20;
  if (state.innerOffset > most + 1e-9) { state.innerOffset = most; oS.value = most; }
}
const jaynesCanvasBox = el("div");
const jaynesTable = el("div");
const jaynesNote = el("div");
const jaynesCanvas = canvas(jaynesCanvasBox, {
  height: (w) => Math.min(w, 260),
  draw(ctx, W, H) {
    const R = Math.min(W, H) / 2 - 8, cx = W / 2, cy = H / 2;
    const small = inner();
    for (const c of run.data[state.method].recent.slice(-CHORDS_SHOWN)) {
      const t = crossing(c, small);
      chordLine(ctx, cx, cy, R, c, t.hits ? (t.long ? LONG : SHORT) : FAINT, 1, t.hits ? 0.55 : 0.5);
    }
    circle(ctx, cx, cy, R, { width: 1.25 });
    circle(ctx, cx + small.x * R, cy - small.y * R, small.r * R, { width: 2 });
  },
});
jaynesCanvas.el.setAttribute("role", "img");
const jaynesPanel = el("div", { class: "panel b-jaynes" },
  el("h3", { text: "Jaynes's test: ask the same question of a smaller circle" }),
  el("p", { class: "small" }, "The question does not say how big the circle is or where it sits, so E. T. Jaynes argued that a good answer should not depend on either. Take the chords each method throws at the big circle, keep the ones that cross a smaller circle inside it, and ask whether the piece inside is longer than the side of the small circle's own triangle."),
  el("div", { class: "grid2" },
    el("div", { class: "controls" }, jaynesCanvasBox,
      el("p", { class: "small muted", text: "Chords of the selected method. Grey ones miss the small circle; the others are coloured by whether they are long for the small circle." })),
    el("div", { class: "controls" }, rS.el, oS.el, jaynesNote)),
  jaynesTable);

function drawJaynes() {
  const small = inner();
  jaynesCanvas.redraw();
  jaynesCanvas.el.setAttribute("aria-label", `The big circle with a smaller circle of radius ${fmt.num(small.r, 2)} placed ${fmt.num(small.x, 2)} from its centre, and the latest chords drawn by the ${method().label.toLowerCase()} method.`);
  const rows = METHODS.map((m) => {
    const t = innerTest(m.key, small, JAYNES_N, state.seed);
    const se = standardError(m.theory, t.hits);
    const same = t.share != null && Math.abs(t.share - m.theory) <= 3 * se;
    return { m, t, same, method: m.label, big: fmt.pct(m.theory, 1), hits: fmt.int(t.hits), small: t.share == null ? "–" : fmt.pct(t.share, 1), verdict: t.share == null ? "–" : same ? "Same" : "Changed" };
  });
  jaynesTable.replaceChildren(table({
    caption: `Share of long chords: ${fmt.int(JAYNES_N)} chords per method, seed ${state.seed}`,
    columns: [
      { key: "method", label: "Method" }, { key: "big", label: "Big circle (exact)", num: true },
      { key: "hits", label: "Chords crossing the small circle", num: true }, { key: "small", label: "Long for the small circle", num: true }, { key: "verdict", label: "Answer" },
    ],
    rows,
  }));
  const kept = rows.filter((r) => r.same).map((r) => r.m.label.toLowerCase());
  jaynesNote.replaceChildren(note("",
    kept.length === 1 && kept[0] === "random radius"
      ? "Only the random-radius method gives the small circle the answer it gave the big one. That is a theorem, not luck: its chords are spread evenly over distance from any point, so every circle sees the same pattern."
      : kept.includes("random midpoint") && state.innerOffset === 0
        ? "With a shared centre the random-midpoint method passes as well: it survives a change of size. Move the small circle off centre and it fails. The random-radius method passes wherever the circle is."
        : `Within sampling error the answer is unchanged for: ${kept.join(", ") || "none of them"}. The random-radius method is the one that passes for every small circle.`));
}

/* ---------- convergence chart ---------- */
const plot = chart(chartBox, { series: [], height: 320 });
function drawChart() {
  const n = run.data.endpoints.n;
  const pct = (v) => fmt.pct(v, Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 0 : 1);
  plot.update({
    title: "Running share of long chords",
    subtitle: "Each line settles on its own method's answer. More chords shrink the wobble and leave the gaps between the lines where they are.",
    label: "Line chart of the share of chords longer than the triangle's side against the number of chords drawn, one line per method",
    x: { label: "Chords drawn with each method (log scale)", type: "log", domain: [1, Math.max(100, n)], format: fmt.int },
    y: { label: "Share longer than the triangle's side", domain: [0, 1], format: pct },
    series: METHODS.map((m) => {
      const d = run.data[m.key];
      const pts = d.n && d.track.at(-1)[0] !== d.n ? [...d.track, [d.n, d.long / d.n]] : d.track;
      return { name: m.label, type: "line", data: pts, color: METHOD_COLOR[m.key], width: 2 };
    }),
    marks: n ? METHODS.map((m) => ({ type: "hline", y: m.theory, text: m.fraction })) : [],
    empty: "No chords yet",
  });
}

/* ---------- rendering ---------- */
function renderFast() {
  mainCanvas.redraw();
  for (const c of cards) c.cv.redraw();
  jaynesCanvas.redraw();
}

function render() {
  const m = method();
  const d = run.data[m.key];
  recipe.textContent = m.recipe;
  renderFast();

  if (d.n) {
    const share = d.long / d.n;
    const gap = share - m.theory;
    sN.set(fmt.int(d.n), "with each of the three methods");
    sShare.set(fmt.pct(share, 1), `${fmt.int(d.long)} of ${fmt.int(d.n)} chords`);
    sGap.set(`${fmt.signed(gap * 100, 1)} points`, `${fmt.num(Math.abs(gap) / standardError(m.theory, d.n), 1)} standard errors; chance alone gives about 1`);
    const last = d.recent.at(-1);
    latest.textContent = `Latest chord by ${m.label.toLowerCase()}: length ${fmt.num(last.length, 3)}, ${last.long ? "longer" : "shorter"} than the side of the triangle, ${fmt.num(SIDE, 3)}.`;
    message.replaceChildren();
  } else {
    sN.set("0", "press a Draw button");
    sShare.set("–", "");
    sGap.set("–", "");
    latest.textContent = "";
    message.replaceChildren(note("", "No chords yet. Draw one at a time to see how each method works, or thousands to see where it settles."));
  }
  sTheory.set(m.fraction, `${fmt.pct(m.theory, 1)}, whatever the sample`);
  mainCanvas.el.setAttribute("aria-label", d.n
    ? `Left: the latest chords drawn by the ${m.label.toLowerCase()} method inside a circle with its inscribed triangle. Right: their midpoints. ${fmt.pct(d.long / d.n, 1)} of ${fmt.int(d.n)} chords are longer than the triangle's side.`
    : "An empty circle with its inscribed triangle. No chords have been drawn yet.");

  for (const c of cards) {
    const cd = run.data[c.m.key];
    c.box.classList.toggle("on", c.m.key === state.method);
    c.big.textContent = cd.n ? fmt.pct(cd.long / cd.n, 1) : "–";
    c.small.textContent = `exact answer ${c.m.fraction} = ${fmt.pct(c.m.theory, 1)}`;
    c.cv.el.setAttribute("aria-label", `The latest chords drawn by the ${c.m.label.toLowerCase()} method.`);
  }

  const full = d.n >= CAP;
  for (const b of drawButtons) b.disabled = full;
  streamBtn.disabled = full && !stream.running;
  streamBtn.textContent = stream.running ? "Pause" : "Keep drawing";
  capNote.textContent = full ? `That is ${fmt.int(CAP)} chords per method, which is where this page stops. Start again to draw more.` : "";
  capNote.hidden = !full;
  drawChart();
}

function add(count) {
  const room = CAP - run.data.endpoints.n;
  if (room <= 0) return;
  run.add(Math.min(count, room));
  render();
}

// Streaming: slow enough to watch at first, then faster. The numbers and chart refresh a few times a second.
let sinceRender = 0;
const stream = ticker((dt) => {
  const n = run.data.endpoints.n;
  if (n >= CAP) { stream.stop(); render(); return; }
  run.add(Math.min(CAP - n, n < 400 ? 1 : n < 4000 ? 10 : n < 40000 ? 100 : 1000));
  sinceRender += dt;
  if (sinceRender >= 0.2) { sinceRender = 0; render(); } else renderFast();
});

$("#app").append(el("div", { class: "tool-grid" }, controls,
  el("div", { class: "out" },
    el("div", { class: "stats" }, sN.el, sShare.el, sTheory.el, sGap.el),
    message,
    el("div", {}, el("p", { class: "chart-title", text: "Chords and their midpoints for the selected method" }), legend, mainBox, latest),
    el("div", {}, el("p", { class: "chart-title", text: "The same question, three ways of choosing at random" }), cardsBox),
    chartBox, jaynesPanel)));

render();
drawJaynes();
