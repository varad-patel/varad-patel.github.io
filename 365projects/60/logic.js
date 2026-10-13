// Day 60: Stable Matching Marketplace. Model: candidates and employers with ranked lists, employers with one or more
// positions, solved by deferred acceptance (Gale and Shapley 1962). Pure functions, no DOM.
//
// A market is { candidates: [{ name, prefs }], employers: [{ name, capacity, prefs }] } where prefs is a list of
// indices into the other side, best first. Anyone left off a list is unacceptable to the one who wrote it.
// A matching is an array with one entry per candidate: the index of its employer, or null.

export const LIMITS = { agents: 20, capacity: 20, name: 30, text: 4000, misreportSide: 6 };

/* ---------------------------------------------------------------- parsing */

const tidy = (s) => s.trim().replace(/\s+/g, " ");
const listOf = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/**
 * Read the two text boxes. One agent per line: "Asha: Acme, Bolt" for a candidate, "Acme (2): Asha, Ben" for an
 * employer with two positions (one position if the brackets are left out). Names are matched without regard to
 * capitals or extra spaces. Lists may be separated by commas or semicolons (the full-width ones too), a full-width
 * colon counts as a colon, and a line pasted from a spreadsheet, with tabs between its cells and no colon, is read
 * with the first cell as the name and the others as the list. The numbers of a numbered list ("1. Asha: ...") are
 * dropped when every line has its own number in order. Returns { market, errors, notes }: errors say what to fix and leave market null;
 * notes point out listings that can never lead to a match (one side lists the other but not the reverse).
 */
export function parse(candidateText, employerText) {
  const errors = [];
  const sides = [
    { key: "candidates", one: "candidate", other: "employer", text: candidateText, example: "Asha: Acme, Bolt" },
    { key: "employers", one: "employer", other: "candidate", text: employerText, example: "Acme (2): Asha, Ben" },
  ];
  for (const side of sides) {
    side.agents = [];
    side.skipped = 0; // lines that could not be read; see the note where unknown names are reported
    const skip = (message) => { errors.push(message); side.skipped++; };
    const text = typeof side.text === "string" ? side.text : "";
    if (text.length > LIMITS.text) { errors.push(`The ${side.key} box holds ${text.length} characters; the limit is ${LIMITS.text}. Shorten it.`); continue; }
    const lines = text.split(/\r?\n/);
    // A pasted numbered list ("1. Asha: ...", "2. Ben: ...") loses its numbers, but only when every line that is
    // not blank carries its own number in order, so that a name which merely starts with a number is left alone.
    const written = lines.filter((l) => l.trim());
    const numbered = written.length > 1 && written.every((l, k) => new RegExp(`^\\s*${k + 1}[.)]\\s+\\S`).test(l));
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      const where = `Line ${i + 1} of the ${side.key}`;
      let raw = (numbered ? line.replace(/^\s*\d+[.)]\s+/, "") : line).replace(/\uFF1A/g, ":");
      if (!raw.includes(":") && raw.trim().includes("\t")) raw = raw.trim().replace("\t", ":");
      const colon = raw.indexOf(":");
      if (colon < 0) { skip(`${where} has no colon. Write a name, a colon, then the list, like this: ${side.example}`); return; }
      let name = tidy(raw.slice(0, colon)), capacity = 1;
      const bracket = /^(.*?)\s*\(([^()]*)\)$/.exec(name);
      if (bracket) {
        if (side.key === "candidates") { skip(`${where}: a candidate fills one position, so "${name}" cannot have a number in brackets. Remove the brackets.`); return; }
        name = tidy(bracket[1]);
        capacity = /^\d+$/.test(bracket[2].trim()) ? Number(bracket[2]) : NaN;
        // The line is still read with one position, so that this one mistake is not followed by a complaint from
        // everyone who lists the employer.
        if (!(capacity >= 1 && capacity <= LIMITS.capacity)) { errors.push(`${where}: the number of positions at ${name || "this employer"} must be a whole number from 1 to ${LIMITS.capacity}, written like this: ${side.example}`); capacity = 1; }
      }
      if (!name) { skip(`${where} has no name before the colon.`); return; }
      if (name.length > LIMITS.name) { skip(`${where}: the name "${name.slice(0, 20)}…" is ${name.length} characters long; the limit is ${LIMITS.name}.`); return; }
      if (/[,;()\uFF0C\uFF1B\u3001]/.test(name)) { skip(`${where}: the name "${name}" contains a comma, a semicolon or a bracket. Names may not, because commas and semicolons separate a list and brackets hold the number of positions.`); return; }
      if (side.agents.some((a) => a.id === name.toLowerCase())) { errors.push(`${name} appears twice among the ${side.key} (line ${i + 1}). Give each ${side.one} one line.`); return; }
      // The list: commas or semicolons between names. Tabs separate only when there is no comma or semicolon at all.
      const rest = raw.slice(colon + 1).trim(), separator = /[,;\uFF0C\uFF1B\u3001]/;
      side.agents.push({ name, id: name.toLowerCase(), capacity, line: i + 1, items: (separator.test(rest) ? rest.split(separator) : rest.split(/\t+/)).map(tidy) });
    });
    if (!side.agents.length && !errors.length) errors.push(`There are no ${side.key}. Type at least one, like this: ${side.example}`);
    if (side.agents.length > LIMITS.agents) errors.push(`There are ${side.agents.length} ${side.key}; the limit is ${LIMITS.agents}. Remove some lines.`);
  }
  const [cs, es] = sides;
  for (const c of cs.agents) if (es.agents.some((e) => e.id === c.id)) errors.push(`${c.name} is both a candidate and an employer. Rename one of them.`);
  for (const [side, others] of [[cs, es], [es, cs]]) {
    for (const a of side.agents) {
      a.prefs = [];
      if (a.items.every((t) => !t)) { errors.push(`${a.name}'s list is empty. Name at least one ${side.other} after the colon, or delete the line.`); continue; }
      if (a.items.some((t) => !t)) { errors.push(`${a.name}'s list has an empty entry. Remove the extra comma.`); continue; }
      for (const item of a.items) {
        const j = others.agents.findIndex((o) => o.id === item.toLowerCase());
        if (j < 0 && !others.agents.length) continue; // the other box is empty, which has been reported once already
        // A line in the other box could not be read, and that has been reported. This name may well be the one on
        // that line, so saying that it is unknown would only bury the real mistake under its echoes.
        if (j < 0 && others.skipped) continue;
        if (j < 0) {
          const known = others.agents.map((o) => o.name);
          errors.push(`${a.name} lists "${item.length > 40 ? `${item.slice(0, 40)}…` : item}", which is not one of the ${others.key}`
            + (side.agents.some((s) => s.id === item.toLowerCase()) ? ` (it is one of the ${side.key}).` : known.length && known.length <= 12 ? `. The ${others.key} are ${listOf(known)}.` : "."));
        } else if (a.prefs.includes(j)) errors.push(`${a.name} lists ${others.agents[j].name} twice. Keep it once, where it belongs in the order.`);
        else a.prefs.push(j);
      }
    }
  }
  if (errors.length) return { market: null, errors, notes: [] };
  const market = {
    candidates: cs.agents.map((a) => ({ name: a.name, prefs: a.prefs })),
    employers: es.agents.map((a) => ({ name: a.name, capacity: a.capacity, prefs: a.prefs })),
  };
  const notes = [];
  market.candidates.forEach((c, i) => c.prefs.forEach((e) => { if (!market.employers[e].prefs.includes(i)) notes.push(`${c.name} lists ${market.employers[e].name}, but ${market.employers[e].name} does not list ${c.name}`); }));
  market.employers.forEach((e, j) => e.prefs.forEach((c) => { if (!market.candidates[c].prefs.includes(j)) notes.push(`${e.name} lists ${market.candidates[c].name}, but ${market.candidates[c].name} does not list ${e.name}`); }));
  return { market, errors, notes };
}

/** The text for the two boxes that parse() reads back into the same market. */
export function format(market) {
  return {
    candidates: market.candidates.map((c) => `${c.name}: ${c.prefs.map((e) => market.employers[e].name).join(", ")}`).join("\n"),
    employers: market.employers.map((e) => `${e.name}${e.capacity > 1 ? ` (${e.capacity})` : ""}: ${e.prefs.map((c) => market.candidates[c].name).join(", ")}`).join("\n"),
  };
}

/* ------------------------------------------------------ deferred acceptance */

const rankTable = (agents) => agents.map((a) => { const r = new Map(); a.prefs.forEach((j, k) => r.set(j, k)); return r; });

/**
 * Deferred acceptance, round by round. proposers is "candidates" or "employers".
 * In each round every proposer with something left to offer makes its next proposals at once (a candidate one,
 * an employer one for each position it has not filled); each receiver keeps the best it has seen so far, up to
 * its capacity, and rejects the rest. Nothing is final until a round passes with no proposals.
 * Returns { matching, hires, rounds }: matching[c] is candidate c's employer or null, hires[e] the candidates at
 * employer e in e's order of preference, and rounds a log:
 *   [{ proposals: [{ candidate, employer }], rejections: [{ candidate, employer, reason, kept }], matching }]
 * where matching is who holds whom once the round is over, and
 * a rejection's reason is "unlisted" (the receiver did not list the proposer), "outranked" (the receiver keeps others it
 * prefers; kept names them) or "released" (the same, for one it had been holding from an earlier round).
 */
export function deferredAcceptance(market, proposers = "candidates") {
  const { candidates, employers } = market;
  const cRank = rankTable(candidates), eRank = rankTable(employers);
  const matching = candidates.map(() => null);
  const held = employers.map(() => []);            // candidates each employer is holding
  const next = (proposers === "candidates" ? candidates : employers).map(() => 0); // position reached in each proposer's list
  const rounds = [];
  for (;;) {
    const proposals = [], rejections = [];
    if (proposers === "candidates") {
      candidates.forEach((c, i) => { if (matching[i] === null && next[i] < c.prefs.length) proposals.push({ candidate: i, employer: c.prefs[next[i]++] }); });
      if (!proposals.length) break;
      employers.forEach((e, j) => {
        const fresh = proposals.filter((p) => p.employer === j).map((p) => p.candidate);
        if (!fresh.length) return;
        for (const c of fresh.filter((c) => !eRank[j].has(c))) rejections.push({ candidate: c, employer: j, reason: "unlisted", kept: [] });
        const pool = [...held[j], ...fresh.filter((c) => eRank[j].has(c))].sort((a, b) => eRank[j].get(a) - eRank[j].get(b));
        const keep = pool.slice(0, e.capacity);
        for (const c of pool.slice(e.capacity)) { rejections.push({ candidate: c, employer: j, reason: held[j].includes(c) ? "released" : "outranked", kept: keep }); matching[c] = null; }
        for (const c of keep) matching[c] = j;
        held[j] = keep;
      });
    } else {
      employers.forEach((e, j) => { for (let free = e.capacity - held[j].length; free > 0 && next[j] < e.prefs.length; free--) proposals.push({ candidate: e.prefs[next[j]++], employer: j }); });
      if (!proposals.length) break;
      candidates.forEach((c, i) => {
        const fresh = proposals.filter((p) => p.candidate === i).map((p) => p.employer);
        if (!fresh.length) return;
        for (const e of fresh.filter((e) => !cRank[i].has(e))) rejections.push({ candidate: i, employer: e, reason: "unlisted", kept: [] });
        const pool = [...(matching[i] === null ? [] : [matching[i]]), ...fresh.filter((e) => cRank[i].has(e))].sort((a, b) => cRank[i].get(a) - cRank[i].get(b));
        if (!pool.length) return;
        for (const e of pool.slice(1)) { rejections.push({ candidate: i, employer: e, reason: e === matching[i] ? "released" : "outranked", kept: [pool[0]] }); held[e] = held[e].filter((x) => x !== i); }
        if (matching[i] !== pool[0]) { matching[i] = pool[0]; held[pool[0]].push(i); }
      });
    }
    rounds.push({ proposals, rejections, matching: [...matching] });
  }
  return { matching, hires: hiresOf(market, matching), rounds };
}

/** For each employer, the candidates a matching gives it, best first by its own list (unlisted ones last). */
export function hiresOf(market, matching) {
  const eRank = rankTable(market.employers);
  const order = (j) => (a, b) => (eRank[j].get(a) ?? Infinity) - (eRank[j].get(b) ?? Infinity) || a - b;
  return market.employers.map((_, j) => matching.map((e, c) => (e === j ? c : -1)).filter((c) => c >= 0).sort(order(j)));
}

/* --------------------------------------------------------------- stability */

/**
 * Check a matching against the definition of stability. Returns
 *   faults:   [{ kind: "candidateUnlisted" | "employerUnlisted" | "overCapacity", candidate, employer, count }]
 *             ways in which it is not a matching anyone would stand for even alone: someone is matched to a
 *             partner left off their list, or an employer has more people than positions;
 *   blocking: [{ candidate, employer, current, room, displaced }]
 *             pairs who both list each other, are not matched together, and would both rather be: the candidate
 *             prefers the employer to what it has (current, or null), and the employer has room for one more
 *             (room true) or prefers the candidate to its least preferred hire (displaced);
 *   pairs:    how many mutually acceptable pairs there are, all of which were examined;
 *   stable:   true when there are no faults and no blocking pairs.
 */
export function checkMatching(market, matching) {
  const { candidates, employers } = market;
  const cRank = rankTable(candidates), eRank = rankTable(employers);
  const hires = hiresOf(market, matching);
  const faults = [], blocking = [];
  matching.forEach((e, c) => {
    if (e === null) return;
    if (!cRank[c].has(e)) faults.push({ kind: "candidateUnlisted", candidate: c, employer: e });
    if (!eRank[e].has(c)) faults.push({ kind: "employerUnlisted", candidate: c, employer: e });
  });
  employers.forEach((e, j) => { if (hires[j].length > e.capacity) faults.push({ kind: "overCapacity", employer: j, count: hires[j].length }); });
  let pairs = 0;
  candidates.forEach((cand, c) => {
    for (const e of cand.prefs) {
      if (!eRank[e].has(c)) continue;
      pairs++;
      const now = matching[c];
      if (now === e) continue;
      // The candidate prefers e if it is unmatched, matched to someone it never listed, or matched lower down its list.
      if (now !== null && cRank[c].has(now) && cRank[c].get(now) < cRank[c].get(e)) continue;
      const room = hires[e].length < employers[e].capacity;
      const worst = hires[e][hires[e].length - 1];
      const displaced = !room && worst !== undefined && (eRank[e].get(worst) ?? Infinity) > eRank[e].get(c) ? worst : null;
      if (room || displaced !== null) blocking.push({ candidate: c, employer: e, current: now, room, displaced });
    }
  });
  return { faults, blocking, pairs, stable: !faults.length && !blocking.length };
}

/**
 * Why each mutually acceptable pair that is not matched together does not block a matching (or that it does).
 * verdict is "matched", "candidateContent" (the candidate prefers what it has), "employerContent" (the employer is
 * full and prefers everyone it has), "bothContent", or "blocks".
 */
export function explainPairs(market, matching) {
  const cRank = rankTable(market.candidates), eRank = rankTable(market.employers);
  const hires = hiresOf(market, matching);
  const out = [];
  market.candidates.forEach((cand, c) => {
    for (const e of cand.prefs) {
      if (!eRank[e].has(c)) continue;
      const now = matching[c];
      if (now === e) { out.push({ candidate: c, employer: e, verdict: "matched" }); continue; }
      const candidateContent = now !== null && cRank[c].has(now) && cRank[c].get(now) < cRank[c].get(e);
      const worst = hires[e][hires[e].length - 1];
      const employerContent = hires[e].length >= market.employers[e].capacity && (eRank[e].get(worst) ?? Infinity) < eRank[e].get(c);
      out.push({ candidate: c, employer: e, current: now, worst, verdict: candidateContent && employerContent ? "bothContent" : candidateContent ? "candidateContent" : employerContent ? "employerContent" : "blocks" });
    }
  });
  return out;
}

/** How many on each side get the first name on their list, and how many are matched at all. */
export function summarise(market, matching) {
  const hires = hiresOf(market, matching);
  return {
    candidatesFirst: market.candidates.filter((c, i) => matching[i] !== null && matching[i] === c.prefs[0]).length,
    employersFirst: market.employers.filter((e, j) => hires[j].includes(e.prefs[0])).length,
    matched: matching.filter((e) => e !== null).length,
    filled: hires.reduce((s, h) => s + h.length, 0),
    positions: market.employers.reduce((s, e) => s + e.capacity, 0),
  };
}

/* -------------------------------------------------------------- incentives */

/**
 * Compare two groups of hires for an employer by its true list: 1 if `a` is better, -1 if `b` is, 0 if they are
 * the same, null if neither can be called better without knowing more than a ranked list tells us.
 * Each group is sorted best first and padded with empty positions; an empty position ranks below everyone on the
 * list and above anyone off it. `a` is better only if position by position it is at least as good and somewhere
 * strictly better: the comparison that holds for every employer whose taste for groups follows its ranking of
 * individuals (what the literature calls responsive preferences).
 */
export function compareHires(prefs, capacity, a, b) {
  const rank = new Map(prefs.map((c, k) => [c, k]));
  const size = Math.max(capacity, a.length, b.length);
  const vector = (set) => { const v = set.map((c) => rank.get(c) ?? prefs.length + 1).sort((x, y) => x - y); while (v.length < size) v.push(prefs.length); return v.sort((x, y) => x - y); };
  const va = vector(a), vb = vector(b);
  let better = false, worse = false;
  for (let k = 0; k < size; k++) { if (va[k] < vb[k]) better = true; else if (va[k] > vb[k]) worse = true; }
  return better && worse ? null : better ? 1 : worse ? -1 : 0;
}

/** Every list an agent could report: each ordering of each non-empty selection from n names. */
export function* everyList(n) {
  const list = [], used = new Array(n).fill(false);
  function* extend() {
    if (list.length) yield [...list];
    for (let i = 0; i < n; i++) { if (used[i]) continue; used[i] = true; list.push(i); yield* extend(); list.pop(); used[i] = false; }
  }
  yield* extend();
}
/** How many lists that is: n + n(n-1) + ... + n!. */
export const countLists = (n) => { let total = 0, term = 1; for (let k = 0; k < n; k++) { term *= n - k; total += term; } return total; };

/**
 * Try every false list one agent could report while everyone else tells the truth, and see whether any gets it a
 * strictly better result by its true list. side is "candidates" or "employers", index the agent.
 * A candidate gains if it ends with an employer higher on its true list (or with any listed employer when the
 * truth leaves it unmatched). An employer gains if its hires are better in the sense of compareHires.
 * Returns { tried, gains, best }: how many false lists were tried, how many of them paid, and the simplest that
 * did, as { list, truthful, lying, dropped }. "Simplest" prefers a lie that only leaves names off the true list
 * (dropped says how many), then a shorter list.
 */
export function findManipulation(market, proposers, side, index) {
  const search = manipulationSearch(market, proposers, side, index);
  while (!search.advance(1000)) { /* keep going */ }
  return search.result;
}

/**
 * The same search in pieces, so that a page can stay responsive: advance(n) tries up to n more false lists and
 * returns true once every list has been tried; result holds { tried, gains, best } as it stands.
 */
export function manipulationSearch(market, proposers, side, index) {
  const truthful = deferredAcceptance(market, proposers);
  const agent = market[side][index];
  const others = side === "candidates" ? market.employers.length : market.candidates.length;
  const rank = new Map(agent.prefs.map((j, k) => [j, k]));
  const outcome = (run) => (side === "candidates" ? run.matching[index] : run.hires[index]);
  const before = outcome(truthful);
  // A list that keeps the true order and only omits names scores the number omitted; any other lie scores higher.
  const cost = (list) => {
    let k = 0;
    for (const j of agent.prefs) if (list[k] === j) k++;
    return k === list.length ? agent.prefs.length - list.length : 1000 + list.length;
  };
  const result = { tried: 0, gains: 0, best: null };
  const lists = everyList(others);
  let bestCost = Infinity;
  const tryOne = (list) => {
    if (list.length === agent.prefs.length && list.every((j, k) => j === agent.prefs[k])) return; // that is the truth
    result.tried++;
    const lied = { ...market, [side]: market[side].map((a, i) => (i === index ? { ...a, prefs: list } : a)) };
    const after = outcome(deferredAcceptance(lied, proposers));
    const pays = side === "candidates"
      ? after !== null && rank.has(after) && (before === null || rank.get(after) < rank.get(before))
      : compareHires(agent.prefs, agent.capacity, after, before) === 1;
    if (!pays) return;
    result.gains++;
    const c = cost(list);
    if (c < bestCost) { bestCost = c; result.best = { list, truthful: before, lying: after, dropped: c < 1000 ? c : null }; }
  };
  return {
    result,
    advance(n) {
      for (let k = 0; k < n; k++) {
        const step = lists.next();
        if (step.done) return true;
        tryOne(step.value);
      }
      return false;
    },
  };
}

/* ------------------------------------------------- enumeration (for checks) */

/**
 * Every stable matching of a small market, found the slow way: every way of giving each candidate one of the
 * employers it lists, or none, is tested against the definition. limit caps the number of assignments tried;
 * returns null if the market is larger than that.
 */
export function everyStableMatching(market, limit = 2000000) {
  let size = 1;
  for (const c of market.candidates) { size *= c.prefs.length + 1; if (size > limit) return null; }
  const out = [], matching = market.candidates.map(() => null);
  const load = market.employers.map(() => 0);
  const walk = (c) => {
    if (c === market.candidates.length) { if (checkMatching(market, matching).stable) out.push([...matching]); return; }
    matching[c] = null;
    walk(c + 1);
    for (const e of market.candidates[c].prefs) {
      if (load[e] >= market.employers[e].capacity) continue;
      matching[c] = e; load[e]++;
      walk(c + 1);
      load[e]--;
    }
    matching[c] = null;
  };
  walk(0);
  return out;
}

/* ---------------------------------------------------------------- examples */

/** Invented markets for the example buttons. The first is what the page opens with. */
export const EXAMPLES = [
  {
    label: "Six candidates, five positions",
    about: "An invented market. Acme and Birch have two positions each and Cobalt has one. Nobody lists Ben, and Asha and Ben each leave one employer off their lists.",
    candidates: "Asha: Cobalt, Acme\nBen: Birch, Acme\nChloe: Acme, Cobalt, Birch\nDev: Acme, Birch, Cobalt\nEsme: Birch, Acme, Cobalt\nFarid: Cobalt, Acme, Birch",
    employers: "Acme (2): Esme, Farid, Asha, Chloe, Dev\nBirch (2): Asha, Farid, Chloe, Dev, Esme\nCobalt: Chloe, Farid, Esme, Dev, Asha",
  },
  {
    label: "Opposite tastes",
    about: "An invented market with one position each, in which every employer's favourite ranks it last. It has three stable matchings.",
    candidates: "Asha: Acme, Birch, Cobalt\nBen: Birch, Cobalt, Acme\nChloe: Cobalt, Acme, Birch",
    employers: "Acme: Ben, Chloe, Asha\nBirch: Chloe, Asha, Ben\nCobalt: Asha, Ben, Chloe",
  },
  {
    label: "Everyone agrees",
    about: "An invented market in which all candidates rank the employers alike and all employers rank the candidates alike. It has one stable matching, whoever proposes.",
    candidates: "Asha: Acme, Birch, Cobalt\nBen: Acme, Birch, Cobalt\nChloe: Acme, Birch, Cobalt\nDev: Acme, Birch, Cobalt",
    employers: "Acme: Asha, Ben, Chloe, Dev\nBirch: Asha, Ben, Chloe, Dev\nCobalt (2): Asha, Ben, Chloe, Dev",
  },
  {
    label: "More candidates than positions",
    about: "An invented market: five candidates, one employer with two positions and one with a single position.",
    candidates: "Asha: Acme, Birch\nBen: Birch, Acme\nChloe: Acme, Birch\nDev: Acme\nEsme: Birch, Acme",
    employers: "Acme (2): Chloe, Ben, Asha, Esme, Dev\nBirch: Asha, Esme, Ben, Chloe",
  },
];
