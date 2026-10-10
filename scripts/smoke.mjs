// Browser smoke test for project pages. Dev tooling only.
//
//   node scripts/smoke.mjs 1 2 3        test projects 1, 2 and 3
//   node scripts/smoke.mjs              test every folder under 365projects/ that has an index.html
//   node scripts/smoke.mjs 4 --shoot    also write the gallery thumbnail 365projects/img/004.jpg
//   node scripts/smoke.mjs --base https://varad-patel.github.io     test the published site instead of local files
//   node scripts/smoke.mjs 4 --eval "document.querySelector('#app input[type=checkbox]').click()"
//                                       run a snippet in the page after load and save .smoke/004-eval.png
//
// For each page it loads the page at desktop and phone width, fails on any console error, uncaught
// exception or failed request, checks that the tool and the write-up are present, exercises every
// slider, select, checkbox and button once, and saves screenshots to .smoke/ for a human (or Claude)
// to look at. Exit code 1 if anything fails.

import { createServer } from "node:http";
import { readFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".smoke");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
};
const HEADINGS = ["One finding", "The idea", "How it works", "What this cannot tell you", "Improvements and extensions"];

function serve() {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
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

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    for (const sub of ["chrome-win64", "chrome-win"]) {
      const exe = join(base, d, sub, "chrome.exe");
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

async function launch() {
  const exe = findChrome();
  if (exe) return chromium.launch({ executablePath: exe });
  for (const channel of ["chrome", "msedge"]) {
    try { return await chromium.launch({ channel }); } catch { /* try the next one */ }
  }
  throw new Error("No Chromium found. Set CHROME_PATH or run: npx playwright install chromium");
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

async function checkProject(browser, origin, id, shoot) {
  const problems = [];
  const url = `${origin}/365projects/${id}/`;
  const tag = String(id).padStart(3, "0");

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

  await mkdir(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${tag}-desktop.png`), fullPage: true });
  await page.locator("#app").screenshot({ path: join(OUT, `${tag}-app.png`) }).catch(() => {});
  if (shoot) {
    await mkdir(join(ROOT, "365projects", "img"), { recursive: true });
    await page.screenshot({ path: join(ROOT, "365projects", "img", `${tag}.jpg`), type: "jpeg", quality: 82 });
  }

  if (evalSnippet) {
    try { await page.evaluate(evalSnippet); } catch (e) { problems.push(`--eval failed: ${String(e.message).slice(0, 200)}`); }
    await settle(page);
    await page.locator("#app").screenshot({ path: join(OUT, `${tag}-eval.png`) }).catch(() => {});
    await desktop.close();
    return [...new Set(problems)];
  }
  await exercise(page);
  await settle(page);
  await page.locator("#app").screenshot({ path: join(OUT, `${tag}-app-after.png`) }).catch(() => {});
  await desktop.close();

  // Phone width.
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const small = await phone.newPage();
  watch(small, problems, origin);
  await small.goto(url);
  await settle(small);
  const sideways = await small.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (sideways > 1) problems.push(`page scrolls sideways at 390px by ${sideways}px`);
  await small.screenshot({ path: join(OUT, `${tag}-phone.png`), fullPage: true });
  await small.locator("#app").screenshot({ path: join(OUT, `${tag}-app-phone.png`) }).catch(() => {});
  await exercise(small);
  await settle(small);
  await phone.close();

  return [...new Set(problems)];
}

const args = process.argv.slice(2);
const shoot = args.includes("--shoot");
const evalAt = args.indexOf("--eval");
const evalSnippet = evalAt >= 0 ? args[evalAt + 1] : null;
const baseAt = args.indexOf("--base");
const base = baseAt >= 0 ? args[baseAt + 1].replace(/\/$/, "") : null;
let ids = args.filter((a, i) => /^\d+$/.test(a) && (evalAt < 0 || i !== evalAt + 1)).map(Number);
if (!ids.length) {
  const names = await readdir(join(ROOT, "365projects"));
  ids = names.filter((n) => /^\d+$/.test(n) && existsSync(join(ROOT, "365projects", n, "index.html"))).map(Number).sort((a, b) => a - b);
}

const server = base ? null : await serve();
const origin = base || `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
let failed = 0;
for (const id of ids) {
  let problems;
  try { problems = await checkProject(browser, origin, id, shoot); } catch (e) { problems = [`smoke test crashed: ${e.message}`]; }
  if (problems.length) { failed++; console.log(`FAIL ${id}\n  ${problems.join("\n  ")}`); } else console.log(`ok   ${id}`);
}
await browser.close();
server?.close();
console.log(`${ids.length - failed} of ${ids.length} passed. Screenshots are in .smoke/`);
process.exit(failed ? 1 : 0);
