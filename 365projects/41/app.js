// Day 41: Oil Price Shock Economy. Interface.
import { $, el, fmt, mount, slider, select, button, stat, note, table, chart } from "../kit/kit.js";
import { IO } from "./data.js";
import { JUMP_MIN, JUMP_MAX, passThrough, basketAfter, breakdown } from "./logic.js";

mount();

const ALL = 13;                                   // the last position of the rounds slider means "every round"
const START = { jump: 50, rounds: ALL, inside: "basket" };
const state = { ...START, timer: 0 };
const model = passThrough(IO);                    // per unit of the jump; everything shown is this times the jump
const K = model.k;
const others = IO.sectors.map((s, j) => ({ ...s, j })).filter((s) => s.j !== K);
const waves = model.rounds(ALL - 1);              // waves[t - 1]: the rise counted up to round t
const upTo = (rounds) => (rounds >= ALL ? model.perUnit : waves[rounds - 1]);

/* ---------- words and numbers ---------- */
const round2 = (x) => Math.round(x * 100) / 100;
const pp = (frac) => round2(frac * 100);          // a fraction as percentage points, to two places
const signed = (points, d = 2) => `${fmt.signed(points, d)}%`;
const plain = (points, d = 2) => `${fmt.num(Math.abs(points), d)}%`;
const jumpText = (v) => (v === 0 ? "no change" : `${v > 0 ? "+" : "-"}${Math.abs(v)}%`);
const moves = (points) => (points > 0 ? "rises" : points < 0 ? "falls" : "does not change");
const roundsText = (v) => (v >= ALL ? "every round" : v === 1 ? "round 1 only" : `rounds 1 to ${v}`);

/* ---------- controls ---------- */
const jumpSlider = slider({
  label: "Change in the price of oil and gas", min: JUMP_MIN * 100, max: JUMP_MAX * 100, step: 5, value: state.jump, format: jumpText,
  hint: "Applied to everything the oil and gas extraction industry sells: crude oil and natural gas together, and the tenth of its output that BEA classes as petroleum products.",
  onInput: (v) => { state.jump = v; update(); },
});
const jumpRow = el("div", { class: "row", role: "group", "aria-label": "Example price changes" },
  [[10, "+10%"], [50, "+50%"], [100, "Doubles"], [-30, "Falls 30%"]].map(([v, label]) => button(label, () => { state.jump = v; jumpSlider.value = v; update(); }, { small: true })));

const roundSlider = slider({
  label: "Rounds counted", min: 1, max: ALL, step: 1, value: state.rounds, format: (v) => (v >= ALL ? "all" : String(v)),
  hint: "Round 1 is what a sector buys from the oil and gas industry itself. Round 2 is what its suppliers bought from that industry, round 3 their suppliers', and so on.",
  onInput: (v) => { stopPlay(); state.rounds = v; update(); },
});
const playBtn = button("Play the rounds", () => {
  if (state.timer) return stopPlay();
  state.rounds = 1; roundSlider.value = 1; update();
  playBtn.textContent = "Stop";
  state.timer = setInterval(() => {
    if (state.rounds >= ALL) return stopPlay();
    state.rounds++; roundSlider.value = state.rounds; update();
  }, 900);
}, { small: true });
function stopPlay() {
  if (!state.timer) return;
  clearInterval(state.timer);
  state.timer = 0;
  playBtn.textContent = "Play the rounds";
  update();                                       // the sentence that is read out waits until the play has stopped
}

const insideSelect = select({
  label: "Look inside", value: state.inside,
  options: [{ value: "basket", label: "The household basket" }, ...others.map((s) => ({ value: s.id, label: s.name }))],
  onChange: (v) => { state.inside = v; update(); },
});

const controls = el("div", { class: "controls" },
  jumpSlider.el, jumpRow, roundSlider.el, el("div", { class: "row" }, playBtn),
  el("div", { class: "row" }, button("Reset", () => {
    stopPlay();
    Object.assign(state, START);
    jumpSlider.value = state.jump; roundSlider.value = state.rounds; insideSelect.value = state.inside;
    update();
  }, { small: true })));
const assumptions = note("", el("strong", { text: "What the model assumes. " }), "Every industry keeps buying the same inputs per unit of output, passes the whole of any rise in its costs on in its price, and pays the same wages and profits per unit as before. Nobody buys less of anything. An imported good moves in price with the same good made at home; imports with no American equivalent, scrap and second-hand goods keep their prices. The table is the United States in 2023.");

/* ---------- outputs ---------- */
const sBasket = stat("Household basket"), sTop = stat("Moves most"), sLate = stat("Arrives after round 1"), sSmall = stat("Sectors moving under 1%");
// Which BEA industries are in each sector, straight from the data module.
const sectorList = el("details", { class: "chart-table" },
  el("summary", { text: "The 21 sectors and the BEA industries in each" }),
  table({
    columns: [{ key: "name", label: "Sector" }, { key: "members", label: "BEA summary industries" }],
    rows: IO.sectors.map((s) => ({ name: s.name, members: s.members.map((m, i) => `${m} (${s.bea[i]})`).join("; ") })),
  }));
const status = el("div", { role: "status" });
const rankBox = el("div", { class: "rank" }), spreadBox = el("div"), insideBox = el("div");
const out = el("div", { class: "out" },
  el("div", { class: "stats" }, sBasket.el, sTop.el, sLate.el, sSmall.el),
  status,
  el("h2", { text: "Which sectors are hit hardest" }), rankBox, assumptions,
  el("h2", { text: "How it spreads" }), spreadBox,
  // The choice sits between the two things it changes: a line on the chart above and the table below.
  el("h2", { text: "Where a change comes from" }), el("div", { class: "inside-pick" }, insideSelect.el), insideBox,
  el("p", { class: "small muted", text: `Data: U.S. Bureau of Economic Analysis, input-output accounts for ${IO.year} (make and use tables after redefinitions, 71 industries added up into 21 sectors). Public domain. Retrieved ${fmt.date(IO.source.retrieved)}.` }),
  sectorList);

$("#app").append(el("div", { class: "tool-grid" }, controls, out));
const spreadChart = chart(spreadBox, { series: [], height: 300 });

/* ---------- drawing ---------- */
function drawRanking(j100) {
  const now = upTo(state.rounds);
  const rows = others.map((s) => {
    const total = pp(j100 * now[s.j]), direct = pp(j100 * model.direct[s.j]);
    return { ...s, total, direct, indirect: round2(total - direct), final: pp(j100 * model.perUnit[s.j]) };
  }).sort((a, b) => model.perUnit[b.j] - model.perUnit[a.j]);        // the order does not depend on the size of the jump
  // The bars share one scale set by the second-largest final move: refineries would flatten everything else.
  const scale = Math.max(1e-9, Math.abs(rows[1].final));
  const cut = Math.abs(rows[0].final) > scale * 1.0001;
  const legend = el("div", { class: "chart-legend" },
    el("span", {}, el("i", { class: "bar-direct" }), "Direct: bought from the oil and gas industry itself (round 1)"),
    el("span", {}, el("i", { class: "bar-indirect" }), state.rounds >= ALL ? "Indirect: carried in by other inputs (later rounds)" : state.rounds === 1 ? "Indirect: carried in by other inputs, none counted yet" : state.rounds === 2 ? "Indirect: carried in by other inputs (round 2)" : `Indirect: carried in by other inputs (rounds 2 to ${state.rounds})`));
  const list = el("ol", { class: "rank-list" }, rows.map((r, i) => {
    const w = (v) => `${Math.min(100, (Math.abs(v) / scale) * 100)}%`;
    const over = i === 0 && cut;
    const detail = `direct ${fmt.num(r.direct, 2)}%, indirect ${fmt.num(r.indirect, 2)}%`;
    return el("li", {},
      el("span", { class: "rank-name", text: r.name }),
      el("span", { class: "rank-track", "aria-hidden": "true" },
        // A bar too long for the scale is drawn full width, split in proportion, with a break mark.
        el("span", { class: "bar-direct", style: { width: over ? `${(Math.abs(r.direct) / Math.max(1e-9, Math.abs(r.total))) * 100}%` : w(r.direct) } }),
        el("span", { class: "bar-indirect", style: { width: over ? `${(Math.abs(r.indirect) / Math.max(1e-9, Math.abs(r.total))) * 100}%` : w(r.indirect) } }),
        over ? el("span", { class: "bar-cut" }) : null),
      el("span", { class: "rank-val" }, el("strong", { text: signed(r.total) }), el("span", { class: "small muted", text: ` ${detail}${over ? "; bar cut short" : ""}` })));
  }));
  const capped = cut ? `The bar for ${rows[0].name.toLowerCase()} is cut short: at full length it would be ${fmt.num(Math.abs(rows[0].final) / scale, 1)} times the width of the next one.` : "";
  const partial = state.rounds < ALL ? ` Counting ${roundsText(state.rounds)}.` : "";
  rankBox.replaceChildren(legend, list, el("p", { class: "small muted", text: `Change in each sector's price, in percent. ${capped}${partial}`.trim() }));
  return rows;
}

function drawSpread() {
  // Share of each final move that has arrived by each round. It does not depend on the size of the jump.
  const lines = [["basket", "Household basket", "#16233b"], ["petroleum", null, 0], ["air", null, 1], ["plastics", null, 2]];
  if (state.inside !== "basket" && !lines.some(([id]) => id === state.inside)) lines.push([state.inside, null, 3]);
  const series = lines.map(([id, name, color]) => {
    const j = IO.sectors.findIndex((s) => s.id === id);
    const share = (t) => (id === "basket" ? basketAfter(model, waves[t]) / model.basket : waves[t][j] / model.perUnit[j]);
    return { name: name || IO.sectors[j].name, type: "line", color, width: id === "basket" ? 2.5 : 2, data: waves.slice(0, 10).map((_, t) => [t + 1, share(t)]) };
  });
  spreadChart.update({
    title: "Share of the final change that has arrived after each round",
    subtitle: "Refineries buy oil and gas themselves, so nearly all of their rise comes at once. An airline buys jet fuel, so most of its rise waits for round 2.",
    label: "Line chart of the share of the final price change reached after each round, for the household basket and selected sectors",
    x: { label: "Rounds counted", domain: [1, 10], ticks: 9, format: (v) => (Number.isInteger(v) ? String(v) : "") },
    y: { label: "Share of the final change", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
    series,
    marks: state.rounds < ALL && state.rounds <= 10 ? [{ type: "vline", x: state.rounds, text: `Round ${state.rounds}` }] : [],
  });
}

function drawInside(j100) {
  const basket = state.inside === "basket";
  const j = IO.sectors.findIndex((s) => s.id === state.inside);
  const name = basket ? "The household basket" : IO.sectors[j].name;
  const b = breakdown(model, IO, basket ? null : j, j100);
  const share = (v) => `${fmt.num(v, 1)}%`;
  const fixedName = { valueAdded: "Wages, profits and taxes (price unchanged)", outside: "Scrap, second-hand goods and imports with no American equivalent (price unchanged)" };
  const rows = [
    ...b.parts.map((p) => ({ what: p.name, share: share(p.share), rise: signed(p.rise), points: fmt.signed(p.points, 2) })),
    { what: basket ? "Everything else households buy" : "All its other inputs", share: share(b.rest.share), rise: "", points: fmt.signed(b.rest.points, 2) },
    ...b.fixed.map((f) => ({ what: fixedName[f.id], share: share(f.share), rise: signed(0), points: fmt.signed(0, 2) })),
    { what: "Total", share: share(100), rise: "", points: fmt.signed(b.total, 2) },
  ];
  const sector = basket ? null : IO.sectors[j];
  // What the row "Oil and gas extraction" holds. The industry also makes petroleum products, and the table gives it
  // that share of every buyer's purchases of them, so a sector can buy from it without buying any crude oil or gas.
  const made = IO.detail.oilIndustryMakes, slice = fmt.pct(made.petroleumProducts / IO.detail.petroleumProductsMade, 1);
  const usd = (millions) => `$${fmt.int(millions)} million`;
  const oilRow = basket
    ? (IO.detail.householdOilGas === 0 ? ` Households buy no crude oil or natural gas themselves. The share shown against oil and gas extraction is that industry's ${slice} of the petroleum products they buy.` : "")
    : IO.oilGasCommodity[j] === 0
      ? ` BEA's use table records this sector buying no crude oil or natural gas. What is shown against oil and gas extraction is that industry's ${slice} of the petroleum products the sector buys.`
      : ` BEA's use table records this sector buying ${usd(IO.oilGasCommodity[j])} of crude oil and natural gas in ${IO.year}. The table here has it buying ${usd(IO.flows[K][j])} from oil and gas extraction, because that industry is also credited with ${slice} of the petroleum products the sector buys.`;
  insideBox.replaceChildren(
    el("p", { class: "small muted", text: (basket
      ? "Each product's share of household spending times the change in its price. Shares are of personal consumption at producers' prices, so the shop's margin on a litre of petrol sits under trade, not under petroleum products."
      : `Each input's share of the sector's costs times the change in that input's price. ${sector.note}`.trim()) + oilRow }),
    table({
      caption: `${name}: ${state.jump === 0 ? "no change" : `a ${Math.abs(state.jump)}% ${state.jump > 0 ? "rise" : "fall"}`} in the price of oil and gas, every round counted`,
      columns: [
        { key: "what", label: basket ? "Product" : "Input" },
        { key: "share", label: basket ? "Share of spending" : "Share of costs", num: true },
        { key: "rise", label: "Its price", num: true },
        { key: "points", label: "Points added", num: true },
      ],
      rows,
    }));
}

function update() {
  const j100 = state.jump / 100;
  const rows = drawRanking(j100);
  drawSpread();
  drawInside(j100);

  const now = upTo(state.rounds);
  const basketNow = pp(j100 * basketAfter(model, now)), basketFinal = pp(j100 * model.basket);
  const top = rows[0];
  const late = 1 - basketAfter(model, waves[0]) / model.basket;
  const small = rows.filter((r) => Math.abs(r.final) < 1).length;
  sBasket.set(signed(basketNow), state.rounds < ALL ? `counting ${roundsText(state.rounds)}; ${signed(basketFinal)} in the end` : "what households pay for everything they buy");
  if (state.jump === 0) { sTop.set("–", "nothing moves"); sLate.set("–", "there is no change to spread"); }
  else {
    sTop.set(signed(top.total), top.name);
    sLate.set(fmt.pct(late, 0), "of the basket's change is indirect, carried in by suppliers' prices");
  }
  sSmall.set(`${small} of ${rows.length}`, "once every round is counted");
  // The sentence always matches the figures on screen. While the rounds are playing it changes every second,
  // so it is not read out until the play has stopped.
  status.setAttribute("aria-live", state.timer ? "off" : "polite");
  const what = state.jump === 0 ? "With no change in the price of oil and gas, no other price changes."
    : `A ${Math.abs(state.jump)}% ${state.jump > 0 ? "rise" : "fall"} in the price of oil and gas ${state.jump > 0 ? "raises" : "lowers"} the price of ${top.name.toLowerCase()} by ${plain(top.final)} and of the household basket by ${plain(basketFinal)}, once every round is counted.`;
  const sofar = state.jump !== 0 && state.rounds < ALL ? ` Counting ${roundsText(state.rounds)}, the basket ${moves(basketNow)} by ${plain(basketNow)}, which is ${fmt.pct(basketAfter(model, now) / model.basket, 0)} of its final change.` : "";
  status.replaceChildren(note("", what + sofar));
}

update();
