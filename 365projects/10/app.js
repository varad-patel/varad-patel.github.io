// Day 10: Ship of Theseus Simulator. Interface.
import { $, el, svgEl, fmt, clamp, mount, slider, select, checkbox, segmented, button, stat, note, chart, ticker, reducedMotion, randomSeed, palette } from "../kit/kit.js";
import { PARTS, N, VIEWS, ORDERS, weights, makeOrder, promote, trajectory, breaks, roughest, matchMark, hobbesTension, describeParts } from "./logic.js";

mount();

const state = { t: 0, orderName: "wear", seed: 10, order: makeOrder("wear"), gamma: 1, mark: null, hobbes: false, answer: "" };
const strong = (text) => el("strong", { text });
const list = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const steps = (n) => `${n} replacement${n === 1 ? "" : "s"}`;
const viewName = (key) => VIEWS.find((v) => v.key === key).name;
// Shares are compared with one half, so a rounded "50%" must mean exactly half: whole percentages only when exact.
const share = (v) => fmt.pct(v, Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 ? 0 : 1);
/** Replace a box's contents only when the words differ, so that a live region is not read out again for nothing. */
const setText = (box, node) => { if (box.textContent !== node.textContent) box.replaceChildren(node); };

/* ---------- the ship ---------- */
const ORIGINAL = palette[3], NEW = palette[0], GHOST = "#dfe5e1", SHEET = "#f9fbf9";
const stroke = (d, width) => svgEl("path", { d, fill: "none", "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" });
function shape(p) {
  if (p.kind === "plank") {
    const row = Math.floor(p.index / 6), col = p.index % 6;
    const edge = (i) => (i === 0 ? 30 : i === 6 ? 490 : 40 + i * 73.33 + (row % 2 ? 24 : 0));
    return svgEl("rect", { x: edge(col), y: 170 + row * 16.5, width: edge(col + 1) - edge(col), height: 16.5, "stroke-width": 1.2 });
  }
  if (p.kind === "oar") return stroke(`M${130 + p.index * 19},206 l-20,58`, 3.2);
  return {
    keel: () => svgEl("rect", { x: 92, y: 235, width: 348, height: 10, rx: 3 }),
    mast: () => svgEl("rect", { x: 256, y: 30, width: 8, height: 140 }),
    yard: () => svgEl("rect", { x: 166, y: 48, width: 188, height: 7, rx: 3 }),
    sail: () => svgEl("path", { d: "M176,57 H344 L336,148 Q260,164 184,148 Z", "fill-opacity": 0.82 }),
    stem: () => stroke("M438,240 Q482,224 490,148", 9),
    stern: () => stroke("M94,240 Q44,226 34,160 Q30,128 56,126", 9),
    steer: () => stroke("M88,186 L60,262", 5),
  }[p.kind]();
}

let clips = 0;
/** One drawing of the ship. paint(colourOf) recolours every part; colourOf(id) returns [colour, tooltip]. */
function ship(label, live) {
  const clipId = `hull${++clips}`;
  const nodes = PARTS.map((p) => {
    const node = shape(p);
    const mode = node.getAttribute("fill") === "none" ? "stroke" : "fill";
    const tip = svgEl("title");
    node.dataset.id = p.id;
    node.append(tip);
    // Stroked parts get a pale halo so that an oar stays visible where it crosses the planks.
    const halo = mode === "stroke" ? stroke(node.getAttribute("d"), Number(node.getAttribute("stroke-width")) + 2.4) : null;
    if (halo) { halo.setAttribute("stroke", SHEET); halo.setAttribute("pointer-events", "none"); } else node.setAttribute("stroke", SHEET);
    return { p, node, tip, mode, draw: halo ? [halo, node] : node };
  });
  const of = (kind) => nodes.filter((n) => n.p.kind === kind).map((n) => n.draw);
  const svg = svgEl("svg", { viewBox: "0 0 520 280", role: "img", "aria-label": label, class: live ? "ship live" : "ship" },
    svgEl("defs", {}, svgEl("clipPath", { id: clipId }, svgEl("path", { d: "M38,170 H482 Q474,214 434,236 H98 Q46,214 38,170 Z" }))),
    svgEl("path", { d: `M0,252 q10,-5 20,0${" t20,0".repeat(25)}`, fill: "none", stroke: "#b9c5bd", "stroke-width": 1.5 }),
    of("sail"), of("yard"), of("mast"), of("stern"), of("stem"),
    svgEl("g", { "clip-path": `url(#${clipId})` }, of("plank")), of("keel"), of("steer"), of("oar"));
  return {
    svg,
    paint(colourOf) {
      for (const n of nodes) {
        const [colour, tip] = colourOf(n.p.id);
        n.node.setAttribute(n.mode, colour);
        n.tip.textContent = `${n.p.label}: ${tip}`;
      }
    },
  };
}

const shipA = ship("The repaired ship", true);
const shipB = ship("The ship rebuilt from the removed parts", false);
/** Replace one chosen part now, whatever the order said. Does nothing if that part has already gone. */
function replacePart(id) {
  const next = promote(state.order, state.t, id);
  if (next === state.order) return;
  state.order = next;
  state.orderName = "custom";
  state.t++;
  render();
}
shipA.svg.addEventListener("click", (e) => {
  const id = e.target.closest?.("[data-id]")?.dataset.id;
  if (id != null) replacePart(Number(id));
});

/* ---------- controls ---------- */
const stepSlider = slider({ label: "Parts replaced", min: 0, max: N, step: 1, value: 0, format: (v) => `${v} of ${N}`, onInput: (v) => { state.t = v; render(); } });
const replaceBtn = button("Replace the next part", () => { if (state.t < N) { state.t++; render(); } }, { primary: true });
const resetBtn = button("Start again", () => { player.stop(); state.t = 0; state.mark = null; state.answer = ""; which.value = ""; render(); });
let waited = 0;
const player = ticker((dt) => {
  waited += dt;
  if (waited < (reducedMotion() ? 0.7 : 0.2)) return;
  waited = 0;
  if (state.t < N) state.t++;
  if (state.t >= N) player.stop();
  render();
});
const playBtn = button("Play", () => {
  if (player.running) player.stop();
  else { if (state.t >= N) state.t = 0; waited = 0; player.start(); }
  render();
});
const orderSelect = select({
  label: "Order of replacement", value: "wear",
  options: [...ORDERS, { value: "custom", label: "Your own order" }],
  hint: "Changing the order replays the same number of replacements in the new order. Replacing a part of your choice makes the order your own.",
  onChange: (v) => { state.orderName = v; if (v !== "custom") state.order = makeOrder(v, state.seed); render(); },
});
const shuffleBtn = button("New random order", () => { state.seed = randomSeed(); state.orderName = "random"; state.order = makeOrder("random", state.seed); render(); }, { small: true });
const gammaSlider = slider({
  label: "Extra weight on the frame", min: 0, max: 2, step: 0.1, value: 1,
  format: (g) => (g === 0 ? "all parts equal" : `keel = ${fmt.sig(20 ** g, 2)} planks`),
  hint: "A part's weight is its base importance raised to this power (shown here as what the keel is worth). Base values: keel 20, mast 8, posts and sail 5, yard and steering oar 2, plank 1, oar 0.5.",
  onInput: (g) => { state.gamma = g; render(); },
});
// The same thing as clicking a part on the drawing, for keyboards, screen readers and small screens.
const partSelect = select({ label: "Or choose the part to replace", options: [] });
const partBtn = button("Replace this part", () => { if (partSelect.value !== "") replacePart(Number(partSelect.value)); });
const partRow = el("div", { class: "field" }, el("div", { class: "pick" }, partSelect.el, partBtn),
  el("div", { class: "hint", text: "Clicking an original part on the drawing does the same. Start again resets the steps and your verdict, not the order or the weights." }));
const markBtn = button("It stops being the ship here", () => { if (state.t > 0) { state.mark = state.t; render(); } });
const neverBtn = button("It never stops", () => { state.mark = "never"; render(); });
const markHint = el("div", { class: "hint" });
const hobbesBox = checkbox({ label: "Keep the removed parts and rebuild them into a second ship (Hobbes's variant)", onChange: (on) => { state.hobbes = on; render(); } });

/* ---------- outputs ---------- */
const sStep = stat("Parts replaced");
const sCount = stat("Original parts left");
const sWeight = stat("Original weight left");
const sMark = stat("Your mark");
const capA = el("figcaption", { "aria-live": "polite" });
const capB = el("figcaption");
const figB = el("figure", { class: "ship-fig" }, shipB.svg, capB);
const swatch = (colour, text) => el("span", {}, el("i", { style: { background: colour } }), text);
const ghostKey = swatch(GHOST, "Not yet rebuilt");
const ships = el("div", {},
  el("div", { class: "ships" }, el("figure", { class: "ship-fig" }, shipA.svg, capA), figB),
  el("div", { class: "chart-legend", style: { marginTop: "8px" } }, swatch(ORIGINAL, "Original part"), swatch(NEW, "Replacement"), ghostKey));
// The ship sits with its controls, so that on a phone the button and the thing it changes are on screen together.
const controls = el("div", { class: "controls" },
  ships, stepSlider.el, el("div", { class: "row" }, replaceBtn, playBtn, resetBtn), partRow,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Your verdict" })), el("div", { class: "row" }, markBtn, neverBtn), markHint),
  hobbesBox.el, orderSelect.el, el("div", {}, shuffleBtn), gammaSlider.el);
const verdict = el("div", { role: "status" });
const which = segmented({
  label: "When every part has been replaced and the old ones rebuilt, which is the ship of Theseus?", value: "",
  options: [{ value: "repaired", label: "The repaired ship" }, { value: "rebuilt", label: "The rebuilt ship" }, { value: "both", label: "Both" }, { value: "neither", label: "Neither" }],
  onChange: (v) => { state.answer = v; render(); },
});
const whichSays = el("div", { class: "checks" });
const hobbesPanel = el("div", { class: "panel" }, which.el, whichSays);
const chartBox = el("div");
const viewsBox = el("ul", { class: "views" });
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sStep.el, sCount.el, sWeight.el, sMark.el), verdict, hobbesPanel, chartBox,
  el("div", {}, el("h3", { text: "Where each view says the ship stops being the ship of Theseus" }), viewsBox));

$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out));
const plot = chart(chartBox, { series: [], height: 300 });

/* ---------- text ---------- */
const HOBBES = {
  repaired: "You follow continuity. The repaired ship has one unbroken history: it was never taken apart, it changed one part at a time, and it kept its form throughout. The rebuilt ship is then a second ship made of old timber. The rules on this page for gradual continuity and for form and function say this.",
  rebuilt: "You follow the matter. Every part of the rebuilt ship sailed with Theseus and sits where it sat then. The majority-of-matter rules point here, and so does mereological essentialism if a thing can be taken apart and put together again. Hobbes raised the case to make exactly this trouble for the answer that sameness of form is enough. It means the repaired ship stopped being the ship of Theseus at some step.",
  both: "Strictly, they cannot both be the original. The two ships are in different places, so they are two things, and if each were identical to the original they would be identical to each other; Hobbes called that result absurd. One version of four-dimensionalism keeps part of this answer: it says there were two ships all along that shared their early stages, as two roads can share a stretch of tarmac.",
  neither: "Then the ship of Theseus no longer exists. The repaired ship lost its identity with its matter, and the rebuilt one is a new construction from old parts, because the original was taken apart piece by piece and, on this answer, a thing cannot stop existing and then start again.",
};

function verdictNote(traj, b) {
  const m = state.mark;
  const match = matchMark(m, b);
  const rough = roughest(traj);
  const roughText = `${share(rough.step)} of the ship (${PARTS[rough.part].label})`;
  if (match.kind === "none") {
    return note("", "Replace parts until you judge that this is no longer the ship Theseus sailed, then mark the step. If you think that moment never comes, say so. Either way the list below the chart shows where seven views of identity put it: two positions from the literature and five simple rules made for this page.");
  }
  if (match.kind === "never") {
    return note("good", strong("You say it never stops being the same ship. "), `That is the verdict of ${match.views.length === 1 ? "one view here" : "two views here"}: ${match.views.map((v) => viewName(v.key).toLowerCase()).join(", and ")}. `,
      b.continuity == null
        ? `The largest single change is ${roughText}, which is less than half, so that rule finds no break. `
        : `Gradual continuity does not agree at this weighting, because one replacement changes ${roughText}. `,
      "A mereological essentialist says it was a different ship after the first replacement.");
  }
  const row = traj[m];
  const head = [strong(`You marked step ${m}, the replacement of ${PARTS[row.part].label}. `), `At that step ${share(row.count)} of the parts and ${share(row.weighted)} of the weight are original. `];
  if (match.kind === "own") {
    const than = (at) => (m < at ? "stricter" : "looser");
    return note("", head, `No view on this page puts its break there. Your mark works as a threshold of your own: the ship must keep more than ${share(row.count)} of its original parts, or more than ${share(row.weighted)} of its original weight. `,
      than(b.count) === than(b.weighted) ? `That is ${than(b.count)} than a bare majority, by count and by weight` : `That is ${than(b.count)} than a bare majority of parts and ${than(b.weighted)} than a bare majority by weight`,
      m > 1 ? ", and looser than essentialism." : ".");
  }
  const where = (v) => `${viewName(v.key).toLowerCase()} (${v.gap === 0 ? "the same step" : `step ${m - v.gap}, ${steps(Math.abs(v.gap))} ${v.gap > 0 ? "earlier" : "later"}`})`;
  return note("good", head, `Your mark matches ${list(match.views.map(where))}.`);
}

function render() {
  const w = weights(state.gamma);
  const traj = trajectory(state.order, w);
  const b = breaks(traj);
  const now = traj[state.t];
  const gone = new Set(state.order.slice(0, state.t));
  const m = state.mark;

  // Controls follow the state.
  stepSlider.value = state.t;
  orderSelect.value = state.orderName;
  replaceBtn.disabled = state.t >= N;
  playBtn.textContent = player.running ? "Pause" : "Play";
  markBtn.disabled = state.t === 0;
  markBtn.setAttribute("aria-pressed", String(m === state.t));
  neverBtn.setAttribute("aria-pressed", String(m === "never"));
  // The parts still original, for the keyboard route. Rebuilt only when the list changes, so an open menu is left alone.
  const left = PARTS.filter((p) => !gone.has(p.id));
  if (partSelect.input.dataset.left !== left.map((p) => p.id).join()) {
    const keep = partSelect.value;
    partSelect.input.replaceChildren(...left.map((p) => el("option", { value: p.id, text: p.label })));
    if (left.some((p) => String(p.id) === keep)) partSelect.value = keep;
    partSelect.input.dataset.left = left.map((p) => p.id).join();
  }
  partSelect.input.disabled = partBtn.disabled = !left.length;
  markHint.textContent = state.t === 0 ? "Nothing has been replaced yet. Replace a part, or say it never stops." : m == null ? "Mark the step you are on, or say the ship never stops being the same. You can change your mind." : m === "never" ? "Your verdict: never." : `Your mark is at step ${m}. Mark another step to move it.`;

  // Ships.
  shipA.paint((id) => (gone.has(id) ? [NEW, "replaced"] : [ORIGINAL, "original; click to replace it now"]));
  shipB.paint((id) => (gone.has(id) ? [ORIGINAL, "original, rebuilt here"] : [GHOST, "still on the repaired ship"]));
  figB.hidden = !state.hobbes;
  ghostKey.hidden = !state.hobbes;
  hobbesPanel.hidden = !state.hobbes;
  // The captions say in words what the drawings show. While the steps play by themselves the caption is not read out on every tick.
  const goneText = list(describeParts(gone));
  capA.setAttribute("aria-live", player.running ? "off" : "polite");
  capA.textContent = `${state.hobbes ? "The repaired ship: " : ""}${N - state.t} of ${N} parts original${state.t ? `. Last replaced: ${PARTS[now.part].label}. Replaced so far: ${goneText}.` : "."}`;
  capB.textContent = `The rebuilt ship: ${state.t} of ${N} parts in place, all of them original${state.t ? `: ${goneText}.` : "."}`;
  shipA.svg.setAttribute("aria-label", `Drawing of the repaired ship. ${state.t ? `Replaced: ${goneText}` : "Every part is original"}.`);
  shipB.svg.setAttribute("aria-label", `Drawing of the ship rebuilt from the removed parts. ${state.t ? `In place: ${goneText}` : "Nothing is in place yet"}.`);

  // Numbers.
  sStep.set(`${state.t} of ${N}`, state.t ? `last: ${PARTS[now.part].label}` : "the ship as Theseus left it");
  sCount.set(share(now.count), "counting every part as one");
  sWeight.set(share(now.weighted), state.gamma === 0 ? "all parts weigh the same" : `keel = ${fmt.sig(20 ** state.gamma, 2)} planks`);
  sMark.set(m == null ? "not set" : m === "never" ? "never" : `step ${m}`, Number.isInteger(m) ? `${share(traj[m].count)} of parts, ${share(traj[m].weighted)} of weight left` : m === "never" ? "it is always the same ship" : "use the verdict buttons");
  setText(verdict, verdictNote(traj, b));

  // Hobbes's question.
  const tension = hobbesTension(m, state.answer);
  whichSays.replaceChildren(...(state.answer ? [note("", HOBBES[state.answer])] : [note("", "Hobbes set out this case in 1655. At the end the repaired ship has the history and none of the timber; the rebuilt ship has all of the timber and a gap in its history.")]),
    ...(tension ? [note("warn", strong("This sits badly with your mark. "), m === "never"
      ? "You said the repaired ship never stops being the ship of Theseus. Then the ship of Theseus cannot be a different ship, and cannot have ceased to exist."
      : `You marked step ${m} as the point where the repaired ship stopped being the ship of Theseus, and you also say that the repaired ship ${state.answer === "both" ? "is one of two ships that are" : "is"} the ship of Theseus.`)] : []));

  // Chart.
  const marks = [{ type: "hline", y: 0.5, text: "half" }, { type: "vline", x: state.t, text: "now" }];
  if (Number.isInteger(m)) marks.push({ type: "vline", x: m, text: "your mark", dy: 14 });
  plot.update({
    title: "How much of the original ship is left",
    subtitle: "Click the chart to jump to a step, or use the arrow keys and Enter.",
    label: "Line chart of the share of the ship that is original against the number of parts replaced",
    x: { label: "Parts replaced", domain: [0, N] },
    y: { label: "Share of the ship", domain: [0, 1], format: share },
    series: [
      { name: "Original, by count of parts", data: traj.map((r) => [r.t, r.count]), color: 0 },
      { name: "Original, by weight", data: traj.map((r) => [r.t, r.weighted]), color: 1 },
      ...(state.hobbes ? [{ name: "Rebuilt ship: complete, by weight", data: traj.map((r) => [r.t, 1 - r.weighted]), color: 2 }] : []),
    ],
    marks,
    onClick: ({ x, inside }) => { if (inside) { state.t = clamp(Math.round(x), 0, N); render(); } },
  });

  // The views.
  const against = (key) => {
    if (key === "fourD") return "Not a threshold view.";
    if (m == null) return "";
    const at = b[key];
    if (at == null) return m === "never" ? "Agrees with you." : "Disagrees with your mark: it finds no break.";
    if (m === "never") return "Disagrees with you: it finds a break.";
    return at === m ? "The same step as your mark." : at < m ? `${steps(m - at)} before your mark.` : `${steps(at - m)} after your mark.`;
  };
  const breaksAt = (key) => {
    if (key === "fourD") return "No step of its own";
    if (key === "continuity" && b.continuity == null) return `Never breaks (largest single change ${share(roughest(traj).step)})`;
    return b[key] == null ? "Never breaks" : `Breaks at step ${b[key]}`;
  };
  const mine = new Set(matchMark(m, b).views.map((v) => v.key));
  viewsBox.replaceChildren(...VIEWS.map((v) => el("li", { class: mine.has(v.key) ? "view mine" : "view" },
    el("div", {}, strong(v.name), el("span", { class: "small muted", text: v.own ? " · a rule made for this page" : " · a position from the literature" }), el("div", { class: "small muted", text: v.gloss })),
    el("div", {}, el("div", { class: "view-at", text: breaksAt(v.key) }), el("div", { class: "small muted", text: against(v.key) })))));
}

render();
