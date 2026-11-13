import {
  AuthOrchestrationOperateScope,
  KODO_ORCHESTRATOR_THREAD_ID,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  KODO_ORCHESTRATOR_STATE_LABEL,
  kodoOrchestratorState,
  type KodoOrchestratorState,
} from "@t3tools/shared/kodoOrchestrator";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { useQuietThreadShell } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";

// Static colours, one per state: the dot changes when the state does and never animates.
const DOT_CLASS: Record<KodoOrchestratorState, string> = {
  idle: "bg-foreground-muted",
  working: "bg-sky-500",
  "needs-you": "bg-amber-500",
};

/**
 * The first row of the thread list: one conversation across all projects, with a dot that says
 * whether it is idle, working or needs you. The thread is made the first time it is opened.
 */
export function KodoOrchestratorRow(props: {
  readonly environmentId: EnvironmentId | null;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}) {
  return props.environmentId === null ? null : (
    <EnvironmentOrchestratorRow environmentId={props.environmentId} onOpen={props.onOpen} />
  );
}

function EnvironmentOrchestratorRow(props: {
  readonly environmentId: EnvironmentId;
  readonly onOpen: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}) {
  const { environmentId } = props;
  const enabled = useAtomValue(
    serverEnvironment.settingsValueAtom(environmentId),
  )?.kodoOrchestratorEnabled;
  const shell = useQuietThreadShell(scopeThreadRef(environmentId, KODO_ORCHESTRATOR_THREAD_ID));
  const ensure = useAtomCommand(serverEnvironment.ensureKodoOrchestrator, { reportFailure: false });
  const [opening, setOpening] = useState(false);
  if (enabled === false) return null;
  const state = kodoOrchestratorState(shell);
  const label = KODO_ORCHESTRATOR_STATE_LABEL[state];

  const open = async () => {
    if (opening) return;
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      Dialog.alert(
        "The Orchestrator could not be opened",
        "This connection cannot change threads.",
      );
      return;
    }
    setOpening(true);
    const result = await ensure({ environmentId, input: {} });
    setOpening(false);
    if (result._tag === "Success") {
      props.onOpen(environmentId, result.value.threadId);
      return;
    }
    Dialog.alert("The Orchestrator could not be opened", "Try again in a moment.");
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Orchestrator, ${label}`}
      disabled={opening}
      onPress={() => void open()}
      className="mx-4 mb-2 min-h-11 flex-row items-center gap-3 rounded-2xl bg-grouped-card px-4"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <View className={`size-2.5 rounded-full ${DOT_CLASS[state]}`} />
      <Text className="flex-1 text-sm font-t3-medium text-foreground">Orchestrator</Text>
      <Text className="text-xs text-foreground-muted">{label}</Text>
    </Pressable>
  );
}
