import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useAtomValue } from "@effect/atom-react";
import { kodoNeedsYouItems, type KodoNeedsYouItem } from "@t3tools/shared/kodoOrchestrator";
import { Atom } from "effect/reactivity";

import { environmentThreadShells } from "../state/threads";

const NONE: ReadonlyArray<KodoNeedsYouItem> = Object.freeze([]);
const NO_ITEMS_ATOM = Atom.make(NONE);

const sameItems = (a: ReadonlyArray<KodoNeedsYouItem>, b: ReadonlyArray<KodoNeedsYouItem>) =>
  a.length === b.length &&
  a.every((item, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      item.threadId === other.threadId &&
      item.title === other.title &&
      item.kind === other.kind &&
      item.role === other.role &&
      item.leadTitle === other.leadTitle &&
      item.quietSince === other.quietSince
    );
  });

/**
 * What waits on the person, from the quiet thread shells this client already holds (they do not move
 * while a run streams) and the Orchestrator's own, which is hidden from lists. One pass when a shell's
 * status changes, and the same array back when nothing in it changed.
 */
const needsYouAtom = Atom.family((key: string) => {
  const separator = key.indexOf("\u0000");
  const environmentId = key.slice(0, separator) as EnvironmentId;
  const orchestratorThreadId = key.slice(separator + 1);
  let previous = NONE;
  return Atom.make((get) => {
    const shells = get(environmentThreadShells.quietThreadShellsAtom).filter(
      (shell) => shell.environmentId === environmentId,
    );
    const own =
      orchestratorThreadId === ""
        ? null
        : get(
            environmentThreadShells.quietThreadShellAtom(
              scopeThreadRef(environmentId, orchestratorThreadId as ThreadId),
            ),
          );
    const next = kodoNeedsYouItems(
      own === null ? shells : [own, ...shells],
      orchestratorThreadId === "" ? undefined : orchestratorThreadId,
    );
    if (sameItems(previous, next)) return previous;
    previous = next.length === 0 ? NONE : next;
    return previous;
  }).pipe(Atom.withLabel(`kodo-needs-you:${key}`));
});

export function useKodoNeedsYouItems(
  environmentId: EnvironmentId | null,
  orchestratorThreadId: ThreadId | undefined,
): ReadonlyArray<KodoNeedsYouItem> {
  return useAtomValue(
    environmentId === null
      ? NO_ITEMS_ATOM
      : needsYouAtom(`${environmentId}\u0000${orchestratorThreadId ?? ""}`),
  );
}

const quietWorkersAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const separator = key.indexOf("\u0000");
    const environmentId = key.slice(0, separator);
    const leadThreadId = key.slice(separator + 1);
    let count = 0;
    for (const shell of get(environmentThreadShells.quietThreadShellsAtom)) {
      if (
        shell.environmentId === environmentId &&
        shell.kodoQuiet !== undefined &&
        shell.lineage.relationshipToParent === "subagent" &&
        shell.lineage.parentThreadId === leadThreadId
      ) {
        count += 1;
      }
    }
    return count;
  }).pipe(Atom.withLabel(`kodo-quiet-workers:${key}`)),
);
const NO_QUIET_ATOM = Atom.make(0);

/** How many of a lead's workers the server's watchdog finds quiet: a number, so it moves only when that does. */
export function useKodoQuietWorkerCount(
  environmentId: EnvironmentId,
  leadThreadId: ThreadId | null,
): number {
  return useAtomValue(
    leadThreadId === null
      ? NO_QUIET_ATOM
      : quietWorkersAtom(`${environmentId}\u0000${leadThreadId}`),
  );
}
