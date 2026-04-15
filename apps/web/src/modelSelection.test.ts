import { describe, expect, it } from "vitest";
import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import {
  DEFAULT_MODEL_SELECTION_PRESET_ID,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import {
  buildWorkflowPresetModeSelectionsForProvider,
  createModelSelectionPresetId,
  getActiveModelSelectionPreset,
  getModeModelSelectionSource,
  resolveModeModelSelection,
  resolveModeModelSelectionState,
  resolveProviderScopedModelSelectionState,
} from "./modelSelection";

// ── Test helpers ──────────────────────────────────────────────────

function makeProviders(
  overrides?: Array<Partial<ServerProvider> | undefined>,
): ReadonlyArray<ServerProvider> {
  const defaults: ServerProvider[] = [
    {
      provider: "codex",
      enabled: true,
      installed: true,
      status: "ready",
      version: "1.0.0",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ],
            supportsFastMode: false,
            supportsThinkingToggle: false,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ],
            supportsFastMode: false,
            supportsThinkingToggle: false,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
      ],
    },
    {
      provider: "claudeAgent",
      enabled: true,
      installed: true,
      status: "ready",
      version: "1.0.0",
      auth: { status: "authenticated" },
      checkedAt: "2026-01-01T00:00:00.000Z",
      models: [
        {
          slug: "claude-sonnet-4-6",
          name: "Claude Sonnet 4.6",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ],
            supportsFastMode: false,
            supportsThinkingToggle: true,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
      ],
    },
  ];

  if (overrides) {
    return defaults.map((d, i) => ({ ...d, ...overrides[i] }));
  }
  return defaults;
}

function makeSettings(overrides?: Partial<UnifiedSettings>): UnifiedSettings {
  return { ...DEFAULT_UNIFIED_SETTINGS, ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("resolveModeModelSelection", () => {
  it("returns null when no ask model is configured", () => {
    const result = resolveModeModelSelection("ask", makeSettings(), makeProviders());
    expect(result).toBeNull();
  });

  it("returns null when no plan model is configured", () => {
    const result = resolveModeModelSelection("plan", makeSettings(), makeProviders());
    expect(result).toBeNull();
  });

  it("returns null when no code model is configured", () => {
    const result = resolveModeModelSelection("code", makeSettings(), makeProviders());
    expect(result).toBeNull();
  });

  it("returns the ask model selection when ask mode is active and ask model is configured", () => {
    const askModelSelection: ModelSelection = {
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      options: { thinking: true },
    };
    const settings = makeSettings({ askModelSelection });
    const result = resolveModeModelSelection("ask", settings, makeProviders());

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("claudeAgent");
    expect(result!.model).toBe("claude-sonnet-4-6");
  });

  it("returns the plan model selection when plan mode is active and plan model is configured", () => {
    const planModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.3-codex",
      options: { reasoningEffort: "high" },
    };
    const settings = makeSettings({ planModelSelection });
    const result = resolveModeModelSelection("plan", settings, makeProviders());

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
    expect(result!.model).toBe("gpt-5.3-codex");
  });

  it("returns the code model selection when code mode is active and code model is configured", () => {
    const codeModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.4",
      options: { reasoningEffort: "medium" },
    };
    const settings = makeSettings({ codeModelSelection });
    const result = resolveModeModelSelection("code", settings, makeProviders());

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
    expect(result!.model).toBe("gpt-5.4");
  });

  it("preserves auto mode model selection for code mode when configured", () => {
    const codeModelSelection: ModelSelection = {
      provider: "codex",
      model: "auto",
    };
    const settings = makeSettings({ codeModelSelection });
    const result = resolveModeModelSelection("code", settings, makeProviders());

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
    expect(result!.model).toBe("auto");
  });

  it("preserves auto mode model selection regardless of case", () => {
    const codeModelSelection: ModelSelection = {
      provider: "codex",
      model: "Auto",
      options: { reasoningEffort: "medium" },
    };
    const settings = makeSettings({ codeModelSelection });
    const result = resolveModeModelSelection("code", settings, makeProviders());

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
    expect(result!.model).toBe("auto");
  });

  it("falls back gracefully when the configured provider is disabled", () => {
    const planModelSelection: ModelSelection = {
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
    };
    const providers = makeProviders([undefined, { enabled: false }]);
    const settings = makeSettings({ planModelSelection });
    const result = resolveModeModelSelection("plan", settings, providers);

    // Should fall back to the first enabled provider (codex)
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
  });

  it("returns ask, plan, and code models independently", () => {
    const askModelSelection: ModelSelection = {
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      options: { thinking: true },
    };
    const planModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.3-codex",
      options: { reasoningEffort: "high" },
    };
    const codeModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.4",
      options: { reasoningEffort: "low" },
    };
    const settings = makeSettings({ askModelSelection, planModelSelection, codeModelSelection });
    const providers = makeProviders();

    const askResult = resolveModeModelSelection("ask", settings, providers);
    const planResult = resolveModeModelSelection("plan", settings, providers);
    const codeResult = resolveModeModelSelection("code", settings, providers);

    expect(askResult!.model).toBe("claude-sonnet-4-6");
    expect(planResult!.model).toBe("gpt-5.3-codex");
    expect(codeResult!.model).toBe("gpt-5.4");
  });

  it("prefers the active preset over base mode selections", () => {
    const settings = makeSettings({
      askModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      modelSelectionPresets: {
        codex: {
          focus: {
            id: "focus",
            provider: "codex",
            name: "Focus",
            askModelSelection: {
              provider: "codex",
              model: "gpt-5.3-codex",
            },
            planModelSelection: {
              provider: "codex",
              model: "gpt-5.3-codex",
            },
            codeModelSelection: {
              provider: "codex",
              model: "gpt-5.3-codex",
            },
            reviewModelSelection: {
              provider: "codex",
              model: "gpt-5.3-codex",
            },
          },
        },
        claudeAgent: {},
      },
      activeModelSelectionPresetByProvider: {
        codex: "focus",
        claudeAgent: null,
      },
    });

    const result = resolveModeModelSelection("ask", settings, makeProviders());

    expect(result).not.toBeNull();
    expect(result!.model).toBe("gpt-5.3-codex");
  });

  it("ask model does not affect plan mode resolution", () => {
    const askModelSelection: ModelSelection = {
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
      options: { thinking: true },
    };
    const settings = makeSettings({ askModelSelection, planModelSelection: null });
    const result = resolveModeModelSelection("plan", settings, makeProviders());
    expect(result).toBeNull();
  });

  it("plan model does not affect ask mode resolution", () => {
    const planModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.3-codex",
      options: { reasoningEffort: "high" },
    };
    const settings = makeSettings({ planModelSelection, askModelSelection: null });
    const result = resolveModeModelSelection("ask", settings, makeProviders());
    expect(result).toBeNull();
  });

  it("plan model does not affect code mode resolution", () => {
    const planModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.3-codex",
      options: { reasoningEffort: "high" },
    };
    const settings = makeSettings({ planModelSelection, codeModelSelection: null });
    const result = resolveModeModelSelection("code", settings, makeProviders());
    expect(result).toBeNull();
  });

  it("code model does not affect plan mode resolution", () => {
    const codeModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.4",
      options: { reasoningEffort: "medium" },
    };
    const settings = makeSettings({ codeModelSelection, planModelSelection: null });
    const result = resolveModeModelSelection("plan", settings, makeProviders());
    expect(result).toBeNull();
  });
});

describe("resolveModeModelSelectionState", () => {
  it("resolves a raw selection into a valid ModelSelection", () => {
    const raw: ModelSelection = {
      provider: "codex",
      model: "gpt-5.3-codex",
    };
    const result = resolveModeModelSelectionState(raw, makeSettings(), makeProviders());

    expect(result.provider).toBe("codex");
    expect(result.model).toBe("gpt-5.3-codex");
  });

  it("falls back to default model when the raw model is not available", () => {
    const raw: ModelSelection = {
      provider: "codex",
      model: "nonexistent-model",
    };
    const result = resolveModeModelSelectionState(raw, makeSettings(), makeProviders());

    expect(result.provider).toBe("codex");
    // Should still have a valid model (custom model will be added to options)
    expect(result.model).toBeTruthy();
  });

  it("preserves auto model selection and provider for mode-level settings persistence", () => {
    const raw: ModelSelection = {
      provider: "codex",
      model: "auto",
      options: { reasoningEffort: "high" },
    };
    const result = resolveModeModelSelectionState(raw, makeSettings(), makeProviders());

    expect(result.provider).toBe("codex");
    expect(result.model).toBe("auto");
    expect(result.options).toEqual({ reasoningEffort: "high" });
  });

  it("normalizes case-insensitive auto model selection for mode-level settings persistence", () => {
    const raw: ModelSelection = {
      provider: "codex",
      model: "Auto",
      options: { reasoningEffort: "medium" },
    };
    const result = resolveModeModelSelectionState(raw, makeSettings(), makeProviders());

    expect(result.provider).toBe("codex");
    expect(result.model).toBe("auto");
    expect(result.options).toEqual({ reasoningEffort: "medium" });
  });
});

describe("resolveProviderScopedModelSelectionState", () => {
  it("preserves auto model selection while scoping by provider", () => {
    const raw: ModelSelection = {
      provider: "codex",
      model: "auto",
      options: { fastMode: true },
    };
    const result = resolveProviderScopedModelSelectionState(
      "claudeAgent",
      raw,
      makeSettings(),
      makeProviders(),
    );

    expect(result.provider).toBe("claudeAgent");
    expect(result.model).toBe("auto");
    expect(result.options).toEqual({ fastMode: true });
  });

  it("normalizes case-insensitive auto model selection while scoping by provider", () => {
    const raw: ModelSelection = {
      provider: "codex",
      model: "Auto",
      options: { fastMode: true },
    };
    const result = resolveProviderScopedModelSelectionState(
      "claudeAgent",
      raw,
      makeSettings(),
      makeProviders(),
    );

    expect(result.provider).toBe("claudeAgent");
    expect(result.model).toBe("auto");
    expect(result.options).toEqual({ fastMode: true });
  });
});

describe("getActiveModelSelectionPreset", () => {
  it("returns the active preset for the preferred provider", () => {
    const settings = makeSettings({
      modelSelectionPresets: {
        codex: {
          focus: {
            id: "focus",
            provider: "codex",
            name: "Focus",
            askModelSelection: { provider: "codex", model: "gpt-5.4" },
            planModelSelection: { provider: "codex", model: "gpt-5.4" },
            codeModelSelection: { provider: "codex", model: "gpt-5.4" },
            reviewModelSelection: { provider: "codex", model: "gpt-5.4" },
          },
        },
        claudeAgent: {
          review: {
            id: "review",
            provider: "claudeAgent",
            name: "Review",
            askModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            planModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            codeModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            reviewModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
          },
        },
      },
      activeModelSelectionPresetByProvider: {
        codex: "focus",
        claudeAgent: "review",
      },
    });

    expect(getActiveModelSelectionPreset(settings, "claudeAgent")?.id).toBe("review");
    expect(getActiveModelSelectionPreset(settings, "codex")?.id).toBe("focus");
  });

  it("does not fall through to another provider when the preferred provider has no active preset", () => {
    const settings = makeSettings({
      modelSelectionPresets: {
        codex: {
          focus: {
            id: "focus",
            provider: "codex",
            name: "Focus",
            askModelSelection: { provider: "codex", model: "gpt-5.4" },
            planModelSelection: { provider: "codex", model: "gpt-5.4" },
            codeModelSelection: { provider: "codex", model: "gpt-5.4" },
            reviewModelSelection: { provider: "codex", model: "gpt-5.4" },
          },
        },
        claudeAgent: {
          [DEFAULT_MODEL_SELECTION_PRESET_ID]: {
            id: DEFAULT_MODEL_SELECTION_PRESET_ID,
            provider: "claudeAgent",
            name: "Default",
            askModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            planModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            codeModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            reviewModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
          },
        },
      },
      activeModelSelectionPresetByProvider: {
        codex: "focus",
        claudeAgent: null,
      },
    });

    expect(getActiveModelSelectionPreset(settings, "claudeAgent")).toBeNull();
    expect(getActiveModelSelectionPreset(settings)?.id).toBe("focus");
  });

  it("ignores a persisted default preset pointer", () => {
    const settings = makeSettings({
      modelSelectionPresets: {
        codex: {
          [DEFAULT_MODEL_SELECTION_PRESET_ID]: {
            id: DEFAULT_MODEL_SELECTION_PRESET_ID,
            provider: "codex",
            name: "Default",
            askModelSelection: { provider: "codex", model: "gpt-5.4" },
            planModelSelection: { provider: "codex", model: "gpt-5.4" },
            codeModelSelection: { provider: "codex", model: "gpt-5.4" },
            reviewModelSelection: { provider: "codex", model: "gpt-5.4" },
          },
        },
        claudeAgent: {},
      },
      activeModelSelectionPresetByProvider: {
        codex: DEFAULT_MODEL_SELECTION_PRESET_ID,
        claudeAgent: null,
      },
    });

    expect(getActiveModelSelectionPreset(settings, "codex")).toBeNull();
    expect(getActiveModelSelectionPreset(settings)).toBeNull();
  });
});

describe("getModeModelSelectionSource", () => {
  it("ignores stored default presets when resolving a provider-scoped selection", () => {
    const settings = makeSettings({
      askModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      modelSelectionPresets: {
        codex: {},
        claudeAgent: {
          [DEFAULT_MODEL_SELECTION_PRESET_ID]: {
            id: DEFAULT_MODEL_SELECTION_PRESET_ID,
            provider: "claudeAgent",
            name: "Default",
            askModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            planModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            codeModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
            reviewModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
          },
        },
      },
      activeModelSelectionPresetByProvider: {
        codex: null,
        claudeAgent: null,
      },
    });

    expect(getModeModelSelectionSource("ask", settings, "claudeAgent")).toBeNull();
  });

  it("does not reuse another provider's base selection when scoped to a provider", () => {
    const settings = makeSettings({
      askModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
    });

    expect(getModeModelSelectionSource("ask", settings, "claudeAgent")).toBeNull();
  });
});

describe("preset helper utilities", () => {
  it("creates preset ids with a slug and random suffix", () => {
    const presetId = createModelSelectionPresetId("My Focus Preset!");
    expect(presetId).toMatch(/^my-focus-preset-[a-f0-9]{8}$/);
  });

  it("builds provider-scoped mode selections from defaults when no selections are configured", () => {
    const selections = buildWorkflowPresetModeSelectionsForProvider({
      provider: "claudeAgent",
      settings: makeSettings(),
      providers: makeProviders(),
    });

    expect(selections.askModelSelection.provider).toBe("claudeAgent");
    expect(selections.planModelSelection.provider).toBe("claudeAgent");
    expect(selections.codeModelSelection.provider).toBe("claudeAgent");
    expect(selections.reviewModelSelection.provider).toBe("claudeAgent");
  });

  it("builds provider-scoped mode selections from the active provider preset", () => {
    const settings = makeSettings({
      modelSelectionPresets: {
        codex: {
          focus: {
            id: "focus",
            provider: "codex",
            name: "Focus",
            askModelSelection: { provider: "codex", model: "gpt-5.3-codex" },
            planModelSelection: { provider: "codex", model: "gpt-5.3-codex" },
            codeModelSelection: { provider: "codex", model: "gpt-5.3-codex" },
            reviewModelSelection: { provider: "codex", model: "gpt-5.3-codex" },
          },
        },
        claudeAgent: {},
      },
      activeModelSelectionPresetByProvider: {
        codex: "focus",
        claudeAgent: null,
      },
    });

    const selections = buildWorkflowPresetModeSelectionsForProvider({
      provider: "codex",
      settings,
      providers: makeProviders(),
    });

    expect(selections.askModelSelection.model).toBe("gpt-5.3-codex");
    expect(selections.planModelSelection.model).toBe("gpt-5.3-codex");
    expect(selections.codeModelSelection.model).toBe("gpt-5.3-codex");
    expect(selections.reviewModelSelection.model).toBe("gpt-5.3-codex");
  });
});
