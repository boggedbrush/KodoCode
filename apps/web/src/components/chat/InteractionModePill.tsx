import { type ProviderInteractionMode } from "@t3tools/contracts";
import { memo, useState } from "react";
import { getInteractionModeControlValue } from "../../modeModelSelection";

const MODES = [
  { mode: "ask" as const, label: "Ask", color: "#64B5F6" },
  { mode: "plan" as const, label: "Plan", color: "#c8954a" },
  { mode: "code" as const, label: "Code", color: "#5236CC" },
  { mode: "review" as const, label: "Review", color: "#4DB6AC" },
];

export const InteractionModePill = memo(function InteractionModePill({
  interactionMode,
  onSetMode,
}: {
  interactionMode: ProviderInteractionMode;
  onSetMode: (mode: ProviderInteractionMode) => void;
}) {
  const [hoveredMode, setHoveredMode] = useState<ProviderInteractionMode | null>(null);
  const activeMode = getInteractionModeControlValue(interactionMode);

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-black/10 px-1 py-0.5 dark:bg-white/5">
      {MODES.map(({ mode, label, color }) => {
        const isActive = activeMode === mode;
        const isHovered = hoveredMode === mode;
        return (
          <button
            key={mode}
            type="button"
            className="rounded-full px-3 py-0.5 text-sm font-semibold transition-colors"
            style={{
              backgroundColor: isActive || isHovered ? color : "transparent",
              color: isActive || isHovered ? "#fff" : color,
            }}
            title={`Switch to ${label} mode`}
            onClick={() => onSetMode(mode)}
            onMouseEnter={() => setHoveredMode(mode)}
            onMouseLeave={() => setHoveredMode(null)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
});
