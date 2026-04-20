import type { ProviderStartOptions, ServerProviderUsage } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface ProviderUsageRegistryShape {
  readonly getUsages: (
    providerOptions?: ProviderStartOptions,
  ) => Effect.Effect<ReadonlyArray<ServerProviderUsage>>;
  readonly refresh: (
    providerOptions?: ProviderStartOptions,
  ) => Effect.Effect<ReadonlyArray<ServerProviderUsage>>;
}

export class ProviderUsageRegistry extends ServiceMap.Service<
  ProviderUsageRegistry,
  ProviderUsageRegistryShape
>()("kodo/provider/Services/ProviderUsageRegistry") {}
