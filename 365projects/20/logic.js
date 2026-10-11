// Day 20: Bertrand's Paradox Simulator. The model, with no DOM code.
// The circle has radius 1 and its centre at the origin. The inscribed equilateral triangle has side sqrt(3).
// A chord is fixed by its midpoint: distance m from the centre (0 to 1) in direction phi. Its length is
// 2 sqrt(1 - m^2), so it is longer than the triangle's side exactly when m < 1/2.

import { rng } from "../kit/kit.js";

export const SIDE = Math.sqrt(3);
const TAU = 2 * Math.PI;

export const METHODS = [
  { key: "endpoints", label: "Random endpoints", short: "endpoints", theory: 1 / 3, fraction: "1/3",
    recipe: "Pick two points on the circle, each uniformly at random, and join them." },
  { key: "radius", label: "Random radius", short: "radius", theory: 1 / 2, fraction: "1/2",
    recipe: "Pick a radius in a uniformly random direction and a point on it uniformly at random. Draw the chord through that point at right angles to the radius." },
  { key: "midpoint", label: "Random midpoint", short: "midpoint", theory: 1 / 4, fraction: "1/4",
    recipe: "Pick a point uniformly at random inside the circle. Draw the chord that has it as its midpoint." },
];
const KEYS = METHODS.map((m) => m.key);

/** P(midpoint distance <= x) under each method, for x from 0 to 1. The chance of a long chord is the value at 1/2. */
export const midpointCdf = {
  endpoints: (x) => (2 / Math.PI) * Math.asin(x),
  radius: (x) => x,
  midpoint: (x) => x * x,
};

/** The chord whose midpoint is at distance m from the centre in direction phi. */
export function chord(m, phi) {
  const h = Math.sqrt(Math.max(0, 1 - m * m));   // half the chord's length
  const c = Math.cos(phi), s = Math.sin(phi);
  return { m, phi, mx: m * c, my: m * s, x1: m * c - h * s, y1: m * s + h * c, x2: m * c + h * s, y2: m * s - h * c, length: 2 * h, long: 2 * h > SIDE };
}

/** One random chord. r is a generator from rng(seed). */
export function sample(method, r) {
  if (method === "endpoints") {
    // Endpoints at angles a and b have their midpoint at cos((a - b) / 2) times the unit vector at angle (a + b) / 2.
    const a = TAU * r(), b = TAU * r();
    const k = Math.cos((a - b) / 2);
    return chord(Math.abs(k), (a + b) / 2 + (k < 0 ? Math.PI : 0));
  }
  if (method === "radius") { const phi = TAU * r(); return chord(r(), phi); }
  if (method === "midpoint") { const phi = TAU * r(); return chord(Math.sqrt(r()), phi); }   // sqrt makes the point uniform over the area
  throw new Error(`unknown method "${method}"`);
}

/** Standard error of a share p estimated from n independent chords. */
export const standardError = (p, n) => (n > 0 ? Math.sqrt((p * (1 - p)) / n) : NaN);

/**
 * A reproducible experiment that draws chords by all three methods side by side.
 * run.add(count) draws `count` more chords per method. run.data[key] holds
 *   n, long      chords drawn and how many were longer than the triangle's side
 *   recent       the latest chords (at most `keep`), for drawing
 *   track        [n, share so far] at roughly log-spaced n, for the convergence chart
 */
export function createRun(seed = 1, { keep = 2000 } = {}) {
  const gens = KEYS.map((_, i) => rng(seed * 10 + i));
  const data = Object.fromEntries(KEYS.map((k) => [k, { n: 0, long: 0, recent: [], track: [], next: 1 }]));
  return {
    seed, data,
    add(count) {
      KEYS.forEach((key, i) => {
        const d = data[key];
        for (let j = 0; j < count; j++) {
          const c = sample(key, gens[i]);
          d.n++;
          if (c.long) d.long++;
          d.recent.push(c);
          if (d.n >= d.next) { d.track.push([d.n, d.long / d.n]); d.next = Math.max(d.n + 1, Math.ceil(d.n * 1.04)); }
        }
        if (d.recent.length > keep) d.recent = d.recent.slice(-keep);
      });
      return this;
    },
    share: (key) => (data[key].n ? data[key].long / data[key].n : null),
  };
}

/* ---------- Jaynes's test: judge the same chords against a smaller circle inside the big one ---------- */

/**
 * Does the chord's line cross the small circle { x, y, r }, and is the piece inside it longer than the side of
 * that circle's own inscribed triangle? The line is at distance |x cos phi + y sin phi - m| from the small centre.
 */
export function crossing(c, inner) {
  const d = Math.abs(inner.x * Math.cos(c.phi) + inner.y * Math.sin(c.phi) - c.m);
  return { hits: d < inner.r, long: d < inner.r / 2 };
}

function needInside(inner) {
  if (!(inner.r > 0) || Math.hypot(inner.x, inner.y) + inner.r > 1) throw new Error("the small circle must lie inside the big one");
}

/** Draw n chords by one method and report those that cross the small circle. share is null if none did. */
export function innerTest(method, inner, n, seed = 1) {
  needInside(inner);
  const r = rng(seed);
  let hits = 0, long = 0;
  for (let i = 0; i < n; i++) {
    const t = crossing(sample(method, r), inner);
    if (t.hits) { hits++; if (t.long) long++; }
  }
  return { n, hits, long, share: hits ? long / hits : null };
}

/**
 * The same question answered exactly, with no sampling. For a chord in direction phi the line passes within h of
 * the small centre when |c - m| < h, where c = x cos phi + y sin phi. That has chance F(c + h) - F(c - h), with F the
 * method's distribution of m (0 below 0, 1 above 1), and the direction is uniform and independent of m, so the
 * chance overall is the average over phi. crossing is the chance of crossing the small circle (h = r); share is the
 * chance of being long for it given that it crosses (h = r / 2 over h = r). Midpoint rule over `steps` directions.
 */
export function innerExact(method, inner, steps = 20000) {
  needInside(inner);
  const cdf = midpointCdf[method];
  if (!cdf) throw new Error(`unknown method "${method}"`);
  const F = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : cdf(x));
  let long = 0, hits = 0;
  for (let i = 0; i < steps; i++) {
    const phi = (TAU * (i + 0.5)) / steps;
    const c = inner.x * Math.cos(phi) + inner.y * Math.sin(phi);
    long += F(c + inner.r / 2) - F(c - inner.r / 2);
    hits += F(c + inner.r) - F(c - inner.r);
  }
  return { crossing: hits / steps, share: long / hits };
}

/** Is the small circle's exact answer the method's answer for the big circle? Decided from the geometry, not from a sample. */
export const keepsAnswer = (method, inner) => Math.abs(innerExact(method, inner).share - METHODS.find((m) => m.key === method).theory) < 1e-9;
