// Build 365projects/36/data.js: a hedonic regression fitted to flat sales in Paris, 2021 to 2025.
//
//     node scripts/data/paris_flats.mjs [--cache DIR]
//
// Source (downloaded into --cache, never committed):
//   "Demandes de valeurs foncières géolocalisées" (geo-DVF), published on data.gouv.fr by Etalab and derived
//   from the "Demandes de valeurs foncières" (DVF) of the Direction générale des Finances publiques (DGFiP):
//   every property sale registered in France over the last five years, taken from notaries' deeds and the
//   land register. Licence Ouverte / Open Licence 2.0. One file per year for département 75 (Paris):
//   https://files.data.gouv.fr/geo-dvf/latest/csv/<year>/departements/75.csv.gz
//   "latest" is replaced every April and October, so a run without the cache may read a later edition.
//   The edition used was the one online on 11 October 2026 (sales from January 2021 to December 2025).
//
// A file has one row per building or plot in a sale ("mutation"); rows with the same id_mutation are one sale
// and all carry the sale's whole price (valeur_fonciere).
//
// Cleaning rules, applied in this order (the counts are written into the module):
//   1. nature_mutation is "Vente" on every row: an ordinary sale. Exchanges, auctions, expropriations and
//      sales off-plan ("Vente en l'état futur d'achèvement", whose price includes VAT) are left out.
//   2. Every row is a flat ("Appartement") or an outbuilding ("Dépendance"), and there is exactly one flat.
//      Rows that repeat the same flat (same plot, lots, floor area and rooms) count once. Sales that include
//      a house, commercial premises, bare land or more than one flat are left out, because their price cannot
//      be divided between the parts.
//   3. One price on every row, and the commune code is one of 75101 to 75120 (the 20 arrondissements).
//   4. Floor area (surface_reelle_bati) from 9 to 250 m2 and 1 to 8 main rooms (nombre_pieces_principales).
//   5. Price from 3,000 to 30,000 euros per m2. A third of the sales below that are under 100 euros per m2,
//      which is no market price; above it are a few very large prices against small areas.
//      This rule looks at the price, which is what the model predicts, so every error figure describes sales that
//      passed it. To show what that hides, one in five of the sales it removed (the test set's share of the kept
//      sales) are put back beside the test set and the errors worked out again: test.withPriceRuleUndone.
//
// What is kept for each sale: price, floor area, rooms (6, 7 and 8 become "6 or more"), arrondissement,
// outbuildings (the number of different Dépendance rows: 0, 1, or 2 and more) and the half-year of the sale.
// No address, plot or sale identifier goes into the module.
//
// The split. Kept sales are sorted by date, arrondissement, price, area, rooms and outbuildings, then shuffled
// with a seeded generator (mulberry32, seed 36): the first 60% are the training set, the next 20% the
// calibration set, the last 20% the test set.
//
// The model, fitted by ordinary least squares on the training set only:
//   ln(price) = b0 + b1 ln(area / A0) + b2 ln(area / A0)^2 + rooms + arrondissement + half-year + outbuildings
// with one 0/1 column for every level except the reference flat's (A0 m2, 2 rooms, 15th, 1 outbuilding, the
// latest half-year), so exp(b0) is the reference flat's price. The covariance matrix is White's
// heteroskedasticity-consistent estimate with the n / (n - p) factor (HC1). Coefficients are rounded to six
// decimals first, and everything else (calibration quantiles, test results) is computed from the rounded ones,
// so the figures in the module describe exactly the model in the module.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "365projects", "36", "data.js");
const YEARS = [2021, 2022, 2023, 2024, 2025];
const URL_OF = (y) => `https://files.data.gouv.fr/geo-dvf/latest/csv/${y}/departements/75.csv.gz`;
const RULES = { areaMin: 9, areaMax: 250, roomsMin: 1, roomsMax: 8, perM2Min: 3000, perM2Max: 30000 };
const SEED = 36;
const LEVELS = [0.5, 0.8, 0.9, 0.95];

const args = process.argv.slice(2);
const cacheArg = args.indexOf("--cache") >= 0 ? args[args.indexOf("--cache") + 1] : null;
const cache = cacheArg ? resolve(cacheArg) : mkdtempSync(join(tmpdir(), "dvf-"));
mkdirSync(cache, { recursive: true });

async function fetchTo(url, path) {
  if (existsSync(path)) return;
  console.log("downloading", url);
  const res = await fetch(url, { headers: { "User-Agent": "varad-patel-365projects/1.0 (https://varad-patel.github.io)" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); cell = ""; rows.push(row); row = []; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inverse(A) {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error("singular matrix");
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f !== 0) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row) => row.slice(n));
}

/** Linear-interpolated quantile of a sorted array. */
const quantile = (s, q) => { const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
const median = (a) => quantile([...a].sort((x, y) => x - y), 0.5);
const round = (x, d) => Number(x.toFixed(d));

/* ------------------------------------------------------------------ read and clean */

const dropped = { notASale: 0, noFlat: 0, otherProperty: 0, severalFlats: 0, noSinglePrice: 0, notParis: 0, area: 0, rooms: 0, perM2Below: 0, perM2Above: 0 };
let under100PerM2 = 0;   // how many of perM2Below are under 100 euros per m2: not market prices at all
let mutations = 0, rowsRead = 0, firstDate = "9999", lastDate = "0000";
const sales = [];
const pricedOut = [];   // sales that passed every rule but the last: kept aside to show what the price rule does to the error figures
for (const year of YEARS) {
  const path = join(cache, `dvf-${year}-75.csv.gz`);
  await fetchTo(URL_OF(year), path);
  const rows = parseCsv(gunzipSync(readFileSync(path)).toString("utf8"));
  const H = Object.fromEntries(rows[0].map((h, i) => [h, i]));
  const groups = new Map();
  for (const r of rows.slice(1)) {
    if (r.length !== rows[0].length) continue;
    rowsRead++;
    if (!groups.has(r[H.id_mutation])) groups.set(r[H.id_mutation], []);
    groups.get(r[H.id_mutation]).push(r);
  }
  for (const [id, rs] of groups) {
    mutations++;
    if (rs.some((r) => r[H.nature_mutation] !== "Vente")) { dropped.notASale++; continue; }
    const flats = rs.filter((r) => r[H.type_local] === "Appartement");
    if (!flats.length) { dropped.noFlat++; continue; }
    if (rs.some((r) => r[H.type_local] !== "Appartement" && r[H.type_local] !== "Dépendance")) { dropped.otherProperty++; continue; }
    const same = (r) => [r[H.id_parcelle], r[H.lot1_numero], r[H.lot2_numero], r[H.lot3_numero], r[H.lot4_numero], r[H.lot5_numero], r[H.surface_reelle_bati], r[H.nombre_pieces_principales]].join("|");
    if (new Set(flats.map(same)).size !== 1) { dropped.severalFlats++; continue; }
    const f = flats[0];
    if (new Set(rs.map((r) => r[H.valeur_fonciere])).size !== 1 || !(Number(f[H.valeur_fonciere]) > 0)) { dropped.noSinglePrice++; continue; }
    const arr = Number(f[H.code_commune]) - 75100;
    if (!(Number.isInteger(arr) && arr >= 1 && arr <= 20)) { dropped.notParis++; continue; }
    const price = Number(f[H.valeur_fonciere]), area = Number(f[H.surface_reelle_bati]), rooms = Number(f[H.nombre_pieces_principales]);
    if (!(area >= RULES.areaMin && area <= RULES.areaMax)) { dropped.area++; continue; }
    if (!(Number.isInteger(rooms) && rooms >= RULES.roomsMin && rooms <= RULES.roomsMax)) { dropped.rooms++; continue; }
    const out = new Set(rs.filter((r) => r[H.type_local] === "Dépendance").map((r) => [r[H.id_parcelle], r[H.lot1_numero], r[H.lot2_numero], r[H.lot3_numero], r[H.lot4_numero], r[H.lot5_numero]].join("|"))).size;
    const date = f[H.date_mutation];
    const sale = { id, date, period: `${date.slice(0, 4)}H${date.slice(5, 7) <= "06" ? 1 : 2}`, price, area, rooms: Math.min(rooms, 6), arr, out: Math.min(out, 2) };
    if (price / area < RULES.perM2Min) { dropped.perM2Below++; if (price / area < 100) under100PerM2++; pricedOut.push(sale); continue; }
    if (price / area > RULES.perM2Max) { dropped.perM2Above++; pricedOut.push(sale); continue; }
    if (date < firstDate) firstDate = date;
    if (date > lastDate) lastDate = date;
    sales.push(sale);
  }
}

/* --------------------------------------------------------------------------- split */

const inOrder = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.arr - b.arr || a.price - b.price || a.area - b.area || a.rooms - b.rooms || a.out - b.out;
const shuffle = (list, rand) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } };
sales.sort(inOrder);
const rand = mulberry32(SEED);
shuffle(sales, rand);
const nTrain = Math.floor(sales.length * 0.6), nCal = Math.floor(sales.length * 0.2);
const train = sales.slice(0, nTrain), cal = sales.slice(nTrain, nTrain + nCal), test = sales.slice(nTrain + nCal);

/* ----------------------------------------------------------------------------- fit */

const PERIODS = [...new Set(sales.map((s) => s.period))].sort();
const REF = { area: Math.round(median(train.map((s) => s.area))), rooms: 2, arr: 15, out: 1, period: PERIODS.at(-1) };
const TERMS = [
  { name: "intercept" }, { name: "logArea" }, { name: "logArea2" },
  ...[1, 3, 4, 5, 6].map((v) => ({ name: `rooms${v}`, key: "rooms", value: v })),
  ...Array.from({ length: 20 }, (_, i) => i + 1).filter((v) => v !== REF.arr).map((v) => ({ name: `arr${v}`, key: "arr", value: v })),
  ...PERIODS.filter((v) => v !== REF.period).map((v) => ({ name: `period${v}`, key: "period", value: v })),
  ...[0, 2].map((v) => ({ name: `out${v}`, key: "out", value: v })),
];
const P = TERMS.length;
const INDEX = new Map(TERMS.map((t, j) => [t.name, j]));
/** The non-zero columns of a sale's row of the design matrix, as [index, value] pairs. */
function design(s) {
  const d = Math.log(s.area / REF.area);
  const row = [[0, 1], [1, d], [2, d * d]];
  for (const key of ["rooms", "arr", "period", "out"]) if (s[key] !== REF[key]) row.push([INDEX.get(`${key}${s[key]}`), 1]);
  return row;
}
const dot = (row, beta) => { let v = 0; for (const [j, x] of row) v += x * beta[j]; return v; };

const XtX = Array.from({ length: P }, () => new Array(P).fill(0));
const Xty = new Array(P).fill(0);
for (const s of train) {
  const row = design(s), y = Math.log(s.price);
  for (const [a, xa] of row) { Xty[a] += xa * y; for (const [b, xb] of row) XtX[a][b] += xa * xb; }
}
const inv = inverse(XtX);
const beta = inv.map((r) => round(r.reduce((sum, v, j) => sum + v * Xty[j], 0), 6));

// Residuals of the rounded model on the training set: sigma, R squared, the smearing factor and the HC1 "meat".
const meat = Array.from({ length: P }, () => new Array(P).fill(0));
let rss = 0, sumY = 0, smear = 0;
for (const s of train) sumY += Math.log(s.price);
const meanY = sumY / train.length;
let tss = 0;
for (const s of train) {
  const row = design(s), y = Math.log(s.price), e = y - dot(row, beta);
  rss += e * e; tss += (y - meanY) ** 2; smear += Math.exp(e);
  for (const [a, xa] of row) for (const [b, xb] of row) meat[a][b] += e * e * xa * xb;
}
const hc1 = train.length / (train.length - P);
const cov = inv.map((_, a) => inv.map((__, b) => {
  let v = 0;
  for (let i = 0; i < P; i++) { let w = 0; for (let j = 0; j < P; j++) w += meat[i][j] * inv[j][b]; v += inv[a][i] * w; }
  return v * hc1;
}));

/* --------------------------------------------------- calibration and test, with the rounded model */

const predict = (s) => dot(design(s), beta);
const residual = (s) => Math.log(s.price) - predict(s);
// Split-conformal limits: for a level 1 - a, the floor((n + 1) a / 2)-th smallest calibration residual and the
// ceil((n + 1)(1 - a / 2))-th smallest. A new sale drawn like the calibration sales then falls outside with
// probability at most a. The limits are worked out separately for each arrondissement, from that
// arrondissement's calibration sales, because prices are far more scattered in some than in others.
function limits(list) {
  const res = list.map(residual).sort((a, b) => a - b), n = res.length;
  return LEVELS.map((level) => {
    const tail = Math.round((1 - level) * 500);   // a / 2 in thousandths, so the two ranks below are exact whole-number sums
    return [round(res[Math.max(1, Math.floor((n + 1) * tail / 1000)) - 1], 4), round(res[Math.min(n, Math.ceil((n + 1) * (1000 - tail) / 1000)) - 1], 4)];
  });
}
const ARRS = Array.from({ length: 20 }, (_, i) => i + 1);
const pooled = limits(cal);
const byArr = ARRS.map((a) => limits(cal.filter((s) => s.arr === a)));

const group = (list, key) => { const m = new Map(); for (const s of list) { const k = key(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); } return m; };
const perM2 = (list) => median(list.map((s) => s.price / s.area));
const overallPerM2 = perM2(train);
const arrPerM2 = new Map([...group(train, (s) => s.arr)].map(([k, v]) => [k, perM2(v)]));
const cellPerM2 = new Map([...group(train, (s) => `${s.arr}|${s.period}`)].map(([k, v]) => [k, perM2(v)]));
const absPct = (list, f) => list.map((s) => Math.abs(f(s) - s.price) / s.price);
const share = (a, f) => a.filter(f).length / a.length;
const modelErr = absPct(test, (s) => Math.exp(predict(s)));
const testRes = test.map((s) => Math.log(s.price) - predict(s));
const L90 = LEVELS.indexOf(0.9);
// Coverage on the test set of the limits the page uses (each sale judged by its own arrondissement's limits)...
const inside = (s, k) => { const e = residual(s), [lo, hi] = byArr[s.arr - 1][k]; return e >= lo && e <= hi; };
const coverage = (list, k) => share(list, (s) => inside(s, k));
// ...and of one pair of limits for the whole city, to show why that was not used.
const insidePooled = (s, k) => { const e = residual(s); return e >= pooled[k][0] && e <= pooled[k][1]; };
const sorted = (pairs) => pairs.sort((a, b) => a[1] - b[1]);
const byArr90 = sorted(ARRS.map((a) => [a, coverage(test.filter((s) => s.arr === a), L90)]));
const pooledByArr90 = sorted(ARRS.map((a) => [a, share(test.filter((s) => s.arr === a), (s) => insidePooled(s, L90))]));
const TEST = {
  n: test.length,
  medianAbsPct: round(median(modelErr), 4),
  within10: round(share(modelErr, (e) => e <= 0.1), 4),
  within20: round(share(modelErr, (e) => e <= 0.2), 4),
  beyond30: round(share(modelErr, (e) => e > 0.3), 4),
  medianRatio: round(median(test.map((s) => Math.exp(predict(s)) / s.price)), 4),
  r2: round(1 - testRes.reduce((a, e) => a + e * e, 0) / test.reduce((a, s) => a + (Math.log(s.price) - meanY) ** 2, 0), 4),
  shareAboveEstimate: round(share(testRes, (e) => e > 0), 4),
  // Six decimals here, because the page prints the 90% figure to one decimal place and it sits close to a rounding edge.
  coverage: LEVELS.map((_, k) => round(coverage(test, k), 6)),
  coverage90ByRooms: [1, 2, 3, 4, 5, 6].map((r) => round(coverage(test.filter((s) => s.rooms === r), L90), 4)),
  coverage90ByArr: { lowest: [byArr90[0][0], round(byArr90[0][1], 4)], highest: [byArr90.at(-1)[0], round(byArr90.at(-1)[1], 4)] },
  pooledCoverage90ByArr: { lowest: [pooledByArr90[0][0], round(pooledByArr90[0][1], 4)], highest: [pooledByArr90.at(-1)[0], round(pooledByArr90.at(-1)[1], 4)] },
  // Rules with no regression: floor area times a median price per m2 taken from the training set.
  baselines: {
    paris: round(median(absPct(test, (s) => s.area * overallPerM2)), 4),
    arrondissement: round(median(absPct(test, (s) => s.area * arrPerM2.get(s.arr))), 4),
    arrondissementAndPeriod: round(median(absPct(test, (s) => s.area * cellPerM2.get(`${s.arr}|${s.period}`))), 4),
  },
};
// The price rule undone: the test set with one in five of the removed sales beside it (shuffled with their own seed, so
// the split above is exactly what it was). The model, its limits and the table of medians are the ones fitted above.
pricedOut.sort(inOrder);
shuffle(pricedOut, mulberry32(SEED + 1));
const putBack = pricedOut.slice(0, Math.floor(pricedOut.length * 0.2));
const widened = [...test, ...putBack];
const widenedErr = absPct(widened, (s) => Math.exp(predict(s)));
TEST.withPriceRuleUndone = {
  added: putBack.length, n: widened.length,
  // Six decimals for the two medians: they sit close together and the page prints them to one decimal place.
  medianAbsPct: round(median(widenedErr), 6),
  beyond30: round(share(widenedErr, (e) => e > 0.3), 4),
  coverage90: round(coverage(widened, L90), 4),
  arrondissementAndPeriod: round(median(absPct(widened, (s) => s.area * cellPerM2.get(`${s.arr}|${s.period}`))), 6),
};
// Mean log error on the test set by floor-area band: a check that the curve in area is not badly bent.
const bands = [[9, 20], [20, 30], [30, 45], [45, 60], [60, 80], [80, 120], [120, 251]];
TEST.meanLogErrorByArea = bands.map(([lo, hi]) => { const e = test.filter((s) => s.area >= lo && s.area < hi).map((s) => Math.log(s.price) - predict(s)); return [lo, hi === 251 ? 250 : hi, e.length, round(e.reduce((a, b) => a + b, 0) / e.length, 4)]; });

const areaByRooms = [1, 2, 3, 4, 5, 6].map((r) => { const a = train.filter((s) => s.rooms === r).map((s) => s.area).sort((x, y) => x - y); return [r, a.length, Math.round(quantile(a, 0.01)), Math.round(quantile(a, 0.5)), Math.round(quantile(a, 0.99))]; });
const SAMPLE = test.slice(0, 400).map((s) => [s.area, s.rooms, s.arr, s.out, PERIODS.indexOf(s.period), s.price]);

/* --------------------------------------------------------------------------- write */

const MODEL = {
  source: "Demandes de valeurs foncières géolocalisées (Etalab, data.gouv.fr), derived from the DGFiP's Demandes de valeurs foncières",
  licence: "Licence Ouverte / Open Licence 2.0",
  retrieved: "2026-10-11",
  place: "Paris (département 75)",
  firstSale: firstDate, lastSale: lastDate,
  rules: RULES,
  counts: { rows: rowsRead, sales: mutations, kept: sales.length, train: train.length, calibration: cal.length, test: test.length, dropped, under100PerM2 },
  reference: REF,
  periods: PERIODS,
  terms: TERMS.map((t) => t.name),
  beta,
  cov: cov.map((r, a) => r.slice(0, a + 1).map((v) => Number(v.toPrecision(6)))),   // lower triangle, row by row
  sigma: round(Math.sqrt(rss / (train.length - P)), 4),
  r2: round(1 - rss / tss, 4),
  smear: round(smear / train.length, 4),
  intervals: { levels: LEVELS, paris: pooled, byArr },
  calibrationByArr: ARRS.map((a) => cal.filter((s) => s.arr === a).length),
  test: TEST,
  salesByArr: Array.from({ length: 20 }, (_, i) => train.filter((s) => s.arr === i + 1).length),
  medianPerM2ByArr: Array.from({ length: 20 }, (_, i) => Math.round(arrPerM2.get(i + 1))),
  areaByRooms,
  sample: SAMPLE,
};
const lines = Object.entries(MODEL).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`);
const header = `// GENERATED by scripts/data/paris_flats.mjs. Do not edit by hand.
// A hedonic regression fitted to ${train.length.toLocaleString("en-GB")} sales of flats in Paris, ${firstDate} to ${lastDate}.
// Source: Demandes de valeurs foncières géolocalisées (Etalab, data.gouv.fr), derived from the DGFiP's
// Demandes de valeurs foncières. Licence Ouverte / Open Licence 2.0. Retrieved 11 October 2026.
// terms and beta line up; cov is the lower triangle of the HC1 covariance matrix, row by row.
// sample holds 400 sales from the test set: [floor area m2, rooms (6 = 6 or more), arrondissement,
// outbuildings (2 = 2 or more), index into periods, price in euros].
// intervals.byArr[arrondissement - 1][i] is the [low, high] log residual for intervals.levels[i].
`;
writeFileSync(OUT, `${header}export const MODEL = {\n${lines.join("\n")}\n};\n`);
console.log(`wrote ${OUT}: ${sales.length} sales kept of ${mutations}; train ${train.length}, calibration ${cal.length}, test ${test.length}`);
console.log("dropped", JSON.stringify(dropped));
console.log("reference", JSON.stringify(REF), "price", Math.round(Math.exp(beta[0])));
console.log("sigma", MODEL.sigma, "r2", MODEL.r2, "smear", MODEL.smear);
console.log("pooled limits", JSON.stringify(pooled), "calibration sales by arrondissement", JSON.stringify(MODEL.calibrationByArr));
console.log("test", JSON.stringify(TEST));
// Three sales to check against the source files by hand (the ids are printed here only, never written to the module).
for (const s of test.slice(0, 3)) console.log("check", s.id, s.date, s.price, s.area, s.rooms, s.arr, s.out);

