// Day 11: Philosophy Knowledge Graph. Interface.
import { $, el, svgEl, fmt, mount, slider, select, button, stat, note, chart } from "../kit/kit.js";
import { DATA } from "./data.js";
import { ERAS, build, pagerank, ranking, positions, reach, chain, search, find, years } from "./logic.js";

mount();

const g = build(DATA);
const SIDE = 10; // names shown on each side of the map before "show all"
const state = { who: find(g, "Immanuel Kant"), era: "all", damping: 0.85, target: "", showAll: false };
let pr = pagerank(g, { damping: state.damping });
let order = ranking(g, pr.scores);
let pos = positions(g, pr.scores);

const axisYear = (v) => (v < 0 ? `${fmt.int(-v)} BC` : String(Math.round(v)));
const sharePct = (s) => fmt.pct(s, 2);
const byScore = (list) => [...list].sort((a, b) => pr.scores[b] - pr.scores[a]);

/* ---------- search ---------- */
const names = el("datalist", { id: "thinkers" }, [...g.name].sort((a, b) => a.localeCompare(b)).map((n) => el("option", { value: n })));
const searchInput = el("input", { type: "search", id: "who", list: "thinkers", placeholder: "Type a name, for example Hypatia or Rawls", autocomplete: "off", spellcheck: "false" });
const searchMsg = el("div", { role: "status", "aria-live": "polite" });
function trySearch(commit) {
  const text = searchInput.value;
  if (!text.trim()) { searchMsg.replaceChildren(); return; }
  const exact = find(g, text);
  if (exact >= 0) { searchMsg.replaceChildren(); pickThinker(exact); searchInput.value = ""; return; }
  const hits = search(g, text, order, 6);
  if (commit && hits.length === 1) { searchMsg.replaceChildren(); pickThinker(hits[0]); searchInput.value = ""; return; }
  searchMsg.replaceChildren(hits.length
    ? el("div", { class: "row small" }, el("span", { class: "muted", text: "Did you mean" }), hits.map((i) => button(g.name[i], () => { pickThinker(i); searchInput.value = ""; searchMsg.replaceChildren(); }, { small: true })))
    : note("warn", `No thinker matching "${text.trim()}" has an influence link in this data.`));
}
searchInput.addEventListener("input", () => trySearch(false));
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); trySearch(true); } });

function pickThinker(i) {
  state.who = i;
  state.showAll = false;
  update();
}

/* ---------- ranking panel ---------- */
const eraSelect = select({ label: "Era", value: "all", options: ERAS.map((e) => ({ value: e.key, label: e.label })), onChange: (v) => { state.era = v; drawRanking(); } });
const dampSlider = slider({
  label: "Damping", min: 0.5, max: 0.95, step: 0.05, value: 0.85, format: (v) => fmt.num(v, 2),
  hint: "How far standing travels up a chain of influence. Low: mostly counts direct followers. High: rewards being upstream of everyone.",
  onInput: (v) => { state.damping = v; pr = pagerank(g, { damping: v }); order = ranking(g, pr.scores); pos = positions(g, pr.scores); update(); },
});
const rankList = el("ol", { class: "ranklist" });

function drawRanking() {
  const list = ranking(g, pr.scores, state.era).slice(0, 15);
  const top = list.length ? pr.scores[list[0]] : 1;
  rankList.replaceChildren(...list.map((i) => el("li", { class: i === state.who ? "on" : "" },
    el("button", { type: "button", onclick: () => pickThinker(i), title: `${g.name[i]}: ${sharePct(pr.scores[i])} of all standing` },
      el("span", { class: "nm", text: g.name[i] }),
      el("span", { class: "sc", text: sharePct(pr.scores[i]) }),
      el("span", { class: "br" }, el("span", { style: { width: `${(pr.scores[i] / top) * 100}%` } }))))));
  if (!list.length) rankList.append(el("li", { class: "small muted", text: "No thinkers with a known birth year in this era." }));
}

/* ---------- the selected thinker ---------- */
const card = el("div");
const sRank = stat("PageRank position");
const sIn = stat("Recorded as an influence on");
const sOut = stat("Recorded influences");
const sReach = stat("Downstream of them");
const ego = el("div", { class: "ego" });
const egoNote = el("div");
const chainBox = el("div");
const chartBox = el("div");
const plot = chart(chartBox, { series: [], height: 340, table: false });

const targetInput = el("input", { type: "search", id: "target", list: "thinkers", placeholder: "Another thinker, for example John Rawls", autocomplete: "off", spellcheck: "false", value: "John Rawls" });
targetInput.addEventListener("input", () => drawChain());

function nodeButton(i, cls = "") {
  return el("button", { type: "button", class: `node ${cls}`, dataset: { id: i }, onclick: () => pickThinker(i), title: g.about[i] || g.name[i] },
    el("span", { class: "nm", text: g.name[i] }), el("span", { class: "yr", text: years(g.born[i], g.died[i]) }));
}

function drawEgo() {
  const i = state.who;
  const from = byScore(g.influencers[i]);
  const to = byScore(g.influenced[i]);
  const cut = (list) => (state.showAll ? list : list.slice(0, SIDE));
  const more = Math.max(0, from.length - SIDE) + Math.max(0, to.length - SIDE);
  const lines = svgEl("svg", { class: "ego-lines", "aria-hidden": "true" });
  const column = (title, list, total, empty) => el("div", { class: "col" },
    el("h3", { text: `${title} (${total})` }),
    list.length ? list.map((j) => nodeButton(j)) : el("p", { class: "small muted", text: empty }));
  const left = column("Influenced by", cut(from), from.length, "No influences are recorded.");
  const centre = el("div", { class: "col centre" }, el("div", { class: "node self", dataset: { id: i } }, el("span", { class: "nm", text: g.name[i] }), el("span", { class: "yr", text: years(g.born[i], g.died[i]) })));
  const right = column("Influenced", cut(to), to.length, "Nobody is recorded as influenced by them.");
  ego.replaceChildren(lines, left, centre, right);
  egoNote.replaceChildren(...(more > 0 || state.showAll
    ? [el("div", { class: "row small" },
        el("span", { class: "muted", text: state.showAll ? "Showing every recorded link." : `Showing the ${SIDE} highest-ranked on each side. ${more} more are hidden.` }),
        button(state.showAll ? "Show fewer" : "Show all", () => { state.showAll = !state.showAll; drawEgo(); }, { small: true }))]
    : []));
  requestAnimationFrame(connect);
}

// Draw a curve from each name to the thinker in the middle. Positions come from the laid-out page.
function connect() {
  const lines = ego.querySelector(".ego-lines");
  const self = ego.querySelector(".node.self");
  if (!lines || !self) return;
  const box = ego.getBoundingClientRect();
  lines.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  lines.setAttribute("width", box.width);
  lines.setAttribute("height", box.height);
  const s = self.getBoundingClientRect();
  const paths = [];
  {
    const cols = ego.querySelectorAll(".col");
    const curve = (x1, y1, x2, y2) => `M${x1},${y1}C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
    for (const b of cols[0].querySelectorAll(".node")) {
      const r = b.getBoundingClientRect();
      paths.push(curve(r.right - box.left, r.top + r.height / 2 - box.top, s.left - box.left, s.top + s.height / 2 - box.top));
    }
    for (const b of cols[2].querySelectorAll(".node")) {
      const r = b.getBoundingClientRect();
      paths.push(curve(s.right - box.left, s.top + s.height / 2 - box.top, r.left - box.left, r.top + r.height / 2 - box.top));
    }
  }
  lines.replaceChildren(...paths.map((d) => svgEl("path", { d, fill: "none", stroke: "#b9c5bd", "stroke-width": 1.5 })));
}
if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => connect()).observe(ego);

function drawChain() {
  const text = targetInput.value.trim();
  const a = state.who;
  if (!text) { chainBox.replaceChildren(el("p", { class: "small muted", text: "Type a second name to trace a line of influence between the two." })); return; }
  const b = find(g, text);
  if (b < 0) {
    const hits = search(g, text, order, 5);
    chainBox.replaceChildren(hits.length
      ? el("div", { class: "row small" }, el("span", { class: "muted", text: "Did you mean" }), hits.map((i) => button(g.name[i], () => { targetInput.value = g.name[i]; drawChain(); }, { small: true })))
      : note("warn", `No thinker matching "${text}" has an influence link in this data.`));
    return;
  }
  if (a === b) { chainBox.replaceChildren(el("p", { class: "small muted", text: "That is the same thinker. Choose someone else." })); return; }
  const down = chain(g, a, b);
  const up = down ? null : chain(g, b, a);
  const path = down || up;
  if (!path) { chainBox.replaceChildren(note("", `There is no chain of recorded influence between ${g.name[a]} and ${g.name[b]}, in either direction.`)); return; }
  const steps = path.length - 1;
  chainBox.replaceChildren(
    el("p", { class: "small", text: `${g.name[path[0]]} reaches ${g.name[path[path.length - 1]]} in ${steps} step${steps === 1 ? "" : "s"}. Each thinker is recorded as an influence on the next:` }),
    el("div", { class: "chain" }, path.flatMap((i, k) => [k ? el("span", { class: "arrow", "aria-hidden": "true", text: "→" }) : null, nodeButton(i, i === a ? "self-ish" : "")])));
}

function update() {
  const i = state.who;
  const down = reach(g, i).size;
  card.replaceChildren(el("div", { class: "who" },
    el("h2", { class: "who-name", text: g.name[i] }),
    el("p", { class: "muted", text: [years(g.born[i], g.died[i]), g.about[i]].filter(Boolean).join(" · ") }),
    el("p", { class: "small" }, el("a", { href: `https://www.wikidata.org/wiki/${g.qid[i]}`, target: "_blank", rel: "noopener", text: "Wikidata entry" }), ` · articles in ${g.links[i]} language editions of Wikipedia`)));
  sRank.set(`${fmt.int(pos[i])} of ${fmt.int(g.n)}`, `${sharePct(pr.scores[i])} of all standing`);
  sIn.set(fmt.int(g.influenced[i].length), g.influenced[i].length === 1 ? "thinker" : "thinkers");
  sOut.set(fmt.int(g.influencers[i].length), g.influencers[i].length ? "named in the data" : "none named, so the chain starts here");
  sReach.set(fmt.int(down), `${fmt.pct(down / g.n, 0)} of everyone, through chains of influence`);

  drawRanking();
  drawEgo();
  drawChain();

  const pts = [];
  for (let k = 0; k < g.n; k++) if (g.born[k] != null) pts.push({ x: g.born[k], y: pr.scores[k] * 100, label: g.name[k], id: k });
  plot.update({
    title: "Every thinker, by year of birth and standing",
    subtitle: "Standing is on a log scale. Click a dot to open that thinker.",
    hover: "point",
    x: { label: "Year of birth", format: axisYear },
    y: { label: "Share of all standing (%)", type: "log", format: (v) => fmt.sig(v, 2) },
    series: [{ name: "Thinkers", type: "scatter", data: pts, color: 0, r: 3, opacity: 0.75 }],
    marks: g.born[i] != null ? [{ type: "point", x: g.born[i], y: pr.scores[i] * 100, text: g.name[i] }] : [],
    onClick: ({ point }) => { if (point) pickThinker(point.id); },
  });
}

$("#app").append(
  names,
  el("div", { class: "field" },
    el("div", { class: "lab" }, el("label", { for: "who", text: `Search ${fmt.int(g.n)} thinkers` })),
    el("div", { class: "row" }, el("div", { style: { flex: "1 1 260px" } }, searchInput),
      button("Open one at random", () => pickThinker(order[Math.floor(Math.random() * Math.min(order.length, 300))]))),
    searchMsg),
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" },
      el("h2", { text: "Most central thinkers" }),
      eraSelect.el, rankList, dampSlider.el),
    el("div", { class: "out" },
      card,
      el("div", { class: "stats" }, sRank.el, sIn.el, sOut.el, sReach.el),
      ego, egoNote,
      el("div", { class: "panel" },
        el("h3", { text: "Trace a line of influence" }),
        el("div", { class: "field", style: { margin: "10px 0" } }, el("div", { class: "lab" }, el("label", { for: "target", text: "From the thinker above to" })), targetInput),
        chainBox))),
  chartBox);

update();
