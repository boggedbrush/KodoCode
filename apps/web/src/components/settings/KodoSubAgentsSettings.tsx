import {
  KODO_SUB_AGENTS_DEFAULT_MAX_WORKERS,
  KODO_SUB_AGENTS_MAX_WORKERS_LIMIT,
} from "@t3tools/contracts";

import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/**
 * Sub-agents defaults: whether a new thread starts with them on (an environment default a project can
 * override, so it shows in both scopes) and how many workers one lead may have running (environment only).
 */
export function KodoSubAgentsSettings(props: { readonly isProjectScope: boolean }) {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedDefault = useScopedSettingsMixed(["kodoSubAgentsDefault"]);
  const mixedMax = useScopedSettingsMixed(["kodoSubAgentsMaxWorkers"]);
  const maxWorkers = Math.min(
    KODO_SUB_AGENTS_MAX_WORKERS_LIMIT,
    Math.max(1, Math.floor(settings.kodoSubAgentsMaxWorkers)),
  );
  return (
    <SettingsSection {...searchableSetting("sub-agents")}>
      <SettingsRow
        serverScoped
        settingKeys={["kodoSubAgentsDefault"]}
        mixed={mixedDefault}
        title="Delegate to sub-agents"
        description={
          (props.isProjectScope
            ? "New threads in this project start with sub-agents on."
            : "New threads start with sub-agents on. Projects can override it.") +
          " A lead thread plans, delegates and verifies; its Code and Review workers run on the models set for those modes. A loop costs less for multi-round work, because it has no lead turns."
        }
        resetAction={
          settings.kodoSubAgentsDefault ? (
            <SettingResetButton
              label="sub-agents default"
              tooltip="Reset sub-agents to off"
              onClick={() => updateSettings({ kodoSubAgentsDefault: false })}
            />
          ) : null
        }
        control={
          <Switch
            aria-label="Delegate to sub-agents"
            mixed={mixedDefault}
            checked={mixedDefault ? false : settings.kodoSubAgentsDefault}
            onCheckedChange={(enabled) => updateSettings({ kodoSubAgentsDefault: enabled })}
          />
        }
      />
      {props.isProjectScope ? null : (
        <SettingsRow
          serverScoped
          settingKeys={["kodoSubAgentsMaxWorkers"]}
          mixed={mixedMax}
          {...searchableSetting("sub-agents-max-workers")}
          description={`How many workers one lead may have running at once, 1 to ${KODO_SUB_AGENTS_MAX_WORKERS_LIMIT}. A turn can start at most 8 in all.`}
          resetAction={
            mixedMax || maxWorkers !== KODO_SUB_AGENTS_DEFAULT_MAX_WORKERS ? (
              <SettingResetButton
                label="live worker limit"
                onClick={() =>
                  updateSettings({ kodoSubAgentsMaxWorkers: KODO_SUB_AGENTS_DEFAULT_MAX_WORKERS })
                }
              />
            ) : null
          }
          control={
            <Input
              size="sm"
              type="number"
              min={1}
              max={KODO_SUB_AGENTS_MAX_WORKERS_LIMIT}
              step={1}
              className="w-full sm:w-28"
              defaultValue={maxWorkers}
              key={maxWorkers}
              aria-label="Live workers per lead"
              onBlur={(event) => {
                const parsed = Number(event.target.value);
                if (
                  Number.isInteger(parsed) &&
                  parsed >= 1 &&
                  parsed <= KODO_SUB_AGENTS_MAX_WORKERS_LIMIT &&
                  parsed !== maxWorkers
                ) {
                  updateSettings({ kodoSubAgentsMaxWorkers: parsed });
                }
              }}
            />
          }
        />
      )}
    </SettingsSection>
  );
}
