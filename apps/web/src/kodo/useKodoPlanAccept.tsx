import type {
  EnvironmentId,
  KodoInteractionMode,
  RuntimeMode,
  ThreadId,
  ThreadInteractionMode,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { ModelSelection } from "@t3tools/contracts";
import { CodeXmlIcon, ListChecksIcon } from "lucide-react";
import { useState } from "react";

import type { ComposerBannerStackItem } from "../components/chat/ComposerBannerStack";
import { Button } from "../components/ui/button";
import type { ComposerHandleRef } from "../composerHandleContext";
import { useStableCallback } from "../hooks/useStableCallback";
import {
  buildPlanAcceptanceTurn,
  shouldOfferPlanAcceptance,
  type KodoPlanOffer,
} from "./planAccept.logic";
import type { KodoModeSyncOutcome } from "./interactionModeSync";
import { useKodoCodeHandoff } from "./useKodoCodeHandoff";
import { KodoModeActionButton } from "./KodoModeActionButton";

/**
 * Plan mode is read-only, so a banner offers a ready plan: accepting switches the thread to Code
 * and starts the implementation turn, and a failed start puts the thread back in Plan. "Keep planning" (or replying) keeps the thread in Plan.
 */
export function useKodoPlanAccept(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly isServerThread: boolean;
  readonly canOperateThread: boolean;
  readonly offer: KodoPlanOffer | null;
  readonly latestRunSettled: boolean;
  readonly pendingUserInputCount: number;
  readonly isSendBusy: boolean;
  readonly interactionMode: KodoInteractionMode;
  readonly runtimeMode: RuntimeMode;
  readonly fallbackModelSelection: ModelSelection | undefined;
  readonly composerRef: ComposerHandleRef;
  readonly commitInteractionMode: (mode: ThreadInteractionMode) => Promise<KodoModeSyncOutcome>;
  readonly persistThreadSettingsForNextTurn: (input: {
    threadId: ThreadId;
    createdAt: string;
    runtimeMode: RuntimeMode;
    interactionMode: ThreadInteractionMode;
  }) => Promise<AtomCommandResult<void, unknown>>;
  readonly setThreadError: (threadId: ThreadId, message: string | null) => void;
}): ComposerBannerStackItem | null {
  const [dismissedOfferKey, setDismissedOfferKey] = useState<string | null>(null);
  const handoff = useKodoCodeHandoff(input);
  const accepting = handoff.busy;
  const stillOffered = () =>
    input.isServerThread &&
    input.threadId !== null &&
    shouldOfferPlanAcceptance({
      interactionMode: input.interactionMode,
      latestRunSettled: input.latestRunSettled,
      pendingUserInputCount: input.pendingUserInputCount,
      offer: input.offer,
      dismissedOfferKey,
      canOperateThread: input.canOperateThread,
    });
  const offered = stillOffered();

  const accept = useStableCallback(async () => {
    const { threadId, offer } = input;
    if (offer === null || threadId === null) return;
    const turn = buildPlanAcceptanceTurn({ threadId, offer });
    await handoff.start({
      text: turn.text,
      ...(turn.sourceProposedPlan ? { sourceProposedPlan: turn.sourceProposedPlan } : {}),
      stillOffered,
      returnTo: "plan",
      failureMessage: "Failed to start the plan.",
    });
  });

  if (!offered || input.offer === null) return null;
  const { offer } = input;
  return {
    id: "kodo-plan-ready",
    variant: "info",
    icon: <ListChecksIcon />,
    title: offer.kind === "artifact" ? "Plan ready" : "Ready to implement?",
    description:
      offer.title ??
      (offer.kind === "artifact"
        ? "Review the plan above, then implement it or reply to refine it."
        : "Implement the plan above, or reply to keep planning."),
    actions: (
      <>
        <KodoModeActionButton
          mode="plan"
          icon={ListChecksIcon}
          disabled={accepting}
          onClick={() => setDismissedOfferKey(offer.key)}
        >
          Keep planning
        </KodoModeActionButton>
        <Button size="xs" disabled={accepting || input.isSendBusy} onClick={() => void accept()}>
          <CodeXmlIcon aria-hidden />
          {accepting ? "Starting..." : "Implement in Code"}
        </Button>
      </>
    ),
  };
}
