// Day 11: Philosophy Knowledge Graph. Graph algorithms with no DOM code.

/** Eras by year of birth. */
export const ERAS = [
  { key: "all", label: "All eras", from: -Infinity, to: Infinity },
  { key: "ancient", label: "Ancient (born before 500)", from: -Infinity, to: 500 },
  { key: "medieval", label: "Medieval (500 to 1499)", from: 500, to: 1500 },
  { key: "early", label: "Early modern (1500 to 1799)", from: 1500, to: 1800 },
  { key: "c19", label: "Born 1800 to 1899", from: 1800, to: 1900 },
  { key: "c20", label: "Born 1900 or later", from: 1900, to: Infinity },
];

/**
 * Turn the data file into adjacency lists.
 * influencers[i]: the people i was influenced by. influenced[i]: the people who were influenced by i.
 */
export function build(data) {
  const n = data.people.length;
  const g = {
    n,
    name: data.people.map((p) => p[0]), born: data.people.map((p) => p[1]), died: data.people.map((p) => p[2]),
    // How exactly each date is known: 9 a year, 8 a decade, 7 a century. Only rows with a vague date carry these.
    bornPrec: data.people.map((p) => p[6] ?? 9), diedPrec: data.people.map((p) => p[7] ?? 9),
    links: data.people.map((p) => p[3]), about: data.people.map((p) => p[4]), qid: data.people.map((p) => p[5]),
    influencers: Array.from({ length: n }, () => []), influenced: Array.from({ length: n }, () => []),
    edges: data.edges.length,
  };
  for (const [a, b] of data.edges) { g.influencers[a].push(b); g.influenced[b].push(a); }
  return g;
}

/**
 * PageRank by power iteration. A link runs from each thinker to the people they were influenced by,
 * so standing flows towards influencers. A thinker with no recorded influences spreads their standing
 * evenly over everyone (the usual treatment of dangling nodes). Scores sum to 1.
 */
export function pagerank(g, { damping = 0.85, maxIterations = 2000, tolerance = 1e-12 } = {}) {
  const n = g.n;
  let rank = new Float64Array(n).fill(1 / n);
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const next = new Float64Array(n);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      const out = g.influencers[i];
      if (!out.length) { dangling += rank[i]; continue; }
      const share = rank[i] / out.length;
      for (const j of out) next[j] += share;
    }
    const base = (1 - damping) / n + (damping * dangling) / n;
    let change = 0;
    for (let i = 0; i < n; i++) { next[i] = base + damping * next[i]; change += Math.abs(next[i] - rank[i]); }
    rank = next;
    if (change < tolerance) { iterations++; break; }
  }
  return { scores: rank, iterations };
}

/** Indexes ordered by score, best first, optionally limited to an era. */
export function ranking(g, scores, eraKey = "all") {
  const era = ERAS.find((e) => e.key === eraKey) || ERAS[0];
  const ids = [];
  for (let i = 0; i < g.n; i++) {
    if (era.key !== "all" && (g.born[i] == null || g.born[i] < era.from || g.born[i] >= era.to)) continue;
    ids.push(i);
  }
  return ids.sort((a, b) => scores[b] - scores[a] || g.name[a].localeCompare(g.name[b]));
}

/**
 * Position (1 = top) of every thinker in the overall ranking. Thinkers with exactly the same score share the
 * best position among them (1, 2, 2, 4), so that nobody is placed above an equal by the alphabet.
 */
export function positions(g, scores) {
  const pos = new Array(g.n);
  const order = ranking(g, scores);
  order.forEach((i, k) => { pos[i] = k > 0 && scores[i] === scores[order[k - 1]] ? pos[order[k - 1]] : k + 1; });
  return pos;
}

/** Everyone reachable from i by following links in one direction ("influenced" = downstream, "influencers" = upstream). */
export function reach(g, i, direction = "influenced") {
  const seen = new Set([i]);
  const queue = [i];
  while (queue.length) {
    const v = queue.shift();
    for (const w of g[direction][v]) if (!seen.has(w)) { seen.add(w); queue.push(w); }
  }
  seen.delete(i);
  return seen;
}

/** Shortest chain of influence from `from` down to `to`: [from, ..., to] where each influenced the next. null if none. */
export function chain(g, from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const v = queue.shift();
    for (const w of g.influenced[v]) {
      if (prev.has(w)) continue;
      prev.set(w, v);
      if (w === to) {
        const path = [to];
        while (prev.get(path[0]) !== -1) path.unshift(prev.get(path[0]));
        return path;
      }
      queue.push(w);
    }
  }
  return null;
}

// Letters that are not a plain letter plus an accent, so that "Soren", "Kolakowski" and "Ricoeur" find their thinkers.
const PLAIN = { "\u00f8": "o", "\u0142": "l", "\u0111": "d", "\u0153": "oe", "\u00e6": "ae", "\u00df": "ss", "\u0131": "i", "\u00f0": "d", "\u00fe": "th" };
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f\u02b9\u2018\u2019']/g, "").toLowerCase().replace(/[\u00f8\u0142\u0111\u0153\u00e6\u00df\u0131\u00f0\u00fe]/g, (c) => PLAIN[c]);

/** Edit distance between two strings (insertions, deletions, substitutions), stopping early once it exceeds `max`. */
export function editDistance(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (next[j] < best) best = next[j];
    }
    if (best > max) return max + 1;
    row = next;
  }
  return row[b.length];
}

/**
 * Thinkers whose name contains the query (accents and case ignored), best ranked first. If no name contains it,
 * the nearest spellings are returned instead: names, or single words of names, within one edit for every four
 * letters typed (at most three), closest first. So "Nietzche" still finds Nietzsche.
 */
export function search(g, query, order, limit = 8) {
  const q = fold(query.trim());
  if (!q) return [];
  const hits = [];
  for (const i of order) {
    const name = fold(g.name[i]);
    if (name.includes(q)) hits.push({ i, starts: name.startsWith(q) || name.split(/[\s-]/).some((w) => w.startsWith(q)) });
  }
  if (hits.length) return hits.sort((a, b) => Number(b.starts) - Number(a.starts)).slice(0, limit).map((h) => h.i);
  const max = Math.min(3, Math.floor(q.length / 4));
  if (!max) return [];
  const near = [];
  for (const i of order) {
    const name = fold(g.name[i]);
    const d = Math.min(...[name, ...name.split(/[\s-]/)].map((w) => editDistance(q, w, max)));
    if (d <= max) near.push({ i, d });
  }
  return near.sort((a, b) => a.d - b.d).slice(0, limit).map((h) => h.i);
}

/** True when the text is the start of more than one name ("Alain", "Alain Badiou"), so someone typing it may not have finished. */
export function unfinished(g, text) {
  const q = fold(text.trim());
  return q !== "" && g.name.filter((x) => fold(x).startsWith(q)).length > 1;
}

/** Exact name lookup (accents and case ignored). -1 if absent. */
export function find(g, name) {
  const q = fold(name.trim());
  return g.name.findIndex((x) => fold(x) === q);
}

const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;

/**
 * Years as people write them. The data uses astronomical years (0 is 1 BC, -383 is 384 BC).
 * "384 to 322 BC", "4 BC to AD 65", "1724 to 1804", "born 1947", "".
 * A date known only to the decade (precision 8) or the century (7) is stored as the middle year of that span
 * and written as the span: "420s to 340s BC", "129 to 3rd century", "first decade BC to AD 65".
 */
export function years(born, died, bornPrec = 9, diedPrec = 9) {
  const one = (y, prec) => {
    const bc = y <= 0, h = bc ? 1 - y : y;
    if (prec === 8) return h < 10 ? `first decade ${bc ? "BC" : "AD"}` : `${Math.floor(h / 10) * 10}s${bc ? " BC" : ""}`;
    if (prec === 7) return `${ordinal(Math.ceil(h / 100))} century${bc ? " BC" : ""}`;
    return bc ? `${h} BC` : String(h);
  };
  if (born == null && died == null) return "";
  if (born == null) return `died ${one(died, diedPrec)}`;
  if (died == null) return `born ${one(born, bornPrec)}`;
  const from = one(born, bornPrec), to = one(died, diedPrec);
  if (from === to) return from;
  if (born <= 0 && died <= 0) return `${from.replace(/ BC$/, "")} to ${to}`;
  if (born <= 0) return `${from} to ${diedPrec === 9 ? "AD " : ""}${to}`;
  return `${from} to ${to}`;
}

/** The years of person i in the graph. */
export const lifespan = (g, i) => years(g.born[i], g.died[i], g.bornPrec[i], g.diedPrec[i]);

/**
 * A year on a time axis that has no year 0, as historians count: 384 BC is -384 and AD 65 is 65, so that a tick
 * at -500 is 500 BC exactly. (Astronomical -383 becomes -384; years after 1 BC are unchanged.)
 */
export const axisYear = (y) => (y <= 0 ? y - 1 : y);
/** The label for a value on that axis. 0 itself is the boundary between 1 BC and AD 1. */
export const axisYearLabel = (v) => (v < 0 ? `${Math.round(-v)} BC` : v === 0 ? "BC | AD" : String(Math.round(v)));
