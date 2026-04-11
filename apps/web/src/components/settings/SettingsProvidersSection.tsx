import {
  ChevronDownIcon,
  InfoIcon,
  LoaderIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderUsageWindow,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { normalizeModelSlug, resolveUtilityModelSelectionDefault } from "@t3tools/shared/model";
import { PROVIDER_USAGE_METADATA } from "@t3tools/shared/provider-usage";
import { Equal } from "effect";

import { cn } from "../../lib/utils";
import { MAX_CUSTOM_MODEL_LENGTH, resolveAppModelSelectionState } from "../../modelSelection";
import { ensureNativeApi } from "../../nativeApi";
import { useProviderUsages } from "../../rpc/providerUsageState";
import { useServerProviders } from "../../rpc/serverState";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingResetButton, SettingsSection } from "./SettingsPanelPrimitives";
import { PROVIDER_SETTINGS } from "./settingsProviderConfig";
import { formatRelativeTime } from "../../timestampFormat";

type SettingsUpdater = (patch: Partial<UnifiedSettings>) => void;

const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

function getProviderSummary(provider: ServerProvider | undefined) {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation and authentication details.",
    };
  }
  if (!provider.enabled) {
    return {
      headline: "Disabled",
      detail:
        provider.message ??
        "This provider is installed but disabled for new sessions in Kodo Code.",
    };
  }
  if (!provider.installed) {
    return {
      headline: "Not found",
      detail: provider.message ?? "CLI not detected on PATH.",
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : "Authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Not authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  return {
    headline: "Available",
    detail: provider.message ?? "Installed and ready, but authentication could not be verified.",
  };
}

function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

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

function normalizeUsageText(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function shouldHideUsageSummary(input: {
  readonly summary: string | null;
  readonly planName: string | null;
  readonly loginMethod: string | null;
}): boolean {
  if (!input.summary) {
    return false;
  }

  const normalizedSummary = normalizeUsageText(input.summary);
  if (input.planName) {
    const normalizedPlan = normalizeUsageText(input.planName);
    if (
      normalizedSummary === `plan: ${normalizedPlan}` ||
      normalizedSummary === `plan ${normalizedPlan}`
    ) {
      return true;
    }
  }

  if (input.loginMethod) {
    const normalizedLoginMethod = normalizeUsageText(input.loginMethod);
    if (
      normalizedSummary === `login: ${normalizedLoginMethod}` ||
      normalizedSummary === `login ${normalizedLoginMethod}`
    ) {
      return true;
    }
  }

  return false;
}

function clampPercent(percentUsed: number | null): number | null {
  if (percentUsed === null || Number.isNaN(percentUsed)) {
    return null;
  }
  return Math.max(0, Math.min(100, percentUsed));
}

function toRemainingPercent(percentUsed: number | null): number | null {
  if (percentUsed === null) {
    return null;
  }
  return Math.max(0, Math.min(100, 100 - percentUsed));
}

function normalizeUsageWindowToken(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function isWeeklyWindow(window: ServerProviderUsageWindow): boolean {
  const token = normalizeUsageWindowToken(`${window.key} ${window.label}`);
  return (
    token.includes("weekly") ||
    token.includes("week") ||
    token.includes("7d") ||
    token.includes("7-day")
  );
}

function isSessionWindow(window: ServerProviderUsageWindow): boolean {
  const token = normalizeUsageWindowToken(`${window.key} ${window.label}`);
  return (
    token.includes("session") ||
    token.includes("5h") ||
    token.includes("5-hour") ||
    token.includes("hour")
  );
}

function takePreferredWindow(input: {
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly usedKeys: Set<string>;
  readonly preferredLabel: string;
  readonly matcher: (window: ServerProviderUsageWindow) => boolean;
}): ServerProviderUsageWindow | null {
  const preferredLabel = normalizeUsageWindowToken(input.preferredLabel);
  const byLabel = input.windows.find((window) => {
    if (input.usedKeys.has(window.key)) {
      return false;
    }
    return normalizeUsageWindowToken(window.label) === preferredLabel;
  });
  if (byLabel) {
    input.usedKeys.add(byLabel.key);
    return byLabel;
  }

  const byMatcher = input.windows.find((window) => {
    if (input.usedKeys.has(window.key)) {
      return false;
    }
    return input.matcher(window);
  });
  if (byMatcher) {
    input.usedKeys.add(byMatcher.key);
    return byMatcher;
  }

  const firstUnclaimed = input.windows.find((window) => !input.usedKeys.has(window.key));
  if (firstUnclaimed) {
    input.usedKeys.add(firstUnclaimed.key);
    return firstUnclaimed;
  }

  return null;
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

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  const lastCheckedRelative = lastCheckedAt ? formatRelativeTime(lastCheckedAt) : null;

  if (!lastCheckedRelative) {
    return null;
  }

  return (
    <span className="text-[11px] text-muted-foreground/60">
      {lastCheckedRelative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{lastCheckedRelative.value}</span>{" "}
          {lastCheckedRelative.suffix}
        </>
      ) : (
        <>Checked {lastCheckedRelative.value}</>
      )}
    </span>
  );
}

export function SettingsProvidersSection({
  settings,
  updateSettings,
}: {
  settings: UnifiedSettings;
  updateSettings: SettingsUpdater;
}) {
  const [openProviderDetails, setOpenProviderDetails] = useState<Record<ProviderKind, boolean>>({
    codex: Boolean(
      settings.providers.codex.binaryPath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.binaryPath ||
      settings.providers.codex.homePath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.homePath ||
      settings.providers.codex.customModels.length > 0,
    ),
    claudeAgent: Boolean(
      settings.providers.claudeAgent.binaryPath !==
        DEFAULT_UNIFIED_SETTINGS.providers.claudeAgent.binaryPath ||
      settings.providers.claudeAgent.customModels.length > 0,
    ),
  });
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({
    codex: "",
    claudeAgent: "",
  });
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({});
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshingRef = useRef(false);
  const modelListRefs = useRef<Partial<Record<ProviderKind, HTMLDivElement | null>>>({});
  const serverProviders = useServerProviders();
  const providerUsages = useProviderUsages();

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenProvider = textGenerationModelSelection.provider;
  const defaultTextGenerationModelSelection = resolveUtilityModelSelectionDefault(
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
    serverProviders,
  );
  const defaultPromptEnhanceModelSelection = resolveUtilityModelSelectionDefault(
    DEFAULT_UNIFIED_SETTINGS.promptEnhanceModelSelection,
    serverProviders,
  );
  const promptEnhanceProvider = resolveAppModelSelectionState(
    settings,
    serverProviders,
    settings.promptEnhanceModelSelection,
  ).provider;

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void Promise.all([
      ensureNativeApi().server.refreshProviders(),
      ensureNativeApi().server.refreshUsageStatus(),
    ])
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, []);

  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModelInput = customModelInputByProvider[provider];
      const customModels = settings.providers[provider].customModels;
      const normalized = normalizeModelSlug(customModelInput, provider);
      if (!normalized) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "Enter a model slug.",
        }));
        return;
      }
      if (
        serverProviders
          .find((candidate) => candidate.provider === provider)
          ?.models.some((option) => !option.isCustom && option.slug === normalized)
      ) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That model is already built in.",
        }));
        return;
      }
      if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
        }));
        return;
      }
      if (customModels.includes(normalized)) {
        setCustomModelErrorByProvider((existing) => ({
          ...existing,
          [provider]: "That custom model is already saved.",
        }));
        return;
      }

      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: [...customModels, normalized],
          },
        },
      });
      setCustomModelInputByProvider((existing) => ({
        ...existing,
        [provider]: "",
      }));
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));

      const el = modelListRefs.current[provider];
      if (!el) return;
      const scrollToEnd = () => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      requestAnimationFrame(scrollToEnd);
      const observer = new MutationObserver(() => {
        scrollToEnd();
        observer.disconnect();
      });
      observer.observe(el, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 2_000);
    },
    [customModelInputByProvider, serverProviders, settings, updateSettings],
  );

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: settings.providers[provider].customModels.filter(
              (model) => model !== slug,
            ),
          },
        },
      });
      setCustomModelErrorByProvider((existing) => ({
        ...existing,
        [provider]: null,
      }));
    },
    [settings, updateSettings],
  );

  const providerCards = PROVIDER_SETTINGS.map((providerSettings) => {
    const liveProvider = serverProviders.find(
      (candidate) => candidate.provider === providerSettings.provider,
    );
    const providerConfig = settings.providers[providerSettings.provider];
    const providerUsage =
      providerUsages.find((usage) => usage.provider === providerSettings.provider) ?? null;
    const defaultProviderConfig = DEFAULT_UNIFIED_SETTINGS.providers[providerSettings.provider];
    const statusKey = liveProvider?.status ?? (providerConfig.enabled ? "warning" : "disabled");
    const summary = getProviderSummary(liveProvider);
    const models: ReadonlyArray<ServerProviderModel> =
      liveProvider?.models ??
      providerConfig.customModels.map((slug) => ({
        slug,
        name: slug,
        isCustom: true,
        capabilities: null,
      }));

    return {
      provider: providerSettings.provider,
      title: providerSettings.title,
      binaryPlaceholder: providerSettings.binaryPlaceholder,
      binaryDescription: providerSettings.binaryDescription,
      homePathKey: providerSettings.homePathKey,
      homePlaceholder: providerSettings.homePlaceholder,
      homeDescription: providerSettings.homeDescription,
      binaryPathValue: providerConfig.binaryPath,
      isDirty: !Equal.equals(providerConfig, defaultProviderConfig),
      models,
      providerConfig,
      statusStyle: PROVIDER_STATUS_STYLES[statusKey],
      summary,
      versionLabel: getProviderVersionLabel(liveProvider?.version),
      providerUsage,
      providerUsageMetadata: PROVIDER_USAGE_METADATA[providerSettings.provider],
    };
  });

  const lastCheckedAt =
    serverProviders.length > 0
      ? serverProviders.reduce(
          (latest, provider) => (provider.checkedAt > latest ? provider.checkedAt : latest),
          serverProviders[0]!.checkedAt,
        )
      : null;

  return (
    <SettingsSection
      title="Providers"
      headerAction={
        <div className="flex items-center gap-1.5">
          <ProviderLastChecked lastCheckedAt={lastCheckedAt} />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                  disabled={isRefreshingProviders}
                  onClick={() => void refreshProviders()}
                  aria-label="Refresh provider status and usage"
                >
                  {isRefreshingProviders ? (
                    <LoaderIcon className="size-3 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-3" />
                  )}
                </Button>
              }
            />
            <TooltipPopup side="top">Refresh provider status and usage</TooltipPopup>
          </Tooltip>
        </div>
      }
    >
      {providerCards.map((providerCard) => {
        const customModelInput = customModelInputByProvider[providerCard.provider];
        const customModelError = customModelErrorByProvider[providerCard.provider] ?? null;
        const providerDisplayName =
          PROVIDER_DISPLAY_NAMES[providerCard.provider] ?? providerCard.title;
        const usageSummary =
          providerCard.providerUsage &&
          !shouldHideUsageSummary({
            summary: providerCard.providerUsage.summary,
            planName: providerCard.providerUsage.identity.planName,
            loginMethod: providerCard.providerUsage.identity.loginMethod,
          })
            ? providerCard.providerUsage.summary
            : null;
        const usageDetail = providerCard.providerUsage?.detail ?? null;
        const usageWindows = providerCard.providerUsage?.windows ?? [];
        const claimedWindowKeys = new Set<string>();
        const sessionWindow = takePreferredWindow({
          windows: usageWindows,
          usedKeys: claimedWindowKeys,
          preferredLabel: providerCard.providerUsageMetadata.sessionLabel,
          matcher: isSessionWindow,
        });
        const weeklyWindow = takePreferredWindow({
          windows: usageWindows,
          usedKeys: claimedWindowKeys,
          preferredLabel: providerCard.providerUsageMetadata.weeklyLabel,
          matcher: isWeeklyWindow,
        });
        const usageBarRows = [
          {
            key: "session" as const,
            label: providerCard.providerUsageMetadata.sessionLabel,
            window: sessionWindow,
          },
          {
            key: "weekly" as const,
            label: providerCard.providerUsageMetadata.weeklyLabel,
            window: weeklyWindow,
          },
        ];

        return (
          <div key={providerCard.provider} className="border-t border-border first:border-t-0">
            <div className="px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-h-5 items-center gap-1.5">
                    <span
                      className={cn("size-2 shrink-0 rounded-full", providerCard.statusStyle.dot)}
                    />
                    <h3 className="text-sm font-medium text-foreground">{providerDisplayName}</h3>
                    {providerCard.versionLabel ? (
                      <code className="text-xs text-muted-foreground">
                        {providerCard.versionLabel}
                      </code>
                    ) : null}
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                      {providerCard.isDirty ? (
                        <SettingResetButton
                          label={`${providerDisplayName} provider settings`}
                          onClick={() => {
                            updateSettings({
                              providers: {
                                ...settings.providers,
                                [providerCard.provider]:
                                  DEFAULT_UNIFIED_SETTINGS.providers[providerCard.provider],
                              },
                            });
                            setCustomModelErrorByProvider((existing) => ({
                              ...existing,
                              [providerCard.provider]: null,
                            }));
                          }}
                        />
                      ) : null}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {providerCard.summary.headline}
                    {providerCard.summary.detail ? ` - ${providerCard.summary.detail}` : null}
                  </p>
                  {providerCard.providerUsage ? (
                    <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-foreground/90">
                          {getUsageStatusLabel(providerCard.providerUsage.status)}
                        </span>
                        {providerCard.providerUsage.stale ? (
                          <span className="rounded bg-warning/20 px-1.5 py-0.5 text-warning">
                            Stale
                          </span>
                        ) : null}
                        {providerCard.providerUsage.identity.planName ? (
                          <span>Plan: {providerCard.providerUsage.identity.planName}</span>
                        ) : null}
                        {providerCard.providerUsage.identity.loginMethod ? (
                          <span>Login: {providerCard.providerUsage.identity.loginMethod}</span>
                        ) : null}
                      </div>
                      {usageSummary || usageDetail ? (
                        <p className="mt-1 text-muted-foreground">
                          {usageSummary ?? usageDetail}
                          {usageSummary && usageDetail ? ` - ${usageDetail}` : null}
                        </p>
                      ) : null}
                      <div className="mt-1 grid gap-1 md:grid-cols-2">
                        {usageBarRows.map((row) => {
                          const percentUsed = clampPercent(row.window?.percentUsed ?? null);
                          const percentRemaining = toRemainingPercent(percentUsed);
                          const hasRemaining = percentRemaining !== null;
                          return (
                            <div
                              key={row.key}
                              className="rounded-md border border-border/70 bg-background/15 px-2 py-1.5"
                            >
                              <p className="text-[11px] font-medium text-muted-foreground/90">
                                {getUsageLimitTitle({ key: row.key, label: row.label })}
                              </p>
                              <div className="mt-0.5 flex items-baseline gap-1">
                                <span className="text-2xl font-semibold leading-none text-foreground tabular-nums">
                                  {hasRemaining ? `${Math.round(percentRemaining)}%` : "--"}
                                </span>
                                <span className="text-sm leading-none text-foreground/90">
                                  remaining
                                </span>
                              </div>
                              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/20">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-[width] duration-300",
                                    usageBarToneClass(percentRemaining),
                                  )}
                                  style={{ width: `${percentRemaining ?? 0}%` }}
                                />
                              </div>
                              <p className="mt-1.5 text-[11px] text-muted-foreground/90">
                                {row.window?.resetAt
                                  ? formatUsageResetLabel(row.window.resetAt)
                                  : "Resets unavailable"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2">
                        {providerCard.providerUsageMetadata.usageUrl ? (
                          <a
                            href={providerCard.providerUsageMetadata.usageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            Usage
                          </a>
                        ) : null}
                        {providerCard.providerUsageMetadata.dashboardUrl ? (
                          <a
                            href={providerCard.providerUsageMetadata.dashboardUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            {providerCard.providerUsageMetadata.dashboardLabel ?? "Dashboard"}
                          </a>
                        ) : null}
                        {providerCard.providerUsageMetadata.statusPageUrl ? (
                          <a
                            href={providerCard.providerUsageMetadata.statusPageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary hover:underline"
                          >
                            Status
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setOpenProviderDetails((existing) => ({
                        ...existing,
                        [providerCard.provider]: !existing[providerCard.provider],
                      }))
                    }
                    aria-label={`Toggle ${providerDisplayName} details`}
                  >
                    <ChevronDownIcon
                      className={cn(
                        "size-3.5 transition-transform",
                        openProviderDetails[providerCard.provider] && "rotate-180",
                      )}
                    />
                  </Button>
                  <Switch
                    checked={providerCard.providerConfig.enabled}
                    onCheckedChange={(checked) => {
                      const isDisabling = !checked;
                      const shouldClearModelSelection =
                        isDisabling && textGenProvider === providerCard.provider;
                      const shouldClearPromptEnhanceModelSelection =
                        isDisabling && promptEnhanceProvider === providerCard.provider;
                      updateSettings({
                        providers: {
                          ...settings.providers,
                          [providerCard.provider]: {
                            ...settings.providers[providerCard.provider],
                            enabled: Boolean(checked),
                          },
                        },
                        ...(shouldClearModelSelection
                          ? {
                              textGenerationModelSelection: defaultTextGenerationModelSelection,
                            }
                          : {}),
                        ...(shouldClearPromptEnhanceModelSelection
                          ? {
                              promptEnhanceModelSelection: defaultPromptEnhanceModelSelection,
                            }
                          : {}),
                      });
                    }}
                    aria-label={`Enable ${providerDisplayName}`}
                  />
                </div>
              </div>
            </div>

            <Collapsible
              open={openProviderDetails[providerCard.provider]}
              onOpenChange={(open) =>
                setOpenProviderDetails((existing) => ({
                  ...existing,
                  [providerCard.provider]: open,
                }))
              }
            >
              <CollapsibleContent>
                <div className="space-y-0">
                  <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                    <label
                      htmlFor={`provider-install-${providerCard.provider}-binary-path`}
                      className="block"
                    >
                      <span className="text-xs font-medium text-foreground">
                        {providerDisplayName} binary path
                      </span>
                      <Input
                        id={`provider-install-${providerCard.provider}-binary-path`}
                        className="mt-1.5"
                        value={providerCard.binaryPathValue}
                        onChange={(event) =>
                          updateSettings({
                            providers: {
                              ...settings.providers,
                              [providerCard.provider]: {
                                ...settings.providers[providerCard.provider],
                                binaryPath: event.target.value,
                              },
                            },
                          })
                        }
                        placeholder={providerCard.binaryPlaceholder}
                        spellCheck={false}
                      />
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {providerCard.binaryDescription}
                      </span>
                    </label>
                  </div>

                  {providerCard.homePathKey ? (
                    <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                      <label
                        htmlFor={`provider-install-${providerCard.homePathKey}`}
                        className="block"
                      >
                        <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
                        <Input
                          id={`provider-install-${providerCard.homePathKey}`}
                          className="mt-1.5"
                          value={settings.providers.codex.homePath}
                          onChange={(event) =>
                            updateSettings({
                              providers: {
                                ...settings.providers,
                                codex: {
                                  ...settings.providers.codex,
                                  homePath: event.target.value,
                                },
                              },
                            })
                          }
                          placeholder={providerCard.homePlaceholder}
                          spellCheck={false}
                        />
                        {providerCard.homeDescription ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {providerCard.homeDescription}
                          </span>
                        ) : null}
                      </label>
                    </div>
                  ) : null}

                  <div className="border-t border-border/60 px-4 py-3 sm:px-5">
                    <div className="text-xs font-medium text-foreground">Models</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {providerCard.models.length} model
                      {providerCard.models.length === 1 ? "" : "s"} available.
                    </div>
                    <div
                      ref={(el) => {
                        modelListRefs.current[providerCard.provider] = el;
                      }}
                      className="mt-2 max-h-40 overflow-y-auto pb-1"
                    >
                      {providerCard.models.map((model) => {
                        const caps = model.capabilities;
                        const capLabels: string[] = [];
                        if (caps?.supportsFastMode) capLabels.push("Fast mode");
                        if (caps?.supportsThinkingToggle) capLabels.push("Thinking");
                        if (caps?.reasoningEffortLevels && caps.reasoningEffortLevels.length > 0) {
                          capLabels.push("Reasoning");
                        }
                        const hasDetails = capLabels.length > 0 || model.name !== model.slug;

                        return (
                          <div
                            key={`${providerCard.provider}:${model.slug}`}
                            className="flex items-center gap-2 py-1"
                          >
                            <span className="min-w-0 truncate text-xs text-foreground/90">
                              {model.name}
                            </span>
                            {hasDetails ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      className="shrink-0 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                                      aria-label={`Details for ${model.name}`}
                                    />
                                  }
                                >
                                  <InfoIcon className="size-3" />
                                </TooltipTrigger>
                                <TooltipPopup side="top" className="max-w-56">
                                  <div className="space-y-1">
                                    <code className="block text-[11px] text-foreground">
                                      {model.slug}
                                    </code>
                                    {capLabels.length > 0 ? (
                                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                                        {capLabels.map((label) => (
                                          <span
                                            key={label}
                                            className="text-[10px] text-muted-foreground"
                                          >
                                            {label}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                </TooltipPopup>
                              </Tooltip>
                            ) : null}
                            {model.isCustom ? (
                              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                <span className="text-[10px] text-muted-foreground">custom</span>
                                <button
                                  type="button"
                                  className="text-muted-foreground transition-colors hover:text-foreground"
                                  aria-label={`Remove ${model.slug}`}
                                  onClick={() =>
                                    removeCustomModel(providerCard.provider, model.slug)
                                  }
                                >
                                  <XIcon className="size-3" />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input
                        id={`custom-model-${providerCard.provider}`}
                        value={customModelInput}
                        onChange={(event) => {
                          const value = event.target.value;
                          setCustomModelInputByProvider((existing) => ({
                            ...existing,
                            [providerCard.provider]: value,
                          }));
                          if (customModelError) {
                            setCustomModelErrorByProvider((existing) => ({
                              ...existing,
                              [providerCard.provider]: null,
                            }));
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          addCustomModel(providerCard.provider);
                        }}
                        placeholder={
                          providerCard.provider === "codex"
                            ? "gpt-6.7-codex-ultra-preview"
                            : "claude-sonnet-5-0"
                        }
                        spellCheck={false}
                      />
                      <Button
                        className="shrink-0"
                        variant="outline"
                        onClick={() => addCustomModel(providerCard.provider)}
                      >
                        <PlusIcon className="size-3.5" />
                        Add
                      </Button>
                    </div>

                    {customModelError ? (
                      <p className="mt-2 text-xs text-destructive">{customModelError}</p>
                    ) : null}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </SettingsSection>
  );
}
