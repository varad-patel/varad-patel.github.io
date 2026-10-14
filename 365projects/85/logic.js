// Day 85: Kelly Criterion Lab. The model, with no DOM code.
// A repeated bet that wins b for each 1 staked with chance p and loses the stake otherwise; a bettor who stakes a
// fixed fraction f of the current bankroll each time (Kelly 1956).

import { rng, stats } from "../kit/kit.js";

export const LIMITS = {
  odds: { min: 0.01, max: 1000 }, // net odds b: the profit on a winning stake of 1
  chance: { min: 0, max: 99.9 }, // % (a sure thing is not a bet)
  edge: { min: -100 }, // %; the most is set by the odds and the 99.9% cap on the chance
  stake: { min: 0, max: 99 }, // % of the bankroll
  bets: { min: 10, max: 2000 },
  line: { min: 1, max: 99 }, // the ruin line, % of the starting bankroll
  seed: { min: 0, max: 4294967295 },
};
export const BETTORS = [1000, 2000, 5000, 10000];

/** Chance of winning from the edge (expected profit per 1 staked) and the odds: edge = p (1 + b) - 1. */
export const chanceFromEdge = (edge, b) => (1 + edge) / (1 + b);
export const edgeOf = (p, b) => p * (1 + b) - 1;
/** The most the edge can be at these odds, with the chance capped at 99.9%. */
export const maxEdge = (b) => edgeOf(LIMITS.chance.max / 100, b);

/** Kelly's stake: f* = p - (1 - p) / b = edge / b, or nothing when the edge is not positive. */
export const kelly = (p, b) => Math.max(0, p - (1 - p) / b);

/** Expected log growth per bet, g(f) = p ln(1 + b f) + (1 - p) ln(1 - f), for 0 <= f < 1. */
export function growth(f, p, b) {
  const win = p > 0 ? p * Math.log1p(b * f) : 0;
  const lose = p < 1 ? (1 - p) * Math.log1p(-f) : 0;
  return win + lose;
}
/** Its value at the Kelly stake in closed form: p ln(p(1 + b)) + (1 - p) ln((1 - p)(1 + b) / b), for a positive edge. */
export const kellyGrowth = (p, b) => p * Math.log(p * (1 + b)) + (1 - p) * Math.log(((1 - p) * (1 + b)) / b);
/**
 * The stake above Kelly at which the growth rate falls back to zero, by bisection: about twice Kelly for a small
 * edge, but from about 1.1 to 2.5 times Kelly across the bets this page allows. null when there is no positive edge,
 * or when growth stays positive for every stake a double can tell apart from the whole bankroll.
 */
export function growthZero(p, b) {
  const k = kelly(p, b);
  if (!(k > 0)) return null;
  let lo = k, hi = 1 - 1e-15;
  if (growth(hi, p, b) > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-15; i++) { const m = (lo + hi) / 2; if (growth(m, p, b) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** Variance of the log return of one bet. */
export const logVariance = (f, p, b) => p * (1 - p) * (Math.log1p(b * f) - Math.log1p(-f)) ** 2;

/**
 * Check what the visitor typed. mode "edge" uses edge (%), mode "chance" uses chance (%). Returns
 * { ok, p, b, edge, errors: [{ key, message }] } with p and edge as decimals.
 */
export function readBet({ mode, odds, edge, chance }) {
  const errors = [];
  const b = odds;
  if (!Number.isFinite(b)) errors.push({ key: "odds", message: `Enter the odds as a number from ${LIMITS.odds.min} to ${LIMITS.odds.max.toLocaleString("en-GB")}.` });
  else if (b < LIMITS.odds.min || b > LIMITS.odds.max) errors.push({ key: "odds", message: `The odds must be from ${LIMITS.odds.min} to ${LIMITS.odds.max.toLocaleString("en-GB")}: the profit on a winning stake of 1.` });
  let p = NaN, e = NaN;
  if (mode === "chance") {
    if (!Number.isFinite(chance)) errors.push({ key: "chance", message: "Enter the chance of winning as a percentage, from 0 to 99.9." });
    else if (chance < LIMITS.chance.min || chance > LIMITS.chance.max) errors.push({ key: "chance", message: chance > LIMITS.chance.max ? "The chance must be below 100%: a sure thing is not a bet. Use at most 99.9." : "The chance cannot be below 0%." });
    else { p = chance / 100; if (!errors.length) e = edgeOf(p, b); }
  } else {
    if (!Number.isFinite(edge)) errors.push({ key: "edge", message: "Enter the edge as a percentage of the stake, such as 5 for a 5% edge." });
    else if (edge < LIMITS.edge.min) errors.push({ key: "edge", message: "The edge cannot be below -100%: at worst every stake is lost." });
    else if (!errors.length) {
      const top = maxEdge(b) * 100;
      if (edge > top + 1e-9) errors.push({ key: "edge", message: `At odds of ${fmtOdds(b)} to 1 the edge can be at most ${top.toFixed(2)}%: more would mean winning more than ${LIMITS.chance.max}% of the time.` });
      else { e = edge / 100; p = Math.min(chanceFromEdge(e, b), LIMITS.chance.max / 100); }
    }
  }
  return { ok: !errors.length, p, b, edge: e, errors };
}
const fmtOdds = (b) => String(Number(b.toPrecision(6)));

/** The four stakes compared: half Kelly, Kelly, twice Kelly and the visitor's own. f >= 1 cannot be staked. */
export function strategies(p, b, stake) {
  const k = kelly(p, b);
  return [
    { key: "half", label: "Half Kelly", f: k / 2 },
    { key: "kelly", label: "Kelly", f: k },
    { key: "double", label: "Twice Kelly", f: 2 * k },
    { key: "yours", label: "Your stake", f: stake },
  ].map((s) => ({ ...s, possible: s.f < 1 }));
}

/** log wealth after w wins and l losses, as a multiple of the start: w ln(1 + b f) + l ln(1 - f). */
const logWealth = (w, l, A, B) => (w ? w * A : 0) + (l ? l * B : 0);
const TOL = 1e-12; // log-wealth comparisons: a bankroll exactly on a line counts as on it

/**
 * Exact distribution of the bankroll after M bets at stake f: it depends only on the number of wins W, which is
 * binomial(M, p). Returns the median multiple of the starting bankroll, the chance of ending below the start, and
 * the mean multiple, (1 + f edge)^M, each also as a natural log (logMedian, logMean), because with long odds and
 * many bets the multiples run far beyond what a number can hold.
 */
export function finalExact(f, p, b, M) {
  const A = Math.log1p(b * f), B = Math.log1p(-f);
  let cum = 0, below = 0, median = null;
  for (let w = 0; w <= M; w++) {
    const pr = stats.binomPmf(w, M, p);
    const lw = logWealth(w, M - w, A, B);
    if (lw < -TOL) below += pr;
    cum += pr;
    if (median === null && cum >= 0.5 - 1e-12) median = lw;
  }
  const logMean = M * Math.log1p(f * edgeOf(p, b));
  return { median: Math.exp(median ?? 0), logMedian: median ?? 0, below: Math.min(1, below), mean: Math.exp(logMean), logMean };
}

/**
 * Exact chance that the bankroll falls to `line` (a multiple of the start, such as 0.5) or below at some point in
 * M bets, by dynamic programming over the number of wins so far: after t bets with w wins the bankroll is
 * (1 + b f)^w (1 - f)^(t - w). O(M^2) steps.
 */
export function ruinExact(f, p, b, M, line) {
  if (f <= 0) return 0;
  const A = Math.log1p(b * f), B = Math.log1p(-f), L = Math.log(line);
  let alive = new Float64Array(M + 2), next = new Float64Array(M + 2);
  alive[0] = 1;
  let ruined = 0;
  for (let t = 0; t < M; t++) {
    next.fill(0, 0, t + 2);
    for (let w = 0; w <= t; w++) {
      const pr = alive[w];
      if (!pr) continue;
      next[w + 1] += pr * p;
      next[w] += pr * (1 - p);
    }
    for (let w = 0; w <= t + 1; w++) if (next[w] && logWealth(w, t + 1 - w, A, B) <= L + TOL) { ruined += next[w]; next[w] = 0; }
    [alive, next] = [next, alive];
  }
  return Math.min(1, ruined);
}

/**
 * Long-run chance of ever falling to `line`, treating log wealth as Brownian motion with the bet's drift g and
 * variance v per bet: exp(-2 g a / v) with a = -ln(line) when g > 0, and certainty when g <= 0. At a fraction c of
 * Kelly and a small edge this is line^(2/c - 1): at full Kelly the chance of ever halving is one half.
 */
export function ruinLongRun(f, p, b, line) {
  if (f <= 0) return 0;
  const g = growth(f, p, b), v = logVariance(f, p, b);
  if (!(v > 0)) return g >= 0 ? 0 : 1;
  if (g <= 0) return 1;
  return Math.exp((-2 * g * -Math.log(line)) / v);
}

/**
 * Simulate `bettors` independent bettors making M bets each, from rng(seed). Every strategy sees the same wins and
 * losses (common random numbers), so differences between them come from the stake alone.
 * Returns { run(budget), done, ... } like a job; when done: ruined[s], below[s] counts, and wins at checkpoints.
 */
export function createSimulation({ p, b, M, bettors, seed, stakes, line, checkpoints = 60 }) {
  const r = rng(seed);
  const S = stakes.length;
  const A = stakes.map((f) => Math.log1p(b * f)), B = stakes.map((f) => Math.log1p(-f));
  const L = Math.log(line);
  const marks = [...new Set(Array.from({ length: Math.min(checkpoints, M) + 1 }, (_, i) => Math.round((i * M) / Math.min(checkpoints, M))))];
  const winsAt = marks.map(() => new Uint16Array(bettors));
  const sim = { M, bettors, marks, winsAt, done: 0, ruined: new Array(S).fill(0), below: new Array(S).fill(0), finalWins: new Uint16Array(bettors) };
  const fallen = new Uint8Array(S);
  sim.run = (budget) => {
    const end = Math.min(bettors, sim.done + budget);
    for (let i = sim.done; i < end; i++) {
      fallen.fill(0);
      let w = 0, m = 1; // m: the next checkpoint (marks[0] is 0 bets, where nobody has won yet)
      for (let t = 1; t <= M; t++) {
        if (r() < p) w++;
        const l = t - w;
        for (let s = 0; s < S; s++) if (!fallen[s] && stakes[s] > 0 && logWealth(w, l, A[s], B[s]) <= L + TOL) fallen[s] = 1;
        if (marks[m] === t) { winsAt[m][i] = w; m++; }
      }
      sim.finalWins[i] = w;
      for (let s = 0; s < S; s++) {
        if (fallen[s]) sim.ruined[s]++;
        if (stakes[s] > 0 && logWealth(w, M - w, A[s], B[s]) < -TOL) sim.below[s]++;
      }
    }
    sim.done = end;
    return end;
  };
  return sim;
}

/**
 * Quantile of the bankroll (multiple of the start) after marks[k] bets at stake f, over the first n bettors. The
 * bankroll rises with the number of wins, so its quantile is the bankroll at the wins' quantile (lower order statistic).
 */
export function wealthQuantile(sim, k, f, b, q, n = sim.done) {
  const t = sim.marks[k];
  if (f <= 0 || t === 0) return 1;
  const col = sim.winsAt[k].slice(0, n).sort();
  const w = col[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  return Math.exp(logWealth(w, t - w, Math.log1p(b * f), Math.log1p(-f)));
}

/** 95% Wilson interval for a share k of n. */
export function wilson(k, n) {
  const z = 1.959963984540054, p = k / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { share: p, low: k === 0 ? 0 : Math.max(0, centre - half), high: k === n ? 1 : Math.min(1, centre + half) };
}
