// Composer-side view of per-mode models: what the composer shows for the thread's mode, from the
// same rule the server applies at turn start (@t3tools/shared/kodoModeModel).
import type {
  KodoModeModels,
  KodoRunModel,
  ModelSelection,
  ProjectId,
  ServerProvider,
  ServerSettings,
  ThreadInteractionMode,
} from "@t3tools/contracts";
import {
  type KodoModeModelThread,
  type KodoResolvedModel,
  kodoAvailabilityFromProviders,
  kodoInstanceTurnedOff,
  kodoModeHasDefault,
  kodoModeModelSlot,
  kodoThreadOwnModel,
  resolveKodoModeModelSelection,
} from "@t3tools/shared/kodoModeModel";

export type KodoModelNote =
  | { readonly kind: "mode-default"; readonly label: string; readonly title: string }
  | { readonly kind: "picked"; readonly label: string; readonly title: string }
  | { readonly kind: "unavailable"; readonly label: string; readonly title: string };

export interface KodoComposerModel {
  readonly resolved: KodoResolvedModel;
  /** The thread's own model, which a send carries when no default is shown. */
  readonly own: ModelSelection;
  /** The configured selection the composer shows in place of the draft's, or null. */
  readonly shown: ModelSelection | null;
  readonly note: KodoModelNote | null;
}

const MODE_LABEL: Record<string, string> = {
  ask: "Ask",
  plan: "Plan",
  code: "Code",
  review: "Review",
};

export { kodoModeHasDefault };

export function resolveKodoComposerModel(input: {
  readonly mode: ThreadInteractionMode | undefined;
  readonly thread: KodoModeModelThread | null | undefined;
  readonly modeModels: KodoModeModels;
  readonly providers: ReadonlyArray<ServerProvider>;
  /** The driver a thread that cannot switch providers is tied to, else null. */
  readonly lockedDriver: string | null;
  /** The draft holds a pick made in this composer. */
  readonly explicitPick: boolean;
  /** Provider instances settings turn off, for the project the thread belongs to. */
  readonly instanceSettings?: {
    readonly settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">;
    readonly projectId: ProjectId | null;
  };
}): KodoComposerModel | null {
  if (input.thread == null || !kodoModeHasDefault(input.modeModels, input.mode)) return null;
  const own = kodoThreadOwnModel(input.thread);
  const providerCheck = kodoAvailabilityFromProviders(input.providers);
  const resolved = resolveKodoModeModelSelection({
    mode: input.mode,
    own,
    modeModels: input.modeModels,
    availability: (selection) => {
      const reason = providerCheck(selection);
      if (reason !== null) return reason;
      if (
        input.instanceSettings !== undefined &&
        kodoInstanceTurnedOff(
          input.instanceSettings.settings,
          input.instanceSettings.projectId,
          selection.instanceId,
        )
      ) {
        return "its provider is turned off for this project";
      }
      const driver = input.providers.find((p) => p.instanceId === selection.instanceId)?.driver;
      return input.lockedDriver !== null && driver !== input.lockedDriver
        ? "this thread cannot switch providers"
        : null;
    },
  });
  const label = MODE_LABEL[kodoModeModelSlot(input.mode)] ?? "Mode";
  if (input.explicitPick) {
    return {
      resolved,
      own,
      shown: null,
      note: {
        kind: "picked",
        label: "picked",
        title: `You picked this model for the next message. ${label} defaults to ${resolved.selection.model}; it applies again after you send or switch mode.`,
      },
    };
  }
  if (resolved.unavailable !== null) {
    return {
      resolved,
      own,
      shown: null,
      note: {
        kind: "unavailable",
        label: `${label} default unavailable`,
        title: `${resolved.unavailable.wanted.model} is unavailable (${resolved.unavailable.reason}), so this message uses the thread's model.`,
      },
    };
  }
  const providerChange = kodoProviderChange(
    input.providers,
    input.thread.modelSelection,
    resolved.selection,
  );
  return {
    resolved,
    own,
    shown: resolved.selection,
    note: {
      kind: "mode-default",
      label: `${label} default`,
      title:
        `${label} mode runs on this model (Settings, Models by mode). Pick another model to override it for the next message.` +
        (providerChange === null
          ? ""
          : ` This message runs on ${providerChange.to} instead of ${providerChange.from}, and the conversation carries over as a summary.`),
    },
  };
}

const providerName = (providers: ReadonlyArray<ServerProvider>, instanceId: string) => {
  const provider = providers.find((entry) => entry.instanceId === instanceId);
  return provider?.displayName ?? provider?.driver ?? instanceId;
};

/**
 * The provider names of a switch that replaces the live conversation with a summary of it, as the
 * server's handoff does; null when the model stays on the same provider (or one that continues it).
 */
export function kodoProviderChange(
  providers: ReadonlyArray<ServerProvider>,
  from: ModelSelection,
  to: ModelSelection,
): { readonly from: string; readonly to: string } | null {
  if (from.instanceId === to.instanceId) return null;
  const source = providers.find((entry) => entry.instanceId === from.instanceId);
  const target = providers.find((entry) => entry.instanceId === to.instanceId);
  const sharesConversation =
    source?.continuation?.groupKey !== undefined &&
    source.driver === target?.driver &&
    source.continuation.groupKey === target.continuation?.groupKey;
  return sharesConversation
    ? null
    : {
        from: providerName(providers, from.instanceId),
        to: providerName(providers, to.instanceId),
      };
}

/**
 * What the timeline says about a run whose mode default could not run, from the record the server
 * keeps on it: the model that ran and why the wanted one did not. Null when nothing was displaced.
 */
export function kodoRunModelNotice(
  run: { readonly modelSelection: ModelSelection; readonly kodoModel?: KodoRunModel | undefined },
  modelName: (selection: ModelSelection) => string,
  providerLabel: (instanceId: ModelSelection["instanceId"]) => string = (instanceId) => instanceId,
): { readonly label: string; readonly detail: string } | null {
  const unavailable = run.kodoModel?.unavailable;
  if (unavailable === undefined) return null;
  // The wanted model is named with its provider when that is not the provider that ran.
  const wanted =
    unavailable.wanted.instanceId === run.modelSelection.instanceId
      ? modelName(unavailable.wanted)
      : `${modelName(unavailable.wanted)} on ${providerLabel(unavailable.wanted.instanceId)}`;
  return {
    label: `Used ${modelName(run.modelSelection)}`,
    detail: `${wanted} not used: ${unavailable.reason.replace(/\.$/, "")}`,
  };
}
