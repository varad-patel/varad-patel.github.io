// Day 29: Decision Tree Debater. Interface.
import { $, el, svgEl, fmt, mount, numberField, textField, select, button, stat, note, table, chart, store, reducedMotion } from "../kit/kit.js";
import { LIMITS, PRESETS, blankTree, sanitise, plain, walk, find, size, addChild, removeNode, setType, normalise, validate, rollback, planSteps, sensitivity, spread, curve } from "./logic.js";

mount();

const saved = store("day29");
function firstTree() {
  const raw = saved.get("tree");
  if (raw) { try { return { tree: sanitise(raw), preset: "own" }; } catch { /* a stale or damaged save: start from the example */ } }
  return { tree: PRESETS[0].tree(), preset: PRESETS[0].key };
}
const state = { ...firstTree(), param: "" };

const val = (x) => fmt.sig(x, 4);
const prob = (x) => fmt.sig(x, 3);
const nameOf = (node) => node.name.trim() || (node.type === "end" ? "Unnamed end point" : "Unnamed branch");
// replaceChildren that, like el(), accepts arrays and skips empty values.
const fill = (node, ...kids) => node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

/* ---------------------------------------------------------- examples, save and load */
const presetButtons = [...PRESETS.map((p) => [p.key, p.label]), ["blank", "Blank"]].map(([key, label]) => {
  const b = button(label, () => load(key), { small: true });
  b.dataset.preset = key;
  return b;
});
const blurb = el("p", { class: "small muted" });
const fileNote = el("div");
const exportLink = el("a", { class: "btn small", download: "decision-tree.json", href: "#", text: "Export as a file" });
const fileInput = el("input", { type: "file", accept: ".json,application/json", class: "sr-only", id: "tree-file" });
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  try {
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error("The file is not valid JSON."); }
    state.tree = sanitise(data);
    state.preset = "own";
    state.param = "";
    structural();
    save();
    fill(fileNote, note("good", `Loaded ${file.name}: ${size(state.tree).nodes} nodes.`));
  } catch (e) {
    fill(fileNote, note("bad", `Could not load ${file.name}. ${e.message} Export a tree from this page to see the format.`));
  }
});

function load(key) {
  const preset = PRESETS.find((p) => p.key === key);
  state.tree = preset ? preset.tree() : blankTree();
  state.preset = key;
  state.param = "";
  saved.remove("tree");
  fill(fileNote);
  structural();
}
function save() {
  if (!saved.set("tree", plain(state.tree))) fill(fileNote, note("warn", "This browser would not save the tree, so it will be lost when the page closes. Export it as a file to keep it."));
}
// Any edit: the tree is now the visitor's own, so keep it.
function changed() { save(); refresh(); }

/* ---------------------------------------------------------------------------- editor */
const editor = el("div", { class: "ed" });

function numField(label, value, opts, set) {
  const f = numberField({ label, value: Number.isFinite(value) ? Number(value.toPrecision(6)) : "", ...opts });
  if (opts.negative) f.input.removeAttribute("inputmode"); // the decimal keypad on phones has no minus key
  f.input.addEventListener("input", () => { set(f.value); changed(); });
  return f;
}

function nodeRow(node, parent, depth) {
  const t = state.tree;
  const count = size(t).nodes;
  const what = !parent ? "The decision" : parent.type === "decision" ? "Option" : "Outcome";
  const name = textField({ label: what, value: node.name, onInput: (v) => { node.name = v.slice(0, LIMITS.name); changed(); } });
  name.input.dataset.focus = node.id;
  name.input.maxLength = LIMITS.name;
  name.el.querySelector(".lab").prepend(el("i", { class: `sym ${node.type}` }));
  const head = [name.el];
  if (parent) {
    const kind = select({
      label: "Leads to", value: node.type,
      options: [{ value: "decision", label: "Decision" }, { value: "chance", label: "Chance" }, { value: "end", label: "End point" }],
      onChange: (v) => { setType(t, node.id, v); structural(); save(); },
    });
    // An end point at the deepest level, or in a full tree, cannot grow branches.
    if (node.type === "end" && (depth + 1 > LIMITS.depth || count + 2 > LIMITS.nodes)) for (const o of kind.input.options) o.disabled = o.value !== "end";
    const x = button("×", () => { removeNode(t, node.id); structural(); save(); }, { small: true, title: `Remove “${nameOf(node)}” and everything under it` });
    x.setAttribute("aria-label", `Remove ${nameOf(node)} and everything under it`);
    x.classList.add("x");
    head.push(kind.el, x);
  }
  const nums = [];
  if (parent && parent.type === "chance") nums.push(numField("Probability", node.p, { min: 0, max: 1 }, (v) => { node.p = v; }).el);
  if (node.type === "end") nums.push(numField("Utility", node.value, { negative: true }, (v) => { node.value = v; }).el);

  const row = el("div", { class: "n-row" }, el("div", { class: `n-head${parent ? "" : " root"}` }, head), nums.length ? el("div", { class: "n-nums" }, nums) : null);
  if (node.type === "end") return el("div", { class: "n" }, row);
  const full = node.children.length >= LIMITS.children || depth + 1 > LIMITS.depth || count >= LIMITS.nodes;
  const add = button(node.type === "chance" ? "Add an outcome" : "Add an option", () => { const c = addChild(t, node.id); structural(c?.id); save(); },
    { small: true, title: full ? `This page allows ${LIMITS.children} branches from a node, ${LIMITS.depth} levels and ${LIMITS.nodes} nodes in all.` : undefined });
  add.disabled = full;
  return el("div", { class: "n" }, row,
    el("div", { class: "n-kids" }, node.children.map((c) => nodeRow(c, node, depth + 1)),
      el("div", { class: "n-foot" }, el("div", { "data-status": node.id }), add)));
}

function renderEditor() { fill(editor, nodeRow(state.tree, null, 0)); }

// After anything that adds or removes a node: rebuild the editor, then put the cursor in the new row.
function structural(focusId) {
  renderEditor();
  refresh();
  const target = focusId && editor.querySelector(`[data-focus="${focusId}"]`);
  if (target) { target.focus(); target.select(); }
}

/* --------------------------------------------------------------------------- outputs */
const verdict = el("p", { class: "verdict", role: "status" });
const problemBox = el("div", { class: "stack" });
const sValue = stat("Expected utility");
const sLead = stat("Lead over the next option");
const sFlip = stat("Closest flip");
const sCount = stat("Numbers that can flip it");
const statsBox = el("div", { class: "stats" }, sValue.el, sLead.el, sFlip.el, sCount.el);
const treeTitle = el("h3");
const treeSvg = svgEl("svg", { class: "tree", role: "img" });
const treeBox = el("div", { class: "tree-box" }, treeSvg);
const legend = el("div", { class: "tree-legend small muted" },
  el("span", {}, el("i", { class: "sym decision" }), "a decision: you choose"),
  el("span", {}, el("i", { class: "sym chance" }), "a chance event"),
  el("span", {}, el("i", { class: "sym end" }), "an end point and its utility"),
  el("span", {}, el("i", { class: "key-line" }), "the recommended plan"),
  el("span", {}, el("b", { text: "//" }), " an option turned down"));
const caseBox = el("div");
const flipTable = el("div", { class: "flips" });
const pick = select({ label: "Number to vary", options: [], onChange: (v) => { state.param = v; refresh(); } });
const lineBox = el("div");
const sensBox = el("div", { class: "out" },
  el("div", { class: "stack" }, el("h3", { text: "What would change the choice" }), caseBox, flipTable),
  el("div", { class: "stack" }, pick.el, lineBox));
const sensWait = el("div", { class: "stack" }, el("h3", { text: "What would change the choice" }),
  note("", "This appears once the tree can be worked out. The problems are listed above and marked in red in the drawing and the editor."));

$("#app").append(
  el("div", { class: "stack" },
    el("div", { class: "row" }, el("span", { class: "small", style: { fontWeight: "600" }, text: "Start from an example" }), presetButtons),
    blurb,
    el("div", { class: "row" }, exportLink, el("label", { class: "btn small file-btn", for: "tree-file" }, "Import a file", fileInput),
      el("span", { class: "small muted", text: "Your edits are saved in this browser." })),
    fileNote),
  el("div", { class: "stack" }, verdict, problemBox),
  statsBox,
  el("div", { class: "stack" }, treeTitle, treeBox, legend),
  el("div", { class: "tool-grid wide-controls" },
    el("div", { class: "stack" }, el("h3", { text: "Edit the tree" }), editor),
    el("div", { class: "stack" }, sensBox, sensWait)));

const lines = chart(lineBox, { series: [], height: 320 });

/* ------------------------------------------------------------------- the drawn tree */
// Labels are measured, not guessed, so a name is cut only when it really would run into the next node.
const ruler = document.createElement("canvas").getContext("2d");
const textWidth = (text) => { ruler.font = `12px ${getComputedStyle(document.body).fontFamily}`; return ruler.measureText(text).width; };
function clip(text, px) {
  if (textWidth(text) <= px) return text;
  let n = text.length - 1;
  while (n > 1 && textWidth(`${text.slice(0, n)}…`) > px) n--;
  return `${text.slice(0, n)}…`;
}

function drawTree(result, bad) {
  const root = state.tree;
  const W = Math.max(280, Math.round(treeSvg.getBoundingClientRect().width) || 640);
  const list = [];
  walk(root, (node, parent, depth) => list.push({ node, parent, depth }));
  const maxDepth = Math.max(...list.map((n) => n.depth));
  const X0 = 60, PAD = 84, MINCOL = 150;
  const classic = W >= X0 + maxDepth * MINCOL + PAD; // room for a sideways tree; otherwise an indented one
  const pos = new Map();
  let H, col = 0;
  if (classic) {
    col = Math.min(260, (W - X0 - PAD) / Math.max(1, maxDepth));
    let leaf = 0;
    const place = (node, depth) => {
      const ys = node.children.map((c) => place(c, depth + 1));
      const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : 28 + 46 * leaf++;
      pos.set(node.id, { x: X0 + depth * col, y });
      return y;
    };
    place(root, 0);
    H = 46 * leaf + 10;
  } else {
    list.forEach((n, i) => pos.set(n.node.id, { x: 13 + n.depth * 24, y: 18 + 30 * i }));
    H = 30 * list.length + 6;
  }

  const edges = [], marks = [];
  for (const { node, parent } of list) {
    const { x, y } = pos.get(node.id);
    const onPlan = result ? result.plan.has(node.id) : true;
    const chosen = result && parent && (parent.type !== "decision" || result.best.get(parent.id) === node.id);
    const worthNow = result ? result.values.get(node.id) : null;
    const g = svgEl("g", { class: `node${onPlan ? "" : " off"}`, "data-id": node.id });
    g.append(svgEl("title", {}, `${nameOf(node)}${worthNow != null ? `: ${node.type === "end" ? "utility" : "expected utility"} ${val(worthNow)}` : ""}. Click to edit.`));

    if (parent) {
      const from = pos.get(parent.id);
      const d = classic ? `M${from.x},${from.y}L${from.x + 26},${y}H${x}` : `M${from.x},${from.y}V${y}H${x}`;
      edges.push(svgEl("path", { d, class: `edge${result && onPlan ? " plan" : ""}${onPlan ? "" : " off"}` }));
      if (result && parent.type === "decision" && !chosen) {
        const sx = classic ? from.x + 30 : from.x + 7;
        edges.push(svgEl("path", { d: `M${sx - 4},${y + 5}l5,-10M${sx + 1},${y + 5}l5,-10`, class: `slash${result.plan.has(parent.id) ? "" : " off"}` }));
      }
      const p = parent.type === "chance" && Number.isFinite(node.p) ? prob(node.p) : "";
      if (classic) {
        const room = x - from.x - 40 - (node.type === "end" ? 4 : 10);
        g.append(svgEl("text", { x: from.x + 40, y: y - 7 }, clip(nameOf(node), room)));
        if (p) g.append(svgEl("text", { class: "p", x: from.x + 40, y: y + 15 }, `p = ${p}`));
        if (node.type !== "end" && worthNow != null) g.append(svgEl("text", { class: "ev", x: x - 12, y: y + 15, "text-anchor": "end" }, val(worthNow)));
      }
    } else if (classic && worthNow != null) {
      g.append(svgEl("text", { class: "ev", x: x - 13, y: y + 4, "text-anchor": "end" }, val(worthNow)));
    }
    if (classic) {
      if (node.type === "end" && worthNow != null) g.append(svgEl("text", { class: "u", x: x + 13, y: y + 4 }, val(worthNow)));
    } else {
      const right = worthNow != null ? val(worthNow) : "";
      const lead = parent && parent.type === "chance" && Number.isFinite(node.p) ? `${prob(node.p)}  ` : "";
      const room = W - x - 13 - textWidth(right) * 1.1 - 14;
      const t = svgEl("text", { x: x + 13, y: y + 4 }, lead ? svgEl("tspan", { class: "p" }, lead) : null, clip(nameOf(node), room - textWidth(lead)));
      g.append(t);
      if (right) g.append(svgEl("text", { class: node.type === "end" ? "u" : "ev", x: W - 4, y: y + 4, "text-anchor": "end" }, right));
    }

    if (bad.has(node.id)) g.append(svgEl("circle", { cx: x, cy: y, r: 12.5, class: "bad-ring" }));
    if (node.type === "decision") g.append(svgEl("rect", { x: x - 6.5, y: y - 6.5, width: 13, height: 13, rx: 1.5, class: "sq" }));
    else if (node.type === "chance") g.append(svgEl("circle", { cx: x, cy: y, r: 6.5, class: "ci" }));
    else g.append(svgEl("path", { d: `M${x - 6},${y}L${x + 6},${y - 7}V${y + 7}Z`, class: "tri" }));
    g.append(svgEl("rect", { x: x - 14, y: y - 14, width: 28, height: 28, fill: "transparent" })); // a comfortable target
    marks.push(g);
  }

  treeSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  treeSvg.setAttribute("height", H);
  treeSvg.dataset.layout = classic ? "sideways" : "indented";
  treeSvg.replaceChildren(...edges, ...marks);
}
treeSvg.addEventListener("click", (e) => {
  const id = e.target.closest?.("[data-id]")?.dataset.id;
  const box = id && editor.querySelector(`[data-focus="${id}"]`);
  if (box) { box.focus({ preventScroll: true }); box.select(); box.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" }); }
});
let lastWidth = 0;
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { if (treeBox.clientWidth !== lastWidth) refresh(); }).observe(treeBox);

/* --------------------------------------------------------------------------- refresh */
const describe = (row, lower = false) => `${row.kind === "p" ? (lower ? "chance of" : "Chance of") : lower ? "utility of" : "Utility of"} “${row.name.trim() || "unnamed"}”`;
const show = (row, x) => (row.kind === "p" ? prob(x) : val(x));

function refresh() {
  const t = state.tree;
  const problems = validate(t);
  const bad = new Set(problems.map((p) => p.id));
  const ok = !problems.length;
  const result = ok ? rollback(t) : null;
  lastWidth = treeBox.clientWidth;

  for (const b of presetButtons) { const on = b.dataset.preset === state.preset; b.classList.toggle("primary", on); b.setAttribute("aria-pressed", on); }
  blurb.textContent = PRESETS.find((p) => p.key === state.preset)?.blurb
    || (state.preset === "own" ? "Your own tree, as you left it. Pick an example to start again from that." : "A blank tree: one decision, two options. Rename them, give each a utility, and turn an option into a chance event to add uncertainty.");
  exportLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(plain(t), null, 2))}`;

  // The line under each node's branches: do a chance node's probabilities add up, does the node have branches at all?
  walk(t, (node) => {
    const box = editor.querySelector(`[data-status="${node.id}"]`);
    if (!box) return;
    const p = problems.find((x) => x.id === node.id);
    if (p && p.sum != null) {
      fill(box, note("warn", `These probabilities sum to ${fmt.sig(p.sum, 6)}, not 1. `,
        button("Rescale them to sum to 1", () => { normalise(t, node.id); structural(); save(); }, { small: true })));
    } else if (p) fill(box, note("bad", p.message));
    else fill(box, node.type === "chance" ? el("span", { class: "small muted", text: "Probabilities sum to 1." }) : null);
  });

  treeTitle.textContent = nameOf(t);
  drawTree(result, bad);
  statsBox.hidden = sensBox.hidden = legend.hidden = !ok;
  sensWait.hidden = ok;

  if (!ok) {
    verdict.textContent = "The tree cannot be worked out yet.";
    fill(problemBox, problems.slice(0, 6).map((p) => note("bad", p.message)),
      problems.length > 6 ? note("", `And ${problems.length - 6} more. They are marked in red in the drawing and listed in the editor.`) : null);
    treeSvg.setAttribute("aria-label", `Decision tree with ${size(t).nodes} nodes. It cannot be worked out yet.`);
    return;
  }
  fill(problemBox);

  // The recommendation, in words.
  const options = t.children;
  const ranked = options.map((o) => ({ o, v: result.values.get(o.id) })).sort((a, b) => b.v - a.v);
  const best = options.find((o) => o.id === result.best.get(t.id));
  const second = ranked.find((r) => r.o !== best);
  const later = planSteps(t, result).slice(1).map((s) => `if it comes to “${nameOf(s.at)}”, choose “${nameOf(s.choose)}”`);
  const tie = second && second.v === result.value;
  verdict.textContent = (!second ? `“${nameOf(best)}” is the only option: expected utility ${val(result.value)}.`
    : tie ? `“${nameOf(best)}” and “${nameOf(second.o)}” are level on ${val(result.value)}.`
    : `Choose “${nameOf(best)}”: expected utility ${val(result.value)}, against ${val(second.v)} for “${nameOf(second.o)}”.`)
    + (later.length ? ` Then, ${later.join("; ")}.` : "");
  treeSvg.setAttribute("aria-label", `Decision tree with ${size(t).nodes} nodes. ${verdict.textContent} The editor below lists every branch.`);
  sValue.set(val(result.value), `of “${nameOf(best)}”`);
  sLead.set(second ? val(result.value - second.v) : "–", second ? `over “${nameOf(second.o)}”` : "there is no other option");

  // One-way sensitivity.
  const sens = sensitivity(t);
  const able = sens.filter((s) => s.nearest);
  const optionName = (id) => nameOf(options.find((o) => o.id === id));
  sCount.set(`${able.length} of ${sens.length}`, "moved one at a time, the rest held still");
  if (able.length) sFlip.set(show(able[0], able[0].nearest.at), `${describe(able[0], true)}, now ${show(able[0], able[0].now)}`);
  else sFlip.set("None", "no single number changes the choice");

  if (!second) fill(caseBox, note("", "With one option there is no choice to flip. Add a second option to the first decision."));
  else if (!able.length) fill(caseBox, note("good", `No single number in this tree changes the choice. “${nameOf(best)}” stays ahead however far any one probability or utility is moved on its own.`));
  else {
    fill(caseBox, note("", el("strong", { text: `The case against “${nameOf(best)}”. ` }), "It rests most heavily on these numbers. Move any one of them this far and the choice changes:",
      el("ol", { class: "case" }, able.slice(0, 3).map((s) => el("li", {},
        `${describe(s)}: you say ${show(s, s.now)}. ${s.nearest.at === s.now ? "It is exactly on the line now" : `At ${show(s, s.nearest.at)}`}, “${optionName(s.nearest.to)}” ${s.nearest.at === s.now ? "is level" : "takes over"}.`)))));
  }
  fill(flipTable, sens.length ? table({
    caption: "Every number, from the one the choice is most sensitive to down to the least",
    columns: [{ key: "what", label: "Assumption" }, { key: "now", label: "Now", num: true }, { key: "at", label: "Flips at", num: true }, { key: "to", label: "Then choose" }],
    rows: sens.map((s) => {
      const flips = [s.below, s.above].filter(Boolean);
      return {
        what: el("span", {}, describe(s), el("span", { class: "muted small", text: ` under “${s.under.trim() || "unnamed"}”` })),
        now: show(s, s.now),
        at: flips.length ? flips.map((f) => (f.at === s.now ? `${show(s, f.at)} (level now)` : show(s, f.at))).join(" or ") : el("span", { class: "muted", text: "never" }),
        to: flips.length ? optionName(flips[0].to) : "",
      };
    }),
  }) : null);

  // The chart for one number.
  if (!sens.some((s) => s.key === state.param)) state.param = (able[0] || sens[0])?.key || "";
  fill(pick.input, sens.map((s) => el("option", { value: s.key, text: `${describe(s)} (under “${s.under.trim() || "unnamed"}”)` })));
  pick.value = state.param;
  const row = sens.find((s) => s.key === state.param);
  pick.el.hidden = lineBox.hidden = !row;
  if (!row) return;
  const flips = [row.below, row.above].filter(Boolean);
  let lo = 0, hi = 1;
  if (row.kind === "value") {
    const sp = spread(t);
    const pts = [row.now, sp.lo, sp.hi, ...flips.map((f) => f.at)];
    lo = Math.min(...pts); hi = Math.max(...pts);
    const pad = (hi - lo || 1) * 0.08;
    lo -= pad; hi += pad;
  }
  const c = curve(t, row, lo, hi, 200);
  const all = c.series.flatMap((s) => s.ys);
  const yLo = Math.min(...all), yHi = Math.max(...all);
  const yPad = (yHi - yLo || Math.abs(yHi) || 1) * 0.05;
  const top = yHi + yPad * 6;
  const label = (x, text, side, rowNo) => ({ type: "text", x, y: top, text, anchor: side, dx: side === "end" ? -5 : 5, dy: 13 + 16 * rowNo });
  const frac = (x) => (x - lo) / (hi - lo);
  const marks = [{ type: "vline", x: row.now }, label(row.now, `now ${show(row, row.now)}`, frac(row.now) > 0.7 ? "end" : "start", 0)];
  const lowSide = row.below && frac(row.below.at) > 0.25 ? "end" : "start";
  const highSide = row.above && frac(row.above.at) < 0.7 ? "start" : "end";
  [[row.below, lowSide, 1], [row.above, highSide, lowSide === "end" && highSide === "start" ? 1 : 2]].forEach(([f, side, rowNo]) => {
    if (!f || f.at === row.now) return;
    const leadSeries = c.series.find((s) => s.id === row.leader);
    const i = Math.round(frac(f.at) * 200);
    marks.push({ type: "vline", x: f.at }, label(f.at, `flips at ${show(row, f.at)}`, side, rowNo), { type: "point", x: f.at, y: leadSeries.ys[i], r: 4.5 });
  });
  lines.update({
    title: `Each option's expected utility as the ${row.kind === "p" ? "chance" : "utility"} of “${row.name.trim() || "unnamed"}” changes`,
    subtitle: row.kind === "p"
      ? "The other branches of the same chance event are rescaled so the probabilities still sum to 1. Nothing else moves."
      : "Every other number is held where it is. The highest line is the choice.",
    label: `Line chart of each option's expected utility against the ${describe(row, true)}`,
    x: { label: describe(row), domain: [lo, hi], format: (x) => show(row, x) },
    y: { label: "Expected utility", format: val, domain: [yLo - yPad, top] },
    series: c.series.map((s, i) => ({ name: nameOf(options[i]), type: "line", color: i, data: c.xs.map((x, j) => [x, s.ys[j]]) })),
    marks,
    legend: true,
  });
}

renderEditor();
refresh();
document.fonts?.ready.then(refresh); // labels were measured before the web font arrived
