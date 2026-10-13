// Day 38: Price Elasticity Lab. The model, with no DOM code.
// Reads a table of prices and quantities, fits a constant-elasticity (log-log) demand curve and a straight-line
// one, and works out what each can and cannot say about the price that brings in most revenue or profit.

import { csv, rng, stats } from "../kit/kit.js";

// bytes: a file is refused before it is read. rows: enough for decades of daily sales, and few enough that reading and
// fitting each take well under a tenth of a second. magnitude: numbers beyond 1e12 (or nearer zero than 1e-9) are refused.
export const LIMITS = { bytes: 2e6, rows: 20000, groups: 12, minRows: 8, minPrices: 3, magnitude: 1e12, tiny: 1e-9, cost: 1e9, name: 60 };

const MISSING = new Set(["", "na", "n/a", "nan", "null", "none", "?", "-", "."]);
const plural = (n, word) => `${n.toLocaleString("en-GB")} ${word}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------------- the t distribution */

// Continued fraction for the incomplete beta function (modified Lentz).
function betacf(x, a, b) {
  const TINY = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}
/** Regularised incomplete beta function I_x(a, b). */
export function ibeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(stats.logGamma(a + b) - stats.logGamma(a) - stats.logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betacf(x, a, b)) / a : 1 - (front * betacf(1 - x, b, a)) / b;
}
/** P(T <= t) for Student's t with df degrees of freedom. */
export function tCdf(t, df) {
  const tail = 0.5 * ibeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}
/** The value t with P(T <= t) = p, by bisection. tQuantile(0.975, 10) is 2.228. */
export function tQuantile(p, df) {
  if (!(p > 0 && p < 1) || !(df >= 1)) return NaN;
  if (p === 0.5) return 0;
  if (p < 0.5) return -tQuantile(1 - p, df);
  let lo = 0, hi = 1;
  while (tCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-12 * Math.max(1, hi); i++) { const mid = (lo + hi) / 2; if (tCdf(mid, df) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/* --------------------------------------------------------------------- reading */

/** "1,234.5", "3,5", "45%", "£12" and "1e3" all read as numbers. Anything else is NaN. (As on day 14.) */
export function toNumber(s) {
  let t = String(s).replace(/[\s£$€%]/g, "");
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  if (t === "") return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * Bytes of a text file to a string: { text, encoding }. UTF-8 unless the bytes say otherwise: a UTF-16 byte-order mark,
 * a zero byte beside almost every character (UTF-16 without a mark), or bytes that are not valid UTF-8, which are read
 * as Windows-1252, the usual encoding of CSV files saved by older spreadsheet programs. (As on day 14.)
 */
export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const as = (encoding, from = 0) => ({ text: new TextDecoder(encoding).decode(b.subarray(from)), encoding });
  if (b[0] === 0xff && b[1] === 0xfe) return as("utf-16le", 2);
  if (b[0] === 0xfe && b[1] === 0xff) return as("utf-16be", 2);
  const n = Math.min(b.length, 4000) & ~1;
  let even = 0, odd = 0;
  for (let i = 0; i < n; i += 2) { if (b[i] === 0) even++; if (b[i + 1] === 0) odd++; }
  if (n >= 8 && odd > n * 0.3 && even < n * 0.05) return as("utf-16le");
  if (n >= 8 && even > n * 0.3 && odd < n * 0.05) return as("utf-16be");
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(b), encoding: "utf-8" }; } catch { return as("windows-1252"); }
}

/**
 * A date as a day number (days since 1970-01-01, UTC), or NaN. Read: 2025-03-31 (or with / or .), 2025-03 (the first
 * of the month; - or / only, so that a number such as 2025.5 is not taken for a date), and 31/03/2025 (day first,
 * unless the middle number is over 12). Years from 1900 to 2100 only.
 */
export function toDay(s) {
  const t = String(s).trim();
  let y, m, d, k;
  if ((k = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:[T ].*)?$/.exec(t))) { y = +k[1]; m = +k[3]; d = +k[4]; }
  else if ((k = /^(\d{4})[-/](\d{1,2})$/.exec(t))) { y = +k[1]; m = +k[2]; d = 1; }
  else if ((k = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(t))) { d = +k[1]; m = +k[3]; y = +k[4]; if (m > 12 && d <= 12) [d, m] = [m, d]; }
  else return NaN;
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  return y >= 1900 && y <= 2100 && back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? ms / 86400000 : NaN;
}

/** Delimited text to columns of trimmed strings: { names, raw, n, warnings } or { error }. */
export function parseTable(text) {
  if (typeof text !== "string" || !text.trim()) return { error: "There is no data yet. Paste CSV text, drop a file or pick an example." };
  // A zero byte, or any other control character that no text table holds (tab, line feed, form feed and carriage return are fine).
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) return { error: "This looks like a spreadsheet or another binary file, not text. Save it as CSV (comma-separated values) and try again." };
  const grid = csv.parse(text).filter((r) => r.length > 1 || r[0].trim() !== "");
  // A quotation mark that is opened and never closed swallows the rest of the table into one cell. With too few rows
  // left to fit, that is the error to report; with enough, the fit goes ahead and the visitor is told rows may be missing.
  const swallowed = grid.findIndex((r) => r.some((c) => c.length > 200 && c.split(/\r\n|\r|\n/).length > 5));
  const unclosed = swallowed >= 0 ? `One cell, on line ${swallowed + 1} of the table, holds more than five lines of text. A quotation mark was probably opened there and never closed` : "";
  if (unclosed && grid.length <= LIMITS.minRows) return { error: `${unclosed}: close it, or remove it, and try again.` };
  if (!grid.length) return { error: "There is no data yet. Paste CSV text, drop a file or pick an example." };
  const widest = Math.max(...grid.slice(0, 50).map((r) => r.length));
  if (widest < 2) return { error: "Only one column was found. The lab needs a price column and a quantity column, separated by commas, tabs or semicolons." };
  const warnings = [];
  if (unclosed) warnings.push(`${unclosed}, in which case the lines after it were not read as rows. Close it, or remove it, and load the table again.`);
  // A first line made only of numbers is data, not names.
  const headless = grid[0].length >= 2 && grid[0].every((c) => c.trim() === "" || !Number.isNaN(toNumber(c))) && grid[0].some((c) => c.trim() !== "");
  const head = headless ? grid[0].map((_, i) => `Column ${i + 1}`) : grid[0];
  const body = headless ? grid : grid.slice(1);
  if (headless) warnings.push("The first line holds only numbers, so it was read as data and the columns were numbered. Put a line of column names above the data if the first line is meant to be names.");
  if (!body.length) return { error: "Only one line of text was found. The first line must hold the column names, with the data on the lines below it." };
  if (head.length < 2) {
    const wider = body.slice(0, 20).findIndex((r) => r.length >= 2);
    return { error: `Only 1 column found on the first line.${wider >= 0 ? " Lines further down have more cells, so the file probably starts with a title or a note: delete everything above the line of column names and try again." : " The lab needs a price column and a quantity column, separated by commas, tabs or semicolons."}` };
  }
  const seen = new Map();
  const names = head.map((h, i) => {
    let name = h.trim() || `Column ${i + 1}`;
    if (name.length > LIMITS.name) name = `${name.slice(0, LIMITS.name - 1)}…`;
    const k = (seen.get(name) || 0) + 1;
    seen.set(name, k);
    return k > 1 ? `${name} (${k})` : name;
  });
  const total = body.length;
  const n = Math.min(total, LIMITS.rows);
  const raw = names.map(() => new Array(n));
  let ragged = 0;
  for (let i = 0; i < n; i++) {
    const r = body[i];
    if (r.length !== names.length) ragged++;
    for (let j = 0; j < names.length; j++) raw[j][i] = (r[j] ?? "").trim();
  }
  if (ragged > n / 2) return { error: `${plural(ragged, "line")} of ${n.toLocaleString("en-GB")} do not have ${names.length} cells like the first line. Check that every line uses the same separator and that quotation marks are closed.` };
  if (ragged) warnings.push(`${plural(ragged, "line")} had more or fewer than ${names.length} cells. Missing cells were read as blank and extra cells were ignored.`);
  if (total > n) warnings.push(`The table has ${total.toLocaleString("en-GB")} rows. Only the first ${n.toLocaleString("en-GB")} were read.`);
  return { names, raw, n, total, warnings };
}

/** What a column holds: how many cells are numbers, positive numbers and dates, and its different values (up to 13). */
export function profileColumn(table, index) {
  const raw = table.raw[index];
  let filled = 0, numbers = 0, positive = 0, dates = 0;
  const num = new Float64Array(table.n), day = new Float64Array(table.n);
  const values = new Set();
  for (let i = 0; i < table.n; i++) {
    const cell = raw[i];
    num[i] = NaN; day[i] = NaN;
    if (MISSING.has(cell.toLowerCase())) continue;
    filled++;
    num[i] = toNumber(cell);
    if (num[i] === num[i]) { numbers++; if (num[i] > 0) positive++; }
    day[i] = toDay(cell);
    if (day[i] === day[i]) dates++;
    if (values.size <= LIMITS.groups) values.add(cell);
  }
  const numeric = filled > 0 && numbers / filled >= 0.9;
  const date = filled > 0 && dates / filled >= 0.9;
  return { index, name: table.names[index], filled, numbers, positive, dates, numeric, date, num, day, distinct: values.size, levels: values.size <= LIMITS.groups ? [...values].sort((a, b) => a.localeCompare(b, "en", { numeric: true })) : null };
}
export const profile = (table) => table.names.map((_, i) => profileColumn(table, i));

const PRICE = /price|prix|preis|precio|fare|tariff|fee\b/i;
const QUANTITY = /quant|qty|units|sold|sales|volume|demand|orders?\b|count|riders|trips|tickets|cups|pints/i;
const GROUP = /group|product|store|shop|region|categ|segment|sku|brand|type|branch|city|market/i;
const TIME = /date|week|month|day|period|time|year/i;

/** A first guess at which column is which: { price, quantity, group, date } as column indexes or null. */
export function guessRoles(cols) {
  const nums = cols.filter((c) => c.numeric && !c.date);
  const price = nums.find((c) => PRICE.test(c.name) && !QUANTITY.test(c.name)) || nums.find((c) => !QUANTITY.test(c.name) && !TIME.test(c.name)) || nums[0] || null;
  const rest = nums.filter((c) => c !== price);
  const quantity = rest.find((c) => QUANTITY.test(c.name)) || rest.find((c) => !TIME.test(c.name)) || rest[0] || null;
  const used = new Set([price?.index, quantity?.index]);
  const date = cols.find((c) => c.date && !used.has(c.index)) || cols.find((c) => c.numeric && TIME.test(c.name) && !used.has(c.index)) || null;
  if (date) used.add(date.index);
  const groupable = cols.filter((c) => !used.has(c.index) && c.levels && c.distinct >= 2 && !(c.numeric && c.distinct > 6));
  const group = groupable.find((c) => GROUP.test(c.name)) || groupable.find((c) => !c.numeric) || null;
  return { price: price ? price.index : null, quantity: quantity ? quantity.index : null, group: group ? group.index : null, date: date ? date.index : null };
}

/**
 * The rows that can be used: { rows: [{ p, q, g, t }], dropped, groups, time } or { error }.
 * A row needs a price above zero and a quantity above zero (a logarithm has no value at zero), and a group or date
 * if one is asked for. g is an index into groups; t is days (for a date column) or the column's own number.
 */
export function prepare(table, cols, roles) {
  const P = cols[roles.price], Q = cols[roles.quantity];
  if (!P || !Q) {
    const numeric = cols.filter((c) => c.numeric && !c.date).length;
    if (numeric >= 2) return { error: "Choose a price column and a quantity column." };
    return { error: `${numeric === 0 ? "None" : "Only one"} of the ${plural(cols.length, "column")} holds numbers. The lab needs two columns of numbers: a price and a quantity.` };
  }
  if (P === Q) return { error: `"${P.name}" is set as both the price and the quantity. Choose two different columns.` };
  if (!P.numeric) return { error: `The price column "${P.name}" does not hold numbers: only ${plural(P.numbers, "cell")} of ${P.filled.toLocaleString("en-GB")} could be read as one.` };
  if (!Q.numeric) return { error: `The quantity column "${Q.name}" does not hold numbers: only ${plural(Q.numbers, "cell")} of ${Q.filled.toLocaleString("en-GB")} could be read as one.` };
  const G = roles.group != null ? cols[roles.group] : null, D = roles.date != null ? cols[roles.date] : null;
  const clash = (a, b) => `"${a.name}" is set as both ${b}. Choose a different column for one of them, or none.`;
  if (G && (G === P || G === Q)) return { error: clash(G, `the group and the ${G === P ? "price" : "quantity"}`) };
  if (D && (D === P || D === Q)) return { error: clash(D, `the date and the ${D === P ? "price" : "quantity"}`) };
  if (D && D === G) return { error: clash(D, "the group and the date") };
  if (G && !G.levels) return { error: `"${G.name}" has more than ${LIMITS.groups} different values, too many to treat as groups. Choose a column with fewer, or none.` };
  if (D && !D.date && !D.numeric) return { error: `"${D.name}" could not be read as dates or as numbers. Dates should look like 2025-03-31 or 31/03/2025. Choose another column, or none.` };
  const time = D ? (D.date ? "date" : "number") : null;
  const dropped = { blank: 0, notNumber: 0, priceNotPositive: 0, quantityNotPositive: 0, noGroup: 0, noDate: 0 };
  const groups = G ? G.levels : null;
  const code = groups ? new Map(groups.map((l, i) => [l, i])) : null;
  const rows = [];
  for (let i = 0; i < table.n; i++) {
    const pr = table.raw[P.index][i], qr = table.raw[Q.index][i];
    if (MISSING.has(pr.toLowerCase()) || MISSING.has(qr.toLowerCase())) { dropped.blank++; continue; }
    const p = P.num[i], q = Q.num[i];
    if (p !== p || q !== q) { dropped.notNumber++; continue; }
    if (Math.abs(p) > LIMITS.magnitude || Math.abs(q) > LIMITS.magnitude || (p > 0 && p < LIMITS.tiny) || (q > 0 && q < LIMITS.tiny)) {
      return { error: `Row ${(i + 1).toLocaleString("en-GB")} holds a number too large or too small to work with (beyond a million million, or closer to zero than a billionth). Check the units of "${P.name}" and "${Q.name}".` };
    }
    if (!(p > 0)) { dropped.priceNotPositive++; continue; }
    if (!(q > 0)) { dropped.quantityNotPositive++; continue; }
    let g = 0, t = 0;
    if (G) { if (!code.has(table.raw[G.index][i])) { dropped.noGroup++; continue; } g = code.get(table.raw[G.index][i]); }
    if (D) { t = time === "date" ? D.day[i] : D.num[i]; if (t !== t) { dropped.noDate++; continue; } }
    rows.push({ p, q, g, t });
  }
  const prices = new Set(rows.map((r) => r.p)).size;
  const left = `${plural(rows.length, "row")} can be used`;
  if (rows.length < LIMITS.minRows) return { error: `${rows.length ? `Only ${left}` : "No row can be used"}, and at least ${LIMITS.minRows} are needed. A usable row has a price above zero and a quantity above zero.`, dropped };
  if (prices < LIMITS.minPrices) return { error: `The price column has only ${prices === 1 ? "one value" : `${prices} different values`} in the usable rows. A demand curve needs the price to vary: at least ${LIMITS.minPrices} different prices.`, dropped };
  return { rows, dropped, groups, time, names: { price: P.name, quantity: Q.name, group: G ? G.name : null, date: D ? D.name : null } };
}

/* ------------------------------------------------------------------------ fits */

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// The regressors after the first: a 0/1 column for every group but the first (if levels), and time (if trend).
function extras(rows, { levels, trend }, nGroups, tMean, tScale) {
  return rows.map((r) => {
    const x = [];
    if (levels) for (let k = 1; k < nGroups; k++) x.push(r.g === k ? 1 : 0);
    if (trend) x.push((r.t - tMean) / tScale);
    return x;
  });
}

/**
 * Both demand curves fitted to the same rows.
 *   options.levels  give every group its own level (a 0/1 column for each group but the first)
 *   options.trend   allow for a steady drift over time; needs a date column
 * Returns { error } or {
 *   n, df, range: [lowest price, highest price],
 *   log:    { elasticity, se, low, high (95%, Student's t), r2, sigma, lnP0, lnQ0, smear, rmse, trend }
 *   linear: { slope, se, low, high, r2, sigma, p0, q0, rmse }
 * }. Each curve passes through the averages: ln Q = lnQ0 + elasticity (ln P - lnP0), and Q = q0 + slope (P - p0).
 */
export function fit(prepared, options = {}) {
  const { rows, groups, time } = prepared;
  const levels = Boolean(options.levels) && groups && groups.length > 1;
  const trend = Boolean(options.trend) && Boolean(time);
  const used = groups ? [...new Set(rows.map((r) => r.g))] : [0];
  if (levels && used.length < 2) return { error: "Every usable row is in the same group, so there are no group levels to fit. Choose \"All rows together\"." };
  // Renumber groups so that none is empty.
  const remap = new Map(used.sort((a, b) => a - b).map((g, i) => [g, i]));
  const data = rows.map((r) => ({ ...r, g: remap.get(r.g) }));
  const tMean = mean(data.map((r) => r.t));
  const tScale = time === "date" ? 365.25 : 1;
  if (trend && new Set(data.map((r) => r.t)).size < 3) return { error: "The date column has fewer than three different values in the usable rows, so a trend cannot be fitted. Untick the trend." };
  const X = extras(data, { levels, trend }, used.length, tMean, tScale);
  const k = 2 + (X[0]?.length || 0);
  const n = data.length;
  if (n - k < 3) return { error: `There are ${plural(n, "usable row")} and ${k} quantities to estimate. At least ${k + 3} rows are needed for this fit: choose fewer groups, no trend, or add rows.` };
  const lnP = data.map((r) => Math.log(r.p)), lnQ = data.map((r) => Math.log(r.q));
  const p = data.map((r) => r.p), q = data.map((r) => r.q);
  let a, b;
  try {
    a = stats.ols(lnP.map((v, i) => [v, ...X[i]]), lnQ);
    b = stats.ols(p.map((v, i) => [v, ...X[i]]), q);
  } catch {
    return { error: levels || trend ? "The price cannot be told apart from the groups or the trend: within each group (or along the trend) it hardly varies. Fit all rows together, or without the trend." : "The price hardly varies, so no curve can be fitted." };
  }
  if (![a.beta[1], a.se[1], b.beta[1], b.se[1]].every(Number.isFinite)) return { error: "The price cannot be told apart from the groups or the trend in this data. Fit all rows together, or without the trend." };
  const df = n - k, tq = tQuantile(0.975, df);
  const smear = mean(a.residuals.map(Math.exp));
  const rmse = (res) => Math.sqrt(mean(res.map((e) => e * e)));
  const range = [Math.min(...p), Math.max(...p)];
  const out = {
    n, df, k, tq, range, levels, trend, groupsUsed: used.length,
    log: {
      elasticity: a.beta[1], se: a.se[1], low: a.beta[1] - tq * a.se[1], high: a.beta[1] + tq * a.se[1], r2: a.r2, sigma: Math.sqrt(a.sigma2),
      lnP0: mean(lnP), lnQ0: mean(lnQ), smear, rmse: rmse(a.fitted.map((f, i) => Math.exp(f) * smear - q[i])),
    },
    linear: { slope: b.beta[1], se: b.se[1], low: b.beta[1] - tq * b.se[1], high: b.beta[1] + tq * b.se[1], r2: b.r2, sigma: Math.sqrt(b.sigma2), p0: mean(p), q0: mean(q), rmse: rmse(b.residuals) },
  };
  // Does the elasticity change along the range of prices? The logarithmic fit again, with (ln P - its mean) squared
  // added. A coefficient clearly below zero means demand grows more elastic as the price rises, which is what a
  // revenue peak needs and what a straight line takes for granted. null when there are too few rows to tell.
  out.bend = null;
  if (n - k - 1 >= 3) {
    try {
      const c = stats.ols(lnP.map((v, i) => [v, (v - out.log.lnP0) ** 2, ...X[i]]), lnQ);
      const tb = tQuantile(0.975, n - k - 1);
      if (Number.isFinite(c.beta[2]) && Number.isFinite(c.se[2])) out.bend = { coef: c.beta[2], se: c.se[2], low: c.beta[2] - tb * c.se[2], high: c.beta[2] + tb * c.se[2] };
    } catch { /* the squared term cannot be told apart from the price: no evidence either way */ }
  }
  if (trend) {
    const j = a.beta.length - 1;
    out.log.trend = { perUnit: a.beta[j], se: a.se[j], low: a.beta[j] - tq * a.se[j], high: a.beta[j] + tq * a.se[j], unit: time === "date" ? "year" : "step" };
  }
  return out;
}

/** Quantity on the constant-elasticity curve at price P (the geometric mean of quantity there), with a 95% band for it. */
export function logCurve(f, P) {
  const d = Math.log(P) - f.log.lnP0;
  const centre = f.log.lnQ0 + f.log.elasticity * d;
  const half = f.tq * Math.sqrt(f.log.sigma ** 2 / f.n + d * d * f.log.se ** 2);
  return { q: Math.exp(centre), low: Math.exp(centre - half), high: Math.exp(centre + half) };
}
/** Quantity on the straight line at price P. It can fall below zero, where it means "none". */
export const linearCurve = (f, P) => f.linear.q0 + f.linear.slope * (P - f.linear.p0);

/**
 * How the elasticity reads. One of:
 *   "elastic"    the whole interval is below -1
 *   "inelastic"  the whole interval is between -1 and 0
 *   "unclear"    the interval is below 0 but holds -1: elastic or not cannot be told
 *   "flat"       the interval holds 0: the data does not show that quantity responds to price at all
 *   "upward"     the whole interval is above 0: quantity rises with price in this data
 */
export function verdict(f) {
  const { low, high } = f.log;
  if (low > 0) return "upward";
  if (high >= 0) return "flat";
  if (high < -1) return "elastic";
  if (low > -1) return "inelastic";
  return "unclear";
}

/**
 * What the constant-elasticity curve says about price.
 *   revenue  "falls" (as price rises), "rises", or null when the data cannot say. There is never a peak: revenue is
 *            A P^(1 + e), which only ever rises or only ever falls.
 *   best     the observed price with the highest modelled revenue: the lowest when revenue falls, the highest when it rises
 *   profit   with a unit cost c above zero and an estimate below -1: { price: c e / (1 + e), low, high, inside };
 *            high is Infinity when the interval for e reaches -1. Otherwise { none: why }.
 */
export function constantAdvice(f, cost = null) {
  const v = verdict(f);
  const e = f.log.elasticity;
  const out = { verdict: v, revenue: v === "elastic" ? "falls" : v === "inelastic" ? "rises" : null, best: v === "elastic" ? f.range[0] : v === "inelastic" ? f.range[1] : null, profit: null };
  if (cost == null) return out;
  if (!(cost > 0)) { out.profit = { none: "cost" }; return out; }
  if (v === "flat" || v === "upward") out.profit = { none: v };
  else if (!(e < -1)) out.profit = { none: "inelastic" };
  else {
    const at = (x) => (cost * x) / (1 + x);
    const price = at(e);
    out.profit = { price, low: at(f.log.low), high: f.log.high < -1 ? at(f.log.high) : Infinity, markup: price / cost, inside: price >= f.range[0] && price <= f.range[1] };
  }
  return out;
}

/**
 * True when the rows themselves show demand growing more elastic as the price rises: the 95% interval for the bend
 * (see fit) lies wholly below zero. Only then is a straight line's revenue peak more than its own assumption.
 */
export const bends = (f) => Boolean(f.bend) && f.bend.high < -1e-9;

/**
 * What the straight line says about price. With a slope b below zero, revenue P (q0 + b (P - p0)) peaks where
 * q0 + b (2P - p0) = 0, and profit (P - c)(q0 + b (P - p0)) peaks half the unit cost higher.
 *   usable    the slope's 95% interval is wholly below zero
 *   bends     the rows show demand growing more elastic as the price rises (see bends above)
 *   supported usable, bends, and the revenue peak lies inside the prices in the data: the only case in which the
 *             page offers a revenue-maximising price
 *   revenue   { price, low, high, inside }: low and high are Fieller's 95% limits, null when the slope is not usable
 *   profit    the same for profit, when a cost is given
 */
export function linearAdvice(f, cost = null) {
  const { slope: b, se, p0, q0, sigma } = f.linear;
  const usable = f.linear.high < 0;
  if (!(b < 0)) return { usable: false, bends: bends(f), supported: false, reason: "upward", revenue: null, profit: null };
  const peak = (p0 - q0 / b) / 2;
  let low = null, high = null;
  if (usable) {
    // Fieller: the prices P for which q0 + b (2P - p0) is within t standard errors of zero. With u = 2P - p0 that is
    // (b^2 - t^2 Vb) u^2 + 2 q0 b u + (q0^2 - t^2 Vq) <= 0, a finite interval because b^2 > t^2 Vb when the slope is usable.
    const t2 = f.tq ** 2, Vb = se * se, Vq = sigma ** 2 / f.n;
    const A = b * b - t2 * Vb, B = 2 * q0 * b, C = q0 * q0 - t2 * Vq;
    const disc = Math.sqrt(Math.max(0, B * B - 4 * A * C));
    const u = [(-B - disc) / (2 * A), (-B + disc) / (2 * A)].sort((x, y) => x - y);
    low = (u[0] + p0) / 2; high = (u[1] + p0) / 2;
  }
  const inside = (x) => x >= f.range[0] && x <= f.range[1];
  const shift = cost > 0 ? cost / 2 : null;
  return {
    usable, bends: bends(f), supported: usable && bends(f) && inside(peak), reason: usable ? null : "slope",
    revenue: { price: peak, low, high, inside: inside(peak) },
    profit: shift == null ? null : { price: peak + shift, low: low == null ? null : low + shift, high: high == null ? null : high + shift, inside: inside(peak + shift) },
  };
}

/** A separate constant-elasticity fit for each group: [{ name, n, elasticity, low, high } or { name, n, error }]. */
export function byGroup(prepared) {
  if (!prepared.groups) return [];
  return prepared.groups.map((name, g) => {
    const rows = prepared.rows.filter((r) => r.g === g);
    if (rows.length < 5 || new Set(rows.map((r) => r.p)).size < LIMITS.minPrices) return { name, n: rows.length, error: rows.length < 5 ? "fewer than 5 usable rows" : "fewer than 3 different prices" };
    const f = fit({ rows, groups: null, time: null });
    return f.error ? { name, n: rows.length, error: "price hardly varies" } : { name, n: rows.length, elasticity: f.log.elasticity, low: f.log.low, high: f.log.high };
  }).filter((g) => g.n > 0);
}

/* -------------------------------------------------------------------- examples */

const line = (cells) => cells.join(",");
/**
 * Simulated sales, each with a known elasticity. Demand is Q = A P^e times random noise, so ln Q = ln A + e ln P + u.
 * Quantities are rounded to whole units, as a till would record them.
 */
function simulate(id) {
  const r = rng({ cafe: 381, bus: 382, shops: 383, busy: 384, trend: 385, stall: 386 }[id]);
  const rows = [];
  if (id === "cafe") {
    // 120 days. The price is set by a rota of five prices, whatever the weather: an experiment.
    rows.push("day,price,cups_sold");
    for (let d = 1; d <= 120; d++) { const p = [2.2, 2.6, 3.0, 3.4, 3.8][r.int(0, 4)]; rows.push(line([d, p.toFixed(2), Math.max(1, Math.round(900 * p ** -1.8 * Math.exp(r.normal(0, 0.12))))])); }
  } else if (id === "stall") {
    // 120 days of a market stall whose demand is a straight line, Q = 180 - 20 P, with prices from a rota of six.
    // Its elasticity runs from -0.29 at a price of 2 to -3.5 at 7, and revenue P (180 - 20 P) peaks at 4.5.
    rows.push("day,price,units");
    for (let d = 1; d <= 120; d++) { const p = [2, 3, 4, 5, 6, 7][r.int(0, 5)]; rows.push(line([d, p.toFixed(2), Math.max(1, Math.round(180 - 20 * p + r.normal(0, 8)))])); }
  } else if (id === "bus") {
    // 90 weeks of a bus route. Fares change now and then; riders barely respond.
    rows.push("week,fare,riders");
    let fare = 1.6;
    for (let w = 1; w <= 90; w++) { if (w % 9 === 1) fare = [1.4, 1.6, 1.8, 2.0, 2.2, 2.5][r.int(0, 5)]; rows.push(line([w, fare.toFixed(2), Math.round(5200 * fare ** -0.4 * Math.exp(r.normal(0, 0.06)))])); }
  } else if (id === "shops") {
    // Two shops, the same elasticity. The city shop sells four times as much at any price, and charges more.
    rows.push("shop,price,units");
    for (const [shop, scale, base] of [["City", 2400, 6.0], ["Village", 600, 4.2]]) for (let i = 0; i < 60; i++) { const p = base * (0.85 + 0.3 * r()); rows.push(line([shop, p.toFixed(2), Math.round(scale * p ** -1.5 * Math.exp(r.normal(0, 0.1)))])); }
  } else if (id === "busy") {
    // The manager sees a busy day coming and puts the price up. Price now depends on the same shock as quantity.
    rows.push("day,price,units");
    for (let d = 1; d <= 150; d++) { const u = r.normal(0, 0.25); const p = 5 * Math.exp(0.6 * u + r.normal(0, 0.08)); rows.push(line([d, p.toFixed(2), Math.round(1500 * p ** -1.5 * Math.exp(u))])); }
  } else {
    // Three years of monthly sales. The market grows 20% a year while the seller edges the price up.
    rows.push("month,price,units");
    for (let m = 0; m < 36; m++) { const p = 10 * 1.004 ** m * Math.exp(r.normal(0, 0.06)); rows.push(line([`${2023 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`, p.toFixed(2), Math.round(8000 * p ** -1.2 * Math.exp(Math.log(1.2) * (m / 12) + r.normal(0, 0.05)))])); }
  }
  return rows.join("\n");
}

export const EXAMPLES = [
  { id: "cafe", label: "Café, prices set by rota", truth: -1.8, about: "Simulated data, made by this page: 120 days of a café that sets its coffee price from a rota of five prices, whatever the day is like. The demand curve behind it has an elasticity of exactly −1.8." },
  { id: "stall", label: "Straight-line demand", truth: null, peak: 4.5, about: "Simulated data, made by this page: 120 days of a market stall that sets its price from a rota of six prices. Demand here is a straight line, quantity = 180 − 20 × price, so its elasticity changes with the price and revenue truly peaks at a price of 4.5." },
  { id: "bus", label: "Bus fares", truth: -0.4, about: "Simulated data, made by this page: 90 weeks of riders on a bus route whose fare changes every nine weeks. The elasticity behind it is exactly −0.4: riders hardly respond." },
  { id: "shops", label: "Two shops", truth: -1.5, about: "Simulated data, made by this page: 60 days each from a city shop and a village shop. Both have an elasticity of exactly −1.5, but the city shop sells four times as much at any price and charges more." },
  { id: "busy", label: "Prices raised on busy days", truth: -1.5, about: "Simulated data, made by this page: 150 days of a seller who puts the price up when a busy day is coming. The elasticity behind it is exactly −1.5, and no setting on this page can recover it." },
  { id: "trend", label: "Growing market", truth: -1.2, about: "Simulated data, made by this page: 36 months in a market growing 20% a year, with a seller who edges the price up over time. The elasticity behind it is exactly −1.2." },
].map((ex) => ({ ...ex, csv: simulate(ex.id) }));

/** Text straight to results: { table, cols, roles, prepared, fit } or { error }. */
export function analyse(text, options = {}) {
  const table = parseTable(text);
  if (table.error) return { error: table.error };
  const cols = profile(table);
  const roles = { ...guessRoles(cols), ...(options.roles || {}) };
  const prepared = prepare(table, cols, roles);
  if (prepared.error) return { error: prepared.error, table, cols, roles };
  const f = fit(prepared, options);
  return f.error ? { error: f.error, table, cols, roles, prepared } : { table, cols, roles, prepared, fit: f };
}
