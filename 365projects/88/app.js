// Day 88: Electoral College Simulator. Interface.
import { $, el, fmt, mount, slider, segmented, select, checkbox, button, stat, note, chart, debounce, randomSeed } from "../kit/kit.js";
import { ELECTIONS as E } from "../data/elections.js";
import { BASE_YEARS, DEFAULTS, MAX_SWING, base, swung, tally, popular, winner, tippingPoint, uniformThresholds, simulator, shares, evQuantiles } from "./logic.js";

mount();

const surname = (name) => name.split(" ").at(-1);
const SLICE = 2000;
const pct = (p, exact) => (exact ? fmt.pct(p, 0) : p < 0.001 && p > 0 ? "under 0.1%" : p > 0.999 && p < 1 ? "over 99.9%" : fmt.pct(p, 1));
const REGIONS = E.regions;

const state = { ...DEFAULTS, regions: [...DEFAULTS.regions] };
const overrides = new Map(); // unit index -> swing
let B = base(E, state.year);
const D = () => surname(B.dem), R = () => surname(B.rep);
/** A swing in words: +1.5 is "Harris +1.5", -2 is "Trump +2.0", 0 is "no swing". */
const swingText = (v, d = 1) => (Math.abs(v) < 0.5 * 10 ** -d ? "no swing" : v > 0 ? `${D()} +${fmt.num(v, d)}` : `${R()} +${fmt.num(-v, d)}`);
const shareText = (v) => `${fmt.num(v, 2)}%`;

/* ---------- controls ---------- */
const yearSeg = segmented({
  label: "Start from the result of", value: String(state.year),
  options: BASE_YEARS.map((y) => ({ value: String(y), label: `${y}: ${surname(E.results[y].dem)} v ${surname(E.results[y].rep)}` })),
  onChange: (v) => { state.year = Number(v); B = base(E, state.year); relabel(); changed(); },
});
// Any value, so that an example can set the exact swing that ties the popular vote; arrow keys move 0.3 points.
const natSlider = slider({ label: "National swing", min: -MAX_SWING, max: MAX_SWING, step: "any", value: 0, format: (v) => swingText(v, 2),
  hint: "Points of the two-party vote added to the Democrat's share in every state and district. Arrow keys move it 0.3 points.", onInput: (v) => { state.national = v; changedSoon(); } });
const regionSliders = REGIONS.map((name, k) => slider({ label: name, min: -10, max: 10, step: 0.1, value: 0, format: (v) => swingText(v), onInput: (v) => { state.regions[k] = v; changedSoon(); } }));
const regionBox = el("details", { class: "d88-regions" }, el("summary", { text: "Swing by Census region" }), el("div", { class: "d88-stack" }, el("p", { class: "small muted", text: "Added on top of the national swing. A district takes its state's region." }), regionSliders.map((s) => s.el)));

// One contest's own swing.
const unitOptions = E.units.map((u, i) => ({ value: String(i), label: E.names[i] })).sort((a, b) => a.label.localeCompare(b.label));
const unitSel = select({ label: "Swing one state or district", value: String(E.units.indexOf("PA")), options: unitOptions, onChange: () => syncUnit() });
const unitSlider = slider({ label: "Its own swing", min: -MAX_SWING, max: MAX_SWING, step: 0.1, value: 0, format: (v) => swingText(v),
  hint: "On top of the national and regional swings. A state's swing also moves its districts.", onInput: (v) => { const i = Number(unitSel.value); if (Math.abs(v) < 1e-9) overrides.delete(i); else overrides.set(i, v); showOverrides(); changedSoon(); } });
const overrideList = el("div", { class: "d88-chips", role: "group", "aria-label": "States and districts with their own swing" });
function syncUnit() { unitSlider.value = overrides.get(Number(unitSel.value)) || 0; }
function showOverrides() {
  const items = [...overrides].sort((a, b) => E.names[a[0]].localeCompare(E.names[b[0]]));
  overrideList.replaceChildren(...(items.length ? items.map(([i, v]) => el("span", { class: "d88-chip" }, `${E.names[i]}: ${swingText(v)} `,
    button("Remove", () => { overrides.delete(i); if (Number(unitSel.value) === i) unitSlider.value = 0; showOverrides(); changed(); unitSel.input.focus(); }, { small: true, title: `Remove the swing for ${E.names[i]}` })))
    : [el("span", { class: "small muted", text: "No state or district has a swing of its own." })]));
  for (const b of overrideList.querySelectorAll("button")) b.setAttribute("aria-label", b.title);
}

const natSd = slider({ label: "National uncertainty", min: 0, max: 6, step: 0.1, value: state.natSd, format: (v) => `${fmt.num(v, 1)} points`, hint: "Standard deviation of a random swing shared by every state in each simulated election.", onInput: (v) => { state.natSd = v; changedSoon(); } });
const stateSd = slider({ label: "State uncertainty", min: 0, max: 6, step: 0.1, value: state.stateSd, format: (v) => `${fmt.num(v, 1)} points`, hint: "Standard deviation of each state's own random swing; a district shares its state's and adds half as much again.", onInput: (v) => { state.stateSd = v; changedSoon(); } });
const simSel = select({ label: "Simulated elections", value: String(state.sims), options: [5000, 20000, 100000].map((n) => ({ value: String(n), label: fmt.int(n) })), onChange: (v) => { state.sims = Number(v); changed(); } });
const ruleBox = checkbox({ label: "Maine and Nebraska give one electoral vote to each district's winner, as their law says", checked: true, onChange: (on) => { state.districtRule = on; changed(); } });
const seedLine = el("p", { class: "small muted" });
const seedBtn = button("Run again with a new seed", () => { state.seed = randomSeed(); changed(); }, { small: true });
const resetBtn = button("Reset", () => {
  setAll({ national: 0, regions: [0, 0, 0, 0], natSd: DEFAULTS.natSd, stateSd: DEFAULTS.stateSd, sims: DEFAULTS.sims, seed: DEFAULTS.seed, districtRule: true }, true);
  simSel.value = String(state.sims); ruleBox.checked = true; changed();
}, { small: true });

function setAll(o, clear) {
  Object.assign(state, o);
  if (clear) overrides.clear();
  natSlider.value = state.national; regionSliders.forEach((s, k) => { s.value = state.regions[k]; });
  natSd.value = state.natSd; stateSd.value = state.stateSd; syncUnit(); showOverrides();
}
const idx = (u) => E.units.indexOf(u);
const EXAMPLES = [
  { label: "The result itself, no randomness", o: { national: 0, regions: [0, 0, 0, 0], natSd: 0, stateSd: 0 }, set: [] },
  { label: "A tied popular vote", o: () => ({ national: 50 - popular(B, swung(B)), regions: [0, 0, 0, 0], natSd: 0, stateSd: 0 }), set: [] },
  { label: "Michigan, Pennsylvania and Wisconsin 2 points to the Democrat", o: { national: 0, regions: [0, 0, 0, 0] }, set: [["MI", 2], ["PA", 2], ["WI", 2]] },
  { label: "Arizona, Georgia, Nevada and North Carolina 2 points to the Republican", o: { national: 0, regions: [0, 0, 0, 0] }, set: [["AZ", -2], ["GA", -2], ["NV", -2], ["NC", -2]] },
  { label: "The South 3 points to the Democrat, the Midwest 3 to the Republican", o: { national: 0, regions: [0, -3, 3, 0] }, set: [] },
];
const exampleRow = el("div", { class: "row d88-examples", role: "group", "aria-label": "Examples" }, EXAMPLES.map((ex) => button(ex.label, () => {
  const o = typeof ex.o === "function" ? ex.o() : ex.o;
  overrides.clear();
  for (const [u, v] of ex.set) overrides.set(idx(u), v);
  setAll(o, false);
  changed();
}, { small: true })));

const about = el("div", { class: "small muted d88-source" }, el("strong", { text: "Data. " }),
  "Results by state: Federal Election Commission certified totals (public domain). Districts of Maine and Nebraska: the votes on each state's certificate of ascertainment, held by the National Archives. Electoral votes: the 2010 census apportionment for 2012 to 2020 and the 2020 one for 2024 (Census Bureau). ",
  `Retrieved ${E.retrieved.replace(/(\d{4})-(\d{2})-(\d{2})/g, (m) => fmt.date(m))}. Shares are of the two-party vote; turnout is held at the chosen year's. The simulated elections are swings around a past result, to show how the rules work: they are not a forecast of any future election.`);

const controls = el("div", { class: "controls" }, yearSeg.el, exampleRow, natSlider.el, regionBox,
  el("div", { class: "field d88-group", role: "group", "aria-labelledby": "d88-own" }, el("p", { class: "d88-grouphead", id: "d88-own", text: "One state at a time" }), unitSel.el, unitSlider.el, overrideList),
  el("div", { class: "field d88-group", role: "group", "aria-labelledby": "d88-unc" }, el("p", { class: "d88-grouphead", id: "d88-unc", text: "Uncertainty" }), natSd.el, stateSd.el, simSel.el, ruleBox.el),
  el("div", { class: "row" }, seedBtn, resetBtn), seedLine, about);

/* ---------- outputs ---------- */
const sCount = stat("With these swings and no randomness");
const sPop = stat("Popular vote, two-party share");
const sWin = stat("Electoral college won in the simulations");
const sInv = stat("Popular-vote winner loses");
const progress = el("p", { class: "small muted d88-progress" });
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div");
const windowNote = el("div");
const evBox = el("div"), invBox = el("div");
const history = el("div", { class: "panel d88-stack", id: "d88-history" });
const unitTable = el("div", { class: "d88-tbl" });
const unitDetails = el("details", { class: "d88-units", id: "d88-units" }, el("summary", { text: "Every state and district: base share, swing and chance" }), unitTable);
const out = el("div", { class: "out" }, el("div", { class: "stats", id: "d88-results" }, sCount.el, sPop.el, sWin.el, sInv.el), progress, status, message, windowNote, evBox, invBox, history);
const jump = el("nav", { class: "row d88-jump", "aria-label": "Jump to the results" }, el("span", { class: "small muted", text: "Jump to:" }),
  [["#d88-results", "results"], ["#d88-history", "when it happened"], ["#d88-units", "every contest"]].map(([href, text]) => el("a", { href, class: "small", text, onclick: href === "#d88-units" ? () => { unitDetails.open = true; } : null })));
$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out), unitDetails);

const evChart = chart(evBox, { series: [], height: 280 });
const invChart = chart(invBox, { series: [], height: 280 });

function relabel() {
  // The words in the swing readouts name the chosen year's candidates.
  natSlider.value = state.national; regionSliders.forEach((s, k) => { s.value = state.regions[k]; }); syncUnit(); showOverrides();
}

/* ---------- a table that becomes labelled lines when narrow ---------- */
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl d88-rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {},
      columns.map((c, k) => el(k === 0 ? "th" : "td", { scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/* ---------- the historical cases ---------- */
history.append(el("h2", { text: "When it happened" }),
  el("p", { class: "small", text: "The US House of Representatives' historians list five elections in which a candidate won the popular vote and lost the presidency. Electoral votes are from the National Archives. 1824 is a special case: in 6 of the 24 states the legislature, not the voters, chose the electors, so there was no popular vote there; no one had a majority of electoral votes and the House chose the president." }),
  listTable({
    caption: "Popular-vote winners who did not become president",
    columns: [{ label: "Election", get: (r) => r[0] }, { label: "Won the popular vote", get: (r) => r[1] }, { label: "Became president", get: (r) => r[2] }, { label: "Electoral votes", get: (r) => r[3] }],
    rows: [
      ["1824", "Andrew Jackson, in the 18 states that held a popular vote", "John Quincy Adams, chosen by the House", "Jackson 99, Adams 84, of 261 (131 needed)"],
      ["1876", "Samuel J. Tilden", "Rutherford B. Hayes, after an Electoral Commission settled four disputed states", "Hayes 185, Tilden 184"],
      ["1888", "Grover Cleveland", "Benjamin Harrison", "Harrison 233, Cleveland 168"],
      ["2000", "Al Gore", "George W. Bush", "Bush 271, Gore 266 (one elector cast a blank ballot)"],
      ["2016", "Hillary Clinton", "Donald Trump", "Trump 304, Clinton 227 as cast (306 to 232 pledged)"],
    ],
  }));

/* ---------- running ---------- */
let job = 0;
const changedSoon = debounce(() => changed(), 160);
function changed() {
  const id = ++job;
  const sw = { national: state.national, regions: state.regions, overrides };
  const center = swung(B, sw);
  const t = tally(B, center, state.districtRule), pop = popular(B, center), w = winner(t);
  const tip = tippingPoint(B, center, state.districtRule);
  const th = uniformThresholds(B, center, state.districtRule);
  const d = D(), r = R();
  sCount.set(`${d} ${t.evD}, ${r} ${t.evR}`, `${w === "D" ? `${d} wins` : w === "R" ? `${r} wins` : "no majority: the House would choose"}${t.open ? `; ${t.open} electoral votes in contests tied at exactly 50%` : ""}`);
  // A lead that rounds to 0.00 points is reported as a tie, not as "leads by 0.00".
  const lead = 2 * (pop - 50), level = Math.abs(lead) < 0.005;
  sPop.set(`${d} ${shareText(pop)}`, level ? "level to two decimal places" : `${lead > 0 ? d : r} leads by ${fmt.num(Math.abs(lead), 2)} points${(lead > 0 && w === "R") || (lead < 0 && w === "D") ? ": the popular-vote winner loses" : ""}`);
  const gapText = Math.abs(th.demAt - 50) < 0.005 && !th.tie
    ? `The electoral college turns at ${shareText(th.demAt)}, the same point as the popular vote to two decimal places: the map does not lean either way.`
    : th.demAt > 50
    ? `${d} needs more than ${shareText(th.demAt)} of the two-party vote to win the electoral college${th.tie ? `; from ${shareText(th.repAt)} to ${shareText(th.demAt)} it ties at 269` : ""}, so from 50% to ${shareText(th.tie ? th.repAt : th.demAt)} ${d} wins the popular vote and ${th.tie ? "loses or ties in" : "loses"} the electoral college.`
    : `${d} wins the electoral college with any share above ${shareText(th.demAt)}${th.tie ? ` (a 269 tie from ${shareText(th.repAt)})` : ""}, so from there up to 50% ${r} wins the popular vote and loses the electoral college.`;
  windowNote.replaceChildren(note("", el("strong", { text: "Under a uniform swing from here: " }), gapText,
    tip ? ` The tipping point is ${E.names[tip.unit]} (${d} ${shareText(tip.share)}), ${fmt.num(Math.abs(tip.bias), 2)} points ${tip.bias < 0 ? `more Republican` : "more Democratic"} than the country.` : ""));

  const sim = simulator(B, sw, { natSd: state.natSd, stateSd: state.stateSd, seed: state.seed, districtRule: state.districtRule });
  const fixed = state.natSd === 0 && state.stateSd === 0;
  const total = fixed ? 1 : state.sims;
  seedLine.textContent = fixed ? "Both uncertainties are zero, so every simulated election is the same: one is run." : `Seed ${state.seed}. The same settings and seed always give the same simulated elections.`;
  const slice = () => {
    if (id !== job) return;
    sim.run(Math.min(SLICE, total - sim.done));
    if (sim.done < total) { progress.textContent = `Simulating elections: ${fmt.int(sim.done)} of ${fmt.int(total)}.`; setTimeout(slice, 0); return; }
    progress.textContent = "";
    show(sim, center, fixed);
  };
  progress.textContent = `Simulating elections: 0 of ${fmt.int(total)}.`;
  setTimeout(slice, 0);
}

function show(sim, center, fixed) {
  const s = shares(sim), q = evQuantiles(sim), d = D(), r = R();
  sWin.set(`${d} ${pct(s.winD, fixed)}`, `${r} ${pct(s.winR, fixed)}${s.none ? `; no majority ${pct(s.none, fixed)}` : ""}. ${fixed ? "One election, no randomness." : `${fmt.int(sim.done)} simulated elections.`}`);
  sInv.set(pct(s.inversion, fixed), `${d} wins the popular vote and loses: ${pct(s.invDR, fixed)}; ${r} wins it and loses: ${pct(s.invRD, fixed)}`);
  status.textContent = `${d} wins the electoral college in ${pct(s.winD, fixed)} of simulated elections and ${r} in ${pct(s.winR, fixed)}. The popular-vote winner loses the electoral college in ${pct(s.inversion, fixed)}.`;

  const counts = new Float64Array(54);
  for (let v = 0; v <= 538; v++) counts[Math.min(53, Math.floor(v / 10))] += sim.evHist[v];
  const bins = Array.from(counts, (c, k) => [k * 10, k * 10 + 10, (100 * c) / sim.done]);
  evChart.update({
    title: `${d}'s electoral votes in ${fixed ? "the one election" : `${fmt.int(sim.done)} simulated elections`}`,
    subtitle: `Starting from ${state.year} with the swings set. Bars are 10 electoral votes wide; median ${q.median}${fixed ? "" : `, 80% between ${q.lo} and ${q.hi}`}.`,
    label: `Histogram of ${d}'s simulated electoral votes with a line at 270`,
    x: { label: `${d}'s electoral votes`, domain: [0, 540], format: (v) => fmt.int(v) },
    y: { label: "Share of simulations (%)", format: (v) => `${fmt.num(v, 0)}%` },
    series: [{ name: `${d} 270 or more`, type: "hist", data: bins.filter((b) => b[0] >= 270), color: 0 }, { name: `${d} 269 or fewer`, type: "hist", data: bins.filter((b) => b[0] < 270), color: 7 }],
    marks: [{ type: "vline", x: 270, text: "270 to win" }],
  });

  const used = sim.marginBins.filter((b) => b.n >= 50);
  invChart.update({
    title: "How often the popular-vote winner loses, by the size of the popular-vote lead",
    subtitle: fixed ? "With no randomness there is only one election; raise an uncertainty to see the pattern." : `Simulated elections grouped by the Democrat's lead in the two-party vote, in 1-point bins plotted at their middles (bins with at least 50 elections shown).`,
    label: "Line chart of the share of simulated elections in which the popular-vote winner loses the electoral college, against the popular-vote margin",
    x: { label: `${d}'s national lead (two-party points)`, format: (v) => fmt.signed(v, Number.isInteger(v) ? 0 : 1) },
    y: { label: "Share of elections in the bin (%)", domain: [0, 100], format: (v) => `${fmt.int(v)}%` },
    series: [
      { name: "Popular-vote winner loses", type: "line", data: used.map((b) => [(b.lo + b.hi) / 2, (100 * b.inv) / b.n]), color: 1 },
      { name: `${d} wins the electoral college`, type: "line", data: used.map((b) => [(b.lo + b.hi) / 2, (100 * b.d) / b.n]), color: 0, dash: true },
    ],
    marks: [{ type: "vline", x: 0, text: "Tied popular vote" }],
    empty: "Too few simulated elections in any bin",
  });
  message.replaceChildren(...(sim.outside / sim.done > 0.01 ? [note("warn", `${pct(sim.outside / sim.done, false)} of simulated elections had a popular-vote lead beyond 15 points and are left out of the second chart.`)] : []));

  const res = E.results[String(state.year)];
  const order = E.units.map((_, i) => i).sort((a, b) => Math.abs(center[a] - 50) - Math.abs(center[b] - 50) || a - b);
  unitTable.replaceChildren(listTable({
    caption: `Every contest, closest first. Shares are ${d}'s share of the two-party vote.${state.districtRule ? "" : " With the district rule off, the districts' votes go to the statewide winner."}`,
    columns: [
      { label: "Contest", get: (i) => E.names[i] },
      { label: "Electoral votes", get: (i) => (E.units[i] === "ME" || E.units[i] === "NE" ? (state.districtRule ? `${B.ev[i]} at large` : String(B.ev[i] + (E.units[i] === "ME" ? 2 : 3))) : B.parent[i] !== i && !state.districtRule ? "with the state" : String(B.ev[i])), num: true },
      { label: `Result in ${state.year}`, get: (i) => shareText((100 * res.d[i]) / (res.d[i] + res.r[i])), num: true },
      { label: "Swing", get: (i) => swingText(center[i] - B.share[i], 2), num: true },
      { label: "After the swing", get: (i) => shareText(center[i]), num: true },
      { label: `Simulations won by ${d}`, get: (i) => pct(sim.unitD[i] / sim.done, fixed), num: true },
    ],
    rows: order,
  }));
}

showOverrides();
changed();
