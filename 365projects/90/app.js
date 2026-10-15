// Day 90: Ranked-Choice Election Engine. Interface.
import { $, el, fmt, mount, select, slider, checkbox, textArea, button, stat, note, chart, download, debounce, nextFrame, randomSeed } from "../kit/kit.js";
import { NSW } from "./data.js";
import {
  LIMITS, RULES, DEFAULT_RULES, decodeBytes, createBallotReader, ballotsToCSV, runCount, compareWithPublished, remapPublished,
  contestBallots, resultsToCSV, createSimulation,
} from "./logic.js";

mount();

/* ---------- examples ---------- */
const WORKED = `count,rank1,rank2,rank3
8,Alice,Bob,Carol
5,Bob,Carol,
4,Carol,,Bob
3,Dan,Alice|Carol,Bob
2,Dan,Dan,Carol
1,Alice|Bob,Carol,`;
const TIE = `count,rank1,rank2
15,Rivera,
6,Patel,
5,Quinn,
3,Tanaka,Patel
2,Tanaka,Quinn
2,Singh,Quinn`;
const realText = new Map(NSW.contests.map((c) => { const b = contestBallots(c); return [c.id, ballotsToCSV(b.candidates, b.ballots)]; }));
const EXAMPLES = [
  ...NSW.contests.map((c) => ({ id: c.id, label: `${c.name}, NSW 2023 (real ballots)`, contest: c })),
  { id: "worked", label: "Worked example: irregular ballots", text: WORKED, about: "Made up to show every kind of irregular ballot: a skipped ranking (Carol's voters), an overvote at the second ranking (3 of Dan's), a name ranked twice (2 of Dan's) and an overvote at the first ranking (the last line), which leaves a ballot with nothing to count." },
  { id: "tie", label: "Worked example: a tie", text: TIE, about: "Made up so that Patel and Quinn tie on 9 in round 3. Patel had fewer in round 2 and Quinn fewer in round 1, so the backward and forward rules eliminate different candidates; try both under the counting rules." },
];

/* ---------- state ---------- */
// fileWarnings: what reading an uploaded file noticed (a missing header row, names that differ only in capitals), which
// the grouped text in the box no longer shows; kept while fileNote is.
const state = { preset: "wollondilly", parsedText: null, parsed: null, result: null, fileNote: "", fileWarnings: [], parsing: 0 };

/* ---------- ballots ---------- */
const aboutBox = el("div", { class: "d90-about" });
const fileInput = el("input", { type: "file", id: "d90-file", accept: ".csv,.tsv,.txt,text/csv,text/plain" });
const drop = el("label", { class: "d90-drop", for: "d90-file" },
  el("strong", { text: "Upload a CSV file" }), ` or drop one here. Up to ${LIMITS.bytes / 1024 / 1024} MB and ${fmt.int(LIMITS.rows)} rows; identical ballots are grouped.`, fileInput);
const ballotsBox = textArea({
  label: "Ballots (CSV)", rows: 9, mono: true,
  hint: "One row per ballot, or per group of identical ballots with a count. Edit freely: the count reruns as you type.",
  onInput: debounce(() => { state.preset = null; state.fileNote = ""; recount(); }, 350),
});
ballotsBox.input.wrap = "off";
// One character over the limit, so that a longer paste is cut there and reported (see recount) instead of silently shortened.
ballotsBox.input.maxLength = LIMITS.textBox + 1;
ballotsBox.input.setAttribute("aria-describedby", "d90-msg");
const msgBox = el("div", { id: "d90-msg", class: "d90-msgs" });
const format = el("details", { class: "d90-format" }, el("summary", { text: "The CSV format" }),
  el("div", { class: "small" },
    el("p", { text: "The first line names the columns. A column called count says how many identical ballots the row stands for; a column called id is ignored; every other column is a ranking, first to last, in the order given." }),
    el("pre", { class: "d90-pre", text: "count,rank1,rank2,rank3\n120,Alice,Bob,\n80,Bob,,Carol\n15,Carol|Bob,Alice,Dan" }),
    el("p", { text: "A cell holds one candidate's name, written the same way every time (up to 60 characters). An empty cell, or one of the words undervote, skipped or blank, is a skipped ranking. Two or more names joined by |, or the word overvote, are an overvote: several candidates marked at one ranking. Commas, tabs or semicolons can separate the cells, and a name that contains one goes in double quotes. A cell that begins with an apostrophe followed by =, +, - or @ loses the apostrophe, as in a spreadsheet." })));

/* ---------- rules ---------- */
const overSel = select({ label: "An overvote", value: DEFAULT_RULES.overvote, options: RULES.overvote, onChange: () => recount() });
const skipSel = select({ label: "A skipped ranking", value: DEFAULT_RULES.skips, options: RULES.skips, onChange: () => recount() });
const tieSel = select({ label: "A tie for last place", value: DEFAULT_RULES.tie, options: RULES.tie, onChange: () => recount() });
const seedBox = el("input", { type: "number", id: "d90-seed", min: 1, max: 4294967295, step: 1, value: 1, inputmode: "numeric", "aria-describedby": "d90-seed-msg" });
const seedMsg = el("div", { id: "d90-seed-msg", class: "d90-msg", "aria-live": "polite" });
seedBox.addEventListener("input", debounce(() => recount(), 300));
const untilTwo = checkbox({ label: "Count on until two candidates remain (as New South Wales publishes its counts)", checked: DEFAULT_RULES.untilTwo, onChange: () => recount() });
const rulesPanel = el("div", { class: "panel d90-panel", id: "d90-rules" },
  el("h3", { text: "Counting rules" }),
  overSel.el, skipSel.el, tieSel.el,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: "d90-seed", text: "Seed for draws by lot" })), seedBox, seedMsg,
    el("div", { class: "hint", text: "A draw by lot uses the kit's seeded generator, so the same seed always draws the same way." })),
  untilTwo.el,
  el("p", { class: "small muted", text: "A name ranked twice counts once, at its first place. A ballot with nothing it can count for at its first usable ranking is set aside, as an informal ballot would be." }));

/* ---------- simulation ---------- */
const simN = select({ label: "Candidates", value: "5", options: [2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => ({ value: String(v), label: String(v) })) });
const simVoters = select({ label: "Voters", value: "10000", options: [1000, 10000, 100000].map((v) => ({ value: String(v), label: fmt.int(v) })) });
const simOne = slider({ label: "Rank only their first choice", min: 0, max: 100, step: 5, value: 40, format: (v) => `${v}%` });
const simSkip = slider({ label: "Leave a ranking blank", min: 0, max: 20, step: 1, value: 2, format: (v) => `${v}%` });
const simOver = slider({ label: "Mark two candidates at one ranking", min: 0, max: 20, step: 1, value: 1, format: (v) => `${v}%` });
const simSeed = el("input", { type: "number", id: "d90-simseed", min: 1, max: 4294967295, step: 1, value: 1, inputmode: "numeric", "aria-describedby": "d90-simseed-msg" });
const simSeedMsg = el("div", { id: "d90-simseed-msg", class: "d90-msg", "aria-live": "polite" });
const simProgress = el("p", { class: "small", tabindex: "-1" });
const simPanel = el("section", { class: "d90-part", id: "d90-sim", "aria-labelledby": "d90-h-sim" },
  el("h2", { id: "d90-h-sim", text: "Or simulate an electorate" }),
  el("p", { class: "small", text: "Voters and candidates stand on a left-right line; each voter ranks candidates from nearest to furthest, then stops early or slips as set below. The ballots replace those in the box above and are counted at once." }),
  el("div", { class: "d90-sim-grid" }, simN.el, simVoters.el, simOne.el, simSkip.el, simOver.el,
    el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: "d90-simseed", text: "Seed" })), simSeed, simSeedMsg)),
  el("div", { class: "row" }, button("New seed", () => { simSeed.value = String(1 + (randomSeed() % 999999)); }, { small: true }), button("Generate the ballots", () => generate(), { small: true, primary: true })),
  simProgress);

const controls = el("div", { class: "controls" },
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Examples" })),
    el("div", { class: "row d90-examples", role: "group", "aria-label": "Examples" }, EXAMPLES.map((ex) => button(ex.label, () => loadExample(ex), { small: true })))),
  aboutBox, drop, ballotsBox.el, msgBox, format, rulesPanel);

/* ---------- results ---------- */
const sWinner = stat("Winner");
const sRounds = stat("Rounds");
const sCounted = stat("Ballots counted");
const sExhausted = stat("Exhausted by the last round");
const status = el("p", { class: "sr-only", role: "status" });
const official = el("div");
const summaryBox = el("div", { class: "d90-stack" });
const roundBox = el("div", { class: "d90-round-box", id: "d90-rounds" });
const chartBox = el("div");
const transferBox = el("div");
const exportRow = el("div", { class: "row", id: "d90-export" },
  button("Download the round-by-round results (CSV)", () => { if (state.result) download("ranked-choice-results.csv", "﻿" + resultsToCSV(state.result), "text/csv"); }, { small: true }),
  button("Download the ballots (CSV)", () => { if (state.parsed?.candidates) download("ranked-choice-ballots.csv", "﻿" + ballotsToCSV(state.parsed.candidates, state.parsed.ballots), "text/csv"); }, { small: true }));
const out = el("div", { class: "out", id: "d90-count" },
  el("div", { class: "stats" }, sWinner.el, sRounds.el, sCounted.el, sExhausted.el), status, official, summaryBox, roundBox, chartBox, transferBox,
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Export" })), exportRow,
    el("div", { class: "hint", text: "Names that a spreadsheet would read as a formula (starting with =, +, - or @) are written with an apostrophe in front." })));

const jump = el("nav", { class: "row d90-jump", "aria-label": "Jump to a part of the tool" },
  el("span", { class: "small muted", text: "Jump to:" }),
  [["#d90-count", "the count"], ["#d90-rounds", "round by round"], ["#d90-rules", "counting rules"], ["#d90-export", "export"], ["#d90-sim", "simulate"]].map(([href, text]) => el("a", { href, class: "small", text })));

$("#app").append(jump, el("div", { class: "tool-grid" }, controls, out), simPanel);
// The round-by-round table above is the chart's text equivalent, so the chart does not repeat it as a table of its own.
const plot = chart(chartBox, { series: [], height: 300, table: false });

/* ---------- loading ---------- */
function loadExample(ex) {
  state.fileNote = "";
  if (ex.contest) {
    ballotsBox.value = realText.get(ex.id);
    state.preset = ex.id;
  } else {
    ballotsBox.value = ex.text;
    state.preset = ex.id;
  }
  if (ex.id === "tie") tieSel.value = "backward";
  recount();
}

function showAbout() {
  const ex = EXAMPLES.find((e) => e.id === state.preset);
  const parts = [];
  if (ex?.contest) {
    const c = ex.contest;
    parts.push(el("p", {}, el("strong", { text: `${c.name}, ${c.election}, ${fmt.date(c.date)}. ` }),
      `Every formal ballot paper: ${fmt.int(c.formal)}, with ${fmt.int(c.informal)} informal papers set aside and ${fmt.int(c.enrolled)} electors enrolled. Preferences as the NSW Electoral Commission counted them, from its preference data and published distribution of preferences for ${c.name} on its `,
      // The Commission's terms ask that links go to a high-level page and open in a new window.
      el("a", { href: "https://pastvtr.elections.nsw.gov.au/SG2301", target: "_blank", rel: "noopener", text: "2023 results site" }), `. ${NSW.notice}, `,
      el("a", { href: NSW.licenceUrl, text: "CC BY 4.0" }), `; retrieved ${fmt.date(NSW.retrieved)}. Identical preference sequences are grouped here with a count.`));
  } else if (ex?.about) parts.push(el("p", { text: ex.about }));
  if (state.fileNote) parts.push(el("p", { text: state.fileNote }));
  aboutBox.replaceChildren(...parts);
  aboutBox.hidden = !parts.length;
}

/* ---------- uploads ---------- */
async function readFile(file) {
  if (!file) return;
  const fail = (text) => { msgBox.replaceChildren(note("bad", text)); };
  if (/\.(xlsx?|ods|numbers|xlsm)$/i.test(file.name)) return fail(`"${file.name}" is a spreadsheet workbook. Open it and save the sheet as CSV, then upload that file.`);
  if (file.size > LIMITS.bytes) return fail(`"${file.name}" is ${fmt.num(file.size / 1024 / 1024, 1)} MB; the limit is ${LIMITS.bytes / 1024 / 1024} MB. Group identical ballots into one row each with a count column, or split the file.`);
  if (file.size === 0) return fail(`"${file.name}" is empty.`);
  msgBox.replaceChildren(note("", `Reading ${file.name}…`));
  let decoded;
  try { decoded = decodeBytes(new Uint8Array(await file.arrayBuffer())); } catch { return fail(`"${file.name}" could not be read.`); }
  parseInSlices(decoded.text, (parsed) => {
    if (parsed.errors) { showMessages(parsed); return; }
    const text = ballotsToCSV(parsed.candidates, parsed.ballots);
    const enc = decoded.encoding === "windows-1252" ? " The file is not UTF-8, so it was read as Windows-1252; if accented letters look wrong, save it as CSV UTF-8 and upload it again." : "";
    if (text.length > LIMITS.textBox) {
      return fail(`"${file.name}" has ${fmt.int(parsed.rows)} rows and ${fmt.int(parsed.ballots.length)} different ballots, too many to show and edit here (the box holds ${fmt.int(LIMITS.textBox)} characters). Group the ballots by count first.`);
    }
    state.preset = null;
    state.fileWarnings = parsed.warnings;
    state.fileNote = `Read "${file.name}": ${plural(parsed.rows, "row")}, ${plural(parsed.total, "ballot")}, ${parsed.ballots.length === 1 ? "all the same" : `${fmt.int(parsed.ballots.length)} different ones`}, shown in the box with a count column.${enc}`;
    ballotsBox.value = text;
    recount();
  });
}
fileInput.addEventListener("change", () => { readFile(fileInput.files[0]); fileInput.value = ""; });
const app = $("#app");
app.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
app.addEventListener("dragleave", () => drop.classList.remove("over"));
app.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); readFile(e.dataTransfer?.files?.[0]); });

/* ---------- reading in slices ---------- */
function parseInSlices(text, done) {
  const id = ++state.parsing;
  const reader = createBallotReader(text);
  if (reader.errors) { done(reader); return; }
  const slice = () => {
    if (id !== state.parsing) return;
    const t0 = performance.now();
    let finished = false;
    while (!finished && performance.now() - t0 < 25) finished = reader.step(5000);
    if (!finished) {
      const p = reader.progress;
      msgBox.replaceChildren(note("", `Reading the ballots: line ${fmt.int(p.done)} of ${fmt.int(p.total)}…`));
      setTimeout(slice, 0);
      return;
    }
    done(reader.finish());
  };
  slice();
}

/* ---------- simulation ---------- */
let simJob = 0;
function generate() {
  const seed = Number(simSeed.value);
  if (!Number.isInteger(seed) || seed < 1 || seed > 4294967295) { simSeedMsg.textContent = "Enter a whole number from 1 to 4,294,967,295 as the seed."; simSeed.classList.add("invalid"); return; }
  simSeedMsg.textContent = ""; simSeed.classList.remove("invalid");
  const id = ++simJob;
  const opts = { n: Number(simN.value), voters: Number(simVoters.value), seed, justOne: simOne.value / 100, skipRate: simSkip.value / 100, overRate: simOver.value / 100 };
  const sim = createSimulation(opts);
  const slice = () => {
    if (id !== simJob) return;
    const t0 = performance.now();
    let finished = false;
    while (!finished && performance.now() - t0 < 25) finished = sim.step(500);
    if (!finished) { simProgress.textContent = `Simulating voters: ${fmt.int(sim.done)} of ${fmt.int(opts.voters)}…`; setTimeout(slice, 0); return; }
    const res = sim.result();
    simProgress.textContent = `${fmt.int(opts.voters)} voters simulated, seed ${seed}.`;
    state.preset = null;
    state.fileWarnings = [];
    state.fileNote = `Simulated: ${fmt.int(opts.voters)} voters, ${opts.n} candidates on a line at ${res.positions.map((p, c) => `${String.fromCharCode(65 + c)} ${fmt.signed(p, 2)}`).join(", ")}, ${simOne.value}% ranking one candidate only, ${simSkip.value}% leaving a blank, ${simOver.value}% marking two at one ranking, seed ${seed}.`;
    ballotsBox.value = ballotsToCSV(res.candidates, res.ballots);
    recount();
    simProgress.textContent += " The count above now uses these ballots.";
  };
  simProgress.textContent = "Simulating voters…";
  setTimeout(slice, 0);
}

/* ---------- counting ---------- */
function readRules() {
  const seed = Number(seedBox.value);
  const okSeed = Number.isInteger(seed) && seed >= 1 && seed <= 4294967295;
  seedMsg.textContent = okSeed ? "" : "Enter a whole number from 1 to 4,294,967,295 as the seed.";
  seedBox.classList.toggle("invalid", !okSeed);
  return okSeed ? { overvote: overSel.value, skips: skipSel.value, tie: tieSel.value, seed, untilTwo: untilTwo.checked } : null;
}

function recount() {
  showAbout();
  const text = ballotsBox.value;
  const rules = readRules();
  if (!rules) return;
  const go = (parsed) => {
    state.parsedText = text;
    state.parsed = parsed;
    showMessages(parsed);
    if (parsed.errors) return;
    state.result = runCount(parsed.candidates, parsed.ballots, rules);
    draw(state.result, rules);
  };
  if (text.length > LIMITS.textBox) {
    ++state.parsing;
    state.parsedText = null;
    showMessages({ errors: [`The box holds at most ${fmt.int(LIMITS.textBox)} characters and this text is longer, so it was cut off. Upload the ballots as a file instead (up to ${LIMITS.bytes / 1024 / 1024} MB), or group identical ballots with a count column.`] });
    return;
  }
  if (state.parsedText === text && state.parsed) go(state.parsed);
  else parseInSlices(text, go);
}

function showMessages(parsed) {
  ballotsBox.input.classList.toggle("invalid", Boolean(parsed.errors));
  if (parsed.errors) ballotsBox.input.setAttribute("aria-invalid", "true"); else ballotsBox.input.removeAttribute("aria-invalid");
  if (parsed.errors) {
    const shown = parsed.errors.slice(0, 5);
    msgBox.replaceChildren(note("bad", el("strong", { text: parsed.errors.length === 1 ? "One thing to fix. " : `${parsed.errors.length > 20 ? "More than 20" : parsed.errors.length} things to fix${parsed.errors.length > 5 ? "; the first five" : ""}. ` }),
      el("ul", {}, shown.map((t) => el("li", { text: t }))),
      state.result ? el("p", { class: "small", text: "The results show the last ballots that could be read." }) : null));
    status.textContent = "The ballots need fixing; see the messages under the box.";
    return;
  }
  const fromFile = state.fileNote ? state.fileWarnings.filter((w) => !parsed.warnings.includes(w)) : [];
  msgBox.replaceChildren(...[...fromFile, ...parsed.warnings].map((w) => note("warn", w)));
}

const nameOf = (r, c) => r.candidates[c];
const pctOf = (k, of) => (of ? fmt.pct(k / of, 1) : "–");
const listNames = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function tieText(r, rd, rules) {
  const t = rd.tie;
  if (!t) return "";
  const names = listNames(t.tied.map((c) => nameOf(r, c)));
  const level = fmt.int(rd.tally[t.out]);
  if (t.by === "rounds") return `${names} tied on ${level}. ${rules.tie === "backward" ? "Looking back from the latest earlier round" : "Looking forward from round 1"}, round ${t.round} decides it: ${nameOf(r, t.out)} had fewer then.`;
  const before = rules.tie === "lot" ? "" : rd.round === 1 ? ", with no earlier round to separate them" : t.drawnFrom.length < t.tied.length ? `; earlier rounds narrowed it to ${listNames(t.drawnFrom.map((c) => nameOf(r, c)))}, who were level in every one` : " and were level in every earlier round";
  return `${names} tied on ${level}${before}; a draw by lot (seed ${rules.seed}) picked ${nameOf(r, t.out)}.`;
}

function draw(r, rules) {
  const last = r.rounds.at(-1);
  const s = r.summary;
  const winnerName = r.winner !== null && r.winner >= 0 ? nameOf(r, r.winner) : "–";
  sWinner.set(winnerName, r.decidedByTie ? "by the tie rule: the last two were level" : r.majorityRound ? `more than half of the ballots still counting, from round ${r.majorityRound}` : "");
  const elims = r.rounds.filter((rd) => rd.eliminated !== null).length;
  sRounds.set(fmt.int(r.rounds.length), elims ? `${fmt.int(elims)} ${elims === 1 ? "elimination" : "eliminations"}` : r.decidedByTie ? "the two candidates tied on first choices" : r.candidates.length === 1 ? "one candidate" : "a majority on first choices");
  sCounted.set(fmt.int(s.counted), s.noFirst ? `${fmt.int(s.noFirst)} set aside with nothing to count for at their first ranking` : `of ${fmt.int(s.ballots)} ballots`);
  sExhausted.set(fmt.int(last.exhausted), `${pctOf(last.exhausted, s.counted)} of the ballots counted ran out of candidates`);
  status.textContent = `Winner: ${winnerName}, after ${plural(r.rounds.length, "round")}. ${fmt.int(last.exhausted)} ballots exhausted.`;

  // The official count, for the real examples while the ballots are unchanged.
  const ex = EXAMPLES.find((e) => e.id === state.preset);
  if (ex?.contest && ballotsBox.value === realText.get(ex.id)) {
    const c = ex.contest;
    const pub = remapPublished(c.published, contestBallots(c).candidates, r.candidates);
    const diffs = pub ? compareWithPublished(r, pub) : ["the candidates do not match"];
    official.replaceChildren(diffs.length
      ? note("warn", `With these rules the count differs from the NSW Electoral Commission's published distribution of preferences: ${diffs.slice(0, 3).join("; ")}${diffs.length > 3 ? `; and ${diffs.length - 3} more` : ""}.${rules.untilTwo ? "" : " The Commission counts on until two candidates remain: tick that rule to compare."}`)
      : note("good", `This count matches the NSW Electoral Commission's published distribution of preferences for ${c.name} at every one of its ${c.published.inCount.length} counts: each candidate's total, the exhausted ballots, the ballots in the count and the absolute majority.`));
  } else official.replaceChildren();

  // What the rules did to irregular ballots.
  const lines = [];
  if (s.overvote) lines.push(`${fmt.int(s.overvote)} ${s.overvote === 1 ? "ballot has" : "ballots have"} an overvote (${RULES.overvote.find((x) => x.value === rules.overvote).short}).`);
  if (s.skipped) lines.push(`${fmt.int(s.skipped)} ${s.skipped === 1 ? "ballot skips" : "ballots skip"} a ranking (${RULES.skips.find((x) => x.value === rules.skips).short}).`);
  if (s.duplicate) lines.push(`${fmt.int(s.duplicate)} ${s.duplicate === 1 ? "ballot ranks" : "ballots rank"} a candidate twice; the second mark is passed over.`);
  if (s.noFirst) lines.push(`${fmt.int(s.noFirst)} ${s.noFirst === 1 ? "ballot has" : "ballots have"} nothing to count for at the first usable ranking and ${s.noFirst === 1 ? "is" : "are"} set aside.`);
  const ex2 = last.exhaustedBy;
  const why = [ex2.list && `${fmt.int(ex2.list)} ranked no candidate still in`, ex2.overvote && `${fmt.int(ex2.overvote)} reached an overvote`, ex2.skips && `${fmt.int(ex2.skips)} reached skipped rankings`].filter(Boolean);
  if (last.exhausted) lines.push(why.length === 1 && ex2.list ? `By the last round ${fmt.int(last.exhausted)} ballots are exhausted: none of them ranks a candidate still in the count.` : `By the last round ${fmt.int(last.exhausted)} ballots are exhausted: ${listNames(why)}.`);
  summaryBox.replaceChildren(...lines.map((t) => el("p", { class: "small", text: t })));

  drawRounds(r);
  drawChart(r);
  drawTransfers(r, rules);
}
const plural = (k, w) => `${fmt.int(k)} ${w}${k === 1 ? "" : "s"}`;

function drawRounds(r) {
  const K = r.rounds.length;
  // Candidates in the order they finished: the winner, the runner-up, then the last out first.
  const outAt = r.candidates.map((_, c) => { const k = r.rounds.findIndex((rd) => rd.eliminated === c); return k < 0 ? K : k; });
  const order = r.candidates.map((_, c) => c).sort((a, b) => (a === r.winner ? -1 : b === r.winner ? 1 : 0) || outAt[b] - outAt[a] || (r.rounds[0].tally[b] ?? 0) - (r.rounds[0].tally[a] ?? 0));
  const head = el("tr", {}, el("th", { scope: "col", text: "Candidate" }), r.rounds.map((rd) => el("th", { scope: "col", class: "num", text: `Round ${rd.round}` })));
  const cellFor = (c, k) => {
    const rd = r.rounds[k];
    const v = rd.tally[c];
    if (v === null) return el("td", { class: "num d90-gone", "data-label": `Round ${rd.round}`, text: "" });
    const prev = k ? r.rounds[k - 1].tally[c] : null;
    const change = prev !== null && k ? v - prev : null;
    const tag = rd.eliminated === c ? "out" : k === K - 1 && c === r.winner ? "elected" : "";
    return el("td", { class: `num${tag ? ` d90-${tag}` : ""}`, "data-label": `Round ${rd.round}` },
      fmt.int(v), change ? el("span", { class: "d90-chg", text: ` (${fmt.signed(change, 0)})` }) : null, tag ? el("span", { class: "d90-tag", text: ` ${tag}` }) : null);
  };
  const extra = [
    ["Exhausted", (rd, k) => `${fmt.int(rd.exhausted)}${k && rd.exhausted - r.rounds[k - 1].exhausted ? ` (${fmt.signed(rd.exhausted - r.rounds[k - 1].exhausted, 0)})` : ""}`],
    ["Ballots still counting", (rd) => fmt.int(rd.continuing)],
    ["Majority: more than half, at least", (rd) => (rd.continuing ? fmt.int(rd.majority) : "–")],
  ];
  const table = el("table", { class: "tbl d90-rt" },
    el("caption", { text: "Ballots for each candidate, round by round, with the change from the round before in brackets." }),
    el("thead", {}, head),
    el("tbody", {},
      order.map((c) => el("tr", {}, el("th", { scope: "row", text: nameOf(r, c) }), r.rounds.map((_, k) => cellFor(c, k)))),
      extra.map(([label, f]) => el("tr", { class: "d90-sum" }, el("th", { scope: "row", text: label }), r.rounds.map((rd, k) => el("td", { class: "num", "data-label": `Round ${rd.round}`, text: f(rd, k) }))))));
  roundBox.replaceChildren(table);
  fitRounds();
}
// The table turns into a list whenever it is wider than its box, however wide the screen.
function fitRounds() {
  const t = roundBox.querySelector("table");
  if (!t) return;
  t.classList.remove("d90-stacked");
  if (t.scrollWidth > roundBox.clientWidth + 1) t.classList.add("d90-stacked");
}
if (typeof ResizeObserver !== "undefined") new ResizeObserver(nextFrame(fitRounds)).observe(roundBox);

function drawChart(r) {
  const K = r.rounds.length;
  const reach = r.candidates.map((_, c) => r.rounds.filter((rd) => rd.tally[c] !== null).length * 1e12 + (r.rounds[0].tally[c] ?? 0));
  const ranked = r.candidates.map((_, c) => c).sort((a, b) => reach[b] - reach[a]);
  const top = new Set(ranked.slice(0, 8));
  const series = ranked.map((c, i) => ({
    name: top.has(c) ? nameOf(r, c) : undefined, type: "line", color: top.has(c) ? i : "#8a94a3", legend: top.has(c) ? undefined : false,
    data: r.rounds.filter((rd) => rd.tally[c] !== null).map((rd) => [rd.round, rd.tally[c]]),
  }));
  plot.update({
    title: "Ballots for each candidate, round by round",
    subtitle: `${r.candidates.length > 8 ? "The eight candidates who lasted longest are coloured; the rest are grey. " : ""}A line ends in the round its candidate is eliminated.${K === 1 ? (r.decidedByTie ? " One round: the two candidates tied on first choices." : r.candidates.length === 1 ? " One candidate." : " One round: someone has a majority on first choices.") : ""}`,
    label: "Line chart of each candidate's ballots in each round of the count",
    x: { label: "Round", domain: K === 1 ? [0.5, 1.5] : [1, K], format: (v) => (Number.isInteger(v) ? fmt.int(v) : ""), ticks: Math.min(K, 10) },
    y: { label: "Ballots", format: (v) => fmt.compact(v), zero: true },
    series,
    marks: r.rounds.length && r.rounds.at(-1).continuing ? [{ type: "hline", y: r.rounds.at(-1).majority, text: "Majority in the last round" }] : [],
  });
}

function drawTransfers(r, rules) {
  const items = [];
  for (const rd of r.rounds) {
    if (rd.eliminated === null && !rd.tie) continue;
    if (rd.eliminated === null && rd.tie) { items.push(el("li", { text: `Round ${rd.round}: ${tieText(r, rd, rules)} ${nameOf(r, r.winner)} wins.` })); continue; }
    const t = rd.transfers;
    const to = t.to.map((v, c) => [v, c]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]).map(([v, c]) => `${fmt.int(v)} to ${nameOf(r, c)}`);
    const ex = t.exhausted.list + t.exhausted.overvote + t.exhausted.skips;
    const exWhy = [t.exhausted.list && `${fmt.int(t.exhausted.list)} with no candidate left`, t.exhausted.overvote && `${fmt.int(t.exhausted.overvote)} at an overvote`, t.exhausted.skips && `${fmt.int(t.exhausted.skips)} at skipped rankings`].filter(Boolean);
    items.push(el("li", {},
      el("strong", { text: `Round ${rd.round}: ${nameOf(r, rd.eliminated)} is out` }),
      ` with ${plural(t.total, "ballot")}. ${rd.tie ? `${tieText(r, rd, rules)} ` : ""}${t.total ? `They go ${to.length ? listNames(to) : "nowhere"}${ex ? `${to.length ? ", and " : ": "}${fmt.int(ex)} (${pctOf(ex, t.total)}) are exhausted${exWhy.length > 1 ? `: ${listNames(exWhy)}` : ""}` : ""}.` : ""}`));
  }
  transferBox.replaceChildren(items.length
    ? el("details", { class: "d90-transfers", open: r.rounds.length <= 8 }, el("summary", { text: "Where each eliminated candidate's ballots went" }), el("ol", {}, items))
    : el("p", { class: "small", text: "No one was eliminated: a candidate had a majority of first choices." }));
}

loadExample(EXAMPLES[0]);
