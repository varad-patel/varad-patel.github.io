// Day 56: Price Discrimination Lab. The model, with no DOM code.
//
// A seller with a constant cost per unit faces groups of buyers. Every buyer in group i would buy a_i - p units at a
// price of p a unit (and nothing once p reaches a_i), so a buyer's willingness to pay for q units is a_i q - q^2 / 2.
// Four ways to sell are solved exactly: one price, a price for each group, a menu of bundles that buyers choose
// between, and a price for each buyer.

import { fmt } from "../kit/kit.js";

export const LIMITS = { groups: [2, 4], buyers: [1, 100000], top: [0.01, 1000], cost: [0, 1000], name: 24 };

export const EXAMPLES = [
  { key: "both", label: "Both groups served", cost: 2, groups: [{ name: "Students", buyers: 100, top: 10 }, { name: "Professionals", buyers: 100, top: 14 }] },
  { key: "shut", label: "One price shuts students out", cost: 2, groups: [{ name: "Students", buyers: 100, top: 6 }, { name: "Professionals", buyers: 100, top: 14 }] },
  { key: "three", label: "Three groups", cost: 2, groups: [{ name: "Students", buyers: 150, top: 7 }, { name: "Families", buyers: 100, top: 10 }, { name: "Firms", buyers: 50, top: 18 }] },
  { key: "pool", label: "A menu that pools two groups", cost: 1, groups: [{ name: "Occasional", buyers: 40, top: 8 }, { name: "Regular", buyers: 10, top: 9 }, { name: "Heavy", buyers: 50, top: 12 }] },
  { key: "same", label: "Identical groups", cost: 2, groups: [{ name: "North", buyers: 80, top: 12 }, { name: "South", buyers: 120, top: 12 }] },
];

/** What is wrong with the inputs, as a sentence that says what to fix, or null. */
export function check(groups, cost) {
  const [lo, hi] = LIMITS.groups;
  if (!Array.isArray(groups) || groups.length < lo || groups.length > hi) return `The lab compares ${lo} to ${hi} groups of buyers.`;
  if (!(typeof cost === "number" && cost >= LIMITS.cost[0] && cost <= LIMITS.cost[1])) return `The cost of a unit must be a number from ${LIMITS.cost[0]} to ${fmt.int(LIMITS.cost[1])}.`;
  for (const [i, g] of groups.entries()) {
    const who = `Group ${i + 1}`;
    if (typeof g.name !== "string" || !g.name.trim()) return `${who} needs a name.`;
    if (g.name.trim().length > LIMITS.name) return `${who}'s name is longer than ${LIMITS.name} characters. Shorten it.`;
    if (!(Number.isInteger(g.buyers) && g.buyers >= LIMITS.buyers[0] && g.buyers <= LIMITS.buyers[1])) return `${who}: the number of buyers must be a whole number from ${LIMITS.buyers[0]} to ${fmt.int(LIMITS.buyers[1])}.`;
    if (!(typeof g.top === "number" && g.top >= LIMITS.top[0] && g.top <= LIMITS.top[1])) return `${who}: the highest price a buyer would pay must be a number from ${LIMITS.top[0]} to ${fmt.int(LIMITS.top[1])}.`;
  }
  const names = groups.map((g) => g.name.trim().toLowerCase());
  const twin = names.findIndex((n, i) => names.indexOf(n) !== i);
  if (twin >= 0) return `Two groups are both called "${groups[twin].name.trim()}". Give each group its own name.`;
  return null;
}

/** Units one buyer with top price `top` buys at price p. */
export const demand = (top, p) => Math.max(0, top - p);
/** What a buyer with top price `top` would pay at most for q units (q no larger than top). */
export const worth = (top, q) => top * q - (q * q) / 2;
/** Profit from one price p charged to everybody. */
export const profitAt = (groups, cost, p) => groups.reduce((s, g) => s + (p - cost) * g.buyers * demand(g.top, p), 0);

/** A scheme in which each group pays a price per unit (null: the group buys nothing). */
function linear(key, groups, cost, prices) {
  const q = groups.map((g, i) => (prices[i] == null ? 0 : demand(g.top, prices[i])));
  const pay = q.map((units, i) => (units > 0 ? prices[i] * units : 0));
  const surplus = groups.map((g, i) => worth(g.top, q[i]) - pay[i]);
  return finish(key, groups, cost, { q, pay, surplus, unit: q.map((units, i) => (units > 0 ? prices[i] : null)) });
}
function finish(key, groups, cost, { q, pay, surplus, unit }) {
  const cs = groups.map((g, i) => g.buyers * surplus[i]);
  const profit = groups.reduce((s, g, i) => s + g.buyers * (pay[i] - cost * q[i]), 0);
  const csTotal = cs.reduce((s, v) => s + v, 0);
  return { key, q, pay, surplus, unit, cs, csTotal, profit, welfare: profit + csTotal, output: groups.reduce((s, g, i) => s + g.buyers * q[i], 0) };
}

/**
 * The best single price. Profit as a function of the price is a chain of downward parabolas, one for each set of
 * groups still buying, joined at kinks where a group drops out. A kink is never a peak, so the best price is the top
 * of one of the parabolas: for the k groups with the highest top prices, p = (their average top price + cost) / 2.
 * Every such price is tried and the true profit compared. Returns { price, profit, served, rivals, tie }.
 */
export function onePrice(groups, cost) {
  const live = groups.filter((g) => g.top > cost).sort((x, y) => y.top - x.top);
  if (!live.length) return { price: null, profit: 0, served: groups.map(() => false), rivals: [], tie: null };
  const rivals = [];
  let n = 0, sum = 0;
  live.forEach((g, k) => {
    n += g.buyers; sum += g.buyers * g.top;
    if (k + 1 < live.length && live[k + 1].top === g.top) return; // groups with the same top price drop out together
    const p = (sum / n + cost) / 2;
    // The top of this parabola counts only if exactly these groups buy at it.
    if (p < g.top && (k + 1 === live.length || p >= live[k + 1].top)) rivals.push({ price: p, profit: profitAt(groups, cost, p), served: groups.map((x) => x.top > p) });
  });
  rivals.sort((x, y) => y.profit - x.profit || x.price - y.price);
  const best = rivals[0];
  // Two prices can earn the same (to the last digit or two that floating point keeps). The lower one, which serves more
  // buyers, is the one compared.
  const level = rivals.filter((r) => Math.abs(r.profit - best.profit) <= 1e-12 * Math.max(1, Math.abs(best.profit))).sort((x, y) => x.price - y.price);
  const pick = level[0];
  return { price: pick.price, profit: pick.profit, served: pick.served, rivals, tie: level.length > 1 ? level.map((r) => r.price) : null };
}

/** Weighted isotonic regression (pool adjacent violators): the non-decreasing sequence closest to `values`. */
export function isotonic(values, weights) {
  const blocks = [];
  values.forEach((v, i) => {
    blocks.push({ sum: v * weights[i], w: weights[i], n: 1 });
    while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).w > blocks.at(-1).sum / blocks.at(-1).w + 1e-12) {
      const last = blocks.pop(), prev = blocks.at(-1);
      prev.sum += last.sum; prev.w += last.w; prev.n += last.n;
    }
  });
  return blocks.flatMap((b) => Array(b.n).fill(b.sum / b.w));
}

/**
 * The most profitable menu of bundles (quantity, total payment) when the seller cannot tell the groups apart and each
 * buyer picks the bundle they like best, or none.
 *
 * With the groups in order of top price, only two kinds of constraint bind: the lowest group served is left with no
 * surplus, and every other group is left just indifferent between its own bundle and the one below. A buyer of group
 * j+1 values the bundle of group j by (a_{j+1} - a_j) q_j more than group j does, so that is the surplus the seller
 * must leave, and the cost of selling q_j to group j includes what it gives away to every higher group. The quantity
 * for group j therefore equates a "virtual" top price, v_j = a_j - (a_{j+1} - a_j) x (buyers above j) / (buyers in j),
 * to cost: q_j = v_j - cost. Quantities must not fall as the top price rises; where the v_j would make them fall they
 * are pooled by isotonic regression, weighted by group size, and the pooled groups share one bundle.
 */
export function menu(groups, cost) {
  const order = groups.map((_, i) => i).sort((x, y) => groups[x].top - groups[y].top || x - y);
  const a = order.map((i) => groups[i].top), n = order.map((i) => groups[i].buyers);
  const above = a.map((_, j) => n.slice(j + 1).reduce((s, v) => s + v, 0));
  const virtual = a.map((top, j) => (j + 1 < a.length ? top - ((a[j + 1] - top) * above[j]) / n[j] : top));
  const ironed = isotonic(virtual, n);
  const qs = ironed.map((v) => Math.max(0, v - cost));
  const pays = [], rents = [];
  qs.forEach((q, j) => {
    // Surplus left to group j: what it would gain by taking the bundle below instead of its own.
    rents.push(j === 0 ? 0 : rents[j - 1] + (a[j] - a[j - 1]) * qs[j - 1]);
    pays.push(q > 0 ? worth(a[j], q) - rents[j] : 0);
  });
  const back = (arr) => { const out = []; order.forEach((i, j) => { out[i] = arr[j]; }); return out; };
  const q = back(qs), pay = back(pays), surplus = back(rents.map((r, j) => (qs[j] > 0 ? r : 0)));
  const result = finish("menu", groups, cost, { q, pay, surplus, unit: q.map((units, i) => (units > 0 ? pay[i] / units : null)) });
  // Groups that share a bundle: same quantity (and so the same payment), and something is sold.
  result.pooled = groups.map((_, i) => groups.map((_, k) => k).filter((k) => k !== i && q[i] > 0 && Math.abs(q[k] - q[i]) < 1e-9));
  result.virtual = back(virtual); result.ironed = back(ironed);
  return result;
}

/** All four schemes, plus what the comparison between them shows. */
export function compare(groups, cost) {
  const one = onePrice(groups, cost);
  const single = linear("one", groups, cost, groups.map((g, i) => (one.served[i] ? one.price : null)));
  single.price = one.price; single.served = one.served; single.tie = one.tie; single.rivals = one.rivals;
  const byGroup = linear("group", groups, cost, groups.map((g) => (g.top > cost ? (g.top + cost) / 2 : null)));
  // A price for each buyer: every unit is sold at exactly what it is worth to that buyer, down to cost.
  const qBest = groups.map((g) => demand(g.top, cost));
  const each = finish("each", groups, cost, { q: qBest, pay: groups.map((g, i) => worth(g.top, qBest[i])), surplus: groups.map(() => 0), unit: groups.map((g, i) => (qBest[i] > 0 ? worth(g.top, qBest[i]) / qBest[i] : null)) });
  const schemes = { one: single, group: byGroup, menu: menu(groups, cost), each };
  const anyTrade = groups.some((g) => g.top > cost);
  const shutOut = groups.map((g, i) => i).filter((i) => groups[i].top > cost && !single.served[i]);
  const alike = new Set(groups.filter((g) => g.top > cost).map((g) => g.top)).size <= 1;
  return { schemes, anyTrade, shutOut, alike, neverBuy: groups.map((g, i) => i).filter((i) => groups[i].top <= cost) };
}

/* ---------- words ---------- */

/**
 * Money and quantities: two decimals, and rounding dust is zero. An amount that is really there but would print as
 * 0.00 (a group whose top price is a hair above cost buys a sliver) is called "less than 0.01", not nothing.
 */
export const n2 = (x) => (Math.abs(x) < 5e-7 ? "0.00" : Math.abs(x) < 0.005 ? "less than 0.01" : fmt.num(x, 2));
/** A price: two decimals, or up to four where two would hide part of it (13.995, not 14.00; 5.9167). */
export function price(x) {
  if (Math.abs(x * 100 - Math.round(x * 100)) < 1e-7) return n2(x);
  const four = fmt.num(x, 4).replace(/0+$/, "");
  return /\.\d{3,}$/.test(four) ? four : n2(x);
}
const list = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const TINY = 5e-7;

/** The verdict on one price against a price for each group. Returns { kind, text }. */
export function verdict(groups, cost, r) {
  const { one, group } = r.schemes;
  const name = (i) => groups[i].name.trim();
  if (!r.anyTrade) return { kind: "warn", text: `No group would pay more than the cost of ${n2(cost)} a unit, so nothing is sold however the seller prices. Raise a group's highest price or lower the cost.` };
  const parts = [];
  if (one.tie) parts.push(`Two single prices, ${one.tie.map(price).join(" and ")}, earn the seller the same profit. The lower one, which serves more buyers, is used here.`);
  const dW = group.welfare - one.welfare, dP = group.profit - one.profit;
  if (r.alike) {
    parts.push(`Every group that buys has the same highest price, so the seller has nothing to tell them apart by: the best single price, ${price(one.price)}, is also the best price for each group, and the two schemes are identical.`);
  } else if (r.shutOut.length) {
    const out = r.shutOut.map(name);
    parts.push(`The best single price is ${price(one.price)}. No buyer in ${list(out)} would pay that much, so ${out.length === 1 ? "that group buys" : "those groups buy"} nothing.`);
    // A group whose highest price is a hair above cost buys a sliver at its own price: nothing that two decimals can show.
    const slight = group.output - one.output < 0.005 && dP < 0.005 && Math.abs(dW) < 0.005;
    if (slight) parts.push(`A price for each group would let ${out.length === 1 ? "that group" : "those groups"} buy, but ${out.length === 1 ? "its highest price is" : "their highest prices are"} so close to the cost that output, profit and total welfare all change by less than 0.01.`);
    else {
      parts.push(`A price for each group opens ${out.length === 1 ? "that market" : "those markets"}: output goes from ${n2(one.output)} to ${n2(group.output)} units, profit rises by ${n2(dP)} and total welfare ${dW > TINY ? `rises by ${n2(dW)}` : dW < -TINY ? `still falls by ${n2(-dW)}, because the groups that were already buying now pay different prices` : "is unchanged"}.`);
      if (!groups.some((g, i) => group.cs[i] < one.cs[i] - TINY)) parts.push("No group of buyers is worse off and the seller is better off, so here discrimination helps everyone.");
    }
  } else {
    parts.push(`One price of ${price(one.price)} serves every group. A price for each group sells exactly the same total, ${n2(group.output)} units, but moves some of them from buyers who value them more to buyers who value them less: profit rises by ${n2(dP)}, buyers' surplus falls by ${n2(one.csTotal - group.csTotal)} and total welfare falls by ${n2(-dW)}.`);
  }
  const never = r.neverBuy.map(name);
  if (never.length) parts.push(`No buyer in ${list(never)} would pay the cost of a unit, so ${never.length === 1 ? "that group buys" : "those groups buy"} nothing under any scheme.`);
  return { kind: "", text: parts.join(" ") };
}

/** How the buyers in each group fare when the seller moves from one price to a price for each group: one sentence a group. */
export function groupWords(groups, r) {
  const { one, group } = r.schemes;
  return groups.map((g, i) => {
    const who = `Buyers in ${g.name.trim()}`;
    if (group.unit[i] == null) return `${who} buy nothing either way.`;
    const d = group.cs[i] - one.cs[i];
    const effect = Math.abs(d) < TINY ? "leaves their surplus unchanged" : d > 0 ? `raises their surplus by ${n2(d)}` : `lowers their surplus by ${n2(-d)}`;
    // Buying anything at all after being shut out is a gain, however small: never "unchanged".
    if (one.unit[i] == null) return `${who} were shut out by the single price and now pay ${price(group.unit[i])} a unit, which ${d < 0.005 ? "raises their surplus by less than 0.01" : effect}.`;
    if (Math.abs(group.unit[i] - one.unit[i]) < TINY) return `${who} pay ${price(group.unit[i])} a unit either way.`;
    return `${who} pay ${price(group.unit[i])} a unit instead of ${price(one.unit[i])}, which ${effect}.`;
  });
}

/** The bundles on the menu, smallest first: [{ takers: [group indexes], q, pay }]. */
export function bundlesOf(groups, m) {
  const order = groups.map((_, i) => i).sort((x, y) => groups[x].top - groups[y].top || x - y);
  const seen = new Set(), bundles = [];
  for (const i of order) {
    if (seen.has(i) || !(m.q[i] > 0)) continue;
    const takers = [i, ...m.pooled[i]].sort((x, y) => order.indexOf(x) - order.indexOf(y));
    takers.forEach((k) => seen.add(k));
    bundles.push({ takers, q: m.q[i], pay: m.pay[i] });
  }
  return bundles;
}

/** The menu in words. */
export function menuWords(groups, cost, r) {
  const m = r.schemes.menu;
  const name = (i) => groups[i].name.trim();
  const bundles = bundlesOf(groups, m);
  if (!bundles.length) return "No bundle can be sold at a profit.";
  const parts = [`The menu has ${bundles.length === 1 ? "one bundle" : `${bundles.length} bundles`}: ${bundles.map((b) => `${n2(b.q)} units for ${n2(b.pay)} (${n2(b.pay / b.q)} a unit), chosen by ${list(b.takers.map(name))}`).join("; ")}.`];
  const dropped = groups.map((_, i) => i).filter((i) => m.q[i] === 0 && groups[i].top > cost).map(name);
  if (dropped.length) parts.push(`Buyers in ${list(dropped)} are offered nothing they would take: a bundle small and cheap enough for them would tempt the groups above to switch to it, and that would cost the seller more than it earned.`);
  for (const b of bundles.filter((x) => x.takers.length > 1)) {
    const same = b.takers.every((k) => groups[k].top === groups[b.takers[0]].top);
    parts.push(same
      ? `${list(b.takers.map(name))} have the same highest price, so the seller cannot tell them apart by what they choose and they take the same bundle.`
      : `${list(b.takers.map(name))} share a bundle: the sizes the seller would like to sell them do not rise with their highest prices, and a buyer with a higher top price never chooses the smaller of two bundles, so one bundle for all of them is the best it can do.`);
  }
  const kept = groups.map((_, i) => i).filter((i) => m.surplus[i] > TINY);
  const none = groups.map((_, i) => i).filter((i) => m.q[i] > 0 && !(m.surplus[i] > TINY)).map(name);
  parts.push(`Buyers in ${list(none)} are charged all that their bundle is worth to them and keep no surplus.`);
  if (kept.length) parts.push(`${list(kept.map((i, k) => `${k ? "each" : "Each"} buyer in ${name(i)} keeps ${n2(m.surplus[i])}`))}. That is the least the seller can leave: charge more and they would switch to a smaller bundle, or the group below would stop buying.`);
  const top = bundles.at(-1).takers.at(-1);
  if (bundles.length > 1 && Math.abs(m.q[top] - demand(groups[top].top, cost)) < 1e-9) parts.push(`Only the largest bundle is the size its buyers would choose at a price equal to cost, ${n2(m.q[top])} units. Every smaller bundle is cut below that.`);
  // A larger bundle that costs more per unit than a smaller one can be undercut by buying the smaller one several times.
  if (bundles.some((big, k) => bundles.slice(0, k).some((small) => big.pay / big.q > small.pay / small.q + 1e-9))) parts.push("A larger bundle here costs more per unit than a smaller one, so the menu only holds if each buyer can take one bundle and no more: several small bundles would be the cheaper way to buy a large quantity.");
  return parts.join(" ");
}
