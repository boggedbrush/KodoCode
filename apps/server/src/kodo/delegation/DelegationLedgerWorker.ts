// Records what delegated work cost in the lifetime ledger. When a lead's worker finishes a task it
// reads the worker's turns, prices them like a loop's stages and upserts one row for that worker. The
// look is a function of stored state alone (the worker's thread, its lead, the lead's task records),
// so replayed or duplicated events and a worker finishing twice leave one row.
import { type OrchestrationV2DomainEvent, type ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../../serverActivation.ts";
import * as UsageService from "../../usage/UsageService.ts";
import { workerLedgerRow } from "../ledger/delegationLedgerRow.ts";
import { recordDelegatedWorker } from "../ledger/delegationLedgerStore.ts";
import type { PriceTokens } from "../loop/loopSpend.ts";
import { makeThreadSingleFlight } from "../loop/threadSingleFlight.ts";
import { readDelegationSide } from "./usageReader.ts";
import { priceWorker } from "./delegationUsage.ts";

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

/** Finished workers remembered, so usage that arrives after their last task is picked up. */
const MAX_REMEMBERED_WORKERS = 256;

/**
 * A worker already recorded whose provider turn changed after its task finished (a provider's final
 * token report can land later). Only a thread seen finishing is asked about, so no other thread's
 * turn events cost a read.
 */
const lateUsageWorkerOf = (
  event: OrchestrationV2DomainEvent,
  finished: ReadonlyMap<ThreadId, unknown>,
): ThreadId | undefined =>
  event.type === "provider-turn.updated" &&
  finished.has(event.threadId) &&
  (event.payload.turnTokenUsage !== undefined || event.payload.tokenUsage !== undefined)
    ? event.threadId
    : undefined;

/** The worker thread a finished delegated task points at, or undefined for any other event. */
export const finishedWorkerOf = (event: OrchestrationV2DomainEvent): ThreadId | undefined =>
  event.type === "subagent.updated" &&
  event.payload.origin === "app_owned" &&
  event.payload.childThreadId !== null &&
  TERMINAL.has(event.payload.status)
    ? event.payload.childThreadId
    : undefined;

/** The worker thread a task that is not finished points at: it is working again, so no longer finished. */
const startedWorkerOf = (event: OrchestrationV2DomainEvent): ThreadId | undefined =>
  event.type === "subagent.updated" &&
  event.payload.origin === "app_owned" &&
  event.payload.childThreadId !== null &&
  !TERMINAL.has(event.payload.status)
    ? event.payload.childThreadId
    : undefined;

/**
 * Finished workers whose lead is a lead, newest kept. Anything else costs a set lookup at most,
 * because provider-turn events arrive for every streaming turn of every thread.
 */
export const makeFinishedWorkerMemory = (max = MAX_REMEMBERED_WORKERS) => {
  const finished = new Map<ThreadId, number>();
  let marks = 0;
  return {
    /** Returns the worker's way out for a look that finds nothing to correct: it takes only this memory, not a later one. */
    remember: (workerThreadId: ThreadId) => {
      finished.delete(workerThreadId);
      if (finished.size >= max) {
        const oldest = finished.keys().next();
        if (!oldest.done) finished.delete(oldest.value);
      }
      marks += 1;
      const mark = marks;
      finished.set(workerThreadId, mark);
      return () => {
        if (finished.get(workerThreadId) === mark) finished.delete(workerThreadId);
      };
    },
    /** The worker takes another task as this event says, or nothing changes. */
    forgetIfRestarted: (event: OrchestrationV2DomainEvent) => {
      const worker = startedWorkerOf(event);
      if (worker !== undefined) finished.delete(worker);
    },
    lateUsageWorkerOf: (event: OrchestrationV2DomainEvent) => lateUsageWorkerOf(event, finished),
  };
};

export const makeDelegationLedgerLook = (deps: {
  readonly orchestrator: Pick<
    Orchestrator.OrchestratorV2["Service"],
    "getThreadShell" | "getThreadRecords"
  >;
  readonly price: PriceTokens;
}) =>
  Effect.fn("KodoDelegationLedger.look")(function* (workerThreadId: ThreadId) {
    /** True when the worker belongs to a lead and has finished a task, so later usage is worth a look. */
    const { orchestrator } = deps;
    const worker = yield* orchestrator.getThreadShell(workerThreadId);
    const leadId =
      worker?.lineage.relationshipToParent === "subagent" ? worker.lineage.parentThreadId : null;
    if (worker === null || leadId === null) return false;
    const lead = yield* orchestrator.getThreadShell(leadId);
    // A person's sub-agents lead and the Orchestrator both record their workers, as sub-agent workers.
    if (lead?.kodoLead == null) return false;
    const { subagents } = yield* orchestrator.getThreadRecords(leadId, ["subagents"]);
    const tasks = subagents.filter(
      (task) => task.origin === "app_owned" && task.childThreadId === workerThreadId,
    );
    const finished = tasks
      .filter((task) => TERMINAL.has(task.status))
      .toSorted(
        (a, b) =>
          DateTime.toEpochMillis(a.completedAt ?? a.updatedAt) -
          DateTime.toEpochMillis(b.completedAt ?? b.updatedAt),
      )
      .at(-1);
    if (finished === undefined) return false;
    const side = yield* readDelegationSide(orchestrator, workerThreadId);
    if (side === undefined) return false;
    const priced = yield* priceWorker(side, lead.modelSelection, deps.price);
    yield* recordDelegatedWorker(
      workerLedgerRow({
        worker: priced,
        leadThreadId: leadId,
        // The project the work ran in: the lead's own, or the one the Orchestrator started it in.
        projectId: worker.projectId,
        endedAt: DateTime.formatIso(finished.completedAt ?? finished.updatedAt),
        tasks: tasks.length,
        stopReason: finished.status,
        referenceModel: lead.modelSelection.model,
      }),
    );
    return true;
  });

/**
 * What each domain event does to the ledger. A finished worker is remembered as its event arrives,
 * before anything is read, so a late usage report cannot land in the gap while the look runs; a look
 * that finds no row to correct lets go of only that memory, never a newer one.
 */
export const makeDelegationLedgerEvents =
  (deps: {
    /** The look as one at a time per thread: false when the worker has no row to correct. */
    readonly look: (threadId: ThreadId) => Effect.Effect<unknown>;
    readonly memory: ReturnType<typeof makeFinishedWorkerMemory>;
  }) =>
  (event: OrchestrationV2DomainEvent) => {
    const { look, memory } = deps;
    memory.forgetIfRestarted(event);
    const done = finishedWorkerOf(event);
    if (done !== undefined) {
      const forget = memory.remember(done);
      return look(done).pipe(
        Effect.tap((recorded) => (recorded === false ? Effect.sync(forget) : Effect.void)),
        Effect.forkScoped,
      );
    }
    const late = memory.lateUsageWorkerOf(event);
    return late === undefined ? Effect.void : look(late).pipe(Effect.forkScoped);
  };

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const usageService = yield* Effect.serviceOption(UsageService.UsageService);
    const look = makeDelegationLedgerLook({
      orchestrator,
      price: (model, totals) =>
        Option.isSome(usageService)
          ? usageService.value.priceTokens({ model, totals })
          : Effect.succeed(null),
    });
    // The ledger is a record: a read or write that fails is logged and skipped, never raised.
    const guarded = makeThreadSingleFlight((threadId: ThreadId) =>
      look(threadId).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.catchCause((cause) =>
          Effect.logDebug("kodo.delegation-ledger.look-skipped", { cause }),
        ),
      ),
    );
    const memory = makeFinishedWorkerMemory();
    const onEvent = makeDelegationLedgerEvents({ look: guarded, memory });
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, onEvent).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("kodo.delegation-ledger.events-failed", { cause }),
        ),
      ),
    );
  }),
);
