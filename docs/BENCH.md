# BENCH — measured solve times

What `difficultyBits` should the backend start players at?

Item 5 of the acceptance checklist says a dig must solve in **3–8 s**: under 3 s
the work reads as fake, over 8 s it reads as broken. That is a claim about how
fast a phone can compute SHA-256, so it is measurable. `bench.html` measures it
and recommends a difficulty. This file is where the results are kept.

## How to add a result

1. Open the deployed **`/bench.html`** on the device. Not a simulator, not a
   laptop pretending — the number is only about the device it ran on.
2. Type the device into the Device field. Model, iOS version, browser.
3. Pick a budget (6 s is a good default) and tap **Run bench**.
4. Tap **Copy for docs/BENCH.md** and paste the block into "Results" below,
   newest first.

Do not hand-edit the numbers, and do not average across devices. A slow phone
is not an outlier to be smoothed away; it is the phone that decides whether
STRATA is playable.

## How to read a row

| column | means |
| --- | --- |
| `hashes/sec` | raw throughput measured over every hash performed at that difficulty, including an unfinished solve |
| `projected median` | `ln2 · 2^bits / rate` — what a player should typically wait |
| `observed median` | the median of the solves that actually completed |
| `solves` | how many completed. A trailing `+` means the budget cut off one more attempt |

`projected` is the number to trust. `observed` is a check on it, and with only a
handful of samples it will scatter — solve times are geometrically distributed,
so a median from 12 samples still carries roughly ±30 %. If the two disagree by
much more than that, something is wrong with the bench, not with the phone.

## Why the solve loop does not use `crypto.subtle.digest`

The obvious implementation is WebCrypto. It is too slow, not because the hash is
slow but because it is **async**: a solve needs one digest per nonce, serially,
and a promise per hash costs far more than a SHA-256 block. Measured while
building T3:

| approach | rate | median at 18 bits |
| --- | ---: | ---: |
| `node:crypto` `createHash`, sync | ~206,000 h/s | 0.9 s |
| `crypto.subtle.digest`, awaited serially | ~16,000 h/s | 11.3 s |
| `crypto.subtle.digest`, batched 500 at a time | ~27,000 h/s | 6.8 s |
| `src/lib/sha256.ts`, sync, in a Worker | ~950,000 h/s | 0.2 s |

So the client hashes synchronously in a Worker, and the bench measures that.
Every run also measures `subtle.digest` on the same device and prints the ratio,
so this stays a measurement rather than a piece of folklore.

The Worker is not optional either: a solve at 18 bits is hundreds of thousands of
hashes, and item 2 of the checklist wants the title pan smooth for 30 s. Those
cannot both be true on one thread.

## Results

Newest first.

### Verification Chromium · 390×844 · 2026-09-08T12:52:34.488Z

**This is not a phone.** It is the headless Chromium that `scripts/verify-page.mjs`
drives on a cloud runner, recorded because it is a real measurement and because a
desktop-class upper bound is genuinely useful — but it must not be used to tune
the backend. It is here to be replaced by an iPhone.

Engine: pure-JS sha256, Worker · bench build 2026-09-08T12:52:24.853Z
`crypto.subtle.digest` for comparison: 133,279 h/s

| bits | hashes/sec | projected median | observed median | solves |
| ---: | ---: | ---: | ---: | ---: |
| 14 | 725,212 h/s | 16 ms | 10 ms | 12 |
| 16 | 987,781 h/s | 46 ms | 39 ms | 12 |
| 18 | 948,773 h/s | 192 ms | 137 ms | 12 |

**Recommended `difficultyBits`: 23** (projected median 6.2 s; 22, 23 all fit the 3-8 s window)

> The 14-bit row measures slower than the other two because `maxSamples` stops it
> after ~200 ms, which is mostly JIT warm-up. The recommendation pools every hash
> from the whole run rather than trusting one difficulty's slice.

## What this already suggests, and what it does not

**The open question for clvi-architecture and clvi-backend:** the backend
currently issues `difficultyBits: 18`. On the only device measured so far, 18
bits solves in **0.19 s** — two orders of magnitude under item 5's 3 s floor,
squarely in "the work reads as fake" territory. Even allowing a phone to be 5–10×
slower than this runner, 18 bits lands somewhere near 1–2 s, still under the
floor.

**What would settle it:** one run of this bench on an actual iPhone. Until that
exists, nothing here justifies changing the backend's default — a desktop
headless browser is not evidence about a phone, and this file will not pretend
otherwise. The recommendation of 23 is what *this runner* needs, and is recorded
as such.
