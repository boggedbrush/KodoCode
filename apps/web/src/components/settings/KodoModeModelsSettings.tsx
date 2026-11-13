import type { KodoModeModelSlot, ModelSelection } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { toastManager } from "../ui/toast";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const MODE_SLOTS: ReadonlyArray<{
  readonly slot: KodoModeModelSlot;
  readonly title: string;
  readonly description: string;
}> = [
  { slot: "ask", title: "Ask", description: "Questions about the code, without changes." },
  { slot: "plan", title: "Plan", description: "Planning before any edits." },
  { slot: "code", title: "Code", description: "Writing the changes." },
  { slot: "review", title: "Review", description: "Reviewing the changes." },
];

const ROLE_SLOTS: ReadonlyArray<{
  readonly slot: KodoModeModelSlot;
  readonly title: string;
  readonly description: string;
}> = [
  {
    slot: "orchestrator",
    title: "Lead / Orchestrator",
    description:
      "The model a thread runs on while Sub-agents is on: it plans, delegates and verifies, and its workers use the Code and Review models. Follows the thread's own model until set.",
  },
  {
    slot: "judge",
    title: "Judge",
    description:
      "Decides, at the end of each /loop round, whether the work is complete and what is outstanding. Follows the Review model until set. It is also the reference for the loop's savings estimate.",
  },
];

/** One model per mode, plus the Orchestrator and Judge roles; unset slots use the thread's model. */
export function KodoModeModelsSettings() {
  const { target, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const mixed = useScopedSettingsMixed(["modeModelSelections"]);
  const representative = target
    ? environments.find((environment) => environment.environmentId === target.environmentId)
    : undefined;
  const providers =
    (representative?.serverConfig
      ? providersByEnvironment.get(representative.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, null);
  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);
  const unavailable = connectedEnvironments.length === 0;
  const fallbackSelection: ModelSelection | null = entries[0]
    ? createModelSelection(
        entries[0].instanceId,
        entries[0].models.find((model) => model.isDefault)?.slug ??
          entries[0].models[0]?.slug ??
          "",
      )
    : null;

  const setSlot = (slot: KodoModeModelSlot, value: ModelSelection | null) => {
    const reason = value ? modelDisabledReason(value.instanceId, value.model) : null;
    if (reason) {
      toastManager.add({ type: "error", title: "Model not saved", description: reason });
      return;
    }
    updateSettings({ modeModelSelections: { [slot]: value } });
  };

  const renderRow = (row: (typeof MODE_SLOTS)[number]) => {
    const stored = settings.modeModelSelections[row.slot];
    const shown = stored ?? fallbackSelection;
    const entry = entries.find((candidate) => candidate.instanceId === shown?.instanceId);
    const options = getCustomModelOptionsByInstance(
      settings,
      providers,
      shown?.instanceId,
      shown?.model,
    );
    const unsetLabel = row.slot === "judge" ? "Use the Review model" : "Use the thread's model";
    return (
      <SettingsRow
        key={row.slot}
        serverScoped
        settingKeys={["modeModelSelections"]}
        mixed={mixed}
        title={row.title}
        description={row.description}
        resetAction={
          mixed || stored !== null ? (
            <SettingResetButton
              label={`${row.title} model`}
              onClick={() => setSlot(row.slot, null)}
            />
          ) : null
        }
        control={
          shown ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                environmentId={representative?.environmentId ?? null}
                activeInstanceId={shown.instanceId}
                model={shown.model}
                lockedProvider={null}
                instanceEntries={entries}
                modelOptionsByInstance={options}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                triggerAriaLabel={`${row.title} model`}
                {...(mixed
                  ? { triggerLabel: "Mixed" }
                  : stored === null
                    ? { triggerLabel: unsetLabel }
                    : {})}
                getModelDisabledReason={modelDisabledReason}
                onInstanceModelChange={(instanceId, model) =>
                  setSlot(row.slot, createModelSelection(instanceId, model))
                }
              />
              {stored !== null && entry && !mixed ? (
                <TraitsPicker
                  provider={entry.driverKind}
                  models={entry.models}
                  model={stored.model}
                  modelOptions={stored.options ?? []}
                  allowPromptInjectedEffort={false}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  onModelOptionsChange={(nextOptions) =>
                    setSlot(
                      row.slot,
                      createModelSelection(stored.instanceId, stored.model, nextOptions),
                    )
                  }
                />
              ) : null}
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {unavailable ? "Connect an environment" : "No providers available"}
            </span>
          )
        }
      />
    );
  };

  return (
    <>
      <SettingsSection {...searchableSetting("mode-models")}>
        {MODE_SLOTS.map(renderRow)}
      </SettingsSection>
      <SettingsSection {...searchableSetting("mode-model-roles")}>
        {ROLE_SLOTS.map(renderRow)}
      </SettingsSection>
    </>
  );
}
