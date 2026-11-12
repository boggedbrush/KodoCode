// KODO: mode-models-turn - a turn runs on the model of the mode it is created in; modes without a
// default keep the thread's own model, and a default that cannot run never fails the turn.
import { assert, it } from "@effect/vitest";
import {
  CommandId,
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
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
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
          respondToRuntimeRequest: () => Effect.void,
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
  finishActive: null,
});

interface Harness {
  readonly state: Ref.Ref<AdapterState>;
  readonly orchestrator: Orchestrator.OrchestratorV2["Service"];
  readonly worker: EffectWorker.OrchestrationEffectWorkerV2["Service"];
  readonly cwd: string;
  /** What the provider catalogue reports per instance; change it mid-test to take a provider away. */
  readonly catalogue: Ref.Ref<Readonly<Record<string, Partial<ServerProvider>>>>;
}

/**
 * Runs `body` against a fresh orchestrator whose providers are the fake Grok adapter and, with
 * `second`, a fake Codex one.
 */
const withHarness = <A, E>(
  name: string,
  modeModelSelections: Partial<Record<"ask" | "plan" | "code", ModelSelection>>,
  body: (
    input: Harness,
  ) => Effect.Effect<
    A,
    E,
    Orchestrator.OrchestratorV2 | EffectWorker.OrchestrationEffectWorkerV2 | Scope.Scope
  >,
  options: { readonly second?: boolean } = {},
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace(name);
      const state = yield* freshState;
      const catalogue = yield* Ref.make<Readonly<Record<string, Partial<ServerProvider>>>>({});
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
        return yield* body({ state, orchestrator, worker, cwd, catalogue });
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
            { serverSettings: { modeModelSelections }, providerCatalogue: catalogue },
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
