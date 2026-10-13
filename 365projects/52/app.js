// Day 52: Auction Simulator. Interface.
import { $, el, fmt, mount, slider, select, segmented, textField, numberField, button, stat, note, table, chart, ticker, debounce, randomSeed, reducedMotion } from "../kit/kit.js";
import {
  TOP, CENT, FORMATS, formatOf, eqBid, expectedPayoff, eqExpectedPayoff, expectedRevenue, asymmetricRevenue,
  parseBid, deal, playRound, summarise, labProblem, createLab, labVerdict, LAB_LIMITS,
} from "./logic.js";

mount();

const money = (cents) => fmt.num(cents / CENT, 2);          // hundredths to "62.40"
const m2 = (x) => fmt.num(x, 2);
const plural = (k, one, many = `${one}s`) => `${fmt.int(k)} ${k === 1 ? one : many}`;
const SHORT = Object.fromEntries(FORMATS.map((f) => [f.key, f.short]));
const SPEEDS = { slow: 4, normal: 8, fast: 16 };            // clock speed, in units of money a second
const GUARD = 400;                                           // milliseconds in which a repeated press is taken for a slip

/** Mark each cell with its column name so that a wide table can be shown as a list on a phone. */
function stacked(wrap) {
  const heads = [...wrap.querySelectorAll("thead th")].map((th) => th.textContent);
  for (const tr of wrap.querySelectorAll("tbody tr")) [...tr.children].forEach((td, i) => td.setAttribute("data-label", heads[i] ?? ""));
  wrap.classList.add("stack");
  return wrap;
}

/* =========================================================================== part 1: the live auctions */

const game = { format: "first", n: 4, seed: 52, round: 1, phase: "bid", history: [], last: null, clock: null, speed: "normal" };

const formatSel = select({
  label: "Auction format", value: game.format,
  options: FORMATS.map((f) => ({ value: f.key, label: f.label })),
  // A round that has been started or settled has shown something about the rivals, so it is not played again.
  onChange: (v) => { stopClock(); if (game.phase !== "bid") game.round++; game.format = v; game.phase = "bid"; game.last = null; drawGame(); drawSession(); },
});
const nSlider = slider({
  label: "Bidders, counting you", min: 2, max: 8, step: 1, value: game.n, format: (v) => `${v} (${plural(v - 1, "rival")})`,
  hint: "Changing this starts the session again: the same seed deals the same values to you.",
  onInput: (v) => { game.n = v; restart(false); },
});
const seedField = numberField({ label: "Seed for the deals", min: 0, max: 999999, step: 1, value: game.seed, hint: "The same seed deals the same values in the same rounds, so a session can be replayed under another format." });
const seedNote = el("div");
seedField.input.addEventListener("input", () => {
  const v = seedField.value;
  if (!Number.isInteger(v)) { seedField.input.classList.add("invalid"); seedNote.replaceChildren(note("bad", `The seed must be a whole number from 0 to 999,999. The session still uses seed ${game.seed}.`)); return; }
  seedNote.replaceChildren();
  game.seed = v;
  restart(false);
});
const speedSel = select({
  label: "Clock speed", value: game.speed,
  options: [{ value: "slow", label: "Slow (4 a second)" }, { value: "normal", label: "Normal (8 a second)" }, { value: "fast", label: "Fast (16 a second)" }],
  hint: "Used by the two clock auctions.",
  onChange: (v) => { game.speed = v; },
});
const restartBtn = button("Start again from round 1", () => restart(true), { small: true });
const newSeedBtn = button("New seed for the deals", () => { game.seed = randomSeed() % 1000000; seedField.value = game.seed; seedNote.replaceChildren(); restart(true); }, { small: true });

const roundHead = el("h3", { class: "round-head", tabindex: "-1" });
const ruleText = el("p", { class: "small" });
const valueTile = stat("Your value this round", "–", "what the item is worth to you");
const rivalsTile = stat("Rivals", "–", "");
const actionBox = el("div", { class: "action" });
const resultBox = el("div", { class: "result" });
const liveStatus = el("p", { class: "sr-only", role: "status" });
const hintBox = el("details", { class: "hint-box" });

const tiles = { rounds: stat("Rounds played"), mine: stat("Your total payoff"), eq: stat("Equilibrium bidding, same deals"), rev: stat("Seller's average revenue") };
const historyBox = el("div");
const bidChartBox = el("div"), payoffChartBox = el("div");

const gameControls = el("div", { class: "controls" }, formatSel.el, nSlider.el, seedField.el, seedNote, el("div", { class: "row" }, newSeedBtn, restartBtn), speedSel.el);
const gameOut = el("div", { class: "out" },
  roundHead, ruleText, el("div", { class: "stats" }, valueTile.el, rivalsTile.el), actionBox, liveStatus, resultBox, hintBox,
  el("h3", { text: "Your session so far" }),
  el("div", { class: "stats" }, tiles.rounds.el, tiles.mine.el, tiles.eq.el, tiles.rev.el),
  el("div", { class: "grid2" }, bidChartBox, payoffChartBox), historyBox);
// A held key repeats. Each press of a button settles or starts something and moves focus to the next button, so a
// repeated Enter would play round after round by itself: one press of the key is one action.
gameOut.addEventListener("keydown", (e) => { if (e.repeat && e.key === "Enter" && e.target.closest("button")) e.preventDefault(); });

const bidChart = chart(bidChartBox, { series: [], height: 280 });
const payoffChart = chart(payoffChartBox, { series: [], height: 280 });

function restart(focus) {
  stopClock();
  game.round = 1; game.phase = "bid"; game.history = []; game.last = null;
  drawGame();
  drawSession();
  if (focus) roundHead.focus();
}

/** The visitor's value this round, in hundredths. */
const myValue = () => deal(game.seed, game.round).values[0];

function settle(bid, how) {
  stopClock();
  const h = playRound({ format: game.format, n: game.n, seed: game.seed, round: game.round, bid });
  h.how = how;
  game.history.push(h);
  game.last = h;
  game.phase = "done";
  game.settledAt = performance.now();
  drawGame();
  drawSession();
  $("button.next", resultBox)?.focus();
}

/* ---------- clock auctions ---------- */
const clockTicker = ticker((dt) => stepClock(dt));
function stopClock() { clockTicker.stop(); game.clock = null; }

/** How far the price moves between two spoken announcements: about one every 1.25 seconds at any speed. */
const spokenStep = () => SPEEDS[game.speed] * 1.25;

function startClock() {
  const d = deal(game.seed, game.round);
  const up = game.format === "english";
  const rivals = d.values.slice(1, game.n).map((v, i) => ({ name: `Rival ${i + 1}`, at: up ? v : Math.round(eqBid("dutch", v / CENT, game.n) * CENT), out: false }));
  const end = Math.max(...rivals.map((r) => r.at)); // where the clock stops if the visitor does nothing
  // whole: a visitor who has asked for reduced motion gets a price that moves in whole steps, not a blur of hundredths.
  game.clock = { price: up ? 0 : TOP * CENT, exact: up ? 0 : TOP, rivals, end, startedAt: performance.now(), whole: reducedMotion(), paused: false, mark: up ? 0 : TOP / spokenStep() };
  game.phase = "running";
  drawGame();
  $("button.act", actionBox)?.focus();
  liveStatus.textContent = up
    ? `The clock has started. The price is rising from 0 by ${SPEEDS[game.speed]} a second, and is read out every ${spokenStep()}.`
    : `The clock has started. The price is falling from ${TOP} by ${SPEEDS[game.speed]} a second, and is read out every ${spokenStep()}.`;
  clockTicker.start();
}

function stepClock(dt) {
  const c = game.clock;
  if (!c || c.paused) return;
  const up = game.format === "english";
  c.exact += (up ? 1 : -1) * SPEEDS[game.speed] * dt;
  const unit = c.whole ? 1 : CENT; // the clock shows hundredths, or whole numbers under reduced motion
  const price = (up ? Math.floor(c.exact * unit) : Math.ceil(c.exact * unit)) * (CENT / unit);
  let said = "";
  if (up) {
    // Rivals leave as the price passes their values. When the last one has left, the visitor has won.
    const left = c.rivals.filter((r) => !r.out && r.at <= price).sort((a, b) => a.at - b.at);
    for (const r of left) r.out = true;
    const still = c.rivals.filter((r) => !r.out).length;
    if (!still) return settle(Infinity, "stayed");
    if (left.length) said = `${left.map((r) => `${r.name} dropped out at ${money(r.at)}`).join(". ")}. ${plural(still, "rival")} still in.`;
  } else if (price <= c.end) return settle(-Infinity, "waited");
  c.price = price;
  // For a screen reader the price is read out at intervals, never on every frame.
  const span = spokenStep() * CENT;
  const mark = up ? Math.floor(price / span) : Math.ceil(price / span);
  if (mark !== c.mark) { c.mark = mark; if (!said) said = `Price ${fmt.int(mark * spokenStep())}.`; }
  if (said) liveStatus.textContent = said;
  drawClock();
}

/** The tab went into the background: the clock waits, and says so, until the visitor presses "Resume the clock". */
function pauseClock() {
  if (game.phase !== "running" || !game.clock || game.clock.paused) return;
  clockTicker.stop();
  game.clock.paused = true;
  drawGame();
  $("button.resume", actionBox)?.focus();
  liveStatus.textContent = `The clock is paused at ${money(game.clock.price)}.`;
}
function resumeClock() {
  if (!game.clock?.paused) return;
  game.clock.paused = false;
  game.clock.startedAt = performance.now();
  drawGame();
  $("button.act", actionBox)?.focus();
  liveStatus.textContent = `The clock is running again from ${money(game.clock.price)}.`;
  clockTicker.start();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") pauseClock(); });

function drawClock() {
  const c = game.clock;
  if (!c) return;
  const price = $(".clock-num", actionBox), who = $(".clock-who", actionBox);
  if (price) price.textContent = money(c.price);
  if (who && game.format === "english") {
    const still = c.rivals.filter((r) => !r.out).length;
    who.textContent = `${plural(still, "rival")} still in, ${fmt.int(c.rivals.length - still)} out.`;
  }
}

/* ---------- drawing the round ---------- */
function hintText() {
  const n = game.n, f = game.format;
  const share = `${n - 1}/${n}`;
  if (f === "first") return `Each rival bids ${share} of its own value: with ${plural(n, "bidder")} that is the equilibrium. Against them, your best bid is ${share} of your value. Bid more and you win more often but keep less; bid less and the reverse.`;
  if (f === "dutch") return `Each rival stops the clock when the price falls to ${share} of its own value. Your choice is the same as in a first-price auction, because all you decide is the price at which you would stop the clock: the best one is ${share} of your value.`;
  if (f === "second") return "Each rival bids its own value. Your best bid is your own value too, whatever the rivals do: the price you pay is set by someone else's bid, so shading your bid can only lose you an auction you wanted to win, and bidding above your value can only win you one at a loss.";
  if (f === "english") return "Each rival stays in until the price reaches its own value. Your best plan is the same: stay in while the price is below your value and drop out when it reaches it. Leaving early gives up a profitable win; staying longer risks winning at a loss.";
  return `Each rival bids ${share} × v × (v / 100)^${n - 1} for its value v: very little unless its value is high, because every bidder pays. Your best bid follows the same formula. With a low value, bid almost nothing.`;
}

function drawGame() {
  const f = formatOf(game.format), n = game.n, value = myValue();
  roundHead.textContent = `Round ${game.round}: ${f.label.toLowerCase().replace("english", "English").replace("dutch", "Dutch").replace("vickrey", "Vickrey")}, ${plural(n - 1, "rival")}`;
  ruleText.textContent = `${f.rule} Values are private, drawn independently and evenly from 0 to 100, in hundredths.`;
  valueTile.set(money(value), "what the item is worth to you");
  rivalsTile.set(String(n - 1), n === 2 ? "a bot that bids the equilibrium strategy" : "bots that bid the equilibrium strategy");
  hintBox.replaceChildren(el("summary", { text: "What do the rivals do, and what is the best reply?" }), el("p", { class: "small", text: hintText() }));

  if (game.phase === "done") { actionBox.replaceChildren(); drawResult(); return; }
  resultBox.replaceChildren();
  if (game.phase === "running") {
    const up = game.format === "english", c = game.clock;
    const still = c.rivals.filter((r) => !r.out).length;
    const act = Object.assign(button(up ? "Drop out now" : "Stop the clock and buy", () => {
      // The second half of a double click on "Start the clock" lands here: it is not a decision to act.
      if (!game.clock || performance.now() - game.clock.startedAt < GUARD) return;
      settle(game.clock.price, "pressed");
    }, { primary: !c.paused }), { className: `btn${c.paused ? "" : " primary"} act` });
    actionBox.replaceChildren(el("div", { class: "panel clock" },
      el("p", { class: "small muted", text: c.paused
        ? "Paused: the clock stopped while this tab was in the background. Nothing has happened in the auction since."
        : `${up ? "The price is rising." : "The price is falling."}${c.whole ? " Your browser asks for reduced motion, so it moves in whole steps." : ""}` }),
      // The words "Current price" are for a screen reader; a label on a paragraph is not read reliably.
      el("p", { class: "clock-price" }, el("span", { class: "sr-only", text: "Current price: " }), el("span", { class: "clock-num", text: money(c.price) })),
      el("p", { class: "small clock-who", text: up ? `${plural(still, "rival")} still in, ${fmt.int(c.rivals.length - still)} out.` : "Nobody has stopped the clock yet." }),
      el("div", { class: "row" }, [c.paused ? Object.assign(button("Resume the clock", resumeClock, { primary: true }), { className: "btn primary resume" }) : null, act].filter(Boolean))));
    return;
  }
  liveStatus.textContent = ""; // a new round: the last result is no longer the news

  // Waiting for the visitor's bid.
  const problem = el("div");
  if (!f.clock) {
    const field = textField({ label: "Your bid", placeholder: "for example 45.50", hint: "From 0 to 100, with at most two decimal places." });
    field.input.setAttribute("inputmode", "decimal");
    field.input.maxLength = 12;
    field.input.classList.add("bid-input");
    const place = (text) => {
      const b = parseBid(text);
      if (b.error) { field.input.classList.add("invalid"); problem.replaceChildren(note("bad", b.error)); field.input.focus(); return; }
      settle(b.cents, "typed");
    };
    field.input.addEventListener("input", () => { field.input.classList.remove("invalid"); problem.replaceChildren(); });
    // preventDefault: the round is settled on keydown and focus moves to "Next round"; without it the same key press would go on to press that button.
    field.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (!e.repeat) place(field.value); } });
    const quick = (label, share) => button(label, () => settle(Math.round(value * share), "typed"), { small: true });
    actionBox.replaceChildren(el("div", { class: "panel" },
      el("div", { class: "bid-row" }, field.el, button("Place bid", () => place(field.value), { primary: true })),
      problem,
      el("p", { class: "small muted", text: "Or place one of these bids:" }),
      el("div", { class: "row" }, quick(`All of my value (${money(value)})`, 1), quick(`Three quarters (${money(Math.round(value * 0.75))})`, 0.75), quick(`Half (${money(Math.round(value * 0.5))})`, 0.5))));
  } else {
    const up = f.clock === "up";
    const field = textField({ label: up ? "Or drop out when the price reaches" : "Or stop the clock when the price falls to", placeholder: "for example 45.50", hint: up ? "The auction is then run to the end at once. Type 100 to stay in whatever happens." : "The auction is then run to the end at once." });
    field.input.setAttribute("inputmode", "decimal");
    field.input.maxLength = 12;
    const place = () => {
      const b = parseBid(field.value);
      if (b.error) { field.input.classList.add("invalid"); problem.replaceChildren(note("bad", b.error.replaceAll("A bid", "The price").replaceAll("a bid", "a price").replaceAll("Bids are", "Prices are").replaceAll("the bid", "the price"))); field.input.focus(); return; }
      settle(b.cents, "planned");
    };
    field.input.addEventListener("input", () => { field.input.classList.remove("invalid"); problem.replaceChildren(); });
    field.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (!e.repeat) place(); } });
    actionBox.replaceChildren(el("div", { class: "panel" },
      el("p", { class: "small", text: `${up
        ? "Start the clock and press \"Drop out now\" when the price is as high as you are willing to go. If you never press it, you win when the last rival leaves."
        : "Start the clock and press \"Stop the clock and buy\" when the price is low enough. If a rival presses first, the rival wins."} The button takes the keyboard focus as the clock starts, so Space or Enter presses it; a press in the first ${GUARD / 1000} seconds is ignored as a slip. The clock pauses if you leave this tab.` }),
      el("div", { class: "row" }, Object.assign(button("Start the clock", startClock, { primary: true }), { className: "btn primary start" })),
      el("div", { class: "bid-row" }, field.el, button("Run with this price", place)),
      problem));
  }
}

function drawResult() {
  const h = game.last;
  if (!h) return;
  const f = formatOf(h.format), n = h.n, r = h.result;
  const won = r.winner === 0;
  const name = (i) => (i === 0 ? "You" : `Rival ${i}`);
  const bidText = (b, i) => {
    if (b === Infinity) return "stayed in";
    if (b === -Infinity) return "did not stop the clock";
    // A rival's plan is known to the page even when the clock never reached it.
    return money(b);
  };
  const plan = h.format === "english" ? "Drops out at" : h.format === "dutch" ? "Stops the clock at" : "Bid";

  const parts = [];
  parts.push(won
    ? `You won${r.tied ? " a tie, settled by lot," : ""} and paid ${money(r.payments[0])} for an item worth ${money(h.values[0])} to you.`
    : `${name(r.winner)} won${r.tied ? " a tie with you, settled by lot," : ""} at a price of ${money(r.price)}.${h.format === "allpay" ? ` You still paid your bid of ${money(r.payments[0])}.` : ""}`);
  parts.push(`Your payoff is ${fmt.signed(h.payoff / CENT, 2)}.`);
  const eqWon = h.eqResult.winner === 0;
  const eqPlan = h.format === "english" ? `Dropping out only at your value, ${money(h.eqBid)},` : h.format === "dutch" ? `Stopping the clock at the equilibrium price, ${money(h.eqBid)},` : `The equilibrium bid, ${money(h.eqBid)},`;
  parts.push(`${eqPlan} would have ${eqWon ? `won and paid ${money(h.eqResult.payments[0])}` : h.format === "allpay" ? `lost and cost ${money(h.eqResult.payments[0])}` : "lost"} against the same rivals: a payoff of ${fmt.signed(h.eqPayoff / CENT, 2)}.`);
  const diff = h.payoff - h.eqPayoff;
  const dominant = h.format === "second" || h.format === "english";
  const kind = diff > 0 ? "good" : diff < 0 ? "warn" : "";
  let lesson;
  if (dominant) lesson = diff < 0 ? "In this format that plan is never beaten on any deal, so the difference is not bad luck." : "In this format that plan is never beaten on any deal: you matched it this time.";
  else lesson = diff > 0 ? "You did better on this deal. Over many deals the equilibrium bid earns more: the chart below shows the average." : diff < 0 ? "You did worse on this deal, and on average: the chart below shows what each bid earns over all the deals the rivals could have had." : "The two come to the same on this deal.";
  const sentence = `${parts.join(" ")} ${lesson}`;
  liveStatus.textContent = sentence;

  const rows = h.values.map((v, i) => ({
    who: name(i) + (i === r.winner ? " (winner)" : ""), value: money(v), bid: bidText(h.bids[i], i), paid: money(r.payments[i]),
    payoff: fmt.signed(((i === r.winner ? v : 0) - r.payments[i]) / CENT, 2),
  }));
  const next = Object.assign(button("Next round", () => {
    // A double click, or a held Enter key, that settled the round must not also skip past its result.
    if (performance.now() - game.settledAt < GUARD) return;
    game.round++; game.phase = "bid"; game.last = null;
    drawGame();
    ($("input.bid-input", actionBox) ?? $("button.start", actionBox) ?? roundHead).focus();
  }, { primary: true }), { className: "btn primary next" });
  resultBox.replaceChildren(
    note(kind, sentence),
    stacked(table({
      caption: `Round ${h.round}, with everything revealed (a real auction would not show you the rivals' values)`,
      columns: [{ key: "who", label: "Bidder" }, { key: "value", label: "Value", num: true }, { key: "bid", label: plan, num: true }, { key: "paid", label: "Paid", num: true }, { key: "payoff", label: "Payoff", num: true }],
      rows,
    })),
    el("p", { class: "small muted", text: `The seller received ${money(r.revenue)}. With ${plural(n, "bidder")} the expected revenue of this format is ${m2(expectedRevenue(h.format, n))}.` }),
    el("div", { class: "row" }, next));
  drawPayoffChart(h);
}

/* ---------- the session ---------- */
function drawPayoffChart(h) {
  const v = h.values[0] / CENT, n = h.n;
  const revealed = Number.isFinite(h.bids[0]);
  const curve = Array.from({ length: 201 }, (_, i) => [i / 2, expectedPayoff(h.format, v, i / 2, n)]);
  const best = eqBid(h.format, v, n);
  // When the visitor's bid sits on the best reply, one label says so instead of two labels printed over each other.
  const onBest = revealed && Math.abs(h.bids[0] / CENT - best) < 3;
  const marks = [{ type: "vline", x: best, text: onBest ? "" : `best: ${m2(best)}` }];
  if (revealed) marks.push({ type: "point", x: h.bids[0] / CENT, y: expectedPayoff(h.format, v, h.bids[0] / CENT, n), text: onBest ? `you: ${money(h.bids[0])}, best: ${m2(best)}` : "you" });
  const word = h.format === "english" ? "drop-out price" : h.format === "dutch" ? "stopping price" : "bid";
  payoffChart.update({
    title: `What each ${word} earns on average with a value of ${m2(v)}`,
    subtitle: revealed
      ? `Round ${h.round}. Your ${word} of ${money(h.bids[0])} earns ${m2(expectedPayoff(h.format, v, h.bids[0] / CENT, n))} on average against these rivals; the best reply earns ${m2(eqExpectedPayoff(v, n))}.`
      : `Round ${h.round}. The auction ended before your plan was revealed, so only the curve is shown. The best reply earns ${m2(eqExpectedPayoff(v, n))} on average.`,
    label: `Line chart of expected payoff against the ${word}`,
    x: { label: `Your ${word}`, domain: [0, 100] }, y: { label: "Expected payoff", format: (y) => fmt.num(y, 1) },
    series: [{ name: "Expected payoff", type: "line", data: curve, color: 0 }], marks, legend: false,
  });
}

function drawSession() {
  const s = summarise(game.history);
  tiles.rounds.set(fmt.int(s.rounds), s.rounds ? `you won ${fmt.int(s.wins)}` : "none yet");
  tiles.mine.set(s.rounds ? fmt.signed(s.payoff / CENT, 2) : "–", s.rounds ? `better than equilibrium in ${fmt.int(s.ahead)}, worse in ${fmt.int(s.behind)}, level in ${fmt.int(s.level)}` : "");
  tiles.eq.set(s.rounds ? fmt.signed(s.eqPayoff / CENT, 2) : "–", s.rounds ? "the equilibrium strategy against the same rivals" : "");
  tiles.rev.set(s.rounds ? money(s.revenue / s.rounds) : "–", `theory, every format: ${m2(expectedRevenue("first", game.n))}`);

  if (!s.rounds) {
    historyBox.replaceChildren(el("p", { class: "small muted", text: "No rounds played yet. Place a bid above and each round is listed here, beside what the equilibrium strategy would have earned on the same deal." }));
    payoffChart.update({ title: "What each bid earns on average", subtitle: "", series: [], marks: [], empty: "Shown after your first round", label: "Empty chart: expected payoff by bid", x: { label: "Your bid", domain: [0, 100] }, y: { label: "Expected payoff" } });
  } else {
    const bidOf = (h) => (h.bids[0] === Infinity ? "stayed in" : h.bids[0] === -Infinity ? "waited" : money(h.bids[0]));
    historyBox.replaceChildren(stacked(table({
      caption: `Every round of this session (seed ${game.seed}), latest first`,
      columns: [
        { key: "round", label: "Round", num: true }, { key: "format", label: "Format" }, { key: "value", label: "Your value", num: true }, { key: "bid", label: "Your bid", num: true },
        { key: "outcome", label: "Result" }, { key: "payoff", label: "Your payoff", num: true }, { key: "eq", label: "Equilibrium payoff", num: true }, { key: "rev", label: "Seller's revenue", num: true },
      ],
      rows: [...game.history].reverse().map((h) => ({
        round: h.round, format: SHORT[h.format], value: money(h.values[0]), bid: bidOf(h),
        outcome: h.result.winner === 0 ? `won, paid ${money(h.result.payments[0])}` : h.format === "allpay" ? `lost, paid ${money(h.result.payments[0])}` : "lost",
        payoff: fmt.signed(h.payoff / CENT, 2), eq: fmt.signed(h.eqPayoff / CENT, 2), rev: money(h.result.revenue),
      })),
    })));
  }

  // Bids against values, for the rounds played in the current format, with the equilibrium line.
  const f = game.format, n = game.n;
  const mine = game.history.filter((h) => h.format === f && Number.isFinite(h.bids[0]));
  const hidden = game.history.filter((h) => h.format === f).length - mine.length;
  const word = f === "english" ? "drop-out price" : f === "dutch" ? "stopping price" : "bid";
  bidChart.update({
    title: `Your ${word}s against your values: ${SHORT[f].toLowerCase().replace("english", "English").replace("dutch", "Dutch")}`,
    subtitle: `The line is the equilibrium ${word} for each value with ${plural(n, "bidder")}.${mine.length ? "" : " Your rounds in this format will appear as dots."}${hidden ? ` ${plural(hidden, "round")} ended before your plan was revealed and cannot be drawn.` : ""}`,
    label: `Chart of your ${word}s against your values, with the equilibrium line`,
    x: { label: "Your value", domain: [0, 100] }, y: { label: `Your ${word}`, domain: [0, 100] },
    series: [
      { name: `Equilibrium ${word}`, type: "line", data: Array.from({ length: 101 }, (_, i) => [i, eqBid(f, i, n)]), color: "#16233b" },
      { name: `Your ${word}s`, type: "scatter", data: mine.map((h) => ({ x: h.values[0] / CENT, y: h.bids[0] / CENT, label: `Round ${h.round}` })), color: 1, r: 4.5 },
    ],
  });
}

/* ====================================================================== part 2: the revenue experiment */

const lab = { mode: "symmetric", n: 4, reserve: 0, alpha: 1, strongTop: 200, seed: 52, auctions: 10000, run: 0 };

const modeSeg = segmented({
  label: "Who is bidding", value: lab.mode,
  options: [{ value: "symmetric", label: "Equal bidders" }, { value: "strong", label: "One strong bidder" }],
  onChange: (v) => { lab.mode = v; showLabControls(); runLabSoon(); },
});
const labN = slider({ label: "Bidders", min: LAB_LIMITS.n[0], max: LAB_LIMITS.n[1], step: 1, value: lab.n, format: (v) => String(v), onInput: (v) => { lab.n = v; runLabSoon(); } });
const labReserve = slider({
  label: "Reserve price", min: 0, max: 90, step: 1, value: lab.reserve, format: (v) => (v ? String(v) : "none"),
  hint: "The seller refuses any price below this. Bidders with lower values stay out.",
  onInput: (v) => { lab.reserve = v; runLabSoon(); },
});
const labAlpha = slider({
  label: "Bidders' attitude to risk", min: 0.2, max: 1, step: 0.05, value: lab.alpha,
  format: (v) => (v >= 0.999 ? "1.00, risk neutral" : `${fmt.num(v, 2)}, risk averse`),
  hint: "The exponent a in the utility x^a of a gain x. Below 1, a bidder would rather have a sure gain than a gamble with the same average.",
  onInput: (v) => { lab.alpha = Math.round(v * 100) / 100; runLabSoon(); },
});
const labStrong = slider({
  label: "Strong bidder's highest value", min: 100, max: 300, step: 10, value: lab.strongTop, format: (v) => String(v),
  hint: "Two bidders. One has values spread evenly from 0 to this number; the other from 0 to 100. This is one of the few cases of unequal bidders with an exact formula for the first-price auction, which is why there are only two.",
  onInput: (v) => { lab.strongTop = v; runLabSoon(); },
});
const labCount = select({
  label: "Auctions to simulate", value: String(lab.auctions),
  options: [{ value: "1000", label: "1,000" }, { value: "10000", label: "10,000" }, { value: "100000", label: "100,000" }],
  onChange: (v) => { lab.auctions = Number(v); runLabSoon(); },
});
const labSeed = numberField({ label: "Seed for the experiment", min: 0, max: 999999, step: 1, value: lab.seed });
const labNote = el("div");
labSeed.input.addEventListener("input", () => {
  if (!Number.isInteger(labSeed.value)) { labSeed.input.classList.add("invalid"); labNote.replaceChildren(note("bad", `The seed must be a whole number from 0 to 999,999. The results shown still use seed ${lab.seed}.`)); return; }
  labNote.replaceChildren();
  lab.seed = labSeed.value;
  runLabSoon();
});
const symBox = el("div", { class: "controls" }, labN.el, labReserve.el, labAlpha.el);
const strongBox = el("div", { class: "controls" }, labStrong.el);
function showLabControls() { symBox.hidden = lab.mode !== "symmetric"; strongBox.hidden = lab.mode !== "strong"; }
const labReset = button("Back to the textbook case", () => {
  Object.assign(lab, { mode: "symmetric", n: 4, reserve: 0, alpha: 1, strongTop: 200, seed: 52, auctions: 10000 });
  modeSeg.value = lab.mode; labN.value = 4; labReserve.value = 0; labAlpha.value = 1; labStrong.value = 200; labSeed.value = 52; labCount.value = "10000";
  labNote.replaceChildren(); showLabControls(); runLab();
}, { small: true });
const labNewSeed = button("New seed for the experiment", () => { lab.seed = randomSeed() % 1000000; labSeed.value = lab.seed; labNote.replaceChildren(); runLab(); }, { small: true });

const labStatus = el("p", { class: "small muted", role: "status" });
const labVerdictBox = el("div");
const labTableBox = el("div");
const distBox = el("div"), theoryBox = el("div");
const labControls = el("div", { class: "controls" }, modeSeg.el, symBox, strongBox, labCount.el, labSeed.el, labNote, el("div", { class: "row" }, labNewSeed, labReset));
const labOut = el("div", { class: "out" }, labStatus, labVerdictBox, labTableBox, el("div", { class: "grid2" }, distBox, theoryBox));
const distChart = chart(distBox, { series: [], height: 300 });
const theoryChart = chart(theoryBox, { series: [], height: 300 });

function runLab() {
  const token = ++lab.run;
  const settings = { mode: lab.mode, n: lab.n, reserve: lab.reserve, alpha: lab.alpha, strongTop: lab.strongTop, seed: lab.seed, auctions: lab.auctions };
  const problem = labProblem(settings);
  if (problem) { labNote.replaceChildren(note("bad", problem)); return; }
  const sim = createLab(settings);
  let said = -Infinity;
  const step = () => {
    if (token !== lab.run) return;
    const t0 = performance.now();
    while (sim.done < settings.auctions && performance.now() - t0 < 20) sim.run(Math.min(2000, settings.auctions - sim.done));
    if (sim.done < settings.auctions) {
      if (t0 - said >= 500) { said = t0; labStatus.textContent = `Simulating: ${fmt.int(sim.done)} of ${fmt.int(settings.auctions)} auctions…`; }
      setTimeout(step, 0);
      return;
    }
    drawLab(sim.summary(), settings);
  };
  step();
}
const runLabSoon = debounce(runLab, 250);

function drawLab(sum, s) {
  const v = labVerdict(s);
  const strong = s.mode === "strong";
  const row = Object.fromEntries(sum.rows.map((r) => [r.key, r]));
  const worst = sum.rows.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a));
  const setting = strong
    ? `two bidders, one with values from 0 to ${s.strongTop} and one from 0 to 100`
    : `${plural(s.n, "bidder")} with values from 0 to 100${s.reserve ? `, a reserve of ${s.reserve}` : ""}${s.alpha < 1 ? `, risk-averse bidders (exponent ${fmt.num(s.alpha, 2)})` : ""}`;
  labStatus.textContent = `${fmt.int(sum.done)} simulated auctions, seed ${s.seed}: ${setting}. Every format is run on the same values. This is a simulation of bidders who play the equilibrium, not data from real auctions.`;

  // Small cases: a difference that rounds to nothing is not printed as "0.00 more".
  const tiny = (x) => Math.abs(x) < 0.005;
  const parts = [];
  if (v.equal) {
    parts.push(el("strong", { text: "Revenue equivalence holds here. " }));
    parts.push(`Theory gives every one of these ${sum.rows.length === 5 ? "five" : "four"} formats the same expected revenue, ${m2(v.first)}.`);
    if (!strong && s.reserve > 0) parts.push(` With no reserve it would be ${m2(v.base)}: the reserve changes how much is raised, not which format raises more. ${fmt.pct(1 - row.second.sold, 1)} of the auctions ended with no sale.`);
  } else {
    parts.push(el("strong", { text: "Revenue equivalence fails here. " }));
    parts.push(tiny(v.gap)
      ? `Theory gives the first-price and Dutch auctions ${fmt.num(v.first, 4)} and the second-price and English auctions ${fmt.num(v.second, 4)}: ${v.gap > 0 ? "more" : "less"} for the first pair, but by less than 0.01.`
      : `Theory gives the first-price and Dutch auctions ${m2(v.first)} and the second-price and English auctions ${m2(v.second)}: ${m2(Math.abs(v.gap))} ${v.gap > 0 ? "more" : "less"} for the first pair.`);
    parts.push(strong
      ? ` The weaker bidder bids more boldly than the stronger one with the same value, and so the first-price auction went to the bidder with the lower value in ${fmt.pct(1 - row.first.best, 1)} of the auctions.`
      : " A risk-averse bidder shades a first-price bid less, to cut the chance of losing; in a second-price auction bidding the value is still the best plan, so nothing changes there.");
  }
  const seText = tiny(sum.diff.se) ? "standard error under 0.01" : `standard error ${m2(sum.diff.se)}`;
  parts.push(` In this run the first-price auction raised ${tiny(sum.diff.mean) ? "the same per auction, to two decimal places, as" : `${m2(Math.abs(sum.diff.mean))} ${sum.diff.mean >= 0 ? "more" : "less"} per auction than`} the second-price auction on the same values (${seText}), and the simulated average furthest from its theoretical value is the ${SHORT[worst.key].toLowerCase().replace("english", "English").replace("dutch", "Dutch")} one, ${fmt.num(Math.abs(worst.gap), 1)} standard errors away.`);
  if (!strong && sum.rows.length === 4) parts.push(" The all-pay auction is left out: this page has no formula for its equilibrium once there is a reserve or bidders are risk averse.");
  labVerdictBox.replaceChildren(note(v.equal ? "good" : "warn", parts));

  labTableBox.replaceChildren(stacked(table({
    caption: "Seller's revenue per auction, by format",
    columns: [
      { key: "name", label: "Format" }, { key: "theory", label: "Theory", num: true }, { key: "mean", label: "Simulated average", num: true },
      { key: "se", label: "Standard error", num: true }, { key: "sd", label: "Spread", num: true },
      { key: "sold", label: "Sold", num: true }, { key: "best", label: "Sold to the highest value", num: true },
    ],
    rows: sum.rows.map((r) => ({ name: formatOf(r.key).label, theory: m2(r.theory), mean: m2(r.mean), se: `± ${m2(r.se)}`, sd: fmt.num(r.sd, 1), sold: fmt.pct(r.sold, 1), best: fmt.pct(r.best, 1) })),
  })),
  el("p", { class: "small muted", text: "Spread is the standard deviation of revenue from one auction to the next. \"Sold to the highest value\" is the share of auctions won by the bidder who valued the item most. The Dutch auction repeats the first-price row and the English auction the second-price row exactly: with private values they are the same game, so they give the same price in every single auction." }));

  // The spread: same average, different distributions.
  const shown = ["first", "second", "allpay"].filter((k) => row[k]);
  distChart.update({
    title: "How revenue is spread across auctions",
    subtitle: `Share of auctions in each band of 2.${row.allpay ? ` The last band also holds the ${fmt.pct(row.allpay.over, 1)} of all-pay auctions that raised 100 or more.` : ""}`,
    label: "Step chart of the distribution of revenue by format",
    x: { label: "Seller's revenue", domain: [0, 100] }, y: { label: "Share of auctions", format: (y) => fmt.pct(y, 0), zero: true },
    series: shown.map((k, i) => ({ name: k === "first" ? "First-price and Dutch" : k === "second" ? "Second-price and English" : "All-pay", type: "step", color: i, data: [...row[k].hist.map((h) => [h[0], h[2]]), [TOP, row[k].hist.at(-1)[2]]] })),
    marks: [],
  });

  // Theory across the setting that was moved, with this run's averages as dots.
  if (strong) {
    const xs = Array.from({ length: 41 }, (_, i) => 100 + i * 5);
    theoryChart.update({
      title: "Expected revenue as one bidder grows stronger", subtitle: "Theory (lines) and this run (dots). Two bidders; the weak one's values run from 0 to 100.",
      label: "Line chart of expected revenue against the strong bidder's highest value",
      x: { label: "Strong bidder's highest value", domain: [100, 300] }, y: { label: "Expected revenue", format: (y) => fmt.num(y, 0) },
      series: [
        { name: "First-price and Dutch", type: "line", color: 0, data: xs.map((x) => [x, asymmetricRevenue("first", x)]) },
        { name: "Second-price and English", type: "line", color: 1, data: xs.map((x) => [x, asymmetricRevenue("second", x)]) },
        { name: "This run", type: "scatter", color: "#16233b", r: 4.5, data: [{ x: s.strongTop, y: row.first.mean, label: "First-price, simulated" }, { x: s.strongTop, y: row.second.mean, label: "Second-price, simulated" }] },
      ],
      marks: [{ type: "vline", x: s.strongTop }],
    });
  } else {
    const xs = Array.from({ length: 91 }, (_, i) => i);
    const one = s.alpha >= 1;
    const best = xs.reduce((a, b) => (expectedRevenue("second", s.n, b) > expectedRevenue("second", s.n, a) ? b : a));
    theoryChart.update({
      title: "Expected revenue at every reserve price",
      subtitle: `Theory (${one ? "line" : "lines"}) and this run (${one ? "dot" : "dots"}), ${plural(s.n, "bidder")}. Second-price revenue peaks at a reserve of ${best}, half the highest possible value, however many bid.`,
      label: "Line chart of expected revenue against the reserve price",
      x: { label: "Reserve price", domain: [0, 90] }, y: { label: "Expected revenue", format: (y) => fmt.num(y, 0) },
      series: [
        ...(one ? [{ name: "Every format", type: "line", color: 0, data: xs.map((x) => [x, expectedRevenue("second", s.n, x)]) }]
          : [{ name: "First-price and Dutch", type: "line", color: 0, data: xs.map((x) => [x, expectedRevenue("first", s.n, x, s.alpha)]) },
             { name: "Second-price and English", type: "line", color: 1, data: xs.map((x) => [x, expectedRevenue("second", s.n, x)]) }]),
        { name: "This run", type: "scatter", color: "#16233b", r: 4.5, data: one ? [{ x: s.reserve, y: row.second.mean, label: "Second-price, simulated" }] : [{ x: s.reserve, y: row.first.mean, label: "First-price, simulated" }, { x: s.reserve, y: row.second.mean, label: "Second-price, simulated" }] },
      ],
      marks: [{ type: "vline", x: s.reserve }],
    });
  }
}

/* ============================================================================================= page */

$("#app").append(
  el("nav", { class: "jump", "aria-label": "Parts of the tool" }, el("a", { href: "#part-bid", text: "1. Bid in an auction" }), el("a", { href: "#part-lab", text: "2. Simulate thousands of auctions" })),
  el("section", { id: "part-bid", "aria-labelledby": "h-bid" },
    el("h2", { id: "h-bid", class: "part-head", text: "1. Bid in an auction against bots" }),
    el("div", { class: "tool-grid" }, gameControls, gameOut)),
  el("section", { id: "part-lab", "aria-labelledby": "h-lab" },
    el("h2", { id: "h-lab", class: "part-head", text: "2. Simulate thousands of auctions and compare the seller's revenue" }),
    el("div", { class: "tool-grid" }, labControls, labOut)));

showLabControls();
drawGame();
drawSession();
runLab();
