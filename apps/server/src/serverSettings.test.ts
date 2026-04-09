import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from "@t3tools/contracts";
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
