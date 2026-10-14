// Day 69: Bubble Detector. Interface.
import { $, el, fmt, mount, select, segmented, slider, button, stat, note, chart } from "../kit/kit.js";
import { SERIES } from "./data.js";
import { CRITICAL } from "./critical.js";
import { bubbleTests, rankAgainst, criticalValue, criticalError, verdict, episodes, minDuration, monthAt, powerSteps, emptyPower, trendOf } from "./logic.js";
import { rng } from "../kit/kit.js";

mount();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (ym) => `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const shortMonth = (ym) => `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(0, 4)}`;
const yearOf = (ym) => Number(ym.slice(0, 4)) + (Number(ym.slice(5)) - 1) / 12;
const ymOf = (v) => { const k = Math.round(v * 12); return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; };
const seriesOf = (id) => SERIES.series.find((s) => s.id === id);
const setup = (s) => { const c = CRITICAL.series[s.id]; return { ...c, dist: CRITICAL.dist[`${c.T}-${c.k}`] }; };
const cvAt = (dist, level) => (level === 0.9 ? dist.cv90 : level === 0.99 ? dist.cv99 : dist.cv95);
const levelText = (level) => fmt.pct(level, 0);
const signedPct = (r) => `${fmt.signed(100 * r, 0)}%`;
const months = (n) => `${fmt.int(n)} ${n === 1 ? "month" : "months"}`;

const state = { id: "btc", level: 0.95, growth: 2, length: 24, kind: "rw", pairs: 100 };

/* ---------- controls ---------- */
const assetSelect = select({
  label: "Asset", value: state.id,
  options: SERIES.series.map((s) => ({ value: s.id, label: s.name })),
  onChange: (v) => { state.id = v; update(); },
});
const levelSeg = segmented({
  label: "Significance level", value: String(state.level),
  options: [{ value: "0.9", label: "10%" }, { value: "0.95", label: "5%" }, { value: "0.99", label: "1%" }],
  hint: "The false-alarm rate the critical values allow on random walks. 5% is the usual choice.",
  onChange: (v) => { state.level = Number(v); update(); },
});
const about = el("div", { class: "small muted source-note" });
const controls = el("div", { class: "controls" }, assetSelect.el, levelSeg.el,
  note("", "A statistical test on past prices, not investment advice. An explosive episode is a pattern in the data, not proof of irrational buying, and the test says nothing about when it ends."),
  about);

/* ---------- outputs ---------- */
const sScore = stat("Latest bubble score");
const sWhole = stat("Whole history (GSADF)");
const sPwy = stat("From the start (SADF)");
const sEpisodes = stat("Explosive episodes dated");
const status = el("p", { class: "sr-only", role: "status" });
const trust = el("div");
const priceBox = el("div"), statBox = el("div");
const episodeBox = el("div");

// The simulation panel.
const simHead = el("h2", { text: "Does the test work? Try it on simulated prices" });
const simIntro = el("p", { class: "small muted" });
const growthSlider = slider({ label: "Growth during the bubble", min: 0.5, max: 4, step: 0.25, value: state.growth, format: (v) => `${fmt.num(v, 2)}% a month`, onInput: (v) => { state.growth = v; } });
const lengthSlider = slider({ label: "Length of the bubble", min: 6, max: 48, step: 1, value: state.length, format: (v) => months(v), onInput: (v) => { state.length = v; } });
const kindSeg = segmented({
  label: "Paths with no bubble", value: state.kind,
  options: [{ value: "rw", label: "Random walks" }, { value: "avg", label: "Monthly averages of daily walks" }, { value: "trend", label: "Random walks with this series' trend" }],
  hint: "Every real series here is a monthly average. Averaging makes consecutive changes correlated, which the lags in the test have to absorb. The third kind adds a steady trend as large, relative to the month-to-month noise, as the chosen series' own.",
  onChange: (v) => { state.kind = v; },
});
const pairsSelect = select({ label: "Paths of each kind", value: String(state.pairs), options: ["100", "250", "500"], onChange: (v) => { state.pairs = Number(v); } });
const runButton = button("Run the simulation", () => runSimulation(), { primary: true });
const simProgress = el("p", { class: "small muted", role: "status" });
const simResult = el("div");
const simChartBox = el("div");
const simPanel = el("div", { class: "panel stack" }, simHead, simIntro,
  el("div", { class: "grid2" }, growthSlider.el, lengthSlider.el, kindSeg.el, pairsSelect.el),
  el("div", { class: "row" }, runButton, el("span", { class: "small muted", text: "New settings take effect when you run it again." })), simProgress, simResult, simChartBox);

const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sScore.el, sWhole.el, sPwy.el, sEpisodes.el), status, trust,
  priceBox, statBox, episodeBox, simPanel);
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const priceChart = chart(priceBox, { series: [], height: 280 });
const statChart = chart(statBox, { series: [], height: 260 });
const simChart = chart(simChartBox, { series: [], height: 220, empty: "Run the simulation to see an example path" });

function rtable({ caption, columns, rows }) {
  return el("div", { class: "rt-wrap" }, el("table", { class: "tbl rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {}, columns.map((c, k) => (k === 0
      ? el("th", { scope: "row", text: r[c.key] })
      : el("td", { class: c.num ? "num" : null, "data-label": c.label, text: r[c.key] }))))))));
}

/* ---------- the real series ---------- */
function update() {
  job++;
  const s = seriesOf(state.id);
  const { T, k, dist } = setup(s);
  const y = s.values.map(Math.log);
  const res = bubbleTests(y, CRITICAL.w0, k);
  const level = state.level, cv = cvAt(dist, level);
  const L = minDuration(T);
  const ep = episodes(res.bsadf, cv, L);
  const last = monthAt(s.start, T - 1);
  const src = SERIES.sources[s.source];
  about.replaceChildren(el("strong", { text: `${s.name}, ${monthName(s.start)} to ${monthName(last)}, ${fmt.int(T)} months. ` },),
    `${s.detail}${s.filled?.length ? ` BLS published no rent figure for October 2025 (the 2025 lapse in appropriations); that month is filled with the geometric mean of September and November.` : ""} The test runs on the natural log of the series. Source: ${src.name}, ${src.licence}, retrieved ${fmt.date(SERIES.retrieved)}.`);

  const reps = CRITICAL.reps, at = levelText(1 - level);
  const score = rankAgainst(dist.bsadfEnd, res.bsadf[T - 1]);
  const cvNow = criticalValue(dist.bsadfEnd, level), eNow = criticalError(dist.bsadfEnd, level, reps);
  const vNow = verdict(res.bsadf[T - 1], cvNow, eNow);
  const lastShort = shortMonth(last);
  const said = (v, what) => (v === "explosive" ? `${what} at the ${at} level` : v === "not explosive" ? `not ${what} at the ${at} level` : `on the edge at ${at}: within twice the simulation error of the critical value`);
  sScore.set(`${score} of 100`, `${monthName(last)}, the last month of data: its statistic (${fmt.num(res.bsadf[T - 1], 2)}) is higher than on ${score}% of random walks; ${said(vNow, `explosive in ${lastShort}`)}`);
  const cvG = criticalValue(dist.gsadf, level), cvS = criticalValue(dist.sadf, level);
  const vG = verdict(res.gsadf, cvG, criticalError(dist.gsadf, level, reps)), vS = verdict(res.sadf, cvS, criticalError(dist.sadf, level, reps));
  sWhole.set(fmt.num(res.gsadf, 2), `${vG === "explosive" ? "explosive somewhere" : vG === "not explosive" ? "no explosive episode" : "on the edge"} at ${at}: critical value ${fmt.num(cvG, 2)} ± ${fmt.num(2 * criticalError(dist.gsadf, level, reps), 2)}; highest in ${shortMonth(monthAt(s.start, res.gsadfAt))}`);
  sPwy.set(fmt.num(res.sadf, 2), `${vS === "on the edge" ? "on the edge" : vS} at ${at}: critical value ${fmt.num(cvS, 2)} ± ${fmt.num(2 * criticalError(dist.sadf, level, reps), 2)}`);
  sEpisodes.set(fmt.int(ep.kept.length), `lasting ${L} months or more; ${ep.brief.length} shorter ${ep.brief.length === 1 ? "crossing" : "crossings"} ignored`);
  status.textContent = `${s.name}. Bubble score for ${monthName(last)}, the last month of data, ${score} of 100: ${said(vNow, `explosive in ${lastShort}`)}. Whole-history GSADF ${fmt.num(res.gsadf, 2)} against a critical value of ${fmt.num(cvG, 2)}: ${vG}. ${ep.kept.length} explosive ${ep.kept.length === 1 ? "episode" : "episodes"} dated.`;

  const tr = trendOf(s.values);
  trust.replaceChildren(note("warn", `How far to trust these verdicts: the critical values assume a random walk with steady volatility and almost no trend. ${s.name} rose by ${fmt.num(100 * tr.mean, 2)}% a month on average (in logs), against month-to-month moves of ${fmt.num(100 * tr.sd, 1)}% (standard deviation). A trend, or bursts of volatility, make the tests fire more often than the level says; "Random walks with this series' trend" in the simulation below measures the trend's effect. With six assets, three levels and four statistics to look at, one verdict alone is weak evidence.`));

  const P = s.values;
  // Price with the dated episodes shaded.
  const x = (i) => yearOf(monthAt(s.start, i));
  priceChart.update({
    title: `${s.name}${s.id === "house" ? "" : ": price"}, with explosive episodes shaded`,
    subtitle: `${s.unit}, on a log scale. Shaded: months the backward sup ADF test dates as explosive at the ${levelText(1 - level)} level, in runs of ${L} months or more.`,
    label: `Line chart of ${s.name} on a log scale with the dated explosive episodes shaded`,
    x: { format: (v) => shortMonth(ymOf(v)), label: "Month" },
    y: { type: "log", label: s.unit, format: (v) => (v >= 1000 ? fmt.compact(v) : fmt.sig(v, 2)) },
    series: [{ name: s.name, type: "line", data: s.values.map((v, i) => [x(i), v]), color: 0, width: 1.4 }],
    marks: ep.kept.map((e) => ({ type: "span", x0: x(e.from) - 1 / 24, x1: x(e.to) + 1 / 24, color: "#e34948", opacity: 0.16 })),
  });
  statChart.update({
    title: "Backward sup ADF statistic and its critical value",
    subtitle: `For each month, the largest ADF statistic over windows of at least ${CRITICAL.w0} months that end there, with ${k} lagged ${k === 1 ? "difference" : "differences"}. Above the line is explosive at ${levelText(1 - level)}.`,
    label: `Line chart of the backward sup ADF statistic for ${s.name} against its ${levelText(level)} critical value`,
    x: { format: (v) => shortMonth(ymOf(v)), label: "Month" },
    y: { label: "t statistic", format: (v) => fmt.num(v, 1) },
    series: [
      { name: "Backward sup ADF", type: "line", data: Array.from(res.bsadf, (v, i) => [x(i), Number.isFinite(v) ? v : null]), color: 0, width: 1.4 },
      { name: `${levelText(level)} critical value`, type: "line", data: cv.map((v, i) => [x(i), v]), color: "#16233b", width: 1.2, dash: true },
    ],
  });

  const falls = ep.kept.some((e) => P[e.to] < P[Math.max(0, e.from - 1)]);
  const caution = el("p", { class: "small muted", text: `Dating checks every month against its own critical value, so over a long history it also finds episodes in random walks, more often the longer the history: the simulation below counts how often. The whole-history tests above hold their false-alarm rate at the chosen level, but only for random walks without a strong trend.${falls ? " An episode can come with a fall: the test flags a series that moves away from its recent level faster and faster in either direction." : ""}` });
  episodeBox.replaceChildren(ep.kept.length
    ? rtable({
      caption: `Explosive episodes in ${s.name}`,
      columns: [{ key: "from", label: "From" }, { key: "to", label: "To" }, { key: "n", label: "Months", num: true }, { key: "during", label: "Change during", num: true }, { key: "after", label: "Change in the next 12 months", num: true }],
      rows: ep.kept.map((e) => ({
        from: shortMonth(monthAt(s.start, e.from)), to: shortMonth(monthAt(s.start, e.to)), n: fmt.int(e.length),
        during: signedPct(P[e.to] / P[Math.max(0, e.from - 1)] - 1),
        after: e.to + 12 < T ? signedPct(P[e.to + 12] / P[e.to] - 1) : "not yet known",
      })),
    })
    : note("", `No run of ${L} months or more with the statistic above its ${levelText(level)} critical value.`), caution);

  simIntro.textContent = `Simulated series of the same length as ${s.name} (${fmt.int(T)} months), tested with exactly the same lags (${k}), minimum window and ${levelText(level)} critical values. Bubble paths follow Phillips, Wu and Yu: a random walk that starts at 100 with steps of standard deviation 1, then grows explosively from 40% of the way in, then collapses to where the bubble began. Their noise is about 1% of their level a month, against month-to-month moves of ${fmt.num(100 * tr.sd, 1)}% for ${s.name}${tr.sd > 0.015 ? ", so the power shown is for a calmer market than this one: the same growth inside larger swings is harder to see" : ""}. The share of no-bubble paths flagged is the false-alarm rate; the share of bubble paths flagged is the power.`;
  runSimulation();
}

/* ---------- the simulation, in slices ---------- */
let job = 0;
function runSimulation() {
  const id = ++job;
  const s = seriesOf(state.id);
  const { T, k, dist } = setup(s);
  const level = state.level, delta = 1 + state.growth / 100, length = state.length, pairs = state.pairs, kind = state.kind;
  const crit = { gsadf: dist.gsadf, sadf: dist.sadf, cv90: dist.cv90, cv95: dist.cv95, cv99: dist.cv99 };
  const rand = rng(6900 + T + k);
  const drift = kind === "trend" ? trendOf(s.values).ratio : null;
  const tally = emptyPower();
  let example = null, pair = null;
  simResult.replaceChildren();
  const step = () => {
    if (id !== job) return;
    const t0 = performance.now();
    // One pair of paths can take longer than a slice for the long series, so each pair is itself cut into pieces.
    while (tally.n < pairs && performance.now() - t0 < 30) {
      pair ??= powerSteps(tally, { T, w0: CRITICAL.w0, k, crit, level, delta, length, rand, averaged: kind === "avg", drift });
      const r = pair.next();
      if (r.done) { example = r.value; pair = null; }
    }
    if (tally.n < pairs) { simProgress.textContent = `Simulating: ${tally.n} of ${pairs} pairs of paths tested.`; setTimeout(step, 0); return; }
    simProgress.textContent = `Done: ${pairs} paths of each kind.`;
    showSimulation(tally, example, { T, level, length, delta, kind });
  };
  simProgress.textContent = `Simulating: 0 of ${pairs} pairs of paths tested.`;
  setTimeout(step, 0);
}

function showSimulation(t, ex, { T, level, length, delta, kind }) {
  const rate = (x) => x / t.n;
  const pm = (x) => `${fmt.pct(rate(x), 0)} ± ${fmt.pct(2 * Math.sqrt(rate(x) * (1 - rate(x)) / t.n), 0)}`;
  simResult.replaceChildren(rtable({
    caption: `${t.n} paths of each kind, ${fmt.int(T)} months, ${levelText(1 - level)} level (± two standard errors of the simulation)`,
    columns: [{ key: "what", label: "Test" }, { key: "fa", label: `False alarms (${kind === "avg" ? "averaged walks" : kind === "trend" ? "walks with the trend" : "random walks"})`, num: true }, { key: "pw", label: "Power (bubble paths)", num: true }],
    rows: [
      { what: "GSADF, whole history", fa: pm(t.nullG), pw: pm(t.bubG) },
      { what: "SADF, whole history", fa: pm(t.nullS), pw: pm(t.bubS) },
      { what: `Dating: an episode of ${minDuration(T)}+ months found (inside the bubble, for bubble paths)`, fa: pm(t.nullDated), pw: pm(t.bubDated) },
    ],
  }), el("p", { class: "small muted", text: `${kind === "trend" ? `On random walks with no trend the whole-history tests flag about ${levelText(1 - level)} of the paths; a steady trend makes them fire more often, because the critical values assume almost none.` : `The whole-history tests should flag about ${levelText(1 - level)} of the paths with no bubble.`} Dating is looser: it checks every month against its own critical value, so the chance of at least one false episode somewhere in a long history is higher than the level.` }));
  const xs = (i) => i;
  const e = episodes(ex.bub.bsadf, cvAt(CRITICAL.dist[`${T}-${CRITICAL.series[state.id].k}`], level), minDuration(T)).kept;
  simChart.update({
    title: "The last simulated bubble path",
    subtitle: `True bubble: months ${ex.te} to ${ex.tf}, growing ${fmt.num((delta - 1) * 100, 2)}% a month for ${length} months, then collapsing. Shaded: what the dating found.`,
    label: "Line chart of one simulated bubble path with the dated explosive months shaded",
    x: { label: "Month of the simulation", format: (v) => fmt.int(v) },
    y: { label: "Simulated price", format: (v) => fmt.num(v, 0) },
    series: [{ name: "Bubble path", type: "line", data: Array.from(ex.bubPath, (v, i) => [xs(i), v]), color: 0, width: 1.3 }],
    marks: [{ type: "vline", x: ex.te, text: "bubble starts" }, { type: "vline", x: ex.tf, text: "peak" },
      ...e.map((r) => ({ type: "span", x0: r.from - 0.5, x1: r.to + 0.5, color: "#e34948", opacity: 0.16 }))],
  });
}

update();
