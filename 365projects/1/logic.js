// Day 1: Can Money Buy Happiness? The model, with no DOM code.
// Cross-country regression of life evaluation on log income, with optional controls.

import { stats } from "../kit/kit.js";

/** Optional controls. "factor" is the index into the WHR factor array; health comes from the World Bank. */
export const CONTROLS = [
  { key: "health", label: "Health", detail: "Life expectancy at birth, in years (World Bank)", unit: "per extra year of life expectancy" },
  { key: "social", label: "Social support", detail: "Having someone to count on in times of trouble (World Happiness Report factor)", factor: 1 },
  { key: "freedom", label: "Freedom", detail: "Satisfaction with freedom to make life choices (World Happiness Report factor)", factor: 3 },
  { key: "generosity", label: "Generosity", detail: "Donating to charity, adjusted for income (World Happiness Report factor)", factor: 4 },
  { key: "corruption", label: "Low corruption", detail: "Perceived absence of corruption in government and business (World Happiness Report factor)", factor: 5 },
];

/** One row per country with a life evaluation and an income for that year. Missing controls are null. */
export function rowsFor(data, year) {
  const i = data.years.indexOf(year);
  if (i < 0) return [];
  const rows = [];
  for (const c of data.countries) {
    if (c.ladder[i] == null || !c.gdp[i]) continue;
    const row = { name: c.name, iso3: c.iso3, region: c.region, ladder: c.ladder[i], gdp: c.gdp[i], doublings: Math.log2(c.gdp[i]), health: c.life[i] ?? null };
    for (const k of CONTROLS) if (k.factor != null) row[k.key] = c.factors[i] ? c.factors[i][k.factor] : null;
    rows.push(row);
  }
  return rows;
}

/** Controls that have a value for at least `min` of the rows. */
export function availableControls(rows, min = 30) {
  return CONTROLS.filter((k) => rows.filter((r) => r[k.key] != null).length >= min).map((k) => k.key);
}

/**
 * Fit life evaluation on log2(income), alone and with the chosen controls, on the same countries.
 * Returns { error } when there are too few complete rows.
 */
export function fit(rows, controlKeys = []) {
  const keys = CONTROLS.map((k) => k.key).filter((k) => controlKeys.includes(k));
  const sample = rows.filter((r) => keys.every((k) => r[k] != null));
  const n = sample.length;
  if (n < keys.length + 8) {
    const have = `Only ${n} ${n === 1 ? "country has" : "countries have"}`;
    const need = `at least ${keys.length + 8} are needed`;
    return {
      n,
      error: keys.length
        ? `${have} all of these measures, and ${need} to fit this many controls. Choose fewer controls, another year or a wider region.`
        : `${have} a life evaluation and an income here, and ${need} to fit a line. Choose a wider region or put back the countries left out.`,
    };
  }

  const x = sample.map((r) => r.doublings);
  const y = sample.map((r) => r.ladder);
  const alone = stats.linreg(x, y);
  const result = { n, sample, keys, alone: { perDoubling: alone.slope, intercept: alone.intercept, r2: alone.r2, se: alone.seSlope } };

  if (!keys.length) {
    const mx = stats.mean(x), my = stats.mean(y);
    result.full = null;
    result.withControls = result.alone;
    result.partial = sample.map((r, j) => ({ name: r.name, ex: x[j] - mx, ey: y[j] - my }));
    result.residuals = sample.map((r, j) => ({ name: r.name, actual: y[j], predicted: alone.intercept + alone.slope * x[j], residual: y[j] - (alone.intercept + alone.slope * x[j]) }));
    result.split = { income: alone.r2, shared: 0, controls: 0, unexplained: 1 - alone.r2 };
    result.coefficients = [{ key: "income", label: "Income", beta: alone.slope, se: alone.seSlope, perSd: alone.slope * stats.sd(x), sePerSd: alone.seSlope * stats.sd(x), unit: "per doubling of income" }];
    return result;
  }

  const C = sample.map((r) => keys.map((k) => r[k]));
  let full, controlsOnly, xOnControls;
  try {
    full = stats.ols(sample.map((r, j) => [x[j], ...C[j]]), y);
    controlsOnly = stats.ols(C, y);
    xOnControls = stats.ols(C, x);
  } catch {
    return { error: "These controls are too closely related in this sample to separate. Remove one of them.", n };
  }

  result.full = full;
  result.withControls = { perDoubling: full.beta[1], intercept: full.beta[0], r2: full.r2, se: full.se[1], adjR2: full.adjR2 };
  // Added-variable plot: what is left of income and of life evaluation once the controls have explained what they can.
  result.partial = sample.map((r, j) => ({ name: r.name, ex: xOnControls.residuals[j], ey: controlsOnly.residuals[j] }));
  result.residuals = sample.map((r, j) => ({ name: r.name, actual: y[j], predicted: full.fitted[j], residual: full.residuals[j] }));
  result.split = {
    income: full.r2 - controlsOnly.r2,
    shared: alone.r2 + controlsOnly.r2 - full.r2,
    controls: full.r2 - alone.r2,
    unexplained: 1 - full.r2,
  };
  result.controlsOnlyR2 = controlsOnly.r2;
  result.coefficients = [
    { key: "income", label: "Income", beta: full.beta[1], se: full.se[1], perSd: full.beta[1] * stats.sd(x), sePerSd: full.se[1] * stats.sd(x), unit: "per doubling of income" },
    ...keys.map((k, j) => {
      const def = CONTROLS.find((c) => c.key === k);
      const col = C.map((row) => row[j]);
      return { key: k, label: def.label, beta: full.beta[j + 2], se: full.se[j + 2], perSd: full.beta[j + 2] * stats.sd(col), sePerSd: full.se[j + 2] * stats.sd(col), unit: def.unit || null };
    }),
  ];
  return result;
}

/** The k countries furthest above and below what the model predicts. */
export function outliers(result, k = 3) {
  const sorted = [...result.residuals].sort((a, b) => b.residual - a.residual);
  return { above: sorted.slice(0, k), below: sorted.slice(-k).reverse() };
}

/** Life evaluation predicted by the income-only line at a given income. */
export const predictAlone = (result, gdp) => result.alone.intercept + result.alone.perDoubling * Math.log2(gdp);
