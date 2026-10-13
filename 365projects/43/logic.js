// Day 43: Basic Income Microsimulation. The model, with no DOM code.
// A made-up population of households, an income tax with two bands, and a basic income. Every amount is a
// whole number of rupees a month, so the totals add up exactly.

import { rng } from "../kit/kit.js";

/** How the population is made up. None of this describes a real country. */
export const POPULATION = {
  households: 20000,
  median: 30000,                                  // rupees a month, of adults who have a market income
  noIncome: 0.15,                                 // share of adults with no market income
  adults: [[1, 0.4], [2, 0.6]],                   // [number of adults, share of households]
  children: [[0, 0.5], [1, 0.2], [2, 0.2], [3, 0.1]],
};
export const GINI_RANGE = [0.25, 0.65];
export const SEED_MAX = 999999;

/** The tax system the reform is compared with: no basic income, a tax-free allowance and two rates. */
export const PRESENT = { allowance: 10000, basicRate: 20, threshold: 80000, higherRate: 40 };
export const CHILD_SHARES = [0, 0.5, 1];
export const LIMITS = { amount: 60000, allowance: 60000, threshold: [20000, 300000] };
/** The poverty line: this share of the median income per equivalent adult under the present system. */
export const POVERTY_SHARE = 0.5;

const whole = (x) => typeof x === "number" && Number.isInteger(x);
const finite = (x) => typeof x === "number" && Number.isFinite(x);

/* ------------------------------------------------------------------ the lognormal */

/** The error function by its power series: accurate to about 1e-15 for |x| below 3. */
export function erf(x) {
  let term = x, sum = x;
  for (let n = 1; n < 80; n++) {
    term *= (-x * x) / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-17) break;
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

/** A lognormal's Gini coefficient is erf(sigma / 2), so sigma is found by halving the interval. */
export function sigmaFromGini(gini) {
  if (!finite(gini) || gini <= 0 || gini >= 0.99) return NaN;
  let lo = 0, hi = 6;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (erf(mid / 2) < gini) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------------ the population */

const pickFrom = (table, u) => { let acc = 0; for (const [value, share] of table) { acc += share; if (u < acc) return value; } return table[table.length - 1][0]; };

/**
 * Draw the population. The same seed and settings always give the same households.
 * For each household in turn: one draw for the number of adults, one for the number of children, then for
 * each adult one draw for whether they have a market income and, if so, a normal draw z for
 * income = round(median x exp(sigma z)).
 *
 * Returns { error } or { H, people, nAdults, nChildren, adults, children, size, start, income, marketIncome, settings }
 * where adults, children and size hold one number per household, and the incomes of household h's adults are
 * income[start[h]] to income[start[h + 1] - 1].
 */
export function generate(settings = {}) {
  const draft = begin(settings);
  if (draft.error) return draft;
  extend(draft, Infinity);
  return finish(draft);
}

/**
 * The same draw in pieces, so that an interface can stay responsive: begin(settings), then extend(draft, count)
 * until it returns true, then finish(draft). generate() is exactly these three in one go.
 */
export function begin({ seed = 43, gini = 0.45, households = POPULATION.households } = {}) {
  if (!whole(seed) || seed < 0 || seed > SEED_MAX) return { error: `The seed must be a whole number from 0 to ${SEED_MAX.toLocaleString("en-GB")}.` };
  if (!finite(gini) || gini < GINI_RANGE[0] - 1e-9 || gini > GINI_RANGE[1] + 1e-9) return { error: `The Gini coefficient of market incomes must be between ${GINI_RANGE[0]} and ${GINI_RANGE[1]}.` };
  if (!whole(households) || households < 10 || households > 200000) return { error: "The number of households must be a whole number from 10 to 200,000." };
  const H = households;
  return {
    H, done: 0, r: rng(seed), sigma: sigmaFromGini(gini), settings: { seed, gini, households },
    adults: new Uint8Array(H), children: new Uint8Array(H), size: new Uint8Array(H), start: new Uint32Array(H + 1), income: new Float64Array(2 * H),
    nAdults: 0, people: 0, nChildren: 0, marketIncome: 0,
  };
}
/** Draw up to `count` more households. Returns true once every household has been drawn. */
export function extend(d, count) {
  const { r, sigma } = d, stop = Math.min(d.H, d.done + count);
  for (let h = d.done; h < stop; h++) {
    const a = pickFrom(POPULATION.adults, r());
    const k = pickFrom(POPULATION.children, r());
    d.adults[h] = a; d.children[h] = k; d.size[h] = a + k; d.start[h] = d.nAdults;
    d.people += a + k; d.nChildren += k;
    for (let j = 0; j < a; j++) {
      const y = r() < POPULATION.noIncome ? 0 : Math.round(POPULATION.median * Math.exp(sigma * r.normal()));
      d.income[d.nAdults++] = y;
      d.marketIncome += y;
    }
  }
  d.done = stop;
  return d.done >= d.H;
}
export function finish(d) {
  d.start[d.H] = d.nAdults;
  return { H: d.H, people: d.people, nAdults: d.nAdults, nChildren: d.nChildren, adults: d.adults, children: d.children, size: d.size, start: d.start, income: d.income.subarray(0, d.nAdults), marketIncome: d.marketIncome, sigma: d.sigma, settings: d.settings };
}

/* ------------------------------------------------------------------ tax */

/** "" if the schedule can be used, otherwise what to fix. Rates are percentages with at most one decimal. */
export function scheduleProblem(s) {
  if (!s || typeof s !== "object") return "A tax schedule is needed.";
  const tenth = (x) => finite(x) && Math.abs(x * 10 - Math.round(x * 10)) < 1e-6;
  if (!whole(s.allowance) || s.allowance < 0 || s.allowance > LIMITS.allowance) return `The tax-free allowance must be a whole number of rupees from 0 to ${LIMITS.allowance.toLocaleString("en-GB")}.`;
  if (!whole(s.threshold) || s.threshold < LIMITS.threshold[0] || s.threshold > LIMITS.threshold[1]) return `The higher-rate threshold must be a whole number of rupees from ${LIMITS.threshold[0].toLocaleString("en-GB")} to ${LIMITS.threshold[1].toLocaleString("en-GB")}.`;
  for (const [key, name] of [["basicRate", "basic"], ["higherRate", "higher"]]) {
    if (!tenth(s[key]) || s[key] < 0 || s[key] > 100) return `The ${name} rate must be between 0% and 100%, to one decimal place at most.`;
  }
  return "";
}

/**
 * Income tax on a monthly income of y rupees, in whole rupees.
 * Nothing is due on the allowance. Income above it and up to the threshold is taxed at the basic rate, income
 * above the threshold at the higher rate. If the allowance is above the threshold, all taxed income is taxed
 * at the higher rate. Rates are held as whole tenths of a percent so the sum is exact before it is rounded.
 */
export function taxOn(y, s) {
  const top = Math.max(s.threshold, s.allowance);
  const basicBand = Math.max(0, Math.min(y, top) - s.allowance);
  const higherBand = Math.max(0, y - top);
  return Math.round((Math.round(s.basicRate * 10) * basicBand + Math.round(s.higherRate * 10) * higherBand) / 1000);
}

/** Total tax raised from the population under a schedule. */
export function taxTotal(pop, s) {
  let total = 0;
  for (let i = 0; i < pop.nAdults; i++) total += taxOn(pop.income[i], s);
  return total;
}

/* ------------------------------------------------------------------ measures */

/** Gini coefficient of values that are already sorted in rising order. NaN if they sum to nothing. */
export function giniSorted(x) {
  const n = x.length;
  let sum = 0, ranked = 0;
  for (let i = 0; i < n; i++) { sum += x[i]; ranked += (i + 1) * x[i]; }
  return n && sum > 0 ? (2 * ranked) / (n * sum) - (n + 1) / n : NaN;
}

/** One value per person (each household's value repeated for every member), sorted. */
function perPersonSorted(pop, perHousehold) {
  const out = new Float64Array(pop.people);
  let n = 0;
  for (let h = 0; h < pop.H; h++) for (let j = 0; j < pop.size[h]; j++) out[n++] = perHousehold[h];
  return out.sort();
}
const medianSorted = (x) => (x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2);

/** Income per equivalent adult: household income divided by the square root of household size. */
const equivalised = (pop, net) => { const eq = new Float64Array(pop.H); for (let h = 0; h < pop.H; h++) eq[h] = net[h] / Math.sqrt(pop.size[h]); return eq; };
const peopleBelow = (pop, eq, line) => { let n = 0; for (let h = 0; h < pop.H; h++) if (eq[h] < line) n += pop.size[h]; return n; };

/**
 * The present system, worked out once per population: each household's net income, the poverty line, and the
 * tenth of the population each household falls in.
 * Tenths are of people, ranked by income per equivalent adult. The nine cut points are the incomes of the
 * last person in each of the first nine tenths of that ranking, and a household's tenth is the number of cut
 * points that lie strictly below its income. So a household goes where its first member falls, no household
 * is split, and people with exactly the same income are never put in different tenths.
 */
export function prepare(pop, present = PRESENT) {
  const problem = scheduleProblem(present);
  if (problem) return { error: problem };
  const net = new Float64Array(pop.H);
  let tax = 0;
  for (let h = 0; h < pop.H; h++) {
    let sum = 0;
    for (let i = pop.start[h]; i < pop.start[h + 1]; i++) { const t = taxOn(pop.income[i], present); tax += t; sum += pop.income[i] - t; }
    net[h] = sum;
  }
  const eq = equivalised(pop, net);
  const sorted = perPersonSorted(pop, eq);
  const median = medianSorted(sorted);
  const line = POVERTY_SHARE * median;

  const cuts = Array.from({ length: 9 }, (_, k) => sorted[Math.ceil(((k + 1) * pop.people) / 10) - 1]);
  const decile = new Uint8Array(pop.H);
  const decilePeople = new Array(10).fill(0);
  for (let h = 0; h < pop.H; h++) {
    let t = 0;
    while (t < 9 && cuts[t] < eq[h]) t++;
    decile[h] = t; decilePeople[t] += pop.size[h];
  }
  return { present, net, tax, eq, median, line, decile, decilePeople, poverty: peopleBelow(pop, eq, line) / pop.people, gini: giniSorted(sorted) };
}

/* ------------------------------------------------------------------ the reform */

/** "" if the reform can be simulated, otherwise what to fix. */
export function reformProblem(reform) {
  if (!reform || typeof reform !== "object") return "A reform is needed.";
  if (!whole(reform.amount) || reform.amount < 0 || reform.amount > LIMITS.amount) return `The basic income must be a whole number of rupees from 0 to ${LIMITS.amount.toLocaleString("en-GB")} a month.`;
  if (!CHILD_SHARES.includes(reform.childShare)) return "The amount for a child must be none, half or all of the adult amount.";
  return scheduleProblem(reform);
}

/** What each child receives: the adult amount times the share, to the nearest rupee. */
export const childAmount = (reform) => Math.round(reform.amount * reform.childShare);

/**
 * Apply a reform { amount, childShare, allowance, basicRate, threshold, higherRate } to the population.
 * Nobody changes what they earn: only taxes and the basic income change.
 *
 * Returns { error } or
 *   gross        basic income paid out
 *   taxPresent, taxReform, extraTax
 *   netCost      gross - extraTax, which is also the sum of the changes in household income (changeSum)
 *   poverty, gini    { before, after } over people, on income per equivalent adult, against the fixed line
 *   gainers, losers, unchanged    people in households whose income rises, falls or stays the same
 *   deciles      ten of { people, gainers, losers, unchanged, change, baseIncome } from poorest to richest
 */
export function simulate(pop, base, reform) {
  const problem = reformProblem(reform);
  if (problem) return { error: problem };
  const B = reform.amount, Bc = childAmount(reform);
  const net = new Float64Array(pop.H);
  const deciles = Array.from({ length: 10 }, () => ({ people: 0, gainers: 0, losers: 0, unchanged: 0, change: 0, baseIncome: 0 }));
  let gross = 0, taxReform = 0, changeSum = 0, gainers = 0, losers = 0;
  for (let h = 0; h < pop.H; h++) {
    let sum = 0;
    for (let i = pop.start[h]; i < pop.start[h + 1]; i++) { const t = taxOn(pop.income[i], reform); taxReform += t; sum += pop.income[i] - t; }
    const paid = pop.adults[h] * B + pop.children[h] * Bc;
    gross += paid;
    net[h] = sum + paid;
    const change = net[h] - base.net[h], people = pop.size[h], d = deciles[base.decile[h]];
    changeSum += change;
    d.people += people; d.change += change; d.baseIncome += base.net[h];
    if (change > 0) { d.gainers += people; gainers += people; } else if (change < 0) { d.losers += people; losers += people; } else d.unchanged += people;
  }
  const eq = equivalised(pop, net);
  const extraTax = taxReform - base.tax;
  return {
    reform, gross, taxPresent: base.tax, taxReform, extraTax, netCost: gross - extraTax, changeSum,
    poverty: { before: base.poverty, after: peopleBelow(pop, eq, base.line) / pop.people },
    gini: { before: base.gini, after: giniSorted(perPersonSorted(pop, eq)) },
    gainers, losers, unchanged: pop.people - gainers - losers, deciles,
  };
}

/** Net cost alone: basic income paid less the extra tax raised. Cheap enough to call many times. */
export function netCost(pop, base, reform) {
  return (pop.nAdults * reform.amount + pop.nChildren * childAmount(reform)) - (taxTotal(pop, reform) - base.tax);
}

/**
 * Make the reform pay for itself by moving both tax rates by the same number of percentage points.
 * Finds the smallest move, in steps of a tenth of a point, at which the net cost is zero or less. A rate
 * that reaches 0% or 100% stops there.
 *
 * Returns { error }, or { possible: false, netCostAtMost } if even 100% on both bands leaves a cost, or
 * { possible: true, shift, reform, netCost } where shift is in percentage points (negative for a cut).
 */
export function balance(pop, base, reform) {
  const problem = reformProblem(reform);
  if (problem) return { error: problem };
  const k1 = Math.round(reform.basicRate * 10), k2 = Math.round(reform.higherRate * 10);
  const shifted = (s) => ({ ...reform, basicRate: Math.min(1000, Math.max(0, k1 + s)) / 10, higherRate: Math.min(1000, Math.max(0, k2 + s)) / 10 });
  const cost = (s) => netCost(pop, base, shifted(s));
  let lo = -Math.max(k1, k2), hi = 1000 - Math.min(k1, k2);
  if (cost(hi) > 0) return { possible: false, netCostAtMost: cost(hi) };
  if (cost(lo) <= 0) return { possible: true, shift: lo / 10, reform: shifted(lo), netCost: cost(lo) };
  // cost(lo) > 0 and cost(hi) <= 0, and cost never rises as the rates rise: close in on the first step at or below zero.
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (cost(mid) > 0) lo = mid; else hi = mid; }
  return { possible: true, shift: hi / 10, reform: shifted(hi), netCost: cost(hi) };
}
