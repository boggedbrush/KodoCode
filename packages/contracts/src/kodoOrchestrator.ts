// The Orchestrator: one conversation per environment, in a project of its own. The project has a fixed
// id and the thread an id from a fixed series (the first is the base id, a reset starts the next), so a
// client tells them from the ordinary lists without reading a shell. Rules: apps/server/src/kodo/swarm;
// "swarm" is the stored lead kind, "Orchestrator" the name.
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "./baseSchemas.ts";

const KODO_ORCHESTRATOR_ID = "kodo-orchestrator";
export const KODO_ORCHESTRATOR_TITLE = "Orchestrator";

export const KODO_ORCHESTRATOR_PROJECT_ID = ProjectId.make(KODO_ORCHESTRATOR_ID);
export const KODO_ORCHESTRATOR_THREAD_ID = ThreadId.make(KODO_ORCHESTRATOR_ID);

export const isKodoOrchestratorProjectId = (projectId: string): boolean =>
  projectId === KODO_ORCHESTRATOR_ID;

const KODO_ORCHESTRATOR_GENERATION = new RegExp(`^${KODO_ORCHESTRATOR_ID}-([2-9]|[1-9][0-9]+)$`);

/** The thread of generation `generation` (1 is the first; each reset starts the next). */
export const kodoOrchestratorThreadIdFor = (generation: number): ThreadId =>
  generation <= 1
    ? KODO_ORCHESTRATOR_THREAD_ID
    : ThreadId.make(`${KODO_ORCHESTRATOR_ID}-${generation}`);

/** Which generation an Orchestrator thread id is, or undefined for any other id. */
export const kodoOrchestratorGeneration = (threadId: string): number | undefined => {
  if (threadId === KODO_ORCHESTRATOR_ID) return 1;
  const match = KODO_ORCHESTRATOR_GENERATION.exec(threadId);
  return match === null ? undefined : Number(match[1]);
};

export const isKodoOrchestratorThreadId = (threadId: string): boolean =>
  kodoOrchestratorGeneration(threadId) !== undefined;

/** Where a thread came from, for a thread the Orchestrator's `delegate_task` started. */
export const KodoOrchestratorEnsureResult = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
  /** Why an existing conversation will not run as it is (the setting is off, its model cannot take the tools). */
  warning: Schema.optional(Schema.String),
});
export type KodoOrchestratorEnsureResult = typeof KodoOrchestratorEnsureResult.Type;

export class KodoOrchestratorError extends Schema.TaggedError<KodoOrchestratorError>()(
  "KodoOrchestratorError",
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.reason;
  }
}
