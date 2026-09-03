/**
 * Node-only binding of the frozen solve rule to node:crypto.
 *
 * Kept out of `pow.ts` so the browser bundle never pulls a node builtin: Vite
 * would resolve it, then fail at runtime on the phone. Nothing under
 * `src/acceptance/` may import this file.
 */
import { createHash } from "node:crypto";
import { type Digest, type SolveResult, solve } from "./pow.ts";

export const sha256: Digest = (input) => new Uint8Array(createHash("sha256").update(input, "utf8").digest());

export interface NodeSolveOptions {
  salt: string;
  playerId: string;
  difficultyBits: number;
  maxHashes?: number;
  startNonce?: number;
}

export function solveWithNodeCrypto(options: NodeSolveOptions): SolveResult {
  return solve({
    salt: options.salt,
    playerId: options.playerId,
    difficultyBits: options.difficultyBits,
    digest: sha256,
    ...(options.maxHashes === undefined ? {} : { maxHashes: options.maxHashes }),
    ...(options.startNonce === undefined ? {} : { startNonce: options.startNonce }),
  });
}
