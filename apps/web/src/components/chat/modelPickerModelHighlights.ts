import type { ProviderKind } from "@t3tools/contracts";

/**
 * Keep release-callout logic centralized so future model launches do not need
 * ad hoc badge checks spread across the picker rows.
 */
const NEW_MODEL_KEYS = new Set<string>(["claudeAgent:claude-opus-4-7"]);

export function isModelPickerNewModel(provider: ProviderKind, slug: string): boolean {
  return NEW_MODEL_KEYS.has(`${provider}:${slug}`);
}
