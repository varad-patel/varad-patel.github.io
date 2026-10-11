// Day 13: Fallacy Detector. Text classifier (softmax regression on TF-IDF) with no DOM code.
// The same functions train the model (scripts/data/fallacies.mjs) and run it in the browser.

/** Lower-case word tokens. Apostrophes inside words are kept, so "you're" stays one token. */
export function tokenize(text) {
  return (text.toLowerCase().replace(/[‘’]/g, "'").match(/[a-z0-9]+(?:'[a-z]+)?/g)) || [];
}

/** Counts of single words and adjacent pairs: Map(feature -> count). */
export function countFeatures(text) {
  const tokens = tokenize(text);
  const counts = new Map();
  const add = (f) => counts.set(f, (counts.get(f) || 0) + 1);
  tokens.forEach((t, i) => { add(t); if (i + 1 < tokens.length) add(`${t} ${tokens[i + 1]}`); });
  return counts;
}

// A full stop after a title, "vs" or a single letter ("Dr. Smith", "the U.S. economy", "e.g. this") does not end a sentence.
const ABBREVIATION = /(?:^|[\s("'\[.])(?:mr|mrs|ms|dr|prof|st|sr|jr|vs|[a-z])\.$/i;

/**
 * Split text into sentences: at ., ! or ? followed by a space and a capital letter or an opening quote, and at line breaks.
 * A fragment of fewer than three words is joined to the sentence before it (or after it, if it comes first).
 * Written without regular-expression lookbehind, which Safari before 16.4 cannot parse.
 */
export function sentences(text) {
  const out = [];
  let carry = "";
  const push = (piece) => {
    const s = `${carry} ${piece}`.trim();
    carry = "";
    if (!s) return;
    if (tokenize(s).length >= 3) out.push(s);
    else if (out.length) out[out.length - 1] += ` ${s}`;
    else carry = s;
  };
  for (const line of String(text).split(/[\r\n]+/)) {
    const t = line.replace(/\s+/g, " ").trim();
    const end = /[.!?]+["')\]]?\s+(?=[A-Z"'(\[])/g;
    let start = 0, m;
    while ((m = end.exec(t))) {
      const piece = t.slice(start, m.index + m[0].length).trim();
      if (ABBREVIATION.test(piece)) continue;
      push(piece);
      start = m.index + m[0].length;
    }
    push(t.slice(start));
  }
  if (carry) out.push(carry);
  return out;
}

/** Vocabulary and inverse document frequencies from training texts. Features seen in fewer than minDf texts are dropped. */
export function fitVocabulary(texts, minDf = 2) {
  const df = new Map();
  for (const t of texts) for (const f of countFeatures(t).keys()) df.set(f, (df.get(f) || 0) + 1);
  const vocab = [...df.entries()].filter(([, n]) => n >= minDf).map(([f]) => f).sort();
  const n = texts.length;
  return { vocab, idf: vocab.map((f) => Math.log((1 + n) / (1 + df.get(f))) + 1) };
}

/** Sparse TF-IDF vector with sublinear term frequency, scaled to length 1: [[featureIndex, value], ...]. */
export function vectorize(text, index, idf) {
  const pairs = [];
  let norm = 0;
  for (const [f, c] of countFeatures(text)) {
    const j = index.get(f);
    if (j === undefined) continue;
    const v = (1 + Math.log(c)) * idf[j];
    pairs.push([j, v]);
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (const p of pairs) p[1] /= norm;
  return pairs;
}

const softmax = (z) => {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
};

/**
 * Train a softmax (multinomial logistic) regression by full-batch gradient descent with L2 regularisation.
 * rows: [{ text, label }]. Returns a model: { labels, vocab, idf, weights[class][feature], bias[class] }.
 * balance (0 to 1) weights each row by (average class size / its class size)^balance, so that rare labels are not
 * drowned out by common ones: 0 leaves the data as it is, 1 makes every label count equally.
 */
export function train(rows, { minDf = 2, epochs = 300, rate = 4, l2 = 0.0005, labels, balance = 0 } = {}) {
  labels = labels || [...new Set(rows.map((r) => r.label))].sort();
  const { vocab, idf } = fitVocabulary(rows.map((r) => r.text), minDf);
  const index = new Map(vocab.map((f, j) => [f, j]));
  const X = rows.map((r) => vectorize(r.text, index, idf));
  const y = rows.map((r) => labels.indexOf(r.label));
  const K = labels.length, F = vocab.length, n = rows.length;
  const size = new Array(K).fill(0);
  for (const k of y) size[k]++;
  const sample = y.map((k) => (n / (K * size[k])) ** balance);
  const W = Array.from({ length: K }, () => new Float64Array(F));
  const b = new Float64Array(K);
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gW = Array.from({ length: K }, () => new Float64Array(F));
    const gb = new Float64Array(K);
    for (let i = 0; i < n; i++) {
      const z = Array.from(b);
      for (const [j, v] of X[i]) for (let k = 0; k < K; k++) z[k] += W[k][j] * v;
      const p = softmax(z);
      for (let k = 0; k < K; k++) {
        const err = sample[i] * (p[k] - (k === y[i] ? 1 : 0));
        gb[k] += err;
        for (const [j, v] of X[i]) gW[k][j] += err * v;
      }
    }
    for (let k = 0; k < K; k++) {
      b[k] -= (rate * gb[k]) / n;
      for (let j = 0; j < F; j++) W[k][j] -= rate * (gW[k][j] / n + l2 * W[k][j]);
    }
  }
  return { labels, vocab, idf, weights: W.map((w) => Array.from(w)), bias: Array.from(b) };
}

/** Prepare a model for fast prediction (builds the feature lookup once). */
export function prepare(model) {
  return { ...model, index: new Map(model.vocab.map((f, j) => [f, j])) };
}

/**
 * Classify a text. Returns probabilities for every label (best first), the number of known features (words and pairs),
 * the number of words and how many of them are in the vocabulary, and for each label the features that pushed towards
 * it most: weight for that label minus the average over labels, times the feature value.
 */
export function predict(prepared, text, topFeatures = 6) {
  const { labels, weights, bias, index, idf, vocab } = prepared;
  const x = vectorize(text, index, idf);
  const K = labels.length;
  const z = [...bias];
  for (const [j, v] of x) for (let k = 0; k < K; k++) z[k] += weights[k][j] * v;
  const p = softmax(z);
  const ranked = labels.map((label, k) => ({ label, p: p[k], k })).sort((a, b) => b.p - a.p);
  const explain = (k) => x
    .map(([j, v]) => ({ feature: vocab[j], push: (weights[k][j] - weights.reduce((s, w) => s + w[j], 0) / K) * v }))
    .filter((f) => f.push > 0).sort((a, b) => b.push - a.push).slice(0, topFeatures);
  const tokens = tokenize(text);
  return { ranked, known: x.length, words: tokens.length, knownWords: tokens.filter((t) => index.has(t)).length, because: Object.fromEntries(ranked.map((r) => [r.label, explain(r.k)])) };
}

/**
 * Too little to judge: fewer than four known features, or fewer than a third of the words are in the vocabulary.
 * Ordinary English scores well above a third (99% of the held-out training arguments score over a half);
 * other languages and strings of unknown words score near zero.
 */
export const tooThin = (result) => result.known < 4 || result.knownWords * 3 < result.words;

/**
 * Does a confidence clear a bar? Both are compared as whole per cents, which is how the page shows them and how the
 * cross-validation confidences are stored, so "42%" clears a bar of "42%" and a float such as 0.30000000000000004 is 30.
 */
export const clears = (p, bar) => Math.round(p * 100) >= Math.round(bar * 100);

/**
 * What the detector says about one text at a given confidence bar.
 *   kind "thin"   too little to judge
 *   kind "flag"   one or more fallacies clear the bar (flagged, best first)
 *   kind "none"   nothing clears the bar and the first choice is "no fallacy"
 *   kind "below"  the first choice is a fallacy, but it does not clear the bar
 * top is the first choice whatever it is; nearest is the most likely fallacy.
 */
export function reading(result, bar, none = "No Fallacy") {
  const top = result.ranked[0];
  const fallacies = result.ranked.filter((r) => r.label !== none);
  const nearest = fallacies[0];
  if (tooThin(result)) return { kind: "thin", top, nearest, flagged: [] };
  const flagged = fallacies.filter((r) => clears(r.p, bar));
  return { kind: flagged.length ? "flag" : top.label === none ? "none" : "below", top, nearest, flagged };
}

/** Deterministic stratified folds: within each label, row i goes to fold i mod k (rows are shuffled by the caller). */
export function folds(rows, k = 5) {
  const seen = new Map();
  return rows.map((r) => { const c = seen.get(r.label) || 0; seen.set(r.label, c + 1); return c % k; });
}

/** Accuracy, per-label precision, recall and F1, and the confusion matrix from pairs of (true, predicted) labels. */
export function score(labels, truth, predicted) {
  const K = labels.length;
  const matrix = Array.from({ length: K }, () => new Array(K).fill(0));
  truth.forEach((t, i) => { matrix[labels.indexOf(t)][labels.indexOf(predicted[i])]++; });
  const perLabel = labels.map((label, k) => {
    const tp = matrix[k][k];
    const actual = matrix[k].reduce((a, b) => a + b, 0);
    const called = matrix.reduce((s, row) => s + row[k], 0);
    const precision = called ? tp / called : 0, recall = actual ? tp / actual : 0;
    return { label, n: actual, called, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
  });
  const correct = matrix.reduce((s, row, k) => s + row[k], 0);
  return { accuracy: truth.length ? correct / truth.length : 0, macroF1: perLabel.reduce((s, l) => s + l.f1, 0) / K, perLabel, matrix, n: truth.length };
}

/**
 * How accuracy rises when the detector only speaks if it is confident.
 * pairs: [[confidence, correct (0 or 1)], ...]. Returns, for each threshold, the share of texts it still answers and how often it is right.
 */
export function selective(pairs, thresholds) {
  return thresholds.map((t) => {
    const kept = pairs.filter(([c]) => clears(c, t));
    return { threshold: t, coverage: pairs.length ? kept.length / pairs.length : 0, accuracy: kept.length ? kept.filter(([, ok]) => ok).length / kept.length : NaN, n: kept.length };
  });
}
