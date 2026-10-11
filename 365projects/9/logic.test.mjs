import test from "node:test";
import assert from "node:assert/strict";
import { WELLBEING } from "../data/wellbeing.js";
import { DIMENSIONS, KEYS, countryRows, ranks, spearman, normalise, shares, score, rank, rankBy, rankRange, movers, FLOOR } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

// Three invented countries: A is balanced, B is rich and unfree, C is poor and free.
const toy = () => {
  const mk = (name, health, freedom, income, community) => ({ name, region: "X", ladder: 5, gdp: Math.exp(income), life: health, raw: { health, freedom, income, community, generosity: 0.1, integrity: 0.1 } });
  return [mk("A", 75, 0.6, 10, 1.2), mk("B", 80, 0.2, 11, 1.0), mk("C", 60, 1.0, 8, 1.4)];
};

test("ranks share ties and spearman is 1 for any increasing relation", () => {
  assert.deepEqual(ranks([10, 30, 20]), [1, 3, 2]);
  assert.deepEqual(ranks([5, 5, 1, 9]), [2.5, 2.5, 1, 4]);
  close(spearman([1, 2, 3, 4], [1, 10, 100, 1000]), 1);
  close(spearman([1, 2, 3, 4], [9, 7, 5, 1]), -1);
  close(spearman([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);
});

test("min-max scores run from 0 to 100 and rank scores are percentiles", () => {
  const mm = normalise(toy());
  assert.equal(mm[1].scores.health, 100);
  assert.equal(mm[2].scores.health, 0);
  close(mm[0].scores.health, 75);
  close(mm[0].scores.income, (2 / 3) * 100);
  const rk = normalise(toy(), "rank");
  assert.deepEqual(rk.map((r) => r.scores.freedom), [50, 0, 100]);
  // A dimension on which every country is equal cannot separate them: everyone gets full marks.
  assert.ok(mm.every((r) => r.scores.generosity === 100));
});

test("weights become shares, negative weights count as zero, and all-zero weights are refused", () => {
  const w = shares({ health: 2, income: 6, freedom: -3 });
  close(w.health, 0.25); close(w.income, 0.75); assert.equal(w.freedom, 0);
  close(KEYS.reduce((s, k) => s + w[k], 0), 1);
  assert.equal(shares({}), null);
  assert.deepEqual(rank(normalise(toy()), {}), []);
});

test("putting all the weight on one dimension orders countries by that dimension", () => {
  const scored = normalise(toy());
  assert.deepEqual(rank(scored, { income: 1 }).map((r) => r.name), ["B", "A", "C"]);
  assert.deepEqual(rank(scored, { freedom: 5 }).map((r) => r.name), ["C", "A", "B"]);
  assert.deepEqual(rank(scored, { income: 1 }).map((r) => r.rank), [1, 2, 3]);
});

test("the arithmetic index is the weighted mean and the geometric index punishes a weak dimension", () => {
  const scored = normalise(toy());
  const w = shares({ health: 1, freedom: 1 });
  const a = scored[0], b = scored[1];
  close(score(a.scores, w), (75 + 50) / 2);
  close(score(b.scores, w), (100 + 0) / 2);
  close(score(a.scores, w, "geometric"), Math.sqrt(75 * 50));
  // B scores 0 on freedom: floored at 1, so the geometric mean is sqrt(100 * 1) and not zero.
  close(score(b.scores, w, "geometric"), Math.sqrt(100 * FLOOR));
  assert.ok(score(b.scores, w, "geometric") < score(b.scores, w));
  // Equal scores on every dimension give the same index either way.
  close(score({ health: 40, freedom: 40, income: 40, community: 40, generosity: 40, integrity: 40 }, shares({ health: 1, freedom: 2, income: 3 }), "geometric"), 40);
});

test("rankBy and movers compare two orderings", () => {
  const rows = toy();
  const byIncome = rankBy(rows, (r) => r.gdp);
  assert.deepEqual(byIncome, { B: 1, A: 2, C: 3 });
  const m = movers(rank(normalise(rows), { freedom: 1 }), byIncome, 1);
  assert.deepEqual(m.up[0], { name: "C", rank: 1, was: 3, change: 2 });
  assert.deepEqual(m.down[0], { name: "B", rank: 3, was: 1, change: -2 });
});

test("rank ranges are reproducible, ordered and cover every possible first place", () => {
  const scored = normalise(toy());
  const a = rankRange(scored, ["health", "freedom", "income", "community"], { samples: 400, seed: 2 });
  const b = rankRange(scored, ["health", "freedom", "income", "community"], { samples: 400, seed: 2 });
  assert.deepEqual([...a], [...b]);
  for (const v of a.values()) assert.ok(v.best <= v.lo && v.lo <= v.median && v.median <= v.hi && v.hi <= v.worst && v.best >= 1 && v.worst <= 3);
  // The single-measure rankings count towards best and worst. C is last on health and income and first on freedom
  // and community (B is the reverse); two random draws cannot be relied on to show both extremes, but best and worst do.
  const few = rankRange(scored, ["health", "freedom", "income", "community"], { samples: 2, seed: 2 });
  assert.deepEqual([few.get("C").best, few.get("C").worst], [1, 3]);
  assert.deepEqual([few.get("B").best, few.get("B").worst], [1, 3]);
  // With only income in play there is nothing to vary.
  const fixed = rankRange(scored, ["income"], { samples: 50 });
  assert.deepEqual(fixed.get("B"), { best: 1, worst: 1, lo: 1, median: 1, hi: 1 });
});

test("real data: every dimension is present and the page's finding holds", () => {
  const year = WELLBEING.years.at(-1);
  assert.equal(year, 2025);
  const rows = countryRows(WELLBEING, year);
  assert.equal(rows.length, 142);
  assert.ok(rows.every((r) => KEYS.every((k) => Number.isFinite(r.raw[k]))));
  assert.equal(DIMENSIONS.length, 6);
  assert.deepEqual(countryRows(WELLBEING, 1999), []);
  const scored = normalise(rows);
  assert.ok(scored.every((r) => KEYS.every((k) => r.scores[k] >= 0 && r.scores[k] <= 100)));

  const equal = rank(scored, { health: 1, freedom: 1, income: 1, community: 1 });
  const byIncome = rankBy(rows, (r) => r.gdp);
  const us = equal.find((r) => r.name === "United States");
  assert.equal(byIncome["United States"], 6);
  assert.equal(us.rank, 37);
  assert.equal(equal[0].name, "Norway");
  assert.equal(rank(scored, { income: 1 })[0].name, "Singapore");
  close(spearman(equal.map((r) => r.index), equal.map((r) => r.ladder)), 0.892, 0.0015);
  close(spearman(rows.map((r) => r.gdp), rows.map((r) => r.ladder)), 0.803, 0.0015);

  // The United States by hand: its four scores are 78.3, 67.6, 87.3 and 88.2, so its index is their mean.
  close(us.scores.health, ((78.64 - 54.55) / (85.32 - 54.55)) * 100, 1e-9);
  close(us.scores.income, ((Math.log(75660) - Math.log(1405)) / (Math.log(134813) - Math.log(1405))) * 100, 1e-9);
  close(us.index, (us.scores.health + us.scores.freedom + us.scores.income + us.scores.community) / 4, 1e-9);
  close(us.index, 80.4, 0.05);
  // Spot checks against the sources: World Happiness Report 2026 (United States 6.816, rank 23) and the World
  // Bank (life expectancy 78.385 in 2023 and 78.890 in 2024; GDP per person 74,351.67, 75,698.18 and 76,931.31
  // for 2023 to 2025).
  assert.equal(us.ladder, 6.816);
  assert.equal(us.life, Number(((78.3853658536585 + 78.890243902439) / 2).toFixed(2)));
  assert.equal(us.gdp, Math.round((74351.6718197429 + 75698.1773354629 + 76931.3106990408) / 3));

  // The rank range quoted for the United States on the page: 6th (income alone) to 114th (freedom alone).
  const range = rankRange(scored, ["health", "freedom", "income", "community"], { samples: 1000, seed: 9 }).get("United States");
  assert.deepEqual([range.best, range.worst], [6, 114]);
  assert.equal(rank(scored, { freedom: 1 }).find((r) => r.name === "United States").rank, 114);
  assert.ok(Math.abs(range.lo - 14) <= 2 && Math.abs(range.hi - 78) <= 2, `middle 90% is ${range.lo} to ${range.hi}; an independent run of 20,000 draws gave 14 to 78`);
});
