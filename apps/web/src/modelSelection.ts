import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_MODEL_SELECTION_PRESET_ID,
  type ModelSelection,
  type ModelSelectionPreset,
  type ProviderInteractionMode,
  type ProviderKind,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  normalizeModelSlug,
  resolveSelectableModel,
  resolveUtilityModelSelectionDefault,
} from "@t3tools/shared/model";
import { getComposerProviderState } from "./components/chat/composerProviderRegistry";
import { UnifiedSettings } from "@t3tools/contracts/settings";
import {
  getDefaultServerModel,
  getProviderModels,
  resolveSelectableProvider,
} from "./providerModels";

const MAX_CUSTOM_MODEL_COUNT = 32;
export const MAX_CUSTOM_MODEL_LENGTH = 256;
const PRESET_PROVIDER_ORDER: readonly ProviderKind[] = ["codex", "claudeAgent"];

export type ProviderCustomModelConfig = {
  provider: ProviderKind;
  title: string;
  description: string;
  placeholder: string;
  example: string;
};

export interface AppModelOption {
  slug: string;
  name: string;
  isCustom: boolean;
}

const PROVIDER_CUSTOM_MODEL_CONFIG: Record<ProviderKind, ProviderCustomModelConfig> = {
  codex: {
    provider: "codex",
    title: "Codex",
    description: "Save additional Codex model slugs for the picker and `/model` command.",
    placeholder: "your-codex-model-slug",
    example: "gpt-6.7-codex-ultra-preview",
  },
  claudeAgent: {
    provider: "claudeAgent",
    title: "Claude",
    description: "Save additional Claude model slugs for the picker and `/model` command.",
    placeholder: "your-claude-model-slug",
    example: "claude-sonnet-5-0",
  },
};

export const MODEL_PROVIDER_SETTINGS = Object.values(PROVIDER_CUSTOM_MODEL_CONFIG);

export function normalizeCustomModelSlugs(
  models: Iterable<string | null | undefined>,
  builtInModelSlugs: ReadonlySet<string>,
  provider: ProviderKind = "codex",
): string[] {
  const normalizedModels: string[] = [];
  const seen = new Set<string>();

  for (const candidate of models) {
    const normalized = normalizeModelSlug(candidate, provider);
    if (
      !normalized ||
      normalized.length > MAX_CUSTOM_MODEL_LENGTH ||
      builtInModelSlugs.has(normalized) ||
      seen.has(normalized)
    ) {
      continue;
    }

    seen.add(normalized);
    normalizedModels.push(normalized);
    if (normalizedModels.length >= MAX_CUSTOM_MODEL_COUNT) {
      break;
    }
  }

  return normalizedModels;
}

export function getAppModelOptions(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
  selectedModel?: string | null,
): AppModelOption[] {
  const options: AppModelOption[] = getProviderModels(providers, provider).map(
    ({ slug, name, isCustom }) => ({
      slug,
      name,
      isCustom,
    }),
  );
  const seen = new Set(options.map((option) => option.slug));
  const trimmedSelectedModel = selectedModel?.trim().toLowerCase();
  const builtInModelSlugs = new Set(
    getProviderModels(providers, provider)
      .filter((model) => !model.isCustom)
      .map((model) => model.slug),
  );

  const customModels = settings.providers[provider].customModels;
  for (const slug of normalizeCustomModelSlugs(customModels, builtInModelSlugs, provider)) {
    if (seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    options.push({
      slug,
      name: slug,
      isCustom: true,
    });
  }

  const normalizedSelectedModel = normalizeModelSlug(selectedModel, provider);
  const selectedModelMatchesExistingName =
    typeof trimmedSelectedModel === "string" &&
    options.some((option) => option.name.toLowerCase() === trimmedSelectedModel);
  if (
    normalizedSelectedModel &&
    !seen.has(normalizedSelectedModel) &&
    !selectedModelMatchesExistingName
  ) {
    options.push({
      slug: normalizedSelectedModel,
      name: normalizedSelectedModel,
      isCustom: true,
    });
  }

  return options;
}

export function resolveAppModelSelection(
  provider: ProviderKind,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedModel: string | null | undefined,
): string {
  const resolvedProvider = resolveSelectableProvider(providers, provider);
  const options = getAppModelOptions(settings, providers, resolvedProvider, selectedModel);
  return (
    resolveSelectableModel(resolvedProvider, selectedModel, options) ??
    getDefaultServerModel(providers, resolvedProvider)
  );
}

function isAutoModelSelectionValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "auto";
}

export function resolveProviderScopedModelSelectionState(
  provider: ProviderKind,
  rawSelection: Omit<ModelSelection, "provider"> & { provider?: ProviderKind },
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  if (isAutoModelSelectionValue(rawSelection.model)) {
    return {
      provider,
      model: "auto",
      ...(rawSelection.options ? { options: rawSelection.options } : {}),
    };
  }

  const model =
    resolveSelectableModel(
      provider,
      rawSelection.model,
      getAppModelOptions(settings, providers, provider, rawSelection.model),
    ) ?? getDefaultServerModel(providers, provider);
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: {
      [provider]: rawSelection.options,
    },
  });

  return {
    provider,
    model,
    ...(modelOptionsForDispatch ? { options: modelOptionsForDispatch } : {}),
  };
}

export function getCustomModelOptionsByProvider(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selectedProvider?: ProviderKind | null,
  selectedModel?: string | null,
): Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>> {
  return {
    codex: getAppModelOptions(
      settings,
      providers,
      "codex",
      selectedProvider === "codex" ? selectedModel : undefined,
    ),
    claudeAgent: getAppModelOptions(
      settings,
      providers,
      "claudeAgent",
      selectedProvider === "claudeAgent" ? selectedModel : undefined,
    ),
  };
}

export function resolveAppModelSelectionState(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection | null | undefined = settings.textGenerationModelSelection,
): ModelSelection {
  const resolvedSelection = resolveUtilityModelSelectionDefault(selection, providers);
  const provider = resolveSelectableProvider(providers, resolvedSelection.provider);

  // When the provider changed due to fallback (e.g. selected provider was disabled),
  // don't carry over the old provider's model — use the fallback provider's default.
  const selectedModel = provider === resolvedSelection.provider ? resolvedSelection.model : null;
  const model = resolveAppModelSelection(provider, settings, providers, selectedModel);
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: {
      [provider]: provider === resolvedSelection.provider ? resolvedSelection.options : undefined,
    },
  });

  return {
    provider,
    model,
    ...(modelOptionsForDispatch ? { options: modelOptionsForDispatch } : {}),
  };
}

// ── Kodo: mode-aware model resolution ─────────────────────────────

export function getModeModelSelectionKey(
  mode: ProviderInteractionMode,
): keyof Pick<
  UnifiedSettings,
  "askModelSelection" | "planModelSelection" | "codeModelSelection" | "reviewModelSelection"
> {
  return mode === "ask"
    ? "askModelSelection"
    : mode === "plan"
      ? "planModelSelection"
      : mode === "review"
        ? "reviewModelSelection"
        : "codeModelSelection";
}

export type WorkflowPresetModeSelectionKey = ReturnType<typeof getModeModelSelectionKey>;
export type WorkflowPresetModeSelections = Record<WorkflowPresetModeSelectionKey, ModelSelection>;
export type ProviderScopedModelSelection<P extends ProviderKind> = Extract<
  ModelSelection,
  { provider: P }
>;
export type WorkflowPresetModeSelectionsByProvider<P extends ProviderKind> = Record<
  WorkflowPresetModeSelectionKey,
  ProviderScopedModelSelection<P>
>;
const WORKFLOW_PRESET_MODES: readonly ProviderInteractionMode[] = ["ask", "plan", "code", "review"];

export function createModelSelectionPresetId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${slug || "preset"}-${suffix}`;
}

export function getBaseModeModelSelection(
  mode: ProviderInteractionMode,
  settings: UnifiedSettings,
): ModelSelection | null {
  const selectionKey = getModeModelSelectionKey(mode);
  return settings[selectionKey];
}

export function getActiveModelSelectionPreset(
  settings: UnifiedSettings,
  preferredProvider?: ProviderKind | null,
): ModelSelectionPreset | null {
  if (preferredProvider) {
    const presetId = settings.activeModelSelectionPresetByProvider[preferredProvider];
    if (!presetId || presetId === DEFAULT_MODEL_SELECTION_PRESET_ID) {
      return null;
    }

    return settings.modelSelectionPresets[preferredProvider][presetId] ?? null;
  }

  const providerOrder = [...PRESET_PROVIDER_ORDER];

  for (const provider of providerOrder) {
    const presetId = settings.activeModelSelectionPresetByProvider[provider];
    if (!presetId || presetId === DEFAULT_MODEL_SELECTION_PRESET_ID) {
      continue;
    }

    const preset = settings.modelSelectionPresets[provider][presetId];
    if (preset) {
      return preset;
    }
  }

  return null;
}

export function getModeModelSelectionSource(
  mode: ProviderInteractionMode,
  settings: UnifiedSettings,
  preferredProvider?: ProviderKind | null,
): ModelSelection | null {
  const baseSelection = getBaseModeModelSelection(mode, settings);
  const scopedBaseSelection =
    preferredProvider && baseSelection?.provider !== preferredProvider ? null : baseSelection;
  const preset = getActiveModelSelectionPreset(
    settings,
    preferredProvider ?? baseSelection?.provider,
  );
  if (!preset) {
    return scopedBaseSelection;
  }

  return preset[getModeModelSelectionKey(mode)];
}

export function buildWorkflowPresetModeSelectionsForProvider<P extends ProviderKind>(input: {
  provider: P;
  settings: UnifiedSettings;
  providers: ReadonlyArray<ServerProvider>;
}): WorkflowPresetModeSelectionsByProvider<P> {
  const { provider, settings, providers } = input;
  return Object.fromEntries(
    WORKFLOW_PRESET_MODES.map((mode) => {
      const key = getModeModelSelectionKey(mode);
      const sourceSelection = getModeModelSelectionSource(mode, settings, provider);
      const providerSelection =
        sourceSelection?.provider === provider
          ? sourceSelection
          : {
              provider,
              model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider],
            };
      return [
        key,
        resolveProviderScopedModelSelectionState(provider, providerSelection, settings, providers),
      ];
    }),
  ) as WorkflowPresetModeSelectionsByProvider<P>;
}

/**
 * Resolve the ModelSelection that should be active for a given interaction
 * mode based on the Kodo ask/plan/code model settings.
 *
 * Returns `null` when no mode-specific override is configured, signalling
 * the caller should keep using the existing default model selection.
 */
export function resolveModeModelSelection(
  mode: ProviderInteractionMode,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection | null {
  const modeSelection = getModeModelSelectionSource(mode, settings);
  if (!modeSelection) {
    return null;
  }

  const provider = resolveSelectableProvider(providers, modeSelection.provider);

  // If the configured provider became unavailable, fall back gracefully
  if (isAutoModelSelectionValue(modeSelection.model)) {
    return {
      provider,
      model: "auto",
      ...(modeSelection.options ? { options: modeSelection.options } : {}),
    };
  }

  const selectedModel = provider === modeSelection.provider ? modeSelection.model : null;
  const model = resolveAppModelSelection(provider, settings, providers, selectedModel);
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: {
      [provider]: provider === modeSelection.provider ? modeSelection.options : undefined,
    },
  });

  return {
    provider,
    model,
    ...(modelOptionsForDispatch ? { options: modelOptionsForDispatch } : {}),
  };
}

/**
 * Build a mode-specific ModelSelection suitable for persisting to server
 * settings.  Takes a raw selection (from the UI picker) and resolves it
 * against available providers/models so the stored value is valid.
 */
export function resolveModeModelSelectionState(
  rawSelection: ModelSelection,
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ModelSelection {
  const provider = resolveSelectableProvider(providers, rawSelection.provider);
  if (isAutoModelSelectionValue(rawSelection.model)) {
    return {
      provider,
      model: "auto",
      ...(rawSelection.options ? { options: rawSelection.options } : {}),
    };
  }
  const selectedModel = provider === rawSelection.provider ? rawSelection.model : null;
  const model = resolveAppModelSelection(provider, settings, providers, selectedModel);
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider,
    model,
    models: getProviderModels(providers, provider),
    prompt: "",
    modelOptions: {
      [provider]: provider === rawSelection.provider ? rawSelection.options : undefined,
    },
  });

  return {
    provider,
    model,
    ...(modelOptionsForDispatch ? { options: modelOptionsForDispatch } : {}),
  };
}
