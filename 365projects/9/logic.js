// Day 9: What Makes a Good Life? Index. Index construction with no DOM code.

import { rng, stats } from "../kit/kit.js";

/** The dimensions a visitor can weight. "factor" is the index into the WHR factor array. */
export const DIMENSIONS = [
  { key: "health", label: "Health", measure: "Life expectancy at birth, in years", source: "World Bank" },
  { key: "freedom", label: "Freedom", measure: "Satisfaction with freedom to make life choices", source: "World Happiness Report", factor: 3 },
  { key: "income", label: "Income", measure: "GDP per person at purchasing power parity, on a log scale", source: "World Bank" },
  { key: "community", label: "Community", measure: "Having someone to count on in times of trouble", source: "World Happiness Report", factor: 1 },
  { key: "generosity", label: "Generosity", measure: "Giving to charity, adjusted for income", source: "World Happiness Report", factor: 4 },
  { key: "integrity", label: "Clean institutions", measure: "Perceived absence of corruption in government and business", source: "World Happiness Report", factor: 5 },
];
export const KEYS = DIMENSIONS.map((d) => d.key);

/** One row per country with every dimension measured in the given year. */
export function countryRows(data, year) {
  const i = data.years.indexOf(year);
  if (i < 0) return [];
  const rows = [];
  for (const c of data.countries) {
    if (c.ladder[i] == null || !c.gdp[i] || c.life[i] == null || !c.factors[i]) continue;
    const raw = { health: c.life[i], income: Math.log(c.gdp[i]) };
    for (const d of DIMENSIONS) if (d.factor != null) raw[d.key] = c.factors[i][d.factor];
    rows.push({ name: c.name, region: c.region, ladder: c.ladder[i], gdp: c.gdp[i], life: c.life[i], raw });
  }
  return rows;
}

/** Average ranks (1 = smallest), ties sharing the mean of their positions. */
export function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation. */
export const spearman = (a, b) => stats.corr(ranks(a), ranks(b));

/**
 * Put every dimension on a common 0 to 100 scale.
 * "minmax": the worst country scores 0, the best 100, the rest in proportion.
 * "rank": the percentile rank, which ignores how far apart countries are.
 */
export function normalise(rows, method = "minmax") {
  const scored = rows.map((r) => ({ ...r, scores: {} }));
  for (const key of KEYS) {
    const values = rows.map((r) => r.raw[key]);
    if (method === "rank") {
      const rk = ranks(values);
      scored.forEach((r, i) => { r.scores[key] = rows.length > 1 ? ((rk[i] - 1) / (rows.length - 1)) * 100 : 100; });
    } else {
      const lo = stats.min(values), hi = stats.max(values);
      scored.forEach((r, i) => { r.scores[key] = hi > lo ? ((values[i] - lo) / (hi - lo)) * 100 : 100; });
    }
  }
  return scored;
}

/** Weights as shares that sum to 1. Returns null when every weight is zero. */
export function shares(weights) {
  const total = KEYS.reduce((s, k) => s + Math.max(0, weights[k] || 0), 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(KEYS.map((k) => [k, Math.max(0, weights[k] || 0) / total]));
}

/** Geometric scores are floored here so that one zero does not erase a country. */
export const FLOOR = 1;

/** One country's index from its 0 to 100 scores and the weight shares. */
export function score(scores, w, aggregate = "arithmetic") {
  let s = 0;
  if (aggregate === "geometric") {
    for (const k of KEYS) if (w[k] > 0) s += w[k] * Math.log(Math.max(FLOOR, scores[k]));
    return Math.exp(s);
  }
  for (const k of KEYS) s += w[k] * scores[k];
  return s;
}

/** Countries ranked by the weighted index, best first. Returns [] when every weight is zero. */
export function rank(scored, weights, aggregate = "arithmetic") {
  const w = shares(weights);
  if (!w) return [];
  return scored
    .map((r) => ({ ...r, index: score(r.scores, w, aggregate) }))
    .sort((a, b) => b.index - a.index || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Position of every country when ordered by one raw quantity, best first: { name: rank }. */
export function rankBy(rows, value) {
  return Object.fromEntries([...rows].sort((a, b) => value(b) - value(a)).map((r, i) => [r.name, i + 1]));
}

/**
 * How much does a country's rank depend on the weights? Draw `samples` random weightings of the chosen
 * dimensions (uniform over all the ways of splitting 100%), rank everyone each time, and report each
 * country's best, worst and middle 90% of ranks. Random draws almost never land on the extreme case of all the
 * weight on one dimension, which is where a rank is usually best or worst, so those cases are ranked as well
 * and count towards best and worst (not towards the middle 90%, which describes the random draws only).
 */
export function rankRange(scored, keys, { samples = 2000, seed = 9, aggregate = "arithmetic" } = {}) {
  const r = rng(seed);
  const seen = new Map(scored.map((c) => [c.name, []]));
  for (let s = 0; s < samples; s++) {
    // Exponential draws, normalised, are uniform on the simplex.
    const w = Object.fromEntries(KEYS.map((k) => [k, keys.includes(k) ? r.exponential(1) : 0]));
    for (const c of rank(scored, w, aggregate)) seen.get(c.name).push(c.rank);
  }
  const alone = new Map(scored.map((c) => [c.name, []]));
  for (const key of keys) for (const c of rank(scored, { [key]: 1 }, aggregate)) alone.get(c.name).push(c.rank);
  const out = new Map();
  for (const [name, list] of seen) {
    out.set(name, { best: Math.min(stats.min(list), ...alone.get(name)), worst: Math.max(stats.max(list), ...alone.get(name)), lo: Math.round(stats.quantile(list, 0.05)), median: Math.round(stats.median(list)), hi: Math.round(stats.quantile(list, 0.95)) });
  }
  return out;
}

/** Countries that gain and lose the most places against a reference ranking ({ name: rank }). */
export function movers(ranking, reference, k = 5) {
  const moved = ranking.map((r) => ({ name: r.name, rank: r.rank, was: reference[r.name], change: reference[r.name] - r.rank }));
  const sorted = [...moved].sort((a, b) => b.change - a.change);
  return { up: sorted.slice(0, k), down: sorted.slice(-k).reverse() };
}
