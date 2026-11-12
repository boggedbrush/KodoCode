// Turns a loop command into the thread's next loop state, or says why it cannot. Pure: the
// orchestrator reads the thread and its runs, asks this, and commits the answer, so the rules for
// starting, stopping and advancing a loop live in one place that a test can reach without a database.
import {
  normalizeKodoInteractionMode,
  type KodoLoop,
  type KodoLoopAdvanceStep,
  type KodoLoopControl,
  type KodoLoopStageRef,
  type OrchestrationV2Run,
} from "@t3tools/contracts";

import { kodoLoopStageMessageId } from "./loopMachine.ts";
import { applyKodoLoopOp, isKodoLoopTerminal, type KodoLoopOpResult } from "./loopState.ts";

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
    runOrdinal: runs.reduce((highest, run) => Math.max(highest, run.ordinal), 0),
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
      return applyKodoLoopOp(thread.kodoLoop, {
        type: "start",
        // The command id is unique per request and stable across replays.
        loopId: input.commandId,
        request: control.request,
        requestMessageId: control.requestMessageId,
        startMode: normalizeKodoInteractionMode(thread.interactionMode),
        maxRounds: control.maxRounds,
        planApproval: control.planApproval,
        budget: control.budget,
        baseline: startingPoint(runs),
      });
    }
    case "stop":
      return applyKodoLoopOp(thread.kodoLoop, {
        type: "stop",
        ...(control.detail === undefined ? {} : { detail: control.detail }),
      });
    case "approve":
      return applyKodoLoopOp(thread.kodoLoop, { type: "approve" });
    case "extend":
    case "retry-judge": {
      if (busy) return { ok: false, reason: "not_active", message: busyMessage };
      const result = applyKodoLoopOp(
        thread.kodoLoop,
        control.type === "extend"
          ? { type: "extend", rounds: control.rounds }
          : { type: "retry-judge" },
      );
      // Whatever a person ran on the thread in the meantime is not the resumed loop's interruption.
      return result.ok
        ? {
            ok: true,
            loop: {
              ...result.loop,
              baseline: { ...result.loop.baseline, runOrdinal: startingPoint(runs).runOrdinal },
            },
          }
        : result;
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
    case "advance":
      return applyKodoLoopOp(input.thread.kodoLoop, {
        ...base,
        type: "advance",
        record: step.record,
        ...(step.hold === undefined ? {} : { hold: step.hold }),
      });
    case "finish":
      return applyKodoLoopOp(input.thread.kodoLoop, {
        ...base,
        type: "finish",
        status: step.status,
        reason: step.reason,
        ...(step.detail === undefined ? {} : { detail: step.detail }),
        ...(step.record === undefined ? {} : { record: step.record }),
        ...(step.summary === undefined ? {} : { summary: step.summary }),
      });
  }
}

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
  if (loop.status !== "active" && loop.status !== "held") return undefined;
  return claim.loopId === loop.loopId &&
    claim.round === loop.round &&
    claim.stage === loop.stage &&
    message.messageId === kodoLoopStageMessageId(loop, loop.round, loop.stage)
    ? claim
    : undefined;
}
