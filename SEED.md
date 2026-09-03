# SEED — clvi-testing

You are one session in a relay building **STRATA** (browser MMO-tycoon; Paradise,
NV). This repo is the **proof**: the iPhone acceptance page, contract smoke tests
against the live loop deploys, and the solve-timing bench that tunes puzzle
difficulty.

No memory between sessions; docs are the memory.

## Stack rules (frozen)

- TypeScript + Vite for the pages; `node --test` for automated tests; no heavy
  browser-automation deps unless STATE.md argues the case.
- iPhone Safari first. This repo's pages are used ON the phone, mid-run.
- No secrets in this repo.

## If this repo is empty → BOOTSTRAP (T0)

1. Save this entire prompt verbatim as `SEED.md`.
2. Scaffold Vite vanilla-ts + `netlify.toml` (build `npm run build`, publish
   `dist`) + index "clvi-testing · <build timestamp>".
3. Create CLAUDE.md + docs/ (VISION, STATE with milestones as Next, CHANGELOG,
   LOOP = protocol below). Build green, commit "loop: bootstrap T0", push
   `origin loop`.

## The Loop Protocol (identical in all CLVI repos)

- BOOT: read CLAUDE.md → docs/LOOP.md → docs/STATE.md → last 3 CHANGELOG entries.
- WORK: take the single smallest next improvement from STATE's Next list (or the
  first unmet milestone). Implement it completely. One increment per session.
- VERIFY: `npm run build` passes; `node --test` passes; record results in
  STATE.md#Verify.
- RECORD: rewrite STATE.md so a stranger could continue; append one CHANGELOG entry
  (date · what · why · files · verify result). If you learned a better way to run
  this loop, revise LOOP.md itself — **LOOP.md governs its own revision**. The docs
  must never describe a repo that no longer exists.
- SHIP: `git add -A && git commit -m "loop: <summary>" && git push origin loop`.
- STOP: leave the repo green. If blocked > 2 attempts, write the blocker at the top
  of STATE.md and improve tests or docs instead.

## Milestones

- **T1 — Acceptance page.** The 7-item iPhone checklist as a tappable page
  (checkbox state in localStorage, per-repo deep links to the `loop--` URLs, a
  reset button, a timestamped "runs" history): 1 loads < 3 s / viewport clean;
  2 title pan ≥ 30 s smooth and cool; 3 targets ≥ 44 px, nothing hover-only;
  4 pinch+pan Paradise without page rubber-band; 5 dig → solve 3–8 s → Holi burst
  → cell blooms; 6 settings shows GRD-id + est. kWh; 7 relaunch → save-init
  pan-down to last cell.
- **T2 — Contract smoke.** `node --test` suite against env-provided base URLs
  (default: the loop deploys): backend /health shape; /audit/latest matches
  AuditReport shape; /verify round-trips the fetched report (signature ok);
  challenge → local node-crypto solve → submit happy path guarded behind
  `SMOKE_MINT=1` so routine runs don't mint noise tokens; negative cases (expired
  challenge, reused challenge, bad nonce) expect structured 4xx.
- **T3 — Solve bench.** A page that runs the hash loop at difficultyBits 14/16/18
  in-browser and reports hashes/sec + projected median solve time; results
  appended by hand to docs/BENCH.md (this is what tunes the backend's start
  difficulty).
- **T4 — Drift check.** Script comparing each sibling repo's STATE.md claims (via
  raw.githubusercontent.com on branch `loop`) against reality checks it can make
  (deploy reachable, version timestamp fresh); writes docs/DRIFT.md. The relay's
  conscience.

## Contracts v1 (frozen; change only via clvi-architecture)

```
Challenge   { challengeId, salt, difficultyBits, expiresAt }
Submission  { challengeId, playerId, cellId, artifactId, nonce, hashes, ms, deviceClass }
AuditReport { rangeStart, rangeEnd, entryCount, totalEstKwh, chainOk, tokenCount, signature }
Solve rule: sha256(salt + ":" + nonce + ":" + playerId) leading zero bits >= difficultyBits.
```

## Definition of done for this run

T1–T2 on the `loop` deploy: the checklist lives on your phone, and the smoke suite
passes (or honestly reports which siblings aren't live yet) from `node --test`.
