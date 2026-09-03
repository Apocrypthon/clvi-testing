/**
 * The acceptance run's state, as pure data.
 *
 * Every transition here is a function from state to state so `node --test` can
 * cover the parts that decide whether a run is honest — the tri-state result,
 * the summary counts, and the tolerance for whatever a previous build of this
 * page left in localStorage. The DOM layer in src/acceptance/ only renders these.
 */
import { CHECKLIST_IDS, type ChecklistItem } from "./checklist.ts";

/**
 * Three states, not two. A checkbox can say "I checked it and it worked" and
 * "I have not checked it", but an acceptance run's most valuable output is
 * "I checked it and it did NOT work" — a two-state control loses exactly that.
 */
export type ItemResult = "untested" | "pass" | "fail";

export interface ItemState {
  result: ItemResult;
  note: string;
}

export interface RunState {
  /** Schema tag; a bump discards incompatible stored state instead of guessing. */
  version: 1;
  startedAt: string;
  items: Record<string, ItemState>;
}

export const STATE_VERSION = 1 as const;

const EMPTY_ITEM: ItemState = { result: "untested", note: "" };

export function emptyState(now: Date = new Date(), ids: readonly string[] = CHECKLIST_IDS): RunState {
  const items: Record<string, ItemState> = {};
  for (const id of ids) items[id] = { ...EMPTY_ITEM };
  return { version: STATE_VERSION, startedAt: now.toISOString(), items };
}

export function getItem(state: RunState, id: string): ItemState {
  return state.items[id] ?? { ...EMPTY_ITEM };
}

export function setResult(state: RunState, id: string, result: ItemResult): RunState {
  return { ...state, items: { ...state.items, [id]: { ...getItem(state, id), result } } };
}

/**
 * Row tap. Deliberately a two-way toggle between untested and pass rather than a
 * three-way cycle: a cycle means one extra tap silently downgrades a pass to a
 * fail, and on a phone mid-run you will not notice. Failing is an explicit act —
 * see `toggleFail`.
 */
export function togglePass(state: RunState, id: string): RunState {
  return setResult(state, id, getItem(state, id).result === "pass" ? "untested" : "pass");
}

export function toggleFail(state: RunState, id: string): RunState {
  return setResult(state, id, getItem(state, id).result === "fail" ? "untested" : "fail");
}

export function setNote(state: RunState, id: string, note: string): RunState {
  return { ...state, items: { ...state.items, [id]: { ...getItem(state, id), note } } };
}

export interface Summary {
  total: number;
  pass: number;
  fail: number;
  untested: number;
  /** Every item has a verdict. */
  complete: boolean;
  /** Every item passed. Only this is a green acceptance run. */
  green: boolean;
}

export function summarize(state: RunState, items: readonly ChecklistItem[]): Summary {
  let pass = 0;
  let fail = 0;
  for (const item of items) {
    const result = getItem(state, item.id).result;
    if (result === "pass") pass++;
    else if (result === "fail") fail++;
  }
  const total = items.length;
  const untested = total - pass - fail;
  return { total, pass, fail, untested, complete: untested === 0, green: pass === total && total > 0 };
}

function isItemResult(value: unknown): value is ItemResult {
  return value === "untested" || value === "pass" || value === "fail";
}

/**
 * Reads whatever localStorage held. Anything unrecognised becomes a fresh state
 * rather than an exception: a phone mid-run must never be shown a blank screen
 * because a key was edited or a previous build wrote a different shape.
 *
 * Items missing from the stored blob are filled in as untested, and items no
 * longer in the checklist are dropped — so adding an eighth item to SEED.md does
 * not invalidate a run in progress.
 */
export function parseState(raw: unknown, now: Date = new Date(), ids: readonly string[] = CHECKLIST_IDS): RunState {
  const fresh = emptyState(now, ids);
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return fresh;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fresh;
  const record = value as Record<string, unknown>;
  if (record["version"] !== STATE_VERSION) return fresh;

  const startedAt = record["startedAt"];
  const storedItems = record["items"];
  const items: Record<string, ItemState> = {};
  for (const id of ids) {
    const stored = typeof storedItems === "object" && storedItems !== null ? (storedItems as Record<string, unknown>)[id] : undefined;
    if (typeof stored !== "object" || stored === null) {
      items[id] = { ...EMPTY_ITEM };
      continue;
    }
    const entry = stored as Record<string, unknown>;
    items[id] = {
      result: isItemResult(entry["result"]) ? entry["result"] : "untested",
      note: typeof entry["note"] === "string" ? entry["note"] : "",
    };
  }
  return {
    version: STATE_VERSION,
    startedAt: typeof startedAt === "string" && Number.isFinite(Date.parse(startedAt)) ? startedAt : fresh.startedAt,
    items,
  };
}
