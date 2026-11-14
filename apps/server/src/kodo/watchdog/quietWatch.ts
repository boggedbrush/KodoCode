// Flags a worker whose running turn made no event for the set time as quiet; it never stops or
// restarts anything. A pending approval or a question the turn waits on holds the clock, and a turn
// that is not running is never quiet. `decideQuiet` is pure and the clock is Effect's.
import {
  CommandId,
  KODO_QUIET_DEFAULT_MINUTES,
  KODO_QUIET_MAX_MINUTES,
  type KodoQuiet,
  type OrchestrationV2DomainEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../../serverActivation.ts";
import * as ServerSettings from "../../serverSettings.ts";

/** How often the sweep looks. The flag is a hint of minutes, so a half minute of slack is invisible. */
const SWEEP_EVERY = Duration.seconds(30);

/** The statuses of a turn that is making progress by itself: not queued, and not waiting on anyone. */
const RUNNING = new Set(["preparing", "starting", "running"]);

/** The setting as milliseconds: unset or not a number is the default, 0 is off (null), and a hand-edited value is clamped. */
export function kodoQuietAfterMs(minutes: unknown): number | null {
  const value =
    typeof minutes === "number" && Number.isFinite(minutes) ? minutes : KODO_QUIET_DEFAULT_MINUTES;
  const whole = Math.min(KODO_QUIET_MAX_MINUTES, Math.max(0, Math.floor(value)));
  return whole === 0 ? null : whole * 60_000;
}

export interface QuietWatchInput {
  /** The worker's turn is running (not queued, not waiting, not finished). */
  readonly running: boolean;
  /** An approval, or a question the turn waits on, is waiting on a person. */
  readonly waitingOnPerson: boolean;
  /** The worker's latest event, in epoch milliseconds. */
  readonly lastEventMs: number;
  readonly nowMs: number;
  /** Null: the watchdog is off. */
  readonly afterMs: number | null;
}

/** Whether the worker is quiet right now. */
export const decideQuiet = (input: QuietWatchInput): boolean =>
  input.afterMs !== null &&
  input.running &&
  !input.waitingOnPerson &&
  input.nowMs - input.lastEventMs >= input.afterMs;

/** What the watchdog reads of a thread; the projection's shell has all of it. */
export interface QuietWatchShell {
  readonly id: ThreadId;
  readonly status: string;
  readonly deletedAt: unknown;
  readonly pendingRuntimeRequest: { readonly blocking?: boolean | undefined } | null;
  readonly kodoQuiet?: KodoQuiet | null | undefined;
  readonly kodoLead?: object | null | undefined;
  readonly lineage: {
    readonly parentThreadId: ThreadId | null;
    readonly relationshipToParent?: string | null | undefined;
  };
}

type Failure = { readonly _tag: string };

export interface QuietWatchDeps {
  /** The setting, as minutes. */
  readonly quietAfterMinutes: Effect.Effect<unknown, Failure>;
  readonly getShell: (threadId: ThreadId) => Effect.Effect<QuietWatchShell | null, Failure>;
  /** Threads with a worker running now, so one that went quiet before a restart is still watched. */
  readonly listRunningWorkers: Effect.Effect<ReadonlyArray<ThreadId>, Failure>;
  readonly setQuiet: (threadId: ThreadId, quiet: KodoQuiet | null) => Effect.Effect<void, Failure>;
}

const eventMs = (event: Pick<OrchestrationV2DomainEvent, "occurredAt">) =>
  DateTime.toEpochMillis(event.occurredAt);

export const makeKodoQuietWatch = (deps: QuietWatchDeps) => {
  // The latest event of each thread seen since the server started; a thread that stops running leaves it.
  const lastEvent = new Map<ThreadId, number>();
  const flagged = new Set<ThreadId>();
  // Threads whose lineage says they are no sub-agent. Lineage is fixed when a thread is made, so it is
  // asked once; whether the parent leads can change, so that is asked at every sweep.
  const notWorkers = new Set<ThreadId>();

  const hasParentLead = Effect.fn("KodoQuietWatch.hasParentLead")(function* (
    shell: QuietWatchShell,
  ) {
    const parentId = shell.lineage.parentThreadId;
    if (parentId === null) return false;
    const parent = yield* deps.getShell(parentId);
    return parent?.kodoLead != null;
  });

  const clear = (threadId: ThreadId) =>
    deps
      .setQuiet(threadId, null)
      .pipe(Effect.tap(() => Effect.sync(() => flagged.delete(threadId))));

  return {
    /**
     * Notes a worker's activity. Our own flag changes are not activity, or flagging would clear itself;
     * any other event clears a flag at once.
     */
    onEvent: Effect.fn("KodoQuietWatch.onEvent")(function* (event: OrchestrationV2DomainEvent) {
      if (event.type === "thread.metadata-updated" || notWorkers.has(event.threadId)) return;
      const at = eventMs(event);
      lastEvent.set(event.threadId, Math.max(lastEvent.get(event.threadId) ?? at, at));
      if (flagged.has(event.threadId)) yield* clear(event.threadId);
    }),

    /** Starts watching the workers already running, with now as their last sign of life. */
    seed: Effect.fn("KodoQuietWatch.seed")(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      for (const threadId of yield* deps.listRunningWorkers) {
        if (!lastEvent.has(threadId)) lastEvent.set(threadId, nowMs);
      }
    }),

    /** One look at every watched thread: flags the silent, clears the flag of the rest. */
    sweep: Effect.fn("KodoQuietWatch.sweep")(function* () {
      const afterMs = kodoQuietAfterMs(yield* deps.quietAfterMinutes);
      const nowMs = yield* Clock.currentTimeMillis;
      for (const threadId of lastEvent.keys()) {
        const shell = yield* deps.getShell(threadId);
        const isSubagent = shell?.lineage.relationshipToParent === "subagent";
        const watched =
          shell !== null && shell.deletedAt === null && isSubagent && (yield* hasParentLead(shell));
        if (shell === null || !watched) {
          // No longer a watched worker (its lead stopped leading, or it was deleted): a flag it holds goes.
          if (shell !== null && shell.deletedAt === null && shell.kodoQuiet != null) {
            yield* clear(threadId);
          }
          lastEvent.delete(threadId);
          flagged.delete(threadId);
          if (shell !== null && !isSubagent) notWorkers.add(threadId);
          continue;
        }
        // Read after the awaits above: an event that arrived meanwhile must count.
        const lastEventMs = lastEvent.get(threadId);
        if (lastEventMs === undefined) continue;
        const running = RUNNING.has(shell.status);
        const quiet = decideQuiet({
          running,
          waitingOnPerson:
            shell.pendingRuntimeRequest !== null && shell.pendingRuntimeRequest.blocking !== false,
          lastEventMs,
          nowMs,
          afterMs,
        });
        if (quiet && shell.kodoQuiet == null) {
          // Marked before the write, so an event that lands while it is in flight clears it.
          flagged.add(threadId);
          yield* deps
            .setQuiet(threadId, { since: DateTime.formatIso(DateTime.makeUnsafe(lastEventMs)) })
            .pipe(Effect.tapError(() => Effect.sync(() => flagged.delete(threadId))));
        } else if (!quiet && shell.kodoQuiet != null) {
          yield* clear(threadId);
        }
        if (!running && !flagged.has(threadId)) lastEvent.delete(threadId);
      }
    }),
  } as const;
};

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const settings = yield* ServerSettings.ServerSettingsService;
    const watch = makeKodoQuietWatch({
      quietAfterMinutes: settings.getSettings.pipe(
        Effect.map((value) => value.kodoQuietAfterMinutes),
      ),
      getShell: orchestrator.getThreadShell,
      listRunningWorkers: orchestrator
        .listActiveSubagentThreadIds()
        .pipe(Effect.map((ids) => [...ids] as ReadonlyArray<ThreadId>)),
      setQuiet: (threadId, quiet) =>
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((nowMs) =>
            orchestrator.dispatch({
              type: "kodo.quiet.set",
              commandId: CommandId.make(`server:kodo-quiet:${threadId}:${nowMs}`),
              threadId,
              quiet,
            }),
          ),
          Effect.asVoid,
        ),
    });
    // A failed look or flag is logged and the watch goes on: it is a hint, never a gate.
    const guarded = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logDebug(`kodo.quiet-watch.${name}-skipped`, { cause }),
        ),
      );
    yield* watch.seed().pipe((effect) => guarded("seed", effect));
    yield* forkParked(
      Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
        guarded("event", watch.onEvent(event)),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("kodo.quiet-watch.events-failed", { cause }),
        ),
      ),
    );
    yield* forkParked(
      guarded("sweep", watch.sweep()).pipe(Effect.repeat(Schedule.spaced(SWEEP_EVERY))),
    );
  }),
);
