import { useMemo } from "react";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { Equal } from "effect";
import { resolveUtilityModelSelectionDefault } from "@t3tools/shared/model";

import { useTheme } from "../../hooks/useTheme";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerProviders } from "../../rpc/serverState";
import { ensureNativeApi, readNativeApi } from "../../nativeApi";
import { PROVIDER_SETTINGS } from "./settingsProviderConfig";

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
      ...(settings.chatFontFamily !== DEFAULT_UNIFIED_SETTINGS.chatFontFamily
        ? ["Chat typography"]
        : []),
      ...(settings.chatTextSize !== DEFAULT_UNIFIED_SETTINGS.chatTextSize
        ? ["Chat text size"]
        : []),
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
      settings.chatFontFamily,
      settings.chatTextSize,
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
