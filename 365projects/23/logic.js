// Day 23: Infinity Lab. The model, with no DOM code.
// Rooms, guests, coaches, seats, rows and digit positions are all numbered 1, 2, 3, ...

import { rng } from "../kit/kit.js";

/* ============================================================ Hilbert's Hotel */

// An arrival is { kind, k }:
//   "one"      one new guest
//   "many"     k new guests
//   "coach"    one coach with a passenger in every seat 1, 2, 3, ...
//   "coaches"  coaches 1, 2, 3, ... each with a passenger in every seat 1, 2, 3, ...
// Each rule is a bijection from (guests already in the hotel) + (newcomers) onto the rooms:
// every room ends up with exactly one person. moveGuest and placeNewcomer go one way, whoGets goes back.

export const KINDS = ["one", "many", "coach", "coaches"];
export const MAX_NUMBER = 1e6;   // inputs up to here keep every room number an exact integer

/** n-th triangular number, 1 + 2 + ... + n. */
export const triangular = (n) => (n * (n + 1)) / 2;

/** True for a whole number from 1 to max. */
export const isCount = (x, max = MAX_NUMBER) => Number.isInteger(x) && x >= 1 && x <= max;

/** The room the guest now in room n moves to. */
export function moveGuest(arrival, n) {
  switch (arrival.kind) {
    case "one": return n + 1;
    case "many": return n + arrival.k;
    case "coach": return 2 * n;
    case "coaches": return triangular(n);
    default: throw new Error(`unknown arrival "${arrival.kind}"`);
  }
}

/** How many newcomers the arrival brings: a number, or Infinity. */
export const newcomers = (arrival) => (arrival.kind === "one" ? 1 : arrival.kind === "many" ? arrival.k : Infinity);

/** The room given to a newcomer: guest number `seat`, or the passenger in that seat of that coach. Null if there is no such newcomer. */
export function placeNewcomer(arrival, seat, coach = 1) {
  if (!isCount(seat) || !isCount(coach)) return null;
  switch (arrival.kind) {
    case "one": return seat === 1 ? 1 : null;
    case "many": return seat <= arrival.k ? seat : null;
    case "coach": return 2 * seat - 1;
    // Cantor's pairing function. Treat the guests already here as coach 0; then coach c, seat s
    // lies on diagonal c + s, after the triangular(c + s - 1) rooms used by the earlier diagonals.
    case "coaches": return triangular(coach + seat - 1) + seat;
    default: throw new Error(`unknown arrival "${arrival.kind}"`);
  }
}

/** Who ends up in room m: { from: n } for the guest who was in room n, or { seat, coach } for a newcomer. */
export function whoGets(arrival, m) {
  switch (arrival.kind) {
    case "one": return m === 1 ? { seat: 1, coach: 1 } : { from: m - 1 };
    case "many": return m <= arrival.k ? { seat: m, coach: 1 } : { from: m - arrival.k };
    case "coach": return m % 2 === 1 ? { seat: (m + 1) / 2, coach: 1 } : { from: m / 2 };
    case "coaches": {
      let w = Math.floor((Math.sqrt(8 * (m - 1) + 1) - 1) / 2);   // the largest w with triangular(w) < m
      while (triangular(w + 1) < m) w++;
      while (triangular(w) >= m) w--;
      const seat = m - triangular(w);
      const coach = w + 1 - seat;
      return coach === 0 ? { from: seat } : { seat, coach };
    }
    default: throw new Error(`unknown arrival "${arrival.kind}"`);
  }
}

/**
 * Who is in room m after a sequence of arrivals, starting from a full hotel.
 * { batch: 0, from: n } is the guest who started in room n; { batch: i, seat, coach } came with the i-th arrival.
 */
export function resident(history, m) {
  for (let i = history.length - 1; i >= 0; i--) {
    const who = whoGets(history[i], m);
    if (who.from == null) return { batch: i + 1, ...who };
    m = who.from;
  }
  return { batch: 0, from: m };
}

/** The opposite question: the room a given person is in after the whole history. */
export function roomNow(history, person) {
  let m = person.batch === 0 ? person.from : placeNewcomer(history[person.batch - 1], person.seat, person.coach);
  for (let i = person.batch; i < history.length; i++) m = moveGuest(history[i], m);
  return m;
}

/* ============================================================ Cantor's diagonal */

// A list assigns an infinite sequence of 0s and 1s to every row number 1, 2, 3, ...
// It is built from three layers, top to bottom:
//   added   sequences put at the top by "add the missing sequence", newest first
//   typed   rows the visitor typed: a finite pattern repeated for ever
//   rule    a formula that gives digit j of generated row i for every i and j

export const RULES = [
  { key: "binary", label: "Counting in binary", detail: "Generated row i is the number i − 1 written in binary, lowest digit first, then 0s for ever. Every sequence with finitely many 1s is in this list." },
  { key: "periodic", label: "Every repeating pattern", detail: "The patterns 0, 1, 00, 01, 10, 11, 000 … in order of length, each repeated for ever. Every sequence that repeats from the start is in this list." },
  { key: "multiples", label: "Multiples of the row number", detail: "Generated row i has a 1 at positions i, 2i, 3i … and 0 elsewhere." },
  { key: "coin", label: "Coin flips", detail: "Every digit is a fair coin flip fixed by the seed, so the same seed always gives the same list." },
];

/** Digit j of the i-th row generated by a rule. */
export function ruleBit(key, i, j, seed = 1) {
  switch (key) {
    case "binary": return j > 53 ? 0 : Math.floor((i - 1) / 2 ** (j - 1)) % 2;
    case "periodic": {
      const w = (i + 1).toString(2).slice(1);   // i = 1, 2, 3, 4, ... gives "0", "1", "00", "01", ...
      return w.charCodeAt((j - 1) % w.length) - 48;
    }
    case "multiples": return j % i === 0 ? 1 : 0;
    case "coin": return rng((seed + Math.imul(i, 0x9e3779b1) + Math.imul(j, 0x85ebca6b)) >>> 0)() < 0.5 ? 0 : 1;
    default: throw new Error(`unknown rule "${key}"`);
  }
}

/** Read typed rows: one per line, 0s and 1s only, spaces ignored. Returns { rows, errors }. */
export function parseRows(text, { maxRows = 12, maxLength = 64 } = {}) {
  const rows = [], errors = [];
  String(text ?? "").split(/\r?\n/).forEach((line, index) => {
    const s = line.replace(/\s+/g, "");
    if (!s) return;
    const bad = s.match(/[^01]/);
    if (bad) errors.push(`Line ${index + 1} contains "${bad[0]}". Use only 0 and 1.`);
    else if (s.length > maxLength) errors.push(`Line ${index + 1} has ${s.length} digits. The longest pattern allowed is ${maxLength}.`);
    else if (rows.length >= maxRows) { if (!errors.some((e) => e.startsWith("Only the first"))) errors.push(`Only the first ${maxRows} rows are used.`); }
    else rows.push(s);
  });
  return { rows, errors };
}

/**
 * Build a list. Returns
 *   bit(k, j)           digit j of row k
 *   missing(j)          digit j of the flipped diagonal: 1 - bit(j, j)
 *   source(k)           "added" | "typed" | "rule"
 *   firstDifference(k)  the first position where the missing sequence and row k differ (never more than k)
 */
export function makeList({ typed = [], rule = "binary", seed = 1, added = 0 } = {}) {
  const base = (k, j) => (k <= typed.length ? typed[k - 1].charCodeAt((j - 1) % typed[k - 1].length) - 48 : ruleBit(rule, k - typed.length, j, seed));
  // With q sequences added, row k is a generated or typed row when k > q. Otherwise it is the flipped
  // diagonal of the list as it stood when only q - k sequences had been added.
  const listBit = (q, k, j) => (k > q ? base(k - q, j) : flipped(q - k, j));
  const flipped = (q, j) => 1 - listBit(q, j, j);
  const bit = (k, j) => listBit(added, k, j);
  const missing = (j) => flipped(added, j);
  return {
    bit, missing,
    source: (k) => (k <= added ? "added" : k <= added + typed.length ? "typed" : "rule"),
    firstDifference(k) {
      for (let j = 1; j <= k; j++) if (missing(j) !== bit(k, j)) return j;
      throw new Error("the diagonal argument failed");   // cannot happen: they differ at position k by construction
    },
  };
}
