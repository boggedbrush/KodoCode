import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import type { KodoModelNote } from "./modeModels.logic";

/** Says why the composer's model is what it is: a mode default, the user's pick, or a fallback. */
export function KodoModelNoteLabel({ note, hidden }: { note: KodoModelNote; hidden: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            data-kodo-model-note={note.kind}
            aria-hidden={hidden || undefined}
            className={
              note.kind === "unavailable"
                ? "shrink-0 whitespace-nowrap text-xs text-warning-foreground"
                : "shrink-0 whitespace-nowrap text-xs text-muted-foreground"
            }
          />
        }
      >
        {note.label}
      </TooltipTrigger>
      <TooltipPopup>{note.title}</TooltipPopup>
    </Tooltip>
  );
}
