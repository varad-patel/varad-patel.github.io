// Day 76: Time Preference from Bond Yields. The model, with no DOM code.
// Yields, discount factors and forward rates from the Federal Reserve's fitted Treasury curves, and the Ramsey
// equation turned round to ask what rate of pure time preference a real yield would imply.

/** Input ranges. Rates are in percent a year. */
export const LIMITS = {
  horizon: { min: 1, max: 30 },
  eta: { min: 0, max: 5 },
  growth: { min: -3, max: 6 },
  sigma: { min: 0, max: 6 },
};

/**
 * Svensson (1994) zero-coupon yield at maturity n years, in percent a year, continuously compounded, from the
 * parameters [b0, b1, b2, b3, tau1, tau2]. With b3 = 0 it is the Nelson-Siegel curve and tau2 is not used.
 */
export function zeroYield(p, n) {
  const [b0, b1, b2, b3, t1, t2] = p;
  const x1 = n / t1, e1 = Math.exp(-x1);
  let y = b0 + b1 * (1 - e1) / x1 + b2 * ((1 - e1) / x1 - e1);
  if (b3) {
    const x2 = n / t2, e2 = Math.exp(-x2);
    y += b3 * ((1 - e2) / x2 - e2);
  }
  return y;
}

/** Instantaneous forward rate at n years, percent a year, continuously compounded: f(n) = y(n) + n y'(n). */
export function forwardRate(p, n) {
  const [b0, b1, b2, b3, t1, t2] = p;
  let f = b0 + b1 * Math.exp(-n / t1) + b2 * (n / t1) * Math.exp(-n / t1);
  if (b3) f += b3 * (n / t2) * Math.exp(-n / t2);
  return f;
}

/** Price today of 1 paid in n years: P(n) = exp(-n y(n) / 100). */
export const discount = (p, n) => Math.exp((-zeroYield(p, n) * n) / 100);

/** A continuously compounded rate in percent as the equivalent rate compounded once a year, in percent. */
export const annualRate = (c) => (Math.exp(c / 100) - 1) * 100;

/** Average continuously compounded rate between m and n years ahead (m < n): (n y(n) - m y(m)) / (n - m). */
export function forwardBetween(p, m, n) {
  const ym = m > 0 ? zeroYield(p, m) * m : 0;
  return (zeroYield(p, n) * n - ym) / (n - m);
}

/**
 * Ramsey equation with consumption growth that is lognormal and independent from year to year: the real yield on
 * a riskless zero-coupon bond of any maturity is r = rho + eta mu - eta^2 sigma^2 / 2, where mu and sigma are the
 * mean and standard deviation of the growth of log consumption per person. All in percent a year, so the last
 * term divides by 100.
 */
export const ramseyRate = (rho, eta, mu, sigma) => rho + eta * mu - (0.5 * eta * eta * sigma * sigma) / 100;
/** The same equation solved for rho: the pure time preference a real yield r would imply if it held exactly. */
export const ramseyRho = (r, eta, mu, sigma) => r - eta * mu + (0.5 * eta * eta * sigma * sigma) / 100;

/** Mean and sample standard deviation of 100 ln(c[t] / c[t-1]) for the years from + 1 to `to`. */
export function growthStats(consumption, from, to) {
  const { first, values } = consumption;
  const last = first + values.length - 1;
  if (!(Number.isInteger(from) && Number.isInteger(to) && from >= first && to <= last && to - from >= 2)) return null;
  const g = [];
  for (let y = from + 1; y <= to; y++) g.push(100 * Math.log(values[y - first] / values[y - 1 - first]));
  const mean = g.reduce((s, v) => s + v, 0) / g.length;
  const sd = Math.sqrt(g.reduce((s, v) => s + (v - mean) ** 2, 0) / (g.length - 1));
  return { mean, sd, years: g.length, from, to };
}

/** Does this curve publish a yield at n years? (Nominal: 1 to 30. Real: 2 to 20.) */
export const covers = (curve, n) => n >= curve.shortest && n <= curve.longest;

/** Check the preferences: { ok, errors: [{ key, message }] }. */
export function checkPrefs({ eta, mu, sigma }) {
  const errors = [];
  const check = (key, v, lim, what) => {
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) errors.push({ key, message: `Enter ${what} from ${lim.min} to ${lim.max}.` });
  };
  check("eta", eta, LIMITS.eta, "an elasticity η");
  check("mu", mu, LIMITS.growth, "a growth rate in %");
  check("sigma", sigma, LIMITS.sigma, "a standard deviation in %");
  return { ok: !errors.length, errors };
}

/** Everything the page shows for date index i and horizon n (years). prefs = { eta, mu, sigma }. */
export function at(curves, i, n, prefs) {
  const pn = curves.nominal.params[i], pr = curves.real.params[i];
  const nominal = { y: zeroYield(pn, n), f: forwardRate(pn, n), P: discount(pn, n) };
  nominal.annual = annualRate(nominal.y);
  let real = null;
  if (covers(curves.real, n)) {
    real = { y: zeroYield(pr, n), f: forwardRate(pr, n), P: discount(pr, n) };
    real.annual = annualRate(real.y);
  }
  const growthTerm = prefs.eta * prefs.mu;
  const precaution = (0.5 * prefs.eta * prefs.eta * prefs.sigma * prefs.sigma) / 100;
  return {
    date: curves.dates[i], n, nominal, real,
    breakeven: real ? nominal.y - real.y : null,
    rho: real ? ramseyRho(real.y, prefs.eta, prefs.mu, prefs.sigma) : null,
    rhoForward: real ? ramseyRho(real.f, prefs.eta, prefs.mu, prefs.sigma) : null,
    growthTerm, precaution,
  };
}

/**
 * The horizon in years at which 1 paid then is worth half of 1 today, between lo and hi; null if it is not
 * reached there. Scans in steps of 0.05 years, then bisects to 1e-9.
 */
export function halfLife(p, lo, hi) {
  const g = (n) => discount(p, n) - 0.5;
  if (g(lo) <= 0) return lo;
  for (let k = 0; lo + k * 0.05 < hi; k++) {
    let x = lo + k * 0.05, z = Math.min(hi, x + 0.05);
    if (g(z) > 0) continue;
    while (z - x > 1e-9) { const m = (x + z) / 2; if (g(m) > 0) x = m; else z = m; }
    return z;
  }
  return null;
}

/** Month-end history at horizon n: nominal and real zero yields and the implied rho, one entry per date. */
export function history(curves, n, prefs) {
  const realOk = covers(curves.real, n);
  return curves.dates.map((date, i) => {
    const y = zeroYield(curves.nominal.params[i], n);
    const r = realOk ? zeroYield(curves.real.params[i], n) : null;
    return { date, nominal: y, real: r, rho: r == null ? null : ramseyRho(r, prefs.eta, prefs.mu, prefs.sigma) };
  });
}

/** Dates of the lowest and highest real zero yield at horizon n (first date wins a tie); null outside the curve. */
export function extremes(curves, n) {
  if (!covers(curves.real, n)) return null;
  let lo = null, hi = null;
  curves.dates.forEach((date, i) => {
    const y = zeroYield(curves.real.params[i], n);
    if (!lo || y < lo.y) lo = { i, date, y };
    if (!hi || y > hi.y) hi = { i, date, y };
  });
  return { lowest: lo, highest: hi };
}
