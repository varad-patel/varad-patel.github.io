// Day 71: News and Markets Event Study. Interface.
import { $, el, fmt, mount, slider, select, button, checkbox, stat, note, table, chart, debounce } from "../kit/kit.js";
import { FX } from "./data.js";
import { EVENTS, LIMITS, LINKED, decode, eventStudy, verdict } from "./logic.js";

mount();

const D = decode(FX);
const first = D.dates[0], last = D.dates.at(-1);
const codes = Object.keys(D.meta);
const nameOf = (c) => `${D.meta[c].name} (${c})`;
const pct = (v, d = 2) => `${fmt.signed(100 * v, d)}%`;
const DEFAULT = EVENTS.find((e) => e.id === "gbp2016");
const state = { id: DEFAULT.id, code: DEFAULT.code, date: DEFAULT.day0, est: 250, win: [...DEFAULT.win], exclude: [...(DEFAULT.exclude || [])] };

/* ---------- controls ---------- */
const eventSel = select({
  label: "Event",
  value: state.id,
  options: [...EVENTS.map((e) => ({ value: e.id, label: `${e.day0.slice(0, 4)}: ${e.title} (${e.code})` })), { value: "own", label: "Your own date and currency" }],
  onChange: (v) => {
    state.id = v;
    const e = EVENTS.find((x) => x.id === v);
    if (e) { state.code = e.code; state.date = e.day0; state.win = [...e.win]; state.exclude = [...(e.exclude || [])]; codeSel.value = e.code; dateIn.value = e.day0; setWin(); }
    ownBox.hidden = v !== "own";
    run();
  },
});
const codeSel = select({ label: "Currency", value: state.code, options: codes.map((c) => ({ value: c, label: nameOf(c) })), onChange: (v) => { state.code = v; run(); } });
const dateId = "d71-date";
const dateIn = el("input", { type: "date", id: dateId, min: first, max: last, value: state.date });
const dateHint = el("div", { class: "hint", text: `Any day from ${fmt.date(first)} to ${fmt.date(last)}. Day 0 is the first New York noon rate on or after it: if the news came out after noon in New York, give the next business day.` });
dateIn.addEventListener("change", () => { state.date = dateIn.value; run(); });
const ownBox = el("div", { class: "stack" }, codeSel.el, el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: dateId, text: "Day of the news" })), dateIn, dateHint));
ownBox.hidden = true;

const estSlider = slider({
  label: "Estimation window", min: 60, max: 750, step: 10, value: state.est,
  format: (v) => `${fmt.int(v)} trading days`,
  hint: "The days just before the event window on which the market model is fitted. 250 is about a year.",
  onInput: debounce((v) => { state.est = v; run(); }, 120),
});
const fromSlider = slider({ label: "Event window starts on day", min: LIMITS.winMin, max: LIMITS.winMax, step: 1, value: state.win[0], format: (v) => fmt.signed(v, 0), onInput: (v) => { state.win[0] = v; run(); } });
const toSlider = slider({ label: "Event window ends on day", min: LIMITS.winMin, max: LIMITS.winMax, step: 1, value: state.win[1], format: (v) => fmt.signed(v, 0), onInput: (v) => { state.win[1] = v; run(); } });
const setWin = () => { fromSlider.value = state.win[0]; toSlider.value = state.win[1]; };
const presets = el("div", { class: "row", role: "group", "aria-label": "Event window presets" },
  [[[0, 0], "Day 0"], [[0, 1], "0 to +1"], [[-1, 1], "-1 to +1"], [[-5, 5], "-5 to +5"], [[-20, 20], "-20 to +20"]].map(([w, label]) =>
    button(label, () => { state.win = [...w]; setWin(); run(); fromSlider.input.focus(); }, { small: true, title: `Event window from day ${w[0]} to day ${w[1]}` })));
/* The basket: a tick box per member; the currency studied, and one pegged to it throughout, cannot be ticked. */
const basketCodes = codes.filter((c) => D.meta[c].basket);
const basketBoxes = basketCodes.map((c) => {
  const box = checkbox({ label: nameOf(c), checked: true, onChange: (on) => { state.exclude = on ? state.exclude.filter((x) => x !== c) : [...state.exclude, c]; run(); } });
  box.note = el("span", { class: "small muted" });
  box.el.lastChild.append(box.note);
  return { code: c, box };
});
function syncBasket() {
  for (const { code, box } of basketBoxes) {
    const why = code === state.code ? "the currency studied" : (LINKED[state.code] || []).includes(code) ? `pegged to the ${D.meta[state.code].name}` : "";
    box.input.disabled = Boolean(why);
    box.checked = !why && !state.exclude.includes(code);
    box.note.textContent = why ? ` (left out: ${why})` : "";
  }
}
const basketField = el("fieldset", { class: "field basket71" }, el("legend", { class: "lab", text: "Basket of other currencies" }),
  ...basketBoxes.map((b) => b.box.el),
  el("div", { class: "hint", text: "Its average daily change is the market return. Untick a currency that was tied to the one you study, or that had news of its own in the event window; each built-in event says which it leaves out and why." }));
const controls = el("div", { class: "controls" }, eventSel.el, ownBox, estSlider.el, fromSlider.el, toSlider.el, presets, basketField);

/* ---------- outputs ---------- */
const sCar = stat("Abnormal return over the window");
const sT = stat("Test statistic");
const sRaw = stat("Actual change against the dollar");
const sBeta = stat("Market model");
const status = el("p", { class: "sr-only", role: "status" });
const about = el("div", { class: "event-about" });
const message = el("div");
const carBox = el("div"), fitBox = el("div"), dayBox = el("div");
const out = el("div", { class: "out" }, about, el("div", { class: "stats" }, sCar.el, sT.el, sRaw.el, sBeta.el), status, message, carBox, dayBox, fitBox);
const sourceNote = el("p", { class: "small muted source-note", text: `Exchange rates: ${FX.source.name}, noon buying rates in New York, ${fmt.date(first)} to ${fmt.date(last)}, retrieved ${fmt.date(FX.retrieved)}. In the public domain: "information on Board's website is in the public domain and may be copied and distributed without permission".` });
$("#app").append(el("div", { class: "tool-grid" }, controls, out), sourceNote);

const carChart = chart(carBox, { series: [], height: 280 });
const fitChart = chart(fitBox, { series: [], height: 280 });

/* ---------- running it ---------- */
function stackable(wrap) {
  const t = wrap.querySelector("table");
  t.classList.add("rt");
  const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent);
  for (const tr of t.querySelectorAll("tbody tr")) [...tr.children].forEach((td, k) => td.setAttribute("data-label", heads[k]));
  return wrap;
}

function describe() {
  const e = EVENTS.find((x) => x.id === state.id);
  if (!e) {
    about.replaceChildren(el("p", { class: "small" }, el("strong", { text: "Your own event. " }), `${nameOf(state.code)}, news on ${state.date ? fmt.date(state.date) : "a date still to choose"}.`));
    return;
  }
  about.replaceChildren(
    el("p", {}, el("strong", { text: e.title }), ` (${nameOf(e.code)}). ${e.when}.`),
    el("p", { class: "small muted", text: e.note }),
    el("p", { class: "small muted" }, "Source for the date: ", el("a", { href: e.url, rel: "noopener", text: e.source }), "."));
}

function blank(msg) {
  message.replaceChildren(note("bad", msg));
  status.textContent = msg;
  for (const s of [sCar, sT, sRaw, sBeta]) s.set("–", "");
  carChart.update({ series: [], marks: [], empty: "No result: see the message above" });
  fitChart.update({ series: [], marks: [], empty: "No result" });
  dayBox.replaceChildren();
}

function run() {
  describe();
  syncBasket();
  if (state.win[0] > state.win[1]) { blank(`The event window starts on day ${fmt.signed(state.win[0], 0)} but ends on day ${fmt.signed(state.win[1], 0)}. Move the start back or the end forward.`); return; }
  if (!state.date) { blank("Choose the day of the news."); return; }
  if (state.date < first || state.date > last) { blank(`Choose a day from ${fmt.date(first)} to ${fmt.date(last)}: the data cover only those years.`); return; }
  const r = eventStudy(D, { code: state.code, date: state.date, est: state.est, win: state.win, exclude: state.exclude });
  if (r.error) { blank(r.error); return; }
  const [t1, t2] = r.win;
  const range = t1 === t2 ? `day ${fmt.signed(t1, 0)}` : `days ${fmt.signed(t1, 0)} to ${fmt.signed(t2, 0)}`;
  const len = t2 - t1 + 1;
  const word = verdict(r.p);
  sCar.set(pct(r.car), `${range}, standard error ${fmt.num(100 * r.seCar, 2)} points`);
  sT.set(fmt.num(r.scar, 2), `${r.p < 0.0001 ? "p below 0.0001" : `p = ${fmt.num(r.p, 4)}`}, Student's t with ${fmt.int(r.df)} degrees of freedom`);
  sRaw.set(pct(r.raw), `the basket of other currencies (${r.basket.join(", ")}): ${pct(r.market)}`);
  sBeta.set(`β ${fmt.num(r.beta, 2)}`, `R² ${fmt.num(r.r2, 2)}, daily residual ${fmt.num(100 * r.sigma, 2)}%, fitted ${fmt.date(r.est.from)} to ${fmt.date(r.est.to)}`);
  const lines = [
    `Day 0 is ${fmt.date(r.eventDay)}. ${t1 === t2 ? "On" : "Over"} ${range} the ${r.name} moved ${pct(r.raw)} against the dollar; the market model expected ${pct(r.raw - r.car)} from the moves of the other currencies, so the abnormal return is ${pct(r.car)}.`,
    `The test statistic is ${fmt.num(r.scar, 2)}: ${word}.`,
    `A check that does not lean on the normal distribution: ${len === 1 ? "on" : "in"} ${fmt.int(r.empirical.asBig)} of the ${fmt.int(r.empirical.windows)} ${len === 1 ? "days" : `stretches of ${len} days`} in the estimation window was the unexplained move at least as large.`,
  ];
  message.replaceChildren(...[
    note(r.p < 0.05 ? "good" : "", lines[0], " ", el("strong", { text: lines[1] }), " ", lines[2]),
    ...r.tied.map((g) => note("warn", `The ${D.meta[g.member].name} is in the basket, but ${g.why}, inside this study's estimation window: it moved with the ${r.name}, so the market model treats part of the ${r.name}'s own moves as the market's. Untick it to leave it out.`)),
    r.pegged ? note("warn", `The ${r.name} barely moved against the basket in the estimation window (daily residual ${fmt.num(100 * r.sigma, 3)}%): it was held by its central bank. Against so little noise any move looks enormous, so the size of the test statistic says the peg changed, not how big the news was.`) : null,
    r.basketSize < r.basketFull ? note("warn", `On some days of the estimation window only ${r.basketSize} of the ${r.basketFull} basket currencies had a rate, so the market return rests on fewer currencies there.`) : null].filter(Boolean));
  status.textContent = `${r.name}, day 0 ${fmt.date(r.eventDay)}. Abnormal return over ${range}: ${pct(r.car)}, test statistic ${fmt.num(r.scar, 2)}, ${word}.`;

  const lo = (p) => p.car - 1.96 * p.se, hi = (p) => p.car + 1.96 * p.se;
  carChart.update({
    title: "Cumulative abnormal return",
    subtitle: "Log changes in percent, summed from the first day of the event window. The band is ±1.96 standard errors: where it leaves zero, the move is significant at 5% if the returns are normal.",
    label: `Line chart of the cumulative abnormal return of the ${r.name} over ${range}`,
    x: { label: "Trading day relative to the event", domain: [t1 - 0.5, t2 + 0.5], format: (v) => fmt.signed(v, 0), ticks: Math.min(len, 8) },
    y: { label: "Percent", format: (v) => `${fmt.signed(v, 1)}`, zero: true },
    series: [
      { name: "95% band", type: "range", data: r.path.map((p) => [p.tau, 100 * lo(p), 100 * hi(p)]), color: 0, opacity: 0.16 },
      { name: "Abnormal (cumulative)", type: "line", data: r.path.map((p) => [p.tau, 100 * p.car]), color: 0 },
      { name: "Actual (cumulative)", type: "line", data: (() => { let s = 0; return r.days.map((d) => [d.tau, 100 * (s += d.r)]); })(), color: "#8a94a3", dash: true },
    ],
    marks: [{ type: "vline", x: 0, text: "Day 0" }],
  });

  dayBox.replaceChildren(stackable(table({
    caption: "Day by day (log changes in percent; t is the abnormal return over its standard error)",
    columns: [
      { key: "tau", label: "Day" }, { key: "date", label: "Date" },
      { key: "r", label: "Actual", num: true }, { key: "m", label: "Basket", num: true }, { key: "normal", label: "Expected", num: true },
      { key: "ar", label: "Abnormal", num: true }, { key: "t", label: "t", num: true },
    ],
    rows: r.days.map((d) => ({ tau: fmt.signed(d.tau, 0), date: fmt.date(d.date), r: pct(d.r), m: pct(d.m), normal: pct(d.normal), ar: pct(d.ar), t: fmt.num(d.t, 2) })),
  })));

  const xs = r.estimation.map((e) => 100 * e.m);
  const x0 = Math.min(...xs, ...r.days.map((d) => 100 * d.m)), x1 = Math.max(...xs, ...r.days.map((d) => 100 * d.m));
  fitChart.update({
    title: "The market model behind the expected returns",
    subtitle: "Each grey dot is a day of the estimation window; the line is the fit. The coloured dots are the event window.",
    label: `Scatter chart of the daily return of the ${r.name} against the basket, with the fitted line and the event days`,
    hover: "point",
    x: { label: "Basket of other currencies, daily change (%)", format: (v) => fmt.num(v, 1) },
    y: { label: `${r.code}, daily change (%)`, format: (v) => fmt.num(v, 1) },
    series: [
      { name: "Estimation days", type: "scatter", data: r.estimation.map((e) => ({ x: 100 * e.m, y: 100 * e.r, label: fmt.date(e.date) })), color: "#8a94a3", r: 2.4 },
      { name: "Fitted line", type: "line", data: [[x0, 100 * (r.alpha + r.beta * x0 / 100)], [x1, 100 * (r.alpha + r.beta * x1 / 100)]], color: "#16233b", hover: false },
      { name: "Event window", type: "scatter", data: r.days.map((d) => ({ x: 100 * d.m, y: 100 * d.r, label: `Day ${fmt.signed(d.tau, 0)}, ${fmt.date(d.date)}` })), color: 7, r: 4.5 },
    ],
  });
}

run();
