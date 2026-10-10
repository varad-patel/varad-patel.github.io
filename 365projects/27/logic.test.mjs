import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import { KINDS, PROCEDURES, RIVALS, PRESETS, MAX_COUNT, worlds, likelihood, evidence, allEvidence, afterN, needed, worth, fractionGrid } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const rel = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} is not within ${tol} (relative) of ${b}`);
const county = { ravens: 100, black: 250000, nonblack: 1000000, fraction: 0.1 };
const lnOf = (w, proc, kind) => evidence(w, proc, kind).lnLR;

test("the two worlds are built as described, for each assumption about the rival", () => {
  const a = worlds({ ...county, rival: "extra" });
  assert.deepEqual(a.h, { br: 100, nr: 0, bn: 250000, nn: 1000000 });
  assert.deepEqual(a.r, { br: 90, nr: 10, bn: 250000, nn: 1000000 });
  const b = worlds({ ...county, rival: "fixed" });
  assert.deepEqual(b.r, { br: 90, nr: 10, bn: 250010, nn: 999990 });
  // "fixed" keeps the totals of ravens, of non-black things and of everything.
  assert.equal(b.r.br + b.r.nr, 100);
  assert.equal(b.r.nr + b.r.nn, b.h.nr + b.h.nn);
  assert.equal(b.r.br + b.r.nr + b.r.bn + b.r.nn, b.h.br + b.h.bn + b.h.nn);
  const c = worlds({ ravens: 100, black: 200000, nonblack: 800000, fraction: 0.001, rival: "more", rivalRavens: 1000 });
  assert.deepEqual(c.r, { br: 999, nr: 1, bn: 200000, nn: 800000 });
});

test("a likelihood is the kind's share of the pool it was drawn from", () => {
  const { h, r } = worlds({ ...county, rival: "extra" });
  assert.equal(likelihood(h, "raven", "br"), 1);
  close(likelihood(r, "raven", "br"), 0.9);
  close(likelihood(r, "raven", "nr"), 0.1);
  assert.equal(likelihood(h, "nonblack", "nn"), 1);
  close(likelihood(r, "nonblack", "nn"), 1000000 / 1000010);
  close(likelihood(h, "any", "br"), 100 / 1250100);
  close(likelihood(r, "any", "bn"), 250000 / 1250100);
  close(likelihood(h, "black", "br"), 100 / 250100);
  close(likelihood(r, "black", "br"), 90 / 250090);
  close(likelihood(h, "nonraven", "nn"), 0.8);
  // A procedure cannot produce a kind outside its pool.
  assert.equal(likelihood(h, "raven", "nn"), null);
  assert.equal(likelihood(h, "nonsense", "br"), null);
  // The shares of each pool add to one in each world.
  for (const p of PROCEDURES) for (const w of [h, r]) close(p.pool.reduce((s, k) => s + likelihood(w, p.key, k), 0), 1, 1e-12);
});

test("simulated sampling from a small world matches the likelihoods", () => {
  const { r } = worlds({ ravens: 20, black: 10, nonblack: 70, fraction: 0.1, rival: "extra" });
  const objects = Object.entries(r).flatMap(([kind, n]) => Array.from({ length: Math.round(n) }, () => kind));
  const rand = rng(27);
  for (const proc of PROCEDURES) {
    const pool = objects.filter((k) => proc.pool.includes(k));
    const seen = Object.fromEntries(proc.pool.map((k) => [k, 0]));
    const draws = 60000;
    for (let i = 0; i < draws; i++) seen[rand.pick(pool)]++;
    for (const k of proc.pool) close(seen[k] / draws, likelihood(r, proc.key, k), 0.01);
  }
});

test("a black raven picked from the ravens has likelihood ratio 1 / (1 - f) under every assumption", () => {
  for (const f of [0.001, 0.1, 0.5, 0.9]) {
    for (const rival of ["extra", "fixed", "more"]) {
      const w = worlds({ ...county, fraction: f, rival, rivalRavens: 5000 });
      rel(evidence(w, "raven", "br").lr, 1 / (1 - f), 1e-12);
    }
  }
  // Hand-computed: f = 10% gives 1.1111, 0.152 bits, and moves 50% to 52.63%.
  const e = evidence(worlds({ ...county, rival: "extra" }), "raven", "br", 0.5);
  close(e.lr, 10 / 9, 1e-12);
  close(e.bits, Math.log2(10 / 9), 1e-12);
  close(e.posterior, 10 / 19, 1e-12);
  close(e.difference, 10 / 19 - 0.5, 1e-12);
  close(e.ratio, (10 / 19) / 0.5, 1e-12);
  close(e.ko, (1 - 0.9) / (1 + 0.9), 1e-12);
});

test("when only the ravens differ, a white shoe confirms only if it was picked from the non-black things", () => {
  const w = worlds({ ...county, rival: "extra" });
  // Picked from the non-black things: LR = (W + fR) / W = 1.00001.
  const e = evidence(w, "nonblack", "nn", 0.5);
  rel(e.excess, 1e-5, 1e-9);
  rel(e.lnLR, Math.log1p(1e-5), 1e-9);
  assert.ok(e.posterior > 0.5 && e.posterior < 0.50001);
  rel(e.difference, (0.25 * 1e-5) / (1 + 0.5e-5), 1e-9);
  // Picked from everything, or from the non-ravens: exactly no evidence.
  assert.equal(lnOf(w, "any", "nn"), 0);
  assert.equal(lnOf(w, "nonraven", "nn"), 0);
  assert.equal(evidence(w, "any", "nn", 0.3).posterior, 0.3);
  // Black shoes are the same: neutral unless the pool itself depends on the hypothesis.
  assert.equal(lnOf(w, "any", "bn"), 0);
  assert.equal(lnOf(w, "nonraven", "bn"), 0);
  assert.ok(lnOf(w, "black", "bn") < 0);
  // A black raven picked from everything is as good as one picked from the ravens.
  rel(lnOf(w, "any", "br"), lnOf(w, "raven", "br"), 1e-12);
  // Picked from the black things it is worth slightly less: (100/250,100) / (90/250,090).
  rel(evidence(w, "black", "br").lr, (100 / 250100) / (90 / 250090), 1e-12);
  assert.ok(lnOf(w, "black", "br") > 0 && lnOf(w, "black", "br") < lnOf(w, "raven", "br"));
});

test("on the textbook assumption the way of picking does not matter, and a white shoe confirms by M / (M - fR)", () => {
  const w = worlds({ ...county, rival: "fixed" });
  const shoe = Math.log(1000000 / 999990);
  for (const proc of ["nonblack", "any", "nonraven"]) rel(lnOf(w, proc, "nn"), shoe, 1e-9);
  for (const proc of ["raven", "any", "black"]) rel(lnOf(w, proc, "br"), Math.log(10 / 9), 1e-9);
  // A black shoe counts slightly against: K / (K + fR).
  for (const proc of ["black", "any", "nonraven"]) rel(lnOf(w, proc, "bn"), Math.log(250000 / 250010), 1e-9);
  // Not enough non-black things to replace.
  assert.ok(worlds({ ravens: 100, black: 5, nonblack: 5, fraction: 0.1, rival: "fixed" }).error);
  // Exactly enough: no white shoes are left in the rival world, so seeing one proves the hypothesis.
  const edge = evidence(worlds({ ravens: 100, black: 5, nonblack: 10, fraction: 0.1, rival: "fixed" }), "any", "nn", 0.4);
  assert.equal(edge.lnLR, Infinity);
  assert.equal(edge.posterior, 1);
  close(edge.difference, 0.6, 1e-12);
  assert.equal(edge.ko, 1);
});

test("a raven that is not black refutes the hypothesis however it was found", () => {
  for (const rival of RIVALS.map((r) => r.key)) {
    const w = worlds({ ...county, rival, rivalRavens: 300 });
    for (const proc of ["raven", "nonblack", "any"]) {
      const e = evidence(w, proc, "nr", 0.9);
      assert.equal(e.lnLR, -Infinity);
      assert.equal(e.lr, 0);
      assert.equal(e.posterior, 0);
      close(e.difference, -0.9, 1e-12);
      assert.equal(e.ko, -1);
    }
  }
});

test("Good's two worlds: a black raven picked at random counts against 'all ravens are black'", () => {
  const p = PRESETS.find((x) => x.key === "good");
  const w = worlds(p);
  const e = evidence(w, "any", "br", 0.5);
  // (100 / 1,000,100) / (999 / 1,001,000)
  rel(e.lr, (100 / 1000100) / (999 / 1001000), 1e-12);
  assert.ok(e.lr > 0.1 && e.lr < 0.1003);
  assert.ok(e.posterior < 0.1);
  // Picked from the ravens it still confirms, minutely.
  assert.ok(lnOf(w, "raven", "br") > 0);
});

test("the posterior agrees with Bayes' theorem written out directly", () => {
  for (const p of PRESETS) {
    const w = worlds(p);
    for (const prior of [0.05, 0.5, 0.93]) {
      for (const row of allEvidence(w, prior)) {
        if (row.impossible) continue;
        const direct = (prior * row.pH) / (prior * row.pH + (1 - prior) * row.pR);
        close(row.posterior, direct, 1e-12);
        close(row.difference, direct - prior, 1e-12);
        if (row.pR > 0) rel(row.lr, row.pH / row.pR, 1e-9);
        close(row.ko, (row.pH - row.pR) / (row.pH + row.pR), 1e-9);
      }
    }
  }
  assert.equal(allEvidence(worlds(PRESETS[0])).length, 12);
});

test("tiny effects keep their precision", () => {
  // One raven among a billion non-black things, rival share 0.1%: LR - 1 = 1e-12.
  const w = worlds({ ravens: 1, black: 0, nonblack: MAX_COUNT, fraction: 0.001, rival: "extra" });
  const e = evidence(w, "nonblack", "nn", 0.5);
  rel(e.excess, 1e-12, 1e-3);
  assert.ok(e.lnLR > 0);
  rel(e.difference, 0.25e-12, 1e-3);
});

test("repeated observations multiply the odds, and the counts needed follow", () => {
  const w = worlds({ ...county, rival: "extra" });
  const raven = lnOf(w, "raven", "br");
  const shoe = lnOf(w, "nonblack", "nn");
  assert.equal(afterN(0.5, raven, 0), 0.5);
  close(afterN(0.5, raven, 1), 10 / 19, 1e-12);
  // Twice in a row equals updating on the first posterior.
  close(afterN(0.5, raven, 2), evidence(w, "raven", "br", 10 / 19).posterior, 1e-12);
  assert.equal(afterN(0.5, -Infinity, 3), 0);
  assert.equal(afterN(0.5, Infinity, 3), 1);
  assert.equal(afterN(0.2, 0, 1000), 0.2);
  // ln(99) / ln(10/9) = 43.6, so 44 black ravens reach 99% from 50%.
  assert.equal(needed(0.5, raven, 0.99), 44);
  assert.ok(afterN(0.5, raven, 44) >= 0.99 && afterN(0.5, raven, 43) < 0.99);
  assert.equal(needed(0.5, shoe, 0.99), Math.ceil(Math.log(99) / Math.log1p(1e-5)));
  assert.equal(needed(0.995, raven, 0.99), 0);
  assert.equal(needed(0.5, 0, 0.99), null);
  assert.equal(needed(0.5, -0.1, 0.99), null);
  assert.equal(needed(0.5, Infinity, 0.99), 1);
  rel(worth(raven, shoe), Math.log(10 / 9) / Math.log1p(1e-5), 1e-9);
  assert.equal(worth(raven, 0), null);
  assert.equal(worth(-1, shoe), null);
  assert.equal(worth(Infinity, shoe), null);
});

test("bad input is refused with a reason", () => {
  for (const bad of [
    { ...county, ravens: 0 }, { ...county, ravens: -5 }, { ...county, ravens: NaN }, { ...county, ravens: "100" },
    { ...county, black: -1 }, { ...county, nonblack: MAX_COUNT * 10 }, { ...county, fraction: 0 }, { ...county, fraction: 1.2 },
    { ...county, rival: "more", rivalRavens: 0 }, { ...county, rival: "nonsense" },
  ]) assert.ok(typeof worlds(bad).error === "string", `accepted ${JSON.stringify(bad)}`);
  const w = worlds({ ...county, rival: "extra" });
  assert.ok(evidence(w, "raven", "nn").error);
  assert.ok(evidence(w, "raven", "br", 0).error);
  assert.ok(evidence(w, "raven", "br", 1).error);
  // No non-black things in either world... except the rival's ravens: picking one is impossible under H.
  const none = worlds({ ravens: 10, black: 5, nonblack: 0, fraction: 0.5, rival: "extra" });
  assert.equal(evidence(none, "nonblack", "nr").lnLR, -Infinity);
  assert.ok(evidence(none, "nonblack", "nn").impossible);
  assert.ok(evidence(none, "nonraven", "nn").impossible);
});

test("presets and slider positions are valid", () => {
  const grid = fractionGrid();
  for (let i = 1; i < grid.length; i++) assert.ok(grid[i] > grid[i - 1]);
  assert.equal(grid[0], 0.001);
  assert.equal(grid.at(-1), 0.99);
  for (const p of PRESETS) {
    assert.ok(!worlds(p).error, p.key);
    assert.ok(grid.includes(p.fraction), `${p.key} fraction`);
    assert.ok(!evidence(worlds(p), p.proc, p.kind).error, `${p.key} observation`);
    assert.ok(KINDS.some((k) => k.key === p.kind) && RIVALS.some((r) => r.key === p.rival));
  }
});

test("the finding on the page", () => {
  const w = worlds(PRESETS.find((p) => p.key === "county"));
  const raven = evidence(w, "raven", "br", 0.5);
  const shoe = evidence(w, "nonblack", "nn", 0.5);
  assert.equal(raven.lr.toFixed(3), "1.111");
  assert.equal(shoe.lr.toFixed(5), "1.00001");
  assert.equal(Math.round(worth(raven.lnLR, shoe.lnLR)), 10536);
  assert.equal(evidence(w, "any", "nn", 0.5).lnLR, 0);
  assert.equal((raven.posterior * 100).toFixed(1), "52.6");
  assert.equal((shoe.posterior * 100).toFixed(5), "50.00025");
  assert.equal(needed(0.5, raven.lnLR), 44);
  // ln(99) / ln(1.00001) = 459,514.3, so 459,515 white shoes.
  assert.equal(needed(0.5, shoe.lnLR), 459515);
  // The aviary: a white bird is worth more than a quarter of a black raven.
  const a = worlds(PRESETS.find((p) => p.key === "aviary"));
  assert.equal(worth(lnOf(a, "raven", "br"), lnOf(a, "nonblack", "nn")).toFixed(1), "3.7");
});
