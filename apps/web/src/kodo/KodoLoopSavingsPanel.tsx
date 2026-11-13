import { formatKodoTokens, type KodoLoopSummary } from "./loopCard.logic";

const pct = (value: number) => `${Math.round(value)}%`;

/**
 * The detail behind the savings headline: what it was computed from, what could not be priced, the
 * share of tokens by model, and the limit readings seen around each stage, folded into one disclosure.
 */
export function KodoLoopSavingsPanel(props: { readonly summary: KodoLoopSummary }) {
  const { savings, byModel, limitChanges } = props.summary;
  if (savings.kind === "none" && byModel.length === 0 && limitChanges.length === 0) return null;
  return (
    <div data-kodo-loop-savings={savings.kind} className="grid gap-1 text-muted-foreground">
      {savings.kind === "estimate" ? (
        <div className="grid gap-0.5">
          <p>
            Ran for ${savings.actualUsd.toFixed(2)}; the same tokens on {savings.referenceModel}{" "}
            would cost ${savings.referenceUsd.toFixed(2)}.
          </p>
          {savings.unpricedStages.length > 0 ? (
            <p>Not priced, so left out: {savings.unpricedStages.join(", ")}.</p>
          ) : null}
          <p className="text-xs">An estimate: a stronger model would use different token counts.</p>
        </div>
      ) : null}
      {savings.kind === "unpriced" ? (
        <p>
          Pricing is unavailable for {savings.unpricedStages.join(", ")}, so no savings estimate is
          shown. Token share is below.
        </p>
      ) : null}
      {savings.kind === "no-reference" ? (
        <p>Set a Judge or Review model in Settings to compare against; no estimate is shown.</p>
      ) : null}
      {byModel.length > 0 ? (
        <ul role="list" aria-label="Tokens by model" className="grid gap-0.5">
          {byModel.map((entry) => (
            <li key={entry.model} className="wrap-anywhere">
              {entry.model}: {formatKodoTokens(entry.tokens)} tokens ({pct(entry.sharePct)})
            </li>
          ))}
        </ul>
      ) : null}
      {limitChanges.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer">Limit readings around each stage</summary>
          <p className="mt-0.5 text-xs">Other work on the account moves them too.</p>
          <ul role="list" className="mt-0.5 grid gap-0.5">
            {limitChanges.map((change) => (
              <li key={change.stage}>
                {change.stage}:{" "}
                {change.windows
                  .map((window) => `${window.window} ${pct(window.before)} to ${pct(window.after)}`)
                  .join(", ")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
