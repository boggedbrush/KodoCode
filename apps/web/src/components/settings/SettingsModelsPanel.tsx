import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { SettingsPageContainer } from "./SettingsPanelPrimitives";
import { SettingsModelsSection } from "./SettingsModelsSection";

export function SettingsModelsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <SettingsModelsSection settings={settings} updateSettings={updateSettings} />
    </SettingsPageContainer>
  );
}
