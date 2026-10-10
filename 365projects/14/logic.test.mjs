import test from "node:test";
import assert from "node:assert/strict";
import { csv, rng } from "../kit/kit.js";
import { EXAMPLES, LIMITS, analyse, guessWeight, parseTable, plan, profile, syntheticCsv, context, thirds, toNumber } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const example = (id) => EXAMPLES.find((e) => e.id === id).csv;
function find(r, y, x, z) { return r.comparisons.find((c) => c.y === y && c.x === x && c.z === z); }

test("Berkeley 1973: men are ahead overall, women are ahead once the department mix is held equal", () => {
  const r = analyse(example("berkeley"));
  assert.equal(r.cols[r.weight].name, "applicants");
  assert.equal(r.ctx.total, 4526);
  const c = r.comparisons[0];
  assert.deepEqual([c.y, c.x, c.z, c.a, c.b, c.positive], ["decision", "gender", "department", "men", "women", "admitted"]);
  // Hand count: 1,198 of 2,691 men and 557 of 1,835 women were admitted.
  close(c.overall.a, 1198 / 2691);
  close(c.overall.b, 557 / 1835);
  close(c.overall.effect, 1198 / 2691 - 557 / 1835);
  // Direct standardisation by hand: each department's gap weighted by its share of all 4,526 applicants.
  const depts = { A: [512, 313, 89, 19], B: [353, 207, 17, 8], C: [120, 205, 202, 391], D: [138, 279, 131, 244], E: [53, 138, 94, 299], F: [22, 351, 24, 317] };
  let adjusted = 0;
  for (const [ma, mr, wa, wr] of Object.values(depts)) adjusted += ((ma + mr + wa + wr) / 4526) * (ma / (ma + mr) - wa / (wa + wr));
  close(c.within.effect, adjusted);
  close(c.mix, c.overall.effect - adjusted);
  assert.equal(c.reversal, "partial");
  assert.equal(c.opposed, 4);
  assert.equal(c.kept, 6);
  assert.equal(c.minCell, 25);
  assert.deepEqual(c.groups.filter((g) => g.effect < 0).map((g) => g.level), ["A", "B", "D", "F"]);
  assert.equal(r.reversals.length, 1);
});

test("the numbers quoted under One finding", () => {
  const c = analyse(example("berkeley")).comparisons[0];
  assert.equal((c.overall.a * 100).toFixed(1), "44.5");
  assert.equal((c.overall.b * 100).toFixed(1), "30.4");
  assert.equal((c.overall.effect * 100).toFixed(1), "14.2");
  assert.equal((c.within.effect * 100).toFixed(1), "-4.3");
  assert.equal((c.mix * 100).toFixed(1), "18.4");
  assert.equal(`${c.opposed} of ${c.kept}`, "4 of 6");
  // Figures quoted under "How it works".
  assert.equal(c.strength.toFixed(1), "2.3");
  assert.equal(find(analyse(example("kidney")), "outcome", "treatment", "stone_size").strength.toFixed(1), "1.5");
  const s = analyse(example("exercise"));
  assert.equal(s.table.n, 300);
  assert.equal(s.comparisons[0].overall.effect.toFixed(1), "6.7");
  assert.equal(s.comparisons[0].within.effect.toFixed(1), "-5.9");
  assert.equal(s.comparisons[1].within.effect.toFixed(1), "-2.7");
});

test("kidney stones 1986: treatment B is ahead overall and behind in both stone sizes", () => {
  const r = analyse(example("kidney"));
  const c = find(r, "outcome", "treatment", "stone_size");
  assert.equal(c.a, "B (percutaneous)");
  close(c.overall.a, 289 / 350);
  close(c.overall.b, 273 / 350);
  assert.equal(c.reversal, "full");
  assert.equal(c.opposed, 2);
  const small = c.groups.find((g) => g.level === "small"), large = c.groups.find((g) => g.level === "large");
  close(small.a, 234 / 270); close(small.b, 81 / 87);
  close(large.a, 55 / 80); close(large.b, 192 / 263);
  // Neither side of this famous reversal is two standard errors from zero.
  assert.ok(c.strength > 1.4 && c.strength < 2, `strength ${c.strength}`);
  assert.equal(r.reversals.length, 1);
});

test("standard errors and z scores match a hand-computed 2 by 2 by 2 table", () => {
  // Group g1: a 8/10, b 30/40. Group g2: a 10/40, b 2/10.
  const text = "x,z,y,n\na,g1,1,8\na,g1,0,2\nb,g1,1,30\nb,g1,0,10\na,g2,1,10\na,g2,0,30\nb,g2,1,2\nb,g2,0,8";
  const c = find(analyse(text, { minCell: 1 }), "y", "x", "z");
  // Overall: a 18/50 = 0.36, b 32/50 = 0.64, so b is named first.
  assert.equal(c.a, "b");
  close(c.overall.effect, 0.28);
  close(c.overall.se, Math.sqrt((0.64 * 0.36) / 50 + (0.36 * 0.64) / 50));
  // Within: g1 gap 0.75 - 0.80 = -0.05, g2 gap 0.20 - 0.25 = -0.05, equal shares.
  close(c.within.effect, -0.05);
  const v1 = (0.75 * 0.25) / 40 + (0.8 * 0.2) / 10, v2 = (0.2 * 0.8) / 10 + (0.25 * 0.75) / 40;
  close(c.within.se, Math.sqrt(0.25 * v1 + 0.25 * v2));
  close(c.within.z, -0.05 / c.within.se);
  close(c.strength, Math.abs(c.within.z));
  assert.equal(c.reversal, "full");
});

test("a counted-up table and the same data with one row per observation give the same answer", () => {
  const [head, ...rows] = csv.parse(example("berkeley"));
  const long = [head.slice(0, 3)];
  for (const r of rows) for (let i = 0; i < Number(r[3]); i++) long.push(r.slice(0, 3));
  const a = analyse(example("berkeley")).comparisons[0];
  const b = analyse(csv.stringify(long));
  assert.equal(b.weight, null);
  assert.equal(b.table.n, 4526);
  const c = b.comparisons[0];
  close(c.overall.effect, a.overall.effect, 1e-12);
  close(c.within.effect, a.within.effect, 1e-12);
  close(c.strength, a.strength, 1e-9);
  assert.equal(c.reversal, "partial");
});

test("synthetic slopes: exercise goes with higher cholesterol overall and lower cholesterol inside every age group", () => {
  const r = analyse(example("exercise"));
  assert.equal(r.weight, null);
  const c = find(r, "cholesterol", "exercise_hours", "age_group");
  assert.equal(c.kind, "slope");
  assert.equal(c.reversal, "full");
  assert.equal(c.opposed, 5);
  assert.ok(c.overall.effect > 4 && c.overall.effect < 9, `overall ${c.overall.effect}`);
  // The true effect is -7; a decade is a coarse age band, so some of the age effect is left in.
  assert.ok(c.within.effect < -4 && c.within.effect > -7.5, `within ${c.within.effect}`);
  assert.ok(c.between.effect > c.overall.effect);
  // Cutting age into thirds is coarser still and recovers less.
  const t = r.comparisons.find((k) => k.y === "cholesterol" && k.x === "exercise_hours" && k.z === "age" && k.binned);
  assert.equal(t.reversal, "full");
  assert.ok(t.within.effect > c.within.effect && t.within.effect < 0);
  assert.equal(r.reversals.length, 2);
  assert.equal(r.comparisons[0], c);
});

test("slope statistics match ordinary least squares done the long way", () => {
  const r = rng(3);
  const rows = [["g", "x", "y"]];
  const data = [];
  for (let i = 0; i < 90; i++) { const g = i % 3; const x = r.normal(g * 2, 1); const y = 5 * g - 1.5 * x + r.normal(0, 1); rows.push([`g${g}`, x, y]); data.push({ g, x, y }); }
  const c = find(analyse(csv.stringify(rows)), "y", "x", "g");
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(data.map((d) => d.x)), my = mean(data.map((d) => d.y));
  const sxy = data.reduce((s, d) => s + (d.x - mx) * (d.y - my), 0), sxx = data.reduce((s, d) => s + (d.x - mx) ** 2, 0);
  close(c.overall.effect, sxy / sxx, 1e-9);
  let wxy = 0, wxx = 0;
  for (const g of [0, 1, 2]) {
    const part = data.filter((d) => d.g === g);
    const gx = mean(part.map((d) => d.x)), gy = mean(part.map((d) => d.y));
    wxy += part.reduce((s, d) => s + (d.x - gx) * (d.y - gy), 0);
    wxx += part.reduce((s, d) => s + (d.x - gx) ** 2, 0);
  }
  close(c.within.effect, wxy / wxx, 1e-9);
  close(c.within.effect, -1.5, 0.3);
  assert.equal(c.reversal, c.overall.effect > 0 ? "full" : null);
  // Overall slope is the weighted average of the within and between slopes.
  close(c.overall.effect, (wxx * c.within.effect + (sxx - wxx) * c.between.effect) / sxx, 1e-9);
});

test("no reversal is reported when the groups have the same mix", () => {
  // Treatment helps by 20 points in both groups and both groups are split 50/50.
  const text = "t,g,y,n\nnew,g1,1,70\nnew,g1,0,30\nold,g1,1,50\nold,g1,0,50\nnew,g2,1,40\nnew,g2,0,60\nold,g2,1,20\nold,g2,0,80";
  const r = analyse(text);
  const c = find(r, "y", "t", "g");
  assert.equal(c.reversal, null);
  close(c.overall.effect, 0.2);
  close(c.within.effect, 0.2);
  close(c.mix, 0);
  assert.equal(c.same, 2);
  assert.equal(r.reversals.length, 0);
});

test("small groups are left out of both sides, and the smallest kept group is reported", () => {
  const text = "t,g,y,n\na,g1,1,30\na,g1,0,10\nb,g1,1,20\nb,g1,0,20\na,g2,1,10\na,g2,0,30\nb,g2,1,5\nb,g2,0,35\na,g3,1,1\na,g3,0,1\nb,g3,1,0\nb,g3,0,3";
  const c = find(analyse(text, { minCell: 5 }), "y", "t", "g");
  assert.equal(c.kept, 2);
  assert.equal(c.dropped, 5);
  assert.equal(c.n, 160);
  assert.equal(c.minCell, 40);
  assert.equal(c.groups.find((g) => g.level === "g3").kept, false);
  close(c.overall.a, 40 / 80);
  assert.equal(find(analyse(text, { minCell: 1 }), "y", "t", "g").kept, 3);
  // With one comparable group there is nothing to compare.
  assert.equal(find(analyse(text, { minCell: 50 }), "y", "t", "g"), undefined);
});

test("column types: numbers, two-valued, categories, identifiers and constants", () => {
  const rows = [["id", "score", "passed", "school", "note", "pct"]];
  for (let i = 0; i < 40; i++) rows.push([`P${i}`, i % 2 ? `${1000 + i}.5` : "NA", i % 3 ? "yes" : "no", ["north", "south", "east"][i % 3], "same", `${i}%`]);
  const cols = profile(parseTable(csv.stringify(rows)));
  const by = Object.fromEntries(cols.map((c) => [c.name, c]));
  assert.equal(by.id.kind, "ignored");
  assert.match(by.id.reason, /identifier/);
  assert.equal(by.score.kind, "numeric");
  assert.equal(by.score.missing, 20);
  assert.equal(by.passed.kind, "binary");
  assert.equal(by.passed.levels[by.passed.positive], "yes");
  assert.equal(by.school.kind, "category");
  assert.deepEqual(by.school.levels, ["east", "north", "south"]);
  assert.equal(by.note.kind, "ignored");
  assert.equal(by.pct.kind, "numeric");
  assert.equal(toNumber("1,234.5"), 1234.5);
  assert.equal(toNumber("3,5"), 3.5);
  assert.equal(toNumber("£12"), 12);
  assert.ok(Number.isNaN(toNumber("twelve")));
  assert.ok(Number.isNaN(toNumber("Infinity")));
});

test("the count column is guessed only for counted-up tables, and can be overridden", () => {
  const b = analyse(example("berkeley"));
  assert.equal(b.cols[b.weight].name, "applicants");
  assert.equal(analyse(example("exercise")).weight, null);
  const named = profile(parseTable("a,b,count,c\nx,1,3,u\ny,2,4,v\nx,1,5,u"));
  assert.equal(guessWeight(named, 3), 2);
  // Read as one row per observation, Berkeley's 24 rows are too few to compare anything.
  assert.equal(analyse(example("berkeley"), { weight: null }).reversals.length, 0);
  assert.match(analyse("a,b,c,d\nx,p,1,-2\ny,q,0,3\nx,q,1,4", { weight: 3 }).error, /negative/);
  assert.match(analyse("a,b,c,d\nx,p,1,2\ny,q,0,3\nx,q,1,4", { weight: 0 }).error, /numbers/);
});

test("thirds hold about a third of the observations each", () => {
  const rows = [["v", "a", "b"]];
  for (let i = 1; i <= 90; i++) rows.push([i, i % 2, i % 5]);
  const table = parseTable(csv.stringify(rows));
  const cols = profile(table);
  const t = thirds(cols[0], context(table, cols));
  assert.deepEqual(t.levels, ["up to 30", "30 to 60", "over 60"]);
  assert.deepEqual([0, 1, 2].map((k) => t.codes.filter((c) => c === k).length), [30, 30, 30]);
  assert.equal(plan(cols, { thirds: false }).jobs.some((j) => j.binned), false);
  assert.equal(plan(cols, { thirds: true }).jobs.some((j) => j.binned), true);
});

test("malformed input gets a message that says what to fix", () => {
  assert.match(analyse("").error, /no data/i);
  assert.match(analyse("   \n ").error, /no data/i);
  assert.match(analyse("a,b,c").error, /one line/i);
  assert.match(analyse("a,b\n1,2\n3,4").error, /at least three/);
  assert.match(analyse("just some words\nand more words").error, /1 column/);
  assert.match(analyse("PK\u0003\u0004\u0000\u0000binary").error, /CSV/);
  assert.match(analyse("a,b,c\n1\n2\n3\n4,5,6").error, /3 of 4 lines/);
  // A few ragged lines are tolerated and reported.
  const t = parseTable("a,b,c\n1,2,3\n4,5\n7,8,9,10\n1,2,3\n1,2,3\n1,2,3");
  assert.equal(t.n, 6);
  assert.match(t.warnings[0], /2 lines/);
  assert.equal(t.raw[2][1], "");
  // Repeated and blank column names are made unique.
  assert.deepEqual(parseTable("x,x,,x\n1,2,3,4").names, ["x", "x (2)", "column 3", "x (3)"]);
  // Semicolons and tabs work, with quoted cells.
  assert.deepEqual(parseTable('a;b;c\n"1;5";2;3').raw[0], ["1;5"]);
  assert.deepEqual(parseTable("a\tb\tc\n1\t2\t3").names, ["a", "b", "c"]);
  // A table with nothing to compare runs and finds nothing.
  const none = analyse("a,b,c\nq,w,e\nr,t,y\nu,i,o");
  assert.equal(none.error, undefined);
  assert.equal(none.comparisons.length, 0);
});

test("fifty thousand rows are searched, and rows past the limit are dropped with a warning", () => {
  const big = analyse(syntheticCsv(3, 50000));
  assert.equal(big.table.n, 50000);
  assert.equal(big.reversals.length, 2);
  close(big.comparisons[0].within.effect, -7 + 2.2 * 0.12 * 8.25 / (0.0144 * 8.25 + 1), 0.25);
  const lines = ["a,b,c"];
  for (let i = 0; i < LIMITS.rows + 10; i++) lines.push(`${i % 2},${i % 3},${i % 7}`);
  const t = parseTable(lines.join("\n"));
  assert.equal(t.n, LIMITS.rows);
  assert.match(t.warnings[0], /first 100,000/);
});
