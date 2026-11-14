import type { ThreadInteractionMode } from "@t3tools/contracts";
import { useEffect } from "react";

import type { ComposerHandleRef } from "../composerHandleContext";
import { useStableCallback } from "../hooks/useStableCallback";
import type { KodoModeSyncOutcome } from "./interactionModeSync";
import { kodoReviewPrompt, registerKodoReviewRequest } from "./reviewRequest";

/** Registers the thread's "Review" action while it is offered; see reviewRequest.ts. */
export function useKodoReviewRequest(input: {
  readonly threadKey: string;
  readonly offered: boolean;
  readonly composerRef: ComposerHandleRef;
  readonly commitInteractionMode: (mode: ThreadInteractionMode) => Promise<KodoModeSyncOutcome>;
  readonly setThreadError: (message: string) => void;
}) {
  const open = useStableCallback(async () => {
    const outcome = await input.commitInteractionMode("review");
    if (!outcome.ok) {
      input.setThreadError(outcome.message);
      return;
    }
    const composer = input.composerRef.current;
    composer?.insertTextAtEnd(kodoReviewPrompt(), { ensureLeadingBoundary: true });
    composer?.focusAtEnd();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the action with the changed-files card, which lives outside this component's tree
  useEffect(
    () =>
      input.offered ? registerKodoReviewRequest(input.threadKey, () => void open()) : undefined,
    [input.offered, input.threadKey, open],
  );
}
