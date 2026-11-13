import type { ServerConfig, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { kodoSubAgentsToggle } from "@t3tools/shared/kodoDelegation";
import { kodoThreadOwnModel } from "@t3tools/shared/kodoModeModel";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

const IDLE_STATUSES: ReadonlySet<string> = new Set([
  "idle",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "rolled_back",
]);

/** The thread's sub-agents switch for the settings sheet: the shared rules say when it is disabled and why. */
export function KodoSubAgentsRow(props: {
  readonly thread: EnvironmentThreadShell;
  readonly serverConfig: Pick<ServerConfig, "providers"> | null;
}) {
  const { thread } = props;
  const setLead = useAtomCommand(threadEnvironment.setKodoLead, { reportFailure: false });
  const own = kodoThreadOwnModel(thread);
  const toggle = kodoSubAgentsToggle({
    lead: thread.kodoLead,
    provider: props.serverConfig?.providers.find(
      (provider) => provider.instanceId === own.instanceId,
    ),
    busy: !IDLE_STATUSES.has(thread.runtime?.status ?? "idle"),
    loopRunning:
      thread.source?.kodoLoopStatus?.status === "active" ||
      thread.source?.kodoLoopStatus?.status === "held",
    isWorker: thread.lineage.relationshipToParent === "subagent",
    canOperate: true,
  });
  const change = async (on: boolean) => {
    const result = await setLead({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id as ThreadId,
        lead: on ? { kind: "sub-agents" } : null,
        creationSource: "mobile",
      },
    });
    if (result._tag === "Failure") Dialog.alert("Could not change sub-agents");
  };
  return (
    <View className="mx-4 overflow-hidden rounded-2xl bg-grouped-card">
      <View className="min-h-11 flex-row items-center justify-between px-4 py-1">
        <Text className="text-sm font-t3-medium text-foreground">Sub-agents</Text>
        <ThemedSwitch
          accessibilityLabel="Sub-agents"
          disabled={toggle.disabled}
          onValueChange={(on) => void change(on)}
          value={toggle.checked}
        />
      </View>
      <Text className="px-4 pb-3 text-xs text-foreground-muted">
        {toggle.reason ??
          "This thread plans and delegates to Code and Review workers on the models set for those modes."}
      </Text>
    </View>
  );
}
