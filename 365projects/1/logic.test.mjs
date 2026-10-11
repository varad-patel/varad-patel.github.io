import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { WELLBEING } from "../data/wellbeing.js";
import { CONTROLS, rowsFor, availableControls, fit, outliers, predictAlone } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// A synthetic world where the truth is known: ladder = 1 + 0.2*doublings + 0.05*health + noise, and health rises with income.
function synthetic(n = 300, seed = 5) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const doublings = r.uniform(9, 17);
    const health = 40 + 2.5 * doublings + r.normal(0, 2);
    const ladder = 1 + 0.2 * doublings + 0.05 * health + r.normal(0, 0.3);
    return { name: `C${i}`, region: "X", gdp: 2 ** doublings, doublings, ladder, health, social: null, freedom: null, generosity: null, corruption: null };
  });
}

test("income alone absorbs the effect of an omitted control, and adding the control recovers the true effect", () => {
  const rows = synthetic();
  const alone = fit(rows, []);
  // Health rises 2.5 per doubling and is worth 0.05 each, so the naive slope is about 0.2 + 0.125.
  close(alone.alone.perDoubling, 0.325, 0.03);
  const both = fit(rows, ["health"]);
  close(both.withControls.perDoubling, 0.2, 0.05);
  close(both.coefficients[1].beta, 0.05, 0.02);
  assert.ok(both.withControls.perDoubling < alone.alone.perDoubling);
});

test("the variance split adds up to one and matches the three regressions", () => {
  const f = fit(synthetic(), ["health"]);
  const s = f.split;
  close(s.income + s.shared + s.controls + s.unexplained, 1, 1e-9);
  close(s.income + s.shared, f.alone.r2, 1e-9);
  close(s.controls + s.shared, f.controlsOnlyR2, 1e-9);
  assert.ok(s.income > 0 && s.controls > 0 && s.shared > 0);
});

test("the added-variable plot has the same slope as the full regression", () => {
  const f = fit(synthetic(), ["health"]);
  const slope = stats.linreg(f.partial.map((p) => p.ex), f.partial.map((p) => p.ey)).slope;
  close(slope, f.withControls.perDoubling, 1e-8);
});

test("rows with a missing control are dropped from both models, and tiny samples are refused", () => {
  const rows = synthetic(60);
  rows.slice(0, 20).forEach((r) => { r.health = null; });
  const f = fit(rows, ["health"]);
  assert.equal(f.n, 40);
  assert.equal(f.sample.length, 40);
  assert.ok(fit(rows.slice(0, 26), ["health"]).error);
  assert.equal(fit(rows, []).n, 60);
});

test("outliers are the largest residuals in each direction", () => {
  const rows = synthetic(100);
  rows[0].ladder += 5;
  rows[1].ladder -= 5;
  const o = outliers(fit(rows, []), 2);
  assert.equal(o.above[0].name, "C0");
  assert.equal(o.below[0].name, "C1");
  assert.ok(o.above[0].residual > 0 && o.below[0].residual < 0);
});

test("real data: richer countries report higher life evaluations, and controls shrink the income effect", () => {
  const year = WELLBEING.years.at(-1);
  const rows = rowsFor(WELLBEING, year);
  assert.ok(rows.length > 120, `only ${rows.length} rows`);
  assert.deepEqual(availableControls(rows), CONTROLS.map((c) => c.key));
  const alone = fit(rows, []);
  assert.ok(alone.alone.perDoubling > 0.2 && alone.alone.perDoubling < 1.2, `slope ${alone.alone.perDoubling}`);
  assert.ok(alone.alone.r2 > 0.4 && alone.alone.r2 < 0.9, `r2 ${alone.alone.r2}`);
  const all = fit(rows, CONTROLS.map((c) => c.key));
  assert.ok(!all.error);
  assert.ok(all.withControls.r2 > alone.alone.r2);
  assert.ok(all.withControls.perDoubling < alone.alone.perDoubling);
  close(predictAlone(alone, 2 ** 13), alone.alone.intercept + 13 * alone.alone.perDoubling, 1e-9);
});

test("the finding on the page: 142 countries, 63%, 0.55 and 0.16 points, under one percentage point unique to income", () => {
  const f = fit(rowsFor(WELLBEING, 2025), CONTROLS.map((c) => c.key));
  assert.equal(f.n, 142);
  assert.equal(f.alone.r2.toFixed(2), "0.63");
  assert.equal(f.alone.perDoubling.toFixed(2), "0.55");
  assert.equal(f.withControls.perDoubling.toFixed(2), "0.16");
  assert.ok(f.split.income > 0 && f.split.income < 0.01, `only income ${f.split.income}`);
});

test("real data agrees with a separate implementation (normal equations in Python, run during review)", () => {
  // No controls, 2023 to 2025: 144 countries.
  const a = fit(rowsFor(WELLBEING, 2025), []);
  assert.equal(a.n, 144);
  close(a.alone.perDoubling, 0.547527, 1e-5);
  close(a.alone.se, 0.0698 / 1.96, 1e-4);
  close(a.alone.r2, 0.624866, 1e-5);
  // All five controls.
  const f = fit(rowsFor(WELLBEING, 2025), CONTROLS.map((c) => c.key));
  close(f.withControls.perDoubling, 0.155498, 1e-5);
  close(f.withControls.r2, 0.819173, 1e-5);
  close(f.split.income, 0.007532, 1e-5);
  close(f.split.shared, 0.620041, 1e-5);
  close(f.split.controls, 0.1916, 1e-5);
  close(f.coefficients.find((c) => c.key === "social").perSd, 0.4881, 1e-4);
  assert.deepEqual(outliers(f, 3).below.map((r) => r.name), ["Botswana", "Sri Lanka", "Cambodia"]);
  // Health only, 2013 to 2015.
  const h = fit(rowsFor(WELLBEING, 2015), ["health"]);
  assert.equal(h.n, 151);
  close(h.withControls.perDoubling, 0.359232, 1e-5);
  close(h.split.shared, 0.584902, 1e-5);
});

test("the shared part can be negative, and the three parts still add up", () => {
  // Generosity is measured net of income, so the two explain more together than apart.
  const f = fit(rowsFor(WELLBEING, 2019), ["generosity"]);
  assert.ok(f.split.shared < 0, `shared ${f.split.shared}`);
  close(f.split.income + f.split.shared + f.split.controls + f.split.unexplained, 1, 1e-9);
});

test("too few countries: the message says what is short and how to fix it", () => {
  const rows = rowsFor(WELLBEING, 2025);
  const two = fit(rows.filter((r) => r.region === "North America"), []);
  assert.equal(two.n, 2);
  assert.match(two.error, /Only 2 countries have a life evaluation and an income here, and at least 8 are needed/);
  assert.doesNotMatch(two.error, /fewer controls/);
  assert.match(fit(rows.slice(0, 1), []).error, /Only 1 country has/);
  assert.match(fit(rows.slice(0, 9), ["health", "social"]).error, /at least 10 are needed to fit this many controls. Choose fewer controls/);
});

test("years before the factor data exist offer only the health control", () => {
  const rows = rowsFor(WELLBEING, 2015);
  assert.ok(rows.length > 100);
  assert.deepEqual(availableControls(rows), ["health"]);
  assert.deepEqual(rowsFor(WELLBEING, 1900), []);
});
