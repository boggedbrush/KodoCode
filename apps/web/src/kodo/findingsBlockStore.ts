import { useSyncExternalStore } from "react";

// The replies whose raw `kodo-review` block a findings card replaces. An external store, so the
// timeline rows can read it without the card's owner threading a prop through the timeline.
const replaced = new Set<string>();
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

/** Marks a reply as replaced by a card; the returned function undoes it. */
export function registerKodoFindingsBlock(messageId: string): () => void {
  replaced.add(messageId);
  notify();
  return () => {
    replaced.delete(messageId);
    notify();
  };
}

/** Whether the timeline should leave the raw review block out of this message. */
export const useKodoFindingsReplacesBlock = (messageId: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => replaced.has(messageId),
    () => false,
  );
