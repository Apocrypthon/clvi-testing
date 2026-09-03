# VISION — what clvi-testing is for

STRATA is a browser MMO-tycoon set in Paradise, NV. Players dig cells, solve a
hash puzzle, and mint a Guardian token whose energy cost is recorded in an
append-only ledger that publishes signed self-audits.

Five repos build it. **This one builds none of it.** It is the proof.

## The one job

Answer, with evidence, three questions the other repos cannot answer about
themselves:

1. **Does it feel right on the phone?** STRATA is played on an iPhone in Safari,
   one-handed. The seven-item acceptance checklist is the definition of "shippable"
   and it is a *human* test — a person, a phone, a stopwatch. This repo's job is to
   make running it take two minutes instead of twenty, and to keep the results.
2. **Do the deploys honour Contracts v1?** Not "did the unit tests pass in CI" —
   whether the thing on the internet returns the shape it promised. That is
   `tests/smoke.test.ts`, pointed at a real base URL.
3. **Is the puzzle tuned?** Item 5 says a solve must land in 3–8 s. That is a
   claim about hash rate on a phone, and it is measurable. T3's bench measures it
   so the backend's start difficulty is chosen from data rather than from a guess.

## The standard this repo is held to

Everything here is about not lying, including to ourselves.

- **A skip is not a pass.** If a sibling is not deployed, the suite says so, by
  name, with the URL it tried.
- **"I could not check" is not "it failed".** An unreachable host and a broken
  deploy are different findings. Conflating them puts a fabricated verdict into
  the relay's memory, and the other repos read that memory.
- **Recorded transcripts, not claims.** "chainOk true" is worth nothing without
  the command that produced it and the date it ran.
- **The tests must not corrupt the evidence.** The ledger is append-only and is
  the product's whole argument. Smoke tests do not mint without an explicit
  opt-in.

## What this repo is not

- Not a load tester. (The old README said "Load Testing + Security"; that is not
  what the seed asks for and nothing here does it.)
- Not a CI system. It is a set of things a person or a harness runs deliberately.
- Not a place for secrets. Base URLs come from the environment; nothing is
  committed.

## Why the acceptance list is seven human items

Every one of them is something automation would score wrong. "Smooth and cool" is
a wrist against the back of a phone. "Nothing hover-only" is a thumb, not a
cursor. "Reads as fake under 3 s" is a judgement about whether work *feels* like
work. The checklist's value is that it refuses to be automated — so the tooling's
job is to make the human pass fast, repeatable, and recorded, not to replace it.
