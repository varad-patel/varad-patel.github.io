// Day 3: Monty Hall Monte Carlo. The game and its simulation, with no DOM code.

/** Settings: doors in the game, how many the host opens, and whether the host knows where the car is. */
export function normalise({ doors = 3, opened = 1, host = "knows" } = {}) {
  const n = Math.min(10, Math.max(3, Math.round(doors)));
  return { doors: n, opened: Math.min(n - 2, Math.max(1, Math.round(opened))), host: host === "random" ? "random" : "knows" };
}

/**
 * Exact win probabilities.
 * A host who knows: staying wins with 1/N; the remaining (N-1)/N is shared by the N-1-m other closed doors.
 * A host who opens at random and happens not to reveal the car: every one of the N-m closed doors is equally likely.
 */
export function theory(config) {
  const { doors: n, opened: m, host } = normalise(config);
  if (host === "random") {
    // Chance that m random doors out of the other N-1 all miss the car: 1/N (car is behind your door) + (N-1)/N * C(N-2, m)/C(N-1, m).
    const valid = 1 / n + ((n - 1) / n) * ((n - 1 - m) / (n - 1));
    return { stay: 1 / (n - m), swap: 1 / (n - m), valid };
  }
  return { stay: 1 / n, swap: (n - 1) / (n * (n - 1 - m)), valid: 1 };
}

/** Which doors the host opens. With host "random" the car may be among them. */
export function hostOpens(r, { doors, opened, host }, car, pick) {
  const pool = [];
  for (let d = 0; d < doors; d++) if (d !== pick && (host === "random" || d !== car)) pool.push(d);
  for (let i = 0; i < opened; i++) {
    const j = i + Math.floor(r() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, opened).sort((a, b) => a - b);
}

/** One simulated game, scored for both strategies. void: the host revealed the car, so the game does not count. */
export function playOnce(r, config) {
  const car = Math.floor(r() * config.doors);
  const pick = Math.floor(r() * config.doors);
  const open = hostOpens(r, config, car, pick);
  if (open.includes(car)) return { void: true, car, pick, open };
  const others = [];
  for (let d = 0; d < config.doors; d++) if (d !== pick && !open.includes(d)) others.push(d);
  const target = others[Math.floor(r() * others.length)];
  return { void: false, car, pick, open, target, stayWins: pick === car, swapWins: target === car };
}

export const emptyTally = () => ({ games: 0, voided: 0, stayWins: 0, swapWins: 0, trail: [], nextMark: 1 });

/** Play n more games into the tally, recording the running win rates at roughly even steps on a log scale. */
export function runGames(r, n, config, tally) {
  for (let i = 0; i < n; i++) {
    const g = playOnce(r, config);
    if (g.void) { tally.voided++; continue; }
    tally.games++;
    if (g.stayWins) tally.stayWins++;
    if (g.swapWins) tally.swapWins++;
    if (tally.games >= tally.nextMark) {
      tally.trail.push({ n: tally.games, stay: tally.stayWins / tally.games, swap: tally.swapWins / tally.games });
      tally.nextMark = Math.max(tally.games + 1, Math.ceil(tally.games * 1.07));
    }
  }
  const last = tally.trail[tally.trail.length - 1];
  if (tally.games && (!last || last.n !== tally.games)) tally.trail.push({ n: tally.games, stay: tally.stayWins / tally.games, swap: tally.swapWins / tally.games });
  return tally;
}

/** Half-width of a 95% interval for a proportion p estimated from n games. */
export const margin = (p, n) => (n > 0 ? 1.96 * Math.sqrt((p * (1 - p)) / n) : NaN);

/* ---------- the game you play by hand ---------- */

/** A new hand-played game: the car is placed, nothing chosen yet. */
export function newGame(r, config) {
  return { config: normalise(config), car: Math.floor(r() * normalise(config).doors), pick: null, open: [], final: null, phase: "pick", result: null };
}

/** First click: choose a door. The host then opens doors. */
export function choose(game, r, door) {
  if (game.phase !== "pick" || door < 0 || door >= game.config.doors) return game;
  const open = hostOpens(r, game.config, game.car, door);
  if (open.includes(game.car)) return { ...game, pick: door, open, phase: "done", result: "void" };
  return { ...game, pick: door, open, phase: "decide" };
}

/** Second click: keep your door or take another closed one. */
export function decide(game, door) {
  if (game.phase !== "decide" || game.open.includes(door) || door < 0 || door >= game.config.doors) return game;
  return { ...game, final: door, phase: "done", result: door === game.car ? "win" : "lose", strategy: door === game.pick ? "stay" : "swap" };
}

/** Closed doors other than the one first picked. */
export const alternatives = (game) => Array.from({ length: game.config.doors }, (_, d) => d).filter((d) => d !== game.pick && !game.open.includes(d));
