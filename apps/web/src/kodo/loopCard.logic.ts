import {
  KODO_LOOP_MAX_ROUNDS,
  type KodoLoop,
  type KodoLoopStage,
  type KodoLoopStopReason,
} from "@t3tools/contracts";

const KODO_LOOP_STAGE_ORDER: ReadonlyArray<KodoLoopStage> = ["plan", "code", "review", "judge"];

export const KODO_LOOP_STAGE_LABEL: Record<KodoLoopStage, string> = {
  plan: "Plan",
  code: "Code",
  review: "Review",
  judge: "Judge",
};

export const isKodoLoopRunning = (loop: KodoLoop | undefined): boolean =>
  loop !== undefined && (loop.status === "active" || loop.status === "held");

export type KodoLoopStageState = "done" | "current" | "upcoming" | "stopped";

/** Where each stage of the loop's current round stands, for the strip. */
export function kodoLoopStageStrip(
  loop: KodoLoop,
): ReadonlyArray<{ readonly stage: KodoLoopStage; readonly state: KodoLoopStageState }> {
  const finished = new Set(
    loop.stages
      .filter((record) => record.round === loop.round && record.status === "completed")
      .map((record) => record.stage),
  );
  return KODO_LOOP_STAGE_ORDER.map((stage) => {
    if (loop.status === "done") return { stage, state: "done" as const };
    if (stage === loop.stage) {
      return {
        stage,
        state: isKodoLoopRunning(loop) ? ("current" as const) : ("stopped" as const),
      };
    }
    return { stage, state: finished.has(stage) ? ("done" as const) : ("upcoming" as const) };
  });
}

/** The card's heading: where a running loop is, or how a finished one ended. */
export function kodoLoopTitle(loop: KodoLoop): string {
  const place = `Round ${loop.round} of ${loop.maxRounds} · ${KODO_LOOP_STAGE_LABEL[loop.stage]}`;
  switch (loop.status) {
    case "active":
      return place;
    case "held":
      return loop.hold === "plan_approval" ? `${place} · Plan ready` : `${place} · Waiting`;
    case "done":
      return `Loop complete after ${loop.round} round${loop.round === 1 ? "" : "s"}`;
    case "stopped":
    case "failed":
      return `Loop stopped · ${place}`;
  }
}

/** Why the loop is held, in a sentence; null when it is not. */
export function kodoLoopHeldReason(loop: KodoLoop): string | null {
  if (loop.status !== "held") return null;
  return loop.hold === "plan_approval"
    ? "Approve the plan to continue, or stop the loop."
    : "A stage is waiting for a request to be answered. The loop continues once it is.";
}

const STOP_TEXT: Record<KodoLoopStopReason, (loop: KodoLoop) => string> = {
  complete: () => "The Judge found the request complete.",
  round_cap: (loop) =>
    `Reached the limit of ${loop.maxRounds} round${loop.maxRounds === 1 ? "" : "s"} with work still outstanding.`,
  budget: (loop) => loop.stopDetail ?? "A usage limit was reached.",
  user_stop: () => "You stopped the loop.",
  user_message: () => "Stopped because a message was sent on the thread.",
  error: (loop) => loop.stopDetail ?? "A stage failed.",
  verdict_invalid: () => "The Judge's answer could not be read, so the loop stopped.",
  provider_limit: (loop) => loop.stopDetail ?? "The provider's usage limit was reached.",
};

/** Why a finished loop ended; null while it runs. */
export function kodoLoopStopText(loop: KodoLoop): string | null {
  if (isKodoLoopRunning(loop) || loop.stopReason === undefined) return null;
  return STOP_TEXT[loop.stopReason](loop);
}

export interface KodoLoopOutstanding {
  /** The Judge's one-line conclusion of that round. */
  readonly summary: string | null;
  readonly items: ReadonlyArray<string>;
  /** Items the loop kept a count of but not a title for. */
  readonly more: number;
}

/**
 * What the Judge last said was left, for a loop that ended without finishing: the newest judged
 * round's outstanding items, as the loop's records kept them. Null while the loop runs, when it
 * is complete, or when no round was ever judged as incomplete.
 */
export function kodoLoopOutstanding(loop: KodoLoop): KodoLoopOutstanding | null {
  if (isKodoLoopRunning(loop) || loop.status === "done") return null;
  const judged = loop.stages.findLast(
    (record) => record.stage === "judge" && record.verdict !== undefined,
  );
  const verdict = judged?.verdict;
  if (verdict === undefined || verdict.complete || verdict.outstandingCount === 0) return null;
  const items = verdict.outstanding.map((item) => item.title);
  return {
    summary: judged?.conclusion ?? null,
    items,
    more: Math.max(0, verdict.outstandingCount - items.length),
  };
}

export const KODO_LOOP_CONTEXT_NOTE =
  "This thread now continues from the last stage's conversation, not the whole loop.";

export interface KodoLoopActions {
  readonly stop: boolean;
  readonly approve: boolean;
  readonly retryJudge: boolean;
  /** How many rounds "Run N more rounds" adds; 0 when it is not offered. */
  readonly extendBy: number;
}

/** What the person can do to the loop right now. */
export function kodoLoopActions(
  loop: KodoLoop,
  input: {
    readonly canOperate: boolean;
    readonly threadIdle: boolean;
    readonly extendRounds: number;
  },
): KodoLoopActions {
  const none = { stop: false, approve: false, retryJudge: false, extendBy: 0 };
  if (!input.canOperate) return none;
  if (isKodoLoopRunning(loop)) {
    return {
      ...none,
      stop: true,
      approve: loop.status === "held" && loop.hold === "plan_approval",
    };
  }
  if (!input.threadIdle) return none;
  const room = KODO_LOOP_MAX_ROUNDS - loop.maxRounds;
  return {
    ...none,
    retryJudge:
      loop.status === "failed" && loop.stopReason === "verdict_invalid" && loop.stage === "judge",
    extendBy:
      loop.status === "stopped" && loop.stopReason === "round_cap"
        ? Math.max(0, Math.min(input.extendRounds, room))
        : 0,
  };
}
