import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { PROVIDER_USAGE_METADATA } from "@t3tools/shared/provider-usage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getProviderStartOptions, useAppSettings } from "../../appSettings";
import { serverQueryKeys, serverUsageQueryOptions } from "../../lib/serverReactQuery";
import { LoaderIcon, RefreshCwIcon } from "../../lib/icons";
import { ensureNativeApi } from "../../nativeApi";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsProviderUsageSection } from "./SettingsProviderUsageSection";

export function SettingsUsagePanel() {
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const providerOptions = getProviderStartOptions(settings);
  const providerUsagesQuery = useQuery(serverUsageQueryOptions(providerOptions));

  const refreshUsageMutation = useMutation({
    mutationFn: async () =>
      ensureNativeApi().server.refreshUsageStatus({
        ...(providerOptions ? { providerOptions } : {}),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(serverQueryKeys.usage(providerOptions ?? null), data);
    },
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Usage
        </h2>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                disabled={refreshUsageMutation.isPending}
                onClick={() => refreshUsageMutation.mutate()}
                aria-label="Refresh usage"
              >
                {refreshUsageMutation.isPending ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <RefreshCwIcon className="size-3" />
                )}
              </Button>
            }
          />
          <TooltipPopup side="top">Refresh usage</TooltipPopup>
        </Tooltip>
      </div>
      {providerUsagesQuery.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-muted-foreground">
          Failed to load usage. Try refreshing.
        </div>
      ) : null}
      <div className="space-y-4">
        {(providerUsagesQuery.data ?? []).map((usage) => {
          const metadata = PROVIDER_USAGE_METADATA[usage.provider];
          if (!metadata) {
            return null;
          }
          return (
            <section key={usage.provider} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-medium text-foreground">
                  {PROVIDER_DISPLAY_NAMES[usage.provider] ?? metadata.displayName}
                </h3>
              </div>
              <SettingsProviderUsageSection usage={usage} metadata={metadata} />
            </section>
          );
        })}
        {providerUsagesQuery.isLoading ? (
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            Loading usage…
          </div>
        ) : null}
      </div>
    </section>
  );
}
