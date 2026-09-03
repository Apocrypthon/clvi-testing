/**
 * Contracts v1 shape validators. These run with no network, which is the point:
 * when a live smoke test fails, you want to already trust the ruler.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditReport,
  explain,
  isHex,
  isIsoTimestamp,
  rangeBoundKind,
  validateApiError,
  validateAuditReport,
  validateChallenge,
  validateHealth,
  validateMintInvariant,
  validateSubmission,
} from "../src/lib/contracts.ts";

const goodChallenge = {
  challengeId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  salt: "00112233445566778899aabbccddeeff",
  difficultyBits: 18,
  expiresAt: "2026-09-03T08:00:00.000Z",
};

const goodReport: AuditReport = {
  rangeStart: "2026-09-03T07:00:00.000Z",
  rangeEnd: "2026-09-03T08:00:00.000Z",
  entryCount: 3,
  totalEstKwh: 0.0042,
  chainOk: true,
  tokenCount: 3,
  signature: "a".repeat(64),
};

describe("primitives", () => {
  it("requires hex to be even-length and wide enough", () => {
    assert.equal(isHex("00ff", 2), true);
    assert.equal(isHex("00ff", 4), false, "too narrow");
    assert.equal(isHex("0f0", 1), false, "odd length");
    assert.equal(isHex("00zz", 2), false, "not hex");
    assert.equal(isHex(42, 1), false);
  });

  it("accepts real ISO instants and rejects near-misses", () => {
    assert.equal(isIsoTimestamp("2026-09-03T08:00:00.000Z"), true);
    assert.equal(isIsoTimestamp("2026-09-03T08:00:00Z"), true);
    assert.equal(isIsoTimestamp("2026-09-03"), false, "a date is not an instant");
    assert.equal(isIsoTimestamp("not a date at all!!"), false);
    assert.equal(isIsoTimestamp(1_756_886_400_000), false, "epoch ms is not an ISO string");
  });
});

describe("validateHealth", () => {
  it("accepts the documented shape", () => {
    const check = validateHealth({ ok: true, ts: "2026-09-03T08:00:00.000Z", version: "0.3.0" });
    assert.equal(check.ok, true, explain("health", check));
  });

  it("rejects ok:false — a degraded deploy is not a passing health check", () => {
    const check = validateHealth({ ok: false, ts: "2026-09-03T08:00:00.000Z", version: "0.3.0" });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(" "), /health\.ok/);
  });

  it("reports every problem at once, not just the first", () => {
    const check = validateHealth({ ok: "yes", ts: "soon", version: "" });
    assert.equal(check.ok, false);
    assert.equal(check.problems.length, 3, explain("health", check));
  });

  it("rejects a non-object body", () => {
    assert.equal(validateHealth("OK").ok, false);
    assert.equal(validateHealth(null).ok, false);
    assert.equal(validateHealth([]).ok, false);
  });
});

describe("validateChallenge", () => {
  it("accepts the documented shape", () => {
    const check = validateChallenge(goodChallenge);
    assert.equal(check.ok, true, explain("challenge", check));
  });

  it("holds the backend's [12, 24] difficulty clamp when asked to", () => {
    const tooEasy = { ...goodChallenge, difficultyBits: 4 };
    const check = validateChallenge(tooEasy, { minBits: 12, maxBits: 24 });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(" "), /outside expected \[12, 24\]/);
    assert.equal(validateChallenge(tooEasy).ok, true, "the clamp is opt-in; v1 itself does not pin it");
  });

  it("rejects a salt that is too short to be a salt", () => {
    const check = validateChallenge({ ...goodChallenge, salt: "00ff" });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(" "), /challenge\.salt/);
  });

  it("rejects a challenge that arrives already expired", () => {
    const now = Date.parse("2026-09-03T09:00:00.000Z");
    const check = validateChallenge(goodChallenge, { now });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(" "), /already in the past/);
  });

  it("says nothing about expiry when no clock is supplied", () => {
    assert.equal(validateChallenge(goodChallenge).ok, true);
  });

  it("rejects a fractional difficulty", () => {
    assert.equal(validateChallenge({ ...goodChallenge, difficultyBits: 18.5 }).ok, false);
  });
});

describe("validateSubmission", () => {
  const goodSubmission = {
    challengeId: goodChallenge.challengeId,
    playerId: "demo-player-1",
    cellId: "cell-42",
    artifactId: "can-tab",
    nonce: "2f",
    hashes: 181_704,
    ms: 3_400,
    deviceClass: "phone",
  };

  it("accepts the documented shape", () => {
    const check = validateSubmission(goodSubmission);
    assert.equal(check.ok, true, explain("submission", check));
  });

  it("names each missing field", () => {
    const check = validateSubmission({ ...goodSubmission, cellId: "", hashes: -1 });
    assert.equal(check.ok, false);
    assert.equal(check.problems.length, 2, explain("submission", check));
  });
});

describe("validateAuditReport", () => {
  it("accepts an ISO-bounded report", () => {
    const check = validateAuditReport(goodReport);
    assert.equal(check.ok, true, explain("auditReport", check));
  });

  it("also accepts a sequence-bounded report — v1 does not pin the unit", () => {
    const check = validateAuditReport({ ...goodReport, rangeStart: 1, rangeEnd: 97 });
    assert.equal(check.ok, true, explain("auditReport", check));
  });

  it("rejects a range that mixes units", () => {
    const check = validateAuditReport({ ...goodReport, rangeStart: 1 });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(" "), /must be expressed in one unit/);
  });

  it("classifies range bounds for the record", () => {
    assert.equal(rangeBoundKind("2026-09-03T08:00:00.000Z"), "iso");
    assert.equal(rangeBoundKind(97), "seq");
    assert.equal(rangeBoundKind(null), "invalid");
    assert.equal(rangeBoundKind(-1), "invalid");
  });

  it("rejects a signature too short to be a real one", () => {
    const check = validateAuditReport({ ...goodReport, signature: "abcd" });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(" "), /auditReport\.signature/);
  });

  it("rejects negative energy", () => {
    assert.equal(validateAuditReport({ ...goodReport, totalEstKwh: -0.1 }).ok, false);
  });

  it("rejects a stringly-typed chainOk — 'false' is truthy and that is the bug", () => {
    const check = validateAuditReport({ ...goodReport, chainOk: "false" });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(" "), /auditReport\.chainOk/);
  });

  it("tolerates extra fields such as generatedAt", () => {
    const check = validateAuditReport({ ...goodReport, generatedAt: "2026-09-03T08:00:01.000Z" });
    assert.equal(check.ok, true, explain("auditReport", check));
  });
});

describe("validateMintInvariant", () => {
  it("passes when one token was minted per entry", () => {
    assert.equal(validateMintInvariant(goodReport).ok, true);
  });

  it("fails when the counts diverge", () => {
    const check = validateMintInvariant({ ...goodReport, tokenCount: 2 });
    assert.equal(check.ok, false);
    assert.match(check.problems.join(" "), /entryCount 3 !== tokenCount 2/);
  });

  it("passes on an empty ledger", () => {
    assert.equal(validateMintInvariant({ ...goodReport, entryCount: 0, tokenCount: 0 }).ok, true);
  });
});

describe("validateApiError", () => {
  it("accepts the structured envelope", () => {
    assert.equal(validateApiError({ error: { code: "challenge_used", message: "already submitted" } }).ok, true);
  });

  it("accepts a code with no message", () => {
    assert.equal(validateApiError({ error: { code: "bad_request" } }).ok, true);
  });

  it("rejects a bare string body — an unstructured 4xx is a contract break", () => {
    assert.equal(validateApiError("Bad Request").ok, false);
    assert.equal(validateApiError({ error: "challenge_used" }).ok, false);
    assert.equal(validateApiError({ message: "nope" }).ok, false);
  });
});

describe("explain", () => {
  it("renders problems as an assertion message", () => {
    const message = explain("auditReport", validateAuditReport({ ...goodReport, signature: "" }));
    assert.match(message, /^auditReport:\n {2}- auditReport\.signature/);
  });

  it("says ok when there is nothing to say", () => {
    assert.equal(explain("health", validateHealth({ ok: true, ts: goodChallenge.expiresAt, version: "1" })), "health: ok");
  });
});
