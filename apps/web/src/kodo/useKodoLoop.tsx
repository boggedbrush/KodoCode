import type { EnvironmentId, KodoLoop, ThreadId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { CircleStopIcon, RepeatIcon } from "lucide-react";
import { useState } from "react";

import type { ComposerBannerStackItem } from "../components/chat/ComposerBannerStack";
import { Button } from "../components/ui/button";
import { useStableCallback } from "../hooks/useStableCallback";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { KodoLoopCard } from "./KodoLoopCard";
import { isKodoLoopRunning, kodoLoopActions, kodoLoopTitle } from "./loopCard.logic";

const DEFAULT_EXTEND_ROUNDS = 3;

/**
 * The loop's card above the composer: where it is while it runs, and why it ended after. A finished
 * loop's card stays until it is dismissed, with the one action its ending offers.
 */
export function useKodoLoop(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId | null;
  readonly loop: KodoLoop | undefined;
  readonly canOperateThread: boolean;
  /** No turn is running or queued on the thread. */
  readonly threadIdle: boolean;
  readonly setThreadError: (threadId: ThreadId, message: string | null) => void;
}): ComposerBannerStackItem | null {
  const control = useOrchestrationCommand(threadEnvironment.controlLoop, { reportFailure: false });
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { loop, threadId } = input;

  const send = useStableCallback(
    async (action: "stop" | "approve" | "retry-judge" | { readonly extend: number }) => {
      if (threadId === null || busy) return;
      setBusy(true);
      const result = await control({
        environmentId: input.environmentId,
        input: {
          threadId,
          control:
            typeof action === "string"
              ? { type: action }
              : { type: "extend", rounds: action.extend },
        },
      });
      setBusy(false);
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      input.setThreadError(
        threadId,
        error instanceof Error ? error.message : "The loop could not be changed.",
      );
    },
  );

  if (loop === undefined || threadId === null) return null;
  const key = `${loop.loopId}:${loop.status}`;
  const running = isKodoLoopRunning(loop);
  if (!running && dismissedKey === key) return null;
  const actions = kodoLoopActions(loop, {
    canOperate: input.canOperateThread,
    threadIdle: input.threadIdle,
    extendRounds: DEFAULT_EXTEND_ROUNDS,
  });
  const hasActions = actions.stop || actions.approve || actions.retryJudge || actions.extendBy > 0;
  return {
    id: "kodo-loop",
    variant: loop.status === "failed" ? "warning" : "info",
    icon: <RepeatIcon className="text-mode-code" />,
    title: kodoLoopTitle(loop),
    children: <KodoLoopCard loop={loop} />,
    ...(running
      ? {}
      : { dismissLabel: "Dismiss loop summary", onDismiss: () => setDismissedKey(key) }),
    ...(hasActions
      ? {
          actions: (
            <>
              {actions.approve ? (
                <Button size="xs" disabled={busy} onClick={() => void send("approve")}>
                  Approve plan
                </Button>
              ) : null}
              {actions.retryJudge ? (
                <Button size="xs" disabled={busy} onClick={() => void send("retry-judge")}>
                  Retry judge
                </Button>
              ) : null}
              {actions.extendBy > 0 ? (
                <Button
                  size="xs"
                  disabled={busy}
                  onClick={() => void send({ extend: actions.extendBy })}
                >
                  Run {actions.extendBy} more round{actions.extendBy === 1 ? "" : "s"}
                </Button>
              ) : null}
              {actions.stop ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void send("stop")}
                >
                  <CircleStopIcon aria-hidden />
                  Stop
                </Button>
              ) : null}
            </>
          ),
        }
      : {}),
  };
}
