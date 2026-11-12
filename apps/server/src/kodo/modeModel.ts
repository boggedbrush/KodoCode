// Kodo per-mode models, server side. `resolveKodoModeModel` is the one function that answers
// "which model/provider/effort runs this turn" for a mode or role slot; the turn-start path calls it
// and the web composer previews with the same shared rule (@t3tools/shared/kodoModeModel).
import type { KodoModeModelSlot, KodoModeModels, ModelSelection } from "@t3tools/contracts";
import { draftModelPickMatchesThread } from "@t3tools/shared/model";
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
  /**
   * True: a person or an agent chose `requested` for this message. False: it is only the carried
   * model of the sender's view of the thread. Absent (older clients): inferred, see kodoSendIsExplicitPick.
   */
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
  const slot =
    input.mode === "orchestrator" || input.mode === "judge"
      ? input.mode
      : kodoModeModelSlot(input.mode);
  const modeModels = input.settings.modeModelSelections;
  // A selection that is just the displaced mode model coming back is not a pick of the sender's.
  // The composer's own model read through the live session's provider instance is recognised only
  // when the sender says it is carrying (flag false): an unflagged sender (an agent, mobile) that
  // names the thread's own model while it is displaced has chosen it.
  const record = input.thread.kodoModeModel;
  const requested =
    record != null &&
    input.explicitPick !== true &&
    input.requested !== undefined &&
    (draftModelPickMatchesThread(input.requested, record.applied) ||
      (input.explicitPick === false &&
        input.requested.instanceId === record.applied.instanceId &&
        input.requested.model === record.base.model))
      ? undefined
      : input.requested;
  const configured = modeModels[slot] ?? (slot === "judge" ? modeModels.review : null);
  const explicit = kodoSendIsExplicitPick({
    requested,
    flagged: input.explicitPick,
    own,
    configured,
    displaced: record != null,
  });
  const resolved = resolveKodoModeModelSelection({
    mode: slot,
    own,
    modeModels,
    ...(input.availability === undefined ? {} : { availability: input.availability }),
    explicit: explicit ? requested : undefined,
  });
  if (requested === undefined) return resolved;
  // Without a default the sender's selection is simply the thread's model from here on.
  if (configured === null) return { ...resolved, selection: requested, own: requested };
  // The sender's carried selection is the thread's model as the sender knows it, so it also stands
  // in when the mode's configured model cannot run.
  return resolved.unavailable !== null ? { ...resolved, selection: requested } : resolved;
}
