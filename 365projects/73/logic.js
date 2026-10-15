// Day 73: Central Bank Language Tracker. The model, with no DOM code.
// A dictionary score of how much tightening or easing news a monetary policy statement carries, after Gardner, Scotti
// and Vega (2021, 2022): topic keywords paired with the nearest modifier in the same sentence, plus phrase rules about
// future policy, summed and divided by the square root of the number of words.

/* ------------------------------------------------------------------ the dictionary
   Transcribed from Gardner, Scotti and Vega, FEDS 2021-074 (a work of the US government), appendix tables A5 to A10.
   Every entry matches at the start of a word. In a phrase each word must match whole except the last, which may
   continue ("risk remain" does not match "risks remain"; "little change" matches "little changed").
   whole: the table marks "(space)" after it, so the last word must also end there ("up" but not "upward").
   not: a word that starts the same way but is not meant ("soft" but not "software"). */

export const TOPICS = ["inflation", "labor", "output", "financial", "policy"];
export const TOPIC_LABEL = { inflation: "Inflation", labor: "Labour market", output: "Output", financial: "Financial conditions", policy: "Future policy" };

// Table A5: [text, score, topic]
export const KEYWORDS = [
  ["inflation", 1, "inflation"], ["price", 1, "inflation"], ["cost", 1, "inflation"],
  ["employers", 1, "labor"], ["employment", 1, "labor"], ["job gains", 1, "labor"], ["job losses", -1, "labor"], ["labor", 1, "labor"],
  ["hiring", 1, "labor"], ["underutilization of labor resources", -1, "labor"], ["unemployment", -1, "labor"],
  ["utilization of the pool of available workers", 1, "labor"],
  ["business conditions", 1, "output"], ["business outlook", 1, "output"], ["confidence", 1, "output"], ["consumption", 1, "output"],
  ["strengthening in final demand", 1, "output"], ["demand", 1, "output"], ["econom", 1, "output"], ["expenditures", 1, "output"],
  ["export", 1, "output"], ["income", 1, "output"], ["indicators", 1, "output"], ["investment", 1, "output"],
  ["investment spending", 1, "output"], ["output", 1, "output"], ["production", 1, "output"], ["sales", 1, "output"],
  ["sentiment", 1, "output"], ["spending", 1, "output"],
  ["bank lending", 1, "financial"], ["credit", 1, "financial"], ["financial", 1, "financial"],
];

const SHARED_UP = ["pick up", "picking up", "picked up", "rise", "rising", "rose", "risen", "solid", "strong", "strength", "upward"];
// Tables A6 and A7: topic -> [text, score, options]
export const MODIFIERS = {
  labor: [
    ...["declin", "deteriorat", "diminish", "disappoint", "inhibit", "losses", "low", "modest", "moderated", "reluctant to add", "restrain", "set back", "slow"].map((t) => [t, -1]),
    ["soft", -1, { not: "software" }], ...["subdued", "underutilization", "weak"].map((t) => [t, -1]),
    ...["elevat", "expand", "gains", "high", "improv", "increas", "record expansion", "rebound", ...SHARED_UP].map((t) => [t, 1]),
    ["up", 1, { whole: true }],
    ...["balance", "mix", "little change", "stable", "stabilizing", "steady", "unchanged"].map((t) => [t, 0]),
  ],
  inflation: [
    ...["below", "damp"].map((t) => [t, -1]), ["ease", -1, { whole: true }],
    ...["easing", "declin", "diminish", "down", "low", "modest", "moderated", "muted", "reduction", "restrain", "set back", "slow"].map((t) => [t, -1]),
    ["soft", -1, { not: "software" }], ...["subdued", "weak"].map((t) => [t, -1]),
    ...["elevat", "expand", "foster", "height", "high", "improv", "increas", "persist", "pressure", "risk remain", "sustain", "upside risk", ...SHARED_UP].map((t) => [t, 1]),
    ["moderate", 1, { whole: true }], ["up", 1, { whole: true }],
    ...["contain", "balance", "equal probability", "little change", "stable", "stabilizing", "steady", "unchanged", "volatility", "uncertain"].map((t) => [t, 0]),
  ],
  financial: [
    ...["tight", "volatile", "strain", "stress", "turmoil"].map((t) => [t, -1]), ["supportive", 1], ["unchanged", 0],
  ],
  output: [
    ...["below", "contract", "cooling", "cut", "damp", "decelerat", "depress", "declin", "deteriorat", "diminish", "dislocation", "disappoint",
      "disruption", "down", "drag", "erod", "flat", "gap", "inhibit", "increasing less rapidly", "hesitancy", "low", "modest",
      "might not be strong enough", "pause", "reduction", "restrain", "slump", "sluggish", "set back", "shortfall", "slow"].map((t) => [t, -1]),
    ["soft", -1, { not: "software" }],
    ...["subdued", "uncertain", "weak", "yet to exhibit sustainable growth", "weigh", "weigh on", "weighing on", "moderating", "moderation", "moderated",
      "remain moderate", "more moderate"].map((t) => [t, -1]),
    ...["growing at a moderate pace", "advanc", "bolster", "expand", "remains firm", "firm", "firmer", "gains", "grow at a solid pace", "high", "improv",
      "increas", "record expansion", "rebound", ...SHARED_UP].map((t) => [t, 1]),
    ["moderate", 1, { whole: true }],
    ...["abating", "balance", "evolve", "leveling out", "mix", "same", "temporarily depressed", "stable", "stabilizing", "sustain", "tentative"].map((t) => [t, 0]),
  ],
};
// Table A8: whole phrases that act as modifiers for one topic.
export const PHRASES = [
  ["downside risks to the outlook for the economy and the labor market as having diminished", 1, "labor"],
  ["declined but remains elevated", 1, "labor"], ["declined notably in recent months but remains elevated", 1, "labor"],
  ["declined somewhat since the summer, it remains elevated", 1, "labor"], ["deterioration in labor market is abating", 1, "labor"],
  ["deterioration in the labor market is abating", 1, "labor"], ["underutilization of labor resources continues to diminish", 1, "labor"],
  ["although job losses have slowed, new hiring has lagged", 0, "labor"],
  ["despite the rise in energy prices, inflation and inflation expectations have eased in recent months", -1, "inflation"],
  ["the risk of inflation becoming undesirably low", -1, "inflation"],
  ["the pace of economic recovery is likely to be modest", -1, "output"],
  ["recovery is continuing, though at a rate that has been insufficient to bring down unemployment", -1, "output"],
  ["recovery is continuing, though at a rate that has been insufficient to bring about a significant improvement in labor market conditions", -1, "output"],
  ["recovery is continuing at a moderate pace, though somewhat more slowly than the committee had expected", -1, "output"],
  ["expanding but remains constrained", -1, "output"], ["expanding at a moderate rate, though it remains constrained", -1, "output"],
  ["expanding at a moderate rate but remains constrained", -1, "output"], ["the solid pace of spending growth has slowed somewhat", -1, "output"],
  ["stabilizing but remains constrained", -1, "output"], ["picked up recently but remains constrained", -1, "output"],
  ["increasing but remains constrained", -1, "output"], ["increasing gradually, but remains constrained", -1, "output"],
  ["increasing at a moderate pace, but remains constrained", -1, "output"], ["rising, though less rapidly than earlier in the year", -1, "output"],
  ["picked up late last year, but remains constrained", -1, "output"], ["rising at a somewhat slower pace", -1, "output"],
  ["improvement, albeit from a depressed level", -1, "output"],
  ["fiscal policy is restraining economic growth, although the extent of restraint may be diminishing", 0, "output"],
  ["fiscal policy is restraining economic growth, although the extent of restraint is diminishing", 0, "output"],
  ["hurricane related disruptions", 0, "output"], ["warrant keeping the target federal funds rate below levels", -1, "output"],
  ["warrant exceptionally low levels of the federal funds rate", -1, "output"], ["expand for a time at a pace below the productivity", 0, "output"],
];
// Table A9: a sentence scores if it contains every pattern of a rule. Patterns are regular expressions.
export const POLICY_RULES = [
  [["policy accommodation", "maintained"], -1], [["continue its purchases"], -1], [["ready to expand", "purchase"], -1],
  [["await more evidence", "pace of its purchases"], -1], [["will act", "as needed"], -1], [["be patient"], 0],
  [["believe", "policy accommodation", "removed"], 1], [["firming", "need"], 1], [["expects", "increases in the target range"], 1],
  [["judges", "increases in the target range"], 1], [["warrant", "gradual increases"], 1], [["balance sheet normalization"], 1],
  [["end purchase", "improvement"], 1], [["reduce", "purchase"], 1], [["complete|moderate", "purchase", "improvement"], 1],
  [["decides to", "remove policy accommodation"], 1],
];
// Table A10: a sentence that contains every pattern of a rule is left out of the four topics and of the word count.
export const UNINFORMATIVE = [
  ["will", "assess", "as needed"], ["will", "monitor", "as needed"], ["promote a stronger", "as announced"], ["review", "size", "composition"],
  ["promote a stronger", "dual mandate"], ["sizable", "still increasing holdings"], ["recognize", "below its 2 percent objective"],
  ["expect", "gradual adjustments", "will .*? strengthen|remain strong"], ["appropriate policy accommodation", "dual mandate"],
  ["dual mandate", "purchasing additional", "agency mortgage backed securities"], ["long term prospects", "unusual forces", "demand abate"],
  ["sustain.*? expansion", "symmetric 2 percent objective"], ["federal reserve", "employ all available tools|using its balance sheet"],
  ["today's .*? action", "help"],
];

/* ------------------------------------------------------------------ text handling */

export const MAX_CHARS = 200000;

const WORD = /[\p{L}\p{N}'’]+/gu;
const words = (s) => s.toLowerCase().replace(/’/g, "'").match(WORD) || [];

/** Split text into sentences: a full stop, question or exclamation mark, then a space and a capital letter, except after an initial or a common abbreviation. */
export function sentences(text) {
  const out = [];
  const re = /[.!?]["”’)]*\s+(?=["“‘(]?[A-Z])/g;
  let start = 0, m;
  while ((m = re.exec(text))) {
    // The word before the stop: abbreviations are short, so 12 characters back is enough (and keeps this linear).
    const before = text.slice(Math.max(start, m.index - 12), m.index).match(/(\S+)$/)?.[1] || "";
    if (/^(?:[A-Z]|U\.S|U\.K|Mr|Mrs|Ms|Dr|Jr|Sr|St|No|Nos|e\.g|i\.e|vs|etc|Inc|Co|Corp|Ltd|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/.test(before)) continue;
    const end = m.index + m[0].length;
    out.push({ start, end, text: text.slice(start, end).trimEnd() });
    start = end;
  }
  if (start < text.length && text.slice(start).trim()) out.push({ start, end: text.length, text: text.slice(start).trimEnd() });
  return out.filter((s) => s.text.trim());
}

/** The form the phrase rules are matched against: lower case, straight apostrophes, hyphens and dashes as spaces, single spaces. */
export const flat = (s) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[-‐‑‒–—]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A pattern of the tables as a test on flattened text. The tables use only literal words, "|" for either and ".*?"
 * for anything in between, so a pattern is matched with indexOf: each alternative's pieces must appear in order. This
 * gives the same answers as the regular expression (the earliest place for each piece is always the best) in linear
 * time, where the regular expression took seconds on a long text that repeats the first piece.
 */
export function pattern(source) {
  const alternatives = source.split("|").map((a) => a.split(".*?"));
  return {
    source,
    test(f) {
      return alternatives.some((pieces) => {
        let at = 0;
        for (const piece of pieces) { const i = f.indexOf(piece, at); if (i < 0) return false; at = i + piece.length; }
        return true;
      });
    },
  };
}
const compile = (rules) => rules.map(([groups, score]) => ({ groups: (Array.isArray(groups) ? groups : [groups]).map(pattern), score }));
const POLICY = compile(POLICY_RULES);
const UNINF = UNINFORMATIVE.map((groups) => groups.map(pattern));

// Entries as word lists, longest first, so the scan can take the longest match at each word.
const prep = (text) => words(text.replace(/,/g, " "));
const KW = KEYWORDS.map(([text, score, topic]) => ({ text, w: prep(text), score, topic })).sort((a, b) => b.w.length - a.w.length || b.text.length - a.text.length);
const MOD = (() => {
  const byText = new Map();
  for (const [topic, list] of Object.entries(MODIFIERS)) for (const [text, score, opt = {}] of list) {
    if (!byText.has(text)) byText.set(text, { text, w: prep(text), scores: {}, ...opt });
    byText.get(text).scores[topic] = score;
  }
  for (const [text, score, topic] of PHRASES) {
    if (!byText.has(text)) byText.set(text, { text, w: prep(text), scores: {}, phrase: true });
    byText.get(text).scores[topic] = score;
  }
  return [...byText.values()].sort((a, b) => b.w.length - a.w.length || b.text.length - a.text.length);
})();

function matchAt(toks, i, e) {
  if (i + e.w.length > toks.length) return false;
  for (let k = 0; k < e.w.length; k++) {
    const t = toks[i + k].w, want = e.w[k];
    const last = k === e.w.length - 1;
    if (last && !e.whole) { if (!t.startsWith(want)) return false; }
    else if (t !== want) return false;
  }
  if (e.not && toks[i + e.w.length - 1].w.startsWith(e.not)) return false;
  return true;
}

/** Longest entry at each word, left to right, with no overlaps. Returns [{ e, i, n }] with i the first word and n the length. */
// Entries grouped by the first two letters of their first word, keeping the longest-first order, so each word of a
// text is tried only against the few entries that could start there.
const byStart = (entries) => {
  const m = new Map();
  for (const e of entries) { const k = e.w[0].slice(0, 2); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
  return m;
};
const INDEX = new Map();
function scan(toks, entries) {
  if (!INDEX.has(entries)) INDEX.set(entries, byStart(entries));
  const groups = INDEX.get(entries);
  const found = [];
  for (let i = 0; i < toks.length;) {
    const e = (groups.get(toks[i].w.slice(0, 2)) || []).find((x) => matchAt(toks, i, x));
    if (e) { found.push({ e, i, n: e.w.length }); i += e.w.length; } else i++;
  }
  return found;
}

/**
 * The nearest modifier to keyword k among mods (sorted by position, not overlapping one another), leaving out any that
 * overlap the keyword itself; on a tie, the one after the keyword. A binary search, so a long sentence stays fast.
 */
export function nearestModifier(mods, k) {
  const overlaps = (m) => m.i < k.i + k.n && k.i < m.i + m.n; // a modifier inside the keyword itself is not its modifier
  let lo = 0, hi = mods.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (mods[mid].i < k.i) lo = mid + 1; else hi = mid; }
  let r = lo; while (r < mods.length && overlaps(mods[r])) r++;
  let l = lo - 1; while (l >= 0 && overlaps(mods[l])) l--;
  const right = r < mods.length ? { m: mods[r], d: mods[r].i - k.i } : null;
  const left = l >= 0 ? { m: mods[l], d: k.i - mods[l].i } : null;
  if (!left) return right;
  if (!right) return left;
  return right.d <= left.d ? right : left;
}

/**
 * Score one text. Returns { words, sentences: [{ start, end, text, informative, pairs, policy }], sums: { topic: points },
 * scores: { topic: points / sqrt(words) }, total, hits } or { error } when there is nothing to score.
 */
export function score(raw) {
  if (typeof raw !== "string") return { error: "Paste the text of a statement." };
  if (raw.length > MAX_CHARS) return { error: `This text has ${raw.length.toLocaleString("en-GB")} characters. The tool reads up to ${MAX_CHARS.toLocaleString("en-GB")}, about 30,000 words: paste the statement alone, not a whole report.`, tooLong: true };
  // Compatibility form turns a ligature copied from a PDF into its letters; invisible format characters (soft
  // hyphens, zero-width spaces and joiners, direction marks) are removed so that they cannot split a word.
  const text = raw.normalize("NFKC").replace(/\p{Cf}/gu, "");
  if (text.length > MAX_CHARS) return { error: `In standard Unicode form this text has ${text.length.toLocaleString("en-GB")} characters (some characters stand for several letters). The tool reads up to ${MAX_CHARS.toLocaleString("en-GB")}: paste a shorter text.`, tooLong: true };
  if (!text.trim()) return { error: "The box is empty. Paste the text of a statement, or choose one of the examples." };
  const sums = Object.fromEntries(TOPICS.map((t) => [t, 0]));
  let count = 0, hits = 0;
  const out = sentences(text).map((s) => {
    const toks = [];
    for (const m of s.text.matchAll(WORD)) toks.push({ w: m[0].toLowerCase().replace(/’/g, "'"), at: s.start + m.index, len: m[0].length });
    const f = flat(s.text);
    const informative = !UNINF.some((groups) => groups.every((g) => g.test(f)));
    const policy = POLICY.filter((r) => r.groups.every((g) => g.test(f))).map((r) => ({ score: r.score, rule: r.groups.map((g) => g.source) }));
    for (const p of policy) { sums.policy += p.score; hits++; }
    const pairs = [];
    if (informative) {
      count += toks.length;
      const kws = scan(toks, KW), mods = scan(toks, MOD);
      const byTopic = {};
      for (const m of mods) for (const topic in m.e.scores) (byTopic[topic] ||= []).push(m);
      for (const k of kws) {
        const best = nearestModifier(byTopic[k.e.topic] || [], k);
        if (!best) continue;
        const value = k.e.score * best.m.e.scores[k.e.topic];
        sums[k.e.topic] += value;
        hits++;
        const span = (x) => ({ from: toks[x.i].at, to: toks[x.i + x.n - 1].at + toks[x.i + x.n - 1].len });
        pairs.push({ topic: k.e.topic, keyword: k.e.text, keywordScore: k.e.score, modifier: best.m.e.text, modifierScore: best.m.e.scores[k.e.topic], value, distance: best.d, k: span(k), m: span(best.m) });
      }
    }
    return { ...s, informative, pairs, policy };
  });
  if (!count) return { error: "No sentence is left to score: the text has no words outside the sentences the dictionary sets aside (restatements of the mandate and of how the Committee will act).", sentences: out, text };
  const root = Math.sqrt(count);
  const scores = Object.fromEntries(TOPICS.map((t) => [t, sums[t] / root]));
  const total = TOPICS.reduce((s, t) => s + sums[t], 0) / root;
  return { text, words: count, sentences: out, sums, scores, total, hits };
}

/* ------------------------------------------------------------------ against the past */

/** Decode the bundled statements: [{ date, target, change, text }]. */
export function decode(FOMC) {
  const S = FOMC.sentences;
  return FOMC.statements.map(([date, target, change, paras]) => ({ date, target, change, text: paras.map((p) => p.map((i) => S[i]).join(" ")).join("\n\n") }));
}

/** Share of the values below x, counting ties as half: 0 means lower than all, 1 higher than all. */
export function percentile(values, x) {
  if (!values.length || !Number.isFinite(x)) return NaN;
  let below = 0, equal = 0;
  for (const v of values) { if (v < x - 1e-12) below++; else if (Math.abs(v - x) <= 1e-12) equal++; }
  return (below + equal / 2) / values.length;
}

/** The k past statements whose total score is nearest to x. */
export function nearest(past, x, k = 3) {
  return [...past].sort((a, b) => Math.abs(a.total - x) - Math.abs(b.total - x) || (a.date < b.date ? 1 : -1)).slice(0, k);
}

/** A word for where a score sits among past scores. */
export function verdict(p) {
  if (!Number.isFinite(p)) return "";
  if (p >= 0.8) return "more hawkish than most";
  if (p > 0.6) return "on the hawkish side";
  if (p >= 0.4) return "middling";
  if (p > 0.2) return "on the dovish side";
  return "more dovish than most";
}

/**
 * Does the score track decisions? For statements with a decision, the mean score at raises, holds and cuts, and the
 * share of raises and cuts whose sign the score's sign matches. `next` uses the score of the previous statement to
 * look at the following decision.
 */
export function track(past, { next = false, from = "0000", to = "9999" } = {}) {
  const decided = past.filter((p) => p.change != null);
  const rows = [];
  for (let i = 0; i < decided.length; i++) {
    const at = next ? decided[i - 1] : decided[i];
    if (!at) continue;
    const d = decided[i];
    if (d.date < from || d.date > to) continue;
    rows.push({ score: at.total, change: d.change, date: d.date });
  }
  const group = (f) => { const g = rows.filter(f).map((r) => r.score); return { n: g.length, mean: g.length ? g.reduce((a, b) => a + b, 0) / g.length : NaN }; };
  const moves = rows.filter((r) => r.change !== 0);
  const agree = moves.filter((r) => Math.sign(r.score) === Math.sign(r.change)).length;
  return { n: rows.length, raise: group((r) => r.change > 0), hold: group((r) => r.change === 0), cut: group((r) => r.change < 0), moves: moves.length, agree, rows };
}
