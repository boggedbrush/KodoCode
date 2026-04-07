import { describe, expect, it } from "vitest";
import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { resolveModeModelSelection, resolveModeModelSelectionState } from "./modelSelection";

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
  it("returns null when no plan model is configured", () => {
    const result = resolveModeModelSelection("plan", makeSettings(), makeProviders());
    expect(result).toBeNull();
  });

  it("returns null when no act model is configured", () => {
    const result = resolveModeModelSelection("default", makeSettings(), makeProviders());
    expect(result).toBeNull();
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

  it("returns the act model selection when default (act) mode is active and act model is configured", () => {
    const actModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.4",
      options: { reasoningEffort: "medium" },
    };
    const settings = makeSettings({ actModelSelection });
    const result = resolveModeModelSelection("default", settings, makeProviders());

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
    expect(result!.model).toBe("gpt-5.4");
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

  it("returns plan model for plan mode and act model for default mode independently", () => {
    const planModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.3-codex",
      options: { reasoningEffort: "high" },
    };
    const actModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.4",
      options: { reasoningEffort: "low" },
    };
    const settings = makeSettings({ planModelSelection, actModelSelection });
    const providers = makeProviders();

    const planResult = resolveModeModelSelection("plan", settings, providers);
    const actResult = resolveModeModelSelection("default", settings, providers);

    expect(planResult!.model).toBe("gpt-5.3-codex");
    expect(actResult!.model).toBe("gpt-5.4");
  });

  it("plan model does not affect act mode resolution", () => {
    const planModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.3-codex",
      options: { reasoningEffort: "high" },
    };
    const settings = makeSettings({ planModelSelection, actModelSelection: null });
    const result = resolveModeModelSelection("default", settings, makeProviders());
    expect(result).toBeNull();
  });

  it("act model does not affect plan mode resolution", () => {
    const actModelSelection: ModelSelection = {
      provider: "codex",
      model: "gpt-5.4",
      options: { reasoningEffort: "medium" },
    };
    const settings = makeSettings({ actModelSelection, planModelSelection: null });
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
});
