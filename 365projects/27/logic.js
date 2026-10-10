// Day 27: Raven Paradox Evidence Meter. The model, with no DOM code.
//
// A world is four counts: black ravens (br), non-black ravens (nr), black non-ravens (bn) and
// non-black non-ravens (nn). The hypothesis H, "all ravens are black", is a world with nr = 0.
// The rival is a world in which some ravens are not black. An observation is one object, found by
// a stated sampling procedure. Its evidential weight is how much likelier it is in one world than the other.

export const MAX_COUNT = 1e9;

/** The four kinds of object. "White" stands for any colour but black, "shoe" for anything but a raven. */
export const KINDS = [
  { key: "br", name: "a black raven", label: "Black raven", formal: "black raven" },
  { key: "nr", name: "a white raven", label: "White raven", formal: "non-black raven" },
  { key: "bn", name: "a black shoe", label: "Black shoe", formal: "black non-raven" },
  { key: "nn", name: "a white shoe", label: "White shoe", formal: "non-black non-raven" },
];

/** Sampling procedures: the pool the object is drawn from, uniformly at random. */
export const PROCEDURES = [
  { key: "raven", pool: ["br", "nr"], from: "the ravens", phrase: "found by picking a raven and checking its colour" },
  { key: "nonblack", pool: ["nr", "nn"], from: "the non-black things", phrase: "found by picking a non-black thing and checking what it is" },
  { key: "any", pool: ["br", "nr", "bn", "nn"], from: "everything", phrase: "met by picking any object at random" },
  { key: "black", pool: ["br", "bn"], from: "the black things", phrase: "found by picking a black thing and checking what it is" },
  { key: "nonraven", pool: ["bn", "nn"], from: "the non-ravens", phrase: "found by picking a non-raven and checking its colour" },
];

/** What else is different in the rival world. */
export const RIVALS = [
  { key: "extra", label: "Only the ravens' colours differ",
    hint: "The rival world has the same ravens and the same other things. Some of its ravens are simply not black, so it holds a few more non-black things in all." },
  { key: "fixed", label: "Same number of non-black things",
    hint: "The textbook assumption: whether all ravens are black tells you nothing about how many things are ravens or how many are non-black. Each non-black raven in the rival world takes the place of a non-black other thing." },
  { key: "more", label: "A different number of ravens",
    hint: "I. J. Good's twist: the two worlds also disagree about how many ravens there are. Set the rival world's number below." },
];

/** Example worlds. The counts are illustrative; only the proportions matter. */
export const PRESETS = [
  { key: "county", label: "A county", note: "100 ravens among 1.25 million other things.",
    ravens: 100, black: 250000, nonblack: 1000000, fraction: 0.1, rival: "extra", rivalRavens: 100, kind: "nn", proc: "nonblack" },
  { key: "aviary", label: "An aviary", note: "20 ravens among 80 other birds: a world small enough for a white bird to matter.",
    ravens: 20, black: 10, nonblack: 70, fraction: 0.1, rival: "extra", rivalRavens: 20, kind: "nn", proc: "nonblack" },
  { key: "country", label: "A country", note: "10,000 ravens among a billion other things.",
    ravens: 10000, black: 200000000, nonblack: 800000000, fraction: 0.1, rival: "extra", rivalRavens: 10000, kind: "nn", proc: "nonblack" },
  { key: "textbook", label: "The county, textbook assumption", note: "The same county, with the number of non-black things held the same in both worlds.",
    ravens: 100, black: 250000, nonblack: 1000000, fraction: 0.1, rival: "fixed", rivalRavens: 100, kind: "nn", proc: "any" },
  { key: "good", label: "Good's two worlds", note: "I. J. Good's example: 100 ravens if all are black, 1,000 if one is not, among a million other things. Here a black raven counts against.",
    ravens: 100, black: 200000, nonblack: 800000, fraction: 0.001, rival: "more", rivalRavens: 1000, kind: "br", proc: "any" },
];

const isCount = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_COUNT;
const limit = MAX_COUNT.toLocaleString("en-GB");

/**
 * Build the two worlds. ravens, black and nonblack describe the world in which all ravens are black
 * (black and nonblack count the things that are not ravens). fraction is the share of ravens that are
 * not black in the rival world. Returns { h, r } or { error }.
 */
export function worlds({ ravens, black, nonblack, fraction, rival = "extra", rivalRavens = ravens }) {
  if (!isCount(ravens) || ravens <= 0) return { error: `The number of ravens must be between 1 and ${limit}.` };
  if (!isCount(black) || !isCount(nonblack)) return { error: `The numbers of other things must be between 0 and ${limit}.` };
  if (!(typeof fraction === "number" && fraction > 0 && fraction <= 1)) return { error: "The rival's share of non-black ravens must be above 0% and at most 100%." };
  const h = { br: ravens, nr: 0, bn: black, nn: nonblack };
  if (rival === "extra" || rival === "more") {
    const n = rival === "more" ? rivalRavens : ravens;
    if (!isCount(n) || n <= 0) return { error: `The rival world's number of ravens must be between 1 and ${limit}.` };
    const nr = fraction * n;
    return { h, r: { br: n - nr, nr, bn: black, nn: nonblack } };
  }
  if (rival === "fixed") {
    const nr = fraction * ravens;
    if (nr > nonblack) return { error: `With the number of non-black things held fixed, the rival world needs ${nr.toLocaleString("en-GB", { maximumFractionDigits: 1 })} non-black ravens but there are only ${nonblack.toLocaleString("en-GB")} non-black things to replace. Add non-black things, lower the rival's share, or choose another assumption.` };
    return { h, r: { br: ravens - nr, nr, bn: black + nr, nn: nonblack - nr } };
  }
  return { error: "Unknown assumption about the rival world." };
}

const procedure = (key) => PROCEDURES.find((p) => p.key === key);
const total = (world, pool) => pool.reduce((s, k) => s + world[k], 0);
/** ln(a / b), accurate when a and b are nearly equal. */
const lnRatio = (a, b) => Math.log1p((a - b) / b);
const logit = (p) => Math.log(p / (1 - p));

/**
 * P(the object drawn is of this kind | world, procedure): its count as a share of the pool.
 * null if the procedure can never produce that kind; 0 if the pool is empty in this world.
 */
export function likelihood(world, procKey, kind) {
  const proc = procedure(procKey);
  if (!proc || !proc.pool.includes(kind)) return null;
  const t = total(world, proc.pool);
  return t > 0 ? world[kind] / t : 0;
}

/**
 * How one observation bears on H against the rival, starting from P(H) = prior.
 * lnLR is the natural log of the likelihood ratio P(E|H) / P(E|rival): +Infinity proves H, -Infinity refutes it.
 * excess is LR - 1, kept separately because LR is often within a millionth of 1.
 */
export function evidence(w, procKey, kind, prior = 0.5) {
  const proc = procedure(procKey);
  if (!proc || !proc.pool.includes(kind)) return { error: "That way of picking an object cannot turn up that kind of object." };
  if (!(typeof prior === "number" && prior > 0 && prior < 1)) return { error: "The starting confidence must be strictly between 0% and 100%." };
  const pH = likelihood(w.h, procKey, kind);
  const pR = likelihood(w.r, procKey, kind);
  if (pH === 0 && pR === 0) return { impossible: true, pH, pR, prior };
  const lnLR = pH === 0 ? -Infinity : pR === 0 ? Infinity
    : lnRatio(w.h[kind], w.r[kind]) + lnRatio(total(w.r, proc.pool), total(w.h, proc.pool));
  const excess = Math.expm1(lnLR);
  // P(H|E) - P(H) = p(1-p)(LR-1) / (1 + p(LR-1)), which keeps its precision when LR is close to 1.
  const difference = lnLR === Infinity ? 1 - prior : (prior * (1 - prior) * excess) / (1 + prior * excess);
  return {
    pH, pR, prior, lnLR, excess,
    lr: Math.exp(lnLR),
    bits: lnLR / Math.LN2,
    posterior: lnLR === Infinity ? 1 : prior + difference,
    difference,                                   // d = P(H|E) - P(H)
    ratio: 1 + difference / prior,                // r = P(H|E) / P(H)
    ratioExcess: difference / prior,              // r - 1
    ko: Math.tanh(lnLR / 2),                      // Kemeny-Oppenheim: (P(E|H) - P(E|rival)) / (P(E|H) + P(E|rival))
  };
}

/** Every observation each procedure can produce, with its evidence. */
export function allEvidence(w, prior = 0.5) {
  return PROCEDURES.flatMap((proc) => proc.pool.map((kind) => ({ proc: proc.key, kind, ...evidence(w, proc.key, kind, prior) })));
}

/** P(H) after n independent observations that each carry log-likelihood ratio lnLR. */
export function afterN(prior, lnLR, n) {
  if (n === 0 || lnLR === 0) return prior;
  if (lnLR === Infinity) return 1;
  if (lnLR === -Infinity) return 0;
  return 1 / (1 + Math.exp(-(logit(prior) + n * lnLR)));
}

/** How many independent observations of this weight take P(H) from prior to target. null if they never will. */
export function needed(prior, lnLR, target = 0.99) {
  if (prior >= target) return 0;
  if (!(lnLR > 0)) return null;
  if (lnLR === Infinity) return 1;
  return Math.ceil((logit(target) - logit(prior)) / lnLR - 1e-9);
}

/** How many observations of weight lnB add up to one of weight lnA. null unless both confirm by a finite amount. */
export function worth(lnA, lnB) {
  return lnA > 0 && lnB > 0 && Number.isFinite(lnA) && Number.isFinite(lnB) ? lnA / lnB : null;
}

/** Slider positions for the rival's share: tidy values from 0.1% to 99%, finer at both ends. */
export function fractionGrid() {
  const out = [];
  for (let m = 1; m <= 9; m++) out.push(m / 1000);          // 0.1% to 0.9%
  for (let m = 1; m <= 9; m++) out.push(m / 100);           // 1% to 9%
  for (let m = 10; m <= 90; m += 5) out.push(m / 100);      // 10% to 90%
  out.push(0.95, 0.99);
  return out;
}
