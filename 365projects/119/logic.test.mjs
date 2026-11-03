import test from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT, VERSION, LIMITS, logit, sigmoid, decibans, percentText, oddsText, ratioText, parseProbability, parseRatio,
  checkPrior, checkItem, evaluate, newClaim, addItem, editItem, removeItem, toJSON, readClaim, parseImport, mergeClaims,
  restore, EXAMPLES, exampleClaim, RATIO_ZERO, RATIO_INFINITE, isDate,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const today = "2026-10-29";
const claimOf = (prior, items) => ({ id: "c1", text: "x", prior, created: today, items: items.map((r, i) => ({ id: `e${i}`, text: "e", mode: "ratio", ratio: r, pH: null, pNotH: null, given: false, added: today })) });

test("Bayes in odds form: a hand-computed case", () => {
  // Prior 20%: odds 1 to 4. A ratio of 6 makes them 6 to 4, so 60%.
  const e = evaluate(claimOf(0.2, [6]));
  close(e.p, 0.6, 1e-12);
  close(e.totalRatio, 6, 1e-12);
  close(e.steps[1].db, 10 * Math.log10(6), 1e-12);
  // The same result from Bayes' theorem written with probabilities: 0.2 x 0.6 / (0.2 x 0.6 + 0.8 x 0.1).
  const probs = { ...claimOf(0.2, []), items: [{ id: "a", text: "e", mode: "probs", pH: 0.6, pNotH: 0.1, ratio: 6, given: false, added: today }] };
  close(evaluate(probs).p, (0.2 * 0.6) / (0.2 * 0.6 + 0.8 * 0.1), 1e-12);
});

test("the order of independent evidence does not change the final belief, only the path", () => {
  const a = evaluate(claimOf(0.3, [4, 0.5, 2.5, 0.1, 7]));
  const b = evaluate(claimOf(0.3, [0.1, 7, 4, 2.5, 0.5]));
  close(a.p, b.p, 1e-12);
  assert.notEqual(a.steps[1].p, b.steps[1].p);
  // A ratio of 1 changes nothing; a ratio and its reciprocal cancel.
  close(evaluate(claimOf(0.3, [1])).p, 0.3, 1e-12);
  close(evaluate(claimOf(0.3, [8, 1 / 8])).p, 0.3, 1e-12);
});

test("the medical-test example: 1% prior, one positive test 7.8%, two 41.2% (the finding), or 7.8% if the second only repeats the first", () => {
  const c = exampleClaim("test", today, "t");
  const e = evaluate(c);
  close(c.items[0].ratio, 0.8 / 0.096, 1e-12);
  assert.equal(percentText(e.steps[1].L), "7.8%");    // as on day 4
  assert.equal(percentText(e.L), "41.2%");
  assert.equal(percentText(e.overlap.L), "7.8%");
  assert.equal(e.differs, true);
  assert.equal(e.overlap.counted, 2);
  // Separately: odds 1/99 x (0.8/0.096)^2 = 0.7015, probability 0.4123.
  close(e.p, ((1 / 99) * (0.8 / 0.096) ** 2) / (1 + (1 / 99) * (0.8 / 0.096) ** 2), 1e-12);
});

test("the other examples", () => {
  const coin = evaluate(exampleClaim("coin", today, "k"));
  close(coin.totalRatio, 1.5 ** 4 * 0.5, 1e-9);
  assert.equal(percentText(coin.L), "71.7%");
  // Every toss is evidence of the same kind and they are independent given the coin, so the overlap check would
  // keep one head and one tail only: the honest answer is the product.
  assert.equal(percentText(coin.overlap.L), "42.9%"); // odds 1 x 1.5 x 0.5 = 0.75
  const w = evaluate(exampleClaim("witnesses", today, "w"));
  assert.equal(percentText(w.steps[1].L), "57.1%");
  assert.equal(percentText(w.L), "66.7%");  // B entered given A: 0.9 against 0.6
  assert.equal(w.differs, false);           // only one item is left to overlap
  // Had B's ratio of 12 been multiplied in as if independent, 10% would have become 94.1%.
  assert.equal(percentText(evaluate(claimOf(0.1, [12, 12])).L), "94.1%");
  assert.equal(EXAMPLES.length, 3);
});

test("the overlap check keeps only the strongest item each way, and leaves items entered given the others alone", () => {
  const c = claimOf(0.5, [4, 9, 0.5, 0.2]);
  const e = evaluate(c);
  close(e.overlap.L, Math.log(9) + Math.log(0.2), 1e-12);
  c.items[0].given = true; // the 4 was entered given the items above, so it is kept
  close(evaluate(c).overlap.L, Math.log(4) + Math.log(9) + Math.log(0.2), 1e-12);
  assert.equal(evaluate(claimOf(0.5, [3])).differs, false);
  assert.equal(evaluate(claimOf(0.5, [])).differs, false);
});

test("percentages never round to 0% or 100%, and extremes stay finite", () => {
  assert.equal(percentText(0), "50.0%");
  assert.equal(percentText(logit(0.999)), "99.9%");
  assert.equal(percentText(logit(0.9995)), "99.95%");
  assert.equal(percentText(logit(0.999987)), "99.9987%");
  assert.equal(percentText(logit(0.0004)), "0.04%");
  assert.equal(percentText(logit(1e-6)), "0.0001%");
  assert.equal(percentText(40), "more than 99.9999%");
  assert.equal(percentText(-40), "less than 0.0001%");
  // 40 items at the largest ratio: still a number, still not 100%.
  const big = evaluate(claimOf(1 - 1e-6, Array(40).fill(1e6)));
  assert.ok(Number.isFinite(big.L) && big.p < 1 + 1e-15);
  assert.equal(percentText(big.L), "more than 99.9999%");
  assert.equal(oddsText(big.L), "more than a trillion to 1");
  assert.equal(oddsText(-Math.log(3e9)), "1 to 3 billion");
  const tiny = evaluate(claimOf(1e-6, Array(40).fill(1e-6)));
  assert.ok(Number.isFinite(tiny.L));
  assert.equal(percentText(tiny.L), "less than 0.0001%");
  for (const p of [1e-6, 0.01, 0.5, 0.97, 1 - 1e-6]) close(sigmoid(logit(p)), p, 1e-12);
  assert.ok(sigmoid(-800) >= 0 && sigmoid(800) <= 1);
});

test("odds and ratios in words", () => {
  assert.equal(oddsText(Math.log(3)), "3 to 1");
  assert.equal(oddsText(logit(0.01)), "1 to 99");
  assert.equal(oddsText(0), "1 to 1");
  assert.equal(oddsText(Math.log(2.5e6)), "2.5 million to 1");
  assert.equal(oddsText(Math.log(12345)), "12,345 to 1");
  assert.equal(ratioText(0.8 / 0.096), "×8.33");
  assert.equal(ratioText(0.25), "×0.25");
  assert.equal(ratioText(1e-6), "÷1 million");
  assert.equal(ratioText(0.004), "×0.004");
  assert.equal(ratioText(1.8e229), "×more than a trillion");
  assert.equal(ratioText(1e-240), "÷more than a trillion");
  assert.equal(ratioText(2e6), "×2 million");
  close(decibans(10), 10, 1e-12);
});

test("reading probabilities as people type them", () => {
  assert.equal(parseProbability("30").value, 0.3);
  assert.equal(parseProbability(" 30 % ").value, 0.3);
  assert.equal(parseProbability("0.5%").value, 0.005);
  assert.equal(parseProbability("1 in 1000").value, 0.001);
  assert.equal(parseProbability("1 in 1,000").value, 0.001);
  assert.equal(parseProbability("1/4").value, 0.25);
  assert.equal(parseProbability("100").value, 1);
  assert.equal(parseProbability("0").value, 0);
  assert.match(parseProbability("").error, /empty/);
  assert.match(parseProbability("150").error, /more than 100%/);
  assert.match(parseProbability("-5").error, /negative/);
  assert.match(parseProbability("abc").error, /not a number/);
  assert.match(parseProbability("3 in 2").error, /more than 1 in 1/);
  assert.match(parseProbability("1/0").error, /more than 0/);
  assert.match(parseProbability("<b>9</b>").error, /not a number/);
  assert.match(parseProbability("9".repeat(300)).error, /too long/);
});

test("reading likelihood ratios, and refusing 0 and unlimited ones with the reason", () => {
  assert.equal(parseRatio("3").value, 3);
  assert.equal(parseRatio("1/4").value, 0.25);
  assert.equal(parseRatio("3:1").value, 3);
  assert.equal(parseRatio("1 to 20").value, 0.05);
  assert.equal(parseRatio("1e3").value, 1000);
  assert.equal(parseRatio("0").error, RATIO_ZERO);
  assert.equal(parseRatio("0/5").error, RATIO_ZERO);
  assert.equal(parseRatio("5/0").error, RATIO_INFINITE);
  assert.equal(parseRatio("Infinity").error, RATIO_INFINITE);
  assert.equal(parseRatio("1e400").error, RATIO_INFINITE);
  assert.match(parseRatio("-2").error, /negative/);
  assert.match(parseRatio("").error, /empty/);
  assert.match(checkItem({ text: "x", mode: "ratio", ratio: "2e6" }).error, /a million/);
  assert.match(checkItem({ text: "x", mode: "ratio", ratio: "1e-7" }).error, /a million/);
});

test("checking evidence typed as two probabilities", () => {
  const ok = checkItem({ text: "  a   positive test ", mode: "probs", pH: "80%", pNotH: "9.6", given: true });
  assert.equal(ok.item.text, "a positive test");
  close(ok.item.ratio, 0.8 / 0.096, 1e-12);
  assert.equal(ok.item.given, true);
  assert.equal(checkItem({ text: "x", mode: "probs", pH: "0", pNotH: "5" }).field, "pH");
  assert.match(checkItem({ text: "x", mode: "probs", pH: "0", pNotH: "5" }).error, /could not happen at all if the claim were true/);
  assert.match(checkItem({ text: "x", mode: "probs", pH: "5", pNotH: "0" }).error, /could not happen at all if the claim were false/);
  assert.equal(checkItem({ text: "x", mode: "probs", pH: "5", pNotH: "120" }).field, "pNotH");
  assert.equal(checkItem({ text: "", mode: "ratio", ratio: "2" }).field, "text");
  assert.match(checkItem({ text: "w".repeat(300), mode: "ratio", ratio: "2" }).error, /160 characters; it has 300/);
  assert.equal(checkItem({ text: "same", mode: "probs", pH: "40", pNotH: "40" }).item.ratio, 1);
});

test("priors of exactly 0 or 100% are refused with the reason, and so is anything past a millionth", () => {
  assert.match(checkPrior(0).error, /0% can never be moved.*regularity/);
  assert.match(checkPrior(1).error, /100% can never be moved/);
  assert.match(checkPrior(1e-7).error, /0.0001% and 99.9999%/);
  assert.equal(checkPrior(0.3).value, 0.3);
  assert.match(checkPrior(NaN).error, /percentage/);
});

test("adding, editing and removing evidence; the claim holds at most 40 items", () => {
  let c = newClaim("  It   will rain ", 0.4, today, "c9");
  assert.equal(c.text, "It will rain");
  const a = addItem(c, { text: "dark clouds", mode: "ratio", ratio: "3" }, today, "e1");
  c = a.claim;
  assert.equal(c.items[0].added, today);
  c = editItem(c, "e1", { text: "dark clouds", mode: "ratio", ratio: "2" }).claim;
  assert.equal(c.items[0].ratio, 2);
  assert.equal(c.items[0].id, "e1");
  assert.match(editItem(c, "nope", { text: "x", mode: "ratio", ratio: "2" }).error, /no longer/);
  assert.match(editItem(c, "e1", { text: "x", mode: "ratio", ratio: "0" }).error, /refuting/);
  c = removeItem(c, "e1").claim;
  assert.equal(c.items.length, 0);
  assert.match(removeItem(c, "e1").error, /no longer/);
  let full = c;
  for (let i = 0; i < LIMITS.items; i++) full = addItem(full, { text: `i${i}`, mode: "ratio", ratio: "1.1" }, today, `x${i}`).claim;
  assert.match(addItem(full, { text: "one more", mode: "ratio", ratio: "2" }, today).error, /up to 40/);
});

test("export and import give back exactly the same claims", () => {
  const claims = [exampleClaim("test", today, "a"), exampleClaim("coin", today, "b"), exampleClaim("witnesses", "2026-01-02", "c")];
  claims[0].items.push({ id: "odd", text: "=SUM(A1) <b>bold</b> " + "z".repeat(100), mode: "ratio", ratio: 1 / 3, pH: null, pNotH: null, given: true, added: "2026-03-04" });
  claims[0].prior = 0.0123456789;
  const back = parseImport(toJSON(claims), today);
  assert.deepEqual(back.problems, []);
  assert.deepEqual(back.claims, claims);
  const again = parseImport(toJSON(back.claims), today);
  assert.deepEqual(again.claims, claims);
});

test("import refuses what it cannot read, and says why", () => {
  assert.match(parseImport("", today).error, /empty/);
  assert.match(parseImport("id,text\n1,2", today).error, /JSON file/);
  assert.match(parseImport("{ broken", today).error, /cut short/);
  assert.match(parseImport('{"format":"365-forecast-log","claims":[]}', today).error, /not from this page/);
  assert.match(parseImport(JSON.stringify({ format: FORMAT, version: VERSION + 1, claims: [] }), today).error, /newer version/);
  assert.match(parseImport('{"claims":[]}', today).error, /no claims/);
  const mixed = parseImport(JSON.stringify({ format: FORMAT, version: 1, claims: [
    { id: "ok", text: "fine", prior: 0.5, items: [] },
    { id: "zero", text: "certain", prior: 1, items: [] },
    { id: "bad", text: "bad item", prior: 0.5, items: [{ text: "e", mode: "ratio", ratio: 0 }] },
    { id: "inf", text: "bad probs", prior: 0.5, items: [{ text: "e", mode: "probs", pH: 0.5, pNotH: 0 }] },
  ] }), today);
  assert.deepEqual(mixed.claims.map((c) => c.id), ["ok"]);
  assert.equal(mixed.problems.length, 3);
  assert.match(mixed.problems[0], /Claim 2: its prior/);
  assert.match(mixed.problems[1], /Claim 3: evidence 1: /);
  assert.match(readClaim({ text: "x", prior: 0.5, items: Array(41).fill({ text: "e", mode: "ratio", ratio: 2 }) }, today).error, /more than 40/);
});

test("merging an import keeps what is there and adds only new claims", () => {
  const mine = [exampleClaim("test", today, "a")];
  const m = mergeClaims(mine, [exampleClaim("test", today, "a"), exampleClaim("coin", today, "b")]);
  assert.equal(m.added, 1);
  assert.equal(m.duplicates, 1);
  assert.equal(m.claims.length, 2);
  assert.equal(m.firstAdded, "b");
  const many = Array.from({ length: LIMITS.claims }, (_, i) => newClaim(`c${i}`, 0.5, today, `id${i}`));
  assert.equal(mergeClaims(many, [newClaim("x", 0.5, today, "new")]).overLimit, 1);
});

test("restoring from storage keeps the sound claims and drops the rest", () => {
  assert.equal(restore(null, today), null);
  assert.equal(restore({ claims: "no" }, today), null);
  const r = restore({ claims: [exampleClaim("coin", today, "k"), { id: "x", text: "", prior: 0.5, items: [] }], current: "k" }, today);
  assert.equal(r.claims.length, 1);
  assert.equal(r.current, "k");
  assert.equal(isDate("2026-02-30"), false);
  assert.equal(isDate(today), true);
});

test("storage written by a newer version of the page is neither read nor rewritten, and a file from another page is named", () => {
  const newer = restore({ format: FORMAT, version: VERSION + 1, claims: [exampleClaim("coin", today, "k")] }, today);
  assert.deepEqual(newer.claims, []);
  assert.equal(newer.newer, VERSION + 1);
  assert.equal(restore({ format: FORMAT, version: VERSION, claims: [exampleClaim("coin", today, "k")] }, today).newer, undefined);
  // Day 24's export has no "claims" list: it is refused as a file from another page, not as a broken one.
  assert.match(parseImport(JSON.stringify({ format: "365-forecast-log", version: 1, log: [] }), today).error, /not from this page/);
  assert.match(readClaim({ text: "x", prior: 1e-300, items: [] }, today).error, /between 0.0001% and 99.9999%/);
});
