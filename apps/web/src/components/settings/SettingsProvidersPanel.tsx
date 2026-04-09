import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { SettingsPageContainer } from "./SettingsPanelPrimitives";
import { SettingsProvidersSection } from "./SettingsProvidersSection";

export function SettingsProvidersPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <SettingsProvidersSection settings={settings} updateSettings={updateSettings} />
    </SettingsPageContainer>
  );
}
