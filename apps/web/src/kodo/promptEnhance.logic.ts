// Kodo prompt enhance: the pure part. State machine, draft guards and the check that a rewrite
// kept every reference the draft carried. The request and the UI live beside it.
import { KODO_PROMPT_ENHANCE_MAX_CHARS } from "@t3tools/contracts";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { collectComposerInlineTokens } from "@t3tools/shared/composerInlineTokens";

export type PromptEnhanceState =
  | { readonly phase: "idle" }
  | { readonly phase: "enhancing"; readonly original: string }
  /** The draft now holds `enhanced`; `original` is what one undo restores. */
  | { readonly phase: "enhanced"; readonly original: string; readonly enhanced: string };

export type PromptEnhanceEvent =
  | { readonly type: "start"; readonly original: string }
  | { readonly type: "succeed"; readonly original: string; readonly enhanced: string }
  /** Failure, cancellation, a refused rewrite or a draft that moved on: the draft stays as it is. */
  | { readonly type: "end" }
  | { readonly type: "undo" };

export const IDLE_PROMPT_ENHANCE_STATE: PromptEnhanceState = { phase: "idle" };

export function promptEnhanceReducer(
  state: PromptEnhanceState,
  event: PromptEnhanceEvent,
): PromptEnhanceState {
  switch (event.type) {
    case "start":
      return state.phase === "enhancing" ? state : { phase: "enhancing", original: event.original };
    case "succeed":
      return state.phase === "enhancing" && state.original === event.original
        ? { phase: "enhanced", original: event.original, enhanced: event.enhanced }
        : state;
    case "end":
      return IDLE_PROMPT_ENHANCE_STATE;
    case "undo":
      return state.phase === "enhanced" ? IDLE_PROMPT_ENHANCE_STATE : state;
  }
}

/**
 * Undo is offered only while the draft still is the rewrite. Once the person edits it, an undo
 * would throw those edits away, so the offer goes with them.
 */
export function undoableOriginal(state: PromptEnhanceState, draft: string): string | null {
  return state.phase === "enhanced" && draft === state.enhanced ? state.original : null;
}

export type PromptEnhanceBlock =
  | { readonly kind: "empty" }
  | { readonly kind: "too-long"; readonly limit: number };

export function promptEnhanceBlock(draft: string): PromptEnhanceBlock | null {
  if (draft.trim().length === 0) return { kind: "empty" };
  if (draft.length > KODO_PROMPT_ENHANCE_MAX_CHARS) {
    return { kind: "too-long", limit: KODO_PROMPT_ENHANCE_MAX_CHARS };
  }
  return null;
}

/** What a rewrite must carry over verbatim: attached context links, @mentions and $skills. */
function referenceSources(text: string): ReadonlyArray<string> {
  return [
    ...collectComposerContextReferences(text).map((reference) => reference.source),
    ...collectComposerInlineTokens(text).map((token) => token.source),
  ];
}

/**
 * References the draft had that the rewrite lost, each listed once per missing copy. A rewrite
 * that drops one is refused: an attachment chip or mention the person placed is not the model's
 * to remove.
 */
export function droppedReferences(original: string, enhanced: string): ReadonlyArray<string> {
  const remaining = new Map<string, number>();
  for (const source of referenceSources(enhanced)) {
    remaining.set(source, (remaining.get(source) ?? 0) + 1);
  }
  const dropped: string[] = [];
  for (const source of referenceSources(original)) {
    const left = remaining.get(source) ?? 0;
    if (left > 0) remaining.set(source, left - 1);
    else dropped.push(source);
  }
  return dropped;
}

export type PromptEnhanceOutcome =
  | { readonly kind: "apply"; readonly text: string }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly dropped: ReadonlyArray<string> };

/** Decides what the draft becomes when the model's answer arrives. */
export function resolvePromptEnhanceOutcome(
  original: string,
  generated: string,
): PromptEnhanceOutcome {
  const text = generated.trim();
  if (text.length === 0 || text === original.trim()) return { kind: "unchanged" };
  const dropped = droppedReferences(original, text);
  return dropped.length > 0 ? { kind: "refused", dropped } : { kind: "apply", text };
}

/** The line shown when the request fails. The draft is untouched either way. */
export function describePromptEnhanceFailure(error: unknown): string {
  const tagged = error as { readonly _tag?: string; readonly status?: number; message?: string };
  switch (tagged?._tag) {
    case "KodoPromptEnhanceError":
      return tagged.message ?? "The model could not rewrite this prompt.";
    case "RemoteEnvironmentAuthUndeclaredStatusError":
      return tagged.status === 404
        ? "This environment's server is too old to enhance prompts. Update it and try again."
        : "The environment could not enhance this prompt.";
    case "RemoteEnvironmentAuthTimeoutError":
      return "The model took too long to answer.";
    case "EnvironmentInternalError":
      return "The environment could not enhance this prompt.";
    default:
      return error instanceof Error && error.message.length > 0
        ? error.message
        : "The prompt could not be enhanced.";
  }
}

/** Why Enhance cannot run for this composer right now, in the words its tooltip shows. */
export function promptEnhanceUnavailableReason(input: {
  readonly noProviderAvailable: boolean;
  readonly canOperateThread: boolean;
  readonly environmentUnavailable: boolean;
  readonly projectSelectionRequired: boolean;
  readonly sendBusy: boolean;
}): string | null {
  if (input.noProviderAvailable) return "Enable a provider in Settings to enhance prompts";
  if (!input.canOperateThread) return "This device cannot run prompts on this environment";
  if (input.environmentUnavailable) return "This environment is unavailable";
  if (input.projectSelectionRequired) return "Choose a project first";
  if (input.sendBusy) return "Wait for the message to finish sending";
  return null;
}
