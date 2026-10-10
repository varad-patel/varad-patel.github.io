// Day 19: Sleeping Beauty Simulator. The model, with no DOM code.
// A coin lands heads with probability p. Heads: Beauty is woken once. Tails: she is woken k times,
// with her memory of each waking erased before the next. The standard problem is p = 1/2, k = 2.

/** A message saying what is wrong with a set-up, or null if it can be run. */
export function problem({ p, k } = {}) {
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) return "The chance of heads must be a number from 0 to 1.";
  if (!Number.isInteger(k) || k < 1) return "The number of awakenings after tails must be a whole number, 1 or more.";
  return null;
}
function need(setup) {
  const message = problem(setup);
  if (message) throw new RangeError(message);
}
function needShare(x, name) {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1) throw new RangeError(`${name} must be a number from 0 to 1.`);
}

/**
 * The exact long-run values.
 *   awakenings    expected awakenings per experiment, p + k(1 − p)
 *   byExperiment  share of experiments in which the coin landed heads, p
 *   byAwakening   share of awakenings that fall in a heads experiment, p / (p + k(1 − p))
 *   thirder, halfer  the credence in heads each position recommends on waking, and on being told it is the first day
 */
export function exact(setup) {
  need(setup);
  const { p, k } = setup;
  const awakenings = p + k * (1 - p);
  return {
    awakenings,
    byExperiment: p,
    byAwakening: p / awakenings,
    // Elga: every awakening counts equally, so heads-and-Monday has weight p and each tails awakening has weight 1 − p.
    thirder: { waking: p / awakenings, monday: p },
    // Lewis: waking tells her nothing about the coin, so heads keeps p and the tails awakenings share 1 − p between them.
    halfer: { waking: p, monday: p / (p + (1 - p) / k) },
  };
}

/* ---------------------------------------------------------------- simulation */

/** A fresh record of a run: the counts, the running shares for the chart, and the latest experiments. */
export const newRun = () => ({ tally: { experiments: 0, heads: 0, awakenings: 0, headsAwakenings: 0 }, history: [], recent: [] });

/** Toss the coin once. r is a generator from rng(seed). */
export function runExperiment(r, { p, k }) {
  const heads = r() < p;
  return { heads, awakenings: heads ? 1 : k };
}

/** Add one experiment to a bare tally. */
export function add(tally, e) {
  tally.experiments += 1;
  tally.awakenings += e.awakenings;
  if (e.heads) { tally.heads += 1; tally.headsAwakenings += e.awakenings; }
  return tally;
}
function record(run, e, keep) {
  add(run.tally, e);
  run.recent.push(e);
  if (run.recent.length > keep) run.recent.shift();
}
function mark(run) {
  const s = shares(run.tally);
  run.history.push([run.tally.experiments, s.byExperiment, s.byAwakening]);
}

/** The two tallies. Both are null before the first experiment. */
export function shares(tally) {
  return {
    byExperiment: tally.experiments ? tally.heads / tally.experiments : null,
    byAwakening: tally.awakenings ? tally.headsAwakenings / tally.awakenings : null,
  };
}

/** Add one finished experiment to a run: the tally, the latest-experiments list and a point for the chart. */
export function commit(run, e, keep = 40) {
  record(run, e, keep);
  mark(run);
  return run;
}

/**
 * Run n experiments and add them to `run`. history gets a point after each of the first 100 experiments and then
 * about every 5% more, which is enough to draw the running shares on a log axis without storing every step.
 */
export function simulate(r, setup, n, run = newRun(), keep = 40) {
  need(setup);
  if (!Number.isInteger(n) || n < 0) throw new RangeError("The number of experiments must be a whole number, 0 or more.");
  let next = run.history.length ? Math.ceil(run.history.at(-1)[0] * 1.05) : 1;
  for (let i = 0; i < n; i++) {
    record(run, runExperiment(r, setup), keep);
    const done = run.tally.experiments;
    if (done <= 100 || done >= next || i === n - 1) { mark(run); next = Math.ceil(done * 1.05); }
  }
  return run;
}

/* ---------------------------------------------------------------------- bets */
// A ticket costs `price` and pays 1 if the coin landed heads. Buying it is a good deal exactly when the
// price is below the chance of collecting, so the break-even price is the probability the bet is "about".

/** Expected profit per experiment from one ticket per experiment, and from one ticket at every awakening. */
export function betExact(setup, price) {
  need(setup);
  needShare(price, "The ticket price");
  const { p, k } = setup;
  const awakenings = p + k * (1 - p);
  return {
    once: p - price,
    every: p * (1 - price) - (1 - p) * k * price,
    breakEven: { once: p, every: p / awakenings },
  };
}

/** Profit actually made on a simulated run by each way of selling the ticket. */
export function betTally(tally, price) {
  needShare(price, "The ticket price");
  return {
    once: tally.heads * (1 - price) - (tally.experiments - tally.heads) * price,
    every: tally.headsAwakenings * (1 - price) - (tally.awakenings - tally.headsAwakenings) * price,
  };
}

/* ------------------------------------------------------------------- scoring */
// The Brier (quadratic) rule: the penalty for saying `credence` is (credence − outcome)², where the outcome is
// 1 for heads and 0 for tails. Lower is better, and stating the true chance minimises the expected penalty.

export const brier = (credence, heads) => (credence - (heads ? 1 : 0)) ** 2;

/** Expected penalty for always answering `credence`: averaged over experiments, and averaged over awakenings. */
export function brierExact(setup, credence) {
  need(setup);
  needShare(credence, "A credence");
  const { p, k } = setup;
  return {
    perExperiment: p * (1 - credence) ** 2 + (1 - p) * credence ** 2,
    perAwakening: (p * (1 - credence) ** 2 + k * (1 - p) * credence ** 2) / (p + k * (1 - p)),
  };
}

/** Average penalty a fixed answer earns on a simulated run, counted each way. Null before the first experiment. */
export function brierTally(tally, credence) {
  needShare(credence, "A credence");
  if (!tally.experiments) return { perExperiment: null, perAwakening: null };
  const right = (1 - credence) ** 2;
  const wrong = credence ** 2;
  return {
    perExperiment: (tally.heads * right + (tally.experiments - tally.heads) * wrong) / tally.experiments,
    perAwakening: (tally.headsAwakenings * right + (tally.awakenings - tally.headsAwakenings) * wrong) / tally.awakenings,
  };
}
