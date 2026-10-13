// Day 49: Market Structure Lab. The model, with no DOM code.
//
// One market, six ways of competing in it. A market is { a, b, costs, theta }:
//   identical goods        price P = a - b Q, where Q is total output;
//   differentiated goods   firm i's price p_i = a - b (q_i + theta * sum of the others' output), 0 <= theta < 1.
// Both come from one buyer with utility U(q) = a Q - (b / 2) [(1 - theta) sum q_i^2 + theta Q^2] (theta = 1 is identical
// goods), so consumer surplus is U - sum p_i q_i in every case. costs[i] is firm i's constant cost per unit; there are
// no fixed costs. Firm 1 (index 0) is the Stackelberg leader.

export const LIMITS = { a: 1e6, b: 1e6, cost: 1e6, firms: 50 };

export const STRUCTURES = [
  { key: "monopoly", label: "Monopoly", short: "Monopoly", choice: "quantity" },
  { key: "stackelberg", label: "Stackelberg (firm 1 moves first)", short: "Stackelberg", choice: "quantity" },
  { key: "cournot", label: "Cournot (quantities)", short: "Cournot", choice: "quantity" },
  { key: "bertrandDiff", label: "Bertrand, differentiated goods", short: "Bertrand, differentiated", choice: "price" },
  { key: "bertrand", label: "Bertrand, identical goods", short: "Bertrand, identical", choice: "price" },
  { key: "competition", label: "Perfect competition", short: "Perfect competition", choice: "quantity" },
];
export const structureOf = (key) => STRUCTURES.find((s) => s.key === key);

/** A message saying what is wrong with a market, or "" if it can be solved. */
export function problem(market) {
  const { a, b, costs, theta = 0 } = market || {};
  const num = (x) => typeof x === "number" && Number.isFinite(x);
  if (!num(a) || a <= 0 || a > LIMITS.a) return `The highest price buyers will pay must be above 0 and at most ${LIMITS.a.toLocaleString("en-GB")}.`;
  if (!num(b) || b <= 0 || b > LIMITS.b) return `The slope of demand must be above 0 and at most ${LIMITS.b.toLocaleString("en-GB")}.`;
  if (!Array.isArray(costs) || costs.length < 1 || costs.length > LIMITS.firms) return `There must be between 1 and ${LIMITS.firms} firms.`;
  const bad = costs.findIndex((c) => !num(c) || c < 0 || c > LIMITS.cost);
  if (bad >= 0) return `Firm ${bad + 1}'s cost must be a number from 0 to ${LIMITS.cost.toLocaleString("en-GB")}.`;
  if (!num(theta) || theta < 0 || theta >= 1) return "The similarity of the goods must be at least 0 and below 1.";
  return "";
}

const sum = (xs) => { let s = 0; for (const x of xs) s += x; return s; };
const byCost = (costs) => costs.map((_, i) => i).sort((i, j) => costs[i] - costs[j] || i - j);

/* ------------------------------------------------------------------ demand */

/**
 * What the buyer takes of each differentiated good at the posted prices, never less than zero. The buyer maximises
 * U(q) - sum p_i q_i with q >= 0. Goods are bought in order of price: the k-th cheapest is bought only if
 * (a - p_k) (1 + (k - 2) theta) > theta * (sum of a - p over the k - 1 cheaper goods).
 */
export function demandDiff(prices, { a, b, theta }) {
  const order = prices.map((_, i) => i).sort((i, j) => prices[i] - prices[j] || i - j);
  let S = 0, m = 0;
  for (const i of order) {
    const v = a - prices[i];
    if (!(v * (1 + (m - 1) * theta) > theta * S)) break;
    S += v; m++;
  }
  const q = prices.map(() => 0);
  if (!m) return q;
  const Q = S / (b * (1 + (m - 1) * theta));
  for (let k = 0; k < m; k++) { const i = order[k]; q[i] = Math.max(0, (a - prices[i] - b * theta * Q) / (b * (1 - theta))); }
  return q;
}

/** The buyer's utility from the bundle q. */
export const utility = (q, { a, b }, theta) => {
  const Q = sum(q);
  return a * Q - (b / 2) * ((1 - theta) * sum(q.map((x) => x * x)) + theta * Q * Q);
};

/* ------------------------------------------------------------------ the six structures: who produces what */

/** Cournot quantities with any costs: firms enter in order of cost while their cost is below the price so far. */
export function cournotQuantities(costs, a, b) {
  let total = 0, k = 0, P = a;
  const active = [];
  for (const i of byCost(costs)) {
    if (!(costs[i] < P)) break;
    active.push(i); total += costs[i]; k++;
    P = (a + total) / (k + 1);
  }
  const q = costs.map(() => 0);
  for (const i of active) q[i] = (P - costs[i]) / b;
  return q;
}

/** The followers' Cournot outputs once the leader has put qL on the market, and the price that results. */
function followersReply(qL, market) {
  const { a, b, costs } = market;
  const rest = cournotQuantities(costs.slice(1), a - b * qL, b);
  return { rest, price: Math.max(0, a - b * (qL + sum(rest))) };
}

/** The leader's output: the best point of a profit curve that is concave with a kink wherever a follower gives up. */
function leaderOutput(market) {
  const { a, b, costs } = market;
  const cL = costs[0];
  const f = costs.slice(1).sort((x, y) => x - y);
  const K = f.length;
  const C = [0];
  for (const c of f) C.push(C[C.length - 1] + c);
  // exit[k]: the leader output at which the k-th cheapest follower stops producing (exit[0] is "never").
  const exit = [Infinity];
  for (let k = 1; k <= K; k++) exit.push((a + C[k - 1] - k * f[k - 1]) / b);
  const profitAt = (q) => (followersReply(q, market).price - cL) * q;
  let best = 0, bestProfit = 0, kink = false;
  for (let k = 0; k <= K; k++) {
    const lo = Math.max(0, k < K ? exit[k + 1] : 0), hi = Math.min(a / b, exit[k]);
    if (!(hi >= lo)) continue;
    const peak = (a + C[k] - (k + 1) * cL) / (2 * b);
    const q = Math.min(hi, Math.max(lo, peak));
    const pi = profitAt(q);
    if (pi > bestProfit + 1e-12 * a * a / b) { best = q; bestProfit = pi; kink = q !== peak && q > 0; }
  }
  return { qL: best, limit: kink };
}

/* ------------------------------------------------------------------ outcomes */

function finish(key, market, raw, p, extra = {}) {
  const { a, b, costs } = market;
  const theta = key === "bertrandDiff" ? market.theta : 1;
  const q = raw.map((x) => (x > 1e-12 * (a / b) ? x : 0));     // a firm exactly at the edge of the market sells nothing
  const Q = sum(q);
  const profits = q.map((x, i) => (x > 0 ? (p[i] - costs[i]) * x : 0));
  const revenue = sum(q.map((x, i) => p[i] * x));
  const cs = utility(q, market, theta) - revenue;
  const totalProfit = sum(profits);
  const welfare = cs + totalProfit;
  // The benchmark: every unit sold at its cost of production. With identical goods that is the lowest cost.
  let benchmark;
  if (key === "bertrandDiff") {
    const qStar = demandDiff(costs, market);
    benchmark = utility(qStar, market, theta) - sum(qStar.map((x, i) => costs[i] * x));
  } else {
    const gap = Math.max(0, a - Math.min(...costs));
    benchmark = (gap * gap) / (2 * b);
  }
  const dwl = Math.max(0, benchmark - welfare);
  return {
    key, q, p, profits, Q, cs, totalProfit, welfare, benchmark, dwl,
    price: Q > 0 ? revenue / Q : null,                      // what buyers pay per unit, on average
    dwlShare: benchmark > 0 ? dwl / benchmark : null,
    active: q.map((x) => x > 0),
    trade: Q > 0,
    ...extra,
  };
}

function monopoly(market) {
  const { a, b, costs } = market;
  const i = byCost(costs)[0];
  const Q = Math.max(0, (a - costs[i]) / (2 * b));
  const P = a - b * Q;
  return finish("monopoly", market, costs.map((_, j) => (j === i ? Q : 0)), costs.map(() => P), { seller: i });
}

function cournot(market) {
  const { a, b, costs } = market;
  const q = cournotQuantities(costs, a, b);
  const P = a - b * sum(q);
  return finish("cournot", market, q, costs.map(() => P));
}

function stackelberg(market) {
  const { a, b, costs } = market;
  const { qL, limit } = leaderOutput(market);
  const { rest } = followersReply(qL, market);
  const q = [qL, ...rest];
  const P = a - b * sum(q);
  return finish("stackelberg", market, q, costs.map(() => P), { limit });
}

function competition(market) {
  const { a, b, costs } = market;
  const low = Math.min(...costs);
  const lows = costs.map((c, i) => (c === low ? i : -1)).filter((i) => i >= 0);
  const Q = Math.max(0, (a - low) / b);
  const P = Q > 0 ? low : a;
  return finish("competition", market, costs.map((c) => (c === low ? Q / lows.length : 0)), costs.map(() => P), { sellers: lows });
}

/**
 * Bertrand with identical goods. Buyers go to the lowest price. A tie in price goes to the firm with the lower cost,
 * and firms tied on both share the market equally. Each firm that sells nothing posts its own cost.
 */
function bertrand(market) {
  const { a, b, costs } = market;
  const order = byCost(costs);
  const first = order[0], low = costs[first];
  const p = [...costs];
  const q = costs.map(() => 0);
  if (!(a > low)) return finish("bertrand", market, q, p, { regime: "none" });
  const lows = order.filter((i) => costs[i] === low);
  if (lows.length > 1) {
    for (const i of lows) q[i] = (a - low) / b / lows.length;
    return finish("bertrand", market, q, p, { regime: "cost" });
  }
  const second = order.length > 1 ? costs[order[1]] : Infinity;
  const pm = (a + low) / 2;
  const P = Math.min(second, pm);
  p[first] = P;
  q[first] = (a - P) / b;
  return finish("bertrand", market, q, p, { regime: order.length === 1 ? "alone" : second < pm ? "rival" : "drastic", seller: first });
}

/**
 * Bertrand with differentiated goods. Writing w_i = a - c_i and v_i = a - p_i, and with the m cheapest firms selling,
 * the first-order conditions give (2 A + theta) v_i = A w_i + theta V, where A = 1 + (m - 2) theta and V is the sum of
 * the v_i, so V = A W / (2 + (m - 3) theta). Firms join in order of cost while they would earn a margin. If the next
 * firm would sell at a price equal to its cost when the others charge those prices, yet earns no margin once it joins,
 * the sellers hold it exactly at the edge of the market (limit pricing): V is then pinned at w_next (1 + (m - 1) theta)
 * / theta and each seller's v_i lies between two bounds, shared out in the same proportion for every seller.
 */
function bertrandDiff(market) {
  const { a, b, costs, theta } = market;
  const order = byCost(costs);
  const w = (i) => a - costs[i];
  const A = (m) => 1 + (m - 2) * theta;
  const interiorV = (m, W) => (A(m) * W) / (2 + (m - 3) * theta);
  let m = 0, W = 0;
  for (const i of order) {
    const V = interiorV(m + 1, W + w(i));
    if (!(w(i) * (1 + m * theta) > theta * V)) break;      // no margin for this firm with m + 1 sellers
    m++; W += w(i);
  }
  const p = [...costs];
  if (!m) return finish("bertrandDiff", market, costs.map(() => 0), p, { regime: "none" });
  const sellers = order.slice(0, m);
  const next = order[m];
  let V = interiorV(m, W), regime = "interior", edge = null;
  const v = new Map(sellers.map((i) => [i, (A(m) * w(i) + theta * V) / (2 * A(m) + theta)]));
  if (next != null && w(next) * A(m + 1) > theta * V) {
    regime = "limit"; edge = next;
    V = (w(next) * A(m + 1)) / theta;
    const lo = sellers.map((i) => (A(m) * w(i) + theta * V) / (2 * A(m) + theta));
    const hi = sellers.map((i) => (A(m + 1) * w(i) + theta * (V + w(next))) / (2 * A(m + 1) + theta));
    const room = sum(hi) - sum(lo);
    const t = room > 0 ? Math.min(1, Math.max(0, (V - sum(lo)) / room)) : 0;
    sellers.forEach((i, k) => v.set(i, lo[k] + t * (hi[k] - lo[k])));
  }
  for (const i of sellers) p[i] = a - v.get(i);
  return finish("bertrandDiff", market, demandDiff(p, market), p, { regime, edge });
}

const SOLVERS = { monopoly, stackelberg, cournot, bertrandDiff, bertrand, competition };

/** The outcome of one structure. Throws a RangeError with a plain message if the market cannot be solved. */
export function solve(key, market) {
  const why = problem(market);
  if (why) throw new RangeError(why);
  if (!SOLVERS[key]) throw new RangeError(`Unknown market structure "${key}".`);
  return SOLVERS[key](market);
}
export const solveAll = (market) => STRUCTURES.map((s) => solve(s.key, market));

/* ------------------------------------------------------------------ the equilibrium check */

/**
 * Firm i's profit if it chooses x (a quantity or a price, as the structure has it) while every other firm keeps the
 * choice it makes in the outcome `eq`. Two exceptions: the Stackelberg leader's followers see its output and reply, and
 * under monopoly every firm is a plant of one owner, so the figure is the owner's whole profit when plant i makes x.
 */
export function payoff(key, market, eq, i, x) {
  const { a, b, costs } = market;
  const c = costs[i];
  if (key === "competition") return (eq.p[i] - c) * x;                                   // a price taker
  if (key === "monopoly") {                                                              // one owner: the profit of all its plants together
    const Q = eq.Q - eq.q[i] + x, P = Math.max(0, a - b * Q);
    return eq.q.reduce((s, qj, j) => s + (P - costs[j]) * (j === i ? x : qj), 0);
  }
  if (key === "stackelberg" && i === 0) return (followersReply(x, market).price - c) * x;
  if (key === "cournot" || key === "stackelberg") return (Math.max(0, a - b * (eq.Q - eq.q[i] + x)) - c) * x;
  if (key === "bertrandDiff") {
    const prices = [...eq.p]; prices[i] = x;
    return (x - c) * demandDiff(prices, market)[i];
  }
  // Bertrand, identical goods: lowest price sells; a tie goes to the lower cost; a tie on both is shared.
  let rivalsBelow = false, tiedAhead = false, tiedLevel = 0;
  for (let j = 0; j < costs.length; j++) {
    if (j === i) continue;
    if (eq.p[j] < x) rivalsBelow = true;
    else if (eq.p[j] === x) { if (costs[j] < c) tiedAhead = true; else if (costs[j] === c) tiedLevel++; }
  }
  if (rivalsBelow || tiedAhead) return 0;
  return ((x - c) * Math.max(0, (a - x) / b)) / (1 + tiedLevel);
}

/** What firm i chooses in the outcome: its price or its quantity. */
export const choiceOf = (key, eq, i) => (structureOf(key).choice === "price" ? eq.p[i] : eq.q[i]);

/**
 * Brute force: firm i's profit at `points` evenly spaced choices (plus its own), everything else held as in `eq`.
 * `gain` is the most it could add to its profit by moving, which is zero at a Nash equilibrium.
 */
export function deviation(key, market, eq, i, points = 401) {
  const { a, b } = market;
  const kind = structureOf(key).choice;
  const top = kind === "price" ? a : a / b;
  const own = choiceOf(key, eq, i);
  const xs = Array.from({ length: points }, (_, k) => (top * k) / (points - 1));
  if (!xs.includes(own)) { xs.push(own); xs.sort((x, y) => x - y); }
  const ys = xs.map((x) => payoff(key, market, eq, i, x));
  const ownProfit = payoff(key, market, eq, i, own);
  let k = 0;
  for (let j = 1; j < ys.length; j++) if (ys[j] > ys[k]) k = j;
  return { kind, xs, ys, own, ownProfit, bestX: xs[k], bestProfit: ys[k], gain: Math.max(0, ys[k] - ownProfit) };
}

/** The largest gain any firm could make by moving alone, over every firm. Zero (to rounding) at an equilibrium. */
export function largestGain(key, market, eq = solve(key, market), points = 401) {
  let worst = 0;
  for (let i = 0; i < market.costs.length; i++) worst = Math.max(worst, deviation(key, market, eq, i, points).gain);
  return worst;
}

/* ------------------------------------------------------------------ more firms */

/** Outcomes of one structure as firms are added in the order given: the first firm alone, the first two, and so on. */
export function entryPath(key, market, upTo = market.costs.length) {
  const out = [];
  for (let k = 1; k <= Math.min(upTo, market.costs.length); k++) out.push(solve(key, { ...market, costs: market.costs.slice(0, k) }));
  return out;
}
