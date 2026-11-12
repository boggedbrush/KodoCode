// Kodo prompt enhance: the footer control that rewrites the draft, with undo and cancel.
// It sits beside the dictation button. Both are icon buttons, so neither collapses with
// the controls bar when the composer narrows.
import { Undo2Icon, WandIcon } from "lucide-react";
import { memo, type PointerEvent } from "react";

import type { EnvironmentId, KodoInteractionMode } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { promptEnhanceBlock } from "../../kodo/promptEnhance.logic";
import { usePromptEnhance } from "../../kodo/usePromptEnhance";
import { usePreparedConnection } from "../../state/session";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl } from "./ComposerControl";

// Keeps the editor's selection and focus while the button is pressed.
const keepFocus = (event: PointerEvent) => event.preventDefault();

function enhanceTooltip(input: { reason: string | null; draft: string }) {
  const block = promptEnhanceBlock(input.draft);
  if (input.reason !== null) return `Enhance prompt: ${input.reason}`;
  if (block?.kind === "too-long") {
    return `Enhance prompt: drafts up to ${block.limit.toLocaleString()} characters`;
  }
  if (block?.kind === "empty") return "Enhance prompt: write a draft first";
  return "Enhance prompt: rewrite it to be clearer and more complete";
}

export const KodoEnhanceControl = memo(function KodoEnhanceControl(props: {
  /** The environment that owns the draft's thread; the rewrite runs on its text generation model. */
  environmentId: EnvironmentId;
  draft: string;
  interactionMode: KodoInteractionMode;
  /** Why Enhance cannot run right now, such as no provider; null when it can. */
  unavailableReason: string | null;
  replaceDraft: (expected: string, next: string) => boolean;
}) {
  const prepared = Option.getOrNull(usePreparedConnection(props.environmentId));
  const { enhancing, canUndo, enhance, cancel, undo } = usePromptEnhance({
    draft: props.draft,
    interactionMode: props.interactionMode,
    prepared,
    replaceDraft: props.replaceDraft,
  });
  const reason = prepared === null ? "Not connected to this environment" : props.unavailableReason;
  const blocked = reason !== null || promptEnhanceBlock(props.draft) !== null;

  if (enhancing) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerControl
              data-kodo-enhance="enhancing"
              aria-busy="true"
              aria-label="Enhancing prompt. Click to cancel"
              className="shrink-0"
              onPointerDown={keepFocus}
              onClick={cancel}
            />
          }
        >
          <Spinner aria-hidden="true" />
          <span className="@max-[480px]/composer-surface:hidden" data-composer-control-label>
            Enhancing…
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">Enhancing your prompt. Click to cancel.</TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <>
      {canUndo ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                data-kodo-enhance="undo"
                aria-label="Undo enhance"
                className="shrink-0"
                onPointerDown={keepFocus}
                onClick={undo}
              >
                <Undo2Icon />
              </Button>
            }
          />
          <TooltipPopup side="top">Undo enhance</TooltipPopup>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            // Span keeps the tooltip reachable while the button is disabled.
            <span className="inline-flex shrink-0" data-kodo-enhance-anchor />
          }
        >
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            data-kodo-enhance="idle"
            aria-label="Enhance prompt"
            aria-disabled={blocked || undefined}
            onPointerDown={keepFocus}
            onClick={() => {
              if (!blocked) void enhance();
            }}
          >
            <WandIcon />
          </Button>
        </TooltipTrigger>
        <TooltipPopup side="top">{enhanceTooltip({ reason, draft: props.draft })}</TooltipPopup>
      </Tooltip>
    </>
  );
});
