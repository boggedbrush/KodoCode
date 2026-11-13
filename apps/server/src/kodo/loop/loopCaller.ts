// Who is asking for a loop. A start carries the thread it came from only when the server put it there:
// an agent's request is stamped with the thread its credential belongs to (a client cannot choose it),
// and a person's own message carries none. So "the caller is running a loop" is read from the server's
// record of that thread and of the threads it runs under, never from anything the caller says.
import type { KodoLoopControl, KodoLoopStatus, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { KODO_WORKER_DEPTH_REFUSAL } from "../delegation/limits.ts"; // KODO: delegation-loop
import { kodoThreadUnderLead } from "../delegation/leadGuard.ts"; // KODO: delegation-loop
import { kodoLoopStartRefusal } from "./loopControl.ts";

interface CallerShell {
  readonly kodoLoopStatus?: { readonly status: KodoLoopStatus } | undefined;
  readonly kodoLead?: { readonly kind: string } | null | undefined;
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
  E extends { readonly _tag: string },
>(input: {
  readonly getShell: (threadId: ThreadId) => Effect.Effect<CallerShell | null, E>;
  readonly control: Extract<KodoLoopControl, { readonly type: "start" }>;
  readonly target:
    | { readonly status: KodoLoopStatus; readonly stopReason?: string | undefined }
    | undefined;
  /** The thread the loop would run on, when it leads sub-agents. */
  readonly targetLead?: { readonly kind: string } | null | undefined;
}) {
  const sender = input.control.requestMessage?.senderThreadId;
  // KODO: delegation-loop - a lead delegates; a loop would run its stages without that
  if (input.targetLead?.kind === "sub-agents") {
    return "This thread delegates to sub-agents, and a loop would run its stages without that. Turn sub-agents off first, or start the loop on another thread.";
  }
  // KODO: delegation-loop - a worker does not start loops
  if (
    sender !== undefined &&
    // A read that fails counts as a worker: an unverified caller does not start a loop.
    (yield* kodoThreadUnderLead(input.getShell, sender).pipe(Effect.orElseSucceed(() => true)))
  ) {
    return KODO_WORKER_DEPTH_REFUSAL;
  }
  return kodoLoopStartRefusal({
    requestedBy: input.control.requestMessage?.createdBy,
    target: input.target,
    callerRunsLoop: sender === undefined ? false : yield* callerRunsLoop(input.getShell, sender),
  });
});
