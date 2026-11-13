// Who is asking for a loop. A start carries the thread it came from only when the server put it there:
// an agent's request is stamped with the thread its credential belongs to (a client cannot choose it),
// and a person's own message carries none. So "the caller is running a loop" is read from the server's
// record of that thread and of the threads it runs under, never from anything the caller says.
import type { KodoLoopControl, KodoLoopStatus, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { kodoLoopStartRefusal } from "./loopControl.ts";

interface CallerShell {
  readonly kodoLoopStatus?: { readonly status: KodoLoopStatus } | undefined;
  readonly lineage: { readonly parentThreadId: ThreadId | null };
  readonly delegatedFrom?: { readonly threadId: ThreadId } | undefined;
}

/** How far up the threads a caller runs under are looked at: a subagent of a delegate of a loop's stage is still its stage's. */
const MAX_CALLER_DEPTH = 6;

/**
 * Whether the thread a request came from, or a thread it runs under (the parent it was forked or
 * delegated from), has a loop that is running. Everything such a thread starts is part of that loop.
 */
export const callerRunsLoop = Effect.fn("KodoLoopCaller.callerRunsLoop")(function* <E>(
  getShell: (threadId: ThreadId) => Effect.Effect<CallerShell | null, E>,
  senderThreadId: ThreadId,
) {
  const seen = new Set<ThreadId>();
  let next: ThreadId | null = senderThreadId;
  for (let depth = 0; next !== null && depth < MAX_CALLER_DEPTH && !seen.has(next); depth += 1) {
    seen.add(next);
    const shell: CallerShell | null = yield* getShell(next).pipe(
      Effect.orElseSucceed((): CallerShell | null => null),
    );
    if (shell === null) return false;
    const status = shell.kodoLoopStatus?.status;
    if (status === "active" || status === "held") return true;
    next = shell.lineage.parentThreadId ?? shell.delegatedFrom?.threadId ?? null;
  }
  return false;
});

/** The refusal for a start request, or undefined when it may go ahead. */
export const kodoLoopStartRefusalFor = Effect.fn("KodoLoopCaller.startRefusal")(function* <
  E,
>(input: {
  readonly getShell: (threadId: ThreadId) => Effect.Effect<CallerShell | null, E>;
  readonly control: Extract<KodoLoopControl, { readonly type: "start" }>;
  readonly target:
    | { readonly status: KodoLoopStatus; readonly stopReason?: string | undefined }
    | undefined;
}) {
  const sender = input.control.requestMessage?.senderThreadId;
  return kodoLoopStartRefusal({
    requestedBy: input.control.requestMessage?.createdBy,
    target: input.target,
    callerRunsLoop: sender === undefined ? false : yield* callerRunsLoop(input.getShell, sender),
  });
});
