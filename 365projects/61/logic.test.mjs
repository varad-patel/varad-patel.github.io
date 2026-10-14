import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { GOLD } from "./data.js";
import {
  MAX_H, FIRST_ORIGIN, Z80, Z95, CANDIDATES, MODELS, orderName, toLogs, fromPacf, toPacf, css, nelderMead, fitArima,
  selectArima, psiWeights, forecastArima, roller, originsFor, dieboldMariano, asPercent, scorecard, running, orderShares,
  monthAt, monthLabel, indexOfYear,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const LOGS = toLogs(GOLD.values);
const at = (key) => { const [y, m] = key.split("-").map(Number); return (y - 1975) * 12 + (m - 1); };
const upTo = (key) => LOGS.subarray(0, at(key) + 1);
const runAll = (key, options = {}, origins = originsFor(LOGS.length)) => { const r = roller(LOGS, key, origins, options); while (r.next()); return r.records; };

/* ------------------------------------------------------------- parameters */

test("partial autocorrelations to AR coefficients and back (Durbin-Levinson), by hand", () => {
  assert.deepEqual(fromPacf([]), []);
  assert.deepEqual(fromPacf([0.5]), [0.5]);
  // phi_1 = r_1 (1 - r_2), phi_2 = r_2.
  fromPacf([0.5, 0.2]).forEach((v, i) => close(v, [0.4, 0.2][i], 1e-15));
  fromPacf([0.5, -0.5]).forEach((v, i) => close(v, [0.75, -0.5][i], 1e-15));
  toPacf([0.4, 0.2]).forEach((v, i) => close(v, [0.5, 0.2][i], 1e-15));
  // A non-stationary polynomial has no partial autocorrelations inside (-1, 1).
  assert.equal(toPacf([1.2, 0]), null);
  assert.equal(toPacf([0.5, 0.6]), null); // 1 - 0.5B - 0.6B^2 has a root inside the unit circle
  const r = rng(61);
  for (let k = 0; k < 50; k++) {
    const pac = [r.uniform(-0.95, 0.95), r.uniform(-0.95, 0.95)];
    toPacf(fromPacf(pac)).forEach((v, i) => close(v, pac[i], 1e-12));
  }
});

test("conditional sum of squares: a hand-computed ARMA(1,1) case", () => {
  // w = [0.1, -0.2, 0.3, 0.05], phi 0.5, theta 0.2, mu 0.01, starting at the third change:
  // e_2 = 0.29 - 0.5 x (-0.21) = 0.395;  e_3 = 0.04 - 0.5 x 0.29 - 0.2 x 0.395 = -0.184.
  const { sse, e } = css(Float64Array.of(0.1, -0.2, 0.3, 0.05), [0.5], [0.2], 0.01);
  close(e[2], 0.395, 1e-15); close(e[3], -0.184, 1e-15);
  close(sse, 0.395 ** 2 + 0.184 ** 2, 1e-15);
  assert.equal(e[0], 0); assert.equal(e[1], 0);
});

test("Nelder-Mead finds the minimum of Rosenbrock's valley and of a quadratic", () => {
  const rosen = nelderMead(([a, b]) => (1 - a) ** 2 + 100 * (b - a * a) ** 2, [-1.2, 1], { tol: 1e-14, xtol: 1e-9, maxEvals: 20000 });
  close(rosen.x[0], 1, 1e-5); close(rosen.x[1], 1, 1e-5);
  const quad = nelderMead(([a, b, c]) => (a - 3) ** 2 + 2 * (b + 1) ** 2 + 0.5 * (c - 0.25) ** 2, [0, 0, 0]);
  [3, -1, 0.25].forEach((v, i) => close(quad.x[i], v, 1e-5));
  assert.equal(nelderMead(() => 7, []).f, 7);
});

/* ------------------------------------------------------------- fitting */

test("AICc by hand: -2 log L + 2k + 2k(k + 1) / (N - k - 1) with sigma2 = SSE / N", () => {
  const f = fitArima(upTo("2026-09"), { p: 0, q: 0, drift: false });
  const N = f.N, s2 = f.sse / N;
  assert.equal(N, 621 - 1 - 2);
  close(f.aicc, N * (Math.log(2 * Math.PI * s2) + 1) + 2 + 4 / (N - 2), 1e-9);
  // A random walk without drift has nothing to estimate but sigma2: the mean of the squared changes.
  let ss = 0;
  for (let t = 3; t < 621; t++) ss += (LOGS[t] - LOGS[t - 1]) ** 2;
  close(f.sse, ss, 1e-12);
});

test("fits agree with a separate implementation (Python: golden-section search, coordinate search and least squares)", () => {
  // ARIMA(0,1,1), no drift: one parameter, minimised by golden-section search to 1e-12.
  const m621 = fitArima(upTo("2026-09"), { p: 0, q: 1, drift: false });
  close(m621.theta[0], 0.26074840, 2e-6); close(m621.sse, 1.1954845123, 1e-9); close(m621.aicc, -2103.397468, 1e-5);
  const m300 = fitArima(LOGS.subarray(0, 300), { p: 0, q: 1, drift: false });
  close(m300.theta[0], 0.27982694, 2e-6); close(m300.sse, 0.7534227560, 1e-9);
  // ARIMA(2,1,0) with drift: the normal equations, solved by Cramer's rule.
  const a = fitArima(upTo("2026-09"), { p: 2, q: 0, drift: true });
  close(a.phi[0], 0.23025974, 1e-8); close(a.phi[1], -0.12637954, 1e-8); close(a.mu, 0.0051452649, 1e-10);
  close(a.sse, 1.1790779424, 1e-9); close(a.aicc, -2107.891761, 1e-5);
  const a300 = fitArima(LOGS.subarray(0, 300), { p: 2, q: 0, drift: true });
  close(a300.phi[0], 0.24709408, 1e-8); close(a300.phi[1], -0.15910433, 1e-8); close(a300.mu, 0.0016017258, 1e-10);
  // ARIMA(1,1,1) with drift and ARIMA(0,1,2): the page's search must do at least as well as the coordinate search.
  assert.ok(fitArima(upTo("2026-09"), { p: 1, q: 1, drift: true }).sse <= 1.1811678793 + 1e-9);
  assert.ok(fitArima(LOGS.subarray(0, 300), { p: 1, q: 1, drift: true }).sse <= 0.7482308973 + 1e-9);
  const ma2 = fitArima(upTo("2026-09"), { p: 0, q: 2, drift: false });
  close(ma2.theta[0], 0.243356, 1e-5); close(ma2.theta[1], -0.056446, 1e-5); close(ma2.sse, 1.1913571296, 1e-9);
});

test("least squares gives the same AR fit as the search, and a warm start lands on the same optimum", () => {
  const y = upTo("2020-12");
  const ls = fitArima(y, { p: 1, q: 0, drift: true });
  // The same model with a moving-average term forced to zero is not available, so search the AR(1) directly.
  const w = []; for (let i = 1; i < y.length; i++) w.push(y[i] - y[i - 1]);
  let best = Infinity;
  for (let phi = -0.5; phi <= 0.5; phi += 0.0005) {
    // For a given phi the best mu has a closed form: the mean of w_t - phi w_(t-1), divided by 1 - phi.
    let m = 0; for (let t = 2; t < w.length; t++) m += w[t] - phi * w[t - 1]; m /= w.length - 2;
    best = Math.min(best, css(Float64Array.from(w), [phi], [], m / (1 - phi)).sse);
  }
  assert.ok(ls.sse <= best + 1e-12 && ls.sse > best - 1e-6);
  const cold = fitArima(y, { p: 1, q: 1, drift: false });
  const warm = fitArima(y, { p: 1, q: 1, drift: false }, fitArima(upTo("2019-12"), { p: 1, q: 1, drift: false }));
  close(warm.sse, cold.sse, 1e-9);
});

test("ARIMA(1,1,1) finds the lowest valley, not the one last month's fit started in (windowed fits)", () => {
  // Review finding: carried-over starts left the ten-year-window fit at a sum of squares up to 26 times the minimum.
  // The minima below come from a separate grid search over phi and theta in steps of 0.005, polished (Python).
  const rollTo = (t1, t0, W) => {
    let prev = null, fits = null;
    for (let t = t0; t <= t1; t++) ({ fits } = selectArima(LOGS.subarray(Math.max(0, t + 1 - W), t + 1), CANDIDATES, prev), prev = fits);
    return fits;
  };
  // Ten years to the end of September 1990 (t = 188): minimum 0.25135154 at phi = -0.495, theta = 0.699.
  assert.ok(rollTo(188, 170, 120)["ARIMA(1,1,1)"].sse <= 0.25135154 + 1e-7);
  // Twenty years to the end of June 1999 (t = 293): minimum 0.57092438 at phi = 0.767, theta = -0.796, on the
  // phi = -theta ridge; the other valley, near phi = 0, bottoms out at 0.5808.
  const f = rollTo(293, 280, 240)["ARIMA(1,1,1)"];
  assert.ok(f.sse <= 0.57092438 + 1e-7);
  close(f.phi[0], 0.767, 0.002); close(f.theta[0], -0.796, 0.002);
});

test("estimates recover the truth from simulated data", () => {
  const r = rng(7);
  const sim = (n, phi, theta, mu, sd) => {
    const y = [0]; let ePrev = 0, wPrev = 0;
    for (let t = 1; t < n; t++) { const e = r.normal(0, sd); const w = mu + phi * (wPrev - mu) + e + theta * ePrev; y.push(y[t - 1] + w); ePrev = e; wPrev = w; }
    return Float64Array.from(y);
  };
  const ma = fitArima(sim(4000, 0, 0.4, 0, 0.05), { p: 0, q: 1, drift: false });
  close(ma.theta[0], 0.4, 0.03); close(Math.sqrt(ma.sigma2), 0.05, 0.002);
  const ar = fitArima(sim(4000, 0.5, 0, 0.01, 0.03), { p: 1, q: 0, drift: true });
  close(ar.phi[0], 0.5, 0.03); close(ar.mu, 0.01, 0.003); // the standard error of mu is about 0.03 / (0.5 x 63)
  const arma = fitArima(sim(4000, 0.6, -0.3, 0, 0.04), { p: 1, q: 1, drift: false });
  close(arma.phi[0], 0.6, 0.08); close(arma.theta[0], -0.3, 0.08);
});

test("Working's result: the changes in monthly averages of a random walk look like an MA(1) with theta near 0.27", () => {
  // 21 trading days a month: the first-order autocorrelation of changes in the averages is (m^2 - 1) / (2(2m^2 + 1)),
  // 0.2492 for m = 21, which an MA(1) matches with theta = (1 - sqrt(1 - 4 rho^2)) / (2 rho) = 0.2669.
  const m = 21, rho = (m * m - 1) / (2 * (2 * m * m + 1));
  close(rho, 0.2492, 0.0001);
  close((1 - Math.sqrt(1 - 4 * rho * rho)) / (2 * rho), 0.2669, 0.0001);
  const r = rng(1960);
  let price = 0;
  const avg = [];
  for (let month = 0; month < 3000; month++) { let s = 0; for (let d = 0; d < m; d++) { price += r.normal(0, 0.01); s += price; } avg.push(s / m); }
  const fit = fitArima(Float64Array.from(avg), { p: 0, q: 1, drift: false });
  close(fit.theta[0], 0.267, 0.03);
});

test("the order is chosen by the lowest AICc among the twelve candidates", () => {
  assert.equal(CANDIDATES.length, 12);
  assert.ok(CANDIDATES.every((c) => c.p + c.q <= 2));
  const { best, fits } = selectArima(upTo("2026-09"));
  assert.equal(Object.keys(fits).length, 12);
  for (const f of Object.values(fits)) assert.ok(best.aicc <= f.aicc);
  assert.equal(orderName(best), "ARIMA(2,1,0) with drift");
  assert.equal(orderName({ p: 0, q: 1, drift: false }), "ARIMA(0,1,1)");
  assert.deepEqual(MODELS.ma1.candidates, [{ p: 0, q: 1, drift: false }]);
});

test("bad input is refused with a reason", () => {
  assert.throws(() => toLogs([1, 2, 0, 4]), /price 3 is not a positive number/);
  assert.throws(() => toLogs([1, NaN]), /price 2/);
  assert.throws(() => toLogs("123"), /list of numbers/);
  assert.throws(() => fitArima(Float64Array.from({ length: 12 }, (_, i) => i * 0.01), { p: 1, q: 1, drift: true }), /too few months/);
});

/* ------------------------------------------------------------- forecasting */

test("psi weights by hand", () => {
  assert.deepEqual(psiWeights([0.5], [], 3), [1, 0.5, 0.25]);
  assert.deepEqual(psiWeights([], [0.3], 3), [1, 0.3, 0]);
  psiWeights([0.5], [0.3], 3).forEach((v, i) => close(v, [1, 0.8, 0.4][i], 1e-15));
});

test("forecasts and their spread match the closed forms", () => {
  const y = upTo("2026-09");
  // Random walk with drift: mid = last + h mu, sd = sigma sqrt(h).
  const d = fitArima(y, { p: 0, q: 0, drift: true });
  const fd = forecastArima(d);
  assert.equal(fd.mid.length, MAX_H);
  for (const h of [1, 7, 24]) { close(fd.mid[h - 1], y[y.length - 1] + h * d.mu, 1e-12); close(fd.sd[h - 1], Math.sqrt(d.sigma2 * h), 1e-12); }
  // ARIMA(0,1,1): every horizon moves by theta e_n; variance sigma2 (1 + (h - 1)(1 + theta)^2).
  const m = fitArima(y, { p: 0, q: 1, drift: false });
  const fm = forecastArima(m);
  const shift = m.theta[0] * m.e[m.e.length - 1];
  for (const h of [1, 2, 24]) { close(fm.mid[h - 1], y[y.length - 1] + shift, 1e-12); close(fm.sd[h - 1] ** 2, m.sigma2 * (1 + (h - 1) * (1 + m.theta[0]) ** 2), 1e-12); }
  // ARIMA(1,1,0) without drift: the next change is phi w_n, then phi^2 w_n, ...
  const a = fitArima(y, { p: 1, q: 0, drift: false });
  const fa = forecastArima(a, 3);
  const wn = y[y.length - 1] - y[y.length - 2], phi = a.phi[0];
  close(fa.mid[2], y[y.length - 1] + wn * (phi + phi ** 2 + phi ** 3), 1e-12);
  close(fa.sd[1] ** 2, a.sigma2 * (1 + (1 + phi) ** 2), 1e-12);
});

test("the band constants are the normal quantiles", () => {
  close(Z80, 1.2815515655446004, 0); close(Z95, 1.959963984540054, 0);
});

/* ------------------------------------------------------------- the rolling test */

test("forecast dates start in January 1985 and the live forecast is made from the last month", () => {
  const o = originsFor(LOGS.length);
  assert.equal(o[0], FIRST_ORIGIN);
  assert.equal(monthLabel(GOLD.start, o[0]), "Jan 1985");
  assert.equal(o.at(-1), LOGS.length - 1);
  assert.deepEqual(originsFor(100), []);
});

test("a forecast uses nothing after its own date, and a window uses only the months it names", () => {
  const origins = [400, 401, 402];
  const a = roller(LOGS, "auto", origins); while (a.next());
  const altered = Float64Array.from(LOGS);
  for (let i = 403; i < altered.length; i++) altered[i] += 0.5;
  const b = roller(altered, "auto", origins); while (b.next());
  assert.deepEqual(b.records.map((r) => r.mid), a.records.map((r) => r.mid));
  const w = roller(LOGS, "ma1", [400], { window: 120 }); w.next();
  const direct = forecastArima(fitArima(LOGS.subarray(281, 401), { p: 0, q: 1, drift: false }));
  w.records[0].mid.forEach((v, i) => close(v, direct.mid[i], 1e-9));
  assert.equal(w.done, true); assert.equal(w.next(), false);
});

test("Diebold-Mariano: hand cases with one lag and with two", () => {
  // d = [1, -1, 2, 0]: mean 0.5, gamma_0 = 1.25, so DM = 0.5 / sqrt(1.25 / 4) = 0.894427.
  const one = dieboldMariano([1, -1, 2, 0], 1);
  close(one.stat, 0.5 / Math.sqrt(1.25 / 4), 1e-12);
  close(one.p, 0.371093, 2e-6);
  // h = 2 adds the first autocovariance, -0.9375, with weight 1/2: S = 1.25 - 0.9375 = 0.3125.
  close(dieboldMariano([1, -1, 2, 0], 2).stat, 0.5 / Math.sqrt(0.3125 / 4), 1e-12);
  // Identical losses: nothing to test. One value: no test.
  assert.deepEqual(dieboldMariano([0, 0, 0], 3), { n: 3, mean: 0, stat: 0, p: 1 });
  assert.ok(Number.isNaN(dieboldMariano([0.2], 1).p));
  assert.ok(Number.isNaN(dieboldMariano([0.1, 0.1, 0.1], 1).p)); // always better by the same amount: no variance to scale by
  // The sign of d does not change the p-value.
  close(dieboldMariano([-1, 1, -2, 0], 1).p, one.p, 1e-15);
});

test("the scorecard by hand: misses, the margin, closer, the band and the edges", () => {
  const logs = Float64Array.of(0, 0.1, 0.2, 0.1, 0.3);
  const rec = (t, mid, sd = 0.1) => ({ t, order: { p: 0, q: 0, drift: true }, mid: [mid, mid], sd: [sd, sd] });
  // Made at t = 1 (price 0.1): model 0.15, outcome 0.2. Made at t = 2 (price 0.2): model 0.2, outcome 0.1.
  const s = scorecard(logs, [rec(1, 0.15), rec(2, 0.2), rec(4, 0.3)], 1);
  assert.equal(s.n, 2); // the forecast made at t = 4 has no outcome yet
  close(s.model, (0.05 + 0.1) / 2, 1e-12); close(s.naive, (0.1 + 0.1) / 2, 1e-12);
  assert.equal(s.margin, 0.25); assert.equal(s.verdict, "ahead");
  close(s.closer, 0.5, 1e-12);
  close(s.coverage80, 1, 1e-12); // misses of 0.05 and 0.1 are inside 1.28 x 0.1
  assert.equal(scorecard(logs, [rec(1, 0.15), rec(2, 0.2)], 1, { from: 2 }).n, 1);
  assert.equal(scorecard(logs, [rec(1, 0.15)], 1, { to: 0 }).n, 0);
  // A model that repeats the naive forecast is level, not ahead, and the test has nothing to measure.
  const same = scorecard(logs, [rec(1, 0.1), rec(2, 0.2), rec(3, 0.1)], 1);
  assert.equal(same.verdict, "level"); assert.equal(same.margin, 0); assert.equal(same.dm.p, 1); assert.equal(same.closer, 0);
  // A difference smaller than one part in 2,000 is level; one part in 1,000 is not.
  const tiny = scorecard(Float64Array.of(0, 1), [rec(0, 0.0004)], 1);
  assert.equal(tiny.margin, 0); assert.equal(tiny.verdict, "level");
  const two = scorecard(Float64Array.of(0, 1), [rec(0, 0.001)], 1);
  assert.equal(two.margin, 0.001); assert.equal(two.verdict, "ahead");
  const worse = scorecard(Float64Array.of(0, 1), [rec(0, -0.1)], 1);
  assert.equal(worse.verdict, "behind"); close(worse.margin, -0.1, 1e-12);
});

test("running averages and the shares of each order", () => {
  const rows = [{ t: 0, model: 0.1, naiveMiss: 0.2 }, { t: 1, model: 0.3, naiveMiss: 0.2 }];
  const run = running(rows);
  close(run[0].model, Math.exp(0.1) - 1); close(run[1].model, Math.exp(0.2) - 1); close(run[1].naive, Math.exp(0.2) - 1);
  const shares = orderShares([{ order: { p: 0, q: 1, drift: false } }, { order: { p: 0, q: 1, drift: false } }, { order: { p: 1, q: 0, drift: true } }]);
  assert.deepEqual(shares.map((s) => s.name), ["ARIMA(0,1,1)", "ARIMA(1,1,0) with drift"]);
  close(shares[0].share, 2 / 3);
  close(asPercent(Math.log(1.25)), 0.25);
});

test("months", () => {
  assert.deepEqual(monthAt("1975-01", 0), { year: 1975, month: 0 });
  assert.deepEqual(monthAt("1975-01", 620), { year: 2026, month: 8 });
  assert.equal(monthLabel("1975-01", 120, false), "January 1985");
  assert.equal(indexOfYear("1975-01", 1985), 120);
  assert.equal(indexOfYear("1975-01", 2024) - 1, at("2023-12"));
});

/* ------------------------------------------------------------- data */

test("the bundled prices match the World Bank's workbook", () => {
  // Workbook "Updated on October 02, 2026", sheet "Monthly Prices", column "Gold", ($/troy oz).
  const value = (key) => GOLD.values[at(key)];
  assert.equal(value("1975-01"), 176);
  assert.equal(value("1980-01"), 675);
  assert.equal(value("1999-07"), 256);
  assert.equal(value("2011-09"), 1772);
  assert.equal(value("2020-08"), 1969);
  assert.equal(value("2026-09"), 4319);
  assert.equal(GOLD.start, "1975-01");
  assert.equal(GOLD.source.licence, "CC BY 4.0");
  assert.match(GOLD.definition, /average of daily rates/);
  // A refresh may add months but never shortens the series.
  assert.ok(GOLD.values.length >= 621);
  assert.ok(GOLD.values.every((v) => Number.isInteger(v) && v > 0));
});

/* ------------------------------------------------------------- the finding */

test("One finding: twelve months ahead, forecasts made from 1985 to 2023, the AICc choice against the latest price", { timeout: 120000 }, () => {
  const records = runAll("auto");
  const to = indexOfYear(GOLD.start, 2024) - 1;
  const s = scorecard(LOGS, records, 12, { from: indexOfYear(GOLD.start, 1985), to });
  assert.equal(s.n, 468);
  assert.equal(Math.round(asPercent(s.model) * 1000) / 10, 12.1);
  assert.equal(Math.round(asPercent(s.naive) * 1000) / 10, 12.3);
  assert.equal(s.verdict, "ahead");
  close(s.dm.p, 0.657, 0.0005);
  close(s.coverage80, 0.906, 0.0005);
  const h1 = scorecard(LOGS, records, 1, { to });
  assert.equal(Math.round(asPercent(h1.model) * 10000) / 100, 2.61);
  assert.equal(Math.round(asPercent(h1.naive) * 10000) / 100, 2.63);
  close(h1.coverage80, 0.940, 0.0005);
});

test("the write-up's other numbers: the MA(1) coefficient to September 2026 and the orders chosen", { timeout: 120000 }, () => {
  close(fitArima(upTo("2026-09"), { p: 0, q: 1, drift: false }).theta[0], 0.26, 0.005);
  const records = runAll("auto").filter((r) => r.t <= at("2023-12"));
  const shares = orderShares(records);
  assert.deepEqual(shares.map((s) => s.name), ["ARIMA(2,1,0) with drift", "ARIMA(2,1,0)", "ARIMA(0,1,1)"]);
  assert.deepEqual(shares.map((s) => Math.round(s.share * 100)), [41, 34, 24]);
});

test("the limits' numbers: fitted on the latest ten years, the 80% band held 84% one month ahead and 71% twelve months ahead", { timeout: 120000 }, () => {
  const records = runAll("auto", { window: 120 });
  const to = indexOfYear(GOLD.start, 2024) - 1;
  assert.equal(Math.round(scorecard(LOGS, records, 1, { to }).coverage80 * 100), 84);
  assert.equal(Math.round(scorecard(LOGS, records, 12, { to }).coverage80 * 100), 71); // 72 before the review's fix to the search
  assert.equal(Math.round(468 / 12), 39);
});
