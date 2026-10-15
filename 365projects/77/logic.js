// Day 77: Compound Interest Universe. The model, with no DOM code.
// Savings that compound period by period, with fees, rising pay-ins and inflation, checked against closed forms.

/** Input ranges. Rates in percent a year; ages in years; amounts in units of the chosen currency. */
export const LIMITS = {
  start: { min: 0, max: 1e9 },
  pay: { min: 0, max: 1e7 },
  raise: { min: -10, max: 20 },
  age: { min: 0, max: 99 },
  end: { min: 1, max: 100 },
  rate: { min: -50, max: 50 },
  fee: { min: 0, max: 10 },
  inflation: { min: -10, max: 30 },
};

/**
 * Check a plan. Returns { ok, errors: [{ key, message }], plan } with rates turned into fractions.
 * plan: { start, pay, perYear (12 or 1), raise, age, end, rate, fee, inflation } as typed (percent).
 */
export function readPlan(input) {
  const errors = [];
  const num = (key, what, whole = false) => {
    const v = input[key], lim = LIMITS[key];
    if (!Number.isFinite(v) || v < lim.min || v > lim.max || (whole && !Number.isInteger(v))) {
      errors.push({ key, message: `Enter ${what} from ${lim.min.toLocaleString("en-GB")} to ${lim.max.toLocaleString("en-GB")}${whole ? ", a whole number" : ""}.` });
    }
    return v;
  };
  num("start", "a starting amount");
  num("pay", "an amount");
  num("raise", "a yearly rise in %");
  num("age", "an age", true);
  num("end", "an age", true);
  num("rate", "a return in %");
  num("fee", "a fee in %");
  num("inflation", "an inflation rate in %");
  if (!errors.some((e) => e.key === "age" || e.key === "end") && input.end <= input.age) {
    errors.push({ key: "end", message: "The end age must be later than the age now." });
  }
  if (![1, 12].includes(input.perYear)) errors.push({ key: "perYear", message: "Pay in every month or once a year." });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true, errors,
    plan: {
      start: input.start, pay: input.pay, perYear: input.perYear, years: input.end - input.age, age: input.age,
      rate: input.rate / 100, fee: input.fee / 100, raise: input.raise / 100, inflation: input.inflation / 100,
    },
  };
}

/** Yearly growth factor after fees: (1 + r)(1 - f). The fee is a share of the balance, taken as it grows. */
export const netFactor = (plan) => (1 + plan.rate) * (1 - plan.fee);
/** Net return a year, nominal and real (Fisher's exact relation, not r - pi). */
export const netRate = (plan) => netFactor(plan) - 1;
export const realRate = (plan) => netFactor(plan) / (1 + plan.inflation) - 1;

/**
 * Period by period: each period the balance grows by ((1 + r)(1 - f))^(1/p), then the pay-in for that period is
 * added at its end. Pay-ins are constant within a year and rise by `raise` from one year to the next.
 * plan.delay (default 0) is the number of years from now before the plan starts: "today's money" is always money
 * of now, so a plan started later is deflated over the delay as well as its own years.
 * Returns the yearly path (index t = years since the plan started, 0..Y) and the totals. paidInReal adds up each
 * pay-in in today's money, deflated from the moment it is paid.
 */
export function simulate(plan) {
  const p = plan.perYear, Y = plan.years, d = plan.delay || 0, pi = 1 + plan.inflation;
  const gross = (1 + plan.rate) ** (1 / p), keep = (1 - plan.fee) ** (1 / p);
  let balance = plan.start, paidIn = plan.start, paidInReal = plan.start / pi ** d, fees = 0;
  const path = [{ t: 0, balance, paidIn, paidInReal, fees, deflator: pi ** d }];
  for (let year = 0; year < Y; year++) {
    const pay = plan.pay * (1 + plan.raise) ** year;
    for (let k = 0; k < p; k++) {
      const grown = balance * gross;
      fees += grown * (1 - keep);
      balance = grown * keep + pay;
      paidIn += pay;
      paidInReal += pay / pi ** (d + year + (k + 1) / p);
    }
    path.push({ t: year + 1, balance, paidIn, paidInReal, fees, deflator: pi ** (d + year + 1) });
  }
  const last = path[Y];
  return { path, balance: last.balance, paidIn: last.paidIn, paidInReal: last.paidInReal, fees: last.fees, real: last.balance / last.deflator, deflator: last.deflator };
}

/* ---------- closed forms (the tests hold the simulation to these) ---------- */

/** Future value of a lump sum S after n periods at rate i per period: S (1 + i)^n. */
export const fvLump = (S, i, n) => S * (1 + i) ** n;

/**
 * Future value of n payments of C at the end of each period: C ((1 + i)^n - 1) / i, or C n when i = 0.
 * Written with expm1 and log1p so that a rate near zero loses no digits.
 */
export const fvAnnuity = (C, i, n) => (i === 0 ? C * n : (C * Math.expm1(n * Math.log1p(i))) / i);

/** The same with payments at the start of each period (an annuity due): one more period of growth each. */
export const fvAnnuityDue = (C, i, n) => fvAnnuity(C, i, n) * (1 + i);

/**
 * Growing annuity: n end-of-period payments C, C(1+g), ..., C(1+g)^(n-1), at rate i:
 * C ((1 + i)^n - (1 + g)^n) / (i - g), or C n (1 + i)^(n-1) when i = g. Within 1e-6 of each other the
 * subtraction would lose digits, so there the n terms are added up directly (n is at most a few hundred).
 */
export function fvGrowingAnnuity(C, i, g, n) {
  if (i === g) return C * n * (1 + i) ** (n - 1);
  if (Math.abs(i - g) < 1e-6) {
    let s = 0;
    for (let k = 0; k < n; k++) s += (1 + g) ** k * (1 + i) ** (n - 1 - k);
    return C * s;
  }
  return (C * (1 + g) ** n * Math.expm1(n * (Math.log1p(i) - Math.log1p(g)))) / (i - g);
}

/**
 * The plan's final balance in closed form: the start grows for p Y periods; each year's p pay-ins add up at that
 * year's end to pay x ((1+j)^p - 1) / j with j the rate per period, and those year-end sums form a growing annuity
 * at the yearly rate Q - 1 with growth `raise`.
 */
export function closedForm(plan) {
  const p = plan.perYear, Y = plan.years;
  const Q = netFactor(plan), j = Q ** (1 / p) - 1;
  const withinYear = fvAnnuity(1, j, p);
  return fvLump(plan.start, Q - 1, Y) + plan.pay * withinYear * fvGrowingAnnuity(1, Q - 1, plan.raise, Y);
}

/** Years for money to double at net rate i a year: ln 2 / ln(1 + i); Infinity when it never doubles. */
export const doublingYears = (i) => (i > 0 ? Math.LN2 / Math.log1p(i) : Infinity);
/** The rule of 72: 72 / (100 i). */
export const ruleOf72 = (i) => (i > 0 ? 72 / (100 * i) : Infinity);

/* ---------- small differences ---------- */

/**
 * One change at a time to the plan (rates as fractions). Each has an id, a label and the changed plan, or a
 * reason it does not apply to this plan.
 */
export function variants(plan) {
  const v = [];
  const add = (id, label, change, reason) => v.push({ id, label, plan: reason ? null : { ...plan, ...change }, reason });
  add("rate+1", "Return 1 point higher", { rate: plan.rate + 0.01 }, plan.rate + 0.01 > LIMITS.rate.max / 100 ? "the return would pass 50%" : null);
  add("rate-1", "Return 1 point lower", { rate: plan.rate - 0.01 }, plan.rate - 0.01 < LIMITS.rate.min / 100 ? "the return would fall below -50%" : null);
  add("fee+1", "Fees 1 point higher", { fee: plan.fee + 0.01 }, plan.fee + 0.01 > LIMITS.fee.max / 100 ? "fees would pass 10%" : null);
  add("fee0", "No fees", { fee: 0 }, plan.fee === 0 ? "the plan has no fees already" : null);
  // The same saver waiting: every payment moves later, the end age stays, and today's money is still money of now.
  const late = (n) => ({ years: plan.years - n, age: plan.age + n, delay: (plan.delay || 0) + n });
  add("late5", "Start 5 years later", late(5), plan.years <= 5 ? "the plan is 5 years or shorter" : null);
  add("late10", "Start 10 years later", late(10), plan.years <= 10 ? "the plan is 10 years or shorter" : null);
  add("pay+10", "Pay in 10% more", { pay: plan.pay * 1.1 }, plan.pay === 0 ? "the plan pays nothing in" : null);
  add("inf+1", "Inflation 1 point higher", { inflation: plan.inflation + 0.01 }, plan.inflation + 0.01 > LIMITS.inflation.max / 100 ? "inflation would pass 30%" : null);
  return v;
}

/** Final real balance of each variant and its difference from the plan's, in money and as a share. */
export function compare(plan) {
  const base = simulate(plan).real;
  return variants(plan).map((x) => {
    if (!x.plan) return { ...x, real: null, diff: null, share: null };
    const real = simulate(x.plan).real;
    return { ...x, real, diff: real - base, share: base > 0 ? real / base - 1 : null };
  });
}
