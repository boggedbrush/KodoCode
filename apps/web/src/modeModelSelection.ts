import type { ModelSelection, ProviderInteractionMode } from "@t3tools/contracts";
import type { AppSettings } from "./appSettings";
import { getCustomModelsByProvider, resolveAppModelSelection } from "./appSettings";
import { buildModelSelection } from "./providerModelOptions";

export const INTERACTION_MODE_LABELS: Record<ProviderInteractionMode, string> = {
  ask: "Ask",
  code: "Code",
  default: "Code",
  plan: "Plan",
  review: "Review",
};

export type ModeModelSelectionKey =
  | "askModelSelection"
  | "planModelSelection"
  | "codeModelSelection"
  | "reviewModelSelection";

export function getModeModelSelectionKey(mode: ProviderInteractionMode): ModeModelSelectionKey {
  switch (mode) {
    case "ask":
      return "askModelSelection";
    case "plan":
      return "planModelSelection";
    case "review":
      return "reviewModelSelection";
    case "code":
    case "default":
    default:
      return "codeModelSelection";
  }
}

export function getInteractionModeLabel(mode: ProviderInteractionMode): string {
  return INTERACTION_MODE_LABELS[mode];
}

export function getInteractionModeControlValue(
  mode: ProviderInteractionMode,
): "ask" | "plan" | "code" | "review" {
  return mode === "default" ? "code" : mode;
}

export function resolveModeModelSelection(
  mode: ProviderInteractionMode,
  settings: Pick<
    AppSettings,
    | "askModelSelection"
    | "planModelSelection"
    | "codeModelSelection"
    | "reviewModelSelection"
    | "customCodexModels"
    | "customClaudeModels"
    | "customGeminiModels"
  >,
): ModelSelection | null {
  const selection = settings[getModeModelSelectionKey(mode)];
  if (!selection) {
    return null;
  }

  const customModelsByProvider = getCustomModelsByProvider(settings);
  const model = resolveAppModelSelection(
    selection.provider,
    customModelsByProvider,
    selection.model,
  );
  return buildModelSelection(selection.provider, model, selection.options);
}
