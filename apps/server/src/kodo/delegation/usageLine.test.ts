import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import {
  formatKodoUsageLine,
  kodoCombinedSpend,
  kodoResetClock,
  kodoResetsIn,
  kodoResetWhen,
  kodoUsageStatus,
  type KodoUsageProviderReading,
} from "./usageLine.ts";

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const inMinutes = (mins: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW + mins * 60_000));

const ok = (name: string, windows: ReadonlyArray<[string, number, number?]>) =>
  ({
    instanceId: name.toLowerCase(),
    name,
    reading: {
      state: "ok",
      checkedAtMs: NOW - 30_000,
      windows: windows.map(([label, usedPercent, resetMins]) => ({
        id: label,
        name: label,
        usedPercent,
        ...(resetMins === undefined ? {} : { resetsAt: inMinutes(resetMins) }),
      })),
    },
  }) satisfies KodoUsageProviderReading;

describe("how long until a reset", () => {
  it.each([
    [inMinutes(0.4), "1m"],
    [inMinutes(0), undefined],
    [inMinutes(-5), undefined],
    [undefined, undefined],
    ["not a date", undefined],
    [inMinutes(12), "12m"],
    [inMinutes(130), "2h 10m"],
    [inMinutes(120), "2h"],
    [inMinutes(60 * 72), "3d"],
    [inMinutes(60 * 60), "2d 12h"],
    [inMinutes(60 * 60 + 59), "2d 12h"],
  ])("%s reads %s", (resetsAt, expected) => {
    expect(kodoResetsIn(resetsAt, NOW)).toBe(expected);
  });
  it("shows the clock time in UTC", () => {
    expect(kodoResetClock(inMinutes(130))).toBe("14:10 UTC");
    expect(kodoResetClock(undefined)).toBeUndefined();
  });
  it("adds the date when the reset is not today in UTC", () => {
    expect(kodoResetWhen(inMinutes(130), NOW)).toBe("at 14:10 UTC");
    expect(kodoResetWhen(inMinutes(60 * 60), NOW)).toBe("on 17 Nov at 00:00 UTC");
    expect(kodoResetWhen(inMinutes(13 * 60), NOW)).toBe("on 15 Nov at 01:00 UTC");
    expect(kodoResetWhen(undefined, NOW)).toBeUndefined();
  });
});

describe("the spend of a lead and its workers", () => {
  const side = (tokens: number, costUsd?: number, complete = true) => ({
    tokens,
    ...(costUsd === undefined ? {} : { costUsd }),
    complete,
  });
  it("adds both sides", () => {
    expect(
      kodoCombinedSpend({
        lead: side(1000, 0.5),
        workers: side(4000, 1.25),
        workerCount: 2,
        unreportedWorkers: 0,
      }),
    ).toEqual({
      tokens: 5000,
      costUsd: 1.75,
      complete: true,
      leadTokens: 1000,
      workerTokens: 4000,
      workers: 2,
    });
  });
  it("is a floor when a side has no price, a worker said nothing, or a turn was silent", () => {
    const base = { workerCount: 1, unreportedWorkers: 0 };
    expect(kodoCombinedSpend({ ...base, lead: side(10, 1), workers: side(10) })).toMatchObject({
      costUsd: 1,
      complete: false,
    });
    expect(
      kodoCombinedSpend({ ...base, lead: side(10, 1), workers: side(10, 1), unreportedWorkers: 1 })
        ?.complete,
    ).toBe(false);
    expect(
      kodoCombinedSpend({ ...base, lead: side(10, 1, false), workers: side(10, 1) })?.complete,
    ).toBe(false);
  });
  it("is nothing when nothing reported", () => {
    expect(kodoCombinedSpend({ workerCount: 0, unreportedWorkers: 0 })).toBeUndefined();
  });
});

describe("the usage line", () => {
  const spend = {
    tokens: 412_000,
    costUsd: 1.84,
    complete: true,
    leadTokens: 100_000,
    workerTokens: 312_000,
    workers: 3,
  };
  it("shows each provider's fullest windows with the reset, the spend and the stop-at percent", () => {
    const line = formatKodoUsageLine({
      providers: [
        ok("Claude", [
          ["weekly", 31, 4000],
          ["5-hour", 62, 130],
          ["opus", 5],
        ]),
      ],
      nowMs: NOW,
      spend,
      stopAtPercent: 90,
    });
    expect(line).toBe(
      "<kodo_usage>Usage limits (last reading): Claude: 5-hour 62% (resets in 2h 10m), weekly 31% (resets in 2d 18h). Spent in this conversation, you and workers: 412k tokens, about $1.84. Delegation is refused at 90%.</kodo_usage>",
    );
  });
  it("says unknown for a reading that is stale or missing, never a number", () => {
    const line = formatKodoUsageLine({
      providers: [
        { instanceId: "a", name: "Claude", reading: { state: "stale" } },
        { instanceId: "b", name: "Codex", reading: { state: "missing" } },
      ],
      nowMs: NOW,
      spend: undefined,
      stopAtPercent: 80,
    });
    expect(line).toContain("Claude: unknown; Codex: unknown");
    expect(line).not.toMatch(/\d+%\s*\(/);
    expect(line).toContain("none reported yet");
    expect(line).toContain("refused at 80%");
  });
  it("marks a spend that is a floor or has no price", () => {
    const floor = formatKodoUsageLine({
      providers: [],
      nowMs: NOW,
      spend: { ...spend, complete: false },
      stopAtPercent: 90,
    });
    expect(floor).toContain("at least 412k tokens, about at least $1.84");
    const { costUsd: _cost, ...noPrice } = spend;
    expect(
      formatKodoUsageLine({ providers: [], nowMs: NOW, spend: noPrice, stopAtPercent: 90 }),
    ).toContain("412k tokens, no price known");
  });
  it("stays short enough to ride with every message", () => {
    const line = formatKodoUsageLine({
      providers: [
        ok("Claude", [
          ["5-hour", 62, 130],
          ["weekly", 31, 4000],
        ]),
        ok("Codex", [
          ["5-hour", 12, 20],
          ["weekly", 8, 5000],
        ]),
      ],
      nowMs: NOW,
      spend,
      stopAtPercent: 90,
    });
    expect(line.length).toBeLessThan(420);
  });
});

describe("the usage status", () => {
  it("reports the age of a reading, reset minutes, and unknown for the rest", () => {
    const status = kodoUsageStatus({
      providers: [
        ok("Claude", [["5-hour", 61.6, 130]]),
        { instanceId: "b", name: "Codex", reading: { state: "stale" } },
      ],
      nowMs: NOW,
      spend: undefined,
      stopAtPercent: 90,
    });
    expect(status.providers[0]).toMatchObject({
      state: "ok",
      readAgeSeconds: 30,
      windows: [{ name: "5-hour", usedPercent: 62, resetsInMinutes: 130 }],
    });
    expect(status.providers[1]).toEqual({
      instanceId: "b",
      name: "Codex",
      state: "unknown",
      windows: [],
    });
    expect(status.stopAtPercent).toBe(90);
  });
});
