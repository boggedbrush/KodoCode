import {
  DEFAULT_SWARM_MAX_LOOPS,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./SettingsPanelPrimitives";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";

type SettingsUpdater = (patch: Partial<UnifiedSettings>) => void;
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
        title="Swarm loops"
        description="Cap swarm mode to one or two internal refinement loops. Higher values cost more."
        resetAction={
          settings.swarmMaxLoops !== DEFAULT_SWARM_MAX_LOOPS ? (
            <SettingResetButton
              label="swarm loops"
              onClick={() =>
                updateSettings({
                  swarmMaxLoops: DEFAULT_SWARM_MAX_LOOPS,
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={String(settings.swarmMaxLoops)}
            onValueChange={(value) => {
              if (value === "1" || value === "2") {
                updateSettings({ swarmMaxLoops: Number(value) as 1 | 2 });
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-44" aria-label="Swarm loop cap">
              <SelectValue>{settings.swarmMaxLoops === 2 ? "Two loops" : "One loop"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="1">
                One loop
              </SelectItem>
              <SelectItem hideIndicator value="2">
                Two loops
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
