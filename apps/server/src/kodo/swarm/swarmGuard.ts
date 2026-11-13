// What no client or agent may do to the Orchestrator's own thread, decided from the command and the
// thread's stored lead alone. Its ids are fixed and its policy is the server's: a mode that could
// make it write, a thread that could be deleted out from under the pinned row, or a second thread
// made in its project would each break the promises the row makes.
import { isKodoOrchestratorProjectId, isKodoOrchestratorThreadId } from "@t3tools/contracts";

/** Commands on the Orchestrator thread (by `threadId`) that are refused. */
const PROTECTED_ON_THREAD: ReadonlySet<string> = new Set([
  "thread.delete",
  "thread.archive",
  "thread.interaction-mode.set",
  "thread.runtime-mode.set",
  "thread.metadata.update",
  "thread.project.adopt-folder",
  "thread.kodo-lead.set",
]);

const REFUSAL = "The Orchestrator is managed by the server, and this cannot be changed.";

type Command = { readonly type: string } & Readonly<Record<string, unknown>>;

const idOf = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * The reason the command is refused, or undefined. The thread's id is fixed and only the server can
 * create it, so the id alone says it is the Orchestrator and no read is needed.
 */
export function kodoSwarmCommandRefusal(command: Command): string | undefined {
  if (command.type === "thread.create") {
    const touchesOrchestrator =
      isKodoOrchestratorThreadId(idOf(command.threadId)) ||
      isKodoOrchestratorProjectId(idOf(command.projectId));
    return touchesOrchestrator && command.createdBy !== "system" ? REFUSAL : undefined;
  }
  if (command.type === "thread.fork" || command.type === "thread.merge_back") {
    return [command.sourceThreadId, command.targetThreadId].some((id) =>
      isKodoOrchestratorThreadId(idOf(id)),
    )
      ? REFUSAL
      : undefined;
  }
  if (!isKodoOrchestratorThreadId(idOf(command.threadId))) return undefined;
  // A generated title would rename it; closing the request without one is how the title stays fixed.
  if (command.type === "thread.title.regeneration.complete") {
    return command.title === undefined ? undefined : REFUSAL;
  }
  return PROTECTED_ON_THREAD.has(command.type) ? REFUSAL : undefined;
}

/**
 * Why a delegated task may not be made, or undefined. The Orchestrator's workers are made only by
 * its own approved start (an "agent"'s command naming a project), whatever else a client sends. Only
 * its task starts in another project, and only in one that exists, that is not its own scratch
 * project and that is not archived: a client may send this command, so the decision is made here,
 * not at the MCP door.
 */
export function kodoSwarmTaskTargetRefusal(input: {
  readonly targetProjectId: string | undefined;
  readonly parentIsSwarm: boolean;
  /** Who made the command: a transport stamps its own as "user", and only the MCP door makes an "agent"'s. */
  readonly createdBy: string;
  /** The target as the project store has it: active, and archived or not. */
  readonly target: { readonly archivedAt: unknown } | undefined;
}): string | undefined {
  if (input.parentIsSwarm && input.createdBy !== "agent") {
    return "The Orchestrator's workers start only through its approved start.";
  }
  if (input.targetProjectId === undefined) {
    return input.parentIsSwarm ? "The Orchestrator starts work in a project it names." : undefined;
  }
  if (input.createdBy !== "agent") {
    return "Work in another project starts only through the Orchestrator's approved start.";
  }
  if (!input.parentIsSwarm) return "Only the Orchestrator starts work in another project.";
  if (isKodoOrchestratorProjectId(input.targetProjectId)) {
    return "The Orchestrator starts work in the person's projects, never its own.";
  }
  if (input.target === undefined) return `Project ${input.targetProjectId} does not exist.`;
  if (input.target.archivedAt !== null) {
    return `Project ${input.targetProjectId} is archived.`;
  }
  return undefined;
}
