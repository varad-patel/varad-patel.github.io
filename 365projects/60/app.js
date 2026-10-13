// Day 60: Stable Matching Marketplace. Interface.
import { $, el, fmt, mount, textArea, segmented, select, button, note, table, debounce, rng } from "../kit/kit.js";
import {
  LIMITS, EXAMPLES, parse, deferredAcceptance, hiresOf, checkMatching, explainPairs, summarise,
  manipulationSearch, everyStableMatching,
} from "./logic.js";

mount();

/* ---------- words ---------- */
const and = (names) => (names.length <= 1 ? names.join("") : names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const nth = (k) => { const n = k + 1, t = n % 100; return `${n}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`; };
const count = (n, one, many = `${one}s`) => `${fmt.int(n)} ${n === 1 ? one : many}`;
const SIDE = { candidates: { one: "candidate", many: "candidates", other: "employers" }, employers: { one: "employer", many: "employers", other: "candidates" } };

/* ---------- controls ---------- */
const state = { proposers: "candidates" };
const about = el("p", { class: "small muted" });
const candidateBox = textArea({
  label: "Candidates", rows: 7, mono: true, value: "",
  hint: `One line each: a name, a colon, then employers from most to least wanted, with commas or semicolons between them. An employer left off the list is one the candidate would not work for. Up to ${LIMITS.agents} candidates and ${LIMITS.agents} employers; a name takes up to ${LIMITS.name} characters.`,
  onInput: debounce(() => { about.textContent = "Your own lists."; update(); }, 200),
});
const employerBox = textArea({
  label: "Employers", rows: 5, mono: true, value: "",
  hint: "The same, with candidates in order. For more than one position put the number in brackets after the name: Acme (2): Asha, Ben",
  onInput: debounce(() => { about.textContent = "Your own lists."; update(); }, 200),
});
for (const box of [candidateBox, employerBox]) box.input.maxLength = LIMITS.text;
const proposerSeg = segmented({
  label: "Who proposes", value: "candidates", options: [{ value: "candidates", label: "Candidates" }, { value: "employers", label: "Employers" }],
  hint: "The side that proposes works down its lists; the other side holds the best offer so far and rejects the rest.",
  onChange: (v) => { state.proposers = v; update(); },
});
function load(ex) {
  candidateBox.value = ex.candidates;
  employerBox.value = ex.employers;
  about.textContent = ex.about;
}
const exampleRow = el("div", { class: "row", role: "group", "aria-label": "Examples" }, el("span", { class: "small muted", text: "Examples:" }),
  EXAMPLES.map((ex) => button(ex.label, () => { load(ex); update(); }, { small: true })));
const controls = el("div", { class: "controls" }, candidateBox.el, employerBox.el, proposerSeg.el);

/* ---------- outputs ---------- */
const problems = el("div");
const status = el("p", { class: "sr-only", role: "status" });
const section = (id, title) => { const body = el("div", { class: "stack" }); return { el: el("section", { class: "panel stack", id, "aria-labelledby": `${id}-h` }, el("h2", { id: `${id}-h`, text: title }), body), body }; };
const sMatch = section("matching", "The stable matching");
const sRounds = section("rounds", "How it got there, round by round");
const sWhy = section("why", "Why it is stable");
const sSides = section("sides", "Who proposes matters");
const sOwn = section("own", "Try a matching of your own");
const sLies = section("lies", "Does it pay to lie?");
const sections = el("div", { class: "stack" }, sMatch.el, sRounds.el, sWhy.el, sSides.el, sOwn.el, sLies.el);
const jump = el("p", { class: "small jump" }, "Jump to: ",
  [["matching", "the matching"], ["rounds", "the rounds"], ["why", "why it is stable"], ["sides", "who proposes"], ["own", "your own matching"], ["lies", "lying"]]
    .flatMap(([id, text], i) => [i ? ", " : "", el("a", { href: `#${id}`, text })]), ".");
const fullNote = el("div");
$("#app").append(exampleRow, about, jump, el("div", { class: "tool-grid wide-controls" }, controls, el("div", { class: "out" }, fullNote, problems, status, sections)));

/* ---------- the market ---------- */
let market = null, job = 0;
const C = (i) => market.candidates[i].name;
const E = (j) => market.employers[j].name;
const placeOf = (j) => (market.employers[j].capacity === 1 ? "1 position" : `${market.employers[j].capacity} positions`);

function update() {
  job++;
  // A box stops taking text at its limit without a word from the browser, so the page says it.
  const full = [[candidateBox, "candidates"], [employerBox, "employers"]].filter(([b]) => b.input.value.length >= LIMITS.text).map(([, name]) => name);
  fullNote.replaceChildren(...(full.length ? [note("warn", `The ${full.join(" box and the ")} box ${full.length === 1 ? "is" : "are"} full. A box takes ${fmt.int(LIMITS.text)} characters, and anything typed or pasted beyond that was cut off: check the last line.`)] : []));
  const parsed = parse(candidateBox.value, employerBox.value);
  if (parsed.errors.length) {
    market = null;
    const shown = parsed.errors.slice(0, 12);
    problems.replaceChildren(note("bad", el("strong", { text: parsed.errors.length === 1 ? "One thing to fix in the lists:" : `${fmt.int(parsed.errors.length)} things to fix in the lists:` }),
      el("ul", { class: "fixes" }, shown.map((t) => el("li", { text: t })), parsed.errors.length > shown.length ? el("li", { text: `and ${count(parsed.errors.length - shown.length, "more")}.` }) : null)));
    sections.hidden = true;
    status.textContent = "";
    return;
  }
  market = parsed.market;
  sections.hidden = false;
  problems.replaceChildren(...(parsed.notes.length ? [note("", el("strong", { text: `${count(parsed.notes.length, "one-sided listing")}, which can never lead to a match: ` }),
    `${parsed.notes.slice(0, 8).join("; ")}${parsed.notes.length > 8 ? `; and ${count(parsed.notes.length - 8, "more")}` : ""}.`)] : []));

  const runs = { candidates: deferredAcceptance(market, "candidates"), employers: deferredAcceptance(market, "employers") };
  const run = runs[state.proposers];
  drawMatching(run);
  drawRounds(run);
  drawWhy(run);
  drawSides(runs);
  drawOwn(runs);
  drawLies(job);
}

/* ---------- the matching ---------- */
function drawMatching(run) {
  const { candidates, employers } = market;
  const s = summarise(market, run.matching);
  const rows = candidates.map((c, i) => {
    const e = run.matching[i];
    return { who: c.name, to: e === null ? "no one" : E(e), ranks: e === null ? "" : `${c.name}'s ${nth(c.prefs.indexOf(e))} choice of ${c.prefs.length}; ${E(e)}'s ${nth(employers[e].prefs.indexOf(i))} of ${employers[e].prefs.length}` };
  });
  // Why each unmatched candidate and each empty position is left over.
  const leftovers = [];
  candidates.forEach((c, i) => {
    if (run.matching[i] !== null) return;
    const unlisted = c.prefs.filter((e) => !employers[e].prefs.includes(i)), full = c.prefs.filter((e) => employers[e].prefs.includes(i));
    const parts = [];
    if (unlisted.length) parts.push(`${and(unlisted.map(E))} ${unlisted.length === 1 ? "does" : "do"} not list ${c.name}`);
    if (full.length) parts.push(`${and(full.map(E))} ${full.length === 1 ? "is" : "are"} full with candidates ranked above ${c.name}`);
    leftovers.push(`${c.name} is unmatched: ${parts.join(", and ")}.`);
  });
  employers.forEach((e, j) => {
    const empty = e.capacity - run.hires[j].length;
    if (!empty) return;
    const others = e.prefs.filter((c) => run.matching[c] !== j);
    const back = others.filter((c) => candidates[c].prefs.includes(j));
    leftovers.push(`${e.name} has ${count(empty, "position")} unfilled: ${!others.length ? "it lists nobody else" : !back.length ? "nobody else it lists has listed it" : `everyone else it lists either does not list ${e.name} or prefers the employer they have`}.`);
  });
  sMatch.body.replaceChildren(...[
    el("p", { text: `With ${state.proposers} proposing, deferred acceptance stops after ${count(run.rounds.length, "round")} and matches ${fmt.int(s.matched)} of ${count(candidates.length, "candidate")} to ${fmt.int(s.filled)} of ${count(s.positions, "position")}.` }),
    table({ caption: `The matching when ${state.proposers} propose`, columns: [{ key: "who", label: "Candidate" }, { key: "to", label: "Matched to" }, { key: "ranks", label: "How each ranks the other" }], rows }),
    table({ caption: "The same matching, by employer", columns: [{ key: "who", label: "Employer" }, { key: "has", label: "Takes" }],
      rows: employers.map((e, j) => ({ who: `${e.name} (${placeOf(j)})`, has: run.hires[j].length ? and(run.hires[j].map(C)) : "no one" })) }),
    leftovers.length ? el("ul", { class: "plain" }, leftovers.map((t) => el("li", { text: t }))) : null].filter(Boolean));
  status.textContent = `With ${state.proposers} proposing: ${candidates.map((c, i) => `${c.name} ${run.matching[i] === null ? "is unmatched" : `to ${E(run.matching[i])}`}`).join(", ")}.`;
}

/**
 * A box that scrolls must be reachable with the keyboard, or its lower part cannot be read without a mouse.
 * It becomes a tab stop only when its contents really overflow.
 */
function scrollable(box, label) {
  if (!box) return;
  requestAnimationFrame(() => {
    const over = box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1;
    if (over) { box.tabIndex = 0; box.setAttribute("role", "group"); box.setAttribute("aria-label", label); }
    else { box.removeAttribute("tabindex"); box.removeAttribute("role"); box.removeAttribute("aria-label"); }
  });
}

/* ---------- the rounds ---------- */
function drawRounds(run) {
  const byCandidates = state.proposers === "candidates";
  const sentence = (x) => {
    const c = C(x.candidate), e = E(x.employer);
    if (byCandidates) {
      if (x.reason === "unlisted") return `${e} rejects ${c}: ${c} is not on ${e}'s list.`;
      const room = `${e} has ${placeOf(x.employer)} and ranks ${and(x.kept.map(C))} above ${c}`;
      return x.reason === "released" ? `${e} lets ${c} go, having held ${c} until now: ${room}.` : `${e} rejects ${c}: ${room}.`;
    }
    if (x.reason === "unlisted") return `${c} turns ${e} down: ${e} is not on ${c}'s list.`;
    return x.reason === "released" ? `${c} leaves ${e}, held until now, for ${E(x.kept[0])}, which is higher on ${c}'s list.` : `${c} turns ${e} down: ${c} prefers ${E(x.kept[0])}.`;
  };
  const items = run.rounds.map((round, k) => {
    const hires = hiresOf(market, round.matching);
    const held = market.employers.map((e, j) => `${e.name}: ${hires[j].length ? and(hires[j].map(C)) : "no one"}`).join("; ");
    return el("li", {},
      el("strong", { text: `Round ${k + 1}. ` }),
      `${count(round.proposals.length, "proposal")}: ${round.proposals.map((p) => (byCandidates ? `${C(p.candidate)} to ${E(p.employer)}` : `${E(p.employer)} to ${C(p.candidate)}`)).join("; ")}.`,
      round.rejections.length ? el("ul", {}, round.rejections.map((x) => el("li", { text: sentence(x) }))) : el("ul", {}, el("li", { text: "Nobody is rejected." })),
      el("div", { class: "held", text: `Held after round ${k + 1}: ${held}.` }));
  });
  sRounds.body.replaceChildren(
    el("p", { class: "small", text: byCandidates
      ? "In each round every candidate without an offer in hand proposes to the next employer on their list. Each employer keeps the best it has seen, up to its number of positions, and rejects the rest. A candidate who is held can still be let go later for someone better."
      : "In each round every employer with a position still open proposes to the next candidates on its list, one for each open position. Each candidate keeps the best offer so far and turns the rest down. An employer that is held can still be dropped later for a better one." }),
    run.rounds.length ? el("div", { class: "rounds-wrap" }, el("ol", { class: "rounds" }, items)) : el("p", { text: "Nobody has anyone to propose to, so there are no rounds." }),
    el("p", { class: "small", text: `No one has a proposal left to make after round ${run.rounds.length}, so what is held becomes final.` }));
  scrollable(sRounds.body.querySelector(".rounds-wrap"), "The rounds, a list that scrolls");
}

/* ---------- why it is stable ---------- */
function verdictText(p) {
  const c = C(p.candidate), e = E(p.employer);
  if (p.verdict === "matched") return "Matched to each other.";
  const happyC = p.current === null || p.current === undefined ? "" : `${c} prefers ${E(p.current)}, which ${c} has`;
  const happyE = `${e} is full and ranks everyone it has above ${c}`;
  if (p.verdict === "bothContent") return `${happyC}, and ${happyE}.`;
  if (p.verdict === "candidateContent") return `${happyC}.`;
  if (p.verdict === "employerContent") return `${happyE}.`;
  return "This pair blocks the matching.";
}
function drawWhy(run) {
  const pairs = explainPairs(market, run.matching);
  const check = checkMatching(market, run.matching);
  const matched = pairs.filter((p) => p.verdict === "matched").length;
  const n = pairs.length, rest = n - matched;
  sWhy.body.replaceChildren(...[
    el("p", { text: n === 0 ? "No candidate and employer list each other, so nobody can be matched and there is nothing to check."
      : `A matching is unstable if some candidate and employer who are not matched together would both rather be. ${
        rest === 0 ? `${n === 1 ? "The one pair who list each other is" : `All ${fmt.int(n)} pairs who list each other are`} matched, so no pair is left that could block.`
          : `All ${fmt.int(n)} pairs who list each other were checked: ${fmt.int(matched)} ${matched === 1 ? "is" : "are"} matched, and ${rest === 1 ? "the other one does not block" : `of the other ${fmt.int(rest)} none blocks`}. ${rest === 1 ? "In it" : "In each of them"} the candidate prefers the employer it already has, or the employer is full and prefers everyone it has, or both.`}` }),
    check.stable ? note("good", "No blocking pair, nobody matched to someone they did not list, and no employer over its number of positions: the matching is stable.")
      : note("bad", "This should not happen: the matching failed the stability check."),
    n ? el("details", { class: "pairs", ontoggle: (e) => scrollable(e.currentTarget.querySelector(".tbl-wrap"), "The reasons, a table that scrolls") },
      el("summary", { text: n === 1 ? "Show the reason for the one pair" : `Show the reason for each of the ${fmt.int(n)} pairs` }),
      table({ caption: n === 1 ? "The one pair who list each other" : "Every pair who list each other, and why it does not block", columns: [{ key: "pair", label: "Pair" }, { key: "why", label: n === 1 ? "Where it stands" : "Why it does not block" }], rows: pairs.map((p) => ({ pair: `${C(p.candidate)} and ${E(p.employer)}`, why: verdictText(p) })) })) : null].filter(Boolean));
}

/* ---------- the two sides ---------- */
const COUNT_LIMIT = 5000; // assignments tried when counting stable matchings: a few hundredths of a second at most
function drawSides(runs) {
  const a = runs.candidates.matching, b = runs.employers.matching;
  const same = a.every((e, i) => e === b[i]);
  const sa = summarise(market, a), sb = summarise(market, b);
  const nc = market.candidates.length, ne = market.employers.length;
  const name = (e) => (e === null ? "no one" : E(e));
  const countBox = el("p", { class: "small muted", text: "", hidden: same }); // filled in below, only when the two versions differ
  sSides.body.replaceChildren(
    table({ caption: "The matching under each version",
      columns: [{ key: "who", label: "Candidate" }, { key: "a", label: "Candidates propose" }, { key: "b", label: "Employers propose" }],
      rows: market.candidates.map((c, i) => ({ who: c.name, a: name(a[i]), b: a[i] === b[i] ? "the same" : `${name(b[i])} (differs)` })) }),
    table({ caption: "How many get the first name on their list",
      columns: [{ key: "what", label: "Count" }, { key: "a", label: "Candidates propose" }, { key: "b", label: "Employers propose" }],
      rows: [
        { what: "Candidates matched to their first choice", a: `${sa.candidatesFirst} of ${nc}`, b: `${sb.candidatesFirst} of ${nc}` },
        { what: "Employers that hire the first candidate they list", a: `${sa.employersFirst} of ${ne}`, b: `${sb.employersFirst} of ${ne}` },
        { what: "Candidates matched at all", a: `${sa.matched} of ${nc}`, b: `${sb.matched} of ${nc}` },
      ] }),
    el("p", { text: same
      ? "Both versions give the same matching. Since one is the best stable matching for every candidate and the other the best for every employer, there is no other: this market has exactly one stable matching."
      : "The two versions differ. Every candidate does at least as well when candidates propose as in any other stable matching, and every employer at least as well when employers propose. The same candidates are matched either way; who they are matched to is what the choice of proposer decides." }),
    countBox);
  if (!same) {
    const mine = job;
    setTimeout(() => {
      if (mine !== job) return;
      const all = everyStableMatching(market, COUNT_LIMIT);
      countBox.textContent = all ? `Trying every possible matching finds ${count(all.length, "stable matching", "stable matchings")} in this market.`
        : `This market is too large to count its stable matchings by trying every possible matching: the page does that only when there are ${fmt.int(COUNT_LIMIT)} or fewer ways to hand each candidate one of its listed employers or none.`;
    }, 0);
  }
}

/* ---------- a matching of the visitor's own ---------- */
let shuffles = 0;
function drawOwn(runs) {
  const verdict = el("div", { role: "status" });
  const picks = market.candidates.map((c, i) => select({
    label: `${c.name} goes to`, value: runs[state.proposers].matching[i] ?? "",
    options: [{ value: "", label: "no one" }, ...market.employers.map((e, j) => ({ value: j, label: e.name }))],
    onChange: () => judge(),
  }));
  const read = () => picks.map((p) => (p.value === "" ? null : Number(p.value)));
  const set = (matching) => { picks.forEach((p, i) => { p.value = matching[i] ?? ""; }); judge(); };
  function judge() {
    const m = read(), r = checkMatching(market, m);
    const lines = [];
    for (const f of r.faults) {
      if (f.kind === "overCapacity") lines.push(`${E(f.employer)} has ${placeOf(f.employer)} and ${count(f.count, "person", "people")} here.`);
      else if (f.kind === "candidateUnlisted") lines.push(`${C(f.candidate)} did not list ${E(f.employer)}, so ${C(f.candidate)} would rather have no job than this one.`);
      else lines.push(`${E(f.employer)} did not list ${C(f.candidate)}, so ${E(f.employer)} would rather leave the position empty.`);
    }
    for (const b of r.blocking) {
      const c = C(b.candidate), e = E(b.employer);
      const wants = b.current === null ? `${c} has no one and lists ${e}` : market.candidates[b.candidate].prefs.includes(b.current) ? `${c} prefers ${e} to ${E(b.current)}` : `${c} lists ${e} and did not list ${E(b.current)}`;
      lines.push(`${c} and ${e} block it: ${wants}, and ${b.room ? `${e} has a position free` : `${e} ranks ${c} above ${C(b.displaced)}, whom it has`}.`);
    }
    const which = String(m) === String(runs.candidates.matching) ? (String(m) === String(runs.employers.matching) ? "It is the one stable matching this market has." : "It is the one deferred acceptance finds when candidates propose.")
      : String(m) === String(runs.employers.matching) ? "It is the one deferred acceptance finds when employers propose." : "It is a stable matching that neither version of deferred acceptance finds: it lies between the two.";
    verdict.replaceChildren(r.stable
      ? note("good", el("strong", { text: "Stable. " }), `${r.pairs === 0 ? "No candidate and employer list each other, so nothing can block this matching."
        : r.pairs === 1 ? "The one pair who list each other was checked and does not block this matching." : `All ${fmt.int(r.pairs)} pairs who list each other were checked and none blocks this matching.`} ${which}`)
      : note("warn", el("strong", { text: `Not stable: ${[r.faults.length ? count(r.faults.length, "fault") : "", r.blocking.length ? count(r.blocking.length, "blocking pair") : ""].filter(Boolean).join(" and ")}.` }),
        el("ul", { class: "fixes" }, lines.slice(0, 30).map((t) => el("li", { text: t })), lines.length > 30 ? el("li", { text: `and ${count(lines.length - 30, "more")}.` }) : null)));
  }
  const buttons = el("div", { class: "row" },
    button("Candidates' best", () => set(runs.candidates.matching), { small: true }),
    button("Employers' best", () => set(runs.employers.matching), { small: true }),
    button("Shuffle who goes where", () => {
      // The employers of the matched candidates are dealt out again in a new order, from a numbered seed.
      // A deal that changes nothing would look like a dead button, so a few seeds are tried until one moves somebody.
      const base = runs.candidates.matching, at = base.map((e, i) => (e === null ? -1 : i)).filter((i) => i >= 0);
      let next = [...base];
      for (let tries = 0; tries < 20; tries++) {
        const dealt = rng(600 + ++shuffles).shuffle(at.map((i) => base[i]));
        next = [...base];
        at.forEach((i, k) => { next[i] = dealt[k]; });
        if (String(next) !== String(read()) && String(next) !== String(base)) break;
      }
      set(next);
    }, { small: true }),
    button("Match no one", () => set(market.candidates.map(() => null)), { small: true }));
  sOwn.body.replaceChildren(
    el("p", { class: "small", text: "Choose an employer for each candidate. Every pair who list each other is checked, and any pair that would both rather have each other is named with its reason." }),
    buttons, el("div", { class: "picks" }, picks.map((p) => p.el)), verdict);
  judge();
}

/* ---------- lying ---------- */
// The number of lists outgrows ordinary numbers at 19 names, so it is counted in whole-number arithmetic for display.
const exactLists = (n) => { let total = 0n, term = 1n; for (let k = 0; k < n; k++) { term *= BigInt(n - k); total += term; } return total.toLocaleString("en-GB"); };
function drawLies(mine) {
  const prop = state.proposers, recv = SIDE[prop].other;
  const progress = el("p", { class: "small muted" });
  const result = el("div", { class: "stack" });
  const announce = el("p", { class: "sr-only", role: "status" });
  const size = { candidates: market.employers.length, employers: market.candidates.length }; // how many names each side's lists draw on
  const tasks = [];
  for (const side of [prop, recv]) if (size[side] <= LIMITS.misreportSide) market[side].forEach((_, i) => tasks.push({ side, i }));
  const found = { candidates: [], employers: [] }, tried = { candidates: 0, employers: 0 };
  sLies.body.replaceChildren(
    el("p", { class: "small", text: `Each ${SIDE[prop].one} and each ${SIDE[recv].one} in turn sends every false list it could (any names from the other side, in any order) while everyone else tells the truth. A false list pays if it gets that agent a better result by its true list.` }),
    progress, result, announce);

  const describe = (side, i, f) => {
    const who = market[side][i], label = side === "candidates" ? E : C;
    const truth = who.prefs.map(label), lie = f.best.list.map(label);
    const dropped = who.prefs.filter((j) => !f.best.list.includes(j)).map(label);
    const how = f.best.dropped ? `leaving ${and(dropped)} off the list` : `sending the list ${lie.join(", ")}`;
    const got = (x) => (side === "candidates" ? (x === null ? "no one" : E(x)) : x.length ? and(x.map(C)) : "no one");
    return `${who.name} can gain. With the true list (${truth.join(", ")}) ${who.name} gets ${got(f.best.truthful)}. By ${how}, ${who.name} gets ${got(f.best.lying)}. ${fmt.int(f.gains)} of the ${fmt.int(f.tried)} false lists ${who.name} could send ${f.gains === 1 ? "pays" : "pay"}.`;
  };
  let k = 0, search = null;
  const step = () => {
    if (mine !== job) return; // the lists changed: this run is abandoned
    const t0 = performance.now();
    // A hundred lists at a time, so that even one agent's 1,955 lists cannot hold the page for long.
    while (k < tasks.length && performance.now() - t0 < 25) {
      const { side, i } = tasks[k];
      search ??= manipulationSearch(market, prop, side, i);
      if (!search.advance(100)) continue;
      const f = search.result;
      tried[side] += f.tried;
      if (f.best) found[side].push(describe(side, i, f));
      search = null;
      k++;
    }
    if (k < tasks.length) { progress.textContent = `Trying false lists: ${k} of ${tasks.length} agents done.`; setTimeout(step, 0); return; }
    progress.textContent = "";
    const out = [], spoken = [];
    for (const side of [prop, recv]) {
      const role = side === prop ? "proposing" : "receiving";
      const head = `${side === "candidates" ? "Candidates" : "Employers"} (the ${role} side). `;
      if (size[side] > LIMITS.misreportSide) {
        out.push(note("", el("strong", { text: head }), `Not checked: with ${count(size[side], SIDE[side].other.slice(0, -1))} to choose from there are ${exactLists(size[side])} lists for each ${SIDE[side].one}. The check runs when the other side has ${LIMITS.misreportSide} or fewer.`));
        spoken.push(`${head}Not checked: too many lists.`);
        continue;
      }
      const lists = `${fmt.int(tried[side])} false ${tried[side] === 1 ? "list" : "lists"} from ${count(market[side].length, SIDE[side].one)}`;
      if (!found[side].length) {
        const none = tried[side] === 0 ? `There is only one name to list, so no ${SIDE[side].one} has a false list to send.` : `None of the ${lists} pays.`;
        const why = side === prop
          ? (side === "candidates" || market.employers.every((e) => e.capacity === 1) ? (side === "candidates" ? " That is the general rule when candidates propose: no false list can get a candidate a better employer, however many positions the employers have." : " That is the general rule when employers propose and each has one position: none of them can gain by a false list.") : " It did not pay here, though an employer with several positions can sometimes gain even when employers propose.")
          : " The receiving side can sometimes gain, but not in this market.";
        out.push(note("good", el("strong", { text: head }), tried[side] === 0 ? none : none + why));
        spoken.push(head + none);
      } else {
        const why = side === prop ? " This is possible only because an employer here has more than one position: with one position each, the proposing side can never gain." : "";
        out.push(note("warn", el("strong", { text: head }), `${count(found[side].length, SIDE[side].one)} of ${market[side].length} can gain by lying (${lists} tried).${why}`, el("ul", { class: "fixes" }, found[side].map((t) => el("li", { text: t })))));
        spoken.push(`${head}${count(found[side].length, SIDE[side].one)} can gain by lying.`);
      }
    }
    result.replaceChildren(...out);
    announce.textContent = `Lying check finished. ${spoken.join(" ")}`;
  };
  if (!tasks.length) { step(); return; }
  progress.textContent = `Trying false lists: 0 of ${tasks.length} agents done.`;
  setTimeout(step, 0);
}

load(EXAMPLES[0]);
update();
