// Kodo prompt enhance: runs one rewrite at a time for a composer draft. A draft is never sent or
// changed by this hook except through `replaceDraft`, and only to the exact text it read.
import type { KodoInteractionMode } from "@t3tools/contracts";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { useEffect, useReducer, useRef } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { toastManager } from "../components/ui/toast";
import {
  describePromptEnhanceFailure,
  IDLE_PROMPT_ENHANCE_STATE,
  promptEnhanceBlock,
  promptEnhanceReducer,
  resolvePromptEnhanceOutcome,
  undoableOriginal,
} from "./promptEnhance.logic";
import { requestPromptEnhancement } from "./promptEnhance.request";

export interface UsePromptEnhanceInput {
  readonly draft: string;
  /** The thread's mode when the rewrite starts; it shapes how the draft is rephrased. */
  readonly interactionMode: KodoInteractionMode;
  readonly prepared: PreparedConnection | null;
  /** Replaces the whole draft when it still is `expected`; false when it moved on. */
  readonly replaceDraft: (expected: string, next: string) => boolean;
}

export function usePromptEnhance(input: UsePromptEnhanceInput) {
  const [state, dispatch] = useReducer(promptEnhanceReducer, IDLE_PROMPT_ENHANCE_STATE);
  const inFlight = useRef<AbortController | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- aborts the in-flight request when the composer unmounts
  useEffect(() => () => inFlight.current?.abort(), []);

  const cancel = useStableCallback(() => {
    inFlight.current?.abort();
  });

  const enhance = useStableCallback(async () => {
    const { draft, prepared, replaceDraft, interactionMode } = input;
    if (inFlight.current !== null || prepared === null || promptEnhanceBlock(draft) !== null) {
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    dispatch({ type: "start", original: draft });
    let generated: Awaited<ReturnType<typeof requestPromptEnhancement>>;
    try {
      generated = await requestPromptEnhancement({
        prepared,
        prompt: draft,
        interactionMode,
        signal: controller.signal,
      });
    } catch (error) {
      if (inFlight.current === controller) inFlight.current = null;
      dispatch({ type: "end" });
      // A cancel is the person's own choice; it needs no message.
      if (!controller.signal.aborted) {
        toastManager.add({
          type: "error",
          title: "Could not enhance prompt",
          description: describePromptEnhanceFailure(error),
        });
      }
      return;
    }
    if (inFlight.current === controller) inFlight.current = null;
    const outcome = resolvePromptEnhanceOutcome(draft, generated);
    if (outcome.kind === "unchanged") {
      dispatch({ type: "end" });
      toastManager.add({
        type: "info",
        title: "Nothing to enhance",
        description: "The model left this prompt as it was.",
      });
    } else if (outcome.kind === "refused") {
      dispatch({ type: "end" });
      toastManager.add({
        type: "warning",
        title: "Enhance changed your references",
        description: `The rewrite dropped ${outcome.dropped.length === 1 ? "a mention or attachment" : `${outcome.dropped.length} mentions or attachments`}, so it was not applied. Your prompt is unchanged.`,
      });
    } else if (replaceDraft(draft, outcome.text)) {
      dispatch({ type: "succeed", original: draft, enhanced: outcome.text });
    } else {
      dispatch({ type: "end" });
      toastManager.add({
        type: "info",
        title: "Prompt changed while enhancing",
        description: "Your newer edits were kept and the rewrite was discarded.",
      });
    }
  });

  const undoOriginal = undoableOriginal(state, input.draft);
  const undo = useStableCallback(() => {
    const { draft, replaceDraft } = input;
    if (state.phase !== "enhanced" || draft !== state.enhanced) return;
    if (replaceDraft(draft, state.original)) dispatch({ type: "undo" });
  });

  return {
    enhancing: state.phase === "enhancing",
    canUndo: undoOriginal !== null,
    enhance,
    cancel,
    undo,
  };
}
