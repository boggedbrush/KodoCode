import { useSyncExternalStore } from "react";

import { registerCommands, registerMenuAction } from "../shortcuts/dispatcher";

let open = false;
const listeners = new Set<() => void>();

export function setKodoShortcutsOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function useKodoShortcutsOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => false,
  );
}

/** The chord, the command palette and the desktop Help menu all open the same overview; the chord also closes it. */
export function startKodoShortcutsWindow(): void {
  registerCommands({
    "shortcuts.open": (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) setKodoShortcutsOpen(!open);
    },
  });
  registerMenuAction("shortcuts.open", () => setKodoShortcutsOpen(true));
}
