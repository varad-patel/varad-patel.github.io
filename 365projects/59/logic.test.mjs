import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { Q, LIMITS, validate, bestResponse, solve, evaluate, respond, edgeOffer, num, isFraction } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const is = (q, n, d = 1) => assert.equal(Q.cmp(q, Q.div(Q.of(n), Q.of(d))), 0, `${q.n}/${q.d} is not ${n}/${d}`);

// Ricardo's own numbers (Principles, chapter 7): the labour of 100 men makes the cloth in England and 120 the wine;
// in Portugal 90 make the cloth and 80 the wine. The labour forces are this page's addition: enough for each country
// to make one unit of each good on its own.
const RICARDO = { mode: "labour", share: 50, goods: ["cloth", "wine"], countries: [{ name: "England", labour: 220, x: 100, y: 120 }, { name: "Portugal", labour: 170, x: 90, y: 80 }] };
const output = (a, b, share = 50) => ({ mode: "output", share, goods: ["cloth", "wine"], countries: [{ name: "Home", ...a }, { name: "Abroad", ...b }] });
const utility = (c, share) => (c.x <= 0 || c.y <= 0 ? 0 : c.x ** (share / 100) * c.y ** (1 - share / 100));

/* ------------------------------------------------------------- fractions */

test("fractions read numbers as the decimals they print as, and compare exactly", () => {
  is(Q.of(0.1), 1, 10);
  is(Q.of(120), 120);
  is(Q.of(1e-6), 1, 1000000);
  is(Q.of(2.5e21), 2500000000000000000000n);
  is(Q.of(1.5e-7), 15, 100000000);
  is(Q.add(Q.of(0.1), Q.of(0.2)), 0.3);            // in floating point 0.1 + 0.2 is not 0.3
  is(Q.div(Q.of(0.3), Q.of(0.1)), 3);
  assert.equal(Q.cmp(Q.div(Q.of(0.07), Q.of(100)), Q.div(Q.of(7), Q.of(10000))), 0);
  assert.equal(Q.cmp(Q.of(1), Q.of(1.0000000001)), -1);
  assert.equal(Q.sign(Q.sub(Q.of(2), Q.of(5))), -1);
  close(Q.num(Q.div(Q.of(5), Q.of(6))), 5 / 6, 1e-15);
  // Very long numerators and denominators still turn into an ordinary number.
  const big = { n: 7n * 10n ** 800n, d: 2n * 10n ** 800n };
  close(Q.num(big), 3.5, 1e-12);
  assert.equal(Q.num(Q.zero), 0);
  assert.throws(() => Q.of(NaN));
  assert.throws(() => Q.div(Q.one, Q.zero));
});

/* -------------------------------------------------------------- Ricardo */

test("Ricardo's cloth and wine: Portugal is better at both, England has the comparative advantage in cloth", () => {
  const m = solve(RICARDO);
  // Units per worker: 1/100 and 1/120 in England, 1/90 and 1/80 in Portugal.
  is(m.countries[0].a.x, 1, 100); is(m.countries[0].a.y, 1, 120); is(m.countries[1].a.x, 1, 90); is(m.countries[1].a.y, 1, 80);
  assert.deepEqual(m.absolute, [1, 1]);          // Portugal makes more of each per worker
  is(m.countries[0].cost, 5, 6);                 // a cloth costs England 100/120 of a wine
  is(m.countries[1].cost, 9, 8);                 // and Portugal 90/80
  assert.equal(m.exporterX, 0);
  is(m.range.lo, 5, 6); is(m.range.hi, 9, 8);
  // What each could make with all its labour.
  is(m.countries[0].cap.x, 22, 10); is(m.countries[0].cap.y, 11, 6); is(m.countries[1].cap.x, 17, 9); is(m.countries[1].cap.y, 17, 8);
  // Without trade, half the labour each way.
  is(m.countries[0].autarky.x, 11, 10); is(m.countries[0].autarky.y, 11, 12); is(m.countries[1].autarky.x, 17, 18); is(m.countries[1].autarky.y, 17, 16);
});

test("One finding: the market price is 85/88 and both countries gain about 8%", () => {
  const m = solve(RICARDO);
  assert.equal(m.regime, "both");
  is(m.price, 85, 88);                           // (17/8) / (22/10): Portugal's wine over England's cloth, equal spending shares
  close(num(m.price), 0.9659, 0.00005);
  close(num(m.range.lo), 0.8333, 0.00005); close(num(m.range.hi), 1.125, 0);
  is(m.market.x, 11, 10); is(m.market.y, 17, 16);
  const [england, portugal] = m.market.outcome;
  is(england.production.x, 22, 10); is(england.production.y, 0); is(portugal.production.x, 0); is(portugal.production.y, 17, 8);
  is(england.consumption.x, 11, 10); is(england.consumption.y, 17, 16); is(portugal.consumption.x, 11, 10); is(portugal.consumption.y, 17, 16);
  // By hand: England keeps its 1.1 cloth and has 1.0625 wine instead of 0.9167, so sqrt(1.0625 / 0.916667) - 1.
  close(england.percent, Math.sqrt(1.0625 / (11 / 12)) - 1, 1e-12);
  close(portugal.percent, Math.sqrt(1.1 / (17 / 18)) - 1, 1e-12);
  close(england.percent, 0.0766, 0.00005);
  close(portugal.percent, 0.0792, 0.00005);
  assert.deepEqual([england.sign, portugal.sign], [1, 1]);
});

test("Ricardo's own bargain, one unit of cloth for one of wine, is accepted and helps both", () => {
  const m = solve(RICARDO);
  const r = respond(m, { proposer: 0, gives: "x", give: 1, get: 1 });
  assert.equal(r.code, "accept");
  is(r.price, 1);
  // England makes only cloth (2.2), keeps 1.2 and has 1 wine: (1.2 x 1) against (1.1 x 0.9167) is 12/11 squared.
  close(r.outcome[0].percent, 1 / 11, 1e-12);
  close(r.outcome[1].percent, 1 / 17, 1e-12);
  // The same bargain proposed by Portugal reads the other way round and gets the same answer.
  const back = respond(m, { proposer: 1, gives: "y", give: 1, get: 1 });
  assert.equal(back.code, "accept");
  close(back.outcome[0].percent, 1 / 11, 1e-12);
});

/* ------------------------------------------------------------- the edges */

test("an offer at the edge of the range: the side whose own price it is gains exactly nothing", () => {
  const m = solve(RICARDO);
  // 0.8 cloth for 0.9 wine is 9/8 wine per cloth, Portugal's own cost: Portugal refuses.
  const high = respond(m, { proposer: 0, gives: "x", give: 0.8, get: 0.9 });
  assert.equal(high.code, "edge");
  assert.equal(high.accepted, false);
  assert.deepEqual([high.outcome[1].sign, high.outcome[1].percent], [0, 0]);
  assert.equal(high.outcome[0].sign, 1);
  // 0.6 cloth for 0.5 wine is 5/6, England's own cost: Portugal gains and accepts, England gains exactly nothing.
  const low = respond(m, { proposer: 0, gives: "x", give: 0.6, get: 0.5 });
  assert.equal(low.code, "accept");
  assert.deepEqual([low.outcome[0].sign, low.outcome[0].percent], [0, 0]);
  assert.equal(low.outcome[1].sign, 1);
  // Just inside the range both gain; just outside one loses.
  assert.deepEqual(respond(m, { proposer: 0, gives: "x", give: 0.8, get: 0.899999 }).outcome.map((o) => o.sign), [1, 1]);
  assert.equal(respond(m, { proposer: 0, gives: "x", give: 0.8, get: 0.900001 }).code, "price");
  assert.equal(respond(m, { proposer: 0, gives: "x", give: 0.6, get: 0.499999 }).outcome[0].sign, -1);
  // The ready-made edge offers sit exactly on the counterpart's cost.
  const e0 = edgeOffer(m, 0), e1 = edgeOffer(m, 1);
  assert.equal(respond(m, e0).code, "edge");
  is(respond(m, e0).price, 9, 8);
  assert.equal(respond(m, e1).code, "edge");
  is(respond(m, e1).price, 5, 6);
});

test("identical opportunity costs: no comparative advantage, no price range, no offer that helps one without hurting the other", () => {
  // Portugal twice as good at both: 50 and 60 workers against 100 and 120.
  const m = solve({ ...RICARDO, countries: [RICARDO.countries[0], { name: "Portugal", labour: 170, x: 50, y: 60 }] });
  assert.equal(m.exporterX, null);
  assert.equal(m.range, null);
  assert.equal(m.regime, "none");
  assert.deepEqual(m.absolute, [1, 1]);
  assert.deepEqual(m.market.outcome.map((o) => [o.sign, o.percent]), [[0, 0], [0, 0]]);
  is(m.market.x, 0);
  for (const offer of [{ proposer: 0, gives: "x", give: 0.6, get: 0.5 }, { proposer: 0, gives: "x", give: 1, get: 1 }, { proposer: 0, gives: "y", give: 1, get: 1 }, { proposer: 1, gives: "x", give: 0.1, get: 0.2 }, { proposer: 1, gives: "y", give: 0.5, get: 0.6 }]) {
    const r = respond(m, offer);
    // Nobody can gain without the other losing, so the counterpart accepts only what hurts the proposer.
    assert.ok(!(r.outcome[0].sign > 0 && r.outcome[1].sign >= 0) && !(r.outcome[1].sign > 0 && r.outcome[0].sign >= 0));
    if (r.accepted) assert.equal(r.outcome[offer.proposer].sign, -1);
  }
  // England offers wine for cloth at 1 wine a cloth: Portugal would sell cloth above its cost of 5/6 and says yes; England loses.
  assert.equal(respond(m, { proposer: 0, gives: "y", give: 1, get: 1 }).code, "accept");
  assert.equal(respond(m, { proposer: 0, gives: "x", give: 1, get: 1 }).code, "price");
  assert.equal(respond(m, { proposer: 0, gives: "x", give: 0.6, get: 0.5 }).code, "edge");
  assert.equal(edgeOffer(m, 0), null);
  // Decimals that floating point gets wrong: 0.3 / 0.1 and 0.6 / 0.2 are both exactly 3.
  assert.equal(solve(output({ labour: 10, x: 0.1, y: 0.3 }, { labour: 10, x: 0.2, y: 0.6 })).exporterX, null);
  assert.equal(solve(output({ labour: 10, x: 0.07, y: 0.21 }, { labour: 3, x: 100, y: 300 })).exporterX, null);
  // And a difference in the tenth decimal place is a difference.
  assert.equal(solve(output({ labour: 10, x: 0.1, y: 0.3 }, { labour: 10, x: 0.2, y: 0.6000000001 })).exporterX, 0);
});

test("a country too small to move the price trades at the large country's own price and takes all the gain", () => {
  // Portugal a hundred times larger: the world price is Portugal's 9/8 and Portugal gains exactly nothing.
  const m = solve({ ...RICARDO, countries: [RICARDO.countries[0], { ...RICARDO.countries[1], labour: 17000 }] });
  assert.equal(m.regime, "importerLarge");
  is(m.price, 9, 8);
  assert.deepEqual([m.market.outcome[1].sign, m.market.outcome[1].percent], [0, 0]);
  is(m.market.outcome[1].consumption.x, m.countries[1].autarky.x.n, m.countries[1].autarky.x.d);
  // England sells half its 2.2 cloth for 1.2375 wine: (1.1, 1.2375) against (1.1, 0.9167).
  is(m.market.x, 11, 10); is(m.market.y, 99, 80);
  close(m.market.outcome[0].percent, Math.sqrt(1.2375 / (11 / 12)) - 1, 1e-12);
  // Portugal still makes some cloth, so it is not completely specialised.
  assert.equal(Q.sign(m.market.outcome[1].production.x), 1);
  // The other way round: England a hundred times larger, so England's 5/6 rules and England gains nothing.
  const w = solve({ ...RICARDO, countries: [{ ...RICARDO.countries[0], labour: 22000 }, RICARDO.countries[1]] });
  assert.equal(w.regime, "exporterLarge");
  is(w.price, 5, 6);
  assert.deepEqual([w.market.outcome[0].sign, w.market.outcome[0].percent], [0, 0]);
  assert.equal(w.market.outcome[1].sign, 1);
  // Exactly at the boundary the large country is completely specialised and still gains nothing.
  // Price with both specialised = capY(B) / capX(A) = (L1/80) / (L0/100); it equals 5/6 when L1 = L0 x 2/3.
  const edge = solve({ ...RICARDO, countries: [{ ...RICARDO.countries[0], labour: 300 }, { ...RICARDO.countries[1], labour: 200 }] });
  assert.equal(edge.regime, "exporterLarge");
  is(edge.price, 5, 6);
  is(edge.market.outcome[0].production.y, 0);
  assert.equal(edge.market.outcome[0].sign, 0);
});

test("a zero productivity: a country that cannot make one good still trades, and its gain has no percentage", () => {
  const m = solve(output({ labour: 10, x: 2, y: 0 }, { labour: 10, x: 1, y: 3 }));
  is(m.countries[0].cost, 0);                    // cloth costs Home no wine at all
  is(m.countries[1].cost, 3);
  assert.deepEqual(m.absolute, [0, 1]);
  assert.equal(m.exporterX, 0);
  is(m.range.lo, 0); is(m.range.hi, 3);
  assert.equal(m.regime, "both");
  is(m.price, 3, 2);                             // 30 wine against 20 cloth
  is(m.countries[0].autarky.x, 20); is(m.countries[0].autarky.y, 0);
  assert.deepEqual([m.market.outcome[0].sign, m.market.outcome[0].percent], [1, null]); // from no wine to some
  close(m.market.outcome[1].percent, Math.SQRT2 - 1, 1e-12);                            // (10, 15) against (5, 15)
  // The country that cannot make cloth: its cost of cloth has no number, and there is no upper limit on the price.
  const n = solve(output({ labour: 10, x: 0, y: 4 }, { labour: 10, x: 1, y: 3 }));
  assert.equal(n.countries[0].cost, null);
  assert.equal(n.exporterX, 1);
  is(n.range.lo, 3); assert.equal(n.range.hi, null);
  is(n.price, 4);                                // 40 wine against 10 cloth
  assert.equal(n.market.outcome[0].percent, null);
  // Each can make only one good: any positive price is inside the range.
  const o = solve(output({ labour: 10, x: 2, y: 0 }, { labour: 10, x: 0, y: 3 }));
  is(o.range.lo, 0); assert.equal(o.range.hi, null);
  assert.equal(respond(o, { proposer: 0, gives: "x", give: 1, get: 0.000001 }).code, "accept");
  assert.equal(respond(o, { proposer: 0, gives: "x", give: 0.000001, get: 29 }).code, "accept");
  // Asking a country for a good it cannot make.
  assert.equal(respond(o, { proposer: 0, gives: "y", give: 1, get: 1 }).code, "proposerCannot");
  assert.equal(respond(o, { proposer: 1, gives: "x", give: 1, get: 1 }).code, "proposerCannot");
});

/* --------------------------------------------------- offers and answers */

test("offers: wrong direction, too much to deliver, too much to be worth it, bad numbers", () => {
  const m = solve(RICARDO);
  assert.equal(respond(m, { proposer: 0, gives: "y", give: 1, get: 1 }).code, "price");          // England selling wine
  assert.equal(respond(m, { proposer: 0, gives: "x", give: 3, get: 3 }).code, "proposerCannot");  // England makes at most 2.2 cloth
  assert.equal(respond(m, { proposer: 0, gives: "x", give: 2.1, get: 2.2 }).code, "counterpartCannot"); // Portugal makes at most 2.125 wine
  // A fair price but far too much of it: Portugal would give up 2.1 of its 2.125 wine.
  const big = respond(m, { proposer: 0, gives: "x", give: 2.1, get: 2.1 });
  assert.equal(big.code, "quantity");
  assert.equal(big.side, 1);
  assert.equal(big.outcome[1].sign, -1);
  for (const bad of [0, -1, NaN, Infinity, "2", null, undefined, 1e308, LIMITS.max * 10, LIMITS.min / 10]) {
    assert.equal(respond(m, { proposer: 0, gives: "x", give: bad, get: 1 }).code, "invalid");
    assert.equal(respond(m, { proposer: 0, gives: "x", give: 1, get: bad }).code, "invalid");
  }
  assert.match(respond(m, { proposer: 0, gives: "x", give: 0, get: 1 }).message, /The amount offered must be above zero/);
  assert.match(respond(m, { proposer: 0, gives: "x", give: 1, get: -2 }).message, /The amount asked for must be above zero/);
  assert.match(respond(m, { proposer: 0, gives: "x", give: NaN, get: 1 }).message, /The amount offered is missing or is not a number/);
  assert.match(respond(m, { proposer: 0, gives: "x", give: Infinity, get: 1 }).message, /must be between 0.000001 and 1,000,000,000/);
  assert.match(respond(m, { proposer: 0, gives: "x", give: 1, get: 1e-9 }).message, /The amount asked for must be between/);
});

test("the counterpart never accepts at a price on the wrong side of its own cost, and a deal never helps both outside the range", () => {
  const r = rng(59);
  let accepted = 0, refusedInside = 0;
  for (let k = 0; k < 400; k++) {
    const m = solve(output({ labour: r.int(1, 50), x: r.int(1, 9), y: r.int(1, 9) }, { labour: r.int(1, 50), x: r.int(1, 9), y: r.int(1, 9) }, r.int(1, 19) * 5));
    const offer = { proposer: r.int(0, 1), gives: r.pick(["x", "y"]), give: r.int(1, 400) / 10, get: r.int(1, 400) / 10 };
    const a = respond(m, offer);
    if (a.code === "proposerCannot" || a.code === "counterpartCannot") continue;
    const inside = m.range && Q.cmp(a.price, m.range.lo) > 0 && (m.range.hi === null || Q.cmp(a.price, m.range.hi) < 0) && a.from === m.exporterX;
    const both = a.outcome[0].sign > 0 && a.outcome[1].sign > 0;
    if (both) assert.ok(inside, "both gained at a price outside the range");
    if (a.accepted) { accepted++; assert.equal(a.side, 1); assert.equal(a.outcome[1 - offer.proposer].sign, 1); }
    else if (inside) refusedInside++;
    if (a.code === "price") assert.equal(a.side, -1);
  }
  assert.ok(accepted > 20 && refusedInside > 5, `${accepted} accepted, ${refusedInside} refused inside the range`);
});

/* -------------------------------------------- brute force over the bundles */

test("the best response beats every bundle on a fine grid of ways to split labour", () => {
  const r = rng(11);
  let cases = 0;
  for (let k = 0; k < 300; k++) {
    const share = r.int(1, 19) * 5;
    const cap = { x: Q.of(r.int(0, 40) / 4), y: Q.of(r.int(0, 40) / 4) };
    if (Q.sign(cap.x) === 0 && Q.sign(cap.y) === 0) continue;
    const net = { x: Q.of(r.int(-30, 30) / 4), y: Q.of(r.int(-30, 30) / 4) };
    const best = bestResponse(cap, net, share);
    let top = -1, any = false;
    for (let i = 0; i <= 2000; i++) {
      const s = i / 2000, c = { x: s * num(cap.x) + num(net.x), y: (1 - s) * num(cap.y) + num(net.y) };
      if (c.x < 0 || c.y < 0) continue;
      any = true;
      top = Math.max(top, utility(c, share));
    }
    if (!best) { assert.equal(any, false, "the search found a feasible bundle where the model found none"); continue; }
    cases++;
    const u = utility({ x: num(best.consumption.x), y: num(best.consumption.y) }, share);
    assert.ok(u >= top - 1e-9, `grid ${top} beats model ${u}`);
    assert.ok(u <= top + 0.02 * (1 + top), `model ${u} is far above anything on the grid (${top})`);
    assert.ok(Q.sign(best.consumption.x) >= 0 && Q.sign(best.consumption.y) >= 0 && Q.cmp(best.s, Q.zero) >= 0 && Q.cmp(best.s, Q.one) <= 0);
  }
  assert.ok(cases > 150);
});

test("at the market price no bundle a country can afford beats the one the model gives it, and the trade balances", () => {
  const r = rng(2);
  const regimes = new Set();
  for (let k = 0; k < 120; k++) {
    const share = r.int(1, 19) * 5;
    const m = solve(output({ labour: r.int(1, 60), x: r.int(0, 8), y: r.int(1, 8) }, { labour: r.int(1, 60), x: r.int(1, 8), y: r.int(0, 8) }, share));
    regimes.add(m.regime);
    if (m.regime === "none") continue;
    const p = num(m.price);
    m.countries.forEach((c, i) => {
      // Everything it can afford: make any mix, then swap any amount of one good for the other at the price p.
      const cx = num(c.cap.x), cy = num(c.cap.y);
      let top = 0;
      for (let a = 0; a <= 200; a++) {
        const s = a / 200, income = p * s * cx + (1 - s) * cy; // in units of y
        for (let b = 0; b <= 200; b++) { const spendX = (b / 200) * income; top = Math.max(top, utility({ x: p > 0 ? spendX / p : 0, y: income - spendX }, share)); }
      }
      const got = m.market.outcome[i].consumption;
      const u = utility({ x: num(got.x), y: num(got.y) }, share);
      assert.ok(u >= top - 1e-9 * (1 + top), `${c.name} could do better: ${top} against ${u}`);
      // No trade must never beat the market outcome.
      assert.ok(m.market.outcome[i].sign >= 0);
    });
    // What one sells the other buys, and the two bundles add up to what is made.
    const [o0, o1] = m.market.outcome;
    for (const g of ["x", "y"]) is(Q.add(o0.consumption[g], o1.consumption[g]), Q.add(o0.production[g], o1.production[g]).n, Q.add(o0.production[g], o1.production[g]).d);
    is(Q.mul(m.price, m.market.x), m.market.y.n, m.market.y.d);
    // The price lies in the range, and both gain strictly exactly when it is strictly inside.
    const inside = Q.cmp(m.price, m.range.lo) > 0 && (m.range.hi === null || Q.cmp(m.price, m.range.hi) < 0);
    assert.ok(Q.cmp(m.price, m.range.lo) >= 0 && (m.range.hi === null || Q.cmp(m.price, m.range.hi) <= 0));
    assert.equal(o0.sign > 0 && o1.sign > 0, inside);
    assert.equal(m.regime === "both", inside);
  }
  assert.deepEqual([...regimes].sort(), ["both", "exporterLarge", "importerLarge", "none"]);
});

test("evaluate: a trade is scored the same whichever way it is described", () => {
  const m = solve(RICARDO);
  const a = evaluate(m, 0, 0.5, 0.5), b = evaluate(m, 0, Q.of(0.5), Q.div(Q.one, Q.of(2)));
  assert.deepEqual(a.outcome.map((o) => o.percent), b.outcome.map((o) => o.percent));
  assert.deepEqual(evaluate(m, 0, 0, 0).outcome.map((o) => [o.sign, o.percent]), [[0, 0], [0, 0]]);
});

/* ------------------------------------------------------------ bad input */

test("validation says what to fix", () => {
  assert.deepEqual(validate(RICARDO), []);
  const one = (change) => validate({ ...RICARDO, ...change }).map((e) => e.message).join(" | ");
  const country = (i, change) => one({ countries: RICARDO.countries.map((c, k) => (k === i ? { ...c, ...change } : c)) });
  assert.match(country(0, { labour: 0 }), /England: the number of workers must be between/);
  assert.match(country(0, { labour: NaN }), /number of workers/);
  assert.match(country(1, { labour: 1e308 }), /Portugal: the number of workers/);
  assert.match(country(0, { x: 0 }), /England, cloth: the workers needed per unit must be between .* switch to units per worker and enter 0/);
  assert.match(country(1, { y: -3 }), /Portugal, wine/);
  assert.match(country(1, { y: "80" }), /Portugal, wine/);
  assert.match(country(1, { name: "" }), /Give the second country a name/);
  assert.match(country(1, { name: "england" }), /"england" is used twice/);
  assert.match(country(0, { name: "x".repeat(25) }), /24 characters or fewer/);
  assert.match(one({ goods: ["cloth", "Cloth "] }), /used twice/);
  assert.match(one({ goods: ["", "wine"] }), /Give the first good a name/);
  assert.match(one({ share: 0 }), /whole percentage from 1 to 99/);
  assert.match(one({ share: 50.5 }), /whole percentage/);
  assert.match(one({ mode: "x" }), /Choose how the numbers are written/);
  assert.match(one({ countries: [RICARDO.countries[0]] }), /exactly two countries/);
  const out = (a, b) => validate(output(a, b)).map((e) => e.message).join(" | ");
  assert.equal(out({ labour: 1, x: 0, y: 1 }, { labour: 1, x: 1, y: 0 }), "");
  assert.match(out({ labour: 1, x: 0, y: 0 }, { labour: 1, x: 1, y: 1 }), /Home cannot make either good/);
  assert.match(out({ labour: 1, x: 0, y: 1 }, { labour: 1, x: 0, y: 2 }), /Neither country can make cloth/);
  assert.match(out({ labour: 1, x: 1, y: 0 }, { labour: 1, x: 2, y: 0 }), /Neither country can make wine/);
  assert.match(out({ labour: 1, x: -1, y: 1 }, { labour: 1, x: 1, y: 1 }), /must be 0, or between/);
  assert.match(out({ labour: 1, x: 1e-9, y: 1 }, { labour: 1, x: 1, y: 1 }), /must be 0, or between/);
  assert.throws(() => solve({ ...RICARDO, share: 100 }), /whole percentage/);
  assert.deepEqual(validate(null).length > 0, true);
});

test("extreme but allowed inputs give finite answers", () => {
  const m = solve(output({ labour: LIMITS.max, x: LIMITS.max, y: LIMITS.min }, { labour: LIMITS.min, x: LIMITS.min, y: LIMITS.max }, 95));
  assert.ok(Number.isFinite(num(m.price)) && num(m.price) > 0);
  for (const o of m.market.outcome) assert.ok(o.percent === null || Number.isFinite(o.percent));
  // With 1% of spending on cloth the cloth maker is "large" whatever its size: its own price rules and it gains nothing.
  const t = solve(output({ labour: 1, x: 1, y: 2 }, { labour: 1, x: 2, y: 1 }, 1));
  assert.equal(t.regime, "exporterLarge");
  assert.deepEqual(t.market.outcome.map((o) => o.sign), [1, 0]);
  assert.ok(t.market.outcome.every((o) => Number.isFinite(o.percent)));
});

/* ------------------------------------------------- added by the review */

test("the same economy written the other way round gives the same answer, exactly", () => {
  // "No comparative advantage": Portugal needs exactly half the workers for both goods.
  const labour = { mode: "labour", share: 50, goods: ["cloth", "wine"], countries: [{ name: "England", labour: 220, x: 100, y: 120 }, { name: "Portugal", labour: 170, x: 50, y: 60 }] };
  assert.equal(solve(labour).exporterX, null);
  // Units per worker as the six-figure decimals a box can show: 1/120 becomes 0.00833333 and the costs no longer match.
  const rounded = { ...labour, mode: "output", countries: labour.countries.map((c) => ({ ...c, x: Number((1 / c.x).toPrecision(6)), y: Number((1 / c.y).toPrecision(6)) })) };
  assert.notEqual(solve(rounded).exporterX, null);
  // The interface therefore hands over the exact reciprocals, and the verdict survives the switch.
  const exact = { ...labour, mode: "output", countries: labour.countries.map((c) => ({ ...c, x: Q.div(Q.one, Q.of(c.x)), y: Q.div(Q.one, Q.of(c.y)) })) };
  assert.deepEqual(validate(exact), []);
  const m = solve(exact);
  assert.equal(m.exporterX, null);
  is(m.countries[0].cost, 5, 6); is(m.countries[1].cost, 5, 6);
  // Ricardo's numbers the other way round: the same price and the same gains as in the finding.
  const r = solve({ ...RICARDO, mode: "output", countries: RICARDO.countries.map((c) => ({ ...c, x: Q.div(Q.one, Q.of(c.x)), y: Q.div(Q.one, Q.of(c.y)) })) });
  is(r.price, 85, 88);
  close(r.market.outcome[0].percent, 0.0766, 0.0001); close(r.market.outcome[1].percent, 0.0792, 0.0001);
  // A fraction that is not above zero is refused, and so is a fraction for the number of workers.
  assert.ok(validate({ ...exact, countries: [{ ...exact.countries[0], x: Q.zero }, exact.countries[1]] }).length > 0);
  assert.ok(validate({ ...exact, countries: [{ ...exact.countries[0], labour: Q.one }, exact.countries[1]] }).length > 0);
  assert.equal(isFraction(Q.of(0.5)), true); assert.equal(isFraction(0.5), false); assert.equal(isFraction(null), false);
});

test("the market's own amounts, offered exactly, leave the large country exactly level; rounded to six figures they do not", () => {
  // Portugal needs a thousand million workers for a unit of wine: England is the large country and the price is its own 5/6.
  const m = solve({ mode: "labour", share: 50, goods: ["cloth", "wine"], countries: [{ name: "England", labour: 220, x: 100, y: 120 }, { name: "Portugal", labour: 170, x: 90, y: 1000000000 }] });
  is(m.price, 5, 6);
  const seller = m.market.from, england = 0;
  assert.equal(m.market.outcome[england].sign, 0);
  const exact = respond(m, { proposer: england, gives: seller === england ? "x" : "y", give: seller === england ? m.market.x : m.market.y, get: seller === england ? m.market.y : m.market.x });
  assert.equal(exact.outcome[england].sign, 0);
  assert.equal(exact.accepted, true); // Portugal gains
  const six = (q) => Number(num(q).toPrecision(6));
  const rounded = respond(m, { proposer: england, gives: seller === england ? "x" : "y", give: six(seller === england ? m.market.x : m.market.y), get: six(seller === england ? m.market.y : m.market.x) });
  assert.notEqual(rounded.outcome[england].sign, 0);
  // Fractions that are not above zero are refused like any other amount.
  assert.equal(respond(m, { proposer: 0, gives: "x", give: Q.zero, get: Q.one }).code, "invalid");
});

test("a price a hair inside the range: 0.8333 is below Ricardo's 5/6, so England loses by selling cloth at it", () => {
  const m = solve(RICARDO);
  const r = respond(m, { proposer: 0, gives: "x", give: 1, get: 0.8333 });
  assert.equal(Q.cmp(r.price, m.range.lo), -1);
  assert.equal(r.accepted, true);            // Portugal is glad to buy
  assert.equal(r.outcome[0].sign, -1);       // and England is worse off than with no trade
  assert.ok(Math.abs(r.outcome[0].percent) < 0.0005);
});
