import test from "node:test";
import assert from "node:assert/strict";
import { YEAR_DAYS, LIMITS, normCdf, normPdf, readInputs, blackScholes, payoff, priceAt, breakEven, parity, priceBounds, impliedVol, spotGrid } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const rel = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.max(1e-12, Math.abs(b)), `${a} is not within ${tol} (relative) of ${b}`);
const GREEKS = ["price", "delta", "gamma", "vega", "theta", "rho", "epsilon", "vanna", "vomma", "charm", "itm"];

test("the normal distribution function matches Python's math.erfc to 1e-15, and keeps 12 figures deep in the lower tail", () => {
  // 0.5 * erfc(-x / sqrt 2) in Python 3.11, printed with repr.
  const ref = [[-37, 5.7255712225245764e-300], [-30, 4.9067139271487634e-198], [-10, 7.619853024160595e-24], [-7.5, 3.19089167291092e-14],
    [-5, 2.8665157187919455e-07], [-1, 0.15865525393145707], [0, 0.5], [0.5, 0.691462461274013], [3, 0.9986501019683699], [8, 0.9999999999999993]];
  for (const [x, v] of ref) { close(normCdf(x), v, 1e-15); rel(normCdf(x), v, 1e-12); }
  close(normCdf(-1.96), 0.024997895148220435, 1e-15);
  assert.equal(normCdf(Infinity), 1);
  assert.equal(normCdf(-Infinity), 0);
  assert.equal(normCdf(-40), 0);
  close(normPdf(0), 1 / Math.sqrt(2 * Math.PI), 1e-16);
  // Symmetry.
  for (const x of [0.1, 1.3, 2.7, 4.2, 6.6]) close(normCdf(x) + normCdf(-x), 1, 1e-15);
});

test("Hull's worked example: S = 42, K = 40, r = 10%, sigma = 20%, six months gives a call of 4.76 and a put of 0.81", () => {
  // Hull, Options, Futures, and Other Derivatives, 9th ed., Example 15.6: d1 = 0.7693, d2 = 0.6278, c = 4.76, p = 0.81.
  const b = blackScholes({ S: 42, K: 40, T: 0.5, sigma: 0.2, r: 0.1, q: 0 });
  assert.equal(b.d1.toFixed(4), "0.7693");
  assert.equal(b.d2.toFixed(4), "0.6278");
  assert.equal(b.call.price.toFixed(2), "4.76");
  assert.equal(b.put.price.toFixed(2), "0.81");
  // A separate implementation in Python using only math.erfc, written for these tests.
  close(b.call.price, 4.759422392871528, 1e-12);
  close(b.put.price, 0.8085993729000958, 1e-12);
  close(b.call.delta, 0.7791312909426689, 1e-12);
  close(b.put.delta, -0.22086870905733114, 1e-12);
  close(b.call.gamma, 0.04996267040591185, 1e-12);
  close(b.call.vega, 8.813415059602853, 1e-11);
  close(b.call.theta, -4.559092194592626, 1e-11);
  close(b.put.theta, -0.7541744965897703, 1e-11);
  close(b.call.rho, 13.982045913360281, 1e-11);
  close(b.put.rho, -5.042542576654, 1e-11);
});

test("Hull's Greek-letters example: S = 49, K = 50, r = 5%, sigma = 20%, 20 weeks", () => {
  // In the textbook the bank's 100,000 calls are worth $240,000 (2.40 a share) and the first delta hedge buys
  // 52,200 shares (delta 0.522). The other Greeks are checked against the separate Python implementation.
  const b = blackScholes({ S: 49, K: 50, T: 20 / 52, sigma: 0.2, r: 0.05, q: 0 });
  assert.equal(b.call.price.toFixed(2), "2.40");
  assert.equal(b.call.delta.toFixed(3), "0.522");
  close(b.call.delta, 0.5216046610663964, 1e-12);
  close(b.call.gamma, 0.06554403934784439, 1e-12);
  close(b.call.vega, 12.105479882628801, 1e-10);
  close(b.call.rho, 8.90696194960835, 1e-10);
  assert.equal(b.call.gamma.toFixed(3), "0.066");
  assert.equal(b.call.vega.toFixed(1), "12.1");
  assert.equal(b.call.theta.toFixed(2), "-4.31");
  assert.equal(b.call.rho.toFixed(2), "8.91");
  close(b.call.price, 2.4005273232717137, 1e-12);
  close(b.call.theta, -4.305329822932573, 1e-11);
  close(b.put.price, 2.448175441281851, 1e-12);
  close(b.put.rho, -9.957518095780165, 1e-11);
  // Theta per calendar day, as Hull quotes it: -4.31 / 365 = -0.0118.
  assert.equal((b.call.theta / YEAR_DAYS).toFixed(4), "-0.0118");
});

test("a call on a 50 share, strike 50, 25% volatility, one year: theta -3.6252 a year", () => {
  // Lecture slides on the Greek letters that follow Hull quote theta = -3.6252 a year, -0.01 a calendar day, here.
  const b = blackScholes({ S: 50, K: 50, T: 1, sigma: 0.25, r: 0.05, q: 0 });
  assert.equal(b.call.theta.toFixed(4), "-3.6252");
  assert.equal((b.call.theta / YEAR_DAYS).toFixed(2), "-0.01");
  close(b.d1, 0.325, 1e-15);
});

test("dividends and a negative interest rate agree with the separate Python implementation", () => {
  const a = blackScholes({ S: 100, K: 95, T: 0.75, sigma: 0.3, r: 0.03, q: 0.02 });
  close(a.call.price, 12.954278309638063, 1e-11);
  close(a.put.price, 7.329451882698756, 1e-11);
  close(a.call.delta, 0.6296385757671451, 1e-12);
  close(a.put.delta, -0.35547336383591754, 1e-12);
  close(a.call.gamma, 0.01419686871810514, 1e-12);
  close(a.call.vega, 31.942954615736554, 1e-10);
  close(a.call.theta, -6.629601149625317, 1e-10);
  close(a.put.theta, -5.813234002830432, 1e-10);
  close(a.call.rho, 37.50718445030734, 1e-10);
  close(a.put.rho, -32.15759119971788, 1e-10);
  const n = blackScholes({ S: 80, K: 100, T: 2, sigma: 0.45, r: -0.01, q: 0.04 });
  close(n.call.price, 10.518783071068665, 1e-11);
  close(n.put.price, 38.68960936281339, 1e-11);
  close(n.call.delta, 0.39215999676937224, 1e-12);
  close(n.put.delta, -0.5309563496172635, 1e-12);
  close(n.call.theta, -3.1403875010605447, 1e-10);
  close(n.put.theta, -7.114561149524535, 1e-10);
  close(n.put.rho, -162.33223466438895, 1e-9);
});

// Settings that cover calls and puts in, at and out of the money, dividends, negative rates, short and long lives.
const CASES = [
  { S: 100, K: 100, T: 1, sigma: 0.2, r: 0.05, q: 0 },
  { S: 42, K: 40, T: 0.5, sigma: 0.2, r: 0.1, q: 0 },
  { S: 100, K: 95, T: 0.75, sigma: 0.3, r: 0.03, q: 0.02 },
  { S: 80, K: 100, T: 2, sigma: 0.45, r: -0.01, q: 0.04 },
  { S: 130, K: 100, T: 0.1, sigma: 0.15, r: 0.02, q: 0.06 },
  { S: 60, K: 100, T: 5, sigma: 0.8, r: 0.07, q: 0.01 },
  { S: 1000, K: 1050, T: 30 / 365, sigma: 0.12, r: 0.04, q: 0.015 },
];

test("put-call parity holds: C - P = S e^(-qT) - K e^(-rT)", () => {
  for (const p of CASES) {
    const { left, right } = parity(p);
    close(left, right, 1e-10 * Math.max(1, p.S));
  }
  for (const S of [0.01, 1, 50, 99.9, 100, 250, 1e4, 1e6]) for (const T of [0.01 / 365, 0.1, 3]) {
    const { left, right } = parity({ S, K: 100, T, sigma: 0.25, r: 0.03, q: 0.01 });
    close(left, right, 1e-9 * Math.max(1, S));
  }
});

test("every Greek agrees with a finite difference of the price (or of delta and vega)", () => {
  const bump = (p, key, h) => ({ ...p, [key]: p[key] + h });
  for (const p of CASES) for (const type of ["call", "put"]) {
    const g = blackScholes(p)[type];
    const at = (q) => blackScholes(q)[type];
    const hS = p.S * 1e-4, hV = 1e-5, hT = Math.min(1e-5, p.T / 100), hR = 1e-6;
    const d = (key, h, f = (x) => x.price) => (f(at(bump(p, key, h))) - f(at(bump(p, key, -h)))) / (2 * h);
    const scale = Math.max(1, Math.abs(g.price));
    // A wrong formula is out by a large fraction; these tolerances allow only the finite difference's own error.
    const fd = (a, b) => close(a, b, 2e-5 * Math.abs(b) + 1e-9 * scale);
    fd(g.delta, d("S", hS));
    close(g.gamma, (at(bump(p, "S", hS)).price - 2 * g.price + at(bump(p, "S", -hS)).price) / (hS * hS), 1e-4 * g.gamma + 1e-8);
    fd(g.vega, d("sigma", hV));
    fd(g.theta, -d("T", hT));
    fd(g.rho, d("r", hR));
    fd(g.epsilon, d("q", hR));
    fd(g.vanna, d("sigma", hV, (x) => x.delta));
    fd(g.vomma, d("sigma", hV, (x) => x.vega));
    fd(g.charm, -d("T", hT, (x) => x.delta));
    // Gamma is also the slope of delta, and vanna the slope of vega with the share price.
    fd(g.gamma, d("S", hS, (x) => x.delta));
    fd(g.vanna, d("S", hS, (x) => x.vega));
  }
});

test("call and put share gamma and vega; deltas differ by e^(-qT); N(d2) and N(-d2) add to one", () => {
  for (const p of CASES) {
    const b = blackScholes(p);
    assert.equal(b.call.gamma, b.put.gamma);
    assert.equal(b.call.vega, b.put.vega);
    close(b.call.delta - b.put.delta, Math.exp(-p.q * p.T), 1e-15);
    close(b.call.itm + b.put.itm, 1, 1e-15);
  }
});

test("as expiry nears, the price tends to the payoff and delta to a step, with nothing infinite on the way", () => {
  const base = { K: 100, sigma: 0.3, r: 0.05, q: 0.02 };
  for (const T of [1e-3, 1e-6, 1e-9, LIMITS.days.min / YEAR_DAYS]) {
    for (const S of [50, 99, 101, 150]) {
      const b = blackScholes({ ...base, S, T });
      // Time value is at most about S sigma sqrt(T), plus what interest and dividends move in that time.
      const tol = S * base.sigma * Math.sqrt(T) + (100 * base.r + S * base.q) * T + 1e-12;
      close(b.call.price, payoff("call", 100, S), tol);
      close(b.put.price, payoff("put", 100, S), tol);
      if (T <= 1e-6) {
        close(b.call.delta, S > 100 ? 1 : 0, 1e-6);
        close(b.put.delta, S > 100 ? 0 : -1, 1e-6);
      }
      for (const type of ["call", "put"]) for (const k of GREEKS) assert.ok(Number.isFinite(b[type][k]), `${type} ${k} at T = ${T}, S = ${S}`);
    }
    // At the money: gamma is large but finite, and delta stays near one half.
    const atm = blackScholes({ ...base, S: 100, T });
    for (const type of ["call", "put"]) for (const k of GREEKS) assert.ok(Number.isFinite(atm[type][k]), `${type} ${k} at the money, T = ${T}`);
    assert.ok(atm.call.gamma > 0);
    close(atm.call.delta, 0.5, 0.05);
  }
});

test("as volatility tends to zero, the price tends to the discounted forward payoff", () => {
  for (const S of [80, 95, 100, 105, 120]) for (const sigma of [1e-3, 1e-6, LIMITS.vol.min / 100]) {
    const p = { S, K: 100, T: 0.5, sigma, r: 0.04, q: 0.01 };
    const b = blackScholes(p);
    const fwdS = S * Math.exp(-0.01 * 0.5), pvK = 100 * Math.exp(-0.04 * 0.5);
    close(b.call.price, Math.max(fwdS - pvK, 0), sigma * 30);
    close(b.put.price, Math.max(pvK - fwdS, 0), sigma * 30);
    for (const type of ["call", "put"]) for (const k of GREEKS) assert.ok(Number.isFinite(b[type][k]), `${type} ${k} at sigma = ${sigma}, S = ${S}`);
    if (sigma <= 1e-4 && Math.abs(Math.log(fwdS / pvK)) > 0.01) {
      close(b.call.delta, fwdS > pvK ? Math.exp(-0.005) : 0, 1e-9);
      close(b.call.gamma, 0, 1e-9);
      close(b.call.vega, 0, 1e-9);
    }
  }
});

test("deep in and out of the money: prices never fall below their floor or go negative, and nothing is infinite", () => {
  const lim = LIMITS;
  const values = (key) => [lim[key].min, lim[key].max];
  for (const S of [...values("S"), 1, 100]) for (const K of [...values("K"), 100]) for (const days of values("days"))
    for (const vol of values("vol")) for (const rate of values("rate")) for (const div of values("div")) {
      const r = readInputs({ S, K, days, vol, rate, div });
      assert.ok(r.ok);
      const b = blackScholes(r.p);
      for (const type of ["call", "put"]) {
        for (const k of GREEKS) assert.ok(Number.isFinite(b[type][k]), `${type} ${k} at ${JSON.stringify(r.p)}`);
        const { low, high } = priceBounds(r.p, type);
        assert.ok(b[type].price >= low && b[type].price >= 0, `${type} below its floor at ${JSON.stringify(r.p)}`);
        assert.ok(b[type].price <= high * (1 + 1e-12) + 1e-300, `${type} above its ceiling at ${JSON.stringify(r.p)}`);
      }
    }
  // A call a million times out of the money is worth nothing, and one a million times in the money is S - PV(K).
  const out = blackScholes({ S: 1, K: 1e6, T: 1, sigma: 0.2, r: 0.05, q: 0 });
  assert.equal(out.call.price, 0);
  assert.equal(out.call.delta, 0);
  const deep = blackScholes({ S: 1e6, K: 1, T: 1, sigma: 0.2, r: 0.05, q: 0 });
  close(deep.call.price, 1e6 - Math.exp(-0.05), 1e-6);
  close(deep.call.delta, 1, 1e-15);
});

test("inputs are checked, with messages that say what to fix", () => {
  const good = { S: 100, K: 100, days: 365, vol: 20, rate: 5, div: 0 };
  const r = readInputs(good);
  assert.ok(r.ok);
  close(r.p.T, 1, 1e-15);
  close(r.p.sigma, 0.2, 1e-15);
  const bad = readInputs({ ...good, S: NaN, days: 0, vol: 900 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.key), ["S", "days", "vol"]);
  assert.match(bad.errors[0].message, /Enter a number for the share price, between 0\.01 and 1,000,000/);
  assert.match(bad.errors[1].message, /The days to expiry must be between 0\.01 days and 36,500 days/);
  assert.match(bad.errors[2].message, /The volatility must be between 0\.01% and 500%/);
  assert.equal(readInputs({ ...good, rate: 1e308 }).ok, false);
  assert.equal(readInputs({ ...good, K: -5 }).ok, false);
  assert.equal(readInputs({ ...good, div: "3" }).ok, false);
});

test("payoffs and break-even points", () => {
  assert.equal(payoff("call", 100, 130), 30);
  assert.equal(payoff("call", 100, 70), 0);
  assert.equal(payoff("put", 100, 70), 30);
  assert.equal(payoff("put", 100, 130), 0);
  assert.equal(breakEven("call", 40, 4.76), 44.76);
  close(breakEven("put", 40, 0.81), 39.19, 1e-12);
  assert.equal(breakEven("put", 1, 1.5), null);
  close(priceAt({ S: 42, K: 40, T: 0.5, sigma: 0.2, r: 0.1, q: 0 }, "call", 42), 4.759422392871528, 1e-12);
  const grid = spotGrid(42, 40, [44.76]);
  assert.equal(grid.length, 161);
  assert.ok(grid[0] > 0 && grid[0] <= 20 && grid.at(-1) >= 44.76 * 1.5 - 1e-9);
});

test("implied volatility recovers the volatility that made the price, and refuses impossible prices", () => {
  for (const p of CASES) for (const type of ["call", "put"]) {
    const price = blackScholes(p)[type].price;
    const iv = impliedVol(price, p, type);
    assert.ok(!iv.error, `${type} ${JSON.stringify(p)}`);
    close(iv.sigma, p.sigma, 1e-7);
  }
  const p = { S: 42, K: 40, T: 0.5, sigma: 0.2, r: 0.1, q: 0 };
  // A call can never be worth less than S - K e^(-rT) = 3.95 or more than the share itself.
  assert.equal(impliedVol(3, p, "call").error, "below-floor");
  close(impliedVol(3, p, "call").low, 42 - 40 * Math.exp(-0.05), 1e-12);
  assert.equal(impliedVol(42, p, "call").error, "above-ceiling");
  assert.equal(impliedVol(-1, p, "call").error, "invalid");
  assert.equal(impliedVol(NaN, p, "put").error, "invalid");
  // Possible, but needing a volatility above 500% a year.
  assert.equal(impliedVol(41.9, p, "call").error, "too-high");
  // Hull's example the other way round: a call price of 4.76 means about 20% volatility.
  close(impliedVol(4.759422392871528, p, "call").sigma, 0.2, 1e-9);
});

test("the finding: an at-the-money call's daily time decay and gamma as expiry nears", () => {
  const at = (days) => blackScholes({ S: 100, K: 100, T: days / YEAR_DAYS, sigma: 0.2, r: 0.05, q: 0 }).call;
  const year = at(365), week = at(7), day = at(1);
  assert.equal(year.price.toFixed(2), "10.45");
  assert.equal((year.theta / YEAR_DAYS * 100).toFixed(1), "-1.8"); // cents a day
  assert.equal(week.price.toFixed(2), "1.15");
  assert.equal((week.theta / YEAR_DAYS * 100).toFixed(1), "-8.6");
  assert.equal((day.theta / YEAR_DAYS * 100).toFixed(1), "-21.6");
  assert.ok(week.theta / year.theta > 4.8 && week.theta / year.theta < 5); // "nearly five times as fast"
  assert.equal(year.gamma.toFixed(3), "0.019");
  assert.equal(day.gamma.toFixed(2), "0.38");
  assert.ok(day.gamma / year.gamma > 19.5 && day.gamma / year.gamma < 20.5); // "rises twentyfold"
});

test("a deep in-the-money European put can gain value as time passes: its theta is positive", () => {
  const b = blackScholes({ S: 50, K: 100, T: 1, sigma: 0.2, r: 0.05, q: 0 });
  assert.ok(b.put.theta > 0, `put theta ${b.put.theta}`);
  assert.ok(b.call.theta < 0);
});
