// Day 29: Decision Tree Debater. The model, with no DOM code.
//
// A tree is nested nodes: { id, type, name, p, value, children }.
//   type "decision": you choose one child.           Worth the best child.
//   type "chance":   the world picks one child.      Worth the sum of child.p x child's worth.
//   type "end":      nothing more happens.           Worth node.value.
// node.name labels the branch leading into the node; node.p only matters when the parent is a chance node.
// The root is always a decision, and its children are "the options".

export const TOL = 1e-6;
export const LIMITS = { nodes: 60, depth: 6, children: 6, name: 80 };
export const TYPES = ["decision", "chance", "end"];

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const num = (x) => (isNum(x) ? x : NaN);

/* ----------------------------------------------------------------- walking the tree */

/** Visit every node, parents before children: fn(node, parent, depth). */
export function walk(root, fn, parent = null, depth = 0) {
  fn(root, parent, depth);
  for (const c of root.children) walk(c, fn, root, depth + 1);
}
export function find(root, id) {
  let hit = null;
  walk(root, (node, parent, depth) => { if (node.id === id) hit = { node, parent, depth }; });
  return hit;
}
export function size(root) {
  let nodes = 0, depth = 0, ends = 0;
  walk(root, (n, _p, d) => { nodes++; depth = Math.max(depth, d); if (n.type === "end") ends++; });
  return { nodes, depth, ends };
}

/* ------------------------------------------------- building, importing and editing */

/**
 * Turn any object into a clean tree with fresh ids, or throw an Error that says what is wrong with it.
 * Used for the examples, for trees saved in the browser and for imported files, so all three obey the same rules.
 * Numbers that are missing or not finite become NaN, which validate() then reports.
 */
export function sanitise(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("This is not a decision tree: expected an object with a type and children.");
  let seq = 0;
  const build = (raw, depth, isRoot) => {
    if (!raw || typeof raw !== "object") throw new Error("A branch in this tree is not an object.");
    if (++seq > LIMITS.nodes) throw new Error(`This tree has more than ${LIMITS.nodes} nodes, which is the most this page will draw.`);
    if (depth > LIMITS.depth) throw new Error(`This tree is more than ${LIMITS.depth} levels deep, which is the most this page will draw.`);
    const type = isRoot ? "decision" : raw.type;
    if (!TYPES.includes(type)) throw new Error(`A node has the type "${String(raw.type).slice(0, 20)}". It must be decision, chance or end.`);
    const node = { id: `n${seq}`, type, name: String(raw.name ?? "").slice(0, LIMITS.name), p: num(raw.p), value: num(raw.value), children: [] };
    if (type !== "end") {
      const kids = raw.children ?? [];
      if (!Array.isArray(kids)) throw new Error("The children of a node must be a list.");
      if (kids.length > LIMITS.children) throw new Error(`A node has more than ${LIMITS.children} branches, which is the most this page allows.`);
      node.children = kids.map((k) => build(k, depth + 1, false));
    }
    return node;
  };
  if (!isRootLike(input)) throw new Error("This is not a decision tree: the first node must be a decision with a list of children.");
  const root = build(input, 0, true);
  root.seq = seq;
  return root;
}
const isRootLike = (x) => (x.type === "decision" || x.type === undefined) && Array.isArray(x.children);

/** A copy fit for saving: no ids, and NaN written as null (which sanitise turns back into NaN). */
export function plain(node) {
  const out = { type: node.type, name: node.name };
  if (isNum(node.p)) out.p = node.p;
  if (node.type === "end") out.value = isNum(node.value) ? node.value : null;
  else out.children = node.children.map(plain);
  return out;
}

const fresh = (root, type, name, extra = {}) => ({ id: `n${++root.seq}`, type, name, p: NaN, value: NaN, children: [], ...extra });

/** Add an end point under a decision or chance node. A new chance branch takes whatever probability is unassigned. */
export function addChild(root, parentId) {
  const hit = find(root, parentId);
  if (!hit || hit.node.type === "end") return null;
  const { node, depth } = hit;
  if (node.children.length >= LIMITS.children || depth + 1 > LIMITS.depth || size(root).nodes >= LIMITS.nodes) return null;
  const left = Math.max(0, 1 - node.children.reduce((s, c) => s + (isNum(c.p) && c.p > 0 ? c.p : 0), 0));
  const child = fresh(root, "end", `${node.type === "chance" ? "Outcome" : "Option"} ${node.children.length + 1}`, { value: 0, p: node.type === "chance" ? Number(left.toFixed(6)) : NaN });
  node.children.push(child);
  return child;
}

/** Remove a node and everything under it. The root cannot be removed. */
export function removeNode(root, id) {
  const hit = find(root, id);
  if (!hit || !hit.parent) return false;
  hit.parent.children = hit.parent.children.filter((c) => c.id !== id);
  return true;
}

/**
 * Change what a node is, keeping the tree's value where that is possible:
 *   end -> decision or chance: two new end points, each worth what the node was worth;
 *   decision or chance -> end: the branches go, and the end point is worth what they rolled back to;
 *   decision <-> chance: the branches stay; a new chance node shares probability equally.
 */
export function setType(root, id, type) {
  const hit = find(root, id);
  if (!hit || !hit.parent || !TYPES.includes(type) || hit.node.type === type) return false;
  const { node, depth } = hit;
  if (type === "end") {
    const worth = validate(node).length ? NaN : rollback(node).values.get(node.id);
    node.children = [];
    node.value = isNum(worth) ? Number(worth.toPrecision(10)) : 0;
  } else if (node.type === "end") {
    if (depth + 1 > LIMITS.depth || size(root).nodes + 2 > LIMITS.nodes) return false;
    const label = type === "chance" ? "Outcome" : "Option";
    node.children = [1, 2].map((i) => fresh(root, "end", `${label} ${i}`, { value: node.value, p: type === "chance" ? 0.5 : NaN }));
    node.value = NaN;
  } else if (type === "chance") {
    for (const c of node.children) c.p = 1 / node.children.length;
  }
  node.type = type;
  return true;
}

/** Rescale a chance node's probabilities to sum to 1, keeping their ratios. All zero (or junk) becomes equal shares. */
export function normalise(root, chanceId) {
  const hit = find(root, chanceId);
  if (!hit || hit.node.type !== "chance" || !hit.node.children.length) return false;
  const kids = hit.node.children;
  const clean = kids.map((c) => (isNum(c.p) && c.p > 0 ? c.p : 0));
  const sum = clean.reduce((s, p) => s + p, 0);
  kids.forEach((c, i) => { c.p = sum > 0 ? clean[i] / sum : 1 / kids.length; });
  return true;
}

/* ------------------------------------------------------------------------ validation */

const label = (node) => (node.name.trim() ? `“${node.name.trim()}”` : "A node with no name");

/** Everything that stops the tree being rolled back: [{ id, message, sum? }]. sum is set when rescaling would fix it. */
export function validate(root) {
  const problems = [];
  walk(root, (node) => {
    if (node.type === "end") {
      if (!isNum(node.value)) problems.push({ id: node.id, message: `${label(node)}: the utility must be a number.` });
      return;
    }
    if (!node.children.length) {
      problems.push({ id: node.id, message: `${label(node)} has no branches. Add one, or turn it into an end point.` });
      return;
    }
    if (node.type === "chance") {
      if (node.children.some((c) => !isNum(c.p) || c.p < 0 || c.p > 1)) {
        problems.push({ id: node.id, message: `${label(node)}: every probability must be a number from 0 to 1.` });
      } else {
        const sum = node.children.reduce((s, c) => s + c.p, 0);
        if (Math.abs(sum - 1) > TOL) problems.push({ id: node.id, sum, message: `${label(node)}: the probabilities sum to ${Number(sum.toFixed(6))}, not 1.` });
      }
    }
  });
  return problems;
}

/* -------------------------------------------------------------------------- rollback */

// A one-way change to one number: { kind: "value", id, x } replaces an end point's utility;
// { kind: "p", id, x } sets one chance branch to x and rescales its siblings to share 1 - x in their current ratios
// (equally, if they are all zero now).
function probabilities(node, over) {
  const ps = node.children.map((c) => c.p);
  if (!over || over.kind !== "p") return ps;
  const i = node.children.findIndex((c) => c.id === over.id);
  if (i < 0 || ps.length < 2) return ps;
  const rest = 1 - ps[i];
  return ps.map((p, j) => (j === i ? over.x : rest > 1e-12 ? (p * (1 - over.x)) / rest : (1 - over.x) / (ps.length - 1)));
}

/** What a node is worth, optionally with one number changed. best (a Map) collects each decision's chosen child. */
export function worth(node, over = null, values = null, best = null) {
  let v;
  if (node.type === "end") v = over && over.kind === "value" && over.id === node.id ? over.x : node.value;
  else {
    const kids = node.children.map((c) => worth(c, over, values, best));
    if (node.type === "decision") {
      let top = 0;
      for (let i = 1; i < kids.length; i++) if (kids[i] > kids[top]) top = i; // the earlier branch wins a tie
      v = kids.length ? kids[top] : NaN;
      if (best && kids.length) best.set(node.id, node.children[top].id);
    } else {
      const ps = probabilities(node, over);
      v = kids.length ? kids.reduce((s, k, i) => s + ps[i] * k, 0) : NaN;
    }
  }
  if (values) values.set(node.id, v);
  return v;
}

/**
 * Roll the tree back from its end points. Returns
 *   values: Map id -> expected utility of every node,
 *   best:   Map decision id -> id of the child to choose,
 *   plan:   Set of ids that can be reached if every decision is taken as recommended.
 */
export function rollback(root) {
  const values = new Map(), best = new Map(), plan = new Set();
  worth(root, null, values, best);
  const mark = (node) => {
    plan.add(node.id);
    if (node.type === "decision") { const c = node.children.find((k) => k.id === best.get(node.id)); if (c) mark(c); }
    else for (const c of node.children) mark(c);
  };
  mark(root);
  return { values, best, plan, value: values.get(root.id) };
}

/** The later decisions on the recommended plan, in order: [{ at: node, choose: child }]. The first is the root. */
export function planSteps(root, result = rollback(root)) {
  const steps = [];
  walk(root, (node) => {
    if (node.type === "decision" && result.plan.has(node.id) && node.children.length) steps.push({ at: node, choose: node.children.find((c) => c.id === result.best.get(node.id)) });
  });
  return steps;
}

/* ----------------------------------------------------------------------- sensitivity */

/**
 * Every number that can be varied on its own: each end point's utility, and each probability that has a sibling.
 * A chance node with two branches has one free probability, not two (the second is 1 minus the first), so only its
 * first branch is listed.
 */
export function parameters(root) {
  const list = [];
  walk(root, (node, parent) => {
    if (!parent) return;
    const free = parent.type === "chance" && parent.children.length > 1 && (parent.children.length > 2 || parent.children[0] === node);
    if (free) list.push({ key: `p:${node.id}`, kind: "p", id: node.id, name: node.name, under: parent.name, now: node.p });
    if (node.type === "end") list.push({ key: `value:${node.id}`, kind: "value", id: node.id, name: node.name, under: parent.name, now: node.value });
  });
  return list;
}

/** Smallest and largest utility among the end points. */
export function spread(root) {
  let lo = Infinity, hi = -Infinity;
  walk(root, (n) => { if (n.type === "end") { lo = Math.min(lo, n.value); hi = Math.max(hi, n.value); } });
  return { lo, hi, range: hi - lo };
}

// h(lo) <= 0 < h(hi) (in either order along the axis). Close in on the edge of the region where h > 0.
// If that edge is the starting value itself (the options are level now), return the starting value exactly.
function bisect(h, lo, hi) {
  const start = lo;
  for (let i = 0; i < 200 && Math.abs(hi - lo) > 1e-13 * Math.max(1, Math.abs(lo), Math.abs(hi)); i++) {
    const mid = (lo + hi) / 2;
    if (h(mid) > 0) hi = mid; else lo = mid;
  }
  return lo === start ? start : hi;
}

/**
 * Where the recommended first choice changes as one number moves and everything else stays put.
 *
 * The number sits under exactly one option A, so only A's expected utility f(x) moves; the best of the other options, M,
 * is a constant. f is piecewise linear (a maximum of straight lines at each later decision, averaged at each chance
 * node) and it only ever moves one way as x rises: a utility can only pull every node above it up, and a probability
 * moves its own chance node along a straight line, which the nodes above pass on without reversing. So f crosses M at
 * most once, the far end of the range tells us on which side, and bisection finds the crossing to about one part in
 * 10^13.
 *
 * Returns { leader, option, below, above }: leader is the root child chosen now, option the root child the number sits
 * under, and below / above are { at, to } (to = the root child chosen beyond that value) or null. At most one is set.
 */
export function thresholds(root, param) {
  const options = root.children;
  const a = options.findIndex((o) => find(o, param.id));
  const base = options.map((o) => worth(o));
  let lead = 0;
  for (let i = 1; i < base.length; i++) if (base[i] > base[lead]) lead = i;
  const none = { leader: options[lead]?.id ?? null, option: options[a]?.id ?? null, below: null, above: null };
  if (a < 0 || options.length < 2) return none;
  let rival = -1;
  base.forEach((v, i) => { if (i !== a && (rival < 0 || v > base[rival])) rival = i; });
  const M = base[rival];
  const leads = lead === a;
  const to = options[leads ? rival : a].id;
  // h > 0 exactly where the choice differs from today's. When A and its rival are exactly level the earlier branch is
  // chosen, as everywhere else on the page, so a dead heat counts as a change only if it hands the choice over.
  const h = (x) => {
    const g = worth(options[a], { kind: param.kind, id: param.id, x }) - M;
    if (g === 0) return (leads ? rival < a : a < rival) ? 1 : -1;
    return leads ? -g : g;
  };
  const x0 = param.now;
  const out = { ...none };

  if (param.kind === "p") {
    for (const [side, end] of [["below", 0], ["above", 1]]) if (end !== x0 && h(end) > 0) out[side] = { at: bisect(h, x0, end), to };
    return out;
  }

  // A utility: f never falls as x rises, so A can only lose its lead by x falling, and can only gain it by x rising.
  const dir = leads ? -1 : 1;
  const side = leads ? "below" : "above";
  const scale = Math.max(1, Math.abs(x0), Math.abs(M - base[a]), spread(root).range);
  let prev = x0, hPrev = h(x0);
  for (let k = 0; k < 60; k++) {
    const x = x0 + dir * scale * (2 ** k - 0.5);
    const hx = h(x);
    if (hx > 0) { out[side] = { at: bisect(h, prev, x), to }; break; }
    // Falling x: f is convex and never falls as x rises, so once it is flat it stays flat and no lower value will cross.
    if (leads && hx === hPrev) break;
    prev = x; hPrev = hx;
  }
  return out;
}

/**
 * Every parameter with its flip points, most fragile first. distance is how far the number must move as a share of its
 * scale: for a probability, the change in probability; for a utility, the change divided by the gap between the best
 * and worst end points. Parameters that cannot flip the choice have distance Infinity and come last.
 */
export function sensitivity(root) {
  const range = spread(root).range || 1;
  const rows = parameters(root).map((p) => {
    const t = thresholds(root, p);
    const flips = [t.below, t.above].filter(Boolean).map((f) => ({ ...f, distance: Math.abs(f.at - p.now) / (p.kind === "p" ? 1 : range) }));
    flips.sort((x, y) => x.distance - y.distance);
    return { ...p, ...t, nearest: flips[0] || null, distance: flips.length ? flips[0].distance : Infinity };
  });
  return rows.sort((x, y) => x.distance - y.distance);
}

/** Each option's expected utility as one number runs from lo to hi: { xs, series: [{ id, name, ys }] }. */
export function curve(root, param, lo, hi, steps = 200) {
  const xs = Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps);
  return {
    xs,
    series: root.children.map((o) => {
      const inside = Boolean(find(o, param.id));
      const flat = inside ? null : worth(o);
      return { id: o.id, name: o.name, ys: xs.map((x) => (inside ? worth(o, { kind: param.kind, id: param.id, x }) : flat)) };
    }),
  };
}

/* --------------------------------------------------------------------------- presets */

const D = (name, ...children) => ({ type: "decision", name, children });
const C = (name, ...children) => ({ type: "chance", name, children });
const E = (name, value) => ({ type: "end", name, value });
const P = (p, node) => ({ ...node, p });

// Utilities are on a 0 to 100 scale chosen by whoever is deciding. Every number is made up for illustration.
export const PRESETS = [
  {
    key: "job",
    label: "A job offer",
    blurb: "A start-up offers you a job. It pays less than your steady job now but comes with shares. If the company takes off you will have a second choice: hold the shares or sell them. Utilities are how good each ending would be for you, from 0 to 100.",
    tree: () => sanitise(D("Take the start-up job?",
      C("Accept the offer",
        P(0.3, D("The start-up takes off",
          C("Hold the shares", P(0.5, E("It floats on the stock market", 100)), P(0.5, E("Growth stalls", 55))),
          E("Sell the shares early", 80))),
        P(0.7, E("The start-up folds", 30))),
      C("Stay where you are", P(0.6, E("Promoted within two years", 65)), P(0.4, E("Passed over", 40))))),
  },
  {
    key: "insurance",
    label: "Buying insurance",
    blurb: "Insure your home against flooding, or keep the premium? On expected money the insurer wins, or it would not offer the policy, so the case for buying rests on how much worse ruin is than a bill. Utilities run from 0 (ruin) to 100 (nothing lost).",
    tree: () => sanitise(D("Insure the house against flooding?",
      E("Buy the policy", 98),
      C("Go without",
        P(0.03, D("A flood, and no cover",
          E("Borrow to rebuild", 25),
          C("Sell the house as it stands", P(0.5, E("A fair price", 40)), P(0.5, E("A fire sale", 5))))),
        P(0.97, E("No flood: nothing lost", 100))))),
  },
  {
    key: "medical",
    label: "A medical choice",
    blurb: "An operation now, or wait and see? Waiting keeps a later operation open if things get worse, at worse odds. Utilities run from 0 (death) to 100 (full health). The numbers are invented and are not medical advice.",
    tree: () => sanitise(D("Have the operation now?",
      C("Operate now", P(0.85, E("Full recovery", 95)), P(0.1, E("Complications, partial recovery", 55)), P(0.05, E("Death in surgery", 0))),
      C("Wait and monitor",
        P(0.7, E("The condition stays stable", 90)),
        P(0.3, D("The condition gets worse",
          C("Operate late", P(0.75, E("Recovery, with lasting damage", 70)), P(0.25, E("Death in surgery", 0))),
          E("Manage the symptoms", 45)))))),
  },
];

/** The smallest tree that still poses a choice: two options, each a certain end point. */
export const blankTree = () => sanitise(D("What should I do?", E("Option 1", 0), E("Option 2", 0)));
