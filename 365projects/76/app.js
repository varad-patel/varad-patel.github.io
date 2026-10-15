// Day 76: Time Preference from Bond Yields. Interface.
import { $, el, fmt, mount, slider, button, stat, note, chart, debounce } from "../kit/kit.js";
import { CURVES } from "./data.js";
import { LIMITS, zeroYield, forwardRate, discount, covers, checkPrefs, at, halfLife, history, extremes, growthStats } from "./logic.js";

mount();

/* ---------- formatting ---------- */
const pct = (v, d = 2) => `${fmt.num(v, d)}%`;
const dollars = (v) => `$${fmt.num(v, 2)}`;
const years = (n) => `${fmt.int(n)} ${n === 1 ? "year" : "years"}`;
const adj = (n) => `${fmt.int(n)}-year`;
const day = (iso) => fmt.date(iso);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Dates on the history chart are decimal years; ticks are whole years and points name their month.
const decimalYear = (iso) => { const [y, m, d] = iso.split("-").map(Number); return y + (m - 1) / 12 + (d - 1) / 365; };
const XS = CURVES.dates.map(decimalYear);
const nearestIndex = (x) => XS.reduce((best, v, i) => (Math.abs(v - x) < Math.abs(XS[best] - x) ? i : best), 0);
const yearTick = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : (() => { const d = CURVES.dates[nearestIndex(v)]; return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`; })());

const LAST = CURVES.dates.length - 1;
const BEA = { recent: growthStats(CURVES.consumption, 1999, 2025), long: growthStats(CURVES.consumption, 1949, 2025) };
const round2 = (v) => Number(v.toFixed(2));
const OPENING = { horizon: 10, date: LAST, eta: 1, mu: round2(BEA.recent.mean), sigma: round2(BEA.recent.sd) };
const state = { ...OPENING, prefs: { eta: OPENING.eta, mu: OPENING.mu, sigma: OPENING.sigma } };

/* ---------- controls ---------- */
const horizon = slider({
  label: "Horizon", min: LIMITS.horizon.min, max: LIMITS.horizon.max, step: 1, value: OPENING.horizon, format: years,
  hint: "How far ahead the payment falls. Inflation-protected (real) yields are published for 2 to 20 years, ordinary (nominal) ones for 1 to 30.",
  onInput: (v) => { state.horizon = v; draw(); },
});
const when = slider({
  label: "Curve date", min: 0, max: LAST, step: 1, value: OPENING.date, format: (i) => day(CURVES.dates[i]),
  hint: `The last trading day of each month from January 1999, then the latest day published (${day(CURVES.latest)}).`,
  onInput: (v) => { state.date = v; draw(); },
});
const jumpLatest = button("Latest", () => setDate(LAST), { small: true });
const jumpLow = button("Lowest real yield", () => { const e = extremes(CURVES, state.horizon); if (e) setDate(e.lowest.i); }, { small: true });
const jumpHigh = button("Highest real yield", () => { const e = extremes(CURVES, state.horizon); if (e) setDate(e.highest.i); }, { small: true });
const jumpHint = el("div", { class: "hint" });
function setDate(i) { state.date = i; when.value = i; draw(); }

// The three Ramsey inputs: number boxes with their own messages.
const boxes = {};
function numberBox(key, label, hint, lim) {
  const id = `d76-${key}`;
  const input = el("input", { type: "number", id, value: OPENING[key], min: lim.min, max: lim.max, step: "any", inputmode: lim.min >= 0 ? "decimal" : null, "aria-describedby": `${id}-hint ${id}-msg` });
  input.addEventListener("input", () => readPrefs());
  boxes[key] = input;
  return el("div", { class: "field" },
    el("div", { class: "lab" }, el("label", { for: id, text: label })), input,
    el("div", { class: "hint", id: `${id}-hint`, text: hint }),
    el("div", { class: "d76-msg", id: `${id}-msg`, "aria-live": "polite" }));
}
const etaField = numberBox("eta", "η, how fast extra consumption loses value", "Elasticity of marginal utility, 0 to 5. With η = 1 (log utility), a 1% richer future person values an extra dollar 1% less.", LIMITS.eta);
const muField = numberBox("mu", "μ, expected growth of consumption per person (% a year)", "Mean growth of log consumption. Default: US real consumption per person, 1999 to 2025 (BEA).", LIMITS.growth);
const sigmaField = numberBox("sigma", "σ, its standard deviation (% a year)", "How much yearly growth varies. It adds a precautionary term ½η²σ², small unless η or σ is large.", LIMITS.sigma);
const setPrefs = (p) => { for (const k of ["eta", "mu", "sigma"]) if (p[k] != null) boxes[k].value = String(p[k]); readPrefs(); };
const etaPresets = el("div", { class: "row d76-presets", role: "group", "aria-label": "Values of η" },
  button("η = 1, the Stern Review", () => setPrefs({ eta: 1 }), { small: true }),
  button("η = 2.25, Nordhaus's recalibration", () => setPrefs({ eta: 2.25 }), { small: true }));
const growthPresets = el("div", { class: "row d76-presets", role: "group", "aria-label": "Growth figures" },
  button(`BEA 1999 to 2025: ${pct(BEA.recent.mean)}, σ ${pct(BEA.recent.sd)}`, () => setPrefs({ mu: round2(BEA.recent.mean), sigma: round2(BEA.recent.sd) }), { small: true }),
  button(`BEA 1949 to 2025: ${pct(BEA.long.mean)}, σ ${pct(BEA.long.sd)}`, () => setPrefs({ mu: round2(BEA.long.mean), sigma: round2(BEA.long.sd) }), { small: true }));
const resetBtn = button("Back to the opening settings", () => {
  horizon.value = OPENING.horizon; state.horizon = OPENING.horizon;
  setDate(OPENING.date);
  setPrefs(OPENING);
}, { small: true });

const controls = el("div", { class: "controls" },
  horizon.el,
  when.el,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Jump to" })),
    el("div", { class: "row d76-presets", role: "group", "aria-label": "Jump to a date" }, jumpLatest, jumpLow, jumpHigh), jumpHint),
  el("fieldset", { class: "d76-set" },
    el("legend", { text: "The Ramsey equation's other terms" }),
    el("p", { class: "small muted", text: "Assumptions, not market data. The tool works out the pure time preference ρ that they and the real yield imply." }),
    etaField, etaPresets, muField, sigmaField, growthPresets),
  el("div", { class: "row" }, resetBtn));

/* ---------- outputs ---------- */
const sNominal = stat("$100 due at the horizon costs today");
const sReal = stat("$100 of today's buying power, delivered then, costs");
const sBreak = stat("Inflation compensation");
const sRho = stat("Implied pure time preference ρ");
const paused = el("div");
const words = el("p", { class: "d76-words" });
const status = el("p", { class: "sr-only", role: "status" });
const tableHead = el("h2", { id: "d76-table" });
const tableBox = el("div", { class: "d76-rt-box" });
const curveBox = el("div", { id: "d76-curves" });
const rateBox = el("div");
const histBox = el("div", { id: "d76-history" });
const out = el("div", { class: "out" },
  paused,
  el("div", { class: "stats", id: "d76-results" }, sNominal.el, sReal.el, sBreak.el, sRho.el),
  words, status,
  el("div", { class: "d76-stack" }, tableHead, tableBox),
  curveBox, rateBox, histBox,
  note("", "Yields are estimates fitted by Federal Reserve Board staff to Treasury prices, not quoted prices. An illustration of the method, not investment advice."));
const jump = el("nav", { class: "row d76-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d76-results", "the prices"], ["#d76-table", "what the yield is made of"], ["#d76-curves", "the curves"], ["#d76-history", "the history"]].map(([href, text]) => el("a", { href, class: "small", text })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));

const curveChart = chart(curveBox, { series: [], height: 300 });
const rateChart = chart(rateBox, { series: [], height: 280 });
const histChart = chart(histBox, { series: [], height: 300 });

/* ---------- reading the Ramsey inputs ---------- */
function readPrefs() {
  const read = (k) => (boxes[k].value.trim() === "" ? NaN : Number(boxes[k].value));
  const p = { eta: read("eta"), mu: read("mu"), sigma: read("sigma") };
  const { ok, errors } = checkPrefs(p);
  for (const k of ["eta", "mu", "sigma"]) {
    const e = errors.find((x) => x.key === k);
    const msg = $(`#d76-${k}-msg`);
    if (msg.textContent !== (e ? e.message : "")) msg.textContent = e ? e.message : "";
    boxes[k].classList.toggle("invalid", Boolean(e));
    if (e) boxes[k].setAttribute("aria-invalid", "true"); else boxes[k].removeAttribute("aria-invalid");
  }
  paused.replaceChildren(...(ok ? [] : [note("warn", "Fix the box marked in red; ρ below uses the last values that worked.")]));
  if (ok) state.prefs = p;
  draw();
}

/* ---------- drawing ---------- */
const say = debounce((text) => { if (status.textContent !== text) status.textContent = text; }, 500);

function draw() {
  const n = state.horizon, i = state.date, p = state.prefs;
  const a = at(CURVES, i, n, p);
  const date = day(a.date);
  const realOk = Boolean(a.real);
  const ext = extremes(CURVES, n);
  jumpLow.disabled = jumpHigh.disabled = !ext;
  jumpHint.textContent = ext
    ? `At ${years(n)} the real yield was lowest on ${day(ext.lowest.date)} (${pct(ext.lowest.y)}) and highest on ${day(ext.highest.date)} (${pct(ext.highest.y)}).`
    : `The real curve covers 2 to 20 years, so there is no real yield at ${years(n)}.`;

  sNominal.set(dollars(100 * a.nominal.P), `${years(n)} ahead: ${pct(a.nominal.y)} a year, continuously compounded (${pct(a.nominal.annual)} compounded yearly)`);
  if (realOk) {
    sReal.set(dollars(100 * a.real.P), `real yield ${pct(a.real.y)} a year (${pct(a.real.annual)} compounded yearly), from TIPS`);
    sBreak.set(pct(a.breakeven), "a year: nominal minus real. Expected inflation plus premia, not expected inflation alone");
    sRho.set(pct(a.rho), `a year, if the real yield were exactly ρ + ημ − ½η²σ² with η ${fmt.num(p.eta, 2)}, μ ${pct(p.mu)}, σ ${pct(p.sigma)}`);
  } else {
    for (const s of [sReal, sBreak, sRho]) s.set("–", `no real yield at ${years(n)}: the TIPS curve covers 2 to 20 years`);
  }

  // The same in words, with the half-life of a dollar's value.
  const pn = CURVES.nominal.params[i], pr = CURVES.real.params[i];
  const hn = halfLife(pn, 1, 30), hr = halfLife(pr, 2, 20);
  const lossN = 100 * (1 - Math.exp(-a.nominal.y / 100));
  const sentences = [
    `On ${date} the Treasury market priced $100 due in ${years(n)} at ${dollars(100 * a.nominal.P)}: each year of waiting cut its value by ${pct(lossN)} on average.`,
    realOk
      ? (a.real.P > 1
        ? `In real terms the price was ${dollars(100 * a.real.P)}, more than $100: the real yield was negative, so buying power delivered later cost more than buying power now.`
        : `In real terms, $100 of today's buying power ${years(n)} ahead cost ${dollars(100 * a.real.P)}.`)
      : "",
    `${hn != null ? `A dollar due ${fmt.num(hn, 1)} years ahead was worth half a dollar today` : "A dollar due up to 30 years ahead was worth more than half a dollar today"}; ${hr != null ? `a dollar of buying power, ${fmt.num(hr, 1)} years ahead.` : "a dollar of buying power was worth more than half at every horizon up to 20 years."}`,
  ].filter(Boolean);
  words.textContent = sentences.join(" ");
  say(`${years(n)}, ${date}. ${sentences.join(" ")}${realOk ? ` Implied pure time preference ${pct(a.rho)} a year.` : ""}`);

  drawTable(a, p);
  drawCurves(i, n);
  drawHistory(i, n, p);
}

function drawTable(a, p) {
  const n = a.n;
  tableHead.textContent = `What the ${adj(n)} yield is made of on ${day(a.date)}`;
  const rows = [
    ["Nominal zero-coupon yield", pct(a.nominal.y), "Observed: fitted to the prices of ordinary Treasury notes and bonds."],
  ];
  if (a.real) {
    rows.push(
      ["minus inflation compensation", pct(a.breakeven), "Observed as a gap, not split: expected inflation, plus a premium for the risk of inflation, minus a premium for TIPS being harder to trade."],
      ["equals the real zero-coupon yield", pct(a.real.y), "Observed: fitted to the prices of inflation-protected Treasuries (TIPS)."],
      ["minus the growth term ημ", pct(a.growthTerm), `Assumed: η ${fmt.num(p.eta, 2)} × μ ${pct(p.mu)}. Richer future people value an extra dollar less.`],
      ["plus the precautionary term ½η²σ²", pct(a.precaution, 3), `Assumed: uncertain growth makes people save more, which lowers the yield. With σ ${pct(p.sigma)}.`],
      ["minus term and TIPS liquidity premia, plus the safety premium", "not known", "In the yield but not measured by any curve: the first two raise the real yield, the extra price paid for the safety of Treasuries lowers it. Taken as zero here, which is why ρ is only implied."],
      ["equals implied pure time preference ρ", pct(a.rho), "What is left: the rate at which a person discounts future well-being only because it is later."],
    );
  }
  const table = el("table", { class: "tbl d76-rt" },
    el("caption", { text: "Percent a year, continuously compounded. Read down: each line adds to or takes from the one above." }),
    el("thead", {}, el("tr", {}, ["Part", "Value", "Where it comes from"].map((h, k) => el("th", { scope: "col", class: k === 1 ? "num" : null, text: h })))),
    el("tbody", {}, rows.map(([part, v, src]) => el("tr", {},
      el("th", { scope: "row", text: part }),
      el("td", { class: "num", "data-label": "Value", text: v }),
      el("td", { "data-label": "Source", text: src })))));
  tableBox.replaceChildren(table, ...(a.real ? [] : [note("", `There is no real yield at ${years(a.n)}: the TIPS curve covers 2 to 20 years. Choose a horizon in that range to split the yield further.`)]));
}

function drawCurves(i, n) {
  const pn = CURVES.nominal.params[i], pr = CURVES.real.params[i];
  const grid = (lo, hi, fn) => Array.from({ length: Math.round((hi - lo) * 4) + 1 }, (_, k) => lo + k / 4).map((m) => [m, fn(m)]);
  const date = day(CURVES.dates[i]);
  curveChart.update({
    title: `What $100 due later is worth today, ${date}`,
    subtitle: "The market's patience: how fast the price of a future payment falls with the wait. Real: $100 of today's buying power, delivered then.",
    label: `Line chart of the price today of $100 due in 1 to 30 years, nominal and real, on ${date}`,
    x: { label: "Years ahead", domain: [0, 30], format: (v) => fmt.num(v, Number.isInteger(v) ? 0 : 2) },
    y: { label: "Price today ($)", format: (v) => `$${fmt.num(v, Number.isInteger(v) ? 0 : 2)}` },
    series: [
      { name: "Nominal: $100", type: "line", data: grid(1, 30, (m) => 100 * discount(pn, m)), color: 0 },
      { name: "Real: $100 of buying power", type: "line", data: grid(2, 20, (m) => 100 * discount(pr, m)), color: 1 },
    ],
    marks: [{ type: "hline", y: 100, text: "Face value" }, { type: "vline", x: n, text: years(n) }],
  });
  rateChart.update({
    title: `Yields and forward rates along the curve, ${date}`,
    subtitle: "Zero-coupon yield: the average rate from now to that year. Forward rate: the rate for waiting a little longer at that year.",
    label: `Line chart of nominal and real zero-coupon yields and the real forward rate by maturity on ${date}`,
    x: { label: "Years ahead", domain: [0, 30], format: (v) => fmt.num(v, Number.isInteger(v) ? 0 : 2) },
    y: { label: "% a year", format: (v) => `${fmt.num(v, 1)}%` },
    series: [
      { name: "Nominal yield", type: "line", data: grid(1, 30, (m) => zeroYield(pn, m)), color: 0 },
      { name: "Real yield", type: "line", data: grid(2, 20, (m) => zeroYield(pr, m)), color: 1 },
      { name: "Real forward rate", type: "line", data: grid(2, 20, (m) => forwardRate(pr, m)), color: 1, dash: true },
    ],
    marks: [{ type: "hline", y: 0 }, { type: "vline", x: n, text: years(n) }],
  });
}

function drawHistory(i, n, p) {
  const h = history(CURVES, n, p);
  const realOk = covers(CURVES.real, n);
  const series = [{ name: "Nominal yield", type: "line", data: h.map((r, k) => [XS[k], r.nominal]), color: 0 }];
  if (realOk) {
    series.push({ name: "Real yield", type: "line", data: h.map((r, k) => [XS[k], r.real]), color: 1 });
    series.push({ name: "Implied ρ", type: "line", data: h.map((r, k) => [XS[k], r.rho]), color: 2 });
  }
  histChart.update({
    title: `${adj(n)} yields since 1999, month by month`,
    subtitle: realOk
      ? "Implied ρ is the real yield minus ημ plus ½η²σ², so it moves exactly as the real yield does. Click a month, or use the arrow keys and Enter, to look at its curve."
      : "Only the nominal yield exists at this horizon. Click a month, or use the arrow keys and Enter, to look at its curve.",
    label: `Line chart of the ${years(n)} nominal${realOk ? " and real yields and the implied pure time preference" : " yield"} at each month-end since January 1999`,
    x: { label: "Date", domain: [XS[0], XS[LAST]], format: yearTick },
    y: { label: "% a year", format: (v) => `${fmt.num(v, 1)}%` },
    series,
    marks: [{ type: "hline", y: 0 }, { type: "vline", x: XS[i], text: day(CURVES.dates[i]) }],
    onClick: ({ x }) => { if (Number.isFinite(x)) setDate(nearestIndex(x)); },
  });
}

draw();
