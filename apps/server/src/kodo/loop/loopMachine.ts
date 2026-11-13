// The loop's decision function: given the loop and what the thread looks like now, the one thing to
// do next. Pure and I/O-free, so a worker can call it on every tick without trusting memory: a
// crash between two steps is repaired because the next tick sees the same thread and decides again.
// Inputs are plain views of the thread's runs, not projection types.
import {
  normalizeKodoInteractionMode,
  type KodoInteractionMode,
  type KodoLoop,
  type KodoLoopStage,
  type KodoLoopStopReason,
  type KodoLoopVerdict,
  type KodoReviewResult,
} from "@t3tools/contracts";
import { parseKodoReview, parseKodoVerdict } from "@t3tools/shared/kodoLoopOutput";

import { conclusionOf, firstSayingLine } from "./loopRecord.ts";
import { limitTripDetail, loopTotals } from "./loopSpend.ts";
import {
  KODO_LOOP_STAGE_MODES,
  isKodoLoopTerminal,
  kodoLoopStageMode,
  type KodoLoopTerminalStatus,
} from "./loopState.ts";

export type LoopRunStatus =
  | "preparing"
  | "queued"
  | "starting"
  | "running"
  | "waiting"
  | "completed"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "rolled_back";

const ACTIVE_RUN_STATUSES: ReadonlySet<LoopRunStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);
const IN_FLIGHT_RUN_STATUSES: ReadonlySet<LoopRunStatus> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
]);

export interface LoopRunView {
  readonly runId: string;
  readonly userMessageId: string;
  /** Set on the run a server restart started in place of an interrupted one. */
  readonly restartContinuationOfRunId?: string | undefined;
  readonly status: LoopRunStatus;
  /** A failed run whose provider said a usage limit ended it. */
  readonly usageLimit?: boolean | undefined;
  /** One line saying why a failed run failed. */
  readonly failureMessage?: string | undefined;
  /**
   * A server restart ended this run and has not started its continuation yet: the continuation run
   * is created by an effect that runs after the restart commit, so for a while the run looks
   * abandoned. The loop waits through that gap instead of failing.
   */
  readonly continuationPending?: boolean | undefined;
}

export interface LoopRunOutput {
  /** The run's final assistant message; null when it ended without one. */
  readonly text: string | null;
  /** The run's proposed plan, when it produced one as an artifact. */
  readonly planMarkdown: string | null;
}

export interface LoopObservation {
  /** The thread's current interaction mode, in any stored spelling. */
  readonly threadMode: string;
  /** Every run on the thread. */
  readonly runs: ReadonlyArray<LoopRunView>;
  /**
   * The output of the run now carrying the current stage, once it has completed and its reply is
   * final (an empty output is a reply that never came). A completed run with no entry is one whose
   * message is still streaming: the loop waits, and the caller bounds that wait.
   */
  readonly outputs: Readonly<Record<string, LoopRunOutput>>;
  /**
   * What the budget gate saw, read only between stages (`unchecked` while a stage is in flight). Cost
   * and tokens come from the loop's own stage records; this carries what only the provider knows.
   */
  readonly budget: LoopBudgetObservation;
}

export type LoopLimitObservation =
  /** Not read: a stage is in flight, or the loop is not between stages. */
  | { readonly state: "unchecked" }
  /** The fullest limit window of the provider the next stage will use. */
  | {
      readonly state: "ok";
      readonly percent: number;
      readonly provider: string;
      readonly window: string;
    }
  /** The provider reports no windows, or only an out-of-date reading: the limit cannot be checked. */
  | { readonly state: "missing" | "stale"; readonly provider: string };

export interface LoopBudgetObservation {
  readonly limit: LoopLimitObservation;
  /** The gate itself could not be read. The loop stops rather than spend unchecked. */
  readonly error?: string;
}

/** A settled stage, without what only the worker knows (model, times, usage). */
export interface LoopStageOutcome {
  readonly round: number;
  readonly stage: KodoLoopStage;
  readonly messageId: string;
  readonly runId: string;
  readonly status: "completed" | "failed" | "interrupted";
  readonly verdict?: KodoLoopVerdict;
  readonly review?: KodoReviewResult;
  readonly reviewParse?: "ok" | "failed";
  readonly planMarkdown?: string;
  /** One line saying what the stage concluded. */
  readonly conclusion?: string;
}

export type LoopStep =
  | { readonly kind: "idle" }
  /** The thread is not in the stage's mode yet. */
  | { readonly kind: "set-mode"; readonly mode: KodoInteractionMode }
  /** Send the stage's message, as a fresh-context turn. */
  | {
      readonly kind: "dispatch";
      readonly round: number;
      readonly stage: KodoLoopStage;
      readonly messageId: string;
      readonly mode: KodoInteractionMode;
    }
  | { readonly kind: "hold"; readonly hold: "runtime_request" }
  | { readonly kind: "release" }
  /** Record that the budget gate could not see the limit windows before this stage. */
  | {
      readonly kind: "limit-check";
      readonly limitCheck: Pick<NonNullable<KodoLoop["limitCheck"]>, "state" | "provider">;
    }
  | {
      readonly kind: "advance";
      readonly outcome: LoopStageOutcome;
      readonly hold?: "plan_approval";
    }
  | {
      readonly kind: "finish";
      readonly status: KodoLoopTerminalStatus;
      readonly reason: KodoLoopStopReason;
      readonly detail?: string;
      readonly outcome?: LoopStageOutcome;
    }
  /** After a stop: end the loop's own run that is still spending. */
  | { readonly kind: "interrupt"; readonly runId: string }
  /**
   * After a person ended the loop: the stage that was running has settled, so record what it spent
   * (`outcome` absent: it never had a run).
   */
  | { readonly kind: "record-stage"; readonly outcome?: LoopStageOutcome }
  /** After the loop: put the thread back in the mode it started in. */
  | { readonly kind: "restore-mode"; readonly mode: KodoInteractionMode }
  /** After the loop: nothing is left to do, or what is left cannot be done. */
  | { readonly kind: "cleaned" };

const PLAN_MARKDOWN_MAX_CHARS = 20_000;

/**
 * The id of the message that carries a stage. It is derived, so a replayed dispatch is the same
 * message, and a stage run can be told apart from a person's message. A stage run again after its own
 * record exists (a retried judge) is a new attempt with its own id.
 */
export function kodoLoopStageMessageId(
  loop: Pick<KodoLoop, "loopId" | "stages">,
  round: number,
  stage: KodoLoopStage,
): string {
  const attempt = loop.stages.filter(
    (record) => record.round === round && record.stage === stage,
  ).length;
  return `kodo-loop-${loop.loopId}-r${round}-${stage}${attempt === 0 ? "" : `-a${attempt}`}`;
}

/**
 * The loop's own runs: those that carry one of its messages, and every run a server restart started
 * in place of one of them. A restart continuation has a message of its own, so it is followed by
 * link; judging by message alone would read it as the person interrupting.
 */
export function loopRunIds(
  loop: KodoLoop,
  runs: ReadonlyArray<LoopRunView>,
  currentMessageId: string = kodoLoopStageMessageId(loop, loop.round, loop.stage),
) {
  const messageIds = new Set([
    loop.requestMessageId as string,
    currentMessageId,
    ...loop.stages.map((record) => record.messageId as string),
  ]);
  const members = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const run of runs) {
      if (members.has(run.runId)) continue;
      const continues =
        run.restartContinuationOfRunId !== undefined && members.has(run.restartContinuationOfRunId);
      if (continues || messageIds.has(run.userMessageId)) {
        members.add(run.runId);
        grew = true;
      }
    }
  }
  return members;
}

/** The runs carrying a stage: the run for its message and every restart continuation after it. */
export function stageRunChain(
  runs: ReadonlyArray<LoopRunView>,
  messageId: string,
): ReadonlySet<string> {
  const chain = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const run of runs) {
      if (chain.has(run.runId)) continue;
      if (
        run.userMessageId === messageId ||
        (run.restartContinuationOfRunId !== undefined && chain.has(run.restartContinuationOfRunId))
      ) {
        chain.add(run.runId);
        grew = true;
      }
    }
  }
  return chain;
}

/** The run now carrying the stage: the end of the restart chain that starts at the stage's message. */
export function stageRun(
  runs: ReadonlyArray<LoopRunView>,
  messageId: string,
): LoopRunView | undefined {
  const chain = stageRunChain(runs, messageId);
  const continued = new Set(
    runs.flatMap((run) =>
      chain.has(run.runId) && run.restartContinuationOfRunId !== undefined
        ? [run.restartContinuationOfRunId]
        : [],
    ),
  );
  return runs.findLast((run) => chain.has(run.runId) && !continued.has(run.runId));
}

const trimmedOrNull = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
};

function failedOutcome(loop: KodoLoop, messageId: string, run: LoopRunView): LoopStageOutcome {
  return {
    round: loop.round,
    stage: loop.stage,
    messageId,
    runId: run.runId,
    status: "failed",
  };
}

/** What a stage run that ended badly means for the loop. */
function failedRunStep(loop: KodoLoop, messageId: string, run: LoopRunView): LoopStep {
  const outcome = failedOutcome(loop, messageId, run);
  if (run.status === "failed" && run.usageLimit === true) {
    return {
      kind: "finish",
      status: "stopped",
      reason: "provider_limit",
      detail: run.failureMessage ?? "The provider's usage limit was reached.",
      outcome,
    };
  }
  return {
    kind: "finish",
    status: "failed",
    reason: "error",
    detail:
      run.failureMessage ??
      `The ${loop.stage} stage ${run.status === "failed" ? "failed" : `was ${run.status.replace("_", " ")}`}.`,
    outcome,
  };
}

/**
 * What a stage run that completed means: the next stage, or the end. Null while its reply is still
 * streaming. A stage that is owed an answer and got none ends the loop with that said, so a run that
 * finished silently cannot leave it waiting for ever. The coding stage's report is not needed.
 */
function settledStep(
  loop: KodoLoop,
  messageId: string,
  run: LoopRunView,
  output: LoopRunOutput | undefined,
): LoopStep | null {
  if (output === undefined) return null;
  const base = {
    round: loop.round,
    stage: loop.stage,
    messageId,
    runId: run.runId,
    status: "completed" as const,
  };
  const text = trimmedOrNull(output.text);
  const silent = (reason: "error" | "verdict_invalid", detail: string): LoopStep => ({
    kind: "finish",
    status: "failed",
    reason,
    detail,
    outcome: { ...base, status: "failed" },
  });
  switch (loop.stage) {
    case "plan": {
      const plan = trimmedOrNull(output.planMarkdown) ?? text;
      if (plan === null) return silent("error", "The plan stage ended without a plan.");
      const conclusion = firstSayingLine(plan);
      return {
        kind: "advance",
        outcome: {
          ...base,
          planMarkdown: plan.slice(0, PLAN_MARKDOWN_MAX_CHARS),
          ...(conclusion === undefined ? {} : { conclusion }),
        },
        ...(loop.planApproval === "ask" ? { hold: "plan_approval" as const } : {}),
      };
    }
    case "code": {
      const conclusion = firstSayingLine(text);
      return {
        kind: "advance",
        outcome: { ...base, ...(conclusion === undefined ? {} : { conclusion }) },
      };
    }
    case "review": {
      if (text === null) return silent("error", "The review stage ended without a reply.");
      // A review that cannot be read does not stop the loop: the judge reads the raw text instead.
      const review = parseKodoReview(text);
      const conclusion = review.ok ? conclusionOf(review.value.summary) : firstSayingLine(text);
      return {
        kind: "advance",
        outcome: {
          ...(review.ok
            ? { ...base, review: review.value, reviewParse: "ok" as const }
            : { ...base, reviewParse: "failed" as const }),
          ...(conclusion === undefined ? {} : { conclusion }),
        },
      };
    }
    case "judge": {
      if (text === null) {
        return silent("verdict_invalid", "The judge's run ended without a reply.");
      }
      const verdict = parseKodoVerdict(text);
      if (!verdict.ok) return silent("verdict_invalid", verdict.detail);
      const conclusion = conclusionOf(verdict.value.summary);
      const outcome = {
        ...base,
        verdict: verdict.value,
        ...(conclusion === undefined ? {} : { conclusion }),
      };
      if (verdict.value.complete) {
        return { kind: "finish", status: "done", reason: "complete", outcome };
      }
      return loop.round >= loop.maxRounds
        ? { kind: "finish", status: "stopped", reason: "round_cap", outcome }
        : { kind: "advance", outcome };
    }
  }
}

const formatUsd = (value: number) => `$${value.toFixed(2)}`;

/**
 * The first budget limit the loop has reached, as a sentence; null when none, or when it cannot be
 * told. A cost cap counts only stages that have a price: an unpriced stage is not treated as free,
 * and the summary says it was left out.
 */
function budgetTrip(loop: KodoLoop, budget: LoopBudgetObservation): string | null {
  const limit = loop.budget.stopAtLimitPercent;
  if (limit !== undefined && budget.limit.state === "ok" && budget.limit.percent >= limit) {
    return limitTripDetail({
      provider: budget.limit.provider,
      window: budget.limit.window,
      percent: budget.limit.percent,
      limit,
    });
  }
  const totals = loopTotals(loop.stages);
  if (
    loop.budget.maxCostUsd !== undefined &&
    totals.costUsd !== null &&
    totals.costUsd >= loop.budget.maxCostUsd
  ) {
    return `The loop's cost reached ${formatUsd(totals.costUsd)}, at the ${formatUsd(loop.budget.maxCostUsd)} cap${totals.unpricedStages.length > 0 ? " (stages without a price are not counted)" : ""}.`;
  }
  if (loop.budget.maxTokens !== undefined && totals.tokens >= loop.budget.maxTokens) {
    return `The loop used ${totals.tokens.toLocaleString("en-US")} tokens (cache reads are not counted), at the ${loop.budget.maxTokens.toLocaleString("en-US")} cap.`;
  }
  return null;
}

/**
 * After the loop ended: end the loop's own runs a person's stop left running, wait until nothing runs
 * on the thread, then hand the mode back, unless a person already moved it. Whatever the loop owes is
 * recorded on it (`cleanup`), so this finds it again after a restart.
 */
function cleanupStep(
  loop: KodoLoop,
  observation: LoopObservation,
  members: ReadonlySet<string>,
): LoopStep {
  const owed = loop.cleanup;
  if (owed === undefined) return { kind: "idle" };
  if (owed.interrupt === true) {
    const spending = observation.runs.find(
      (run) => members.has(run.runId) && ACTIVE_RUN_STATUSES.has(run.status),
    );
    if (spending !== undefined) return { kind: "interrupt", runId: spending.runId };
  }
  if (owed.record === true) {
    // A person ended the loop while a stage may have been running: it is recorded once its run settles.
    const messageId = kodoLoopStageMessageId(loop, loop.round, loop.stage);
    const stage = stageRun(observation.runs, messageId);
    if (stage === undefined) return { kind: "record-stage" };
    if (ACTIVE_RUN_STATUSES.has(stage.status) || stage.continuationPending === true) {
      return { kind: "idle" };
    }
    return {
      kind: "record-stage",
      outcome: {
        round: loop.round,
        stage: loop.stage,
        messageId,
        runId: stage.runId,
        status: "interrupted",
      },
    };
  }
  // Another turn (a person's, or a wake) may be running in the mode the loop left; wait for it.
  if (observation.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))) return { kind: "idle" };
  const mode = normalizeKodoInteractionMode(observation.threadMode);
  if (
    owed.leftMode !== undefined &&
    mode === owed.leftMode &&
    mode !== loop.startMode &&
    KODO_LOOP_STAGE_MODES.has(mode)
  ) {
    return { kind: "restore-mode", mode: loop.startMode };
  }
  return { kind: "cleaned" };
}

/**
 * The next step, first match wins: a stage run that ended badly or an unreadable judge answer; a
 * complete verdict; the round cap; the budget; then holds and progress. A person's message ends the
 * loop in the orchestrator, so an ended loop only cleans up. Turns that are not a person's are
 * waited out before the next stage.
 */
export function decideLoopStep(loop: KodoLoop, observation: LoopObservation): LoopStep {
  const messageId = kodoLoopStageMessageId(loop, loop.round, loop.stage);
  const members = loopRunIds(loop, observation.runs, messageId);
  if (isKodoLoopTerminal(loop.status)) return cleanupStep(loop, observation, members);

  const run = stageRun(observation.runs, messageId);
  const settled =
    run?.status === "completed"
      ? settledStep(loop, messageId, run, observation.outputs[run.runId])
      : null;

  if (run !== undefined && !ACTIVE_RUN_STATUSES.has(run.status) && run.status !== "completed") {
    // A restart's continuation is created after the run is ended; until it exists, wait.
    if (run.continuationPending === true) return { kind: "idle" };
    return failedRunStep(loop, messageId, run);
  }
  if (settled?.kind === "finish") return settled;

  // Between stages is the only place the budget is read, so a stage in flight always finishes.
  if (run === undefined) {
    const { budget } = observation;
    if (budget.error !== undefined) {
      return {
        kind: "finish",
        status: "stopped",
        reason: "budget",
        detail: `The budget could not be checked (${budget.error}), so the loop stopped instead of spending unchecked.`,
      };
    }
    const detail = budgetTrip(loop, budget);
    if (detail !== null) return { kind: "finish", status: "stopped", reason: "budget", detail };
    // A limit that cannot be seen does not stop the loop, but the loop records, once per stage, that
    // it could not look. The record stays: a later good reading does not undo an unchecked stage.
    if (budget.limit.state === "missing" || budget.limit.state === "stale") {
      const recorded = loop.limitCheck?.unchecked?.some(
        (position) => position.round === loop.round && position.stage === loop.stage,
      );
      if (recorded !== true) {
        return {
          kind: "limit-check",
          limitCheck: { state: budget.limit.state, provider: budget.limit.provider },
        };
      }
    }
  }

  if (settled !== null) return settled;
  if (run?.status === "completed") return { kind: "idle" };

  if (loop.status === "held" && loop.hold === "plan_approval") return { kind: "idle" };

  if (run === undefined) {
    // A turn that is not the loop's (a wake the stage's work called for, a notice) finishes first, so
    // it never runs in a mode the loop is about to change.
    if (
      observation.runs.some(
        (other) => !members.has(other.runId) && ACTIVE_RUN_STATUSES.has(other.status),
      )
    ) {
      return { kind: "idle" };
    }
    const mode = kodoLoopStageMode(loop.stage);
    return normalizeKodoInteractionMode(observation.threadMode) === mode
      ? { kind: "dispatch", round: loop.round, stage: loop.stage, messageId, mode }
      : { kind: "set-mode", mode };
  }
  if (run.status === "waiting") {
    return loop.hold === "runtime_request"
      ? { kind: "idle" }
      : { kind: "hold", hold: "runtime_request" };
  }
  return IN_FLIGHT_RUN_STATUSES.has(run.status) && loop.hold === "runtime_request"
    ? { kind: "release" }
    : { kind: "idle" };
}
