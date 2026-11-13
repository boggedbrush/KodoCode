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

/** The worker thread a finished delegated task points at, or undefined for any other event. */
export const finishedWorkerOf = (event: OrchestrationV2DomainEvent): ThreadId | undefined =>
  event.type === "subagent.updated" &&
  event.payload.origin === "app_owned" &&
  event.payload.childThreadId !== null &&
  TERMINAL.has(event.payload.status)
    ? event.payload.childThreadId
    : undefined;

export const makeDelegationLedgerLook = (deps: {
  readonly orchestrator: Pick<
    Orchestrator.OrchestratorV2["Service"],
    "getThreadShell" | "getThreadRecords"
  >;
  readonly price: PriceTokens;
}) =>
  Effect.fn("KodoDelegationLedger.look")(function* (workerThreadId: ThreadId) {
    const { orchestrator } = deps;
    const worker = yield* orchestrator.getThreadShell(workerThreadId);
    const leadId =
      worker?.lineage.relationshipToParent === "subagent" ? worker.lineage.parentThreadId : null;
    if (worker === null || leadId === null) return;
    const lead = yield* orchestrator.getThreadShell(leadId);
    // Only a person's sub-agents lead is recorded; the Orchestrator's work is its own threads.
    if (lead?.kodoLead?.kind !== "sub-agents") return;
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
    if (finished === undefined) return;
    const side = yield* readDelegationSide(orchestrator, workerThreadId);
    if (side === undefined) return;
    const priced = yield* priceWorker(side, lead.modelSelection, deps.price);
    yield* recordDelegatedWorker(
      workerLedgerRow({
        worker: priced,
        leadThreadId: leadId,
        projectId: lead.projectId,
        endedAt: DateTime.formatIso(finished.completedAt ?? finished.updatedAt),
        tasks: tasks.length,
        stopReason: finished.status,
        referenceModel: lead.modelSelection.model,
      }),
    );
  });

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
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        const worker = finishedWorkerOf(event);
        return worker === undefined ? Effect.void : guarded(worker).pipe(Effect.forkScoped);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("kodo.delegation-ledger.events-failed", { cause }),
        ),
      ),
    );
  }),
);
