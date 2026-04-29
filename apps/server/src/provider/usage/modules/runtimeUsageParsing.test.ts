import { describe, expect, it } from "vitest";

import { parseClaudeCliUsageOutput } from "./claudeUsageModule";
import { parseRateLimitWindows } from "./runtimeUsageParsing";

describe("parseRateLimitWindows", () => {
  it("parses Codex RPC primary and secondary windows", () => {
    const parsed = parseRateLimitWindows({
      payload: {
        rateLimits: {
          primary: {
            usedPercent: 2,
            windowDurationMins: 300,
            resetsAt: 1777436280,
          },
          secondary: {
            usedPercent: 42,
            windowDurationMins: 10080,
            resetsAt: 1777856400,
          },
        },
      },
      sessionLabel: "Session",
      weeklyLabel: "Weekly",
      keyPrefix: "codex-rate-limit",
    });

    expect(parsed?.state).toBe("ready");
    expect(parsed?.windows).toEqual([
      {
        key: "codex-rate-limit-session",
        label: "Session",
        percentUsed: 2,
        resetAt: "2026-04-29T04:18:00.000Z",
      },
      {
        key: "codex-rate-limit-weekly",
        label: "Weekly",
        percentUsed: 42,
        resetAt: "2026-05-04T01:00:00.000Z",
      },
    ]);
  });

  it("parses Claude OAuth five_hour and seven_day windows", () => {
    const parsed = parseRateLimitWindows({
      payload: {
        five_hour: {
          used_percent: 12,
          reset_at: "2026-04-29T04:18:00.000Z",
        },
        seven_day: {
          used_percent: 33,
          reset_at: "2026-05-03T04:18:00.000Z",
        },
        seven_day_opus: {
          used_percent: 75,
          reset_at: "2026-05-03T04:18:00.000Z",
        },
      },
      sessionLabel: "Session",
      weeklyLabel: "Weekly",
      keyPrefix: "claude-oauth",
    });

    expect(parsed?.state).toBe("ready");
    expect(parsed?.windows).toEqual([
      {
        key: "claude-oauth-session",
        label: "Session",
        percentUsed: 12,
        resetAt: "2026-04-29T04:18:00.000Z",
      },
      {
        key: "claude-oauth-weekly",
        label: "Weekly",
        percentUsed: 33,
        resetAt: "2026-05-03T04:18:00.000Z",
      },
    ]);
  });
});

describe("parseClaudeCliUsageOutput", () => {
  it("parses Claude CLI session and weekly usage windows", () => {
    const parsed = parseClaudeCliUsageOutput(
      [
        "\u001B[1mCurrent session\u001B[22m",
        "\u001B[48;5;102m                                                  \u001B[49m0% used",
        "\u001B[38;5;246mResets 1m (America/New_York)",
        "\u001B[1mCurrent week (all models)",
        "\u001B[48;5;102m                                                  \u001B[49m12% used",
        "\u001B[38;5;246mResets May 2 at 7am (America/New_York)",
      ].join("\n"),
      new Date("2026-04-29T00:00:00.000Z"),
    );

    expect(parsed).toEqual([
      {
        key: "claude-cli-session",
        label: "Session",
        percentUsed: 0,
        resetAt: "2026-04-29T00:01:00.000Z",
      },
      {
        key: "claude-cli-weekly",
        label: "Weekly",
        percentUsed: 12,
        resetAt: "2026-05-02T11:00:00.000Z",
      },
    ]);
  });
});
