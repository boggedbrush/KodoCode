// Turns a loop command into the thread's next loop state, or says why it cannot. Pure: the
// orchestrator reads the thread and its runs, asks this, and commits the answer, so the rules for
// starting, stopping and advancing a loop live in one place that a test can reach without a database.
import {
  normalizeKodoInteractionMode,
  type KodoInteractionMode,
  type KodoLoop,
  type KodoLoopAdvanceStep,
  type KodoLoopControl,
  type KodoLoopStageRef,
  type OrchestrationV2Run,
} from "@t3tools/contracts";

import { kodoInteractionModeRank } from "../interactionMode.ts";
import { kodoLoopStageMessageId, loopRunIds } from "./loopMachine.ts";
import {
  KODO_LOOP_STAGE_MODES,
  applyKodoLoopOp,
  isKodoLoopTerminal,
  kodoLoopStageMode,
  type KodoLoopOpResult,
} from "./loopState.ts";

/** Stage messages carry this prefix in their id, which only the orchestrator lets the loop use. */
const KODO_LOOP_MESSAGE_ID_PREFIX = "kodo-loop-";

const UNSETTLED_RUN_STATUSES: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export interface KodoLoopThreadView {
  readonly kodoLoop?: KodoLoop | undefined;
  /** The thread's interaction mode in any stored spelling. */
  readonly interactionMode: string;
}

export type KodoLoopRunView = Pick<OrchestrationV2Run, "status" | "ordinal" | "checkpointId">;

const busyMessage = "A turn is running on this thread. Wait for it to finish or stop it first.";

function startingPoint(runs: ReadonlyArray<KodoLoopRunView>) {
  return {
    checkpointTurnCount: runs.reduce(
      (highest, run) =>
        run.status === "completed" && run.checkpointId !== null
          ? Math.max(highest, run.ordinal)
          : highest,
      0,
    ),
  };
}

/** A person's operation on the loop, applied to the thread as it is now. */
export function decideKodoLoopControl(input: {
  readonly commandId: string;
  readonly control: KodoLoopControl;
  readonly thread: KodoLoopThreadView;
  readonly runs: ReadonlyArray<KodoLoopRunView>;
}): KodoLoopOpResult {
  const { control, thread, runs } = input;
  const busy = runs.some((run) => UNSETTLED_RUN_STATUSES.has(run.status));
  switch (control.type) {
    case "start": {
      if (thread.kodoLoop !== undefined && !isKodoLoopTerminal(thread.kodoLoop.status)) {
        return {
          ok: false,
          reason: "loop_exists",
          message: "A loop is already running on this thread. Stop it first with /loop stop.",
        };
      }
      if (busy) return { ok: false, reason: "not_active", message: busyMessage };
      const threadMode = normalizeKodoInteractionMode(thread.interactionMode);
      return applyKodoLoopOp(thread.kodoLoop, {
        type: "start",
        // The command id is unique per request and stable across replays.
        loopId: input.commandId,
        request: control.request,
        requestMessageId: control.requestMessageId,
        // A loop that just ended and has not handed the mode back yet left the thread in a stage
        // mode; the person's own mode is the one that loop started in.
        startMode:
          thread.kodoLoop?.cleanup?.leftMode === threadMode
            ? thread.kodoLoop.startMode
            : threadMode,
        maxRounds: control.maxRounds,
        planApproval: control.planApproval,
        budget: control.budget,
        baseline: startingPoint(runs),
      });
    }
    case "stop":
      return applyKodoLoopOp(
        thread.kodoLoop,
        {
          type: "stop",
          ...(control.detail === undefined ? {} : { detail: control.detail }),
        },
        { threadMode: thread.interactionMode },
      );
    case "approve":
      return applyKodoLoopOp(thread.kodoLoop, { type: "approve" });
    case "extend":
    case "retry-judge": {
      if (busy) return { ok: false, reason: "not_active", message: busyMessage };
      return applyKodoLoopOp(
        thread.kodoLoop,
        control.type === "extend"
          ? { type: "extend", rounds: control.rounds }
          : { type: "retry-judge" },
      );
    }
  }
}

/** The loop worker's write, applied only if the loop is still the one and at the revision it read. */
export function decideKodoLoopAdvance(input: {
  readonly loopId: string;
  readonly expectedRevision: number;
  readonly step: KodoLoopAdvanceStep;
  readonly thread: KodoLoopThreadView;
}): KodoLoopOpResult {
  const { step, loopId, expectedRevision } = input;
  const base = { loopId, expectedRevision };
  switch (step.type) {
    case "hold":
      return applyKodoLoopOp(input.thread.kodoLoop, { ...base, type: "hold", hold: step.hold });
    case "release":
      return applyKodoLoopOp(input.thread.kodoLoop, { ...base, type: "release" });
    case "limit-check":
      return applyKodoLoopOp(input.thread.kodoLoop, {
        ...base,
        type: "limit-check",
        limitCheck: step.limitCheck,
      });
    case "cleaned":
      return applyKodoLoopOp(input.thread.kodoLoop, { ...base, type: "cleaned" });
    case "record-stage":
      return applyKodoLoopOp(input.thread.kodoLoop, {
        ...base,
        type: "record-stage",
        ...(step.record === undefined ? {} : { record: step.record }),
        ...(step.savings === undefined ? {} : { savings: step.savings }),
      });
    case "advance":
      return applyKodoLoopOp(input.thread.kodoLoop, {
        ...base,
        type: "advance",
        record: step.record,
        ...(step.hold === undefined ? {} : { hold: step.hold }),
        ...(step.savings === undefined ? {} : { savings: step.savings }),
      });
    case "finish":
      return applyKodoLoopOp(
        input.thread.kodoLoop,
        {
          ...base,
          type: "finish",
          status: step.status,
          reason: step.reason,
          ...(step.detail === undefined ? {} : { detail: step.detail }),
          ...(step.record === undefined ? {} : { record: step.record }),
          ...(step.repriced === undefined ? {} : { repriced: step.repriced }),
          ...(step.summary === undefined ? {} : { summary: step.summary }),
          ...(step.savings === undefined ? {} : { savings: step.savings }),
        },
        { threadMode: input.thread.interactionMode },
      );
  }
}

const isRunning = (loop: KodoLoop | undefined): boolean =>
  loop !== undefined && (loop.status === "active" || loop.status === "held");

/**
 * The stage a message really carries: its claim is honoured only when it names the active loop's
 * current stage and is the message that stage derives. A client's claim to be a stage never reaches a
 * model slot, since a loop that is not running at that stage has no message with that id.
 */
export function validKodoLoopStage(
  loop: KodoLoop | undefined,
  message: { readonly messageId: string; readonly kodoLoopStage?: KodoLoopStageRef | undefined },
): KodoLoopStageRef | undefined {
  const claim = message.kodoLoopStage;
  if (claim === undefined || loop === undefined) return undefined;
  if (loop.status !== "active") return undefined;
  return claim.loopId === loop.loopId &&
    claim.round === loop.round &&
    claim.stage === loop.stage &&
    message.messageId === kodoLoopStageMessageId(loop, loop.round, loop.stage)
    ? claim
    : undefined;
}

/** The fields of a message that say it is not a person's: the server's own continuations, wakes and notices. */
export interface KodoLoopMessageOrigin {
  readonly notification?: unknown;
  readonly delegatedCompletion?: unknown;
  readonly idleCompaction?: unknown;
  readonly restartContinuationOfRunId?: unknown;
  readonly usageLimitContinuationOfRunId?: unknown;
  readonly manualContinuationOfRunId?: unknown;
}

/**
 * Whether the server sent this message itself: a delegated task's wake, a monitor's notice, idle
 * compaction, or the continuation of a run after a restart, a usage limit or a person's resume.
 * Everything else is a person's, or another agent's or a scheduled task's, and is treated the same.
 */
export const isKodoLoopAutomatedMessage = (message: KodoLoopMessageOrigin): boolean =>
  message.notification !== undefined ||
  message.delegatedCompletion !== undefined ||
  message.idleCompaction !== undefined ||
  message.restartContinuationOfRunId !== undefined ||
  message.usageLimitContinuationOfRunId !== undefined ||
  message.manualContinuationOfRunId !== undefined;

export type KodoLoopMessageDecision =
  | { readonly type: "pass" }
  /** The loop's own stage message, accepted. */
  | { readonly type: "stage"; readonly stage: KodoLoopStageRef }
  | { readonly type: "refuse"; readonly message: string }
  /** A person's message ended the loop; `setMode` is the mode the thread goes back to before the message's run exists. */
  | {
      readonly type: "stop";
      readonly loop: KodoLoop;
      readonly setMode: KodoInteractionMode | undefined;
    }
  /** The loop already ended and left a stage mode; a message that starts its own run takes the start mode. */
  | {
      readonly type: "restore";
      readonly loop: KodoLoop;
      readonly setMode: KodoInteractionMode;
    };

/**
 * What a message on the thread means for its loop, decided in the commit that accepts it. A stage
 * message must come from the loop itself (current stage, derived id, thread in that stage's mode;
 * the id prefix is reserved). Any other message ends the loop as `user_message`, taking the start
 * mode back first when it starts a run; a steer leaves the mode to the clean-up after its run.
 */
export function decideKodoLoopMessage(input: {
  readonly loop: KodoLoop | undefined;
  readonly threadMode: string;
  readonly message: KodoLoopMessageOrigin & {
    readonly messageId: string;
    readonly kodoLoopStage?: KodoLoopStageRef | undefined;
  };
  /** The message joins the run in progress instead of starting one. */
  readonly steersActiveRun: boolean;
}): KodoLoopMessageDecision {
  const { loop, message } = input;
  const mode = normalizeKodoInteractionMode(input.threadMode);
  if (
    message.messageId.startsWith(KODO_LOOP_MESSAGE_ID_PREFIX) ||
    message.kodoLoopStage !== undefined
  ) {
    const stage = validKodoLoopStage(loop, message);
    if (stage === undefined) {
      return {
        type: "refuse",
        message: "That message belongs to a loop stage, and only the running loop can send it.",
      };
    }
    const wanted = kodoLoopStageMode(stage.stage);
    if (mode !== wanted) {
      return {
        type: "refuse",
        message: `The loop's ${stage.stage} stage needs the thread in ${wanted} mode, and it is in ${mode} mode.`,
      };
    }
    return { type: "stage", stage };
  }
  if (loop === undefined || isKodoLoopAutomatedMessage(message)) return { type: "pass" };
  const leftInStageMode = (candidate: KodoLoop) =>
    mode !== candidate.startMode && KODO_LOOP_STAGE_MODES.has(mode);
  if (loop.status === "active" || loop.status === "held") {
    const setMode = !input.steersActiveRun && leftInStageMode(loop) ? loop.startMode : undefined;
    const ended = applyKodoLoopOp(
      loop,
      { type: "user_message", restoredNow: setMode !== undefined },
      { threadMode: input.threadMode },
    );
    return ended.ok ? { type: "stop", loop: ended.loop, setMode } : { type: "pass" };
  }
  if (
    loop.cleanup?.leftMode !== undefined &&
    loop.cleanup.leftMode === mode &&
    !input.steersActiveRun
  ) {
    const restored = applyKodoLoopOp(loop, { type: "mode_restored" });
    return restored.ok && mode !== loop.startMode
      ? { type: "restore", loop: restored.loop, setMode: loop.startMode }
      : { type: "pass" };
  }
  return { type: "pass" };
}

/**
 * Why a command that changes the thread's mode is refused while a loop runs: the loop sets the mode
 * for each stage, and a change from anyone else would put a stage in the wrong one. The loop's own
 * commands carry its id in theirs.
 */
export function kodoLoopModeSetRefusal(
  loop: KodoLoop | undefined,
  command: { readonly commandId: string },
): string | undefined {
  if (loop === undefined || !isRunning(loop)) return undefined;
  return command.commandId.startsWith(`kodo-loop:${loop.loopId}:`)
    ? undefined
    : "A loop is running on this thread and sets the mode for each stage. Stop it with /loop stop to change the mode.";
}

/**
 * Why a sender whose interaction-mode limit is below Code cannot start, extend, approve or retry a
 * loop: its stages run in Code mode and write to the workspace, which the sender could not do itself.
 */
export function kodoLoopLimitRefusal(
  command: { readonly type: string; readonly control?: KodoLoopControl },
  limit: { readonly interactionMode: string } | undefined,
): string | undefined {
  if (limit === undefined || command.type !== "thread.kodo-loop.control") return undefined;
  const type = command.control?.type;
  if (type === undefined || type === "stop") return undefined;
  const limited = normalizeKodoInteractionMode(limit.interactionMode);
  if (kodoInteractionModeRank(limited) >= kodoInteractionModeRank("code")) return undefined;
  return `A loop runs a coding stage that changes files, and this sender is limited to ${limited} mode, so it cannot start, extend, approve or retry one. Nothing was started.`;
}

/**
 * Whether a continuation (after a restart, or a usage limit's auto-resume) of `source` must not run:
 * `source` is one of an ended loop's own runs, and that loop was stopped, so running on would carry
 * a stage past its end. A run the person's message took over is the person's, and may continue.
 */
export function kodoLoopBlocksContinuation(
  loop: KodoLoop | undefined,
  runs: ReadonlyArray<{
    readonly id: string;
    readonly userMessageId: string;
    readonly restartContinuationOfRunId?: string | undefined;
  }>,
  source: { readonly id: string },
): boolean {
  if (
    loop === undefined ||
    !isKodoLoopTerminal(loop.status) ||
    loop.stopReason === "user_message"
  ) {
    return false;
  }
  const views = runs.map((run) => ({
    runId: run.id,
    userMessageId: run.userMessageId,
    status: "completed" as const,
    ...(run.restartContinuationOfRunId === undefined
      ? {}
      : { restartContinuationOfRunId: run.restartContinuationOfRunId }),
  }));
  return loopRunIds(loop, views).has(source.id);
}

/**
 * Why a launch whose first message is `/loop <request>` cannot start the loop, decided before anything
 * is created. An agent's thread below Code can never run the loop's coding stage. And a new worktree is
 * made in the background while the loop's first stage would already be running, in the project's own
 * folder, so the loop has to be started once the thread has its workspace.
 */
export function kodoLoopLaunchRefusal(input: {
  readonly createdBy: string;
  readonly interactionMode: string;
  readonly workspaceStrategy: { readonly type: string };
  readonly initialMessageText: string | undefined;
}): string | undefined {
  if (input.initialMessageText === undefined) return undefined;
  if (!/^\/loop(?=\s|$)/iu.test(input.initialMessageText.trim())) return undefined;
  const argument = input.initialMessageText.trim().slice("/loop".length).trim().toLowerCase();
  if (argument === "stop" || argument === "status" || argument === "") return undefined;
  if (input.workspaceStrategy.type === "worktree") {
    return "A loop cannot start while its new worktree is still being set up, because its first stage would run in the project folder instead. Create the thread first, then send /loop in it.";
  }
  if (input.createdBy !== "agent") return undefined;
  const limited = normalizeKodoInteractionMode(input.interactionMode);
  return kodoInteractionModeRank(limited) >= kodoInteractionModeRank("code")
    ? undefined
    : `A loop runs a coding stage that changes files, and this thread is limited to ${limited} mode, so it cannot start one. Nothing was created.`;
}
