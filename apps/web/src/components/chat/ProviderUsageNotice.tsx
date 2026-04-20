import { type ProviderKind, type ServerProviderUsage } from "@t3tools/contracts";
import { PROVIDER_USAGE_METADATA } from "@t3tools/shared/provider-usage";
import { memo } from "react";
import { XIcon } from "lucide-react";
import { formatRelativeTimeFromNowLabel } from "~/timestampFormat";

import {
  clampUsagePercentUsed,
  selectPrimaryUsageWindows,
  toRemainingUsagePercent,
} from "../../providerUsageDisplay";
import { cn } from "~/lib/utils";

function usageBarClass(percentRemaining: number | null): string {
  if (percentRemaining === null) {
    return "bg-muted-foreground/35";
  }
  if (percentRemaining <= 5) {
    return "bg-destructive";
  }
  if (percentRemaining <= 20) {
    return "bg-warning";
  }
  return "bg-success";
}

function formatResetLabel(resetAt: string | null): string {
  if (!resetAt) {
    return "Reset unavailable";
  }
  return `Resets ${formatRelativeTimeFromNowLabel(resetAt)}`;
}

export const ProviderUsageNotice = memo(function ProviderUsageNotice({
  provider,
  usage,
  visible,
  onDismiss,
  className,
}: {
  provider: ProviderKind;
  usage: ServerProviderUsage | null;
  visible: boolean;
  onDismiss?: () => void;
  className?: string;
}) {
  const metadata = PROVIDER_USAGE_METADATA[provider];
  const usageWindows = usage?.windows ?? [];
  const { sessionWindow, weeklyWindow } = selectPrimaryUsageWindows({
    windows: usageWindows,
    sessionLabel: metadata.sessionLabel,
    weeklyLabel: metadata.weeklyLabel,
  });

  const rows = [
    {
      key: "session" as const,
      label: metadata.sessionLabel,
      window: sessionWindow,
    },
    {
      key: "weekly" as const,
      label: metadata.weeklyLabel,
      window: weeklyWindow,
    },
  ];

  return (
    <div
      className={cn(
        "w-full origin-bottom overflow-hidden transition-[max-height,opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[max-height,opacity,transform] motion-reduce:transition-none",
        visible
          ? "max-h-64 translate-y-0 opacity-100"
          : "pointer-events-none max-h-0 translate-y-1 opacity-0",
        className,
      )}
      aria-hidden={!visible}
    >
      <div className="relative rounded-[18px] border border-border/60 bg-card/95 px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.16)] backdrop-blur-sm text-[11px] text-muted-foreground">
        {onDismiss ? (
          <button
            type="button"
            aria-label="Hide usage panel"
            className="absolute top-2 right-2 inline-flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
            onClick={onDismiss}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
        {!usage ? (
          <p className="px-7 text-muted-foreground">
            No usage snapshot available yet for this provider.
          </p>
        ) : null}
        {usage ? (
          <div className="flex flex-wrap gap-2 px-7">
            {rows.map((row) => {
              const percentUsed = clampUsagePercentUsed(row.window?.percentUsed ?? null);
              const percentRemaining = toRemainingUsagePercent(percentUsed);
              return (
                <div
                  key={row.key}
                  className="min-w-0 flex-1 rounded-xl border border-border/50 bg-background/35 px-2.5 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground/90">{row.label}</span>
                    <span className="tabular-nums text-foreground/90">
                      {percentRemaining === null ? "--" : `${Math.round(percentRemaining)}% left`}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/20">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300",
                        usageBarClass(percentRemaining),
                      )}
                      style={{ width: `${percentRemaining ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground/90">
                    {formatResetLabel(row.window?.resetAt ?? null)}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
});
