// Browser smoke test for project pages. Dev tooling only.
//
//   node scripts/smoke.mjs 1 2 3                 test projects 1, 2 and 3 in Chromium
//   node scripts/smoke.mjs                       test every folder under 365projects/ that has an index.html
//   node scripts/smoke.mjs 4 --browser all       also run in Firefox and WebKit (Safari's engine)
//   node scripts/smoke.mjs 4 --shoot             also write the gallery thumbnail 365projects/img/004.jpg
//   node scripts/smoke.mjs --base https://varad-patel.github.io     test the published site instead of local files
//   node scripts/smoke.mjs 4 --eval "document.querySelector('#app input[type=checkbox]').click()"
//                                                run a snippet in the page after load and save .smoke/004-eval.png
//   node scripts/smoke.mjs 4 --no-a11y           skip the accessibility audit
//
// For each page and each browser engine it loads the page at desktop and phone width, fails on any
// console error, uncaught exception or failed request, checks that the tool and the write-up are
// present, exercises every slider, select, checkbox and button once, and saves screenshots to .smoke/
// for a human (or Claude) to look at. In Chromium it also runs the axe-core accessibility audit
// (WCAG 2.1 A and AA) on the page as loaded and again after every control has been used.
// Exit code 1 if anything fails.
//
// Browsers come from Playwright: npx playwright-core install chromium firefox webkit

import { createServer } from "node:http";
import { readFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".smoke");
const AXE = join(ROOT, "node_modules", "axe-core", "axe.min.js");
const ENGINES = { chromium, firefox, webkit };
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
};
const HEADINGS = ["One finding", "The idea", "How it works", "What this cannot tell you", "Improvements and extensions"];

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let file = join(ROOT, path);
      if (!file.startsWith(ROOT)) throw new Error("outside root");
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

// Fallback for Chromium when Playwright's own build for this version is not installed.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dir = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(dir)) return null;
  const builds = readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of builds) {
    for (const sub of ["chrome-win64", "chrome-win"]) {
      const exe = join(dir, d, sub, "chrome.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

// The full-page picture is for a person to look at, not a check. Firefox and WebKit cannot draw an image taller
// than 32,767 device pixels, so a very long phone page falls back to its first screen instead of failing the run.
const picture = (page, path) => page.screenshot({ path, fullPage: true }).catch(() => page.screenshot({ path }));

async function launch(engine) {
  if (engine !== "chromium") return ENGINES[engine].launch();
  try { return await chromium.launch(); } catch { /* fall through to other Chromium builds */ }
  const exe = findChrome();
  if (exe) return chromium.launch({ executablePath: exe });
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel }); } catch { /* try the next one */ }
  }
  throw new Error("No Chromium found. Run: npx playwright-core install chromium");
}

function watch(page, problems, origin) {
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console error: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url().replace(origin, "")}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url().replace(origin, "")}`); });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(350);
}

// Use every control once. Anything that throws shows up through watch().
async function exercise(page) {
  await page.evaluate(async () => {
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const app = document.querySelector("#app");
    const visible = (n) => n.offsetParent !== null && !n.disabled;
    const fire = (n, type) => n.dispatchEvent(new Event(type, { bubbles: true }));
    for (const input of [...app.querySelectorAll('input[type="range"]')].filter(visible)) {
      const { min, max, value } = input;
      for (const v of [min || 0, max || 100, value]) { input.value = v; fire(input, "input"); fire(input, "change"); await pause(15); }
    }
    for (const select of [...app.querySelectorAll("select")].filter(visible)) {
      const start = select.selectedIndex;
      for (let i = 0; i < Math.min(select.options.length, 8); i++) { select.selectedIndex = i; fire(select, "input"); fire(select, "change"); await pause(15); }
      select.selectedIndex = start; fire(select, "input"); fire(select, "change");
    }
    for (const box of [...app.querySelectorAll('input[type="checkbox"], input[type="radio"]')].filter(visible)) { box.click(); await pause(15); }
    for (const box of [...app.querySelectorAll('input[type="checkbox"]')].filter(visible)) { box.click(); await pause(15); }
    let clicks = 0;
    for (const button of [...app.querySelectorAll("button")]) {
      if (!document.contains(button) || !visible(button) || clicks >= 60) continue;
      button.click(); clicks++; await pause(40);
    }
    await pause(300);
  });
}

// Accessibility audit with axe-core: every WCAG 2.1 A or AA violation is a failure.
async function audit(page, problems, when) {
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, first: v.nodes[0]?.target.join(" "), detail: v.nodes[0]?.failureSummary?.split("\n").slice(1, 2).join(" ").trim() }));
  });
  for (const v of violations) problems.push(`a11y (${when}, ${v.impact}): ${v.id}: ${v.help}. ${v.count} element(s), first: ${v.first}${v.detail ? ` [${v.detail.slice(0, 140)}]` : ""}`);

  // axe does not measure the contrast of text drawn inside an SVG, so that is done here: each <text> against whatever
  // is painted under its centre (WCAG 1.4.3: 4.5 to 1, or 3 to 1 for text of 24px and up, or 18.66px and bold).
  const faint = await page.evaluate(() => {
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
    const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const out = [];
    for (const t of document.querySelectorAll("main svg text")) {
      const cs = getComputedStyle(t);
      if (!t.textContent.trim() || cs.visibility === "hidden" || t.closest("[aria-hidden='true']")) continue;
      t.scrollIntoView({ block: "center", inline: "center" });
      const box = t.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const fill = parse(cs.fill);
      if (!fill) continue;
      fill.a *= Number(cs.fillOpacity);
      for (let n = t; n instanceof Element; n = n.parentElement) fill.a *= Number(getComputedStyle(n).opacity);
      if (fill.a < 0.02) continue; // not drawn
      const layers = [];
      for (const node of document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)) {
        if (node === t || node.closest("text")) continue;
        const s = getComputedStyle(node);
        const shape = node instanceof SVGGeometryElement;
        const paint = parse(shape ? s.fill : s.backgroundColor);
        if (!paint) continue;
        paint.a *= (shape ? Number(s.fillOpacity) : 1) * Number(s.opacity);
        if (paint.a > 0.01) layers.push(paint);
        if (paint.a > 0.99) break;
      }
      // A label drawn with an opaque outline behind its letters (paint-order: stroke) is read against that outline.
      const halo = cs.paintOrder.startsWith("stroke") && parseFloat(cs.strokeWidth) >= 2 ? parse(cs.stroke) : null;
      const under = halo && halo.a > 0.99 ? halo : layers.reduceRight((acc, layer) => blend(layer, acc), { r: 255, g: 255, b: 255, a: 1 });
      const ink = blend(fill, under);
      const [hi, lo] = [lum(ink), lum(under)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < need - 0.05) out.push(`"${t.textContent.trim().slice(0, 30)}" is ${ratio.toFixed(1)} to 1, needs ${need}`);
    }
    window.scrollTo(0, 0);
    return [...new Set(out)];
  });
  if (faint.length) problems.push(`a11y (${when}): ${faint.length} piece(s) of SVG text with too little contrast, first: ${faint.slice(0, 3).join("; ")}`);
}

async function checkProject(browser, origin, id, opts) {
  const problems = [];
  const url = `${origin}/365projects/${id}/`;
  const tag = String(id).padStart(3, "0") + (opts.engine === "chromium" ? "" : `-${opts.engine}`);
  const a11y = opts.a11y && opts.engine === "chromium";

  // Desktop, fresh load.
  const desktop = await browser.newContext({ viewport: { width: 1200, height: 793 }, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  watch(page, problems, origin);
  await page.goto(url);
  await settle(page);

  const facts = await page.evaluate((headings) => {
    const app = document.querySelector("#app");
    const h2 = [...document.querySelectorAll("h2")].map((h) => h.textContent.trim());
    return {
      title: document.title,
      h1: document.querySelector("h1")?.textContent.trim() || "",
      day: document.body.dataset.day || "",
      shell: Boolean(document.querySelector("header.top")) && Boolean(document.querySelector(".p-kicker")),
      appHeight: app ? app.getBoundingClientRect().height : 0,
      appKids: app ? app.querySelectorAll("*").length : 0,
      missing: headings.filter((h) => !h2.includes(h)),
      emptySections: [...document.querySelectorAll("main section")].filter((s) => s.id !== "app" && s.textContent.trim().length < 80).length,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      favicon: Boolean(document.querySelector('link[rel="icon"]')),
      junk: (app?.innerText.match(/\b(NaN|undefined|Infinity|null)\b/g) || []).slice(0, 3),
    };
  }, HEADINGS);
  if (!facts.title) problems.push("no <title>");
  if (!facts.h1) problems.push("no <h1>");
  if (facts.day !== String(id)) problems.push(`<body data-day> is "${facts.day}", expected "${id}"`);
  if (!facts.shell) problems.push("kit shell not mounted (call mount() from kit.js)");
  if (facts.appHeight < 150 || facts.appKids < 8) problems.push(`#app looks empty (height ${Math.round(facts.appHeight)}px, ${facts.appKids} nodes)`);
  if (facts.missing.length) problems.push(`missing sections: ${facts.missing.join(", ")}`);
  if (facts.emptySections) problems.push(`${facts.emptySections} write-up section(s) are nearly empty`);
  if (facts.overflow > 1) problems.push(`page scrolls sideways at 1200px by ${facts.overflow}px`);
  if (!facts.favicon) problems.push('no <link rel="icon"> (copy the head from project 1)');
  if (facts.junk.length) problems.push(`the tool shows ${facts.junk.join(", ")} on load`);

  await mkdir(OUT, { recursive: true });
  await picture(page, join(OUT, `${tag}-desktop.png`));
  await page.locator("#app").screenshot({ path: join(OUT, `${tag}-app.png`) }).catch(() => {});
  if (opts.shoot && opts.engine === "chromium") {
    await mkdir(join(ROOT, "365projects", "img"), { recursive: true });
    await page.screenshot({ path: join(ROOT, "365projects", "img", `${String(id).padStart(3, "0")}.jpg`), type: "jpeg", quality: 82 });
  }
  if (a11y) await audit(page, problems, "on load");

  if (opts.evalSnippet) {
    try { await page.evaluate(opts.evalSnippet); } catch (e) { problems.push(`--eval failed: ${String(e.message).slice(0, 200)}`); }
    await settle(page);
    await page.locator("#app").screenshot({ path: join(OUT, `${tag}-eval.png`) }).catch(() => {});
    await desktop.close();
    return [...new Set(problems)];
  }
  await exercise(page);
  await settle(page);
  await page.locator("#app").screenshot({ path: join(OUT, `${tag}-app-after.png`) }).catch(() => {});
  const junkAfter = await page.evaluate(() => (document.querySelector("#app")?.innerText.match(/\b(NaN|undefined|Infinity)\b/g) || []).slice(0, 3));
  if (junkAfter.length) problems.push(`after using every control the tool shows ${junkAfter.join(", ")}`);
  if (a11y) await audit(page, problems, "after use");
  await desktop.close();

  // Phone width.
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const small = await phone.newPage();
  watch(small, problems, origin);
  await small.goto(url);
  await settle(small);
  const sideways = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sideways > 1) problems.push(`page scrolls sideways at 390px by ${sideways}px`);
  await picture(small, join(OUT, `${tag}-phone.png`));
  await small.locator("#app").screenshot({ path: join(OUT, `${tag}-app-phone.png`) }).catch(() => {});
  if (a11y) await audit(small, problems, "phone");
  await exercise(small);
  await settle(small);
  const sidewaysAfter = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sidewaysAfter > 1) problems.push(`page scrolls sideways at 390px by ${sidewaysAfter}px after using the controls`);
  await phone.close();

  return [...new Set(problems)];
}

/* ---------- command line ---------- */
const args = process.argv.slice(2);
const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const valueSlots = new Set(["--eval", "--base", "--browser"].map((f) => args.indexOf(f)).filter((i) => i >= 0).map((i) => i + 1));
const shoot = args.includes("--shoot");
const a11y = !args.includes("--no-a11y") && existsSync(AXE);
const evalSnippet = valueOf("--eval");
const baseUrl = valueOf("--base")?.replace(/\/$/, "") || null;
const wanted = valueOf("--browser") || "chromium";
const engines = wanted === "all" ? ["chromium", "firefox", "webkit"] : wanted.split(",");
for (const e of engines) if (!ENGINES[e]) { console.error(`unknown browser "${e}": use chromium, firefox, webkit or all`); process.exit(2); }

let ids = args.filter((a, i) => /^\d+$/.test(a) && !valueSlots.has(i)).map(Number);
if (!ids.length) {
  const names = await readdir(join(ROOT, "365projects"));
  ids = names.filter((n) => /^\d+$/.test(n) && existsSync(join(ROOT, "365projects", n, "index.html"))).map(Number).sort((a, b) => a - b);
}
if (!args.includes("--no-a11y") && !existsSync(AXE)) console.log("note: axe-core is not installed (npm install), so the accessibility audit is skipped");

const server = baseUrl ? null : await serve();
const origin = baseUrl || `http://127.0.0.1:${server.address().port}`;
let failed = 0, restarts = 0;
for (const engine of engines) {
  let browser = await launch(engine);
  for (const id of ids) {
    let problems;
    // A headless browser occasionally dies under load. That is not the page's fault: start a new one and try once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!browser.isConnected()) browser = await launch(engine);
      try { problems = await checkProject(browser, origin, id, { engine, shoot, a11y, evalSnippet }); break; } catch (e) {
        problems = [`smoke test crashed: ${String(e.message).slice(0, 160)}`];
        if (attempt === 1 || !/has been closed|crash|disconnected/i.test(String(e.message))) break;
        restarts++;
        await browser.close().catch(() => {});
        browser = await launch(engine);
      }
    }
    const label = engines.length > 1 ? `${id} ${engine}` : String(id);
    if (problems.length) { failed++; console.log(`FAIL ${label}\n  ${problems.join("\n  ")}`); } else console.log(`ok   ${label}`);
  }
  await browser.close().catch(() => {});
}
server?.close();
const total = ids.length * engines.length;
console.log(`${total - failed} of ${total} passed (${engines.join(", ")}${a11y ? ", with accessibility audit" : ""}${restarts ? `; browser restarted ${restarts} time(s)` : ""}). Screenshots are in .smoke/`);
process.exit(failed ? 1 : 0);
