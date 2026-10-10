// Day 7: Utilitarian Calculator. The model, with no DOM code.
//
// A model is { unit, seq, groups: [{ id, name, people, weight }],
//              options: [{ id, name, outcomes: [{ id, name, p, dw: { [groupId]: change per person } }] }] }.
// An option's expected utility is the sum over groups of weight x people x expected change per person.

import { fmt } from "../kit/kit.js";

export const TOL = 1e-6;
export const LIMITS = { groups: 6, options: 6, outcomes: 6 };

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/* ------------------------------------------------------------ building and editing */

/** makeModel({ unit, groups: [[name, people, weight]], options: [[name, [[outcome, p, [change for each group]]]]] }) */
export function makeModel({ unit = "wellbeing points", groups = [], options = [] } = {}) {
  const model = { unit, seq: 0, groups: [], options: [] };
  for (const [name, people, weight = 1] of groups) model.groups.push({ id: `g${++model.seq}`, name, people, weight });
  for (const [name, outcomes] of options) {
    const option = { id: `o${++model.seq}`, name, outcomes: [] };
    for (const [oname, p, changes] of outcomes) {
      option.outcomes.push({ id: `k${++model.seq}`, name: oname, p, dw: Object.fromEntries(model.groups.map((g, i) => [g.id, changes[i] ?? 0])) });
    }
    model.options.push(option);
  }
  return model;
}

export const clone = (model) => JSON.parse(JSON.stringify(model));

/** The smallest model that still shows a result: two groups, two options, one certain outcome each. */
export const blankModel = () => makeModel({
  groups: [["Group 1", 1, 1], ["Group 2", 1, 1]],
  options: [["Option 1", [["What happens", 1, [0, 0]]]], ["Option 2", [["What happens", 1, [0, 0]]]]],
});

// The editing functions change the model in place and return the new item (or nothing). Each keeps the
// invariant that every outcome has a wellbeing change for every group.
export function addGroup(model) {
  if (model.groups.length >= LIMITS.groups) return null;
  const g = { id: `g${++model.seq}`, name: `Group ${model.groups.length + 1}`, people: 1, weight: 1 };
  model.groups.push(g);
  for (const o of model.options) for (const k of o.outcomes) k.dw[g.id] = 0;
  return g;
}
export function removeGroup(model, id) {
  model.groups = model.groups.filter((g) => g.id !== id);
  for (const o of model.options) for (const k of o.outcomes) delete k.dw[id];
}
export function addOutcome(model, optionId) {
  const o = model.options.find((x) => x.id === optionId);
  if (!o || o.outcomes.length >= LIMITS.outcomes) return null;
  // A new outcome takes whatever probability is still unassigned, so a valid option stays valid.
  const left = Math.max(0, 1 - probabilitySum(o));
  const k = { id: `k${++model.seq}`, name: `Outcome ${o.outcomes.length + 1}`, p: Number(left.toFixed(6)), dw: Object.fromEntries(model.groups.map((g) => [g.id, 0])) };
  o.outcomes.push(k);
  return k;
}
export function removeOutcome(model, optionId, outcomeId) {
  const o = model.options.find((x) => x.id === optionId);
  if (o) o.outcomes = o.outcomes.filter((k) => k.id !== outcomeId);
}
export function addOption(model) {
  if (model.options.length >= LIMITS.options) return null;
  const o = { id: `o${++model.seq}`, name: `Option ${model.options.length + 1}`, outcomes: [] };
  model.options.push(o);
  addOutcome(model, o.id).name = "What happens";
  return o;
}
export function removeOption(model, id) {
  model.options = model.options.filter((o) => o.id !== id);
}

/* ------------------------------------------------------------------- probabilities */

/** Sum of an option's probabilities, counting anything that is not a number as zero. */
export const probabilitySum = (option) => option.outcomes.reduce((s, k) => s + (isNum(k.p) && k.p > 0 ? k.p : 0), 0);

/** Probabilities rescaled to sum to 1, keeping their ratios. If they sum to zero, every outcome gets an equal share. */
export function normalised(option) {
  const n = option.outcomes.length;
  const sum = probabilitySum(option);
  return option.outcomes.map((k) => (sum > 0 ? (isNum(k.p) && k.p > 0 ? k.p : 0) / sum : 1 / n));
}

/* --------------------------------------------------------------------- validation */

/**
 * general: problems that stop every result. byOption[id]: problems that keep one option out of the ranking,
 * as { messages, sum, canNormalise }.
 */
export function validate(model) {
  const general = [];
  const byOption = {};
  if (!model.groups.length) general.push("Add at least one group of people, or nobody's wellbeing is being counted.");
  for (const g of model.groups) {
    const name = g.name.trim() || "A group with no name";
    if (!isNum(g.people) || g.people < 0) general.push(`${name}: the number of people must be a number, zero or more.`);
    if (!isNum(g.weight) || g.weight < 0) general.push(`${name}: the moral weight must be a number, zero or more.`);
  }
  if (!model.options.length) general.push("Add at least one option to choose between.");
  for (const o of model.options) {
    const messages = [];
    const sum = probabilitySum(o);
    let canNormalise = false;
    if (!o.outcomes.length) messages.push("it has no outcomes, so add at least one");
    else {
      if (o.outcomes.some((k) => !isNum(k.p) || k.p < 0 || k.p > 1)) messages.push("every probability must be a number from 0 to 1");
      else if (Math.abs(sum - 1) > TOL) { messages.push(`its probabilities sum to ${fmt.sig(sum, 6)}, not 1`); canNormalise = true; }
      if (o.outcomes.some((k) => model.groups.some((g) => !isNum(k.dw[g.id])))) messages.push("every wellbeing change must be a number");
    }
    if (messages.length) byOption[o.id] = { messages, sum, canNormalise };
  }
  return { general, byOption };
}

/* --------------------------------------------------------------------- evaluation */

/** Expected wellbeing change for one person in a group if this option is chosen. */
export const expectedChange = (option, groupId) => option.outcomes.reduce((s, k) => s + k.p * k.dw[groupId], 0);

/**
 * Score every valid option. rows are in the order entered; ranked is best first (earlier option first on a tie).
 * Each row: { id, index, name, eu, groups: [{ id, perPerson, total, weighted }] } where
 *   perPerson = sum of p x change, total = perPerson x people, weighted = total x weight, eu = sum of weighted.
 */
export function evaluate(model) {
  const { general, byOption } = validate(model);
  const rows = [];
  if (!general.length) {
    model.options.forEach((o, index) => {
      if (byOption[o.id]) return;
      const groups = model.groups.map((g) => {
        const perPerson = expectedChange(o, g.id);
        const total = perPerson * g.people;
        return { id: g.id, perPerson, total, weighted: total * g.weight };
      });
      rows.push({ id: o.id, index, name: o.name, eu: groups.reduce((s, g) => s + g.weighted, 0), groups });
    });
  }
  const ranked = [...rows].sort((a, b) => (same(a.eu, b.eu) ? a.index - b.index : b.eu - a.eu));
  return {
    general, byOption, rows, ranked,
    best: ranked[0] || null,
    runnerUp: ranked[1] || null,
    tie: ranked.length > 1 && same(ranked[0].eu, ranked[1].eu),
  };
}

/** The same model with every moral weight set to 1: classical, unweighted utilitarianism. */
export function withEqualWeights(model) {
  const copy = clone(model);
  for (const g of copy.groups) g.weight = 1;
  return copy;
}

/* -------------------------------------------------------------------- sensitivity */

/**
 * Each option's score as a straight line in one group's weight: score = intercept + slope x weight.
 * The slope is that group's unweighted total change; the intercept is everything the other groups contribute.
 */
export function linesFor(rows, groupId) {
  return rows.map((r) => {
    const g = r.groups.find((x) => x.id === groupId);
    return { id: r.id, index: r.index, name: r.name, slope: g.total, intercept: r.eu - g.weighted };
  });
}

/**
 * Where the top option changes as one weight moves away from w0, solved exactly from the line crossings.
 * Returns { leader, above, below }: above is the nearest weight greater than or equal to w0 at which another option draws
 * level and then overtakes ({ at, to, name }), below the nearest one under w0 (and above zero). Either may be null.
 */
export function flips(lines, w0) {
  if (!lines.length) return null;
  const at = (l, w) => l.intercept + l.slope * w;
  let lead = lines[0];
  for (const l of lines) if (at(l, w0) > at(lead, w0) && !same(at(l, w0), at(lead, w0))) lead = l;
  let above = null, below = null;
  for (const l of lines) {
    if (l === lead || same(l.slope, lead.slope)) continue;
    const cross = (lead.intercept - l.intercept) / (l.slope - lead.slope);
    if (l.slope > lead.slope) {
      const w = Math.max(cross, w0);
      if (!above || w < above.at || (w === above.at && l.slope > above.slope)) above = { at: w, to: l.id, name: l.name, slope: l.slope };
    } else {
      const w = Math.min(cross, w0);
      if (w > 0 && (!below || w > below.at || (w === below.at && l.slope < below.slope))) below = { at: w, to: l.id, name: l.name, slope: l.slope };
    }
  }
  return { leader: lead.id, above, below };
}

/** How far a weight must move to reach a flip, as a share: 0 is "already there", 0.5 is a halving or a doubling. */
export const distance = (w0, w) => (Math.max(w0, w) > 0 ? 1 - Math.min(w0, w) / Math.max(w0, w) : 0);

/**
 * One row per group: { id, name, weight, lines, leader, above, below, distance }.
 * distance is the smaller of the two flips' distances, or Infinity when no weight for this group changes the choice.
 */
export function sensitivity(model, evaluation = evaluate(model)) {
  if (evaluation.general.length || !evaluation.rows.length) return [];
  return model.groups.map((g) => {
    const lines = linesFor(evaluation.rows, g.id);
    const f = flips(lines, g.weight);
    const d = Math.min(f.above ? distance(g.weight, f.above.at) : Infinity, f.below ? distance(g.weight, f.below.at) : Infinity);
    return { id: g.id, name: g.name, weight: g.weight, lines, ...f, distance: d };
  });
}

/** The group whose weight needs the smallest proportional change to flip the choice, or null if none can. */
export function mostFragile(rows) {
  const able = rows.filter((r) => Number.isFinite(r.distance));
  return able.length ? able.reduce((a, b) => (b.distance < a.distance ? b : a)) : null;
}

/* ------------------------------------------------------------------------ presets */

// Every number below is made up to make the structure of the argument concrete. None is an estimate.
export const PRESETS = [
  {
    key: "vaccine",
    label: "Vaccine doses",
    blurb: "A region has 20,000 doses of a flu vaccine before a hard winter. Give them to the oldest, to the care workers who look after them, or half to each? Wellbeing is counted in days of healthy life.",
    model: () => makeModel({
      unit: "healthy days",
      groups: [["Over-80s", 20000, 1], ["Care workers", 20000, 1], ["Everyone else", 400000, 1]],
      options: [
        ["Oldest first", [["Vaccine protects the frail well", 0.6, [12, 0, 0]], ["Weak protection in the frail", 0.4, [3, 0, 0]]]],
        ["Care workers first", [["Vaccine cuts transmission", 0.5, [8, 2.5, 0.15]], ["No effect on transmission", 0.5, [0, 2.5, 0]]]],
        ["Split the doses", [["Vaccine cuts transmission", 0.5, [9, 1.5, 0.09]], ["No effect on transmission", 0.5, [4.5, 1.5, 0]]]],
      ],
    }),
  },
  {
    key: "buslane",
    label: "Bus lane",
    blurb: "A city can turn one car lane on its main road into a bus lane. Bus passengers gain, drivers lose, and people living on the road gain or lose with the traffic. Wellbeing is counted in points on a 0 to 10 life-satisfaction scale.",
    model: () => makeModel({
      unit: "life-satisfaction points",
      groups: [["Bus passengers", 18000, 1], ["Drivers", 12000, 1], ["Residents on the road", 4000, 1]],
      options: [
        ["Leave the road as it is", [["No change", 1, [0, 0, 0]]]],
        ["Bus lane at peak hours", [["Some drivers switch to the bus", 0.6, [0.06, -0.03, 0.02]], ["Traffic backs up", 0.4, [0.04, -0.09, -0.02]]]],
        ["Bus lane all day", [["Some drivers switch to the bus", 0.5, [0.1, -0.06, 0.05]], ["Traffic backs up", 0.5, [0.07, -0.16, -0.04]]]],
      ],
    }),
  },
  {
    key: "future",
    label: "Future generations",
    blurb: "Cutting emissions costs people alive today and helps people who are not born yet. The weight on the second group is what economists call a discount factor. Wellbeing is counted in points on a 0 to 10 scale.",
    model: () => makeModel({
      unit: "wellbeing points",
      groups: [["People alive today", 8e9, 1], ["People alive in 2100", 1e10, 1]],
      options: [
        ["Carry on as now", [["No change", 1, [0, 0]]]],
        ["Cut emissions gradually", [["Climate proves very sensitive", 0.3, [-0.02, 0.3]], ["Climate is moderately sensitive", 0.7, [-0.02, 0.08]]]],
        ["Cut emissions fast", [["Climate proves very sensitive", 0.3, [-0.1, 0.8]], ["Climate is moderately sensitive", 0.7, [-0.1, 0.2]]]],
      ],
    }),
  },
  {
    key: "transmitter",
    label: "One against a billion",
    blurb: "T. M. Scanlon's transmitter room. A technician is trapped under fallen equipment, in pain, during a World Cup broadcast. Freeing him means cutting the picture for fifteen minutes for a billion viewers. Wellbeing is counted in points on a 0 to 10 scale.",
    model: () => makeModel({
      unit: "wellbeing points",
      groups: [["The technician", 1, 1], ["Viewers", 1e9, 1]],
      options: [
        ["Rescue him now", [["The broadcast is cut for fifteen minutes", 1, [0, -0.0001]]]],
        ["Wait until the match ends", [["An hour of painful shocks", 0.9, [-10, 0]], ["The shocks do lasting harm", 0.1, [-60, 0]]]],
      ],
    }),
  },
];
