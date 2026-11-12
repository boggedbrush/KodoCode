import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUsageLimits,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectKodoUsageMeterEntries,
  formatKodoResetsIn,
  isKodoUsageSlashCommand,
  kodoPickerUsageHint,
  kodoUsageIsStale,
  kodoUsageLevel,
  parseKodoUsageSlashCommand,
  providersWithoutLimitData,
  summarizeProviderLimits,
} from "./usageMeter.logic";

const now = Date.parse("2026-09-03T12:00:00.000Z");
const checkedAt = "2026-09-03T11:59:00.000Z";
const label = (driver: string) => (driver === "claudeAgent" ? "Claude" : driver);

const windowAt = (usedPercent: number, resetsAt: string | undefined, id = "five_hour") =>
  ({
    id,
    kind: "session",
    label: id === "seven_day" ? "Weekly" : "5-hour",
    usedPercent,
    ...(resetsAt ? { resetsAt } : {}),
  }) as const;

const limits = (
  windows: ServerProviderUsageLimits["windows"],
  overrides: Partial<ServerProviderUsageLimits> = {},
): ServerProviderUsageLimits => ({ checkedAt, windows, ...overrides });

function hubPresentation(accounts: ReadonlyArray<ServerProviderUsageLimits>) {
  return new Map([
    [
      EnvironmentId.make("env"),
      {
        entry: { target: { label: "Local" } },
        serverConfig: {
          providers: [],
          usageLimitSources: [
            {
              id: UsageLimitSourceId.make("hub"),
              kind: "cliproxy" as const,
              label: "Hub",
              checkedAt,
              accounts: accounts.map((usageLimits, index) => ({
                id: `claude-${index}.json`,
                driver: ProviderDriverKind.make("claudeAgent"),
                email: `a${index}@example.com`,
                usageLimits,
              })),
            },
          ],
        },
      },
    ],
  ]);
}

describe("usage thresholds", () => {
  it("stays quiet below 80% used and escalates at 80, 90 and 100", () => {
    expect([0, 79, 80, 89, 90, 99, 100].map((used) => kodoUsageLevel(used))).toEqual([
      "ok",
      "ok",
      "warning",
      "warning",
      "critical",
      "critical",
      "exhausted",
    ]);
  });

  it("flags readings older than 30 minutes as stale", () => {
    expect(kodoUsageIsStale("2026-09-03T11:30:00.000Z", now)).toBe(false);
    expect(kodoUsageIsStale("2026-09-03T11:29:59.000Z", now)).toBe(true);
    expect(kodoUsageIsStale("not a date", now)).toBe(true);
  });
});

describe("summarizeProviderLimits", () => {
  it("picks the tightest window and the reset still ahead", () => {
    const reading = summarizeProviderLimits(
      limits([
        windowAt(30, "2026-09-03T14:00:00.000Z"),
        windowAt(92, "2026-09-08T12:00:00.000Z", "seven_day"),
      ]),
      now,
    );
    expect(reading).toMatchObject({
      label: "Weekly",
      remainingPercent: 8,
      level: "critical",
      resetsAtMs: Date.parse("2026-09-08T12:00:00.000Z"),
      stale: false,
    });
  });

  it("ignores a window whose reset already passed, since its percentage is from the last window", () => {
    expect(
      summarizeProviderLimits(limits([windowAt(100, "2026-09-03T11:00:00.000Z")]), now),
    ).toBeNull();
  });

  it("keeps a window with no reset time and marks failed probes as stale", () => {
    expect(
      summarizeProviderLimits(
        limits([windowAt(85, undefined)], { unavailable: { reason: "probeFailed" } }),
        now,
      ),
    ).toMatchObject({ level: "warning", resetsAtMs: null, stale: true });
  });

  it("reports nothing for unsupported providers and missing limits", () => {
    expect(summarizeProviderLimits(undefined, now)).toBeNull();
    expect(
      summarizeProviderLimits(limits([], { unavailable: { reason: "unsupported" } }), now),
    ).toBeNull();
  });
});

describe("formatKodoResetsIn", () => {
  it("counts from epoch time so it does not depend on the viewer's time zone", () => {
    const resetsAt = now + (2 * 60 + 14) * 60_000;
    expect(formatKodoResetsIn(resetsAt, now)).toBe("resets in 2h 14m");
    expect(formatKodoResetsIn(now + 3 * 24 * 3_600_000 + 5 * 3_600_000, now)).toBe(
      "resets in 3d 5h",
    );
    expect(formatKodoResetsIn(now + 30_000, now)).toBe("resets in under a minute");
    expect(formatKodoResetsIn(now - 1, now)).toBe("resets now");
    expect(formatKodoResetsIn(null, now)).toBeNull();
  });
});

describe("collectKodoUsageMeterEntries", () => {
  it("lists nothing while every provider is comfortably below the warning line", () => {
    expect(
      collectKodoUsageMeterEntries(
        hubPresentation([limits([windowAt(40, "2026-09-03T14:00:00.000Z")])]),
        now,
        label,
      ),
    ).toEqual([]);
  });

  it("pools accounts, so one exhausted subscription does not hide a free one", () => {
    const entries = collectKodoUsageMeterEntries(
      hubPresentation([
        limits([windowAt(100, "2026-09-03T13:00:00.000Z")]),
        limits([windowAt(20, "2026-09-03T15:00:00.000Z")]),
      ]),
      now,
      label,
    );
    expect(entries).toEqual([]);
  });

  it("shows the pool once every account is close, with its soonest reset", () => {
    const [entry] = collectKodoUsageMeterEntries(
      hubPresentation([
        limits([windowAt(100, "2026-09-03T13:00:00.000Z")]),
        limits([windowAt(96, "2026-09-03T14:00:00.000Z")]),
      ]),
      now,
      label,
    );
    expect(entry).toMatchObject({
      key: "claudeAgent",
      providerLabel: "Claude",
      level: "critical",
      remainingPercent: 2,
      resetsAtMs: Date.parse("2026-09-03T13:00:00.000Z"),
      accountCount: 2,
    });
  });
});

describe("model picker hint", () => {
  it("marks only exhausted or nearly exhausted providers", () => {
    expect(kodoPickerUsageHint(limits([windowAt(85, "2026-09-03T14:00:00.000Z")]), now)).toBeNull();
    expect(kodoPickerUsageHint(limits([windowAt(95, "2026-09-03T14:14:00.000Z")]), now)).toEqual({
      level: "critical",
      text: "5-hour: 5% left · resets in 2h 14m",
    });
    expect(kodoPickerUsageHint(limits([windowAt(100, "2026-09-03T13:00:00.000Z")]), now)).toEqual({
      level: "exhausted",
      text: "5-hour limit reached · resets in 1h 0m",
    });
  });

  it("warns that an old reading may be out of date", () => {
    expect(
      kodoPickerUsageHint(
        limits([windowAt(100, "2026-09-03T13:00:00.000Z")], {
          checkedAt: "2026-09-03T09:00:00.000Z",
        }),
        now,
      )?.text,
    ).toContain("may be out of date");
  });
});

describe("providersWithoutLimitData", () => {
  const base = {
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
  } as const;
  const make = (
    driver: string,
    extra: Partial<ServerProvider> = {},
    displayName?: string,
  ): ServerProvider => ({
    ...base,
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    ...(displayName ? { displayName } : {}),
    ...extra,
  });

  it("names providers that never report or have no subscription limits, not failed probes", () => {
    expect(
      providersWithoutLimitData([
        make("kiro", {}, "Kiro"),
        make("pi", {}, "Pi"),
        make("codex", { usageLimits: limits([windowAt(10, undefined)]) }, "Codex"),
        make(
          "cursor",
          { usageLimits: limits([], { unavailable: { reason: "unsupported" } }) },
          "Cursor",
        ),
        make(
          "claudeAgent",
          { usageLimits: limits([], { unavailable: { reason: "probeFailed" } }) },
          "Claude",
        ),
        make("fx", { enabled: false }, "fx"),
      ]),
    ).toEqual(["Cursor", "Kiro", "Pi"]);
  });

  it("does not list a driver whose accounts are already reported elsewhere, such as by a hub", () => {
    expect(
      providersWithoutLimitData(
        [make("claudeAgent", {}, "Claude"), make("kiro", {}, "Kiro")],
        new Set([ProviderDriverKind.make("claudeAgent")]),
      ),
    ).toEqual(["Kiro"]);
  });
});

describe("/usage slash command", () => {
  it("matches a bare /usage only, leaving /usage-limits and messages alone", () => {
    expect(parseKodoUsageSlashCommand(" /usage ")).toBe(true);
    expect(parseKodoUsageSlashCommand("/USAGE")).toBe(true);
    expect(parseKodoUsageSlashCommand("/usage-limits")).toBe(false);
    expect(parseKodoUsageSlashCommand("/usage please")).toBe(false);
    expect(isKodoUsageSlashCommand("usage")).toBe(true);
    expect(isKodoUsageSlashCommand("usage-limits")).toBe(false);
  });
});
