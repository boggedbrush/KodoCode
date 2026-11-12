// One look at a thread's loop and the one thing to do about it. The stepper reads the thread, asks the
// pure `decideLoopStep`, and carries the answer out with deterministic command ids, so running it
// twice on the same state (a replayed event, a restart mid-loop) repeats nothing that already
// happened. Timing belongs to LoopWorker; tests call `step` directly.
import {
  CommandId,
  MessageId,
  type KodoLoop,
  type KodoLoopStageRecord,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
  type ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import {
  buildLoopCodePrompt,
  buildLoopJudgePrompt,
  buildLoopPlanPrompt,
  buildLoopReviewPrompt,
  type LoopDiffEvidence,
} from "./evidence.ts";
import { isKodoLoopTerminal } from "./loopState.ts";
import {
  decideLoopStep,
  loopRunIds,
  kodoLoopStageMessageId,
  type LoopObservation,
  type LoopRunOutput,
  type LoopRunView,
  type LoopStageOutcome,
} from "./loopMachine.ts";

export type LoopStepResult = "gone" | "idle" | "acted" | "failed";

export interface LoopStepperDeps {
  readonly orchestrator: Pick<
    Orchestrator.OrchestratorV2["Service"],
    "getThreadRecords" | "restartContinuationPending"
  >;
  readonly dispatch: (
    command: OrchestrationV2ServerCommand,
  ) => Effect.Effect<unknown, { readonly _tag: string }>;
  /** The loop's changes between two run ordinals; a project without checkpoints has none. */
  readonly readDiff: (input: {
    readonly threadId: ThreadId;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  }) => Effect.Effect<LoopDiffEvidence>;
}

const BAD_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "failed",
  "cancelled",
  "interrupted",
  "rolled_back",
]);
const MAX_DISPATCH_FAILURES = 3;

const iso = (value: DateTime.Utc) => DateTime.formatIso(value);

const errorText = (cause: unknown): string => {
  if (typeof cause === "string") return cause;
  if (typeof cause === "object" && cause !== null) {
    const record = cause as { readonly cause?: unknown; readonly message?: unknown };
    if (typeof record.cause === "string") return record.cause;
    if (record.cause !== undefined) return errorText(record.cause);
    if (typeof record.message === "string") return record.message;
  }
  return "The step could not be completed.";
};

export const makeKodoLoopStepper = Effect.fn("KodoLoopStepper.make")(function* (
  deps: LoopStepperDeps,
) {
  const { orchestrator, dispatch } = deps;
  const failures = yield* Ref.make(new Map<string, number>());

  /** Runs, with a restart-continuation check made before the read that would see its result. */
  const readRuns = Effect.fn("KodoLoopStepper.readRuns")(function* (
    threadId: ThreadId,
    loop: KodoLoop,
  ) {
    const checked = new Map<string, boolean>();
    let records = yield* orchestrator.getThreadRecords(threadId, ["runs"]);
    // The continuation run is made after the run it continues ends; checking whether one is still
    // owed and only then reading again means a run that looks abandoned is never one that is not.
    for (;;) {
      const views = records.runs.map(
        (run) =>
          ({
            runId: run.id as string,
            userMessageId: run.userMessageId as string,
            status: run.status,
            ...(run.restartContinuationOfRunId === undefined
              ? {}
              : { restartContinuationOfRunId: run.restartContinuationOfRunId as string }),
          }) satisfies LoopRunView,
      );
      const members = loopRunIds(loop, views);
      const unchecked = records.runs.filter(
        (run) => members.has(run.id) && BAD_RUN_STATUSES.has(run.status) && !checked.has(run.id),
      );
      if (unchecked.length === 0) break;
      for (const run of unchecked) {
        checked.set(run.id, yield* orchestrator.restartContinuationPending(run));
      }
      records = yield* orchestrator.getThreadRecords(threadId, ["runs"]);
    }
    return { thread: records.thread, runs: records.runs, pending: checked };
  });

  const viewsFor = Effect.fn("KodoLoopStepper.viewsFor")(function* (
    threadId: ThreadId,
    runs: ReadonlyArray<OrchestrationV2Run>,
    pending: ReadonlyMap<string, boolean>,
    memberIds: ReadonlySet<string>,
  ) {
    const failed = runs.filter((run) => run.status === "failed" && memberIds.has(run.id));
    const errors =
      failed.length === 0
        ? []
        : (yield* orchestrator.getThreadRecords(threadId, ["turnItems"], {
            turnItemRunIds: failed.map((run) => run.id),
            turnItemTypes: ["error"],
          })).turnItems;
    return runs.map((run): LoopRunView => {
      const failure = errors.findLast((item) => item.runId === run.id && item.type === "error");
      const detail =
        failure !== undefined && failure.type === "error" ? failure.failure : undefined;
      return {
        runId: run.id,
        userMessageId: run.userMessageId,
        status: run.status,
        ordinal: run.ordinal,
        ...(run.restartContinuationOfRunId === undefined
          ? {}
          : { restartContinuationOfRunId: run.restartContinuationOfRunId }),
        ...(pending.get(run.id) === true ? { continuationPending: true } : {}),
        ...(detail === undefined
          ? {}
          : { usageLimit: detail.class === "usage_limit", failureMessage: detail.message }),
      };
    });
  });

  /** A run's final reply and plan artifact; null while its reply is still streaming or absent. */
  const readOutput = Effect.fn("KodoLoopStepper.readOutput")(function* (
    threadId: ThreadId,
    runId: string,
  ) {
    const records = yield* orchestrator.getThreadRecords(threadId, ["messages", "plans"], {
      messageRunIds: [runId as OrchestrationV2Run["id"]],
      messageRoles: ["assistant"],
    });
    const messages = records.messages.filter((message) => message.runId === runId);
    if (messages.some((message) => message.streaming)) return undefined;
    const last = messages
      .toSorted(
        (a, b) =>
          DateTime.toEpochMillis(a.createdAt) - DateTime.toEpochMillis(b.createdAt) ||
          a.id.localeCompare(b.id),
      )
      .at(-1);
    const plan = records.plans.findLast(
      (candidate) =>
        candidate.runId === runId &&
        candidate.kind === "proposed_plan" &&
        candidate.status !== "superseded",
    );
    return {
      text: last?.text ?? null,
      planMarkdown: plan?.kind === "proposed_plan" ? plan.markdown : null,
    } satisfies LoopRunOutput;
  });

  const lastRecord = (loop: KodoLoop, round: number, stage: KodoLoopStageRecord["stage"]) =>
    loop.stages.findLast(
      (record) => record.round === round && record.stage === stage && record.status === "completed",
    );

  const diffFor = Effect.fn("KodoLoopStepper.diffFor")(function* (
    threadId: ThreadId,
    loop: KodoLoop,
    runs: ReadonlyArray<OrchestrationV2Run>,
  ) {
    const code = lastRecord(loop, loop.round, "code");
    const codeRun = runs.find((run) => run.id === code?.runId);
    if (codeRun === undefined) {
      return { kind: "unavailable", reason: "the code stage left no run to compare" } as const;
    }
    return yield* deps.readDiff({
      threadId,
      fromTurnCount: loop.baseline.checkpointTurnCount ?? 0,
      toTurnCount: codeRun.ordinal,
    });
  });

  const stagePrompt = Effect.fn("KodoLoopStepper.stagePrompt")(function* (
    threadId: ThreadId,
    loop: KodoLoop,
    runs: ReadonlyArray<OrchestrationV2Run>,
  ) {
    const common = { request: loop.request, round: loop.round, maxRounds: loop.maxRounds };
    const plan = lastRecord(loop, loop.round, "plan")?.planMarkdown ?? "";
    const earlier = loop.round - 1;
    const previousVerdict = earlier < 1 ? undefined : lastRecord(loop, earlier, "judge")?.verdict;
    switch (loop.stage) {
      case "plan": {
        const history = loop.stages
          .filter((record) => record.stage === "judge" && record.verdict !== undefined)
          .map((record) => `Round ${record.round}: ${record.verdict?.summary ?? ""}`);
        return buildLoopPlanPrompt({
          ...common,
          ...(previousVerdict === undefined
            ? {}
            : { previous: { verdict: previousVerdict, history } }),
        });
      }
      case "code": {
        const priorReview = earlier < 1 ? undefined : lastRecord(loop, earlier, "review")?.review;
        return buildLoopCodePrompt({
          ...common,
          plan,
          ...(previousVerdict === undefined ? {} : { outstanding: previousVerdict.outstanding }),
          ...(priorReview === undefined ? {} : { openFindings: priorReview.findings }),
        });
      }
      case "review": {
        const code = lastRecord(loop, loop.round, "code");
        const report = code?.runId == null ? undefined : yield* readOutput(threadId, code.runId);
        return buildLoopReviewPrompt({
          ...common,
          plan,
          diff: yield* diffFor(threadId, loop, runs),
          codeReport: report?.text ?? "",
        });
      }
      case "judge": {
        const review = lastRecord(loop, loop.round, "review");
        const raw =
          review?.review === undefined && review?.runId != null
            ? yield* readOutput(threadId, review.runId)
            : undefined;
        return buildLoopJudgePrompt({
          ...common,
          plan,
          diff: yield* diffFor(threadId, loop, runs),
          review:
            review?.review !== undefined
              ? { kind: "parsed", result: review.review }
              : { kind: "raw", text: raw?.text ?? "" },
        });
      }
    }
  });

  const recordFor = (
    outcome: LoopStageOutcome,
    run: OrchestrationV2Run | undefined,
  ): KodoLoopStageRecord => ({
    round: outcome.round,
    stage: outcome.stage,
    messageId: MessageId.make(outcome.messageId),
    runId: run?.id ?? null,
    status: outcome.status,
    model: run?.modelSelection ?? null,
    startedAt: iso(run?.startedAt ?? run?.requestedAt ?? DateTime.makeUnsafe(0)),
    completedAt: run?.completedAt == null ? null : iso(run.completedAt),
    ...(outcome.verdict === undefined ? {} : { verdict: outcome.verdict }),
    ...(outcome.review === undefined ? {} : { review: outcome.review }),
    ...(outcome.reviewParse === undefined ? {} : { reviewParse: outcome.reviewParse }),
    ...(outcome.planMarkdown === undefined ? {} : { planMarkdown: outcome.planMarkdown }),
  });

  const stepThread = Effect.fn("KodoLoopStepper.stepThread")(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<LoopStepResult, { readonly _tag: string }> {
    const first = (yield* orchestrator.getThreadRecords(threadId, [])).thread.kodoLoop;
    if (first === undefined) return "gone";
    const { thread, runs, pending } = yield* readRuns(threadId, first);
    const loop = thread.kodoLoop;
    if (loop === undefined) return "gone";
    const messageId = kodoLoopStageMessageId(loop, loop.round, loop.stage);
    const memberIds = loopRunIds(
      loop,
      runs.map((run) => ({
        runId: run.id,
        userMessageId: run.userMessageId,
        status: run.status,
        ...(run.restartContinuationOfRunId === undefined
          ? {}
          : { restartContinuationOfRunId: run.restartContinuationOfRunId }),
      })),
      messageId,
    );
    const views = yield* viewsFor(threadId, runs, pending, memberIds);
    // The output of the run now carrying the current stage, once it has completed.
    const outputs: Record<string, LoopRunOutput> = {};
    for (const view of views) {
      if (view.status !== "completed" || !memberIds.has(view.runId)) continue;
      const chainEnd = !views.some((other) => other.restartContinuationOfRunId === view.runId);
      if (!chainEnd) continue;
      const output = yield* readOutput(threadId, view.runId);
      if (output !== undefined && (output.text !== null || output.planMarkdown !== null)) {
        outputs[view.runId] = output;
      }
    }
    const observation: LoopObservation = {
      threadMode: thread.interactionMode,
      runs: views,
      outputs,
      // No budget data yet: a missing reading never stops a loop.
      usage: { costUsd: null, limitPercent: null },
    };
    const decision = decideLoopStep(loop, observation);
    const id = (suffix: string) => CommandId.make(`kodo-loop:${loop.loopId}:${suffix}`);
    const advanceId = (type: string) => id(`rev${loop.revision}:${type}`);
    const runFor = (runId: string) => runs.find((run) => run.id === runId);

    const act = Effect.gen(function* (): Effect.fn.Return<
      LoopStepResult,
      { readonly _tag: string }
    > {
      switch (decision.kind) {
        case "idle":
          // A loop that has ended and has nothing left to clean up needs no more looks.
          return isKodoLoopTerminal(loop.status) ? "gone" : "idle";
        case "set-mode":
          yield* dispatch({
            type: "thread.interaction-mode.set",
            commandId: id(`${messageId}:mode:from-${String(thread.interactionMode)}`),
            threadId,
            interactionMode: decision.mode,
          });
          return "acted";
        case "restore-mode":
          yield* dispatch({
            type: "thread.interaction-mode.set",
            commandId: id(`rev${loop.revision}:restore:${decision.mode}`),
            threadId,
            interactionMode: decision.mode,
          });
          return "acted";
        case "dispatch": {
          const text = yield* stagePrompt(threadId, loop, runs);
          yield* dispatch({
            type: "message.dispatch",
            commandId: id(`${decision.messageId}:dispatch`),
            threadId,
            messageId: MessageId.make(decision.messageId),
            text,
            attachments: [],
            freshContext: true,
            kodoLoopStage: { loopId: loop.loopId, round: decision.round, stage: decision.stage },
            dispatchMode: { type: "start_immediately" },
            createdBy: "agent",
            creationSource: "server",
          });
          return "acted";
        }
        case "interrupt":
          yield* dispatch({
            type: "run.interrupt",
            commandId: id(`interrupt:${decision.runId}`),
            threadId,
            runId: decision.runId as OrchestrationV2Run["id"],
            reason: "The loop was stopped.",
          });
          return "acted";
        case "hold":
          yield* dispatch({
            type: "thread.kodo-loop.advance",
            commandId: advanceId("hold"),
            threadId,
            loopId: loop.loopId,
            expectedRevision: loop.revision,
            step: { type: "hold", hold: decision.hold },
          });
          return "acted";
        case "release":
          yield* dispatch({
            type: "thread.kodo-loop.advance",
            commandId: advanceId("release"),
            threadId,
            loopId: loop.loopId,
            expectedRevision: loop.revision,
            step: { type: "release" },
          });
          return "acted";
        case "advance":
          yield* dispatch({
            type: "thread.kodo-loop.advance",
            commandId: advanceId("advance"),
            threadId,
            loopId: loop.loopId,
            expectedRevision: loop.revision,
            step: {
              type: "advance",
              record: recordFor(decision.outcome, runFor(decision.outcome.runId)),
              ...(decision.hold === undefined ? {} : { hold: decision.hold }),
            },
          });
          return "acted";
        case "finish":
          yield* dispatch({
            type: "thread.kodo-loop.advance",
            commandId: advanceId("finish"),
            threadId,
            loopId: loop.loopId,
            expectedRevision: loop.revision,
            step: {
              type: "finish",
              status: decision.status,
              reason: decision.reason,
              ...(decision.detail === undefined ? {} : { detail: decision.detail }),
              ...(decision.outcome === undefined
                ? {}
                : { record: recordFor(decision.outcome, runFor(decision.outcome.runId)) }),
            },
          });
          return "acted";
      }
    });

    const key = `${loop.loopId}:${decision.kind}:${loop.round}:${loop.stage}:${loop.revision}`;
    return yield* act.pipe(
      Effect.tap(() => Ref.update(failures, (map) => (map.delete(key), map))),
      Effect.catch((cause) =>
        Effect.gen(function* () {
          const count = yield* Ref.modify(failures, (map) => {
            const next = (map.get(key) ?? 0) + 1;
            map.set(key, next);
            return [next, map] as const;
          });
          yield* Effect.logWarning("kodo.loop.step-failed", {
            threadId,
            step: decision.kind,
            count,
            cause,
          });
          // A stage that cannot be sent (provider turned off, mode above a ceiling) ends the loop
          // instead of retrying forever; a stale write is simply read again.
          if (decision.kind === "dispatch" && count >= MAX_DISPATCH_FAILURES) {
            yield* dispatch({
              type: "thread.kodo-loop.advance",
              commandId: advanceId("finish-error"),
              threadId,
              loopId: loop.loopId,
              expectedRevision: loop.revision,
              step: {
                type: "finish",
                status: "failed",
                reason: "error",
                detail: errorText(cause).slice(0, 500),
              },
            }).pipe(Effect.ignore);
            return "acted" as const;
          }
          return "failed" as const;
        }),
      ),
    );
  });

  // A read that fails is looked at again on the next event or tick.
  const step = (threadId: ThreadId) =>
    stepThread(threadId).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("kodo.loop.read-failed", { threadId, cause }).pipe(
          Effect.as("failed" as const),
        ),
      ),
    );

  return { step };
});

export type KodoLoopStepper = Effect.Success<ReturnType<typeof makeKodoLoopStepper>>;
