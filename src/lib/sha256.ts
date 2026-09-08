/**
 * SHA-256, synchronous, in plain TypeScript.
 *
 * WHY THIS EXISTS, given that every browser ships `crypto.subtle.digest`:
 * `subtle.digest` is async. A solve at difficultyBits 18 needs ~182k hashes at
 * the median, and awaiting a promise per hash costs far more than the hash does.
 * Measured on a desktop-class machine while building T3:
 *
 *   node:crypto createHash (sync)   ~206,000 h/s   →  0.9 s median at 18 bits
 *   subtle.digest, awaited serially  ~16,000 h/s   → 11.3 s median at 18 bits
 *   subtle.digest, batched by 500    ~27,000 h/s   →  6.8 s median at 18 bits
 *
 * Item 5 of the acceptance checklist requires a solve in 3-8 s, on a phone.
 * A promise per hash cannot get there. So the client hashes synchronously, and
 * this is the implementation the bench measures. `bench.html` still measures
 * `subtle.digest` alongside it, so the claim above stays a number rather than a
 * piece of folklore. See docs/BENCH.md.
 *
 * Correctness is pinned two ways in tests/sha256.test.ts: the NIST vectors, and
 * a differential run against node:crypto over random inputs and every length
 * around the block and padding boundaries.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INIT = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/**
 * Scratch reused across calls. The solve loop runs this hundreds of thousands
 * of times, and allocating a message schedule per call dominates what we are
 * trying to measure. Single-threaded by construction — each Worker gets its own
 * module instance — so there is no reentrancy to worry about, but nothing here
 * may yield.
 */
const W = new Uint32Array(64);
const STATE = new Uint32Array(8);
let block = new Uint8Array(64);
let blockView = new DataView(block.buffer);

/**
 * Writes the message plus SHA-256 padding into `block`; returns byte length.
 *
 * `length` lets a caller hash a prefix of a longer reusable buffer. The solve
 * loop uses that to hash out of one preallocated preimage buffer without
 * allocating a subarray view per iteration — at half a million iterations,
 * those views are a measurable part of what the bench would otherwise be
 * "measuring".
 */
function pad(message: Uint8Array, length: number): number {
  const total = ((length + 9 + 63) >> 6) << 6;
  if (block.length < total) {
    block = new Uint8Array(total);
    blockView = new DataView(block.buffer);
  }
  block.fill(0, 0, total);
  if (length === message.length) block.set(message);
  else block.set(message.subarray(0, length));
  block[length] = 0x80;
  // 64-bit big-endian bit length. The high word only matters above 512 MB.
  blockView.setUint32(total - 8, Math.floor(length / 0x20000000), false);
  blockView.setUint32(total - 4, (length << 3) >>> 0, false);
  return total;
}

/** Compresses `block[0..total)` into STATE. */
function compress(total: number): void {
  STATE.set(INIT);
  let s0 = STATE[0]!, s1 = STATE[1]!, s2 = STATE[2]!, s3 = STATE[3]!;
  let s4 = STATE[4]!, s5 = STATE[5]!, s6 = STATE[6]!, s7 = STATE[7]!;

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      W[i] = ((block[j]! << 24) | (block[j + 1]! << 16) | (block[j + 2]! << 8) | block[j + 3]!) | 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15]!;
      const y = W[i - 2]!;
      const sig0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const sig1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16]! + sig0 + W[i - 7]! + sig1) | 0;
    }

    let a = s0, b = s1, c = s2, d = s3, e = s4, f = s5, g = s6, hh = s7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + W[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }

    s0 = (s0 + a) | 0; s1 = (s1 + b) | 0; s2 = (s2 + c) | 0; s3 = (s3 + d) | 0;
    s4 = (s4 + e) | 0; s5 = (s5 + f) | 0; s6 = (s6 + g) | 0; s7 = (s7 + hh) | 0;
  }

  STATE[0] = s0; STATE[1] = s1; STATE[2] = s2; STATE[3] = s3;
  STATE[4] = s4; STATE[5] = s5; STATE[6] = s6; STATE[7] = s7;
}

/** The full 32-byte digest. */
export function sha256(message: Uint8Array, length: number = message.length): Uint8Array {
  compress(pad(message, length));
  const out = new Uint8Array(32);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) view.setUint32(i * 4, STATE[i]! >>> 0, false);
  return out;
}

/**
 * The digest's first 32 bits, unsigned, with no output allocation.
 *
 * This is the solve loop's hot path: `Math.clz32` of this word is the digest's
 * leading zero bit count for any difficulty up to 32, which covers the
 * backend's [12, 24] clamp with room to spare. A digest whose first word is 0
 * reports 32, which still correctly satisfies every difficulty in that range.
 */
export function sha256FirstWord(message: Uint8Array, length: number = message.length): number {
  compress(pad(message, length));
  return STATE[0]! >>> 0;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
