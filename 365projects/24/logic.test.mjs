import test from "node:test";
import assert from "node:assert/strict";
import { rng } from "../kit/kit.js";
import {
  COIN, LIMITS, isDate, dayNumber, addDays, daysBetween, localToday, brier, expectedBrier, scorecard,
  emptyLog, parseTags, addForecast, editForecast, resolveForecast, reopenForecast, deleteForecast, statusOf, arrange, allTags,
  toJSON, toCSV, parseImport, mergeInto, restore, exampleLog, CSV_COLUMNS,
} from "./logic.js";

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const TODAY = "2026-10-10";
const made = (p, outcome, resolved = "2026-09-01", extra = {}) => ({ id: `t${Math.round(p * 100)}-${outcome}-${resolved}-${extra.n ?? 0}`, statement: "s", p, created: "2026-08-01", due: resolved ?? "2026-12-01", tags: [], outcome, resolved: outcome === null ? null : resolved, revised: null, ...extra });

test("dates: validity, arithmetic and the local day", () => {
  assert.ok(isDate("2026-02-28") && isDate("2028-02-29"));
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "tomorrow", "", null, 20261010]) assert.equal(isDate(bad), false, String(bad));
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-10-10", "2026-11-09"), 30);
  assert.equal(dayNumber("1970-01-02"), 1);
  assert.equal(localToday(new Date(2026, 9, 5, 23, 59)), "2026-10-05");
});

test("the Brier score of one forecast is the squared miss, by hand", () => {
  close(brier(0.7, 1), 0.09);
  close(brier(0.7, 0), 0.49);
  assert.equal(brier(1, 1), 0);
  assert.equal(brier(1, 0), 1);
  assert.equal(brier(0, 0), 0);
  assert.equal(brier(0.5, 1), COIN);
  assert.equal(brier(0.5, 0), COIN);
});

test("mean Brier score by hand: three forecasts", () => {
  // 80% and it happened (0.04), 60% and it did not (0.36), 10% and it did not (0.01): mean 0.41 / 3.
  const card = scorecard([made(0.8, 1), made(0.6, 0), made(0.1, 0)]);
  assert.equal(card.n, 3);
  close(card.brier, 0.41 / 3);
  close(card.skill, 1 - (0.41 / 3) / 0.25); // 45.3% of the coin-flipper's score removed
  close(card.baseRate, 1 / 3);
  // Open forecasts do not count.
  assert.equal(scorecard([made(0.8, 1), made(0.3, null)]).n, 1);
});

test("always saying 50% scores exactly 0.25 whatever happens", () => {
  const r = rng(24);
  const card = scorecard(Array.from({ length: 200 }, (_, i) => made(0.5, r.bool(0.37) ? 1 : 0, "2026-09-01", { n: i })));
  close(card.brier, COIN);
  close(card.skill, 0);
  assert.equal(card.confidence, null, "a 50% forecast leans neither way");
});

test("the finding: saying 90% and being right 70% of the time scores 0.25", () => {
  close(expectedBrier(0.9, 0.7), 0.25);
  // The same thing from an actual log: ten forecasts at 90%, seven of which came true.
  const card = scorecard(Array.from({ length: 10 }, (_, i) => made(0.9, i < 7 ? 1 : 0, "2026-09-01", { n: i })));
  close(card.brier, 0.25);
  close(card.skill, 0);
  // Honest calibration at the same hit rate is better, and perfect foresight is 0.
  close(expectedBrier(0.7, 0.7), 0.21);
  assert.equal(expectedBrier(1, 1), 0);
  close(expectedBrier(0.5, 0.123), 0.25);
});

test("a calibrated forecaster's expected score is p(1 - p), and simulation agrees", () => {
  const r = rng(7);
  for (const p of [0.1, 0.3, 0.8]) {
    close(expectedBrier(p, p), p * (1 - p));
    const card = scorecard(Array.from({ length: 20000 }, (_, i) => made(p, r.bool(p) ? 1 : 0, "2026-09-01", { n: i })));
    close(card.brier, p * (1 - p), 0.01);
    assert.ok(Math.abs(card.confidence.z) < 3, `z = ${card.confidence.z}`);
  }
});

test("Murphy's decomposition adds up exactly: Brier = reliability - resolution + uncertainty", () => {
  // By hand: two groups. 80%: 4 forecasts, 3 true. 20%: 4 forecasts, 1 true. Base rate 0.5.
  const log = [1, 1, 1, 0].map((o, i) => made(0.8, o, "2026-09-01", { n: i })).concat([1, 0, 0, 0].map((o, i) => made(0.2, o, "2026-09-02", { n: i })));
  const card = scorecard(log);
  close(card.parts.reliability, (4 * 0.05 ** 2 + 4 * 0.05 ** 2) / 8); // 0.0025
  close(card.parts.resolution, (4 * 0.25 ** 2 + 4 * 0.25 ** 2) / 8); // 0.0625
  close(card.parts.uncertainty, 0.25);
  close(card.brier, 0.0025 - 0.0625 + 0.25); // 0.19
  close(card.brier, (3 * 0.04 + 0.64 + 0.64 + 3 * 0.04) / 8);
  // And on random logs.
  const r = rng(11);
  for (let trial = 0; trial < 30; trial++) {
    const random = Array.from({ length: r.int(1, 60) }, (_, i) => made(r.int(0, 20) / 20, r.bool(0.6) ? 1 : 0, addDays("2026-01-01", r.int(0, 200)), { n: i }));
    const c = scorecard(random);
    close(c.brier, c.parts.reliability - c.parts.resolution + c.parts.uncertainty, 1e-10);
    assert.ok(c.brier >= 0 && c.brier <= 1);
  }
});

test("calibration bins: five until there are sixty forecasts, edges go to the upper bin", () => {
  const card = scorecard([made(0.2, 0), made(0.39, 1), made(0.4, 1), made(1, 1), made(0, 0), made(0.8, 0)]);
  assert.equal(card.bins.length, 5);
  assert.deepEqual(card.bins.map((b) => b.n), [1, 2, 1, 0, 2]);
  close(card.bins[1].meanP, 0.295);
  close(card.bins[1].rate, 0.5);
  assert.equal(card.bins[3].rate, null);
  assert.equal(card.bins[4].happened, 1);
  const many = scorecard(Array.from({ length: 60 }, (_, i) => made(0.7, i % 2, "2026-09-01", { n: i })));
  assert.equal(many.bins.length, 10);
  assert.equal(many.bins[7].n, 60, "0.7 belongs to the 70 to 80% bin");
  assert.equal(scorecard([made(0.7, 1)], { bins: 4 }).bins.length, 4);
});

test("confidence folds every forecast onto the side it leaned to", () => {
  // 20% and it did not happen is an 80% forecast that came good.
  const card = scorecard([made(0.2, 0), made(0.9, 1), made(0.7, 0), made(0.5, 1)]);
  assert.equal(card.confidence.n, 3);
  close(card.confidence.said, (0.8 + 0.9 + 0.7) / 3);
  close(card.confidence.right, 2 / 3);
  close(card.confidence.gap, 0.8 - 2 / 3);
  assert.equal(card.confidence.verdict, "too few");
  // z by hand: hits 2, expected 2.4, variance 0.16 + 0.09 + 0.21 = 0.46.
  close(card.confidence.z, (2 - 2.4) / Math.sqrt(0.46));
  // Thirty forecasts at 90% with eighteen hits: far too confident for luck to explain.
  const over = scorecard(Array.from({ length: 30 }, (_, i) => made(0.9, i < 18 ? 1 : 0, "2026-09-01", { n: i })));
  assert.equal(over.confidence.verdict, "overconfident");
  close(over.confidence.z, (18 - 27) / Math.sqrt(2.7));
  const under = scorecard(Array.from({ length: 30 }, (_, i) => made(0.6, i < 28 ? 1 : 0, "2026-09-01", { n: i })));
  assert.equal(under.confidence.verdict, "underconfident");
  // Certainty that fails is caught without dividing by zero.
  assert.equal(scorecard([made(1, 0)]).confidence.z, -Infinity);
  assert.equal(scorecard([made(1, 1)]).confidence.z, 0);
});

test("the timeline runs in order of resolution and its last running mean is the score", () => {
  const card = scorecard([made(0.9, 0, "2026-09-03"), made(0.6, 1, "2026-09-01"), made(0.5, 1, "2026-09-02")]);
  assert.deepEqual(card.timeline.map((t) => t.date), ["2026-09-01", "2026-09-02", "2026-09-03"]);
  close(card.timeline[0].mean, 0.16);
  close(card.timeline[1].mean, (0.16 + 0.25) / 2);
  close(card.timeline[2].mean, card.brier);
  const none = scorecard([made(0.4, null)]);
  assert.deepEqual([none.n, none.total, none.brier, none.confidence, none.timeline.length], [0, 1, null, null, 0]);
  assert.equal(scorecard([]).brier, null);
});

test("adding a prediction validates what was typed", () => {
  const ok = { statement: "  It   rains on Saturday ", percent: 30, due: "2026-10-17", tags: "Weather, weather; Home" };
  const res = addForecast(emptyLog(), ok, { today: TODAY, id: "a" });
  assert.deepEqual(res.log.forecasts[0], { id: "a", statement: "It rains on Saturday", p: 0.3, due: "2026-10-17", tags: ["weather", "home"], created: TODAY, outcome: null, resolved: null, revised: null });
  assert.match(addForecast(emptyLog(), { ...ok, statement: "   " }, { today: TODAY }).error, /statement/);
  for (const percent of [-1, 101, NaN, "", "abc", null]) assert.match(addForecast(emptyLog(), { ...ok, percent }, { today: TODAY }).error, /between 0 and 100/, String(percent));
  assert.equal(addForecast(emptyLog(), { ...ok, percent: "62.5%" }, { today: TODAY }).log.forecasts[0].p, 0.625);
  assert.equal(addForecast(emptyLog(), { ...ok, percent: 0 }, { today: TODAY }).log.forecasts[0].p, 0);
  assert.equal(addForecast(emptyLog(), { ...ok, percent: 100 }, { today: TODAY }).log.forecasts[0].p, 1);
  assert.match(addForecast(emptyLog(), { ...ok, due: "" }, { today: TODAY }).error, /date/);
  assert.match(addForecast(emptyLog(), { ...ok, due: "2026-10-09" }, { today: TODAY }).error, /today onwards/);
  assert.ok(addForecast(emptyLog(), { ...ok, due: TODAY }, { today: TODAY }).log, "resolving today is allowed");
  assert.equal(addForecast(emptyLog(), { ...ok, statement: "x".repeat(999) }, { today: TODAY }).log.forecasts[0].statement.length, LIMITS.statement);
  assert.deepEqual(parseTags("a, b, c, d, e, f, g, h"), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(parseTags(null), []);
  const two = addForecast(res.log, ok, { today: TODAY });
  assert.notEqual(two.id, "a");
  assert.equal(res.log.forecasts.length, 1, "the log passed in is not changed");
});

test("resolve, undo, edit and delete", () => {
  let log = addForecast(emptyLog(), { statement: "A", percent: 70, due: "2026-11-01", tags: "" }, { today: TODAY, id: "a" }).log;
  log = addForecast(log, { statement: "B", percent: 20, due: "2026-10-20", tags: "x" }, { today: TODAY, id: "b" }).log;

  let edited = editForecast(log, "a", { statement: "A2", percent: 70, due: "2026-11-05", tags: "t" }, { today: "2026-10-12" }).log;
  assert.deepEqual([edited.forecasts[0].statement, edited.forecasts[0].due, edited.forecasts[0].revised], ["A2", "2026-11-05", null]);
  edited = editForecast(edited, "a", { statement: "A2", percent: 55, due: "2026-11-05", tags: "t" }, { today: "2026-10-14" }).log;
  assert.deepEqual([edited.forecasts[0].p, edited.forecasts[0].revised], [0.55, "2026-10-14"], "a changed probability is date-stamped");
  assert.match(editForecast(log, "a", { statement: "A", percent: 70, due: "2026-10-01", tags: "" }, { today: TODAY }).error, /earlier than the day/);
  assert.match(editForecast(log, "zzz", { statement: "A", percent: 70, due: "2026-11-01" }, { today: TODAY }).error, /no longer/);

  const resolved = resolveForecast(log, "a", true, { today: "2026-10-30" }).log;
  assert.deepEqual([resolved.forecasts[0].outcome, resolved.forecasts[0].resolved], [1, "2026-10-30"]);
  assert.equal(resolveForecast(log, "b", false, { today: "2026-10-30" }).log.forecasts[1].outcome, 0);
  assert.match(editForecast(resolved, "a", { statement: "A", percent: 10, due: "2026-11-01" }, { today: TODAY }).error, /Undo/);
  close(scorecard(resolved.forecasts).brier, 0.09);
  const reopened = reopenForecast(resolved, "a").log;
  assert.deepEqual(reopened, log);
  assert.equal(deleteForecast(log, "a").log.forecasts.length, 1);
  for (const op of [resolveForecast(log, "zzz", true, { today: TODAY }), reopenForecast(log, "zzz"), deleteForecast(log, "zzz")]) assert.match(op.error, /no longer/);
});

test("status and the three lists: overdue, open, resolved", () => {
  const f = (id, due, outcome = null, resolved = null) => ({ id, statement: id, p: 0.5, created: "2026-09-01", due, tags: [id.length > 1 ? "two" : "one"], outcome, resolved, revised: null });
  const all = [f("a", "2026-10-09"), f("b", "2026-10-10"), f("c", "2026-10-11"), f("dd", "2026-09-20"), f("e", "2026-09-10", 1, "2026-09-12"), f("g", "2026-12-01", 0, "2026-10-01")];
  assert.deepEqual(all.map((x) => statusOf(x, TODAY)), ["overdue", "today", "open", "overdue", "resolved", "resolved"]);
  const lists = arrange(all, TODAY);
  assert.deepEqual(lists.overdue.map((x) => x.id), ["dd", "a"], "the most overdue first");
  assert.deepEqual(lists.open.map((x) => x.id), ["b", "c"]);
  assert.deepEqual(lists.resolved.map((x) => x.id), ["g", "e"], "the most recently resolved first");
  assert.deepEqual(allTags(all), ["one", "two"]);
});

test("JSON and CSV exports read back to the same log", () => {
  const log = exampleLog(TODAY);
  log.forecasts[0] = { ...log.forecasts[0], statement: 'He said "yes", then\nleft', tags: ["a b", "c"], revised: "2026-07-01" };
  for (const text of [toJSON(log), toCSV(log)]) {
    const res = parseImport(text, { today: TODAY });
    assert.deepEqual(res.problems, []);
    // A line break inside a statement is flattened to a space on the way in.
    assert.deepEqual(res.forecasts, log.forecasts.map((f, i) => (i ? f : { ...f, statement: 'He said "yes", then left' })));
  }
  assert.equal(toCSV(log).split("\n")[0], CSV_COLUMNS.join(","));
  assert.equal(toCSV(emptyLog()), CSV_COLUMNS.join(","));
});

test("a hand-made CSV is read, and bad rows are reported and left out", () => {
  const text = [
    "Statement,Probability,Due,Outcome,Tags",
    "It rains,70%,2026-09-01,yes,weather",
    "It snows,10,2026-12-25,,weather; winter",
    "No date,50,,,",
    "Too sure,140,2026-11-01,,",
    ",50,2026-11-01,,",
    "Odd outcome,50,2026-09-01,maybe,",
  ].join("\r\n");
  const res = parseImport(text, { today: TODAY });
  assert.equal(res.forecasts.length, 2);
  assert.deepEqual([res.forecasts[0].p, res.forecasts[0].outcome, res.forecasts[0].resolved, res.forecasts[0].created], [0.7, 1, "2026-09-01", "2026-09-01"]);
  assert.deepEqual([res.forecasts[1].p, res.forecasts[1].outcome, res.forecasts[1].created, res.forecasts[1].tags], [0.1, null, TODAY, ["weather", "winter"]]);
  assert.equal(res.problems.length, 4);
  assert.match(res.problems[0], /Row 3: its due date/);
  assert.match(res.problems[1], /Row 4: its probability/);
  assert.match(res.problems[2], /Row 5: it has no statement/);
  assert.match(res.problems[3], /Row 6: its outcome "maybe"/);
});

test("files that are not a log are refused with a reason", () => {
  assert.match(parseImport("", { today: TODAY }).error, /empty/);
  assert.match(parseImport('{"forecasts": [', { today: TODAY }).error, /cannot be read/);
  assert.match(parseImport('{"hello": 1}', { today: TODAY }).error, /no list of forecasts/);
  assert.match(parseImport("[]", { today: TODAY }).error, /no forecasts/);
  assert.match(parseImport("name,age\nA,3", { today: TODAY }).error, /header row/);
  assert.match(parseImport('[{"statement": "x", "p": 7, "due": "2026-11-01"}]', { today: TODAY }).error, /None of the 1 records/);
  // JSON uses p between 0 and 1; a bare list is accepted.
  const res = parseImport('[{"statement": "x", "p": 0.25, "due": "2026-11-01", "outcome": false}]', { today: TODAY });
  assert.deepEqual([res.forecasts[0].p, res.forecasts[0].outcome, res.forecasts[0].resolved], [0.25, 0, TODAY]);
});

test("merging an import never duplicates and never touches what is there", () => {
  const log = exampleLog(TODAY);
  const again = mergeInto(log, parseImport(toJSON(log), { today: TODAY }).forecasts);
  assert.deepEqual([again.added, again.skipped, again.log.forecasts.length], [0, 32, 32]);
  // The same prediction under a new id (a CSV re-typed without ids) is still recognised.
  const retyped = log.forecasts.slice(0, 3).map((f) => ({ ...f, id: `new-${f.id}` }));
  const fresh = { ...log.forecasts[0], id: "brand-new", statement: "Something else" };
  const merged = mergeInto(log, [...retyped, fresh]);
  assert.deepEqual([merged.added, merged.skipped], [1, 3]);
  assert.equal(merged.log.forecasts.at(-1).id, "brand-new");
  assert.equal(mergeInto(emptyLog(), log.forecasts).added, 32);
});

test("restoring from storage keeps sound forecasts and drops broken ones", () => {
  assert.equal(restore(null, { today: TODAY }), null);
  assert.equal(restore({ nothing: true }, { today: TODAY }), null);
  const log = exampleLog(TODAY);
  assert.deepEqual(restore(JSON.parse(JSON.stringify(log)), { today: TODAY }), log);
  const damaged = { version: 1, forecasts: [log.forecasts[0], { id: "x", statement: "", p: 2 }, null, log.forecasts[1]] };
  assert.equal(restore(damaged, { today: TODAY }).forecasts.length, 2);
  assert.deepEqual(restore({ forecasts: [] }, { today: TODAY }), emptyLog());
});

test("the example log always has resolved, overdue and open predictions, and its scorecard is as quoted", () => {
  for (const today of [TODAY, "2027-02-28", "2028-02-29"]) {
    const log = exampleLog(today);
    assert.equal(log.forecasts.length, 32);
    const lists = arrange(log.forecasts, today);
    assert.deepEqual([lists.resolved.length, lists.overdue.length, lists.open.length], [24, 3, 5]);
    for (const f of log.forecasts) {
      assert.ok(isDate(f.created) && isDate(f.due) && f.due >= f.created);
      if (f.resolved) assert.ok(f.resolved >= f.created && f.resolved <= today);
    }
    const card = scorecard(log.forecasts);
    assert.equal(card.n, 24);
    assert.equal(card.brier.toFixed(3), "0.216");
    assert.equal((card.skill * 100).toFixed(0), "14");
    assert.equal((card.confidence.said * 100).toFixed(0), "80");
    assert.equal((card.confidence.right * 100).toFixed(0), "71");
    assert.equal(card.confidence.hits, 17);
    assert.equal(card.confidence.z.toFixed(1), "-1.1");
    assert.equal(card.confidence.verdict, "no clear sign");
    assert.deepEqual(card.bins.map((b) => b.n), [1, 4, 0, 6, 13]);
    assert.deepEqual(card.bins.map((b) => b.happened), [0, 1, 0, 4, 9]);
  }
});
