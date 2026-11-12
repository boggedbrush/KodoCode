// Kodo per-mode model resolution, shared by the server turn-start path and the web composer
// preview so both apply one rule. Pure: callers supply settings and an availability check.
//
// Precedence for one turn, highest first:
//   1. an explicit pick sent with the message ("explicit")
//   2. the mode's configured model, if it is available ("mode-default")
//   3. the thread's own model ("thread"), also the fallback when the configured one is unavailable
import {
  type KodoInteractionMode,
  type KodoModelSource,
  type KodoRunModel,
  type KodoThreadModeModel,
  type KodoModeModelSlot,
  type KodoModeModels,
  type ModelSelection,
  type ServerProvider,
  normalizeKodoInteractionMode,
} from "@t3tools/contracts";

import { draftModelPickMatchesThread, modelSelectionsEqual } from "./model.ts";

export type { KodoModelSource, KodoRunModel, KodoThreadModeModel };

export interface KodoModeModelThread {
  readonly modelSelection: ModelSelection;
  readonly kodoModeModel?: KodoThreadModeModel | null | undefined;
}

/** Null when the selection can run, otherwise a short reason a person can read. */
export type KodoModelAvailability = (selection: ModelSelection) => string | null;

export const KODO_ALWAYS_AVAILABLE: KodoModelAvailability = () => null;

export interface KodoResolvedModel {
  readonly slot: KodoModeModelSlot;
  readonly selection: ModelSelection;
  readonly source: KodoModelSource;
  /** The thread's own model, which `thread` falls back to and a mode default displaces. */
  readonly own: ModelSelection;
  /** Set when the mode has a configured model that could not be used. */
  readonly unavailable: { readonly wanted: ModelSelection; readonly reason: string } | null;
}

/** The slot a thread mode reads; an unknown or legacy stored mode reads as the code slot. */
export const kodoModeModelSlot = (mode: unknown): KodoModeModelSlot =>
  normalizeKodoInteractionMode(mode);

/** The model the thread has by itself: its selection, unless a mode default is standing in for it. */
export function kodoThreadOwnModel(thread: KodoModeModelThread): ModelSelection {
  const record = thread.kodoModeModel;
  return record != null && modelSelectionsEqual(thread.modelSelection, record.applied)
    ? record.base
    : thread.modelSelection;
}

/**
 * The thread's own model once every queued run has started: the last queued run's, which a
 * mode-default run carries as its base.
 */
export function kodoOwnModelAfterQueue(
  thread: KodoModeModelThread,
  queueTail:
    | { readonly modelSelection: ModelSelection; readonly kodoModel?: KodoRunModel | undefined }
    | undefined,
): ModelSelection {
  if (queueTail === undefined) return kodoThreadOwnModel(thread);
  return queueTail.kodoModel?.source === "mode-default"
    ? queueTail.kodoModel.base
    : queueTail.modelSelection;
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
  const base = { slot, own: input.own };
  if (input.explicit !== undefined) {
    return { ...base, selection: input.explicit, source: "explicit", unavailable: null };
  }
  // Judge follows the review model when it has none of its own; both then follow the thread.
  const configured = input.modeModels[slot] ?? (slot === "judge" ? input.modeModels.review : null);
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
 * Whether a send carries a pick of its own: flagged by the client, or (agents, scheduled tasks,
 * mobile) a selection that is neither the thread's own model nor the mode's configured one.
 */
export function kodoSendIsExplicitPick(input: {
  readonly requested: ModelSelection | undefined;
  readonly flagged: boolean | undefined;
  readonly own: ModelSelection;
  readonly configured: ModelSelection | null;
}): boolean {
  const { requested } = input;
  if (requested === undefined || input.configured === null) return false;
  if (input.flagged !== undefined) return input.flagged;
  return (
    !draftModelPickMatchesThread(requested, input.own) &&
    !draftModelPickMatchesThread(requested, input.configured)
  );
}

/** The record a thread keeps when `resolved` displaces its own model; undefined otherwise. */
export function kodoThreadModeModelFor(resolved: {
  readonly selection: ModelSelection;
  readonly source: KodoModelSource;
  readonly own: ModelSelection;
}): KodoThreadModeModel | undefined {
  return resolved.source === "mode-default" &&
    !modelSelectionsEqual(resolved.selection, resolved.own)
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
