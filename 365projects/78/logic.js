// Day 78: Government Debt Dynamics. The model, with no DOM code.
// d(t+1) = d(t) (1 + r) / (1 + g) + p: debt as a share of GDP, with the effective interest rate r, nominal growth g
// and the primary deficit p (a share of GDP, negative for a surplus). Debt and p in percent of GDP; r and g as
// fractions inside the functions, percent at the edges.

/** Input ranges (percent). */
export const LIMITS = {
  debt: { min: 0, max: 1000 },
  rate: { min: -10, max: 50 },
  growth: { min: -20, max: 50 },
  deficit: { min: -30, max: 30 },
  years: { min: 1, max: 200 },
};

/** Check typed inputs (percent) and return { ok, errors, s } with r and g as fractions. */
export function readScenario(input) {
  const errors = [];
  const num = (key, what, whole = false) => {
    const v = input[key], lim = LIMITS[key];
    if (!Number.isFinite(v) || v < lim.min || v > lim.max || (whole && !Number.isInteger(v))) {
      errors.push({ key, message: `Enter ${what} from ${lim.min} to ${lim.max}${whole ? ", a whole number" : ""}.` });
    }
  };
  num("debt", "debt in % of GDP");
  num("rate", "an interest rate in %");
  num("growth", "a growth rate in %");
  num("deficit", "a primary deficit in % of GDP (negative for a surplus)");
  num("years", "a number of years", true);
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors, s: { d0: input.debt, r: input.rate / 100, g: input.growth / 100, p: input.deficit, years: input.years } };
}

/** The yearly factor on last year's debt ratio: (1 + r) / (1 + g). */
export const factor = (r, g) => (1 + r) / (1 + g);

/** Debt ratios d(0) ... d(T) by repeating the difference equation. */
export function path(d0, r, g, p, T) {
  const a = factor(r, g), out = [d0];
  for (let t = 0; t < T; t++) out.push(out[t] * a + p);
  return out;
}

/** The explicit solution: d(t) = a^t d0 + p (1 - a^t) / (1 - a), or d0 + p t when r = g. */
export function explicit(d0, r, g, p, t) {
  if (r === g) return d0 + p * t;
  const a = factor(r, g), at = a ** t;
  return at * d0 + (p * (1 - at)) / (1 - a);
}

/**
 * The debt ratio at which the equation stands still: d* = p (1 + g) / (g - r). Debt moves towards it when r < g
 * and away from it when r > g. None when r = g (then every ratio stands still if p = 0, and none does otherwise).
 */
export const steadyState = (r, g, p) => (r === g ? null : (p * (1 + g)) / (g - r));

/** The primary surplus (percent of GDP) that holds the debt ratio at d: d (r - g) / (1 + g). */
export const stabilisingSurplus = (d, r, g) => (d * (r - g)) / (1 + g);

/** The first year's change and its two parts: the snowball d0 (r - g) / (1 + g) and the primary deficit p. */
export const firstYear = (d0, r, g, p) => ({ snowball: (d0 * (r - g)) / (1 + g), deficit: p, change: (d0 * (r - g)) / (1 + g) + p });

/**
 * Where the path goes, decided exactly from the closed form:
 *   r < g: towards d* (it "settles"), monotonically; it "stays" if it starts there.
 *   r = g: d0 + p t, so it rises or falls by p a year without limit, or stays if p = 0.
 *   r > g: away from d*: up without limit if d0 > d*, down without limit if d0 < d*, stays if d0 = d*.
 * "Equal" allows for rounding: within 1e-9 of the size of the numbers.
 */
export function verdict(d0, r, g, p) {
  const near = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  if (r === g) {
    if (p === 0) return { kind: "stays", target: d0 };
    return { kind: p > 0 ? "rises" : "falls", target: null, perYear: p };
  }
  const target = steadyState(r, g, p);
  const a = factor(r, g);
  if (near(d0, target)) return { kind: "stays", target };
  if (r < g) return { kind: "settles", target, halfLife: Math.LN2 / -Math.log(a) };
  return { kind: d0 > target ? "explodes" : "falls", target, doubling: Math.LN2 / Math.log(a) };
}

/* ---------- the countries ---------- */

/** Values of a country's series for its last `k` years (null entries skipped). */
const round4 = (x) => Number(x.toFixed(4));
function lastK(country, key, k) {
  const v = country[key];
  return v.slice(Math.max(0, v.length - k)).filter((x) => x != null);
}

/**
 * A real starting point: the last outturn year's debt and primary deficit, and r and g averaged (arithmetic mean
 * of the yearly rates) over the last `window` years, rounded to 4 decimals, as the boxes show them, so that the
 * page and the tests compute from the same numbers.
 */
export function startingPoint(country, window) {
  const rs = lastK(country, "rate", window), gs = lastK(country, "growth", window);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const n = Math.min(rs.length, gs.length);
  return {
    year: country.last, from: country.last - n + 1, years: n,
    debt: country.debt.at(-1), deficit: -country.primary.at(-1), rate: round4(mean(rs.slice(-n))), growth: round4(mean(gs.slice(-n))),
  };
}

/**
 * How well the equation, fed each year's actual r, g and primary balance, reproduces the published debt ratio over
 * the last k years. The gap is the stock-flow adjustment: everything that changes debt besides the deficit and
 * interest, such as buying financial assets, currency and valuation effects, and interest received.
 */
export function equationCheck(country, k) {
  const n = country.debt.length;
  const k2 = Math.min(k, n - 1);
  let d = country.debt[n - 1 - k2];
  for (let i = n - k2; i < n; i++) d = (d * (1 + country.rate[i] / 100)) / (1 + country.growth[i] / 100) - country.primary[i];
  const actual = country.debt[n - 1];
  return { from: country.last - k2, to: country.last, start: country.debt[n - 1 - k2], predicted: d, actual, gap: actual - d };
}
