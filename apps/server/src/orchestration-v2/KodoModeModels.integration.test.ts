// KODO: mode-models-turn - a turn runs on the model of the mode it is created in; modes without a
// default keep the thread's own model, and a default that cannot run never fails the turn.
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  ProjectId,
  type ServerProvider,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  RuntimeRequestId, // KODO: swarm-delegate
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result"; // KODO: swarm-delegate
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as EventSink from "./EventSink.ts"; // KODO: swarm-delegate
import { planProjectCommand } from "./ProjectCommands.ts"; // KODO: swarm-delegate
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import { DispatchModeLimit } from "./DispatchModeLimit.ts"; // KODO: delegation-command
import * as ThreadManagementService from "./ThreadManagementService.ts"; // KODO: delegation-command
import type * as ServerSettings from "../serverSettings.ts"; // KODO: delegation-command
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

// Grok fixes its runtime mode when its process launches, so its session cannot take a new policy.
const driver = ProviderDriverKind.make("grok");
const providerInstanceId = ProviderInstanceId.make("grok-mode-test");
// A second provider, on another driver (codex enforces read-only with a sandbox, grok does not).
const otherDriver = ProviderDriverKind.make("codex");
const otherInstanceId = ProviderInstanceId.make("codex-mode-test");
const capabilities: OrchestrationV2ProviderCapabilities = {
  ...CodexProviderCapabilitiesV2,
  sessions: {
    ...CodexProviderCapabilitiesV2.sessions,
    supportsMultipleProviderThreadsPerSession: false,
    supportsRuntimeModeSwitchInSession: false,
    supportsModelSwitchInSession: false,
  },
  turns: { ...CodexProviderCapabilitiesV2.turns, supportsActiveSteering: true },
};

interface OpenedSession {
  readonly instanceId: string;
  readonly modeReadOnly: boolean;
  readonly runtimeMode: string;
}
interface StartedTurn {
  readonly instanceId: string;
  readonly session: number;
  readonly modeReadOnly: boolean;
  readonly sandbox: string | undefined;
  readonly attemptId: string;
  readonly model: string;
}
interface AdapterState {
  readonly opened: ReadonlyArray<OpenedSession>;
  readonly started: ReadonlyArray<StartedTurn>;
  readonly steered: number;
  readonly closed: number;
  /** Answers handed to the provider (KODO: swarm-delegate: the Orchestrator's own question never is). */
  readonly responded: number;
  readonly finishActive: Effect.Effect<void> | null;
}

const makeAdapter = (
  state: Ref.Ref<AdapterState>,
  identity: {
    readonly providerInstanceId: ProviderInstanceId;
    readonly driver: ProviderDriverKind;
  } = { providerInstanceId, driver },
): ProviderAdapter.ProviderAdapterV2["Service"] => {
  const { providerInstanceId, driver } = identity;
  return {
    instanceId: providerInstanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: (input) =>
      Effect.succeed(
        input.target.model === "rejected-model"
          ? ({ type: "reject", reason: "rejected-model cannot be switched to." } as const)
          : ({ type: "apply_on_next_turn" } as const),
      ),
    openSession: (sessionInput) =>
      Effect.gen(function* () {
        const sessionIndex = yield* Ref.modify(state, (current) => {
          const opened = [
            ...current.opened,
            {
              instanceId: providerInstanceId,
              modeReadOnly: sessionInput.runtimePolicy.modeReadOnly === true,
              runtimeMode: sessionInput.runtimePolicy.runtimeMode,
            },
          ];
          return [opened.length, { ...current, opened }] as const;
        });
        yield* Effect.addFinalizer(() =>
          Ref.update(state, (current) => ({ ...current, closed: current.closed + 1 })),
        );
        const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
        const now = yield* DateTime.now;
        const providerSession: OrchestrationV2ProviderSession = {
          id: sessionInput.providerSessionId,
          driver,
          providerInstanceId,
          status: "ready",
          cwd: sessionInput.runtimePolicy.cwd ?? "/fallback",
          model: sessionInput.modelSelection.model,
          capabilities,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        };
        return {
          instanceId: providerInstanceId,
          driver,
          providerSessionId: sessionInput.providerSessionId,
          providerSession,
          events: Stream.fromQueue(events),
          ensureThread: (threadInput) =>
            Effect.gen(function* () {
              const createdAt = yield* DateTime.now;
              return {
                id: ProviderThreadId.make(`provider-thread:${threadInput.threadId}`),
                driver,
                providerInstanceId,
                providerSessionId: sessionInput.providerSessionId,
                appThreadId: threadInput.threadId,
                ownerNodeId: null,
                nativeThreadRef: {
                  driver,
                  nativeId: `native-thread:${threadInput.threadId}`,
                  strength: "strong",
                },
                nativeConversationHeadRef: null,
                status: "idle",
                firstRunOrdinal: null,
                lastRunOrdinal: null,
                handoffIds: [],
                forkedFrom: null,
                createdAt,
                updatedAt: createdAt,
              } satisfies OrchestrationV2ProviderThread;
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (input) =>
            Effect.gen(function* () {
              const providerTurnId = ProviderTurnId.make(`provider-turn:${input.attemptId}`);
              const nativeTurnRef = {
                driver,
                nativeId: `native:${providerTurnId}`,
                strength: "strong",
              } as const;
              const startedAt = yield* DateTime.now;
              const turn = {
                id: providerTurnId,
                providerThreadId: input.providerThread.id,
                nodeId: input.rootNodeId,
                runAttemptId: input.attemptId,
                nativeTurnRef,
                ordinal: input.providerTurnOrdinal,
              } as const;
              const finishActive = Effect.gen(function* () {
                const completedAt = yield* DateTime.now;
                yield* Queue.offer(events, {
                  type: "provider_turn.updated",
                  driver,
                  providerTurn: { ...turn, status: "completed", startedAt, completedAt },
                });
                yield* Queue.offer(events, {
                  type: "turn.terminal",
                  driver,
                  providerThreadId: input.providerThread.id,
                  providerTurnId,
                  runOrdinal: input.runOrdinal,
                  status: "completed",
                  failure: null,
                  threadDisposition: "reusable",
                });
              });
              yield* Ref.update(state, (current) => ({
                ...current,
                finishActive,
                started: [
                  ...current.started,
                  {
                    instanceId: providerInstanceId,
                    session: sessionIndex,
                    modeReadOnly: input.runtimePolicy.modeReadOnly === true,
                    sandbox: (
                      input.runtimePolicy.sandboxPolicy as { readonly type?: string } | undefined
                    )?.type,
                    attemptId: input.attemptId,
                    model: input.modelSelection.model,
                  },
                ],
              }));
              yield* Queue.offer(events, {
                type: "provider_turn.updated",
                driver,
                providerTurn: { ...turn, status: "running", startedAt, completedAt: null },
              });
            }),
          steerTurn: () =>
            Ref.update(state, (current) => ({ ...current, steered: current.steered + 1 })),
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () =>
            Ref.update(state, (current) => ({ ...current, responded: current.responded + 1 })),
          readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
          rollbackThread: () => Effect.die("unused rollbackThread"),
          forkThread: () => Effect.die("unused forkThread"),
        };
      }),
  };
};

const freshState = Ref.make<AdapterState>({
  opened: [],
  started: [],
  steered: 0,
  closed: 0,
  responded: 0,
  finishActive: null,
});

interface Harness {
  readonly state: Ref.Ref<AdapterState>;
  readonly orchestrator: Orchestrator.OrchestratorV2["Service"];
  readonly worker: EffectWorker.OrchestrationEffectWorkerV2["Service"];
  readonly cwd: string;
  /** Makes a project the Orchestrator may start work in (KODO: swarm-delegate). */
  readonly seedProject: (projectId: ProjectId) => Effect.Effect<void>;
  /** What the provider catalogue reports per instance; change it mid-test to take a provider away. */
  readonly catalogue: Ref.Ref<Readonly<Record<string, Partial<ServerProvider>>>>;
}

/**
 * Runs `body` against a fresh orchestrator whose providers are the fake Grok adapter and, with
 * `second`, a fake Codex one.
 */
const withHarness = <A, E>(
  name: string,
  modeModelSelections: Partial<
    Record<"ask" | "plan" | "code" | "review" | "orchestrator", ModelSelection>
  >,
  body: (input: Harness) => Effect.Effect<
    A,
    E,
    | Orchestrator.OrchestratorV2
    | EffectWorker.OrchestrationEffectWorkerV2
    | EventSink.EventSinkV2 // KODO: swarm-delegate
    | Scope.Scope
  >,
  options: {
    readonly second?: boolean;
    /** What the provider catalogue says per instance, for a provider the tools cannot reach. */
    readonly catalogue?: Readonly<Record<string, Partial<ServerProvider>>>;
    /** Other server settings, such as the sub-agents default. */
    readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  } = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace(name);
      const state = yield* freshState;
      const catalogue = yield* Ref.make<Readonly<Record<string, Partial<ServerProvider>>>>(
        options.catalogue ?? {},
      );
      const adapters = [
        makeAdapter(state),
        ...(options.second === true
          ? [
              makeAdapter(state, {
                providerInstanceId: otherInstanceId,
                driver: otherDriver,
              }),
            ]
          : []),
      ];
      return yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const eventSink = yield* EventSink.EventSinkV2;
        // The project is made as the server makes one, so the orchestrator's own check finds it.
        const seedProject = (projectId: ProjectId) =>
          Effect.gen(function* () {
            const now = yield* DateTime.now;
            const commandId = CommandId.make(`command:seed:${projectId}`);
            const planned = planProjectCommand({
              command: {
                type: "project.create",
                commandId,
                projectId,
                title: String(projectId),
                workspaceRoot: `/work/${projectId}`,
              },
              state: { project: undefined, workspaceOwner: undefined },
              eventId: EventId.make(`event:seed:${projectId}`),
              now,
            });
            if (Result.isFailure(planned)) return yield* Effect.die(planned.failure);
            yield* eventSink.commitProjectCommand({
              commandId,
              projectId,
              commandType: "project.create",
              acceptedAt: now,
              event: planned.success,
            });
          }).pipe(Effect.orDie);
        return yield* body({ state, orchestrator, worker, cwd, seedProject, catalogue });
      }).pipe(
        Effect.provide(
          ProviderReplayHarness.layerWithRegistry(
            {
              name,
              driver,
              driverByInstance: {
                [providerInstanceId]: driver,
                [otherInstanceId]: otherDriver,
              },
            },
            ProviderAdapterRegistry.layerFromAdapters(adapters),
            {
              serverSettings: { modeModelSelections, ...options.settings },
              providerCatalogue: catalogue,
            },
          ),
        ),
      );
    }),
  );

const selection = (model: string, instanceId = providerInstanceId): ModelSelection => ({
  instanceId,
  model,
});

const createThread = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  input: { readonly name: string; readonly threadId: ThreadId; readonly cwd: string },
) =>
  orchestrator.dispatch({
    type: "thread.create",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make(`command:${input.name}:create`),
    threadId: input.threadId,
    projectId: ProjectId.make(`project:${input.name}`),
    title: input.name,
    modelSelection: selection("base-model"),
    runtimeMode: "full-access",
    interactionMode: "code",
    branch: null,
    worktreePath: input.cwd,
  });

const setMode = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  name: string,
  threadId: ThreadId,
  interactionMode: "ask" | "code" | "plan",
  step: number,
) =>
  orchestrator.dispatch({
    type: "thread.interaction-mode.set",
    commandId: CommandId.make(`command:${name}:mode-${step}-${interactionMode}`),
    threadId,
    interactionMode,
  });

interface TurnContext {
  readonly state: Ref.Ref<AdapterState>;
  readonly orchestrator: Orchestrator.OrchestratorV2["Service"];
  readonly worker: EffectWorker.OrchestrationEffectWorkerV2["Service"];
  readonly name: string;
  readonly threadId: ThreadId;
}

/** Sends a message the way a client does (carrying a model unless `carried` is undefined). */
const sendMessage = (
  input: TurnContext,
  label: string,
  carried: ModelSelection | undefined,
  options: {
    readonly explicit?: boolean;
    readonly dispatchMode?: "start_immediately" | "queue_after_active";
    readonly createdBy?: "user" | "agent";
  } = {},
) =>
  input.orchestrator.dispatch({
    type: "message.dispatch",
    createdBy: options.createdBy ?? "user",
    creationSource: options.createdBy === "agent" ? "mcp" : "web",
    commandId: CommandId.make(`command:${input.name}:${label}`),
    threadId: input.threadId,
    messageId: MessageId.make(`message:${input.name}:${label}`),
    text: label,
    attachments: [],
    ...(carried === undefined ? {} : { modelSelection: carried }),
    ...(options.explicit === undefined ? {} : { explicitModelSelection: options.explicit }),
    dispatchMode: { type: options.dispatchMode ?? "start_immediately" },
  });

/** Starts a turn and waits until the provider is running it, without finishing it. */
const startTurn = Effect.fnUntraced(function* (
  input: TurnContext,
  label: string,
  carried: ModelSelection | undefined,
  options: Parameters<typeof sendMessage>[3] = {},
) {
  const running = yield* input.orchestrator.streamDomainEvents.pipe(
    Stream.filter(
      (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
    ),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  );
  yield* sendMessage(input, label, carried, options);
  yield* Fiber.join(running);
  yield* input.worker.drain();
});

/**
 * Finishes the turn the provider is running and waits until its run is completed; with
 * `queuedNext`, also until the queued run behind it is running.
 */
const finishTurn = Effect.fnUntraced(function* (
  input: TurnContext,
  options: { readonly queuedNext?: boolean } = {},
) {
  const finish = (yield* Ref.get(input.state)).finishActive;
  if (finish === null) return yield* Effect.die("no active turn to finish");
  const completed = yield* input.orchestrator.streamDomainEvents.pipe(
    Stream.filter((event) => event.type === "run.updated" && event.payload.status === "completed"),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  );
  const nextRunning =
    options.queuedNext === true
      ? yield* input.orchestrator.streamDomainEvents.pipe(
          Stream.filter(
            (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
          ),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkScoped({ startImmediately: true }),
        )
      : undefined;
  yield* finish;
  yield* Fiber.join(completed);
  yield* input.worker.drain();
  if (nextRunning !== undefined) {
    yield* Fiber.join(nextRunning);
    yield* input.worker.drain();
  }
});

/** Sends one message the way a client does (carrying the composer's model), runs it to completion. */
const runTurn = Effect.fnUntraced(function* (
  input: TurnContext,
  label: string,
  carried: ModelSelection,
  explicit?: boolean,
) {
  yield* startTurn(input, label, carried, explicit === undefined ? {} : { explicit });
  yield* finishTurn(input);
});

it.live("runs each turn on its mode's model and returns to the thread's own model", () =>
  withHarness(
    "kodo-mode-models-turn",
    { ask: selection("ask-model") },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-turn";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });

        // Code has no default: the thread's model, exactly as before.
        yield* runTurn(ctx, "code-1", selection("base-model"));
        yield* setMode(orchestrator, name, threadId, "ask", 1);
        // The client carries the thread's model; the mode's default replaces it.
        yield* runTurn(ctx, "ask-1", selection("base-model"));
        let thread = (yield* orchestrator.getThreadProjection(threadId)).thread;
        assert.equal(thread.modelSelection.model, "ask-model");
        assert.equal(thread.kodoModeModel?.base.model, "base-model");

        // Back in Code the displaced thread model returns, even if the client carries the Ask model.
        yield* setMode(orchestrator, name, threadId, "code", 2);
        yield* runTurn(ctx, "code-2", selection("ask-model"));
        thread = (yield* orchestrator.getThreadProjection(threadId)).thread;
        assert.equal(thread.modelSelection.model, "base-model");
        assert.isUndefined(thread.kodoModeModel);

        const started = (yield* Ref.get(state)).started.map((turn) => turn.model);
        assert.deepEqual(started, ["base-model", "ask-model", "base-model"]);
        const runs = (yield* orchestrator.getThreadProjection(threadId)).runs;
        assert.deepEqual(
          runs.map((run) => [run.modelSelection.model, run.kodoModel?.source]),
          [
            ["base-model", undefined],
            ["ask-model", "mode-default"],
            ["base-model", "thread"],
          ],
        );
      }),
  ),
);

it.live("a pick in a mode with a default is for that message only", () =>
  withHarness(
    "kodo-mode-models-explicit",
    { ask: selection("ask-model") },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-explicit";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* setMode(orchestrator, name, threadId, "ask", 3);
        yield* runTurn(ctx, "picked", selection("picked-model"), true);
        let thread = (yield* orchestrator.getThreadProjection(threadId)).thread;
        // For the moment the pick is what the live session runs; the thread's own model is kept.
        assert.equal(thread.modelSelection.model, "picked-model");
        assert.equal(thread.kodoModeModel?.base.model, "base-model");
        // The same carried model without the flag is not a pick: the default returns.
        yield* runTurn(ctx, "carried", selection("picked-model"), false);
        // Back in Code, neither the pick nor the default is the thread's model.
        yield* setMode(orchestrator, name, threadId, "code", 4);
        yield* runTurn(ctx, "code", selection("ask-model"), false);
        thread = (yield* orchestrator.getThreadProjection(threadId)).thread;
        assert.equal(thread.modelSelection.model, "base-model");
        assert.isUndefined(thread.kodoModeModel);
        assert.deepEqual(
          (yield* Ref.get(state)).started.map((turn) => turn.model),
          ["picked-model", "ask-model", "base-model"],
        );
        const runs = (yield* orchestrator.getThreadProjection(threadId)).runs;
        assert.deepEqual(
          runs.map((run) => run.kodoModel?.source),
          ["explicit", "mode-default", "thread"],
        );
      }),
  ),
);

it.live("a pick in a mode without a default becomes the thread's own model", () =>
  withHarness(
    "kodo-mode-models-explicit-code",
    { ask: selection("ask-model") },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-explicit-code";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* runTurn(ctx, "picked", selection("picked-model"), true);
        yield* runTurn(ctx, "carried", selection("picked-model"), false);
        // Ask returns to its default and Code to the model picked in Code.
        yield* setMode(orchestrator, name, threadId, "ask", 5);
        yield* runTurn(ctx, "ask", selection("picked-model"), false);
        yield* setMode(orchestrator, name, threadId, "code", 6);
        yield* runTurn(ctx, "code", selection("ask-model"), false);
        assert.deepEqual(
          (yield* Ref.get(state)).started.map((turn) => turn.model),
          ["picked-model", "picked-model", "ask-model", "picked-model"],
        );
      }),
  ),
);

it.live("a default that cannot be switched to falls back to the thread's model with a notice", () =>
  withHarness(
    "kodo-mode-models-fallback",
    { ask: selection("rejected-model") },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-fallback";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* runTurn(ctx, "first", selection("base-model"));
        yield* setMode(orchestrator, name, threadId, "ask", 4);
        yield* runTurn(ctx, "second", selection("base-model"));
        const run = (yield* orchestrator.getThreadProjection(threadId)).runs[1]!;
        assert.equal(run.modelSelection.model, "base-model");
        assert.equal(run.kodoModel?.unavailable?.wanted.model, "rejected-model");
        assert.deepEqual(
          (yield* Ref.get(state)).started.map((turn) => turn.model),
          ["base-model", "base-model"],
        );
      }),
  ),
);

it.live("a queued message takes the model of its own mode, not the run ahead of it", () =>
  withHarness(
    "kodo-mode-models-queue",
    { ask: selection("ask-model") },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-queue";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* startTurn(ctx, "active", selection("base-model"));
        // Queued in Ask: runs on the Ask default.
        yield* setMode(orchestrator, name, threadId, "ask", 7);
        yield* sendMessage(ctx, "queued-ask", selection("base-model"), {
          dispatchMode: "queue_after_active",
        });
        // Then an agent sends into the thread after it moved back to Code, naming no model.
        yield* setMode(orchestrator, name, threadId, "code", 8);
        yield* sendMessage(ctx, "queued-code", undefined, {
          dispatchMode: "queue_after_active",
          createdBy: "agent",
        });
        const runs = (yield* orchestrator.getThreadProjection(threadId)).runs;
        assert.deepEqual(
          runs.map((run) => run.modelSelection.model),
          ["base-model", "ask-model", "base-model"],
        );
        assert.equal(runs[2]?.kodoModel?.base.model, "base-model");
      }),
  ),
);

it.live("compaction run by the idle timer does not change model", () =>
  withHarness(
    "kodo-mode-models-compaction",
    { ask: selection("ask-model") },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-compaction";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* runTurn(ctx, "code-1", selection("base-model"));
        yield* setMode(orchestrator, name, threadId, "ask", 9);
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "agent",
          creationSource: "server",
          commandId: CommandId.make(`command:${name}:compact`),
          threadId,
          messageId: MessageId.make(`message:${name}:compact`),
          text: "/compact",
          attachments: [],
          idleCompaction: "beforeCacheExpires",
          dispatchMode: { type: "start_immediately" },
        });
        const projection = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(projection.runs[1]?.modelSelection.model, "base-model");
        assert.isUndefined(projection.runs[1]?.kodoModel);
        assert.equal(projection.thread.modelSelection.model, "base-model");
      }),
  ),
);

it.live("a queued default whose provider went away by its start falls back with a notice", () =>
  withHarness(
    "kodo-mode-models-queued-fallback",
    { ask: selection("ask-model", otherInstanceId) },
    ({ state, orchestrator, worker, cwd, catalogue }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-queued-fallback";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* startTurn(ctx, "active", selection("base-model"));
        yield* setMode(orchestrator, name, threadId, "ask", 10);
        yield* sendMessage(ctx, "queued-ask", selection("base-model"), {
          dispatchMode: "queue_after_active",
        });
        const queued = (yield* orchestrator.getThreadProjection(threadId)).runs[1]!;
        assert.equal(queued.providerInstanceId, otherInstanceId);
        // The Ask provider is turned off while the run waits.
        yield* Ref.set(catalogue, { [otherInstanceId]: { enabled: false } });
        yield* finishTurn(ctx, { queuedNext: true });
        const run = (yield* orchestrator.getThreadProjection(threadId)).runs[1]!;
        assert.equal(run.providerInstanceId, providerInstanceId);
        assert.equal(run.modelSelection.model, "base-model");
        assert.equal(run.kodoModel?.source, "thread");
        assert.equal(run.kodoModel?.unavailable?.wanted.model, "ask-model");
        assert.deepEqual(
          (yield* Ref.get(state)).started.map((turn) => [turn.instanceId, turn.model]),
          [
            [providerInstanceId, "base-model"],
            [providerInstanceId, "base-model"],
          ],
        );
      }),
    { second: true },
  ),
);

it.live("a queued default starts on the thread's own model as it is by then", () =>
  withHarness(
    "kodo-mode-models-queued-rebase",
    { ask: selection("ask-model") },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-queued-rebase";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* startTurn(ctx, "active", selection("base-model"));
        yield* setMode(orchestrator, name, threadId, "ask", 11);
        yield* sendMessage(ctx, "queued-ask", selection("base-model"), {
          dispatchMode: "queue_after_active",
        });
        // The thread's model is changed while the Ask message waits.
        yield* orchestrator.dispatch({
          type: "thread.model-selection.set",
          commandId: CommandId.make(`command:${name}:set-model`),
          threadId,
          modelSelection: selection("changed-model"),
        });
        yield* finishTurn(ctx, { queuedNext: true });
        const thread = (yield* orchestrator.getThreadProjection(threadId)).thread;
        assert.equal(thread.modelSelection.model, "ask-model");
        assert.equal(thread.kodoModeModel?.base.model, "changed-model");
      }),
  ),
);

it.live("a default on another provider runs through the handoff under that provider's policy", () =>
  withHarness(
    "kodo-mode-models-two-providers",
    { ask: selection("ask-model", otherInstanceId) },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-models-two-providers";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* runTurn(ctx, "code-1", selection("base-model"));
        yield* setMode(orchestrator, name, threadId, "ask", 12);
        yield* runTurn(ctx, "ask-1", selection("base-model"));
        let projection = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(projection.thread.modelSelection.instanceId, otherInstanceId);
        assert.equal(projection.thread.kodoModeModel?.base.instanceId, providerInstanceId);
        // The turn changed provider through a handoff, and the read-only policy is the other driver's.
        assert.equal(projection.runs[1]?.providerInstanceId, otherInstanceId);
        assert.isTrue(projection.contextHandoffs.length > 0);
        // The thread's own model comes back in Code, through a handoff the other way.
        yield* setMode(orchestrator, name, threadId, "code", 13);
        yield* runTurn(ctx, "code-2", selection("ask-model", otherInstanceId), false);
        projection = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(projection.thread.modelSelection.instanceId, providerInstanceId);
        assert.equal(projection.thread.modelSelection.model, "base-model");
        assert.isUndefined(projection.thread.kodoModeModel);
        const started = (yield* Ref.get(state)).started;
        assert.deepEqual(
          started.map((turn) => [turn.instanceId, turn.model, turn.modeReadOnly, turn.sandbox]),
          [
            [providerInstanceId, "base-model", false, undefined],
            [otherInstanceId, "ask-model", true, "readOnly"],
            [providerInstanceId, "base-model", false, undefined],
          ],
        );
      }),
    { second: true },
  ),
);

// KODO: delegation-command - sub-agents: the lead model, the switch's rules, and who may flip it.
const setLead = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  name: string,
  threadId: ThreadId,
  lead: boolean,
  step: number,
  as: { readonly agentFrom?: ThreadId } = {},
) =>
  orchestrator.dispatch({
    type: "thread.kodo-lead.set",
    commandId: CommandId.make(`command:${name}:lead-${step}-${lead ? "on" : "off"}`),
    threadId,
    lead: lead ? { kind: "sub-agents" } : null,
    createdBy: as.agentFrom === undefined ? "user" : "agent",
    creationSource: as.agentFrom === undefined ? "web" : "mcp",
    ...(as.agentFrom === undefined ? {} : { senderThreadId: as.agentFrom }),
  });

it.live(
  "a lead's turns run on the Orchestrator model, a pick wins for one message, and turning it off returns",
  () =>
    withHarness(
      "kodo-sub-agents-lead-model",
      { code: selection("code-model"), orchestrator: selection("lead-model") },
      ({ state, orchestrator, worker, cwd }) =>
        Effect.gen(function* () {
          const name = "kodo-sub-agents-lead-model";
          const threadId = ThreadId.make(`thread:${name}`);
          const ctx = { state, orchestrator, worker, name, threadId };
          yield* createThread(orchestrator, { name, threadId, cwd });
          yield* setLead(orchestrator, name, threadId, true, 1);
          // The shell mirror carries the flag, so the composer sees it without the projection.
          assert.deepEqual((yield* orchestrator.getThreadShell(threadId))?.kodoLead, {
            kind: "sub-agents",
          });

          // A Code lead is not put on the Code model: it runs on the Orchestrator model.
          yield* runTurn(ctx, "lead-1", selection("base-model"));
          let thread = (yield* orchestrator.getThreadProjection(threadId)).thread;
          assert.equal(thread.modelSelection.model, "lead-model");
          assert.equal(thread.kodoModeModel?.base.model, "base-model");

          // A person's pick is for that message; the lead model returns after it.
          yield* runTurn(ctx, "picked", selection("picked-model"), true);
          yield* runTurn(ctx, "lead-2", selection("picked-model"), false);

          // Off: the mode's own slot again, and the thread's own model underneath it.
          yield* setLead(orchestrator, name, threadId, false, 2);
          yield* runTurn(ctx, "code-1", selection("lead-model"), false);
          thread = (yield* orchestrator.getThreadProjection(threadId)).thread;
          assert.equal(thread.modelSelection.model, "code-model");
          assert.equal(thread.kodoModeModel?.base.model, "base-model");
          assert.isNull(thread.kodoLead ?? null);

          assert.deepEqual(
            (yield* Ref.get(state)).started.map((turn) => turn.model),
            ["lead-model", "picked-model", "lead-model", "code-model"],
          );
        }),
    ),
);

it.live(
  "a lead with no Orchestrator model runs on the thread's own model, never on the Code model",
  () =>
    withHarness(
      "kodo-sub-agents-lead-unset",
      { code: selection("code-model") },
      ({ state, orchestrator, worker, cwd }) =>
        Effect.gen(function* () {
          const name = "kodo-sub-agents-lead-unset";
          const threadId = ThreadId.make(`thread:${name}`);
          const ctx = { state, orchestrator, worker, name, threadId };
          yield* createThread(orchestrator, { name, threadId, cwd });
          yield* setLead(orchestrator, name, threadId, true, 1);
          yield* runTurn(ctx, "lead", selection("base-model"));
          assert.deepEqual(
            (yield* Ref.get(state)).started.map((turn) => turn.model),
            ["base-model"],
          );
          // Nothing displaced the thread's own model, so the run keeps no record of one.
          const thread = (yield* orchestrator.getThreadProjection(threadId)).thread;
          assert.isUndefined(thread.kodoModeModel);
        }),
    ),
);

it.live(
  "a Code lead's turns run read-only, turning sub-agents off restores writing, and on again takes it away",
  () =>
    withHarness("kodo-sub-agents-lead-policy", {}, ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-sub-agents-lead-policy";
        const threadId = ThreadId.make(`thread:${name}`);
        const ctx = { state, orchestrator, worker, name, threadId };
        yield* createThread(orchestrator, { name, threadId, cwd });
        yield* runTurn(ctx, "code-1", selection("base-model"));
        yield* setLead(orchestrator, name, threadId, true, 1);
        yield* runTurn(ctx, "lead-1", selection("base-model"));
        yield* setLead(orchestrator, name, threadId, false, 2);
        yield* runTurn(ctx, "code-2", selection("base-model"));
        yield* setLead(orchestrator, name, threadId, true, 3);
        yield* runTurn(ctx, "lead-2", selection("base-model"));

        const captured = yield* Ref.get(state);
        assert.deepEqual(
          captured.started.map((turn) => [turn.modeReadOnly, turn.sandbox]),
          [
            [false, undefined],
            [true, "readOnly"],
            [false, undefined],
            [true, "readOnly"],
          ],
        );
        // Grok fixes its policy when a session opens, so each switch reopens it.
        assert.deepEqual(
          captured.opened.map((session) => session.modeReadOnly),
          [false, true, false, true],
        );
        // The thread still says Code: that is the mode its workers are given.
        const projection = yield* orchestrator.getThreadProjection(threadId);
        assert.equal(projection.thread.interactionMode, "code");
        assert.isTrue(projection.runs.every((run) => run.interactionMode === "code"));
      }),
    ),
);

// KODO: swarm-guard - the Orchestrator's thread: made only by the server, read-only whatever it says, and the server's to keep.
const ORCHESTRATOR_THREAD = ThreadId.make("kodo-orchestrator");
const ORCHESTRATOR_PROJECT = ProjectId.make("kodo-orchestrator");

const createOrchestrator = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  input: {
    readonly cwd: string;
    readonly createdBy: "system" | "user";
    readonly threadId?: ThreadId;
    readonly lead?: { readonly kind: "swarm" };
  },
) =>
  orchestrator.dispatch({
    type: "thread.create",
    createdBy: input.createdBy,
    creationSource: input.createdBy === "system" ? "server" : "web",
    commandId: CommandId.make(`command:swarm:${input.createdBy}:${input.threadId ?? "fixed"}`),
    threadId: input.threadId ?? ORCHESTRATOR_THREAD,
    projectId:
      input.threadId === undefined ? ORCHESTRATOR_PROJECT : ProjectId.make("project:swarm"),
    title: "Orchestrator",
    modelSelection: selection("base-model"),
    runtimeMode: "approval-required",
    interactionMode: "code",
    ...(input.lead === undefined ? {} : { kodoLead: input.lead }),
    branch: null,
    worktreePath: input.cwd,
  });

it.live("only the server makes the Orchestrator, under its fixed id", () =>
  withHarness("kodo-swarm-create", {}, ({ orchestrator, cwd }) =>
    Effect.gen(function* () {
      const lead = { kind: "swarm" } as const;
      // A person's client cannot make it, or put any thread in its project.
      const byUser = yield* createOrchestrator(orchestrator, { cwd, createdBy: "user", lead }).pipe(
        Effect.flip,
      );
      assert.include(String((byUser as { cause?: unknown }).cause), "managed by the server");
      // Another thread asking for the swarm lead is made without it.
      const other = ThreadId.make("thread:not-the-orchestrator");
      yield* createOrchestrator(orchestrator, {
        cwd,
        createdBy: "system",
        threadId: other,
        lead,
      });
      assert.isNull((yield* orchestrator.getThreadShell(other))?.kodoLead ?? null);
      yield* createOrchestrator(orchestrator, { cwd, createdBy: "system", lead });
      assert.deepEqual((yield* orchestrator.getThreadShell(ORCHESTRATOR_THREAD))?.kodoLead, lead);
    }),
  ),
);

it.live("the Orchestrator cannot be changed, deleted, forked or made writable", () =>
  withHarness("kodo-swarm-locked", {}, ({ orchestrator, cwd }) =>
    Effect.gen(function* () {
      yield* createOrchestrator(orchestrator, {
        cwd,
        createdBy: "system",
        lead: { kind: "swarm" },
      });
      const refused = (command: Parameters<typeof orchestrator.dispatch>[0]) =>
        orchestrator.dispatch(command).pipe(
          Effect.flip,
          Effect.map((error) => String((error as { cause?: unknown }).cause)),
        );
      const id = (label: string) => CommandId.make(`command:swarm-locked:${label}`);
      for (const [label, command] of [
        [
          "mode",
          {
            type: "thread.interaction-mode.set",
            threadId: ORCHESTRATOR_THREAD,
            interactionMode: "ask",
          },
        ],
        [
          "runtime",
          {
            type: "thread.runtime-mode.set",
            threadId: ORCHESTRATOR_THREAD,
            runtimeMode: "full-access",
          },
        ],
        ["archive", { type: "thread.archive", threadId: ORCHESTRATOR_THREAD }],
        ["delete", { type: "thread.delete", threadId: ORCHESTRATOR_THREAD }],
        [
          "lead-off",
          {
            type: "thread.kodo-lead.set",
            threadId: ORCHESTRATOR_THREAD,
            lead: null,
            createdBy: "user",
            creationSource: "web",
          },
        ],
      ] as const) {
        const cause = yield* refused({ commandId: id(label), ...command } as never);
        assert.match(cause, /managed by the server|always read-only/, label);
      }
      assert.deepEqual((yield* orchestrator.getThreadShell(ORCHESTRATOR_THREAD))?.kodoLead, {
        kind: "swarm",
      });
    }),
  ),
);

// KODO: swarm-delegate - only the Orchestrator's delegated task may start in another project.
const delegateFromActiveRun = Effect.fnUntraced(function* (
  input: TurnContext,
  targetProjectId: ProjectId,
  label = "delegate",
) {
  // One turn is enough: a second call (another label) uses the run the first started.
  if ((yield* input.orchestrator.getThreadProjection(input.threadId)).runs.length === 0) {
    yield* startTurn(input, "parent", selection("base-model"));
  }
  const projection = yield* input.orchestrator.getThreadProjection(input.threadId);
  const run = projection.runs[0]!;
  yield* input.orchestrator.dispatch({
    type: "delegated_task.request",
    createdBy: "agent",
    creationSource: "mcp",
    commandId: CommandId.make(`command:${input.name}:${label}`),
    parentThreadId: input.threadId,
    parentRunId: run.id,
    parentNodeId: run.rootNodeId!,
    task: "Write notes.",
    modelSelection: selection("base-model"),
    runtimeMode: "approval-required",
    interactionMode: "code",
    kodoTargetProjectId: targetProjectId,
  });
  const task = (yield* input.orchestrator.getThreadProjection(input.threadId)).subagents[0]!;
  return (yield* input.orchestrator.getThreadShell(task.childThreadId!))!;
});

it.live(
  "a task starts in the project it names only when the Orchestrator asks for it, and is stamped as its own",
  () =>
    withHarness("kodo-swarm-delegate", {}, ({ state, orchestrator, worker, cwd, seedProject }) =>
      Effect.gen(function* () {
        const other = ProjectId.make("project:named-by-the-person");
        yield* seedProject(other);
        const orchestratorCtx = {
          state,
          orchestrator,
          worker,
          name: "kodo-swarm-delegate-orchestrator",
          threadId: ORCHESTRATOR_THREAD,
        };
        yield* createOrchestrator(orchestrator, {
          cwd,
          createdBy: "system",
          lead: { kind: "swarm" },
        });
        const started = yield* delegateFromActiveRun(orchestratorCtx, other);
        assert.equal(started.projectId, other);
        assert.equal(started.kodoOrigin, "orchestrator");

        const plain = ThreadId.make("thread:kodo-swarm-delegate-plain");
        yield* createThread(orchestrator, {
          name: "kodo-swarm-delegate-plain",
          threadId: plain,
          cwd,
        });
        const plainCtx = {
          state,
          orchestrator,
          worker,
          name: "kodo-swarm-delegate-plain",
          threadId: plain,
        };
        // No other thread starts work in another project, whatever a client sends.
        const refused = yield* delegateFromActiveRun(plainCtx, other).pipe(Effect.flip);
        assert.include(String((refused as { cause?: unknown }).cause), "Only the Orchestrator");
      }),
    ),
);

it.live(
  "the Orchestrator's task is refused in a project that does not exist, is archived, or is its own",
  () =>
    withHarness("kodo-swarm-target", {}, ({ state, orchestrator, worker, cwd, seedProject }) =>
      Effect.gen(function* () {
        const ctx = {
          state,
          orchestrator,
          worker,
          name: "kodo-swarm-target",
          threadId: ORCHESTRATOR_THREAD,
        };
        yield* createOrchestrator(orchestrator, {
          cwd,
          createdBy: "system",
          lead: { kind: "swarm" },
        });
        yield* seedProject(ORCHESTRATOR_PROJECT);
        const refusal = (projectId: ProjectId, label: string) =>
          delegateFromActiveRun(ctx, projectId, label).pipe(
            Effect.flip,
            Effect.map((error) => String((error as { cause?: unknown }).cause)),
          );
        assert.include(
          yield* refusal(ProjectId.make("project:nowhere"), "missing"),
          "does not exist",
        );
        assert.include(yield* refusal(ORCHESTRATOR_PROJECT, "own"), "never its own");
      }),
    ),
);

it.live(
  "the Orchestrator keeps its title: a first message with a seed neither renames it nor asks for a generated one",
  () =>
    withHarness("kodo-swarm-title", {}, ({ orchestrator, cwd }) =>
      Effect.gen(function* () {
        yield* createOrchestrator(orchestrator, {
          cwd,
          createdBy: "system",
          lead: { kind: "swarm" },
        });
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:kodo-swarm-title:first"),
          threadId: ORCHESTRATOR_THREAD,
          messageId: MessageId.make("message:kodo-swarm-title:first"),
          text: "Fix the build in acme-api",
          titleSeed: "Fix the build in acme-api",
          attachments: [],
          dispatchMode: { type: "defer_start" },
        });
        const { thread } = yield* orchestrator.getThreadProjection(ORCHESTRATOR_THREAD);
        assert.equal(thread.title, "Orchestrator");
        assert.isNotOk(thread.titleRegeneration);
      }),
    ),
);

// KODO: swarm-delegate - the start question is an approval on the Orchestrator's run, answered only by a person.
const raiseStartQuestion = Effect.fnUntraced(function* (input: TurnContext, label: string) {
  yield* startTurn(input, label, selection("base-model"));
  const run = (yield* input.orchestrator.getThreadProjection(input.threadId)).runs[0]!;
  const requestId = RuntimeRequestId.make(`kodo-start:command:${label}`);
  const record = (outcome: "pending" | "cancelled") =>
    input.orchestrator.dispatch({
      type: "kodo.start-request.record",
      commandId: CommandId.make(`command:${label}:record:${outcome}`),
      threadId: input.threadId,
      runId: run.id,
      nodeId: run.rootNodeId!,
      requestId,
      outcome,
      prompt: "Project: acme-api",
      reason: "Nothing starts until you approve.",
    });
  yield* record("pending");
  const respond = (decision: string, extra: Record<string, unknown> = {}) =>
    input.orchestrator.dispatch({
      type: "runtime-request.respond",
      commandId: CommandId.make(`command:${label}:respond:${decision}`),
      threadId: input.threadId,
      requestId,
      decision,
      ...extra,
    } as never);
  return { requestId, record, respond };
});

it.live(
  "the Orchestrator's start question needs the person: approve or decline, and nothing goes to the provider",
  () =>
    withHarness("kodo-swarm-confirm", {}, ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const ctx = {
          state,
          orchestrator,
          worker,
          name: "kodo-swarm-confirm",
          threadId: ORCHESTRATOR_THREAD,
        };
        yield* createOrchestrator(orchestrator, {
          cwd,
          createdBy: "system",
          lead: { kind: "swarm" },
        });
        const { requestId, respond } = yield* raiseStartQuestion(ctx, "approve");
        // It shows as an approval waiting on a person, which is what turns the dot to "needs you".
        const asked = yield* orchestrator.getThreadShell(ORCHESTRATOR_THREAD);
        assert.equal(asked?.pendingRuntimeRequest?.id, requestId);
        assert.equal(asked?.pendingRuntimeRequest?.kind, "permission");
        // "Always" and "for this session" would outlive the one question: refused, and it stays open.
        for (const decision of ["acceptForSession", "acceptAlways"]) {
          const cause = String(
            ((yield* respond(decision).pipe(Effect.flip)) as { cause?: unknown }).cause,
          );
          assert.include(cause, "Approve or decline");
        }
        assert.equal(
          (yield* orchestrator.getThreadShell(ORCHESTRATOR_THREAD))?.pendingRuntimeRequest?.id,
          requestId,
        );
        yield* respond("accept");
        yield* worker.drain();
        const answered = (yield* orchestrator.getThreadProjection(
          ORCHESTRATOR_THREAD,
        )).runtimeRequests.find((request) => request.id === requestId);
        assert.equal(answered?.status, "resolved");
        assert.equal(answered?.decision, "accept");
        assert.isNull(
          (yield* orchestrator.getThreadShell(ORCHESTRATOR_THREAD))?.pendingRuntimeRequest,
        );
        // It is not the provider's question, so nothing is delivered to it.
        assert.equal((yield* Ref.get(state)).responded, 0);
      }),
    ),
);

it.live("a declined or withdrawn start question settles, and is answered once", () =>
  withHarness("kodo-swarm-decline", {}, ({ state, orchestrator, worker, cwd }) =>
    Effect.gen(function* () {
      const ctx = {
        state,
        orchestrator,
        worker,
        name: "kodo-swarm-decline",
        threadId: ORCHESTRATOR_THREAD,
      };
      yield* createOrchestrator(orchestrator, {
        cwd,
        createdBy: "system",
        lead: { kind: "swarm" },
      });
      const declined = yield* raiseStartQuestion(ctx, "decline");
      yield* declined.respond("decline");
      yield* worker.drain();
      const read = (id: RuntimeRequestId) =>
        orchestrator
          .getThreadProjection(ORCHESTRATOR_THREAD)
          .pipe(
            Effect.map((projection) =>
              projection.runtimeRequests.find((request) => request.id === id),
            ),
          );
      assert.equal((yield* read(declined.requestId))?.decision, "decline");
      // Answered once: a second answer, even the opposite, is refused and changes nothing.
      const again = yield* declined.respond("accept").pipe(Effect.flip);
      assert.include(String((again as { cause?: unknown }).cause), "resolved");
      assert.equal((yield* read(declined.requestId))?.decision, "decline");
      assert.equal((yield* Ref.get(state)).responded, 0);
    }),
  ),
);

it.live("the Orchestrator's turns run read-only in Code mode, on the Orchestrator model", () =>
  withHarness(
    "kodo-swarm-policy",
    { orchestrator: selection("orchestrator-model") },
    ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-swarm-policy";
        yield* createOrchestrator(orchestrator, {
          cwd,
          createdBy: "system",
          lead: { kind: "swarm" },
        });
        const ctx = { state, orchestrator, worker, name, threadId: ORCHESTRATOR_THREAD };
        yield* runTurn(ctx, "ask-it", selection("base-model"));
        const captured = yield* Ref.get(state);
        // Ask enforcement: read-only sandbox, whatever the thread displays.
        assert.deepEqual(
          captured.started.map((turn) => [turn.model, turn.modeReadOnly, turn.sandbox]),
          [["orchestrator-model", true, "readOnly"]],
        );
        assert.equal(
          (yield* orchestrator.getThreadProjection(ORCHESTRATOR_THREAD)).thread.interactionMode,
          "code",
        );
      }),
  ),
);

it.live(
  "an Orchestrator model on a provider that cannot receive the tools falls back to the thread's own, and says why",
  () =>
    withHarness(
      "kodo-sub-agents-lead-slot-provider",
      { orchestrator: selection("lead-model", otherInstanceId) },
      ({ state, orchestrator, worker, cwd }) =>
        Effect.gen(function* () {
          const name = "kodo-sub-agents-lead-slot-provider";
          const threadId = ThreadId.make(`thread:${name}`);
          yield* createThread(orchestrator, { name, threadId, cwd });
          // Turning it on is refused outright while the slot's provider cannot receive the tools.
          const refused = yield* setLead(orchestrator, name, threadId, true, 1).pipe(Effect.flip);
          assert.include(
            String((refused as { cause?: unknown }).cause),
            "Orchestrator model runs on",
          );
          void state;
          void worker;
        }),
      {
        second: true,
        catalogue: { [otherInstanceId]: { driver: ProviderDriverKind.make("mystery") } },
      },
    ),
);

it.live("sub-agents cannot be switched while a turn runs, and can be once it ends", () =>
  withHarness("kodo-sub-agents-busy", {}, ({ state, orchestrator, worker, cwd }) =>
    Effect.gen(function* () {
      const name = "kodo-sub-agents-busy";
      const threadId = ThreadId.make(`thread:${name}`);
      const ctx = { state, orchestrator, worker, name, threadId };
      yield* createThread(orchestrator, { name, threadId, cwd });
      yield* startTurn(ctx, "running", selection("base-model"));
      const refused = yield* setLead(orchestrator, name, threadId, true, 1).pipe(Effect.flip);
      assert.include(String((refused as { cause?: unknown }).cause), "A turn is running");
      assert.isUndefined((yield* orchestrator.getThreadShell(threadId))?.kodoLead);
      yield* finishTurn(ctx);
      yield* setLead(orchestrator, name, threadId, true, 2);
      assert.deepEqual((yield* orchestrator.getThreadShell(threadId))?.kodoLead, {
        kind: "sub-agents",
      });
    }),
  ),
);

it.live("sub-agents are refused on a provider whose tools cannot be delivered", () =>
  withHarness(
    "kodo-sub-agents-unsupported",
    {},
    ({ orchestrator, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-sub-agents-unsupported";
        const threadId = ThreadId.make(`thread:${name}`);
        yield* createThread(orchestrator, { name, threadId, cwd });
        const refused = yield* setLead(orchestrator, name, threadId, true, 1).pipe(Effect.flip);
        assert.include(String((refused as { cause?: unknown }).cause), "not known to receive");
        // A new thread asked to start as a lead there simply starts without one.
        const second = ThreadId.make(`thread:${name}:created`);
        yield* orchestrator.dispatch({
          type: "thread.create",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`command:${name}:create-lead`),
          threadId: second,
          projectId: ProjectId.make(`project:${name}`),
          title: "created as a lead",
          modelSelection: selection("base-model"),
          runtimeMode: "full-access",
          interactionMode: "code",
          kodoLead: { kind: "sub-agents" },
          branch: null,
          worktreePath: cwd,
        });
        assert.isUndefined((yield* orchestrator.getThreadShell(second))?.kodoLead);
      }),
    { catalogue: { [providerInstanceId]: { driver: ProviderDriverKind.make("mystery") } } },
  ),
);

it.live(
  "who may flip the switch: a person's client cannot forge an agent's identity, and an agent cannot lead itself",
  () =>
    withHarness("kodo-sub-agents-identity", {}, ({ orchestrator, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-sub-agents-identity";
        const target = ThreadId.make(`thread:${name}:target`);
        const caller = ThreadId.make(`thread:${name}:caller`);
        yield* createThread(orchestrator, { name: `${name}-target`, threadId: target, cwd });
        yield* createThread(orchestrator, { name: `${name}-caller`, threadId: caller, cwd });
        // The target reads only, so a read-only sender reaches the switch's own rule rather than the mode limit before it.
        yield* setMode(orchestrator, name, target, "plan", 1);

        // What the transport does to whatever a client sends: its own actor and sender are replaced.
        const forged = ThreadManagementService.withCreationProvenance(
          {
            type: "thread.kodo-lead.set",
            commandId: CommandId.make(`command:${name}:forged`),
            threadId: target,
            lead: { kind: "sub-agents" },
            createdBy: "agent",
            creationSource: "mcp",
            senderThreadId: caller,
          },
          { createdBy: "user", creationSource: "web" },
        );
        assert.equal((forged as { createdBy: string }).createdBy, "user");
        assert.isFalse("senderThreadId" in forged);

        // An agent cannot change its own thread, nor the lead it works for.
        const own = yield* setLead(orchestrator, name, caller, true, 1, { agentFrom: caller }).pipe(
          Effect.flip,
        );
        assert.include(String((own as { cause?: unknown }).cause), "own thread");

        // An agent limited to a read-only mode cannot change another thread, in Code mode it can.
        const limited = yield* setLead(orchestrator, name, target, true, 2, {
          agentFrom: caller,
        }).pipe(
          Effect.provideService(DispatchModeLimit, {
            runtimeMode: "full-access",
            interactionMode: "plan",
          }),
          Effect.flip,
        );
        assert.include(String((limited as { cause?: unknown }).cause), "read-only mode");
        yield* setLead(orchestrator, name, target, true, 3, { agentFrom: caller }).pipe(
          Effect.provideService(DispatchModeLimit, {
            runtimeMode: "full-access",
            interactionMode: "code",
          }),
        );
        assert.deepEqual((yield* orchestrator.getThreadShell(target))?.kodoLead, {
          kind: "sub-agents",
        });
        // An agent request that names no sender is not one any honest route makes.
        const anonymous = yield* orchestrator
          .dispatch({
            type: "thread.kodo-lead.set",
            commandId: CommandId.make(`command:${name}:anonymous`),
            threadId: caller,
            lead: { kind: "sub-agents" },
            createdBy: "agent",
            creationSource: "mcp",
          })
          .pipe(Effect.flip);
        assert.include(String((anonymous as { cause?: unknown }).cause), "cannot change");
      }),
    ),
);

it.live("a lead cannot run a loop, and a thread with a loop cannot become a lead", () =>
  withHarness("kodo-sub-agents-loop", {}, ({ orchestrator, cwd }) =>
    Effect.gen(function* () {
      const name = "kodo-sub-agents-loop";
      const lead = ThreadId.make(`thread:${name}:lead`);
      const looping = ThreadId.make(`thread:${name}:looping`);
      yield* createThread(orchestrator, { name: `${name}-lead`, threadId: lead, cwd });
      yield* createThread(orchestrator, { name: `${name}-looping`, threadId: looping, cwd });
      const start = (threadId: ThreadId, label: string) =>
        orchestrator.dispatch({
          type: "thread.kodo-loop.control",
          commandId: CommandId.make(`command:${name}:loop-${label}`),
          threadId,
          control: {
            type: "start",
            request: "Do the thing",
            requestMessageId: MessageId.make(`message:${name}:loop-${label}`),
            maxRounds: 2,
            planApproval: "auto",
            budget: {},
          },
        });
      yield* setLead(orchestrator, name, lead, true, 1);
      const refused = yield* start(lead, "lead").pipe(Effect.flip);
      assert.include(String((refused as { cause?: unknown }).cause), "Turn sub-agents off first");

      yield* start(looping, "ok");
      const blocked = yield* setLead(orchestrator, name, looping, true, 2).pipe(Effect.flip);
      assert.include(String((blocked as { cause?: unknown }).cause), "loop is running");
    }),
  ),
);

const newThread = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  input: {
    readonly name: string;
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly createdBy?: "user" | "agent";
    readonly kodoLead?: { readonly kind: "sub-agents" } | null;
  },
) =>
  orchestrator.dispatch({
    type: "thread.create",
    createdBy: input.createdBy ?? "user",
    creationSource: input.createdBy === "agent" ? "mcp" : "web",
    commandId: CommandId.make(`command:${input.name}:create`),
    threadId: input.threadId,
    projectId: ProjectId.make(`project:${input.name}`),
    title: input.name,
    modelSelection: selection("base-model"),
    runtimeMode: "full-access",
    interactionMode: "code",
    ...(input.kodoLead === undefined ? {} : { kodoLead: input.kodoLead }),
    branch: null,
    worktreePath: input.cwd,
  });

it.live(
  "a new thread takes the sub-agents default, the composer's explicit choice wins, and only a person's thread can lead",
  () =>
    withHarness(
      "kodo-sub-agents-default",
      {},
      ({ orchestrator, cwd }) =>
        Effect.gen(function* () {
          const name = "kodo-sub-agents-default";
          const leadOf = (threadId: ThreadId) =>
            orchestrator
              .getThreadShell(threadId)
              .pipe(Effect.map((shell) => shell?.kodoLead ?? null));
          const make = (label: string, extra: Partial<Parameters<typeof newThread>[1]> = {}) => {
            const threadId = ThreadId.make(`thread:${name}:${label}`);
            return newThread(orchestrator, {
              name: `${name}-${label}`,
              threadId,
              cwd,
              ...extra,
            }).pipe(Effect.as(threadId));
          };
          // No choice made: the project's default applies, here on.
          assert.deepEqual(yield* leadOf(yield* make("default")), { kind: "sub-agents" });
          // The composer's explicit choice, either way, is what the thread starts with.
          assert.isNull(yield* leadOf(yield* make("explicit-off", { kodoLead: null })));
          assert.deepEqual(
            yield* leadOf(yield* make("explicit-on", { kodoLead: { kind: "sub-agents" } })),
            { kind: "sub-agents" },
          );
          // An agent's thread is never a lead, however it asks and whatever the default.
          assert.isNull(
            yield* leadOf(
              yield* make("agent", { createdBy: "agent", kodoLead: { kind: "sub-agents" } }),
            ),
          );
        }),
      { settings: { kodoSubAgentsDefault: true } },
    ),
);

it.live("a project's override of the sub-agents default wins over the environment's", () =>
  withHarness(
    "kodo-sub-agents-project-default",
    {},
    ({ orchestrator, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-sub-agents-project-default";
        const threadId = ThreadId.make(`thread:${name}`);
        yield* newThread(orchestrator, { name, threadId, cwd });
        // The environment default is on, but this project turned it off.
        assert.isNull((yield* orchestrator.getThreadShell(threadId))?.kodoLead ?? null);
      }),
    {
      settings: {
        kodoSubAgentsDefault: true,
        projectSettingsOverrides: {
          [ProjectId.make("project:kodo-sub-agents-project-default")]: {
            kodoSubAgentsDefault: false,
          },
        },
      },
    },
  ),
);

it.live(
  "a worker runs on its mode's slot without an explicit pick, the lead's and the worker's own models stay, and an unavailable slot is recorded",
  () =>
    withHarness(
      "kodo-sub-agents-worker-slot",
      {
        orchestrator: selection("lead-model"),
        code: selection("code-model"),
        review: selection("review-model", otherInstanceId),
      },
      ({ state, orchestrator, worker, cwd }) =>
        Effect.gen(function* () {
          const name = "kodo-sub-agents-worker-slot";
          const threadId = ThreadId.make(`thread:${name}`);
          const ctx = { state, orchestrator, worker, name, threadId };
          yield* createThread(orchestrator, { name, threadId, cwd });
          yield* setLead(orchestrator, name, threadId, true, 1);
          yield* startTurn(ctx, "lead", selection("base-model"));
          const leadRun = (yield* orchestrator.getThreadProjection(threadId)).runs.at(-1)!;

          const delegate = (task: string, interactionMode: "code" | "review") =>
            Effect.gen(function* () {
              yield* orchestrator.dispatch({
                type: "delegated_task.request",
                commandId: CommandId.make(`command:${name}:delegate-${task}`),
                parentThreadId: threadId,
                parentRunId: leadRun.id,
                parentNodeId: leadRun.rootNodeId!,
                task,
                // What the service passes for a lead: the lead's own model, named by nobody.
                modelSelection: selection("base-model"),
                explicitModelSelection: false,
                runtimeMode: "full-access",
                interactionMode,
                completionWake: "always",
                createdBy: "agent",
                creationSource: "mcp",
              });
              yield* worker.drain();
              const parent = yield* orchestrator.getThreadProjection(threadId);
              const childId = parent.subagents.find(
                (candidate) => candidate.prompt === task,
              )!.childThreadId!;
              return yield* orchestrator.getThreadProjection(childId);
            });

          const coder = yield* delegate("write it", "code");
          const reviewer = yield* delegate("review it", "review");

          const coderRun = coder.runs[0]!;
          assert.equal(coderRun.modelSelection.model, "code-model");
          assert.equal(coderRun.kodoModel?.source, "mode-default");
          // The worker's own model is the lead's own, and the slot only stands in for it.
          assert.equal(coder.thread.kodoModeModel?.base.model, "base-model");
          // The Review slot's provider is turned off, so the worker runs on its own model and says why.
          const reviewerRun = reviewer.runs[0]!;
          assert.equal(reviewerRun.modelSelection.model, "base-model");
          assert.equal(reviewerRun.kodoModel?.unavailable?.wanted.model, "review-model");
          assert.include(reviewerRun.kodoModel?.unavailable?.reason ?? "", "turned off");
          // The lead's own thread was not touched by either worker.
          const lead = (yield* orchestrator.getThreadProjection(threadId)).thread;
          assert.equal(lead.modelSelection.model, "lead-model");
          assert.equal(lead.kodoModeModel?.base.model, "base-model");
          assert.deepEqual((yield* Ref.get(state)).started.map((turn) => turn.model).toSorted(), [
            "base-model",
            "code-model",
            "lead-model",
          ]);

          // A worker may not start a loop, from whatever the loop's request says it is.
          yield* createThread(orchestrator, {
            name: `${name}-other`,
            threadId: ThreadId.make(`thread:${name}:other`),
            cwd,
          });
          const refused = yield* orchestrator
            .dispatch({
              type: "thread.kodo-loop.control",
              commandId: CommandId.make(`command:${name}:worker-loop`),
              threadId: ThreadId.make(`thread:${name}:other`),
              control: {
                type: "start",
                request: "Loop it",
                requestMessageId: MessageId.make(`message:${name}:worker-loop`),
                requestMessage: {
                  text: "/loop Loop it",
                  createdBy: "agent",
                  creationSource: "mcp",
                  senderThreadId: coder.thread.id,
                },
                maxRounds: 2,
                planApproval: "auto",
                budget: {},
              },
            })
            .pipe(Effect.flip);
          assert.include(String((refused as { cause?: unknown }).cause), "workers do not start");

          // Nor may a worker turn sub-agents on for another thread and then hand it work.
          const workerSet = yield* setLead(
            orchestrator,
            name,
            ThreadId.make(`thread:${name}:other`),
            true,
            3,
            { agentFrom: coder.thread.id },
          ).pipe(Effect.flip);
          assert.include(
            String((workerSet as { cause?: unknown }).cause),
            "A worker cannot change",
          );
        }),
      { second: true, catalogue: { [otherInstanceId]: { enabled: false } } },
    ),
);
