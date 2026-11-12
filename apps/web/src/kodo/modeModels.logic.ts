// Composer-side view of per-mode models: what the composer shows for the thread's mode, from the
// same rule the server applies at turn start (@t3tools/shared/kodoModeModel).
import type {
  KodoModeModels,
  ModelSelection,
  ServerProvider,
  ThreadInteractionMode,
} from "@t3tools/contracts";
import {
  type KodoModeModelThread,
  type KodoResolvedModel,
  kodoAvailabilityFromProviders,
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

export const kodoModeHasDefault = (modeModels: KodoModeModels, mode: unknown): boolean =>
  modeModels[kodoModeModelSlot(mode)] !== null;

export function resolveKodoComposerModel(input: {
  readonly mode: ThreadInteractionMode | undefined;
  readonly thread: KodoModeModelThread | null | undefined;
  readonly modeModels: KodoModeModels;
  readonly providers: ReadonlyArray<ServerProvider>;
  /** The driver a thread that cannot switch providers is tied to, else null. */
  readonly lockedDriver: string | null;
  /** The draft holds a pick made in this composer. */
  readonly explicitPick: boolean;
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
  return {
    resolved,
    own,
    shown: resolved.selection,
    note: {
      kind: "mode-default",
      label: `${label} default`,
      title: `${label} mode runs on this model (Settings, Models by mode). Pick another model to override it for the next message.`,
    },
  };
}
