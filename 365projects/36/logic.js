// Day 36: House Price Predictor. The model, with no DOM code.
// A hedonic regression of log price on a flat's features, fitted by scripts/data/paris_flats.mjs to sales of
// flats in Paris from 2021 to 2025. This file only evaluates the fitted model: it never refits it.

import { MODEL } from "./data.js";

export { MODEL };
export const REFERENCE = MODEL.reference;
export const PERIODS = MODEL.periods;
export const LEVELS = MODEL.intervals.levels;
export const LIMITS = { areaMin: MODEL.rules.areaMin, areaMax: MODEL.rules.areaMax };
export const ROOMS = [1, 2, 3, 4, 5, 6];
export const OUTBUILDINGS = [0, 1, 2];
export const ARRONDISSEMENTS = Array.from({ length: 20 }, (_, i) => i + 1);
// 1.96 standard errors either side: the 95% interval for a coefficient estimated from tens of thousands of sales.
const Z95 = 1.959964;

const P = MODEL.terms.length;
const INDEX = new Map(MODEL.terms.map((t, j) => [t, j]));
// The stored lower triangle, as a full symmetric matrix.
const COV = Array.from({ length: P }, (_, a) => Array.from({ length: P }, (_, b) => (b <= a ? MODEL.cov[a][b] : MODEL.cov[b][a])));

export const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
export const roomsLabel = (r) => (r === 6 ? "6 or more rooms" : r === 1 ? "1 room" : `${r} rooms`);
export const outLabel = (o) => ["no outbuilding", "one outbuilding", "two or more outbuildings"][o];
export const periodLabel = (p) => `${p.endsWith("H1") ? "January to June" : "July to December"} ${p.slice(0, 4)}`;

/** "" if the flat can be priced, otherwise a sentence saying what to fix. */
export function check(flat) {
  if (!flat || typeof flat !== "object") return "A flat needs a floor area, rooms, an arrondissement, outbuildings and a sale period.";
  const { area, rooms, arr, out, period } = flat;
  if (typeof area !== "number" || !Number.isFinite(area) || area < LIMITS.areaMin || area > LIMITS.areaMax) return `Floor area must be a number from ${LIMITS.areaMin} to ${LIMITS.areaMax} m², the range of the sales the model was fitted to.`;
  if (!ROOMS.includes(rooms)) return "Rooms must be a whole number from 1 to 6, where 6 stands for six or more.";
  if (!ARRONDISSEMENTS.includes(arr)) return "The arrondissement must be a whole number from 1 to 20.";
  if (!OUTBUILDINGS.includes(out)) return "Outbuildings must be 0, 1 or 2, where 2 stands for two or more.";
  if (!PERIODS.includes(period)) return `The sale period must be one of the half-years from ${PERIODS[0]} to ${PERIODS.at(-1)}.`;
  return "";
}

/** The flat's row of the design matrix: one number for each coefficient in MODEL.terms. */
export function design(flat) {
  const x = new Array(P).fill(0);
  const d = Math.log(flat.area / REFERENCE.area);
  x[0] = 1; x[1] = d; x[2] = d * d;
  for (const key of ["rooms", "arr", "period", "out"]) {
    const j = INDEX.get(`${key}${flat[key]}`);
    if (j != null) x[j] = 1;   // the reference flat's own levels have no column
  }
  return x;
}

const dot = (x, b) => x.reduce((s, v, j) => s + v * b[j], 0);
/** x' V x: the sampling variance of a weighted sum of coefficients. */
const quad = (x) => { let s = 0; for (let a = 0; a < P; a++) if (x[a]) for (let b = 0; b < P; b++) if (x[b]) s += x[a] * COV[a][b] * x[b]; return s; };

/**
 * The estimate for one flat.
 *   price          exp(x'b): the geometric mean of prices for flats like this one
 *   low, high      the interval that held the chosen share of held-out sales in this arrondissement
 *   ciLow, ciHigh  95% interval for the geometric mean itself (the coefficients' uncertainty only)
 *   mean           the arithmetic mean, by Duan's smearing factor
 *   elasticity     percentage change in price for a 1% change in floor area, at this floor area
 *   perExtraM2     euros added by one more square metre, at this floor area
 */
export function predict(flat, level = 0.9) {
  const error = check(flat) || (LEVELS.includes(level) ? "" : `The interval must be one of ${LEVELS.map((l) => `${l * 100}%`).join(", ")}.`);
  if (error) return { error };
  const x = design(flat);
  const log = dot(x, MODEL.beta);
  const se = Math.sqrt(quad(x));
  const price = Math.exp(log);
  const [lo, hi] = MODEL.intervals.byArr[flat.arr - 1][LEVELS.indexOf(level)];
  const elasticity = MODEL.beta[1] + 2 * MODEL.beta[2] * x[1];
  return {
    log, se, price, level,
    low: price * Math.exp(lo), high: price * Math.exp(hi),
    ciLow: Math.exp(log - Z95 * se), ciHigh: Math.exp(log + Z95 * se),
    mean: price * MODEL.smear,
    perM2: price / flat.area,
    elasticity, perExtraM2: (elasticity * price) / flat.area,
  };
}

const FEATURES = [
  { key: "area", label: "Floor area", show: (v) => `${fmtArea(v)} m²` },
  { key: "rooms", label: "Main rooms", show: (v) => (v === 6 ? "6 or more" : String(v)) },
  { key: "arr", label: "Arrondissement", show: ordinal },
  { key: "out", label: "Outbuildings", show: (v) => ["none", "one", "two or more"][v] },
  { key: "period", label: "Sold in", show: periodLabel },
];
// The floor area as typed, without the noise of binary fractions: 42, 42.5, 42.01.
const fmtArea = (v) => String(Number(v.toPrecision(8)));

/**
 * What each feature adds, against the reference flat. For each feature:
 *   log        the feature's part of ln(price): the flat's coefficient(s) minus the reference flat's (which are zero)
 *   factor     exp(log): what the feature multiplies the price by
 *   pct        factor - 1, with a 95% interval [pctLow, pctHigh] from the coefficients' covariance
 *   euros      price - price / factor: the estimate minus the estimate for the same flat with this one
 *              feature set back to the reference flat's value
 * The factors multiply: reference price times every factor is the estimate. The euro figures do not add up
 * to the gap between the two prices, because each is worked out at the flat's own price.
 */
export function breakdown(flat) {
  const error = check(flat);
  if (error) return { error };
  const x = design(flat);
  const price = Math.exp(dot(x, MODEL.beta));
  const referencePrice = Math.exp(MODEL.beta[0]);
  const items = FEATURES.map((f) => {
    // The columns that belong to this feature.
    const part = new Array(P).fill(0);
    if (f.key === "area") { part[1] = x[1]; part[2] = x[2]; }
    else { const j = INDEX.get(`${f.key}${flat[f.key]}`); if (j != null) part[j] = 1; }
    const log = dot(part, MODEL.beta);
    const se = Math.sqrt(quad(part));
    const factor = Math.exp(log);
    return {
      key: f.key, label: f.label, yours: f.show(flat[f.key]), reference: f.show(REFERENCE[f.key]), same: flat[f.key] === REFERENCE[f.key],
      log, se, factor, pct: factor - 1, pctLow: Math.exp(log - Z95 * se) - 1, pctHigh: Math.exp(log + Z95 * se) - 1,
      euros: price - price / factor,
    };
  });
  return { price, referencePrice, items };
}

/**
 * The estimate as one feature changes and the others stay as they are: [{ value, label, price, low, high, current }].
 * For floor area the values run from the smallest to the largest area the model covers.
 */
export function curve(flat, key, level = 0.9) {
  const error = check(flat);
  if (error) return { error };
  let values;
  if (key === "area") {
    const steps = 60;
    values = Array.from({ length: steps + 1 }, (_, i) => LIMITS.areaMin * (LIMITS.areaMax / LIMITS.areaMin) ** (i / steps));
  } else values = { rooms: ROOMS, arr: ARRONDISSEMENTS, out: OUTBUILDINGS, period: PERIODS }[key];
  if (!values) return { error: "Unknown feature." };
  const f = FEATURES.find((d) => d.key === key);
  return {
    key, label: f.label,
    points: values.map((value) => {
      const p = predict({ ...flat, [key]: value }, level);
      return { value, label: f.show(value), price: p.price, low: p.low, high: p.high, current: value === flat[key] };
    }),
  };
}

/** A note when the floor area is unusual for the number of rooms, or "" when it is not. */
export function unusual(flat) {
  if (check(flat)) return "";
  const [, n, p1, , p99] = MODEL.areaByRooms.find((r) => r[0] === flat.rooms);
  if (flat.area >= p1 && flat.area <= p99) return "";
  const size = flat.area < p1 ? `smaller than ${p1} m²` : `larger than ${p99} m²`;
  return `Only about 1 in 100 of the ${n.toLocaleString("en-GB")} flats with ${roomsLabel(flat.rooms)} in the data were ${size}. The model has seen very few flats like this one, so this estimate rests on the shape of the formula more than on sales.`;
}

/** The 400 held-out sales bundled with the model, each with the model's estimate: [{ flat, paid, estimate, error }]. */
export function heldOut() {
  return MODEL.sample.map(([area, rooms, arr, out, pi, paid]) => {
    const flat = { area, rooms, arr, out, period: PERIODS[pi] };
    const estimate = predict(flat).price;
    return { flat, paid, estimate, error: (estimate - paid) / paid };
  });
}

/** Median of the absolute percentage errors of a list from heldOut(). */
export function medianAbsError(list) {
  const e = list.map((s) => Math.abs(s.error)).sort((a, b) => a - b);
  return e.length ? (e[Math.floor((e.length - 1) / 2)] + e[Math.ceil((e.length - 1) / 2)]) / 2 : NaN;
}
