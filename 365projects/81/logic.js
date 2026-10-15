// Day 81: Bank Run Simulation. The model, with no DOM code.
// Diamond and Dybvig (1983) with the fundamentals of Goldstein and Pauzner (2005): a bank's long investment pays R
// with probability p(theta) = theta, and depositors either all know theta (two equilibria, chosen by beliefs) or
// each see it with a little noise (a global game with one threshold).

import { rng } from "../kit/kit.js";

/** As in Goldstein and Pauzner: at fundamentals this good the investment can be cashed in at full value at once. */
export const THETA_BAR = 0.95;

/** What each setting may be. */
export const LIMITS = {
  R: { min: 1.05, max: 3, label: "return on the bank's investment" },
  r1: { min: 1, max: 3, label: "payment promised to early withdrawers" },
  lambda: { min: 0.05, max: 0.6, label: "share of depositors who need their money early" },
  a: { min: 1.1, max: 5, label: "risk aversion" },
  theta: { min: 0, max: 1, label: "chance the investment pays off" },
  // Goldstein and Pauzner assume THETA_BAR < 1 - 2 eps, so that the threshold depositor's fundamentals, k +- eps, stay
  // inside [0, 1] where the even prior lives; with THETA_BAR = 0.95 the noise must stay below 0.025.
  eps: { min: 0.002, max: 0.024, label: "noise in each depositor's signal" },
  belief: { min: 0, max: 1, label: "share of depositors expected to withdraw early" },
  spread: { min: 0, max: 0.5, label: "spread of beliefs" },
};

export const DEFAULTS = { R: 2, r1: 1.05, lambda: 0.25, a: 1.1, theta: 0.85, eps: 0.02, belief: 0.3, spread: 0.1 };

/**
 * Check the bank and the depositors. The bank must be able to pay its impatient depositors (lambda r1 < 1) and must
 * promise less than its investment returns (r1 < R), as in Goldstein and Pauzner.
 */
export function readSettings(raw) {
  const errors = [];
  const s = {};
  for (const [key, lim] of Object.entries(LIMITS)) {
    if (raw[key] === undefined) continue;
    const v = Number(raw[key]);
    if (raw[key] === "" || raw[key] == null || !Number.isFinite(v) || v < lim.min || v > lim.max) errors.push({ key, message: `The ${lim.label} must be between ${lim.min} and ${lim.max}.` });
    else s[key] = v;
  }
  if (!errors.length && s.r1 >= s.R) errors.push({ key: "r1", message: `The bank must promise early withdrawers less than its investment returns: below ${s.R}.` });
  if (!errors.length && s.lambda * s.r1 >= 1) errors.push({ key: "r1", message: "The bank cannot pay even the depositors who need their money early: lower the promise or the share of early needs." });
  return { ok: !errors.length, settings: s, errors };
}

/** Utility 1 - e^(-a c): zero at nothing, as Goldstein and Pauzner require, with relative risk aversion a c, above 1 for c >= 1. */
export const util = (c, a) => (c === Infinity ? 1 : 1 - Math.exp(-a * c));
/** The sure consumption with the same utility. */
export const sure = (U, a) => (U >= 1 ? Infinity : U <= 0 ? 0 : -Math.log(1 - U) / a);

/** Payment to each depositor who waits, if the investment pays off, when a share n withdraws early. */
export function lateAmount(n, { R, r1 }) {
  if (1 - n * r1 <= 0) return 0; // the bank has run out at date 1
  return r1 === 1 ? R : (R * (1 - n * r1)) / (1 - n);
}

/**
 * Expected utility of withdrawing early when a share n of all depositors does: r1 if the bank still has it, which with
 * a random place in the queue is a chance 1/(n r1) once n r1 > 1. From THETA_BAR up the bank can always pay r1.
 */
export const withdrawUtility = (theta, n, { r1, a }) => util(r1, a) * (theta >= THETA_BAR ? 1 : Math.min(1, 1 / (n * r1)));

/**
 * Expected utility of waiting. Below THETA_BAR the investment pays R with probability theta at date 2, or nothing;
 * from THETA_BAR up it returns R even when cashed in early, so those who wait get (R - n r1)/(1 - n) for sure.
 */
export function waitUtility(theta, n, p) {
  if (theta >= THETA_BAR) return util(n >= 1 ? Infinity : (p.R - n * p.r1) / (1 - n), p.a);
  return Math.min(1, Math.max(0, theta)) * util(lateAmount(n, p), p.a);
}

/** Goldstein and Pauzner's utility differential: waiting minus withdrawing. */
export const advantage = (theta, n, p) => waitUtility(theta, n, p) - withdrawUtility(theta, n, p);

/** Payment to waiters when only the impatient withdraw, (1 - lambda r1) R / (1 - lambda). */
export const r2 = (p) => lateAmount(p.lambda, p);

/** Below this chance of success waiting is worse even if only the impatient withdraw: a run is the only outcome. */
export function lowerBound(p) {
  return Math.min(THETA_BAR, util(p.r1, p.a) / util(r2(p), p.a));
}

/**
 * The tipping share under common knowledge: the share of all depositors withdrawing early at which a patient
 * depositor is indifferent. Waiting is better below it and withdrawing above. Returns 1 when waiting is better
 * at every share (no run is possible), and lambda when withdrawing is better even at lambda (a run is certain).
 * Closed form for this utility: theta u(c*) = u(r1), and (R - c*)/(R r1 - c*) is the share at which waiters get c*.
 */
export function tipping(theta, p) {
  const { R, r1, a, lambda } = p;
  if (theta >= THETA_BAR) return 1;
  const target = util(r1, a) / theta;
  if (!(target < 1)) return lambda; // even an unlimited payment, risked, is worth less than r1
  const cStar = -Math.log(1 - target) / a;
  if (cStar >= r2(p)) return lambda;
  if (r1 === 1) return 1; // waiters get R whatever the share, more than c*
  return Math.min(1 / r1, (R - cStar) / (R * r1 - cStar));
}

/** Gauss-Legendre rule with 8 points on each of `panels` pieces of [a, b]. */
const GL_X = [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
const GL_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
export function integrate(f, a, b, panels = 64) {
  if (!(b > a)) return 0;
  const h = (b - a) / panels;
  let s = 0;
  for (let k = 0; k < panels; k++) {
    const m = a + (k + 0.5) * h;
    for (let i = 0; i < 8; i++) s += GL_W[i] * f(m + (GL_X[i] * h) / 2);
  }
  return (s * h) / 2;
}
/** Integrate over [a, b] piece by piece between the given break points, where the integrand has kinks or jumps. */
export function integrateBroken(f, a, b, breaks, panels = 64) {
  const cuts = [a, ...breaks.filter((x) => x > a && x < b).sort((x, y) => x - y), b];
  let s = 0;
  for (let i = 0; i + 1 < cuts.length; i++) s += integrate(f, cuts[i], cuts[i + 1], panels);
  return s;
}

/**
 * Goldstein and Pauzner's threshold as the noise vanishes: a depositor at the threshold believes the share of
 * depositors withdrawing is uniform on [lambda, 1], so
 *   p(theta*) = (u(r1)/r1)(1 - lambda r1 + ln r1) / integral from lambda to 1/r1 of u(R (1 - r1 n)/(1 - n)) dn.
 * With p(theta) = theta this is theta*, capped at THETA_BAR.
 */
export function thresholdLimit(p) {
  const { r1, lambda, a } = p;
  const top = Math.min(1, 1 / r1);
  const denom = integrate((n) => util(lateAmount(n, p), a), lambda, top, 256);
  const num = (util(r1, a) / r1) * (1 - lambda * r1 + Math.log(r1));
  return Math.min(THETA_BAR, num / denom);
}

/** Share withdrawing early at fundamentals theta when patient depositors withdraw on signals below k. */
export function withdrawShare(theta, k, eps, lambda) {
  const run = Math.min(1, Math.max(0, (k - theta + eps) / (2 * eps)));
  return lambda + (1 - lambda) * run;
}

/**
 * The indifference of the threshold depositor for noise eps: with signal k, theta is uniform on [k - eps, k + eps],
 * and if everyone uses threshold k the share withdrawing is lambda + (1 - lambda)(k - theta + eps)/(2 eps), so the
 * share is uniform on [lambda, 1] and theta = k + eps - 2 eps (n - lambda)/(1 - lambda). F(k) is the average
 * advantage of waiting over that share; it rises with k.
 */
export function indifference(k, eps, p) {
  const { lambda, r1 } = p;
  const thetaOf = (n) => k + eps - (2 * eps * (n - lambda)) / (1 - lambda);
  const nBar = (k + eps - THETA_BAR) * (1 - lambda) / (2 * eps) + lambda; // where theta crosses THETA_BAR
  return integrateBroken((n) => advantage(thetaOf(n), n, p), lambda, 1, [1 / r1, nBar], 64) / (1 - lambda);
}

/** The equilibrium threshold for noise eps, by bisection on the indifference condition. */
export function threshold(p, eps) {
  let lo = eps, hi = THETA_BAR + eps;
  if (indifference(hi, eps, p) < 0) return hi;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (indifference(mid, eps, p) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The fundamentals below which the bank fails at date 1 (the share withdrawing passes 1/r1), for threshold k. From
 * THETA_BAR up it never fails, since its investment then fetches R > r1 a unit at once. Null when it can never fail.
 */
export function failurePoint(k, eps, p) {
  const { lambda, r1 } = p;
  if (r1 <= 1) return null; // the bank can always pay everyone r1 = 1 out of its investment
  const runShare = (1 / r1 - lambda) / (1 - lambda); // share of patient depositors running at which the bank fails
  return Math.min(THETA_BAR, k + eps - 2 * eps * runShare);
}

/** What happens at fundamentals theta with private signals of noise eps. */
export function noisyOutcome(theta, p, eps, k = threshold(p, eps)) {
  const n = withdrawShare(theta, k, eps, p.lambda);
  const top = theta >= THETA_BAR;
  return {
    k, n, patientRun: (n - p.lambda) / (1 - p.lambda),
    fails: !top && n * p.r1 > 1 + 1e-12,
    late: top ? (n >= 1 ? 0 : (p.R - n * p.r1) / (1 - n)) : lateAmount(n, p), // paid to each waiter if the investment pays off
  };
}

/**
 * Common knowledge: which equilibria exist at theta, and which one depositors' beliefs pick. Each patient depositor
 * expects a share of all depositors to withdraw drawn evenly from [belief - spread, belief + spread] (cut at 0 and 1)
 * and withdraws if that is above the tipping share (a depositor exactly at it waits). Then everyone sees the share
 * that withdrew and responds to it, until nothing changes.
 */
export function commonKnowledge(theta, p, belief, spread) {
  const lb = lowerBound(p);
  const nHat = tipping(theta, p);
  const runOnly = nHat <= p.lambda + 1e-15 && theta < THETA_BAR;
  const noRunOnly = nHat >= 1 || theta >= THETA_BAR;
  const above = spread > 0 ? Math.min(1, Math.max(0, (belief + spread - nHat) / (2 * spread))) : belief > nHat ? 1 : 0;
  const first = runOnly ? 1 : noRunOnly ? p.lambda : p.lambda + (1 - p.lambda) * above;
  const run = runOnly ? true : noRunOnly ? false : first > nHat;
  return { lb, nHat, runOnly, noRunOnly, both: !runOnly && !noRunOnly, firstRound: first, run, n: run ? 1 : p.lambda };
}

/** Diamond and Dybvig's best deposit contract when the investment is safe: u'(r1) = R u'(r2), solved for this utility. */
export function ddOptimal({ R, lambda, a }) {
  return (R - ((1 - lambda) * Math.log(R)) / a) / (1 - lambda + lambda * R);
}

/**
 * One bank with N depositors. Each is impatient with probability lambda. Under common knowledge each patient
 * depositor holds a belief as above and the rounds of responses run to a rest; with noisy signals each patient
 * depositor sees theta plus uniform noise and withdraws below the threshold k. Those who withdraw arrive in a
 * random order and are paid r1 each until the bank's investment, N units cashed in at 1 a unit (R from THETA_BAR
 * up), is gone. The rest earns R with probability theta and is shared by those who waited.
 */
export function simulateBank({ p, theta, N, seed, mode, eps, k, belief, spread }) {
  const g = rng(seed);
  const impatient = new Uint8Array(N);
  const withdraw = new Uint8Array(N);
  let nImp = 0;
  for (let i = 0; i < N; i++) if (g() < p.lambda) { impatient[i] = 1; nImp++; }
  const rounds = [];
  if (mode === "noisy") {
    for (let i = 0; i < N; i++) withdraw[i] = impatient[i] || theta + eps * (2 * g() - 1) < k ? 1 : 0;
  } else {
    const nHat = tipping(theta, p);
    const runOnly = nHat <= p.lambda + 1e-15 && theta < THETA_BAR;
    const noRunOnly = nHat >= 1 || theta >= THETA_BAR;
    const beliefs = new Float64Array(N);
    for (let i = 0; i < N; i++) beliefs[i] = Math.min(1, Math.max(0, belief + spread * (2 * g() - 1)));
    let expect = null;
    for (let r = 0; r < 20; r++) {
      let count = 0;
      for (let i = 0; i < N; i++) {
        const b = expect == null ? beliefs[i] : expect;
        withdraw[i] = impatient[i] || runOnly || (!noRunOnly && b > nHat) ? 1 : 0;
        count += withdraw[i];
      }
      const share = count / N;
      rounds.push(share);
      if (expect != null && share === expect) break;
      expect = share;
    }
  }
  // Sequential service in a random order of arrival.
  const queue = [];
  for (let i = 0; i < N; i++) if (withdraw[i]) queue.push(i);
  for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(g() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
  const early = theta >= THETA_BAR ? p.R : 1; // what one unit of investment fetches at date 1
  let units = N;
  const paid = new Float64Array(N);
  let served = 0;
  for (const i of queue) {
    const need = p.r1 / early;
    if (units >= need - 1e-12) { units -= need; paid[i] = p.r1; served++; }
    else { paid[i] = units * early; units = 0; }
  }
  const waiters = N - queue.length;
  const success = theta >= THETA_BAR ? true : g() < theta;
  const late = waiters > 0 ? (success ? (units * p.R) / waiters : 0) : 0;
  for (let i = 0; i < N; i++) if (!withdraw[i]) paid[i] = late;
  return {
    N, impatient, withdraw, paid, queue, served, rounds, success,
    share: queue.length / N, impatientShare: nImp / N,
    fails: units <= 1e-9 && queue.length > served,
    late, lateIfSuccess: waiters > 0 ? (units * p.R) / waiters : 0, unitsLeft: units,
  };
}

/** Banks at a row of fundamentals, one each, with noisy signals: the share that withdrew at each. */
export function sweep({ p, eps, k, N, seed, thetas }) {
  return thetas.map((theta, i) => {
    const b = simulateBank({ p, theta, N, seed: (seed + i * 7919) >>> 0, mode: "noisy", eps, k });
    return { theta, share: b.share, fails: b.fails };
  });
}
