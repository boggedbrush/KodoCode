import type {
  EnvironmentId,
  KodoInteractionMode,
  RuntimeMode,
  ThreadId,
  ThreadInteractionMode,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ModelSelection } from "@t3tools/contracts";
import { CodeXmlIcon, ListChecksIcon } from "lucide-react";
import { useState } from "react";

import type { ComposerBannerStackItem } from "../components/chat/ComposerBannerStack";
import { Button } from "../components/ui/button";
import type { ComposerHandleRef } from "../composerHandleContext";
import { useStableCallback } from "../hooks/useStableCallback";
import { newMessageId } from "~/lib/utils";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import {
  buildPlanAcceptanceTurn,
  runKodoPlanAcceptance,
  shouldOfferPlanAcceptance,
  type KodoPlanOffer,
  type PlanAcceptanceStep,
} from "./planAccept.logic";
import type { KodoModeSyncOutcome } from "./interactionModeSync";
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
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const [dismissedOfferKey, setDismissedOfferKey] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
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
    if (offer === null || threadId === null || accepting || input.isSendBusy) return;
    setAccepting(true);
    const turn = buildPlanAcceptanceTurn({ threadId, offer });
    const createdAt = new Date().toISOString();
    const step = (result: AtomCommandResult<unknown, unknown>): PlanAcceptanceStep => {
      if (result._tag !== "Failure") return { ok: true };
      const error = squashAtomCommandFailure(result);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to start the plan.",
        interrupted: isAtomCommandInterrupted(result),
      };
    };
    const outcome = await runKodoPlanAcceptance({
      // The offer can have gone stale since the click was rendered: a run started, the mode changed.
      stillOffered,
      switchToCode: async () =>
        step(
          await input.persistThreadSettingsForNextTurn({
            threadId,
            createdAt,
            runtimeMode: input.runtimeMode,
            interactionMode: turn.interactionMode,
          }),
        ),
      // "start" never steers or queues into a turn that began since the click.
      startTurn: async () => {
        const selection =
          input.composerRef.current?.getSendContext()?.selectedModelSelection ??
          input.fallbackModelSelection;
        return step(
          await startThreadTurn({
            environmentId: input.environmentId,
            input: {
              threadId,
              message: {
                messageId: newMessageId(),
                role: "user",
                text: turn.text,
                attachments: [],
              },
              ...(selection ? { modelSelection: selection } : {}),
              runtimeMode: input.runtimeMode,
              interactionMode: turn.interactionMode,
              ...(turn.sourceProposedPlan ? { sourceProposedPlan: turn.sourceProposedPlan } : {}),
              dispatchMode: "start",
              createdAt,
            },
          }),
        );
      },
      returnToPlan: async () => {
        const outcome = await input.commitInteractionMode("plan");
        return outcome.ok
          ? { ok: true }
          : { ok: false, message: outcome.message, interrupted: false };
      },
    });
    if (outcome.status === "failed" && outcome.message) {
      input.setThreadError(threadId, outcome.message);
    }
    setAccepting(false);
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
