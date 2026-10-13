// Day 50: Price War Simulator. The model, with no DOM code.
//
// Two firms sell differentiated goods and set prices every period. Demand is the logit model of Calvano, Calzolari,
// Denicolo and Pastorello (2020), with their baseline numbers: firm i sells
//   q_i = e^((a - p_i) / mu) / (e^((a - p_1) / mu) + e^((a - p_2) / mu) + e^(a0 / mu))
// and earns (p_i - c) q_i. Prices come from a grid of m points that runs from a little below the one-shot Nash price to
// a little above the joint-monopoly price. A bot is either a Q-learner or a fixed rule (the "undercutter").

import { rng } from "../kit/kit.js";

export const MARKET = { a: 2, c: 1, a0: 0, mu: 0.25 };
export const GRID = { m: 15, xi: 0.1 };
export const DEFAULTS = { alpha: 0.15, beta: 4e-6, delta: 0.95, memory: true, stableFor: 100000 };
export const LIMITS = { alpha: [0.01, 1], beta: [1e-6, 1e-3], delta: [0, 0.99], seed: [0, 999999], maxPeriods: 2e7 };
export const KINDS = [
  { key: "q", label: "Q-learner" },
  { key: "reply", label: "Undercutter" },
];

/**
 * e^x from additions, multiplications and divisions only. Math.exp is allowed to differ in the last digit from one
 * browser to the next, and a simulation of a million steps would turn that into a different run. This gives every
 * browser the same bits (accurate to about one part in 10^15 for the sizes used here).
 */
export function exp(x) {
  let k = 0;
  while (Math.abs(x) > 0.5) { x /= 2; k++; }
  let term = 1, s = 1;
  for (let i = 1; i <= 20; i++) { term *= x / i; s += term; }
  while (k-- > 0) s *= s;
  return s;
}

/* ------------------------------------------------------------------ the one-period game */

/** Firm 1's share of buyers when it charges p1 and its rival p2. */
export function share(p1, p2, market = MARKET) {
  const { a, a0, mu } = market;
  const x1 = exp((a - p1) / mu), x2 = exp((a - p2) / mu);
  return x1 / (x1 + x2 + exp(a0 / mu));
}
/** Firm 1's profit per period. */
export const profit = (p1, p2, market = MARKET) => (p1 - market.c) * share(p1, p2, market);

function root(f, lo, hi) {                       // f rises through zero between lo and hi
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(mid) < 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/**
 * The two benchmarks, with both firms charging the same price p and each selling q(p):
 *   one-shot Nash      p - c = mu / (1 - q)       each firm's own first-order condition
 *   joint monopoly     p - c = mu / (1 - 2 q)     the first-order condition for the sum of the two profits
 */
export function benchmarks(market = MARKET) {
  const { c, mu } = market;
  const top = c + 100 * mu + Math.max(0, market.a - c);
  const pN = root((p) => p - c - mu / (1 - share(p, p, market)), c, top);
  const pM = root((p) => p - c - mu / (1 - 2 * share(p, p, market)), c, top);
  return { pN, pM, piN: profit(pN, pN, market), piM: profit(pM, pM, market) };
}

/** Firm 1's best price against a rival charging p2, with any price allowed: its first-order condition p - c = mu / (1 - q1). */
export function bestReplyTo(p2, market = MARKET) {
  const { c, mu } = market;
  return root((p) => p - c - mu / (1 - share(p, p2, market)), c, c + 100 * mu + Math.max(0, market.a - c));
}

/**
 * The patience above which the joint-monopoly price could be held by a grim trigger (day 51):
 * (deviate - collude) / (deviate - punish), with the one-shot Nash profit as the punishment.
 */
export function grimThreshold(market = MARKET) {
  const { pM, piN, piM } = benchmarks(market);
  const cheat = profit(bestReplyTo(pM, market), pM, market);
  return (cheat - piM) / (cheat - piN);
}

/**
 * Everything the bots play on: the price grid, the table of firm 1's profit at each pair of grid prices
 * (profit[own * m + rival]), and each price's one-shot best reply on the grid.
 */
export function buildGame(market = MARKET, { m, xi } = GRID) {
  const bm = benchmarks(market);
  const lo = bm.pN - xi * (bm.pM - bm.pN), hi = bm.pM + xi * (bm.pM - bm.pN);
  const grid = Float64Array.from({ length: m }, (_, i) => lo + ((hi - lo) * i) / (m - 1));
  const table = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) table[i * m + j] = profit(grid[i], grid[j], market);
  const bestReply = new Uint8Array(m);
  for (let j = 0; j < m; j++) { let best = 0; for (let i = 1; i < m; i++) if (table[i * m + j] > table[best * m + j]) best = i; bestReply[j] = best; }
  // Pairs of grid prices that are one-shot Nash equilibria of the game on the grid.
  const nash = [];
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (bestReply[j] === i && bestReply[i] === j) nash.push([i, j]);
  return { market, m, xi, grid, profit: table, bestReply, nash, ...bm };
}

/** How far a profit is from the one-shot Nash level (0) towards the joint-monopoly level (1): the paper's profit gain. */
export const profitGain = (pi, game) => (pi - game.piN) / (game.piM - game.piN);

/* ------------------------------------------------------------------ settings */

const inside = (x, [lo, hi]) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;

/** A message saying what is wrong with a session's settings, or "" if they can be run. */
export function problem({ bots, alpha, beta, delta, seed, maxPeriods } = {}) {
  if (!Array.isArray(bots) || bots.length !== 2 || !bots.every((k) => KINDS.some((x) => x.key === k))) return "Choose a kind for each of the two bots.";
  if (!inside(alpha, LIMITS.alpha)) return `The learning rate must be a number from ${LIMITS.alpha[0]} to ${LIMITS.alpha[1]}.`;
  if (!inside(beta, LIMITS.beta)) return "The rate at which exploring fades must be between 0.000001 and 0.001.";
  if (!inside(delta, LIMITS.delta)) return `Patience must be a number from ${LIMITS.delta[0]} to ${LIMITS.delta[1]}.`;
  if (!Number.isInteger(seed) || !inside(seed, LIMITS.seed)) return "The seed must be a whole number from 0 to 999,999.";
  if (maxPeriods != null && (!Number.isInteger(maxPeriods) || maxPeriods < 1 || maxPeriods > LIMITS.maxPeriods)) return "The longest run must be a whole number of periods from 1 to 20,000,000.";
  return "";
}

/**
 * Periods allowed before a run is stopped as "not settled": 20 / beta, by when exploring has long faded, plus 200,000.
 * 20 / beta is rounded to a whole period first, so that a beta one rounding error away from 0.0001 still gives 400,000.
 */
export const defaultCap = (beta) => Math.min(LIMITS.maxPeriods, Math.ceil(Math.round(20 / beta) / 100000) * 100000 + 200000);

/* ------------------------------------------------------------------ one session */

/**
 * One session: two bots, one seed. advance(n) plays up to n more periods and stops early when the session is done.
 *
 * A Q-learner keeps a value Q(s, p) for every state s and price p. The state is last period's pair of prices (or
 * nothing at all with memory off). Each period it explores with probability e^(-beta t), choosing any price with equal
 * chance, and otherwise charges the price with the highest value in the current state. It then sees its profit and
 * the new state s', and updates
 *   Q(s, p) <- (1 - alpha) Q(s, p) + alpha [profit + delta max over p' of Q(s', p')].
 * Values start at the discounted profit of each price against a rival who picks at random.
 * An undercutter learns nothing: it charges the one-shot best reply to the price its rival charged last period.
 *
 * The session is "settled" when neither learner's best price in any state has changed for `stableFor` periods (the
 * paper's rule), and stops unsettled at maxPeriods. Two undercutters are settled as soon as a pair of prices repeats.
 */
export function createSession({ game, bots, alpha = DEFAULTS.alpha, beta = DEFAULTS.beta, delta = DEFAULTS.delta, memory = DEFAULTS.memory, seed = 1, stableFor = DEFAULTS.stableFor, maxPeriods = defaultCap(beta), block = 10000 }) {
  const why = problem({ bots, alpha, beta, delta, seed, maxPeriods });
  if (why) throw new RangeError(why);
  const { m, profit: P, bestReply } = game;
  const r = rng(seed);
  const S = memory ? m * m : 1;
  const learner = bots.map((k) => k === "q");
  const learning = learner[0] || learner[1];
  // Starting values: the average profit of each price against every rival price, discounted for ever.
  const start = new Float64Array(m);
  for (let i = 0; i < m; i++) { let s = 0; for (let j = 0; j < m; j++) s += P[i * m + j]; start[i] = s / m / (1 - delta); }
  let first = 0;
  for (let i = 1; i < m; i++) if (start[i] > start[first]) first = i;
  const Q = [0, 1].map((k) => { if (!learner[k]) return null; const q = new Float64Array(S * m); for (let s = 0; s < S; s++) q.set(start, s * m); return q; });
  const greedy = [0, 1].map((k) => (learner[k] ? new Uint8Array(S).fill(first) : null));
  const decay = exp(-beta);

  let a0 = r.int(0, m - 1), a1 = r.int(0, m - 1);     // the prices "last period" before the first one: drawn at random
  let t = 0, eps = 1, stable = 0, done = false, settled = false;
  let sum0 = 0, sum1 = 0, inBlock = 0;
  const trace = { t: [], p0: [], p1: [] };             // average price of each bot over each block of periods
  const early = { p0: [game.grid[a0]], p1: [game.grid[a1]] }; // the first periods one by one, starting with the random draw
  const seen = learning ? null : new Set([a0 * m + a1]);

  // One learner's update, written out twice below because this loop runs millions of times. `top` is the price with the
  // highest value in the state (the first such price if several tie); it is kept up to date after every change.
  function advance(periods) {
    const grid = game.grid, q0 = Q[0], q1 = Q[1], g0 = greedy[0], g1 = greedy[1], L0 = learner[0], L1 = learner[1];
    // The loop works on local copies and writes them back at the end: it is several times faster that way.
    let x0 = a0, x1 = a1, now = t, e = eps, calm = stable, s0 = sum0, s1 = sum1, count = inBlock, over = done;
    for (let n = 0; n < periods && !over; n++) {
      const w = x0 * m + x1, s = memory ? w : 0;
      const b0 = L0 ? (r() < e ? Math.floor(r() * m) : g0[s]) : bestReply[x1];
      const b1 = L1 ? (r() < e ? Math.floor(r() * m) : g1[s]) : bestReply[x0];
      const w2 = b0 * m + b1, s2 = memory ? w2 : 0, row = s * m;
      let changed = false;
      if (L0) {
        const idx = row + b0, old = q0[idx], top = g0[s];
        const fresh = old + alpha * (P[b0 * m + b1] + delta * q0[s2 * m + g0[s2]] - old);
        q0[idx] = fresh;
        if (b0 === top) {
          if (fresh < old) { let best = 0; for (let i = 1; i < m; i++) if (q0[row + i] > q0[row + best]) best = i; if (best !== top) { g0[s] = best; changed = true; } }
        } else { const most = q0[row + top]; if (fresh > most || (fresh === most && b0 < top)) { g0[s] = b0; changed = true; } }
      }
      if (L1) {
        const idx = row + b1, old = q1[idx], top = g1[s];
        const fresh = old + alpha * (P[b1 * m + b0] + delta * q1[s2 * m + g1[s2]] - old);
        q1[idx] = fresh;
        if (b1 === top) {
          if (fresh < old) { let best = 0; for (let i = 1; i < m; i++) if (q1[row + i] > q1[row + best]) best = i; if (best !== top) { g1[s] = best; changed = true; } }
        } else { const most = q1[row + top]; if (fresh > most || (fresh === most && b1 < top)) { g1[s] = b1; changed = true; } }
      }
      calm = changed ? 0 : calm + 1;
      x0 = b0; x1 = b1; now++; e *= decay;
      s0 += grid[b0]; s1 += grid[b1]; count++;
      if (now <= 40) { early.p0.push(grid[b0]); early.p1.push(grid[b1]); }
      if (count === block) { trace.t.push(now); trace.p0.push(s0 / block); trace.p1.push(s1 / block); s0 = s1 = 0; count = 0; }
      if (learning) {
        if (calm >= stableFor) { over = true; settled = true; } else if (now >= maxPeriods) over = true;
      } else if (seen.has(w2)) { over = true; settled = true; } else seen.add(w2);
    }
    a0 = x0; a1 = x1; t = now; eps = e; stable = calm; sum0 = s0; sum1 = s1; inBlock = count; done = over;
    return session;
  }

  /** What bot k charges after the pair of prices (i0, i1) once it has stopped exploring. */
  const act = (k, i0, i1) => (learner[k] ? greedy[k][memory ? i0 * m + i1 : 0] : bestReply[k === 0 ? i1 : i0]);
  const next = ([i0, i1]) => [act(0, i0, i1), act(1, i0, i1)];

  /**
   * Where the bots end up if both stop exploring now and follow what they have learned: the pair of prices, or the
   * cycle of pairs, that play settles into from the current state.
   */
  function limit() {
    const order = new Map();
    const path = [];
    let w = [a0, a1];
    while (!order.has(w[0] * m + w[1])) { order.set(w[0] * m + w[1], path.length); path.push(w); w = next(w); }
    const cycle = path.slice(order.get(w[0] * m + w[1]));
    const mean = (f) => cycle.reduce((s, x) => s + f(x), 0) / cycle.length;
    const prices = [mean(([i]) => game.grid[i]), mean(([, j]) => game.grid[j])];
    const profits = [mean(([i, j]) => P[i * m + j]), mean(([i, j]) => P[j * m + i])];
    const gains = profits.map((x) => profitGain(x, game));
    return { cycle, length: cycle.length, prices, profits, gains, gain: (gains[0] + gains[1]) / 2, price: (prices[0] + prices[1]) / 2 };
  }

  /**
   * The paper's test of whether the high prices are held up by punishment. From the settled prices (in a cycle, from
   * the point where its own price would be highest), one bot is made to charge a lower price for one period: "reply" is the one-shot best reply to its rival's price,
   * "step" is one grid step below what it would have charged, "floor" is the lowest price on the grid. After that both
   * bots follow what they learned. Returns both paths of prices (with and without the cut) for `horizon` periods, the
   * cutter's discounted gain or loss from the cut, and how the rival answered.
   */
  function deviate({ bot = 0, to = "reply", horizon = 20 } = {}) {
    const lim = limit();
    // In a cycle the cut is made where the cutter's own price would have been highest (the first such point).
    let startAt = lim.cycle[0];
    for (const w of lim.cycle) if (next(w)[bot] > next(startAt)[bot]) startAt = w;
    const onPath = next(startAt);
    const forced = to === "reply" ? bestReply[startAt[1 - bot]] : to === "floor" ? 0 : to === "step" ? onPath[bot] - 1 : to;
    if (!Number.isInteger(forced) || forced < 0 || forced >= m) return { cut: false, forced: null, would: onPath[bot] };
    if (forced >= onPath[bot]) return { cut: false, forced, would: onPath[bot] };
    const first = [...onPath]; first[bot] = forced;
    const base = [startAt, onPath], dev = [startAt, first];
    let gain = 0, weight = 1, merged = null;
    const earn = ([i, j]) => (bot === 0 ? P[i * m + j] : P[j * m + i]);
    for (let tau = 1; tau <= 3000; tau++) {
      if (tau > 1) { base.push(next(base[tau - 1])); dev.push(next(dev[tau - 1])); }
      if (merged == null && dev[tau][0] === base[tau][0] && dev[tau][1] === base[tau][1]) merged = tau;
      if (merged == null) gain += weight * (earn(dev[tau]) - earn(base[tau]));
      weight *= delta;
      if (merged != null && tau >= horizon) break;
    }
    // If the paths never coincide period for period, has play at least come back to the same cycle, out of step?
    const key = ([i, j]) => i * m + j;
    const home = new Set(lim.cycle.map(key));
    const sameCycle = merged != null || home.has(key(dev[dev.length - 1]));
    const rival = 1 - bot;
    const price = (w, k) => game.grid[w[k]];
    return {
      cut: true, bot, forced, would: onPath[bot], gain, merged, sameCycle,
      punished: dev[2][rival] < base[2][rival],
      rivalBefore: price(base[2], rival), rivalAfter: price(dev[2], rival),
      firstGain: earn(dev[1]) - earn(base[1]),
      path: Array.from({ length: horizon + 1 }, (_, tau) => ({ tau, dev: [price(dev[tau], 0), price(dev[tau], 1)], base: [price(base[tau], 0), price(base[tau], 1)] })),
    };
  }

  const session = {
    advance, limit, deviate, trace, early, bots, seed, alpha, beta, delta, memory, maxPeriods, learning,
    get t() { return t; }, get done() { return done; }, get settled() { return settled; }, get exploring() { return learning ? eps : 0; },
    /** The learners' tables, for tests: Q[k] and greedy[k] are null for a bot that does not learn. */
    tables: { Q, greedy },
  };
  return session;
}

/** Summary of finished sessions: the spread of the profit gain and of the prices across them. */
export function summarise(results) {
  const gains = results.map((x) => x.gain).sort((a, b) => a - b);
  const n = gains.length;
  if (!n) return { n: 0 };
  const mean = gains.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 ? gains[(n - 1) / 2] : (gains[n / 2 - 1] + gains[n / 2]) / 2;
  return { n, mean, median, min: gains[0], max: gains[n - 1], price: results.reduce((s, x) => s + x.price, 0) / n, above: results.filter((x) => x.gain > 0.5).length };
}
