import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { normalise, theory, hostOpens, playOnce, emptyTally, runGames, margin, newGame, choose, decide, alternatives } from "./logic.js";

const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const classic = normalise({});

test("settings are clamped to a playable game", () => {
  assert.deepEqual(normalise({}), { doors: 3, opened: 1, host: "knows" });
  assert.deepEqual(normalise({ doors: 99, opened: 99, host: "random" }), { doors: 10, opened: 8, host: "random" });
  assert.deepEqual(normalise({ doors: 1, opened: 0, host: "x" }), { doors: 3, opened: 1, host: "knows" });
  assert.equal(normalise({ doors: 5, opened: 4 }).opened, 3);
});

test("theory: the classic game is 1/3 to stay and 2/3 to switch", () => {
  const t = theory(classic);
  close(t.stay, 1 / 3, 1e-12);
  close(t.swap, 2 / 3, 1e-12);
  assert.equal(t.valid, 1);
});

test("theory: more doors, a host who opens all but one, and a host who opens at random", () => {
  close(theory({ doors: 10, opened: 8 }).swap, 0.9, 1e-12);
  close(theory({ doors: 10, opened: 8 }).stay, 0.1, 1e-12);
  // Four doors, one opened: 3/4 shared between two closed doors.
  close(theory({ doors: 4, opened: 1 }).swap, 3 / 8, 1e-12);
  const blind = theory({ doors: 3, opened: 1, host: "random" });
  close(blind.stay, 0.5, 1e-12);
  close(blind.swap, 0.5, 1e-12);
  close(blind.valid, 2 / 3, 1e-12);
  // Staying plus switching to each of the other closed doors must account for the car exactly once.
  for (let n = 3; n <= 10; n++) for (let m = 1; m <= n - 2; m++) {
    const t = theory({ doors: n, opened: m });
    close(t.stay + (n - 1 - m) * t.swap, 1, 1e-12);
  }
});

test("theory agrees with counting every case, for every setting and both hosts", () => {
  // Every car position, first pick and set of doors the host could open, weighted by its probability. No closed forms.
  const subsets = (pool, m) => (m === 0 ? [[]] : pool.flatMap((d, i) => subsets(pool.slice(i + 1), m - 1).map((rest) => [d, ...rest])));
  const count = (n, m, host) => {
    let valid = 0, stay = 0, swap = 0;
    for (let car = 0; car < n; car++) for (let pick = 0; pick < n; pick++) {
      const pool = Array.from({ length: n }, (_, d) => d).filter((d) => d !== pick && (host === "random" || d !== car));
      const sets = subsets(pool, m);
      for (const open of sets) {
        if (open.includes(car)) continue;
        const pr = 1 / (n * n * sets.length);
        valid += pr;
        if (pick === car) stay += pr; else swap += pr / (n - 1 - m); // the car is one of the n-1-m other closed doors
      }
    }
    return { valid, stay: stay / valid, swap: swap / valid };
  };
  for (let n = 3; n <= 8; n++) for (let m = 1; m <= n - 2; m++) for (const host of ["knows", "random"]) {
    const want = count(n, m, host), got = theory({ doors: n, opened: m, host });
    for (const k of ["valid", "stay", "swap"]) close(got[k], want[k], 1e-12);
  }
  // The random host shows the car in m of every N games; seven doors, three opened: 3/7.
  close(1 - theory({ doors: 7, opened: 3, host: "random" }).valid, 3 / 7, 1e-12);
  close(theory({ doors: 7, opened: 3, host: "random" }).swap, 1 / 4, 1e-12);
});

test("the margins quoted in the write-up, for p = 2/3", () => {
  assert.equal((100 * margin(2 / 3, 100)).toFixed(0), "9");
  assert.equal((100 * margin(2 / 3, 10000)).toFixed(1), "0.9");
  assert.equal((100 * margin(2 / 3, 100000)).toFixed(1), "0.3");
  assert.equal((100 * margin(2 / 3, 10)).toFixed(0), "29"); // "about 30" for ten games by hand
});

test("a host who knows never opens your door or the car's, and opens the right number", () => {
  const r = rng(11);
  for (let i = 0; i < 2000; i++) {
    const config = normalise({ doors: r.int(3, 10), opened: r.int(1, 8) });
    const car = r.int(0, config.doors - 1), pick = r.int(0, config.doors - 1);
    const open = hostOpens(r, config, car, pick);
    assert.equal(open.length, config.opened);
    assert.equal(new Set(open).size, open.length);
    assert.ok(!open.includes(car) && !open.includes(pick));
  }
});

test("in the classic game exactly one of the two strategies wins every time", () => {
  const r = rng(5);
  for (let i = 0; i < 3000; i++) {
    const g = playOnce(r, classic);
    assert.equal(g.void, false);
    assert.notEqual(g.stayWins, g.swapWins);
  }
});

test("simulation converges on the theory (fixed seeds)", () => {
  const cases = [
    [classic, 200000, 0.004],
    [normalise({ doors: 10, opened: 8 }), 100000, 0.004],
    [normalise({ doors: 5, opened: 2 }), 100000, 0.005],
    [normalise({ doors: 3, opened: 1, host: "random" }), 150000, 0.006],
    [normalise({ doors: 6, opened: 3, host: "random" }), 150000, 0.006],
  ];
  cases.forEach(([config, n, tol], i) => {
    const t = runGames(rng(100 + i), n, config, emptyTally());
    const th = theory(config);
    close(t.stayWins / t.games, th.stay, tol);
    close(t.swapWins / t.games, th.swap, tol);
    close(t.games / (t.games + t.voided), th.valid, tol);
  });
});

test("the finding on the page: 100,000 games from seed 3", () => {
  const t = runGames(rng(3), 100000, classic, emptyTally());
  assert.equal(t.games, 100000);
  assert.equal(t.swapWins + t.stayWins, 100000);
  assert.equal(t.swapWins, 66892);
  assert.equal(t.stayWins, 33108);
  const blind = runGames(rng(3), 100000, normalise({ host: "random" }), emptyTally());
  assert.equal(blind.games, 66664);
  assert.equal(blind.swapWins, 33263);
  assert.equal(blind.stayWins, 33401);
});

test("the trail of running rates is ordered, ends at the total and accumulates across batches", () => {
  const r = rng(9);
  const t = emptyTally();
  runGames(r, 1000, classic, t);
  runGames(r, 9000, classic, t);
  assert.equal(t.games, 10000);
  assert.equal(t.trail.at(-1).n, 10000);
  assert.ok(t.trail.every((p, i) => i === 0 || p.n > t.trail[i - 1].n));
  assert.ok(t.trail.length > 50 && t.trail.length < 250);
  close(t.trail.at(-1).swap, t.swapWins / t.games, 1e-12);
  assert.equal(runGames(r, 0, classic, emptyTally()).trail.length, 0);
});

test("margin of error shrinks with the square root of the number of games", () => {
  close(margin(0.5, 100), 0.098, 1e-3);
  close(margin(2 / 3, 100000), 0.00292, 1e-4);
  assert.ok(Number.isNaN(margin(0.5, 0)));
});

test("playing by hand: pick, host opens, then stay or switch", () => {
  const r = rng(21);
  let g = newGame(r, {});
  assert.equal(g.phase, "pick");
  g = choose(g, r, 0);
  assert.equal(g.phase, "decide");
  assert.equal(g.open.length, 1);
  assert.ok(!g.open.includes(g.car) && !g.open.includes(0));
  assert.equal(alternatives(g).length, 1);
  assert.equal(decide(g, g.open[0]), g, "an opened door cannot be chosen");
  const stayed = decide(g, 0);
  const swapped = decide(g, alternatives(g)[0]);
  assert.equal(stayed.strategy, "stay");
  assert.equal(swapped.strategy, "swap");
  assert.notEqual(stayed.result, swapped.result);
  assert.equal(decide(stayed, 1), stayed, "a finished game ignores further clicks");
  assert.equal(choose(g, r, 2), g, "the first pick cannot be changed after the host has opened a door");
});

test("playing by hand against a host who opens at random can end with the car revealed", () => {
  const r = rng(4);
  let voids = 0;
  for (let i = 0; i < 600; i++) {
    const g = choose(newGame(r, { host: "random" }), r, 0);
    if (g.result === "void") { voids++; assert.ok(g.open.includes(g.car)); assert.equal(g.phase, "done"); }
  }
  close(voids / 600, 1 / 3, 0.06);
});
