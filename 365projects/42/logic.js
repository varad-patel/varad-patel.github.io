// Day 42: Minimum Wage Simulator. The model, with no DOM code.
// One labour market with straight-line curves, solved exactly under two models of who sets the wage.
//
//   demand (what an extra worker is worth to employers):  w = a - b L
//   supply (the wage needed to attract the L-th worker):  w = c + d L
//
// L is employment in thousands of workers and w the hourly wage, so a wage bill w x L is in thousands of
// currency units per hour. Nothing here knows about a currency.

export const MODELS = [
  { id: "competitive", label: "Competitive" },
  { id: "monopsony", label: "Monopsony" },
];
export const RATIONING = [
  { id: "efficient", label: "Those who would work for least" },
  { id: "random", label: "A random draw of everyone willing" },
];

/** Limits the interface keeps to, and that the functions below check. */
export const LIMITS = { a: [150, 400], b: [0.5, 8], c: [0, 120], d: [0.25, 4], floor: [0, 400] };

const finite = (x) => typeof x === "number" && Number.isFinite(x);

/** "" if the curves can be solved, otherwise what to fix. */
export function curveProblem({ a, b, c, d } = {}) {
  if (![a, b, c, d].every(finite)) return "All four numbers that describe the curves must be numbers.";
  if (!(b > 0)) return "The demand slope must be above zero: employers must want fewer workers at a higher wage.";
  if (!(d > 0)) return "The supply slope must be above zero: a higher wage must attract more workers.";
  if (c < 0) return "The lowest wage anyone would work for cannot be below zero.";
  if (!(a > c)) return "The highest wage any employer would pay must be above the lowest wage anyone would work for, or there is no market.";
  return "";
}

/** Workers employers want at wage w, and workers willing to work at wage w (both never below zero). */
export const demandAt = ({ a, b }, w) => Math.max(0, (a - w) / b);
export const supplyAt = ({ c, d }, w) => Math.max(0, (w - c) / d);

/**
 * The two markets with no floor.
 *   competitive: demand meets supply.            L* = (a - c) / (b + d),   w* = c + d L*
 *   monopsony:   one employer hires until an extra worker's worth equals the extra cost of hiring one,
 *                c + 2 d L (the new worker's wage plus the rise that every existing worker must be paid).
 *                L_m = (a - c) / (b + 2d),  w_m = c + d L_m,  and that last worker is worth a - b L_m.
 */
export function equilibria(p) {
  const problem = curveProblem(p);
  if (problem) return { error: problem };
  const { a, b, c, d } = p;
  const Lc = (a - c) / (b + d);
  const Lm = (a - c) / (b + 2 * d);
  return {
    competitive: { L: Lc, w: c + d * Lc },
    monopsony: { L: Lm, w: c + d * Lm, worth: a - b * Lm },
  };
}

/** Surpluses at employment L and wage w. `willing` is how many would take a job at w. */
function surpluses({ a, b, c, d }, L, w, willing, rationing) {
  // Employers: what the L workers are worth (the area under demand) less what they are paid.
  const employers = a * L - (b * L * L) / 2 - w * L;
  // Workers: pay less the lowest wage each would have accepted. If jobs are short and go to a random draw
  // of the willing, the average job-holder's lowest acceptable wage is the average over everyone willing.
  const short = willing > L + 1e-12;
  const workers = short && rationing === "random" ? (L * (w - c)) / 2 : w * L - c * L - (d * L * L) / 2;
  return { employers, workers, total: employers + workers };
}

/**
 * The market under a wage floor. floor = 0 (or anything at or below the going wage) changes nothing.
 *
 * Competitive: above the competitive wage, employment is what employers want at the floor.
 * Monopsony:   above the monopsony wage the employer can no longer lower pay by hiring less, so every worker
 *              costs the floor and it hires everyone willing, (floor - c) / d, as long as each is worth at
 *              least the floor. That holds up to the competitive wage. Above it, employment is what the
 *              employer wants at the floor, as in the competitive market.
 *
 * Returns { error } or { model, floor, binding, regime, L, w, willing, jobless, wageBill, employers, workers, total }.
 * regime is "free" (floor does not bind), "supply" (jobs limited by who is willing) or "demand" (by what employers want).
 */
export function outcome(p, model, floor = 0, rationing = "efficient") {
  const eq = equilibria(p);
  if (eq.error) return { error: eq.error };
  if (!MODELS.some((m) => m.id === model)) return { error: `There is no model called "${model}".` };
  if (!RATIONING.some((r) => r.id === rationing)) return { error: `There is no rationing rule called "${rationing}".` };
  if (!finite(floor) || floor < 0) return { error: "The wage floor must be a number of zero or more." };

  const free = eq[model];
  let L, w, regime;
  if (floor <= free.w) { L = free.L; w = free.w; regime = "free"; }
  else {
    w = floor;
    const wanted = demandAt(p, floor), willingNow = supplyAt(p, floor);
    if (model === "monopsony" && willingNow <= wanted) { L = willingNow; regime = "supply"; }
    else { L = wanted; regime = "demand"; }
  }
  const willing = Math.max(L, supplyAt(p, w));
  return { model, floor, binding: regime !== "free", regime, L, w, willing, jobless: willing - L, wageBill: w * L, ...surpluses(p, L, w, willing, rationing) };
}

/**
 * Who gains and who loses when the floor is brought in, against the same model with no floor.
 * Every amount is per hour, in thousands of currency units.
 *   stayers   workers employed before and after, and what the higher wage adds to their pay
 *   hired     people working afterwards who were not working before
 *   lost      people working before who are not working afterwards
 *   workers, employers, total   change in each surplus
 *
 * If the floor leaves more people willing than there are jobs and the jobs go to a random draw of the willing,
 * each of the earlier workers (all of whom are still willing) keeps a job with probability jobs / willing, so
 * some of them are replaced by people who were not working before. Otherwise the earlier workers come first.
 */
export function effect(p, model, floor, rationing = "efficient") {
  const before = outcome(p, model, 0, rationing);
  if (before.error) return { error: before.error };
  const after = outcome(p, model, floor, rationing);
  if (after.error) return { error: after.error };
  const drawn = rationing === "random" && after.jobless > 1e-12;
  const stay = drawn ? (after.L * before.L) / after.willing : Math.min(before.L, after.L);
  return {
    before, after,
    jobs: after.L - before.L,
    hired: after.L - stay,
    lost: before.L - stay,
    wage: after.w - before.w,
    stayers: stay,
    stayersGain: stay * (after.w - before.w),
    wageBill: after.wageBill - before.wageBill,
    workers: after.workers - before.workers,
    employers: after.employers - before.employers,
    total: after.total - before.total,
  };
}

/**
 * The floors at which the story changes, in rising order of wage:
 *   bites       the floor starts to bind (the wage the model pays with no floor)
 *   peak        employment is highest (the competitive wage; the same as bites in the competitive model)
 *   breakEven   employment is back where it was with no floor (monopsony only: the worth of its last worker)
 *   zero        no one is employed (the demand intercept)
 */
export function thresholds(p, model) {
  const eq = equilibria(p);
  if (eq.error) return { error: eq.error };
  if (model === "competitive") return { bites: eq.competitive.w, peak: eq.competitive.w, breakEven: eq.competitive.w, zero: p.a };
  return { bites: eq.monopsony.w, peak: eq.competitive.w, breakEven: eq.monopsony.worth, zero: p.a };
}

/** Employment and the wage bill at each floor in `floors`, for one model: [{ floor, L, wageBill, workers }]. */
export function sweep(p, model, floors, rationing = "efficient") {
  return floors.map((floor) => {
    const o = outcome(p, model, floor, rationing);
    return { floor, L: o.L, wageBill: o.wageBill, workers: o.workers };
  });
}

/** Elasticities at the competitive point, for readers who think in those terms. */
export function elasticities(p) {
  const eq = equilibria(p);
  if (eq.error) return { error: eq.error };
  const { L, w } = eq.competitive;
  return { demand: -(w / L) / p.b, supply: (w / L) / p.d };
}
