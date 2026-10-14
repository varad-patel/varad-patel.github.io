// Day 62: Random Walk versus Reality. Interface.
import { $, el, fmt, mount, select, checkbox, stat, note, chart, button, rng } from "../kit/kit.js";
import { TSX } from "./data.js";
import { QS, ALPHA, smmCritical, testWalk, vrCurve, simulateWalk, chanceLimit, monthLabel, lastKey, span } from "./logic.js";

mount();

const byId = (id) => TSX.series.find((s) => s.id === id);
const yearOf = (key) => Number(key.slice(0, 4));
const CRITICAL = smmCritical(ALPHA, QS.length);
const pFmt = (p) => (p < 0.001 ? "below 0.001" : fmt.num(p, 3));
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
const ORDER = TSX.series.map((s) => s.id); // the data script's order: the broad indices, then the old TSE sectors, then the S&P/TSX sectors

const state = { id: "composite", from: 1956, to: 2023 };

/* ---------- controls ---------- */
const seriesSel = select({
  label: "Index", value: state.id,
  options: ORDER.map((id) => { const s = byId(id); return { value: id, label: `${s.short} (${yearOf(s.start)} to ${yearOf(lastKey(s))})` }; }),
  hint: "Statistics Canada publishes these month-end closes of Toronto indices under an open licence. No prices of individual shares could be found on such terms, so the list holds indices only.",
  onChange: (v) => { state.id = v; const s = byId(v); state.from = yearOf(s.start); state.to = yearOf(lastKey(s)); fillYears(); update(); },
});
const fromSel = select({ label: "From", options: [], onChange: (v) => { state.from = Number(v); update(); } });
const toSel = select({ label: "to", options: [], onChange: (v) => { state.to = Number(v); update(); } });
const yearsHint = el("div", { class: "hint", text: "Changing the years and keeping the span that gives a verdict you like is a search, and its p-value no longer means what it says." });
function fillYears() {
  const s = byId(state.id);
  const years = Array.from({ length: yearOf(lastKey(s)) - yearOf(s.start) + 1 }, (_, i) => yearOf(s.start) + i);
  for (const sel of [fromSel, toSel]) sel.input.replaceChildren(...years.map((y) => el("option", { value: y, text: String(y) })));
  fromSel.value = state.from; toSel.value = state.to;
}
const about = el("div", { class: "hint source-note" });
const controls = el("div", { class: "controls" }, seriesSel.el, el("div", { class: "field" }, el("div", { class: "rw62-years" }, fromSel.el, toSel.el), yearsHint), about);

/* ---------- outputs ---------- */
const verdictBox = el("div");
const status = el("p", { class: "sr-only", role: "status" });
const tiles = el("div", { class: "stats" });
const tableBox = el("div", { class: "rw62-tbl" });
const vrBox = el("div"), priceBox = el("div");
const advice = el("p", { class: "small muted", text: "A test of a statistical pattern in an index's past, not investment advice: a verdict here is not a reason to buy or sell anything." });

const simHead = el("h2", { text: "Test the test: run it on random walks" });
const simIntro = el("p", { class: "small" });
const spells = checkbox({ label: "Give the simulated changes calm and stormy spells, as real markets have", checked: false });
const simButton = button("Run 1,000 simulated random walks", () => runSim(), { primary: true });
const simStop = button("Stop", () => { simJob++; simProgress.textContent = "Stopped."; simStatus.textContent = "Stopped."; simButton.disabled = false; simStop.disabled = true; simButton.focus(); }, { small: true });
simStop.disabled = true;
// Progress changes every slice, so it is not a live region; simStatus announces the start and the result once.
const simProgress = el("p", { class: "small muted" });
const simStatus = el("p", { class: "sr-only", role: "status" });
const simResult = el("div");

const scanHead = el("h2", { text: "Every index in the list" });
const scanSummary = el("div");
const scanBox = el("div", { class: "rw62-tbl" });

const out = el("div", { class: "out" }, verdictBox, status, tiles, advice, tableBox, vrBox, priceBox,
  el("div", { class: "panel rw62-stack" }, simHead, simIntro, spells.el, el("div", { class: "row" }, simButton, simStop), simProgress, simStatus, simResult),
  el("div", { class: "panel rw62-stack" }, scanHead, scanSummary, el("details", { class: "chart-table" }, el("summary", { text: `Show the table for all ${TSX.series.length} indices` }), scanBox)));
$("#app").append(el("div", { class: "tool-grid" }, controls, out));

const vrChart = chart(vrBox, { series: [], height: 300 });
const priceChart = chart(priceBox, { series: [], height: 280 });

// A table that turns into a list of labelled lines when its box is narrow (see the page's <style>).
function listTable({ caption, columns, rows }) {
  return el("table", { class: "tbl rw62-rt" },
    el("caption", { text: caption }),
    el("thead", {}, el("tr", {}, columns.map((c) => el("th", { scope: "col", class: c.num ? "num" : null, text: c.label })))),
    el("tbody", {}, rows.map((r) => el("tr", {},
      columns.map((c, k) => el(k === 0 ? "th" : "td", { scope: k === 0 ? "row" : null, class: c.num ? "num" : null, "data-label": k === 0 ? null : c.label, text: c.get(r) }))))));
}

/** The verdict in words. Returns { kind, head, text }. */
function describe(t, name, spanText) {
  const j = t.joint;
  const at = t.ratios.find((r) => r.q === j.at);
  const lone = t.ratios.filter((r) => r.pZStar < ALPHA);
  const zText = `z*(${j.at}) = ${fmt.signed(at.zStar, 2)}`;
  if (j.reject) {
    return {
      kind: "bad",
      head: "Not a random walk, at the 5% level",
      text: `${name}, ${spanText}: the largest of the four robust statistics, ${zText}, is beyond the critical value ±${fmt.num(CRITICAL, 2)} for four horizons tested together (joint p = ${pFmt(j.p)}). `
        + (j.direction === "continue"
          ? `VR(${j.at}) = ${fmt.num(at.vr, 3)} is above 1: the ${j.at}-month changes varied more than ${j.at} one-month changes would, so moves tended to continue in the same direction.`
          : `VR(${j.at}) = ${fmt.num(at.vr, 3)} is below 1: the ${j.at}-month changes varied less than ${j.at} one-month changes would, so moves tended to reverse.`),
    };
  }
  return {
    kind: "good",
    head: "Consistent with a random walk, at the 5% level",
    text: `${name}, ${spanText}: the largest of the four robust statistics, ${zText}, is inside the critical value ±${fmt.num(CRITICAL, 2)} for four horizons tested together (joint p = ${pFmt(j.p)}), so the test finds no departure from a random walk. That is not proof of one: a weak pattern can go undetected.`
      + (lone.length ? ` On its own, the ${lone.map((r) => `${r.q}-month`).join(" and ")} ${lone.length === 1 ? "ratio would" : "ratios would"} have been called significant (p = ${lone.map((r) => pFmt(r.pZStar)).join(" and ")}). Testing four horizons gives four chances of a fluke, which is why the joint test asks for more.` : ""),
  };
}

let current = null;
let simJob = 0;
function update() {
  const s = byId(state.id);
  about.replaceChildren(el("strong", { text: `${s.short}. ` }), `Statistics Canada's series "${s.name}", month-end close, ${monthLabel(s.start, 0, false)} to ${monthLabel(lastKey(s) + "", 0, false)}. `,
    `${TSX.source.notice} The index belongs to S&P Dow Jones Indices and TMX Group. Retrieved ${fmt.date(TSX.retrieved)}.`);
  current = null;
  simJob++; // a simulation still running belongs to the old choice: drop it
  simResult.replaceChildren(); simProgress.textContent = ""; simStatus.textContent = ""; simStop.disabled = true;
  if (state.from > state.to) {
    verdictBox.replaceChildren(note("bad", `The first year (${state.from}) is after the last (${state.to}). Choose a first year no later than the last.`));
    status.textContent = ""; tiles.replaceChildren(); tableBox.replaceChildren(); vrBox.hidden = true; priceBox.hidden = true; simButton.disabled = true;
    return;
  }
  const sp = span(s, state.from, state.to);
  const t = testWalk(sp.p);
  const spanText = `${monthLabel(s.start, sp.first, false)} to ${monthLabel(s.start, sp.last, false)}`;
  if (t.error) {
    verdictBox.replaceChildren(note("warn", t.error));
    status.textContent = t.error; tiles.replaceChildren(); tableBox.replaceChildren(); vrBox.hidden = true; priceBox.hidden = true; simButton.disabled = true;
    return;
  }
  current = { s, sp, t };
  simButton.disabled = false;
  const d = describe(t, s.short, spanText);
  verdictBox.replaceChildren(note(d.kind, el("strong", { class: "rw62-verdict", text: d.head }), el("br"), d.text));
  status.textContent = `${d.head}. ${d.text}`;

  const two = t.ratios[0];
  tiles.replaceChildren(...[
    stat("Monthly changes", fmt.int(t.N), spanText),
    stat("VR(2)", fmt.num(two.vr, 3), "1 for a random walk"),
    stat("Largest |z*|", fmt.num(t.joint.maxAbs, 2), `at ${t.joint.at} months; critical value ${fmt.num(CRITICAL, 2)}`),
    stat("Joint p-value", pFmt(t.joint.p), `Chow–Denning, four horizons`),
  ].map((x) => x.el));

  tableBox.replaceChildren(listTable({
    caption: `The variance ratio at each horizon, ${spanText}`,
    columns: [
      { label: "Horizon q", get: (r) => `${r.q} months` },
      { label: "VR(q)", get: (r) => fmt.num(r.vr, 3), num: true },
      { label: "z (equal variance)", get: (r) => fmt.signed(r.z, 2), num: true },
      { label: "p", get: (r) => pFmt(r.pZ), num: true },
      { label: "z* (robust)", get: (r) => fmt.signed(r.zStar, 2), num: true },
      { label: "p*", get: (r) => pFmt(r.pZStar), num: true },
    ],
    rows: t.ratios,
  }));
  const iid = t.jointIid;
  tableBox.append(el("p", { class: "small muted", text: `The verdict uses z*, which allows the size of monthly moves to change over time. With z, which assumes it never does, the joint test would ${iid.reject ? "reject" : "not reject"} a random walk (largest |z| = ${fmt.num(iid.maxAbs, 2)}).` }));

  const curve = vrCurve(sp.p, 24);
  vrBox.hidden = false;
  vrChart.update({
    title: "Variance ratio by horizon",
    subtitle: "The variance of q-month changes divided by q times the variance of one-month changes. A random walk gives 1 at every horizon. The band is the range a random walk would stay inside 95% of the time at each horizon taken alone.",
    label: `Line chart of the variance ratio of ${s.short} for horizons of 1 to ${curve.length} months, with a 95% band around 1`,
    x: { label: "Horizon q, months", domain: [1, curve[curve.length - 1].q], format: (v) => fmt.int(v) },
    y: { label: "VR(q)", format: (v) => fmt.num(v, 2) },
    series: [
      { name: "95% band for a random walk", type: "range", data: curve.map((c) => [c.q, c.lo, c.hi]), color: "#8a94a3", opacity: 0.25 },
      { name: "Variance ratio", type: "line", data: curve.map((c) => [c.q, c.vr]), color: 0 },
      { name: "Horizons tested", type: "scatter", data: t.ratios.map((r) => ({ x: r.q, y: r.vr, label: `VR(${r.q})` })), color: 0, r: 5 },
    ],
    marks: [{ type: "hline", y: 1, text: "Random walk" }],
  });
  priceBox.hidden = false;
  priceChart.update({
    title: `${s.short}: month-end close`,
    subtitle: "Index points, on a log scale so that equal percentage moves look the same size.",
    label: `Line chart of the month-end close of ${s.short}, ${spanText}`,
    x: { label: "Month", format: (v) => String(Math.floor(v)) },
    y: { label: "Index points (log scale)", type: "log", format: (v) => fmt.sig(v, 3) },
    series: [{ name: s.short, type: "line", data: Array.from(sp.p, (v, i) => { const k = sp.first + i; const [y, m] = s.start.split("-").map(Number); return [y + (m - 1 + k) / 12, Math.exp(v)]; }), color: 0, width: 1.5 }],
  });

  simIntro.textContent = `A random walk built to match this index: ${fmt.int(t.N)} monthly changes, independent, with the same standard deviation (${fmt.num(Math.sqrt(sdOf(sp.p)) * 100, 1)}% a month). Run the same joint test on 1,000 of them. At the 5% level it should wrongly reject a random walk about 50 times, or fewer, since the joint test errs on the cautious side.`;
}

const sdOf = (p) => { const N = p.length - 1, mu = (p[N] - p[0]) / N; let s = 0; for (let k = 1; k <= N; k++) s += (p[k] - p[k - 1] - mu) ** 2; return s / (N - 1); };

/* ---------- the simulation, in slices ---------- */
function runSim() {
  if (!current) return;
  const id = ++simJob;
  const { t, sp } = current;
  const N = t.N, sd = Math.sqrt(sdOf(sp.p)), reps = 1000, withSpells = spells.checked;
  const rand = rng(62);
  let done = 0, robust = 0, iid = 0;
  const fromRun = document.activeElement === simButton;
  simButton.disabled = true; simStop.disabled = false;
  if (fromRun) simStop.focus(); // a disabled button drops focus to the page: hand it to Stop instead
  simResult.replaceChildren();
  const slice = () => {
    if (id !== simJob) return;
    const t0 = performance.now();
    while (done < reps && performance.now() - t0 < 25) {
      const r = testWalk(simulateWalk(N, sd, rand, { spells: withSpells }));
      if (r.joint.reject) robust++;
      if (r.jointIid.reject) iid++;
      done++;
    }
    if (done < reps) { simProgress.textContent = `Simulating: ${fmt.int(done)} of ${fmt.int(reps)} random walks.`; setTimeout(slice, 0); return; }
    const hadFocus = [simStop, simButton, document.body].includes(document.activeElement);
    simButton.disabled = false; simStop.disabled = true;
    simProgress.textContent = `Done: ${fmt.int(reps)} random walks${withSpells ? " with calm and stormy spells" : ""}.`;
    // Verdicts against the most a true 5% test would reach by chance in 1,000 tries (64), not a rule of thumb.
    const limit = chanceLimit(reps), over = (k) => k > limit;
    const verdictText = over(robust)
      ? `The test on z* also rejected more than ${limit} of ${fmt.int(reps)}, which a test that truly errs 5% of the time would do only about 2% of the time. With ${plural(N, "monthly change", "monthly changes")} the large-sample approximation behind it is poor, so treat a verdict on these years with caution.`
      : over(iid)
        ? `The test on z rejected more than ${limit} of ${fmt.int(reps)}, which a test that truly errs 5% of the time would do only about 2% of the time, and the test on z* did not: that is why the verdict uses z*.`
        : `Both stayed within what a test that truly errs 5% of the time would give by chance (at most ${limit} of ${fmt.int(reps)}).${withSpells ? "" : " Tick the box above to give the moves spells and run it again."}`;
    simResult.replaceChildren(note(over(robust) || over(iid) ? "warn" : "",
      `The joint test on z* wrongly rejected ${plural(robust, "random walk", "random walks")} of ${fmt.int(reps)} (${fmt.pct(robust / reps, 1)}). `
      + `The same test on z, which assumes moves of a constant size, rejected ${fmt.int(iid)} (${fmt.pct(iid / reps, 1)}). `
      + verdictText + " The simulations use a fixed seed, so a rerun gives the same counts."));
    simStatus.textContent = `Done. The joint test on z* wrongly rejected ${fmt.int(robust)} of ${fmt.int(reps)} random walks, the test on z ${fmt.int(iid)}. ${verdictText}`;
    if (hadFocus) simButton.focus(); // the Stop button the visitor may be on has just been switched off
  };
  simProgress.textContent = `Simulating: 0 of ${fmt.int(reps)} random walks.`;
  simStatus.textContent = `Simulating ${fmt.int(reps)} random walks.`;
  setTimeout(slice, 0);
}

/* ---------- every index over its whole history ---------- */
function showScan() {
  const all = ORDER.map((id) => { const s = byId(id); const sp = span(s, 0, 9999); return { s, t: testWalk(sp.p) }; });
  const n = all.length;
  const rejected = all.filter((x) => x.t.joint.reject);
  const bonferroni = all.filter((x) => x.t.joint.p < ALPHA / n);
  scanSummary.replaceChildren(note("",
    `Each index over its whole history: ${fmt.int(rejected.length)} of the ${n} ${rejected.length === 1 ? "rejects" : "reject"} a random walk at the 5% level${rejected.length ? ` (${rejected.map((x) => x.s.short).join(", ")})` : ""}. `
    + `If every one were a random walk, about one (${n} × 0.05 = ${fmt.num(n * ALPHA, 2)}) would still be expected to reject by chance, and more than that would not be surprising, because the sector indices share shares with the broad ones and move together. `
    + `Asking each to pass at 5% divided by ${n} (Bonferroni's correction for ${n} tests) leaves ${bonferroni.length ? plural(bonferroni.length, "index", "indices") : "none"}.`));
  scanBox.replaceChildren(listTable({
    caption: "The joint variance-ratio test for every index in the list, over all of its months",
    columns: [
      { label: "Index", get: (x) => x.s.short },
      { label: "Months", get: (x) => `${yearOf(x.s.start)} to ${yearOf(lastKey(x.s))}` },
      { label: "VR(2)", get: (x) => fmt.num(x.t.ratios[0].vr, 3), num: true },
      { label: "Largest |z*|", get: (x) => `${fmt.num(x.t.joint.maxAbs, 2)} (${x.t.joint.at} months)`, num: true },
      { label: "Joint p", get: (x) => pFmt(x.t.joint.p), num: true },
      { label: "Verdict", get: (x) => (x.t.joint.reject ? `Not a random walk (moves ${x.t.joint.direction === "continue" ? "continue" : "reverse"})` : "Consistent with a random walk") },
    ],
    rows: all,
  }));
}

fillYears();
update();
setTimeout(showScan, 0);
