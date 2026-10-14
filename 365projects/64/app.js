// Day 64: Portfolio Optimiser. Interface.
import { $, el, fmt, mount, slider, select, checkbox, numberField, button, stat, note, chart, palette, debounce } from "../kit/kit.js";
import { ALL, T, monthLabel, startOfYear, endOfYear, MIN_MONTHS, estimate, feasible, ends, atVolatility, frontier, distance, portVol } from "./logic.js";

mount();

const FIRST_YEAR = 1999, LAST_YEAR = 2026;
const LOWS = [0, -0.1, -0.25, -0.5, -1];
const HIGHS = [1, 0.75, 0.5, 0.4, 0.3, 0.25, 0.2, 0.15, 0.1];
// want: the volatility the visitor asked for; target: that volatility clamped to what the current limits allow. Kept
// apart so that passing through a narrow choice of assets does not lose the visitor's volatility.
const DEFAULT = { ids: ALL.map((a) => a.id), from: FIRST_YEAR, to: LAST_YEAR, low: 0, high: 1, want: 0.04, target: 0.04 };
const state = { ...DEFAULT, ids: [...DEFAULT.ids], own: {} }; // own: expected returns typed by the visitor, by asset id (fractions)
let current = null, moveId = "", job = 0; // the solved problem, the asset whose mean the sweep moves, the slice-job counter

const pct = (x, d = 1) => fmt.pct(x, d);
const pts = (x) => `${fmt.num(x * 100, 2)} points`;
const nameOf = (id) => ALL.find((a) => a.id === id).short;
const longName = (id) => ALL.find((a) => a.id === id).name;
const GROUPS = [["cash", "Cash in dollars"], ["treasury", "US Treasuries"], ["deposit", "Cash in another currency"]];

/* ---------- controls ---------- */
const boxes = new Map();
const assetMsg = el("div", { role: "status" });
const assetField = el("div", { class: "field", role: "group", "aria-label": "Assets" },
  el("div", { class: "lab" }, el("span", { text: "Assets" })),
  GROUPS.map(([g, title]) => el("div", { class: "po-group" }, el("p", { class: "po-sub", text: title }),
    ALL.filter((a) => a.group === g).map((a) => {
      const box = checkbox({ label: a.short, checked: true, onChange: () => { state.ids = ALL.map((x) => x.id).filter((id) => boxes.get(id).checked); update(); } });
      box.el.title = a.detail;
      boxes.set(a.id, box);
      return box.el;
    }))),
  el("div", { class: "row po-presets" },
    button("All eleven", () => setAssets(ALL.map((a) => a.id)), { small: true }),
    button("Bills and Treasuries", () => setAssets(ALL.filter((a) => a.group !== "deposit").map((a) => a.id)), { small: true }),
    button("Bills and currencies", () => setAssets(ALL.filter((a) => a.group !== "treasury").map((a) => a.id)), { small: true })),
  assetMsg);
const years = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const fromSelect = select({
  label: "Estimate from", value: state.from,
  options: years(FIRST_YEAR, LAST_YEAR - 3).map((y) => ({ value: y, label: monthLabel(startOfYear(y)) })),
  onChange: (v) => { state.from = Number(v); update(); },
});
const toSelect = select({
  label: "Estimate to", value: state.to,
  options: years(FIRST_YEAR + 3, LAST_YEAR).map((y) => ({ value: y, label: monthLabel(endOfYear(y)) })),
  hint: "The returns, volatilities and correlations are estimated from these months.",
  onChange: (v) => { state.to = Number(v); update(); },
});
const windowMsg = el("div", { role: "status" });
const lowSelect = select({
  label: "Lowest weight in any asset", value: state.low,
  options: LOWS.map((v) => ({ value: v, label: v === 0 ? "0% (no short positions)" : `${pct(v, 0)} (short positions allowed)` })),
  onChange: (v) => { state.low = Number(v); update(); },
});
const highSelect = select({
  label: "Highest weight in any asset", value: state.high,
  options: HIGHS.map((v) => ({ value: v, label: pct(v, 0) })),
  hint: "The weights always add up to 100%.",
  onChange: (v) => { state.high = Number(v); update(); },
});
const boundMsg = el("div", { role: "status" });
const riskSlider = slider({
  label: "Volatility you accept", min: 0, max: 1, step: "any", value: 0.5,
  format: () => (current ? `${pct(state.target)} a year` : ""),
  hint: "Your risk tolerance: the standard deviation of yearly returns. The tool finds the highest expected return at that volatility.",
  onInput: (v) => { state.want = state.target = current.end.low.vol + v * (current.end.high.vol - current.end.low.vol); solvePoint(); },
});
const ownBox = el("div");
const ownDetails = el("details", { class: "po-own" }, el("summary", { text: "Use your own expected returns" }),
  el("p", { class: "hint", text: "Type the return you expect from each asset, in per cent a year. The estimate from the chosen months is filled in to start with." }),
  ownBox,
  button("Use the estimates again", (e) => { state.own = {}; update(); e.currentTarget.focus(); }, { small: true }));
const resetBtn = button("Back to the opening settings", () => {
  Object.assign(state, DEFAULT, { ids: [...DEFAULT.ids], own: {} });
  for (const [id, box] of boxes) box.checked = state.ids.includes(id);
  fromSelect.value = state.from; toSelect.value = state.to; lowSelect.value = state.low; highSelect.value = state.high;
  update(); resetBtn.focus();
}, { small: true });
const about = el("div", { class: "hint po-about" },
  `Monthly returns in US dollars, ${monthLabel(0)} to ${monthLabel(T - 1)}, nominal, before tax and costs. Treasuries are modelled constant-maturity bonds, not a fund; currencies are cash deposits earning their central bank's policy rate. Means and covariances are the monthly ones times 12. Each series is described under "How it works" below.`);
const controls = el("div", { class: "controls" }, assetField, fromSelect.el, toSelect.el, windowMsg, lowSelect.el, highSelect.el, boundMsg, riskSlider.el, ownDetails, resetBtn, about);

/* ---------- outputs ---------- */
const sRet = stat("Expected return");
const sVol = stat("Volatility");
const sSharpe = stat("Sharpe ratio");
const sHeld = stat("Assets held");
const status = el("p", { class: "sr-only", role: "status" });
// Dragging the volatility slider fires many inputs: announce the portfolio once the hand stops, not at every step.
const announce = debounce((text) => { status.textContent = text; }, 400);
const message = el("div");
const frontierBox = el("div");
const weightsBox = el("div", { class: "po-tbl" });
const advice = note("", "An illustration of the method on past data, not investment advice. Past averages are a poor guide to future returns, which is the point of the section below.");
const sensHead = el("h2", { text: "How much do the weights depend on the estimated returns?" });
const sensText = el("div");
const sensTable = el("div", { class: "po-tbl" });
const sensStatus = el("p", { class: "sr-only", role: "status" });
const moveSelect = select({ label: "Move one asset's expected return", options: [], onChange: (v) => { moveId = v; sweep(); } });
const sweepBox = el("div");
const jump = el("nav", { class: "row small jump", "aria-label": "Parts of this tool" },
  el("span", { class: "muted", text: "Jump to:" }), el("a", { href: "#po-results", text: "The portfolio" }), el("a", { href: "#po-sens", text: "Sensitivity to the means" }));
const out = el("div", { class: "out" },
  el("div", { class: "stats", id: "po-results" }, sRet.el, sVol.el, sSharpe.el, sHeld.el), status, message, frontierBox, weightsBox, advice,
  el("div", { class: "panel po-stack", id: "po-sens" }, sensHead, sensText, sensTable, sensStatus, moveSelect.el, sweepBox));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out));

const frontierChart = chart(frontierBox, { series: [], height: 340 });
const sweepChart = chart(sweepBox, { series: [], height: 300 });

/* ---------- state helpers ---------- */
function setAssets(ids) {
  state.ids = ids;
  for (const [id, box] of boxes) box.checked = ids.includes(id);
  update();
}
const window_ = () => ({ from: startOfYear(state.from), to: endOfYear(state.to) });
// The visitor's own expected returns: one box per chosen asset, rebuilt only when the assets change, so that a box
// keeps its focus while the tool recalculates. Boxes the visitor has not typed in follow the estimates.
const ownFields = new Map();
function fillOwn(est) {
  const key = state.ids.join(",");
  if (ownBox.dataset.key !== key) {
    ownBox.dataset.key = key;
    ownFields.clear();
    ownBox.replaceChildren(...state.ids.map((id) => {
      const f = numberField({
        label: `${nameOf(id)}, % a year`, min: -20, max: 30, step: 0.1, value: 0,
        onInput: debounce((v) => { state.own[id] = v / 100; update(); }, 250),
      });
      const msg = el("div");
      f.input.addEventListener("input", () => msg.replaceChildren(Number.isNaN(f.value) ? note("bad", `Enter a return for ${nameOf(id)} between -20 and 30 (per cent a year). Until then the portfolio uses the last valid figure.`) : ""));
      f.el.append(msg);
      ownFields.set(id, f);
      return f.el;
    }));
  }
  state.ids.forEach((id, i) => {
    const f = ownFields.get(id);
    if (document.activeElement === f.input) return;
    f.value = +((state.own[id] ?? (est ? est.mu[i] : 0)) * 100).toFixed(2);
  });
}

/* ---------- the optimisation ---------- */
function update() {
  job++;
  const ids = state.ids;
  const { from, to } = window_();
  assetMsg.replaceChildren(); windowMsg.replaceChildren(); boundMsg.replaceChildren();
  if (ids.length < 2) { assetMsg.replaceChildren(note("bad", "Choose at least two assets: with one there is nothing to choose between.")); return blank("Choose at least two assets."); }
  if (to < from) { windowMsg.replaceChildren(note("bad", `The window ends (${monthLabel(to)}) before it starts (${monthLabel(from)}). Choose an end at least three years after the start.`)); return blank("The estimation window ends before it starts."); }
  if (to - from + 1 < MIN_MONTHS) { windowMsg.replaceChildren(note("bad", `The window has ${to - from + 1} months. Choose at least three years so that the estimates mean something.`)); return blank("The estimation window is too short."); }
  const n = ids.length;
  const lo = new Array(n).fill(state.low), hi = new Array(n).fill(state.high);
  if (!feasible(lo, hi)) {
    boundMsg.replaceChildren(note("bad", `With ${n} assets and at most ${pct(state.high, 0)} in each, the weights can only reach ${pct(n * state.high, 0)}, not 100%. Raise the highest weight or choose more assets.`));
    return blank("These limits leave no portfolio that adds up to 100%.");
  }
  const est = estimate(ids, from, to);
  const own = ids.some((id) => state.own[id] != null);
  const mu = ids.map((id, i) => state.own[id] ?? est.mu[i]);
  const end = ends(est.S, mu, lo, hi);
  const front = frontier(est.S, mu, lo, hi, end);
  current = { ids, est, mu, lo, hi, end, front, own, n };
  fillOwn(est);
  // Keep the visitor's volatility, inside the frontier's range.
  state.target = Math.min(end.high.vol, Math.max(end.low.vol, state.want));
  const span = end.high.vol - end.low.vol;
  riskSlider.value = span > 1e-12 ? (state.target - end.low.vol) / span : 0;
  riskSlider.input.disabled = span <= 1e-12;
  moveSelect.input.replaceChildren(...ids.map((id) => el("option", { value: id, text: longName(id) })));
  if (!ids.includes(moveId)) moveId = ids.includes("t10") ? "t10" : ids[ids.length - 1];
  moveSelect.value = moveId;
  solvePoint();
}

function blank(why) {
  current = null;
  for (const s of [sRet, sVol, sSharpe, sHeld]) s.set("–", "");
  message.replaceChildren(note("warn", why));
  announce(why);
  frontierChart.update({ series: [], marks: [], empty: why });
  weightsBox.replaceChildren();
  sensText.replaceChildren(note("warn", why));
  sensTable.replaceChildren();
  sweepChart.update({ series: [], marks: [], empty: why });
}

function solvePoint() {
  if (!current) return;
  const { ids, est, mu, lo, hi, end, front, own } = current;
  const p = atVolatility(est.S, mu, lo, hi, state.target, end);
  current.p = p;
  riskSlider.input.setAttribute("aria-valuetext", `${pct(p.vol)} a year`);
  riskSlider.el.querySelector("output").textContent = `${pct(p.vol)} a year`;
  const held = p.w.filter((v) => Math.abs(v) >= 0.0005).length;
  const sharpe = (p.ret - est.rf) / p.vol;
  sRet.set(pct(p.ret, 2), own ? "a year, from your own returns" : "a year, the past average");
  sVol.set(pct(p.vol, 2), "a year");
  sSharpe.set(fmt.num(sharpe, 2), `over bills' ${pct(est.rf, 2)} a year`);
  sHeld.set(`${held} of ${ids.length}`, p.w.some((v) => v < -0.0005) ? "some held short" : "");
  const edge = p.flag === "below" ? "This is the least volatile portfolio the limits allow. " : p.flag === "above" ? "This is the highest-return portfolio the limits allow. " : "";
  message.replaceChildren(own ? note("", "Expected returns are your own figures, not the estimates. Volatilities and correlations are still estimated from the chosen months.") : "");
  const top = ids.map((id, i) => ({ id, w: p.w[i] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).filter((x) => Math.abs(x.w) >= 0.0005);
  announce(`${edge}At ${pct(p.vol)} volatility the portfolio that is efficient on these ${own ? "expected returns" : "past estimates"} has an expected return of ${pct(p.ret, 2)} a year: ${top.map((x) => `${nameOf(x.id)} ${pct(x.w)}`).join(", ")}.`);

  // Frontier, the assets and the chosen portfolio.
  const eq = ids.map(() => 1 / ids.length);
  const eqOk = eq.every((v, i) => v >= lo[i] - 1e-12 && v <= hi[i] + 1e-12);
  const marks = [
    { type: "point", x: end.low.vol * 100, y: end.low.ret * 100, text: "Least volatile", color: "#8a94a3" },
    { type: "point", x: p.vol * 100, y: p.ret * 100, text: "Your portfolio" },
  ];
  if (eqOk) marks.push({ type: "point", x: portVol(est.S, eq) * 100, y: eq.reduce((s, w, i) => s + w * mu[i], 0) * 100, text: "Equal weights", color: palette[3] });
  frontierChart.update({
    title: "The efficient frontier under your limits",
    subtitle: `Each point on the line is the highest expected return at that volatility, given ${own ? "your expected returns and the volatilities and correlations" : "the averages, volatilities and correlations"} of the chosen months. Dots are the single assets; point at or tap one for its name.`,
    label: "Line chart of the efficient frontier, expected return against volatility, with each asset as a dot",
    hover: "point",
    x: { label: "Volatility, % a year", format: (v) => fmt.num(v, 1) },
    y: { label: "Expected return, % a year", format: (v) => fmt.num(v, 1) },
    series: [
      { name: "Efficient frontier", type: "line", data: front.map((q) => [q.vol * 100, q.ret * 100]), color: 0, hover: false },
      { name: "Single assets", type: "scatter", data: ids.map((id, i) => ({ x: est.sd[i] * 100, y: mu[i] * 100, label: longName(id) })), color: 1, r: 4.5 },
    ],
    marks,
  });

  weightsBox.replaceChildren(listTable({
    caption: `Weights at ${pct(p.vol)} volatility`,
    columns: [
      { label: "Asset", get: (r) => longName(r.id) },
      { label: "Weight", get: (r) => `${pct(r.w)}${r.w < -0.0005 ? " (short)" : ""}` },
      { label: "Expected return", get: (r) => `${pct(r.mu, 2)}${own && state.own[r.id] != null ? " (yours)" : ` ± ${fmt.num(r.se * 100, 2)}`}` },
      { label: "Volatility", get: (r) => pct(r.sd) },
    ],
    rows: ids.map((id, i) => ({ id, w: p.w[i], mu: mu[i], se: est.se[i], sd: est.sd[i] })).sort((a, b) => b.w - a.w),
    note: own ? null : "± one standard error of the estimated mean: sd / √years.",
  }));

  runSensitivity();
}

/* ---------- sensitivity, in slices ---------- */
function runSensitivity() {
  const id = ++job;
  const { ids, est, mu, lo, hi, p } = current;
  const rows = [];
  sensText.replaceChildren(el("p", { class: "small muted", text: "Re-solving with each expected return moved by one standard error..." }));
  sensTable.replaceChildren();
  const step = () => {
    if (id !== job) return;
    const t0 = performance.now();
    while (rows.length < ids.length && performance.now() - t0 < 25) {
      const i = rows.length;
      const at = (s) => atVolatility(est.S, mu.map((m, j) => (j === i ? m + s * est.se[i] : m)), lo, hi, p.vol);
      rows.push({ i, down: at(-1), up: at(1) });
    }
    if (rows.length < ids.length) { setTimeout(step, 0); return; }
    showSensitivity(rows);
    sweep();
  };
  setTimeout(step, 0);
}

function showSensitivity(rows) {
  const { ids, est, p } = current;
  let worst = { d: -1 };
  for (const r of rows) for (const [q, s] of [[r.down, -1], [r.up, 1]]) { const d = distance(p.w, q.w); if (d > worst.d) worst = { d, i: r.i, s, q }; }
  const name = longName(ids[worst.i]);
  const moved = worst.s > 0 ? "higher" : "lower";
  const ownW = worst.q.w[worst.i];
  if (worst.d < 0.0005) {
    // At the least volatile portfolio, or when the limits leave one portfolio, the means play no part.
    const single = current.end.high.vol - current.end.low.vol <= 1e-12;
    const why = single ? "These limits leave only one portfolio, so it cannot depend on the expected returns"
      : p.flag === "below" ? "This is the least volatile portfolio the limits allow, which does not depend on the expected returns"
        : "At this volatility the portfolio is held in place by the limits";
    sensText.replaceChildren(el("p", {}, `${why}: moving any one expected return by a standard error changes less than 0.05% of it. ${single ? "Loosen the limits" : "Choose another volatility"} to see how much the answer depends on the means.`));
  } else sensText.replaceChildren(el("p", {},
    "An estimated mean is uncertain by about one standard error, the asset's volatility divided by the square root of the number of years. ",
    el("strong", { text: `Moving one asset's expected return by that much changes up to ${pct(worst.d)} of the portfolio: ` }),
    `with the expected return of the ${name} ${pts(est.se[worst.i])} ${moved}, its own weight goes from ${pct(p.w[worst.i])} to ${pct(ownW)}, at the same ${pct(p.vol)} volatility. The volatilities and correlations are held fixed throughout; only one mean moves.`));
  sensTable.replaceChildren(listTable({
    caption: "Each asset's weight when its expected return moves by one standard error",
    columns: [
      { label: "Asset", get: (r) => longName(ids[r.i]) },
      { label: "One standard error", get: (r) => pts(est.se[r.i]) },
      { label: "Weight if lower", get: (r) => pct(r.down.w[r.i]) },
      { label: "Weight now", get: (r) => pct(p.w[r.i]) },
      { label: "Weight if higher", get: (r) => pct(r.up.w[r.i]) },
      { label: "Portfolio that changes", get: (r) => `${pct(distance(p.w, r.down.w))} / ${pct(distance(p.w, r.up.w))}` },
    ],
    rows,
    note: "The last column is half the sum of the absolute changes in all the weights, for the lower and the higher return.",
  }));
  sensStatus.textContent = worst.d < 0.0005 ? "Moving any one expected return by one standard error changes none of the weights here."
    : `Moving the expected return of the ${name} ${moved} by one standard error changes ${pct(worst.d)} of the portfolio.`;
}

function sweep() {
  if (!current) return;
  const id = job;
  const { ids, est, mu, lo, hi, p } = current;
  const i = ids.indexOf(moveId);
  if (i < 0) return;
  const shifts = Array.from({ length: 21 }, (_, k) => -2 + k * 0.2);
  const res = [];
  sweepChart.update({ series: [], marks: [], empty: "Working out the weights..." });
  const step = () => {
    if (id !== job || !current) return;
    const t0 = performance.now();
    while (res.length < shifts.length && performance.now() - t0 < 25) {
      const s = shifts[res.length];
      res.push(atVolatility(est.S, mu.map((m, j) => (j === i ? m + s * est.se[i] : m)), lo, hi, p.vol).w);
    }
    if (res.length < shifts.length) { setTimeout(step, 0); return; }
    // Assets that ever hold at least half a per cent; past eight, the smallest are added together.
    const peak = ids.map((_, j) => Math.max(...res.map((w) => Math.abs(w[j]))));
    const shown = ids.map((_, j) => j).filter((j) => peak[j] >= 0.005).sort((a, b) => peak[b] - peak[a]);
    const main = shown.length > 8 ? shown.slice(0, 7) : shown;
    const rest = shown.length > 8 ? shown.slice(7) : [];
    const series = main.map((j, k) => ({ name: nameOf(ids[j]), type: "line", data: shifts.map((s, q) => [s, res[q][j] * 100]), color: k }));
    if (rest.length) series.push({ name: `${rest.length} others together`, type: "line", data: shifts.map((s, q) => [s, rest.reduce((a, j) => a + res[q][j], 0) * 100]), color: 7 });
    sweepChart.update({
      title: `Weights as the expected return of the ${longName(moveId)} moves`,
      subtitle: `From two standard errors (${pts(2 * est.se[i])}) below the ${current.own && state.own[moveId] != null ? "figure you typed" : "estimate"} to two above, at ${pct(p.vol)} volatility.`,
      label: `Line chart of each asset's weight as the expected return of ${longName(moveId)} moves by up to two standard errors`,
      x: { label: "Change in its expected return, standard errors", format: (v) => fmt.signed(v, 1), domain: [-2, 2] },
      y: { label: "Weight, %", format: (v) => fmt.num(v, 0) },
      series,
      marks: [{ type: "vline", x: 0, text: "now" }],
    });
  };
  setTimeout(step, 0);
}

/* ---------- a table that becomes a list of labelled lines in a narrow box ---------- */
function listTable({ caption, columns, rows, note: foot }) {
  return el("div", {},
    el("table", { class: "tbl rt", role: "table" },
      el("caption", { text: caption }),
      el("thead", { role: "rowgroup" }, el("tr", { role: "row" }, columns.map((c, k) => el("th", { role: "columnheader", scope: "col", class: k ? "num" : null, text: c.label })))),
      el("tbody", { role: "rowgroup" }, rows.map((r) => el("tr", { role: "row" },
        columns.map((c, k) => el(k === 0 ? "th" : "td", { role: k === 0 ? "rowheader" : "cell", scope: k === 0 ? "row" : null, class: k ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) })))))),
    foot ? el("p", { class: "small muted", text: foot }) : null);
}

update();
