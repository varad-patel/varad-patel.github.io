// Day 59: Comparative Advantage Trader. Model: Ricardo's two countries, two goods and one input, labour.
// Pure functions, no DOM. Every comparison that decides a word on the page ("same", "gains", "edge of the range")
// is made in exact fractions, because 0.3 / 0.1 and 0.6 / 0.2 are not reliably equal in floating point.

/* ------------------------------------------------------- exact fractions */

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const make = (n, d) => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; };

/** Exact fractions over BigInt. Q.of(0.1) is exactly 1/10: a number is read as the decimal it prints as. */
export const Q = {
  zero: { n: 0n, d: 1n },
  one: { n: 1n, d: 1n },
  of(x) {
    if (typeof x === "object") return x;
    if (typeof x === "bigint") return { n: x, d: 1n };
    if (!Number.isFinite(x)) throw new Error("not a finite number");
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(x));
    const digits = BigInt(m[1] + m[2] + (m[3] || ""));
    const exp = Number(m[4] || 0) - (m[3] || "").length;
    return exp >= 0 ? make(digits * 10n ** BigInt(exp), 1n) : make(digits, 10n ** BigInt(-exp));
  },
  add: (a, b) => make(a.n * b.d + b.n * a.d, a.d * b.d),
  sub: (a, b) => make(a.n * b.d - b.n * a.d, a.d * b.d),
  mul: (a, b) => make(a.n * b.n, a.d * b.d),
  div: (a, b) => { if (b.n === 0n) throw new Error("division by zero"); return make(a.n * b.d, a.d * b.n); },
  /** -1, 0 or 1 */
  cmp: (a, b) => { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; },
  sign: (a) => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0),
  min: (a, b) => (Q.cmp(a, b) <= 0 ? a : b),
  max: (a, b) => (Q.cmp(a, b) >= 0 ? a : b),
  /** The nearest double. Numerator and denominator are scaled first so that neither overflows. */
  num(a) {
    if (a.n === 0n) return 0;
    const digits = (v) => (v < 0n ? -v : v).toString().length;
    const shift = Math.max(digits(a.n), digits(a.d)) - 300;
    if (shift <= 0) return Number(a.n) / Number(a.d);
    const cut = 10n ** BigInt(shift);
    return Number(a.n / cut) / Number(a.d / cut);
  },
};

/* ------------------------------------------------------------ the economy */

export const GOODS = ["x", "y"];
export const LIMITS = { min: 0.000001, max: 1000000000, name: 24 };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** An exact fraction handed in instead of a number: the reciprocal of a typed number, or the market's own amounts. */
export const isFraction = (v) => v !== null && typeof v === "object" && typeof v.n === "bigint" && typeof v.d === "bigint";

/**
 * Check what the visitor typed. input = { mode, share, goods: [nameX, nameY], countries: [{ name, labour, x, y }, { ... }] }.
 *   mode "labour": x and y are the workers needed to make one unit (Ricardo's way of writing it). Must be above zero.
 *   mode "output": x and y are the units one worker makes. Zero means the country cannot make the good.
 *   share: the percentage of spending that goes on good x, a whole number from 1 to 99.
 *   x and y may also be exact fractions above zero (see isFraction). The interface passes one when a box shows the
 *   rounded reciprocal of a number typed in the other mode, so that switching modes never changes the economy.
 * Returns a list of { field, message }; empty when the input can be solved.
 */
export function validate(input) {
  const errors = [];
  const bad = (field, message) => errors.push({ field, message });
  const { mode, share, goods = [], countries = [] } = input || {};
  if (mode !== "labour" && mode !== "output") bad("mode", "Choose how the numbers are written: workers per unit or units per worker.");
  if (!Number.isInteger(share) || share < 1 || share > 99) bad("share", "The share of spending on the first good must be a whole percentage from 1 to 99.");
  const names = [];
  const checkName = (text, field, what) => {
    const t = typeof text === "string" ? text.trim() : "";
    if (!t) bad(field, `Give ${what} a name.`);
    else if (t.length > LIMITS.name) bad(field, `Keep the name of ${what} to ${LIMITS.name} characters or fewer.`);
    else if (names.includes(t.toLowerCase())) bad(field, `"${t}" is used twice. Give ${what} a different name.`);
    names.push(t.toLowerCase());
  };
  checkName(goods[0], "good0", "the first good");
  checkName(goods[1], "good1", "the second good");
  countries.slice(0, 2).forEach((c, i) => checkName(c?.name, `name${i}`, i ? "the second country" : "the first country"));
  if (countries.length !== 2) bad("countries", "The model needs exactly two countries.");
  const range = `between ${LIMITS.min} and ${LIMITS.max.toLocaleString("en-GB")}`;
  countries.slice(0, 2).forEach((c, i) => {
    const who = (typeof c?.name === "string" && c.name.trim()) || `Country ${i + 1}`;
    if (!isNum(c?.labour) || c.labour < LIMITS.min || c.labour > LIMITS.max) bad(`labour${i}`, `${who}: the number of workers must be ${range}.`);
    let none = 0;
    GOODS.forEach((g, k) => {
      const v = c?.[g];
      const good = (typeof goods[k] === "string" && goods[k].trim()) || `good ${k + 1}`;
      if (isFraction(v)) { if (Q.sign(v) <= 0) bad(`${g}${i}`, `${who}, ${good}: the number must be above zero.`); return; }
      if (mode === "labour") {
        if (!isNum(v) || v < LIMITS.min || v > LIMITS.max) bad(`${g}${i}`, `${who}, ${good}: the workers needed per unit must be ${range}. To say a country cannot make a good at all, switch to units per worker and enter 0.`);
      } else if (!isNum(v) || v < 0 || (v > 0 && v < LIMITS.min) || v > LIMITS.max) bad(`${g}${i}`, `${who}, ${good}: the units one worker makes must be 0, or ${range}.`);
      else if (v === 0) none++;
    });
    if (none === 2) bad(`x${i}`, `${who} cannot make either good, so it has nothing to trade. Give it some output of at least one.`);
  });
  if (!errors.length && mode === "output") {
    GOODS.forEach((g, k) => { if (countries[0][g] === 0 && countries[1][g] === 0) bad(`${g}0`, `Neither country can make ${goods[k].trim()}, so there is nothing to trade it for. Let at least one of them make some.`); });
  }
  return errors;
}

/**
 * Cobb-Douglas utility compared exactly: the sign of U(a) - U(b), where U = x^share * y^(100 - share).
 * Whole-number powers of fractions are fractions, so no rounding enters. The two exponents are first divided by
 * their common factor (50 and 50 become 1 and 1), which changes no comparison and keeps the numbers small.
 */
function compareUtility(a, b, share) {
  const g = gcd(BigInt(share), BigInt(100 - share));
  const t = BigInt(share) / g, u = BigInt(100 - share) / g;
  const U = (c) => (Q.sign(c.x) <= 0 || Q.sign(c.y) <= 0 ? Q.zero : { n: c.x.n ** t * c.y.n ** u, d: c.x.d ** t * c.y.d ** u });
  const ua = U(a), ub = U(b);
  const l = ua.n * ub.d, r = ub.n * ua.d;
  return l > r ? 1 : l < r ? -1 : 0;
}

/**
 * The best a country can do with a given trade. cap = { x, y } is what it could make of each good with all its labour,
 * net = { x, y } what trade adds to (or, if negative, takes from) each good. It chooses the share s of labour that
 * makes good x so as to maximise x^theta y^(1 - theta) over consumption (s capX + netX, (1 - s) capY + netY).
 * Returns null when no s leaves both amounts at zero or more (the country cannot deliver what the trade asks of it).
 */
export function bestResponse(cap, net, share) {
  const theta = make(BigInt(share), 100n);
  const noX = Q.sign(cap.x) === 0, noY = Q.sign(cap.y) === 0;
  let lo = Q.zero, hi = Q.one, s;
  if (!noX) lo = Q.max(lo, Q.div(Q.sub(Q.zero, net.x), cap.x)); else if (Q.sign(net.x) < 0) return null;
  if (!noY) hi = Q.min(hi, Q.add(Q.one, Q.div(net.y, cap.y))); else if (Q.sign(net.y) < 0) return null;
  if (Q.cmp(lo, hi) > 0) return null;
  if (noX) s = lo;                       // labour is useless in x: all of it makes y
  else if (noY) s = hi;                  // and the other way round
  else {
    // First-order condition of theta ln(s capX + netX) + (1 - theta) ln((1 - s) capY + netY), then kept inside [lo, hi].
    const free = Q.sub(Q.add(theta, Q.mul(theta, Q.div(net.y, cap.y))), Q.mul(Q.sub(Q.one, theta), Q.div(net.x, cap.x)));
    s = Q.min(hi, Q.max(lo, free));
  }
  const make2 = { x: Q.mul(s, cap.x), y: Q.mul(Q.sub(Q.one, s), cap.y) };
  return { s, production: make2, consumption: { x: Q.add(make2.x, net.x), y: Q.add(make2.y, net.y) } };
}

/** How one bundle compares with another for a country: sign (exact), and the percentage of both goods it is worth. */
function gainOf(after, before, share) {
  const sign = compareUtility(after, before, share);
  const positive = (c) => Q.sign(c.x) > 0 && Q.sign(c.y) > 0;
  // The gain is the g for which the old bundle scaled by (1 + g) is as good as the new one. With nothing of one good
  // before, no scaling of the old bundle gets there, so there is no percentage to give.
  let percent = null;
  if (positive(before)) {
    percent = !positive(after) ? -1 : sign === 0 ? 0
      : Math.exp((share / 100) * Math.log(Q.num(Q.div(after.x, before.x))) + (1 - share / 100) * Math.log(Q.num(Q.div(after.y, before.y)))) - 1;
  }
  return { sign, percent };
}

/**
 * Solve the model. Returns everything the page shows, with exact fractions (fields ending in Q) beside plain numbers.
 * Country order is as typed. Prices are always units of good y per unit of good x.
 */
export function solve(input) {
  const errors = validate(input);
  if (errors.length) throw new Error(errors[0].message);
  const { mode, share } = input;
  const theta = make(BigInt(share), 100n);
  const countries = input.countries.map((c) => {
    const L = Q.of(c.labour);
    const a = Object.fromEntries(GOODS.map((g) => [g, mode === "labour" ? Q.div(Q.one, Q.of(c[g])) : Q.of(c[g])])); // units per worker
    const cap = { x: Q.mul(L, a.x), y: Q.mul(L, a.y) };
    // Opportunity cost of one x: the y the same labour would have made. null stands for "cannot make x at all".
    const cost = Q.sign(a.x) === 0 ? null : Q.div(a.y, a.x);
    return { name: c.name.trim(), labour: c.labour, a, cap, cost };
  });
  const [c0, c1] = countries;

  const absolute = GOODS.map((g) => { const k = Q.cmp(c0.a[g], c1.a[g]); return k > 0 ? 0 : k < 0 ? 1 : null; });
  // Compare opportunity costs of x, with "cannot make x" above every number.
  const costCmp = c0.cost === null ? (c1.cost === null ? 0 : 1) : c1.cost === null ? -1 : Q.cmp(c0.cost, c1.cost);
  const exporterX = costCmp < 0 ? 0 : costCmp > 0 ? 1 : null; // who has the comparative advantage in x
  const A = exporterX ?? 0, B = 1 - A;

  // Without trade each country splits its labour as its tastes dictate.
  for (const c of countries) {
    const r = bestResponse(c.cap, { x: Q.zero, y: Q.zero }, share);
    c.autarky = r.consumption;
    c.autarkyShare = r.s;
  }

  let price = null, regime = "none", tradeX = Q.zero, tradeY = Q.zero, range = null;
  if (exporterX !== null) {
    const lo = countries[A].cost, hi = countries[B].cost; // lo may be zero, hi may be null (no upper limit)
    range = { lo, hi };
    // If both specialise completely, spending shares fix the price: p capX(A) (1 - theta) = theta capY(B).
    const full = Q.div(Q.mul(theta, countries[B].cap.y), Q.mul(Q.sub(Q.one, theta), countries[A].cap.x));
    if (Q.cmp(full, lo) <= 0) { price = lo; regime = "exporterLarge"; }        // the x-maker is so large that its own price rules
    else if (hi !== null && Q.cmp(full, hi) >= 0) { price = hi; regime = "importerLarge"; }
    else { price = full; regime = "both"; }
    tradeX = regime === "exporterLarge" ? Q.div(Q.mul(theta, countries[B].cap.y), price) : Q.mul(Q.sub(Q.one, theta), countries[A].cap.x);
    tradeY = Q.mul(price, tradeX);
  }
  const market = evaluate({ countries, share }, A, tradeX, tradeY);

  return {
    mode, share, goods: input.goods.map((g) => g.trim()), countries, absolute, exporterX, range, price, regime,
    market: { from: A, x: tradeX, y: tradeY, ...market },
  };
}

/**
 * What a trade does to both countries: country `from` hands over x units of good x and receives y units of good y
 * (either may be given as a number or a fraction). Each country then makes the best of it.
 * Returns { feasible: [bool, bool], outcome: [{ production, consumption, sign, percent } or null, ...] }.
 */
export function evaluate(model, from, x, y) {
  const qx = Q.of(x), qy = Q.of(y);
  const outcome = model.countries.map((c, i) => {
    const give = i === from ? -1n : 1n;
    const net = { x: Q.mul(make(give, 1n), qx), y: Q.mul(make(-give, 1n), qy) };
    const r = bestResponse(c.cap, net, model.share);
    return r && { ...r, ...gainOf(r.consumption, c.autarky, model.share) };
  });
  return { feasible: outcome.map(Boolean), outcome };
}

/**
 * The counterpart's answer to an offer. offer = { proposer: 0 or 1, gives: "x" or "y", give: amount, get: amount }:
 * the proposer hands over `give` units of the good `gives` and asks for `get` units of the other good.
 * The counterpart accepts only if the trade leaves it strictly better off than no trade at all.
 * give and get are numbers, or exact fractions above zero (the market's own amounts, which rarely fit in six figures).
 * code is one of:
 *   "invalid"             the amounts are not usable numbers (message says why)
 *   "proposerCannot"      the proposer could not make what it promises
 *   "counterpartCannot"   the counterpart could not make what is asked of it
 *   "price"               the price is on the wrong side of the counterpart's own cost: no quantity would help it
 *   "edge"                the price equals the counterpart's own cost exactly: it gains nothing
 *   "quantity"            the price would suit it, but this much trade leaves it no better off
 *   "accept"
 */
export function respond(model, offer) {
  const { proposer, gives, give, get } = offer;
  const other = 1 - proposer;
  for (const [v, what] of [[give, "The amount offered"], [get, "The amount asked for"]]) {
    if (isFraction(v)) { if (Q.sign(v) > 0) continue; return { code: "invalid", accepted: false, message: `${what} must be above zero.` }; }
    if (typeof v !== "number" || Number.isNaN(v)) return { code: "invalid", accepted: false, message: `${what} is missing or is not a number.` };
    if (v <= 0) return { code: "invalid", accepted: false, message: `${what} must be above zero.` };
    if (v < LIMITS.min || v > LIMITS.max) return { code: "invalid", accepted: false, message: `${what} must be between ${LIMITS.min} and ${LIMITS.max.toLocaleString("en-GB")}.` };
  }
  // Put the offer as a flow of good x one way and good y the other.
  const from = gives === "x" ? proposer : other;         // who hands over good x
  const x = Q.of(gives === "x" ? give : get), y = Q.of(gives === "x" ? get : give);
  const price = Q.div(y, x);
  const result = evaluate(model, from, x, y);
  const base = { price, from, x, y, ...result };
  if (!result.feasible[proposer]) return { ...base, code: "proposerCannot", accepted: false };
  if (!result.feasible[other]) return { ...base, code: "counterpartCannot", accepted: false };
  // Does the price suit the counterpart? Buying x, it wants to pay less than x costs it at home; selling x, more.
  const cost = model.countries[other].cost;
  const buysX = from === proposer;
  const side = cost === null ? (buysX ? 1 : -1) : buysX ? Q.cmp(cost, price) : Q.cmp(price, cost); // 1 good for it, 0 level, -1 bad
  const sign = result.outcome[other].sign;
  const code = sign > 0 ? "accept" : side < 0 ? "price" : side === 0 ? "edge" : "quantity";
  return { ...base, code, accepted: sign > 0, side };
}

/**
 * An example offer for the proposer that sits exactly on the counterpart's own cost, so that the counterpart gains
 * nothing: the edge of the range of prices. The goods flow the way comparative advantage says, and the amounts are
 * the cost's numerator and denominator times a power of ten, sized at up to a quarter of what the countries can make.
 * Returns { proposer, gives, give, get }, or null when there is no such edge (no comparative advantage, a cost of
 * zero or none at all) or the fraction is too long to type.
 */
export function edgeOffer(model, proposer) {
  if (model.exporterX === null) return null;
  const A = model.exporterX, B = 1 - A;
  const price = proposer === A ? model.range.hi : model.range.lo; // the counterpart's cost of x
  if (price === null || Q.sign(price) === 0) return null;
  if (price.n.toString().length > 12 || price.d.toString().length > 12) return null;
  const room = proposer === A ? Q.min(model.countries[A].cap.x, model.countries[B].cap.x) : Q.min(model.countries[A].cap.x, Q.div(model.countries[B].cap.y, price));
  const target = Q.num(room) / 4;
  if (!(target > 0)) return null;
  const e = Math.floor(Math.log10(target / Number(price.d)));
  const x = Number(`${price.d}e${e}`), y = Number(`${price.n}e${e}`);
  if (![x, y].every((v) => v >= LIMITS.min && v <= LIMITS.max)) return null;
  return proposer === A ? { proposer, gives: "x", give: x, get: y } : { proposer, gives: "y", give: y, get: x };
}

/** A fraction as a number for display. null (no limit, or "cannot make it") stays null. */
export const num = (q) => (q === null ? null : Q.num(q));
