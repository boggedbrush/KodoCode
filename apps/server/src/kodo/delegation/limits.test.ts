import { describe, expect, it } from "@effect/vitest";
import { KODO_SUB_AGENTS_MAX_WORKERS_PER_TURN } from "@t3tools/contracts";

import { kodoMaxWorkers, kodoWorkerCapRefusal, kodoWorkerLimitRefusal } from "./limits.ts";

describe("the live-worker cap setting", () => {
  it.each([
    [undefined, 3],
    ["many", 3],
    [Number.NaN, 3],
    [0, 1],
    [2.9, 2],
    [6, 6],
    [99, 6],
  ])("reads %s as %s", (setting, expected) => {
    expect(kodoMaxWorkers(setting)).toBe(expected);
  });
});

describe("the caps on a lead's workers", () => {
  it("allows a worker up to the live cap and refuses the one after it", () => {
    expect(
      kodoWorkerCapRefusal({ counts: { live: 2, thisTurn: 2 }, maxWorkers: 3 }),
    ).toBeUndefined();
    expect(kodoWorkerCapRefusal({ counts: { live: 3, thisTurn: 3 }, maxWorkers: 3 })).toMatch(
      /3 of 3 workers/,
    );
  });
  it("counts a batch against the cap as a whole", () => {
    expect(
      kodoWorkerCapRefusal({ counts: { live: 1, thisTurn: 1 }, maxWorkers: 3, adding: 2 }),
    ).toBeUndefined();
    expect(
      kodoWorkerCapRefusal({ counts: { live: 1, thisTurn: 1 }, maxWorkers: 3, adding: 3 }),
    ).toMatch(/3 more/);
  });
  it("stops a turn at eight workers however many are live", () => {
    const perTurn = KODO_SUB_AGENTS_MAX_WORKERS_PER_TURN;
    expect(perTurn).toBe(8);
    expect(
      kodoWorkerCapRefusal({ counts: { live: 0, thisTurn: 7 }, maxWorkers: 6 }),
    ).toBeUndefined();
    expect(kodoWorkerCapRefusal({ counts: { live: 0, thisTurn: 8 }, maxWorkers: 6 })).toMatch(
      /8 is the most/,
    );
  });
});

describe("the usage-limit refusal", () => {
  const input = { provider: "Claude", window: "5-hour", stopAtPercent: 90 };
  it("passes below the threshold and refuses at it, naming the provider and the window", () => {
    expect(kodoWorkerLimitRefusal({ ...input, percent: 89.9 })).toBeUndefined();
    expect(kodoWorkerLimitRefusal({ ...input, percent: 90 })).toMatch(
      /5-hour usage limit of Claude is at 90%/,
    );
  });
});
