import test from "node:test";
import assert from "node:assert/strict";
import { COST } from "./data.js";
import { KINDS, PARTS, SALARY, places, place, compare, rankOf, inWords, levelNote, reading, coverage, currencyOf, mixed, dollars, units, asTyped, against, moreOrLess } from "./logic.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);
const SF = "metro:San Francisco-Oakland-Fremont, CA", MONROE = "metro:Monroe, LA", JACKSON = "metro:Jackson, MS";
const run = (over) => compare(COST, { salary: 100000, unit: "usd", a: SF, b: MONROE, ...over });

/* ------------------------------------------------------ the data against its sources */

test("BEA regional price parities for 2024 match the published table (MARPP and SARPP, updated 19 February 2026)", () => {
  assert.equal(COST.year, 2024);
  // GeoName, all items, goods, housing, utilities, other services: copied from MARPP_MSA_2008_2024.csv.
  assert.deepEqual(COST.metros.find((m) => m[0] === "Abilene, TX"), ["Abilene, TX", 90.364, 93.757, 73.791, 81.162, 96.24]);
  assert.deepEqual(COST.metros.find((m) => m[0] === "San Francisco-Oakland-Fremont, CA"), ["San Francisco-Oakland-Fremont, CA", 115.613, 108.465, 194.718, 172.585, 106.207]);
  assert.deepEqual(COST.metros.find((m) => m[0] === "Jackson, MS"), ["Jackson, MS", 89.048, 96.219, 64.768, 78.137, 96.09]);
  assert.equal(COST.metros.find((m) => m[0] === "York-Hanover, PA")[5], 97.726);
  assert.equal(COST.rural[1], 88.699);
  // From SARPP_STATE_2008_2024.csv.
  assert.equal(COST.states.find((s) => s[0] === "California")[1], 110.72);
  assert.equal(COST.states.find((s) => s[0] === "Alabama")[1], 88.823);
  assert.equal(COST.metros.length, 387);
  assert.equal(COST.states.length, 51);
  // The spread quoted in the write-up: goods barely vary between metropolitan areas, rents vary fivefold.
  const range = (i) => [Math.min(...COST.metros.map((m) => m[i])), Math.max(...COST.metros.map((m) => m[i]))];
  assert.deepEqual(range(2), [93.577, 111.562]);
  assert.deepEqual(range(3), [42.333, 211.901]);
  // No name keeps the table's suffix or footnote star, and every figure is a plausible index.
  for (const row of [...COST.metros, ...COST.states]) {
    assert.doesNotMatch(row[0], /Statistical Area|\*/);
    for (const v of row.slice(1)) assert.ok(v > 30 && v < 250, `${row[0]}: ${v}`);
  }
});

test("World Bank price levels for 2024 match PPP over the exchange rate from the source series", () => {
  const level = (iso) => COST.countries.find((c) => c[0] === iso);
  // PA.NUS.PRVT.PP / PA.NUS.FCRF, 2024, as returned by the World Bank API on 11 October 2026.
  close(level("IND")[2], 19.8969156536629 / 83.669281580941, 5e-6);
  close(level("GBR")[2], 0.682739 / 0.782414580986261, 5e-6);
  close(level("CHE")[2], 1.107209 / 0.880440833333333, 5e-5);
  close(level("JPN")[2], 99.384798 / 151.366291302751, 5e-6);
  close(level("IND")[3], 83.6693, 1e-4);
  assert.deepEqual(level("USA").slice(2), [1, 1]);
  // Bulgaria: its PPP is in euros and its exchange rate in leva, so the level comes from ratios whose units cancel
  // and no exchange rate is kept. (PRVT.PP / PPP) x (GDP per person in US$ / in international $).
  close(level("BGR")[2], (0.389985350890352 / 0.387533240879461) * (17596.9167621233 / 41969.595471884), 5e-6);
  assert.equal(level("BGR")[3], null);
  // Dividing Bulgaria's two series directly would have given 0.216, half the right answer. The official rate is the
  // rate implied by the World Bank's own GDP figures times 1.956, the fixed number of leva to the euro.
  close(0.389985350890352 / 1.80784166666666, 0.2157, 1e-4);
  close(1.80784166666666 / (0.387533240879461 / (17596.9167621233 / 41969.595471884)), 1.95583, 2e-4);
  assert.equal(COST.countries.length, 171);
  assert.equal(COST.countries.filter((c) => c[3] == null).length, 14);
  assert.equal(COST.countries.filter((c) => c[3] != null).length, 157);
  for (const [iso, name, lvl, rate] of COST.countries) {
    assert.match(iso, /^[A-Z]{3}$/);
    assert.doesNotMatch(name, /,/);
    assert.ok(lvl > 0.1 && lvl < 1.6, `${name}: level ${lvl}`);
    assert.ok(rate == null || rate > 0);
  }
});

test("the 14 countries with no usable official rate: why, and what the other choice of rate would have given", () => {
  const level = (iso) => COST.countries.find((c) => c[0] === iso)[2];
  const without = COST.countries.filter((c) => c[3] == null).map((c) => c[0]).sort();
  assert.deepEqual(Object.keys(COST.noRate).sort(), without);
  const of = (why) => without.filter((iso) => COST.noRate[iso] === why);
  // No official rate at all for 2024 in PA.NUS.FCRF.
  assert.deepEqual(of("missing"), ["AFG", "GIN", "IRN", "MRT", "MWI", "PSE", "SLE"]);
  // An official rate that is not the one the World Bank converts at (its own alternative conversion factor, PA.NUS.ATLS).
  assert.deepEqual(of("differs"), ["AGO", "BDI", "BGD", "BGR", "EGY", "ETH", "LBR"]);
  // Each level is the household PPP over PA.NUS.ATLS. Figures as returned by the World Bank API on 11 October 2026:
  // [household PPP, official rate or null, alternative conversion factor].
  const source = {
    AGO: [311.185651145511, 869.846189590007, 1009.027405],
    BDI: [1029.50964739976, 2885.24549799567, 4795.7343064759],
    EGY: [6.95182862469351, 45.29926, 35.733931],
    BGD: [32.9905392877523, 115.603653796648, 111.140585],
    ETH: [24.4939429344667, 82.6013363504764, 78.7],
    LBR: [0.505811352137508, 191.306666666666, 1],
    AFG: [13.9880484201057, null, 70.98],
    PSE: [0.791028023403763, null, 1],
  };
  for (const [iso, [ppp, , atls]] of Object.entries(source)) close(level(iso), ppp / atls, 2e-5);
  // The figures quoted in the write-up: what the official rate would have given instead.
  const official = (iso) => (source[iso][0] / source[iso][1]).toFixed(2);
  assert.deepEqual([official("AGO"), level("AGO").toFixed(2)], ["0.36", "0.31"]);
  assert.deepEqual([official("BDI"), level("BDI").toFixed(2)], ["0.36", "0.21"]);
  assert.deepEqual([official("EGY"), level("EGY").toFixed(2)], ["0.15", "0.19"]);
  assert.equal((0.389985350890352 / 1.80784166666666).toFixed(2), "0.22");   // Bulgaria, euros over leva
  // Countries the write-up names as missing from the World Bank's 2024 series.
  for (const iso of ["ARG", "COD", "VEN"]) assert.equal(COST.countries.some((c) => c[0] === iso), false, iso);
  // What the tool says for each kind.
  assert.match(levelNote(COST, place(COST, "country:AFG")), /The World Bank gives no official exchange rate for Afghanistan for 2024.*US dollars only/);
  assert.match(levelNote(COST, place(COST, "country:EGY")), /does not turn the figures for Egypt into dollars at the official exchange rate for 2024.*US dollars only/);
  assert.doesNotMatch(levelNote(COST, place(COST, "country:IND")), /US dollars only/);
});

test("BEA's national figures: 100 for all items, close to 100 for the four parts", () => {
  // The United States row of MARPP_MSA_2008_2024.csv and SARPP_STATE_2008_2024.csv for 2024.
  assert.deepEqual(COST.us, [100, 99.567, 100.629, 98.441, 100.147]);
  assert.deepEqual(COST.us.slice(1).map((v) => v.toFixed(1)), ["99.6", "100.6", "98.4", "100.1"]);
});

/* ------------------------------------------------------------------ by hand */

test("the dearest and the cheapest metropolitan areas, worked by hand", () => {
  const r = run({});
  assert.equal(r.ok, true);
  // 115.613 and 83.597 with the US at 100.
  close(r.needed, 100000 * 83.597 / 115.613, 1e-6);          // 72,307.61
  close(r.stretch, 115.613 / 83.597 - 1, 1e-12);             // +38.3%
  close(r.realA, 100000 / 1.15613, 1e-6);                    // 86,495.46
  close(r.realB, 100000 / 0.83597, 1e-6);                    // 119,621.52
  assert.equal(r.neededLocal, null);
  // Parts: Monroe relative to San Francisco.
  const gap = Object.fromEntries(r.parts.map((p) => [p.key, p.gap]));
  close(gap.housing, 42.815 / 194.718 - 1, 1e-12);           // -78.0%
  close(gap.goods, 93.691 / 108.465 - 1, 1e-12);             // -13.6%
  close(gap.utilities, 72.215 / 172.585 - 1, 1e-12);         // -58.2%
  close(gap.other, 95.705 / 106.207 - 1, 1e-12);             // -9.9%
  assert.equal(r.widest.key, "housing");
  // And the way back is the reciprocal.
  const back = run({ a: MONROE, b: SF, salary: r.needed });
  close(back.needed, 100000, 1e-6);
  assert.deepEqual(rankOf(COST, r.a), { rank: 1, of: 387 });
  assert.deepEqual(rankOf(COST, r.b), { rank: 387, of: 387 });
});

test("countries, currencies and mixed pairs, worked by hand", () => {
  // United States to India: level 0.2378, 83.6693 rupees to the dollar.
  const us = run({ a: "country:USA", b: "country:IND" });
  close(us.needed, 23780, 1e-6);
  close(us.neededLocal, 23780 * 83.6693, 1e-6);              // 1,989,656
  assert.equal(us.parts, null); assert.equal(us.widest, null);
  // India to the United Kingdom, salary typed in rupees: 2,000,000 / 83.6693 dollars, times 0.87261 / 0.2378.
  const ind = run({ a: "country:IND", b: "country:GBR", salary: 2000000, unit: "local" });
  close(ind.salaryUsd, 2000000 / 83.6693, 1e-9);
  close(ind.needed, (2000000 / 83.6693) * (0.87261 / 0.2378), 1e-6);
  close(ind.neededLocal, ind.needed * 0.782415, 1e-6);
  // A metropolitan area against a country: San Francisco at 1.15613, Germany at 0.75934.
  const mixed = run({ b: "country:DEU" });
  close(mixed.needed, 100000 * 0.75934 / 1.15613, 1e-6);
  assert.equal(mixed.parts, null);
  // A country with no usable exchange rate works in dollars only.
  const bgr = run({ a: "country:USA", b: "country:BGR" });
  close(bgr.needed, 42193, 1e-6); assert.equal(bgr.neededLocal, null);
  assert.match(run({ a: "country:BGR", b: "country:USA", unit: "local" }).error, /no usable exchange rate for Bulgaria/);
  assert.match(run({ unit: "local" }).error, /has to be entered in US dollars/);
  // A state against the non-metropolitan portion of the country.
  const rural = run({ a: "state:California", b: "state:United States, non-metropolitan portion" });
  close(rural.needed, 100000 * 88.699 / 110.72, 1e-6);
  assert.equal(rural.widest.key, "housing");
  assert.equal(rankOf(COST, rural.b), null);
  assert.deepEqual(rankOf(COST, rural.a), { rank: 1, of: 51 });
});

/* -------------------------------------------------------------------- edges */

test("the same place twice, equal levels and bad input", () => {
  const same = run({ b: SF });
  assert.equal(same.same, true); close(same.needed, 100000); assert.equal(same.stretch, 0); assert.equal(same.widest, null);
  assert.match(reading(COST, same)[0], /Both places are the San Francisco-Oakland-Fremont, CA metropolitan area, so there is nothing to compare/);
  for (const [over, field] of [[{ salary: 0 }, "salary"], [{ salary: -5 }, "salary"], [{ salary: NaN }, "salary"], [{ salary: 1e308 }, "salary"], [{ salary: Infinity }, "salary"], [{ salary: "100000" }, "salary"], [{ salary: 0.5 }, "salary"],
    [{ a: "metro:Atlantis" }, "a"], [{ b: "country:XXX" }, "b"], [{ b: "planet:Mars" }, "b"], [{ a: undefined }, "a"], [{ unit: "euros" }, "unit"]]) {
    const r = run(over);
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.field, field);
    assert.ok(r.error.length > 15);
    assert.deepEqual(reading(COST, r), [r.error]);
  }
  assert.equal(run({ salary: SALARY.min }).ok, true);
  assert.equal(run({ salary: SALARY.max }).ok, true);
  assert.equal(place(COST, "metro:nowhere"), null);
  assert.deepEqual(places(COST, "planet"), []);
});

test("every pair of kinds gives finite numbers and sentences without holes", () => {
  const sample = [...places(COST, "metro").filter((_, i) => i % 40 === 0), ...places(COST, "state").filter((_, i) => i % 10 === 0), ...places(COST, "country").filter((_, i) => i % 12 === 0)];
  let n = 0;
  for (const A of sample) for (const B of sample) {
    const r = compare(COST, { salary: 54321.5, unit: "usd", a: A.id, b: B.id });
    assert.equal(r.ok, true);
    for (const v of [r.needed, r.realA, r.realB, r.stretch, r.ratio]) assert.ok(Number.isFinite(v) && (v > 0 || v === r.stretch));
    const text = [...reading(COST, r), levelNote(COST, A), levelNote(COST, B)].join(" ");
    assert.doesNotMatch(text, /NaN|undefined|Infinity|null|\$–|  /);
    n++;
  }
  assert.ok(n > 900, `${n} pairs`);
  assert.equal(places(COST, "metro").length, 387);
  assert.equal(places(COST, "state").length, 52);          // 50 states, the District of Columbia, and the non-metropolitan portion
  assert.equal(places(COST, "country").length, 171);
  assert.equal(new Set([...places(COST, "metro"), ...places(COST, "state"), ...places(COST, "country")].map((p) => p.id)).size, 387 + 52 + 171);
  assert.deepEqual(KINDS.map((k) => k.key), ["metro", "state", "country"]);
  assert.deepEqual(PARTS.map((p) => p.key), ["goods", "housing", "utilities", "other"]);
});

/* ------------------------------------------------------------------ wording */

test("the wording in the small cases", () => {
  assert.equal(dollars(72307.61), "$72,300"); assert.equal(dollars(119621.5), "$120,000"); assert.equal(dollars(999.4), "$999"); assert.equal(dollars(12.345), "$12.3");
  assert.equal(units(1989656), "1,990,000"); assert.equal(units(13414305), "13.4m"); assert.equal(dollars(723076100000), "$723bn"); assert.equal(dollars(0.7231), "$0.723");
  assert.equal(asTyped(100000), "100,000"); assert.equal(asTyped(54321.5), "54,321.50");
  assert.equal(against(1.15613), "15.6% above"); assert.equal(against(0.2378), "76.2% below"); assert.equal(against(1), "level with");
  assert.equal(against(1.0002), "a shade above"); assert.equal(against(0.9998), "a shade below");
  assert.equal(moreOrLess(0.298), "29.8% more"); assert.equal(moreOrLess(-0.23), "23.0% less"); assert.equal(moreOrLess(0), "the same"); assert.equal(moreOrLess(0.0001), "very slightly more");
  assert.equal(inWords(place(COST, "country:GBR")), "the United Kingdom");
  assert.equal(inWords(place(COST, "country:IND")), "India");
  assert.equal(inWords(place(COST, "country:DOM")), "the Dominican Republic");
  assert.equal(inWords(place(COST, "state:District of Columbia")), "the District of Columbia");
  assert.equal(inWords(place(COST, JACKSON)), "the Jackson, MS metropolitan area");
  assert.equal(inWords(place(COST, "state:United States, non-metropolitan portion")), "the non-metropolitan portion of the United States");
  // What level each figure is at, said in the tool.
  assert.match(levelNote(COST, place(COST, "country:IND")), /India is a whole country.*city-level price data only for the United States.*every city, town and village in India is treated as one place/);
  assert.match(levelNote(COST, place(COST, "country:BGR")), /amounts are shown in US dollars only/);
  // Neither the District of Columbia nor the non-metropolitan counties is called a state.
  assert.equal(coverage(place(COST, "state:District of Columbia")), "the federal district");
  assert.equal(coverage(place(COST, "state:United States, non-metropolitan portion")), "all non-metropolitan counties");
  assert.equal(coverage(place(COST, "state:Texas")), "a whole state");
  assert.equal(coverage(place(COST, JACKSON)), "a metropolitan area");
  assert.equal(coverage(place(COST, "country:JPN")), "a whole country");
  // Hong Kong, Macao and the West Bank and Gaza are in the World Bank's list but are not countries.
  for (const iso of ["HKG", "MAC", "PSE"]) assert.equal(coverage(place(COST, `country:${iso}`)), "a whole territory");
  assert.match(levelNote(COST, place(COST, "country:PSE")), /^The West Bank and Gaza is a whole territory/);
  assert.match(levelNote(COST, place(COST, "state:District of Columbia")), /^The District of Columbia is the federal district/);
  assert.doesNotMatch(levelNote(COST, place(COST, "state:District of Columbia")), /whole state|countryside/);
  // Two currencies in one sentence are told apart by country.
  assert.equal(currencyOf(place(COST, "country:GBR")), "the currency of the United Kingdom");
  const pounds = reading(COST, run({ a: "country:GBR", b: "country:DEU", salary: 40000, unit: "local" }))[0];
  assert.match(pounds, /A salary of 40,000 in the currency of the United Kingdom \(\$51,100 at the 2024 average exchange rate\) a year in the United Kingdom buys what about \$44,500 a year buys in Germany, or about 41,100 in the currency of Germany/);
  assert.doesNotMatch(pounds, /local currency/);
  // A US place against another country is flagged as a rougher comparison; pairs within one source are not.
  const P = (id) => place(COST, id);
  assert.equal(mixed(P(SF), P("country:JPN")), true);
  assert.equal(mixed(P("country:IND"), P("state:Texas")), true);
  assert.equal(mixed(P(SF), P(MONROE)), false);
  assert.equal(mixed(P("country:IND"), P("country:USA")), false);
  assert.equal(mixed(P("country:USA"), P(SF)), false);
  assert.match(reading(COST, run({ b: "country:JPN" })).at(-1), /^This pair sets one metropolitan area against the average for the whole of Japan.*rougher/);
  assert.match(reading(COST, run({ a: "country:IND", b: "state:Texas" })).at(-1), /^This pair sets one part of the United States against the average for the whole of India/);
  assert.doesNotMatch(reading(COST, run({ a: "country:IND", b: "country:USA" })).join(" "), /This pair sets/);
  assert.match(levelNote(COST, place(COST, SF)), /is a metropolitan area as the US government draws it.*115\.6 \(US average 100\), the dearest of the 387 metropolitan areas/);
  assert.match(levelNote(COST, place(COST, MONROE)), /the cheapest of the 387 metropolitan areas/);
  assert.match(levelNote(COST, place(COST, "metro:Los Angeles-Long Beach-Anaheim, CA")), /3rd dearest of the 387/);
  assert.match(levelNote(COST, place(COST, "state:Mississippi")), /is a whole state, cities and countryside together/);
  assert.match(levelNote(COST, place(COST, "country:USA")), /is the yardstick/);
  // The reading for a pair with a currency, and for a pair where something other than rent differs most.
  assert.match(reading(COST, run({ a: "country:USA", b: "country:IND" }))[0], /buys what about \$23,800 a year buys in India, or about 1,990,000 in the currency of India at the World Bank's 2024 average rate of 83\.67 to the dollar\. India is cheaper: the same pay goes 4\.2 times as far there\./);
  const util = run({ a: "metro:Urban Honolulu, HI", b: "metro:Miami-Fort Lauderdale-West Palm Beach, FL" });
  assert.equal(util.widest.key, "utilities");
  assert.match(reading(COST, util).at(-1), /^Utilities are where the two differ most: utilities cost 48\.1% less in the Miami/);
});

/* -------------------------------------------------------------- the finding */

test("the finding on the page: San Francisco against Monroe, Louisiana", () => {
  const r = run({});
  assert.equal(dollars(r.needed), "$72,300");
  assert.equal(moreOrLess(r.stretch), "38.3% more");
  assert.equal(dollars(r.realA), "$86,500");
  assert.equal(dollars(r.realB), "$120,000");
  const gap = Object.fromEntries(r.parts.map((p) => [p.key, moreOrLess(p.gap)]));
  assert.deepEqual(gap, { goods: "13.6% less", housing: "78.0% less", utilities: "58.2% less", other: "9.9% less" });
  const text = reading(COST, r);
  assert.match(text[0], /A salary of \$100,000 a year in the San Francisco-Oakland-Fremont, CA metropolitan area buys what about \$72,300 a year buys in the Monroe, LA metropolitan area\. The Monroe, LA metropolitan area is cheaper: the same pay goes 38\.3% further there\./);
  assert.match(text[2], /^Rents are where the two differ most: housing costs 78\.0% less in the Monroe, LA metropolitan area than in the San Francisco-Oakland-Fremont, CA metropolitan area, against 13\.6% less for goods, 58\.2% less for utilities and 9\.9% less for other services\.$/);
});
