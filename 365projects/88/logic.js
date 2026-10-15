// Day 88: Electoral College Simulator. The model, with no DOM code.
// A base map of two-party shares, swings set by the visitor, random state and national error, and a count of the
// 538 electoral votes with Maine's and Nebraska's district rule.

import { rng } from "../kit/kit.js";

export const BASE_YEARS = [2024, 2020, 2016, 2012];
export const DEFAULTS = { year: 2024, national: 0, regions: [0, 0, 0, 0], natSd: 2, stateSd: 2, sims: 20000, seed: 1, districtRule: true };
export const MAX_SWING = 15;

export const twoParty = (d, r) => (100 * d) / (d + r);

/**
 * The base map of one election: each unit's two-party share for the Democrat, its two-party votes, its electoral
 * votes, its state (a district's parent) and its Census region (1 to 4).
 */
export function base(E, year) {
  const res = E.results[String(year)];
  if (!res || res.statesOnly) throw new Error(`no full results for ${year}`);
  const parent = E.units.map((u, i) => (u.includes("-") ? E.units.indexOf(u.split("-")[0]) : i));
  return {
    year, dem: res.dem, rep: res.rep, units: E.units, names: E.names, parent, region: E.region,
    share: res.d.map((d, i) => twoParty(d, res.r[i])),
    votes: res.d.map((d, i) => d + res.r[i]),
    ev: res.ev,
    districts: { ME: [E.units.indexOf("ME-1"), E.units.indexOf("ME-2")], NE: [E.units.indexOf("NE-1"), E.units.indexOf("NE-2"), E.units.indexOf("NE-3")] },
  };
}

/**
 * Shares after the swings, in points of the Democrat's two-party share: national + the state's region + an override
 * for the state; a district also takes its own override. Shares are held between 0 and 100.
 */
export function swung(b, { national = 0, regions = [0, 0, 0, 0], overrides = new Map() } = {}) {
  return b.share.map((s, i) => {
    const p = b.parent[i];
    let x = s + national + (regions[b.region[p] - 1] || 0) + (overrides.get(p) || 0);
    if (p !== i) x += overrides.get(i) || 0;
    return Math.min(100, Math.max(0, x));
  });
}

/**
 * Electoral votes from shares. A unit above 50 goes to the Democrat, below 50 to the Republican; exactly 50 goes to
 * neither (unresolved). With districtRule false, Maine and Nebraska give all their votes to the statewide winner.
 */
export function tally(b, share, districtRule = true) {
  let evD = 0, evR = 0, open = 0;
  const give = (s, n) => { if (s > 50) evD += n; else if (s < 50) evR += n; else open += n; };
  for (let i = 0; i < b.units.length; i++) {
    const isDistrict = b.parent[i] !== i;
    if (isDistrict) { if (districtRule) give(share[i], b.ev[i]); continue; }
    const extra = districtRule ? 0 : (b.districts[b.units[i]] || []).reduce((s, j) => s + b.ev[j], 0);
    give(share[i], b.ev[i] + extra);
  }
  return { evD, evR, open };
}

/** National two-party share: the states' shares weighted by their two-party votes (turnout held at the base year's). */
export function popular(b, share) {
  let d = 0, t = 0;
  for (let i = 0; i < b.units.length; i++) if (b.parent[i] === i) { d += (share[i] * b.votes[i]) / 100; t += b.votes[i]; }
  return (100 * d) / t;
}

/** Who wins: "D", "R", or "none" when no one reaches 270 (the House would decide). */
export function winner(t) { return t.evD >= 270 ? "D" : t.evR >= 270 ? "R" : "none"; }

/**
 * The tipping point: rank the units from the most to the least Democratic and add up electoral votes until one side
 * passes 269. The unit that takes the Democrat to 270 is the tipping point; bias = its share minus the national share
 * (above zero: the map leans Democratic relative to the popular vote).
 */
export function tippingPoint(b, share, districtRule = true) {
  const items = [];
  for (let i = 0; i < b.units.length; i++) {
    const isDistrict = b.parent[i] !== i;
    if (isDistrict && !districtRule) continue;
    const extra = !isDistrict && !districtRule ? (b.districts[b.units[i]] || []).reduce((s, j) => s + b.ev[j], 0) : 0;
    items.push({ i, share: share[i], ev: b.ev[i] + extra });
  }
  items.sort((a, c) => c.share - a.share || a.i - c.i);
  let sum = 0;
  for (const it of items) { sum += it.ev; if (sum >= 270) { const nat = popular(b, share); return { unit: it.i, share: it.share, national: nat, bias: it.share - nat }; } }
  return null;
}

/**
 * Monte Carlo: each simulated election adds a national error (sd natSd) to every unit, an error per state (sd stateSd)
 * shared by its districts, and half a state error more for each district. Counts winners, ties and the cases where
 * the popular vote and the electoral college disagree, by popular-vote margin.
 */
export function simulator(b, swings, { natSd, stateSd, seed = 1, districtRule = true }) {
  const r = rng(seed);
  const center = swung(b, swings);
  const n = b.units.length;
  const out = {
    done: 0, winD: 0, winR: 0, none: 0, popD: 0, invDR: 0, invRD: 0, noneAfterPopD: 0, noneAfterPopR: 0,
    evHist: new Float64Array(539), unitD: new Float64Array(n),
    // Popular-vote margin (Democrat minus Republican, two-party points) in bins of 1 point from -15 to +15.
    marginBins: Array.from({ length: 30 }, (_, k) => ({ lo: -15 + k, hi: -14 + k, n: 0, inv: 0, d: 0 })), outside: 0,
  };
  const se = new Float64Array(n), share = new Float64Array(n);
  out.run = (count) => {
    for (let k = 0; k < count; k++) {
      const zn = natSd * r.normal();
      for (let i = 0; i < n; i++) if (b.parent[i] === i) se[i] = stateSd * r.normal();
      for (let i = 0; i < n; i++) {
        let x = center[i] + zn + se[b.parent[i]];
        if (b.parent[i] !== i) x += 0.5 * stateSd * r.normal();
        share[i] = Math.min(100, Math.max(0, x));
        if (share[i] > 50) out.unitD[i]++;
      }
      const t = tally(b, share, districtRule);
      const pop = popular(b, share);
      const w = winner(t);
      out.evHist[t.evD]++;
      if (w === "D") out.winD++; else if (w === "R") out.winR++; else out.none++;
      const popD = pop > 50, popR = pop < 50;
      if (popD) out.popD++;
      if (popD && w === "R") out.invDR++;
      if (popR && w === "D") out.invRD++;
      if (w === "none") { if (popD) out.noneAfterPopD++; else if (popR) out.noneAfterPopR++; }
      const margin = 2 * (pop - 50);
      const bin = Math.floor(margin + 15);
      if (bin >= 0 && bin < 30) { const B = out.marginBins[bin]; B.n++; if ((popD && w === "R") || (popR && w === "D")) B.inv++; if (w === "D") B.d++; } else out.outside++;
      out.done++;
    }
    return out.done;
  };
  return out;
}

/** Shares of a finished run. */
export function shares(sim) {
  const N = sim.done || 1;
  return {
    winD: sim.winD / N, winR: sim.winR / N, none: sim.none / N, popD: sim.popD / N,
    inversion: (sim.invDR + sim.invRD) / N, invDR: sim.invDR / N, invRD: sim.invRD / N,
  };
}

/** Median and 10th and 90th percentiles of the Democrat's electoral votes from the histogram. */
export function evQuantiles(sim) {
  const N = sim.done;
  const q = (p) => { let c = 0; for (let v = 0; v <= 538; v++) { c += sim.evHist[v]; if (c >= p * N) return v; } return 538; };
  return { lo: q(0.1), median: q(0.5), hi: q(0.9) };
}

/** Validate a swing or an error setting: a number within the bounds. */
export function checkSwing(v, lo = -MAX_SWING, hi = MAX_SWING) {
  return Number.isFinite(v) && v >= lo && v <= hi;
}

/**
 * Under a further uniform swing from these shares, the national two-party share at which each side reaches 270.
 * The Democrat reaches 270 once the national share passes demAt; the Republican has 270 while it stays below repAt.
 * When repAt < demAt, shares in between give the Democrat exactly 269: a tie. Assumes no contest is pushed past 0 or
 * 100 by the extra swing (true for any swing that matters here).
 */
export function uniformThresholds(b, share, districtRule = true) {
  const items = [];
  for (let i = 0; i < b.units.length; i++) {
    const isDistrict = b.parent[i] !== i;
    if (isDistrict && !districtRule) continue;
    const extra = !isDistrict && !districtRule ? (b.districts[b.units[i]] || []).reduce((s, j) => s + b.ev[j], 0) : 0;
    items.push({ share: share[i], ev: b.ev[i] + extra });
  }
  items.sort((a, c) => c.share - a.share);
  const nat = popular(b, share);
  let sum = 0, s269 = null, s270 = null;
  for (const it of items) { sum += it.ev; if (s269 == null && sum >= 269) s269 = it.share; if (sum >= 270) { s270 = it.share; break; } }
  return { national: nat, demAt: nat + (50 - s270), repAt: nat + (50 - s269), tie: s269 !== s270 };
}
