// "Review" on a turn's changed-files card: switches the thread to Review mode and puts a request to
// review that turn's changes in the composer. The chat view of the thread registers what does it; the
// card asks through here, so it needs none of the thread's state. A person still presses send.

/** What the composer is given: the request names the turn, so a later turn's review is not confused with it. */
export const kodoReviewPrompt = (): string => "Review the changes from this turn.";

/** Whether the thread offers Review: not a worker or the Orchestrator, nothing running, and a thread a person can act on. */
export function kodoReviewOffered(input: {
  readonly isServerThread: boolean;
  readonly canOperateThread: boolean;
  readonly isWorker: boolean;
  readonly isOrchestrator: boolean;
  readonly isSendBusy: boolean;
  readonly modeLocked: boolean;
}): boolean {
  return (
    input.isServerThread &&
    input.canOperateThread &&
    !input.isWorker &&
    !input.isOrchestrator &&
    !input.isSendBusy &&
    !input.modeLocked
  );
}

const openers = new Map<string, () => void>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function registerKodoReviewRequest(threadKey: string, open: () => void): () => void {
  openers.set(threadKey, open);
  notify();
  return () => {
    if (openers.get(threadKey) === open) openers.delete(threadKey);
    notify();
  };
}

/** Starts a review request for the thread; false when it offers none. */
export function requestKodoReview(threadKey: string): boolean {
  const open = openers.get(threadKey);
  if (open === undefined) return false;
  open();
  return true;
}

export const subscribeKodoReviewRequest = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const hasKodoReviewRequest = (threadKey: string) => openers.has(threadKey);
