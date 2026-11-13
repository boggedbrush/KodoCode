// What one ended loop leaves in the ledger, computed from the loop alone so the figures match the
// summary the thread shows. Pure; the table is in loopLedgerStore.ts.
import { type KodoLoop } from "@t3tools/contracts";
import { summarizeKodoLoop } from "@t3tools/shared/kodoLoopView";

import { isKodoLoopTerminal } from "../loop/loopState.ts";

export interface LoopLedgerRow {
  readonly loopId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly endedAt: string;
  /** The loop's own revision, so an older write never replaces a newer one. */
  readonly revision: number;
  /** Rounds that ran, counting the one the loop stopped in. */
  readonly rounds: number;
  readonly stopReason: string;
  /** Null when no stage reported tokens: unknown, not zero. */
  readonly tokens: number | null;
  /** `{ model: tokens }`; null with `tokens`. */
  readonly modelsJson: string | null;
  /** Compared stages' cost where they ran; set only on a priced loop. */
  readonly actualUsd: number | null;
  readonly referenceUsd: number | null;
  readonly referenceModel: string | null;
  /** A savings figure exists. */
  readonly priced: 0 | 1;
  /** Stages ran off the reference model but none could be priced: no figure, and not zero. */
  readonly unpriced: 0 | 1;
  /** Priced, but something is left out of the figure; implies `priced`. */
  readonly partial: 0 | 1;
}

/** The loop's ledger row, or undefined while it still runs. */
export function loopLedgerRow(input: {
  readonly loop: KodoLoop;
  readonly threadId: string;
  readonly projectId: string;
  readonly endedAt: string;
}): LoopLedgerRow | undefined {
  const { loop } = input;
  if (!isKodoLoopTerminal(loop.status) || loop.stopReason === undefined) return undefined;
  const summary = summarizeKodoLoop(loop);
  const { savings } = summary;
  const priced = savings.kind === "estimate";
  return {
    loopId: loop.loopId,
    threadId: input.threadId,
    projectId: input.projectId,
    endedAt: input.endedAt,
    revision: loop.revision,
    rounds: summary.roundsRun,
    stopReason: loop.stopReason,
    tokens: summary.tokens,
    modelsJson:
      summary.byModel.length === 0
        ? null
        : JSON.stringify(Object.fromEntries(summary.byModel.map((m) => [m.model, m.tokens]))),
    actualUsd: savings.kind === "estimate" ? savings.actualUsd : null,
    referenceUsd: savings.kind === "estimate" ? savings.referenceUsd : null,
    referenceModel:
      savings.kind === "estimate" || savings.kind === "unpriced" ? savings.referenceModel : null,
    priced: priced ? 1 : 0,
    unpriced: savings.kind === "unpriced" ? 1 : 0,
    // A compared stage without a price, partial usage anywhere, or a stage still to be recorded.
    partial:
      savings.kind === "estimate" &&
      (savings.unpricedStages.length > 0 || summary.partial || summary.pendingStage !== null)
        ? 1
        : 0,
  };
}
