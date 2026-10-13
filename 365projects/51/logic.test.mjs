import test from "node:test";
import assert from "node:assert/strict";
import { MARKET, LIMITS, problem, stage, temptation, deterrent, criticalDelta, verdict, values, simulate, bestSustainable } from "./logic.js";

const close = (x, y, tol = 1e-9) => assert.ok(Math.abs(x - y) <= tol, `${x} is not within ${tol} of ${y}`);

/* ---------------------------------------------------------------- one period, by hand */

test("one period's profits with P = 100 - Q and cost 20, worked by hand", () => {
  // Monopoly: Q = 40, P = 60, profit 1,600. Two firms share it: 800 each.
  const b = stage("bertrand", 2);
  close(b.price, 60); close(b.collude, 800); close(b.deviate, 1600); close(b.punish, 0); close(b.cheated, 0); close(b.warPrice, 20);
  // Cournot: the cheat's best reply to the other's 20 units is (80 - 20) / 2 = 30, price 50, profit 900; the other gets 600.
  const c = stage("cournot", 2);
  close(c.collude, 800); close(c.cheatOutput, 30); close(c.cheatPrice, 50); close(c.deviate, 900); close(c.cheated, 600);
  // Cournot equilibrium: 26.67 each, price 46.67, profit 711.11.
  close(c.warOutput, 80 / 3); close(c.warPrice, 140 / 3); close(c.punish, 6400 / 9);
  // Five firms: 320 each; a Bertrand cheat takes 1,600; a Cournot cheat makes (80 - 32) / 2 = 24 at price 44: 576.
  close(stage("bertrand", 5).collude, 320); close(stage("bertrand", 5).deviate, 1600);
  close(stage("cournot", 5).deviate, 576); close(stage("cournot", 5).punish, 6400 / 36);
});

test("the general formulas: deviate = (a-c)^2 (n+1)^2 / 16 b n^2, punish = (a-c)^2 / b (n+1)^2, and the temptation ratio", () => {
  for (const market of [MARKET, { a: 50, b: 2, c: 10 }, { a: 7, b: 0.3, c: 0 }]) {
    const A = (market.a - market.c) ** 2 / market.b;
    for (let n = 2; n <= 30; n++) {
      const c = stage("cournot", n, market), b = stage("bertrand", n, market);
      close(c.collude, A / (4 * n), 1e-9 * A); close(c.deviate, (A * (n + 1) ** 2) / (16 * n * n), 1e-9 * A); close(c.punish, A / (n + 1) ** 2, 1e-9 * A);
      close(b.collude, A / (4 * n), 1e-9 * A); close(b.deviate, A / 4, 1e-9 * A);
      for (const [mode, s] of [["cournot", c], ["bertrand", b]]) {
        const { num, den } = temptation(mode, n);
        close((s.deviate - s.collude) / (s.collude - s.punish), num / den, 1e-9);
      }
    }
  }
});

/* ---------------------------------------------------------------- critical discount factors */

test("grim trigger, Bertrand: the cartel needs delta >= 1 - 1/n", () => {
  for (let n = 2; n <= 50; n++) close(criticalDelta("bertrand", n), 1 - 1 / n, 1e-12);
  close(criticalDelta("bertrand", 2), 0.5); close(criticalDelta("bertrand", 10), 0.9);
});

test("grim trigger, Cournot: delta >= (n+1)^2 / (n^2 + 6n + 1), which is 9/17 for two firms", () => {
  for (let n = 2; n <= 50; n++) close(criticalDelta("cournot", n), (n + 1) ** 2 / (n * n + 6 * n + 1), 1e-12);
  close(criticalDelta("cournot", 2), 9 / 17);
  // From the three profits directly: (deviate - collude) / (deviate - punish).
  const s = stage("cournot", 2);
  close(criticalDelta("cournot", 2), (s.deviate - s.collude) / (s.deviate - s.punish), 1e-12);
});

test("a detection lag of L periods raises the grim-trigger threshold to its L-th root", () => {
  for (const mode of ["bertrand", "cournot"]) {
    for (const n of [2, 3, 7]) for (const L of [1, 2, 3, 6, 12]) close(criticalDelta(mode, n, Infinity, L), criticalDelta(mode, n) ** (1 / L), 1e-12);
  }
  close(criticalDelta("bertrand", 2, Infinity, 2), Math.SQRT1_2, 1e-12);
});

test("a price war of T periods: no patience is enough unless T > L rho, and otherwise the threshold solves delta + ... + delta^T = rho", () => {
  // Bertrand duopoly, rho = 1: a one-period war never deters; two periods need delta^2 + delta = 1, the golden ratio's inverse.
  assert.equal(criticalDelta("bertrand", 2, 1), null);
  close(criticalDelta("bertrand", 2, 2), (Math.sqrt(5) - 1) / 2, 1e-12);
  // Cournot duopoly, rho = 9/8: one period is not enough; two need delta^2 + delta = 1.125.
  assert.equal(criticalDelta("cournot", 2, 1), null);
  close(criticalDelta("cournot", 2, 2), (Math.sqrt(5.5) - 1) / 2, 1e-12);
  // Bertrand with n firms needs T >= n when L = 1 (T > n - 1), and T > L (n - 1) in general.
  for (let n = 2; n <= 12; n++) {
    assert.equal(criticalDelta("bertrand", n, n - 1), null);
    assert.ok(criticalDelta("bertrand", n, n) < 1);
    assert.equal(criticalDelta("bertrand", n, 3 * (n - 1), 3), null);
    assert.ok(criticalDelta("bertrand", n, 3 * (n - 1) + 1, 3) < 1);
  }
  // The exact boundary under Cournot: n = 3 has rho = 4/3, so T = 4 with L = 3 is exactly too short.
  assert.equal(criticalDelta("cournot", 3, 4, 3), null);
  assert.ok(criticalDelta("cournot", 3, 5, 3) < 1);
  // The root satisfies its equation.
  for (const [mode, n, T, L] of [["bertrand", 4, 6, 1], ["cournot", 5, 9, 2], ["bertrand", 3, 30, 4], ["cournot", 20, 100, 1]]) {
    const d = criticalDelta(mode, n, T, L), { num, den } = temptation(mode, n);
    close(deterrent(d, T, L), num / den, 1e-9);
  }
});

test("thresholds move the way they should: down with a longer war (towards grim), up with a longer lag and with more firms", () => {
  for (const mode of ["bertrand", "cournot"]) {
    let last = 1;
    for (let T = 3; T <= 400; T++) { const d = criticalDelta(mode, 3, T); assert.ok(T <= 30 ? d < last : d <= last, `T=${T}`); last = d; }
    close(criticalDelta(mode, 3, 1000), criticalDelta(mode, 3), 1e-9);
    for (let L = 1; L < 12; L++) assert.ok(criticalDelta(mode, 3, Infinity, L + 1) > criticalDelta(mode, 3, Infinity, L));
    for (let n = 2; n < 60; n++) assert.ok(criticalDelta(mode, n + 1) > criticalDelta(mode, n));
  }
  // Two firms: Cournot needs more patience than Bertrand (the war hurts less). From three firms on it is the other way round.
  assert.ok(criticalDelta("cournot", 2) > criticalDelta("bertrand", 2));
  for (let n = 3; n <= 50; n++) assert.ok(criticalDelta("cournot", n) < criticalDelta("bertrand", n));
});

test("the thresholds do not depend on demand or cost", () => {
  for (const market of [{ a: 50, b: 2, c: 10 }, { a: 1000, b: 0.01, c: 999 }, { a: 3, b: 7, c: 0 }]) {
    for (const mode of ["bertrand", "cournot"]) for (const [n, T, L] of [[2, Infinity, 1], [5, 12, 2], [9, 40, 3]]) {
      const d = criticalDelta(mode, n, T, L);
      for (const eps of [-1e-6, 1e-6]) {
        const v = values({ mode, n, delta: d + eps, T, L, market });
        assert.equal(v.gain < 0, eps > 0, `${mode} n=${n} T=${T} L=${L}: gain ${v.gain} at delta ${d + eps}`);
      }
    }
  }
});

/* ---------------------------------------------------------------- the simulation against the formulas */

test("the period-by-period simulation gives the same discounted profits as the formulas", () => {
  for (const mode of ["bertrand", "cournot"]) {
    for (const n of [2, 3, 8]) for (const delta of [0, 0.2, 0.5, 0.9, 0.99]) for (const T of [1, 4, 25, Infinity]) for (const L of [1, 3]) {
      const v = values({ mode, n, delta, T, L });
      const cheat = simulate({ mode, n, delta, T, L, cheat: true });
      const comply = simulate({ mode, n, delta, T, L, cheat: false });
      close(cheat.cheater, v.cheat, 1e-9 * Math.max(1, v.cheat));
      close(comply.cheater, v.comply, 1e-9 * Math.max(1, v.comply));
      close(comply.other, v.comply, 1e-9 * Math.max(1, v.comply));
    }
  }
  // By hand: Bertrand duopoly, delta = 0.5, grim: complying is 800 / 0.5 = 1,600 and cheating is 1,600 once.
  const v = values({ mode: "bertrand", n: 2, delta: 0.5 });
  close(v.comply, 1600); close(v.cheat, 1600);
  // Cournot duopoly, delta = 0.6, war of 3: cheat = 900 + 711.11 (0.6 + 0.36 + 0.216) + 800 * 0.6^4 / 0.4.
  close(values({ mode: "cournot", n: 2, delta: 0.6, T: 3 }).cheat, 900 + (6400 / 9) * 1.176 + (800 * 0.1296) / 0.4, 1e-9);
});

test("the simulated payoffs change sign at the critical discount factor", () => {
  for (const mode of ["bertrand", "cournot"]) {
    for (const [n, T, L] of [[2, Infinity, 1], [2, 2, 1], [4, Infinity, 1], [4, 9, 2], [10, Infinity, 3], [3, 60, 5]]) {
      const d = criticalDelta(mode, n, T, L);
      const gainAt = (delta) => simulate({ mode, n, delta, T, L, cheat: true }).cheater - simulate({ mode, n, delta, T, L, cheat: false }).cheater;
      assert.ok(gainAt(d - 0.005) > 0, `${mode} n=${n} T=${T} L=${L}: cheating should pay just below ${d}`);
      assert.ok(gainAt(d + 0.005) < 0, `${mode} n=${n} T=${T} L=${L}: cheating should not pay just above ${d}`);
      assert.equal(verdict({ mode, n, delta: d - 0.005, T, L }).holds, false);
      assert.equal(verdict({ mode, n, delta: d + 0.005, T, L }).holds, true);
    }
    // Where no patience is enough, cheating pays at every delta.
    for (const delta of [0, 0.3, 0.9, 0.999]) {
      assert.ok(simulate({ mode, n: 2, delta, T: 1, cheat: true }).cheater > simulate({ mode, n: 2, delta, T: 1, cheat: false }).cheater);
      assert.equal(verdict({ mode, n: 2, delta, T: 1 }).holds, false);
      assert.equal(verdict({ mode, n: 2, delta, T: 1 }).critical, null);
    }
  }
});

test("the simulation plays the phases in order and the prices are the market's", () => {
  const s = simulate({ mode: "cournot", n: 2, delta: 0.9, T: 3, L: 2 });
  assert.deepEqual(s.rows.slice(0, 7).map((r) => r.phase), ["cheating", "cheating", "war", "war", "war", "agreement", "agreement"]);
  close(s.rows[0].price, 50); close(s.rows[0].mine, 900); close(s.rows[0].theirs, 600);
  close(s.rows[2].price, 140 / 3); close(s.rows[2].mine, 6400 / 9);
  close(s.rows[5].price, 60); close(s.rows[5].mine, 800);
  const b = simulate({ mode: "bertrand", n: 4, delta: 0.9, T: Infinity, L: 1 });
  close(b.rows[0].mine, 1600); close(b.rows[0].theirs, 0); close(b.rows[0].myOutput, 40);
  assert.ok(b.rows.slice(1).every((r) => r.phase === "war" && r.price === 20 && r.mine === 0));
  assert.equal(simulate({ mode: "bertrand", n: 4, delta: 0.9, cheat: false }).rows.every((r) => r.phase === "agreement" && r.mine === 400), true);
  assert.equal(simulate({ mode: "bertrand", n: 2, delta: 0 }).horizon, 1);
  assert.equal(simulate({ mode: "bertrand", n: 2, delta: 0.99, keep: 5 }).rows.length, 5);
});

test("exactly on the threshold a firm is indifferent, and that counts as holding", () => {
  for (const [n, delta] of [[2, 0.5], [4, 0.75], [5, 0.8], [10, 0.9], [20, 0.95], [50, 0.98], [100, 0.99]]) {
    const v = verdict({ mode: "bertrand", n, delta });
    assert.equal(v.threshold, true, `n=${n}`); assert.equal(v.holds, true);
    close(values({ mode: "bertrand", n, delta }).gain, 0, 1e-8);
  }
  assert.equal(verdict({ mode: "bertrand", n: 2, delta: 0.51 }).threshold, false);
  assert.equal(verdict({ mode: "bertrand", n: 2, delta: 0.49 }).holds, false);
});

/* ---------------------------------------------------------------- the best agreement that holds */

test("the best agreement that holds: all or nothing under Bertrand, a sliding scale under Cournot", () => {
  assert.deepEqual(bestSustainable({ mode: "bertrand", n: 2, delta: 0.49 }), { price: 20, each: 40, profit: 0, share: 0, full: false });
  assert.equal(bestSustainable({ mode: "bertrand", n: 2, delta: 0.5 }).share, 1);
  // Cournot duopoly, grim, delta = 0.3: x = (0.7 * 9 + 1.2) / (3 * 8.7) = 0.28736, each makes 22.99, price 54.02.
  const c = bestSustainable({ mode: "cournot", n: 2, delta: 0.3 });
  close(c.each, (80 * 7.5) / 26.1, 1e-9); close(c.price, 100 - (160 * 7.5) / 26.1, 1e-9); assert.equal(c.full, false);
  assert.ok(c.share > 0 && c.share < 1);
  // At that output the firm is exactly indifferent, by the formulas and by simulation.
  const s = stage("cournot", 2, MARKET, c.each);
  close((s.collude - s.punish) * deterrent(0.3, Infinity, 1), s.deviate - s.collude, 1e-9);
  const cheat = simulate({ mode: "cournot", n: 2, delta: 0.3, each: c.each, cheat: true }).cheater;
  const comply = simulate({ mode: "cournot", n: 2, delta: 0.3, each: c.each, cheat: false }).cheater;
  close(cheat, comply, 1e-8);
  // A little more ambitious (lower output) and cheating pays; a little less and it does not.
  const gain = (each) => simulate({ mode: "cournot", n: 2, delta: 0.3, each, cheat: true }).cheater - simulate({ mode: "cournot", n: 2, delta: 0.3, each, cheat: false }).cheater;
  assert.ok(gain(c.each - 0.05) > 0); assert.ok(gain(c.each + 0.05) < 0);
  // No patience: only the Cournot outcome. Enough patience: the monopoly outcome.
  const none = bestSustainable({ mode: "cournot", n: 3, delta: 0 });
  close(none.each, 20); close(none.share, 0); close(none.price, 40);
  const all = bestSustainable({ mode: "cournot", n: 3, delta: 0.6 });
  assert.equal(all.full, true); close(all.price, 60);
  // The share rises with patience and reaches 1 at the critical value, for several settings.
  for (const [n, T, L] of [[2, Infinity, 1], [5, 8, 1], [3, Infinity, 4]]) {
    let last = -1;
    const top = criticalDelta("cournot", n, T, L);
    for (let d = 0; d < top; d += 0.01) { const b = bestSustainable({ mode: "cournot", n, delta: d, T, L }); assert.ok(b.share >= last - 1e-12 && b.share < 1); last = b.share; }
    close(bestSustainable({ mode: "cournot", n, delta: top - 1e-9, T, L }).share, 1, 1e-6);
  }
});

test("the best agreement that holds, found by search: the closed form is the boundary, for wars and lags as well", () => {
  // Nothing here uses bestSustainable's formula: a firm's gain from cheating is the difference between two simulated
  // totals, and the boundary is found by halving between the monopoly share (cheating pays) and the Cournot output.
  const gain = (s, each) => simulate({ ...s, each, cheat: true }).cheater - simulate({ ...s, each, cheat: false }).cheater;
  for (const [n, delta, T, L] of [[2, 0.3, Infinity, 1], [10, 0.5, Infinity, 1], [5, 0.6, 3, 1], [3, 0.9, 1, 1], [2, 0.95, 1, 1], [4, 0.7, 5, 2], [20, 0.99, 40, 12], [7, 0.77, 9, 3]]) {
    const s = { mode: "cournot", n, delta, T, L };
    const b = bestSustainable(s);
    assert.equal(b.full, false);
    let lo = 80 / (2 * n), hi = 80 / (n + 1);
    assert.ok(gain(s, lo) > 0, "the monopoly share does not hold");
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (gain(s, mid) > 0) lo = mid; else hi = mid; }
    close(b.each, hi, 1e-6);
    close(b.price, 100 - n * hi, 1e-5);
    // Every less ambitious agreement holds too, and every more ambitious one fails: the boundary is the only one.
    for (let k = 1; k <= 20; k++) {
      assert.ok(gain(s, b.each + ((80 / (n + 1) - b.each) * k) / 20) <= 1e-7);
      assert.ok(gain(s, b.each - ((b.each - 80 / (2 * n)) * k) / 20) > 0);
    }
  }
  // By hand: two firms, a one-period war, patience 0.95. h = 0.95, k = 1 / 1.95, x = (9k + 4(1 - k)) / (3 (8 + k)),
  // each makes 80 x = 20.56 and the price is 58.88: the monopoly price of 60 cannot be held but nearly all of it can.
  const k = 1 / 1.95, x = (9 * k + 4 * (1 - k)) / (3 * (8 + k));
  const war = bestSustainable({ mode: "cournot", n: 2, delta: 0.95, T: 1, L: 1 });
  close(war.each, 80 * x, 1e-9); assert.equal(war.price.toFixed(2), "58.88"); assert.ok(war.share > 0.99 && war.share < 1);
  // Bertrand is all or nothing at every price: scan agreed prices from just above cost to the monopoly price.
  for (const [n, delta, T, L, holds] of [[2, 0.45, Infinity, 1, false], [2, 0.55, Infinity, 1, true], [5, 0.7, Infinity, 1, false], [2, 0.6, 2, 1, false], [2, 0.65, 2, 1, true], [3, 0.95, 40, 12, false]]) {
    const s = { mode: "bertrand", n, delta, T, L };
    for (let i = 1; i <= 40; i++) {
      const price = 20 + i, each = (100 - price) / n;
      assert.equal(gain(s, each) <= 1e-9, holds, `n ${n}, delta ${delta}, price ${price}`);
    }
    assert.equal(bestSustainable(s).full, holds);
  }
});

/* ---------------------------------------------------------------- edges and bad input */

test("bad settings are refused with a message that says what to fix", () => {
  const ok = { mode: "bertrand", n: 2, delta: 0.5, T: Infinity, L: 1 };
  assert.equal(problem(ok), "");
  assert.match(problem({ ...ok, mode: "monopoly" }), /Bertrand or Cournot/);
  assert.match(problem({ ...ok, n: 1 }), /from 2 to 100/);
  assert.match(problem({ ...ok, n: 2.5 }), /whole number/);
  assert.match(problem({ ...ok, n: LIMITS.firms + 1 }), /from 2 to 100/);
  assert.match(problem({ ...ok, delta: 1 }), /Patience/);
  assert.match(problem({ ...ok, delta: -0.1 }), /Patience/);
  assert.match(problem({ ...ok, delta: NaN }), /Patience/);
  assert.match(problem({ ...ok, T: 0 }), /price war/);
  assert.match(problem({ ...ok, T: 1.5 }), /price war/);
  assert.match(problem({ ...ok, L: 0 }), /detection lag/);
  assert.match(problem({ ...ok, market: { a: 10, b: 1, c: 10 } }), /above the cost/);
  assert.match(problem(), /Bertrand or Cournot/);
  assert.throws(() => criticalDelta("bertrand", 1), RangeError);
  assert.throws(() => values({ ...ok, delta: 1 }), RangeError);
  assert.throws(() => simulate({ ...ok, L: -1 }), RangeError);
});

test("extreme settings give finite answers", () => {
  for (const mode of ["bertrand", "cournot"]) {
    for (const [n, T, L] of [[100, 1000, 1000], [100, Infinity, 1000], [2, 1000, 1], [100, 1, 1]]) {
      const d = criticalDelta(mode, n, T, L);
      assert.ok(d === null || (d > 0 && d < 1), `${mode} ${n} ${T} ${L}: ${d}`);
      const v = values({ mode, n, delta: LIMITS.delta, T, L });
      assert.ok(Number.isFinite(v.comply) && Number.isFinite(v.cheat));
      const b = bestSustainable({ mode, n, delta: LIMITS.delta, T, L });
      assert.ok(Number.isFinite(b.price) && b.share >= 0 && b.share <= 1);
    }
  }
});

/* ---------------------------------------------------------------- the finding on the page */

test("the finding: 0.500 and 0.529 for two firms, 0.900 and 0.752 for ten; a two-period war needs 0.618 and 0.673; one period never works", () => {
  assert.equal(criticalDelta("bertrand", 2).toFixed(3), "0.500");
  assert.equal(criticalDelta("cournot", 2).toFixed(3), "0.529");
  assert.equal(criticalDelta("bertrand", 10).toFixed(3), "0.900");
  assert.equal(criticalDelta("cournot", 10).toFixed(3), "0.752");
  assert.equal(criticalDelta("bertrand", 2, 2).toFixed(3), "0.618");
  assert.equal(criticalDelta("cournot", 2, 2).toFixed(3), "0.673");
  // Also quoted in the write-up: a four-period lag takes two price-setting firms from 0.5 to 0.841.
  assert.equal(criticalDelta("bertrand", 2, Infinity, 4).toFixed(3), "0.841");
  assert.equal(bestSustainable({ mode: "cournot", n: 2, delta: 0.3 }).price.toFixed(2), "54.02");
  assert.equal(criticalDelta("bertrand", 2, 1), null);
  assert.equal(criticalDelta("cournot", 2, 1), null);
  // The default view of the page: Bertrand, two firms, delta 0.6, grim: holds, complying 2,000 against cheating 1,600.
  const v = values({ mode: "bertrand", n: 2, delta: 0.6 });
  close(v.comply, 2000); close(v.cheat, 1600); assert.equal(verdict({ mode: "bertrand", n: 2, delta: 0.6 }).holds, true);
});
