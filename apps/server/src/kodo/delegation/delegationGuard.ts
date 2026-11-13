// Wires the lead guard and the usage-limit gate to the server's own services. Built by the services
// that start work (OrchestratorMcpService for delegate_task and create_threads, the project toolkit
// for t3_thread_launch), which pass what they already hold; the instance registry is optional, as in
// the loop, and without it the provider list's reading of the limits stands.
import {
  ProviderInstanceId,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import type * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import type * as ServerSettings from "../../serverSettings.ts";
import { kodoGuardWorkerStart, makeKodoCreatedTally, type KodoLeadShell } from "./leadGuard.ts";

// One tally for every service that starts work: a turn is one turn whichever tool made the thread.
const createdTally = makeKodoCreatedTally();
import { kodoGuardWorkerLimit } from "./workerLimitGate.ts";

export interface KodoDelegationGuardServices {
  readonly threads: {
    readonly getThreadShell: (
      threadId: ThreadId,
    ) => Effect.Effect<OrchestrationV2ThreadShell | null, { readonly _tag: string }>;
    readonly listAppOwnedChildThreadIds: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<ThreadId>, { readonly _tag: string }>;
  };
  readonly serverSettings: ServerSettings.ServerSettingsService["Service"];
  readonly providerRegistry: ProviderRegistry.ProviderRegistry["Service"];
  readonly instanceRegistry: Option.Option<
    ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]
  >;
}

export const makeKodoDelegationGuard = (services: KodoDelegationGuardServices) => {
  const settings = services.serverSettings.getSettings;
  const deps = {
    tally: createdTally,
    getShell: (threadId: ThreadId) =>
      services.threads.getThreadShell(threadId) as Effect.Effect<
        KodoLeadShell | null,
        { readonly _tag: string }
      >,
    listChildIds: services.threads.listAppOwnedChildThreadIds,
    toMillis: (value: OrchestrationV2ThreadShell["createdAt"]) => DateTime.toEpochMillis(value),
    maxWorkersSetting: settings.pipe(
      Effect.map((value) => value.kodoSubAgentsMaxWorkers),
      Effect.orElseSucceed(() => undefined),
    ),
  };
  const instances = services.instanceRegistry;
  const limitDeps = {
    providers: services.providerRegistry.getProviders,
    stopAtPercent: settings.pipe(Effect.map((value) => value.loop.budget.stopAtLimitPercent)),
    ...(Option.isSome(instances)
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
      : {}),
  };
  return {
    /** Refuses a start from a worker, or from a lead over a cap. `adding` is how many the call makes. */
    guardStart: (input: {
      readonly callerThreadId: ThreadId;
      readonly adding: number;
      readonly route: "delegate" | "thread";
    }) => kodoGuardWorkerStart(deps, input),
    /** Refuses when the worker's provider is at the person's usage-limit threshold. */
    guardLimit: (instanceId: string) => kodoGuardWorkerLimit(limitDeps, instanceId),
  } as const;
};

export type KodoDelegationGuard = ReturnType<typeof makeKodoDelegationGuard>;
