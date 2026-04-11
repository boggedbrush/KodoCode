/**
 * ServerSettings - Server-authoritative settings service.
 *
 * Owns persistence, validation, and change notification of settings that affect
 * server-side behavior (binary paths, streaming mode, env mode, custom models,
 * text generation model selection, prompt enhancement model selection).
 *
 * Follows the same pattern as `keybindings.ts`: JSON file + Cache + PubSub +
 * Semaphore + FileSystem.watch for concurrency and external edit detection.
 *
 * @module ServerSettings
 */
import {
  DEFAULT_MODEL_SELECTION_PRESET_ID,
  DEFAULT_MODEL_SELECTION_PRESET_NAME,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ModelSelectionPreset,
  type ModelSelectionPresetPatchOperation,
  type ProviderKind,
  ServerSettings,
  ServerSettingsError,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  Cache,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Equal,
  PubSub,
  Ref,
  Schema,
  SchemaIssue,
  Scope,
  ServiceMap,
  Stream,
  Cause,
} from "effect";
import * as Semaphore from "effect/Semaphore";
import { ServerConfig } from "./config";
import { type DeepPartial, deepMerge } from "@t3tools/shared/Struct";
import { fromLenientJson } from "@t3tools/shared/schemaJson";

export interface ServerSettingsShape {
  /** Start the settings runtime and attach file watching. */
  readonly start: Effect.Effect<void, ServerSettingsError>;

  /** Await settings runtime readiness. */
  readonly ready: Effect.Effect<void, ServerSettingsError>;

  /** Read the current settings. */
  readonly getSettings: Effect.Effect<ServerSettings, ServerSettingsError>;

  /** Patch settings and persist. Returns the new full settings object. */
  readonly updateSettings: (
    patch: ServerSettingsPatch,
  ) => Effect.Effect<ServerSettings, ServerSettingsError>;

  /** Stream of settings change events. */
  readonly streamChanges: Stream.Stream<ServerSettings>;
}

export class ServerSettingsService extends ServiceMap.Service<
  ServerSettingsService,
  ServerSettingsShape
>()("t3/serverSettings/ServerSettingsService") {
  static readonly layerTest = (overrides: DeepPartial<ServerSettings> = {}) =>
    Layer.effect(
      ServerSettingsService,
      Effect.gen(function* () {
        const currentSettingsRef = yield* Ref.make<ServerSettings>(
          normalizePresetState(deepMerge(DEFAULT_SERVER_SETTINGS, overrides)),
        );

        return {
          start: Effect.void,
          ready: Effect.void,
          getSettings: Ref.get(currentSettingsRef).pipe(Effect.map(resolveEnabledModelSelections)),
          updateSettings: (patch) =>
            Ref.get(currentSettingsRef).pipe(
              Effect.map((currentSettings) => mergeServerSettingsPatch(currentSettings, patch)),
              Effect.tap((nextSettings) => Ref.set(currentSettingsRef, nextSettings)),
              Effect.map(resolveEnabledModelSelections),
            ),
          streamChanges: Stream.empty,
        } satisfies ServerSettingsShape;
      }),
    );
}

const ServerSettingsJson = fromLenientJson(ServerSettings);

const PROVIDER_ORDER: readonly ProviderKind[] = ["codex", "claudeAgent"];
const MODEL_SELECTION_SETTINGS_KEYS = [
  "textGenerationModelSelection",
  "promptEnhanceModelSelection",
  "askModelSelection",
  "planModelSelection",
  "codeModelSelection",
  "reviewModelSelection",
] as const;
type ModelSelectionSettingsKey = (typeof MODEL_SELECTION_SETTINGS_KEYS)[number];
type ProviderPresetMap = ServerSettings["modelSelectionPresets"][ProviderKind];

const PRESET_SELECTION_SETTINGS_KEYS = [
  "askModelSelection",
  "planModelSelection",
  "codeModelSelection",
  "reviewModelSelection",
] as const;
type PresetSelectionSettingsKey = (typeof PRESET_SELECTION_SETTINGS_KEYS)[number];

function makeCodexPreset(
  id: string,
  name: string,
  selections: {
    ask: { model: string; effort: "xhigh" | "high" | "medium" | "low" };
    plan: { model: string; effort: "xhigh" | "high" | "medium" | "low" };
    code: { model: string; effort: "xhigh" | "high" | "medium" | "low" };
    review: { model: string; effort: "xhigh" | "high" | "medium" | "low" };
  },
): Extract<ModelSelectionPreset, { provider: "codex" }> {
  return {
    id,
    provider: "codex",
    name,
    askModelSelection: {
      provider: "codex",
      model: selections.ask.model,
      options: { reasoningEffort: selections.ask.effort },
    },
    planModelSelection: {
      provider: "codex",
      model: selections.plan.model,
      options: { reasoningEffort: selections.plan.effort },
    },
    codeModelSelection: {
      provider: "codex",
      model: selections.code.model,
      options: { reasoningEffort: selections.code.effort },
    },
    reviewModelSelection: {
      provider: "codex",
      model: selections.review.model,
      options: { reasoningEffort: selections.review.effort },
    },
  };
}

function makeClaudePreset(
  id: string,
  name: string,
  selections: {
    ask: {
      model: string;
      thinking?: boolean;
      effort?: "low" | "medium" | "high" | "max" | "ultrathink";
    };
    plan: {
      model: string;
      thinking?: boolean;
      effort?: "low" | "medium" | "high" | "max" | "ultrathink";
    };
    code: {
      model: string;
      thinking?: boolean;
      effort?: "low" | "medium" | "high" | "max" | "ultrathink";
    };
    review: {
      model: string;
      thinking?: boolean;
      effort?: "low" | "medium" | "high" | "max" | "ultrathink";
    };
  },
): Extract<ModelSelectionPreset, { provider: "claudeAgent" }> {
  return {
    id,
    provider: "claudeAgent",
    name,
    askModelSelection: toClaudePresetSelection(selections.ask),
    planModelSelection: toClaudePresetSelection(selections.plan),
    codeModelSelection: toClaudePresetSelection(selections.code),
    reviewModelSelection: toClaudePresetSelection(selections.review),
  };
}

function toClaudePresetSelection(selection: {
  model: string;
  thinking?: boolean;
  effort?: "low" | "medium" | "high" | "max" | "ultrathink";
}) {
  return {
    provider: "claudeAgent" as const,
    model: selection.model,
    ...(selection.thinking !== undefined || selection.effort !== undefined
      ? {
          options: {
            ...(selection.thinking !== undefined ? { thinking: selection.thinking } : {}),
            ...(selection.effort !== undefined ? { effort: selection.effort } : {}),
          },
        }
      : {}),
  };
}

const BUILT_IN_MODEL_SELECTION_PRESETS: {
  readonly codex: ReadonlyArray<Extract<ModelSelectionPreset, { provider: "codex" }>>;
  readonly claudeAgent: ReadonlyArray<Extract<ModelSelectionPreset, { provider: "claudeAgent" }>>;
} = {
  codex: [
    makeCodexPreset("starter-codex-free", "free", {
      ask: { model: "gpt-5.4-mini", effort: "low" },
      plan: { model: "gpt-5.4-mini", effort: "medium" },
      code: { model: "gpt-5.4-mini", effort: "low" },
      review: { model: "gpt-5.4", effort: "low" },
    }),
    makeCodexPreset("starter-codex-go", "go", {
      ask: { model: "gpt-5.4-mini", effort: "low" },
      plan: { model: "gpt-5.4-mini", effort: "medium" },
      code: { model: "gpt-5.4-mini", effort: "low" },
      review: { model: "gpt-5.4", effort: "medium" },
    }),
    makeCodexPreset("starter-codex-plus", "plus", {
      ask: { model: "gpt-5.4-mini", effort: "low" },
      plan: { model: "gpt-5.4", effort: "medium" },
      code: { model: "gpt-5.4-mini", effort: "medium" },
      review: { model: "gpt-5.3-codex", effort: "medium" },
    }),
    makeCodexPreset("starter-codex-pro-100", "pro 100", {
      ask: { model: "gpt-5.4-mini", effort: "low" },
      plan: { model: "gpt-5.4", effort: "high" },
      code: { model: "gpt-5.4-mini", effort: "medium" },
      review: { model: "gpt-5.3-codex", effort: "high" },
    }),
    makeCodexPreset("starter-codex-pro-200", "pro 200", {
      ask: { model: "gpt-5.4-mini", effort: "low" },
      plan: { model: "gpt-5.3-codex", effort: "high" },
      code: { model: "gpt-5.4-mini", effort: "medium" },
      review: { model: "gpt-5.3-codex", effort: "xhigh" },
    }),
  ],
  claudeAgent: [
    makeClaudePreset("starter-claude-free", "free", {
      ask: { model: "claude-haiku-4-5", thinking: false },
      plan: { model: "claude-haiku-4-5", thinking: true },
      code: { model: "claude-haiku-4-5", thinking: false },
      review: { model: "claude-haiku-4-5", thinking: true },
    }),
    makeClaudePreset("starter-claude-pro", "pro", {
      ask: { model: "claude-haiku-4-5", thinking: false },
      plan: { model: "claude-sonnet-4-6", effort: "low" },
      code: { model: "claude-sonnet-4-6", effort: "low" },
      review: { model: "claude-sonnet-4-6", effort: "medium" },
    }),
    makeClaudePreset("starter-claude-max-5x", "max 5x", {
      ask: { model: "claude-haiku-4-5", thinking: false },
      plan: { model: "claude-sonnet-4-6", effort: "low" },
      code: { model: "claude-sonnet-4-6", effort: "low" },
      review: { model: "claude-sonnet-4-6", effort: "high" },
    }),
    makeClaudePreset("starter-claude-max-20x", "max 20x", {
      ask: { model: "claude-haiku-4-5", thinking: false },
      plan: { model: "claude-sonnet-4-6", effort: "medium" },
      code: { model: "claude-sonnet-4-6", effort: "low" },
      review: { model: "claude-opus-4-6", effort: "high" },
    }),
  ],
};

/**
 * Ensure the `textGenerationModelSelection` points to an enabled provider.
 * If the selected provider is disabled, fall back to the first enabled
 * provider with its default model.  This is applied at read-time so the
 * persisted preference is preserved for when a provider is re-enabled.
 */
function resolveTextGenerationProvider(settings: ServerSettings): ServerSettings {
  const selection = resolveModelSelectionProvider(settings, settings.textGenerationModelSelection);
  return selection ? { ...settings, textGenerationModelSelection: selection } : settings;
}

function resolvePromptEnhanceProvider(settings: ServerSettings): ServerSettings {
  const selection = resolveModelSelectionProvider(settings, settings.promptEnhanceModelSelection);
  return selection ? { ...settings, promptEnhanceModelSelection: selection } : settings;
}

function resolveModelSelectionProvider(
  settings: ServerSettings,
  selection: ModelSelection,
): ModelSelection | null {
  if (settings.providers[selection.provider].enabled) {
    return selection;
  }

  const fallback = PROVIDER_ORDER.find((p) => settings.providers[p].enabled);
  if (!fallback) {
    // No providers enabled — return as-is; callers will report the error.
    return null;
  }

  return {
    provider: fallback,
    model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[fallback],
  } as ModelSelection;
}

function resolveEnabledModelSelections(settings: ServerSettings): ServerSettings {
  return resolvePromptEnhanceProvider(resolveTextGenerationProvider(settings));
}

function isSelectionForProvider(
  selection: ServerSettings[PresetSelectionSettingsKey],
  provider: ProviderKind,
): selection is ModelSelection {
  return selection !== null && selection.provider === provider;
}

function buildDefaultPresetFromBaseSelections(
  settings: ServerSettings,
  provider: ProviderKind,
): ModelSelectionPreset | null {
  const askModelSelection = settings.askModelSelection;
  const planModelSelection = settings.planModelSelection;
  const codeModelSelection = settings.codeModelSelection;
  const reviewModelSelection = settings.reviewModelSelection;

  if (
    !isSelectionForProvider(askModelSelection, provider) ||
    !isSelectionForProvider(planModelSelection, provider) ||
    !isSelectionForProvider(codeModelSelection, provider) ||
    !isSelectionForProvider(reviewModelSelection, provider)
  ) {
    return null;
  }

  return {
    id: DEFAULT_MODEL_SELECTION_PRESET_ID,
    provider,
    name: DEFAULT_MODEL_SELECTION_PRESET_NAME,
    askModelSelection,
    planModelSelection,
    codeModelSelection,
    reviewModelSelection,
  } as ModelSelectionPreset;
}

function seedBuiltInPresets(settings: ServerSettings): ServerSettings {
  let changed = false;
  const nextPresets = {
    ...settings.modelSelectionPresets,
    codex: { ...settings.modelSelectionPresets.codex },
    claudeAgent: { ...settings.modelSelectionPresets.claudeAgent },
  };

  for (const provider of PROVIDER_ORDER) {
    for (const preset of BUILT_IN_MODEL_SELECTION_PRESETS[provider]) {
      if (nextPresets[provider][preset.id]) {
        continue;
      }

      nextPresets[provider][preset.id] = preset as ProviderPresetMap[string];
      changed = true;
    }
  }

  return changed
    ? {
        ...settings,
        modelSelectionPresets: nextPresets,
      }
    : settings;
}

function seedDefaultPresetFromBaseSelections(settings: ServerSettings): ServerSettings {
  const nextPresets = {
    ...settings.modelSelectionPresets,
    codex: { ...settings.modelSelectionPresets.codex },
    claudeAgent: { ...settings.modelSelectionPresets.claudeAgent },
  };
  let changed = false;

  for (const provider of PROVIDER_ORDER) {
    if (nextPresets[provider][DEFAULT_MODEL_SELECTION_PRESET_ID]) {
      continue;
    }

    const preset = buildDefaultPresetFromBaseSelections(settings, provider);
    if (!preset) {
      continue;
    }

    nextPresets[provider][preset.id] = preset as Extract<
      ModelSelectionPreset,
      { provider: typeof provider }
    >;
    changed = true;
  }

  return changed
    ? {
        ...settings,
        modelSelectionPresets: nextPresets,
      }
    : settings;
}

function normalizeActivePresetPointers(settings: ServerSettings): ServerSettings {
  let changed = false;
  const nextActive = { ...settings.activeModelSelectionPresetByProvider };

  for (const provider of PROVIDER_ORDER) {
    const activePresetId = nextActive[provider];
    if (!activePresetId) {
      continue;
    }

    if (activePresetId === DEFAULT_MODEL_SELECTION_PRESET_ID) {
      nextActive[provider] = null;
      changed = true;
      continue;
    }

    if (!(activePresetId in settings.modelSelectionPresets[provider])) {
      nextActive[provider] = null;
      changed = true;
    }
  }

  return changed
    ? {
        ...settings,
        activeModelSelectionPresetByProvider: nextActive,
      }
    : settings;
}

function normalizePresetState(settings: ServerSettings): ServerSettings {
  return normalizeActivePresetPointers(
    seedDefaultPresetFromBaseSelections(seedBuiltInPresets(settings)),
  );
}

const DEFAULT_NORMALIZED_SERVER_SETTINGS = normalizePresetState(DEFAULT_SERVER_SETTINGS);

function isCompleteModelSelectionPatch(
  patch: ServerSettingsPatch[ModelSelectionSettingsKey],
): patch is Exclude<ServerSettings[ModelSelectionSettingsKey], null | undefined> {
  return (
    patch !== null &&
    patch !== undefined &&
    patch.provider !== undefined &&
    patch.model !== undefined
  );
}

function mergeModelSelectionPatch<T extends ModelSelection>(
  current: T | null | undefined,
  patch: DeepPartial<T> | null | undefined,
): T | null | undefined {
  if (patch === undefined) {
    return current;
  }

  if (patch === null) {
    return patch;
  }

  if (current === null || current === undefined) {
    if (patch.provider === undefined || patch.model === undefined) {
      return current;
    }

    return {
      provider: patch.provider,
      model: patch.model,
      ...(patch.options !== undefined ? { options: patch.options } : {}),
    } as T;
  }

  if (patch.provider !== undefined && patch.provider !== current.provider) {
    if (patch.model === undefined) {
      return current;
    }

    return {
      provider: patch.provider,
      model: patch.model,
      ...(patch.options !== undefined ? { options: patch.options } : {}),
    } as T;
  }

  if (patch.model !== undefined && patch.options === undefined) {
    return {
      provider: patch.provider ?? current.provider,
      model: patch.model,
    } as T;
  }

  return deepMerge(current, patch) as T;
}

function mergeModelSelectionSetting(
  current: ServerSettings[ModelSelectionSettingsKey] | undefined,
  patch: ServerSettingsPatch[ModelSelectionSettingsKey] | undefined,
): ServerSettings[ModelSelectionSettingsKey] | undefined {
  return mergeModelSelectionPatch(current, patch);
}

function mergePresetSelectionPatch<T extends ModelSelectionPreset>(
  current: T[PresetSelectionSettingsKey],
  patch: DeepPartial<T[PresetSelectionSettingsKey]> | undefined,
): T[PresetSelectionSettingsKey] {
  return mergeModelSelectionPatch(current, patch) as T[PresetSelectionSettingsKey];
}

function applyPresetOperation(
  settings: ServerSettings,
  operation: ModelSelectionPresetPatchOperation,
): ServerSettings {
  switch (operation.op) {
    case "create": {
      const provider = operation.preset.provider;
      return normalizePresetState({
        ...settings,
        modelSelectionPresets: {
          ...settings.modelSelectionPresets,
          [provider]: {
            ...settings.modelSelectionPresets[provider],
            [operation.preset.id]: operation.preset as Extract<
              ModelSelectionPreset,
              { provider: typeof provider }
            >,
          },
        },
      });
    }
    case "update": {
      const currentPreset = settings.modelSelectionPresets[operation.provider][operation.presetId];
      if (!currentPreset) {
        return settings;
      }

      const nextPreset =
        operation.provider === "codex"
          ? ({
              ...currentPreset,
              ...(operation.patch.name !== undefined ? { name: operation.patch.name } : {}),
              askModelSelection: mergePresetSelectionPatch(
                currentPreset.askModelSelection,
                operation.patch.askModelSelection,
              ),
              planModelSelection: mergePresetSelectionPatch(
                currentPreset.planModelSelection,
                operation.patch.planModelSelection,
              ),
              codeModelSelection: mergePresetSelectionPatch(
                currentPreset.codeModelSelection,
                operation.patch.codeModelSelection,
              ),
              reviewModelSelection: mergePresetSelectionPatch(
                currentPreset.reviewModelSelection,
                operation.patch.reviewModelSelection,
              ),
            } as Extract<ModelSelectionPreset, { provider: "codex" }>)
          : ({
              ...currentPreset,
              ...(operation.patch.name !== undefined ? { name: operation.patch.name } : {}),
              askModelSelection: mergePresetSelectionPatch(
                currentPreset.askModelSelection,
                operation.patch.askModelSelection,
              ),
              planModelSelection: mergePresetSelectionPatch(
                currentPreset.planModelSelection,
                operation.patch.planModelSelection,
              ),
              codeModelSelection: mergePresetSelectionPatch(
                currentPreset.codeModelSelection,
                operation.patch.codeModelSelection,
              ),
              reviewModelSelection: mergePresetSelectionPatch(
                currentPreset.reviewModelSelection,
                operation.patch.reviewModelSelection,
              ),
            } as Extract<ModelSelectionPreset, { provider: "claudeAgent" }>);

      return normalizePresetState({
        ...settings,
        modelSelectionPresets: {
          ...settings.modelSelectionPresets,
          [operation.provider]: {
            ...settings.modelSelectionPresets[operation.provider],
            [operation.presetId]: nextPreset as Extract<
              ModelSelectionPreset,
              { provider: typeof operation.provider }
            >,
          },
        },
      });
    }
    case "delete": {
      const currentProviderPresets = {
        ...settings.modelSelectionPresets[operation.provider],
      } as Record<string, ModelSelectionPreset>;
      if (!(operation.presetId in currentProviderPresets)) {
        return settings;
      }

      delete currentProviderPresets[operation.presetId];

      return normalizePresetState({
        ...settings,
        modelSelectionPresets: {
          ...settings.modelSelectionPresets,
          [operation.provider]: currentProviderPresets as ProviderPresetMap,
        },
      });
    }
    case "select":
      return normalizePresetState({
        ...settings,
        activeModelSelectionPresetByProvider: {
          ...settings.activeModelSelectionPresetByProvider,
          [operation.provider]:
            operation.presetId !== null &&
            operation.presetId !== DEFAULT_MODEL_SELECTION_PRESET_ID &&
            operation.presetId in settings.modelSelectionPresets[operation.provider]
              ? operation.presetId
              : null,
        },
      });
  }
}

function mergeServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const { modelSelectionPresetOps, ...basePatch } = patch;
  const next = deepMerge(current, basePatch);
  const nextSelections = next as Record<
    ModelSelectionSettingsKey,
    ServerSettings[ModelSelectionSettingsKey] | undefined
  >;

  for (const key of MODEL_SELECTION_SETTINGS_KEYS) {
    if (!(key in patch)) {
      continue;
    }
    nextSelections[key] = mergeModelSelectionSetting(current[key], patch[key]);
  }

  const withPresetOps = (modelSelectionPresetOps ?? []).reduce(applyPresetOperation, next);
  return normalizePresetState(withPresetOps);
}

// Values under these keys are compared as a whole — never stripped field-by-field.
const ATOMIC_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  ...MODEL_SELECTION_SETTINGS_KEYS,
  "modelSelectionPresets",
  "activeModelSelectionPresetByProvider",
]);

function stripDefaultServerSettings(current: unknown, defaults: unknown): unknown | undefined {
  if (Array.isArray(current) || Array.isArray(defaults)) {
    return Equal.equals(current, defaults) ? undefined : current;
  }

  if (
    current !== null &&
    defaults !== null &&
    typeof current === "object" &&
    typeof defaults === "object"
  ) {
    const currentRecord = current as Record<string, unknown>;
    const defaultsRecord = defaults as Record<string, unknown>;
    const next: Record<string, unknown> = {};

    for (const key of Object.keys(currentRecord)) {
      if (ATOMIC_SETTINGS_KEYS.has(key)) {
        if (!Equal.equals(currentRecord[key], defaultsRecord[key])) {
          next[key] = currentRecord[key];
        }
      } else {
        const stripped = stripDefaultServerSettings(currentRecord[key], defaultsRecord[key]);
        if (stripped !== undefined) {
          next[key] = stripped;
        }
      }
    }

    return Object.keys(next).length > 0 ? next : undefined;
  }

  return Object.is(current, defaults) ? undefined : current;
}

const makeServerSettings = Effect.gen(function* () {
  const { settingsPath } = yield* ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const writeSemaphore = yield* Semaphore.make(1);
  const cacheKey = "settings" as const;
  const changesPubSub = yield* PubSub.unbounded<ServerSettings>();
  const startedRef = yield* Ref.make(false);
  const startedDeferred = yield* Deferred.make<void, ServerSettingsError>();
  const watcherScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void));

  const emitChange = (settings: ServerSettings) =>
    PubSub.publish(changesPubSub, settings).pipe(Effect.asVoid);

  const readConfigExists = fs.exists(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          detail: "failed to check settings file existence",
          cause,
        }),
    ),
  );

  const readRawConfig = fs.readFileString(settingsPath).pipe(
    Effect.mapError(
      (cause) =>
        new ServerSettingsError({
          settingsPath,
          detail: "failed to read settings file",
          cause,
        }),
    ),
  );

  const loadSettingsFromDisk = Effect.gen(function* () {
    if (!(yield* readConfigExists)) {
      return DEFAULT_NORMALIZED_SERVER_SETTINGS;
    }

    const raw = yield* readRawConfig;
    const decoded = Schema.decodeUnknownExit(ServerSettingsJson)(raw);
    if (decoded._tag === "Failure") {
      yield* Effect.logWarning("failed to parse settings.json, using defaults", {
        path: settingsPath,
        issues: Cause.pretty(decoded.cause),
      });
      return DEFAULT_NORMALIZED_SERVER_SETTINGS;
    }
    return normalizePresetState(decoded.value);
  });

  const settingsCache = yield* Cache.make<typeof cacheKey, ServerSettings, ServerSettingsError>({
    capacity: 1,
    lookup: () => loadSettingsFromDisk,
  });

  const getSettingsFromCache = Cache.get(settingsCache, cacheKey);

  const writeSettingsAtomically = (settings: ServerSettings) => {
    const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    const sparseSettings =
      stripDefaultServerSettings(settings, DEFAULT_NORMALIZED_SERVER_SETTINGS) ?? {};

    return Effect.succeed(`${JSON.stringify(sparseSettings, null, 2)}\n`).pipe(
      Effect.tap(() => fs.makeDirectory(pathService.dirname(settingsPath), { recursive: true })),
      Effect.tap((encoded) => fs.writeFileString(tempPath, encoded)),
      Effect.flatMap(() => fs.rename(tempPath, settingsPath)),
      Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))),
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            detail: "failed to write settings file",
            cause,
          }),
      ),
    );
  };

  const revalidateAndEmit = writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(settingsCache, cacheKey);
      const settings = yield* getSettingsFromCache;
      yield* emitChange(settings);
    }),
  );

  const startWatcher = Effect.gen(function* () {
    const settingsDir = pathService.dirname(settingsPath);
    const settingsFile = pathService.basename(settingsPath);
    const settingsPathResolved = pathService.resolve(settingsPath);

    yield* fs.makeDirectory(settingsDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ServerSettingsError({
            settingsPath,
            detail: "failed to prepare settings directory",
            cause,
          }),
      ),
    );

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }));

    // Debounce watch events so the file is fully written before we read it.
    // Editors emit multiple events per save (truncate, write, rename) and
    // `fs.watch` can fire before the content has been flushed to disk.
    const debouncedSettingsEvents = fs.watch(settingsDir).pipe(
      Stream.filter((event) => {
        return (
          event.path === settingsFile ||
          event.path === settingsPath ||
          pathService.resolve(settingsDir, event.path) === settingsPathResolved
        );
      }),
      Stream.debounce(Duration.millis(100)),
    );

    yield* Stream.runForEach(debouncedSettingsEvents, () => revalidateAndEmitSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(watcherScope),
      Effect.asVoid,
    );
  });

  const start = Effect.gen(function* () {
    const shouldStart = yield* Ref.modify(startedRef, (started) => [!started, true]);
    if (!shouldStart) {
      return yield* Deferred.await(startedDeferred);
    }

    const startup = Effect.gen(function* () {
      yield* startWatcher;
      yield* Cache.invalidate(settingsCache, cacheKey);
      yield* getSettingsFromCache;
    });

    const startupExit = yield* Effect.exit(startup);
    if (startupExit._tag === "Failure") {
      yield* Deferred.failCause(startedDeferred, startupExit.cause).pipe(Effect.orDie);
      return yield* Effect.failCause(startupExit.cause);
    }

    yield* Deferred.succeed(startedDeferred, undefined).pipe(Effect.orDie);
  });

  return {
    start,
    ready: Deferred.await(startedDeferred),
    getSettings: getSettingsFromCache.pipe(Effect.map(resolveEnabledModelSelections)),
    updateSettings: (patch) =>
      writeSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* getSettingsFromCache;
          const next = yield* Schema.decodeEffect(ServerSettings)(
            mergeServerSettingsPatch(current, patch),
          ).pipe(
            Effect.mapError(
              (cause) =>
                new ServerSettingsError({
                  settingsPath: "<memory>",
                  detail: `failed to normalize server settings: ${SchemaIssue.makeFormatterDefault()(cause.issue)}`,
                  cause,
                }),
            ),
          );
          yield* writeSettingsAtomically(next);
          yield* Cache.set(settingsCache, cacheKey, next);
          yield* emitChange(next);
          return resolveEnabledModelSelections(next);
        }),
      ),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub).pipe(Stream.map(resolveEnabledModelSelections));
    },
  } satisfies ServerSettingsShape;
});

export const ServerSettingsLive = Layer.effect(ServerSettingsService, makeServerSettings);
