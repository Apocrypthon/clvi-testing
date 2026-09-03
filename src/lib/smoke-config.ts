/**
 * How `node --test` decides what to point at, and what it is allowed to do.
 *
 * Defaults are the loop deploys (src/lib/targets.ts). Everything is overridable
 * from the environment so the same suite runs against a preview deploy, a
 * branch deploy, or `netlify dev` on a laptop without editing a file.
 *
 *   STRATA_BACKEND_BASE=https://…   which ledger to smoke (default: loop deploy)
 *   SMOKE_MINT=1                    allow the happy path to mint a real token
 *   SMOKE_SLOW=1                    allow the expired-challenge case to wait out a TTL
 *   SMOKE_PLAYER=…                  playerId to submit as (default: smoke-<host>)
 *   SMOKE_TIMEOUT_MS=…              per-request timeout (default 15000)
 *   SMOKE_MAX_BITS=…                refuse to solve above this difficulty (default 20)
 *   SMOKE_DEVICE_CLASS=…            deviceClass to submit (default "laptop")
 *   SMOKE_CELL_ID=…                 cellId to submit (default "cell-42")
 *   SMOKE_ARTIFACT_ID=…             artifactId to submit (default "can-tab")
 *
 * The mint guard exists because /submit writes to an append-only ledger. A test
 * suite that runs on every commit must not be able to grow the chain by
 * accident: the ledger is the product's evidence, and padding it with smoke
 * entries devalues exactly the thing this repo exists to protect.
 */
import { TARGETS, type Target, type TargetId, defaultBase, normalizeBaseUrl } from "./targets.ts";

export interface SmokeConfig {
  bases: Record<TargetId, string>;
  /** True when the base came from the environment rather than the convention. */
  configured: Record<TargetId, boolean>;
  mint: boolean;
  slow: boolean;
  playerId: string;
  timeoutMs: number;
  maxBits: number;
  /**
   * deviceClass drives the backend's energy estimate, so a smoke submission
   * that lies about it skews totalEstKwh in a ledger that cannot be edited.
   * "laptop" is the honest answer for a node test runner and matches the
   * backend's own documented walk-through.
   */
  deviceClass: string;
  cellId: string;
  artifactId: string;
}

export type Env = Record<string, string | undefined>;

function flag(env: Env, name: string): boolean {
  const value = env[name];
  return value === "1" || value?.toLowerCase() === "true";
}

function baseFor(env: Env, target: Target): { base: string; configured: boolean } {
  const raw = env[target.envVar];
  if (raw !== undefined && raw.trim() !== "") {
    const normalized = normalizeBaseUrl(raw);
    if (normalized === null) {
      throw new Error(`${target.envVar}=${JSON.stringify(raw)} is not a usable base URL`);
    }
    return { base: normalized, configured: true };
  }
  return { base: defaultBase(target), configured: false };
}

export function loadSmokeConfig(env: Env = process.env): SmokeConfig {
  const bases = {} as Record<TargetId, string>;
  const configured = {} as Record<TargetId, boolean>;
  for (const target of TARGETS) {
    const resolved = baseFor(env, target);
    bases[target.id] = resolved.base;
    configured[target.id] = resolved.configured;
  }

  const timeoutRaw = Number.parseInt(env["SMOKE_TIMEOUT_MS"] ?? "", 10);
  const bitsRaw = Number.parseInt(env["SMOKE_MAX_BITS"] ?? "", 10);

  return {
    bases,
    configured,
    mint: flag(env, "SMOKE_MINT"),
    slow: flag(env, "SMOKE_SLOW"),
    playerId: env["SMOKE_PLAYER"] ?? "smoke-clvi-testing",
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 15_000,
    // 20 bits is ~1M hashes: a couple of seconds in node. Above that a CI run
    // stops being a smoke test, so we refuse and say why rather than hang.
    maxBits: Number.isFinite(bitsRaw) && bitsRaw > 0 ? bitsRaw : 20,
    deviceClass: env["SMOKE_DEVICE_CLASS"] ?? "laptop",
    cellId: env["SMOKE_CELL_ID"] ?? "cell-42",
    artifactId: env["SMOKE_ARTIFACT_ID"] ?? "can-tab",
  };
}
