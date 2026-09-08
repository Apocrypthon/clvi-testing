/**
 * The hand-written SHA-256 that the bench and the client's solve loop run on.
 *
 * A wrong hash here would not look like a bug. It would look like a puzzle that
 * is mysteriously harder or easier than the backend thinks, and it would be
 * found — if at all — as "the ledger rejects our solves". So this is pinned two
 * ways: the published vectors, and a differential run against node:crypto that
 * sweeps every length around each padding boundary.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { sha256, sha256FirstWord, toHex } from "../src/lib/sha256.ts";

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const reference = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("sha256 — published vectors", () => {
  const vectors: ReadonlyArray<readonly [string, string]> = [
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    ],
    [
      "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    ],
  ];

  for (const [input, expected] of vectors) {
    it(`hashes ${JSON.stringify(input.slice(0, 24))}${input.length > 24 ? "…" : ""} (${input.length} bytes)`, () => {
      assert.equal(toHex(sha256(utf8(input))), expected);
    });
  }

  it("hashes a million 'a's", () => {
    assert.equal(
      toHex(sha256(new Uint8Array(1_000_000).fill(0x61))),
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });
});

describe("sha256 — differential against node:crypto", () => {
  it("agrees at every length across the padding boundaries", () => {
    // 55/56 is where the length field stops fitting in the first block, and
    // 63/64/65 is the block edge. Off-by-one padding bugs live exactly here and
    // nowhere else.
    for (let length = 0; length <= 200; length++) {
      const message = randomBytes(length);
      assert.equal(toHex(sha256(message)), reference(message), `length ${length}`);
    }
  });

  it("agrees on random inputs up to several blocks", () => {
    for (let i = 0; i < 250; i++) {
      const message = randomBytes(1 + Math.floor(Math.random() * 1000));
      assert.equal(toHex(sha256(message)), reference(message), `iteration ${i}, length ${message.length}`);
    }
  });

  it("agrees on the preimages the solve rule actually builds", () => {
    const salt = "00112233445566778899aabbccddeeff";
    for (let nonce = 0; nonce < 300; nonce++) {
      const message = utf8(`${salt}:${nonce.toString(16)}:demo-player-1`);
      assert.equal(toHex(sha256(message)), reference(message), `nonce ${nonce}`);
    }
  });

  it("handles a multi-byte UTF-8 playerId", () => {
    const message = utf8("00ff:2f:pilóto-ñandú-プレイヤー");
    assert.equal(toHex(sha256(message)), reference(message));
  });
});

describe("scratch reuse", () => {
  // The module keeps one growable buffer so the hot loop does not allocate.
  // A long message grows it; the next short message must not read the tail of
  // the previous one.
  it("does not leak a long message into the next short one", () => {
    const long = randomBytes(500);
    const short = utf8("abc");
    sha256(long);
    assert.equal(toHex(sha256(short)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    sha256(long);
    assert.equal(toHex(sha256(new Uint8Array(0))), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("is stable when called repeatedly with the same input", () => {
    const message = utf8("abc");
    const first = toHex(sha256(message));
    for (let i = 0; i < 50; i++) assert.equal(toHex(sha256(message)), first);
  });

  it("does not mutate the caller's input", () => {
    const message = utf8("abc");
    const copy = Uint8Array.from(message);
    sha256(message);
    assert.deepEqual(message, copy);
  });
});

describe("sha256FirstWord", () => {
  it("is the first four bytes of the digest, unsigned", () => {
    for (let i = 0; i < 200; i++) {
      const message = randomBytes(1 + Math.floor(Math.random() * 120));
      const digest = sha256(message);
      const expected = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0;
      assert.equal(sha256FirstWord(message), expected, `length ${message.length}`);
    }
  });

  it("is always unsigned, even when the top bit is set", () => {
    // A signed read here would make clz32 report 0 leading zeros correctly by
    // luck, but break every comparison. Pin it.
    for (let i = 0; i < 500; i++) {
      assert.ok(sha256FirstWord(randomBytes(16)) >= 0);
    }
  });

  it("gives the leading zero bit count the solve rule needs", () => {
    // Find a preimage with at least 8 leading zero bits and check both paths agree.
    const salt = "abcdef01";
    let found = false;
    for (let nonce = 0; nonce < 20000 && !found; nonce++) {
      const message = utf8(`${salt}:${nonce.toString(16)}:p`);
      const bits = Math.clz32(sha256FirstWord(message));
      if (bits >= 8) {
        const digest = sha256(message);
        assert.equal(digest[0], 0, "8 leading zero bits means a zero first byte");
        found = true;
      }
    }
    assert.ok(found, "expected to find an 8-bit solve within 20000 nonces");
  });
});
