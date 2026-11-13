import type { KodoGnomeAccent } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { accentFill, resolveSystemAccent } from "./systemAccent.logic";

// A per-viewer convenience: the desktop app is its own origin, so this stays on this machine.
const FOLLOW_STORAGE_KEY = "kodo:follow-system-accent";

let systemAccent: KodoGnomeAccent | null = null;
let follow = true;
const listeners = new Set<() => void>();

function readFollow(): boolean {
  try {
    return window.localStorage.getItem(FOLLOW_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

// The stylesheet (kodo-gnome.css) maps these onto the theme's accent roles, so a theme change needs
// no repaint of the roles: only whether the system accent applies is decided here.
function apply() {
  const root = document.documentElement;
  const accent = resolveSystemAccent({ themeId: root.dataset.themeId, follow, systemAccent });
  if (accent === null) {
    delete root.dataset.kodoSystemAccent;
    root.style.removeProperty("--kodo-accent-fill");
    root.style.removeProperty("--kodo-accent-text");
  } else {
    const { fill, text } = accentFill(accent);
    root.dataset.kodoSystemAccent = accent;
    root.style.setProperty("--kodo-accent-fill", fill);
    root.style.setProperty("--kodo-accent-text", text);
  }
  for (const listener of listeners) listener();
}

/** Follows the desktop's accent colour on the Linux desktop app while the Kodo theme is in use. */
export function startKodoSystemAccent(): void {
  const bridge = window.desktopBridge?.kodoLinuxDesktop;
  if (bridge === undefined) return;
  follow = readFollow();
  systemAccent = bridge.getSystemAccent();
  bridge.onSystemAccent((accent) => {
    systemAccent = accent;
    apply();
  });
  // Picking another theme or editing the palette is an explicit accent choice; the attribute says which theme paints.
  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-id"],
  });
  apply();
}

export function setFollowSystemAccent(next: boolean): void {
  follow = next;
  try {
    if (next) window.localStorage.removeItem(FOLLOW_STORAGE_KEY);
    else window.localStorage.setItem(FOLLOW_STORAGE_KEY, "off");
  } catch {
    // The choice holds for this session.
  }
  apply();
}

export function useFollowSystemAccent(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => follow,
    () => true,
  );
}
