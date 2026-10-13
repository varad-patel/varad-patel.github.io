// Day 37: Housing Affordability Map. The model, with no DOM code.
// A budget rule (a loan worked out from income, plus a deposit) set against the price of a home in each
// local authority district of England and Wales, for every year from 1997 to 2025.

import { AFFORD } from "./data.js";

export { AFFORD };
export const YEARS = AFFORD.years;
export const LATEST = YEARS.length - 1;
export const AREAS = AFFORD.areas;
export const REGIONS = AFFORD.regions;
export const NATIONAL = AFFORD.national;

/** Starting values. The income is the national median, the deposit a tenth of the national median price: placeholders, not advice. */
export const DEFAULTS = {
  income: NATIONAL.earnings[LATEST],
  deposit: Math.round((0.1 * NATIONAL.median[LATEST]) / 500) * 500,
  rule: "multiple",     // "multiple": a loan of so many times income; "repayment": the loan whose repayments take a set share of income
  multiple: 4.5,
  share: 30,            // per cent of gross income that may go on repayments
  rate: 5,              // per cent a year
  term: 25,             // years
  price: "median",      // or "lower": the lower quartile price
  scale: "ladder",      // "ladder": earlier years use the income of someone at the same place in the pay ladder; "fixed": the same pounds
};
export const LIMITS = {
  income: [1000, 10000000], deposit: [0, 10000000],
  multiple: [1, 8], share: [5, 60], rate: [0, 15], term: [5, 40],
};
/** Price as a share of the budget: the upper edge of each class but the last. A price equal to an edge is in the lower class. */
export const EDGES = [0.75, 1, 1.25, 1.5, 2];
export const CLASS_LABELS = [
  "three quarters of your budget or less", "over three quarters, up to all of it",
  "up to 1.25 times your budget", "1.25 to 1.5 times", "1.5 to 2 times", "more than twice your budget",
];

const num = (v) => typeof v === "number" && Number.isFinite(v);
const between = (v, [lo, hi]) => num(v) && v >= lo && v <= hi;
const money = (v) => `£${Math.round(v).toLocaleString("en-GB")}`;

/** "" when the settings can be used, otherwise a sentence saying what to fix. */
export function check(s) {
  if (!s || typeof s !== "object") return "Enter an income to begin.";
  if (!between(s.income, LIMITS.income)) return `Income must be a number from ${money(LIMITS.income[0])} to ${money(LIMITS.income[1])} a year.`;
  if (!between(s.deposit, LIMITS.deposit)) return `The deposit must be a number from £0 to ${money(LIMITS.deposit[1])}.`;
  if (s.rule !== "multiple" && s.rule !== "repayment") return "The rule must be a multiple of income or a share of income on repayments.";
  if (!between(s.multiple, LIMITS.multiple)) return `The loan must be between ${LIMITS.multiple[0]} and ${LIMITS.multiple[1]} times income.`;
  if (!between(s.share, LIMITS.share)) return `Repayments must take between ${LIMITS.share[0]}% and ${LIMITS.share[1]}% of income.`;
  if (!between(s.rate, LIMITS.rate)) return `The interest rate must be between ${LIMITS.rate[0]}% and ${LIMITS.rate[1]}%.`;
  if (!between(s.term, LIMITS.term)) return `The term must be between ${LIMITS.term[0]} and ${LIMITS.term[1]} years.`;
  if (s.price !== "median" && s.price !== "lower") return "The price must be the median or the lower quartile.";
  if (s.scale !== "ladder" && s.scale !== "fixed") return "Earlier years must either follow earnings or keep the same pounds.";
  return "";
}

/**
 * What one pound a month repays: the loan that level monthly payments of 1 pay off over `years` at `ratePct` a year,
 * with interest added monthly at a twelfth of the annual rate. At a rate of zero it is simply the number of months.
 */
export function annuity(ratePct, years) {
  const n = Math.round(years * 12), i = ratePct / 1200;
  return i === 0 ? n : (1 - (1 + i) ** -n) / i;
}

/** The loan per pound of annual income under the chosen rule. */
export const loanPerPound = (s) => (s.rule === "multiple" ? s.multiple : (s.share / 100 / 12) * annuity(s.rate, s.term));

/** What the visitor's money is multiplied by in an earlier year: median full-time earnings then over the latest, or 1. */
export const scaleFor = (s, yi) => (s.scale === "ladder" ? NATIONAL.earnings[yi] / NATIONAL.earnings[LATEST] : 1);

/** Income, deposit, loan and budget in year index yi, in that year's pounds. */
export function budget(s, yi = LATEST) {
  const k = scaleFor(s, yi);
  const income = s.income * k, deposit = s.deposit * k, loan = income * loanPerPound(s);
  return { scale: k, income, deposit, loan, budget: loan + deposit };
}

/** 0 to 5: which class a price falls in, given a budget. A price equal to the budget is within it (class 1). */
export function classOf(price, total) {
  for (let k = 0; k < EDGES.length; k++) if (price <= EDGES[k] * total) return k;
  return EDGES.length;
}

/** The income (in that year's pounds) at which the budget would just reach the price; 0 if the deposit alone covers it. */
export const incomeNeeded = (price, s, yi = LATEST) => Math.max(0, price - budget(s, yi).deposit) / loanPerPound(s);

/**
 * Every district in one year: { year, ...budget, rows, within, classes, regions } or { error }.
 * rows[i] lines up with AREAS[i]: { index, price, ratio (price / budget), within (price <= budget), klass }.
 */
export function evaluate(s, yi = LATEST) {
  const error = check(s) || (Number.isInteger(yi) && yi >= 0 && yi <= LATEST ? "" : `The year must be from ${YEARS[0]} to ${YEARS[LATEST]}.`);
  if (error) return { error };
  const b = budget(s, yi);
  const rows = AREAS.map((a, index) => {
    const price = a[s.price][yi];
    return { index, price, ratio: price / b.budget, within: price <= b.budget, klass: classOf(price, b.budget) };
  });
  const classes = new Array(EDGES.length + 1).fill(0);
  const regions = REGIONS.map((name) => ({ name, total: 0, within: 0 }));
  for (const r of rows) {
    classes[r.klass]++;
    const g = regions[AREAS[r.index].region];
    g.total++;
    if (r.within) g.within++;
  }
  return { year: YEARS[yi], ...b, rows, within: rows.filter((r) => r.within).length, classes, regions };
}

/** How many districts are within budget in each year: [{ year, within, budget }]. */
export function overTime(s) {
  if (check(s)) return { error: check(s) };
  return YEARS.map((year, yi) => {
    const b = budget(s, yi).budget;
    return { year, budget: b, within: AREAS.filter((a) => a[s.price][yi] <= b).length };
  });
}

/** One district through the years: [{ year, price, budget, within, earnings, localRatio }]. localRatio is price over local earnings, or null. */
export function areaOverTime(index, s) {
  const a = AREAS[index];
  if (!a) return { error: "No such district." };
  if (check(s)) return { error: check(s) };
  return YEARS.map((year, yi) => {
    const price = a[s.price][yi], b = budget(s, yi).budget, e = a.earnings[yi];
    return { year, price, budget: b, within: price <= b, earnings: e, localRatio: e ? price / e : null };
  });
}

/** The first and last year a district was within budget, and whether it is in the latest: for the sentence under its chart. */
export function reachSummary(index, s) {
  const t = areaOverTime(index, s);
  if (t.error) return t;
  const yes = t.filter((r) => r.within).map((r) => r.year);
  return { years: yes.length, first: yes[0] ?? null, last: yes.at(-1) ?? null, now: t[LATEST].within, always: yes.length === t.length, never: yes.length === 0 };
}

/**
 * Arrow-key movement on the map. From district `from`, the nearest district whose marker lies in the quarter of the
 * compass around `dir` ("left", "right", "up", "down"; y grows downwards). Among `allowed` indexes only. Returns `from`
 * when there is none that way.
 */
export function step(points, from, dir, allowed = null) {
  const [x0, y0] = points[from];
  let best = from, bestD = Infinity;
  for (const i of allowed || points.keys()) {
    if (i === from) continue;
    const dx = points[i][0] - x0, dy = points[i][1] - y0;
    const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
    const across = dir === "right" || dir === "left" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0 || across > along) continue;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** "in 12 of the 318 districts", with the small cases written properly. */
export function countPhrase(within, total, noun = "districts") {
  if (total === 1) return within ? "in the only one" : "not in the only one";
  if (within === 0) return `in none of the ${total} ${noun}`;
  if (within === total) return total === 1 ? "in the only one" : total === 2 ? `in both ${noun}` : `in all ${total} ${noun}`;
  return `in ${within} of the ${total} ${noun}`;
}
