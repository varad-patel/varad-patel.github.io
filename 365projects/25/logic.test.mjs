import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  PATTERNS, stepLife, stepNoise, same, population, place, patternGrid, randomGrid, shuffled,
  binaryEntropy, blockCounts, entropyOfCounts, measure, run,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const grid = (w, h, live) => { const g = new Uint8Array(w * h); for (const [x, y] of live) g[y * w + x] = 1; return g; };
const advance = (cells, w, h, n) => { let a = Uint8Array.from(cells), b = new Uint8Array(w * h); for (let i = 0; i < n; i++) { stepLife(a, b, w, h); [a, b] = [b, a]; } return a; };
const shifted = (cells, w, h, dx, dy) => { const out = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cells[y * w + x]) out[((y + dy + h) % h) * w + ((x + dx + w) % w)] = 1; return out; };
const pattern = (key) => PATTERNS.find((p) => p.key === key);

test("the rule: a block is still, a blinker has period 2, a lone cell dies, three in a corner make a block", () => {
  const block = grid(8, 8, [[3, 3], [4, 3], [3, 4], [4, 4]]);
  assert.ok(same(advance(block, 8, 8, 1), block));
  const blinker = grid(8, 8, [[2, 3], [3, 3], [4, 3]]);
  const upright = grid(8, 8, [[3, 2], [3, 3], [3, 4]]);
  assert.ok(same(advance(blinker, 8, 8, 1), upright));
  assert.ok(same(advance(blinker, 8, 8, 2), blinker));
  assert.equal(population(advance(grid(8, 8, [[3, 3]]), 8, 8, 1)), 0);
  assert.ok(same(advance(grid(8, 8, [[3, 3], [4, 3], [3, 4]]), 8, 8, 1), block));
  // Overcrowding: the centre of a plus sign has four neighbours and dies.
  assert.equal(advance(grid(8, 8, [[3, 3], [2, 3], [4, 3], [3, 2], [3, 4]]), 8, 8, 1)[3 * 8 + 3], 0);
});

test("the grid wraps: a blinker across the edge behaves like any other", () => {
  const across = grid(8, 8, [[7, 0], [0, 0], [1, 0]]);
  const next = advance(across, 8, 8, 1);
  assert.deepEqual([next[7 * 8 + 0], next[0], next[8]], [1, 1, 1], "upright through the top edge");
  assert.ok(same(advance(across, 8, 8, 2), across));
});

test("a glider moves one cell diagonally every 4 generations and comes back round the torus", () => {
  const start = patternGrid("glider", 20, 20);
  assert.equal(population(start), 5);
  assert.ok(same(advance(start, 20, 20, 4), shifted(start, 20, 20, 1, 1)));
  assert.ok(same(advance(start, 20, 20, 80), start), "20 cells along the diagonal is a full lap");
});

test("the lightweight spaceship moves two cells every 4 generations", () => {
  const start = patternGrid("lwss", 30, 20);
  assert.equal(population(start), 9);
  const later = advance(start, 30, 20, 4);
  assert.ok(same(later, shifted(start, 30, 20, 2, 0)) || same(later, shifted(start, 30, 20, -2, 0)));
});

test("the Gosper gun has 36 cells and adds one glider (5 cells) every 30 generations", () => {
  assert.equal(pattern("gun").rows.length, 9);
  assert.ok(pattern("gun").rows.every((r) => r.length === 36));
  const start = patternGrid("gun", 120, 100);
  assert.equal(population(start), 36);
  // The gun itself repeats with period 30; each period leaves one more glider in flight.
  for (const [gen, cells] of [[30, 41], [60, 46], [90, 51], [120, 56]]) assert.equal(population(advance(start, 120, 100, gen)), cells, `generation ${gen}`);
});

test("the R-pentomino settles after 1,103 generations with 116 cells when it has room", () => {
  // On a 512 x 512 torus the six escaping gliders cannot get back to the debris in this time.
  const w = 512, h = 512;
  let cells = patternGrid("rpentomino", w, h);
  assert.equal(population(cells), 5);
  cells = advance(cells, w, h, 1000);
  const before = population(cells);
  cells = advance(cells, w, h, 103);
  assert.equal(population(cells), 116);
  assert.notEqual(before, 116, "it was still changing at generation 1,000");
  // From here everything is still lifes, blinkers and gliders in flight: the count no longer changes.
  for (let i = 0; i < 4; i++) { cells = advance(cells, w, h, 15); assert.equal(population(cells), 116); }
});

test("binary entropy and the entropy of counts, by hand", () => {
  assert.equal(binaryEntropy(0), 0);
  assert.equal(binaryEntropy(1), 0);
  assert.equal(binaryEntropy(0.5), 1);
  close(binaryEntropy(0.25), 2 - 0.75 * Math.log2(3)); // 0.811278...
  close(binaryEntropy(0.25), 0.8112781244591328, 1e-12);
  assert.equal(binaryEntropy(NaN), 0);
  assert.equal(entropyOfCounts([4, 4, 4, 4]), 2);
  assert.equal(entropyOfCounts([7, 0, 0]), 0);
  assert.equal(entropyOfCounts([0, 0]), 0);
  close(entropyOfCounts([3, 1]), 0.8112781244591328, 1e-12);
});

test("2x2 block counts by hand: one live cell on a 4 x 4 torus", () => {
  const one = grid(4, 4, [[1, 1]]);
  const counts = blockCounts(one, 4, 4);
  // The cell is the top-left of one block, the top-right of one, the bottom-left of one and the bottom-right of one.
  assert.deepEqual([...counts], [12, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  const m = measure(one, 4, 4);
  const h4 = -(0.75 * Math.log2(0.75) + 4 * (1 / 16) * Math.log2(1 / 16)); // 1.31128 bits per block
  close(m.density, 1 / 16);
  close(m.h1, binaryEntropy(1 / 16));
  close(m.h2, h4 / 4);
  close(m.structure, binaryEntropy(1 / 16) - h4 / 4); // 0.33729 - 0.32782 = 0.00947
  close(m.structure, 0.00947, 5e-6);
  assert.equal(m.activity, null);
  assert.equal(m.complexity, null);
});

test("the extremes: empty and full grids read zero, a checkerboard is all structure", () => {
  for (const fill of [0, 1]) {
    const m = measure(new Uint8Array(64).fill(fill), 8, 8, new Uint8Array(64).fill(fill), new Uint8Array(64).fill(fill));
    assert.deepEqual([m.h1, m.h2, m.structure, m.activity, m.novelty, m.complexity], [0, 0, 0, 0, 0, 0]);
  }
  const board = new Uint8Array(64).map((_, i) => ((i % 8) + Math.floor(i / 8)) % 2);
  const m = measure(board, 8, 8);
  assert.equal(m.h1, 1);
  close(m.h2, 0.25); // only two of the sixteen blocks ever occur
  close(m.structure, 0.75);
});

test("activity and complexity by hand: one cell differs", () => {
  const before = new Uint8Array(16);
  const after = grid(4, 4, [[2, 2]]);
  const m = measure(after, 4, 4, before, before);
  close(m.activity, 1 / 16);
  close(m.novelty, 1 / 16);
  // The novelty map is a single cell, so its numbers are those of the one-cell grid above.
  close(m.complexity, 0.00947, 5e-6);
  // Against itself there is nothing new.
  const still = measure(after, 4, 4, after, after);
  assert.deepEqual([still.activity, still.novelty, still.complexity], [0, 0, 0]);
});

test("structure is never negative, and shuffling the cells removes it", () => {
  const r = rng(3);
  for (let trial = 0; trial < 50; trial++) {
    const w = r.int(3, 30), h = r.int(3, 30);
    const cells = randomGrid(w, h, r(), r.int(1, 1e6));
    const m = measure(advance(cells, w, h, r.int(0, 5)), w, h);
    assert.ok(m.structure >= 0 && m.h2 <= m.h1 + 1e-12);
  }
  const after = run(randomGrid(96, 64, 0.5, 25), 96, 64, 100).final;
  const mixed = shuffled(after, 1);
  assert.equal(population(mixed), population(after));
  assert.ok(measure(after, 96, 64).structure > 0.04);
  assert.ok(measure(mixed, 96, 64).structure < 0.002);
  assert.ok(same(shuffled(after, 1), mixed), "the same seed gives the same shuffle");
});

/** Run noise for `generations` and report the meters: their means, the highest reading of either, and how often either reaches 0.002. */
function noiseReadings(w, h, density, generations, seed = 7) {
  const r = rng(seed);
  let older = stepNoise(new Uint8Array(w * h), density, r), prev = stepNoise(new Uint8Array(w * h), density, r);
  const out = { structure: 0, complexity: 0, highest: 0, atLeast002: 0 };
  const tol = 3 / Math.sqrt(w * h); // six standard deviations of the share of heads in w x h fair coins
  for (let i = 0; i < generations; i++) {
    const cur = stepNoise(new Uint8Array(w * h), density, r);
    const m = measure(cur, w, h, prev, older);
    assert.ok(Math.abs(m.density - density) < tol);
    close(m.activity, 2 * density * (1 - density), tol);
    out.structure += m.structure / generations;
    out.complexity += m.complexity / generations;
    out.highest = Math.max(out.highest, m.structure, m.complexity);
    if (m.structure >= 0.002 || m.complexity >= 0.002) out.atLeast002 += 1 / generations;
    older = prev; prev = cur;
  }
  return out;
}

test("pure noise on 96 x 64 stays below 0.002 on both meters: 8,000 generations at four densities", () => {
  for (const density of [0.05, 0.2, 0.5, 0.8]) {
    const n = noiseReadings(96, 64, density, 2000);
    assert.ok(n.highest < 0.002, `highest reading ${n.highest} at density ${density}`);
    // The floor is a bias of the estimate, about 2 / (number of cells): 0.0003 here.
    close(n.structure, 2 / 6144, 0.0001);
    close(n.complexity, 2 / 6144, 0.0001);
  }
});

test("the noise floor is higher on a smaller grid: about 0.0013 on 48 x 32, where one generation in four reads 0.002 or more", () => {
  const n = noiseReadings(48, 32, 0.5, 2000);
  close(n.structure, 0.0013, 0.0002);
  close(n.complexity, 0.0013, 0.0002);
  assert.ok(n.atLeast002 > 0.18 && n.atLeast002 < 0.32, `share ${n.atLeast002}`);
  assert.ok(n.highest > 0.003 && n.highest < 0.01);
});

test("frozen and blinking order has structure but no complexity; a glider has both", () => {
  const w = 96, h = 64;
  // One horizontal blinker in every 4 x 4 square. By hand: 3 cells in 16 are alive, and of the 16 blocks in a square
  // 8 are empty, two patterns with a full row occur twice each, and four patterns with one cell occur once each:
  // H4 = (1/2) 1 + 2 (1/8) 3 + 4 (1/16) 4 = 2.25 bits.
  const blinkers = new Uint8Array(w * h);
  for (let y = 1; y < h; y += 4) for (let x = 0; x < w; x += 4) blinkers[y * w + x] = blinkers[y * w + x + 1] = blinkers[y * w + x + 2] = 1;
  const b1 = advance(blinkers, w, h, 1), b2 = advance(blinkers, w, h, 2);
  assert.ok(same(b2, blinkers) && !same(b1, blinkers));
  const m = measure(b2, w, h, b1, blinkers);
  close(m.h1, binaryEntropy(3 / 16));
  close(m.h2, 2.25 / 4);
  close(m.structure, binaryEntropy(3 / 16) - 0.5625); // 0.6962 - 0.5625 = 0.1337
  assert.equal(m.structure.toFixed(3), "0.134");
  close(m.activity, 0.25, 1e-12); // every blinker flips four cells of its sixteen
  assert.equal(m.complexity, 0);
  // One glider on 6,144 cells: organised, but there is very little of it. Its complexity depends on its phase.
  const glider = run(patternGrid("glider", w, h), w, h, 100);
  assert.equal(glider.settledAt, null, "a glider never repeats within two generations");
  assert.deepEqual([glider.series[100].structure.toFixed(3), glider.series[100].complexity.toFixed(3)], ["0.002", "0.001"]);
  const phases = glider.series.slice(2).map((s) => s.complexity);
  assert.deepEqual([Math.min(...phases).toFixed(3), Math.max(...phases).toFixed(3)], ["0.001", "0.003"]);
  // The same glider on a grid with a quarter of the cells reads about three times higher, not four: entropy is not linear in density.
  const smallGlider = run(patternGrid("glider", 48, 32), 48, 32, 100).series[100];
  close(smallGlider.structure / glider.series[100].structure, 3.1, 0.2);
});

test("structure cannot exceed 0.75: a checkerboard and plain stripes both reach it", () => {
  const w = 96, h = 64;
  const board = new Uint8Array(w * h).map((_, i) => ((i % w) + Math.floor(i / w)) % 2);
  const stripes = new Uint8Array(w * h).map((_, i) => Math.floor(i / w) % 2);
  close(measure(board, w, h).structure, 0.75);
  close(measure(stripes, w, h).structure, 0.75);
  // h2 is never less than a quarter of h1, whatever the grid.
  const r = rng(11);
  for (let trial = 0; trial < 40; trial++) {
    const m = measure(advance(randomGrid(24, 20, r(), r.int(1, 1e6)), 24, 20, r.int(0, 8)), 24, 20);
    assert.ok(m.structure <= 0.75 * m.h1 + 1e-12);
  }
});

test("complexity cannot tell repetition from novelty: a pulsar (period 3) reads above zero for ever", () => {
  const w = 96, h = 64;
  const pulsar = { rows: ["..OOO...OOO..", ".............", "O....O.O....O", "O....O.O....O", "O....O.O....O", "..OOO...OOO..", ".............", "..OOO...OOO..", "O....O.O....O", "O....O.O....O", "O....O.O....O", ".............", "..OOO...OOO.."] };
  const start = place(new Uint8Array(w * h), w, h, pulsar, 40, 25);
  assert.equal(population(start), 48);
  assert.ok(same(advance(start, w, h, 3), start) && !same(advance(start, w, h, 1), start) && !same(advance(start, w, h, 2), start));
  const { series, settledAt } = run(start, w, h, 300);
  assert.equal(settledAt, null);
  const c = series.slice(2).map((s) => s.complexity), s = series.map((x) => x.structure);
  assert.deepEqual([Math.min(...c).toFixed(3), Math.max(...c).toFixed(3)], ["0.002", "0.014"]);
  assert.deepEqual([Math.min(...s).toFixed(3), Math.max(...s).toFixed(3)], ["0.014", "0.028"]);
});

test("the wrapped grid changes what the gun and the R-pentomino do", () => {
  const w = 96, h = 64;
  // The gun adds a glider every 30 generations until its gliders come round: on course at 750, hit by 780.
  const gun = patternGrid("gun", w, h);
  assert.equal(population(advance(gun, w, h, 750)), 36 + 5 * 25);
  assert.notEqual(population(advance(gun, w, h, 780)), 36 + 5 * 26);
  // The R-pentomino settles at 1,103 with 116 cells when it has room (tested above); here it takes 1,123 and leaves 142.
  const r = run(patternGrid("rpentomino", w, h), w, h, 3000);
  assert.deepEqual([r.settledAt, population(r.final)], [1123, 142]);
});

test("random grids are reproducible and have the density asked for", () => {
  assert.ok(same(randomGrid(40, 30, 0.3, 9), randomGrid(40, 30, 0.3, 9)));
  assert.ok(!same(randomGrid(40, 30, 0.3, 9), randomGrid(40, 30, 0.3, 10)));
  assert.ok(Math.abs(population(randomGrid(200, 200, 0.3, 9)) / 40000 - 0.3) < 0.01);
  assert.equal(population(randomGrid(10, 10, 0, 1)), 0);
  assert.equal(population(randomGrid(10, 10, 1, 1)), 100);
});

test("patterns are placed inside the grid, wrap when they must, and unknown names give an empty grid", () => {
  for (const p of PATTERNS) {
    const cells = patternGrid(p.key, 48, 32);
    assert.equal(population(cells), p.rows.join("").split("O").length - 1, p.key);
  }
  assert.equal(population(patternGrid("nope", 10, 10)), 0);
  const wrapped = place(new Uint8Array(25), 5, 5, pattern("glider"), 4, 4);
  assert.equal(population(wrapped), 5);
  assert.deepEqual([wrapped[4 * 5 + 0], wrapped[0 * 5 + 1], wrapped[1 * 5 + 4], wrapped[1 * 5 + 0], wrapped[1 * 5 + 1]], [1, 1, 1, 1, 1], "each row and column carries over the edge");
});

test("the finding: a 96 x 64 soup from seed 25", () => {
  const { series, settledAt, final } = run(randomGrid(96, 64, 0.5, 25), 96, 64, 5000);
  const round = (x) => Number(x.toFixed(3));
  // Generation 0 is noise: a full bit per cell and no structure.
  assert.equal(round(series[0].h1), 1);
  assert.equal(round(series[0].structure), 0);
  // One generation of the rule is enough to create structure.
  assert.equal(round(series[1].density), 0.264);
  assert.equal(round(series[1].structure), 0.015);
  const peak = (key) => series.reduce((best, m, g) => ((m[key] ?? 0) > best.value ? { value: m[key], g } : best), { value: 0, g: 0 });
  assert.deepEqual([round(peak("structure").value), peak("structure").g], [0.07, 48]);
  assert.deepEqual([round(series[100].structure), round(series[100].complexity)], [0.055, 0.061]);
  assert.deepEqual([round(peak("complexity").value), peak("complexity").g], [0.079, 160]);
  // It settles into still lifes and blinkers: structure remains, complexity is exactly zero, some cells still flip.
  assert.equal(settledAt, 1770);
  const last = series[settledAt];
  assert.equal(last.live, 157);
  assert.equal(round(last.structure), 0.03);
  assert.equal(last.complexity, 0);
  assert.equal(round(last.activity), 0.009);
  assert.ok(series.slice(2, settledAt).every((m) => m.complexity > 0), "complexity is positive for the whole transient");
  assert.ok(same(advance(final, 96, 64, 2), final));
  // The grid a phone starts on: the same seed and density on 48 x 32.
  const phone = run(randomGrid(48, 32, 0.5, 25), 48, 32, 5000);
  assert.deepEqual([phone.settledAt, population(phone.final)], [188, 60]);
});
