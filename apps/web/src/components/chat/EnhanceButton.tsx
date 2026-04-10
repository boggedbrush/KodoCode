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
        "group/enhance flex size-9 origin-top items-center justify-center rounded-full border border-transparent bg-[#C8920A] text-white transition-all duration-150 enabled:cursor-pointer hover:scale-105 sm:size-8",
        "dark:bg-[#D4AF37] dark:text-[color:var(--color-neutral-900)]",
        "disabled:pointer-events-none disabled:opacity-30 disabled:hover:scale-100",
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
