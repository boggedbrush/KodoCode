// Reads the loop savings ledger: lifetime and last-30-days totals for the Usage page.
import {
  KODO_LOOP_LEDGER_MODELS_MAX,
  KODO_LOOP_LEDGER_REFERENCE_MODELS_MAX,
  KODO_LOOP_LEDGER_WINDOW_DAYS,
  KodoLoopLedgerReadError,
  type KodoLoopLedgerSummary,
  type KodoLoopLedgerTotals,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

export class KodoLoopLedger extends Context.Service<
  KodoLoopLedger,
  { readonly read: Effect.Effect<KodoLoopLedgerSummary, KodoLoopLedgerReadError> }
>()("t3/kodo/ledger/LoopLedger/KodoLoopLedger") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Each query is one range scan of kodo_loop_ledger_kind_ended_at_idx (kind, ended_at) plus a row
  // fetch per loop in range: O(loops in the window), about 150 bytes each. The 30-day window reads
  // only recent loops; all-time reads every loop once, which stays in single-digit milliseconds for
  // thousands of loops. Nothing here scans the thread tables.
  const totals = Effect.fn("KodoLoopLedger.totals")(function* (from: string) {
    const [sums] = yield* sql<{
      readonly loops: number;
      readonly rounds: number | null;
      readonly priced: number | null;
      readonly partial: number | null;
      readonly unpriced: number | null;
      readonly actual: number | null;
      readonly reference: number | null;
      readonly tokens: number | null;
      readonly no_usage: number | null;
    }>`
      SELECT
        COUNT(*) AS loops,
        SUM(rounds) AS rounds,
        SUM(priced) AS priced,
        SUM(partial) AS partial,
        SUM(unpriced) AS unpriced,
        SUM(actual_usd) AS actual,
        SUM(reference_usd) AS reference,
        SUM(tokens) AS tokens,
        SUM(tokens IS NULL) AS no_usage
      FROM kodo_loop_ledger
      WHERE kind = 'loop' AND ended_at >= ${from}
    `;
    const models = yield* sql<{ readonly model: string; readonly tokens: number }>`
      SELECT j.key AS model, SUM(j.value) AS tokens
      FROM kodo_loop_ledger AS l, json_each(l.models_json) AS j
      WHERE l.kind = 'loop' AND l.ended_at >= ${from} AND l.models_json IS NOT NULL
      GROUP BY j.key
      ORDER BY tokens DESC, model
      LIMIT ${KODO_LOOP_LEDGER_MODELS_MAX}
    `;
    const references = yield* sql<{ readonly model: string }>`
      SELECT reference_model AS model
      FROM kodo_loop_ledger
      WHERE kind = 'loop' AND ended_at >= ${from} AND reference_model IS NOT NULL
      GROUP BY reference_model
      ORDER BY MAX(ended_at) DESC
      LIMIT ${KODO_LOOP_LEDGER_REFERENCE_MODELS_MAX}
    `;
    const actualUsd = sums?.actual ?? 0;
    const referenceUsd = sums?.reference ?? 0;
    return {
      loops: sums?.loops ?? 0,
      rounds: sums?.rounds ?? 0,
      pricedLoops: sums?.priced ?? 0,
      partialLoops: sums?.partial ?? 0,
      unpricedLoops: sums?.unpriced ?? 0,
      actualUsd,
      referenceUsd,
      savedUsd: referenceUsd - actualUsd,
      tokens: sums?.tokens ?? 0,
      noUsageLoops: sums?.no_usage ?? 0,
      tokensByModel: models.map((row) => ({ model: row.model, tokens: row.tokens })),
      referenceModels: references.map((row) => row.model),
    } satisfies KodoLoopLedgerTotals;
  });

  const read = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const since = DateTime.formatIso(
      DateTime.subtract(now, { days: KODO_LOOP_LEDGER_WINDOW_DAYS }),
    );
    return {
      readAt: DateTime.formatIso(now),
      allTime: yield* totals(""),
      last30Days: yield* totals(since),
    } satisfies KodoLoopLedgerSummary;
  }).pipe(
    Effect.withSpan("KodoLoopLedger.read"),
    Effect.mapError((cause) => new KodoLoopLedgerReadError({ cause })),
  );

  return KodoLoopLedger.of({ read });
});

export const layer = Layer.effect(KodoLoopLedger, make);
