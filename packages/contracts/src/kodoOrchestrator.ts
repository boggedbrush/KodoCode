// The Orchestrator: one conversation per environment, in a project of its own. Both have fixed ids,
// so a client tells them from the ordinary lists without reading a shell. Rules: apps/server/src/kodo/swarm;
// "swarm" is the stored lead kind, "Orchestrator" the name.
import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "./baseSchemas.ts";

const KODO_ORCHESTRATOR_ID = "kodo-orchestrator";
export const KODO_ORCHESTRATOR_TITLE = "Orchestrator";

export const KODO_ORCHESTRATOR_PROJECT_ID = ProjectId.make(KODO_ORCHESTRATOR_ID);
export const KODO_ORCHESTRATOR_THREAD_ID = ThreadId.make(KODO_ORCHESTRATOR_ID);

export const isKodoOrchestratorProjectId = (projectId: string): boolean =>
  projectId === KODO_ORCHESTRATOR_ID;
export const isKodoOrchestratorThreadId = (threadId: string): boolean =>
  threadId === KODO_ORCHESTRATOR_ID;

export const KodoOrchestratorEnsureResult = Schema.Struct({
  projectId: ProjectId,
  threadId: ThreadId,
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
