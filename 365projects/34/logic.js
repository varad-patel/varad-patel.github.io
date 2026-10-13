// Day 34: Coffee Index and Big Mac Economics. The model, with no DOM code.
//
// The Economist's Big Mac index, recalculated from its published inputs for any pair of currencies:
// the raw index (the exchange rate that would equalise burger prices, against the market rate) and the
// GDP-adjusted index (the same after allowing for burgers being cheaper in poorer countries).
// The method follows data-generator-v3.R in github.com/TheEconomist/big-mac-data line for line.

import { stats, fmt } from "../kit/kit.js";

const MONTH = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** "2026-07-01" as "July 2026". The Economist dates each round to the month it was priced in. */
export const monthOf = (iso) => MONTH.format(new Date(iso + "T00:00:00Z"));

/** Countries that enter the GDP regression on a date: a fixed list, plus two later groups from the dates they joined. */
export function regressionSet(data, date) {
  const set = new Set(data.regression.always);
  for (const [from, list] of Object.entries(data.regression.from)) if (date >= from) for (const iso of list) set.add(iso);
  return set;
}

/**
 * Everything the index needs for one date.
 * rows: the countries in the index, each { iso, name, currency, localPrice, dollarEx, dollarPrice, gdpBigmac, adjPrice, left }
 * (gdpBigmac and adjPrice are null for a country outside the GDP regression, and left says why: "list" or "gdp"). sample: the countries the line was fitted to,
 * which include euro-area members that the index itself reports only as "Euro area". fit: the line.
 */
export function snapshot(data, date) {
  const i = data.dates.indexOf(date);
  if (i < 0) return null;
  const all = data.prices[i].filter((r) => r[2] > 0 && r[3] > 0).map(([iso, currency, localPrice, dollarEx, gdpLocal]) => ({
    iso, name: data.names[iso], currency, localPrice, dollarEx, gdpLocal, dollarPrice: localPrice / dollarEx, gdpBigmac: null, adjPrice: null, left: null,
  }));
  const usa = all.find((r) => r.iso === "USA");
  const inRegression = regressionSet(data, date);
  // Why a country has no adjusted index: it is not on The Economist's list for the fit, or the files give it no GDP.
  for (const r of all) r.left = !inRegression.has(r.iso) ? "list" : r.gdpLocal > 0 ? null : "gdp";
  const sample = all.filter((r) => r.gdpLocal > 0 && inRegression.has(r.iso));
  // GDP per person in dollars, converted at the exchange rate that would make a Big Mac cost the same as in America.
  for (const r of sample) r.gdpBigmac = r.gdpLocal / (r.localPrice / usa.localPrice);
  const line = stats.linreg(sample.map((r) => r.gdpBigmac), sample.map((r) => r.dollarPrice));
  for (const r of sample) r.adjPrice = line.intercept + line.slope * r.gdpBigmac;
  const inIndex = new Set(data.indexCountries);
  return { date, rows: all.filter((r) => inIndex.has(r.iso)), sample, fit: { intercept: line.intercept, slope: line.slope, r2: line.r2, n: sample.length } };
}

/**
 * How currency A looks against currency B on one date.
 * implied: units of A's currency per unit of B's that would make the burger cost the same in both places.
 * market: the actual rate in the same units. raw = implied / market - 1 (positive: A is overvalued against B).
 * adjusted: the same comparison after dividing each burger's dollar price by the price its country's GDP
 * per person predicts; null when either country is outside the regression.
 */
export function valuation(snap, a, b) {
  const A = snap?.rows.find((r) => r.iso === a), B = snap?.rows.find((r) => r.iso === b);
  if (!A || !B) return null;
  const implied = A.localPrice / B.localPrice, market = A.dollarEx / B.dollarEx;
  const adjusted = A.adjPrice != null && B.adjPrice != null ? (A.dollarPrice / A.adjPrice) / (B.dollarPrice / B.adjPrice) - 1 : null;
  return { a: A, b: B, implied, market, raw: a === b ? 0 : A.dollarPrice / B.dollarPrice - 1, adjusted: a === b && adjusted != null ? 0 : adjusted };
}

/** Dates on which both countries have a Big Mac price in the index. */
export function sharedDates(data, a, b) {
  const inIndex = new Set(data.indexCountries);
  if (!inIndex.has(a) || !inIndex.has(b)) return [];
  return data.dates.filter((_, i) => { const here = new Set(data.prices[i].map((r) => r[0])); return here.has(a) && here.has(b); });
}

/** The two indices for A against B on every date they share: [{ date, raw, adjusted }]. */
export function history(data, a, b) {
  return sharedDates(data, a, b).map((date) => { const v = valuation(snapshot(data, date), a, b); return { date, raw: v.raw, adjusted: v.adjusted }; });
}

/** Every currency in the index against B on one date, most overvalued first. measure: "raw" or "adjusted". */
export function ranking(snap, b, measure = "raw") {
  return snap.rows.map((r) => ({ iso: r.iso, name: r.name, currency: r.currency, value: valuation(snap, r.iso, b)?.[measure] ?? null }))
    .filter((r) => r.value != null)
    .sort((x, y) => y.value - x.value || x.name.localeCompare(y.name));
}

/** Countries that can be picked: those in the index, with every currency code they have carried, in name order. */
export function countries(data) {
  const inIndex = new Set(data.indexCountries);
  const seen = new Map();
  data.prices.forEach((rows) => rows.forEach(([iso, currency]) => { if (inIndex.has(iso)) seen.set(iso, currency); }));
  return [...seen].map(([iso, currency]) => ({ iso, name: data.names[iso], currency })).sort((x, y) => x.name.localeCompare(y.name));
}

/* ------------------------------------------------------------- your own index */

export const OWN_LIMITS = { min: 0.000001, max: 1e12, nameMax: 40 };

/**
 * The same sum for any one good the visitor prices themselves.
 * priceA and priceB are in each place's own currency; rate is units of A's currency per one unit of B's.
 */
export function ownIndex({ priceA, priceB, rate }) {
  const checks = [["priceA", priceA, "The price in the first place"], ["priceB", priceB, "The price in the second place"], ["rate", rate, "The exchange rate"]];
  for (const [field, value, label] of checks) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < OWN_LIMITS.min || value > OWN_LIMITS.max) {
      return { ok: false, field, error: `${label} must be a number above zero, from 0.000001 to 1,000,000,000,000.` };
    }
  }
  const implied = priceA / priceB;
  return { ok: true, implied, market: rate, value: implied / rate - 1 };
}

/* ------------------------------------------------------------------- wording */

/**
 * The size of a gap for a headline tile: "60.5%", "0%", "under 0.05%". The edges are said in words, so that a gap is never
 * printed as 0.0% when it is not zero, as 100.0% undervalued when the good is not free, or as a number twenty digits long.
 */
export function gapSize(value) {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value === 0) return "0%";
  const size = fmt.pct(Math.abs(value), 1);
  if (size === "0.0%") return "under 0.05%";
  if (value < 0 && size === "100.0%") return "more than 99.9%";
  return value > 10 ? "more than 1,000%" : size;
}

/** "34.2% overvalued", "5.0% undervalued", "at parity", or a line for a gap too small or too large to print. */
export function verdict(value) {
  if (value == null || !Number.isFinite(value)) return "not available";
  if (value === 0) return "at parity";
  return `${gapSize(value).replace("under", "less than")} ${value > 0 ? "overvalued" : "undervalued"}`;
}

/** When a country enters the GDP regression: "always", the date it joins from, or null if it is never on the list. */
export function joinsFit(data, iso) {
  if (data.regression.always.includes(iso)) return "always";
  return Object.keys(data.regression.from).sort().find((from) => data.regression.from[from].includes(iso)) ?? null;
}
export const gapSide = (value) => (value == null || !Number.isFinite(value) ? "" : value === 0 ? "at parity" : value > 0 ? "overvalued" : "undervalued");

/** A price or a rate with enough digits to be read: 2 decimals from 1 up, 4 significant figures below. */
export const figure = (x) => (x == null || !Number.isFinite(x) ? "–" : Math.abs(x) >= 1e9 ? fmt.compact(x) : Math.abs(x) >= 100 ? fmt.num(x, Math.abs(x) >= 10000 ? 0 : 2) : Math.abs(x) >= 1 ? fmt.num(x, 2) : fmt.sig(x, 4));
