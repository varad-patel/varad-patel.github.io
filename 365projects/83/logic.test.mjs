import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { CREDIT } from "./data.js";
import {
  decode, splitTest, INPUTS, DEFAULT_INPUTS, PROTECTED, columnsOf, designRow, designMatrix, rowProfile, createStore, fillStore,
  matrixFromStore, predictFromStore, fitLogistic, linear, sigmoid, logit, predictWithInterval, brier, auc, wilson, reliability, scores,
  groupMeasures, chouldechovaFpr, cutForShare, cutoffs, columnMeans, contributions, readProfile, utilisation, statusGroup,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

/* ---------- the data ---------- */

const D = decode(CREDIT);
const isTest = splitTest(D.n);
const TRAIN = [], TEST = [];
for (let i = 0; i < D.n; i++) (isTest[i] ? TEST : TRAIN).push(i);

test("the bundled data match the source workbook", () => {
  // Counts from "default of credit card clients.xls" (UCI, I-Cheng Yeh): 30,000 rows, 6,636 defaults, 18,112 coded female.
  assert.equal(D.n, 30000);
  assert.equal(D.y.reduce((a, b) => a + b, 0), 6636);
  assert.equal(D.sex.filter((s) => s === 2).length, 18112);
  // ID 1 in the workbook: LIMIT_BAL 20000, SEX 2, EDUCATION 2, MARRIAGE 1, AGE 24, PAY_0 2, PAY_2 2, PAY_3 -1, PAY_4 -1,
  // PAY_5 -2, PAY_6 -2, BILL_AMT1 3913, PAY_AMT1 0, default 1.
  assert.deepEqual(rowProfile(D, 0), { limit: 20000, age: 24, edu: 1, mar: 0, sex: 2, status: 2, late: 1, bill: 3910, paid: 0 });
  assert.equal(D.y[0], 1);
  // ID 2: 120000, SEX 2, EDUCATION 2, MARRIAGE 2, AGE 26, PAY_0 -1, PAY_2 2, PAY_3..5 0, PAY_6 2, BILL_AMT1 2682, PAY_AMT1 0, default 1.
  assert.deepEqual(rowProfile(D, 1), { limit: 120000, age: 26, edu: 1, mar: 1, sex: 2, status: -1, late: 2, bill: 2680, paid: 0 });
  // ID 30000: 50000, SEX 1, EDUCATION 2, MARRIAGE 1, AGE 46, PAY_0 0, PAY_2..6 0, BILL_AMT1 47929, PAY_AMT1 2078, default 1.
  assert.deepEqual(rowProfile(D, 29999), { limit: 50000, age: 46, edu: 1, mar: 0, sex: 1, status: 0, late: 0, bill: 47930, paid: 2080 });
  assert.equal(D.y[29999], 1);
  // The codes the codebook does not define are counted in the module: education 0, 5, 6 and marital status 0.
  assert.deepEqual(CREDIT.rawCodes.EDUCATION, { 0: 14, 1: 10585, 2: 14030, 3: 4917, 4: 123, 5: 280, 6: 51 });
  assert.deepEqual(CREDIT.rawCodes.MARRIAGE, { 0: 54, 1: 13659, 2: 15964, 3: 323 });
  assert.equal(CREDIT.rawCodes.PAY_0["-2"], 2759);
  assert.equal(D.edu.filter((e) => e === 3).length, 14 + 123 + 280 + 51);
  assert.equal(CREDIT.source.licence, "CC BY 4.0");
});

test("the split is fixed by its seed: 19,998 to fit and 10,002 held out", () => {
  assert.equal(TRAIN.length, 19998);
  assert.equal(TEST.length, 10002);
  assert.deepEqual(splitTest(100), splitTest(100));
  assert.notDeepEqual(Array.from(splitTest(100, 1)), Array.from(splitTest(100, 2)));
});

/* ---------- the inputs ---------- */

test("design rows: reference groups are all zeros, and each input adds its columns", () => {
  const p = { limit: 100000, age: 35, edu: 0, mar: 0, sex: 1, status: -1, late: 0, bill: 0, paid: 0 };
  assert.deepEqual(designRow(p, DEFAULT_INPUTS), [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(columnsOf(DEFAULT_INPUTS).length, 16);
  assert.equal(columnsOf([...DEFAULT_INPUTS, "sex"]).length, 17);
  assert.deepEqual(designRow({ ...p, sex: 2, status: 5, edu: 3, mar: 1, late: 4, age: 55, limit: 200000, bill: 300000, paid: Math.E - 1 }, INPUTS.map((f) => f.key)),
    [1, Math.log(2), 2, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 4, 1.5, 1]);
  close(utilisation(-100000, 100000), -0.5);
  close(utilisation(25000, 100000), 0.25);
  assert.equal(statusGroup(8), 3);
  assert.equal(statusGroup(-2), -2);
  assert.deepEqual(designRow(p, []), [1]);
});

test("the column store gives the same matrix and forecasts as building rows one by one", () => {
  const store = createStore(D);
  for (let i = 0; i < D.n; i += 7000) fillStore(store, D, i, i + 7000);
  const idx = [0, 1, 2, 500, 29999];
  const a = matrixFromStore(store, idx, DEFAULT_INPUTS), b = designMatrix(D, idx, DEFAULT_INPUTS);
  assert.deepEqual(Array.from(a.X), Array.from(b.X));
  const beta = columnsOf(DEFAULT_INPUTS).map((_, j) => (j % 3) * 0.1 - 0.1);
  const p = predictFromStore(store, idx, DEFAULT_INPUTS, beta);
  idx.forEach((i, k) => close(p[k], sigmoid(linear(beta, designRow(rowProfile(D, i), DEFAULT_INPUTS))), 1e-12));
});

/* ---------- fitting ---------- */

test("logistic regression with one binary input reproduces the two groups' log-odds and the textbook standard errors", () => {
  // 40 cases with x = 0, 10 of them y = 1; 60 with x = 1, 30 of them y = 1.
  const X = [], y = [];
  for (let i = 0; i < 40; i++) { X.push(1, 0); y.push(i < 10 ? 1 : 0); }
  for (let i = 0; i < 60; i++) { X.push(1, 1); y.push(i < 30 ? 1 : 0); }
  const f = fitLogistic(Float64Array.from(X), y, 100, 2);
  assert.ok(f.converged);
  close(f.beta[0], Math.log(10 / 30), 1e-9);
  close(f.beta[1], Math.log(30 / 30) - Math.log(10 / 30), 1e-9);
  // se(b0) = sqrt(1/10 + 1/30); se(b1) = sqrt(1/10 + 1/30 + 1/30 + 1/30).
  close(Math.sqrt(f.cov[0][0]), Math.sqrt(1 / 10 + 1 / 30), 1e-8);
  close(Math.sqrt(f.cov[1][1]), Math.sqrt(1 / 10 + 1 / 30 + 1 / 30 + 1 / 30), 1e-8);
  // Deviance by hand: -2 * sum of log-likelihoods.
  const dev = -2 * (10 * Math.log(0.25) + 30 * Math.log(0.75) + 30 * Math.log(0.5) + 30 * Math.log(0.5));
  close(f.deviance, dev, 1e-8);
});

test("an intercept-only fit is the log-odds of the mean, in one step", () => {
  const y = [1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
  const f = fitLogistic(new Float64Array(10).fill(1), y, 10, 1);
  close(f.beta[0], logit(0.2), 1e-12);
  assert.ok(f.iterations <= 1);
});

test("on simulated data the fit recovers the true coefficients", () => {
  const r = rng(7);
  const n = 20000, truth = [-1, 0.8, -0.5];
  const X = new Float64Array(n * 3), y = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = r.normal(), b = r.bool(0.4) ? 1 : 0;
    X[i * 3] = 1; X[i * 3 + 1] = a; X[i * 3 + 2] = b;
    y[i] = r() < sigmoid(truth[0] + truth[1] * a + truth[2] * b) ? 1 : 0;
  }
  const f = fitLogistic(X, y, n, 3);
  f.beta.forEach((b, j) => assert.ok(Math.abs(b - truth[j]) < 3 * Math.sqrt(f.cov[j][j]), `coefficient ${j}: ${b} against ${truth[j]}`));
});

test("perfectly separated data stop at the iteration limit rather than looping for ever", () => {
  const X = Float64Array.from([1, -1, 1, -2, 1, 1, 1, 2]), y = [0, 0, 1, 1];
  const f = fitLogistic(X, y, 4, 2, { maxIter: 25 });
  assert.ok(f.iterations <= 25);
  assert.ok(f.beta[1] > 5);
});

test("the interval for a forecast is the delta-method interval on the log-odds", () => {
  const fit = { beta: [-1, 0.5], cov: [[0.04, 0.01], [0.01, 0.09]] };
  const row = [1, 2];
  const r = predictWithInterval(fit, row);
  const se = Math.sqrt(0.04 + 2 * 2 * 0.01 + 4 * 0.09);
  close(r.p, sigmoid(0));
  close(r.se, se, 1e-12);
  close(r.low, sigmoid(-1.959963984540054 * se), 1e-12);
  close(r.high, sigmoid(1.959963984540054 * se), 1e-12);
});

/* ---------- scores ---------- */

test("Brier score and AUC by hand", () => {
  close(brier([0.8, 0.6, 0.1], [1, 0, 0]), (0.04 + 0.36 + 0.01) / 3);
  // Defaulters scored 0.9 and 0.4; repayers 0.4, 0.3 and 0.1. Pairs won: 3 + 0.5 (the tie) + 2 = 5.5 of 6.
  close(auc([0.9, 0.4, 0.4, 0.3, 0.1], [1, 1, 0, 0, 0]), 5.5 / 6);
  close(auc([0.5, 0.5, 0.5], [1, 0, 1]), 0.5);
  assert.ok(Number.isNaN(auc([0.2, 0.3], [0, 0])));
});

test("reliability: ten equal groups by forecast, with Wilson intervals", () => {
  const p = Array.from({ length: 100 }, (_, i) => i / 100);
  const y = p.map((v, i) => (i % 10 < Math.round(v * 10) ? 1 : 0));
  const bins = reliability(p, y, 10);
  assert.equal(bins.length, 10);
  assert.ok(bins.every((b) => b.n === 10));
  close(bins[3].predicted, 0.345);
  close(bins[3].observed, 0.3);
  const w = wilson(3, 10);
  close(bins[3].low, w.low); close(bins[3].high, w.high);
  // Wilson by hand for 3 of 10: centre (0.3 + z^2/20) / (1 + z^2/10).
  const z = 1.959963984540054;
  close(w.low, (0.3 + z * z / 20 - z * Math.sqrt(0.021 + z * z / 400)) / (1 + z * z / 10), 1e-12);
  assert.deepEqual(reliability([0.2, 0.4], [0, 1], 10).map((b) => b.n), [1, 1]);
});

test("reliability never splits equal forecasts between groups", () => {
  // Every forecast the same (a model with no inputs): one group, not ten arbitrary ones.
  const flat = reliability(new Array(25).fill(0.22), Array.from({ length: 25 }, (_, i) => (i < 5 ? 1 : 0)), 10);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].n, 25);
  close(flat[0].observed, 0.2);
  // Two distinct forecasts, 6 and 4 of each: two groups of 6 and 4, whatever the order.
  const two = reliability([0.3, 0.1, 0.3, 0.1, 0.1, 0.3, 0.1, 0.1, 0.3, 0.1], [1, 0, 0, 0, 1, 1, 0, 0, 1, 0], 10);
  assert.deepEqual(two.map((b) => [b.n, b.from, b.to]), [[6, 0.1, 0.1], [4, 0.3, 0.3]]);
  close(two[1].observed, 0.75);
  // One tie straddling a boundary moves the boundary up.
  assert.deepEqual(reliability([0.1, 0.2, 0.2, 0.3], [0, 0, 1, 1], 4).map((b) => b.n), [1, 2, 1]);
});

/* ---------- fairness ---------- */

test("group measures by hand from a small confusion matrix", () => {
  // Six cardholders, cut-off 0.5: flagged are the 0.9 (defaulted), 0.7 (repaid) and 0.5 (defaulted).
  const p = [0.9, 0.7, 0.5, 0.4, 0.2, 0.1], y = [1, 0, 1, 1, 0, 0];
  const g = groupMeasures(p, y, 0.5);
  assert.equal(g.n, 6);
  close(g.baseRate, 0.5);
  close(g.flagged, 0.5);
  close(g.tpr, 2 / 3); close(g.fnr, 1 / 3);
  close(g.fpr, 1 / 3);
  close(g.ppv, 2 / 3);
  close(g.scoreIfDefault, (0.9 + 0.5 + 0.4) / 3);
  close(g.scoreIfRepaid, (0.7 + 0.2 + 0.1) / 3);
  close(g.meanP, 2.8 / 6);
  // Chouldechova's identity holds for these counts: 1 * (1/2) * (2/3) = 1/3.
  close(chouldechovaFpr(g.baseRate, g.ppv, g.fnr), g.fpr);
  const none = groupMeasures(p, y, 0.95);
  assert.equal(none.flaggedCount, 0);
  assert.ok(Number.isNaN(none.ppv));
});

test("cut-offs that equalise a rate do so on the data they were chosen on", () => {
  const r = rng(3);
  const n = 4000;
  const g = Array.from({ length: n }, () => (r.bool(0.4) ? 1 : 0));
  const y = g.map((gi) => (r() < (gi ? 0.3 : 0.2) ? 1 : 0));
  const p = y.map((yi, i) => sigmoid(-1.5 + 1.5 * yi + 0.4 * g[i] + r.normal(0, 1)));
  const flagRate = (k, cut, keep) => { const idx = p.map((_, i) => i).filter((i) => g[i] === k && keep(i)); return idx.filter((i) => p[i] >= cut).length / idx.length; };
  const [c0, c1] = cutoffs("parity", 0.4, p, y, g);
  assert.ok(Math.abs(flagRate(0, c0, () => true) - flagRate(1, c1, () => true)) < 0.002);
  const [o0, o1] = cutoffs("opportunity", 0.4, p, y, g);
  assert.ok(Math.abs(flagRate(0, o0, (i) => !y[i]) - flagRate(1, o1, (i) => !y[i])) < 0.002);
  assert.deepEqual(cutoffs("one", 0.4, p, y, g), [0.4, 0.4]);
  assert.equal(cutForShare([0.1, 0.2, 0.3], 0), Infinity);
  assert.equal(cutForShare([0.1, 0.2, 0.3], 2 / 3), 0.2);
  assert.throws(() => cutoffs("nonsense", 0.4, p, y, g));
});

/* ---------- explaining a forecast ---------- */

test("contributions add up to the profile's log-odds minus the average cardholder's", () => {
  const keys = DEFAULT_INPUTS;
  const M = designMatrix(D, TRAIN.slice(0, 2000), keys);
  const means = columnMeans(M);
  const beta = columnsOf(keys).map((_, j) => Math.sin(j + 1));
  const row = designRow(rowProfile(D, 5), keys);
  const parts = contributions(beta, row, means, keys);
  assert.equal(parts.length, keys.length);
  close(parts.reduce((s, x) => s + x.value, 0), linear(beta, row) - linear(beta, means), 1e-9);
});

/* ---------- reading a profile ---------- */

test("profile input: limits, whole numbers and choices are checked with messages that say what to fix", () => {
  const ok = { limit: "140000", age: "34", edu: "1", mar: "1", sex: "2", status: "0", late: "0", bill: "22000", paid: "2100" };
  assert.deepEqual(readProfile(ok).profile, { limit: 140000, age: 34, edu: 1, mar: 1, sex: 2, status: 0, late: 0, bill: 22000, paid: 2100 });
  const bad = readProfile({ ...ok, limit: "5", age: "34.5", bill: "", paid: "1e308", status: "9" });
  const keys = bad.errors.map((e) => e.key);
  assert.deepEqual(keys, ["limit", "age", "status", "bill", "paid"]);
  assert.match(bad.errors[0].message, /from 10,000 to 1,000,000/);
  assert.match(bad.errors[1].message, /whole number/);
  assert.match(bad.errors[3].message, /as a number/);
  assert.equal(readProfile({ ...ok, paid: "-1" }).errors[0].key, "paid");
  assert.equal(readProfile({ ...ok, limit: "abc" }).errors[0].message, "Enter a credit limit in NT$ as a number.");
});

/* ---------- the real model and the finding ---------- */

const yTrain = TRAIN.map((i) => D.y[i]), yTest = TEST.map((i) => D.y[i]);
const store = createStore(D);
fillStore(store, D, 0, D.n);
function model(keys) {
  const M = matrixFromStore(store, TRAIN, keys);
  const fit = fitLogistic(M.X, yTrain, M.n, M.p);
  return { fit, pTr: predictFromStore(store, TRAIN, keys, fit.beta), pTe: predictFromStore(store, TEST, keys, fit.beta) };
}
const without = model(DEFAULT_INPUTS);
const withSex = model([...DEFAULT_INPUTS, "sex"]);
const sex = PROTECTED.find((p) => p.value === "sex");
const gTest = TEST.map((i) => sex.group(D, i));
const part = (arr, g) => Array.from(arr).filter((_, k) => gTest[k] === g);
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

test("held-out scores: better than the base rate, AUC 0.775", () => {
  const base = mean(yTrain);
  const s = scores(without.pTe, yTest, base);
  assert.ok(without.fit.converged);
  assert.equal(without.fit.iterations, 5); // "with the standard inputs that takes five steps"
  assert.equal(s.auc.toFixed(3), "0.775");
  assert.equal(s.brier.toFixed(4), "0.1353");
  assert.equal(s.baseBrier.toFixed(4), "0.1722");
  assert.equal(s.observed.toFixed(4), "0.2212");
  assert.ok(s.skill > 0.2);
});

test("the finding: without sex the model overstates women's risk and understates men's", () => {
  // Women are group 0, men group 1.
  assert.equal(part(yTest, 0).length, 6057);
  assert.equal(part(yTest, 1).length, 3945);
  assert.equal((mean(part(yTest, 0)) * 100).toFixed(1), "20.6");
  assert.equal((mean(part(yTest, 1)) * 100).toFixed(1), "24.4");
  assert.equal((mean(part(without.pTe, 0)) * 100).toFixed(1), "21.8");
  assert.equal((mean(part(without.pTe, 1)) * 100).toFixed(1), "23.7");
  assert.equal((mean(part(withSex.pTe, 0)) * 100).toFixed(1), "21.2");
  assert.equal((mean(part(withSex.pTe, 1)) * 100).toFixed(1), "24.6");
  for (const g of [0, 1]) assert.ok(Math.abs(mean(part(withSex.pTe, g)) - mean(part(yTest, g))) < 0.006);
  const women = groupMeasures(part(without.pTe, 0), part(yTest, 0), 0.5);
  const men = groupMeasures(part(without.pTe, 1), part(yTest, 1), 0.5);
  assert.equal((women.fpr * 100).toFixed(1), "4.3");
  assert.equal((men.fpr * 100).toFixed(1), "6.3");
  // Chouldechova's identity holds exactly on the held-out counts.
  close(chouldechovaFpr(women.baseRate, women.ppv, women.fnr), women.fpr, 1e-12);
  close(chouldechovaFpr(men.baseRate, men.ppv, men.fnr), men.fpr, 1e-12);
});

test("the other inputs carry a trace of sex: a model of sex from them scores an AUC near 0.60", () => {
  const keys = DEFAULT_INPUTS;
  const g = TRAIN.map((i) => sex.group(D, i));
  const M = matrixFromStore(store, TRAIN, keys);
  const fit = fitLogistic(M.X, g, M.n, M.p);
  const a = auc(predictFromStore(store, TEST, keys, fit.beta), gTest);
  assert.ok(a > 0.58 && a < 0.62, `AUC ${a}`);
});

// The proxy AUCs quoted under "Proxies", and which inputs carry them (checked against an independent fit on the
// original workbook: 0.599, 0.565 without age; 0.803, 0.674 without marital status, 0.776 without the limit).
function proxyAuc(attr, keys) {
  const prot = PROTECTED.find((p) => p.value === attr);
  const M = matrixFromStore(store, TRAIN, keys);
  const fit = fitLogistic(M.X, TRAIN.map((i) => prot.group(D, i)), M.n, M.p);
  // The page measures how well the inputs tell the two groups apart; AUC is symmetric in which group is called 1.
  return auc(predictFromStore(store, TEST, keys, fit.beta), TEST.map((i) => prot.group(D, i)));
}
test("proxies: sex is carried mostly by age, being under 30 mostly by marital status and the credit limit", () => {
  const without = (keys, k) => keys.filter((x) => x !== k);
  const sexAll = proxyAuc("sex", DEFAULT_INPUTS);
  assert.equal(sexAll.toFixed(2), "0.60");
  assert.equal(proxyAuc("sex", without(DEFAULT_INPUTS, "age")).toFixed(2), "0.56");
  const ageKeys = without(DEFAULT_INPUTS, "age");
  assert.equal(proxyAuc("age", ageKeys).toFixed(2), "0.80");
  assert.equal(proxyAuc("age", without(ageKeys, "mar")).toFixed(2), "0.67");
  assert.equal(proxyAuc("age", without(ageKeys, "limit")).toFixed(2), "0.78");
});
