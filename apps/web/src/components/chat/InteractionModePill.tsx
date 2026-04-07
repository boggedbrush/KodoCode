import { type ProviderInteractionMode } from "@t3tools/contracts";
import { memo, useState } from "react";

const MODES = [
  { mode: "ask" as const, label: "Ask", color: "#5c6bc0" },
  { mode: "plan" as const, label: "Plan", color: "#c8954a" },
  { mode: "act" as const, label: "Act", color: "#2e7d32" },
];

export const InteractionModePill = memo(function InteractionModePill({
  interactionMode,
  onSetMode,
}: {
  interactionMode: ProviderInteractionMode;
  onSetMode: (mode: ProviderInteractionMode) => void;
}) {
  const [hoveredMode, setHoveredMode] = useState<ProviderInteractionMode | null>(null);

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-black/10 px-1 py-0.5 dark:bg-white/5">
      {MODES.map(({ mode, label, color }) => {
        const isActive = interactionMode === mode;
        const isHovered = hoveredMode === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onSetMode(mode)}
            onMouseEnter={() => setHoveredMode(mode)}
            onMouseLeave={() => setHoveredMode(null)}
            className="rounded-full px-3 py-0.5 text-sm font-semibold transition-colors"
            title={`Switch to ${label} mode`}
            style={{
              backgroundColor: isActive || isHovered ? color : "transparent",
              color: isActive || isHovered ? "#000" : color,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
});
