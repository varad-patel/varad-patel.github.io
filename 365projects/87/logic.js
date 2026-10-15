// Day 87: Polling Error and House Effects. The model, with no DOM code.
// A hierarchical model of state and national polls with a house effect per pollster, fitted by Gibbs sampling;
// a check of the sampler on simulated pollsters with known leans; the forecast under correlated errors; and the
// polling errors of five elections.

import { rng, stats } from "../kit/kit.js";

export const YEARS = [2020, 2016];
export const ERROR_YEARS = [2004, 2008, 2012, 2016, 2020];
export const WEEKS = 9; // weeks 0 (the final week) to 8 (days 56 to 61)
export const PRIOR = { alphaMean: 50, alphaSd: 15, gammaSd: 5, tauA: 2, tauB: 2, sigmaA: 2, sigmaB: 2 };
export const DEFAULTS = { maxDays: 61, minPolls: 5, sweeps: 3000, burn: 500, seed: 1, adjust: true, total: 2.5, rho: 0.5, sims: 10000 };

export const twoParty = (d, r) => (100 * d) / (d + r);
export function samplingVar(dem, rep, n) {
  const p = dem / (dem + rep);
  return (1e4 * p * (1 - p)) / ((n * (dem + rep)) / 100);
}
export function parentIndex(E) {
  return E.units.map((u, i) => (u.includes("-") ? E.units.indexOf(u.split("-")[0]) : i));
}
export function nationalShare(res) {
  let d = 0, r = 0;
  for (let i = 0; i < 51; i++) { d += res.d[i]; r += res.r[i]; }
  return twoParty(d, r);
}

/** The polls of one cycle as model rows. keep(pollsterIndex, partisanCode) decides which are used. */
export function pollRows(E, year, { maxDays = 61, keep = () => true } = {}) {
  const out = [];
  for (const [u, p, days, n, dem, rep, part] of E.polls.cycles[String(year)].rows) {
    if (days > maxDays || !keep(p, part)) continue;
    out.push({ u, p, w: Math.min(WEEKS - 1, Math.floor(days / 7)), y: twoParty(dem, rep), s2: samplingVar(dem, rep, n), part });
  }
  return out;
}

/** How many polls each pollster has in a cycle (all polls, before any choice). */
export function pollsterCounts(E, year, maxDays = 61) {
  const c = new Map();
  for (const r of E.polls.cycles[String(year)].rows) if (r[2] <= maxDays) c.set(r[1], (c.get(r[1]) || 0) + 1);
  return c;
}

/**
 * Gibbs sampler for  y_i = alpha_place + gamma_week + h_pollster + e_i,  e_i ~ N(0, s2_i + sigma^2),
 * alpha ~ N(50, 15^2), gamma_0 = 0 and gamma_w ~ N(0, 5^2), h ~ N(0, tau^2), tau^2 ~ InvGamma(2, 2),
 * sigma^2 ~ InvGamma(2, 2) (updated by a random-walk Metropolis step on log sigma^2). With adjust false the house
 * effects are held at zero. Runs in slices: step(n). The data identify only differences between pollsters, so each
 * draw is reported relative to the average poll: h_p minus the poll-weighted mean of h, and the levels plus that
 * mean, which leaves every alpha + h, and so the fit, unchanged.
 */
export function sampler(rows, { sweeps = 3000, burn = 500, seed = 1, adjust = true, prior = PRIOR } = {}) {
  const r = rng(seed);
  const places = [...new Set(rows.map((x) => x.u))].sort((a, b) => a - b);
  const pollsters = [...new Set(rows.map((x) => x.p))].sort((a, b) => a - b);
  const U = new Map(places.map((u, k) => [u, k])), P = new Map(pollsters.map((p, k) => [p, k]));
  const N = rows.length;
  const ui = Int32Array.from(rows, (x) => U.get(x.u)), pi = Int32Array.from(rows, (x) => P.get(x.p)), wi = Int32Array.from(rows, (x) => x.w);
  const y = Float64Array.from(rows, (x) => x.y), s2 = Float64Array.from(rows, (x) => x.s2);
  const alpha = new Float64Array(places.length), gamma = new Float64Array(WEEKS), h = new Float64Array(pollsters.length);
  for (let k = 0; k < places.length; k++) { let s = 0, c = 0; for (let i = 0; i < N; i++) if (ui[i] === k) { s += y[i]; c++; } alpha[k] = c ? s / c : 50; }
  let tau2 = 1, sigma2 = 2, accepted = 0;
  const keep = Math.max(0, sweeps - burn);
  const draws = { h: [], alpha: [], tau: new Float64Array(keep), sigma: new Float64Array(keep) };
  const perPollster = new Float64Array(pollsters.length);
  for (let i = 0; i < N; i++) perPollster[pi[i]]++;
  const prec = new Float64Array(Math.max(places.length, pollsters.length, WEEKS)), sum = new Float64Array(prec.length);
  let done = 0;
  const loglik = (sg2) => {
    let s = 0;
    for (let i = 0; i < N; i++) { const v = s2[i] + sg2, e = y[i] - alpha[ui[i]] - gamma[wi[i]] - h[pi[i]]; s += -0.5 * Math.log(v) - (0.5 * e * e) / v; }
    return s;
  };
  const sweep = () => {
    // Levels of opinion in each place (in the final week, for the average pollster).
    prec.fill(0, 0, places.length); sum.fill(0, 0, places.length);
    for (let i = 0; i < N; i++) { const v = s2[i] + sigma2; prec[ui[i]] += 1 / v; sum[ui[i]] += (y[i] - gamma[wi[i]] - h[pi[i]]) / v; }
    for (let k = 0; k < places.length; k++) {
      const pr = prec[k] + 1 / prior.alphaSd ** 2;
      alpha[k] = (sum[k] + prior.alphaMean / prior.alphaSd ** 2) / pr + r.normal() / Math.sqrt(pr);
    }
    // Weekly movement shared by every place; the final week is the reference.
    prec.fill(0, 0, WEEKS); sum.fill(0, 0, WEEKS);
    for (let i = 0; i < N; i++) { const v = s2[i] + sigma2; prec[wi[i]] += 1 / v; sum[wi[i]] += (y[i] - alpha[ui[i]] - h[pi[i]]) / v; }
    for (let w = 1; w < WEEKS; w++) { const pr = prec[w] + 1 / prior.gammaSd ** 2; gamma[w] = sum[w] / pr + r.normal() / Math.sqrt(pr); }
    if (adjust) {
      prec.fill(0, 0, pollsters.length); sum.fill(0, 0, pollsters.length);
      for (let i = 0; i < N; i++) { const v = s2[i] + sigma2; prec[pi[i]] += 1 / v; sum[pi[i]] += (y[i] - alpha[ui[i]] - gamma[wi[i]]) / v; }
      let ss = 0;
      for (let k = 0; k < pollsters.length; k++) { const pr = prec[k] + 1 / tau2; h[k] = sum[k] / pr + r.normal() / Math.sqrt(pr); ss += h[k] * h[k]; }
      tau2 = invGamma(r, prior.tauA + pollsters.length / 2, prior.tauB + ss / 2);
    }
    // Non-sampling noise: Metropolis on log sigma^2 with an InvGamma prior (the Jacobian adds log sigma^2).
    const prop = Math.exp(Math.log(sigma2) + 0.25 * r.normal());
    const lp = (sg2) => -(prior.sigmaA + 1) * Math.log(sg2) - prior.sigmaB / sg2 + Math.log(sg2);
    if (Math.log(r()) < loglik(prop) + lp(prop) - loglik(sigma2) - lp(sigma2)) { sigma2 = prop; accepted++; }
    if (done >= burn) {
      const k = done - burn;
      let mh = 0;
      if (adjust) { for (let k = 0; k < pollsters.length; k++) mh += perPollster[k] * h[k]; mh /= N; }
      draws.h.push(Float64Array.from(h, (v) => v - mh));
      draws.alpha.push(Float64Array.from(alpha, (v) => v + mh));
      draws.tau[k] = Math.sqrt(tau2);
      draws.sigma[k] = Math.sqrt(sigma2);
    }
    done++;
  };
  return {
    places, pollsters, draws, get done() { return done; }, sweeps,
    step(n) { for (let k = 0; k < n && done < sweeps; k++) sweep(); return done; },
    get acceptance() { return done ? accepted / done : NaN; },
  };
}

/** Inverse-gamma draw: 1 / Gamma(shape a, rate b), with Marsaglia and Tsang's method. */
export function invGamma(r, a, b) { return b / gammaDraw(r, a); }
export function gammaDraw(r, a) {
  if (a < 1) return gammaDraw(r, a + 1) * r() ** (1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = r.normal(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Posterior summaries from a finished sampler: mean and 90% interval of each house effect and level. */
export function summary(s) {
  const K = s.draws.h.length;
  const col = (arr, j) => Float64Array.from(arr, (d) => d[j]).sort();
  const q = (sorted, x) => sorted[Math.min(K - 1, Math.max(0, Math.round(x * (K - 1))))];
  const house = s.pollsters.map((p, j) => { const c = col(s.draws.h, j); return { pollster: p, mean: stats.mean(c), lo: q(c, 0.05), hi: q(c, 0.95) }; });
  const level = s.places.map((u, j) => { const c = col(s.draws.alpha, j); return { place: u, mean: stats.mean(c), sd: stats.sd(c) }; });
  return { house, level, tau: stats.mean(s.draws.tau), sigma: stats.mean(s.draws.sigma), draws: K };
}

/** "Leans" only when the whole 90% interval is on one side of zero. */
export function lean(h) {
  if (h.lo > 0) return "leans Democratic";
  if (h.hi < 0) return "leans Republican";
  return "no clear lean";
}

/**
 * State estimates for the forecast: the fitted level where a unit has polls; elsewhere last election's share moved
 * by the average swing of the polled states. Returns mean and sd for every unit.
 */
export function unitEstimates(E, year, sum) {
  const prev = E.results[String(year - 4)];
  const levels = new Map(sum.level.map((l) => [l.place, l]));
  const prevShare = E.units.map((_, i) => twoParty(prev.d[i], prev.r[i]));
  const swings = E.units.map((_, i) => (levels.has(i) && i < 51 ? levels.get(i).mean - prevShare[i] : null)).filter((v) => v != null);
  const swing = swings.length ? stats.mean(swings) : 0;
  return E.units.map((u, i) => (levels.has(i) ? { mean: levels.get(i).mean, sd: levels.get(i).sd, polled: true } : { mean: prevShare[i] + swing, sd: 3, polled: false }));
}

/**
 * Correlated errors. Each simulated election draws a national error (sd total * sqrt(rho)) and a state error
 * (sd total * sqrt(1 - rho)) shared by the state's districts, plus half a state error per district and each unit's own
 * uncertainty. The same random numbers are used for every rho, so the curve is smooth.
 */
export function simulate(E, year, est, { total, rho, sims, seed = 1 }) {
  const n = E.units.length, parent = parentIndex(E), ev = E.results[String(year)].ev;
  const r = rng(seed);
  const nat = total * Math.sqrt(rho), st = total * Math.sqrt(1 - rho);
  const evD = new Int16Array(sims);
  const winsD = new Float64Array(n);
  const se = new Float64Array(51);
  for (let k = 0; k < sims; k++) {
    const zn = nat * r.normal();
    for (let j = 0; j < 51; j++) se[j] = st * r.normal();
    let e = 0;
    for (let i = 0; i < n; i++) {
      let x = est[i].mean + est[i].sd * r.normal() + zn + se[parent[i]];
      if (parent[i] !== i) x += 0.5 * st * r.normal();
      if (x > 50) { e += ev[i]; winsD[i]++; }
    }
    evD[k] = e;
  }
  const sorted = Float64Array.from(evD).sort();
  const count = (f) => { let c = 0; for (const v of evD) if (f(v)) c++; return c / sims; };
  return { winD: count((v) => v >= 270), winR: count((v) => v <= 268), tie: count((v) => v === 269), median: sorted[Math.floor(sims / 2)], lo: sorted[Math.floor(0.1 * sims)], hi: sorted[Math.floor(0.9 * sims)], evD, p: Array.from(winsD, (w) => w / sims) };
}

/* ---------------------------------------------------------------- simulated pollsters */

/**
 * Fake polls with the same places, weeks, pollsters and sample sizes as the real ones, but known truth: each place's
 * level is its actual result, the weekly movement is drawn N(0, 1), each pollster's lean N(0, tau^2), and each poll
 * adds sampling noise and N(0, sigma^2).
 */
export function fakeRows(E, year, rows, { tau = 1.5, sigma = 1.5, seed = 7 } = {}) {
  const r = rng(seed), res = E.results[String(year)];
  const nat = nationalShare(res);
  const truthLevel = (u) => (u < E.units.length ? twoParty(res.d[u], res.r[u]) : nat);
  const gamma = Array.from({ length: WEEKS }, (_, w) => (w === 0 ? 0 : r.normal()));
  const ps = [...new Set(rows.map((x) => x.p))].sort((a, b) => a - b);
  const hTrue = new Map(ps.map((p) => [p, tau * r.normal()]));
  const fake = rows.map((x) => ({ ...x, y: truthLevel(x.u) + gamma[x.w] + hTrue.get(x.p) + Math.sqrt(x.s2 + sigma * sigma) * r.normal() }));
  return { rows: fake, hTrue };
}

/** How well a fit recovered known leans: error, slope, and how often the 90% interval held the truth. */
export function recovery(sum, hTrue, counts, minPolls = 1) {
  // The truth on the same footing as the estimates: relative to the average poll.
  let mTrue = 0, n = 0;
  for (const [p, c] of counts) if (hTrue.has(p)) { mTrue += c * hTrue.get(p); n += c; }
  mTrue /= n;
  const items = sum.house.filter((h) => (counts.get(h.pollster) || 0) >= minPolls).map((h) => ({ ...h, truth: hTrue.get(h.pollster) - mTrue }));
  const err = items.map((i) => i.mean - i.truth);
  return {
    n: items.length,
    rmse: Math.sqrt(stats.mean(err.map((e) => e * e))),
    coverage: items.filter((i) => i.lo <= i.truth && i.truth <= i.hi).length / items.length,
    slope: stats.linreg(items.map((i) => i.truth), items.map((i) => i.mean)).slope,
    items,
  };
}

/* ---------------------------------------------------------------- polling error over five elections */

/**
 * Average poll error by state in one election: the mean two-party share of the polls whose fieldwork's middle was in
 * the final `days` days, minus the result. States with fewer than minPolls such polls are left out.
 */
export function stateErrors(E, year, { days = 21, minPolls = 3 } = {}) {
  const res = E.results[String(year)];
  const by = new Map();
  for (const [u, , d, , dem, rep] of E.polls.cycles[String(year)].rows) {
    if (u >= 51 || d > days) continue; // states and DC only
    if (!by.has(u)) by.set(u, []);
    by.get(u).push(twoParty(dem, rep));
  }
  const out = [];
  for (const [u, ys] of by) if (ys.length >= minPolls) out.push({ unit: u, polls: ys.length, poll: stats.mean(ys), result: twoParty(res.d[u], res.r[u]), error: stats.mean(ys) - twoParty(res.d[u], res.r[u]) });
  out.sort((a, b) => a.unit - b.unit);
  const common = stats.mean(out.map((o) => o.error));
  return { year, states: out, common, spread: stats.sd(out.map((o) => o.error - common)) };
}

/** Regularised lower incomplete gamma function P(a, x) (series below a + 1, continued fraction above). */
export function gammaP(a, x) {
  if (x <= 0) return 0;
  const lg = stats.logGamma(a);
  if (x < a + 1) {
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 500; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * 1e-15) break; }
    return sum * Math.exp(-x + a * Math.log(x) - lg);
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, f = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    f *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lg) * f;
}

/** Quantile of the chi-square distribution with k degrees of freedom, by bisection. */
export function chiSquareQuantile(p, k) {
  let lo = 0, hi = Math.max(10, k * 10);
  while (gammaP(k / 2, hi / 2) < p) hi *= 2;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (gammaP(k / 2, mid / 2) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/**
 * What the elections say about correlated error. The shared error of each election is one draw; with k elections its
 * standard deviation is estimated by the root mean square (assuming no bias on average) with a chi-square interval
 * on k degrees of freedom. The state-by-state spread is pooled across elections. rho = shared variance / total.
 */
export function errorStructure(cycles, level = 0.9) {
  const k = cycles.length;
  const sNat = Math.sqrt(stats.mean(cycles.map((c) => c.common ** 2)));
  const a = (1 - level) / 2;
  const natLo = sNat * Math.sqrt(k / chiSquareQuantile(1 - a, k)), natHi = sNat * Math.sqrt(k / chiSquareQuantile(a, k));
  let ss = 0, df = 0;
  for (const c of cycles) { ss += c.spread ** 2 * (c.states.length - 1); df += c.states.length - 1; }
  const sState = Math.sqrt(ss / df);
  const rho = (s) => (s * s) / (s * s + sState * sState);
  return { k, sNat, natLo, natHi, sState, df, rho: rho(sNat), rhoLo: rho(natLo), rhoHi: rho(natHi) };
}

/** Correlation across states between two elections' state deviations (error minus that election's shared error). */
export function persistence(a, b) {
  const da = new Map(a.states.map((s) => [s.unit, s.error - a.common]));
  const pairs = b.states.filter((s) => da.has(s.unit)).map((s) => [da.get(s.unit), s.error - b.common]);
  const n = pairs.length;
  const r = stats.corr(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
  // Fisher's z gives a 90% interval.
  const z = Math.atanh(r), se = 1 / Math.sqrt(n - 3);
  return { n, r, lo: Math.tanh(z - 1.6449 * se), hi: Math.tanh(z + 1.6449 * se) };
}
