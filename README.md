# clvi-testing

STRATA's proof repo. It builds none of the game; it checks whether the repos that
do are telling the truth.

- **The acceptance page** — the seven-item iPhone checklist, tappable, with state
  and a timestamped runs history kept on the phone.
- **The contract smoke suite** — `node --test` against a live deploy, checking that
  it honours Contracts v1.
- **The solve bench** — measures SHA-256 rate on a real phone and recommends the
  `difficultyBits` that puts a solve in the 3–8 s window item 5 asks for.
  Results live in [`docs/BENCH.md`](./docs/BENCH.md).

```
npm ci
npm run check      # the gate: typecheck + build + tests
npm run dev        # the pages, locally
```

Point the smoke suite at something real:

```
STRATA_BACKEND_BASE=https://…              npm test   # nothing is minted
STRATA_BACKEND_BASE=https://… SMOKE_MINT=1 npm test   # mints exactly one token
```

Start with [`CLAUDE.md`](./CLAUDE.md), then [`docs/STATE.md`](./docs/STATE.md).

**Current status:** T0–T3 done and green offline. Two things have never run: the
live contract checks (no sibling is deployed yet) and the bench on an actual phone
(only a desktop browser so far). `docs/STATE.md` says so in detail, which is the
whole point of this repo.
