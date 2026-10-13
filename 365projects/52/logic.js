// Day 52: Auction Simulator. The model, with no DOM code.
// Independent private values: each bidder's value is drawn on its own, uniformly from 0 to TOP, and only that
// bidder knows it. Bots bid the symmetric Bayes-Nash equilibrium of each format.

import { rng } from "../kit/kit.js";

export const TOP = 100;        // values are uniform on 0 to 100
export const CENT = 100;       // in the live auctions money is held in whole hundredths, so ties are exact
export const MAX_BIDDERS = 8;  // a deal always holds eight values; the first n are used

export const FORMATS = [
  { key: "first", label: "First-price sealed bid", short: "First-price", rule: "Everyone writes down one bid. The highest bid wins and pays that bid." },
  { key: "second", label: "Second-price sealed bid (Vickrey)", short: "Second-price", rule: "Everyone writes down one bid. The highest bid wins and pays the second-highest bid." },
  { key: "english", label: "Ascending clock (English)", short: "English", clock: "up", rule: "The price rises from 0. Bidders drop out one by one, and the last one left wins at the price where the last rival dropped out." },
  { key: "dutch", label: "Descending clock (Dutch)", short: "Dutch", clock: "down", rule: "The price falls from 100. The first bidder to stop the clock wins and pays the price it shows." },
  { key: "allpay", label: "All-pay", short: "All-pay", rule: "Everyone writes down one bid. The highest bid wins, and every bidder pays their own bid, win or lose." },
];
export const formatOf = (key) => FORMATS.find((f) => f.key === key);
/** Formats in which a bidder's plan is one number that wins against lower numbers and pays its own amount. */
const PAY_OWN = new Set(["first", "dutch"]);
const PAY_SECOND = new Set(["second", "english"]);

/* ------------------------------------------------------------------ equilibrium bids */

/**
 * The symmetric equilibrium bid for value v with n bidders, values uniform on 0 to TOP, risk-neutral bidders, no
 * reserve. First-price and Dutch: (n - 1) / n of the value. Second-price and English: the value itself (a dominant
 * strategy). All-pay: (n - 1) / n * v^n / TOP^(n - 1).
 */
export function eqBid(format, v, n) {
  if (PAY_SECOND.has(format)) return v;
  if (PAY_OWN.has(format)) return ((n - 1) / n) * v;
  if (format === "allpay") return ((n - 1) / n) * v * (v / TOP) ** (n - 1);
  throw new Error(`unknown format ${format}`);
}
/** The same in whole hundredths, rounded to the nearest one: what a bot actually bids in the live auctions. */
export const eqBidCents = (format, cents, n) => Math.round(eqBid(format, cents / CENT, n) * CENT);

/**
 * First-price equilibrium bid with a reserve price r and bidders whose utility of winning x is x^alpha
 * (alpha = 1 is risk neutral; a smaller alpha is more risk averse). A bidder with a value below r stays out (null).
 *   b(v) = v - (v^(m+1) - r^(m+1)) / ((m + 1) v^m),   m = (n - 1) / alpha
 * With r = 0 this is v (n - 1) / (n - 1 + alpha), and with alpha = 1 as well it is v (n - 1) / n.
 */
export function firstPriceBid(v, n, reserve = 0, alpha = 1) {
  if (v < reserve) return null;
  if (v <= 0) return 0;
  const m = (n - 1) / alpha;
  return v - (v - reserve * (reserve / v) ** m) / (m + 1);
}

/**
 * Two bidders with values uniform on 0 to topStrong and 0 to topWeak (topStrong >= topWeak), first-price auction.
 * The equilibrium has a closed form (Griesmer, Levitan and Shubik 1967; Krishna 2010, section 4.3): with
 * k = 1 / topWeak^2 - 1 / topStrong^2,
 *   strong bids (sqrt(1 + k v^2) - 1) / (k v),   weak bids (1 - sqrt(1 - k v^2)) / (k v).
 * Both reach the same top bid topStrong * topWeak / (topStrong + topWeak), and both are v / 2 when k = 0.
 */
export function asymmetricBid(v, strong, topStrong, topWeak = TOP) {
  const k = 1 / topWeak ** 2 - 1 / topStrong ** 2;
  if (v <= 0) return 0;
  if (k * v * v < 1e-9) return v / 2;
  return strong ? (Math.sqrt(1 + k * v * v) - 1) / (k * v) : (1 - Math.sqrt(Math.max(0, 1 - k * v * v))) / (k * v);
}

/* ------------------------------------------------------------- what a bid earns on average */

/**
 * Expected payoff of bidding b with value v against n - 1 rivals who bid the equilibrium of the format (values
 * uniform on 0 to TOP, no reserve, risk neutral). Continuous money: the rounding to hundredths is ignored.
 * In the two clock auctions b is the price at which the bidder plans to act.
 */
export function expectedPayoff(format, v, b, n) {
  const k = n - 1;
  b = Math.max(0, b);
  if (PAY_OWN.has(format)) {
    // Rivals bid (n-1)/n of their value, so b beats one of them when that value is below b n / (n - 1).
    const p = Math.min(1, (b * n) / (k * TOP)) ** k;
    return (v - b) * p;
  }
  if (PAY_SECOND.has(format)) {
    // Rivals bid their values. The winner pays the highest of them, whose density is k y^(k-1) / TOP^k.
    const c = Math.min(b, TOP);
    return v * (c / TOP) ** k - (k / n) * c * (c / TOP) ** k;
  }
  if (format === "allpay") {
    // A rival bids below b when its value is below t, where (n-1)/n * t^n / TOP^(n-1) = b.
    const t = Math.min(TOP, ((b * n) / k * TOP ** k) ** (1 / n));
    return v * (t / TOP) ** k - b;
  }
  throw new Error(`unknown format ${format}`);
}
/** Expected payoff of the equilibrium bid itself: v^n / (n TOP^(n-1)) in every format (payoff equivalence). */
export const eqExpectedPayoff = (v, n) => (v * (v / TOP) ** (n - 1)) / n;

/* ------------------------------------------------------------------------ theory: revenue */

/**
 * The seller's expected revenue with n bidders (values uniform on 0 to TOP), reserve r and risk aversion alpha.
 * Returns null where this page has no formula (the all-pay auction with a reserve or with risk-averse bidders).
 *   second-price and English:  TOP (n-1)/(n+1) + r^n / TOP^(n-1) - 2 n r^(n+1) / ((n+1) TOP^n)
 *   first-price and Dutch:     the integral of firstPriceBid over the highest value, in closed form
 */
export function expectedRevenue(format, n, reserve = 0, alpha = 1) {
  const r = reserve, T = TOP;
  if (PAY_SECOND.has(format)) return (T * (n - 1)) / (n + 1) + r * (r / T) ** (n - 1) - ((2 * n) / (n + 1)) * r * (r / T) ** n;
  if (format === "allpay") return r === 0 && alpha === 1 ? (T * (n - 1)) / (n + 1) : null;
  if (PAY_OWN.has(format)) {
    const m = (n - 1) / alpha;
    // Integral of [m/(m+1) x + r^(m+1) x^(-m) / (m+1)] n x^(n-1) / T^n from r to T, with every power taken of a ratio.
    const first = (m / (m + 1)) * (n / (n + 1)) * (T - r * (r / T) ** n);
    if (r === 0) return first;
    // r^(m+1) / T^n * integral of x^(n-1-m) from r to T
    const tail = Math.abs(n - m) < 1e-12 ? r * (r / T) ** n * Math.log(T / r) : (r * ((r / T) ** m - (r / T) ** n)) / (n - m);
    return first + (n / (m + 1)) * tail;
  }
  throw new Error(`unknown format ${format}`);
}

/** Two bidders, values uniform on 0 to topStrong and 0 to topWeak, no reserve, risk neutral. */
export function asymmetricRevenue(format, topStrong, topWeak = TOP) {
  const a = topStrong, b = topWeak;
  if (PAY_SECOND.has(format)) return b / 2 - (b * b) / (6 * a); // the mean of the lower of the two values
  if (PAY_OWN.has(format)) {
    // The winning bid is below x with probability phi1(x) phi2(x) / (a b) = 4 x^2 / ((1 - k^2 x^4) a b), up to the top bid.
    const k = 1 / (b * b) - 1 / (a * a);
    const top = (a * b) / (a + b);
    const s = Math.sqrt(k) * top; // always below 1
    // integral of x^2 / (1 - k^2 x^4) from 0 to top = (atanh(s) - atan(s)) / (2 k^1.5); a series when s is tiny.
    const integral = s < 1e-3 ? top ** 3 / 3 + (k * k * top ** 7) / 7 : (Math.atanh(s) - Math.atan(s)) / (2 * k ** 1.5);
    return top - (4 / (a * b)) * integral;
  }
  return null;
}

/* ---------------------------------------------------------------------- the live auctions */

/**
 * Read a bid typed by the visitor. Returns { cents } or { error } with a sentence that says what to fix.
 * A bid is a number from 0 to TOP with at most two decimal places, written with a point.
 */
export function parseBid(text) {
  const t = String(text ?? "").trim();
  if (t === "") return { error: `Type a bid from 0 to ${TOP}, such as 45 or 45.50.` };
  if (t.length > 12 || !/^(\d+)?(\.\d*)?$/.test(t) || t === ".") {
    if (/^\d+,\d+$/.test(t)) return { error: "Write the bid with a point, not a comma: 45.50." };
    if (/^-/.test(t)) return { error: "A bid cannot be negative. Type a number from 0 to 100." };
    return { error: `A bid must be a plain number from 0 to ${TOP}, such as 45 or 45.50.` };
  }
  if (/\.\d{3,}$/.test(t)) return { error: "Bids are in hundredths: use at most two decimal places." };
  const cents = Math.round(Number(t) * CENT);
  if (!(cents <= TOP * CENT)) return { error: `A bid must be between 0 and ${TOP}: no bidder's value is above ${TOP}.` };
  return { cents };
}

/** The values of one round, in hundredths, and one tie-break number per bidder. Fixed by the seed and the round. */
export function deal(seed, round) {
  const r = rng((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul((round + 1) >>> 0, 0x85ebca6b)) >>> 0);
  r();
  return {
    values: Array.from({ length: MAX_BIDDERS }, () => Math.round(r() * TOP * CENT)),
    tie: Array.from({ length: MAX_BIDDERS }, () => r()),
  };
}

/**
 * Settle one auction. bids are whole hundredths, one per bidder; in the English auction a bid is the price at which
 * the bidder drops out (Infinity: never), in the Dutch auction the price at which it stops the clock (-Infinity:
 * never). Equal highest bids are settled by lot: the smallest tie-break number wins.
 */
export function resolve(format, bids, tie) {
  let top = -Infinity;
  for (const b of bids) if (b > top) top = b;
  const leaders = bids.map((b, i) => (b === top ? i : -1)).filter((i) => i >= 0);
  const winner = leaders.reduce((best, i) => (tie[i] < tie[best] ? i : best), leaders[0]);
  let price;
  if (PAY_SECOND.has(format)) {
    price = -Infinity;
    bids.forEach((b, i) => { if (i !== winner && b > price) price = b; });
  } else price = top;
  const payments = bids.map((b, i) => (format === "allpay" ? b : i === winner ? price : 0));
  return { winner, tied: leaders.length > 1, price, payments, revenue: payments.reduce((s, p) => s + p, 0) };
}

/**
 * One round of the live game. bid is the visitor's bid in hundredths (see resolve for the clock formats).
 * Returns the deal, every bid, the result, the visitor's payoff, and what the equilibrium bid would have earned
 * against the same rivals with the same tie-break numbers.
 */
export function playRound({ format, n, seed, round, bid }) {
  const d = deal(seed, round);
  const values = d.values.slice(0, n), tie = d.tie.slice(0, n);
  const rivalBids = values.slice(1).map((v) => eqBidCents(format, v, n));
  const settle = (mine) => {
    const result = resolve(format, [mine, ...rivalBids], tie);
    return { result, payoff: (result.winner === 0 ? values[0] : 0) - result.payments[0] };
  };
  const mine = settle(bid);
  const eqBidMine = eqBidCents(format, values[0], n);
  const eq = settle(eqBidMine);
  return {
    format, n, seed, round, values, tie, bids: [bid, ...rivalBids],
    result: mine.result, payoff: mine.payoff,
    eqBid: eqBidMine, eqResult: eq.result, eqPayoff: eq.payoff,
  };
}

/** Totals over the rounds played so far (money in hundredths). */
export function summarise(history) {
  const s = { rounds: history.length, wins: 0, payoff: 0, eqPayoff: 0, revenue: 0, ahead: 0, behind: 0, level: 0 };
  for (const h of history) {
    if (h.result.winner === 0) s.wins++;
    s.payoff += h.payoff;
    s.eqPayoff += h.eqPayoff;
    s.revenue += h.result.revenue;
    if (h.payoff > h.eqPayoff) s.ahead++; else if (h.payoff < h.eqPayoff) s.behind++; else s.level++;
  }
  return s;
}

/* ------------------------------------------------------------------- the revenue experiment */

export const LAB_LIMITS = { n: [2, 10], reserve: [0, 90], alpha: [0.2, 1], strongTop: [100, 300], auctions: [100, 200000] };
export const HIST_BINS = 50;

/** Says what is wrong with a set of experiment settings, or returns "". */
export function labProblem(s) {
  if (!["symmetric", "strong"].includes(s.mode)) return "Choose who is bidding.";
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 999999) return "The seed must be a whole number from 0 to 999,999.";
  if (!Number.isInteger(s.auctions) || s.auctions < LAB_LIMITS.auctions[0] || s.auctions > LAB_LIMITS.auctions[1]) return "The number of auctions must be a whole number from 100 to 200,000.";
  if (s.mode === "symmetric") {
    if (!Number.isInteger(s.n) || s.n < 2 || s.n > 10) return "The number of bidders must be a whole number from 2 to 10.";
    if (!(s.reserve >= 0 && s.reserve <= 90)) return "The reserve price must be between 0 and 90.";
    if (!(s.alpha >= 0.2 && s.alpha <= 1)) return "The risk-aversion exponent must be between 0.2 and 1.";
  } else if (!(s.strongTop >= 100 && s.strongTop <= 300)) return "The strong bidder's highest value must be between 100 and 300.";
  return "";
}

/** The formats an experiment covers, with the theoretical expected revenue of each. */
export function labFormats(s) {
  if (s.mode === "strong") return ["first", "dutch", "second", "english"].map((key) => ({ key, theory: asymmetricRevenue(key, s.strongTop) }));
  const keys = s.reserve === 0 && s.alpha === 1 ? ["first", "dutch", "second", "english", "allpay"] : ["first", "dutch", "second", "english"];
  return keys.map((key) => ({ key, theory: expectedRevenue(key, s.n, s.reserve, s.alpha) }));
}

/**
 * A resumable experiment: sim.run(count) adds auctions, sim.summary() reports. Every format is run on the same
 * values, so two formats can be compared auction by auction. Money is continuous here (no rounding).
 */
export function createLab(settings) {
  const problem = labProblem(settings);
  if (problem) throw new Error(problem);
  const s = { ...settings };
  const strong = s.mode === "strong";
  const n = strong ? 2 : s.n;
  const tops = strong ? [s.strongTop, TOP] : new Array(n).fill(TOP);
  const formats = labFormats(s);
  const r = rng(s.seed);
  const acc = Object.fromEntries(formats.map((f) => [f.key, { sum: 0, sumSq: 0, sold: 0, best: 0, surplus: 0, hist: new Array(HIST_BINS).fill(0), over: 0 }]));
  let done = 0, diffSum = 0, diffSq = 0;
  const values = new Array(n), bids = new Array(n);

  const add = (key, revenue, sold, best, surplus) => {
    const a = acc[key];
    if (!a) return;
    a.sum += revenue; a.sumSq += revenue * revenue;
    if (sold) a.sold++;
    if (best) a.best++;
    a.surplus += surplus;
    if (revenue >= TOP) { a.over++; a.hist[HIST_BINS - 1]++; } else a.hist[Math.floor((revenue / TOP) * HIST_BINS)]++;
  };

  function one() {
    let hi = 0, second = -Infinity; // hi: index of the highest value
    for (let i = 0; i < n; i++) { values[i] = r() * tops[i]; if (values[i] > values[hi]) hi = i; }
    for (let i = 0; i < n; i++) if (i !== hi && values[i] > second) second = values[i];

    // Second-price and English: everyone bids their value, so the highest value wins and pays the next one or the reserve.
    let rev2 = 0, sold2 = false;
    if (strong) { rev2 = second; sold2 = true; }
    else if (values[hi] >= s.reserve) { rev2 = Math.max(second, s.reserve); sold2 = true; }
    const surplus2 = sold2 ? values[hi] - rev2 : 0;
    add("second", rev2, sold2, sold2, surplus2);
    add("english", rev2, sold2, sold2, surplus2);

    // First-price and Dutch: the highest bid wins and pays itself.
    let rev1 = 0, sold1 = false, win = -1;
    for (let i = 0; i < n; i++) {
      bids[i] = strong ? asymmetricBid(values[i], i === 0, s.strongTop) : firstPriceBid(values[i], n, s.reserve, s.alpha);
      if (bids[i] != null && (win < 0 || bids[i] > bids[win])) win = i;
    }
    if (win >= 0) { rev1 = bids[win]; sold1 = true; }
    const surplus1 = sold1 ? values[win] - rev1 : 0;
    add("first", rev1, sold1, sold1 && win === hi, surplus1);
    add("dutch", rev1, sold1, sold1 && win === hi, surplus1);

    // All-pay: everyone pays, the highest value wins.
    if (acc.allpay) {
      let total = 0;
      for (let i = 0; i < n; i++) total += eqBid("allpay", values[i], n);
      add("allpay", total, true, true, values[hi] - total);
    }
    const d = rev1 - rev2;
    diffSum += d; diffSq += d * d;
  }

  return {
    settings: s, formats, n,
    get done() { return done; },
    run(count) { for (let i = 0; i < count; i++) one(); done += count; return done; },
    summary() {
      const rows = formats.map((f) => {
        const a = acc[f.key];
        const mean = done ? a.sum / done : NaN;
        const sd = done > 1 ? Math.sqrt(Math.max(0, (a.sumSq - done * mean * mean) / (done - 1))) : NaN;
        const se = sd / Math.sqrt(done);
        return {
          key: f.key, theory: f.theory, mean, sd, se,
          gap: se > 0 ? (mean - f.theory) / se : NaN,
          sold: done ? a.sold / done : NaN,
          best: done ? a.best / done : NaN,
          surplus: done ? a.surplus / done : NaN,
          over: done ? a.over / done : NaN,
          hist: a.hist.map((c, i) => [(i * TOP) / HIST_BINS, ((i + 1) * TOP) / HIST_BINS, done ? c / done : 0]),
        };
      });
      const dMean = done ? diffSum / done : NaN;
      const dSd = done > 1 ? Math.sqrt(Math.max(0, (diffSq - done * dMean * dMean) / (done - 1))) : NaN;
      return { done, rows, diff: { mean: dMean, se: dSd / Math.sqrt(done) } };
    },
  };
}

/**
 * What the theory says for these settings, in exact terms: whether the formats covered share one expected revenue.
 * "equal" compares the formulas to within a rounding error of floating-point arithmetic, not the simulation.
 */
export function labVerdict(s) {
  const formats = labFormats(s);
  const first = formats.find((f) => f.key === "first").theory, second = formats.find((f) => f.key === "second").theory;
  const all = formats.map((f) => f.theory);
  const equal = Math.max(...all) - Math.min(...all) < 1e-9 * TOP;
  const base = s.mode === "strong" ? null : expectedRevenue("second", s.n, 0, 1);
  return { equal, first, second, gap: first - second, base, covers: formats.map((f) => f.key) };
}
