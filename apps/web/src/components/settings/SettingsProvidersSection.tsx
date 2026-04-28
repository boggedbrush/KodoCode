import { ChevronDownIcon, InfoIcon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import { normalizeModelSlug, resolveUtilityModelSelectionDefault } from "@t3tools/shared/model";
import { Equal } from "effect";

import { cn } from "../../lib/utils";
import { MAX_CUSTOM_MODEL_LENGTH, resolveAppModelSelectionState } from "../../modelSelection";
import { ensureNativeApi } from "../../nativeApi";
import { useServerProviders } from "../../rpc/serverState";
import { formatRelativeTime } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingResetButton, SettingsSection } from "./SettingsPanelPrimitives";
import { PROVIDER_SETTINGS } from "./settingsProviderConfig";

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
  const modelListRefs = useRef<Partial<Record<ProviderKind, HTMLDivElement | null>>>({});
  const serverProviders = useServerProviders();

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
    void ensureNativeApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
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
                  onClick={() => void refreshProviders()}
                  aria-label="Refresh provider status"
                >
                  <RefreshCwIcon className="size-3" />
                </Button>
              }
            />
            <TooltipPopup side="top">Refresh provider status</TooltipPopup>
          </Tooltip>
        </div>
      }
    >
      {providerCards.map((providerCard) => {
        const customModelInput = customModelInputByProvider[providerCard.provider];
        const customModelError = customModelErrorByProvider[providerCard.provider] ?? null;
        const providerDisplayName =
          PROVIDER_DISPLAY_NAMES[providerCard.provider] ?? providerCard.title;

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
