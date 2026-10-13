// Day 33: The Real Cost of Living. The model, with no DOM code.
//
// Every place has a price level: what a fixed basket of household spending costs there, with the United States
// average at 1. For a US metropolitan area or state it is BEA's regional price parity divided by 100. For a country
// it is the World Bank's purchasing-power parity for household consumption divided by the exchange rate.
// A salary buys salary / level worth of goods at US-average prices, and that is the whole calculation.

import { fmt } from "../kit/kit.js";

export const KINDS = [
  { key: "metro", label: "US metropolitan area", level: "a metropolitan area" },
  { key: "state", label: "US state, or all non-metropolitan areas", level: "a whole state" },
  { key: "country", label: "Country or territory", level: "a whole country" },
];
export const PARTS = [
  { key: "goods", label: "Goods" },
  { key: "housing", label: "Housing (rents)" },
  { key: "utilities", label: "Utilities" },
  { key: "other", label: "Other services" },
];
export const SALARY = { min: 1, max: 1e12 };

const NEEDS_THE = /^(United |Russian Federation|Netherlands|Bahamas|Philippines|Gambia|Maldives|Seychelles|Comoros|Solomon Islands|West Bank and Gaza|District of Columbia)|Republic$/;

/**
 * Every place of one kind, in name order: { id, kind, name, level, index, parts, rate, usa }.
 * A country with no usable exchange rate has rate null and noRate "missing" or "differs" (see the data script).
 * rural marks the non-metropolitan portion and district the District of Columbia, neither of which is a state.
 */
export function places(data, kind) {
  if (kind === "country") {
    return data.countries.map(([iso, name, level, rate]) => ({ id: `country:${iso}`, kind, name, level, index: level * 100, parts: null, rate, usa: iso === "USA", noRate: rate == null ? data.noRate?.[iso] || "differs" : null }));
  }
  const rows = kind === "metro" ? data.metros : kind === "state" ? [...data.states, data.rural] : [];
  return rows.map(([name, all, goods, housing, utilities, other]) => ({
    id: `${kind}:${name}`, kind, name, level: all / 100, index: all, parts: { goods, housing, utilities, other }, rate: 1, usa: true,
    rural: name === data.rural[0], district: kind === "state" && name === "District of Columbia",
  }));
}
export const place = (data, id) => places(data, String(id).split(":")[0]).find((p) => p.id === id) || null;

/** What a place's figure covers, in a few words: never "a whole state" for the District of Columbia or the non-metropolitan counties. */
const TERRITORIES = new Set(["country:HKG", "country:MAC", "country:PSE"]);
export const coverage = (p) => (p.rural ? "all non-metropolitan counties" : p.district ? "the federal district" : TERRITORIES.has(p.id) ? "a whole territory" : KINDS.find((k) => k.key === p.kind).level);
/** A country's own money, named by the country so that two currencies in one sentence cannot be confused. */
export const currencyOf = (p) => `the currency of ${inWords(p)}`;
/** True when one figure is BEA's for part of the United States and the other the World Bank's for another country. */
const foreign = (p) => p.kind === "country" && !p.usa;
export const mixed = (a, b) => (foreign(a) && b.kind !== "country") || (foreign(b) && a.kind !== "country");

/** The place as it reads inside a sentence: "the Jackson, MS metropolitan area", "California", "the United Kingdom". */
export function inWords(p) {
  if (p.kind === "metro") return `the ${p.name} metropolitan area`;
  if (p.rural) return "the non-metropolitan portion of the United States";
  return NEEDS_THE.test(p.name) ? `the ${p.name}` : p.name;
}

/** Where a metropolitan area or state stands among its kind, dearest first: { rank, of }. Null for a country. */
export function rankOf(data, p) {
  if (p.kind === "country" || p.rural) return null;
  const all = (p.kind === "metro" ? data.metros : data.states).map((r) => r[1]);
  return { rank: all.filter((v) => v > p.index).length + 1, of: all.length };
}

const bad = (error, field) => ({ ok: false, error, field });

/**
 * Compare what one salary buys in two places.
 * salary is a year's pay; unit is "usd", or "local" for the currency of place A (a country with a usable exchange rate).
 * Returns { ok: false, error, field } or the comparison:
 *   salaryUsd   the salary in US dollars at the 2024 average exchange rate
 *   realA/realB what it buys in each place, in dollars at US-average prices
 *   needed      the salary in B, in US dollars, that buys what salaryUsd buys in A
 *   neededLocal the same in B's currency (null where B is priced in dollars or has no usable rate)
 *   stretch     how much more (positive) or less the same pay buys in B than in A, as a share
 *   parts       for two US places, each part of the basket: { key, label, a, b, gap } with gap = b / a - 1
 *   widest      the part where the two places differ most
 */
export function compare(data, { salary, unit = "usd", a, b }) {
  const A = place(data, a), B = place(data, b);
  if (!A) return bad("Choose the first place from the list.", "a");
  if (!B) return bad("Choose the second place from the list.", "b");
  if (typeof salary !== "number" || !Number.isFinite(salary) || salary < SALARY.min || salary > SALARY.max) {
    return bad("The salary must be a number from 1 to 1,000,000,000,000.", "salary");
  }
  if (unit !== "usd" && unit !== "local") return bad("Choose US dollars or the local currency.", "unit");
  if (unit === "local" && (A.usa || A.rate == null)) return bad(`There is no usable exchange rate for ${inWords(A)}, so the salary has to be entered in US dollars.`, "unit");
  const salaryUsd = unit === "local" ? salary / A.rate : salary;
  const ratio = B.level / A.level;
  const needed = salaryUsd * ratio;
  const parts = A.parts && B.parts ? PARTS.map(({ key, label }) => ({ key, label, a: A.parts[key], b: B.parts[key], gap: B.parts[key] / A.parts[key] - 1 })) : null;
  const widest = parts ? parts.reduce((best, p) => (Math.abs(Math.log(p.b / p.a)) > Math.abs(Math.log(best.b / best.a)) ? p : best)) : null;
  return {
    ok: true, a: A, b: B, same: A.id === B.id, salary, unit, salaryUsd,
    realA: salaryUsd / A.level, realB: salaryUsd / B.level,
    ratio, needed, neededLocal: !B.usa && B.rate != null ? needed * B.rate : null,
    stretch: A.level / B.level - 1, parts, widest: widest && widest.gap !== 0 ? widest : null,
  };
}

/* ------------------------------------------------------------------- wording */

/** Money to three significant figures: a comparison of price levels cannot support more. */
const round3 = (x) => Number(x.toPrecision(3));
export const units = (x) => (x >= 1e7 ? fmt.compact(x) : x >= 100 ? fmt.int(round3(x)) : fmt.sig(x, 3));
export const dollars = (x) => `$${units(x)}`;
/** The salary as typed, without rounding it away. */
export const asTyped = (x) => (Number.isInteger(x) ? fmt.int(x) : fmt.num(x, 2));
/** "15.6% above", "11.0% below", "level with" the US average (or any other yardstick). */
export function against(level) {
  const gap = level - 1;
  if (fmt.pct(Math.abs(gap), 1) === "0.0%") return gap === 0 ? "level with" : gap > 0 ? "a shade above" : "a shade below";
  return `${fmt.pct(Math.abs(gap), 1)} ${gap > 0 ? "above" : "below"}`;
}
/** "29.8% more", "23.0% less", "the same". */
export function moreOrLess(share) {
  if (share === 0) return "the same";
  if (fmt.pct(Math.abs(share), 1) === "0.0%") return share > 0 ? "very slightly more" : "very slightly less";
  return `${fmt.pct(Math.abs(share), 1)} ${share > 0 ? "more" : "less"}`;
}
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return fmt.int(n) + (s[(v - 20) % 10] || s[v] || s[0]); };

/** What kind of figure stands behind a place, said plainly. */
export function levelNote(data, p) {
  const where = inWords(p);
  const Where = where[0].toUpperCase() + where.slice(1);
  if (p.kind === "country") {
    if (p.usa) return "The United States as a whole is the yardstick: every other figure on this page is measured against its average prices.";
    return `${Where} is ${coverage(p)}, and the figure is one price level for the whole of it, for ${data.year}, from the World Bank. This page has city-level price data only for the United States, so every city, town and village in ${where} is treated as one place: prices in its big cities may be well above the figure used here.`
      + (p.noRate === "missing" ? ` The World Bank gives no official exchange rate for ${where} for ${data.year}, so the price level is worked out with the rate behind the Bank's own dollar figures and amounts are shown in US dollars only.`
        : p.noRate ? ` The World Bank does not turn the figures for ${where} into dollars at the official exchange rate for ${data.year}, so the price level is worked out with the rate the Bank does use and amounts are shown in US dollars only. "How it works" gives the reason for each such country.` : "");
  }
  const r = rankOf(data, p);
  const standing = !r ? "" : r.rank === 1 ? `, the dearest of the ${r.of} ${p.kind === "metro" ? "metropolitan areas" : "states (counting the District of Columbia)"}`
    : r.rank === r.of ? `, the cheapest of the ${r.of} ${p.kind === "metro" ? "metropolitan areas" : "states (counting the District of Columbia)"}`
    : `, ${ordinal(r.rank)} dearest of the ${r.of} ${p.kind === "metro" ? "metropolitan areas" : "states (counting the District of Columbia)"}`;
  const what = p.kind === "metro" ? "is a metropolitan area as the US government draws it: a city together with the surrounding counties tied to it by commuting"
    : p.rural ? "is every county in the United States outside a metropolitan area, taken together"
    : p.district ? "is the federal district, which the Bureau of Economic Analysis lists with the states"
    : `is ${KINDS[1].level}, cities and countryside together`;
  return `${Where} ${what}. Its regional price parity for ${data.year} is ${fmt.num(p.index, 1)} (US average 100)${standing}.`;
}

/** A plain reading of the comparison, as sentences. */
export function reading(data, r) {
  if (!r.ok) return [r.error];
  const A = inWords(r.a), B = inWords(r.b);
  const pay = r.unit === "local" ? `${asTyped(r.salary)} in ${currencyOf(r.a)} (${dollars(r.salaryUsd)} at the ${data.year} average exchange rate)` : `$${asTyped(r.salary)}`;
  if (r.same) return [`Both places are ${A}, so there is nothing to compare: a salary of ${pay} buys what ${dollars(r.realA)} buys at US-average prices.`];
  const out = [];
  const local = r.neededLocal == null ? "" : `, or about ${units(r.neededLocal)} in ${currencyOf(r.b)} at the World Bank's ${data.year} average rate of ${fmt.sig(r.b.rate, 4)} to the dollar`;
  out.push(r.ratio === 1
    ? `Prices in ${A} and ${B} are at the same level, so a salary of ${pay} buys the same in both.`
    : `A salary of ${pay} a year in ${A} buys what about ${dollars(r.needed)} a year buys in ${B}${local}. ${B[0].toUpperCase()}${B.slice(1)} is ${r.ratio > 1 ? "dearer" : "cheaper"}: the same pay goes ${r.stretch >= 1 ? `${fmt.num(1 + r.stretch, 1)} times as far` : moreOrLess(r.stretch).replace("more", "further").replace("less", "less far")} there.`);
  out.push(`Measured at US-average prices, the salary is worth ${dollars(r.realA)} in ${A} and ${dollars(r.realB)} in ${B}.`);
  if (r.widest) {
    const others = r.parts.filter((p) => p !== r.widest).map((p) => `${moreOrLess(p.gap)} for ${p.label.toLowerCase().replace(" (rents)", "")}`);
    const list = others.join(", ").replace(/, ([^,]*)$/, " and $1");
    const lead = r.widest.key === "housing" ? "Rents are where the two differ most: housing costs" : `${r.widest.label} are where the two differ most: ${r.widest.label.toLowerCase()} cost`;
    out.push(`${lead} ${moreOrLess(r.widest.gap)} in ${B} than in ${A}, against ${list}.`);
  } else if (!r.parts) {
    out.push("There is no breakdown by kind of spending for this pair: the World Bank's figure for a country is a single price level, with rents not separated out.");
  }
  if (mixed(r.a, r.b)) {
    const [us, abroad] = r.a.kind === "country" ? [r.b, r.a] : [r.a, r.b];
    out.push(`This pair sets ${us.kind === "metro" ? "one metropolitan area" : "one part of the United States"} against the average for the whole of ${inWords(abroad)}, and the two figures come from different sources with different baskets. Read the result as rougher than a comparison within the United States or between two countries.`);
  }
  return out;
}
