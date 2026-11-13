// The loop savings ledger: what ended loops spent and saved, kept after their threads are deleted.
// Rows live in a Kodo-owned table (apps/server/src/kodo/ledger); this is only the read contract.
import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";

export const KODO_LOOP_LEDGER_WINDOW_DAYS = 30;
export const KODO_LOOP_LEDGER_MODELS_MAX = 20;
export const KODO_LOOP_LEDGER_REFERENCE_MODELS_MAX = 5;

/** What one source (loops, or sub-agent workers) adds to the totals above. */
export const KodoLoopLedgerSource = Schema.Struct({
  tokens: NonNegativeInt,
  savedUsd: Schema.Number,
  /** Units of this source with a savings figure. */
  priced: NonNegativeInt,
});
export type KodoLoopLedgerSource = typeof KodoLoopLedgerSource.Type;

/**
 * Every figure but `loops`, `rounds` and `workers` adds loops and sub-agent workers together, so
 * `pricedLoops` and its neighbours count units of either; `split` says how much each contributed.
 */
export const KodoLoopLedgerTotals = Schema.Struct({
  loops: NonNegativeInt,
  rounds: NonNegativeInt,
  /** Workers a lead delegated to, one per worker thread. */
  workers: NonNegativeInt,
  split: Schema.Struct({ loop: KodoLoopLedgerSource, subAgents: KodoLoopLedgerSource }),
  /** Loops with a savings figure: stages on a cheaper model were priced on both sides. */
  pricedLoops: NonNegativeInt,
  /** Priced loops whose figure leaves something out (an unpriced stage, partial usage), so it is "at least". */
  partialLoops: NonNegativeInt,
  /** Loops that ran stages off the reference model but could not be priced. Never counted as zero savings. */
  unpricedLoops: NonNegativeInt,
  /** Cost of the compared stages where they ran, over priced loops only. */
  actualUsd: Schema.Number,
  /** The same tokens at the reference model's rates, over priced loops only. */
  referenceUsd: Schema.Number,
  /** `referenceUsd - actualUsd`; negative when the reference model would have cost less. */
  savedUsd: Schema.Number,
  /** Tokens the providers reported, as the loop's token cap counts them. */
  tokens: NonNegativeInt,
  /** Loops where no stage reported any tokens. */
  noUsageLoops: NonNegativeInt,
  tokensByModel: Schema.Array(
    Schema.Struct({ model: Schema.String, tokens: NonNegativeInt }),
  ).check(Schema.isMaxLength(KODO_LOOP_LEDGER_MODELS_MAX)),
  referenceModels: Schema.Array(Schema.String).check(
    Schema.isMaxLength(KODO_LOOP_LEDGER_REFERENCE_MODELS_MAX),
  ),
});
export type KodoLoopLedgerTotals = typeof KodoLoopLedgerTotals.Type;

export const KodoLoopLedgerSummary = Schema.Struct({
  readAt: IsoDateTime,
  allTime: KodoLoopLedgerTotals,
  /** Loops that ended in the 30 days before `readAt`. */
  last30Days: KodoLoopLedgerTotals,
});
export type KodoLoopLedgerSummary = typeof KodoLoopLedgerSummary.Type;

export class KodoLoopLedgerReadError extends Schema.TaggedError<KodoLoopLedgerReadError>()(
  "KodoLoopLedgerReadError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "The loop savings ledger could not be read.";
  }
}
