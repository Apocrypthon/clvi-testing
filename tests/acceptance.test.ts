/**
 * The acceptance page's logic, tested without a DOM.
 *
 * These cover the parts that decide whether a run is *honest*: that a fail is
 * recorded as a fail, that a summary cannot read green while an item is
 * untested, and that corrupt localStorage degrades to a fresh run rather than a
 * blank screen on a phone you are halfway through a checklist with.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHECKLIST, CHECKLIST_IDS, itemById } from "../src/lib/checklist.ts";
import {
  MAX_RUNS,
  appendRun,
  createRun,
  formatRunSummary,
  parseRuns,
  removeRun,
} from "../src/lib/runs.ts";
import {
  emptyState,
  getItem,
  parseState,
  setNote,
  setResult,
  summarize,
  toggleFail,
  togglePass,
} from "../src/lib/state.ts";
import { KEYS, memoryStore, readKey, writeKey } from "../src/lib/storage.ts";
import {
  TARGETS,
  deepLink,
  defaultBase,
  isAssumedBase,
  loopUrl,
  normalizeBaseUrl,
  repoUrl,
  resolveBase,
  targetById,
} from "../src/lib/targets.ts";

const NOW = new Date("2026-09-03T08:00:00.000Z");

describe("checklist", () => {
  it("is exactly the seven items SEED.md milestone T1 lists", () => {
    assert.equal(CHECKLIST.length, 7);
    assert.deepEqual(
      CHECKLIST.map((item) => item.n),
      [1, 2, 3, 4, 5, 6, 7],
    );
  });

  it("carries SEED.md's criteria verbatim", () => {
    // If someone softens a criterion to match what the build does, this fails.
    assert.deepEqual(
      CHECKLIST.map((item) => item.criterion),
      [
        "loads < 3 s / viewport clean",
        "title pan ≥ 30 s smooth and cool",
        "targets ≥ 44 px, nothing hover-only",
        "pinch+pan Paradise without page rubber-band",
        "dig → solve 3–8 s → Holi burst → cell blooms",
        "settings shows GRD-id + est. kWh",
        "relaunch → save-init pan-down to last cell",
      ],
    );
  });

  it("gives every item a unique id, a how and a fail condition", () => {
    assert.equal(new Set(CHECKLIST_IDS).size, CHECKLIST.length, "ids must be unique");
    for (const item of CHECKLIST) {
      assert.ok(item.how.length > 0, `${item.id} needs steps`);
      assert.ok(item.fails.length > 0, `${item.id} needs a fail condition`);
      assert.doesNotThrow(() => targetById(item.target), `${item.id} points at an unknown target`);
    }
  });

  it("looks items up by id", () => {
    assert.equal(itemById("dig")?.n, 5);
    assert.equal(itemById("nope"), undefined);
  });
});

describe("run state", () => {
  it("starts every item untested", () => {
    const state = emptyState(NOW);
    assert.equal(state.startedAt, NOW.toISOString());
    const summary = summarize(state, CHECKLIST);
    assert.deepEqual(summary, { total: 7, pass: 0, fail: 0, untested: 7, complete: false, green: false });
  });

  it("toggles a pass on and back off without ever passing through fail", () => {
    let state = emptyState(NOW);
    state = togglePass(state, "dig");
    assert.equal(getItem(state, "dig").result, "pass");
    state = togglePass(state, "dig");
    assert.equal(getItem(state, "dig").result, "untested");
  });

  it("records a fail explicitly and lets it be taken back", () => {
    let state = toggleFail(emptyState(NOW), "map");
    assert.equal(getItem(state, "map").result, "fail");
    state = toggleFail(state, "map");
    assert.equal(getItem(state, "map").result, "untested");
  });

  it("lets a fail overwrite a pass and vice versa", () => {
    let state = togglePass(emptyState(NOW), "load");
    state = toggleFail(state, "load");
    assert.equal(getItem(state, "load").result, "fail");
    state = togglePass(state, "load");
    assert.equal(getItem(state, "load").result, "pass");
  });

  it("keeps notes across result changes", () => {
    let state = setNote(emptyState(NOW), "titlepan", "judder at ~22 s, iPhone 13");
    state = toggleFail(state, "titlepan");
    assert.equal(getItem(state, "titlepan").note, "judder at ~22 s, iPhone 13");
    assert.equal(getItem(state, "titlepan").result, "fail");
  });

  it("is not green until all seven pass", () => {
    let state = emptyState(NOW);
    for (const item of CHECKLIST) state = togglePass(state, item.id);
    assert.equal(summarize(state, CHECKLIST).green, true);

    state = toggleFail(state, "settings");
    const summary = summarize(state, CHECKLIST);
    assert.equal(summary.green, false, "one fail is not green");
    assert.equal(summary.complete, true, "but it is a complete run");
    assert.equal(summary.fail, 1);
    assert.equal(summary.pass, 6);
  });

  it("never reports green while an item is untested", () => {
    let state = emptyState(NOW);
    for (const item of CHECKLIST.slice(0, 6)) state = togglePass(state, item.id);
    const summary = summarize(state, CHECKLIST);
    assert.equal(summary.green, false);
    assert.equal(summary.complete, false);
    assert.equal(summary.untested, 1);
  });

  it("does not mutate the state it was given", () => {
    const state = emptyState(NOW);
    const next = togglePass(state, "dig");
    assert.equal(getItem(state, "dig").result, "untested", "the original must be untouched");
    assert.equal(getItem(next, "dig").result, "pass");
  });
});

describe("parseState", () => {
  it("round-trips through JSON", () => {
    const state = setNote(togglePass(emptyState(NOW), "dig"), "dig", "4.2 s");
    const restored = parseState(JSON.stringify(state), NOW);
    assert.deepEqual(restored, state);
  });

  it("falls back to a fresh run on garbage rather than throwing", () => {
    for (const garbage of ["", "{", "null", "[]", '"a string"', "42"]) {
      const state = parseState(garbage, NOW);
      assert.equal(summarize(state, CHECKLIST).untested, 7, `garbage ${JSON.stringify(garbage)}`);
    }
  });

  it("discards state written by an incompatible version", () => {
    const stale = { version: 0, startedAt: NOW.toISOString(), items: { dig: { result: "pass", note: "" } } };
    assert.equal(getItem(parseState(JSON.stringify(stale), NOW), "dig").result, "untested");
  });

  it("fills in an item added to the checklist since the run started", () => {
    const partial = { version: 1, startedAt: NOW.toISOString(), items: { dig: { result: "pass", note: "ok" } } };
    const state = parseState(JSON.stringify(partial), NOW);
    assert.equal(getItem(state, "dig").result, "pass", "the known item survives");
    assert.equal(getItem(state, "load").result, "untested", "the unseen item is untested, not missing");
  });

  it("drops an item no longer in the checklist", () => {
    const withGhost = {
      version: 1,
      startedAt: NOW.toISOString(),
      items: { dig: { result: "pass", note: "" }, "removed-item": { result: "pass", note: "" } },
    };
    const state = parseState(JSON.stringify(withGhost), NOW);
    assert.equal(Object.keys(state.items).length, 7);
    assert.equal("removed-item" in state.items, false);
  });

  it("sanitises an unknown result value", () => {
    const tampered = { version: 1, startedAt: NOW.toISOString(), items: { dig: { result: "PASS!", note: 7 } } };
    const item = getItem(parseState(JSON.stringify(tampered), NOW), "dig");
    assert.equal(item.result, "untested");
    assert.equal(item.note, "");
  });

  it("replaces an unparseable startedAt with now", () => {
    const bad = { version: 1, startedAt: "whenever", items: {} };
    assert.equal(parseState(JSON.stringify(bad), NOW).startedAt, NOW.toISOString());
  });
});

describe("runs history", () => {
  const finishedState = (): ReturnType<typeof emptyState> => {
    let state = emptyState(NOW);
    for (const item of CHECKLIST) state = togglePass(state, item.id);
    return setResult(toggleFail(state, "dig"), "dig", "fail");
  };

  const makeRun = (id: string, at: Date): ReturnType<typeof createRun> =>
    createRun({
      state: finishedState(),
      items: CHECKLIST,
      buildTime: "2026-09-03T07:50:00.000Z",
      base: "https://loop--clvi-gameclient.netlify.app",
      device: "iPhone 13 · iOS 18",
      now: at,
      id,
    });

  it("snapshots the whole run, item by item", () => {
    const run = makeRun("run-a", new Date("2026-09-03T08:30:00.000Z"));
    assert.equal(run.finishedAt, "2026-09-03T08:30:00.000Z");
    assert.equal(run.startedAt, NOW.toISOString());
    assert.equal(run.items.length, 7);
    assert.equal(run.summary.pass, 6);
    assert.equal(run.summary.fail, 1);
    assert.equal(run.summary.green, false);
    assert.equal(run.items.find((i) => i.id === "dig")?.result, "fail");
  });

  it("records which build and which deploy produced it", () => {
    const run = makeRun("run-a", NOW);
    assert.equal(run.buildTime, "2026-09-03T07:50:00.000Z");
    assert.equal(run.base, "https://loop--clvi-gameclient.netlify.app");
    assert.equal(run.device, "iPhone 13 · iOS 18");
  });

  it("keeps the newest first and caps the history", () => {
    let runs = [] as ReturnType<typeof appendRun>;
    for (let i = 0; i < MAX_RUNS + 5; i++) {
      runs = appendRun(runs, makeRun(`run-${i}`, new Date(NOW.getTime() + i * 1000)));
    }
    assert.equal(runs.length, MAX_RUNS);
    assert.equal(runs[0]?.id, `run-${MAX_RUNS + 4}`, "newest first");
    assert.equal(runs.at(-1)?.id, "run-5", "the oldest fell off, not the newest");
  });

  it("removes a single run by id", () => {
    const runs = appendRun(appendRun([], makeRun("a", NOW)), makeRun("b", NOW));
    assert.deepEqual(removeRun(runs, "a").map((r) => r.id), ["b"]);
    assert.equal(removeRun(runs, "missing").length, 2);
  });

  it("round-trips through JSON", () => {
    const runs = appendRun([], makeRun("run-a", NOW));
    assert.deepEqual(parseRuns(JSON.stringify(runs)), runs);
  });

  it("drops only the unreadable records, keeping the rest of the history", () => {
    const good = makeRun("run-a", NOW);
    const mixed = JSON.stringify([good, null, 42, { version: 9 }, { version: 1, id: "" }]);
    const parsed = parseRuns(mixed);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.id, "run-a");
  });

  it("returns an empty history for garbage", () => {
    for (const garbage of ["", "{}", "null", "not json"]) {
      assert.deepEqual(parseRuns(garbage), []);
    }
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 200 }, () => createRun({
      state: emptyState(NOW),
      items: CHECKLIST,
      buildTime: "b",
      base: "https://example.test",
      device: "",
      now: NOW,
    }).id));
    assert.equal(ids.size, 200);
  });

  it("summarises a run in one pasteable line", () => {
    const run = makeRun("run-a", new Date("2026-09-03T08:30:00.000Z"));
    assert.equal(formatRunSummary(run), "2026-09-03T08:30:00.000Z · 6/7 pass · 1 FAILED");

    let allPass = emptyState(NOW);
    for (const item of CHECKLIST) allPass = togglePass(allPass, item.id);
    const green = createRun({ state: allPass, items: CHECKLIST, buildTime: "b", base: "u", device: "", now: NOW, id: "g" });
    assert.equal(formatRunSummary(green), "2026-09-03T08:00:00.000Z · 7/7 pass · GREEN");

    const partial = createRun({
      state: togglePass(emptyState(NOW), "dig"),
      items: CHECKLIST, buildTime: "b", base: "u", device: "", now: NOW, id: "p",
    });
    assert.equal(formatRunSummary(partial), "2026-09-03T08:00:00.000Z · 1/7 pass, 6 untested · incomplete");
  });
});

describe("targets", () => {
  it("builds Netlify branch-deploy URLs", () => {
    assert.equal(loopUrl("clvi-gameclient"), "https://loop--clvi-gameclient.netlify.app");
    assert.equal(loopUrl("clvi-backend", "preview"), "https://preview--clvi-backend.netlify.app");
  });

  it("covers every sibling repo in the relay", () => {
    assert.deepEqual(
      TARGETS.map((t) => t.repo).sort(),
      ["clvi-architecture", "clvi-backend", "clvi-frontend", "clvi-gameclient", "clvi-infrastructure"],
    );
    for (const target of TARGETS) {
      assert.equal(repoUrl(target), `https://github.com/Apocrypthon/${target.repo}`);
      assert.match(target.envVar, /^STRATA_[A-Z]+_BASE$/);
    }
  });

  it("normalises a base URL a thumb typed", () => {
    assert.equal(normalizeBaseUrl("  loop--clvi-backend.netlify.app/ "), "https://loop--clvi-backend.netlify.app");
    assert.equal(normalizeBaseUrl("https://x.test///"), "https://x.test");
    assert.equal(normalizeBaseUrl("http://localhost:8888"), "http://localhost:8888");
    assert.equal(normalizeBaseUrl("localhost:8888"), "https://localhost:8888", "a bare host:port is not a scheme");
    assert.equal(normalizeBaseUrl("192.168.1.9:5173"), "https://192.168.1.9:5173");
    assert.equal(normalizeBaseUrl("https://x.test/api/v1/"), "https://x.test/api/v1", "a base may carry a path");
  });

  it("refuses input it cannot make a base URL from, rather than guessing", () => {
    for (const bad of ["", "   ", "://", "ftp://x.test", "http://"]) {
      assert.equal(normalizeBaseUrl(bad), null, JSON.stringify(bad));
    }
  });

  it("prefers an override and falls back to the convention", () => {
    const backend = targetById("backend");
    assert.equal(resolveBase(backend), defaultBase(backend));
    assert.equal(resolveBase(backend, { backend: "https://real.test/" }), "https://real.test");
    assert.equal(
      resolveBase(backend, { backend: "not a url" }),
      defaultBase(backend),
      "an unusable override falls back rather than producing a broken URL",
    );
  });

  it("marks a base that is still only a convention", () => {
    const backend = targetById("backend");
    assert.equal(isAssumedBase(backend), true);
    assert.equal(isAssumedBase(backend, { backend: "https://real.test" }), false);
  });

  it("deep-links each target at its own path", () => {
    assert.equal(deepLink(targetById("backend")), "https://loop--clvi-backend.netlify.app/health");
    assert.equal(deepLink(targetById("gameclient")), "https://loop--clvi-gameclient.netlify.app/");
    assert.equal(
      deepLink(targetById("gameclient"), { gameclient: "http://192.168.1.9:5173" }),
      "http://192.168.1.9:5173/",
      "a phone on the LAN can point at a laptop's dev server",
    );
  });
});

describe("storage", () => {
  it("reads back what it wrote", () => {
    const store = memoryStore();
    assert.equal(writeKey(store, KEYS.state, "x"), true);
    assert.equal(readKey(store, KEYS.state), "x");
    assert.equal(readKey(store, KEYS.runs), null);
  });

  it("reports a failed write instead of pretending it landed", () => {
    // Stands in for iOS Safari Private Browsing, which throws on setItem.
    const hostile = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      removeItem: () => {},
    };
    assert.equal(writeKey(hostile, KEYS.state, "x"), false);
  });

  it("survives a store that throws on read", () => {
    const hostile = {
      getItem: (): string => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    assert.equal(readKey(hostile, KEYS.state), null);
  });

  it("keeps its keys namespaced so a sibling page cannot collide", () => {
    for (const key of Object.values(KEYS)) {
      assert.match(key, /^strata\.acceptance\.v1\./);
    }
  });
});
