// The ledger's table and its write path. The table lives outside upstream's migration sequence: a
// Kodo migration id inside it would collide with a future upstream id, and a recorded-name mismatch
// refuses startup (see persistence/Migrations.ts). It is created with IF NOT EXISTS at startup and
// versioned by its own marker row, so Kodo can evolve it without touching upstream's migrator.
import type { KodoLoop } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import { isKodoLoopTerminal } from "../loop/loopState.ts";
import { loopLedgerRow } from "./loopLedgerRow.ts";

const SCHEMA_NAME = "loop_ledger";

type Sql = SqlClient.SqlClient;

/** Each step takes the table from version N to N + 1; every statement is safe to repeat. */
const SCHEMA_STEPS: ReadonlyArray<(sql: Sql) => Effect.Effect<void, SqlError.SqlError>> = [
  (sql) =>
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS kodo_loop_ledger (
          loop_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT 'loop',
          thread_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          ended_at TEXT NOT NULL,
          revision INTEGER NOT NULL,
          rounds INTEGER NOT NULL,
          stop_reason TEXT NOT NULL,
          tokens INTEGER,
          models_json TEXT,
          actual_usd REAL,
          reference_usd REAL,
          reference_model TEXT,
          priced INTEGER NOT NULL DEFAULT 0,
          unpriced INTEGER NOT NULL DEFAULT 0,
          partial INTEGER NOT NULL DEFAULT 0
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS kodo_loop_ledger_kind_ended_at_idx
        ON kodo_loop_ledger (kind, ended_at)
      `;
    }),
];

/**
 * Creates or upgrades the ledger table. Failure is logged, never raised: the server starts without
 * a ledger, and thread projection skips the write while the table is missing.
 */
export const ensureKodoLoopLedger = Effect.fn("KodoLoopLedger.ensure")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
    CREATE TABLE IF NOT EXISTS kodo_schema (
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL
    )
  `;
    const rows = yield* sql<{ readonly version: number }>`
    SELECT version FROM kodo_schema WHERE name = ${SCHEMA_NAME}
  `;
    const current = rows[0]?.version ?? 0;
    // A newer marker means a newer build wrote it; leave its table alone.
    if (current >= SCHEMA_STEPS.length) return;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const step of SCHEMA_STEPS.slice(current)) yield* step(sql);
        yield* sql`
        INSERT INTO kodo_schema (name, version) VALUES (${SCHEMA_NAME}, ${SCHEMA_STEPS.length})
        ON CONFLICT(name) DO UPDATE SET version = excluded.version
      `;
      }),
    );
  },
  (effect) =>
    effect.pipe(
      Effect.catch((cause) => Effect.logWarning("kodo.loop-ledger.ensure-failed", { cause })),
      Effect.catchDefect((cause) => Effect.logWarning("kodo.loop-ledger.ensure-failed", { cause })),
    ),
);

const isTerminalStatus = (status: unknown) =>
  status === "done" || status === "stopped" || status === "failed";

/**
 * Records an ended loop in the transaction that commits its thread, before the thread row is
 * replaced: the stored row says whether this change ended the loop (`ended_at` moves) or only settled
 * it. A loop that did not change is skipped, so loops that ended before the ledger are not back-filled.
 * Runs on every thread event, hence untraced; a missing table or any failure is skipped.
 */
export const recordEndedKodoLoop = Effect.fnUntraced(function* (
  sql: Sql,
  thread: {
    readonly id: string;
    readonly projectId: string;
    readonly kodoLoop?: KodoLoop | undefined;
  },
  occurredAt: DateTime.DateTime,
) {
  const loop = thread.kodoLoop;
  if (loop === undefined || !isKodoLoopTerminal(loop.status)) return;
  yield* Effect.gen(function* () {
    const stored = yield* sql<{
      readonly loop_id: string | null;
      readonly revision: number | null;
      readonly status: string | null;
    }>`
      SELECT
        json_extract(payload_json, '$.kodoLoop.loopId') AS loop_id,
        json_extract(payload_json, '$.kodoLoop.revision') AS revision,
        json_extract(payload_json, '$.kodoLoop.status') AS status
      FROM orchestration_v2_projection_threads
      WHERE thread_id = ${thread.id}
    `;
    const before = stored[0];
    if (before?.loop_id === loop.loopId && before.revision === loop.revision) return;
    const row = loopLedgerRow({
      loop,
      threadId: thread.id,
      projectId: thread.projectId,
      endedAt: DateTime.formatIso(occurredAt),
    });
    if (row === undefined) return;
    const ended = before?.loop_id !== loop.loopId || !isTerminalStatus(before.status) ? 1 : 0;
    yield* sql`
      INSERT INTO kodo_loop_ledger (
        loop_id, kind, thread_id, project_id, ended_at, revision, rounds, stop_reason,
        tokens, models_json, actual_usd, reference_usd, reference_model, priced, unpriced, partial
      )
      VALUES (
        ${row.loopId}, 'loop', ${row.threadId}, ${row.projectId}, ${row.endedAt}, ${row.revision},
        ${row.rounds}, ${row.stopReason}, ${row.tokens}, ${row.modelsJson}, ${row.actualUsd},
        ${row.referenceUsd}, ${row.referenceModel}, ${row.priced}, ${row.unpriced}, ${row.partial}
      )
      ON CONFLICT(loop_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        project_id = excluded.project_id,
        ended_at = CASE WHEN ${ended} = 1 THEN excluded.ended_at ELSE kodo_loop_ledger.ended_at END,
        revision = excluded.revision,
        rounds = excluded.rounds,
        stop_reason = excluded.stop_reason,
        tokens = excluded.tokens,
        models_json = excluded.models_json,
        actual_usd = excluded.actual_usd,
        reference_usd = excluded.reference_usd,
        reference_model = excluded.reference_model,
        priced = excluded.priced,
        unpriced = excluded.unpriced,
        partial = excluded.partial
      WHERE excluded.revision > kodo_loop_ledger.revision
    `;
  }).pipe(
    Effect.catch((cause) => Effect.logDebug("kodo.loop-ledger.write-skipped", { cause })),
    Effect.catchDefect((cause) => Effect.logDebug("kodo.loop-ledger.write-skipped", { cause })),
  );
});
