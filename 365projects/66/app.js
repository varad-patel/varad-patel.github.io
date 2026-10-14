// Day 66: Black-Scholes Playground. Interface.
import { $, el, fmt, clamp, debounce, nextFrame, mount, segmented, select, button, stat, note, chart } from "../kit/kit.js";
import { YEAR_DAYS, LIMITS, readInputs, blackScholes, payoff, priceAt, breakEven, priceBounds, impliedVol, spotGrid } from "./logic.js";

mount();

/* ---------- formatting ---------- */
const money = (v, d = 2) => { const t = fmt.num(Math.abs(v), d); return v < 0 && /[1-9]/.test(t) ? `-$${t}` : `$${t}`; };
// Greeks span many sizes: four decimals, fewer once the number is large, so a column never runs to 14 digits.
const g4 = (v) => fmt.num(v, Math.abs(v) >= 1e5 ? 0 : Math.abs(v) >= 100 ? 2 : 4);
const daysText = (d) => (d === 1 ? "1 day" : `${fmt.sig(d, 4)} days`);
const pctText = (v) => `${fmt.sig(v, 4)}%`;

/* ---------- inputs: a number box and a slider for each ---------- */
const OPENING = { type: "call", S: 100, K: 100, days: 365, vol: 20, rate: 5, div: 0 };
const PRESETS = [
  { id: "open", label: "At the money, one year", values: OPENING },
  { id: "hull", label: "Hull's example", values: { type: "call", S: 42, K: 40, days: 182.5, vol: 20, rate: 10, div: 0 } },
  { id: "week", label: "A week to expiry", values: { type: "call", S: 100, K: 100, days: 7, vol: 20, rate: 5, div: 0 } },
  { id: "otm", label: "Out of the money put", values: { type: "put", S: 100, K: 90, days: 30, vol: 25, rate: 5, div: 1.5 } },
];
const SPEC = {
  S: { label: "Share price", unit: "$", slider: [1, 300, 0.5], hint: "The price of one share today." },
  K: { label: "Strike price", unit: "$", slider: [1, 300, 0.5], hint: "The price at which the option lets its holder buy (call) or sell (put)." },
  days: { label: "Days to expiry", unit: "days", slider: [1, 730, 1], hint: "Calendar days. The model counts 365 to a year." },
  vol: { label: "Volatility", unit: "% a year", slider: [1, 100, 0.5], hint: "Standard deviation of the share's yearly log return, assumed known and constant." },
  rate: { label: "Interest rate", unit: "% a year", slider: [-2, 15, 0.05], hint: "Risk-free, continuously compounded." },
  div: { label: "Dividend yield", unit: "% a year", slider: [0, 10, 0.05], hint: "Paid continuously. Use 0 for a share that pays none before expiry." },
};

const fields = {};
const changed = nextFrame(() => update());

function pair(key) {
  const spec = SPEC[key], lim = LIMITS[key];
  const id = `f66-${key}`;
  const [smin, smax, sstep] = spec.slider;
  const box = el("input", { type: "number", id, min: lim.min, max: lim.max, step: "any", value: OPENING[key], inputmode: lim.min >= 0 ? "decimal" : null, "aria-describedby": `${id}-hint ${id}-msg` });
  const range = el("input", { type: "range", min: smin, max: smax, step: sstep, value: clamp(OPENING[key], smin, smax), "aria-label": `${spec.label}, slider` });
  const readout = el("output", { for: id, class: "f66-readout" });
  const msg = el("div", { class: "f66-msg", id: `${id}-msg`, "aria-live": "polite" });
  const unitText = spec.unit === "$" ? "$" : spec.unit;
  const describe = (v) => (spec.unit === "$" ? money(v) : key === "days" ? daysText(v) : `${fmt.sig(v, 4)}${spec.unit}`);
  const sync = () => {
    const v = box.value.trim() === "" ? NaN : Number(box.value);
    // The slider reads out the value in use, even when a typed value lies beyond the slider's own range.
    range.setAttribute("aria-valuetext", Number.isFinite(v) ? `${describe(v)}${v < smin || v > smax ? ", beyond the slider's range" : ""}` : "");
    readout.textContent = key === "days" && Number.isFinite(v) && v > 0 ? `${fmt.num(v / YEAR_DAYS, v / YEAR_DAYS < 0.1 ? 4 : 2)} years` : "";
  };
  box.addEventListener("input", () => {
    const v = Number(box.value);
    if (box.value.trim() !== "" && Number.isFinite(v)) range.value = clamp(v, smin, smax);
    sync();
    changed();
  });
  range.addEventListener("input", () => {
    box.value = String(Number(range.value));
    sync();
    changed();
  });
  sync();
  const node = el("div", { class: "field f66-pair" },
    el("div", { class: "lab" }, el("label", { for: id, text: key === "days" ? spec.label : `${spec.label} (${unitText})` }), readout),
    box, range,
    el("div", { class: "hint", id: `${id}-hint`, text: spec.hint }), msg);
  fields[key] = {
    el: node, box, range, msg,
    get value() { return box.value.trim() === "" ? NaN : Number(box.value); },
    set value(v) { box.value = String(v); range.value = clamp(v, smin, smax); sync(); },
  };
  return node;
}

const typeSeg = segmented({
  label: "Option", value: OPENING.type,
  options: [{ value: "call", label: "Call: the right to buy" }, { value: "put", label: "Put: the right to sell" }],
  onChange: () => update(),
});

function applyPreset(values) {
  typeSeg.value = values.type;
  for (const key of Object.keys(SPEC)) fields[key].value = values[key];
  ivSeeded = false; // the example's own price, raised by a tenth, goes in the implied volatility box
  update();
}
const presetRow = el("div", { class: "row f66-presets", role: "group", "aria-label": "Examples" },
  PRESETS.map((p) => button(p.label, () => applyPreset(p.values), { small: true })));

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })), presetRow,
    el("div", { class: "hint", text: "\"At the money, one year\" is where the page opens." })),
  typeSeg.el, ...Object.keys(SPEC).map(pair));

/* ---------- outputs ---------- */
const sPrice = stat("Price");
const sDelta = stat("Delta");
const sGamma = stat("Gamma");
const sTheta = stat("Theta");
const status = el("p", { class: "sr-only", role: "status" });
const stale = el("div");
const payoffBox = el("div", { id: "f66-payoff" });
const greekHead = el("h2", { text: "All the Greeks" });
const greekNote = el("p", { class: "small muted" });
const greekTable = el("div", { class: "f66-rt-box" });
const checks = el("div", { class: "panel f66-stack" });
const profileBox = el("div");
const ivBox = el("div", { class: "panel f66-stack", id: "f66-ivbox" });
const advice = note("", "An illustration of the Black-Scholes-Merton model, not investment advice. Real option prices depart from it in the ways listed under \"What this cannot tell you\" below.");

const out = el("div", { class: "out" },
  el("div", { class: "stats", id: "f66-results" }, sPrice.el, sDelta.el, sGamma.el, sTheta.el), status, stale,
  payoffBox,
  el("div", { class: "f66-stack", id: "f66-greeks" }, greekHead, greekNote, greekTable),
  checks, profileBox, ivBox, advice);
// On a phone the controls fill the first screens, so the results are a jump away.
const jump = el("nav", { class: "row f66-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#f66-results", "price"], ["#f66-payoff", "payoff diagram"], ["#f66-greeks", "all the Greeks"], ["#f66-ivbox", "implied volatility"]]
    .map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));

const payoffChart = chart(payoffBox, { series: [], height: 330 });
const profileChart = chart(profileBox, { series: [], height: 300 });

/* ---------- the Greeks table ---------- */
// Each Greek in the units traders quote: per day, per percentage point. The model works per year and per 1.00.
// "what" is the change, "target" what it moves; amounts of money get a dollar sign.
const GREEKS = [
  { key: "delta", name: "Delta", scale: 1, what: "A $1 rise in the share price", target: "the option's value", money: true, ratio: true }, // a ratio, shown bare
  { key: "gamma", name: "Gamma", scale: 1, what: "A $1 rise in the share price", target: "delta" },
  { key: "theta", name: "Theta", scale: 1 / YEAR_DAYS, what: "Each calendar day that passes, with nothing else changing,", target: "the option's value", money: true },
  { key: "vega", name: "Vega", scale: 1 / 100, what: (vol) => `A one-point rise in volatility, from ${pctText(vol)} to ${pctText(vol + 1)},`, target: "the option's value", money: true },
  { key: "rho", name: "Rho", scale: 1 / 100, what: "A one-point rise in the interest rate", target: "the option's value", money: true },
  { key: "epsilon", name: "Epsilon (dividend rho)", scale: 1 / 100, what: "A one-point rise in the dividend yield", target: "the option's value", money: true },
  { key: "vanna", name: "Vanna", scale: 1 / 100, what: "A one-point rise in volatility", target: "delta" },
  { key: "vomma", name: "Vomma (volga)", scale: 1 / 10000, what: "A one-point rise in volatility", target: "vega (per point)", money: true },
  { key: "charm", name: "Charm", scale: 1 / YEAR_DAYS, what: "Each calendar day that passes", target: "delta" },
];
// A change too small to show at four decimals is said to be that small, rather than "raises it by about $0.0000".
const sentence = (g, v, vol) => {
  const what = typeof g.what === "function" ? g.what(vol) : g.what;
  const amount = (x) => (g.money ? money(x, 4) : g4(x));
  if (Math.abs(v) < 5e-5) return `${what} changes ${g.target} by less than ${g.money ? "$0.0001" : "0.0001"}.`;
  return `${what} ${v < 0 ? "lowers" : "raises"} ${g.target} by about ${amount(Math.abs(v))}.`;
};

function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl f66-rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {},
      columns.map((c, k) => el(k === 0 ? "th" : "td", { scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/* ---------- rendering ---------- */
let last = null; // the last valid inputs, so a half-typed box never blanks the results
const announce = debounce((text) => say(status, text), 600);
// A live region is rewritten only when its words change, so a screen reader is not told the same thing twice.
function say(node, text) { if (node.textContent !== text) node.textContent = text; }

function readAll() {
  return readInputs(Object.fromEntries(Object.keys(SPEC).map((k) => [k, fields[k].value])));
}

function update() {
  const type = typeSeg.value;
  const r = readAll();
  for (const key of Object.keys(SPEC)) {
    const err = r.ok ? null : r.errors.find((e) => e.key === key);
    say(fields[key].msg, err ? err.message : "");
    fields[key].box.classList.toggle("invalid", Boolean(err));
    if (err) fields[key].box.setAttribute("aria-invalid", "true"); else fields[key].box.removeAttribute("aria-invalid");
  }
  if (r.ok) last = { p: r.p, raw: Object.fromEntries(Object.keys(SPEC).map((k) => [k, fields[k].value])) };
  if (!last) return;
  const staleText = r.ok ? "" : `Fix the box marked in red. Until then the results show the last inputs that worked: share ${money(last.p.S)}, strike ${money(last.p.K)}, ${daysText(last.raw.days)}, volatility ${pctText(last.raw.vol)}, interest ${pctText(last.raw.rate)}, dividends ${pctText(last.raw.div)}.`;
  // The alert is rewritten only when its words change, or a screen reader would repeat it at every keystroke.
  if (stale.textContent !== staleText) stale.replaceChildren(...(staleText ? [note("bad", staleText)] : []));
  render(type, last.p, last.raw);
}

function render(type, p, raw) {
  const b = blackScholes(p);
  const o = b[type];
  const other = type === "call" ? "put" : "call";
  const name = type === "call" ? "call" : "put";
  const intrinsic = payoff(type, p.K, p.S);
  sPrice.set(money(o.price), `per share, a ${name}. Intrinsic ${money(intrinsic)}, time value ${money(o.price - intrinsic)}.`);
  sDelta.set(fmt.num(o.delta, 4), `${money(o.delta, 2)} per $1 on the share`);
  sGamma.set(g4(o.gamma), "change in delta per $1");
  sTheta.set(money(o.theta / YEAR_DAYS, 4), "per calendar day");

  // Payoff diagram: profit per share of buying one option at the model price, ignoring interest on the premium.
  const be = breakEven(type, p.K, o.price);
  const xs = spotGrid(p.S, p.K, be ? [be] : []);
  const half = p.T / 2;
  const profit = (fn) => xs.map((x) => [x, fn(x) - o.price]);
  payoffChart.update({
    title: `Profit from buying one ${name} at ${money(o.price)}`,
    subtitle: `Per share, against the share price. At expiry the ${name} pays its payoff; before then it is worth the model price. Interest on the premium is ignored.`,
    label: `Line chart of the profit from buying one ${name}, at expiry, halfway to expiry and today, against the share price`,
    x: { label: "Share price ($)", format: (v) => fmt.sig(v, 4) },
    y: { label: "Profit per share ($)", format: (v) => fmt.sig(v, 4) },
    series: [
      { name: "Today", type: "line", data: profit((x) => priceAt(p, type, x)), color: 0 },
      { name: `Halfway, ${daysText(raw.days / 2)} left`, type: "line", data: profit((x) => priceAt(p, type, x, half)), color: 2, dash: true },
      { name: "At expiry", type: "line", data: profit((x) => payoff(type, p.K, x)), color: "#16233b" },
    ],
    marks: [
      { type: "hline", y: 0 },
      { type: "vline", x: p.K, text: `Strike ${money(p.K)}` },
      { type: "vline", x: p.S, text: `Share now ${money(p.S)}` },
      // The label sits below the zero line on the side where the profit lines are above it, so neither crosses it.
      ...(be ? [{ type: "point", x: be, y: 0 }, { type: "text", x: be, y: 0, dx: type === "call" ? 9 : -9, dy: 16, anchor: type === "call" ? "start" : "end", text: `Break-even ${money(be)}` }] : []),
    ],
  });

  // Greeks table.
  greekNote.textContent = `For one ${name} on one share. Delta, gamma, vega and theta lead the list; vanna, vomma and charm are second-order: they say how the hedge ratios themselves move.`;
  greekTable.replaceChildren(listTable({
    caption: `Greeks of the ${name}`,
    columns: [
      { label: "Greek", get: (g) => g.name },
      { label: "Value", num: true, get: (g) => (g.money && !g.ratio ? money(g.value, 4) : g4(g.value)) },
      { label: "What it means", get: (g) => sentence(g, g.value, raw.vol) },
    ],
    rows: GREEKS.map((g) => ({ ...g, value: o[g.key] * g.scale })),
  }));

  // Checks the visitor can do by hand: parity and the two d values.
  const lhs = b.call.price - b.put.price;
  checks.replaceChildren(
    el("h2", { text: "Two checks you can do by hand" }),
    el("p", { class: "small" }, el("strong", { text: "Put-call parity. " }),
      `Call minus put = ${money(b.call.price)} - ${money(b.put.price)} = ${money(lhs)}. Share price less dividends, minus the strike's present value = ${money(b.fwdS)} - ${money(b.pvK)} = ${money(b.fwdS - b.pvK)}. They must agree whatever the volatility, or one could be bought and the other sold for a riskless profit. The ${other} is worth ${money(b[other].price)}.`),
    el("p", { class: "small" }, el("strong", { text: "The two d values. " }),
      `d1 = ${fmt.num(b.d1, 4)} and d2 = ${fmt.num(b.d2, 4)}. N(d2) = ${fmt.num(b.N2, 4)} is the chance the call ends in the money if the share's price grew at the interest rate less the dividend yield, rather than at its true expected rate (the "risk-neutral" probability), so it is not a forecast. For the put it is N(-d2) = ${fmt.num(1 - b.N2, 4)}.`));

  drawProfile(type, p, raw);
  drawIv(type, p, o.price);

  announce(`${name === "call" ? "Call" : "Put"} worth ${money(o.price)} per share. Delta ${fmt.num(o.delta, 3)}, gamma ${g4(o.gamma)}, theta ${money(o.theta / YEAR_DAYS, 4)} a day, vega ${money(o.vega / 100, 4)} per volatility point.`);
}

/* ---------- a Greek across share prices, at three times to expiry ---------- */
const PROFILE = [
  { value: "delta", label: "Delta", scale: 1, unit: "per $1" },
  { value: "gamma", label: "Gamma", scale: 1, unit: "per $1" },
  { value: "theta", label: "Theta", scale: 1 / YEAR_DAYS, unit: "$ per day" },
  { value: "vega", label: "Vega", scale: 1 / 100, unit: "$ per volatility point" },
  { value: "rho", label: "Rho", scale: 1 / 100, unit: "$ per rate point" },
  { value: "price", label: "Price", scale: 1, unit: "$" },
];
const profilePick = select({ label: "Plot this Greek against the share price", value: "gamma", options: PROFILE.map((g) => ({ value: g.value, label: g.label })), onChange: () => update() });
profileBox.prepend(profilePick.el);

function drawProfile(type, p, raw) {
  const g = PROFILE.find((x) => x.value === profilePick.value);
  const xs = spotGrid(p.S, p.K);
  const lives = [1, 1 / 4, 1 / 16];
  profileChart.update({
    title: `${g.label} of the ${type} against the share price`,
    subtitle: "The same option with the time left as set, a quarter of it and a sixteenth. Near expiry, gamma and theta crowd around the strike.",
    label: `Line chart of the ${g.label.toLowerCase()} of the ${type} against the share price at three times to expiry`,
    x: { label: "Share price ($)", format: (v) => fmt.sig(v, 4) },
    y: { label: `${g.label} (${g.unit})`, format: (v) => fmt.sig(v, 3) },
    series: lives.map((f, i) => ({
      name: `${daysText(raw.days * f)} left`, type: "line", color: i,
      data: xs.map((x) => [x, blackScholes({ ...p, S: x, T: p.T * f })[type][g.value] * g.scale]),
    })),
    marks: [{ type: "vline", x: p.K, text: "Strike" }, { type: "vline", x: p.S, text: "Share now" }],
  });
}

/* ---------- implied volatility ---------- */
const ivId = "f66-iv";
const ivInput = el("input", { type: "number", id: ivId, min: 0, step: "any", inputmode: "decimal", "aria-describedby": `${ivId}-out` });
// Not a live region: it follows every slider. Typing a price announces the answer once, after a pause.
const ivOut = el("p", { class: "small", id: `${ivId}-out` });
const ivSay = debounce(() => say(status, ivOut.textContent), 600);
let ivSeeded = false;
ivInput.addEventListener("input", () => { update(); ivSay(); });
ivBox.append(
  el("h2", { text: "What volatility does a price imply?" }),
  el("p", { class: "small muted", text: "Type a price for this option, such as one quoted in a market. The tool finds the volatility at which the model gives that price, using every input above except the volatility." }),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: ivId, text: "Option price ($ per share)" })), ivInput),
  ivOut);

function drawIv(type, p, modelPrice) {
  if (!ivSeeded) { ivInput.value = fmt.num(modelPrice * 1.1, 2).replace(/,/g, ""); ivSeeded = true; }
  const raw = ivInput.value.trim();
  const price = raw === "" ? NaN : Number(raw);
  ivInput.classList.remove("invalid");
  ivInput.removeAttribute("aria-invalid");
  const bad = (text) => { ivInput.classList.add("invalid"); ivInput.setAttribute("aria-invalid", "true"); ivOut.textContent = text; };
  if (raw === "") { ivOut.textContent = "Type a price to see the volatility it implies."; return; }
  if (!Number.isFinite(price) || price < 0 || price > 1e7) { bad("Enter a price of zero or more, in dollars per share."); return; }
  const r = impliedVol(price, p, type);
  const name = type;
  // A bound is shown to four decimals when two would make it look the same as the price typed.
  const bound = (v) => (money(v) === money(price) ? money(v, 4) : money(v));
  if (r.error === "below-floor" && r.low === 0) bad(`No volatility gives ${money(price)}: at any volatility above zero a ${name} is worth something, because it can pay out and can never cost its holder more.`);
  else if (r.error === "below-floor") bad(`No volatility gives ${money(price)}: a ${name} on these terms is worth more than ${bound(r.low)} whatever the volatility, because buying it and ${type === "call" ? "selling the share" : "buying the share"} would otherwise lock in a profit.`);
  else if (r.error === "above-ceiling") bad(`No volatility gives ${money(price)}: a ${name} on these terms is always worth less than ${bound(r.high)}, ${type === "call" ? "the share's own price less the dividends it will pay" : "the present value of the strike"}.`);
  else if (r.error === "too-low") bad(`${money(price)} implies a volatility below ${pctText(r.limit * 100)} a year, the lowest this tool searches; at that volatility the model price is ${money(r.priceAtLimit, 4)}.`);
  else if (r.error === "too-high") bad(`${money(price)} implies a volatility above ${pctText(r.limit * 100)} a year, the highest this tool searches; at that volatility the model price is ${money(r.priceAtLimit, 4)}.`);
  else if (r.error) bad("Enter a price of zero or more, in dollars per share.");
  else {
    // Where the price barely moves with volatility (near expiry, deep in or out of the money), a quote rounded to
    // the cent pins the volatility down only loosely: say how loosely, from prices half a cent either side.
    const near = [price - 0.005, price + 0.005].map((x) => impliedVol(x, p, type).sigma);
    const spread = near.every(Number.isFinite) && near[1] - near[0] > 0.01
      ? ` Prices within half a cent of it imply anything from ${fmt.num(near[0] * 100, 2)}% to ${fmt.num(near[1] * 100, 2)}%, so here the answer is only as precise as the price.` : "";
    ivOut.textContent = `A price of ${money(price)} implies a volatility of ${fmt.num(r.sigma * 100, 2)}% a year, against the ${pctText(p.sigma * 100)} set above.${spread} Quotes for different strikes of the same share usually imply different volatilities, which the model says should not happen.`;
  }
}

update();
