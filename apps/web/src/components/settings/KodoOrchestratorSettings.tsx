import { Switch } from "../ui/switch";
import { KodoModeModelsSettings } from "./KodoModeModelsSettings";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/**
 * The Orchestrator: one conversation across all projects, pinned at the top of the thread list. It is
 * read-only and starts work only in a project the person names. Its model is the Lead / Orchestrator
 * slot, so the row here and the one under Models by mode are the same setting.
 */
export function KodoOrchestratorSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["kodoOrchestratorEnabled"]);
  return (
    <SettingsSection {...searchableSetting("orchestrator")}>
      <SettingsRow
        serverScoped
        settingKeys={["kodoOrchestratorEnabled"]}
        mixed={mixed}
        title="Show the Orchestrator"
        description="One conversation across all your projects. It can read status anywhere and starts work only in a project you name, after telling you what it will ask for. It never edits files itself."
        resetAction={
          settings.kodoOrchestratorEnabled ? null : (
            <SettingResetButton
              label="Orchestrator"
              tooltip="Show the Orchestrator"
              onClick={() => updateSettings({ kodoOrchestratorEnabled: true })}
            />
          )
        }
        control={
          <Switch
            aria-label="Show the Orchestrator"
            mixed={mixed}
            checked={mixed ? false : settings.kodoOrchestratorEnabled}
            onCheckedChange={(enabled) => updateSettings({ kodoOrchestratorEnabled: enabled })}
          />
        }
      />
      <KodoModeModelsSettings only="orchestrator" />
    </SettingsSection>
  );
}
