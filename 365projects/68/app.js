// Day 68: Crypto Volatility Lab. Interface.
import { $, el, fmt, mount, select, segmented, slider, stat, note, chart, debounce } from "../kit/kit.js";
import { CRYPTO } from "./data.js";
import {
  DAYS_PER_YEAR, dateAt, indexOf, logReturns, fitGarch, forecastVariance, shockQuantile, varFromLog, parameterDraws,
  simulatePaths, regimes, runs, percentileRank, backtestPlan, backtestBlock, ewmaStart, scoreBacktest, sortedQuantile,
} from "./logic.js";

mount();

const FIRST_TEST = 1000;   // returns kept back before the first backtest forecast
const REFIT_EVERY = 250;   // days between re-estimations in the backtest
const MIN_RETURNS = FIRST_TEST + 250;
const DRAWS = 200, PATHS = 4000, SEED = 68;
const FROM_YEARS = [2016, 2018, 2020, 2022];
const PROBS = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99];

const coinOf = (id) => CRYPTO.coins.find((c) => c.id === id);
const lastDate = (c) => dateAt(c.start, c.prices.length - 1);
const annual = (dailyVariance) => Math.sqrt(dailyVariance * DAYS_PER_YEAR); // percent a year
const pct0 = (v) => `${fmt.num(v, 0)}%`;
// n significant figures, keeping trailing zeros (0.030, not 0.03).
const sigFixed = (v, n) => (Number.isFinite(v) && v !== 0 ? fmt.num(v, Math.max(0, n - 1 - Math.floor(Math.log10(Math.abs(Number(v.toPrecision(n))))))) : Number.isFinite(v) ? "0" : "–");
const pct1 = (v) => `${fmt.num(v, 1)}%`;
const usd = (v) => (v >= 100 ? `$${fmt.int(v)}` : v >= 1 ? `$${fmt.num(v, 2)}` : `$${fmt.sig(v, 3)}`);
// Time on the x axis is in years (1 January of each year is a whole number), so that the ticks fall on round years.
const daysIn = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
const toYear = (iso) => { const y = Number(iso.slice(0, 4)); return y + (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(y, 0, 1)) / 86400000 / daysIn(y); };
const fromYear = (v) => { const y = Math.floor(v + 1e-9); return new Date(Date.UTC(y, 0, 1) + Math.round((v - y) * daysIn(y)) * 86400000).toISOString().slice(0, 10); };
const dateLabel = (v) => fmt.date(fromYear(v));

const state = { coin: "btc", from: "2018-01-01", shocks: "normal", level: 0.99, horizon: 30 };

/* ---------- controls ---------- */
const coinSelect = select({
  label: "Coin", value: state.coin,
  options: CRYPTO.coins.map((c) => ({ value: c.id, label: `${c.name} (${c.ticker})` })),
  onChange: (v) => { state.coin = v; fillFrom(); update(); },
});
const fromSelect = select({ label: "Fit the model to prices from", options: [], onChange: (v) => { state.from = v; update(); } });
function fillFrom() {
  const c = coinOf(state.coin);
  const n = c.prices.length - 1;
  const opts = [{ value: c.start, label: `the first day, ${fmt.date(c.start)}` },
    ...FROM_YEARS.map((y) => `${y}-01-01`).filter((d) => d > c.start && n - indexOf(c.start, d) >= MIN_RETURNS).map((d) => ({ value: d, label: fmt.date(d) }))];
  fromSelect.input.replaceChildren(...opts.map((o) => el("option", { value: o.value, text: o.label })));
  if (!opts.some((o) => o.value === state.from)) state.from = opts.some((o) => o.value === "2018-01-01") ? "2018-01-01" : opts[0].value;
  fromSelect.value = state.from;
}
const shockSeg = segmented({
  label: "Shocks in the forecast", value: state.shocks,
  options: [{ value: "normal", label: "Normal" }, { value: "past", label: "Drawn from the past" }],
  hint: "Normal assumes bell-shaped surprises. Drawn from the past reuses the model's own standardised surprises, fat tails and all (filtered historical simulation).",
  onChange: (v) => { state.shocks = v; update(); },
});
const levelSeg = segmented({
  label: "Value at risk", value: String(state.level),
  options: [{ value: "0.95", label: "95%" }, { value: "0.99", label: "99%" }],
  hint: "The loss that one day should exceed with a 5% or a 1% chance.",
  onChange: (v) => { state.level = Number(v); update(); },
});
const horizonSlider = slider({
  label: "Forecast horizon", min: 1, max: 90, step: 1, value: state.horizon,
  format: (v) => `${v} ${v === 1 ? "day" : "days"}`,
  onInput: debounce((v) => { state.horizon = v; forecast(); }, 120),
});
const about = el("div", { class: "small muted source-note" });
const controls = el("div", { class: "controls" }, coinSelect.el, fromSelect.el, shockSeg.el, levelSeg.el, horizonSlider.el,
  note("", "An illustration of a statistical method on past prices, not investment advice. Nothing here says what to buy, sell or hold."),
  about);

/* ---------- outputs ---------- */
const sVol = stat("Volatility for the next day");
const sRegime = stat("Regime");
const sPersist = stat("Persistence");
const sVar = stat("One-day value at risk");
const status = el("p", { class: "sr-only", role: "status" });
const warnBox = el("div");
const priceBox = el("div"), volBox = el("div"), pathBox = el("div"), fanBox = el("div");
const fanNote = el("p", { class: "small muted" });
const paramBox = el("div");
const testHead = el("h2", { text: "Would the value at risk have held?" });
const testIntro = el("p", { class: "small muted" });
const progress = el("p", { class: "small muted" });
const testBox = el("div");
const testStatus = el("p", { class: "sr-only", role: "status" });

const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sVol.el, sRegime.el, sPersist.el, sVar.el), status, warnBox,
  volBox, priceBox, pathBox, fanBox, fanNote, paramBox,
  el("div", { class: "panel stack" }, testHead, testIntro, progress, testBox, testStatus));
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const priceChart = chart(priceBox, { series: [], height: 230 });
const volChart = chart(volBox, { series: [], height: 300 });
const pathChart = chart(pathBox, { series: [], height: 250 });
const fanChart = chart(fanBox, { series: [], height: 280 });

/* ---------- a table that becomes a list when its box is narrow ---------- */
function rtable({ caption, columns, rows }) {
  return el("div", { class: "rt-wrap" }, el("table", { class: "tbl rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, columns.map((c, k) => (k === 0
      ? el("th", { scope: "row", text: r[c.key] })
      : el("td", { class: c.num ? "num" : null, "data-label": c.label, text: r[c.key] }))))))));
}

/* ---------- the fit ---------- */
let current = null; // { c, r, i0, fit, draws, reg }

function update() {
  const c = coinOf(state.coin);
  const i0 = indexOf(c.start, state.from);
  const prices = c.prices.slice(i0);
  const r = logReturns(prices);
  const fit = fitGarch(r);
  const draws = parameterDraws(r, fit, DRAWS, SEED);
  const reg = regimes(fit.h);
  current = { c, r, i0, prices, fit, draws, reg };

  const first = dateAt(c.start, i0 + 1), last = lastDate(c);
  about.replaceChildren(
    el("strong", { text: `${c.name}, daily, ${fmt.date(first)} to ${fmt.date(last)}. ` }),
    `${fmt.int(r.length)} daily returns. Prices in US dollars at the end of each UTC day from Coin Metrics' free community data (${CRYPTO.source.licence}), retrieved ${fmt.date(CRYPTO.retrieved)}. The archive stopped updating on 24 May 2026, so "the next day" is ${fmt.date(dateAt(c.start, c.prices.length))}.`);

  // Headline tiles.
  const volNow = annual(fit.next);
  const nextDay = fmt.date(dateAt(c.start, c.prices.length)); // the day after the last price, not today
  const band = draws ? draws.map((d) => annual(d.next)).sort((a, b) => a - b) : null;
  sVol.set(`${pct0(volNow)} a year`, band ? `for ${nextDay}, the day after the last price; 90% interval ${pct0(sortedQuantile(band, 0.05))} to ${pct0(sortedQuantile(band, 0.95))}; ${pct1(Math.sqrt(fit.next))} a day` : `for ${nextDay}, the day after the last price; ${pct1(Math.sqrt(fit.next))} a day; no interval (see the note)`);
  const sigmaNext = Math.sqrt(fit.next);
  const rank = percentileRank(reg.sigma, sigmaNext);
  const regimeNow = sigmaNext > reg.high ? "stormy" : sigmaNext < reg.low ? "calm" : "ordinary";
  sRegime.set(regimeNow[0].toUpperCase() + regimeNow.slice(1), `for ${nextDay}: higher than on ${fmt.num(rank, 0)}% of days in the window`);
  sPersist.set(fmt.num(fit.persistence, 3), Number.isFinite(fit.halfLife) && fit.halfLife < 1e4
    ? `α + β; a shock to variance halves in ${fmt.num(fit.halfLife, 1)} days` : "α + β; shocks to variance do not fade");
  const q = shockQuantile(state.level, state.shocks, fit.z);
  const var1 = varFromLog(fit.mu, sigmaNext, q);
  const varBand = draws ? draws.map((d) => varFromLog(d.theta[0], Math.sqrt(d.next), q)).sort((a, b) => a - b) : null;
  const levelText = fmt.pct(state.level, 0);
  sVar.set(`${pct1(var1)} loss`, varBand ? `${levelText} level, for ${nextDay}; 90% interval ${pct1(sortedQuantile(varBand, 0.05))} to ${pct1(sortedQuantile(varBand, 0.95))}` : `${levelText} level, for ${nextDay}; no interval`);

  const warns = [];
  if (fit.boundary) warns.push(note("warn", `α + β = ${fmt.num(fit.persistence, 4)}, at or next to the edge of what the model allows (it must stay below 1), or one of α and β is close to zero. Shocks to volatility then barely fade, the long-run level is not pinned down, and the standard errors and intervals should not be trusted. Try a later start date.`));
  if (!draws) warns.push(note("warn", "The estimates' covariance could not be used here, so the forecasts show no allowance for uncertainty in the parameters."));
  warnBox.replaceChildren(...warns);

  // Volatility over time, with the stormy runs shaded.
  const x = (k) => toYear(dateAt(c.start, i0 + 1 + k)); // return k is the change into day i0 + 1 + k
  const longRun = Number.isFinite(fit.longRunVar) && !fit.boundary ? annual(fit.longRunVar) : null;
  const spans = runs(reg.labels).filter((s) => s.label === "stormy").map((s) => ({ type: "span", x0: x(s.from), x1: x(s.to + 1 <= r.length - 1 ? s.to + 1 : s.to), color: "#e34948", opacity: 0.12 }));
  const marks = [...spans,
    { type: "hline", y: annual(reg.high * reg.high), text: `stormy above ${pct0(annual(reg.high * reg.high))}` },
    { type: "hline", y: annual(reg.low * reg.low), text: `calm below ${pct0(annual(reg.low * reg.low))}` }];
  volChart.update({
    title: `${c.name}: fitted volatility, annualised`,
    subtitle: `The model's volatility for each day from the days before it, as a percentage a year (daily volatility times √365). Shaded: stormy days, the top quarter. ${longRun ? `Long-run level ${pct0(longRun)} a year.` : "No finite long-run level at these estimates."}`,
    label: `Line chart of the fitted annualised volatility of ${c.name} from ${fmt.date(first)} to ${fmt.date(last)}, with stormy periods shaded`,
    x: { format: dateLabel, label: "Date" },
    y: { label: "Volatility, % a year", format: (v) => fmt.num(v, 0), zero: true },
    series: [{ name: "Fitted volatility", type: "line", data: Array.from(reg.sigma, (s, k) => [x(k), s * Math.sqrt(DAYS_PER_YEAR)]), color: 0, width: 1.4 }],
    marks,
  });
  priceChart.update({
    title: `${c.name}: price`,
    subtitle: "US dollars at the end of each day, on a log scale, so equal distances are equal percentage moves.",
    label: `Line chart of the daily price of ${c.name} in US dollars on a log scale`,
    x: { format: dateLabel, label: "Date" },
    y: { type: "log", label: "US dollars", format: usd },
    // From the first return's day, so that the two charts share their dates.
    series: [{ name: "Price", type: "line", data: prices.slice(1).map((p, k) => [x(k), p]), color: 0, width: 1.3 }],
  });

  // Parameter table.
  const se = fit.se, seH = fit.seHessian;
  const sd = (v) => sigFixed(v, 2);
  paramBox.replaceChildren(rtable({
    caption: `Estimates for ${c.name}, returns in percent a day (maximum likelihood, ${fmt.int(r.length)} days)`,
    columns: [{ key: "name", label: "Parameter" }, { key: "est", label: "Estimate", num: true }, { key: "se", label: "Robust standard error", num: true }, { key: "seh", label: "Standard error from the Hessian", num: true }, { key: "means", label: "What it means" }],
    rows: [
      { name: "μ (mean return)", est: sigFixed(fit.mu, 3), se: sd(se[0]), seh: sd(seH[0]), means: "average daily log return, percent" },
      { name: "ω", est: sigFixed(fit.omega, 3), se: sd(se[1]), seh: sd(seH[1]), means: "variance added every day" },
      { name: "α", est: sigFixed(fit.alpha, 3), se: sd(se[2]), seh: sd(seH[2]), means: "weight on yesterday's squared surprise" },
      { name: "β", est: sigFixed(fit.beta, 3), se: sd(se[3]), seh: sd(seH[3]), means: "weight on yesterday's variance" },
      { name: "α + β", est: fmt.num(fit.persistence, 4), se: "", seh: "", means: Number.isFinite(fit.halfLife) && fit.halfLife < 1e4 ? `persistence: half-life ${fmt.num(fit.halfLife, 1)} days` : "persistence: shocks do not fade" },
      { name: "Long-run volatility", est: longRun ? `${pct0(longRun)} a year` : "none", se: "", seh: "", means: "√(ω / (1 − α − β)) × √365" },
    ],
  }));

  status.textContent = `${c.name} from ${fmt.date(first)}. Volatility for ${nextDay}: ${pct0(volNow)} a year, a ${regimeNow} regime, higher than on ${fmt.num(rank, 0)}% of days. Persistence ${fmt.num(fit.persistence, 3)}. One-day ${levelText} value at risk: a loss of ${pct1(var1)}.`;

  forecast();
  runBacktest();
}

/* ---------- the forecast over the horizon ---------- */
function forecast() {
  if (!current) return;
  const { c, fit, draws, prices } = current;
  const H = state.horizon;
  const path = forecastVariance(fit.theta, fit.next, H);
  const bands = draws ? draws.map((d) => forecastVariance(d.theta, d.next, H)) : null;
  const days = Array.from({ length: H }, (_, k) => k + 1);
  const longRun = Number.isFinite(fit.longRunVar) && !fit.boundary ? annual(fit.longRunVar) : null;
  pathChart.update({
    title: `Volatility forecast, next ${H} ${H === 1 ? "day" : "days"}`,
    subtitle: `Annualised. The band is the middle 90% of the forecasts from ${DRAWS} sets of parameters drawn from the estimates' sampling distribution.${longRun ? " The forecast drifts towards the long-run level." : ""}`,
    label: `Line chart of the forecast annualised volatility of ${c.name} for the next ${H} days with a 90% band`,
    x: { label: "Days ahead", domain: [1, Math.max(2, H)], format: (v) => fmt.int(v) },
    y: { label: "Volatility, % a year", format: (v) => fmt.num(v, 0), zero: true },
    series: [
      ...(bands ? [{ name: "90% band", type: "range", data: days.map((d, k) => { const col = bands.map((b) => annual(b[k])).sort((a, b) => a - b); return [d, sortedQuantile(col, 0.05), sortedQuantile(col, 0.95)]; }), color: 0, opacity: 0.18 }] : []),
      { name: "Forecast", type: "line", data: days.map((d, k) => [d, annual(path[k])]), color: 0 },
    ],
    marks: longRun ? [{ type: "hline", y: longRun, text: `long run ${pct0(longRun)}` }] : [],
  });

  const qs = simulatePaths(fit, { horizon: H, paths: PATHS, seed: SEED, shocks: state.shocks, draws, probs: PROBS });
  const chg = (logPct) => (Math.exp(logPct / 100) - 1) * 100;
  const at = (k, j) => chg(qs[k][j]);
  fanChart.update({
    title: `Range of simulated price changes over the next ${H} ${H === 1 ? "day" : "days"}`,
    subtitle: `${fmt.int(PATHS)} simulated paths, ${state.shocks === "normal" ? "normal shocks" : "shocks drawn from the model's past surprises"}, each with its own draw of the parameters. From the darkest band outwards, the bands hold the middle 50%, 90% and 98% of paths; the line is the median.`,
    legend: false,
    label: `Fan chart of simulated percentage changes in the price of ${c.name} over the next ${H} days`,
    x: { label: "Days ahead", domain: [0, Math.max(1, H)], format: (v) => fmt.int(v) },
    y: { label: "Change from the last price, %", format: (v) => fmt.signed(v, 0) },
    series: [
      { name: "98% of paths", type: "range", data: [[0, 0, 0], ...qs.map((_, k) => [k + 1, at(k, 0), at(k, 6)])], color: 6, opacity: 0.1 },
      { name: "90% of paths", type: "range", data: [[0, 0, 0], ...qs.map((_, k) => [k + 1, at(k, 1), at(k, 5)])], color: 6, opacity: 0.16 },
      { name: "50% of paths", type: "range", data: [[0, 0, 0], ...qs.map((_, k) => [k + 1, at(k, 2), at(k, 4)])], color: 6, opacity: 0.26 },
      { name: "Median", type: "line", data: [[0, 0], ...qs.map((_, k) => [k + 1, at(k, 3)])], color: 6 },
    ],
    marks: [{ type: "hline", y: 0 }],
  });
  const lastPrice = prices[prices.length - 1];
  const end = qs[H - 1];
  fanNote.textContent = `After ${H} ${H === 1 ? "day" : "days"}, 90% of the simulated paths end between ${fmt.signed(chg(end[1]), 0)}% and ${fmt.signed(chg(end[5]), 0)}% (${usd(lastPrice * Math.exp(end[1] / 100))} to ${usd(lastPrice * Math.exp(end[5] / 100))} from ${usd(lastPrice)} on ${fmt.date(lastDate(c))}); 1% of them lose more than ${fmt.num(-chg(end[0]), 0)}%. This is what the model implies if the future resembles the window it was fitted to, not a prediction of the price.`;
}

/* ---------- the backtest, a block at a time ---------- */
let job = 0;
function runBacktest() {
  const id = ++job;
  const { r, c, i0 } = current;
  const level = state.level, shocks = state.shocks;
  const plan = backtestPlan(r.length, FIRST_TEST, REFIT_EVERY);
  const ewma = ewmaStart(r, FIRST_TEST);
  const rows = [];
  const firstDay = dateAt(c.start, i0 + 1 + FIRST_TEST), lastDay = lastDate(c);
  testIntro.textContent = `Each day from ${fmt.date(firstDay)} to ${fmt.date(lastDay)} gets a ${fmt.pct(level, 0)} value at risk from data before that day only. The GARCH model is re-estimated every ${REFIT_EVERY} days on everything before (the first ${fmt.int(FIRST_TEST)} days are only for fitting) and uses ${shocks === "normal" ? "normal shocks" : "the quantile of its own past standardised surprises"}. It is compared with two common rules: RiskMetrics (an exponentially weighted variance, λ = 0.94, normal shocks) and historical simulation (the ${fmt.pct(1 - level, 0)} quantile of the previous 250 days).`;
  testBox.replaceChildren();
  testStatus.textContent = "";
  let b = 0;
  const step = () => {
    if (id !== job) return;
    const t0 = performance.now();
    while (b < plan.length && performance.now() - t0 < 30) rows.push(...backtestBlock(r, plan[b++], { level, shocks, ewma }).rows);
    if (b < plan.length) { progress.textContent = `Re-estimating: ${b} of ${plan.length} fits done.`; setTimeout(step, 0); return; }
    progress.textContent = "";
    showBacktest(scoreBacktest(rows, level), level, rows.length);
  };
  progress.textContent = `Re-estimating: 0 of ${plan.length} fits done.`;
  setTimeout(step, 0);
}

function showBacktest(s, level, n) {
  const expected = n * (1 - level);
  const names = { garch: "GARCH(1,1)", ewma: "RiskMetrics", hist: "Historical, 250 days" };
  const verdict = (m) => (m.pValue < 0.05 ? (m.rate > 1 - level ? "too many: rejected at 5%" : "too few: rejected at 5%") : "consistent at 5%");
  const pv = (p) => (p < 0.001 ? "below 0.001" : fmt.num(p, 3));
  const best = Object.keys(names).reduce((a, k) => (s[k].loss < s[a].loss ? k : a), "garch");
  testBox.replaceChildren(
    rtable({
      caption: `${fmt.int(n)} days; ${fmt.num(expected, 1)} exceedances expected at ${fmt.pct(level, 0)}`,
      columns: [{ key: "name", label: "Method" }, { key: "x", label: "Days the loss exceeded it", num: true }, { key: "rate", label: "Share of days", num: true }, { key: "p", label: "Kupiec p-value", num: true }, { key: "v", label: "Verdict" }, { key: "loss", label: "Quantile loss (lower is better)", num: true }],
      rows: Object.keys(names).map((k) => ({ name: names[k], x: fmt.int(s[k].exceedances), rate: fmt.pct(s[k].rate, 2), p: pv(s[k].pValue), v: verdict(s[k]), loss: fmt.num(s[k].loss, 4) })),
    }),
    el("p", { class: "small muted", text: `Kupiec's test asks whether the share of exceedances could be ${fmt.pct(1 - level, 0)} by chance; it says nothing about whether they bunch together. The quantile loss scores the whole forecast, not just the misses: ${names[best]} has the lowest here. A method can pass Kupiec's test and still lose on this score.` }));
  testStatus.textContent = `Backtest over ${fmt.int(n)} days: GARCH exceeded on ${s.garch.exceedances} days (${fmt.pct(s.garch.rate, 2)}), RiskMetrics on ${s.ewma.exceedances}, historical simulation on ${s.hist.exceedances}, against ${fmt.num(expected, 1)} expected.`;
}

fillFrom();
update();
