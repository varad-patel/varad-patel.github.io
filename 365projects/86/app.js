// Day 86: Election Forecast Model. Interface.
import { $, el, fmt, mount, slider, segmented, select, button, stat, note, chart, stats, debounce, randomSeed } from "../kit/kit.js";
import { ELECTIONS as E } from "../data/elections.js";
import { YEARS, LAG, DEFAULTS, aggregate, simulator, summarise, forecastDate, check } from "./logic.js";

mount();

const surname = (name) => name.split(" ").at(-1);
const SLICE = 1000;
const pct = (p) => (p < 0.001 ? "under 0.1%" : p > 0.999 ? "over 99.9%" : fmt.pct(p, 1)); // a share of simulations, so never exactly 0 or 1
/** A share of simulations in whole percent that never rounds a few cases to "0%" or all but a few to "100%". */
const pct0 = (p) => (p > 0 && p < 0.005 ? "under 1%" : p < 1 && p > 0.995 ? "over 99%" : fmt.pct(p, 0));
const dateText = (iso) => fmt.date(iso);
const days = (n) => `${n} ${n === 1 ? "day" : "days"}`;
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;

const state = { ...DEFAULTS, year: 2020 };

/* ---------- controls ---------- */
const yearSeg = segmented({
  label: "Election", value: "2020", options: YEARS.map((y) => ({ value: String(y), label: `${y}: ${surname(E.results[y].dem)} v ${surname(E.results[y].rep)}` })),
  onChange: (v) => { state.year = Number(v); daySlider.value = state.daysBefore; changed(); },
});
const dayLabel = (d) => {
  const iso = forecastDate(E.polls.cycles[String(state.year)].election, d);
  return d === 0 ? `${dateText(iso)}, election day` : `${dateText(iso)}, ${days(d)} before`;
};
const daySlider = slider({
  label: "Forecast made on", min: 0, max: 59, step: 1, value: 0, format: dayLabel,
  hint: `Only polls whose fieldwork had its middle day at least ${LAG} days earlier are used. The file gives no publication dates, so this stands in for what was public that morning.`,
  onInput: (v) => { state.daysBefore = v; changedSoon(); },
});
const pts = (v) => `${fmt.num(v, 1)} points`;
const natSlider = slider({ label: "National polling error", min: 0, max: 6, step: 0.1, value: state.natSd, format: pts, hint: "One standard deviation of the error all polls share, in points of the Democrat's share of the two-party vote.", onInput: (v) => { state.natSd = v; changedSoon(); } });
const stateSlider = slider({ label: "State polling error", min: 0, max: 6, step: 0.1, value: state.stateSd, format: pts, hint: "One standard deviation of each state's own error on top of the national one. A state's districts share it.", onInput: (v) => { state.stateSd = v; changedSoon(); } });
const tailSeg = segmented({ label: "Size of rare errors", value: "normal", options: [{ value: "normal", label: "Normal" }, { value: "fat", label: "Fat tails" }], hint: "Fat tails draw the errors from Student's t with 5 degrees of freedom: same spread, more large misses.", onChange: (v) => { state.tails = v; changed(); } });
const driftSlider = slider({ label: "Opinion drift per 30 days", min: 0, max: 4, step: 0.1, value: state.drift, format: pts, hint: "Extra national uncertainty for opinion that can still move before the vote. Zero on election day.", onInput: (v) => { state.drift = v; changedSoon(); } });
const tauSlider = slider({ label: "Prior spread", min: 0.5, max: 15, step: 0.5, value: state.tau, format: pts, hint: "How far a state may stray from last time's result moved by the national swing, before its polls are seen.", onInput: (v) => { state.tau = v; changedSoon(); } });
const halfSlider = slider({ label: "Poll half-life", min: 1, max: 90, step: 1, value: state.halfLife, format: (v) => days(v), hint: "A poll this many days old counts half as much as one from the forecast day.", onInput: (v) => { state.halfLife = v; changedSoon(); } });
const simSel = select({ label: "Simulated elections", value: String(state.sims), options: [5000, 20000, 50000].map((n) => ({ value: String(n), label: fmt.int(n) })), onChange: (v) => { state.sims = Number(v); changed(); } });
const seedLine = el("p", { class: "small muted" });
const seedBtn = button("Run again with a new seed", () => { state.seed = randomSeed(); changed(); }, { small: true });
const resetBtn = button("Reset to defaults", () => { setAll({ ...DEFAULTS, year: state.year }); changed(); }, { small: true });

const PRESETS = [
  { label: "Default errors (1.5 and 1.5)", set: {} },
  { label: "Small errors (0.5 and 0.5)", set: { natSd: 0.5, stateSd: 0.5 } },
  { label: "Errors that move together (3 and 1)", set: { natSd: 3, stateSd: 1 } },
  { label: "Independent states (0 and 3)", set: { natSd: 0, stateSd: 3 } },
  { label: "Large and fat-tailed (3, 3, fat)", set: { natSd: 3, stateSd: 3, tails: "fat" } },
];
function setAll(o) {
  Object.assign(state, o);
  daySlider.value = state.daysBefore; natSlider.value = state.natSd; stateSlider.value = state.stateSd; driftSlider.value = state.drift;
  tauSlider.value = state.tau; halfSlider.value = state.halfLife; tailSeg.value = state.tails; simSel.value = String(state.sims);
}
const presetRow = el("div", { class: "row d86-presets", role: "group", "aria-label": "Error presets" },
  PRESETS.map((p) => button(p.label, () => { setAll({ ...DEFAULTS, year: state.year, daysBefore: state.daysBefore, sims: state.sims, ...p.set }); changed(); }, { small: true })));

const src = E.sources;
const about = el("div", { class: "small muted d86-source" },
  el("strong", { text: "Data. " }),
  "Polls: FiveThirtyEight's raw_polls.csv, every presidential poll it rated whose fieldwork's middle day fell in the last 61 days before the election (",
  el("a", { href: src.polls.url, text: "538 on GitHub" }), ", ", el("a", { href: src.polls.licenceUrl, text: "CC BY 4.0" }),
  `, retrieved ${fmt.date(src.polls.retrieved)}). Changes: only presidential general-election polls are kept, Maine and Nebraska districts are renamed, and each poll is turned into the Democrat's share of the two-party vote. `,
  "Results: the Federal Election Commission's certified state totals (public domain) and, for the districts of Maine and Nebraska, the votes on the states' certificates of ascertainment held by the National Archives. ",
  "This is a reconstruction of a past forecast to show the method, not a prediction of any future election.");

const controls = el("div", { class: "controls" },
  yearSeg.el, daySlider.el,
  el("div", { class: "field d86-group", role: "group", "aria-labelledby": "d86-err" }, el("p", { class: "d86-grouphead", id: "d86-err", text: "Polling-error assumptions" }), natSlider.el, stateSlider.el, tailSeg.el, driftSlider.el, presetRow),
  el("div", { class: "field d86-group", role: "group", "aria-labelledby": "d86-agg" }, el("p", { class: "d86-grouphead", id: "d86-agg", text: "Aggregation" }), tauSlider.el, halfSlider.el, simSel.el),
  el("div", { class: "row" }, seedBtn, resetBtn), seedLine, about);

/* ---------- outputs ---------- */
const sWin = stat("Chance of winning the electoral college");
const sEv = stat("Electoral votes, median");
const sActual = stat("What happened");
const sBrier = stat("Brier score over 56 contests");
const progress = el("p", { class: "small muted d86-progress" });
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div");
const evBox = el("div");
const scoreBox = el("div", { class: "panel d86-stack", id: "d86-score" });
const oneBox = el("div", { class: "panel d86-stack", id: "d86-one" });
const tableBox = el("div", { class: "d86-tbl" });
const unitDetails = el("details", { class: "d86-units", id: "d86-units" }, el("summary", { text: "Every state and district: polls, forecast and result" }), tableBox);
const out = el("div", { class: "out" },
  el("div", { class: "stats", id: "d86-results" }, sWin.el, sEv.el, sActual.el, sBrier.el), progress, status, message, evBox, scoreBox, oneBox);
// The table of every contest sits below both columns, where it has the tool's full width.
// On a narrow screen the results come after a long column of controls.
const jump = el("nav", { class: "row d86-jump", "aria-label": "Jump to the results" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d86-results", "the forecast"], ["#d86-score", "the score"], ["#d86-one", "one election"], ["#d86-units", "every contest"]].map(([href, text]) => el("a", { href, class: "small", text, onclick: href === "#d86-units" ? () => { unitDetails.open = true; } : null })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out), unitDetails);

const evChart = chart(evBox, { series: [], height: 300 });
const oneHead = el("h2", { text: "What one election can and cannot tell you" });
const oneText = el("div");
const oneChartBox = el("div");
oneBox.append(oneHead, oneText, oneChartBox);
const oneChart = chart(oneChartBox, { series: [], height: 240 });

/* ---------- a table that becomes a list of labelled lines when its box is narrow ---------- */
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl d86-rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {},
      columns.map((c, k) => el(k === 0 ? "th" : "td", { scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/* ---------- running ---------- */
let job = 0;
const changedSoon = debounce(() => changed(), 180);
function changed() {
  const id = ++job;
  const bad = check(state);
  if (bad.length) { message.replaceChildren(note("bad", bad.join(" "))); progress.textContent = ""; return; }
  message.replaceChildren();
  const year = state.year;
  const agg = aggregate(E, year, state), pri = aggregate(E, year, { ...state, statePolls: false });
  const sim = simulator(E, agg, pri, state);
  seedLine.textContent = `Seed ${state.seed}. The same settings and seed always give the same simulated elections.`;
  const slice = () => {
    if (id !== job) return;
    sim.run(Math.min(SLICE, state.sims - sim.done));
    if (sim.done < state.sims) { progress.textContent = `Simulating elections: ${fmt.int(sim.done)} of ${fmt.int(state.sims)}.`; setTimeout(slice, 0); return; }
    progress.textContent = "";
    show(agg, sim);
  };
  progress.textContent = `Simulating elections: 0 of ${fmt.int(state.sims)}.`;
  setTimeout(slice, 0);
}

function show(agg, sim) {
  const year = state.year, res = E.results[String(year)];
  const D = surname(res.dem), R = surname(res.rep);
  const s = summarise(E, sim, year);
  const a = s.actual;
  const dayIso = forecastDate(E.polls.cycles[String(year)].election, state.daysBefore);
  const statePollCount = agg.units.reduce((t, u) => t + u.polls, 0);

  sWin.set(`${D} ${pct(s.winD)}`, `${R} ${pct(s.winR)}${s.tie >= 0.0005 ? `, a 269 to 269 tie ${pct(s.tie)}` : ""}`);
  sEv.set(`${D} ${fmt.int(s.median)}`, `80% of simulations between ${fmt.int(s.lo)} and ${fmt.int(s.hi)}; 270 wins`);
  sActual.set(`${D} ${a.evD}, ${R} ${a.evR}`, `${a.evD >= 270 ? D : R} won; ${pct0(s.atOrBelow)} of simulations gave ${D} ${a.evD} or fewer`);
  sBrier.set(fmt.num(s.brier, 3), `0 is perfect; a coin flip on every contest scores 0.250`);
  status.textContent = `Forecast for ${year} made on ${dateText(dayIso)}: ${D} wins in ${pct(s.winD)} of ${fmt.int(sim.done)} simulated elections, median ${s.median} electoral votes. ${D} actually won ${a.evD}. Brier score ${fmt.num(s.brier, 3)}.`;

  // Electoral votes: bars of ten, split at 270.
  const counts = new Float64Array(54);
  for (const v of sim.evD) counts[Math.min(53, Math.floor(v / 10))]++;
  const bins = Array.from(counts, (c, k) => [k * 10, k * 10 + 10, (100 * c) / sim.done]);
  evChart.update({
    title: `${D}'s electoral votes in ${fmt.int(sim.done)} simulated elections`,
    subtitle: `Forecast made on ${dateText(dayIso)} from ${plural(agg.polls, "poll", "polls")} (${fmt.int(statePollCount)} of states and districts). Bars are 10 electoral votes wide.`,
    label: `Histogram of ${D}'s simulated electoral votes, with lines at 270 and at the actual ${a.evD}`,
    x: { label: `${D}'s electoral votes`, domain: [0, 540], format: (v) => fmt.int(v) },
    y: { label: "Share of simulations (%)", format: (v) => `${fmt.num(v, v < 1 && v > 0 ? 1 : 0)}%` },
    series: [
      { name: `${D} 270 or more`, type: "hist", data: bins.filter((b) => b[0] >= 270), color: 0 },
      { name: `${D} 269 or fewer`, type: "hist", data: bins.filter((b) => b[0] < 270), color: 7 },
    ],
    marks: [{ type: "vline", x: 270, text: "270 to win" }, { type: "vline", x: a.evD, text: `Actual: ${a.evD}`, dy: 14 }],
  });

  // Scores.
  const missed = s.misses.map((i) => `${E.names[i]} (${D} ${pct(s.p[i])})`);
  // The verdict follows the scores as printed, to three decimals.
  const [b1, b0] = [Number(s.brier.toFixed(3)), Number(s.brierPrior.toFixed(3))];
  const verdict = b1 < b0 ? "beat" : b1 > b0 ? "did worse than" : "scored the same, to three decimals, as";
  scoreBox.replaceChildren(
    el("h2", { text: "Scored against the result" }),
    el("p", { class: "small", text: `The forecast called ${56 - s.misses.length} of the 56 contests (50 states, Washington DC and the five districts of Maine and Nebraska) on the side it gave more than 50%. ${missed.length ? `It called wrongly: ${missed.join(", ")}.` : "It called none wrongly."}` }),
    listTable({
      caption: "Brier score: the average of (probability − outcome)² over the 56 contests. Lower is better.",
      columns: [{ label: "Forecast", get: (r) => r.name }, { label: "What it uses", get: (r) => r.what }, { label: "Brier score", get: (r) => fmt.num(r.b, 3), num: true }],
      rows: [
        { name: "This forecast", what: "polls of each state plus the prior, with the error settings", b: s.brier },
        { name: "Prior alone", what: `last election's result ${agg.nationalPolls ? `moved by the national polls' swing (${fmt.signed(agg.swing, 1)} points)` : "unmoved, as no national poll was out yet"}, the same error settings, no state polls`, b: s.brierPrior },
        { name: "Previous winner", what: `each contest goes, with certainty, to the party that won it in ${year - 4}`, b: s.brierPrev },
        { name: "Coin flip", what: "50% everywhere", b: 0.25 },
      ],
    }),
    note("", `State polls ${verdict} the prior alone (${fmt.num(s.brier, 3)} against ${fmt.num(s.brierPrior, 3)}). Most contests are safe and both forecasts give them nearly 0 or 1, so the score is decided by a few close ones. ${s.competitive.length ? `On the ${plural(s.competitive.length, "contest", "contests")} this forecast put between 5% and 95% the Brier score is ${fmt.num(s.brierCompetitive, 3)}.` : "No contest was put between 5% and 95%."}`),
    listTable({
      caption: `Calibration: contests grouped by the forecast's chance for ${D}`,
      columns: [
        { label: "Forecast chance", get: (c) => `${fmt.int(c.lo * 100)}% to ${fmt.int(c.hi * 100)}%` },
        { label: "Contests", get: (c) => fmt.int(c.n), num: true },
        { label: "Average forecast", get: (c) => (c.n ? fmt.pct(c.meanP, 0) : "–"), num: true },
        { label: `${D} won`, get: (c) => (c.n ? `${c.won} of ${c.n}` : "–"), num: true },
      ],
      rows: s.calibration,
    }));

  // One election.
  const sorted = Float64Array.from(s.own).sort();
  const median = sorted[Math.floor(sorted.length / 2)];
  oneText.replaceChildren(
    el("p", { class: "small", text: `Each simulated election is an outcome the forecast thought possible. Scoring the forecast against each of them shows how its Brier score would vary if its probabilities were exactly right: the median would be ${fmt.num(median, 3)}. The actual ${fmt.num(s.brier, 3)} is matched or exceeded in ${pct0(s.worse)} of them${s.worse < 0.05 ? ", rare enough to count against the forecast's assumptions" : s.worse < 0.2 ? ", unusual but not rare" : ", so this election gives no reason to think the forecast was wrong"}.` }),
    el("p", { class: "small", text: `The same check on the electoral votes: ${pct0(s.atOrBelow)} of the simulated elections gave ${D} ${a.evD} or fewer. Because the 56 contests share a national error they are far from 56 independent tests: one election is close to a single draw of that error, and one draw cannot tell a well-judged 80% from a well-judged 95%. Scoring many elections, or many races in one, is what separates a good forecaster from a lucky one.` }));
  const h = stats.histogram(Array.from(s.own), { bins: 30, min: 0, max: Math.max(s.brier, sorted[sorted.length - 1]) * 1.02 || 0.1 });
  oneChart.update({
    title: "Brier scores the forecast would get if one of its own simulations had happened",
    subtitle: "Bars: share of simulated elections. The line marks the actual score.",
    label: `Histogram of Brier scores across simulated elections with the actual score ${fmt.num(s.brier, 3)} marked`,
    x: { label: "Brier score", format: (v) => fmt.num(v, 3) },
    y: { label: "Share of simulations (%)", format: (v) => `${fmt.num(v, 0)}%` },
    series: [{ name: "Simulated elections", type: "hist", data: h.map((b) => [b.x0, b.x1, (100 * b.count) / s.own.length]), color: 6 }],
    marks: [{ type: "vline", x: s.brier, text: `Actual: ${fmt.num(s.brier, 3)}` }],
  });

  // Every unit, closest first.
  const order = E.units.map((_, i) => i).sort((x, y) => Math.abs(s.p[x] - 0.5) - Math.abs(s.p[y] - 0.5) || x - y);
  tableBox.replaceChildren(listTable({
    caption: `The forecast of ${dateText(dayIso)} for each contest, closest first. Shares are ${D}'s share of the two-party vote.`,
    columns: [
      { label: "Contest", get: (i) => E.names[i] },
      { label: "Electoral votes", get: (i) => String(res.ev[i]) + (E.units[i] === "ME" || E.units[i] === "NE" ? " at large" : ""), num: true },
      { label: "Polls used", get: (i) => fmt.int(agg.units[i].polls), num: true },
      { label: "Prior", get: (i) => `${fmt.num(agg.units[i].prior, 1)}%`, num: true },
      { label: "Poll estimate (90% range)", get: (i) => `${fmt.num(agg.units[i].mean, 1)}% (${fmt.num(agg.units[i].mean - 1.645 * agg.units[i].sd, 1)} to ${fmt.num(agg.units[i].mean + 1.645 * agg.units[i].sd, 1)})`, num: true },
      { label: `Chance for ${D}`, get: (i) => pct(s.p[i]), num: true },
      { label: "Result", get: (i) => `${fmt.num(a.share[i], 1)}%`, num: true },
      { label: "Call", get: (i) => (s.p[i] === 0.5 ? "even" : (s.p[i] > 0.5) === (a.won[i] === 1) ? "right" : "wrong") },
    ],
    rows: order,
  }));
}

changed();
