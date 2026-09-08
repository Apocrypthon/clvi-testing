/**
 * T3's bench logic.
 *
 * The load-bearing test in this file is "the solver's preimage is the frozen
 * rule". The solver hashes out of a hand-packed reusable byte buffer for speed,
 * which is exactly the kind of optimisation that silently hashes the wrong
 * bytes — and a bench measuring the wrong preimage would still produce
 * confident, plausible, useless numbers.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  BACKEND_CLAMP,
  type BenchReport,
  TARGET_WINDOW_MS,
  createSolver,
  formatBenchMarkdown,
  formatNonce,
  hashesPerSecond,
  median,
  recommendDifficulty,
  runBench,
  summarizeDifficulty,
} from "../src/lib/bench.ts";
import { leadingZeroBits, medianSolveMs, preimage } from "../src/lib/pow.ts";

const nodeDigest = (input: string): Uint8Array => new Uint8Array(createHash("sha256").update(input, "utf8").digest());

describe("formatNonce", () => {
  it("is fixed width so the preimage length never changes", () => {
    assert.equal(formatNonce(0), "00000000");
    assert.equal(formatNonce(47), "0000002f");
    assert.equal(formatNonce(0xdeadbeef), "deadbeef");
  });
});

describe("createSolver", () => {
  const salt = "00112233445566778899aabbccddeeff";
  const playerId = "demo-player-1";

  it("produces a nonce that satisfies the frozen rule, recomputed independently", () => {
    // The whole point: rebuild the preimage as a plain string, hash it with
    // node:crypto, and confirm the solver's hand-packed buffer meant the same
    // thing. If the buffer packing is wrong, this fails.
    for (const difficultyBits of [8, 10, 12]) {
      const solver = createSolver({ salt, playerId, difficultyBits });
      const result = solver.step(2_000_000);
      assert.notEqual(result.nonce, null, `no solve found at ${difficultyBits} bits`);
      const digest = nodeDigest(preimage(salt, result.nonce!, playerId));
      assert.ok(
        leadingZeroBits(digest) >= difficultyBits,
        `nonce ${result.nonce} gives ${leadingZeroBits(digest)} bits, needed ${difficultyBits}`,
      );
    }
  });

  it("handles a multi-byte UTF-8 playerId without shifting the buffer", () => {
    const unicodePlayer = "pilóto-ñandú";
    const solver = createSolver({ salt, playerId: unicodePlayer, difficultyBits: 8 });
    const result = solver.step(500_000);
    assert.notEqual(result.nonce, null);
    const digest = nodeDigest(preimage(salt, result.nonce!, unicodePlayer));
    assert.ok(leadingZeroBits(digest) >= 8);
  });

  it("resumes across chunks and lands on the same nonce as one long run", () => {
    const once = createSolver({ salt, playerId, difficultyBits: 12 }).step(2_000_000);

    const chunked = createSolver({ salt, playerId, difficultyBits: 12 });
    let found: string | null = null;
    let guard = 0;
    while (found === null && guard++ < 10_000) found = chunked.step(97).nonce;

    assert.equal(found, once.nonce, "chunking must not change the answer");
    assert.equal(chunked.total, once.hashes, "nor the hash count");
  });

  it("counts hashes honestly, including the winning one", () => {
    // A fake digest that only clears the bar on the fourth nonce.
    let calls = 0;
    const digest = (): number => (++calls === 4 ? 0 : 0xffffffff);
    const solver = createSolver({ salt, playerId, difficultyBits: 8, digest });
    const result = solver.step(100);
    assert.equal(result.hashes, 4);
    assert.equal(solver.total, 4);
    assert.equal(result.nonce, formatNonce(3));
  });

  it("reports no nonce and a full budget when it runs out", () => {
    const digest = (): number => 0xffffffff;
    const solver = createSolver({ salt, playerId, difficultyBits: 32, digest });
    assert.deepEqual(solver.step(50), { hashes: 50, nonce: null });
    assert.deepEqual(solver.step(25), { hashes: 25, nonce: null });
    assert.equal(solver.total, 75, "total accumulates across steps");
  });

  it("starts where it is told", () => {
    const digest = (): number => 0;
    const solver = createSolver({ salt, playerId, difficultyBits: 1, digest, startNonce: 4095 });
    assert.equal(solver.step(1).nonce, "00000fff");
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([7]), 7);
    assert.equal(median([]), null);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    assert.deepEqual(values, [3, 1, 2]);
  });
});

describe("hashesPerSecond", () => {
  it("converts", () => {
    assert.equal(hashesPerSecond(500_000, 1_000), 500_000);
    assert.equal(hashesPerSecond(250, 500), 500);
  });

  it("returns 0 rather than Infinity on a zero-length measurement", () => {
    assert.equal(hashesPerSecond(100, 0), 0);
    assert.equal(hashesPerSecond(100, -1), 0);
  });
});

describe("summarizeDifficulty", () => {
  it("projects from the measured rate and reports what was observed", () => {
    const result = summarizeDifficulty({
      difficultyBits: 16,
      hashes: 300_000,
      ms: 1_000,
      samples: [180, 220, 200],
      truncated: false,
    });
    assert.equal(result.hashesPerSecond, 300_000);
    assert.equal(result.observedMedianMs, 200);
    assert.equal(Math.round(result.projectedMedianMs), Math.round(medianSolveMs(16, 300_000)));
    assert.equal(result.truncated, false);
  });

  it("reports a null observed median when nothing completed", () => {
    const result = summarizeDifficulty({ difficultyBits: 18, hashes: 10, ms: 5, samples: [], truncated: true });
    assert.equal(result.observedMedianMs, null);
    assert.equal(result.truncated, true);
  });
});

describe("recommendDifficulty", () => {
  it("picks a difficulty whose projected median sits in the 3-8 s window", () => {
    // ~50k h/s: 18 bits -> 3.6 s, which is inside the window.
    const recommendation = recommendDifficulty(50_000);
    assert.ok(recommendation.fits.includes(18), JSON.stringify(recommendation));
    assert.equal(recommendation.best, 18);
    const ms = recommendation.bestMedianMs!;
    assert.ok(ms >= TARGET_WINDOW_MS.low && ms <= TARGET_WINDOW_MS.high, `${ms} ms outside the window`);
  });

  it("says so when the device is too fast for any allowed difficulty", () => {
    const recommendation = recommendDifficulty(1e12);
    assert.equal(recommendation.best, null);
    assert.deepEqual(recommendation.fits, []);
    assert.match(recommendation.note, /too fast/);
  });

  it("says so when the device is too slow for any allowed difficulty", () => {
    const recommendation = recommendDifficulty(0.05);
    assert.equal(recommendation.best, null);
    assert.match(recommendation.note, /too slow/);
  });

  it("says so when the window falls between two integer difficulties", () => {
    // Each bit doubles the work, so a window narrower than 2x can straddle a
    // gap. At 62,656 h/s: 18 bits is 2900 ms (just under) and 19 is 5800 ms
    // (well over), so nothing lands in [3000, 3100].
    const narrow = { low: 3_000, high: 3_100 };
    const recommendation = recommendDifficulty(62_656, narrow);
    assert.equal(recommendation.best, null);
    assert.match(recommendation.note, /between two integer difficulties/);
  });

  it("never recommends outside the backend's clamp", () => {
    for (const rate of [1, 100, 5_000, 250_000, 5e6, 5e7]) {
      const { best } = recommendDifficulty(rate);
      if (best !== null) {
        assert.ok(best >= BACKEND_CLAMP.min && best <= BACKEND_CLAMP.max, `${best} outside the clamp at ${rate} h/s`);
      }
    }
  });

  it("returns nothing for a zero rate rather than dividing by it", () => {
    assert.equal(recommendDifficulty(0).best, null);
    assert.match(recommendDifficulty(0).note, /no rate measured/);
  });

  it("prefers the fit nearest the middle of the window", () => {
    // At this rate two difficulties fit; the closer to the geometric middle wins.
    const recommendation = recommendDifficulty(30_000);
    if (recommendation.fits.length > 1) {
      assert.ok(recommendation.fits.includes(recommendation.best!));
      for (const bits of recommendation.fits) {
        const middle = Math.sqrt(TARGET_WINDOW_MS.low * TARGET_WINDOW_MS.high);
        const dBest = Math.abs(Math.log(medianSolveMs(recommendation.best!, 30_000) / middle));
        const dOther = Math.abs(Math.log(medianSolveMs(bits, 30_000) / middle));
        assert.ok(dBest <= dOther + 1e-12, `${bits} is closer to the middle than ${recommendation.best}`);
      }
    }
  });
});

describe("formatBenchMarkdown", () => {
  const report = (over: Partial<BenchReport> = {}): BenchReport => ({
    at: "2026-09-03T14:00:00.000Z",
    device: "iPhone 13 · iOS 18.2 · Safari",
    buildTime: "2026-09-03T13:50:00.000Z",
    engine: "pure-JS sha256",
    subtleHashesPerSecond: 22_000,
    results: [
      summarizeDifficulty({ difficultyBits: 14, hashes: 120_000, ms: 1_000, samples: [30, 40], truncated: false }),
      summarizeDifficulty({ difficultyBits: 18, hashes: 120_000, ms: 1_000, samples: [], truncated: true }),
    ],
    recommendation: recommendDifficulty(120_000),
    ...over,
  });

  it("names the device and the date — a rate without them is a rumour", () => {
    const markdown = formatBenchMarkdown(report());
    assert.match(markdown, /iPhone 13 · iOS 18\.2 · Safari/);
    assert.match(markdown, /2026-09-03T14:00:00\.000Z/);
    assert.match(markdown, /bench build 2026-09-03T13:50:00\.000Z/);
  });

  it("shouts when the device was not recorded", () => {
    assert.match(formatBenchMarkdown(report({ device: "   " })), /UNRECORDED DEVICE/);
  });

  it("renders one table row per difficulty", () => {
    const markdown = formatBenchMarkdown(report());
    assert.match(markdown, /\| 14 \| 120,000 h\/s \|/);
    assert.match(markdown, /\| 18 \|/);
  });

  it("marks a truncated run and an absent observed median", () => {
    const markdown = formatBenchMarkdown(report());
    const row = markdown.split("\n").find((line) => line.startsWith("| 18 "))!;
    assert.match(row, /—/, "no observed median to report");
    assert.match(row, /0\+/, "the + says the budget ran out mid-solve");
  });

  it("includes the subtle.digest comparison when it was measured", () => {
    assert.match(formatBenchMarkdown(report()), /crypto\.subtle\.digest`? for comparison: 22,000 h\/s/);
    assert.doesNotMatch(formatBenchMarkdown(report({ subtleHashesPerSecond: null })), /for comparison/);
  });

  it("states the recommendation, or that there is none and why", () => {
    assert.match(formatBenchMarkdown(report()), /\*\*Recommended `difficultyBits`: \d+\*\*/);
    const tooFast = formatBenchMarkdown(report({ recommendation: recommendDifficulty(1e12) }));
    assert.match(tooFast, /No difficulty fits the 3-8 s window/);
    assert.match(tooFast, /too fast/);
  });
});

describe("runBench", () => {
  /**
   * A fake machine: every hash costs exactly 1/rate ms on a fake clock, and
   * every Kth hash solves. That makes the runner's arithmetic checkable to the
   * digit, which a real timing test never could be.
   */
  function machine(options: { hashesPerMs: number; hashesPerSolve: number }) {
    let clock = 0;
    let calls = 0;
    return {
      now: (): number => clock,
      calls: (): number => calls,
      digest: (): number => {
        calls++;
        clock += 1 / options.hashesPerMs;
        return calls % options.hashesPerSolve === 0 ? 0 : 0xffffffff;
      },
    };
  }

  it("measures the rate of the machine it ran on", async () => {
    const fake = machine({ hashesPerMs: 500, hashesPerSolve: 1_000 });
    const [result] = await runBench(
      { difficulties: [14], playerId: "p", budgetMsPerDifficulty: 100, maxSamples: 10 },
      { now: fake.now, digest: fake.digest, makeSalt: () => "00ff", startingChunk: 250 },
    );
    assert.ok(result !== undefined);
    // 10 solves x 1000 hashes at 500 hashes/ms = 20 ms of work.
    assert.equal(result.samples.length, 10, "maxSamples reached");
    assert.equal(result.hashes, 10_000);
    assert.equal(Math.round(result.hashesPerSecond), 500_000);
    // Tolerance, not equality: the clock accumulates 1000 additions of 0.002.
    assert.ok(
      Math.abs(result.observedMedianMs! - 2) < 1e-6,
      `1000 hashes at 500/ms is 2 ms per solve, got ${result.observedMedianMs}`,
    );
    assert.equal(result.truncated, false);
  });

  it("stops at the time budget and marks the unfinished attempt truncated", async () => {
    const fake = machine({ hashesPerMs: 100, hashesPerSolve: 100_000 });
    const [result] = await runBench(
      { difficulties: [18], playerId: "p", budgetMsPerDifficulty: 50, maxSamples: 10 },
      { now: fake.now, digest: fake.digest, makeSalt: () => "00ff", startingChunk: 500 },
    );
    assert.ok(result !== undefined);
    assert.equal(result.samples.length, 0, "no solve completed inside the budget");
    assert.equal(result.observedMedianMs, null);
    assert.equal(result.truncated, true, "the caller must know the budget cut it short");
    // The hashes really were performed, so they still count toward the rate.
    assert.ok(result.hashes > 0);
    assert.equal(Math.round(result.hashesPerSecond), 100_000);
    // …and the projection still works, which is the point of measuring a rate
    // rather than only timing whole solves.
    assert.ok(result.projectedMedianMs > 0 && Number.isFinite(result.projectedMedianMs));
  });

  it("issues a fresh salt per solve, as the backend does", async () => {
    const fake = machine({ hashesPerMs: 500, hashesPerSolve: 100 });
    const salts: string[] = [];
    await runBench(
      { difficulties: [12], playerId: "p", budgetMsPerDifficulty: 1_000, maxSamples: 6 },
      {
        now: fake.now,
        digest: fake.digest,
        startingChunk: 50,
        makeSalt: () => {
          const salt = `salt-${salts.length}`;
          salts.push(salt);
          return salt;
        },
      },
    );
    assert.equal(salts.length, 6, "one salt per solve, not one for the whole run");
    assert.equal(new Set(salts).size, 6);
  });

  it("runs every requested difficulty, in order", async () => {
    const fake = machine({ hashesPerMs: 500, hashesPerSolve: 200 });
    const results = await runBench(
      { difficulties: [14, 16, 18], playerId: "p", budgetMsPerDifficulty: 20, maxSamples: 3 },
      { now: fake.now, digest: fake.digest, makeSalt: () => "00ff", startingChunk: 100 },
    );
    assert.deepEqual(results.map((r) => r.difficultyBits), [14, 16, 18]);
    for (const result of results) assert.ok(result.hashesPerSecond > 0);
  });

  it("reports progress as it goes", async () => {
    const fake = machine({ hashesPerMs: 500, hashesPerSolve: 5_000 });
    const seen: number[] = [];
    await runBench(
      { difficulties: [16], playerId: "p", budgetMsPerDifficulty: 60, maxSamples: 2 },
      {
        now: fake.now,
        digest: fake.digest,
        makeSalt: () => "00ff",
        startingChunk: 500,
        onProgress: (progress) => {
          seen.push(progress.hashes);
          assert.ok(progress.fraction >= 0 && progress.fraction <= 1, `fraction ${progress.fraction}`);
          assert.equal(progress.difficultyBits, 16);
        },
      },
    );
    assert.ok(seen.length > 1, "progress must fire more than once during a long solve");
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i]! >= seen[i - 1]!, "hashes must not go backwards");
  });

  it("stops when cancelled", async () => {
    const fake = machine({ hashesPerMs: 500, hashesPerSolve: 1_000_000 });
    let chunks = 0;
    const [result] = await runBench(
      { difficulties: [20], playerId: "p", budgetMsPerDifficulty: 1e9, maxSamples: 100 },
      {
        now: fake.now,
        digest: fake.digest,
        makeSalt: () => "00ff",
        startingChunk: 100,
        cancelled: () => ++chunks > 3,
      },
    );
    assert.ok(result !== undefined);
    assert.equal(result.samples.length, 0);
    assert.ok(fake.calls() < 1_000_000, "cancelling must not wait for the solve to finish");
  });

  it("breathes between chunks so a main-thread fallback stays responsive", async () => {
    const fake = machine({ hashesPerMs: 500, hashesPerSolve: 4_000 });
    let breaths = 0;
    await runBench(
      { difficulties: [14], playerId: "p", budgetMsPerDifficulty: 40, maxSamples: 2 },
      {
        now: fake.now,
        digest: fake.digest,
        makeSalt: () => "00ff",
        startingChunk: 500,
        breathe: () => {
          breaths++;
        },
      },
    );
    assert.ok(breaths > 0, "the runner must yield between chunks");
  });
});

describe("runBench chunk sizing", () => {
  /**
   * Regression: the chunk size is re-aimed from the hashes actually performed,
   * not from the chunk's budget. Scaling from the budget inflates the chunk
   * every time a solve ends early, it pins to the cap within a few solves, and
   * then one chunk runs for seconds past the deadline. The visible symptom was
   * an 18-bit run collecting 4 samples instead of 10 and reporting an observed
   * median 3.5x its projection.
   */
  it("keeps a single chunk from overrunning the time budget", async () => {
    let clock = 0;
    let calls = 0;
    let solves = 0;
    const hashesPerMs = 500;
    // Solves three times quickly — enough to inflate the chunk under the bug —
    // then never again, so the final attempt runs until the deadline stops it.
    const digest = (): number => {
      calls++;
      clock += 1 / hashesPerMs;
      if (solves < 3 && calls % 200 === 0) {
        solves++;
        return 0;
      }
      return 0xffffffff;
    };

    const budget = 100;
    const [result] = await runBench(
      { difficulties: [18], playerId: "p", budgetMsPerDifficulty: budget, maxSamples: 50 },
      { now: () => clock, digest, makeSalt: () => "00ff", startingChunk: 100 },
    );

    assert.ok(result !== undefined);
    assert.equal(result.truncated, true, "the unsolvable attempt should be cut off by the budget");
    // One chunk targets ~40 ms, so the overshoot past the budget is bounded by
    // roughly that. Under the bug this was several thousand ms.
    assert.ok(
      result.ms < budget + 150,
      `overran the ${budget} ms budget by ${(result.ms - budget).toFixed(0)} ms — the chunk is not being re-aimed`,
    );
  });

  it("still collects the samples the budget allows once chunks are sized right", async () => {
    let clock = 0;
    let calls = 0;
    const hashesPerMs = 500;
    const digest = (): number => {
      calls++;
      clock += 1 / hashesPerMs;
      return calls % 2_000 === 0 ? 0 : 0xffffffff;
    };
    // 2000 hashes per solve at 500/ms is 4 ms; a 200 ms budget should fit ~50.
    const [result] = await runBench(
      { difficulties: [18], playerId: "p", budgetMsPerDifficulty: 200, maxSamples: 100 },
      { now: () => clock, digest, makeSalt: () => "00ff", startingChunk: 100 },
    );
    assert.ok(result !== undefined);
    assert.ok(result.samples.length >= 40, `expected ~50 solves in the budget, got ${result.samples.length}`);
  });
});
