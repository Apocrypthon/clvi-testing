# clvi-testing

STRATA's proof repo. It builds none of the game; it checks whether the repos that
do are telling the truth.

- **The acceptance page** — the seven-item iPhone checklist, tappable, with state
  and a timestamped runs history kept on the phone.
- **The contract smoke suite** — `node --test` against a live deploy, checking that
  it honours Contracts v1.
- **The solve bench** (T3, not built yet) — measures hash rate on a real phone so
  the backend's start difficulty is tuned from data.

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

**Current status:** T0–T2 done and green offline; the live checks have never run,
because no sibling is deployed yet. `docs/STATE.md` says so in detail, which is the
whole point of this repo.
