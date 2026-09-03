# CLAUDE.md — clvi-testing

STRATA's proof repo. It does not build the game; it checks whether the repos that
do are telling the truth. See `docs/VISION.md`.

## Start here, every session

1. `docs/LOOP.md` — the protocol. It governs its own revision.
2. `docs/STATE.md` — what *is*, and the `Next` list. The only authority on what
   to do next.
3. The last three entries of `docs/CHANGELOG.md`.

Then take the first item in `Next`, finish it completely, and stop.

## Commands

```
npm ci
npm run check      # the gate: typecheck + vite build + node --test
npm run build      # typecheck + vite build  (what Netlify runs)
npm test           # node --test tests/*.test.ts
npm run dev        # local Vite server for the pages
```

Against a real deploy:

```
STRATA_BACKEND_BASE=https://…  npm test     # point the smoke suite somewhere
SMOKE_MINT=1                   npm test     # allow the happy path to mint ONE token
SMOKE_SLOW=1                   npm test     # allow the expiry case to wait out a TTL
```

## Frozen stack rules (SEED.md)

- TypeScript + Vite for the pages; `node --test` for automated tests; **no heavy
  browser-automation deps** unless STATE.md argues the case. There are currently
  three devDependencies — vite, typescript, @types/node — and zero runtime
  dependencies. Keep it that way; adding one needs a recorded decision.
- **iPhone Safari first.** These pages are used ON the phone, mid-run. The
  acceptance page must pass items 1, 3 and 4 of the checklist it carries.
- **No secrets in this repo.** Base URLs come from the environment.

## The rule that matters most here

Never imply a check passed. This repo's whole value is that its green means
something: a skip carries its reason, an unreachable host is reported as
unreachable rather than as broken, and a live result is recorded with the command
and date that produced it. See `docs/LOOP.md#loop-hygiene-learned-so-far`.

## Layout

```
index.html, acceptance.html   the two pages (Vite multi-page build)
src/lib/                      all the logic, unit-tested, no DOM and no network
src/acceptance/               DOM wiring for the checklist
tests/                        node --test; smoke.test.ts is the only live one
scripts/verify-page.mjs       drives the built page in an iPhone-sized Chromium
docs/                         the memory: VISION, LOOP, STATE, CHANGELOG
```
