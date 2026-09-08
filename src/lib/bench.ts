/**
 * T3 — the solve bench.
 *
 * What it is for: item 5 of the acceptance checklist says a dig must solve in
 * 3-8 s. That is a claim about hash rate on a real phone, and the backend picks
 * its start `difficultyBits` from it. Today that number is a guess (the backend
 * defaults to 18, clamped to [12, 24]). This measures it instead.
 *
 * Everything here is pure and injectable so `node --test` can drive the same
 * code the page runs. The only impure thing a bench needs is a clock, and that
 * is a parameter.
 */
import { medianSolveMs } from "./pow.ts";
import { sha256FirstWord } from "./sha256.ts";

/**
 * Nonces are formatted to a fixed width so the preimage's byte length never
 * changes. That lets the solver hash out of one preallocated buffer with no
 * per-iteration allocation — see `sha256FirstWord(message, length)`.
 */
export const NONCE_HEX_WIDTH = 8;

export function formatNonce(nonce: number): string {
  return nonce.toString(16).padStart(NONCE_HEX_WIDTH, "0");
}

/** Digest-of-a-prefix, injectable so tests can drive the solver deterministically. */
export type WordDigest = (message: Uint8Array, length: number) => number;

export interface SolverOptions {
  salt: string;
  playerId: string;
  difficultyBits: number;
  startNonce?: number;
  digest?: WordDigest;
}

export interface StepResult {
  /** Hashes performed in this step. */
  hashes: number;
  /** The winning nonce, or null when the step ran out of budget first. */
  nonce: string | null;
}

export interface Solver {
  /** Runs at most `budget` hashes. Call again to continue where it stopped. */
  step(budget: number): StepResult;
  /** Total hashes since construction. */
  readonly total: number;
}

/**
 * A resumable solve.
 *
 * Resumable because the page must stay responsive: a solve at 18 bits is
 * hundreds of thousands of hashes, and the bench reports progress between
 * chunks. In the Worker that is only for the progress bar; on the main-thread
 * fallback it is what stops the tab from freezing.
 */
export function createSolver(options: SolverOptions): Solver {
  const digest = options.digest ?? sha256FirstWord;
  const encoder = new TextEncoder();
  const saltBytes = encoder.encode(options.salt);
  const playerBytes = encoder.encode(options.playerId);

  // salt ":" nonce ":" playerId — fixed length, built once.
  const buffer = new Uint8Array(saltBytes.length + 1 + NONCE_HEX_WIDTH + 1 + playerBytes.length);
  buffer.set(saltBytes, 0);
  buffer[saltBytes.length] = 0x3a;
  const nonceAt = saltBytes.length + 1;
  buffer[nonceAt + NONCE_HEX_WIDTH] = 0x3a;
  buffer.set(playerBytes, nonceAt + NONCE_HEX_WIDTH + 1);
  const length = buffer.length;

  let nonce = options.startNonce ?? 0;
  let total = 0;

  return {
    get total() {
      return total;
    },
    step(budget: number): StepResult {
      for (let done = 0; done < budget; done++) {
        const hex = formatNonce(nonce);
        for (let i = 0; i < NONCE_HEX_WIDTH; i++) buffer[nonceAt + i] = hex.charCodeAt(i);
        const bits = Math.clz32(digest(buffer, length));
        total++;
        nonce++;
        if (bits >= options.difficultyBits) return { hashes: done + 1, nonce: hex };
      }
      return { hashes: budget, nonce: null };
    },
  };
}

/* ------------------------------------------------------------ statistics -- */

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function hashesPerSecond(hashes: number, ms: number): number {
  if (!(ms > 0)) return 0;
  return (hashes / ms) * 1000;
}

export interface DifficultyResult {
  difficultyBits: number;
  /** Every hash performed at this difficulty, across all samples. */
  hashes: number;
  /** Wall-clock ms spent hashing at this difficulty. */
  ms: number;
  hashesPerSecond: number;
  /** Wall-clock ms of each completed solve. */
  samples: readonly number[];
  /** From the measured rate: what a player should typically wait. */
  projectedMedianMs: number;
  /** From the samples actually observed. Null when none completed. */
  observedMedianMs: number | null;
  /** True when the budget ran out mid-solve, so the last attempt is not a sample. */
  truncated: boolean;
}

export function summarizeDifficulty(input: {
  difficultyBits: number;
  hashes: number;
  ms: number;
  samples: readonly number[];
  truncated: boolean;
}): DifficultyResult {
  const rate = hashesPerSecond(input.hashes, input.ms);
  return {
    difficultyBits: input.difficultyBits,
    hashes: input.hashes,
    ms: input.ms,
    hashesPerSecond: rate,
    samples: input.samples,
    projectedMedianMs: medianSolveMs(input.difficultyBits, rate),
    observedMedianMs: median(input.samples),
    truncated: input.truncated,
  };
}

/* ---------------------------------------------------------------- tuning -- */

/** Item 5's window: under 3 s the work reads as fake, over 8 s it reads as broken. */
export const TARGET_WINDOW_MS = { low: 3_000, high: 8_000 } as const;

/** The backend clamps difficulty to this range (clvi-backend docs/STATE.md). */
export const BACKEND_CLAMP = { min: 12, max: 24 } as const;

export interface Recommendation {
  /** Every difficulty whose projected median lands inside the window. */
  fits: readonly number[];
  /** The one to use: the fit closest to the middle of the window, or null. */
  best: number | null;
  /** Projected median at `best`, for the record. */
  bestMedianMs: number | null;
  /** Why there is no recommendation, when there is none. */
  note: string;
}

/**
 * Which `difficultyBits` puts a solve inside item 5's 3-8 s window at this
 * device's measured rate. This is the bench's actual output — the hashes/sec
 * figure is only how it gets here.
 */
export function recommendDifficulty(
  hashesPerSec: number,
  window: { low: number; high: number } = TARGET_WINDOW_MS,
  clamp: { min: number; max: number } = BACKEND_CLAMP,
): Recommendation {
  if (!(hashesPerSec > 0)) {
    return { fits: [], best: null, bestMedianMs: null, note: "no rate measured" };
  }
  const fits: number[] = [];
  for (let bits = clamp.min; bits <= clamp.max; bits++) {
    const ms = medianSolveMs(bits, hashesPerSec);
    if (ms >= window.low && ms <= window.high) fits.push(bits);
  }
  if (fits.length === 0) {
    // Every step of difficulty doubles the work, so a 3-8 s window (a factor of
    // 2.67) can genuinely fall between two integers. Say so rather than rounding.
    const below = medianSolveMs(clamp.min, hashesPerSec);
    const above = medianSolveMs(clamp.max, hashesPerSec);
    const note =
      below > window.high
        ? `even ${clamp.min} bits takes ${(below / 1000).toFixed(1)} s here — too slow for the window`
        : above < window.low
          ? `even ${clamp.max} bits takes ${(above / 1000).toFixed(2)} s here — too fast for the window`
          : "the window falls between two integer difficulties on this device";
    return { fits: [], best: null, bestMedianMs: null, note };
  }
  const middle = Math.sqrt(window.low * window.high);
  let best = fits[0]!;
  for (const bits of fits) {
    if (Math.abs(Math.log(medianSolveMs(bits, hashesPerSec) / middle)) < Math.abs(Math.log(medianSolveMs(best, hashesPerSec) / middle))) {
      best = bits;
    }
  }
  return { fits, best, bestMedianMs: medianSolveMs(best, hashesPerSec), note: "" };
}

/* -------------------------------------------------------------- reporting -- */

export interface BenchReport {
  /** ISO timestamp of the run. */
  at: string;
  /** What the person typed: "iPhone 13 · iOS 18.2 · Safari". */
  device: string;
  /** The build stamp of the bench page itself. */
  buildTime: string;
  /** The digest implementation the rate was measured with. */
  engine: string;
  results: readonly DifficultyResult[];
  recommendation: Recommendation;
  /** Throughput of crypto.subtle.digest, for comparison. Null when not measured. */
  subtleHashesPerSecond: number | null;
}

function seconds(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms >= 10_000) return `${(ms / 1000).toFixed(0)} s`;
  if (ms >= 1_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

function rate(hashesPerSec: number): string {
  if (!(hashesPerSec > 0)) return "—";
  if (hashesPerSec >= 1_000_000) return `${(hashesPerSec / 1_000_000).toFixed(2)}M h/s`;
  return `${Math.round(hashesPerSec).toLocaleString("en-US")} h/s`;
}

export { rate as formatRate, seconds as formatDuration };

/**
 * The block a person pastes into docs/BENCH.md. It carries the device and the
 * date because a hash rate with neither is not a measurement, it is a rumour.
 */
export function formatBenchMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push(`### ${report.device.trim() === "" ? "UNRECORDED DEVICE" : report.device.trim()} · ${report.at}`);
  lines.push("");
  lines.push(`Engine: ${report.engine} · bench build ${report.buildTime}`);
  if (report.subtleHashesPerSecond !== null) {
    lines.push(`\`crypto.subtle.digest\` for comparison: ${rate(report.subtleHashesPerSecond)}`);
  }
  lines.push("");
  lines.push("| bits | hashes/sec | projected median | observed median | solves |");
  lines.push("| ---: | ---: | ---: | ---: | ---: |");
  for (const result of report.results) {
    const observed = result.observedMedianMs === null ? "—" : seconds(result.observedMedianMs);
    const count = `${result.samples.length}${result.truncated ? "+" : ""}`;
    lines.push(
      `| ${result.difficultyBits} | ${rate(result.hashesPerSecond)} | ${seconds(result.projectedMedianMs)} | ${observed} | ${count} |`,
    );
  }
  lines.push("");
  const { recommendation } = report;
  if (recommendation.best === null) {
    lines.push(`**No difficulty fits the 3-8 s window on this device** — ${recommendation.note}`);
  } else {
    lines.push(
      `**Recommended \`difficultyBits\`: ${recommendation.best}** (projected median ${seconds(recommendation.bestMedianMs ?? 0)}; ` +
        `${recommendation.fits.join(", ")} all fit the 3-8 s window)`,
    );
  }
  return lines.join("\n");
}

/* ---------------------------------------------------------------- runner -- */

export interface BenchConfig {
  difficulties: readonly number[];
  playerId: string;
  /** Wall-clock budget per difficulty. */
  budgetMsPerDifficulty: number;
  /** Stop a difficulty early once this many solves have completed. */
  maxSamples: number;
}

export interface BenchProgress {
  difficultyBits: number;
  hashes: number;
  ms: number;
  samples: number;
  /** 0-1, against this difficulty's time budget. */
  fraction: number;
}

export interface BenchHooks {
  now?: () => number;
  /** A fresh salt per solve, the way the backend issues one per challenge. */
  makeSalt?: () => string;
  digest?: WordDigest;
  onProgress?: (progress: BenchProgress) => void;
  /** Awaited between chunks. The Worker no-ops; the main thread yields. */
  breathe?: () => Promise<void> | void;
  /** Polled between chunks so the page can cancel a long run. */
  cancelled?: () => boolean;
  /** Hashes per chunk before the first timing measurement. */
  startingChunk?: number;
}

/** Chunks are sized to land near this, so progress is smooth and yields are cheap. */
const TARGET_CHUNK_MS = 40;

function defaultSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Runs the bench.
 *
 * Each sample gets a **fresh salt**, because that is what the backend issues —
 * one salt per challenge. Re-solving a single salt would find the same nonce
 * every time and report a variance of zero, which would look like a beautifully
 * precise measurement of nothing.
 */
export async function runBench(config: BenchConfig, hooks: BenchHooks = {}): Promise<DifficultyResult[]> {
  const now = hooks.now ?? (() => performance.now());
  const makeSalt = hooks.makeSalt ?? defaultSalt;
  const cancelled = hooks.cancelled ?? ((): boolean => false);
  const results: DifficultyResult[] = [];
  let chunk = hooks.startingChunk ?? 2_000;

  for (const difficultyBits of config.difficulties) {
    const deadline = now() + config.budgetMsPerDifficulty;
    const samples: number[] = [];
    let hashes = 0;
    let ms = 0;
    let truncated = false;

    while (now() < deadline && samples.length < config.maxSamples && !cancelled()) {
      const solverOptions: SolverOptions = {
        salt: makeSalt(),
        playerId: config.playerId,
        difficultyBits,
        startNonce: 0,
      };
      if (hooks.digest !== undefined) solverOptions.digest = hooks.digest;
      const solver = createSolver(solverOptions);

      const solveStart = now();
      let nonce: string | null = null;
      while (nonce === null) {
        const chunkStart = now();
        const step = solver.step(chunk);
        const chunkMs = now() - chunkStart;
        hashes += step.hashes;
        ms += chunkMs;
        nonce = step.nonce;

        // Re-aim the chunk at TARGET_CHUNK_MS now that we know the rate.
        //
        // Scale from `step.hashes`, NOT from `chunk`: a step that ends early on
        // a solve did less work than its budget allowed, and dividing the
        // budget by the shorter time inflates the next chunk by that ratio.
        // Left unfixed the chunk pins itself to the cap within a few solves,
        // and then a single chunk runs for seconds past the deadline — which
        // showed up as an 18-bit run collecting 4 samples where it should have
        // collected 10, with a wildly overstated observed median.
        if (chunkMs > 0 && step.hashes > 0) {
          const scaled = Math.round((step.hashes * TARGET_CHUNK_MS) / chunkMs);
          chunk = Math.max(256, Math.min(4_000_000, scaled));
        } else {
          chunk = Math.min(4_000_000, chunk * 2);
        }

        hooks.onProgress?.({
          difficultyBits,
          hashes,
          ms,
          samples: samples.length,
          fraction: Math.min(1, (config.budgetMsPerDifficulty - (deadline - now())) / config.budgetMsPerDifficulty),
        });

        if (nonce === null && (now() >= deadline || cancelled())) {
          // Out of time mid-solve. Its hashes count toward the rate — they were
          // really performed — but it is not a completed sample.
          truncated = true;
          break;
        }
        if (nonce === null) await hooks.breathe?.();
      }

      if (nonce !== null) samples.push(now() - solveStart);
      await hooks.breathe?.();
    }

    results.push(summarizeDifficulty({ difficultyBits, hashes, ms, samples, truncated }));
  }

  return results;
}
