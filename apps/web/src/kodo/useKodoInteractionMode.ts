import {
  normalizeKodoInteractionMode,
  type EnvironmentId,
  type KodoInteractionMode,
  type ThreadId,
  type ThreadInteractionMode,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect, useState } from "react";

import { type ComposerThreadTarget, useComposerDraftStore } from "../composerDraftStore";
import { useStableCallback } from "../hooks/useStableCallback";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import {
  cycleKodoInteractionMode,
  kodoModeWaitsForNextTurn,
  resolveKodoDisplayedMode,
  resolveKodoInteractionMode,
} from "./interactionModes.logic";
import { createKodoModeSync, type KodoModeSyncOutcome } from "./interactionModeSync";
import { useKodoPlanEpochStore } from "./planEpochStore";

/**
 * The composer's mode. On a thread the server holds, the server's mode is the truth: a pick is
 * sent at once, shown meanwhile and dropped with an error on failure. The composer draft only
 * carries the pick of a thread that does not exist yet.
 */
export function useKodoInteractionMode(input: {
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly threadMode: ThreadInteractionMode | undefined;
  readonly isLocalDraftThread: boolean;
  readonly scheduleComposerFocus: () => void;
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  /** Set once the server holds the thread. */
  readonly serverThreadId: ThreadId | null;
  readonly canOperateThread: boolean;
  readonly activeRunId: string | null;
  readonly latestRunOrdinal: number;
  /** The mode the running run recorded when it was created; absent on runs that predate it. */
  readonly activeRunMode: ThreadInteractionMode | undefined;
  readonly setThreadError: (threadId: ThreadId, message: string | null) => void;
}) {
  const { composerDraftTarget, threadMode, isLocalDraftThread, threadKey, serverThreadId } = input;
  const isServerThread = serverThreadId !== null;
  const composerMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const observePlanEpoch = useKodoPlanEpochStore((store) => store.observe);
  const planCutoffOrdinal = useKodoPlanEpochStore(
    (store) => store.epochByThreadKey[threadKey]?.cutoffOrdinal ?? null,
  );
  const setServerMode = useOrchestrationCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });

  const [pending, setPending] = useState<{
    readonly threadKey: string;
    readonly mode: KodoInteractionMode;
  } | null>(null);
  const serverMode = normalizeKodoInteractionMode(threadMode);
  const interactionMode = resolveKodoDisplayedMode({
    isServerThread,
    pendingMode: pending?.threadKey === threadKey ? pending.mode : null,
    threadMode,
    composerMode,
  });

  const [runStart, setRunStart] = useState({ threadKey, runId: input.activeRunId, serverMode });
  if (runStart.threadKey !== threadKey || runStart.runId !== input.activeRunId) {
    setRunStart({ threadKey, runId: input.activeRunId, serverMode });
  }
  const modeAppliesNextTurn = kodoModeWaitsForNextTurn({
    activeRunId: input.activeRunId,
    runStartedInMode:
      input.activeRunMode !== undefined
        ? normalizeKodoInteractionMode(input.activeRunMode)
        : runStart.threadKey === threadKey && runStart.runId === input.activeRunId
          ? runStart.serverMode
          : serverMode,
    displayedMode: interactionMode,
  });

  const recordPlanEpoch = useStableCallback((mode: KodoInteractionMode) => {
    observePlanEpoch(threadKey, { mode, latestRunOrdinal: input.latestRunOrdinal });
  });
  const getServerMode = useStableCallback(() => serverMode);
  const sendServerMode = useStableCallback(
    async (mode: KodoInteractionMode): Promise<KodoModeSyncOutcome> => {
      if (serverThreadId === null) return { ok: false, message: "The thread is not started." };
      const result = await setServerMode({
        environmentId: input.environmentId,
        input: { threadId: serverThreadId, interactionMode: mode },
      });
      if (result._tag !== "Failure") return { ok: true };
      if (isAtomCommandInterrupted(result)) return { ok: false, message: "", silent: true };
      const error = squashAtomCommandFailure(result);
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Could not change the mode.",
      };
    },
  );
  const reportModeFailure = useStableCallback((message: string) => {
    recordPlanEpoch(getServerMode());
    if (serverThreadId !== null) input.setThreadError(serverThreadId, message);
  });
  const createSync = () =>
    createKodoModeSync({
      send: sendServerMode,
      getServerMode,
      onPendingChange: (mode) =>
        setPending((current) =>
          mode === null ? (current?.threadKey === threadKey ? null : current) : { threadKey, mode },
        ),
      onFailure: reportModeFailure,
    });
  const [syncHolder, setSyncHolder] = useState(() => ({ threadKey, sync: createSync() }));
  let sync = syncHolder.sync;
  if (syncHolder.threadKey !== threadKey) {
    sync = createSync();
    setSyncHolder({ threadKey, sync });
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- binds the sync's timers to the mounted component
  useEffect(() => sync.attach(), [sync]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an acknowledged pick yields to whatever the server reports next
  useEffect(() => {
    if (isServerThread) sync.observeServerMode(serverMode);
  }, [sync, serverMode, isServerThread]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records where the thread entered Plan, including changes made on other clients
  useEffect(() => {
    if (isServerThread) recordPlanEpoch(serverMode);
  }, [isServerThread, serverMode, recordPlanEpoch]);

  const changeServerMode = useStableCallback(async (target: KodoInteractionMode) => {
    recordPlanEpoch(target);
    sync.request(target);
    input.scheduleComposerFocus();
  });

  // Key presses can outrun a render, so the latest pick is read from where it was just written.
  const currentMode = (): KodoInteractionMode =>
    serverThreadId !== null
      ? (sync.pendingMode() ?? interactionMode)
      : resolveKodoInteractionMode({
          composerMode: useComposerDraftStore.getState().getComposerDraft(composerDraftTarget)
            ?.interactionMode,
          threadMode,
        });

  const handleInteractionModeChange = useStableCallback((mode: ThreadInteractionMode) => {
    const target = normalizeKodoInteractionMode(mode);
    if (target === currentMode()) return;
    if (serverThreadId === null) {
      setComposerDraftInteractionMode(composerDraftTarget, target);
      if (isLocalDraftThread)
        setDraftThreadContext(composerDraftTarget, { interactionMode: target });
      input.scheduleComposerFocus();
      return;
    }
    if (!input.canOperateThread) {
      input.setThreadError(serverThreadId, "This connection cannot change this thread's mode.");
      return;
    }
    void changeServerMode(target);
  });
  const toggleInteractionMode = useStableCallback(() => {
    handleInteractionModeChange(cycleKodoInteractionMode(currentMode()));
  });
  /** Resolves once the server holds `mode`; a thread the server lacks has nothing to write. */
  const commitInteractionMode = useStableCallback(
    async (mode: ThreadInteractionMode): Promise<KodoModeSyncOutcome> => {
      if (serverThreadId === null) return { ok: true };
      const target = normalizeKodoInteractionMode(mode);
      recordPlanEpoch(target);
      return sync.commit(target);
    },
  );

  return {
    interactionMode,
    handleInteractionModeChange,
    toggleInteractionMode,
    commitInteractionMode,
    modeAppliesNextTurn,
    planCutoffOrdinal,
  };
}
