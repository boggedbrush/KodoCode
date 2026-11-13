// What a lead and its workers spent, and what delegating saved against running the workers' tokens
// on the lead's model. The pricing and the token counting are the loop's (stageUsage, loopSpend), so a
// delegation's figures read the same as a loop's: a model with no price is "no price", never zero, and
// a floor says it is one. Pure apart from the price call the caller supplies.
import type {
  KodoDelegationSavings,
  KodoDelegationSpend,
  KodoDelegationUsage,
  KodoLoopStageUsage,
  ModelSelection,
  ThreadId,
} from "@t3tools/contracts";
import { kodoLoopStageTokens } from "@t3tools/shared/kodoLoopView";
import * as Effect from "effect/Effect";

import { type PriceTokens, priceStageUsage } from "../loop/loopSpend.ts";
import { type StageUsageSummary, summarizeStageUsage } from "../loop/stageUsage.ts";

type Turns = Parameters<typeof summarizeStageUsage>[0];

export interface DelegationSide {
  readonly threadId: ThreadId;
  /** The model the thread is set to: the lead's own, or the one its worker was given. */
  readonly model: ModelSelection;
  readonly turns: Turns;
}

export interface PricedWorker {
  readonly threadId: ThreadId;
  readonly usage: KodoLoopStageUsage | undefined;
  /** The worker ran on the lead's own model: nothing to compare. */
  readonly sameModel: boolean;
  /** Counted tokens per model that ran, for the ledger; a turn that named several models is left out. */
  readonly modelTokens: ReadonlyArray<{ readonly model: string; readonly tokens: number }>;
}

const sameSelection = (a: ModelSelection, b: ModelSelection) =>
  a.instanceId === b.instanceId && a.model === b.model;

const priced = Effect.fn("KodoDelegationUsage.priceSide")(function* (
  side: DelegationSide,
  reference: ModelSelection | null,
  price: PriceTokens,
) {
  const summary: StageUsageSummary | undefined = summarizeStageUsage(side.turns, side.model.model);
  return summary === undefined
    ? undefined
    : {
        summary,
        usage: yield* priceStageUsage(summary, { reference, price }),
      };
});

/** One worker's usage, priced at the models that ran and at the lead's model. */
export const priceWorker = Effect.fn("KodoDelegationUsage.priceWorker")(function* (
  worker: DelegationSide,
  lead: ModelSelection,
  price: PriceTokens,
) {
  const sameModel = sameSelection(worker.model, lead);
  const result = yield* priced(worker, sameModel ? null : lead, price);
  return {
    threadId: worker.threadId,
    sameModel,
    usage: result?.usage,
    modelTokens:
      result?.summary.byModel.flatMap((group) =>
        group.model === null
          ? []
          : [
              {
                model: group.model,
                tokens:
                  group.totals.uncachedInputTokens +
                  group.totals.cacheCreationTokens +
                  group.totals.outputTokens,
              },
            ],
      ) ?? [],
  } satisfies PricedWorker;
});

const spendOf = (usages: ReadonlyArray<KodoLoopStageUsage>): KodoDelegationSpend | undefined => {
  if (usages.length === 0) return undefined;
  let cost = 0;
  let unpriced = false;
  let complete = true;
  let tokens = 0;
  for (const usage of usages) {
    tokens += kodoLoopStageTokens(usage);
    complete &&= usage.complete;
    if (usage.costUsd === undefined) unpriced = true;
    else cost += usage.costUsd;
  }
  const anyPriced = usages.some((usage) => usage.costUsd !== undefined);
  return {
    tokens,
    ...(anyPriced ? { costUsd: cost } : {}),
    // A cost with an unpriced worker left out is a floor, like a count with a silent turn.
    complete: complete && !unpriced,
  };
};

function delegationSavings(
  workers: ReadonlyArray<PricedWorker>,
  reference: ModelSelection,
): KodoDelegationSavings | undefined {
  let actualUsd = 0;
  let referenceUsd = 0;
  let pricedWorkers = 0;
  let unpricedWorkers = 0;
  let sameModelWorkers = 0;
  for (const worker of workers) {
    if (worker.sameModel) {
      sameModelWorkers += 1;
      continue;
    }
    // A worker that reported nothing has no figure either way, and is counted with the unreported.
    if (worker.usage === undefined) continue;
    if (worker.usage.costUsd === undefined || worker.usage.referenceCostUsd === undefined) {
      unpricedWorkers += 1;
      continue;
    }
    actualUsd += worker.usage.costUsd;
    referenceUsd += worker.usage.referenceCostUsd;
    pricedWorkers += 1;
  }
  if (pricedWorkers + unpricedWorkers + sameModelWorkers === 0) return undefined;
  const savedUsd = referenceUsd - actualUsd;
  return {
    actualUsd,
    referenceUsd,
    savedUsd,
    savedPct: referenceUsd > 0 ? (savedUsd / referenceUsd) * 100 : 0,
    referenceModel: reference,
    pricedWorkers,
    unpricedWorkers,
    sameModelWorkers,
  };
}

export const summarizeDelegation = Effect.fn("KodoDelegationUsage.summarize")(function* (input: {
  readonly lead: DelegationSide;
  readonly workers: ReadonlyArray<DelegationSide>;
  readonly price: PriceTokens;
}) {
  const leadUsage = (yield* priced(input.lead, null, input.price))?.usage;
  const pricedWorkers = yield* Effect.forEach(input.workers, (worker) =>
    priceWorker(worker, input.lead.model, input.price),
  );
  const reported = pricedWorkers.flatMap((worker) =>
    worker.usage === undefined ? [] : [worker.usage],
  );
  const lead = leadUsage === undefined ? undefined : spendOf([leadUsage]);
  const workers = spendOf(reported);
  const savings = delegationSavings(pricedWorkers, input.lead.model);
  return {
    threadId: input.lead.threadId,
    ...(lead === undefined ? {} : { lead }),
    ...(workers === undefined ? {} : { workers }),
    workerCount: input.workers.length,
    unreportedWorkers: pricedWorkers.length - reported.length,
    ...(savings === undefined ? {} : { savings }),
  } satisfies KodoDelegationUsage;
});
