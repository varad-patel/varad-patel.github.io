// Day 119: Belief Updater. The model, with no DOM code.
//
//   claim = { id, text, prior, created, items: [item] }          prior is a probability strictly between 0 and 1
//   item  = { id, text, mode: "ratio" | "probs", ratio, pH, pNotH, given, added }
//           mode "ratio": ratio is P(E | H) / P(E | not H) as typed. mode "probs": pH and pNotH as typed, ratio = pH / pNotH.
//           given: the visitor says the numbers already allow for the items above (they are conditional on them).
//   file  = { format, version, claims: [claim] }
//
// Beliefs are carried as natural log-odds, so that no number of items can round a belief to exactly 0 or 1.

export const FORMAT = "365-belief-updater";
export const VERSION = 1;
export const LIMITS = { claim: 200, item: 160, items: 40, claims: 200, ratioMin: 1e-6, ratioMax: 1e6, probMin: 1e-6, fileBytes: 2e6 };

/* ---------------------------------------------------------------------- dates */

const two = (n) => String(n).padStart(2, "0");
export const localToday = (now = new Date()) => `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
export function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/* ---------------------------------------------------------------- odds and logs */

export const logit = (p) => Math.log(p) - Math.log1p(-p);
/** Probability from log-odds without overflow: 1 / (1 + e^-L). */
export const sigmoid = (L) => (L >= 0 ? 1 / (1 + Math.exp(-L)) : Math.exp(L) / (1 + Math.exp(L)));
/** Weight of evidence in decibans: 10 log10 of the likelihood ratio. */
export const decibans = (ratio) => 10 * Math.log10(ratio);

const trimZeros = (s) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
const group = (s) => {
  const [a, b] = s.split(".");
  return a.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (b ? `.${b}` : "");
};

/**
 * A belief written as a percentage that never says 0% or 100% unless it is one. Between 0.1% and 99.9% it has one
 * decimal; nearer the ends it keeps enough decimals to show how near (99.9987%, 0.00042%), and past a millionth
 * it says "more than 99.9999%" or "less than 0.0001%".
 */
export function percentText(L) {
  const p = sigmoid(L), q = sigmoid(-L);
  const small = Math.min(p, q);
  if (small < 1e-6) return L > 0 ? "more than 99.9999%" : "less than 0.0001%";
  if (small >= 0.001) {
    const v = Math.round(p * 1000) / 10;
    return `${v.toFixed(1)}%`;
  }
  // Two significant figures of the small side, written out in full.
  const digits = Math.min(8, 1 - Math.floor(Math.log10(small * 100)));
  const near = Number((small * 100).toPrecision(2));
  const text = trimZeros(near.toFixed(digits));
  return L > 0 ? `${trimZeros((100 - near).toFixed(digits))}%` : `${text}%`;
}

/** Odds in words: "3 to 1", "1 to 99", "2.5 million to 1". */
export function oddsText(L) {
  const big = Math.exp(Math.abs(L));
  const num = (v) => {
    if (v >= 1e12) return "more than a trillion";
    if (v >= 1e9) return `${trimZeros((v / 1e9).toPrecision(3))} billion`;
    if (v >= 1e6) return `${trimZeros((v / 1e6).toPrecision(3))} million`;
    if (v >= 1000) return group(String(Math.round(v)));
    return trimZeros(v.toPrecision(3));
  };
  if (Math.abs(L) < 1e-12) return "1 to 1";
  return L > 0 ? `${num(big)} to 1` : `1 to ${num(big)}`;
}

/**
 * A likelihood ratio in words: "×8.33", "×0.25", "×1.2 million", and below 1 in 1,000 "÷2,500" or "÷3.4 million",
 * so that very small and very large products stay readable.
 */
export function ratioText(r) {
  const big = (v) => {
    if (v >= 1e12) return "more than a trillion";
    if (v >= 1e9) return `${trimZeros((v / 1e9).toPrecision(3))} billion`;
    if (v >= 1e6) return `${trimZeros((v / 1e6).toPrecision(3))} million`;
    if (v >= 1000) return group(String(Math.round(v)));
    return trimZeros(v.toPrecision(3));
  };
  return r >= 0.001 ? `×${big(r)}` : `÷${big(1 / r)}`;
}

/* -------------------------------------------------------------------- parsing */

const fail = (error) => ({ error });
const NUM = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?`;
const toNum = (s) => Number(s.replace(/,/g, ""));
const RX = {
  percent: new RegExp(`^(${NUM})\\s*%?$`, "i"),
  oneIn: new RegExp(`^(${NUM})\\s*in\\s*(${NUM})$`, "i"),
  slash: new RegExp(`^(${NUM})\\s*/\\s*(${NUM})$`, "i"),
  to: new RegExp(`^(${NUM})\\s*(?::|to)\\s*(${NUM})$`, "i"),
};

/**
 * Read a probability typed as a percentage ("30", "30%", "0.5%"), a fraction ("1/1000") or "1 in 1000".
 * Returns { value } with a probability, or { error }. `what` names the box in messages. Bounds are checked by the callers.
 */
export function parseProbability(text, what = "The probability") {
  const s = String(text ?? "").trim();
  if (!s) return fail(`${what} is empty. Type a percentage such as 30%, or a chance such as 1 in 1000.`);
  if (s.length > 40) return fail(`${what} is too long to be a number.`);
  let m;
  if ((m = RX.percent.exec(s))) {
    const v = toNum(m[1]);
    if (!(v <= 100)) return fail(`${what} cannot be more than 100%.`);
    return { value: v / 100 };
  }
  if ((m = RX.oneIn.exec(s)) || (m = RX.slash.exec(s))) {
    const a = toNum(m[1]), b = toNum(m[2]);
    if (!(b > 0)) return fail(`${what}: the second number must be more than 0.`);
    if (a > b) return fail(`${what} cannot be more than 1 in 1 (100%).`);
    return { value: a / b };
  }
  if (/^-/.test(s)) return fail(`${what} cannot be negative.`);
  return fail(`${what} is not a number I can read. Type it as 30%, 0.5%, 1/1000 or 1 in 1000.`);
}

/** Read a likelihood ratio typed as a number ("8.33"), a fraction ("1/4") or as "3:1" or "3 to 1". Returns { value } or { error }. */
export function parseRatio(text) {
  const s = String(text ?? "").trim();
  if (!s) return fail("The likelihood ratio is empty. Type how many times more likely the evidence is if the claim is true, such as 3, or 1/4 if it is four times less likely.");
  if (s.length > 40) return fail("The likelihood ratio is too long to be a number.");
  if (/^(inf|infinity|∞)$/i.test(s)) return fail(RATIO_INFINITE);
  let m, v;
  if ((m = RX.slash.exec(s)) || (m = RX.to.exec(s))) {
    const a = toNum(m[1]), b = toNum(m[2]);
    if (b === 0) return fail(RATIO_INFINITE);
    v = a / b;
  } else if ((m = new RegExp(`^(${NUM})$`, "i").exec(s))) v = toNum(m[1]);
  else if (/^-/.test(s)) return fail("A likelihood ratio cannot be negative: it is a ratio of two probabilities.");
  else return fail("The likelihood ratio is not a number I can read. Type it as 3, 0.25, 1/4 or 3:1.");
  if (v === 0) return fail(RATIO_ZERO);
  if (!Number.isFinite(v)) return fail(RATIO_INFINITE);
  return { value: v };
}

export const RATIO_ZERO = "A ratio of 0 says the evidence could not happen at all if the claim were true. That is not weighing evidence but refuting the claim, and no later evidence could ever revive it. If you are that sure, the claim is false; otherwise use a small ratio such as 0.001.";
export const RATIO_INFINITE = "An unlimited ratio says the evidence could not happen at all if the claim were false. That would settle the claim for good, whatever came later. If you are that sure, the claim is true; otherwise use a large ratio such as 1000.";

/** Check a prior. Exactly 0 or 1 are refused with the reason. */
export function checkPrior(p) {
  if (!Number.isFinite(p)) return fail("Give the prior as a percentage between 0 and 100.");
  if (p <= 0 || p >= 1) return fail(`A prior of ${p <= 0 ? "0%" : "100%"} can never be moved by any evidence: every likelihood ratio multiplies odds of ${p <= 0 ? "0" : "infinity"}. Bayesian epistemologists call the rule against it regularity. Use a small doubt instead, such as ${p <= 0 ? "0.01%" : "99.99%"}.`);
  if (p < LIMITS.probMin || p > 1 - LIMITS.probMin) return fail("This page takes priors between 0.0001% and 99.9999%. Nearer the ends, the evidence you could ever collect would make no visible difference.");
  return { value: p };
}

/**
 * Check one piece of evidence as typed. input: { text, mode, ratio, pH, pNotH, given } with the numbers as text.
 * Returns { item } (without id and date) or { error, field } naming the box to fix.
 */
export function checkItem(input) {
  const text = String(input.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { ...fail("Describe the evidence in a few words, so the history says what moved your belief."), field: "text" };
  if (text.length > LIMITS.item) return { ...fail(`Keep the description to ${LIMITS.item} characters; it has ${text.length}.`), field: "text" };
  const given = Boolean(input.given);
  if (input.mode === "probs") {
    const a = parseProbability(input.pH, "The chance of the evidence if the claim is true");
    if (a.error) return { ...a, field: "pH" };
    const b = parseProbability(input.pNotH, "The chance of the evidence if the claim is false");
    if (b.error) return { ...b, field: "pNotH" };
    if (a.value === 0) return { ...fail(`${RATIO_ZERO.replace("A ratio of 0 says", "A chance of 0 if the claim is true says")}`), field: "pH" };
    if (b.value === 0) return { ...fail(`${RATIO_INFINITE.replace("An unlimited ratio says", "A chance of 0 if the claim is false says")}`), field: "pNotH" };
    if (a.value < LIMITS.probMin || b.value < LIMITS.probMin) return { ...fail("This page takes chances of at least 0.0001% (1 in a million)."), field: a.value < LIMITS.probMin ? "pH" : "pNotH" };
    return { item: { text, mode: "probs", pH: a.value, pNotH: b.value, ratio: a.value / b.value, given } };
  }
  const r = parseRatio(input.ratio);
  if (r.error) return { ...r, field: "ratio" };
  if (r.value < LIMITS.ratioMin || r.value > LIMITS.ratioMax) return { ...fail("This page takes likelihood ratios from 1 in a million (0.000001) to a million. Evidence stronger than that is better treated as settling the question."), field: "ratio" };
  return { item: { text, mode: "ratio", ratio: r.value, pH: null, pNotH: null, given } };
}

/* -------------------------------------------------------------------- updating */

/**
 * The belief after each item, multiplying the odds by each likelihood ratio in turn:
 *   odds after = odds before x P(E | H) / P(E | not H),  that is  L_k = L_(k-1) + ln(ratio_k).
 * Multiplying is right only if each item's probabilities are the same whatever the items above showed (conditional
 * independence), or if the item's numbers were entered given the items above (given = true).
 *
 * overlap: the belief if every item that was not entered "given the items above" were in fact the same evidence as
 * the others pointing the same way, so that only the strongest for the claim and the strongest against it count.
 */
export function evaluate(claim) {
  const L0 = logit(claim.prior);
  let L = L0;
  const steps = [{ L: L0, p: sigmoid(L0) }];
  let strongestFor = 0, strongestAgainst = 0, givenSum = 0;
  for (const item of claim.items) {
    const w = Math.log(item.ratio);
    L += w;
    steps.push({ L, p: sigmoid(L), w, db: decibans(item.ratio) });
    if (item.given) givenSum += w;
    else if (w > 0) strongestFor = Math.max(strongestFor, w);
    else strongestAgainst = Math.min(strongestAgainst, w);
  }
  const independent = claim.items.filter((i) => !i.given);
  return {
    L0, L, p: sigmoid(L), steps,
    totalRatio: Math.exp(L - L0), totalDb: (10 * (L - L0)) / Math.LN10,
    overlap: { L: L0 + strongestFor + strongestAgainst + givenSum, counted: independent.length },
    differs: independent.length > 1 && Math.abs(L - (L0 + strongestFor + strongestAgainst + givenSum)) > 1e-9,
  };
}

/* --------------------------------------------------------------------- claims */

let counter = 0;
export const newId = (prefix = "c") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const cleanText = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function newClaim(text, prior, today, id = newId("c")) {
  return { id, text: cleanText(text, LIMITS.claim), prior, created: today, items: [] };
}

/** Add, change or remove an item. Each returns { claim } or { error }. */
export function addItem(claim, input, today, id = newId("e")) {
  if (claim.items.length >= LIMITS.items) return fail(`A claim holds up to ${LIMITS.items} pieces of evidence. Start a new claim, or remove some.`);
  const c = checkItem(input);
  if (c.error) return c;
  return { claim: { ...claim, items: [...claim.items, { id, ...c.item, added: today }] }, id };
}
export function editItem(claim, id, input) {
  const old = claim.items.find((i) => i.id === id);
  if (!old) return fail("That piece of evidence is no longer in this claim.");
  const c = checkItem(input);
  if (c.error) return c;
  return { claim: { ...claim, items: claim.items.map((i) => (i.id === id ? { ...old, ...c.item } : i)) } };
}
export function removeItem(claim, id) {
  if (!claim.items.some((i) => i.id === id)) return fail("That piece of evidence is no longer in this claim.");
  return { claim: { ...claim, items: claim.items.filter((i) => i.id !== id) } };
}

/* ------------------------------------------------------------- import, export */

export const toJSON = (claims) => JSON.stringify({ format: FORMAT, version: VERSION, claims }, null, 2);

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/** One record from a file or from storage, checked field by field. Returns { claim } or { error }. */
export function readClaim(raw, today) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("it is not a record");
  const text = cleanText(raw.text, LIMITS.claim);
  if (!text) return fail("it has no claim");
  const prior = checkPrior(num(raw.prior));
  if (prior.error) return fail("its prior is not a probability between 0.0001% and 99.9999%");
  if (!Array.isArray(raw.items)) return fail("it has no list of evidence");
  if (raw.items.length > LIMITS.items) return fail(`it has more than ${LIMITS.items} pieces of evidence`);
  const items = [];
  for (const [k, it] of raw.items.entries()) {
    if (!it || typeof it !== "object") return fail(`evidence ${k + 1} is not a record`);
    const mode = it.mode === "probs" ? "probs" : it.mode === "ratio" ? "ratio" : null;
    if (!mode) return fail(`evidence ${k + 1} has no mode ("ratio" or "probs")`);
    const c = mode === "probs"
      ? checkItem({ text: it.text, mode, pH: String(num(it.pH) * 100), pNotH: String(num(it.pNotH) * 100), given: it.given === true })
      : checkItem({ text: it.text, mode, ratio: String(num(it.ratio)), given: it.given === true });
    if (c.error) return fail(`evidence ${k + 1}: ${c.error.replace(/\.$/, "")}`);
    // The numbers are kept exactly as stored (the text round trip above is only a check).
    const item = mode === "probs" ? { ...c.item, pH: num(it.pH), pNotH: num(it.pNotH), ratio: num(it.pH) / num(it.pNotH) } : { ...c.item, ratio: num(it.ratio) };
    items.push({ id: typeof it.id === "string" && it.id.trim() ? it.id.trim().slice(0, 40) : newId("e"), ...item, added: isDate(it.added) ? it.added : today });
  }
  return { claim: { id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 40) : newId("c"), text, prior: prior.value, created: isDate(raw.created) ? raw.created : today, items } };
}

/** Read an exported file. Returns { claims, problems } or { error }. */
export function parseImport(text, today) {
  const body = String(text ?? "").replace(/^﻿/, "").trim();
  if (!body) return fail("That file is empty.");
  if (body[0] !== "{" && body[0] !== "[") return fail("That file is not one this page exported: it should be a JSON file starting with {.");
  let data;
  try { data = JSON.parse(body); } catch { return fail("That file looks like JSON but cannot be read. It may have been cut short."); }
  // The format is checked first, so that a file from another page is named as such.
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (typeof data.format === "string" && data.format !== FORMAT) return fail(`That file is not from this page. Its format is "${data.format.slice(0, 40)}", not "${FORMAT}".`);
    if (typeof data.version === "number" && data.version > VERSION) return fail(`That file was written by a newer version of this page (format version ${data.version}; this page reads version ${VERSION}). Reload the page to get the latest version, then import it again.`);
  }
  const records = Array.isArray(data) ? data : data?.claims;
  if (!Array.isArray(records)) return fail("That JSON file has no list of claims in it.");
  const claims = [], problems = [];
  records.forEach((raw, i) => {
    const r = readClaim(raw, today);
    if (r.error) problems.push(`Claim ${i + 1}: ${r.error}.`);
    else claims.push(r.claim);
  });
  if (!claims.length) return fail(records.length ? `None of the ${records.length} claims could be read. ${problems[0]}` : "That file has no claims in it.");
  return { claims, problems };
}

/** Add imported claims whose id is not already in the list. Reports what was left out and why. */
export function mergeClaims(list, incoming) {
  const ids = new Set(list.map((c) => c.id));
  const added = [];
  let duplicates = 0, overLimit = 0;
  for (const c of incoming) {
    if (ids.has(c.id)) { duplicates++; continue; }
    if (list.length + added.length >= LIMITS.claims) { overLimit++; continue; }
    ids.add(c.id);
    added.push(c);
  }
  return { claims: [...list, ...added], added: added.length, duplicates, overLimit, firstAdded: added[0]?.id ?? null };
}

/**
 * Whatever is in storage, keeping every claim that is still sound. Returns null if nothing is stored, and
 * { claims: [], newer } for data written by a later version of the page, which this version must not read or rewrite.
 */
export function restore(saved, today) {
  if (!saved || !Array.isArray(saved.claims)) return null;
  if (typeof saved.version === "number" && saved.version > VERSION) return { claims: [], current: null, newer: saved.version };
  return { claims: saved.claims.map((c) => readClaim(c, today).claim).filter(Boolean), current: typeof saved.current === "string" ? saved.current : null };
}

/* ------------------------------------------------------------------- examples */

/** Illustrative claims. Their numbers are made up or textbook figures, not measurements. */
export const EXAMPLES = [
  {
    key: "test", title: "A medical test, taken twice",
    text: "This patient has the condition",
    prior: 0.01,
    items: [
      { text: "A positive test (it finds 80% of cases and gives 9.6% false positives)", mode: "probs", pH: 0.8, pNotH: 0.096, given: false },
      { text: "A second positive test of the same kind", mode: "probs", pH: 0.8, pNotH: 0.096, given: false },
    ],
  },
  {
    key: "coin", title: "A coin that might be biased",
    text: "This coin lands heads 75% of the time, not 50%",
    prior: 0.5,
    items: [
      { text: "Heads", mode: "probs", pH: 0.75, pNotH: 0.5, given: false },
      { text: "Heads", mode: "probs", pH: 0.75, pNotH: 0.5, given: false },
      { text: "Tails", mode: "probs", pH: 0.25, pNotH: 0.5, given: false },
      { text: "Heads", mode: "probs", pH: 0.75, pNotH: 0.5, given: false },
      { text: "Heads", mode: "probs", pH: 0.75, pNotH: 0.5, given: false },
    ],
  },
  {
    key: "witnesses", title: "Two witnesses who talked first",
    text: "The suspect was at the scene",
    prior: 0.1,
    items: [
      { text: "Witness A picks the suspect out of a line-up", mode: "probs", pH: 0.6, pNotH: 0.05, given: false },
      { text: "Witness B, who discussed it with A beforehand, also picks the suspect", mode: "probs", pH: 0.9, pNotH: 0.6, given: true },
    ],
  },
];

export function exampleClaim(key, today, id) {
  const e = EXAMPLES.find((x) => x.key === key);
  return { id: id ?? newId("c"), text: e.text, prior: e.prior, created: today, items: e.items.map((it, i) => ({ id: `${id ?? "x"}-${i + 1}`, ...it, ratio: it.pH / it.pNotH, added: today })) };
}
