// KODO: loop-worker - the plan, code, review, judge loop end to end on the real orchestrator, with a
// scripted provider: each started turn answers with the next scripted reply. Nothing waits on a timer;
// every step reads state, acts once, and the test finishes the provider's turn itself.
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_KODO_LOOP_SETTINGS,
  EventId,
  MessageId,
  type KodoLoop,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  ProjectId,
  type ProviderDriverKind as ProviderDriverKindType,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
} from "@t3tools/contracts";
import { kodoThreadOwnModel } from "@t3tools/shared/kodoModeModel";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { userFacingDispatchErrorMessage } from "./UserFacingErrors.ts";
import { makeKodoLoopService } from "../kodo/loop/LoopService.ts";
import { makeKodoLoopStepper, type LoopStepResult } from "../kodo/loop/LoopStepper.ts";
import {
  completeVerdict,
  incompleteVerdict,
  passReview,
  reviewBlock,
  verdictBlock,
} from "../kodo/loop/testing.ts";

// Grok fixes its runtime mode when its process launches, so its session cannot take a new policy.
const driver: ProviderDriverKindType = ProviderDriverKind.make("grok");
const providerInstanceId = ProviderInstanceId.make("grok-loop-test");
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

interface StartedTurn {
  readonly modeReadOnly: boolean;
  readonly runtimeMode: string;
  readonly model: string;
}
interface AdapterState {
  readonly started: ReadonlyArray<StartedTurn>;
  readonly replies: ReadonlyArray<string>;
  readonly finishActive: Effect.Effect<void> | null;
  readonly interruptActive: Effect.Effect<void>;
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
            const turn = {
              id: providerTurnId,
              providerThreadId: input.providerThread.id,
              nodeId: input.rootNodeId,
              runAttemptId: input.attemptId,
              nativeTurnRef: { driver, nativeId: `native:${providerTurnId}`, strength: "strong" },
              ordinal: input.providerTurnOrdinal,
            } as const;
            const startedAt = yield* DateTime.now;
            const reply = yield* Ref.modify(state, (current) => [
              current.replies[0] ?? "(no scripted reply)",
              { ...current, replies: current.replies.slice(1) },
            ]);
            const terminal = (status: "completed" | "interrupted") =>
              Effect.gen(function* () {
                const completedAt = yield* DateTime.now;
                if (status === "completed") {
                  yield* Queue.offer(events, {
                    type: "message.updated",
                    driver,
                    message: {
                      id: MessageId.make(`reply:${input.attemptId}`),
                      threadId: input.threadId,
                      runId: input.runId,
                      nodeId: input.rootNodeId,
                      role: "assistant",
                      text: reply,
                      attachments: [],
                      streaming: false,
                      createdBy: "agent",
                      creationSource: "provider",
                      createdAt: completedAt,
                      updatedAt: completedAt,
                    },
                  });
                }
                yield* Queue.offer(events, {
                  type: "provider_turn.updated",
                  driver,
                  providerTurn: { ...turn, status, startedAt, completedAt },
                });
                yield* Queue.offer(events, {
                  type: "turn.terminal",
                  driver,
                  providerThreadId: input.providerThread.id,
                  providerTurnId,
                  runOrdinal: input.runOrdinal,
                  status,
                  failure: null,
                  threadDisposition: "reusable",
                });
                yield* Ref.update(state, (current) => ({ ...current, finishActive: null }));
              });
            yield* Ref.update(state, (current) => ({
              ...current,
              finishActive: terminal("completed"),
              interruptActive: terminal("interrupted"),
              started: [
                ...current.started,
                {
                  modeReadOnly: input.runtimePolicy.modeReadOnly === true,
                  runtimeMode: input.runtimePolicy.runtimeMode,
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
        steerTurn: () => Effect.void,
        interruptTurn: () =>
          Ref.get(state).pipe(Effect.flatMap((current) => current.interruptActive)),
        respondToRuntimeRequest: () => Effect.void,
        readThreadSnapshot: () => Effect.die("unused readThreadSnapshot"),
        rollbackThread: () => Effect.die("unused rollbackThread"),
        forkThread: () => Effect.die("unused forkThread"),
      };
    }),
});

const selection = (model: string): ModelSelection => ({ instanceId: providerInstanceId, model });

interface Ctx {
  readonly state: Ref.Ref<AdapterState>;
  readonly orchestrator: Orchestrator.OrchestratorV2["Service"];
  readonly worker: EffectWorker.OrchestrationEffectWorkerV2["Service"];
  readonly sink: EventSink.EventSinkV2["Service"];
  readonly threadId: ThreadId;
  readonly name: string;
  readonly cwd: string;
  readonly service: ReturnType<typeof makeKodoLoopService>;
  /** A fresh stepper, as a restarted server would build. */
  readonly newStepper: () => Effect.Effect<{
    readonly step: (threadId: ThreadId) => Effect.Effect<LoopStepResult>;
  }>;
}

const withLoopHarness = <A, E>(
  name: string,
  options: {
    readonly modeModels?: Partial<Record<"plan" | "code" | "review" | "judge", ModelSelection>>;
    readonly startMode?: "ask" | "code" | "plan";
    readonly replies: ReadonlyArray<string>;
  },
  body: (
    ctx: Ctx,
  ) => Effect.Effect<
    A,
    E,
    | Orchestrator.OrchestratorV2
    | EffectWorker.OrchestrationEffectWorkerV2
    | EventSink.EventSinkV2
    | Scope.Scope
  >,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace(name);
      const state = yield* Ref.make<AdapterState>({
        started: [],
        replies: options.replies,
        finishActive: null,
        interruptActive: Effect.void,
      });
      return yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const sink = yield* EventSink.EventSinkV2;
        const threadId = ThreadId.make(`thread:${name}`);
        yield* orchestrator.dispatch({
          type: "thread.create",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make(`command:${name}:create`),
          threadId,
          projectId: ProjectId.make(`project:${name}`),
          title: name,
          modelSelection: selection("base-model"),
          runtimeMode: "full-access",
          interactionMode: options.startMode ?? "ask",
          branch: null,
          worktreePath: cwd,
        });
        const service = makeKodoLoopService({
          orchestrator,
          serverSettings: { getSettings: Effect.succeed({ loop: DEFAULT_KODO_LOOP_SETTINGS }) },
        });
        const newStepper = () =>
          makeKodoLoopStepper({
            orchestrator,
            dispatch: orchestrator.dispatch,
            readDiff: () =>
              Effect.succeed({ kind: "unavailable", reason: "no checkpoints in this test" }),
          });
        return yield* body({
          state,
          orchestrator,
          worker,
          sink,
          threadId,
          name,
          cwd,
          service,
          newStepper,
        });
      }).pipe(
        Effect.provide(
          ProviderReplayHarness.layerWithRegistry(
            { name, driver },
            ProviderAdapterRegistry.layerFromAdapters([makeAdapter(state)]),
            { serverSettings: { modeModelSelections: options.modeModels ?? {} } },
          ),
        ),
      );
    }),
  );

const loopOf = (ctx: Ctx) =>
  ctx.orchestrator
    .getThreadProjection(ctx.threadId)
    .pipe(Effect.map(({ thread }) => thread.kodoLoop));

const requireLoop = (ctx: Ctx) =>
  Effect.gen(function* () {
    const loop = yield* loopOf(ctx);
    if (loop === undefined) return yield* Effect.die("the thread has no loop");
    return loop;
  });

/** Starts a loop the way a `/loop` message does. */
const startLoop = (ctx: Ctx, request: string, rounds?: number, attempt = "loop-start") =>
  ctx.service.start({
    threadId: ctx.threadId,
    commandId: CommandId.make(`command:${ctx.name}:${attempt}`),
    requestMessageId: MessageId.make(`message:${ctx.name}:${attempt}`),
    request,
    maxRounds: rounds,
  });

/** Steps until the loop has nothing more to do right now; every step that acts is followed by a drain. */
const settle = (
  ctx: Ctx,
  stepper: { readonly step: (id: ThreadId) => Effect.Effect<LoopStepResult> },
) =>
  Effect.gen(function* () {
    for (let index = 0; index < 20; index += 1) {
      const result = yield* stepper.step(ctx.threadId);
      yield* ctx.worker.drain();
      if (result !== "acted") return result;
    }
    return yield* Effect.die("the loop kept acting");
  });

/** Waits for the provider to be running the next turn, when the last settle started one. */
const watchTurnStart = (ctx: Ctx) =>
  ctx.orchestrator.streamDomainEvents.pipe(
    Stream.filter(
      (event) => event.type === "provider-turn.updated" && event.payload.status === "running",
    ),
    Stream.take(1),
    Stream.runDrain,
    Effect.forkScoped({ startImmediately: true }),
  );

/** Finishes the turn the provider is running (or interrupts it) and waits for its run to end. */
const endTurn = (ctx: Ctx, how: "completed" | "interrupted" = "completed") =>
  Effect.gen(function* () {
    const current = yield* Ref.get(ctx.state);
    const finish = how === "completed" ? current.finishActive : current.interruptActive;
    if (finish === null) return yield* Effect.die("no active turn");
    const ended = yield* ctx.orchestrator.streamDomainEvents.pipe(
      Stream.filter((event) => event.type === "run.updated" && event.payload.status === how),
      Stream.take(1),
      Stream.runDrain,
      Effect.forkScoped({ startImmediately: true }),
    );
    yield* finish;
    yield* Fiber.join(ended);
    yield* ctx.worker.drain();
  });

/** Settles, then lets the provider answer the stage that started, until the loop ends. */
const runToEnd = (
  ctx: Ctx,
  stepper: { readonly step: (id: ThreadId) => Effect.Effect<LoopStepResult> },
) =>
  Effect.gen(function* () {
    for (let stage = 0; stage < 40; stage += 1) {
      const before = (yield* Ref.get(ctx.state)).started.length;
      const started = yield* watchTurnStart(ctx);
      const result = yield* settle(ctx, stepper);
      if ((yield* Ref.get(ctx.state)).started.length > before) yield* Fiber.join(started);
      else yield* Fiber.interrupt(started);
      if ((yield* Ref.get(ctx.state)).finishActive === null) return result;
      yield* ctx.worker.drain();
      yield* endTurn(ctx);
    }
    return yield* Effect.die("the loop never ended");
  });

const projectionOf = (ctx: Ctx) => ctx.orchestrator.getThreadProjection(ctx.threadId);

const stageText = (
  messages: ReadonlyArray<{ readonly id: string; readonly text: string }>,
  id: string,
) => messages.find((message) => message.id === id)?.text ?? "";

const REPLIES = {
  plan: "## Plan\n1. Make the change.",
  code: "Changed the parser. Checks pass.",
  review: reviewBlock(passReview),
  complete: verdictBlock(completeVerdict),
  incomplete: verdictBlock(incompleteVerdict),
};

it.live("a full round runs plan, code, review and judge, each in its own mode, and ends done", () =>
  withLoopHarness(
    "kodo-loop-full-round",
    { startMode: "ask", replies: [REPLIES.plan, REPLIES.code, REPLIES.review, REPLIES.complete] },
    (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Make the parser stricter.", 2);
        const stepper = yield* ctx.newStepper();
        yield* runToEnd(ctx, stepper);

        const loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "done");
        assert.equal(loop.stopReason, "complete");
        assert.deepEqual(
          loop.stages.map((record) => [record.round, record.stage, record.status]),
          [
            [1, "plan", "completed"],
            [1, "code", "completed"],
            [1, "review", "completed"],
            [1, "judge", "completed"],
          ],
        );
        const projection = yield* projectionOf(ctx);
        const stageRuns = projection.runs.toSorted((a, b) => a.ordinal - b.ordinal);
        assert.deepEqual(
          stageRuns.map((run) => run.interactionMode),
          ["plan", "code", "review", "review"],
          "each stage run recorded the mode it ran in",
        );
        assert.isTrue(stageRuns.every((run) => run.freshContext === true));
        const started = (yield* Ref.get(ctx.state)).started;
        assert.deepEqual(
          started.map((turn) => turn.modeReadOnly),
          [true, false, true, true],
          "plan, review and judge run read-only; code writes",
        );
        assert.equal(
          started[1]?.runtimeMode,
          "full-access",
          "code runs under the thread's runtime mode",
        );
        assert.notEqual(started[0]?.runtimeMode, "full-access", "read-only stages do not write");
        // The start mode comes back once the loop is over and nothing runs.
        assert.equal(projection.thread.interactionMode, "ask");
        // The judge was told what the others produced, not the transcript.
        const judgeText = stageText(projection.messages, "kodo-loop-" + loop.loopId + "-r1-judge");
        assert.include(judgeText, "Make the parser stricter.");
        assert.include(judgeText, "Make the change.");
        assert.include(judgeText, "No diff is available");
      }),
  ),
);

it.live("not complete at the round cap ends round_cap", () =>
  withLoopHarness(
    "kodo-loop-round-cap",
    { replies: [REPLIES.plan, REPLIES.code, REPLIES.review, REPLIES.incomplete] },
    (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 1);
        yield* runToEnd(ctx, yield* ctx.newStepper());
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "stopped");
        assert.equal(loop.stopReason, "round_cap");
        assert.equal((yield* projectionOf(ctx)).runs.length, 4);
      }),
  ),
);

it.live("not complete below the cap starts round 2 seeded with the outstanding items", () =>
  withLoopHarness(
    "kodo-loop-round-two",
    {
      replies: [
        REPLIES.plan,
        REPLIES.code,
        REPLIES.review,
        REPLIES.incomplete,
        "## Plan\n1. Add the test.",
        "Added the test.",
        REPLIES.review,
        REPLIES.complete,
      ],
    },
    (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 3);
        const stepper = yield* ctx.newStepper();
        // Up to the second plan stage starting.
        for (let turn = 0; turn < 4; turn += 1) {
          yield* settle(ctx, stepper);
          yield* endTurn(ctx);
        }
        yield* settle(ctx, stepper);
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.round, 2);
        assert.equal(loop.stage, "plan");
        const { messages } = yield* projectionOf(ctx);
        const roundTwoPlan = stageText(messages, `kodo-loop-${loop.loopId}-r2-plan`);
        assert.include(roundTwoPlan, incompleteVerdict.outstanding[0]!.title);
        assert.include(roundTwoPlan, "round 2 of 3");
        yield* endTurn(ctx);
        yield* runToEnd(ctx, stepper);
        assert.equal((yield* requireLoop(ctx)).status, "done");
      }),
  ),
);

it.live("an unreadable verdict stops the loop and dispatches nothing further", () =>
  withLoopHarness(
    "kodo-loop-bad-verdict",
    {
      replies: [
        REPLIES.plan,
        REPLIES.code,
        REPLIES.review,
        "I think it is finished.",
        REPLIES.complete,
      ],
    },
    (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 3);
        const stepper = yield* ctx.newStepper();
        yield* runToEnd(ctx, stepper);
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "failed");
        assert.equal(loop.stopReason, "verdict_invalid");
        const runsAfterStop = (yield* projectionOf(ctx)).runs.length;
        for (let index = 0; index < 3; index += 1) yield* settle(ctx, stepper);
        assert.equal((yield* projectionOf(ctx)).runs.length, runsAfterStop);
        assert.equal((yield* Ref.get(ctx.state)).replies.length, 1, "no further turn was started");

        // Retrying the judge is a person's action, and runs it again as a new attempt.
        yield* ctx.service.retryJudge({
          threadId: ctx.threadId,
          commandId: CommandId.make("command:kodo-loop-bad-verdict:retry"),
        });
        yield* runToEnd(ctx, stepper);
        assert.equal((yield* requireLoop(ctx)).status, "done");
        assert.equal((yield* projectionOf(ctx)).runs.length, runsAfterStop + 1);
      }),
  ),
);

it.live("/loop stop interrupts the active stage run, and no later stage starts", () =>
  withLoopHarness(
    "kodo-loop-stop",
    { startMode: "code", replies: [REPLIES.plan, REPLIES.code] },
    (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 3);
        const stepper = yield* ctx.newStepper();
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        assert.equal((yield* projectionOf(ctx)).runs[0]?.status, "running");

        const stop = ctx.service.intercept({
          type: "message.dispatch",
          commandId: CommandId.make("command:kodo-loop-stop:stop"),
          threadId: ctx.threadId,
          messageId: MessageId.make("message:kodo-loop-stop:stop"),
          text: "/loop stop",
          attachments: [],
          dispatchMode: {
            type: "steer_active",
            targetRunId: (yield* projectionOf(ctx)).runs[0]!.id,
          },
          createdBy: "user",
          creationSource: "web",
        } as OrchestrationV2Command);
        assert.isDefined(stop);
        yield* stop!;
        assert.equal((yield* requireLoop(ctx)).stopReason, "user_stop");

        const ended = yield* ctx.orchestrator.streamDomainEvents.pipe(
          Stream.filter(
            (event) => event.type === "run.updated" && event.payload.status === "interrupted",
          ),
          Stream.take(1),
          Stream.runDrain,
          Effect.forkScoped({ startImmediately: true }),
        );
        assert.equal(
          yield* stepper.step(ctx.threadId),
          "acted",
          "the stop interrupts the stage run",
        );
        yield* Fiber.join(ended);
        yield* ctx.worker.drain();
        for (let index = 0; index < 3; index += 1) yield* settle(ctx, stepper);

        const projection = yield* projectionOf(ctx);
        assert.equal(projection.runs.length, 1, "no later stage started");
        assert.equal(projection.runs[0]?.status, "interrupted");
        assert.equal((yield* Ref.get(ctx.state)).started.length, 1);
        assert.equal(projection.thread.interactionMode, "code", "the start mode is back");
      }),
  ),
);

it.live("a person's message mid-loop stops it, and the message still runs", () =>
  withLoopHarness(
    "kodo-loop-user-message",
    { startMode: "code", replies: [REPLIES.plan, "Hello back."] },
    (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 3);
        const stepper = yield* ctx.newStepper();
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);

        yield* ctx.orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:kodo-loop-user-message:hello"),
          threadId: ctx.threadId,
          messageId: MessageId.make("message:kodo-loop-user-message:hello"),
          text: "hello",
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
        });
        yield* settle(ctx, stepper);
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "stopped");
        assert.equal(loop.stopReason, "user_message");

        // The stage run ends, and the person's queued message runs after it.
        const next = yield* watchTurnStart(ctx);
        yield* endTurn(ctx);
        yield* Fiber.join(next);
        yield* endTurn(ctx);
        for (let index = 0; index < 3; index += 1) yield* settle(ctx, stepper);

        const projection = yield* projectionOf(ctx);
        const hello = projection.runs.find(
          (run) => run.userMessageId === "message:kodo-loop-user-message:hello",
        );
        assert.equal(hello?.status, "completed");
        assert.equal(projection.runs.length, 2, "no later stage started");
        assert.equal(
          projection.thread.interactionMode,
          "plan",
          "the message owns the mode, nothing restored",
        );
      }),
  ),
);

it.live("a person's message that began and ended between two looks still stops the loop", () =>
  withLoopHarness(
    "kodo-loop-missed-message",
    { startMode: "code", replies: [REPLIES.plan, "Hello back."] },
    (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 3);
        const stepper = yield* ctx.newStepper();
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        yield* ctx.orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:kodo-loop-missed-message:hello"),
          threadId: ctx.threadId,
          messageId: MessageId.make("message:kodo-loop-missed-message:hello"),
          text: "hello",
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
        });
        // The stage ends and the message runs to the end, with no look at the loop in between.
        const next = yield* watchTurnStart(ctx);
        yield* endTurn(ctx);
        yield* Fiber.join(next);
        yield* endTurn(ctx);
        const projection = yield* projectionOf(ctx);
        assert.isTrue(projection.runs.every((run) => run.status === "completed"));
        assert.equal(projection.runs.length, 2);

        yield* settle(ctx, stepper);
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "stopped");
        assert.equal(loop.stopReason, "user_message");
      }),
  ),
);

it.live("replaying the worker creates no duplicate stage runs", () =>
  withLoopHarness("kodo-loop-replay", { replies: [REPLIES.plan, REPLIES.code] }, (ctx) =>
    Effect.gen(function* () {
      yield* startLoop(ctx, "Do it.", 3);
      const started = yield* watchTurnStart(ctx);
      yield* settle(ctx, yield* ctx.newStepper());
      yield* Fiber.join(started);
      // A restart builds a new stepper with no memory; the same thread state is read again and again.
      for (let index = 0; index < 4; index += 1) {
        yield* settle(ctx, yield* ctx.newStepper());
      }
      const loop = yield* requireLoop(ctx);
      const messageId = `kodo-loop-${loop.loopId}-r1-plan`;
      const projection = yield* projectionOf(ctx);
      assert.equal(projection.runs.filter((run) => run.userMessageId === messageId).length, 1);
      assert.equal((yield* Ref.get(ctx.state)).started.length, 1);

      // The same command id, sent twice, is one command.
      const again = yield* ctx.orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`kodo-loop:${loop.loopId}:${messageId}:dispatch`),
        threadId: ctx.threadId,
        messageId: MessageId.make(messageId),
        text: "again",
        attachments: [],
        freshContext: true,
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "server",
      });
      assert.isTrue(again.replayed === true);
      assert.equal((yield* projectionOf(ctx)).runs.length, 1);
    }),
  ),
);

it.live("a run waiting on a request holds the loop, and answering it lets it continue", () =>
  withLoopHarness("kodo-loop-hold", { replies: [REPLIES.plan, REPLIES.code] }, (ctx) =>
    Effect.gen(function* () {
      yield* startLoop(ctx, "Do it.", 3);
      const stepper = yield* ctx.newStepper();
      const started = yield* watchTurnStart(ctx);
      yield* settle(ctx, stepper);
      yield* Fiber.join(started);
      const run = (yield* projectionOf(ctx)).runs[0]!;
      const setRunStatus = (status: "waiting" | "running", id: string) =>
        ctx.sink.write({
          events: [
            {
              id: EventId.make(id),
              type: "run.updated",
              threadId: ctx.threadId,
              runId: run.id,
              providerInstanceId: run.providerInstanceId,
              occurredAt: DateTime.makeUnsafe(Date.UTC(2026, 0, 1)),
              payload: { ...run, status },
            },
          ],
        });
      yield* setRunStatus("waiting", "hold-waiting");
      yield* settle(ctx, stepper);
      let loop = yield* requireLoop(ctx);
      assert.equal(loop.status, "held");
      assert.equal(loop.hold, "runtime_request");
      assert.equal(
        (yield* Ref.get(ctx.state)).started.length,
        1,
        "nothing else started while held",
      );

      yield* setRunStatus("running", "hold-running");
      yield* settle(ctx, stepper);
      loop = yield* requireLoop(ctx);
      assert.equal(loop.status, "active");

      yield* endTurn(ctx);
      yield* settle(ctx, stepper);
      assert.equal((yield* requireLoop(ctx)).stage, "code", "the loop continued to the next stage");
    }),
  ),
);

it.live(
  "a restart that ended the stage run does not fail the loop before its continuation exists",
  () =>
    withLoopHarness(
      "kodo-loop-restart-gap",
      { replies: [REPLIES.plan, "## Plan\n1. Resumed plan."] },
      (ctx) =>
        Effect.gen(function* () {
          yield* startLoop(ctx, "Do it.", 3);
          const stepper = yield* ctx.newStepper();
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(started);
          const run = (yield* projectionOf(ctx)).runs[0]!;
          // What startup recovery commits: the run ends, and the continuation is only owed, as an effect.
          const commandId = CommandId.make("command:kodo-loop-restart-gap:recover");
          yield* ctx.sink.writeWithEffects({
            commandId,
            events: [
              {
                id: EventId.make("recovered-run"),
                type: "run.updated",
                threadId: ctx.threadId,
                runId: run.id,
                providerInstanceId: run.providerInstanceId,
                occurredAt: DateTime.makeUnsafe(Date.UTC(2026, 0, 1)),
                payload: {
                  ...run,
                  status: "cancelled",
                  queuePosition: null,
                  completedAt: DateTime.makeUnsafe(Date.UTC(2026, 0, 1)),
                },
              },
            ],
            effects: [
              {
                id: `effect:restart-continuation:${run.id}`,
                commandId,
                threadId: ctx.threadId,
                request: { type: "provider-runtime.continue", sourceRunId: run.id },
              },
            ],
          });
          // In the gap the loop waits; the continuation is made after the run ended.
          assert.equal(yield* stepper.step(ctx.threadId), "idle");
          assert.equal((yield* requireLoop(ctx)).status, "active");

          // The effect runs and the continuation takes over the stage, which then settles from it.
          const resumed = yield* watchTurnStart(ctx);
          yield* ctx.worker.drain();
          yield* Fiber.join(resumed);
          assert.equal(yield* stepper.step(ctx.threadId), "idle");
          assert.equal((yield* requireLoop(ctx)).status, "active");
          yield* endTurn(ctx);
          assert.equal(yield* stepper.step(ctx.threadId), "acted");
          const loop = yield* requireLoop(ctx);
          assert.equal(loop.stage, "code");
          const continuation = (yield* projectionOf(ctx)).runs.find(
            (candidate) => candidate.restartContinuationOfRunId === run.id,
          );
          assert.isDefined(continuation);
          assert.equal(loop.stages[0]?.runId, continuation?.id);
        }),
    ),
);

const judgeCases: ReadonlyArray<{
  readonly name: string;
  readonly modeModels: Partial<Record<"plan" | "code" | "review" | "judge", ModelSelection>>;
  readonly judgeModel: string;
}> = [
  {
    name: "the judge slot",
    modeModels: { judge: selection("judge-model"), review: selection("review-model") },
    judgeModel: "judge-model",
  },
  {
    name: "the review slot when the judge has none",
    modeModels: { review: selection("review-model") },
    judgeModel: "review-model",
  },
  { name: "the thread's own model when neither is set", modeModels: {}, judgeModel: "base-model" },
];

it.live.each(judgeCases)(
  "the judge runs on $name, and the thread's own model is unchanged",
  (judgeCase) =>
    withLoopHarness(
      `kodo-loop-judge-model-${judgeCase.judgeModel}`,
      {
        modeModels: judgeCase.modeModels,
        replies: [REPLIES.plan, REPLIES.code, REPLIES.review, REPLIES.complete],
      },
      (ctx) =>
        Effect.gen(function* () {
          yield* startLoop(ctx, "Do it.", 1);
          yield* runToEnd(ctx, yield* ctx.newStepper());
          const started = (yield* Ref.get(ctx.state)).started.map((turn) => turn.model);
          const reviewModel = judgeCase.modeModels.review?.model ?? "base-model";
          assert.deepEqual(started, [
            "base-model",
            "base-model",
            reviewModel,
            judgeCase.judgeModel,
          ]);
          const { thread } = yield* projectionOf(ctx);
          assert.equal(kodoThreadOwnModel(thread).model, "base-model");
        }),
    ),
);

it.live(
  "starting a loop is refused while one is active or while a turn runs, with a clear message",
  () =>
    withLoopHarness("kodo-loop-refuse", { replies: [REPLIES.plan, "hi"] }, (ctx) =>
      Effect.gen(function* () {
        // A person's turn is running.
        const running = yield* watchTurnStart(ctx);
        yield* ctx.orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:kodo-loop-refuse:hi"),
          threadId: ctx.threadId,
          messageId: MessageId.make("message:kodo-loop-refuse:hi"),
          text: "hi",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
        });
        yield* ctx.worker.drain();
        yield* Fiber.join(running);
        const busy = yield* startLoop(ctx, "Do it.", undefined, "busy").pipe(Effect.flip);
        assert.include(userFacingDispatchErrorMessage(busy) ?? "", "A turn is running");
        assert.isUndefined(yield* loopOf(ctx));
        yield* endTurn(ctx);

        yield* startLoop(ctx, "Do it.");
        const again = yield* ctx.service
          .start({
            threadId: ctx.threadId,
            commandId: CommandId.make("command:kodo-loop-refuse:again"),
            requestMessageId: MessageId.make("message:kodo-loop-refuse:again"),
            request: "Again.",
          })
          .pipe(Effect.flip);
        assert.include(userFacingDispatchErrorMessage(again) ?? "", "already running");
      }),
    ),
);

it.live("a message cannot claim to be a loop stage to get the judge's model", () =>
  withLoopHarness(
    "kodo-loop-forged-stage",
    { modeModels: { judge: selection("judge-model") }, replies: ["ok"] },
    (ctx) =>
      Effect.gen(function* () {
        const started = yield* watchTurnStart(ctx);
        yield* ctx.orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:kodo-loop-forged-stage:m"),
          threadId: ctx.threadId,
          messageId: MessageId.make("message:kodo-loop-forged-stage:m"),
          text: "hello",
          attachments: [],
          kodoLoopStage: { loopId: "nope", round: 1, stage: "judge" },
          dispatchMode: { type: "start_immediately" },
        });
        yield* ctx.worker.drain();
        yield* Fiber.join(started);
        assert.deepEqual(
          (yield* Ref.get(ctx.state)).started.map((turn) => turn.model),
          ["base-model"],
        );
      }),
  ),
);

export type { KodoLoop };
