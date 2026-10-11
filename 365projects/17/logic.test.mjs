import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { MAX_DEGREE, TRUTHS, truthOf, generate, legendre, fitPolynomials, predict, curve, picks, trial, experiment, summarise } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const sample = (opts) => generate({ truth: "quadratic", noise: 1, n: 30, seed: 17, ...opts }).points;

test("the generator is reproducible and refuses bad settings", () => {
  assert.deepEqual(sample(), sample());
  assert.notDeepEqual(sample(), sample({ seed: 18 }));
  assert.equal(sample({ n: 77 }).length, 77);
  assert.ok(sample().every((p) => p.x >= 0 && p.x <= 10));
  // With no noise the points lie on the curve.
  for (const t of TRUTHS) for (const p of generate({ truth: t.id, noise: 0, n: 20, seed: 4 }).points) close(p.y, t.f(p.x), 1e-12);
  assert.match(generate({ truth: "zigzag" }).error, /no curve/);
  assert.match(generate({ n: 2 }).error, /sample size/);
  assert.match(generate({ n: 12.5 }).error, /sample size/);
  assert.match(generate({ noise: -1 }).error, /noise/);
  assert.match(generate({ noise: NaN }).error, /noise/);
  assert.match(generate({ seed: 1.5 }).error, /seed/);
});

test("Legendre polynomials: known values", () => {
  assert.deepEqual(legendre(0.5, 0), [1]);
  const p = legendre(0.5, 4);
  close(p[2], (3 * 0.25 - 1) / 2);
  close(p[3], (5 * 0.125 - 3 * 0.5) / 2);
  close(p[4], (35 * 0.0625 - 30 * 0.25 + 3) / 8);
  assert.ok(legendre(1, 8).every((v) => Math.abs(v - 1) < 1e-12));
});

test("a hand-computed fit: three points, mean and straight line", () => {
  const fit = fitPolynomials([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }]);
  assert.equal(fit.top, 1);                       // three points leave room for degree 0 and 1 only
  // Degree 0 is the mean, 2: residuals -1, 1, 0.
  close(fit.models[0].rss, 2);
  close(predict(fit, 0, 5), 2);
  // Degree 1 is y = 1.5 + 0.5x: residuals -0.5, 1, -0.5.
  close(fit.models[1].rss, 1.5);
  close(predict(fit, 1, 0), 1.5);
  close(predict(fit, 1, 2), 2.5);
  // AIC = n ln(RSS / n) + 2k with k = degree + 2, BIC = n ln(RSS / n) + k ln n.
  close(fit.models[0].aic, 3 * Math.log(2 / 3) + 4);
  close(fit.models[1].aic, 3 * Math.log(1.5 / 3) + 6);
  close(fit.models[1].bic, 3 * Math.log(1.5 / 3) + 3 * Math.log(3));
  assert.equal(fit.models[1].k, 3);
  // Leave-one-out for the mean: each point is predicted by the mean of the other two.
  close(fit.models[0].loo, ((1 - 2.5) ** 2 + (3 - 1.5) ** 2 + (2 - 2) ** 2) / 3);
  // AICc needs n - k - 1 > 0, which three points do not give.
  assert.ok(Number.isNaN(fit.models[0].aicc) && Number.isNaN(fit.models[1].aicc));
});

test("the fit agrees with ordinary least squares on raw powers where that is still stable", () => {
  const pts = sample();
  const fit = fitPolynomials(pts);
  assert.equal(fit.top, MAX_DEGREE);
  for (const d of [1, 2, 3, 4]) {
    const ols = stats.ols(pts.map((p) => Array.from({ length: d }, (_, j) => p.x ** (j + 1))), pts.map((p) => p.y));
    close(fit.models[d].rss, ols.rss, 1e-6);
    const at = 3.3;
    close(predict(fit, d, at), ols.beta.reduce((s, b, j) => s + b * at ** j, 0), 1e-6);
  }
});

test("the criteria follow their formulas, and AICc is AIC plus the small-sample term", () => {
  const fit = fitPolynomials(sample());
  const n = 30;
  for (const m of fit.models) {
    assert.equal(m.k, m.degree + 2);
    close(m.aic, n * Math.log(m.rss / n) + 2 * m.k);
    close(m.bic, n * Math.log(m.rss / n) + m.k * Math.log(n));
    close(m.aicc, m.aic + (2 * m.k * (m.k + 1)) / (n - m.k - 1));
    close(m.mse, m.rss / n);
  }
});

test("the residual sum of squares never rises with degree; the criteria do", () => {
  const fit = fitPolynomials(sample());
  for (let d = 1; d <= fit.top; d++) assert.ok(fit.models[d].rss <= fit.models[d - 1].rss + 1e-9);
  const p = picks(fit);
  assert.equal(p.rss, 8);
  assert.deepEqual([p.aic, p.aicc, p.bic, p.loo], [2, 2, 2, 2]);
  assert.ok(fit.models[8].bic > fit.models[2].bic && fit.models[8].aic > fit.models[2].aic);
});

test("leave-one-out error from leverages equals refitting without each point", () => {
  const pts = sample({ n: 14, seed: 3 });
  const fit = fitPolynomials(pts, 4);
  for (const d of [0, 1, 2, 3, 4]) {
    let press = 0;
    pts.forEach((p, i) => {
      const rest = fitPolynomials(pts.filter((_, j) => j !== i), d);
      press += (p.y - predict(rest, d, p.x)) ** 2;
    });
    close(fit.models[d].loo, press / pts.length, 1e-8);
  }
});

test("the fit stays accurate where raw powers of x would not", () => {
  // x near one million: x^8 is about 1e48, far beyond what a matrix of raw powers can carry.
  const r = rng(5);
  const pts = Array.from({ length: 40 }, () => { const u = r.uniform(0, 10); return { x: 1e6 + u, y: 2 + 2 * u - 0.2 * u * u + r.normal(0, 0.5) }; });
  const fit = fitPolynomials(pts);
  assert.equal(fit.top, 8);
  const same = fitPolynomials(pts.map((p) => ({ x: p.x - 1e6, y: p.y })));
  for (let d = 0; d <= 8; d++) close(fit.models[d].rss, same.models[d].rss, 1e-6);
  close(predict(fit, 2, 1e6 + 5), predict(same, 2, 5), 1e-6);
  assert.equal(picks(fit).bic, 2);
});

test("a polynomial with no noise is recovered and flagged as an exact fit", () => {
  const pts = generate({ truth: "cubic", noise: 0, n: 12, seed: 2 }).points;
  const fit = fitPolynomials(pts);
  const f = truthOf("cubic").f;
  assert.equal(fit.models[2].exact, false);
  for (const d of [3, 4, 5]) {
    assert.equal(fit.models[d].exact, true);
    assert.ok(Number.isNaN(fit.models[d].aic) && Number.isNaN(fit.models[d].loo));
    close(predict(fit, d, 7.7), f(7.7), 1e-7);
  }
  // With no misfit left to weigh, every measure takes the lowest degree that fits exactly: the cubic, not something below it.
  assert.deepEqual(picks(fit), { rss: 3, aic: 3, aicc: 3, bic: 3, loo: 3 });
  // Six points exactly on a straight line: degree 1, not the mean, whose criteria happen to be the only finite ones.
  const line = fitPolynomials([1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 2 * x - 1 })));
  assert.equal(line.models[0].exact, false);
  assert.ok(Number.isFinite(line.models[0].aic) && Number.isNaN(line.models[1].aic));
  assert.deepEqual(picks(line), { rss: 1, aic: 1, aicc: 1, bic: 1, loo: 1 });
  // Points that all share one y are fitted exactly by the mean.
  assert.deepEqual(picks(fitPolynomials([{ x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }])), { rss: 0, aic: 0, aicc: 0, bic: 0, loo: 0 });
});

test("picks: a higher degree that fits no better does not take the lowest RSS, and AICc can be undefined", () => {
  // Symmetric about x = 5, so the odd powers add nothing: degrees 1 and 3 leave the residual where degrees 0 and 2 put it.
  const sym = fitPolynomials([[0, 1], [5, 3], [10, 1], [2, 2], [8, 2]].map(([x, y]) => ({ x, y })));
  assert.equal(sym.top, 3);
  close(sym.models[1].rss, sym.models[0].rss, 1e-12);
  close(sym.models[3].rss, sym.models[2].rss, 1e-12);
  assert.equal(sym.models[2].exact, false);
  assert.equal(picks(sym).rss, 2);
  // Three points that are not in line: AICc needs n - k - 1 > 0, so it has no pick, and nothing is exact.
  const three = fitPolynomials([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 2 }]);
  assert.deepEqual(picks(three), { rss: 1, aic: 0, aicc: null, bic: 0, loo: 0 });
});

test("too few points, repeated x values and junk are handled", () => {
  assert.match(fitPolynomials([]).error, /0 points/);
  assert.match(fitPolynomials([{ x: 1, y: 1 }]).error, /1 point/);
  assert.match(fitPolynomials([{ x: 1, y: 1 }, { x: NaN, y: 2 }, { x: 3, y: Infinity }]).error, /1 point/);
  // Five points at two x positions can carry a line and nothing more.
  const two = fitPolynomials([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 4, y: 7 }]);
  assert.equal(two.top, 1);
  close(predict(two, 1, 1), 1.5);
  close(predict(two, 1, 4), 6);
  // All at one x: only the mean.
  const one = fitPolynomials([{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 6 }]);
  assert.equal(one.top, 0);
  close(predict(one, 0, 9), 3);
  assert.equal(fitPolynomials(sample({ n: 6 })).top, 4);
  assert.equal(curve(two, 1, 0, 10, 20).length, 21);
});

test("experiments do not depend on how they are batched", () => {
  const settings = { truth: "cubic", noise: 1.5, n: 25, seed: 9 };
  const whole = experiment(settings, 0, 60);
  const parts = [...experiment(settings, 0, 25), ...experiment(settings, 25, 60)];
  assert.deepEqual(whole, parts);
  assert.equal(experiment({ ...settings, n: 1 }, 0, 5).error !== undefined, true);
  assert.ok(trial({ truth: "nope" }).error);
});

test("theory: a model that contains the truth misses it by (degree + 1) sigma squared / n on average", () => {
  const s = summarise(experiment({ truth: "quadratic", noise: 1, n: 30, seed: 17 }, 0, 2000), 2);
  for (const d of [2, 3, 5, 8]) close(s.riskByDegree[d], (d + 1) / 30, 0.012);
  assert.ok(s.riskByDegree[1] > 1.5);                 // a straight line cannot follow the curve at all
});

test("the numbers quoted under One finding", () => {
  const one = fitPolynomials(sample());
  assert.equal(one.models[0].rss.toFixed(1), "59.8");
  assert.equal(one.models[8].rss.toFixed(1), "22.2");
  assert.deepEqual(Object.values(picks(one)), [8, 2, 2, 2, 2]);
  // "At 30 points and degree 8 the small-sample correction adds 11.6."
  assert.equal((one.models[8].aicc - one.models[8].aic).toFixed(1), "11.6");
  const s = summarise(experiment({ truth: "quadratic", noise: 1, n: 30, seed: 17 }, 0, 1000), 2);
  assert.equal(s.runs, 1000);
  assert.equal(s.criteria.rss.counts[8], 1000);
  assert.equal(s.criteria.bic.counts[2], 865);
  assert.equal(s.criteria.aic.counts[2], 607);
  assert.equal(s.criteria.aic.high, 0.393);
  assert.equal(s.criteria.aic.low + s.criteria.bic.low, 0);
  assert.equal(s.criteria.aic.risk.toFixed(3), "0.192");
  assert.equal(s.criteria.bic.risk.toFixed(3), "0.134");
  // "At 200 points AIC still picks too high a degree in 288 samples of 1,000, against 28 for BIC."
  const big = summarise(experiment({ truth: "quadratic", noise: 1, n: 200, seed: 17 }, 0, 1000), 2);
  assert.equal(Math.round(big.criteria.aic.high * 1000), 288);
  assert.equal(Math.round(big.criteria.bic.high * 1000), 28);
  assert.equal(big.criteria.aic.low + big.criteria.bic.low, 0);
  // A sine wave is not a polynomial: with 100 points AIC's picks land nearer the truth than BIC's.
  const w = summarise(experiment({ truth: "sine", noise: 1, n: 100, seed: 17 }, 0, 1000), null);
  assert.ok(Number.isNaN(w.criteria.aic.right));
  assert.equal(w.criteria.aic.risk.toFixed(3), "0.087");
  assert.equal(w.criteria.bic.risk.toFixed(3), "0.101");
  assert.ok(w.criteria.bic.meanDegree < w.criteria.aic.meanDegree);
});

// P(chi-square with k degrees of freedom > x), in closed form: a finite sum for even k, the same plus erfc for odd k.
function chiSquareUpper(k, x) {
  const h = x / 2;
  let sum = k % 2 ? 2 * (1 - stats.normalCdf(Math.sqrt(x))) : 0;
  for (let i = k % 2 ? 1 : 0; i < k / 2; i++) sum += Math.exp(-h + (k % 2 ? i - 0.5 : i) * Math.log(h) - stats.logGamma((k % 2 ? i + 0.5 : i + 1)));
  return sum;
}

test("theory: AIC's large-sample chance of overshooting is 15.7% with one spare degree and 27% with six", () => {
  close(chiSquareUpper(2, 4), Math.exp(-2), 1e-12);
  close(chiSquareUpper(4, 8), 5 * Math.exp(-4), 1e-12);
  close(chiSquareUpper(1, 3.841), 0.05, 1e-4);          // the familiar 5% point
  // In a large sample the gain in fit from j unnecessary coefficients is a sum S_j of j squared standard normals, and
  // AIC prefers degree d0 + j to d0 when S_j > 2j. The chance that S_j - 2j never rises above 0 for j = 1..K follows from
  // Spitzer's identity: K q_K = sum over i = 1..K of P(S_i <= 2i) q_(K - i), with q_0 = 1 (Shibata 1976).
  const stay = [1];
  for (let K = 1; K <= 7; K++) { let s = 0; for (let i = 1; i <= K; i++) s += (1 - chiSquareUpper(i, 2 * i)) * stay[K - i]; stay.push(s / K); }
  const overshoot = stay.map((q) => 1 - q);
  assert.equal(overshoot[1].toFixed(4), "0.1573");
  assert.equal(overshoot[6].toFixed(3), "0.271");       // true degree 2, highest degree 8: "about 27%"
  assert.equal(overshoot[7].toFixed(3), "0.276");       // true degree 1
  // The same thing by brute force: simulate the walk.
  const r = rng(27);
  let over = 0;
  for (let t = 0; t < 100000; t++) { let s = 0; for (let j = 1; j <= 6; j++) { s += r.normal() ** 2; if (s > 2 * j) { over++; break; } } }
  close(over / 100000, overshoot[6], 0.005);            // standard error 0.0014
  // And the tool's own experiment heads there as the sample grows: 393 samples in 1,000 at 30 points, 288 at 200, 281 at 1,000.
  const at = (n) => Math.round(summarise(experiment({ truth: "quadratic", noise: 1, n, seed: 17 }, 0, 1000), 2).criteria.aic.high * 1000);
  const shares = [at(30), at(200), at(1000)];
  assert.deepEqual(shares, [393, 288, 281]);
  close(shares[2] / 1000, overshoot[6], 0.04);          // standard error 0.014
});

test("BIC homes in on the true degree as the sample grows; AIC keeps overshooting", () => {
  const at = (n) => summarise(experiment({ truth: "line", noise: 1, n, seed: 5 }, 0, 600), 1).criteria;
  const small = at(20), large = at(200);
  assert.ok(large.bic.right > small.bic.right && large.bic.right > 0.95, `BIC ${small.bic.right} then ${large.bic.right}`);
  assert.ok(large.aic.high > 0.2 && large.aic.high < 0.4, `AIC overshoots ${large.aic.high}`);
  // With few points AICc repairs most of AIC's overfitting.
  assert.ok(small.aicc.right > small.aic.right + 0.15);
});
