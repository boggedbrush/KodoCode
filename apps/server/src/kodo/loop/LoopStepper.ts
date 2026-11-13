// One look at a thread's loop and the one thing to do about it. The stepper reads the thread, asks the
// pure `decideLoopStep`, and carries the answer out with deterministic command ids, so running it
// twice on the same state (a replayed event, a restart mid-loop) repeats nothing that already
// happened. Timing belongs to LoopWorker; tests call `step` directly.
import {
  CommandId,
  DEFAULT_KODO_MODE_MODELS,
  MessageId,
  PROVIDER_DISPLAY_NAMES,
  type KodoLoop,
  type KodoLoopAdvanceStep,
  type KodoLoopStageRecord,
  type KodoModeModels,
  type OrchestrationV2Run,
  type OrchestrationV2ServerCommand,
  type ServerProvider,
  type ServerProviderUsageLimits,
  type ThreadId,
} from "@t3tools/contracts";
import {
  fullestKodoLimitWindow,
  observedKodoLimitChange,
  type KodoLimitReading,
} from "@t3tools/shared/kodoLoopLimits";
import { parseKodoReview, parseKodoVerdict } from "@t3tools/shared/kodoLoopOutput";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
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
import { compactReview, compactVerdict } from "./loopRecord.ts";
import { readFreshKodoLimits } from "./limitReading.ts";
import {
  computeLoopSavings,
  priceStageUsage,
  repriceStageRecord,
  type PriceTokens,
} from "./loopSpend.ts";
import { isKodoLoopTerminal, withRecord } from "./loopState.ts";
import {
  decideLoopStep,
  loopRunIds,
  kodoLoopStageMessageId,
  stageRun,
  stageRunChain,
  type LoopBudgetObservation,
  type LoopObservation,
  type LoopRunOutput,
  type LoopRunView,
  type LoopStageOutcome,
} from "./loopMachine.ts";
import { summarizeStageUsage } from "./stageUsage.ts";

/** `waiting`: nothing to do yet, but a look is owed soon (a reply still streaming). */
export type LoopStepResult = "gone" | "idle" | "waiting" | "acted" | "failed";

/** What the loop reads to price its stages and check its budget; each is a cheap read, never a probe. */
export interface LoopSpendDeps {
  readonly providers: Effect.Effect<
    ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "usageLimits">>
  >;
  readonly modeModels: Effect.Effect<KodoModeModels>;
  /** One model's price for a set of tokens: null when it has none. */
  readonly price: PriceTokens;
  /** A provider instance's usage limits as it holds them now; the provider list's when absent. */
  readonly readLimits?: (instanceId: string) => Effect.Effect<ServerProviderUsageLimits | undefined>;
  /** Asks a provider instance to read its usage limits again, for the gate; the stepper bounds the wait. */
  readonly refreshLimits?: (
    instanceId: string,
  ) => Effect.Effect<unknown, { readonly _tag: string }>;
}

/** Without these, limit windows read as missing and nothing has a price: the loop still runs. */
const NO_SPEND: LoopSpendDeps = {
  providers: Effect.succeed([]),
  modeModels: Effect.succeed(DEFAULT_KODO_MODE_MODELS),
  price: () => Effect.succeed(null),
};

export interface LoopStepperDeps {
  readonly spend?: LoopSpendDeps;
  readonly orchestrator: Pick<
    Orchestrator.OrchestratorV2["Service"],
    "getThreadRecords" | "restartContinuationPending" | "kodoLoopStageSelection"
  >;
  readonly dispatch: (
    command: OrchestrationV2ServerCommand,
  ) => Effect.Effect<{ readonly replayed?: boolean | undefined }, { readonly _tag: string }>;
  /** How long a finished run's reply may stay marked as streaming before it is taken as final. */
  readonly streamingGraceMs?: number;
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
/** The same step may be tried this many times with nothing changing before the loop gives up on it. */
const MAX_STEP_REPEATS = 3;
const DEFAULT_STREAMING_GRACE_MS = 30_000;

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
  const spend = deps.spend ?? NO_SPEND;
  const streamingGraceMs = deps.streamingGraceMs ?? DEFAULT_STREAMING_GRACE_MS;
  const failures = yield* Ref.make(new Map<string, number>());
  /** How often the same step was tried with nothing changing, by loop, revision and step. */
  const repeats = yield* Ref.make(new Map<string, number>());
  /** When a finished run's reply was first seen still streaming. */
  const streamingSince = yield* Ref.make(new Map<string, number>());
  /** The limit windows as they were when a stage was sent, by stage message. Lost in a restart; then none is shown. */
  const limitsBefore = yield* Ref.make(
    new Map<string, { readonly instanceId: string; readonly reading: KodoLimitReading }>(),
  );

  /** A provider instance's limit windows from a reading of known age: it is asked to read again first. */
  const limitReading = (instanceId: string) =>
    readFreshKodoLimits({
      read:
        spend.readLimits?.(instanceId) ??
        spend.providers.pipe(
          Effect.map(
            (providers) =>
              providers.find((candidate) => candidate.instanceId === instanceId)?.usageLimits,
          ),
        ),
      refresh: spend.refreshLimits?.(instanceId),
    });

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

  /**
   * A run's final reply and plan artifact. Undefined while the reply is still streaming, unless
   * `final` says the run is long over and the reply is taken as it stands; a run with no reply at
   * all reads as an empty output, so a stage that finished silently can be told from one still writing.
   */
  const readOutput = Effect.fn("KodoLoopStepper.readOutput")(function* (
    threadId: ThreadId,
    runId: string,
    final: boolean,
  ) {
    const records = yield* orchestrator.getThreadRecords(threadId, ["messages", "plans"], {
      messageRunIds: [runId as OrchestrationV2Run["id"]],
      messageRoles: ["assistant"],
    });
    const messages = records.messages.filter((message) => message.runId === runId);
    if (!final && messages.some((message) => message.streaming)) return undefined;
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

  /** What an earlier stage said, read again from its run's reply: records keep only headlines. */
  const outputOfRecord = Effect.fn("KodoLoopStepper.outputOfRecord")(function* (
    threadId: ThreadId,
    record: KodoLoopStageRecord | undefined,
  ) {
    if (record?.runId == null) return undefined;
    return yield* readOutput(threadId, record.runId, true);
  });

  const planOf = (output: LoopRunOutput | undefined) =>
    (output?.planMarkdown?.trim() || output?.text?.trim() || "") as string;

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
    const earlier = loop.round - 1;
    // The last round's judge answer, in full, from the judge's own reply.
    const previousVerdict = Effect.fn("KodoLoopStepper.previousVerdict")(function* () {
      if (earlier < 1) return undefined;
      const output = yield* outputOfRecord(threadId, lastRecord(loop, earlier, "judge"));
      const parsed = parseKodoVerdict(output?.text ?? "");
      return parsed.ok ? parsed.value : undefined;
    });
    switch (loop.stage) {
      case "plan": {
        const history = loop.stages
          .filter((record) => record.stage === "judge" && record.conclusion !== undefined)
          .map((record) => `Round ${record.round}: ${record.conclusion ?? ""}`);
        const verdict = yield* previousVerdict();
        return buildLoopPlanPrompt({
          ...common,
          ...(verdict === undefined ? {} : { previous: { verdict, history } }),
        });
      }
      case "code": {
        const plan = planOf(yield* outputOfRecord(threadId, lastRecord(loop, loop.round, "plan")));
        const verdict = yield* previousVerdict();
        const priorReview =
          earlier < 1
            ? undefined
            : parseKodoReview(
                (yield* outputOfRecord(threadId, lastRecord(loop, earlier, "review")))?.text ?? "",
              );
        return buildLoopCodePrompt({
          ...common,
          plan,
          ...(verdict === undefined ? {} : { outstanding: verdict.outstanding }),
          ...(priorReview?.ok === true ? { openFindings: priorReview.value.findings } : {}),
        });
      }
      case "review": {
        const plan = planOf(yield* outputOfRecord(threadId, lastRecord(loop, loop.round, "plan")));
        const report = yield* outputOfRecord(threadId, lastRecord(loop, loop.round, "code"));
        return buildLoopReviewPrompt({
          ...common,
          plan,
          diff: yield* diffFor(threadId, loop, runs),
          codeReport: report?.text ?? "",
        });
      }
      case "judge": {
        const plan = planOf(yield* outputOfRecord(threadId, lastRecord(loop, loop.round, "plan")));
        const raw = yield* outputOfRecord(threadId, lastRecord(loop, loop.round, "review"));
        const parsed = parseKodoReview(raw?.text ?? "");
        return buildLoopJudgePrompt({
          ...common,
          plan,
          diff: yield* diffFor(threadId, loop, runs),
          review: parsed.ok
            ? { kind: "parsed", result: parsed.value }
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
    ...(outcome.conclusion === undefined ? {} : { conclusion: outcome.conclusion }),
    ...(outcome.verdict === undefined ? {} : { verdict: compactVerdict(outcome.verdict) }),
    ...(outcome.stage === "review" && outcome.reviewParse !== undefined
      ? { review: compactReview(outcome.review, outcome.reviewParse === "ok") }
      : {}),
  });

  const providerLabel = (
    provider: Pick<ServerProvider, "instanceId" | "driver"> | undefined,
    fallback: string,
  ) =>
    provider === undefined
      ? fallback
      : ((PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[provider.driver] ??
        provider.driver);

  interface BudgetGate {
    readonly budget: LoopBudgetObservation;
    /** The provider instance the next stage will run on, with its limit reading, to compare after it. */
    readonly next?: { readonly instanceId: string; readonly reading: KodoLimitReading };
  }

  /**
   * The budget gate's reading before the next stage: the fullest limit window of the provider that
   * stage will really run on (resolved by the dispatch's own rule, availability fallback included),
   * read fresh. Any failure to read is the gate's own error, which stops the loop.
   */
  const readGate = Effect.fn("KodoLoopStepper.readGate")(function* (
    threadId: ThreadId,
    loop: KodoLoop,
  ) {
    return yield* Effect.gen(function* (): Effect.fn.Return<BudgetGate, { readonly _tag: string }> {
      const providers = yield* spend.providers;
      const selection = yield* orchestrator.kodoLoopStageSelection(threadId, {
        loopId: loop.loopId,
        round: loop.round,
        stage: loop.stage,
      });
      const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
      const reading = yield* limitReading(selection.instanceId);
      const label = providerLabel(provider, selection.instanceId);
      const fullest = fullestKodoLimitWindow(reading);
      const next = { instanceId: selection.instanceId as string, reading };
      if (reading.state === "ok" && fullest !== null) {
        return {
          budget: {
            limit: {
              state: "ok",
              percent: fullest.usedPercent,
              provider: label,
              window: fullest.name,
            },
          },
          next,
        };
      }
      return {
        budget: {
          limit: { state: reading.state === "ok" ? "missing" : reading.state, provider: label },
        },
        next,
      };
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed({
          budget: {
            limit: { state: "unchecked" },
            error: errorText(Cause.squash(cause)).slice(0, 200),
          },
        } satisfies BudgetGate),
      ),
    );
  });

  /**
   * A settled stage's record with what it spent: the tokens of its provider turns, priced at the
   * models that ran and at the reference model, and the limit windows as they were before and after.
   * Also the loop's savings estimate with this stage included. Reads the thread's attempts (the whole
   * thread's, filtered here) and one provider-turn query, once per settled stage.
   */
  const settledStage = Effect.fn("KodoLoopStepper.settledStage")(function* (input: {
    readonly threadId: ThreadId;
    readonly loop: KodoLoop;
    readonly outcome: LoopStageOutcome;
    readonly run: OrchestrationV2Run | undefined;
    readonly chain: ReadonlySet<string>;
  }) {
    const { threadId, loop, outcome, run } = input;
    const base = recordFor(outcome, run);
    const modeModels = yield* spend.modeModels;
    const reference = modeModels.judge ?? modeModels.review ?? null;
    let record = base;
    if (run !== undefined) {
      const attempts = (yield* orchestrator.getThreadRecords(threadId, ["attempts"])).attempts;
      const attemptIds = attempts
        .filter((attempt) => input.chain.has(attempt.runId))
        .map((attempt) => attempt.id);
      const turns =
        attemptIds.length === 0
          ? []
          : (yield* orchestrator.getThreadRecords(threadId, ["providerTurns"], {
              providerTurnAttemptIds: attemptIds,
            })).providerTurns;
      const summary = summarizeStageUsage(turns, run.modelSelection.model);
      const usage =
        summary === undefined
          ? undefined
          : yield* priceStageUsage(summary, { reference, price: spend.price });
      const before = yield* Ref.modify(limitsBefore, (current) => {
        const held = current.get(outcome.messageId);
        current.delete(outcome.messageId);
        return [held, current] as const;
      });
      const limits =
        before !== undefined && before.instanceId === run.providerInstanceId
          ? observedKodoLimitChange(before.reading, yield* limitReading(run.providerInstanceId))
          : [];
      record = {
        ...base,
        ...(usage === undefined ? {} : { usage }),
        ...(limits.length === 0 ? {} : { limits: limits.slice(0, 6) }),
      };
    }
    const savings = computeLoopSavings(withRecord(loop.stages, record), reference);
    return { record, savings };
  });

  const bump = (map: Ref.Ref<Map<string, number>>, key: string) =>
    Ref.modify(map, (current) => {
      const next = (current.get(key) ?? 0) + 1;
      current.set(key, next);
      return [next, current] as const;
    });

  const stepThread = Effect.fn("KodoLoopStepper.stepThread")(function* (
    threadId: ThreadId,
  ): Effect.fn.Return<LoopStepResult, { readonly _tag: string }> {
    const first = (yield* orchestrator.getThreadRecords(threadId, [])).thread.kodoLoop;
    if (first === undefined) return "gone";
    // An ended loop that owes nothing costs no more than this one read.
    if (isKodoLoopTerminal(first.status) && first.cleanup === undefined) return "gone";
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
    // Only the run now carrying the current stage has a reply the loop reads, and only once it has completed.
    const outputs: Record<string, LoopRunOutput> = {};
    let waitingOnReply = false;
    if (!isKodoLoopTerminal(loop.status)) {
      const stageView = stageRun(views, messageId);
      if (stageView !== undefined && stageView.status === "completed") {
        const output = yield* readOutput(threadId, stageView.runId, false);
        if (output !== undefined) {
          outputs[stageView.runId] = output;
        } else {
          // A reply still marked as streaming on a finished run is taken as it stands after a while.
          const now = yield* Clock.currentTimeMillis;
          const since = yield* Ref.modify(streamingSince, (current) => {
            const seen = current.get(stageView.runId) ?? now;
            current.set(stageView.runId, seen);
            return [seen, current] as const;
          });
          if (now - since >= streamingGraceMs) {
            outputs[stageView.runId] = yield* readOutput(threadId, stageView.runId, true).pipe(
              Effect.map((final) => final ?? { text: null, planMarkdown: null }),
            );
          } else {
            waitingOnReply = true;
          }
        }
      }
    }
    // The budget is read between stages only: while a stage runs, a look costs no more than before.
    const betweenStages =
      !isKodoLoopTerminal(loop.status) && stageRun(views, messageId) === undefined;
    const gate: BudgetGate | undefined = betweenStages ? yield* readGate(threadId, loop) : undefined;
    const observation: LoopObservation = {
      threadMode: thread.interactionMode,
      runs: views,
      outputs,
      budget: gate?.budget ?? { limit: { state: "unchecked" } },
    };
    const decision = decideLoopStep(loop, observation);
    const id = (suffix: string) => CommandId.make(`kodo-loop:${loop.loopId}:${suffix}`);
    const advanceId = (type: string) => id(`rev${loop.revision}:${type}`);
    const runFor = (runId: string) => runs.find((run) => run.id === runId);
    const advance = (step: KodoLoopAdvanceStep) =>
      dispatch({
        type: "thread.kodo-loop.advance",
        commandId: advanceId(step.type),
        threadId,
        loopId: loop.loopId,
        expectedRevision: loop.revision,
        step,
      });

    const subject = (() => {
      switch (decision.kind) {
        case "set-mode":
        case "restore-mode":
          return `${decision.mode}:${String(thread.interactionMode)}`;
        case "interrupt":
          return decision.runId;
        case "dispatch":
          return decision.messageId;
        default:
          return "";
      }
    })();
    const stepKey = `${loop.loopId}:${loop.revision}:${decision.kind}:${subject}`;

    /** A stage settled for a loop that ends either way: a usage read that fails leaves it without usage. */
    const settleWithoutFailing = (outcome: LoopStageOutcome) =>
      settledStage({
        threadId,
        loop,
        outcome,
        run: runFor(outcome.runId),
        chain: stageRunChain(views, outcome.messageId),
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("kodo.loop.usage-unread", { threadId, cause }).pipe(
            Effect.map(() => ({
              record: recordFor(outcome, runFor(outcome.runId)),
              savings: undefined,
            })),
          ),
        ),
      );

    /**
     * Stages that settled with tokens but no price, priced again (the table may have loaded since), and
     * the savings estimate over the result. `byRecord` gives a record its re-priced version.
     */
    const repriceStages = Effect.fn("KodoLoopStepper.repriceStages")(function* (
      stages: ReadonlyArray<KodoLoopStageRecord>,
    ) {
      const modeModels = yield* spend.modeModels;
      const reference = modeModels.judge ?? modeModels.review ?? null;
      const changed = new Map<string, KodoLoopStageRecord>();
      for (const record of stages) {
        const next = yield* repriceStageRecord(record, { reference, price: spend.price });
        if (next !== undefined) changed.set(record.messageId, next);
      }
      const merged = stages.map((record) => changed.get(record.messageId) ?? record);
      return {
        records: [...changed.values()],
        savings: computeLoopSavings(merged, reference),
        byRecord: (record: KodoLoopStageRecord) => changed.get(record.messageId) ?? record,
      };
    });

    const act = Effect.gen(function* (): Effect.fn.Return<
      LoopStepResult,
      { readonly _tag: string }
    > {
      switch (decision.kind) {
        case "idle":
          return waitingOnReply ? "waiting" : "idle";
        case "set-mode": {
          // Each try is a new command: a replayed one would change nothing and be tried for ever.
          const attempt = yield* bump(repeats, stepKey);
          if (attempt > MAX_STEP_REPEATS) return yield* giveUp(attempt);
          yield* dispatch({
            type: "thread.interaction-mode.set",
            commandId: id(`rev${loop.revision}:${messageId}:mode:${attempt}`),
            threadId,
            interactionMode: decision.mode,
          });
          return "acted";
        }
        case "restore-mode": {
          const attempt = yield* bump(repeats, stepKey);
          if (attempt > MAX_STEP_REPEATS) return yield* giveUp(attempt);
          yield* dispatch({
            type: "thread.interaction-mode.set",
            commandId: id(`rev${loop.revision}:restore:${decision.mode}`),
            threadId,
            interactionMode: decision.mode,
          });
          return "acted";
        }
        case "dispatch": {
          const attempt = yield* bump(repeats, stepKey);
          if (attempt > MAX_STEP_REPEATS) return yield* giveUp(attempt);
          const text = yield* stagePrompt(threadId, loop, runs);
          if (gate?.next !== undefined) {
            yield* Ref.update(limitsBefore, (current) =>
              current.set(decision.messageId, gate.next!),
            );
          }
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
        case "interrupt": {
          const sent = yield* dispatch({
            type: "run.interrupt",
            commandId: id(`interrupt:${decision.runId}`),
            threadId,
            runId: decision.runId as OrchestrationV2Run["id"],
            reason: "The loop was stopped.",
          });
          // Already asked: the run ends when its provider stops it, and that event brings the next look.
          return sent.replayed === true ? "idle" : "acted";
        }
        case "hold":
          yield* advance({ type: "hold", hold: decision.hold });
          return "acted";
        case "release":
          yield* advance({ type: "release" });
          return "acted";
        case "limit-check":
          yield* advance({ type: "limit-check", limitCheck: decision.limitCheck });
          return "acted";
        case "cleaned":
          yield* advance({ type: "cleaned" });
          return "acted";
        case "advance": {
          // A usage read that fails is tried again on the next look; the loop does not go on unmeasured.
          const settled = yield* settledStage({
            threadId,
            loop,
            outcome: decision.outcome,
            run: runFor(decision.outcome.runId),
            chain: stageRunChain(views, decision.outcome.messageId),
          });
          yield* advance({
            type: "advance",
            record: settled.record,
            ...(decision.hold === undefined ? {} : { hold: decision.hold }),
            ...(settled.savings === undefined ? {} : { savings: settled.savings }),
          });
          return "acted";
        }
        case "finish": {
          // The loop ends either way, so a stage whose usage cannot be read is recorded without it.
          const settled =
            decision.outcome === undefined
              ? undefined
              : yield* settleWithoutFailing(decision.outcome);
          // The summary is built now: stages that had no price when they settled get one more try.
          const repriced = yield* repriceStages(
            settled === undefined ? loop.stages : withRecord(loop.stages, settled.record),
          );
          yield* advance({
            type: "finish",
            status: decision.status,
            reason: decision.reason,
            ...(decision.detail === undefined ? {} : { detail: decision.detail }),
            ...(settled === undefined ? {} : { record: settled.record }),
            ...(repriced.records.length === 0 ? {} : { repriced: repriced.records }),
            ...(repriced.savings === undefined ? {} : { savings: repriced.savings }),
          });
          return "acted";
        }
        case "record-stage": {
          const settled =
            decision.outcome === undefined
              ? undefined
              : yield* settleWithoutFailing(decision.outcome);
          const repriced = yield* repriceStages(
            settled === undefined ? loop.stages : withRecord(loop.stages, settled.record),
          );
          yield* advance({
            type: "record-stage",
            ...(settled === undefined ? {} : { record: repriced.byRecord(settled.record) }),
            ...(repriced.savings === undefined ? {} : { savings: repriced.savings }),
          });
          return "acted";
        }
      }
    });

    /** The same step was tried too often with nothing changing: end the loop (or its clean-up) rather than spin. */
    const giveUp = Effect.fn("KodoLoopStepper.giveUp")(function* (
      attempts: number,
    ): Effect.fn.Return<LoopStepResult, { readonly _tag: string }> {
      yield* Effect.logWarning("kodo.loop.no-progress", {
        threadId,
        step: decision.kind,
        attempts,
      });
      if (isKodoLoopTerminal(loop.status)) {
        yield* advance({ type: "cleaned" });
      } else {
        yield* advance({
          type: "finish",
          status: "failed",
          reason: "error",
          detail: noProgressDetail(loop, decision.kind, attempts),
        });
      }
      return "acted";
    });

    const key = `${loop.loopId}:${decision.kind}:${loop.round}:${loop.stage}:${loop.revision}`;
    return yield* act.pipe(
      Effect.tap(() => Ref.update(failures, (map) => (map.delete(key), map))),
      Effect.catch((cause) =>
        Effect.gen(function* () {
          const count = yield* bump(failures, key);
          yield* Effect.logWarning("kodo.loop.step-failed", {
            threadId,
            step: decision.kind,
            count,
            cause,
          });
          // A stage that cannot be sent (provider turned off, mode above a ceiling, refused by the
          // orchestrator) ends the loop instead of retrying forever; a stale write is simply read again.
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
          // A stage whose spend cannot be read is not followed by another: the loop stops, as it would
          // for any budget it cannot check.
          if (decision.kind === "advance" && count >= MAX_DISPATCH_FAILURES) {
            yield* dispatch({
              type: "thread.kodo-loop.advance",
              commandId: advanceId("finish-unmeasured"),
              threadId,
              loopId: loop.loopId,
              expectedRevision: loop.revision,
              step: {
                type: "finish",
                status: "stopped",
                reason: "budget",
                detail: `The budget could not be checked (${errorText(cause).slice(0, 160)}), so the loop stopped instead of spending unchecked.`,
              },
            }).pipe(Effect.ignore);
            return "acted" as const;
          }
          // A clean-up that keeps failing is given up on, so an ended loop never keeps the worker busy.
          if (
            isKodoLoopTerminal(loop.status) &&
            (decision.kind === "restore-mode" || decision.kind === "interrupt") &&
            count >= MAX_DISPATCH_FAILURES
          ) {
            yield* advance({ type: "cleaned" }).pipe(Effect.ignore);
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

const noProgressDetail = (loop: KodoLoop, step: string, attempts: number) => {
  const what: Record<string, string> = {
    "set-mode": "set the thread's mode",
    dispatch: `start the ${loop.stage} stage`,
  };
  return `The loop could not make progress: it tried to ${what[step] ?? step} ${attempts - 1} times and nothing changed.`;
};

export type KodoLoopStepper = Effect.Success<ReturnType<typeof makeKodoLoopStepper>>;
