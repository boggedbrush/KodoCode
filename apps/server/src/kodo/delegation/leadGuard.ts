// The service-layer guard for starting work from a thread that leads sub-agents or is one of their
// workers. It reads the server's own record of the threads, never what the caller says about
// itself; delegate_task, create_threads, t3_thread_launch and t3_thread_transfer ask it, and the loop start rules
// read the same ancestry.
import {
  isLiveSubagentShell,
  OrchestratorMcpFailure,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import {
  KODO_LEAD_THREAD_REFUSAL,
  KODO_WORKER_DEPTH_REFUSAL,
  KODO_WORKER_MESSAGING_REFUSAL,
  kodoMaxWorkers,
  kodoWorkerCapRefusal,
} from "./limits.ts";

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
/**
 * The newest workers read when counting. The store lists unfinished workers after finished ones, so
 * the newest end of the list holds every live worker (and the ones started this turn).
 */
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

const guardReadFailure = Effect.mapError((error: { readonly _tag: string }) =>
  error._tag === "OrchestratorMcpFailure"
    ? (error as OrchestratorMcpFailure)
    : failure(
        "Sub-agent limits could not be checked, so nothing was started. Try again in a moment.",
      ),
);

export interface KodoDelegationGuardDeps<E extends KodoReadError> {
  readonly getShell: GetShell<E>;
  readonly listChildIds: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<ThreadId>, E>;
  readonly toMillis: (value: OrchestrationV2ThreadShell["createdAt"]) => number;
  /** The settings' live-worker cap, as stored. */
  readonly maxWorkersSetting: Effect.Effect<unknown>;
}

/**
 * Refuses a delegation from a worker, or from a lead that is at a cap. A caller that is neither a
 * lead nor a worker is not this guard's business. A read that fails refuses (a limit that cannot be
 * checked is not a limit that is kept). The caller holds the lead's lock (`withLeadLock`) from here
 * until the worker is written, so two calls cannot both see room for one.
 */
export const kodoGuardWorkerStart = Effect.fn("KodoDelegation.guardStart")(function* <
  E extends KodoReadError,
>(
  deps: KodoDelegationGuardDeps<E>,
  input: {
    readonly callerThreadId: ThreadId;
    /** How many workers this call would add. */
    readonly adding: number;
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
    const refusal = kodoWorkerCapRefusal({
      counts,
      maxWorkers: kodoMaxWorkers(yield* deps.maxWorkersSetting),
      adding: input.adding,
    });
    if (refusal !== undefined) return yield* failure(refusal);
  }).pipe(guardReadFailure);
});

/** Refuses a caller that is a worker of a lead: workers start nothing. */
export const kodoGuardNotWorker = Effect.fn("KodoDelegation.guardNotWorker")(function* <
  E extends KodoReadError,
>(deps: Pick<KodoDelegationGuardDeps<E>, "getShell">, callerThreadId: ThreadId) {
  return yield* Effect.gen(function* () {
    if (yield* kodoThreadUnderLead(deps.getShell, callerThreadId)) {
      return yield* failure(KODO_WORKER_DEPTH_REFUSAL);
    }
  }).pipe(guardReadFailure);
});

/** Refuses a worker of a lead that forks itself or sends to another thread. */
export const kodoGuardWorkerMessaging = Effect.fn("KodoDelegation.guardWorkerMessaging")(function* <
  E extends KodoReadError,
>(deps: Pick<KodoDelegationGuardDeps<E>, "getShell">, callerThreadId: ThreadId) {
  return yield* Effect.gen(function* () {
    if (yield* kodoThreadUnderLead(deps.getShell, callerThreadId)) {
      return yield* failure(KODO_WORKER_MESSAGING_REFUSAL);
    }
  }).pipe(guardReadFailure);
});

/**
 * Refuses a thread start (create_threads, t3_thread_launch) from a lead or a worker: a lead hands
 * work over with delegate_task only, and a worker starts nothing.
 */
export const kodoGuardThreadStart = Effect.fn("KodoDelegation.guardThreadStart")(function* <
  E extends KodoReadError,
>(deps: Pick<KodoDelegationGuardDeps<E>, "getShell">, callerThreadId: ThreadId) {
  return yield* Effect.gen(function* () {
    const caller = yield* deps.getShell(callerThreadId);
    if (caller === null) return;
    if (yield* kodoThreadUnderLead(deps.getShell, callerThreadId)) {
      return yield* failure(KODO_WORKER_DEPTH_REFUSAL);
    }
    if (isKodoLead(caller)) return yield* failure(KODO_LEAD_THREAD_REFUSAL);
  }).pipe(guardReadFailure);
});

/** One lock per lead thread, dropped when nobody holds or waits for it. */
export function makeKodoLeadLocks() {
  const locks = new Map<string, { readonly lock: Semaphore.Semaphore; users: number }>();
  return {
    /**
     * Takes the lead's lock for the surrounding scope and returns an effect that gives it back early
     * (once; the scope gives it back otherwise). Calls for the same lead run one after another
     * between taking and giving back.
     */
    hold: (key: string) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const entry = locks.get(key) ?? { lock: Semaphore.makeUnsafe(1), users: 0 };
          entry.users += 1;
          locks.set(key, entry);
          const leave = Effect.sync(() => {
            entry.users -= 1;
            if (entry.users === 0 && locks.get(key) === entry) locks.delete(key);
          });
          // Waiting is interruptible; an interrupted waiter only drops its place.
          yield* restore(entry.lock.take(1)).pipe(Effect.onInterrupt(() => leave));
          let released = false;
          const giveBack = Effect.suspend(() => {
            if (released) return Effect.void;
            released = true;
            return Effect.andThen(entry.lock.release(1), leave);
          });
          yield* Effect.addFinalizer(() => giveBack);
          return giveBack;
        }),
      ),
    size: () => locks.size,
  };
}
export type KodoLeadLocks = ReturnType<typeof makeKodoLeadLocks>;
