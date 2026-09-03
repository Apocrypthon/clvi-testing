/**
 * The frozen solve rule. If any of these drift, a client and the ledger will
 * disagree about what a valid solve is, and the disagreement will look like a
 * flaky backend rather than a contract break.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expectedHashes,
  fromHex,
  leadingZeroBits,
  medianHashes,
  medianSolveMs,
  meetsDifficulty,
  preimage,
  solve,
  toHex,
} from "../src/lib/pow.ts";
import { sha256, solveWithNodeCrypto } from "../src/lib/solve.node.ts";

describe("preimage", () => {
  it("is salt : nonce : playerId, in that order", () => {
    assert.equal(preimage("deadbeef", "2f", "demo-player-1"), "deadbeef:2f:demo-player-1");
  });

  it("matches a hand-computed sha256 vector", () => {
    // Independently computed: sha256("deadbeefdeadbeef:2f:demo-player-1").
    assert.equal(
      toHex(sha256(preimage("deadbeefdeadbeef", "2f", "demo-player-1"))),
      "7cb8cbc1badc28973c73ceb9b80524a7ae2f9f1be67480d35bfad3a4ddda78e2",
    );
  });

  it("pins the digest function itself against a NIST vector", () => {
    assert.equal(toHex(sha256("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("leadingZeroBits", () => {
  // Bits, not nibbles and not bytes. Counting nibbles accepts solves that are
  // 2x too easy and the mistake is invisible in a passing test suite.
  const cases: ReadonlyArray<readonly [string, number]> = [
    ["ff", 0],
    ["80", 0],
    ["7f", 1],
    ["40", 1],
    ["3f", 2],
    ["20", 2],
    ["1f", 3],
    ["10", 3],
    ["08", 4],
    ["04", 5],
    ["02", 6],
    ["01", 7],
    ["0080", 8],
    ["0040", 9],
    ["0001", 15],
    ["0000ff", 16],
    ["000000", 24],
  ];

  for (const [hex, bits] of cases) {
    it(`counts ${bits} leading zero bits in 0x${hex}`, () => {
      assert.equal(leadingZeroBits(fromHex(hex)), bits);
    });
  }

  it("counts an all-zero digest as the full width", () => {
    assert.equal(leadingZeroBits(new Uint8Array(32)), 256);
  });

  it("counts an empty digest as zero rather than throwing", () => {
    assert.equal(leadingZeroBits(new Uint8Array(0)), 0);
  });
});

describe("meetsDifficulty", () => {
  it("accepts exactly the required bits and rejects one short", () => {
    const digest = fromHex("0f".padEnd(64, "0")); // 4 leading zero bits
    assert.equal(leadingZeroBits(digest), 4);
    assert.equal(meetsDifficulty(digest, 4), true, "4 bits must satisfy a 4-bit requirement");
    assert.equal(meetsDifficulty(digest, 5), false, "4 bits must not satisfy a 5-bit requirement");
  });

  it("treats zero bits as satisfied by anything", () => {
    assert.equal(meetsDifficulty(fromHex("ff"), 0), true);
  });
});

describe("hex helpers", () => {
  it("round-trips", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 127, 128, 255]);
    assert.equal(toHex(bytes), "00010f107f80ff");
    assert.deepEqual(fromHex(toHex(bytes)), bytes);
  });

  it("rejects malformed hex instead of returning silent zeros", () => {
    assert.throws(() => fromHex("abc"), /odd-length/);
    assert.throws(() => fromHex("zz"), /non-hex/);
  });
});

describe("solve", () => {
  it("returns the first nonce whose digest clears the bar", () => {
    // A fake digest that only clears 4 bits at nonce 0x3 ("3").
    const digest = (input: string): Uint8Array =>
      input.endsWith(":3:p") ? fromHex("0f".padEnd(64, "0")) : fromHex("ff".padEnd(64, "0"));
    const result = solve({ salt: "s", playerId: "p", difficultyBits: 4, digest });
    assert.equal(result.nonce, "3");
    assert.equal(result.hashes, 4, "nonces 0,1,2,3 is four hashes");
    assert.equal(result.digest, "0f".padEnd(64, "0"));
  });

  it("gives up loudly rather than spinning forever", () => {
    const digest = (): Uint8Array => fromHex("ff".padEnd(64, "0"));
    assert.throws(
      () => solve({ salt: "s", playerId: "p", difficultyBits: 8, digest, maxHashes: 10 }),
      /gave up after 10 hashes at 8 bits/,
    );
  });

  it("really solves under node:crypto and the result verifies", () => {
    const salt = "00112233445566778899aabbccddeeff";
    const playerId = "demo-player-1";
    const difficultyBits = 12;
    const result = solveWithNodeCrypto({ salt, playerId, difficultyBits });

    // Verify the way the backend does: recompute, do not trust the reported digest.
    const recomputed = sha256(preimage(salt, result.nonce, playerId));
    assert.equal(toHex(recomputed), result.digest, "reported digest must match a recomputation");
    assert.ok(meetsDifficulty(recomputed, difficultyBits), `digest ${result.digest} must clear ${difficultyBits} bits`);
    assert.ok(result.hashes >= 1);
    assert.ok(result.ms >= 0);
  });
});

describe("difficulty projections", () => {
  it("expects 2^bits hashes and a shorter median", () => {
    assert.equal(expectedHashes(18), 262_144);
    // Geometric distribution: the median is ln2 of the mean, ~69%.
    assert.ok(medianHashes(18) < expectedHashes(18));
    assert.equal(Math.round(medianHashes(18)), 181_704);
  });

  it("projects the solve time the bench will report", () => {
    // 500k hashes/sec at 18 bits lands inside the 3-8 s window item 5 asks for.
    const ms = medianSolveMs(18, 500_000);
    assert.ok(ms > 300 && ms < 500, `expected ~363 ms, got ${ms}`);
  });

  it("returns Infinity rather than dividing by zero", () => {
    assert.equal(medianSolveMs(18, 0), Number.POSITIVE_INFINITY);
  });
});
