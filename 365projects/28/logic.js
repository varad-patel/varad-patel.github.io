// Day 28: Two Envelopes Paradox. The model, with no DOM code.
//
// One envelope holds X and the other 2X. You are handed one of them at random. X, the smaller amount, is
// drawn from a prior over the powers of two: X = 2^n for n = 0, 1, 2, ... Keeping to powers of two means an
// amount never gives itself away by being odd, and every amount except the lowest could be either envelope.
//
// A prior is one of
//   { kind: "fixed", n }        X = 2^n for certain
//   { kind: "uniform", count }  X is equally likely to be 2^0, 2^1, ..., 2^(count − 1)
//   { kind: "doubling", q }     P(X = 2^n) = (1 − q) q^n for every n >= 0; the mean is infinite when q >= 1/2

export const MAX_N = 1000; // 2^(MAX_N + 1) is still a finite double
const POW2 = Array.from({ length: MAX_N + 2 }, (_, j) => 2 ** j);

/** A message saying what is wrong with a prior, or null if it can be used. */
export function problem(prior) {
  if (!prior || typeof prior !== "object") return "Choose a prior for the smaller amount.";
  if (prior.kind === "fixed") return Number.isInteger(prior.n) && prior.n >= 0 && prior.n <= MAX_N ? null : `The fixed amount must be 2 to a whole-number power from 0 to ${MAX_N}.`;
  if (prior.kind === "uniform") return Number.isInteger(prior.count) && prior.count >= 1 && prior.count <= MAX_N ? null : `The number of equally likely amounts must be a whole number from 1 to ${MAX_N}.`;
  if (prior.kind === "doubling") return typeof prior.q === "number" && prior.q > 0 && prior.q < 1 ? null : "The ratio q must be a number above 0 and below 1.";
  return "Unknown kind of prior.";
}
function need(prior) {
  const message = problem(prior);
  if (message) throw new RangeError(message);
}

/** P(X = 2^n). Zero for anything outside the prior's range. */
export function weight(prior, n) {
  if (!Number.isInteger(n) || n < 0) return 0;
  if (prior.kind === "fixed") return n === prior.n ? 1 : 0;
  if (prior.kind === "uniform") return n < prior.count ? 1 / prior.count : 0;
  return (1 - prior.q) * prior.q ** n;
}

/** Lowest and highest n the smaller amount can take. `last` is Infinity for the doubling prior. */
export function range(prior) {
  need(prior);
  if (prior.kind === "fixed") return { first: prior.n, last: prior.n };
  if (prior.kind === "uniform") return { first: 0, last: prior.count - 1 };
  return { first: 0, last: Infinity };
}

/** E[X]. Infinity for the doubling prior with q >= 1/2, where the sum of (1 − q)(2q)^n does not converge. */
export function meanSmaller(prior) {
  need(prior);
  if (prior.kind === "fixed") return 2 ** prior.n;
  if (prior.kind === "uniform") return (2 ** prior.count - 1) / prior.count;
  return prior.q < 0.5 ? (1 - prior.q) / (1 - 2 * prior.q) : Infinity;
}

/**
 * What seeing the amount 2^j tells you. Null if that amount can never be seen.
 *   chance        P(you see 2^j) = [P(X = 2^j) + P(X = 2^(j−1))] / 2
 *   otherLarger   P(the other envelope holds more | you see 2^j) = P(X = 2^j) / [P(X = 2^j) + P(X = 2^(j−1))]
 *   gain          expected gain from switching, a × otherLarger − (a / 2)(1 − otherLarger)
 *   share         gain as a fraction of the amount seen (the tempting argument says +1/4, always)
 *   contribution  chance × gain: this amount's part of always-switching's expected gain
 */
export function seen(prior, j) {
  need(prior);
  if (!Number.isInteger(j) || j < 0 || j > MAX_N + 1) return null;
  const amount = 2 ** j;
  let chance, otherLarger;
  if (prior.kind === "doubling") {
    // Closed forms, so that large j does not lose the ratio to underflow.
    chance = j === 0 ? (1 - prior.q) / 2 : ((1 - prior.q) * prior.q ** (j - 1) * (1 + prior.q)) / 2;
    otherLarger = j === 0 ? 1 : prior.q / (1 + prior.q);
  } else {
    const here = weight(prior, j), below = weight(prior, j - 1);
    if (here + below === 0) return null;
    chance = (here + below) / 2;
    otherLarger = here / (here + below);
  }
  const gain = amount * otherLarger - (amount / 2) * (1 - otherLarger);
  return { j, amount, chance, otherLarger, gain, share: gain / amount, contribution: chance * gain };
}

/** Every amount that can be seen, lowest first, cut off after `limit` rows. complete is false if there are more. */
export function seenTable(prior, limit = 14) {
  const { first, last } = range(prior);
  const rows = [];
  for (let j = first; j <= last + 1 && rows.length < limit; j++) rows.push(seen(prior, j));
  return { rows, complete: last + 1 - first + 1 <= limit };
}

/**
 * Always-switching's expected gain, added up over the amounts seen from the lowest to 2^j. The sum telescopes to
 * P(X = 2^j) × 2^j / 2, so it returns to zero exactly when the prior's tail is thin enough: a·P(X = a) -> 0.
 */
export function partialGain(prior, j) {
  need(prior);
  return (weight(prior, j) * 2 ** j) / 2;
}

/**
 * Expected winnings of the three strategies. The threshold rule is "switch if you see 2^t or less".
 * It differs from always keeping only when X = 2^t exactly: then you end up with 2X whichever envelope you were
 * handed, instead of 1.5X on average. So its edge is P(X = 2^t) × 2^t / 2, which is finite even when the mean is not.
 */
export function strategyExact(prior, t) {
  if (!Number.isInteger(t)) throw new RangeError("The threshold must be 2 to a whole-number power.");
  const base = 1.5 * meanSmaller(prior);
  const edge = (weight(prior, t) * 2 ** t) / 2;
  return { keep: base, switch: base, threshold: base + edge, edge };
}

/** The t with the largest edge. Null when no single threshold is best (doubling prior with q >= 1/2). */
export function bestThreshold(prior) {
  need(prior);
  if (prior.kind === "fixed") return prior.n;
  if (prior.kind === "uniform") return prior.count - 1;
  return prior.q < 0.5 ? 0 : null;
}

/* ---------------------------------------------------------------- simulation */

/** Draw n, where the smaller amount is 2^n. r is a generator from rng(seed). */
export function drawSmaller(r, prior) {
  if (prior.kind === "fixed") return prior.n;
  if (prior.kind === "uniform") return r.int(0, prior.count - 1);
  // Inverse CDF of the geometric distribution, P(n >= m) = q^m, capped so that 2^(n + 1) stays a finite number.
  // The cap is never reached in practice: the generator has 32 bits, so n stops near 22 / ln(1 / q).
  return Math.max(0, Math.min(MAX_N, Math.floor(Math.log(1 - r()) / Math.log(prior.q))));
}

/** One round: fill the envelopes and hand you one at random. j is the power of two you hold. */
export function deal(r, prior) {
  const n = drawSmaller(r, prior);
  const holdsSmaller = r() < 0.5;
  const j = holdsSmaller ? n : n + 1;
  return { n, holdsSmaller, j, mine: POW2[j], other: POW2[holdsSmaller ? n + 1 : n] };
}

/**
 * Play `rounds` rounds and score three strategies on the same deals: always keep, always switch, and
 * "switch if you see 2^t or less". Returns the average winnings of each; the average gain over always keeping of
 * always switching (switchGain) and of the threshold rule (edge), each with its standard error; how often each
 * amount was seen and how often the other envelope then held more; and the running averages (after each of the
 * first 100 rounds, then about every 5% more) for a chart.
 */
export function simulate(r, prior, rounds, t) {
  need(prior);
  if (!Number.isInteger(rounds) || rounds < 1) throw new RangeError("The number of rounds must be a whole number, 1 or more.");
  if (!Number.isInteger(t)) throw new RangeError("The threshold must be 2 to a whole-number power.");
  let keep = 0, swap = 0, threshold = 0, edge = 0, edgeSq = 0, gain = 0, gainSq = 0, next = 1;
  const count = new Float64Array(MAX_N + 2), larger = new Float64Array(MAX_N + 2);
  const history = [];
  // The same two draws as deal(), written out so that a million rounds do not allocate a million objects.
  for (let i = 1; i <= rounds; i++) {
    const n = drawSmaller(r, prior);
    const holdsSmaller = r() < 0.5;
    const j = holdsSmaller ? n : n + 1;
    const mine = POW2[j], other = POW2[holdsSmaller ? n + 1 : n];
    keep += mine;
    swap += other;
    const d = other - mine;
    gain += d;
    gainSq += d * d;
    if (j <= t) { threshold += other; edge += d; edgeSq += d * d; } else threshold += mine;
    count[j] += 1;
    if (holdsSmaller) larger[j] += 1;
    if (i <= 100 || i >= next || i === rounds) { history.push([i, keep / i, swap / i, threshold / i]); next = Math.ceil(i * 1.05); }
  }
  const amounts = new Map();
  count.forEach((c, j) => { if (c) amounts.set(j, { count: c, otherLarger: larger[j] }); });
  const se = (sum, sumSq) => Math.sqrt(Math.max(0, sumSq / rounds - (sum / rounds) ** 2) / rounds);
  return {
    rounds, keep: keep / rounds, switch: swap / rounds, threshold: threshold / rounds,
    switchGain: gain / rounds, switchGainSe: se(gain, gainSq), edge: edge / rounds, edgeSe: se(edge, edgeSq), amounts, history,
  };
}
