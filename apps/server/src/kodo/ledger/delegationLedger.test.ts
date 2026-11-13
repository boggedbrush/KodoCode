// KODO: delegation-ledger - delegated work in the lifetime ledger: one row per worker, never counted
// twice on replay, and the table upgrade that makes room for it.
import { ProjectId, ProviderInstanceId, ThreadId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import {
  finishedWorkerOf,
  makeFinishedWorkerMemory,
  makeDelegationLedgerLook,
} from "../delegation/DelegationLedgerWorker.ts";
import { summarizeDelegation } from "../delegation/delegationUsage.ts";
import * as KodoLoopLedger from "./LoopLedger.ts";
import { workerLedgerRow } from "./delegationLedgerRow.ts";
import { recordDelegatedWorker } from "./delegationLedgerStore.ts";
import { ensureKodoLoopLedger } from "./loopLedgerStore.ts";

const instanceId = ProviderInstanceId.make("claude-main");
const select = (model: string): ModelSelection => ({ instanceId, model });
const leadId = ThreadId.make("lead");
const workerId = ThreadId.make("worker");
const at = (iso: string) => DateTime.makeUnsafe(iso);

const layerTest = Layer.mergeAll(
  KodoLoopLedger.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
);

/** Prices `small` at 1 per million tokens in and out, `big` at 10; anything else has no price. */
const price = (model: string, totals: { uncachedInputTokens: number; outputTokens: number }) =>
  Effect.succeed(
    model === "small"
      ? (totals.uncachedInputTokens + totals.outputTokens) / 1_000_000
      : model === "big"
        ? ((totals.uncachedInputTokens + totals.outputTokens) / 1_000_000) * 10
        : null,
  );

const turn = (inputTokens: number, outputTokens: number, model?: string) =>
  ({
    model,
    turnTokenUsage: {
      usageScope: "main_agent",
      usageStatus: "complete",
      hasSubagents: false,
      inputTokens,
      outputTokens,
    },
  }) as never;

interface Fixture {
  readonly leadLeads: boolean;
  /** The Orchestrator leads, rather than a person's sub-agents lead (KODO: swarm-delegate). */
  readonly leadKind?: "swarm";
  readonly leadModel: string;
  readonly workerModel: string;
  readonly turns: ReadonlyArray<unknown>;
  readonly tasks: ReadonlyArray<{ status: string; completedAt: string }>;
}

const fakeOrchestrator = (fixture: Fixture) =>
  ({
    getThreadShell: (threadId: ThreadId) =>
      Effect.succeed(
        threadId === leadId
          ? ({
              id: leadId,
              projectId: ProjectId.make("p1"),
              modelSelection: select(fixture.leadModel),
              ...(fixture.leadLeads
                ? { kodoLead: { kind: fixture.leadKind ?? "sub-agents" } }
                : {}),
              lineage: { parentThreadId: null, relationshipToParent: null },
            } as never)
          : threadId === workerId
            ? ({
                id: workerId,
                projectId: ProjectId.make("p1"),
                modelSelection: select(fixture.workerModel),
                lineage: { parentThreadId: leadId, relationshipToParent: "subagent" },
              } as never)
            : null,
      ),
    getThreadRecords: (threadId: ThreadId) =>
      Effect.succeed(
        threadId === leadId
          ? ({
              subagents: fixture.tasks.map((task, index) => ({
                id: `task-${index}`,
                origin: "app_owned",
                childThreadId: workerId,
                status: task.status,
                completedAt: at(task.completedAt),
                updatedAt: at(task.completedAt),
              })),
            } as never)
          : ({ providerTurns: fixture.turns } as never),
      ),
  }) as never;

const ledgerRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<Record<string, unknown>>`SELECT * FROM kodo_loop_ledger ORDER BY loop_id`;
});

const baseFixture: Fixture = {
  leadLeads: true,
  leadModel: "big",
  workerModel: "small",
  turns: [turn(600_000, 100_000, "small")],
  tasks: [{ status: "completed", completedAt: "2026-05-01T00:00:00.000Z" }],
};

const lookWith = (fixture: Fixture) =>
  makeDelegationLedgerLook({ orchestrator: fakeOrchestrator(fixture), price })(workerId);

describe("the ledger table, version 2", () => {
  it.effect(
    "upgrades a version 1 table in place, keeps its rows, and a second run changes nothing",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`DROP TABLE kodo_loop_ledger`;
        yield* sql`
        CREATE TABLE kodo_loop_ledger (
          loop_id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'loop', thread_id TEXT NOT NULL,
          project_id TEXT NOT NULL, ended_at TEXT NOT NULL, revision INTEGER NOT NULL,
          rounds INTEGER NOT NULL, stop_reason TEXT NOT NULL, tokens INTEGER, models_json TEXT,
          actual_usd REAL, reference_usd REAL, reference_model TEXT,
          priced INTEGER NOT NULL DEFAULT 0, unpriced INTEGER NOT NULL DEFAULT 0,
          partial INTEGER NOT NULL DEFAULT 0
        )
      `;
        yield* sql`
        INSERT INTO kodo_loop_ledger (loop_id, thread_id, project_id, ended_at, revision, rounds, stop_reason)
        VALUES ('old-loop', 't', 'p', '2026-05-01T00:00:00.000Z', 1, 1, 'complete')
      `;
        yield* sql`UPDATE kodo_schema SET version = 1 WHERE name = 'loop_ledger'`;
        yield* ensureKodoLoopLedger();
        yield* ensureKodoLoopLedger();
        expect(yield* sql`SELECT version FROM kodo_schema WHERE name = 'loop_ledger'`).toEqual([
          { version: 2 },
        ]);
        const columns = yield* sql<{ name: string }>`PRAGMA table_info(kodo_loop_ledger)`;
        expect(columns.map((column) => column.name)).toContain("child_thread_id");
        expect(yield* ledgerRows).toMatchObject([{ loop_id: "old-loop", kind: "loop" }]);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("finishes a half-applied upgrade whose marker was never written", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // The column exists already: the step must not add it twice.
      yield* sql`UPDATE kodo_schema SET version = 1 WHERE name = 'loop_ledger'`;
      yield* ensureKodoLoopLedger();
      expect(yield* sql`SELECT version FROM kodo_schema WHERE name = 'loop_ledger'`).toEqual([
        { version: 2 },
      ]);
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("a finished worker", () => {
  it("is found from a finished app-owned task and from nothing else", () => {
    const event = (payload: Record<string, unknown>) =>
      ({ type: "subagent.updated", payload }) as never;
    expect(
      finishedWorkerOf(
        event({ origin: "app_owned", childThreadId: workerId, status: "completed" }),
      ),
    ).toBe(workerId);
    expect(
      finishedWorkerOf(event({ origin: "app_owned", childThreadId: workerId, status: "running" })),
    ).toBeUndefined();
    expect(
      finishedWorkerOf(
        event({ origin: "provider_native", childThreadId: workerId, status: "completed" }),
      ),
    ).toBeUndefined();
    expect(
      finishedWorkerOf(event({ origin: "app_owned", childThreadId: null, status: "completed" })),
    ).toBeUndefined();
    expect(finishedWorkerOf({ type: "run.updated", payload: {} } as never)).toBeUndefined();
  });

  it.effect("writes one priced row against the lead's model", () =>
    Effect.gen(function* () {
      yield* lookWith(baseFixture);
      expect(yield* ledgerRows).toMatchObject([
        {
          loop_id: "worker:worker",
          kind: "sub-agents",
          thread_id: "lead",
          child_thread_id: "worker",
          project_id: "p1",
          rounds: 1,
          stop_reason: "completed",
          tokens: 700_000,
          actual_usd: 0.7,
          reference_usd: 7,
          reference_model: "big",
          priced: 1,
          unpriced: 0,
          partial: 0,
        },
      ]);
    }).pipe(Effect.provide(layerTest)),
  );

  // KODO: swarm-delegate - the Orchestrator's workers are sub-agent workers in the ledger, in the project they ran in
  it.effect(
    "records the Orchestrator's worker as a sub-agent worker of its own, in the worker's project",
    () =>
      Effect.gen(function* () {
        yield* lookWith({ ...baseFixture, leadKind: "swarm" });
        expect(yield* ledgerRows).toMatchObject([
          { loop_id: "worker:worker", kind: "sub-agents", thread_id: "lead", priced: 1 },
        ]);
      }).pipe(Effect.provide(layerTest)),
  );

  it("looks again at a recorded worker whose provider turn reports usage later, and at no other thread", () => {
    const turnEvent = (threadId: ThreadId, payload: Record<string, unknown>) =>
      ({ type: "provider-turn.updated", threadId, payload }) as never;
    const memory = makeFinishedWorkerMemory();
    memory.remember(workerId);
    expect(memory.lateUsageWorkerOf(turnEvent(workerId, { turnTokenUsage: {} }))).toBe(workerId);
    expect(memory.lateUsageWorkerOf(turnEvent(workerId, { tokenUsage: {} }))).toBe(workerId);
    // No usage on the update, another thread, or an event of another kind: nothing to read.
    expect(memory.lateUsageWorkerOf(turnEvent(workerId, {}))).toBeUndefined();
    expect(memory.lateUsageWorkerOf(turnEvent(leadId, { turnTokenUsage: {} }))).toBeUndefined();
    expect(
      memory.lateUsageWorkerOf({ type: "run.updated", threadId: workerId, payload: {} } as never),
    ).toBeUndefined();
    expect(
      makeFinishedWorkerMemory().lateUsageWorkerOf(turnEvent(workerId, { turnTokenUsage: {} })),
    ).toBeUndefined();
  });

  it("forgets a worker that starts another task, and keeps only the newest few", () => {
    const turnEvent = (threadId: ThreadId) =>
      ({ type: "provider-turn.updated", threadId, payload: { turnTokenUsage: {} } }) as never;
    const memory = makeFinishedWorkerMemory(2);
    memory.remember(workerId);
    memory.forgetIfRestarted({
      type: "subagent.updated",
      payload: { origin: "app_owned", childThreadId: workerId, status: "running" },
    } as never);
    expect(memory.lateUsageWorkerOf(turnEvent(workerId))).toBeUndefined();
    const [a, b, c] = ["a", "b", "c"].map((id) => ThreadId.make(id));
    for (const id of [a!, b!, c!]) memory.remember(id);
    expect(memory.lateUsageWorkerOf(turnEvent(a!))).toBeUndefined();
    expect(memory.lateUsageWorkerOf(turnEvent(b!))).toBe(b);
    expect(memory.lateUsageWorkerOf(turnEvent(c!))).toBe(c);
  });

  it.effect("reports a worker of no lead as not worth remembering", () =>
    Effect.gen(function* () {
      const found = yield* lookWith(baseFixture);
      expect(found).toBe(true);
      const unled = yield* lookWith({ ...baseFixture, leadLeads: false });
      expect(unled).toBe(false);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("is not counted twice when the same work is replayed", () =>
    Effect.gen(function* () {
      yield* lookWith(baseFixture);
      yield* lookWith(baseFixture);
      yield* lookWith(baseFixture);
      const rows = yield* ledgerRows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ tokens: 700_000, actual_usd: 0.7 });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keeps one row for a worker that is given a follow-up, with the later tokens", () =>
    Effect.gen(function* () {
      yield* lookWith(baseFixture);
      yield* lookWith({
        ...baseFixture,
        turns: [turn(600_000, 100_000, "small"), turn(300_000, 100_000, "small")],
        tasks: [
          { status: "completed", completedAt: "2026-05-01T00:00:00.000Z" },
          { status: "completed", completedAt: "2026-05-02T00:00:00.000Z" },
        ],
      });
      const rows = yield* ledgerRows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        rounds: 2,
        tokens: 1_100_000,
        ended_at: "2026-05-02T00:00:00.000Z",
      });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("does not let an older reading replace a newer one", () =>
    Effect.gen(function* () {
      yield* lookWith({
        ...baseFixture,
        turns: [turn(600_000, 100_000, "small"), turn(300_000, 100_000, "small")],
      });
      yield* lookWith(baseFixture);
      expect(yield* ledgerRows).toMatchObject([{ tokens: 1_100_000 }]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("writes nothing while a task is unfinished, or when the parent does not lead", () =>
    Effect.gen(function* () {
      yield* lookWith({
        ...baseFixture,
        tasks: [{ status: "running", completedAt: "2026-05-01T00:00:00.000Z" }],
      });
      yield* lookWith({ ...baseFixture, leadLeads: false });
      expect(yield* ledgerRows).toEqual([]);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect.each([
    {
      name: "a model with no price is unpriced, not free",
      fixture: {
        ...baseFixture,
        turns: [turn(600_000, 100_000, "mystery")],
        workerModel: "mystery",
      },
      expected: { priced: 0, unpriced: 1, actual_usd: null, reference_usd: null },
    },
    {
      name: "the lead's own model has nothing to compare",
      fixture: { ...baseFixture, workerModel: "big", turns: [turn(600_000, 100_000, "big")] },
      expected: { priced: 0, unpriced: 0, reference_model: null, tokens: 700_000 },
    },
    {
      name: "a worker whose provider reported nothing keeps no figure, and is not zero",
      fixture: { ...baseFixture, turns: [] },
      expected: { tokens: null, revision: 0, priced: 0, unpriced: 0 },
    },
    {
      name: "a partial report is priced but marked a floor",
      fixture: {
        ...baseFixture,
        turns: [turn(600_000, 100_000, "small"), { model: "small" } as never],
      },
      expected: { priced: 1, partial: 1 },
    },
  ])("$name", ({ fixture, expected }) =>
    Effect.gen(function* () {
      yield* lookWith(fixture);
      expect(yield* ledgerRows).toMatchObject([expected]);
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("the ledger totals with delegated work", () => {
  const read = Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-06-01T00:00:00.000Z"));
    return yield* (yield* KodoLoopLedger.KodoLoopLedger).read;
  });

  it.effect("add workers to the totals and say how much came from each source", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        INSERT INTO kodo_loop_ledger (
          loop_id, kind, thread_id, project_id, ended_at, revision, rounds, stop_reason, tokens,
          models_json, actual_usd, reference_usd, reference_model, priced
        ) VALUES (
          'a-loop', 'loop', 't', 'p', '2026-05-30T00:00:00.000Z', 1, 2, 'done', 1000,
          '{"small":1000}', 1, 4, 'big', 1
        )
      `;
      yield* lookWith(baseFixture);
      const { allTime, last30Days } = yield* read;
      expect(allTime).toMatchObject({
        loops: 1,
        rounds: 2,
        workers: 1,
        pricedLoops: 2,
        tokens: 701_000,
        actualUsd: 1.7,
        referenceUsd: 11,
        referenceModels: ["big"],
        split: {
          loop: { tokens: 1000, savedUsd: 3, priced: 1 },
          subAgents: { tokens: 700_000, savedUsd: 6.3, priced: 1 },
        },
      });
      expect(allTime.tokensByModel).toEqual([{ model: "small", tokens: 701_000 }]);
      // The worker finished 31 days before the read; the loop 2.
      expect(last30Days).toMatchObject({ loops: 1, workers: 0 });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("keep one row when a worker that reported nothing is recorded again", () =>
    Effect.gen(function* () {
      const row = workerLedgerRow({
        worker: {
          threadId: workerId,
          sameModel: false,
          usage: undefined,
          modelTokens: [],
        },
        leadThreadId: "lead",
        projectId: "p1",
        endedAt: "2026-05-01T00:00:00.000Z",
        tasks: 1,
        stopReason: "completed",
        referenceModel: "big",
      });
      yield* recordDelegatedWorker(row);
      yield* recordDelegatedWorker(row);
      expect(yield* ledgerRows).toHaveLength(1);
    }).pipe(Effect.provide(layerTest)),
  );
});

describe("a lead's usage", () => {
  const side = (id: string, model: string, turns: ReadonlyArray<unknown>) =>
    ({ threadId: ThreadId.make(id), model: select(model), turns }) as never;

  it.effect(
    "prices the lead and its workers apart and measures the saving against the lead's model",
    () =>
      Effect.gen(function* () {
        const usage = yield* summarizeDelegation({
          lead: side("lead", "big", [turn(100_000, 20_000, "big")]),
          workers: [
            side("w1", "small", [turn(600_000, 100_000, "small")]),
            side("w2", "small", [turn(300_000, 100_000, "small")]),
          ],
          price,
        });
        expect(usage).toMatchObject({
          workerCount: 2,
          unreportedWorkers: 0,
          lead: { tokens: 120_000, costUsd: 1.2, complete: true },
          workers: { tokens: 1_100_000, costUsd: 1.1, complete: true },
          savings: {
            actualUsd: 1.1,
            referenceUsd: 11,
            pricedWorkers: 2,
            unpricedWorkers: 0,
            sameModelWorkers: 0,
          },
        });
        expect(usage.savings!.savedUsd).toBeCloseTo(9.9);
      }),
  );

  it.effect("never reads a missing price or a silent worker as zero", () =>
    Effect.gen(function* () {
      const usage = yield* summarizeDelegation({
        lead: side("lead", "big", []),
        workers: [
          side("w1", "mystery", [turn(1000, 100, "mystery")]),
          side("w2", "small", []),
          side("w3", "big", [turn(1000, 100, "big")]),
        ],
        price,
      });
      expect(usage.lead).toBeUndefined();
      expect(usage.unreportedWorkers).toBe(1);
      expect(usage.workers).toMatchObject({ tokens: 2200, complete: false });
      expect(usage.savings).toMatchObject({
        pricedWorkers: 0,
        unpricedWorkers: 1,
        sameModelWorkers: 1,
      });
    }),
  );

  it.effect("prices a turn that names no model at the thread's own", () =>
    Effect.gen(function* () {
      const usage = yield* summarizeDelegation({
        lead: side("lead", "big", []),
        workers: [side("w1", "small", [turn(500_000, 500_000)])],
        price,
      });
      expect(usage.workers?.costUsd).toBeCloseTo(1);
    }),
  );
});
