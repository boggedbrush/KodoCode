import { type PromptEnhancePreset } from "@t3tools/contracts";

export const ENHANCE_PRESET_LABELS: Record<PromptEnhancePreset, string> = {
  minimal: "Minimal",
  balanced: "Balanced",
  vibe: "Vibe",
};

export function enhancePresetLabel(preset: PromptEnhancePreset): string {
  return ENHANCE_PRESET_LABELS[preset];
}
