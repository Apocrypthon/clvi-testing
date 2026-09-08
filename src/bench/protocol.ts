/** Messages between the bench page and its Worker. Types only — erased at build. */
import type { BenchConfig, BenchProgress, DifficultyResult } from "../lib/bench.ts";

export type WorkerRequest = { kind: "run"; config: BenchConfig } | { kind: "cancel" };

export type WorkerMessage =
  | { kind: "progress"; progress: BenchProgress }
  | { kind: "done"; results: DifficultyResult[]; subtleHashesPerSecond: number | null }
  | { kind: "error"; message: string };
