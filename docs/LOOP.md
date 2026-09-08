# LOOP.md — how to run a session

Identical in all CLVI repos. **This file governs its own revision:** if you learn
a better way to run the loop, change it here, in the same session, and say so in
the CHANGELOG entry.

## BOOT

Read, in order: `CLAUDE.md` → this file → `docs/STATE.md` → the last three entries
of `docs/CHANGELOG.md`. Do not start work before you have read STATE.md's `Next`
list; it is the only authority on what to do.

## WORK

Take **the single smallest next improvement** from STATE's `Next` list, or the
first unmet milestone in `SEED.md` if `Next` is empty. Implement it *completely* —
code, tests and docs — rather than starting two things.

One increment per session. A half-finished second increment costs the next session
more than it saves this one.

## VERIFY

1. `npm run build` must pass (typecheck, then the Vite build).
2. `npm test` must pass (`node --test tests/*.test.ts`).
3. `npm run check` runs both; it is the gate. Nothing ships red.
4. Run every check in `docs/STATE.md#verify` and **record the actual results**,
   including the date. A check whose result is not recorded has not been run.
5. If a check cannot be run this session (no deploy, no phone, no network), say so
   explicitly next to the check. **Never imply a check passed.**

## RECORD

- Rewrite `docs/STATE.md` so that a stranger with only this repo could continue. It
  describes what *is*, not what was planned. The docs must never describe a repo
  that no longer exists.
- Append **one** entry to `docs/CHANGELOG.md`: date · what · why · files · verify
  result.
- A decision that is not written down will be re-litigated. Put it in STATE.md
  under `Decisions`.

## SHIP

```
git add -A && git commit -m "loop: <summary>" && git push -u origin <branch>
```

The branch is whatever the session was told to use. `SEED.md` says `origin loop`;
sessions driven by an automation harness are given their own branch name and must
use it. **Never push to a branch you were not given.** (clvi-backend's LOOP.md
records the same rule, reached independently — it is the relay's convention now,
not a local exception.)

## STOP

Leave the repo green. If you are blocked after two attempts, stop trying: write the
blocker at the very top of `docs/STATE.md` — what you tried, what happened, what
the next session should try first — and spend the remaining effort on tests or
docs instead. A well-described blocker is a completed increment.

## Loop hygiene learned so far

These are this repo's specifically, because this repo is the one that checks
whether the others are telling the truth.

- **Distinguish "it failed" from "I could not check".** They are different
  results and only one of them belongs in STATE.md as a verdict. This repo hit the
  trap during bootstrap: Netlify resolves DNS for every `<branch>--<site>` name
  whether or not the site exists, and the sandbox's egress proxy answers a denied
  host with `403`. "DNS resolved, got 403" reads exactly like a dead deploy. It
  is now a tested classification (`src/lib/preflight.ts`), not a judgement call at
  the call site, and an inconclusive probe prints a line telling you not to record
  a verdict from it.
- **A skip must carry its reason.** `# skipped` with no explanation is how a suite
  quietly stops testing anything. Every skip in `tests/smoke.test.ts` names the
  env var that would turn it on.
- **Guard anything that writes to the ledger.** `/submit` appends to an
  append-only chain. A suite that can grow it on every commit devalues the exact
  evidence this relay produces. `SMOKE_MINT=1` is the gate; the default is off.
- **Prefer a testable module over a testable page.** Logic lives in `src/lib/`;
  `src/acceptance/` is wiring. This is what lets `npm test` be a real gate with no
  browser and no network.
- **Write the failure mode into the test.** The valuable tests here are the ones
  that pin a mistake: counting leading zero *nibbles* instead of bits, a summary
  that reads green while an item is untested, a base URL that silently rewrites
  `ftp://x` into `https://ftp//x`. Two of those were real bugs caught this way
  during bootstrap.
- **Dogfood the checklist.** The acceptance page must itself pass items 1, 3 and 4
  of the checklist it carries. `scripts/verify-page.mjs` asserts that in a real
  iPhone-sized browser.
- **When two numbers that should agree do not, that is the finding.** Read the
  output, do not just check that it is green. T3's bench printed a projected
  median of 196 ms next to an observed median of 682 ms for the same difficulty,
  while the other rows agreed within noise. Everything passed. The gap was a real
  bug in the chunk sizing, and the temptation — "small samples, geometric
  distribution, that is just variance" — was a perfectly plausible way to ship
  wrong numbers. Explain a discrepancy by finding its cause, not by naming a
  phenomenon that could produce it.
- **Measure before you design on top of an assumption.** The Next list that
  commissioned T3 specified `crypto.subtle.digest`. Ten minutes of measurement
  showed it is 60x too slow for the job, which changed the whole shape of the
  increment. A note left by a previous session is a hypothesis, not an
  instruction — this repo of all repos should check it.
