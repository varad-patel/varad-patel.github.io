import test from "node:test";
import assert from "node:assert/strict";
import { DATA } from "./data.js";
import { ERAS, build, pagerank, ranking, positions, reach, chain, search, find, years, lifespan, editDistance, axisYear, axisYearLabel } from "./logic.js";

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
  assert.equal(years(-3, 30), "4 BC to AD 30");
  assert.equal(years(0, 1), "1 BC to AD 1");
  assert.equal(years(null, -42), "died 43 BC");
  assert.equal(years(null, null), "");
});

test("a date known only to the decade or the century is written as that span", () => {
  assert.equal(years(-424, -344, 8, 8), "420s to 340s BC");
  assert.equal(years(-534, -474, 9, 8), "535 to 470s BC");
  assert.equal(years(-550, -494, 7, 8), "6th century to 490s BC");
  assert.equal(years(-450, -450, 7, 7), "5th century BC");
  assert.equal(years(-4, 65, 8, 9), "first decade BC to AD 65");
  assert.equal(years(5, 65, 8, 9), "first decade AD to 65");
  assert.equal(years(129, 250, 9, 7), "129 to 3rd century");
  assert.equal(years(419, 437, 7, 9), "5th century to 437");
  assert.equal(years(1324, 1384, 8, 9), "1320s to 1384");
  assert.equal(years(1050, 1150, 7, 7), "11th century to 12th century");
  assert.equal(years(1950, null, 7), "born 20th century");
  assert.equal(years(null, 50, 9, 7), "died 1st century");
  assert.equal(years(150, 2150, 7, 7), "2nd century to 22nd century");
});

test("the time axis has no year 0, so round ticks are round years", () => {
  assert.equal(axisYear(-383), -384); // 384 BC
  assert.equal(axisYear(0), -1); // 1 BC
  assert.equal(axisYear(1), 1);
  assert.equal(axisYear(1724), 1724);
  assert.equal(axisYearLabel(axisYear(-383)), "384 BC");
  assert.equal(axisYearLabel(-500), "500 BC");
  assert.equal(axisYearLabel(0), "BC | AD");
  assert.equal(axisYearLabel(1500), "1500");
});

test("pagerank matches exact solutions of the linear system on two small graphs", () => {
  // Solved separately with exact fractions (Gaussian elimination on (I - dM) r = (1 - d)/n, d = 0.85).
  const five = pagerank(toy([[2, 0], [3, 0], [4, 0], [0, 1]], 5)).scores;
  [0.335935652, 0.380175065, 0.094629761, 0.094629761, 0.094629761].forEach((x, i) => close(five[i], x, 1e-8));
  const four = pagerank(toy([[1, 0], [2, 0], [2, 1], [3, 2], [0, 3]])).scores;
  [0.286897966, 0.155079982, 0.276658781, 0.281363271].forEach((x, i) => close(four[i], x, 1e-8));
});

test("tied scores share a position", () => {
  // 1, 2 and 3 were all influenced by 0 and by nobody else, so they have exactly the same score.
  const g = toy([[1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(positions(g, pagerank(g).scores), [1, 2, 2, 2]);
});

test("edit distance, by hand", () => {
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(editDistance("nietzche", "nietzsche"), 1);
  assert.equal(editDistance("same", "same"), 0);
  assert.ok(editDistance("plato", "aristotle", 2) > 2); // gives up early
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
  // Letters without a strippable accent, and the usual misspellings.
  assert.equal(g.name[search(g, "soren kierkegaard", order)[0]], "S\u00f8ren Kierkegaard");
  assert.equal(g.name[search(g, "Kolakowski", order)[0]], "Leszek Ko\u0142akowski");
  assert.equal(g.name[search(g, "ricoeur", order)[0]], "Paul Ric\u0153ur");
  assert.equal(g.name[search(g, "Nietzche", order)[0]], "Friedrich Nietzsche");
  assert.equal(g.name[search(g, "witgenstein", order)[0]], "Ludwig Wittgenstein");
  assert.equal(g.name[search(g, "Kirkegaard", order)[0]], "S\u00f8ren Kierkegaard");
  assert.deepEqual(search(g, "qqqqqqqq", order), []);
  assert.deepEqual(search(g, "xq", order), []); // too short to guess at
  assert.equal(find(g, "Soren Kierkegaard"), find(g, "S\u00f8ren Kierkegaard"));
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
  assert.equal(positions(g, scores)[h], 5);
  assert.equal(byCount.indexOf(h) + 1, 30);
  // "Joint 30th": 29 thinkers have more followers, and five others have exactly 13.
  assert.equal(g.influenced.filter((x) => x.length > 13).length, 29);
  assert.equal(g.influenced.filter((x) => x.length === 13).length, 6);
  for (const name of ["Plato", "Aristotle", "Georg Wilhelm Friedrich Hegel", "Friedrich Nietzsche"]) assert.ok(g.influenced[h].includes(find(g, name)), name);
  const socrates = reach(g, find(g, "Socrates")).size;
  assert.equal(socrates, 638);
  close(socrates / g.n, 0.49, 0.005);
  assert.deepEqual(chain(g, find(g, "Socrates"), find(g, "John Rawls")).map((i) => g.name[i]), ["Socrates", "Plato", "Immanuel Kant", "John Rawls"]);
});

test("the real graph: the other numbers quoted in the write-up", () => {
  const g = build(DATA);
  assert.equal(g.n, 1301);
  assert.equal(g.edges, 2582);
  assert.equal(g.influencers.filter((x) => x.length === 0).length, 481); // no recorded influences
  assert.equal(g.born.filter((y) => y == null).length, 9); // left off the chart
  const { scores, iterations } = pagerank(g);
  assert.ok(iterations > 120 && iterations < 140, `about 130 rounds, got ${iterations}`);
  // The top ten, as computed separately by solving the same equations in another language.
  assert.deepEqual(ranking(g, scores).slice(0, 10).map((i) => g.name[i]), ["Plato", "Aristotle", "Immanuel Kant", "Georg Wilhelm Friedrich Hegel", "Heraclitus",
    "Ren\u00e9 Descartes", "Benedictus de Spinoza", "Martin Heidegger", "Karl Marx", "Jean-Paul Sartre"]);
  close(scores[find(g, "Plato")], 0.01738, 5e-6);
  close(scores[find(g, "Heraclitus")], 0.0132, 5e-6);
  // Every damping on the slider converges; low damping puts the most-followed thinker first, high damping the ancients.
  const low = pagerank(g, { damping: 0.5 }), high = pagerank(g, { damping: 0.95 });
  assert.ok(high.iterations < 2000 && low.iterations < high.iterations);
  assert.equal(g.name[ranking(g, low.scores)[0]], "Immanuel Kant");
  assert.deepEqual(ranking(g, high.scores).slice(0, 3).map((i) => g.name[i]), ["Plato", "Aristotle", "Heraclitus"]);
  // Thinkers nobody is recorded as following all have the same score and the same position.
  const pos = positions(g, scores);
  const leaves = g.influenced.map((x, i) => (x.length ? -1 : i)).filter((i) => i >= 0);
  assert.equal(leaves.length, 527);
  assert.equal(new Set(leaves.map((i) => pos[i])).size, 1);
  assert.equal(pos[leaves[0]], g.n - 527 + 1);
  // People named in the limits.
  for (const name of ["Charles Darwin", "Johann Wolfgang von Goethe", "Fyodor Dostoyevsky", "George Berkeley"]) assert.ok(find(g, name) >= 0, name);
  assert.ok(g.influencers[find(g, "Karl Marx")].includes(find(g, "Georg Wilhelm Friedrich Hegel")));
  // Dates: Cicero was born on 3 January 106 BC in the Julian calendar, which is 31 December 107 BC in the Gregorian
  // one the query service answers in. Plato's preferred dates in Wikidata are decades.
  assert.equal(lifespan(g, find(g, "Cicero")), "106 to 43 BC");
  assert.equal(lifespan(g, find(g, "Plato")), "420s to 340s BC");
  assert.equal(lifespan(g, find(g, "Aristotle")), "384 to 322 BC");
  assert.equal(lifespan(g, find(g, "Seneca")), "first decade BC to AD 65");
  assert.equal(lifespan(g, find(g, "Immanuel Kant")), "1724 to 1804");
  assert.equal(lifespan(g, find(g, "George Berkeley")), "1685 to 1753");
  assert.equal(g.bornPrec.filter((p, i) => p < 9 || g.diedPrec[i] < 9).length, 36);
  assert.ok(g.born.every((b, i) => b == null || g.died[i] == null || b <= g.died[i]));
  assert.equal(DATA.retrieved, "2026-10-11");
  assert.ok(high.iterations > 380 && high.iterations < 430, `about 400 rounds at 0.95, got ${high.iterations}`);
  // "Who is missing": how often each word appears in the descriptions.
  const says = (word) => g.about.filter((a) => a.includes(word)).length;
  assert.deepEqual(["French", "American", "German", "Indian", "Chinese", "Japanese"].map(says), [243, 169, 157, 29, 19, 9]);
});
