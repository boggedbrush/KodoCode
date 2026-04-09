import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
  type PromptEnhancePreset,
} from "@t3tools/contracts";
import {
  DEFAULT_COMMIT_MESSAGE_STYLE,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { Equal } from "effect";

import { enhancePresetLabel, ENHANCE_PRESET_LABELS } from "../../enhancePreset";
import { useServerProviders } from "../../rpc/serverState";
import {
  getCustomModelOptionsByProvider,
  resolveAppModelSelectionState,
  resolveModeModelSelectionState,
} from "../../modelSelection";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  ModelSelectionControl,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

type SettingsUpdater = (patch: Partial<UnifiedSettings>) => void;

export function SettingsModelsSection({
  settings,
  updateSettings,
}: {
  settings: UnifiedSettings;
  updateSettings: SettingsUpdater;
}) {
  const serverProviders = useServerProviders();

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenProvider = textGenerationModelSelection.provider;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const gitModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    textGenProvider,
    textGenModel,
  );
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  const promptEnhanceModelSelection = resolveAppModelSelectionState(
    settings,
    serverProviders,
    settings.promptEnhanceModelSelection,
  );
  const promptEnhanceProvider = promptEnhanceModelSelection.provider;
  const promptEnhanceModel = promptEnhanceModelSelection.model;
  const promptEnhanceModelOptions = promptEnhanceModelSelection.options;
  const promptEnhanceModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    promptEnhanceProvider,
    promptEnhanceModel,
  );
  const isPromptEnhanceModelDirty = !Equal.equals(
    settings.promptEnhanceModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.promptEnhanceModelSelection ?? null,
  );

  const askSelection = settings.askModelSelection;
  const askProvider = askSelection?.provider ?? "codex";
  const askModel = askSelection?.model ?? "";
  const askModelOptions = askSelection?.options;
  const askModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    askProvider,
    askModel || undefined,
  );
  const isAskModelDirty = askSelection !== null && askSelection !== undefined;

  const planSelection = settings.planModelSelection;
  const planProvider = planSelection?.provider ?? "codex";
  const planModel = planSelection?.model ?? "";
  const planModelOptions = planSelection?.options;
  const planModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    planProvider,
    planModel || undefined,
  );
  const isPlanModelDirty = planSelection !== null && planSelection !== undefined;

  const codeSelection = settings.codeModelSelection;
  const codeProvider = codeSelection?.provider ?? "codex";
  const codeModel = codeSelection?.model ?? "";
  const codeModelOptions = codeSelection?.options;
  const codeModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    codeProvider,
    codeModel || undefined,
  );
  const isCodeModelDirty = codeSelection !== null && codeSelection !== undefined;

  const reviewSelection = settings.reviewModelSelection;
  const reviewProvider = reviewSelection?.provider ?? "codex";
  const reviewModel = reviewSelection?.model ?? "";
  const reviewModelOptions = reviewSelection?.options;
  const reviewModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    reviewProvider,
    reviewModel || undefined,
  );
  const isReviewModelDirty = reviewSelection !== null && reviewSelection !== undefined;

  return (
    <>
      <SettingsSection title="Models">
        <SettingsRow
          title="Commit generation model"
          description="Configure the model used for generated commit messages, PR titles, and similar Git text."
          resetAction={
            isGitWritingModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <ModelSelectionControl
              provider={textGenProvider}
              model={textGenModel}
              models={
                serverProviders.find((provider) => provider.provider === textGenProvider)?.models ??
                []
              }
              modelOptions={textGenModelOptions}
              modelOptionsByProvider={gitModelOptionsByProvider}
              providers={serverProviders}
              onProviderModelChange={(provider, model) => {
                updateSettings({
                  textGenerationModelSelection: resolveAppModelSelectionState(
                    settings,
                    serverProviders,
                    { provider, model },
                  ),
                });
              }}
              onModelOptionsChange={(nextOptions) => {
                updateSettings({
                  textGenerationModelSelection: resolveAppModelSelectionState(
                    settings,
                    serverProviders,
                    {
                      provider: textGenProvider,
                      model: textGenModel,
                      ...(nextOptions ? { options: nextOptions } : {}),
                    },
                  ),
                });
              }}
            />
          }
        />

        <SettingsRow
          title="Commit message style"
          description="Choose the format used for generated commit message subjects."
          resetAction={
            settings.commitMessageStyle !== DEFAULT_COMMIT_MESSAGE_STYLE ? (
              <SettingResetButton
                label="commit message style"
                onClick={() => updateSettings({ commitMessageStyle: DEFAULT_COMMIT_MESSAGE_STYLE })}
              />
            ) : null
          }
          control={
            <Select
              value={settings.commitMessageStyle}
              onValueChange={(value) => {
                if (
                  value === "summary" ||
                  value === "type-summary" ||
                  value === "type-scope-summary"
                ) {
                  updateSettings({ commitMessageStyle: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-56" aria-label="Commit message style">
                <SelectValue>
                  {settings.commitMessageStyle === "summary"
                    ? "Summary"
                    : settings.commitMessageStyle === "type-summary"
                      ? "type: summary"
                      : "type(scope): summary"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="summary">
                  Summary
                </SelectItem>
                <SelectItem hideIndicator value="type-summary">
                  type: summary
                </SelectItem>
                <SelectItem hideIndicator value="type-scope-summary">
                  type(scope): summary
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          title="Enhance prompt generation model"
          description="Configure the model used to rewrite prompts before they are sent to the coding agent."
          resetAction={
            isPromptEnhanceModelDirty ? (
              <SettingResetButton
                label="enhance prompt generation model"
                onClick={() =>
                  updateSettings({
                    promptEnhanceModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.promptEnhanceModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <ModelSelectionControl
              provider={promptEnhanceProvider}
              model={promptEnhanceModel}
              models={
                serverProviders.find((provider) => provider.provider === promptEnhanceProvider)
                  ?.models ?? []
              }
              modelOptions={promptEnhanceModelOptions}
              modelOptionsByProvider={promptEnhanceModelOptionsByProvider}
              providers={serverProviders}
              onProviderModelChange={(provider, model) => {
                updateSettings({ promptEnhanceModelSelection: { provider, model } });
              }}
              onModelOptionsChange={(nextOptions) => {
                const selection: ModelSelection = {
                  provider: promptEnhanceProvider,
                  model: promptEnhanceModel,
                  ...(nextOptions ? { options: nextOptions } : {}),
                };
                updateSettings({ promptEnhanceModelSelection: selection });
              }}
            />
          }
        />

        <SettingsRow
          title="Enhance style"
          description="Default preset used by the composer Enhance button."
          resetAction={
            settings.promptEnhancePreset !== DEFAULT_UNIFIED_SETTINGS.promptEnhancePreset ? (
              <SettingResetButton
                label="enhance style"
                onClick={() =>
                  updateSettings({
                    promptEnhancePreset: DEFAULT_UNIFIED_SETTINGS.promptEnhancePreset,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.promptEnhancePreset}
              onValueChange={(value) => {
                if (value === "minimal" || value === "balanced" || value === "vibe") {
                  updateSettings({ promptEnhancePreset: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Enhance style">
                <SelectValue>{enhancePresetLabel(settings.promptEnhancePreset)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {(Object.keys(ENHANCE_PRESET_LABELS) as PromptEnhancePreset[]).map((preset) => (
                  <SelectItem hideIndicator key={preset} value={preset}>
                    {ENHANCE_PRESET_LABELS[preset]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Mode models">
        <SettingsRow
          title="Ask mode model"
          description="Model and reasoning level used when in Ask mode. Leave unset to use the default model."
          resetAction={
            isAskModelDirty ? (
              <SettingResetButton
                label="ask model"
                onClick={() => updateSettings({ askModelSelection: null })}
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={askProvider}
                model={askModel}
                lockedProvider={null}
                providers={serverProviders}
                modelOptionsByProvider={askModelOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    askModelSelection: resolveModeModelSelectionState(
                      { provider, model },
                      settings,
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={askProvider}
                models={serverProviders.find((p) => p.provider === askProvider)?.models ?? []}
                model={askModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={askModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[askProvider]}
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    askModelSelection: resolveModeModelSelectionState(
                      {
                        provider: askProvider,
                        model: askModel || "gpt-5.4",
                        ...(nextOptions ? { options: nextOptions } : {}),
                      },
                      settings,
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />

        <SettingsRow
          title="Plan mode model"
          description="Model and reasoning level used when in Plan mode. Leave unset to use the default model."
          resetAction={
            isPlanModelDirty ? (
              <SettingResetButton
                label="plan model"
                onClick={() => updateSettings({ planModelSelection: null })}
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={planProvider}
                model={planModel}
                lockedProvider={null}
                providers={serverProviders}
                modelOptionsByProvider={planModelOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    planModelSelection: resolveModeModelSelectionState(
                      { provider, model },
                      settings,
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={planProvider}
                models={serverProviders.find((p) => p.provider === planProvider)?.models ?? []}
                model={planModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={planModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[planProvider]}
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    planModelSelection: resolveModeModelSelectionState(
                      {
                        provider: planProvider,
                        model: planModel || "gpt-5.4",
                        ...(nextOptions ? { options: nextOptions } : {}),
                      },
                      settings,
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />

        <SettingsRow
          title="Code mode model"
          description="Model and reasoning level used when in Code mode. Leave unset to use the default model."
          resetAction={
            isCodeModelDirty ? (
              <SettingResetButton
                label="code model"
                onClick={() => updateSettings({ codeModelSelection: null })}
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={codeProvider}
                model={codeModel}
                lockedProvider={null}
                providers={serverProviders}
                modelOptionsByProvider={codeModelOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    codeModelSelection: resolveModeModelSelectionState(
                      { provider, model },
                      settings,
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={codeProvider}
                models={serverProviders.find((p) => p.provider === codeProvider)?.models ?? []}
                model={codeModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={codeModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[codeProvider]}
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    codeModelSelection: resolveModeModelSelectionState(
                      {
                        provider: codeProvider,
                        model: codeModel || "gpt-5.4",
                        ...(nextOptions ? { options: nextOptions } : {}),
                      },
                      settings,
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />

        <SettingsRow
          title="Review mode model"
          description="Model and reasoning level used when in Review mode. Leave unset to use the default model."
          resetAction={
            isReviewModelDirty ? (
              <SettingResetButton
                label="review model"
                onClick={() => updateSettings({ reviewModelSelection: null })}
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                provider={reviewProvider}
                model={reviewModel}
                lockedProvider={null}
                providers={serverProviders}
                modelOptionsByProvider={reviewModelOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onProviderModelChange={(provider, model) => {
                  updateSettings({
                    reviewModelSelection: resolveModeModelSelectionState(
                      { provider, model },
                      settings,
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={reviewProvider}
                models={serverProviders.find((p) => p.provider === reviewProvider)?.models ?? []}
                model={reviewModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={reviewModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                fallbackModel={DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[reviewProvider]}
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    reviewModelSelection: resolveModeModelSelectionState(
                      {
                        provider: reviewProvider,
                        model: reviewModel || "gpt-5.4",
                        ...(nextOptions ? { options: nextOptions } : {}),
                      },
                      settings,
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
      </SettingsSection>
    </>
  );
}
