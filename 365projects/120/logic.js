// Day 120: Bayesian Event Forecaster. The model, with no DOM code.
//
//   forecast = { id, event, date, made, ref: { key, label, k, n, window }, base, news: [news], outcome: null | 1 | 0, resolved, preset }
//   news     = { id, text, ratio, added }
//   file     = { format, version, forecasts: [forecast] }
//
// base is the probability from the reference class, fixed when the forecast is saved. The forecast is the base rate
// with each news item's likelihood ratio multiplied into its odds. Beliefs are carried as natural log-odds.

import { LAUNCHES } from "./data.js";

export const FORMAT = "365-event-forecaster";
export const VERSION = 1;
export const LIMITS = { event: 200, news: 160, newsItems: 20, forecasts: 2000, ratioMin: 1e-4, ratioMax: 1e4, probMin: 0.001, baseMin: 1e-7, countMax: 1e6, fileBytes: 5e6 };

/* ---------------------------------------------------------------------- dates */

const two = (n) => String(n).padStart(2, "0");
export const localToday = (now = new Date()) => `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
export function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
const EPOCH = Date.parse(`${LAUNCHES.epoch}T00:00:00Z`) / 86400000;
export const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000 - EPOCH;
export const isoOf = (day) => new Date((day + EPOCH) * 86400000).toISOString().slice(0, 10);
export const addYears = (iso, n) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4) === "-02-29" ? "-02-28" : iso.slice(4)}`;

/* ------------------------------------------------------------------ odds */

export const logit = (p) => Math.log(p) - Math.log1p(-p);
export const sigmoid = (L) => (L >= 0 ? 1 / (1 + Math.exp(-L)) : Math.exp(L) / (1 + Math.exp(L)));
/** ln(sigmoid(L)) without underflow. */
const logSigmoid = (L) => (L >= 0 ? -Math.log1p(Math.exp(-L)) : L - Math.log1p(Math.exp(L)));

/* --------------------------------------------------------- reference classes */

export const CLASSES = [
  { key: "family", label: "First orbital attempts of a new rocket family", tiny: "New family", short: "first orbital attempts of new rocket families", test: (c) => (c & 6) === 6 },
  { key: "version", label: "First orbital attempts of a new version of an existing rocket", tiny: "New version", short: "first orbital attempts of new versions of existing rockets", test: (c) => (c & 6) === 2 },
  { key: "type", label: "First orbital attempts of any new rocket type", tiny: "Any new type", short: "first orbital attempts of new rocket types", test: (c) => (c & 2) === 2 },
  { key: "any", label: "Any orbital launch attempt", tiny: "Any launch", short: "orbital launch attempts", test: () => true },
];
export const classByKey = (key) => CLASSES.find((c) => c.key === key);
export const WINDOWS = { all: "All earlier years", last20: "The 20 years before" };
export const DATA_END = isoOf(LAUNCHES.days.at(-1));
export const DATA_START = isoOf(LAUNCHES.days[0]);

/**
 * Launches in a class that took place before `date`, within the window: { k successes, n launches, from, to }.
 * Nothing on or after the date is counted, so a past event is forecast with what was known the day before.
 */
export function classCounts(key, date, window = "all", data = LAUNCHES) {
  const cls = classByKey(key);
  if (!cls) throw new Error(`unknown class ${key}`);
  const { k: K, n: N } = prefix(data, cls);
  const before = firstAtOrAfter(data.days, dayOf(date));
  const from = window === "last20" ? firstAtOrAfter(data.days, dayOf(addYears(date, -20))) : 0;
  const lo = Math.min(from, before);
  return { k: K[before] - K[lo], n: N[before] - N[lo], from: window === "last20" ? addYears(date, -20) : DATA_START, to: isoOf(Math.min(dayOf(date) - 1, data.days.at(-1))) };
}

// Running totals of launches and successes in each class, so that a count before any date is two lookups.
const PREFIX = new WeakMap();
function prefix(data, cls) {
  if (!PREFIX.has(data)) PREFIX.set(data, new Map());
  const cache = PREFIX.get(data);
  if (!cache.has(cls.key)) {
    const n = data.days.length, K = new Int32Array(n + 1), N = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const c = data.codes.charCodeAt(i) - 48, hit = cls.test(c);
      N[i + 1] = N[i] + (hit ? 1 : 0);
      K[i + 1] = K[i] + (hit && c & 1 ? 1 : 0);
    }
    cache.set(cls.key, { k: K, n: N });
  }
  return cache.get(cls.key);
}
/** Index of the first launch on or after a day (binary search over the sorted days). */
function firstAtOrAfter(days, day) {
  let lo = 0, hi = days.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (days[mid] < day) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Laplace's rule of succession: after k successes in n trials, the chance of the next is (k + 1) / (n + 2). */
export const laplace = (k, n) => (k + 1) / (n + 2);

/* ------------------------------------------------------------------ parsing */

const fail = (error) => ({ error });
const NUM = String.raw`(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?`;
const toNum = (s) => Number(s.replace(/,/g, ""));

/** A likelihood ratio typed as 3, 0.5, 1/4, 3:1 or "3 to 1". */
export function parseRatio(text) {
  const s = String(text ?? "").trim();
  if (!s) return fail("Say how much more likely this news is if the event will happen: a likelihood ratio such as 2, or 1/2 if it is half as likely.");
  if (s.length > 40) return fail("The likelihood ratio is too long to be a number.");
  let m, v;
  if ((m = new RegExp(`^(${NUM})\\s*(?:/|:|to)\\s*(${NUM})$`, "i").exec(s))) {
    const a = toNum(m[1]), b = toNum(m[2]);
    v = b === 0 ? Infinity : a / b;
  } else if ((m = new RegExp(`^(${NUM})$`, "i").exec(s))) v = toNum(m[1]);
  else if (/^-/.test(s)) return fail("A likelihood ratio cannot be negative.");
  else if (/^(inf|infinity|∞)$/i.test(s)) v = Infinity;
  else return fail("The likelihood ratio is not a number I can read. Type it as 2, 0.5, 1/2 or 2:1.");
  if (v === 0) return fail("A ratio of 0 says the news could not have appeared if the event were going to happen, which settles the question rather than weighing it. Record the outcome instead, or use a small ratio such as 0.01.");
  if (!Number.isFinite(v)) return fail("An unlimited ratio says the news could not have appeared unless the event were going to happen, which settles the question. Record the outcome instead, or use a large ratio such as 100.");
  if (v < LIMITS.ratioMin || v > LIMITS.ratioMax) return fail("This page takes ratios from 1 in 10,000 (0.0001) to 10,000. News stronger than that settles the question.");
  return { value: v };
}

/** A base rate typed as a percentage. Exactly 0 or 100 is refused, and anything past 0.1% from either end. */
export function parsePercent(text) {
  const s = String(text ?? "").trim();
  const m = new RegExp(`^(${NUM})\\s*%?$`, "i").exec(s);
  if (!s) return fail("Type the base rate as a percentage, such as 25%.");
  if (!m) return fail("The base rate is not a percentage I can read. Type it as 25 or 25%.");
  const pv = toNum(m[1]); // compared as typed, so that 99.9 is not refused for rounding to 0.9990000000000001
  if (pv > 100) return fail("A base rate cannot be more than 100%. Use a rate between 0.1% and 99.9%.");
  if (pv <= 0 || pv >= 100) return fail("A base rate of 0% or 100% says the event is impossible or certain, and no news could then move the forecast. Use a rate between 0.1% and 99.9%.");
  if (pv < 100 * LIMITS.probMin || pv > 100 - 100 * LIMITS.probMin) return fail("Use a base rate between 0.1% and 99.9%.");
  return { value: pv / 100 };
}

/** Counts typed for a reference class of your own: k of n cases happened. */
export function checkCounts(k, n) {
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.countMax) return fail(`The number of similar cases must be a whole number from 1 to ${LIMITS.countMax.toLocaleString("en-GB")}.`);
  if (!Number.isInteger(k) || k < 0 || k > n) return fail(`The number that happened must be a whole number from 0 to ${n.toLocaleString("en-GB")}.`);
  return { value: { k, n } };
}

/* ---------------------------------------------------------------- forecasting */

/** The forecast's path: base rate, then after each news item. */
export function path(base, news) {
  let L = logit(base);
  const steps = [{ L, p: sigmoid(L) }];
  for (const item of news) { L += Math.log(item.ratio); steps.push({ L, p: sigmoid(L) }); }
  return { steps, L, p: sigmoid(L), ratio: Math.exp(L - logit(base)) };
}

/* ------------------------------------------------------------------- scoring */

/** Brier score: (p - outcome)^2. 0 is perfect; always saying 50% scores 0.25. */
export const brier = (p, outcome) => (p - outcome) ** 2;
/** Log score: the natural log of the probability given to what happened. 0 is perfect; always 50% scores ln 0.5. */
export const logScore = (L, outcome) => (outcome ? logSigmoid(L) : logSigmoid(-L));
export const COIN = { brier: 0.25, log: Math.log(0.5) };

/**
 * Scores of the resolved forecasts: the final forecast against the base rate alone and against always saying 50%,
 * plus calibration bins (five equal-width bins, ten from 60 resolved forecasts on).
 */
export function scorecard(forecasts) {
  const done = forecasts.filter((f) => f.outcome === 0 || f.outcome === 1);
  const n = done.length;
  const card = { n, total: forecasts.length, final: null, base: null, bins: [], rate: null };
  if (!n) return card;
  const rows = done.map((f) => {
    const fp = path(f.base, f.news);
    return { o: f.outcome, p: fp.p, L: fp.L, pb: f.base, Lb: logit(f.base) };
  });
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  card.final = { brier: mean(rows.map((r) => brier(r.p, r.o))), log: mean(rows.map((r) => logScore(r.L, r.o))) };
  card.base = { brier: mean(rows.map((r) => brier(r.pb, r.o))), log: mean(rows.map((r) => logScore(r.Lb, r.o))) };
  card.rate = mean(rows.map((r) => r.o));
  const k = n >= 60 ? 10 : 5;
  card.bins = Array.from({ length: k }, (_, i) => ({ lo: i / k, hi: (i + 1) / k, n: 0, happened: 0, sum: 0, meanP: null, freq: null }));
  for (const r of rows) {
    const b = card.bins[Math.min(k - 1, Math.floor(r.p * k + 1e-9))];
    b.n++; b.happened += r.o; b.sum += r.p;
  }
  for (const b of card.bins) if (b.n) { b.meanP = b.sum / b.n; b.freq = b.happened / b.n; }
  return card;
}

/* ------------------------------------------------------------------ the log */

let counter = 0;
export const newId = (prefix = "f") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const cleanText = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Check a news item as typed. Returns { item } or { error, field }. */
export function checkNews({ text, ratio }) {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { ...fail("Describe the news in a few words."), field: "text" };
  if (t.length > LIMITS.news) return { ...fail(`Keep the news to ${LIMITS.news} characters; it has ${t.length}.`), field: "text" };
  const r = parseRatio(ratio);
  if (r.error) return { ...r, field: "ratio" };
  return { item: { text: t, ratio: r.value } };
}

/** Check a whole forecast before it is saved. Returns { forecast } or { error }. */
export function checkForecast(f) {
  const event = String(f.event ?? "").replace(/\s+/g, " ").trim();
  if (!event) return fail("Describe the event as something that will or will not happen.");
  if (event.length > LIMITS.event) return fail(`Keep the event to ${LIMITS.event} characters; it has ${event.length}.`);
  if (!isDate(f.date)) return fail("Give the date of the event.");
  // Counts of up to a million can give a base rate nearer the ends than a typed percentage may be.
  if (!(f.base >= LIMITS.baseMin && f.base <= 1 - LIMITS.baseMin)) return fail("The base rate must be strictly between 0% and 100%.");
  if (!Array.isArray(f.news) || f.news.length > LIMITS.newsItems) return fail(`A forecast holds up to ${LIMITS.newsItems} news items.`);
  for (const [i, item] of f.news.entries()) {
    const c = checkNews({ text: item.text, ratio: String(item.ratio) });
    if (c.error || Math.abs(c.item.ratio - item.ratio) > 1e-12 * item.ratio) return fail(`News item ${i + 1}: ${c.error ?? "its ratio is not a number"}`);
  }
  return { forecast: { ...f, event } };
}

export function resolve(list, id, outcome, today) {
  if (!list.some((f) => f.id === id)) return fail("That forecast is no longer in the list.");
  return { list: list.map((f) => (f.id === id ? { ...f, outcome: outcome === null ? null : outcome ? 1 : 0, resolved: outcome === null ? null : today } : f)) };
}

/* ------------------------------------------------------------- import, export */

export const toJSON = (forecasts) => JSON.stringify({ format: FORMAT, version: VERSION, forecasts }, null, 2);

/** One record from a file or from storage. Returns { forecast } or { error }. */
export function readForecast(raw, today) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("it is not a record");
  const base = typeof raw.base === "number" ? raw.base : NaN;
  const news = Array.isArray(raw.news) ? raw.news : null;
  if (!news) return fail("it has no list of news");
  const ref = raw.ref && typeof raw.ref === "object" ? raw.ref : {};
  const f = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 40) : newId(),
    event: typeof raw.event === "string" ? raw.event : "", date: raw.date, made: isDate(raw.made) ? raw.made : today,
    ref: {
      key: typeof ref.key === "string" ? ref.key.slice(0, 20) : "own",
      label: cleanText(ref.label ?? "", 120) || "A reference class of your own",
      k: Number.isInteger(ref.k) ? ref.k : null, n: Number.isInteger(ref.n) ? ref.n : null,
      window: ref.window === "last20" ? "last20" : "all",
    },
    base,
    news: news.map((it) => ({ id: typeof it?.id === "string" && it.id.trim() ? it.id.trim().slice(0, 40) : newId("n"), text: it?.text, ratio: typeof it?.ratio === "number" ? it.ratio : NaN, added: isDate(it?.added) ? it.added : today })),
    outcome: raw.outcome === 1 || raw.outcome === 0 ? raw.outcome : null,
    resolved: null,
    preset: typeof raw.preset === "string" ? raw.preset.slice(0, 20) : null,
  };
  f.resolved = f.outcome === null ? null : isDate(raw.resolved) ? raw.resolved : today;
  const c = checkForecast(f);
  if (c.error) return fail(c.error.replace(/\.$/, "").replace(/^./, (x) => x.toLowerCase()));
  c.forecast.news = c.forecast.news.map((it) => ({ ...it, text: cleanText(it.text, LIMITS.news) }));
  return c;
}

export function parseImport(text, today) {
  const body = String(text ?? "").replace(/^﻿/, "").trim();
  if (!body) return fail("That file is empty.");
  if (body[0] !== "{" && body[0] !== "[") return fail("That file is not one this page exported: it should be a JSON file starting with {.");
  let data;
  try { data = JSON.parse(body); } catch { return fail("That file looks like JSON but cannot be read. It may have been cut short."); }
  // The format is checked first, so that a file from another page is named as such.
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (typeof data.format === "string" && data.format !== FORMAT) return fail(`That file is not from this page. Its format is "${data.format.slice(0, 40)}", not "${FORMAT}".`);
    if (typeof data.version === "number" && data.version > VERSION) return fail(`That file was written by a newer version of this page (format version ${data.version}; this page reads version ${VERSION}). Reload the page to get the latest version, then import it again.`);
  }
  const records = Array.isArray(data) ? data : data?.forecasts;
  if (!Array.isArray(records)) return fail("That JSON file has no list of forecasts in it.");
  const forecasts = [], problems = [];
  records.forEach((raw, i) => {
    const r = readForecast(raw, today);
    if (r.error) problems.push(`Forecast ${i + 1}: ${r.error}.`);
    else forecasts.push(r.forecast);
  });
  if (!forecasts.length) return fail(records.length ? `None of the ${records.length} forecasts could be read. ${problems[0]}` : "That file has no forecasts in it.");
  return { forecasts, problems };
}

export function mergeInto(list, incoming) {
  const ids = new Set(list.map((f) => f.id));
  const added = [];
  let duplicates = 0, overLimit = 0;
  for (const f of incoming) {
    if (ids.has(f.id)) { duplicates++; continue; }
    if (list.length + added.length >= LIMITS.forecasts) { overLimit++; continue; }
    ids.add(f.id);
    added.push(f);
  }
  return { list: [...list, ...added], added: added.length, duplicates, overLimit };
}

/** The forecasts in storage that are still sound; null if nothing is stored. Data written by a later version of the
 *  page is not read (and must not be rewritten): the list comes back empty with `newer` set to that version. */
export function restore(saved, today) {
  if (!saved || !Array.isArray(saved.forecasts)) return null;
  if (typeof saved.version === "number" && saved.version > VERSION) return Object.assign([], { newer: saved.version });
  return saved.forecasts.map((f) => readForecast(f, today).forecast).filter(Boolean);
}

/* ------------------------------------------------------------ presets, example */

/** The first flight of a named rocket type, found in the data: { date, type, family, ok, newFamily }. */
export function firstFlight(type, data = LAUNCHES) {
  const hit = data.firsts.find((f) => f[1] === type);
  if (!hit) return null;
  const c = data.codes.charCodeAt(hit[0]) - 48;
  return { date: isoOf(data.days[hit[0]]), type: hit[1], family: hit[2], ok: (c & 1) === 1, newFamily: (c & 4) === 4 };
}

/**
 * Past events with known outcomes, from GCAT. The forecast uses only launches before the date; the outcome stays
 * hidden until the visitor asks for it. The last preset is an illustration with made-up news.
 */
export const PRESETS = [
  { key: "ariane5", type: "Ariane 5G", event: "Ariane 5 reaches orbit on its first flight" },
  { key: "falcon9", type: "Falcon 9", event: "Falcon 9 reaches orbit on its first flight" },
  { key: "electron", type: "Electron", event: "Electron reaches orbit on its first flight" },
  { key: "h3", type: "H3-22S", event: "H3 reaches orbit on its first flight" },
  { key: "vulcan", type: "Vulcan Centaur VC2S", event: "Vulcan Centaur reaches orbit on its first flight" },
];
export const ILLUSTRATION = {
  key: "illustration",
  event: "A made-up new rocket reaches orbit on its first flight (an illustration, not a real launch)",
  news: [
    { text: "Made-up news: every stage has completed a full-length test firing", ratio: 1.5 },
    { text: "Made-up news: the launch has slipped three times for technical faults", ratio: 0.7 },
  ],
};

/**
 * The outside view, tested on the past: every first orbital attempt of a new rocket type (as GCAT names types; a type
 * may have flown suborbital or near-orbital tests before) from `from` to `to`, forecast with
 * the base rate of its narrower class (a new family, or a new version of an existing one) from all earlier launches,
 * by Laplace's rule. No news, so each forecast is the base rate alone. No look-ahead: each uses only earlier launches.
 */
export function outsideView({ from = "2000-01-01", to = "2025-12-31", single = false } = {}, data = LAUNCHES) {
  const out = [];
  for (const [i, type, family] of data.firsts) {
    const date = isoOf(data.days[i]);
    if (date < from || date > to) continue;
    const c = data.codes.charCodeAt(i) - 48;
    const key = single ? "type" : c & 4 ? "family" : "version";
    const counts = classCounts(key, date, "all", data);
    out.push({
      id: `outside-${i}`, event: `${type} reaches orbit on its first orbital attempt`, date, made: date,
      ref: { key, label: classByKey(key).label, k: counts.k, n: counts.n, window: "all" },
      base: laplace(counts.k, counts.n), news: [], outcome: c & 1, resolved: date, preset: null, family,
    });
  }
  return out;
}
