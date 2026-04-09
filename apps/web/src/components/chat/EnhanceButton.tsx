import { memo } from "react";

import { type PromptEnhancePreset } from "@t3tools/contracts";
import { enhancePresetLabel } from "~/enhancePreset";
import { cn } from "~/lib/utils";

function EnhanceGlyph() {
  return (
    <span
      aria-hidden="true"
      className="relative grid size-6 shrink-0 place-items-center"
    >
      <svg
        className="col-start-1 row-start-1 size-full transition-opacity duration-150 group-hover/enhance:opacity-0"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="enhance-glyph-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FDB931" stopOpacity={1} />
            <stop offset="50%" stopColor="#D4AF37" stopOpacity={1} />
            <stop offset="100%" stopColor="#B8860B" stopOpacity={1} />
          </linearGradient>
        </defs>
        <g
          fill="none"
          stroke="url(#enhance-glyph-gradient)"
          strokeLinecap="round"
          strokeWidth="2.5"
        >
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(0, 50, 50)" />
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(60, 50, 50)" />
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(120, 50, 50)" />
        </g>
        <circle cx="50" cy="50" r="3" fill="url(#enhance-glyph-gradient)" />
      </svg>
      <svg
        className="col-start-1 row-start-1 size-full opacity-0 transition-opacity duration-150 group-hover/enhance:opacity-100"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5">
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(0, 50, 50)" />
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(60, 50, 50)" />
          <ellipse cx="50" cy="50" rx="35" ry="12" transform="rotate(120, 50, 50)" />
        </g>
        <circle cx="50" cy="50" r="3" fill="currentColor" />
      </svg>
    </span>
  );
}

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
        "bg-[color:var(--color-accent)] hover:bg-[color:var(--warning)] hover:text-[color:var(--color-neutral-800)]",
        "dark:hover:text-[color:var(--color-neutral-900)]",
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
