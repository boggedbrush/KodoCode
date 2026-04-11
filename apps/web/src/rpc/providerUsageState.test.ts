import { describe, expect, it, vi } from "vitest";

import {
  applyProviderUsageEvent,
  getProviderUsages,
  resetProviderUsageStateForTests,
  startProviderUsageSync,
} from "./providerUsageState";

const usageSnapshot = [
  {
    provider: "codex" as const,
    status: "ready" as const,
    source: "poll" as const,
    checkedAt: "2026-01-01T00:00:00.000Z",
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
    windows: [],
  },
];

describe("providerUsageState", () => {
  it("applies stream snapshot and updated events", () => {
    resetProviderUsageStateForTests();

    applyProviderUsageEvent({
      version: 1,
      type: "snapshot",
      usages: usageSnapshot,
    });
    expect(getProviderUsages()).toEqual(usageSnapshot);

    applyProviderUsageEvent({
      version: 1,
      type: "updated",
      payload: {
        usages: usageSnapshot.map((usage) => ({
          ...usage,
          status: "limited" as const,
        })),
      },
    });
    expect(getProviderUsages()[0]?.status).toBe("limited");
  });

  it("bootstraps from unary fetch and subscribes to updates", async () => {
    resetProviderUsageStateForTests();
    const listeners = new Set<(event: unknown) => void>();
    const client = {
      getUsageStatus: vi.fn(async () => usageSnapshot),
      subscribeUsageStatus: vi.fn((listener: (event: unknown) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }),
    };

    const stop = startProviderUsageSync(client as never);
    await vi.waitFor(() => {
      expect(getProviderUsages()).toEqual(usageSnapshot);
    });

    for (const listener of listeners) {
      listener({
        version: 1,
        type: "updated",
        payload: {
          usages: usageSnapshot.map((usage) =>
            Object.assign({}, usage, {
              status: "exhausted" as const,
            }),
          ),
        },
      });
    }

    await vi.waitFor(() => {
      expect(getProviderUsages()[0]?.status).toBe("exhausted");
    });

    stop();
  });
});
