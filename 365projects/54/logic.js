// Day 54: The Education Premium. The model, with no DOM code.
// Everything here reads the fitted models and summary tables in data.js (United States, 2024). Nothing is fitted in
// the browser, and no person's record is bundled.

import { MINCER } from "./data.js";

export const LEVELS = MINCER.levels;                     // { key, label, years, people, share }, lowest first
export const SEXES = [{ key: "women", label: "Women" }, { key: "men", label: "Men" }];
export const [AGE_MIN, AGE_MAX] = MINCER.ages;
export const PROBS = MINCER.probs;                       // 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95
const SEX_INDEX = { men: 0, women: 1 };                  // the order of the tables in the data module
const Z95 = 1.959963984540054;

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const quad = (x, V) => x.reduce((s, xi, i) => s + xi * dot(V[i], x), 0); // x' V x

/** Says what is wrong with a profile, or returns "". */
export function profileProblem({ sex, age, level }) {
  if (!(sex in SEX_INDEX)) return "Choose women or men: the model is fitted separately for each.";
  if (!Number.isInteger(age) || age < AGE_MIN || age > AGE_MAX) return `Age must be a whole number from ${AGE_MIN} to ${AGE_MAX}: the sample has nobody younger or older.`;
  if (!Number.isInteger(level) || level < 0 || level >= LEVELS.length) return "Choose one of the eight levels of education.";
  return "";
}

/** Potential experience: years since leaving school if school started at 6 and was never interrupted. */
export const experience = (years, age) => Math.max(0, age - years - 6);
/** Which ten-year age band (0: 25 to 34, ... 3: 55 to 64) an age falls in. */
export const bandOf = (age) => Math.min(MINCER.bands.length - 1, Math.max(0, Math.floor((age - AGE_MIN) / 10)));

/**
 * The residual quantiles and smearing factors are stored for ten-year age bands. At one exact age each band's figures
 * are taken to belong to the middle of the band (29.5, 39.5, 49.5, 59.5) and neighbouring bands are interpolated in a
 * straight line; below the first middle and above the last, the end band is used as it is. Returns [[band, weight]].
 * The data script checks the ranges on held-out people with this same rule.
 */
export function blend(age) {
  const mids = MINCER.bands.map(([lo, hi]) => (lo + hi) / 2);
  if (age <= mids[0]) return [[0, 1]];
  if (age >= mids[mids.length - 1]) return [[mids.length - 1, 1]];
  let b = 0;
  while (mids[b + 1] <= age) b++;
  const t = (age - mids[b]) / (mids[b + 1] - mids[b]);
  return t === 0 ? [[b, 1]] : [[b, 1 - t], [b + 1, t]];
}

/** Regressors of Mincer's equation: 1, S, X, X squared. */
export function xMincer(years, age) {
  const X = experience(years, age);
  return [1, years, X, X * X];
}
/** Regressors of the by-level model: eight level indicators, then z, z^2, z^3, z^4 with z = (X - 20) / 10. */
export function xLevels(level, years, age) {
  const z = (experience(years, age) - MINCER.expCentre) / MINCER.expScale;
  return [...LEVELS.map((_, k) => (k === level ? 1 : 0)), z, z * z, z ** 3, z ** 4];
}
/**
 * Six levels hold one number of years of schooling each. Two mix several (no diploma: 0 to 12 years; some college:
 * 13 or 14), so people of one age in them differ in experience. For those the data module carries the group's own
 * weighted means of S, X, X^2, z, z^2, z^3, z^4 for each sex and age. Returns { S, X, X2, z: [z, z2, z3, z4] }.
 */
export function groupMeans(sex, level, age) {
  const k = MINCER.mixed.levels.indexOf(level);
  if (k < 0) {
    const S = LEVELS[level].years, X = experience(S, age), z = (X - MINCER.expCentre) / MINCER.expScale;
    return { S, X, X2: X * X, z: [z, z * z, z ** 3, z ** 4] };
  }
  const [S, X, X2, ...z] = MINCER.mixed.means[SEX_INDEX[sex]][k][age - AGE_MIN];
  return { S, X, X2, z };
}
/**
 * The regressors for a sex, level and age. Both models are linear in their terms, so the coefficients times the
 * group's mean regressors are exactly the model's average fitted value for the people in the group.
 */
export function regressors(model, sex, level, age) {
  const g = groupMeans(sex, level, age);
  return model === "mincer" ? [1, g.S, g.X, g.X2] : [...LEVELS.map((_, k) => (k === level ? 1 : 0)), ...g.z];
}

/**
 * The fitted mean of log annual pay for a profile, with its standard error (from the replicate-weight covariance).
 * model is "levels" (the default everywhere on the page) or "mincer".
 */
export function predictLog({ sex, age, level }, model = "levels") {
  const m = MINCER.models[model][sex];
  const x = regressors(model, sex, level, age);
  return { mean: dot(x, m.beta), se: Math.sqrt(Math.max(0, quad(x, m.cov))) };
}

/** The difference in fitted log pay between two levels at the same age and sex, with its standard error. */
export function gapLog({ sex, age }, from, to, model = "levels") {
  const m = MINCER.models[model][sex];
  const a = regressors(model, sex, from, age), b = regressors(model, sex, to, age);
  const d = b.map((v, i) => v - a[i]);
  return { diff: dot(d, m.beta), se: Math.sqrt(Math.max(0, quad(d, m.cov))) };
}

/**
 * Pay for one profile, in 2024 dollars a year.
 *   central     the model's central estimate: exp of the fitted mean of log pay (a geometric mean)
 *   ci          95% interval for that central estimate (how well the average is pinned down)
 *   quantiles   where one person may fall: the 5th ... 95th percentiles, central times exp(residual quantile) for
 *               the person's sex, age (see blend) and level
 *   mean        the arithmetic mean: central times the smearing factor of the same group
 */
export function predict(profile) {
  const problem = profileProblem(profile);
  if (problem) throw new Error(problem);
  const { sex, age, level } = profile;
  const { mean, se } = predictLog(profile);
  const s = SEX_INDEX[sex], b = bandOf(age), parts = blend(age);
  const q = PROBS.map((_, i) => parts.reduce((t, [band, w]) => t + w * MINCER.residualQuantiles[s][band][level][i], 0));
  const central = Math.exp(mean);
  return {
    log: mean, se, central,
    ci: [Math.exp(mean - Z95 * se), Math.exp(mean + Z95 * se)],
    quantiles: q.map((r) => central * Math.exp(r)),
    p10: central * Math.exp(q[1]), p25: central * Math.exp(q[2]), median: central * Math.exp(q[3]), p75: central * Math.exp(q[4]), p90: central * Math.exp(q[5]),
    mean: central * parts.reduce((t, [band, w]) => t + w * MINCER.smear[s][band][level], 0),
    people: MINCER.groupPeople[s][b][level],
  };
}

/** A weighted histogram of annual pay for a sex, age band and level: [{ x0, x1, share }], pay in dollars. */
export function histogram(sex, band, level) {
  const { lo, step, shares } = MINCER.hist;
  const h = shares[SEX_INDEX[sex]][band][level];
  const total = h.reduce((s, v) => s + v, 0);
  return h.map((v, i) => ({ x0: Math.exp(lo + i * step), x1: Math.exp(lo + (i + 1) * step), share: v / total }));
}

/**
 * The chance that a randomly chosen worker with level `a` is paid more than a randomly chosen worker with level `b`,
 * same sex and age band, from the two histograms. Two workers in the same bin (pay within 5% of each other) count
 * as a coin toss.
 */
export function outEarns(sex, band, a, b) {
  const s = SEX_INDEX[sex];
  const ha = MINCER.hist.shares[s][band][a], hb = MINCER.hist.shares[s][band][b];
  const ta = ha.reduce((x, v) => x + v, 0), tb = hb.reduce((x, v) => x + v, 0);
  let below = 0, p = 0;
  for (let i = 0; i < ha.length; i++) {
    p += (ha[i] / ta) * (below + hb[i] / tb / 2);
    below += hb[i] / tb;
  }
  return p;
}

/** The data's own weighted mean of log pay at one exact age, or null if fewer than MINCER.minCell people are behind it. */
export const cellMean = (sex, level, age) => MINCER.cellMeans[SEX_INDEX[sex]][level][age - AGE_MIN];

/**
 * Two levels side by side for one sex and age. `from` is the visitor's level, `to` the one compared with it.
 * The gap is to relative to from: +0.62 means 62% more. Three versions of it are returned: the by-level model
 * (with a 95% interval), Mincer's straight line, and the raw difference of the data's own means at that exact age.
 */
export function compare({ sex, age, from, to }) {
  const problem = profileProblem({ sex, age, level: from }) || profileProblem({ sex, age, level: to });
  if (problem) throw new Error(problem);
  const a = predict({ sex, age, level: from }), b = predict({ sex, age, level: to });
  const g = gapLog({ sex, age }, from, to);
  const gm = gapLog({ sex, age }, from, to, "mincer");
  const ca = cellMean(sex, from, age), cb = cellMean(sex, to, age);
  const band = bandOf(age);
  const [low, high] = a.central <= b.central ? [from, to] : [to, from];
  return {
    from: a, to: b, same: from === to,
    gap: { log: g.diff, se: g.se, pct: Math.exp(g.diff) - 1, ci: [Math.exp(g.diff - Z95 * g.se) - 1, Math.exp(g.diff + Z95 * g.se) - 1], dollars: b.central - a.central },
    mincer: { pct: Math.exp(gm.diff) - 1, ci: [Math.exp(gm.diff - Z95 * gm.se) - 1, Math.exp(gm.diff + Z95 * gm.se) - 1] },
    raw: ca == null || cb == null ? null : { pct: Math.exp(cb - ca) - 1 },
    low, high, band,
    // The chance that someone from the lower-paid level out-earns someone from the higher-paid one.
    upset: from === to ? 0.5 : outEarns(sex, band, low, high),
  };
}

/** The fitted curve for one sex and level over every age: [{ age, central, p10, p90, dot }], dot being the data's own mean. */
export function profileCurve(sex, level) {
  const out = [];
  for (let age = AGE_MIN; age <= AGE_MAX; age++) {
    const p = predict({ sex, age, level });
    const c = cellMean(sex, level, age);
    out.push({ age, central: p.central, p10: p.p10, p90: p.p90, dot: c == null ? null : Math.exp(c) });
  }
  return out;
}

/** Mincer's coefficient on a year of schooling for one sex: the log-point return, its standard error, and exp(r) - 1. */
export function returnPerYear(sex) {
  const m = MINCER.models.mincer[sex];
  const r = m.beta[1], se = Math.sqrt(m.cov[1][1]);
  return { coef: r, se, pct: Math.exp(r) - 1, ci: [Math.exp(r - Z95 * se) - 1, Math.exp(r + Z95 * se) - 1] };
}
/** The age at which Mincer's quadratic says pay peaks for a given number of years of schooling: X* = -b1 / (2 b2). */
export function peakExperience(sex) {
  const [, , b1, b2] = MINCER.models.mincer[sex].beta;
  return -b1 / (2 * b2);
}
