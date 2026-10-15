// Day 74: Central Bank Simulator. The model, with no DOM code.
// The basic New Keynesian model (Galí 2015, chapter 3) in quarterly rates: a dynamic IS curve, a New Keynesian
// Phillips curve with a cost-push shock, and a nominal interest rate that the player sets each quarter.

import { rng } from "../kit/kit.js";

/* ---------- parameters ---------- */

/**
 * Galí's baseline calibration (second edition, chapter 3, as listed in his chapter 3 slides of June 2015):
 * sigma = 1, phi (inverse Frisch elasticity) = 5, beta = 0.99, epsilon = 9, alpha = 1/4, theta = 3/4, and the
 * Taylor-type rule phi_pi = 1.5, phi_y = 0.5/4. The shock processes below are this page's choices for the game.
 */
export const GALI = { sigma: 1, phi: 5, beta: 0.99, epsilon: 9, alpha: 0.25, theta: 0.75, phiPi: 1.5, phiY: 0.125 };

/** kappa = lambda (sigma + (phi + alpha) / (1 - alpha)), lambda = (1 - theta)(1 - beta theta) / theta x (1 - alpha) / (1 - alpha + alpha epsilon). */
export function slope(p = GALI) {
  const Theta = (1 - p.alpha) / (1 - p.alpha + p.alpha * p.epsilon);
  const lambda = ((1 - p.theta) * (1 - p.beta * p.theta)) / p.theta * Theta;
  return { lambda, kappa: lambda * (p.sigma + (p.phi + p.alpha) / (1 - p.alpha)) };
}

/** Steady state, in percent a year: the inflation target and the neutral nominal rate 400 (-ln beta) + target. */
export const TARGET = 2;
export const neutralRate = (p = GALI) => -400 * Math.log(p.beta) + TARGET;

/** Weight on the squared output gap in the loss when inflation is in percent a year: 16 kappa / epsilon (Galí 2008, ch. 4, rescaled). */
export const welfareWeight = (p = GALI) => (16 * slope(p).kappa) / p.epsilon;

/* ---------- small linear algebra ---------- */

const solve2 = ([[a, b], [c, d]], [e, f]) => { const det = a * d - b * c; return [(d * e - b * f) / det, (a * f - c * e) / det]; };
/** Eigenvalues of a 2 x 2 real matrix as { re, im } pairs. */
export function eig2([[a, b], [c, d]]) {
  const tr = a + d, det = a * d - b * c, disc = (tr * tr) / 4 - det;
  if (disc >= 0) { const s = Math.sqrt(disc); return [{ re: tr / 2 + s, im: 0 }, { re: tr / 2 - s, im: 0 }]; }
  const s = Math.sqrt(-disc);
  return [{ re: tr / 2, im: s }, { re: tr / 2, im: -s }];
}
const modulus = (z) => Math.hypot(z.re, z.im);

/* ---------- the model under an interest rate rule ---------- */

/**
 * With i = phiPi pi + phiY y + v, the model is z_t = A E_t z_{t+1} + B_r r_t + B_u u_t + B_v v_t for z = (y, pi):
 *   A = Omega [[sigma, 1 - beta phiPi], [sigma kappa, kappa + beta (sigma + phiY)]], Omega = 1 / (sigma + phiY + kappa phiPi)
 *   B_r = Omega [1, kappa], B_u = Omega [-phiPi, sigma + phiY], B_v = -B_r
 * where r is the natural rate of interest, u a cost-push shock and v a monetary policy shock (all deviations, quarterly).
 */
export function system(rule, p = GALI) {
  const { kappa } = slope(p);
  const { phiPi, phiY } = rule;
  const O = 1 / (p.sigma + phiY + kappa * phiPi);
  return {
    kappa,
    A: [[O * p.sigma, O * (1 - p.beta * phiPi)], [O * p.sigma * kappa, O * (kappa + p.beta * (p.sigma + phiY))]],
    B: { r: [O, O * kappa], u: [-O * phiPi, O * (p.sigma + phiY)], v: [-O, -O * kappa] },
  };
}

/** Bullard and Mitra's condition for a unique bounded equilibrium: kappa (phiPi - 1) + (1 - beta) phiY > 0. */
export const determinacyIndex = (rule, p = GALI) => slope(p).kappa * (rule.phiPi - 1) + (1 - p.beta) * rule.phiY;

/** The same question answered from the eigenvalues: unique if both eigenvalues of A lie inside the unit circle. */
export function determinacy(rule, p = GALI) {
  const { A } = system(rule, p);
  const ev = eig2(A);
  return { unique: ev.every((z) => modulus(z) < 1), eigenvalues: ev, moduli: ev.map(modulus), index: determinacyIndex(rule, p) };
}

/**
 * Minimum-state-variable solution for an AR(1) shock s_t = rho s_{t-1} + e_t entering through B: z_t = psi s_t with
 * psi = (I - rho A)^-1 B. When the equilibrium is unique this is it; when it is not, it is one of many.
 */
export function msv(rule, shock, rho, p = GALI) {
  const { A, B } = system(rule, p);
  return solve2([[1 - rho * A[0][0], -rho * A[0][1]], [-rho * A[1][0], 1 - rho * A[1][1]]], B[shock]);
}

/** Closed form for a monetary policy shock (Galí, chapter 3): y = -(1 - beta rho) Lambda v, pi = -kappa Lambda v. */
export function monetaryClosedForm(rule, rho, p = GALI) {
  const { kappa } = slope(p);
  const L = 1 / ((1 - p.beta * rho) * (p.sigma * (1 - rho) + rule.phiY) + kappa * (rule.phiPi - rho));
  return { y: -(1 - p.beta * rho) * L, pi: -kappa * L };
}

/**
 * The common denominator of every undetermined-coefficients solution, 1 / Lambda in Galí's closed form:
 * (1 - beta rho)(sigma (1 - rho) + phiY) + kappa (phiPi - rho). It is zero exactly when rho is the reciprocal of a
 * root of A, which can happen only when the equilibrium is not unique (that root lies outside the unit circle).
 */
export function msvDenominator(rule, rho, p = GALI) {
  const { kappa } = slope(p);
  const a = (1 - p.beta * rho) * (p.sigma * (1 - rho) + rule.phiY), b = kappa * (rule.phiPi - rho);
  return { value: a + b, scale: Math.abs(a) + Math.abs(b) };
}

/**
 * Responses to a one-time innovation of `size` (quarterly percent) in shock `shock` with persistence rho, over
 * `quarters` quarters: output gap (%), inflation and the nominal rate (percent a year, deviations from steady state).
 * Null when no solution of this simple form exists (rho is the reciprocal of a root of A; see msvDenominator).
 */
export function impulse(rule, shock, rho, size = 0.25, quarters = 16, p = GALI) {
  const D = msvDenominator(rule, rho, p);
  if (Math.abs(D.value) <= 1e-9 * D.scale) return null;
  const [py, ppi] = msv(rule, shock, rho, p);
  return Array.from({ length: quarters }, (_, t) => {
    const s = size * rho ** t;
    const y = py * s, pi = ppi * s, v = shock === "v" ? s : 0;
    return { t, y, pi: 4 * pi, i: 4 * (rule.phiPi * pi + rule.phiY * y + v), shock: 4 * s };
  });
}

/**
 * When the rule leaves the equilibrium undetermined, A has an eigenvalue outside the unit circle, so A^-1 has one
 * inside it and z_{t+1} = A^-1 z_t is a bounded path that satisfies the model with no shock at all: a self-fulfilling
 * change in expectations. Returns that path scaled so inflation starts 1 point a year above target, or null when
 * the equilibrium is unique (every such path explodes) or the stable root is complex.
 */
export function sunspot(rule, quarters = 16, p = GALI) {
  const d = determinacy(rule, p);
  if (d.unique) return null;
  const { A } = system(rule, p);
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const Ainv = [[A[1][1] / det, -A[0][1] / det], [-A[1][0] / det, A[0][0] / det]];
  const ev = eig2(Ainv).filter((z) => z.im === 0 && Math.abs(z.re) < 1).sort((a, b) => Math.abs(a.re) - Math.abs(b.re));
  if (!ev.length) return null;
  const mu = ev.at(-1).re; // the slowest-decaying stable root
  // Eigenvector of Ainv for mu: (Ainv - mu I) v = 0.
  let v = Math.abs(Ainv[0][1]) > 1e-12 ? [Ainv[0][1], mu - Ainv[0][0]] : [mu - Ainv[1][1], Ainv[1][0]];
  if (Math.abs(v[1]) < 1e-12) return null;
  const scale = 0.25 / v[1]; // inflation 0.25 quarterly = 1 point a year
  v = [v[0] * scale, v[1] * scale];
  return { mu, path: Array.from({ length: quarters }, (_, t) => { const y = v[0] * mu ** t, pi = v[1] * mu ** t; return { t, y, pi: 4 * pi, i: 4 * (rule.phiPi * pi + rule.phiY * y) }; }) };
}

/* ---------- the game ---------- */

/**
 * Shock processes for the game: the natural rate r and the cost-push shock u, AR(1), sizes in quarterly percent (this
 * page's choice), and the persistence the public expects of the player's departures from the rule, rho_v = 0.5
 * (Galí's calibration of the monetary policy shock).
 */
export const SHOCKS = { r: { rho: 0.8, sd: 0.1 }, u: { rho: 0.5, sd: 0.06 }, v: { rho: 0.5 } };
/** The rule the public measures the player against: Galí's calibration (Taylor's weights in quarterly units). */
export const EXPECTED_RULE = { phiPi: GALI.phiPi, phiY: GALI.phiY };
export const QUARTERS = 16;

/** The shocks of one game: the same seed always gives the same quarters. */
export function shockPath(seed, quarters = QUARTERS, shocks = SHOCKS) {
  const g = rng(seed);
  let r = 0, u = 0;
  const out = [];
  for (let t = 0; t < quarters; t++) {
    r = shocks.r.rho * r + g.normal(0, shocks.r.sd);
    u = shocks.u.rho * u + g.normal(0, shocks.u.sd);
    out.push({ r, u });
  }
  return out;
}

/**
 * One quarter. The public sees this quarter's shocks r and u and the player's rate, and reads the gap between the
 * rate and the rule, v = i - phiPi pi - phiY y, as a monetary policy shock it expects to shrink by rho_v a quarter.
 * The equilibrium is then the model's own solution under the rule with three AR(1) shocks:
 *   y = psi_y^r r + psi_y^u u + psi_y^v v,   pi = psi_pi^r r + psi_pi^u u + psi_pi^v v,
 * and v is the value that makes phiPi pi + phiY y + v equal the player's rate:
 *   v = (i - phiPi (psi_pi^r r + psi_pi^u u) - phiY (psi_y^r r + psi_y^u u)) / (1 + phiPi psi_pi^v + phiY psi_y^v).
 * Inflation and the rate are returned in percent a year (levels), the output gap in percent.
 */
export function quarter(rate, s, p = GALI, shocks = SHOCKS, rule = EXPECTED_RULE) {
  const pr = msv(rule, "r", shocks.r.rho, p), pu = msv(rule, "u", shocks.u.rho, p), pv = msv(rule, "v", shocks.v.rho, p);
  const i = (rate - neutralRate(p)) / 4;
  const y0 = pr[0] * s.r + pu[0] * s.u, pi0 = pr[1] * s.r + pu[1] * s.u;
  const v = (i - rule.phiPi * pi0 - rule.phiY * y0) / (1 + rule.phiPi * pv[1] + rule.phiY * pv[0]);
  const y = y0 + pv[0] * v, pi = pi0 + pv[1] * v;
  return { rate, inflation: TARGET + 4 * pi, gap: y, v };
}

/**
 * Last quarter's shocks, read back from its figures: the outcome is linear in (r, u) for a given rate, so two figures
 * (inflation and the output gap) pin down the two shocks. This is how a player who knew the model could recover them.
 */
export function inferShocks(o, p = GALI, shocks = SHOCKS) {
  const base = quarter(o.rate, { r: 0, u: 0 }, p, shocks), ar = quarter(o.rate, { r: 1, u: 0 }, p, shocks), au = quarter(o.rate, { r: 0, u: 1 }, p, shocks);
  const m = [[ar.gap - base.gap, au.gap - base.gap], [ar.inflation - base.inflation, au.inflation - base.inflation]];
  const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
  const gy = o.gap - base.gap, gp = o.inflation - base.inflation;
  return { r: (m[1][1] * gy - m[0][1] * gp) / det, u: (m[0][0] * gp - m[1][0] * gy) / det };
}

/** How much one point a year on the rate moves this quarter's annual inflation and output gap (the model is linear). */
export function rateEffect(p = GALI, shocks = SHOCKS) {
  const a = quarter(neutralRate(p), { r: 0, u: 0 }, p, shocks), b = quarter(neutralRate(p) + 1, { r: 0, u: 0 }, p, shocks);
  return { inflation: b.inflation - a.inflation, gap: b.gap - a.gap };
}

/** Loss in one quarter: (inflation - 2)^2 + w (output gap)^2, inflation in percent a year, gap in percent. */
export const loss = (o, w = welfareWeight()) => (o.inflation - TARGET) ** 2 + w * o.gap ** 2;

/** Rates are set in steps of a quarter point between 0 and 12% a year. */
export const RATE = { min: 0, max: 12, step: 0.25 };
export const clampRate = (x) => Math.min(RATE.max, Math.max(RATE.min, x));
/** The nearest rate the player could choose: a whole number of quarter points from 0 to 12. */
export const toStep = (x) => clampRate(Math.round(x / RATE.step) * RATE.step);

/**
 * The best rate given last quarter's shocks (which the data reveal) and a perfect knowledge of the model: it
 * minimises the expected loss, and because this quarter's surprises enter linearly and do not depend on the rate,
 * that is the rate that minimises the loss at the expected shocks (certainty equivalence). Not rounded to a step.
 */
export function bestRate(prev, p = GALI, shocks = SHOCKS, w = welfareWeight(p)) {
  const expected = { r: shocks.r.rho * prev.r, u: shocks.u.rho * prev.u };
  // At the neutral rate the expected outcome is (cy, cpi); each point a year on the rate moves them by (dy, dpi).
  const o = quarter(neutralRate(p), expected, p, shocks);
  const { inflation: dpi, gap: dy } = rateEffect(p, shocks);
  const cy = o.gap, cpi = o.inflation - TARGET;
  const step = -(cpi * dpi + w * cy * dy) / (dpi * dpi + w * dy * dy);
  return neutralRate(p) + step;
}

/** The rate the public's rule would set this quarter: the equilibrium with no policy shock (v = 0). It needs this quarter's figures. */
export function ruleRate(s, p = GALI, shocks = SHOCKS, rule = EXPECTED_RULE) {
  const pr = msv(rule, "r", shocks.r.rho, p), pu = msv(rule, "u", shocks.u.rho, p);
  return neutralRate(p) + 4 * (rule.phiPi * (pr[1] * s.r + pu[1] * s.u) + rule.phiY * (pr[0] * s.r + pu[0] * s.u));
}

/** Strategies the player is compared with, each played on the same shocks: rate(history, last quarter's shocks, this quarter's). */
export const STRATEGIES = {
  neutral: { label: "Hold 6%, the step nearest the neutral rate", short: "Hold 6%", rate: () => toStep(neutralRate()) },
  best: { label: "The best possible with last quarter's figures", short: "Best possible, last quarter's figures", rate: (hist, prev) => toStep(bestRate(prev)) },
  rule: { label: "The public's rule, with this quarter's figures", short: "Public's rule, this quarter's figures", rate: (hist, prev, now) => ruleRate(now) },
};

/** Play a whole game with a strategy: rate(history, previous shocks) -> rate. Returns the quarters and the average loss. */
export function play(path, strategy, w = welfareWeight()) {
  if (typeof strategy !== "function") strategy = STRATEGIES[strategy].rate;
  const hist = [{ rate: neutralRate(), inflation: TARGET, gap: 0 }];
  let prev = { r: 0, u: 0 };
  const rows = [];
  for (const s of path) {
    const o = quarter(strategy(hist, prev, s), s);
    rows.push({ ...o, loss: loss(o, w) });
    hist.push(o);
    prev = s;
  }
  return { rows, average: rows.reduce((a, r) => a + r.loss, 0) / rows.length };
}

/** Score summary: the player's average loss against each strategy's, and which were beaten (strictly lower). */
export function verdict(playerAverage, others) {
  const beaten = Object.entries(others).filter(([, v]) => playerAverage < v.average - 1e-12).map(([k]) => k);
  const tied = Object.entries(others).filter(([, v]) => Math.abs(playerAverage - v.average) <= 1e-12).map(([k]) => k);
  return { beaten, tied };
}
