// Kodo per-mode models at turn start: picks the model a message runs on from the mode it is sent in
// (see ./modeModel.ts for the precedence), and checks that the mode's configured model can run
// before the dispatch commits to it, because a default must never fail a turn. The orchestrator
// calls `selectForDispatch` when it creates a run and `reconcileQueuedStart` when a queued run starts.
import {
  DEFAULT_KODO_MODE_MODELS,
  type KodoLoopStageRef,
  type KodoRunModel,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import {
  kodoAvailabilityFromProviders,
  kodoInstanceTurnedOff,
  kodoOwnModelAfterQueue,
  kodoRunModelFor,
  kodoThreadOwnModel,
} from "@t3tools/shared/kodoModeModel";
import { modelSelectionsEqual } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";

import type { ProviderSwitchServiceV2 } from "../orchestration-v2/ProviderSwitchService.ts";
import type * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import type * as ServerSettings from "../serverSettings.ts";
import { resolveKodoModeModel } from "./modeModel.ts";

export interface KodoModeModelTurnServices {
  readonly serverSettings: ServerSettings.ServerSettingsService["Service"];
  /** Absent only where no provider catalogue is wired; a mode default cannot be checked there. */
  readonly providerRegistry: ProviderRegistry.ProviderRegistry["Service"] | undefined;
  readonly providerSwitchService: ProviderSwitchServiceV2["Service"];
  /** Detaching a session kills background work running inside its provider process. */
  readonly sessionHasBackgroundWork: (
    session: OrchestrationV2ProviderSession,
    providerThreads: OrchestrationV2ThreadProjection["providerThreads"],
  ) => Effect.Effect<boolean>;
}

type MessageDispatchCommand = Extract<
  OrchestrationV2Command,
  { readonly type: "message.dispatch" }
>;

export interface KodoDispatchSelectionInput {
  readonly projection: OrchestrationV2ThreadProjection;
  readonly command: Pick<
    MessageDispatchCommand,
    | "modelSelection"
    | "explicitModelSelection"
    | "idleCompaction"
    | "notification"
    | "restartContinuationOfRunId"
    | "usageLimitContinuationOfRunId"
    | "manualContinuationOfRunId"
  >;
  /** The selection the dispatch would use without a mode default: the command's, else the thread's or the queue tail's. */
  readonly modelSelection: ModelSelection;
  /** Delegated completions, monitor notices and buffered wakes carry on the conversation as it is. */
  readonly followsCurrentConversation: boolean;
  /** The loop stage this message really carries (validated by the caller); the judge runs on its own slot. */
  readonly loopStage?: KodoLoopStageRef | undefined;
  /** The last queued run ahead of this message, when it queues; the thread's own model follows it. */
  readonly queueTail: OrchestrationV2Run | undefined;
  readonly activeProviderThread: OrchestrationV2ProviderThread | undefined;
}

export interface KodoDispatchSelection {
  readonly modelSelection: ModelSelection;
  readonly kodoRunModel: KodoRunModel | undefined;
}

/**
 * Turns that continue or maintain the conversation as it is, and so never change model: restarts
 * and continuations of a run, wakes and notices (every notification, buffered or not, and delegated
 * completions), and compaction run for the idle-cache timer or when a person returns.
 */
const keepsConversationModel = (input: KodoDispatchSelectionInput) =>
  input.followsCurrentConversation ||
  input.command.notification !== undefined ||
  input.command.idleCompaction !== undefined;

export const makeKodoModeModelTurn = (services: KodoModeModelTurnServices) => {
  /** Why a mode's configured model cannot run this turn (null: it can). */
  const unavailableReason = Effect.fn("KodoModeModelTurn.unavailableReason")(function* (
    projection: OrchestrationV2ThreadProjection,
    configured: ModelSelection,
    activeProviderThread: OrchestrationV2ProviderThread | undefined,
  ) {
    // A default that is never checked can fail the turn it was meant to serve, so fail here, loudly.
    if (services.providerRegistry === undefined) {
      return yield* Effect.die(
        new Error("A mode default model cannot be checked without the ProviderRegistry service."),
      );
    }
    const providers = yield* services.providerRegistry.getProviders;
    // The reasons read after the model's name on the run ("<model> not used: <reason>").
    const catalogueReason = kodoAvailabilityFromProviders(providers)(configured);
    if (catalogueReason !== null) return catalogueReason;
    // Turned off for this project (or the machine) in settings: a queue would hold on it forever.
    const settings = yield* services.serverSettings.getSettings.pipe(Effect.option);
    if (
      settings._tag === "Some" &&
      kodoInstanceTurnedOff(settings.value, projection.thread.projectId, configured.instanceId)
    ) {
      return "its provider is turned off for this project";
    }
    // A selection the provider will not switch to is a failed plan; its cause says why.
    const planned = yield* services.providerSwitchService
      .plan({ projection, targetModelSelection: configured })
      .pipe(Effect.result);
    if (planned._tag === "Failure") {
      const cause = planned.failure.cause;
      return typeof cause === "string" ? cause : "the provider cannot switch to it";
    }
    const plan = planned.success;
    if (plan.transition.type === "reject") return plan.transition.reason;
    const crossesProvider =
      activeProviderThread !== undefined &&
      activeProviderThread.nativeThreadRef !== null &&
      activeProviderThread.providerInstanceId !== configured.instanceId;
    if (!crossesProvider) return null;
    const liveSession = projection.providerSessions.findLast(
      (session) =>
        session.providerInstanceId === activeProviderThread.providerInstanceId &&
        session.status !== "stopped" &&
        session.status !== "error",
    );
    if (
      liveSession !== undefined &&
      !liveSession.capabilities.sessions.supportsProviderSwitchingViaHandoff
    ) {
      return "this thread's provider cannot hand its conversation to another provider.";
    }
    for (const releasing of projection.providerSessions.filter(
      (session) =>
        plan.releaseProviderSessionIds.includes(session.id) &&
        session.status !== "stopped" &&
        session.status !== "error",
    )) {
      if (yield* services.sessionHasBackgroundWork(releasing, projection.providerThreads)) {
        return "background work is still running in the thread's current provider.";
      }
    }
    return null;
  });

  /**
   * The turn runs on the model of the mode it is created in: an explicit pick, else the mode's
   * configured model, else the thread's own model. A configured model that cannot run falls back to
   * the thread's own and says why on the run. A continuation keeps the model it continues, and
   * the record that says which model is the thread's own.
   */
  const selectForDispatch = Effect.fn("KodoModeModelTurn.selectForDispatch")(function* (
    input: KodoDispatchSelectionInput,
  ) {
    const { projection, command } = input;
    const continued = [
      command.restartContinuationOfRunId,
      command.usageLimitContinuationOfRunId,
      command.manualContinuationOfRunId,
    ].find((runId) => runId !== undefined);
    if (continued !== undefined) {
      // The continued run's record moves with it; the thread's own model is read now, since it may
      // have been changed while the run was down.
      const source = projection.runs.find((run) => run.id === continued);
      const record = source?.kodoModel;
      return {
        modelSelection: input.modelSelection,
        kodoRunModel:
          record !== undefined &&
          record.source !== "thread" &&
          modelSelectionsEqual(source!.modelSelection, input.modelSelection)
            ? { ...record, base: kodoThreadOwnModel(projection.thread) }
            : undefined,
      } satisfies KodoDispatchSelection;
    }
    if (keepsConversationModel(input)) {
      return { modelSelection: input.modelSelection, kodoRunModel: undefined };
    }
    // An unreadable settings file means no mode defaults, never a failed turn.
    const modeModelSelections = yield* services.serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.modeModelSelections),
      Effect.orElseSucceed(() => DEFAULT_KODO_MODE_MODELS),
    );
    const resolveInput = {
      // The judge reads in Review mode but answers on its own slot (judge, else review, else the thread's own).
      mode: input.loopStage?.stage === "judge" ? "judge" : projection.thread.interactionMode,
      thread: projection.thread,
      settings: { modeModelSelections },
      requested: command.modelSelection,
      explicitPick: command.explicitModelSelection,
      own: kodoOwnModelAfterQueue(projection.thread, input.queueTail),
    };
    let resolved = resolveKodoModeModel(resolveInput);
    if (resolved.source === "mode-default") {
      const reason = yield* unavailableReason(
        projection,
        resolved.selection,
        input.activeProviderThread,
      );
      if (reason !== null) {
        resolved = resolveKodoModeModel({ ...resolveInput, availability: () => reason });
      }
    }
    const tailDisplaced =
      input.queueTail?.kodoModel !== undefined &&
      !modelSelectionsEqual(input.queueTail.kodoModel.base, input.queueTail.modelSelection);
    // Only a run that a default touched, or that follows a displaced thread, needs the record.
    const recorded =
      resolved.hasDefault ||
      resolved.unavailable !== null ||
      projection.thread.kodoModeModel !== undefined ||
      tailDisplaced;
    return {
      modelSelection: resolved.selection,
      kodoRunModel: recorded ? kodoRunModelFor(resolved) : undefined,
    } satisfies KodoDispatchSelection;
  });

  /**
   * A queued run starts with what the thread is by then: the thread's own model is read again (it
   * may have been changed while the run waited), and a mode default that can no longer run falls
   * back to the thread's own model with the notice, as it would have at dispatch.
   */
  const reconcileQueuedStart = Effect.fn("KodoModeModelTurn.reconcileQueuedStart")(
    function* (input: {
      readonly projection: OrchestrationV2ThreadProjection;
      readonly run: OrchestrationV2Run;
      readonly activeProviderThread: OrchestrationV2ProviderThread | undefined;
      /** An existing provider thread of an instance, for a run that moves back to it. */
      readonly providerThreadFor: (
        instanceId: ModelSelection["instanceId"],
      ) => OrchestrationV2ProviderThread | undefined;
    }) {
      const { run, projection } = input;
      const record = run.kodoModel;
      if (record === undefined || record.source === "thread") {
        return { run, fallbackProviderThread: undefined };
      }
      const own = kodoThreadOwnModel(projection.thread);
      const rebased = modelSelectionsEqual(record.base, own)
        ? run
        : { ...run, kodoModel: { ...record, base: own } };
      if (record.source !== "mode-default" || modelSelectionsEqual(own, run.modelSelection)) {
        return { run: rebased, fallbackProviderThread: undefined };
      }
      const reason = yield* unavailableReason(
        projection,
        run.modelSelection,
        input.activeProviderThread,
      );
      if (reason === null) return { run: rebased, fallbackProviderThread: undefined };
      const moves = own.instanceId !== run.providerInstanceId;
      const fallbackProviderThread = moves ? input.providerThreadFor(own.instanceId) : undefined;
      // Without a conversation of the thread's own provider to return to, the run keeps its choice.
      if (moves && fallbackProviderThread === undefined) {
        return { run: rebased, fallbackProviderThread: undefined };
      }
      return {
        run: {
          ...run,
          modelSelection: own,
          providerInstanceId: own.instanceId,
          kodoModel: kodoRunModelFor({
            source: "thread",
            own,
            unavailable: { wanted: run.modelSelection, reason },
          }),
        },
        fallbackProviderThread,
      };
    },
  );

  return { selectForDispatch, reconcileQueuedStart, unavailableReason };
};

export type KodoModeModelTurn = ReturnType<typeof makeKodoModeModelTurn>;
