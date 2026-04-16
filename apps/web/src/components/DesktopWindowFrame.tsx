import { useEffect, useMemo, useState, type ReactNode } from "react";

import { isElectron } from "../env";
import { cn, isLinuxPlatform, usesCustomDesktopTitlebar } from "../lib/utils";
import {
  DesktopWindowFrameContext,
  type DesktopWindowFrameContextValue,
} from "./desktopWindowFrameState";
import { SidebarProvider } from "./ui/sidebar";

const LINUX_WINDOW_CORNER_RADIUS_PX = 12;
const SIDEBAR_LAYOUT_CLASS_NAME = "h-dvh min-h-0";
const CUSTOM_TITLEBAR_SIDEBAR_LAYOUT_CLASS_NAME = "min-h-0 flex-1";

export function DesktopWindowFrame({ children }: { children: ReactNode }) {
  const hasCustomTitlebar = isElectron && usesCustomDesktopTitlebar(navigator.platform);
  const isLinuxDesktop = hasCustomTitlebar && isLinuxPlatform(navigator.platform);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!hasCustomTitlebar) return;

    const bridge = window.desktopBridge;
    if (!bridge) return;

    void bridge.windowControls.isMaximized().then(setIsMaximized);
    return bridge.windowControls.onMaximizedChange(setIsMaximized);
  }, [hasCustomTitlebar]);

  useEffect(() => {
    const html = document.documentElement;
    if (!isLinuxDesktop) {
      html.removeAttribute("data-desktop-window-frame");
      html.style.setProperty("--desktop-window-safe-inset", "0px");
      html.style.setProperty("--desktop-window-corner-radius", "0px");
      return;
    }

    html.setAttribute("data-desktop-window-frame", "linux-rounded");
    html.style.setProperty("--desktop-window-safe-inset", "0px");
    html.style.setProperty(
      "--desktop-window-corner-radius",
      `${isMaximized ? 0 : LINUX_WINDOW_CORNER_RADIUS_PX}px`,
    );
    return () => {
      html.removeAttribute("data-desktop-window-frame");
      html.style.setProperty("--desktop-window-safe-inset", "0px");
      html.style.setProperty("--desktop-window-corner-radius", "0px");
    };
  }, [isLinuxDesktop, isMaximized]);

  const contextValue = useMemo(
    () =>
      ({
        hasCustomTitlebar,
        isMaximized,
      }) satisfies DesktopWindowFrameContextValue,
    [hasCustomTitlebar, isMaximized],
  );

  const frameChildren = !isLinuxDesktop ? (
    children
  ) : (
    <div className="h-full w-full overflow-hidden bg-transparent">
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
        style={{ borderRadius: "var(--desktop-window-corner-radius)" }}
      >
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );

  return (
    <DesktopWindowFrameContext.Provider value={contextValue}>
      <SidebarProvider
        defaultOpen
        className={cn(
          SIDEBAR_LAYOUT_CLASS_NAME,
          hasCustomTitlebar && CUSTOM_TITLEBAR_SIDEBAR_LAYOUT_CLASS_NAME,
        )}
      >
        {frameChildren}
      </SidebarProvider>
    </DesktopWindowFrameContext.Provider>
  );
}
