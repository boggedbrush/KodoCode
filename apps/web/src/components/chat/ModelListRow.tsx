import { type ProviderKind } from "@t3tools/contracts";
import { memo } from "react";
import { StarIcon } from "lucide-react";

import {
  getDisplayModelName,
  getProviderLabel,
  getTriggerDisplayModelLabel,
  type ModelEsque,
  PROVIDER_ICON_BY_PROVIDER,
  PROVIDER_TINT_CLASS_BY_PROVIDER,
} from "./providerIconUtils";
import { ComboboxItem } from "../ui/combobox";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";

export const ModelListRow = memo(function ModelListRow(props: {
  index: number;
  model: ModelEsque;
  provider: ProviderKind;
  isFavorite: boolean;
  showProvider: boolean;
  preferShortName?: boolean;
  useTriggerLabel?: boolean;
  showNewBadge?: boolean;
  jumpLabel?: string | null;
  onToggleFavorite: () => void;
}) {
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[props.provider];

  return (
    <ComboboxItem
      hideIndicator
      index={props.index}
      value={`${props.provider}:${props.model.slug}`}
      className={cn(
        "group w-full cursor-pointer rounded-md px-3 py-2 transition-colors",
        "data-highlighted:bg-muted data-selected:bg-accent/90 data-selected:text-foreground",
      )}
    >
      <div className="flex w-full items-start gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="mt-0.5 shrink-0 cursor-pointer opacity-40 transition-opacity group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleFavorite();
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                type="button"
                aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <StarIcon
                  className={cn("size-4", props.isFavorite && "fill-current text-yellow-500")}
                />
              </button>
            }
          />
          <TooltipPopup side="top" align="center">
            {props.isFavorite ? "Remove from favorites" : "Add to favorites"}
          </TooltipPopup>
        </Tooltip>

        <div className="min-w-0 flex-1 text-left">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-medium leading-snug">
              <span className="truncate">
                {props.useTriggerLabel
                  ? getTriggerDisplayModelLabel(props.model)
                  : getDisplayModelName(
                      props.model,
                      props.preferShortName ? { preferShortName: true } : undefined,
                    )}
              </span>
              {props.showNewBadge ? (
                <span
                  className="shrink-0 rounded border border-amber-500/35 bg-amber-500/15 px-0.5 py-px text-[10px] font-bold uppercase leading-none tracking-wide text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/12 dark:text-amber-200"
                  aria-label="New model"
                >
                  New
                </span>
              ) : null}
            </div>
            {props.jumpLabel ? (
              <Kbd className="h-4 shrink-0 rounded-sm px-1.5 text-[10px]">{props.jumpLabel}</Kbd>
            ) : null}
          </div>
          {props.showProvider ? (
            <div className="mt-0.5 flex items-center gap-1">
              <ProviderIcon
                className={cn("size-3 shrink-0", PROVIDER_TINT_CLASS_BY_PROVIDER[props.provider])}
              />
              <span className="truncate text-xs leading-snug text-muted-foreground/70">
                {getProviderLabel(props.provider, props.model)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </ComboboxItem>
  );
});
