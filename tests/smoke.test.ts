/**
 * T2 — contract smoke against the live loop deploys.
 *
 * The rule this file obeys: **never imply a check passed.** A sibling that is
 * not deployed yet produces `# skipped` with the reason printed, not a green
 * tick. `docs/LOOP.md` calls that out because a testing repo that reports
 * success against nothing is worse than no testing repo.
 *
 * Nothing here mints without `SMOKE_MINT=1`. /submit appends to an append-only
 * ledger; a suite that can grow the chain on every commit devalues the evidence
 * this whole relay exists to produce.
 *
 *   npm test                                     # shape + negative cases only
 *   SMOKE_MINT=1 npm test                        # + the happy path, mints one token
 *   STRATA_BACKEND_BASE=https://… npm test       # against something other than loop--
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type AuditReport,
  explain,
  validateApiError,
  validateAuditReport,
  validateChallenge,
  validateHealth,
  validateMintInvariant,
  rangeBoundKind,
} from "../src/lib/contracts.ts";
import { type ApiResponse, describeResponse, isClientError, request } from "../src/lib/http.ts";
import { meetsDifficulty, preimage, toHex } from "../src/lib/pow.ts";
import { classifyPreflight, reachabilityLabel } from "../src/lib/preflight.ts";
import { loadSmokeConfig } from "../src/lib/smoke-config.ts";
import { sha256, solveWithNodeCrypto } from "../src/lib/solve.node.ts";
import { TARGETS, targetById } from "../src/lib/targets.ts";

const config = loadSmokeConfig();
const BACKEND = config.bases.backend;

/** Reachability, decided once, so every test skips with the same honest reason. */
async function preflight(): Promise<ReturnType<typeof classifyPreflight>> {
  const url = `${BACKEND}/health`;
  try {
    const response = await request(url, { timeoutMs: config.timeoutMs });
    return classifyPreflight({
      url,
      status: response.status,
      contentType: response.contentType,
      body: response.text,
    });
  } catch (error) {
    return classifyPreflight({ url, error });
  }
}

const status = await preflight();
const offline = status.live ? false : status.reason;

// A run always says what it looked at and what it decided, live or not. This is
// the "honestly reports which siblings aren't live yet" half of milestone T2.
console.log("\n── STRATA contract smoke ───────────────────────────────────");
for (const target of TARGETS) {
  const base = config.bases[target.id];
  const source = config.configured[target.id] ? "env" : "assumed";
  const marker = target.id === "backend" ? reachabilityLabel(status.kind) : "not probed";
  console.log(`  ${target.id.padEnd(15)} ${marker.padEnd(11)} ${base}  (${source})`);
}
console.log(`  mint: ${config.mint ? "ENABLED (SMOKE_MINT=1)" : "blocked (set SMOKE_MINT=1 to allow)"}`);
console.log(`  slow: ${config.slow ? "enabled (SMOKE_SLOW=1)" : "blocked (set SMOKE_SLOW=1 to allow)"}`);
if (!status.live) {
  console.log(`  SKIPPING every live check: ${status.reason}`);
  if (status.inconclusive) {
    console.log("  ^ INCONCLUSIVE: this run learned nothing about whether the deploy is up.");
    console.log("    Do not record a verdict in docs/STATE.md from this run.");
  }
}
console.log("────────────────────────────────────────────────────────────\n");

/** Only the backend's own docs pin this range; v1 leaves difficulty open. */
const MIN_BITS = 12;
const MAX_BITS = 24;

async function getChallenge(): Promise<{ response: ApiResponse; challenge: Record<string, unknown> }> {
  const response = await request(`${BACKEND}/challenge`, {
    method: "POST",
    body: { playerId: config.playerId },
    timeoutMs: config.timeoutMs,
  });
  assert.equal(response.status, 200, `POST /challenge\n${describeResponse(response)}`);
  const check = validateChallenge(response.json, { now: Date.now(), minBits: MIN_BITS, maxBits: MAX_BITS });
  assert.ok(check.ok, `${explain("challenge", check)}\n${describeResponse(response)}`);
  return { response, challenge: response.json as Record<string, unknown> };
}

function submissionBody(challenge: Record<string, unknown>, nonce: string, hashes: number, ms: number): Record<string, unknown> {
  return {
    challengeId: challenge["challengeId"],
    playerId: config.playerId,
    cellId: config.cellId,
    artifactId: config.artifactId,
    nonce,
    hashes,
    ms,
    deviceClass: config.deviceClass,
  };
}

function assertStructured4xx(response: ApiResponse, label: string): string {
  assert.ok(isClientError(response), `${label}: expected a 4xx, got\n${describeResponse(response)}`);
  const check = validateApiError(response.json);
  assert.ok(check.ok, `${label}: ${explain("error envelope", check)}\n${describeResponse(response)}`);
  return ((response.json as { error: { code: string } }).error.code);
}

describe("backend contract smoke", { skip: offline }, () => {
  describe("GET /health", () => {
    it("returns the documented shape", async () => {
      const response = await request(`${BACKEND}/health`, { timeoutMs: config.timeoutMs });
      assert.equal(response.status, 200, describeResponse(response));
      const check = validateHealth(response.json);
      assert.ok(check.ok, `${explain("health", check)}\n${describeResponse(response)}`);
    });

    it("answers fast enough that the phone will not notice it", async () => {
      const response = await request(`${BACKEND}/health`, { timeoutMs: config.timeoutMs });
      // Item 1 of the acceptance checklist gives the whole cold load 3 s. A
      // liveness probe that eats a second of that is a finding, not a nit.
      assert.ok(response.ms < 2_000, `GET /health took ${response.ms} ms; budget is 2000 ms`);
    });
  });

  describe("GET /audit/latest", () => {
    it("matches the AuditReport shape", async () => {
      const response = await request(`${BACKEND}/audit/latest`, { timeoutMs: config.timeoutMs });
      assert.equal(response.status, 200, describeResponse(response));
      const check = validateAuditReport(response.json);
      assert.ok(check.ok, `${explain("auditReport", check)}\n${describeResponse(response)}`);
      // Record which reading of the unpinned range type this deploy chose.
      console.log(`    audit range is expressed as: ${rangeBoundKind((response.json as AuditReport).rangeStart)}`);
    });

    it("holds the mint invariant: one token per verified find", async () => {
      const response = await request(`${BACKEND}/audit/latest`, { timeoutMs: config.timeoutMs });
      const shape = validateAuditReport(response.json);
      assert.ok(shape.ok, explain("auditReport", shape));
      const report = response.json as AuditReport;
      const check = validateMintInvariant(report);
      assert.ok(check.ok, `${explain("mint invariant", check)}\n${describeResponse(response)}`);
    });

    it("reports an unbroken chain", async () => {
      const response = await request(`${BACKEND}/audit/latest`, { timeoutMs: config.timeoutMs });
      const report = response.json as AuditReport;
      assert.equal(report.chainOk, true, `chainOk is not true — the ledger is broken\n${describeResponse(response)}`);
    });
  });

  describe("POST /verify", () => {
    it("round-trips the report it just published", async () => {
      const fetched = await request(`${BACKEND}/audit/latest`, { timeoutMs: config.timeoutMs });
      const shape = validateAuditReport(fetched.json);
      assert.ok(shape.ok, explain("auditReport", shape));

      const verified = await request(`${BACKEND}/verify`, {
        method: "POST",
        body: fetched.json,
        timeoutMs: config.timeoutMs,
      });
      assert.equal(verified.status, 200, describeResponse(verified));
      assert.equal(
        (verified.json as { valid?: unknown }).valid,
        true,
        `a freshly fetched report must verify against its own signature\n${describeResponse(verified)}`,
      );
    });

    it("refuses a report whose numbers were edited", async () => {
      const fetched = await request(`${BACKEND}/audit/latest`, { timeoutMs: config.timeoutMs });
      const report = { ...(fetched.json as AuditReport), totalEstKwh: 0 };

      const verified = await request(`${BACKEND}/verify`, {
        method: "POST",
        body: report,
        timeoutMs: config.timeoutMs,
      });
      // A tampered report is a well-formed request with a false answer, not an
      // error: 200 {valid:false}. A 5xx here means the verifier crashed on
      // hostile input, which is the more serious finding of the two.
      assert.ok(verified.status < 500, `verify crashed on a tampered report\n${describeResponse(verified)}`);
      if (verified.status === 200) {
        assert.equal(
          (verified.json as { valid?: unknown }).valid,
          false,
          `an edited totalEstKwh must not verify\n${describeResponse(verified)}`,
        );
      } else {
        assertStructured4xx(verified, "verify(tampered)");
      }
    });

    it("refuses a report whose signature was swapped", async () => {
      const fetched = await request(`${BACKEND}/audit/latest`, { timeoutMs: config.timeoutMs });
      const original = fetched.json as AuditReport;
      const flipped = original.signature.startsWith("0") ? `1${original.signature.slice(1)}` : `0${original.signature.slice(1)}`;

      const verified = await request(`${BACKEND}/verify`, {
        method: "POST",
        body: { ...original, signature: flipped },
        timeoutMs: config.timeoutMs,
      });
      assert.ok(verified.status < 500, `verify crashed on a bad signature\n${describeResponse(verified)}`);
      if (verified.status === 200) {
        assert.equal((verified.json as { valid?: unknown }).valid, false, describeResponse(verified));
      } else {
        assertStructured4xx(verified, "verify(bad signature)");
      }
    });
  });

  describe("POST /challenge", () => {
    it("issues a challenge in the documented shape, unexpired", async () => {
      const { challenge } = await getChallenge();
      const ttlMs = Date.parse(String(challenge["expiresAt"])) - Date.now();
      assert.ok(ttlMs > 0, `challenge expired before it arrived (ttl ${ttlMs} ms)`);
      console.log(`    difficultyBits=${String(challenge["difficultyBits"])} ttl=${Math.round(ttlMs / 1000)}s`);
    });

    it("issues a distinct salt and id each time — a reused salt is pre-computable", async () => {
      const [a, b] = await Promise.all([getChallenge(), getChallenge()]);
      assert.notEqual(a.challenge["challengeId"], b.challenge["challengeId"], "challengeId must be unique");
      assert.notEqual(a.challenge["salt"], b.challenge["salt"], "salt must be unique per challenge");
    });

    it("rejects a request with no playerId, with a structured 4xx", async () => {
      const response = await request(`${BACKEND}/challenge`, {
        method: "POST",
        body: {},
        timeoutMs: config.timeoutMs,
      });
      const code = assertStructured4xx(response, "challenge(no playerId)");
      console.log(`    error code: ${code}`);
    });
  });

  describe("POST /submit — negative cases", () => {
    // None of these mint: every one is expected to be rejected. If one of them
    // ever succeeds, that is the bug, and the ledger entry it wrote is the proof.

    it("rejects a nonce that does not clear the difficulty", async () => {
      const { challenge } = await getChallenge();
      const salt = String(challenge["salt"]);
      const bits = Number(challenge["difficultyBits"]);

      // Find a nonce that provably fails, so the test cannot accidentally submit
      // a valid solve and mint a token.
      let nonce = "";
      for (let i = 0; i < 1000; i++) {
        const candidate = `bad-${i}`;
        if (!meetsDifficulty(sha256(preimage(salt, candidate, config.playerId)), bits)) {
          nonce = candidate;
          break;
        }
      }
      assert.notEqual(nonce, "", "could not construct a failing nonce");

      const response = await request(`${BACKEND}/submit`, {
        method: "POST",
        body: submissionBody(challenge, nonce, 1, 1),
        timeoutMs: config.timeoutMs,
      });
      const code = assertStructured4xx(response, "submit(bad nonce)");
      console.log(`    error code: ${code}`);
    });

    it("rejects a challengeId that was never issued", async () => {
      const { challenge } = await getChallenge();
      const response = await request(`${BACKEND}/submit`, {
        method: "POST",
        body: { ...submissionBody(challenge, "0", 1, 1), challengeId: "00000000-0000-4000-8000-000000000000" },
        timeoutMs: config.timeoutMs,
      });
      const code = assertStructured4xx(response, "submit(unknown challenge)");
      console.log(`    error code: ${code}`);
    });

    it("rejects a body with fields missing", async () => {
      const response = await request(`${BACKEND}/submit`, {
        method: "POST",
        body: { playerId: config.playerId },
        timeoutMs: config.timeoutMs,
      });
      const code = assertStructured4xx(response, "submit(incomplete body)");
      console.log(`    error code: ${code}`);
    });

    it("rejects a body that is not JSON at all", async () => {
      const response = await request(`${BACKEND}/submit`, {
        method: "POST",
        body: "this is not json",
        headers: { "content-type": "application/json" },
        timeoutMs: config.timeoutMs,
      });
      assert.ok(isClientError(response), `expected a 4xx for malformed JSON, got\n${describeResponse(response)}`);
    });
  });

  describe("POST /submit — happy path", () => {
    // Guarded: this is the only test in the file that writes to the ledger.
    const mintSkip = config.mint ? false : "SMOKE_MINT is not set; refusing to mint a token into the append-only ledger";

    it("solves a challenge and mints exactly one token", { skip: mintSkip }, async () => {
      const { challenge } = await getChallenge();
      const bits = Number(challenge["difficultyBits"]);
      assert.ok(
        bits <= config.maxBits,
        `difficultyBits ${bits} exceeds SMOKE_MAX_BITS ${config.maxBits}; raise it deliberately rather than hanging CI`,
      );

      const before = await request(`${BACKEND}/audit/latest`, { timeoutMs: config.timeoutMs });
      const beforeReport = before.json as AuditReport;

      const solved = solveWithNodeCrypto({
        salt: String(challenge["salt"]),
        playerId: config.playerId,
        difficultyBits: bits,
      });
      // Never submit a solve we have not verified ourselves.
      assert.ok(
        meetsDifficulty(sha256(preimage(String(challenge["salt"]), solved.nonce, config.playerId)), bits),
        "local solve does not satisfy the rule it was solved against",
      );

      const body = submissionBody(challenge, solved.nonce, solved.hashes, solved.ms);
      const response = await request(`${BACKEND}/submit`, { method: "POST", body, timeoutMs: config.timeoutMs });
      assert.equal(response.status, 200, `POST /submit\n${describeResponse(response)}`);

      const result = response.json as Record<string, unknown>;
      assert.equal(typeof result["tokenId"], "string", `submit must return a tokenId\n${describeResponse(response)}`);
      assert.equal(typeof result["estKwh"], "number", `submit must return estKwh\n${describeResponse(response)}`);
      console.log(`    minted ${String(result["tokenId"])} · ${String(result["estKwh"])} kWh · ${solved.hashes} hashes in ${solved.ms} ms`);

      // The audit must have grown by exactly one entry and one token.
      const after = await request(`${BACKEND}/audit/latest`, { timeoutMs: config.timeoutMs });
      const afterReport = after.json as AuditReport;
      const check = validateMintInvariant(afterReport);
      assert.ok(check.ok, `${explain("mint invariant", check)}\n${describeResponse(after)}`);
      assert.equal(
        afterReport.entryCount - beforeReport.entryCount,
        1,
        `one submit must add exactly one entry (was ${beforeReport.entryCount}, now ${afterReport.entryCount})`,
      );

      // …and the same challenge must not work a second time.
      const replay = await request(`${BACKEND}/submit`, { method: "POST", body, timeoutMs: config.timeoutMs });
      const code = assertStructured4xx(replay, "submit(replayed challenge)");
      assert.match(code, /use|replay|spent|dup/i, `replay was rejected as "${code}"; expected a reuse-specific code`);
      console.log(`    replay rejected as: ${code}`);
    });
  });

  describe("POST /submit — expired challenge", () => {
    // Guarded separately: the only honest way to test expiry is to wait for it,
    // and a suite that sleeps for a TTL is not a smoke test. It solves *first*
    // so the submission is valid in every respect except its age — that is what
    // isolates the expiry check. If expiry is broken this mints, which is
    // precisely the finding, and why it needs its own opt-in.
    const slowSkip = config.slow
      ? false
      : "SMOKE_SLOW is not set; the expiry case must wait out a challenge TTL";

    it("rejects a solve submitted after expiresAt", { skip: slowSkip }, async () => {
      const { challenge } = await getChallenge();
      const bits = Number(challenge["difficultyBits"]);
      assert.ok(bits <= config.maxBits, `difficultyBits ${bits} exceeds SMOKE_MAX_BITS ${config.maxBits}`);

      const expiresAt = Date.parse(String(challenge["expiresAt"]));
      const waitMs = expiresAt - Date.now() + 2_000;
      const budgetMs = 180_000;
      assert.ok(
        waitMs <= budgetMs,
        `challenge TTL is ${Math.round(waitMs / 1000)}s, over the ${budgetMs / 1000}s budget; test expiry against a shorter-TTL deploy`,
      );

      const solved = solveWithNodeCrypto({ salt: String(challenge["salt"]), playerId: config.playerId, difficultyBits: bits });
      console.log(`    solved in ${solved.ms} ms; waiting ${Math.round(waitMs / 1000)}s for expiry`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitMs)));

      const response = await request(`${BACKEND}/submit`, {
        method: "POST",
        body: submissionBody(challenge, solved.nonce, solved.hashes, solved.ms),
        timeoutMs: config.timeoutMs,
      });
      const code = assertStructured4xx(response, "submit(expired challenge)");
      assert.match(code, /expire|stale|timeout/i, `expired challenge was rejected as "${code}"; expected an expiry-specific code`);
      console.log(`    error code: ${code}`);
    });
  });
});

describe("smoke harness", () => {
  // These run whether or not anything is deployed: they are what makes the
  // skip messages above trustworthy.
  it("defaults every base to that repo's loop branch deploy", () => {
    const fresh = loadSmokeConfig({});
    assert.equal(fresh.bases.backend, "https://loop--clvi-backend.netlify.app");
    assert.equal(fresh.bases.gameclient, "https://loop--clvi-gameclient.netlify.app");
    assert.equal(fresh.configured.backend, false);
  });

  it("takes an override from the target's env var", () => {
    const fresh = loadSmokeConfig({ STRATA_BACKEND_BASE: "https://staging.test/" });
    assert.equal(fresh.bases.backend, "https://staging.test");
    assert.equal(fresh.configured.backend, true);
    assert.equal(fresh.configured.gameclient, false);
  });

  it("refuses an unusable base rather than smoking the wrong host", () => {
    assert.throws(() => loadSmokeConfig({ STRATA_BACKEND_BASE: "not a url" }), /not a usable base URL/);
  });

  it("blocks minting unless it is asked for explicitly", () => {
    assert.equal(loadSmokeConfig({}).mint, false);
    assert.equal(loadSmokeConfig({ SMOKE_MINT: "0" }).mint, false);
    assert.equal(loadSmokeConfig({ SMOKE_MINT: "" }).mint, false);
    assert.equal(loadSmokeConfig({ SMOKE_MINT: "1" }).mint, true);
    assert.equal(loadSmokeConfig({ SMOKE_MINT: "true" }).mint, true);
  });

  it("falls back to sane numbers when the env is nonsense", () => {
    const fresh = loadSmokeConfig({ SMOKE_TIMEOUT_MS: "soon", SMOKE_MAX_BITS: "-4" });
    assert.equal(fresh.timeoutMs, 15_000);
    assert.equal(fresh.maxBits, 20);
  });

  it("submits an honest deviceClass by default", () => {
    // The ledger's kWh total is computed from this; a lie here is unfixable.
    assert.equal(loadSmokeConfig({}).deviceClass, "laptop");
    assert.equal(loadSmokeConfig({ SMOKE_DEVICE_CLASS: "phone" }).deviceClass, "phone");
  });

  it("calls a 200 live", () => {
    const verdict = classifyPreflight({ url: "https://x.test/health", status: 200, contentType: "application/json" });
    assert.equal(verdict.kind, "live");
    assert.equal(verdict.live, true);
    assert.equal(verdict.inconclusive, false);
  });

  it("calls a non-JSON 403 a blocked host, not a dead deploy", () => {
    // The exact case this sandbox hits: Netlify resolves every *--<site> name,
    // and the egress proxy answers 403. Recording that as "down" would put a
    // claim in STATE.md that nobody verified.
    const verdict = classifyPreflight({ url: "https://x.test/health", status: 403, contentType: "text/plain" });
    assert.equal(verdict.kind, "blocked");
    assert.equal(verdict.inconclusive, true, "a blocked host teaches us nothing about the deploy");
    assert.match(verdict.reason, /egress proxy/);
  });

  it("still trusts a JSON 403 — that is the app refusing us", () => {
    const verdict = classifyPreflight({ url: "https://x.test/health", status: 403, contentType: "application/json" });
    assert.equal(verdict.kind, "unhealthy");
    assert.equal(verdict.inconclusive, false);
  });

  it("separates a missing route from a missing site", () => {
    assert.equal(classifyPreflight({ url: "u", status: 404 }).kind, "route-missing");
    assert.equal(classifyPreflight({ url: "u", status: 503 }).kind, "unhealthy");
  });

  it("calls a DNS failure a real absence and a tunnel failure inconclusive", () => {
    const dns = classifyPreflight({ url: "u", error: new Error("getaddrinfo ENOTFOUND x.test") });
    assert.equal(dns.kind, "unreachable");
    assert.equal(dns.inconclusive, false, "DNS not resolving really does mean not deployed");

    const tunnel = classifyPreflight({ url: "u", error: new Error("CONNECT tunnel failed, response 403") });
    assert.equal(tunnel.kind, "blocked");
    assert.equal(tunnel.inconclusive, true);
  });

  it("labels every reachability kind", () => {
    for (const kind of ["live", "unhealthy", "route-missing", "blocked", "unreachable"] as const) {
      assert.match(reachabilityLabel(kind), /^[A-Z ]+$/);
    }
  });

  it("knows the backend target it is pointed at", () => {
    assert.equal(targetById("backend").envVar, "STRATA_BACKEND_BASE");
    assert.equal(toHex(sha256("")).length, 64, "the digest used for local solves is sha256");
  });
});
