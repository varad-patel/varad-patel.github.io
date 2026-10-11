// Day 24: Personal Forecast Log. The model, with no DOM code.
//
//   forecast = { id, statement, p, created, due, tags: [], outcome: null | 1 | 0, resolved: null | date, revised: null | date }
//   log      = { version: 1, forecasts: [forecast] }
//
// p is the probability given to "the statement turns out true", between 0 and 1. Dates are "YYYY-MM-DD".

import { csv } from "../kit/kit.js";

export const FORMAT = "365-forecast-log";
export const VERSION = 1;
export const LIMITS = { statement: 280, tags: 6, tag: 24, forecasts: 5000 };
/** The Brier score of someone who answers 50% to everything: (0.5 - 0)^2 = (0.5 - 1)^2 = 0.25. */
export const COIN = 0.25;
/** The luck test calls a gap real only if chance alone would produce one that large less than 1 time in 40. */
export const LUCK = 1 / 40;

/* ---------------------------------------------------------------------- dates */

const two = (n) => String(n).padStart(2, "0");
/** True for a real calendar date written as YYYY-MM-DD. */
export function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
export const dayNumber = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);
export const addDays = (iso, n) => new Date((dayNumber(iso) + n) * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
/** Today's date where the visitor is, not in UTC. */
export const localToday = (now = new Date()) => `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;

/* -------------------------------------------------------------------- scoring */

/** Brier score of one forecast: the squared distance between the probability and what happened (1 or 0). */
export const brier = (p, outcome) => (p - outcome) ** 2;

/** The score to expect from always saying p when the statement comes true a share `rate` of the time. */
export const expectedBrier = (p, rate) => rate * (1 - p) ** 2 + (1 - rate) * p ** 2;

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * The luck test. If every stated confidence were exactly right and the forecasts were independent, forecast i
 * would be a hit with probability c[i]. This builds the exact distribution of the number of hits, one forecast
 * at a time, and returns the chance of `hits` or fewer (low) and of `hits` or more (high). No approximation.
 */
export function hitChances(confidences, hits) {
  const dist = new Float64Array(confidences.length + 1);
  dist[0] = 1;
  confidences.forEach((c, i) => {
    for (let k = i + 1; k >= 1; k--) dist[k] = dist[k] * (1 - c) + dist[k - 1] * c;
    dist[0] *= 1 - c;
  });
  let low = 0, high = 0;
  dist.forEach((q, k) => { if (k <= hits) low += q; if (k >= hits) high += q; });
  return { low: Math.min(1, low), high: Math.min(1, high) };
}

/**
 * Everything on the scorecard, from the resolved forecasts only.
 *
 *   brier          mean of (p - outcome)^2; null when nothing is resolved
 *   skill          1 - brier / 0.25: the share of the coin-flipper's score that has been removed (negative is worse)
 *   baseRate       share of resolved statements that came true
 *   parts          Murphy's decomposition over groups of forecasts that gave the same probability:
 *                  brier = reliability - resolution + uncertainty, exactly
 *   bins           calibration table: equal-width probability bins with the forecasts in each
 *   confidence     every forecast folded onto the side it leaned to, to compare average confidence with the hit rate,
 *                  with the exact chance of so few (low) or so many (high) hits if the confidences were right
 *   timeline       one row per resolved forecast in order of resolution, with the running mean score
 */
export function scorecard(forecasts, { bins: wanted } = {}) {
  const done = forecasts.filter((f) => f.outcome === 0 || f.outcome === 1)
    .sort((a, b) => (a.resolved < b.resolved ? -1 : a.resolved > b.resolved ? 1 : a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
  const n = done.length;
  const card = { n, total: forecasts.length, brier: null, skill: null, baseRate: null, parts: null, bins: [], confidence: null, timeline: [] };
  if (!n) return card;

  const scores = done.map((f) => brier(f.p, f.outcome));
  card.brier = mean(scores);
  card.skill = 1 - card.brier / COIN;
  card.baseRate = mean(done.map((f) => f.outcome));

  // Murphy (1973): group by the probability stated, then compare each group's probability with how often it came true.
  const groups = new Map();
  for (const f of done) {
    const g = groups.get(f.p) ?? { n: 0, hits: 0 };
    g.n++;
    g.hits += f.outcome;
    groups.set(f.p, g);
  }
  let reliability = 0, resolution = 0;
  for (const [p, g] of groups) {
    reliability += g.n * (p - g.hits / g.n) ** 2;
    resolution += g.n * (g.hits / g.n - card.baseRate) ** 2;
  }
  card.parts = { reliability: reliability / n, resolution: resolution / n, uncertainty: card.baseRate * (1 - card.baseRate) };

  // Calibration bins. Five wide bins until there are enough forecasts for ten.
  const k = wanted ?? (n >= 60 ? 10 : 5);
  card.bins = Array.from({ length: k }, (_, i) => ({ lo: i / k, hi: (i + 1) / k, n: 0, happened: 0, sum: 0, meanP: null, rate: null }));
  for (const f of done) {
    const bin = card.bins[Math.min(k - 1, Math.floor(f.p * k + 1e-9))];
    bin.n++;
    bin.happened += f.outcome;
    bin.sum += f.p;
  }
  for (const bin of card.bins) if (bin.n) { bin.meanP = bin.sum / bin.n; bin.rate = bin.happened / bin.n; }

  // Confidence: a 20% forecast is an 80% forecast that the statement is false. 50% leans neither way and is left out.
  const leaning = done.filter((f) => f.p !== 0.5).map((f) => ({ c: Math.max(f.p, 1 - f.p), hit: (f.p > 0.5) === (f.outcome === 1) ? 1 : 0 }));
  if (leaning.length) {
    const said = mean(leaning.map((x) => x.c));
    const right = mean(leaning.map((x) => x.hit));
    const expected = leaning.reduce((s, x) => s + x.c, 0);
    const hits = leaning.reduce((s, x) => s + x.hit, 0);
    const { low, high } = hitChances(leaning.map((x) => x.c), hits);
    const verdict = leaning.length < 10 ? "too few" : low <= LUCK ? "overconfident" : high <= LUCK ? "underconfident" : "no clear sign";
    card.confidence = { n: leaning.length, said, right, gap: said - right, hits, expected, low, high, verdict };
  }

  let running = 0;
  card.timeline = done.map((f, i) => {
    running += scores[i];
    return { id: f.id, date: f.resolved, score: scores[i], mean: running / (i + 1) };
  });
  return card;
}

/* -------------------------------------------------------------------- the log */

const fail = (error) => ({ error });
export const emptyLog = () => ({ version: VERSION, forecasts: [] });
export const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const cleanStatement = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS.statement);

/** Tags from typed text or a list: lower case, no repeats, at most six. */
export function parseTags(input) {
  const parts = Array.isArray(input) ? input : String(input ?? "").split(/[,;]/);
  return [...new Set(parts.map((t) => String(t).replace(/\s+/g, " ").trim().toLowerCase().slice(0, LIMITS.tag)).filter(Boolean))].slice(0, LIMITS.tags);
}

/** Check what was typed into the form. `earliest` is the first date the prediction may resolve on. */
function checkInput({ statement, percent, due, tags }, earliest, earliestWhy) {
  const text = cleanStatement(statement);
  if (!text) return fail("Write the prediction as a statement that will turn out true or false.");
  const pct = typeof percent === "string" ? Number(percent.replace("%", "").trim() || NaN) : typeof percent === "number" ? percent : NaN;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return fail("Give the probability as a percentage between 0 and 100.");
  if (!isDate(due)) return fail("Pick the date by which the answer will be known.");
  if (due < earliest) return fail(earliestWhy);
  return { value: { statement: text, p: Math.round(pct * 100) / 10000, due, tags: parseTags(tags) } };
}

export function addForecast(log, input, { today, id = newId() }) {
  if (log.forecasts.length >= LIMITS.forecasts) return fail(`The log holds ${LIMITS.forecasts} predictions. Export it and delete old ones to add more.`);
  const checked = checkInput(input, today, "Pick a date from today onwards. A prediction is about something that has not been settled yet.");
  if (checked.error) return checked;
  const { statement, p, due, tags } = checked.value;
  const forecast = { id, statement, p, created: today, due, tags, outcome: null, resolved: null, revised: null };
  return { log: { ...log, forecasts: [...log.forecasts, forecast] }, id };
}

/** Change an open prediction. A changed probability is stamped with the date, because the score uses the latest one. */
export function editForecast(log, id, input, { today }) {
  const old = log.forecasts.find((f) => f.id === id);
  if (!old) return fail("That prediction is no longer in the log.");
  if (old.outcome !== null) return fail("This prediction is resolved. Undo the resolution before editing it.");
  const checked = checkInput(input, old.created, "The date cannot be earlier than the day the prediction was made.");
  if (checked.error) return checked;
  const next = { ...old, ...checked.value, revised: checked.value.p !== old.p ? today : old.revised };
  return { log: { ...log, forecasts: log.forecasts.map((f) => (f.id === id ? next : f)) } };
}

export function resolveForecast(log, id, happened, { today }) {
  const old = log.forecasts.find((f) => f.id === id);
  if (!old) return fail("That prediction is no longer in the log.");
  const next = { ...old, outcome: happened ? 1 : 0, resolved: today < old.created ? old.created : today };
  return { log: { ...log, forecasts: log.forecasts.map((f) => (f.id === id ? next : f)) } };
}

export function reopenForecast(log, id) {
  if (!log.forecasts.some((f) => f.id === id)) return fail("That prediction is no longer in the log.");
  return { log: { ...log, forecasts: log.forecasts.map((f) => (f.id === id ? { ...f, outcome: null, resolved: null } : f)) } };
}

export function deleteForecast(log, id) {
  if (!log.forecasts.some((f) => f.id === id)) return fail("That prediction is no longer in the log.");
  return { log: { ...log, forecasts: log.forecasts.filter((f) => f.id !== id) } };
}

/** "resolved", "overdue" (its date has passed and it is still open), "today" or "open". */
export function statusOf(f, today) {
  if (f.outcome !== null) return "resolved";
  return f.due < today ? "overdue" : f.due === today ? "today" : "open";
}

/** The three lists on the page: overdue first by how late, open by date, resolved newest first. */
export function arrange(forecasts, today) {
  const by = (key, dir = 1) => (a, b) => (a[key] < b[key] ? -dir : a[key] > b[key] ? dir : a.created < b.created ? -1 : a.created > b.created ? 1 : 0);
  return {
    overdue: forecasts.filter((f) => statusOf(f, today) === "overdue").sort(by("due")),
    open: forecasts.filter((f) => ["open", "today"].includes(statusOf(f, today))).sort(by("due")),
    resolved: forecasts.filter((f) => f.outcome !== null).sort(by("resolved", -1)),
  };
}

export const allTags = (forecasts) => [...new Set(forecasts.flatMap((f) => f.tags))].sort();

/* ------------------------------------------------------------- import, export */

const OUTCOME_WORDS = new Map([["1", 1], ["true", 1], ["yes", 1], ["y", 1], ["happened", 1], ["0", 0], ["false", 0], ["no", 0], ["n", 0], ["did not happen", 0], ["didn't happen", 0]]);
export const CSV_COLUMNS = ["id", "statement", "probability_percent", "created", "due", "tags", "outcome", "resolved", "revised"];

export const toJSON = (log) => JSON.stringify({ format: FORMAT, version: VERSION, forecasts: log.forecasts }, null, 2);

// A spreadsheet runs a cell that starts with =, +, - or @ as a formula. Free text that starts that way (or with the
// apostrophe itself) is written with an apostrophe in front, which a spreadsheet shows as plain text, and the
// apostrophe is taken off again when the file is read, so the round trip stays exact.
const RISKY = /^[=+\-@'\t\r]/;
const guard = (text) => (RISKY.test(text) ? `'${text}` : text);
const unguard = (text) => (typeof text === "string" && text[0] === "'" && RISKY.test(text.slice(1)) ? text.slice(1) : text);
const GUARDED = ["id", "statement", "tags"];

/** One row per prediction. Probability is in percent, tags are separated by semicolons, outcome is "happened", "did not happen" or blank. */
export const toCSV = (log) => csv.stringify([CSV_COLUMNS, ...log.forecasts.map((f) => [
  guard(f.id), guard(f.statement), Math.round(f.p * 10000) / 100, f.created, f.due, guard(f.tags.join("; ")),
  f.outcome === 1 ? "happened" : f.outcome === 0 ? "did not happen" : "", f.resolved ?? "", f.revised ?? "",
])]);

/** Turn one record from a file into a forecast, or say what is wrong with it. */
function readRecord(raw, today) {
  if (!raw || typeof raw !== "object") return fail("it is not a record");
  const statement = cleanStatement(raw.statement);
  if (!statement) return fail("it has no statement");
  let p;
  if (raw.p != null && raw.p !== "") p = Number(raw.p);
  else {
    const text = String(raw.probability_percent ?? raw.probability ?? raw.percent ?? "").replace("%", "").trim();
    p = text === "" ? NaN : Number(text) / 100;
  }
  if (!Number.isFinite(p) || p < 0 || p > 1) return fail("its probability is not between 0 and 100%");
  if (!isDate(raw.due)) return fail("its due date is not a date written as YYYY-MM-DD");
  const created = isDate(raw.created) ? raw.created : raw.due < today ? raw.due : today;
  if (raw.due < created) return fail("its due date is earlier than the day it was made");
  const word = raw.outcome == null ? "" : String(raw.outcome).trim().toLowerCase();
  if (word !== "" && word !== "null" && !OUTCOME_WORDS.has(word)) return fail(`its outcome "${String(raw.outcome).slice(0, 20)}" is not "happened", "did not happen" or blank`);
  const outcome = OUTCOME_WORDS.has(word) ? OUTCOME_WORDS.get(word) : null;
  const resolved = outcome === null ? null : isDate(raw.resolved) && raw.resolved >= created ? raw.resolved : raw.due <= today ? raw.due : today;
  return { forecast: {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 40) : typeof raw.id === "number" ? String(raw.id) : newId(),
    statement, p: Math.round(p * 10000) / 10000, created, due: raw.due, tags: parseTags(raw.tags), outcome, resolved,
    revised: isDate(raw.revised) ? raw.revised : null,
  } };
}

/**
 * Read an exported file: JSON (as written by toJSON, or a bare list) or CSV with a header row.
 * Returns { forecasts, problems } where problems lists the records that were left out, or { error } if nothing can be read.
 */
export function parseImport(text, { today }) {
  const body = String(text ?? "").replace(/^﻿/, "").trim();
  if (!body) return fail("That file is empty.");
  let records, label;
  if (body[0] === "{" || body[0] === "[") {
    let data;
    try { data = JSON.parse(body); } catch { return fail("That file looks like JSON but cannot be read. It may have been cut short."); }
    records = Array.isArray(data) ? data : data?.forecasts;
    if (!Array.isArray(records)) return fail("That JSON file has no list of forecasts in it.");
    // A file that names another format, or a later version of this one, is refused whole: half-reading it could get fields wrong.
    if (typeof data.format === "string" && data.format !== FORMAT) return fail(`That JSON file is not a forecast log from this page. Its format is "${data.format.slice(0, 40)}", not "${FORMAT}".`);
    if (typeof data.version === "number" && data.version > VERSION) return fail(`That file was written by a newer version of this page (format version ${data.version}; this page reads version ${VERSION}). Reload the page to get the latest version, then import it again.`);
    label = "Record";
  } else {
    const table = csv.toObjects(body);
    const columns = table.columns.map((c) => c.toLowerCase());
    if (!columns.includes("statement") || !columns.includes("due")) return fail('That CSV file needs a header row with at least "statement", "probability_percent" and "due".');
    records = table.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), GUARDED.includes(key.toLowerCase()) ? unguard(value) : value])));
    label = "Row";
  }
  const forecasts = [], problems = [];
  records.forEach((raw, i) => {
    const res = readRecord(raw, today);
    if (res.error) problems.push(`${label} ${i + 1}: ${res.error}.`);
    else forecasts.push(res.forecast);
  });
  if (!forecasts.length) return fail(records.length ? `None of the ${records.length} records could be read. ${problems[0]}` : "That file has no forecasts in it.");
  return { forecasts, problems };
}

/**
 * Add imported forecasts that the log does not already hold. A match is an id already seen, or the same statement,
 * creation date and due date as a forecast that was in the log before the import (so a file typed out again
 * without ids adds nothing twice). Two forecasts inside one file that differ only in id are both kept, so that
 * an exported log always reads back whole. `duplicates` and `overLimit` count what was left out, and why.
 */
export function mergeInto(log, incoming) {
  const key = (f) => `${f.statement}|${f.created}|${f.due}`;
  const ids = new Set(log.forecasts.map((f) => f.id));
  const keys = new Set(log.forecasts.map(key));
  const added = [];
  let duplicates = 0, overLimit = 0;
  for (const f of incoming) {
    if (ids.has(f.id) || keys.has(key(f))) { duplicates++; continue; }
    if (log.forecasts.length + added.length >= LIMITS.forecasts) { overLimit++; continue; }
    ids.add(f.id);
    added.push(f);
  }
  return { log: { ...log, forecasts: [...log.forecasts, ...added] }, added: added.length, duplicates, overLimit };
}

/** Read whatever is in storage, keeping every forecast that is still sound. Returns null if there is no log. */
export function restore(saved, { today }) {
  if (!saved || !Array.isArray(saved.forecasts)) return null;
  const forecasts = saved.forecasts.map((raw) => readRecord(raw, today).forecast).filter(Boolean);
  return { version: VERSION, forecasts };
}

/* ---------------------------------------------------------------- the example */

// [statement, percent, days before today it was made, days from today it is due, outcome, days before today it was resolved, tags]
const EXAMPLE = [
  ["My train home is on time on Monday", 90, 118, -112, 1, 112, "everyday"],
  ["I finish the first draft of my essay this week", 80, 115, -108, 0, 108, "study"],
  ["It rains here on Saturday", 30, 110, -105, 0, 105, "weather"],
  ["The council approves the cycle lane at its next meeting", 70, 104, -90, 1, 90, "politics"],
  ["I run 5 km in under 30 minutes this month", 60, 100, -75, 1, 75, "health"],
  ["The parcel arrives before Friday", 95, 96, -92, 1, 92, "everyday"],
  ["Our team wins its next home match", 80, 93, -86, 0, 86, "sport"],
  ["The central bank holds its rate at the next meeting", 90, 90, -70, 1, 70, "economics"],
  ["I read two books this month", 80, 88, -60, 1, 60, "study"],
  ["Petrol costs more at the end of the month than today", 70, 85, -58, 0, 58, "economics"],
  ["The incumbent holds the seat in the by-election", 90, 80, -52, 0, 52, "politics"],
  ["My flatmate forgets the bins this week", 60, 76, -70, 1, 70, "everyday"],
  ["The exam results come out on the day promised", 95, 72, -44, 1, 44, "study"],
  ["It snows here before the end of the month", 10, 70, -42, 0, 42, "weather"],
  ["I keep to my budget this month", 80, 66, -36, 1, 36, "money"],
  ["The new phone is announced at under 800", 70, 62, -40, 1, 40, "economics"],
  ["The bill passes its second reading", 90, 58, -30, 1, 30, "politics"],
  ["Our team finishes the season in the top four", 60, 55, -25, 0, 25, "sport"],
  ["I get a reply to my application within two weeks", 20, 50, -36, 0, 36, "study"],
  ["The repair costs less than the quote", 30, 46, -28, 1, 28, "money"],
  ["The library extends its opening hours this term", 95, 42, -20, 0, 20, "study"],
  ["I cycle to college every day this week", 90, 34, -27, 1, 27, "health"],
  ["Inflation is lower in the next release than in the last", 80, 30, -12, 1, 12, "economics"],
  ["The match on Sunday ends in a draw", 20, 24, -17, 0, 17, "sport"],
  ["The landlord returns the deposit in full this month", 70, 40, -9, null, null, "money"],
  ["I hear back about the summer placement this week", 60, 20, -3, null, null, "study"],
  ["The road works outside finish on schedule", 30, 16, -1, null, null, "everyday"],
  ["I submit the scholarship form before the deadline", 95, 10, 4, null, null, "study"],
  ["The opposition leads the next monthly poll", 60, 8, 19, null, null, "politics"],
  ["Unemployment is higher at the end of the quarter", 30, 6, 48, null, null, "economics"],
  ["I can do ten pull-ups by the end of term", 40, 5, 63, null, null, "health"],
  ["I am accepted by my first-choice college", 50, 2, 150, null, null, "study"],
];

/** A made-up log with dates placed around `today`, so it always has resolved, overdue and open predictions. */
export function exampleLog(today) {
  return {
    version: VERSION,
    forecasts: EXAMPLE.map(([statement, percent, made, due, outcome, resolved, tag], i) => ({
      id: `example-${i + 1}`, statement, p: percent / 100, created: addDays(today, -made), due: addDays(today, due), tags: [tag],
      outcome, resolved: resolved == null ? null : addDays(today, -resolved), revised: null,
    })),
  };
}
