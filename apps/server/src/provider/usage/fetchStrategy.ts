import type {
  ProviderKind,
  ProviderRuntimeEvent,
  ProviderUsageState,
  ServerProviderUsageIdentity,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import type { ProviderUsageMetadata } from "@t3tools/shared/provider-usage";
import { Effect, Result } from "effect";

export type FetchKind = "cli" | "rpc" | "web" | "oauth" | "cache";

export interface ProviderUsageSnapshot {
  readonly provider: ProviderKind;
  readonly checkedAt: string;
  readonly status: ProviderUsageState;
  readonly summary: string | null;
  readonly detail: string | null;
  readonly resetAt: string | null;
  readonly identity: ServerProviderUsageIdentity;
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly raw?: string | null;
}

export interface ProviderFetchResult {
  readonly sourceLabel: string;
  readonly usage: ProviderUsageSnapshot;
}

export interface ProviderFetchStrategy {
  readonly id: string;
  readonly kind: FetchKind;
  readonly isAvailable: Effect.Effect<boolean>;
  readonly fetch: Effect.Effect<ProviderFetchResult, Error>;
  readonly shouldFallback: (error: Error) => boolean;
}

export interface UsageProviderModule {
  readonly metadata: ProviderUsageMetadata;
  readonly strategies: ReadonlyArray<ProviderFetchStrategy>;
  readonly mergeRuntimeEvent?: (
    event: ProviderRuntimeEvent,
    current: ProviderUsageSnapshot,
  ) => ProviderUsageSnapshot | undefined;
}

export const toUnknownUsageSnapshot = (input: {
  readonly provider: ProviderKind;
  readonly checkedAt: string;
  readonly detail: string;
}): ProviderUsageSnapshot => ({
  provider: input.provider,
  checkedAt: input.checkedAt,
  status: "unknown",
  summary: null,
  detail: input.detail,
  resetAt: null,
  identity: {
    planName: null,
    loginMethod: null,
    email: null,
    org: null,
  },
  windows: [],
});

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function fetchWithFallback(
  strategies: ReadonlyArray<ProviderFetchStrategy>,
): Effect.Effect<ProviderFetchResult, Error> {
  return Effect.gen(function* () {
    const errors: Array<{ id: string; error: string }> = [];

    for (const strategy of strategies) {
      const available = yield* strategy.isAvailable;
      if (!available) {
        continue;
      }

      const fetchResult = yield* strategy.fetch.pipe(Effect.result);
      if (Result.isSuccess(fetchResult)) {
        return fetchResult.success;
      }

      const error = toError(fetchResult.failure);
      errors.push({ id: strategy.id, error: error.message });

      if (!strategy.shouldFallback(error)) {
        return yield* Effect.fail(error);
      }
    }

    return yield* Effect.fail(
      new Error(
        `All strategies failed: ${errors.map((entry) => `${entry.id}: ${entry.error}`).join(" | ")}`,
      ),
    );
  });
}
