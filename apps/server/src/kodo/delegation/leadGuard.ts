// The service-layer guard for starting work from a thread that leads sub-agents or is one of their
// workers. It reads the server's own record of the threads, never what the caller says about
// itself; delegate_task, create_threads and t3_thread_launch all ask it, and the loop start rules
// read the same ancestry.
import {
  isLiveSubagentShell,
  OrchestratorMcpFailure,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { kodoMaxWorkers, kodoWorkerCapRefusal, KODO_WORKER_DEPTH_REFUSAL } from "./limits.ts";

type LiveShell = Parameters<typeof isLiveSubagentShell>[0];
type KodoReadError = { readonly _tag: string };

/** What the ancestry walk reads of a thread: whether it leads, and what it runs under. */
export interface KodoAncestryShell {
  readonly kodoLead?: { readonly kind: string } | null | undefined;
  readonly lineage: {
    readonly parentThreadId: ThreadId | null;
    readonly relationshipToParent?: string | null | undefined;
  };
  readonly delegatedFrom?: { readonly threadId: ThreadId } | null | undefined;
}

export interface KodoLeadShell extends LiveShell, KodoAncestryShell {
  readonly id: ThreadId;
  readonly createdAt: OrchestrationV2ThreadShell["createdAt"];
  readonly deletedAt: OrchestrationV2ThreadShell["deletedAt"];
  readonly activityRunStartedAt?: OrchestrationV2ThreadShell["createdAt"] | null | undefined;
  readonly latestRunRequestedAt?: OrchestrationV2ThreadShell["createdAt"] | null | undefined;
}

/** How far up the delegation chain a thread's ancestry is read. */
const MAX_ANCESTRY_DEPTH = 6;
/** The newest workers read when counting; older ones are long finished. */
const MAX_WORKERS_READ = 64;

export const isKodoLead = (shell: {
  readonly kodoLead?: { readonly kind: string } | null | undefined;
}) => shell.kodoLead?.kind === "sub-agents";

type GetShell<E> = (threadId: ThreadId) => Effect.Effect<KodoLeadShell | null, E>;
type GetAncestryShell<E> = (threadId: ThreadId) => Effect.Effect<KodoAncestryShell | null, E>;

/**
 * Whether a thread is a worker: it is a delegated child (a `subagent` of its parent, or delegated
 * from a linked environment's thread), and a thread above it through such links leads sub-agents.
 * A fork of a lead is not a worker. A thread the read cannot find ends the walk as "not a worker";
 * the caller decides what an unreadable store means.
 */
export const kodoThreadUnderLead = Effect.fn("KodoDelegation.underLead")(function* <
  E extends KodoReadError,
>(getShell: GetAncestryShell<E>, threadId: ThreadId) {
  const seen = new Set<ThreadId>([threadId]);
  let current = yield* getShell(threadId);
  for (let depth = 0; current !== null && depth < MAX_ANCESTRY_DEPTH; depth += 1) {
    const delegated =
      current.lineage.relationshipToParent === "subagent" || current.delegatedFrom != null;
    const parentId = current.lineage.parentThreadId ?? current.delegatedFrom?.threadId ?? null;
    if (!delegated || parentId === null || seen.has(parentId)) return false;
    seen.add(parentId);
    const parent: KodoAncestryShell | null = yield* getShell(parentId);
    if (parent === null) return false;
    if (isKodoLead(parent)) return true;
    current = parent;
  }
  return false;
});

/** Whether `threadId` is `ancestorId` or runs under it by any parent, fork or delegation link. */
export const kodoThreadRunsUnder = Effect.fn("KodoDelegation.runsUnder")(function* <
  E extends KodoReadError,
>(getShell: GetAncestryShell<E>, threadId: ThreadId, ancestorId: ThreadId) {
  const seen = new Set<ThreadId>();
  let current: ThreadId | null = threadId;
  for (
    let depth = 0;
    current !== null && depth <= MAX_ANCESTRY_DEPTH && !seen.has(current);
    depth += 1
  ) {
    if (current === ancestorId) return true;
    seen.add(current);
    const shell: KodoAncestryShell | null = yield* getShell(current);
    if (shell === null) return false;
    current = shell.lineage.parentThreadId ?? shell.delegatedFrom?.threadId ?? null;
  }
  return false;
});

/** Workers of a lead that have not finished, and those it started since `turnStartedAtMs`. */
export const kodoWorkerCounts = Effect.fn("KodoDelegation.workerCounts")(function* <
  E extends KodoReadError,
>(input: {
  readonly getShell: GetShell<E>;
  readonly listChildIds: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<ThreadId>, E>;
  readonly leadId: ThreadId;
  readonly turnStartedAtMs: number | undefined;
  readonly toMillis: (value: OrchestrationV2ThreadShell["createdAt"]) => number;
}) {
  const ids = (yield* input.listChildIds(input.leadId)).slice(-MAX_WORKERS_READ);
  let live = 0;
  let thisTurn = 0;
  for (const id of ids) {
    const shell = yield* input.getShell(id);
    if (shell === null || shell.deletedAt !== null) continue;
    if (isLiveSubagentShell(shell)) live += 1;
    if (
      input.turnStartedAtMs !== undefined &&
      input.toMillis(shell.createdAt) >= input.turnStartedAtMs
    ) {
      thisTurn += 1;
    }
  }
  return { live, thisTurn };
});

const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "capability_denied", message });

/**
 * Threads a lead has created this turn (create_threads, t3_thread_launch), which no worker record
 * lists. Kept in memory per turn and bounded: a restart forgets it, and the live-worker cap, which is
 * read from the store, is unaffected.
 */
export function makeKodoCreatedTally(limit = 256) {
  const created = new Map<string, number>();
  return {
    get: (key: string) => created.get(key) ?? 0,
    add: (key: string, count: number) => {
      const next = (created.get(key) ?? 0) + count;
      created.delete(key);
      created.set(key, next);
      for (const oldest of created.keys()) {
        if (created.size <= limit) break;
        created.delete(oldest);
      }
    },
  };
}
export type KodoCreatedTally = ReturnType<typeof makeKodoCreatedTally>;

export interface KodoDelegationGuardDeps<E extends KodoReadError> {
  readonly tally: KodoCreatedTally;
  readonly getShell: GetShell<E>;
  readonly listChildIds: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<ThreadId>, E>;
  readonly toMillis: (value: OrchestrationV2ThreadShell["createdAt"]) => number;
  /** The settings' live-worker cap, as stored. */
  readonly maxWorkersSetting: Effect.Effect<unknown>;
}

/**
 * Refuses a start from a worker, or from a lead that is at a cap. A caller that is neither a lead nor
 * a worker is not this guard's business. A read that fails refuses (a limit that cannot be checked
 * is not a limit that is kept).
 */
export const kodoGuardWorkerStart = Effect.fn("KodoDelegation.guardStart")(function* <
  E extends KodoReadError,
>(
  deps: KodoDelegationGuardDeps<E>,
  input: {
    readonly callerThreadId: ThreadId;
    /** How many workers or threads this call would add. */
    readonly adding: number;
    /** `delegate` adds workers, which the store lists; `thread` adds top-level threads, which only the tally knows. */
    readonly route: "delegate" | "thread";
  },
) {
  return yield* Effect.gen(function* () {
    const caller = yield* deps.getShell(input.callerThreadId);
    if (caller === null) return;
    if (yield* kodoThreadUnderLead(deps.getShell, input.callerThreadId)) {
      return yield* failure(KODO_WORKER_DEPTH_REFUSAL);
    }
    if (!isKodoLead(caller)) return;
    // The per-turn cap counts workers made since the lead's current turn began.
    const turnStart = caller.activityRunStartedAt ?? caller.latestRunRequestedAt ?? undefined;
    const counts = yield* kodoWorkerCounts({
      getShell: deps.getShell,
      listChildIds: deps.listChildIds,
      leadId: input.callerThreadId,
      turnStartedAtMs: turnStart === undefined ? undefined : deps.toMillis(turnStart),
      toMillis: deps.toMillis,
    });
    const tallyKey = `${input.callerThreadId}:${turnStart === undefined ? "" : deps.toMillis(turnStart)}`;
    const refusal = kodoWorkerCapRefusal({
      counts: { live: counts.live, thisTurn: counts.thisTurn + deps.tally.get(tallyKey) },
      maxWorkers: kodoMaxWorkers(yield* deps.maxWorkersSetting),
      adding: input.adding,
    });
    if (refusal !== undefined) return yield* failure(refusal);
    if (input.route === "thread") deps.tally.add(tallyKey, input.adding);
  }).pipe(
    Effect.mapError((error) =>
      error._tag === "OrchestratorMcpFailure"
        ? (error as OrchestratorMcpFailure)
        : failure(
            "Sub-agent limits could not be checked, so nothing was started. Try again in a moment.",
          ),
    ),
  );
});
