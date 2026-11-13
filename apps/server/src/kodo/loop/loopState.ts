// The loop's state transitions as one pure reducer, so the orchestrator hook only calls it. Client
// operations (start, stop, approve, extend, retry-judge) apply to whatever state they find. Server
// operations carry the loop id and the revision their writer read, so a stale writer (a tick that
// observed the loop before a user stop landed) is refused instead of overwriting the newer state.
import {
  normalizeKodoInteractionMode,
  KODO_LOOP_MAX_ROUNDS,
  KODO_LOOP_REQUEST_MAX_CHARS,
  KODO_LOOP_STAGES_PER_ROUND,
  type KodoInteractionMode,
  type KodoLoop,
  type KodoLoopBudget,
  type KodoLoopSavings,
  type KodoLoopStage,
  type KodoLoopStageRecord,
  type KodoLoopStatus,
  type KodoLoopStopReason,
  type MessageId,
} from "@t3tools/contracts";

export type KodoLoopTerminalStatus = Extract<KodoLoopStatus, "done" | "stopped" | "failed">;

export const isKodoLoopTerminal = (status: KodoLoopStatus): status is KodoLoopTerminalStatus =>
  status === "done" || status === "stopped" || status === "failed";

/** The modes a stage runs in; a thread left in one of them by an ended loop is given its start mode back. */
export const KODO_LOOP_STAGE_MODES: ReadonlySet<KodoInteractionMode> = new Set([
  "plan",
  "code",
  "review",
]);

/** The thread mode a stage runs in. The judge reads in Review mode but answers in its own format. */
export function kodoLoopStageMode(
  stage: KodoLoopStage,
): Extract<KodoInteractionMode, "plan" | "code" | "review"> {
  return stage === "judge" ? "review" : stage;
}

/** The stage after `stage`, or null when a judge at `round` was the last round the loop may run. */
export function nextKodoLoopStage(
  position: { readonly round: number; readonly stage: KodoLoopStage },
  maxRounds: number,
): { readonly round: number; readonly stage: KodoLoopStage } | null {
  switch (position.stage) {
    case "plan":
      return { round: position.round, stage: "code" };
    case "code":
      return { round: position.round, stage: "review" };
    case "review":
      return { round: position.round, stage: "judge" };
    case "judge":
      return position.round >= maxRounds ? null : { round: position.round + 1, stage: "plan" };
  }
}

export type KodoLoopStartOp = {
  readonly type: "start";
  readonly loopId: string;
  readonly request: string;
  readonly requestMessageId: MessageId;
  readonly startMode: KodoInteractionMode;
  readonly maxRounds: number;
  readonly planApproval: "auto" | "ask";
  readonly budget: KodoLoopBudget;
  readonly baseline?: KodoLoop["baseline"];
};

/** What a person can do to a loop. None of these carry a revision: a stop must always win. */
export type KodoLoopClientOp =
  | KodoLoopStartOp
  | { readonly type: "stop"; readonly detail?: string }
  /** A person's message arrived on the thread: the loop ends, and the message is theirs to run. */
  | { readonly type: "user_message"; readonly restoredNow: boolean }
  /** A person's message was given the start mode back before it ran, so an ended loop owes none. */
  | { readonly type: "mode_restored" }
  | { readonly type: "approve" }
  | { readonly type: "extend"; readonly rounds: number }
  | { readonly type: "retry-judge" };

interface KodoLoopServerOpBase {
  readonly loopId: string;
  readonly expectedRevision: number;
}

/** What the loop worker writes as it observes the thread. */
export type KodoLoopServerOp =
  | (KodoLoopServerOpBase & { readonly type: "hold"; readonly hold: "runtime_request" })
  | (KodoLoopServerOpBase & { readonly type: "release" })
  | (KodoLoopServerOpBase & {
      readonly type: "limit-check";
      readonly limitCheck: Pick<NonNullable<KodoLoop["limitCheck"]>, "state" | "provider">;
    })
  | (KodoLoopServerOpBase & { readonly type: "cleaned" })
  | (KodoLoopServerOpBase & {
      readonly type: "record-stage";
      /** The stage that was running when the loop ended, once its run settled; absent when it had no run. */
      readonly record?: KodoLoopStageRecord;
      readonly savings?: KodoLoopSavings;
    })
  | (KodoLoopServerOpBase & {
      readonly type: "advance";
      /** The settled stage; the loop moves to its successor. */
      readonly record: KodoLoopStageRecord;
      /** Wait for a person to approve before the successor runs; only after a plan stage. */
      readonly hold?: "plan_approval";
      readonly savings?: KodoLoopSavings;
    })
  | (KodoLoopServerOpBase & {
      readonly type: "finish";
      readonly status: Extract<KodoLoopTerminalStatus, "done" | "stopped" | "failed">;
      readonly reason: KodoLoopStopReason;
      readonly detail?: string;
      readonly record?: KodoLoopStageRecord;
      readonly repriced?: ReadonlyArray<KodoLoopStageRecord>;
      readonly summary?: string;
      readonly savings?: KodoLoopSavings;
    });

export type KodoLoopOp = KodoLoopClientOp | KodoLoopServerOp;

/** What the reducer needs to know about the thread it does not own. */
export interface KodoLoopOpContext {
  /** The thread's interaction mode in any stored spelling, as it is when the operation applies. */
  readonly threadMode: string;
}

export type KodoLoopOpRefusal =
  | "invalid"
  | "no_loop"
  | "loop_exists"
  | "wrong_loop"
  | "stale_revision"
  | "not_active"
  | "not_held"
  | "not_resumable";

export type KodoLoopOpResult =
  | { readonly ok: true; readonly loop: KodoLoop }
  | { readonly ok: false; readonly reason: KodoLoopOpRefusal; readonly message: string };

const refuse = (reason: KodoLoopOpRefusal, message: string): KodoLoopOpResult => ({
  ok: false,
  reason,
  message,
});

const MAX_STAGE_RECORDS = KODO_LOOP_MAX_ROUNDS * KODO_LOOP_STAGES_PER_ROUND;

/** A settled stage replaces its own earlier record; the oldest records go first when the list is full. */
export function withRecord(
  stages: ReadonlyArray<KodoLoopStageRecord>,
  record: KodoLoopStageRecord,
): ReadonlyArray<KodoLoopStageRecord> {
  const next = [
    ...stages.filter(
      (entry) =>
        !(
          entry.round === record.round &&
          entry.stage === record.stage &&
          entry.messageId === record.messageId
        ),
    ),
    record,
  ];
  return next.slice(-MAX_STAGE_RECORDS);
}

/** The loop with its stop fields and hold cleared, as every resume does. */
function running(
  loop: KodoLoop,
): Omit<KodoLoop, "hold" | "stopReason" | "stopDetail" | "summary" | "cleanup"> {
  const {
    hold: _hold,
    stopReason: _reason,
    stopDetail: _detail,
    summary: _summary,
    cleanup: _cleanup,
    ...rest
  } = loop;
  return rest;
}

/**
 * What an ended loop still owes the thread: its own runs ended after a stop, the start mode back
 * when the loop left the thread in another stage mode (unless `restoredNow` already did), and the
 * record of the stage that was running when a person ended the loop, once its run settles. A mode
 * that is not a stage mode is one a person chose, and is left alone.
 */
function endCleanup(
  loop: KodoLoop,
  reason: KodoLoopStopReason,
  threadMode: string,
  restoredNow = false,
): Pick<KodoLoop, "cleanup"> {
  const mode = normalizeKodoInteractionMode(threadMode);
  const leftMode =
    !restoredNow && mode !== loop.startMode && KODO_LOOP_STAGE_MODES.has(mode) ? mode : undefined;
  const interrupt = reason === "user_stop";
  // A person's stop or message can land while a stage runs; a loop waiting for plan approval has none.
  const record =
    (reason === "user_stop" || reason === "user_message") &&
    !(loop.status === "held" && loop.hold === "plan_approval");
  if (leftMode === undefined && !interrupt && !record) return {};
  return {
    cleanup: {
      ...(leftMode === undefined ? {} : { leftMode }),
      ...(interrupt ? { interrupt: true as const } : {}),
      ...(record ? { record: true as const } : {}),
    },
  };
}

const FINISH_REASONS: Record<
  Extract<KodoLoopTerminalStatus, "done" | "stopped" | "failed">,
  ReadonlyArray<KodoLoopStopReason>
> = {
  done: ["complete"],
  failed: ["error", "verdict_invalid"],
  stopped: ["round_cap", "budget", "user_message", "provider_limit"],
};

function startLoop(current: KodoLoop | undefined, op: KodoLoopStartOp): KodoLoopOpResult {
  if (current !== undefined && !isKodoLoopTerminal(current.status)) {
    return refuse("loop_exists", "A loop is already running on this thread.");
  }
  const request = op.request.trim();
  if (request.length === 0) return refuse("invalid", "A loop needs a request.");
  if (request.length > KODO_LOOP_REQUEST_MAX_CHARS) {
    return refuse(
      "invalid",
      `A loop request is at most ${KODO_LOOP_REQUEST_MAX_CHARS} characters.`,
    );
  }
  if (!Number.isInteger(op.maxRounds) || op.maxRounds < 1 || op.maxRounds > KODO_LOOP_MAX_ROUNDS) {
    return refuse("invalid", `A loop runs between 1 and ${KODO_LOOP_MAX_ROUNDS} rounds.`);
  }
  return {
    ok: true,
    loop: {
      loopId: op.loopId,
      revision: 1,
      status: "active",
      round: 1,
      maxRounds: op.maxRounds,
      stage: "plan",
      request,
      requestMessageId: op.requestMessageId,
      startMode: op.startMode,
      planApproval: op.planApproval,
      budget: op.budget,
      baseline: op.baseline ?? {},
      stages: [],
    },
  };
}

function applyClientOp(
  loop: KodoLoop,
  op: Exclude<KodoLoopClientOp, KodoLoopStartOp>,
  context: KodoLoopOpContext,
): KodoLoopOpResult {
  switch (op.type) {
    case "stop":
      return isKodoLoopTerminal(loop.status)
        ? refuse("not_active", "The loop is not running.")
        : {
            ok: true,
            loop: {
              ...running(loop),
              revision: loop.revision + 1,
              status: "stopped",
              stopReason: "user_stop",
              ...(op.detail === undefined ? {} : { stopDetail: op.detail }),
              ...endCleanup(loop, "user_stop", context.threadMode),
            },
          };
    case "user_message":
      return isKodoLoopTerminal(loop.status)
        ? refuse("not_active", "The loop is not running.")
        : {
            ok: true,
            loop: {
              ...running(loop),
              revision: loop.revision + 1,
              status: "stopped",
              stopReason: "user_message",
              stopDetail: "A message was sent on the thread.",
              ...endCleanup(loop, "user_message", context.threadMode, op.restoredNow),
            },
          };
    case "mode_restored": {
      if (!isKodoLoopTerminal(loop.status) || loop.cleanup === undefined) {
        return refuse("not_active", "The loop has nothing to clean up.");
      }
      const { cleanup: _owed, ...rest } = loop;
      const { leftMode: _given, ...stillOwed } = loop.cleanup;
      return {
        ok: true,
        loop: {
          ...rest,
          revision: loop.revision + 1,
          ...(Object.keys(stillOwed).length === 0 ? {} : { cleanup: stillOwed }),
        },
      };
    }
    case "approve":
      return loop.status === "held" && loop.hold === "plan_approval"
        ? { ok: true, loop: { ...running(loop), revision: loop.revision + 1, status: "active" } }
        : refuse("not_held", "The loop is not waiting for a plan approval.");
    case "extend": {
      if (loop.status !== "stopped" || loop.stopReason !== "round_cap") {
        return refuse(
          "not_resumable",
          "Only a loop that stopped at its round limit can run more rounds.",
        );
      }
      if (
        !Number.isInteger(op.rounds) ||
        op.rounds < 1 ||
        loop.maxRounds + op.rounds > KODO_LOOP_MAX_ROUNDS
      ) {
        return refuse("invalid", `A loop runs at most ${KODO_LOOP_MAX_ROUNDS} rounds in all.`);
      }
      return {
        ok: true,
        loop: {
          ...running(loop),
          revision: loop.revision + 1,
          status: "active",
          maxRounds: loop.maxRounds + op.rounds,
          round: loop.round + 1,
          stage: "plan",
        },
      };
    }
    case "retry-judge":
      return loop.status === "failed" &&
        loop.stopReason === "verdict_invalid" &&
        loop.stage === "judge"
        ? { ok: true, loop: { ...running(loop), revision: loop.revision + 1, status: "active" } }
        : refuse(
            "not_resumable",
            "Only a loop whose judge answer was unreadable can retry the judge.",
          );
  }
}

function applyServerOp(
  loop: KodoLoop,
  op: KodoLoopServerOp,
  context: KodoLoopOpContext,
): KodoLoopOpResult {
  if (op.loopId !== loop.loopId) return refuse("wrong_loop", "That loop has been replaced.");
  if (op.expectedRevision !== loop.revision) {
    return refuse("stale_revision", "The loop changed since it was read.");
  }
  if (op.type === "cleaned") {
    if (!isKodoLoopTerminal(loop.status) || loop.cleanup === undefined) {
      return refuse("not_active", "The loop has nothing to clean up.");
    }
    const { cleanup: _owed, ...rest } = loop;
    return { ok: true, loop: { ...rest, revision: loop.revision + 1 } };
  }
  if (op.type === "record-stage") {
    if (!isKodoLoopTerminal(loop.status) || loop.cleanup?.record !== true) {
      return refuse("not_active", "The loop has no stage left to record.");
    }
    if (op.record !== undefined && (op.record.round !== loop.round || op.record.stage !== loop.stage)) {
      return refuse("invalid", "That stage is not the one the loop ended in.");
    }
    const { cleanup: _owed, ...rest } = loop;
    const { record: _recorded, ...stillOwed } = loop.cleanup;
    return {
      ok: true,
      loop: {
        ...rest,
        revision: loop.revision + 1,
        ...(Object.keys(stillOwed).length === 0 ? {} : { cleanup: stillOwed }),
        ...(op.record === undefined ? {} : { stages: withRecord(loop.stages, op.record) }),
        ...(op.savings === undefined ? {} : { savings: op.savings }),
      },
    };
  }
  if (isKodoLoopTerminal(loop.status)) return refuse("not_active", "The loop is not running.");
  const revision = loop.revision + 1;
  switch (op.type) {
    case "hold":
      return loop.status === "active"
        ? { ok: true, loop: { ...loop, revision, status: "held", hold: op.hold } }
        : refuse("not_active", "The loop is already waiting.");
    case "release":
      return loop.status === "held" && loop.hold === "runtime_request"
        ? { ok: true, loop: { ...running(loop), revision, status: "active" } }
        : refuse("not_held", "The loop is not waiting on a request.");
    case "limit-check": {
      // Sticky: each stage the gate could not check is kept, and a later good reading does not erase it.
      const unchecked = loop.limitCheck?.unchecked ?? [];
      const here = { round: loop.round, stage: loop.stage };
      const known = unchecked.some(
        (position) => position.round === here.round && position.stage === here.stage,
      );
      return {
        ok: true,
        loop: {
          ...loop,
          revision,
          limitCheck: {
            state: op.limitCheck.state,
            provider: op.limitCheck.provider,
            unchecked: known ? unchecked : [...unchecked, here].slice(-MAX_STAGE_RECORDS),
          },
        },
      };
    }
    case "advance": {
      if (loop.status === "held" && loop.hold !== "runtime_request") {
        return refuse("not_active", "The loop is waiting for a person.");
      }
      const { record } = op;
      if (record.round !== loop.round || record.stage !== loop.stage) {
        return refuse("invalid", "That stage is not the loop's current stage.");
      }
      if (op.hold !== undefined && record.stage !== "plan") {
        return refuse("invalid", "Only a plan can wait for approval.");
      }
      const next = nextKodoLoopStage(loop, loop.maxRounds);
      if (next === null) return refuse("invalid", "The last round has no stage after it.");
      return {
        ok: true,
        loop: {
          ...running(loop),
          revision,
          status: op.hold === undefined ? "active" : "held",
          ...(op.hold === undefined ? {} : { hold: op.hold }),
          round: next.round,
          stage: next.stage,
          stages: withRecord(loop.stages, record),
          ...(op.savings === undefined ? {} : { savings: op.savings }),
        },
      };
    }
    case "finish": {
      if (!FINISH_REASONS[op.status].includes(op.reason)) {
        return refuse("invalid", `A ${op.status} loop cannot end for ${op.reason}.`);
      }
      const { hold: _hold, stopReason: _reason, stopDetail: _detail, ...rest } = loop;
      return {
        ok: true,
        loop: {
          ...rest,
          revision,
          status: op.status,
          stopReason: op.reason,
          ...(op.detail === undefined ? {} : { stopDetail: op.detail }),
          ...endCleanup(loop, op.reason, context.threadMode),
          ...(op.record === undefined && op.repriced === undefined
            ? {}
            : {
                stages: [...(op.repriced ?? []), ...(op.record === undefined ? [] : [op.record])].reduce(
                  withRecord,
                  loop.stages,
                ),
              }),
          ...(op.summary === undefined ? {} : { summary: op.summary }),
          ...(op.savings === undefined ? {} : { savings: op.savings }),
        },
      };
    }
  }
}

/**
 * Applies one operation to the thread's loop (`undefined` when it has none). Returns the next loop
 * or says why the operation does not apply; it never throws and never mutates.
 */
export function applyKodoLoopOp(
  loop: KodoLoop | undefined,
  op: KodoLoopOp,
  context: KodoLoopOpContext = { threadMode: "" },
): KodoLoopOpResult {
  if (op.type === "start") return startLoop(loop, op);
  if (loop === undefined) return refuse("no_loop", "There is no loop on this thread.");
  return "expectedRevision" in op
    ? applyServerOp(loop, op, context)
    : applyClientOp(loop, op, context);
}
