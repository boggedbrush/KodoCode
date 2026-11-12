// Prices a stage's tokens and estimates what the cheaper stages saved. Pure apart from the price call,
// which the caller supplies: a model with no price yields null, never zero, so an unpriced stage can
// be told from a free one and is never added into a total as if it cost nothing.
import type {
  KodoLoop,
  KodoLoopSavings,
  KodoLoopStageRecord,
  KodoLoopStageUsage,
  ModelSelection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  addStageTotals,
  type StageModelUsage,
  type StageTokenTotals,
  type StageUsageSummary,
} from "./stageUsage.ts";

/** `null`: no price for that model (unlisted, subscription-only, or the rate table is unavailable). */
export type PriceTokens = (model: string, totals: StageTokenTotals) => Effect.Effect<number | null>;

const sumTotals = (groups: ReadonlyArray<StageModelUsage>): StageTokenTotals =>
  groups.reduce<StageTokenTotals>((sum, group) => addStageTotals(sum, group.totals), {
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  });

/** The stage's usage with its price at the models that ran, and at the reference model when one is set. */
export const priceStageUsage = Effect.fn("KodoLoopSpend.priceStageUsage")(function* (
  summary: StageUsageSummary,
  input: { readonly reference: ModelSelection | null; readonly price: PriceTokens },
) {
  let costUsd: number | undefined = 0;
  for (const group of summary.byModel) {
    if (costUsd === undefined) break;
    if (group.model === null) {
      costUsd = undefined;
      break;
    }
    const cost = yield* input.price(group.model, group.totals);
    costUsd = cost === null ? undefined : costUsd + cost;
  }
  const referenceCost =
    input.reference === null
      ? null
      : yield* input.price(input.reference.model, sumTotals(summary.byModel));
  return {
    ...summary.usage,
    ...(costUsd === undefined ? {} : { costUsd }),
    ...(referenceCost === null ? {} : { referenceCostUsd: referenceCost }),
  } satisfies KodoLoopStageUsage;
});

/** The ids a stage ran on: what the provider reported, else the model it was asked to run. */
const stageModelIds = (record: KodoLoopStageRecord): ReadonlyArray<string> =>
  record.usage?.models !== undefined && record.usage.models.length > 0
    ? record.usage.models
    : record.model === null
      ? []
      : [record.model.model];

export interface LoopTotals {
  /** Every counted token (uncached and cached input, cache writes, output), over stages that reported. */
  readonly tokens: number;
  /** Priced cost of the stages that have a price; null when none has. */
  readonly costUsd: number | null;
  /** Stages with a price. */
  readonly pricedStages: number;
  /** Stages that reported tokens but have no price. */
  readonly unpricedStages: ReadonlyArray<KodoLoopStageRecord>;
  /** Stages that reported no tokens at all. */
  readonly unreportedStages: ReadonlyArray<KodoLoopStageRecord>;
}

/** What the budget gate compares and the summary shows, from the stage records alone. */
export function loopTotals(stages: ReadonlyArray<KodoLoopStageRecord>): LoopTotals {
  let tokens = 0;
  let costUsd = 0;
  let pricedStages = 0;
  const unpricedStages: KodoLoopStageRecord[] = [];
  const unreportedStages: KodoLoopStageRecord[] = [];
  for (const record of stages) {
    if (record.runId === null) continue;
    const { usage } = record;
    if (usage === undefined) {
      unreportedStages.push(record);
      continue;
    }
    tokens +=
      usage.uncachedInputTokens +
      usage.cachedInputTokens +
      usage.cacheCreationTokens +
      usage.outputTokens;
    if (usage.costUsd === undefined) unpricedStages.push(record);
    else {
      costUsd += usage.costUsd;
      pricedStages += 1;
    }
  }
  return {
    tokens,
    costUsd: pricedStages === 0 ? null : costUsd,
    pricedStages,
    unpricedStages,
    unreportedStages,
  };
}

/**
 * The savings estimate for Code, and Plan when it ran off the reference model: the same tokens at the
 * reference's rates minus their cost. Same-model stages are counted apart; unpriced ones are listed,
 * never counted as free. Undefined without a reference or such a stage.
 */
export function computeLoopSavings(
  stages: ReadonlyArray<KodoLoopStageRecord>,
  reference: ModelSelection | null,
): KodoLoopSavings | undefined {
  if (reference === null) return undefined;
  let actualUsd = 0;
  let referenceUsd = 0;
  let pricedStages = 0;
  let sameModelStages = 0;
  let considered = 0;
  const unpricedStages: Array<{ round: number; stage: KodoLoopStageRecord["stage"] }> = [];
  for (const record of stages) {
    if (record.runId === null || (record.stage !== "code" && record.stage !== "plan")) continue;
    const ids = stageModelIds(record);
    const onReference = ids.length > 0 && ids.every((id) => id === reference.model);
    if (onReference) {
      if (record.stage === "code") sameModelStages += 1;
      continue;
    }
    // Plan counts only when its own model is not the reference; Code always does.
    considered += 1;
    const usage = record.usage;
    if (usage?.costUsd === undefined || usage.referenceCostUsd === undefined) {
      unpricedStages.push({ round: record.round, stage: record.stage });
      continue;
    }
    actualUsd += usage.costUsd;
    referenceUsd += usage.referenceCostUsd;
    pricedStages += 1;
  }
  if (considered === 0 && sameModelStages === 0) return undefined;
  const savedUsd = referenceUsd - actualUsd;
  return {
    actualUsd,
    referenceUsd,
    savedUsd,
    savedPct: referenceUsd > 0 ? (savedUsd / referenceUsd) * 100 : 0,
    referenceModel: reference,
    pricedStages,
    unpricedStages,
    sameModelStages,
  };
}

/** The sentence a stopped loop shows when the limit window itself reached its setting. */
export const limitTripDetail = (input: {
  readonly provider: string;
  readonly window: string;
  readonly percent: number;
  readonly limit: number;
}) =>
  `${input.provider} ${input.window} window at ${Math.round(input.percent)}%, limit ${input.limit}%.`;

export type LoopForSpend = Pick<KodoLoop, "stages" | "budget">;
