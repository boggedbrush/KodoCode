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
  readonly modeReadOnly: boolean;
  readonly runtimeMode: string;
}
interface StartedTurn {
  readonly session: number;
  readonly modeReadOnly: boolean;
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
): ProviderAdapter.ProviderAdapterV2["Service"] => ({
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
                  session: sessionIndex,
                  modeReadOnly: input.runtimePolicy.modeReadOnly === true,
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
});

const freshState = Ref.make<AdapterState>({
  opened: [],
  started: [],
  steered: 0,
  closed: 0,
  finishActive: null,
});

/** Runs `body` against a fresh orchestrator whose only provider is the fake Grok adapter. */
const withHarness = <A, E>(
  name: string,
  modeModelSelections: Partial<Record<"ask", ModelSelection>>,
  body: (input: {
    readonly state: Ref.Ref<AdapterState>;
    readonly orchestrator: Orchestrator.OrchestratorV2["Service"];
    readonly worker: EffectWorker.OrchestrationEffectWorkerV2["Service"];
    readonly cwd: string;
  }) => Effect.Effect<
    A,
    E,
    Orchestrator.OrchestratorV2 | EffectWorker.OrchestrationEffectWorkerV2 | Scope.Scope
  >,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace(name);
      const state = yield* freshState;
      return yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        return yield* body({ state, orchestrator, worker, cwd });
      }).pipe(
        Effect.provide(
          ProviderReplayHarness.layerWithRegistry(
            { name, driver },
            ProviderAdapterRegistry.layerSingle(makeAdapter(state)),
            { serverSettings: { modeModelSelections } },
          ),
        ),
      );
    }),
  );

const selection = (model: string): ModelSelection => ({ instanceId: providerInstanceId, model });

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

/** Sends one message the way a client does (carrying the composer's model), runs it to completion. */
const runTurn = Effect.fnUntraced(function* (
  input: {
    readonly state: Ref.Ref<AdapterState>;
    readonly orchestrator: Orchestrator.OrchestratorV2["Service"];
    readonly worker: EffectWorker.OrchestrationEffectWorkerV2["Service"];
    readonly name: string;
    readonly threadId: ThreadId;
  },
  label: string,
  carried: ModelSelection,
  explicit?: boolean,
) {
  const running = yield* input.orchestrator.streamDomainEvents.pipe(
    Stream.filter(
      (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
    ),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  );
  yield* input.orchestrator.dispatch({
    type: "message.dispatch",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make(`command:${input.name}:${label}`),
    threadId: input.threadId,
    messageId: MessageId.make(`message:${input.name}:${label}`),
    text: label,
    attachments: [],
    modelSelection: carried,
    ...(explicit === undefined ? {} : { explicitModelSelection: explicit }),
    dispatchMode: { type: "start_immediately" },
  });
  yield* Fiber.join(running);
  yield* input.worker.drain();
  const finish = (yield* Ref.get(input.state)).finishActive;
  if (finish === null) return yield* Effect.die("no active turn to finish");
  yield* finish;
  yield* input.worker.drain();
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

it.live("an explicit pick in a mode with a default wins, and becomes the thread's own model", () =>
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
        // The same carried model without the flag is not a pick: the default returns.
        yield* runTurn(ctx, "carried", selection("picked-model"), false);
        assert.deepEqual(
          (yield* Ref.get(state)).started.map((turn) => turn.model),
          ["picked-model", "ask-model"],
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
