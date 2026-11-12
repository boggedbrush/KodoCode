// Which domain events can change what a loop does next. Streaming text is not one of them: a reply
// only matters once it is final, and a plan only once it is no longer a draft.
import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";

export const affectsLoop = (event: OrchestrationV2DomainEvent): boolean => {
  switch (event.type) {
    // Loop state itself and the thread's mode; every other thread event is the thread's own business.
    case "thread.metadata-updated":
    case "thread.interaction-mode-updated":
    case "thread.deleted":
    // Run lifecycle, and a stage waiting on a request.
    case "run.created":
    case "run.updated":
    case "runtime-request.updated":
      return true;
    // A reply settling, as opposed to growing.
    case "message.updated":
      return event.payload.role === "assistant" && !event.payload.streaming;
    case "plan.updated":
      return event.payload.status !== "draft";
    // A failed run's error, which says whether a usage limit ended it.
    case "turn-item.updated":
      return event.payload.type === "error";
    default:
      return false;
  }
};

/** A loop (or the clean-up an ended one still owes) is something to keep looking at. */
export const isTrackedLoopEvent = (event: OrchestrationV2DomainEvent): boolean =>
  event.type === "thread.metadata-updated" &&
  event.payload.kodoLoop !== undefined &&
  (event.payload.kodoLoop.status === "active" ||
    event.payload.kodoLoop.status === "held" ||
    event.payload.kodoLoop.cleanup !== undefined);
