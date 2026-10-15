import test from "node:test";
import assert from "node:assert/strict";
import { rng, stats } from "../kit/kit.js";
import { TSX } from "./data.js";
import { MA_MONTHS, VOL_MONTHS, monthOf, indexOf, band, movingAverage, signals, trailingPercentile, buildIndex, bandShares, forward, neweyWest, oosTest, byBand, overlap } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const sig = signals(TSX);
const at = (m) => indexOf(sig.start, m);

test("months count from the first one, both ways", () => {
  assert.equal(monthOf("1956-01", 0), "1956-01");
  assert.equal(monthOf("1956-01", 812), "2023-09");
  assert.equal(monthOf("1999-12", 1), "2000-01");
  assert.equal(indexOf("1956-01", "2023-09"), 812);
  assert.equal(sig.n, 813);
});

test("bands: each edge goes to the band nearer the middle", () => {
  assert.equal(band(0).label, "Extreme fear");
  assert.equal(band(19.999).label, "Extreme fear");
  assert.equal(band(20).label, "Fear");
  assert.equal(band(40).label, "Neutral");
  assert.equal(band(60).label, "Neutral");
  assert.equal(band(60.001).label, "Greed");
  assert.equal(band(80).label, "Greed");
  assert.equal(band(80.001).label, "Extreme greed");
  assert.equal(band(100).label, "Extreme greed");
  assert.equal(band(NaN), null);
});

test("moving average and trailing percentile by hand", () => {
  assert.deepEqual(movingAverage([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  // Window of 3: at i = 2 the values are 1, 3, 2, so 2 has one value below it: 1 of 2 others, 50.
  // At i = 3 the values are 3, 2, 2: none below, one tie counted as half: 0.5 of 2, 25.
  assert.deepEqual(trailingPercentile([1, 3, 2, 2], 3), [null, null, 50, 25]);
  assert.deepEqual(trailingPercentile([5, 4, 3], 3), [null, null, 0]);
  assert.deepEqual(trailingPercentile([3, 4, 5], 3), [null, null, 100]);
  // Never uses a later value.
  const a = trailingPercentile([1, 2, 3, 4, 5], 3), b = trailingPercentile([1, 2, 3, 4, -99], 3);
  assert.deepEqual(a.slice(0, 4), b.slice(0, 4));
});

test("the three raw signals, worked out separately for September 2023", () => {
  const i = at("2023-09");
  const P = TSX.composite.values;
  const ma = P.slice(i - MA_MONTHS + 1, i + 1).reduce((s, v) => s + v, 0) / MA_MONTHS;
  close(sig.momentum[i], P[i] / ma - 1, 1e-12);
  const r = [];
  for (let k = i - VOL_MONTHS + 1; k <= i; k++) r.push(Math.log(P[k] / P[k - 1]));
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  close(sig.volatility[i], Math.sqrt((r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1)) * 12), 1e-12);
  const j = indexOf(TSX.new.start, "2023-09");
  const up = TSX.new.sectors.filter((s) => s.values[j] > s.values.slice(j - 9, j + 1).reduce((a, b) => a + b, 0) / 10).length;
  close(sig.breadth[i], up / 10, 1e-12);
  assert.equal(sig.above[i].set, "new");
  assert.equal(sig.above[at("1999-12")].set, "old");
  assert.equal(sig.above[at("1999-12")].of, 7);
});

test("the data against Statistics Canada's own figures", () => {
  assert.equal(TSX.composite.values[0], 525.63);          // January 1956
  assert.equal(TSX.composite.values[at("2008-10")], 9762.76);
  assert.equal(TSX.composite.values.at(-1), 19541.27);   // September 2023
  assert.equal(TSX.old.sectors.length, 7);
  assert.equal(TSX.new.sectors.length, 10);
  assert.equal(TSX.new.sectors.find((s) => s.id === "energy").values[indexOf(TSX.new.start, "2020-03")], 60.12);
});

test("weights: zero everywhere is refused, one component alone is that component, equal weights are the mean", () => {
  assert.match(buildIndex(sig, { weights: { momentum: 0, volatility: 0, breadth: 0 } }).error, /at least one component/);
  const only = buildIndex(sig, { weights: { momentum: 2, volatility: 0, breadth: 0 } });
  const i = at("2008-10");
  assert.equal(only.index[i], only.scores.momentum[i]);
  const eq = buildIndex(sig, { window: 120 });
  close(eq.index[i], (eq.scores.momentum[i] + eq.scores.volatility[i] + eq.scores.breadth[i]) / 3);
  // A higher volatility gives a lower (more fearful) score.
  assert.ok(eq.scores.volatility[at("2008-10")] < 5);
  assert.equal(monthOf(sig.start, eq.first), "1966-09");
  close(bandShares(eq.index).reduce((s, b) => s + b.share, 0), 1);
});

test("Newey-West with no lags is the plain standard error of a mean", () => {
  const f = [1, 2, 3, 4, 10];
  const m = 4, v = [9, 4, 1, 0, 36].reduce((a, b) => a + b, 0) / 5;
  const nw = neweyWest(f, 0);
  close(nw.mean, m);
  close(nw.se, Math.sqrt(v / 5));
  assert.ok(neweyWest([1, 1, 2, 2, 1, 1, 2, 2], 2).se > 0);
});

test("the out-of-sample test finds a signal that is there and none that is not", () => {
  const r = rng(7);
  const n = 600;
  const idx = Array.from({ length: n }, () => r.uniform(0, 100));
  // Prices whose next-month log change is 0.001 * (index - 50) plus a little noise: the index forecasts well.
  const price = [100];
  for (let i = 0; i < n - 1; i++) price.push(price[i] * Math.exp(0.001 * (idx[i] - 50) + r.normal(0, 0.005)));
  const good = oosTest(idx, price, 1);
  assert.ok(good.r2 > 0.8 && good.p < 0.001, `r2 ${good.r2} p ${good.p}`);
  // Pure noise: no gain, and Clark-West does not reject.
  const noise = [100];
  for (let i = 0; i < n - 1; i++) noise.push(noise[i] * Math.exp(r.normal(0, 0.04)));
  const none = oosTest(idx, noise, 1);
  assert.ok(none.r2 < 0.02 && none.p > 0.05, `r2 ${none.r2} p ${none.p}`);
  // Each forecast uses only outcomes known at the time: the first one is fitted on outcomes that end by its month.
  const first = good.rows[0];
  // The test starts ten years (120 months) after the index begins; at month 120 the outcomes of months 0 to 119 are known.
  assert.equal(first.t, 120);
  assert.equal(first.n, 120);
  assert.deepEqual(forward([1, Math.E, Math.E ** 3], 1).map((v) => (v == null ? v : Math.round(v))), [1, 2, null]);
});

test("the finding: fear in September 2023, and no out-of-sample edge", () => {
  const ix = buildIndex(sig, { window: 120 });
  assert.equal(ix.index.at(-1).toFixed(1), "14.8");
  assert.equal(band(ix.index.at(-1)).label, "Extreme fear");
  const t12 = oosTest(ix.index, sig.price, 12);
  assert.equal(t12.n, 553);
  assert.equal(monthOf(sig.start, t12.from), "1976-09");
  assert.equal(monthOf(sig.start, t12.to), "2022-09");
  assert.equal((100 * t12.r2).toFixed(1), "-2.8");
  assert.ok(t12.p > 0.9);
  const t1 = oosTest(ix.index, sig.price, 1);
  assert.equal((100 * t1.r2).toFixed(1), "-0.3");
  assert.ok(t1.p > 0.5);
  for (const h of [3, 6]) assert.ok(oosTest(ix.index, sig.price, h).r2 < 0);
  const b = byBand(ix.index, sig.price, 12);
  const xf = b.groups.find((g) => g.key === "xfear");
  assert.equal(xf.n, 88);
  // Spells count only months whose next twelve months are in the data (three later spells have no outcome yet).
  assert.equal(xf.runs, 26);
  assert.equal((100 * xf.mean).toFixed(1), "11.5");
  // Counted once per spell, from its first month: 6.12% in a separate Python recomputation from Statistics Canada's CSV.
  assert.equal((100 * xf.firstMean).toFixed(1), "6.1");
  assert.equal((100 * b.all.mean).toFixed(1), "7.2");
  assert.equal(b.all.n, 673);
});

test("the old and new sector sets agree where both exist", () => {
  const o = overlap(TSX);
  assert.equal(o.n, 58);
  assert.equal(o.from, "1998-09");
  assert.equal(o.to, "2003-06");
  assert.equal(o.corr.toFixed(2), "0.86");
});

test("the write-up's band shares: the average of three scores is pulled towards the middle", () => {
  const shares = bandShares(buildIndex(sig, { window: 120 }).index);
  assert.equal(Math.round(100 * shares[0].share), 13);
  assert.equal(Math.round(100 * shares[4].share), 11);
  assert.ok(shares[2].share > 0.2, "neutral is more common than a fifth");
});

test("spells and their first months, by hand", () => {
  // Index readings: fear, fear, greed, fear, then a month with no outcome. Prices give known changes.
  const index = [10, 15, 70, 12, 11];
  const price = [100, 110, 121, 133.1, 146.41, 161.051];
  const b = byBand(index, price, 1); // every month rises 10%, the last reading's month has an outcome too (price has 6)
  const xf = b.groups.find((g) => g.key === "xfear");
  assert.equal(xf.n, 4);
  assert.equal(xf.runs, 2);             // months 0-1 and months 3-4
  close(xf.firstMean, 0.1, 1e-12);
  // A spell made only of the last month, whose next month is not in the data, is not counted.
  const g = byBand([10, 15, 70, 50, 11], price.slice(0, 5), 1).groups.find((x) => x.key === "xfear");
  assert.equal(g.n, 2);
  assert.equal(g.runs, 1);
  const short = byBand([10, 15, 70, 12, 11], [100, 110, 121, 133.1, 120], 1).groups.find((x) => x.key === "xfear");
  close(short.firstMean, (0.1 + (120 / 133.1 - 1)) / 2, 1e-12);
});
