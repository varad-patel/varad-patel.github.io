// Day 39: Demand Curve Simulator. Interface.
import { $, el, fmt, mount, slider, select, segmented, button, stat, note, chart, debounce } from "../kit/kit.js";
import { KINDS, demand, split, demandCurve, indifferenceCurve, axisMax, basketWords, reading } from "./logic.js";

mount();

const P_MIN = 1, P_MAX = 10; // the range of every price slider, and of the demand chart's price axis
const DEFAULTS = { kind: "cobb", a: 0.5, b: 3, sigma: 2, m: 100, px0: 2, px1: 4, py: 2, method: "hicks" };
const state = { ...DEFAULTS, held: null };
const INK = "#16233b", GREY = "#8a94a3";
const n1 = (v) => fmt.num(v, 1), n2 = (v) => fmt.num(v, 2);
// Axis ticks are whole numbers; a value read off a point gets two decimal places.
const quantity = (v) => fmt.num(v, Number.isInteger(v) ? 0 : 2);
// One label per place on a chart: baskets that sit on the same spot share it ("B, C"). The kit leaves out a label
// that would land on an earlier one, which would leave a dot with no letter, so each label is tried on one side of
// its dot after another until it is clear of the labels already placed and of the other dots.
const labels = (dots, box, xMax, yMax) => {
  const kx = Math.max(10, (box.clientWidth || 480) - 46) / xMax, ky = 292 / yMax; // pixels per unit in the kit's plot area, near enough
  const places = [];
  for (const d of dots) {
    const at = places.find((q) => Math.abs(q.x - d.x) * kx < 3 && Math.abs(q.y - d.y) * ky < 3);
    if (at) at.text += `, ${d.label[0]}`; else places.push({ x: d.x, y: d.y, text: d.label[0] });
  }
  const SIDES = [[8, -8, "start"], [-8, -8, "end"], [8, 18, "start"], [-8, 18, "end"], [8, -24, "start"], [-8, -24, "end"]];
  const taken = [];
  const apart = (a, b) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
  return places.map((g) => {
    const px = g.x * kx, py = -g.y * ky, w = g.text.length * 6.8 + 4;
    const boxOf = ([dx, dy, anchor]) => ({ x0: px + dx - (anchor === "end" ? w : 0) - 2, x1: px + dx + (anchor === "end" ? 0 : w) + 2, y0: py + dy - 13, y1: py + dy + 5 });
    const others = places.filter((o) => o !== g).map((o) => ({ x0: o.x * kx - 6, x1: o.x * kx + 6, y0: -o.y * ky - 6, y1: -o.y * ky + 6 }));
    // Near the right-hand edge a label goes to the left of its dot, and on the bottom axis it stays above it.
    let order = g.x > xMax * 0.88 ? [1, 3, 5, 0, 2, 4] : [0, 1, 2, 3, 4, 5];
    if (g.y * ky < 22) order = order.filter((i) => SIDES[i][1] < 0);
    const sides = order.map((i) => SIDES[i]);
    const clear = (s) => taken.every((t) => apart(boxOf(s), t));
    const free = sides.filter((s) => clear(s) && others.every((o) => apart(boxOf(s), o)));
    // Of the sides that are free, the four next to the dot come before the two further off, and among those the
    // one with most room from the other dots wins, so a letter does not sit nearer a neighbour than its own dot.
    const near = free.filter((s) => Math.abs(s[1]) < 20);
    const room = (s) => { const b = boxOf(s); return Math.min(24, ...others.map((o) => Math.hypot((o.x0 + o.x1) / 2 - (b.x0 + b.x1) / 2, (o.y0 + o.y1) / 2 - (b.y0 + b.y1) / 2))); };
    const side = (near.length ? near : free).reduce((best, s) => (best && room(best) >= room(s) ? best : s), null) || sides.find(clear) || sides[0];
    taken.push(boxOf(side));
    return { type: "text", x: g.x, y: g.y, text: g.text, dx: side[0], dy: side[1], anchor: side[2] };
  });
};
const sup = (...kids) => el("sup", {}, kids);
const v = (name) => el("var", { text: name });

// What each family means, and its utility function set out properly.
const ABOUT = {
  cobb: { said: "u equals x to the power a, times y to the power 1 minus a", text: "A fixed share of income goes on each good: the weight a on x and the rest on y.", formula: () => [v("u"), " = ", v("x"), sup(v("a")), " · ", v("y"), sup("1 − ", v("a"))] },
  subs: { said: "u equals a times x, plus 1 minus a times y", text: "The goods replace one another at a fixed rate, so the consumer buys only the one that gives more for the money.", formula: () => [v("u"), " = ", v("a"), v("x"), " + (1 − ", v("a"), ")", v("y")] },
  comp: { said: "u equals the smaller of x divided by a, and y divided by 1 minus a", text: "The goods are only useful together, a of x with every 1 − a of y. Extra of one alone is worth nothing.", formula: () => [v("u"), " = min(", v("x"), " / ", v("a"), ", ", v("y"), " / (1 − ", v("a"), "))"] },
  quasi: { said: "u equals 2 b times the square root of x, plus y", text: "Each extra unit of x is worth less than the one before, while y is always worth the same. As long as the income covers it, the amount of x wanted does not depend on income.", formula: () => [v("u"), " = 2", v("b"), "√", v("x"), " + ", v("y")] },
  ces: { said: "u equals a times x to the power r, plus 1 minus a times y to the power r, all to the power 1 over r, with r equal to 1 minus 1 over s", text: "One family that runs from near-complements (s close to 0) through Cobb-Douglas (s = 1) to near-substitutes (large s).", formula: () => [v("u"), " = (", v("a"), v("x"), sup(v("r")), " + (1 − ", v("a"), ")", v("y"), sup(v("r")), ")", sup("1/", v("r")), ", with ", v("r"), " = 1 − 1/", v("s")] },
};
const EXAMPLES = [
  { name: "Food and everything else", set: { kind: "cobb", a: 0.3 } },
  { name: "Tea and coffee", set: { kind: "subs", a: 0.5 } },
  { name: "Left shoes and right shoes", set: { kind: "comp", a: 0.5 } },
  { name: "Salt and everything else", set: { kind: "quasi", b: 2 } },
  { name: "Bus and train tickets", set: { kind: "ces", a: 0.5, sigma: 4 } },
];
const prefs = () => ({ kind: state.kind, a: state.a, b: state.b, sigma: state.sigma });
const kindLabel = () => KINDS.find((k) => k.id === state.kind).label;

/* ---------- controls ---------- */
const kindSel = select({ label: "Preferences", value: state.kind, options: KINDS.map((k) => ({ value: k.id, label: k.id === "ces" ? "CES (constant elasticity)" : k.label })), onChange: (k) => { state.kind = k; update(); } });
const about = el("div", { class: "about" });
const aSlider = slider({ label: "Weight on x (a)", min: 0.05, max: 0.95, step: 0.05, value: state.a, format: n2, onInput: (x) => { state.a = x; update(); } });
const bSlider = slider({ label: "Taste for x (b)", min: 0.5, max: 10, step: 0.5, value: state.b, format: n1, onInput: (x) => { state.b = x; update(); } });
const sSlider = slider({ label: "Elasticity of substitution (s)", min: 0.2, max: 5, step: 0.1, value: state.sigma, format: n1, hint: "How readily one good is swapped for the other when their prices move.", onInput: (x) => { state.sigma = x; update(); } });
const mSlider = slider({ label: "Income", min: 20, max: 200, step: 5, value: state.m, format: fmt.int, onInput: (x) => { state.m = x; update(); } });
const p0Slider = slider({ label: "Price of x, before", min: P_MIN, max: P_MAX, step: 0.1, value: state.px0, format: n2, onInput: (x) => { state.px0 = x; update(); } });
const p1Slider = slider({ label: "Price of x, after", min: P_MIN, max: P_MAX, step: 0.1, value: state.px1, format: n2, onInput: (x) => { state.px1 = x; update(); } });
const pySlider = slider({ label: "Price of y", min: P_MIN, max: P_MAX, step: 0.1, value: state.py, format: n2, onInput: (x) => { state.py = x; update(); } });
const methodSeg = segmented({
  label: "As well off as before means", value: state.method,
  options: [{ value: "hicks", label: "Same utility (Hicks)" }, { value: "slutsky", label: "Same basket (Slutsky)" }],
  hint: "The split depends on how much income would make up for the price change.",
  onChange: (x) => { state.method = x; update(); },
});
const examples = el("div", { class: "field", role: "group", "aria-label": "Examples of preferences" },
  el("div", { class: "lab" }, el("span", { text: "Examples" })),
  el("div", { class: "row" }, EXAMPLES.map((e) => button(e.name, () => { Object.assign(state, e.set); syncControls(); update(); }, { small: true }))),
  el("div", { class: "hint", text: "An example sets the preferences only. Income and prices stay as they are." }));

const holdBtn = button("Hold this demand curve", () => {
  const d = demandCurve(prefs(), state.py, state.m, P_MIN, P_MAX);
  state.held = { data: d.map((q) => [q.x, q.p]), text: `${describePrefs()}, income ${fmt.int(state.m)}, price of y ${n2(state.py)}` };
  update();
}, { small: true });
const dropBtn = button("Remove the held curve", () => { state.held = null; update(); }, { small: true });
const resetBtn = button("Reset everything", () => { Object.assign(state, DEFAULTS, { held: null }); syncControls(); update(); }, { small: true });

const controls = el("div", { class: "controls" },
  kindSel.el, about, examples, aSlider.el, bSlider.el, sSlider.el,
  el("h2", { text: "Income and prices" }),
  mSlider.el, pySlider.el, p0Slider.el, p1Slider.el, methodSeg.el,
  el("div", { class: "row" }, holdBtn, dropBtn, resetBtn));

function syncControls() {
  kindSel.value = state.kind;
  aSlider.value = state.a; bSlider.value = state.b; sSlider.value = state.sigma;
  mSlider.value = state.m; p0Slider.value = state.px0; p1Slider.value = state.px1; pySlider.value = state.py;
  methodSeg.value = state.method;
}
function describePrefs() {
  const needs = KINDS.find((k) => k.id === state.kind).needs;
  const parts = [needs.includes("a") ? `a = ${n2(state.a)}` : "", needs.includes("b") ? `b = ${n1(state.b)}` : "", needs.includes("sigma") ? `s = ${n1(state.sigma)}` : ""].filter(Boolean);
  return `${kindLabel()} (${parts.join(", ")})`;
}

/* ---------- outputs ---------- */
const sA = stat("Best basket, before");
const sC = stat("Best basket, after");
const sSub = stat("Substitution effect on x");
const sInc = stat("Income effect on x");
const message = el("div");
// On a narrow screen the results are a long way below the sliders, so the main figures ride along at the top.
const strip = el("p", { class: "strip", "aria-hidden": "true" });
const words = el("p", { class: "reading" });
// Read out once the sliders have come to rest, not at every step of a drag.
const live = el("p", { class: "sr-only", role: "status" });
const announce = debounce((text) => { live.textContent = text; }, 600);
const basketBox = el("div"), demandBox = el("div");
const listHead = el("h2", { text: "The three baskets" });
const list = el("ul", { class: "baskets" });
const heldNote = el("p", { class: "small muted" });
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sA.el, sC.el, sSub.el, sInc.el), message, words, live,
  el("div", { class: "grid2" }, basketBox, demandBox), heldNote, listHead, list);

$("#app").append(el("div", { class: "tool-grid" }, strip, controls, out));
const basketPlot = chart(basketBox, { series: [], height: 360 });
const demandPlot = chart(demandBox, { series: [], height: 360 });

/* ---------- drawing ---------- */
const setBasket = (tile, d, price) => (d.where === "tie"
  ? tile.set("no single one", `at a price of ${n2(price)}, anything from 0 to ${n2(d.range[1])} of x is as good`)
  : tile.set(`${n2(d.x)} of x`, `with ${n2(d.y)} of y, at a price of ${n2(price)}`));

function update() {
  const needs = KINDS.find((k) => k.id === state.kind).needs;
  aSlider.el.hidden = !needs.includes("a");
  bSlider.el.hidden = !needs.includes("b");
  sSlider.el.hidden = !needs.includes("sigma");
  about.replaceChildren(el("p", { class: "formula", role: "math", "aria-label": ABOUT[state.kind].said }, ABOUT[state.kind].formula()), el("p", { class: "hint", text: ABOUT[state.kind].text }));
  dropBtn.setAttribute("aria-disabled", String(!state.held));

  const p = prefs();
  const { px0, px1, py, m } = state;
  const r = split(p, px0, px1, py, m, state.method);
  if (r.error) {
    // The sliders cannot produce this, but nothing below would make sense if they did.
    message.replaceChildren(note("bad", r.error));
    for (const s of [sA, sC, sSub, sInc]) s.set("–", "");
    strip.textContent = "No result.";
    words.textContent = "";
    list.replaceChildren();
    return;
  }
  message.replaceChildren();
  const changed = px1 !== px0, splitKnown = changed && !r.undetermined;

  setBasket(sA, r.A, px0);
  setBasket(sC, r.C, px1);
  if (splitKnown) {
    sSub.set(fmt.signed(r.substitution, 2), "of x, because its price has changed relative to y");
    sInc.set(fmt.signed(r.income, 2), `of x, because the same income now buys ${px1 > px0 ? "less" : "more"}`);
  } else {
    for (const s of [sSub, sInc]) s.set("–", changed ? "the quantity of x is not pinned down" : "the two prices of x are the same");
  }
  const amount = (d) => (d.where === "tie" ? "any amount" : n2(d.x));
  strip.textContent = `x: ${amount(r.A)}${changed ? ` before, ${amount(r.C)} after` : ""}.${splitKnown ? ` Substitution ${fmt.signed(r.substitution, 2)}, income ${fmt.signed(r.income, 2)}.` : ""}`;
  const sentences = reading(r, px0, px1, py, m);
  words.textContent = sentences.join(" ");
  announce(sentences.join(" "));

  /* The basket diagram: budget lines, indifference curves, and the baskets A, B and C. */
  const marked = [r.A, ...(changed ? [r.C] : []), ...(splitKnown ? [r.B] : [])].filter((d) => d.where !== "tie");
  const top = axisMax(marked.flatMap((d) => [d.x, d.y]));
  const line = (name, income, price, colour, dash) => ({ name, type: "line", color: colour, width: 2, dash, hover: false, data: [[0, income / py], [income / price, 0]] });
  // Indifference curves are drawn wide and pale underneath, so one that runs along a budget line still shows.
  const curve = (name, u, colour) => ({ name, type: "line", color: colour, width: 4.5, opacity: 0.55, hover: false, data: indifferenceCurve(p, u, top, 200, top * 8) });
  const dots = [
    r.A.where === "tie" ? null : { x: r.A.x, y: r.A.y, label: "A: best basket before" },
    splitKnown ? { x: r.B.x, y: r.B.y, label: "B: best basket at the new price with income made up" } : null,
    changed && r.C.where !== "tie" ? { x: r.C.x, y: r.C.y, label: "C: best basket after" } : null,
  ].filter(Boolean);
  basketPlot.update({
    title: "Budget lines and the best basket",
    subtitle: "Each curve joins baskets the consumer likes equally. The best basket is where the budget line reaches the highest curve.",
    label: `Diagram of the budget lines, indifference curves and best baskets for ${describePrefs()}`,
    hover: "point", table: false,
    x: { label: "Quantity of x", domain: [0, top], format: quantity }, y: { label: "Quantity of y", domain: [0, top], format: quantity },
    series: [
      curve("Indifference curve through A", r.A.u, 0),
      ...(changed ? [curve("Indifference curve through C", r.C.u, 2)] : []),
      line("Budget line, before", m, px0, INK, false),
      ...(changed ? [line("Budget line, after", m, px1, 1, false)] : []),
      ...(splitKnown ? [line("Budget line with income made up", r.compensatedIncome, px1, GREY, true)] : []),
      { name: "Best baskets", type: "scatter", color: INK, r: 5, data: dots },
    ],
    marks: labels(dots, basketBox, top, top),
  });

  /* The demand curve: price on the vertical axis, as economists draw it. */
  const own = demandCurve(p, py, m, P_MIN, P_MAX).map((q) => ({ x: q.x, y: q.p, label: "Demand" }));
  const compensated = splitKnown || (!changed && r.A.where !== "tie")
    ? demandCurve(p, py, m, P_MIN, P_MAX, 120, state.method === "hicks" ? { u: r.A.u } : { x: r.A.x, y: r.A.y }).map((q) => ({ x: q.x, y: q.p, label: "Compensated demand" }))
    : [];
  const points = [
    r.A.where === "tie" ? null : { x: r.A.x, y: px0, label: "A: before" },
    splitKnown ? { x: r.B.x, y: px1, label: "B: at the new price with income made up" } : null,
    changed && r.C.where !== "tie" ? { x: r.C.x, y: px1, label: "C: after" } : null,
  ].filter(Boolean);
  const right = axisMax(points.map((d) => d.x));
  demandPlot.update({
    title: "The demand curve for x",
    subtitle: "The quantity of x in the best basket at each price of x, with income and the price of y held where they are. Price is on the vertical axis, as economists draw it.",
    label: `Demand curve for x under ${describePrefs()}, with the compensated demand curve through A`,
    hover: "point",
    x: { label: "Quantity of x", domain: [0, right], format: quantity }, y: { label: "Price of x", domain: [0, P_MAX], format: n2 },
    series: [
      ...(state.held ? [{ name: "Held curve", type: "line", color: GREY, width: 2, hover: false, data: state.held.data }] : []),
      { name: "Demand curve", type: "line", color: 0, width: 2.5, data: own },
      ...(compensated.length ? [{ name: state.method === "hicks" ? "Compensated: utility kept at A" : "Compensated: basket A kept affordable", type: "line", color: 1, width: 1.8, dash: true, data: compensated }] : []),
      { name: "Best baskets", type: "scatter", color: INK, r: 5, data: points },
    ],
    marks: labels(points, demandBox, right, P_MAX),
  });
  heldNote.textContent = state.held
    ? `The grey curve is the one held: ${state.held.text}. Move income, the price of y or the preferences and the blue curve moves away from it.`
    : "Press \"Hold this demand curve\", then change income, the price of y or the preferences, to see how far the curve moves.";

  /* The same three baskets as text. */
  const item = (letter, what, d, income, price) => el("li", {},
    el("strong", { text: `${letter}, ${what}: ` }),
    d.where === "tie"
      ? `no single basket. Every basket costing ${n2(income)} is equally good.`
      : `${basketWords(d)}. It costs ${n2(income)} at a price of ${n2(price)} for x, and its utility is ${n2(d.u)}.`);
  list.replaceChildren(...[
    item("A", "before", r.A, m, px0),
    splitKnown ? item("B", state.method === "hicks" ? "at the new price, with income made up to keep utility the same" : "at the new price, with income made up to keep basket A affordable", r.B, r.compensatedIncome, px1) : null,
    changed ? item("C", "after", r.C, m, px1) : null,
    el("li", { class: "muted", text: "Utility is only a ranking: a higher number means a basket the consumer prefers, and the size of the gap means nothing. Figures are rounded to two decimal places." }),
  ].filter(Boolean));
}

update();
// The labels are placed for the width the charts have now, so they are placed again when that changes.
let lastWidth = basketBox.clientWidth;
window.addEventListener("resize", debounce(() => { if (basketBox.clientWidth !== lastWidth) { lastWidth = basketBox.clientWidth; update(); } }, 200));
