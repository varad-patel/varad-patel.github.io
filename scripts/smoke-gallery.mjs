// Browser check for the home page and the gallery. Dev tooling only.
//
//   node scripts/smoke-gallery.mjs [base-url]
//
// Without a URL it expects a local server at http://127.0.0.1:8123 (python -m http.server 8123).
// Fails on console errors or failed requests, checks that every built project has a card whose links
// open the project page in a new tab, and saves screenshots to .smoke/.

import { mkdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".smoke");
const base = (process.argv[2] || "http://127.0.0.1:8123").replace(/\/$/, "");

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const dir = join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!existsSync(dir)) return null;
  for (const d of readdirSync(dir).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const exe = join(dir, d, "chrome-win64", "chrome.exe");
    if (existsSync(exe)) return exe;
  }
  return null;
}

const exe = findChrome();
const browser = await chromium.launch(exe ? { executablePath: exe } : { channel: "msedge" });
const problems = [];
await mkdir(OUT, { recursive: true });

for (const [name, width, height] of [["desktop", 1280, 900], ["phone", 390, 800]]) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${name}: console error: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`${name}: uncaught: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`${name}: HTTP ${r.status()} ${r.url()}`); });

  await page.goto(`${base}/`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(OUT, `home-${name}.png`), fullPage: true });
  const status = await page.locator("#home-status").textContent();
  if (!/\d+ of 365 built/.test(status || "")) problems.push(`${name}: home page status reads "${status}"`);

  await page.goto(`${base}/365projects/`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  const facts = await page.evaluate(() => {
    const D = window.CHALLENGE;
    const built = D.projects.filter((p) => p.built);
    const cards = [...document.querySelectorAll(".plate")];
    const links = cards.flatMap((c) => [...c.querySelectorAll('a[href$="/"]')]);
    return {
      built: built.length,
      cards: cards.length,
      badLinks: links.filter((a) => a.target !== "_blank" || !/noopener/.test(a.rel) || !/^\d+\/$/.test(a.getAttribute("href"))).length,
      links: links.length,
      brokenImages: [...document.querySelectorAll(".plate img")].filter((i) => i.complete && i.naturalWidth === 0).length,
      sections: document.querySelectorAll(".sec").length,
      cells: document.querySelectorAll(".cell").length,
      doneCells: document.querySelectorAll(".cell.done").length,
      sideways: document.documentElement.scrollWidth - window.innerWidth,
      status: document.querySelector("#status").textContent,
    };
  });
  if (facts.cards !== facts.built) problems.push(`${name}: ${facts.built} built projects but ${facts.cards} cards`);
  if (facts.links !== facts.built * 2 || facts.badLinks) problems.push(`${name}: ${facts.links} project links, ${facts.badLinks} of them do not open N/ in a new tab`);
  if (facts.sections !== 13) problems.push(`${name}: ${facts.sections} parts in the legend, expected 13`);
  if (facts.cells !== 365 || facts.doneCells !== facts.built) problems.push(`${name}: calendar has ${facts.cells} cells, ${facts.doneCells} done`);
  if (facts.sideways > 1) problems.push(`${name}: gallery scrolls sideways by ${facts.sideways}px`);
  // Every thumbnail must load (lazy images load as they scroll into view).
  await page.evaluate(async () => { for (const img of document.querySelectorAll(".plate img")) { img.loading = "eager"; if (!img.complete) await new Promise((r) => { img.onload = img.onerror = r; }); } });
  const broken = await page.evaluate(() => [...document.querySelectorAll(".plate img")].filter((i) => i.naturalWidth === 0).length);
  if (broken) problems.push(`${name}: ${broken} thumbnails failed to load`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(OUT, `gallery-${name}-top.png`) });
  await page.screenshot({ path: join(OUT, `gallery-${name}.png`), fullPage: true });
  await page.locator("#gallery").scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector("#gallery").scrollIntoView());
  await page.screenshot({ path: join(OUT, `gallery-${name}-cards.png`) });

  // A card's link really opens the project in a new tab, and the project page works from there.
  if (name === "desktop" && facts.cards) {
    const [popup] = await Promise.all([context.waitForEvent("page"), page.locator(".plate a.btn.primary").first().click()]);
    await popup.waitForLoadState("networkidle");
    const where = new URL(popup.url()).pathname;
    const ok = await popup.evaluate(() => Boolean(document.querySelector("#app")?.children.length) && Boolean(document.querySelector("header.top")));
    if (!/\/365projects\/\d+\/$/.test(where) || !ok) problems.push(`new tab opened ${where}, tool present: ${ok}`);
    console.log(`first card opened ${where} in a new tab`);
    await popup.close();

    // Details dialog, search and filter.
    await page.locator(".plate button[data-open]").first().click();
    await page.waitForTimeout(200);
    if (!(await page.locator("dialog[open] #d-title").textContent())) problems.push("details dialog did not open");
    await page.screenshot({ path: join(OUT, "gallery-dialog.png") });
    await page.locator("#d-close").click();
    await page.locator("#q").fill("bayes");
    await page.waitForTimeout(150);
    const hits = await page.locator(".plate").count();
    if (hits < 1 || hits >= facts.cards) problems.push(`search for "bayes" shows ${hits} cards`);
    await page.locator("#q").fill("");
    await page.locator(".sec").nth(1).click();
    await page.waitForTimeout(150);
    if ((await page.locator(".plate").count()) !== 0) problems.push("filtering by part 2 still shows built cards");
    await page.locator(".sec").nth(1).click();
  }
  console.log(`${name}: ${facts.built} built, ${facts.cards} cards, status: ${facts.status.trim()}`);
  await context.close();
}
await browser.close();
if (problems.length) { console.log("FAIL\n  " + [...new Set(problems)].join("\n  ")); process.exit(1); }
console.log("ok   gallery and home page");
