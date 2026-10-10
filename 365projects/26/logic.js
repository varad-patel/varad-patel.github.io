// Day 26: Nature versus Nurture Simulator. The model, with no DOM code.
// A trait built from genes and environment, the variance decomposition that follows, and a simulated twin study.

import { rng } from "../kit/kit.js";

export const MEAN = 100;
export const RGE_MAX = 0.7;
export const DEFAULTS = { va: 50, vc: 20, ve: 30, vi: 0, rge: 0, pairs: 500, seed: 26 };

/** Returns a message saying what to fix, or null when the settings are usable. */
export function check(p) {
  const names = { va: "genetic variance", vc: "shared-environment variance", ve: "non-shared-environment variance", vi: "interaction variance" };
  for (const [key, name] of Object.entries(names)) if (!Number.isFinite(p[key]) || p[key] < 0) return `The ${name} must be zero or more.`;
  if (!Number.isFinite(p.rge) || p.rge < 0 || p.rge > RGE_MAX) return `The gene-environment correlation must be between 0 and ${RGE_MAX}.`;
  if (p.va + p.vc + p.ve + p.vi <= 0) return "Every source of variation is set to zero, so everyone has the same trait value and there is no variation to divide up. Raise at least one of them.";
  if (!Number.isInteger(p.pairs) || p.pairs < 10 || p.pairs > 50000) return "The number of twin pairs of each kind must be a whole number from 10 to 50,000.";
  if (!Number.isInteger(p.seed) || p.seed < 0 || p.seed > 4294967295) return "The seed must be a whole number from 0 to 4,294,967,295.";
  return null;
}

/**
 * What the model implies, with no simulation.
 *
 *   P = 100 + G + C + E + I
 *   G = sqrt(va) g            genes, with g standard normal
 *   C = sqrt(vc) c            environment shared by a family, with corr(g, c) = rge
 *   E = sqrt(ve) e            environment unique to the person
 *   I = sqrt(vi) (g c - rge)  genes and shared environment multiplying each other
 *
 * Identical (MZ) twins have the same g; fraternal (DZ) twins have g correlated 0.5. Both kinds share c.
 */
export function theory(p) {
  const { va, vc, ve, vi, rge } = { ...DEFAULTS, ...p };
  const covariance = 2 * rge * Math.sqrt(va * vc);          // 2 Cov(G, C): belongs to neither side
  const interaction = vi * (1 + rge * rge);                 // Var(g c) = 1 + rge^2 for standard normals
  const vp = va + vc + ve + interaction + covariance;
  const rMZ = (vp - ve) / vp;                               // identical twins share everything except E
  const rDZ = (0.5 * va + vc + covariance + vi * (0.5 + rge * rge)) / vp;
  return {
    components: { genes: va, shared: vc, unique: ve, interaction, covariance }, vp,
    h2: va / vp, rMZ, rDZ,
    falconer: 2 * (rMZ - rDZ),                              // works out as (va + vi) / vp
    c2: 2 * rDZ - rMZ, e2: 1 - rMZ,
  };
}

/** Pairwise intraclass correlation of twin pairs: the correlation that does not depend on which twin is listed first. */
export function intraclass(a, b) {
  const n = a.length;
  if (n < 2) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] + b[i];
  const m = s / (2 * n);
  let cov = 0, v = 0;
  for (let i = 0; i < n; i++) { cov += (a[i] - m) * (b[i] - m); v += (a[i] - m) ** 2 + (b[i] - m) ** 2; }
  return v > 0 ? cov / (v / 2) : NaN;
}

/**
 * Simulate `pairs` identical and `pairs` fraternal twin pairs. Each family has a mid-parent genetic value m
 * (variance 1/2); each child adds an independent half (variance 1/2), the same half for identical twins.
 * The family environment is c = 2 rge m + sqrt(1 - 2 rge^2) z, so corr(g, c) = rge.
 * Returns { mz: { a, b }, dz: { a, b }, people, realised } or { error }.
 */
export function simulate(p) {
  const q = { ...DEFAULTS, ...p };
  const error = check(q);
  if (error) return { error };
  const r = rng(q.seed);
  const n = q.pairs, half = Math.SQRT1_2;
  const sa = Math.sqrt(q.va), sc = Math.sqrt(q.vc), se = Math.sqrt(q.ve), si = Math.sqrt(q.vi);
  const b = Math.sqrt(1 - 2 * q.rge * q.rge);
  const mz = { a: new Float64Array(n), b: new Float64Array(n) }, dz = { a: new Float64Array(n), b: new Float64Array(n) };
  const sum = { n: 0, G: 0, C: 0, E: 0, I: 0, P: 0, GG: 0, CC: 0, EE: 0, II: 0, PP: 0, GC: 0 };
  const people = [];
  const child = (g, c, keep) => {
    const G = sa * g, C = sc * c, E = se * r.normal(), I = si * (g * c - q.rge);
    const P = MEAN + G + C + E + I;
    sum.n++; sum.G += G; sum.C += C; sum.E += E; sum.I += I; sum.P += P;
    sum.GG += G * G; sum.CC += C * C; sum.EE += E * E; sum.II += I * I; sum.PP += P * P; sum.GC += G * C;
    if (keep && people.length < 5) people.push({ G, C, E, I, P });
    return P;
  };
  for (const kind of [mz, dz]) for (let i = 0; i < n; i++) {
    const m = r.normal(0, half);
    const c = 2 * q.rge * m + b * r.normal();
    const s1 = r.normal(0, half), s2 = kind === mz ? s1 : r.normal(0, half);
    kind.a[i] = child(m + s1, c, kind === dz);
    kind.b[i] = child(m + s2, c, false);
  }
  const N = sum.n, v = (xx, x) => xx / N - (x / N) ** 2;
  const realised = {
    n: N, mean: sum.P / N, vp: v(sum.PP, sum.P),
    genes: v(sum.GG, sum.G), shared: v(sum.CC, sum.C), unique: v(sum.EE, sum.E), interaction: v(sum.II, sum.I),
    covariance: 2 * (sum.GC / N - (sum.G / N) * (sum.C / N)),
  };
  realised.h2 = realised.genes / realised.vp;
  return { settings: q, mz, dz, people, realised };
}

/**
 * The twin study a researcher could run on the simulated pairs, seeing only the trait values.
 * Falconer's estimates: h2 = 2 (rMZ - rDZ), c2 = 2 rDZ - rMZ, e2 = 1 - rMZ.
 * The standard error treats each correlation as having variance (1 - r^2)^2 / n.
 */
export function twinStudy(sim) {
  const n = sim.mz.a.length;
  const rMZ = intraclass(sim.mz.a, sim.mz.b), rDZ = intraclass(sim.dz.a, sim.dz.b);
  const h2 = 2 * (rMZ - rDZ);
  const se = 2 * Math.sqrt(((1 - rMZ * rMZ) ** 2 + (1 - rDZ * rDZ) ** 2) / n);
  return { pairs: n, rMZ, rDZ, h2, c2: 2 * rDZ - rMZ, e2: 1 - rMZ, se, lo: h2 - 1.96 * se, hi: h2 + 1.96 * se };
}

/** True heritability as the non-shared environmental variance runs from 0 to max, everything else held fixed: [[ve, h2]]. */
export function heritabilityCurve(p, max = 200, steps = 100) {
  return Array.from({ length: steps + 1 }, (_, i) => { const ve = (max * i) / steps; return [ve, theory({ ...p, ve }).h2]; }).filter(([, h]) => Number.isFinite(h));
}

/**
 * Lewontin's two soils. Seed of one stock is sown in two fields. Inside each field the trait has heritability
 * `h2` (total variance `vp`). The field averages differ by `gap`, of which the fraction `share` is put down to
 * the seed and the rest to the soil. The two fields get plants with the same genetic values apart from that
 * shift, so the genetic part of the gap is exactly share x gap. The trait values do not depend on `share` at
 * all: the same plants grow whichever way the gap is caused.
 */
export function twoSoils({ h2 = 0.9, gap = 15, share = 0, n = 2000, seed = 26, vp = 100 } = {}) {
  if (!(h2 >= 0 && h2 <= 1)) return { error: "Heritability inside a field must be between 0 and 1." };
  if (!Number.isFinite(gap) || gap < 0) return { error: "The gap between the fields must be zero or more." };
  if (!(share >= 0 && share <= 1)) return { error: "The share of the gap due to the seed must be between 0 and 1." };
  if (!Number.isInteger(n) || n < 10 || n > 100000) return { error: "The number of plants in each field must be a whole number from 10 to 100,000." };
  const r = rng(seed);
  const sa = Math.sqrt(h2 * vp), se = Math.sqrt((1 - h2) * vp);
  const genes = Float64Array.from({ length: n }, () => sa * r.normal());
  const field = (shiftG, shiftE) => {
    const values = new Float64Array(n);
    let G = 0, GG = 0, P = 0, PP = 0;
    for (let i = 0; i < n; i++) {
      const g = genes[i] + shiftG;
      const p = MEAN + genes[i] + se * r.normal() + (shiftG + shiftE);
      values[i] = p;
      G += g; GG += g * g; P += p; PP += p * p;
    }
    const vG = GG / n - (G / n) ** 2, vP = PP / n - (P / n) ** 2;
    return { values, mean: P / n, meanG: G / n, h2: vP > 0 ? vG / vP : NaN };
  };
  const rich = field(0, 0), poor = field(-share * gap, -(1 - share) * gap);
  return { rich, poor, gap: rich.mean - poor.mean, geneticGap: rich.meanG - poor.meanG, share, within: h2 };
}
