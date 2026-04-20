import { useEffect, useMemo, useState } from "react";

import { isElectron } from "../env";
import { usesCustomDesktopTitlebar } from "../lib/utils";
import { DesktopTitleBar } from "./DesktopTitleBar";
import { DesktopWindowFrameProvider } from "./desktopWindowFrameState";

function readCustomTitlebarSupport(): boolean {
  if (!isElectron || typeof navigator === "undefined") {
    return false;
  }
  return usesCustomDesktopTitlebar(navigator.platform);
}

export function DesktopWindowFrame({ children }: { children: React.ReactNode }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const hasCustomTitlebar = readCustomTitlebarSupport();

  useEffect(() => {
    if (!hasCustomTitlebar) {
      setIsMaximized(false);
      return;
    }

    let disposed = false;
    void window.desktopBridge?.windowControls?.isMaximized().then((value) => {
      if (!disposed) {
        setIsMaximized(value);
      }
    });

    const unsubscribe = window.desktopBridge?.windowControls?.onMaximizedChange((value) => {
      setIsMaximized(value);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [hasCustomTitlebar]);

  const frameState = useMemo(
    () => ({
      hasCustomTitlebar,
      isMaximized,
    }),
    [hasCustomTitlebar, isMaximized],
  );

  return (
    <DesktopWindowFrameProvider value={frameState}>
      <div className="flex min-h-svh w-full flex-col">
        {hasCustomTitlebar ? <DesktopTitleBar /> : null}
        <div className="flex min-h-0 flex-1">{children}</div>
      </div>
    </DesktopWindowFrameProvider>
  );
}
