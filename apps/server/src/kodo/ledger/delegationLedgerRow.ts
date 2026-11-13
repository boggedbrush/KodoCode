// What a worker leaves in the ledger: one row per worker thread, because a follow-up task reuses its
// worker's thread and its provider turns are one running count. Pure; the write is in
// delegationLedgerStore.ts. The figures come from the same pricing as a loop's, so the Usage page
// can add them together.
import type { KodoLoopStageUsage } from "@t3tools/contracts";

import type { PricedWorker } from "../delegation/delegationUsage.ts";

export interface WorkerLedgerRow {
  /** `worker:<worker thread id>`: replaying the same work lands on the same row. */
  readonly unitId: string;
  readonly leadThreadId: string;
  readonly workerThreadId: string;
  readonly projectId: string;
  readonly endedAt: string;
  /** Every token the provider reported, cache reads included: it only grows as the worker is resumed. */
  readonly revision: number;
  readonly tasks: number;
  readonly stopReason: string;
  readonly tokens: number | null;
  readonly modelsJson: string | null;
  readonly actualUsd: number | null;
  readonly referenceUsd: number | null;
  readonly referenceModel: string | null;
  readonly priced: 0 | 1;
  readonly unpriced: 0 | 1;
  readonly partial: 0 | 1;
}

const workerLedgerUnitId = (workerThreadId: string) => `worker:${workerThreadId}`;

const allTokens = (usage: KodoLoopStageUsage) =>
  usage.uncachedInputTokens +
  usage.cachedInputTokens +
  usage.cacheCreationTokens +
  usage.outputTokens +
  (usage.otherTokens ?? 0);

export function workerLedgerRow(input: {
  readonly worker: PricedWorker;
  readonly leadThreadId: string;
  readonly projectId: string;
  readonly endedAt: string;
  readonly tasks: number;
  readonly stopReason: string;
  /** The lead's model, as the savings are measured against it. */
  readonly referenceModel: string;
}): WorkerLedgerRow {
  const { worker } = input;
  const { usage } = worker;
  const priced =
    !worker.sameModel && usage?.costUsd !== undefined && usage.referenceCostUsd !== undefined;
  const counted = usage === undefined ? [] : worker.modelTokens;
  return {
    unitId: workerLedgerUnitId(worker.threadId),
    leadThreadId: input.leadThreadId,
    workerThreadId: worker.threadId,
    projectId: input.projectId,
    endedAt: input.endedAt,
    revision: usage === undefined ? 0 : allTokens(usage),
    tasks: input.tasks,
    stopReason: input.stopReason,
    tokens:
      usage === undefined
        ? null
        : usage.uncachedInputTokens +
          usage.cacheCreationTokens +
          usage.outputTokens +
          (usage.otherTokens ?? 0),
    modelsJson:
      counted.length === 0
        ? null
        : JSON.stringify(Object.fromEntries(counted.map((entry) => [entry.model, entry.tokens]))),
    actualUsd: priced ? (usage?.costUsd ?? null) : null,
    referenceUsd: priced ? (usage?.referenceCostUsd ?? null) : null,
    referenceModel: worker.sameModel ? null : input.referenceModel,
    priced: priced ? 1 : 0,
    unpriced: !worker.sameModel && usage !== undefined && !priced ? 1 : 0,
    partial: priced && usage?.complete === false ? 1 : 0,
  };
}
