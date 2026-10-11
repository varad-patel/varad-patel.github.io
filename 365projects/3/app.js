// Day 3: Monty Hall Monte Carlo. Interface.
import { $, el, fmt, mount, slider, segmented, button, stat, note, chart, rng, randomSeed } from "../kit/kit.js";
import { normalise, theory, emptyTally, runGames, margin, newGame, choose, decide, alternatives } from "./logic.js";

mount();

const DEFAULT_SEED = 3;
const CHUNK = 5000;
const state = {
  config: normalise({}),
  game: null,
  hand: { stay: { wins: 0, games: 0 }, swap: { wins: 0, games: 0 }, voided: 0 },
  tally: emptyTally(),
  seed: DEFAULT_SEED,
  sim: rng(DEFAULT_SEED),
  queued: 0,
  timer: 0,
};
const handRng = rng(randomSeed());

/* ---------- settings ---------- */
const doorsSlider = slider({ label: "Doors", min: 3, max: 10, step: 1, value: 3, format: fmt.int, onInput: () => settingsChanged() });
const openSlider = slider({ label: "Doors the host opens", min: 1, max: 1, step: 1, value: 1, format: fmt.int, hint: "At most all but your door and one other.", onInput: () => settingsChanged() });
const hostSeg = segmented({
  label: "The host", value: "knows",
  options: [{ value: "knows", label: "Knows where the car is" }, { value: "random", label: "Opens at random" }],
  hint: "A host who opens at random sometimes reveals the car. Those games are thrown out.",
  onChange: () => settingsChanged(),
});

function settingsChanged() {
  const doors = doorsSlider.value;
  openSlider.input.max = doors - 2;
  if (openSlider.value > doors - 2) openSlider.value = doors - 2;
  openSlider.input.disabled = doors === 3;
  state.config = normalise({ doors, opened: openSlider.value, host: hostSeg.value });
  state.hand = { stay: { wins: 0, games: 0 }, swap: { wins: 0, games: 0 }, voided: 0 };
  resetSimulation(state.seed);
  deal();
}

/* ---------- the game by hand ---------- */
const doorRow = el("div", { class: "doors", role: "group", "aria-label": "The doors in the game" });
const prompt = el("p", { class: "prompt", role: "status", "aria-live": "polite" });
const stayBtn = button("Stay", () => act(state.game.pick));
const swapBtn = button("Switch", () => act(alternatives(state.game)[0]));
const againBtn = button("Play again", () => { deal(); focusGame(); }, { primary: true });
const pickHint = el("span", { class: "small muted", text: "Click a door, or move to it with Tab and press Enter. The host then opens a door." });
const handStay = stat("You stayed");
const handSwap = stat("You switched");

function deal() {
  state.game = newGame(handRng, state.config);
  drawGame();
}
function act(door) {
  const g = state.game;
  if (g.phase === "pick") state.game = choose(g, handRng, door);
  else if (g.phase === "decide") state.game = decide(g, door);
  const now = state.game;
  if (now !== g && now.phase === "done") {
    if (now.result === "void") state.hand.voided++;
    else { state.hand[now.strategy].games++; if (now.result === "win") state.hand[now.strategy].wins++; }
  }
  drawGame();
  focusGame();
}
// Every move redraws the doors and hides the button just used, which would drop keyboard focus on the floor.
// Put it on the next thing to do instead: a door, the stay button, or "Play again". With several doors left to
// switch to, the choice is made on the doors, so focus stays on the one picked and the stay button follows them.
function focusGame() {
  const g = state.game;
  const next = g.phase === "pick" ? doorRow.querySelector("button")
    : g.phase === "done" ? againBtn
      : alternatives(g).length === 1 ? stayBtn : doorRow.children[g.pick];
  next.focus();
}

function drawGame() {
  const g = state.game;
  const done = g.phase === "done";
  const alts = g.phase === "decide" ? alternatives(g) : [];
  doorRow.replaceChildren(...Array.from({ length: g.config.doors }, (_, d) => {
    const opened = g.open.includes(d) || done;
    const isCar = d === g.car;
    const label = opened ? (isCar ? "Car" : "Goat") : "";
    const tags = [];
    if (d === g.pick) tags.push(g.final != null && g.final !== g.pick ? "first pick" : "your pick");
    if (g.final === d && g.final !== g.pick) tags.push("your switch");
    const clickable = g.phase === "pick" || (g.phase === "decide" && !g.open.includes(d));
    return el("button", {
      type: "button",
      class: `door${opened ? " open" : ""}${opened && isCar ? " car" : ""}${d === g.pick ? " picked" : ""}${g.final === d ? " final" : ""}`,
      disabled: !clickable,
      "aria-label": `Door ${d + 1}${opened ? `, open: ${label.toLowerCase()}` : ", closed"}${tags.length ? `, ${tags.join(", ")}` : ""}`,
      onclick: () => act(d),
    },
      el("span", { class: "door-num", text: String(d + 1) }),
      el("span", { class: "behind", text: label }),
      el("span", { class: "tag", text: tags.join(" · ") }));
  }));

  if (g.phase === "pick") prompt.textContent = `A car is behind one of these ${g.config.doors} doors and goats are behind the rest. Pick a door.`;
  else if (g.phase === "decide") {
    const opened = g.open.map((d) => d + 1).join(", ");
    prompt.textContent = `You picked door ${g.pick + 1}. The host opened door${g.open.length > 1 ? "s" : ""} ${opened}: ${g.open.length > 1 ? "goats" : "a goat"}. `
      + (alts.length === 1 ? `Stay with door ${g.pick + 1}, or switch to door ${alts[0] + 1}?` : `Stay with door ${g.pick + 1}, or choose another closed door to switch to it.`);
  } else if (g.result === "void") prompt.textContent = `The host opened door${g.open.length > 1 ? "s" : ""} ${g.open.map((d) => d + 1).join(", ")} at random and revealed the car. This game does not count.`;
  else prompt.textContent = `You ${g.strategy === "stay" ? "stayed" : "switched"} and ${g.result === "win" ? "won the car" : "got a goat"}. The car was behind door ${g.car + 1}.`;

  stayBtn.hidden = swapBtn.hidden = g.phase !== "decide";
  swapBtn.disabled = alts.length !== 1;
  swapBtn.textContent = alts.length === 1 ? `Switch to door ${alts[0] + 1}` : "Switch (choose a door)";
  stayBtn.textContent = g.pick != null ? `Stay with door ${g.pick + 1}` : "Stay";
  againBtn.hidden = !done;
  pickHint.hidden = g.phase !== "pick";

  const line = (s) => (s.games ? `${fmt.pct(s.wins / s.games, 0)} won` : "no games yet");
  handStay.set(`${s2(state.hand.stay)}`, line(state.hand.stay));
  handSwap.set(`${s2(state.hand.swap)}`, line(state.hand.swap));
}
const s2 = (s) => `${s.wins} of ${s.games}`;

/* ---------- the simulation ---------- */
const sGames = stat("Games simulated");
const sSwap = stat("Switching won");
const sStay = stat("Staying won");
const simNote = el("div");
const chartBox = el("div");
const seedLine = el("span", { class: "small muted" });
const progress = el("span", { class: "small muted" });
// Spoken once when a run starts and once when it ends. The visible counter changes twenty times a second.
const simStatus = el("p", { class: "sr-only", role: "status" });

const plot = chart(chartBox, { series: [], height: 300 });

function resetSimulation(seed) {
  clearTimeout(state.timer);
  state.timer = 0;
  state.queued = 0;
  state.seed = seed;
  state.sim = rng(seed);
  state.tally = emptyTally();
  simStatus.textContent = "";
  drawSimulation();
}
function queue(n) {
  state.queued += n;
  if (!state.timer) { simStatus.textContent = `Running ${fmt.int(state.queued)} games.`; pump(); }
}
function pump() {
  state.timer = 0;
  if (state.queued <= 0) { drawSimulation(); return; }
  const n = Math.min(CHUNK, state.queued);
  runGames(state.sim, n, state.config, state.tally);
  state.queued -= n;
  drawSimulation();
  if (state.queued > 0) state.timer = setTimeout(pump, 30);
  else {
    const t = state.tally;
    simStatus.textContent = t.games
      ? `Done. ${fmt.int(t.games)} games counted${t.voided ? `, ${fmt.int(t.voided)} thrown out` : ""}. Switching won ${fmt.pct(t.swapWins / t.games, 1)} and staying won ${fmt.pct(t.stayWins / t.games, 1)}.`
      : `Done. All ${fmt.int(t.voided)} games were thrown out.`;
  }
}

function drawSimulation() {
  const t = state.tally;
  const th = theory(state.config);
  const total = t.games + t.voided;
  progress.textContent = state.queued > 0 ? `Running: ${fmt.int(state.queued)} to go` : "";
  seedLine.textContent = `Random seed ${state.seed}. The same seed always gives the same games.`;
  sGames.set(fmt.int(total), t.voided ? `${fmt.int(t.games)} counted, ${fmt.int(t.voided)} thrown out` : total ? "all counted" : "press a button to start");
  const rate = (wins) => (t.games ? wins / t.games : NaN);
  // The margin is the one in the write-up: how far 95% of runs of this length land from the exact probability.
  const line = (wins, expected) => (t.games ? `${fmt.int(wins)} wins. Theory: ${fmt.pct(expected, 1)} ± ${fmt.num(100 * margin(expected, t.games), 1)} points` : `Theory: ${fmt.pct(expected, 1)}`);
  sSwap.set(t.games ? fmt.pct(rate(t.swapWins), 2) : "–", line(t.swapWins, th.swap));
  sStay.set(t.games ? fmt.pct(rate(t.stayWins), 2) : "–", line(t.stayWins, th.stay));

  const same = Math.abs(th.swap - th.stay) < 1e-12;
  // Two end labels need about six percentage points between them on this scale, or they print on top of each other.
  const apart = t.games > 0 && Math.abs(rate(t.swapWins) - rate(t.stayWins)) >= 0.07;
  simNote.replaceChildren(state.config.host === "random"
    ? note("", `With a host who opens at random, the ${fmt.pct(1 - th.valid, 0)} of games where the car is revealed are discarded. In the rest, switching and staying win equally often (${fmt.pct(th.swap, 1)} each): the host's knowledge was what made switching better.`)
    : note("", `Staying wins only if your first pick was right: 1 in ${state.config.doors}. Otherwise the car is behind ${state.config.doors - 1 - state.config.opened === 1 ? "the one other door" : `one of the ${state.config.doors - 1 - state.config.opened} other doors`} the host left closed, so switching wins ${fmt.pct(th.swap, 1)} of the time.`));

  // Before any games the chart prints its "run some games" line at mid-height: leave out a dashed line that would cross it.
  const marks = (same ? [{ type: "hline", y: th.swap, text: `theory ${fmt.pct(th.swap, 1)}` }]
    : [{ type: "hline", y: th.swap, text: `switch: ${fmt.pct(th.swap, 1)}` }, { type: "hline", y: th.stay, text: `stay: ${fmt.pct(th.stay, 1)}` }])
    .filter((m) => t.games > 0 || Math.abs(m.y - 0.5) >= 0.08);
  plot.update({
    title: "Running win rate as games accumulate",
    subtitle: ["The early wobble is luck.", "The early wobble is luck. The dashed line is an exact probability.", "The early wobble is luck. The dashed lines are the exact probabilities."][marks.length],
    x: { label: "Games played (log scale)", type: "log", domain: [1, Math.max(100, t.games)], format: (v) => fmt.compact(v) },
    y: { label: "Share of games won", domain: [0, 1], format: (v) => fmt.pct(v, 0) },
    series: [
      { name: "Switch", data: t.trail.map((p) => [p.n, p.swap]), color: 0, endLabel: apart ? `Switch ${fmt.pct(rate(t.swapWins), 1)}` : false },
      { name: "Stay", data: t.trail.map((p) => [p.n, p.stay]), color: 1, endLabel: apart ? `Stay ${fmt.pct(rate(t.stayWins), 1)}` : false },
    ],
    marks,
    empty: "Run some games to see the rates converge",
    table: t.trail.length > 0,
  });
}

/* ---------- layout ---------- */
$("#app").append(
  el("div", { class: "tool-grid" },
    el("div", { class: "controls" }, doorsSlider.el, openSlider.el, hostSeg.el,
      el("p", { class: "small muted", text: "Changing a setting starts both tallies again." })),
    el("div", { class: "out" },
      el("h2", { text: "1. Play it yourself" }),
      prompt, doorRow,
      el("div", { class: "row actions" }, pickHint, stayBtn, swapBtn, againBtn),
      el("div", { class: "stats" }, handStay.el, handSwap.el))),
  el("div", { class: "out sim" },
    el("h2", { text: "2. Let the computer play it 100,000 times" }),
    el("p", { class: "small muted", text: "Every simulated game is scored twice: once as if the player stayed and once as if they switched to a closed door chosen at random." }),
    el("div", { class: "row" },
      button("Run 100,000 games", () => queue(100000), { primary: true }),
      button("Run 1,000", () => queue(1000)),
      button("Run 10", () => queue(10)),
      button(`Start again from seed ${DEFAULT_SEED}`, () => resetSimulation(DEFAULT_SEED)),
      button("Use a new seed", () => resetSimulation(randomSeed() % 100000)),
      progress),
    el("div", { class: "stats" }, sGames.el, sSwap.el, sStay.el), simStatus,
    simNote, chartBox, seedLine));

openSlider.input.disabled = true;
deal();
drawSimulation();
