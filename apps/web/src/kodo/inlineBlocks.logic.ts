import type { KodoLoopVerdict, KodoReviewResult } from "@t3tools/contracts";
import {
  KODO_REVIEW_LABEL,
  parseKodoReview,
  parseKodoVerdict,
  stripKodoBlock,
} from "@t3tools/shared/kodoLoopOutput";

const KODO_VERDICT_LABEL = "kodo-verdict";

/** What a reply's structured blocks look like once read: the reply without them, and what they said. */
export interface KodoInlineBlocks {
  readonly text: string;
  readonly review: KodoReviewResult | null;
  readonly verdict: KodoLoopVerdict | null;
}

const NO_BLOCKS = (text: string): KodoInlineBlocks => ({ text, review: null, verdict: null });
const CACHE_LIMIT = 200;
const cache = new Map<string, KodoInlineBlocks>();

/**
 * A reply's valid `kodo-review` and `kodo-verdict` blocks, read once per text. A reply without the
 * labels is not scanned at all; a block that is not valid stays in the text as written.
 */
export function readKodoInlineBlocks(text: string): KodoInlineBlocks {
  if (!text.includes(KODO_REVIEW_LABEL) && !text.includes(KODO_VERDICT_LABEL)) {
    return NO_BLOCKS(text);
  }
  const cached = cache.get(text);
  if (cached !== undefined) return cached;
  const review = parseKodoReview(text);
  const verdict = parseKodoVerdict(text);
  let remaining = text;
  if (review.ok) remaining = stripKodoBlock(remaining, KODO_REVIEW_LABEL);
  if (verdict.ok) remaining = stripKodoBlock(remaining, KODO_VERDICT_LABEL);
  const read: KodoInlineBlocks = {
    // A reply that is only a block keeps the text empty; the list stands in for it.
    text: review.ok || verdict.ok ? remaining : text,
    review: review.ok ? review.value : null,
    verdict: verdict.ok ? verdict.value : null,
  };
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(text, read);
  return read;
}
