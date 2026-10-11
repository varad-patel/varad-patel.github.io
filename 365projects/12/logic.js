// Day 12: Syllogism Validator. The model, with no DOM code.
// A categorical syllogism is parsed from English and checked by brute force over the eight regions
// of a three-circle Venn diagram: every way of making each region empty or inhabited is a "world".

/* ================================================================== regions */

export const TERMS = ["S", "M", "P"]; // minor term, middle term, major term
export const FORMS = ["A", "E", "I", "O"];
const BIT = { S: 1, M: 2, P: 4 };

/** Region r (0 to 7) lies inside circle t when t's bit is set. Region 0 is outside all three circles. */
export const inTerm = (r, t) => (r & BIT[t]) !== 0;
const maskWhere = (test) => { let m = 0; for (let r = 0; r < 8; r++) if (test(r)) m |= 1 << r; return m; };
const TERM_MASK = Object.fromEntries(TERMS.map((t) => [t, maskWhere((r) => inTerm(r, t))]));
const popcount = (x) => { let n = 0; for (; x; x &= x - 1) n++; return n; };
const UNIVERSAL = { A: true, E: true, I: false, O: false };
const NEGATIVE = { A: false, E: true, I: false, O: true };

/** The regions a statement is about, as a bit mask. A and E say they are all empty; I and O say one is inhabited. */
export function targetMask({ form, subject, predicate }) {
  const inPredicate = form === "E" || form === "I";
  return maskWhere((r) => inTerm(r, subject) && inTerm(r, predicate) === inPredicate);
}
export const regionsOf = (mask) => [0, 1, 2, 3, 4, 5, 6, 7].filter((r) => mask & (1 << r));

/** Is the statement true in the world `model` (bit r set means region r has at least one thing in it)? */
export const holds = (st, model) => ((model & targetMask(st)) === 0) === UNIVERSAL[st.form];

/**
 * Which worlds count. nonEmpty lists terms assumed to have at least one member (the traditional reading
 * lists all three). singular lists terms that name exactly one thing, so exactly one of their regions is inhabited.
 */
export function admissible(model, { nonEmpty = [], singular = [] } = {}) {
  for (const t of singular) if (popcount(model & TERM_MASK[t]) !== 1) return false;
  for (const t of nonEmpty) if (!(model & TERM_MASK[t])) return false;
  return true;
}

/**
 * Model checking. Returns the worlds in which both premises are true, and those among them in which
 * the conclusion is false. The form is valid exactly when there are none of the second kind.
 */
export function check(syl, opts = {}) {
  const models = [];
  for (let m = 0; m < 256; m++) if (admissible(m, opts) && holds(syl.major, m) && holds(syl.minor, m)) models.push(m);
  const counterexamples = models.filter((m) => !holds(syl.conclusion, m));
  return { valid: counterexamples.length === 0, consistent: models.length > 0, models, counterexamples };
}

export const MODERN = Object.freeze({ nonEmpty: [] });
export const TRADITIONAL = Object.freeze({ nonEmpty: TERMS });

/** Both verdicts, and the single term whose existence would rescue a form that only the traditional reading accepts. */
export function verdict(syl, singular = []) {
  const modern = check(syl, { singular });
  const traditional = check(syl, { nonEmpty: TERMS, singular });
  let needs = null;
  if (traditional.valid && !modern.valid) needs = TERMS.find((t) => check(syl, { nonEmpty: [t], singular }).valid) || null;
  return { modern, traditional, needs };
}

/**
 * The most readable counterexample: as many non-empty terms as possible (so that it is not just
 * "nothing exists"), then as few inhabited regions as possible. Region 0 is never needed.
 */
export function bestCounterexample(counterexamples) {
  const score = (m) => TERMS.filter((t) => m & TERM_MASK[t]).length * 100 - popcount(m);
  return counterexamples.reduce((best, m) => (best == null || score(m) > score(best) ? m : best), null);
}

/** Why a statement is true or false in one world: a region that settles it, when there is one. */
export function explain(st, model) {
  const hit = regionsOf(model & targetMask(st));
  const truth = (hit.length === 0) === UNIVERSAL[st.form];
  return { holds: truth, witness: hit.length ? hit[0] : null, vacuous: UNIVERSAL[st.form] && truth && !(model & TERM_MASK[st.subject]) };
}

/**
 * What the premises settle about each region, for drawing: regions empty in every world where the premises
 * hold (shaded), regions inhabited in every such world (a cross), and "some" premises whose witness could
 * sit in either of two regions (a cross on the line between them). target is what the conclusion needs.
 */
export function readOff(syl, opts = {}, singular = []) {
  const { models } = check(syl, { ...opts, singular });
  let any = 0, all = 254;
  for (const m of models) { any |= m; all &= m; }
  const empty = models.length ? regionsOf(~any & 254) : [];
  const inhabited = models.length ? regionsOf(all & 254) : [];
  const floating = [];
  for (const st of [syl.major, syl.minor]) {
    if (UNIVERSAL[st.form] && !singular.includes(st.subject)) continue;
    // A singular statement also says its subject exists: "Socrates is a man" puts something in S and M.
    const some = UNIVERSAL[st.form] ? { ...st, form: st.form === "A" ? "I" : "O" } : st;
    const open = regionsOf(targetMask(some)).filter((r) => !empty.includes(r));
    if (open.length === 2 && !open.some((r) => inhabited.includes(r))) floating.push(open);
  }
  const target = regionsOf(targetMask(syl.conclusion));
  return { empty, inhabited, floating, target, wants: UNIVERSAL[syl.conclusion.form] ? "empty" : "inhabited" };
}

/* ========================================================== mood and figure */

/** Build the form with this mood ("AAA") and figure (1 to 4). S, M and P stand for the three terms. */
export function formOf(mood, figure) {
  const [a, b, c] = mood;
  return {
    major: figure === 1 || figure === 3 ? { form: a, subject: "M", predicate: "P" } : { form: a, subject: "P", predicate: "M" },
    minor: figure === 1 || figure === 2 ? { form: b, subject: "S", predicate: "M" } : { form: b, subject: "M", predicate: "S" },
    conclusion: { form: c, subject: "S", predicate: "P" },
  };
}
export const moodOf = (syl) => syl.major.form + syl.minor.form + syl.conclusion.form;
export const figureOf = (syl) => (syl.major.subject === "M" ? (syl.minor.predicate === "M" ? 1 : 3) : (syl.minor.predicate === "M" ? 2 : 4));

/**
 * The traditional mnemonic names of the 24 forms that are valid when every term has a member, as given in the
 * Stanford Encyclopedia's "Medieval theories of the syllogism" and the Encyclopaedia Britannica.
 */
export const NAMES = {
  "AAA-1": "Barbara", "EAE-1": "Celarent", "AII-1": "Darii", "EIO-1": "Ferio", "AAI-1": "Barbari", "EAO-1": "Celaront",
  "EAE-2": "Cesare", "AEE-2": "Camestres", "EIO-2": "Festino", "AOO-2": "Baroco", "EAO-2": "Cesaro", "AEO-2": "Camestros",
  "AII-3": "Datisi", "IAI-3": "Disamis", "EIO-3": "Ferison", "OAO-3": "Bocardo", "AAI-3": "Darapti", "EAO-3": "Felapton",
  "AEE-4": "Camenes", "IAI-4": "Dimaris", "EIO-4": "Fresison", "AAI-4": "Bramantip", "EAO-4": "Fesapo", "AEO-4": "Camenop",
};
/** The same forms under the names other books use. The fourth figure is where the traditions differ most. */
export const ALSO = { "AEO-2": "Camestrop", "AAI-4": "Bamalip", "AEE-4": "Calemes", "IAI-4": "Dimatis", "AEO-4": "Calemos" };
export const fullName = (key) => (NAMES[key] ? (ALSO[key] ? `${NAMES[key]} (also ${ALSO[key]})` : NAMES[key]) : null);

/* ================================================== the rules of distribution */

const DISTRIBUTES = { A: [true, false], E: [true, true], I: [false, false], O: [false, true] }; // [subject, predicate]
/**
 * A statement distributes a term when it says something about every member of it. A term that names
 * exactly one thing is distributed wherever it appears: to speak of Socrates is to speak of all of him.
 */
export const distributed = (st, term, singular = []) =>
  (st.subject === term && (DISTRIBUTES[st.form][0] || singular.includes(term))) || (st.predicate === term && (DISTRIBUTES[st.form][1] || singular.includes(term)));

export const RULES = {
  "undistributed-middle": "Undistributed middle",
  "illicit-major": "Illicit major",
  "illicit-minor": "Illicit minor",
  "exclusive-premises": "Exclusive premises (two negative premises)",
  "affirmative-from-negative": "Affirmative conclusion from a negative premise",
  "negative-from-affirmatives": "Negative conclusion from affirmative premises",
  "existential": "Existential fallacy",
};

/**
 * The classical rules this form breaks. The first four decide validity on the traditional reading; the
 * fifth (two universal premises, particular conclusion) is added on the modern one. Pass
 * { existential: false } to leave it out, and { singular } for terms that name one thing.
 */
export function brokenRules(syl, { existential = true, singular = [] } = {}) {
  const { major, minor, conclusion } = syl;
  const out = [];
  if (!distributed(major, "M", singular) && !distributed(minor, "M", singular)) out.push("undistributed-middle");
  if (distributed(conclusion, "P", singular) && !distributed(major, "P", singular)) out.push("illicit-major");
  if (distributed(conclusion, "S", singular) && !distributed(minor, "S", singular)) out.push("illicit-minor");
  const negatives = NEGATIVE[major.form] + NEGATIVE[minor.form];
  if (negatives === 2) out.push("exclusive-premises");
  if (negatives >= 1 && !NEGATIVE[conclusion.form]) out.push("affirmative-from-negative");
  if (negatives === 0 && NEGATIVE[conclusion.form]) out.push("negative-from-affirmatives");
  if (existential && UNIVERSAL[major.form] && UNIVERSAL[minor.form] && !UNIVERSAL[conclusion.form]) out.push("existential");
  return out;
}

/**
 * The named faults to report on each reading. A form that fails on both readings breaks one of the first
 * four rules. A form that fails only on the modern reading has exactly one thing wrong with it: it needs
 * something to exist that the premises do not supply.
 */
export function faults(syl, singular = []) {
  const v = verdict(syl, singular);
  const basic = v.traditional.valid ? [] : brokenRules(syl, { existential: false, singular });
  return { modern: v.modern.valid ? [] : v.traditional.valid ? ["existential"] : basic, traditional: basic };
}

/** All 256 forms with both verdicts. */
export function census() {
  const rows = [];
  for (const figure of [1, 2, 3, 4]) for (const a of FORMS) for (const b of FORMS) for (const c of FORMS) {
    const mood = a + b + c;
    const syl = formOf(mood, figure);
    const v = verdict(syl);
    rows.push({ mood, figure, key: `${mood}-${figure}`, name: NAMES[`${mood}-${figure}`] || null, modern: v.modern.valid, traditional: v.traditional.valid, needs: v.needs, broken: brokenRules(syl) });
  }
  return rows;
}

/* =================================================================== parsing */

const LEAD = /^(?:(?:therefore|thus|hence|so|then|and|but|consequently|it follows that)(?=[\s,:])|∴)[\s,:]*/i;
const QUANTIFIERS = [
  [/^not\s+(?:all|every|each)\s+(?:of\s+)?/i, "notall"],
  [/^(?:all|every|each|any)\s+(?:of\s+)?/i, "all"],
  [/^(?:none\s+of|no)\s+/i, "no"],
  [/^(?:some|at\s+least\s+one)\s+(?:of\s+)?/i, "some"],
  [/^only\s+/i, "only"],
];
const UNSUPPORTED = /^(most|many|few|several|almost|nearly|a\s+few|exactly|more|fewer|half)\b/i;
// Openings that would otherwise be mistaken for the name of an individual or a class: "Nobody is perfect", "Two cats are pets".
const PRONOUN = /^((?:every|some|any|no)(?:one|body|thing))\b/i;
const NOT_A_FORM = /^(not|if|unless|either|neither|both|there|at\s+least|at\s+most|(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?!\s+(?:is|are)\b))\b/i;
const HOW = 'Use one of: "All X are Y", "No X are Y", "Some X are Y", "Some X are not Y".';

const tidy = (s) => {
  let t = String(s ?? "").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().replace(/[.;,!?]+$/, "").trim();
  while (LEAD.test(t)) t = t.replace(LEAD, "");
  return t.replace(/\b(is|are)n't\b/gi, "$1 not");
};
/** A term as shown: no surrounding quotes, no leading article (unless the article is the whole term, as in "All A are B"). */
const termText = (s) => {
  const t = s.replace(/["“”]/g, "").replace(/^'+|['.,;]+$/g, "").trim();
  return t.replace(/^(?:a|an|the)\s+(?=\S)/i, "");
};

const IRREGULAR = { men: "man", women: "woman", people: "person", children: "child", mice: "mouse", geese: "goose", feet: "foot", teeth: "tooth", oxen: "ox" };
// ponytail: a crude singulariser on the last word only, enough for "men / a man" and "Greeks / Greek".
// It does not know synonyms or adjectives turned into nouns; a real lemmatiser is the upgrade.
function singulars(word) {
  const out = new Set([word]);
  if (IRREGULAR[word]) out.add(IRREGULAR[word]);
  if (word.length > 3) {
    if (word.endsWith("ies")) out.add(`${word.slice(0, -3)}y`);
    if (word.endsWith("ves")) { out.add(`${word.slice(0, -3)}f`); out.add(`${word.slice(0, -3)}fe`); } // wolves, wives
    if (/(?:s|x|z|ch|sh|o)es$/.test(word)) out.add(word.slice(0, -2));
    if (word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) out.add(word.slice(0, -1));
  }
  return out;
}
/** Do two pieces of text name the same term? Case, articles and the number of the last word are ignored. */
export function sameTerm(a, b) {
  const wa = termText(a).toLowerCase().split(" "), wb = termText(b).toLowerCase().split(" ");
  if (wa.length !== wb.length || wa.slice(0, -1).join(" ") !== wb.slice(0, -1).join(" ")) return false;
  const sb = singulars(wb.at(-1));
  return [...singulars(wa.at(-1))].some((w) => sb.has(w));
}

/**
 * Read one categorical statement. Returns { text, candidates } or { error }.
 * A sentence with more than one "is" or "are" has one candidate per place it could be split;
 * parseSyllogism keeps the split that makes the three statements share three terms.
 */
export function parseStatement(raw) {
  const text = tidy(raw);
  if (!text) return { error: "is empty. " + HOW };
  const unsupported = text.match(UNSUPPORTED);
  if (unsupported) return { error: `starts with "${unsupported[1].toLowerCase()}", which is not one of the four categorical forms. ${HOW}` };
  let quantifier = "none", rest = text;
  for (const [re, q] of QUANTIFIERS) if (re.test(text)) { quantifier = q; rest = text.replace(re, ""); break; }
  if (quantifier === "none") {
    const pronoun = text.match(PRONOUN), other = text.match(NOT_A_FORM);
    if (pronoun) return { error: `starts with "${pronoun[1].toLowerCase()}", which hides the class it is about. Name the class instead, as in "All people are Y" or "No things are Y".` };
    if (other) return { error: `starts with "${other[1].toLowerCase().replace(/\s+/g, " ")}", which is not one of the four categorical forms. ${HOW}` };
  }

  const candidates = [];
  let error = null;
  for (const m of rest.matchAll(/\b(is|are)\b/gi)) {
    const subject = termText(rest.slice(0, m.index).trim());
    let after = rest.slice(m.index + m[0].length).trim();
    const negated = /^not\b/i.test(after);
    if (negated) after = after.replace(/^not\s*/i, "");
    const predicate = termText(after);
    if (!subject || !predicate) continue;
    const initial = quantifier === "none"; // the subject is the first word of the sentence, so its capital letter means nothing
    const make = (form, extra = {}) => candidates.push({ form, subject, predicate, singular: false, initial, ...extra });
    if (quantifier === "all") {
      if (negated) error ??= `is ambiguous: "All X are not Y" can mean "No X are Y" or "Some X are not Y". Type the one you mean.`;
      else make("A");
    } else if (quantifier === "no") make(negated ? "A" : "E");
    else if (quantifier === "some") make(negated ? "O" : "I");
    else if (quantifier === "notall") make(negated ? "I" : "O");
    else if (quantifier === "only") {
      if (negated) error ??= `mixes "only" with "not", which this tool does not read. ${HOW}`;
      else candidates.push({ form: "A", subject: predicate, predicate: subject, singular: false, initial: false, swapped: true });
    } else {
      // No quantifier. "Whales are mammals" is read as "All whales are mammals"; "Socrates is a man" names one thing.
      const general = m[1].toLowerCase() === "are" || /^(?:a|an)\s/i.test(rest);
      make(negated ? "E" : "A", { singular: !general });
    }
  }
  if (candidates.length) return { text, candidates };
  if (error) return { error };
  return { error: `has no "is" or "are" that links two terms. ${HOW} A verb can be reworded: "All birds fly" becomes "All birds are things that fly".` };
}

const LABELS = ["The first premise", "The second premise", "The conclusion"];
const quote = (list) => list.map((t) => `"${t}"`).join(", ");

function assemble(statements) {
  // Group the six term occurrences into classes.
  const classes = [];
  const classOf = (text, initial) => {
    let c = classes.find((k) => sameTerm(k.text, text));
    if (!c) classes.push(c = { text, count: 0, settled: false });
    if (!initial && !c.settled) { c.text = text; c.settled = true; } // prefer a spelling that is not sentence-initial
    c.count++;
    return c;
  };
  const rows = statements.map((s) => ({ ...s, sub: classOf(s.subject, s.initial && !s.swapped), pre: classOf(s.predicate, false) }));
  const twice = rows.findIndex((r) => r.sub === r.pre);
  if (twice >= 0) return { ok: false, field: twice, error: `${LABELS[twice]} uses "${rows[twice].sub.text}" on both sides. Each statement must link two different terms.` };
  if (classes.length !== 3) {
    return { ok: false, field: null, error: `A syllogism has exactly three terms, each used twice. This one has ${classes.length}: ${quote(classes.map((c) => c.text))}. Use the same words for the same thing each time.` };
  }
  const off = classes.filter((c) => c.count !== 2);
  if (off.length) {
    return { ok: false, field: null, error: `Each term must appear in exactly two of the three statements. Here ${off.map((c) => `"${c.text}" appears ${c.count === 1 ? "once" : `${c.count} times`}`).join(" and ")}.` };
  }
  const [p1, p2, c] = rows;
  const letter = new Map([[c.sub, "S"], [c.pre, "P"]]);
  letter.set(classes.find((k) => !letter.has(k)), "M");
  const st = (r) => ({ form: r.form, subject: letter.get(r.sub), predicate: letter.get(r.pre) });
  const majorFirst = p1.sub === c.pre || p1.pre === c.pre;
  const syl = { major: st(majorFirst ? p1 : p2), minor: st(majorFirst ? p2 : p1), conclusion: st(c) };
  const mood = moodOf(syl), figure = figureOf(syl);
  // A term names one individual only if it is never quantified: "Gold is a metal; some gold is jewellery" is about a kind.
  const subjectOf = (t) => rows.filter((r) => letter.get(r.sub) === t);
  const singular = TERMS.filter((t) => subjectOf(t).some((r) => r.singular) && subjectOf(t).every((r) => r.singular));
  return {
    ok: true, syl, mood, figure, key: `${mood}-${figure}`, name: NAMES[`${mood}-${figure}`] || null,
    terms: Object.fromEntries(classes.map((k) => [letter.get(k), k.text])),
    singular,
    majorFirst,
    statements: rows.map((r) => ({ text: r.text, form: r.form, subject: letter.get(r.sub), predicate: letter.get(r.pre), singular: r.singular && singular.includes(letter.get(r.sub)), swapped: Boolean(r.swapped) })),
  };
}

/** Read two premises and a conclusion. Returns { ok: true, syl, mood, figure, name, terms, singular, ... } or { ok: false, error, field }. */
export function parseSyllogism(premise1, premise2, conclusion) {
  const parsed = [premise1, premise2, conclusion].map(parseStatement);
  const bad = parsed.findIndex((p) => p.error);
  if (bad >= 0) return { ok: false, field: bad, error: `${LABELS[bad]} ${parsed[bad].error}` };
  let first = null;
  for (const a of parsed[0].candidates) for (const b of parsed[1].candidates) for (const c of parsed[2].candidates) {
    const result = assemble([{ ...a, text: parsed[0].text }, { ...b, text: parsed[1].text }, { ...c, text: parsed[2].text }]);
    if (result.ok) return result;
    first ??= result;
  }
  return first;
}

/**
 * A statement that was read as being about one named individual, reworded as a statement about a kind:
 * "Gold is a metal" becomes "All Gold is a metal", "Gold is not a metal" becomes "No Gold is a metal".
 */
export function asKind({ text, form }) {
  return `${form === "E" ? "No" : "All"} ${text.replace(/^the\s+/i, "")}`.replace(/\b(is|are) not\b/i, "$1");
}

/** The standard wording of a statement, for showing how it was read and for building examples. */
export function wording({ form, subject, predicate }, names = { S: "S", M: "M", P: "P" }) {
  const s = names[subject], p = names[predicate];
  return form === "A" ? `All ${s} are ${p}` : form === "E" ? `No ${s} are ${p}` : form === "I" ? `Some ${s} are ${p}` : `Some ${s} are not ${p}`;
}
