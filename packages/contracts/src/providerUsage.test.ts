import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ServerProviderUsage,
  ServerProviderUsageUpdatedPayload,
  ServerUsageStreamEvent,
} from "./providerUsage";

const decodeUsage = Schema.decodeUnknownSync(ServerProviderUsage);
const decodeUsageStream = Schema.decodeUnknownSync(ServerUsageStreamEvent);

describe("providerUsage contracts", () => {
  it("decodes a provider usage snapshot", () => {
    const parsed = decodeUsage({
      provider: "codex",
      status: "ready",
      source: "poll",
      checkedAt: new Date().toISOString(),
      stale: false,
      summary: "Plan: ChatGPT Pro Subscription",
      detail: null,
      resetAt: null,
      identity: {
        planName: "ChatGPT Pro Subscription",
        loginMethod: "ChatGPT",
        email: null,
        org: null,
      },
      windows: [
        {
          key: "weekly",
          label: "Weekly",
          usedText: "1200",
          limitText: "10000",
          remainingText: "8800",
          percentUsed: 12,
          resetAt: null,
        },
      ],
    });

    expect(parsed.provider).toBe("codex");
    expect(parsed.windows).toHaveLength(1);
    expect(parsed.windows[0]?.key).toBe("weekly");
  });

  it("decodes stream snapshot and updated events", () => {
    const checkedAt = new Date().toISOString();
    const usagePayload = {
      provider: "claudeAgent",
      status: "limited",
      source: "runtime",
      checkedAt,
      stale: false,
      summary: "Claude usage limited",
      detail: null,
      resetAt: checkedAt,
      identity: {
        planName: "Max",
        loginMethod: "oauth",
        email: "user@example.com",
        org: null,
      },
      windows: [
        {
          key: "session",
          label: "Session",
          percentUsed: 84,
          resetAt: checkedAt,
        },
      ],
    };

    const snapshot = decodeUsageStream({
      version: 1,
      type: "snapshot",
      usages: [usagePayload],
    });
    expect(snapshot.type).toBe("snapshot");

    const updated = decodeUsageStream({
      version: 1,
      type: "updated",
      payload: Schema.decodeUnknownSync(ServerProviderUsageUpdatedPayload)({
        usages: [usagePayload],
      }),
    });
    expect(updated.type).toBe("updated");
    if (updated.type !== "updated") {
      return;
    }
    expect(updated.payload.usages[0]?.provider).toBe("claudeAgent");
  });
});
