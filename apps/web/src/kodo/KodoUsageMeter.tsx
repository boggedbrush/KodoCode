import { useAtomValue } from "@effect/atom-react";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { GaugeIcon } from "lucide-react";
import { memo } from "react";

import { useNowMinute } from "../hooks/useNowMinute";
import { usePrimarySettings } from "../hooks/useSettings";
import { cn } from "../lib/utils";
import { environmentPresentations } from "../state/presentation";
import { formatUpcomingTimestamp } from "../timestampFormat";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../components/ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { openKodoUsageLimits } from "./usageOpen";
import {
  collectKodoUsageMeterEntries,
  formatKodoResetsIn,
  KODO_USAGE_METER_MAX_ENTRIES,
  type KodoUsageLevel,
  type KodoUsageMeterEntry,
} from "./usageMeter.logic";

const LEVEL_TEXT: Record<KodoUsageLevel, string> = {
  ok: "text-muted-foreground",
  warning: "text-warning",
  critical: "text-destructive",
  exhausted: "text-destructive",
};
const LEVEL_FILL: Record<KodoUsageLevel, string> = {
  ok: "bg-muted-foreground",
  warning: "bg-warning",
  critical: "bg-destructive",
  exhausted: "bg-destructive",
};

const providerLabel = (driver: string) =>
  (PROVIDER_DISPLAY_NAMES as Record<string, string | undefined>)[driver] ?? driver;

function MeterRow({
  entry,
  now,
  onOpen,
}: {
  readonly entry: KodoUsageMeterEntry;
  readonly now: number;
  readonly onOpen: () => void;
}) {
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const resetsIn = formatKodoResetsIn(entry.resetsAtMs, now);
  const resetsAt =
    entry.resetsAtMs === null
      ? null
      : formatUpcomingTimestamp(new Date(entry.resetsAtMs).toISOString(), timestampFormat, now);
  const summary =
    entry.level === "exhausted"
      ? `${entry.providerLabel} ${entry.label} limit reached`
      : `${entry.providerLabel} ${entry.label}: ${entry.remainingPercent}% left`;
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={`${summary}${resetsIn ? `, ${resetsIn}` : ""}. Open usage limits`}
              data-kodo-usage-level={entry.level}
              onClick={onOpen}
            />
          }
        >
          <GaugeIcon className={LEVEL_TEXT[entry.level]} aria-hidden />
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            <span className="truncate">{entry.providerLabel}</span>
            <span className="truncate text-muted-foreground">{entry.label}</span>
            <span
              className="relative ms-auto h-[3px] w-8 shrink-0 rounded-full bg-muted-foreground/25"
              aria-hidden
            >
              <span
                className={cn("absolute inset-y-0 start-0 rounded-full", LEVEL_FILL[entry.level])}
                style={{ width: `${Math.max(4, entry.usedPercent)}%` }}
              />
            </span>
            <span
              className={cn(
                "w-8 shrink-0 text-end font-medium tabular-nums",
                LEVEL_TEXT[entry.level],
              )}
            >
              {entry.level === "exhausted" ? "Out" : `${entry.remainingPercent}%`}
            </span>
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          <span className="flex flex-col">
            <span className="text-foreground">{summary}</span>
            {resetsIn && resetsAt ? (
              <span className="text-muted-foreground">
                {resetsIn} · {resetsAt}
              </span>
            ) : null}
            {entry.accountCount > 1 ? (
              <span className="text-muted-foreground">{entry.accountCount} accounts pooled</span>
            ) : null}
            {entry.stale ? (
              <span className="text-muted-foreground">Last reading may be out of date</span>
            ) : null}
          </span>
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

/** Quiet by default: appears in the sidebar footer only while a provider's limit is getting close. */
export const KodoSidebarUsageMeter = memo(function KodoSidebarUsageMeter() {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const nowMinute = useNowMinute();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const now = Date.parse(`${nowMinute}:00Z`);
  const entries = collectKodoUsageMeterEntries(presentations, now, providerLabel);
  if (entries.length === 0) return null;
  const shown = entries.slice(0, KODO_USAGE_METER_MAX_ENTRIES);
  const hidden = entries.length - shown.length;
  const open = () => {
    if (isMobile) setOpenMobile(false);
    openKodoUsageLimits(navigate);
  };
  return (
    <SidebarMenu data-kodo-usage-meter="true" aria-label="Usage limits getting close">
      {shown.map((entry) => (
        <MeterRow key={entry.key} entry={entry} now={now} onOpen={open} />
      ))}
      {hidden > 0 ? (
        <SidebarMenuItem>
          <SidebarMenuButton onClick={open} size="sm">
            <span className="text-xs text-muted-foreground">+{hidden} more near their limit</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  );
});
