// Kodo sub-agents, as clients read them: whether a thread leads, which model slot its turns use, and
// whether the switch can be flipped now (and the reason when it cannot). The server makes the same
// decisions with the same reasons in apps/server/src/kodo/delegation; this is only the preview, so a
// switch is never offered that the server would refuse for a reason the client already knows.
import type {
  KodoLead,
  KodoModeModelSlot,
  OrchestrationV2Actor,
  ServerProvider,
} from "@t3tools/contracts";

export const kodoThreadLeads = (
  thread: { readonly kodoLead?: KodoLead | null | undefined } | null | undefined,
): boolean => thread?.kodoLead?.kind === "sub-agents";

/** The model slot a thread's turns read: the Orchestrator slot while it leads (or is the Orchestrator), else the slot of its mode. */
export const kodoThreadModelSlotMode = (thread: {
  readonly kodoLead?: KodoLead | null | undefined;
  readonly interactionMode: unknown;
}): KodoModeModelSlot | unknown =>
  thread.kodoLead != null ? "orchestrator" : thread.interactionMode;

export interface KodoSubAgentsToggle {
  readonly checked: boolean;
  readonly disabled: boolean;
  /** Why it is disabled, for the tooltip; null while it can be flipped. */
  readonly reason: string | null;
}

export function kodoSubAgentsToggle(input: {
  readonly lead: KodoLead | null | undefined;
  /** The provider the thread's own model runs on, as the server lists it. */
  readonly provider: Pick<ServerProvider, "kodoSubAgents"> | undefined;
  /** A turn is running, queued or waiting on an answer. */
  readonly busy: boolean;
  readonly loopRunning: boolean;
  /** The thread is a delegated worker of another thread. */
  readonly isWorker: boolean;
  readonly canOperate: boolean;
  readonly liveWorkers?: number | undefined;
}): KodoSubAgentsToggle {
  const checked = input.lead?.kind === "sub-agents";
  const refuse = (reason: string): KodoSubAgentsToggle => ({ checked, disabled: true, reason });
  if (input.lead?.kind === "swarm") return refuse("The Orchestrator is always read-only.");
  if (!input.canOperate) return refuse("You can't change this thread.");
  if (input.isWorker) return refuse("This thread is a worker, and workers can't lead workers.");
  if (input.busy) return refuse("Available when the current turn finishes.");
  if (input.loopRunning) return refuse("A loop is running on this thread.");
  if ((input.liveWorkers ?? 0) > 0) return refuse("Workers are still running. Stop them first.");
  if (!checked) {
    const support = input.provider?.kodoSubAgents;
    if (support === undefined) {
      return refuse("This server can't tell whether this provider supports sub-agents.");
    }
    if (support.support === "none") {
      return refuse(support.reason ?? "This provider can't receive the delegation tools.");
    }
  }
  return { checked, disabled: false, reason: null };
}

/**
 * The Kodo state a thread must not inherit from the one it was copied from. A child (a worker or a
 * provider's own subagent) is a new thread of its own: it never leads, runs no loop of its own, and
 * its model is the one it was given, not the lead's applied one. Spread over the copy.
 */
export const kodoChildThreadFields = () =>
  ({
    kodoLead: null,
    kodoLoop: undefined,
    kodoModeModel: undefined,
    kodoOrigin: undefined,
  }) as const;

/**
 * The same for a fork. A fork never inherits a loop, and one an agent made never leads (only a
 * person turns sub-agents on); its model selection is copied, so the record of which model is the
 * thread's own stays with it.
 */
export const kodoForkThreadFields = (createdBy: OrchestrationV2Actor) =>
  createdBy === "user"
    ? ({ kodoLoop: undefined, kodoOrigin: undefined } as const)
    : ({ kodoLead: null, kodoLoop: undefined, kodoOrigin: undefined } as const);
