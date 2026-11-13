// Turns a request to switch sub-agents on or off into the thread's next lead state, or says why it
// cannot. Pure: every route that sets the flag is judged by these rules. Who is asking is never read
// from the request: the transport stamps `createdBy` and `senderThreadId` (a client's own values are
// overwritten in `withCreationProvenance`), and the agent route builds them from its credential.
import type { KodoLead, OrchestrationV2Actor, ThreadId } from "@t3tools/contracts";

import { kodoInteractionModeRank } from "../interactionMode.ts";

export type KodoLeadSetResult =
  | { readonly ok: true; readonly lead: KodoLead | null }
  | { readonly ok: false; readonly message: string };

const refuse = (message: string): KodoLeadSetResult => ({ ok: false, message });

export interface KodoLeadSetInput {
  readonly requested: KodoLead | null;
  readonly thread: {
    readonly id: ThreadId;
    readonly interactionMode: unknown;
    readonly loopStatus?: string | undefined;
  };
  /** A turn, queued run or pending request is unfinished on the thread. */
  readonly busy: boolean;
  readonly liveWorkers: number;
  /** The thread runs under a lead (it is a worker). */
  readonly underLead: boolean;
  /** Why the thread's provider cannot lead, when it cannot. */
  readonly supportRefusal: string | undefined;
  readonly actor: {
    readonly createdBy: OrchestrationV2Actor;
    readonly senderThreadId?: ThreadId | undefined;
    /** The sender is the target thread or a thread it runs under. */
    readonly senderIsTargetOrAncestor: boolean;
  };
  /** The mode ceiling of an agent caller (DispatchModeLimit), when there is one. */
  readonly limit?: { readonly interactionMode: unknown } | undefined;
}

export function decideKodoLeadSet(input: KodoLeadSetInput): KodoLeadSetResult {
  const { requested, thread, actor } = input;
  if (requested !== null && requested.kind !== "sub-agents") {
    return refuse("Only sub-agents can be turned on for a thread in this version.");
  }
  if (actor.createdBy !== "user") {
    if (actor.senderThreadId === undefined || actor.senderIsTargetOrAncestor) {
      return refuse(
        "An agent cannot change sub-agents for its own thread or for the lead it works for. Ask the person to use the Sub-agents switch.",
      );
    }
    if (
      input.limit !== undefined &&
      kodoInteractionModeRank(input.limit.interactionMode) < kodoInteractionModeRank("code")
    ) {
      return refuse(
        "This sender is in a read-only mode (Ask, Plan or Review), and sub-agents change what a thread spends and starts, so it cannot change them.",
      );
    }
  }
  if (input.busy) {
    return refuse(
      "A turn is running on this thread. Turn sub-agents on or off when it finishes, or stop it first.",
    );
  }
  if (thread.loopStatus === "active" || thread.loopStatus === "held") {
    return refuse("A loop is running on this thread. Stop it before changing sub-agents.");
  }
  if (input.liveWorkers > 0) {
    return refuse(
      `${input.liveWorkers} ${input.liveWorkers === 1 ? "worker is" : "workers are"} still running. Use Stop workers first, then change sub-agents.`,
    );
  }
  if (requested === null) return { ok: true, lead: null };
  if (input.underLead) {
    return refuse(
      "This thread is a worker of a lead, and workers cannot lead workers of their own.",
    );
  }
  if (input.supportRefusal !== undefined) return refuse(input.supportRefusal);
  return { ok: true, lead: requested };
}

/** Why a new thread cannot start as a lead, or undefined. A creator that is not a person never can. */
export function kodoLeadCreateRefusal(input: {
  readonly createdBy: OrchestrationV2Actor;
  readonly supportRefusal: string | undefined;
}): string | undefined {
  if (input.createdBy !== "user") return "Only a person starts a thread with sub-agents on.";
  return input.supportRefusal;
}
