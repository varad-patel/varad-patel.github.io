// Day 16: Argument Map Builder. The model, with no DOM code.
//
// An argument map is a directed acyclic graph of claims. Support is structured: a claim may have
// several reasons; each reason is a set of premises that work together (linked); separate reasons
// support the claim independently (convergent). A claim with no reasons is a premise.
//
//   map = { title, conclusion: id, claims: [{ id, text, unstated }], reasons: [{ id, claim, premises: [id] }] }

export const FORMAT = "365-argument-map";
export const LIMITS = { claims: 60, text: 240, sets: 2000 };

const preset = (key, label, title, texts, reasons, unstated = []) => ({
  key, label,
  map: {
    title, conclusion: "c1",
    claims: texts.map((text, i) => ({ id: `c${i + 1}`, text, unstated: unstated.includes(i + 1) })),
    reasons: reasons.map(([claim, ...premises], i) => ({ id: `r${i + 1}`, claim: `c${claim}`, premises: premises.map((p) => `c${p}`) })),
  },
});

/** Each reason is [claim, ...premises] by claim number. Claim 1 is the main conclusion. */
export const PRESETS = [
  preset("charge", "A policy argument with two lines of support", "The case for a congestion charge", [
    "The city should introduce a congestion charge.",
    "A charge would cut traffic in the centre.",
    "Less traffic means cleaner air and safer streets.",
    "The city should protect residents' health where it can.",
    "A charge would raise money for public transport.",
    "Better public transport is worth more to residents than the charge costs them.",
    "People drive less when driving costs more.",
    "The charge can be enforced cheaply and reliably.",
    "Enough drivers would still pay to raise real revenue.",
    "The revenue would be ring-fenced for buses and trains.",
  ], [[1, 2, 3, 4], [1, 5, 6], [2, 7, 8], [5, 8, 9, 10]]),
  preset("syllogism", "A classic syllogism", "Socrates", [
    "Socrates is mortal.",
    "All humans are mortal.",
    "Socrates is a human.",
  ], [[1, 2, 3]]),
  preset("hidden", "An argument with a hidden premise", "Minimum wages and jobs", [
    "Raising the minimum wage will cost low-paid workers their jobs.",
    "A higher minimum wage makes low-paid workers more expensive to employ.",
    "Employers respond to dearer labour by employing fewer people, not by accepting lower profits, raising prices or reorganising work.",
  ], [[1, 2, 3]], [3]),
];

/* ------------------------------------------------------------------ structure */

const clone = (map) => structuredClone(map);
const byId = (map) => new Map(map.claims.map((c) => [c.id, c]));
export const cleanText = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.text);
const short = (text, n = 48) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const nextId = (items, prefix) => `${prefix}${Math.max(0, ...items.map((x) => Number(String(x.id).slice(prefix.length)) || 0)) + 1}`;

/** Map from claim id to the reasons given for it (an empty list for a premise). */
export function reasonsByClaim(map) {
  const out = new Map(map.claims.map((c) => [c.id, []]));
  for (const r of map.reasons) out.get(r.claim)?.push(r);
  return out;
}

/** Ids of the premises: the claims that are asserted without a reason. */
export function premisesOf(map) {
  const by = reasonsByClaim(map);
  return map.claims.filter((c) => !by.get(c.id).length).map((c) => c.id);
}

/** Every claim the target rests on, directly or through other claims (the target itself included). */
export function restsOn(map, target = map.conclusion) {
  const by = reasonsByClaim(map);
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id) || !by.has(id)) return;
    seen.add(id);
    for (const r of by.get(id)) r.premises.forEach(visit);
  };
  visit(target);
  return seen;
}

/** A circular chain of support as a list of ids [a, b, ..., a] where each rests on the next, or null. */
export function findCycle(map) {
  const by = reasonsByClaim(map);
  const state = new Map(); // 1 = on the current path, 2 = finished
  const path = [];
  const visit = (id) => {
    if (state.get(id) === 2 || !by.has(id)) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    state.set(id, 1);
    path.push(id);
    for (const r of by.get(id)) for (const p of r.premises) { const hit = visit(p); if (hit) return hit; }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const c of map.claims) { const hit = visit(c.id); if (hit) return hit; }
  return null;
}

const describeCycle = (map, cycle) => {
  const text = byId(map);
  return cycle.map((id) => `"${short(text.get(id)?.text ?? id)}"`).join(" rests on ");
};

/** Structural problems that make a map unusable, as sentences. An empty list means the map is sound. */
export function problems(map) {
  const out = [];
  if (!map || !Array.isArray(map.claims) || !Array.isArray(map.reasons)) return ["The map needs a list of claims and a list of reasons."];
  if (!map.claims.length) out.push("The map has no claims.");
  if (map.claims.length > LIMITS.claims) out.push(`The map has ${map.claims.length} claims; the limit is ${LIMITS.claims}.`);
  const ids = new Set();
  for (const c of map.claims) {
    if (ids.has(c.id)) out.push(`Two claims share the id "${c.id}".`);
    ids.add(c.id);
    if (!cleanText(c.text)) out.push("A claim has no text.");
  }
  if (!ids.has(map.conclusion)) out.push("The map does not say which claim is the main conclusion.");
  for (const r of map.reasons) {
    if (!ids.has(r.claim)) out.push("A reason supports a claim that is not in the map.");
    if (!Array.isArray(r.premises) || !r.premises.length) { out.push("A reason has no premises."); continue; }
    if (r.premises.some((p) => !ids.has(p))) out.push("A reason uses a premise that is not in the map.");
    if (new Set(r.premises).size !== r.premises.length) out.push("A reason lists the same premise twice.");
    if (r.premises.includes(r.claim)) out.push("A claim is given as a reason for itself.");
  }
  if (!out.length) {
    const cycle = findCycle(map);
    if (cycle) out.push(`The map is circular: ${describeCycle(map, cycle)}. A claim cannot be part of its own support.`);
  }
  return out;
}

/* ----------------------------------------------------------------- evaluation */

/**
 * Which claims stand, given the set of premises that have been removed.
 * A premise stands if it has not been removed. Any other claim stands if at least one of its reasons
 * has every member standing. Returns Map(id -> boolean).
 */
export function evaluate(map, off = new Set()) {
  const by = reasonsByClaim(map);
  const memo = new Map();
  const visiting = new Set();
  const stands = (id) => {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id) || !by.has(id)) return false; // a circular or dangling reference supports nothing
    visiting.add(id);
    const reasons = by.get(id);
    const value = reasons.length ? reasons.some((r) => r.premises.every(stands)) : !off.has(id);
    visiting.delete(id);
    memo.set(id, value);
    return value;
  };
  for (const c of map.claims) stands(c.id);
  return memo;
}

const bits = (mask) => { let n = 0; for (let m = mask; m; m &= m - 1n) n++; return n; };
/** Drop duplicates and any set that contains another set in the list. */
function minimal(masks) {
  const sorted = [...new Set(masks)].sort((a, b) => bits(a) - bits(b));
  const out = [];
  for (const s of sorted) if (!out.some((t) => (t & s) === t)) out.push(s);
  return out;
}

/**
 * The target as a Boolean function of the premises, in two minimal forms.
 *   "support": the smallest sets of premises that are enough for the target (it stands if all of one set stand).
 *   "cut":     the smallest sets of premises whose removal defeats the target (it falls if all of one set go).
 * Each set is a list of premise ids. Returns null if there are more than LIMITS.sets of them.
 */
export function minimalSets(map, mode = "support", target = map.conclusion) {
  const by = reasonsByClaim(map);
  if (!by.has(target)) return [];
  const order = map.claims.map((c) => c.id);
  const bit = new Map(order.map((id, i) => [id, 1n << BigInt(i)]));
  const memo = new Map();
  const either = (lists) => minimal(lists.flat());
  const all = (lists) => lists.reduce((acc, list) => {
    const next = [];
    for (const a of acc) for (const b of list) next.push(a | b);
    if (next.length > LIMITS.sets * 4) throw new RangeError("too many sets");
    return minimal(next);
  }, [0n]);
  const [within, across] = mode === "support" ? [all, either] : [either, all];
  const sets = (id) => {
    if (memo.has(id)) return memo.get(id);
    memo.set(id, []); // guard: a circular reference contributes nothing
    const reasons = by.get(id) || [];
    const out = reasons.length ? across(reasons.map((r) => within(r.premises.map(sets)))) : [bit.get(id)];
    if (out.length > LIMITS.sets) throw new RangeError("too many sets");
    memo.set(id, out);
    return out;
  };
  let masks;
  try { masks = sets(target); } catch (e) { if (e instanceof RangeError) return null; throw e; }
  return masks.map((m) => order.filter((id) => m & bit.get(id)));
}

/** Keep the smallest of a family of id lists after subtracting or intersecting with a set. */
function reduce(sets, keep) {
  const lists = sets.map((s) => s.filter(keep));
  const sorted = lists.sort((a, b) => a.length - b.length);
  const out = [];
  for (const s of sorted) if (!out.some((t) => t.every((id) => s.includes(id)))) out.push(s);
  return out;
}

/**
 * Everything the page shows about a map, given the premises that have been removed.
 *
 * Each premise gets a role:
 *   "critical"    in play, and removing it alone makes the main conclusion fall
 *   "redundant"   in play and used, but the conclusion survives its removal because another line of support holds
 *   "idle"        in play and connected, but no smallest sufficient set of premises contains it
 *   "unused"      not connected to the main conclusion at all
 *   "restores"    removed, and putting it back alone would make the fallen conclusion stand again
 *   "removed"     removed (and putting it back alone would not change the verdict)
 *   "inplay"      in play while the conclusion has fallen anyway
 */
export function analyse(map, off = new Set()) {
  const by = reasonsByClaim(map);
  // A main conclusion with no reasons is an assertion, not a premise: it cannot be removed.
  const leaves = premisesOf(map).filter((id) => id !== map.conclusion);
  const removed = new Set(leaves.filter((id) => off.has(id)));
  const stands = evaluate(map, removed);
  const connected = restsOn(map);
  const argued = (by.get(map.conclusion) || []).length > 0;
  const conclusionStands = stands.get(map.conclusion) === true;
  const supportAll = minimalSets(map, "support");
  const cutAll = minimalSets(map, "cut");
  const working = supportAll ? new Set(supportAll.flat()) : null;

  const premises = leaves.map((id) => {
    const on = !removed.has(id);
    let role;
    if (!connected.has(id)) role = on ? "unused" : "removed";
    else if (on) {
      if (!conclusionStands) role = "inplay";
      else if (!evaluate(map, new Set([...removed, id])).get(map.conclusion)) role = "critical";
      else role = working && !working.has(id) ? "idle" : "redundant";
    } else {
      const without = new Set(removed);
      without.delete(id);
      role = !conclusionStands && evaluate(map, without).get(map.conclusion) ? "restores" : "removed";
    }
    return { id, on, role, connected: connected.has(id) };
  });

  const count = (role) => premises.filter((p) => p.role === role).length;
  return {
    stands, conclusionStands, argued, premises,
    holds: new Map(map.reasons.map((r) => [r.id, r.premises.every((p) => stands.get(p))])),
    counts: { premises: leaves.length, inPlay: leaves.length - removed.size, critical: count("critical"), redundant: count("redundant"), idle: count("idle"), unused: count("unused") },
    /** Lines of support: each smallest sufficient set, and whether all of it is still in play. */
    supports: supportAll && argued ? supportAll.map((set) => ({ premises: set, intact: set.every((id) => !removed.has(id)) })) : supportAll ? [] : null,
    /** Smallest sets of further premises to remove so that the conclusion falls (empty once it has fallen). */
    objections: !cutAll ? null : conclusionStands && argued ? reduce(cutAll, (id) => !removed.has(id)) : [],
    /** Smallest sets of removed premises to put back so that the conclusion stands again. */
    repairs: !supportAll ? null : conclusionStands ? [] : reduce(supportAll, (id) => removed.has(id)),
  };
}

/* -------------------------------------------------------------------- editing */
// Every edit returns { map } (a new object) or { error } (a sentence). The input map is never changed.

const fail = (error) => ({ error });

export function blankMap() {
  return { title: "Untitled argument", conclusion: "c1", claims: [{ id: "c1", text: "Your conclusion", unstated: false }], reasons: [] };
}

export function addClaim(map, text) {
  const clean = cleanText(text);
  if (!clean) return fail("Type the claim before adding it.");
  if (map.claims.length >= LIMITS.claims) return fail(`A map can hold ${LIMITS.claims} claims. Delete one to add another.`);
  const next = clone(map);
  const id = nextId(next.claims, "c");
  next.claims.push({ id, text: clean, unstated: false });
  return { map: next, id };
}

export function editClaim(map, id, changes) {
  const next = clone(map);
  const claim = next.claims.find((c) => c.id === id);
  if (!claim) return fail("That claim is no longer in the map.");
  if ("text" in changes) {
    const clean = cleanText(changes.text);
    if (!clean) return fail("A claim needs some text. Delete it if you no longer want it.");
    claim.text = clean;
  }
  if ("unstated" in changes) claim.unstated = Boolean(changes.unstated);
  return { map: next };
}

/** Removes the claim, the reasons given for it, and its place in other reasons. A reason left with no premises goes too. */
export function deleteClaim(map, id) {
  if (!map.claims.some((c) => c.id === id)) return fail("That claim is no longer in the map.");
  if (id === map.conclusion) return fail("This is the main conclusion. Make another claim the main conclusion before deleting it.");
  const next = clone(map);
  next.claims = next.claims.filter((c) => c.id !== id);
  next.reasons = next.reasons
    .filter((r) => r.claim !== id)
    .map((r) => ({ ...r, premises: r.premises.filter((p) => p !== id) }))
    .filter((r) => r.premises.length);
  return { map: next };
}

export function setConclusion(map, id) {
  if (!map.claims.some((c) => c.id === id)) return fail("That claim is no longer in the map.");
  return { map: { ...clone(map), conclusion: id } };
}

/** Add a reason for a claim, or replace the premises of an existing reason when reasonId is given. */
export function setReason(map, claim, premises, reasonId = null) {
  const ids = new Set(map.claims.map((c) => c.id));
  const chosen = [...new Set(premises)];
  if (!ids.has(claim)) return fail("That claim is no longer in the map.");
  if (!chosen.length) return fail("Tick at least one claim to act as a premise.");
  if (chosen.some((p) => !ids.has(p))) return fail("One of those premises is no longer in the map.");
  if (chosen.includes(claim)) return fail("A claim cannot be a reason for itself.");
  const same = (r) => r.claim === claim && r.id !== reasonId && r.premises.length === chosen.length && chosen.every((p) => r.premises.includes(p));
  if (map.reasons.some(same)) return fail("This claim already has a reason made of exactly those premises.");
  const next = clone(map);
  if (reasonId) {
    const reason = next.reasons.find((r) => r.id === reasonId && r.claim === claim);
    if (!reason) return fail("That reason is no longer in the map.");
    reason.premises = chosen;
  } else next.reasons.push({ id: nextId(next.reasons, "r"), claim, premises: chosen });
  const cycle = findCycle(next);
  if (cycle) return fail(`That would make the argument circular: ${describeCycle(next, cycle)}. A claim cannot be part of its own support, so this reason was not added.`);
  return { map: next };
}

export function deleteReason(map, reasonId) {
  if (!map.reasons.some((r) => r.id === reasonId)) return fail("That reason is no longer in the map.");
  const next = clone(map);
  next.reasons = next.reasons.filter((r) => r.id !== reasonId);
  return { map: next };
}

/** Build a one-step argument from typed text. mode "linked": the premises work together; "convergent": each is a reason on its own. */
export function fromLines(premiseText, conclusionText, mode = "linked") {
  const conclusion = cleanText(conclusionText);
  const lines = [...new Set(String(premiseText ?? "").split(/\r?\n/).map(cleanText).filter(Boolean))];
  if (!conclusion) return fail("Type the conclusion the premises are meant to support.");
  if (!lines.length) return fail("Type at least one premise, one per line.");
  if (lines.length + 1 > LIMITS.claims) return fail(`That is ${lines.length} premises; a map can hold ${LIMITS.claims - 1}.`);
  if (lines.includes(conclusion)) return fail("The conclusion is also listed as a premise. An argument cannot assume what it sets out to show.");
  const claims = [conclusion, ...lines].map((text, i) => ({ id: `c${i + 1}`, text, unstated: false }));
  const premises = claims.slice(1).map((c) => c.id);
  const reasons = mode === "convergent"
    ? premises.map((p, i) => ({ id: `r${i + 1}`, claim: "c1", premises: [p] }))
    : [{ id: "r1", claim: "c1", premises }];
  return { map: { title: short(conclusion, 60), conclusion: "c1", claims, reasons } };
}

/* ------------------------------------------------------------- import, export */

export const toJSON = (map) => JSON.stringify({ format: FORMAT, version: 1, ...map }, null, 2);

/** Read a map from parsed JSON or from JSON text. Ids are renumbered; anything unsound is refused with a reason. */
export function fromJSON(input) {
  let raw = input;
  if (typeof input === "string") {
    try { raw = JSON.parse(input); } catch { return fail("That file is not valid JSON."); }
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.claims) || !Array.isArray(raw.reasons)) return fail("That file is not an argument map: it needs a list of claims and a list of reasons.");
  if (raw.claims.some((c) => !c || typeof c !== "object" || (c.text != null && typeof c.text !== "string")) || raw.reasons.some((r) => !r || typeof r !== "object" || !Array.isArray(r.premises))) return fail("That file is not an argument map: a claim or a reason is malformed.");
  const rename = new Map();
  raw.claims.forEach((c, i) => { const key = c.id == null ? `#${i}` : String(c.id); if (!rename.has(key)) rename.set(key, `c${i + 1}`); });
  if (rename.size !== raw.claims.length) return fail("Two claims in that file share an id.");
  const map = {
    title: cleanText(raw.title).slice(0, 80) || "Imported argument",
    conclusion: rename.get(String(raw.conclusion)) ?? "",
    claims: raw.claims.map((c, i) => ({ id: `c${i + 1}`, text: cleanText(c.text), unstated: Boolean(c.unstated) })),
    reasons: raw.reasons.map((r, i) => ({ id: `r${i + 1}`, claim: rename.get(String(r.claim)) ?? "", premises: r.premises.map((p) => rename.get(String(p)) ?? "") })),
  };
  const found = problems(map);
  return found.length ? fail(found[0]) : { map };
}

/* --------------------------------------------------------------------- layout */

/** Greedy word wrap using a width function. Words wider than a line are split. Extra lines are cut with an ellipsis. */
export function wrapText(text, maxWidth, measure, maxLines = 6) {
  const lines = [];
  let line = "";
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (word.length > 1 && measure(word) > maxWidth) {
      let k = word.length - 1;
      while (k > 1 && measure(`${word.slice(0, k)}-`) > maxWidth) k--;
      if (line) { lines.push(line); line = ""; }
      lines.push(`${word.slice(0, k)}-`);
      word = word.slice(k);
    }
    const joined = line ? `${line} ${word}` : word;
    if (measure(joined) <= maxWidth) line = joined;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines.length ? lines : [""];
}

/** Positions as close as possible (least squares) to the wanted ones, with item i at least gaps[i] to the right of item i - 1. */
function spread(want, gaps) {
  const off = [];
  want.forEach((_, i) => off.push(i ? off[i - 1] + gaps[i] : 0));
  const blocks = [];
  want.forEach((d, i) => {
    blocks.push({ sum: d - off[i], n: 1 });
    while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).n > blocks.at(-1).sum / blocks.at(-1).n) {
      const b = blocks.pop();
      blocks.at(-1).sum += b.sum;
      blocks.at(-1).n += b.n;
    }
  });
  return blocks.flatMap((b) => Array(b.n).fill(b.sum / b.n)).map((z, i) => z + off[i]);
}

/**
 * Layered drawing. A claim sits one layer below the lowest claim it supports, so every arrow points up.
 * Returns { width, height, nodes: [{ id, x, y, w, h, lines, layer }], links: [{ id, claim, x, y, tip, members: [{ id, x, y, route }] }] }
 * where a link is one reason: its members' lines meet at (x, y) and one arrow runs from there to `tip` on the claim.
 * A member's `route` is the list of points its line passes through, from the premise's top edge to the meeting point.
 * Each pair of points is joined by an S-curve that leaves and arrives vertically (a straight line when they share an x).
 * No line and no arrow crosses a box: lines bend only in the gaps between layers, and a premise that sits more than
 * one layer below its claim gets a narrow lane of its own through each layer in between.
 */
export function layout(map, { nodeWidth = 172, gapX = 20, gapY = 72, pad = 10, tag = 17, lineHeight = 16, maxLines = 6, margin = 6, lane = 16, measure = (s) => s.length * 6.4 } = {}) {
  const by = reasonsByClaim(map);
  const parents = new Map(map.claims.map((c) => [c.id, new Set()]));
  for (const r of map.reasons) for (const p of r.premises) parents.get(p)?.add(r.claim);

  const layerOf = new Map();
  const layer = (id) => {
    if (layerOf.has(id)) return layerOf.get(id);
    layerOf.set(id, 0);
    let deepest = 0;
    for (const p of parents.get(id)) deepest = Math.max(deepest, layer(p) + 1);
    layerOf.set(id, deepest);
    return deepest;
  };
  for (const c of map.claims) layer(c.id);

  // What gets placed: every claim, plus one lane in each layer that a long line has to pass through.
  // `up` and `down` join each of them to its neighbours along the lines, one layer apart.
  const width = new Map(map.claims.map((c) => [c.id, nodeWidth]));
  const up = new Map(map.claims.map((c) => [c.id, []]));
  const down = new Map(map.claims.map((c) => [c.id, []]));
  const join = (hi, lo) => { if (!down.get(hi).includes(lo)) { down.get(hi).push(lo); up.get(lo).push(hi); } };
  const lanesOf = new Map(); // reason id -> premise id -> its lanes, from the claim downwards
  for (const r of map.reasons) {
    if (!parents.has(r.claim)) continue;
    lanesOf.set(r.id, new Map());
    for (const p of r.premises) {
      if (!parents.has(p)) continue;
      const lanes = [];
      for (let k = layerOf.get(r.claim) + 1; k < layerOf.get(p); k++) {
        const id = Symbol("lane");
        width.set(id, lane); layerOf.set(id, k); up.set(id, []); down.set(id, []);
        join(lanes.at(-1) ?? r.claim, id);
        lanes.push(id);
      }
      join(lanes.at(-1) ?? r.claim, p);
      lanesOf.get(r.id).set(p, lanes);
    }
  }

  // Order inside a layer: depth-first from the top, starting with the tree that holds the main conclusion.
  const layers = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id) || !up.has(id)) return;
    seen.add(id);
    (layers[layerOf.get(id)] ||= []).push(id);
    down.get(id).forEach(visit);
  };
  const top = (id) => { const guard = new Set(); while (parents.get(id)?.size && !guard.has(id)) { guard.add(id); id = [...parents.get(id)][0]; } return id; };
  if (parents.has(map.conclusion)) visit(top(map.conclusion));
  for (const c of map.claims) if (!parents.get(c.id).size) visit(c.id);
  for (const c of map.claims) visit(c.id);
  for (let k = 0; k < layers.length; k++) layers[k] ||= [];

  // Horizontal positions (centres): pull each item towards what it supports, then towards what supports it.
  const cx = new Map();
  const gapsOf = (ids) => ids.map((id, i) => (i ? (width.get(ids[i - 1]) + width.get(id)) / 2 + gapX : 0));
  const mean = (ids) => ids.reduce((s, id) => s + cx.get(id), 0) / ids.length;
  const settle = (ids, want) => spread(want, gapsOf(ids)).forEach((v, i) => cx.set(ids[i], v));
  for (const ids of layers) settle(ids, ids.map(() => 0)); // to begin with, each layer packed and centred
  for (let pass = 0; pass < 6; pass++) {
    for (let k = 1; k < layers.length; k++) settle(layers[k], layers[k].map((id) => (up.get(id).length ? mean(up.get(id)) : cx.get(id))));
    for (let k = layers.length - 2; k >= 0; k--) settle(layers[k], layers[k].map((id) => (down.get(id).length ? mean(down.get(id)) : cx.get(id))));
  }
  const left = Math.min(...[...cx].map(([id, x]) => x - width.get(id) / 2)) - margin;
  const at = (id) => cx.get(id) - left;

  const text = byId(map);
  const nodes = new Map();
  const rows = []; // the top and bottom of each layer
  let y = margin;
  layers.forEach((ids, k) => {
    let tallest = 0;
    for (const id of ids) {
      if (!text.has(id)) continue; // a lane has no box
      const lines = wrapText(text.get(id).text, nodeWidth - 2 * pad, measure, maxLines);
      const h = pad + tag + lines.length * lineHeight + pad - 4;
      nodes.set(id, { id, x: at(id) - nodeWidth / 2, y, w: nodeWidth, h, lines, layer: k });
      tallest = Math.max(tallest, h);
    }
    rows.push({ top: y, bottom: y + tallest });
    y += tallest + gapY;
  });

  // One meeting point per reason, spaced along the bottom edge of the claim it supports, below the tallest box in that layer.
  const links = [];
  for (const c of map.claims) {
    const node = nodes.get(c.id);
    const reasons = by.get(c.id).map((r) => {
      const members = r.premises.filter((p) => nodes.has(p)).map((p) => ({ id: p, lanes: lanesOf.get(r.id).get(p) }));
      return { r, members, at: mean(members.map((m) => m.lanes[0] ?? m.id)) };
    });
    reasons.sort((a, b) => a.at - b.at).forEach(({ r, members }, i) => {
      const x = node.x + (node.w * (i + 1)) / (reasons.length + 1);
      links.push({ id: r.id, claim: c.id, x, y: rows[node.layer].bottom + 28, tip: { x, y: node.y + node.h }, members });
    });
  }
  // A premise used by several reasons sends each line from its own point on the top edge.
  for (const node of nodes.values()) {
    const ends = links.flatMap((l) => l.members.filter((m) => m.id === node.id).map((m) => ({ m, x: m.lanes.length ? at(m.lanes.at(-1)) : l.x }))).sort((a, b) => a.x - b.x);
    ends.forEach(({ m }, i) => { m.x = node.x + (node.w * (i + 1)) / (ends.length + 1); m.y = node.y; });
  }
  // Up from the premise, straight through each lane, to the meeting point.
  for (const l of links) for (const m of l.members) {
    m.route = [[m.x, m.y], ...[...m.lanes].reverse().flatMap((id) => [[at(id), rows[layerOf.get(id)].bottom], [at(id), rows[layerOf.get(id)].top]]), [l.x, l.y]];
    delete m.lanes;
  }

  return {
    width: Math.max(...[...cx.keys()].map((id) => at(id) + width.get(id) / 2)) + margin, // boxes and lanes
    height: Math.max(...[...nodes.values()].map((n) => n.y + n.h)) + margin,
    nodes: map.claims.map((c) => nodes.get(c.id)),
    links,
  };
}
