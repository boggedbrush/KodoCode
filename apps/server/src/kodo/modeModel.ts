// Kodo per-mode models, server side. `resolveKodoModeModel` is the one function that answers
// "which model/provider/effort runs this turn" for a mode or role slot; the turn-start path calls it
// and the web composer previews with the same shared rule (@t3tools/shared/kodoModeModel).
import type {
  KodoModeModelSlot,
  KodoModeModels,
  ModelSelection,
  ServerProvider,
} from "@t3tools/contracts";
import {
  type KodoModeModelThread,
  type KodoModelAvailability,
  type KodoResolvedModel,
  kodoModeModelSlot,
  kodoSendIsExplicitPick,
  kodoThreadOwnModel,
  resolveKodoModeModelSelection,
} from "@t3tools/shared/kodoModeModel";

export interface ResolveKodoModeModelInput {
  /** A thread mode, or the `orchestrator` / `judge` role. */
  readonly mode: KodoModeModelSlot | string | undefined;
  readonly thread: KodoModeModelThread;
  readonly settings: { readonly modeModelSelections: KodoModeModels };
  /** Null when the selection can run; otherwise why not. Defaults to always available. */
  readonly availability?: KodoModelAvailability;
  /** The selection the sender attached, if any. */
  readonly requested?: ModelSelection | undefined;
  /** True: the user picked `requested`. False: it is only the composer's carried model. Absent: inferred. */
  readonly explicitPick?: boolean | undefined;
  /** Replaces the thread's own model, for a queue whose tail has not started yet. */
  readonly own?: ModelSelection | undefined;
}

/**
 * Precedence: explicit pick, then the mode's configured model (judge falls back to review), then the
 * thread's own model. An unavailable configured model falls back to the thread's own with
 * `unavailable` set so the caller can say so; it never throws.
 */
export function resolveKodoModeModel(input: ResolveKodoModeModelInput): KodoResolvedModel {
  const own = input.own ?? kodoThreadOwnModel(input.thread);
  const slot = input.mode === "orchestrator" || input.mode === "judge" ? input.mode : kodoModeModelSlot(input.mode);
  const modeModels = input.settings.modeModelSelections;
  const configured = modeModels[slot] ?? (slot === "judge" ? modeModels.review : null);
  const explicit = kodoSendIsExplicitPick({
    requested: input.requested,
    flagged: input.explicitPick,
    own,
    configured,
  });
  const resolved = resolveKodoModeModelSelection({
    mode: slot,
    own,
    modeModels,
    ...(input.availability === undefined ? {} : { availability: input.availability }),
    explicit: explicit ? input.requested : undefined,
  });
  // Nothing configured: today's behaviour, the sender's selection or else the thread's.
  return configured === null && input.requested !== undefined
    ? { ...resolved, selection: input.requested, source: "explicit" }
    : resolved;
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
