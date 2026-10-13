// Day 44: Tax Systems Compared. The model, with no DOM code.
// A household's tax under a flat tax, a progressive schedule and a consumption tax. The progressive
// schedules include India's two income-tax regimes for individuals as the law stands for tax year 2026-27.

/* ------------------------------------------------------------------ India, tax year 2026-27 */

/**
 * Income tax on a resident individual for tax year 2026-27 (1 April 2026 to 31 March 2027), the first year of the
 * Income-tax Act, 2025. Checked on 12 October 2026 against:
 *   - Income-tax Act, 2025 as amended by the Finance Act, 2026, in the Income Tax Department's copy
 *     (incometaxindia.gov.in): sections 19 (standard deduction), 156 (rebate) and 202 (new regime);
 *   - Finance Act, 2026 (No. 4 of 2026, assented 30 March 2026; Gazette of India Extraordinary, Part II, Section 1,
 *     No. 9): section 3 and the First Schedule, Part I-B: old-regime rates (Paragraph A), surcharge and its marginal
 *     relief (Paragraph F; section 3(4) and (5) for income taxed under section 202), and the 4% cess (section 3(15)).
 * A slab is [income up to which the rate applies, rate]. A surcharge row is [total income above which it applies, rate].
 */
export const INDIA = {
  year: "2026-27",
  cess: 0.04,
  regimes: {
    new: {
      label: "India, new regime",
      slabs: () => [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]],
      standardDeduction: 75000,
      rebate: { limit: 1200000, max: 60000, marginalRelief: true },
      surcharge: [[5000000, 0.10], [10000000, 0.15], [20000000, 0.25]],
    },
    old: {
      label: "India, old regime",
      slabs: (age) => ({
        under60: [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]],
        "60to79": [[300000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]],
        "80plus": [[500000, 0], [1000000, 0.20], [Infinity, 0.30]],
      })[age],
      standardDeduction: 50000,
      rebate: { limit: 500000, max: 12500, marginalRelief: false },
      surcharge: [[5000000, 0.10], [10000000, 0.15], [20000000, 0.25], [50000000, 0.37]],
    },
  },
};
export const AGES = ["under60", "60to79", "80plus"];
export const MAX_INCOME = 1e11; // ₹10,000 crore

/** Tax on `income` under a schedule of [upTo, rate] slabs: each rate applies only to the income inside its band. */
export function slabTax(income, slabs) {
  let tax = 0, floor = 0;
  for (const [upTo, rate] of slabs) {
    if (income <= floor) break;
    tax += (Math.min(income, upTo) - floor) * rate;
    floor = upTo;
  }
  return tax;
}

/** Rebate under section 156 for a resident individual with this total income and this tax on the slabs. */
function rebateFor(taxable, tax, rule) {
  if (taxable <= rule.limit) return Math.min(tax, rule.max);
  // Marginal relief (section 156(2)(b)): above the limit, tax cannot exceed the income above the limit.
  if (rule.marginalRelief && tax > taxable - rule.limit) return tax - (taxable - rule.limit);
  return 0;
}

/**
 * Income tax plus surcharge at a total income. Marginal relief on surcharge: just above a threshold, tax and
 * surcharge together may not exceed what was payable at the threshold by more than the income above it.
 */
function taxAndSurcharge(taxable, regime, slabs) {
  const tax = slabTax(taxable, slabs);
  const afterRebate = tax - rebateFor(taxable, tax, regime.rebate);
  let step = null;
  for (const row of regime.surcharge) if (taxable > row[0]) step = row;
  if (!step) return { tax, afterRebate, surchargeRate: 0, withSurcharge: afterRebate, relief: 0 };
  const full = afterRebate * (1 + step[1]);
  const cap = taxAndSurcharge(step[0], regime, slabs).withSurcharge + (taxable - step[0]);
  return { tax, afterRebate, surchargeRate: step[1], withSurcharge: Math.min(full, cap), relief: Math.max(0, full - cap) };
}

/**
 * India's income tax for one resident individual with only ordinary income (salary, business, interest).
 * profile: { gross, salaried, age, deductions }: annual income in rupees; whether it is salary (the standard deduction
 * applies); age band for the old regime's slabs; exemptions and deductions claimed under the old regime on top of the
 * standard deduction. Returns every step of the working. No rounding to ten rupees is applied.
 */
export function indiaTax(profile, which) {
  const regime = INDIA.regimes[which];
  if (!regime) throw new RangeError("regime must be 'new' or 'old'");
  const { gross, salaried = true, age = "under60", deductions = 0 } = profile;
  if (!(gross >= 0) || !Number.isFinite(gross)) throw new RangeError("income must be a number that is not negative");
  if (!(deductions >= 0) || !Number.isFinite(deductions)) throw new RangeError("deductions must be a number that is not negative");
  if (!AGES.includes(age)) throw new RangeError("unknown age band");
  const slabs = regime.slabs(age);
  const standard = salaried ? Math.min(regime.standardDeduction, gross) : 0;
  const claimed = which === "old" ? Math.min(deductions, gross - standard) : 0;
  const taxable = gross - standard - claimed;
  const s = taxAndSurcharge(taxable, regime, slabs);
  const surcharge = s.withSurcharge - s.afterRebate;
  const cess = s.withSurcharge * INDIA.cess;
  return {
    regime: which, gross, standard, claimed, taxable,
    slabTax: s.tax, rebate: s.tax - s.afterRebate, afterRebate: s.afterRebate,
    surchargeRate: s.surchargeRate, surcharge, surchargeRelief: s.relief, cess,
    total: s.withSurcharge + cess,
  };
}

/* ------------------------------------------------------------------ the other systems */

/** Flat tax: one rate on income above a tax-free allowance. */
export const flatTax = ({ gross, rate, allowance = 0 }) => rate * Math.max(0, gross - allowance);

/**
 * Consumption tax charged on top of prices, like a sales tax or GST. The household spends `spendShare` of its income,
 * tax included, and `exempt` rupees of that spending a year is on untaxed goods. Of each taxed rupee handed over,
 * rate / (1 + rate) is tax.
 */
export const consumptionTax = ({ gross, spendShare, rate, exempt = 0 }) => (rate / (1 + rate)) * Math.max(0, gross * spendShare - exempt);

/**
 * The share of income spent at another income, for the chart. It is the household's own share at its own income and
 * falls by `fallPerDoubling` (a fraction, so 0.05 is five percentage points) for each doubling of income, kept within
 * 20% and 100%. An assumption the visitor sets, not an estimate.
 */
export function spendShareAt(income, { gross, spendShare, fallPerDoubling = 0 }) {
  if (!(income > 0) || !(gross > 0)) return Math.min(1, Math.max(0.2, spendShare));
  return Math.min(1, Math.max(0.2, spendShare - fallPerDoubling * Math.log2(income / gross)));
}

/** Indian grouping for rupees: 1234567 becomes "12,34,567". */
export function groupIndian(x) {
  if (!Number.isFinite(x)) return "–";
  const n = Math.round(Math.abs(x));
  const digits = String(n);
  const head = digits.length > 3 ? digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "";
  return (x < 0 && n > 0 ? "−" : "") + head + digits.slice(-3);
}
export const rupees = (x) => (Number.isFinite(x) ? `${x < 0 && Math.round(Math.abs(x)) > 0 ? "−" : ""}₹${groupIndian(Math.abs(x))}` : "–");
/** Short form for axes and presets: ₹75,000, ₹12.75 lakh, ₹3 crore. */
export function rupeesShort(x) {
  if (!Number.isFinite(x)) return "–";
  const a = Math.abs(x), sign = x < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${Number((a / 1e7).toFixed(2))} crore`;
  if (a >= 1e5) return `${sign}₹${Number((a / 1e5).toFixed(2))} lakh`;
  return `${sign}₹${groupIndian(a)}`;
}

/** Read a rupee box: digits with optional commas and a rupee sign. Returns { value } or { error }. */
export function parseRupees(text, { what = "an amount", min = 0, max = MAX_INCOME } = {}) {
  const raw = String(text ?? "").replace(/[₹,\s]/g, "");
  if (raw === "") return { error: `Type ${what} in rupees, for example 1500000.` };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { error: `Use digits only for ${what}, for example 1500000 or 15,00,000. Write lakh and crore out as numbers.` };
  const value = Number(raw);
  if (value < min) return { error: `For ${what}, enter at least ${rupees(min)}.` };
  if (value > max) return { error: `For ${what}, enter at most ${rupees(max)}.` };
  return { value };
}

/**
 * Read a schedule typed one band to a line (or separated by semicolons): "from this income: this rate in per cent".
 * Example: "0: 0; 400000: 5; 800000: 10". The first band must start at 0, incomes must rise and rates lie in 0 to 100.
 * Returns { slabs } as [upTo, rate] pairs ready for slabTax, or { error }.
 */
export function parseSlabs(text) {
  const lines = String(text ?? "").split(/[\n;]/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return { error: "Type at least one band, for example 0: 10." };
  if (lines.length > 12) return { error: `Use at most 12 bands; this has ${lines.length}.` };
  const bands = [];
  for (const [k, line] of lines.entries()) {
    const m = /^(?:from\s*)?₹?\s*([\d,]+(?:\.\d+)?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*%?$/i.exec(line);
    const shown = line.length > 40 ? `${line.slice(0, 40)}…` : line;
    if (!m) return { error: `Band ${k + 1} ("${shown}") is not in the form "income: rate", for example 400000: 5.` };
    const from = Number(m[1].replace(/,/g, "")), rate = Number(m[2]);
    if (!(from <= MAX_INCOME)) return { error: `Band ${k + 1} starts above ${rupees(MAX_INCOME)}.` };
    if (rate > 100) return { error: `Band ${k + 1} has a rate of ${rate}%. Rates run from 0 to 100.` };
    if (k === 0 && from !== 0) return { error: "The first band must start at 0, so that every rupee of income has a rate." };
    if (k > 0 && from <= bands[k - 1].from) return { error: `Band ${k + 1} starts at ${rupees(from)}, which is not above band ${k} (${rupees(bands[k - 1].from)}). List the bands from the lowest income up.` };
    bands.push({ from, rate: rate / 100 });
  }
  return { slabs: bands.map((b, k) => [k + 1 < bands.length ? bands[k + 1].from : Infinity, b.rate]) };
}
/** The text form of a schedule, for the preset buttons. */
export const slabsText = (slabs) => slabs.map(([, rate], k) => `${k === 0 ? 0 : slabs[k - 1][0]}: ${Number((rate * 100).toFixed(4))}`).join("\n");

/* ------------------------------------------------------------------ comparison */

export const SYSTEMS = [
  { key: "new", label: "India, new regime" },
  { key: "old", label: "India, old regime" },
  { key: "own", label: "Your own slabs" },
  { key: "flat", label: "Flat tax" },
  { key: "consumption", label: "Consumption tax" },
];

/**
 * Tax under one system at a given income, holding the rest of the household's profile and the settings fixed.
 * settings: { flatRate, flatAllowance, ownSlabs, consRate, consExempt, fallPerDoubling }.
 * Under the old regime the deductions are the household's own amount, capped at the income being looked at.
 */
export function taxAt(system, income, profile, settings) {
  switch (system) {
    case "new": case "old": return indiaTax({ ...profile, gross: income }, system).total;
    case "own": return slabTax(income, settings.ownSlabs);
    case "flat": return flatTax({ gross: income, rate: settings.flatRate, allowance: settings.flatAllowance });
    case "consumption": return consumptionTax({ gross: income, spendShare: spendShareAt(income, { ...profile, fallPerDoubling: settings.fallPerDoubling }), rate: settings.consRate, exempt: settings.consExempt });
    default: throw new RangeError("unknown system");
  }
}

export const STEP = 1000; // the marginal rate is the tax on the next ₹1,000 of income, as a share of it

/** The household under every system: tax, average rate, tax on the next ₹1,000 and what is left. */
export function compare(profile, settings) {
  return SYSTEMS.map(({ key, label }) => {
    const tax = taxAt(key, profile.gross, profile, settings);
    const next = taxAt(key, profile.gross + STEP, profile, settings) - tax;
    return { key, label, tax, average: profile.gross > 0 ? tax / profile.gross : 0, next, marginal: next / STEP, left: profile.gross - tax };
  });
}

/**
 * Average and marginal rates across incomes for the chart: n incomes evenly spaced on a log scale from lo to hi, plus
 * points just below and above every threshold of the two Indian regimes (in gross income, for this profile), so that
 * a cliff or a relief zone cannot fall between two points.
 */
export function rateCurves(profile, settings, { lo = 200000, hi = 1e9, n = 160 } = {}) {
  const set = new Set(Array.from({ length: n }, (_, k) => Math.round(lo * (hi / lo) ** (k / (n - 1)))));
  for (const which of ["new", "old"]) {
    const r = INDIA.regimes[which];
    const shift = (profile.salaried ? r.standardDeduction : 0) + (which === "old" ? profile.deductions : 0);
    const marks = [...r.slabs(profile.age).map((s) => s[0]), r.rebate.limit, ...r.surcharge.map((s) => s[0])].filter(Number.isFinite);
    if (which === "new") marks.push(r.rebate.limit + r.rebate.max / (1 - 0.15)); // where marginal relief on the rebate ends
    for (const m of marks) for (const d of [-STEP, -1, 0, 1, STEP]) {
      const y = Math.round(m + shift + d);
      if (y >= lo && y <= hi) set.add(y);
    }
  }
  const incomes = [...set].sort((a, b) => a - b);
  return SYSTEMS.map(({ key, label }) => ({
    key, label,
    points: incomes.map((y) => {
      const tax = taxAt(key, y, profile, settings);
      return { income: y, tax, average: tax / y, marginal: (taxAt(key, y + STEP, profile, settings) - tax) / STEP };
    }),
  }));
}

/**
 * Old regime or new? Returns both totals, the saving from choosing the cheaper one, and `breakEven`: the smallest
 * amount of old-regime deductions (to the rupee) at which the old regime costs no more than the new. That is 0 if the
 * old regime already costs no more with none.
 */
export function oldOrNew(profile) {
  const newTax = indiaTax(profile, "new").total;
  const oldWith = (d) => indiaTax({ ...profile, deductions: d }, "old").total;
  const oldTax = oldWith(profile.deductions);
  const room = profile.gross - (profile.salaried ? Math.min(INDIA.regimes.old.standardDeduction, profile.gross) : 0);
  let breakEven = 0;
  if (oldWith(0) > newTax + 1e-9) {
    let lo = 0, hi = Math.ceil(room); // the old regime costs more at lo and no more at hi (with nothing taxable it charges nothing)
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (oldWith(mid) > newTax + 1e-9) lo = mid; else hi = mid; }
    breakEven = hi;
  }
  // "same" means the same to the nearest rupee, which is how every amount is shown: a gap of 21 paise is not "New, by ₹0".
  return { newTax, oldTax, cheaper: Math.abs(newTax - oldTax) < 0.5 ? "same" : newTax < oldTax ? "new" : "old", saving: Math.abs(newTax - oldTax), breakEven, room };
}
