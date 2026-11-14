// How the usage gate and the usage status read a provider instance's limits: the instance's own
// snapshot when the registry holds it, the provider list's otherwise, and its own refresh. Without the
// instance registry (it is optional, as in the loop) the provider list's reading stands.
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import type * as ProviderRegistry from "../../provider/ProviderRegistry.ts";

export const makeKodoLimitSources = (services: {
  readonly providerRegistry: ProviderRegistry.ProviderRegistry["Service"];
  readonly instanceRegistry: Option.Option<
    ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]
  >;
}) => {
  const instances = services.instanceRegistry;
  return Option.isSome(instances)
    ? {
        readLimits: (instanceId: string) =>
          instances.value
            .getInstance(ProviderInstanceId.make(instanceId))
            .pipe(
              Effect.flatMap((instance) =>
                instance === undefined
                  ? services.providerRegistry.getProviders.pipe(
                      Effect.map(
                        (providers) =>
                          providers.find((provider) => provider.instanceId === instanceId)
                            ?.usageLimits,
                      ),
                    )
                  : instance.snapshot.getSnapshot.pipe(
                      Effect.map((snapshot) => snapshot.usageLimits),
                    ),
              ),
            ),
        refreshLimits: (instanceId: string) =>
          instances.value
            .getInstance(ProviderInstanceId.make(instanceId))
            .pipe(Effect.flatMap((instance) => instance?.snapshot.refreshUsage ?? Effect.void)),
      }
    : {};
};
