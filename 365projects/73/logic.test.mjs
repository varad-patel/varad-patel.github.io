import test from "node:test";
import assert from "node:assert/strict";
import { FOMC } from "./data.js";
import { KEYWORDS, MODIFIERS, PHRASES, POLICY_RULES, UNINFORMATIVE, MAX_CHARS, sentences, flat, score, decode, percentile, nearest, verdict, track } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const pairs = (r) => r.sentences.flatMap((s) => s.pairs.map((p) => `${p.keyword}|${p.modifier}|${p.value}`));
const past = decode(FOMC).map((s) => ({ ...s, ...score(s.text) }));

test("the dictionary has every entry of the paper's tables A5 to A10", () => {
  assert.equal(KEYWORDS.length, 33);
  assert.equal(KEYWORDS.filter((k) => k[2] === "output").length, 18);
  assert.equal(KEYWORDS.filter((k) => k[2] === "inflation").length, 3);
  assert.equal(KEYWORDS.filter((k) => k[2] === "financial").length, 3);
  assert.equal(MODIFIERS.labor.length, 44);
  assert.equal(MODIFIERS.inflation.length, 53);
  assert.equal(MODIFIERS.financial.length, 7);
  assert.equal(MODIFIERS.output.length, 82);
  assert.equal(PHRASES.length, 33);
  assert.equal(POLICY_RULES.length, 16);
  assert.equal(UNINFORMATIVE.length, 14);
  // Spot checks of signs against the tables.
  assert.deepEqual(KEYWORDS.find((k) => k[0] === "unemployment"), ["unemployment", -1, "labor"]);
  assert.deepEqual(MODIFIERS.output.find((m) => m[0] === "remain moderate").slice(0, 2), ["remain moderate", -1]);
  assert.deepEqual(MODIFIERS.inflation.find((m) => m[0] === "moderate"), ["moderate", 1, { whole: true }]);
  assert.deepEqual(MODIFIERS.financial.find((m) => m[0] === "supportive"), ["supportive", 1]);
});

test("sentences are cut at a full stop and a capital, but not after an initial or U.S.", () => {
  const s = sentences("Voting were Ben S. Bernanke, Chairman; and Kevin M. Warsh. The U.S. economy grew. Prices rose!");
  assert.deepEqual(s.map((x) => x.text), ["Voting were Ben S. Bernanke, Chairman; and Kevin M. Warsh.", "The U.S. economy grew.", "Prices rose!"]);
  assert.equal(flat("Today’s mortgage-backed  Securities"), "today's mortgage backed securities");
});

test("a hand-computed score: two pairs over six words", () => {
  const r = score("Inflation has increased. Unemployment has declined.");
  assert.deepEqual(pairs(r), ["inflation|increas|1", "unemployment|declin|1"]);
  assert.equal(r.words, 6);
  close(r.total, 2 / Math.sqrt(6));
  close(r.scores.inflation, 1 / Math.sqrt(6));
  close(r.scores.labor, 1 / Math.sqrt(6));
});

test("each keyword takes the nearest modifier of its topic; a tie goes to the one after it", () => {
  // spending(0) rose(1) but(2) investment(3) was(4) weak(5): investment is 2 from rose and 2 from weak.
  const r = score("Spending rose but investment was weak.");
  assert.deepEqual(pairs(r), ["spending|rose|1", "investment|weak|-1"]);
  close(r.total, 0);
  // "low" is a labour and inflation modifier but "credit" is a financial keyword: it waits for a financial modifier.
  assert.deepEqual(pairs(score("Credit is low and markets are under strain.")), ["credit|strain|-1"]);
});

test("whole-word entries, the software exception, and a modifier inside its own keyword", () => {
  assert.deepEqual(pairs(score("Inflation picked up.")), ["inflation|picked up|1"]);
  assert.deepEqual(pairs(score("Inflation moved upward.")), ["inflation|upward|1"]);
  assert.deepEqual(pairs(score("Spending on software rose.")), ["spending|rose|1"]);
  assert.deepEqual(pairs(score("Spending was soft.")), ["spending|soft|-1"]);
  // "losses" is a labour modifier, but it is part of the keyword "job losses", so "increased" is the modifier.
  assert.deepEqual(pairs(score("Job losses increased.")), ["job losses|increas|-1"]);
  // A whole phrase of table A8 beats the single word it starts with.
  assert.deepEqual(pairs(score("Economic growth is increasing but remains constrained.")), ["econom|increasing but remains constrained|-1"]);
});

test("uninformative sentences leave the topics and the word count, but policy rules still apply to them", () => {
  const only = score("The Committee will monitor developments and will act as needed.");
  assert.match(only.error, /No sentence is left to score/);
  const r = score("Inflation rose. The Committee will monitor developments and will act as needed.");
  assert.equal(r.words, 2);
  assert.equal(r.sums.inflation, 1);
  assert.equal(r.sums.policy, -1);
  close(r.total, 0);
  const up = score("The Committee judges that some further gradual increases in the target range will be appropriate.");
  assert.equal(up.sums.policy, 1);
  close(up.total, 1 / Math.sqrt(up.words));
});

test("hostile and odd input", () => {
  assert.match(score("").error, /empty/);
  assert.match(score("   \n ").error, /empty/);
  assert.match(score(null).error, /Paste/);
  assert.match(score("x".repeat(MAX_CHARS + 1)).error, /200,001 characters/);
  // A ligature from a PDF still reads as "financial".
  assert.deepEqual(pairs(score("Conditions in ﬁnancial markets are tight.")), ["financial|tight|-1"]);
  // Markup is only text, a 300-letter word is one word, and nothing is matched in either.
  const odd = score(`<script>alert(1)</script> ${"a".repeat(300)} <b>inflation</b> rose`);
  assert.ok(!odd.error);
  assert.deepEqual(pairs(odd), ["inflation|rose|1"]);
  // The largest text allowed is scored quickly.
  const big = past.find((p) => p.date === "2008-12-16").text;
  const t0 = performance.now();
  const r = score(big.repeat(Math.floor(MAX_CHARS / (big.length + 1))));
  assert.ok(!r.error && performance.now() - t0 < 3000, `took ${performance.now() - t0} ms`);
});

test("percentile, nearest and the verdict words, at their edges", () => {
  assert.equal(percentile([1, 2, 3, 4], 0), 0);
  assert.equal(percentile([1, 2, 3, 4], 5), 1);
  assert.equal(percentile([1, 2, 3, 4], 2), 0.375);
  assert.equal(percentile([2, 2], 2), 0.5);
  assert.ok(Number.isNaN(percentile([], 1)));
  assert.equal(verdict(0.8), "more hawkish than most");
  assert.equal(verdict(0.6), "middling");
  assert.equal(verdict(0.61), "on the hawkish side");
  assert.equal(verdict(0.4), "middling");
  assert.equal(verdict(0.39), "on the dovish side");
  assert.equal(verdict(0.2), "more dovish than most");
  assert.deepEqual(nearest([{ date: "a", total: 0 }, { date: "b", total: 1 }, { date: "c", total: 0.4 }], 0.5, 2).map((x) => x.date), ["c", "b"]);
});

test("the bundled statements against the Board's own pages", () => {
  assert.equal(past.length, 226);
  assert.equal(past[0].date, "2000-02-02");
  assert.equal(past.at(-1).date, "2026-09-16");
  assert.ok(past.every((p) => !p.error), "every statement scores");
  const dec = past.find((p) => p.date === "2008-12-16");
  assert.match(dec.text, /establish a target range for the federal funds rate of 0 to 1\/4 percent/);
  assert.equal(dec.target, 0.25);
  assert.equal(dec.change, -0.75);
  const jun = past.find((p) => p.date === "2022-06-15");
  assert.match(jun.text, /raise the target range for the federal funds rate to 1-1\/2 to 1-3\/4 percent/);
  assert.equal(jun.change, 0.75);
  const sep = past.find((p) => p.date === "2026-09-16");
  assert.match(sep.text, /by 1\/4 percentage point to 3-3\/4 to 4 percent/);
  assert.equal(sep.target, 4);
  assert.equal(past.filter((p) => p.change == null).length, 6);
  assert.equal(past.filter((p) => p.change).length, 75);
});

test("scores of three statements, worked through pair by pair", () => {
  const dec = past.find((p) => p.date === "2008-12-16");
  assert.deepEqual(dec.sums, { inflation: 1, labor: -1, output: -6, financial: -2, policy: -1 });
  assert.equal(dec.words, 366);
  close(dec.total, -9 / Math.sqrt(366));
  const jun = past.find((p) => p.date === "2022-06-15");
  assert.deepEqual(jun.sums, { inflation: 8, labor: 0, output: 1, financial: 0, policy: 0 });
  close(jun.total, 9 / Math.sqrt(jun.words));
  const sep = past.find((p) => p.date === "2026-09-16");
  assert.deepEqual(pairs(sep), ["econom|expand|1", "spending|uncertain|-1", "investment|strong|1", "unemployment|gains|-1", "inflation|elevat|1"]);
});

test("the finding: the score sorts raises from cuts on 2000 to 2026, much less well after the dictionary was built", () => {
  const all = track(past);
  assert.equal(all.n, 220);
  assert.deepEqual([all.raise.n, all.hold.n, all.cut.n], [41, 145, 34]);
  assert.equal(all.raise.mean.toFixed(2), "0.34");
  assert.equal(all.rows.filter((r) => r.change > 0 && r.score > 0).length, 40);
  assert.equal(all.rows.filter((r) => r.change < 0 && r.score < 0).length, 23);
  assert.equal(all.hold.mean.toFixed(2), "0.18");
  assert.equal(all.cut.mean.toFixed(2), "-0.08");
  assert.equal(all.moves, 75);
  assert.equal(all.agree, 63);
  const late = track(past, { from: "2021-01-01" });
  assert.equal(late.n, 46);
  assert.deepEqual([late.raise.n, late.hold.n, late.cut.n], [12, 28, 6]);
  assert.equal(late.raise.mean.toFixed(2), "0.36");
  assert.equal(late.hold.mean.toFixed(2), "0.31");
  assert.equal(late.cut.mean.toFixed(2), "0.27");
  assert.equal(late.agree, 12);
  assert.equal(late.rows.filter((r) => r.change < 0 && r.score < 0).length, 0, "no cut since 2021 scored below zero");
  // The emergency cut of 15 March 2020 reads as hawkish: the statement describes the economy before the pandemic.
  const mar = past.find((p) => p.date === "2020-03-15");
  assert.equal(mar.total.toFixed(2), "0.30");
  assert.equal(percentile(past.map((p) => p.total), mar.total).toFixed(2), "0.66");
  assert.equal(past.filter((p) => p.total < mar.total).length, 148, "the write-up: higher than 148 of the other 225");
  assert.ok(past.filter((p) => p.date >= "2024-01-01" && p.change < 0).every((p) => /remains somewhat elevated/.test(p.text)));
});

test("the nearest-modifier search agrees with trying every modifier, and hostile texts stay fast", async () => {
  const { nearestModifier } = await import("./logic.js");
  const { rng } = await import("../kit/kit.js");
  const r = rng(11);
  for (let trial = 0; trial < 300; trial++) {
    // Modifiers that do not overlap one another, in order, and a keyword anywhere.
    const mods = [];
    for (let i = 0; i < 40;) { const n = r.int(1, 3); if (r.bool(0.4)) mods.push({ i, n }); i += n + r.int(0, 2); }
    const k = { i: r.int(0, 45), n: r.int(1, 3) };
    let brute = null;
    for (const m of mods) {
      if (m.i < k.i + k.n && k.i < m.i + m.n) continue;
      const d = Math.abs(m.i - k.i);
      if (!brute || d < brute.d || (d === brute.d && m.i > brute.m.i)) brute = { m, d };
    }
    const fast = nearestModifier(mods, k);
    assert.deepEqual(fast && [fast.m.i, fast.d], brute && [brute.m.i, brute.d]);
  }
  for (const text of ["A. ".repeat(66000), "Inflation rose and spending fell; ".repeat(5800)]) {
    const t0 = performance.now();
    const out = score(text);
    assert.ok(!out.error && performance.now() - t0 < 1500, `took ${performance.now() - t0} ms`);
  }
});

test("the tables' patterns match as their regular expressions do, in linear time", async () => {
  const { pattern } = await import("./logic.js");
  const { rng } = await import("../kit/kit.js");
  const r = rng(5);
  const vocab = ["today's", "policy", "action", "will", "help", "sustain", "expansion", "sustained", "strengthen", "remain", "strong", "x", "employ", "all", "available", "tools"];
  const sources = [...POLICY_RULES.flatMap(([g]) => g), ...UNINFORMATIVE.flat()];
  for (let trial = 0; trial < 3000; trial++) {
    const f = Array.from({ length: r.int(0, 12) }, () => r.pick(vocab)).join(" ");
    for (const src of sources) assert.equal(pattern(src).test(f), new RegExp(src).test(f), `${src} on "${f}"`);
  }
  // Texts that made the regular expressions take seconds: the first piece repeated with no second piece.
  for (const unit of ["today's ", "sustain ", "expect gradual adjustments will "]) {
    const t0 = performance.now();
    const out = score(unit.repeat(Math.floor(MAX_CHARS / unit.length)));
    assert.ok(!out.error && performance.now() - t0 < 1000, `${unit}: took ${performance.now() - t0} ms`);
  }
});

test("invisible characters cannot split a word, and text that grows in Unicode form is refused", () => {
  assert.deepEqual(pairs(score("In­flation rose, and infla​tion‍ rose.")), ["inflation|rose|1", "inflation|rose|1"]);
  assert.match(score("ﷺ".repeat(20000)).error, /360,000 characters/);
  assert.ok(score("ﷺ".repeat(20000)).tooLong);
  assert.ok(score("x".repeat(MAX_CHARS + 1)).tooLong);
  assert.ok(!score("").tooLong);
});
