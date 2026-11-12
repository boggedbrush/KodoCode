// Keeps every running loop moving. It looks at a loop's thread when something happened on it (an event
// from the orchestrator) and on every scheduler tick, which also covers a restart: loops that were
// running when the server stopped are found once at startup and picked up where their state says.
import {
  type OrchestrationV2DomainEvent,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as CheckpointDiffQuery from "../../checkpointing/CheckpointDiffQuery.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as DueHint from "../../scheduling/DueHint.ts";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import { forkParked } from "../../serverActivation.ts";
import type { LoopDiffEvidence } from "./evidence.ts";
import { makeKodoLoopStepper } from "./LoopStepper.ts";

// Events that can change what the loop should do next; streaming text cannot.
const affectsLoop = (event: OrchestrationV2DomainEvent) =>
  event.type.startsWith("thread.") ||
  event.type === "run.created" ||
  event.type === "run.updated" ||
  event.type === "message.updated" ||
  event.type === "plan.updated" ||
  event.type === "runtime-request.updated";

const isRunningLoop = (event: OrchestrationV2DomainEvent) =>
  event.type === "thread.metadata-updated" &&
  (event.payload.kodoLoop?.status === "active" || event.payload.kodoLoop?.status === "held");

const DIFF_TRUNCATED_MARKER = "[truncated]";

export const makeDiffReader =
  (query: CheckpointDiffQuery.CheckpointDiffQuery["Service"]) =>
  (input: {
    readonly threadId: ThreadId;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  }): Effect.Effect<LoopDiffEvidence> =>
    query.getTurnDiff(input).pipe(
      Effect.map(
        ({ diff }): LoopDiffEvidence => ({
          kind: "diff",
          text: diff,
          truncated: diff.endsWith(DIFF_TRUNCATED_MARKER),
        }),
      ),
      Effect.orElseSucceed(
        (): LoopDiffEvidence => ({
          kind: "unavailable",
          reason: "this project has no saved checkpoints to compare",
        }),
      ),
    );

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const diffQuery = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const scheduler = yield* Scheduler.Scheduler;
    const stepper = yield* makeKodoLoopStepper({
      orchestrator,
      dispatch: threads.dispatch,
      readDiff: makeDiffReader(diffQuery),
    });
    const tracked = new Set<ThreadId>();
    const permit = yield* Semaphore.make(1);
    const due = DueHint.make();

    const look = Effect.fn("KodoLoopWorker.look")(function* (threadId: ThreadId) {
      const result = yield* permit.withPermits(1)(stepper.step(threadId));
      if (result === "gone") tracked.delete(threadId);
      return result;
    });

    // Loops that were running when the server stopped. Thread rows hold the loop in their payload,
    // so this reads them once; after that, events say which threads to look at.
    const found = yield* sql<{ readonly thread_id: string }>`
      SELECT thread_id
      FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL
        AND json_extract(payload_json, '$.kodoLoop.status') IN ('active', 'held')
    `.pipe(
      Effect.map((rows) => rows.map((row) => ThreadId.make(row.thread_id))),
      Effect.orElseSucceed((): ReadonlyArray<ThreadId> => []),
    );
    for (const id of found) tracked.add(id);

    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        if (!("threadId" in event) || !affectsLoop(event)) return Effect.void;
        const threadId = event.threadId;
        if (isRunningLoop(event)) tracked.add(threadId);
        if (!tracked.has(threadId)) return Effect.void;
        return Effect.all([due.invalidate, look(threadId).pipe(Effect.forkScoped)], {
          discard: true,
        });
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("kodo.loop.events-failed", { cause }))),
    );

    const sweep = Effect.fn("KodoLoopWorker.sweep")(function* () {
      if (tracked.size === 0) return;
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      if (yield* due.isIdle(nowMs)) return;
      const readVersion = yield* due.version;
      let moving = false;
      for (const threadId of [...tracked]) {
        const result = yield* look(threadId);
        if (result === "acted" || result === "failed") moving = true;
      }
      // A look that did something, or could not, is repeated on the next tick.
      if (!moving) yield* due.record(readVersion, Infinity, nowMs);
    });
    yield* scheduler.register("kodo-loop", sweep());
  }),
);
