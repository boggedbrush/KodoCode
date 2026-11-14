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

// The "Needs you" inbox: one popover, opened from the pinned row, the palette or a keybinding. Whether
// it is open lives here so all three reach the same one; it can open only while a row hosts it.
const inboxHosts = new Set<symbol>();
const inboxListeners = new Set<() => void>();
let inboxOpen = false;
const notifyInbox = () => {
  for (const listener of inboxListeners) listener();
};

/** The row that hosts the inbox registers it while mounted. */
export function registerKodoInboxHost(): () => void {
  const host = Symbol("kodo-inbox-host");
  inboxHosts.add(host);
  notifyInbox();
  return () => {
    inboxHosts.delete(host);
    if (inboxHosts.size === 0) inboxOpen = false;
    notifyInbox();
  };
}

export function setKodoInboxOpen(open: boolean): void {
  const next = open && inboxHosts.size > 0;
  if (next === inboxOpen) return;
  inboxOpen = next;
  notifyInbox();
}

/** Opens the inbox; false when no row hosts it (the Orchestrator is off, or the sidebar is closed). */
export function requestKodoInboxOpen(): boolean {
  if (inboxHosts.size === 0) return false;
  setKodoInboxOpen(true);
  return true;
}

export const subscribeKodoInbox = (listener: () => void) => {
  inboxListeners.add(listener);
  return () => {
    inboxListeners.delete(listener);
  };
};
export const getKodoInboxOpen = () => inboxOpen;
export const hasKodoInboxHost = () => inboxHosts.size > 0;
