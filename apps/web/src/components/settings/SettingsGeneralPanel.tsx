import { useMemo } from "react";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { Equal } from "effect";
import { resolveUtilityModelSelectionDefault } from "@t3tools/shared/model";

import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerProviders } from "../../rpc/serverState";
import { ensureNativeApi, readNativeApi } from "../../nativeApi";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { PROVIDER_SETTINGS } from "./settingsProviderConfig";

type SettingsUpdater = (patch: Partial<UnifiedSettings>) => void;

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { resetSettings } = useUpdateSettings();
  const serverProviders = useServerProviders();
  const defaultTextGenerationModelSelection = resolveUtilityModelSelectionDefault(
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
    serverProviders,
  );
  const defaultPromptEnhanceModelSelection = resolveUtilityModelSelectionDefault(
    DEFAULT_UNIFIED_SETTINGS.promptEnhanceModelSelection,
    serverProviders,
  );

  const isGitWritingModelDirty = !Equal.equals(
    resolveUtilityModelSelectionDefault(settings.textGenerationModelSelection, serverProviders),
    defaultTextGenerationModelSelection,
  );
  const isPromptEnhanceModelDirty = !Equal.equals(
    resolveUtilityModelSelectionDefault(settings.promptEnhanceModelSelection, serverProviders),
    defaultPromptEnhanceModelSelection,
  );
  const areProviderSettingsDirty = PROVIDER_SETTINGS.some((providerSettings) => {
    const currentSettings = settings.providers[providerSettings.provider];
    const defaultSettings = DEFAULT_UNIFIED_SETTINGS.providers[providerSettings.provider];
    return !Equal.equals(currentSettings, defaultSettings);
  });

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(settings.projectPickerMode !== DEFAULT_UNIFIED_SETTINGS.projectPickerMode
        ? ["Project picker"]
        : []),
      ...(settings.favorites.length > 0 ? ["Favorite models"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
        ? ["Diff line wrapping"]
        : []),
      ...(settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
        ? ["Assistant output"]
        : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(settings.commitMessageStyle !== DEFAULT_UNIFIED_SETTINGS.commitMessageStyle
        ? ["Commit message style"]
        : []),
      ...(settings.promptEnhancePreset !== DEFAULT_UNIFIED_SETTINGS.promptEnhancePreset
        ? ["Enhance style"]
        : []),
      ...(isPromptEnhanceModelDirty ? ["Enhance model"] : []),
      ...(isGitWritingModelDirty ? ["Git writing model"] : []),
      ...(settings.askModelSelection !== null ? ["Ask mode model"] : []),
      ...(settings.planModelSelection !== null ? ["Plan mode model"] : []),
      ...(settings.codeModelSelection !== null ? ["Code mode model"] : []),
      ...(settings.reviewModelSelection !== null ? ["Review mode model"] : []),
      ...(areProviderSettingsDirty ? ["Providers"] : []),
    ],
    [
      areProviderSettingsDirty,
      isGitWritingModelDirty,
      isPromptEnhanceModelDirty,
      settings.askModelSelection,
      settings.codeModelSelection,
      settings.commitMessageStyle,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.defaultThreadEnvMode,
      settings.diffWordWrap,
      settings.enableAssistantStreaming,
      settings.favorites.length,
      settings.planModelSelection,
      settings.projectPickerMode,
      settings.promptEnhancePreset,
      settings.reviewModelSelection,
      settings.timestampFormat,
      theme,
    ],
  );

  const restoreDefaults = async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readNativeApi();
    const confirmed = await (api ?? ensureNativeApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetSettings();
    onRestored?.();
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

function GeneralBehaviorSection({
  settings,
  updateSettings,
}: {
  settings: UnifiedSettings;
  updateSettings: SettingsUpdater;
}) {
  return (
    <SettingsSection title="General">
      <SettingsRow
        title="Assistant output"
        description="Show token-by-token output while a response is in progress."
        resetAction={
          settings.enableAssistantStreaming !==
          DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
            <SettingResetButton
              label="assistant output"
              onClick={() =>
                updateSettings({
                  enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.enableAssistantStreaming}
            onCheckedChange={(checked) =>
              updateSettings({ enableAssistantStreaming: Boolean(checked) })
            }
            aria-label="Stream assistant messages"
          />
        }
      />

      <SettingsRow
        title="New threads"
        description="Pick the default workspace mode for newly created draft threads."
        resetAction={
          settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
            <SettingResetButton
              label="new threads"
              onClick={() =>
                updateSettings({
                  defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={settings.defaultThreadEnvMode}
            onValueChange={(value) => {
              if (value === "local" || value === "worktree") {
                updateSettings({ defaultThreadEnvMode: value });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
              <SelectValue>
                {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="local">
                Local
              </SelectItem>
              <SelectItem hideIndicator value="worktree">
                New worktree
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />

      <SettingsRow
        title="Archive confirmation"
        description="Require a second click on the inline archive action before a thread is archived."
        resetAction={
          settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
            <SettingResetButton
              label="archive confirmation"
              onClick={() =>
                updateSettings({
                  confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.confirmThreadArchive}
            onCheckedChange={(checked) =>
              updateSettings({ confirmThreadArchive: Boolean(checked) })
            }
            aria-label="Confirm thread archiving"
          />
        }
      />

      <SettingsRow
        title="Delete confirmation"
        description="Ask before deleting a thread and its chat history."
        resetAction={
          settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
            <SettingResetButton
              label="delete confirmation"
              onClick={() =>
                updateSettings({
                  confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.confirmThreadDelete}
            onCheckedChange={(checked) => updateSettings({ confirmThreadDelete: Boolean(checked) })}
            aria-label="Confirm thread deletion"
          />
        }
      />
    </SettingsSection>
  );
}

export function GeneralSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <GeneralBehaviorSection settings={settings} updateSettings={updateSettings} />
    </SettingsPageContainer>
  );
}
