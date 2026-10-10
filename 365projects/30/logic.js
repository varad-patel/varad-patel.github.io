// Day 30: Sunrise and Induction Calculator. The model, with no DOM code.
//
// An event has happened s times and failed to happen f times. Treat the trials as exchangeable with an
// unknown underlying chance p, give p a Beta(a, b) prior, and the posterior is Beta(a + s, b + f).
// Everything on the page is a property of that posterior.

import { stats } from "../kit/kit.js";

export const MAX_COUNT = 1e8;   // observations
export const MAX_PRIOR = 1e6;   // prior parameters
export const MAX_RUN = 1e9;     // length of a future run

/** The named priors. a and b act like successes and failures seen before any data. */
export const PRIORS = [
  { key: "uniform", label: "Uniform (Laplace)", a: 1, b: 1, note: "Every underlying chance from 0% to 100% is equally likely. This gives Laplace's rule of succession." },
  { key: "jeffreys", label: "Jeffreys", a: 0.5, b: 0.5, note: "Puts extra weight near 0% and 100%: the event is probably either very rare or very reliable." },
  { key: "haldane", label: "Haldane", a: 0, b: 0, note: "The limit of knowing nothing at all. It is not a proper distribution, and it only gives one after both a success and a failure have been seen." },
  { key: "sceptical", label: "Sceptical", a: 1, b: 10, note: "Starts out doubting that the event happens at all, as if ten failures had already been seen." },
];

/** Example records. Only the first is historical, and it is Laplace's own arithmetic. */
export const EXAMPLES = [
  { key: "sunrise", label: "Laplace's sunrise", s: 1826213, f: 0, note: "Laplace's example: 5,000 years of recorded history, which he counted as 1,826,213 days, with a sunrise on every one." },
  { key: "ten", label: "Ten out of ten", s: 10, f: 0, note: "A short unbroken run, where the choice of prior still decides the answer." },
  { key: "nine", label: "Nine out of ten", s: 9, f: 1, note: "One failure is enough to make every prior a proper distribution." },
  { key: "third", label: "Once in three tries", s: 1, f: 2, note: "Very little data. The priors disagree widely." },
  { key: "never", label: "Never in fifty", s: 0, f: 50, note: "Something that has not happened yet. How likely is a first time?" },
  { key: "none", label: "No data yet", s: 0, f: 0, note: "Nothing observed, so each answer is the prior speaking for itself." },
];

const isCount = (x) => Number.isInteger(x) && x >= 0 && x <= MAX_COUNT;
const isPriorParam = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_PRIOR;

/** A message describing what is wrong with the inputs, or null if they are fine. */
export function problem({ s, f, a, b, m }) {
  if (!isCount(s)) return `The number of times it happened must be a whole number from 0 to ${MAX_COUNT.toLocaleString("en-GB")}.`;
  if (!isCount(f)) return `The number of times it did not happen must be a whole number from 0 to ${MAX_COUNT.toLocaleString("en-GB")}.`;
  if (a !== undefined && !isPriorParam(a)) return `The prior's a must be a number from 0 to ${MAX_PRIOR.toLocaleString("en-GB")}.`;
  if (b !== undefined && !isPriorParam(b)) return `The prior's b must be a number from 0 to ${MAX_PRIOR.toLocaleString("en-GB")}.`;
  if (m !== undefined && !(Number.isInteger(m) && m >= 1 && m <= MAX_RUN)) return `The length of the run must be a whole number from 1 to ${MAX_RUN.toLocaleString("en-GB")}.`;
  return null;
}

/* ---------- special functions ---------- */

/** ln Γ(x + d) − ln Γ(x), without the cancellation that subtracting two huge log-gammas would bring. */
export function lnGammaRatio(x, d) {
  if (d === 0) return 0;
  if (x < 1e4) return stats.logGamma(x + d) - stats.logGamma(x);
  // Difference of two Stirling series, rearranged so that the large terms cancel analytically.
  return (x - 0.5) * Math.log1p(d / x) + d * (Math.log(x + d) - 1) + 1 / (12 * (x + d)) - 1 / (12 * x);
}
const lnBeta = (a, b) => stats.logGamma(Math.min(a, b)) - lnGammaRatio(Math.max(a, b), Math.min(a, b));

// Continued fraction for the incomplete beta function (modified Lentz's method).
function betaFraction(x, a, b) {
  const TINY = 1e-300;
  const fix = (v) => (Math.abs(v) < TINY ? TINY : v);
  let c = 1;
  let d = 1 / fix(1 - ((a + b) * x) / (a + 1));
  let h = d;
  for (let m = 1; m <= 200000; m++) {
    const m2 = 2 * m;
    let t = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 / fix(1 + t * d);
    c = fix(1 + t / c);
    h *= d * c;
    t = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 / fix(1 + t * d);
    c = fix(1 + t / c);
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < 1e-15) break;
  }
  return h;
}

/** Regularised incomplete beta function: P(p ≤ x) for p ~ Beta(a, b), with a, b > 0. */
export function betaCdf(x, a, b) {
  if (!(a > 0 && b > 0)) return NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lnBeta(a, b));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(x, a, b)) / a : 1 - (front * betaFraction(1 - x, b, a)) / b;
}

/** The value x with P(p ≤ x) = q, found by bisection. */
export function betaQuantile(q, a, b) {
  if (!(a > 0 && b > 0) || !(q >= 0 && q <= 1)) return NaN;
  if (q === 0) return 0;
  if (q === 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (betaCdf(mid, a, b) < q) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------- the posterior ---------- */

/**
 * A credible interval for the underlying chance under Beta(A, B). Central (equal tails), except when the
 * density is highest at an end of the range: then the interval is one-sided and includes that end, so
 * that it never leaves out the most probable values. kind: "central" | "upper" | "lower".
 */
export function credible(A, B, level = 0.95) {
  if (!(A > 0 && B > 0)) return null;
  if (B <= 1 && A > 1) return { lo: betaQuantile(1 - level, A, B), hi: 1, kind: "upper" };
  if (A <= 1 && B > 1) return { lo: 0, hi: betaQuantile(level, A, B), kind: "lower" };
  return { lo: betaQuantile((1 - level) / 2, A, B), hi: betaQuantile((1 + level) / 2, A, B), kind: "central" };
}

/**
 * Chance that the next m trials are all successes, under a Beta(A, B) posterior:
 * the product of (A + i) / (A + B + i) for i = 0 .. m − 1. null when A + B = 0 (no information at all).
 */
export function runProbability(A, B, m) {
  if (!(A + B > 0)) return null;
  if (m === 0 || B === 0) return 1;
  if (A === 0) return 0;
  return Math.exp(lnGammaRatio(A, B) - lnGammaRatio(A + m, B));
}

/**
 * The shortest future run that is no better than an even bet: the smallest m with runProbability ≤ 1/2.
 * The comparison allows for rounding, because under Laplace's rule the probability lands exactly on 1/2.
 */
export function evenRun(A, B) {
  if (!(A + B > 0)) return null;
  if (B === 0) return Infinity;
  if (A === 0) return 1;
  const better = (m) => runProbability(A, B, m) > 0.5 * (1 + 1e-9);
  let lo = 0, hi = 1;
  while (better(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 1e15) return Infinity;   // ponytail: runs beyond 10^15 are reported as unbounded
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (better(mid)) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * Everything the page shows for one prior. prior is { a, b }; s successes, f failures; m is the future run length.
 * next: chance the next trial is a success, (a + s) / (a + b + s + f); null if that is 0 / 0.
 * proper: whether the posterior is a real probability distribution. When it is not (Haldane's prior after
 * an unbroken run), next is still the limiting value, 0 or 1, but there is no interval.
 */
export function analyse(prior, s, f, m = 1, level = 0.95) {
  const A = prior.a + s, B = prior.b + f;
  const proper = A > 0 && B > 0;
  const defined = A + B > 0;
  return {
    A, B, proper,
    next: defined ? A / (A + B) : null,
    fail: defined ? B / (A + B) : null,
    odds: !defined ? null : B > 0 ? A / B : Infinity,          // odds on a success next time
    interval: proper ? credible(A, B, level) : null,
    sd: proper ? Math.sqrt((A * B) / ((A + B) ** 2 * (A + B + 1))) : null,
    run: runProbability(A, B, m),
    evenRun: evenRun(A, B),
  };
}

/** Posterior density of the underlying chance. */
export const density = (x, A, B) => stats.betaPdf(x, A, B);
