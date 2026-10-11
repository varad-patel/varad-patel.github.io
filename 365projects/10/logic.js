// Day 10: Ship of Theseus Simulator. The model, with no DOM code.
// A 46-part galley, an order of replacement, a weight for each part, the similarity of each stage to the
// original, and the step at which each view of identity says the ship stops being the same.

import { rng } from "../kit/kit.js";

/** Kinds of part, listed from the first to wear out to the last. `base` is the importance of one such part, with a plank as 1. */
export const KINDS = [
  { key: "oar", label: "oar", count: 15, base: 0.5 },
  { key: "sail", label: "sail", count: 1, base: 5 },
  { key: "steer", label: "steering oar", count: 1, base: 2 },
  { key: "yard", label: "yard", count: 1, base: 2 },
  { key: "plank", label: "plank", count: 24, base: 1 },
  { key: "mast", label: "mast", count: 1, base: 8 },
  { key: "stem", label: "stem post", count: 1, base: 5 },
  { key: "stern", label: "stern post", count: 1, base: 5 },
  { key: "keel", label: "keel", count: 1, base: 20 },
];

/** The parts, with ids 0 to 45 in wear order. `index` counts within a kind. */
export const PARTS = KINDS.flatMap((k) => Array.from({ length: k.count }, (_, index) => ({ kind: k.key, index, base: k.base, label: k.count > 1 ? `${k.label} ${index + 1}` : `the ${k.label}` })))
  .map((p, id) => ({ id, ...p }));
export const N = PARTS.length;
const EPS = 1e-9;

/** Weight of every part: base importance raised to the power gamma. gamma 0 makes all parts equal; gamma 1 uses the base values. */
export function weights(gamma = 1) {
  const g = Number.isFinite(gamma) ? Math.min(3, Math.max(0, gamma)) : 1;
  return PARTS.map((p) => p.base ** g);
}

export const ORDERS = [
  { value: "wear", label: "Worn parts first, keel last" },
  { value: "frame", label: "Keel and frame first" },
  { value: "random", label: "Random" },
];

/** An order of replacement: an array of part ids. Unknown names fall back to wear order. */
export function makeOrder(name = "wear", seed = 1) {
  const ids = PARTS.map((p) => p.id);
  if (name === "frame") return ids.reverse();
  if (name === "random") return rng(seed).shuffle(ids);
  return ids;
}

export const isOrder = (order) => Array.isArray(order) && order.length === N && new Set(order).size === N && order.every((id) => Number.isInteger(id) && id >= 0 && id < N);

/** Make `id` the next part to be replaced after `t` replacements. Returns the order unchanged if that part has already gone. */
export function promote(order, t, id) {
  const at = order.indexOf(id);
  if (at < t || at < 0) return order;
  return [...order.slice(0, t), id, ...order.slice(t).filter((x) => x !== id)];
}

/**
 * The ship after each replacement. Row t (0 to 46) has:
 *   part      id of the part replaced at this step (null at t = 0)
 *   count     share of parts that are original
 *   weighted  share of weight that is original
 *   step      share of the whole ship, by weight, that this one replacement changed
 */
export function trajectory(order, w = weights(1)) {
  if (!isOrder(order)) throw new RangeError("order must list every part exactly once");
  if (!Array.isArray(w) || w.length !== N || !w.every((x) => Number.isFinite(x) && x > 0)) throw new RangeError("weights must be one positive number per part");
  const total = w.reduce((s, x) => s + x, 0);
  const rows = [{ t: 0, part: null, count: 1, weighted: 1, step: 0 }];
  let gone = 0;
  order.forEach((id, i) => {
    gone += w[id];
    rows.push({ t: i + 1, part: id, count: (N - i - 1) / N, weighted: i === N - 1 ? 0 : Math.max(0, 1 - gone / total), step: w[id] / total });
  });
  return rows;
}

/**
 * The views of identity compared on the page. Only two are positions that go by these names in the literature
 * (own: false). The other five are simple rules written for this page, each standing in for a family of answers.
 */
export const VIEWS = [
  { key: "essentialism", name: "Mereological essentialism", own: false, gloss: "A thing has its parts essentially. Change any one and, strictly, it is a different thing." },
  { key: "count", name: "Majority of original parts", own: true, gloss: "The same ship while more than half of its parts, counted one by one, are original." },
  { key: "weighted", name: "Majority of original matter", own: true, gloss: "The same ship while more than half of its weight is original." },
  { key: "keel", name: "An essential core", own: true, gloss: "Some parts are essential and the rest are not. The ship is wherever its keel is." },
  { key: "continuity", name: "Gradual continuity", own: true, gloss: "The same ship as long as no single change replaces half of it or more." },
  { key: "form", name: "Same form and function", own: true, gloss: "Identity follows the design and the work the ship does, not the timber." },
  { key: "fourD", name: "Four-dimensionalism", own: false, gloss: "A ship is spread through time as it is through space, and its stages are parts of it. Which stages make up one ship is a further question, so this view has no step of its own." },
];

/** The step at which each threshold view says the ship stops being the same (null: never). */
export function breaks(traj) {
  const first = (test) => traj.find((r) => r.t > 0 && test(r))?.t ?? null;
  return {
    essentialism: 1,
    count: first((r) => r.count <= 0.5 + EPS),
    weighted: first((r) => r.weighted <= 0.5 + EPS),
    keel: first((r) => PARTS[r.part].kind === "keel"),
    continuity: first((r) => r.step >= 0.5 - EPS),
    form: null,
  };
}

/** The largest share of the ship, by weight, changed by any one replacement: { step, t, part }. */
export function roughest(traj) {
  return traj.reduce((best, r) => (r.step > best.step ? r : best), traj[0]);
}

/**
 * Which views a mark agrees with. mark is a step from 1 to 46, "never", or null.
 *   kind "none"   no mark yet
 *   kind "never"  views that say the ship never stops being the same
 *   kind "match"  the two majority views when their break is within `tol` replacements of the mark, and the views tied to
 *                 a single event (the first change, the keel, one over-large step) only when the mark is on that very step
 *   kind "own"    no view breaks near the mark
 * gap is mark minus the view's break.
 */
export function matchMark(mark, b, tol = 2) {
  if (mark === "never") return { kind: "never", views: [{ key: "form", gap: null }, ...(b.continuity == null ? [{ key: "continuity", gap: null }] : [])] };
  if (!Number.isInteger(mark) || mark < 1 || mark > N) return { kind: "none", views: [] };
  const views = [];
  for (const key of ["essentialism", "keel", "continuity"]) if (b[key] === mark) views.push({ key, gap: 0 });
  for (const key of ["count", "weighted"]) if (b[key] != null && Math.abs(mark - b[key]) <= tol) views.push({ key, gap: mark - b[key] });
  views.sort((x, y) => Math.abs(x.gap) - Math.abs(y.gap));
  return { kind: views.length ? "match" : "own", views };
}

/**
 * Whether a mark and an answer to Hobbes's question clash. A mark at a step says the repaired ship stopped being
 * the ship of Theseus there, so it clashes with any answer on which the repaired ship is that ship ("both" included).
 */
export function hobbesTension(mark, answer) {
  if (mark == null || !answer) return false;
  if (answer === "repaired" || answer === "both") return mark !== "never";
  if (answer === "rebuilt" || answer === "neither") return mark === "never";
  return false;
}

/** The parts in `ids`, in words and by kind: ["all 15 oars", "the sail", "3 of 24 planks"]. The text equivalent of the drawing. */
export function describeParts(ids) {
  const has = new Set(ids);
  return KINDS.map((k) => {
    const n = PARTS.filter((p) => p.kind === k.key && has.has(p.id)).length;
    return !n ? null : k.count === 1 ? `the ${k.label}` : n === k.count ? `all ${n} ${k.label}s` : `${n} of ${k.count} ${k.label}s`;
  }).filter(Boolean);
}

/** The smallest gamma, to two decimals, at which replacing the keel alone changes half the ship. */
export function keelTippingGamma() {
  for (let g = 0; g <= 3.0001; g += 0.01) {
    const w = weights(g);
    if (w[N - 1] / w.reduce((s, x) => s + x, 0) >= 0.5) return Math.round(g * 100) / 100;
  }
  return null;
}
