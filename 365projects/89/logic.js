// Day 89: Voting Method Comparer. The model, with no DOM code.
// A ballot profile (how many voters cast each ranking, and where each draws an approval line) and seven ways of
// turning it into a winner. Ties are never broken by an arbitrary rule: a method that cannot separate candidates
// reports all of them, and instant runoff follows every way an elimination tie could be broken.

import { rng } from "../kit/kit.js";

export const LETTERS = "ABCDEF";
// 4,000 lines leaves room for every distinct ballot of six candidates (720 rankings, five places for the approval line),
// which a large generated electorate can produce.
export const LIMITS = { minCandidates: 3, maxCandidates: 6, lines: 4000, text: 200000, count: 10000000, total: 100000000, name: 24 };

/* ------------------------------------------------------------------ reading a profile */

/**
 * One ballot type per line: a count, an optional colon, then the ranking as candidate letters from first to last,
 * separated by ">", spaces or commas, with "|" where the voters' approval line falls (they approve the candidates
 * before it). Without "|" a line approves its first choice only. Blank lines and lines starting with # are skipped.
 * Returns { types: [{ ranking, count, approve, line }], total, notes } or { errors: ["Line 3: ..."] }.
 */
export function parseProfile(text, n) {
  const errors = [], notes = [];
  if (typeof text !== "string") return { errors: ["There is no profile yet. Pick an example or generate one."] };
  if (text.length > LIMITS.text) return { errors: [`The profile is longer than the limit of ${LIMITS.text.toLocaleString("en-GB")} characters. Merge identical lines or generate a profile instead.`] };
  const letters = LETTERS.slice(0, n);
  const lines = text.split(/\r?\n/);
  const types = [];
  let total = 0, used = 0, noLine = 0;
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li].trim();
    if (!raw || raw.startsWith("#")) continue;
    used++;
    if (used > LIMITS.lines) { errors.push(`More than ${LIMITS.lines.toLocaleString("en-GB")} ballot lines. Merge identical rankings into one line with their total count.`); break; }
    const where = `Line ${li + 1}`;
    const m = /^(\S+?)\s*[:\s]\s*(.*)$/.exec(raw);
    if (!m) { errors.push(`${where}: write a count, a colon and a ranking, for example "12: A > B | C".`); continue; }
    const countText = m[1].replace(/:$/, "");
    const count = /^\d+$/.test(countText) ? Number(countText) : NaN;
    if (!Number.isSafeInteger(count) || count > LIMITS.count) { errors.push(`${where}: the count "${countText.slice(0, 20)}" must be a whole number from 0 to ${LIMITS.count.toLocaleString("en-GB")}.`); continue; }
    const body = m[2].toUpperCase();
    if (!body.trim()) { errors.push(`${where}: there is a count but no ranking. Add the candidates in order, for example "${count}: ${letters.split("").join(" > ")}".`); continue; }
    const bad = body.replace(/[\s>,|]/g, "").split("").find((ch) => !letters.includes(ch));
    if (bad) { errors.push(`${where}: "${bad}" is not a candidate. With ${n} candidates use the letters ${letters[0]} to ${letters[n - 1]}.`); continue; }
    const bars = (body.match(/\|/g) || []).length;
    if (bars > 1) { errors.push(`${where}: put the approval line "|" in once at most.`); continue; }
    const [before, after = ""] = body.split("|");
    const pick = (s) => s.replace(/[\s>,]/g, "").split("").filter(Boolean);
    const top = pick(before), rest = pick(after);
    const ranking = [...top, ...rest].map((ch) => letters.indexOf(ch));
    const twice = ranking.find((c, i) => ranking.indexOf(c) !== i);
    if (twice !== undefined) { errors.push(`${where}: ${letters[twice]} appears twice. Rank each candidate once.`); continue; }
    if (ranking.length < n) {
      const missing = letters.split("").filter((_, c) => !ranking.includes(c));
      errors.push(`${where}: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing. This tool needs every candidate ranked; for ballots that stop early, use day 90.`);
      continue;
    }
    if (!bars) noLine++;
    const approve = bars ? top.length : 1;
    types.push({ ranking, count, approve, line: li + 1 });
    total += count;
  }
  if (!errors.length && total > LIMITS.total) errors.push(`The counts add up to ${total.toLocaleString("en-GB")} voters; the limit is ${LIMITS.total.toLocaleString("en-GB")}.`);
  if (!errors.length && total === 0) errors.push(used ? "Every count is zero, so there are no voters. Give at least one line a count above zero." : "There is no profile yet. Pick an example or generate one.");
  if (errors.length) return { errors };
  if (noLine) notes.push(`${noLine === 1 ? "One line has" : `${noLine} lines have`} no approval line "|", so ${noLine === 1 ? "its voters approve" : "their voters approve"} their first choice only.`);
  return { types: types.filter((t) => t.count > 0), total, notes };
}

/** Write a profile back as text, one line per ballot type. */
export function formatProfile(types) {
  return types.map((t) => {
    const r = t.ranking.map((c) => LETTERS[c]);
    const head = r.slice(0, t.approve).join(" > "), tail = r.slice(t.approve).join(" > ");
    return `${t.count}: ${head}${head && tail ? " | " : head ? " |" : "| "}${tail}`;
  }).join("\n");
}

/** Change the number of candidates: drop letters past the new count, and add new ones at the bottom, unapproved. */
export function resizeTypes(types, from, to) {
  const merged = new Map();
  for (const t of types) {
    let ranking = t.ranking.filter((c) => c < to);
    let approve = t.ranking.slice(0, t.approve).filter((c) => c < to).length;
    for (let c = from; c < to; c++) ranking.push(c);
    if (approve === 0 && t.approve > 0) approve = 1;
    const key = `${ranking.join("")}|${approve}`;
    const old = merged.get(key);
    if (old) old.count += t.count; else merged.set(key, { ranking, count: t.count, approve });
  }
  return [...merged.values()];
}

/* ------------------------------------------------------------------ tallies */

const argmaxSet = (scores, among) => {
  const best = Math.max(...among.map((c) => scores[c]));
  return among.filter((c) => scores[c] === best);
};
const range = (n) => Array.from({ length: n }, (_, i) => i);

/** First preferences among the candidates still in (`alive`, a list). */
export function firstPreferences(types, n, alive = range(n)) {
  const set = new Set(alive), t = new Array(n).fill(0);
  for (const b of types) { const top = b.ranking.find((c) => set.has(c)); if (top !== undefined) t[top] += b.count; }
  return t;
}

/** pairwise[x][y]: voters ranking x above y. */
export function pairwise(types, n) {
  const d = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const b of types) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) d[b.ranking[i]][b.ranking[j]] += b.count;
  return d;
}

/* ------------------------------------------------------------------ the methods */

export function plurality(types, n) {
  const tally = firstPreferences(types, n);
  return { winners: argmaxSet(tally, range(n)), tally };
}

/**
 * Two rounds: a candidate with more than half the first preferences wins at once; otherwise the two with the most
 * meet, and every voter backs whichever of the two they rank higher. If ties leave the second place (or the first
 * two) open, every pair that could have gone through is run, and every possible winner is reported.
 */
export function twoRound(types, n) {
  const tally = firstPreferences(types, n);
  const total = tally.reduce((a, b) => a + b, 0);
  const order = range(n).sort((a, b) => tally[b] - tally[a] || a - b);
  if (tally[order[0]] * 2 > total) return { winners: [order[0]], tally, majority: order[0], pairs: [] };
  const d = pairwise(types, n);
  // Candidates that could be in the top two: everyone whose tally is at least the second-highest tally.
  const second = tally[order[1]];
  const contenders = order.filter((c) => tally[c] >= second);
  const pairs = [];
  for (let i = 0; i < contenders.length; i++) for (let j = i + 1; j < contenders.length; j++) {
    const [a, b] = [contenders[i], contenders[j]];
    // A pair can go through only if no candidate outside it has strictly more than either member.
    const lowest = Math.min(tally[a], tally[b]);
    if (contenders.some((c) => c !== a && c !== b && tally[c] > lowest)) continue;
    pairs.push({ a, b, va: d[a][b], vb: d[b][a], winners: d[a][b] > d[b][a] ? [a] : d[b][a] > d[a][b] ? [b] : [a, b] });
  }
  const winners = [...new Set(pairs.flatMap((p) => p.winners))].sort((a, b) => a - b);
  return { winners, tally, majority: null, pairs };
}

/**
 * Instant runoff (the alternative vote, ranked-choice voting, the Hare rule): while no candidate has more than half
 * the first preferences among those still in, the one with the fewest is eliminated. A tie for fewest is followed
 * both (all) ways. rounds is the path taken by eliminating the lowest-lettered tied candidate, with `tie` marking
 * where other paths split off; winners is every candidate some path elects.
 */
export function instantRunoff(types, n) {
  const memo = new Map();
  const solve = (alive) => {
    const key = alive.join(",");
    if (memo.has(key)) return memo.get(key);
    const tally = firstPreferences(types, n, alive);
    const total = alive.reduce((s, c) => s + tally[c], 0);
    let out;
    const top = alive.find((c) => tally[c] * 2 > total);
    if (top !== undefined) out = [top];
    else if (alive.length === 1) out = [alive[0]];
    else {
      const low = Math.min(...alive.map((c) => tally[c]));
      const tied = alive.filter((c) => tally[c] === low);
      out = [...new Set(tied.flatMap((c) => solve(alive.filter((x) => x !== c))))].sort((a, b) => a - b);
    }
    memo.set(key, out);
    return out;
  };
  const winners = solve(range(n));
  const rounds = [];
  let alive = range(n);
  for (;;) {
    const tally = firstPreferences(types, n, alive);
    const total = alive.reduce((s, c) => s + tally[c], 0);
    const top = alive.find((c) => tally[c] * 2 > total);
    const round = { alive: [...alive], tally, total, majority: top ?? null, eliminated: null, tie: null };
    rounds.push(round);
    if (top !== undefined || alive.length === 1) break;
    const low = Math.min(...alive.map((c) => tally[c]));
    const tied = alive.filter((c) => tally[c] === low);
    if (tied.length > 1) round.tie = tied.map((c) => ({ candidate: c, leadsTo: solve(alive.filter((x) => x !== c)) }));
    round.eliminated = tied[0];
    alive = alive.filter((c) => c !== tied[0]);
  }
  return { winners, rounds };
}

/** Approval: each voter approves the candidates above their approval line; most approvals wins. */
export function approval(types, n) {
  const tally = new Array(n).fill(0);
  for (const b of types) for (let i = 0; i < b.approve; i++) tally[b.ranking[i]] += b.count;
  return { winners: argmaxSet(tally, range(n)), tally };
}

/** Borda count: n - 1 points for a first place, n - 2 for a second, and so on down to 0 for last. */
export function borda(types, n) {
  const tally = new Array(n).fill(0);
  for (const b of types) b.ranking.forEach((c, i) => { tally[c] += b.count * (n - 1 - i); });
  return { winners: argmaxSet(tally, range(n)), tally };
}

/** The candidate who beats every other head to head by a strict majority, or null. */
export function condorcetWinner(types, n, d = pairwise(types, n)) {
  for (let x = 0; x < n; x++) if (range(n).every((y) => y === x || d[x][y] > d[y][x])) return x;
  return null;
}

/** Copeland: wins minus losses in the head-to-head contests (a tied contest counts as neither). */
export function copeland(types, n, d = pairwise(types, n)) {
  const score = range(n).map((x) => range(n).reduce((s, y) => s + (y === x ? 0 : d[x][y] > d[y][x] ? 1 : d[x][y] < d[y][x] ? -1 : 0), 0));
  return { winners: argmaxSet(score, range(n)), score };
}

/**
 * Schulze: a defeat of y by x has strength d[x][y] (the winning votes), and 0 if x does not beat y. p[x][y] is the
 * strength of the strongest path from x to y, a path being as strong as its weakest link (Floyd-Warshall for widest
 * paths). x is a winner if p[x][y] >= p[y][x] for every y.
 */
export function schulze(types, n, d = pairwise(types, n)) {
  const p = range(n).map((x) => range(n).map((y) => (x !== y && d[x][y] > d[y][x] ? d[x][y] : 0)));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    for (let k = 0; k < n; k++) if (k !== i && k !== j) p[j][k] = Math.max(p[j][k], Math.min(p[j][i], p[i][k]));
  }
  const winners = range(n).filter((x) => range(n).every((y) => y === x || p[x][y] >= p[y][x]));
  return { winners, paths: p };
}

export const METHODS = [
  { key: "plurality", label: "Plurality" },
  { key: "twoRound", label: "Two-round runoff" },
  { key: "irv", label: "Instant runoff" },
  { key: "approval", label: "Approval" },
  { key: "borda", label: "Borda count" },
  { key: "copeland", label: "Copeland" },
  { key: "schulze", label: "Schulze" },
];

/** Every method on one profile. */
export function runAll(types, n) {
  const d = pairwise(types, n);
  const res = {
    plurality: plurality(types, n), twoRound: twoRound(types, n), irv: instantRunoff(types, n), approval: approval(types, n),
    borda: borda(types, n), copeland: copeland(types, n, d), schulze: schulze(types, n, d),
  };
  return { ...res, pairwise: d, condorcet: condorcetWinner(types, n, d), total: types.reduce((s, t) => s + t.count, 0) };
}

/** Groups of methods by winner set: [{ winners, methods }], in the order the methods first name them. */
export function agreement(results) {
  const groups = new Map();
  for (const m of METHODS) {
    const key = results[m.key].winners.join(",");
    if (!groups.has(key)) groups.set(key, { winners: results[m.key].winners, methods: [] });
    groups.get(key).methods.push(m.key);
  }
  return [...groups.values()];
}

/* ------------------------------------------------------------------ insincere ballots */

/** Winners of one method. */
export function winnersOf(key, types, n) {
  const f = { plurality, twoRound, irv: instantRunoff, approval, borda, copeland, schulze }[key];
  return f(types, n).winners;
}

function permutations(n) {
  const out = [];
  const go = (prefix, rest) => { if (!rest.length) { out.push(prefix); return; } rest.forEach((c, i) => go([...prefix, c], [...rest.slice(0, i), ...rest.slice(i + 1)])); };
  go([], range(n));
  return out;
}

/**
 * Can the voters of one ballot type, all switching to the same other ballot, get a result they like better? "Better"
 * is strict: every candidate who would then win is ranked by them above every candidate who wins now. For approval
 * every set of approved candidates is tried; for the other methods every ranking. Returns, for each ballot type, the
 * first such ballot found (or null), searching only profiles with at most `maxTypes` ballot types.
 */
export function insincere(types, n, key, { maxTypes = 24 } = {}) {
  if (types.length > maxTypes) return { searched: false, found: [] };
  const search = insincereSearch(types, n, key);
  return { searched: true, before: search.before, found: types.map((_, g) => search.group(g)) };
}

/**
 * The same search one group at a time, so that an interface can run it in slices: search.group(g) returns what
 * insincere() reports for group g.
 */
export function insincereSearch(types, n, key) {
  const before = winnersOf(key, types, n);
  const options = key === "approval"
    ? range(2 ** n).map((mask) => { const inS = range(n).filter((c) => mask & (1 << c)); return { ranking: [...inS, ...range(n).filter((c) => !inS.includes(c))], approve: inS.length }; })
    : permutations(n).map((ranking) => ({ ranking, approve: 1 }));
  const group = (g) => {
    const t = types[g];
    const rank = new Map(t.ranking.map((c, i) => [c, i]));
    for (const o of options) {
      if (key !== "approval" && o.ranking.join() === t.ranking.join()) continue;
      if (key === "approval" && o.ranking.slice(0, o.approve).sort().join() === t.ranking.slice(0, t.approve).sort().join()) continue;
      const trial = types.map((x, i) => (i === g ? { ...x, ranking: o.ranking, approve: key === "approval" ? o.approve : x.approve } : x));
      const after = winnersOf(key, trial, n);
      if (after.every((a) => before.every((b) => rank.get(a) < rank.get(b)))) return { group: g, ballot: o, before, after };
    }
    return null;
  };
  return { before, group };
}

/* ------------------------------------------------------------------ simulated electorates */

export const MODELS = [
  { value: "ic", label: "Impartial culture: every ranking equally likely" },
  { value: "line", label: "Left and right: voters and candidates on a line" },
];

/**
 * Draw an electorate. Each voter gets a utility for each candidate: uniform at random ("ic"), or minus the distance
 * between the voter and the candidate on a line ("line": voters from a normal distribution, candidates spread at
 * random between -1.5 and 1.5). The ballot ranks by utility and approves every candidate above the voter's average
 * utility (at least one): a sincere approval ballot, since it never approves a candidate while leaving out one the
 * voter likes more. Returns ballot types, most common first.
 */
export function generate({ n, voters, model = "ic", seed = 1 }) {
  const r = rng(seed);
  const pos = model === "line" ? range(n).map(() => r.uniform(-1.5, 1.5)) : null;
  const counts = new Map();
  const u = new Array(n);
  for (let v = 0; v < voters; v++) {
    if (model === "line") { const x = r.normal(0, 1); for (let c = 0; c < n; c++) u[c] = -Math.abs(x - pos[c]); }
    else for (let c = 0; c < n; c++) u[c] = r();
    const ranking = range(n).sort((a, b) => u[b] - u[a] || a - b);
    const mean = u.reduce((s, x) => s + x, 0) / n;
    const approve = Math.max(1, ranking.filter((c) => u[c] > mean).length);
    const key = `${ranking.join("")}|${approve}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return {
    types: [...counts.entries()].map(([key, count]) => { const [rk, k] = key.split("|"); return { ranking: rk.split("").map(Number), count, approve: Number(k) }; })
      .sort((a, b) => b.count - a.count || a.ranking.join("").localeCompare(b.ranking.join(""))),
    positions: pos,
  };
}

/** Running totals for many simulated elections: call add(results) for each, read summary(). */
export function createTally() {
  const t = { elections: 0, withCondorcet: 0, allAgree: 0, picksCondorcet: {}, ties: {}, distinct: 0 };
  for (const m of METHODS) { t.picksCondorcet[m.key] = 0; t.ties[m.key] = 0; }
  return {
    add(res) {
      t.elections++;
      const groups = agreement(res);
      if (groups.length === 1 && groups[0].winners.length === 1) t.allAgree++;
      t.distinct += new Set(METHODS.flatMap((m) => res[m.key].winners)).size;
      if (res.condorcet !== null) t.withCondorcet++;
      for (const m of METHODS) {
        const w = res[m.key].winners;
        if (w.length > 1) t.ties[m.key]++;
        if (res.condorcet !== null && w.length === 1 && w[0] === res.condorcet) t.picksCondorcet[m.key]++;
      }
    },
    get summary() { return JSON.parse(JSON.stringify(t)); },
  };
}

/** The limit, as the number of voters grows, of the chance that three candidates under impartial culture have a Condorcet winner. */
export const GUILBAUD = 3 / 4 + (3 / (2 * Math.PI)) * Math.asin(1 / 3);
