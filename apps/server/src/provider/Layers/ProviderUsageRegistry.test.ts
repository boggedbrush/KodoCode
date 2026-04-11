import { describe, expect, it } from "vitest";
import { Effect, Layer, PubSub, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ProviderUsageRegistry } from "../Services/ProviderUsageRegistry";
import { ProviderService } from "../Services/ProviderService";
import { ProviderUsageRegistryLive } from "./ProviderUsageRegistry";
import { ServerSettingsService } from "../../serverSettings";

describe("ProviderUsageRegistryLive", () => {
  it("initializes usage snapshots and merges runtime rate-limit events", async () => {
    const runtimeEvents = await Effect.runPromise(PubSub.unbounded<any>());
    const providerServiceLayer = Layer.succeed(ProviderService, {
      streamEvents: Stream.fromPubSub(runtimeEvents),
    } as any);
    const spawnerLayer = Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() => Effect.die("subprocess should not run in test")),
    );

    const layer = ProviderUsageRegistryLive.pipe(
      Layer.provideMerge(providerServiceLayer),
      Layer.provideMerge(spawnerLayer),
      Layer.provideMerge(
        ServerSettingsService.layerTest({
          providers: {
            codex: { enabled: false },
            claudeAgent: { enabled: false },
          },
        }),
      ),
    );

    const program = Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* ProviderUsageRegistry;
        const initial = yield* registry.getUsages;
        expect(initial.map((entry) => entry.provider)).toEqual(["codex", "claudeAgent"]);
        expect(initial.every((entry) => entry.status === "unknown")).toBe(true);

        yield* Effect.sleep("20 millis");

        yield* PubSub.publish(runtimeEvents, {
          eventId: "evt-rate-limit",
          provider: "codex",
          threadId: "thread-rate-limit",
          createdAt: new Date().toISOString(),
          type: "account.rate-limits.updated",
          payload: {
            rateLimits: {
              remaining: 0,
              limit: 100,
              resetAt: "2026-01-01T01:00:00.000Z",
            },
          },
        });

        yield* Effect.sleep("20 millis");

        const updated = yield* registry.getUsages;
        const codex = updated.find((entry) => entry.provider === "codex");
        expect(codex?.status).toBe("exhausted");
        expect(codex?.source).toBe("runtime");
        expect(codex?.windows.length).toBeGreaterThan(0);
      }),
    ).pipe(Effect.provide(layer));

    await Effect.runPromise(program);
  });
});
