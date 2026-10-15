// Day 73: Central Bank Language Tracker. Interface.
import { $, el, fmt, mount, select, textArea, segmented, button, stat, note, table, chart, debounce } from "../kit/kit.js";
import { FOMC } from "./data.js";
import { TOPICS, TOPIC_LABEL, KEYWORDS, MODIFIERS, PHRASES, POLICY_RULES, UNINFORMATIVE, MAX_CHARS, score, decode, percentile, nearest, verdict, track } from "./logic.js";

mount();

/* ---------- the past statements: decoded at once, scored in slices after the page has drawn (see scorePast) ---------- */
const statements = decode(FOMC);
let past = null;
const latest = statements.at(-1);
const decision = (s) => (s.change == null ? "no decision on the rate"
  : s.change === 0 ? "rate held"
  : `${s.change > 0 ? "raised" : "cut"} ${fmt.sig(Math.abs(s.change), 3)} percentage ${Math.abs(s.change) > 1 ? "points" : "point"}`);
const signed = (v) => fmt.signed(v, 2);
const yearOf = (d) => Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) - 1) / 12 + (Number(d.slice(8)) - 1) / 365;

/* ---------- controls ---------- */
const pick = select({
  label: "Load a statement",
  value: latest.date,
  options: [{ value: "", label: "Your own text" }, ...[...statements].reverse().map((s) => ({ value: s.date, label: `${fmt.date(s.date)}: ${decision(s)}` }))],
  hint: `Every FOMC statement from ${fmt.date(statements[0].date)} to ${fmt.date(latest.date)}, as the Federal Reserve Board published it.`,
  onChange: (v) => { if (v) load(v, false); },
});
const box = textArea({
  label: "Statement text",
  rows: 12,
  hint: `Paste any central bank statement, up to ${fmt.int(MAX_CHARS)} characters. It is scored as you type and never leaves this page.`,
  onInput: () => { pick.value = ""; later(); },
});
box.input.setAttribute("maxlength", String(MAX_CHARS * 2)); // the tool refuses more than MAX_CHARS with a message; this only stops a runaway paste
const clearBtn = button("Clear the box", () => { box.value = ""; pick.value = ""; run(); box.input.focus(); }, { small: true });
const scoreBtn = button("Score the text", () => run(), { primary: true });
const count = el("p", { class: "small muted", "aria-live": "off" });
const controls = el("div", { class: "controls" }, pick.el, box.el, count, el("div", { class: "row" }, scoreBtn, clearBtn),
  note("", "The dictionary was written for statements of the US Federal Reserve. On another central bank's text the score is a rough guide only: its words and habits differ."));

/* ---------- outputs ---------- */
const sScore = stat("Score");
const sRank = stat(`Against ${statements.length} FOMC statements`);
const sPairs = stat("Pairs found");
const sWords = stat("Words scored");
const status = el("p", { class: "sr-only", role: "status" });
const message = el("div");
const topicBox = el("div");
const nearBox = el("div", { class: "stack" });
const out = el("div", { class: "out" }, el("div", { class: "stats" }, sScore.el, sRank.el, sPairs.el, sWords.el), status, message, topicBox, nearBox);

const markHead = el("h2", { text: "The text as the dictionary reads it" });
const markKey = el("p", { class: "small muted" });
const marked = el("div", { class: "marked", tabindex: "0", role: "region", "aria-label": "The text with the dictionary's matches marked" });
const pairList = el("details", { class: "pairs" });
const markPanel = el("div", { class: "panel stack" }, markHead, markKey, marked, pairList);

const pastHead = el("h2", { text: "Against every FOMC statement since 2000" });
const pastBox = el("div");
const pastPanel = el("div", { class: "panel stack" }, pastHead, pastBox);

const trackHead = el("h2", { text: "Does the score track what the Committee did?" });
const trackSeg = segmented({
  label: "Compare each decision with",
  value: "same",
  options: [{ value: "same", label: "The statement that announced it" }, { value: "next", label: "The statement before it" }],
  onChange: () => drawTrack(),
});
const trackOut = el("div", { class: "stack" });
const trackPanel = el("div", { class: "panel stack" }, trackHead, trackSeg.el, trackOut);

const dictPanel = el("details", { class: "panel dict" }, el("summary", { text: "The whole dictionary" }), dictionary());

$("#app").append(el("div", { class: "tool-grid wide-controls" }, controls, out), markPanel, pastPanel, trackPanel, dictPanel);

const pastChart = chart(pastBox, { series: [], height: 320 });

/** A kit table whose rows become labelled lists when its box is narrow (see the CSS in index.html). */
function stackable(wrap) {
  const tb = wrap.querySelector("table");
  tb.classList.add("rt");
  const heads = [...tb.querySelectorAll("thead th")].map((th) => th.textContent);
  for (const tr of tb.querySelectorAll("tbody tr")) [...tr.children].forEach((td, k) => td.setAttribute("data-label", heads[k]));
  return wrap;
}

/* ---------- running the score ---------- */
function load(date, focusBox) {
  const s = statements.find((p) => p.date === date);
  if (!s) return;
  box.value = s.text;
  pick.value = date;
  run();
  if (focusBox) box.input.focus();
}

const later = debounce(() => run(), 350);

function run() {
  const text = box.value;
  count.textContent = `${fmt.int(text.length)} of ${fmt.int(MAX_CHARS)} characters.`;
  const r = score(text);
  if (r.error) {
    message.replaceChildren(note(r.tooLong ? "bad" : "warn", r.error));
    for (const s of [sScore, sRank, sPairs, sWords]) s.set("–", "");
    status.textContent = r.error;
    topicBox.replaceChildren();
    nearBox.replaceChildren();
    marked.replaceChildren(r.sentences ? markUp(r) : el("p", { class: "muted", text: "Nothing to show yet." }));
    markKey.textContent = "";
    pairList.replaceChildren();
    drawPast(null);
    return;
  }
  message.replaceChildren();
  if (!past) {
    sScore.set(signed(r.total), r.total > 0 ? "more tightening news than easing" : r.total < 0 ? "more easing news than tightening" : "the two balance exactly");
    sRank.set("…", "scoring the past statements");
    sPairs.set(fmt.int(r.hits), "keyword and modifier pairs, and policy phrases");
    sWords.set(fmt.int(r.words), "in the sentences that count");
    marked.replaceChildren(markUp(r));
    return;
  }
  const p = percentile(past.map((s) => s.total), r.total);
  const own = pick.value ? past.find((s) => s.date === pick.value) : null;
  sScore.set(signed(r.total), r.total > 0 ? "more tightening news than easing" : r.total < 0 ? "more easing news than tightening" : "the two balance exactly");
  sRank.set(verdict(p), `higher than ${fmt.pct(p, 0)} of them${own ? ", itself included" : ""}`);
  sPairs.set(fmt.int(r.hits), "keyword and modifier pairs, and policy phrases");
  sWords.set(fmt.int(r.words), "in the sentences that count");
  status.textContent = `Score ${signed(r.total)}, ${verdict(p)}: higher than ${fmt.pct(p, 0)} of ${past.length} FOMC statements. ${fmt.int(r.hits)} matches in ${fmt.int(r.words)} words.`;
  if (!r.hits) message.replaceChildren(note("warn", "The dictionary found nothing to score in this text, so it reads as exactly neutral. That says the text does not use the dictionary's words, not that it is balanced."));

  topicBox.replaceChildren(stackable(table({
    caption: "Where the score comes from",
    columns: [
      { key: "topic", label: "Topic" },
      { key: "points", label: "Points", num: true, format: (v) => fmt.signed(v, 0).replace(/^0$/, "0") },
      { key: "score", label: "Points ÷ √words", num: true, format: signed },
    ],
    rows: [...TOPICS.map((t) => ({ topic: TOPIC_LABEL[t], points: r.sums[t], score: r.scores[t] })), { topic: "Total", points: TOPICS.reduce((s, t) => s + r.sums[t], 0), score: r.total }],
  })));

  const near = nearest(past.filter((s) => s.date !== pick.value), r.total, 3);
  nearBox.replaceChildren(el("h2", { text: "Past statements with the nearest score" }),
    el("ul", { class: "near" }, near.map((s) => el("li", {},
      el("span", {}, el("strong", { text: fmt.date(s.date) }), ` ${signed(s.total)}, ${decision(s)}. `),
      button(`Load ${fmt.date(s.date)}`, () => load(s.date, true), { small: true })))));

  marked.replaceChildren(markUp(r));
  const aside = r.sentences.filter((s) => !s.informative).length;
  markKey.textContent = `Keywords are underlined and their modifiers shaded; the number after a keyword is what the pair adds (+1 tightening, −1 easing). ${aside ? `${aside} ${aside === 1 ? "sentence is" : "sentences are"} set aside as restatements of policy or the mandate, shown faded.` : "No sentence was set aside."}`;
  const all = r.sentences.flatMap((s, i) => [...s.pairs.map((q) => `Sentence ${i + 1}: ${q.keyword} with ${q.modifier} (${TOPIC_LABEL[q.topic]}), ${fmt.signed(q.value, 0)}`),
    ...s.policy.map((q) => `Sentence ${i + 1}: policy phrase ${q.rule.join(" + ")}, ${fmt.signed(q.score, 0)}`)]);
  pairList.replaceChildren(...[el("summary", { text: `Every match as a list (${fmt.int(all.length)})` }), el("ol", {}, all.slice(0, 2000).map((t) => el("li", { text: t }))),
    all.length > 2000 ? el("p", { class: "small muted", text: `The first 2,000 of ${fmt.int(all.length)} are listed.` }) : null].filter(Boolean));
  drawPast(r.total);
}

/** The text as DOM: sentences in order, matches marked, set-aside sentences faded. Built from text nodes only. */
const MARK_CAP = 2000; // matches marked in the text; past this the rest is plain text, so a huge paste stays quick to draw
function markUp(r) {
  const frag = document.createDocumentFragment();
  const text = r.text;
  let at = 0, shown = 0;
  for (const s of r.sentences) {
    if (shown >= MARK_CAP) {
      frag.append(el("span", { class: "small muted", text: `[Only the first ${fmt.int(MARK_CAP)} matches are marked; the rest of the text follows unmarked. The score counts every match.] ` }));
      break;
    }
    shown += s.pairs.length + s.policy.length;
    if (s.start > at) frag.append(text.slice(at, s.start));
    const spans = [];
    for (const q of s.pairs) {
      spans.push({ from: q.k.from, to: q.k.to, cls: `kw ${q.value > 0 ? "up" : q.value < 0 ? "down" : "zero"}`, after: fmt.signed(q.value, 0) });
      spans.push({ from: q.m.from, to: q.m.to, cls: `md ${q.value > 0 ? "up" : q.value < 0 ? "down" : "zero"}` });
    }
    spans.sort((a, b) => a.from - b.from || b.to - a.to);
    const wrap = el("span", { class: s.informative ? "sent" : "sent aside" });
    if (!s.informative) wrap.append(el("span", { class: "sr-only", text: "(set aside) " }));
    let pos = s.start;
    for (const sp of spans) {
      if (sp.from < pos) continue; // overlaps a mark already placed
      wrap.append(text.slice(pos, sp.from));
      wrap.append(el("mark", { class: sp.cls, text: text.slice(sp.from, sp.to) }));
      if (sp.after) wrap.append(el("sup", { class: "val", text: sp.after }));
      pos = sp.to;
    }
    wrap.append(text.slice(pos, s.end));
    for (const q of s.policy) wrap.append(el("sup", { class: "val pol", text: `policy ${fmt.signed(q.score, 0)}` }));
    frag.append(wrap);
    at = s.end;
  }
  if (at < text.length) frag.append(text.slice(at));
  return frag;
}

/* ---------- the past, and the check against decisions ---------- */
function drawPast(x) {
  if (!past) return;
  const pt = (s) => ({ x: yearOf(s.date), y: s.total, label: `${fmt.date(s.date)}: ${decision(s)}` });
  const groups = [
    { name: "Raised the rate", f: (s) => s.change > 0, color: 7 },
    { name: "Held it", f: (s) => s.change === 0, color: "#8a94a3" },
    { name: "Cut it", f: (s) => s.change < 0, color: 0 },
    { name: "No decision on the rate", f: (s) => s.change == null, color: 3 },
  ];
  pastChart.update({
    title: "Score of every FOMC statement",
    subtitle: x == null ? "Each dot is a statement. Click one, or reach it with the arrow keys and press Enter, to load it." : `The line is the text in the box (${signed(x)}). Click a dot, or reach it with the arrow keys and press Enter, to load that statement.`,
    label: "Scatter chart of the dictionary score of every FOMC statement from 2000, by date and by decision",
    hover: "point",
    x: { label: "Date of the statement", format: (v) => String(Math.floor(v + 1e-9)) },
    y: { label: "Score", format: (v) => fmt.signed(v, 1) },
    series: groups.map((g) => ({ name: g.name, type: "scatter", data: past.filter(g.f).map(pt), color: g.color, r: 3.6 })),
    marks: x == null ? [{ type: "hline", y: 0 }] : [{ type: "hline", y: 0 }, { type: "hline", y: x, text: `This text ${signed(x)}`, color: "#16233b" }],
    onClick: ({ point }) => {
      const s = point?.label ? statements.find((q) => `${fmt.date(q.date)}: ${decision(q)}` === point.label) : null;
      if (!s) return;
      // Loading fills the panels above the chart; keep the chart where it was, under the finger or the pointer.
      const plot = () => (pastBox.querySelector(".chart-plot") || pastBox).getBoundingClientRect().top;
      const top = plot();
      load(s.date, false);
      const shift = plot() - top;
      if (Math.abs(shift) > 0.5) window.scrollBy(0, shift);
    },
  });
}

function drawTrack() {
  if (!past) return;
  const next = trackSeg.value === "next";
  const a = track(past, { next, to: "2020-12-31" }), b = track(past, { next, from: "2021-01-01" }), all = track(past, { next });
  const cell = (g) => (g.n ? `${signed(g.mean)} (${g.n})` : "none");
  const raisesUp = (t) => t.rows.filter((r) => r.change > 0 && r.score > 0).length;
  const cutsDown = (t) => t.rows.filter((r) => r.change < 0 && r.score < 0).length;
  const n = (t, f) => t.rows.filter(f).length;
  trackOut.replaceChildren(
    stackable(table({
      caption: `Average score ${next ? "of the statement before each decision" : "of the statement announcing each decision"} (number of decisions)`,
      columns: [{ key: "d", label: "Decision" }, { key: "a", label: "2000 to 2020", num: true }, { key: "b", label: "2021 to 2026", num: true }],
      rows: [{ d: "Raise", a: cell(a.raise), b: cell(b.raise) }, { d: "Hold", a: cell(a.hold), b: cell(b.hold) }, { d: "Cut", a: cell(a.cut), b: cell(b.cut) }],
    })),
    el("p", { text: `Over all ${fmt.int(all.n)} decisions, the score was above zero for ${raisesUp(all)} of ${n(all, (r) => r.change > 0)} raises and below zero for ${cutsDown(all)} of ${n(all, (r) => r.change < 0)} cuts. Since 2021, after the dictionary was built from the statements of 2000 to 2020, it was above zero for ${raisesUp(b)} of ${n(b, (r) => r.change > 0)} raises and below zero for ${cutsDown(b)} of ${n(b, (r) => r.change < 0)} cuts.` }),
    el("p", { class: "small muted", text: "A test on the years the dictionary was built from flatters it: its authors chose the words by reading those statements. The years since 2021 are the fairer test. The six statements that announced no decision on the rate are left out." }));
}

/* ---------- the dictionary, in full ---------- */
function dictionary() {
  const list = (items) => items.map((t) => t).join(", ");
  const byScore = (entries, s) => entries.filter((e) => e[1] === s).map((e) => e[0] + (e[2]?.whole ? " (whole word)" : e[2]?.not ? ` (not ${e[2].not})` : ""));
  const kw = (topic) => KEYWORDS.filter((k) => k[2] === topic);
  const kwLine = (topic) => [
    el("p", {}, el("strong", { text: "Keywords counted as they are: " }), list(kw(topic).filter((k) => k[1] > 0).map((k) => k[0])) || "none"),
    kw(topic).some((k) => k[1] < 0) ? el("p", {}, el("strong", { text: "Keywords counted reversed (more of them is bad news): " }), list(kw(topic).filter((k) => k[1] < 0).map((k) => k[0]))) : null,
  ];
  const modLine = (topic) => [
    el("p", {}, el("strong", { text: "Modifiers scoring +1: " }), list(byScore(MODIFIERS[topic], 1)) || "none"),
    el("p", {}, el("strong", { text: "Modifiers scoring −1: " }), list(byScore(MODIFIERS[topic], -1)) || "none"),
    el("p", {}, el("strong", { text: "Modifiers scoring 0: " }), list(byScore(MODIFIERS[topic], 0)) || "none"),
  ];
  const phr = (topic) => PHRASES.filter((p) => p[2] === topic);
  return el("div", { class: "stack" },
    el("p", { class: "small", text: "Gardner, Scotti and Vega's dictionary as the page uses it, from tables A5 to A10 of their 2021 working paper. A pair scores the keyword's sign times the modifier's: \"unemployment\" (−1) with \"declined\" (−1) adds +1. Every entry matches the start of a word, so \"increas\" covers increase, increased and increasing." }),
    ...["inflation", "labor", "output", "financial"].map((t) => el("div", { class: "dict-topic" }, el("h3", { text: TOPIC_LABEL[t] }), ...kwLine(t), ...modLine(t),
      phr(t).length ? el("p", {}, el("strong", { text: "Whole phrases that act as one modifier: " }), list(phr(t).map((p) => `"${p[0]}" (${fmt.signed(p[1], 0)})`))) : null)),
    el("div", { class: "dict-topic" }, el("h3", { text: TOPIC_LABEL.policy }),
      el("p", { text: "A sentence that contains every part of a rule adds the rule's score. A bar | means either word will do." }),
      el("ul", {}, POLICY_RULES.map(([g, s]) => el("li", { text: `${g.map((x) => `"${x}"`).join(" and ")}: ${fmt.signed(s, 0)}` })))),
    el("div", { class: "dict-topic" }, el("h3", { text: "Sentences set aside" }),
      el("p", { text: "A sentence that contains every part of one of these rules is left out of the four topics and of the word count. \".*?\" stands for any words in between." }),
      el("ul", {}, UNINFORMATIVE.map((g) => el("li", { text: g.map((x) => `"${x}"`).join(" and ") })))));
}

/** Score the past statements a few at a time, so the page stays responsive, then fill in everything that needs them. */
function scorePast() {
  const done = [];
  pastChart.update({ series: [], marks: [], empty: "Scoring the past statements…" });
  trackOut.replaceChildren(el("p", { class: "small muted", text: "Scoring the past statements…" }));
  const step = () => {
    const t0 = performance.now();
    while (done.length < statements.length && performance.now() - t0 < 25) { const s = statements[done.length]; done.push({ ...s, ...score(s.text) }); }
    if (done.length < statements.length) { setTimeout(step, 0); return; }
    past = done;
    run();
    drawTrack();
  };
  setTimeout(step, 0);
}

load(latest.date, false);
scorePast();
