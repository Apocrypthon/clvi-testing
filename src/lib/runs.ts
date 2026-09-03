/**
 * The "runs" history: a timestamped snapshot of one acceptance pass, kept on the
 * phone so you can answer "did item 5 pass last Tuesday?" without a spreadsheet.
 *
 * A run is immutable once filed. Nothing here edits an existing record — a
 * history you can quietly amend is not evidence.
 */
import type { ChecklistItem } from "./checklist.ts";
import { type RunState, type Summary, getItem, summarize } from "./state.ts";

export const RUNS_VERSION = 1 as const;
/** Kept small on purpose: this lives in localStorage on a phone. */
export const MAX_RUNS = 40;

export interface RunItemRecord {
  id: string;
  n: number;
  title: string;
  result: "untested" | "pass" | "fail";
  note: string;
}

export interface RunRecord {
  version: 1;
  /** Stable id so a run can be referenced from docs or a CHANGELOG entry. */
  id: string;
  startedAt: string;
  finishedAt: string;
  /** The build stamp of the acceptance page itself, so a run names its tooling. */
  buildTime: string;
  /** The game-client base this run was pointed at. */
  base: string;
  /** Free text: which phone, which iOS, which hand. */
  device: string;
  summary: Summary;
  items: readonly RunItemRecord[];
}

export interface CreateRunOptions {
  state: RunState;
  items: readonly ChecklistItem[];
  buildTime: string;
  base: string;
  device: string;
  now?: Date;
  /** Injected so tests are deterministic; defaults to crypto.randomUUID. */
  id?: string;
}

export function createRun(options: CreateRunOptions): RunRecord {
  const now = options.now ?? new Date();
  const finishedAt = now.toISOString();
  return {
    version: RUNS_VERSION,
    id: options.id ?? newRunId(now),
    startedAt: options.state.startedAt,
    finishedAt,
    buildTime: options.buildTime,
    base: options.base,
    device: options.device,
    summary: summarize(options.state, options.items),
    items: options.items.map((item) => {
      const stored = getItem(options.state, item.id);
      return { id: item.id, n: item.n, title: item.title, result: stored.result, note: stored.note };
    }),
  };
}

export function newRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `run-${stamp}-${suffix}`;
}

/** Newest first, capped. The cap drops the oldest, never the newest. */
export function appendRun(runs: readonly RunRecord[], run: RunRecord, max: number = MAX_RUNS): RunRecord[] {
  return [run, ...runs].slice(0, max);
}

export function removeRun(runs: readonly RunRecord[], id: string): RunRecord[] {
  return runs.filter((run) => run.id !== id);
}

function isResult(value: unknown): value is RunItemRecord["result"] {
  return value === "untested" || value === "pass" || value === "fail";
}

function parseRun(value: unknown): RunRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record["version"] !== RUNS_VERSION) return null;
  const { id, startedAt, finishedAt, buildTime, base, device, summary, items } = record;
  if (typeof id !== "string" || id === "") return null;
  if (typeof finishedAt !== "string" || !Number.isFinite(Date.parse(finishedAt))) return null;
  if (!Array.isArray(items)) return null;
  if (typeof summary !== "object" || summary === null) return null;

  const parsedItems: RunItemRecord[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry["id"] !== "string" || !isResult(entry["result"])) continue;
    parsedItems.push({
      id: entry["id"],
      n: typeof entry["n"] === "number" ? entry["n"] : 0,
      title: typeof entry["title"] === "string" ? entry["title"] : entry["id"],
      result: entry["result"],
      note: typeof entry["note"] === "string" ? entry["note"] : "",
    });
  }

  const s = summary as Record<string, unknown>;
  const num = (key: string): number => (typeof s[key] === "number" ? (s[key] as number) : 0);
  return {
    version: RUNS_VERSION,
    id,
    startedAt: typeof startedAt === "string" ? startedAt : finishedAt,
    finishedAt,
    buildTime: typeof buildTime === "string" ? buildTime : "unknown",
    base: typeof base === "string" ? base : "unknown",
    device: typeof device === "string" ? device : "",
    summary: {
      total: num("total"),
      pass: num("pass"),
      fail: num("fail"),
      untested: num("untested"),
      complete: s["complete"] === true,
      green: s["green"] === true,
    },
    items: parsedItems,
  };
}

/** Drops unreadable records rather than the whole history. */
export function parseRuns(raw: unknown): RunRecord[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: RunRecord[] = [];
  for (const entry of value) {
    const parsed = parseRun(entry);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/** One line, for the history list and for pasting into docs/CHANGELOG.md. */
export function formatRunSummary(run: RunRecord): string {
  const { pass, fail, untested, total } = run.summary;
  const verdict = run.summary.green ? "GREEN" : fail > 0 ? `${fail} FAILED` : "incomplete";
  const skipped = untested > 0 ? `, ${untested} untested` : "";
  return `${run.finishedAt} · ${pass}/${total} pass${skipped} · ${verdict}`;
}
