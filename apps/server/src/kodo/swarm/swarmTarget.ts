// What an agent may and may not see or do to the Orchestrator through the T3 tools. The Orchestrator
// is the person's: its project and conversation stay out of what other agents list, and no agent
// writes to it (a message, a queued run, an answer to its question), so only a person starts or steers it.
import { isKodoOrchestratorProjectId, isKodoOrchestratorThreadId } from "@t3tools/contracts";

export const KODO_ORCHESTRATOR_NO_AGENT_WRITES =
  "The Orchestrator is the person's own conversation, and agents cannot write to it.";

/** Whether the caller is the Orchestrator itself, which may see its own project and conversation. */
const isOrchestratorCaller = (callerThreadId: string | undefined): boolean =>
  callerThreadId !== undefined && isKodoOrchestratorThreadId(callerThreadId);

/** The reason a write by `callerThreadId` to `targetThreadId` is refused, or undefined. */
export const kodoOrchestratorWriteRefusal = (
  callerThreadId: string | undefined,
  targetThreadId: string,
): string | undefined =>
  isKodoOrchestratorThreadId(targetThreadId) && callerThreadId !== targetThreadId
    ? KODO_ORCHESTRATOR_NO_AGENT_WRITES
    : undefined;

/** `projects` without the Orchestrator's own project, unless the Orchestrator is the one asking. */
export const kodoWithoutOrchestratorProject = <Item extends { readonly id: string }>(
  callerThreadId: string | undefined,
  projects: ReadonlyArray<Item>,
): ReadonlyArray<Item> =>
  isOrchestratorCaller(callerThreadId)
    ? projects
    : projects.filter((project) => !isKodoOrchestratorProjectId(project.id));

/** `threads` without the Orchestrator's conversation, unless the Orchestrator is the one asking. */
export const kodoWithoutOrchestratorThread = <Item>(
  callerThreadId: string | undefined,
  threads: ReadonlyArray<Item>,
  idOf: (thread: Item) => string,
): ReadonlyArray<Item> =>
  isOrchestratorCaller(callerThreadId)
    ? threads
    : threads.filter((thread) => !isKodoOrchestratorThreadId(idOf(thread)));
