import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  etiBase, etiRevenue, etiPeak, saezTopRate, hours, labourRevenue, labourPeak, MODELS, base, revenue, peak, offset, side,
  curve, PARAMS, peakCurve, sensitivity, percent,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
/** The best rate on a fine grid, found without the closed forms. */
const gridPeak = (f, n = 200000) => { let best = 0, at = 0; for (let i = 0; i <= n; i++) { const t = i / n, r = f(t); if (r > best) { best = r; at = t; } } return at; };

/* ---------- elasticity of taxable income ---------- */

test("the published numbers: Diamond and Saez (2011) and Saez, Slemrod and Giertz (2012)", () => {
  // Diamond and Saez: "With the Pareto parameter a = 1.5, if e = .25 ... 1/(1 + 1.5 x .25) = 73 percent".
  close(etiPeak({ e: 0.25, a: 1.5 }), 1 / 1.375, 1e-15);
  assert.equal(percent(etiPeak({ e: 0.25, a: 1.5 }), 0), "73%");
  // Their two illustrations from Gruber and Saez's estimates: e = 0.57 gives 54 percent, e = 0.17 gives 80 percent.
  assert.equal(percent(etiPeak({ e: 0.57, a: 1.5 }), 0), "54%");
  assert.equal(percent(etiPeak({ e: 0.17, a: 1.5 }), 0), "80%");
  // "The current rate 42.5 percent would be optimal only if the elasticity e were extremely high, equal to 0.9."
  close(etiPeak({ e: 0.9, a: 1.5 }), 0.425, 0.001);
  // Their note 6: with a social weight g on top earners the rate is (1 - g) / (1 - g + a e), below the peak.
  close(etiPeak({ e: 0.25, a: 1.5, g: 0.2 }), 0.8 / 1.175, 1e-15);
  assert.ok(etiPeak({ e: 0.25, a: 1.5, g: 0.2 }) < etiPeak({ e: 0.25, a: 1.5 }));
  // The review's range of "best available estimates", 0.12 to 0.40, and its midpoint 0.25, for a flat tax and a top bracket.
  assert.deepEqual([0.12, 0.25, 0.40].map((e) => percent(etiPeak({ e, a: 1 }))), ["89.3%", "80.0%", "71.4%"]);
  assert.deepEqual([0.12, 0.25, 0.40].map((e) => percent(etiPeak({ e, a: 1.5 }))), ["84.7%", "72.7%", "62.5%"]);
});

test("Saez (2001), equation 9, and its special cases", () => {
  // No income effects (zu = zc): 1 / (1 + a e), "with a around 2 for the U.S." in that paper.
  close(saezTopRate({ zu: 0.25, zc: 0.25, a: 2 }), etiPeak({ e: 0.25, a: 2 }), 1e-15);
  close(saezTopRate({ zu: 0.25, zc: 0.25, a: 2 }), 2 / 3, 1e-15);
  // By hand: zu = 0.2, zc = 0.5, a = 2, g = 0: 1 / (1 + 0.2 + 0.5) = 0.588...
  close(saezTopRate({ zu: 0.2, zc: 0.5, a: 2 }), 1 / 1.7, 1e-15);
  close(saezTopRate({ zu: 0.2, zc: 0.5, a: 2, g: 0.25 }), 0.75 / 1.45, 1e-15);
  // For a given compensated elasticity, larger income effects (a smaller uncompensated elasticity) mean a higher rate.
  assert.ok(saezTopRate({ zu: 0, zc: 0.5, a: 2 }) > saezTopRate({ zu: 0.5, zc: 0.5, a: 2 }));
  // A flat tax on everyone (a = 1) depends on the uncompensated elasticity alone.
  close(saezTopRate({ zu: 0.3, zc: 0.9, a: 1 }), 1 / 1.3, 1e-15);
  assert.throws(() => saezTopRate({ zu: -1.5, zc: 0.2, a: 1.5 }), RangeError);
  assert.throws(() => saezTopRate({ zu: 0.2, zc: 0.2, a: 0.5 }), RangeError);
  assert.throws(() => saezTopRate({ zu: 0.2, zc: 0.2, a: 2, g: 1 }), RangeError);
});

test("the closed-form peak is the peak: a grid search over the revenue curve finds the same rate", () => {
  for (const [e, a] of [[0.25, 1], [0.25, 1.5], [0.12, 1.5], [0.4, 1.5], [0.57, 1.5], [1.5, 3], [0.01, 1.1]]) {
    const at = gridPeak((t) => etiRevenue(t, { e, a }));
    close(at, etiPeak({ e, a }), 1e-5);
    // The curve is zero at both ends and positive in between.
    assert.equal(etiRevenue(0, { e, a }), 0);
    assert.equal(etiRevenue(1, { e, a }), 0);
    assert.ok(etiRevenue(0.5, { e, a }) > 0);
  }
  // By hand: e = 1, a = 1: revenue is t (1 - t), a parabola with its peak of 0.25 at 50%.
  close(etiRevenue(0.5, { e: 1, a: 1 }), 0.25, 1e-15);
  close(etiRevenue(0.3, { e: 1, a: 1 }), 0.21, 1e-15);
  close(etiPeak({ e: 1 }), 0.5, 1e-15);
});

test("the top-bracket curve t (1 - t)^(a e) matches revenue counted over simulated Pareto incomes", () => {
  // 200,000 incomes from a Pareto tail with a = 1.5; each shrinks to z0 (1 - t)^e; tax is t times income above 1.
  const a = 1.5, e = 0.25, r = rng(45);
  const z0 = Array.from({ length: 200000 }, () => { let u = 0; while (u === 0) u = r(); return u ** (-1 / a); });
  const collected = (t) => { const k = (1 - t) ** e; let s = 0; for (const z of z0) if (z * k > 1) s += z * k - 1; return t * s; };
  const reference = collected(0.3);
  for (const t of [0.1, 0.5, 0.7, 0.9]) close(collected(t) / reference, etiRevenue(t, { e, a }) / etiRevenue(0.3, { e, a }), 0.01);
  // The simulated curve peaks where the formula says, 1 / (1 + 1.5 x 0.25) = 72.7%, to within the grid and sampling error.
  let best = 0, at = 0;
  for (let i = 1; i < 100; i++) { const v = collected(i / 100); if (v > best) { best = v; at = i / 100; } }
  close(at, etiPeak({ e, a }), 0.02);
});

test("no response means no peak, and bad parameters are refused", () => {
  assert.equal(etiPeak({ e: 0 }), 1);
  assert.equal(etiBase(1, { e: 0 }), 1);
  assert.equal(etiRevenue(1, { e: 0, a: 2 }), 1);
  assert.deepEqual(peak("eti", { e: 0, a: 1.5 }), { tau: 1, interior: false });
  assert.deepEqual(peak("eti", { e: 0.25 }), { tau: 0.8, interior: true });
  for (const bad of [{ e: -0.1 }, { e: NaN }, { e: Infinity }, { e: 0.2, a: 0.9 }, { e: 0.2, a: NaN }]) {
    assert.throws(() => etiBase(0.5, bad), RangeError);
    assert.throws(() => etiPeak(bad), RangeError);
  }
  for (const t of [-0.01, 1.01, NaN, Infinity]) assert.throws(() => etiBase(t, { e: 0.2 }), RangeError);
  assert.throws(() => etiPeak({ e: 0.2, g: 1 }), RangeError);
  assert.throws(() => etiPeak({ e: 0.2, g: -0.1 }), RangeError);
});

/* ---------- labour supply with an income effect ---------- */

/** The household's own problem, solved without the formula: best hours given the tax and a lump sum taken as given. */
function chosenHours(tau, { gamma, frisch, rebate }) {
  const u = (c, h) => (gamma === 1 ? Math.log(c) : c ** (1 - gamma) / (1 - gamma)) - h ** (1 + 1 / frisch) / (1 + 1 / frisch);
  let h = 1;
  for (let round = 0; round < 400; round++) {
    const lump = rebate * tau * h; // what the government hands back, given what everyone like this household works
    let lo = 1e-9, hi = 5;
    for (let i = 0; i < 80; i++) { // ternary search: utility is concave in hours
      const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (u((1 - tau) * m1 + lump, m1) < u((1 - tau) * m2 + lump, m2)) lo = m1; else hi = m2;
    }
    const next = (lo + hi) / 2;
    if (Math.abs(next - h) < 1e-11) break;
    h = 0.5 * h + 0.5 * next;
  }
  return h;
}

test("the hours formula is the household's best choice, found again by direct search", () => {
  for (const p of [{ gamma: 1, frisch: 1, rebate: 1 }, { gamma: 1, frisch: 1, rebate: 0 }, { gamma: 0.5, frisch: 0.5, rebate: 0.4 }, { gamma: 0, frisch: 2, rebate: 0.7 }, { gamma: 0.8, frisch: 3, rebate: 0.1 }]) {
    for (const tau of [0, 0.2, 0.5, 0.8]) close(chosenHours(tau, p), hours(tau, p), 2e-6);
  }
});

test("hours by hand at the ends of the scale", () => {
  // No income effect: h = (1 - t)^frisch whatever is handed back.
  close(hours(0.36, { gamma: 0, frisch: 0.5, rebate: 0 }), 0.8, 1e-12);
  close(hours(0.36, { gamma: 0, frisch: 0.5, rebate: 1 }), 0.8, 1e-12);
  // Log utility, nothing handed back: hours do not move at all.
  for (const t of [0, 0.3, 0.9, 1]) assert.equal(hours(t, { gamma: 1, frisch: 2, rebate: 0 }), 1);
  // Log utility, everything handed back: h = (1 - t)^(frisch / (1 + frisch)); with frisch 1 that is the square root.
  close(hours(0.75, { gamma: 1, frisch: 1, rebate: 1 }), 0.5, 1e-12);
  // In between, by the formula: gamma 0.5, frisch 1, rebate 0.5, t = 0.4: k = 2/3, ((0.6) / (0.8)^0.5)^(2/3).
  close(hours(0.4, { gamma: 0.5, frisch: 1, rebate: 0.5 }), (0.6 / Math.sqrt(0.8)) ** (2 / 3), 1e-12);
  assert.equal(hours(0, { gamma: 0.3, frisch: 1.2, rebate: 0.6 }), 1);
  assert.equal(hours(1, { gamma: 0.3, frisch: 1.2, rebate: 0.6 }), 0);
  assert.equal(hours(1, { gamma: 0.3, frisch: 1.2, rebate: 0 }), 0);
});

test("the labour peak: closed forms at both ends, the grid in between, and no peak when hours do not respond", () => {
  // Everything handed back: 1 / (1 + k). Log utility with frisch 1 gives k = 1/2 and a peak of two thirds.
  close(labourPeak({ gamma: 1, frisch: 1, rebate: 1 }).tau, 2 / 3, 1e-9);
  close(labourPeak({ gamma: 1, frisch: 3, rebate: 1 }).tau, 1 / 1.75, 1e-9);
  close(labourPeak({ gamma: 0.5, frisch: 0.5, rebate: 1 }).tau, 1 / 1.4, 1e-9);
  // Nothing handed back: 1 / (1 + (1 - gamma) k), which is governed by the uncompensated elasticity (1 - gamma) k.
  close(labourPeak({ gamma: 0.5, frisch: 1, rebate: 0 }).tau, 1 / (1 + 0.5 * (2 / 3)), 1e-9);
  close(labourPeak({ gamma: 0, frisch: 0.25, rebate: 0 }).tau, 0.8, 1e-9);
  // No income effect: the answer does not depend on what is handed back, and equals the flat-tax formula with e = frisch.
  for (const rebate of [0, 0.3, 1]) close(labourPeak({ gamma: 0, frisch: 0.25, rebate }).tau, 0.8, 1e-9);
  // Log utility and nothing handed back: revenue is t itself, so there is no peak below 100%.
  assert.deepEqual(labourPeak({ gamma: 1, frisch: 1, rebate: 0 }), { tau: 1, interior: false });
  close(labourRevenue(0.9, { gamma: 1, frisch: 1, rebate: 0 }), 0.9, 1e-15);
  // Everything else: the bisection agrees with a grid search, and the peak falls as more is handed back.
  let last = 1;
  for (const rebate of [0.05, 0.25, 0.5, 0.75, 1]) {
    const p = { gamma: 1, frisch: 1, rebate };
    const top = labourPeak(p);
    assert.ok(top.interior);
    close(top.tau, gridPeak((t) => labourRevenue(t, p)), 1e-5);
    assert.ok(top.tau < last, "the peak should fall as the share handed back rises");
    last = top.tau;
  }
  for (const p of [{ gamma: 0.3, frisch: 2.2, rebate: 0.4 }, { gamma: 0.9, frisch: 0.1, rebate: 0.05 }, { gamma: 1, frisch: 3, rebate: 0.05 }]) close(labourPeak(p).tau, gridPeak((t) => labourRevenue(t, p)), 1e-5);
  for (const bad of [{ gamma: 1.2, frisch: 1, rebate: 0 }, { gamma: -0.1, frisch: 1, rebate: 0 }, { gamma: 1, frisch: 0, rebate: 0 }, { gamma: 1, frisch: 1, rebate: 1.5 }, { gamma: NaN, frisch: 1, rebate: 0 }]) {
    assert.throws(() => labourPeak(bad), RangeError);
    assert.throws(() => hours(0.5, bad), RangeError);
  }
});

/* ---------- both models ---------- */

test("the offset is the lost share of a small rate rise: checked against a numerical derivative, and 1 at the peak", () => {
  const cases = [["eti", { e: 0.25, a: 1.5 }], ["eti", { e: 0.4, a: 1 }], ["labour", { gamma: 1, frisch: 1, rebate: 1 }], ["labour", { gamma: 0.5, frisch: 2, rebate: 0.3 }]];
  for (const [model, p] of cases) {
    for (const tau of [0.1, 0.4, 0.7]) {
      const d = 1e-6, slope = (revenue(model, tau + d, p) - revenue(model, tau - d, p)) / (2 * d);
      close(offset(model, tau, p), 1 - slope / base(model, tau, p), 1e-6);
    }
    close(offset(model, peak(model, p).tau, p), 1, 1e-8);
    assert.equal(offset(model, 0, p), 0);
    assert.equal(offset(model, 1, p), Infinity);
  }
  // By hand: a e t / (1 - t) with a = 1.5, e = 0.25 at the 42.5% rate Diamond and Saez quote: 0.375 x 0.425 / 0.575.
  close(offset("eti", 0.425, { e: 0.25, a: 1.5 }), 0.375 * 0.425 / 0.575, 1e-15);
  assert.equal(percent(offset("eti", 0.425, { e: 0.25, a: 1.5 })), "27.7%");
  // Where nothing responds, nothing is lost.
  assert.equal(offset("eti", 0.5, { e: 0, a: 1 }), 0);
  assert.equal(offset("eti", 1, { e: 0, a: 1 }), 0);
  for (const t of [0.3, 0.99, 1]) close(offset("labour", t, { gamma: 1, frisch: 1, rebate: 0 }), 0, 1e-9);
  assert.throws(() => offset("eti", 1.2, { e: 0.2 }), RangeError);
  assert.throws(() => offset("other", 0.2, { e: 0.2 }), RangeError);
});

test("which side of the peak", () => {
  const p = { e: 0.25, a: 1.5 };
  assert.equal(side("eti", 0.4, p), "left");
  assert.equal(side("eti", 0.9, p), "right");
  assert.equal(side("eti", 1 / 1.375, p), "peak");
  assert.equal(side("eti", 0.7275, p), "peak");
  assert.equal(side("eti", 0.7279, p), "right");
  assert.equal(side("eti", 0.99, { e: 0, a: 1 }), "left");
  assert.equal(side("labour", 0.99, { gamma: 1, frisch: 1, rebate: 0 }), "left");
  assert.equal(side("labour", 0.8, { gamma: 1, frisch: 1, rebate: 1 }), "right");
});

test("the finding: the peak across the review's range, and the two ends of the labour model", () => {
  const top = (e) => percent(peak("eti", { e, a: 1.5 }).tau);
  assert.deepEqual([top(0.12), top(0.25), top(0.40)], ["84.7%", "72.7%", "62.5%"]);
  // At 42.5%: 0.425 x 0.575^0.375 = 0.3454 against 0.7273 x 0.2727^0.375 = 0.4468 at the peak.
  assert.equal(percent(revenue("eti", 0.425, { e: 0.25, a: 1.5 }) / revenue("eti", 1 / 1.375, { e: 0.25, a: 1.5 })), "77.3%");
  close(0.425 * Math.exp(0.375 * Math.log(0.575)), 0.3454, 5e-5);
  assert.equal(percent(labourPeak({ gamma: 1, frisch: 1, rebate: 1 }).tau), "66.7%");
  assert.equal(labourPeak({ gamma: 1, frisch: 1, rebate: 0 }).interior, false);
});

test("curves, sensitivity and formatting", () => {
  const c = curve("eti", { e: 0.25, a: 1.5 });
  assert.equal(c.length, 201);
  assert.deepEqual([c[0].tau, c[0].revenue, c.at(-1).tau, c.at(-1).revenue], [0, 0, 1, 0]);
  for (const q of c) assert.ok(Number.isFinite(q.revenue) && q.revenue >= 0 && q.revenue <= q.mechanical + 1e-12);
  for (const q of curve("labour", { gamma: 1, frisch: 1, rebate: 0 })) close(q.revenue, q.mechanical, 1e-12);
  for (const model of MODELS) for (const d of PARAMS[model]) {
    const start = model === "eti" ? { e: 0.25, a: 1.5 } : { gamma: 1, frisch: 1, rebate: 1 };
    const pc = peakCurve(model, start, d.key);
    assert.equal(pc.length, 101);
    close(pc[0].value, d.min, 1e-12); close(pc.at(-1).value, d.max, 1e-12);
    for (const q of pc) assert.ok(q.tau > 0 && q.tau <= 1);
  }
  // The peak falls as the elasticity rises, as the tail thins, as hours become more elastic and as more is handed back.
  const falling = (pts) => pts.every((q, i) => i === 0 || q.tau <= pts[i - 1].tau + 1e-12);
  assert.ok(falling(peakCurve("eti", { e: 0.25, a: 1.5 }, "e")));
  assert.ok(falling(peakCurve("eti", { e: 0.25, a: 1.5 }, "a")));
  assert.ok(falling(peakCurve("labour", { gamma: 1, frisch: 1, rebate: 1 }, "frisch")));
  assert.ok(falling(peakCurve("labour", { gamma: 1, frisch: 1, rebate: 1 }, "rebate")));
  // A stronger income effect raises the peak.
  assert.ok(falling([...peakCurve("labour", { gamma: 1, frisch: 1, rebate: 1 }, "gamma")].reverse()));
  assert.throws(() => peakCurve("eti", { e: 0.25, a: 1.5 }, "frisch"), RangeError);

  const s = sensitivity("eti", { e: 0.25, a: 1.5 });
  assert.deepEqual(s.map((r) => r.key), ["e", "a"]);
  assert.deepEqual([s[0].low, s[0].high], [0.125, 0.5]);
  close(s[0].atLow.tau, 1 / (1 + 1.5 * 0.125), 1e-12);
  close(s[0].atHigh.tau, 1 / 1.75, 1e-12);
  close(s[0].now.tau, 1 / 1.375, 1e-12);
  close(s[1].atLow.tau, 1 / (1 + 1.1 * 0.25), 1e-12);
  assert.deepEqual(sensitivity("eti", { e: 0.25, a: 1 }).map((r) => r.key), ["e"]); // a flat tax has no tail parameter
  const l = sensitivity("labour", { gamma: 1, frisch: 1, rebate: 1 });
  assert.deepEqual(l.map((r) => r.key), ["frisch", "gamma", "rebate"]);
  assert.equal(l[2].atLow.interior, false);
  close(l[1].atLow.tau, 0.5, 1e-9); // no income effect, frisch 1
  assert.deepEqual([sensitivity("eti", { e: 0, a: 1.5 })[0].low, sensitivity("eti", { e: 1.2, a: 1.5 })[0].high], [0, 1.5]);
  // The words beside each value say what it is. "Halved" and "doubled" are used only when they are true.
  const words = (model, p, k = 0) => { const r = sensitivity(model, p)[k]; return [r.low, r.words[0], r.high, r.words[1]]; };
  assert.deepEqual(words("eti", { e: 0.25, a: 1.5 }), [0.125, "halved", 0.5, "doubled"]);
  assert.deepEqual(words("eti", { e: 0.75, a: 1.5 }), [0.375, "halved", 1.5, "doubled"]);
  assert.deepEqual(words("eti", { e: 1, a: 1.5 }), [0.5, "halved", 1.5, "highest on the slider"]);     // twice 1 is off the slider
  assert.deepEqual(words("eti", { e: 1.5, a: 1.5 }), [0.75, "halved", 1.5, "highest on the slider"]);
  assert.deepEqual(words("eti", { e: 0, a: 1.5 }), [0, "lowest on the slider", 1.5, "highest on the slider"]); // half and double of zero are zero
  assert.deepEqual(words("eti", { e: 0.25, a: 1.5 }, 1), [1.1, "thickest tail on the slider", 3, "thinnest tail on the slider"]);
  assert.deepEqual(words("labour", { gamma: 1, frisch: 1, rebate: 1 }), [0.5, "halved", 2, "doubled"]);
  assert.deepEqual(words("labour", { gamma: 1, frisch: 0.1, rebate: 1 }), [0.1, "lowest on the slider", 0.2, "doubled"]);
  assert.deepEqual(words("labour", { gamma: 1, frisch: 0.15, rebate: 1 }), [0.1, "lowest on the slider", 0.3, "doubled"]);
  assert.deepEqual(words("labour", { gamma: 1, frisch: 2, rebate: 1 }), [1, "halved", 3, "highest on the slider"]);
  assert.deepEqual(words("labour", { gamma: 1, frisch: 1, rebate: 1 }, 1), [0, "none", 1, "full"]);

  assert.equal(percent(0.72727), "72.7%");
  assert.equal(percent(1, 0), "100%");
  assert.equal(percent(NaN), "–");
  assert.equal(percent(Infinity), "–");
  assert.throws(() => peak("flat", {}), RangeError);
});
