// Day 25: Game of Life Emergence Meter. Interface.
import { $, el, fmt, mount, slider, numberField, select, checkbox, button, stat, note, chart, canvas, ticker, reducedMotion, randomSeed, rng, palette } from "../kit/kit.js";
import { PATTERNS, stepLife, stepNoise, same, patternGrid, randomGrid, shuffled, measure } from "./logic.js";

mount();

const SIZES = [[48, 32], [96, 64], [144, 96], [192, 128]];
const SPEEDS = [1, 2, 5, 10, 20, 30, 60, 120, 240, 480];
const INK = "#16233b", GREY = "#8a94a3", BORN = "#2a78d6", DIED = "rgba(235, 104, 52, 0.38)", LINE = "#e6ece8";
const WINDOW = 4000; // generations kept for the charts
// A narrow or a short screen (a phone, upright or on its side) starts on the smallest grid, so cells are big enough to touch.
const small = matchMedia("(max-width: 700px), (max-height: 520px)").matches;

const [startW, startH] = small ? SIZES[0] : SIZES[1];
const sim = {
  w: startW, h: startH, cur: new Uint8Array(startW * startH), prev: new Uint8Array(startW * startH), older: new Uint8Array(startW * startH),
  start: new Uint8Array(startW * startH), // the grid as it was at generation 0, for Restart
  back: 0,            // how many earlier generations are valid: 0, 1 or 2
  gen: 0, now: null,  // the latest meters
  noise: rng(1), noiseDensity: 0.5,
  settleSeen: false,  // true once the repeat has been announced for this grid
  shuffles: 0,
};
const hist = { gen: [], density: [], h1: [], h2: [], structure: [], activity: [], complexity: [] };
let paint = null;     // the value being drawn while the pointer is down
let lastCell = null;
let cursor = null;    // keyboard cursor { x, y } while the grid has keyboard focus
let chartsAt = 0;
let acc = 0;

/* ---------- controls ---------- */
const status = el("div", { role: "status" });
const say = (kind, text) => status.replaceChildren(...(text ? [note(kind, text)] : []));

const runBtn = button("Run", () => (loop.running ? pause() : play()), { primary: true });
const stepBtn = button("Step", () => { pause(); stepOnce(); refresh(true); });
const restartBtn = button("Restart", () => setGrid(Uint8Array.from(sim.start)), { title: "Go back to generation 0: the pattern as it was before it ran, with anything drawn on it" });
const speed = slider({
  label: "Speed", min: 0, max: SPEEDS.length - 1, step: 1, value: 4, format: (i) => `${SPEEDS[i]} per second`,
  hint: "The largest grids may not keep up with the fastest settings.", onInput: () => { acc = 0; },
});

const patternSelect = select({
  label: "Pattern", value: "soup",
  options: [{ value: "soup", label: "Random soup" }, ...PATTERNS.map((p) => ({ value: p.key, label: p.label }))],
  onChange: () => loadPattern(),
});
const patternHint = el("div", { class: "hint" });
patternSelect.el.append(patternHint);
const density = slider({ label: "Soup density", min: 5, max: 95, step: 5, value: 50, format: (v) => `${v}% alive`, onInput: () => { patternSelect.value = "soup"; loadPattern(); } });
const SEED_MAX = 4294967295;
let soupSeed = 25;    // the last valid seed typed or drawn
const seed = numberField({ label: "Soup seed", min: 0, max: SEED_MAX, step: 1, value: soupSeed, hint: "The same seed and density always give the same soup." });
const seedNote = el("div", { class: "gl-note" });
seed.input.addEventListener("input", () => {
  if (!Number.isInteger(seed.value)) { seedNote.replaceChildren(note("bad", `The seed must be a whole number from 0 to ${fmt.int(SEED_MAX)}. Until it is, the last valid seed, ${fmt.int(soupSeed)}, stays in use.`)); return; }
  seedNote.replaceChildren();
  soupSeed = seed.value;
  patternSelect.value = "soup";
  loadPattern();
});
const newSeedBtn = button("New seed", () => { soupSeed = randomSeed(); seed.value = soupSeed; seedNote.replaceChildren(); patternSelect.value = "soup"; loadPattern(); }, { small: true });

const rule = select({
  label: "Rule", value: "life",
  options: [{ value: "life", label: "Conway's Life" }, { value: "noise", label: "Noise: redraw every cell at random" }],
  hint: "Noise keeps the density and throws the pattern away each generation. Use it to see what the meters read when there is nothing to find: below 0.002 on 96 by 64 cells, and more on a smaller grid.",
  onChange: () => { sim.noiseDensity = sim.now.density || density.value / 100; sim.settleSeen = false; say("", ""); },
});
const size = select({
  label: "Grid", value: `${startW}x${startH}`,
  options: SIZES.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w} by ${h} cells` })),
  hint: `The edges wrap: what leaves on the right comes back on the left.${small ? " A small screen starts on 48 by 32 so that the cells are big enough to touch. The finding below was measured on 96 by 64: choose it here to reproduce it." : ""}`,
  onChange: () => loadPattern(),
});
const tint = checkbox({ label: "Colour births and deaths", checked: true, onChange: () => cv.redraw() });

const controls = el("div", { class: "controls" },
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("span", { text: "Draw" })),
    el("div", { class: "hint", text: "Click or drag on the grid to switch cells on and off. On a touch screen a finger on the grid draws, so scroll the page from outside the grid. With a keyboard, focus the grid, move with the arrow keys and press Space." }),
    el("div", { class: "row" },
      button("Clear", () => { pause(); setGrid(new Uint8Array(sim.w * sim.h), "An empty grid. Draw on it, then press Run."); }, { small: true }),
      button("Shuffle cells", shuffle, { small: true, title: "Move every live cell to a random position: same density, no arrangement" }))),
  patternSelect.el, density.el, seed.el, seedNote, el("div", { class: "row" }, newSeedBtn),
  rule.el, size.el, tint.el);

/* ---------- outputs ---------- */
const sGen = stat("Generation");
const sLive = stat("Live cells");
const sH1 = stat("Entropy from density", "–", "bits per cell if cells were independent");
const sH2 = stat("Entropy in 2 by 2 blocks", "–", "bits per cell, as measured");
const sS = stat("Structure", "–", "the gap between the two");
const sC = stat("Complexity", "–", "this page's own measure, bits per cell");
const canvasBox = el("div", { class: "gl-canvas" });
const legend = el("ul", { class: "gl-key small muted" },
  el("li", {}, el("i", { style: { background: INK } }), "alive"),
  el("li", {}, el("i", { style: { background: BORN } }), "born this generation"),
  el("li", {}, el("i", { style: { background: DIED } }), "died this generation"));
// Where the keyboard cursor is, in words: the grid itself is a picture.
const where = el("p", { class: "gl-where small muted", "aria-live": "polite" });
// The grid as text, for anyone who cannot see the picture or wants to copy a pattern.
const gridText = el("pre", { class: "gl-text", role: "region", "aria-label": "The grid as text", tabindex: "0" });
const gridDetails = el("details", { class: "chart-table", ontoggle: () => writeGridText() },
  el("summary", { text: "Show the grid as text" }),
  el("p", { text: "One character for each cell: O is alive and a dot is dead. While the grid runs the text is brought up to date a few times a second." }),
  gridText);
const about = el("p", { class: "small muted" },
  "Structure is the gap between the two entropies. ",
  el("strong", { text: "Complexity is this page's own construction, not a published measure: " }),
  "the same gap, worked out on the map of cells that differ from two generations ago. It reads zero for anything still or repeating every two generations and close to zero for noise, and it cannot tell a glider from any other small patch of organised change, or something that repeats every three generations from something new. The definitions are under \"How it works\".");
const entropyBox = el("div");
const structureBox = el("div");
const densityBox = el("div");

// The grid and its meters come first in the page, so that on a phone they sit above the settings.
$("#app").append(el("div", { class: "gl-grid" },
  el("div", { class: "out gl-stage" },
    el("div", { class: "row gl-transport" }, runBtn, stepBtn, restartBtn, speed.el),
    el("div", {}, canvasBox, legend, where),
    status, // below the grid, so that a message appearing or clearing never moves the cells under the pointer
    el("div", { class: "stats", id: "gl-stats" }, sGen.el, sLive.el, sH1.el, sH2.el, sS.el, sC.el),
    about, gridDetails),
  controls,
  el("div", { class: "out gl-charts" }, entropyBox, el("div", { class: "grid2" }, structureBox, densityBox))));

const bits = (v) => fmt.num(v, 3);
const xAxis = { label: "Generation", format: fmt.int };
const entropyChart = chart(entropyBox, {
  title: "Entropy per cell", subtitle: "The grey line is what the density alone allows. The blue line is what the 2 by 2 blocks show. The shaded gap is structure.",
  height: 230, x: xAxis, y: { label: "Bits per cell", domain: [0, 1], format: (v) => fmt.num(v, 2) }, series: [],
});
const structureChart = chart(structureBox, {
  title: "Structure and complexity", height: 220, x: xAxis, y: { label: "Bits per cell", zero: true, format: bits }, series: [],
});
const densityChart = chart(densityBox, {
  title: "Density and activity", subtitle: "Density is the share of cells alive. Activity is the share that changed in the last generation, whatever the pattern.", height: 220, x: xAxis, y: { label: "Share of cells", zero: true, format: (v) => fmt.pct(v, 0) }, series: [],
});

/* ---------- the grid ---------- */
// A touch that starts on the grid draws and cannot scroll the page, so the grid never takes more than six
// tenths of the screen's height: there is always room above or below it for a finger. 100svh is the viewport
// at its smallest, which stays the same while a phone's address bar slides in and out.
const probe = el("div", { "aria-hidden": "true", style: { position: "fixed", top: "0", left: "0", width: "0", height: "100svh", visibility: "hidden", pointerEvents: "none" } });
document.body.append(probe);
const geometry = (width) => {
  const room = 0.6 * (probe.offsetHeight || window.innerHeight);
  const cell = Math.max(1, Math.min(Math.floor((width - 1) / sim.w), Math.floor((room - 1) / sim.h)));
  return { cell, ox: Math.floor((width - cell * sim.w) / 2) };
};
const cv = canvas(canvasBox, {
  height: (width) => geometry(width).cell * sim.h + 1,
  draw(ctx, width, height) {
    const { w, h, cur, prev } = sim;
    const { cell, ox } = geometry(width);
    const gap = cell >= 4 ? 1 : 0;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    if (cell >= 6) {
      ctx.beginPath();
      for (let x = 0; x <= w; x++) { ctx.moveTo(ox + x * cell + 0.5, 0); ctx.lineTo(ox + x * cell + 0.5, h * cell + 1); }
      for (let y = 0; y <= h; y++) { ctx.moveTo(ox, y * cell + 0.5); ctx.lineTo(ox + w * cell + 1, y * cell + 0.5); }
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    const showChange = tint.checked && sim.back >= 1;
    // Three passes, one colour each: cells that died, cells that stayed alive, cells that were born.
    for (const pass of showChange ? [0, 1, 2] : [1]) {
      ctx.beginPath();
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i++) {
          const kind = !showChange ? (cur[i] ? 1 : -1) : cur[i] ? (prev[i] ? 1 : 2) : prev[i] ? 0 : -1;
          if (kind === pass) ctx.rect(ox + x * cell + gap, y * cell + gap, cell - gap, cell - gap);
        }
      }
      ctx.fillStyle = [DIED, INK, BORN][pass];
      ctx.fill();
    }
    if (cursor) {
      ctx.strokeStyle = "#1f4fa3";
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + cursor.x * cell + 0.5, cursor.y * cell + 0.5, cell, cell);
    }
  },
});
cv.el.tabIndex = 0;
cv.el.setAttribute("role", "application");
cv.el.setAttribute("aria-describedby", "gl-stats");
cv.el.style.touchAction = "none";
cv.el.style.cursor = "crosshair";
window.addEventListener("resize", () => cv.redraw()); // the kit redraws when the width changes; the height limit needs this too

/** Say where the keyboard cursor is. The state of the cell is left out while the grid is running, because it would be out of date at once. */
function tellWhere() {
  where.textContent = !cursor ? "" : `Cursor: column ${cursor.x + 1} of ${sim.w}, row ${cursor.y + 1} of ${sim.h}${loop.running ? "" : sim.cur[cursor.y * sim.w + cursor.x] ? ", alive" : ", dead"}.`;
}
function writeGridText() {
  if (!gridDetails.open) return;
  const lines = [];
  for (let y = 0; y < sim.h; y++) { let line = ""; for (let x = 0; x < sim.w; x++) line += sim.cur[y * sim.w + x] ? "O" : "."; lines.push(line); }
  gridText.textContent = lines.join("\n");
}

const cellAt = (e) => {
  const box = cv.el.getBoundingClientRect();
  const { cell, ox } = geometry(cv.width);
  const x = Math.floor((e.clientX - box.left - cv.el.clientLeft - ox) / cell);
  const y = Math.floor((e.clientY - box.top - cv.el.clientTop) / cell);
  return { x: Math.min(sim.w - 1, Math.max(0, x)), y: Math.min(sim.h - 1, Math.max(0, y)), inside: x >= 0 && y >= 0 && x < sim.w && y < sim.h };
};
function setCell(x, y, value) {
  const i = y * sim.w + x;
  if (sim.cur[i] === value) return false;
  sim.cur[i] = value;
  return true;
}
/** After the visitor changes cells by hand: earlier generations no longer explain this one. */
function edited(charts = false) {
  if (sim.gen === 0) sim.start = Uint8Array.from(sim.cur); // drawn before running: Restart brings it back
  sim.back = 0;
  sim.settleSeen = false;
  record(true);
  say("", "");
  refresh(charts);
}
cv.el.addEventListener("pointerdown", (e) => {
  const c = cellAt(e);
  if (!c.inside || e.button > 0) return;
  e.preventDefault();
  cv.el.setPointerCapture?.(e.pointerId);
  cursor = null;
  paint = sim.cur[c.y * sim.w + c.x] ? 0 : 1;
  lastCell = c;
  setCell(c.x, c.y, paint);
  edited();
});
cv.el.addEventListener("pointermove", (e) => {
  if (paint === null) return;
  const c = cellAt(e);
  // Walk the straight line from the last cell so that a fast drag leaves no holes.
  let { x, y } = lastCell;
  const dx = Math.abs(c.x - x), dy = -Math.abs(c.y - y), sx = x < c.x ? 1 : -1, sy = y < c.y ? 1 : -1;
  let err = dx + dy, changed = false;
  for (;;) {
    changed = setCell(x, y, paint) || changed;
    if (x === c.x && y === c.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  lastCell = c;
  if (changed) edited();
});
for (const type of ["pointerup", "pointercancel"]) cv.el.addEventListener(type, () => { if (paint !== null) { paint = null; refresh(true); } });
cv.el.addEventListener("keydown", (e) => {
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!move && e.key !== " " && e.key !== "Enter") return;
  e.preventDefault();
  cursor ||= { x: Math.floor(sim.w / 2), y: Math.floor(sim.h / 2) };
  if (move) { cursor.x = (cursor.x + move[0] + sim.w) % sim.w; cursor.y = (cursor.y + move[1] + sim.h) % sim.h; cv.redraw(); tellWhere(); return; }
  setCell(cursor.x, cursor.y, sim.cur[cursor.y * sim.w + cursor.x] ? 0 : 1);
  edited(true);
  tellWhere();
});
cv.el.addEventListener("blur", () => { if (cursor) { cursor = null; cv.redraw(); tellWhere(); } });

/* ---------- simulation ---------- */
function record(replace) {
  const m = measure(sim.cur, sim.w, sim.h, sim.back >= 1 ? sim.prev : null, sim.back >= 2 ? sim.older : null);
  sim.now = m;
  if (replace && hist.gen.length) for (const k of Object.keys(hist)) hist[k].pop();
  hist.gen.push(sim.gen);
  for (const k of ["density", "h1", "h2", "structure", "activity", "complexity"]) hist[k].push(m[k]);
  if (hist.gen.length > WINDOW + 500) for (const k of Object.keys(hist)) hist[k].splice(0, 500);
}

function setGrid(cells, message = "") {
  sim.cur = cells;
  sim.start = Uint8Array.from(cells);
  sim.prev = new Uint8Array(cells.length);
  sim.older = new Uint8Array(cells.length);
  sim.back = 0;
  sim.gen = 0;
  sim.settleSeen = false;
  for (const k of Object.keys(hist)) hist[k].length = 0;
  record(false);
  sim.noiseDensity = sim.now.density || density.value / 100;
  cursor = null;
  tellWhere();
  acc = 0;
  say("", message);
  refresh(true);
}

function loadPattern() {
  const [w, h] = size.value.split("x").map(Number);
  sim.w = w;
  sim.h = h;
  cv.el.setAttribute("aria-label", `Life grid, ${w} by ${h} cells. Arrow keys move the cursor, Space or Enter switches a cell on or off.`);
  const key = patternSelect.value;
  patternHint.textContent = key === "soup" ? "Every cell is alive or dead at random: noise, with nothing to find in it until the rule gets to work." : PATTERNS.find((p) => p.key === key).note;
  setGrid(key === "soup" ? randomGrid(w, h, density.value / 100, soupSeed) : patternGrid(key, w, h));
}

function shuffle() {
  sim.cur = shuffled(sim.cur, 1000 + sim.shuffles++);
  if (sim.gen === 0) sim.start = Uint8Array.from(sim.cur);
  sim.back = 0;
  sim.settleSeen = false;
  record(true);
  say("", "Shuffled: the same number of live cells, dealt out to random positions. Structure has gone and entropy from density has not moved.");
  refresh(true);
}

function stepOnce() {
  const next = sim.older;
  if (rule.value === "noise") stepNoise(next, sim.noiseDensity, sim.noise);
  else stepLife(sim.cur, next, sim.w, sim.h);
  sim.older = sim.prev;
  sim.prev = sim.cur;
  sim.cur = next;
  sim.back = Math.min(2, sim.back + 1);
  sim.gen++;
  record(false);
  if (rule.value === "life" && sim.back === 2 && !sim.settleSeen && same(sim.cur, sim.older)) {
    sim.settleSeen = true;
    const wasRunning = loop.running;
    pause();
    say("", sim.now.live === 0
      ? `Generation ${fmt.int(sim.gen)}: no cell is alive. An empty grid reads zero on every meter.`
      : same(sim.cur, sim.prev)
        ? `Generation ${fmt.int(sim.gen)}: nothing changes any more. What is left is still lifes: structure without activity, so complexity reads zero.${wasRunning ? " Paused." : ""}`
        : `Generation ${fmt.int(sim.gen)}: the grid now repeats every two generations. Only still lifes and blinkers are left, so complexity has fallen to zero while structure and activity have not.${wasRunning ? " Paused." : ""}`);
  }
}

/* ---------- drawing the outputs ---------- */
function drawCharts() {
  chartsAt = performance.now();
  const n = hist.gen.length;
  const stride = Math.max(1, Math.ceil(n / 300));
  const pick = [];
  for (let i = 0; i < n; i += stride) pick.push(i);
  if (pick.at(-1) !== n - 1) pick.push(n - 1);
  const line = (k) => pick.map((i) => [hist.gen[i], hist[k][i]]);
  const domain = [hist.gen[0], Math.max(hist.gen[0] + 20, hist.gen[n - 1])];
  const top = (floor, ...keys) => Math.max(floor, ...keys.flatMap((k) => hist[k].map((v) => v ?? 0))) * 1.08;
  // A dot on the latest reading of each line, so the chart shows something from generation 0.
  const latest = (pairs) => pairs.filter(([k]) => hist[k][n - 1] != null).map(([k, color]) => ({ type: "point", x: hist.gen[n - 1], y: hist[k][n - 1], color, r: 4 }));
  entropyChart.update({
    x: { ...xAxis, domain },
    series: [
      { name: "Gap: structure", type: "range", data: pick.map((i) => [hist.gen[i], hist.h2[i], hist.h1[i]]), color: 0, opacity: 0.2, hover: false },
      { name: "If cells were independent", data: line("h1"), color: GREY },
      { name: "Measured in 2 by 2 blocks", data: line("h2"), color: 0 },
    ],
    marks: latest([["h1", GREY], ["h2", palette[0]]]),
  });
  // The highest reading of each line and where it fell, so that a peak can be read off without hunting for it.
  const peak = (k) => hist[k].reduce((best, v, i) => (v != null && v > best.v ? { v, g: hist.gen[i] } : best), { v: -1, g: 0 });
  const pS = peak("structure"), pC = peak("complexity");
  structureChart.update({
    subtitle: `Complexity is this page's own measure, not a standard one. Highest on this chart: structure ${bits(pS.v)} at generation ${fmt.int(pS.g)}${pC.v >= 0 ? `, complexity ${bits(pC.v)} at generation ${fmt.int(pC.g)}` : ""}.`,
    x: { ...xAxis, domain }, y: { label: "Bits per cell", domain: [0, top(0.02, "structure", "complexity")], format: bits },
    series: [{ name: "Structure", data: line("structure"), color: 0 }, { name: "Complexity", data: line("complexity"), color: 1 }],
    marks: latest([["structure", palette[0]], ["complexity", palette[1]]]),
  });
  densityChart.update({
    x: { ...xAxis, domain }, y: { label: "Share of cells", domain: [0, Math.min(1, top(0.1, "density", "activity"))], format: (v) => fmt.pct(v, 0) },
    series: [{ name: "Density", data: line("density"), color: 2 }, { name: "Activity", data: line("activity"), color: 3 }],
    marks: latest([["density", palette[2]], ["activity", palette[3]]]),
  });
  writeGridText();
}

function refresh(charts) {
  const m = sim.now;
  sGen.set(fmt.int(sim.gen), rule.value === "noise" ? "of noise" : "");
  sLive.set(fmt.int(m.live), `${fmt.pct(m.density, 1)} of ${fmt.int(m.n)}`);
  sH1.set(bits(m.h1));
  sH2.set(bits(m.h2));
  sS.set(bits(m.structure), m.h1 > 0 ? `the gap: ${fmt.pct(m.structure / m.h1, 0)} of the entropy` : "the gap between the two");
  sC.set(m.complexity == null ? "–" : bits(m.complexity), m.complexity == null ? "this page's own measure; it needs two earlier generations" : `this page's own measure of organised novelty; ${fmt.pct(m.activity, 1)} of cells just changed`);
  runBtn.textContent = loop.running ? "Pause" : "Run";
  cv.redraw();
  if (charts || performance.now() - chartsAt > 180) drawCharts();
}

const loop = ticker((dt) => {
  acc += dt * SPEEDS[speed.value];
  const started = performance.now();
  let did = 0;
  while (acc >= 1 && loop.running) {
    stepOnce();
    acc -= 1;
    did++;
    if (performance.now() - started > 12) { acc = 0; break; } // never hold a frame for long
  }
  if (did) refresh(!loop.running);
});
function play() {
  if (sim.now.live === 0 && rule.value === "life") { say("warn", "The grid is empty, so there is nothing to run. Draw some cells or choose a pattern."); return; }
  if (!sim.settleSeen) say("", "");
  acc = 0;
  loop.start();
  refresh(false);
}
function pause() {
  loop.stop();
  runBtn.textContent = "Run";
}

loadPattern();
if (reducedMotion()) say("", "Your device asks for reduced motion, so nothing moves until you press Run or Step.");
else play();
