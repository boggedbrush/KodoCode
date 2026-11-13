import {
  isKodoOrchestratorThreadId,
  kodoOrchestratorGeneration,
  type ModelSelection,
  type OrchestrationV2AppThreadLineage,
  type ServerProvider,
} from "@t3tools/contracts";

// The Orchestrator's dot, as every client reads it: three states from the thread's shell. The dot is a
// static colour that changes only when the state does, never an animation.
export type KodoOrchestratorState = "idle" | "working" | "needs-you";

export const KODO_ORCHESTRATOR_STATE_LABEL: Readonly<Record<KodoOrchestratorState, string>> = {
  idle: "Idle",
  working: "Working",
  "needs-you": "Needs you",
};

interface OrchestratorStatusInput {
  readonly hasPendingApprovals?: boolean | undefined;
  readonly hasPendingUserInput?: boolean | undefined;
  /** A worker it started asks, and the question is answered in its conversation. */
  readonly pendingSubagentRequest?: string | null | undefined;
  readonly pendingGuestMessageCount?: number | undefined;
  readonly runtime?: { readonly status?: string | undefined } | null | undefined;
}

const RUNNING = new Set(["running", "waiting", "preparing", "starting", "queued"]);

/** What its workers are doing, as read from their shells: any live run, and any open question. */
export interface KodoOrchestratorWorkers {
  readonly live: number;
  readonly needsYou: boolean;
}

export const NO_KODO_ORCHESTRATOR_WORKERS: KodoOrchestratorWorkers = { live: 0, needsYou: false };

/**
 * What needs a person comes first, then what is running, from the Orchestrator's own shell and from its
 * workers': a question from a worker is the Orchestrator's to show, and a worker running while the
 * Orchestrator itself is idle (it started it and finished its turn) is still work in progress.
 * A thread that does not exist yet is idle.
 */
export function kodoOrchestratorState(
  thread: OrchestratorStatusInput | null | undefined,
  workers: KodoOrchestratorWorkers = NO_KODO_ORCHESTRATOR_WORKERS,
): KodoOrchestratorState {
  if (
    workers.needsYou ||
    (thread !== null &&
      thread !== undefined &&
      (thread.hasPendingApprovals === true ||
        thread.hasPendingUserInput === true ||
        (thread.pendingSubagentRequest ?? null) !== null ||
        (thread.pendingGuestMessageCount ?? 0) > 0))
  ) {
    return "needs-you";
  }
  return workers.live > 0 || RUNNING.has(thread?.runtime?.status ?? "") ? "working" : "idle";
}

interface WorkerShell {
  readonly lineage: {
    readonly parentThreadId: string | null;
    readonly relationshipToParent?: string | null | undefined;
  };
  readonly runtime?: { readonly status?: string | undefined } | null | undefined;
  readonly hasPendingApprovals?: boolean | undefined;
  readonly hasPendingUserInput?: boolean | undefined;
}

/** Counts the workers of one Orchestrator conversation among `shells`: one pass, nothing read but the shell. */
export function kodoOrchestratorWorkerActivity(
  shells: Iterable<WorkerShell>,
  orchestratorThreadId: string | undefined,
): KodoOrchestratorWorkers {
  if (orchestratorThreadId === undefined) return NO_KODO_ORCHESTRATOR_WORKERS;
  let live = 0;
  let needsYou = false;
  for (const shell of shells) {
    if (
      shell.lineage.relationshipToParent !== "subagent" ||
      shell.lineage.parentThreadId !== orchestratorThreadId
    ) {
      continue;
    }
    if (RUNNING.has(shell.runtime?.status ?? "")) live += 1;
    if (shell.hasPendingApprovals === true || shell.hasPendingUserInput === true) needsYou = true;
  }
  return live === 0 && !needsYou ? NO_KODO_ORCHESTRATOR_WORKERS : { live, needsYou };
}

/** The conversation among `threadIds` that is the Orchestrator's current one: the newest of its series. */
export function latestKodoOrchestratorThreadId(threadIds: Iterable<string>): string | undefined {
  let latest: { readonly id: string; readonly generation: number } | undefined;
  for (const id of threadIds) {
    const generation = kodoOrchestratorGeneration(id);
    if (generation !== undefined && (latest === undefined || generation > latest.generation)) {
      latest = { id, generation };
    }
  }
  return latest?.id;
}

/**
 * A worker the Orchestrator started. Its parent is hidden from every list, so it is not shown under
 * it: it is listed in the project it works in like any thread, where it can be seen and stopped.
 */
export const isKodoOrchestratorWorkerLineage = (
  lineage: Pick<OrchestrationV2AppThreadLineage, "parentThreadId" | "relationshipToParent">,
): boolean =>
  lineage.relationshipToParent === "subagent" &&
  lineage.parentThreadId !== null &&
  isKodoOrchestratorThreadId(lineage.parentThreadId);

/**
 * Why the Orchestrator cannot run on the model it would use (its own model setting, else the default),
 * or null when it can or when that cannot be told yet. The server decides the same thing when it opens
 * it, with the same wording for a missing default; this is the preview the row and Settings show.
 */
export function kodoOrchestratorUnavailableReason(input: {
  readonly model: Pick<ModelSelection, "instanceId"> | null | undefined;
  readonly providers: ReadonlyArray<
    Pick<ServerProvider, "instanceId" | "displayName" | "driver" | "kodoSubAgents">
  >;
}): string | null {
  if (input.model === null || input.model === undefined) {
    return "Choose a default model in Settings before opening the Orchestrator.";
  }
  const provider = input.providers.find(
    (candidate) => candidate.instanceId === input.model?.instanceId,
  );
  const support = provider?.kodoSubAgents;
  if (provider === undefined || support === undefined || support.support !== "none") return null;
  return `The Orchestrator can't run on ${provider.displayName ?? provider.driver}. ${support.reason ?? "It cannot receive the T3 tools."} Change its model in Settings.`;
}
