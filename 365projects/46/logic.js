// Day 46: Income Inequality Explorer. The model, with no DOM code.
// Lorenz curves and Gini indices from the ten shares the World Bank publishes for each household survey.

import { fmt } from "../kit/kit.js";
import { PIP } from "./data.js";

export const MAX_PICKS = 4;

/** Every series in the module as an object. A series is one country and one kind of survey (income or consumption). */
export function seriesList(data = PIP) {
  return data.series.map(([code, name, welfare, level, rows]) => ({
    id: `${code}:${welfare}`, code, name, welfare, level,
    label: `${name} (${welfare}${level === "urban" ? ", urban areas only" : ""})`,
    rows: rows.map(([year, gini, code2, kind, ...shares]) => ({ year, gini, code: code2, kind, shares })),
    first: rows[0][0], last: rows[rows.length - 1][0],
  }));
}

/* ---------- one survey ---------- */

/** The eleven points of the Lorenz curve through ten shares: [share of people, share of the total they hold]. */
export function lorenz(shares) {
  if (!Array.isArray(shares) || shares.length !== 10 || shares.some((v) => !(v >= 0) || !Number.isFinite(v))) return null;
  const total = shares.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  let run = 0;
  return [[0, 0], ...shares.map((v, i) => { run += v; return [(i + 1) / 10, i === 9 ? 1 : run / total]; })];
}

/** Gini coefficient (0 to 1) of the straight-line curve through the ten shares: 1 minus twice the area under it. */
export function giniFromShares(shares) {
  const curve = lorenz(shares);
  if (!curve) return NaN;
  let area = 0;
  for (let k = 1; k <= 10; k++) area += 0.1 * (curve[k][1] + curve[k - 1][1]) / 2;
  return 1 - 2 * area;
}

/** The exact Gini coefficient of a list of amounts, one per person. The page does not use it; the tests do. */
export function giniExact(values) {
  const x = [...values].sort((a, b) => a - b);
  const n = x.length;
  let total = 0, weighted = 0;
  for (let i = 0; i < n; i++) { total += x[i]; weighted += (2 * (i + 1) - n - 1) * x[i]; }
  return n && total > 0 ? weighted / (n * total) : NaN;
}

const tenths = (x) => Math.round(x * 10) / 10;
/** The Bank's Gini index on the 0 to 100 scale, to one decimal place. */
export const bankGini = (row) => Math.round(row.gini / 10) / 10;

/**
 * The ten-share Gini on the 0 to 100 scale, to one decimal place, halves rounded up like the Bank's figure.
 * The stored shares are whole numbers, so this is worked out in whole numbers: with T the sum of the shares and S the sum
 * of the first nine running totals, 100 G = 90 - 20 S / T. Floating point puts an exact 33.05 a hair below and prints 33.0.
 */
export function giniSharesRounded(shares) {
  if (!lorenz(shares)) return NaN;
  if (!shares.every(Number.isSafeInteger)) return tenths(100 * giniFromShares(shares));
  let total = 0, run = 0, runs = 0;
  shares.forEach((v, k) => { total += v; run += v; if (k < 9) runs += run; });
  return Math.floor((2 * (900 * total - 200 * runs) + total) / (2 * total)) / 10;
}

/** The numbers quoted for one survey. Shares are fractions of the total; Gini figures are on the 0 to 100 scale, to one decimal. */
export function measures(row) {
  const total = row.shares.reduce((s, v) => s + v, 0);
  const sum = (from, to) => row.shares.slice(from, to).reduce((s, v) => s + v, 0) / total;
  const giniShares = giniSharesRounded(row.shares);
  const giniBank = bankGini(row);
  return {
    bottom10: sum(0, 1), bottom50: sum(0, 5), top10: sum(9, 10),
    topToBottom: row.shares[9] / row.shares[0],
    giniShares, giniBank, gap: tenths(giniBank - giniShares),
    ascending: row.shares.every((v, i) => i === 0 || v >= row.shares[i - 1]),
  };
}

/** The most recent survey of a series in or before a year, or null. */
export function surveyAt(series, year) {
  let hit = null;
  for (const row of series.rows) if (row.year <= year) hit = row;
  return hit;
}

/* ---------- a series over time ---------- */

/**
 * The runs of surveys the Bank treats as comparable with each other: the surveys that share one comparability code.
 * Runs can interleave (two surveys run side by side in alternate years), so they are not always blocks of years.
 * Each run gets a letter, A for the earliest.
 */
export function runs(series) {
  const byCode = new Map();
  for (const row of series.rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, []);
    byCode.get(row.code).push(row);
  }
  return [...byCode.values()].map((rows, i) => ({ letter: String.fromCharCode(65 + i), rows }));
}

/** The comparable run that holds a survey, with the Bank's Gini at its first and last survey and the change between them. */
export function trend(series, row) {
  const all = runs(series);
  const run = all.find((r) => r.rows.includes(row));
  const first = run.rows[0], last = run.rows[run.rows.length - 1];
  const from = bankGini(first), to = bankGini(last);
  return { letter: run.letter, runs: all.length, surveys: run.rows.length, first: first.year, last: last.year, from, to, change: tenths(to - from) };
}

/* ---------- two surveys ---------- */

/**
 * Compare two Lorenz curves at the nine points the data hold (the poorest 10%, 20%, ... 90%), exactly.
 * relation: "above" (a holds more at every point), "below", "same", "cross", or "atOrAbove" / "atOrBelow" when some
 * points tie. signs[k] is 1, 0 or -1 for the poorest (k + 1) tenths. Shares are whole numbers, so nothing is rounded.
 */
export function compareCurves(a, b) {
  const ta = a.reduce((s, v) => s + v, 0), tb = b.reduce((s, v) => s + v, 0);
  const signs = [];
  let ca = 0, cb = 0;
  for (let k = 0; k < 9; k++) {
    ca += a[k]; cb += b[k];
    signs.push(Math.sign(ca * tb - cb * ta));
  }
  const up = signs.filter((s) => s > 0).length, down = signs.filter((s) => s < 0).length;
  const relation = up && down ? "cross" : up === 9 ? "above" : down === 9 ? "below" : up ? "atOrAbove" : down ? "atOrBelow" : "same";
  return { relation, signs, up, down };
}

/* ---------- the whole snapshot ---------- */

/** How far the ten-share Gini falls short of the Bank's own, over every survey in the module (points on the 0 to 100 scale). */
export function gapStats(data = PIP) {
  let n = 0, sum = 0, min = null, max = null, below = 0;
  for (const s of seriesList(data)) for (const row of s.rows) {
    const gap = row.gini / 100 - 100 * giniFromShares(row.shares);
    n++; sum += gap;
    if (gap > 0) below++;
    if (!min || gap < min.gap) min = { gap, name: s.name, year: row.year };
    if (!max || gap > max.gap) max = { gap, name: s.name, year: row.year };
  }
  return { n, mean: sum / n, min, max, below };
}

/** Countries surveyed both ways in one year: the Bank's Gini of income against its Gini of consumption (points, 0 to 100). */
export function pairedStats(data = PIP) {
  const all = seriesList(data).filter((s) => s.level === "national");
  const pairs = [];
  for (const inc of all.filter((s) => s.welfare === "income")) {
    const con = all.find((s) => s.code === inc.code && s.welfare === "consumption");
    if (!con) continue;
    for (const a of inc.rows) {
      const b = con.rows.find((r) => r.year === a.year);
      if (b) pairs.push({ code: inc.code, name: inc.name, year: a.year, income: a.gini / 100, consumption: b.gini / 100, diff: (a.gini - b.gini) / 100 });
    }
  }
  const n = pairs.length;
  return {
    n, countries: new Set(pairs.map((p) => p.code)).size, pairs,
    incomeHigher: pairs.filter((p) => p.diff > 0).length, equal: pairs.filter((p) => p.diff === 0).length,
    mean: n ? pairs.reduce((s, p) => s + p.diff, 0) / n : NaN,
  };
}
let pairedCache = null;
const paired = () => (pairedCache ||= pairedStats());

/* ---------- plain sentences ---------- */

// Names that take "the" inside a sentence.
const WITH_THE = new Set(["Central African Republic", "Comoros", "Democratic Republic of the Congo", "Dominican Republic", "Gambia",
  "Kyrgyz Republic", "Maldives", "Marshall Islands", "Netherlands", "Philippines", "Republic of the Congo", "Russian Federation",
  "Seychelles", "Slovak Republic", "Solomon Islands", "Syrian Arab Republic", "United Arab Emirates", "United Kingdom", "United States",
  "West Bank and Gaza"]);
export const the = (name) => (WITH_THE.has(name) ? `the ${name}` : name);

const pct = (x) => fmt.pct(x, 1);
const g1 = (x) => fmt.num(x, 1);
const times = (x) => (x >= 9.95 ? fmt.int(x) : fmt.num(x, 1));
const points = (x) => `${g1(Math.abs(x))} ${Math.abs(x) === 1 ? "point" : "points"}`;
// A name that holds a comma ("Taiwan, China") would read as two places in a list, so such a list is cut with semicolons.
const list = (items) => {
  if (items.length < 2) return items.join("");
  const semi = items.some((x) => x.includes(","));
  return `${items.slice(0, -1).join(semi ? "; " : ", ")}${semi ? ";" : ""} and ${items[items.length - 1]}`;
};

/** What a survey of this kind measures. */
export function measureText(series, row) {
  const parts = [series.welfare === "income"
    ? "This is a survey of income. The Bank's income figures aim at disposable income (earnings, pensions and transfers received, less taxes and contributions), though what each survey records varies."
    : "This is a survey of consumption: the value of what each household bought, grew for itself or was given, and used. It is not income, and taxes enter it only through the prices paid."];
  parts.push("A household's total is divided equally among its members, so every person counts once, children included.");
  if (series.level === "urban") parts.push("The survey covers urban areas only.");
  if (row.kind === 1) parts.push("The Bank had grouped figures for this survey, not household records, and fitted a curve to them.");
  if (row.kind === 2) parts.push("The Bank labels this distribution synthetic: it was generated from grouped figures, not taken from household records.");
  if (row.kind === 3) parts.push("The Bank labels this distribution imputed: consumption was predicted for each household from other answers, not measured in full.");
  return parts.join(" ");
}

/** The shares of one survey in words. */
export function sharesText(series, row) {
  const m = measures(row);
  const half = pct(m.bottom50), top = pct(m.top10);
  const versus = half === top ? "the same share as" : m.top10 > m.bottom50 ? "more than" : "less than";
  const parts = [
    `The poorest half of the population held ${half} of all ${series.welfare} and the richest tenth held ${top}, ${versus} the poorest half.`,
    `The poorest tenth held ${pct(m.bottom10)}, so a person in the richest tenth had on average ${times(m.topToBottom)} times the ${series.welfare} of a person in the poorest tenth.`,
    "With equal shares every tenth would hold 10.0%.",
  ];
  if (!m.ascending) parts.push("The published shares for this survey are not in ascending order, as the shares of tenths ranked from poorest to richest should be. They are shown as published.");
  return parts.join(" ");
}

/** The two Gini figures of one survey in words. */
export function giniText(series, row) {
  const m = measures(row);
  return `The Gini index worked out here from the ten shares is ${g1(m.giniShares)}, on a scale from 0 (everyone has the same) to 100 (one person has everything). The Bank's own figure, from the full distribution, is ${g1(m.giniBank)}. The ten-share figure is ${points(m.gap)} lower because it treats everyone inside a tenth as having the same ${series.welfare}.`;
}

/** The Bank's Gini over the comparable run that holds this survey, in words. */
export function trendText(series, row) {
  const t = trend(series, row);
  if (t.surveys === 1) {
    return t.runs === 1
      ? "This is the only survey of this kind for this country in the data, so there is no change over time to report."
      : `The Bank treats this survey as comparable with no other (it is run ${t.letter} of ${t.runs} in the table below), so no change over time is reported for it.`;
  }
  const run = `This survey belongs to a run of ${t.surveys} surveys, ${t.first} to ${t.last}, that the Bank treats as comparable with each other${t.runs > 1 ? ` (run ${t.letter} of ${t.runs} in the table below)` : ""}.`;
  const change = t.change === 0
    ? `The Bank's Gini index was ${g1(t.from)} at both ends of that run.`
    : `Over that run the Bank's Gini index ${t.change > 0 ? "rose" : "fell"} from ${g1(t.from)} to ${g1(t.to)}, a ${t.change > 0 ? "rise" : "fall"} of ${points(t.change)}.`;
  return `${run} ${change}${t.runs > 1 ? " Surveys in different runs should not be compared, and the chart joins only surveys of one run." : ""}`;
}

/** What the comparisons below it mean, said once. */
export const COMPARE_NOTE = "A curve that lies above another at every point belongs to a place where the poorest 10%, 20% and so on up to 90% each hold a larger share of the total. If that is also true between the nine points the data hold, every measure of relative inequality that falls when money passes from a richer person to a poorer one ranks that place as the more equal. When two curves cross, which is the more unequal depends on the measure chosen.";

/**
 * Two surveys side by side, in words. a and b are { series, row }.
 * Every survey is named with its kind as well as its year, because a country can be on screen twice: without the kind,
 * "Poland (2019) lies above Romania (2019)" and "Romania (2019) lies above Poland (2019)" could both appear. Two surveys
 * of one country are introduced by the country's name.
 */
export function compareText(a, b) {
  const c = compareCurves(a.row.shares, b.row.shares);
  const sameCountry = a.series.code === b.series.code;
  const kind = (x) => `${x.series.welfare}${x.series.level === "urban" ? ", urban" : ""}`;
  const tag = (x) => (sameCountry ? `the ${x.series.welfare} survey of ${x.row.year}` : `${the(x.series.name)} (${kind(x)}, ${x.row.year})`);
  const place = (x) => (sameCountry ? `the ${x.series.welfare} survey` : the(x.series.name));
  const lead = (text) => (sameCountry ? `In ${the(a.series.name)}, ${text[0].toLowerCase()}${text.slice(1)}` : text);
  const hold = (want, x) => {
    const groups = c.signs.map((s, k) => (s === want ? `${(k + 1) * 10}%` : null)).filter(Boolean);
    return `the poorest ${list(groups)} of people ${groups.length > 1 ? "each hold" : "hold"} a larger share of the total in ${place(x)}`;
  };
  const ga = bankGini(a.row), gb = bankGini(b.row);
  const parts = [];
  if (c.relation === "same") parts.push(lead(`The curves for ${tag(a)} and ${tag(b)} are the same at all nine points.`));
  else if (c.relation === "cross") parts.push(lead(`The curves for ${tag(a)} and ${tag(b)} cross: ${hold(1, a)}, and ${hold(-1, b)}.`));
  else {
    const [hi, lo] = c.relation.endsWith("ove") ? [a, b] : [b, a];
    const strict = c.relation === "above" || c.relation === "below";
    parts.push(lead(strict
      ? `The curve for ${tag(hi)} lies above the curve for ${tag(lo)} at all nine points.`
      : `The curve for ${tag(hi)} is level with or above the curve for ${tag(lo)} at all nine points, and above it at ${c.up || c.down} of them.`));
    const [gHi, gLo] = hi === a ? [ga, gb] : [gb, ga];
    if (gHi >= gLo) parts.push(`The Bank's Gini index does not show ${place(hi)} as the more equal, because it also counts the inequality inside each tenth, which ten shares cannot show.`);
  }
  parts.push(ga === gb ? `The Bank's Gini index is ${g1(ga)} for both.` : `The Bank's Gini index is ${g1(ga)} for ${tag(a)} and ${g1(gb)} for ${tag(b)}.`);
  const mixed = a.series.welfare !== b.series.welfare;
  if (sameCountry) {
    parts.push(a.row.year === b.row.year
      ? "These are two surveys of one country in one year, one of income and one of consumption, so the gap between them shows what the choice of measure does."
      : "These are two surveys of one country, one of income and one of consumption, taken in different years, so the gap between them mixes the choice of measure with the passage of time.");
  }
  else if (mixed) parts.push("One is a survey of income and the other of consumption, so the caution about mixed measures applies.");
  return { ...c, mixed, text: parts.join(" ") };
}

/** The caution shown once when the surveys on screen are not all of one kind. items are { series, row }; "" when they are. */
export function mixedText(items, stats = paired()) {
  const names = (welfare) => [...new Set(items.filter((x) => x.series.welfare === welfare).map((x) => the(x.series.name)))];
  const inc = names("income"), con = names("consumption");
  if (!inc.length || !con.length) return "";
  return `The surveys shown are of two kinds: income for ${list(inc)} and consumption for ${list(con)}. Where the Bank has both kinds for one country and year, the income index is the higher in ${stats.incomeHigher} of ${stats.n} cases, by ${g1(stats.mean)} points on average over all ${stats.n}. Part of any gap between a country measured one way and a country measured the other may therefore be the measure and not the country.`;
}
