/**
 * The index. Its job is to be the thing you can find from a phone's home screen
 * and get to the checklist in one tap, and to say what this repo currently
 * proves — including what it does not.
 */
import { CHECKLIST } from "./lib/checklist.ts";
import { TARGETS, defaultBase, isAssumedBase, repoUrl } from "./lib/targets.ts";
import { clear, h, must } from "./acceptance/dom.ts";

const BUILD_TIME = __BUILD_TIME__;

// SEED.md asks for the index to be "clvi-testing · <build timestamp>".
document.title = `clvi-testing · ${BUILD_TIME}`;
must<HTMLElement>("stamp").textContent = `build ${BUILD_TIME}`;

const app = must<HTMLElement>("app");
clear(app);

const milestones: ReadonlyArray<readonly [string, string, string]> = [
  ["T0", "done", "Scaffold, docs, netlify.toml, build gate."],
  ["T1", "done", `The ${CHECKLIST.length}-item iPhone acceptance checklist, with runs history.`],
  ["T2", "done", "Contract smoke against the loop deploys — skips honestly when a sibling is not live."],
  ["T3", "next", "Solve bench at 14/16/18 bits, feeding docs/BENCH.md."],
  ["T4", "later", "Drift check across the sibling repos' STATE.md claims."],
];

app.append(
  h(
    "section",
    {},
    h("p", {
      text:
        "This is the relay's proof repo. It holds the acceptance checklist you run on the phone, " +
        "and the contract tests that check the loop deploys actually behave the way Contracts v1 says.",
    }),
    h("div", { class: "actions" }, h("a", { class: "btn btn-primary", href: "./acceptance.html", text: "Open the acceptance checklist →" })),
  ),
);

app.append(
  h(
    "details",
    { class: "panel", open: true },
    h("summary", { text: "Milestones" }),
    h(
      "div",
      { class: "panel-body" },
      h(
        "ul",
        { class: "link-list" },
        ...milestones.map(([id, status, note]) =>
          h(
            "li",
            {},
            h("span", { class: "pill", data: { verdict: status === "done" ? "green" : "incomplete" }, text: `${id} ${status}` }),
            " ",
            h("span", { class: "dim", text: note }),
          ),
        ),
      ),
    ),
  ),
);

app.append(
  h(
    "details",
    { class: "panel" },
    h("summary", { text: "Deploys under test" }),
    h(
      "div",
      { class: "panel-body" },
      h("p", {
        class: "dim",
        text:
          "Branch deploys follow Netlify's loop--<site> convention. Every URL below is still an assumption: " +
          "no sibling had a Netlify site when this was built. Override them per-phone in the checklist's Run setup, " +
          "and per-run in the tests with the env var shown.",
      }),
      h(
        "ul",
        { class: "link-list" },
        ...TARGETS.map((target) =>
          h(
            "li",
            {},
            h("a", { href: repoUrl(target), rel: "noopener", target: "_blank", text: target.repo }),
            h("br"),
            h("span", { class: "mono dim", text: defaultBase(target) }),
            isAssumedBase(target) ? h("span", { class: "dim", text: " · assumed" }) : null,
            h("br"),
            h("span", { class: "mono dim", text: target.envVar }),
          ),
        ),
      ),
    ),
  ),
);

app.append(
  h(
    "details",
    { class: "panel" },
    h("summary", { text: "Contracts v1 (frozen)" }),
    h(
      "div",
      { class: "panel-body" },
      h(
        "ul",
        { class: "link-list mono" },
        h("li", { class: "dim", text: "Challenge   { challengeId, salt, difficultyBits, expiresAt }" }),
        h("li", { class: "dim", text: "Submission  { challengeId, playerId, cellId, artifactId, nonce, hashes, ms, deviceClass }" }),
        h("li", { class: "dim", text: "AuditReport { rangeStart, rangeEnd, entryCount, totalEstKwh, chainOk, tokenCount, signature }" }),
      ),
      h("p", {
        class: "dim",
        text: 'Solve rule: sha256(salt + ":" + nonce + ":" + playerId) leading zero bits >= difficultyBits.',
      }),
      h("p", { class: "dim", text: "Changed only via clvi-architecture." }),
    ),
  ),
);
