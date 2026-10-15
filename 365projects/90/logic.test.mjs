import test from "node:test";
import assert from "node:assert/strict";
import { NSW } from "./data.js";
import {
  LIMITS, decodeBytes, splitLine, guard, unguard, csvCell, parseBallots, ballotsToCSV, interpret, runCount, DEFAULT_RULES,
  compareWithPublished, contestBallots, resultsToCSV, simulate, remapPublished,
} from "./logic.js";

const rules = (over = {}) => ({ ...DEFAULT_RULES, ...over });
const ok = (text) => { const r = parseBallots(text); assert.ok(!r.errors, r.errors?.join(" ")); return r; };
const errorOf = (text) => parseBallots(text).errors.join(" ");

/* ---------- a worked example with every kind of irregular ballot ---------- */

const WORKED = `count,rank1,rank2,rank3
8,Alice,Bob,Carol
5,Bob,Carol,
4,Carol,,Bob
3,Dan,Alice|Carol,Bob
2,Dan,Dan,Carol
1,Alice|Bob,Carol,`;

test("interpreting ballots: skipped rankings, overvotes and repeated names under each rule", () => {
  const p = ok(WORKED);
  assert.deepEqual(p.candidates, ["Alice", "Bob", "Carol", "Dan"]);
  assert.equal(p.total, 23);
  const [, , skip, over, dup, firstOver] = p.ballots.map((b) => b.ranks);
  assert.deepEqual(interpret(skip, rules()).seq, [2, 1]);
  assert.deepEqual(interpret(skip, rules({ skips: "one" })), { seq: [2], stop: "skips", overvote: false, skipped: true, duplicate: false });
  assert.deepEqual(interpret([[0], [], [], [1]], rules({ skips: "two" })).seq, [0]);
  assert.deepEqual(interpret([[0], [], [1]], rules({ skips: "two" })).seq, [0, 1]);
  assert.deepEqual(interpret(over, rules()), { seq: [3], stop: "overvote", overvote: true, skipped: false, duplicate: false });
  assert.deepEqual(interpret(over, rules({ overvote: "skip" })).seq, [3, 1]);
  assert.deepEqual(interpret(dup, rules()).seq, [3, 2]);
  assert.equal(interpret(dup, rules()).duplicate, true);
  assert.deepEqual(interpret(firstOver, rules()).seq, []);
  assert.deepEqual(interpret(firstOver, rules({ overvote: "skip" })).seq, [2]);
});

test("the worked example counted by hand: Bob wins in round 3, with 5 ballots exhausted", () => {
  const p = ok(WORKED);
  const r = runCount(p.candidates, p.ballots, rules());
  // One ballot has an overvote at its first ranking, so it never counts.
  assert.equal(r.summary.noFirst, 1);
  assert.equal(r.summary.counted, 22);
  // Round 1: Alice 8, Bob 5, Carol 4, Dan 3 + 2. Carol is out; her 4 ballots skip the blank and go to Bob.
  assert.deepEqual(r.rounds[0].tally, [8, 5, 4, 5]);
  assert.equal(r.rounds[0].eliminated, 2);
  assert.deepEqual(r.rounds[0].transfers.to, [0, 4, 0, 0]);
  // Round 2: Alice 8, Bob 9, Dan 5. Dan is out: 3 ballots stop at their overvote, 2 run out (their next name, Carol, is out).
  assert.deepEqual(r.rounds[1].tally, [8, 9, null, 5]);
  assert.equal(r.rounds[1].eliminated, 3);
  assert.deepEqual(r.rounds[1].transfers.exhausted, { list: 2, overvote: 3, skips: 0 });
  // Round 3: Bob 9 of 17 still counting, a majority.
  assert.deepEqual(r.rounds[2].tally, [8, 9, null, null]);
  assert.equal(r.rounds[2].continuing, 17);
  assert.equal(r.rounds[2].exhausted, 5);
  assert.equal(r.rounds[2].majority, 9);
  assert.equal(r.winner, 1);
  assert.equal(r.majorityRound, 3);
  assert.equal(r.rounds.length, 3);
  // If one blank stops a ballot, Carol's 4 ballots are exhausted instead, and Bob and Dan tie on 5 in round 2.
  const strict = runCount(p.candidates, p.ballots, rules({ skips: "one" }));
  assert.deepEqual(strict.rounds[0].transfers.exhausted, { list: 0, overvote: 0, skips: 4 });
  assert.deepEqual(strict.rounds[1].tally, [8, 5, null, 5]);
  assert.deepEqual(strict.rounds[1].tie.tied, [1, 3]);
  assert.equal(strict.rounds[1].tie.by, "lot"); // they were level in round 1 as well
});

test("stopping at a majority or counting on to two: the same winner, fewer rounds", () => {
  // A has a majority in round 1 (6 of 11), but four candidates remain.
  const p = ok("count,r1,r2\n6,A,B\n2,B,C\n2,C,D\n1,D,B");
  const short = runCount(p.candidates, p.ballots, rules({ untilTwo: false }));
  const long = runCount(p.candidates, p.ballots, rules({ untilTwo: true }));
  assert.equal(short.rounds.length, 1);
  assert.equal(long.rounds.length, 3);
  assert.equal(short.winner, 0);
  assert.equal(long.winner, 0);
  assert.equal(long.majorityRound, 1);
});

test("tie rules: backward and forward look at different earlier rounds", () => {
  // Round 1: R 15, P 6, Q 5, T 5, S 2. S goes (2 to Q). Round 2: R 15, P 6, Q 7, T 5. T goes (3 to P, 2 to Q).
  // Round 3: P and Q both have 9. Backward: in round 2 P had fewer (6 to 7), so P goes. Forward: in round 1 Q had fewer (5 to 6).
  const text = "count,r1,r2\n15,R,\n6,P,\n5,Q,\n3,T,P\n2,T,Q\n2,S,Q";
  const p = ok(text);
  const P = p.candidates.indexOf("P"), Q = p.candidates.indexOf("Q");
  const back = runCount(p.candidates, p.ballots, rules({ tie: "backward" }));
  assert.deepEqual(back.rounds[2].tie.tied.sort(), [P, Q].sort());
  assert.equal(back.rounds[2].eliminated, P);
  assert.equal(back.rounds[2].tie.round, 2);
  const fwd = runCount(p.candidates, p.ballots, rules({ tie: "forward" }));
  assert.equal(fwd.rounds[2].eliminated, Q);
  assert.equal(fwd.rounds[2].tie.round, 1);
  // By lot: the seed decides, the same seed always decides the same way, and different seeds can go either way.
  const outs = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const a = runCount(p.candidates, p.ballots, rules({ tie: "lot", seed }));
    const b = runCount(p.candidates, p.ballots, rules({ tie: "lot", seed }));
    assert.equal(a.rounds[2].eliminated, b.rounds[2].eliminated);
    assert.equal(a.rounds[2].tie.by, "lot");
    outs.add(a.rounds[2].eliminated);
  }
  assert.deepEqual([...outs].sort(), [P, Q].sort());
});

test("edges: one candidate, two level candidates, and nothing left to count", () => {
  const one = ok("count,r1\n3,Solo");
  const r1 = runCount(one.candidates, one.ballots, rules());
  assert.equal(r1.winner, 0);
  assert.equal(r1.rounds.length, 1);
  const two = ok("count,r1\n4,A\n4,B");
  const r2 = runCount(two.candidates, two.ballots, rules({ seed: 3 }));
  assert.equal(r2.decidedByTie, true);
  assert.ok(r2.winner === 0 || r2.winner === 1);
  assert.equal(r2.rounds[0].tie.by, "lot");
  // A and B never come first; they go out with no votes, and C wins.
  const ghost = ok("count,r1,r2\n5,C,A\n2,D,B");
  const r3 = runCount(ghost.candidates, ghost.ballots, rules());
  assert.equal(ghost.candidates[r3.winner], "C");
});

/* ---------- reading CSV ---------- */

test("CSV: separators, quotes, a byte-order mark, count columns, id columns and the words for blanks and overvotes", () => {
  const tab = ok("﻿id\tcount\tchoice 1\tchoice 2\n1\t3\tAnn\tBo\n2\t1\tBo\tundervote");
  assert.deepEqual(tab.candidates, ["Ann", "Bo"]);
  assert.equal(tab.total, 4);
  assert.equal(tab.rankColumns, 2);
  const semi = ok('rank1;rank2\n"Smith; Jo";Lee\nLee;overvote');
  assert.deepEqual(semi.candidates, ["Smith; Jo", "Lee"]);
  assert.deepEqual(semi.ballots[1].ranks, [[1], [-1]]);
  // Without a count column every row is one ballot, and identical rows are grouped.
  const rows = ok("rank1,rank2\nA,B\nA,B\nB,A");
  assert.equal(rows.ballots.length, 2);
  assert.equal(rows.ballots[0].count, 2);
  assert.deepEqual(splitLine('a,"b ""c""",d', ","), ["a", 'b "c"', "d"]);
  assert.equal(splitLine('a,"b', ","), null);
  // A count written with a thousands separator, in quotes.
  assert.equal(ok('count,rank1\n"1,234",A').total, 1234);
});

test("CSV errors say what is wrong and where", () => {
  assert.match(errorOf(""), /no ballots yet/);
  assert.match(errorOf("count,r1\nx,A"), /Row 2: the count "x" must be a whole number/);
  assert.match(errorOf("count,r1\n-3,A"), /must be a whole number/);
  assert.match(errorOf("count,r1\n2000000000,A"), /from 0 to 1,000,000,000/);
  assert.match(errorOf("count,r1\n1,A,B"), /Row 2 has 3 cells but the first line names 2 columns/);
  assert.match(errorOf('count,r1\n1,"A'), /quoted cell never closes/);
  assert.match(errorOf(`count,r1\n1,${"x".repeat(61)}`), /61 characters long; names can be at most 60/);
  assert.match(errorOf("count\n4"), /at least one ranking column/);
  assert.match(errorOf("count,r1"), /no ballots under them/);
  assert.match(errorOf("count,r1\n0,A"), /Every count is zero/);
  assert.match(errorOf("count,r1,r2\n3,,"), /No ballot names a candidate/);
  assert.match(errorOf("a\u0000b"), /binary file/);
  const many = "r1\n" + Array.from({ length: 41 }, (_, i) => `C${i}`).join("\n");
  assert.match(errorOf(many), /would be candidate 41; the limit is 40/);
  const wide = Array.from({ length: 41 }, (_, i) => `r${i}`).join(",") + "\nA";
  assert.match(errorOf(wide), /41 ranking columns; the limit is 40/);
  assert.match(errorOf("Alice,Bob\nx,1,2"), /read as column names/);
  // A file with no header row loses its first ballot to the column names; the reader says so even when nothing else is wrong.
  assert.match(ok("Alice,Bob\nBob,Alice").warnings.join(" "), /"Alice,Bob", is read as column names, not as a ballot/);
  assert.equal(ok("first,second\nBob,Alice").warnings.length, 0);
  assert.match(errorOf("count,r1\n,A"), /Row 2: the count is empty/);
  const w = ok("r1\nalice\nAlice ").warnings.join(" ");
  assert.match(w, /differ only in capitals or spacing/);
  assert.match(ok("r1,r2,r3\nA,B").warnings.join(" "), /fewer cells than there are columns/);
});

test("files in other encodings are read correctly", () => {
  const latin = Uint8Array.from([0x72, 0x31, 0x0a, 0x4a, 0x6f, 0x73, 0xe9]); // "r1\nJos" + e-acute in Windows-1252
  assert.deepEqual(decodeBytes(latin), { text: "r1\nJosé", encoding: "windows-1252" });
  const utf16 = Uint8Array.from([0xff, 0xfe, 0x72, 0, 0x31, 0, 0x0a, 0, 0x41, 0]);
  assert.equal(decodeBytes(utf16).text, "r1\nA");
  assert.equal(decodeBytes(new TextEncoder().encode("r1\nZoë")).encoding, "utf-8");
});

test("export is safe from spreadsheet formulas, and a ballot file survives the round trip", () => {
  assert.equal(guard("=SUM(A1:A9)"), "'=SUM(A1:A9)");
  assert.equal(guard("+44 party"), "'+44 party");
  assert.equal(guard("@home"), "'@home");
  assert.equal(guard("-x"), "'-x");
  assert.equal(guard("'=already"), "''=already");
  assert.equal(guard("Plain"), "Plain");
  assert.equal(unguard("'=SUM(A1:A9)"), "=SUM(A1:A9)");
  assert.equal(unguard("''=already"), "'=already");
  assert.equal(unguard("'Plain"), "'Plain");
  // Any run of apostrophes before a formula character survives the round trip.
  for (const name of ["=x", "'=x", "''=x", "'''-1", "'", "''", "'abc", "a=b"]) assert.equal(unguard(guard(name)), name, name);
  assert.equal(guard("''=x"), "'''=x");
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell(12), "12");
  const p = ok('count,rank1,rank2,rank3\n3,=cmd|x,"Lee, Jo",\n2,"Lee, Jo",,+1 party\n1,overvote,Lee,');
  const text = ballotsToCSV(p.candidates, p.ballots);
  assert.ok(!/^[=+\-@]|,[=+\-@]/m.test(text), text);
  const back = ok(text);
  assert.deepEqual(back.candidates, p.candidates);
  assert.deepEqual(back.ballots, p.ballots);
  const res = resultsToCSV(runCount(p.candidates, p.ballots, rules()));
  assert.ok(!/(^|,)[=+\-@]/m.test(res.replace(/,-\d/g, ",0")), res);
  assert.match(res, /^round,candidate,votes,change,status/);
});

/* ---------- the real count ---------- */

const RULES_NSW = rules({ untilTwo: true, tie: "backward" });

test("Wollondilly, NSW 2023: the engine reproduces every published count", () => {
  const c = NSW.contests.find((x) => x.id === "wollondilly");
  const { candidates, ballots } = contestBallots(c);
  const r = runCount(candidates, ballots, RULES_NSW);
  assert.deepEqual(compareWithPublished(r, c.published), []);
  // The Commission's own figures (distribution of preferences, Wollondilly): 52,369 formal and 1,698 informal papers;
  // first preferences SMITH 17,712, HANNAN 13,586; at the last count HANNAN 21,588, SMITH 20,312, exhausted 10,469.
  assert.equal(c.formal, 52369);
  assert.equal(c.informal, 1698);
  const H = candidates.findIndex((n) => n.startsWith("HANNAN")), S = candidates.findIndex((n) => n.startsWith("SMITH"));
  assert.equal(r.rounds[0].tally[S], 17712);
  assert.equal(r.rounds[0].tally[H], 13586);
  assert.equal(r.rounds.at(-1).tally[H], 21588);
  assert.equal(r.rounds.at(-1).tally[S], 20312);
  assert.equal(r.rounds.at(-1).exhausted, 10469);
  assert.equal(r.rounds.length, 5);
  assert.equal(r.winner, H);
  // The finding: exhausted ballots are 20.0% of the formal vote; 55.8% of ballots mark one candidate only.
  assert.equal(((10469 / 52369) * 100).toFixed(1), "20.0");
  const oneOnly = c.ballots.filter(([s]) => s.length === 1).reduce((t, [, n]) => t + n, 0);
  assert.equal(oneOnly, 29242);
  assert.equal(((oneOnly / c.formal) * 100).toFixed(1), "55.8");
  // Of the 10,469 ballots exhausted by the last count (none ranks Hannan or Smith), 9,816 number a single square.
  const finalists = [H, S].map((i) => String.fromCharCode(65 + i));
  const exhaustedOne = c.ballots.filter(([seq]) => ![...seq].some((ch) => finalists.includes(ch)));
  assert.equal(exhaustedOne.reduce((t, [, n]) => t + n, 0), 10469);
  assert.equal(exhaustedOne.filter(([seq]) => seq.length === 1).reduce((t, [, n]) => t + n, 0), 9816);
  assert.equal(17712 - 13586, 4126);
});

test("Penrith, NSW 2023: the engine reproduces every published count, and the first-preference leader loses", () => {
  const c = NSW.contests.find((x) => x.id === "penrith");
  const { candidates, ballots } = contestBallots(c);
  const r = runCount(candidates, ballots, RULES_NSW);
  assert.deepEqual(compareWithPublished(r, c.published), []);
  // Published: AYRES 19,266 and McKEOWN 19,262 first preferences; at count 6 McKEOWN 22,661, AYRES 21,226, exhausted 6,457.
  const A = candidates.findIndex((n) => n.startsWith("AYRES")), M = candidates.findIndex((n) => n.startsWith("McKEOWN"));
  assert.equal(r.rounds[0].tally[A] - r.rounds[0].tally[M], 4);
  assert.equal(r.rounds.at(-1).tally[M], 22661);
  assert.equal(r.rounds.at(-1).tally[A], 21226);
  assert.equal(r.rounds.at(-1).exhausted, 6457);
  assert.equal(r.winner, M);
  // Stopping at the first majority changes nothing here: the majority comes only with the final two.
  assert.equal(runCount(candidates, ballots, rules({ untilTwo: false })).rounds.length, 6);
});

test("the real ballots survive a trip through CSV, and the count still matches once candidates are matched by name", () => {
  for (const c of NSW.contests) {
    const { candidates, ballots } = contestBallots(c);
    const back = parseBallots(ballotsToCSV(candidates, ballots));
    assert.equal(back.total, c.formal);
    const r = runCount(back.candidates, back.ballots, RULES_NSW);
    assert.deepEqual(compareWithPublished(r, remapPublished(c.published, candidates, back.candidates)), [], c.name);
  }
  assert.equal(remapPublished(NSW.contests[0].published, ["a"], ["b"]), null);
});

test("the comparison notices a wrong count", () => {
  const c = NSW.contests.find((x) => x.id === "wollondilly");
  const { candidates, ballots } = contestBallots(c);
  const r = runCount(candidates, ballots.slice(1), RULES_NSW);
  assert.ok(compareWithPublished(r, c.published).length > 0);
});

/* ---------- simulated electorates ---------- */

test("simulated electorates are reproducible, count every voter and include the irregular ballots asked for", () => {
  const a = simulate({ n: 5, voters: 5000, seed: 4, justOne: 0.4, skipRate: 0.05, overRate: 0.05 });
  assert.deepEqual(a, simulate({ n: 5, voters: 5000, seed: 4, justOne: 0.4, skipRate: 0.05, overRate: 0.05 }));
  assert.equal(a.ballots.reduce((s, b) => s + b.count, 0), 5000);
  const r = runCount(a.candidates, a.ballots, rules());
  assert.ok(r.summary.overvote > 100 && r.summary.skipped > 100);
  assert.ok(r.winner >= 0);
  const one = simulate({ n: 4, voters: 2000, seed: 1, justOne: 1, skipRate: 0, overRate: 0 });
  assert.ok(one.ballots.every((b) => b.ranks.length === 1));
  // Exported and read back, a simulated electorate gives the same count.
  const back = parseBallots(ballotsToCSV(a.candidates, a.ballots));
  assert.equal(back.candidates[runCount(back.candidates, back.ballots, rules()).winner], a.candidates[r.winner]);
  assert.equal(LIMITS.candidates, 40);
});
