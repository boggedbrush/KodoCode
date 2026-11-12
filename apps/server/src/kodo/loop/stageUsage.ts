// What a stage spent, from the provider-turn ledger. Pure: the stepper reads the stage run's turns and
// asks here. Providers that report nothing are unavailable (no usage), never zero, and a stage whose
// turns only partly reported says so (`complete: false`) so no total passes for a full count.
import {
  KODO_LOOP_USAGE_MODELS_MAX,
  type KodoLoopStageUsage,
  type OrchestrationV2ProviderTurn,
} from "@t3tools/contracts";

export interface StageTokenTotals {
  readonly uncachedInputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

/** Tokens that ran on one model: the unit that gets one price. A null model is one the ledger could not name. */
export interface StageModelUsage {
  readonly model: string | null;
  readonly totals: StageTokenTotals;
}

export interface StageUsageSummary {
  /** Without prices: the stepper adds them. */
  readonly usage: Pick<
    KodoLoopStageUsage,
    | "uncachedInputTokens"
    | "cachedInputTokens"
    | "cacheCreationTokens"
    | "outputTokens"
    | "reasoningTokens"
    | "complete"
    | "models"
  >;
  readonly byModel: ReadonlyArray<StageModelUsage>;
}

type StageTurn = Pick<OrchestrationV2ProviderTurn, "turnTokenUsage" | "model">;

export const addStageTotals = (a: StageTokenTotals, b: StageTokenTotals): StageTokenTotals => ({
  uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

const NO_TOKENS: StageTokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

/**
 * The tokens of all of a stage's provider turns (every attempt of its run and of its restart
 * continuations). `fallbackModel` is the model the stage was asked to run, used when a turn names none.
 * Undefined when no turn reported a count.
 */
export function summarizeStageUsage(
  turns: ReadonlyArray<StageTurn>,
  fallbackModel: string,
): StageUsageSummary | undefined {
  const groups = new Map<string | null, StageTokenTotals>();
  const reported = new Set<string>();
  let measured = 0;
  let complete = true;
  for (const turn of turns) {
    const usage = turn.turnTokenUsage;
    // A local command's counters describe its result, not model work.
    if (usage?.localCommand === true) continue;
    if (
      usage === undefined ||
      (usage.inputTokens === undefined && usage.outputTokens === undefined)
    ) {
      complete = false;
      continue;
    }
    measured += 1;
    if (usage.usageStatus !== "complete" || usage.hasSubagents) complete = false;
    // Input includes cache reads and writes; reasoning is a part of output.
    const input = usage.inputTokens ?? 0;
    const cached = Math.min(usage.cachedInputTokens ?? 0, input);
    const created = Math.min(usage.cacheCreationTokens ?? 0, input - cached);
    const totals: StageTokenTotals = {
      uncachedInputTokens: input - cached - created,
      cachedInputTokens: cached,
      cacheCreationTokens: created,
      outputTokens: usage.outputTokens ?? 0,
      reasoningTokens: Math.min(usage.reasoningTokens ?? 0, usage.outputTokens ?? 0),
    };
    // Several named models for one turn cannot be split, so that turn has no model to price at.
    const named = usage.models?.filter((model) => model.length > 0);
    const model =
      named !== undefined && named.length > 1 ? null : (named?.[0] ?? turn.model ?? fallbackModel);
    for (const id of named ?? (turn.model === undefined ? [] : [turn.model])) reported.add(id);
    groups.set(model, addStageTotals(groups.get(model) ?? NO_TOKENS, totals));
  }
  if (measured === 0) return undefined;
  const byModel = [...groups].map(([model, totals]) => ({ model, totals }));
  const total = byModel.reduce((sum, entry) => addStageTotals(sum, entry.totals), NO_TOKENS);
  const models = [...reported].slice(0, KODO_LOOP_USAGE_MODELS_MAX);
  return {
    usage: { ...total, complete, ...(models.length === 0 ? {} : { models }) },
    byModel,
  };
}
