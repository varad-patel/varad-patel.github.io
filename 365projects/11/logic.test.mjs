import test from "node:test";
import assert from "node:assert/strict";
import { DATA } from "./data.js";
import { ERAS, build, pagerank, ranking, positions, reach, chain, search, find, years } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const sum = (a) => Array.from(a).reduce((s, v) => s + v, 0);

// people: [name, born, died, sitelinks, about, id]; edges: [influenced, influencer]
const toy = (edges, n = 4) => build({ people: Array.from({ length: n }, (_, i) => [`P${i}`, 1000 + 100 * i, 1050 + 100 * i, 1, "", `Q${i}`]), edges });

test("build makes both adjacency lists", () => {
  const g = toy([[1, 0], [2, 0], [2, 1]]);
  assert.deepEqual(g.influencers, [[], [0], [0, 1], []]);
  assert.deepEqual(g.influenced, [[1, 2], [2], [], []]);
  assert.equal(g.edges, 3);
});

test("pagerank: scores sum to one and a ring is uniform", () => {
  const ring = toy([[0, 1], [1, 2], [2, 3], [3, 0]]);
  const { scores } = pagerank(ring);
  close(sum(scores), 1, 1e-9);
  scores.forEach((s) => close(s, 0.25, 1e-9));
});

test("pagerank matches a hand-solved three-node case", () => {
  // 1 and 2 were both influenced by 0; 0 has no recorded influences (dangling). Damping d = 0.85.
  // By symmetry r1 = r2 = x and r0 = y, with y + 2x = 1:
  //   x = (1 - d)/3 + d*y/3          (only the dangling share reaches 1 and 2)
  //   y = (1 - d)/3 + d*y/3 + 2*d*x
  const d = 0.85;
  const g = toy([[1, 0], [2, 0]], 3);
  const { scores } = pagerank(g, { damping: d });
  // Subtracting the two equations gives y = x (1 + 2d); with y + 2x = 1 that is x = 1 / (3 + 2d).
  const x = 1 / (3 + 2 * d);
  close(scores[1], x, 1e-9);
  close(scores[2], x, 1e-9);
  close(scores[0], (1 + 2 * d) / (3 + 2 * d), 1e-9);
  close(sum(scores), 1, 1e-9);
});

test("pagerank rewards being followed by the well-followed, not just the number of followers", () => {
  // A (0) has three minor followers (2, 3, 4). B (1) has one follower, A itself.
  const g = toy([[2, 0], [3, 0], [4, 0], [0, 1]], 5);
  const { scores } = pagerank(g);
  assert.equal(g.influenced[0].length, 3);
  assert.equal(g.influenced[1].length, 1);
  assert.ok(scores[1] > scores[0], "the one who influenced the influential ranks first");
  assert.deepEqual(ranking(g, scores).slice(0, 2), [1, 0]);
  assert.deepEqual(positions(g, scores).slice(0, 2), [2, 1]);
});

test("damping 0 gives everyone the same score", () => {
  const { scores } = pagerank(toy([[1, 0], [2, 0], [3, 2]]), { damping: 0 });
  scores.forEach((s) => close(s, 0.25, 1e-12));
});

test("reach and chain follow influence downstream", () => {
  const g = toy([[1, 0], [2, 1], [3, 2]]);
  assert.deepEqual([...reach(g, 0)].sort(), [1, 2, 3]);
  assert.deepEqual([...reach(g, 3)], []);
  assert.deepEqual([...reach(g, 3, "influencers")].sort(), [0, 1, 2]);
  assert.deepEqual(chain(g, 0, 3), [0, 1, 2, 3]);
  assert.equal(chain(g, 3, 0), null);
  assert.deepEqual(chain(g, 2, 2), [2]);
  // A shortcut makes the chain shorter.
  assert.deepEqual(chain(toy([[1, 0], [2, 1], [3, 2], [3, 0]]), 0, 3), [0, 3]);
});

test("eras filter by year of birth and skip unknown years", () => {
  const g = build({ people: [["Old", -400, -350, 1, "", "Q1"], ["Mid", 1200, 1270, 1, "", "Q2"], ["New", 1950, null, 1, "", "Q3"], ["Unknown", null, null, 1, "", "Q4"]], edges: [] });
  const { scores } = pagerank(g);
  assert.deepEqual(ranking(g, scores, "ancient").map((i) => g.name[i]), ["Old"]);
  assert.deepEqual(ranking(g, scores, "medieval").map((i) => g.name[i]), ["Mid"]);
  assert.deepEqual(ranking(g, scores, "c20").map((i) => g.name[i]), ["New"]);
  assert.equal(ranking(g, scores, "all").length, 4);
  assert.equal(ERAS.length, 6);
});

test("years are written the way historians write them", () => {
  assert.equal(years(-383, -321), "384 to 322 BC");
  assert.equal(years(1724, 1804), "1724 to 1804");
  assert.equal(years(1947, null), "born 1947");
  assert.equal(years(null, 437), "died 437");
  assert.equal(years(-3, 30), "4 BC to 30");
  assert.equal(years(null, null), "");
});

test("the real graph: size, search and lookups", () => {
  const g = build(DATA);
  assert.equal(g.n, DATA.people.length);
  assert.ok(g.n > 1200 && g.edges > 2500);
  assert.ok(DATA.edges.every(([a, b]) => a !== b && a >= 0 && b >= 0 && a < g.n && b < g.n));
  assert.equal(new Set(g.name).size, g.n, "names are unique, so they can be used to pick a thinker");
  // No one is recorded as influenced by a person born after their own death.
  assert.ok(DATA.edges.every(([a, b]) => g.died[a] == null || g.born[b] == null || g.born[b] < g.died[a]));
  const { scores } = pagerank(g);
  const order = ranking(g, scores);
  assert.equal(g.name[search(g, "kant", order)[0]], "Immanuel Kant");
  assert.equal(g.name[search(g, "aris", order)[0]], "Aristotle");
  assert.equal(g.name[search(g, "descartes", order)[0]], "René Descartes");
  assert.deepEqual(search(g, "   ", order), []);
  assert.equal(find(g, "rene descartes"), find(g, "René Descartes"));
  assert.equal(find(g, "Nobody At All"), -1);
});

test("the real graph: the finding on the page", () => {
  const g = build(DATA);
  const { scores, iterations } = pagerank(g);
  close(sum(scores), 1, 1e-9);
  assert.ok(iterations < 200, "power iteration converged");
  const order = ranking(g, scores);
  const byCount = [...order].sort((a, b) => g.influenced[b].length - g.influenced[a].length);
  assert.equal(g.name[byCount[0]], "Immanuel Kant");
  assert.equal(g.influenced[byCount[0]].length, 79);
  assert.equal(g.name[order[0]], "Plato");
  const h = find(g, "Heraclitus");
  assert.equal(g.influenced[h].length, 13);
  assert.equal(order.indexOf(h) + 1, 5);
  assert.equal(byCount.indexOf(h) + 1, 30);
  for (const name of ["Plato", "Aristotle", "Georg Wilhelm Friedrich Hegel", "Friedrich Nietzsche"]) assert.ok(g.influenced[h].includes(find(g, name)), name);
  const socrates = reach(g, find(g, "Socrates")).size;
  assert.equal(socrates, 638);
  close(socrates / g.n, 0.49, 0.005);
  assert.deepEqual(chain(g, find(g, "Socrates"), find(g, "John Rawls")).map((i) => g.name[i]), ["Socrates", "Plato", "Immanuel Kant", "John Rawls"]);
});
