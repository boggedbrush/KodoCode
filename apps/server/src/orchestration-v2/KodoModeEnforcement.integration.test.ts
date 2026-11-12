// KODO: mode-session-policy, mode-steer-guard - a message composed or queued in a read-only mode
// never runs on a session or inside a turn that has Code's write access.
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  type RunId,
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
const modelSelection = {
  instanceId: providerInstanceId,
  model: "mode-model",
} satisfies ModelSelection;
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
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" } as const),
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
          ),
        ),
      );
    }),
  );

const createThread = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  input: {
    readonly name: string;
    readonly threadId: ThreadId;
    readonly cwd: string;
    readonly mode: "ask" | "code";
  },
) =>
  orchestrator.dispatch({
    type: "thread.create",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make(`command:${input.name}:create`),
    threadId: input.threadId,
    projectId: ProjectId.make(`project:${input.name}`),
    title: input.name,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: input.mode,
    branch: null,
    worktreePath: input.cwd,
  });

const send = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  input: {
    readonly name: string;
    readonly threadId: ThreadId;
    readonly label: string;
    readonly dispatchMode: Extract<
      OrchestrationV2Command,
      { type: "message.dispatch" }
    >["dispatchMode"];
  },
) =>
  orchestrator.dispatch({
    type: "message.dispatch",
    createdBy: "user",
    creationSource: "web",
    commandId: CommandId.make(`command:${input.name}:${input.label}`),
    threadId: input.threadId,
    messageId: MessageId.make(`message:${input.name}:${input.label}`),
    text: input.label,
    attachments: [],
    modelSelection,
    dispatchMode: input.dispatchMode,
  });

const setMode = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  name: string,
  threadId: ThreadId,
  label: string,
  interactionMode: "ask" | "code" | "review",
) =>
  orchestrator.dispatch({
    type: "thread.interaction-mode.set",
    commandId: CommandId.make(`command:${name}:mode-${label}`),
    threadId,
    interactionMode,
  });

/** Forks a waiter for the next `count` provider turns to start running. */
const turnsRunning = (orchestrator: Orchestrator.OrchestratorV2["Service"], count: number) =>
  orchestrator.streamDomainEvents.pipe(
    Stream.filter(
      (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
    ),
    Stream.take(count),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  );

const finishActiveTurn = Effect.fnUntraced(function* (state: Ref.Ref<AdapterState>) {
  const active = (yield* Ref.get(state)).finishActive;
  if (active === null) return yield* Effect.die("no active turn to finish");
  yield* active;
});

it.live(
  "reopens the session of a mode switched during a run before the queued Ask run starts",
  () =>
    withHarness("kodo-mode-session-restart", ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-session-restart";
        const threadId = ThreadId.make(`thread:${name}`);
        yield* createThread(orchestrator, { name, threadId, cwd, mode: "code" });
        const running = yield* turnsRunning(orchestrator, 2);
        yield* send(orchestrator, {
          name,
          threadId,
          label: "first",
          dispatchMode: { type: "start_immediately" },
        });
        yield* worker.drain();

        // The mode applies next turn: the running Code turn is not touched, and its session stays.
        yield* setMode(orchestrator, name, threadId, "ask", "ask");
        yield* send(orchestrator, {
          name,
          threadId,
          label: "second",
          dispatchMode: { type: "queue_after_active" },
        });
        assert.equal((yield* Ref.get(state)).opened.length, 1);
        assert.equal((yield* Ref.get(state)).closed, 0);

        yield* finishActiveTurn(state);
        yield* Fiber.join(running);
        yield* worker.drain();

        const captured = yield* Ref.get(state);
        // The Ask run must not get the session opened under Code's policy.
        assert.deepEqual(
          captured.opened.map((session) => session.modeReadOnly),
          [false, true],
        );
        assert.equal(captured.opened[1]?.runtimeMode, "approval-required");
        assert.equal(captured.closed, 1);
        assert.deepEqual(
          captured.started.map((turn) => [turn.session, turn.modeReadOnly]),
          [
            [1, false],
            [2, true],
          ],
        );
      }),
    ),
);

it.live(
  "reopens the session in the other direction, and keeps it when the policy did not change",
  () =>
    withHarness("kodo-mode-session-reverse", ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-session-reverse";
        const threadId = ThreadId.make(`thread:${name}`);
        yield* createThread(orchestrator, { name, threadId, cwd, mode: "ask" });
        const first = yield* turnsRunning(orchestrator, 1);
        yield* send(orchestrator, {
          name,
          threadId,
          label: "first",
          dispatchMode: { type: "start_immediately" },
        });
        yield* Fiber.join(first);
        // Queued in Ask, then the thread moves to Code: the queued run stays Ask.
        yield* send(orchestrator, {
          name,
          threadId,
          label: "second",
          dispatchMode: { type: "queue_after_active" },
        });
        yield* setMode(orchestrator, name, threadId, "code", "code");
        yield* send(orchestrator, {
          name,
          threadId,
          label: "third",
          dispatchMode: { type: "queue_after_active" },
        });

        const second = yield* turnsRunning(orchestrator, 1);
        yield* finishActiveTurn(state);
        yield* Fiber.join(second);
        yield* worker.drain();
        // The queued Ask run reuses the Ask session: nothing changed for it.
        assert.deepEqual(
          (yield* Ref.get(state)).opened.map((session) => session.modeReadOnly),
          [true],
        );
        const third = yield* turnsRunning(orchestrator, 1);
        yield* finishActiveTurn(state);
        yield* Fiber.join(third);
        yield* worker.drain();

        const captured = yield* Ref.get(state);
        // The Code run must not run on the read-only session either.
        assert.deepEqual(
          captured.opened.map((session) => session.modeReadOnly),
          [true, false],
        );
        assert.deepEqual(
          captured.started.map((turn) => [turn.session, turn.modeReadOnly]),
          [
            [1, true],
            [1, true],
            [2, false],
          ],
        );
      }),
    ),
);

const runOfMessage = (
  projection: Effect.Success<
    ReturnType<Orchestrator.OrchestratorV2["Service"]["getThreadProjection"]>
  >,
  label: string,
  name: string,
) =>
  projection.runs.find((run) => run.userMessageId === MessageId.make(`message:${name}:${label}`));

it.live(
  "queues a message sent after the thread moved to a read-only mode instead of steering a Code turn",
  () =>
    withHarness("kodo-mode-steer-guard", ({ state, orchestrator, worker, cwd }) =>
      Effect.gen(function* () {
        const name = "kodo-mode-steer-guard";
        const threadId = ThreadId.make(`thread:${name}`);
        yield* createThread(orchestrator, { name, threadId, cwd, mode: "code" });
        const running = yield* turnsRunning(orchestrator, 1);
        yield* send(orchestrator, {
          name,
          threadId,
          label: "first",
          dispatchMode: { type: "start_immediately" },
        });
        yield* Fiber.join(running);
        yield* worker.drain();
        const activeRunId: RunId = (yield* orchestrator.getThreadProjection(threadId)).runs[0]!.id;

        // Same mode: the steer joins the running turn.
        yield* send(orchestrator, {
          name,
          threadId,
          label: "steer-in-code",
          dispatchMode: { type: "steer_active", targetRunId: activeRunId },
        });
        yield* worker.drain();
        assert.equal((yield* Ref.get(state)).steered, 1);

        // The thread moves to Review. Any client (mobile, MCP, a second tab) may still ask for a steer.
        yield* setMode(orchestrator, name, threadId, "review", "review");
        yield* send(orchestrator, {
          name,
          threadId,
          label: "steer-in-review",
          dispatchMode: { type: "steer_active", targetRunId: activeRunId },
        });
        yield* worker.drain();

        assert.equal(
          (yield* Ref.get(state)).steered,
          1,
          "the Review message must not enter the Code turn",
        );
        const projection = yield* orchestrator.getThreadProjection(threadId);
        const queued = runOfMessage(projection, "steer-in-review", name);
        assert.isDefined(queued);
        assert.notEqual(queued!.id, activeRunId);
        assert.equal(queued!.status, "queued");
        assert.equal(queued!.interactionMode, "review");
      }),
    ),
);
