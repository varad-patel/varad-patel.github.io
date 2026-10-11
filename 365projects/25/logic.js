// Day 25: Game of Life Emergence Meter. The model, with no DOM code.
//
// A grid is a Uint8Array of 0s and 1s in row order, w cells wide and h cells high, wrapped at the
// edges (a torus). All entropies are in bits.

import { rng } from "../kit/kit.js";

/* ------------------------------------------------------------------- the rule */

/** One generation of Conway's Life (born on 3 neighbours, survives on 2 or 3) from src into dst. Needs w, h >= 3. */
export function stepLife(src, dst, w, h) {
  for (let y = 0; y < h; y++) {
    const up = (y === 0 ? h - 1 : y - 1) * w;
    const row = y * w;
    const down = (y === h - 1 ? 0 : y + 1) * w;
    for (let x = 0; x < w; x++) {
      const l = x === 0 ? w - 1 : x - 1;
      const r = x === w - 1 ? 0 : x + 1;
      const n = src[up + l] + src[up + x] + src[up + r] + src[row + l] + src[row + r] + src[down + l] + src[down + x] + src[down + r];
      dst[row + x] = n === 3 || (n === 2 && src[row + x] === 1) ? 1 : 0;
    }
  }
  return dst;
}

/** The comparison process: every cell is redrawn independently, alive with probability `density`. */
export function stepNoise(dst, density, random) {
  for (let i = 0; i < dst.length; i++) dst[i] = random() < density ? 1 : 0;
  return dst;
}

export const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
export const population = (cells) => { let n = 0; for (let i = 0; i < cells.length; i++) n += cells[i]; return n; };

/* ------------------------------------------------------------------- patterns */

const rows = (text) => text.trim().split("\n").map((r) => r.trim());

/** Plain-text patterns: O is a live cell. */
export const PATTERNS = [
  { key: "glider", label: "Glider", note: "Five cells that rebuild themselves one square along the diagonal every four generations.", rows: rows(`
    .O.
    ..O
    OOO`) },
  { key: "lwss", label: "Lightweight spaceship", note: "Nine cells that travel two squares sideways every four generations.", rows: rows(`
    .O..O
    O....
    O...O
    OOOO.`) },
  { key: "rpentomino", label: "R-pentomino", note: "Five cells that take 1,103 generations to settle on an unbounded plane, leaving 116. On this wrapped grid its debris and gliders come round and collide, so it ends differently: at generation 1,123 with 142 cells on 96 by 64.", rows: rows(`
    .OO
    OO.
    .O.`) },
  { key: "gun", label: "Gosper glider gun", note: "Thirty-six cells that fire a glider every 30 generations. On a wrapped grid the gliders come round and hit the gun: on 96 by 64, by generation 780.", rows: rows(`
    ........................O...........
    ......................O.O...........
    ............OO......OO............OO
    ...........O...O....OO............OO
    OO........O.....O...OO..............
    OO........O...O.OO....O.O...........
    ..........O.....O.......O...........
    ...........O...O....................
    ............OO......................`) },
];

/** Write a pattern into a grid with its top-left corner at (ox, oy), wrapping at the edges. */
export function place(cells, w, h, pattern, ox, oy) {
  pattern.rows.forEach((line, dy) => {
    for (let dx = 0; dx < line.length; dx++) if (line[dx] === "O") cells[((oy + dy) % h + h) % h * w + ((ox + dx) % w + w) % w] = 1;
  });
  return cells;
}

/** A fresh grid holding one named pattern: centred, except the gun, which sits near the top so its gliders have room. */
export function patternGrid(key, w, h) {
  const pattern = PATTERNS.find((p) => p.key === key);
  const cells = new Uint8Array(w * h);
  if (!pattern) return cells;
  const pw = Math.max(...pattern.rows.map((r) => r.length));
  const ph = pattern.rows.length;
  const ox = Math.max(0, Math.floor((w - pw) / 2));
  const oy = key === "gun" ? Math.min(3, Math.max(0, h - ph)) : Math.max(0, Math.floor((h - ph) / 2));
  return place(cells, w, h, pattern, ox, oy);
}

/** A random soup: each cell alive with probability `density`, reproducible from the seed. */
export function randomGrid(w, h, density, seed) {
  return stepNoise(new Uint8Array(w * h), density, rng(seed));
}

/** The same live cells dealt out to random positions: density is kept, arrangement is destroyed. */
export function shuffled(cells, seed) {
  const out = Uint8Array.from(cells);
  const r = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/* --------------------------------------------------------------------- meters */

/** Entropy of a coin that lands heads with probability p. */
export function binaryEntropy(p) {
  if (!(p > 0 && p < 1)) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

/**
 * How often each of the 16 possible 2x2 blocks occurs, taking every cell once as the top-left corner
 * (so blocks overlap and wrap). The index is topLeft + 2 topRight + 4 bottomLeft + 8 bottomRight.
 * With `other`, the blocks are read from the change map: cells that differ between the two grids.
 */
export function blockCounts(cells, w, h, other = null) {
  const counts = new Uint32Array(16);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const down = (y === h - 1 ? 0 : y + 1) * w;
    for (let x = 0; x < w; x++) {
      const r = x === w - 1 ? 0 : x + 1;
      const a = row + x, b = row + r, c = down + x, d = down + r;
      counts[other
        ? (cells[a] ^ other[a]) | ((cells[b] ^ other[b]) << 1) | ((cells[c] ^ other[c]) << 2) | ((cells[d] ^ other[d]) << 3)
        : cells[a] | (cells[b] << 1) | (cells[c] << 2) | (cells[d] << 3)]++;
    }
  }
  return counts;
}

/** Shannon entropy of a table of counts. */
export function entropyOfCounts(counts) {
  let total = 0;
  for (const c of counts) total += c;
  if (!total) return 0;
  let bitsSum = 0;
  for (const c of counts) if (c > 0) bitsSum -= (c / total) * Math.log2(c / total);
  return bitsSum;
}

/**
 * Every meter for one grid. `prev` is the grid one generation earlier and `older` the grid two
 * generations earlier; pass null where there is none.
 *
 *   density     share of cells alive
 *   h1          entropy per cell if cells were independent with this density: binaryEntropy(density)
 *   h2          entropy of the observed 2x2 blocks, divided by 4 to give bits per cell
 *   structure   h1 - h2: bits per cell of the pattern that are accounted for by its neighbours (never negative)
 *   activity    share of cells that changed since prev
 *   novelty     share of cells that differ from older (zero for still lifes and for period-2 oscillators)
 *   complexity  the same gap measured on the novelty map: binaryEntropy(novelty) - blockEntropy(novelty map) / 4
 */
export function measure(cells, w, h, prev = null, older = null) {
  const n = w * h;
  const live = population(cells);
  const density = live / n;
  const h1 = binaryEntropy(density);
  const h2 = entropyOfCounts(blockCounts(cells, w, h)) / 4;
  const out = { n, live, density, h1, h2, structure: Math.max(0, h1 - h2), activity: null, novelty: null, complexity: null };
  const differing = (other) => { let k = 0; for (let i = 0; i < n; i++) k += cells[i] ^ other[i]; return k / n; };
  if (prev) out.activity = differing(prev);
  if (older) {
    out.novelty = differing(older);
    out.complexity = Math.max(0, binaryEntropy(out.novelty) - entropyOfCounts(blockCounts(cells, w, h, older)) / 4);
  }
  return out;
}

/**
 * Run Life from a starting grid and return the meters for every generation, 0 to `generations`.
 * Stops early once the grid equals the grid two generations before (a still life or a period-2 cycle),
 * with `settledAt` set to the generation at which that first happens.
 */
export function run(start, w, h, generations) {
  let cur = Uint8Array.from(start), prev = new Uint8Array(w * h), older = new Uint8Array(w * h);
  const series = [measure(cur, w, h)];
  let settledAt = null;
  for (let g = 1; g <= generations; g++) {
    const next = stepLife(cur, older, w, h);
    older = prev; prev = cur; cur = next;
    series.push(measure(cur, w, h, prev, g >= 2 ? older : null));
    if (g >= 2 && same(cur, older)) { settledAt = g; break; }
  }
  return { series, settledAt, final: cur };
}
