import type {
  EnvironmentId,
  RuntimeMode,
  ThreadId,
  ThreadInteractionMode,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { ModelSelection } from "@t3tools/contracts";
import { CodeXmlIcon, ScanSearchIcon } from "lucide-react";
import { useLayoutEffect, useState } from "react";

import type { ComposerBannerStackItem } from "../components/chat/ComposerBannerStack";
import { Button } from "../components/ui/button";
import type { ComposerHandleRef } from "../composerHandleContext";
import { useStableCallback } from "../hooks/useStableCallback";
import type { KodoModeSyncOutcome } from "./interactionModeSync";
import { registerKodoFindingsBlock } from "./findingsBlockStore";
import { KodoFindingsCard } from "./KodoFindingsCard";
import {
  buildFindingsFixTurn,
  canFixFindings,
  kodoFindingsTitle,
  shouldShowFindingsCard,
  type KodoFindingsOffer,
} from "./reviewFindings.logic";
import { useKodoCodeHandoff } from "./useKodoCodeHandoff";

/**
 * Review mode is read-only, so a settled review's findings come back as a card above the composer.
 * "Fix in Code" switches the thread to Code and starts a turn with the findings; a failed start puts
 * the thread back in Review. While the card is shown, the timeline leaves the reply's raw block out.
 */
export function useKodoFindings(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly isServerThread: boolean;
  readonly canOperateThread: boolean;
  readonly offer: KodoFindingsOffer | null;
  readonly latestRunSettled: boolean;
  readonly pendingUserInputCount: number;
  readonly isSendBusy: boolean;
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
  const shown =
    input.isServerThread && shouldShowFindingsCard({ offer: input.offer, dismissedOfferKey });
  const blockMessageId = shown ? (input.offer?.messageId ?? null) : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the timeline's external store which reply this card replaces; a layout effect applies before paint, so the raw block never shows beside the card
  useLayoutEffect(
    () => (blockMessageId === null ? undefined : registerKodoFindingsBlock(blockMessageId)),
    [blockMessageId],
  );
  const canFix = () =>
    input.isServerThread &&
    input.threadId !== null &&
    canFixFindings({
      offer: input.offer,
      dismissedOfferKey,
      latestRunSettled: input.latestRunSettled,
      pendingUserInputCount: input.pendingUserInputCount,
      canOperateThread: input.canOperateThread,
    });

  const fix = useStableCallback(async () => {
    const { offer } = input;
    if (offer === null) return;
    const turn = buildFindingsFixTurn(offer.review);
    await handoff.start({
      text: turn.text,
      stillOffered: canFix,
      returnTo: "review",
      failureMessage: "Failed to start the fixes.",
      wording: { notStarted: "The fixes did not start.", returnMode: "Review" },
    });
  });

  if (!shown || input.offer === null) return null;
  const { offer } = input;
  return {
    id: "kodo-review-findings",
    variant: "info",
    icon: <ScanSearchIcon className="text-mode-review" />,
    title: kodoFindingsTitle(offer.review),
    description: offer.review.summary,
    children: <KodoFindingsCard review={offer.review} />,
    dismissLabel: "Dismiss review findings",
    onDismiss: () => setDismissedOfferKey(offer.key),
    actions: canFix() ? (
      <Button size="xs" disabled={handoff.busy || input.isSendBusy} onClick={() => void fix()}>
        <CodeXmlIcon aria-hidden />
        {handoff.busy ? "Starting..." : "Fix in Code"}
      </Button>
    ) : undefined,
  };
}
