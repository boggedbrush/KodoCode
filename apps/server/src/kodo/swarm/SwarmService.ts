// The Orchestrator's setup and recovery: its project (fixed id) and one live thread of a fixed id
// series (a reset starts the next), made as `system` at the approval ceiling. `ensure` is idempotent,
// safe to race, and makes a lost or reset thread again instead of failing for good.
import {
  CommandId,
  KODO_ORCHESTRATOR_PROJECT_ID,
  KODO_ORCHESTRATOR_TITLE,
  KodoOrchestratorError,
  kodoOrchestratorThreadIdFor,
  type KodoOrchestratorEnsureResult,
  type ModelSelection,
  type OrchestrationV2Command,
  ServerSettingsError,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/** The errors the setup's dependencies fail with: always tagged, never read here beyond that. */
type DepError = { readonly _tag?: string };

type ThreadCommand = Extract<
  OrchestrationV2Command,
  { readonly type: "thread.create" | "thread.unarchive" }
>;

/** What the service reads of a thread: enough to tell a live conversation from a lost one. */
export interface KodoSwarmThreadShell {
  readonly deletedAt: unknown;
  readonly archivedAt?: unknown;
  readonly modelSelection: ModelSelection;
  readonly activeRunId?: unknown;
  readonly pendingRuntimeRequest?: unknown;
}

export interface KodoSwarmDeps {
  /** The folder the Orchestrator's project is rooted at. */
  readonly workspaceRoot: string;
  readonly makeFolder: (folder: string) => Effect.Effect<void, DepError>;
  readonly projects: {
    /** Makes the project, or puts it right when it was deleted, archived or moved. */
    readonly ensureKodoOrchestratorProject: (input: {
      readonly workspaceRoot: string;
    }) => Effect.Effect<unknown, DepError>;
  };
  readonly threads: {
    /** A live thread's shell; a deleted thread has none, as the projection reads it. */
    readonly getThreadShell: (
      threadId: ThreadId,
    ) => Effect.Effect<KodoSwarmThreadShell | null, DepError>;
    readonly dispatch: (command: ThreadCommand) => Effect.Effect<unknown, DepError>;
    /** A deleted thread still holds its id, so the next one cannot be made under it. */
    readonly isTombstone: (threadId: ThreadId) => Effect.Effect<boolean, DepError>;
    /** Deletes a thread of the series, which no command from outside may do. */
    readonly deleteThread: (threadId: ThreadId) => Effect.Effect<void, DepError>;
    /** Workers the Orchestrator started that are still running. */
    readonly liveWorkers: (threadId: ThreadId) => Effect.Effect<number, DepError>;
  };
  readonly settings: Effect.Effect<{
    readonly enabled: boolean;
    /** The thread's own model: the Orchestrator model is applied per turn on top of it. */
    readonly baseModel: ModelSelection | null;
  }>;
  /** Why this model's provider cannot receive the delegation tools, or undefined. */
  readonly supportRefusal: (model: ModelSelection) => Effect.Effect<string | undefined, DepError>;
}

const fail = (reason: string, cause?: unknown) => new KodoOrchestratorError({ reason, cause });

/** A turn is running or a question is waiting on the person: the conversation is not to be reset or hidden. */
const isBusy = (shell: KodoSwarmThreadShell) =>
  shell.activeRunId != null || shell.pendingRuntimeRequest != null;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export const makeKodoSwarmService = (deps: KodoSwarmDeps) => {
  /** The newest live thread of the series, and the id the next one would take. */
  const findSeries = Effect.fn("KodoSwarm.findSeries")(
    function* () {
      let live: { readonly threadId: ThreadId; readonly shell: KodoSwarmThreadShell } | undefined;
      for (let generation = 1; ; generation += 1) {
        const threadId = kodoOrchestratorThreadIdFor(generation);
        const shell = yield* deps.threads.getThreadShell(threadId);
        if (shell === null) {
          if (!(yield* deps.threads.isTombstone(threadId))) {
            return { live, next: threadId, generation } as const;
          }
          continue;
        }
        if (shell.deletedAt === null) live = { threadId, shell };
      }
    },
    Effect.mapError((cause) => fail("The Orchestrator could not be read.", cause)),
  );

  const requireEnabled = Effect.gen(function* () {
    const settings = yield* deps.settings;
    if (!settings.enabled) {
      return yield* fail("The Orchestrator is turned off in Settings.");
    }
    return settings;
  });

  const requireSupport = Effect.fn("KodoSwarm.requireSupport")(function* (model: ModelSelection) {
    const refusal = yield* deps
      .supportRefusal(model)
      .pipe(
        Effect.mapError((cause) => fail("The Orchestrator's model could not be checked.", cause)),
      );
    if (refusal !== undefined) return yield* fail(refusal);
  });

  const createThread = Effect.fn("KodoSwarm.createThread")(function* (
    threadId: ThreadId,
    generation: number,
    model: ModelSelection,
  ) {
    yield* deps.threads
      .dispatch({
        type: "thread.create",
        createdBy: "system",
        creationSource: "server",
        commandId: CommandId.make(
          generation <= 1 ? "kodo-orchestrator:thread" : `kodo-orchestrator:thread:${generation}`,
        ),
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
        // A racing ensure created it first: the same thread, so the same answer, if it is live.
        Effect.catchIf(
          (error) => error._tag === "OrchestratorThreadAlreadyExistsError",
          () =>
            deps.threads
              .getThreadShell(threadId)
              .pipe(
                Effect.flatMap((shell) =>
                  shell === null
                    ? Effect.fail({ _tag: "OrchestratorThreadAlreadyExistsError" })
                    : Effect.void,
                ),
              ),
        ),
        Effect.mapError((cause) => fail("The Orchestrator could not be created.", cause)),
      );
  });

  const ensureProject = deps.makeFolder(deps.workspaceRoot).pipe(
    Effect.mapError((cause) => fail("The Orchestrator's folder could not be created.", cause)),
    Effect.andThen(
      deps.projects
        .ensureKodoOrchestratorProject({ workspaceRoot: deps.workspaceRoot })
        .pipe(
          Effect.mapError((cause) => fail("The Orchestrator's project could not be made.", cause)),
        ),
    ),
  );

  /**
   * Why a conversation that exists would not run as it is; undefined when it would. The setting is
   * not a reason: turning the Orchestrator off hides its row and command, and the conversation still works.
   */
  const runWarning = (model: ModelSelection) =>
    deps.supportRefusal(model).pipe(Effect.orElseSucceed(() => undefined));

  const ensureWith = Effect.fn("KodoSwarm.ensure")(function* (options: {
    readonly freshThread: boolean;
  }) {
    const series = yield* findSeries();
    const current = options.freshThread ? undefined : series.live;
    // A conversation that exists always opens, so a pending question or its usage can still be reached;
    // the checks below guard making one, and a turn on a model that cannot take the tools is refused on its own.
    if (current !== undefined) {
      yield* ensureProject;
      // Nothing archives it, but a lost archive state is put right rather than hiding it for good.
      if (current.shell.archivedAt != null) {
        yield* deps.threads
          .dispatch({
            type: "thread.unarchive",
            commandId: CommandId.make(
              `kodo-orchestrator:unarchive:${String(current.shell.archivedAt)}`,
            ),
            threadId: current.threadId,
          })
          .pipe(Effect.mapError((cause) => fail("The Orchestrator could not be restored.", cause)));
      }
      const warning = yield* runWarning(current.shell.modelSelection);
      return {
        projectId: KODO_ORCHESTRATOR_PROJECT_ID,
        threadId: current.threadId,
        ...(warning === undefined ? {} : { warning }),
      };
    }
    const settings = yield* requireEnabled;
    const model = settings.baseModel;
    if (model === null) {
      return yield* fail("Choose a default model in Settings before opening the Orchestrator.");
    }
    yield* requireSupport(model);
    yield* ensureProject;
    yield* createThread(series.next, series.generation, model);
    return { projectId: KODO_ORCHESTRATOR_PROJECT_ID, threadId: series.next };
  });

  const ensure: Effect.Effect<KodoOrchestratorEnsureResult, KodoOrchestratorError> = ensureWith({
    freshThread: false,
  });

  /** A new conversation, refused while the old one has live workers, a turn or a question open. */
  const reset: Effect.Effect<KodoOrchestratorEnsureResult, KodoOrchestratorError> = Effect.gen(
    function* () {
      const settings = yield* requireEnabled;
      const { live } = yield* findSeries();
      if (live !== undefined) {
        // The new conversation must be makeable before the old one goes.
        if (settings.baseModel === null) {
          return yield* fail(
            "Choose a default model in Settings before resetting the Orchestrator.",
          );
        }
        yield* requireSupport(settings.baseModel);
        const workers = yield* deps.threads
          .liveWorkers(live.threadId)
          .pipe(Effect.mapError((cause) => fail("Its workers could not be read.", cause)));
        if (workers > 0) {
          return yield* fail(
            `${plural(workers, "worker is", "workers are")} still running. Use Stop all in the Orchestrator conversation, then reset.`,
          );
        }
        if (isBusy(live.shell)) {
          return yield* fail(
            "The Orchestrator is in the middle of a turn or waiting on you. Stop it, then reset.",
          );
        }
        yield* deps.threads
          .deleteThread(live.threadId)
          .pipe(Effect.mapError((cause) => fail("The conversation could not be reset.", cause)));
      }
      return yield* ensureWith({ freshThread: true });
    },
  ).pipe(Effect.withSpan("KodoSwarm.reset"));

  /**
   * Turning the Orchestrator off hides the way to stop its workers and to answer its question, so it
   * waits until no worker runs, no turn is going and no question is open. This is the server's rule;
   * the switch in the client only shows it. A read that fails holds it on.
   */
  const guardSettingsPatch = Effect.fn("KodoSwarm.guardSettingsPatch")(function* (patch: {
    readonly kodoOrchestratorEnabled?: boolean | undefined;
  }) {
    if (patch.kodoOrchestratorEnabled !== false) return;
    if (!(yield* deps.settings).enabled) return;
    const holds = yield* findSeries().pipe(
      Effect.flatMap(({ live }) =>
        live === undefined
          ? Effect.succeed(undefined)
          : deps.threads
              .liveWorkers(live.threadId)
              .pipe(
                Effect.map((workers) =>
                  workers > 0
                    ? ("orchestrator-off-with-workers" as const)
                    : isBusy(live.shell)
                      ? ("orchestrator-off-while-busy" as const)
                      : undefined,
                ),
              ),
      ),
      Effect.orElseSucceed(() => "orchestrator-off-with-workers" as const),
    );
    if (holds !== undefined) {
      return yield* new ServerSettingsError({
        settingsPath: "kodoOrchestratorEnabled",
        operation: holds,
      });
    }
  });

  return { ensure, reset, guardSettingsPatch } as const;
};

export type KodoSwarmService = ReturnType<typeof makeKodoSwarmService>;
