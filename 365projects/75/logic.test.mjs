import test from "node:test";
import assert from "node:assert/strict";
import { DATA } from "./data.js";
import {
  addMonths, monthDiff, monthLabel, normalCdf, bondEquivalent, spreadSeries, recessionSeries, knownAt, latestAnnounced, LAG,
  fitBinary, predict, fitWindow, realTime, hindsightFit, auc, rocCurve, trapezoid, confusion, brier, episodes, recessionsCaught,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const rel = (a, b, tol) => assert.ok(Math.abs(a / b - 1) <= tol, `${a} is not within ${tol} (relative) of ${b}`);
const at = (ym) => monthDiff(DATA.first, ym);

test("month arithmetic", () => {
  assert.equal(addMonths("1959-01", 12), "1960-01");
  assert.equal(addMonths("2019-12", 1), "2020-01");
  assert.equal(addMonths("2020-01", -1), "2019-12");
  assert.equal(monthDiff("2007-12", "2009-06"), 18);
  assert.equal(monthLabel("2026-09"), "Sep 2026");
  assert.equal(monthLabel("2026-09", true), "September 2026");
});

test("the normal distribution function matches published values to full precision, tails included", () => {
  close(normalCdf(0), 0.5, 1e-16);
  rel(normalCdf(-1), 0.15865525393145707, 1e-14);
  rel(normalCdf(1.96), 0.9750021048517795, 1e-14);
  rel(normalCdf(-3), 0.0013498980316301035, 1e-13);
  rel(normalCdf(-5), 2.866515718791939e-7, 1e-12);
  rel(normalCdf(-10), 7.619853024160527e-24, 1e-12);
  close(normalCdf(2.5) + normalCdf(-2.5), 1, 1e-15);
});

test("the bill rate is put on a bond-equivalent basis as in the New York Fed's spreadsheet", () => {
  // allmonth.xls, column "3 Month Treasury Yield (Bond Equivalent Basis)", January 1959 and January 2011.
  close(bondEquivalent(2.82), 2.879694086009773, 1e-12);
  close(bondEquivalent(0.15), 0.15214102013680186, 1e-12);
});

test("the data: H.15 yields as published, and the spread the New York Fed publishes", () => {
  assert.equal(DATA.first, "1959-01");
  assert.equal(DATA.last, "2026-09");
  assert.equal(DATA.cmt.y10[0], 4.02); // H.15 RIFLGFCY10_N.M, January 1959
  assert.equal(DATA.bill3[0], 2.82); // H.15 RIFSGFSM03_N.M, January 1959
  assert.equal(DATA.cmt.y10.at(-1), 4.99); // September 2026
  assert.equal(DATA.bill3.at(-1), 3.94);
  assert.equal(DATA.cmt.y2[at("2026-09")], 4.65);
  assert.equal(DATA.cmt.m3[at("1981-08")], null); // the 3-month constant maturity starts in September 1981
  const s = spreadSeries(DATA, "10y3m");
  // allmonth.xls, column "Spread": January 1959 and August 2026.
  close(s[0], 1.1403059139902267, 1e-12);
  close(s[at("2026-08")], 0.8725304277893113, 1e-12);
  const s2 = spreadSeries(DATA, "10y2y");
  assert.equal(s2[at("1976-05")], null);
  close(s2[at("2026-09")], 4.99 - 4.65, 1e-12);
  assert.throws(() => spreadSeries(DATA, "nonsense"));
});

test("recession months follow the NBER's convention: from the month after the peak to the trough", () => {
  const r = recessionSeries(DATA);
  assert.equal(r.length, monthDiff(DATA.first, DATA.last) + 1);
  assert.equal(r[at("1960-04")], 0); // peak
  assert.equal(r[at("1960-05")], 1);
  assert.equal(r[at("1961-02")], 1); // trough
  assert.equal(r[at("1961-03")], 0);
  assert.equal(r[at("2020-02")], 0);
  assert.equal(r[at("2020-03")], 1);
  assert.equal(r[at("2020-04")], 1);
  assert.equal(r[at("2020-05")], 0);
  // The New York Fed's column NBER_Rec has 95 recession months from 1959 to 2020.
  assert.equal(r.reduce((a, b) => a + b, 0), 95);
});

test("what was known when: announced turning points and the 24-month rule", () => {
  assert.equal(LAG, 24);
  // The December 2007 peak was announced on 1 December 2008.
  assert.equal(latestAnnounced(DATA, "2008-11"), "2001-11");
  assert.equal(latestAnnounced(DATA, "2008-12"), "2007-12");
  assert.equal(knownAt(DATA, "2007-12", "2008-11"), false);
  assert.equal(knownAt(DATA, "2007-12", "2008-12"), true);
  assert.equal(knownAt(DATA, "2008-06", "2008-12"), false); // after the announced peak: whether a trough had come was unknown
  assert.equal(knownAt(DATA, "2006-11", "2008-11"), true); // 24 months back
  assert.equal(knownAt(DATA, "2006-12", "2008-11"), false);
  assert.equal(latestAnnounced(DATA, "1979-12"), null); // the committee's first announcement was on 3 June 1980
  // No turning point has been announced since the April 2020 trough (19 July 2021), so in September 2026 outcomes are known to September 2024.
  assert.equal(knownAt(DATA, "2024-09", "2026-09"), true);
  assert.equal(knownAt(DATA, "2024-10", "2026-09"), false);
});

test("fitting: a hand-made logit, invalid samples and perfect separation", () => {
  // Overlapping outcomes, so the estimate exists; at the optimum the score equations hold.
  const x = [-2, -1, 0, 1, 2, -2, -1, 0, 1, 2], y = [0, 1, 0, 1, 1, 0, 0, 1, 0, 1];
  const f = fitBinary(x, y, "logit");
  assert.ok(f.converged);
  // Score equations: sum(y - p) = 0 and sum(x (y - p)) = 0.
  const p = x.map((v) => predict(f, v, "logit"));
  close(p.reduce((s, v, i) => s + y[i] - v, 0), 0, 1e-8);
  close(p.reduce((s, v, i) => s + x[i] * (y[i] - v), 0), 0, 1e-8);
  const g = fitBinary(x, y, "probit");
  close(x.map((v) => predict(g, v, "probit")).reduce((s, v, i) => s + y[i] - v, 0), 0, 1e-8);
  assert.ok(fitBinary(x, y.map(() => 0), "probit").error);
  assert.ok(fitBinary([1, 2, 3], [0, 1, 1], "probit").error);
  // x below 0 always 0 and above always 1: no finite estimate exists.
  const sep = fitBinary([-3, -2, -1, -0.5, -0.2, 0.2, 0.5, 1, 2, 3, 4, 5], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1], "logit");
  assert.match(sep.error, /separates/);
  assert.match(fitBinary([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1], "probit").error, /does not vary/);
  assert.throws(() => fitBinary(x, y, "cloglog"));
});

test("the New York Fed's published estimates are reproduced from H.15 and NBER data", () => {
  // newyorkfed.org yield curve model: "Parameters estimated using data from January 1959 to December 2009 ... alpha = -0.5333,
  // beta = -0.6330": spreads from January 1959 to December 2008, recession states twelve months later.
  const f = fitWindow(DATA, { spread: "10y3m", h: 12, link: "probit", from: "1959-01", to: "2008-12" });
  assert.equal(f.n, 600);
  close(f.a, -0.5333, 0.0001);
  close(f.b, -0.6330, 0.0005);
});

test("AUC: a hand-computed case, ties, and agreement with the area under the ROC points", () => {
  const p = [0.1, 0.4, 0.35, 0.8], y = [0, 0, 1, 1];
  close(auc(p, y), 0.75);
  close(trapezoid(rocCurve(p, y)), 0.75);
  close(auc([0.5, 0.5], [1, 0]), 0.5);
  close(trapezoid(rocCurve([0.5, 0.5, 0.2], [1, 0, 0])), 0.75);
  close(auc([0.5, 0.5, 0.2], [1, 0, 0]), 0.75);
  assert.equal(auc([0.2, 0.3], [0, 0]), null);
  assert.deepEqual(rocCurve([0.2], [1]), []);
  const r = rocCurve(p, y);
  assert.deepEqual([r[0].fpr, r[0].tpr], [0, 0]);
  assert.deepEqual([r.at(-1).fpr, r.at(-1).tpr], [1, 1]);
});

test("confusion table and Brier score by hand", () => {
  const c = confusion([0.9, 0.6, 0.4, 0.2, 0.7], [1, 0, 1, 0, 0], 0.6);
  assert.deepEqual([c.tp, c.fp, c.fn, c.tn], [1, 2, 1, 1]);
  close(c.tpr, 0.5); close(c.fpr, 2 / 3); close(c.precision, 1 / 3); close(c.accuracy, 0.4); close(c.alwaysNo, 0.6);
  // p exactly at the threshold is flagged.
  assert.equal(confusion([0.5], [1], 0.5).tp, 1);
  const none = confusion([0.1, 0.2], [0, 0], 0.5);
  assert.equal(none.tpr, null);
  assert.equal(none.precision, null);
  const b = brier([0.9, 0.1], [1, 0], [0.5, 0.5]);
  close(b.brier, 0.01); close(b.ref, 0.25); close(b.skill, 0.96);
});

test("episodes and recessions caught", () => {
  const rows = [
    { origin: "2000-01", target: "2001-01", p: 0.6, y: 0 }, { origin: "2000-02", target: "2001-02", p: 0.7, y: 0 },
    { origin: "2000-03", target: "2001-03", p: 0.2, y: 0 }, { origin: "2000-04", target: "2001-04", p: 0.6, y: 1 },
  ];
  assert.deepEqual(episodes(rows, 0.5), [{ from: "2000-01", to: "2000-02", hit: false }, { from: "2000-04", to: "2000-04", hit: true }]);
  const caught = recessionsCaught({ cycles: [{ peak: "2001-03", trough: "2001-11" }] }, rows, 0.5);
  assert.equal(caught.length, 0); // the scored targets end in April 2001, before the trough
});

test("real-time forecasts use no outcome that was unknown at the time", () => {
  const rows = realTime(DATA, { spread: "10y3m", h: 12, link: "probit", from: "1980-01" });
  const byOrigin = new Map(rows.map((r) => [r.origin, r]));
  // June 2008: the 2007 peak was not yet announced, so the latest outcome used is June 2006 (24 months back).
  assert.equal(byOrigin.get("2008-06").lastOutcome, "2006-06");
  // January 2009: the December 2007 peak had been announced.
  assert.equal(byOrigin.get("2009-01").lastOutcome, "2007-12");
  // Remove the 2020 recession from the data: forecasts made before its announcement (June 2020) must not change.
  const altered = { ...DATA, cycles: DATA.cycles.filter((c) => c.peak !== "2020-02"), announced: DATA.announced.filter((a) => a.month < "2020-01") };
  const other = new Map(realTime(altered, { spread: "10y3m", h: 12, link: "probit", from: "1980-01" }).map((r) => [r.origin, r]));
  for (const r of rows) if (r.origin < "2020-06" && r.target < "2020-03") close(other.get(r.origin).p, r.p, 1e-12);
  // Every forecast is for a month whose outcome is known today, and the last is September 2023 for September 2024.
  assert.equal(rows.at(-1).origin, "2023-09");
  assert.equal(rows[0].origin, "1980-01");
});

test("the finding on the page", () => {
  const rows = realTime(DATA, { spread: "10y3m", h: 12, link: "probit", from: "1980-01" });
  const p = rows.map((r) => r.p), y = rows.map((r) => r.y);
  assert.equal(rows.length, 525);
  const hs = hindsightFit(DATA, { spread: "10y3m", h: 12, link: "probit" });
  assert.equal(auc(p, y).toFixed(2), "0.83");
  assert.equal(auc(rows.map((r) => predict(hs, r.spread, "probit")), y).toFixed(2), "0.85");
  const b = brier(p, y, rows.map((r) => r.base));
  assert.equal(b.skill.toFixed(2), "0.20");
  const c = confusion(p, y, 0.2);
  assert.deepEqual([c.tp, c.fp, c.fn, c.tn], [33, 61, 19, 412]);
  assert.deepEqual(recessionsCaught(DATA, rows, 0.2).map((r) => r.caught), [true, true, true, true, true]);
  assert.deepEqual(recessionsCaught(DATA, rows, 0.5).map((r) => r.caught), [true, false, false, false, false]);
  // Today's model and the latest spread (September 2026).
  const x = spreadSeries(DATA, "10y3m").at(-1);
  close(x, 4.99 - bondEquivalent(3.94), 1e-12);
  assert.equal((100 * predict(hs, x, "probit")).toFixed(0), "10");
});
