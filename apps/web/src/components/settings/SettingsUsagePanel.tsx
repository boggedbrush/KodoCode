import { LoaderIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { PROVIDER_USAGE_METADATA } from "@t3tools/shared/provider-usage";

import { ensureNativeApi } from "../../nativeApi";
import { useProviderUsages } from "../../rpc/providerUsageState";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer } from "./SettingsPanelPrimitives";
import { SettingsProviderUsageSection } from "./SettingsProviderUsageSection";

export function SettingsUsagePanel() {
  const providerUsages = useProviderUsages();
  const [isRefreshingUsage, setIsRefreshingUsage] = useState(false);
  const refreshingRef = useRef(false);

  const refreshUsage = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingUsage(true);
    void ensureNativeApi()
      .server.refreshUsageStatus()
      .catch((error: unknown) => {
        console.warn("Failed to refresh usage", error);
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingUsage(false);
      });
  }, []);

  return (
    <SettingsPageContainer>
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
                  disabled={isRefreshingUsage}
                  onClick={() => void refreshUsage()}
                  aria-label="Refresh usage"
                >
                  {isRefreshingUsage ? (
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
        <div className="space-y-4">
          {providerUsages.map((usage) => {
            const metadata = PROVIDER_USAGE_METADATA[usage.provider];
            const providerDisplayName =
              PROVIDER_DISPLAY_NAMES[usage.provider] ?? metadata.displayName;

            return (
              <section key={usage.provider} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="text-sm font-medium text-foreground">{providerDisplayName}</h3>
                </div>
                <SettingsProviderUsageSection usage={usage} metadata={metadata} />
              </section>
            );
          })}
        </div>
      </section>
    </SettingsPageContainer>
  );
}
