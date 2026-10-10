import test from "node:test";
import assert from "node:assert/strict";
import { FALLACY_MODEL } from "./model.js";
import { tokenize, countFeatures, sentences, fitVocabulary, vectorize, train, prepare, predict, folds, score, selective } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("tokenize lower-cases, keeps contractions together and drops punctuation", () => {
  assert.deepEqual(tokenize("You're WRONG, obviously! It’s 2 late."), ["you're", "wrong", "obviously", "it's", "2", "late"]);
  assert.deepEqual(tokenize("   ...   "), []);
});

test("features are words and adjacent pairs, with counts", () => {
  const f = countFeatures("the cat saw the cat");
  assert.equal(f.get("the"), 2);
  assert.equal(f.get("cat"), 2);
  assert.equal(f.get("the cat"), 2);
  assert.equal(f.get("cat saw"), 1);
  assert.equal(f.size, 3 + 3);
});

test("sentences split at full stops and question marks and keep fragments attached", () => {
  assert.deepEqual(sentences("He is wrong. Why? Because I say so! Trust me."), ["He is wrong. Why?", "Because I say so! Trust me."]);
  assert.deepEqual(sentences("One sentence only"), ["One sentence only"]);
  assert.deepEqual(sentences("The plan costs 3.5 million pounds a year. That is too much money."), ["The plan costs 3.5 million pounds a year.", "That is too much money."]);
  assert.deepEqual(sentences("   "), []);
});

test("vocabulary keeps features seen often enough and rarer features get a larger idf", () => {
  const { vocab, idf } = fitVocabulary(["a b", "a c", "a b"], 2);
  assert.deepEqual(vocab, ["a", "a b", "b"]);
  close(idf[0], Math.log(4 / 4) + 1);
  close(idf[2], Math.log(4 / 3) + 1);
  assert.ok(idf[2] > idf[0]);
});

test("vectors have length one and ignore unknown words", () => {
  const { vocab, idf } = fitVocabulary(["red apple", "red pear", "green apple"], 1);
  const index = new Map(vocab.map((f, j) => [f, j]));
  const v = vectorize("red red apple zebra", index, idf);
  close(Math.sqrt(v.reduce((s, [, x]) => s + x * x, 0)), 1);
  assert.ok(v.every(([j]) => vocab[j] !== "zebra"));
  assert.deepEqual(vectorize("zebra", index, idf), []);
});

const toy = () => {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push({ text: `you are a fool and a liar number ${i}`, label: "attack" });
    rows.push({ text: `think of the poor frightened children number ${i}`, label: "emotion" });
    rows.push({ text: `the report gives figures and a method number ${i}`, label: "none" });
  }
  return rows;
};

test("training separates classes that use different words, and probabilities sum to one", () => {
  const model = prepare(train(toy(), { epochs: 200 }));
  assert.deepEqual(model.labels, ["attack", "emotion", "none"]);
  for (const [text, label] of [["what a fool you are", "attack"], ["those poor children", "emotion"], ["the method and the figures", "none"]]) {
    const r = predict(model, text);
    assert.equal(r.ranked[0].label, label, text);
    assert.ok(r.ranked[0].p > 0.6);
    close(r.ranked.reduce((s, x) => s + x.p, 0), 1, 1e-9);
  }
  const why = predict(model, "you are a fool").because.attack.map((f) => f.feature);
  assert.ok(why.includes("fool") || why.includes("a fool"));
  assert.ok(!why.includes("number"), "a word shared by every class explains nothing");
});

test("a text with no known words falls back to the class priors", () => {
  const rows = [...toy(), ...toy().filter((r) => r.label === "none")];
  const model = prepare(train(rows, { epochs: 200 }));
  const r = predict(model, "zzz qqq");
  assert.equal(r.known, 0);
  assert.equal(r.ranked[0].label, "none");
});

test("balancing gives a rare class more say", () => {
  const rows = toy().filter((r, i) => r.label !== "attack" || i < 9); // only three "attack" rows
  const mixed = "you fool think of the children";
  const plain = predict(prepare(train(rows, { epochs: 150, balance: 0 })), mixed);
  const balanced = predict(prepare(train(rows, { epochs: 150, balance: 1 })), mixed);
  const p = (r) => r.ranked.find((x) => x.label === "attack").p;
  assert.ok(p(balanced) > p(plain));
});

test("folds are stratified and deterministic", () => {
  const rows = toy();
  const f = folds(rows, 4);
  assert.equal(f.length, rows.length);
  for (const label of ["attack", "emotion", "none"]) {
    const mine = f.filter((_, i) => rows[i].label === label);
    for (let k = 0; k < 4; k++) assert.equal(mine.filter((x) => x === k).length, 3);
  }
  assert.deepEqual(folds(rows, 4), f);
});

test("score: accuracy, precision, recall and the confusion matrix for a hand-worked case", () => {
  const s = score(["a", "b"], ["a", "a", "a", "b", "b"], ["a", "a", "b", "b", "a"]);
  assert.deepEqual(s.matrix, [[2, 1], [1, 1]]);
  close(s.accuracy, 3 / 5);
  close(s.perLabel[0].precision, 2 / 3);
  close(s.perLabel[0].recall, 2 / 3);
  close(s.perLabel[1].precision, 1 / 2);
  close(s.perLabel[1].recall, 1 / 2);
  close(s.macroF1, (2 / 3 + 1 / 2) / 2);
  assert.equal(score(["a", "b"], [], []).accuracy, 0);
});

test("selective accuracy: answering only when confident", () => {
  const pairs = [[0.9, 1], [0.8, 1], [0.6, 0], [0.5, 1], [0.3, 0]];
  const [all, mid, high, none] = selective(pairs, [0, 0.55, 0.85, 0.99]);
  close(all.coverage, 1); close(all.accuracy, 3 / 5);
  close(mid.coverage, 3 / 5); close(mid.accuracy, 2 / 3);
  close(high.coverage, 1 / 5); close(high.accuracy, 1);
  assert.equal(none.n, 0);
  assert.ok(Number.isNaN(none.accuracy));
});

test("the shipped model: shape, evaluation and the numbers quoted on the page", () => {
  const m = FALLACY_MODEL.model;
  assert.deepEqual(m.labels, ["No Fallacy", "Ad Hominem", "Appeal to Emotion", "Hasty Generalization", "Irrelevant Authority", "Red Herring"]);
  assert.equal(m.weights.length, 6);
  assert.ok(m.weights.every((w) => w.length === m.vocab.length) && m.idf.length === m.vocab.length && m.bias.length === 6);
  const e = FALLACY_MODEL.evaluation;
  assert.equal(e.matrix.flat().reduce((a, b) => a + b, 0), FALLACY_MODEL.rows);
  assert.equal(e.pairs.length, FALLACY_MODEL.rows);
  close(e.pairs.filter(([, ok]) => ok).length / e.pairs.length, e.accuracy, 0.001);
  assert.equal(FALLACY_MODEL.rows, 1297);
  assert.ok(e.accuracy > e.majorityBaseline + 0.1, "clearly better than always guessing the commonest label");
  assert.ok(e.accuracy < 0.6, "and honestly far from reliable");
  // The finding on the page.
  close(e.accuracy, 0.497, 0.001);
  close(e.majorityBaseline, 0.305, 0.001);
  close(e.fallacyOrNot, 0.683, 0.001);
  // Being choosier helps: at 50% confidence it answers about one argument in ten and is right about 83% of the time.
  const [all, sure] = selective(e.pairs, [0, 0.5]);
  close(all.accuracy, 0.497, 0.001);
  close(sure.accuracy, 0.83, 0.01);
  close(sure.coverage, 0.10, 0.01);
});

test("the shipped model is self-consistent: each label's strongest words are read as that label", () => {
  const m = FALLACY_MODEL.model;
  const model = prepare(m);
  m.labels.forEach((label, k) => {
    // Single words whose weight for this label most exceeds their average weight across labels.
    const best = m.vocab.map((f, j) => [f, m.weights[k][j] - m.weights.reduce((s, w) => s + w[j], 0) / m.labels.length])
      .filter(([f]) => !f.includes(" ")).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f]) => f);
    const r = predict(model, best.join(" "));
    assert.equal(r.ranked[0].label, label, `${label}: ${best.join(" ")}`);
    assert.ok(r.because[label].length > 0);
  });
  assert.equal(predict(model, "zxqv").known, 0);
  // Emotional wording is read as an appeal to emotion.
  assert.equal(predict(model, "Just imagine how terrified those poor children must feel. If you have any heart at all you will support this ban.").ranked[0].label, "Appeal to Emotion");
});
