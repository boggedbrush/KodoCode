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

/** What needs a person comes first, then what is running; a thread that does not exist yet is idle. */
export function kodoOrchestratorState(
  thread: OrchestratorStatusInput | null | undefined,
): KodoOrchestratorState {
  if (thread === null || thread === undefined) return "idle";
  if (
    thread.hasPendingApprovals === true ||
    thread.hasPendingUserInput === true ||
    (thread.pendingSubagentRequest ?? null) !== null ||
    (thread.pendingGuestMessageCount ?? 0) > 0
  ) {
    return "needs-you";
  }
  return RUNNING.has(thread.runtime?.status ?? "") ? "working" : "idle";
}
