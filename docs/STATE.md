# STATE

**Last session:** 2026-09-03 · bootstrap T0 + T1 + T2.

## Blocker — read this first

**Nothing in this repo has been run against a live STRATA deploy, and this
session could not have run one even if it existed.** Two separate facts, and it
matters that they stay separate:

1. **No sibling is deployed.** `clvi-backend`'s own `docs/STATE.md` (on `main`,
   fetched this session) says: *"Netlify site: not yet created"*, *"Supabase
   project: not yet created"*, *"Schema applied on: NOT APPLIED"*. Its M1–M3 are
   written and unit-tested, never run live. No sibling has a `loop` branch yet —
   `raw.githubusercontent.com/Apocrypthon/clvi-<repo>/loop/docs/STATE.md` is 404
   for all five.
2. **This session's sandbox cannot reach `*.netlify.app` at all.** Its egress
   proxy answered `CONNECT loop--clvi-backend.netlify.app:443` with `403`. So
   even a deployed sibling would have looked down from here.

Fact 2 makes this session's probe **inconclusive**, and the suite says so rather
than recording a verdict. Fact 1 is the real reason T2 has no live result, and it
is sourced from the backend's own docs, not from a failed request.

**The next session's first job is the first item in `Next`.** Until a real base
URL exists, treat T2 as *written and self-tested*, not as *passing against the
ledger*.

## Where the work is

| Milestone | Status |
| --- | --- |
| T0 — scaffold, netlify.toml, docs, build gate | **done** |
| T1 — acceptance page | **done**, verified in an iPhone-sized browser |
| T2 — contract smoke | **done** offline; **never run live** (see Blocker) |
| T3 — solve bench | not started |
| T4 — drift check | not started |

`npm run check` is green: 114 tests, 0 failures. That number covers the shape
validators, the solve rule, the checklist state machine, the runs history, base-URL
handling and the reachability classifier. It covers **none** of the live ledger,
because there is no live ledger.

## Next

In order. Take the first one, finish it completely, stop.

1. **Run the smoke suite against something real, and paste the output into
   [#verify](#verify).** The moment any base URL exists — a Netlify branch deploy,
   a preview, or `netlify dev` on a laptop — run:
   `STRATA_BACKEND_BASE=<url> npm test`, then
   `STRATA_BACKEND_BASE=<url> SMOKE_MINT=1 npm test` once, deliberately, to walk
   the mint path. Replace every `NOT RUN` below with the real transcript. If
   something breaks, **that is the increment** — fix or report it and record it.
   Fix the assumed URLs in `src/lib/targets.ts` at the same time.
2. **T3 — the solve bench.** `bench.html`, a third Vite entry. Run the hash loop
   at difficultyBits 14/16/18 using WebCrypto (`crypto.subtle.digest`), report
   hashes/sec and projected median solve time, and let the result be copied out
   for `docs/BENCH.md`. `src/lib/pow.ts` already has `medianHashes` and
   `medianSolveMs`, tested; the bench only needs the browser digest and a UI.
   This is what tunes the backend's start difficulty, so its output must say which
   phone produced it.
3. **T4 — the drift check.** A script that fetches each sibling's
   `docs/STATE.md` from `raw.githubusercontent.com` on branch `loop`, extracts its
   claims, checks what it can (deploy reachable, build stamp fresh) and writes
   `docs/DRIFT.md`. Reuse `src/lib/preflight.ts` — the "blocked vs down"
   distinction is exactly the trap a drift checker must not fall into, and it is
   already tested.
4. **Add an expiry case that does not need `SMOKE_SLOW`.** Today the only honest
   expired-challenge test waits out a real TTL. If the backend gains a way to
   request a short-TTL challenge for testing, use it. Do not fake it by editing
   `expiresAt` client-side; the server does not read that field from us.

## Verify

Two tiers. The offline gate runs anywhere; the live walk needs a deploy.

### Offline gate — run every session

```
npm ci
npm run check
```

**Result 2026-09-03: PASS.** `tsc -p tsconfig.json` clean; `vite build` produced
`dist/` (index 1.73 kB, acceptance 2.50 kB, CSS 8.66 kB → 2.44 kB gzip, JS 11.43 kB
+ 6.13 kB → 4.52 + 2.77 kB gzip); `node --test tests/*.test.ts` →
`# tests 114 / # pass 114 / # fail 0`, across `tests/pow.test.ts` (32),
`tests/contracts.test.ts` (30), `tests/acceptance.test.ts` (39) and the always-on
half of `tests/smoke.test.ts` (13).

The live half of `tests/smoke.test.ts` reported:

```
ok 21 - backend contract smoke # SKIP https://loop--clvi-backend.netlify.app/health
returned 403 with a non-JSON body — this is an egress proxy denying the host, not
the deploy answering; run the suite from a machine that can reach it before
recording a verdict
```

That is a skip, not a pass, and it is inconclusive rather than a verdict. See the
Blocker.

### Page check — the acceptance page on a phone-sized browser

```
npm run build && node scripts/verify-page.mjs
```

**Result 2026-09-03: PASS, 23/23**, in Chromium at 390×844, `isMobile`, `hasTouch`,
iOS 18.2 user agent. What it actually asserted:

- seven items render; the build stamp is filled in; the index title carries the
  build timestamp
- **every visible control is at least 44×44 CSS px** — item 3, applied to this page
- **no horizontal overflow** — item 1's "viewport clean", applied to this page
- a pass, a fail and a note each survive a reload
- opening "How to check" is not snapped shut by the next repaint
- filing a run clears the current one, appears in history, and survives a reload
- an unmarked run cannot be filed
- a note containing `<img src=x onerror=…>` is rendered as text and injects no
  element
- no uncaught page errors

`scripts/verify-page.mjs` needs a globally installed Playwright and is deliberately
not a devDependency — see Decisions.

### Live walk — the definition of done for T2. NOT RUN.

Every line below is written but **unrun**; no deploy existed on 2026-09-03.

```bash
BASE=https://<the ledger deploy>

# 1 — the whole suite against a real ledger, minting nothing
STRATA_BACKEND_BASE=$BASE npm test
# expect: the "backend contract smoke" suite runs instead of skipping;
#         15 live checks pass; the mint and expiry cases still skip by design.

# 2 — the happy path, once, deliberately. This writes to an append-only ledger.
STRATA_BACKEND_BASE=$BASE SMOKE_MINT=1 npm test
# expect: "minted <tokenId> · <kWh> kWh · N hashes in M ms",
#         entryCount grows by exactly 1, and the replay is rejected as challenge_used.

# 3 — expiry, only against a deploy whose TTL is under ~3 minutes
STRATA_BACKEND_BASE=$BASE SMOKE_SLOW=1 npm test
# expect: the expired submission is rejected with an expiry-specific error code.
```

**Result: NOT RUN** — no deploy existed as of 2026-09-03, and this session's
sandbox could not reach `*.netlify.app` regardless. Record each step's real output
here on the first live run.

### Phone check — the actual acceptance run. NOT RUN.

Open the deployed acceptance page on an iPhone, set the game-client URL under
**Run setup**, work the seven items, tap **Save run**.

**Result: NOT RUN** — there is no game client deployed to run the checklist
against, and this session has no phone. `scripts/verify-page.mjs` checks that the
*tool* works; it cannot check that STRATA does.

## Decisions

- **`rangeStart` / `rangeEnd` are accepted as either an ISO timestamp or a
  sequence integer.** Contracts v1 does not pin the type, and the backend's docs
  are readable both ways. The validator accepts either, rejects a range that
  *mixes* the two, and the smoke run prints which one the deploy chose. See
  [Open questions](#open-questions).
- **`scripts/verify-page.mjs` is not a devDependency.** The frozen stack rule says
  no heavy browser-automation deps unless STATE.md argues the case, and one
  verification script is not that case. It resolves Playwright from the global
  install and exits 2 with instructions when it is absent. `npm run check` does not
  depend on it, so a clean clone with no Playwright is still green.
- **A tri-state item, not a checkbox.** SEED.md says "checkbox state in
  localStorage", but the most valuable output of an acceptance run is *which item
  failed*. Items are `untested | pass | fail`, with two separate controls: tapping
  the row's ✓ toggles pass, tapping ✕ toggles fail. It is not a three-way cycle on
  one control — one stray tap must never silently turn a pass into a fail on a
  phone.
- **Filing a run clears the current one.** A filed run is immutable evidence;
  leaving the ticks on screen invites editing history by re-tapping.
- **Nothing in the smoke suite writes to the ledger without `SMOKE_MINT=1`.** The
  ledger is the product's entire argument. A suite that can grow it on every commit
  devalues it. Even the negative cases are constructed to be *provably* rejected —
  the bad-nonce test searches for a nonce it has verified locally will fail.
- **The default `deviceClass` is `laptop`.** It drives the backend's energy
  estimate, and an append-only ledger cannot be corrected. A node test runner is
  not a phone; `SMOKE_DEVICE_CLASS` overrides it.

## Open questions

Things this repo cannot decide alone. They belong to `clvi-architecture`, which
owns Contracts v1.

1. **What type are `rangeStart` and `rangeEnd`?** ISO instants or ledger sequence
   numbers? `GET /audit/<from>.<to>` takes ISO, which suggests ISO, but the report
   is a different object. Pin it in Contracts v1 and tighten
   `validateAuditReport`.
2. **Is `generatedAt` part of AuditReport?** The backend returns it; the frozen
   contract does not list it. Either add it to v1 or stop returning it.
3. **What is the canonical error-code vocabulary?** The smoke suite asserts
   *structured* 4xx (`{error:{code}}`) everywhere, but only pattern-matches the
   code for reuse (`/use|replay|spent|dup/`) and expiry (`/expire|stale|timeout/`).
   A frozen list would let it assert exact codes.
4. **Are the `loop--<site>.netlify.app` URLs right?** Every base URL in
   `src/lib/targets.ts` is a *convention*, not an observation. Nobody has confirmed
   a Netlify site name.

## Notes for the next session

- The branch for this work is `claude/strata-clvi-testing-bootstrap-hxj1tf`,
  assigned by the session harness. `SEED.md` says `origin loop`; the harness
  instruction wins, and `docs/LOOP.md` records that rule. Do not push to a branch
  you were not given.
- `npm run check` is the gate and takes about two seconds. Run it before every
  commit.
- Logic goes in `src/lib/`, where `node --test` can reach it with no DOM and no
  network. `src/acceptance/main.ts` is wiring; if you find yourself writing a
  decision there, move it.
- The acceptance page re-renders one item at a time on a tap, on purpose. A full
  re-render snaps every open "How to check" shut under your thumb. Typing never
  re-renders at all, so the caret stays put. Do not "simplify" either of those.
- Two real bugs were caught by tests during bootstrap, both by tests written to
  pin a *mistake* rather than to confirm the code: `normalizeBaseUrl` silently
  rewrote `ftp://x.test` to `https://ftp//x.test`, and the first fix then rejected
  a bare `localhost:8888` as an unknown scheme. Keep writing tests that way.
