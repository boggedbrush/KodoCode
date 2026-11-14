import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  KODO_ORCHESTRATOR_STATE_LABEL,
  kodoNeedsYouItems,
  kodoNeedsYouRowView,
  kodoOrchestratorState,
  kodoOrchestratorStatusLine,
  kodoOrchestratorWorkerActivity,
  latestKodoOrchestratorThreadId,
  type KodoOrchestratorState,
} from "@t3tools/shared/kodoOrchestrator";
import { useAtomValue } from "@effect/atom-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { minuteTick } from "@t3tools/client-runtime/clock";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { useQuietThreadShell } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
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
  // The conversation is the newest of its series that this client holds; a reset starts the next.
  const refs = useAtomValue(environmentThreadShells.threadRefsAtom);
  const threadId = useMemo(
    () =>
      latestKodoOrchestratorThreadId(
        refs.filter((ref) => ref.environmentId === environmentId).map((ref) => ref.threadId),
      ) as ThreadId | undefined,
    [environmentId, refs],
  );
  const shell = useQuietThreadShell(
    threadId === undefined ? null : scopeThreadRef(environmentId, threadId),
  );
  // Its workers are listed in their own projects; a live or asking one is the Orchestrator's work too.
  const shells = useAtomValue(environmentThreadShells.quietThreadShellsAtom);
  const workers = useMemo(
    () =>
      kodoOrchestratorWorkerActivity(
        shells.filter((candidate) => candidate.environmentId === environmentId),
        threadId,
      ),
    [environmentId, shells, threadId],
  );
  // What waits on the person across the Orchestrator, its workers and the sub-agent leads.
  const needsYou = useMemo(
    () =>
      kodoNeedsYouItems(
        [
          ...(shell === null ? [] : [shell]),
          ...shells.filter((candidate) => candidate.environmentId === environmentId),
        ],
        threadId,
      ),
    [environmentId, shell, shells, threadId],
  );
  const [showNeedsYou, setShowNeedsYou] = useState(false);
  const ensure = useAtomCommand(serverEnvironment.ensureKodoOrchestrator, { reportFailure: false });
  const [opening, setOpening] = useState(false);
  // The minute clock the web rows read: elapsed time moves once a minute, never per second.
  const nowMinute = useSyncExternalStore(
    minuteTick.subscribe,
    minuteTick.getSnapshot,
    minuteTick.getSnapshot,
  );
  const statusLine = kodoOrchestratorStatusLine(shell, workers, Date.parse(`${nowMinute}:00.000Z`));
  if (enabled === false) return null;
  const state = kodoOrchestratorState(shell, workers);
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
      if (result.value.warning !== undefined) {
        Dialog.alert("The Orchestrator will not run as it is", result.value.warning);
      }
      return;
    }
    // The server's own reason: a missing default model, a provider that cannot receive the tools, a setting that is off.
    const error = result._tag === "Failure" ? squashAtomCommandFailure(result) : undefined;
    Dialog.alert(
      "The Orchestrator could not be opened",
      error instanceof Error && error.message.length > 0 ? error.message : "Try again in a moment.",
    );
  };

  return (
    <View className="mx-4 mb-2 gap-1">
      <View className="min-h-11 flex-row items-center gap-3 rounded-2xl bg-grouped-card px-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Orchestrator, ${label}, ${statusLine}`}
          disabled={opening}
          onPress={() => void open()}
          className="min-h-11 flex-1 flex-row items-center gap-3"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View className={`size-2.5 rounded-full ${DOT_CLASS[state]}`} />
          <Text className="text-sm font-t3-medium text-foreground">Orchestrator</Text>
          <Text className="shrink text-xs text-foreground-muted" numberOfLines={1}>
            {statusLine}
          </Text>
        </Pressable>
        {needsYou.length === 0 ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Needs you, ${needsYou.length} waiting`}
            accessibilityState={{ expanded: showNeedsYou }}
            onPress={() => setShowNeedsYou(!showNeedsYou)}
            className="min-h-11 min-w-11 items-center justify-center"
          >
            <Text className="text-xs font-t3-medium text-amber-600">{needsYou.length} waiting</Text>
          </Pressable>
        )}
      </View>
      {showNeedsYou
        ? needsYou.map((item) => {
            const view = kodoNeedsYouRowView(item);
            return (
              <Pressable
                key={item.threadId}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${view.label}`}
                onPress={() => props.onOpen(environmentId, item.threadId as ThreadId)}
                className="min-h-11 justify-center rounded-2xl bg-grouped-card px-4 py-2"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text className="text-sm text-foreground" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                  {view.label} · {view.context}
                </Text>
              </Pressable>
            );
          })
        : null}
    </View>
  );
}
