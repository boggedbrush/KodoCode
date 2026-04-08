import { DEFAULT_RUNTIME_MODE, type ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  type ComposerThreadDraftState,
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { resolveModeModelSelection } from "../modelSelection";
import { newThreadId } from "../lib/utils";
import { orderItemsByPreferredIds } from "../components/Sidebar.logic";
import { useSettings } from "../hooks/useSettings";
import { useStore } from "../store";
import { useThreadById } from "../storeSelectors";
import { useServerConfig } from "../rpc/serverState";
import { useUiStateStore } from "../uiStateStore";

function isComposerDraftEmpty(draft: ComposerThreadDraftState | null | undefined): boolean {
  return (
    !draft ||
    (draft.prompt.length === 0 &&
      draft.images.length === 0 &&
      draft.persistedAttachments.length === 0 &&
      draft.terminalContexts.length === 0 &&
      Object.keys(draft.modelSelectionByProvider).length === 0 &&
      draft.activeProvider === null &&
      draft.runtimeMode === null &&
      draft.interactionMode === null)
  );
}

export function useHandleNewThread() {
  const projectIds = useStore(useShallow((store) => store.projects.map((project) => project.id)));
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeThread = useThreadById(routeThreadId);
  const activeDraftThread = useComposerDraftStore((store) =>
    routeThreadId ? (store.draftThreadsByThreadId[routeThreadId] ?? null) : null,
  );
  const settings = useSettings();
  const serverConfig = useServerConfig();
  const serverProviders = serverConfig?.providers;
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projectIds,
      preferredIds: projectOrder,
      getId: (projectId) => projectId,
    });
  }, [projectIds, projectOrder]);

  const handleNewThread = useCallback(
    (
      projectId: ProjectId,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
      },
    ): Promise<void> => {
      const {
        clearProjectDraftThreadId,
        getDraftThread,
        getDraftThreadByProjectId,
        applyStickyState,
        setDraftThreadContext,
        setModelSelection,
        setProjectDraftThreadId,
      } = useComposerDraftStore.getState();
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const applyCodeDefaultsToBlankDraft = (threadId: ThreadId, draftThread: DraftThreadState) => {
        if (draftThread.interactionMode !== "default") {
          return;
        }
        const existingComposerDraft = useComposerDraftStore.getState().draftsByThreadId[threadId];
        if (!isComposerDraftEmpty(existingComposerDraft)) {
          return;
        }
        setDraftThreadContext(threadId, { interactionMode: "code" });
        if (!serverProviders?.length) {
          return;
        }
        const modeSelection = resolveModeModelSelection("code", settings, serverProviders);
        if (modeSelection) {
          setModelSelection(threadId, modeSelection);
        }
      };
      const storedDraftThread = getDraftThreadByProjectId(projectId);
      const latestActiveDraftThread: DraftThreadState | null = routeThreadId
        ? getDraftThread(routeThreadId)
        : null;
      if (storedDraftThread) {
        return (async () => {
          applyCodeDefaultsToBlankDraft(storedDraftThread.threadId, storedDraftThread);
          if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
            setDraftThreadContext(storedDraftThread.threadId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            });
          }
          setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          if (routeThreadId === storedDraftThread.threadId) {
            return;
          }
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        })();
      }

      clearProjectDraftThreadId(projectId);

      if (
        latestActiveDraftThread &&
        routeThreadId &&
        latestActiveDraftThread.projectId === projectId
      ) {
        applyCodeDefaultsToBlankDraft(routeThreadId, latestActiveDraftThread);
        if (hasBranchOption || hasWorktreePathOption || hasEnvModeOption) {
          setDraftThreadContext(routeThreadId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
          });
        }
        setProjectDraftThreadId(projectId, routeThreadId);
        return Promise.resolve();
      }

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        setProjectDraftThreadId(projectId, threadId, {
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
          interactionMode: "code",
        });
        applyStickyState(threadId);
        if (serverProviders?.length) {
          // Fresh chats should reflect mode-driven defaults, not sticky model memory, so the picker stays accurate.
          const modeSelection = resolveModeModelSelection("code", settings, serverProviders);
          if (modeSelection) {
            setModelSelection(threadId, modeSelection);
          }
        }

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [navigate, routeThreadId, serverProviders, settings],
  );

  return {
    activeDraftThread,
    activeThread,
    defaultProjectId: orderedProjects[0] ?? null,
    handleNewThread,
    routeThreadId,
  };
}
