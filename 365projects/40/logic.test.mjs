import test from "node:test";
import assert from "node:assert/strict";
import { SHOCKS, LIMITS, simulate, clear, demandCurve, supplyCurve, curvePoints, bandPoints, reading, movement, amount, show, change, share } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const rel = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${a} is not within ${tol} (relative) of ${b}`);
const base = { family: "linear", p0: 10, q0: 100, ed: 0.5, es: 1, shock: "tax", size: 3, world: 7 };
const run = (over) => simulate({ ...base, ...over });

/** Adaptive Simpson's rule, written here so the areas are checked by something other than the model's own integrals. */
function integrate(f, a, b, tol) {
  const rule = (fa, fm, fb, h) => ((fa + 4 * fm + fb) * h) / 6;
  const step = (a, fa, m, fm, b, fb, whole, tol, depth) => {
    const lm = (a + m) / 2, rm = (m + b) / 2, flm = f(lm), frm = f(rm);
    const left = rule(fa, flm, fm, m - a), right = rule(fm, frm, fb, b - m);
    if (depth <= 0 || Math.abs(left + right - whole) <= 15 * tol) return left + right + (left + right - whole) / 15;
    return step(a, fa, lm, flm, m, fm, left, tol / 2, depth - 1) + step(m, fm, rm, frm, b, fb, right, tol / 2, depth - 1);
  };
  const fa = f(a), fb = f(b), m = (a + b) / 2, fm = f(m);
  return step(a, fa, m, fm, b, fb, rule(fa, fm, fb, b - a), tol, 48);
}
/**
 * Area of a shaded region from its outline alone. Where the outline runs off to infinity at its left edge (a demand
 * curve that never meets the price axis) the quantity is swapped for its sixth root, which tames the spike.
 */
const outlineArea = (region) => region.parts.reduce((sum, p) => {
  const height = (q) => Math.max(0, p.hi(q) - p.lo(q));
  const w = p.qb - p.qa, k = Number.isFinite(height(p.qa)) ? 1 : 6;
  const g = (s) => (s === 0 && k > 1 ? 0 : height(p.qa + w * s ** k) * k * w * s ** (k - 1));
  // Cut into pieces first so that a kink inside the part cannot hide from the first few sample points.
  let s = 0;
  const pieces = 64;
  for (let i = 0; i < pieces; i++) s += integrate(g, i / pieces, (i + 1) / pieces, 1e-11 * Math.max(1, region.area) / pieces);
  return sum + s;
}, 0);

/**
 * Surplus counted one small unit at a time, from each unit's value to its buyer and cost to its seller.
 * Units traded both before and after only see the price change, so an unbounded value never has to be read.
 */
function byUnits({ value, costBefore, costAfter, before, after, n = 200000 }) {
  const top = Math.max(before.bought, after.bought, before.made, after.made);
  const dq = top / n;
  let consumers = 0, producers = 0;
  for (let i = 0; i < n; i++) {
    const q = (i + 0.5) * dq;
    const b0 = q < before.bought, b1 = q < after.bought;
    if (b0 && b1) consumers += (before.pb - after.pb) * dq;
    else if (b0) consumers -= (value(q) - before.pb) * dq;
    else if (b1) consumers += (value(q) - after.pb) * dq;
    const m0 = q < before.made, m1 = q < after.made;
    if (m0 && m1) producers += ((after.ps - costAfter(q)) - (before.ps - costBefore(q))) * dq;
    else if (m0) producers -= (before.ps - costBefore(q)) * dq;
    else if (m1) producers += (after.ps - costAfter(q)) * dq;
  }
  return { consumers, producers };
}
function unitsFor(r) {
  const made = (s) => s.made ?? s.q;
  return byUnits({
    value: r.D.p, costBefore: r.S.p, costAfter: (r.S1 || r.S).p,
    before: { bought: r.before.q, made: made(r.before), pb: r.before.pb, ps: r.before.ps },
    after: { bought: r.after.q, made: made(r.after), pb: r.after.pb ?? 0, ps: r.after.ps ?? 0 },
  });
}

/* ------------------------------------------------------------- by hand */

test("a tax on straight lines, worked by hand: Qd = 150 - 5P, Qs = 10P, tax 3", () => {
  const r = run({});
  assert.equal(r.status, "changed");
  close(r.after.pb, 12); close(r.after.ps, 9); close(r.after.q, 90);
  close(r.welfare.consumers, -190);      // 2 x 90 + half of 2 x 10
  close(r.welfare.producers, -95);       // 1 x 90 + half of 1 x 10
  close(r.welfare.government, 270);
  close(r.welfare.loss, 15);             // half of 3 x 10
  close(r.incidence.buyers, 2 / 3); close(r.incidence.sellers, 1 / 3);
  assert.deepEqual(r.regions.map((x) => [x.key, Math.round(x.area * 1e9) / 1e9]), [["taxBuyers", 180], ["taxSellers", 90], ["dwlBuyers", 10], ["dwlSellers", 5]]);
});

test("a subsidy on the same lines, worked by hand: subsidy 3 gives 8 to buyers, 11 to sellers, 110 traded", () => {
  const r = run({ shock: "subsidy" });
  close(r.after.pb, 8); close(r.after.ps, 11); close(r.after.q, 110);
  close(r.welfare.consumers, 210); close(r.welfare.producers, 105); close(r.welfare.government, -330); close(r.welfare.loss, 15);
});

test("supply moves on straight lines, worked by hand", () => {
  // Strike, 40% shut: Qs = 0.6 x 10P = 6P. 150 - 5P = 6P gives P = 150/11.
  const s = run({ shock: "strike", size: 40 });
  close(s.after.pb, 150 / 11); close(s.after.q, 900 / 11);
  close(s.welfare.producers, 0.5 * (150 / 11) * (900 / 11) - 500);
  // Drought, 20% lost: Qs = 0.8 x 10 x 0.8P = 6.4P. P = 150/11.4.
  const d = run({ shock: "drought", size: 20 });
  close(d.after.pb, 150 / 11.4); close(d.after.q, 6.4 * 150 / 11.4);
  // Dearer inputs, 3 a unit: Qs = 10(P - 3), the same prices as the tax, but nobody collects the 3.
  const c = run({ shock: "cost", size: 3 });
  close(c.after.pb, 12); close(c.after.q, 90);
  close(c.welfare.consumers, -190); close(c.welfare.producers, -95); close(c.welfare.government, 0); close(c.welfare.loss, 285);
});

test("price controls on straight lines, worked by hand", () => {
  // Ceiling 8: sellers offer 80, buyers want 110. The 80th unit is worth 14 to its buyer.
  const c = run({ shock: "ceiling", size: 8 });
  close(c.after.q, 80); close(c.shortage, 30);
  close(c.welfare.producers, -(2 * 80 + 0.5 * 2 * 20));          // -180
  close(c.welfare.consumers, 2 * 80 - 0.5 * 4 * 20);             // +120
  close(c.welfare.loss, 60);
  // Floor 12: buyers take 90, sellers would offer 120. The 90th unit costs 9 to make.
  const f = run({ shock: "floor", size: 12 });
  close(f.after.q, 90); close(f.glut, 30);
  close(f.welfare.consumers, -190); close(f.welfare.producers, 2 * 90 - 0.5 * 1 * 10); close(f.welfare.loss, 15);
});

test("trade on straight lines, worked by hand: world price 7", () => {
  // At 7: buyers take 115, home producers make 70, 45 is imported.
  const b = run({ shock: "ban" });
  close(b.before.q, 115); close(b.before.made, 70); close(b.before.imports, 45);
  close(b.after.pb, 10); close(b.after.q, 100); close(b.after.imports, 0);
  close(b.welfare.consumers, -(3 * 100 + 0.5 * 3 * 15));         // -322.5
  close(b.welfare.producers, 3 * 70 + 0.5 * 3 * 30);             // +255
  close(b.welfare.loss, 67.5);
  // Tariff 2: price 9, buyers take 105, home producers make 90, imports 15, revenue 30.
  const t = run({ shock: "tariff", size: 2 });
  close(t.after.pb, 9); close(t.after.q, 105); close(t.after.made, 90); close(t.after.imports, 15);
  close(t.welfare.government, 30); close(t.welfare.producers, 2 * 70 + 0.5 * 2 * 20); close(t.welfare.consumers, -(2 * 105 + 0.5 * 2 * 10));
  close(t.welfare.loss, 0.5 * 2 * 20 + 0.5 * 2 * 10);
  // A tariff of 3 or more is a ban by another name.
  for (const size of [3, 50]) {
    const p = run({ shock: "tariff", size });
    assert.equal(p.prohibitive, true);
    close(p.welfare.loss, 67.5); close(p.welfare.government, 0); close(p.after.imports, 0);
  }
});

test("constant elasticity without a wedge has a closed form", () => {
  const ce = { family: "ce", ed: 0.5, es: 1 };
  // Strike 20%: 0.8 (P/10)^1 = (P/10)^-0.5, so P = 10 x 1.25^(2/3).
  const s = run({ ...ce, shock: "strike", size: 20 });
  rel(s.after.pb, 10 * 1.25 ** (2 / 3), 1e-12); rel(s.after.q, 100 * 1.25 ** (-1 / 3), 1e-12);
  // Drought 20%: 0.8 (0.8 P/10) = (P/10)^-0.5, so P = 10 x 0.64^(-2/3).
  const d = run({ ...ce, shock: "drought", size: 20 });
  rel(d.after.pb, 10 * 0.64 ** (-2 / 3), 1e-12);
  // Unit elasticities, tax 5: (P - 5)/10 = 10/P, so P^2 - 5P - 100 = 0.
  const t = run({ family: "ce", ed: 1, es: 1, shock: "tax", size: 5 });
  rel(t.after.pb, (5 + Math.sqrt(425)) / 2, 1e-12);
  rel(t.welfare.consumers, -1000 * Math.log(t.after.pb / 10), 1e-12);
  rel(t.welfare.producers, -(100 / 20) * (100 - t.after.ps ** 2), 1e-12);
});

test("the solver at the extremes: a wedge far larger than one of the prices loses no digits", () => {
  // Unit elasticities have closed forms. With a tax t: pb^2 - t pb - p0^2 = 0, so sellers keep 2 p0^2 / (t + sqrt(t^2 + 4 p0^2)).
  // With a subsidy s the same expression is the price buyers pay. Written this way neither is a difference of near-equal numbers.
  const small = (p0, size) => (2 * p0 * p0) / (size + Math.sqrt(size * size + 4 * p0 * p0));
  for (const [p0, size] of [[10, 1e5], [0.01, 5000], [1e6, 1e6], [10, 1e-5], [250, 3]]) {
    const t = run({ family: "ce", p0, ed: 1, es: 1, shock: "tax", size }), low = small(p0, size);
    rel(t.after.ps / low, 1, 1e-12); rel(t.after.pb / (low + size), 1, 1e-12); rel(t.after.q / (100 * p0 / (low + size)), 1, 1e-12);
  }
  // A subsidy 500 times the price is the largest whose cost stays under the page's limit of a million times spending.
  for (const [p0, size] of [[10, 5000], [0.01, 5], [1e6, 1e6], [10, 1e-5], [250, 3]]) {
    const s = run({ family: "ce", p0, ed: 1, es: 1, shock: "subsidy", size }), low = small(p0, size);
    rel(s.after.pb / low, 1, 1e-12); rel(s.after.ps / (low + size), 1, 1e-12); rel(s.after.q / (100 * (low + size) / p0), 1, 1e-12);
  }
  // Any elasticities: the answer goes back into both curves, each price read from its own.
  for (const p0 of [0.01, 10, 1e6]) for (const ed of [0.05, 0.3, 1, 5, 20]) for (const es of [0.05, 0.5, 1, 5, 20]) for (const f of [1e-5, 0.01, 0.9, 30, 3000]) for (const shock of ["tax", "subsidy", "cost"]) {
    const size = Math.min(1e6, f * p0), r = run({ family: "ce", p0, ed, es, shock, size });
    if (!r.ok) { assert.match(r.error, /more than a million times|too small|push the price buyers pay to zero/); continue; }
    const { pb, ps, q } = r.after;
    rel(q / (100 * (pb / p0) ** -ed), 1, 1e-9);                                  // on the demand curve at the buyers' price
    const net = shock === "cost" ? p0 * (q / 100) ** (1 / es) : ps;             // what the sellers of the q-th unit need
    rel(q / (100 * (net / p0) ** es), 1, 1e-9);                                 // on the supply curve at the sellers' price
    // And the wedge is exact. It is checked on the larger price, where adding it loses nothing: taking a subsidy away from
    // the sellers' price to recover a buyers' price a million times smaller would test the subtraction, not the solver.
    if (shock === "subsidy") rel((pb + size) / ps, 1, 1e-12); else rel((net + size) / pb, 1, 1e-12);
  }
});

test("results the page cannot show are refused: a shock too small to see, or one that moves the market a million-fold", () => {
  // Too small: less than a millionth of the price, or of one per cent.
  for (const [over, field] of [[{ size: 1e-300 }, "size"], [{ size: 9.9e-6 }, "size"], [{ shock: "subsidy", size: 1e-9 }, "size"], [{ shock: "cost", size: 1e-7 }, "size"], [{ shock: "tariff", size: 1e-7 }, "size"], [{ shock: "drought", size: 1e-7 }, "size"], [{ shock: "strike", size: 1e-300 }, "size"]]) {
    const r = run(over);
    assert.equal(r.ok, false, JSON.stringify(over)); assert.equal(r.field, field); assert.match(r.error, /too small|this small/);
  }
  assert.equal(run({ size: 1e-5 }).ok, true);                 // exactly a millionth of the price of 10
  assert.equal(run({ shock: "drought", size: 1e-6 }).ok, true);
  // The smallest tax allowed still has a loss, and it is printed, not rounded to "nothing is lost".
  const tiny = run({ size: 1e-5 });
  rel(tiny.welfare.loss, 0.5 * 1e-10 * (5 * 10) / 15, 1e-6);
  assert.match(reading(tiny).join(" "), /the government gains 0\.001\. Taken together that is a deadweight loss of less than 0\.000000001\./);
  assert.equal(amount(1.7e-10), "less than 0.000000001"); assert.equal(amount(1e-9), "0.000000001"); assert.equal(amount(4.9e-5), "0.000049");
  // A pure transfer is exactly nothing lost, with no rounding dust of either sign.
  for (const over of [{ es: 0, shock: "ceiling", size: 8 }, { ed: 0, size: 3 }, { es: 0, size: 3 }, { ed: 0, shock: "floor", size: 13 }]) {
    const r = run(over);
    assert.equal(r.welfare.loss, 0, JSON.stringify(over)); assert.equal(r.welfare.total, 0); assert.ok(Object.is(r.welfare.loss, 0));
  }
  // Too far: every line below would otherwise print a number dozens of digits long.
  for (const [over, field] of [[{ family: "ce", ed: 0.01, es: 0.01, shock: "drought", size: 90 }, "size"], [{ family: "ce", p0: 0.01, ed: 20, size: 1e6 }, "size"], [{ family: "ce", ed: 0.3, es: 5, shock: "subsidy", size: 100 }, "size"],
    [{ p0: 1e6, shock: "ceiling", size: 0.01 }, "size"], [{ p0: 0.01, shock: "floor", family: "ce", size: 1e6 }, "size"], [{ family: "ce", es: 3, shock: "ban", world: 0.01 }, "world"]]) {
    const r = run(over);
    assert.equal(r.ok, false, JSON.stringify(over)); assert.equal(r.field, field); assert.match(r.error, /more than a million times, or less than a millionth/);
  }
  // Prices and quantity in range, but the buyers' loss is not: elasticity 0.01 values the 50th unit at 10 x 2^100.
  const absurd = run({ family: "ce", ed: 0.01, es: 1, shock: "ceiling", size: 5 });
  assert.equal(absurd.ok, false); assert.equal(absurd.field, "size"); assert.match(absurd.error, /more than a million times what buyers spent before/);
  // Large but inside the limit is still answered: the write-up's own warning case, a price 75 times higher.
  assert.equal(run({ family: "ce", ed: 0.3, es: 0.5, shock: "drought", size: 90 }).ok, true);
  assert.equal(LIMITS.far, 1e6); assert.equal(LIMITS.small, 1e-6);
  // Whatever is answered, no figure in a sentence or a table is more than a million-fold from where it began.
  for (const p0 of [0.01, 1e6]) for (const q0 of [0.01, 1e9]) for (const family of ["linear", "ce"]) for (const ed of [0.01, 1, 20]) for (const es of [0.01, 1, 20]) for (const shock of SHOCKS) for (const f of [1e-6, 0.5, 2, 1e8]) {
    const size = shock.size === "share" ? Math.min(90, f * 40) : Math.max(0.01, Math.min(1e6, f * p0));
    const r = simulate({ family, p0, q0, ed, es, shock: shock.key, size, world: Math.max(0.01, 0.5 * p0) });
    if (!r.ok) continue;
    for (const line of reading(r)) { assert.doesNotMatch(line, /NaN|undefined|Infinity|null|\d{16}|[\d,]{26}/, line); assert.ok(line.length < 420, line); }
  }
});

/* ---------------------------------------------- equilibrium, checked apart */

test("the market clears: demand equals supply at the prices returned, for every curve shape and wedge", () => {
  for (const family of ["linear", "ce"]) for (const ed of [0.2, 1, 3]) for (const es of [0.3, 1, 4]) for (const move of [{ t: 2.5 }, { t: -2 }, { u: 4 }, { kq: 0.6 }, { kq: 0.7, kp: 0.7 }, { kq: 0.5, t: 1 }]) {
    const D = demandCurve(family, 10, 100, ed), S = supplyCurve(family, 10, 100, es);
    const eq = clear(D, S, move);
    if (eq.closed || eq.tooGenerous) continue;
    const { kq = 1, kp = 1, u = 0 } = move;
    const offered = kq * S.q(kp * (eq.ps - u));
    // Sellers at a price of zero offer anything up to what they have: the linear curve with es < 1 starts on the quantity axis.
    if (eq.ps - u <= 1e-12) assert.ok(eq.q <= offered + 1e-9); else rel(eq.q, offered, 1e-9);
    rel(eq.q, D.q(eq.pb), 1e-9);
    // A second search, written apart: the buyers' price at which excess demand changes sign.
    const excess = (pb) => D.q(pb) - kq * S.q(kp * (pb - (move.t || 0) - u));
    let lo = 1e-9, hi = 1e6;
    for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2; if (excess(mid) > 0) lo = mid; else hi = mid; }
    rel(eq.pb, (lo + hi) / 2, 1e-7);
  }
});

test("textbook results: incidence follows the elasticities, and the deadweight loss of a tax grows with its square", () => {
  for (const [ed, es] of [[0.5, 1], [2, 0.5], [1, 1], [0.1, 5]]) {
    const r = run({ ed, es, size: 1 });
    rel(r.incidence.buyers, es / (es + ed), 1e-12);
    // Straight lines: DWL = t^2 / 2 x bd / (b + d), with b = ed q0 / p0 and d = es q0 / p0.
    rel(r.welfare.loss, 0.5 * (10 * ed * 10 * es) / (10 * ed + 10 * es), 1e-12);
    rel(run({ ed, es, size: 2 }).welfare.loss, 4 * r.welfare.loss, 1e-12);
  }
  // Constant elasticity: the same shares in the limit of a small tax.
  const small = run({ family: "ce", ed: 0.5, es: 1.5, size: 0.001 });
  rel(small.incidence.buyers, 0.75, 1e-4);
});

test("a drought on constant-elasticity curves helps sellers exactly when demand is inelastic", () => {
  // With these curves sellers' surplus is revenue / (1 + es) before and after, so it moves with revenue.
  for (const es of [0.5, 2]) for (const ed of [0.2, 0.7, 1, 1.3, 4]) {
    const r = run({ family: "ce", ed, es, shock: "drought", size: 20 });
    const revenue = r.after.pb * r.after.q;
    rel(r.welfare.producers, (revenue - 1000) / (1 + es), 1e-10);
    if (ed === 1) close(r.welfare.producers, 0, 1e-9); else assert.equal(r.welfare.producers > 0, ed < 1);
  }
});

/* ------------------------------------------------------ areas and surplus */

const SHAPES = [];
for (const family of ["linear", "ce"]) for (const ed of [0, 0.3, 1, 2.5, Infinity]) for (const es of [0, 0.4, 1, 3, Infinity]) SHAPES.push({ family, ed, es });
const SIZES = { drought: [5, 20, 60, 90], strike: [5, 30, 90], cost: [0.5, 3, 9], tax: [0.5, 3, 9, 40], subsidy: [0.5, 3], ceiling: [9.5, 8, 4, 0.5], floor: [10.5, 12, 18, 40], ban: [0], tariff: [0.5, 2, 5] };

test("every shaded area equals its outline integrated numerically, and the areas add up to each group's change", () => {
  let checked = 0, results = 0;
  for (const shape of SHAPES) for (const shock of SHOCKS) for (const size of SIZES[shock.key]) for (const world of shock.world ? [7, 3] : [7]) {
    const r = run({ ...shape, shock: shock.key, size, world });
    if (!r.ok) continue;
    results++;
    const flow = { consumers: 0, producers: 0, government: 0, nobody: 0 };
    for (const reg of r.regions) {
      rel(outlineArea(reg), reg.area, 1e-7);
      flow[reg.from] -= reg.area;
      flow[reg.to] += reg.area;
      checked++;
    }
    const scale = 1e-9 * Math.max(1000, Math.abs(r.welfare.consumers), Math.abs(r.welfare.producers), Math.abs(r.welfare.government));
    close(flow.consumers, r.welfare.consumers, scale);
    close(flow.producers, r.welfare.producers, scale);
    close(flow.government, r.welfare.government, scale);
    close(flow.nobody, r.welfare.loss, scale);
    close(r.welfare.consumers + r.welfare.producers + r.welfare.government + r.welfare.loss, 0, scale);
    assert.ok(r.welfare.loss >= -scale, `a shock cannot create surplus: ${JSON.stringify({ ...shape, shock: shock.key, size })} gives ${r.welfare.loss}`);
  }
  assert.ok(results > 600 && checked > 1200, `${results} results and ${checked} areas were checked`);
});

test("the change in each group's surplus matches a count made one unit at a time", () => {
  let n = 0;
  for (const shape of SHAPES) for (const shock of SHOCKS) {
    const size = SIZES[shock.key][1] ?? SIZES[shock.key][0];
    const r = run({ ...shape, shock: shock.key, size });
    if (!r.ok || r.status !== "changed") continue;
    const u = unitsFor(r);
    const tol = 2e-4 * Math.max(100, Math.abs(r.welfare.consumers), Math.abs(r.welfare.producers));
    close(u.consumers, r.welfare.consumers, tol);
    close(u.producers, r.welfare.producers, tol);
    n++;
  }
  assert.ok(n > 200, `${n} cases were counted`);
});

test("every result can be drawn: no curve or outline holds a number that is not finite", () => {
  for (const shape of SHAPES) for (const shock of SHOCKS) for (const size of SIZES[shock.key]) {
    const r = run({ ...shape, shock: shock.key, size });
    if (!r.ok) { assert.ok(r.error.length > 20 && r.field); continue; }
    const c = curvePoints(r);
    assert.ok(Number.isFinite(c.xMax) && c.xMax > 0 && Number.isFinite(c.yMax) && c.yMax > 0);
    for (const line of [c.demand, c.supply, c.supplyAfter]) if (line) { assert.ok(line.length >= 2); for (const [q, p] of line) assert.ok(Number.isFinite(q) && Number.isFinite(p) && p >= 0 && q >= 0); }
    for (const reg of r.regions) for (const [q, lo, hi] of bandPoints(reg, c.yMax)) assert.ok(Number.isFinite(q) && Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo);
    for (const line of reading(r)) assert.doesNotMatch(line, /NaN|undefined|Infinity|null/);
    for (const v of [r.after.q, r.welfare.consumers, r.welfare.producers, r.welfare.government, r.welfare.loss]) assert.ok(Number.isFinite(v));
  }
});

/* -------------------------------------------------------------------- edges */

test("perfectly inelastic and perfectly elastic curves put the whole of a tax on one side", () => {
  const cases = [
    [{ ed: 0 }, 1, 0, 100],                 // vertical demand: buyers pay it all, quantity unchanged
    [{ es: Infinity }, 1, 0, 85],           // horizontal supply: buyers pay it all, quantity falls along demand
    [{ es: 0 }, 0, 1, 100],                 // vertical supply: sellers pay it all
    [{ ed: Infinity }, 0, 1, 70],           // horizontal demand: sellers pay it all, quantity falls along supply
  ];
  for (const family of ["linear", "ce"]) for (const [shape, buyers, sellers, q] of cases) {
    const r = run({ family, ...shape });
    close(r.incidence.buyers, buyers); close(r.incidence.sellers, sellers);
    if (family === "linear") close(r.after.q, q);
    if (q === 100) { close(r.welfare.loss, 0, 1e-9); close(r.welfare.government, 300); }
  }
});

test("two vertical curves or two horizontal ones are refused, with a reason", () => {
  assert.match(run({ ed: 0, es: 0 }).error, /Both curves are vertical/);
  assert.match(run({ ed: Infinity, es: Infinity }).error, /Both curves are horizontal/);
});

test("a floor or ceiling that does not bind changes nothing and says so", () => {
  for (const [shock, size, word] of [["ceiling", 12, "above"], ["ceiling", 10, "equal to"], ["floor", 8, "below"], ["floor", 10, "equal to"]]) {
    const r = run({ shock, size });
    assert.equal(r.status, "slack");
    assert.deepEqual(r.after, r.before);
    assert.equal(r.welfare.loss, 0);
    assert.equal(r.regions.length, 0);
    assert.match(reading(r)[0], new RegExp(`is ${word} the price the market reaches on its own, 10.00, so it does not bind`));
  }
});

test("a shock that closes the market: nothing is traded and both sides lose their whole surplus", () => {
  // Qd = 150 - 5P is zero at 30; Qs = 10P starts at 0. A tax of 30 or more leaves no trade.
  for (const size of [30, 45]) {
    const r = run({ size });
    assert.equal(r.status, "closed");
    assert.equal(r.after.q, 0);
    close(r.welfare.consumers, -1000); close(r.welfare.producers, -500); close(r.welfare.government, 0); close(r.welfare.loss, 1500);
    assert.match(reading(r)[0], /The market closes: nothing is traded/);
  }
  assert.equal(run({ size: 29.9 }).status, "changed");
  // Supply with elasticity 2 starts at a price of 5: a ceiling of 5 or less shuts it.
  const c = run({ es: 2, shock: "ceiling", size: 5 });
  assert.equal(c.status, "closed");
  close(c.welfare.loss, 1000 + 0.5 * 5 * 100);
  assert.match(reading(c)[0], /No seller will sell at 5.00 or less/);
  // A floor at the choke price of 30.
  const f = run({ shock: "floor", size: 30 });
  assert.equal(f.status, "closed");
  close(f.welfare.loss, 1500);
  // Dearer inputs and a drought can do it too when the supply curve starts above zero.
  assert.equal(run({ shock: "cost", size: 30 }).status, "closed");
  assert.equal(run({ es: 5, shock: "drought", size: 90 }).status, "closed");
  // A big tax on a supply curve that starts on the quantity axis pins the sellers' price at zero before it closes.
  const z = run({ es: 0.5, size: 22 });        // Qs = 50 + 5P; at a buyers' price of 22 demand is 40, less than 50
  close(z.after.ps, 0); close(z.after.pb, 22); close(z.after.q, 40);
});

test("a loss with no upper limit is refused rather than given a number", () => {
  // Vertical demand: any unit not supplied was worth any price to its buyer.
  assert.match(run({ ed: 0, shock: "ceiling", size: 8 }).error, /no upper limit/);
  // Constant elasticity below 1 with a ceiling under a flat supply curve: the market closes and the area is unbounded.
  assert.match(run({ family: "ce", ed: 0.8, es: Infinity, shock: "ceiling", size: 9 }).error, /closes the market/);
  // Above 1 the same area is finite: p0 q0 / (ed - 1).
  close(run({ family: "ce", ed: 3, es: Infinity, shock: "ceiling", size: 9 }).welfare.loss, 500);
});

test("shocks of size zero, a subsidy too large, and trade with nothing to import", () => {
  for (const shock of ["drought", "strike", "cost", "tax", "subsidy", "tariff"]) {
    const r = run({ shock, size: 0 });
    assert.equal(r.status, "none");
    assert.deepEqual(r.after, r.before);
    assert.equal(r.welfare.loss, 0);
  }
  assert.match(run({ shock: "subsidy", size: 40 }).error, /push the price buyers pay to zero or below/);
  assert.equal(run({ shock: "subsidy", size: 14 }).ok, true);
  for (const world of [10, 12]) for (const shock of ["ban", "tariff"]) {
    const r = run({ shock, world });
    assert.equal(r.status, "slack");
    assert.match(r.why, /nobody imports/);
  }
  assert.match(run({ ed: Infinity, shock: "ban" }).error, /imports have no limit/);
  // A strike against a flat supply curve is made good by the firms still working.
  assert.equal(run({ es: Infinity, shock: "strike", size: 50 }).status, "slack");
  // The same curve under a drought moves up: 10 / 0.8.
  close(run({ es: Infinity, shock: "drought", size: 20 }).after.pb, 12.5);
});

test("bad input is refused with a message that names the field", () => {
  const cases = [
    [{ p0: 0 }, "p0"], [{ p0: -5 }, "p0"], [{ p0: NaN }, "p0"], [{ p0: 1e308 }, "p0"], [{ p0: "10" }, "p0"],
    [{ q0: 0 }, "q0"], [{ q0: 1e10 }, "q0"], [{ q0: Infinity }, "q0"],
    [{ ed: -1 }, "ed"], [{ ed: 21 }, "ed"], [{ ed: NaN }, "ed"], [{ es: -0.1 }, "es"], [{ es: 1e9 }, "es"],
    [{ shock: "flood" }, "shock"], [{ family: "cubic" }, "family"],
    [{ shock: "drought", size: 91 }, "size"], [{ shock: "drought", size: -1 }, "size"], [{ shock: "strike", size: NaN }, "size"],
    [{ size: -3 }, "size"], [{ size: 1e7 }, "size"], [{ shock: "ceiling", size: 0 }, "size"], [{ shock: "floor", size: 1e9 }, "size"],
    [{ shock: "ban", world: 0 }, "world"], [{ shock: "tariff", world: NaN }, "world"],
  ];
  for (const [over, field] of cases) {
    const r = run(over);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.field, field);
    assert.ok(r.error.length > 20);
  }
  assert.equal(LIMITS.shareMax, 90);
  assert.equal(run({ shock: "ban", size: NaN }).ok, true);   // the ban has no size to get wrong
});

/* ----------------------------------------------------------------- wording */

test("numbers at the edges of what two decimals can show", () => {
  // Small prices and quantities keep three figures; ordinary ones keep their fixed decimals.
  assert.equal(show(0.0152), "0.0152"); assert.equal(show(0.5), "0.50"); assert.equal(show(0.1), "0.10"); assert.equal(show(0.099), "0.099");
  assert.equal(show(0.00882, 1), "0.00882"); assert.equal(show(88.2, 1), "88.2"); assert.equal(show(0, 1), "0.0"); assert.equal(show(0), "0.00");
  const small = reading(run({ family: "ce", p0: 0.01, q0: 0.01, ed: 0.3, es: 0.5, shock: "drought", size: 20 }))[0];
  assert.equal(small, "The price rises from 0.01 to 0.0152 (+52.0%) and the quantity traded falls from 0.01 to 0.00882 (-11.8%).");
  // A change in brackets: never a percentage in the thousands, never -100.0% for something that is left, never 0.0% for a change.
  assert.equal(change(10, 12), "+20.0%"); assert.equal(change(10, 9), "-10.0%"); assert.equal(change(10, 99.9), "+899.0%");
  assert.equal(change(10, 749.89), "75 times what it was"); assert.equal(change(10, 100), "10 times what it was");
  assert.equal(change(10, 0.0001), "down by more than 99.9%"); assert.equal(change(10, 0), "-100.0%");
  assert.equal(change(100, 100.01), "up by less than 0.05%"); assert.equal(change(100, 99.99), "down by less than 0.05%");
  assert.equal(change(0, 5), "");                              // a rise from nothing has no percentage
  assert.equal(movement(0, 100, 1), "rises from 0.0 to 100.0");
  assert.equal(movement(10, 749.89), "rises from 10.00 to 749.89 (75 times what it was)");
  assert.equal(movement(0.01, 0.010001), "rises by less than 0.005 from 0.01"); assert.equal(movement(0.0152, 0.01520001), "rises very slightly from 0.0152");
  // A share of spending for the tables and the loss tile.
  assert.equal(share(0.227), "+22.7%"); assert.equal(share(-0.486), "-48.6%"); assert.equal(share(0), "none");
  assert.equal(share(0.0001), "under 0.05%"); assert.equal(share(-0.0001), "under 0.05%"); assert.equal(share(14.884), "+14.9 times"); assert.equal(share(-27.9), "-27.9 times");
  // Horizontal supply under a ban: home output starts from nothing, and the sentence does not print a percentage of zero.
  assert.match(reading(run({ es: Infinity, shock: "ban" })).join(" "), /home producers make 0\.0 and 115\.0 is imported.*Home output rises from 0\.0 to 100\.0\. /);
  // A list whose amounts carry commas still ends in "and".
  assert.match(reading(run({ family: "ce", ed: 0.3, es: 0.5, shock: "drought", size: 90 })).join(" "), /Buyers lose 27,907\.50 and sellers gain 13,023\.50\. Taken together that is a net loss of 14,884\.00\./);
  assert.match(reading(run({ family: "ce", ed: 0.3, es: 0.5, size: 29 })).join(" "), /Buyers lose 1,923\.19, sellers lose 443\.97 and the government gains 2,012\.18\./);
  // Imports are a quantity, so the verb is singular.
  assert.match(reading(run({ shock: "tariff", size: 2 })).join(" "), /Home output rises from 70\.0 to 90\.0 \(\+28\.6%\) and the quantity imported falls from 45\.0 to 15\.0 \(-66\.7%\)\./);
  // A share of a tax that is not nothing is not printed as 0%.
  assert.match(reading(run({ family: "ce", p0: 1e6, q0: 1e9, ed: 0.01, es: 20, size: 1e6 })).join(" "), /Buyers bear more than 99% of the tax and sellers less than 1%/);
  assert.match(reading(run({})).join(" "), /Buyers bear 67% of the tax and sellers 33%/);
});

test("the diagram takes in a tall area where it can and says so where it cannot", () => {
  // Constant elasticity 0.5, ceiling 6: the last unit sold is worth 10 x 0.6^-2 = 27.8, well above every price in the result.
  const tall = run({ family: "ce", ed: 0.5, es: 1, shock: "ceiling", size: 6 });
  const c = curvePoints(tall);
  rel(tall.D.p(tall.after.q), 10 * 0.6 ** -2, 1e-12);
  assert.ok(c.yMax >= 27.8 && c.yMax <= 40, `axis top ${c.yMax}`); assert.equal(c.clipped, false);
  // Elasticity 0.3, ceiling 2: the last unit is worth 146, beyond four times the price. The axis stops at 40 and the result says it is clipped.
  const off = curvePoints(run({ family: "ce", ed: 0.3, es: 0.5, shock: "ceiling", size: 2 }));
  assert.equal(off.yMax, 40); assert.equal(off.clipped, true);
  // Ordinary results are untouched and never clipped.
  for (const over of [{}, { shock: "ceiling", size: 8 }, { shock: "floor", size: 12 }, { shock: "ban" }, { shock: "tariff", size: 2 }, { family: "ce", ed: 0.3, es: 0.5, shock: "drought", size: 20 }]) assert.equal(curvePoints(run(over)).clipped, false, JSON.stringify(over));
  // The polygon the chart draws is within 1% of the area in the table wherever nothing is clipped.
  for (const over of [{}, { shock: "cost", size: 3 }, { shock: "ceiling", size: 8 }, { shock: "ban" }, { shock: "tariff", size: 2 }, { family: "ce", ed: 0.5, es: 1, shock: "ceiling", size: 6 }, { family: "ce", ed: 1.5, es: 0.5, shock: "cost", size: 3 }]) {
    const r = run(over), top = curvePoints(r).yMax;
    for (const reg of r.regions) {
      const pts = bandPoints(reg, top), per = pts.length / reg.parts.length; let area = 0;
      for (let k = 0; k < reg.parts.length; k++) for (let i = k * per; i < (k + 1) * per - 1; i++) area += ((pts[i][2] - pts[i][1]) + (pts[i + 1][2] - pts[i + 1][1])) / 2 * (pts[i + 1][0] - pts[i][0]);
      rel(area / reg.area, 1, 0.01);
    }
  }
});

test("the sentences read properly in the small cases", () => {
  assert.equal(movement(10, 10), "stays at 10.00");
  assert.equal(movement(10, 12), "rises from 10.00 to 12.00 (+20.0%)");
  assert.equal(movement(10, 9), "falls from 10.00 to 9.00 (-10.0%)");
  assert.equal(movement(10, 10.001), "rises by less than 0.005 from 10.00");
  assert.equal(movement(100, 99.99, 1), "falls by less than 0.05 from 100.0");
  assert.equal(amount(0), "0.00");
  assert.equal(amount(0.0012), "0.0012");
  assert.equal(amount(1234.5), "1,234.50");
  assert.equal(amount(2.5e9), "2.5bn");
  // A tiny tax: no "from 10.00 to 10.00", no loss of "0.00".
  const tiny = reading(run({ size: 0.001 })).join(" ");
  assert.doesNotMatch(tiny, /from 10\.00 to 10\.00|loss of 0\.00[. ]|lose 0\.00[, ]/);
  // A pure transfer (ceiling on a fixed supply) loses nothing overall and says so.
  const transfer = reading(run({ es: 0, shock: "ceiling", size: 8 })).join(" ");
  assert.match(transfer, /Sellers lose 200.00 and buyers gain 200.00. Taken together nothing is lost/);
  // The government is "the government" wherever it falls in the list.
  assert.match(reading(run({})).join(" "), /Buyers lose 190.00, sellers lose 95.00 and the government gains 270.00/);
  assert.match(reading(run({ shock: "subsidy" })).join(" "), /The government loses 330.00, buyers gain 210.00 and sellers gain 105.00/);
  assert.match(reading(run({ shock: "ceiling", size: 8 })).join(" "), /so 30.0 of demand goes unmet/);
  assert.match(reading(run({ ed: Infinity, shock: "ceiling", size: 8 })).join(" "), /buyers would take any amount/);
  assert.match(reading(run({ es: Infinity, shock: "floor", size: 12 })).join(" "), /sellers would offer any amount/);
  assert.match(reading(run({ shock: "ban" })).join(" "), /45.0 is imported.*The ban stops all imports, so the price rises from 7.00 to 10.00/);
});

/* ------------------------------------------------------------- the finding */

test("the finding on the page: a drought that helps sellers as a group", () => {
  // The page as it loads: constant-elasticity curves, demand 0.3, supply 0.5, a fifth of every harvest lost.
  const r = simulate({ family: "ce", p0: 10, q0: 100, ed: 0.3, es: 0.5, shock: "drought", size: 20, world: 7 });
  assert.equal(r.after.pb.toFixed(2), "15.20");
  assert.equal(r.after.q.toFixed(1), "88.2");
  assert.equal((r.after.pb / 10 - 1).toFixed(2), "0.52");
  assert.equal((1 - r.after.q / 100).toFixed(3), "0.118");
  assert.equal(r.welfare.consumers.toFixed(0), "-486");
  assert.equal(r.welfare.producers.toFixed(0), "227");
  assert.equal(r.welfare.loss.toFixed(0), "259");
  assert.ok(reading(r).some((line) => /Sellers as a group come out ahead/.test(line)));
  // The same drought with demand elasticity 1.5 hurts them.
  // The warning in the write-up: the same market with 90% of every harvest lost has a price 75 times higher.
  assert.equal((simulate({ family: "ce", p0: 10, q0: 100, ed: 0.3, es: 0.5, shock: "drought", size: 90, world: 7 }).after.pb / 10).toFixed(1), "75.0");
  const elastic = simulate({ family: "ce", p0: 10, q0: 100, ed: 1.5, es: 0.5, shock: "drought", size: 20, world: 7 });
  assert.equal(elastic.welfare.producers.toFixed(0), "-54");
  assert.equal(elastic.welfare.consumers.toFixed(0), "-161");
  // The figures quoted under "The idea": the "Tax on a necessity" example raises 284, costs buyers and sellers 292, loses 8.
  const tax = simulate({ family: "linear", p0: 10, q0: 100, ed: 0.2, es: 2, shock: "tax", size: 3, world: 7 });
  assert.equal(tax.welfare.government.toFixed(0), "284");
  assert.equal((-tax.welfare.consumers - tax.welfare.producers).toFixed(0), "292");
  assert.equal(tax.welfare.loss.toFixed(0), "8");
  // And "Rent ceiling": buyers gain while the total shrinks.
  const rent = simulate({ family: "linear", p0: 10, q0: 100, ed: 0.5, es: 0.5, shock: "ceiling", size: 8, world: 7 });
  assert.ok(rent.welfare.consumers > 0 && rent.welfare.loss > 0);
  close(rent.welfare.consumers, 170); close(rent.welfare.loss, 20);
});
