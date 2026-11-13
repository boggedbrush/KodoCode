// Sub-agents as the composer reads them: the workers still running, the label for the lead's model,
// and the one registry the palette and the keybinding use to flip the switch of the thread on screen.
import type { OrchestrationV2Subagent } from "@t3tools/contracts";

const LIVE_WORKER_STATUSES: ReadonlySet<OrchestrationV2Subagent["status"]> = new Set([
  "pending",
  "running",
  "waiting",
]);

/** Workers (delegated tasks, not a provider's own subagents) that have not finished. */
export function kodoRunningWorkers(
  subagents: ReadonlyArray<Pick<OrchestrationV2Subagent, "origin" | "status" | "childThreadId">>,
): number {
  const children = new Set<string>();
  for (const task of subagents) {
    if (task.origin !== "app_owned" || !LIVE_WORKER_STATUSES.has(task.status)) continue;
    // A follow-up task reuses its worker's thread: one worker, one count.
    children.add(task.childThreadId ?? `task:${children.size}`);
  }
  return children.size;
}

export const KODO_SUB_AGENTS_MODEL_LABEL = "Lead model";

export function kodoWorkersBannerTitle(running: number): string {
  return running === 1 ? "1 worker running" : `${running} workers running`;
}

const togglers = new Set<() => void>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/** A mounted composer registers what flips its thread's switch; the latest one wins. */
export function registerKodoSubAgentsToggle(toggle: () => void): () => void {
  togglers.add(toggle);
  notify();
  return () => {
    togglers.delete(toggle);
    notify();
  };
}

/** Flips the switch of the thread on screen; false when no composer can be asked. */
export function requestKodoSubAgentsToggle(): boolean {
  const latest = [...togglers].at(-1);
  if (latest === undefined) return false;
  latest();
  return true;
}

export const subscribeKodoSubAgentsToggle = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const hasKodoSubAgentsToggle = () => togglers.size > 0;
