// Keeps every running loop moving. It looks at a loop's thread when something happened on it (an event
// from the orchestrator) and on every scheduler tick, which also covers a restart: loops that were
// running when the server stopped are found once at startup and picked up where their state says.
import { DEFAULT_KODO_MODE_MODELS, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as CheckpointDiffQuery from "../../checkpointing/CheckpointDiffQuery.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as DueHint from "../../scheduling/DueHint.ts";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../../provider/ProviderRegistry.ts";
import { forkParked } from "../../serverActivation.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as UsageService from "../../usage/UsageService.ts";
import type { LoopDiffEvidence } from "./evidence.ts";
import { affectsLoop, isTrackedLoopEvent } from "./loopEvents.ts";
import { makeKodoLoopStepper, type LoopSpendDeps } from "./LoopStepper.ts";
import { makeThreadSingleFlight } from "./threadSingleFlight.ts";

const DIFF_TRUNCATED_MARKER = "[truncated]";

const makeDiffReader =
  (query: CheckpointDiffQuery.CheckpointDiffQuery["Service"]) =>
  (input: {
    readonly threadId: ThreadId;
    readonly fromTurnCount: number;
    readonly toTurnCount: number;
  }): Effect.Effect<LoopDiffEvidence> =>
    query.getTurnDiff(input).pipe(
      Effect.map(({ diff }): LoopDiffEvidence => ({
        kind: "diff",
        text: diff,
        truncated: diff.endsWith(DIFF_TRUNCATED_MARKER),
      })),
      Effect.orElseSucceed((): LoopDiffEvidence => ({
        kind: "unavailable",
        reason: "this project has no saved checkpoints to compare",
      })),
    );

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const diffQuery = yield* CheckpointDiffQuery.CheckpointDiffQuery;
    const scheduler = yield* Scheduler.Scheduler;
    // Each is read where the server has it: no provider list means no limit windows are seen (said on
    // the loop), no price service means no stage has a price, and unreadable settings mean the defaults.
    const providerRegistry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
    const instanceRegistry = yield* Effect.serviceOption(
      ProviderInstanceRegistry.ProviderInstanceRegistry,
    );
    const usageService = yield* Effect.serviceOption(UsageService.UsageService);
    const serverSettings = yield* Effect.serviceOption(ServerSettings.ServerSettingsService);
    const spend: LoopSpendDeps = {
      providers: Option.isSome(providerRegistry)
        ? providerRegistry.value.getProviders
        : Effect.succeed([]),
      modeModels: Option.isSome(serverSettings)
        ? serverSettings.value.getSettings.pipe(
            Effect.map((settings) => settings.modeModelSelections),
            Effect.orElseSucceed(() => DEFAULT_KODO_MODE_MODELS),
          )
        : Effect.succeed(DEFAULT_KODO_MODE_MODELS),
      price: (model, totals) =>
        Option.isSome(usageService)
          ? usageService.value.priceTokens({ model, totals })
          : Effect.succeed(null),
    };
    // The instance's own snapshot is read, not the provider list's copy of it, which follows by a moment.
    // Without the instance registry the list's reading stands, and no refresh is asked for.
    const liveLimits: Pick<LoopSpendDeps, "readLimits" | "refreshLimits"> = Option.isSome(
      instanceRegistry,
    )
      ? {
          readLimits: (instanceId) =>
            instanceRegistry.value
              .getInstance(ProviderInstanceId.make(instanceId))
              .pipe(
                Effect.flatMap((instance) =>
                  instance === undefined
                    ? spend.providers.pipe(
                        Effect.map(
                          (providers) =>
                            providers.find((provider) => provider.instanceId === instanceId)
                              ?.usageLimits,
                        ),
                      )
                    : instance.snapshot.getSnapshot.pipe(
                        Effect.map((snapshot) => snapshot.usageLimits),
                      ),
                ),
              ),
          refreshLimits: (instanceId) =>
            instanceRegistry.value
              .getInstance(ProviderInstanceId.make(instanceId))
              .pipe(Effect.flatMap((instance) => instance?.snapshot.refreshUsage ?? Effect.void)),
        }
      : {};
    const stepper = yield* makeKodoLoopStepper({
      orchestrator,
      dispatch: threads.dispatch,
      readDiff: makeDiffReader(diffQuery),
      spend: { ...spend, ...liveLimits },
    });
    const tracked = new Set<ThreadId>();
    const due = DueHint.make();

    // At most one look per thread at a time, and a look never waits in a line behind another thread's.
    const look = makeThreadSingleFlight(
      Effect.fn("KodoLoopWorker.look")(function* (threadId: ThreadId) {
        const result = yield* stepper.step(threadId);
        if (result === "gone") tracked.delete(threadId);
        return result;
      }),
    );

    // Loops that were running when the server stopped, and loops that ended while it was down with a
    // stop or a mode still owed. Thread rows hold the loop in their payload, so this reads them once;
    // after that, events say which threads to look at.
    const found = yield* sql<{ readonly thread_id: string }>`
      SELECT thread_id
      FROM orchestration_v2_projection_threads
      WHERE deleted_at IS NULL
        AND (
          json_extract(payload_json, '$.kodoLoop.status') IN ('active', 'held')
          OR json_extract(payload_json, '$.kodoLoop.cleanup') IS NOT NULL
        )
    `.pipe(
      Effect.map((rows) => rows.map((row) => ThreadId.make(row.thread_id))),
      Effect.orElseSucceed((): ReadonlyArray<ThreadId> => []),
    );
    for (const id of found) tracked.add(id);

    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) => {
        if (!("threadId" in event) || !affectsLoop(event)) return Effect.void;
        const threadId = event.threadId;
        if (isTrackedLoopEvent(event)) tracked.add(threadId);
        if (!tracked.has(threadId)) return Effect.void;
        return Effect.all([due.invalidate, look(threadId).pipe(Effect.forkScoped)], {
          discard: true,
        });
      }).pipe(
        Effect.catchCause((cause) => Effect.logWarning("kodo.loop.events-failed", { cause })),
      ),
    );

    const sweep = Effect.fn("KodoLoopWorker.sweep")(function* () {
      if (tracked.size === 0) return;
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      if (yield* due.isIdle(nowMs)) return;
      const readVersion = yield* due.version;
      let moving = false;
      for (const threadId of tracked) {
        const result = yield* look(threadId);
        if (result === "acted" || result === "failed" || result === "waiting") moving = true;
      }
      // A look that did something, or could not, is repeated on the next tick.
      if (!moving) yield* due.record(readVersion, Infinity, nowMs);
    });
    yield* scheduler.register("kodo-loop", sweep());
  }),
);
