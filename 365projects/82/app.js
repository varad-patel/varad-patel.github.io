// Day 82: Banking Contagion Network. Interface.
import { $, el, svgEl, fmt, clamp, debounce, nextFrame, mount, slider, segmented, select, numberField, button, stat, note, chart, randomSeed, reducedMotion } from "../kit/kit.js";
import { SHAPES, DEFAULTS, network, bankSystem, clear } from "./logic.js";

mount();

const SHAPE_NAMES = { ring: "Ring", complete: "Complete", clusters: "Two clusters", random: "Random" };
const amt = (x) => fmt.num(x, 1);
const share = (x) => fmt.pct(x, 1);
const state = { ...DEFAULTS, wave: null, focus: 0 };

/* ---------- examples ---------- */
const EXAMPLES = [
  { label: "A ring, a moderate shock", set: { shape: "ring", shock: 40 } },
  { label: "Complete network, same shock", set: { shape: "complete", shock: 40 } },
  { label: "Complete network, a large shock", set: { shape: "complete", shock: 70 } },
  { label: "Two clusters, a large shock", set: { shape: "clusters", shock: 70 } },
  { label: "Depositors rank with banks", set: { shape: "complete", shock: 70, senior: false } },
];

/* ---------- controls ---------- */
const shapeSeg = segmented({ label: "Shape of the network", value: state.shape, options: SHAPES.map((s) => ({ value: s, label: SHAPE_NAMES[s] })), onChange: (v) => { state.shape = v; showShape(); changed(); } });
const nSlider = slider({ label: "Banks", min: 4, max: 30, step: 2, value: state.n, format: (v) => `${v}`, hint: "An even number, so that two clusters can be equal.", onInput: (v) => { state.n = v; changed(); } });
const deltaSlider = slider({ label: "Lending across the two clusters", min: 0, max: 0.5, step: 0.01, value: state.delta, format: (v) => `${fmt.num(v * 100, 0)}% of each bank's`, hint: "The rest is lent inside the bank's own cluster.", onInput: (v) => { state.delta = v; changed(); } });
const kSlider = slider({ label: "Creditors per bank", min: 1, max: DEFAULTS.n - 1, step: 1, value: state.k, format: (v) => `${v}`, hint: "Each bank owes equal amounts to this many banks chosen at random, and is owed by as many.", onInput: (v) => { state.k = v; changed(); } });
const seedField = numberField({ label: "Seed for the random network", min: 0, max: 4294967295, step: 1, value: state.seed });
const seedMsg = el("div", { class: "d82-msg", "aria-live": "polite" });
seedField.input.addEventListener("input", () => changed());
const clusterBox = el("div", { class: "d82-stack" }, deltaSlider.el);
const randomBox = el("div", { class: "d82-stack" }, kSlider.el, seedField.el, el("div", { class: "row" }, button("New random network", () => { seedField.value = randomSeed(); changed(); }, { small: true })), seedMsg);
function showShape() { clusterBox.hidden = state.shape !== "clusters"; randomBox.hidden = state.shape !== "random"; }

const bufferSlider = slider({ label: "Each bank's capital buffer", min: 0.5, max: 50, step: 0.5, value: state.buffer, format: (v) => `${fmt.num(v, 1)} per 100 of outside assets`, hint: "Its own funds: what it can lose before it cannot pay its debts.", onInput: (v) => { state.buffer = v; changed(); } });
const ySlider = slider({ label: "Owed to and by other banks", min: 0, max: 300, step: 5, value: state.y, format: (v) => `${fmt.int(v)} each`, hint: "Every bank owes this much to other banks in all, and is owed as much.", onInput: (v) => { state.y = v; changed(); } });
const hitSelect = select({ label: "Bank hit by the shock", value: "0", options: [{ value: "0", label: "Bank 1" }], onChange: (v) => { state.hit = Number(v); state.focus = state.hit; changed(); } });
const shockSlider = slider({ label: "Shock", min: 0, max: 100, step: 1, value: state.shock, format: (v) => `loses ${v} of 100`, hint: "Of the 100 of outside assets held by the bank hit.", onInput: (v) => { state.shock = v; changed(); } });
const seniorSeg = segmented({ label: "When a bank fails, its outside creditors are paid", value: "first", options: [{ value: "first", label: "First" }, { value: "equal", label: "Alongside other banks" }], hint: "First: Acemoglu, Ozdaglar and Tahbaz-Salehi's senior depositors. Alongside: Eisenberg and Noe's equal ranking.", onChange: (v) => { state.senior = v === "first"; changed(); } });

function applyExample(ex) {
  Object.assign(state, DEFAULTS, ex.set, { wave: null });
  shapeSeg.value = state.shape; nSlider.value = state.n; deltaSlider.value = state.delta; kSlider.value = state.k; seedField.value = state.seed;
  bufferSlider.value = state.buffer; ySlider.value = state.y; shockSlider.value = state.shock; seniorSeg.value = state.senior ? "first" : "equal";
  state.focus = state.hit;
  showShape();
  changed();
}

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row d82-examples", role: "group", "aria-label": "Examples" }, EXAMPLES.map((ex) => button(ex.label, () => applyExample(ex), { small: true }))),
    el("div", { class: "hint", text: "Each example starts from the opening settings: 10 banks, buffer 6, 100 owed to and by other banks." })),
  el("h2", { text: "The network" }), shapeSeg.el, nSlider.el, clusterBox, randomBox,
  el("h2", { text: "The banks" }), bufferSlider.el, ySlider.el, seniorSeg.el,
  el("h2", { text: "The shock" }), hitSelect.el, shockSlider.el);

/* ---------- outputs ---------- */
const sFailed = stat("Banks that fail");
const sWaves = stat("Waves of failure");
const sOutside = stat("Outside creditors lose");
const sOwners = stat("Shareholders lose");
const status = el("p", { class: "sr-only", role: "status" });
const conserve = el("p", { class: "small muted" });
const waveSlider = slider({ label: "Show the network after wave", min: 0, max: 1, step: 1, value: 1, format: (v) => (v === 0 ? "0: the shock alone" : `${v}`), onInput: (v) => { state.wave = v; stopPlay(); drawNet(); } });
const playBtn = button("Play the cascade", () => play(), { small: true });
const waveText = el("p", { class: "small d82-wavetext", "aria-live": "polite" });
const netBox = el("div", { class: "d82-net" });
const legend = el("div", { class: "chart-legend d82-legend" });
const info = el("p", { class: "small d82-info" });
const chartBox = el("div", { id: "d82-shapes" });
const shapeNote = el("p", { class: "small" });
const shapesProgress = el("p", { class: "small muted" });
const tableBox = el("div", { class: "d82-rt-box", id: "d82-table" });
const errBox = el("div");

const out = el("div", { class: "out" },
  errBox,
  el("div", { class: "stats", id: "d82-verdict" }, sFailed.el, sWaves.el, sOutside.el, sOwners.el), status, conserve,
  el("div", { class: "d82-stack", id: "d82-network" },
    el("h2", { text: "The network" }),
    el("p", { class: "small muted", text: "Each arrow runs from a bank to a bank it owes; a plain line joins two banks that owe each other the same. Click a bank, or reach it with Tab and the arrow keys and press Enter, to shock it instead." }),
    waveSlider.el, el("div", { class: "row" }, playBtn), waveText, netBox, legend, info),
  shapesProgress, chartBox, shapeNote);
const jump = el("nav", { class: "row d82-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d82-verdict", "the damage"], ["#d82-network", "the network"], ["#d82-shapes", "shapes compared"], ["#d82-table", "the table"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out),
  el("div", { class: "d82-stack" }, el("h2", { text: "Every bank, after clearing" }), tableBox,
    note("", "Stylised banks with made-up balance sheets: an illustration of how losses travel, not a model of any real banking system.")));

const shapesChart = chart(chartBox, { series: [], height: 280 });

/* ---------- solving ---------- */
let L = null, sys = null, res = null;
const changed = debounce(() => update(), 80);

function update() {
  stopPlay();
  // The random network's seed is the only box typed into; everything else is a slider or a choice.
  const seed = seedField.value;
  const seedOk = Number.isInteger(seed);
  seedMsg.textContent = seedOk ? "" : "Enter a whole-number seed from 0 to 4,294,967,295.";
  if (state.shape === "random" && !seedOk) { errBox.replaceChildren(note("warn", "Fix the seed; the results below are for the last network drawn.")); return; }
  errBox.replaceChildren();
  if (seedOk) state.seed = seed;
  // Keep the controls that depend on the number of banks in range.
  kSlider.input.max = state.n - 1;
  if (state.k > state.n - 1) { state.k = state.n - 1; }
  kSlider.value = state.k;
  if (state.hit >= state.n) state.hit = 0;
  if (state.focus >= state.n) state.focus = state.hit;
  hitSelect.input.replaceChildren(...Array.from({ length: state.n }, (_, i) => el("option", { value: String(i), text: `Bank ${i + 1}` })));
  hitSelect.value = state.hit;

  L = network(state.shape, state.n, state.y, { delta: state.delta, k: state.k, seed: state.seed });
  sys = bankSystem({ L, a: 100, buffer: state.buffer, hit: state.hit, shock: state.shock });
  res = clear(sys, { senior: state.senior });
  const W = res.rounds.length;
  waveSlider.input.max = Math.max(1, W);
  waveSlider.input.disabled = W === 0;
  playBtn.disabled = W === 0;
  state.wave = W;
  waveSlider.value = state.wave;

  const nf = res.failed.filter(Boolean).length;
  const outsideLoss = res.v.reduce((s, v) => s + v, 0) - res.outside.reduce((s, x) => s + x, 0);
  const ownersLoss = state.n * state.buffer - res.equity.reduce((s, x) => s + x, 0);
  sFailed.set(`${nf} of ${state.n}`, !nf ? "the shock is absorbed" : nf === 1 && res.failed[state.hit] ? `only the bank hit, bank ${state.hit + 1}` : `including the bank hit, bank ${state.hit + 1}`);
  sWaves.set(String(W), W ? `${W === 1 ? "round of the clearing algorithm brings" : "rounds of the clearing algorithm each bring"} new failures` : "no bank fails");
  sOutside.set(amt(outsideLoss), `of ${amt(res.v.reduce((s, v) => s + v, 0))} owed to depositors and other outside creditors`);
  sOwners.set(amt(ownersLoss), `of the ${amt(state.n * state.buffer)} of buffers`);
  conserve.textContent = `Together ${amt(outsideLoss)} + ${amt(ownersLoss)} = ${amt(outsideLoss + ownersLoss)}, exactly the shock of ${state.shock}: with no costs of failure the network only decides who bears the loss, and how many banks fail on the way.`;
  status.textContent = `${nf} of ${state.n} banks fail in ${W} ${W === 1 ? "wave" : "waves"}. Outside creditors lose ${amt(outsideLoss)}, shareholders ${amt(ownersLoss)}.`;
  drawNet();
  setTimeout(drawTable, 0);
  drawShapes();
}

/* ---------- the drawing ---------- */
let drawW = 0;
const NS_FILL = { sound: "#ffffff", hurt: "#f6dcb4", part: "#c0392b", zero: "#6b1a14" };
const INK = "#16233b";

function positions(n, W, H) {
  const pad = Math.max(22, Math.min(36, W / 16));
  if (state.shape === "clusters") {
    const m = n / 2, r = Math.min(W / 4 - 1.6 * pad, H / 2 - pad);
    return Array.from({ length: n }, (_, i) => {
      const side = i < m ? 0 : 1, j = i % m;
      const ang = -Math.PI / 2 + (2 * Math.PI * j) / m;
      return [W * (side ? 0.75 : 0.25) + r * Math.cos(ang), H / 2 + r * Math.sin(ang)];
    });
  }
  const r = Math.min(W, H) / 2 - pad;
  return Array.from({ length: n }, (_, i) => { const ang = -Math.PI / 2 + (2 * Math.PI * i) / n; return [W / 2 + r * Math.cos(ang), H / 2 + r * Math.sin(ang)]; });
}

// The state of every bank after `w` waves: the payments of round w (everyone paying in full before the first).
function snapshot(w) {
  const X = w === 0 ? res.y : res.rounds[w - 1].X;
  const n = state.n;
  const h = sys.e.map((ei, i) => { let s = ei; for (let j = 0; j < n; j++) if (L[j][i] && res.y[j] > 0) s += (L[j][i] / res.y[j]) * X[j]; return s; });
  return h.map((hi, i) => {
    const failed = res.wave[i] > 0 && res.wave[i] <= w;
    const kind = failed ? (X[i] <= 1e-9 * Math.max(1, res.y[i]) && res.y[i] > 0 ? "zero" : "part") : hi < 100 + res.y[i] - 1e-9 ? "hurt" : "sound";
    return { kind, X: X[i], h: hi, paidShare: res.y[i] > 0 ? X[i] / res.y[i] : 1 };
  });
}

function describe(i, snap) {
  const s = snap[i];
  const due = res.y[i];
  const parts = [`Bank ${i + 1}${i === state.hit ? ", the bank hit by the shock" : ""}`];
  if (s.kind === "part" || s.kind === "zero") parts.push(`failed in wave ${res.wave[i]}, paying other banks ${share(s.paidShare)} of the ${amt(due)} it owes them`);
  else if (s.kind === "hurt") parts.push(`still paying in full, its buffer cut to ${amt(Math.max(0, s.h - 100 + state.buffer - res.y[i]))} of ${amt(state.buffer)}`);
  else parts.push("untouched so far");
  const creditors = L[i].map((x, j) => (x > 0 ? j + 1 : 0)).filter(Boolean);
  parts.push(creditors.length ? `owes ${creditors.length === 1 ? "bank" : "banks"} ${creditors.join(", ")}` : "owes no other bank");
  return parts.join("; ") + ".";
}

function drawNet() {
  if (!res) return;
  const W = Math.max(280, netBox.clientWidth || 600);
  drawW = W;
  const H = Math.round(clamp(W * 0.72, 260, 440));
  const n = state.n;
  const P = positions(n, W, H);
  const R = clamp((Math.PI * Math.min(W, H) * 0.8) / n / 2.6, 9, 17);
  const w = state.wave ?? res.rounds.length;
  const snap = snapshot(w);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "group", "aria-label": `Network of ${n} banks, ${SHAPE_NAMES[state.shape].toLowerCase()} shape, after wave ${w}` });
  const defs = svgEl("defs", {},
    ...["grey", "red"].map((c) => svgEl("marker", { id: `d82-arrow-${c}`, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" },
      svgEl("path", { d: "M0,0 L10,5 L0,10 z", fill: c === "red" ? "#c0392b" : "#9aa7b4" }))));
  const edges = svgEl("g", { "aria-hidden": "true" });
  const maxL = Math.max(1e-9, ...L.flat());
  const failedNow = (i) => snap[i].kind === "part" || snap[i].kind === "zero";
  // Two banks that owe each other the same are joined by one plain line (dashed red if either pays only part);
  // all such lines of one kind share a single path, which keeps a 30-bank complete network light. A debt that runs
  // one way, or two unequal ones, gets its own arrow, bent a little to its right.
  const pairs = new Map(); // "plain|width" or "short|width" -> path data
  const widthOf = (x) => Math.round((0.8 + 1.6 * (x / maxL)) * 4) / 4; // to the nearest quarter pixel
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (!L[i][j]) continue;
    const [x1, y1] = P[i], [x2, y2] = P[j];
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    if (Math.abs(L[j][i] - L[i][j]) < 1e-9 * maxL) {
      if (i > j) continue; // drawn once, from the lower number
      const key = `${failedNow(i) || failedNow(j) ? "short" : "plain"}|${widthOf(L[i][j])}`;
      pairs.set(key, (pairs.get(key) || "") + `M${x1 + ux * R},${y1 + uy * R}L${x2 - ux * R},${y2 - uy * R}`);
      continue;
    }
    const bend = Math.min(18, d * 0.12);
    const sx = x1 + ux * R, sy = y1 + uy * R, ex = x2 - ux * (R + 2), ey = y2 - uy * (R + 2);
    const cx = (sx + ex) / 2 - uy * bend, cy = (sy + ey) / 2 + ux * bend;
    const short = failedNow(i);
    edges.append(svgEl("path", { d: `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`, fill: "none", stroke: short ? "#c0392b" : "#9aa7b4", "stroke-width": 0.8 + 1.6 * (L[i][j] / maxL), "stroke-dasharray": short ? "5 3" : null, opacity: n > 16 && !short ? 0.55 : 0.9, "marker-end": `url(#d82-arrow-${short ? "red" : "grey"})` }));
  }
  for (const [key, d] of pairs) {
    const [kind, w] = key.split("|");
    const line = svgEl("path", { d, fill: "none", stroke: kind === "short" ? "#c0392b" : "#9aa7b4", "stroke-width": w, "stroke-dasharray": kind === "short" ? "5 3" : null, opacity: kind === "short" ? 0.85 : n > 16 ? 0.5 : 0.85 });
    if (kind === "short") edges.append(line); else edges.prepend(line);
  }
  const nodes = svgEl("g");
  const focusTo = (i) => { state.focus = i; nodes.querySelectorAll(".d82-node").forEach((g, k) => g.setAttribute("tabindex", k === i ? "0" : "-1")); nodes.querySelectorAll(".d82-node")[i]?.focus(); };
  for (let i = 0; i < n; i++) {
    const [x, y] = P[i];
    const k = snap[i].kind;
    const g = svgEl("g", { class: "d82-node", tabindex: i === state.focus ? "0" : "-1", role: "button", "aria-label": `${describe(i, snap)} Press Enter to shock this bank instead.` },
      svgEl("circle", { class: "d82-ring", cx: x, cy: y, r: R + 4, fill: "none" }),
      svgEl("circle", { cx: x, cy: y, r: R, fill: NS_FILL[k], stroke: INK, "stroke-width": i === state.hit ? 2.5 : 1.2, "stroke-dasharray": i === state.hit ? "3 2" : null }),
      svgEl("text", { x, y, dy: "0.35em", "text-anchor": "middle", class: "d82-label", fill: k === "part" || k === "zero" ? "#ffffff" : INK, "font-size": R > 12 ? 12 : 10 }, String(i + 1)));
    g.addEventListener("click", () => shockBank(i));
    g.addEventListener("keydown", (e) => {
      const move = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (move) { e.preventDefault(); focusTo((i + move + n) % n); }
      else if (e.key === "Home") { e.preventDefault(); focusTo(0); }
      else if (e.key === "End") { e.preventDefault(); focusTo(n - 1); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); shockBank(i, true); }
    });
    g.addEventListener("focus", () => { state.focus = i; info.textContent = describe(i, snap); });
    nodes.append(g);
  }
  const hadFocus = netBox.contains(document.activeElement);
  netBox.replaceChildren(svg);
  svg.prepend(defs);
  svg.append(edges, nodes);
  if (hadFocus) nodes.querySelectorAll(".d82-node")[state.focus]?.focus();
  info.textContent = describe(state.focus, snap);
  const fresh = w > 0 ? res.rounds[w - 1].fresh.map((i) => i + 1) : [];
  waveText.textContent = w === 0
    ? `The shock: bank ${state.hit + 1} loses ${state.shock} of its outside assets. Everyone still expects to be paid in full.`
    : `Wave ${w}: ${fresh.length === 1 ? "bank" : "banks"} ${fresh.join(", ")} cannot pay in full${w === 1 ? " even if every other bank does" : ", once the failures before are counted"}.${w === res.rounds.length ? " No further bank fails: the payments have cleared." : ""}`;
  legend.replaceChildren(...[["sound", "Untouched"], ["hurt", "Buffer cut, still paying"], ["part", "Failed, paying part"], ["zero", "Failed, paying banks nothing"]].map(([k, t]) => el("span", {}, el("i", { style: { background: NS_FILL[k], border: `1px solid ${INK}` } }), t)),
    el("span", {}, el("i", { class: "d82-dash" }), "Dashed red: a debt paid only in part"),
    el("span", {}, el("i", { class: "d82-line" }), "A plain line: two banks that owe each other the same"),
    el("span", {}, el("i", { style: { background: "#fff", border: `2px dashed ${INK}`, borderRadius: "50%" } }), "The bank hit"));
}

function shockBank(i, fromKey = false) {
  state.hit = i;
  state.focus = i;
  stopPlay();
  state.wave = null;
  update();
  if (fromKey) netBox.querySelectorAll(".d82-node")[i]?.focus();
}

/* ---------- the cascade, one wave at a time ---------- */
let playing = false, timer = 0;
function play() {
  if (!res || !res.rounds.length) return;
  stopPlay();
  playing = true;
  state.wave = 0;
  waveSlider.value = 0;
  drawNet();
  const stepMs = reducedMotion() ? 1500 : 900;
  const tick = () => {
    if (!playing) return;
    if (state.wave >= res.rounds.length) { stopPlay(); return; }
    state.wave++;
    waveSlider.value = state.wave;
    drawNet();
    timer = setTimeout(tick, stepMs);
  };
  timer = setTimeout(tick, stepMs);
}
function stopPlay() { playing = false; clearTimeout(timer); }

/* ---------- the table ---------- */
function drawTable() {
  const n = state.n;
  const rows = Array.from({ length: n }, (_, i) => {
    const inflow = sys.e[i] === undefined ? 0 : res.h[i] - sys.e[i];
    const owedIn = L.reduce((s, row) => s + row[i], 0);
    const creditors = L[i].map((x, j) => [j + 1, x]).filter(([, x]) => x > 0);
    const same = creditors.every(([, x]) => Math.abs(x - creditors[0][1]) < 1e-9);
    const owes = !creditors.length ? "nobody"
      : creditors.length === 1 ? `bank ${creditors[0][0]}: ${amt(creditors[0][1])}`
      : same ? `banks ${creditors.map(([j]) => j).join(", ")}: ${amt(creditors[0][1])} each` : creditors.map(([j, x]) => `bank ${j}: ${amt(x)}`).join("; ");
    const st = res.failed[i] ? `Failed in wave ${res.wave[i]}` : res.equity[i] < state.buffer - 1e-9 ? "Buffer cut" : "Untouched";
    return [
      String(i + 1), owes, amt(sys.e[i]), `${amt(inflow)} of ${amt(owedIn)}`,
      res.y[i] > 0 ? `${amt(res.X[i])} (${share(res.X[i] / res.y[i])})` : "nothing owed",
      `${amt(res.outside[i])} (${share(res.outside[i] / res.v[i])})`, `${amt(res.equity[i])} of ${amt(state.buffer)}`, st,
    ];
  });
  const cols = ["Bank", "Owes", "Outside assets", "Received from banks", "Paid to banks", "Paid to outside creditors", "Buffer left", "State"];
  tableBox.replaceChildren(el("table", { class: "tbl d82-rt" },
    el("caption", { text: `After clearing: shock of ${state.shock} to bank ${state.hit + 1}, ${SHAPE_NAMES[state.shape].toLowerCase()} network, outside creditors paid ${state.senior ? "first" : "alongside other banks"}.` }),
    el("thead", {}, el("tr", {}, cols.map((c, k) => el("th", { scope: "col", class: k >= 2 && k <= 6 ? "num" : null, text: c })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, r.map((v, k) => (k === 0 ? el("th", { scope: "row", text: `Bank ${v}` }) : el("td", { class: k >= 2 && k <= 6 ? "num" : null, "data-label": cols[k], text: v }))))))));
}

/* ---------- shapes compared ---------- */
// The comparison clears 51 shocks in each of four networks, up to a second of work for 30 banks with large debts,
// so it runs 20 milliseconds at a time and a new setting cancels it.
let shapesJob = 0;
function drawShapes() {
  const id = ++shapesJob;
  const shocks = Array.from({ length: 51 }, (_, i) => i * 2);
  const shapes = SHAPES.filter((s) => s !== "clusters" || state.n % 2 === 0);
  const params = { n: state.n, a: 100, buffer: state.buffer, y: state.y, delta: state.delta, k: state.k, seed: state.seed, hit: state.hit, senior: state.senior };
  const rows = shapes.map((shape) => ({ shape, counts: [] }));
  const nets = shapes.map((shape) => network(shape, state.n, state.y, { delta: state.delta, k: state.k, seed: state.seed }));
  let done = 0;
  const totalTasks = shapes.length * shocks.length;
  const slice = () => {
    if (id !== shapesJob) return;
    const t0 = performance.now();
    while (done < totalTasks && performance.now() - t0 < 20) {
      const s = Math.floor(done / shocks.length), j = done % shocks.length;
      rows[s].counts[j] = clear(bankSystem({ L: nets[s], a: 100, buffer: params.buffer, hit: params.hit, shock: shocks[j] }), { senior: params.senior }).failed.filter(Boolean).length;
      done++;
    }
    if (done < totalTasks) { shapesProgress.textContent = `Comparing shapes: ${fmt.int((100 * done) / totalTasks)}% done.`; setTimeout(slice, 0); return; }
    shapesProgress.textContent = "";
    finishShapes(rows, shocks);
  };
  setTimeout(slice, 0); // after the network is drawn, so a change never waits for the comparison
}

function finishShapes(rows, shocks) {
  const total = state.n * state.buffer;
  shapesChart.update({
    title: "How many banks fail, by the shape of the network",
    subtitle: `The same banks and the same shock to bank ${state.hit + 1}, wired four ways. Two clusters lend ${fmt.num(state.delta * 100, 0)}% across; the random network has ${state.k} ${state.k === 1 ? "creditor" : "creditors"} a bank.`,
    label: "Step chart of the number of failed banks against the size of the shock for four network shapes",
    x: { label: "Shock (of the bank's 100 of outside assets)", format: (v) => fmt.int(v), domain: [0, 100] },
    y: { label: "Banks that fail", format: (v) => fmt.int(v), domain: [0, state.n] },
    series: rows.map((r, i) => ({ name: SHAPE_NAMES[r.shape], type: "step", data: r.counts.map((c, j) => [shocks[j], c]), color: i })),
    marks: [
      { type: "vline", x: state.shock, text: "This shock" },
      ...(total <= 100 ? [{ type: "vline", x: total, text: "All buffers together" }] : []),
    ],
  });
  shapeNote.textContent = `What depends on the shape: how many banks fail, which ones, in how many waves, and whether depositors or shareholders bear the loss. What does not: that the payments clear (a clearing vector always exists), and the total lost, which is always the shock. ${state.senior ? `With outside creditors paid first, Acemoglu, Ozdaglar and Tahbaz-Salehi prove that for shocks below the system's combined buffer (here ${amt(total)}) spreading each bank's lending across all the others (the complete network) is the most stable shape and the ring the least, and that above it the complete network and the ring are the least stable and two clusters with weak enough links between them do better, provided interbank debts are large enough.` : "With outside creditors ranking alongside banks, every failed bank's loss is shared with its depositors, so less of it reaches other banks."}`;
}

if (typeof ResizeObserver !== "undefined") new ResizeObserver(nextFrame(() => { if (netBox.clientWidth !== drawW) drawNet(); })).observe(netBox);
showShape();
update();
