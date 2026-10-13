// Day 48: Monopoly Pricing Simulator. The model, with no DOM code.
// One seller facing a demand curve and a cost curve, against the output where price equals marginal cost.

/** The price at which the constant-elasticity demand curve is pinned: buyers take `q0` units at this price. */
export const P0 = 10;

/** The range each setting may take. */
export const LIMITS = {
  a: [1, 1000],        // linear demand: the price at which nobody buys
  b: [0.01, 100],      // linear demand: how much the price falls for each extra unit sold
  e: [0.1, 10],        // constant-elasticity demand: the elasticity (a 1% price rise cuts sales by e%)
  q0: [1, 100000],     // constant-elasticity demand: units bought at a price of P0
  c: [0, 1000],        // cost: the marginal cost of the first unit
  d: [0, 100],         // cost: how much marginal cost rises with each extra unit
  F: [0, 1000000],     // cost: the fixed cost, paid only if anything is produced
};
export const DEFAULTS = { demand: { kind: "linear", a: 100, b: 1, e: 2, q0: 100 }, cost: { c: 20, d: 0, F: 0 } };

const NAMES = {
  a: "The price at which nobody buys", b: "The fall in price per extra unit", e: "The elasticity", q0: "The quantity bought at a price of 10",
  c: "Marginal cost of the first unit", d: "The rise in marginal cost per unit", F: "The fixed cost",
};
/** A message for the first setting that is missing or out of range, or "" when the model can be solved. */
export function problem(demand, cost) {
  if (!demand || (demand.kind !== "linear" && demand.kind !== "iso")) return "Choose linear or constant-elasticity demand.";
  if (!cost) return "The cost settings are missing.";
  const check = (obj, keys) => {
    for (const k of keys) {
      const v = obj[k], [lo, hi] = LIMITS[k];
      if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) return `${NAMES[k]} must be a number from ${lo} to ${hi.toLocaleString("en-GB")}.`;
    }
    return "";
  };
  return check(demand, demand.kind === "linear" ? ["a", "b"] : ["e", "q0"]) || check(cost, ["c", "d", "F"]);
}

/* ---------- the curves ---------- */

/** The price buyers will pay for the Q-th unit (inverse demand). */
export function price(demand, Q) {
  return demand.kind === "linear" ? demand.a - demand.b * Q : P0 * (Q / demand.q0) ** (-1 / demand.e);
}
/** Marginal revenue: the change in revenue from selling one more unit. */
export function marginalRevenue(demand, Q) {
  return demand.kind === "linear" ? demand.a - 2 * demand.b * Q : (1 - 1 / demand.e) * price(demand, Q);
}
export const marginalCost = (cost, Q) => cost.c + cost.d * Q;
/** Cost of producing Q units, leaving out the fixed cost. */
export const variableCost = (cost, Q) => cost.c * Q + (cost.d * Q * Q) / 2;
/** Consumer surplus when Q units are sold at the price on the demand curve: the area under demand and above that price. */
export function consumerSurplus(demand, Q) {
  if (Q <= 0) return 0;
  if (demand.kind === "linear") return (demand.b * Q * Q) / 2;
  return demand.e > 1 ? (price(demand, Q) * Q) / (demand.e - 1) : Infinity;
}

/**
 * The area under a constant-elasticity demand curve from 0 to Q, counting no price above `top`: what a chart whose
 * price axis stops at `top` can show of it. The curve climbs without limit towards zero output, so the whole area
 * (which is what buyers' surplus is measured from) is always more than the part in view. Needs an elasticity other
 * than 1. The curve meets `top` at q* = q0 (top / P0)^-e; below q* the height is `top`, above it the curve itself,
 * whose integral is P(q) q / (1 - 1/e).
 */
export function demandAreaInView(demand, Q, top) {
  if (!(Q > 0)) return 0;
  if (demand.kind === "linear") return demand.a * Q - (demand.b * Q * Q) / 2;
  const cut = Math.min(Q, demand.q0 * (top / P0) ** -demand.e);
  return top * cut + (price(demand, Q) * Q - price(demand, cut) * cut) / (1 - 1 / demand.e);
}

/** The root of a function that falls from above zero to below it as Q grows, by bisection on a logarithmic scale. */
function rootFalling(f, start) {
  let lo = start, hi = start;
  for (let i = 0; i < 2000 && !(f(lo) > 0); i++) lo /= 2;
  for (let i = 0; i < 2000 && !(f(hi) < 0); i++) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (mid === lo || mid === hi) break;
    if (f(mid) > 0) lo = mid; else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

/** Where a curve of willingness to pay (demand, or marginal revenue) meets marginal cost. kind: "price" or "revenue". */
function crossing(demand, cost, kind) {
  const { c, d } = cost;
  if (demand.kind === "linear") return (demand.a - c) / ((kind === "price" ? 1 : 2) * demand.b + d);
  const k = kind === "price" ? 1 : 1 - 1 / demand.e;                 // the curve is k times the demand price
  if (d === 0) return demand.q0 * (c / (k * P0)) ** -demand.e;        // k * P(Q) = c, solved for Q
  return rootFalling((Q) => k * price(demand, Q) - c - d * Q, demand.q0);
}

/** Everything about selling Q units: price, costs, surpluses. F is charged only when Q is above zero. */
function outcome(demand, cost, Q) {
  if (!(Q > 0)) return { Q: 0, P: null, mc: null, revenue: 0, variableCost: 0, fixedCost: 0, operatingProfit: 0, profit: 0, cs: 0, total: 0 };
  const P = price(demand, Q), revenue = P * Q, vc = variableCost(cost, Q);
  const cs = consumerSurplus(demand, Q);
  return { Q, P, mc: marginalCost(cost, Q), revenue, variableCost: vc, fixedCost: cost.F, operatingProfit: revenue - vc, profit: revenue - vc - cost.F, cs, total: cs + revenue - vc - cost.F };
}

/**
 * Solve the model. Returns { error } for bad input, otherwise
 *   state: "ok"         both outcomes exist and the monopoly operates
 *          "shutdown"   the monopoly's best operating profit does not cover the fixed cost, so it produces nothing
 *          "noTrade"    no buyer will pay the marginal cost of the first unit: nothing is sold either way
 *          "noMaximum"  constant elasticity at or below 1: the seller always gains by selling less, so there is no monopoly outcome
 *          "unbounded"  constant elasticity with no marginal cost at all: neither outcome is finite
 *          "cannotCover" elasticity of exactly 1 and a fixed cost that is at least the revenue: revenue is P0 * q0 at every
 *                       output, so no output can make a profit and the monopoly produces nothing (`revenue` holds P0 * q0;
 *                       `benchmark` is null when there is no marginal cost at all)
 *   monopoly, benchmark: the two outcomes (see outcome()); `planned` is the monopoly's best outcome before the shutdown test
 *   dwl: total surplus at the best achievable outcome minus total surplus under monopoly (null when either is undefined)
 *   breaksEven: the operating profit equals the fixed cost (to one part in a billion)
 *   worthProducing: total surplus at price = marginal cost covers the fixed cost
 *   lerner, elasticity: at the monopoly's planned output
 */
export function solve(demand, cost) {
  const error = problem(demand, cost);
  if (error) return { error };
  const none = outcome(demand, cost, 0);
  const iso = demand.kind === "iso";
  if (!iso && demand.a <= cost.c) return { state: "noTrade", monopoly: none, benchmark: none, planned: none, dwl: 0, worthProducing: false };
  const free = cost.c === 0 && cost.d === 0;
  // With an elasticity of exactly 1 buyers spend P0 * q0 whatever the price. A fixed cost of that much or more cannot be
  // covered at any output, so the seller's best choice exists after all: produce nothing. This comes before the two
  // "no outcome" states below, which would otherwise say that profit keeps growing as output shrinks.
  if (iso && demand.e === 1 && cost.F >= P0 * demand.q0) {
    const benchmark = free ? null : outcome(demand, cost, crossing(demand, cost, "price"));
    return { state: "cannotCover", revenue: P0 * demand.q0, monopoly: none, benchmark, planned: null, dwl: null, worthProducing: true };
  }
  if (iso && free) return { state: "unbounded", monopoly: null, benchmark: null, planned: null, dwl: null };

  const benchmark = outcome(demand, cost, crossing(demand, cost, "price"));
  const worthProducing = benchmark.total >= 0;
  if (iso && demand.e <= 1) return { state: "noMaximum", monopoly: null, benchmark, planned: null, dwl: null, worthProducing };

  const planned = outcome(demand, cost, crossing(demand, cost, "revenue"));
  const gap = planned.operatingProfit - cost.F;
  const breaksEven = Math.abs(gap) <= 1e-9 * Math.max(1, cost.F);
  const operates = gap > 0 || breaksEven;
  const monopoly = operates ? planned : none;
  const best = worthProducing ? benchmark.total : 0;
  return {
    state: operates ? "ok" : "shutdown", monopoly, benchmark, planned, breaksEven, worthProducing,
    dwl: Math.max(0, best - monopoly.total),
    lerner: (planned.P - planned.mc) / planned.P,
    elasticity: iso ? -demand.e : -planned.P / (demand.b * planned.Q),
  };
}

/** Points along the three curves for drawing, from 0 to qMax: [{ q, p, mr, mc }]. The first point of a constant-elasticity curve sits just above zero. */
export function curves(demand, cost, qMax, steps = 120) {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const q = demand.kind === "iso" && i === 0 ? qMax / (steps * 50) : (qMax * i) / steps;
    return { q, p: price(demand, q), mr: marginalRevenue(demand, q), mc: marginalCost(cost, q) };
  });
}
