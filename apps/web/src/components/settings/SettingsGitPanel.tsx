import { Equal } from "effect";
import {
  type UnifiedSettings,
  DEFAULT_COMMIT_MESSAGE_STYLE,
  DEFAULT_UNIFIED_SETTINGS,
} from "@t3tools/contracts/settings";

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

function SettingsGitSection({
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

  return (
    <SettingsSection title="Git">
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
    </SettingsSection>
  );
}

export function SettingsGitPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <SettingsGitSection settings={settings} updateSettings={updateSettings} />
    </SettingsPageContainer>
  );
}
