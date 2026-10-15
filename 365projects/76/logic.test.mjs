import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { CURVES } from "./data.js";
import {
  LIMITS, zeroYield, forwardRate, discount, annualRate, forwardBetween, ramseyRate, ramseyRho, growthStats, covers,
  checkPrefs, at, halfLife, history, extremes,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const idx = (d) => CURVES.dates.indexOf(d);
const nom = (d) => CURVES.nominal.params[idx(d)];
const real = (d) => CURVES.real.params[idx(d)];
// The Board's files round to four decimals, so a computed yield is within half a unit in the fourth place.
const PUB = 5.01e-5;

test("hand-computed Svensson curve: yield, forward and discount factor", () => {
  // b0 = 5, b1 = -2, b2 = 1, b3 = 0.5, tau1 = 2, tau2 = 10, at n = 2: x1 = 1 and x2 = 0.2.
  const p = [5, -2, 1, 0.5, 2, 10];
  const e1 = Math.exp(-1), e2 = Math.exp(-0.2);
  const y = 5 - 2 * (1 - e1) + 1 * ((1 - e1) - e1) + 0.5 * ((1 - e2) / 0.2 - e2);
  close(zeroYield(p, 2), y, 1e-12);
  close(forwardRate(p, 2), 5 - 2 * e1 + 1 * 1 * e1 + 0.5 * 0.2 * e2, 1e-12);
  close(discount(p, 2), Math.exp(-2 * y / 100), 1e-15);
  // The forward rate is y + n dy/dn: check by a central difference.
  const h = 1e-5;
  for (const n of [0.5, 2, 7, 25]) close(forwardRate(p, n), zeroYield(p, n) + n * (zeroYield(p, n + h) - zeroYield(p, n - h)) / (2 * h), 1e-6);
  // A flat curve: every rate equals b0, and the discount factor is exp(-b0 n / 100).
  const flat = [4, 0, 0, 0, 1.5, null];
  close(zeroYield(flat, 13), 4, 1e-12);
  close(forwardRate(flat, 13), 4, 1e-12);
  close(discount(flat, 10), Math.exp(-0.4), 1e-15);
});

test("compounding conversions and forward rates between two dates", () => {
  close(annualRate(5), (Math.exp(0.05) - 1) * 100, 1e-12);
  close(annualRate(5), 5.127109637602, 1e-9);
  close(annualRate(0), 0, 1e-15);
  const p = nom(CURVES.latest);
  close(forwardBetween(p, 0, 10), zeroYield(p, 10), 1e-12);
  // Lending for 10 years equals lending for 4 and then for 6 at the forward rate.
  close(4 * zeroYield(p, 4) + 6 * forwardBetween(p, 4, 10), 10 * zeroYield(p, 10), 1e-9);
  // Discount factors chain: P(10) = P(4) x exp(-6 f(4, 10) / 100).
  close(discount(p, 10), discount(p, 4) * Math.exp(-6 * forwardBetween(p, 4, 10) / 100), 1e-12);
  // The average of the instantaneous forward over 0..n is the zero yield (trapezoid rule, fine grid).
  let s = 0;
  const N = 4000;
  for (let k = 0; k <= N; k++) s += (k === 0 || k === N ? 0.5 : 1) * forwardRate(p, Math.max(1e-9, (10 * k) / N));
  close((s * 10) / N / 10, zeroYield(p, 10), 1e-5);
});

test("the bundled curves reproduce the Federal Reserve's published yields (source figures)", () => {
  // feds200628.csv: SVENY01, SVENY10, SVENY30, SVENF10, SVENF30.
  const n = [
    ["2026-10-09", 4.4929, 5.2514, 5.6402, 5.8903, 4.8251],
    ["2021-07-30", 0.084, 1.3047, 2.0689, 2.1565, 2.5524],
    ["2012-12-31", 0.1943, 1.8137, 3.0551, 3.6954, 2.8053],
    ["1999-12-31", 6.017326674396, 6.700890119585, 6.421108179034, 7.164670559617, 5.309077972204],
  ];
  for (const [d, y1, y10, y30, f10, f30] of n) {
    close(zeroYield(nom(d), 1), y1, PUB);
    close(zeroYield(nom(d), 10), y10, PUB);
    close(zeroYield(nom(d), 30), y30, PUB);
    close(forwardRate(nom(d), 10), f10, PUB);
    close(forwardRate(nom(d), 30), f30, PUB);
  }
  // feds200805.csv: TIPSY02, TIPSY10, TIPSY20, TIPSF10, BKEVEN10 (inflation compensation = nominal minus real).
  const r = [
    ["2026-10-09", 2.4448, 2.9329, 3.3628, 3.5182, 2.3186],
    ["2021-07-30", -2.6901, -1.1301, -0.4265, 0.1179, 2.4348],
    ["2012-12-31", -1.4256, -0.6645, 0.2362, 0.8362, 2.4782],
    ["1999-01-29", 3.1622, 3.7418, 3.669, 3.6095, 1.24], // a Nelson-Siegel day: b3 = 0
  ];
  for (const [d, y2, y10, y20, f10, b10] of r) {
    close(zeroYield(real(d), 2), y2, PUB);
    close(zeroYield(real(d), 10), y10, PUB);
    close(zeroYield(real(d), 20), y20, PUB);
    close(forwardRate(real(d), 10), f10, PUB);
    close(zeroYield(nom(d), 10) - zeroYield(real(d), 10), b10, 2 * PUB);
  }
  assert.equal(real("1999-01-29")[3], 0);
  assert.equal(real("1999-01-29")[5], null);
});

test("the data module: dates, coverage and the consumption series (BEA source figures)", () => {
  assert.equal(CURVES.dates[0], "1999-01-29");
  assert.equal(CURVES.latest, "2026-10-09");
  assert.equal(CURVES.dates.at(-1), CURVES.latest);
  assert.equal(CURVES.dates.length, 334);
  assert.deepEqual([...CURVES.dates].sort(), CURVES.dates);
  assert.equal(new Set(CURVES.dates.map((d) => d.slice(0, 7))).size, CURVES.dates.length);
  assert.equal(CURVES.nominal.params.length, 334);
  assert.equal(CURVES.real.params.length, 334);
  assert.ok(covers(CURVES.nominal, 1) && covers(CURVES.nominal, 30) && !covers(CURVES.nominal, 31));
  assert.ok(!covers(CURVES.real, 1) && covers(CURVES.real, 2) && covers(CURVES.real, 20) && !covers(CURVES.real, 21));
  // NIPA Table 7.1 line 13, chained 2017 dollars per person.
  const c = CURVES.consumption;
  assert.equal(c.first, 1929);
  assert.equal(c.values[0], 7226);
  assert.equal(c.values[1999 - 1929], 31244);
  assert.equal(c.values[2024 - 1929], 47133);
  assert.equal(c.values[2025 - 1929], 48109);
});

test("growth statistics: a hand case, and the BEA averages the page uses", () => {
  const toy = { first: 2000, values: [100, 110, 99, 108.9] };
  const g = [Math.log(1.1), Math.log(0.9), Math.log(1.1)].map((v) => 100 * v);
  const m = (g[0] + g[1] + g[2]) / 3;
  const s = growthStats(toy, 2000, 2003);
  close(s.mean, m, 1e-12);
  close(s.sd, Math.sqrt(g.reduce((a, v) => a + (v - m) ** 2, 0) / 2), 1e-12);
  assert.equal(s.years, 3);
  assert.equal(growthStats(toy, 1999, 2003), null);
  assert.equal(growthStats(toy, 2000, 2004), null);
  assert.equal(growthStats(toy, 2000, 2001), null);
  const bea = growthStats(CURVES.consumption, 1999, 2025);
  assert.equal(bea.years, 26);
  assert.equal(bea.mean.toFixed(2), "1.66");
  assert.equal(bea.sd.toFixed(2), "1.97");
  close(bea.mean, (100 * Math.log(48109 / 31244)) / 26, 1e-12);
  const long = growthStats(CURVES.consumption, 1949, 2025);
  assert.equal(long.mean.toFixed(2), "2.11");
  assert.equal(long.sd.toFixed(2), "1.89");
});

test("Ramsey equation: hand case, inverse, and the deterministic special case", () => {
  // eta = 2, mu = 2%, sigma = 2%: eta mu = 4 points, eta^2 sigma^2 / 2 = 4 x 4 / 2 = 8 in percent squared = 0.08 points.
  close(ramseyRate(1, 2, 2, 2), 1 + 4 - 0.08, 1e-12);
  close(ramseyRho(3, 2, 2, 2), 3 - 4 + 0.08, 1e-12);
  close(ramseyRho(ramseyRate(0.7, 1.4, 1.66, 1.97), 1.4, 1.66, 1.97), 0.7, 1e-12);
  close(ramseyRate(0.1, 1, 1.3, 0), 1.4, 1e-12); // r = rho + eta g with no uncertainty
  close(ramseyRho(2, 0, 5, 5), 2, 1e-12); // with eta = 0 the yield is rho itself
});

test("Ramsey equation against a simulated economy: the bond price is E[exp(-rho n) (C_n / C_0)^-eta]", () => {
  // Lognormal growth, mean mu and sd sigma a year (as fractions here). Price a 10-year bond by simulation.
  const r = rng(76);
  const rho = 0.01, eta = 3, mu = 0.02, sigma = 0.04, n = 10, draws = 200000;
  let sum = 0;
  for (let k = 0; k < draws; k++) {
    let logGrowth = 0;
    for (let t = 0; t < n; t++) logGrowth += r.normal(mu, sigma);
    sum += Math.exp(-rho * n - eta * logGrowth);
  }
  const yieldSim = (-Math.log(sum / draws) / n) * 100;
  // The formula, in percent: 1 + 3 x 2 - 9 x 16 / 200 = 6.28.
  close(ramseyRate(1, 3, 2, 4), 6.28, 1e-12);
  close(yieldSim, 6.28, 0.03);
});

test("at(): the numbers for one date and horizon", () => {
  const i = idx("2026-10-09");
  const prefs = { eta: 1, mu: 1.66, sigma: 1.97 };
  const a = at(CURVES, i, 10, prefs);
  close(a.nominal.y, 5.2514, PUB);
  close(a.real.y, 2.9329, PUB);
  close(a.nominal.P, Math.exp(-a.nominal.y / 10), 1e-15);
  close(a.breakeven, a.nominal.y - a.real.y, 1e-15);
  close(a.rho, a.real.y - 1.66 + 0.5 * 1.97 ** 2 / 100, 1e-12);
  close(a.growthTerm, 1.66, 1e-12);
  close(a.precaution, 0.0194045, 1e-9);
  close(a.real.y, a.rho + a.growthTerm - a.precaution, 1e-12); // the decomposition adds up
  // Outside the real curve the real figures are absent, not extrapolated.
  for (const n of [1, 21, 30]) {
    const b = at(CURVES, i, n, prefs);
    assert.equal(b.real, null);
    assert.equal(b.rho, null);
    assert.equal(b.breakeven, null);
    assert.ok(Number.isFinite(b.nominal.y));
  }
});

test("input checks name the box and the range", () => {
  assert.deepEqual(checkPrefs({ eta: 1, mu: 1.66, sigma: 1.97 }), { ok: true, errors: [] });
  const bad = checkPrefs({ eta: NaN, mu: 7, sigma: -1 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.key), ["eta", "mu", "sigma"]);
  assert.match(bad.errors[0].message, /from 0 to 5/);
  assert.match(bad.errors[1].message, /from -3 to 6/);
  assert.equal(checkPrefs({ eta: 5, mu: -3, sigma: 0 }).ok, true);
  assert.equal(checkPrefs({ eta: Infinity, mu: 0, sigma: 0 }).ok, false);
  assert.deepEqual(LIMITS.horizon, { min: 1, max: 30 });
});

test("half-life of a dollar: P(n) = 1/2 where it is reached, null where it is not", () => {
  const flat = [5, 0, 0, 0, 1, null];
  close(halfLife(flat, 0.01, 30), (100 * Math.log(2)) / 5, 1e-7); // 13.86 years at 5%
  assert.equal(halfLife([1, 0, 0, 0, 1, null], 0.01, 30), null); // at 1% it takes 69 years
  assert.equal(halfLife([-1, 0, 0, 0, 1, null], 2, 20), null); // negative rates: a future dollar is worth more
  const p = nom(CURVES.latest);
  const h = halfLife(p, 1, 30);
  close(discount(p, h), 0.5, 1e-9);
  assert.ok(h > 10 && h < 20);
});

test("history and extremes: the lowest and highest 10-year real yields", () => {
  const prefs = { eta: 1, mu: 1.66, sigma: 1.97 };
  const h = history(CURVES, 10, prefs);
  assert.equal(h.length, CURVES.dates.length);
  close(h[idx("2021-07-30")].real, -1.1301, PUB);
  close(h[idx("2021-07-30")].rho, -1.1301 - 1.66 + 0.5 * 1.97 ** 2 / 100, PUB);
  const e = extremes(CURVES, 10);
  assert.equal(e.lowest.date, "2021-07-30");
  assert.equal(e.highest.date, "1999-12-31");
  close(e.highest.y, 4.2856, PUB);
  assert.equal(extremes(CURVES, 25), null);
  // At 2 years the highest real yield is in the 2008 crisis (the write-up says so).
  assert.equal(extremes(CURVES, 2).highest.date, "2008-11-28");
  assert.ok(history(CURVES, 25, prefs).every((r) => r.real === null && Number.isFinite(r.nominal)));
});

test("the finding on the page: $100 of buying power in 10 years cost $111.96 in July 2021 and $74.58 in October 2026", () => {
  const prefs = { eta: 1, mu: 1.66, sigma: 1.97 };
  const then = at(CURVES, idx("2021-07-30"), 10, prefs);
  const now = at(CURVES, idx("2026-10-09"), 10, prefs);
  assert.equal((100 * then.real.P).toFixed(2), "111.96");
  assert.equal((100 * now.real.P).toFixed(2), "74.58");
  assert.equal(then.real.y.toFixed(2), "-1.13");
  assert.equal(now.real.y.toFixed(2), "2.93");
  // Implied pure time preference with the BEA 1999-2025 growth figures and eta = 1.
  const bea = growthStats(CURVES.consumption, 1999, 2025);
  const p2 = { eta: 1, mu: bea.mean, sigma: bea.sd };
  assert.equal(at(CURVES, idx("2021-07-30"), 10, p2).rho.toFixed(2), "-2.77");
  assert.equal(at(CURVES, idx("2026-10-09"), 10, p2).rho.toFixed(2), "1.29");
  // With any fixed eta, mu and sigma the implied rho moves exactly as much as the real yield: 4.06 points.
  for (const q of [p2, { eta: 2, mu: 1, sigma: 3 }, { eta: 0, mu: 0, sigma: 0 }]) {
    const d = at(CURVES, idx("2026-10-09"), 10, q).rho - at(CURVES, idx("2021-07-30"), 10, q).rho;
    assert.equal(d.toFixed(2), "4.06");
  }
  // The nominal price of $100 due in 10 years on 9 October 2026.
  assert.equal((100 * now.nominal.P).toFixed(2), "59.15");
});
