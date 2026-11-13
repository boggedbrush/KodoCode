// Kodo: t3_thread_launch from a thread that leads sub-agents or is one of their workers. The same
// guard as delegate_task and create_threads (kodo/delegation/delegationGuard.ts), built from the
// services the launch tool already runs with. A worker is refused; a lead is capped, gated on its
// providers' usage limits, and its launch names no model. Returns whether the caller is a lead.
import { DEFAULT_KODO_MODE_MODELS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { makeKodoDelegationGuard } from "../kodo/delegation/delegationGuard.ts";
import { kodoWorkerInstanceIds } from "../kodo/delegation/leadDelegation.ts";
import { isKodoLead } from "../kodo/delegation/leadGuard.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import type { Caller } from "./threadAccess.ts";

export const kodoLaunchStart = Effect.fn("mcp.kodoLaunchStart")(function* (context: Caller) {
  const { caller } = context;
  if (caller === undefined) return false;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const guard = makeKodoDelegationGuard({
    threads: context.threads,
    serverSettings,
    providerRegistry,
    instanceRegistry: yield* Effect.serviceOption(
      ProviderInstanceRegistry.ProviderInstanceRegistry,
    ),
  });
  yield* guard.guardStart({ callerThreadId: caller.id, adding: 1, route: "thread" });
  if (!isKodoLead(caller)) return false;
  const modeModels = yield* serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.modeModelSelections),
    Effect.orElseSucceed(() => DEFAULT_KODO_MODE_MODELS),
  );
  for (const instanceId of kodoWorkerInstanceIds({
    modeModels,
    mode: caller.interactionMode,
    inherited: caller.providerInstanceId,
  })) {
    yield* guard.guardLimit(instanceId);
  }
  return true;
});
