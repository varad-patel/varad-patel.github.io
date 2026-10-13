// Day 47: Wealth Distribution Simulator. The model, with no DOM code.
// Agents who start equal trade in pairs. Total wealth never changes; only who holds it does.

import { rng, fmt } from "../kit/kit.js";

export const AGENT_CHOICES = [100, 200, 500, 1000, 2000];
/** The range each setting may take. Shares and chances are fractions, not percentages. */
export const LIMITS = {
  stake: [0.01, 0.5],        // yard sale: the stake as a share of the poorer party's wealth
  richerWins: [0.3, 0.7],    // yard sale: the chance that the richer party wins the stake
  saving: [0, 0.95],         // pooled exchange: the share of its wealth each party keeps out of the pool
  tax: [0, 0.1],             // both rules: the share of every agent's wealth taken each round and handed back in equal parts
  seed: [0, 999999],
};
export const DEFAULTS = { kind: "yardsale", stake: 0.1, richerWins: 0.5, saving: 0, tax: 0, agents: 500, seed: 47 };

/** A message for the first setting that is out of range, or "" when the rule can be run. */
export function problem(s) {
  const inside = (v, [lo, hi]) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  if (!s || (s.kind !== "yardsale" && s.kind !== "pooled")) return "Choose one of the two trading rules.";
  if (!AGENT_CHOICES.includes(s.agents)) return `The number of agents must be one of ${AGENT_CHOICES.join(", ")}.`;
  if (!Number.isInteger(s.seed) || !inside(s.seed, LIMITS.seed)) return "The seed must be a whole number from 0 to 999,999.";
  if (!inside(s.tax, LIMITS.tax)) return "The wealth tax must be between 0% and 10% a round.";
  if (s.kind === "yardsale" && !inside(s.stake, LIMITS.stake)) return "The stake must be between 1% and 50% of the poorer party's wealth.";
  if (s.kind === "yardsale" && !inside(s.richerWins, LIMITS.richerWins)) return "The richer party's chance of winning must be between 30% and 70%.";
  if (s.kind === "pooled" && !inside(s.saving, LIMITS.saving)) return "The share saved must be between 0% and 95%.";
  return "";
}

/** A new economy: every agent holds 1, so total wealth equals the number of agents. */
export function createSim({ agents, seed }) {
  return { w: new Float64Array(agents).fill(1), round: 0, rand: rng(seed) };
}

/**
 * One round: as many trades as there are agents, each between two different agents picked at random, then the tax.
 *
 * Yard sale: the stake is rule.stake times the poorer party's wealth. The richer party wins it with probability
 * rule.richerWins (a fair coin decides when the two are exactly level), and the loser pays the winner.
 * Pooled exchange: each party keeps rule.saving of its wealth; the rest of both goes into a pool that is split
 * at a uniformly random point.
 * Tax: every agent pays rule.tax of its wealth and the takings are shared out equally, which moves each agent
 * the fraction rule.tax of the way to the average.
 */
export function stepRound(sim, rule) {
  const { w, rand } = sim;
  const n = w.length;
  const pooled = rule.kind === "pooled";
  for (let t = 0; t < n; t++) {
    const i = Math.floor(rand() * n);
    let j = Math.floor(rand() * (n - 1));
    if (j >= i) j++;
    const a = w[i], b = w[j];
    if (pooled) {
      const sum = a + b;
      const mine = rule.saving * a + rand() * (1 - rule.saving) * sum;
      w[i] = mine;
      w[j] = sum - mine;
    } else {
      const stake = rule.stake * (a < b ? a : b);
      const iWins = rand() < (a > b ? rule.richerWins : a < b ? 1 - rule.richerWins : 0.5);
      w[i] = iWins ? a + stake : a - stake;
      w[j] = iWins ? b - stake : b + stake;
    }
  }
  if (rule.tax > 0) {
    let total = 0;
    for (let k = 0; k < n; k++) total += w[k];
    const mean = total / n;
    for (let k = 0; k < n; k++) w[k] += rule.tax * (mean - w[k]);
  }
  sim.round++;
}

/** Gini coefficient (0 to 1) of amounts already sorted from smallest to largest. */
export function giniSorted(sorted) {
  const n = sorted.length;
  let total = 0, weighted = 0;
  for (let i = 0; i < n; i++) { total += sorted[i]; weighted += (2 * (i + 1) - n - 1) * sorted[i]; }
  return n && total > 0 ? weighted / (n * total) : NaN;
}

/**
 * The state of the economy in numbers. Shares are fractions of total wealth. The richest 1% is the richest
 * hundredth of the agents (5 of 500), the richest 10% the richest tenth, the poorest half the poorest 50%.
 */
export function measure(sim) {
  const sorted = Float64Array.from(sim.w).sort();
  const n = sorted.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += sorted[i];
  const top = (count) => { let s = 0; for (let i = n - count; i < n; i++) s += sorted[i]; return s / total; };
  let low = 0;
  for (let i = 0; i < n / 2; i++) low += sorted[i];
  const tenths = Array.from({ length: 10 }, (_, d) => { let s = 0; for (let i = (d * n) / 10; i < ((d + 1) * n) / 10; i++) s += sorted[i]; return s / total; });
  return {
    round: sim.round, n, total, sorted,
    gini: giniSorted(sorted), top1: top(n / 100), top10: top(n / 10), bottom50: low / total, richest: sorted[n - 1] / total,
    median: (sorted[n / 2 - 1] + sorted[n / 2]) / 2, max: sorted[n - 1], min: sorted[0], tenths,
  };
}

/** The highest Gini coefficient n agents can show: one agent holds everything. */
export const giniCeiling = (n) => (n - 1) / n;

/* ---------- what theory says ---------- */

/**
 * Yard sale: the expected change in the logarithm of the poorer party's wealth in one trade. The poorer party's
 * wealth is multiplied by (1 + stake) when it wins and by (1 - stake) when it loses, so this is the growth rate
 * of its typical, not its average, wealth. Below zero, wealth ends up with one agent unless a tax hands it back
 * (Moukarzel 2011). With a fair coin it is ln(1 - stake^2) / 2, which is negative for every stake.
 */
export function poorerDrift(stake, richerWins) {
  return (1 - richerWins) * Math.log(1 + stake) + richerWins * Math.log(1 - stake);
}

/** Yard sale: the richer party's chance of winning at which the poorer party's drift is exactly zero. It is below one half. */
export function criticalChance(stake) {
  return Math.log(1 + stake) / (Math.log(1 + stake) - Math.log(1 - stake));
}

/**
 * The yard-sale drift as figures to print. change is the typical change in the poorer party's wealth per trade, in
 * per cent; critical is the critical chance in per cent. Both carry as many decimals as it takes for the printed
 * figures to agree with the sign of the drift: a setting of 49% is never printed beside a critical chance of "49.0%".
 */
export function driftFigures(stake, richerWins) {
  const drift = poorerDrift(stake, richerWins);
  const change = 100 * (Math.exp(drift) - 1);
  const critical = 100 * criticalChance(stake), setting = 100 * richerWins;
  let decimals = 1;
  while (decimals < 10 && critical.toFixed(decimals) === setting.toFixed(decimals)) decimals++;
  const small = change !== 0 && Math.abs(change) < 0.0005;
  return {
    drift,
    change: small ? `${change > 0 ? "+" : "-"}${fmt.sig(Math.abs(change), 2)}` : fmt.signed(change, 3),
    critical: fmt.num(critical, decimals),
  };
}

/** Pooled exchange with no saving and no tax settles on an exponential distribution: these are its figures. */
export const EXPONENTIAL = { gini: 0.5, top10: 0.1 * (1 + Math.log(10)), top1: 0.01 * (1 + Math.log(100)), bottom50: 0.5 * (1 - Math.log(2)) };
