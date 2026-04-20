import { type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { memo } from "react";
import { Clock3Icon, StarIcon } from "lucide-react";

import { CursorIcon } from "../Icons";
import {
  AVAILABLE_PROVIDER_OPTIONS,
  PROVIDER_ICON_BY_PROVIDER,
  PROVIDER_TINT_CLASS_BY_PROVIDER,
} from "./providerIconUtils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { getProviderSnapshot } from "../../providerModels";

function describeUnavailableProvider(label: string, live: ServerProvider | undefined): string {
  if (!live) {
    return `${label} — waiting for provider status…`;
  }
  if (live.status === "ready") {
    return label;
  }
  const kind =
    live.status === "error"
      ? "Unavailable"
      : live.status === "warning"
        ? "Limited"
        : live.status === "disabled"
          ? "Disabled in settings"
          : "Not ready";
  const message = live.message?.trim();
  return message ? `${label} — ${kind}. ${message}` : `${label} — ${kind}.`;
}

const SELECTED_BUTTON_CLASS = "bg-background text-foreground shadow-sm";
const SELECTED_INDICATOR_CLASS =
  "pointer-events-none absolute -right-1 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary";
const PICKER_TOOLTIP_SIDE = "left" as const;
const PICKER_TOOLTIP_CLASS = "max-w-64 text-balance font-normal leading-snug";
const SOON_BADGE_CLASS =
  "pointer-events-none absolute -right-0.5 top-0.5 z-10 flex size-3.5 items-center justify-center rounded-full bg-transparent text-muted-foreground shadow-sm";

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedProvider: ProviderKind | "favorites";
  onSelectProvider: (provider: ProviderKind | "favorites") => void;
  providers?: ReadonlyArray<ServerProvider>;
}) {
  return (
    <div className="flex w-12 flex-col gap-1 overflow-y-auto border-r bg-muted/30 p-1">
      <div className="mb-1 border-b pb-1">
        <div className="relative w-full">
          {props.selectedProvider === "favorites" ? (
            <div className={SELECTED_INDICATOR_CLASS} />
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  className={cn(
                    "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded transition-colors hover:bg-muted",
                    props.selectedProvider === "favorites" && SELECTED_BUTTON_CLASS,
                  )}
                  onClick={() => props.onSelectProvider("favorites")}
                  type="button"
                  data-model-picker-provider="favorites"
                  aria-label="Favorites"
                >
                  <StarIcon className="size-5 shrink-0 fill-current text-amber-400" aria-hidden />
                </button>
              }
            />
            <TooltipPopup
              side={PICKER_TOOLTIP_SIDE}
              align="center"
              className={PICKER_TOOLTIP_CLASS}
            >
              Favorites
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>

      {AVAILABLE_PROVIDER_OPTIONS.map((option) => {
        const OptionIcon = PROVIDER_ICON_BY_PROVIDER[option.value];
        const liveProvider = props.providers
          ? getProviderSnapshot(props.providers, option.value)
          : undefined;
        const isDisabled = !liveProvider || liveProvider.status !== "ready";
        const isSelected = props.selectedProvider === option.value;
        const tooltipText = isDisabled
          ? describeUnavailableProvider(option.label, liveProvider)
          : option.label;

        const button = (
          <button
            data-model-picker-provider={option.value}
            className={cn(
              "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded transition-colors hover:bg-muted",
              isSelected && SELECTED_BUTTON_CLASS,
              isDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
            onClick={() => {
              if (!isDisabled) {
                props.onSelectProvider(option.value);
              }
            }}
            disabled={isDisabled}
            type="button"
            aria-label={tooltipText}
          >
            <OptionIcon
              className={cn(
                "size-5 shrink-0",
                PROVIDER_TINT_CLASS_BY_PROVIDER[option.value],
                isDisabled && "opacity-80",
              )}
              aria-hidden
            />
          </button>
        );

        return (
          <div key={option.value} className="relative w-full">
            {isSelected ? <div className={SELECTED_INDICATOR_CLASS} /> : null}
            <Tooltip>
              <TooltipTrigger render={button} />
              <TooltipPopup
                side={PICKER_TOOLTIP_SIDE}
                align="center"
                className={PICKER_TOOLTIP_CLASS}
              >
                {tooltipText}
              </TooltipPopup>
            </Tooltip>
          </div>
        );
      })}

      <Tooltip>
        <TooltipTrigger
          render={
            <span className="relative block w-full">
              <button
                className="relative isolate flex aspect-square w-full cursor-not-allowed items-center justify-center rounded opacity-50 transition-colors hover:bg-transparent"
                disabled
                type="button"
                data-model-picker-provider="cursor-coming-soon"
                aria-label="Cursor — coming soon"
              >
                <CursorIcon
                  className={cn("size-5", PROVIDER_TINT_CLASS_BY_PROVIDER.cursor)}
                  aria-hidden
                />
                <span className={SOON_BADGE_CLASS} aria-hidden>
                  <Clock3Icon className="size-2" />
                </span>
              </button>
            </span>
          }
        />
        <TooltipPopup side={PICKER_TOOLTIP_SIDE} align="center" className={PICKER_TOOLTIP_CLASS}>
          Cursor — Coming soon
        </TooltipPopup>
      </Tooltip>
    </div>
  );
});
