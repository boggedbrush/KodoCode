// What a lead and its workers have spent, kept per lead for the per-message usage line, which sits on
// the path before a provider receives a message and so must not read every worker's turns each time.
// A figure is read once; after that it is served as held and read again in the background when a
// provider turn of the lead or one of its workers ends, or a worker is added or settles.
import type { KodoDelegationUsage, OrchestrationV2DomainEvent, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

const TURN_ENDED = new Set(["completed", "interrupted", "failed", "cancelled"]);

/** Leads remembered: a person has a handful (the Orchestrator and a few sub-agent leads). */
const MAX_LEADS = 32;

export interface KodoLeadSpendRead {
  readonly usage: KodoDelegationUsage;
  /** The lead and the workers the figure covers: a turn ending on any of them changes it. */
  readonly threadIds: ReadonlyArray<ThreadId>;
}

export const makeKodoLeadSpendCache = (deps: {
  readonly read: (leadId: ThreadId) => Effect.Effect<KodoLeadSpendRead | undefined>;
}) => {
  const entries = new Map<
    ThreadId,
    { readonly usage: KodoDelegationUsage; readonly threadIds: ReadonlySet<ThreadId> }
  >();
  const refreshing = new Set<ThreadId>();
  const running = new Set<Fiber.Fiber<void>>();
  const changedWhileRefreshing = new Set<ThreadId>();

  const load = Effect.fn("KodoLeadSpendCache.load")(function* (leadId: ThreadId) {
    const read = yield* deps.read(leadId);
    if (read === undefined) return undefined;
    entries.delete(leadId);
    if (entries.size >= MAX_LEADS) {
      const oldest = entries.keys().next();
      if (!oldest.done) entries.delete(oldest.value);
    }
    entries.set(leadId, { usage: read.usage, threadIds: new Set([leadId, ...read.threadIds]) });
    return read.usage;
  });

  // One read at a time per lead; a change that lands during it earns one more read, not one each.
  const refresh = Effect.fn("KodoLeadSpendCache.refresh")(function* (leadId: ThreadId) {
    if (refreshing.has(leadId)) {
      changedWhileRefreshing.add(leadId);
      return;
    }
    refreshing.add(leadId);
    const fiber = yield* Effect.gen(function* () {
      do {
        changedWhileRefreshing.delete(leadId);
        yield* load(leadId).pipe(Effect.ignoreCause);
      } while (changedWhileRefreshing.has(leadId));
    }).pipe(Effect.ensuring(Effect.sync(() => refreshing.delete(leadId))), Effect.forkDetach);
    running.add(fiber);
    fiber.addObserver(() => running.delete(fiber));
  });

  return {
    /** The held figure, or the first read of one. */
    get: (leadId: ThreadId): Effect.Effect<KodoDelegationUsage | undefined> => {
      const held = entries.get(leadId);
      return held === undefined
        ? load(leadId).pipe(Effect.catchCause(() => Effect.undefined))
        : Effect.succeed(held.usage);
    },
    /** Resolves when the background reads started so far have ended. */
    settled: Effect.suspend(() => Effect.forEach([...running], Fiber.await, { discard: true })),
    /** Reads again, in the background, the figure an event changes; any other event costs a lookup. */
    noteEvent: (event: OrchestrationV2DomainEvent): Effect.Effect<void> => {
      if (entries.size === 0) return Effect.void;
      if (event.type === "subagent.updated") {
        return entries.has(event.threadId) ? refresh(event.threadId) : Effect.void;
      }
      if (event.type !== "provider-turn.updated" || !TURN_ENDED.has(event.payload.status)) {
        return Effect.void;
      }
      const leads = [...entries].flatMap(([leadId, entry]) =>
        entry.threadIds.has(event.threadId) ? [leadId] : [],
      );
      return Effect.forEach(leads, refresh, { discard: true });
    },
  } as const;
};
