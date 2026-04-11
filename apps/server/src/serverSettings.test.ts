import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_MODEL_SELECTION_PRESET_ID,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelectionPreset,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { ServerConfig } from "./config";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings";

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

const makeCodexPreset = (
  id: string,
  name: string,
  model = "gpt-5.4",
): Extract<ModelSelectionPreset, { provider: "codex" }> => ({
  id,
  provider: "codex",
  name,
  askModelSelection: { provider: "codex", model },
  planModelSelection: { provider: "codex", model },
  codeModelSelection: { provider: "codex", model },
  reviewModelSelection: { provider: "codex", model },
});

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes nested settings patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(decodePatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }), {
        providers: { codex: { binaryPath: "/tmp/codex" } },
      });

      assert.deepEqual(
        decodePatch({
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        }),
        {
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        },
      );

      assert.deepEqual(
        decodePatch({
          promptEnhanceModelSelection: {
            provider: "claudeAgent",
            model: "claude-haiku-4-5",
          },
        }),
        {
          promptEnhanceModelSelection: {
            provider: "claudeAgent",
            model: "claude-haiku-4-5",
          },
        },
      );
    }),
  );

  it.effect("decodes commitMessageStyle patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(decodePatch({ commitMessageStyle: "summary" }), {
        commitMessageStyle: "summary",
      });
    }),
  );

  it.effect("decodes preset patch operations", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(
        decodePatch({
          modelSelectionPresetOps: [
            {
              op: "create",
              preset: makeCodexPreset("focus", "Focus"),
            },
            {
              op: "select",
              provider: "codex",
              presetId: "focus",
            },
          ],
        }),
        {
          modelSelectionPresetOps: [
            {
              op: "create",
              preset: makeCodexPreset("focus", "Focus"),
            },
            {
              op: "select",
              provider: "codex",
              presetId: "focus",
            },
          ],
        },
      );
    }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
          },
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            customModels: ["claude-custom"],
          },
        },
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: "high",
            fastMode: true,
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: {
            fastMode: false,
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/usr/local/bin/claude",
        customModels: ["claude-custom"],
      });
      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        options: {
          reasoningEffort: "high",
          fastMode: false,
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("replaces model-selection options when resetting to the same model", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: "low",
          },
        },
        promptEnhanceModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.promptEnhanceModelSelection.model,
          options: {
            reasoningEffort: "low",
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        },
        promptEnhanceModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.promptEnhanceModelSelection.model,
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
      });
      assert.deepEqual(next.promptEnhanceModelSelection, {
        provider: "codex",
        model: DEFAULT_SERVER_SETTINGS.promptEnhanceModelSelection.model,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists promptEnhanceModelSelection and reads it back", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        promptEnhanceModelSelection: {
          provider: "claudeAgent",
          model: "claude-haiku-4-5",
          options: {
            fastMode: true,
          },
        },
      });

      assert.deepEqual(next.promptEnhanceModelSelection, {
        provider: "claudeAgent",
        model: "claude-haiku-4-5",
        options: {
          fastMode: true,
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: {
            effort: "high",
          },
        },
      });

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            reasoningEffort: "high",
          },
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "high",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via promptEnhanceModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        promptEnhanceModelSelection: {
          provider: "claudeAgent",
          model: "claude-haiku-4-5",
          options: {
            fastMode: true,
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        promptEnhanceModelSelection: {
          provider: "codex",
          model: "gpt-5.4-mini",
          options: {
            reasoningEffort: "low",
          },
        },
      });

      assert.deepEqual(next.promptEnhanceModelSelection, {
        provider: "codex",
        model: "gpt-5.4-mini",
        options: {
          reasoningEffort: "low",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            binaryPath: "  /opt/homebrew/bin/claude  ",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/claude",
        customModels: [],
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            binaryPath: "",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        commitMessageStyle: "type-summary",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        commitMessageStyle: "type-summary",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("creates a preset and selects it", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        modelSelectionPresetOps: [
          {
            op: "create",
            preset: makeCodexPreset("focus", "Focus"),
          },
          {
            op: "select",
            provider: "codex",
            presetId: "focus",
          },
        ],
      });

      assert.equal(next.activeModelSelectionPresetByProvider.codex, "focus");
      assert.equal(next.modelSelectionPresets.codex.focus?.name, "Focus");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("seeds built-in starter presets for Codex and Claude", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const next = yield* serverSettings.getSettings;

      assert.equal(next.modelSelectionPresets.codex[DEFAULT_MODEL_SELECTION_PRESET_ID], undefined);
      assert.equal(next.modelSelectionPresets.codex["starter-codex-free"]?.name, "Free");
      assert.deepEqual(
        next.modelSelectionPresets.codex["starter-codex-pro-5x"]?.askModelSelection,
        {
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          options: {
            reasoningEffort: "low",
          },
        },
      );
      assert.deepEqual(
        next.modelSelectionPresets.codex["starter-codex-pro-5x"]?.codeModelSelection,
        {
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          options: {
            reasoningEffort: "medium",
          },
        },
      );
      assert.deepEqual(
        next.modelSelectionPresets.codex["starter-codex-pro-20x"]?.askModelSelection,
        {
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          options: {
            reasoningEffort: "low",
          },
        },
      );
      assert.deepEqual(
        next.modelSelectionPresets.codex["starter-codex-pro-20x"]?.reviewModelSelection,
        {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: {
            reasoningEffort: "xhigh",
          },
        },
      );
      assert.equal(
        next.modelSelectionPresets.claudeAgent[DEFAULT_MODEL_SELECTION_PRESET_ID],
        undefined,
      );
      assert.equal(next.modelSelectionPresets.claudeAgent["starter-claude-free"]?.name, "Free");
      assert.deepEqual(
        next.modelSelectionPresets.claudeAgent["starter-claude-max-20x"]?.reviewModelSelection,
        {
          provider: "claudeAgent",
          model: "claude-opus-4-6",
          options: {
            effort: "high",
          },
        },
      );
      assert.equal(next.activeModelSelectionPresetByProvider.codex, null);
      assert.equal(next.activeModelSelectionPresetByProvider.claudeAgent, null);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("migrates legacy built-in preset entries to the current starter set", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const next = yield* serverSettings.getSettings;

      assert.equal(next.modelSelectionPresets.codex["starter-codex-pro-100"], undefined);
      assert.equal(next.modelSelectionPresets.codex["starter-codex-pro-200"], undefined);
      assert.equal(next.modelSelectionPresets.codex["starter-codex-free"]?.name, "Free");
      assert.equal(next.modelSelectionPresets.codex["starter-codex-go"]?.name, "Go");
      assert.equal(next.modelSelectionPresets.codex["starter-codex-plus"]?.name, "Plus");
      assert.deepEqual(
        next.modelSelectionPresets.codex["starter-codex-pro-5x"]?.askModelSelection,
        {
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          options: {
            reasoningEffort: "low",
          },
        },
      );
      assert.deepEqual(
        next.modelSelectionPresets.codex["starter-codex-pro-5x"]?.codeModelSelection,
        {
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          options: {
            reasoningEffort: "medium",
          },
        },
      );
      assert.deepEqual(
        next.modelSelectionPresets.codex["starter-codex-pro-20x"]?.askModelSelection,
        {
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          options: {
            reasoningEffort: "low",
          },
        },
      );
      assert.equal(next.modelSelectionPresets.claudeAgent["starter-claude-free"]?.name, "Free");
      assert.equal(next.modelSelectionPresets.claudeAgent["starter-claude-pro"]?.name, "Pro");
      assert.equal(
        next.modelSelectionPresets.claudeAgent["starter-claude-max-5x"]?.name,
        "Max (5X)",
      );
      assert.equal(
        next.modelSelectionPresets.claudeAgent["starter-claude-max-20x"]?.name,
        "Max (20X)",
      );
    }).pipe(
      Effect.provide(
        ServerSettingsService.layerTest({
          modelSelectionPresets: {
            codex: {
              "starter-codex-free": {
                id: "starter-codex-free",
                provider: "codex",
                name: "free",
                askModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
                planModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
                codeModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
                reviewModelSelection: { provider: "codex", model: "gpt-5.4" },
              },
              "starter-codex-go": {
                id: "starter-codex-go",
                provider: "codex",
                name: "go",
                askModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
                planModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
                codeModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
                reviewModelSelection: { provider: "codex", model: "gpt-5.4" },
              },
              "starter-codex-plus": {
                id: "starter-codex-plus",
                provider: "codex",
                name: "plus",
                askModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
                planModelSelection: { provider: "codex", model: "gpt-5.4" },
                codeModelSelection: { provider: "codex", model: "gpt-5.4-mini" },
                reviewModelSelection: { provider: "codex", model: "gpt-5.3-codex" },
              },
              "starter-codex-pro-5x": {
                id: "starter-codex-pro-5x",
                provider: "codex",
                name: "Pro (5X)",
                askModelSelection: {
                  provider: "codex",
                  model: "gpt-5.4",
                  options: {
                    reasoningEffort: "low",
                  },
                },
                planModelSelection: {
                  provider: "codex",
                  model: "gpt-5.4",
                  options: {
                    reasoningEffort: "high",
                  },
                },
                codeModelSelection: {
                  provider: "codex",
                  model: "gpt-5.3-codex",
                  options: {
                    reasoningEffort: "medium",
                  },
                },
                reviewModelSelection: {
                  provider: "codex",
                  model: "gpt-5.3-codex",
                  options: {
                    reasoningEffort: "high",
                  },
                },
              },
              "starter-codex-pro-20x": {
                id: "starter-codex-pro-20x",
                provider: "codex",
                name: "Pro (20X)",
                askModelSelection: {
                  provider: "codex",
                  model: "gpt-5.4",
                  options: {
                    reasoningEffort: "medium",
                  },
                },
                planModelSelection: {
                  provider: "codex",
                  model: "gpt-5.4",
                  options: {
                    reasoningEffort: "high",
                  },
                },
                codeModelSelection: {
                  provider: "codex",
                  model: "gpt-5.3-codex",
                  options: {
                    reasoningEffort: "high",
                  },
                },
                reviewModelSelection: {
                  provider: "codex",
                  model: "gpt-5.3-codex",
                  options: {
                    reasoningEffort: "xhigh",
                  },
                },
              },
              "starter-codex-pro-100": makeCodexPreset("starter-codex-pro-100", "pro 100"),
              "starter-codex-pro-200": makeCodexPreset("starter-codex-pro-200", "pro 200"),
            },
            claudeAgent: {
              "starter-claude-free": {
                id: "starter-claude-free",
                provider: "claudeAgent",
                name: "free",
                askModelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
                planModelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
                codeModelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
                reviewModelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
              },
              "starter-claude-pro": {
                id: "starter-claude-pro",
                provider: "claudeAgent",
                name: "pro",
                askModelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
                planModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
                codeModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
                reviewModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
              },
              "starter-claude-max-5x": {
                id: "starter-claude-max-5x",
                provider: "claudeAgent",
                name: "max 5x",
                askModelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
                planModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
                codeModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
                reviewModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
              },
              "starter-claude-max-20x": {
                id: "starter-claude-max-20x",
                provider: "claudeAgent",
                name: "max 20x",
                askModelSelection: { provider: "claudeAgent", model: "claude-haiku-4-5" },
                planModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
                codeModelSelection: { provider: "claudeAgent", model: "claude-sonnet-4-6" },
                reviewModelSelection: { provider: "claudeAgent", model: "claude-opus-4-6" },
              },
            },
          },
        }),
      ),
    ),
  );

  it.effect("renames and deletes a preset", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        modelSelectionPresetOps: [
          {
            op: "create",
            preset: makeCodexPreset("focus", "Focus"),
          },
          {
            op: "select",
            provider: "codex",
            presetId: "focus",
          },
        ],
      });

      const renamed = yield* serverSettings.updateSettings({
        modelSelectionPresetOps: [
          {
            op: "update",
            provider: "codex",
            presetId: "focus",
            patch: {
              name: "Focused work",
            },
          },
        ],
      });

      assert.equal(renamed.modelSelectionPresets.codex.focus?.name, "Focused work");

      const deleted = yield* serverSettings.updateSettings({
        modelSelectionPresetOps: [
          {
            op: "delete",
            provider: "codex",
            presetId: "focus",
          },
        ],
      });

      assert.equal(deleted.modelSelectionPresets.codex.focus, undefined);
      assert.equal(deleted.activeModelSelectionPresetByProvider.codex, null);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("switches the active preset", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        modelSelectionPresetOps: [
          {
            op: "create",
            preset: makeCodexPreset("focus", "Focus"),
          },
          {
            op: "create",
            preset: makeCodexPreset("speed", "Speed", "gpt-5.3-codex"),
          },
          {
            op: "select",
            provider: "codex",
            presetId: "focus",
          },
        ],
      });

      const next = yield* serverSettings.updateSettings({
        modelSelectionPresetOps: [
          {
            op: "select",
            provider: "codex",
            presetId: "speed",
          },
        ],
      });

      assert.equal(next.activeModelSelectionPresetByProvider.codex, "speed");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists and reloads presets", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3code-server-settings-preset-persist-",
      });
      const firstLayer = Layer.fresh(
        ServerSettingsLive.pipe(Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir))),
      );
      const secondLayer = Layer.fresh(
        ServerSettingsLive.pipe(Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir))),
      );

      yield* Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsService;
        yield* serverSettings.updateSettings({
          modelSelectionPresetOps: [
            {
              op: "create",
              preset: makeCodexPreset("focus", "Focus"),
            },
            {
              op: "select",
              provider: "codex",
              presetId: "focus",
            },
          ],
        });
      }).pipe(Effect.provide(firstLayer));

      const reloaded = yield* Effect.gen(function* () {
        const serverSettings = yield* ServerSettingsService;
        return yield* serverSettings.getSettings;
      }).pipe(Effect.provide(secondLayer));

      assert.equal(reloaded.modelSelectionPresets.codex.focus?.name, "Focus");
      assert.equal(reloaded.activeModelSelectionPresetByProvider.codex, "focus");
    }),
  );

  it.effect("migrates existing per-mode selections into the default preset", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const next = yield* serverSettings.getSettings;

      assert.equal(next.activeModelSelectionPresetByProvider.codex, null);
      assert.equal(
        next.modelSelectionPresets.codex[DEFAULT_MODEL_SELECTION_PRESET_ID]?.name,
        "Default",
      );
      assert.equal(
        next.modelSelectionPresets.claudeAgent[DEFAULT_MODEL_SELECTION_PRESET_ID],
        undefined,
      );
      assert.equal(next.modelSelectionPresets.codex["starter-codex-free"]?.name, "Free");
    }).pipe(
      Effect.provide(
        ServerSettingsService.layerTest({
          askModelSelection: { provider: "codex", model: "gpt-5.4" },
          planModelSelection: { provider: "codex", model: "gpt-5.4" },
          codeModelSelection: { provider: "codex", model: "gpt-5.4" },
          reviewModelSelection: { provider: "codex", model: "gpt-5.4" },
        }),
      ),
    ),
  );

  it.effect("does not replace an existing active preset when adding a missing default preset", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const next = yield* serverSettings.getSettings;

      assert.equal(next.activeModelSelectionPresetByProvider.codex, "focus");
      assert.equal(
        next.modelSelectionPresets.codex[DEFAULT_MODEL_SELECTION_PRESET_ID]?.name,
        "Default",
      );
      assert.equal(next.modelSelectionPresets.codex.focus?.name, "Focus");
    }).pipe(
      Effect.provide(
        ServerSettingsService.layerTest({
          askModelSelection: { provider: "codex", model: "gpt-5.4" },
          planModelSelection: { provider: "codex", model: "gpt-5.4" },
          codeModelSelection: { provider: "codex", model: "gpt-5.4" },
          reviewModelSelection: { provider: "codex", model: "gpt-5.4" },
          modelSelectionPresets: {
            codex: {
              focus: makeCodexPreset("focus", "Focus"),
            },
            claudeAgent: {},
          },
          activeModelSelectionPresetByProvider: {
            codex: "focus",
            claudeAgent: null,
          },
        }),
      ),
    ),
  );

  it.effect("clears persisted default preset pointers back to the virtual default state", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const next = yield* serverSettings.getSettings;

      assert.equal(next.activeModelSelectionPresetByProvider.codex, null);
      assert.equal(
        next.modelSelectionPresets.codex[DEFAULT_MODEL_SELECTION_PRESET_ID]?.name,
        "Default",
      );
    }).pipe(
      Effect.provide(
        ServerSettingsService.layerTest({
          askModelSelection: { provider: "codex", model: "gpt-5.4" },
          planModelSelection: { provider: "codex", model: "gpt-5.4" },
          codeModelSelection: { provider: "codex", model: "gpt-5.4" },
          reviewModelSelection: { provider: "codex", model: "gpt-5.4" },
          activeModelSelectionPresetByProvider: {
            codex: DEFAULT_MODEL_SELECTION_PRESET_ID,
            claudeAgent: null,
          },
        }),
      ),
    ),
  );

  it.effect("preserves preset data when the preset provider is disabled", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const next = yield* serverSettings.getSettings;

      assert.equal(next.activeModelSelectionPresetByProvider.codex, "focus");
      assert.equal(next.modelSelectionPresets.codex.focus?.askModelSelection.provider, "codex");
    }).pipe(
      Effect.provide(
        ServerSettingsService.layerTest({
          providers: {
            codex: {
              enabled: false,
            },
          },
          modelSelectionPresets: {
            codex: {
              focus: makeCodexPreset("focus", "Focus"),
            },
            claudeAgent: {},
          },
          activeModelSelectionPresetByProvider: {
            codex: "focus",
            claudeAgent: null,
          },
        }),
      ),
    ),
  );

  it.effect("clears invalid active preset pointers without corrupting preset data", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const next = yield* serverSettings.getSettings;

      assert.equal(next.activeModelSelectionPresetByProvider.codex, null);
      assert.equal(next.modelSelectionPresets.codex.focus?.name, "Focus");
    }).pipe(
      Effect.provide(
        ServerSettingsService.layerTest({
          modelSelectionPresets: {
            codex: {
              focus: makeCodexPreset("focus", "Focus"),
            },
            claudeAgent: {},
          },
          activeModelSelectionPresetByProvider: {
            codex: "missing",
            claudeAgent: null,
          },
        }),
      ),
    ),
  );

  it.effect("defaults commitMessageStyle to summary", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({});

      assert.equal(next.commitMessageStyle, "summary");
      assert.equal(DEFAULT_SERVER_SETTINGS.commitMessageStyle, "summary");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("omits default commitMessageStyle when persisting sparse settings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      yield* serverSettings.updateSettings({
        commitMessageStyle: DEFAULT_SERVER_SETTINGS.commitMessageStyle,
      });

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {});
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("does not persist built-in presets when writing sparse settings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      yield* serverSettings.updateSettings({});

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {});
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  // ── Kodo: ask/plan/code model selection persistence ──────────────────

  it.effect("persists askModelSelection and reads it back", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        askModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: {
            thinking: true,
          },
        },
      });

      assert.deepEqual(next.askModelSelection, {
        provider: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: {
          thinking: true,
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists planModelSelection and reads it back", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        planModelSelection: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: {
            reasoningEffort: "high",
          },
        },
      });

      assert.deepEqual(next.planModelSelection, {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: {
          reasoningEffort: "high",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("persists codeModelSelection and reads it back", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        codeModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            reasoningEffort: "medium",
          },
        },
      });

      assert.deepEqual(next.codeModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "medium",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("clears askModelSelection when set to null", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        askModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: { thinking: true },
        },
      });

      const next = yield* serverSettings.updateSettings({
        askModelSelection: null,
      });

      assert.equal(next.askModelSelection, null);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("clears planModelSelection when set to null", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        planModelSelection: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: { reasoningEffort: "high" },
        },
      });

      const next = yield* serverSettings.updateSettings({
        planModelSelection: null,
      });

      assert.equal(next.planModelSelection, null);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("ask, plan, and code model selections are independent", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        askModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: { thinking: true },
        },
        planModelSelection: {
          provider: "codex",
          model: "gpt-5.3-codex",
          options: { reasoningEffort: "high" },
        },
        codeModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: { reasoningEffort: "low" },
        },
      });

      // Update only plan selection — ask and code should be untouched
      const next = yield* serverSettings.updateSettings({
        planModelSelection: {
          model: "gpt-5.4",
        },
      });

      const askModelSelection = next.askModelSelection;
      assert.ok(askModelSelection);
      if (askModelSelection.provider !== "claudeAgent") {
        throw new Error(`expected claudeAgent selection, got ${askModelSelection.provider}`);
      }
      assert.equal(askModelSelection.model, "claude-sonnet-4-6");

      const codeModelSelection = next.codeModelSelection;
      assert.ok(codeModelSelection);
      if (codeModelSelection.provider !== "codex") {
        throw new Error(`expected codex selection, got ${codeModelSelection.provider}`);
      }
      assert.equal(codeModelSelection.model, "gpt-5.4");
      assert.equal(codeModelSelection.options?.reasoningEffort, "low");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults askModelSelection, planModelSelection, and codeModelSelection to null", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      // Read initial settings — ask/plan/code should default to null
      const initial = yield* serverSettings.updateSettings({});

      assert.equal(initial.askModelSelection, null);
      assert.equal(initial.planModelSelection, null);
      assert.equal(initial.codeModelSelection, null);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults promptEnhanceModelSelection to the git text generation model", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const initial = yield* serverSettings.updateSettings({});

      assert.deepEqual(initial.promptEnhanceModelSelection, {
        provider: "codex",
        model: DEFAULT_SERVER_SETTINGS.promptEnhanceModelSelection.model,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("decodes ask/plan/code model selection patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(
        decodePatch({
          askModelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-6",
            options: { thinking: true },
          },
        }),
        {
          askModelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-6",
            options: { thinking: true },
          },
        },
      );

      assert.deepEqual(
        decodePatch({
          planModelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: { reasoningEffort: "high" },
          },
        }),
        {
          planModelSelection: {
            provider: "codex",
            model: "gpt-5.3-codex",
            options: { reasoningEffort: "high" },
          },
        },
      );

      assert.deepEqual(decodePatch({ codeModelSelection: null }), { codeModelSelection: null });
      assert.deepEqual(
        decodePatch({
          promptEnhanceModelSelection: {
            provider: "codex",
            model: "gpt-5.4-mini",
            options: { reasoningEffort: "low" },
          },
        }),
        {
          promptEnhanceModelSelection: {
            provider: "codex",
            model: "gpt-5.4-mini",
            options: { reasoningEffort: "low" },
          },
        },
      );
    }),
  );
});
