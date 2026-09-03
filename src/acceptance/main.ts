/**
 * T1 — the seven-item iPhone acceptance checklist.
 *
 * Everything this page knows is in localStorage on the phone it runs on, and
 * nothing leaves the device. The interesting decisions live in src/lib/ where
 * `node --test` can reach them; this file is wiring and rendering.
 *
 * Two rendering rules, both learned from using it:
 *   - Marking an item updates that item in place. A full re-render would snap
 *     every open "How to check" shut under your thumb mid-run.
 *   - Typing never re-renders. It persists on `input` and nothing else, so the
 *     caret stays where you put it.
 */
import { CHECKLIST, type ChecklistItem } from "../lib/checklist.ts";
import { appendRun, createRun, parseRuns, removeRun, type RunRecord } from "../lib/runs.ts";
import { getItem, parseState, setNote, summarize, toggleFail, togglePass, type RunState } from "../lib/state.ts";
import { KEYS, dropKey, openStore, readKey, writeKey } from "../lib/storage.ts";
import {
  TARGETS,
  type BaseOverrides,
  deepLink,
  defaultBase,
  isAssumedBase,
  normalizeBaseUrl,
  repoUrl,
  targetById,
} from "../lib/targets.ts";
import { clear, h, must, on } from "./dom.ts";

const BUILD_TIME = __BUILD_TIME__;

const persistence = openStore();
const store = persistence.store;

let current: RunState = parseState(readKey(store, KEYS.state));
let history: RunRecord[] = parseRuns(readKey(store, KEYS.runs));
let bases: BaseOverrides = parseBases(readKey(store, KEYS.bases));
let device = readKey(store, KEYS.device) ?? "";
/** Set when a write was refused — Private Browsing, or a full quota. */
let writeFailed = false;

function parseBases(raw: string | null): BaseOverrides {
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: BaseOverrides = {};
  for (const target of TARGETS) {
    const entry = (value as Record<string, unknown>)[target.id];
    if (typeof entry === "string" && normalizeBaseUrl(entry) !== null) out[target.id] = entry;
  }
  return out;
}

function persist(key: string, value: string): void {
  if (!writeKey(store, key, value)) {
    writeFailed = true;
    renderNotice();
  }
}

const persistState = (): void => persist(KEYS.state, JSON.stringify(current));
const persistHistory = (): void => persist(KEYS.runs, JSON.stringify(history));
const persistBases = (): void => persist(KEYS.bases, JSON.stringify(bases));

/* ---------------------------------------------------------------- header -- */

const stampEl = must<HTMLElement>("stamp");
const countEl = must<HTMLElement>("count");
const verdictEl = must<HTMLElement>("verdict");
const barEl = must<HTMLElement>("bar");
const noticeEl = must<HTMLElement>("notice");

stampEl.textContent = `build ${BUILD_TIME}`;

function renderHeader(): void {
  const summary = summarize(current, CHECKLIST);
  countEl.textContent = `${summary.pass}/${summary.total}`;

  const verdict = summary.green ? "green" : summary.fail > 0 ? "failed" : summary.pass === 0 ? "none" : "incomplete";
  verdictEl.dataset["verdict"] = verdict === "none" ? "incomplete" : verdict;
  verdictEl.textContent =
    verdict === "green"
      ? "green"
      : verdict === "failed"
        ? `${summary.fail} failed`
        : verdict === "none"
          ? "not started"
          : `${summary.untested} to go`;

  clear(barEl);
  for (const item of CHECKLIST) {
    barEl.append(h("span", { data: { result: getItem(current, item.id).result }, title: item.title }));
  }
}

function renderNotice(): void {
  const lines: string[] = [];
  if (!persistence.durable || writeFailed) {
    lines.push(
      "This phone is not saving state (Private Browsing, or storage is full). The run works, but it is lost when you close the tab.",
    );
  }
  const assumed = TARGETS.filter((t) => t.path === "/" || t.id === "backend").filter((t) => isAssumedBase(t, bases));
  if (assumed.some((t) => t.id === "gameclient")) {
    lines.push(
      "The game client URL is a guess: no Netlify site existed when this page was built. Set the real one under Run setup before you trust a run.",
    );
  }
  noticeEl.textContent = lines.join(" ");
}

/* ----------------------------------------------------------------- setup -- */

function renderSetup(): void {
  const root = must<HTMLElement>("setup");
  clear(root);

  const deviceInput = h("input", {
    type: "text",
    id: "device",
    value: device,
    placeholder: "iPhone 13 · iOS 18.2 · Safari",
    autocomplete: "off",
  });
  on(deviceInput, "input", () => {
    device = deviceInput.value;
    persist(KEYS.device, device);
  });
  root.append(
    h(
      "label",
      { class: "field", for: "device" },
      h("span", { text: "Device" }),
      deviceInput,
      h("span", { class: "hint", text: "Recorded with the run. A pass on an iPhone 15 Pro is not a pass on a 12 mini." }),
    ),
  );

  for (const target of TARGETS) {
    const inputId = `base-${target.id}`;
    const input = h("input", {
      type: "url",
      id: inputId,
      value: bases[target.id] ?? "",
      placeholder: defaultBase(target),
      autocomplete: "off",
      autocapitalize: "none",
      spellcheck: "false",
      inputmode: "url",
    });
    on(input, "input", () => {
      const raw = input.value.trim();
      if (raw === "") {
        delete bases[target.id];
        input.removeAttribute("aria-invalid");
      } else if (normalizeBaseUrl(raw) === null) {
        // Keep what they typed, mark it, and do not persist a URL that
        // would silently send the run at the wrong host.
        input.setAttribute("aria-invalid", "true");
        return;
      } else {
        bases[target.id] = raw;
        input.removeAttribute("aria-invalid");
      }
      persistBases();
      renderNotice();
      refreshLinks();
    });

    root.append(
      h(
        "label",
        { class: "field", for: inputId },
        h("span", { text: target.label }),
        input,
        h("span", {
          class: "hint",
          text: `${target.role} Default: ${defaultBase(target)}${isAssumedBase(target, bases) ? " (assumed — no site confirmed yet)" : ""}`,
        }),
      ),
    );
  }

  const resetTargets = h("button", { class: "btn", type: "button", text: "Restore default URLs" });
  on(resetTargets, "click", () => {
    if (!confirm("Clear every deploy URL override and go back to the loop-- defaults?")) return;
    bases = {};
    dropKey(store, KEYS.bases);
    renderSetup();
    renderNotice();
    refreshLinks();
  });

  root.append(
    h("div", { class: "actions" }, resetTargets),
    h(
      "ul",
      { class: "link-list" },
      ...TARGETS.map((target) =>
        h("li", {}, h("a", { class: "dim", href: repoUrl(target), rel: "noopener", target: "_blank", text: `${target.repo} ↗` })),
      ),
    ),
  );
}

/* ------------------------------------------------------------- checklist -- */

interface ItemNodes {
  li: HTMLLIElement;
  pass: HTMLButtonElement;
  fail: HTMLButtonElement;
  link: HTMLAnchorElement;
}

const nodes = new Map<string, ItemNodes>();

function paint(item: ChecklistItem): void {
  const found = nodes.get(item.id);
  if (found === undefined) return;
  const result = getItem(current, item.id).result;
  found.li.dataset["result"] = result;
  found.pass.setAttribute("aria-pressed", String(result === "pass"));
  found.fail.setAttribute("aria-pressed", String(result === "fail"));
}

function refreshLinks(): void {
  for (const item of CHECKLIST) {
    const found = nodes.get(item.id);
    if (found === undefined) continue;
    found.link.href = deepLink(targetById(item.target), bases);
  }
}

function buildItem(item: ChecklistItem): HTMLLIElement {
  const target = targetById(item.target);

  const pass = h(
    "button",
    { class: "mark mark-pass", type: "button", "aria-pressed": "false", "aria-label": `Mark item ${item.n} passed` },
    h("span", { class: "box", "aria-hidden": "true", text: "✓" }),
  );
  const fail = h(
    "button",
    { class: "mark mark-fail", type: "button", "aria-pressed": "false", "aria-label": `Mark item ${item.n} failed` },
    h("span", { class: "box", "aria-hidden": "true", text: "✕" }),
  );

  on(pass, "click", () => {
    current = togglePass(current, item.id);
    persistState();
    paint(item);
    renderHeader();
  });
  on(fail, "click", () => {
    current = toggleFail(current, item.id);
    persistState();
    paint(item);
    renderHeader();
  });

  const link = h("a", {
    class: "btn btn-open",
    href: deepLink(target, bases),
    target: "_blank",
    rel: "noopener",
    text: `Open ${target.label.toLowerCase()} ↗`,
  });

  const noteId = `note-${item.id}`;
  const note = h("textarea", {
    id: noteId,
    placeholder: "What you saw. Times, device, anything the next run needs.",
  });
  note.value = getItem(current, item.id).note;
  on(note, "input", () => {
    current = setNote(current, item.id, note.value);
    persistState();
  });

  const li = h(
    "li",
    { class: "item", data: { result: getItem(current, item.id).result } },
    h(
      "div",
      { class: "item-head" },
      pass,
      h(
        "div",
        { class: "item-text" },
        h("h2", { text: `${item.n} · ${item.title}` }),
        h("p", { class: "criterion", text: item.criterion }),
      ),
      fail,
    ),
    h(
      "details",
      {},
      h("summary", { text: "How to check" }),
      h(
        "div",
        { class: "item-detail" },
        h("ol", {}, ...item.how.map((step) => h("li", { text: step }))),
        h("p", { class: "fails", text: `Fails if: ${item.fails}` }),
        link,
        h("label", { class: "field", for: noteId }, h("span", { text: "Note" }), note),
      ),
    ),
  );

  nodes.set(item.id, { li, pass, fail, link });
  paint(item);
  return li;
}

function renderItems(): void {
  const root = must<HTMLElement>("items");
  clear(root);
  nodes.clear();
  for (const item of CHECKLIST) root.append(buildItem(item));
}

/* --------------------------------------------------------------- history -- */

function verdictOf(run: RunRecord): "green" | "failed" | "incomplete" {
  if (run.summary.green) return "green";
  return run.summary.fail > 0 ? "failed" : "incomplete";
}

function renderHistory(): void {
  const root = must<HTMLElement>("history");
  clear(root);

  if (history.length === 0) {
    root.append(
      h("p", {
        class: "empty",
        text: "No runs filed yet. Work the seven items, then tap Save run — the snapshot is kept here with its timestamp.",
      }),
    );
    return;
  }

  const list = h("ul", { class: "runs" });
  for (const run of history) {
    const verdict = verdictOf(run);
    const remove = h("button", { class: "btn btn-danger", type: "button", text: "Delete this run" });
    on(remove, "click", () => {
      if (!confirm(`Delete the run from ${run.finishedAt}?`)) return;
      history = removeRun(history, run.id);
      persistHistory();
      renderHistory();
    });

    list.append(
      h(
        "li",
        {},
        h(
          "details",
          {},
          h(
            "summary",
            {},
            h("span", { class: "pill", data: { verdict }, text: verdict.toUpperCase() }),
            h("span", { text: `${run.summary.pass}/${run.summary.total} · ${run.finishedAt.replace("T", " ").slice(0, 16)}` }),
          ),
          h(
            "div",
            { class: "run-body" },
            h(
              "dl",
              {},
              h("dt", { text: "Device" }),
              h("dd", { text: run.device === "" ? "not recorded" : run.device }),
              h("dt", { text: "Client under test" }),
              h("dd", { text: run.base }),
              h("dt", { text: "Checklist build" }),
              h("dd", { text: run.buildTime }),
              h("dt", { text: "Started" }),
              h("dd", { text: run.startedAt }),
            ),
            h(
              "ul",
              { class: "run-items" },
              ...run.items.map((entry) =>
                h(
                  "li",
                  { data: { result: entry.result } },
                  h("span", {
                    class: "mark-text",
                    "aria-hidden": "true",
                    text: entry.result === "pass" ? "✓" : entry.result === "fail" ? "✕" : "–",
                  }),
                  h(
                    "span",
                    {},
                    `${entry.n} · ${entry.title}`,
                    entry.note !== "" ? h("span", { class: "note", text: entry.note }) : null,
                  ),
                ),
              ),
            ),
            h("div", { class: "actions" }, remove),
          ),
        ),
      ),
    );
  }

  const copy = h("button", { class: "btn", type: "button", text: "Copy all runs as JSON" });
  on(copy, "click", () => {
    void copyText(JSON.stringify(history, null, 2), copy);
  });

  const wipe = h("button", { class: "btn btn-danger", type: "button", text: "Clear history" });
  on(wipe, "click", () => {
    if (!confirm(`Delete all ${history.length} saved runs? This cannot be undone.`)) return;
    history = [];
    dropKey(store, KEYS.runs);
    renderHistory();
  });

  root.append(list, h("div", { class: "actions" }, copy, wipe));
}

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    // Clipboard needs a secure context and a user gesture; when it is refused,
    // put the text somewhere the phone can select it rather than losing it.
    const dump = h("textarea", { class: "mono", rows: "10", readonly: true });
    dump.value = text;
    button.after(dump);
    dump.focus();
    dump.select();
    button.textContent = "Select and copy ↓";
    return;
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
}

/* --------------------------------------------------------------- actions -- */

on(must<HTMLButtonElement>("finish"), "click", () => {
  const summary = summarize(current, CHECKLIST);
  if (summary.pass + summary.fail === 0) {
    alert("Nothing to file yet — mark at least one item first.");
    return;
  }
  if (!summary.complete && !confirm(`${summary.untested} of ${summary.total} items are still untested. File this run anyway?`)) {
    return;
  }

  history = appendRun(
    history,
    createRun({
      state: current,
      items: CHECKLIST,
      buildTime: BUILD_TIME,
      base: deepLink(targetById("gameclient"), bases),
      device,
    }),
  );
  persistHistory();

  // Filing a run starts the next one: a filed run is immutable, so leaving the
  // ticks on screen would invite editing history by re-tapping.
  current = parseState(null);
  persistState();

  renderHeader();
  renderItems();
  renderHistory();
  must<HTMLDetailsElement>("history-panel").open = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
});

on(must<HTMLButtonElement>("reset"), "click", () => {
  const summary = summarize(current, CHECKLIST);
  if (summary.pass + summary.fail > 0 && !confirm("Clear the current run? Saved runs are kept.")) return;
  current = parseState(null);
  persistState();
  renderHeader();
  renderItems();
});

/* ------------------------------------------------------------------ boot -- */

renderHeader();
renderNotice();
renderSetup();
renderItems();
renderHistory();
