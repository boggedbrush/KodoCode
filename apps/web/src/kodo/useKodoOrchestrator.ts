import { isKodoOrchestratorThreadId, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import {
  kodoOrchestratorState,
  kodoOrchestratorUnavailableReason,
  kodoOrchestratorWorkerActivity,
  latestKodoOrchestratorThreadId,
  NO_KODO_ORCHESTRATOR_WORKERS,
  type KodoOrchestratorState,
  type KodoOrchestratorWorkers,
} from "@t3tools/shared/kodoOrchestrator";
import { toastManager } from "../components/ui/toast";
import { usePrimarySettings } from "../hooks/useSettings";
import { useStableCallback } from "../hooks/useStableCallback";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useQuietThreadShell } from "../state/entities";
import { serverEnvironment } from "../state/server";
import { environmentThreadShells } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { registerKodoOrchestratorOpen } from "./orchestrator.logic";

const EMPTY_PROVIDERS: ReadonlyArray<never> = Object.freeze([]);

/**
 * What the Orchestrator's workers are doing, read from the thread shells this client already holds:
 * one pass when a shell's status changes (the quiet list does not move while a run streams), and the
 * same object back when nothing changed, so a streaming worker costs the row nothing.
 */
const orchestratorWorkersAtom = Atom.family((key: string) => {
  const separator = key.indexOf("\u0000");
  const environmentId = key.slice(0, separator);
  const threadId = key.slice(separator + 1);
  let previous = NO_KODO_ORCHESTRATOR_WORKERS;
  return Atom.make((get): KodoOrchestratorWorkers => {
    const next = kodoOrchestratorWorkerActivity(
      inEnvironment(get(environmentThreadShells.quietThreadShellsAtom), environmentId),
      threadId,
    );
    if (next.live === previous.live && next.needsYou === previous.needsYou) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`kodo-orchestrator-workers:${key}`));
});
function* inEnvironment<Shell extends { readonly environmentId: string }>(
  shells: ReadonlyArray<Shell>,
  environmentId: string,
) {
  for (const shell of shells) if (shell.environmentId === environmentId) yield shell;
}
const NO_WORKERS_ATOM = Atom.make(NO_KODO_ORCHESTRATOR_WORKERS);

/** The Orchestrator's current conversation on this environment: the newest of its series that exists. */
export function useKodoOrchestratorThreadId(
  environmentId: EnvironmentId | null,
): ThreadId | undefined {
  const refs = useAtomValue(environmentThreadShells.threadRefsAtom);
  return environmentId === null
    ? undefined
    : (latestKodoOrchestratorThreadId(
        refs.filter((ref) => ref.environmentId === environmentId).map((ref) => ref.threadId),
      ) as ThreadId | undefined);
}

export function useKodoOrchestratorWorkers(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | undefined,
): KodoOrchestratorWorkers {
  return useAtomValue(
    environmentId === null || threadId === undefined
      ? NO_WORKERS_ATOM
      : orchestratorWorkersAtom(`${environmentId}\u0000${threadId}`),
  );
}

/** Why it cannot open on the model it would use, from what this client already knows; null when it can. */
export function useKodoOrchestratorUnavailableReason(
  environmentId: EnvironmentId | null,
): string | null {
  const orchestratorModel = usePrimarySettings(
    (settings) => settings.modeModelSelections.orchestrator,
  );
  const defaultModel = usePrimarySettings((settings) => settings.defaultModelSelection);
  const providers =
    useAtomValue(
      environmentId === null
        ? NO_PROVIDERS_ATOM
        : serverEnvironment.providersValueAtom(environmentId),
    ) ?? EMPTY_PROVIDERS;
  return kodoOrchestratorUnavailableReason({
    model: orchestratorModel ?? defaultModel,
    providers,
  });
}
const NO_PROVIDERS_ATOM = Atom.make<ReadonlyArray<never> | null>(null);

export interface KodoOrchestratorView {
  /** Shown only for the machine this window is the primary of, and while the setting is on. */
  readonly visible: boolean;
  readonly state: KodoOrchestratorState;
  /** The Orchestrator conversation is the one on screen. */
  readonly active: boolean;
  readonly opening: boolean;
  /** Why it cannot be opened, for the row and Settings to say. */
  readonly unavailable: string | null;
  readonly open: () => void;
}

/**
 * The Orchestrator of the primary environment: its dot (its own run or any worker's, and any question)
 * and the one action that opens it. The thread is made on the first open, and a refusal says why.
 */
export function useKodoOrchestrator(): KodoOrchestratorView {
  const environmentId = usePrimaryEnvironmentId();
  const navigate = useNavigate();
  const enabled = usePrimarySettings((settings) => settings.kodoOrchestratorEnabled);
  const threadId = useKodoOrchestratorThreadId(environmentId);
  const ref =
    environmentId === null || threadId === undefined
      ? null
      : scopeThreadRef(environmentId, threadId);
  const shell = useQuietThreadShell(ref);
  const workers = useKodoOrchestratorWorkers(environmentId, threadId);
  const unavailable = useKodoOrchestratorUnavailableReason(environmentId);
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
    state: kodoOrchestratorState(shell, workers),
    active: typeof routeThreadId === "string" && isKodoOrchestratorThreadId(routeThreadId),
    opening,
    unavailable,
    open: () => void open(),
  };
}
