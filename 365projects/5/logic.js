// Day 5: Zeno's Series Calculator. The model, with no DOM code.
// Achilles starts at 0 and runs at vA. The tortoise starts d ahead and runs at vT in the same direction.
// Zeno's stage k is the run that takes Achilles to where the tortoise was when stage k began.

/** A sentence saying what is wrong with the inputs, or null when they are usable. */
export function problem({ headStart, achilles, tortoise } = {}) {
  if (![headStart, achilles, tortoise].every((v) => typeof v === "number" && Number.isFinite(v))) return "The head start and both speeds must be numbers.";
  if (headStart <= 0) return "The head start must be more than zero.";
  if (achilles <= 0) return "Achilles' speed must be more than zero.";
  if (tortoise < 0) return "The tortoise's speed cannot be negative.";
  return null;
}

/**
 * The chase as a whole. r = vT / vA is the ratio of each stage to the one before.
 * When Achilles is faster he draws level at catchTime = d / (vA - vT), having run catchPoint = d / (1 - r).
 */
export function chase(inputs) {
  const error = problem(inputs);
  if (error) return { error };
  const { headStart: d, achilles: vA, tortoise: vT } = inputs;
  const catches = vA > vT;
  const catchTime = catches ? d / (vA - vT) : Infinity;
  return { d, vA, vT, r: vT / vA, catches, catchTime, catchPoint: catches ? vA * catchTime : Infinity };
}

/** 1 + r + r^2 + ... + r^(k-1), the sum of the first k terms. */
export function geometricSum(r, k) {
  if (k <= 0) return 0;
  return r === 1 ? k : (1 - r ** k) / (1 - r);
}

/**
 * Stage k (k = 1, 2, 3, ...).
 *   leg, legTime    what this stage adds
 *   distance, time  the partial sums: where Achilles is, and when, at the end of the stage
 *   tortoise        where the tortoise is at that moment
 *   gap             the tortoise's lead at that moment, d r^k
 *   short           how far Achilles still is from the catch-up point (Infinity if there is none)
 */
export function stage(c, k) {
  const { d, vA, r } = c;
  const leg = d * r ** (k - 1);
  const distance = d * geometricSum(r, k);
  return {
    k, leg, legTime: leg / vA, distance, time: distance / vA,
    tortoise: d * geometricSum(r, k + 1),
    gap: d * r ** k,
    short: c.catches ? c.catchPoint * r ** k : Infinity,
    shortTime: c.catches ? c.catchTime * r ** k : Infinity,
  };
}

export const stages = (c, n) => Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => stage(c, i + 1));

/** Where both runners are at time t. */
export function positions(c, t) {
  return { achilles: c.vA * t, tortoise: c.d + c.vT * t, gap: c.d + (c.vT - c.vA) * t };
}

/**
 * How many of Zeno's stages are complete at time t. Infinity once Achilles is level or ahead:
 * every one of the stages ends before the catch-up time.
 */
export function stagesCompleted(c, t) {
  if (!(t > 0)) return 0;
  const { d, vA, r } = c;
  const x = (vA * t) / d;                    // distance run, counted in head starts
  if (r === 1) return Math.floor(x + 1e-9);
  const u = 1 - x * (1 - r);                 // stage k is complete when r^k has reached u
  if (u <= 0) return Infinity;
  return Math.floor(Math.log(u) / Math.log(r) + 1e-9);
}

/** The first stage after which the tortoise's lead is below eps. Infinity if the lead never shrinks that far. */
export function stagesUntilGap(c, eps) {
  const { d, r } = c;
  if (!(eps > 0)) return Infinity;
  if (d < eps) return 0;
  if (r >= 1) return Infinity;
  if (r === 0) return 1;
  let k = Math.max(1, Math.ceil(Math.log(eps / d) / Math.log(r)));
  while (d * r ** k >= eps) k++;
  while (k > 1 && d * r ** (k - 1) < eps) k--;
  return k;
}

/**
 * The last stage whose partial sum a 64-bit float can tell apart from the limit (r^k at least 2^-53).
 * Past it the arithmetic of this page says Achilles has arrived although the mathematics says he has not.
 */
export function resolvableStages(c) {
  if (!c.catches) return Infinity;
  if (c.r === 0) return 1;
  return Math.floor(Math.log(2 ** -53) / Math.log(c.r) + 1e-9);
}
