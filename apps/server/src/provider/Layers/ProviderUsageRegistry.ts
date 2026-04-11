import type { ProviderKind, ProviderRuntimeEvent, ServerProviderUsage } from "@t3tools/contracts";
import { Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";
import { PROVIDER_USAGE_ORDER, type ProviderUsageMetadata } from "@t3tools/shared/provider-usage";

import {
  ProviderUsageRegistry,
  type ProviderUsageRegistryShape,
} from "../Services/ProviderUsageRegistry";
import { ProviderService } from "../Services/ProviderService";
import {
  fetchWithFallback,
  type ProviderUsageSnapshot,
  type UsageProviderModule,
} from "../usage/fetchStrategy";
import { startUsagePollingController } from "../usage/UsagePollingController";
import { makeCodexUsageModule } from "../usage/modules/codexUsageModule";
import { makeClaudeUsageModule } from "../usage/modules/claudeUsageModule";

const STALE_AFTER_MS = 10 * 60 * 1000;

function toServerUsage(
  snapshot: ProviderUsageSnapshot,
  source: "poll" | "runtime",
): ServerProviderUsage {
  return {
    provider: snapshot.provider,
    status: snapshot.status,
    source,
    checkedAt: snapshot.checkedAt,
    stale: false,
    summary: snapshot.summary,
    detail: snapshot.detail,
    resetAt: snapshot.resetAt,
    identity: snapshot.identity,
    windows: [...snapshot.windows],
  };
}

function toSnapshot(usage: ServerProviderUsage): ProviderUsageSnapshot {
  return {
    provider: usage.provider,
    checkedAt: usage.checkedAt,
    status: usage.status,
    summary: usage.summary,
    detail: usage.detail,
    resetAt: usage.resetAt,
    identity: usage.identity,
    windows: usage.windows,
  };
}

function applyStaleFlag(
  usages: ReadonlyArray<ServerProviderUsage>,
): ReadonlyArray<ServerProviderUsage> {
  const now = Date.now();
  return usages.map((usage) => {
    const checkedAt = Date.parse(usage.checkedAt);
    if (Number.isNaN(checkedAt)) {
      return { ...usage, stale: true };
    }
    return { ...usage, stale: now - checkedAt > STALE_AFTER_MS };
  });
}

function sortUsages(
  usages: ReadonlyArray<ServerProviderUsage>,
): ReadonlyArray<ServerProviderUsage> {
  const indexByProvider = new Map(PROVIDER_USAGE_ORDER.map((provider, index) => [provider, index]));
  return usages.toSorted(
    (left, right) =>
      (indexByProvider.get(left.provider) ?? Number.MAX_SAFE_INTEGER) -
      (indexByProvider.get(right.provider) ?? Number.MAX_SAFE_INTEGER),
  );
}

function unknownUsage(metadata: ProviderUsageMetadata, detail: string): ServerProviderUsage {
  return {
    provider: metadata.id,
    status: "unknown",
    source: "poll",
    checkedAt: new Date().toISOString(),
    stale: false,
    summary: null,
    detail,
    resetAt: null,
    identity: {
      planName: null,
      loginMethod: null,
      email: null,
      org: null,
    },
    windows: [],
  };
}

export const ProviderUsageRegistryLive = Layer.effect(
  ProviderUsageRegistry,
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const codexModule = yield* makeCodexUsageModule;
    const claudeModule = yield* makeClaudeUsageModule;
    const modules = [
      codexModule,
      claudeModule,
    ] as const satisfies ReadonlyArray<UsageProviderModule>;
    const moduleByProvider = new Map(modules.map((module) => [module.metadata.id, module]));
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProviderUsage>>(),
      PubSub.shutdown,
    );

    const fetchModuleUsage = (module: UsageProviderModule) =>
      fetchWithFallback(module.strategies).pipe(
        Effect.map((result) => toServerUsage(result.usage, "poll")),
        Effect.catch((error) =>
          Effect.succeed(
            unknownUsage(
              module.metadata,
              error instanceof Error
                ? error.message
                : `Failed to fetch ${module.metadata.displayName} usage.`,
            ),
          ),
        ),
      );

    const refreshAll = Effect.all(
      modules.map((module) => fetchModuleUsage(module)),
      {
        concurrency: "unbounded",
      },
    ).pipe(Effect.map(sortUsages));

    const usagesRef = yield* Ref.make<ReadonlyArray<ServerProviderUsage>>(yield* refreshAll);

    const publishIfChanged = Effect.fn("publishIfChanged")(function* (
      previous: ReadonlyArray<ServerProviderUsage>,
      next: ReadonlyArray<ServerProviderUsage>,
    ) {
      if (!Equal.equals(previous, next)) {
        yield* PubSub.publish(changesPubSub, applyStaleFlag(next));
      }
    });

    const syncUsages = Effect.fn("syncUsages")(function* (provider?: ProviderKind) {
      const previous = yield* Ref.get(usagesRef);
      let next: ReadonlyArray<ServerProviderUsage>;

      if (!provider) {
        next = yield* refreshAll;
      } else {
        const module = moduleByProvider.get(provider);
        if (!module) {
          next = previous;
        } else {
          const refreshed = yield* fetchModuleUsage(module);
          next = sortUsages(
            previous.map((existing) => (existing.provider === provider ? refreshed : existing)),
          );
        }
      }

      yield* Ref.set(usagesRef, next);
      yield* publishIfChanged(previous, next);
      return applyStaleFlag(next);
    });

    const applyRuntimeEvent = Effect.fn("applyRuntimeEvent")(function* (
      event: ProviderRuntimeEvent,
    ) {
      const module = moduleByProvider.get(event.provider);
      if (!module?.mergeRuntimeEvent) {
        return;
      }

      const previous = yield* Ref.get(usagesRef);
      const currentUsage = previous.find((usage) => usage.provider === event.provider);
      if (!currentUsage) {
        return;
      }

      const nextSnapshot = module.mergeRuntimeEvent(event, toSnapshot(currentUsage));
      if (!nextSnapshot) {
        return;
      }

      const runtimeUsage = toServerUsage(nextSnapshot, "runtime");
      const next = sortUsages(
        previous.map((usage) => (usage.provider === runtimeUsage.provider ? runtimeUsage : usage)),
      );
      yield* Ref.set(usagesRef, next);
      yield* publishIfChanged(previous, next);
    });

    yield* Stream.runForEach(providerService.streamEvents, applyRuntimeEvent).pipe(
      Effect.forkScoped,
    );

    yield* startUsagePollingController({
      frequency: "5m",
      refresh: syncUsages().pipe(Effect.asVoid),
    });

    return {
      getUsages: Ref.get(usagesRef).pipe(
        Effect.map((usages) => applyStaleFlag(sortUsages(usages))),
      ),
      refresh: (provider?: ProviderKind) => syncUsages(provider),
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderUsageRegistryShape;
  }),
);
