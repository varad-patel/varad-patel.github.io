// Day 119: Belief Updater. Interface.
import { $, $$, el, fmt, mount, segmented, checkbox, textField, textArea, button, stat, note, chart, store, download } from "../kit/kit.js";
import {
  FORMAT, VERSION, LIMITS, localToday, logit, sigmoid, percentText, oddsText, ratioText, parseProbability, checkPrior,
  evaluate, newClaim, addItem, editItem, removeItem, toJSON, parseImport, mergeClaims, restore, EXAMPLES, exampleClaim, newId,
} from "./logic.js";

mount();

const app = $("#app");
const db = store("day119");
const KEY = "365:day119:data"; // the key store("day119") gives to "data"
const state = { claims: [], current: null, saved: false, editing: null, flash: null, unsaved: false, newer: null, scale: "prob", mode: "probs" };
const examples = () => EXAMPLES.map((e) => exampleClaim(e.key, localToday(), `example-${e.key}`));

/* ---------- loading what is saved ---------- */
// Can this browser keep anything at all? (Storage switched off, or full.)
const storageOff = !db.set("probe", 1);
db.remove("probe");
const newerText = (v) => `The claims saved in this browser were written by a newer version of this page (format version ${v}; this one reads version ${VERSION}), so this page will not read or change them. Reload the page to get the latest version.`;
{
  const restored = restore(db.get("data"), localToday());
  let raw = null, had = null;
  try { raw = localStorage.getItem(KEY); had = JSON.parse(raw)?.claims?.length ?? null; } catch { /* storage off, or not JSON */ }
  if (restored && restored.claims.length) {
    state.claims = restored.claims;
    state.current = restored.claims.some((c) => c.id === restored.current) ? restored.current : restored.claims[0].id;
    state.saved = true;
  } else {
    state.claims = examples();
    state.current = state.claims[0].id;
  }
  const kept = restored ? restored.claims.length : null;
  if (restored?.newer) { state.newer = restored.newer; state.unsaved = true; }
  else if (raw != null && (kept === null || kept !== had)) {
    try { localStorage.setItem(`${KEY}-unread`, raw); } catch { /* nothing more can be done */ }
    state.flash = { kind: "bad", text: `${kept ? `Only ${kept} of the ${had} claims saved in this browser could be read.` : "The claims saved in this browser could not be read, so the examples are shown."} The saved data has not been deleted: a copy is under the storage key ${KEY}-unread.` };
  }
}
const current = () => state.claims.find((c) => c.id === state.current) ?? state.claims[0];

// The one place that writes. It never overwrites claims written by a newer version of the page. A failure is shown
// by render() for as long as it lasts, so a success message cannot hide it.
function save() {
  const stored = db.get("data");
  state.newer = typeof stored?.version === "number" && stored.version > VERSION ? stored.version : null;
  if (state.newer) { state.unsaved = true; return; }
  state.saved = true;
  state.unsaved = !db.set("data", { format: FORMAT, version: VERSION, claims: state.claims, current: state.current });
}
function replaceClaim(next) {
  state.claims = state.claims.map((c) => (c.id === next.id ? next : c));
  save();
}

// Another tab changed or erased the saved claims: take its version, so this tab cannot overwrite it with an older copy.
function syncFromStorage() {
  if (state.unsaved) return;
  const theirs = restore(db.get("data"), localToday());
  if (theirs?.newer) { state.newer = theirs.newer; state.unsaved = true; render(); return; }
  if (!theirs || !theirs.claims.length) {
    if (!state.saved) return;
    state.claims = examples(); state.current = state.claims[0].id; state.saved = false; state.editing = null;
    state.flash = { kind: "warn", text: "Your claims were erased in another tab or window. What you see now are the examples, which are not saved." };
  } else {
    if (state.saved && JSON.stringify(theirs.claims) === JSON.stringify(state.claims)) return;
    state.claims = theirs.claims; state.saved = true; state.editing = null;
    if (!state.claims.some((c) => c.id === state.current)) state.current = state.claims[0].id;
    state.flash = { kind: "warn", text: "Your claims were changed in another tab or window. This one now shows the latest version." };
  }
  render({ form: true });
}
window.addEventListener("storage", (e) => { if (e.key === null || e.key === KEY) syncFromStorage(); });
window.addEventListener("pageshow", (e) => { if (e.persisted) syncFromStorage(); });

/* ---------- formatting ---------- */
// Log10 odds on the chart's axis: 2 is "100 to 1", -3 is "1 to 1k".
const oddsAxis = (v) => {
  const big = 10 ** Math.abs(v);
  const s = big < 1e15 ? fmt.compact(big) : `1e${Math.round(Math.abs(v))}`;
  return v >= 0 ? `${s} to 1` : `1 to ${s}`;
};
const plural = (n, one, many) => `${fmt.int(n)} ${n === 1 ? one : many}`;
// A number below 1 typed without % is read as a percentage (0.8 is 0.8%), which someone who meant 80% should be told.
const bare = (t) => { const s = String(t).trim(); return /^(\d*\.\d+|\d+)$/.test(s) && Number(s) > 0 && Number(s) < 1; };
const bareText = (t) => `${t.trim()} is read as ${t.trim()}%. If you meant ${trim(Number(t.trim()) * 100)}%, type ${trim(Number(t.trim()) * 100)} or ${trim(Number(t.trim()) * 100)}%.`;
const pct = (p) => `${trim(p * 100)}%`;
const trim = (v) => String(Number(v.toPrecision(6)));
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const date = (iso) => DATE.format(new Date(`${iso}T00:00:00Z`));
const short = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const strength = (it) => (it.mode === "probs" ? `${pct(it.pH)} if true, ${pct(it.pNotH)} if false: ${ratioText(it.ratio)}` : ratioText(it.ratio));

// Every control that a redraw replaces carries a key, so focus can be put back on the same control afterwards.
let focusNext = null;
const keyed = (node, key) => { node.dataset.fk = key; return node; };

/* ---------- the claim ---------- */
const claimPick = el("select", { id: "bu-claim" });
claimPick.addEventListener("change", () => { state.current = claimPick.value; state.editing = null; if (state.saved) save(); render({ form: true }); });
const claimText = textArea({ label: "The claim", rows: 2, placeholder: "A statement that is either true or false, such as: It will rain here tomorrow" });
const claimMsg = el("div");
claimText.input.addEventListener("input", () => {
  const text = claimText.value.replace(/\s+/g, " ").trim();
  claimText.input.classList.toggle("invalid", !text || text.length > LIMITS.claim);
  if (!text) { claimMsg.replaceChildren(note("bad", "Write the claim. The last one written is kept until you do.")); return; }
  if (text.length > LIMITS.claim) { claimMsg.replaceChildren(note("bad", `Keep the claim to ${LIMITS.claim} characters; it has ${fmt.int(text.length)}. The last one that fitted is kept until then.`)); return; }
  claimMsg.replaceChildren();
  replaceClaim({ ...current(), text });
  render();
});
const priorField = textField({ label: "Prior: how likely before any evidence", placeholder: "30%, or 1 in 1000", hint: "A percentage, a fraction or 1 in N. Not 0% or 100%: no evidence could move those." });
const priorMsg = el("div");
priorField.input.addEventListener("input", () => {
  const parsed = parseProbability(priorField.value, "The prior");
  const checked = parsed.error ? parsed : checkPrior(parsed.value);
  priorField.input.classList.toggle("invalid", Boolean(checked.error));
  if (checked.error) { priorMsg.replaceChildren(note("bad", checked.error, " The last valid prior is still in use.")); return; }
  priorMsg.replaceChildren(...(bare(priorField.value) ? [note("warn", bareText(priorField.value))] : []));
  replaceClaim({ ...current(), prior: checked.value });
  render();
});

const newClaimBtn = button("New claim", () => {
  if (state.claims.length >= LIMITS.claims) { state.flash = { kind: "bad", text: `The list holds ${LIMITS.claims} claims. Export it and delete some to add more.` }; render(); return; }
  const c = newClaim("A new claim: write it here", 0.5, localToday());
  state.claims = [...state.claims, c];
  state.current = c.id;
  state.editing = null;
  save();
  state.flash = { kind: "good", text: "A new claim has been started with a prior of 50%. Write the claim and set your prior, then add evidence." };
  render({ form: true });
  claimText.input.focus();
  claimText.input.select();
}, { small: true });
const deleteClaimBtn = button("Delete this claim", () => {
  const c = current();
  if (!confirm(`Delete this claim and its ${plural(c.items.length, "piece", "pieces")} of evidence?\n\n"${short(c.text, 120)}"\n\nThis cannot be undone.`)) return;
  state.claims = state.claims.filter((x) => x.id !== c.id);
  state.editing = null;
  if (!state.claims.length) {
    state.claims = examples();
    state.current = state.claims[0].id;
    state.saved = false;
    if (!state.newer) db.remove("data");
    state.flash = { kind: "", text: "That was the last claim, so nothing is saved now. The examples are back." };
  } else {
    state.current = state.claims[0].id;
    save();
    state.flash = { kind: "", text: "Deleted." };
  }
  render({ form: true });
  claimPick.focus();
}, { small: true });
const exampleBtns = EXAMPLES.map((e) => button(e.title, () => {
  if (state.claims.length >= LIMITS.claims) { state.flash = { kind: "bad", text: `The list holds ${LIMITS.claims} claims. Delete some to add an example.` }; render(); return; }
  const c = exampleClaim(e.key, localToday(), newId("c"));
  state.claims = [...state.claims, c];
  state.current = c.id;
  state.editing = null;
  save();
  state.flash = { kind: "good", text: `Example added to your list: ${e.title.toLowerCase()}. Its numbers are illustrations.` };
  render({ form: true });
  claimPick.focus();
}, { small: true, title: `Add the example "${e.title}" to your list` }));

/* ---------- the evidence form ---------- */
const itemText = textField({ label: "What did you learn?", placeholder: "Dark clouds in the west this evening" });
const modeSeg = segmented({
  label: "Give its strength as", value: state.mode,
  options: [{ value: "probs", label: "Two chances" }, { value: "ratio", label: "A likelihood ratio" }],
  onChange: (v) => { state.mode = v; showMode(); },
});
const ratioField = textField({ label: "How many times more likely is this evidence if the claim is true?", placeholder: "3, or 1/4 if four times less likely", hint: "The likelihood ratio: the chance of the evidence if the claim is true divided by its chance if the claim is false. 3, 0.25, 1/4 and 3:1 all work." });
const pHField = textField({ label: "Chance of this evidence if the claim is true", placeholder: "80%", hint: "As a percentage, a fraction or 1 in N." });
const pNotHField = textField({ label: "Chance of this evidence if the claim is false", placeholder: "10%" });
const givenBox = checkbox({ label: "These numbers already allow for the evidence above it" });
const givenHint = el("div", { class: "hint", text: "Tick this if you worked out the chances given everything listed above, for example a second witness who had heard the first. Leave it clear for evidence that is independent of the rest once you know whether the claim is true." });
const formMsg = el("div");
const formTitle = el("h2", { text: "Add evidence" });
const addBtn = button("Add evidence", () => submitItem(), { primary: true });
const cancelBtn = button("Cancel", () => { const id = state.editing; state.editing = null; focusNext = `${id}:Edit`; render({ form: true }); }, { small: true });
for (const f of [itemText, ratioField, pHField, pNotHField]) f.input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitItem(); } });

function showMode() {
  const probs = state.mode === "probs";
  ratioField.el.hidden = probs;
  pHField.el.hidden = pNotHField.el.hidden = !probs;
}
function readForm() {
  return { text: itemText.value, mode: state.mode, ratio: ratioField.value, pH: pHField.value, pNotH: pNotHField.value, given: givenBox.checked };
}
function clearForm() {
  itemText.value = ratioField.value = pHField.value = pNotHField.value = "";
  givenBox.checked = false;
  for (const f of [itemText, ratioField, pHField, pNotHField]) f.input.classList.remove("invalid");
}
function submitItem() {
  const c = current();
  const editing = state.editing;
  const res = editing ? editItem(c, editing, readForm()) : addItem(c, readForm(), localToday());
  const fields = { text: itemText, ratio: ratioField, pH: pHField, pNotH: pNotHField };
  for (const f of Object.values(fields)) f.input.classList.remove("invalid");
  if (res.error) {
    formMsg.replaceChildren(note("bad", res.error));
    const f = fields[res.field];
    if (f) { f.input.classList.add("invalid"); f.input.focus(); }
    return;
  }
  formMsg.replaceChildren();
  const bareOnes = state.mode === "probs" ? [pHField.value, pNotHField.value].filter(bare) : [];
  replaceClaim(res.claim);
  const e = evaluate(res.claim);
  state.flash = { kind: bareOnes.length ? "warn" : "good", text: `${editing ? `Saved. Your belief is now ${percentText(e.L)}.` : `Added. Your belief is now ${percentText(e.L)} (odds ${oddsText(e.L)}).`}${bareOnes.map((t) => ` ${bareText(t)} Edit the item if that is not what you meant.`).join("")}` };
  state.editing = null;
  clearForm();
  if (editing) focusNext = `${editing}:Edit`;
  render({ form: true });
  if (!editing) itemText.input.focus();
}

/* ---------- your data ---------- */
const MAX_FILE = LIMITS.fileBytes;
const fileInput = el("input", { type: "file", accept: ".json,application/json", hidden: true, "aria-label": "Belief updater file" });
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  const refuse = (text) => { state.flash = { kind: "bad", text }; render(); };
  if (file.size > MAX_FILE) return refuse(`${short(file.name, 60)} is ${fmt.num(file.size / 1e6, 1)} MB. A full list of ${LIMITS.claims} claims is far smaller than ${MAX_FILE / 1e6} MB, so this is not one, and it was not read.`);
  let text = "";
  try { text = await file.text(); } catch { /* reported as empty below */ }
  const res = parseImport(text, localToday());
  if (res.error) return refuse(res.error);
  const base = state.saved ? state.claims : [];
  const merged = mergeClaims(base, res.claims);
  const parts = [`${plural(merged.added, "claim", "claims")} added from ${short(file.name, 60)}.`];
  if (!state.saved) parts.push("The examples were put away, because the list is now yours.");
  if (merged.duplicates) parts.push(`${plural(merged.duplicates, "claim", "claims")} already in your list ${merged.duplicates === 1 ? "was" : "were"} left alone.`);
  if (merged.overLimit) parts.push(`${plural(merged.overLimit, "claim", "claims")} ${merged.overLimit === 1 ? "was" : "were"} left out because the list holds ${LIMITS.claims}.`);
  if (res.problems.length) parts.push(`${plural(res.problems.length, "claim", "claims")} could not be read. ${res.problems.slice(0, 3).join(" ")}${res.problems.length > 3 ? " And more." : ""}`);
  if (!merged.claims.length) return refuse(parts.join(" "));
  state.claims = merged.claims;
  state.current = merged.firstAdded ?? state.claims.find((c) => c.id === state.current)?.id ?? state.claims[0].id;
  state.editing = null;
  save();
  state.flash = { kind: res.problems.length || merged.overLimit ? "warn" : "good", text: parts.join(" ") };
  render({ form: true });
});
const exportBtn = button("Export JSON", () => {
  download(`belief-updater-${localToday()}.json`, toJSON(state.claims), "application/json");
  if (state.saved) db.set("exported", localToday());
  render();
}, { small: true });
const importBtn = button("Import a file", () => fileInput.click(), { small: true, title: "Add the claims in a JSON file exported from this page" });
const eraseBtn = button("Erase my claims", () => {
  if (!state.saved || state.newer) return;
  if (!confirm(`Erase all ${plural(state.claims.length, "claim", "claims")} from this browser? Export a copy first if you want to keep them. This cannot be undone.`)) return;
  db.remove("data"); db.remove("exported");
  state.claims = examples(); state.current = state.claims[0].id; state.saved = false; state.unsaved = false; state.editing = null;
  state.flash = { kind: "", text: "Your claims have been erased from this browser. The examples are back, and nothing is saved." };
  focusNext = "export";
  render({ form: true });
}, { small: true });
keyed(exportBtn, "export");
const storageNote = el("p", { class: "small" });
const dataPanel = el("div", { class: "panel bu-data" }, el("h2", { text: "Your data" }), storageNote, el("div", { class: "row" }, exportBtn, importBtn, eraseBtn), fileInput);

/* ---------- layout ---------- */
const jump = el("a", { class: "bu-jump small", href: "#bu-out" }, "Go to the belief and its history");
const controls = el("div", { class: "controls" },
  el("h2", { text: "Claim" }),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("label", { for: "bu-claim", text: "Showing" })), claimPick),
  el("div", { class: "row" }, newClaimBtn, deleteClaimBtn),
  el("div", { class: "field" }, el("div", { class: "lab" }, el("span", { text: "Add an example" })), el("div", { class: "row" }, exampleBtns)),
  claimText.el, claimMsg, priorField.el, priorMsg,
  jump,
  el("div", { class: "controls bu-form", role: "group", "aria-labelledby": "bu-form-title" },
    formTitle, itemText.el, modeSeg.el, ratioField.el, pHField.el, pNotHField.el,
    el("div", { class: "field" }, givenBox.el, givenHint),
    formMsg, el("div", { class: "row" }, addBtn, cancelBtn)),
  dataPanel);
formTitle.id = "bu-form-title";

const banner = el("div", { class: "bu-banner", role: "status" });
const sPrior = stat("Prior");
const sNow = stat("Belief now");
const sAll = stat("All the evidence together");
const sOverlap = stat("If the evidence overlaps");
const overlapNote = el("div");
const scaleSeg = segmented({
  label: "Scale", value: state.scale,
  options: [{ value: "prob", label: "Probability" }, { value: "odds", label: "Odds (log scale)" }],
  onChange: (v) => { state.scale = v; render(); },
});
const chartBox = el("div");
const historyBox = el("div", { class: "bu-history" });
const out = el("div", { class: "out", id: "bu-out", tabindex: "-1" },
  banner, el("h2", { class: "bu-claimtitle" }), el("div", { class: "stats" }, sPrior.el, sNow.el, sAll.el, sOverlap.el), overlapNote,
  scaleSeg.el, chartBox, historyBox);
app.append(el("div", { class: "tool-grid wide-controls" }, controls, out));
const plot = chart(chartBox, { height: 280, series: [] });

/* ---------- the history ---------- */
function historyList(c, e) {
  const rows = [el("li", { class: "bu-step bu-prior" },
    el("span", { class: "bu-n", text: "0" }),
    el("div", {}, el("p", { class: "bu-text" }, "Prior, set when the claim was started on ", date(c.created)), el("p", { class: "small muted", text: `Belief ${percentText(e.L0)}, odds ${oddsText(e.L0)}` })))];
  c.items.forEach((it, k) => {
    const s = e.steps[k + 1];
    const act = (label, fn) => {
      const b = keyed(button(label, fn, { small: true }), `${it.id}:${label}`);
      b.setAttribute("aria-label", `${label} evidence ${k + 1}: ${short(it.text, 60)}`);
      return b;
    };
    rows.push(el("li", { class: `bu-step${state.editing === it.id ? " bu-editing" : ""}` },
      el("span", { class: "bu-n", text: String(k + 1) }),
      el("div", {},
        el("p", { class: "bu-text", text: it.text }),
        el("p", { class: "small muted" },
          `${strength(it)} (${fmt.signed(s.db, 1)} decibans). Belief after: `, el("strong", { text: percentText(s.L) }),
          `. Added ${date(it.added)}.`, it.given ? " Entered given the evidence above it." : ""),
        el("div", { class: "row bu-actions" },
          act("Edit", () => startEdit(it)),
          act("Delete", (ev) => {
            const li = ev.currentTarget.closest("li");
            const nextLi = li.nextElementSibling ?? li.previousElementSibling;
            focusNext = nextLi?.querySelector("[data-fk]")?.dataset.fk ?? "history";
            const res = removeItem(current(), it.id);
            if (res.error) { state.flash = { kind: "bad", text: res.error }; render(); return; }
            if (state.editing === it.id) { state.editing = null; clearForm(); }
            replaceClaim(res.claim);
            state.flash = { kind: "", text: `Deleted evidence ${k + 1}. Your belief is now ${percentText(evaluate(res.claim).L)}.` };
            render({ form: true });
          })))));
  });
  return el("ol", { class: "bu-list" }, rows);
}

function startEdit(it) {
  state.editing = it.id;
  state.mode = it.mode;
  modeSeg.value = it.mode;
  showMode();
  itemText.value = it.text;
  ratioField.value = it.mode === "ratio" ? trim(it.ratio) : "";
  pHField.value = it.mode === "probs" ? pct(it.pH) : "";
  pNotHField.value = it.mode === "probs" ? pct(it.pNotH) : "";
  givenBox.checked = it.given;
  formMsg.replaceChildren();
  state.flash = null;
  render({ form: true, keepFields: true });
  itemText.input.focus();
}

/* ---------- render ---------- */
function render({ form = false, keepFields = false } = {}) {
  const had = document.activeElement?.dataset?.fk ?? null;
  const c = current();
  const e = evaluate(c);

  // The claim picker and fields.
  claimPick.replaceChildren(...state.claims.map((x, i) => el("option", { value: x.id, text: `${i + 1}. ${short(x.text, 60)}` })));
  claimPick.value = c.id;
  deleteClaimBtn.disabled = false;
  if (form) {
    claimText.value = c.text;
    priorField.value = pct(c.prior);
    priorField.input.classList.remove("invalid");
    claimMsg.replaceChildren(); priorMsg.replaceChildren();
    if (!keepFields && !state.editing) { clearForm(); formMsg.replaceChildren(); }
  }
  const editingIndex = c.items.findIndex((i) => i.id === state.editing);
  if (editingIndex < 0) state.editing = null;
  formTitle.textContent = state.editing ? `Edit evidence ${editingIndex + 1}` : "Add evidence";
  addBtn.textContent = state.editing ? "Save changes" : "Add evidence";
  cancelBtn.hidden = !state.editing;
  const full = !state.editing && c.items.length >= LIMITS.items;
  addBtn.disabled = full;
  if (full) formMsg.replaceChildren(note("warn", `This claim holds ${LIMITS.items} pieces of evidence, the most it can. Start a new claim to add more.`));

  // Banner. A live region is only rewritten when what it says changes, so typing elsewhere does not repeat it.
  const top = [];
  if (!state.saved) top.push(note("warn", el("strong", { text: "These three claims are examples, and nothing is saved yet. " }), "Their numbers are illustrations. ",
    storageOff ? "This browser is not letting the page save anything (storage is switched off or full), so export your claims before you close the page." : state.newer ? "" : "Change anything, add evidence or start a claim, and the whole list is kept in this browser from then on."));
  if (state.unsaved) top.push(note("bad", state.newer ? newerText(state.newer) : "This browser would not save the change, perhaps because storage is full or switched off. Export your claims now so that nothing is lost."));
  if (state.flash && !(state.unsaved && state.flash.kind === "bad")) top.push(note(state.flash.kind, state.flash.text));
  const said = top.map((n) => n.textContent).join("|");
  if (said !== banner.dataset.said) { banner.replaceChildren(...top); banner.dataset.said = said; }
  state.flash = null;

  // Tiles.
  $(".bu-claimtitle", out).textContent = c.text;
  sPrior.set(percentText(e.L0), `odds ${oddsText(e.L0)}`);
  sNow.set(percentText(e.L), c.items.length ? `odds ${oddsText(e.L)}, after ${plural(c.items.length, "piece", "pieces")} of evidence` : "no evidence yet");
  sAll.set(c.items.length ? ratioText(e.totalRatio) : "×1", c.items.length ? `${fmt.signed(e.totalDb, 1)} decibans; the odds are multiplied by this` : "add evidence to see it");
  sOverlap.set(e.differs ? percentText(e.overlap.L) : "–", e.differs ? "counting only the strongest item each way" : "needs two or more items not entered given the rest");
  const ws = c.items.filter((i) => !i.given).map((i) => Math.log(i.ratio));
  const both = ws.some((w) => w > 0) && ws.some((w) => w < 0);
  overlapNote.replaceChildren(...(e.differs ? [note("", `Multiplying the ratios assumes that, once you know whether the claim is true, each item tells you nothing about the others. If the ${plural(e.overlap.counted, "item", "items")} not marked as allowing for the rest were really the same evidence seen again, only ${both ? "the strongest for the claim and the strongest against it" : "the strongest of them"} would count, and your belief would be ${percentText(e.overlap.L)} instead of ${percentText(e.L)}. The truth lies wherever the real dependence puts it; the honest fix is to enter each item's chances given the items above it, and tick the box.`)] : []));

  // Chart.
  const xs = e.steps.map((s, i) => i);
  const prob = state.scale === "prob";
  const LN10 = Math.LN10;
  const yv = (s) => (prob ? s.p * 100 : s.L / LN10);
  const ys = e.steps.map(yv);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  plot.update({
    title: "Belief after each piece of evidence",
    subtitle: prob ? "0 is the prior. Hover or use the arrow keys for the values." : "Each step up or down is the weight of one piece of evidence: on this scale the steps add up.",
    label: `Line chart of the belief in the claim after each piece of evidence, ${prob ? "as a probability" : "as odds on a log scale"}`,
    x: { label: "Evidence", domain: [0, Math.max(1, xs.length - 1)], format: (v) => (v === 0 ? "prior" : Number.isInteger(v) ? String(v) : ""), ticks: Math.min(8, Math.max(1, xs.length - 1)) },
    y: prob
      ? { label: "Belief (%)", domain: [0, 100], format: (v) => `${fmt.num(v, 0)}%` }
      : { label: "Odds", domain: [Math.floor(Math.min(lo, -1)), Math.ceil(Math.max(hi, 1))], format: oddsAxis },
    series: [{ name: "Belief", type: "line", color: 0, data: e.steps.map((s, i) => ({ x: i, y: yv(s) })) }],
    marks: [{ type: "hline", y: prob ? 50 : 0, text: prob ? "50%" : "even odds" }],
    empty: "",
  });

  // History.
  historyBox.replaceChildren(
    el("h2", { tabindex: "-1", "data-fk": "history", text: `History (${plural(c.items.length, "piece", "pieces")} of evidence)` }),
    historyList(c, e));

  // Storage note.
  const exported = db.get("exported");
  const risks = "Clearing the browser's site data deletes it, and Safari deletes it after seven days of use in which this page is not visited, so export a copy now and then.";
  storageNote.textContent = state.unsaved || (storageOff && !state.saved)
    ? `Your ${plural(state.claims.length, "claim is", "claims are")} not being saved: ${state.newer ? "a newer version of this page has saved claims in this browser, so reload the page" : "this browser's storage is full or switched off"}. Export a copy before you close the page.`
    : state.saved
      ? `${plural(state.claims.length, "claim is", "claims are")} kept in this browser only and sent nowhere. ${risks} ${typeof exported === "string" && /^\d{4}-\d\d-\d\d$/.test(exported) ? `Last exported on ${date(exported)}.` : "Not exported yet."}`
      : `Nothing is saved yet. Once you change something, your claims are kept in this browser only and sent nowhere. ${risks}`;
  eraseBtn.disabled = !state.saved || Boolean(state.newer);

  // Focus back where it was, or where the action asked.
  const want = focusNext ?? had;
  focusNext = null;
  if (want) ($$("[data-fk]", app).find((n) => n.dataset.fk === want && !n.disabled && !n.hidden) ?? $("[data-fk=history]", historyBox))?.focus();
}

showMode();
render({ form: true });
