import type { KodoWindowChromeState } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { windowControlsWidth, windowStateName } from "./windowChrome.logic";

let current: KodoWindowChromeState | null = null;
const listeners = new Set<() => void>();

function apply(next: KodoWindowChromeState | null) {
  current = next;
  const root = document.documentElement;
  if (next === null) {
    delete root.dataset.kodoWindowChrome;
    delete root.dataset.kodoWindowState;
  } else {
    root.dataset.kodoWindowChrome = "custom";
    root.dataset.kodoWindowState = windowStateName(next);
    root.style.setProperty("--kodo-controls-left", `${windowControlsWidth(next.left.length)}px`);
    root.style.setProperty("--kodo-controls-right", `${windowControlsWidth(next.right.length)}px`);
    // The headers reserve room for window controls under this class, whoever draws them.
    root.classList.add("wco");
  }
  for (const listener of listeners) listener();
}

/**
 * The Linux desktop window has no system frame when it draws its own header buttons. The state
 * arrives once and then only when the window maximizes, enters fullscreen or GNOME's layout
 * changes. Run after the window-controls-overlay class has been synced.
 */
export function startKodoWindowChrome(): void {
  const bridge = window.desktopBridge?.kodoLinuxDesktop;
  if (bridge === undefined) return;
  apply(bridge.getWindowChrome());
  bridge.onWindowChrome(apply);
}

export function useKodoWindowChrome(): KodoWindowChromeState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}
