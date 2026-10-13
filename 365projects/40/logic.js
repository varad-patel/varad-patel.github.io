// Day 40: Supply Shock Simulator. The model, with no DOM code.
//
// One market, one demand curve and one supply curve, both anchored at the price and quantity before the shock and
// shaped by an elasticity at that point. A shock moves the supply curve, drives a wedge between what buyers pay and
// what sellers keep, caps or props the price, or cuts the market off from imports. simulate() returns the new price
// and quantity, the change in each group's surplus, and the areas of the diagram that those changes are made of.

import { fmt } from "../kit/kit.js";

// far: a result that moves a price or the quantity by more than this factor is refused, not printed.
// small: a shock smaller than this share of the price (or this many per cent) is refused as too small to show.
export const LIMITS = { priceMin: 0.01, priceMax: 1e6, quantityMin: 0.01, quantityMax: 1e9, elasticityMax: 20, shareMax: 90, far: 1e6, small: 1e-6 };

/** size: what the visitor sets. "share" is a percentage, "amount" and "price" are in the market's own price units. */
export const SHOCKS = [
  { key: "drought", label: "Drought: part of every harvest is lost", size: "share", sizeLabel: "Share of the harvest lost", loss: "real" },
  { key: "strike", label: "Strike: part of the industry is shut", size: "share", sizeLabel: "Share of producers shut", loss: "real" },
  { key: "cost", label: "Dearer inputs: every unit costs more to make", size: "amount", sizeLabel: "Extra cost per unit", loss: "real" },
  { key: "tax", label: "New tax on every unit sold", size: "amount", sizeLabel: "Tax per unit", loss: "deadweight" },
  { key: "subsidy", label: "New subsidy on every unit sold", size: "amount", sizeLabel: "Subsidy per unit", loss: "deadweight" },
  { key: "ceiling", label: "Price ceiling: a legal maximum price", size: "price", sizeLabel: "Highest price allowed", loss: "deadweight" },
  { key: "floor", label: "Price floor: a legal minimum price", size: "price", sizeLabel: "Lowest price allowed", loss: "deadweight" },
  { key: "ban", label: "Import ban", size: "none", sizeLabel: "", world: true, loss: "deadweight" },
  { key: "tariff", label: "Import tariff", size: "amount", sizeLabel: "Tariff per imported unit", world: true, loss: "deadweight" },
];
export const shockOf = (key) => SHOCKS.find((s) => s.key === key);

/* ------------------------------------------------------------------ curves */

/**
 * Demand through (p0, q0) with elasticity -e there. e = 0 is a vertical line, e = Infinity a horizontal one.
 * q(p): quantity demanded. p(q): the most the buyer of the q-th unit would pay. int(lo, hi): the integral of q(p)
 * over prices from lo to hi, which is the consumer surplus gained when the price falls from hi to lo.
 * cs: the whole surplus at p0 (Infinity when the curve never reaches the price axis fast enough).
 */
export function demandCurve(family, p0, q0, e) {
  if (e === Infinity) return { kind: "horizontal", p0, q0, e, top: p0, cs: 0, q: (p) => (p < p0 ? Infinity : p > p0 ? 0 : q0), p: () => p0, int: () => 0 };
  if (e === 0) return { kind: "vertical", p0, q0, e, top: Infinity, cs: Infinity, q: () => q0, p: (q) => (q <= q0 ? Infinity : 0), int: (lo, hi) => q0 * (hi - lo) };
  if (family === "linear") {
    const b = (e * q0) / p0, a = q0 * (1 + e), top = a / b; // q = a - b p, zero at the choke price a / b
    const F = (p) => { const x = Math.min(Math.max(p, 0), top); return a * x - (b * x * x) / 2; };
    return { kind: "linear", p0, q0, e, a, b, top, cs: F(top) - F(p0), q: (p) => Math.max(0, a - b * p), p: (q) => Math.max(0, (a - q) / b), int: (lo, hi) => F(hi) - F(lo) };
  }
  // Constant elasticity: q = q0 (p / p0)^-e.
  const int = (lo, hi) => {
    if (lo === hi) return 0;
    const k = 1 - e, r = Math.log(hi / lo);
    return q0 * p0 * (lo / p0) ** k * (Math.abs(k) < 1e-12 ? r : Math.expm1(k * r) / k);
  };
  return { kind: "ce", p0, q0, e, top: Infinity, cs: e > 1 ? (q0 * p0) / (e - 1) : Infinity, q: (p) => q0 * (p / p0) ** -e, p: (q) => p0 * (q / q0) ** (-1 / e), int };
}

/**
 * Supply through (p0, q0) with elasticity e there. q(p): quantity offered at price p (nothing at a negative price).
 * p(q): the cost of the q-th unit. int(lo, hi): the integral of q(p), the producer surplus gained when the price
 * rises from lo to hi. start: the price at or below which supply is at its lowest; least: the quantity offered there.
 */
export function supplyCurve(family, p0, q0, e) {
  if (e === Infinity) return { kind: "horizontal", p0, q0, e, start: p0, least: 0, q: (p) => (p < p0 ? 0 : p > p0 ? Infinity : q0), p: () => p0, int: () => 0 };
  if (e === 0) return { kind: "vertical", p0, q0, e, start: 0, least: q0, q: (p) => (p < 0 ? 0 : q0), p: (q) => (q <= q0 ? 0 : Infinity), int: (lo, hi) => q0 * (Math.max(hi, 0) - Math.max(lo, 0)) };
  if (family === "linear") {
    const d = (e * q0) / p0, c = q0 * (1 - e), start = c < 0 ? -c / d : 0; // q = c + d p
    const G = (p) => { const x = Math.max(p, start); return c * (x - start) + (d * (x * x - start * start)) / 2; };
    return { kind: "linear", p0, q0, e, c, d, start, least: Math.max(0, c), q: (p) => (p < 0 ? 0 : Math.max(0, c + d * p)), p: (q) => Math.max(0, (q - c) / d), int: (lo, hi) => G(hi) - G(lo) };
  }
  // Constant elasticity: q = q0 (p / p0)^e.
  const G = (p) => (p <= 0 ? 0 : (q0 * p0 * (p / p0) ** (e + 1)) / (e + 1));
  return { kind: "ce", p0, q0, e, start: 0, least: 0, q: (p) => (p <= 0 ? 0 : q0 * (p / p0) ** e), p: (q) => (q <= 0 ? 0 : p0 * (q / q0) ** (1 / e)), int: (lo, hi) => G(hi) - G(lo) };
}

/**
 * A supply curve after a shock: q1(p) = kq * q(kp * (p - u)).
 * kq < 1 removes a share of producers, kp < 1 makes every unit of effort yield less, u adds a cost to every unit.
 */
function shifted(S, { kq = 1, kp = 1, u = 0 }) {
  return {
    q: (p) => { const z = kp * (p - u); return z < 0 ? 0 : kq * S.q(z); },
    p: (q) => u + S.p(q / kq) / kp,
    int: (lo, hi) => (kq / kp) * (S.int(kp * (lo - u), kp * (hi - u))),
  };
}

/* ------------------------------------------------------------ equilibrium */

/** Root of an increasing function on (lo, hi), by bisection until the bracket is as narrow as doubles allow. */
function bisect(f, lo, hi) {
  for (let i = 0; i < 200; i++) {
    const mid = lo + (hi - lo) / 2;
    if (mid <= lo || mid >= hi) break;
    if (f(mid) < 0) lo = mid; else hi = mid;
  }
  return lo + (hi - lo) / 2;
}

/**
 * The price and quantity at which demand meets the shifted supply, with buyers paying t more than sellers keep
 * (t < 0 is a subsidy). Returns { q, pb, ps } (buyers' price, sellers' price), or { closed: true, buyersMost,
 * sellersLeast } when no trade happens, or { tooGenerous: true } when a subsidy would push the buyers' price to zero.
 */
export function clear(D, S, { kq = 1, kp = 1, u = 0, t = 0 } = {}) {
  const closed = (sellersLeast) => ({ closed: true, q: 0, buyersMost: D.top, sellersLeast });
  const done = (q, pb, ps = pb - t) => (pb > 0 ? { q, pb, ps } : { tooGenerous: true });

  if (S.kind === "horizontal") {
    const pb = u + S.p0 / kp + t;
    if (!(pb > 0)) return { tooGenerous: true };
    const q = D.q(pb);
    return q > 0 ? done(q, pb) : closed(pb);
  }
  if (D.kind === "horizontal") {
    const q = shifted(S, { kq, kp, u }).q(D.p0 - t);
    return q > 0 ? done(q, D.p0) : closed(u + S.start / kp + t);
  }

  // The lowest point of the supply curve, as buyers see it. If demand there is no more than supply, that is where the market sits.
  const pbStart = u + S.start / kp + t;
  if (pbStart > 0) {
    const want = D.q(pbStart);
    if (want <= kq * S.least) return want > 0 ? done(want, pbStart) : closed(pbStart);
  }

  if (S.kind === "vertical") { const q = kq * S.q0; return done(q, D.p(q)); }
  if (D.kind === "vertical") return done(D.q0, u + S.p(D.q0 / kq) / kp + t);
  if (D.kind === "linear") {
    // a - b (u + t + z / kp) = kq (c + d z), where z is the price in the old supply curve's own terms.
    const z = (D.a - D.b * (u + t) - kq * S.c) / (D.b / kp + kq * S.d);
    const pb = u + t + z / kp;
    return done(D.a - D.b * pb, pb);
  }
  // Constant elasticity on both sides: (z / p0)^es * kq = ((u + t + z / kp) / p0)^-ed.
  const { p0 } = D;
  if (u + t === 0) {
    const z = p0 * (kp ** D.e / kq) ** (1 / (S.e + D.e));
    const pb = z / kp;
    return done(D.q(pb), pb);
  }
  // With a wedge there is no closed form. The unknown is the quantity, on a log scale: the price sellers need for it,
  // plus the wedge, less the price buyers will pay for it, rises with the quantity and crosses zero once. Each price is
  // then read from its own curve, so neither is ever a small difference of two large numbers (a tax a million times
  // what sellers keep, or a subsidy that leaves buyers paying next to nothing).
  const sellers = (q) => u + S.p(q / kq) / kp;
  const excess = (x) => { const q = Math.exp(x); return sellers(q) + t - D.p(q); };
  let low = Math.log(D.q0), high = low;
  for (let i = 0; i < 2000 && !(excess(low) < 0); i++) low -= 1;
  for (let i = 0; i < 2000 && !(excess(high) > 0); i++) high += 1;
  const q = Math.exp(bisect(excess, low, high));
  return done(q, D.p(q), sellers(q));
}

/* ------------------------------------------------------------------- shocks */

const bad = (error, field) => ({ ok: false, error, field });
const inRange = (x, lo, hi) => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
/**
 * A price (digits 2) or a quantity (digits 1) as printed: fixed decimals, except that a number too small for them to
 * show two figures of it is given to three significant figures, so 0.0152 is not printed as 0.02 nor 0.00882 as 0.0.
 */
export const show = (x, digits = 2) => (x === 0 || Math.abs(x) >= 10 ** (1 - digits) ? fmt.num(x, digits) : fmt.sig(x, 3));
const n2 = (x) => show(x, 2);
/** An amount of surplus: two decimals, but never "0.00" for something that is not zero, short when huge, and in words when minute. */
export const amount = (x) => (Math.abs(x) >= 1e6 ? fmt.compact(x) : x === 0 || Math.abs(x) >= 0.005 ? fmt.num(x, 2) : Math.abs(x) < 1e-9 ? "less than 0.000000001" : fmt.sig(x, 2));
/**
 * A change as the words that go in brackets after it: "+20.0%", "-10.0%", "75.0 times what it was". A rise is never
 * printed as a percentage in the thousands, and a fall that leaves something is never printed as -100.0%.
 */
export function change(before, after) {
  if (!(before > 0) || !Number.isFinite(after)) return "";      // nothing to compare with: a rise from zero has no percentage
  const ratio = after / before;
  if (ratio >= 10) return `${fmt.sig(ratio, 3)} times what it was`;
  const text = `${fmt.signed((ratio - 1) * 100, 1)}%`;
  if (after > 0 && text === "-100.0%") return "down by more than 99.9%";
  return /^[+-]?0\.0%$/.test(text) ? (after > before ? "up by less than 0.05%" : "down by less than 0.05%") : text;
}
/** One amount as a share of another, for a table or a tile: "+22.7%", "none", "under 0.05%", "13.5 times". */
export function share(x) {
  if (x === 0) return "none";
  if (Math.abs(x) >= 10) return `${x < 0 ? "-" : "+"}${fmt.sig(Math.abs(x), 3)} times`;
  const text = `${fmt.signed(x * 100, 1)}%`;
  return /^[+-]?0\.0%$/.test(text) ? "under 0.05%" : text;
}
/** "a, b and c": the amounts inside may carry commas of their own, so the list is not joined and then patched. */
const listed = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

function validate(m) {
  const L = LIMITS;
  if (m.family !== "linear" && m.family !== "ce") return bad("Choose straight lines or constant-elasticity curves.", "family");
  if (!inRange(m.p0, L.priceMin, L.priceMax)) return bad("The price before the shock must be a number from 0.01 to 1,000,000.", "p0");
  if (!inRange(m.q0, L.quantityMin, L.quantityMax)) return bad("The quantity before the shock must be a number from 0.01 to 1,000,000,000.", "q0");
  if (m.ed !== Infinity && !inRange(m.ed, 0, L.elasticityMax)) return bad("The elasticity of demand must be a number from 0 to 20. Enter its size without the minus sign.", "ed");
  if (m.es !== Infinity && !inRange(m.es, 0, L.elasticityMax)) return bad("The elasticity of supply must be a number from 0 to 20.", "es");
  if (m.ed === 0 && m.es === 0) return bad("Both curves are vertical, so any price would clear the market and the model cannot say which one holds. Give demand or supply an elasticity above zero.", "ed");
  if (m.ed === Infinity && m.es === Infinity) return bad("Both curves are horizontal, so any quantity would clear the market and the model cannot say which one holds. Give demand or supply a finite elasticity.", "ed");
  const shock = shockOf(m.shock);
  if (!shock) return bad("Choose a shock from the list.", "shock");
  if (shock.size === "share" && !inRange(m.size, 0, L.shareMax)) return bad(`The share lost must be a number from 0 to ${L.shareMax} per cent.`, "size");
  if (shock.size === "amount" && !inRange(m.size, 0, L.priceMax)) return bad(`${shock.sizeLabel} must be a number from 0 to 1,000,000.`, "size");
  // A shock too small to move any figure the page prints is refused, so that no line reads "gains 0.000...001".
  if (shock.size === "share" && m.size > 0 && m.size < L.small) return bad("A share this small changes nothing the page can show. Enter 0 for no shock, or at least 0.000001 per cent.", "size");
  if (shock.size === "amount" && m.size > 0 && m.size < L.small * m.p0) return bad(`${shock.sizeLabel} is less than a millionth of the price before the shock, too small to change anything the page can show. Enter 0 for no shock, or a larger amount.`, "size");
  if (shock.size === "price" && !inRange(m.size, L.priceMin, L.priceMax)) return bad(`${shock.sizeLabel} must be a number from 0.01 to 1,000,000.`, "size");
  if (shock.world && !inRange(m.world, L.priceMin, L.priceMax)) return bad("The world price must be a number from 0.01 to 1,000,000.", "world");
  return null;
}

const part = (qa, qb, lo, hi) => ({ qa, qb, lo, hi });
const flat = (v) => () => v;
/** A shaded area of the diagram: who gives it up, who receives it, its size, and its outline as bands over quantity. */
const region = (key, label, from, to, area, parts) => ({ key, label, from, to, area: Math.max(0, area), parts: parts.filter((p) => p.qb > p.qa) });
/** Areas too small to matter (rounding dust next to the market's own size) are left out. */
const visible = (regions, scale) => regions.filter((r) => r.area > 1e-12 * scale);

/**
 * Run one shock. m = { family: "linear" | "ce", p0, q0, ed, es, shock, size, world }.
 * ed and es are sizes of elasticities at (p0, q0): 0 is perfectly inelastic, Infinity perfectly elastic.
 * Returns { ok: false, error, field } for input the model cannot answer, otherwise
 * { ok, shock, status: "changed" | "none" | "slack" | "closed", before, after, welfare, regions, curves, ... }.
 */
export function simulate(m) {
  const r = run(m);
  if (!r.ok || r.status !== "changed") return r;
  // Curves like these mean little a long way from where they started. A result more than a million times away is not printed.
  const far = (now, was) => now > 0 && was > 0 && (now / was > LIMITS.far || was / now > LIMITS.far);
  const { before: b, after: a } = r;
  if (far(a.pb, b.pb) || far(a.ps, b.ps) || far(a.q, b.q) || far(a.made, b.made)) {
    return bad("This would move a price or the quantity to more than a million times, or less than a millionth of, what it was. That is far beyond where curves like these mean anything, so the model stops. Choose a smaller shock or more elastic curves.", r.shock.size === "none" ? "world" : "size");
  }
  // The same for surplus: very inelastic demand can put a finite but absurd value on the units no longer sold.
  const spent = b.pb * b.q;
  if ([r.welfare.consumers, r.welfare.producers, r.welfare.government].some((v) => Math.abs(v) > LIMITS.far * spent)) {
    return bad("The surplus that changes hands or is lost here comes to more than a million times what buyers spent before, because curves this inelastic put an enormous value on the units no longer traded. That is far beyond where they mean anything, so the model stops. Choose a smaller shock or more elastic curves.", r.shock.size === "none" ? "world" : "size");
  }
  return r;
}

function run(m) {
  const fault = validate(m);
  if (fault) return fault;
  const shock = shockOf(m.shock);
  const { p0, q0 } = m;
  const D = demandCurve(m.family, p0, q0, m.ed);
  const S = supplyCurve(m.family, p0, q0, m.es);
  const home = { pb: p0, ps: p0, q: q0 };
  const base = { ok: true, shock, model: m, D, S, S1: null, before: home, trade: null, regions: [], incidence: null, shortage: 0, glut: 0 };
  const still = (status, extra = {}) => ({ ...base, status, after: base.before, welfare: { consumers: 0, producers: 0, government: 0, total: 0, loss: 0 }, ...extra });
  const finish = (after, regions, parts, extra = {}) => {
    const welfare = { ...parts, total: parts.consumers + parts.producers + parts.government };
    // Three changes that cancel leave rounding dust, sometimes with the wrong sign. Next to the largest of them it is nothing;
    // a real loss, however small, is far above this and is kept.
    if (Math.abs(welfare.total) < 1e-12 * Math.max(Math.abs(parts.consumers), Math.abs(parts.producers), Math.abs(parts.government))) welfare.total = 0;
    welfare.loss = welfare.total === 0 ? 0 : -welfare.total;
    return { ...base, status: after.q > 0 ? "changed" : "closed", after, welfare, regions: visible(regions, p0 * q0), ...extra };
  };
  const unbounded = (what) => bad(`${what} With demand this inelastic there is no upper limit on what buyers would pay, so the loss to them has no finite size and the model cannot split it. Make demand more elastic${m.family === "ce" && D.kind === "ce" ? " (above 1)" : ""} or the shock smaller.`, "ed");
  const PS0 = S.int(0, p0);

  /* ---- supply moves: drought, strike, dearer inputs ---- */
  if (["drought", "strike", "cost"].includes(shock.key)) {
    if (m.size === 0) return still("none");
    const k = 1 - m.size / 100;
    const move = shock.key === "drought" ? { kq: k, kp: k } : shock.key === "strike" ? { kq: k } : { u: m.size };
    const S1 = shifted(S, move);
    const eq = clear(D, S, move);
    if (shock.key === "strike" && S.kind === "horizontal") return still("slack", { S1, why: "Supply is perfectly elastic: the firms still working can make any amount at the same cost, so they replace the lost output and nothing changes." });
    if (eq.closed) {
      if (!Number.isFinite(D.cs)) return unbounded("This shock closes the market.");
      return finish({ q: 0, pb: null, ps: null, buyersMost: eq.buyersMost, sellersLeast: eq.sellersLeast }, [
        region("lostBuyers", "Lost by buyers", "consumers", "nobody", D.cs, [part(0, q0, flat(p0), D.p)]),
        region("lostSellers", "Lost by sellers", "producers", "nobody", PS0, [part(0, q0, S.p, flat(p0))]),
      ], { consumers: -D.cs, producers: -PS0, government: 0 }, { S1 });
    }
    const p1 = eq.pb, q1 = eq.q;
    const moved = S1.int(p0, p1);                       // paid by buyers and kept by sellers
    const dCS = -D.int(p0, p1);
    const dPS = S1.int(0, p1) - PS0;
    return finish({ q: q1, pb: p1, ps: p1 }, [
      region("toSellers", "Paid by buyers, kept by sellers", "consumers", "producers", moved, [part(0, q1, (q) => Math.max(p0, Math.min(p1, S1.p(q))), flat(p1))]),
      region("lostBuyers", "Lost by buyers", "consumers", "nobody", -dCS - moved, [part(0, q1, flat(p0), (q) => Math.max(p0, Math.min(p1, S1.p(q)))), part(q1, q0, flat(p0), D.p)]),
      region("lostSellers", "Lost by sellers", "producers", "nobody", moved - dPS, [part(0, q1, S.p, (q) => Math.min(p0, S1.p(q))), part(q1, q0, S.p, flat(p0))]),
    ], { consumers: dCS, producers: dPS, government: 0 }, { S1 });
  }

  /* ---- a wedge between the two prices: tax, subsidy ---- */
  if (shock.key === "tax") {
    if (m.size === 0) return still("none");
    const t = m.size, eq = clear(D, S, { t });
    if (eq.closed) {
      if (!Number.isFinite(D.cs)) return unbounded("This tax closes the market.");
      return finish({ q: 0, pb: null, ps: null, buyersMost: eq.buyersMost, sellersLeast: eq.sellersLeast }, [
        region("dwlBuyers", "Deadweight loss, buyers' part", "consumers", "nobody", D.cs, [part(0, q0, flat(p0), D.p)]),
        region("dwlSellers", "Deadweight loss, sellers' part", "producers", "nobody", PS0, [part(0, q0, S.p, flat(p0))]),
      ], { consumers: -D.cs, producers: -PS0, government: 0 });
    }
    const { q: q1, pb, ps } = eq;
    const fromBuyers = (pb - p0) * q1, fromSellers = (p0 - ps) * q1;
    const dCS = -D.int(p0, pb), dPS = -S.int(ps, p0);
    return finish({ q: q1, pb, ps }, [
      region("taxBuyers", "Tax paid out of buyers' surplus", "consumers", "government", fromBuyers, [part(0, q1, flat(p0), flat(pb))]),
      region("taxSellers", "Tax paid out of sellers' surplus", "producers", "government", fromSellers, [part(0, q1, flat(ps), flat(p0))]),
      region("dwlBuyers", "Deadweight loss, buyers' part", "consumers", "nobody", -dCS - fromBuyers, [part(q1, q0, flat(p0), D.p)]),
      region("dwlSellers", "Deadweight loss, sellers' part", "producers", "nobody", -dPS - fromSellers, [part(q1, q0, S.p, flat(p0))]),
    ], { consumers: dCS, producers: dPS, government: t * q1 }, { incidence: { buyers: (pb - p0) / t, sellers: (p0 - ps) / t } });
  }
  if (shock.key === "subsidy") {
    if (m.size === 0) return still("none");
    const s = m.size, eq = clear(D, S, { t: -s });
    if (eq.tooGenerous) return bad("A subsidy this large would push the price buyers pay to zero or below, where this model stops. Choose a smaller subsidy.", "size");
    const { q: q1, pb, ps } = eq;
    const dCS = D.int(pb, p0), dPS = S.int(p0, ps), cost = s * q1;
    return finish({ q: q1, pb, ps }, [
      region("subBuyers", "Subsidy that reaches buyers", "government", "consumers", dCS, [part(0, q0, flat(pb), flat(p0)), part(q0, q1, flat(pb), D.p)]),
      region("subSellers", "Subsidy that reaches sellers", "government", "producers", dPS, [part(0, q0, flat(p0), flat(ps)), part(q0, q1, S.p, flat(ps))]),
      region("dwl", "Deadweight loss", "government", "nobody", cost - dCS - dPS, [part(q0, q1, D.p, S.p)]),
    ], { consumers: dCS, producers: dPS, government: -cost }, { incidence: { buyers: (p0 - pb) / s, sellers: (ps - p0) / s } });
  }

  /* ---- a price fixed by law ---- */
  if (shock.key === "ceiling") {
    const pc = m.size;
    if (pc >= p0) return still("slack", { why: `The ceiling of ${n2(pc)} is ${pc === p0 ? "equal to" : "above"} the price the market reaches on its own, ${n2(p0)}, so it does not bind and nothing changes.` });
    const q1 = S.q(pc);                                   // sellers are the short side
    const want = D.q(pc);
    const pv = q1 > 0 ? D.p(q1) : D.top;                  // what the last unit still sold is worth to its buyer
    if (q1 < q0 && !Number.isFinite(q1 > 0 ? pv : D.cs)) return unbounded(q1 > 0 ? "This ceiling cuts the quantity sold." : "This ceiling closes the market.");
    const moved = (p0 - pc) * q1;
    const lostBuyers = q1 > 0 ? D.int(p0, pv) - q1 * (pv - p0) : D.cs;
    const lostSellers = S.int(pc, p0) - moved;
    return finish({ q: q1, pb: pc, ps: pc }, [
      region("toBuyers", "Paid less by buyers, lost by sellers", "producers", "consumers", moved, [part(0, q1, flat(pc), flat(p0))]),
      region("dwlBuyers", "Deadweight loss, buyers' part", "consumers", "nobody", lostBuyers, [part(q1, q0, flat(p0), D.p)]),
      region("dwlSellers", "Deadweight loss, sellers' part", "producers", "nobody", lostSellers, [part(q1, q0, S.p, flat(p0))]),
    ], { consumers: moved - lostBuyers, producers: -moved - lostSellers, government: 0 }, { shortage: want - q1 });
  }
  if (shock.key === "floor") {
    const pf = m.size;
    if (pf <= p0) return still("slack", { why: `The floor of ${n2(pf)} is ${pf === p0 ? "equal to" : "below"} the price the market reaches on its own, ${n2(p0)}, so it does not bind and nothing changes.` });
    const q1 = D.q(pf);                                   // buyers are the short side
    const offered = S.q(pf);
    const cost = q1 > 0 ? S.p(q1) : 0;                    // cost of the last unit still sold, if the cheapest sellers get the sales
    const moved = (pf - p0) * q1;
    const lostBuyers = D.int(p0, pf) - moved;
    const lostSellers = q1 > 0 ? S.int(cost, p0) - q1 * (p0 - cost) : PS0;
    return finish({ q: q1, pb: pf, ps: pf }, [
      region("toSellers", "Paid by buyers, kept by sellers", "consumers", "producers", moved, [part(0, q1, flat(p0), flat(pf))]),
      region("dwlBuyers", "Deadweight loss, buyers' part", "consumers", "nobody", lostBuyers, [part(q1, q0, flat(p0), D.p)]),
      region("dwlSellers", "Deadweight loss, sellers' part", "producers", "nobody", lostSellers, [part(q1, q0, S.p, flat(p0))]),
    ], { consumers: -moved - lostBuyers, producers: moved - lostSellers, government: 0 }, { glut: offered - q1 });
  }

  /* ---- trade: ban, tariff ---- */
  const pw = m.world;
  if (pw >= p0) return still("slack", { why: `The world price of ${n2(pw)} is ${pw === p0 ? "equal to" : "above"} the home price of ${n2(p0)}, so nobody imports and the ${shock.key} has nothing to act on. (This model has no exports.)` });
  if (D.kind === "horizontal") return bad("With perfectly elastic demand buyers would take any amount at a world price below the home price, so imports have no limit and the model has no answer. Give demand a finite elasticity.", "ed");
  const open = { pb: pw, ps: pw, q: D.q(pw), made: S.q(pw) };
  open.imports = open.q - open.made;
  const opened = { ...base, before: open, trade: { world: pw, home: p0 } };
  if (shock.key === "tariff" && m.size === 0) return { ...opened, status: "none", after: open, welfare: { consumers: 0, producers: 0, government: 0, total: 0, loss: 0 } };
  const shut = shock.key === "ban" || pw + m.size >= p0;   // a tariff that lifts the price to the home price stops all imports
  const p1 = shut ? p0 : pw + m.size;
  const after = { pb: p1, ps: p1, q: shut ? q0 : D.q(p1), made: shut ? q0 : S.q(p1) };
  after.imports = after.q - after.made;
  const toSellers = S.int(pw, p1);
  const wasted = (p1 - pw) * after.made - toSellers;
  const revenue = (p1 - pw) * after.imports;
  const dCS = -D.int(pw, p1);
  const forgone = -dCS - (p1 - pw) * after.q;
  return {
    ...finish(after, [
      region("toSellers", "Paid by buyers, kept by home producers", "consumers", "producers", toSellers, [part(0, open.made, flat(pw), flat(p1)), part(open.made, after.made, S.p, flat(p1))]),
      region("dwlMaking", "Deadweight loss: home output that costs more than imports", "consumers", "nobody", wasted, [part(open.made, after.made, flat(pw), S.p)]),
      region("tariff", "Tariff revenue", "consumers", "government", revenue, [part(after.made, after.q, flat(pw), flat(p1))]),
      region("dwlBuying", "Deadweight loss: purchases no longer made", "consumers", "nobody", forgone, [part(after.q, open.q, flat(pw), D.p)]),
    ], { consumers: dCS, producers: toSellers, government: revenue }),
    before: open, trade: opened.trade, prohibitive: shock.key === "tariff" && shut,
  };
}

/* --------------------------------------------------------------- drawing */

/**
 * Points for the diagram, quantity across and price up: the demand curve, the supply curve before the shock and,
 * if it moved, after. xMax and yMax are axis limits that keep every price and quantity in the result in view.
 */
export function curvePoints(r, steps = 48) {
  const { D, S, S1, before, after } = r;
  const { p0, q0 } = r.model;
  const fixed = r.shock.size === "price" ? r.model.size : null;
  const prices = [p0, before.pb, after.pb, after.ps, fixed, after.sellersLeast, after.buyersMost].filter((v) => Number.isFinite(v));
  let yMax = 1.6 * Math.max(...prices);
  // A shaded area can rise far above every price in the result: under a ceiling the buyers' part of the loss reaches up
  // to what the last unit sold is worth. The axis stretches to take it in, up to four times the highest of those prices.
  const tops = r.regions.flatMap((reg) => bandPoints(reg).map((p) => p[2])).filter((v) => Number.isFinite(v));
  if (tops.length) yMax = Math.max(yMax, Math.min(1.08 * Math.max(...tops), 4 * Math.max(...prices)));
  if (D.kind === "linear") yMax = Math.max(yMax, Math.min(D.top * 1.08, 4 * p0));
  if (S.kind === "linear" && S.start > 0) yMax = Math.max(yMax, S.start * 1.2);
  const xMax = 1.3 * Math.max(q0, before.q, after.q, D.kind === "linear" ? Math.min(D.a, 2.2 * q0) : 0);
  // Curves are sampled between the quantities at which they are in view; a kink is always one of the points.
  const sample = (curve, qa, qb, kink) => {
    const qs = new Set(kink > qa && kink < qb ? [kink] : []);
    for (let i = 0; i <= steps; i++) qs.add(qa + ((qb - qa) * i) / steps);
    return [...qs].sort((x, y) => x - y).map((q) => [q, Math.min(curve.p(q), yMax)]);
  };
  const demand = D.kind === "vertical" ? [[q0, 0], [q0, yMax]]
    : D.kind === "horizontal" ? [[0, p0], [xMax, p0]]
    : sample(D, Math.min(xMax, D.q(yMax)), D.kind === "linear" ? Math.min(xMax, D.a) : xMax);
  const kq = r.shock.key === "drought" || r.shock.key === "strike" ? 1 - r.model.size / 100 : 1;
  const supplyOf = (curve, k) => (S.kind === "vertical" ? [[0, curve.p(0)], [k * q0, curve.p(0)], [k * q0, yMax]]
    : S.kind === "horizontal" ? [[0, curve.p(q0)], [xMax, curve.p(q0)]]
    : sample(curve, 0, Math.min(xMax, curve.q(yMax)), k * S.least));
  // clipped: some shaded area still runs off the top, so the diagram shows less of it than the table counts.
  const clipped = r.regions.some((reg) => bandPoints(reg).some((p) => p[2] > yMax * (1 + 1e-9)));
  return { xMax, yMax, clipped, demand, supply: supplyOf(S, 1), supplyAfter: S1 && r.status !== "none" && r.status !== "slack" ? supplyOf(S1, kq) : null };
}

/** The outline of one shaded area as [[quantity, low price, high price]], for a chart's "range" series. */
export function bandPoints(reg, yMax = Infinity, steps = 60) {
  const out = [];
  for (const p of reg.parts) {
    for (let i = 0; i <= steps; i++) {
      const q = p.qa + ((p.qb - p.qa) * i) / steps;
      const lo = p.lo(q), hi = p.hi(q);
      out.push([q, Math.min(lo, yMax), Math.min(Math.max(hi, lo), yMax)]);
    }
  }
  return out;
}

/* ----------------------------------------------------------------- wording */

const GROUPS = { consumers: "Buyers", producers: "Sellers", government: "Government" };
export const groupName = (key) => GROUPS[key] || "Nobody";

/** "rises from 10.00 to 12.00 (+20.0%)", "stays at 10.00", or a line that owns up to a change too small to print. */
export function movement(before, after, digits = 2) {
  const a = show(before, digits), b = show(after, digits);
  if (after === before) return `stays at ${a}`;
  // Printed alike but not equal: with fixed decimals the gap is under half a unit in the last place; otherwise just "slightly".
  if (a === b) return `${after > before ? "rises" : "falls"} ${a === fmt.num(before, digits) ? `by less than ${fmt.num(0.5 * 10 ** -digits, digits + 1)}` : "very slightly"} from ${a}`;
  const by = change(before, after);
  return `${after > before ? "rises" : "falls"} from ${a} to ${b}${by ? ` (${by})` : ""}`;
}

/** A plain reading of the result, as sentences. */
export function reading(r) {
  if (!r.ok) return [r.error];
  const s = r.shock.key, out = [];
  if (r.status === "none") return ["The shock is set to zero, so nothing changes. Give it a size above zero."];
  if (r.status === "slack") return [r.why];
  const { before, after, welfare: w } = r;
  if (r.status === "closed") {
    if (s === "ceiling") out.push(`No seller will sell at ${n2(after.pb)} or less, so the market closes: nothing is traded.`);
    else if (s === "floor") out.push(`No buyer will pay ${n2(after.pb)} or more, so the market closes: nothing is traded.`);
    else out.push(`The market closes: nothing is traded. After the shock the cheapest unit would have to sell for ${n2(after.sellersLeast)}, and no buyer will pay more than ${n2(after.buyersMost)}.`);
  } else if (r.trade) {
    out.push(`With trade open the price is the world price, ${n2(before.pb)}: buyers take ${show(before.q, 1)}, home producers make ${show(before.made, 1)} and ${show(before.imports, 1)} is imported.`);
    out.push(s === "ban" || r.prohibitive
      ? `${s === "ban" ? "The ban" : "A tariff this high"} stops all imports, so the price ${movement(before.pb, after.pb)}, the level at which the home market clears on its own. Home output ${movement(before.made, after.made, 1)}.`
      : `The tariff lifts the price to ${n2(after.pb)}. Home output ${movement(before.made, after.made, 1)} and the quantity imported ${movement(before.imports, after.imports, 1)}.`);
  } else if (after.pb !== after.ps) {
    out.push(`The price buyers pay ${movement(before.pb, after.pb)} and the price sellers keep ${movement(before.ps, after.ps)}. The quantity traded ${movement(before.q, after.q, 1)}.`);
    // A share that is not nothing is never printed as 0%, nor one that is not everything as 100%.
    const part = (x) => (x > 0 && x < 0.005 ? "less than 1%" : x < 1 && x > 0.995 ? "more than 99%" : fmt.pct(x, 0));
    if (r.incidence) out.push(`Buyers ${s === "tax" ? "bear" : "receive"} ${part(r.incidence.buyers)} of the ${s} and sellers ${part(r.incidence.sellers)}: the side that responds less to price ${s === "tax" ? "carries more of the burden" : "captures more of the benefit"}.`);
  } else {
    out.push(`The price ${movement(before.pb, after.pb)} and the quantity traded ${movement(before.q, after.q, 1)}.`);
  }
  const vast = (x) => Number.isFinite(x) && x > LIMITS.far * before.q;      // finite, but not worth printing digit by digit
  if (vast(r.shortage)) out.push("At that price buyers want more than a million times the quantity traded before, so almost all of that demand goes unmet. The model assumes the units go to the buyers who value them most.");
  else if (r.shortage > 0) out.push(Number.isFinite(r.shortage) ? `At that price buyers want ${show(after.q + r.shortage, 1)}, so ${show(r.shortage, 1)} of demand goes unmet. The model assumes the units go to the buyers who value them most.` : "At that price buyers would take any amount, so demand goes unmet however much is sold.");
  if (vast(r.glut)) out.push("At that price sellers would like to sell more than a million times the quantity traded before, so almost none of it finds a buyer. The model assumes the sales go to the sellers with the lowest costs, and that the unsold units are not made.");
  else if (r.glut > 0) out.push(Number.isFinite(r.glut) ? `At that price sellers would like to sell ${show(after.q + r.glut, 1)}, so ${show(r.glut, 1)} finds no buyer. The model assumes the sales go to the sellers with the lowest costs, and that the unsold units are not made.` : "At that price sellers would offer any amount, so most of what they would like to sell finds no buyer.");
  const sides = ["consumers", "producers", "government"].filter((k) => Math.abs(w[k]) > 0);
  const gain = sides.filter((k) => w[k] > 0).map((k) => `${groupName(k).toLowerCase()} gain ${amount(w[k])}`);
  const lose = sides.filter((k) => w[k] < 0).map((k) => `${groupName(k).toLowerCase()} lose ${amount(-w[k])}`);
  const list = listed([...lose, ...gain].map((item) => item.replace(/^government (gain|lose)/, "the government $1s")));
  const kind = r.shock.loss === "deadweight" ? "a deadweight loss" : "a net loss";
  const whole = w.loss > 0 ? `Taken together that is ${kind} of ${amount(w.loss)}.` : "Taken together nothing is lost: what one side loses the other gains.";
  if (list) out.push(`${list[0].toUpperCase()}${list.slice(1)}. ${whole}`);
  if (s === "drought" || s === "strike" || s === "cost") {
    if (w.producers > 0) out.push("Sellers as a group come out ahead: the higher price on what they still sell outweighs what the shock costs them. Demand is inelastic enough for a smaller supply to earn more.");
  }
  return out;
}

/** The curves as equations in words and symbols, for readers who cannot see the diagram. "^" marks a power. */
export function equations(r) {
  const g = (x) => fmt.sig(x, 4);
  const { D, S } = r;
  const { p0, q0, size } = r.model;
  const line = (c, d, from = 0) => {
    const body = c === 0 ? `${g(d)} P` : c > 0 ? `${g(c)} + ${g(d)} P` : `${g(d)} P − ${g(-c)}`;
    const starts = Math.max(from, d > 0 && c < 0 ? -c / d : 0);
    return `Q = ${body}${starts > 0 ? ` (nothing below a price of ${g(starts)})` : ""}`;
  };
  const demand = D.kind === "horizontal" ? `buyers take any quantity at a price of ${g(p0)} and nothing above it`
    : D.kind === "vertical" ? `Q = ${g(q0)} at every price`
    : D.kind === "linear" ? `Q = ${g(D.a)} − ${g(D.b)} P (nothing above a price of ${g(D.top)})`
    : `Q = ${g(q0)} × (P ÷ ${g(p0)})^−${g(D.e)}`;
  const k = 1 - size / 100, key = r.shock.key;
  const supplyOf = (kq, kp, u) => {
    if (S.kind === "horizontal") return `sellers offer any quantity at a price of ${g(u + p0 / kp)} and nothing below it`;
    if (S.kind === "vertical") return `Q = ${g(kq * q0)} at every price${u > 0 ? ` of ${g(u)} or more` : ""}`;
    if (S.kind === "linear") return line(kq * (S.c - S.d * kp * u), kq * S.d * kp, u);
    return `Q = ${g(kq * kp ** S.e * q0)} × (${u > 0 ? `(P − ${g(u)})` : "P"} ÷ ${g(p0)})^${g(S.e)}`;
  };
  const moved = r.S1 && (r.status === "changed" || r.status === "closed");
  return {
    demand, supply: supplyOf(1, 1, 0),
    supplyAfter: !moved ? null : key === "drought" ? supplyOf(k, k, 0) : key === "strike" ? supplyOf(k, 1, 0) : supplyOf(1, 1, size),
  };
}
