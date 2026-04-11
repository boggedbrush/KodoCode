import { useEffect, useState } from "react";
import {
  DEFAULT_MODEL_SELECTION_PRESET_ID,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderKind,
  type UnifiedSettings,
} from "@t3tools/contracts";

import {
  getActiveModelSelectionPreset,
  getBaseModeModelSelection,
  getCustomModelOptionsByProvider,
  getModeModelSelectionSource,
  resolveProviderScopedModelSelectionState,
  resolveModeModelSelectionState,
} from "../../modelSelection";
import { ensureNativeApi } from "../../nativeApi";
import { useServerProviders } from "../../rpc/serverState";
import type { SettingsUpdatePatch } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ClaudeAI, OpenAI } from "../Icons";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  ModelSelectionControl,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";
import { SettingsModelPresetEditor } from "./SettingsModelPresetEditor";
import { MoreHorizontalIcon } from "lucide-react";

type SettingsUpdater = (patch: SettingsUpdatePatch) => void;

type PresetEditorState =
  | { kind: "create"; initialValue: string }
  | { kind: "rename"; initialValue: string }
  | { kind: "duplicate"; initialValue: string }
  | null;

type WorkflowPresetUndoState = {
  activePresetId: string | null;
  modeSelections: Record<ModeConfig["key"], ModelSelection | null>;
  provider: ProviderKind;
};

type ModeConfig = {
  description: string;
  key: "askModelSelection" | "planModelSelection" | "codeModelSelection" | "reviewModelSelection";
  mode: ProviderInteractionMode;
  title: string;
};

const DEFAULT_PRESET_VALUE = "__default__";
const MODE_CONFIGS: ReadonlyArray<ModeConfig> = [
  {
    key: "askModelSelection",
    mode: "ask",
    title: "Ask mode model",
    description: "Model and reasoning level used when in Ask mode.",
  },
  {
    key: "planModelSelection",
    mode: "plan",
    title: "Plan mode model",
    description: "Model and reasoning level used when in Plan mode.",
  },
  {
    key: "codeModelSelection",
    mode: "code",
    title: "Code mode model",
    description: "Model and reasoning level used when in Code mode.",
  },
  {
    key: "reviewModelSelection",
    mode: "review",
    title: "Review mode model",
    description: "Model and reasoning level used when in Review mode.",
  },
];
const PRESET_PROVIDER_ORDER: readonly ProviderKind[] = ["codex", "claudeAgent"];
const PRESET_PROVIDER_ICON = {
  codex: OpenAI,
  claudeAgent: ClaudeAI,
} as const;

function getPresetSelectLabel(
  activePreset: UnifiedSettings["modelSelectionPresets"][ProviderKind][string] | null,
) {
  return activePreset?.name ?? "Default";
}

function getNonDefaultActivePresetId(activePresetId: string | null) {
  return activePresetId && activePresetId !== DEFAULT_MODEL_SELECTION_PRESET_ID
    ? activePresetId
    : null;
}

function getVisibleProviderPresets(
  providerPresets: UnifiedSettings["modelSelectionPresets"][ProviderKind],
) {
  return Object.values(providerPresets).filter(
    (preset) => preset.id !== DEFAULT_MODEL_SELECTION_PRESET_ID,
  );
}

function ProviderPresetLabel({ provider }: { provider: ProviderKind }) {
  const ProviderIcon = PRESET_PROVIDER_ICON[provider];

  return (
    <span className="flex items-center gap-2">
      <ProviderIcon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          provider === "claudeAgent" ? "text-[#d97757]" : "text-muted-foreground/85",
        )}
      />
      <span>{PROVIDER_DISPLAY_NAMES[provider]}</span>
    </span>
  );
}

function WorkflowPresetSelectorLabel({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground/82">{label}</span>
      <span className="min-w-0 truncate text-foreground">{value}</span>
    </span>
  );
}

function WorkflowPresetControlRow({
  presetProvider,
  activePreset,
  effectivePresetId,
  visibleProviderPresets,
  setPresetProvider,
  applyWorkflowPresetContextChange,
  setPresetEditorState,
  removeActivePreset,
}: {
  presetProvider: ProviderKind;
  activePreset: UnifiedSettings["modelSelectionPresets"][ProviderKind][string] | null;
  effectivePresetId: string | null;
  visibleProviderPresets: ReadonlyArray<
    UnifiedSettings["modelSelectionPresets"][ProviderKind][string]
  >;
  setPresetProvider: (provider: ProviderKind) => void;
  applyWorkflowPresetContextChange: (patch: SettingsUpdatePatch) => void;
  setPresetEditorState: (state: PresetEditorState) => void;
  removeActivePreset: () => Promise<void>;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-1.5">
      <>
        <Select
          value={presetProvider}
          onValueChange={(value) => setPresetProvider(value as ProviderKind)}
        >
          <SelectTrigger className="w-full min-w-0 sm:w-40" aria-label="Preset provider family">
            <ProviderPresetLabel provider={presetProvider} />
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {PRESET_PROVIDER_ORDER.map((provider) => (
              <SelectItem hideIndicator key={provider} value={provider}>
                <ProviderPresetLabel provider={provider} />
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <Select
          value={effectivePresetId ?? DEFAULT_PRESET_VALUE}
          onValueChange={(value) =>
            applyWorkflowPresetContextChange({
              modelSelectionPresetOps: [
                {
                  op: "select",
                  provider: presetProvider,
                  presetId: value === DEFAULT_PRESET_VALUE ? null : value,
                },
              ],
            })
          }
        >
          <SelectTrigger className="w-full min-w-0 sm:w-36" aria-label="Model preset">
            <WorkflowPresetSelectorLabel
              label="Preset:"
              value={getPresetSelectLabel(activePreset)}
            />
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={DEFAULT_PRESET_VALUE}>
              Default
            </SelectItem>
            {visibleProviderPresets.map((preset) => (
              <SelectItem hideIndicator key={preset.id} value={preset.id}>
                {preset.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </>

      <>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setPresetEditorState({
              kind: "create",
              initialValue: `${PROVIDER_DISPLAY_NAMES[presetProvider]} preset`,
            })
          }
        >
          + New
        </Button>

        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label="Preset actions"
                size="icon-xs"
                variant="outline"
                disabled={!activePreset}
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              disabled={!activePreset}
              onClick={() =>
                setPresetEditorState(
                  activePreset
                    ? {
                        kind: "rename",
                        initialValue: activePreset.name,
                      }
                    : null,
                )
              }
            >
              Rename
            </MenuItem>
            <MenuItem
              disabled={!activePreset}
              onClick={() =>
                setPresetEditorState(
                  activePreset
                    ? {
                        kind: "duplicate",
                        initialValue: `${activePreset.name} copy`,
                      }
                    : null,
                )
              }
            >
              Duplicate
            </MenuItem>
            <MenuItem
              disabled={!activePreset}
              variant="destructive"
              onClick={() => void removeActivePreset()}
            >
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </>
    </div>
  );
}

function getInitialPresetProvider(settings: UnifiedSettings): ProviderKind {
  const activePreset = getActiveModelSelectionPreset(settings);
  if (activePreset) {
    return activePreset.provider;
  }

  for (const modeConfig of MODE_CONFIGS) {
    const selection = getBaseModeModelSelection(modeConfig.mode, settings);
    if (selection) {
      return selection.provider;
    }
  }

  return "codex";
}

function makePresetId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = crypto.randomUUID().slice(0, 8);
  return `${slug || "preset"}-${suffix}`;
}

function getSelectionForProvider(
  selection: ModelSelection | null,
  provider: ProviderKind,
): ModelSelection | null {
  return selection?.provider === provider ? selection : null;
}

function areModelSelectionsEqual(a: ModelSelection | null, b: ModelSelection | null) {
  if (a === b) {
    return true;
  }

  if (a === null || b === null) {
    return false;
  }

  return JSON.stringify(a) === JSON.stringify(b);
}

function getProviderBaseSelections(
  settings: UnifiedSettings,
  provider: ProviderKind,
): WorkflowPresetUndoState["modeSelections"] {
  return Object.fromEntries(
    MODE_CONFIGS.map((modeConfig) => [
      modeConfig.key,
      getSelectionForProvider(getBaseModeModelSelection(modeConfig.mode, settings), provider),
    ]),
  ) as WorkflowPresetUndoState["modeSelections"];
}

export function getWorkflowPresetUndoState(
  settings: UnifiedSettings,
  provider: ProviderKind,
): WorkflowPresetUndoState {
  const activePresetId = getNonDefaultActivePresetId(
    settings.activeModelSelectionPresetByProvider[provider],
  );
  const activePreset =
    activePresetId !== null
      ? (settings.modelSelectionPresets[provider][activePresetId] ?? null)
      : null;

  return {
    provider,
    activePresetId: activePreset?.id ?? null,
    modeSelections:
      activePreset !== null
        ? {
            askModelSelection: activePreset.askModelSelection,
            planModelSelection: activePreset.planModelSelection,
            codeModelSelection: activePreset.codeModelSelection,
            reviewModelSelection: activePreset.reviewModelSelection,
          }
        : getProviderBaseSelections(settings, provider),
  };
}

export function isWorkflowPresetUndoDirty(
  settings: UnifiedSettings,
  undoState: WorkflowPresetUndoState | null | undefined,
) {
  if (!undoState) {
    return false;
  }

  const currentState = getWorkflowPresetUndoState(settings, undoState.provider);
  if (currentState.activePresetId !== undoState.activePresetId) {
    return false;
  }

  return MODE_CONFIGS.some(
    (modeConfig) =>
      !areModelSelectionsEqual(
        currentState.modeSelections[modeConfig.key],
        undoState.modeSelections[modeConfig.key],
      ),
  );
}

export function getWorkflowPresetUndoPatch(
  settings: UnifiedSettings,
  undoState: WorkflowPresetUndoState,
): SettingsUpdatePatch {
  const currentState = getWorkflowPresetUndoState(settings, undoState.provider);
  if (currentState.activePresetId !== undoState.activePresetId) {
    return {};
  }

  const patch: Record<string, unknown> = {};

  if (undoState.activePresetId !== null) {
    const presetPatch = Object.fromEntries(
      MODE_CONFIGS.flatMap((modeConfig) =>
        areModelSelectionsEqual(
          currentState.modeSelections[modeConfig.key],
          undoState.modeSelections[modeConfig.key],
        )
          ? []
          : [[modeConfig.key, undoState.modeSelections[modeConfig.key]]],
      ),
    );

    if (Object.keys(presetPatch).length > 0) {
      patch.modelSelectionPresetOps = [
        {
          op: "update",
          provider: undoState.provider,
          presetId: undoState.activePresetId,
          patch: presetPatch,
        },
      ];
    }

    return patch as SettingsUpdatePatch;
  }

  for (const modeConfig of MODE_CONFIGS) {
    const key = modeConfig.key;
    if (areModelSelectionsEqual(currentState.modeSelections[key], undoState.modeSelections[key])) {
      continue;
    }

    patch[key] = undoState.modeSelections[key];
  }

  return patch as SettingsUpdatePatch;
}

export function SettingsModelsSection({
  settings,
  updateSettings,
}: {
  settings: UnifiedSettings;
  updateSettings: SettingsUpdater;
}) {
  const serverProviders = useServerProviders();
  const [presetProvider, setPresetProvider] = useState<ProviderKind>(() =>
    getInitialPresetProvider(settings),
  );
  const [presetEditorState, setPresetEditorState] = useState<PresetEditorState>(null);
  const [workflowPresetUndoByProvider, setWorkflowPresetUndoByProvider] = useState<
    Partial<Record<ProviderKind, WorkflowPresetUndoState>>
  >({});

  useEffect(() => {
    const providerPresets = settings.modelSelectionPresets[presetProvider];
    const hasVisiblePresets = getVisibleProviderPresets(providerPresets).length > 0;
    const activePreset = getActiveModelSelectionPreset(settings, presetProvider);
    if (hasVisiblePresets || activePreset?.provider === presetProvider) {
      return;
    }

    setPresetProvider(getInitialPresetProvider(settings));
  }, [presetProvider, settings]);

  const providerPresets = settings.modelSelectionPresets[presetProvider];
  const activePresetId = settings.activeModelSelectionPresetByProvider[presetProvider];
  const visibleProviderPresets = getVisibleProviderPresets(providerPresets);
  const effectivePresetId = getNonDefaultActivePresetId(activePresetId);
  const activePreset =
    effectivePresetId !== null ? (providerPresets[effectivePresetId] ?? null) : null;
  const workflowPresetUndoState = workflowPresetUndoByProvider[presetProvider] ?? null;
  const isWorkflowPresetDirty = isWorkflowPresetUndoDirty(settings, workflowPresetUndoState);

  const applyWorkflowPresetContextChange = (patch: SettingsUpdatePatch) => {
    setWorkflowPresetUndoByProvider((current) => ({
      ...current,
      [presetProvider]: undefined,
    }));
    updateSettings(patch);
  };

  const applyWorkflowPresetModeChange = (patch: SettingsUpdatePatch) => {
    setWorkflowPresetUndoByProvider((current) => ({
      ...current,
      [presetProvider]:
        current[presetProvider] ?? getWorkflowPresetUndoState(settings, presetProvider),
    }));
    updateSettings(patch);
  };

  const createPreset = (name: string) => {
    const presetId = makePresetId(name);

    const modeSelections = Object.fromEntries(
      MODE_CONFIGS.map((modeConfig) => {
        const currentSelection = getModeModelSelectionSource(
          modeConfig.mode,
          settings,
          presetProvider,
        );
        const providerSelection = getSelectionForProvider(currentSelection, presetProvider) ?? {
          provider: presetProvider,
          model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[presetProvider],
        };

        return [
          modeConfig.key,
          resolveProviderScopedModelSelectionState(
            presetProvider,
            providerSelection,
            settings,
            serverProviders,
          ),
        ];
      }),
    ) as Record<ModeConfig["key"], ModelSelection>;

    applyWorkflowPresetContextChange({
      modelSelectionPresetOps: [
        {
          op: "create",
          preset: {
            id: presetId,
            provider: presetProvider,
            name,
            ...modeSelections,
          } as Extract<
            UnifiedSettings["modelSelectionPresets"][ProviderKind][string],
            { provider: typeof presetProvider }
          >,
        },
        {
          op: "select",
          provider: presetProvider,
          presetId,
        },
      ],
    });
  };

  const duplicatePreset = (name: string) => {
    if (!activePreset) {
      return;
    }

    const presetId = makePresetId(name);
    applyWorkflowPresetContextChange({
      modelSelectionPresetOps: [
        {
          op: "create",
          preset: {
            ...activePreset,
            id: presetId,
            name,
          },
        },
        {
          op: "select",
          provider: presetProvider,
          presetId,
        },
      ],
    });
  };

  const submitPresetEditor = (name: string) => {
    if (!presetEditorState) {
      return;
    }

    if (presetEditorState.kind === "create") {
      createPreset(name);
      return;
    }

    if (presetEditorState.kind === "duplicate") {
      duplicatePreset(name);
      return;
    }

    if (activePreset) {
      applyWorkflowPresetContextChange({
        modelSelectionPresetOps: [
          {
            op: "update",
            provider: presetProvider,
            presetId: activePreset.id,
            patch: {
              name,
            },
          },
        ],
      });
    }
  };

  const removeActivePreset = async () => {
    if (!activePreset) {
      return;
    }

    const confirmed = await ensureNativeApi().dialogs.confirm(
      `Delete preset "${activePreset.name}"? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    applyWorkflowPresetContextChange({
      modelSelectionPresetOps: [
        {
          op: "delete",
          provider: presetProvider,
          presetId: activePreset.id,
        },
      ],
    });
  };

  const updateModeSelection = (modeConfig: ModeConfig, rawSelection: ModelSelection) => {
    const normalizedSelection = resolveModeModelSelectionState(
      rawSelection,
      settings,
      serverProviders,
    );
    const normalizedPresetSelection = resolveProviderScopedModelSelectionState(
      presetProvider,
      rawSelection,
      settings,
      serverProviders,
    );

    if (activePreset) {
      applyWorkflowPresetModeChange({
        modelSelectionPresetOps: [
          {
            op: "update",
            provider: presetProvider,
            presetId: activePreset.id,
            patch: {
              [modeConfig.key]: normalizedPresetSelection,
            },
          },
        ],
      });
      return;
    }

    applyWorkflowPresetModeChange({
      [modeConfig.key]: normalizedSelection,
    });
  };

  return (
    <SettingsSection title="Models">
      <div className="border-t border-border px-4 py-4 first:border-t-0 sm:px-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] xl:items-center xl:gap-6">
          <div className="min-w-0 space-y-1">
            <div className="flex min-h-5 items-center gap-1.5">
              <h3 className="text-sm font-medium text-foreground">Workflow presets</h3>
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {isWorkflowPresetDirty && workflowPresetUndoState ? (
                  <SettingResetButton
                    label="workflow preset"
                    tooltipText="Undo preset changes"
                    onClick={() => {
                      updateSettings(getWorkflowPresetUndoPatch(settings, workflowPresetUndoState));
                      setWorkflowPresetUndoByProvider((current) => ({
                        ...current,
                        [presetProvider]: undefined,
                      }));
                    }}
                  />
                ) : null}
              </span>
            </div>
            <p className="max-w-prose text-xs leading-5 text-muted-foreground">
              Save provider-specific model bundles for Ask, Plan, Code, and Review. Default uses the
              current model and effort settings when no preset is active.
            </p>
          </div>

          <div className="min-w-0">
            <WorkflowPresetControlRow
              presetProvider={presetProvider}
              activePreset={activePreset}
              effectivePresetId={effectivePresetId}
              visibleProviderPresets={visibleProviderPresets}
              setPresetProvider={setPresetProvider}
              applyWorkflowPresetContextChange={applyWorkflowPresetContextChange}
              setPresetEditorState={setPresetEditorState}
              removeActivePreset={removeActivePreset}
            />
          </div>
        </div>
      </div>

      {MODE_CONFIGS.map((modeConfig) => {
        const selectedSelection = getModeModelSelectionSource(
          modeConfig.mode,
          settings,
          presetProvider,
        );
        const baseSelection = getBaseModeModelSelection(modeConfig.mode, settings);
        const providerBaseSelection = getSelectionForProvider(baseSelection, presetProvider);
        const provider = activePreset?.provider ?? selectedSelection?.provider ?? presetProvider;
        const model = selectedSelection?.model ?? "";
        const modelOptions = selectedSelection?.options;
        const modelOptionsByProvider = getCustomModelOptionsByProvider(
          settings,
          serverProviders,
          provider,
          model || undefined,
        );
        const models =
          serverProviders.find((candidate) => candidate.provider === provider)?.models ?? [];
        const isBaseSelectionDirty = providerBaseSelection !== null;

        return (
          <SettingsRow
            key={modeConfig.key}
            title={modeConfig.title}
            description={
              activePreset
                ? `${modeConfig.description} Changes update the active preset.`
                : `${modeConfig.description} Leave unset to use the default model.`
            }
            resetAction={
              !activePreset && isBaseSelectionDirty ? (
                <SettingResetButton
                  label={modeConfig.title.toLowerCase()}
                  onClick={() => updateSettings({ [modeConfig.key]: null })}
                />
              ) : null
            }
            control={
              <ModelSelectionControl
                provider={provider}
                lockedProvider={activePreset?.provider ?? null}
                model={model}
                modelOptions={modelOptions}
                models={models}
                modelOptionsByProvider={modelOptionsByProvider}
                providers={serverProviders}
                fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider]}
                onProviderModelChange={(nextProvider, nextModel) =>
                  updateModeSelection(modeConfig, {
                    provider: nextProvider,
                    model: nextModel,
                  })
                }
                onModelOptionsChange={(nextOptions) =>
                  updateModeSelection(modeConfig, {
                    provider,
                    model: model || DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[provider],
                    ...(nextOptions ? { options: nextOptions } : {}),
                  })
                }
              />
            }
          />
        );
      })}

      <SettingsModelPresetEditor
        open={presetEditorState !== null}
        title={
          presetEditorState?.kind === "rename"
            ? "Rename preset"
            : presetEditorState?.kind === "duplicate"
              ? "Duplicate preset"
              : "Create preset"
        }
        description={
          presetEditorState?.kind === "rename"
            ? "Update the active preset name."
            : presetEditorState?.kind === "duplicate"
              ? "Create a copy of the active preset."
              : `Snapshot the current ${PROVIDER_DISPLAY_NAMES[presetProvider]} model selections into a named preset.`
        }
        confirmLabel={
          presetEditorState?.kind === "rename"
            ? "Save"
            : presetEditorState?.kind === "duplicate"
              ? "Duplicate"
              : "Create"
        }
        initialValue={presetEditorState?.initialValue ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            setPresetEditorState(null);
          }
        }}
        onSubmit={submitPresetEditor}
      />
    </SettingsSection>
  );
}
