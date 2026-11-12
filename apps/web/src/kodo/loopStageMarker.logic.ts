import type { KodoLoopStage } from "@t3tools/contracts";

import { KODO_LOOP_STAGE_LABEL } from "./loopCard.logic";

const STAGE_MESSAGE_ID = /^kodo-loop-(.+)-r(\d+)-(plan|code|review|judge)(?:-a(\d+))?$/;

export interface KodoLoopStageMessageRef {
  readonly round: number;
  readonly stage: KodoLoopStage;
  /** Zero for the first try of the stage; a retried judge is the next. */
  readonly attempt: number;
}

/**
 * The stage a message carries, read from its id: the server derives these ids for the loop's own
 * messages and refuses a client's message in that shape, so the id alone says it is a stage's.
 */
export function parseKodoLoopStageMessageId(id: string): KodoLoopStageMessageRef | null {
  const match = STAGE_MESSAGE_ID.exec(id);
  if (match === null) return null;
  return {
    round: Number(match[2]),
    stage: match[3] as KodoLoopStage,
    attempt: match[4] === undefined ? 0 : Number(match[4]),
  };
}

/** "Round 1 · Judge", with the try noted on a retried stage. */
export const kodoLoopStageMarkerLabel = (ref: KodoLoopStageMessageRef): string =>
  `Round ${ref.round} · ${KODO_LOOP_STAGE_LABEL[ref.stage]}${ref.attempt > 0 ? ` (try ${ref.attempt + 1})` : ""}`;

/** The mode colour a stage wears: the judge reads like a review. */
export const KODO_LOOP_STAGE_TEXT_CLASS: Record<KodoLoopStage, string> = {
  plan: "text-mode-plan",
  code: "text-mode-code",
  review: "text-mode-review",
  judge: "text-mode-review",
};
