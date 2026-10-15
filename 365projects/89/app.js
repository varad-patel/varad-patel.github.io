// Day 89: Voting Method Comparer. Interface.
import { $, el, fmt, mount, select, textArea, textField, button, stat, note, debounce, nextFrame, randomSeed } from "../kit/kit.js";
import {
  LETTERS, LIMITS, METHODS, MODELS, GUILBAUD, parseProfile, formatProfile, resizeTypes, runAll, agreement, generate, createTally, insincereSearch,
} from "./logic.js";

mount();

/* ---------- examples ---------- */
const EXAMPLES = [
  {
    label: "Three winners from 21 voters", n: 4, names: "",
    about: "From Pacuit's entry on voting methods in the Stanford Encyclopedia of Philosophy (section 1), with approval lines added. Plurality, Borda and Condorcet's head-to-head test pick three different candidates.",
    text: "3: A > B | C > D\n5: A > C | B > D\n7: B | D > C > A\n6: C > B | D > A",
  },
  {
    label: "Runoff against instant runoff", n: 4, names: "",
    about: "Pacuit's second example (section 2.1), with approval lines added: with four candidates the two-round runoff and instant runoff elect different people.",
    text: "7: A | B > C > D\n5: B > C | D > A\n4: D > B | C > A\n3: C > D | A > B",
  },
  {
    label: "The centre squeeze", n: 3, names: "Left, Centre, Right",
    about: "A made-up profile. The centrist is everyone's first or second choice and beats each rival head to head, but has the fewest first preferences, so plurality and both runoffs pass over her.",
    text: "35: A | B > C\n33: C | B > A\n32: B | C > A",
  },
  {
    label: "Borda against Condorcet", n: 3, names: "",
    about: "A made-up profile. A majority ranks A first, so A beats everyone head to head, but B's many second places give B the most Borda points.",
    text: "3: A | B > C\n2: B > C | A",
  },
  {
    label: "Condorcet's paradox", n: 3, names: "",
    about: "Condorcet's paradox: a majority prefers A to B, a majority B to C and a majority C to A. With equal groups no method has a reason to prefer anyone.",
    text: "10: A | B > C\n10: B | C > A\n10: C | A > B",
  },
];

/* ---------- state ---------- */
const state = { n: 4, about: EXAMPLES[0].about, last: null };

/* ---------- controls ---------- */
const exampleRow = el("div", { class: "row d89-examples", role: "group", "aria-label": "Example profiles" },
  EXAMPLES.map((ex) => button(ex.label, () => loadExample(ex), { small: true })));
const aboutLine = el("p", { class: "small muted d89-about" });
const nSel = select({
  label: "Candidates", value: "4", options: [3, 4, 5, 6].map((v) => ({ value: String(v), label: `${v}: ${LETTERS.slice(0, v).split("").join(", ")}` })),
  hint: "Changing the number keeps every voter: a dropped candidate is taken off each ballot, a new one goes at the bottom.",
  onChange: (v) => resize(Number(v)),
});
const namesBox = textField({ label: "Names (optional)", placeholder: "for example: Left, Centre, Right", hint: "Separated by commas, in letter order, up to 24 characters each.", onInput: () => update() });
const profileBox = textArea({
  label: "Ballots", rows: 7, mono: true,
  hint: "One line per group of identical ballots: how many voters, a colon, then the candidates from first to last. A \"|\" marks the voters' approval line: they approve the candidates before it. Example: 12: B > A | C",
  onInput: debounce(() => { state.about = ""; update(); }, 250),
});
profileBox.input.setAttribute("aria-describedby", "d89-profile-msg");
// One character over the limit, so that a longer paste is cut there and reported instead of silently shortened.
profileBox.input.maxLength = LIMITS.text + 1;
namesBox.input.maxLength = 200;
const profileMsg = el("div", { id: "d89-profile-msg", class: "d89-msg", "aria-live": "polite" });

const modelSel = select({ label: "Voters' preferences", value: "ic", options: MODELS });
const votersSel = select({ label: "Voters", value: "1000", options: [11, 101, 1000, 10001].map((v) => ({ value: String(v), label: fmt.int(v) })) });
const seedBox = el("input", { type: "number", id: "d89-seed", min: 1, max: 4294967295, step: 1, value: 1, inputmode: "numeric", "aria-describedby": "d89-seed-msg" });
const seedMsg = el("div", { id: "d89-seed-msg", class: "d89-msg", "aria-live": "polite" });
const genBtn = button("Generate an electorate", () => generateNow(), { small: true, primary: true });
const genPanel = el("div", { class: "panel d89-gen" },
  el("h3", { text: "Or generate an electorate" }),
  modelSel.el, votersSel.el,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: "d89-seed", text: "Seed" })), seedBox, seedMsg,
    el("div", { class: "row" }, button("New seed", () => { seedBox.value = String(1 + (randomSeed() % 999999)); }, { small: true }), genBtn)),
  el("p", { class: "small muted", text: "Uses the number of candidates above. Each voter ranks the candidates by a utility and approves those above their own average utility." }));

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })), exampleRow),
  aboutLine, nSel.el, namesBox.el, profileBox.el, profileMsg, genPanel);

/* ---------- outputs ---------- */
const sVoters = stat("Voters");
const sWinners = stat("Different winners");
const sCondorcet = stat("Condorcet winner");
const status = el("p", { class: "sr-only", role: "status" });
const summary = el("p", { class: "d89-summary" });
const resultsBox = el("div", { class: "d89-rt-box" });
const detailBox = el("div", { class: "d89-details" });
const out = el("div", { class: "out", id: "d89-results" }, el("div", { class: "stats" }, sVoters.el, sWinners.el, sCondorcet.el), status, summary, resultsBox, detailBox);

/* ---------- insincere ballots ---------- */
const lieSel = select({ label: "Method", value: "borda", options: METHODS.map((m) => ({ value: m.key, label: m.label })), onChange: () => { state.announceLies = true; drawLies(); } });
const lieBox = el("div");
const lieStatus = el("p", { class: "sr-only", role: "status" });
const liePart = el("section", { class: "d89-part", id: "d89-lies", "aria-labelledby": "d89-h-lies" },
  el("h2", { id: "d89-h-lies", text: "Could a group do better by voting differently?" }),
  el("p", { class: "small", text: "For the profile above, the tool tries every other ballot for each group of identical voters, all switching together, and reports a ballot that would elect someone every one of them prefers to the current winner. Each line of the profile is one group. Part of a group, single voters and several groups together are not tried, so finding nothing does not prove that no one can gain. The Gibbard-Satterthwaite theorem says that every reasonable method can be gamed at some profile." }),
  el("div", { class: "d89-lie-grid" }, lieSel.el, lieBox), lieStatus);

/* ---------- simulation ---------- */
const simN = select({ label: "Candidates in each election", value: "3", options: [3, 4, 5, 6].map((v) => ({ value: String(v), label: String(v) })) });
const simVoters = select({ label: "Voters in each election", value: "101", options: [11, 101, 1001].map((v) => ({ value: String(v), label: fmt.int(v) })) });
const simCount = select({ label: "Elections", value: "1000", options: [100, 1000, 10000].map((v) => ({ value: String(v), label: fmt.int(v) })) });
const simModel = select({ label: "Voters' preferences", value: "ic", options: MODELS });
const simSeed = el("input", { type: "number", id: "d89-simseed", min: 1, max: 1000000000, step: 1, value: 1, inputmode: "numeric", "aria-describedby": "d89-simseed-msg" });
const simSeedMsg = el("div", { id: "d89-simseed-msg", class: "d89-msg", "aria-live": "polite" });
const runBtn = button("Run the elections", () => runSim(), { primary: true, small: true });
const stopBtn = button("Stop", () => stopSim(), { small: true });
stopBtn.hidden = true;
const simProgress = el("p", { class: "small", tabindex: "-1" });
const simStatus = el("p", { class: "sr-only", role: "status" });
const simOut = el("div", { class: "d89-rt-box" });
const simPart = el("section", { class: "d89-part", id: "d89-sim", "aria-labelledby": "d89-h-sim" },
  el("h2", { id: "d89-h-sim", text: "How often do the methods disagree?" }),
  el("p", { class: "small", text: "Draw many random electorates and count how often each method elects the Condorcet winner, when there is one, and how often all seven agree." }),
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" }, simN.el, simVoters.el, simCount.el, simModel.el,
      el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: "d89-simseed", text: "First seed" })), simSeed, simSeedMsg,
        el("div", { class: "hint", text: "Election k uses seed first + k - 1, so a run can be repeated exactly." })),
      el("div", { class: "row" }, runBtn, stopBtn)),
    el("div", { class: "out" }, simProgress, simStatus, simOut)));

const jump = el("nav", { class: "row d89-jump", "aria-label": "Jump to a part of the tool" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d89-results", "the winners"], ["#d89-lies", "voting differently"], ["#d89-sim", "many elections"]].map(([href, text]) => el("a", { href, class: "small", text })));

$("#app").append(jump, el("div", { class: "tool-grid wide-controls" }, controls, out), liePart, simPart);

/* ---------- names ---------- */
function names() {
  const raw = namesBox.value.split(",").map((s) => s.trim());
  const errors = [];
  if (namesBox.value.trim() && raw.length > state.n) errors.push(`There are ${raw.length} names for ${state.n} candidates. Give at most ${state.n}.`);
  const long = raw.findIndex((s) => s.length > LIMITS.name);
  if (long >= 0) errors.push(`Name ${long + 1} is ${raw[long].length} characters long; keep names to ${LIMITS.name}.`);
  return { list: LETTERS.slice(0, state.n).split("").map((L, i) => (raw[i] && raw[i].length <= LIMITS.name ? `${L} (${raw[i]})` : L)), errors };
}
let label = (c) => LETTERS[c];
const list = (cs) => (cs.length === 1 ? label(cs[0]) : cs.length === 2 ? `${label(cs[0])} and ${label(cs[1])}` : `${cs.slice(0, -1).map(label).join(", ")} and ${label(cs.at(-1))}`);
// Method names as they read inside a sentence.
const IN = { plurality: "plurality", twoRound: "the two-round runoff", irv: "instant runoff", approval: "approval", borda: "the Borda count", copeland: "Copeland", schulze: "Schulze" };
const plural = (k, word) => `${fmt.int(k)} ${word}${k === 1 ? "" : "s"}`;
const share = (k, total) => `${fmt.int(k)} of ${fmt.int(total)}`;
const winnerText = (w) => (w.length === 1 ? label(w[0]) : `Tie: ${list(w)}`);

/* ---------- loading ---------- */
function loadExample(ex) {
  state.n = ex.n;
  nSel.value = String(ex.n);
  namesBox.value = ex.names;
  profileBox.value = ex.text;
  state.about = ex.about;
  update();
}

function resize(to) {
  const from = state.n;
  const parsed = parseProfile(profileBox.value, from);
  state.n = to;
  if (parsed.types) profileBox.value = formatProfile(resizeTypes(parsed.types, from, to));
  state.about = "";
  update();
}

function generateNow() {
  const seed = Number(seedBox.value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 4294967295) { seedMsg.textContent = "Enter a whole number from 1 to 4,294,967,295 as the seed."; seedBox.classList.add("invalid"); return; }
  seedMsg.textContent = ""; seedBox.classList.remove("invalid");
  const g = generate({ n: state.n, voters: Number(votersSel.value), model: modelSel.value, seed });
  profileBox.value = formatProfile(g.types);
  namesBox.value = "";
  const where = g.positions ? ` Candidates stand at ${g.positions.map((p, c) => `${LETTERS[c]} ${fmt.signed(p, 2)}`).join(", ")} on the line; voters are spread around 0.` : "";
  state.about = `Generated: ${fmt.int(Number(votersSel.value))} voters, ${modelSel.value === "ic" ? "impartial culture" : "left and right"}, seed ${seed}.${where}`;
  update();
}

/* ---------- counting ---------- */
function update() {
  aboutLine.textContent = state.about;
  aboutLine.hidden = !state.about;
  const nm = names();
  label = (c) => nm.list[c];
  const parsed = parseProfile(profileBox.value, state.n);
  const problems = [...(parsed.errors || []), ...nm.errors];
  profileBox.input.classList.toggle("invalid", Boolean(parsed.errors));
  if (parsed.errors) profileBox.input.setAttribute("aria-invalid", "true"); else profileBox.input.removeAttribute("aria-invalid");
  namesBox.input.classList.toggle("invalid", nm.errors.length > 0);
  const shown = problems.slice(0, 4);
  profileMsg.replaceChildren(...(problems.length
    ? [note("bad", el("strong", { text: problems.length === 1 ? "One thing to fix. " : `${problems.length} things to fix${problems.length > 4 ? "; the first four" : ""}. ` }), el("ul", {}, shown.map((p) => el("li", { text: p }))))]
    : (parsed.notes || []).map((t) => note("", t))));
  if (parsed.errors) {
    summary.textContent = "Fix the ballots to see the winners. The results below are from the last profile that could be read.";
    status.textContent = "The ballots need fixing; see the messages under the box.";
    return;
  }
  const r = runAll(parsed.types, state.n);
  state.last = { types: parsed.types, r };
  draw(r);
  drawLies();
}

function why(key, r) {
  const T = r.total;
  const x = r[key];
  if (key === "plurality") {
    const top = Math.max(...x.tally);
    return `${x.winners.length > 1 ? "Most first preferences, tied" : "Most first preferences"}: ${share(top, T)} (${fmt.pct(top / T, 1)}).`;
  }
  if (key === "twoRound") {
    if (x.majority !== null) return `${label(x.majority)} has a majority of first preferences, ${share(x.tally[x.majority], T)}, and wins in the first round.`;
    const runs = x.pairs.map((p) => `${label(p.a)} ${fmt.int(p.va)}, ${label(p.b)} ${fmt.int(p.vb)}`);
    return x.pairs.length === 1 ? `No first-round majority, so ${label(x.pairs[0].a)} and ${label(x.pairs[0].b)} meet: ${runs[0]}.` : `No first-round majority, and a tie decides who reaches the second round. Every pair that could: ${runs.join("; ")}.`;
  }
  if (key === "irv") {
    const elim = x.rounds.filter((rd) => rd.eliminated !== null).map((rd) => label(rd.eliminated));
    const last = x.rounds.at(-1);
    const tieRound = x.rounds.find((rd) => rd.tie);
    const tieText = tieRound ? ` A tie for last place in round ${x.rounds.indexOf(tieRound) + 1} is followed every way; ${x.winners.length > 1 ? `different ways elect ${list(x.winners)}` : `every way elects ${label(x.winners[0])}`}.` : "";
    if (last.majority !== null) return `${elim.length ? `${elim.join(", then ")} ${elim.length === 1 ? "is" : "are"} eliminated; ` : ""}${label(last.majority)} has a majority of the ballots, ${share(last.tally[last.majority], last.total)}, in round ${x.rounds.length}.${tieText}`;
    return `${elim.length ? `${elim.join(", then ")} eliminated; ` : ""}no majority is reached.${tieText}`;
  }
  if (key === "approval") {
    const top = Math.max(...x.tally);
    return `Approved by ${share(top, T)} voters${x.winners.length > 1 ? " each" : ""}.`;
  }
  if (key === "borda") {
    const order = x.tally.map((v, c) => [v, c]).sort((a, b) => b[0] - a[0]);
    return `Points ${state.n - 1} for a first place down to 0 for last: ${order.map(([v, c]) => `${label(c)} ${fmt.int(v)}`).join(", ")}.`;
  }
  if (key === "copeland") {
    const best = Math.max(...x.score);
    return `Head-to-head wins minus losses: ${x.score.map((v, c) => `${label(c)} ${fmt.signed(v, 0).replace("+0", "0")}`).join(", ")}${best === state.n - 1 ? ". The winner beats everyone" : ""}.`;
  }
  if (key === "schulze") {
    if (r.condorcet !== null) return `${label(r.condorcet)} beats every rival head to head, so wins.`;
    return `No one beats everyone head to head, so the strongest chains of head-to-head wins decide (the table below has them).`;
  }
  return "";
}

function draw(r) {
  const groups = agreement(r);
  const distinct = [...new Set(METHODS.flatMap((m) => r[m.key].winners))];
  sVoters.set(fmt.int(r.total), "");
  sWinners.set(String(groups.length === 1 && groups[0].winners.length === 1 ? 1 : distinct.length), groups.length === 1 && groups[0].winners.length === 1 ? "all seven methods agree" : `${distinct.length === 1 ? "candidate" : "candidates"} named by at least one method`);
  sCondorcet.set(r.condorcet === null ? "None" : label(r.condorcet), r.condorcet === null ? "no candidate beats every other head to head" : "beats every other candidate head to head");
  const names = (keys) => { const w = keys.map((k) => IN[k]); return w.length === 1 ? w[0] : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`; };
  const sentence = groups.map((g, i) => (g.winners.length === 1
    ? `${label(g.winners[0])} ${i === 0 ? "wins " : ""}under ${names(g.methods)}`
    : `${i === 0 ? "there is " : ""}a tie between ${list(g.winners)} under ${names(g.methods)}`)).join("; ");
  summary.textContent = `${groups.length === 1 ? "Every method gives the same answer" : `The seven methods give ${groups.length} different answers`}: ${sentence}.`;
  status.textContent = summary.textContent;

  resultsBox.replaceChildren(el("table", { class: "tbl d89-rt" },
    el("caption", { text: "Winner under each method" }),
    el("thead", {}, el("tr", {}, ["Method", "Winner", "How"].map((h) => el("th", { scope: "col", text: h })))),
    el("tbody", {}, METHODS.map((m) => el("tr", {},
      el("th", { scope: "row", text: m.label }),
      el("td", { "data-label": "Winner", class: "d89-win", text: winnerText(r[m.key].winners) }),
      el("td", { "data-label": "How", text: why(m.key, r) }))))));

  // Details: scores, the head-to-head table, the runoff rounds.
  const n = state.n, C = Array.from({ length: n }, (_, c) => c);
  const scores = el("table", { class: "tbl d89-scores d89-fit" },
    el("caption", { text: "Scores by candidate" }),
    el("thead", {}, el("tr", {}, ["Candidate", "First preferences", "Approvals", "Borda points", "Copeland"].map((h, i) => el("th", { scope: "col", class: i ? "num" : null, text: h })))),
    el("tbody", {}, C.map((c) => el("tr", {}, el("th", { scope: "row", text: label(c) }),
      el("td", { class: "num", "data-label": "First preferences", text: fmt.int(r.plurality.tally[c]) }), el("td", { class: "num", "data-label": "Approvals", text: fmt.int(r.approval.tally[c]) }),
      el("td", { class: "num", "data-label": "Borda points", text: fmt.int(r.borda.tally[c]) }), el("td", { class: "num", "data-label": "Copeland", text: fmt.signed(r.copeland.score[c], 0) })))));
  const d = r.pairwise, p = r.schulze.paths;
  const h2h = el("table", { class: "tbl d89-matrix d89-fit" },
    el("caption", { text: "Head to head: voters ranking the row's candidate above the column's" }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Row over column" }), C.map((c) => el("th", { scope: "col", class: "num", text: LETTERS[c] })))),
    el("tbody", {}, C.map((x) => el("tr", {}, el("th", { scope: "row", text: label(x) }),
      C.map((y) => el("td", { class: `num${x !== y && d[x][y] > d[y][x] ? " d89-beat" : ""}${x === y ? " d89-self" : ""}`, "data-label": `over ${LETTERS[y]}`, text: x === y ? "–" : `${fmt.int(d[x][y])}${d[x][y] > d[y][x] ? " wins" : d[x][y] === d[y][x] ? " tie" : ""}` }))))));
  const paths = el("table", { class: "tbl d89-matrix d89-fit" },
    el("caption", { text: "Schulze: strength of the strongest chain of wins from row to column" }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "From row to column" }), C.map((c) => el("th", { scope: "col", class: "num", text: LETTERS[c] })))),
    el("tbody", {}, C.map((x) => el("tr", {}, el("th", { scope: "row", text: label(x) }),
      C.map((y) => el("td", { class: `num${x !== y && p[x][y] > p[y][x] ? " d89-beat" : ""}${x === y ? " d89-self" : ""}`, "data-label": `to ${LETTERS[y]}`, text: x === y ? "–" : `${fmt.int(p[x][y])}${x !== y && p[x][y] > p[y][x] ? " wins" : ""}` }))))));
  const rounds = r.irv.rounds;
  const irvTable = el("table", { class: "tbl d89-scores d89-fit" },
    el("caption", { text: "Instant runoff: ballots for each candidate still in, round by round" }),
    el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Candidate" }), rounds.map((_, i) => el("th", { scope: "col", class: "num", text: `Round ${i + 1}` })))),
    el("tbody", {}, C.map((c) => el("tr", {}, el("th", { scope: "row", text: label(c) }),
      rounds.map((rd, i) => el("td", { class: `num${rd.alive.includes(c) ? "" : " d89-self"}`, "data-label": `Round ${i + 1}`, text: rd.alive.includes(c) ? `${fmt.int(rd.tally[c])}${rd.eliminated === c ? " (out)" : rd.majority === c ? " (wins)" : ""}` : "" }))))));
  const tieNotes = rounds.filter((rd) => rd.tie).map((rd) => el("p", { class: "small", text: `Round ${rounds.indexOf(rd) + 1}: ${list(rd.tie.map((t) => t.candidate))} tie for last place. ${rd.tie.map((t) => `Eliminating ${label(t.candidate)} leads to ${list(t.leadsTo)}`).join("; ")}. The table follows the first.` }));
  const block = (title, ...kids) => el("details", { class: "d89-more" }, el("summary", { text: title }), el("div", { class: "d89-more-body" }, ...kids));
  detailBox.replaceChildren(
    block("Scores by candidate", scores),
    block("Head-to-head contests", h2h, el("p", { class: "small muted", text: "With every voter ranking every candidate, counting a defeat by its winning votes or by its margin gives the same Schulze result." }), paths),
    block("Instant runoff, round by round", irvTable, ...tieNotes));
  fitTables();
}

// A table turns into a list whenever it is wider than its box, however wide the screen.
function fitTables() {
  for (const t of document.querySelectorAll("#app table.d89-fit")) {
    if (t.offsetParent === null) continue;
    t.classList.remove("d89-stacked");
    if (t.scrollWidth > t.parentElement.clientWidth + 1) t.classList.add("d89-stacked");
  }
}
if (typeof ResizeObserver !== "undefined") new ResizeObserver(nextFrame(fitTables)).observe(document.querySelector("#app"));
document.querySelector("#app").addEventListener("toggle", () => fitTables(), true);

/* ---------- insincere ballots ---------- */
// The search can take most of a second with six candidates and 24 groups, so it runs a group at a time in short
// slices, and a new profile or method cancels a search still running.
let lieJob = 0;
function drawLies() {
  if (!state.last) return;
  const id = ++lieJob;
  const { types, r } = state.last;
  const key = lieSel.value;
  const n = state.n;
  if (types.length > 24) { lieBox.replaceChildren(note("", `This profile has ${fmt.int(types.length)} groups of identical ballots; the search runs for 24 or fewer. Load an example to try it.`)); return; }
  const search = insincereSearch(types, n, key);
  const found = [];
  let g = 0;
  const progress = el("p", { class: "small muted", text: "Searching…" });
  const slice = () => {
    if (id !== lieJob) return;
    const t0 = performance.now();
    while (g < types.length && performance.now() - t0 < 20) found.push(search.group(g++));
    if (g < types.length) {
      progress.textContent = `Searching: group ${fmt.int(g)} of ${fmt.int(types.length)}…`;
      if (!progress.isConnected) lieBox.replaceChildren(progress);
      setTimeout(slice, 0);
      return;
    }
    showLies(types, r, key, { searched: true, before: search.before, found });
  };
  slice();
}
function showLies(types, r, key, res) {
  const name = METHODS.find((m) => m.key === key).label;
  const fmtBallot = (b) => (key === "approval" ? `approve ${b.approve ? list(b.ranking.slice(0, b.approve)) : "no one"}` : b.ranking.map(label).join(" > "));
  const trueBallot = (t) => (key === "approval" ? `${t.ranking.map(label).join(" > ")}, approving ${t.approve ? list(t.ranking.slice(0, t.approve)) : "no one"}` : t.ranking.map(label).join(" > "));
  const found = res.found.filter(Boolean);
  const head = el("p", { class: "small", text: `${name} ${r[key].winners.length === 1 ? `elects ${label(r[key].winners[0])}` : `ends in a tie between ${list(r[key].winners)}`}. ${found.length ? `${found.length === 1 ? "One group" : `${found.length} groups`} could do better:` : "No group of identical voters can elect someone they all prefer by switching together to another ballot."}` });
  // Announced when the visitor picks a method; a new profile is already announced by the summary above.
  if (state.announceLies) { lieStatus.textContent = head.textContent; state.announceLies = false; }
  lieBox.replaceChildren(head,
    ...(found.length ? [el("ul", { class: "d89-lies" }, found.map((f) => el("li", { text: `The ${plural(types[f.group].count, "voter")} who rank ${trueBallot(types[f.group])} could ${key === "approval" ? "" : "vote "}${fmtBallot(f.ballot)} instead, and ${IN[key]} would elect ${winnerText(f.after)}.` })))] : []));
}

/* ---------- simulation ---------- */
let simJob = 0, sim = null;
function runSim() {
  const seed = Number(simSeed.value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 1e9) { simSeedMsg.textContent = "Enter a whole number from 1 to 1,000,000,000 as the first seed."; simSeed.classList.add("invalid"); return; }
  simSeedMsg.textContent = ""; simSeed.classList.remove("invalid");
  const id = ++simJob;
  const cfg = { n: Number(simN.value), voters: Number(simVoters.value), total: Number(simCount.value), model: simModel.value, seed };
  sim = { cfg, tally: createTally(), done: 0 };
  stopBtn.hidden = false;
  const slice = () => {
    if (id !== simJob) return;
    const t0 = performance.now();
    while (sim.done < cfg.total && performance.now() - t0 < 25) {
      const g = generate({ n: cfg.n, voters: cfg.voters, model: cfg.model, seed: cfg.seed + sim.done });
      sim.tally.add(runAll(g.types, cfg.n));
      sim.done++;
    }
    simProgress.textContent = `Election ${fmt.int(sim.done)} of ${fmt.int(cfg.total)}…`;
    if (sim.done < cfg.total) { setTimeout(slice, 0); return; }
    finishSim(false);
  };
  simProgress.textContent = `Election 0 of ${fmt.int(cfg.total)}…`;
  setTimeout(slice, 0);
}
function stopSim() { if (!sim || sim.done >= sim.cfg.total) return; simJob++; finishSim(true); }
function finishSim(stopped) {
  if (document.activeElement === stopBtn) simProgress.focus();
  stopBtn.hidden = true;
  const s = sim.tally.summary, c = sim.cfg;
  if (!s.elections) { simProgress.textContent = "Stopped before any election was run."; simOut.replaceChildren(); return; }
  simProgress.textContent = `${stopped ? `Stopped after ${fmt.int(s.elections)} of ${fmt.int(c.total)}` : fmt.int(s.elections)} elections of ${fmt.int(c.voters)} voters and ${c.n} candidates, ${c.model === "ic" ? "impartial culture" : "voters on a line"}, seeds ${fmt.int(c.seed)} to ${fmt.int(c.seed + s.elections - 1)}.`;
  const shareOf = (k, of) => (of ? fmt.pct(k / of, 1) : "–");
  const guil = c.n === 3 && c.model === "ic" ? ` As the number of voters grows, the share for three candidates under impartial culture tends to ${fmt.pct(GUILBAUD, 1)}.` : "";
  const line = c.model === "line" ? " Voters on a line always have a Condorcet winner when their number is odd." : "";
  simOut.replaceChildren(
    el("p", { class: "small", text: `A Condorcet winner existed in ${shareOf(s.withCondorcet, s.elections)} of the elections.${guil}${line} All seven methods named the same single winner in ${shareOf(s.allAgree, s.elections)}, and the methods named ${fmt.num(s.distinct / s.elections, 2)} different candidates on average.` }),
    el("table", { class: "tbl d89-rt" },
      el("caption", { text: `${fmt.int(s.elections)} simulated elections` }),
      el("thead", {}, el("tr", {}, ["Method", "Elects the Condorcet winner, when there is one", "Ends in a tie"].map((h, i) => el("th", { scope: "col", class: i ? "num" : null, text: h })))),
      el("tbody", {}, METHODS.map((m) => el("tr", {}, el("th", { scope: "row", text: m.label }),
        el("td", { class: "num", "data-label": "Elects the Condorcet winner", text: shareOf(s.picksCondorcet[m.key], s.withCondorcet) }),
        el("td", { class: "num", "data-label": "Ends in a tie", text: shareOf(s.ties[m.key], s.elections) }))))));
  simStatus.textContent = `Done. A Condorcet winner existed in ${shareOf(s.withCondorcet, s.elections)} of ${fmt.int(s.elections)} elections; all methods agreed in ${shareOf(s.allAgree, s.elections)}.`;
}

loadExample(EXAMPLES[0]);
runSim();
