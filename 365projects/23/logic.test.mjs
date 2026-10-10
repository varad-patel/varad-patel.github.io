import test from "node:test";
import assert from "node:assert/strict";
import { KINDS, MAX_NUMBER, triangular, isCount, moveGuest, newcomers, placeNewcomer, whoGets, resident, roomNow, RULES, ruleBit, parseRows, makeList } from "./logic.js";

const ARRIVALS = [{ kind: "one" }, { kind: "many", k: 3 }, { kind: "many", k: 20 }, { kind: "coach" }, { kind: "coaches" }];
const digits = (f, n) => Array.from({ length: n }, (_, i) => f(i + 1)).join("");

/* ---------- Hilbert's Hotel ---------- */

test("hand-computed room rules", () => {
  assert.equal(moveGuest({ kind: "one" }, 7), 8);
  assert.equal(placeNewcomer({ kind: "one" }, 1), 1);
  assert.equal(moveGuest({ kind: "many", k: 5 }, 7), 12);
  assert.equal(placeNewcomer({ kind: "many", k: 5 }, 4), 4);
  assert.equal(moveGuest({ kind: "coach" }, 7), 14);
  assert.equal(placeNewcomer({ kind: "coach" }, 7), 13);
  // Infinitely many coaches: the diagonals are (guest 1), (coach 1 seat 1, guest 2), (coach 2 seat 1, coach 1 seat 2, guest 3), ...
  const all = { kind: "coaches" };
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => moveGuest(all, n)), [1, 3, 6, 10, 15]);
  assert.equal(placeNewcomer(all, 1, 1), 2);
  assert.equal(placeNewcomer(all, 1, 2), 4);
  assert.equal(placeNewcomer(all, 2, 1), 5);
  assert.equal(placeNewcomer(all, 1, 3), 7);
  assert.equal(placeNewcomer(all, 3, 2), 13);
  assert.deepEqual(whoGets(all, 13), { seat: 3, coach: 2 });
  assert.deepEqual(whoGets(all, 6), { from: 3 });
  assert.deepEqual(whoGets({ kind: "coach" }, 9), { seat: 5, coach: 1 });
  assert.deepEqual(whoGets({ kind: "coach" }, 10), { from: 5 });
  assert.deepEqual(whoGets({ kind: "many", k: 3 }, 3), { seat: 3, coach: 1 });
  assert.deepEqual(whoGets({ kind: "many", k: 3 }, 4), { from: 1 });
  assert.equal(triangular(13), 91);
  assert.deepEqual(KINDS, ["one", "many", "coach", "coaches"]);
});

test("every rule fills each of the first 5,000 rooms exactly once (onto and one-to-one)", () => {
  for (const arrival of ARRIVALS) {
    const seen = new Set();
    for (let m = 1; m <= 5000; m++) {
      const who = whoGets(arrival, m);
      // Onto: the person named really is sent to room m.
      const back = who.from != null ? moveGuest(arrival, who.from) : placeNewcomer(arrival, who.seat, who.coach);
      assert.equal(back, m, `${arrival.kind} room ${m}`);
      // One-to-one: nobody is named twice.
      const id = who.from != null ? `g${who.from}` : `c${who.coach}s${who.seat}`;
      assert.ok(!seen.has(id), `${arrival.kind}: ${id} appears twice`);
      seen.add(id);
      if (who.from != null) assert.ok(isCount(who.from)); else assert.ok(isCount(who.seat) && isCount(who.coach));
    }
  }
});

test("nobody is left without a room: guests and newcomers all land on a room that names them", () => {
  for (const arrival of ARRIVALS) {
    for (let n = 1; n <= 400; n++) assert.deepEqual(whoGets(arrival, moveGuest(arrival, n)), { from: n });
    const count = Math.min(newcomers(arrival), 60);
    const coaches = arrival.kind === "coaches" ? 60 : 1;
    for (let c = 1; c <= coaches; c++) for (let s = 1; s <= count; s++) {
      assert.deepEqual(whoGets(arrival, placeNewcomer(arrival, s, c)), { seat: s, coach: c });
    }
  }
  assert.equal(newcomers({ kind: "one" }), 1);
  assert.equal(newcomers({ kind: "many", k: 7 }), 7);
  assert.equal(newcomers({ kind: "coach" }), Infinity);
  assert.equal(newcomers({ kind: "coaches" }), Infinity);
});

test("the largest inputs still give exact room numbers", () => {
  const all = { kind: "coaches" };
  const m = placeNewcomer(all, MAX_NUMBER, MAX_NUMBER);
  assert.ok(Number.isSafeInteger(m));
  assert.equal(m, triangular(2 * MAX_NUMBER - 1) + MAX_NUMBER);
  assert.deepEqual(whoGets(all, m), { seat: MAX_NUMBER, coach: MAX_NUMBER });
  assert.deepEqual(whoGets(all, moveGuest(all, MAX_NUMBER)), { from: MAX_NUMBER });
  assert.deepEqual(whoGets(all, m + 1), { seat: MAX_NUMBER + 1, coach: MAX_NUMBER - 1 });
});

test("newcomers who do not exist are refused", () => {
  assert.equal(placeNewcomer({ kind: "one" }, 2), null);
  assert.equal(placeNewcomer({ kind: "many", k: 3 }, 4), null);
  assert.equal(placeNewcomer({ kind: "coach" }, 0), null);
  assert.equal(placeNewcomer({ kind: "coach" }, 2.5), null);
  assert.equal(placeNewcomer({ kind: "coaches" }, 3, 0), null);
  assert.equal(placeNewcomer({ kind: "coaches" }, NaN, 1), null);
  assert.equal(isCount(1), true);
  assert.equal(isCount(MAX_NUMBER + 1), false);
  assert.equal(isCount("3"), false);
  assert.throws(() => moveGuest({ kind: "bus" }, 1));
});

test("arrivals compose: after any history every room has one resident and every resident one room", () => {
  const history = [{ kind: "one" }, { kind: "coach" }, { kind: "many", k: 4 }, { kind: "coaches" }, { kind: "one" }];
  assert.deepEqual(resident([], 9), { batch: 0, from: 9 });
  assert.deepEqual(resident([{ kind: "one" }], 1), { batch: 1, seat: 1, coach: 1 });
  assert.deepEqual(resident([{ kind: "one" }], 2), { batch: 0, from: 1 });
  // One guest, then a coach: room 2 holds whoever was in room 1 before the coach, the single newcomer.
  assert.deepEqual(resident(history.slice(0, 2), 2), { batch: 1, seat: 1, coach: 1 });
  assert.deepEqual(resident(history.slice(0, 2), 4), { batch: 0, from: 1 });
  const seen = new Set();
  for (let m = 1; m <= 3000; m++) {
    const who = resident(history, m);
    assert.equal(roomNow(history, who), m);
    const id = JSON.stringify(who);
    assert.ok(!seen.has(id));
    seen.add(id);
  }
  // The guest who started in room 1: 1 -> 2 -> 4 -> 8 -> 36 -> 37.
  assert.equal(roomNow(history, { batch: 0, from: 1 }), 37);
});

/* ---------- Cantor's diagonal ---------- */

test("the rules generate the rows they claim to", () => {
  assert.equal(digits((j) => ruleBit("binary", 1, j), 8), "00000000");
  assert.equal(digits((j) => ruleBit("binary", 2, j), 8), "10000000");
  assert.equal(digits((j) => ruleBit("binary", 6, j), 8), "10100000");    // 5 = 101 in binary
  assert.equal(digits((j) => ruleBit("binary", 1e6, j), 60).slice(53), "0000000");
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((i) => digits((j) => ruleBit("periodic", i, j), 6)), ["000000", "111111", "000000", "010101", "101010", "111111", "000000"]);
  assert.equal(digits((j) => ruleBit("periodic", 21, j), 12), "011001100110");  // 22 = 10110 in binary, so the pattern is 0110
  assert.equal(digits((j) => ruleBit("multiples", 1, j), 8), "11111111");
  assert.equal(digits((j) => ruleBit("multiples", 3, j), 8), "00100100");
  assert.equal(RULES.length, 4);
  assert.throws(() => ruleBit("nope", 1, 1));
});

test("coin flips are fixed by the seed and look fair", () => {
  assert.equal(digits((j) => ruleBit("coin", 5, j, 23), 40), digits((j) => ruleBit("coin", 5, j, 23), 40));
  assert.notEqual(digits((j) => ruleBit("coin", 5, j, 23), 40), digits((j) => ruleBit("coin", 5, j, 24), 40));
  let ones = 0, agree = 0;
  for (let i = 1; i <= 200; i++) for (let j = 1; j <= 200; j++) {
    const b = ruleBit("coin", i, j, 23);
    ones += b;
    agree += b === ruleBit("coin", i + 1, j, 23) ? 1 : 0;
  }
  assert.ok(Math.abs(ones / 40000 - 0.5) < 0.01, `share of ones ${ones / 40000}`);
  assert.ok(Math.abs(agree / 40000 - 0.5) < 0.01, `neighbouring rows agree ${agree / 40000}`);
});

test("the flipped diagonal differs from row k at position k, for every rule and after any number of additions", () => {
  for (const { key } of RULES) for (const typed of [[], ["01", "0011", "1"]]) for (const added of [0, 1, 2, 5, 12]) {
    const list = makeList({ typed, rule: key, seed: 23, added });
    for (let k = 1; k <= 400; k++) {
      assert.equal(list.missing(k), 1 - list.bit(k, k), `${key} added ${added} row ${k}`);
      const first = list.firstDifference(k);
      assert.ok(first >= 1 && first <= k);
      assert.notEqual(list.missing(first), list.bit(k, first));
      for (let j = 1; j < first; j++) assert.equal(list.missing(j), list.bit(k, j));
    }
  }
});

test("known missing sequences", () => {
  // Counting in binary: digit k of row k is always 0, so the missing sequence is all 1s, which has infinitely many 1s.
  assert.equal(digits(makeList({ rule: "binary" }).missing, 60), "1".repeat(60));
  // Multiples: row k has a 1 at position k, so the missing sequence is all 0s.
  assert.equal(digits(makeList({ rule: "multiples" }).missing, 60), "0".repeat(60));
  // Typed rows repeat: 01 -> 0101..., 0011 -> 0011..., 1 -> 111...; the diagonal is 0, 0, 1.
  const list = makeList({ typed: ["01", "0011", "1"], rule: "multiples" });
  assert.equal(digits((j) => list.bit(2, j), 8), "00110011");
  assert.equal(digits(list.missing, 3), "110");
  assert.deepEqual([1, 2, 3, 4, 5].map((k) => list.source(k)), ["typed", "typed", "typed", "rule", "rule"]);
  assert.equal(digits((j) => list.bit(4, j), 6), "111111");   // the first generated row comes after the typed ones
});

test("the missing sequence of the repeating-pattern list repeats with no period", () => {
  const list = makeList({ rule: "periodic" });
  // Every pattern w has a row: the number written as 1 followed by w, minus 1.
  for (let len = 1; len <= 10; len++) for (let v = 0; v < 2 ** len; v++) {
    const w = v.toString(2).padStart(len, "0");
    const k = parseInt("1" + w, 2) - 1;
    assert.equal(digits((j) => list.bit(k, j), len * 2), w + w);
    assert.notEqual(list.missing(k), Number(w[(k - 1) % len]), `pattern ${w}`);
  }
  // So no period p up to 10 fits the first 2,100 digits.
  const s = digits(list.missing, 2100);
  for (let p = 1; p <= 10; p++) assert.notEqual(s, s.slice(0, p).repeat(210).slice(0, 2100), `period ${p}`);
});

test("adding the missing sequence puts it in row 1, moves every row down, and leaves a new one missing", () => {
  for (const { key } of RULES) {
    let before = makeList({ rule: key, seed: 23, added: 0 });
    for (let added = 1; added <= 6; added++) {
      const after = makeList({ rule: key, seed: 23, added });
      assert.equal(digits((j) => after.bit(1, j), 120), digits(before.missing, 120));
      for (let k = 1; k <= 30; k++) assert.equal(digits((j) => after.bit(k + 1, j), 60), digits((j) => before.bit(k, j), 60));
      assert.equal(after.source(1), "added");
      assert.equal(after.source(added), "added");
      assert.equal(after.source(added + 1), "rule");
      assert.notEqual(after.missing(1), before.missing(1));   // the new missing sequence is not the old one
      for (let k = 1; k <= added; k++) assert.notEqual(after.missing(k), after.bit(k, k));
      before = after;
    }
  }
});

test("typed rows are validated", () => {
  assert.deepEqual(parseRows("01\n 0 0 1 1 \n\n1"), { rows: ["01", "0011", "1"], errors: [] });
  assert.deepEqual(parseRows(""), { rows: [], errors: [] });
  assert.deepEqual(parseRows(null), { rows: [], errors: [] });
  const bad = parseRows("0101\n0121\nabc");
  assert.deepEqual(bad.rows, ["0101"]);
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors[0], /Line 2 contains "2"/);
  assert.match(parseRows("1".repeat(65)).errors[0], /65 digits/);
  const many = parseRows(Array(15).fill("10").join("\n"));
  assert.equal(many.rows.length, 12);
  assert.equal(many.errors.length, 1);
  assert.equal(parseRows("0\r\n1").rows.length, 2);
});

test("the finding: room 100 and the first digits of the sequence missing from every repeating pattern", () => {
  const all = { kind: "coaches" };
  assert.deepEqual(whoGets(all, 100), { seat: 9, coach: 5 });
  assert.equal(placeNewcomer(all, 9, 5), 100);
  assert.equal(moveGuest(all, 13), 91);
  // Hand-checked: the diagonal of the rows 0, 1, 00, 01, 10, 11, 000, 001, 010, 011, 100, 101 (each repeated) is 010111000001.
  assert.equal(digits(makeList({ rule: "periodic" }).missing, 12), "101000111110");
});
