import test from "node:test";
import assert from "node:assert/strict";
import {
  LETTERS, LIMITS, parseProfile, formatProfile, resizeTypes, firstPreferences, pairwise, plurality, twoRound, instantRunoff,
  approval, borda, condorcetWinner, copeland, schulze, runAll, agreement, generate, createTally, GUILBAUD, METHODS, insincere, insincereSearch, winnersOf,
} from "./logic.js";

const P = (text, n) => { const r = parseProfile(text, n); assert.ok(!r.errors, r.errors?.join(" ")); return r.types; };
const A = 0, B = 1, C = 2, D = 3;

/* ---------- textbook profiles, worked by hand ---------- */

// Pacuit, "Voting Methods", Stanford Encyclopedia of Philosophy, section 1: 21 voters, four candidates.
const PACUIT = `3: A > B | C > D
5: A > C | B > D
7: B | D > C > A
6: C > B | D > A`;

test("Pacuit's 21 voters: plurality A, Borda and the runoffs B, the Condorcet winner C", () => {
  const t = P(PACUIT, 4);
  const r = runAll(t, 4);
  assert.equal(r.total, 21);
  assert.deepEqual(r.plurality.tally, [8, 7, 6, 0]);
  assert.deepEqual(r.plurality.winners, [A]);
  // B against A in the runoff: 7 + 6 rank B higher, 3 + 5 rank A higher.
  assert.deepEqual(r.twoRound.pairs.map((p) => [p.a, p.b, p.va, p.vb]), [[A, B, 8, 13]]);
  assert.deepEqual(r.twoRound.winners, [B]);
  // Instant runoff: D (no first preferences) goes, then C, whose 6 voters move to B: 13 of 21.
  assert.deepEqual(r.irv.rounds.map((x) => x.eliminated), [D, C, null]);
  assert.deepEqual(r.irv.rounds[2].tally, [8, 13, 0, 0]);
  assert.deepEqual(r.irv.winners, [B]);
  // Borda with 3, 2, 1, 0 points: A 24, B 44, C 38, D 20.
  assert.deepEqual(r.borda.tally, [24, 44, 38, 20]);
  assert.deepEqual(r.borda.winners, [B]);
  // Head to head (the encyclopedia's tables): C beats A 13-8, B 11-10 and D 14-7; B beats A 13-8 and D 21-0; D beats A 13-8.
  assert.deepEqual(r.pairwise, [[0, 8, 8, 8], [13, 0, 10, 21], [13, 11, 0, 14], [13, 0, 7, 0]]);
  assert.equal(r.condorcet, C);
  assert.deepEqual(r.copeland.score, [-3, 1, 3, -1]);
  assert.deepEqual(r.copeland.winners, [C]);
  assert.deepEqual(r.schulze.winners, [C]);
  // Approval with the lines as written: A 8, B 16, C 11, D 0.
  assert.deepEqual(r.approval.tally, [8, 16, 11, 0]);
  assert.deepEqual(agreement(r).map((g) => g.winners), [[A], [B], [C]]);
});

// Pacuit, the same entry, section 2: two-round runoff and instant runoff disagree with four candidates.
const RUNOFF = `7: A | B > C > D
5: B > C | D > A
4: D > B | C > A
3: C > D | A > B`;

test("runoff against instant runoff: A wins two rounds, D wins instant runoff (Pacuit's second example)", () => {
  const t = P(RUNOFF, 4);
  const r = runAll(t, 4);
  assert.deepEqual(r.plurality.tally, [7, 5, 3, 4]);
  assert.deepEqual(r.twoRound.pairs.map((p) => [p.a, p.b, p.va, p.vb]), [[A, B, 10, 9]]);
  assert.deepEqual(r.twoRound.winners, [A]);
  // C goes first (3), then B (5): D ends with 12 of 19.
  assert.deepEqual(r.irv.rounds.map((x) => x.eliminated), [C, B, null]);
  assert.deepEqual(r.irv.rounds[1].tally, [7, 5, 0, 7]);
  assert.deepEqual(r.irv.rounds[2].tally, [7, 0, 0, 12]);
  assert.deepEqual(r.irv.winners, [D]);
  assert.deepEqual(r.borda.tally, [24, 37, 30, 23]);
  // No Condorcet winner: A beats B 10-9, C beats A 12-7, D beats A 12-7, B beats C 16-3 and D 12-7, C beats D 15-4.
  assert.equal(r.condorcet, null);
  assert.deepEqual(r.pairwise, [[0, 10, 7, 7], [9, 0, 16, 12], [12, 3, 0, 15], [12, 7, 4, 0]]);
  assert.deepEqual(r.copeland.score, [-1, 1, 1, -1]);
  assert.deepEqual(r.copeland.winners, [B, C]);
  // Schulze strongest paths, by hand: B to A 12 (via C or D) against A to B 10; B to C 16 against 10; B to D 15 against 10.
  assert.equal(r.schulze.paths[B][A], 12); assert.equal(r.schulze.paths[A][B], 10);
  assert.equal(r.schulze.paths[B][D], 15); assert.equal(r.schulze.paths[D][B], 10);
  assert.equal(r.schulze.paths[C][B], 10);
  assert.deepEqual(r.schulze.winners, [B]);
  assert.deepEqual(r.approval.tally, [7, 9, 8, 7]);
});

test("Borda against Condorcet: three voters A > B > C and two B > C > A", () => {
  const t = P("3: A | B > C\n2: B > C | A", 3);
  const r = runAll(t, 3);
  assert.equal(r.condorcet, A);
  assert.deepEqual(r.borda.tally, [6, 7, 2]);
  assert.deepEqual(r.borda.winners, [B]);
  assert.deepEqual(r.twoRound.majority, A);
  assert.deepEqual(r.irv.winners, [A]);
  assert.equal(r.irv.rounds.length, 1);
  assert.deepEqual(r.schulze.winners, [A]);
  assert.deepEqual(r.copeland.winners, [A]);
  assert.deepEqual(r.approval.tally, [3, 2, 2]);
});

test("Condorcet's paradox: a majority cycle, and every method that respects the symmetry calls a three-way tie", () => {
  const t = P("10: A | B > C\n10: B | C > A\n10: C | A > B", 3);
  const r = runAll(t, 3);
  const d = r.pairwise;
  assert.ok(d[A][B] > d[B][A] && d[B][C] > d[C][B] && d[C][A] > d[A][C]);
  assert.equal(r.condorcet, null);
  for (const m of METHODS) assert.deepEqual(r[m.key].winners, [A, B, C], m.key);
  // Instant runoff: any of the three could go first, and each path elects someone else.
  assert.deepEqual(r.irv.rounds[0].tie.map((x) => [x.candidate, x.leadsTo]), [[A, [B]], [B, [C]], [C, [A]]]);
});

test("a cycle with unequal groups: Schulze breaks it by the strongest path, Copeland cannot", () => {
  // 10 A>B>C, 9 B>C>A, 8 C>A>B: A beats B 18-9, B beats C 19-8, C beats A 17-10.
  const r = runAll(P("10: A > B > C\n9: B > C > A\n8: C > A > B", 3), 3);
  assert.deepEqual(r.pairwise, [[0, 18, 10], [9, 0, 19], [17, 8, 0]]);
  assert.equal(r.condorcet, null);
  assert.deepEqual(r.copeland.winners, [A, B, C]);
  // Paths: A to C through B is min(18, 19) = 18, against C to A 17; A to B 18 against B to A min(19, 17) = 17.
  assert.equal(r.schulze.paths[A][C], 18);
  assert.equal(r.schulze.paths[B][A], 17);
  assert.deepEqual(r.schulze.winners, [A]);
  // Borda: A 20 + 8 = 28, B 10 + 18 = 28, C 9 + 16 = 25: a tie.
  assert.deepEqual(r.borda.tally, [28, 28, 25]);
  assert.deepEqual(r.borda.winners, [A, B]);
  assert.deepEqual(r.irv.winners, [A]);
});

test("the centre squeeze: plurality A, the runoffs C, the Condorcet winner B", () => {
  const r = runAll(P("35: A | B > C\n33: C | B > A\n32: B | C > A", 3), 3);
  assert.deepEqual(r.plurality.winners, [A]);
  assert.deepEqual(r.twoRound.pairs.map((p) => [p.a, p.b, p.va, p.vb]), [[A, C, 35, 65]]);
  assert.deepEqual(r.twoRound.winners, [C]);
  assert.deepEqual(r.irv.winners, [C]);
  assert.equal(r.condorcet, B);
  assert.deepEqual(r.borda.tally, [70, 132, 98]);
  assert.deepEqual(r.approval.winners, [A]);
  // With three candidates instant runoff and the two-round runoff always agree on these profiles.
  assert.deepEqual(r.irv.winners, r.twoRound.winners);
});

/* ---------- ties and edges ---------- */

test("ties: a tie for second place sends both possible pairs to the runoff", () => {
  // A 4, B 3, C 3 of 10: no majority; B and C tie for second. A beats B 4+3 = 7 to 3; C beats A 3+3 = 6 to 4.
  const r = twoRound(P("4: A > B > C\n3: B > C > A\n3: C > B > A", 3), 3);
  assert.deepEqual(r.pairs.map((p) => [p.a, p.b, p.winners]), [[A, B, [B]], [A, C, [C]]]);
  assert.deepEqual(r.winners, [B, C]);
});

test("a single voter: everything picks their first choice, except approval, which ties their approved candidates", () => {
  const r = runAll(P("1: B > A | C", 3), 3);
  for (const m of METHODS) assert.deepEqual(r[m.key].winners, m.key === "approval" ? [A, B] : [B], m.key);
  assert.equal(r.condorcet, B);
});

test("an even split between two candidates is a tie, and the head-to-head is a tie too", () => {
  const r = runAll(P("5: A > B > C\n5: B > A > C", 3), 3);
  assert.deepEqual(r.plurality.winners, [A, B]);
  assert.deepEqual(r.irv.winners, [A, B]);
  assert.equal(r.condorcet, null);
  assert.deepEqual(r.copeland.winners, [A, B]);
  assert.deepEqual(r.schulze.winners, [A, B]);
});

test("instant runoff follows a tie for last place both ways", () => {
  // B and C tie on 3; eliminating B gives A 4 + 3 = 7 (B's voters rank A next); eliminating C gives B 3 + 3 = 6 of 10.
  const r = instantRunoff(P("4: A > B > C\n3: B > A > C\n3: C > B > A", 3), 3);
  assert.deepEqual(r.rounds[0].tie.map((x) => [x.candidate, x.leadsTo]), [[B, [A]], [C, [B]]]);
  assert.deepEqual(r.winners, [A, B]);
});

/* ---------- reading and writing profiles ---------- */

test("profile text: counts, letters, the approval line and every error message", () => {
  const ok = parseProfile("# a comment\n\n12: a > b | c\n3 C,B,A\n0: B > A > C", 3);
  assert.deepEqual(ok.types.map((t) => [t.count, t.ranking, t.approve]), [[12, [A, B, C], 2], [3, [C, B, A], 1]]);
  assert.equal(ok.total, 15);
  assert.match(ok.notes[0], /no approval line/);
  const err = (text, n = 3) => parseProfile(text, n).errors.join(" ");
  assert.match(err("12: A > B > D"), /"D" is not a candidate. With 3 candidates use the letters A to C/);
  assert.match(err("12: A > A > B"), /A appears twice/);
  assert.match(err("12: A > B"), /C is missing/);
  assert.match(err("2.5: A > B > C"), /must be a whole number/);
  assert.match(err("-4: A > B > C"), /must be a whole number/);
  assert.match(err("12: A | B | C"), /once at most/);
  assert.match(err("12:"), /no ranking/);
  assert.match(err("A > B > C"), /must be a whole number|count, a colon/);
  assert.match(err("0: A > B > C"), /Every count is zero/);
  assert.match(err(""), /no profile yet/);
  assert.match(err("x".repeat(LIMITS.text + 1)), /longer than the limit of 200,000 characters/);
  assert.match(err("99999999: A > B > C"), /from 0 to 10,000,000/);
  assert.match(err(Array(LIMITS.lines + 1).fill("1: A > B > C").join("\n")), /More than 4,000 ballot lines/);
  assert.match(err(Array(11).fill("10000000: A > B > C").join("\n")), /limit is 100,000,000/);
  assert.equal(parseProfile("1: | A > B > C", 3).types[0].approve, 0);
  assert.equal(parseProfile("1: A > B > C |", 3).types[0].approve, 3);
});

test("profiles survive a round trip through text, and changing the number of candidates keeps every voter", () => {
  const t = P(PACUIT, 4);
  assert.deepEqual(P(formatProfile(t), 4), t.map((x) => ({ ...x, line: x.line })));
  assert.equal(formatProfile([{ ranking: [0, 1, 2], count: 2, approve: 0 }]), "2: | A > B > C");
  assert.equal(formatProfile([{ ranking: [0, 1, 2], count: 2, approve: 3 }]), "2: A > B > C |");
  const five = resizeTypes(t, 4, 5);
  assert.deepEqual(five[0].ranking, [A, B, C, D, 4]);
  assert.equal(five.reduce((s, x) => s + x.count, 0), 21);
  const three = resizeTypes(t, 4, 3);
  assert.equal(three.reduce((s, x) => s + x.count, 0), 21);
  assert.ok(three.every((x) => x.ranking.length === 3 && x.approve >= 1));
  assert.deepEqual(P(formatProfile(three), 3).map((x) => x.count).reduce((a, b) => a + b, 0), 21);
});

/* ---------- theory ---------- */

test("Condorcet's paradox by exact count: 3 voters, 3 candidates, 216 profiles, a Condorcet winner in 17/18 of them", () => {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  let withWinner = 0, all = 0;
  for (const a of perms) for (const b of perms) for (const c of perms) {
    const types = [a, b, c].map((ranking) => ({ ranking, count: 1, approve: 1 }));
    all++;
    if (condorcetWinner(types, 3) !== null) withWinner++;
  }
  assert.equal(all, 216);
  assert.equal(withWinner, 204);
  assert.equal(withWinner / all, 17 / 18);
});

test("impartial culture with many voters: the chance of a Condorcet winner approaches Guilbaud's 91.2%", () => {
  close(GUILBAUD, 0.912260, 1e-6);
  const tally = createTally();
  for (let e = 0; e < 4000; e++) tally.add(runAll(generate({ n: 3, voters: 1001, model: "ic", seed: 1 + e }).types, 3));
  const s = tally.summary;
  // 4,000 elections: a standard error of 0.45 points, so four standard errors is 1.8.
  assert.ok(Math.abs(s.withCondorcet / s.elections - GUILBAUD) < 0.018, `share ${s.withCondorcet / s.elections}`);
  // Copeland and Schulze always pick the Condorcet winner when there is one.
  assert.equal(s.picksCondorcet.copeland, s.withCondorcet);
  assert.equal(s.picksCondorcet.schulze, s.withCondorcet);
  assert.ok(s.picksCondorcet.plurality < s.withCondorcet);
});

test("voters on a line have single-peaked preferences, so there is always a Condorcet winner (Black's median voter)", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const { types } = generate({ n: 5, voters: 201, model: "line", seed });
    assert.notEqual(condorcetWinner(types, 5), null, `seed ${seed}`);
  }
});

test("the generator is reproducible and counts every voter", () => {
  const a = generate({ n: 4, voters: 500, model: "ic", seed: 9 }), b = generate({ n: 4, voters: 500, model: "ic", seed: 9 });
  assert.deepEqual(a, b);
  assert.equal(a.types.reduce((s, t) => s + t.count, 0), 500);
  assert.ok(a.types.every((t) => t.approve >= 1 && t.approve < 4));
  assert.ok(a.types.every((t, i) => i === 0 || a.types[i - 1].count >= t.count));
});

test("helpers: first preferences among survivors, and pairwise counts", () => {
  const t = P("2: A > B > C\n1: C > B > A", 3);
  assert.deepEqual(firstPreferences(t, 3, [B, C]), [0, 2, 1]);
  assert.deepEqual(pairwise(t, 3), [[0, 2, 2], [1, 0, 2], [1, 1, 0]]);
  assert.deepEqual(plurality(t, 3).winners, [A]);
  assert.deepEqual(approval(t, 3).tally, [2, 0, 1]);
  assert.deepEqual(borda(t, 3).tally, [4, 3, 2]);
  assert.deepEqual(copeland(t, 3).score, [2, 0, -2]);
  assert.deepEqual(schulze(t, 3).winners, [A]);
  assert.equal(LETTERS.length, LIMITS.maxCandidates);
});

test("insincere ballots: burying a rival under Borda, deserting a hopeless favourite under plurality", () => {
  const t = P("3: A | B > C\n2: B > C | A", 3);
  // Borda elects B. If the three A > B > C voters rank B last, Borda gives A 6, C 5, B 4: A wins.
  const b = insincere(t, 3, "borda");
  assert.deepEqual(b.before, [B]);
  assert.deepEqual(b.found[0].ballot.ranking, [A, C, B]);
  assert.deepEqual(b.found[0].after, [A]);
  assert.equal(b.found[1], null);
  // Schulze elects the Condorcet winner A, and neither group can do better for itself.
  assert.deepEqual(insincere(t, 3, "schulze").found, [null, null]);
  // Centre squeeze: plurality elects A; the 32 B > C > A voters can elect C instead by voting for C.
  const sq = P("35: A | B > C\n33: C | B > A\n32: B | C > A", 3);
  const pl = insincere(sq, 3, "plurality");
  assert.equal(pl.found[2].ballot.ranking[0], C);
  assert.deepEqual(pl.found[2].after, [C]);
  // Approval tries every set of candidates: the 35 A voters can add B... which elects B, worse for them than A; nothing better exists.
  assert.equal(insincere(sq, 3, "approval").found[0], null);
  assert.equal(insincere(Array.from({ length: 30 }, () => t[0]), 3, "borda").searched, false);
  assert.deepEqual(winnersOf("irv", t, 3), [A]);
});

test("every generator setting the page offers gives a profile it can read back", () => {
  // The largest: six candidates, 10,001 voters, impartial culture (over 2,000 distinct ballots).
  for (const model of ["ic", "line"]) {
    const g = generate({ n: 6, voters: 10001, model, seed: 1 });
    const back = parseProfile(formatProfile(g.types), 6);
    assert.ok(!back.errors, back.errors?.join(" "));
    assert.equal(back.total, 10001);
  }
  assert.ok(generate({ n: 6, voters: 10001, model: "ic", seed: 1 }).types.length > 2000);
});

test("the search one group at a time gives the same answers as the whole search", () => {
  const t = P(PACUIT, 4);
  for (const m of METHODS) {
    const whole = insincere(t, 4, m.key), s = insincereSearch(t, 4, m.key);
    assert.deepEqual(t.map((_, g) => s.group(g)), whole.found, m.key);
  }
  // Checked against an independent brute-force search: plurality elects A and the B > D > C > A and C > B > D > A
  // groups can gain; Copeland elects C and no group can; Schulze elects C and only the B > D > C > A group can.
  assert.deepEqual(insincere(t, 4, "plurality").found.map(Boolean), [false, false, true, true]);
  assert.deepEqual(insincere(t, 4, "copeland").found.map(Boolean), [false, false, false, false]);
  assert.deepEqual(insincere(t, 4, "schulze").found.map(Boolean), [false, false, true, false]);
});

test("Schulze's own examples (Schulze, arXiv:1804.02973, examples 1 to 6)", () => {
  const ex = [
    [`8: A>C>D>B
2: B>A>D>C
4: C>D>B>A
4: D>B>A>C
3: D>C>B>A`, 4, [D]],
    [`3: A>C>D>B
9: B>A>C>D
8: C>D>A>B
5: D>A>B>C
5: D>B>C>A`, 4, [C]],
    [`5: A>C>B>E>D
5: A>D>E>C>B
8: B>E>D>A>C
3: C>A>B>E>D
7: C>A>E>B>D
2: C>B>A>D>E
7: D>C>E>B>A
8: E>B>A>D>C`, 5, [4]],
    [`3: A>B>C>D
2: C>B>D>A
2: D>A>B>C
2: D>B>C>A`, 4, [B, D]],
    [`12: A>B>C>D
6: A>D>B>C
9: B>C>D>A
15: C>D>A>B
21: D>B>A>C`, 4, [D]],
    [`8: A>C>D>B
2: B>C>D>A
3: B>D>A>C
5: C>B>D>A
1: C>D>B>A
3: D>A>B>C
1: D>B>A>C`, 4, [A, C]],
  ];
  for (const [text, n, want] of ex) assert.deepEqual(schulze(P(text, n), n).winners, want, text);
});

test("the finding: 1,000 three-candidate elections of 101 voters, impartial culture, seeds 1 to 1,000", () => {
  const tally = createTally();
  for (let e = 0; e < 1000; e++) tally.add(runAll(generate({ n: 3, voters: 101, model: "ic", seed: 1 + e }).types, 3));
  const s = tally.summary;
  assert.equal(s.elections, 1000);
  assert.equal(s.withCondorcet, 915);
  const pct = (k) => ((k / s.withCondorcet) * 100).toFixed(1);
  assert.equal(pct(s.picksCondorcet.plurality), "73.2");
  assert.equal(pct(s.picksCondorcet.borda), "88.4");
  assert.equal(pct(s.picksCondorcet.irv), "95.6");
  assert.equal(s.allAgree, 524);
  close(GUILBAUD * 100, 91.226, 0.001);
});

function close(a, b, tol) { assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`); }
