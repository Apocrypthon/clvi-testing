# CHANGELOG

One entry per session, newest first: date · what · why · files · verify result.

## 2026-09-08 — T3, the solve bench

**What.** `bench.html`, a third Vite entry: it runs the real hash loop at
difficultyBits 14/16/18 in a Worker, reports hashes/sec and projected median
solve time per difficulty, and recommends the `difficultyBits` that puts a solve
inside item 5's 3-8 s window on *this* device. The result copies out as a
markdown block for `docs/BENCH.md`, carrying the device name and the date.

**Why.** The backend picks a start difficulty and currently defaults to 18. That
was a guess. Item 5 of the acceptance checklist makes it measurable, so this
measures it.

**The finding that changed the design.** STATE.md's own Next list said to build
this on `crypto.subtle.digest`. That was wrong, and measuring it first is what
caught it: `subtle.digest` is async, a solve needs one digest per nonce serially,
and a promise per hash costs far more than the hash. Measured — 16,000 h/s
awaited serially against ~950,000 h/s synchronous, an 11.3 s median at 18 bits
against 0.2 s. So `src/lib/sha256.ts` is a hand-written synchronous SHA-256,
pinned against the NIST vectors and differentially against `node:crypto` at every
length across the padding boundaries. The bench still measures `subtle.digest` on
every run and prints the ratio, so the decision keeps justifying itself on real
devices instead of ageing into a comment nobody rechecks.

**A bug the output revealed, that the tests did not.** The bench's adaptive chunk
size scaled from the chunk's *budget* rather than the hashes actually performed,
so every early-finishing solve inflated it until it pinned to the 4M cap — after
which one chunk ran seconds past the deadline. The 18-bit row collected 4 samples
instead of 12 and reported an observed median 3.5x its projection. Everything
passed; the numbers were simply wrong. Caught by reading them, fixed, and pinned
by two regression tests. LOOP.md gains the rule: when a bench prints two numbers
that should agree and they do not, that is the finding.

**What it already suggests.** On the only device measured — the headless Chromium
that `scripts/verify-page.mjs` drives, explicitly *not* a phone — 18 bits solves
in 0.19 s against a 3 s floor, and the recommendation is 23. That is a real signal
and not yet evidence; `docs/BENCH.md` records it as not-a-phone and refuses to
tune the backend from it. One run on an actual iPhone would settle it, and that is
now item 2 in `Next`.

**Files.** `bench.html`; `src/lib/sha256.ts`, `src/lib/bench.ts`;
`src/bench/{main,worker,protocol}.ts`; `src/style.css`, `src/main.ts`,
`vite.config.ts`; `tests/sha256.test.ts`, `tests/bench.test.ts`;
`scripts/verify-page.mjs`; `docs/BENCH.md`, `docs/STATE.md`, `docs/LOOP.md`,
`CLAUDE.md`, `README.md`.

**Verify.** `npm run check` → typecheck clean, `vite build` produced three pages
plus a Worker chunk, `node --test` → **164 tests, 164 pass, 0 fail** (was 114).
`node scripts/verify-page.mjs` → **40/40** (was 23/23), including a real
three-difficulty bench run in a real Worker at 390x844.

**Not verified, and not claimed.** The bench has never run on a phone, and the
live smoke suite still has no deploy to point at. Both are recorded as such in
`docs/STATE.md#blocker`.

## 2026-09-03 — bootstrap T0, then T1 and T2

**What.** Brought the repo up from empty (LICENSE + README) to the seed's
definition of done for this run: the acceptance checklist and the contract smoke
suite.

- **T0.** `SEED.md` saved verbatim. Vite vanilla-TS scaffold with a two-page build,
  `netlify.toml` (build `npm run build`, publish `dist`), and an index whose title
  is `clvi-testing · <build timestamp>` with the stamp injected by Vite at build
  time. `CLAUDE.md` and `docs/` (VISION, LOOP, STATE, CHANGELOG).
- **T1.** `acceptance.html` — the seven items, verbatim from SEED.md, as a
  one-handed page: per-item pass/fail with 56 px controls, a "How to check"
  disclosure carrying the steps and the fail condition, a per-item note, per-repo
  deep links to the `loop--` URLs (editable and persisted per phone), a reset
  button, and a timestamped runs history that survives a reload and can be copied
  out as JSON.
- **T2.** `tests/smoke.test.ts` — `/health` shape; `/audit/latest` against the
  AuditReport shape plus the `entryCount == tokenCount` mint invariant and
  `chainOk`; `/verify` round-tripping the fetched report and rejecting both an
  edited field and a flipped signature; `/challenge` shape, uniqueness of salt and
  id, and a structured 4xx on a bad request; four `/submit` negative cases; the
  minting happy path behind `SMOKE_MINT=1`; the expiry case behind `SMOKE_SLOW=1`.
  Base URLs default to the loop deploys and are overridable per target from the
  environment.

**Why.** SEED.md's "definition of done for this run" is T1–T2, and the repo was
empty, so T0 came first.

**Two things worth carrying forward.**

1. *A skip is not a pass, and "I could not check" is not "it failed."* Netlify
   resolves DNS for every `<branch>--<site>.netlify.app` name whether or not the
   site exists, and this sandbox's egress proxy answers a denied host with `403` —
   so the naive reading of the probe was "the backend is deployed and broken",
   which is false twice over. Reachability is now a tested classification
   (`src/lib/preflight.ts`) that marks a blocked host **inconclusive** and prints
   "do not record a verdict in docs/STATE.md from this run".
2. *Tests that pin a mistake find bugs; tests that confirm the code do not.* Two
   real bugs fell out this way: `normalizeBaseUrl` silently rewrote
   `ftp://x.test` into `https://ftp//x.test`, and the first fix then rejected a
   bare `localhost:8888` as an unknown scheme.

**Files.** `SEED.md`, `CLAUDE.md`, `README.md`, `index.html`, `acceptance.html`,
`vite.config.ts`, `tsconfig.json`, `package.json`, `netlify.toml`, `.gitignore`;
`src/style.css`, `src/main.ts`, `src/env.d.ts`; `src/lib/{checklist,contracts,http,
pow,preflight,runs,smoke-config,solve.node,state,storage,targets}.ts`;
`src/acceptance/{main,dom}.ts`; `tests/{pow,contracts,acceptance,smoke}.test.ts`;
`scripts/verify-page.mjs`; `docs/{VISION,LOOP,STATE,CHANGELOG}.md`.

**Verify.** `npm run check` → typecheck clean, `vite build` produced `dist/`,
`node --test` → **114 tests, 114 pass, 0 fail**. `node scripts/verify-page.mjs` →
**23/23** in Chromium at 390×844 with touch, including "every visible control is at
least 44×44" and "no horizontal overflow" — items 3 and 1 of the checklist, applied
to the checklist's own page.

**Not verified, and not claimed.** The live half of the smoke suite has never run:
no sibling is deployed (clvi-backend's own STATE.md says its Netlify site and
Supabase project were never created) and this sandbox cannot reach `*.netlify.app`
at all. It reported `# SKIP` with that reason. See `docs/STATE.md#blocker`.
