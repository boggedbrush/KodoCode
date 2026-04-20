import {
  type ProviderKind,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { memo, useEffect, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { ModelPickerContent, COMPOSER_AUTO_MODEL_VALUE } from "./ModelPickerContent";
import {
  type ModelEsque,
  PROVIDER_ICON_BY_PROVIDER,
  PROVIDER_TINT_CLASS_BY_PROVIDER,
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "./providerIconUtils";
import { setModelPickerOpen } from "../../modelPickerOpenState";

export { COMPOSER_AUTO_MODEL_VALUE } from "./ModelPickerContent";
export { AVAILABLE_PROVIDER_OPTIONS } from "./providerIconUtils";

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<ModelEsque>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  showAsAuto?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onOpenChange?: (open: boolean) => void;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const activeProvider = props.lockedProvider ?? props.provider;
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;
  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider];
  // Fall back to the active provider's first model so the trigger never renders
  // a stale slug after provider switches or partial status refreshes.
  const selectedModel = props.showAsAuto
    ? ({ slug: COMPOSER_AUTO_MODEL_VALUE, name: "Auto" } satisfies ModelEsque)
    : (selectedProviderOptions.find((option) => option.slug === props.model) ??
      selectedProviderOptions[0]);
  const ProviderIcon = PROVIDER_ICON_BY_PROVIDER[activeProvider];
  const triggerTitle = selectedModel ? getTriggerDisplayModelName(selectedModel) : props.model;
  const triggerSubtitle = selectedModel?.subProvider;
  const triggerLabel = selectedModel ? getTriggerDisplayModelLabel(selectedModel) : props.model;

  const setIsMenuOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open);
    }
  };

  useEffect(() => {
    setModelPickerOpen(isMenuOpen);
    return () => {
      setModelPickerOpen(false);
    };
  }, [isMenuOpen]);

  const handleProviderModelChange = (provider: ProviderKind, model: string) => {
    if (props.disabled) {
      return;
    }
    props.onProviderModelChange(provider, model);
    setIsMenuOpen(false);
  };

  return (
    <Popover
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            data-chat-provider-model-picker="true"
            className={cn(
              "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 w-full box-border items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36 sm:pl-1" : undefined,
          )}
        >
          <ProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              PROVIDER_TINT_CLASS_BY_PROVIDER[activeProvider],
              props.activeProviderIconClassName,
            )}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "min-w-0 flex-1 overflow-hidden",
                    triggerSubtitle
                      ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1"
                      : "truncate",
                  )}
                />
              }
            >
              {triggerSubtitle ? (
                <>
                  <span className="min-w-0 truncate">{triggerSubtitle}</span>
                  <span aria-hidden="true" className="shrink-0 opacity-60">
                    ·
                  </span>
                  <span className="min-w-0 truncate">{triggerTitle}</span>
                </>
              ) : (
                triggerTitle
              )}
            </TooltipTrigger>
            <TooltipPopup side="top">{triggerLabel}</TooltipPopup>
          </Tooltip>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        className="border-0 bg-transparent p-0 shadow-none before:hidden [--viewport-inline-padding:0] *:data-[slot=popover-viewport]:p-0"
      >
        <ModelPickerContent
          provider={props.provider}
          model={props.model}
          lockedProvider={props.lockedProvider}
          {...(props.providers ? { providers: props.providers } : {})}
          {...(props.keybindings ? { keybindings: props.keybindings } : {})}
          modelOptionsByProvider={props.modelOptionsByProvider}
          {...(props.showAsAuto !== undefined ? { showAsAuto: props.showAsAuto } : {})}
          terminalOpen={props.terminalOpen ?? false}
          onRequestClose={() => setIsMenuOpen(false)}
          onProviderModelChange={handleProviderModelChange}
        />
      </PopoverPopup>
    </Popover>
  );
});
