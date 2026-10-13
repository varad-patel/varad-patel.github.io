// Day 45: Laffer Curve Explorer. The model, with no DOM code.
// Tax revenue as a function of the rate under two stated behavioural responses:
//   "eti"    a constant elasticity of taxable income, for a flat tax on everyone or for a top bracket (Saez 2001;
//            Diamond and Saez 2011);
//   "labour" a household choosing hours, with an income effect and a choice of what is done with the revenue.
// Rates are fractions (0.4 is 40%). Revenue is per unit of the base that would exist at a zero rate.

const check = (ok, message) => { if (!ok) throw new RangeError(message); };
const isRate = (t) => Number.isFinite(t) && t >= 0 && t <= 1;

/* ------------------------------------------------------------------ elasticity of taxable income */

/**
 * The taxed base at rate tau, relative to a zero rate. Each taxpayer's income is z0 (1 - tau)^e, so the elasticity of
 * income with respect to the net-of-tax rate 1 - tau is e. With a = 1 the tax falls on all income. With a > 1 it falls
 * only on income above a threshold in a Pareto tail with parameter a: there the mean excess over the threshold stays
 * the same and the number of taxpayers above it shrinks as (1 - tau)^(a e), so the base is (1 - tau)^(a e).
 */
export function etiBase(tau, { e, a = 1 }) {
  check(isRate(tau), "the rate must lie between 0 and 1");
  check(Number.isFinite(e) && e >= 0, "the elasticity must be a number that is not negative");
  check(Number.isFinite(a) && a >= 1, "the Pareto parameter must be at least 1");
  return a * e === 0 ? 1 : (1 - tau) ** (a * e); // with no response the base stays whole, even at 100%
}
export const etiRevenue = (tau, p) => tau * etiBase(tau, p);

/**
 * The rate that maximises tau (1 - tau)^(a e): 1 / (1 + a e). With a weight g in [0, 1) on a rupee left with these
 * taxpayers, relative to a rupee of revenue, the best rate is (1 - g) / (1 - g + a e) (Diamond and Saez 2011, note 6).
 */
export function etiPeak({ e, a = 1, g = 0 }) {
  check(Number.isFinite(e) && e >= 0, "the elasticity must be a number that is not negative");
  check(Number.isFinite(a) && a >= 1, "the Pareto parameter must be at least 1");
  check(Number.isFinite(g) && g >= 0 && g < 1, "the weight must be at least 0 and below 1");
  return (1 - g) / (1 - g + a * e);
}

/**
 * Saez (2001), equation 9: the top rate with income effects, (1 - g) / (1 - g + zu + zc (a - 1)), where zu and zc are
 * the uncompensated and compensated elasticities. With zu = zc = e and g = 0 it is 1 / (1 + a e).
 */
export function saezTopRate({ zu, zc, a, g = 0 }) {
  check([zu, zc, a, g].every(Number.isFinite) && zc >= 0 && a >= 1 && g >= 0 && g < 1, "need zc of at least 0, a of at least 1 and a weight of at least 0 and below 1");
  const denominator = 1 - g + zu + zc * (a - 1);
  check(denominator > 0, "these elasticities give no finite rate");
  return (1 - g) / denominator;
}

/* ------------------------------------------------------------------ labour supply with an income effect */

/**
 * A household with utility c^(1 - gamma) / (1 - gamma) - h^(1 + 1/frisch) / (1 + 1/frisch) (log c when gamma is 1) earns
 * a wage of 1, pays tax at rate tau on earnings and receives a lump sum equal to a share `rebate` of the revenue raised
 * from it, which it takes as given. Its first-order condition (1 - tau) c^(-gamma) = h^(1/frisch), with
 * c = h (1 - (1 - rebate) tau), gives hours relative to a zero rate:
 *     h = [ (1 - tau) / (1 - (1 - rebate) tau)^gamma ]^k,   k = frisch / (1 + gamma frisch).
 * frisch is the Frisch elasticity of hours; gamma in [0, 1] sets the income effect (0: none; 1: it exactly offsets the
 * substitution effect of a wage change that is not handed back).
 */
export function hours(tau, { gamma, frisch, rebate }) {
  check(isRate(tau), "the rate must lie between 0 and 1");
  check(Number.isFinite(gamma) && gamma >= 0 && gamma <= 1, "gamma must lie between 0 and 1");
  check(Number.isFinite(frisch) && frisch > 0, "the Frisch elasticity must be above 0");
  check(Number.isFinite(rebate) && rebate >= 0 && rebate <= 1, "the share handed back must lie between 0 and 1");
  const k = frisch / (1 + gamma * frisch);
  const kept = 1 - (1 - rebate) * tau; // consumption per hour worked
  if (tau === 1 && kept === 0) return gamma === 1 ? 1 : 0; // nothing handed back at 100%: the limit of the formula
  return ((1 - tau) / kept ** gamma) ** k;
}
export const labourRevenue = (tau, p) => tau * hours(tau, p);

/** d ln(revenue) / d tau for the labour model: zero at the peak, and falling in tau when gamma is at most 1. */
function labourSlope(tau, { gamma, frisch, rebate }) {
  const k = frisch / (1 + gamma * frisch);
  return 1 / tau - k / (1 - tau) + (k * gamma * (1 - rebate)) / (1 - (1 - rebate) * tau);
}

/**
 * The revenue-maximising rate in the labour model, by bisection on the slope. { tau, interior }: interior is false when
 * revenue rises all the way to 100%, which happens only with gamma = 1 and nothing handed back (hours then do not
 * respond at all). Closed forms at the two ends: 1 / (1 + (1 - gamma) k) with nothing handed back, 1 / (1 + k) with
 * everything handed back.
 */
export function labourPeak(p) {
  hours(0.5, p); // validates the parameters
  if (labourSlope(1 - 1e-12, p) >= 0) return { tau: 1, interior: false };
  let lo = 1e-12, hi = 1 - 1e-12;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (labourSlope(mid, p) > 0) lo = mid; else hi = mid; }
  return { tau: (lo + hi) / 2, interior: true };
}

/* ------------------------------------------------------------------ either model */

export const MODELS = ["eti", "labour"];
const pick = (model) => { check(MODELS.includes(model), "unknown model"); return model; };

export const base = (model, tau, p) => (pick(model) === "eti" ? etiBase(tau, p) : hours(tau, p));
export const revenue = (model, tau, p) => tau * base(model, tau, p);
export const peak = (model, p) => (pick(model) === "eti" ? { tau: etiPeak({ e: p.e, a: p.a ?? 1 }), interior: (p.a ?? 1) * p.e > 0 } : labourPeak(p));

/**
 * The share of the mechanical revenue from a small rate rise that is lost because the base shrinks:
 * -tau B'(tau) / B(tau). It is also the share of a small rate cut that pays for itself. It is 1 at the peak, below 1
 * to its left and above 1 to its right. Infinity at a rate of 100% when the base responds.
 */
export function offset(model, tau, p) {
  pick(model);
  check(isRate(tau), "the rate must lie between 0 and 1");
  if (model === "eti") {
    etiBase(tau, p);
    const ae = (p.a ?? 1) * p.e;
    return ae === 0 ? 0 : tau === 1 ? Infinity : (ae * tau) / (1 - tau);
  }
  hours(tau, p);
  if (tau === 0) return 0;
  if (tau === 1) return p.gamma === 1 && p.rebate === 0 ? 0 : Infinity;
  return 1 - tau * labourSlope(tau, p);
}

/** Which side of the peak a rate is on: "left" (a higher rate raises revenue), "right", or "peak" within 0.05 points. */
export function side(model, tau, p) {
  const top = peak(model, p);
  if (!top.interior) return "left";
  return Math.abs(tau - top.tau) < 0.0005 ? "peak" : tau < top.tau ? "left" : "right";
}

/** The revenue curve as n + 1 points from 0% to 100%: [{ tau, revenue, mechanical }], mechanical being tau alone. */
export function curve(model, p, n = 200) {
  return Array.from({ length: n + 1 }, (_, i) => { const tau = i / n; return { tau, revenue: revenue(model, tau, p), mechanical: tau }; });
}

/**
 * The parameters of each model: slider range, and the two values the sensitivity table compares with the current one.
 * Where there are no fixed `words`, the two values are half and double the current one, kept inside the slider's range
 * (a doubling of zero would change nothing, so zero is compared with the top of the range instead).
 */
export const PARAMS = {
  eti: [
    { key: "e", label: "Elasticity of taxable income", min: 0, max: 1.5, step: 0.01, around: (v) => [v / 2, v > 0 ? Math.min(1.5, v * 2) : 1.5] },
    { key: "a", label: "Pareto parameter of top incomes", min: 1.1, max: 3, step: 0.05, around: () => [1.1, 3], words: ["thickest tail on the slider", "thinnest tail on the slider"] },
  ],
  labour: [
    { key: "frisch", label: "Frisch elasticity of hours", min: 0.1, max: 3, step: 0.05, around: (v) => [Math.max(0.1, v / 2), Math.min(3, v * 2)] },
    { key: "gamma", label: "Strength of the income effect", min: 0, max: 1, step: 0.05, around: () => [0, 1], words: ["none", "full"] },
    { key: "rebate", label: "Share of revenue handed back", min: 0, max: 1, step: 0.05, around: () => [0, 1], words: ["none", "all"] },
  ],
};

/** How the peak moves with one parameter, the others held: n + 1 points [{ value, tau, interior }] across its range. */
export function peakCurve(model, p, key, n = 100) {
  const def = PARAMS[pick(model)].find((d) => d.key === key);
  check(Boolean(def), "unknown parameter");
  return Array.from({ length: n + 1 }, (_, i) => {
    const value = def.min + ((def.max - def.min) * i) / n;
    return { value, ...peak(model, { ...p, [key]: value }) };
  });
}

/** The sensitivity table: for each parameter that matters, the peak at a lower value, now, and at a higher value. */
export function sensitivity(model, p) {
  const now = peak(pick(model), p);
  return PARAMS[model].filter((d) => !(model === "eti" && d.key === "a" && p.a === 1)).map((d) => {
    const v = p[d.key], [low, high] = d.around(v);
    // The words describe the value compared, not the one asked for: a doubling stopped by the end of the slider is not "doubled".
    const words = d.words || [v > 0 && low === v / 2 ? "halved" : "lowest on the slider", high === v * 2 ? "doubled" : "highest on the slider"];
    return { key: d.key, label: d.label, words, value: v, now, low, high,
      atLow: peak(model, { ...p, [d.key]: low }), atHigh: peak(model, { ...p, [d.key]: high }) };
  });
}

/** A rate as a percentage: 0.7273 becomes "72.7%". */
export const percent = (x, digits = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : "–");
