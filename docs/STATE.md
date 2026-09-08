# STATE

**Last session:** 2026-09-08 · T3, the solve bench.

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

There is now a **third** thing in the same family, added by T3: the solve bench
has never been run on a phone. It has been run — on the headless Chromium that
`scripts/verify-page.mjs` drives — and that result is recorded in `docs/BENCH.md`
clearly labelled as not-a-phone. A desktop hash rate cannot tune the backend's
difficulty, and BENCH.md says so rather than quietly using it.

**The next session's first job is the first item in `Next`.** Until a real base
URL exists, treat T2 as *written and self-tested*, not as *passing against the
ledger*; until a phone has run the bench, treat T3's recommendation as measured
on the wrong class of device.

## Where the work is

| Milestone | Status |
| --- | --- |
| T0 — scaffold, netlify.toml, docs, build gate | **done** |
| T1 — acceptance page | **done**, verified in an iPhone-sized browser |
| T2 — contract smoke | **done** offline; **never run live** (see Blocker) |
| T3 — solve bench | **done**, verified in a browser; **never run on a phone** |
| T4 — drift check | not started |

`npm run check` is green: 164 tests, 0 failures. That number covers the shape
validators, the solve rule, SHA-256 itself, the bench runner and its tuning
arithmetic, the checklist state machine, the runs history, base-URL handling and
the reachability classifier. It covers **none** of the live ledger, because there
is no live ledger.

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
2. **Run the bench on an actual iPhone and append the result to
   `docs/BENCH.md`.** This needs no deploy of anyone else's — `npm run dev`, open
   `bench.html` from the phone on the same network, or deploy this repo. It takes
   about a minute and it is the only thing standing between the relay and a real
   answer on `difficultyBits`. See BENCH.md#what-this-already-suggests: on the one
   device measured so far, the backend's default of 18 solves in 0.19 s, far under
   item 5's 3 s floor. That finding needs a phone before anyone acts on it.
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

**Result 2026-09-08: PASS.** `tsc -p tsconfig.json` clean; `vite build` produced
`dist/` (three pages plus a Worker chunk; largest bundle 11.51 kB → 5.39 kB gzip,
CSS 10.59 kB → 2.78 kB gzip); `node --test tests/*.test.ts` →
`# tests 164 / # pass 164 / # fail 0`, across `tests/acceptance.test.ts` (39),
`tests/bench.test.ts` (35), `tests/pow.test.ts` (32), `tests/contracts.test.ts`
(30), `tests/sha256.test.ts` (15) and the always-on half of `tests/smoke.test.ts`
(13).

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

**Result 2026-09-08: PASS, 40/40**, in Chromium at 390×844, `isMobile`, `hasTouch`,
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

and for the bench page (T3):

- every control is at least 44×44 and the page does not scroll sideways, before
  and after results render
- the device field is asked for first, and an unnamed device is called out
- a **real** bench run completes — three difficulties, the actual hash loop, in a
  real Worker (the copy block says `Worker`, so the main-thread fallback is not
  silently masking a broken Worker)
- every difficulty measures a non-zero rate, and the copy block carries the
  device, a markdown table, and a recommendation

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
- **The solve loop uses a hand-written synchronous SHA-256, not
  `crypto.subtle.digest`.** This was measured, not assumed: awaiting a promise
  per hash gives ~16,000 h/s versus ~950,000 h/s synchronous, which is an 11-second
  median at 18 bits against 0.2 s. Item 5 wants 3–8 s, so WebCrypto cannot be in
  the loop. `src/lib/sha256.ts` is pinned against the NIST vectors and
  differentially against `node:crypto` at every length across the padding
  boundaries. The bench measures `subtle.digest` on every run anyway and prints
  the ratio, so the decision keeps re-justifying itself on real devices instead of
  ageing into folklore. Full numbers in `docs/BENCH.md`.
- **The bench runs in a Worker.** Not for tidiness: a solve at 18 bits blocks a
  thread for hundreds of milliseconds, and measuring it on the main thread would
  measure the browser's reaction to being blocked as well. It is also what the
  real client must do, since item 2 wants the title pan smooth for 30 s. There is
  a main-thread fallback, and the result says which one produced it — a
  main-thread number is lower and the reader must be able to tell.
- **The recommendation pools every hash from the whole run.** Per-difficulty rates
  differ (the 14-bit phase is short and mostly JIT warm-up), and the hash rate does
  not actually depend on difficulty — only the comparison does. Pooling avoids
  tuning the backend from whichever difficulty happened to get the cleanest slice
  of CPU.
- **A fresh salt per sample.** The backend issues one salt per challenge; re-solving
  a single salt would find the same nonce every time and report a variance of zero,
  which looks like a beautifully precise measurement of nothing.
- **The default `deviceClass` is `laptop`.** It drives the backend's energy
  estimate, and an append-only ledger cannot be corrected. A node test runner is
  not a phone; `SMOKE_DEVICE_CLASS` overrides it.

## Open questions

Things this repo cannot decide alone. They belong to `clvi-architecture`, which
owns Contracts v1.

1. **Is `difficultyBits: 18` too easy?** On the only device the bench has run on
   (a headless desktop Chromium — *not* a phone), 18 bits solves in 0.19 s against
   item 5's 3 s floor, and the bench recommends 23. A phone 5–10× slower still
   lands near 1–2 s. This is a real signal but not yet evidence: it needs one run
   on an actual iPhone before `clvi-backend` changes its default. See
   `docs/BENCH.md`.
2. **What type are `rangeStart` and `rangeEnd`?** ISO instants or ledger sequence
   numbers? `GET /audit/<from>.<to>` takes ISO, which suggests ISO, but the report
   is a different object. Pin it in Contracts v1 and tighten
   `validateAuditReport`.
3. **Is `generatedAt` part of AuditReport?** The backend returns it; the frozen
   contract does not list it. Either add it to v1 or stop returning it.
4. **What is the canonical error-code vocabulary?** The smoke suite asserts
   *structured* 4xx (`{error:{code}}`) everywhere, but only pattern-matches the
   code for reuse (`/use|replay|spent|dup/`) and expiry (`/expire|stale|timeout/`).
   A frozen list would let it assert exact codes.
5. **Are the `loop--<site>.netlify.app` URLs right?** Every base URL in
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
- T3 added a third, and this one was caught by *looking at the output* rather than
  by a test: the bench's adaptive chunk size scaled from the chunk's budget instead
  of the hashes actually performed, so every early-finishing solve inflated it
  until it pinned to the cap — after which a single chunk ran seconds past the
  deadline. The 18-bit row collected 4 samples instead of 12 and reported an
  observed median 3.5× its projection. Nothing failed; the numbers were merely
  wrong. `tests/bench.test.ts` now pins the budget overshoot. **When a bench
  reports two numbers that should agree and they do not, that is the finding —
  do not explain it away as sampling noise without checking.**
- `scripts/verify-page.mjs` runs a genuine bench (three difficulties, real
  hashing) and prints the resulting markdown block. That takes ~12 s of the run and
  is worth it: it is the only thing that would catch the Worker silently failing
  into the main-thread fallback.
