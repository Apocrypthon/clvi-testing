/**
 * The frozen solve rule, Contracts v1:
 *
 *   sha256(salt + ":" + nonce + ":" + playerId) leading zero bits >= difficultyBits
 *
 * This module is pure and hash-free on purpose: the bit counting and the
 * preimage construction are identical on the phone (WebCrypto, milestone T3's
 * bench) and in `node --test` (node:crypto, milestone T2's smoke). Only the
 * digest function differs, so only the digest function is injected.
 */

export const PREIMAGE_SEPARATOR = ":";

export function preimage(salt: string, nonce: string, playerId: string): string {
  return `${salt}${PREIMAGE_SEPARATOR}${nonce}${PREIMAGE_SEPARATOR}${playerId}`;
}

/**
 * Leading zero *bits* — not nibbles, not bytes. Counting nibbles is the classic
 * way to get this wrong and to silently accept a solve that is 2x too easy, so
 * tests/pow.test.ts pins the boundaries.
 */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    // Math.clz32 counts on 32 bits; a byte's leading zeros are the last 8 of them.
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function meetsDifficulty(digest: Uint8Array, difficultyBits: number): boolean {
  return leadingZeroBits(digest) >= difficultyBits;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`fromHex: odd-length input (${hex.length})`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`fromHex: non-hex input at offset ${i * 2}`);
    out[i] = byte;
  }
  return out;
}

/**
 * Expected hashes for a solve is 2^bits; the distribution is geometric, so the
 * *median* is what a player feels, not the mean. T3's bench reports median.
 */
export function expectedHashes(difficultyBits: number): number {
  return 2 ** difficultyBits;
}

export function medianHashes(difficultyBits: number): number {
  return Math.LN2 * 2 ** difficultyBits;
}

/** Projected median solve time in ms at a measured rate. Used by T3's bench. */
export function medianSolveMs(difficultyBits: number, hashesPerSecond: number): number {
  if (!(hashesPerSecond > 0)) return Number.POSITIVE_INFINITY;
  return (medianHashes(difficultyBits) / hashesPerSecond) * 1000;
}

export interface SolveResult {
  nonce: string;
  hashes: number;
  ms: number;
  digest: string;
}

export type Digest = (input: string) => Uint8Array;

export interface SolveOptions {
  salt: string;
  playerId: string;
  difficultyBits: number;
  digest: Digest;
  /** Stop rather than spin forever; the caller decides what "too long" means. */
  maxHashes?: number;
  now?: () => number;
  /** First nonce to try. Defaults to 0; tests pin a start for determinism. */
  startNonce?: number;
}

/**
 * Walks nonces until the digest clears `difficultyBits`. Returns the same shape
 * the backend's own `scripts/solve.mjs` prints, so a submission body can be
 * assembled straight from it.
 */
export function solve(options: SolveOptions): SolveResult {
  const { salt, playerId, difficultyBits, digest } = options;
  const maxHashes = options.maxHashes ?? 64 * 2 ** 20;
  const now = options.now ?? (() => Date.now());
  const started = now();

  let nonce = options.startNonce ?? 0;
  for (let hashes = 1; hashes <= maxHashes; hashes++, nonce++) {
    const candidate = nonce.toString(16);
    const out = digest(preimage(salt, candidate, playerId));
    if (meetsDifficulty(out, difficultyBits)) {
      return { nonce: candidate, hashes, ms: Math.max(0, Math.round(now() - started)), digest: toHex(out) };
    }
  }
  throw new Error(
    `solve: gave up after ${maxHashes} hashes at ${difficultyBits} bits (expected ~${Math.round(expectedHashes(difficultyBits))})`,
  );
}
