// The write path for delegated work, into the table loopLedgerStore.ts owns. An upsert keyed by the
// worker's unit id, guarded so an older reading never replaces a newer one: replaying an event, or a
// worker that finishes twice, leaves one row, and tokens a resumed worker reports later replace it.
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import type { WorkerLedgerRow } from "./delegationLedgerRow.ts";

export const recordDelegatedWorker = Effect.fn("KodoDelegationLedger.record")(function* (
  row: WorkerLedgerRow,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO kodo_loop_ledger (
      loop_id, kind, thread_id, project_id, ended_at, revision, rounds, stop_reason,
      tokens, models_json, actual_usd, reference_usd, reference_model, priced, unpriced, partial,
      child_thread_id
    )
    VALUES (
      ${row.unitId}, 'sub-agents', ${row.leadThreadId}, ${row.projectId}, ${row.endedAt},
      ${row.revision}, ${row.tasks}, ${row.stopReason}, ${row.tokens}, ${row.modelsJson},
      ${row.actualUsd}, ${row.referenceUsd}, ${row.referenceModel}, ${row.priced}, ${row.unpriced},
      ${row.partial}, ${row.workerThreadId}
    )
    ON CONFLICT(loop_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      project_id = excluded.project_id,
      ended_at = excluded.ended_at,
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
      partial = excluded.partial,
      child_thread_id = excluded.child_thread_id
    WHERE excluded.revision >= kodo_loop_ledger.revision
  `;
});
