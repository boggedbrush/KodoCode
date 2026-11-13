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
  return PROTECTED_ON_THREAD.has(command.type) && isKodoOrchestratorThreadId(idOf(command.threadId))
    ? REFUSAL
    : undefined;
}
