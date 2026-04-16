import { useCallback, useEffect, useSyncExternalStore } from "react";
import { readDesktopBridge } from "../desktopRuntime";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
type ThemeSnapshot = {
  theme: Theme;
  systemDark: boolean;
};

const STORAGE_KEY = "t3code:theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

let listeners: Array<() => void> = [];
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopThemeKey: string | null = null;
let didInitializeTheme = false;
function emitChange() {
  for (const listener of listeners) listener();
}

function getSystemDark(): boolean {
  if (typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(MEDIA_QUERY).matches;
}

function getStored(): Theme {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return "system";
  }

  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function applyTheme(theme: Theme, suppressTransitions = false) {
  if (suppressTransitions) {
    document.documentElement.classList.add("no-transitions");
  }
  const resolvedTheme: ResolvedTheme =
    theme === "dark" || (theme === "system" && getSystemDark()) ? "dark" : "light";
  const isDark = resolvedTheme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  const desktopThemeSync = syncDesktopTheme(theme, resolvedTheme);
  if (theme === "system" && desktopThemeSync) {
    // Electron can start with a stale renderer media query until main applies
    // nativeTheme.themeSource="system". Re-check once that IPC write completes.
    void desktopThemeSync.finally(() => {
      if (getStored() !== "system") {
        return;
      }

      document.documentElement.classList.toggle("dark", getSystemDark());
      emitChange();
    });
  }
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal
    // oxlint-disable-next-line no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

function syncDesktopTheme(theme: Theme, resolvedTheme: ResolvedTheme) {
  const bridge = readDesktopBridge();
  const nextDesktopThemeKey = `${theme}:${resolvedTheme}`;
  if (!bridge || lastDesktopThemeKey === nextDesktopThemeKey) {
    return null;
  }

  lastDesktopThemeKey = nextDesktopThemeKey;
  return bridge.setTheme(theme, { resolvedTheme }).catch(() => {
    if (lastDesktopThemeKey === nextDesktopThemeKey) {
      lastDesktopThemeKey = null;
    }
  });
}

export function initializeThemeFromStorage() {
  if (didInitializeTheme) {
    return;
  }

  didInitializeTheme = true;
  applyTheme(getStored());
}

function getSnapshot(): ThemeSnapshot {
  const theme = getStored();
  const systemDark = theme === "system" ? getSystemDark() : false;

  if (lastSnapshot && lastSnapshot.theme === theme && lastSnapshot.systemDark === systemDark) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, systemDark };
  return lastSnapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);

  // Listen for system preference changes
  const mq = window.matchMedia(MEDIA_QUERY);
  const handleChange = () => {
    if (getStored() === "system") applyTheme("system", true);
    emitChange();
  };
  mq.addEventListener("change", handleChange);

  // Listen for storage changes from other tabs
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      applyTheme(getStored(), true);
      emitChange();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    listeners = listeners.filter((l) => l !== listener);
    mq.removeEventListener("change", handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useTheme() {
  initializeThemeFromStorage();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const theme = snapshot.theme;

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (snapshot.systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next, true);
    emitChange();
  }, []);

  // Keep DOM in sync on mount/change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme, resolvedTheme } as const;
}
