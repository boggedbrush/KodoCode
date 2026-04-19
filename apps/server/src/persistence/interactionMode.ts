import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type ProviderInteractionMode,
} from "@t3tools/contracts";

const VALID_INTERACTION_MODES = new Set<ProviderInteractionMode>([
  "default",
  "plan",
  "ask",
  "code",
  "review",
]);

export function normalizePersistedProviderInteractionMode(
  value: string | null | undefined,
): ProviderInteractionMode {
  if (!value || value === "swarm") {
    return DEFAULT_PROVIDER_INTERACTION_MODE;
  }

  return VALID_INTERACTION_MODES.has(value as ProviderInteractionMode)
    ? (value as ProviderInteractionMode)
    : DEFAULT_PROVIDER_INTERACTION_MODE;
}
