import { type ProviderInteractionMode } from "@t3tools/contracts";
import { memo, useState } from "react";

import { INTERACTION_MODE_ACCENT_COLORS } from "../../modeColors";

const MODES = [
  { mode: "ask" as const, label: "Ask", color: INTERACTION_MODE_ACCENT_COLORS.ask },
  { mode: "plan" as const, label: "Plan", color: INTERACTION_MODE_ACCENT_COLORS.plan },
  { mode: "code" as const, label: "Code", color: INTERACTION_MODE_ACCENT_COLORS.code },
  { mode: "review" as const, label: "Review", color: INTERACTION_MODE_ACCENT_COLORS.review },
];

export const InteractionModePill = memo(function InteractionModePill({
  interactionMode,
  onSetMode,
}: {
  interactionMode: ProviderInteractionMode;
  onSetMode: (mode: ProviderInteractionMode) => void;
}) {
  const [hoveredMode, setHoveredMode] = useState<ProviderInteractionMode | null>(null);
  const activeMode = interactionMode === "default" ? "code" : interactionMode;

  return (
    <div className="flex items-center gap-0.5 rounded-full bg-black/10 px-1 py-0.5 dark:bg-white/5">
      {MODES.map(({ mode, label, color }) => {
        const isActive = activeMode === mode;
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
              color: isActive || isHovered ? "#fff" : color,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
});
