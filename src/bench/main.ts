/**
 * T3 — the solve bench page.
 *
 * Measures this device's SHA-256 rate and answers the question the backend
 * actually needs answered: which `difficultyBits` puts a solve inside item 5's
 * 3-8 s window on this phone.
 *
 * The hashing runs in a Worker (see worker.ts). If a Worker cannot be
 * constructed the page runs the identical code on the main thread, yielding
 * between chunks — slower and jankier, but a real result beats a blank page.
 */
import {
  type BenchProgress,
  type BenchReport,
  type DifficultyResult,
  formatBenchMarkdown,
  formatDuration,
  formatRate,
  recommendDifficulty,
  runBench,
} from "../lib/bench.ts";
import { KEYS, openStore, readKey, writeKey } from "../lib/storage.ts";
import { clear, h, must, on } from "../acceptance/dom.ts";
import type { WorkerMessage, WorkerRequest } from "./protocol.ts";

const BUILD_TIME = __BUILD_TIME__;
const DIFFICULTIES = [14, 16, 18] as const;
const BUDGETS = [3_000, 6_000, 12_000] as const;

const persistence = openStore();
// Shares the acceptance page's device field: it is the same phone, and being
// asked to type "iPhone 13 · iOS 18.2" twice is how it ends up blank.
let device = readKey(persistence.store, KEYS.device) ?? "";
let budgetMs: number = BUDGETS[1];
let running = false;
let worker: Worker | null = null;
let cancelMainThread = false;

must<HTMLElement>("stamp").textContent = `build ${BUILD_TIME}`;

/* ----------------------------------------------------------------- setup -- */

function renderNotice(): void {
  const notice = must<HTMLElement>("notice");
  const lines: string[] = [];
  if (device.trim() === "") {
    lines.push("Name the device before you run this. A hash rate without a device is a rumour, and docs/BENCH.md will say UNRECORDED DEVICE.");
  }
  if (!persistence.durable) {
    lines.push("This phone is not saving the device name (Private Browsing or full storage).");
  }
  notice.textContent = lines.join(" ");
}

function renderSetup(): void {
  const root = must<HTMLElement>("setup");
  clear(root);

  const deviceInput = h("input", {
    type: "text",
    id: "device",
    value: device,
    placeholder: "iPhone 13 · iOS 18.2 · Safari",
    autocomplete: "off",
  });
  on(deviceInput, "input", () => {
    device = deviceInput.value;
    writeKey(persistence.store, KEYS.device, device);
    renderNotice();
  });

  const seg = h("div", { class: "seg" });
  for (const value of BUDGETS) {
    const button = h("button", {
      type: "button",
      "aria-pressed": String(value === budgetMs),
      text: `${value / 1000}s`,
    });
    on(button, "click", () => {
      if (running) return;
      budgetMs = value;
      renderSetup();
    });
    seg.append(button);
  }

  root.append(
    h(
      "label",
      { class: "field", for: "device" },
      h("span", { text: "Device" }),
      deviceInput,
      h("span", { class: "hint", text: "Goes into the result. Model, iOS version, browser." }),
    ),
    h(
      "div",
      { class: "field" },
      h("span", { text: "Time budget per difficulty" }),
      seg,
      h("span", {
        class: "hint",
        text: `Bench runs ${DIFFICULTIES.join(", ")} bits. A slow phone may not finish a single 18-bit solve inside 3 s — that is still a usable result, because the rate is measured from every hash, not only completed solves.`,
      }),
    ),
  );
}

/* --------------------------------------------------------------- running -- */

const liveEl = must<HTMLElement>("live");
const rateEl = must<HTMLElement>("live-rate");
const stageEl = must<HTMLElement>("live-stage");
const fillEl = must<HTMLElement>("live-fill");
const detailEl = must<HTMLElement>("live-detail");

function showProgress(progress: BenchProgress): void {
  liveEl.hidden = false;
  const rate = progress.ms > 0 ? (progress.hashes / progress.ms) * 1000 : 0;
  rateEl.textContent = formatRate(rate);
  stageEl.textContent = `${progress.difficultyBits} bits`;
  stageEl.dataset["verdict"] = "incomplete";
  const perDifficulty = 1 / DIFFICULTIES.length;
  const index = DIFFICULTIES.indexOf(progress.difficultyBits as (typeof DIFFICULTIES)[number]);
  const overall = (Math.max(0, index) + progress.fraction) * perDifficulty;
  fillEl.style.width = `${Math.min(100, overall * 100).toFixed(1)}%`;
  detailEl.textContent = `${progress.hashes.toLocaleString("en-US")} hashes · ${progress.samples} solve${progress.samples === 1 ? "" : "s"}`;
}

function renderControls(): void {
  const root = must<HTMLElement>("controls");
  clear(root);

  const run = h("button", {
    class: "btn btn-primary",
    type: "button",
    text: running ? "Running…" : "Run bench",
    ...(running ? { disabled: true } : {}),
  });
  on(run, "click", () => void start());

  const stop = h("button", { class: "btn", type: "button", text: "Stop", ...(running ? {} : { disabled: true }) });
  on(stop, "click", () => {
    cancelMainThread = true;
    worker?.postMessage({ kind: "cancel" } satisfies WorkerRequest);
  });

  root.append(run, stop);
}

async function start(): Promise<void> {
  if (running) return;
  running = true;
  cancelMainThread = false;
  clear(must<HTMLElement>("results"));
  liveEl.hidden = false;
  fillEl.style.width = "0%";
  stageEl.textContent = "starting";
  detailEl.textContent = "";
  renderControls();

  const config = {
    difficulties: [...DIFFICULTIES],
    playerId: "bench",
    budgetMsPerDifficulty: budgetMs,
    maxSamples: 12,
  };

  try {
    const outcome = await runInWorker(config);
    finish(outcome.results, outcome.subtleHashesPerSecond, outcome.engine);
  } catch (error) {
    must<HTMLElement>("results").append(
      h("p", { class: "notice", text: `The bench could not run: ${error instanceof Error ? error.message : String(error)}` }),
    );
  } finally {
    running = false;
    renderControls();
  }
}

interface Outcome {
  results: DifficultyResult[];
  subtleHashesPerSecond: number | null;
  engine: string;
}

function runInWorker(config: BenchProgressConfig): Promise<Outcome> {
  return new Promise<Outcome>((resolve, reject) => {
    let instance: Worker;
    try {
      instance = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    } catch {
      // No Worker (old Safari, a sandboxed context). Run it here instead, and
      // say so in the result: main-thread numbers are lower and the reader
      // deserves to know which they are looking at.
      resolve(runOnMainThread(config));
      return;
    }
    worker = instance;
    instance.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.kind === "progress") showProgress(message.progress);
      else if (message.kind === "done") {
        instance.terminate();
        worker = null;
        resolve({
          results: message.results,
          subtleHashesPerSecond: message.subtleHashesPerSecond,
          engine: "pure-JS sha256, Worker",
        });
      } else {
        instance.terminate();
        worker = null;
        reject(new Error(message.message));
      }
    });
    instance.addEventListener("error", () => {
      instance.terminate();
      worker = null;
      resolve(runOnMainThread(config));
    });
    instance.postMessage({ kind: "run", config } satisfies WorkerRequest);
  });
}

type BenchProgressConfig = Parameters<typeof runBench>[0];

async function runOnMainThread(config: BenchProgressConfig): Promise<Outcome> {
  const results = await runBench(config, {
    onProgress: showProgress,
    cancelled: () => cancelMainThread,
    breathe: () => new Promise((resolve) => setTimeout(resolve, 0)),
  });
  return { results, subtleHashesPerSecond: null, engine: "pure-JS sha256, main thread (no Worker available)" };
}

/* --------------------------------------------------------------- results -- */

function finish(results: DifficultyResult[], subtleHashesPerSecond: number | null, engine: string): void {
  liveEl.hidden = true;
  const root = must<HTMLElement>("results");
  clear(root);

  const measured = results.filter((result) => result.hashesPerSecond > 0);
  if (measured.length === 0) {
    root.append(h("p", { class: "notice", text: "Stopped before anything was measured." }));
    return;
  }

  // The rate is the same work regardless of difficulty, so pool every hash the
  // run performed rather than trusting whichever difficulty happened to get the
  // cleanest slice of CPU.
  const totalHashes = measured.reduce((sum, result) => sum + result.hashes, 0);
  const totalMs = measured.reduce((sum, result) => sum + result.ms, 0);
  const pooledRate = totalMs > 0 ? (totalHashes / totalMs) * 1000 : 0;
  const recommendation = recommendDifficulty(pooledRate);

  const report: BenchReport = {
    at: new Date().toISOString(),
    device,
    buildTime: BUILD_TIME,
    engine,
    results,
    recommendation,
    subtleHashesPerSecond,
  };

  root.append(
    h(
      "div",
      { class: "verdict-card", data: { ok: String(recommendation.best !== null) } },
      recommendation.best === null
        ? h("span", { class: "big", text: "No difficulty fits" })
        : h("span", { class: "big", text: `difficultyBits ${recommendation.best}` }),
      h("span", {
        class: "why",
        text:
          recommendation.best === null
            ? `${recommendation.note}. Measured ${formatRate(pooledRate)} on this device.`
            : `Projected median solve ${formatDuration(recommendation.bestMedianMs ?? 0)} at ${formatRate(pooledRate)}. ` +
              `${recommendation.fits.length > 1 ? `${recommendation.fits.join(", ")} all fit the 3–8 s window.` : "The only difficulty that fits the 3–8 s window."}`,
      }),
    ),
  );

  const body = h("tbody");
  for (const result of results) {
    body.append(
      h(
        "tr",
        {},
        h("td", { class: "headline", text: `${result.difficultyBits} bits` }),
        h("td", { text: formatRate(result.hashesPerSecond) }),
        h("td", { text: formatDuration(result.projectedMedianMs) }),
        h("td", { text: result.observedMedianMs === null ? "—" : formatDuration(result.observedMedianMs) }),
        h("td", { text: `${result.samples.length}${result.truncated ? "+" : ""}` }),
      ),
    );
  }

  root.append(
    h(
      "div",
      { class: "table-scroll" },
      h(
        "table",
        { class: "bench" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { text: "difficulty" }),
            h("th", { text: "hashes/sec" }),
            h("th", { text: "projected median" }),
            h("th", { text: "observed" }),
            h("th", { text: "solves" }),
          ),
        ),
        body,
      ),
    ),
  );

  if (subtleHashesPerSecond !== null) {
    root.append(
      h("p", {
        class: "dim",
        text:
          `crypto.subtle.digest on this device: ${formatRate(subtleHashesPerSecond)} — ` +
          `${(pooledRate / subtleHashesPerSecond).toFixed(1)}× slower than hashing synchronously, which is why the solve loop does not use it.`,
      }),
    );
  }

  const markdown = formatBenchMarkdown(report);
  const copy = h("button", { class: "btn btn-primary", type: "button", text: "Copy for docs/BENCH.md" });
  const output = h("pre", { class: "copyout", text: markdown });
  on(copy, "click", () => {
    void navigator.clipboard
      .writeText(markdown)
      .then(() => {
        copy.textContent = "Copied";
        setTimeout(() => (copy.textContent = "Copy for docs/BENCH.md"), 1600);
      })
      .catch(() => {
        copy.textContent = "Select the block below";
      });
  });

  root.append(h("div", { class: "actions" }, copy), output);
}

/* ------------------------------------------------------------------ boot -- */

renderSetup();
renderNotice();
renderControls();
