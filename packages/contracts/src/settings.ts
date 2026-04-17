import { Effect } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas";
import {
  ClaudeModelOptions,
  CodexModelOptions,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
} from "./model";
import {
  ClaudeModelSelection,
  CodexModelSelection,
  ModelSelection,
  ProviderKind,
} from "./orchestration";
import { PromptEnhancePreset } from "./enhance";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const ChatFontFamily = Schema.Literals(["auto", "dm-sans", "noto-sans-arabic"]);
export type ChatFontFamily = typeof ChatFontFamily.Type;
export const DEFAULT_CHAT_FONT_FAMILY: ChatFontFamily = "auto";

export const ClientSettingsSchema = Schema.Struct({
  chatFontFamily: ChatFontFamily.pipe(Schema.withDecodingDefault(() => DEFAULT_CHAT_FONT_FAMILY)),
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  diffWordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  promptEnhancePreset: PromptEnhancePreset.pipe(
    Schema.withDecodingDefault(() => "balanced" as const satisfies typeof PromptEnhancePreset.Type),
  ),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_PROJECT_SORT_ORDER),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(() => DEFAULT_SIDEBAR_THREAD_SORT_ORDER),
  ),
  timestampFormat: TimestampFormat.pipe(Schema.withDecodingDefault(() => DEFAULT_TIMESTAMP_FORMAT)),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

export const CommitMessageStyle = Schema.Literals([
  "summary",
  "type-summary",
  "type-scope-summary",
]);
export type CommitMessageStyle = typeof CommitMessageStyle.Type;
export const DEFAULT_COMMIT_MESSAGE_STYLE: CommitMessageStyle = "summary";

const makeBinaryPathSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || fallback),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(() => fallback),
  );

export const CodexSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("codex"),
  homePath: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type CodexSettings = typeof CodexSettings.Type;

export const ClaudeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
  binaryPath: makeBinaryPathSetting("claude"),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(() => [])),
});
export type ClaudeSettings = typeof ClaudeSettings.Type;

export const ObservabilitySettings = Schema.Struct({
  otlpTracesUrl: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
  otlpMetricsUrl: TrimmedString.pipe(Schema.withDecodingDefault(() => "")),
});
export type ObservabilitySettings = typeof ObservabilitySettings.Type;

export const MODEL_SELECTION_PRESET_ID_MAX_LENGTH = 64;
export const MODEL_SELECTION_PRESET_NAME_MAX_LENGTH = 64;
export const DEFAULT_MODEL_SELECTION_PRESET_ID = "default";
export const DEFAULT_MODEL_SELECTION_PRESET_NAME = "Default";

export const ModelSelectionPresetId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MODEL_SELECTION_PRESET_ID_MAX_LENGTH),
);
export type ModelSelectionPresetId = typeof ModelSelectionPresetId.Type;

export const ModelSelectionPresetName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MODEL_SELECTION_PRESET_NAME_MAX_LENGTH),
);
export type ModelSelectionPresetName = typeof ModelSelectionPresetName.Type;

export const CodexModelSelectionPreset = Schema.Struct({
  id: ModelSelectionPresetId,
  provider: Schema.Literal("codex"),
  name: ModelSelectionPresetName,
  askModelSelection: CodexModelSelection,
  planModelSelection: CodexModelSelection,
  codeModelSelection: CodexModelSelection,
  reviewModelSelection: CodexModelSelection,
});
export type CodexModelSelectionPreset = typeof CodexModelSelectionPreset.Type;

export const ClaudeModelSelectionPreset = Schema.Struct({
  id: ModelSelectionPresetId,
  provider: Schema.Literal("claudeAgent"),
  name: ModelSelectionPresetName,
  askModelSelection: ClaudeModelSelection,
  planModelSelection: ClaudeModelSelection,
  codeModelSelection: ClaudeModelSelection,
  reviewModelSelection: ClaudeModelSelection,
});
export type ClaudeModelSelectionPreset = typeof ClaudeModelSelectionPreset.Type;

export const ModelSelectionPreset = Schema.Union([
  CodexModelSelectionPreset,
  ClaudeModelSelectionPreset,
]);
export type ModelSelectionPreset = typeof ModelSelectionPreset.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(() => "local" as const satisfies ThreadEnvMode),
  ),
  commitMessageStyle: CommitMessageStyle.pipe(
    Schema.withDecodingDefault(() => DEFAULT_COMMIT_MESSAGE_STYLE),
  ),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "codex" as const,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
    })),
  ),
  promptEnhanceModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(() => ({
      provider: "codex" as const,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
    })),
  ),

  // ── Kodo: per-mode model selections ────────────────────────────
  // When set, these override the composer model selection for the
  // corresponding Ask / Plan / Code / Review mode.  When unset the existing default
  // model behavior is preserved (no regression).
  askModelSelection: Schema.NullOr(ModelSelection).pipe(Schema.withDecodingDefault(() => null)),
  planModelSelection: Schema.NullOr(ModelSelection).pipe(Schema.withDecodingDefault(() => null)),
  codeModelSelection: Schema.NullOr(ModelSelection).pipe(Schema.withDecodingDefault(() => null)),
  reviewModelSelection: Schema.NullOr(ModelSelection).pipe(Schema.withDecodingDefault(() => null)),

  modelSelectionPresets: Schema.Struct({
    codex: Schema.Record(
      TrimmedNonEmptyString,
      Schema.suspend(() => CodexModelSelectionPreset),
    ).pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: Schema.Record(
      TrimmedNonEmptyString,
      Schema.suspend(() => ClaudeModelSelectionPreset),
    ).pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
  activeModelSelectionPresetByProvider: Schema.Struct({
    codex: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
    claudeAgent: Schema.NullOr(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => null)),
  }).pipe(Schema.withDecodingDefault(() => ({}))),

  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(() => ({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(() => ({}))),
  }).pipe(Schema.withDecodingDefault(() => ({}))),
  observability: ObservabilitySettings.pipe(Schema.withDecodingDefault(() => ({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const CodexModelOptionsPatch = Schema.Struct({
  reasoningEffort: Schema.optionalKey(CodexModelOptions.fields.reasoningEffort),
  fastMode: Schema.optionalKey(CodexModelOptions.fields.fastMode),
});

const ClaudeModelOptionsPatch = Schema.Struct({
  thinking: Schema.optionalKey(ClaudeModelOptions.fields.thinking),
  effort: Schema.optionalKey(ClaudeModelOptions.fields.effort),
  fastMode: Schema.optionalKey(ClaudeModelOptions.fields.fastMode),
  contextWindow: Schema.optionalKey(ClaudeModelOptions.fields.contextWindow),
});

const ModelSelectionPatch = Schema.Union([
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("codex")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(CodexModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("claudeAgent")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(ClaudeModelOptionsPatch),
  }),
]);

const CodexModelSelectionPatch = Schema.Struct({
  provider: Schema.optionalKey(Schema.Literal("codex")),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  options: Schema.optionalKey(CodexModelOptionsPatch),
});

const ClaudeModelSelectionPatch = Schema.Struct({
  provider: Schema.optionalKey(Schema.Literal("claudeAgent")),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  options: Schema.optionalKey(ClaudeModelOptionsPatch),
});

const CodexModelSelectionPresetUpdatePatch = Schema.Struct({
  name: Schema.optionalKey(ModelSelectionPresetName),
  askModelSelection: Schema.optionalKey(CodexModelSelectionPatch),
  planModelSelection: Schema.optionalKey(CodexModelSelectionPatch),
  codeModelSelection: Schema.optionalKey(CodexModelSelectionPatch),
  reviewModelSelection: Schema.optionalKey(CodexModelSelectionPatch),
});

const ClaudeModelSelectionPresetUpdatePatch = Schema.Struct({
  name: Schema.optionalKey(ModelSelectionPresetName),
  askModelSelection: Schema.optionalKey(ClaudeModelSelectionPatch),
  planModelSelection: Schema.optionalKey(ClaudeModelSelectionPatch),
  codeModelSelection: Schema.optionalKey(ClaudeModelSelectionPatch),
  reviewModelSelection: Schema.optionalKey(ClaudeModelSelectionPatch),
});

export const ModelSelectionPresetPatchOperation = Schema.Union([
  Schema.Struct({
    op: Schema.Literal("create"),
    preset: ModelSelectionPreset,
  }),
  Schema.Struct({
    op: Schema.Literal("update"),
    provider: ProviderKind,
    presetId: ModelSelectionPresetId,
    patch: Schema.Union([
      CodexModelSelectionPresetUpdatePatch,
      ClaudeModelSelectionPresetUpdatePatch,
    ]),
  }),
  Schema.Struct({
    op: Schema.Literal("delete"),
    provider: ProviderKind,
    presetId: ModelSelectionPresetId,
  }),
  Schema.Struct({
    op: Schema.Literal("select"),
    provider: ProviderKind,
    presetId: Schema.NullOr(ModelSelectionPresetId),
  }),
]);
export type ModelSelectionPresetPatchOperation = typeof ModelSelectionPresetPatchOperation.Type;

const CodexSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  homePath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ClaudeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  commitMessageStyle: Schema.optionalKey(CommitMessageStyle),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  promptEnhanceModelSelection: Schema.optionalKey(ModelSelectionPatch),

  // Kodo: per-mode model selection patches (null clears the override)
  askModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelectionPatch)),
  planModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelectionPatch)),
  codeModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelectionPatch)),
  reviewModelSelection: Schema.optionalKey(Schema.NullOr(ModelSelectionPatch)),
  modelSelectionPresetOps: Schema.optionalKey(Schema.Array(ModelSelectionPresetPatchOperation)),

  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(Schema.String),
      otlpMetricsUrl: Schema.optionalKey(Schema.String),
    }),
  ),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(CodexSettingsPatch),
      claudeAgent: Schema.optionalKey(ClaudeSettingsPatch),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;
