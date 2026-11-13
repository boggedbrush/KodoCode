// The Orchestrator's pinned row, as the thread list and the palette read it: which of three states its
// dot is in, and the one registry through which the palette, the keybinding and the collapsed dot open
// it. The dot is a static colour that changes only when the state does, never an animation.
import type { KodoOrchestratorState } from "@t3tools/shared/kodoOrchestrator";

/** The dot's colour per state: the same hues the thread rows use, with no pulse. */
export const KODO_ORCHESTRATOR_DOT_CLASS: Readonly<Record<KodoOrchestratorState, string>> = {
  idle: "bg-sidebar-muted-foreground/40",
  working: "bg-sky-500 dark:bg-sky-300/80",
  "needs-you": "bg-amber-500 dark:bg-amber-300/90",
};

const openers = new Set<() => void>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** A mounted opener registers what opens the Orchestrator; the latest one wins. */
export function registerKodoOrchestratorOpen(open: () => void): () => void {
  openers.add(open);
  notify();
  return () => {
    openers.delete(open);
    notify();
  };
}

/** Opens the Orchestrator conversation; false when nothing can (it is off, or no environment). */
export function requestKodoOrchestratorOpen(): boolean {
  const latest = [...openers].at(-1);
  if (latest === undefined) return false;
  latest();
  return true;
}

export const subscribeKodoOrchestratorOpen = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const hasKodoOrchestratorOpen = () => openers.size > 0;
