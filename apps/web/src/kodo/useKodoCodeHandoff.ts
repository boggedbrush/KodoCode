import type {
  EnvironmentId,
  ModelSelection,
  PlanId,
  RuntimeMode,
  ThreadId,
  ThreadInteractionMode,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useState } from "react";

import type { ComposerHandleRef } from "../composerHandleContext";
import { useStableCallback } from "../hooks/useStableCallback";
import { newMessageId } from "~/lib/utils";
import { useComposerDraftStore } from "../composerDraftStore";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import {
  planAcceptModelFields,
  runKodoPlanAcceptance,
  type PlanAcceptanceStep,
} from "./planAccept.logic";
import type { KodoModeSyncOutcome } from "./interactionModeSync";

/**
 * Starts a Code turn from a read-only mode: switch the thread to Code, start the turn, and on a
 * failed start put the thread back where it was. The switch and the start are two server commands,
 * so the rollback is what keeps the thread's mode consistent for every client. Shared by the plan
 * banner and the review findings card.
 */
export function useKodoCodeHandoff(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
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
}) {
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);

  const start = useStableCallback(
    async (turn: {
      readonly text: string;
      readonly sourceProposedPlan?: { readonly threadId: ThreadId; readonly planId: PlanId };
      /** The offer can have gone stale since the click was rendered: a run started, the mode changed. */
      readonly stillOffered: () => boolean;
      /** The mode the thread is in now, and goes back to when the turn does not start. */
      readonly returnTo: "plan" | "review";
      readonly failureMessage: string;
      readonly wording?: { readonly notStarted: string; readonly returnMode: string };
    }) => {
      const { threadId } = input;
      if (threadId === null || busy || input.isSendBusy) return;
      setBusy(true);
      const createdAt = new Date().toISOString();
      const step = (result: AtomCommandResult<unknown, unknown>): PlanAcceptanceStep => {
        if (result._tag !== "Failure") return { ok: true };
        const error = squashAtomCommandFailure(result);
        return {
          ok: false,
          message: error instanceof Error ? error.message : turn.failureMessage,
          interrupted: isAtomCommandInterrupted(result),
        };
      };
      const outcome = await runKodoPlanAcceptance({
        stillOffered: turn.stillOffered,
        switchToCode: async () =>
          step(
            await input.persistThreadSettingsForNextTurn({
              threadId,
              createdAt,
              runtimeMode: input.runtimeMode,
              interactionMode: "code",
            }),
          ),
        // "start" never steers or queues into a turn that began since the click.
        startTurn: async () => {
          const sendContext = input.composerRef.current?.getSendContext();
          const kodoModelSend = sendContext?.kodoModelSend;
          const selection = sendContext?.selectedModelSelection ?? input.fallbackModelSelection;
          const result = step(
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
                ...planAcceptModelFields({ selection, kodoModelSend }),
                runtimeMode: input.runtimeMode,
                interactionMode: "code",
                ...(turn.sourceProposedPlan ? { sourceProposedPlan: turn.sourceProposedPlan } : {}),
                dispatchMode: "start",
                createdAt,
              },
            }),
          );
          // A pick held in the draft was for this message only.
          if (result.ok && kodoModelSend?.explicit === true) {
            const store = useComposerDraftStore.getState();
            const heldRef = scopeThreadRef(input.environmentId, threadId);
            const held = store.getComposerDraft(heldRef);
            const heldPick = held?.activeProvider
              ? held.modelSelectionByProvider[held.activeProvider]
              : undefined;
            if (heldPick) store.releaseModelSelection(heldRef, heldPick);
          }
          return result;
        },
        returnToPlan: async () => {
          const returned = await input.commitInteractionMode(turn.returnTo);
          return returned.ok
            ? { ok: true }
            : { ok: false, message: returned.message, interrupted: false };
        },
        ...(turn.wording === undefined ? {} : { wording: turn.wording }),
      });
      if (outcome.status === "failed" && outcome.message) {
        input.setThreadError(threadId, outcome.message);
      }
      setBusy(false);
    },
  );

  return { busy, start };
}
