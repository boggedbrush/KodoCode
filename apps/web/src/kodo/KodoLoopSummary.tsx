import type { KodoLoop } from "@t3tools/contracts";

import { KodoInlineText } from "./KodoInlineText";
import {
  KODO_LOOP_CONTEXT_NOTE,
  formatKodoTokens,
  formatKodoUsd,
  summarizeKodoLoop,
} from "./loopCard.logic";
import { KodoLoopSavingsPanel } from "./KodoLoopSavingsPanel";

/**
 * What a finished loop did: a line per stage per round (the latest round open, earlier ones folded),
 * why it stopped, what it spent, and the savings estimate. Every figure is measured or labelled an
 * estimate, and one the loop does not have is said to be missing.
 */
export function KodoLoopSummary(props: { readonly loop: KodoLoop }) {
  const summary = summarizeKodoLoop(props.loop);
  const latest = summary.rounds.at(-1)?.round;
  return (
    <div data-kodo-loop-summary className="mt-1 grid gap-2 border-t border-border/60 pt-2">
      <p className="text-foreground">
        {summary.roundsRun} round{summary.roundsRun === 1 ? "" : "s"} run
      </p>
      <div className="grid gap-1">
        {summary.rounds.map((round) => (
          <details key={round.round} open={round.round === latest} className="group">
            <summary className="cursor-pointer text-muted-foreground">Round {round.round}</summary>
            <ul role="list" className="mt-0.5 grid gap-0.5 ps-3">
              {round.stages.map((entry) => (
                <li
                  key={`${entry.stage}-${entry.line}`}
                  className="wrap-anywhere text-muted-foreground"
                >
                  <span className="text-foreground">{entry.label}</span>{" "}
                  <KodoInlineText text={entry.line} />
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <div data-kodo-loop-usage className="grid gap-0.5 text-muted-foreground">
        {summary.tokens === null ? (
          <p>Token usage was not reported by the provider.</p>
        ) : (
          <p>
            {summary.partial ? "At least " : ""}
            {formatKodoTokens(summary.tokens)} tokens
            {summary.costUsd === null
              ? ", no price available."
              : `, ${summary.partial || summary.unpricedStages.length > 0 ? "at least " : ""}${formatKodoUsd(summary.costUsd)} at API prices.`}
          </p>
        )}
        {summary.unreportedStages.length > 0 && summary.tokens !== null ? (
          <p>No usage reported for {summary.unreportedStages.join(", ")}.</p>
        ) : null}
        {summary.unpricedStages.length > 0 && summary.tokens !== null ? (
          <p>No price for {summary.unpricedStages.join(", ")}; not in the cost.</p>
        ) : null}
        {summary.budgetNotes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
      <KodoLoopSavingsPanel summary={summary} />
      <p className="text-muted-foreground/80 text-xs">{KODO_LOOP_CONTEXT_NOTE}</p>
    </div>
  );
}
