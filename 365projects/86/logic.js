// Day 86: Election Forecast Model. The model, with no DOM code.
// Bayesian aggregation of state polls around a uniform-swing prior, then Monte Carlo over correlated polling
// errors, scored against the result.

import { rng, stats } from "../kit/kit.js";

export const YEARS = [2020, 2016];
export const LAG = 2; // a poll counts from two days after the middle of its fieldwork
export const POLL_NOISE = 1.5; // non-sampling poll noise, points of two-party share (one standard deviation)
export const DEFAULTS = { daysBefore: 0, natSd: 1.5, stateSd: 1.5, tails: "normal", drift: 1, tau: 3, halfLife: 14, sims: 20000, seed: 1 };
const T_DF = 5;
const T_SCALE = Math.sqrt((T_DF - 2) / T_DF); // a t(5) draw times this has variance 1

/** The Democrat's share of the two-party vote, in percent. */
export const twoParty = (d, r) => (100 * d) / (d + r);

/** Variance, in points squared, of a poll's two-party share from sampling alone. */
export function samplingVar(dem, rep, n) {
  const p = dem / (dem + rep);
  const nEff = (n * (dem + rep)) / 100; // only respondents who chose one of the two count
  return (1e4 * p * (1 - p)) / nEff;
}

/** Index of the state a unit belongs to (a district's state, or the unit itself). */
export function parentIndex(E) {
  return E.units.map((u, i) => (u.includes("-") ? E.units.indexOf(u.split("-")[0]) : i));
}

/** National two-party share from the states' votes (districts are inside their states). */
export function nationalShare(res) {
  let d = 0, r = 0;
  for (let i = 0; i < 51; i++) { d += res.d[i]; r += res.r[i]; }
  return twoParty(d, r);
}

/** Polls known on the forecast day, with their age in days and their two-party share and variance. */
export function usablePolls(E, year, daysBefore, { lag = LAG, noise = POLL_NOISE } = {}) {
  const c = E.polls.cycles[String(year)];
  const out = [];
  for (const [place, pollster, days, n, dem, rep] of c.rows) {
    if (days < daysBefore + lag) continue;
    out.push({ place, pollster, age: days - daysBefore, n, y: twoParty(dem, rep), v: samplingVar(dem, rep, n) + noise * noise });
  }
  return out;
}

/** Recency weight: halves every halfLife days. */
export const weight = (age, halfLife) => 0.5 ** (age / halfLife);

/**
 * The aggregation for one forecast. For each unit: prior mean = last election's two-party share plus the swing in
 * the national polls since then, prior variance tau^2; each poll adds w / v to the precision.
 */
export function aggregate(E, year, { daysBefore = 0, tau = DEFAULTS.tau, halfLife = DEFAULTS.halfLife, statePolls = true } = {}) {
  const prev = E.results[String(year - 4)], units = E.units, US = E.polls.places.indexOf("US");
  const polls = usablePolls(E, year, daysBefore);
  // National swing: the recency-weighted precision-weighted average of the national polls, minus last time's share.
  let sw = 0, sy = 0, nat = 0;
  for (const p of polls) if (p.place === US) { const w = weight(p.age, halfLife) / p.v; sw += w; sy += w * p.y; nat++; }
  const prevNat = nationalShare(prev);
  const swing = sw > 0 ? sy / sw - prevNat : 0;
  const V0 = tau * tau;
  const rows = units.map((u, i) => {
    const prior = twoParty(prev.d[i], prev.r[i]) + swing;
    return { unit: u, prior, precision: 1 / V0, sum: prior / V0, polls: 0, effective: 0 };
  });
  if (statePolls) {
    for (const p of polls) {
      if (p.place === US) continue;
      const w = weight(p.age, halfLife);
      const r = rows[p.place];
      r.precision += w / p.v;
      r.sum += (w * p.y) / p.v;
      r.polls++;
      r.effective += w;
    }
  }
  for (const r of rows) { r.mean = r.sum / r.precision; r.sd = Math.sqrt(1 / r.precision); }
  return { year, daysBefore, swing, prevNat, nationalPolls: nat, polls: polls.length, units: rows };
}

/** Draw a unit-variance error: normal, or Student's t with 5 degrees of freedom scaled to variance 1. */
export function drawError(r, tails) {
  if (tails !== "fat") return r.normal();
  let chi = 0;
  for (let k = 0; k < T_DF; k++) { const z = r.normal(); chi += z * z; }
  return (r.normal() / Math.sqrt(chi / T_DF)) * T_SCALE;
}

/**
 * Monte Carlo over the forecast's errors. Each simulated election: one national error (sd natSd, plus drift for the
 * days left), one error per state (sd stateSd) shared by its districts, half a state error more for each district,
 * and each unit's own uncertainty from the aggregation (normal). A unit goes to the Democrat if its share is above 50.
 * The prior-only benchmark is simulated with the same draws. Returns a simulator that runs in slices.
 */
export function simulator(E, agg, priorAgg, { natSd, stateSd, tails, drift, seed = 1 }) {
  const n = E.units.length, parent = parentIndex(E), ev = E.results[String(agg.year)].ev;
  const r = rng(seed);
  const natTotal = Math.sqrt(natSd * natSd + (drift * drift * agg.daysBefore) / 30);
  const m = agg.units.map((u) => u.mean), s = agg.units.map((u) => u.sd);
  const m0 = priorAgg.units.map((u) => u.mean), s0 = priorAgg.units.map((u) => u.sd);
  const out = { done: 0, evD: [], outcomes: [], winsD: new Float64Array(n), priorWinsD: new Float64Array(n), priorEvD: [] };
  const stateErr = new Float64Array(51);
  out.run = (count) => {
    for (let k = 0; k < count; k++) {
      const nat = natTotal * drawError(r, tails);
      for (let j = 0; j < 51; j++) stateErr[j] = stateSd * drawError(r, tails);
      const row = new Uint8Array(n);
      let evD = 0, evP = 0;
      for (let i = 0; i < n; i++) {
        let common = nat + stateErr[parent[i]];
        if (parent[i] !== i) common += 0.5 * stateSd * drawError(r, tails);
        const z = r.normal();
        if (m[i] + s[i] * z + common > 50) { row[i] = 1; evD += ev[i]; out.winsD[i]++; }
        if (m0[i] + s0[i] * z + common > 50) { evP += ev[i]; out.priorWinsD[i]++; }
      }
      out.outcomes.push(row);
      out.evD.push(evD);
      out.priorEvD.push(evP);
      out.done++;
    }
    return out.done;
  };
  return out;
}

/** The result itself: which units the Democrat won, and the electoral votes. */
export function actual(E, year) {
  const res = E.results[String(year)];
  const won = res.d.map((d, i) => (d > res.r[i] ? 1 : 0));
  const share = res.d.map((d, i) => twoParty(d, res.r[i]));
  let evD = 0, evR = 0;
  won.forEach((w, i) => { if (w) evD += res.ev[i]; else evR += res.ev[i]; });
  return { won, share, evD, evR, national: nationalShare(res) };
}

/** Brier score: the mean squared gap between each probability and what happened (1 or 0). */
export function brier(p, o) {
  if (!p.length || p.length !== o.length) return NaN;
  let s = 0;
  for (let i = 0; i < p.length; i++) s += (p[i] - o[i]) ** 2;
  return s / p.length;
}

/** Forecasts grouped by probability, with how often the Democrat won in each group. */
export const BINS = [[0, 0.05], [0.05, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.95], [0.95, 1]];
export function calibration(p, o, bins = BINS) {
  return bins.map(([lo, hi], b) => {
    const idx = p.map((_, i) => i).filter((i) => p[i] >= lo && (b === bins.length - 1 ? p[i] <= hi : p[i] < hi));
    return { lo, hi, n: idx.length, meanP: idx.length ? stats.mean(idx.map((i) => p[i])) : NaN, won: idx.reduce((s, i) => s + o[i], 0), rate: idx.length ? idx.reduce((s, i) => s + o[i], 0) / idx.length : NaN };
  });
}

/** Summary of a finished simulation: probabilities, electoral-vote distribution and the scores. */
export function summarise(E, sim, year) {
  const N = sim.done, n = E.units.length;
  const p = Array.from(sim.winsD, (w) => w / N);
  const p0 = Array.from(sim.priorWinsD, (w) => w / N);
  const a = actual(E, year);
  const ev = Float64Array.from(sim.evD).sort();
  const q = (x) => ev[Math.min(N - 1, Math.floor(x * N))];
  const winD = sim.evD.filter((v) => v >= 270).length / N;
  const winR = sim.evD.filter((v) => v <= 268).length / N;
  const tie = sim.evD.filter((v) => v === 269).length / N;
  // How often the forecast's own draws produce a Democratic total at or below the actual one.
  const atOrBelow = sim.evD.filter((v) => v <= a.evD).length / N;
  // Brier scores the forecast would get if each of its simulated elections were the real one.
  const own = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const row = sim.outcomes[k];
    let s = 0;
    for (let i = 0; i < n; i++) s += (p[i] - row[i]) ** 2;
    own[k] = s / n;
  }
  const score = brier(p, a.won);
  const worse = own.filter((b) => b >= score - 1e-12).length / N;
  const competitive = p.map((_, i) => i).filter((i) => p[i] > 0.05 && p[i] < 0.95);
  const prevWinner = E.results[String(year - 4)].d.map((d, i) => (d > E.results[String(year - 4)].r[i] ? 1 : 0));
  return {
    p, p0, actual: a, winD, winR, tie, median: q(0.5), lo: q(0.1), hi: q(0.9), atOrBelow,
    brier: score, brierPrior: brier(p0, a.won), brierCoin: 0.25, brierPrev: brier(prevWinner, a.won),
    brierCompetitive: competitive.length ? brier(competitive.map((i) => p[i]), competitive.map((i) => a.won[i])) : NaN,
    competitive, own, worse, misses: p.map((x, i) => i).filter((i) => (p[i] > 0.5 ? 1 : 0) !== a.won[i] && p[i] !== 0.5),
    calibration: calibration(p, a.won),
    priorMedian: Float64Array.from(sim.priorEvD).sort()[Math.floor(0.5 * N)],
  };
}

/** Days before the election as a calendar date (UTC), "3 Nov 2020". */
export function forecastDate(election, daysBefore) {
  const d = new Date(election + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - daysBefore);
  return d.toISOString().slice(0, 10);
}

/** Validate the settings; returns a list of problems (empty when all is well). */
export function check(o) {
  const bad = [];
  const range = (k, lo, hi, what) => { if (!(Number.isFinite(o[k]) && o[k] >= lo && o[k] <= hi)) bad.push(`${what} must be between ${lo} and ${hi}.`); };
  range("natSd", 0, 6, "The national polling error");
  range("stateSd", 0, 6, "The state polling error");
  range("drift", 0, 4, "The drift per month");
  range("tau", 0.5, 15, "The prior's spread");
  range("halfLife", 1, 90, "The half-life");
  range("daysBefore", 0, 59, "The forecast day");
  if (!Number.isInteger(o.daysBefore)) bad.push("The forecast day must be a whole number of days.");
  if (!YEARS.includes(o.year)) bad.push("Choose 2016 or 2020.");
  return bad;
}
