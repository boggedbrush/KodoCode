import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  DEFAULT_MODEL_SELECTION_PRESET_ID,
  ModelSelectionPreset,
  ServerSettings,
  ServerSettingsPatch,
} from "./settings";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeModelSelectionPreset = Schema.encodeSync(ModelSelectionPreset);

describe("settings presets", () => {
  it("decodes preset structures in server settings", () => {
    const decoded = decodeServerSettings({
      modelSelectionPresets: {
        codex: {
          [DEFAULT_MODEL_SELECTION_PRESET_ID]: {
            id: DEFAULT_MODEL_SELECTION_PRESET_ID,
            provider: "codex",
            name: "Default",
            askModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            planModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            codeModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            reviewModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
          },
        },
      },
      activeModelSelectionPresetByProvider: {
        codex: DEFAULT_MODEL_SELECTION_PRESET_ID,
      },
    });

    expect(decoded.activeModelSelectionPresetByProvider.codex).toBe(
      DEFAULT_MODEL_SELECTION_PRESET_ID,
    );
    expect(decoded.modelSelectionPresets.codex[DEFAULT_MODEL_SELECTION_PRESET_ID]?.name).toBe(
      "Default",
    );
  });

  it("encodes preset structures", () => {
    const encoded = encodeModelSelectionPreset({
      id: "focus",
      provider: "claudeAgent",
      name: "Focus",
      askModelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
      planModelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
      codeModelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
      reviewModelSelection: {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
      },
    });

    expect(encoded.provider).toBe("claudeAgent");
    expect(encoded.name).toBe("Focus");
  });

  it("decodes preset patch operations", () => {
    const decoded = decodeServerSettingsPatch({
      modelSelectionPresetOps: [
        {
          op: "create",
          preset: {
            id: "focus",
            provider: "codex",
            name: "Focus",
            askModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            planModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            codeModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            reviewModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
          },
        },
        {
          op: "update",
          provider: "codex",
          presetId: "focus",
          patch: {
            name: "Focused work",
            codeModelSelection: {
              model: "gpt-5.3-codex",
            },
          },
        },
        {
          op: "delete",
          provider: "codex",
          presetId: "focus",
        },
        {
          op: "select",
          provider: "claudeAgent",
          presetId: null,
        },
      ],
    });

    expect(decoded.modelSelectionPresetOps).toHaveLength(4);
  });
});
