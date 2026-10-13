// Day 32: Personal Inflation Calculator. The model, with no DOM code.
// Re-weights the official price changes of each category of spending with one household's own budget shares.

import { fmt } from "../kit/kit.js";

const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PLACE = { EA: "the euro area", EU27_2020: "the European Union", NL: "the Netherlands", UK: "the United Kingdom" };
/** The largest amount one box accepts. */
export const MAX_AMOUNT = 1e9;
/** The form always has the 13 divisions of ECOICOP version 2, whatever classification the country's index uses. */
export const FORM_SCHEME = "ecoicop2";

/**
 * Illustrative households. Every amount is invented for this page: monthly spending in any one currency, in the
 * order of the 13 form categories. None of them comes from a survey.
 */
export const HOUSEHOLDS = [
  { id: "retired", name: "Retired couple who own their home", spend: [520, 70, 70, 330, 110, 190, 210, 70, 230, 0, 150, 130, 120] },
  { id: "renter", name: "City renter without a car", spend: [330, 60, 90, 1100, 50, 40, 90, 80, 160, 0, 280, 40, 80] },
  { id: "family", name: "Family with two children and a car", spend: [750, 60, 180, 950, 150, 80, 620, 110, 260, 60, 220, 180, 230] },
  { id: "student", name: "Student in a rented room", spend: [220, 40, 30, 520, 10, 10, 60, 45, 50, 150, 90, 15, 30] },
];

export function monthOf(data, i) {
  const [y, m] = data.first.split("-").map(Number);
  const k = m - 1 + i;
  return { year: y + Math.floor(k / 12), month: (k % 12) + 1 };
}
export function monthLabel(data, i, short = false) {
  const { year, month } = monthOf(data, i);
  return `${short ? NAMES[month - 1].slice(0, 3) : NAMES[month - 1]} ${year}`;
}
export const placeName = (country) => PLACE[country.code] || country.name;
export const categoriesOf = (data, country) => data.schemes[country.scheme].categories;
export const formCategories = (data) => data.schemes[FORM_SCHEME].categories;
/** x rounded to one decimal place, halves away from zero, as the statistical offices round a rate. */
export const oneDecimal = (x) => Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9) / 10;
/** The first month that has a 12-month comparison, and the last, for this country. */
export const firstMonth = () => 12;

/**
 * Read one box of the form. An empty box is zero. Returns { value } or { error }.
 * `garbled` is true when the browser reports that what was typed is not a number at all.
 */
export function readAmount(raw, garbled = false) {
  const text = String(raw ?? "").trim();
  if (garbled) return { error: "is not a number. Use digits only, such as 250 or 250.50" };
  if (text === "") return { value: 0 };
  const v = Number(text);
  if (!Number.isFinite(v)) return { error: "is not a number. Use digits only, such as 250 or 250.50" };
  if (v < 0) return { error: "cannot be negative. Enter 0 if you spend nothing on it" };
  if (v > MAX_AMOUNT) return { error: `is too large. The limit is ${fmt.int(MAX_AMOUNT)}` };
  return { value: v };
}

/**
 * The form's 13 amounts in the categories of this country's index. For ECOICOP version 2 that is the same list.
 * The UK's index has 12 divisions: its last, "Miscellaneous goods and services", takes the form's last two
 * (insurance and financial services; personal care, social protection and miscellaneous).
 */
export function toScheme(data, country, spend) {
  const n = categoriesOf(data, country).length;
  if (n >= spend.length) return [...spend];
  return [...spend.slice(0, n - 1), spend.slice(n - 1).reduce((s, v) => s + v, 0)];
}

/**
 * The official basket for the year of month i as form amounts, scaled so that 1,000 parts are `total`.
 * Weights are published in parts per 1,000 with at most four decimals, so with the default total of 2,000 every
 * amount is the weight doubled, exactly: the form then holds the official shares themselves, and its rate is the
 * benchmark below and not a rounded neighbour of it. (Published weights add up to 1,000 only to within 0.03, so
 * the amounts add up to 2,000 to within a few hundredths.)
 */
export function officialSpend(data, country, i, total = 2000) {
  const w = country.weights[data.weightYears.indexOf(monthOf(data, i).year)];
  const amounts = w.map((v) => Math.round(((v * total) / 1000) * 1e4) / 1e4);
  // The UK's single last division cannot be split between the form's last two rows, so it all goes in the last one.
  const n = formCategories(data).length;
  return amounts.length === n ? amounts : [...amounts.slice(0, amounts.length - 1), 0, amounts[amounts.length - 1]];
}

/**
 * Contribution of each category to the official 12-month change to month i, in percentage points, by the
 * chain-linked (Ribe) formula: the same calculation as Day 31, cut at each link month.
 */
export function officialPoints(data, country, i) {
  const a = i - 12, all = country.index[0];
  const isLink = (m) => country.links.includes(monthOf(data, m).month);
  const nodes = [a];
  for (let m = a + 1; m < i; m++) if (isLink(m)) nodes.push(m);
  nodes.push(i);
  const points = country.index.slice(1).map(() => 0);
  for (let n = 0; n + 1 < nodes.length; n++) {
    const start = nodes[n], end = nodes[n + 1];
    let base = end - 1;
    while (base >= 0 && !isLink(base)) base--;
    const w = country.weights[data.weightYears.indexOf(monthOf(data, end).year)];
    if (base < 0 || !w) return null;
    const total = w.reduce((s, v) => s + v, 0);
    for (let k = 0; k < points.length; k++) {
      const s = country.index[k + 1];
      if (!w[k]) continue;
      if (s[end] == null || s[start] == null || s[base] == null || all[base] == null || all[a] == null) return null;
      points[k] += 100 * (w[k] / total) * ((s[end] - s[start]) / s[base]) * (all[base] / all[a]);
    }
  }
  return points;
}

/**
 * One household's inflation rate over the 12 months to month i.
 *
 * `spend` is the form's 13 amounts. They are turned into budget shares s, taken to be how the household divided
 * its spending at the start of the 12 months, and the rate is the change in the cost of that basket:
 *
 *   rate = Σ s × (i(t) / i(t - 12) - 1)            (i: the country's price index for the category)
 *
 * The official rate is not worked out like that. It is chain-linked: its basket is re-weighted every December, and
 * its weights are shares at the prices of that December, not of month t - 12. So the same formula with the
 * official weights of the year of month t, the `benchmark`, need not equal the official rate. The gap to the
 * official rate is therefore reported in two parts that add up to it as displayed:
 *
 *   spending = this basket - benchmark        (how the budget is divided)
 *   method   = benchmark - official rate      (fixed basket against chain-linked index)
 *
 * Returns { error } when nothing is entered, the month is outside the record, or a price is missing.
 */
export function personal(data, country, spend, i) {
  const cats = categoriesOf(data, country);
  if (!Number.isInteger(i) || i < firstMonth() || i > country.last) {
    return { error: `${country.name} has 12-month price changes from ${monthLabel(data, firstMonth())} to ${monthLabel(data, country.last)}. Choose a month inside that range.` };
  }
  if (!Array.isArray(spend) || spend.length !== formCategories(data).length || spend.some((v) => !Number.isFinite(v) || v < 0)) {
    return { error: "Every amount must be a number that is zero or more." };
  }
  const mine = toScheme(data, country, spend);
  const total = mine.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return { error: "Enter what you spend in at least one category. With every box at zero there is no basket to price." };

  const year = monthOf(data, i).year;
  const w = country.weights[data.weightYears.indexOf(year)];
  const wSum = w ? w.reduce((s, v) => s + (v || 0), 0) : 0;
  const official = officialPoints(data, country, i);
  let rate = 0;
  const benchmark = benchmarkRate(data, country, i); // the official basket priced the same way as this one
  const categories = [];
  for (let k = 0; k < cats.length; k++) {
    const s = country.index[k + 1];
    const share = mine[k] / total;
    const officialShare = wSum > 0 ? (w[k] || 0) / wSum : null;
    const change = s[i] == null || s[i - 12] == null ? null : 100 * (s[i] / s[i - 12] - 1);
    if (change == null && share > 0) return { error: `No price index was published for "${cats[k].name}" in ${monthLabel(data, s[i] == null ? i : i - 12)}, so a basket that includes it cannot be priced for this month. Choose another month.` };
    const points = share > 0 ? share * change : 0;
    rate += points;
    categories.push({
      code: cats[k].code, name: cats[k].name, short: cats[k].short, amount: mine[k], share, change, points,
      officialShare,
      officialPoints: official ? official[k] : null,
    });
  }
  const shown = oneDecimal(rate);
  const off = country.rate[i];
  const benchmarkShown = benchmark == null ? null : oneDecimal(benchmark);
  return {
    i, year, total, rate, shown,
    official: off, // the published annual rate, one decimal place
    gap: off == null ? null : oneDecimal(shown - off), // between the two figures as displayed
    benchmark, benchmarkShown, // the official weights of `year` as a fixed basket, exact and as displayed
    spending: benchmarkShown == null ? null : oneDecimal(shown - benchmarkShown), // gap that comes from the budget
    method: benchmarkShown == null || off == null ? null : oneDecimal(benchmarkShown - off), // gap that comes from the method
    before: total, after: total * (1 + rate / 100), // the basket's cost at the start and the end of the 12 months
    flagged: flaggedSeries(data, country, i),
    categories,
  };
}

/** The official basket of the year of month i priced as a fixed basket, per cent, or null if a price is missing. */
export function benchmarkRate(data, country, i) {
  const w = country.weights[data.weightYears.indexOf(monthOf(data, i).year)];
  if (!Number.isInteger(i) || i < firstMonth() || i > country.last || !w) return null;
  const sum = w.reduce((s, v) => s + (v || 0), 0);
  let out = 0;
  for (let k = 0; k < w.length; k++) {
    if (!w[k]) continue;
    const s = country.index[k + 1];
    if (s[i] == null || s[i - 12] == null) return null;
    out += (w[k] / sum) * 100 * (s[i] / s[i - 12] - 1);
  }
  return sum > 0 ? out : null;
}

/**
 * The household's rate, the official one and the official basket priced the household's way, for every month in
 * the record: [{ i, rate, official, benchmark }].
 */
export function series(data, country, spend) {
  const out = [];
  for (let i = firstMonth(); i <= country.last; i++) {
    const r = personal(data, country, spend, i);
    out.push({ i, rate: r.error ? null : r.rate, official: country.rate[i] ?? null, benchmark: benchmarkRate(data, country, i) });
  }
  return out;
}

/**
 * The series whose published index the source marks with a status flag in one of the months a result for month i
 * reads: i and i - 12 for the basket, and for the official split the link months before each of them as well.
 * { e: [names], u: [names] } with "e" for estimated and "u" for low reliability; a flag with no series is left out.
 */
export function flaggedSeries(data, country, i) {
  const cats = categoriesOf(data, country);
  const isLink = (m) => country.links.includes(monthOf(data, m).month);
  const nodes = [i - 12];
  for (let m = i - 11; m < i; m++) if (isLink(m)) nodes.push(m);
  nodes.push(i);
  const months = new Set(nodes);
  for (const end of nodes.slice(1)) { let b = end - 1; while (b >= 0 && !isLink(b)) b--; if (b >= 0) months.add(b); }
  const out = {};
  for (const [k, flag, from, to] of country.flags || []) {
    let hit = false;
    for (const m of months) if (m >= from && m <= to) { hit = true; break; }
    if (!hit) continue;
    const name = k === 0 ? "all items" : lower(cats[k - 1].short);
    if (!(out[flag] ||= []).includes(name)) out[flag].push(name);
  }
  return out;
}

const FLAG_WORDS = { e: "estimated", u: "of low reliability" };
const listed = (names) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** One sentence for each kind of flag on the figures a result rests on. `count` is how many series the country has. */
export function flagNotes(data, flagged, count) {
  return Object.keys(flagged || {}).sort().map((f) => {
    const names = flagged[f];
    const what = names.length <= 3 ? `the ${names.length === 1 ? "index" : "indices"} for ${listed(names)}` : `${names.length} of the ${count} indices`;
    const how = FLAG_WORDS[f] || `"${data.flagLabels?.[f] || f}"`;
    return `Eurostat marks ${what} in one or more of the months used here as ${how}.`;
  });
}

/** The surge in prices that followed the pandemic: January 2021 to December 2023, as [year, month] pairs. */
export const SURGE = [[2021, 1], [2023, 12]];

/**
 * Position of the month with the highest published annual rate between two months given as [year, month]
 * (the earliest, if several tie), or -1 if the country has no rate in that window. The default window is fixed
 * in the past, so the answer does not change when newer months are added to the data.
 */
export function peakMonth(data, country, from = SURGE[0], to = SURGE[1]) {
  const inside = (i) => { const { year, month } = monthOf(data, i); return (year > from[0] || (year === from[0] && month >= from[1])) && (year < to[0] || (year === to[0] && month <= to[1])); };
  let best = -1;
  for (let i = 12; i <= country.last; i++) if (inside(i) && country.rate[i] != null && (best < 0 || country.rate[i] > country.rate[best])) best = i;
  return best;
}

/** A category is named as the reason for a gap only if it accounts for at least this much of it, in points... */
export const REASON_MIN = 0.05;
/** ...and its share of the budget differs from its share of the official basket by at least this much. */
export const SHARE_MIN = 0.01;

/**
 * The category that does most to set the household's rate apart from that of the official basket priced the same
 * way (`spending`): the largest value, in the direction of that difference, of
 *
 *   (share of this budget - share of the official basket) × the category's price change
 *
 * These terms add up to rate - benchmark exactly, so nothing of the difference in method is mixed in.
 * Null when the two baskets come to the same figure, when the official weights are not available, or when no
 * category passes both thresholds above.
 */
export function mainReason(r) {
  if (!r.spending || r.categories.some((c) => c.officialShare == null)) return null;
  const sign = Math.sign(r.spending);
  let best = null;
  for (const c of r.categories) {
    if (c.change == null) continue;
    const d = (c.share - c.officialShare) * c.change * sign;
    if (d >= REASON_MIN && Math.abs(c.share - c.officialShare) >= SHARE_MIN && (!best || d > best.d)) best = { c, d };
  }
  return best ? { ...best.c, difference: best.d * sign } : null;
}

const pct = (x) => `${fmt.num(Math.abs(x), 1)}%`;
const money = (x) => (Math.abs(x) >= 100 ? fmt.int(x) : fmt.num(x, 2));
const moved = (x) => (oneDecimal(x) === 0 ? "changed by less than 0.05%" : `${x > 0 ? "rose" : "fell"} ${pct(x)}`);
const lower = (s) => s[0].toLowerCase() + s.slice(1);

/** The result in plain words: an array of sentences. */
export function reading(data, country, r) {
  const when = `over the 12 months to ${monthLabel(data, r.i)}`;
  const out = [];
  const mine = `The price of this basket ${moved(r.shown)} ${when}`;
  if (r.official == null) out.push(`${mine}. No official rate was published for that month.`);
  else if (r.gap === 0) out.push(`${mine}, the same as the official rate for ${placeName(country)} to one decimal place.`);
  else out.push(`${mine}, against an official rate of ${fmt.num(r.official, 1)}% for ${placeName(country)}: ${fmt.num(Math.abs(r.gap), 1)} ${Math.abs(r.gap) === 1 ? "point" : "points"} ${r.gap > 0 ? "higher" : "lower"}.`);
  if (money(r.before) !== money(r.after)) out.push(`What cost ${money(r.before)} a month at the start of those 12 months cost ${money(r.after)} at the end.`);
  // How much of the gap is method. The official index is chain-linked; this page prices one fixed basket.
  if (r.official != null && r.benchmarkShown != null) {
    const same = `the official basket for ${r.year}, priced the way this page prices a basket,`;
    const against = r.spending === 0 ? "this basket is the same to one decimal place" : `this basket is ${fmt.num(Math.abs(r.spending), 1)} ${Math.abs(r.spending) === 1 ? "point" : "points"} ${r.spending > 0 ? "higher" : "lower"}`;
    if (r.method !== 0) out.push(`The two figures are not worked out the same way: ${same} comes to ${fmt.num(r.benchmarkShown, 1)}%, not ${fmt.num(r.official, 1)}%. Against ${fmt.num(r.benchmarkShown, 1)}% ${against}.`);
    else if (r.gap !== 0) out.push(`In this month the method makes no difference: ${same} also comes to ${fmt.num(r.official, 1)}%.`);
  }
  const why = mainReason(r);
  if (why) {
    const shares = why.share > 0
      ? `it takes ${fmt.num(why.share * 100, 1)}% of this budget and ${fmt.num(why.officialShare * 100, 1)}% of the official basket`
      : `it is not in this budget and takes ${fmt.num(why.officialShare * 100, 1)}% of the official basket`;
    out.push(`The category that does most to set this basket apart from the official one is ${lower(why.name)}: ${shares}, and its prices ${moved(why.change)}.`);
  } else if (r.spending) {
    out.push("No single category sets this basket apart from the official one: the difference is spread thinly across the budget.");
  }
  return out;
}

/**
 * A warning for the tool when the method alone moves the figure by this many points or more in the month chosen:
 * the visitor should then judge the basket against the official basket priced the same way, not the official rate.
 */
export const METHOD_WARN = 0.3;
export function methodWarning(data, country, r) {
  if (r.method == null || Math.abs(r.method) < METHOD_WARN - 1e-9) return "";
  const size = fmt.num(Math.abs(r.method), 1);
  return `In this month the method alone moves the figure by ${size} ${size === "1.0" ? "point" : "points"}. The official index is re-weighted every December, and this page prices one fixed basket: the official basket for ${r.year} priced this way comes to ${fmt.num(r.benchmarkShown, 1)}%, where the official rate for ${placeName(country)} is ${fmt.num(r.official, 1)}%. Compare this basket with ${fmt.num(r.benchmarkShown, 1)}%.`;
}

/** One category in words. */
export function categoryReading(c) {
  const you = c.share > 0 ? `${fmt.num(c.share * 100, 1)}% of this budget` : "Not in this budget";
  const them = c.officialShare == null ? "" : `, ${fmt.num(c.officialShare * 100, 1)}% of the official basket`;
  if (c.change == null) return `${you}${them}. No price index was published for it in one of the two months.`;
  const price = `Prices ${moved(c.change)}`;
  const mine = c.share > 0 ? `${fmt.signed(c.points, 2)} points on this rate` : "nothing on this rate";
  const theirs = c.officialPoints == null ? "" : `, ${fmt.signed(c.officialPoints, 2)} on the official one`;
  return `${you}${them}. ${price}: ${mine}${theirs}.`;
}
