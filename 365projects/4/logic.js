// Day 4: Bayes Intuition Lab. The model, with no DOM code.
// One yes/no test for one yes/no condition, worked out as probabilities and as whole people.

const isProb = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;

/**
 * Scenarios. "source" is set only where the numbers are those of a published problem;
 * the rest are round numbers chosen to show a pattern, and the page labels them as illustrative.
 */
export const PRESETS = [
  { key: "textbook", label: "Textbook mammogram problem", prior: 0.01, sens: 0.8, fpr: 0.096, source: true,
    note: "The numbers of the problem David Eddy put to doctors in 1982, as rounded by Gigerenzer and Hoffrage (1995). They are the textbook's numbers, not current clinical figures." },
  { key: "harvard", label: "Harvard Medical School question", prior: 0.001, sens: 1, fpr: 0.05, source: true,
    note: "Casscells, Schoenberger and Graboys (1978): a condition found in 1 person in 1,000 and a test with a 5% false-positive rate. The question gives no sensitivity, so it is taken as 100%." },
  { key: "rare", label: "Rare condition, excellent test (illustrative)", prior: 0.001, sens: 0.99, fpr: 0.01,
    note: "Illustrative numbers: a test that is right 99% of the time either way, used on a condition that 1 person in 1,000 has." },
  { key: "workplace", label: "Random workplace drug test (illustrative)", prior: 0.05, sens: 0.95, fpr: 0.05,
    note: "Illustrative numbers: a test that is 95% accurate either way, used on a workforce where 1 in 20 would test positive truthfully." },
  { key: "symptoms", label: "Patient with symptoms (illustrative)", prior: 0.3, sens: 0.9, fpr: 0.1,
    note: "Illustrative numbers: the same kind of test, used on someone a doctor already thinks has a 30% chance of the condition." },
  { key: "outbreak", label: "Rapid test in an outbreak (illustrative)", prior: 0.1, sens: 0.7, fpr: 0.01,
    note: "Illustrative numbers: a test that misses three cases in ten but almost never raises a false alarm, used when 1 person in 10 is infected." },
];

/**
 * Bayes' theorem for one test result.
 * prior: P(condition). sens: P(positive | condition). fpr: P(positive | no condition).
 * afterPositive and afterNegative are P(condition | result), or null when that result cannot happen.
 */
export function bayes(prior, sens, fpr) {
  if (![prior, sens, fpr].every(isProb)) return { error: "The base rate, sensitivity and false-positive rate must each be between 0% and 100%." };
  const joint = { tp: prior * sens, fn: prior * (1 - sens), fp: (1 - prior) * fpr, tn: (1 - prior) * (1 - fpr) };
  const pPos = joint.tp + joint.fp;
  const pNeg = joint.fn + joint.tn;
  return {
    prior, sens, fpr, joint, pPos, pNeg,
    afterPositive: pPos > 0 ? joint.tp / pPos : null,
    afterNegative: pNeg > 0 ? joint.fn / pNeg : null,
    // Likelihood ratios: what a result multiplies the odds of the condition by. null when 0/0.
    lrPositive: fpr > 0 ? sens / fpr : sens > 0 ? Infinity : null,
    lrNegative: fpr < 1 ? (1 - sens) / (1 - fpr) : sens < 1 ? Infinity : null,
  };
}

/**
 * The same thing as whole people: n people split into true positives, false negatives, false positives
 * and true negatives. The four exact shares are rounded by the largest-remainder rule so they always add to n.
 */
export function crowd(prior, sens, fpr, n = 1000) {
  const b = bayes(prior, sens, fpr);
  if (b.error) return b;
  if (!Number.isInteger(n) || n < 1) return { error: "The crowd must be a whole number of people, at least 1." };
  const keys = ["tp", "fn", "fp", "tn"];
  const exact = keys.map((k) => b.joint[k] * n);
  const whole = exact.map((v) => Math.floor(v + 1e-9));
  let left = n - whole.reduce((s, v) => s + v, 0);
  const byRemainder = exact.map((v, i) => [v - whole[i], i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  for (let j = 0; left > 0; j++, left--) whole[byRemainder[j % 4][1]]++;
  const [tp, fn, fp, tn] = whole;
  return {
    n, tp, fn, fp, tn,
    sick: tp + fn, well: fp + tn, positive: tp + fp, negative: fn + tn,
    afterPositive: tp + fp > 0 ? tp / (tp + fp) : null,
    afterNegative: fn + tn > 0 ? fn / (fn + tn) : null,
  };
}

/**
 * Probability of the condition after a run of results from the same test, e.g. "++" or "+-".
 * Assumes the test's errors are independent from one run to the next. null if a result is impossible.
 */
export function sequence(prior, sens, fpr, results) {
  let p = prior;
  for (const r of results) {
    if (r !== "+" && r !== "-") return null;
    const b = bayes(p, sens, fpr);
    if (b.error) return null;
    p = r === "+" ? b.afterPositive : b.afterNegative;
    if (p == null) return null;
  }
  return isProb(p) ? p : null;
}

/** Posterior against prior for a fixed test, on priors spaced evenly in log terms from `from` up to 1. */
export function curve(sens, fpr, points = 121, from = 0.0001) {
  const out = [];
  for (let i = 0; i < points; i++) {
    const prior = i === points - 1 ? 1 : from ** (1 - i / (points - 1));
    const b = bayes(prior, sens, fpr);
    out.push({ prior, afterPositive: b.afterPositive, afterNegative: b.afterNegative });
  }
  return out;
}

/** The base rate at which a positive result means a `target` chance of the condition. null if no base rate does. */
export function priorFor(target, sens, fpr) {
  if (![target, sens, fpr].every(isProb) || sens <= 0) return null;
  const denom = sens * (1 - target) + target * fpr;
  return denom > 0 ? (target * fpr) / denom : null;
}

/**
 * Compare a guess (a probability) with the right answer after a positive result.
 * verdict: "close" (within five points), "sensitivity" or "specificity" (the guess matches that property
 * of the test rather than the answer), otherwise "over" or "under".
 */
export function judgeGuess(guess, prior, sens, fpr) {
  const truth = bayes(prior, sens, fpr).afterPositive;
  if (!isProb(guess) || truth == null) return null;
  const gap = guess - truth;
  const near = (a, b) => Math.abs(a - b) <= 0.05 + 1e-12;
  const verdict = near(guess, truth) ? "close" : near(guess, sens) ? "sensitivity" : near(guess, 1 - fpr) ? "specificity" : gap > 0 ? "over" : "under";
  return { guess, truth, gap, verdict };
}

/** A scenario to guess, drawn with the kit's seeded generator so the sequence is reproducible. */
export function randomScenario(r) {
  return {
    prior: r.pick([0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3]),
    sens: r.pick([0.7, 0.8, 0.9, 0.95, 0.99]),
    fpr: r.pick([0.01, 0.02, 0.05, 0.1, 0.15, 0.2]),
  };
}

/**
 * Slider positions for a probability: every value between lo and hi whose distance from the nearer of
 * 0 and 1 has at most two significant figures (0.011, 0.096, 0.5, 0.904, 0.9989 ...). This gives fine
 * steps near 0% and 100%, where tests and base rates actually live, and only tidy numbers.
 */
export function probGrid(lo = 0.0001, hi = 0.99) {
  const set = new Set();
  for (let e = -8; e <= -2; e++) {
    for (let m = 10; m <= 99; m++) {
      const q = Number(`${m}e${e}`);
      if (q > 0.5) continue;
      set.add(q);
      set.add(Number((1 - q).toPrecision(12)));
    }
  }
  set.add(0);
  set.add(1);
  return [...set].filter((p) => p >= lo && p <= hi).sort((a, b) => a - b);
}
