// Day 18: Newcomb's Problem Calculator. The model, with no DOM code.
//
// Two boxes. The clear box holds K. The opaque box holds M if a predictor foresaw that you would take only the opaque
// box, and nothing if it foresaw that you would take both. The predictor is right with probability p whichever you do.
// A choice is "one" (the opaque box only) or "two" (both boxes).

import { rng } from "../kit/kit.js";

export const LIMITS = { money: 1e12, plays: 1e6 };
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** What is wrong with the inputs, as sentences. Empty when they are usable. */
export function validate({ p, M, K }) {
  const out = [];
  if (!isNum(p) || p < 0 || p > 1) out.push("The predictor's accuracy must be between 0% and 100%.");
  if (!isNum(M) || M <= 0 || M > LIMITS.money) out.push("The opaque box's prize must be more than 0 (and at most a trillion).");
  if (!isNum(K) || K < 0 || K > LIMITS.money) out.push("The clear box's amount must be 0 or more (and at most a trillion).");
  return out;
}

/** What you walk away with. */
export const payoff = (choice, full, M, K) => (full ? M : 0) + (choice === "two" ? K : 0);

/* ------------------------------------------------------------------ evidential */

// Condition on your own choice: if you one-box, the box is full with probability p; if you two-box, with 1 - p.
export const oneBoxValue = (p, M) => p * M;
export const twoBoxValue = (p, M, K) => (1 - p) * M + K;

/** The accuracy at which the two are level: pM = (1 - p)M + K, so p* = (M + K) / 2M = 1/2 + K / 2M. Above 1 means never. */
export const threshold = (M, K) => (M + K) / (2 * M);

export function evidential(p, M, K) {
  const one = oneBoxValue(p, M), two = twoBoxValue(p, M, K);
  return { one, two, best: one > two ? "one" : two > one ? "two" : "tie", gap: one - two, threshold: threshold(M, K) };
}

/* ---------------------------------------------------------------------- causal */

/**
 * Hold the contents fixed: the box is already full or empty, with whatever probability q you give to "full",
 * and your choice cannot change it. Then both boxes beat one box by exactly K, for every q.
 */
export function causal(q, M, K) {
  return { one: q * M, two: q * M + K, gap: -K, best: K > 0 ? "two" : "tie" };
}

/** The four possible results, laid out to show the dominance: in each column the second row is K higher. */
export const payoffTable = (M, K) => ({
  one: { full: payoff("one", true, M, K), empty: payoff("one", false, M, K) },
  two: { full: payoff("two", true, M, K), empty: payoff("two", false, M, K) },
});

/* ------------------------------------------------------------------ simulation */

/**
 * `plays` committed one-boxers and `plays` committed two-boxers each face a predictor of accuracy p.
 * For each strategy returns how often the box was full or empty, the mean winnings, and `switched`: the mean they
 * would have won by making the other choice with the same box in front of them.
 * trace is the running mean of each strategy at about `points` log-spaced play counts, for a chart.
 */
export function simulate({ p, M, K, plays = 10000, seed = 1, points = 60 }) {
  const n = Math.max(1, Math.min(LIMITS.plays, Math.floor(plays)));
  const r = rng(seed);
  const marks = new Set();
  for (let i = 0; i <= points; i++) marks.add(Math.max(1, Math.round(n ** (i / points))));
  const side = () => ({ full: 0, empty: 0, total: 0, other: 0 });
  const one = side(), two = side();
  const trace = [];
  for (let i = 1; i <= n; i++) {
    // A correct prediction of a one-boxer fills the box; a correct prediction of a two-boxer leaves it empty.
    const fullForOne = r() < p;
    const fullForTwo = !(r() < p);
    one[fullForOne ? "full" : "empty"]++;
    two[fullForTwo ? "full" : "empty"]++;
    one.total += payoff("one", fullForOne, M, K);
    two.total += payoff("two", fullForTwo, M, K);
    one.other += payoff("two", fullForOne, M, K);
    two.other += payoff("one", fullForTwo, M, K);
    if (marks.has(i)) trace.push({ n: i, one: one.total / i, two: two.total / i });
  }
  const finish = (s, right) => ({ full: s.full, empty: s.empty, plays: n, mean: s.total / n, switched: s.other / n, accuracy: right / n });
  return { plays: n, seed, one: finish(one, one.full), two: finish(two, two.empty), trace };
}

/* ------------------------------------------------- a predictor that learns you */

/**
 * Predict the next choice from the choices so far. Take the last `depth` choices, find every earlier time the same
 * run occurred, and predict whatever followed it most often. If that run has never occurred before, or the count is
 * level, try a shorter run, down to no context at all (the commonest choice so far). If still level, predict a repeat
 * of the last choice. With no history at all, predict "one".
 */
export function predict(history, depth = 3) {
  const n = history.length;
  if (!n) return "one";
  for (let k = Math.min(depth, n - 1); k >= 0; k--) {
    let one = 0, two = 0;
    for (let i = k; i < n; i++) {
      let match = true;
      for (let j = 1; j <= k; j++) if (history[i - j] !== history[n - j]) { match = false; break; }
      if (match) { if (history[i] === "one") one++; else two++; }
    }
    if (one !== two) return one > two ? "one" : "two";
  }
  return history[n - 1];
}

/** Play one round against the learning predictor. rounds is the list so far; returns the new round. */
export function playRound(rounds, choice, M, K, depth = 3) {
  const predicted = predict(rounds.map((x) => x.choice), depth);
  const full = predicted === "one";
  return { choice, predicted, full, correct: predicted === choice, won: payoff(choice, full, M, K) };
}

/** Running totals for a list of rounds. Means are NaN where there is nothing to average. */
export function tally(rounds) {
  const mean = (list) => (list.length ? list.reduce((s, x) => s + x.won, 0) / list.length : NaN);
  const by = (c) => { const list = rounds.filter((x) => x.choice === c); return { rounds: list.length, mean: mean(list) }; };
  let hits = 0;
  const running = rounds.map((x, i) => { if (x.correct) hits++; return hits / (i + 1); });
  return { rounds: rounds.length, hits, accuracy: rounds.length ? hits / rounds.length : NaN, total: rounds.reduce((s, x) => s + x.won, 0), mean: mean(rounds), one: by("one"), two: by("two"), running };
}

export const PRESETS = [
  { key: "nozick", label: "Nozick's amounts", M: 1000000, K: 1000, blurb: "The amounts in Robert Nozick's 1969 paper: a million in the opaque box, a thousand in the clear one." },
  { key: "close", label: "A closer call", M: 2000, K: 1000, blurb: "The clear box holds half as much as the prize, so the predictor has to be good before one box looks better." },
  { key: "even", label: "Equal boxes", M: 1000, K: 1000, blurb: "Both boxes hold the same amount. One box can then do no better than draw, however good the predictor is." },
];
