// Day 46: Income Inequality Explorer. Interface.
import { $, el, fmt, mount, slider, select, button, note, chart, palette, debounce } from "../kit/kit.js";
import { PIP } from "./data.js";
import { MAX_PICKS, seriesList, lorenz, measures, surveyAt, runs, bankGini, gapStats, the, measureText, sharesText, giniText, trendText, compareText, mixedText, COMPARE_NOTE } from "./logic.js";

mount();

const ALL = seriesList().sort((a, b) => a.label.localeCompare(b.label, "en"));
const byId = new Map(ALL.map((s) => [s.id, s]));
const DEFAULT = ["IND:consumption", "BRA:income", "USA:income", "SWE:income"];
const EXAMPLES = [
  { label: "India, Brazil, United States, Sweden", ids: DEFAULT },
  { label: "Brazil, China, India, South Africa", ids: ["BRA:income", "CHN:consumption", "IND:consumption", "ZAF:consumption"] },
  { label: "Denmark, Finland, Norway, Sweden", ids: ["DNK:income", "FIN:income", "NOR:income", "SWE:income"] },
  { label: "Poland in 2019, measured two ways", ids: ["POL:income", "POL:consumption"], year: 2019 },
];
const GAP = gapStats();
const g1 = (v) => fmt.num(v, 1);
const share = (v) => fmt.pct(v, Math.round(v * 1000) % 100 === 0 ? 0 : 1);

// picks: [{ series, color }]. A colour stays with its country until the country is removed.
const state = { picks: [], year: 0, latest: true };
const freeColor = () => [0, 1, 2, 3].find((c) => !state.picks.some((p) => p.color === c));
function setPicks(ids, year) {
  state.picks = [];
  for (const id of ids) state.picks.push({ series: byId.get(id), color: freeColor() });
  state.latest = year == null;
  if (year != null) state.year = year;
}

/* ---------- controls ---------- */
const picker = select({
  label: "Country and kind of survey", value: "",
  options: [{ value: "", label: "Choose from 205 series…" }, ...ALL.map((s) => ({ value: s.id, label: s.label }))],
  hint: "A country surveyed both ways appears twice. Income and consumption are never mixed in one line.",
});
const addNote = el("div", { role: "status" });
const say = (kind, text) => addNote.replaceChildren(...(text ? [note(kind, text)] : []));
function add() {
  const s = byId.get(picker.value);
  if (!s) return say("bad", "Choose a country from the list first, then press Add.");
  if (state.picks.some((p) => p.series.id === s.id)) return say("warn", `${s.label} is already shown.`);
  if (state.picks.length >= MAX_PICKS) return say("bad", `At most ${MAX_PICKS} series are shown at once. Remove one, then add ${s.label}.`);
  state.picks.push({ series: s, color: freeColor() });
  picker.value = "";
  say("", "");
  drawPicks();
}
const addBtn = button("Add", add, { primary: true, small: true });
const pickList = el("ul", { class: "picks", "aria-label": "Series shown" });
const yearSlider = slider({
  label: "Year", min: 1963, max: 2025, step: 1, value: 2025, format: (v) => String(v),
  hint: "Each country is drawn from its most recent survey in or before this year.",
  onInput: (v) => { state.year = v; state.latest = v === Number(yearSlider.input.max); drawYear(); },
});
const resetBtn = button("Reset", () => { setPicks(DEFAULT); say("", ""); drawPicks(); }, { small: true });

const controls = el("div", { class: "controls" },
  el("h2", { text: "Countries" }),
  picker.el, el("div", { class: "row" }, addBtn), addNote,
  pickList,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row" }, EXAMPLES.map((e) => button(e.label, () => { setPicks(e.ids, e.year); say("", ""); drawPicks(); }, { small: true })))),
  yearSlider.el,
  el("div", { class: "row" }, resetBtn));

/* ---------- outputs ---------- */
const status = el("p", { class: "sr-only", role: "status" });
const jump = el("nav", { class: "jump", "aria-label": "Parts of this tool" },
  [["#d46-lorenz", "Lorenz curves"], ["#d46-time", "Gini over time"], ["#d46-words", "In plain words"], ["#d46-tables", "Every survey"]].map(([href, text]) => el("a", { href, text })));
const lorenzBox = el("div", { id: "d46-lorenz" });
const keyBox = el("div");
const timeBox = el("div", { id: "d46-time" });
const wordsBox = el("div", { class: "stack", id: "d46-words" });
const tablesBox = el("div", { class: "stack", id: "d46-tables" });
const out = el("div", { class: "out" }, status, jump, lorenzBox, keyBox, timeBox, wordsBox, tablesBox);
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const lorenzChart = chart(lorenzBox, { series: [], height: 400 });
const timeChart = chart(timeBox, { series: [], height: 340, table: false });
const swatch = (color) => el("i", { class: "sw", style: { background: palette[color] }, "aria-hidden": "true" });
const announce = debounce((text) => { status.textContent = text; }, 600);

/* ---------- what depends on the countries chosen ---------- */
function drawPicks() {
  // The list, each with its own Remove button.
  pickList.replaceChildren(...state.picks.map(({ series: s, color }, i) => {
    const remove = button("Remove", () => {
      state.picks.splice(i, 1);
      say("", "");
      drawPicks();
      (pickList.querySelectorAll("button")[Math.min(i, state.picks.length - 1)] ?? picker.input).focus();
    }, { small: true });
    remove.setAttribute("aria-label", `Remove ${s.label}`);
    return el("li", {}, swatch(color),
      el("span", { class: "who" }, el("strong", { text: s.label }), el("span", { class: "small muted", text: s.rows.length === 1 ? `one survey, ${s.first}` : `${s.rows.length} surveys, ${s.first} to ${s.last}` })),
      remove);
  }));
  if (!state.picks.length) pickList.replaceChildren(el("li", { class: "muted small", text: "No country is chosen." }));

  // The year slider spans the surveys of the chosen countries.
  const lo = state.picks.length ? Math.min(...state.picks.map((p) => p.series.first)) : 1963;
  const hi = state.picks.length ? Math.max(...state.picks.map((p) => p.series.last)) : 2025;
  yearSlider.input.min = lo;
  yearSlider.input.max = hi;
  yearSlider.input.disabled = !(hi > lo) || !state.picks.length;
  state.year = state.latest ? hi : Math.min(hi, Math.max(lo, state.year));
  state.latest = state.year === hi;
  yearSlider.value = state.year;

  // Every survey of each country, as a table.
  tablesBox.replaceChildren(el("h2", { text: "Every survey of the chosen countries" }),
    ...(state.picks.length ? state.picks.map(({ series: s }) => {
      const all = runs(s);
      const letter = new Map(all.flatMap((r) => r.rows.map((row) => [row, r.letter])));
      return el("details", { class: "chart-table" },
        el("summary", { text: `${s.label}: ${s.rows.length === 1 ? "its one survey" : `all ${s.rows.length} surveys`}` }),
        el("div", { class: "tbl-wrap" }, el("table", { class: "tbl all" },
          el("caption", { text: `${s.label}. Surveys with the same letter are comparable with each other.` }),
          el("thead", {}, el("tr", {}, ["Year", "Run", "Gini, the Bank's", "Gini, ten shares", "Poorest half", "Richest tenth"].map((h, j) => el("th", { scope: "col", class: j ? "num" : null, text: h })))),
          el("tbody", {}, s.rows.map((row) => {
            const m = measures(row);
            return el("tr", {}, el("th", { scope: "row", text: String(row.year) }),
              [letter.get(row), g1(m.giniBank), g1(m.giniShares), fmt.pct(m.bottom50, 1), fmt.pct(m.top10, 1)].map((v) => el("td", { class: "num", text: v })));
          })))));
    }) : [el("p", { class: "small muted", text: "Choose a country to list its surveys." })]));

  drawYear();
}

/* ---------- what also depends on the year ---------- */
function drawYear() {
  const year = state.year;
  const shown = state.picks.map((p) => ({ ...p, row: surveyAt(p.series, year) }));
  const items = shown.filter((x) => x.row);
  const kinds = new Set(items.map((x) => x.series.welfare));
  const total = kinds.size === 1 ? [...kinds][0] : "income or consumption";
  const tag = (x) => `${x.series.name} ${x.row.year}${x.series.level === "urban" ? ", urban" : ""} (${x.series.welfare})`;

  lorenzChart.update({
    title: items.length ? `Lorenz curves: who holds how much, ${items.length === 1 ? tag(items[0]) : `surveys in or before ${year}`}` : "Lorenz curves",
    subtitle: "Line up everyone from poorest to richest. The curve shows the share of the total held by the poorest 10%, 20% and so on. The further it sags below the straight line, the more unequal.",
    label: `Lorenz curves for ${items.length ? items.map(tag).join(", ") : "no country"}`,
    x: { label: "Share of people, poorest first", domain: [0, 1], ticks: 5, format: share },
    y: { label: `Share of all ${total} they hold`, domain: [0, 1], ticks: 5, format: share },
    legend: true,
    series: [
      { name: "Equal shares", type: "line", data: Array.from({ length: 11 }, (_, k) => [k / 10, k / 10]), color: "#16233b", dash: true, width: 1.5 },
      ...items.map((x) => ({ name: tag(x), type: "line", data: lorenz(x.row.shares), color: x.color, width: 2.5 })),
    ],
  });

  // Key numbers, one row per country.
  const cell = (label, text) => el("td", { class: "num", "data-label": label, text });
  keyBox.replaceChildren(...(items.length ? [
    el("table", { class: "tbl d46-key" },
      el("caption", { text: "The surveys drawn above" }),
      el("thead", {}, el("tr", {}, ["Survey", "Measured", "Poorest half holds", "Richest tenth holds", "Gini, ten shares", "Gini, the Bank's"].map((h, j) => el("th", { scope: "col", class: j > 1 ? "num" : null, text: h })))),
      el("tbody", {}, items.map((x) => {
        const m = measures(x.row);
        return el("tr", {},
          el("th", { scope: "row" }, swatch(x.color), `${x.series.name}, ${x.row.year}`),
          el("td", { "data-label": "Measured", text: `${x.series.welfare} per person${x.series.level === "urban" ? ", urban areas" : ""}` }),
          cell("Poorest half holds", fmt.pct(m.bottom50, 1)), cell("Richest tenth holds", fmt.pct(m.top10, 1)),
          cell("Gini, ten shares", g1(m.giniShares)), cell("Gini, the Bank's", g1(m.giniBank)));
      }))),
    // Two decimals, from the unrounded figures: a survey's own sentence subtracts its two rounded indices, which can differ
    // by a tenth (Malawi 1997 is 65.76 against 61.02, a gap of 4.74, and reads "65.8", "61.0", "4.8 points lower").
    el("p", { class: "small muted", text: `The ten-share index comes from the ten shares alone; the Bank's comes from the full distribution. Across all ${fmt.int(GAP.n)} surveys in this snapshot the ten-share index is the lower of the two every time: before rounding, by ${fmt.num(GAP.mean, 2)} points on average, by ${fmt.num(GAP.min.gap, 2)} at the least (${GAP.min.name}, ${GAP.min.year}) and by ${fmt.num(GAP.max.gap, 2)} at the most (${GAP.max.name}, ${GAP.max.year}).` }),
  ] : [note("warn", state.picks.length ? `None of the chosen countries has a survey in or before ${year}. Move the year forward.` : "No country is chosen. Add one from the list, or press an example.")]));

  // Gini over time: one line per comparable run, dots for every survey, a larger dot for the survey drawn above.
  const years = state.picks.flatMap((p) => [p.series.first, p.series.last]);
  timeChart.update({
    title: "The Bank's Gini index over time",
    subtitle: "Every dot is a survey. A line joins only surveys the Bank treats as comparable, so a gap in a line is a change of method. The larger dots are the surveys drawn above.",
    label: `Line chart of the World Bank's Gini index by survey year for ${state.picks.length ? state.picks.map((p) => p.series.label).join(", ") : "no country"}`,
    x: { label: "Survey year", domain: years.length ? [Math.min(...years) - 1, Math.max(...years) + 1] : [1990, 2025], format: (v) => (Number.isInteger(v) ? String(v) : "") },
    y: { label: "Gini index (0 to 100)", format: g1 },
    legend: true, empty: "Choose a country to see its Gini index over time",
    series: state.picks.flatMap(({ series: s, color }) => [
      ...runs(s).map((run, i) => ({ name: s.label, legend: i === 0, type: "line", color, data: run.rows.map((row) => [row.year, bankGini(row)]) })),
      { name: s.label, legend: false, hover: false, type: "scatter", color, r: 2.6, data: s.rows.map((row) => [row.year, bankGini(row)]) },
    ]),
    marks: items.map((x) => ({ type: "point", x: x.row.year, y: bankGini(x.row), color: palette[x.color], r: 6 })),
  });

  // Plain sentences for each country, then each pair of curves.
  const panels = shown.map((x) => {
    const head = el("h3", {}, swatch(x.color), x.row ? `${x.series.label}: the ${x.row.year} survey` : x.series.label);
    if (!x.row) return el("div", { class: "panel" }, head, el("p", { text: `There is no survey in or before ${year}. The first is from ${x.series.first}.` }));
    const age = year - x.row.year;
    return el("div", { class: "panel" }, head,
      age >= 5 ? el("p", { class: "small muted", text: `This is the most recent survey in or before ${year}. It was taken ${age} years earlier, in ${x.row.year}.` }) : null,
      el("p", { text: sharesText(x.series, x.row) }),
      el("p", { text: giniText(x.series, x.row) }),
      el("p", { text: trendText(x.series, x.row) }),
      el("p", { class: "small muted", text: measureText(x.series, x.row) }));
  });
  const pairs = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) pairs.push(compareText(items[i], items[j]).text);
  const caution = mixedText(items);
  wordsBox.replaceChildren(
    el("h2", { text: "In plain words" }),
    ...(panels.length ? panels : [el("p", { class: "small muted", text: "Choose a country to read what its survey says." })]),
    el("h2", { text: "Curve against curve" }),
    ...(caution ? [note("warn", el("strong", { text: "Mixed measures. " }), caution)] : []),
    ...(pairs.length ? [el("p", { class: "small", text: COMPARE_NOTE }), el("ul", { class: "cmp" }, pairs.map((t) => el("li", { text: t })))] : [el("p", { class: "small muted", text: "Two countries with a survey are needed to compare curves." })]));

  announce(items.length
    ? `Showing ${items.map((x) => `${the(x.series.name)} ${x.row.year}, Gini ${g1(bankGini(x.row))}`).join("; ")}.`
    : "No survey to show.");
}

setPicks(DEFAULT);
drawPicks();
