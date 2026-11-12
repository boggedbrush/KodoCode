import { formatKodoTokens, formatKodoUsd, type KodoLoopSummary } from "./loopCard.logic";

const pct = (value: number) => `${Math.round(value)}%`;

/** The savings estimate, the share of tokens by model, and the limit readings seen around each stage. */
export function KodoLoopSavingsPanel(props: { readonly summary: KodoLoopSummary }) {
  const { savings, byModel, limitChanges } = props.summary;
  if (savings.kind === "none" && byModel.length === 0 && limitChanges.length === 0) return null;
  return (
    <div data-kodo-loop-savings={savings.kind} className="grid gap-1 text-muted-foreground">
      {savings.kind === "estimate" ? (
        <div className="grid gap-0.5">
          <p className="font-medium text-foreground">
            Estimated savings: {formatKodoUsd(Math.abs(savings.savedUsd))}{" "}
            {savings.savedUsd < 0 ? "more" : "less"} ({pct(Math.abs(savings.savedPct))})
          </p>
          <p>
            Ran for {formatKodoUsd(savings.actualUsd)}; the same tokens on {savings.referenceModel}{" "}
            would cost {formatKodoUsd(savings.referenceUsd)}.
          </p>
          {savings.unpricedStages.length > 0 ? (
            <p>Not priced, so left out: {savings.unpricedStages.join(", ")}.</p>
          ) : null}
          <p className="text-xs">An estimate: a stronger model would use different token counts.</p>
        </div>
      ) : null}
      {savings.kind === "same-model" ? (
        <p>
          Nothing to compare: Code ran on {savings.referenceModel}, the model used as the reference.
        </p>
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
        <div className="grid gap-0.5">
          <p>Limit readings seen around each stage (other work moves them too):</p>
          <ul role="list" className="grid gap-0.5">
            {limitChanges.map((change) => (
              <li key={change.stage}>
                {change.stage}:{" "}
                {change.windows
                  .map((window) => `${window.window} ${pct(window.before)} to ${pct(window.after)}`)
                  .join(", ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
