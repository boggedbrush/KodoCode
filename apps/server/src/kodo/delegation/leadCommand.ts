// The orchestrator's side of the sub-agents switch: it reads what the pure rules need (the thread's
// runs, its workers, its ancestry, its provider) and commits the answer. The rules themselves are in
// leadControl.ts; this file only gathers their inputs, so the hook in the orchestrator stays small.
import {
  normalizeKodoInteractionMode,
  type KodoLead,
  type OrchestrationV2AppThread,
  type OrchestrationV2Command,
  type ServerProvider,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { kodoThreadOwnModel } from "@t3tools/shared/kodoModeModel";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { ProjectionStoreV2Shape } from "../../orchestration-v2/ProjectionStore.ts";
import type * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import type * as ServerSettings from "../../serverSettings.ts";
import {
  type KodoLeadShell,
  kodoThreadRunsUnder,
  kodoThreadUnderLead,
  kodoWorkerCounts,
} from "./leadGuard.ts";
import { decideKodoLeadSet, kodoLeadCreateRefusal, type KodoLeadSetResult } from "./leadControl.ts";
import { kodoLeadSupportRefusal } from "./leadSupport.ts";
import { kodoSubAgentsSupportForDriver } from "./leadSupport.ts";

export interface KodoLeadCommandServices {
  readonly projectionStore: Pick<
    ProjectionStoreV2Shape,
    "getThreadShell" | "listAppOwnedChildThreadIds"
  >;
  readonly serverSettings: ServerSettings.ServerSettingsService["Service"];
  /** Absent only where no provider list is wired; support then cannot be shown, so nothing can lead. */
  readonly providerRegistry: ProviderRegistry.ProviderRegistry["Service"] | undefined;
}

type SetCommand = Extract<OrchestrationV2Command, { readonly type: "thread.kodo-lead.set" }>;
type CreateCommand = Extract<OrchestrationV2Command, { readonly type: "thread.create" }>;

const hasServerUrl = (config: unknown): boolean =>
  typeof config === "object" &&
  config !== null &&
  "serverUrl" in config &&
  typeof config.serverUrl === "string" &&
  config.serverUrl.trim().length > 0;

export const makeKodoLeadCommands = (services: KodoLeadCommandServices) => {
  const getShell = (threadId: ThreadId) =>
    services.projectionStore.getThreadShell(threadId) as Effect.Effect<
      KodoLeadShell | null,
      { readonly _tag: string }
    >;

  /** Why a thread cannot lead because of the providers its turns would run on, or undefined. */
  const supportRefusal = Effect.fn("KodoLeadCommands.supportRefusal")(function* (
    thread: Pick<OrchestrationV2AppThread, "modelSelection" | "kodoModeModel">,
  ) {
    if (services.providerRegistry === undefined) {
      return "The provider list is not available, so support for sub-agents cannot be checked.";
    }
    const providers: ReadonlyArray<ServerProvider> = yield* services.providerRegistry.getProviders;
    const settings = yield* services.serverSettings.getSettings.pipe(Effect.option);
    const own = kodoThreadOwnModel(thread);
    const ownRefusal = kodoLeadSupportRefusal({
      provider: providers.find((provider) => provider.instanceId === own.instanceId),
      externalOpenCode:
        settings._tag === "Some" &&
        hasServerUrl(settings.value.providerInstances[own.instanceId]?.config),
    });
    if (ownRefusal !== undefined) return ownRefusal;
    // The lead's turns run on the Orchestrator model when one is set, so its provider must receive the tools too.
    const slot = settings._tag === "Some" ? settings.value.modeModelSelections.orchestrator : null;
    const slotProvider =
      slot === null
        ? undefined
        : providers.find((provider) => provider.instanceId === slot.instanceId);
    return slotProvider !== undefined &&
      kodoSubAgentsSupportForDriver(slotProvider.driver).support === "none"
      ? `The Orchestrator model runs on ${slotProvider.displayName ?? slotProvider.driver}, which cannot receive the delegation tools. Change the Orchestrator model in Settings first.`
      : undefined;
  });

  /** The thread's next lead state for a set command, or the reason it is refused. */
  const decideSet = Effect.fn("KodoLeadCommands.decideSet")(function* (input: {
    readonly command: SetCommand;
    readonly thread: OrchestrationV2AppThread;
    readonly busy: boolean;
    readonly limit: { readonly interactionMode: unknown } | undefined;
  }): Effect.fn.Return<KodoLeadSetResult, { readonly _tag: string }> {
    const { command, thread } = input;
    const sender = command.createdBy === "user" ? undefined : command.senderThreadId;
    const counts = yield* kodoWorkerCounts({
      getShell,
      listChildIds: services.projectionStore.listAppOwnedChildThreadIds,
      leadId: thread.id,
      turnStartedAtMs: undefined,
      toMillis: DateTime.toEpochMillis,
    });
    return decideKodoLeadSet({
      requested: command.lead,
      thread: {
        id: thread.id,
        interactionMode: normalizeKodoInteractionMode(thread.interactionMode),
        loopStatus: thread.kodoLoop?.status,
      },
      busy: input.busy,
      liveWorkers: counts.live,
      underLead: yield* kodoThreadUnderLead(getShell, thread.id),
      supportRefusal: command.lead === null ? undefined : yield* supportRefusal(thread),
      actor: {
        createdBy: command.createdBy,
        senderThreadId: sender,
        senderIsTargetOrAncestor:
          sender !== undefined && (yield* kodoThreadRunsUnder(getShell, sender, thread.id)),
      },
      limit: input.limit,
    });
  });

  /**
   * The lead a new thread starts with. A person's thread takes what the composer sent, else the
   * project's default; a thread whose provider cannot lead starts without one (the person's message
   * is not lost to a switch they cannot see), and any other creator's request is ignored.
   */
  const leadForNewThread = Effect.fn("KodoLeadCommands.leadForNewThread")(function* (
    command: CreateCommand,
  ) {
    if (command.createdBy !== "user" || command.delegatedFrom !== undefined) return undefined;
    let wanted: KodoLead | null | undefined = command.kodoLead;
    if (wanted === undefined) {
      const settings = yield* services.serverSettings.getSettings.pipe(Effect.option);
      wanted =
        settings._tag === "Some" &&
        resolveProjectSettings(settings.value, command.projectId).settings.kodoSubAgentsDefault
          ? { kind: "sub-agents" }
          : null;
    }
    if (wanted === null || wanted.kind !== "sub-agents") return undefined;
    const refusal = kodoLeadCreateRefusal({
      createdBy: command.createdBy,
      supportRefusal: yield* supportRefusal({
        modelSelection: command.modelSelection,
        kodoModeModel: undefined,
      }),
    });
    return refusal === undefined ? wanted : undefined;
  });

  return { decideSet, leadForNewThread };
};

export type KodoLeadCommands = ReturnType<typeof makeKodoLeadCommands>;
