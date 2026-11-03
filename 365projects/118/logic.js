// Day 118: Regression to the Mean Simulator. The model, with no DOM code.
//
// Every simulated scenario is a population measured twice, with nothing changing in between. Each unit has a
// fixed true level; each measurement adds its own luck. The correlation between the two measurements is r, which
// the visitor sets. A group is picked for being extreme on the first measurement, and the second measurement of
// the same group is compared with the first. Whatever change appears is produced by the selection alone, unless
// the visitor switches on a real effect.

import { rng, stats } from "../kit/kit.js";

export const LIMITS = { nMin: 200, nMax: 100000, shareMin: 0.01, shareMax: 0.5, plotMax: 1000 };

/**
 * The scenarios. Their numbers are illustrations, not measurements: real correlations differ by test, sport, road
 * and patient group. kind "normal": both measurements are normal with the same mean and SD. kind "counts": each
 * unit has a Poisson rate drawn from a gamma distribution, and each year's count is a Poisson draw from that rate.
 */
export const SCENARIOS = [
  {
    id: "pupils", kind: "normal", title: "The worst performers improve",
    story: "Pupils sit two tests of the same difficulty. The lowest scorers on the first are given extra tuition.",
    who: "pupils", one: "pupil", measure: "Test score", unit: "points", mean: 100, sd: 15, first: "First test", second: "Second test", firstAt: "at the first test", secondAt: "at the second test",
    pick: "bottom", share: 0.1, r: 0.7, n: 10000, treatment: "extra tuition", treated: "tutored", better: "higher", effectMax: 15,
  },
  {
    id: "slump", kind: "normal", title: "The sophomore slump",
    story: "Players are rated on their first and second seasons. The best first seasons win an award and a magazine cover.",
    who: "players", one: "player", measure: "Season rating", unit: "points", mean: 50, sd: 10, first: "First season", second: "Second season", firstAt: "in the first season", secondAt: "in the second season",
    pick: "top", share: 0.05, r: 0.5, n: 2000, treatment: "a magazine cover", treated: "on the cover", better: "higher", effectMax: 10,
  },
  {
    id: "camera", kind: "counts", title: "A speed camera at the worst junction",
    story: "Crashes are counted at every junction for a year. Cameras go up at the junctions with the most crashes, and crashes are counted again the next year.",
    who: "junctions", one: "junction", measure: "Crashes in a year", unit: "crashes", mean: 3, first: "Year before", second: "Year after", firstAt: "in the year before", secondAt: "in the year after",
    pick: "top", share: 0.05, r: 0.5, n: 5000, treatment: "a speed camera", treated: "with a camera", better: "lower", effectMax: 0.5,
  },
  {
    id: "patients", kind: "normal", title: "A treatment given to the sickest",
    story: "Patients have their blood pressure measured at screening. Those with the highest readings are given a pill and measured again at follow-up.",
    who: "patients", one: "patient", measure: "Systolic blood pressure", unit: "mmHg", mean: 130, sd: 15, first: "Screening", second: "Follow-up", firstAt: "at screening", secondAt: "at follow-up",
    pick: "top", share: 0.15, r: 0.6, n: 10000, treatment: "the pill", treated: "given the pill", better: "lower", effectMax: 15,
  },
];
export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id);
/** The highest r the count model can take: at r = 1 the gamma distribution of rates would need infinite spread. */
export const maxR = (kind) => (kind === "counts" ? 0.95 : 1);

/* ------------------------------------------------------------------ random draws */

/** Gamma(shape, 1) by Marsaglia and Tsang (2000); shapes below 1 use the boost Gamma(a) = Gamma(a + 1) U^(1/a). */
export function gammaDraw(r, shape) {
  if (shape < 1) {
    let u = 0;
    while (u === 0) u = r();
    return gammaDraw(r, shape + 1) * u ** (1 / shape);
  }
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x = r.normal();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Poisson(lam): multiplication of uniforms below 10, Hormann's transformed rejection (PTRS, 1993) from 10 up. */
export function poissonDraw(r, lam) {
  if (!(lam > 0)) return 0;
  if (lam < 10) {
    const limit = Math.exp(-lam);
    let k = 0, prod = r();
    while (prod > limit) { k++; prod *= r(); }
    return k;
  }
  const slam = Math.sqrt(lam), loglam = Math.log(lam);
  const b = 0.931 + 2.53 * slam, a = -0.059 + 0.02483 * b;
  const invalpha = 1.1239 + 1.1328 / (b - 3.4), vr = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const U = r() - 0.5, V = r(), us = 0.5 - Math.abs(U);
    const k = Math.floor((2 * a / us + b) * U + lam + 0.43);
    if (us >= 0.07 && V <= vr) return k;
    if (k < 0 || (us < 0.013 && V > us)) continue;
    if (Math.log(V) + Math.log(invalpha) - Math.log(a / (us * us) + b) <= -lam + k * loglam - stats.logGamma(k + 1)) return k;
  }
}

/* ------------------------------------------------------------------ the formula */

/** Expected second measurement of a unit whose first was x: mu + r (x - mu). The same line for both kinds. */
export const expectedSecond = (x, mu, r) => mu + r * (x - mu);
/** Expected movement back towards the mean of a group whose first measurements average xbar: (1 - r) (xbar - mu). */
export const expectedRegression = (xbar, mu, r) => (1 - r) * (xbar - mu);

/** Check a simulation's settings. Returns { error } with a sentence saying what to fix, or { ok: true }. */
export function checkParams({ kind, n, share, r, control }) {
  if (!Number.isInteger(n) || n < LIMITS.nMin || n > LIMITS.nMax) return { error: `Choose a whole number of units between ${LIMITS.nMin} and ${LIMITS.nMax.toLocaleString("en-GB")}.` };
  if (!(share >= LIMITS.shareMin && share <= LIMITS.shareMax)) return { error: "Pick between 1% and 50% of the units." };
  if (!(r >= 0 && r <= maxR(kind))) return { error: `Set the correlation between 0 and ${maxR(kind)}.` };
  const m = Math.round(share * n);
  if (m < (control ? 4 : 2)) return { error: `That picks ${m} ${m === 1 ? "unit" : "units"}; at least ${control ? 4 : 2} are needed${control ? " to split into two groups" : ""}. Pick a larger share or more units.` };
  return { ok: true };
}

/* ------------------------------------------------------------------ the simulation */

const SALT_Y = 0x9e3779b9, SALT_SPLIT = 0x85ebca6b;

/**
 * Simulate one scenario, in steps of `chunk` units so that a page can spread the work over several tasks.
 * A generator: each yield is a pause; the return value is the result. simulate() below runs it in one go.
 *
 *   params: { kind, mean, sd, r, n, seed, pick: "bottom" | "top", share, control: bool, effect }
 *   effect: added to a treated unit's second measurement (kind "normal"), or the proportional change in a treated
 *           junction's crash rate (kind "counts", so -0.2 is 20% fewer crashes).
 */
export function* simulateSteps(params, chunk = 20000) {
  const { kind, mean: mu, sd = 1, r, n, seed, pick, share, control = false, effect = 0 } = params;
  const counts = kind === "counts";
  const rx = rng(seed), ry = rng((seed ^ SALT_Y) >>> 0), rs = rng((seed ^ SALT_SPLIT) >>> 0);
  const level = new Float64Array(n), x = new Float64Array(n), key = new Float64Array(n), y = new Float64Array(n);
  // counts: rate ~ Gamma(alpha, beta) with beta = 1/r - 1 and alpha = mu beta, so the mean is mu and corr(X, Y) = r.
  const beta = counts && r > 0 ? 1 / r - 1 : 0, alpha = mu * beta;
  const a = Math.sqrt(r), e = Math.sqrt(1 - r);
  for (let i = 0; i < n; i++) {
    if (counts) {
      level[i] = r > 0 ? gammaDraw(rx, alpha) / beta : mu;
      x[i] = poissonDraw(rx, level[i]);
      key[i] = x[i] + rx(); // a random place within each count breaks ties at random
    } else {
      level[i] = a * rx.normal();
      x[i] = mu + sd * (level[i] + e * rx.normal());
      key[i] = x[i];
    }
    if ((i + 1) % chunk === 0) yield;
  }

  // Pick the m most extreme units on the first measurement.
  const m = Math.round(share * n);
  const sorted = Float64Array.from(key).sort();
  const cut = pick === "top" ? sorted[n - m] : sorted[m - 1];
  const group = new Uint8Array(n); // 0 not picked, 1 picked (and treated), 2 picked and held back as a control
  let taken = 0;
  for (let i = 0; i < n && taken < m; i++) {
    if (pick === "top" ? key[i] > cut : key[i] < cut) { group[i] = 1; taken++; }
  }
  for (let i = 0; i < n && taken < m; i++) if (key[i] === cut && !group[i]) { group[i] = 1; taken++; }
  if (control) {
    // Complete randomisation: a shuffle of the picked units, the first half treated, the rest held back.
    const picked = [];
    for (let i = 0; i < n; i++) if (group[i]) picked.push(i);
    const order = rs.shuffle(picked);
    order.slice(Math.floor(m / 2)).forEach((i) => { group[i] = 2; });
  }
  yield;

  for (let i = 0; i < n; i++) {
    const treated = group[i] === 1;
    if (counts) y[i] = poissonDraw(ry, level[i] * (treated ? 1 + effect : 1));
    else y[i] = mu + sd * (level[i] + e * ry.normal()) + (treated ? effect : 0);
    if ((i + 1) % chunk === 0) yield;
  }
  return summarise({ ...params, sd, beta, effect, control }, x, y, group);
}

/** Run a generator to the end and return its result. */
export function finish(gen) {
  for (;;) { const s = gen.next(); if (s.done) return s.value; }
}
export const simulate = (params) => finish(simulateSteps(params));

/** One group's means, the formula's prediction for it, and how far apart they are in standard errors. */
function groupStats(idx, x, y, { kind, mean: mu, sd, r, effect }, treated) {
  const m = idx.length;
  const xs = idx.map((i) => x[i]), ys = idx.map((i) => y[i]);
  const xbar = stats.mean(xs), ybar = stats.mean(ys);
  const c = treated ? 1 + effect : 1;
  let predicted, variance;
  if (kind === "counts") {
    // E[rate | X = k] = mu + r (k - mu) and Var[rate | X = k] = r E[rate | X = k] (gamma-Poisson), so
    // Var[Y | X = k] = c E + c^2 r E for a rate multiplied by c.
    let sumE = 0, sumV = 0;
    for (const k of xs) { const E = expectedSecond(k, mu, r); sumE += E; sumV += c * E + c * c * r * E; }
    predicted = (c * sumE) / m;
    variance = sumV / (m * m);
  } else {
    predicted = expectedSecond(xbar, mu, r) + (treated ? effect : 0);
    variance = (sd * sd * (1 - r * r)) / m;
  }
  const se = Math.sqrt(variance);
  // With r = 1 the second measurement is the first plus any effect, the standard error is 0, and the two can differ
  // only by rounding.
  const z = se > 0 ? (ybar - predicted) / se : Math.abs(ybar - predicted) <= 1e-9 * (1 + Math.abs(predicted)) ? 0 : NaN;
  return { m, xbar, ybar, change: ybar - xbar, distance: xbar - mu, regression: expectedRegression(xbar, mu, r), predicted, predictedChange: predicted - xbar, se, z, within: Math.abs(z) <= 2, sdY: m > 1 ? stats.sd(ys) : NaN };
}

function summarise(p, x, y, group) {
  const { n, kind } = p;
  const picked = [], treated = [], held = [];
  for (let i = 0; i < n; i++) {
    if (group[i]) picked.push(i);
    if (group[i] === 1) treated.push(i);
    if (group[i] === 2) held.push(i);
  }
  const out = {
    n, m: picked.length, kind, mu: p.mean, r: p.r,
    population: { xbar: stats.mean(x), ybar: stats.mean(y), corr: stats.corr(x, y) },
    treated: groupStats(treated, x, y, p, true),
    control: p.control ? groupStats(held, x, y, p, false) : null,
    // The first plotMax units are a random sample of the whole population, so they are what the chart shows.
    plot: Array.from({ length: Math.min(n, LIMITS.plotMax) }, (_, i) => [x[i], y[i], group[i]]),
  };
  if (p.control) out.effect = effectEstimate(out.treated, out.control, kind, y, treated, held);
  return out;
}

/**
 * The randomised comparison: the treated half against the held-back half at the second measurement. The two halves
 * were alike at the start because chance alone decided which was which, so their difference afterwards estimates
 * the effect. kind "normal": difference of means with Welch's standard error. kind "counts": ratio of means, with
 * the interval worked out on the log scale (delta method).
 */
export function effectEstimate(t, c, kind, y, ti, ci) {
  const vt = stats.variance(ti.map((i) => y[i])), vc = stats.variance(ci.map((i) => y[i]));
  if (kind === "counts") {
    if (!(t.ybar > 0 && c.ybar > 0)) return { estimate: NaN, low: NaN, high: NaN, error: "One of the groups had no crashes at all in the second year, so their ratio cannot be taken." };
    const lr = Math.log(t.ybar / c.ybar);
    const se = Math.sqrt(vt / (t.m * t.ybar ** 2) + vc / (c.m * c.ybar ** 2));
    return { estimate: Math.exp(lr) - 1, low: Math.exp(lr - 1.96 * se) - 1, high: Math.exp(lr + 1.96 * se) - 1, se };
  }
  const se = Math.sqrt(vt / t.m + vc / c.m);
  const d = t.ybar - c.ybar;
  return { estimate: d, low: d - 1.96 * se, high: d + 1.96 * se, se };
}

/** Does an interval contain a value? Used for the verdicts on the control comparison. */
export const covers = (iv, v) => iv.low <= v && v <= iv.high;

/* ------------------------------------------------------------------ testing the formula at every r */

export const sweepGrid = (kind) => Array.from({ length: kind === "counts" ? 20 : 21 }, (_, i) => Math.round(i * 5) / 100);

/**
 * Simulate the same scenario at r = 0, 0.05, ..., 1 (0.95 for counts), with no effect and no control group, and
 * compare the share of the distance to the mean that the picked group gets back with 1 - r.
 * Each r has its own seed, so the 21 checks are independent of one another.
 */
export function* sweepSteps(params, chunk = 20000) {
  const rows = [];
  for (const [i, r] of sweepGrid(params.kind).entries()) {
    const res = yield* simulateSteps({ ...params, r, control: false, effect: 0, seed: (params.seed + 7919 * (i + 1)) >>> 0 }, chunk);
    const g = res.treated;
    const d = g.xbar - params.mean;
    const share = d !== 0 ? (g.xbar - g.ybar) / d : NaN;
    const se = d !== 0 ? g.se / Math.abs(d) : NaN;
    rows.push({ r, share, se, expected: 1 - r, z: se > 0 ? (share - (1 - r)) / se : Math.abs(share - (1 - r)) <= 1e-9 ? 0 : NaN });
    yield;
  }
  // A check with no luck in it (r = 1 in the normal model) has a standard error of 0 and cannot fall outside.
  const live = rows.filter((row) => row.se > 0);
  const outside = live.filter((row) => !(Math.abs(row.z) <= 2)).length;
  return { rows, within: rows.filter((row) => Math.abs(row.z) <= 2).length, checks: live.length, outside, chance: chanceOutside(outside, live.length) };
}
export const sweep = (params) => finish(sweepSteps(params));

/** The chance that one check of a correct formula falls more than two standard errors out: P(|Z| > 2) = 0.0455. */
export const OUTSIDE2 = 2 * (1 - stats.normalCdf(2));
/** The chance that k or more of n independent checks of a correct formula fall outside by luck alone. */
export function chanceOutside(k, n, p = OUTSIDE2) {
  let s = 0;
  for (let j = Math.max(0, k); j <= n; j++) s += stats.binomPmf(j, n, p);
  return Math.min(1, s);
}

/* ------------------------------------------------------------------ Galton's families */

export const PAIRINGS = {
  midparent: { label: "Mid-parent and every child", parent: "Mid-parent height", child: "Child's height", parents: "mid-parents", children: "children", note: "As Galton did: the mid-parent is the average of the father and 1.08 times the mother, and each daughter's height is multiplied by 1.08." },
  fatherSon: { label: "Father and son", parent: "Father's height", child: "Son's height", parents: "fathers", children: "sons", note: "Fathers and their sons, heights as recorded." },
  motherDaughter: { label: "Mother and daughter", parent: "Mother's height", child: "Daughter's height", parents: "mothers", children: "daughters", note: "Mothers and their daughters, heights as recorded." },
};
/** Galton (1886) multiplied every female height by 1.08 to put it on the male scale. */
export const FEMALE_FACTOR = 1.08;

/** One pair per child: { x: parent value, y: child value, family }. */
export function galtonPairs(data, pairing) {
  const out = { x: [], y: [], family: [] };
  for (const [family, father, mother, son, height] of data.rows) {
    let px, cy;
    if (pairing === "midparent") { px = (father + FEMALE_FACTOR * mother) / 2; cy = son ? height : FEMALE_FACTOR * height; }
    else if (pairing === "fatherSon") { if (!son) continue; px = father; cy = height; }
    else if (pairing === "motherDaughter") { if (son) continue; px = mother; cy = height; }
    else throw new Error(`unknown pairing ${pairing}`);
    out.x.push(px); out.y.push(cy); out.family.push(family);
  }
  return out;
}

/**
 * Pick the most extreme share of the pairs on one side (the parents, or the children) and compare the other side
 * with the regression line. Heights are recorded to the nearest half or tenth of an inch, so many are tied: every
 * pair tied with the last one picked is picked too, and the actual number is reported.
 *
 * In standard units (each side minus its mean, divided by its SD) the line is z_other = r z_picked, so the group's
 * expected share of the distance back to the mean is 1 - r. The standard error of the gap between the group's mean
 * and the line allows for brothers and sisters sharing parents: residuals are summed within a family first.
 */
export function galtonSelect(pairs, { direction = "parents", pick = "top", share = 0.1 }) {
  const sel = direction === "parents" ? pairs.x : pairs.y;
  const oth = direction === "parents" ? pairs.y : pairs.x;
  const n = sel.length;
  const want = Math.max(1, Math.round(share * n));
  const sorted = [...sel].sort((a, b) => a - b);
  const cut = pick === "top" ? sorted[n - want] : sorted[want - 1];
  const idx = [];
  for (let i = 0; i < n; i++) if (pick === "top" ? sel[i] >= cut : sel[i] <= cut) idx.push(i);
  const muS = stats.mean(sel), muO = stats.mean(oth), sdS = stats.sd(sel, false), sdO = stats.sd(oth, false);
  const r = stats.corr(sel, oth);
  const slope = (r * sdO) / sdS;
  const sbar = stats.mean(idx.map((i) => sel[i])), obar = stats.mean(idx.map((i) => oth[i]));
  const predicted = muO + slope * (sbar - muS);
  const byFamily = new Map();
  for (const i of idx) byFamily.set(pairs.family[i], (byFamily.get(pairs.family[i]) || 0) + (oth[i] - (muO + slope * (sel[i] - muS))));
  let ss = 0;
  for (const v of byFamily.values()) ss += v * v;
  const se = Math.sqrt(ss) / idx.length;
  const zS = (sbar - muS) / sdS, zO = (obar - muO) / sdO;
  return {
    n, want, m: idx.length, idx, cut, r, slope, muS, muO, sdS, sdO, sbar, obar, predicted, se, families: byFamily.size,
    z: se > 0 ? (obar - predicted) / se : 0,
    zS, zO, share: 1 - zO / zS, expectedShare: 1 - r,
  };
}
