import {
  KODO_REVIEW_LABEL,
  KODO_VERDICT_LABEL,
  readKodoReplyBlocks,
  type KodoReplyBlocks,
} from "@t3tools/shared/kodoLoopOutput";
import { normalizeKodoInteractionMode } from "@t3tools/contracts";

import { parseKodoLoopStageMessageId } from "./loopStageMarker.logic";

/** What a reply's structured blocks look like once read: the reply without them, and what they said. */
export type KodoInlineBlocks = KodoReplyBlocks;

const CACHE_LIMIT = 200;
const cache = new Map<string, KodoInlineBlocks>();

/** Which blocks the run that wrote a reply is asked for; any other, in any reply, is an example. */
export interface KodoInlineBlockStage {
  /** The run was in Review mode, where a reply ends with a `kodo-review` block. */
  readonly review: boolean;
  /** The run was a loop's judge stage, whose reply ends with a `kodo-verdict` block. */
  readonly verdict: boolean;
}

export const NO_KODO_BLOCK_STAGE: KodoInlineBlockStage = { review: false, verdict: false };

interface RunForBlocks {
  readonly id: string;
  readonly interactionMode?: string | undefined;
  readonly userMessageId?: string | undefined;
  readonly restartContinuationOfRunId?: string | undefined;
}

/**
 * Which blocks the run behind a reply is asked for. A review block counts in a Review-mode run, a
 * verdict block in a loop's judge stage (found through the restart chain that continued it); a
 * block an Ask, Plan or Code reply writes as an example stays in the text as written.
 */
export function kodoInlineBlockStage(
  runs: ReadonlyArray<RunForBlocks>,
  runId: string | null | undefined,
): KodoInlineBlockStage {
  if (runId === null || runId === undefined) return NO_KODO_BLOCK_STAGE;
  const run = runs.find((candidate) => candidate.id === runId);
  if (run === undefined) return NO_KODO_BLOCK_STAGE;
  let judge = false;
  let current: RunForBlocks | undefined = run;
  for (let hops = 0; current !== undefined && hops < 16; hops += 1) {
    if (current.userMessageId !== undefined) {
      const stage = parseKodoLoopStageMessageId(current.userMessageId);
      if (stage !== null) {
        judge = stage.stage === "judge";
        break;
      }
    }
    const previous: string | undefined = current.restartContinuationOfRunId;
    current = previous === undefined ? undefined : runs.find((entry) => entry.id === previous);
  }
  return {
    review:
      run.interactionMode !== undefined &&
      normalizeKodoInteractionMode(run.interactionMode) === "review",
    verdict: judge,
  };
}

const NOTHING = (text: string): KodoInlineBlocks => ({ text, review: null, verdict: null });

/**
 * A reply's valid trailing `kodo-review` and `kodo-verdict` blocks, for the stages that ask for them,
 * read once per text. A reply still streaming is not read (its block is not finished), a reply without
 * the labels is not scanned, and a block that is not valid or not the end of the reply stays as written.
 */
export function readKodoInlineBlocks(
  text: string,
  stage: KodoInlineBlockStage,
  streaming = false,
): KodoInlineBlocks {
  const review = stage.review && text.includes(KODO_REVIEW_LABEL);
  const verdict = stage.verdict && text.includes(KODO_VERDICT_LABEL);
  if (streaming || (!review && !verdict)) return NOTHING(text);
  const key = `${review ? "r" : "-"}${verdict ? "v" : "-"}\0${text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const read = readKodoReplyBlocks(text, { review, verdict });
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, read);
  return read;
}
