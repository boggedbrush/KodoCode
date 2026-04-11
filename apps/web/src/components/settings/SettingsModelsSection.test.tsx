import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_SELECTION_PRESET_ID,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";

import {
  getWorkflowPresetUndoPatch,
  getWorkflowPresetUndoState,
  isWorkflowPresetUndoDirty,
  SettingsModelsSection,
} from "./SettingsModelsSection";
import * as SettingsPanelPrimitives from "./SettingsPanelPrimitives";

vi.mock("../../rpc/serverState", () => ({
  useServerProviders: () => [
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
          capabilities: null,
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
          capabilities: null,
        },
      ],
    },
  ],
}));

function makeSettings(overrides?: Partial<UnifiedSettings>): UnifiedSettings {
  return { ...DEFAULT_UNIFIED_SETTINGS, ...overrides };
}

describe("SettingsModelsSection", () => {
  it("renders the default state when no preset is active", () => {
    const markup = renderToStaticMarkup(
      <SettingsModelsSection settings={makeSettings()} updateSettings={() => {}} />,
    );

    expect(markup).toContain("Workflow presets");
    expect(markup).toContain("Preset:");
    expect(markup).toContain("Default");
  });

  it("renders the default label for Claude without leaking base configuration", () => {
    const markup = renderToStaticMarkup(
      <SettingsModelsSection
        settings={makeSettings({
          askModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
        })}
        updateSettings={() => {}}
      />,
    );

    expect(markup).toContain("Default");
    expect(markup).toContain("Claude");
  });

  it("shows Default when a provider has a stored default preset and no explicit active pointer", () => {
    const markup = renderToStaticMarkup(
      <SettingsModelsSection
        settings={makeSettings({
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
          askModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
        })}
        updateSettings={() => {}}
      />,
    );

    expect(markup).toContain("Default");
  });

  it("hides stored default presets from the visible preset list state", () => {
    const markup = renderToStaticMarkup(
      <SettingsModelsSection
        settings={makeSettings({
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
            claudeAgent: {},
          },
        })}
        updateSettings={() => {}}
      />,
    );

    expect(markup).not.toContain("Base configuration");
    expect(markup).not.toContain('value="default"');
  });

  it("renders the active preset state", () => {
    const markup = renderToStaticMarkup(
      <SettingsModelsSection
        settings={makeSettings({
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
            claudeAgent: {},
          },
          activeModelSelectionPresetByProvider: {
            codex: "focus",
            claudeAgent: null,
          },
        })}
        updateSettings={() => {}}
      />,
    );

    expect(markup).toContain("Focus");
    expect(markup).toContain("Codex");
  });

  it("shows reset actions for stale built-in starter preset mode values", () => {
    const markup = renderToStaticMarkup(
      <SettingsModelsSection
        settings={makeSettings({
          modelSelectionPresets: {
            codex: {
              "starter-codex-pro-5x": {
                id: "starter-codex-pro-5x",
                provider: "codex",
                name: "Pro (5X)",
                askModelSelection: {
                  provider: "codex",
                  model: "gpt-5.3-codex-spark",
                  options: { reasoningEffort: "low" },
                },
                planModelSelection: {
                  provider: "codex",
                  model: "gpt-5.4",
                  options: { reasoningEffort: "high" },
                },
                codeModelSelection: {
                  provider: "codex",
                  model: "gpt-5.3-codex-spark",
                  options: { reasoningEffort: "high" },
                },
                reviewModelSelection: {
                  provider: "codex",
                  model: "gpt-5.3-codex",
                  options: { reasoningEffort: "high" },
                },
              },
            },
            claudeAgent: {},
          },
          activeModelSelectionPresetByProvider: {
            codex: "starter-codex-pro-5x",
            claudeAgent: null,
          },
        })}
        updateSettings={() => {}}
      />,
    );

    expect(markup).toContain("Reset to current starter preset value");
  });

  it("tracks workflow preset undo against the current preset instead of default", () => {
    const before = makeSettings({
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
        claudeAgent: {},
      },
      activeModelSelectionPresetByProvider: {
        codex: "focus",
        claudeAgent: null,
      },
    });
    const undoState = getWorkflowPresetUndoState(before, "codex");
    const after = makeSettings({
      ...before,
      modelSelectionPresets: {
        codex: {
          focus: {
            ...before.modelSelectionPresets.codex.focus!,
            askModelSelection: { provider: "codex", model: "gpt-5.3-codex" },
          },
        },
        claudeAgent: {},
      },
    });

    expect(isWorkflowPresetUndoDirty(after, undoState)).toBe(true);
    expect(getWorkflowPresetUndoPatch(after, undoState)).toEqual({
      modelSelectionPresetOps: [
        {
          op: "update",
          provider: "codex",
          presetId: "focus",
          patch: {
            askModelSelection: { provider: "codex", model: "gpt-5.4" },
          },
        },
      ],
    });
  });

  it("does not treat preset selection changes as workflow preset dirtiness", () => {
    const before = makeSettings({
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
        claudeAgent: {},
      },
      activeModelSelectionPresetByProvider: {
        codex: null,
        claudeAgent: null,
      },
    });
    const undoState = getWorkflowPresetUndoState(before, "codex");
    const after = makeSettings({
      ...before,
      activeModelSelectionPresetByProvider: {
        codex: "focus",
        claudeAgent: null,
      },
    });

    expect(isWorkflowPresetUndoDirty(after, undoState)).toBe(false);
    expect(getWorkflowPresetUndoPatch(after, undoState)).toEqual({});
  });

  it("restores default-mode base selections when undoing from default", () => {
    const before = makeSettings({
      askModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
    });
    const undoState = getWorkflowPresetUndoState(before, "claudeAgent");
    const after = makeSettings({
      askModelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
    });

    expect(getWorkflowPresetUndoPatch(after, undoState)).toEqual({
      askModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
    });
  });

  it("locks workflow preset model controls to the selected provider family", () => {
    const mockedModelSelectionControl = vi
      .spyOn(SettingsPanelPrimitives, "ModelSelectionControl")
      .mockImplementation(() => <></>);

    try {
      renderToStaticMarkup(
        <SettingsModelsSection settings={makeSettings()} updateSettings={() => {}} />,
      );

      expect(mockedModelSelectionControl).toHaveBeenCalled();
      for (const [props] of mockedModelSelectionControl.mock.calls) {
        expect(props.lockedProvider).toBe("codex");
      }
    } finally {
      mockedModelSelectionControl.mockRestore();
    }
  });
});
