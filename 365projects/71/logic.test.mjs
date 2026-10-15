import test from "node:test";
import assert from "node:assert/strict";
import { rng, linalg } from "../kit/kit.js";
import { FX } from "./data.js";
import { EVENTS, LINKED, PEGS, decode, returns, basketOf, incompleteBeta, tTwoSided, eventStudy, verdict } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const D = decode(FX);
const rate = (code, day) => D.series[code][D.dates.indexOf(day)];

test("Student's t and the incomplete beta function against hand values and printed tables", () => {
  close(incompleteBeta(0.5, 2, 3), 0.6875, 1e-12); // sum of C(4, j) / 16 for j = 2, 3, 4
  close(incompleteBeta(0.3, 1, 1), 0.3, 1e-12);
  close(tTwoSided(2.228, 10), 0.05, 1e-4);         // the 5% two-sided critical value for 10 degrees of freedom
  close(tTwoSided(2.0, 10), 0.07339, 1e-5);
  close(tTwoSided(1.96, 1e6), 0.05, 1e-4);         // the normal limit
  assert.equal(tTwoSided(0, 5), 1);
  assert.equal(tTwoSided(Infinity, 5), 0);
  assert.equal(verdict(0.0099), "significant at the 1% level");
  assert.equal(verdict(0.01), "significant at the 5% level");
  assert.equal(verdict(0.05), "significant at the 10% level only");
  assert.equal(verdict(0.1), "not significant at the 10% level");
});

test("decoding gives back the Board's published rates, turned into US dollars per unit", () => {
  assert.equal(D.dates[0], "1991-01-02");
  assert.equal(D.dates.at(-1), "2026-10-09");
  close(rate("GBP", "2016-06-23"), 1.48, 1e-12);       // H.10 quotes the pound in dollars: 1.4800
  close(rate("GBP", "2016-06-24"), 1.3639, 1e-12);
  close(rate("CHF", "2015-01-15"), 1 / 0.893, 1e-12);  // H.10 quotes francs per dollar: 0.8930
  close(rate("JPY", "2022-09-22"), 1 / 142.16, 1e-15);
  close(rate("CNY", "2005-07-21"), 1 / 8.2765, 1e-15);
  assert.ok(Number.isNaN(rate("EUR", "1998-12-31")), "no euro before 1999");
});

test("the basket leaves out the currency studied and any currency pegged to it", () => {
  assert.ok(returns(D, "GBP").every((d) => d.k <= 6));
  assert.ok(returns(D, "CNY").some((d) => d.k === 7));
  assert.ok(returns(D, "EUR").every((d) => d.k <= 6), "the krone is left out for the euro");
  assert.deepEqual(LINKED.EUR, ["DKK"]);
  const r = returns(D, "GBP").find((d) => d.date === "2016-06-24");
  close(r.r, Math.log(1.3639 / 1.48), 1e-12);
  const others = ["AUD", "CAD", "CHF", "DKK", "JPY", "SEK"].map((c) => Math.log(rate(c, "2016-06-24") / rate(c, "2016-06-23")));
  close(r.m, others.reduce((a, b) => a + b, 0) / 6, 1e-12);
});

// A small made-up market where the truth is known.
function synthetic({ jump = 0.03, n = 400, seed = 3 } = {}) {
  const r = rng(seed);
  const dates = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2001, 0, 1) + i * 86400000).toISOString().slice(0, 10));
  const lvl = { A: [1], B: [1], X: [1] };
  for (let i = 1; i < n; i++) {
    const a = r.normal(0, 0.006), b = r.normal(0, 0.006);
    const m = (a + b) / 2;
    lvl.A.push(lvl.A[i - 1] * Math.exp(a));
    lvl.B.push(lvl.B[i - 1] * Math.exp(b));
    lvl.X.push(lvl.X[i - 1] * Math.exp(0.0002 + 0.8 * m + r.normal(0, 0.003) + (i === 300 ? jump : 0)));
  }
  const series = Object.fromEntries(Object.entries(lvl).map(([k, v]) => [k, Float64Array.from(v)]));
  return { dates, series, meta: { A: { code: "A", name: "A", basket: true }, B: { code: "B", name: "B", basket: true }, X: { code: "X", name: "X", basket: false } } };
}

test("the market model recovers a known beta and a known jump", () => {
  const S = synthetic();
  const r = eventStudy(S, { code: "X", date: S.dates[300], est: 250, win: [0, 0] });
  assert.ok(!r.error, r.error);
  close(r.beta, 0.8, 0.08);
  close(r.days[0].ar, 0.03, 0.01);
  assert.ok(r.scar > 5 && r.p < 1e-6);
  const none = eventStudy(synthetic({ jump: 0 }), { code: "X", date: S.dates[300], est: 250, win: [0, 0] });
  assert.ok(Math.abs(none.scar) < 3);
});

test("the variance of the CAR equals the matrix formula of MacKinlay (1997), equation 11", () => {
  const S = synthetic();
  const r = eventStudy(S, { code: "X", date: S.dates[300], est: 120, win: [-3, 4] });
  const R = returns(S, "X");
  const zero = R.findIndex((d) => d.date >= S.dates[300]);
  const E = R.slice(zero - 3 - 120, zero - 3), W = R.slice(zero - 3, zero + 5);
  const X = E.map((d) => [1, d.m]), Xs = W.map((d) => [1, d.m]);
  const inv = linalg.inverse(linalg.matmul(linalg.transpose(X), X));
  const V = linalg.matmul(linalg.matmul(Xs, inv), linalg.transpose(Xs)).map((row, i) => row.map((v, j) => (v + (i === j ? 1 : 0)) * r.sigma ** 2));
  const total = V.flat().reduce((a, b) => a + b, 0);
  close(r.seCar, Math.sqrt(total), 1e-12);
  // and each day's standard error is the root of the diagonal
  r.days.forEach((d, i) => close(d.se, Math.sqrt(V[i][i]), 1e-12));
  close(r.path.at(-1).se, r.seCar, 1e-12);
  close(r.car, r.days.reduce((s, d) => s + d.ar, 0), 1e-15);
  assert.equal(r.df, 118);
});

test("bad settings get a message that says what to change", () => {
  const go = (o) => eventStudy(D, { code: "GBP", date: "2016-06-24", est: 250, win: [0, 1], ...o });
  assert.match(go({ win: [2, 1] }).error, /event window/);
  assert.match(go({ win: [-31, 0] }).error, /event window/);
  assert.match(go({ est: 20 }).error, /from 30 to 1000/);
  assert.match(go({ est: 250.5 }).error, /whole number/);
  assert.match(go({ code: "XYZ" }).error, /no XYZ series/);
  assert.match(go({ date: "24/06/2016" }).error, /day, month and year/);
  assert.match(go({ date: "2027-01-01" }).error, /after the last rate/);
  assert.match(go({ date: "2026-10-08", win: [0, 5] }).error, /past the last rate/);
  assert.match(go({ code: "EUR", date: "1999-03-01" }).error, /only \d+ trading days/);
  assert.match(go({ code: "MXN", date: "1994-12-20", est: 400 }).error, /Shorten the estimation window/);
});

test("a visitor's own basket: exclusions, an empty basket, and the warning for the franc's floor", () => {
  assert.deepEqual(basketOf(D, "EUR"), ["AUD", "CAD", "CHF", "GBP", "JPY", "SEK"]);
  assert.deepEqual(basketOf(D, "EUR", ["CHF", "EUR"]), ["AUD", "CAD", "GBP", "JPY", "SEK"]);
  assert.ok(returns(D, "JPY", ["GBP"]).every((d) => d.k <= 5));
  const r = returns(D, "JPY", ["GBP", "CHF"]).find((d) => d.date === "2022-09-23");
  const others = ["AUD", "CAD", "DKK", "SEK"].map((c) => Math.log(rate(c, "2022-09-23") / rate(c, "2022-09-22")));
  close(r.m, others.reduce((a, b) => a + b, 0) / 4, 1e-12);
  assert.match(eventStudy(D, { code: "GBP", date: "2016-06-24", est: 250, win: [0, 1], exclude: ["AUD", "CAD", "CHF", "DKK", "JPY", "SEK"] }).error, /basket is empty/);
  // The Swiss National Bank's floor of 1.20 francs per euro ran from 6 September 2011 to 15 January 2015.
  assert.deepEqual(PEGS.map((g) => [g.code, g.member, g.from, g.to]), [["EUR", "CHF", "2011-09-06", "2015-01-14"]]);
  assert.equal(eventStudy(D, { code: "EUR", date: "2013-05-02", est: 250, win: [0, 1] }).tied.length, 1);
  assert.equal(eventStudy(D, { code: "EUR", date: "2013-05-02", est: 250, win: [0, 1], exclude: ["CHF"] }).tied.length, 0);
  assert.equal(eventStudy(D, { code: "EUR", date: "2010-05-03", est: 250, win: [0, 1] }).tied.length, 0, "before the floor");
  assert.equal(eventStudy(D, { code: "EUR", date: "2016-06-01", est: 250, win: [0, 1] }).tied.length, 0, "a year and more after it");
  assert.equal(eventStudy(D, { code: "EUR", date: "2015-06-01", est: 250, win: [0, 1] }).tied.length, 1, "the estimation window reaches back into it");
});

test("every built-in event runs with its own window and basket, and day 0 has a rate", () => {
  for (const e of EVENTS) {
    const r = eventStudy(D, { code: e.code, date: e.day0, est: 250, win: e.win, exclude: e.exclude || [] });
    assert.equal(r.tied.length, 0, `${e.id} keeps a tied currency in its basket`);
    assert.ok(!r.error, `${e.id}: ${r.error}`);
    assert.equal(r.eventDay, e.day0, e.id);
    assert.ok(e.url.startsWith("https://") && e.source && e.when, e.id);
  }
  assert.equal(EVENTS.length, 17);
  // The yuan's peg: the test statistic is huge because the estimation window has almost no noise.
  assert.ok(eventStudy(D, { code: "CNY", date: "2005-07-21", est: 250, win: [0, 1] }).pegged);
});

test("the finding: the market model takes out what moved every currency", () => {
  // Every figure here was also computed by a separate Python script straight from the Board's H10_data.xml.
  const ev = (id) => EVENTS.find((e) => e.id === id);
  assert.deepEqual([ev("eur2012").win, ev("eur2012").exclude], [[0, 1], ["CHF"]]);
  const eur = eventStudy(D, { code: "EUR", date: "2012-07-26", est: 250, win: [0, 1], exclude: ["CHF"] });
  assert.deepEqual(eur.basket, ["AUD", "CAD", "GBP", "JPY", "SEK"]);
  assert.equal((100 * eur.raw).toFixed(1), "1.9");
  assert.equal((100 * eur.market).toFixed(1), "1.2");
  assert.equal((100 * eur.car).toFixed(2), "0.83");
  assert.equal(eur.scar.toFixed(2), "1.53");
  assert.equal(eur.p.toFixed(2), "0.13");
  // With the franc kept in, as the page first did: +0.65%, t 1.33, p 0.19.
  const withChf = eventStudy(D, { code: "EUR", date: "2012-07-26", est: 250, win: [0, 1] });
  assert.equal((100 * withChf.car).toFixed(2), "0.65");
  assert.equal(withChf.tied.length, 1);
  assert.deepEqual(ev("jpy2022").win, [0, 0]);
  const jpy = eventStudy(D, { code: "JPY", date: "2022-09-22", est: 250, win: [0, 0] });
  assert.equal((100 * jpy.raw).toFixed(1), "1.4");
  assert.equal((100 * jpy.market).toFixed(1), "-0.7");
  assert.equal((100 * jpy.car).toFixed(1), "1.8");
  assert.equal(jpy.scar.toFixed(2), "3.05");
  assert.equal(jpy.p.toFixed(4), "0.0025");
  assert.deepEqual([jpy.empirical.asBig, jpy.empirical.windows], [3, 250]);
  // Two days, as the page first had it: the pound's own fall on 23 September drags the basket down.
  const two = eventStudy(D, { code: "JPY", date: "2022-09-22", est: 250, win: [0, 1] });
  assert.equal((100 * two.market).toFixed(2), "-2.05");
  assert.equal(two.scar.toFixed(2), "2.12");
  const noGbp = eventStudy(D, { code: "JPY", date: "2022-09-22", est: 250, win: [0, 1], exclude: ["GBP"] });
  assert.equal(noGbp.scar.toFixed(2), "1.89");
  const chf = eventStudy(D, { code: "CHF", date: "2015-01-15", est: 250, win: [0, 1] });
  assert.equal((100 * chf.car).toFixed(1), "18.9");
  const brexit = eventStudy(D, { code: "GBP", date: "2016-06-24", est: 250, win: [0, 1] });
  assert.equal((100 * brexit.car).toFixed(1), "-9.9");
});

test("messages read correctly in their small cases", () => {
  const go = (o) => eventStudy(D, { code: "GBP", date: "2016-06-24", est: 250, win: [0, 1], ...o });
  assert.match(go({ date: "2026-10-09" }).error, /runs 1 trading day past/);
  assert.match(go({ date: "2026-10-08", win: [0, 5] }).error, /runs \d+ trading days past/);
  assert.match(go({ date: "1991-01-03" }).error, /has no trading days of returns/);
  assert.match(go({ date: "1991-02-01" }).error, /has only 20 trading days of returns/);
});
