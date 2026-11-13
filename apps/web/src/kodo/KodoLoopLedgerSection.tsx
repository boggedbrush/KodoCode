import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, KodoLoopLedgerTotals } from "@t3tools/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { serverEnvironment } from "../state/server";
import { KODO_LOOP_LEDGER_EMPTY_NOTE, describeKodoLoopLedger } from "./loopLedger.logic";

function LedgerBlock(props: { readonly title: string; readonly totals: KodoLoopLedgerTotals }) {
  const view = describeKodoLoopLedger(props.totals);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-xs text-muted-foreground">{props.title}</h3>
      {view.counts === null ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <>
          <p className="text-base font-medium text-foreground tabular-nums">
            {view.headline ?? view.counts}
          </p>
          {view.headline === null ? null : (
            <p className="text-xs text-muted-foreground tabular-nums">{view.counts}</p>
          )}
          {view.basis === null ? null : (
            <p className="text-xs text-muted-foreground">{view.basis}</p>
          )}
          {view.notes.map((note) => (
            <p key={note} className="text-xs text-muted-foreground">
              {note}
            </p>
          ))}
          {view.tokens === null ? null : (
            <p className="text-xs text-muted-foreground tabular-nums">{view.tokens} reported.</p>
          )}
          {view.tokensByModel.length === 0 ? null : (
            <ul role="list" aria-label="Tokens by model" className="grid gap-0.5">
              {view.tokensByModel.map((entry) => (
                <li
                  key={entry.model}
                  className="text-xs wrap-anywhere text-muted-foreground tabular-nums"
                >
                  {entry.model}: {entry.tokens} tokens
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function EnvironmentLedger(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string | null;
}) {
  // Read when the page opens (staleTime 0); loop events do not refetch it.
  const result = useAtomValue(
    serverEnvironment.kodoLoopLedger({ environmentId: props.environmentId, input: {} }),
  );
  const summary = AsyncResult.getOrElse(result, () => null);
  return (
    <div className="flex flex-col gap-2" data-kodo-loop-ledger>
      {props.label === null ? null : <p className="text-xs text-muted-foreground">{props.label}</p>}
      {summary === null ? (
        <p className="text-sm text-muted-foreground">
          {result._tag === "Failure"
            ? "Loop savings are unavailable from this environment."
            : "Loading loop savings."}
        </p>
      ) : summary.allTime.loops === 0 ? (
        <p className="text-sm text-muted-foreground">
          No loops recorded yet. {KODO_LOOP_LEDGER_EMPTY_NOTE}
        </p>
      ) : (
        <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2">
          <LedgerBlock title="Last 30 days" totals={summary.last30Days} />
          <LedgerBlock title="All time" totals={summary.allTime} />
        </div>
      )}
    </div>
  );
}

/** The Usage page's loop savings, one block per environment that can report usage. */
export function KodoLoopLedgerSection(props: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly canReadDiagnostics: boolean;
    readonly isConnected: boolean;
  }>;
}) {
  const readable = props.environments.filter(
    (environment) => environment.canReadDiagnostics && environment.isConnected,
  );
  if (readable.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Loop savings">
      <h2 className="text-sm font-medium text-foreground">Loop savings</h2>
      {readable.map((environment) => (
        <EnvironmentLedger
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={readable.length > 1 ? environment.label : null}
        />
      ))}
    </section>
  );
}
