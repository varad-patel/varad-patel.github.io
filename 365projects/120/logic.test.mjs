import test from "node:test";
import assert from "node:assert/strict";
import { LAUNCHES } from "./data.js";
import {
  FORMAT, VERSION, LIMITS, isDate, dayOf, isoOf, addYears, logit, sigmoid, CLASSES, classCounts, laplace, DATA_END, DATA_START,
  parseRatio, parsePercent, checkCounts, path, brier, logScore, COIN, scorecard, checkNews, checkForecast, resolve, toJSON,
  readForecast, parseImport, mergeInto, restore, firstFlight, PRESETS, ILLUSTRATION, outsideView,
} from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const today = "2026-10-29";
const fc = (base, ratios, outcome = null, id = "f1") => ({ id, event: "x", date: today, made: today, ref: { key: "own", label: "mine", k: null, n: null, window: "all" }, base, news: ratios.map((r, i) => ({ id: `n${i}`, text: "news", ratio: r, added: today })), outcome, resolved: outcome === null ? null : today, preset: null });

test("scores: hand-computed cases", () => {
  close(brier(0.8, 1), 0.04, 1e-12);
  close(brier(0.8, 0), 0.64, 1e-12);
  close(logScore(logit(0.8), 1), Math.log(0.8), 1e-12);
  close(logScore(logit(0.8), 0), Math.log(0.2), 1e-12);
  close(COIN.brier, 0.25, 0);
  close(COIN.log, -0.693147, 1e-6);
  // A forecast pushed far past a millionth and then wrong is scored finitely, never minus infinity.
  assert.ok(Number.isFinite(logScore(60, 0)));
  close(logScore(60, 0), -60, 1e-9);
});

test("updating: base rate times the news ratios, in odds", () => {
  const p = path(0.25, [{ ratio: 3 }, { ratio: 0.5 }]);
  // Odds 1:3, times 3 is 1:1, times 0.5 is 1:2, so 33.3%.
  close(p.p, 1 / 3, 1e-12);
  close(p.ratio, 1.5, 1e-12);
  assert.equal(p.steps.length, 3);
  close(p.steps[1].p, 0.5, 1e-12);
  // The illustration: 51% from the data, then the two made-up news items.
  assert.deepEqual(ILLUSTRATION.news.map((n) => n.ratio), [1.5, 0.7]);
});

test("Laplace's rule: (k + 1) / (n + 2)", () => {
  close(laplace(0, 0), 0.5, 0);
  close(laplace(44, 86), 45 / 88, 1e-12);
  close(laplace(10, 10), 11 / 12, 1e-12);
});

test("the data: GCAT's own records for the anchor first flights, and the counts", () => {
  assert.equal(LAUNCHES.source.licence, "CC BY 4.0");
  assert.equal(DATA_START, "1957-10-04");                 // Sputnik
  assert.equal(LAUNCHES.codes[0], "7");                   // a success, the first of its type and family
  assert.ok(DATA_END >= "2026-01-01");
  const a5 = firstFlight("Ariane 5G");
  assert.deepEqual(a5, { date: "1996-06-04", type: "Ariane 5G", family: "Ariane5", ok: false, newFamily: true });
  assert.deepEqual(firstFlight("Falcon 9"), { date: "2010-06-04", type: "Falcon 9", family: "Falcon9", ok: true, newFamily: true });
  assert.equal(firstFlight("Electron").ok, false);
  assert.equal(firstFlight("H3-22S").newFamily, false);   // GCAT puts H3 in the H2B family
  assert.equal(firstFlight("Vulcan Centaur VC2S").ok, true);
  assert.equal(firstFlight("No such rocket"), null);
  for (const p of PRESETS) assert.ok(firstFlight(p.type), p.key);
  assert.equal(LAUNCHES.days.length, LAUNCHES.codes.length);
  for (let i = 1; i < LAUNCHES.days.length; i++) assert.ok(LAUNCHES.days[i] >= LAUNCHES.days[i - 1]);
  // 1957 to 2025, held to ranges because GCAT is revised: about 7,160 attempts, 93% successful.
  const all = classCounts("any", "2026-01-01");
  assert.ok(all.n > 7000 && all.n < 7400, `${all.n}`);
  close(all.k / all.n, 0.93, 0.01);
});

test("reference-class counts use only launches before the date (no look-ahead), within the window", () => {
  // Falcon 9's first flight is itself a first flight of a new family: it must not count towards its own base rate.
  const before = classCounts("family", "2010-06-04");
  const after = classCounts("family", "2010-06-05");
  assert.equal(after.n, before.n + 1);
  assert.equal(after.k, before.k + 1);
  assert.equal(before.to, "2010-06-03");
  assert.deepEqual(classCounts("family", "1957-10-04"), { k: 0, n: 0, from: "1957-10-04", to: "1957-10-03" });
  const w = classCounts("family", "2010-06-04", "last20");
  assert.equal(w.from, "1990-06-04");
  assert.ok(w.n < before.n && w.n > 0);
  // The classes: family and version split the first flights of a type between them.
  const t = classCounts("type", "2020-01-01"), f = classCounts("family", "2020-01-01"), v = classCounts("version", "2020-01-01");
  assert.equal(t.n, f.n + v.n);
  assert.equal(t.k, f.k + v.k);
  assert.throws(() => classCounts("nope", "2020-01-01"));
  assert.equal(CLASSES.length, 4);
  assert.equal(addYears("2024-02-29", -20), "2004-02-28");
  assert.equal(isoOf(dayOf("2010-06-04")), "2010-06-04");
});

test("the presets' base rates, as the page shows them", () => {
  const f9 = classCounts("family", "2010-06-04");
  assert.deepEqual([f9.k, f9.n], [27, 50]);
  assert.equal((laplace(f9.k, f9.n) * 100).toFixed(1), "53.8");
  const a5 = classCounts("family", "1996-06-04");
  assert.deepEqual([a5.k, a5.n], [21, 37]);
  const h3 = classCounts("version", "2023-03-07");
  assert.deepEqual([h3.k, h3.n], [272, 330]);
});

test("the finding: the outside view on every first flight of a new rocket type, 2000 to 2025", () => {
  const ex = outsideView();
  assert.equal(ex.length, 161);
  const fam = ex.filter((f) => f.ref.key === "family"), ver = ex.filter((f) => f.ref.key === "version");
  assert.equal(fam.length, 44);
  assert.equal(fam.filter((f) => f.outcome === 1).length, 21);
  assert.equal(ver.length, 117);
  assert.equal(ver.filter((f) => f.outcome === 1).length, 97);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.equal((mean(fam.map((f) => f.base)) * 100).toFixed(1), "54.0");
  assert.equal((mean(ver.map((f) => f.base)) * 100).toFixed(1), "82.5");
  const card = scorecard(ex);
  assert.equal(card.final.brier.toFixed(3), "0.173");
  assert.equal(card.final.log.toFixed(2), "-0.53");
  const single = scorecard(outsideView({ single: true }));
  assert.equal(single.final.brier.toFixed(3), "0.197");
  // No look-ahead: every forecast's counts stop the day before its own launch.
  for (const f of ex.slice(0, 20)) assert.equal(classCounts(f.ref.key, f.date).n, f.ref.n);
  // Recomputed separately: Brier is the mean of (p - outcome)^2.
  close(card.final.brier, mean(ex.map((f) => (f.base - f.outcome) ** 2)), 1e-12);
});

test("the scorecard compares the final forecast with the base rate alone, and bins for calibration", () => {
  const list = [fc(0.5, [4], 1, "a"), fc(0.5, [0.25], 0, "b"), fc(0.5, [], 1, "c"), fc(0.2, [], null, "d")];
  const card = scorecard(list);
  assert.equal(card.n, 3);
  assert.equal(card.total, 4);
  close(card.base.brier, 0.25, 1e-12);
  close(card.final.brier, (0.04 + 0.04 + 0.25) / 3, 1e-12);
  close(card.final.log, (Math.log(0.8) + Math.log(0.8) + Math.log(0.5)) / 3, 1e-12);
  assert.equal(card.bins.length, 5);
  assert.deepEqual(card.bins.map((b) => b.n), [0, 1, 1, 0, 1]); // 20% falls in the bin from 20%, 50% in the middle, 80% in the top
  assert.equal(scorecard([]).final, null);
  const many = Array.from({ length: 60 }, (_, i) => fc(((i % 10) + 0.5) / 10, [], i % 2, `m${i}`));
  assert.equal(scorecard(many).bins.length, 10);
  assert.equal(scorecard([fc(0.999, [], 1, "x")]).bins.at(-1).n, 1);
});

test("reading ratios, percentages and counts, with the reasons for refusing", () => {
  assert.equal(parseRatio("2").value, 2);
  assert.equal(parseRatio("1/2").value, 0.5);
  assert.equal(parseRatio("3:1").value, 3);
  assert.equal(parseRatio("1 to 4").value, 0.25);
  assert.match(parseRatio("0").error, /settles the question/);
  assert.match(parseRatio("1/0").error, /unlimited/);
  assert.match(parseRatio("infinity").error, /unlimited/);
  assert.match(parseRatio("-1").error, /negative/);
  assert.match(parseRatio("2e5").error, /10,000/);
  assert.match(parseRatio("").error, /likelihood ratio/);
  assert.match(parseRatio("two").error, /not a number/);
  assert.equal(parsePercent("25%").value, 0.25);
  assert.match(parsePercent("0").error, /impossible or certain/);
  assert.match(parsePercent("100").error, /impossible or certain/);
  assert.match(parsePercent("0.01").error, /between 0.1% and 99.9%/);
  assert.ok(Math.abs(parsePercent("99.9").value - 0.999) < 1e-15);
  assert.equal(parsePercent("0.1").value, 0.001);
  assert.match(parsePercent("99.95").error, /between 0.1% and 99.9%/);
  assert.match(parsePercent("abc").error, /not a percentage/);
  assert.match(parsePercent("150").error, /more than 100%/);
  assert.deepEqual(checkCounts(3, 10).value, { k: 3, n: 10 });
  assert.match(checkCounts(11, 10).error, /from 0 to 10/);
  assert.match(checkCounts(1, 0).error, /from 1 to/);
  assert.match(checkCounts(1.5, 10).error, /whole number/);
  assert.match(checkCounts(1, 2e6).error, /1,000,000/);
});

test("checking news and whole forecasts", () => {
  assert.equal(checkNews({ text: "  a  test ", ratio: "2" }).item.text, "a test");
  assert.equal(checkNews({ text: "", ratio: "2" }).field, "text");
  assert.equal(checkNews({ text: "x", ratio: "0" }).field, "ratio");
  assert.match(checkNews({ text: "y".repeat(200), ratio: "2" }).error, /160 characters; it has 200/);
  assert.ok(checkForecast(fc(0.3, [2, 0.5])).forecast);
  assert.match(checkForecast({ ...fc(0.3, []), event: " " }).error, /Describe the event/);
  assert.match(checkForecast({ ...fc(0.3, []), date: "2026-02-30" }).error, /date/);
  assert.match(checkForecast(fc(1, [])).error, /base rate/);
  assert.ok(checkForecast(fc(laplace(999999, 1000000), [])).forecast); // counts of a million may go past 99.9%
  assert.match(checkForecast(fc(0.5, Array(21).fill(2))).error, /up to 20/);
  assert.match(checkForecast(fc(0.5, [0])).error, /News item 1/);
});

test("resolving and undoing", () => {
  let list = [fc(0.4, [], null, "a")];
  list = resolve(list, "a", true, today).list;
  assert.equal(list[0].outcome, 1);
  assert.equal(list[0].resolved, today);
  list = resolve(list, "a", null, today).list;
  assert.equal(list[0].outcome, null);
  assert.equal(list[0].resolved, null);
  assert.match(resolve(list, "zz", true, today).error, /no longer/);
});

test("export and import give back exactly the same forecasts", () => {
  const list = [fc(0.123456789, [1.5, 1 / 3, 9999], 1, "a"), fc(0.5, [], null, "b"), { ...fc(0.7, [2], 0, "c"), event: "=HYPERLINK(\"x\") <script>" + "w".repeat(150), preset: "falcon9", ref: { key: "family", label: "First flights of a new rocket family", k: 27, n: 50, window: "last20" } }];
  const back = parseImport(toJSON(list), today);
  assert.deepEqual(back.problems, []);
  assert.deepEqual(back.forecasts, list);
  assert.deepEqual(parseImport(toJSON(back.forecasts), today).forecasts, list);
});

test("import refuses what it cannot read, and says why", () => {
  assert.match(parseImport("", today).error, /empty/);
  assert.match(parseImport("a,b\n1,2", today).error, /JSON/);
  assert.match(parseImport("{", today).error, /cut short/);
  assert.match(parseImport(JSON.stringify({ format: "365-forecast-log", forecasts: [] }), today).error, /not from this page/);
  assert.match(parseImport(JSON.stringify({ format: FORMAT, version: VERSION + 1, forecasts: [] }), today).error, /newer version/);
  const mixed = parseImport(JSON.stringify({ format: FORMAT, version: 1, forecasts: [fc(0.5, [], null, "ok"), { ...fc(0, [], null, "zero") }, { ...fc(0.5, [-2], null, "neg") }, "text"] }), today);
  assert.deepEqual(mixed.forecasts.map((f) => f.id), ["ok"]);
  assert.equal(mixed.problems.length, 3);
  assert.match(mixed.problems[0], /Forecast 2: the base rate/);
  assert.match(mixed.problems[2], /Forecast 4: it is not a record/);
  const m = mergeInto([fc(0.5, [], null, "ok")], [fc(0.5, [], null, "ok"), fc(0.5, [], null, "new")]);
  assert.equal(m.added, 1);
  assert.equal(m.duplicates, 1);
  assert.equal(restore(null, today), null);
  assert.equal(restore({ forecasts: [fc(0.5, [], null, "a"), { id: "bad" }] }, today).length, 1);
  assert.equal(LIMITS.forecasts, 2000);
  assert.equal(isDate("2026-13-01"), false);
});

test("class counts agree with a plain count of the launches, for many dates and both windows", () => {
  const plain = (key, date, window) => {
    const cls = CLASSES.find((c) => c.key === key);
    const before = dayOf(date), from = window === "last20" ? dayOf(addYears(date, -20)) : -Infinity;
    let k = 0, n = 0;
    LAUNCHES.days.forEach((d, i) => { const c = LAUNCHES.codes.charCodeAt(i) - 48; if (d < before && d >= from && cls.test(c)) { n++; k += c & 1; } });
    return [k, n];
  };
  for (const date of ["1957-10-04", "1957-10-05", "1965-03-01", "1996-06-04", "2010-06-04", "2024-02-29", "2026-10-27", "2030-01-01"]) {
    for (const c of CLASSES) for (const w of ["all", "last20"]) {
      const got = classCounts(c.key, date, w);
      assert.deepEqual([got.k, got.n], plain(c.key, date, w), `${c.key} ${date} ${w}`);
    }
  }
});

test("storage written by a newer version of the page is neither read nor rewritten, and a file from another page is named", () => {
  const newer = restore({ format: FORMAT, version: VERSION + 1, forecasts: [fc(0.5, [], null, "a")] }, today);
  assert.equal(newer.length, 0);
  assert.equal(newer.newer, VERSION + 1);
  assert.equal(restore({ format: FORMAT, version: VERSION, forecasts: [fc(0.5, [], null, "a")] }, today).length, 1);
  assert.match(parseImport(JSON.stringify({ format: "365-belief-updater", version: 1, claims: [] }), today).error, /not from this page/);
});

test("a type's first orbital attempt is not always its first flight: Starship's three near-orbital flights are not counted", () => {
  // GCAT codes Starship's flights of 20 April 2023, 18 November 2023 and 14 March 2024 as near-orbital (N), so the
  // first orbital attempt of the type "Starship V1.0" is the fourth flight, a success.
  assert.deepEqual(firstFlight("Starship V1.0"), { date: "2024-06-06", type: "Starship V1.0", family: "Starship", ok: true, newFamily: true });
  const ex = outsideView();
  assert.ok(ex.every((f) => / reaches orbit on its first orbital attempt$/.test(f.event)));
  assert.ok(CLASSES.slice(0, 3).every((c) => c.label.startsWith("First orbital attempts")));
});
