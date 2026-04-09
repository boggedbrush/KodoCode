import { createFileRoute } from "@tanstack/react-router";

import { isElectron } from "../env";
import { isLinuxPlatform, isMacPlatform, cn } from "../lib/utils";
import { SidebarTrigger, useSidebar } from "../components/ui/sidebar";
import { SidebarBrandToggleButton } from "../components/SidebarBrandToggleButton";

const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform);

function ChatIndexRouteView() {
  const { open: sidebarOpen } = useSidebar();
  const shouldOffsetForMacTrafficLights =
    isElectron && isMacPlatform(navigator.platform) && !sidebarOpen;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0 md:hidden" />
            <SidebarBrandToggleButton className="hidden md:inline-flex" />
            <span className="text-sm font-medium text-foreground md:hidden">Threads</span>
          </div>
        </header>
      )}

      {isElectron && !isLinuxDesktop && (
        <div
          className={cn(
            "drag-region flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-5 transition-[padding] duration-200 ease-linear",
            shouldOffsetForMacTrafficLights && "pl-[90px]",
          )}
        >
          <SidebarBrandToggleButton />
          <span className="text-xs text-muted-foreground/50">No active thread</span>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <p className="text-sm">Select a thread or create a new one to get started.</p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
