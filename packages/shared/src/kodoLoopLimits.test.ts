import { describe, expect, it } from "@effect/vitest";
import type { ServerProviderUsageLimits } from "@t3tools/contracts";

import {
  fullestKodoLimitWindow,
  observedKodoLimitChange,
  readKodoLimitWindows,
} from "./kodoLoopLimits.ts";

const NOW = Date.parse("2026-06-01T12:00:00.000Z");
const minutesAgo = (mins: number) => new Date(NOW - mins * 60_000).toISOString();
const inMinutes = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

const limits = (over: Partial<ServerProviderUsageLimits> = {}): ServerProviderUsageLimits => ({
  checkedAt: minutesAgo(2),
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
  const ok = (session: number, extra: Array<[string, number]> = []) =>
    readKodoLimitWindows(
      limits({
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

  it("lists each window reported both times", () => {
    expect(observedKodoLimitChange(ok(40, [["weekly", 5]]), ok(46))).toEqual([
      { window: "5-hour", before: 40, after: 46 },
    ]);
  });

  it("says nothing when either reading cannot be used", () => {
    expect(observedKodoLimitChange({ state: "stale" }, ok(46))).toEqual([]);
    expect(observedKodoLimitChange(ok(40), { state: "missing" })).toEqual([]);
  });
});
