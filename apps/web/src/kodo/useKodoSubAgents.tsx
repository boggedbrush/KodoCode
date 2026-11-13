import type {
  EnvironmentId,
  KodoLead,
  OrchestrationV2Subagent,
  ProviderInstanceId,
  ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { kodoSubAgentsToggle } from "@t3tools/shared/kodoDelegation";
import { CircleStopIcon, NetworkIcon } from "lucide-react";
import { useEffect, useState } from "react";

import type { ComposerBannerStackItem } from "../components/chat/ComposerBannerStack";
import { Button } from "../components/ui/button";
import { useStableCallback } from "../hooks/useStableCallback";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import {
  kodoRunningWorkers,
  kodoWorkersBannerTitle,
  registerKodoSubAgentsToggle,
} from "./subAgents.logic";
import { setKodoDraftSubAgents, useKodoDraftSubAgents } from "./subAgentsDraft";
import type { KodoSubAgentsStatus } from "./subAgentsStatus";

/**
 * The composer's sub-agents switch and the banner of running workers. On a thread the server holds,
 * the server's flag is the truth and a flip is sent at once; on a draft the choice is this browser's
 * until the first send creates the thread with it. The same flip is what the palette and the
 * keybinding ask for.
 */
export function useKodoSubAgents(input: {
  readonly environmentId: EnvironmentId;
  readonly threadKey: string;
  /** Set once the server holds the thread. */
  readonly serverThreadId: ThreadId | null;
  readonly serverLead: KodoLead | null | undefined;
  /** The project's default for a new thread: what a draft shows until a choice is made. */
  readonly draftDefault: boolean;
  readonly provider: Pick<ServerProvider, "kodoSubAgents"> | undefined;
  readonly providerInstanceId: ProviderInstanceId | undefined;
  readonly busy: boolean;
  readonly loopRunning: boolean;
  readonly isWorker: boolean;
  readonly canOperate: boolean;
  readonly subagents: ReadonlyArray<OrchestrationV2Subagent> | null;
  readonly setThreadError: (threadId: ThreadId, message: string | null) => void;
}): { readonly status: KodoSubAgentsStatus; readonly banner: ComposerBannerStackItem | null } {
  const { serverThreadId } = input;
  const isServerThread = serverThreadId !== null;
  const draftChoice = useKodoDraftSubAgents(input.threadKey);
  const setLead = useOrchestrationCommand(threadEnvironment.setKodoLead, { reportFailure: false });
  const stopWorkers = useOrchestrationCommand(threadEnvironment.stopKodoWorkers, {
    reportFailure: false,
  });
  const [pending, setPending] = useState<boolean | null>(null);
  const [stopping, setStopping] = useState(false);
  const running = input.subagents === null ? 0 : kodoRunningWorkers(input.subagents);

  const serverOn = input.serverLead?.kind === "sub-agents";
  const shownOn = isServerThread ? (pending ?? serverOn) : (draftChoice ?? input.draftDefault);
  const toggle = kodoSubAgentsToggle({
    lead: shownOn ? { kind: "sub-agents" } : null,
    provider: input.provider,
    busy: input.busy,
    loopRunning: input.loopRunning,
    isWorker: input.isWorker,
    canOperate: input.canOperate,
    liveWorkers: running,
  });

  const report = (message: string) => {
    if (serverThreadId !== null) input.setThreadError(serverThreadId, message);
  };
  const onToggle = useStableCallback(async (on: boolean) => {
    if (!isServerThread) {
      setKodoDraftSubAgents(input.threadKey, on);
      return;
    }
    if (pending !== null) return;
    setPending(on);
    const result = await setLead({
      environmentId: input.environmentId,
      input: { threadId: serverThreadId, lead: on ? { kind: "sub-agents" } : null },
    });
    setPending(null);
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    report(error instanceof Error ? error.message : "Sub-agents could not be changed.");
  });
  const flip = useStableCallback(() => {
    if (!toggle.disabled) void onToggle(!toggle.checked);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this composer's switch with the palette and keybinding, which live outside React's tree
  useEffect(() => registerKodoSubAgentsToggle(flip), [flip]);

  const stop = useStableCallback(async () => {
    if (serverThreadId === null || stopping) return;
    setStopping(true);
    const result = await stopWorkers({
      environmentId: input.environmentId,
      input: { threadId: serverThreadId },
    });
    setStopping(false);
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    report(error instanceof Error ? error.message : "The workers could not be stopped.");
  });

  const banner: ComposerBannerStackItem | null =
    isServerThread && serverOn && running > 0
      ? {
          id: "kodo-sub-agents-workers",
          variant: "info",
          icon: <NetworkIcon className="text-mode-code" />,
          title: kodoWorkersBannerTitle(running),
          description:
            "Their results come back here. Stop workers ends them and leaves this turn running.",
          actions: input.canOperate ? (
            <Button size="xs" variant="outline" disabled={stopping} onClick={() => void stop()}>
              <CircleStopIcon aria-hidden />
              Stop workers
            </Button>
          ) : undefined,
        }
      : null;

  return { status: { toggle, onToggle: (on) => void onToggle(on) }, banner };
}
