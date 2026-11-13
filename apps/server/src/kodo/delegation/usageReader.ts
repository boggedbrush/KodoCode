// Reads a lead's usage on demand for the thread view: nothing is stored for it. One shell read and one
// provider-turn read per worker, for the newest workers only. Every worker is counted (the ids are one
// cheap list), and when older ones were not read the figures say they are a floor.
import {
  KodoDelegationUsageReadError,
  type KodoDelegationUsage,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import { type DelegationSide, summarizeDelegation } from "./delegationUsage.ts";
import type { PriceTokens } from "../loop/loopSpend.ts";

/**
 * The most workers one read prices. The cap on a lead's workers is on live ones, so a long-lived lead
 * (the Orchestrator above all) has more than this over its life.
 */
const MAX_WORKERS_PRICED = 64;

/** A thread's model and every provider turn it has run: what the usage figures are computed from. */
export const readDelegationSide = Effect.fn("KodoDelegationUsage.side")(function* (
  orchestrator: Pick<Orchestrator.OrchestratorV2["Service"], "getThreadShell" | "getThreadRecords">,
  threadId: ThreadId,
) {
  const shell = yield* orchestrator.getThreadShell(threadId);
  if (shell === null) return undefined;
  const { providerTurns } = yield* orchestrator.getThreadRecords(threadId, ["providerTurns"]);
  return {
    threadId,
    model: shell.modelSelection,
    turns: providerTurns,
  } satisfies DelegationSide;
});

export const makeKodoDelegationUsageReader = (deps: {
  readonly orchestrator: Pick<
    Orchestrator.OrchestratorV2["Service"],
    "getThreadShell" | "getThreadRecords" | "listAppOwnedChildThreadIds"
  >;
  readonly price: PriceTokens;
}) => {
  const { orchestrator, price } = deps;
  const side = (threadId: ThreadId) => readDelegationSide(orchestrator, threadId);

  const read = Effect.fn("KodoDelegationUsage.read")(function* (threadId: ThreadId) {
    const lead = yield* side(threadId);
    if (lead === undefined) return undefined;
    const allIds = yield* orchestrator.listAppOwnedChildThreadIds(threadId);
    const childIds = allIds.slice(-MAX_WORKERS_PRICED);
    const workers = (yield* Effect.forEach(childIds, side, { concurrency: 4 })).flatMap((worker) =>
      worker === undefined ? [] : [worker],
    );
    return yield* summarizeDelegation({
      lead,
      workers,
      price,
      omittedWorkers: allIds.length - childIds.length,
    });
  });

  return {
    read: (threadId: ThreadId): Effect.Effect<KodoDelegationUsage, KodoDelegationUsageReadError> =>
      read(threadId).pipe(
        Effect.mapError((cause) => new KodoDelegationUsageReadError({ cause })),
        Effect.filterOrFail(
          (usage) => usage !== undefined,
          () => new KodoDelegationUsageReadError({ cause: "Thread not found." }),
        ),
      ),
  };
};
