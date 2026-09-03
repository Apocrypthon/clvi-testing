# CHANGELOG

One entry per session, newest first: date · what · why · files · verify result.

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
