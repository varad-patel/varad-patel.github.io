// Day 23: Infinity Lab. Interface. Part 1 is Hilbert's Hotel, part 2 is Cantor's diagonal.
import { $, el, fmt, mount, slider, select, segmented, numberField, textArea, button, note, table, canvas, ticker, reducedMotion, palette } from "../kit/kit.js";
import { KINDS, MAX_NUMBER, isCount, moveGuest, newcomers, placeNewcomer, whoGets, resident, RULES, parseRows, makeList } from "./logic.js";

mount();

const INK = "#16233b", SLATE = "#566478", GRID = "#dbe4de";
const BLUE = palette[0], ORANGE = palette[1];
const FONT = getComputedStyle(document.body).fontFamily;
const WHOLE = `Enter a whole number from 1 to ${fmt.int(MAX_NUMBER)}.`;
const wholeNumber = (field) => (isCount(field.value) ? field.value : null);

/* ====================================================================== Part 1: Hilbert's Hotel */

const ROOMS = 40;                 // rooms drawn on the canvas
const LETTERS = "ABCDEFGHIJKL";   // one letter per arrival
const MOVE_SECONDS = 1.6;

const KIND_TEXT = {
  one: {
    label: "One guest", log: () => "one guest, n to n + 1",
    rule: () => ["Every guest moves from room n to room n + 1.", "The new guest takes room 1."],
    why: "The rule is a bijection: everyone has a room, nobody shares, and no room is left empty.",
    done: () => "Everyone moved up one room and the new guest took room 1. The hotel is full again.",
  },
  many: {
    label: "Several guests", log: (k) => `${k} guests, n to n + ${k}`,
    rule: (k) => [`Every guest moves from room n to room n + ${k}.`, `New guest j takes room j, for j from 1 to ${k}.`],
    why: "The rule is a bijection: everyone has a room, nobody shares, and no room is left empty.",
    done: (k) => `Everyone moved up ${k} rooms and the new guests took rooms 1 to ${k}. The hotel is full again.`,
  },
  coach: {
    label: "An infinite coach", log: () => "one infinite coach, n to 2n",
    rule: () => ["Every guest moves from room n to room 2n, which fills the even rooms.", "The passenger in seat s takes room 2s − 1, which fills the odd rooms."],
    why: "The rule is a bijection: every even room gets one old guest, every odd room one passenger, and no room is left empty. Shifting everyone by a fixed number would not work here, because there is no last passenger.",
    done: () => "Every guest doubled their room number and the passengers took the odd rooms. The hotel is full again.",
  },
  coaches: {
    label: "Infinitely many coaches", log: () => "infinitely many infinite coaches, n to n(n + 1) ÷ 2",
    rule: () => ["Every guest moves from room n to room n(n + 1) ÷ 2.", "The passenger in seat s of coach c takes room (c + s − 1)(c + s) ÷ 2 + s."],
    why: "This is Cantor's pairing function, and it is a bijection. Count the guests already here as coach 0, write every (coach, seat) pair in a grid and number the grid along its diagonals: each pair gets one room and each room one pair.",
    done: () => "Each guest moved to a triangular-numbered room and every passenger of every coach has a room of their own. The hotel is full again.",
  },
};

const hotel = { kind: "one", k: 3, history: [], anim: null };
const arrival = () => (hotel.kind === "many" ? { kind: "many", k: hotel.k } : { kind: hotel.kind });

/** Short label on a token: the starting room for an original guest, a letter and numbers for a newcomer. */
function tag(who, history) {
  if (who.batch === 0) return String(who.from);
  const letter = LETTERS[who.batch - 1];
  const kind = history[who.batch - 1].kind;
  return kind === "one" ? letter : kind === "coaches" ? `${letter}${who.coach}·${who.seat}` : `${letter}${who.seat}`;
}
function describeWho(who, history) {
  if (who.batch === 0) return `the guest who started in room ${fmt.int(who.from)}`;
  const letter = LETTERS[who.batch - 1];
  const kind = history[who.batch - 1].kind;
  if (kind === "one") return `the single guest of arrival ${letter}`;
  if (kind === "many") return `guest ${fmt.int(who.seat)} of arrival ${letter}`;
  if (kind === "coach") return `the passenger from seat ${fmt.int(who.seat)} of coach ${letter}`;
  return `the passenger from seat ${fmt.int(who.seat)} of coach ${fmt.int(who.coach)} in arrival ${letter}`;
}

/* ---------- controls ---------- */
const kindSeg = segmented({
  label: "Who arrives at the full hotel", value: hotel.kind,
  options: KINDS.map((k) => ({ value: k, label: KIND_TEXT[k].label })),
  onChange: (v) => { hotel.kind = v; drawRule(); },
});
const kS = slider({ label: "Number of new guests, k", min: 2, max: 20, step: 1, value: hotel.k, format: fmt.int, onInput: (v) => { hotel.k = v; drawRule(); } });
const checkBtn = button("Check them in", checkIn, { primary: true });
const resetHotelBtn = button("Reset the hotel", () => { mover.stop(); hotel.anim = null; hotel.history = []; drawHotelState("The hotel is back to its first evening: full, with guest n in room n."); });
const capHint = el("div", { class: "hint" });
const logBox = el("div", { class: "field" });

const askN = numberField({ label: "A guest is now in room", min: 1, max: MAX_NUMBER, step: 1, value: 7 });
const askSeat = numberField({ label: "A passenger is in seat", min: 1, max: MAX_NUMBER, step: 1, value: 3 });
const askCoach = numberField({ label: "of coach", min: 1, max: MAX_NUMBER, step: 1, value: 2 });
const askM = numberField({ label: "Who ends up in room", min: 1, max: MAX_NUMBER, step: 1, value: 12 });
const ansN = el("p", { class: "small answer" });
const ansNew = el("p", { class: "small answer" });
const ansM = el("p", { class: "small answer" });
for (const f of [askN, askSeat, askCoach, askM]) f.input.addEventListener("input", drawAsk);

const hotelControls = el("div", { class: "controls" },
  kindSeg.el, kS.el,
  el("div", { class: "row" }, checkBtn, resetHotelBtn), capHint, logBox);

/* ---------- outputs ---------- */
const ruleBox = el("div");
const hotelStatus = el("p", { class: "small", role: "status" });
const hotelBox = el("div");
const roomsTable = el("details", { class: "chart-table" }, el("summary", { text: `Show rooms 1 to ${ROOMS} as a table` }), el("div", { class: "tbl-wrap" }));
const ruleTableBox = el("div");
const newcomerItem = el("div", { class: "ask-item" }, el("div", { class: "ask-pair" }, askSeat.el, askCoach.el), ansNew);
const askPanel = el("div", { class: "panel ask" },
  el("h3", { text: "Ask the selected rule" }),
  el("div", { class: "ask-grid" },
    el("div", { class: "ask-item" }, askN.el, ansN),
    newcomerItem,
    el("div", { class: "ask-item" }, askM.el, ansM)));
const hotelLegend = el("div", { class: "chart-legend" },
  el("span", {}, el("i", { style: { background: "#dce9f9", border: `1.5px solid ${BLUE}`, borderRadius: "8px", height: "12px" } }), "Guest who was here at the start (the number is their first room)"),
  el("span", {}, el("i", { style: { background: "#fde6da", border: `1.5px solid ${ORANGE}`, height: "12px" } }), "Newcomer (the letter is the arrival, then coach · seat)"));

const hotelOut = el("div", { class: "out" },
  ruleBox,
  el("div", {}, el("p", { class: "chart-title", text: `Rooms 1 to ${ROOMS} of infinitely many` }), hotelLegend, hotelBox, hotelStatus, roomsTable),
  ruleTableBox, askPanel);

/* ---------- the canvas ---------- */
const columns = (w) => (w >= 520 ? 10 : 5);
const LOBBY = 30, CELL_H = 44;

function drawHotel(ctx, W, H) {
  const cols = columns(W);
  const cw = (W - 2) / cols;
  const centre = (m) => ({ x: 1 + ((m - 1) % cols + 0.5) * cw, y: LOBBY + Math.floor((m - 1) / cols) * CELL_H + CELL_H / 2 + 6 });
  // A room beyond the ones drawn lies further down the corridor: off the bottom right corner.
  const spot = (m) => (m <= ROOMS ? centre(m) : { x: W + 30, y: H + 24, gone: true });

  ctx.fillStyle = "#f3f6f4";
  ctx.fillRect(0, 0, W, LOBBY);
  ctx.fillStyle = SLATE; ctx.font = `12px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText("Lobby: newcomers come in here", 8, LOBBY / 2);
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  for (let m = 1; m <= ROOMS; m++) {
    const x = 1 + ((m - 1) % cols) * cw, y = LOBBY + Math.floor((m - 1) / cols) * CELL_H;
    ctx.strokeRect(Math.round(x) + 0.5, y + 0.5, Math.round(cw), CELL_H);
    ctx.fillStyle = SLATE; ctx.font = `11px ${FONT}`; ctx.textAlign = "left";
    ctx.fillText(String(m), x + 5, y + 10);
  }

  const token = (x, y, label, fresh, alpha) => {
    if (alpha <= 0) return;
    ctx.globalAlpha = alpha;
    ctx.font = `600 11.5px ${FONT}`;
    const w = Math.max(24, ctx.measureText(label).width + 12), h = 20;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, fresh ? 3 : 10); else ctx.rect(x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = fresh ? "#fde6da" : "#dce9f9"; ctx.fill();
    ctx.strokeStyle = fresh ? ORANGE : BLUE; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = "center";
    ctx.fillText(label, x, y + 0.5);
    ctx.globalAlpha = 1;
  };

  if (!hotel.anim) {
    for (let m = 1; m <= ROOMS; m++) {
      const who = resident(hotel.history, m);
      const p = centre(m);
      token(p.x, p.y, tag(who, hotel.history), who.batch !== 0, 1);
    }
    return;
  }
  const a = hotel.anim.a;
  const ease = a * a * (3 - 2 * a);
  for (const t of hotel.anim.tokens) {
    const to = spot(t.to);
    const from = t.from == null ? { x: to.x, y: LOBBY / 2 } : centre(t.from);
    const alpha = to.gone ? 1 - ease : t.from == null ? Math.min(1, a * 4) : 1;
    token(from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease, t.label, t.fresh, alpha);
  }
}

const hotelCanvas = canvas(hotelBox, { height: (w) => LOBBY + (ROOMS / columns(w)) * CELL_H + 2, draw: drawHotel });
hotelCanvas.el.setAttribute("role", "img");

const mover = ticker((dt) => {
  hotel.anim.a += dt / MOVE_SECONDS;
  if (hotel.anim.a >= 1) { hotel.anim = null; mover.stop(); }
  hotelCanvas.redraw();
});

function checkIn() {
  if (hotel.history.length >= LETTERS.length) return;
  const a = arrival();
  const before = hotel.history;
  const tokens = [];
  for (let n = 1; n <= ROOMS; n++) {
    const who = resident(before, n);
    tokens.push({ label: tag(who, before), fresh: who.batch !== 0, from: n, to: moveGuest(a, n) });
  }
  hotel.history = [...before, a];
  for (let m = 1; m <= ROOMS; m++) {
    const who = whoGets(a, m);
    if (who.from == null) tokens.push({ label: tag({ batch: hotel.history.length, ...who }, hotel.history), fresh: true, from: null, to: m });
  }
  mover.stop();
  hotel.anim = reducedMotion() ? null : { tokens, a: 0 };
  drawHotelState(`Arrival ${LETTERS[hotel.history.length - 1]}: ${KIND_TEXT[a.kind].done(a.k)}`);
  if (hotel.anim) mover.start();
}

/** Everything that depends on who is in the hotel. */
function drawHotelState(message) {
  const h = hotel.history;
  hotelCanvas.redraw();
  hotelStatus.textContent = message;
  const rows = Array.from({ length: ROOMS }, (_, i) => {
    const who = resident(h, i + 1);
    return { room: fmt.int(i + 1), label: tag(who, h), who: describeWho(who, h) };
  });
  hotelCanvas.el.setAttribute("aria-label", `The first ${ROOMS} rooms of the hotel after ${h.length} arrival${h.length === 1 ? "" : "s"}. Room 1 holds ${rows[0].who}, room 2 holds ${rows[1].who}, room 3 holds ${rows[2].who}. The full list is in the table below.`);
  roomsTable.lastChild.replaceChildren(...table({ columns: [{ key: "room", label: "Room", num: true }, { key: "label", label: "Label" }, { key: "who", label: "Occupant" }], rows }).childNodes);
  logBox.replaceChildren(
    el("div", { class: "lab" }, el("span", { text: `Arrivals so far: ${h.length}` })),
    h.length
      ? el("ol", { class: "hotel-log" }, h.map((a, i) => el("li", {}, el("strong", { text: `${LETTERS[i]}: ` }), KIND_TEXT[a.kind].log(a.k))))
      : el("div", { class: "hint", text: "None yet. Every room is taken: guest n is in room n." }));
  const full = h.length >= LETTERS.length;
  checkBtn.disabled = full;
  capHint.textContent = full ? "This page has run out of letters to label arrivals with. The hotel has not run out of rooms. Reset to carry on." : "";
  capHint.hidden = !full;
}

/** Everything that depends on the selected kind of arrival. */
function drawRule() {
  const a = arrival();
  const text = KIND_TEXT[a.kind];
  kS.el.hidden = a.kind !== "many";
  checkBtn.textContent = a.kind === "one" ? "Check the guest in" : a.kind === "many" ? `Check ${a.k} guests in` : a.kind === "coach" ? "Check the coach in" : "Check the coaches in";
  ruleBox.replaceChildren(note("",
    el("strong", { text: "The room rule. " }), text.rule(a.k).join(" "),
    el("div", { class: "small muted", style: { marginTop: "6px" }, text: text.why })));

  // Who gets which room, for the first eight of everybody.
  const N = 8;
  const cols = [{ key: "who", label: "" }, ...Array.from({ length: N }, (_, i) => ({ key: `c${i + 1}`, label: String(i + 1), num: true })), { key: "more", label: "", num: true }];
  const line = (who, f, endless) => {
    const row = { who, more: endless ? "…" : "" };
    for (let i = 1; i <= N; i++) { const m = f(i); row[`c${i}`] = m == null ? "" : fmt.int(m); }
    return row;
  };
  const rows = [line("Guest already in room n", (n) => moveGuest(a, n), true)];
  if (a.kind === "one") rows.push(line("The new guest", (j) => placeNewcomer(a, j), false));
  else if (a.kind === "many") rows.push(line("New guest j", (j) => placeNewcomer(a, j), a.k > N));
  else if (a.kind === "coach") rows.push(line("Passenger in seat s", (s) => placeNewcomer(a, s), true));
  else for (let c = 1; c <= 6; c++) rows.push(line(`Coach ${c}, seat s`, (s) => placeNewcomer(a, s, c), true));
  if (a.kind === "coaches") rows.push({ who: "…and so on for every coach", more: "" });
  ruleTableBox.replaceChildren(table({
    caption: a.kind === "coaches" ? "The room each person is sent to, for n and s from 1 to 8. Follow the numbers 1, 2, 3 … and they run along the diagonals." : "The room each person is sent to, for n, j or s from 1 to 8",
    columns: cols, rows,
  }));

  // The question fields follow the kind of arrival.
  const seatLabel = askSeat.el.querySelector("label");
  seatLabel.textContent = a.kind === "many" ? "A new guest has number" : "A passenger is in seat";
  newcomerItem.hidden = a.kind === "one";   // the one new guest takes room 1, as the rule above already says
  askCoach.el.hidden = a.kind !== "coaches";
  drawAsk();
}

function drawAsk() {
  const a = arrival();
  const n = wholeNumber(askN), m = wholeNumber(askM), seat = wholeNumber(askSeat), coach = a.kind === "coaches" ? wholeNumber(askCoach) : 1;
  const bad = (target) => { target.className = "small answer bad"; target.textContent = WHOLE; };
  const good = (target, ...kids) => { target.className = "small answer"; target.replaceChildren(...kids); };

  if (n == null) bad(ansN);
  else {
    const to = moveGuest(a, n);
    good(ansN, to === n ? `They stay in room ${fmt.int(n)}.` : "They move to room ", to === n ? "" : el("strong", { text: fmt.int(to) }), to === n ? "" : ".");
  }

  if (a.kind === "one") ansNew.replaceChildren();
  else if (seat == null || coach == null) bad(ansNew);
  else {
    const to = placeNewcomer(a, seat, coach);
    if (to == null) good(ansNew, `There is no new guest ${fmt.int(seat)}: this arrival brings ${newcomers(a)}.`);
    else good(ansNew, "They take room ", el("strong", { text: fmt.int(to) }), ".");
  }

  if (m == null) bad(ansM);
  else {
    const who = whoGets(a, m);
    good(ansM, who.from != null
      ? (who.from === m ? `The guest already in room ${fmt.int(m)}, who does not move.` : `The guest who was in room ${fmt.int(who.from)}.`)
      : a.kind === "one" ? "The new guest."
        : a.kind === "many" ? `New guest ${fmt.int(who.seat)}.`
          : a.kind === "coach" ? `The passenger from seat ${fmt.int(who.seat)}.`
            : `The passenger from seat ${fmt.int(who.seat)} of coach ${fmt.int(who.coach)}.`);
  }
}

/* ====================================================================== Part 2: Cantor's diagonal */

const MAX_ADDED = 12;
const diag = { rule: "periodic", seed: 23, typed: [], errors: [], n: 10, added: 0 };
const EXAMPLES = [
  { label: "Three patterns", text: "01\n0011\n1" },
  { label: "Try to trap it", text: "1\n10\n101\n1010\n10100" },
];

const ruleSel = select({
  label: "The list is generated by", value: diag.rule, options: RULES.map((r) => ({ value: r.key, label: r.label })),
  onChange: (v) => { diag.rule = v; diag.added = 0; drawDiagonal("rule"); },
});
const ruleHint = el("div", { class: "hint" });
ruleSel.el.append(ruleHint);
const seedS = slider({ label: "Seed for the coin flips", min: 1, max: 99, step: 1, value: diag.seed, format: fmt.int, onInput: (v) => { diag.seed = v; diag.added = 0; drawDiagonal("rule"); } });
const typedArea = textArea({
  label: "Your own rows, one per line (optional)", value: "", placeholder: "for example 0110", rows: 4, mono: true,
  hint: "Use 0 and 1. A row repeats for ever, so 0110 means 0110 0110 0110 … Your rows go at the top of the list and the rule supplies every row after them.",
  onInput: readTyped,
});
function readTyped() {
  const parsed = parseRows(typedArea.value);
  diag.typed = parsed.rows;
  diag.errors = parsed.errors;
  diag.added = 0;
  drawDiagonal("rule");
}
const exampleRow = el("div", { class: "row" },
  EXAMPLES.map((e) => button(e.label, () => { typedArea.value = e.text; readTyped(); }, { small: true })),
  button("Clear my rows", () => { typedArea.value = ""; readTyped(); }, { small: true }));
const nS = slider({ label: "Rows and digits shown", min: 4, max: 20, step: 1, value: diag.n, format: fmt.int, onInput: (v) => { diag.n = v; drawDiagonal(); } });
const kField = numberField({ label: "Compare the new sequence with row", min: 1, max: MAX_NUMBER, step: 1, value: 7, hint: "Any row, including ones far below those shown." });
kField.input.addEventListener("input", () => drawDiagonal());
const addBtn = button("Add the missing sequence to the list", () => { if (diag.added < MAX_ADDED) { diag.added++; drawDiagonal("added"); } }, { primary: true });
const restartBtn = button("Remove the added sequences", () => { diag.added = 0; drawDiagonal("restart"); });

const diagControls = el("div", { class: "controls" }, ruleSel.el, seedS.el, typedArea.el, exampleRow, nS.el, kField.el);

const typedNote = el("div");
const gridBox = el("div", { class: "tbl-wrap" });
const compareBox = el("div");
const addStatus = el("p", { class: "small", role: "status" });
const diagOut = el("div", { class: "out" },
  typedNote,
  el("div", {}, el("p", { class: "chart-title", text: "The list, its diagonal, and the diagonal flipped: a sequence the list does not contain" }), gridBox),
  compareBox,
  note("",
    el("strong", { text: "Why it cannot be in the list. " }),
    "Suppose the new sequence were in some row, say row k. Then its digit k would have to match digit k of row k. It was built to have the opposite digit there, so it is in no row at all. Nothing in that depended on which list you began with, so adding the sequence does not help: the longer list has a diagonal too."),
  el("div", { class: "row" }, addBtn, restartBtn),
  addStatus);

function drawDiagonal(event) {
  const list = makeList({ typed: diag.typed, rule: diag.rule, seed: diag.seed, added: diag.added });
  const n = diag.n;
  const k = wholeNumber(kField);
  const rule = RULES.find((r) => r.key === diag.rule);
  ruleHint.textContent = rule.detail;
  seedS.el.hidden = diag.rule !== "coin";
  typedNote.replaceChildren(...(diag.errors.length ? [note("bad", el("strong", { text: "Some typed rows were left out. " }), diag.errors.join(" "))] : []));

  const SOURCE = { added: "added", typed: "yours", rule: "rule" };
  const idx = Array.from({ length: n }, (_, i) => i + 1);
  const head = el("tr", {}, el("th", { class: "lab", scope: "col", text: "Row" }), el("th", { class: "lab", scope: "col", text: "From" }), idx.map((j) => el("th", { scope: "col", text: String(j) })), el("th", { "aria-hidden": "true", text: "…" }));
  const body = idx.map((r) => el("tr", { class: r === k ? "cmp" : null },
    el("th", { class: "lab", scope: "row", text: String(r) }),
    el("td", { class: "src", text: SOURCE[list.source(r)] }),
    idx.map((j) => el("td", { class: j === r ? "diag" : null, text: String(list.bit(r, j)) })),
    el("td", { class: "more", text: "…" })));
  const foot = [
    el("tr", {}, el("th", { class: "lab", scope: "row", colspan: "2", text: "Diagonal" }), idx.map((j) => el("td", { class: "diag", text: String(list.bit(j, j)) })), el("td", { class: "more", text: "…" })),
    el("tr", { class: "miss" }, el("th", { class: "lab", scope: "row", colspan: "2", text: "Flipped" }), idx.map((j) => el("td", { class: j === k ? "hit" : null, text: String(list.missing(j)) })), el("td", { class: "more", text: "…" })),
  ];
  gridBox.replaceChildren(el("table", { class: "seq" },
    el("caption", { class: "sr-only", text: `The first ${n} digits of the first ${n} rows of the list, the digits on the diagonal, and the same digits flipped.` }),
    el("thead", {}, head), el("tbody", {}, body), el("tfoot", {}, foot)));

  if (k == null) compareBox.replaceChildren(note("bad", WHOLE));
  else {
    const d = list.bit(k, k);
    const first = list.firstDifference(k);
    compareBox.replaceChildren(note("good",
      el("strong", { text: `Row ${fmt.int(k)}: ` }),
      `it has ${d} at position ${fmt.int(k)}, so the new sequence has ${1 - d} there and cannot be row ${fmt.int(k)}. `,
      first < k ? `The two already part company at position ${fmt.int(first)}; position ${fmt.int(k)} is the one the construction guarantees.` : `That is also the first position at which the two differ.`,
      k > n ? " This row is below the ones shown, and the same argument reaches it." : ""));
  }

  addBtn.disabled = diag.added >= MAX_ADDED;
  restartBtn.disabled = diag.added === 0;
  if (event === "added") {
    addStatus.textContent = diag.added >= MAX_ADDED
      ? `You have added ${MAX_ADDED} sequences and the list is still missing one. The page stops here; the argument does not.`
      : `Added as row 1, and every other row moved down one, as in the hotel. The longer list has a new diagonal and so a new missing sequence. Sequences added so far: ${diag.added}. Still missing: at least one.`;
  } else if (event === "restart") addStatus.textContent = "The added sequences are out and the list is as it began. Its diagonal still produces a sequence that is not in it.";
  else if (event === "rule") addStatus.textContent = "";
}

/* ====================================================================== page */

$("#app").append(
  el("div", { class: "lab-part" },
    el("h2", { text: "Part 1: Hilbert's Hotel" }),
    el("p", { class: "muted small", text: "The hotel has a room for every whole number and every room is taken. Choose who turns up, read the rule that makes space, and check them in. Arrivals pile up until you reset." }),
    el("div", { class: "tool-grid" }, hotelControls, hotelOut)),
  el("div", { class: "lab-part" },
    el("h2", { text: "Part 2: Cantor's diagonal" }),
    el("p", { class: "muted small", text: "A list gives one infinite sequence of 0s and 1s to every row number. Flip the digits on its diagonal and you have a sequence that differs from every row. No list survives this, however it was made." }),
    el("div", { class: "tool-grid" }, diagControls, diagOut)));

drawRule();
drawHotelState("The hotel is full: guest n is in room n. Choose who arrives and check them in.");
drawDiagonal();
