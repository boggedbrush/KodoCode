import type { EnvironmentId, KodoLoopShellStatus, ThreadId } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { kodoLoopBanner } from "@t3tools/shared/kodoLoopView";
import { useState } from "react";
import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

/**
 * A thread's loop in one line: where it is while it runs, Stop, Approve plan when it waits for one,
 * and why it ended. It reads the status the thread shell carries; the full summary is on the web.
 */
export function KodoLoopBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly status: KodoLoopShellStatus | undefined;
  readonly canOperateThread: boolean;
}) {
  const control = useAtomCommand(threadEnvironment.controlLoop);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { status } = props;
  if (status === undefined) return null;
  const banner = kodoLoopBanner(status, { canOperate: props.canOperateThread });
  const key = `${status.status}:${status.round}:${status.stopReason ?? ""}`;
  const ended = banner.tone === "done" || banner.tone === "stopped" || banner.tone === "failed";
  if (ended && dismissed === key) return null;

  const send = async (type: "stop" | "approve") => {
    setBusy(true);
    setError(null);
    const result = await control({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, control: { type } },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      setError("The loop could not be changed.");
    }
  };

  if (ended) {
    return (
      <View className="px-4 pb-3">
        <Notice
          message={banner.detail === null ? banner.title : `${banner.title}. ${banner.detail}`}
          icon="arrow.clockwise"
          tone={banner.tone === "failed" ? "danger" : "default"}
          floating
          onDismiss={() => setDismissed(key)}
          dismissLabel="Dismiss loop status"
        />
      </View>
    );
  }
  return (
    <View className="gap-2 px-4 pb-3">
      <AppText textRole="footnote" className="font-t3-medium text-foreground">
        {banner.title}
      </AppText>
      {banner.detail === null ? null : (
        <AppText textRole="footnote" className="text-foreground-muted">
          {banner.detail}
        </AppText>
      )}
      {error === null ? null : (
        <AppText textRole="footnote" className="text-danger-foreground">
          {error}
        </AppText>
      )}
      {banner.stop || banner.approve ? (
        <View className="flex-row gap-2">
          {banner.approve ? (
            <Button
              label="Approve plan"
              size="compact"
              tone="primary"
              disabled={busy}
              onPress={() => void send("approve")}
            />
          ) : null}
          {banner.stop ? (
            <Button label="Stop" size="compact" disabled={busy} onPress={() => void send("stop")} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
