/**
 * The bench, off the main thread.
 *
 * A Worker is not a nicety here. A solve at 18 bits is hundreds of thousands of
 * hashes; run on the main thread it would freeze the tab for seconds, and the
 * measurement would be contaminated by the browser's own reaction to being
 * blocked. It is also what the real client will have to do — item 2 of the
 * acceptance checklist wants the title pan smooth for 30 s, which cannot happen
 * if a solve is hogging the main thread.
 *
 * `src/bench/main.ts` falls back to running the same code on the main thread
 * when a Worker cannot be constructed, so the page still works rather than
 * showing nothing.
 */
import { runBench } from "../lib/bench.ts";
import type { WorkerMessage, WorkerRequest } from "./protocol.ts";

// Typed by hand rather than by switching the whole project to lib.webworker:
// this is the entire surface the Worker uses.
const ctx = self as unknown as {
  postMessage(message: WorkerMessage): void;
  addEventListener(type: "message", handler: (event: { data: WorkerRequest }) => void): void;
};

let cancelled = false;

/**
 * Throughput of `crypto.subtle.digest`, measured the way a client would
 * actually have to use it in a solve loop: awaited, one at a time, because the
 * next nonce is only worth trying if the previous one failed.
 *
 * Reported alongside the real number so "WebCrypto is too slow for the solve
 * loop" stays a measurement on this device rather than a claim in a comment.
 */
async function measureSubtle(budgetMs: number): Promise<number | null> {
  if (typeof crypto === "undefined" || crypto.subtle === undefined) return null;
  const encoder = new TextEncoder();
  const start = performance.now();
  let count = 0;
  try {
    while (performance.now() - start < budgetMs) {
      for (let i = 0; i < 25; i++) {
        await crypto.subtle.digest("SHA-256", encoder.encode(`bench:${count + i}:subtle`));
      }
      count += 25;
    }
  } catch {
    // subtle.digest needs a secure context; if it is unavailable, say nothing
    // rather than reporting a zero that reads like a measurement.
    return null;
  }
  const elapsed = performance.now() - start;
  return elapsed > 0 ? (count / elapsed) * 1000 : null;
}

ctx.addEventListener("message", (event) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelled = true;
    return;
  }
  cancelled = false;
  void (async () => {
    try {
      const results = await runBench(request.config, {
        onProgress: (progress) => ctx.postMessage({ kind: "progress", progress }),
        cancelled: () => cancelled,
      });
      const subtleHashesPerSecond = cancelled ? null : await measureSubtle(400);
      ctx.postMessage({ kind: "done", results, subtleHashesPerSecond });
    } catch (error) {
      ctx.postMessage({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  })();
});
