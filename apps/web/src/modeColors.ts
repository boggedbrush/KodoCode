import type { ProviderInteractionMode } from "@t3tools/contracts";

export const INTERACTION_MODE_ACCENT_COLORS = {
  ask: "#64B5F6",
  plan: "#c8954a",
  code: "#5236CC",
  review: "#4DB6AC",
  swarm: "#E06C2F",
  default: "#5236CC",
} as const satisfies Record<ProviderInteractionMode, string>;

export const WORKING_THREAD_STATUS_COLOR_CLASSES = {
  colorClass: "text-[#5236CC]",
  dotClass: "bg-[#5236CC]",
} as const;

export const PLAN_READY_THREAD_STATUS_COLOR_CLASSES = {
  colorClass: "text-[#c8954a]",
  dotClass: "bg-[#c8954a]",
} as const;

export const KODO_PURPLE = INTERACTION_MODE_ACCENT_COLORS.code;

export function getInteractionModeAccentColor(mode: ProviderInteractionMode): string {
  return INTERACTION_MODE_ACCENT_COLORS[mode];
}

export function hexColorToRgba(hexColor: string, alpha: number): string {
  const normalizedHex = hexColor.replace("#", "");
  const hex =
    normalizedHex.length === 3
      ? normalizedHex
          .split("")
          .map((value) => value + value)
          .join("")
      : normalizedHex;

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return hexColor;
  }

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
