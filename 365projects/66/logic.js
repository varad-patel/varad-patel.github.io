// Day 66: Black-Scholes Playground. The model, with no DOM code.
// European options on a share that pays a continuous dividend yield (Black and Scholes 1973, Merton 1973).

/** Calendar days in a year. Time to expiry is entered in days and turned into years with this. */
export const YEAR_DAYS = 365;

/** What each input may be, in the units the visitor types (prices in money, days, and percentages a year). */
export const LIMITS = {
  S: { min: 0.01, max: 1e6, label: "share price" },
  K: { min: 0.01, max: 1e6, label: "strike" },
  days: { min: 0.01, max: 36500, label: "days to expiry" },
  vol: { min: 0.01, max: 500, label: "volatility" },
  rate: { min: -10, max: 50, label: "interest rate" },
  div: { min: -10, max: 50, label: "dividend yield" },
};

const SQRT2PI = Math.sqrt(2 * Math.PI);

/**
 * Standard normal distribution function, to within 1e-15 and to 12 significant figures of the smaller tail, which
 * the kit's approximation (error up to 1.5e-7) cannot give: deep out of the money the price is all tail.
 * Inside |x| < 4 it is Hart's rational approximation as given by West (2005).
 */
export function normCdf(x) {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  let c = 0; // the upper tail beyond |x|
  if (a <= 37) {
    const e = Math.exp(-a * a / 2);
    if (a < 4) {
      let n = 3.52624965998911e-2 * a + 0.700383064443688;
      n = n * a + 6.37396220353165; n = n * a + 33.912866078383; n = n * a + 112.079291497871;
      n = n * a + 221.213596169931; n = n * a + 220.206867912376;
      let d = 8.83883476483184e-2 * a + 1.75566716318264;
      d = d * a + 16.064177579207; d = d * a + 86.7807322029461; d = d * a + 296.564248779674;
      d = d * a + 637.333633378831; d = d * a + 793.826512519948; d = d * a + 440.413735824752;
      c = (e * n) / d;
    } else {
      // Beyond 4 the tail is Laplace's continued fraction, 40 levels deep, which keeps 14 figures of the tail
      // itself (Hart's rational function and West's short fraction keep only 8 or 9 there).
      let b = a;
      for (let k = 40; k >= 1; k--) b = a + k / b;
      c = e / b / SQRT2PI;
    }
  }
  return x > 0 ? 1 - c : c;
}
export const normPdf = (x) => Math.exp(-x * x / 2) / SQRT2PI;

/**
 * Check the visitor's inputs (prices, days, percentages). Returns { ok: true, p } with p in model units
 * (T in years, rates and volatility as decimals), or { ok: false, errors: [{ key, message }] }.
 */
export function readInputs({ S, K, days, vol, rate, div }) {
  const raw = { S, K, days, vol, rate, div };
  const errors = [];
  for (const [key, v] of Object.entries(raw)) {
    const lim = LIMITS[key];
    const unit = key === "days" ? " days" : ["vol", "rate", "div"].includes(key) ? "%" : "";
    const range = `between ${lim.min.toLocaleString("en-GB")}${unit} and ${lim.max.toLocaleString("en-GB")}${unit}`;
    if (typeof v !== "number" || !Number.isFinite(v)) errors.push({ key, message: `Enter a number for the ${lim.label}, ${range}.` });
    else if (v < lim.min || v > lim.max) errors.push({ key, message: `The ${lim.label} must be ${range}.` });
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, p: { S, K, T: days / YEAR_DAYS, sigma: vol / 100, r: rate / 100, q: div / 100 } };
}

/**
 * Prices and Greeks of a European call and put. T > 0 and sigma > 0 (the limits above keep them so).
 * Greeks are per unit: vega per 1.00 of volatility, theta per year, rho per 1.00 of rate. The interface rescales.
 * theta and charm are rates of change as calendar time passes (minus the derivative with respect to T).
 */
export function blackScholes({ S, K, T, sigma, r = 0, q = 0 }) {
  const rootT = Math.sqrt(T);
  const s = sigma * rootT;
  const Dr = Math.exp(-r * T), Dq = Math.exp(-q * T);
  const d1 = (Math.log(S / K) + (r - q) * T) / s + s / 2;
  const d2 = d1 - s;
  const N1 = normCdf(d1), N2 = normCdf(d2), M1 = normCdf(-d1), M2 = normCdf(-d2);
  const n1 = normPdf(d1);
  const fwdS = S * Dq, pvK = K * Dr; // discounted share price and present value of the strike
  // Far from the strike the two terms nearly cancel and rounding can leave a hair below the true price,
  // so each price is held at or above its no-arbitrage floor.
  const callPrice = Math.max(fwdS * N1 - pvK * N2, fwdS - pvK, 0);
  const putPrice = Math.max(pvK * M2 - fwdS * M1, pvK - fwdS, 0);
  const gamma = (Dq * n1) / (S * s);
  const vega = fwdS * n1 * rootT;
  const decay = (-fwdS * n1 * sigma) / (2 * rootT);
  const vanna = (-Dq * n1 * d2) / sigma;
  const vomma = (vega * d1 * d2) / sigma;
  const charmCommon = (-Dq * n1 * (2 * (r - q) * T - d2 * s)) / (2 * T * s);
  return {
    d1, d2, N1, N2, forward: S * Math.exp((r - q) * T), fwdS, pvK,
    call: {
      price: callPrice, delta: Dq * N1, gamma, vega,
      theta: decay - r * pvK * N2 + q * fwdS * N1,
      rho: K * T * Dr * N2, epsilon: -S * T * Dq * N1,
      vanna, vomma, charm: q * Dq * N1 + charmCommon,
      itm: N2, // risk-neutral chance of finishing in the money
    },
    put: {
      price: putPrice, delta: -Dq * M1, gamma, vega,
      theta: decay + r * pvK * M2 - q * fwdS * M1,
      rho: -K * T * Dr * M2, epsilon: S * T * Dq * M1,
      vanna, vomma, charm: -q * Dq * M1 + charmCommon,
      itm: M2,
    },
  };
}

/** Payoff at expiry of one option for a share price x. */
export const payoff = (type, K, x) => (type === "call" ? Math.max(x - K, 0) : Math.max(K - x, 0));

/** Price with the share price replaced by x and, optionally, a different time to expiry in years. */
export const priceAt = (p, type, x, T = p.T) => blackScholes({ ...p, S: x, T })[type].price;

/**
 * Share prices at which a long position breaks even at expiry, ignoring interest on the premium paid.
 * A call breaks even at K + premium; a put at K - premium, which may be below zero (then there is none).
 */
export function breakEven(type, K, premium) {
  if (type === "call") return K + premium;
  return K - premium > 0 ? K - premium : null;
}

/** Put-call parity: C - P against S e^(-qT) - K e^(-rT). */
export function parity(p) {
  const b = blackScholes(p);
  return { left: b.call.price - b.put.price, right: b.fwdS - b.pvK };
}

/** The no-arbitrage range an option price must lie in, whatever the volatility. */
export function priceBounds(p, type) {
  const fwdS = p.S * Math.exp(-p.q * p.T), pvK = p.K * Math.exp(-p.r * p.T);
  return type === "call" ? { low: Math.max(fwdS - pvK, 0), high: fwdS } : { low: Math.max(pvK - fwdS, 0), high: pvK };
}

/**
 * The volatility at which the model gives a stated price (implied volatility), by bisection: the price rises
 * with volatility, so there is at most one answer. Searches between the input limits, 0.01% and 500% a year.
 * Returns { sigma } or { error, ... } explaining why there is none.
 */
export function impliedVol(price, p, type) {
  const lo = LIMITS.vol.min / 100, hi = LIMITS.vol.max / 100;
  if (!Number.isFinite(price) || price < 0) return { error: "invalid" };
  const bounds = priceBounds(p, type);
  if (price <= bounds.low) return { error: "below-floor", ...bounds };
  if (price >= bounds.high) return { error: "above-ceiling", ...bounds };
  const at = (v) => blackScholes({ ...p, sigma: v })[type].price;
  const pLo = at(lo), pHi = at(hi);
  if (price < pLo) return { error: "too-low", limit: lo, priceAtLimit: pLo };
  if (price > pHi) return { error: "too-high", limit: hi, priceAtLimit: pHi };
  let a = lo, b = hi;
  for (let i = 0; i < 200 && b - a > 1e-15; i++) {
    const m = (a + b) / 2;
    if (at(m) < price) a = m; else b = m;
  }
  return { sigma: (a + b) / 2 };
}

/** Evenly spaced share prices for the charts, spanning the share price, the strike and the break-even point. */
export function spotGrid(S, K, extra = [], n = 161) {
  const pts = [S, K, ...extra].filter((v) => Number.isFinite(v) && v > 0);
  const lo = Math.min(...pts) * 0.5, hi = Math.max(...pts) * 1.5; // above zero, where the Greeks are defined
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}
