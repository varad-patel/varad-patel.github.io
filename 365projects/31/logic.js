// Day 31: What Is Driving Inflation? The model, with no DOM code.
// Splits the change in a chain-linked consumer price index between two months into one contribution per
// category of spending, and writes each one out as a sentence.

import { fmt } from "../kit/kit.js";

const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// Names that need "the" in a sentence.
const PLACE = { EA: "the euro area", EU27_2020: "the European Union", NL: "the Netherlands", UK: "the United Kingdom" };
/** A contribution smaller than this, in percentage points, is shown as 0.00 and is not called a push either way. */
export const SMALL = 0.005;

/** { year, month } of position i in the data's monthly arrays (month is 1 to 12). */
export function monthOf(data, i) {
  const [y, m] = data.first.split("-").map(Number);
  const k = m - 1 + i;
  return { year: y + Math.floor(k / 12), month: (k % 12) + 1 };
}
/** "October 2022", or "Oct 2022" when short. */
export function monthLabel(data, i, short = false) {
  const { year, month } = monthOf(data, i);
  return `${short ? NAMES[month - 1].slice(0, 3) : NAMES[month - 1]} ${year}`;
}
export const placeName = (country) => PLACE[country.code] || country.name;
export const categoriesOf = (data, country) => data.schemes[country.scheme].categories;
const lower = (s) => s[0].toLowerCase() + s.slice(1);

/**
 * Contribution of each category to the change in the all-items index between months a and b
 * (positions in the monthly arrays, a < b), in percentage points.
 *
 * The index is chain-linked: after each link month (December; for the UK also January) it is carried forward
 * with that year's weights and with every category's index measured from the link month. So between two months
 * with no link between them
 *
 *   I(end) - I(start) = I(base) × Σ w × (i(end) - i(start)) / i(base)        (w: weights of the year of `end`)
 *
 * for every category index i, where base is the last link month before `end`. Cutting a longer period at its link
 * months and dividing by I(a) gives each category's share of the whole change. For a 12-month period and a single
 * December link this is the formula Eurostat uses (the "Ribe contribution").
 *
 * Returns { error } when the period is not valid or a figure it needs was not published.
 */
export function decompose(data, country, a, b) {
  const cats = categoriesOf(data, country);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return { error: "Choose a start month and an end month." };
  if (a < 0 || b > country.last) return { error: `${country.name} has prices from ${monthLabel(data, 0)} to ${monthLabel(data, country.last)}. Choose months inside that range.` };
  if (a >= b) return { error: "The end month must come after the start month." };

  const isLink = (i) => country.links.includes(monthOf(data, i).month);
  const all = country.index[0];
  const nodes = [a];
  for (let i = a + 1; i < b; i++) if (isLink(i)) nodes.push(i);
  nodes.push(b);

  const points = cats.map(() => 0);
  const read = new Set(nodes); // every month whose published figures the split uses
  for (let n = 0; n + 1 < nodes.length; n++) {
    const start = nodes[n], end = nodes[n + 1];
    let base = end - 1;
    while (base >= 0 && !isLink(base)) base--;
    read.add(base);
    if (base < 0) return { error: `The record starts in ${monthLabel(data, 0)}, which is too late to work out a change from ${monthLabel(data, a)}. Choose a later start month.` };
    const year = monthOf(data, end).year;
    const w = country.weights[data.weightYears.indexOf(year)];
    if (!w || w.some((v) => v == null)) return { error: `No basket weights were published for ${country.name} in ${year}.` };
    if (all[base] == null || all[a] == null) return { error: `No all-items index was published for ${country.name} in ${monthLabel(data, all[a] == null ? a : base)}.` };
    let total = 0;
    for (const v of w) total += v;
    for (let k = 0; k < cats.length; k++) {
      if (!w[k]) continue; // a category with no weight cannot move the total, whatever its index did
      const s = country.index[k + 1];
      const gap = [end, start, base].find((i) => s[i] == null);
      if (gap != null) return { error: `No index was published for "${cats[k].name}" in ${monthLabel(data, gap)}, so this period cannot be split by category. Choose other months.` };
      points[k] += 100 * (w[k] / total) * ((s[end] - s[start]) / s[base]) * (all[base] / all[a]);
    }
  }
  if (all[b] == null) return { error: `No all-items index was published for ${country.name} in ${monthLabel(data, b)}.` };

  const endYear = monthOf(data, b).year;
  const wEnd = country.weights[data.weightYears.indexOf(endYear)];
  let wTotal = 0;
  for (const v of wEnd) wTotal += v;
  const total = 100 * (all[b] / all[a] - 1);
  let sum = 0;
  for (const p of points) sum += p;
  const months = b - a;
  return {
    a, b, months, endYear,
    flagged: flaggedSeries(data, country, read), // figures used that the source marks as estimated or of low reliability
    total, // change in the all-items index over the period, per cent, from the published index
    sum, // the categories added together, percentage points
    residual: total - sum, // what rounding in the published indices leaves over
    official: months === 12 && country.rate[b] != null ? country.rate[b] : null, // the published annual rate
    average: months > 12 ? 100 * ((all[b] / all[a]) ** (12 / months) - 1) : null, // per cent a year
    categories: cats.map((c, k) => {
      const s = country.index[k + 1];
      return { code: c.code, name: c.name, short: c.short, weight: wEnd[k] / wTotal, change: s[a] == null || s[b] == null ? null : 100 * (s[b] / s[a] - 1), points: points[k] };
    }),
  };
}

/**
 * The series whose published index carries a status flag in any of the months given (a Set of positions):
 * { e: [names], u: [names] }, keyed by the source's own flag ("e" estimated, "u" low reliability). The all-items
 * index is "all items" and a category goes by its short name. A flag with no series is left out.
 */
export function flaggedSeries(data, country, months) {
  const cats = categoriesOf(data, country);
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

/** One sentence for each kind of flag on the figures a result rests on. `series` is how many series the country has. */
export function flagNotes(data, flagged, series) {
  return Object.keys(flagged || {}).sort().map((f) => {
    const names = flagged[f];
    const what = names.length <= 3 ? `the ${names.length === 1 ? "index" : "indices"} for ${listed(names)}` : `${names.length} of the ${series} indices`;
    const how = FLAG_WORDS[f] || `"${data.flagLabels?.[f] || f}"`;
    return `Eurostat marks ${what} in one or more of the months used here as ${how}.`;
  });
}

/** The 12-month split for every month that has one: [{ i, rate, total, points: [...] }], oldest first. */
export function history(data, country) {
  const out = [];
  for (let i = 12; i <= country.last; i++) {
    const d = decompose(data, country, i - 12, i);
    if (!d.error) out.push({ i, rate: country.rate[i], total: d.total, points: d.categories.map((c) => c.points) });
  }
  return out;
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

/** "over the 12 months to October 2022" or "between January 2021 and December 2023". */
export function periodPhrase(data, r) {
  return r.months === 12 ? `over the 12 months to ${monthLabel(data, r.b)}` : `between ${monthLabel(data, r.a)} and ${monthLabel(data, r.b)}`;
}

// A figure that prints as 0.0 is "no change", whatever its sign.
const direction = (x) => (Math.round(Math.abs(x) * 10) === 0 ? 0 : Math.sign(x));
const pct = (x) => `${fmt.num(Math.abs(x), 1)}%`;
const pts = (x) => fmt.num(Math.abs(x), 2);
const WORDS = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const countWord = (n) => WORDS[n - 2] || String(n);

/** One sentence or two on a single category: what its prices did and what that did to the total. */
export function categoryReading(c, r) {
  if (c.change == null) return "No price index was published for this category in one of the two months.";
  const basket = `${fmt.num(c.weight * 100, 1)}% of the ${r.endYear} basket`;
  const tiny = direction(c.change) === 0; // prints as 0.0%
  const up = c.change > 0;
  const did = c.points > 0 ? `added ${pts(c.points)} points` : `took ${pts(c.points)} points off`;
  if (Math.abs(c.points) < SMALL) {
    return tiny
      ? "Prices changed by less than 0.05%, so this category did not move the total."
      : `Prices ${up ? "rose" : "fell"} ${pct(c.change)}, but at ${basket} that moved the total by less than 0.01 points.`;
  }
  if (Math.sign(c.change) === Math.sign(c.points)) {
    return `Prices ${up ? "rose" : "fell"} ${tiny ? "by less than 0.05%" : pct(c.change)}. At ${basket}, that ${did}.`;
  }
  // The price and the contribution point in opposite directions. That needs a link month inside the period:
  // the rises and the falls are then weighted differently.
  const why = `The basket is re-weighted every year, and its ${c.points > 0 ? "rises" : "falls"} came when it counted for more.`;
  return tiny
    ? `Prices ended within 0.05% of where they began, yet the category ${did}. ${why}`
    : `Prices ended ${pct(c.change)} ${up ? "higher" : "lower"}, yet the category ${did}. ${why}`;
}

/** The whole period in plain words: an array of sentences. */
export function summary(data, country, r) {
  const place = placeName(country);
  const when = periodPhrase(data, r);
  const out = [];
  if (r.official != null) {
    const d = direction(r.official);
    out.push(d === 0
      ? `In ${place}, prices were unchanged ${when}: the official annual rate of inflation was ${fmt.num(r.official, 1)}%.`
      : `In ${place}, prices ${d > 0 ? "rose" : "fell"} ${pct(r.official)} ${when}. That is the official annual rate of inflation.`);
  } else {
    const d = direction(r.total);
    const yearly = r.average == null ? "" : `, which is ${fmt.signed(r.average, 1)}% a year on average`;
    out.push(d === 0
      ? `In ${place}, prices ended ${monthLabel(data, r.b)} within 0.05% of where they stood in ${monthLabel(data, r.a)}.`
      : `In ${place}, prices ${d > 0 ? "rose" : "fell"} ${pct(r.total)} ${when}${yearly}.`);
  }
  const up = r.categories.filter((c) => c.points >= SMALL).sort((x, y) => y.points - x.points);
  const down = r.categories.filter((c) => c.points <= -SMALL).sort((x, y) => x.points - y.points);
  if (!up.length) out.push("No category pushed prices up.");
  else if (up.length === 1) out.push(`${up[0].name} was the only category to push prices up, adding ${pts(up[0].points)} points.`);
  else out.push(`${up[0].name} pushed up most, adding ${pts(up[0].points)} points, followed by ${lower(up[1].name)} (${pts(up[1].points)})${up.length > 2 ? ` and ${lower(up[2].name)} (${pts(up[2].points)})` : ""}.`);
  if (!down.length) out.push("No category pulled prices down.");
  else if (down.length === 1) out.push(`Only ${lower(down[0].name)} pulled prices down, taking ${pts(down[0].points)} points off.`);
  else out.push(`${down.length === r.categories.length ? "Every category" : `${countWord(down.length)} categories`} pulled prices down, led by ${lower(down[0].name)}, which took ${pts(down[0].points)} points off.`);
  return out;
}

/** x rounded to one decimal place, halves away from zero, as the statistical offices round a rate. */
export const oneDecimal = (x) => Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9) / 10;

/** How the categories, the published index and the official rate fit together, in one or two sentences. */
export function reconciliation(data, country, r) {
  const n = r.categories.length;
  const sum = fmt.signed(r.sum, 2), total = fmt.signed(r.total, 2);
  const out = [];
  // What is left over is the difference between the two figures as printed, so that the three numbers in the
  // sentence agree: 12.396 and 12.404 both print as 12.40, and nothing is then said to be left over.
  const printed = (x) => Number(fmt.num(x, 2).replace(/,/g, ""));
  const left = Math.abs(printed(r.total) - printed(r.sum));
  if (left < 0.005) out.push(`The ${n} categories add up to ${sum} points, which is the change in the published all-items index.`);
  else out.push(`The ${n} categories add up to ${sum} points and the published all-items index changed by ${total}%. The ${fmt.num(left, 2)} left over is rounding in the published indices, which have ${country.decimals === 1 ? "one decimal place" : "two decimal places"}.`);
  if (r.official != null && Math.abs(oneDecimal(r.total) - r.official) > 1e-9) {
    out.push(`The official rate is ${fmt.num(r.official, 1)}%, not ${fmt.num(oneDecimal(r.total), 1)}%, because it is worked out from indices with more decimal places than are published.`);
  }
  return out;
}
