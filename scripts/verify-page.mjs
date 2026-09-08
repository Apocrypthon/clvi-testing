/**
 * Drives the built acceptance page in a real iPhone-sized Chromium and asserts
 * the things this repo would otherwise be *claiming*: seven items render, every
 * control clears the 44 px floor item 3 demands, the page does not scroll
 * sideways, and a tapped verdict actually survives a reload.
 *
 * Deliberately NOT a devDependency. SEED.md's frozen stack rule says "no heavy
 * browser-automation deps unless STATE.md argues the case", and one verification
 * script is not that case. It runs against a globally installed Playwright:
 *
 *   npm i -g playwright && npx playwright install chromium   # once
 *   npm run build && node scripts/verify-page.mjs
 *
 * Exits non-zero on the first failure, and writes screenshots next to itself so
 * a session with no phone to hand can still look at what it built.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize, resolve } from "node:path";

const require = createRequire(import.meta.url);
const DIST = resolve(import.meta.dirname, "..", "dist");
const SHOTS = resolve(import.meta.dirname, "..", ".screenshots");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function serve() {
  const server = createServer(async (req, res) => {
    const raw = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const rel = normalize(raw === "/" ? "/index.html" : raw).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(DIST, rel));
      res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, port: server.address().port })));
}

const failures = [];
let checks = 0;

function check(label, condition, detail = "") {
  checks++;
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ""}`);
    failures.push(label);
  }
}

const { server, port } = await serve();
const base = `http://127.0.0.1:${port}`;

/** Resolves playwright from the project, then from the global root. */
async function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    // Not a project dependency by design; look where `npm i -g` put it.
  }
  try {
    const { execFileSync } = await import("node:child_process");
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return createRequire(join(root, "noop.js"))("playwright");
  } catch {
    return null;
  }
}

const playwright = await loadPlaywright();
if (playwright === null) {
  console.error("playwright is not available. Install it globally: npm i -g playwright");
  server.close();
  process.exit(2);
}
const { chromium } = playwright;

const browser = await chromium.launch();
// iPhone 13 / 14 / 15 logical viewport. Not a device descriptor lookup, so this
// keeps working if Playwright renames its presets.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();

page.on("dialog", (dialog) => dialog.accept());

const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

console.log(`\n── acceptance page, 390×844 ────────────────────────────────`);
await page.goto(`${base}/acceptance.html`, { waitUntil: "load" });

check("page title names the checklist", (await page.title()).includes("Acceptance"));
check("seven items render", (await page.locator("li.item").count()) === 7);
check("build stamp is filled in", /build \d{4}-\d{2}-\d{2}T/.test(await page.locator("#stamp").innerText()));
check("progress starts at 0/7", (await page.locator("#count").innerText()) === "0/7");

// Item 3, applied to this page itself.
const small = await page.$$eval(
  "button, summary, a.btn, input, textarea",
  (els) =>
    els
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), cls: el.className, w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((box) => box.w > 0 && box.h > 0 && (box.w < 44 || box.h < 44)),
);
check("every visible control is at least 44×44", small.length === 0, JSON.stringify(small));

// Item 1's "viewport clean", applied to this page itself.
const overflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
check(
  "no horizontal overflow",
  overflow.scrollWidth <= overflow.clientWidth + 1,
  `scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`,
);

// Tap a pass, a fail, and a note; then reload and see whether the phone kept them.
await page.locator("li.item").nth(4).locator("button.mark-pass").tap();
await page.locator("li.item").nth(1).locator("button.mark-fail").tap();
check("marking updates the count", (await page.locator("#count").innerText()) === "1/7");
check("a failed item is styled as failed", (await page.locator("li.item").nth(1).getAttribute("data-result")) === "fail");

await page.locator("li.item").nth(4).locator("details > summary").tap();
await page.locator("#note-dig").fill("solve took 4.2 s, burst fired");
check("opening details does not close on the next paint", await page.locator("#note-dig").isVisible());

await page.reload({ waitUntil: "load" });
check("a pass survives a reload", (await page.locator("li.item").nth(4).getAttribute("data-result")) === "pass");
check("a fail survives a reload", (await page.locator("li.item").nth(1).getAttribute("data-result")) === "fail");
await page.locator("li.item").nth(4).locator("details > summary").tap();
check("a note survives a reload", (await page.locator("#note-dig").inputValue()) === "solve took 4.2 s, burst fired");

await page.screenshot({ path: join(SHOTS, "acceptance-light.png"), fullPage: true });
await page.emulateMedia({ colorScheme: "dark" });
await page.screenshot({ path: join(SHOTS, "acceptance-dark.png"), fullPage: true });
await page.emulateMedia({ colorScheme: "light" });

// Filing a run: history grows, the current run clears.
await page.locator("#finish").tap();
await page.locator("#history-panel").waitFor();
check("filing a run clears the current one", (await page.locator("#count").innerText()) === "0/7");
check("the filed run appears in history", (await page.locator(".runs > li").count()) === 1);
const runLine = await page.locator(".runs summary").first().innerText();
check("the filed run is not reported green", runLine.includes("FAILED"), runLine);

await page.locator(".runs summary").first().tap();
check("the run snapshot keeps the note", (await page.locator(".run-items .note").first().innerText()).includes("4.2 s"));
check("history survives a reload", await page.reload({ waitUntil: "load" }).then(async () => {
  await page.locator("#history-panel").tap();
  return (await page.locator(".runs > li").count()) === 1;
}));

// An empty run must not be fileable — the history is evidence, not a scratchpad.
await page.locator("#history-panel").tap();
const before = await page.locator(".runs > li").count();
await page.locator("#finish").tap();
check("an unmarked run cannot be filed", (await page.locator(".runs > li").count()) === before);

// A note containing markup must stay text.
await page.locator("li.item").nth(0).locator("details > summary").tap();
await page.locator("#note-load").fill("<img src=x onerror=alert(1)>");
await page.locator("li.item").nth(0).locator("button.mark-pass").tap();
await page.locator("#finish").tap();
await page.locator(".runs summary").first().tap();
check(
  "a note containing markup is rendered as text, not HTML",
  (await page.locator(".run-items .note").first().innerText()).includes("<img"),
);
check("no element was injected by the note", (await page.locator(".run-items img").count()) === 0);

check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.join("\n       "));

console.log(`\n── bench page, 390×844 ─────────────────────────────────────`);
await page.goto(`${base}/bench.html`, { waitUntil: "load" });

check("bench title names the bench", (await page.title()).includes("Solve bench"));
check("it asks for the device before anything else", await page.locator("#device").isVisible());
check("an unnamed device is called out", (await page.locator("#notice").innerText()).includes("rumour"));

const benchSmall = await page.$$eval("button, summary, a.btn, input, textarea", (els) =>
  els
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: el.className, w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((box) => box.w > 0 && box.h > 0 && (box.w < 44 || box.h < 44)),
);
check("every bench control is at least 44×44", benchSmall.length === 0, JSON.stringify(benchSmall));

const benchOverflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
check("bench page does not scroll sideways", benchOverflow.scrollWidth <= benchOverflow.clientWidth + 1);

await page.locator("#device").fill("Verification Chromium · 390×844");
await page.locator(".seg button").first().tap(); // shortest budget
check("the budget control records a choice", (await page.locator(".seg button").first().getAttribute("aria-pressed")) === "true");

// Actually run it. Three difficulties at the 3 s budget, plus the subtle
// comparison — this is the real hash loop, not a stub.
await page.locator("#controls .btn-primary").tap();
check("progress appears while it runs", await page.locator("#live").isVisible());
await page.locator(".verdict-card").waitFor({ timeout: 90_000 });

const verdict = await page.locator(".verdict-card .big").innerText();
check("it reaches a recommendation", verdict.length > 0, verdict);
check("the results table has a row per difficulty", (await page.locator("table.bench tbody tr").count()) === 3);

const rows = await page.locator("table.bench tbody tr").allInnerTexts();
check("every difficulty measured a non-zero rate", rows.every((r) => !r.includes("—\t—")), JSON.stringify(rows));

const markdown = await page.locator("pre.copyout").innerText();
check("the copy block names the device", markdown.includes("Verification Chromium"));
check("the copy block ran in a Worker, not the fallback", markdown.includes("Worker"), markdown.split("\n")[2]);
check("the copy block carries a markdown table", markdown.includes("| bits | hashes/sec |"));
check("the copy block states a recommendation", /Recommended `difficultyBits`|No difficulty fits/.test(markdown));
check("the table is horizontally scrollable rather than overflowing", await page.locator(".table-scroll").isVisible());

const benchOverflowAfter = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
check(
  "results do not make the page scroll sideways",
  benchOverflowAfter.scrollWidth <= benchOverflowAfter.clientWidth + 1,
  `scrollWidth ${benchOverflowAfter.scrollWidth} > clientWidth ${benchOverflowAfter.clientWidth}`,
);

await page.screenshot({ path: join(SHOTS, "bench-light.png"), fullPage: true });
console.log("\n  measured on this runner:\n" + markdown.split("\n").map((l) => "    " + l).join("\n"));

console.log(`\n── index page ──────────────────────────────────────────────`);
await page.goto(`${base}/index.html`, { waitUntil: "load" });
check("index title carries the build timestamp", /^clvi-testing · \d{4}-\d{2}-\d{2}T/.test(await page.title()));
check("index links to the checklist", (await page.locator('a[href="./acceptance.html"]').count()) === 1);
check("index links to the bench", (await page.locator('a[href="./bench.html"]').count()) === 1);
await page.screenshot({ path: join(SHOTS, "index-light.png"), fullPage: true });

await browser.close();
server.close();

console.log(`\n${checks - failures.length}/${checks} checks passed. Screenshots in .screenshots/`);
if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.join(", ")}`);
  process.exit(1);
}
