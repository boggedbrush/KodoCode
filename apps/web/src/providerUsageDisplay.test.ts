import { describe, expect, it } from "vitest";

import {
  clampUsagePercentUsed,
  selectPrimaryUsageWindows,
  toRemainingUsagePercent,
} from "./providerUsageDisplay";

describe("providerUsageDisplay", () => {
  it("clamps percent-used values into the 0-100 range", () => {
    expect(clampUsagePercentUsed(null)).toBeNull();
    expect(clampUsagePercentUsed(Number.NaN)).toBeNull();
    expect(clampUsagePercentUsed(-5)).toBe(0);
    expect(clampUsagePercentUsed(42.2)).toBe(42.2);
    expect(clampUsagePercentUsed(130)).toBe(100);
  });

  it("derives remaining percent from used percent", () => {
    expect(toRemainingUsagePercent(null)).toBeNull();
    expect(toRemainingUsagePercent(0)).toBe(100);
    expect(toRemainingUsagePercent(65)).toBe(35);
    expect(toRemainingUsagePercent(140)).toBe(0);
  });

  it("selects session and weekly windows by preferred labels with fallback", () => {
    const windows = [
      { key: "weekly", label: "Weekly", percentUsed: 55, resetAt: null },
      { key: "session", label: "5 hour", percentUsed: 25, resetAt: null },
    ];

    const selected = selectPrimaryUsageWindows({
      windows,
      sessionLabel: "Session",
      weeklyLabel: "Weekly",
    });

    expect(selected.sessionWindow?.key).toBe("session");
    expect(selected.weeklyWindow?.key).toBe("weekly");
  });
});
