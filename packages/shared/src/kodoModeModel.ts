// Kodo per-mode model resolution, shared by the server turn start and the web composer preview.
// Precedence: explicit pick, then the mode's configured model (judge: review), then the thread's own.
import {
  type KodoInteractionMode,
  type KodoModelSource,
  type KodoRunModel,
  type KodoThreadModeModel,
  type KodoModeModelSlot,
  type KodoModeModels,
  type ModelSelection,
  type ProjectId,
  type ServerProvider,
  type ServerSettings,
  normalizeKodoInteractionMode,
  resolveProviderInstanceEnabled,
} from "@t3tools/contracts";

import { draftModelPickMatchesThread, modelSelectionsEqual } from "./model.ts";

export type { KodoModelSource, KodoRunModel, KodoThreadModeModel };

export interface KodoModeModelThread {
  readonly modelSelection: ModelSelection;
  readonly kodoModeModel?: KodoThreadModeModel | null | undefined;
}

/** Null when the selection can run, otherwise a short reason a person can read. */
export type KodoModelAvailability = (selection: ModelSelection) => string | null;

const KODO_ALWAYS_AVAILABLE: KodoModelAvailability = () => null;

export interface KodoResolvedModel {
  readonly slot: KodoModeModelSlot;
  readonly selection: ModelSelection;
  readonly source: KodoModelSource;
  /**
   * The thread's own model once this turn has started: what `thread` falls back to and a mode
   * default displaces. A pick in a mode without a default becomes the thread's model, so it is its own.
   */
  readonly own: ModelSelection;
  /** The mode (or, for judge, review) has a configured model. */
  readonly hasDefault: boolean;
  /** Set when the mode has a configured model that could not be used. */
  readonly unavailable: { readonly wanted: ModelSelection; readonly reason: string } | null;
}

/** The slot a thread mode reads; an unknown or legacy stored mode reads as the code slot. */
export const kodoModeModelSlot = (mode: unknown): KodoModeModelSlot =>
  normalizeKodoInteractionMode(mode);

/** Whether a mode (or role: `orchestrator` for a lead) has a configured default model. */
export const kodoModeHasDefault = (modeModels: KodoModeModels, mode: unknown): boolean =>
  modeModels[mode === "orchestrator" || mode === "judge" ? mode : kodoModeModelSlot(mode)] !== null;

/** The model the thread has by itself: its selection, unless a mode default is standing in for it. */
export function kodoThreadOwnModel(thread: KodoModeModelThread): ModelSelection {
  const record = thread.kodoModeModel;
  return record != null && modelSelectionsEqual(thread.modelSelection, record.applied)
    ? record.base
    : thread.modelSelection;
}

/**
 * The thread's own model once every queued run has started: the last queued run's `base`, which
 * every run that records one keeps as the thread's own model after it; else its selection.
 */
export function kodoOwnModelAfterQueue(
  thread: KodoModeModelThread,
  queueTail:
    | { readonly modelSelection: ModelSelection; readonly kodoModel?: KodoRunModel | undefined }
    | undefined,
): ModelSelection {
  if (queueTail === undefined) return kodoThreadOwnModel(thread);
  return queueTail.kodoModel?.base ?? queueTail.modelSelection;
}

export function resolveKodoModeModelSelection(input: {
  readonly mode: KodoInteractionMode | KodoModeModelSlot | string | undefined;
  readonly own: ModelSelection;
  readonly modeModels: KodoModeModels;
  readonly availability?: KodoModelAvailability;
  /** A pick the user made for this message. */
  readonly explicit?: ModelSelection | undefined;
}): KodoResolvedModel {
  const slot =
    input.mode === "orchestrator" || input.mode === "judge"
      ? input.mode
      : kodoModeModelSlot(input.mode);
  // Judge follows the review model when it has none of its own; both then follow the thread.
  const configured = input.modeModels[slot] ?? (slot === "judge" ? input.modeModels.review : null);
  const base = { slot, own: input.own, hasDefault: configured !== null };
  if (input.explicit !== undefined) {
    // In a mode with a default a pick is for one message and the thread keeps its own model; in a
    // mode without one it becomes the thread's model, as everywhere else.
    return {
      ...base,
      own: configured === null ? input.explicit : input.own,
      selection: input.explicit,
      source: "explicit",
      unavailable: null,
    };
  }
  if (configured === null) {
    return { ...base, selection: input.own, source: "thread", unavailable: null };
  }
  const reason = (input.availability ?? KODO_ALWAYS_AVAILABLE)(configured);
  if (reason !== null) {
    return {
      ...base,
      selection: input.own,
      source: "thread",
      unavailable: { wanted: configured, reason },
    };
  }
  return { ...base, selection: configured, source: "mode-default", unavailable: null };
}

/**
 * Whether a send carries a pick of its own. Senders say so with the flag; without it (older
 * clients) a selection that is neither the thread's own model nor the mode's configured one is a
 * pick. While the thread is displaced by a mode default, its own model is not what such a client
 * carries, so even a selection equal to it differs from the displaced state and counts as a pick.
 */
export function kodoSendIsExplicitPick(input: {
  readonly requested: ModelSelection | undefined;
  readonly flagged: boolean | undefined;
  readonly own: ModelSelection;
  readonly configured: ModelSelection | null;
  readonly displaced?: boolean | undefined;
}): boolean {
  const { requested } = input;
  if (requested === undefined || input.configured === null) return false;
  if (input.flagged !== undefined) return input.flagged;
  return (
    (input.displaced === true || !draftModelPickMatchesThread(requested, input.own)) &&
    !draftModelPickMatchesThread(requested, input.configured)
  );
}

/**
 * The record a thread keeps when `resolved` displaces its own model: a mode default, or a pick
 * made in a mode that has one (a pick in a mode without one is its own model, so nothing differs).
 */
export function kodoThreadModeModelFor(resolved: {
  readonly selection: ModelSelection;
  readonly source: KodoModelSource;
  readonly own: ModelSelection;
}): KodoThreadModeModel | undefined {
  return resolved.source !== "thread" && !modelSelectionsEqual(resolved.selection, resolved.own)
    ? { applied: resolved.selection, base: resolved.own }
    : undefined;
}

/** The record a run keeps. */
export function kodoRunModelFor(resolved: {
  readonly source: KodoModelSource;
  readonly own: ModelSelection;
  readonly unavailable?: KodoResolvedModel["unavailable"];
}): KodoRunModel {
  return {
    source: resolved.source,
    base: resolved.own,
    ...(resolved.unavailable == null ? {} : { unavailable: resolved.unavailable }),
  };
}

/** Availability from the provider catalogue: installed, enabled, signed in, and still offering the model. */
export function kodoAvailabilityFromProviders(
  providers: ReadonlyArray<ServerProvider>,
): KodoModelAvailability {
  return (selection) => {
    const provider = providers.find((entry) => entry.instanceId === selection.instanceId);
    if (provider === undefined) return "its provider is not configured";
    if (!provider.enabled) return "its provider is turned off";
    if (!provider.installed) return "its provider is not installed";
    if (provider.status === "error") return "its provider reports an error";
    if (provider.auth.status === "unauthenticated") return "its provider is not signed in";
    if (
      provider.models.length > 0 &&
      !provider.models.some(
        (model) => model.slug === selection.model || model.aliases?.includes(selection.model),
      )
    ) {
      return "the provider no longer offers that model";
    }
    return null;
  };
}

/**
 * Whether settings turn a provider instance off for a project: the project's own override, else the
 * machine's. An instance settings say nothing about is not turned off here (the catalogue knows
 * whether it is installed); both the composer preview and the turn start ask this.
 */
export function kodoInstanceTurnedOff(
  settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">,
  projectId: ProjectId | null,
  instanceId: ModelSelection["instanceId"],
): boolean {
  const override =
    projectId === null
      ? undefined
      : settings.projectSettingsOverrides[projectId]?.providerInstances?.[instanceId]?.enabled;
  if (override !== undefined) return !override;
  const machine = Object.hasOwn(settings.providerInstances, instanceId)
    ? settings.providerInstances[instanceId]
    : undefined;
  return machine !== undefined && !resolveProviderInstanceEnabled(machine);
}
