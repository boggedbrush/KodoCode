import type { ServerProviderUsage, ServerProviderUsageWindow } from "@t3tools/contracts";
import type { ProviderUsageMetadata } from "@t3tools/shared/provider-usage";

import { cn } from "../../lib/utils";
import {
  clampUsagePercentUsed,
  deriveSessionResetFromWeeklyReset,
  selectPrimaryUsageWindows,
  toRemainingUsagePercent,
} from "../../providerUsageDisplay";

function getUsageStatusLabel(status: "ready" | "limited" | "exhausted" | "unknown" | "error") {
  switch (status) {
    case "ready":
      return "Usage healthy";
    case "limited":
      return "Usage limited";
    case "exhausted":
      return "Usage exhausted";
    case "error":
      return "Usage check failed";
    case "unknown":
    default:
      return "Usage unknown";
  }
}

function usageBarToneClass(percentRemaining: number | null): string {
  if (percentRemaining === null) {
    return "bg-muted-foreground/30";
  }
  if (percentRemaining <= 5) {
    return "bg-destructive";
  }
  if (percentRemaining <= 20) {
    return "bg-warning";
  }
  return "bg-success";
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatUsageResetLabel(resetAt: string): string {
  const resetDate = new Date(resetAt);
  if (Number.isNaN(resetDate.getTime())) {
    return `Resets ${resetAt}`;
  }

  const now = new Date();
  const formatted = isSameLocalDay(resetDate, now)
    ? new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(resetDate)
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
        .format(resetDate)
        .replace(", ", " ");

  return `Resets ${formatted}`;
}

function getUsageLimitTitle(input: { key: "session" | "weekly"; label: string }): string {
  if (input.key === "session") {
    return "5 hour usage limit";
  }
  return `${input.label} usage limit`;
}

function getUsageWindowUnavailableLabel(window: { percentUsed: number | null } | null): string {
  if (window) {
    return "Usage data unavailable";
  }
  return "Usage source unavailable";
}

function hasRenderableUsagePercent(window: { percentUsed: number | null } | null): boolean {
  return clampUsagePercentUsed(window?.percentUsed ?? null) !== null;
}

interface UsageBarRow {
  readonly key: "session" | "weekly";
  readonly label: string;
  readonly window: ServerProviderUsageWindow | null;
}

function buildUsageBarRows(input: {
  readonly usage: ServerProviderUsage;
  readonly metadata: ProviderUsageMetadata;
}): ReadonlyArray<UsageBarRow> {
  const usageWindows = input.usage.windows;
  const { sessionWindow, weeklyWindow } = selectPrimaryUsageWindows({
    windows: usageWindows,
    sessionLabel: input.metadata.sessionLabel,
    weeklyLabel: input.metadata.weeklyLabel,
  });
  const sessionResetAt =
    sessionWindow?.resetAt ??
    deriveSessionResetFromWeeklyReset({
      weeklyResetAt: weeklyWindow?.resetAt ?? null,
    });

  return [
    {
      key: "session",
      label: input.metadata.sessionLabel,
      window: sessionWindow
        ? {
            ...sessionWindow,
            resetAt: sessionResetAt,
          }
        : sessionResetAt
          ? {
              key: "derived-session-reset",
              label: input.metadata.sessionLabel,
              percentUsed: null,
              resetAt: sessionResetAt,
            }
          : null,
    },
    {
      key: "weekly",
      label: input.metadata.weeklyLabel,
      window: weeklyWindow,
    },
  ];
}

export function SettingsProviderUsageSection({
  usage,
  metadata,
}: {
  usage: ServerProviderUsage;
  metadata: ProviderUsageMetadata;
}) {
  const usageBarRows = buildUsageBarRows({ usage, metadata });

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-foreground/90">{getUsageStatusLabel(usage.status)}</span>
        {usage.stale ? (
          <span className="rounded bg-warning/20 px-1.5 py-0.5 text-warning">Stale</span>
        ) : null}
        {usage.identity.planName ? <span>Plan: {usage.identity.planName}</span> : null}
        {usage.identity.loginMethod ? <span>Login: {usage.identity.loginMethod}</span> : null}
      </div>
      {usage.summary || usage.detail ? (
        <p className="mt-1 text-muted-foreground">
          {usage.summary ?? usage.detail}
          {usage.summary && usage.detail ? ` - ${usage.detail}` : null}
        </p>
      ) : null}
      <div className="mt-1 grid gap-1 md:grid-cols-2">
        {usageBarRows.map((row) => {
          const percentUsed = clampUsagePercentUsed(row.window?.percentUsed ?? null);
          const percentRemaining = toRemainingUsagePercent(percentUsed);
          const hasRemaining = percentRemaining !== null && hasRenderableUsagePercent(row.window);
          const unavailableLabel = getUsageWindowUnavailableLabel(row.window);
          const primaryStatusLabel = row.window?.resetAt
            ? formatUsageResetLabel(row.window.resetAt)
            : unavailableLabel;
          return (
            <div
              key={row.key}
              className="rounded-md border border-border/70 bg-background/15 px-2 py-1.5"
            >
              <p className="text-[11px] font-medium text-muted-foreground/90">
                {getUsageLimitTitle({ key: row.key, label: row.label })}
              </p>
              <div className="mt-0.5 flex items-baseline gap-1">
                {hasRemaining ? (
                  <>
                    <span className="text-2xl font-semibold leading-none text-foreground tabular-nums">
                      {`${Math.round(percentRemaining)}%`}
                    </span>
                    <span className="text-sm leading-none text-foreground/90">remaining</span>
                  </>
                ) : (
                  <span className="text-sm leading-none text-muted-foreground">
                    {primaryStatusLabel}
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/20">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300",
                    usageBarToneClass(percentRemaining),
                  )}
                  style={{ width: hasRemaining ? `${percentRemaining}%` : "0%" }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground/90">{primaryStatusLabel}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2">
        {metadata.usageUrl ? (
          <a
            href={metadata.usageUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Usage
          </a>
        ) : null}
        {metadata.dashboardUrl ? (
          <a
            href={metadata.dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {metadata.dashboardLabel ?? "Dashboard"}
          </a>
        ) : null}
        {metadata.statusPageUrl ? (
          <a
            href={metadata.statusPageUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Status
          </a>
        ) : null}
      </div>
    </div>
  );
}
