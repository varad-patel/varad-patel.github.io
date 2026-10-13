import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  TOP, CENT, MAX_BIDDERS, FORMATS, formatOf, eqBid, eqBidCents, firstPriceBid, asymmetricBid, expectedPayoff, eqExpectedPayoff,
  expectedRevenue, asymmetricRevenue, parseBid, deal, resolve, playRound, summarise, labProblem, labFormats, createLab, labVerdict, HIST_BINS,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const KEYS = FORMATS.map((f) => f.key);
/** Simpson's rule, written here so that the formulas in logic.js are checked against something else. */
function simpson(f, a, b, steps = 4000) {
  const h = (b - a) / steps;
  let s = f(a) + f(b);
  for (let i = 1; i < steps; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}
const argmax = (f, lo, hi, step) => { let best = lo, top = -Infinity; for (let x = lo; x <= hi + 1e-12; x += step) { const y = f(x); if (y > top + 1e-12) { top = y; best = x; } } return best; };

/* ------------------------------------------------------------------ equilibrium bids */

test("equilibrium bids, by hand: four bidders and a value of 80", () => {
  close(eqBid("first", 80, 4), 60);
  close(eqBid("dutch", 80, 4), 60);
  close(eqBid("second", 80, 4), 80);
  close(eqBid("english", 80, 4), 80);
  close(eqBid("allpay", 80, 4), 0.75 * 80 * 0.8 ** 3); // 30.72
  close(eqBid("allpay", 80, 4), 30.72);
  close(eqBid("first", 50, 2), 25);
  close(eqBid("allpay", 100, 2), 50);
  assert.equal(eqBidCents("first", 5000, 3), 3333);
  assert.equal(eqBidCents("allpay", 8000, 4), 3072);
  assert.throws(() => eqBid("nonsense", 1, 2));
});

test("the equilibrium bid is the best reply to rivals who bid the equilibrium, in every format", () => {
  for (const key of KEYS) for (const n of [2, 3, 4, 8]) for (const v of [10, 37.5, 62.4, 95]) {
    const best = argmax((b) => expectedPayoff(key, v, b, n), 0, 100, 0.01);
    close(best, eqBid(key, v, n), 0.011);
    // and nothing on the grid does better than the equilibrium bid itself
    assert.ok(expectedPayoff(key, v, best, n) <= expectedPayoff(key, v, eqBid(key, v, n), n) + 1e-9);
  }
});

test("every format gives the same expected payoff in equilibrium: v^n / (n TOP^(n-1))", () => {
  for (const key of KEYS) for (const n of [2, 4, 7]) for (const v of [0, 20, 62.4, 100]) {
    close(expectedPayoff(key, v, eqBid(key, v, n), n), eqExpectedPayoff(v, n), 1e-9);
  }
  close(eqExpectedPayoff(80, 4), 80 ** 4 / (4 * 100 ** 3)); // 10.24
  close(eqExpectedPayoff(80, 4), 10.24);
});

test("expected payoff of a bid, by hand", () => {
  // First-price, two bidders, value 80, bid 30: the rival bids half its value, so 30 beats values below 60: (80 - 30) * 0.6
  close(expectedPayoff("first", 80, 30, 2), 30);
  // Bidding more than any rival ever bids wins for certain: three rivals bid at most 75.
  close(expectedPayoff("first", 90, 80, 4), 10);
  close(expectedPayoff("dutch", 90, 80, 4), 10);
  // Second-price, two bidders, value 80, bid 50: win when the rival's value is below 50, pay it. 80 * 0.5 - 0.5 * 25
  close(expectedPayoff("second", 80, 50, 2), 27.5);
  // Bidding above the value in a second-price auction loses money on average compared with bidding the value.
  assert.ok(expectedPayoff("second", 50, 90, 3) < expectedPayoff("second", 50, 50, 3));
  // All-pay, two bidders, value 80, bid 18: a rival bids v^2 / 200, which is below 18 when v < 60. 80 * 0.6 - 18
  close(expectedPayoff("allpay", 80, 18, 2), 30);
  // A bid of zero never wins against a rival and costs nothing.
  for (const key of KEYS) close(expectedPayoff(key, 70, 0, 3), 0);
  // A negative bid is treated as zero.
  close(expectedPayoff("first", 70, -5, 3), 0);
});

test("first-price bids with a reserve and with risk-averse bidders", () => {
  close(firstPriceBid(80, 4), 60);
  close(firstPriceBid(80, 2, 0, 0.5), 80 / 1.5);           // v (n-1) / (n-1+alpha)
  close(firstPriceBid(80, 4, 0, 0.5), (80 * 3) / 3.5);
  close(firstPriceBid(50, 3, 50), 50);                     // at the reserve, bid the reserve
  assert.equal(firstPriceBid(49.99, 3, 50), null);         // below it, stay out
  close(firstPriceBid(80, 2, 40), 80 / 2 + 40 ** 2 / (2 * 80)); // v (n-1)/n + r^n / (n v^(n-1)) = 50
  close(firstPriceBid(80, 2, 40), 50);
  close(firstPriceBid(0, 3), 0);
  // More risk aversion means higher bids; a reserve means higher bids.
  assert.ok(firstPriceBid(70, 3, 0, 0.3) > firstPriceBid(70, 3, 0, 0.6));
  assert.ok(firstPriceBid(70, 3, 30) > firstPriceBid(70, 3, 0));
  assert.ok(firstPriceBid(70, 3, 30, 0.5) < 70);
});

test("the first-price bid with a reserve and risk aversion is a best reply to itself", () => {
  // A bidder with value v who bids as if its value were z wins when the others' values are below z (or below the reserve).
  for (const [n, r, alpha, v] of [[3, 20, 0.5, 70], [2, 0, 0.4, 55], [5, 40, 1, 90], [2, 30, 0.5, 64]]) {
    const utility = (z) => (z / TOP) ** (n - 1) * Math.max(0, v - firstPriceBid(z, n, r, alpha)) ** alpha;
    close(argmax(utility, Math.max(r, 0.5), 100, 0.05), v, 0.051);
  }
});

/* ------------------------------------------------------------------------ theory: revenue */

test("expected revenue, known results", () => {
  for (const key of KEYS) close(expectedRevenue(key, 4), 60);       // TOP (n-1)/(n+1)
  for (const key of KEYS) close(expectedRevenue(key, 2), 100 / 3);
  // Two bidders and the best reserve, half the top value: 5/12 of the top value (Riley and Samuelson; Myerson).
  close(expectedRevenue("second", 2, 50), (100 * 5) / 12);
  close(expectedRevenue("first", 2, 50), (100 * 5) / 12);
  close(expectedRevenue("english", 2, 50), 41.666666666666664, 1e-9);
  // Risk-averse bidders: first-price revenue is TOP * n/(n+1) * (n-1)/(n-1+alpha); second-price does not move.
  close(expectedRevenue("first", 2, 0, 0.5), ((100 * 2) / 3) * (1 / 1.5));
  close(expectedRevenue("second", 2, 0, 0.5), 100 / 3);
  close(expectedRevenue("first", 4, 0, 0.5), 80 * (3 / 3.5));
  // No formula is offered for the all-pay auction off the textbook case.
  assert.equal(expectedRevenue("allpay", 4, 10), null);
  assert.equal(expectedRevenue("allpay", 4, 0, 0.5), null);
});

test("a reserve never breaks the equality of first-price and second-price revenue, and half the top value is the best reserve", () => {
  for (let n = 2; n <= 10; n++) {
    for (const r of [0, 1, 25, 50, 75, 90]) close(expectedRevenue("first", n, r), expectedRevenue("second", n, r), 1e-9);
    const best = argmax((r) => expectedRevenue("second", n, r), 0, 90, 0.5);
    close(best, 50);
  }
});

test("first-price revenue matches a numerical integral of the bid over the highest value", () => {
  // n = 2 with alpha = 0.5 and n = 3 with alpha = 2/3 are the cases where the closed form needs a logarithm (m = n).
  for (const [n, r, alpha] of [[2, 30, 0.5], [3, 45, 2 / 3], [2, 0, 0.5], [4, 20, 1], [6, 60, 0.35], [10, 90, 0.2], [3, 10, 0.9]]) {
    const numeric = simpson((x) => firstPriceBid(x, n, r, alpha) * n * (x / TOP) ** (n - 1) / TOP, Math.max(r, 1e-9), TOP);
    close(expectedRevenue("first", n, r, alpha), numeric, 1e-6);
    close(expectedRevenue("dutch", n, r, alpha), numeric, 1e-6);
  }
});

test("second-price revenue with a reserve matches a numerical integral", () => {
  // Revenue is max(second-highest value, r) when the highest value is at least r.
  for (const [n, r] of [[2, 50], [3, 20], [5, 70]]) {
    // P(sold and price <= p) for p >= r: the second-highest is below p and the highest is at least r.
    const F = (x) => x / TOP;
    const cdf2 = (p) => F(p) ** n + n * F(p) ** (n - 1) * (1 - F(p)); // second-highest value at most p
    const sold = 1 - F(r) ** n;
    // E[price; sold] = r * P(second <= r, highest >= r) + integral over p > r of p d(cdf2)
    const atReserve = n * F(r) ** (n - 1) * (1 - F(r));
    const above = simpson((p) => p * n * (n - 1) * F(p) ** (n - 2) * (1 - F(p)) / TOP, r, TOP);
    close(expectedRevenue("second", n, r), r * atReserve + above, 1e-6);
    assert.ok(sold > 0 && cdf2(TOP) === 1);
  }
});

test("more risk aversion raises first-price revenue above second-price revenue", () => {
  for (const n of [2, 4, 10]) {
    let last = expectedRevenue("second", n);
    for (const alpha of [1, 0.8, 0.5, 0.2]) {
      const now = expectedRevenue("first", n, 0, alpha);
      assert.ok(now >= last - 1e-12);
      last = now;
    }
    assert.ok(expectedRevenue("first", n, 0, 0.2) > expectedRevenue("second", n, 0, 0.2) + 1);
  }
});

/* ------------------------------------------------------------------------ asymmetric bidders */

test("one strong bidder: both bid functions are best replies to each other", () => {
  const a = 200, b = 100;
  const top = (a * b) / (a + b);
  close(asymmetricBid(a, true, a), top, 1e-9);
  close(asymmetricBid(b, false, a), top, 1e-9);
  close(top, 200 / 3, 1e-9);
  // Probability that the other bidder's bid is below x, found by bisection on its bid function.
  const below = (x, strongOther) => {
    const hi = strongOther ? a : b;
    if (x >= top) return 1;
    let lo = 0, up = hi;
    for (let i = 0; i < 60; i++) { const mid = (lo + up) / 2; if (asymmetricBid(mid, strongOther, a) < x) lo = mid; else up = mid; }
    return lo / hi;
  };
  for (const v of [30, 90, 150, 200]) close(argmax((x) => (v - x) * below(x, false), 0, top, 0.01), asymmetricBid(v, true, a), 0.011);
  for (const v of [20, 50, 80, 100]) close(argmax((x) => (v - x) * below(x, true), 0, top, 0.01), asymmetricBid(v, false, a), 0.011);
  // The weak bidder bids more than the strong one for the same value.
  for (const v of [10, 50, 100]) assert.ok(asymmetricBid(v, false, a) > asymmetricBid(v, true, a));
  // Equal bidders: both bid half their value.
  close(asymmetricBid(60, true, 100), 30);
  close(asymmetricBid(60, false, 100), 30);
});

test("one strong bidder: revenue formulas against known results and a numerical integral", () => {
  close(asymmetricRevenue("second", 100), 100 / 3);
  close(asymmetricRevenue("first", 100), 100 / 3, 1e-9);
  close(asymmetricRevenue("second", 200), 50 - 10000 / 1200); // 41.666...
  for (const a of [100.5, 120, 200, 300]) {
    // E[max of the two bids] by integrating over both values on a grid (midpoint rule).
    const N = 600;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const b1 = asymmetricBid(((i + 0.5) / N) * a, true, a);
      for (let j = 0; j < N; j++) s += Math.max(b1, asymmetricBid(((j + 0.5) / N) * 100, false, a));
    }
    close(asymmetricRevenue("first", a), s / (N * N), 0.01);
    close(asymmetricRevenue("dutch", a), asymmetricRevenue("first", a));
    // The mean of the lower value, by the same grid.
    let m = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) m += Math.min(((i + 0.5) / N) * a, ((j + 0.5) / N) * 100);
    close(asymmetricRevenue("english", a), m / (N * N), 0.01);
  }
  // With a strong bidder the first-price auction raises more than the second-price auction.
  for (const a of [110, 150, 200, 300]) assert.ok(asymmetricRevenue("first", a) > asymmetricRevenue("second", a));
  assert.equal(asymmetricRevenue("allpay", 200), null);
});

/* ---------------------------------------------------------------------- the live auctions */

test("a deal is fixed by the seed and the round, and values are whole hundredths from 0 to 100", () => {
  assert.deepEqual(deal(52, 1), deal(52, 1));
  assert.notDeepEqual(deal(52, 1).values, deal(52, 2).values);
  assert.notDeepEqual(deal(52, 1).values, deal(53, 1).values);
  let sum = 0, count = 0;
  for (let round = 1; round <= 2000; round++) {
    const d = deal(7, round);
    assert.equal(d.values.length, MAX_BIDDERS);
    assert.equal(d.tie.length, MAX_BIDDERS);
    for (const v of d.values) { assert.ok(Number.isInteger(v) && v >= 0 && v <= TOP * CENT); sum += v; count++; }
  }
  close(sum / count, 5000, 60);
});

test("settling an auction, by hand, in every format", () => {
  const tie = [0.5, 0.1, 0.9, 0.3];
  const bids = [6000, 4500, 7000, 2000];
  assert.deepEqual(resolve("first", bids, tie), { winner: 2, tied: false, price: 7000, payments: [0, 0, 7000, 0], revenue: 7000 });
  assert.deepEqual(resolve("dutch", bids, tie), { winner: 2, tied: false, price: 7000, payments: [0, 0, 7000, 0], revenue: 7000 });
  assert.deepEqual(resolve("second", bids, tie), { winner: 2, tied: false, price: 6000, payments: [0, 0, 6000, 0], revenue: 6000 });
  assert.deepEqual(resolve("english", bids, tie), { winner: 2, tied: false, price: 6000, payments: [0, 0, 6000, 0], revenue: 6000 });
  assert.deepEqual(resolve("allpay", bids, tie), { winner: 2, tied: false, price: 7000, payments: bids, revenue: 19500 });
});

test("ties are settled by the smallest tie-break number, and a tie in a second-price auction is paid at the tied bid", () => {
  const tie = [0.5, 0.1, 0.9];
  const first = resolve("first", [5000, 5000, 1000], tie);
  assert.equal(first.winner, 1);
  assert.equal(first.tied, true);
  assert.equal(first.price, 5000);
  const second = resolve("second", [5000, 5000, 1000], tie);
  assert.equal(second.winner, 1);
  assert.equal(second.price, 5000);
  assert.equal(resolve("second", [5000, 5000, 1000], [0.05, 0.1, 0.9]).winner, 0);
  // Everyone bids zero: someone still wins, at zero.
  const zero = resolve("first", [0, 0], [0.7, 0.2]);
  assert.deepEqual([zero.winner, zero.price, zero.revenue, zero.tied], [1, 0, 0, true]);
});

test("the clock auctions: staying in for ever wins the English auction, never stopping the clock loses the Dutch one", () => {
  const tie = [0.5, 0.1, 0.9];
  const up = resolve("english", [Infinity, 6200, 4000], tie);
  assert.deepEqual([up.winner, up.price, up.revenue], [0, 6200, 6200]);
  // Dropping out at 5000 with rivals who leave at 6200 and 4000: the rival wins and pays where the visitor left.
  const out = resolve("english", [5000, 6200, 4000], tie);
  assert.deepEqual([out.winner, out.price], [1, 5000]);
  // Dropping out first: the price is where the second rival left.
  assert.equal(resolve("english", [1000, 6200, 4000], tie).price, 4000);
  const down = resolve("dutch", [-Infinity, 4650, 3000], tie);
  assert.deepEqual([down.winner, down.price, down.payments[0]], [1, 4650, 0]);
});

test("a round of the live game: the bots bid the equilibrium and the counterfactual uses the same deal", () => {
  const h = playRound({ format: "first", n: 4, seed: 52, round: 1, bid: 0 });
  assert.equal(h.values.length, 4);
  assert.deepEqual(h.values, deal(52, 1).values.slice(0, 4));
  for (let i = 1; i < 4; i++) assert.equal(h.bids[i], Math.round(h.values[i] * 0.75));
  assert.equal(h.eqBid, Math.round(h.values[0] * 0.75));
  // The same round with the equilibrium bid typed in gives exactly the counterfactual.
  const again = playRound({ format: "first", n: 4, seed: 52, round: 1, bid: h.eqBid });
  assert.equal(again.payoff, h.eqPayoff);
  assert.deepEqual(again.result, h.eqResult);
  // Payoff arithmetic: the winner gets its value less the price, a loser gets nothing (or pays in the all-pay auction).
  const top = playRound({ format: "first", n: 4, seed: 52, round: 1, bid: 10000 });
  assert.equal(top.result.winner, 0);
  assert.equal(top.payoff, top.values[0] - 10000);
  const pay = playRound({ format: "allpay", n: 4, seed: 52, round: 1, bid: 1 });
  if (pay.result.winner !== 0) assert.equal(pay.payoff, -1);
});

test("second-price and English: bidding the value is never beaten on any deal (a dominant strategy)", () => {
  const r = rng(11);
  let worse = 0;
  for (const format of ["second", "english"]) for (let round = 1; round <= 3000; round++) {
    const n = r.int(2, 8);
    const bid = r.int(0, 10000);
    const h = playRound({ format, n, seed: 99, round, bid });
    assert.ok(h.eqPayoff >= h.payoff, `round ${round}: ${h.payoff} beat ${h.eqPayoff}`);
    assert.ok(h.eqPayoff >= 0);
    if (h.eqPayoff > h.payoff) worse++;
  }
  assert.ok(worse > 100); // and other bids really are worse on some deals
});

test("first-price: another bid can beat the equilibrium bid on one deal, but not on average", () => {
  let lucky = 0, mine = 0, eq = 0;
  for (let round = 1; round <= 20000; round++) {
    // Shade far more than the equilibrium says: bid half the value with four bidders.
    const value = deal(5, round).values[0];
    const h = playRound({ format: "first", n: 4, seed: 5, round, bid: Math.round(value / 2) });
    if (h.payoff > h.eqPayoff) lucky++;
    mine += h.payoff; eq += h.eqPayoff;
  }
  assert.ok(lucky > 500);
  assert.ok(eq > mine * 1.2);
  // Theory for the same comparison: the average over values of the two expected payoffs.
  const avg = (f) => simpson(f, 0, 100) / 100;
  const theoryEq = avg((v) => eqExpectedPayoff(v, 4));
  const theoryHalf = avg((v) => expectedPayoff("first", v, v / 2, 4));
  close(theoryEq, 5, 1e-6);                 // TOP / (n (n + 1))
  close(eq / 20000 / CENT, theoryEq, 0.2);
  close(mine / 20000 / CENT, theoryHalf, 0.2);
});

test("totals over a session", () => {
  const history = [1, 2, 3, 4, 5].map((round) => playRound({ format: "second", n: 3, seed: 1, round, bid: 0 }));
  const s = summarise(history);
  assert.equal(s.rounds, 5);
  assert.equal(s.payoff, 0);
  assert.equal(s.wins, history.filter((h) => h.result.winner === 0).length);
  assert.equal(s.eqPayoff, history.reduce((t, h) => t + h.eqPayoff, 0));
  assert.equal(s.ahead + s.behind + s.level, 5);
  assert.equal(s.ahead, 0);
  assert.deepEqual(summarise([]), { rounds: 0, wins: 0, payoff: 0, eqPayoff: 0, revenue: 0, ahead: 0, behind: 0, level: 0 });
});

/* ------------------------------------------------------------------- the revenue experiment */

const BASE = { mode: "symmetric", n: 4, reserve: 0, alpha: 1, strongTop: 200, seed: 52, auctions: 10000 };

test("experiment settings are checked", () => {
  assert.equal(labProblem(BASE), "");
  assert.match(labProblem({ ...BASE, n: 1 }), /bidders/);
  assert.match(labProblem({ ...BASE, n: 2.5 }), /bidders/);
  assert.match(labProblem({ ...BASE, reserve: 95 }), /reserve/);
  assert.match(labProblem({ ...BASE, reserve: NaN }), /reserve/);
  assert.match(labProblem({ ...BASE, alpha: 0 }), /exponent/);
  assert.match(labProblem({ ...BASE, seed: -1 }), /seed/);
  assert.match(labProblem({ ...BASE, seed: 1e308 }), /seed/);
  assert.match(labProblem({ ...BASE, auctions: 1e9 }), /auctions/);
  assert.match(labProblem({ ...BASE, auctions: 50 }), /auctions/);
  assert.match(labProblem({ ...BASE, mode: "strong", strongTop: 400 }), /strong/);
  assert.match(labProblem({ ...BASE, mode: "x" }), /Choose/);
  assert.throws(() => createLab({ ...BASE, n: 99 }));
});

test("the experiment is reproducible, and running it in slices changes nothing", () => {
  const a = createLab(BASE); a.run(10000);
  const b = createLab(BASE); for (let i = 0; i < 20; i++) b.run(500);
  assert.deepEqual(a.summary(), b.summary());
  const c = createLab({ ...BASE, seed: 53 }); c.run(10000);
  assert.notEqual(c.summary().rows[0].mean, a.summary().rows[0].mean);
  assert.equal(createLab(BASE).summary().done, 0);
});

test("the finding: 10,000 auctions with four bidders, seed 52", () => {
  const lab = createLab(BASE);
  lab.run(10000);
  const s = lab.summary();
  const row = Object.fromEntries(s.rows.map((r) => [r.key, r]));
  assert.deepEqual(s.rows.map((r) => r.key), ["first", "dutch", "second", "english", "allpay"]);
  for (const r of s.rows) { close(r.theory, 60); assert.ok(Math.abs(r.gap) < 2, `${r.key} is ${r.gap} standard errors from theory`); }
  // The two pairs are the same auction by auction, not only on average.
  assert.equal(row.dutch.mean, row.first.mean);
  assert.equal(row.english.mean, row.second.mean);
  // The numbers quoted on the page.
  assert.equal(row.first.mean.toFixed(2), FINDING.first);
  assert.equal(row.second.mean.toFixed(2), FINDING.second);
  assert.equal(row.allpay.mean.toFixed(2), FINDING.allpay);
  assert.equal(row.first.sd.toFixed(1), FINDING.sdFirst);
  assert.equal(row.second.sd.toFixed(1), FINDING.sdSecond);
  assert.equal(row.allpay.sd.toFixed(1), FINDING.sdAllpay);
  // Theory for the spread: first-price revenue is 3/4 of the highest of four values, second-price the second-highest.
  close(row.first.sd, 0.75 * Math.sqrt((4 * 100 ** 2) / (25 * 6)), 0.3);
  close(row.second.sd, Math.sqrt((3 * 2 * 100 ** 2) / (25 * 6)), 0.3);
  for (const r of s.rows) { close(r.sold, 1); close(r.best, 1); close(r.surplus + r.mean, 80, 0.5); }
  const v = labVerdict(BASE);
  assert.equal(v.equal, true);
  close(v.first, 60); close(v.gap, 0);
});
const FINDING = { first: "60.09", second: "59.96", allpay: "60.20", sdFirst: "12.2", sdSecond: "20.1", sdAllpay: "40.1" };

test("histograms hold every auction, and the all-pay overflow is counted", () => {
  const lab = createLab(BASE); lab.run(5000);
  for (const r of lab.summary().rows) {
    assert.equal(r.hist.length, HIST_BINS);
    close(r.hist.reduce((t, h) => t + h[2], 0), 1, 1e-9);
    if (r.key !== "allpay") assert.equal(r.over, 0); else assert.ok(r.over > 0 && r.over < 0.2);
  }
});

test("a reserve price: the formats still agree, and fewer auctions end in a sale", () => {
  const s = { ...BASE, reserve: 50, auctions: 40000 };
  const lab = createLab(s); lab.run(s.auctions);
  const sum = lab.summary();
  assert.deepEqual(sum.rows.map((r) => r.key), ["first", "dutch", "second", "english"]);
  const theory = expectedRevenue("second", 4, 50);
  close(theory, 60 + 50 * 0.5 ** 3 - (8 / 5) * 50 * 0.5 ** 4, 1e-9); // 61.25
  for (const r of sum.rows) { close(r.theory, theory, 1e-9); assert.ok(Math.abs(r.gap) < 3); close(r.sold, 1 - 0.5 ** 4, 0.01); }
  assert.ok(Math.abs(sum.diff.mean) < 3 * sum.diff.se);
  const v = labVerdict(s);
  assert.equal(v.equal, true);
  close(v.base, 60);
});

test("risk-averse bidders: the first-price auction raises more, as the formula says", () => {
  const s = { ...BASE, alpha: 0.5, auctions: 40000 };
  const lab = createLab(s); lab.run(s.auctions);
  const sum = lab.summary();
  const row = Object.fromEntries(sum.rows.map((r) => [r.key, r]));
  close(row.first.theory, 80 * (3 / 3.5), 1e-9);
  close(row.second.theory, 60, 1e-9);
  for (const r of sum.rows) assert.ok(Math.abs(r.gap) < 3, `${r.key}: ${r.gap}`);
  assert.ok(sum.diff.mean > 20 * sum.diff.se);
  const v = labVerdict(s);
  assert.equal(v.equal, false);
  close(v.gap, 80 * (3 / 3.5) - 60, 1e-9);
  assert.equal(labFormats(s).some((f) => f.key === "allpay"), false);
});

test("one strong bidder: the first-price auction raises more and sometimes sells to the lower value", () => {
  const s = { ...BASE, mode: "strong", strongTop: 200, auctions: 40000 };
  const lab = createLab(s); lab.run(s.auctions);
  const sum = lab.summary();
  const row = Object.fromEntries(sum.rows.map((r) => [r.key, r]));
  assert.equal(lab.n, 2);
  for (const r of sum.rows) assert.ok(Math.abs(r.gap) < 3, `${r.key}: ${r.gap}`);
  assert.ok(row.first.theory > row.second.theory);
  close(row.second.best, 1);
  assert.ok(row.first.best < 0.97 && row.first.best > 0.8);
  assert.equal(labVerdict(s).equal, false);
  // With a strong bidder no stronger than the weak one, the formats agree again.
  assert.equal(labVerdict({ ...s, strongTop: 100 }).equal, true);
});

test("a typed bid is read strictly, and every refusal says what to fix", () => {
  assert.deepEqual(parseBid("45"), { cents: 4500 });
  assert.deepEqual(parseBid(" 45.5 "), { cents: 4550 });
  assert.deepEqual(parseBid("0"), { cents: 0 });
  assert.deepEqual(parseBid("100"), { cents: 10000 });
  assert.deepEqual(parseBid("100.00"), { cents: 10000 });
  assert.deepEqual(parseBid(".5"), { cents: 50 });
  assert.deepEqual(parseBid("33.33"), { cents: 3333 });
  assert.deepEqual(parseBid("0.07"), { cents: 7 });
  assert.match(parseBid("").error, /Type a bid/);
  assert.match(parseBid("   ").error, /Type a bid/);
  assert.match(parseBid(null).error, /Type a bid/);
  assert.match(parseBid("abc").error, /plain number/);
  assert.match(parseBid("1e2").error, /plain number/);
  assert.match(parseBid(".").error, /plain number/);
  assert.match(parseBid("-5").error, /negative/);
  assert.match(parseBid("45,50").error, /point/);
  assert.match(parseBid("45.123").error, /two decimal/);
  assert.match(parseBid("100.01").error, /between 0 and 100/);
  assert.match(parseBid("1000").error, /between 0 and 100/);
  assert.match(parseBid("9".repeat(300)).error, /plain number/);
  assert.match(parseBid("NaN").error, /plain number/);
  assert.match(parseBid("Infinity").error, /plain number/);
});

test("format lookup", () => {
  assert.equal(formatOf("dutch").clock, "down");
  assert.equal(formatOf("nope"), undefined);
  assert.equal(FORMATS.length, 5);
});
