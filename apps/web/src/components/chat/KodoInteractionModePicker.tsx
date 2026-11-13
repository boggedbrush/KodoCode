import type { KodoInteractionMode, ThreadInteractionMode } from "@t3tools/contracts";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  type LucideIcon,
  CodeXmlIcon,
  ListChecksIcon,
  MessageCircleQuestionIcon,
  ScanSearchIcon,
} from "lucide-react";
import { memo, useEffect, useRef } from "react";

import {
  KODO_INTERACTION_MODE_OPTIONS,
  kodoInteractionModeOption,
} from "../../kodo/interactionModes.logic";
import { useKodoInteractionModeStatus } from "../../kodo/interactionModeStatus";
import { cn } from "~/lib/utils";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { useComposerMenuProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

const MODE_ICONS: Record<KodoInteractionMode, LucideIcon> = {
  ask: MessageCircleQuestionIcon,
  plan: ListChecksIcon,
  code: CodeXmlIcon,
  review: ScanSearchIcon,
};

// Full class names so Tailwind sees them; the colours come from the --mode-* tokens.
const MODE_TEXT_CLASS: Record<KodoInteractionMode, string> = {
  ask: "text-mode-ask",
  plan: "text-mode-plan",
  code: "text-mode-code",
  review: "text-mode-review",
};

const MODE_CHIP_CLASS: Record<KodoInteractionMode, string> = {
  ask: "text-mode-ask hover:text-mode-ask [&_svg]:text-mode-ask!",
  plan: "text-mode-plan hover:text-mode-plan [&_svg]:text-mode-plan!",
  code: "text-mode-code hover:text-mode-code [&_svg]:text-mode-code!",
  review: "text-mode-review hover:text-mode-review [&_svg]:text-mode-review!",
};

/** Mode list for a menu: one row per mode with its description. Lives inside a Menu. */
export function KodoInteractionModeSection(props: {
  interactionMode: KodoInteractionMode;
  onInteractionModeChange: (mode: ThreadInteractionMode) => void;
}) {
  return (
    <div data-kodo-interaction-modes className="grid w-72 gap-1 px-2 py-1.5">
      <div className="font-medium text-muted-foreground text-xs">Mode</div>
      <MenuPrimitive.RadioGroup
        aria-label="Mode"
        value={props.interactionMode}
        onValueChange={(value: KodoInteractionMode) => {
          if (value !== props.interactionMode) props.onInteractionModeChange(value);
        }}
        className="grid gap-0.5"
      >
        {KODO_INTERACTION_MODE_OPTIONS.map((option) => {
          const Icon = MODE_ICONS[option.mode];
          return (
            <MenuPrimitive.RadioItem
              key={option.mode}
              value={option.mode}
              label={option.label}
              closeOnClick
              className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 outline-none data-checked:bg-input/72 data-highlighted:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Icon
                aria-hidden="true"
                className={cn("mt-0.5 size-4 shrink-0", MODE_TEXT_CLASS[option.mode])}
              />
              <span className="grid min-w-0 gap-0.5">
                <span
                  className={cn(
                    "text-sm",
                    option.mode === props.interactionMode
                      ? MODE_TEXT_CLASS[option.mode]
                      : "text-foreground",
                  )}
                >
                  {option.label}
                </span>
                <span className="text-muted-foreground text-xs leading-4">
                  {option.description}
                </span>
              </span>
            </MenuPrimitive.RadioItem>
          );
        })}
      </MenuPrimitive.RadioGroup>
    </div>
  );
}

/** The footer chip naming the thread's mode in its accent colour; opens the four-way list. */
export const KodoInteractionModeChip = memo(function KodoInteractionModeChip(props: {
  interactionMode: KodoInteractionMode;
  size?: "sm" | "xs";
  hidden?: boolean;
  onInteractionModeChange: (mode: ThreadInteractionMode) => void;
}) {
  const size = props.size ?? "sm";
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const chipRef = useRef<HTMLButtonElement>(null);
  const option = kodoInteractionModeOption(props.interactionMode);
  const { appliesNextTurn, locked, orchestrator } = useKodoInteractionModeStatus();
  const swapRef = useRef<HTMLSpanElement>(null);
  const shownModeRef = useRef(props.interactionMode);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays a one-shot DOM animation when the shown mode changes
  useEffect(() => {
    if (shownModeRef.current === props.interactionMode) return;
    shownModeRef.current = props.interactionMode;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    swapRef.current?.animate(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 160, easing: "ease-out" },
    );
  }, [props.interactionMode]);
  // KODO: orchestrator-lock - the Orchestrator's mode is the server's, so there is nothing to pick
  if (orchestrator) return null;
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  ref={chipRef}
                  data-kodo-mode-chip={props.interactionMode}
                  size={size}
                  disabled={locked}
                  data-kodo-mode-locked={locked ? "" : undefined}
                  className={cn("ps-1.5", MODE_CHIP_CLASS[props.interactionMode])}
                  data-kodo-mode-next-turn={appliesNextTurn ? "" : undefined}
                  aria-label={`Mode: ${option.label}${appliesNextTurn ? ", applies from the next turn" : ""}`}
                />
              }
            />
          }
        >
          <span
            ref={swapRef}
            className={cn("inline-flex items-center", size === "xs" ? "gap-1" : "gap-1.5")}
          >
            <ComposerControlIcon icon={MODE_ICONS[props.interactionMode]} size={size} />
            <span data-composer-control-label>{option.label}</span>
            {appliesNextTurn ? (
              <span className="text-2xs opacity-70" data-kodo-mode-next-turn-label>
                next turn
              </span>
            ) : null}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          {locked
            ? `Mode: ${option.label}. The loop sets the mode while it runs.`
            : `Mode: ${option.label}. ${option.description}`}
          {appliesNextTurn
            ? " The running turn keeps its earlier mode; this applies from the next turn."
            : ""}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        <KodoInteractionModeSection
          interactionMode={props.interactionMode}
          onInteractionModeChange={props.onInteractionModeChange}
        />
      </MenuPopup>
    </Menu>
  );
});
