import type { KodoLoop } from "@t3tools/contracts";

import { ComposerBanner } from "../components/chat/ComposerBanner";
import { KodoInlineText } from "./KodoInlineText";
import {
  KODO_LOOP_CONTEXT_NOTE,
  formatKodoTokens,
  kodoLoopOutstanding,
  summarizeKodoLoop,
} from "./loopCard.logic";
import { KodoLoopSavingsPanel } from "./KodoLoopSavingsPanel";

/**
 * What a finished loop did, collapsed to why it stopped, one line of totals and the savings headline.
 * "Details" opens the rounds, what is outstanding, the budget notes and the savings detail inside a
 * height-capped scroll area, so the card never takes over the conversation. Every figure is measured
 * or labelled an estimate, a floor reads "At least", and one the loop does not have is said to be missing.
 */
export function KodoLoopSummary(props: {
  readonly loop: KodoLoop;
  readonly stopText: string | null;
}) {
  const summary = summarizeKodoLoop(props.loop);
  const outstanding = kodoLoopOutstanding(props.loop);
  const latest = summary.rounds.at(-1)?.round;
  return (
    <div data-kodo-loop-summary className="grid gap-1">
      {props.stopText === null ? null : (
        <p className="text-muted-foreground wrap-anywhere">{props.stopText}</p>
      )}
      <p data-kodo-loop-totals className="text-muted-foreground">
        {summary.totalsLine}
      </p>
      {summary.savingsHeadline === null ? null : (
        <p data-kodo-loop-headline className="font-medium text-foreground wrap-anywhere">
          {summary.savingsHeadline}
        </p>
      )}
      <details data-kodo-loop-details className="group">
        <summary className="w-fit cursor-pointer text-muted-foreground">Details</summary>
        <ComposerBanner.Scroll>
          <div className="mt-1 grid gap-2 border-t border-border/60 pt-2">
            <p className="text-foreground">
              {summary.roundsRun} round{summary.roundsRun === 1 ? "" : "s"} run
            </p>
            {outstanding === null ? null : (
              <div data-kodo-loop-outstanding className="grid gap-0.5 text-muted-foreground">
                <p className="font-medium text-foreground">
                  Still outstanding after the last judgement
                </p>
                {outstanding.summary === null ? null : (
                  <p className="wrap-anywhere">
                    <KodoInlineText text={outstanding.summary} />
                  </p>
                )}
                <ul role="list" className="grid gap-0.5">
                  {outstanding.items.map((item) => (
                    <li key={item} className="flex gap-1.5 wrap-anywhere">
                      <span aria-hidden>-</span>
                      <span>
                        <KodoInlineText text={item} />
                      </span>
                    </li>
                  ))}
                </ul>
                {outstanding.more === 0 ? null : <p>and {outstanding.more} more</p>}
              </div>
            )}
            <div className="grid gap-1">
              {summary.rounds.map((round) => (
                <details key={round.round} open={round.round === latest} className="group">
                  <summary className="cursor-pointer text-muted-foreground">
                    Round {round.round}
                  </summary>
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
              {summary.cacheReadTokens === null || summary.cacheReadTokens === 0 ? null : (
                <p>
                  Cache reads, not counted by the token cap:{" "}
                  {formatKodoTokens(summary.cacheReadTokens)}.
                </p>
              )}
              {summary.usageNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
              {summary.budgetNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
            <KodoLoopSavingsPanel summary={summary} />
            <p className="text-muted-foreground/80 text-xs">{KODO_LOOP_CONTEXT_NOTE}</p>
          </div>
        </ComposerBanner.Scroll>
      </details>
    </div>
  );
}
