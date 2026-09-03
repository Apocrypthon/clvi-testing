/**
 * Contracts v1 — frozen in SEED.md, changed only via clvi-architecture.
 *
 *   Challenge   { challengeId, salt, difficultyBits, expiresAt }
 *   Submission  { challengeId, playerId, cellId, artifactId, nonce, hashes, ms, deviceClass }
 *   AuditReport { rangeStart, rangeEnd, entryCount, totalEstKwh, chainOk, tokenCount, signature }
 *
 * These validators are deliberately *structural*, not nominal: they check the
 * shape a live deploy actually returned, and they report every problem they
 * find rather than the first. A smoke failure should tell you which field drifted
 * without a second round-trip to the phone.
 *
 * Unknown extra fields are allowed. The backend already returns `generatedAt` on
 * AuditReport, and a v1 consumer must not break when a sibling adds a field.
 */

export interface Challenge {
  challengeId: string;
  salt: string;
  difficultyBits: number;
  expiresAt: string;
}

export interface Submission {
  challengeId: string;
  playerId: string;
  cellId: string;
  artifactId: string;
  nonce: string;
  hashes: number;
  ms: number;
  deviceClass: string;
}

/**
 * `rangeStart` / `rangeEnd` are not pinned to a type by Contracts v1. The backend
 * addresses ranges as ISO timestamps (`GET /audit/<from>.<to>`) but its own
 * example report prints them elided, so both an ISO string and a ledger sequence
 * number are defensible readings. We accept either and record which one the
 * deploy used — see docs/STATE.md#open-questions.
 */
export type RangeBound = string | number;

export interface AuditReport {
  rangeStart: RangeBound;
  rangeEnd: RangeBound;
  entryCount: number;
  totalEstKwh: number;
  chainOk: boolean;
  tokenCount: number;
  signature: string;
}

export interface Health {
  ok: boolean;
  ts: string;
  version: string;
}

/** The structured error envelope every write path returns with a 4xx. */
export interface ApiError {
  error: { code: string; message?: string };
}

export type Check =
  | { readonly ok: true; readonly problems: readonly [] }
  | { readonly ok: false; readonly problems: readonly string[] };

const PASS: Check = { ok: true, problems: [] };

function verdict(problems: string[]): Check {
  return problems.length === 0 ? PASS : { ok: false, problems };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Even-length lowercase-or-uppercase hex, at least `minBytes` bytes wide. */
export function isHex(value: unknown, minBytes = 1): value is string {
  return (
    typeof value === "string" &&
    value.length >= minBytes * 2 &&
    value.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(value)
  );
}

/** An ISO-8601 instant that `Date` can parse back to the same point in time. */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isRangeBound(value: unknown): value is RangeBound {
  return isIsoTimestamp(value) || isCount(value);
}

/** Describes how a deploy chose to express a range bound, for the record. */
export function rangeBoundKind(value: unknown): "iso" | "seq" | "invalid" {
  if (isIsoTimestamp(value)) return "iso";
  if (isCount(value)) return "seq";
  return "invalid";
}

export function validateHealth(value: unknown): Check {
  if (!isRecord(value)) return { ok: false, problems: ["health: not a JSON object"] };
  const problems: string[] = [];
  if (value["ok"] !== true) problems.push(`health.ok: expected true, got ${JSON.stringify(value["ok"])}`);
  if (!isIsoTimestamp(value["ts"])) problems.push(`health.ts: expected ISO timestamp, got ${JSON.stringify(value["ts"])}`);
  if (!isNonEmptyString(value["version"])) problems.push(`health.version: expected non-empty string, got ${JSON.stringify(value["version"])}`);
  return verdict(problems);
}

export interface ChallengeOptions {
  /** Reject a challenge that has already expired relative to this instant. */
  now?: number;
  /** The backend clamps difficulty to [12, 24]; widen only with a reason. */
  minBits?: number;
  maxBits?: number;
}

export function validateChallenge(value: unknown, options: ChallengeOptions = {}): Check {
  if (!isRecord(value)) return { ok: false, problems: ["challenge: not a JSON object"] };
  const minBits = options.minBits ?? 1;
  const maxBits = options.maxBits ?? 32;
  const problems: string[] = [];

  if (!isNonEmptyString(value["challengeId"])) {
    problems.push(`challenge.challengeId: expected non-empty string, got ${JSON.stringify(value["challengeId"])}`);
  }
  if (!isHex(value["salt"], 8)) {
    problems.push(`challenge.salt: expected >=8 bytes of hex, got ${JSON.stringify(value["salt"])}`);
  }
  const bits = value["difficultyBits"];
  if (!isCount(bits)) {
    problems.push(`challenge.difficultyBits: expected non-negative integer, got ${JSON.stringify(bits)}`);
  } else if (bits < minBits || bits > maxBits) {
    problems.push(`challenge.difficultyBits: ${bits} outside expected [${minBits}, ${maxBits}]`);
  }
  if (!isIsoTimestamp(value["expiresAt"])) {
    problems.push(`challenge.expiresAt: expected ISO timestamp, got ${JSON.stringify(value["expiresAt"])}`);
  } else if (options.now !== undefined && Date.parse(value["expiresAt"] as string) <= options.now) {
    problems.push(`challenge.expiresAt: ${String(value["expiresAt"])} is already in the past`);
  }
  return verdict(problems);
}

export function validateSubmission(value: unknown): Check {
  if (!isRecord(value)) return { ok: false, problems: ["submission: not a JSON object"] };
  const problems: string[] = [];
  for (const field of ["challengeId", "playerId", "cellId", "artifactId", "nonce", "deviceClass"] as const) {
    if (!isNonEmptyString(value[field])) {
      problems.push(`submission.${field}: expected non-empty string, got ${JSON.stringify(value[field])}`);
    }
  }
  for (const field of ["hashes", "ms"] as const) {
    if (!isCount(value[field])) {
      problems.push(`submission.${field}: expected non-negative integer, got ${JSON.stringify(value[field])}`);
    }
  }
  return verdict(problems);
}

export function validateAuditReport(value: unknown): Check {
  if (!isRecord(value)) return { ok: false, problems: ["auditReport: not a JSON object"] };
  const problems: string[] = [];

  for (const field of ["rangeStart", "rangeEnd"] as const) {
    if (!isRangeBound(value[field])) {
      problems.push(`auditReport.${field}: expected ISO timestamp or sequence integer, got ${JSON.stringify(value[field])}`);
    }
  }
  if (rangeBoundKind(value["rangeStart"]) !== rangeBoundKind(value["rangeEnd"])) {
    problems.push(
      `auditReport: rangeStart is ${rangeBoundKind(value["rangeStart"])} but rangeEnd is ${rangeBoundKind(value["rangeEnd"])}; a range must be expressed in one unit`,
    );
  }
  if (!isCount(value["entryCount"])) {
    problems.push(`auditReport.entryCount: expected non-negative integer, got ${JSON.stringify(value["entryCount"])}`);
  }
  if (!isCount(value["tokenCount"])) {
    problems.push(`auditReport.tokenCount: expected non-negative integer, got ${JSON.stringify(value["tokenCount"])}`);
  }
  if (!isFiniteNumber(value["totalEstKwh"]) || (value["totalEstKwh"] as number) < 0) {
    problems.push(`auditReport.totalEstKwh: expected non-negative finite number, got ${JSON.stringify(value["totalEstKwh"])}`);
  }
  if (typeof value["chainOk"] !== "boolean") {
    problems.push(`auditReport.chainOk: expected boolean, got ${JSON.stringify(value["chainOk"])}`);
  }
  if (!isHex(value["signature"], 32)) {
    problems.push(`auditReport.signature: expected >=32 bytes of hex, got ${JSON.stringify(value["signature"])}`);
  }
  return verdict(problems);
}

/**
 * The mint invariant: one Guardian token per verified find. An audit whose
 * counts disagree is the single most important thing this repo can catch, so it
 * is checked separately from the shape — a report can be perfectly shaped and
 * still be wrong.
 */
export function validateMintInvariant(report: AuditReport): Check {
  if (report.entryCount !== report.tokenCount) {
    return {
      ok: false,
      problems: [`mint invariant: entryCount ${report.entryCount} !== tokenCount ${report.tokenCount}`],
    };
  }
  return PASS;
}

export function validateApiError(value: unknown): Check {
  if (!isRecord(value)) return { ok: false, problems: ["error: not a JSON object"] };
  const error = value["error"];
  if (!isRecord(error)) {
    return { ok: false, problems: [`error.error: expected an object, got ${JSON.stringify(error)}`] };
  }
  const problems: string[] = [];
  if (!isNonEmptyString(error["code"])) {
    problems.push(`error.error.code: expected non-empty string, got ${JSON.stringify(error["code"])}`);
  }
  if (error["message"] !== undefined && typeof error["message"] !== "string") {
    problems.push(`error.error.message: expected string when present, got ${JSON.stringify(error["message"])}`);
  }
  return verdict(problems);
}

/** Renders a failed Check as one assertion message. */
export function explain(label: string, check: Check): string {
  return check.ok ? `${label}: ok` : `${label}:\n  - ${check.problems.join("\n  - ")}`;
}
