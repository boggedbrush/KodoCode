import type { ProviderKind, ServerProviderUsage } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect, Stream } from "effect";

export interface ProviderUsageRegistryShape {
  readonly getUsages: Effect.Effect<ReadonlyArray<ServerProviderUsage>>;
  readonly refresh: (provider?: ProviderKind) => Effect.Effect<ReadonlyArray<ServerProviderUsage>>;
  readonly streamChanges: Stream.Stream<ReadonlyArray<ServerProviderUsage>>;
}

export class ProviderUsageRegistry extends ServiceMap.Service<
  ProviderUsageRegistry,
  ProviderUsageRegistryShape
>()("t3/provider/Services/ProviderUsageRegistry") {}
