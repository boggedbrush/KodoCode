import { Undo2Icon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface EnhanceUndoChipProps {
  disabled?: boolean;
  onUndo: () => void;
}

export const EnhanceUndoChip = memo(function EnhanceUndoChip({
  disabled,
  onUndo,
}: EnhanceUndoChipProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              "size-9 rounded-full px-0 text-muted-foreground/80 hover:text-foreground",
            )}
            onClick={onUndo}
            disabled={disabled}
            aria-label="Undo enhance"
          >
            <Undo2Icon aria-hidden="true" className="size-3.5" />
          </Button>
        }
      />
      <TooltipPopup side="top">Undo enhance</TooltipPopup>
    </Tooltip>
  );
});
