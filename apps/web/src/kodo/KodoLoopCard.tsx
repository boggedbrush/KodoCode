import type { KodoLoop } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { KodoInlineText } from "./KodoInlineText";
import { KodoLoopSummary } from "./KodoLoopSummary";
import {
  KODO_LOOP_STAGE_LABEL,
  isKodoLoopRunning,
  kodoLoopHeldReason,
  kodoLoopOutstanding,
  kodoLoopStageStrip,
  kodoLoopStopText,
  type KodoLoopStageState,
} from "./loopCard.logic";

const STATE_CLASS: Record<KodoLoopStageState, string> = {
  done: "text-muted-foreground",
  current: "font-medium text-foreground",
  upcoming: "text-muted-foreground/60",
  stopped: "font-medium text-destructive-foreground",
};

/** The loop's stages in order with where it is, and why it is waiting or why it ended. */
export function KodoLoopCard(props: { readonly loop: KodoLoop }) {
  const { loop } = props;
  const held = kodoLoopHeldReason(loop);
  const stopText = kodoLoopStopText(loop);
  const outstanding = kodoLoopOutstanding(loop);
  return (
    <div data-kodo-loop-card={loop.status} className="grid gap-1.5 py-1 ps-8 pe-3 sm:ps-7">
      <ol aria-label="Loop stages" className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {kodoLoopStageStrip(loop).map(({ stage, state }) => (
          <li
            key={stage}
            data-kodo-loop-stage={stage}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className={cn("inline-flex items-center gap-1", STATE_CLASS[state])}
          >
            {state === "done" ? <CheckIcon aria-hidden className="size-3" /> : null}
            {state === "current" ? (
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
            ) : null}
            {KODO_LOOP_STAGE_LABEL[stage]}
          </li>
        ))}
      </ol>
      {held === null ? null : <p className="text-muted-foreground">{held}</p>}
      {stopText === null ? null : <p className="text-muted-foreground wrap-anywhere">{stopText}</p>}
      {outstanding === null ? null : (
        <div data-kodo-loop-outstanding className="grid gap-0.5 text-muted-foreground">
          <p className="font-medium text-foreground">Still outstanding after the last judgement</p>
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
      {isKodoLoopRunning(loop) ? null : <KodoLoopSummary loop={loop} />}
    </div>
  );
}
