// Day 90: Ranked-Choice Election Engine. The model, with no DOM code.
// Reads ranked ballots from CSV, turns each into the order of candidates the stated rules let it count for, and runs
// an instant-runoff count round by round, recording every transfer and every exhausted ballot.

import { rng } from "../kit/kit.js";

export const LIMITS = { bytes: 20 * 1024 * 1024, rows: 1000000, candidates: 40, ranks: 40, name: 60, count: 1000000000, total: 1000000000, textBox: 2000000 };

/* ------------------------------------------------------------------ reading files */

/**
 * Bytes of a text file to a string: { text, encoding }. UTF-8 unless a UTF-16 byte-order mark, a zero byte beside
 * almost every character (UTF-16 without a mark), or bytes that are not valid UTF-8 say otherwise; those last are read
 * as Windows-1252, the usual encoding of CSV files saved by older spreadsheet programs.
 */
export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const as = (encoding, from = 0) => ({ text: new TextDecoder(encoding).decode(b.subarray(from)), encoding });
  if (b[0] === 0xff && b[1] === 0xfe) return as("utf-16le", 2);
  if (b[0] === 0xfe && b[1] === 0xff) return as("utf-16be", 2);
  const n = Math.min(b.length, 4000) & ~1;
  let even = 0, odd = 0;
  for (let i = 0; i < n; i += 2) { if (b[i] === 0) even++; if (b[i + 1] === 0) odd++; }
  if (n >= 8 && odd > n * 0.3 && even < n * 0.05) return as("utf-16le");
  if (n >= 8 && even > n * 0.3 && odd < n * 0.05) return as("utf-16be");
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(b), encoding: "utf-8" }; } catch { return as("windows-1252"); }
}

/** One line of delimited text to cells. Quotes may wrap a cell; "" inside quotes is a quote. Returns null if a quote never closes. */
export function splitLine(line, delim) {
  const cells = [];
  let cell = "", quoted = false, i = 0;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (ch === delim) { cells.push(cell); cell = ""; }
    else cell += ch;
  }
  if (quoted) return null;
  cells.push(cell);
  return cells;
}

// A spreadsheet runs a cell that starts with =, +, -, @, a tab or a carriage return as a formula. Such text is written
// with an apostrophe in front, which a spreadsheet shows as plain text, and the apostrophe is taken off again on reading.
// Any run of apostrophes before such a character gets one more, so that reading back (which takes one off) is exact.
const RISKY = /^'*[=+\-@\t\r]/;
export const guard = (text) => { const s = String(text); return RISKY.test(s) ? `'${s}` : s; };
export const unguard = (text) => (text[0] === "'" && RISKY.test(text) ? text.slice(1) : text);
const quote = (s) => (/[",\n\r;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s);
export const csvCell = (v) => (typeof v === "number" ? String(v) : quote(guard(v)));

const OVERVOTE_WORDS = new Set(["overvote", "over vote", "over-vote"]);
const BLANK_WORDS = new Set(["", "undervote", "under vote", "skipped", "blank"]);

/**
 * Read ballots from CSV text. The first line names the columns: "count" (optional) holds how many identical ballots
 * a row stands for, "id" (optional) is ignored, and every other column is a ranking, first to last, in the order
 * given. A ranking cell holds one candidate's name; empty means the voter skipped that ranking; two or more names
 * separated by "|", or the word "overvote", mean the voter marked several candidates at that ranking.
 * createBallotReader returns { errors } at once if the text cannot be read at all, or a reader whose step(lines)
 * reads that many more lines (true when finished) and whose finish() gives
 * { candidates, ballots: [{ ranks: [[c, ...], ...], count }], rows, total, warnings } or { errors }.
 */
export function createBallotReader(text) {
  const errors = [];
  const fail = (msg) => ({ errors: [msg] });
  if (typeof text !== "string" || !text.trim()) return fail("There are no ballots yet. Pick an example, upload a CSV file or generate an electorate.");
  if (text.includes("\u0000")) return fail("This looks like a spreadsheet or another binary file, not text. Save it as CSV (comma-separated values) and try again.");
  text = text.replace(/^﻿/, "");
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > LIMITS.rows + 1) return fail(`The file has ${lines.length.toLocaleString("en-GB")} lines; the limit is ${LIMITS.rows.toLocaleString("en-GB")} rows of ballots. Group identical ballots into one row with a "count" column.`);
  let h = 0;
  while (h < lines.length && !lines[h].trim()) h++;
  const headLine = lines[h] ?? "";
  const delim = [",", "\t", ";"].map((d) => [d, headLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(headLine, delim);
  if (!head) return fail("Line 1: a quoted column name never closes. Check the quotation marks in the first line.");
  const names = head.map((x) => x.trim().toLowerCase());
  const countCol = names.findIndex((x) => x === "count" || x === "weight");
  const rankCols = names.map((x, i) => i).filter((i) => i !== countCol && names[i] !== "id" && names[i] !== "ballot id" && names[i] !== "ballotid");
  if (!rankCols.length) return fail(`Line ${h + 1}: the first line must name the columns, with at least one ranking column after the optional "count", for example: count,rank1,rank2,rank3`);
  if (rankCols.length > LIMITS.ranks) return fail(`The file has ${rankCols.length} ranking columns; the limit is ${LIMITS.ranks}.`);
  // A first line that looks like a ballot (no "count" column, no word like rank or choice) is a common slip.
  const looksLikeData = countCol < 0 && head.every((x) => x.trim() && !/rank|choice|pref|first|second|third|fourth|fifth|last|\d/i.test(x));

  const index = new Map(), candidates = [];
  const seen = new Map();
  let rows = 0, total = 0, shortRows = 0, li = h + 1;
  const readLine = (line, where) => {
    const cells = splitLine(line, delim);
    if (!cells) { errors.push(`${where}: a quoted cell never closes. Names cannot contain line breaks; check the quotation marks.`); return; }
    if (cells.length > head.length && cells.slice(head.length).some((c) => c.trim())) {
      errors.push(`${where} has ${cells.length} cells but the first line names ${head.length} columns. Add a column name or remove the extra cells.`);
      return;
    }
    if (cells.length < head.length) shortRows++;
    let count = 1;
    if (countCol >= 0) {
      const raw = (cells[countCol] ?? "").trim().replace(/,/g, "");
      count = /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (!raw) { errors.push(`${where}: the count is empty. Write how many ballots the row stands for, or 1.`); return; }
      if (!Number.isSafeInteger(count) || count > LIMITS.count) { errors.push(`${where}: the count "${(cells[countCol] ?? "").trim().slice(0, 20)}" must be a whole number from 0 to ${LIMITS.count.toLocaleString("en-GB")}.`); return; }
    }
    const ranks = [];
    for (const ci of rankCols) {
      const cell = unguard((cells[ci] ?? "").trim());
      const lower = cell.toLowerCase();
      if (BLANK_WORDS.has(lower)) { ranks.push([]); continue; }
      if (OVERVOTE_WORDS.has(lower)) { ranks.push([-1]); continue; }
      const mark = [];
      for (const name of cell.split("|").map((x) => x.trim()).filter(Boolean)) {
        if (name.length > LIMITS.name) { errors.push(`${where}, column "${head[ci].trim().slice(0, 20)}": a name is ${name.length} characters long; names can be at most ${LIMITS.name}.`); return; }
        if (!index.has(name)) {
          if (candidates.length >= LIMITS.candidates) { errors.push(`${where}: "${name.slice(0, 30)}" would be candidate ${LIMITS.candidates + 1}; the limit is ${LIMITS.candidates}. Check for misspelt names.`); return; }
          index.set(name, candidates.length);
          candidates.push(name);
        }
        mark.push(index.get(name));
      }
      ranks.push(mark);
    }
    while (ranks.length && !ranks.at(-1).length) ranks.pop();
    rows++;
    if (count === 0) return;
    total += count;
    const key = ranks.map((m) => m.join("|")).join(",");
    const prev = seen.get(key);
    if (prev) prev.count += count; else seen.set(key, { ranks, count });
  };
  const step = (max = Infinity) => {
    const stop = Math.min(lines.length, li + max);
    for (; li < stop && errors.length <= 20; li++) if (lines[li].trim()) readLine(lines[li], `Row ${li + 1}`);
    if (errors.length > 20) li = lines.length;
    return li >= lines.length;
  };
  const finish = () => {
    if (errors.length) {
      if (looksLikeData) errors.push(`The first line, "${headLine.slice(0, 60)}", is read as column names. If it is a ballot, add a line above it such as count,rank1,rank2.`);
      return { errors };
    }
    if (total > LIMITS.total) return fail(`The counts add up to ${total.toLocaleString("en-GB")} ballots; the limit is ${LIMITS.total.toLocaleString("en-GB")}.`);
    if (!rows) return fail("There are column names but no ballots under them.");
    if (!total) return fail("Every count is zero, so there are no ballots to count.");
    if (!candidates.length) return fail("No ballot names a candidate. Each ranking cell should hold a candidate's name.");
    const warnings = [];
    if (looksLikeData) warnings.push(`The first line, "${headLine.slice(0, 60)}", is read as column names, not as a ballot. If it is a ballot, add a line above it such as rank1,rank2.`);
    const folded = new Map();
    for (const c of candidates) {
      const k = c.toLowerCase().replace(/\s+/g, " ");
      if (folded.has(k)) warnings.push(`"${folded.get(k)}" and "${c}" differ only in capitals or spacing, so they count as two candidates. If they are one person, make the spelling match.`);
      else folded.set(k, c);
    }
    if (shortRows) warnings.push(`${shortRows.toLocaleString("en-GB")} ${shortRows === 1 ? "row has" : "rows have"} fewer cells than there are columns; the missing rankings are read as blank.`);
    return { candidates, ballots: [...seen.values()], rows, total, warnings, rankColumns: rankCols.length };
  };
  return { step, finish, get progress() { return { done: li, total: lines.length }; } };
}

/** Read the whole text at once (for tests and small inputs). */
export function parseBallots(text) {
  const reader = createBallotReader(text);
  if (reader.errors) return reader;
  while (!reader.step()) { /* read on */ }
  return reader.finish();
}

/** Ballots back to CSV with a count column, names guarded against spreadsheet formulas. */
export function ballotsToCSV(candidates, ballots) {
  const width = Math.max(1, ...ballots.map((b) => b.ranks.length));
  const head = ["count", ...Array.from({ length: width }, (_, i) => `rank${i + 1}`)];
  const lines = [head.join(",")];
  for (const b of ballots) {
    const cells = Array.from({ length: width }, (_, i) => {
      const m = b.ranks[i] || [];
      if (m.length === 1 && m[0] === -1) return "overvote";
      return csvCell(m.map((c) => candidates[c]).join("|"));
    });
    lines.push([b.count, ...cells].join(","));
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ the rules */

export const RULES = {
  overvote: [
    { value: "stop", label: "The ballot stops at an overvote", short: "an overvote stops the ballot" },
    { value: "skip", label: "An overvote is passed over", short: "an overvote is passed over" },
  ],
  skips: [
    { value: "any", label: "Blank rankings are passed over", short: "blank rankings are passed over" },
    { value: "two", label: "Two blanks in a row stop the ballot", short: "two blank rankings in a row stop the ballot" },
    { value: "one", label: "Any blank ranking stops the ballot", short: "a blank ranking stops the ballot" },
  ],
  tie: [
    { value: "backward", label: "Earlier rounds, then by lot", short: "the candidate with fewer votes at the most recent round where the tied candidates differed, then a draw by lot" },
    { value: "forward", label: "First round, then by lot", short: "the candidate with fewer votes at the first round where the tied candidates differed, then a draw by lot" },
    { value: "lot", label: "By lot at once", short: "a draw by lot" },
  ],
};
export const DEFAULT_RULES = { overvote: "stop", skips: "any", tie: "backward", seed: 1, untilTwo: true };

/**
 * The order of candidates a ballot can count for, under the rules: rankings are read first to last; a candidate
 * marked again later is passed over; a blank or an overvote is handled as the rules say. Returns
 * { seq, stop } where stop says why the list ends early ("overvote", "skips") or is null, and flags for the summary.
 */
export function interpret(ranks, rules) {
  const seq = [], seen = new Set();
  let blanks = 0, stop = null, overvote = false, skipped = false, duplicate = false;
  for (const mark of ranks) {
    if (!mark.length) {
      skipped = true; blanks++;
      if (rules.skips === "one" || (rules.skips === "two" && blanks >= 2)) { stop = "skips"; break; }
      continue;
    }
    if (mark.length > 1 || mark[0] === -1) {
      overvote = true;
      if (rules.overvote === "stop") { stop = "overvote"; break; }
      blanks = 0;
      continue;
    }
    blanks = 0;
    const c = mark[0];
    if (seen.has(c)) { duplicate = true; continue; }
    seen.add(c);
    seq.push(c);
  }
  return { seq, stop, overvote, skipped, duplicate };
}

/* ------------------------------------------------------------------ the count */

/**
 * Instant runoff. Each round, every ballot counts for the first candidate on its list still in the count. A candidate
 * with more than half of the ballots still counting wins; otherwise the candidate with the fewest is eliminated (ties
 * settled by rules.tie) and their ballots move on, or are exhausted when their list runs out. With rules.untilTwo the
 * count goes on until two candidates remain, as New South Wales publishes it; the winner is the same either way.
 */
export function runCount(candidates, ballots, rules = DEFAULT_RULES) {
  const n = candidates.length;
  const draw = rng(rules.seed >>> 0 || 1);
  // Group ballots by their effective list.
  const groups = new Map();
  const summary = { ballots: 0, counted: 0, noFirst: 0, overvote: 0, skipped: 0, duplicate: 0, noFirstOvervote: 0 };
  for (const b of ballots) {
    const it = interpret(b.ranks, rules);
    summary.ballots += b.count;
    if (it.overvote) summary.overvote += b.count;
    if (it.skipped) summary.skipped += b.count;
    if (it.duplicate) summary.duplicate += b.count;
    if (!it.seq.length) { summary.noFirst += b.count; if (it.stop === "overvote") summary.noFirstOvervote += b.count; continue; }
    summary.counted += b.count;
    const key = `${it.seq.join(",")}/${it.stop || ""}`;
    const g = groups.get(key);
    if (g) g.count += b.count; else groups.set(key, { seq: it.seq, stop: it.stop, count: b.count, at: 0 });
  }
  const G = [...groups.values()];
  const alive = new Array(n).fill(true);
  const piles = Array.from({ length: n }, () => []);
  for (const g of G) piles[g.seq[0]].push(g);
  const exhausted = { list: 0, overvote: 0, skips: 0 };
  const rounds = [];
  let winner = null, majorityRound = null, decidedByTie = false;
  const tallyOf = (c) => piles[c].reduce((s, g) => s + g.count, 0);

  for (let round = 1; ; round++) {
    const tally = candidates.map((_, c) => (alive[c] ? tallyOf(c) : null));
    const continuing = tally.reduce((s, v) => s + (v ?? 0), 0);
    const left = alive.reduce((s, a) => s + (a ? 1 : 0), 0);
    const leader = tally.reduce((best, v, c) => (v !== null && (best < 0 || v > tally[best]) ? c : best), -1);
    const hasMajority = continuing > 0 && tally[leader] * 2 > continuing;
    const rec = { round, tally, continuing, exhausted: exhausted.list + exhausted.overvote + exhausted.skips, exhaustedBy: { ...exhausted }, majority: Math.floor(continuing / 2) + 1, leader, hasMajority, eliminated: null, tie: null, transfers: null };
    rounds.push(rec);
    if (hasMajority && majorityRound === null) { majorityRound = round; winner = leader; }
    if (left === 1) { winner ??= leader; break; }
    if (hasMajority && (!rules.untilTwo || left === 2)) break;
    if (left === 2) {
      // Two left and level (or no ballots left to count): the tie rule decides which of them is out.
      const out = pickElimination(alive, tally, rounds, rules, draw, rec);
      winner = alive.findIndex((a, c) => a && c !== out);
      decidedByTie = true;
      break;
    }
    // Eliminate and transfer.
    const out = pickElimination(alive, tally, rounds, rules, draw, rec);
    rec.eliminated = out;
    alive[out] = false;
    const to = new Array(n).fill(0);
    const ex = { list: 0, overvote: 0, skips: 0 };
    for (const g of piles[out]) {
      let k = g.at + 1;
      while (k < g.seq.length && !alive[g.seq[k]]) k++;
      g.at = k;
      if (k < g.seq.length) { piles[g.seq[k]].push(g); to[g.seq[k]] += g.count; }
      else { const why = g.stop || "list"; ex[why] += g.count; exhausted[why] += g.count; }
    }
    piles[out] = [];
    rec.transfers = { to, exhausted: ex, total: tally[out] };
  }
  return { candidates, rounds, winner, majorityRound, decidedByTie, summary };
}

/** Who goes out: the fewest votes, with ties settled by the rule. Records the tie on the round. */
function pickElimination(alive, tally, rounds, rules, draw, rec) {
  const live = alive.map((a, c) => (a ? c : -1)).filter((c) => c >= 0);
  const low = Math.min(...live.map((c) => tally[c]));
  let tied = live.filter((c) => tally[c] === low);
  if (tied.length === 1) return tied[0];
  const all = [...tied];
  let separatedAt = null;
  if (rules.tie === "backward" || rules.tie === "forward") {
    // Earlier rounds only: the current round is where they tie. Backward looks from the most recent round, forward from round 1.
    const earlier = rounds.slice(0, -1);
    const order = rules.tie === "backward" ? [...earlier].reverse() : earlier;
    for (const r of order) {
      const m = Math.min(...tied.map((c) => r.tally[c]));
      const keep = tied.filter((c) => r.tally[c] === m);
      if (keep.length < tied.length) { tied = keep; separatedAt = r.round; if (tied.length === 1) break; }
    }
  }
  const drawn = tied.length > 1;
  const out = drawn ? tied[Math.floor(draw() * tied.length)] : tied[0];
  rec.tie = { tied: all, out, by: drawn ? "lot" : "rounds", round: drawn ? null : separatedAt, drawnFrom: drawn ? tied : null };
  return out;
}

/* ------------------------------------------------------------------ checking against a published count */

/**
 * Compare a count with a published distribution of preferences: { excluded, totals[c][k], inCount[k], exhausted[k],
 * majority[k] }. Returns a list of differences (empty if every figure matches).
 */
export function compareWithPublished(result, pub) {
  const diffs = [];
  const K = pub.inCount.length;
  if (result.rounds.length !== K) diffs.push(`${result.rounds.length} rounds counted, ${K} published`);
  for (let k = 0; k < Math.min(K, result.rounds.length); k++) {
    const r = result.rounds[k];
    pub.totals.forEach((series, c) => {
      const want = series[k], got = r.tally[c];
      if ((want ?? null) !== (got ?? null)) diffs.push(`count ${k + 1}, ${result.candidates[c]}: ${got ?? "out"} counted, ${want ?? "out"} published`);
    });
    if (r.continuing !== pub.inCount[k]) diffs.push(`count ${k + 1}: ${r.continuing} ballots in the count, ${pub.inCount[k]} published`);
    if (r.exhausted !== pub.exhausted[k]) diffs.push(`count ${k + 1}: ${r.exhausted} exhausted, ${pub.exhausted[k]} published`);
    if (r.majority !== pub.majority[k]) diffs.push(`count ${k + 1}: majority ${r.majority}, ${pub.majority[k]} published`);
  }
  const order = result.rounds.map((r) => r.eliminated).filter((c) => c !== null);
  if (order.join() !== pub.excluded.join()) diffs.push("the order of eliminations differs");
  return diffs;
}

/** A bundled contest's ballots in the engine's form. */
export function contestBallots(contest) {
  return {
    candidates: contest.candidates.map((c) => `${c.name} (${c.party})`),
    ballots: contest.ballots.map(([s, count]) => ({ ranks: [...s].map((ch) => [ch.charCodeAt(0) - 65]), count })),
  };
}

/* ------------------------------------------------------------------ results as CSV */

export function resultsToCSV(result) {
  const { candidates, rounds } = result;
  const head = ["round", "candidate", "votes", "change", "status"];
  const lines = [head.join(",")];
  rounds.forEach((r, k) => {
    const prev = k ? rounds[k - 1] : null;
    candidates.forEach((name, c) => {
      if (r.tally[c] === null) return;
      const change = prev ? r.tally[c] - prev.tally[c] : "";
      const status = r.eliminated === c ? "eliminated" : result.winner === c && k === rounds.length - 1 ? "elected" : "continuing";
      lines.push([r.round, csvCell(name), r.tally[c], change, status].join(","));
    });
    lines.push([r.round, csvCell("Exhausted ballots"), r.exhausted, prev ? r.exhausted - prev.exhausted : "", ""].join(","));
  });
  return lines.join("\n");
}

/* ------------------------------------------------------------------ simulated electorates */

/**
 * Voters and candidates on a left-right line: voters from a standard normal distribution, candidates at random
 * between -1.5 and 1.5. Each voter ranks candidates by distance. A share `justOne` rank only their first choice;
 * the rest rank between two and all of them, every length equally likely. A share `skipRate` leave a blank after
 * their first choice, and a share `overRate` mark two candidates at one of their rankings, chosen at random.
 */
export function createSimulation({ n, voters, seed = 1, justOne = 0.3, skipRate = 0.02, overRate = 0.01 }) {
  const r = rng(seed);
  const pos = Array.from({ length: n }, () => r.uniform(-1.5, 1.5));
  const candidates = Array.from({ length: n }, (_, c) => `Candidate ${String.fromCharCode(65 + c)}`);
  const seen = new Map();
  let v = 0;
  const step = (max = Infinity) => {
    const stop = Math.min(voters, v + max);
    for (; v < stop; v++) {
      const x = r.normal(0, 1);
      const order = candidates.map((_, c) => c).sort((a, b) => Math.abs(x - pos[a]) - Math.abs(x - pos[b]) || a - b);
      const k = r() < justOne || n === 1 ? 1 : 2 + Math.floor(r() * (n - 1));
      let ranks = order.slice(0, k).map((c) => [c]);
      if (r() < overRate) {
        const at = Math.floor(r() * k);
        const other = order[k] ?? order.find((c) => c !== ranks[at][0]);
        if (other !== undefined && other !== ranks[at][0]) ranks[at] = [ranks[at][0], other].sort((a, b) => a - b);
      }
      if (r() < skipRate && ranks.length >= 2) ranks = [ranks[0], [], ...ranks.slice(1)];
      const key = ranks.map((m) => m.join("|")).join(",");
      const prev = seen.get(key);
      if (prev) prev.count++; else seen.set(key, { ranks, count: 1 });
    }
    return v >= voters;
  };
  return {
    step,
    get done() { return v; },
    result: () => ({ candidates, ballots: [...seen.values()].sort((a, b) => b.count - a.count), positions: pos }),
  };
}

/** The whole electorate at once (for tests). */
export function simulate(opts) {
  const s = createSimulation(opts);
  s.step();
  return s.result();
}

/** A published distribution re-indexed for a count whose candidates are listed in another order (matched by name). */
export function remapPublished(pub, fromNames, toNames) {
  const at = fromNames.map((name) => toNames.indexOf(name));
  if (at.some((i) => i < 0) || toNames.length !== fromNames.length) return null;
  const totals = toNames.map(() => null);
  pub.totals.forEach((series, c) => { totals[at[c]] = series; });
  return { ...pub, totals, excluded: pub.excluded.map((c) => at[c]) };
}
