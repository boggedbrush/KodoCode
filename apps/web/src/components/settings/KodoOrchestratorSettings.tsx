import { RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { ensureLocalApi } from "../../localApi";
import {
  useKodoOrchestratorThreadId,
  useKodoOrchestratorUnavailableReason,
  useKodoOrchestratorWorkers,
} from "../../kodo/useKodoOrchestrator";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { KodoModeModelsSettings } from "./KodoModeModelsSettings";
import { searchableSetting } from "./settingsSearch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const WORKERS_RUNNING =
  "Workers are still running. Use Stop all in the Orchestrator conversation first.";

/**
 * The Orchestrator: one conversation across all projects, pinned at the top of the thread list. It is
 * read-only and starts work only in a project the person names, after the person approves each worker.
 * Its model is the Lead / Orchestrator slot, so the row here and the one under Models by mode are the
 * same setting.
 */
export function KodoOrchestratorSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["kodoOrchestratorEnabled"]);
  const mixedAsk = useScopedSettingsMixed(["kodoOrchestratorAskBeforeStart"]);
  const environmentId = usePrimaryEnvironmentId();
  const threadId = useKodoOrchestratorThreadId(environmentId);
  const workers = useKodoOrchestratorWorkers(environmentId, threadId);
  const unavailable = useKodoOrchestratorUnavailableReason(environmentId);
  const reset = useOrchestrationCommand(serverEnvironment.resetKodoOrchestrator, {
    reportFailure: false,
  });
  const [resetting, setResetting] = useState(false);
  // Turning it off hides the only way to stop what is running, so it waits until nothing is.
  const holdOff = workers.live > 0 && settings.kodoOrchestratorEnabled;

  const onReset = async () => {
    if (environmentId === null || resetting) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Reset the Orchestrator conversation? It starts again from nothing. Work its workers already did is not touched.",
      { variant: "destructive" },
    );
    if (!confirmed) return;
    setResetting(true);
    const result = await reset({ environmentId, input: {} });
    setResetting(false);
    if (result._tag === "Success") {
      toastManager.add({ type: "success", title: "The Orchestrator conversation was reset" });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "The Orchestrator could not be reset",
      description: error instanceof Error ? error.message : "Try again in a moment.",
    });
  };

  return (
    <SettingsSection {...searchableSetting("orchestrator")}>
      <SettingsRow
        serverScoped
        settingKeys={["kodoOrchestratorEnabled"]}
        mixed={mixed}
        title="Show the Orchestrator"
        description={
          holdOff
            ? WORKERS_RUNNING
            : "One conversation across all your projects. It can read status anywhere and starts work only in a project you name, after you approve it. It never edits files itself."
        }
        status={
          unavailable === null ? undefined : (
            <span data-kodo-orchestrator-unavailable className="text-warning">
              {unavailable}
            </span>
          )
        }
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
            disabled={holdOff}
            checked={mixed ? false : settings.kodoOrchestratorEnabled}
            onCheckedChange={(enabled) => updateSettings({ kodoOrchestratorEnabled: enabled })}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["kodoOrchestratorAskBeforeStart"]}
        mixed={mixedAsk}
        title="Ask before the Orchestrator starts work"
        description="Each worker it would start waits for your approval in the Orchestrator conversation, with the project, mode and request shown. Off, it starts workers at once. Only you can change this."
        resetAction={
          settings.kodoOrchestratorAskBeforeStart ? null : (
            <SettingResetButton
              label="Ask before the Orchestrator starts work"
              tooltip="Ask before the Orchestrator starts work"
              onClick={() => updateSettings({ kodoOrchestratorAskBeforeStart: true })}
            />
          )
        }
        control={
          <Switch
            aria-label="Ask before the Orchestrator starts work"
            mixed={mixedAsk}
            checked={mixedAsk ? false : settings.kodoOrchestratorAskBeforeStart}
            onCheckedChange={(ask) => updateSettings({ kodoOrchestratorAskBeforeStart: ask })}
          />
        }
      />
      <SettingsRow
        serverScoped
        title="Reset conversation"
        description={
          workers.live > 0
            ? WORKERS_RUNNING
            : "Starts the Orchestrator's conversation again, and repairs it if it was lost."
        }
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={resetting || workers.live > 0}
            onClick={() => void onReset()}
          >
            <RotateCcwIcon aria-hidden />
            Reset
          </Button>
        }
      />
      <KodoModeModelsSettings only="orchestrator" />
    </SettingsSection>
  );
}
