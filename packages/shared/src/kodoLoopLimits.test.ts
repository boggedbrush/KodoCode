import { describe, expect, it } from "@effect/vitest";
import type { ServerProviderUsageLimits } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  KODO_LIMIT_MAX_AGE_MS,
  fullestKodoLimitWindow,
  observedKodoLimitChange,
  readKodoLimitWindows,
} from "./kodoLoopLimits.ts";

const NOW = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-06-01T12:00:00.000Z"));
const at = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const minutesAgo = (mins: number) => at(NOW - mins * 60_000);
const inMinutes = (mins: number) => at(NOW + mins * 60_000);

const limits = (over: Partial<ServerProviderUsageLimits> = {}): ServerProviderUsageLimits => ({
  checkedAt: minutesAgo(1),
  windows: [
    {
      id: "session",
      kind: "session",
      label: "Session",
      usedPercent: 92,
      windowDurationMins: 300,
      resetsAt: inMinutes(60),
    },
    { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 40, windowDurationMins: 10_080 },
  ],
  ...over,
});

describe("reading limit windows", () => {
  it("names windows by their length and finds the fullest", () => {
    const reading = readKodoLimitWindows(limits(), NOW);
    expect(reading).toEqual({
      state: "ok",
      checkedAtMs: NOW - 60_000,
      windows: [
        { id: "session", name: "5-hour", usedPercent: 92 },
        { id: "weekly", name: "weekly", usedPercent: 40 },
      ],
    });
    expect(fullestKodoLimitWindow(reading)?.name).toBe("5-hour");
  });

  it.each([
    ["no limits at all", undefined, "missing"],
    [
      "an unsupported provider",
      limits({ windows: [], unavailable: { reason: "unsupported" } }),
      "missing",
    ],
    ["no windows", limits({ windows: [] }), "missing"],
    [
      "a failed probe with nothing kept",
      limits({ windows: [], unavailable: { reason: "probeFailed" } }),
      "stale",
    ],
    ["a reading from long ago", limits({ checkedAt: minutesAgo(45) }), "stale"],
    ["a reading a little older than the bound", limits({ checkedAt: minutesAgo(3) }), "stale"],
    [
      "a failed probe over old windows",
      limits({ unavailable: { reason: "probeFailed" } }),
      "stale",
    ],
    [
      "windows that have all reset since",
      limits({
        windows: [
          { id: "s", kind: "session", label: "Session", usedPercent: 99, resetsAt: inMinutes(-1) },
        ],
      }),
      "stale",
    ],
  ] as const)("is %s: %s", (_name, input, state) => {
    expect(readKodoLimitWindows(input, NOW).state).toBe(state);
  });

  it("takes a reading at the freshness bound as fresh, and one just past it as stale", () => {
    expect(KODO_LIMIT_MAX_AGE_MS).toBe(2 * 60_000);
    const at = (age: number) => readKodoLimitWindows(limits({ checkedAt: minutesAgo(age / 60_000) }), NOW);
    expect(at(KODO_LIMIT_MAX_AGE_MS).state).toBe("ok");
    expect(at(KODO_LIMIT_MAX_AGE_MS + 1_000).state).toBe("stale");
  });

  it("tells two weekly windows apart by the scope in the provider's label", () => {
    const reading = readKodoLimitWindows(
      limits({
        windows: [
          { id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 40, windowDurationMins: 10_080 },
          {
            id: "seven_day_opus",
            kind: "weekly",
            label: "Weekly · Opus",
            usedPercent: 95,
            windowDurationMins: 10_080,
          },
        ],
      }),
      NOW,
    );
    expect(reading.state === "ok" && reading.windows.map((window) => window.name)).toEqual([
      "weekly",
      "weekly Opus",
    ]);
    expect(fullestKodoLimitWindow(reading)?.name).toBe("weekly Opus");
  });

  it("drops a window that has reset but keeps the live ones", () => {
    const reading = readKodoLimitWindows(
      limits({
        windows: [
          {
            id: "old",
            kind: "session",
            label: "Session",
            usedPercent: 99,
            resetsAt: inMinutes(-5),
          },
          { id: "weekly", kind: "weekly", label: "Weekly", usedPercent: 10 },
        ],
      }),
      NOW,
    );
    expect(reading.state === "ok" && reading.windows.map((window) => window.id)).toEqual([
      "weekly",
    ]);
  });
});

describe("the change seen around a stage", () => {
  const ok = (session: number, extra: Array<[string, number]> = [], checkedMinutesAgo = 1) =>
    readKodoLimitWindows(
      limits({
        checkedAt: minutesAgo(checkedMinutesAgo),
        windows: [
          {
            id: "session",
            kind: "session",
            label: "Session",
            usedPercent: session,
            windowDurationMins: 300,
          },
          ...extra.map(([id, usedPercent]) => ({
            id,
            kind: "weekly" as const,
            label: id,
            usedPercent,
          })),
        ],
      }),
      NOW,
    );

  it("lists each window reported both times, when the readings were taken at different times", () => {
    expect(observedKodoLimitChange(ok(40, [["weekly", 5]], 1.5), ok(46, [], 0.5))).toEqual([
      { window: "5-hour", before: 40, after: 46 },
    ]);
  });

  it("says nothing when both readings are the same reading, rather than show identical numbers", () => {
    expect(observedKodoLimitChange(ok(40), ok(40))).toEqual([]);
    expect(observedKodoLimitChange(ok(40, [], 1), ok(46, [], 1.5))).toEqual([]);
  });

  it("says nothing when either reading cannot be used", () => {
    expect(observedKodoLimitChange({ state: "stale" }, ok(46))).toEqual([]);
    expect(observedKodoLimitChange(ok(40), { state: "missing" })).toEqual([]);
  });
});
