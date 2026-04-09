import { Equal } from "effect";
import { type ModelSelection, type PromptEnhancePreset } from "@t3tools/contracts";
import { type UnifiedSettings, DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { enhancePresetLabel, ENHANCE_PRESET_LABELS } from "../../enhancePreset";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerProviders } from "../../rpc/serverState";
import {
  getCustomModelOptionsByProvider,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  ModelSelectionControl,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

type SettingsUpdater = (patch: Partial<UnifiedSettings>) => void;

function SettingsEnhanceSection({
  settings,
  updateSettings,
}: {
  settings: UnifiedSettings;
  updateSettings: SettingsUpdater;
}) {
  const serverProviders = useServerProviders();

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

  return (
    <SettingsSection title="Enhance">
      <SettingsRow
        title="Enhance prompt generation model"
        description="Configure the model used to rewrite prompts before they are sent to the coding agent."
        resetAction={
          isPromptEnhanceModelDirty ? (
            <SettingResetButton
              label="enhance prompt generation model"
              onClick={() =>
                updateSettings({
                  promptEnhanceModelSelection: DEFAULT_UNIFIED_SETTINGS.promptEnhanceModelSelection,
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
  );
}

export function SettingsEnhancePanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <SettingsEnhanceSection settings={settings} updateSettings={updateSettings} />
    </SettingsPageContainer>
  );
}
