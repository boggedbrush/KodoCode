import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProviderUsage,
} from "@t3tools/contracts";
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

function statusLabel(status: ServerProviderUsage["status"]): string {
  switch (status) {
    case "ready":
      return "Healthy";
    case "limited":
      return "Limited";
    case "exhausted":
      return "Exhausted";
    case "error":
      return "Error";
    case "unknown":
    default:
      return "Unknown";
  }
}

function statusBadgeClass(status: ServerProviderUsage["status"]): string {
  switch (status) {
    case "ready":
      return "bg-success/18 text-success";
    case "limited":
      return "bg-warning/18 text-warning";
    case "exhausted":
    case "error":
      return "bg-destructive/18 text-destructive";
    case "unknown":
    default:
      return "bg-muted text-muted-foreground";
  }
}

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
}: {
  provider: ProviderKind;
  usage: ServerProviderUsage | null;
  visible: boolean;
  onDismiss?: () => void;
}) {
  if (!visible) {
    return null;
  }

  const metadata = PROVIDER_USAGE_METADATA[provider];
  const providerLabel = PROVIDER_DISPLAY_NAMES[provider] ?? provider;
  const usageMessage = usage?.detail ?? usage?.summary ?? null;
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
    <div className="pointer-events-none fixed right-4 top-[calc(var(--desktop-window-safe-inset)+52px+6.5rem)] z-40 w-[min(22.5rem,calc(100vw-2rem))] sm:right-8 sm:w-[min(22.5rem,calc(100vw-4rem))]">
      <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground/90">{providerLabel} usage</span>
          {usage ? (
            <span
              className={cn("rounded px-1.5 py-0.5 font-medium", statusBadgeClass(usage.status))}
            >
              {statusLabel(usage.status)}
            </span>
          ) : null}
          {usage?.stale ? (
            <span className="rounded bg-warning/20 px-1.5 py-0.5 text-warning">Stale</span>
          ) : null}
          {usage?.identity.planName ? <span>Plan: {usage.identity.planName}</span> : null}
          {onDismiss ? (
            <button
              type="button"
              aria-label="Hide usage panel"
              className="pointer-events-auto ml-auto inline-flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
              onClick={onDismiss}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
        {usageMessage ? (
          <p className="mt-1 line-clamp-2 text-muted-foreground" title={usageMessage}>
            {usageMessage}
          </p>
        ) : !usage ? (
          <p className="mt-1 text-muted-foreground">
            No usage snapshot available yet for this provider.
          </p>
        ) : null}
        {usage ? (
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {rows.map((row) => {
              const percentUsed = clampUsagePercentUsed(row.window?.percentUsed ?? null);
              const percentRemaining = toRemainingUsagePercent(percentUsed);
              return (
                <div
                  key={row.key}
                  className="rounded border border-border/60 bg-background/20 px-2 py-1.5"
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
        {metadata.usageUrl || metadata.dashboardUrl ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2">
            {metadata.usageUrl ? (
              <a
                href={metadata.usageUrl}
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto text-primary hover:underline"
              >
                Usage
              </a>
            ) : null}
            {metadata.dashboardUrl ? (
              <a
                href={metadata.dashboardUrl}
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto text-primary hover:underline"
              >
                {metadata.dashboardLabel ?? "Dashboard"}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});
