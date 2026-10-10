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
export function pagerank(g, { damping = 0.85, maxIterations = 200, tolerance = 1e-12 } = {}) {
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

/** Position (1 = top) of every thinker in the overall ranking. */
export function positions(g, scores) {
  const pos = new Array(g.n);
  ranking(g, scores).forEach((i, k) => { pos[i] = k + 1; });
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

const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Thinkers whose name contains the query (accents and case ignored), best ranked first. */
export function search(g, query, order, limit = 8) {
  const q = fold(query.trim());
  if (!q) return [];
  const hits = [];
  for (const i of order) {
    const name = fold(g.name[i]);
    if (name.includes(q)) hits.push({ i, starts: name.startsWith(q) || name.split(/[\s-]/).some((w) => w.startsWith(q)) });
  }
  return hits.sort((a, b) => Number(b.starts) - Number(a.starts)).slice(0, limit).map((h) => h.i);
}

/** Exact name lookup (accents and case ignored). -1 if absent. */
export function find(g, name) {
  const q = fold(name.trim());
  return g.name.findIndex((x) => fold(x) === q);
}

/**
 * Years as people write them. The data uses astronomical years (0 is 1 BC, -383 is 384 BC).
 * "428 to 348 BC", "1724 to 1804", "born 1947", "".
 */
export function years(born, died) {
  const one = (y) => (y <= 0 ? `${1 - y} BC` : String(y));
  if (born == null && died == null) return "";
  if (born == null) return `died ${one(died)}`;
  if (died == null) return `born ${one(born)}`;
  if (born <= 0 && died <= 0) return `${1 - born} to ${1 - died} BC`;
  return `${one(born)} to ${one(died)}`;
}
