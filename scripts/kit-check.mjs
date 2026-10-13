// Browser tests for the shared kit (365projects/kit/kit.js). Dev tooling only.
//
//   node scripts/kit-check.mjs [--browser all]
//
// kit.test.mjs covers the pure parts in Node. This script loads the kit in a real page and checks the
// parts that need a browser: controls, charts (that marks land where the data says they should),
// tooltips, the keyboard, the data-table twin, the canvas helper, storage and the page shell.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINES = { chromium, firefox, webkit };
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

const HOST = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>kit check</title>
<link rel="icon" href="/assets/favicon.svg"><link rel="stylesheet" href="/assets/site.css"><link rel="stylesheet" href="/365projects/kit/kit.css"></head>
<body class="proj" data-day="1"><main class="wrap"><header class="p-head"><h1>Kit check</h1></header>
<section class="tool" id="app"></section></main>
<script src="/365projects/challenge-data.js"></script></body></html>`;

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (path === "/365projects/kit-check/") { res.writeHead(200, { "content-type": MIME[".html"] }); res.end(HOST); return; }
      let file = join(ROOT, path);
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

// Runs inside the page. Returns a list of failed checks.
async function inPage() {
  const K = await import("/365projects/kit/kit.js");
  const fails = [];
  const ok = (cond, what) => { if (!cond) fails.push(what); };
  const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) fails.push(`${what}: got ${a}, expected ${b} (within ${tol})`); };
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const app = document.querySelector("#app");
  const box = (width = 600) => { const d = K.el("div", { style: { width: `${width}px` } }); app.append(d); return d; };
  const fire = (node, type, init = {}) => node.dispatchEvent(new (type.startsWith("key") ? KeyboardEvent : type.startsWith("pointer") ? PointerEvent : type === "click" ? MouseEvent : Event)(type, { bubbles: true, ...init }));

  /* ---- controls ---- */
  let seen = [];
  const s = K.slider({ label: "Speed", min: 0, max: 10, step: 0.5, value: 2, format: (v) => `${v} m/s`, hint: "a hint", onInput: (v) => seen.push(v) });
  box().append(s.el);
  ok(s.el.querySelector("label").htmlFor === s.input.id && s.el.querySelector("label").textContent === "Speed", "slider label is tied to its input");
  ok(s.el.querySelector("output").textContent === "2 m/s", "slider shows the formatted starting value");
  s.input.value = "7.5"; fire(s.input, "input");
  ok(seen.at(-1) === 7.5 && s.value === 7.5 && s.el.querySelector("output").textContent === "7.5 m/s", "slider input updates value, readout and callback");
  ok(s.input.getAttribute("aria-valuetext") === "7.5 m/s", "slider tells a screen reader the formatted value, not the raw number");
  s.value = 4; ok(s.value === 4 && s.el.querySelector("output").textContent === "4 m/s" && seen.length === 1, "setting slider.value updates the readout without calling back");
  ok(s.input.getAttribute("aria-valuetext") === "4 m/s", "and the spoken value follows");
  ok(!K.slider({ label: "Bare", format: () => "" }).input.hasAttribute("aria-valuetext"), "a slider with an empty readout leaves the spoken value to the browser");
  const free = K.slider({ label: "Free", min: 0, max: 4, step: "any", value: 1, onInput: (v) => seen.push(v) });
  box().append(free.el); seen = [];
  fire(free.input, "keydown", { key: "ArrowRight" }); near(free.value, 1.04, 1e-9, "a slider with no step moves 1% of its range per arrow key");
  fire(free.input, "keydown", { key: "PageDown" }); near(free.value, 0.64, 1e-9, "and 10% per Page Down");
  fire(free.input, "keydown", { key: "End" }); ok(free.value === 4 && seen.length === 3, "End goes to the top, and each key calls back once");
  ok(["1.5k", "999k", "1m", "12.3m", "2.34bn", "4tn", "-2m", "950"].join() === [1500, 999499, 999500, 12345678, 2.34e9, 4e12, -2e6, 950].map(K.fmt.compact).join(), `compact numbers read the same in every browser (got ${[1500, 999499, 999500, 12345678, 2.34e9, 4e12, -2e6, 950].map(K.fmt.compact).join()})`);

  seen = [];
  const n = K.numberField({ label: "Count", min: 1, max: 50, value: 5, onInput: (v) => seen.push(v) });
  box().append(n.el);
  n.input.value = "12"; fire(n.input, "input");
  ok(seen.at(-1) === 12 && n.value === 12 && !n.input.classList.contains("invalid"), "number field accepts a valid number");
  for (const bad of ["", "abc", "0", "51", "-3"]) { n.input.value = bad; fire(n.input, "input"); ok(Number.isNaN(n.value) && n.input.classList.contains("invalid"), `number field rejects "${bad}"`); }
  ok(seen.length === 1, "number field calls back only for valid numbers");
  ok(getComputedStyle(n.input).borderTopColor !== getComputedStyle(s.input).borderTopColor && /rgb\(192, 57, 43\)/.test(getComputedStyle(n.input).borderTopColor), "an invalid number field is outlined in red");
  const neg = K.numberField({ label: "Change", min: -5, max: 5, value: 0 });
  ok(n.input.getAttribute("inputmode") === "decimal" && !neg.input.hasAttribute("inputmode"), "fields that allow negatives do not ask for the keypad without a minus key");

  seen = [];
  const sel = K.select({ label: "Method", options: ["a", { value: "b", label: "Bee" }], value: "b", onChange: (v) => seen.push(v) });
  box().append(sel.el);
  ok(sel.value === "b" && sel.input.options[1].textContent === "Bee", "select starts on the given value");
  sel.input.value = "a"; fire(sel.input, "change"); ok(seen.at(-1) === "a", "select reports a change");
  const seg = K.segmented({ label: "View", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }], value: "x", onChange: (v) => seen.push(v) });
  box().append(seg.el);
  ok(seg.value === "x", "segmented control starts on the given value");
  seg.el.querySelectorAll("input")[1].click(); ok(seg.value === "y" && seen.at(-1) === "y", "segmented control reports a click");
  seg.value = "x"; ok(seg.value === "x", "segmented control value can be set");
  ok(seg.el.querySelector('[role="radiogroup"]').getAttribute("aria-label") === "View", "segmented control is a named radio group");
  const cb = K.checkbox({ label: "Show", checked: true, onChange: (v) => seen.push(v) });
  box().append(cb.el);
  cb.input.click(); ok(cb.checked === false && seen.at(-1) === false, "checkbox reports a click");
  const tf = K.textField({ label: "Name", value: "x", onInput: (v) => seen.push(v) });
  const ta = K.textArea({ label: "Notes", value: "line", rows: 3 });
  box().append(tf.el, ta.el);
  tf.input.value = "hello"; fire(tf.input, "input"); ok(seen.at(-1) === "hello" && tf.value === "hello" && ta.value === "line", "text inputs report typing and hold their values");
  let clicked = 0; const btn = K.button("Run", () => clicked++, { primary: true, small: true });
  box().append(btn); btn.click(); ok(clicked === 1 && btn.type === "button" && btn.className.includes("primary") && btn.className.includes("small"), "button clicks and carries its classes");

  /* ---- outputs ---- */
  const st = K.stat("Mean", "4.2", "of 10"); box().append(st.el);
  st.set("5", "of 20"); ok(st.el.querySelector(".v").textContent === "5" && st.el.querySelector(".n").textContent === "of 20", "stat tile updates");
  const bad = K.note("bad", "Broken"), fine = K.note("", "Fine");
  ok(bad.getAttribute("role") === "alert" && !fine.hasAttribute("role") && bad.classList.contains("bad"), "note kinds");
  const t = K.table({ caption: "People", columns: [{ key: "n", label: "Name" }, { key: "a", label: "Age", num: true, format: (v) => `${v} y` }], rows: [{ n: "<b>Ada</b>", a: 36 }, { n: "Bo", a: 7 }] });
  box().append(t);
  ok(t.querySelectorAll("tbody tr").length === 2 && t.querySelector("tbody td").textContent === "<b>Ada</b>" && !t.querySelector("tbody b"), "table inserts text as text, never as HTML");
  ok(t.querySelector("tbody td.num").textContent === "36 y" && t.querySelector("caption").textContent === "People", "table formats cells and has its caption");
  const hb = box(400); const bars = K.bars(hb, { items: [{ label: "A", value: 50 }, { label: "B", value: 25, highlight: true }], max: 100, format: (v) => `${v}%` });
  await frame();
  const fills = [...hb.querySelectorAll(".fill")];
  ok(fills[0].style.width === "50%" && fills[1].style.width === "25%" && fills[0].getBoundingClientRect().width > 10, "bar list widths follow the values and are drawn");
  near(fills[0].getBoundingClientRect().width / fills[1].getBoundingClientRect().width, 2, 0.02, "bar list: twice the value is twice the length");
  bars.update([{ label: "C", value: 100 }]); ok(hb.querySelectorAll(".hbar").length === 1 && hb.querySelector(".val").textContent === "100%", "bar list update replaces the rows");

  /* ---- chart: geometry ---- */
  const c1box = box(600);
  let click = null;
  const c1 = K.chart(c1box, { title: "Line and dots", x: { label: "x", domain: [0, 10] }, y: { label: "y", domain: [0, 10] }, height: 300, hover: "point",
    series: [{ name: "Dots", type: "scatter", data: [{ x: 0, y: 0, label: "origin" }, { x: 5, y: 5, label: "mid" }, { x: 10, y: 10, label: "far" }], color: 0 }, { name: "Line", type: "line", data: [[0, 10], [10, 0]], color: 1, hover: false }],
    marks: [{ type: "hline", y: 5, text: "half" }, { type: "hline", y: 5.1, text: "half again" }, { type: "vline", x: 2.5, text: "quarter" }],
    onClick: (e) => { click = e; } });
  await frame();
  const svg1 = c1box.querySelector("svg");
  const dots = [...svg1.querySelectorAll("circle")].map((c) => [Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))]);
  ok(dots.length === 3, "scatter draws one circle per point");
  near(dots[1][0], (dots[0][0] + dots[2][0]) / 2, 0.01, "linear x scale: the middle value sits midway");
  near(dots[1][1], (dots[0][1] + dots[2][1]) / 2, 0.01, "linear y scale: the middle value sits midway");
  ok(dots[2][1] < dots[0][1] && dots[2][0] > dots[0][0], "larger values are further right and higher up");
  const path = svg1.querySelector('path[fill="none"]').getAttribute("d");
  const [x1, y1, x2, y2] = path.match(/-?\d+(\.\d+)?/g).map(Number);
  near(x1, dots[0][0], 0.01, "line starts at x = 0"); near(y1, dots[2][1], 0.01, "line starts at y = 10"); near(x2, dots[2][0], 0.01, "line ends at x = 10"); near(y2, dots[0][1], 0.01, "line ends at y = 0");
  ok(c1box.querySelector(".chart-title").textContent === "Line and dots" && !c1box.querySelector(".chart-legend").hidden && c1box.querySelectorAll(".chart-legend span").length === 2, "two named series give a legend of two");
  ok(svg1.getAttribute("role") === "img" && svg1.getAttribute("aria-label") === "Line and dots" && svg1.tabIndex === 0, "chart is a focusable, named image");
  const labels = [...svg1.querySelectorAll(".mark-label")];
  const half = labels.find((l) => l.textContent === "half"), again = labels.find((l) => l.textContent === "half again");
  ok(half && again && Math.abs(Number(half.getAttribute("y")) - Number(again.getAttribute("y"))) >= 12, "labels of two close reference lines do not sit on top of each other");
  const vline = [...svg1.querySelectorAll("line[stroke-dasharray]")].find((l) => l.getAttribute("x1") === l.getAttribute("x2"));
  near(Number(vline.getAttribute("x1")), dots[0][0] + (dots[2][0] - dots[0][0]) * 0.25, 0.01, "vertical reference line is at its x");

  const tight = box(220);
  K.chart(tight, { height: 160, y: { format: () => "a tick label far too long for the space there is" }, series: [{ name: "A", type: "line", data: [[0, 1], [1, 2]] }] });
  await frame();
  ok([...tight.querySelectorAll("clipPath rect")].every((r) => Number(r.getAttribute("width")) > 0 && Number(r.getAttribute("height")) > 0), "tick labels wider than the chart still leave a plot to draw in");

  /* ---- chart: hover, keyboard, click, table twin ---- */
  const tip = c1box.querySelector(".chart-tip");
  const rect = svg1.getBoundingClientRect();
  const scale = rect.width / Number(svg1.getAttribute("viewBox").split(" ")[2]);
  fire(svg1, "pointermove", { clientX: rect.left + dots[1][0] * scale + 2, clientY: rect.top + dots[1][1] * scale - 2 });
  ok(!tip.hidden && tip.querySelector("b").textContent === "mid" && tip.textContent.includes("5"), "hovering near a dot shows that dot's label and values");
  fire(svg1, "pointerleave"); ok(tip.hidden, "leaving the chart hides the tooltip");
  // A finger: the tap itself shows the values, lifting the finger leaves them up, a tap elsewhere puts them away.
  const at = { clientX: rect.left + dots[2][0] * scale - 2, clientY: rect.top + dots[2][1] * scale + 2, pointerType: "touch" };
  fire(svg1, "pointerdown", at); ok(!tip.hidden && tip.querySelector("b").textContent === "far", "a tap on a chart shows the values at that point");
  fire(svg1, "pointerup", at); fire(svg1, "pointerleave", at); ok(!tip.hidden, "and they stay when the finger lifts");
  fire(document.body, "pointerdown", { pointerType: "touch" }); ok(tip.hidden, "until a tap somewhere else");
  fire(svg1, "keydown", { key: "ArrowRight" }); ok(!tip.hidden && tip.querySelector("b").textContent === "origin", "arrow keys walk the points from the left");
  fire(svg1, "keydown", { key: "End" }); ok(tip.querySelector("b").textContent === "far", "End jumps to the last point");
  fire(svg1, "keydown", { key: "Escape" }); ok(tip.hidden, "Escape hides the tooltip");
  fire(svg1, "click", { clientX: rect.left + dots[1][0] * scale, clientY: rect.top + dots[1][1] * scale });
  ok(click && click.point && click.point.label === "mid" && Math.abs(click.x - 5) < 0.1 && Math.abs(click.y - 5) < 0.1 && click.inside === true, `clicking reports the data position and the nearest point (got ${JSON.stringify(click && { x: click.x, y: click.y, label: click.point && click.point.label, inside: click.inside })})`);
  ok(Math.abs(click.toPx(5, 5)[0] - dots[1][0]) < 0.01 && Math.abs(click.toPx(5, 5)[1] - dots[1][1]) < 0.01 && Math.abs(click.px - dots[1][0]) < 1.5 && !click.key, "a click also reports where it landed in the drawing and the chart's scale");
  fire(svg1, "click", { clientX: rect.left + 2, clientY: rect.top + 2 });
  ok(click && click.inside === false, "a click in the margin is reported as outside the plot");
  click = null; fire(svg1, "keydown", { key: "Enter" }); ok(click === null, "Enter does nothing until the arrow keys are on a point");
  fire(svg1, "keydown", { key: "Home" }); fire(svg1, "keydown", { key: "ArrowRight" }); fire(svg1, "keydown", { key: "Enter" });
  ok(click && click.key === true && click.point.label === "mid" && click.x === 5 && click.y === 5 && click.inside === true, "Enter clicks the point the arrow keys are on");
  click = null; fire(svg1, "keydown", { key: " " }); ok(click && click.point.label === "mid", "and so does Space");
  fire(svg1, "keydown", { key: "Escape" });
  const details = c1box.querySelector("details.chart-table");
  ok(details.querySelector("summary").getAttribute("aria-label") === "Show the data as a table: Line and dots", "the table toggle says which chart it belongs to");
  details.open = true; fire(details, "toggle"); await frame();
  ok(details.querySelectorAll("tbody tr").length === 3 && details.querySelector("tbody").textContent.includes("origin"), "the data-table twin lists every point, and not the line that has hover off");

  // Dots over a line chart in the default (crosshair) mode: the table twin must still list the dots.
  const cmbox = box(600);
  K.chart(cmbox, { series: [{ name: "Fit", type: "line", data: [[0, 0], [1, 1], [2, 2]] }, { name: "Seen", type: "scatter", data: [{ x: 0.5, y: 0.7, label: "p1" }, { x: 1.5, y: 1.2, label: "p2" }] }] });
  await frame();
  const dm = cmbox.querySelector("details.chart-table");
  dm.open = true; fire(dm, "toggle"); await frame();
  ok(dm.querySelectorAll("table").length === 2 && dm.querySelectorAll("table")[0].querySelectorAll("tbody tr").length === 3 && dm.querySelectorAll("table")[1].textContent.includes("p2"), "a chart with a line and dots lists both in its data table");
  const longLog = box(320);
  K.chart(longLog, { x: { type: "log", domain: [1, 1e12] }, series: [{ data: [[1, 1], [1e12, 2]] }] });
  await frame();
  const tickXs = [...longLog.querySelectorAll("svg text")].filter((t) => Number(t.getAttribute("y")) > 200 && !t.classList.contains("ax-label")).map((t) => t.getBoundingClientRect()).sort((a, b) => a.left - b.left);
  ok(tickXs.length >= 2 && tickXs.every((r, i) => i === 0 || r.left >= tickXs[i - 1].right - 1), "labels on a long log axis do not overlap on a narrow chart");

  /* ---- chart: crosshair mode, log scale, bars, histogram, update ---- */
  const c2box = box(600);
  const c2 = K.chart(c2box, { x: { type: "log", label: "n" }, y: { label: "rate", format: (v) => `${v}%` }, series: [{ name: "A", data: [[1, 10], [10, 20], [100, 30]] }, { name: "B", data: [[1, 5], [10, 6], [100, 7]], hover: false }] });
  await frame();
  const svg2 = c2box.querySelector("svg");
  const d2 = svg2.querySelector('path[fill="none"]').getAttribute("d").match(/-?\d+(\.\d+)?/g).map(Number);
  near(d2[2] - d2[0], d2[4] - d2[2], 0.01, "log x scale: each tenfold step is the same distance");
  const r2 = svg2.getBoundingClientRect();
  fire(svg2, "pointermove", { clientX: r2.left + d2[2] * (r2.width / Number(svg2.getAttribute("viewBox").split(" ")[2])), clientY: r2.top + 50 });
  const tip2 = c2box.querySelector(".chart-tip");
  ok(!tip2.hidden && tip2.textContent.includes("20%") && tip2.textContent.includes("A") && !tip2.textContent.includes("6%"), "crosshair tooltip lists the series at that x, formatted, and skips series with hover off");
  ok(c2box.querySelector(".chart-legend").hidden === false, "legend shown for two named line series");
  c2.update({ series: [{ name: "Only", data: [[1, 1], [10, 2]] }] }); await frame();
  ok(c2box.querySelector(".chart-legend").hidden === true, "a single series needs no legend");
  c2.update({ series: [] }); await frame();
  ok([...svg2.querySelectorAll("text")].some((x) => x.textContent === "No data yet"), "an empty chart says so");

  const c3box = box(600);
  K.chart(c3box, { x: { type: "band" }, y: { label: "count" }, series: [{ name: "n", type: "bars", data: [["a", 2], ["b", 4], ["c", -2]] }] });
  await frame();
  const barPaths = [...c3box.querySelectorAll("svg path")].filter((p) => p.getAttribute("fill") !== "none");
  const heights = barPaths.map((p) => p.getBBox().height);
  near(heights[1] / heights[0], 2, 0.03, "bars: twice the value is twice the height");
  near(heights[2], heights[0], 0.6, "a negative bar is as long as a positive bar of the same size");
  ok(barPaths[2].getBBox().y > barPaths[0].getBBox().y, "a negative bar hangs below the baseline");
  ok(barPaths.every((p) => p.getBBox().width <= 24.01), "bars are never wider than 24 px");
  const c4box = box(600);
  K.chart(c4box, { x: { domain: [0, 4] }, series: [{ type: "hist", data: [[0, 1, 3], [1, 2, 6], [2, 4, 3]] }] });
  await frame();
  const rects = [...c4box.querySelectorAll("svg g rect")].map((r) => r.getBBox());
  near(rects[1].height / rects[0].height, 2, 0.03, "histogram heights follow the counts");
  near(rects[2].width / rects[0].width, 2, 0.08, "histogram widths follow the bin widths");

  /* ---- chart: resize ---- */
  const before = svg1.getAttribute("viewBox");
  c1box.style.width = "360px"; await frame(); await new Promise((r) => setTimeout(r, 120)); await frame();
  ok(svg1.getAttribute("viewBox") !== before && Number(svg1.getAttribute("viewBox").split(" ")[2]) <= 361, "chart redraws to its container's new width");
  ok(c1box.scrollWidth <= c1box.clientWidth + 1, "chart does not overflow a narrow container");

  /* ---- canvas ---- */
  const cvbox = box(150);
  let drew = null;
  const cv = K.canvas(cvbox, { height: 80, draw: (ctx, w, h) => { drew = [w, h]; ctx.fillRect(0, 0, w, h); } });
  await frame();
  const dpr = window.devicePixelRatio || 1;
  near(cv.width, cv.el.clientWidth, 0.5, "canvas reports its real width, even when narrow");
  ok(cv.width < 160 && cv.el.getBoundingClientRect().width <= cvbox.clientWidth + 0.5, "a narrow canvas fits its container and is not drawn as if it were 200 px wide");
  ok(drew && Math.abs(drew[0] - cv.el.clientWidth) <= 0.5 && drew[1] === 80 && cv.el.height === Math.round(80 * dpr) && cv.el.width === Math.round(cv.width * dpr), "canvas backing store matches its size and the screen's pixel ratio");

  /* ---- storage ---- */
  const store = K.store("kit-check");
  ok(store.get("missing", 7) === 7, "store returns the fallback for a missing key");
  if (store.set("k", { a: [1, 2] })) ok(JSON.stringify(store.get("k")) === '{"a":[1,2]}', "store round-trips JSON");
  store.remove("k"); ok(store.get("k", null) === null, "store removes keys");

  /* ---- shell and keyboard access to scrolling regions ---- */
  K.mount();
  ok(document.querySelector("header.top a.mark").textContent === "Varad Patel" && document.querySelector(".p-kicker .day").textContent === "Day 1", "mount adds the top bar and the day line");
  ok(document.querySelector("footer.foot a[href*='365projects/1']") && document.querySelector("a.skip").getAttribute("href") === "#app", "mount adds the footer links and the skip link");
  ok(document.body.classList.contains("s1"), "mount sets the part's colour class");
  const wide = K.table({ caption: "Wide", columns: Array.from({ length: 12 }, (_, i) => ({ key: `c${i}`, label: `Column number ${i}` })), rows: [Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}`, "some longer cell text"]))] });
  const narrow = box(300); narrow.append(wide);
  await new Promise((r) => setTimeout(r, 450));
  ok(wide.scrollWidth > wide.clientWidth && wide.tabIndex === 0 && wide.getAttribute("role") === "region" && /Wide/.test(wide.getAttribute("aria-label")), "a table that scrolls sideways can be reached and scrolled from the keyboard");
  const twins = [1, 2].map(() => K.table({ columns: Array.from({ length: 12 }, (_, i) => ({ key: `c${i}`, label: `Column number ${i}` })), rows: [{}] }));
  narrow.append(...twins);
  await new Promise((r) => setTimeout(r, 450));
  ok(twins[0].getAttribute("aria-label") === "Table (scrollable)" && twins[1].getAttribute("aria-label") === "Table 2 (scrollable)", `two scrolling regions of one kind get different names (got ${twins.map((t) => t.getAttribute("aria-label")).join(" / ")})`);
  narrow.style.width = "3000px"; window.dispatchEvent(new Event("resize"));
  await new Promise((r) => setTimeout(r, 450));
  ok(!wide.hasAttribute("tabindex") && !wide.hasAttribute("role"), "and stops being a tab stop when it no longer scrolls");
  ok(document.documentElement.scrollWidth - window.innerWidth < 2600, "(layout sanity)");

  return fails;
}

const args = process.argv.slice(2);
const wanted = args.includes("--browser") ? args[args.indexOf("--browser") + 1] : "chromium";
const engines = wanted === "all" ? ["chromium", "firefox", "webkit"] : wanted.split(",");
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
let failed = 0;
for (const engine of engines) {
  const browser = await ENGINES[engine].launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console error: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`uncaught: ${e.message}`));
  await page.goto(`${origin}/365projects/kit-check/`);
  let fails;
  try { fails = await page.evaluate(inPage); } catch (e) { fails = [`the check itself threw: ${String(e.message).slice(0, 300)}`]; }
  fails.push(...errors);
  if (fails.length) { failed++; console.log(`FAIL kit in ${engine}\n  ${fails.join("\n  ")}`); } else console.log(`ok   kit in ${engine}`);
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
