// Day 51: Cartel Stability Simulator. The model, with no DOM code.
//
// n identical firms sell one good for ever. Demand is P = a - b Q and every unit costs c. Each period they either
// keep to an agreement (share the monopoly outcome equally) or compete. A firm that cheats is found out after L
// periods; the others then compete for T periods (T = Infinity is the grim trigger) and afterwards return to the
// agreement. "Competing" is the one-period equilibrium of the chosen game: Bertrand (prices, identical goods, so the
// price falls to cost) or Cournot (quantities). A firm values a profit t periods ahead at delta^t of its face value.

export const MARKET = { a: 100, b: 1, c: 20 };
export const MODES = [
  { key: "bertrand", label: "Bertrand (prices)" },
  { key: "cournot", label: "Cournot (quantities)" },
];
export const LIMITS = { firms: 100, periods: 1000, delta: 0.999 };

const whole = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;

/** A message saying what is wrong with the settings, or "" if they can be used. */
export function problem({ mode, n, delta, T, L, market = MARKET } = {}) {
  if (!MODES.some((m) => m.key === mode)) return "Choose Bertrand or Cournot competition.";
  if (!whole(n, 2, LIMITS.firms)) return `The number of firms must be a whole number from 2 to ${LIMITS.firms}.`;
  if (!(typeof delta === "number" && delta >= 0 && delta <= LIMITS.delta)) return `Patience must be a number from 0 to ${LIMITS.delta}.`;
  if (T !== Infinity && !whole(T, 1, LIMITS.periods)) return `The price war must last a whole number of periods from 1 to ${LIMITS.periods}, or for ever.`;
  if (!whole(L, 1, LIMITS.periods)) return `The detection lag must be a whole number of periods from 1 to ${LIMITS.periods}.`;
  const { a, b, c } = market;
  if (![a, b, c].every(Number.isFinite) || !(b > 0) || !(c >= 0) || !(a > c)) return "Demand must slope down and the highest price buyers will pay must be above the cost.";
  return "";
}
const check = (settings) => { const why = problem(settings); if (why) throw new RangeError(why); };

/**
 * One period's profits for one firm, and the prices and outputs behind them.
 *   collude   every firm keeps to the agreement
 *   deviate   this firm cheats while the others keep to it
 *   cheated   what each of the others earns in such a period
 *   punish    every firm competes
 * `each` is the output per firm that the agreement asks for; the default is an equal share of the monopoly output.
 * A Bertrand cheat charges a shade under the agreed price and serves the whole market: its profit is the limit of that
 * as the shade goes to nothing, which is the whole industry profit at the agreed price.
 */
export function stage(mode, n, market = MARKET, each) {
  const { a, b, c } = market;
  const w = a - c;
  const q = each ?? w / (2 * b * n);
  const price = a - b * n * q;
  const collude = (price - c) * q;
  if (mode === "bertrand") {
    return { collude, deviate: n * collude, cheated: 0, punish: 0, price, cheatPrice: price, warPrice: c, each: q, cheatOutput: n * q, warOutput: w / (b * n) };
  }
  const cheatOutput = Math.max(0, (w - b * (n - 1) * q) / (2 * b));               // best reply to the others' n - 1 shares
  const cheatPrice = a - b * ((n - 1) * q + cheatOutput);
  const warOutput = w / (b * (n + 1));
  const warPrice = a - b * n * warOutput;
  return { collude, deviate: (cheatPrice - c) * cheatOutput, cheated: (cheatPrice - c) * q, punish: (warPrice - c) * warOutput, price, cheatPrice, warPrice, each: q, cheatOutput, warOutput };
}

/**
 * The temptation ratio rho = (deviate - collude) / (collude - punish) for the monopoly agreement, as an exact fraction:
 * n - 1 under Bertrand and (n + 1)^2 / 4n under Cournot. It does not depend on a, b or c.
 */
export const temptation = (mode, n) => (mode === "bertrand" ? { num: n - 1, den: 1 } : { num: (n + 1) ** 2, den: 4 * n });

/**
 * The deterrent h: the weight a cheat's lost future carries against one period's gain. A cheat gains for L periods
 * and loses for the T that follow, so h = delta^L (1 - delta^T) / (1 - delta^L). The agreement holds when h >= rho.
 */
export function deterrent(delta, T, L) {
  if (delta <= 0) return 0;
  const dL = delta ** L;
  return (dL * (T === Infinity ? 1 : 1 - delta ** T)) / (1 - dL);
}

/**
 * The lowest patience at which the monopoly agreement holds, or null if no patience below 1 is enough (the war is too
 * short for the lag: h never passes T / L). Grim trigger has the closed form (rho / (1 + rho))^(1 / L).
 */
export function criticalDelta(mode, n, T = Infinity, L = 1) {
  check({ mode, n, delta: 0, T, L });
  const { num, den } = temptation(mode, n);
  const rho = num / den;
  if (T === Infinity) return (num / (num + den)) ** (1 / L);
  if (T * den <= L * num) return null;
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (deterrent(mid, T, L) >= rho) hi = mid; else lo = mid; }
  return hi;
}

/** Does the agreement hold? "threshold" means the firm is exactly indifferent, which counts as holding. */
export function verdict({ mode, n, delta, T = Infinity, L = 1 }) {
  check({ mode, n, delta, T, L });
  const { num, den } = temptation(mode, n);
  const rho = num / den, h = deterrent(delta, T, L);
  const onEdge = Math.abs(h - rho) <= 1e-9 * rho;
  return { holds: onEdge || h > rho, threshold: onEdge, h, rho, critical: criticalDelta(mode, n, T, L) };
}

/** Discounted profit of one firm from now on, by formula: if it keeps to the agreement, and if it cheats today. */
export function values({ mode, n, delta, T = Infinity, L = 1, market = MARKET }) {
  check({ mode, n, delta, T, L, market });
  const s = stage(mode, n, market);
  const dL = delta ** L, dT = T === Infinity ? 0 : delta ** T;
  const comply = s.collude / (1 - delta);
  const cheat = (s.deviate * (1 - dL) + s.punish * dL * (1 - dT) + s.collude * dL * dT) / (1 - delta);
  return { comply, cheat, gain: cheat - comply, ...s };
}

/**
 * Play the game period by period and add up the discounted profits. With `cheat`, firm 1 breaks the agreement in
 * period 0 and keeps cheating until it is found out L periods later; the war then runs for T periods and the agreement
 * resumes. Every period's price and profits are worked out from that period's prices or outputs, not from the formulas
 * above. `each` sets the agreed output per firm (default: the monopoly share). Returns the first `keep` periods as rows.
 */
export function simulate({ mode, n, delta, T = Infinity, L = 1, market = MARKET, cheat = true, each, periods, keep = 40 }) {
  check({ mode, n, delta, T, L, market });
  const { a, b, c } = market;
  const s = stage(mode, n, market, each);
  // Far enough that what is left out is below one part in 10^13 of the total.
  const horizon = periods ?? (delta <= 0 ? 1 : Math.min(200000, Math.ceil(Math.log(1e-13) / Math.log(delta))));
  const rows = [];
  let cheater = 0, other = 0, weight = 1;
  for (let t = 0; t < horizon; t++) {
    const phase = !cheat ? "agreement" : t < L ? "cheating" : t < L + T ? "war" : "agreement";
    let price, mine, theirs, myOutput, theirOutput;
    if (mode === "bertrand") {
      // Lowest price serves the market; equal prices share it. The cheat's price is a shade under the agreed one.
      const posted = phase === "war" ? c : s.price;
      const sold = Math.max(0, (a - posted) / b);
      price = posted;
      myOutput = phase === "cheating" ? sold : sold / n;
      theirOutput = phase === "cheating" ? 0 : sold / n;
    } else {
      myOutput = phase === "cheating" ? s.cheatOutput : phase === "war" ? s.warOutput : s.each;
      theirOutput = phase === "war" ? s.warOutput : s.each;
      price = Math.max(0, a - b * (myOutput + (n - 1) * theirOutput));
    }
    mine = (price - c) * myOutput;
    theirs = (price - c) * theirOutput;
    cheater += weight * mine;
    other += weight * theirs;
    if (t < keep) rows.push({ t, phase, price, myOutput, theirOutput, mine, theirs });
    weight *= delta;
  }
  return { rows, cheater, other, horizon };
}

/**
 * The most profitable equal-shares agreement that this punishment can hold together. Under Bertrand it is all or
 * nothing: any price up to the monopoly price holds when h >= n - 1, and only price = cost otherwise. Under Cournot
 * the agreed output per firm can be anything from the Cournot output down to x (a - c) / b, where
 *   x = [k (n + 1)^2 + 4 (1 - k)] / [(n + 1) (4 n + k (n - 1)^2)],  k = 1 / (1 + h),
 * or down to the monopoly share if that is larger. `share` is how far profit gets from the competitive level (0) to the
 * monopoly level (1).
 */
export function bestSustainable({ mode, n, delta, T = Infinity, L = 1, market = MARKET }) {
  check({ mode, n, delta, T, L, market });
  const { a, b, c } = market;
  const full = stage(mode, n, market);
  const v = verdict({ mode, n, delta, T, L });
  if (v.holds) return { price: full.price, each: full.each, profit: full.collude, share: 1, full: true };
  if (mode === "bertrand") return { price: c, each: (a - c) / (b * n), profit: 0, share: 0, full: false };
  const k = 1 / (1 + v.h);
  const x = (k * (n + 1) ** 2 + 4 * (1 - k)) / ((n + 1) * (4 * n + k * (n - 1) ** 2));
  const each = (x * (a - c)) / b;
  const s = stage(mode, n, market, each);
  return { price: s.price, each, profit: s.collude, share: Math.max(0, (s.collude - full.punish) / (full.collude - full.punish)), full: false };
}
