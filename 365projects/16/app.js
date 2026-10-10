// Day 16: Argument Map Builder. Interface.
import { $, el, svgEl, mount, segmented, checkbox, textField, textArea, button, stat, note, store, download } from "../kit/kit.js";
import { PRESETS, LIMITS, analyse, layout, reasonsByClaim, blankMap, addClaim, editClaim, deleteClaim, setConclusion, setReason, deleteReason, fromLines, toJSON, fromJSON } from "./logic.js";

mount();

const db = store("day16");
const saved = db.get("map");
const restored = saved ? fromJSON(saved) : null;
const state = {
  map: restored?.map ?? structuredClone(PRESETS[0].map),
  off: new Set(restored?.map ? db.get("off", []) : []),
  undo: [], undoKey: null,
  form: null,        // { claim, reason, picked: Set, error } while a reason is being added or edited
  flash: null,       // { kind, text } shown once under the toolbar
};
let a = null;        // the current analysis
let num = new Map(); // claim id -> its number on the page

const claimOf = (id) => state.map.claims.find((c) => c.id === id);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const WORDS = { critical: "critical", redundant: "redundant", idle: "idle", unused: "unused", removed: "removed", restores: "removed", inplay: "in play" };
const MEANING = {
  critical: "Critical: remove it alone and the conclusion falls.",
  redundant: "Redundant: it does work in one line of support, but another line still holds without it.",
  idle: "Idle: no smallest set of premises that carries the conclusion includes it.",
  unused: "Unused: the conclusion does not rest on it anywhere in the map.",
  removed: "Removed: switched out of the argument.",
  restores: "Removed, and putting it back alone would restore the conclusion.",
  inplay: "In play, but the conclusion has fallen without the removed premises.",
};

/* ---------- state changes ---------- */
function commit(result, { key = null, keepOff = true, flash = null, editor = true } = {}) {
  if (result.error) { state.flash = { kind: "bad", text: result.error }; render({ editor: false }); return false; }
  if (!key || key !== state.undoKey) {
    state.undo.push({ map: state.map, off: [...state.off] });
    if (state.undo.length > 60) state.undo.shift();
  }
  state.undoKey = key;
  state.map = result.map;
  if (!keepOff) { state.off = new Set(); centre = true; }
  state.flash = flash;
  render({ editor });
  return true;
}
function undo() {
  const last = state.undo.pop();
  if (!last) return;
  state.map = last.map;
  state.off = new Set(last.off);
  state.form = null;
  state.undoKey = null;
  centre = true;
  state.flash = { kind: "", text: "Undone." };
  render();
}
function toggle(id) {
  state.off.has(id) ? state.off.delete(id) : state.off.add(id);
  state.flash = null;
  render({ editor: false });
}
function setOff(ids) {
  state.off = new Set(ids);
  state.flash = null;
  render({ editor: false });
}

/* ---------- toolbar ---------- */
const fileInput = el("input", { type: "file", accept: ".json,application/json", hidden: true, "aria-label": "Argument map file" });
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  let text = "";
  try { text = await file.text(); } catch { /* reported as invalid JSON below */ }
  state.form = null;
  commit(fromJSON(text), { keepOff: false, flash: { kind: "good", text: `Loaded ${file.name}.` } });
});
const undoBtn = button("Undo", undo, { small: true });
const resetBtn = button("Put every premise back", () => setOff([]), { small: true });
const load = (map, text) => { state.form = null; commit({ map: structuredClone(map) }, { keepOff: false, flash: text ? { kind: "", text } : null }); };

const toolbar = el("div", { class: "am-bar" },
  el("div", { class: "row" },
    el("span", { class: "am-lab", text: "Examples" }),
    PRESETS.map((p) => button(p.label, () => load(p.map), { small: true })),
    button("Write your own", () => { quick.premises.input.scrollIntoView({ block: "center" }); quick.premises.input.focus({ preventScroll: true }); }, { small: true, primary: true })),
  el("div", { class: "row" },
    undoBtn, resetBtn,
    button("Export JSON", () => download(`${state.map.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "argument"}.json`, toJSON(state.map), "application/json"), { small: true }),
    button("Import JSON", () => fileInput.click(), { small: true }),
    button("New blank map", () => load(blankMap(), "A blank map. Rename the conclusion, add claims, then give the conclusion a reason."), { small: true }),
    fileInput));

/* ---------- outputs ---------- */
const flashBox = el("div");
const verdict = el("div", { role: "status" });
const sVerdict = stat("Main conclusion");
const sPlay = stat("Premises in play");
const sCritical = stat("Critical premises");
const sObjection = stat("Smallest objection");
const mapTitle = el("h3");
const mapBox = el("div", { class: "am-map", tabindex: "0", role: "region", "aria-label": "Argument map" });
const wideHint = el("p", { class: "small muted", hidden: true, text: "The map is wider than this screen. Drag it sideways to see the rest, or read it as text below." });
const outlineBox = el("div");
const premiseBox = el("div", { class: "panel am-panel" });
const linesBox = el("div", { class: "panel am-panel" });
const editorBox = el("div", { class: "panel am-panel" });

const legend = el("ul", { class: "am-legend small muted" },
  el("li", {}, el("i", { class: "k-box" }), "stands"),
  el("li", {}, el("i", { class: "k-box down" }), "falls, or removed"),
  el("li", {}, el("i", { class: "k-box crit" }), "critical premise"),
  el("li", {}, el("i", { class: "k-dot" }), "lines that meet at a dot are one reason: its premises work together"),
  el("li", {}, el("i", { class: "k-arrow" }), "each arrow into a claim is a separate reason"));

/* ---------- quick start ---------- */
const quick = {
  premises: textArea({ label: "Premises, one per line", rows: 4, placeholder: "All humans are mortal.\nSocrates is a human." }),
  conclusion: textField({ label: "Conclusion", placeholder: "Socrates is mortal." }),
  mode: segmented({
    label: "The premises", value: "linked",
    options: [{ value: "linked", label: "Work together" }, { value: "convergent", label: "Each stand alone" }],
    hint: "Together (linked): the conclusion needs all of them. Alone (convergent): each is a separate reason, and one is enough.",
  }),
  message: el("div"),
};
const quickBox = el("div", { class: "panel am-panel" },
  el("h3", { text: "Start from your own argument" }),
  el("p", { class: "small muted", text: "This replaces the map with a one-step argument. Add sub-arguments and further reasons in the editor afterwards." }),
  quick.premises.el, quick.conclusion.el, quick.mode.el,
  el("div", { class: "row" }, button("Draw this argument", () => {
    const res = fromLines(quick.premises.value, quick.conclusion.value, quick.mode.value);
    if (res.error) { quick.message.replaceChildren(note("bad", res.error)); return; }
    quick.message.replaceChildren();
    state.form = null;
    commit(res, { keepOff: false, flash: { kind: "good", text: `Drawn: ${plural(res.map.claims.length - 1, "premise")} and a conclusion.` } });
    toolbar.scrollIntoView({ block: "start" });
  }, { primary: true })),
  quick.message);

$("#app").append(
  toolbar, flashBox, verdict,
  el("div", { class: "stats" }, sVerdict.el, sPlay.el, sCritical.el, sObjection.el),
  el("div", { class: "am-mapwrap" },
    mapTitle,
    el("p", { class: "small muted", text: "Click a premise to remove it from the argument, and again to put it back. The numbers match the lists below." }),
    mapBox, wideHint, legend, outlineBox),
  el("div", { class: "grid2" }, premiseBox, linesBox),
  el("h2", { class: "am-h", text: "Build your own" }),
  el("div", { class: "grid2" }, quickBox, editorBox));

/* ---------- the drawn map ---------- */
const pen = document.createElement("canvas").getContext("2d");
const widthOf = (font) => (s) => { pen.font = font; return pen.measureText(s).width; };
const bodyWidth = widthOf('12.5px "Hanken Grotesk", system-ui, sans-serif');
const tagWidth = widthOf('700 10.5px "Hanken Grotesk", system-ui, sans-serif');

function tagOf(id) {
  if (id === state.map.conclusion) return `Conclusion · ${!a.argued ? "not argued" : a.conclusionStands ? "stands" : "falls"}`;
  const p = a.premises.find((q) => q.id === id);
  if (!p) return `Sub-conclusion${a.stands.get(id) ? "" : " · falls"}`;
  const word = p.role === "inplay" ? "" : WORDS[p.role];
  return `${claimOf(id).unstated ? "Unstated" : "Premise"}${word ? ` · ${word}` : ""}`;
}

let centre = true; // bring the main conclusion into view the next time the map is drawn
function drawMap() {
  const narrow = (mapBox.clientWidth || 800) < 560;
  const L = layout(state.map, { nodeWidth: narrow ? 156 : 172, gapX: narrow ? 14 : 20, measure: bodyWidth });
  const svg = svgEl("svg", { width: L.width, height: L.height, viewBox: `0 0 ${L.width} ${L.height}` });
  for (const link of L.links) {
    const holds = a.holds.get(link.id);
    const g = svgEl("g", { class: "link" });
    for (const m of link.members) {
      const mid = (m.y + link.y) / 2;
      g.append(svgEl("path", { class: a.stands.get(m.id) ? "" : "dead", d: `M${m.x},${m.y}C${m.x},${mid} ${link.x},${mid} ${link.x},${link.y}` }));
    }
    const { x, y } = link.tip;
    g.append(svgEl("path", { class: holds ? "" : "dead", d: `M${link.x},${link.y}V${y + 9}` }));
    g.append(svgEl("path", { class: `m-tip${holds ? "" : " dead"}`, d: `M${x},${y + 1.5}l-6,10h12z` }));
    if (link.members.length > 1) g.append(svgEl("circle", { class: holds ? "" : "dead", cx: link.x, cy: link.y, r: 4.5 }));
    svg.append(g);
  }
  for (const n of L.nodes) {
    const c = claimOf(n.id);
    const p = a.premises.find((q) => q.id === n.id);
    const main = n.id === state.map.conclusion;
    const cls = ["node", main && "main", !a.stands.get(n.id) && "down", p && "premise", p && !p.on && "off", p?.role === "critical" && "critical", c.unstated && "unstated"].filter(Boolean).join(" ");
    const tag = tagOf(n.id);
    const room = n.w - 20 - 22;
    const body = svgEl("text", { class: "m-body", x: 10, y: 37 }, n.lines.map((line, i) => svgEl("tspan", { x: 10, dy: i ? 16 : 0 }, line)));
    const g = svgEl("g", { class: cls, transform: `translate(${n.x},${n.y})`, "data-key": `node-${n.id}` },
      svgEl("title", {}, `${num.get(n.id)}. ${c.text}`),
      svgEl("rect", { class: "m-box", width: n.w, height: n.h, rx: 4 }),
      p?.role === "critical" ? svgEl("path", { class: "m-bar", d: `M0,4a4,4 0 0 1 4,-4h2v${n.h}h-2a4,4 0 0 1 -4,-4z` }) : null,
      svgEl("text", { class: "m-tag", x: 10, y: 19, textLength: tagWidth(tag) > room ? room : null, lengthAdjust: "spacingAndGlyphs" }, tag),
      svgEl("text", { class: "m-num", x: n.w - 10, y: 19, "text-anchor": "end" }, String(num.get(n.id))),
      body);
    if (p) {
      g.setAttribute("role", "switch");
      g.setAttribute("tabindex", "0");
      g.setAttribute("aria-checked", String(p.on));
      g.setAttribute("aria-label", `Premise ${num.get(n.id)}: ${c.text} ${MEANING[p.role]}`);
      g.addEventListener("click", () => toggle(n.id));
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(n.id); } });
    }
    svg.append(g);
  }
  const at = mapBox.scrollLeft;
  mapBox.replaceChildren(svg);
  const wide = mapBox.scrollWidth > mapBox.clientWidth + 1;
  wideHint.hidden = !wide;
  if (centre) {
    const top = L.nodes.find((n) => n.id === state.map.conclusion);
    mapBox.scrollLeft = wide ? top.x + top.w / 2 + 14 - mapBox.clientWidth / 2 : 0;
    centre = false;
  } else mapBox.scrollLeft = at;
}

/* ---------- lists ---------- */
const chip = (id) => el("span", { class: "am-chip", title: claimOf(id).text, text: String(num.get(id)) });
const chips = (ids) => el("span", { class: "am-set" }, ids.flatMap((id, i) => (i ? [el("span", { class: "muted", text: "+" }), chip(id)] : [chip(id)])));

function drawOutline() {
  const by = reasonsByClaim(state.map);
  const shown = new Set();
  const status = (id) => {
    const p = a.premises.find((q) => q.id === id);
    if (p) return `${claimOf(id).unstated ? "unstated premise" : "premise"}, ${WORDS[p.role]}`;
    if (id === state.map.conclusion) return `main conclusion, ${!a.argued ? "not argued" : a.conclusionStands ? "stands" : "falls"}`;
    return a.stands.get(id) ? "stands" : "falls";
  };
  const visited = new Set();
  const item = (id) => {
    visited.add(id);
    const li = el("li", {}, el("strong", { text: `${num.get(id)}. ` }), claimOf(id).text, " ", el("span", { class: "muted", text: `(${status(id)})` }));
    const reasons = by.get(id);
    if (!reasons.length) return li;
    if (shown.has(id)) { li.append(el("span", { class: "muted", text: " Its support is listed above." })); return li; }
    shown.add(id);
    li.append(el("ul", {}, reasons.map((r, j) => el("li", {},
      el("em", { text: `${reasons.length > 1 ? `Reason ${j + 1}` : "Reason"}${r.premises.length > 1 ? `, ${r.premises.length} premises together` : ""} ` }),
      el("span", { class: "muted", text: a.holds.get(r.id) ? "(holds)" : "(broken)" }),
      el("ul", {}, r.premises.map(item))))));
    return li;
  };
  const list = el("ul", { class: "am-outline" }, item(state.map.conclusion));
  // Claims the conclusion does not rest on, starting from the ones that support nothing themselves.
  const used = new Set(state.map.reasons.flatMap((r) => r.premises));
  const loose = [];
  for (const c of [...state.map.claims.filter((c) => !used.has(c.id)), ...state.map.claims]) if (!visited.has(c.id)) loose.push(item(c.id));
  const open = outlineBox.querySelector("details")?.open;
  outlineBox.replaceChildren(el("details", { class: "chart-table", open: open || null },
    el("summary", { text: "Read the map as text" }), list,
    loose.length ? el("p", { class: "small muted", text: "Not connected to the main conclusion:" }) : null,
    loose.length ? el("ul", { class: "am-outline" }, loose) : null));
}

function drawPremises() {
  const seen = [...new Set(a.premises.map((p) => p.role))];
  premiseBox.replaceChildren(
    el("h3", { text: "Premises" }),
    a.premises.length
      ? el("p", { class: "small muted", text: "Untick a premise to remove it. A premise is a claim the map gives no reason for." })
      : el("p", { class: "small muted", text: "No premises yet. Add a claim in the editor, then use it in a reason." }),
    el("div", { class: "am-prems" }, a.premises.map((p) => {
      const box = checkbox({ label: `${num.get(p.id)}. ${claimOf(p.id).text}`, checked: p.on, onChange: () => toggle(p.id) });
      box.input.dataset.key = `prem-${p.id}`;
      return el("div", { class: "am-prem" }, box.el, el("span", { class: `am-pill ${p.role}`, text: p.role === "restores" ? "would restore" : WORDS[p.role] }));
    })),
    el("ul", { class: "am-key small muted" }, seen.map((r) => el("li", { text: MEANING[r] }))));
}

function drawLines() {
  const kids = [el("h3", { text: "Lines of support" })];
  if (!a.argued) kids.push(el("p", { class: "small muted", text: "The main conclusion has no reason yet, so there is nothing to carry it." }));
  else if (!a.supports) kids.push(note("warn", `This map has more than ${LIMITS.sets.toLocaleString("en-GB")} different ways to support its conclusion, too many to list. The map and the premise roles are still exact.`));
  else {
    kids.push(el("p", { class: "small muted", text: "Each line is a smallest set of premises that is enough for the conclusion by itself. Hover a number for its text." }));
    kids.push(el("ol", { class: "am-sets" }, a.supports.slice(0, 12).map((s) => el("li", {}, chips(s.premises), el("span", { class: `am-pill ${s.intact ? "intact" : "removed"}`, text: s.intact ? "intact" : "broken" })))));
    if (a.supports.length > 12) kids.push(el("p", { class: "small muted", text: `and ${a.supports.length - 12} more.` }));
  }
  const setList = (sets, label, act) => {
    const size = sets[0].length;
    const smallest = sets.filter((s) => s.length === size);
    return [
      el("ul", { class: "am-sets" }, smallest.slice(0, 10).map((s) => el("li", {}, chips(s), button(label, () => act(s), { small: true })))),
      smallest.length > 10 || sets.length > smallest.length
        ? el("p", { class: "small muted", text: `${smallest.length > 10 ? `${smallest.length - 10} more of this size. ` : ""}${sets.length > smallest.length ? `${plural(sets.length - smallest.length, "larger set")} would also do it.` : ""}` })
        : null,
    ];
  };
  if (a.argued && a.conclusionStands && a.objections?.length) {
    kids.push(el("h3", { text: "Smallest objections" }),
      el("p", { class: "small muted", text: `From here the conclusion cannot be brought down without removing at least ${plural(a.objections[0].length, "premise")}. Removing every premise in any one of these sets does it.` }),
      ...setList(a.objections, "Remove", (s) => setOff([...state.off, ...s])));
  } else if (a.argued && !a.conclusionStands && a.repairs?.length) {
    kids.push(el("h3", { text: "Smallest repairs" }),
      el("p", { class: "small muted", text: `The conclusion has fallen. Putting back every premise in any one of these sets restores it; the smallest needs ${plural(a.repairs[0].length, "premise")}.` }),
      ...setList(a.repairs, "Put back", (s) => setOff([...state.off].filter((id) => !s.includes(id)))));
  }
  linesBox.replaceChildren(...kids.filter(Boolean));
}

/* ---------- the editor ---------- */
const titleField = textField({ label: "Title of the map", onInput: (v) => { state.map = { ...state.map, title: v.trim().slice(0, 80) || "Untitled argument" }; save(); mapTitle.textContent = state.map.title; } });
const addField = textField({ label: "New claim", placeholder: "Type a claim, then add it" });
const addMessage = el("div");
const addNew = () => {
  const res = addClaim(state.map, addField.value);
  addMessage.replaceChildren(...(res.error ? [note("bad", res.error)] : []));
  if (res.error) return;
  commit(res);
  addField.value = "";
  addField.input.focus();
};
addField.input.addEventListener("keydown", (e) => { if (e.key === "Enter") addNew(); });
const addRow = el("div", { class: "am-add" }, addField.el, button("Add claim", addNew, { primary: true }), addMessage);

function reasonForm(c) {
  const f = state.form;
  const others = state.map.claims.filter((o) => o.id !== c.id);
  const close = () => { state.form = null; drawEditor(); };
  return el("div", { class: "am-form" },
    el("p", { class: "small", text: f.reason
      ? `Change which claims make up this reason for claim ${num.get(c.id)}.`
      : `Tick the claims that together make one reason for claim ${num.get(c.id)}. They are linked: lose any one and this reason fails. For a second, independent reason, save this one and add another.` }),
    others.length
      ? el("div", { class: "am-picks" }, others.map((o) => checkbox({ label: `${num.get(o.id)}. ${o.text}`, checked: f.picked.has(o.id), onChange: (on) => { on ? f.picked.add(o.id) : f.picked.delete(o.id); } }).el))
      : note("", "There is no other claim to use yet. Add a claim above first."),
    f.error ? note("bad", f.error) : null,
    el("div", { class: "row" },
      button("Save reason", () => {
        const res = setReason(state.map, c.id, [...f.picked], f.reason);
        if (res.error) { f.error = res.error; drawEditor(); return; }
        state.form = null;
        commit(res);
      }, { small: true, primary: true }),
      button("Cancel", close, { small: true })));
}

function drawEditor() {
  const by = reasonsByClaim(state.map);
  if (state.form && !claimOf(state.form.claim)) state.form = null;
  if (document.activeElement !== titleField.input) titleField.value = state.map.title;
  editorBox.replaceChildren(
    el("h3", { text: "Edit the map" }),
    titleField.el, addRow,
    el("ol", { class: "am-claims" }, state.map.claims.map((c) => {
      const main = c.id === state.map.conclusion;
      const input = el("input", { type: "text", value: c.text, maxlength: LIMITS.text, "aria-label": `Text of claim ${num.get(c.id)}`, "data-key": `text-${c.id}`, autocomplete: "off" });
      input.addEventListener("input", () => {
        const res = editClaim(state.map, c.id, { text: input.value });
        input.classList.toggle("invalid", Boolean(res.error));
        if (!res.error) commit(res, { key: `text-${c.id}`, editor: false });
      });
      input.addEventListener("blur", () => { if (!input.value.trim()) { input.value = claimOf(c.id)?.text ?? ""; input.classList.remove("invalid"); } });
      const hidden = checkbox({ label: "Unstated", checked: c.unstated, onChange: (on) => commit(editClaim(state.map, c.id, { unstated: on }), { editor: false }) });
      hidden.el.title = "Mark a premise the argument relies on but does not say out loud";
      const open = state.form?.claim === c.id;
      return el("li", { class: `am-claim${main ? " main" : ""}` },
        el("div", { class: "am-claim-top" }, el("span", { class: "am-chip", text: String(num.get(c.id)) }), input),
        el("div", { class: "row am-actions" },
          main ? el("span", { class: "am-pill main", text: "Main conclusion" }) : button("Make main conclusion", () => commit(setConclusion(state.map, c.id)), { small: true }),
          button("Add a reason", () => { state.form = { claim: c.id, reason: null, picked: new Set(), error: null }; drawEditor(); }, { small: true }),
          hidden.el,
          main ? null : button("Delete", () => { if (state.form?.claim === c.id) state.form = null; commit(deleteClaim(state.map, c.id)); }, { small: true })),
        by.get(c.id).length ? el("ul", { class: "am-reasons" }, by.get(c.id).map((r, j) => el("li", {},
          el("span", {}, `Reason ${j + 1}: `, chips(r.premises), r.premises.length > 1 ? " together" : ""),
          button("Edit", () => { state.form = { claim: c.id, reason: r.id, picked: new Set(r.premises), error: null }; drawEditor(); }, { small: true }),
          button("Remove", () => { state.form = null; commit(deleteReason(state.map, r.id)); }, { small: true })))) : null,
        open ? reasonForm(c) : null);
    })));
}

/* ---------- render ---------- */
function save() {
  db.set("map", state.map);
  db.set("off", [...state.off]);
}

function render({ editor = true } = {}) {
  num = new Map(state.map.claims.map((c, i) => [c.id, i + 1]));
  a = analyse(state.map, state.off);
  state.off = new Set(a.premises.filter((p) => !p.on).map((p) => p.id)); // forget switches on claims that are no longer premises
  save();

  const focusKey = document.activeElement?.dataset?.key;
  flashBox.replaceChildren(...(state.flash ? [note(state.flash.kind, state.flash.text)] : []));
  undoBtn.disabled = !state.undo.length;
  resetBtn.disabled = !state.off.size;
  mapTitle.textContent = state.map.title;

  const { counts } = a;
  const critical = a.premises.filter((p) => p.role === "critical");
  const quote = (id) => `“${claimOf(id).text}”`;
  let kind, text;
  if (!a.argued) {
    kind = ""; text = "The main conclusion has no reason yet, so this is an assertion and not an argument. Add a claim in the editor below, then use “Add a reason” on the conclusion.";
  } else if (a.conclusionStands) {
    kind = "good";
    const rest = counts.inPlay - counts.critical - counts.unused;
    text = `The conclusion stands on ${plural(counts.inPlay - counts.unused, "premise")}. `;
    if (critical.length === 1) text += `One is critical: remove ${quote(critical[0].id)} alone and the conclusion falls.${rest ? ` ${rest === 1 ? "The other one" : `Each of the other ${rest}`} can go without bringing it down.` : ""}`;
    else if (critical.length) text += `${critical.length === counts.inPlay - counts.unused ? "Every one of them is" : `${critical.length} of them are`} critical: remove any one of those alone and the conclusion falls.`;
    else text += `None is critical: the conclusion survives the loss of any single premise${a.objections?.length ? `, and it takes ${a.objections[0].length} removed together to bring it down` : ""}.`;
  } else {
    kind = "warn";
    const back = a.premises.filter((p) => p.role === "restores");
    text = `The conclusion falls: with ${plural(counts.premises - counts.inPlay, "premise")} removed, no reason for it is left whole. `;
    text += back.length ? `Putting back ${back.length === 1 ? quote(back[0].id) : `any one of premises ${back.map((p) => num.get(p.id)).join(", ")}`} would restore it.`
      : a.repairs?.length ? `No single premise restores it; the smallest repair puts back ${a.repairs[0].length}.` : "";
  }
  verdict.replaceChildren(note(kind, text));

  const intact = a.supports?.filter((s) => s.intact).length;
  sVerdict.set(!a.argued ? "Not argued" : a.conclusionStands ? "Stands" : "Falls", a.supports && a.argued ? `${intact} of ${plural(a.supports.length, "line")} of support intact` : "");
  sPlay.set(`${counts.inPlay} of ${counts.premises}`, counts.premises - counts.inPlay ? `${counts.premises - counts.inPlay} removed` : "none removed");
  sCritical.set(a.argued && a.conclusionStands ? String(counts.critical) : "–", a.argued && a.conclusionStands ? "remove one alone and the conclusion falls" : a.argued ? "nothing is critical once the conclusion has fallen" : "");
  const smallest = a.objections?.[0]?.length;
  sObjection.set(smallest ? plural(smallest, "premise") : "–", smallest ? `${plural(a.objections.filter((s) => s.length === smallest).length, "way")} to do it` : a.argued && !a.conclusionStands ? "already fallen" : "");

  drawMap();
  drawOutline();
  drawPremises();
  drawLines();
  if (editor) drawEditor();
  if (focusKey && document.activeElement?.dataset?.key !== focusKey) $(`#app [data-key="${focusKey}"]`)?.focus({ preventScroll: true });
}

render();
// The node text is measured with the page font, so draw again once it has loaded, and when the width changes.
document.fonts?.ready.then(() => { centre = true; drawMap(); });
let lastWidth = mapBox.clientWidth;
new ResizeObserver(() => { if (mapBox.clientWidth !== lastWidth) { lastWidth = mapBox.clientWidth; centre = true; drawMap(); } }).observe(mapBox);
