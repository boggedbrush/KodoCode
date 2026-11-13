// The Orchestrator has its own pinned row, so its thread and its project stay out of every ordinary
// list (the workers it starts are listed in their own projects). Both have fixed ids, which says what they are from a ref alone: no shell has to be read, so
// streaming ticks cost nothing here and the keys only change when a thread or project is added.
import {
  isKodoOrchestratorProjectId,
  isKodoOrchestratorThreadId,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";

import { threadKey } from "./entities.ts";

const NONE: ReadonlySet<string> = new Set();

/** `hidden` plus the keys of every Orchestrator thread in `refs`; `hidden` itself when there is none. */
export function withKodoOrchestratorHidden(
  hidden: ReadonlySet<string>,
  refs: ReadonlyArray<ScopedThreadRef>,
  previous: ReadonlySet<string> = NONE,
): ReadonlySet<string> {
  const orchestrator = refs.filter((ref) => isKodoOrchestratorThreadId(ref.threadId));
  if (orchestrator.length === 0) return hidden;
  const next = new Set(hidden);
  for (const ref of orchestrator) next.add(threadKey(ref));
  return next.size === previous.size && [...next].every((key) => previous.has(key))
    ? previous
    : next;
}

export const isKodoOrchestratorProjectRef = (ref: Pick<ScopedProjectRef, "projectId">): boolean =>
  isKodoOrchestratorProjectId(ref.projectId);
