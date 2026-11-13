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
  type ServerProvider,
  ThreadId,
  type TurnTokenUsage,
} from "@t3tools/contracts";
import { kodoThreadOwnModel } from "@t3tools/shared/kodoModeModel";
import * as Clock from "effect/Clock";
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
import { DispatchModeLimit } from "./DispatchModeLimit.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
import { userFacingDispatchErrorMessage } from "./UserFacingErrors.ts";
import { makeKodoLoopService } from "../kodo/loop/LoopService.ts";
import {
  makeKodoLoopStepper,
  type LoopSpendDeps,
  type LoopStepResult,
} from "../kodo/loop/LoopStepper.ts";
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
  /** What each started turn reports as its token usage, in order; undefined reports nothing. */
  readonly usages: ReadonlyArray<TurnTokenUsage | undefined>;
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
            const usage = yield* Ref.modify(state, (current) => [
              current.usages[0],
              { ...current, usages: current.usages.slice(1) },
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
                  providerTurn: {
                    ...turn,
                    status,
                    startedAt,
                    completedAt,
                    ...(usage === undefined ? {} : { turnTokenUsage: usage }),
                  },
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
  /** A fresh stepper, as a restarted server would build. `spend` stands in for the server's provider list and prices. */
  readonly newStepper: (spend?: LoopSpendDeps) => Effect.Effect<{
    readonly step: (threadId: ThreadId) => Effect.Effect<LoopStepResult>;
  }>;
}

const withLoopHarness = <A, E>(
  name: string,
  options: {
    readonly modeModels?: Partial<Record<"plan" | "code" | "review" | "judge", ModelSelection>>;
    readonly startMode?: "ask" | "code" | "plan";
    readonly replies: ReadonlyArray<string>;
    readonly usages?: ReadonlyArray<TurnTokenUsage | undefined>;
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
        usages: options.usages ?? [],
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
        const newStepper = (spend?: LoopSpendDeps) =>
          makeKodoLoopStepper({
            ...(spend === undefined ? {} : { spend }),
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

/** Settles so the next stage starts, lets the provider answer it, and settles again so the one after starts. */
const runToEndOfStage = (
  ctx: Ctx,
  stepper: { readonly step: (id: ThreadId) => Effect.Effect<LoopStepResult> },
) =>
  Effect.gen(function* () {
    const started = yield* watchTurnStart(ctx);
    yield* settle(ctx, stepper);
    yield* Fiber.join(started);
    yield* endTurn(ctx);
    yield* ctx.worker.drain();
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
        // The message was queued behind the plan stage, so the thread took its start mode back in the
        // message's own commit, before the message's run was created: it runs as the person asked.
        assert.equal(projection.thread.interactionMode, "code");
        assert.equal(hello?.interactionMode, "code");
        assert.isUndefined(
          (yield* requireLoop(ctx)).cleanup,
          "the mode was handed back with the message, so nothing is owed",
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

it.live(
  "a message cannot claim to be a loop stage to get the judge's model, nor borrow a stage's id",
  () =>
    withLoopHarness(
      "kodo-loop-forged-stage",
      { modeModels: { judge: selection("judge-model") }, replies: ["ok", "ok"] },
      (ctx) =>
        Effect.gen(function* () {
          const forged = (suffix: string, extra: object) =>
            ctx.orchestrator
              .dispatch({
                type: "message.dispatch",
                createdBy: "user",
                creationSource: "web",
                commandId: CommandId.make(`command:kodo-loop-forged-stage:${suffix}`),
                threadId: ctx.threadId,
                messageId: MessageId.make(`message:kodo-loop-forged-stage:${suffix}`),
                text: "hello",
                attachments: [],
                dispatchMode: { type: "start_immediately" },
                ...extra,
              })
              .pipe(Effect.flip);
          const refusal = yield* forged("claim", {
            kodoLoopStage: { loopId: "nope", round: 1, stage: "judge" },
          });
          assert.include(userFacingDispatchErrorMessage(refusal) ?? String(refusal), "loop stage");
          assert.equal((yield* projectionOf(ctx)).runs.length, 0, "nothing started");

          // The same thread with a real loop: a client's own message in the reserved id shape is refused
          // too, so the loop can never adopt it as a stage.
          yield* startLoop(ctx, "Do it.", 2);
          const loop = yield* requireLoop(ctx);
          const lookalike = yield* ctx.orchestrator
            .dispatch({
              type: "message.dispatch",
              createdBy: "user",
              creationSource: "web",
              commandId: CommandId.make("command:kodo-loop-forged-stage:lookalike"),
              threadId: ctx.threadId,
              messageId: MessageId.make(`kodo-loop-${loop.loopId}-r1-plan`),
              text: "my own plan",
              attachments: [],
              dispatchMode: { type: "start_immediately" },
            })
            .pipe(Effect.flip);
          assert.include(
            userFacingDispatchErrorMessage(lookalike) ?? String(lookalike),
            "loop stage",
          );
          assert.equal((yield* projectionOf(ctx)).runs.length, 0, "nothing started");
          assert.equal((yield* requireLoop(ctx)).status, "active", "and the loop is untouched");
          assert.deepEqual((yield* Ref.get(ctx.state)).started, []);
        }),
    ),
);

it.live(
  "a stage message is accepted only for the active loop's current stage, in that stage's mode",
  () =>
    withLoopHarness("kodo-loop-stage-gate", { startMode: "ask", replies: [REPLIES.plan] }, (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 2);
        const loop = yield* requireLoop(ctx);
        const stageMessage = (suffix: string, stage: "plan" | "code") =>
          ctx.orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(`kodo-loop:${loop.loopId}:gate:${suffix}`),
            threadId: ctx.threadId,
            messageId: MessageId.make(`kodo-loop-${loop.loopId}-r1-${stage}`),
            text: "stage",
            attachments: [],
            freshContext: true,
            kodoLoopStage: { loopId: loop.loopId, round: 1, stage },
            dispatchMode: { type: "start_immediately" },
            createdBy: "agent",
            creationSource: "server",
          });
        // The thread is still in the start mode: a plan stage sent now would run in Ask.
        const early = yield* stageMessage("early", "plan").pipe(Effect.flip);
        assert.include(userFacingDispatchErrorMessage(early) ?? String(early), "plan mode");
        // Not the loop's current stage.
        const wrongStage = yield* stageMessage("code", "code").pipe(Effect.flip);
        assert.include(
          String(userFacingDispatchErrorMessage(wrongStage) ?? wrongStage),
          "loop stage",
        );
        assert.equal((yield* projectionOf(ctx)).runs.length, 0);

        // The loop's own step sets the mode and then sends it, and that is accepted.
        const stepper = yield* ctx.newStepper();
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        assert.equal((yield* projectionOf(ctx)).runs.length, 1);

        // After a stop, a stage message that was already on its way is refused: no stage runs after the stop.
        yield* ctx.service.stop({
          threadId: ctx.threadId,
          commandId: CommandId.make("command:kodo-loop-stage-gate:stop"),
        });
        const late = yield* stageMessage("late", "plan").pipe(Effect.flip);
        assert.isDefined(late);
        assert.equal((yield* projectionOf(ctx)).runs.length, 1);
      }),
    ),
);

it.live(
  "a person's steer into the stage run ends the loop; the run goes on as their turn and the mode comes back when it settles",
  () =>
    withLoopHarness("kodo-loop-steer", { startMode: "ask", replies: [REPLIES.plan] }, (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 3);
        const stepper = yield* ctx.newStepper();
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        const stageRun = (yield* projectionOf(ctx)).runs[0]!;

        yield* ctx.orchestrator.dispatch({
          type: "message.dispatch",
          createdBy: "user",
          creationSource: "web",
          commandId: CommandId.make("command:kodo-loop-steer:steer"),
          threadId: ctx.threadId,
          messageId: MessageId.make("message:kodo-loop-steer:steer"),
          text: "actually, only the parser",
          attachments: [],
          dispatchMode: { type: "steer_active", targetRunId: stageRun.id },
        });
        let loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "stopped");
        assert.equal(loop.stopReason, "user_message");
        let projection = yield* projectionOf(ctx);
        assert.equal(projection.runs.length, 1, "the steer joined the stage run, no new run");
        assert.equal(projection.runs[0]?.status, "running");
        assert.equal(
          projection.thread.interactionMode,
          "plan",
          "the run keeps its mode while it runs",
        );
        assert.deepEqual(
          loop.cleanup,
          { leftMode: "plan", record: true },
          "the mode and the stage's record are owed once the run settles",
        );

        // While the run runs the loop waits; it starts nothing and restores nothing.
        assert.equal(yield* stepper.step(ctx.threadId), "idle");
        assert.equal((yield* projectionOf(ctx)).thread.interactionMode, "plan");
        yield* endTurn(ctx);
        assert.equal(
          yield* stepper.step(ctx.threadId),
          "acted",
          "the stage that was running is recorded",
        );
        loop = yield* requireLoop(ctx);
        assert.deepEqual(
          loop.stages.map((record) => [record.round, record.stage, record.status]),
          [[1, "plan", "interrupted"]],
        );
        assert.deepEqual(loop.cleanup, { leftMode: "plan" });
        assert.equal(yield* stepper.step(ctx.threadId), "acted", "the mode goes back");
        yield* ctx.worker.drain();
        assert.equal((yield* projectionOf(ctx)).thread.interactionMode, "ask");
        assert.equal(
          yield* stepper.step(ctx.threadId),
          "acted",
          "and the loop reports itself done",
        );
        assert.equal(yield* stepper.step(ctx.threadId), "gone");
        loop = yield* requireLoop(ctx);
        assert.isUndefined(loop.cleanup);
        projection = yield* projectionOf(ctx);
        assert.equal(projection.runs.length, 1, "no later stage ever started");
        assert.equal((yield* Ref.get(ctx.state)).started.length, 1);
      }),
    ),
);

it.live(
  "a mode change from anyone but the loop is refused while it runs, and the loop carries on",
  () =>
    withLoopHarness("kodo-loop-mode-lock", { startMode: "ask", replies: [REPLIES.plan] }, (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 2);
        const stepper = yield* ctx.newStepper();
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        assert.equal((yield* projectionOf(ctx)).thread.interactionMode, "plan");

        const change = yield* ctx.orchestrator
          .dispatch({
            type: "thread.interaction-mode.set",
            commandId: CommandId.make("command:kodo-loop-mode-lock:set"),
            threadId: ctx.threadId,
            interactionMode: "code",
          })
          .pipe(Effect.flip);
        assert.include(userFacingDispatchErrorMessage(change) ?? String(change), "/loop stop");
        assert.equal(
          (yield* projectionOf(ctx)).thread.interactionMode,
          "plan",
          "the mode did not move",
        );
        assert.equal((yield* requireLoop(ctx)).status, "active");

        // Once the loop is stopped the mode is anyone's again.
        yield* ctx.service.stop({
          threadId: ctx.threadId,
          commandId: CommandId.make("command:kodo-loop-mode-lock:stop"),
        });
        yield* ctx.orchestrator.dispatch({
          type: "thread.interaction-mode.set",
          commandId: CommandId.make("command:kodo-loop-mode-lock:set-after"),
          threadId: ctx.threadId,
          interactionMode: "code",
        });
        assert.equal((yield* projectionOf(ctx)).thread.interactionMode, "code");
      }),
    ),
);

it.live("a loop that cannot get the thread into a stage's mode ends as an error that says so", () =>
  withLoopHarness("kodo-loop-no-progress", { startMode: "ask", replies: [] }, (ctx) =>
    Effect.gen(function* () {
      yield* startLoop(ctx, "Do it.", 2);
      // A mode command that does nothing: the thread never reaches the plan stage's mode.
      const stuck = yield* makeKodoLoopStepper({
        orchestrator: ctx.orchestrator,
        dispatch: (command) =>
          command.type === "thread.interaction-mode.set"
            ? Effect.succeed({})
            : ctx.orchestrator.dispatch(command),
        readDiff: () => Effect.succeed({ kind: "unavailable", reason: "none" }),
      });
      const results: Array<string> = [];
      for (let index = 0; index < 6; index += 1) results.push(yield* stuck.step(ctx.threadId));
      assert.deepEqual(results.slice(0, 3), ["acted", "acted", "acted"]);
      const loop = yield* requireLoop(ctx);
      assert.equal(loop.status, "failed");
      assert.equal(loop.stopReason, "error");
      assert.include(loop.stopDetail ?? "", "could not make progress");
      assert.include(loop.stopDetail ?? "", "mode");
      assert.equal((yield* projectionOf(ctx)).runs.length, 0, "no stage ran in the wrong mode");
      // And the worker stops looking at it.
      assert.equal(results.at(-1), "gone");
    }),
  ),
);

it.live(
  "a stage run that finishes with no reply ends the loop with that said, instead of waiting for ever",
  () =>
    withLoopHarness("kodo-loop-silent-stage", { replies: [""] }, (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 2);
        yield* runToEnd(ctx, yield* ctx.newStepper());
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "failed");
        assert.equal(loop.stopReason, "error");
        assert.include(loop.stopDetail ?? "", "without a plan");
      }),
    ),
);

it.live(
  "a wake that arrives during a stage does not stop the loop, runs read-only in that stage's mode, and is waited out",
  () =>
    withLoopHarness(
      "kodo-loop-wake",
      { startMode: "ask", replies: [REPLIES.plan, "Noted the task result.", REPLIES.code] },
      (ctx) =>
        Effect.gen(function* () {
          yield* startLoop(ctx, "Do it.", 2);
          const stepper = yield* ctx.newStepper();
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(started);

          // A delegated task's completion wake, queued behind the plan stage.
          yield* ctx.orchestrator.dispatch({
            type: "message.dispatch",
            createdBy: "agent",
            creationSource: "server",
            commandId: CommandId.make("command:kodo-loop-wake:wake"),
            threadId: ctx.threadId,
            messageId: MessageId.make("message:kodo-loop-wake:wake"),
            text: "A delegated task finished.",
            attachments: [],
            notification: {
              source: { kind: "background_task" },
              outcome: "updated",
              summary: "Background activity updated",
            },
            dispatchMode: { type: "queue_after_active" },
          });
          assert.equal(
            (yield* requireLoop(ctx)).status,
            "active",
            "a wake is not a person's message",
          );

          // The plan stage ends; the wake starts before the loop moves on, and the loop leaves the mode alone.
          const wakeStarted = yield* watchTurnStart(ctx);
          yield* endTurn(ctx);
          yield* Fiber.join(wakeStarted);
          yield* settle(ctx, stepper);
          let loop = yield* requireLoop(ctx);
          assert.equal(loop.status, "active");
          assert.equal(loop.stage, "code", "the plan stage settled");
          assert.equal(
            (yield* projectionOf(ctx)).thread.interactionMode,
            "plan",
            "the mode is not changed under the wake",
          );
          const startedTurns = (yield* Ref.get(ctx.state)).started;
          assert.deepEqual(
            startedTurns.map((turn) => turn.modeReadOnly),
            [true, true],
            "the wake runs read-only, as the plan stage it interrupted",
          );

          // Once the wake is over the loop goes on to the code stage.
          const codeStarted = yield* watchTurnStart(ctx);
          yield* endTurn(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(codeStarted);
          loop = yield* requireLoop(ctx);
          assert.equal(loop.status, "active");
          assert.equal((yield* projectionOf(ctx)).thread.interactionMode, "code");
          assert.equal((yield* Ref.get(ctx.state)).started[2]?.modeReadOnly, false);
        }),
    ),
);

it.live(
  "a sender whose mode limit is below Code can never start, and nothing is started or sent",
  () =>
    withLoopHarness("kodo-loop-limit", { startMode: "plan", replies: [REPLIES.plan] }, (ctx) =>
      Effect.gen(function* () {
        const limited = { runtimeMode: "full-access", interactionMode: "plan" } as const;
        const sent = (suffix: string, text: string) =>
          ({
            type: "message.dispatch",
            createdBy: "agent",
            creationSource: "mcp",
            commandId: CommandId.make(`command:kodo-loop-limit:${suffix}`),
            threadId: ctx.threadId,
            messageId: MessageId.make(`message:kodo-loop-limit:${suffix}`),
            text,
            attachments: [],
            dispatchMode: { type: "start_immediately" },
          }) as OrchestrationV2Command;
        const refusalOf = <E extends { readonly _tag: string }>(
          effect: Effect.Effect<unknown, E> | undefined,
        ): Effect.Effect<E> =>
          (effect ?? Effect.die("not a loop message")).pipe(
            Effect.provideService(DispatchModeLimit, limited),
            Effect.flip,
            Effect.orDie,
          );

        // Route 1: an agent's send (sendToThread -> the `/loop` funnel).
        const viaSend = yield* refusalOf(
          ctx.service.sendControl(sent("send", "/loop implement X")),
        );
        assert.include(
          userFacingDispatchErrorMessage(viaSend) ?? String(viaSend),
          "limited to plan mode",
        );
        // Route 2: the message funnel a launch's first message and a plain dispatch go through.
        const viaDispatch = yield* refusalOf(
          ctx.service.intercept(sent("dispatch", "/loop implement X")),
        );
        assert.include(
          userFacingDispatchErrorMessage(viaDispatch) ?? String(viaDispatch),
          "limited to plan mode",
        );
        // Route 3: the control command itself, by anyone who can dispatch it.
        const viaCommand = yield* ctx.orchestrator
          .dispatch({
            type: "thread.kodo-loop.control",
            commandId: CommandId.make("command:kodo-loop-limit:control"),
            threadId: ctx.threadId,
            control: {
              type: "start",
              request: "x",
              requestMessageId: MessageId.make("message:kodo-loop-limit:control"),
              maxRounds: 2,
              planApproval: "auto",
              budget: {},
            },
          })
          .pipe(Effect.provideService(DispatchModeLimit, limited), Effect.flip);
        assert.include(
          userFacingDispatchErrorMessage(viaCommand) ?? String(viaCommand),
          "limited to plan mode",
        );

        // No side effects: no loop, no request message, no run, no turn.
        const projection = yield* projectionOf(ctx);
        assert.isUndefined(projection.thread.kodoLoop);
        assert.equal(projection.messages.length, 0);
        assert.equal(projection.runs.length, 0);
        assert.deepEqual((yield* Ref.get(ctx.state)).started, []);

        // A sender allowed Code is not refused, and stopping is open to everyone.
        const allowed = { ...limited, interactionMode: "code" } as const;
        const ok = ctx.service.sendControl(sent("ok", "/loop implement X"));
        yield* ok!.pipe(Effect.provideService(DispatchModeLimit, allowed));
        assert.equal((yield* requireLoop(ctx)).status, "active");
        yield* ctx.service
          .sendControl(sent("stop", "/loop stop"))!
          .pipe(Effect.provideService(DispatchModeLimit, limited));
        assert.equal((yield* requireLoop(ctx)).stopReason, "user_stop");
      }),
    ),
);

it.live(
  "`/loop` sent by an agent answers in words: a start, a status and a stop are successes, and nothing is left half done",
  () =>
    withLoopHarness("kodo-loop-send", { startMode: "ask", replies: [REPLIES.plan] }, (ctx) =>
      Effect.gen(function* () {
        const send = (suffix: string, text: string) =>
          ctx.service.sendControl({
            type: "message.dispatch",
            createdBy: "agent",
            creationSource: "mcp",
            commandId: CommandId.make(`command:kodo-loop-send:${suffix}`),
            threadId: ctx.threadId,
            messageId: MessageId.make(`message:kodo-loop-send:${suffix}`),
            text,
            attachments: [],
            dispatchMode: { type: "start_immediately" },
          } as OrchestrationV2Command)!;

        assert.include((yield* send("status0", "/loop status")).note, "no loop");
        assert.include((yield* send("stop0", "/loop stop")).note, "No loop is running");
        const started = yield* send("start", "/loop 2 add retries");
        assert.include(started.note, "started");
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "active");
        assert.equal(loop.maxRounds, 2);
        assert.include((yield* send("status1", "/loop status")).note, "running");
        assert.include((yield* send("stop1", "/loop stop")).note, "stopped");
        assert.equal((yield* requireLoop(ctx)).stopReason, "user_stop");
        // Something that cannot be done is the only failure, with its reason.
        const invalid = yield* send("bad", "/loop").pipe(Effect.flip);
        assert.include(
          userFacingDispatchErrorMessage(invalid) ?? String(invalid),
          "Say what the loop should do",
        );
      }),
    ),
);

it.live("the person's `/loop` message becomes a row of the thread, above the first stage", () =>
  withLoopHarness("kodo-loop-request-row", { replies: [REPLIES.plan] }, (ctx) =>
    Effect.gen(function* () {
      yield* ctx.service.sendControl({
        type: "message.dispatch",
        createdBy: "user",
        creationSource: "web",
        commandId: CommandId.make("command:kodo-loop-request-row:start"),
        threadId: ctx.threadId,
        messageId: MessageId.make("message:kodo-loop-request-row:start"),
        text: "/loop 2 make the parser stricter",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
      } as OrchestrationV2Command)!;
      const started = yield* watchTurnStart(ctx);
      yield* settle(ctx, yield* ctx.newStepper());
      yield* Fiber.join(started);
      const projection = yield* projectionOf(ctx);
      const request = projection.messages.find(
        (message) => message.id === "message:kodo-loop-request-row:start",
      );
      assert.equal(request?.text, "/loop 2 make the parser stricter");
      assert.equal(request?.role, "user");
      assert.equal(request?.createdBy, "user");
      const items = projection.turnItems.filter((item) => item.type === "user_message");
      const order = items.toSorted((a, b) => a.ordinal - b.ordinal).map((item) => item.messageId);
      assert.deepEqual(order.slice(0, 2), [
        "message:kodo-loop-request-row:start",
        `kodo-loop-${(yield* requireLoop(ctx)).loopId}-r1-plan`,
      ]);
    }),
  ),
);

it.live(
  "a loop that ended while the server was down is cleaned up on the first look after it comes back",
  () =>
    withLoopHarness(
      "kodo-loop-restart-cleanup",
      { startMode: "ask", replies: [REPLIES.plan] },
      (ctx) =>
        Effect.gen(function* () {
          yield* startLoop(ctx, "Do it.", 2);
          const before = yield* ctx.newStepper();
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, before);
          yield* Fiber.join(started);
          // The person stopped it, and the server went down before the stage run was interrupted.
          yield* ctx.service.stop({
            threadId: ctx.threadId,
            commandId: CommandId.make("command:kodo-loop-restart-cleanup:stop"),
          });
          let loop = yield* requireLoop(ctx);
          assert.deepEqual(loop.cleanup, { leftMode: "plan", interrupt: true, record: true });
          assert.equal((yield* projectionOf(ctx)).runs[0]?.status, "running");

          // A new process: the stepper has no memory, only the thread's own state to go on.
          const after = yield* ctx.newStepper();
          const ended = yield* ctx.orchestrator.streamDomainEvents.pipe(
            Stream.filter(
              (event) => event.type === "run.updated" && event.payload.status === "interrupted",
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped({ startImmediately: true }),
          );
          assert.equal(yield* after.step(ctx.threadId), "acted", "the stage run is interrupted");
          yield* Fiber.join(ended);
          yield* ctx.worker.drain();
          for (let index = 0; index < 4; index += 1) yield* after.step(ctx.threadId);
          loop = yield* requireLoop(ctx);
          assert.isUndefined(loop.cleanup);
          const projection = yield* projectionOf(ctx);
          assert.equal(projection.thread.interactionMode, "ask", "the start mode is back");
          assert.equal(projection.runs.length, 1, "no later stage ran");
          assert.equal(yield* after.step(ctx.threadId), "gone", "and nothing is left to look at");
        }),
    ),
);

it.live("a restart's continuation of a stopped loop's stage run does not run on", () =>
  withLoopHarness(
    "kodo-loop-no-continuation",
    { replies: [REPLIES.plan, "## Plan\n1. This must never run."] },
    (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 3);
        const stepper = yield* ctx.newStepper();
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        const run = (yield* projectionOf(ctx)).runs[0]!;
        // Startup recovery commits the run's end and owes its continuation as an effect...
        const commandId = CommandId.make("command:kodo-loop-no-continuation:recover");
        yield* ctx.sink.writeWithEffects({
          commandId,
          events: [
            {
              id: EventId.make("recovered-run-2"),
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
        // ...but the person had already stopped the loop.
        yield* ctx.service.stop({
          threadId: ctx.threadId,
          commandId: CommandId.make("command:kodo-loop-no-continuation:stop"),
        });
        yield* ctx.worker.drain();
        const projection = yield* projectionOf(ctx);
        assert.equal(projection.runs.length, 1, "the continuation was not made");
        assert.equal((yield* Ref.get(ctx.state)).started.length, 1);
      }),
  ),
);

it.live(
  "looking at a loop while its stage runs reads no replies, and a finished stage reads only its own",
  () =>
    withLoopHarness("kodo-loop-reads", { replies: [REPLIES.plan, REPLIES.code] }, (ctx) =>
      Effect.gen(function* () {
        yield* startLoop(ctx, "Do it.", 2);
        const reads: Array<ReadonlyArray<string>> = [];
        const counting = yield* makeKodoLoopStepper({
          orchestrator: {
            getThreadRecords: (threadId, fields, filter) => {
              if ((fields as ReadonlyArray<string>).includes("messages"))
                reads.push(filter?.messageRunIds ?? []);
              return ctx.orchestrator.getThreadRecords(threadId, fields, filter);
            },
            restartContinuationPending: ctx.orchestrator.restartContinuationPending,
            kodoLoopStageSelection: ctx.orchestrator.kodoLoopStageSelection,
          },
          dispatch: ctx.orchestrator.dispatch,
          readDiff: () => Effect.succeed({ kind: "unavailable", reason: "none" }),
        });
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, counting);
        yield* Fiber.join(started);
        const before = reads.length;
        // Streaming events arrive all through a stage; none of them costs a read of the thread's replies.
        for (let index = 0; index < 10; index += 1) {
          assert.equal(yield* counting.step(ctx.threadId), "idle");
        }
        assert.equal(reads.length, before, "no reply was read while the stage ran");
        const planRun = (yield* projectionOf(ctx)).runs[0]!;
        yield* endTurn(ctx);
        yield* settle(ctx, counting);
        // Settling the plan read its reply once, then the code stage's prompt read the plan again:
        // every read names the one run it wants, never the thread's whole history.
        assert.isTrue(reads.every((read) => read.length === 1));
        assert.isTrue(reads.every((read) => read[0] === planRun.id));
      }),
    ),
);

/** What the server would give the loop: the limit windows of the test provider and a price list per million tokens. */
const RATES_PER_MILLION: Record<string, number> = {
  "base-model": 2,
  "cheap-model": 1,
  "big-model": 10,
};

const priceFromList: LoopSpendDeps["price"] = (model, totals) =>
  Effect.succeed(
    RATES_PER_MILLION[model] === undefined
      ? null
      : ((totals.uncachedInputTokens +
          totals.cachedInputTokens +
          totals.cacheCreationTokens +
          totals.outputTokens) *
          RATES_PER_MILLION[model]!) /
          1_000_000,
  );

const providerWithWindow = (usedPercent: number, checkedAt: string): ServerProvider =>
  ({
    instanceId: providerInstanceId,
    driver,
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "session",
          kind: "session",
          label: "Session",
          usedPercent,
          windowDurationMins: 300,
        },
      ],
    },
  }) as unknown as ServerProvider;

const spendWith = (input: {
  readonly modeModels?: LoopSpendDeps["modeModels"] extends Effect.Effect<infer A>
    ? Partial<A>
    : never;
  readonly providers: LoopSpendDeps["providers"];
  readonly refreshLimits?: LoopSpendDeps["refreshLimits"];
}): LoopSpendDeps => ({
  providers: input.providers,
  ...(input.refreshLimits === undefined ? {} : { refreshLimits: input.refreshLimits }),
  modeModels: Effect.succeed({
    ask: null,
    plan: null,
    code: null,
    review: null,
    orchestrator: null,
    judge: null,
    ...input.modeModels,
  }),
  price: priceFromList,
});

const usage = (
  input: Partial<TurnTokenUsage> & { readonly inputTokens: number; readonly outputTokens: number },
) =>
  ({
    usageScope: "main_agent",
    usageStatus: "complete",
    hasSubagents: false,
    ...input,
  }) as TurnTokenUsage;

/** A loop service whose settings are as given, for the settings a test needs (approval, budget). */
const serviceWith = (ctx: Ctx, loop: Partial<typeof DEFAULT_KODO_LOOP_SETTINGS>) =>
  makeKodoLoopService({
    orchestrator: ctx.orchestrator,
    serverSettings: {
      getSettings: Effect.succeed({ loop: { ...DEFAULT_KODO_LOOP_SETTINGS, ...loop } }),
    },
  });

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

it.live(
  "each stage records what it spent, priced where it ran, and the loop reports an estimate of the savings",
  () =>
    withLoopHarness(
      "kodo-loop-usage",
      {
        modeModels: { code: selection("cheap-model"), review: selection("big-model") },
        replies: [REPLIES.plan, REPLIES.code, REPLIES.review, REPLIES.complete],
        usages: [
          usage({ inputTokens: 100_000, cachedInputTokens: 40_000, outputTokens: 10_000 }),
          usage({
            inputTokens: 500_000,
            cachedInputTokens: 300_000,
            outputTokens: 50_000,
            reasoningTokens: 20_000,
          }),
          usage({ inputTokens: 80_000, outputTokens: 5_000 }),
          // The judge's provider reports nothing: unavailable, not zero.
          undefined,
        ],
      },
      (ctx) =>
        Effect.gen(function* () {
          yield* startLoop(ctx, "Do it.", 1);
          const stepper = yield* ctx.newStepper(
            spendWith({
              modeModels: { code: selection("cheap-model"), review: selection("big-model") },
              providers: Effect.succeed([]),
            }),
          );
          yield* runToEnd(ctx, stepper);
          const loop = yield* requireLoop(ctx);
          assert.equal(loop.status, "done");
          const [plan, code, review, judge] = loop.stages;
          assert.deepEqual(plan?.usage, {
            uncachedInputTokens: 60_000,
            cachedInputTokens: 40_000,
            cacheCreationTokens: 0,
            outputTokens: 10_000,
            reasoningTokens: 0,
            complete: true,
            costUsd: 0.22,
            referenceCostUsd: 1.1,
          });
          assert.deepEqual(code?.usage, {
            uncachedInputTokens: 200_000,
            cachedInputTokens: 300_000,
            cacheCreationTokens: 0,
            outputTokens: 50_000,
            reasoningTokens: 20_000,
            complete: true,
            costUsd: 0.55,
            referenceCostUsd: 5.5,
          });
          assert.equal(review?.usage?.costUsd, 0.85, "the review ran on the reference model");
          assert.isUndefined(
            judge?.usage,
            "a provider that reported nothing has no usage, not zero",
          );
          assert.equal(code?.model?.model, "cheap-model");
          // Plan (on the thread's model) and Code ran below the reference, so both are compared.
          assert.deepEqual(loop.savings?.unpricedStages, []);
          assert.equal(loop.savings?.referenceModel.model, "big-model");
          assert.equal(loop.savings?.pricedStages, 2);
          assert.closeTo(loop.savings?.actualUsd ?? NaN, 0.77, 1e-9);
          assert.closeTo(loop.savings?.referenceUsd ?? NaN, 6.6, 1e-9);
          assert.closeTo(loop.savings?.savedUsd ?? NaN, 5.83, 1e-9);
        }),
    ),
);

it.live(
  "a run that restarted sums the usage of both of its attempts, and a stage without usage is listed as unpriced",
  () =>
    withLoopHarness(
      "kodo-loop-usage-restart",
      {
        modeModels: { review: selection("big-model") },
        replies: [REPLIES.plan, "## Plan\n1. Resumed plan."],
        // The resumed attempt reports; the interrupted one is written below.
        usages: [undefined, usage({ inputTokens: 30_000, outputTokens: 3_000 })],
      },
      (ctx) =>
        Effect.gen(function* () {
          yield* startLoop(ctx, "Do it.", 1);
          const stepper = yield* ctx.newStepper(
            spendWith({
              modeModels: { review: selection("big-model") },
              providers: Effect.succeed([]),
            }),
          );
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(started);
          const run = (yield* projectionOf(ctx)).runs[0]!;
          const firstTurn = (yield* projectionOf(ctx)).providerTurns[0]!;
          const commandId = CommandId.make("command:kodo-loop-usage-restart:recover");
          // The first attempt spent tokens before the restart ended it.
          yield* ctx.sink.writeWithEffects({
            commandId,
            events: [
              {
                id: EventId.make("usage-restart-turn"),
                type: "provider-turn.updated",
                threadId: ctx.threadId,
                occurredAt: DateTime.makeUnsafe(Date.UTC(2026, 0, 1)),
                payload: {
                  ...firstTurn,
                  turnTokenUsage: usage({
                    inputTokens: 70_000,
                    outputTokens: 7_000,
                    usageStatus: "partial",
                  }),
                },
              },
              {
                id: EventId.make("usage-restart-run"),
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
          const resumed = yield* watchTurnStart(ctx);
          yield* ctx.worker.drain();
          yield* Fiber.join(resumed);
          yield* endTurn(ctx);
          yield* settle(ctx, stepper);
          const plan = (yield* requireLoop(ctx)).stages[0];
          assert.deepEqual(
            [plan?.usage?.uncachedInputTokens, plan?.usage?.outputTokens, plan?.usage?.complete],
            [100_000, 10_000, false],
            "both attempts count, and one of them was only partly reported",
          );
        }),
    ),
);

it.live(
  "a budget limit stops the loop between stages, naming the window; the stage in flight finishes",
  () =>
    withLoopHarness("kodo-loop-budget-limit", { replies: [REPLIES.plan, REPLIES.code] }, (ctx) =>
      Effect.gen(function* () {
        const percent = yield* Ref.make(50);
        const checkedAt = yield* nowIso;
        yield* startLoop(ctx, "Do it.", 3);
        const stepper = yield* ctx.newStepper(
          spendWith({
            providers: Ref.get(percent).pipe(
              Effect.map((used) => [providerWithWindow(used, checkedAt)]),
            ),
          }),
        );
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        // The reading crosses the line while the plan stage runs: it is not interrupted.
        yield* Ref.set(percent, 92);
        assert.equal(yield* stepper.step(ctx.threadId), "idle");
        assert.equal((yield* projectionOf(ctx)).runs[0]?.status, "running");
        yield* endTurn(ctx);
        yield* settle(ctx, stepper);
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.status, "stopped");
        assert.equal(loop.stopReason, "budget");
        assert.equal(loop.stopDetail, "Grok 5-hour window at 92%, limit 90%.");
        assert.deepEqual(
          loop.stages.map((record) => record.stage),
          ["plan"],
          "the plan finished; the code stage never started",
        );
        assert.equal((yield* Ref.get(ctx.state)).started.length, 1);
      }),
    ),
);

it.live("a token cap stops the loop after the stage that reached it", () =>
  withLoopHarness(
    "kodo-loop-budget-tokens",
    {
      replies: [REPLIES.plan, REPLIES.code],
      usages: [usage({ inputTokens: 9_000, outputTokens: 1_500 })],
    },
    (ctx) =>
      Effect.gen(function* () {
        const service = serviceWith(ctx, {
          budget: { stopAtLimitPercent: 90, maxCostUsd: null, maxTokens: 10_000 },
        });
        yield* service.start({
          threadId: ctx.threadId,
          commandId: CommandId.make("command:kodo-loop-budget-tokens:start"),
          requestMessageId: MessageId.make("message:kodo-loop-budget-tokens:start"),
          request: "Do it.",
          maxRounds: 3,
        });
        yield* runToEnd(ctx, yield* ctx.newStepper());
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.stopReason, "budget");
        assert.include(
          loop.stopDetail ?? "",
          "10,500 tokens (cache reads are not counted), at the 10,000 cap",
        );
        assert.equal(loop.stages.length, 1);
      }),
  ),
);

it.live("a gate that cannot be read stops the loop before anything is sent", () =>
  withLoopHarness("kodo-loop-budget-error", { replies: [REPLIES.plan] }, (ctx) =>
    Effect.gen(function* () {
      yield* startLoop(ctx, "Do it.", 2);
      const stepper = yield* ctx.newStepper(
        spendWith({ providers: Effect.die(new Error("provider list unavailable")) }),
      );
      yield* settle(ctx, stepper);
      const loop = yield* requireLoop(ctx);
      assert.equal(loop.status, "stopped");
      assert.equal(loop.stopReason, "budget");
      assert.include(loop.stopDetail ?? "", "provider list unavailable");
      assert.include(loop.stopDetail ?? "", "stopped instead of spending unchecked");
      assert.deepEqual((yield* Ref.get(ctx.state)).started, []);
    }),
  ),
);

it.live(
  "a provider that reports no limit windows does not stop the loop, and the loop says so",
  () =>
    withLoopHarness(
      "kodo-loop-budget-missing",
      { replies: [REPLIES.plan, REPLIES.code, REPLIES.review, REPLIES.complete] },
      (ctx) =>
        Effect.gen(function* () {
          yield* startLoop(ctx, "Do it.", 1);
          yield* runToEnd(ctx, yield* ctx.newStepper(spendWith({ providers: Effect.succeed([]) })));
          const loop = yield* requireLoop(ctx);
          assert.equal(loop.status, "done");
          assert.deepEqual(loop.limitCheck, {
            state: "missing",
            provider: providerInstanceId,
            unchecked: [
              { round: 1, stage: "plan" },
              { round: 1, stage: "code" },
              { round: 1, stage: "review" },
              { round: 1, stage: "judge" },
            ],
          });
        }),
    ),
);

it.live(
  "plan approval = ask holds after the plan, survives a restart, and approving continues to Code",
  () =>
    withLoopHarness(
      "kodo-loop-approval",
      { startMode: "ask", replies: [REPLIES.plan, REPLIES.code] },
      (ctx) =>
        Effect.gen(function* () {
          const service = serviceWith(ctx, { planApproval: "ask" });
          yield* service.start({
            threadId: ctx.threadId,
            commandId: CommandId.make("command:kodo-loop-approval:start"),
            requestMessageId: MessageId.make("message:kodo-loop-approval:start"),
            request: "Do it.",
            maxRounds: 2,
          });
          const stepper = yield* ctx.newStepper();
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(started);
          yield* endTurn(ctx);
          assert.equal(yield* settle(ctx, stepper), "idle");

          let loop = yield* requireLoop(ctx);
          assert.equal(loop.status, "held");
          assert.equal(loop.hold, "plan_approval");
          assert.equal(loop.stage, "code");
          assert.equal((yield* Ref.get(ctx.state)).started.length, 1, "no coding stage started");

          // A restarted server builds a new stepper and reads the same held loop: still nothing runs.
          const restarted = yield* ctx.newStepper();
          for (let index = 0; index < 3; index += 1) {
            assert.equal(yield* restarted.step(ctx.threadId), "idle");
          }
          assert.equal((yield* Ref.get(ctx.state)).started.length, 1);
          assert.equal((yield* requireLoop(ctx)).hold, "plan_approval");

          yield* service.approve({
            threadId: ctx.threadId,
            commandId: CommandId.make("command:kodo-loop-approval:approve"),
          });
          loop = yield* requireLoop(ctx);
          assert.equal(loop.status, "active");
          const coding = yield* watchTurnStart(ctx);
          yield* settle(ctx, restarted);
          yield* Fiber.join(coding);
          assert.equal(
            (yield* Ref.get(ctx.state)).started.length,
            2,
            "approving started the Code stage",
          );
          assert.equal((yield* projectionOf(ctx)).runs[1]?.interactionMode, "code");
        }),
    ),
);

it.live(
  "a message sent while the plan waits for approval stops the loop and runs as the person's turn",
  () =>
    withLoopHarness(
      "kodo-loop-approval-message",
      { startMode: "ask", replies: [REPLIES.plan, "Sure."] },
      (ctx) =>
        Effect.gen(function* () {
          const service = serviceWith(ctx, { planApproval: "ask" });
          yield* service.start({
            threadId: ctx.threadId,
            commandId: CommandId.make("command:kodo-loop-approval-message:start"),
            requestMessageId: MessageId.make("message:kodo-loop-approval-message:start"),
            request: "Do it.",
            maxRounds: 2,
          });
          const stepper = yield* ctx.newStepper();
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(started);
          yield* endTurn(ctx);
          yield* settle(ctx, stepper);
          assert.equal((yield* requireLoop(ctx)).hold, "plan_approval");
          const reply = yield* watchTurnStart(ctx);
          yield* ctx.orchestrator.dispatch({
            type: "message.dispatch",
            createdBy: "user",
            creationSource: "web",
            commandId: CommandId.make("command:kodo-loop-approval-message:reply"),
            threadId: ctx.threadId,
            messageId: MessageId.make("message:kodo-loop-approval-message:reply"),
            text: "Actually, do it differently.",
            attachments: [],
            dispatchMode: { type: "start_immediately" },
          });
          yield* ctx.worker.drain();
          yield* Fiber.join(reply);
          const loop = yield* requireLoop(ctx);
          assert.equal(loop.status, "stopped");
          assert.equal(loop.stopReason, "user_message");
        }),
    ),
);

it.live(
  "a stopped loop records the stage that was running, with what it spent, once its run settles",
  () =>
    withLoopHarness(
      "kodo-loop-stop-record",
      {
        startMode: "code",
        replies: [REPLIES.plan, REPLIES.code],
        usages: [
          usage({ inputTokens: 1_000, outputTokens: 100 }),
          usage({ inputTokens: 9_000, cachedInputTokens: 2_000, outputTokens: 900 }),
        ],
      },
      (ctx) =>
        Effect.gen(function* () {
          yield* startLoop(ctx, "Do it.", 3);
          const stepper = yield* ctx.newStepper(spendWith({ providers: Effect.succeed([]) }));
          yield* runToEndOfStage(ctx, stepper);
          // The Code stage is now running. A person stops the loop.
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(started);
          assert.equal((yield* projectionOf(ctx)).runs[1]?.status, "running");
          yield* ctx.service.stop({
            threadId: ctx.threadId,
            commandId: CommandId.make("command:kodo-loop-stop-record:stop"),
          });
          let loop = yield* requireLoop(ctx);
          assert.deepEqual(
            loop.stages.map((record) => record.stage),
            ["plan"],
            "the running stage has no record yet",
          );
          assert.equal(loop.cleanup?.record, true);

          const ended = yield* ctx.orchestrator.streamDomainEvents.pipe(
            Stream.filter(
              (event) => event.type === "run.updated" && event.payload.status === "interrupted",
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.forkScoped({ startImmediately: true }),
          );
          assert.equal(yield* stepper.step(ctx.threadId), "acted", "the run is interrupted");
          yield* Fiber.join(ended);
          yield* ctx.worker.drain();
          for (let index = 0; index < 4; index += 1) yield* settle(ctx, stepper);

          loop = yield* requireLoop(ctx);
          const code = loop.stages.find((record) => record.stage === "code");
          assert.equal(code?.status, "interrupted");
          assert.equal(code?.usage?.uncachedInputTokens, 7_000);
          assert.equal(code?.usage?.cachedInputTokens, 2_000);
          assert.equal(code?.usage?.outputTokens, 900);
          assert.isUndefined(loop.cleanup, "nothing is owed any more");
        }),
    ),
);

const otherInstanceId = ProviderInstanceId.make("other-provider");

it.live(
  "the budget gate reads the windows of the provider a fallback sends the stage to, not the one configured",
  () =>
    withLoopHarness(
      "kodo-loop-gate-fallback",
      {
        // Code is configured on a provider that is not there, so its stage falls back to the thread's own.
        modeModels: { code: { instanceId: otherInstanceId, model: "big-model" } },
        replies: [REPLIES.plan, REPLIES.code],
      },
      (ctx) =>
        Effect.gen(function* () {
          const own = yield* Ref.make(50);
          const checkedAt = yield* nowIso;
          yield* startLoop(ctx, "Do it.", 2);
          const stepper = yield* ctx.newStepper(
            spendWith({
              modeModels: { code: { instanceId: otherInstanceId, model: "big-model" } },
              providers: Ref.get(own).pipe(
                Effect.map((used) => [
                  providerWithWindow(used, checkedAt),
                  { ...providerWithWindow(20, checkedAt), instanceId: otherInstanceId },
                ]),
              ),
            }),
          );
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(started);
          yield* Ref.set(own, 97);
          yield* endTurn(ctx);
          yield* settle(ctx, stepper);
          const loop = yield* requireLoop(ctx);
          assert.equal(loop.stopReason, "budget");
          assert.equal(loop.stopDetail, "Grok 5-hour window at 97%, limit 90%.");
          assert.equal((yield* Ref.get(ctx.state)).started.length, 1, "no Code stage started");
        }),
    ),
);

const providerAt = (usedPercent: number, checkedAtMs: number) =>
  providerWithWindow(usedPercent, DateTime.formatIso(DateTime.makeUnsafe(checkedAtMs)));

it.live(
  "the budget gate asks for a fresh reading, and acts on it rather than on the old one it held",
  () =>
    withLoopHarness("kodo-loop-gate-fresh", { replies: [REPLIES.plan] }, (ctx) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        // The provider holds an hour-old 40% until asked; asked, it reads 95%.
        const held = yield* Ref.make(providerAt(40, now - 3_600_000));
        const asked = yield* Ref.make(0);
        yield* startLoop(ctx, "Do it.", 2);
        const stepper = yield* ctx.newStepper(
          spendWith({
            providers: Ref.get(held).pipe(Effect.map((provider) => [provider])),
            refreshLimits: () =>
              Ref.update(asked, (count) => count + 1).pipe(
                Effect.andThen(Ref.set(held, providerAt(95, now))),
              ),
          }),
        );
        yield* settle(ctx, stepper);
        const loop = yield* requireLoop(ctx);
        assert.equal(loop.stopReason, "budget");
        assert.equal(loop.stopDetail, "Grok 5-hour window at 95%, limit 90%.");
        assert.equal(yield* Ref.get(asked), 1);
        assert.deepEqual((yield* Ref.get(ctx.state)).started, []);
      }),
    ),
);

it.live(
  "when no reading newer than the bound can be had, the loop goes on, says it could not check, and the note stays",
  () =>
    withLoopHarness(
      "kodo-loop-gate-stale",
      { replies: [REPLIES.plan, REPLIES.code, REPLIES.review, REPLIES.complete] },
      (ctx) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const held = yield* Ref.make(providerAt(40, now - 3_600_000));
          yield* startLoop(ctx, "Do it.", 1);
          const stepper = yield* ctx.newStepper(
            spendWith({
              providers: Ref.get(held).pipe(Effect.map((provider) => [provider])),
              refreshLimits: () => Effect.void,
            }),
          );
          const started = yield* watchTurnStart(ctx);
          yield* settle(ctx, stepper);
          yield* Fiber.join(started);
          let loop = yield* requireLoop(ctx);
          assert.deepEqual(loop.limitCheck?.unchecked, [{ round: 1, stage: "plan" }]);
          assert.equal(loop.limitCheck?.state, "stale");
          // The reading comes good for the rest of the loop: the earlier stage is still counted.
          yield* Ref.set(held, providerAt(10, yield* Clock.currentTimeMillis));
          yield* endTurn(ctx);
          yield* runToEnd(ctx, stepper);
          loop = yield* requireLoop(ctx);
          assert.equal(loop.status, "done");
          assert.deepEqual(loop.limitCheck?.unchecked, [{ round: 1, stage: "plan" }]);
        }),
    ),
);

it.live(
  "a stage's before and after limit readings appear only when they are two different readings",
  () =>
    withLoopHarness("kodo-loop-limit-change", { replies: [REPLIES.plan, REPLIES.code] }, (ctx) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const held = yield* Ref.make(providerAt(40, now - 5_000));
        yield* startLoop(ctx, "Do it.", 2);
        const stepper = yield* ctx.newStepper(
          spendWith({
            providers: Ref.get(held).pipe(Effect.map((provider) => [provider])),
            refreshLimits: () => Effect.void,
          }),
        );
        // The same reading before and after the plan stage: nothing is shown for it.
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        yield* endTurn(ctx);
        // A newer reading arrives before the code stage settles.
        yield* settle(ctx, stepper);
        const codeStarted = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(codeStarted);
        yield* Ref.set(held, providerAt(46, yield* Clock.currentTimeMillis));
        yield* endTurn(ctx);
        yield* settle(ctx, stepper);
        const loop = yield* requireLoop(ctx);
        const [plan, code] = loop.stages;
        assert.isUndefined(plan?.limits, "one reading seen twice says nothing");
        assert.deepEqual(code?.limits, [{ window: "5-hour", before: 40, after: 46 }]);
      }),
    ),
);

it.live(
  "looking again at a loop between stages does not ask the provider again within the half minute",
  () =>
    withLoopHarness("kodo-loop-gate-reuse", { startMode: "ask", replies: [REPLIES.plan] }, (ctx) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const asked = yield* Ref.make(0);
        // A reading that stays old however often the provider is asked: every look would ask again.
        const held = providerAt(40, now - 3_600_000);
        const service = serviceWith(ctx, { planApproval: "ask" });
        yield* service.start({
          threadId: ctx.threadId,
          commandId: CommandId.make("command:kodo-loop-gate-reuse:start"),
          requestMessageId: MessageId.make("message:kodo-loop-gate-reuse:start"),
          request: "Do it.",
          maxRounds: 2,
        });
        const stepper = yield* ctx.newStepper(
          spendWith({
            providers: Effect.succeed([held]),
            refreshLimits: () => Ref.update(asked, (count) => count + 1),
          }),
        );
        const started = yield* watchTurnStart(ctx);
        yield* settle(ctx, stepper);
        yield* Fiber.join(started);
        yield* endTurn(ctx);
        yield* settle(ctx, stepper);
        assert.equal((yield* requireLoop(ctx)).hold, "plan_approval");
        const before = yield* Ref.get(asked);
        for (let index = 0; index < 5; index += 1) {
          assert.equal(yield* stepper.step(ctx.threadId), "idle");
        }
        assert.equal(yield* Ref.get(asked), before, "the held loop's looks asked for nothing");
      }),
    ),
);

/** A second thread in the same project, as a loop's stage might start a loop on. */
const createSiblingThread = (ctx: Ctx, suffix: string, mode: "ask" | "code" = "code") =>
  Effect.gen(function* () {
    const threadId = ThreadId.make(`thread:${ctx.name}:${suffix}`);
    yield* ctx.orchestrator.dispatch({
      type: "thread.create",
      createdBy: "user",
      creationSource: "web",
      commandId: CommandId.make(`command:${ctx.name}:${suffix}:create`),
      threadId,
      projectId: ProjectId.make(`project:${ctx.name}`),
      title: suffix,
      modelSelection: selection("base-model"),
      runtimeMode: "full-access",
      interactionMode: mode,
      branch: null,
      worktreePath: ctx.cwd,
    });
    return threadId;
  });

const agentStart = (ctx: Ctx, target: ThreadId, sender: ThreadId | undefined, attempt: string) =>
  ctx.service.start({
    threadId: target,
    commandId: CommandId.make(`command:${ctx.name}:${attempt}`),
    requestMessageId: MessageId.make(`message:${ctx.name}:${attempt}`),
    request: "Do it.",
    requestMessage: {
      text: "/loop Do it.",
      createdBy: "agent",
      creationSource: "mcp",
      ...(sender === undefined ? {} : { senderThreadId: sender }),
    },
  });

it.live("a loop's own thread cannot start a loop, by the tool's route or by a /loop message", () =>
  withLoopHarness("kodo-loop-no-nesting", { startMode: "code", replies: [] }, (ctx) =>
    Effect.gen(function* () {
      const other = yield* createSiblingThread(ctx, "other");
      yield* startLoop(ctx, "Do it.", 2);
      // The tool's route.
      const refused = yield* agentStart(ctx, other, ctx.threadId, "nested").pipe(Effect.flip);
      assert.include(
        userFacingDispatchErrorMessage(refused) ?? String(refused),
        "cannot start another loop",
      );
      assert.isUndefined(
        (yield* ctx.orchestrator.getThreadProjection(other)).thread.kodoLoop,
        "nothing was started on the other thread",
      );
      // The `/loop` message route (an agent's send): the same refusal.
      const viaMessage = ctx.service.sendControl({
        type: "message.dispatch",
        commandId: CommandId.make("command:kodo-loop-no-nesting:message"),
        threadId: other,
        messageId: MessageId.make("message:kodo-loop-no-nesting:message"),
        senderThreadId: ctx.threadId,
        text: "/loop Do it too.",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "agent",
        creationSource: "mcp",
      } as OrchestrationV2Command);
      assert.isDefined(viaMessage);
      const messageRefusal = yield* viaMessage!.pipe(Effect.flip);
      assert.include(
        userFacingDispatchErrorMessage(messageRefusal) ?? String(messageRefusal),
        "cannot start another loop",
      );
      // A thread that runs no loop may start one on the same target.
      const free = yield* createSiblingThread(ctx, "free", "ask");
      yield* agentStart(ctx, other, free, "from-free");
      assert.equal(
        (yield* ctx.orchestrator.getThreadProjection(other)).thread.kodoLoop?.status,
        "active",
      );
    }),
  ),
);

it.live("an agent cannot start a new loop where the budget or a person stopped the last one", () =>
  withLoopHarness("kodo-loop-no-restart", { startMode: "code", replies: [] }, (ctx) =>
    Effect.gen(function* () {
      yield* startLoop(ctx, "Do it.", 2);
      yield* ctx.service.stop({
        threadId: ctx.threadId,
        commandId: CommandId.make("command:kodo-loop-no-restart:stop"),
      });
      const refused = yield* agentStart(ctx, ctx.threadId, undefined, "agent-restart").pipe(
        Effect.flip,
      );
      const text = userFacingDispatchErrorMessage(refused) ?? String(refused);
      assert.include(text, "a person stopped it");
      assert.include(text, "Ask the person");
      assert.equal((yield* requireLoop(ctx)).status, "stopped");
      // The person can start over, and an agent can once that loop ended some other way.
      yield* startLoop(ctx, "Do it again.", 1, "person-restart");
      assert.equal((yield* requireLoop(ctx)).status, "active");
    }),
  ),
);

export type { KodoLoop };
