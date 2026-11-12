import {
  ChevronRightIcon,
  ClipboardListIcon,
  CodeXmlIcon,
  ScaleIcon,
  ScanSearchIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "~/lib/utils";
import {
  KODO_LOOP_STAGE_TEXT_CLASS,
  kodoLoopStageMarkerLabel,
  type KodoLoopStageMessageRef,
} from "./loopStageMarker.logic";

const STAGE_ICON = {
  plan: ClipboardListIcon,
  code: CodeXmlIcon,
  review: ScanSearchIcon,
  judge: ScaleIcon,
} as const;

/**
 * A loop stage's hand-off message as one line in the timeline, in the stage's mode colour, with
 * the full evidence text behind a disclosure. The message is the stage's whole prompt, so it is not
 * a bubble: the person reads where the loop is, and opens the text only to see what the stage was told.
 */
export function KodoLoopStageMarker(props: {
  readonly stage: KodoLoopStageMessageRef;
  readonly text: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = STAGE_ICON[props.stage.stage];
  const color = KODO_LOOP_STAGE_TEXT_CLASS[props.stage.stage];
  return (
    <div data-kodo-loop-stage-marker={props.stage.stage} data-expanded={open}>
      <div className="flex min-w-0 items-center gap-2 py-2 text-2xs text-muted-foreground">
        <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${kodoLoopStageMarkerLabel(props.stage)}, ${open ? "hide" : "show"} what the stage was told`}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full border border-border/70 bg-background px-2.5 py-1 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <Icon aria-hidden className={cn("size-3 shrink-0", color)} />
          <span className={cn("font-medium", color)}>{kodoLoopStageMarkerLabel(props.stage)}</span>
          <ChevronRightIcon
            aria-hidden
            className={cn("size-3 shrink-0 opacity-60", open && "rotate-90")}
          />
        </button>
        <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
      </div>
      {open ? (
        <pre
          data-kodo-loop-stage-text
          className="mb-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 text-xs wrap-anywhere"
        >
          {props.text}
        </pre>
      ) : null}
    </div>
  );
}
