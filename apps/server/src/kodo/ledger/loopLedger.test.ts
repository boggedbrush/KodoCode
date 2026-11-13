import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type KodoLoop,
  type KodoLoopStageRecord,
  type ModelSelection,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { applyKodoLoopOp, type KodoLoopOp } from "../loop/loopState.ts";
import { computeLoopSavings } from "../loop/loopSpend.ts";
import { testLoop, testRecord } from "../loop/testing.ts";
import * as KodoLoopLedger from "./LoopLedger.ts";
import { loopLedgerRow } from "./loopLedgerRow.ts";
import { ensureKodoLoopLedger } from "./loopLedgerStore.ts";

const instanceId = ProviderInstanceId.make("claude-main");
const select = (model: string): ModelSelection => ({ instanceId, model });
const reference = select("big");
const providerInstanceId = instanceId;

const usage = (over: Partial<NonNullable<KodoLoopStageRecord["usage"]>> = {}) => ({
  uncachedInputTokens: 600_000,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 100_000,
  reasoningTokens: 0,
  complete: true,
  ...over,
});

/** A code stage on `model`: priced at `cost`, and at `referenceCost` on the reference model. */
const code = (
  round: number,
  model: string,
  cost: number | undefined,
  referenceCost: number | undefined,
  over: Partial<KodoLoopStageRecord> = {},
) =>
  testRecord({
    round,
    stage: "code",
    model: select(model),
    usage: usage({
      ...(cost === undefined ? {} : { costUsd: cost }),
      ...(referenceCost === undefined ? {} : { referenceCostUsd: referenceCost }),
    }),
    ...over,
  });

const endedLoop = (
  stages: ReadonlyArray<KodoLoopStageRecord>,
  over: Partial<KodoLoop> = {},
): KodoLoop => {
  const savings = computeLoopSavings(stages, reference);
  return testLoop({
    status: "done",
    stopReason: "complete",
    revision: 5,
    round: Math.max(1, ...stages.map((stage) => stage.round)),
    stage: "judge",
    stages,
    ...(savings === undefined ? {} : { savings }),
    ...over,
  });
};

const row = (loop: KodoLoop) =>
  loopLedgerRow({ loop, threadId: "t1", projectId: "p1", endedAt: "2026-05-01T00:00:00.000Z" });

describe("a loop's ledger row", () => {
  it("is absent while the loop runs", () => {
    expect(row(testLoop({ status: "active" }))).toBeUndefined();
    expect(row(testLoop({ status: "held", hold: "plan_approval" }))).toBeUndefined();
  });

  it.each([
    {
      name: "priced on both sides",
      loop: endedLoop([code(1, "small", 1, 10)]),
      expected: { priced: 1, unpriced: 0, partial: 0, actualUsd: 1, referenceUsd: 10 },
    },
    {
      name: "priced, with a compared stage that has no price",
      loop: endedLoop([code(1, "small", 1, 10), code(2, "small", undefined, undefined)]),
      expected: { priced: 1, unpriced: 0, partial: 1, actualUsd: 1, referenceUsd: 10 },
    },
    {
      name: "priced, with partial usage in a stage",
      loop: endedLoop([
        code(1, "small", 1, 10, {
          usage: usage({ costUsd: 1, referenceCostUsd: 10, complete: false }),
        }),
      ]),
      expected: { priced: 1, unpriced: 0, partial: 1 },
    },
    {
      name: "priced, with a stage still to be recorded",
      loop: endedLoop([code(1, "small", 1, 10)], { cleanup: { record: true } }),
      expected: { priced: 1, unpriced: 0, partial: 1 },
    },
    {
      name: "unpriced: nothing could be priced, and it is not zero",
      loop: endedLoop([code(1, "small", undefined, undefined)]),
      expected: { priced: 0, unpriced: 1, partial: 0, actualUsd: null, referenceUsd: null },
    },
    {
      name: "unpriced: the provider reported no usage",
      loop: endedLoop([testRecord({ round: 1, stage: "code", model: select("small") })]),
      expected: { priced: 0, unpriced: 1, tokens: null, modelsJson: null },
    },
    {
      name: "nothing to compare: it ran on the reference model",
      loop: endedLoop([code(1, "big", 10, 10)]),
      expected: { priced: 0, unpriced: 0, partial: 0, referenceModel: null },
    },
    {
      name: "nothing to compare: no reference model was set",
      loop: endedLoop([code(1, "small", 1, 10)], { savings: undefined }),
      expected: { priced: 0, unpriced: 0, partial: 0, actualUsd: null },
    },
  ])("$name", ({ loop, expected }) => {
    expect(row(loop)).toMatchObject(expected);
  });

  it("carries rounds, stop reason, tokens and tokens by model", () => {
    const loop = endedLoop(
      [
        code(1, "small", 1, 10),
        code(2, "small", 1, 10),
        testRecord({ round: 2, stage: "judge", model: reference, usage: usage({ costUsd: 5 }) }),
      ],
      { status: "stopped", stopReason: "round_cap" },
    );
    const result = row(loop)!;
    expect(result).toMatchObject({
      rounds: 2,
      stopReason: "round_cap",
      revision: 5,
      tokens: 2_100_000,
    });
    expect(JSON.parse(result.modelsJson!)).toEqual({ small: 1_400_000, big: 700_000 });
  });

  it("counts a loop that ran no stage as a loop with no rounds and no usage", () => {
    expect(row(endedLoop([], { status: "stopped", stopReason: "user_stop" }))).toMatchObject({
      rounds: 0,
      tokens: null,
      priced: 0,
      unpriced: 0,
    });
  });
});

const providerThread = (
  id: ThreadId,
  projectId: ProjectId,
  at: DateTime.Utc,
  extra: Partial<OrchestrationV2AppThread> = {},
): OrchestrationV2AppThread => ({
  createdBy: "user",
  creationSource: "web",
  id,
  projectId,
  title: "Loop thread",
  providerInstanceId,
  modelSelection: select("small"),
  runtimeMode: "full-access",
  interactionMode: "code",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
  forkedFrom: null,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
  ...extra,
});

const layerTest = Layer.mergeAll(
  KodoLoopLedger.layer.pipe(
    Layer.provideMerge(
      ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
    ),
  ),
);

let eventCount = 0;
const at = (iso: string) => DateTime.makeUnsafe(iso);

/** Applies the thread's events the way the commit does: the thread is created, then each state of its loop. */
const applyThread = Effect.fnUntraced(function* (input: {
  readonly threadId: string;
  readonly projectId?: string;
  readonly states: ReadonlyArray<{
    readonly loop?: KodoLoop;
    readonly at: string;
    readonly type?: "thread.metadata-updated" | "thread.deleted" | "thread.visited";
  }>;
}) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = ThreadId.make(input.threadId);
  const projectId = ProjectId.make(input.projectId ?? "p1");
  const first = at(input.states[0]!.at);
  const sql = yield* SqlClient.SqlClient;
  const existing =
    yield* sql`SELECT 1 FROM orchestration_v2_projection_threads WHERE thread_id = ${input.threadId}`;
  if (existing.length === 0) {
    yield* store.apply({
      id: EventId.make(`event-${eventCount++}`),
      type: "thread.created",
      threadId,
      occurredAt: first,
      payload: providerThread(threadId, projectId, first),
    });
  }
  for (const state of input.states) {
    const when = at(state.at);
    const payload = providerThread(threadId, projectId, first, {
      updatedAt: when,
      ...(state.loop === undefined ? {} : { kodoLoop: state.loop }),
      ...(state.type === "thread.deleted" ? { deletedAt: when } : {}),
    });
    yield* store.apply({
      id: EventId.make(`event-${eventCount++}`),
      type: state.type ?? "thread.metadata-updated",
      threadId,
      occurredAt: when,
      payload,
    } as Parameters<typeof store.apply>[0]);
  }
});

const ledgerRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<Record<string, unknown>>`SELECT * FROM kodo_loop_ledger ORDER BY loop_id`;
});

describe("the ledger table", () => {
  it.effect("is created at startup with its version marker", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const marker = yield* sql<{
        version: number;
      }>`SELECT version FROM kodo_schema WHERE name = 'loop_ledger'`;
      expect(marker).toEqual([{ version: 1 }]);
      const plan = yield* sql<{ detail: string }>`
        EXPLAIN QUERY PLAN
        SELECT COUNT(*) FROM kodo_loop_ledger WHERE kind = 'loop' AND ended_at >= '2026-01-01'
      `;
      expect(plan.map((step) => step.detail).join(" ")).toContain(
        "kodo_loop_ledger_kind_ended_at_idx",
      );
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("is created again on a database that has data, and a second run changes nothing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* applyThread({
        threadId: "t1",
        states: [{ loop: endedLoop([code(1, "small", 1, 10)]), at: "2026-05-01T00:00:00.000Z" }],
      });
      expect(yield* ledgerRows).toHaveLength(1);
      const threadsBefore = yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`;
      expect(threadsBefore).toHaveLength(1);

      // A database written before the ledger existed: no table and no marker, but threads.
      yield* sql`DROP TABLE kodo_loop_ledger`;
      yield* sql`DROP TABLE kodo_schema`;
      yield* ensureKodoLoopLedger();
      expect(yield* ledgerRows).toEqual([]);
      expect(yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads`).toHaveLength(1);

      // A second startup finds the marker and leaves the rows alone.
      yield* sql`
        INSERT INTO kodo_loop_ledger (loop_id, thread_id, project_id, ended_at, revision, rounds, stop_reason)
        VALUES ('kept', 't', 'p', '2026-05-01T00:00:00.000Z', 1, 1, 'complete')
      `;
      yield* ensureKodoLoopLedger();
      yield* ensureKodoLoopLedger();
      expect(yield* ledgerRows).toHaveLength(1);
      expect(yield* sql`SELECT version FROM kodo_schema`).toEqual([{ version: 1 }]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps rows when the table exists but its marker is missing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO kodo_loop_ledger (loop_id, thread_id, project_id, ended_at, revision, rounds, stop_reason)
        VALUES ('kept', 't', 'p', '2026-05-01T00:00:00.000Z', 1, 1, 'complete')
      `;
      yield* sql`DELETE FROM kodo_schema`;
      yield* ensureKodoLoopLedger();
      expect(yield* ledgerRows).toHaveLength(1);
      expect(yield* sql`SELECT version FROM kodo_schema`).toEqual([{ version: 1 }]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("leaves a table a newer build wrote alone", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE kodo_schema SET version = 7 WHERE name = 'loop_ledger'`;
      yield* ensureKodoLoopLedger();
      expect(yield* sql`SELECT version FROM kodo_schema`).toEqual([{ version: 7 }]);
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("recording ended loops from thread projection", () => {
  it.effect("records a loop once, in the commit that ends it", () =>
    Effect.gen(function* () {
      const running = testLoop({ revision: 1, stages: [code(1, "small", 1, 10)] });
      yield* applyThread({
        threadId: "t1",
        states: [
          { loop: running, at: "2026-05-01T00:00:00.000Z" },
          { loop: { ...running, revision: 2 }, at: "2026-05-01T00:01:00.000Z" },
        ],
      });
      expect(yield* ledgerRows).toEqual([]);
      const ended = endedLoop([code(1, "small", 1, 10)], { revision: 3 });
      yield* applyThread({
        threadId: "t1",
        states: [
          { loop: ended, at: "2026-05-01T00:02:00.000Z" },
          { loop: ended, at: "2026-05-01T00:02:30.000Z" },
        ],
      });
      const rows = yield* ledgerRows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        loop_id: "L1",
        kind: "loop",
        thread_id: "t1",
        project_id: "p1",
        ended_at: "2026-05-01T00:02:00.000Z",
        rounds: 1,
        priced: 1,
        actual_usd: 1,
        reference_usd: 10,
      });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("is idempotent on the loop id and ignores an older revision arriving late", () =>
    Effect.gen(function* () {
      const newer = endedLoop([code(1, "small", 2, 10)], { revision: 7 });
      const older = endedLoop([code(1, "small", 1, 10)], { revision: 6 });
      yield* applyThread({
        threadId: "t1",
        states: [
          { loop: newer, at: "2026-05-01T00:00:00.000Z" },
          { loop: newer, at: "2026-05-01T00:00:01.000Z" },
        ],
      });
      // Another thread row carrying the same loop at an older revision, as a replay would.
      yield* applyThread({
        threadId: "t2",
        states: [{ loop: older, at: "2026-05-01T00:00:02.000Z" }],
      });
      const rows = yield* ledgerRows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ revision: 7, actual_usd: 2 });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect(
    "updates the row when the interrupted stage is recorded after it settles, without moving the end",
    () =>
      Effect.gen(function* () {
        const ended = endedLoop([code(1, "small", 1, 10)], {
          status: "stopped",
          stopReason: "user_stop",
          revision: 4,
          cleanup: { record: true },
        });
        const settled = endedLoop(
          [code(1, "small", 1, 10), code(2, "small", 2, 10, { status: "interrupted" })],
          { status: "stopped", stopReason: "user_stop", revision: 5 },
        );
        yield* applyThread({
          threadId: "t1",
          states: [
            { loop: ended, at: "2026-05-01T00:00:00.000Z" },
            { loop: settled, at: "2026-05-01T00:00:09.000Z" },
          ],
        });
        const rows = yield* ledgerRows;
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          ended_at: "2026-05-01T00:00:00.000Z",
          revision: 5,
          rounds: 2,
          partial: 0,
          actual_usd: 3,
          reference_usd: 20,
        });
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("updates the row when end-of-loop repricing changes its figures", () =>
    Effect.gen(function* () {
      const unpriced = endedLoop([code(1, "small", undefined, undefined)], { revision: 4 });
      const repriced = endedLoop([code(1, "small", 1, 10)], { revision: 5 });
      yield* applyThread({
        threadId: "t1",
        states: [
          { loop: unpriced, at: "2026-05-01T00:00:00.000Z" },
          { loop: repriced, at: "2026-05-01T00:00:01.000Z" },
        ],
      });
      const rows = yield* ledgerRows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ priced: 1, unpriced: 0, actual_usd: 1 });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("updates one row when a round-capped loop is extended and ends again", () =>
    Effect.gen(function* () {
      const step = (loop: KodoLoop | undefined, op: KodoLoopOp) => {
        const result = applyKodoLoopOp(loop, op);
        if (!result.ok) throw new Error(result.message);
        return result.loop;
      };
      const advance = (loop: KodoLoop, record: KodoLoopStageRecord) =>
        step(loop, {
          type: "advance",
          loopId: loop.loopId,
          expectedRevision: loop.revision,
          record,
        });
      const stagesOf = (loop: KodoLoop) => loop.stages;
      const rounds = (loop: KodoLoop, round: number, finish: "round_cap" | "complete") => {
        let next = advance(loop, testRecord({ round, stage: "plan", model: select("small") }));
        next = advance(next, code(round, "small", 1, 10));
        next = advance(next, testRecord({ round, stage: "review", model: reference }));
        const all = [...stagesOf(next), testRecord({ round, stage: "judge", model: reference })];
        const savings = computeLoopSavings(all, reference);
        return step(next, {
          type: "finish",
          loopId: next.loopId,
          expectedRevision: next.revision,
          status: finish === "complete" ? "done" : "stopped",
          reason: finish,
          record: testRecord({ round, stage: "judge", model: reference }),
          ...(savings === undefined ? {} : { savings }),
        });
      };
      const started = step(undefined, {
        type: "start",
        loopId: "L1",
        request: "Make the parser stricter.",
        requestMessageId: MessageId.make("m-request"),
        startMode: "code",
        maxRounds: 1,
        planApproval: "auto",
        budget: {},
      });
      const capped = rounds(started, 1, "round_cap");
      expect(capped).toMatchObject({ status: "stopped", stopReason: "round_cap" });
      const extended = step(capped, { type: "extend", rounds: 1 });
      expect(extended.status).toBe("active");
      const finished = rounds(extended, 2, "complete");

      yield* applyThread({
        threadId: "t1",
        states: [
          { loop: started, at: "2026-05-01T00:00:00.000Z" },
          { loop: capped, at: "2026-05-01T01:00:00.000Z" },
        ],
      });
      let rows = yield* ledgerRows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        rounds: 1,
        stop_reason: "round_cap",
        actual_usd: 1,
        reference_usd: 10,
      });

      yield* applyThread({
        threadId: "t1",
        states: [
          { loop: extended, at: "2026-05-02T00:00:00.000Z" },
          { loop: finished, at: "2026-05-02T01:00:00.000Z" },
        ],
      });
      rows = yield* ledgerRows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        rounds: 2,
        stop_reason: "complete",
        ended_at: "2026-05-02T01:00:00.000Z",
        actual_usd: 2,
        reference_usd: 20,
      });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps its rows when the thread, or its project's threads, are deleted", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* applyThread({
        threadId: "t1",
        states: [
          { loop: endedLoop([code(1, "small", 1, 10)]), at: "2026-05-01T00:00:00.000Z" },
          {
            loop: endedLoop([code(1, "small", 1, 10)]),
            at: "2026-05-01T00:05:00.000Z",
            type: "thread.deleted",
          },
        ],
      });
      expect(
        yield* sql`SELECT thread_id FROM orchestration_v2_projection_threads WHERE deleted_at IS NOT NULL`,
      ).toHaveLength(1);
      expect(yield* ledgerRows).toHaveLength(1);
      yield* sql`DELETE FROM orchestration_v2_projection_threads`;
      expect(yield* ledgerRows).toHaveLength(1);
      // No foreign key ties a row to a thread or project, so deleting either cannot cascade.
      expect(yield* sql`PRAGMA foreign_key_list(kodo_loop_ledger)`).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("does not back-fill a loop that ended before the ledger, until it changes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The ledger did not exist when this loop ended.
      yield* sql`DROP TABLE kodo_loop_ledger`;
      yield* sql`DROP TABLE kodo_schema`;
      const old = endedLoop([code(1, "small", 1, 10)], { revision: 5 });
      yield* applyThread({
        threadId: "t1",
        states: [{ loop: old, at: "2026-05-01T00:00:00.000Z" }],
      });
      yield* ensureKodoLoopLedger();
      yield* applyThread({
        threadId: "t1",
        states: [{ loop: old, at: "2026-05-02T00:00:00.000Z", type: "thread.visited" }],
      });
      expect(yield* ledgerRows).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("does not break thread projection when the table is missing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`DROP TABLE kodo_loop_ledger`;
      yield* applyThread({
        threadId: "t1",
        states: [{ loop: endedLoop([code(1, "small", 1, 10)]), at: "2026-05-01T00:00:00.000Z" }],
      });
      const stored = yield* sql<{ payload_json: string }>`
        SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id = 't1'
      `;
      expect(JSON.parse(stored[0]!.payload_json).kodoLoop.status).toBe("done");
      const read = yield* KodoLoopLedger.KodoLoopLedger.pipe(
        Effect.flatMap((ledger) => ledger.read),
        Effect.flip,
      );
      expect(read._tag).toBe("KodoLoopLedgerReadError");
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("the ledger totals", () => {
  const now = "2026-06-01T00:00:00.000Z";
  const daysAgo = (days: number, extraMs = 0) =>
    DateTime.formatIso(DateTime.subtract(at(now), { days, milliseconds: -extraMs }));
  const read = Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    const ledger = yield* KodoLoopLedger.KodoLoopLedger;
    return yield* ledger.read;
  });
  const end = (id: string, loop: KodoLoop, when: string) =>
    applyThread({ threadId: id, states: [{ loop: { ...loop, loopId: id }, at: when }] });

  it.effect("is zero for an empty ledger", () =>
    Effect.gen(function* () {
      const summary = yield* read;
      expect(summary.readAt).toBe(now);
      expect(summary.allTime).toEqual({
        loops: 0,
        rounds: 0,
        pricedLoops: 0,
        partialLoops: 0,
        unpricedLoops: 0,
        actualUsd: 0,
        referenceUsd: 0,
        savedUsd: 0,
        tokens: 0,
        noUsageLoops: 0,
        tokensByModel: [],
        referenceModels: [],
      });
      expect(summary.last30Days).toEqual(summary.allTime);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("adds priced, partial and unpriced loops, and splits the 30 day window", () =>
    Effect.gen(function* () {
      yield* end("a", endedLoop([code(1, "small", 1, 10)]), daysAgo(1));
      yield* end(
        "b",
        endedLoop([code(1, "small", 2, 8), code(2, "small", undefined, undefined)]),
        daysAgo(10),
      );
      yield* end("c", endedLoop([code(1, "mid", undefined, undefined)]), daysAgo(20));
      yield* end("d", endedLoop([code(1, "small", 3, 30)]), daysAgo(45));
      yield* end(
        "e",
        endedLoop([testRecord({ round: 1, stage: "code", model: select("small") })]),
        daysAgo(2),
      );
      const summary = yield* read;

      expect(summary.last30Days).toMatchObject({
        loops: 4,
        rounds: 5,
        pricedLoops: 2,
        partialLoops: 1,
        unpricedLoops: 2,
        actualUsd: 3,
        referenceUsd: 18,
        savedUsd: 15,
        noUsageLoops: 1,
        referenceModels: ["big"],
      });
      expect(summary.allTime).toMatchObject({
        loops: 5,
        rounds: 6,
        pricedLoops: 3,
        actualUsd: 6,
        referenceUsd: 48,
        savedUsd: 42,
      });
      // a, b (two stages), c and d each reported 700k, e reported none.
      expect(summary.last30Days.tokens).toBe(700_000 * 4);
      expect(summary.last30Days.tokensByModel).toEqual([
        { model: "small", tokens: 700_000 * 4 - 700_000 },
        { model: "mid", tokens: 700_000 },
      ]);
      expect(summary.allTime.tokensByModel[0]).toEqual({
        model: "small",
        tokens: 700_000 * 5 - 700_000,
      });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("reads a total that cost more than the reference as negative, not as a saving", () =>
    Effect.gen(function* () {
      yield* end("a", endedLoop([code(1, "small", 10, 1)]), daysAgo(1));
      const summary = yield* read;
      expect(summary.allTime.savedUsd).toBe(-9);
      expect(summary.last30Days.pricedLoops).toBe(1);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("puts the 30 day edge on the loop that ended exactly then", () =>
    Effect.gen(function* () {
      yield* end("edge", endedLoop([code(1, "small", 1, 10)]), daysAgo(30));
      yield* end("just-outside", endedLoop([code(1, "small", 1, 10)]), daysAgo(30, -1));
      const summary = yield* read;
      expect(summary.last30Days.loops).toBe(1);
      expect(summary.allTime.loops).toBe(2);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("does not count a loop that is running again after an extend as a second loop", () =>
    Effect.gen(function* () {
      const capped = endedLoop([code(1, "small", 1, 10)], {
        status: "stopped",
        stopReason: "round_cap",
        revision: 4,
      });
      yield* end("a", capped, daysAgo(2));
      const running = { ...capped, status: "active" as const, revision: 5 };
      delete (running as { stopReason?: string }).stopReason;
      yield* applyThread({
        threadId: "a",
        states: [{ loop: { ...running, loopId: "a" }, at: daysAgo(1) }],
      });
      const summary = yield* read;
      assert.equal(summary.allTime.loops, 1);
      assert.equal(summary.allTime.rounds, 1);
    }).pipe(Effect.provide(layerTest)),
  );
});
