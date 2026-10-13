// Day 39: Demand Curve Simulator. The model, with no DOM code.
// A consumer with an income and two goods, x and y: the best affordable basket for five families of preferences,
// solved exactly (corners and ties included), the demand curve it traces out, and the split of a price change
// into substitution and income effects.

import { fmt } from "../kit/kit.js";

/** The five families of preferences. `needs` lists the parameters each one uses. */
export const KINDS = [
  { id: "cobb", label: "Cobb-Douglas", needs: ["a"] }, // u = x^a · y^(1 - a)
  { id: "subs", label: "Perfect substitutes", needs: ["a"] }, // u = a·x + (1 - a)·y
  { id: "comp", label: "Perfect complements", needs: ["a"] }, // u = min(x / a, y / (1 - a))
  { id: "quasi", label: "Quasi-linear", needs: ["b"] }, // u = 2b·√x + y
  { id: "ces", label: "CES", needs: ["a", "sigma"] }, // u = (a·x^r + (1 - a)·y^r)^(1 / r) with r = 1 - 1 / sigma
];
/** Two quantities closer than this are treated as equal when a verdict is put into words. */
export const EPS = 1e-9;
const kindOf = (prefs) => KINDS.find((k) => k.id === prefs?.kind);
const positive = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;
// CES with an elasticity of 1 is Cobb-Douglas: the formula below divides by zero there, the limit does not. Within
// a millionth of 1 the power 1 / r is so large that the formula loses its digits, so the limit is used there too.
const isCobb = (prefs) => prefs.kind === "cobb" || (prefs.kind === "ces" && Math.abs(prefs.sigma - 1) < 1e-6);
/** The elasticity of substitution must lie in this range. Beyond it the powers in the CES formulas overflow. */
export const SIGMA_RANGE = [0.01, 100];

/** A sentence saying what is wrong with the preferences, or "" if they are usable. */
export function prefsProblem(prefs) {
  const kind = kindOf(prefs);
  if (!kind) return "Choose one of the five kinds of preferences.";
  if (kind.needs.includes("a") && !(positive(prefs.a) && prefs.a < 1)) return "The weight on x must be above 0 and below 1.";
  if (kind.needs.includes("b") && !positive(prefs.b)) return "The taste for x must be above 0.";
  if (kind.needs.includes("sigma") && !(positive(prefs.sigma) && prefs.sigma >= SIGMA_RANGE[0] && prefs.sigma <= SIGMA_RANGE[1])) return `The elasticity of substitution must be between ${SIGMA_RANGE[0]} and ${SIGMA_RANGE[1]}.`;
  return "";
}
function marketProblem(px, py, m) {
  if (!positive(px) || !positive(py)) return "Both prices must be above 0.";
  if (!positive(m)) return "Income must be above 0.";
  return "";
}

/** Utility of the basket (x, y). Only the ordering it gives matters, not the size of the number. */
export function utility(prefs, x, y) {
  const { a, b } = prefs;
  if (isCobb(prefs)) return x ** a * y ** (1 - a);
  if (prefs.kind === "subs") return a * x + (1 - a) * y;
  if (prefs.kind === "comp") return Math.min(x / a, y / (1 - a));
  if (prefs.kind === "quasi") return 2 * b * Math.sqrt(x) + y;
  const r = 1 - 1 / prefs.sigma;
  // With r below zero a basket with none of one good is worth nothing: 0^r is infinite and the outer power sends it to 0.
  return (a * x ** r + (1 - a) * y ** r) ** (1 / r);
}

/**
 * The best basket that income m buys at prices px and py: { x, y, u, where }.
 * `where` is "inside" (some of both, at a tangency), "kink" (perfect complements), "all x" or "all y" (a corner),
 * or "tie": every basket on the budget line is equally good, x and y are then the middle of the line and
 * `range` is the span of x.
 */
export function demand(prefs, px, py, m) {
  const error = prefsProblem(prefs) || marketProblem(px, py, m);
  if (error) return { error };
  const { a, b } = prefs;
  let x, y, where = "inside", range = null;
  if (isCobb(prefs)) {
    x = (a * m) / px; y = ((1 - a) * m) / py;
  } else if (prefs.kind === "subs") {
    // Utility per unit of money: a / px from x, (1 - a) / py from y. Compared as a·py against (1 - a)·px.
    const left = a * py, right = (1 - a) * px;
    if (Math.abs(left - right) <= 1e-12 * Math.max(left, right)) { where = "tie"; range = [0, m / px]; x = m / (2 * px); y = m / (2 * py); }
    else if (left > right) { where = "all x"; x = m / px; y = 0; }
    else { where = "all y"; x = 0; y = m / py; }
  } else if (prefs.kind === "comp") {
    const t = m / (a * px + (1 - a) * py);
    where = "kink"; x = a * t; y = (1 - a) * t;
  } else if (prefs.kind === "quasi") {
    // Tangency where b / √x = px / py. If that much x costs more than the whole income, all of it goes on x.
    const want = ((b * py) / px) ** 2;
    if (px * want < m) { x = want; y = (m - px * want) / py; } else { where = "all x"; x = m / px; y = 0; }
  } else {
    const s = prefs.sigma;
    const fx = (a / px) ** s, fy = ((1 - a) / py) ** s;
    const d = px * fx + py * fy;
    x = (m * fx) / d; y = (m * fy) / d;
  }
  return { x, y, u: utility(prefs, x, y), where, range };
}

/**
 * The least income that reaches utility level u at prices px and py.
 * For the four families whose baskets scale with income, utility is proportional to income, so this is
 * u divided by the utility one unit of income buys. Quasi-linear preferences need their own formula.
 */
export function expenditure(prefs, px, py, u) {
  const error = prefsProblem(prefs) || marketProblem(px, py, 1);
  if (error || !(typeof u === "number" && Number.isFinite(u) && u >= 0)) return NaN;
  if (prefs.kind !== "quasi") return u / demand(prefs, px, py, 1).u;
  const { b } = prefs;
  const root = (b * py) / px; // √x at the tangency
  return u >= 2 * b * root ? py * u - (b * py) ** 2 / px : px * (u / (2 * b)) ** 2;
}

/** The y that puts (x, y) on the indifference curve of level u, or null if no y of zero or more does. */
export function curveY(prefs, u, x) {
  const { a, b } = prefs;
  if (!(x >= 0) || !(u >= 0)) return null;
  let y;
  if (isCobb(prefs)) y = x > 0 ? (u / x ** a) ** (1 / (1 - a)) : null;
  else if (prefs.kind === "subs") y = (u - a * x) / (1 - a);
  else if (prefs.kind === "comp") y = x >= a * u ? (1 - a) * u : null;
  else if (prefs.kind === "quasi") y = u - 2 * b * Math.sqrt(x);
  else {
    const r = 1 - 1 / prefs.sigma;
    const t = (u ** r - a * x ** r) / (1 - a);
    y = t > 0 ? t ** (1 / r) : t === 0 && r > 0 ? 0 : null;
  }
  return y != null && Number.isFinite(y) && y >= 0 ? y : null;
}

/**
 * Split the effect on x of a change in its price from px0 to px1 (py and income m unchanged).
 *
 *   A  the best basket before        C  the best basket after
 *   B  the best basket at the new prices with income adjusted so that the consumer is "as well off as before":
 *      method "hicks":   just able to reach the old level of utility
 *      method "slutsky": just able to buy the old basket A
 *
 *   substitution = B.x - A.x      income = C.x - B.x      total = C.x - A.x
 *
 * `undetermined` is true when A or C is a tie, so that the quantity of x is not pinned down.
 */
export function split(prefs, px0, px1, py, m, method = "hicks") {
  const A = demand(prefs, px0, py, m);
  if (A.error) return { error: A.error };
  const C = demand(prefs, px1, py, m);
  if (C.error) return { error: C.error };
  if (method !== "hicks" && method !== "slutsky") return { error: "Choose the Hicks or the Slutsky method." };
  const income = method === "hicks" ? expenditure(prefs, px1, py, A.u) : m + (px1 - px0) * A.x;
  const B = demand(prefs, px1, py, income);
  if (B.error) return { error: B.error };
  const undetermined = A.where === "tie" || C.where === "tie" || B.where === "tie";
  return { A, B, C, method, compensatedIncome: income, substitution: B.x - A.x, income: C.x - B.x, total: C.x - A.x, undetermined };
}

/**
 * Points of the demand curve for x as its price runs from pMin to pMax: [{ p, x }], highest price first.
 * With perfect substitutes the curve has a flat stretch at the one price where the consumer does not mind:
 * both of its ends are included.
 * `compensated` turns it into a compensated curve, with income adjusted at each price instead of held at m:
 * { u } gives just enough to reach utility u (Hicks), { x, y } just enough to buy that basket (Slutsky).
 */
export function demandCurve(prefs, py, m, pMin, pMax, steps = 120, compensated = null) {
  if (prefsProblem(prefs) || marketProblem(pMin, py, m) || !(pMax > pMin) || !(steps >= 1)) return [];
  const incomeAt = (p) => (compensated == null ? m : compensated.u != null ? expenditure(prefs, p, py, compensated.u) : p * compensated.x + py * compensated.y);
  const at = (p) => demand(prefs, p, py, incomeAt(p));
  const prices = Array.from({ length: steps + 1 }, (_, i) => pMax - ((pMax - pMin) * i) / steps);
  const tie = prefs.kind === "subs" ? (prefs.a * py) / (1 - prefs.a) : null;
  const out = [];
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const d = at(p);
    if (d.where === "tie") { out.push({ p, x: d.range[0] }, { p, x: d.range[1] }); continue; }
    out.push({ p, x: d.x });
    // The switching price usually falls between two steps of the grid: put the flat stretch in where it belongs.
    const next = prices[i + 1];
    if (tie != null && next != null && tie < p - 1e-12 && tie > next + 1e-12) {
      const span = at(tie).range;
      if (span) out.push({ p: tie, x: span[0] }, { p: tie, x: span[1] });
    }
  }
  return out;
}

/**
 * Points of the indifference curve of level u for x from 0 to xMax: [[x, y]], drawn left to right.
 * A curve that climbs out of sight is cut off at y = yCap, well above the frame it will be drawn in.
 */
export function indifferenceCurve(prefs, u, xMax, steps = 200, yCap = xMax * 8) {
  if (prefsProblem(prefs) || !(u > 0) || !(xMax > 0)) return [];
  if (prefs.kind === "comp") {
    const cx = prefs.a * u, cy = (1 - prefs.a) * u;
    return [[cx, Math.max(xMax, cy) * 4], [cx, cy], [Math.max(xMax, cx) * 4, cy]];
  }
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const x = (xMax * i) / steps;
    const y = curveY(prefs, u, x);
    if (y == null) continue;
    if (!out.length && i > 0 && y < yCap) {
      // The curve climbs out of sight somewhere between the last step and this one (Cobb-Douglas and stiff CES
      // curves never touch the y axis). Find where it passes yCap, so that the drawing starts off the top of the
      // frame and not in mid-air.
      let lo = (xMax * (i - 1)) / steps, hi = x;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2, v = curveY(prefs, u, mid);
        if (v == null || v > yCap) lo = mid; else hi = mid;
      }
      if (hi < x) out.push([hi, curveY(prefs, u, hi)]);
    }
    out.push([x, Math.min(y, yCap)]);
  }
  // Where the curve meets the x axis (perfect substitutes, quasi-linear, CES with easy substitution), end it there.
  const foot = prefs.kind === "subs" ? u / prefs.a : prefs.kind === "quasi" ? (u / (2 * prefs.b)) ** 2 : prefs.kind === "ces" && prefs.sigma > 1 ? u / prefs.a ** (1 / (1 - 1 / prefs.sigma)) : null;
  if (foot != null && foot < xMax && (!out.length || out[out.length - 1][0] < foot)) out.push([foot, 0]);
  return out;
}

/** The smallest of 100, 200, 400, ... that is at least as large as every value given: a chart axis that seldom moves. */
export function axisMax(values, base = 100) {
  let top = base;
  const need = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  while (top < need && top < base * 1024) top *= 2;
  return top;
}

const n2 = (v) => fmt.num(v, 2);
const signed = (v) => fmt.signed(v, 2);

/** The best basket in words: "25.00 of x and 25.00 of y", with a note at a corner. Not for a tie. */
export function basketWords(d) {
  const basket = `${n2(d.x)} of x and ${n2(d.y)} of y`;
  if (d.where === "all x") return `${basket}: the whole income goes on x`;
  if (d.where === "all y") return `${basket}: x is not bought at all`;
  return basket;
}
const tieWords = (d) => `every basket on the budget line is equally good, from none of x to ${n2(d.range[1])} of it`;

/** The whole result in plain words: an array of sentences. */
export function reading(r, px0, px1, py, m) {
  const given = `With an income of ${n2(m)} and prices of ${n2(px0)} for x and ${n2(py)} for y`;
  const out = [r.A.where === "tie" ? `${given}, no single basket is best: ${tieWords(r.A)}.` : `${given}, the best basket is ${basketWords(r.A)}.`];
  if (px1 === px0) {
    out.push("The two prices of x are the same, so there is no price change to split.");
    return out;
  }
  const change = `When the price of x ${px1 > px0 ? "rises" : "falls"} from ${n2(px0)} to ${n2(px1)}`;
  out.push(r.C.where === "tie" ? `${change}, no single basket is best: ${tieWords(r.C)}.` : `${change}, the best basket becomes ${basketWords(r.C)}.`);
  if (r.undetermined) {
    out.push("At one of these prices the quantity of x is not pinned down, so the change cannot be split into substitution and income effects.");
    return out;
  }
  const how = r.method === "hicks" ? "enough income to reach the old level of utility" : "enough income to buy the old basket";
  out.push(`Given ${how} at the new price, ${n2(r.compensatedIncome)}, the consumer would choose ${n2(r.B.x)} of x.`);
  out.push(`So the substitution effect on x is ${signed(r.substitution)} and the income effect is ${signed(r.income)}. The whole change is ${signed(r.total)}.`);
  const noSub = Math.abs(r.substitution) < EPS, noInc = Math.abs(r.income) < EPS;
  if (noSub && noInc) out.push("Neither effect moves the quantity of x here.");
  else if (noInc) out.push("All of the change is substitution: the income effect on x is exactly zero.");
  else if (noSub) out.push("All of the change is income effect: the substitution effect on x is exactly zero.");
  return out;
}
