import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { fetchWithFallback, type ProviderFetchStrategy } from "./fetchStrategy";

describe("fetchWithFallback", () => {
  it("falls back to next strategy when allowed", async () => {
    const strategies: ReadonlyArray<ProviderFetchStrategy> = [
      {
        id: "first",
        kind: "cli",
        isAvailable: Effect.succeed(true),
        fetch: Effect.fail(new Error("first failed")),
        shouldFallback: () => true,
      },
      {
        id: "second",
        kind: "rpc",
        isAvailable: Effect.succeed(true),
        fetch: Effect.succeed({
          sourceLabel: "second",
          usage: {
            provider: "codex",
            checkedAt: "2026-01-01T00:00:00.000Z",
            status: "ready",
            summary: "ok",
            detail: null,
            resetAt: null,
            identity: {
              planName: null,
              loginMethod: null,
              email: null,
              org: null,
            },
            windows: [],
          },
        }),
        shouldFallback: () => false,
      },
    ];

    const result = await Effect.runPromise(fetchWithFallback(strategies));
    expect(result.sourceLabel).toBe("second");
    expect(result.usage.provider).toBe("codex");
  });

  it("stops immediately when strategy marks error as non-fallback", async () => {
    const strategies: ReadonlyArray<ProviderFetchStrategy> = [
      {
        id: "first",
        kind: "cli",
        isAvailable: Effect.succeed(true),
        fetch: Effect.fail(new Error("hard failure")),
        shouldFallback: () => false,
      },
      {
        id: "second",
        kind: "rpc",
        isAvailable: Effect.succeed(true),
        fetch: Effect.succeed({
          sourceLabel: "second",
          usage: {
            provider: "codex",
            checkedAt: "2026-01-01T00:00:00.000Z",
            status: "ready",
            summary: "ok",
            detail: null,
            resetAt: null,
            identity: {
              planName: null,
              loginMethod: null,
              email: null,
              org: null,
            },
            windows: [],
          },
        }),
        shouldFallback: () => true,
      },
    ];

    await expect(Effect.runPromise(fetchWithFallback(strategies))).rejects.toThrow("hard failure");
  });
});
