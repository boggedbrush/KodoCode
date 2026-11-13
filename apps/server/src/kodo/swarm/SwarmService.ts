// The Orchestrator's one-time setup: a project folder under the T3 home and one thread in it, both
// with fixed ids, so `ensure` is idempotent and safe to race. The server creates the thread as
// `system`, the only creator that may set the `swarm` lead, at the approval ceiling.
import {
  CommandId,
  KODO_ORCHESTRATOR_PROJECT_ID,
  KODO_ORCHESTRATOR_THREAD_ID,
  KODO_ORCHESTRATOR_TITLE,
  KodoOrchestratorError,
  type KodoOrchestratorEnsureResult,
  type ModelSelection,
  type OrchestrationV2Command,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

type CreateCommand = Extract<OrchestrationV2Command, { readonly type: "thread.create" }>;

export interface KodoSwarmDeps {
  /** The folder the Orchestrator's project is rooted at. */
  readonly workspaceRoot: string;
  readonly makeFolder: (folder: string) => Effect.Effect<void, unknown>;
  readonly projects: {
    readonly bootstrap: (input: {
      readonly commandId: CommandId;
      readonly projectId: typeof KODO_ORCHESTRATOR_PROJECT_ID;
      readonly title: string;
      readonly workspaceRoot: string;
    }) => Effect.Effect<
      { readonly project: { readonly id: string }; readonly created: boolean },
      unknown
    >;
  };
  readonly threads: {
    readonly getThreadShell: (
      threadId: ThreadId,
    ) => Effect.Effect<{ readonly deletedAt: unknown } | null, unknown>;
    readonly dispatch: (
      command: CreateCommand,
    ) => Effect.Effect<unknown, { readonly _tag?: string }>;
  };
  /** The thread's own model: the Orchestrator model is applied per turn on top of it. */
  readonly baseModel: Effect.Effect<ModelSelection | null>;
}

const fail = (reason: string, cause?: unknown) => new KodoOrchestratorError({ reason, cause });

export const makeKodoSwarmService = (deps: KodoSwarmDeps) => {
  const ensure: Effect.Effect<KodoOrchestratorEnsureResult, KodoOrchestratorError> = Effect.gen(
    function* () {
      const threadId = KODO_ORCHESTRATOR_THREAD_ID;
      const existing = yield* deps.threads
        .getThreadShell(threadId)
        .pipe(Effect.mapError((cause) => fail("The Orchestrator could not be read.", cause)));
      if (existing !== null) {
        // A deleted thread keeps its id, so it cannot be made again here.
        if (existing.deletedAt !== null) {
          return yield* fail("The Orchestrator conversation was deleted and cannot be restored.");
        }
        return { projectId: KODO_ORCHESTRATOR_PROJECT_ID, threadId };
      }
      const model = yield* deps.baseModel;
      if (model === null) {
        return yield* fail("Choose a default model in Settings before opening the Orchestrator.");
      }
      yield* deps
        .makeFolder(deps.workspaceRoot)
        .pipe(
          Effect.mapError((cause) =>
            fail("The Orchestrator's folder could not be created.", cause),
          ),
        );
      yield* deps.projects
        .bootstrap({
          commandId: CommandId.make("kodo-orchestrator:project"),
          projectId: KODO_ORCHESTRATOR_PROJECT_ID,
          title: KODO_ORCHESTRATOR_TITLE,
          workspaceRoot: deps.workspaceRoot,
        })
        .pipe(
          // Racing creates return the winner as a conflict; only a conflict with our own id is fine.
          Effect.catchIf(
            (error: unknown) =>
              typeof error === "object" &&
              error !== null &&
              "_tag" in error &&
              error._tag === "ProjectConflictError" &&
              "conflictingProjectId" in error &&
              error.conflictingProjectId === KODO_ORCHESTRATOR_PROJECT_ID,
            () => Effect.void,
          ),
          Effect.mapError((cause) =>
            fail("The Orchestrator's project could not be created.", cause),
          ),
        );
      yield* deps.threads
        .dispatch({
          type: "thread.create",
          createdBy: "system",
          creationSource: "server",
          commandId: CommandId.make("kodo-orchestrator:thread"),
          threadId,
          projectId: KODO_ORCHESTRATOR_PROJECT_ID,
          title: KODO_ORCHESTRATOR_TITLE,
          modelSelection: model,
          // What it delegates can never be broader than this.
          runtimeMode: "approval-required",
          interactionMode: "code",
          kodoLead: { kind: "swarm" },
          branch: null,
          worktreePath: null,
        })
        .pipe(
          // A racing ensure created it first: the same thread, so the same answer.
          Effect.catchIf(
            (error) => error._tag === "OrchestratorThreadAlreadyExistsError",
            () => Effect.void,
          ),
          Effect.mapError((cause) => fail("The Orchestrator could not be created.", cause)),
        );
      return { projectId: KODO_ORCHESTRATOR_PROJECT_ID, threadId };
    },
  ).pipe(Effect.withSpan("KodoSwarm.ensure"));
  return { ensure } as const;
};

export type KodoSwarmService = ReturnType<typeof makeKodoSwarmService>;
