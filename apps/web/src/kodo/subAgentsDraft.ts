import { useSyncExternalStore } from "react";

// The sub-agents choice of a thread that does not exist yet, by draft thread key. The first send
// carries it to the server (thread.create); until then it is only this browser's. A key with no entry
// means "no choice made": the draft then shows the project's default and sends nothing, so the server
// applies the same default itself.
const choices = new Map<string, boolean>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getKodoDraftSubAgents = (threadKey: string): boolean | undefined =>
  choices.get(threadKey);

export function setKodoDraftSubAgents(threadKey: string, on: boolean): void {
  choices.set(threadKey, on);
  notify();
}

export function clearKodoDraftSubAgents(threadKey: string): void {
  if (choices.delete(threadKey)) notify();
}

export const useKodoDraftSubAgents = (threadKey: string): boolean | undefined =>
  useSyncExternalStore(
    subscribe,
    () => choices.get(threadKey),
    () => undefined,
  );
