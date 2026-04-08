import { useEffect, useMemo, useState, type ReactNode } from "react";

import { isElectron } from "../env";
import { isLinuxPlatform } from "../lib/utils";
import { LinuxTitleBar } from "./LinuxTitleBar";
import {
  DesktopWindowFrameContext,
  type DesktopWindowFrameContextValue,
} from "./desktopWindowFrameState";

const LINUX_WINDOW_CORNER_RADIUS_PX = 12;

export function DesktopWindowFrame({ children }: { children: ReactNode }) {
  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isLinuxDesktop) return;

    const bridge = window.desktopBridge;
    if (!bridge) return;

    void bridge.windowControls.isMaximized().then(setIsMaximized);
    return bridge.windowControls.onMaximizedChange(setIsMaximized);
  }, [isLinuxDesktop]);

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
        isLinuxDesktop,
        isMaximized,
      }) satisfies DesktopWindowFrameContextValue,
    [isLinuxDesktop, isMaximized],
  );

  if (!isLinuxDesktop) {
    return (
      <DesktopWindowFrameContext.Provider value={contextValue}>
        {children}
      </DesktopWindowFrameContext.Provider>
    );
  }

  return (
    <DesktopWindowFrameContext.Provider value={contextValue}>
      <div className="h-screen w-screen overflow-hidden bg-transparent">
        <div
          className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
          style={{ borderRadius: "var(--desktop-window-corner-radius)" }}
        >
          <LinuxTitleBar />
          <div className="flex min-h-0 flex-1">{children}</div>
        </div>
      </div>
    </DesktopWindowFrameContext.Provider>
  );
}
