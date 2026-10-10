import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { PRIORS, EXAMPLES, MAX_COUNT, problem, lnGammaRatio, betaCdf, betaQuantile, credible, runProbability, evenRun, analyse, density } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const rel = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} is not within ${tol} (relative) of ${b}`);
const prior = Object.fromEntries(PRIORS.map((p) => [p.key, p]));
const SUNRISE = 1826213;

test("Laplace's rule of succession: (s + 1) / (n + 2)", () => {
  close(analyse(prior.uniform, 9, 1).next, 10 / 12);
  close(analyse(prior.uniform, 0, 0).next, 0.5);
  close(analyse(prior.uniform, 1, 2).next, 2 / 5);
  // The sunrise: 1,826,214 / 1,826,215, which is odds of exactly 1,826,214 to 1.
  const sun = analyse(prior.uniform, SUNRISE, 0);
  close(sun.next, 1826214 / 1826215, 1e-15);
  assert.equal(sun.odds, 1826214);
  close(sun.fail, 1 / 1826215, 1e-18);
});

test("the other priors: (s + a) / (n + a + b)", () => {
  close(analyse(prior.jeffreys, 9, 1).next, 9.5 / 11);
  close(analyse(prior.sceptical, 9, 1).next, 10 / 21);
  close(analyse(prior.haldane, 9, 1).next, 0.9);
  close(analyse({ a: 3, b: 7 }, 4, 6).next, 7 / 20);
  assert.equal(analyse(prior.jeffreys, SUNRISE, 0).odds, 2 * SUNRISE + 1);
  close(analyse(prior.sceptical, SUNRISE, 0).odds, (SUNRISE + 1) / 10);
});

test("the predictive probability is the mean of the posterior, checked by numerical integration", () => {
  // Integrate p x Beta(p; A, B) over (0, 1) with the midpoint rule.
  for (const [a, b, s, f] of [[1, 1, 9, 1], [1, 10, 3, 2], [2.5, 4, 0, 7], [1, 1, 0, 0]]) {
    const r = analyse({ a, b }, s, f);
    let mass = 0, mean = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const p = (i + 0.5) / N;
      const d = density(p, r.A, r.B) / N;
      mass += d;
      mean += p * d;
    }
    close(mass, 1, 1e-6);
    close(mean, r.next, 1e-6);
  }
});

test("a simulation with a uniform underlying chance reproduces the rule", () => {
  // Draw a chance uniformly, run 5 trials and one more. Among worlds with 4 successes in 5, the next succeeds 5/7 of the time.
  const r = rng(30);
  let matched = 0, nextHit = 0;
  for (let i = 0; i < 600000; i++) {
    const p = r();
    let s = 0;
    for (let t = 0; t < 5; t++) if (r() < p) s++;
    const next = r() < p;
    if (s === 4) { matched++; if (next) nextHit++; }
  }
  assert.ok(matched > 90000);
  close(nextHit / matched, 5 / 7, 0.005);
  close(analyse(prior.uniform, 4, 1).next, 5 / 7);
});

test("the incomplete beta function matches its closed forms", () => {
  for (const x of [0.001, 0.2, 0.5, 0.77, 0.999]) {
    close(betaCdf(x, 1, 1), x, 1e-12);
    close(betaCdf(x, 7, 1), x ** 7, 1e-12);
    close(betaCdf(x, 1, 4), 1 - (1 - x) ** 4, 1e-12);
    close(betaCdf(x, 2, 2), 3 * x * x - 2 * x ** 3, 1e-12);
    close(betaCdf(x, 0.5, 0.5), (2 / Math.PI) * Math.asin(Math.sqrt(x)), 1e-10);
    close(betaCdf(x, 3.2, 8.5), 1 - betaCdf(1 - x, 8.5, 3.2), 1e-12);
  }
  close(betaCdf(0.5, 12.5, 12.5), 0.5, 1e-12);
  assert.equal(betaCdf(0, 2, 3), 0);
  assert.equal(betaCdf(1, 2, 3), 1);
  assert.ok(Number.isNaN(betaCdf(0.5, 0, 1)));
  // Very large parameters: Beta(n + 1, 1) has cdf x^(n + 1).
  for (const x of [1 - 1e-7, 1 - 1e-6, 1 - 3e-6]) rel(betaCdf(x, SUNRISE + 1, 1), Math.exp((SUNRISE + 1) * Math.log(x)), 1e-8);
  rel(betaCdf(0.5, 1e6, 1e6), 0.5, 1e-9);
});

test("quantiles invert the distribution function", () => {
  for (const [a, b] of [[1, 1], [10, 2], [0.5, 0.5], [1, 10], [50.5, 0.5], [SUNRISE + 1, 11]]) {
    for (const q of [0.025, 0.5, 0.975]) close(betaCdf(betaQuantile(q, a, b), a, b), q, 1e-9);
  }
  close(betaQuantile(0.3, 1, 1), 0.3, 1e-12);
  close(betaQuantile(0.05, 11, 1), 0.05 ** (1 / 11), 1e-12);
  close(betaQuantile(0.975, 0.5, 0.5), Math.sin((Math.PI * 0.975) / 2) ** 2, 1e-10);
  assert.equal(betaQuantile(0, 2, 2), 0);
  assert.equal(betaQuantile(1, 2, 2), 1);
  assert.ok(Number.isNaN(betaQuantile(0.5, 0, 2)));
  assert.ok(Number.isNaN(betaQuantile(1.5, 2, 2)));
});

test("credible intervals: central, or one-sided when the peak is at an end", () => {
  // Ten out of ten, uniform prior: Beta(11, 1) peaks at 1, so the interval runs from 0.05^(1/11) up to 1.
  const up = credible(11, 1);
  assert.equal(up.kind, "upper");
  assert.equal(up.hi, 1);
  close(up.lo, 0.05 ** (1 / 11), 1e-12);
  // Never in 50, uniform prior: Beta(1, 51) peaks at 0. The top is close to the "rule of three", 3 / n.
  const down = credible(1, 51);
  assert.equal(down.kind, "lower");
  assert.equal(down.lo, 0);
  close(down.hi, 1 - 0.05 ** (1 / 51), 1e-12);
  close(down.hi, 3 / 51, 0.003);
  // Nine out of ten: Beta(10, 2) has an interior peak, so equal tails.
  const mid = credible(10, 2);
  assert.equal(mid.kind, "central");
  close(betaCdf(mid.lo, 10, 2), 0.025, 1e-9);
  close(betaCdf(mid.hi, 10, 2), 0.975, 1e-9);
  // The flat prior on its own: 2.5% to 97.5%.
  close(credible(1, 1).lo, 0.025, 1e-12);
  close(credible(1, 1).hi, 0.975, 1e-12);
  // The sunrise.
  const sun = analyse(prior.uniform, SUNRISE, 0).interval;
  close(sun.lo, 0.05 ** (1 / (SUNRISE + 1)), 1e-12);
  assert.equal(credible(0, 5), null);
  // Coverage really is 95%.
  for (const [a, b] of [[11, 1], [1, 51], [10, 2], [0.5, 0.5], [10.5, 0.5]]) {
    const c = credible(a, b);
    close(betaCdf(c.hi, a, b) - betaCdf(c.lo, a, b), 0.95, 1e-9);
  }
});

test("the chance of a run of successes is the product of the step-by-step chances", () => {
  for (const [A, B, m] of [[11, 1, 5], [9.5, 1.5, 12], [2, 11, 3], [1, 1, 1], [0.5, 0.5, 40]]) {
    let product = 1;
    for (let i = 0; i < m; i++) product *= (A + i) / (A + B + i);
    rel(runProbability(A, B, m), product, 1e-10);
  }
  // Uniform prior after n straight successes: (n + 1) / (n + m + 1).
  rel(runProbability(SUNRISE + 1, 1, 365), (SUNRISE + 1) / (SUNRISE + 366), 1e-10);
  rel(runProbability(SUNRISE + 1, 1, SUNRISE + 1), 0.5, 1e-10);
  rel(runProbability(MAX_COUNT + 1, 1, 1e9), (MAX_COUNT + 1) / (MAX_COUNT + 1e9 + 1), 1e-9);
  // One step is the predictive probability.
  rel(runProbability(10, 2, 1), 10 / 12, 1e-12);
  assert.equal(runProbability(10, 2, 0), 1);
  assert.equal(runProbability(10, 0, 1000), 1);
  assert.equal(runProbability(0, 10, 1), 0);
  assert.equal(runProbability(0, 0, 3), null);
});

test("log-gamma differences stay accurate for large arguments", () => {
  rel(lnGammaRatio(1e6, 1), Math.log(1e6), 1e-12);
  rel(lnGammaRatio(1e8, 2), Math.log(1e8) + Math.log(1e8 + 1), 1e-12);
  rel(lnGammaRatio(5e4, 0.5), stats.logGamma(5e4 + 0.5) - stats.logGamma(5e4), 1e-8);
  rel(lnGammaRatio(20000, 3), Math.log(20000 * 20001 * 20002), 1e-12);
  rel(lnGammaRatio(7, 3), Math.log(7 * 8 * 9), 1e-12);
  assert.equal(lnGammaRatio(123, 0), 0);
});

test("the even-odds run: under Laplace's rule an unbroken run of n is an even bet to last n + 1 more", () => {
  for (const n of [0, 1, 10, 999, SUNRISE]) assert.equal(evenRun(n + 1, 1), n + 1);
  for (const [A, B] of [[10.5, 0.5], [11, 11], [3, 2], [SUNRISE + 1, 11], [SUNRISE + 0.5, 0.5]]) {
    const m = evenRun(A, B);
    assert.ok(runProbability(A, B, m) <= 0.5 + 1e-9 && runProbability(A, B, m - 1) > 0.5 + 1e-9, `${A}, ${B}: ${m}`);
  }
  assert.equal(evenRun(5, 0), Infinity);
  assert.equal(evenRun(0, 5), 1);
  assert.equal(evenRun(0, 0), null);
  // A prior with almost no weight on failure makes the run effectively endless.
  assert.equal(evenRun(100, 0.001), Infinity);
});

test("Haldane's prior is handled as a limit, not as a distribution", () => {
  const nothing = analyse(prior.haldane, 0, 0);
  assert.equal(nothing.next, null);
  assert.equal(nothing.odds, null);
  assert.equal(nothing.interval, null);
  assert.equal(nothing.run, null);
  assert.equal(nothing.proper, false);
  const unbroken = analyse(prior.haldane, 10, 0, 5);
  assert.equal(unbroken.next, 1);
  assert.equal(unbroken.fail, 0);
  assert.equal(unbroken.odds, Infinity);
  assert.equal(unbroken.proper, false);
  assert.equal(unbroken.interval, null);
  assert.equal(unbroken.run, 1);
  assert.equal(unbroken.evenRun, Infinity);
  const never = analyse(prior.haldane, 0, 7);
  assert.equal(never.next, 0);
  assert.equal(never.proper, false);
  const mixed = analyse(prior.haldane, 9, 1);
  assert.equal(mixed.proper, true);
  assert.equal(mixed.interval.kind, "upper");
  close(mixed.next, 0.9);
});

test("the priors converge on the probability but not on the odds", () => {
  let last = Infinity;
  for (const n of [1, 10, 100, 10000, 1000000]) {
    const u = analyse(prior.uniform, n, 0), j = analyse(prior.jeffreys, n, 0), k = analyse(prior.sceptical, n, 0);
    const gap = Math.max(u.next, j.next, k.next) - Math.min(u.next, j.next, k.next);
    assert.ok(gap < last);
    last = gap;
    // Jeffreys is always (n + 2) / (n + 1) times as sure as Laplace about failure, which tends to 2 and never to 1.
    rel(u.fail / j.fail, (2 * (n + 1)) / (n + 2), 1e-12);
    rel(k.fail / u.fail, (10 * (n + 2)) / (n + 11), 1e-12);
  }
  assert.ok(last < 1e-5);
  // With a mixed record every prior heads for the observed rate, failures included.
  const u = analyse(prior.uniform, 900000, 100000), k = analyse(prior.sceptical, 900000, 100000);
  rel(u.fail / k.fail, 1, 1e-4);
});

test("bad input is described, good input passes", () => {
  assert.equal(problem({ s: 10, f: 0, a: 1, b: 1, m: 5 }), null);
  assert.equal(problem({ s: 0, f: 0 }), null);
  for (const bad of [{ s: -1, f: 0 }, { s: 1.5, f: 0 }, { s: NaN, f: 0 }, { s: 1, f: MAX_COUNT + 1 }, { s: 1, f: "2" },
    { s: 1, f: 1, a: -1, b: 1 }, { s: 1, f: 1, a: 1, b: NaN }, { s: 1, f: 1, a: 1, b: 1, m: 0 }, { s: 1, f: 1, a: 1, b: 1, m: 2.5 }]) {
    assert.equal(typeof problem(bad), "string", JSON.stringify(bad));
  }
  for (const e of EXAMPLES) assert.equal(problem(e), null, e.key);
});

test("the finding on the page", () => {
  const u = analyse(prior.uniform, SUNRISE, 0), j = analyse(prior.jeffreys, SUNRISE, 0), k = analyse(prior.sceptical, SUNRISE, 0);
  assert.equal(u.odds, 1826214);
  assert.equal(j.odds, 3652427);
  assert.equal(Math.round(k.odds), 182621);
  // Within 0.0006 percentage points of each other...
  const spread = (Math.max(u.next, j.next, k.next) - Math.min(u.next, j.next, k.next)) * 100;
  assert.ok(spread < 0.0006 && spread > 0.0005, String(spread));
  // ...but twentyfold apart on the chance of failure.
  assert.equal(Math.round(k.fail / j.fail), 20);
  assert.equal(u.evenRun, 1826214);
  assert.equal((u.next * 100).toFixed(6), "99.999945");
  // Ten out of ten: 91.7%, 95.5%, 52.4% and certainty.
  assert.deepEqual(["uniform", "jeffreys", "sceptical", "haldane"].map((key) => (analyse(prior[key], 10, 0).next * 100).toFixed(1)), ["91.7", "95.5", "52.4", "100.0"]);
});
