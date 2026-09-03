/**
 * localStorage, but survivable.
 *
 * iOS Safari throws on `setItem` in Private Browsing and when the origin's quota
 * is full, and it can throw on *reading* `window.localStorage` at all under some
 * privacy settings. The acceptance page must degrade to an in-memory run rather
 * than white-screen: losing the history is annoying, losing the run you are
 * halfway through on a phone is worse.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function memoryStore(seed: Record<string, string> = {}): KeyValueStore {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** True when writes are actually landing; the UI says so rather than pretending. */
export interface Persistence {
  store: KeyValueStore;
  durable: boolean;
  reason: string;
}

export function openStore(): Persistence {
  let candidate: Storage | undefined;
  try {
    candidate = globalThis.localStorage;
  } catch (error) {
    return { store: memoryStore(), durable: false, reason: describe(error) };
  }
  if (!candidate) {
    return { store: memoryStore(), durable: false, reason: "no localStorage in this context" };
  }
  const probe = "__strata_probe__";
  try {
    candidate.setItem(probe, "1");
    candidate.removeItem(probe);
  } catch (error) {
    // Private Browsing, or a full quota. Keep whatever is readable, write to RAM.
    return { store: memoryStore(readable(candidate)), durable: false, reason: describe(error) };
  }
  return { store: candidate, durable: true, reason: "" };
}

function readable(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null) continue;
      const value = storage.getItem(key);
      if (value !== null) out[key] = value;
    }
  } catch {
    // Reading failed too; an empty seed is the honest answer.
  }
  return out;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export const KEYS = {
  state: "strata.acceptance.v1.state",
  runs: "strata.acceptance.v1.runs",
  bases: "strata.acceptance.v1.bases",
  device: "strata.acceptance.v1.device",
} as const;

/** Reads a key, returning null on any failure. */
export function readKey(store: KeyValueStore, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/** Writes a key; returns false when the write did not land. */
export function writeKey(store: KeyValueStore, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function dropKey(store: KeyValueStore, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // Nothing useful to do; the caller's in-memory state is already correct.
  }
}
