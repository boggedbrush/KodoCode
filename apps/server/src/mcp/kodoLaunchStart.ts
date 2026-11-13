// Kodo: t3_thread_launch and t3_thread_transfer from a thread that leads sub-agents or is one of their workers. Both are
// refused (kodo/delegation/delegationGuard.ts): a lead hands work over with delegate_task, and a
// worker starts nothing.
import * as Effect from "effect/Effect";

import { makeKodoDelegationGuard } from "../kodo/delegation/delegationGuard.ts";
import { kodoGuardWorkerMessaging, type KodoLeadShell } from "../kodo/delegation/leadGuard.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import type { Caller } from "./threadAccess.ts";

export const kodoLaunchStart = Effect.fn("mcp.kodoLaunchStart")(function* (context: Caller) {
  const { caller } = context;
  if (caller === undefined) return;
  const guard = makeKodoDelegationGuard({
    threads: context.threads,
    serverSettings: yield* ServerSettings.ServerSettingsService,
    providerRegistry: yield* ProviderRegistry.ProviderRegistry,
    instanceRegistry: yield* Effect.serviceOption(
      ProviderInstanceRegistry.ProviderInstanceRegistry,
    ),
  });
  yield* guard.guardThreadStart(caller.id);
});

/** t3_thread_transfer from a worker of a lead: refused, as a worker forks and messages nothing. */
export const kodoRefuseWorkerMessaging = Effect.fn("mcp.kodoRefuseWorkerMessaging")(function* (
  context: Caller,
) {
  const { caller } = context;
  if (caller === undefined) return;
  yield* kodoGuardWorkerMessaging(
    {
      getShell: (threadId) =>
        context.threads.getThreadShell(threadId) as Effect.Effect<
          KodoLeadShell | null,
          { readonly _tag: string }
        >,
    },
    caller.id,
  );
});
