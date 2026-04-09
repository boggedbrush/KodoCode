import { memo } from "react";

import { type PromptEnhancePreset } from "@t3tools/contracts";
import { enhancePresetLabel } from "~/enhancePreset";
import { cn } from "~/lib/utils";
import { EnhanceGlyph } from "./EnhanceGlyph";

interface EnhanceButtonProps {
  disabled?: boolean;
  preset: PromptEnhancePreset;
  onEnhance: () => void;
}

export const EnhanceButton = memo(function EnhanceButton({
  disabled,
  preset,
  onEnhance,
}: EnhanceButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "group/enhance flex size-9 cursor-pointer items-center justify-center rounded-full text-white transition-colors sm:size-8",
        "border border-border bg-[color:var(--color-accent)] hover:border-transparent hover:bg-[#C8920A] hover:text-white",
        "dark:hover:bg-[#D4AF37] dark:hover:text-[color:var(--color-neutral-900)]",
        "disabled:pointer-events-none disabled:opacity-30",
      )}
      onClick={onEnhance}
      disabled={disabled}
      aria-label={`Enhance using ${enhancePresetLabel(preset)} preset`}
      title={`Enhance using ${enhancePresetLabel(preset)} preset`}
    >
      <EnhanceGlyph />
    </button>
  );
});
