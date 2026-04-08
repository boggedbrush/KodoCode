import type { ProviderInteractionMode } from "@t3tools/contracts";

export const INTERACTION_MODE_ACCENT_COLORS = {
  ask: "#64B5F6",
  plan: "#c8954a",
  code: "#5236CC",
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

export function getInteractionModeAccentColor(mode: ProviderInteractionMode): string {
  return INTERACTION_MODE_ACCENT_COLORS[mode];
}
