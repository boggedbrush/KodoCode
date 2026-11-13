import { KODO_ORCHESTRATOR_THREAD_ID } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  kodoOrchestratorState,
  type KodoOrchestratorState,
} from "@t3tools/shared/kodoOrchestrator";
import { toastManager } from "../components/ui/toast";
import { usePrimarySettings } from "../hooks/useSettings";
import { useStableCallback } from "../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useQuietThreadShell } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { registerKodoOrchestratorOpen } from "./orchestrator.logic";

export interface KodoOrchestratorView {
  /** Shown only for the machine this window is the primary of, and while the setting is on. */
  readonly visible: boolean;
  readonly state: KodoOrchestratorState;
  /** The Orchestrator conversation is the one on screen. */
  readonly active: boolean;
  readonly opening: boolean;
  readonly open: () => void;
}

/**
 * The Orchestrator of the primary environment: its dot, and the one action that opens it. The thread
 * is made the first time it is opened (`ensure`), so before that the dot is idle and the row is
 * still there. A refused or failed open says so in a toast and leaves the window where it was.
 */
export function useKodoOrchestrator(): KodoOrchestratorView {
  const environmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const enabled = usePrimarySettings((settings) => settings.kodoOrchestratorEnabled);
  const ref =
    environmentId === null ? null : scopeThreadRef(environmentId, KODO_ORCHESTRATOR_THREAD_ID);
  const shell = useQuietThreadShell(ref);
  const routeThreadId = useParams({ strict: false, select: (params) => params.threadId });
  const ensure = useOrchestrationCommand(serverEnvironment.ensureKodoOrchestrator, {
    reportFailure: false,
  });
  const [opening, setOpening] = useState(false);

  const open = useStableCallback(async () => {
    if (environmentId === null || opening) return;
    setOpening(true);
    const result = await ensure({ environmentId, input: {} });
    setOpening(false);
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "The Orchestrator could not be opened",
        description: error instanceof Error ? error.message : "Try again in a moment.",
      });
      return;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, result.value.threadId)),
    });
  });
  const visible = environmentId !== null && enabled !== false;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the opener with the palette and keybinding, which live outside React's tree
  useEffect(
    () => (visible ? registerKodoOrchestratorOpen(() => void open()) : undefined),
    [visible, open],
  );

  return {
    visible,
    state: kodoOrchestratorState(shell),
    active: routeThreadId === KODO_ORCHESTRATOR_THREAD_ID,
    opening,
    open: () => void open(),
  };
}
